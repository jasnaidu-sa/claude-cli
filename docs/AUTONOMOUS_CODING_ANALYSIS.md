# Autonomous Coding System - Deep Analysis

> Detailed analysis of the `leonvanzyl/autonomous-coding` implementation.
> This document captures the actual mechanics for informing our integration design.

---

## Executive Summary

The autonomous-coding system is **simpler than expected**. The "magic" is in:
1. **Detailed prompts** (400+ lines each) with step-by-step instructions
2. **External Python orchestrator** that never loses context
3. **JSON file as source of truth** (`feature_list.json`)
4. **Fresh Claude Code session per iteration** (clean context each time)

There are NOT multiple specialized agents - just **two prompt templates** used at different phases.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         PYTHON ORCHESTRATOR                                  │
│                    (autonomous_agent_demo.py + agent.py)                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   NEVER COMPACTS - Maintains state across unlimited sessions                 │
│                                                                              │
│   Loop:                                                                      │
│   ┌───────────────────────────────────────────────────────────────────────┐ │
│   │  1. Check: Does feature_list.json exist?                              │ │
│   │     - No  → Use initializer_prompt.md (Session 1)                     │ │
│   │     - Yes → Use coding_prompt.md (Sessions 2+)                        │ │
│   │                                                                        │ │
│   │  2. Create fresh ClaudeSDKClient (clean context)                      │ │
│   │                                                                        │ │
│   │  3. Send prompt, await completion                                     │ │
│   │                                                                        │ │
│   │  4. Print progress summary                                            │ │
│   │                                                                        │ │
│   │  5. Sleep 3 seconds, repeat                                           │ │
│   └───────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         CLAUDE CODE SESSION                                  │
│                         (via Claude Agent SDK)                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   Configuration:                                                             │
│   • model: claude-opus-4-5-20251101 (or configurable)                       │
│   • max_turns: 1000                                                          │
│   • cwd: project directory                                                   │
│   • sandbox: enabled                                                         │
│   • permissions: project directory only                                      │
│                                                                              │
│   Tools Available:                                                           │
│   • Built-in: Read, Write, Edit, Glob, Grep, Bash                           │
│   • MCP: Playwright browser automation                                       │
│                                                                              │
│   Hooks:                                                                     │
│   • PreToolUse: Bash security validation                                    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         PROJECT DIRECTORY                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   generations/my_project/                                                    │
│   ├── app_spec.txt              # Copied from prompts/ at start             │
│   ├── feature_list.json         # SOURCE OF TRUTH - 200+ test cases         │
│   ├── claude-progress.txt       # Human-readable progress notes             │
│   ├── init.sh                   # Environment setup script                  │
│   ├── .claude_settings.json     # Security configuration                    │
│   └── [application code]        # Generated source files                    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Core Files Analysis

### 1. `autonomous_agent_demo.py` - Entry Point

**Purpose**: Parse CLI args, validate environment, start the loop

**Key Code**:
```python
def main():
    args = parse_args()

    # Validate API key exists
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("Error: ANTHROPIC_API_KEY not set")
        return

    # Run the agent loop
    asyncio.run(run_autonomous_agent(
        project_dir=project_dir,
        model=args.model,
        max_iterations=args.max_iterations,
    ))
```

**Key Insight**: Very simple - just CLI parsing and environment validation.

---

### 2. `agent.py` - Core Loop Logic

**Purpose**: Main agent loop, session management, prompt selection

**Key Code** (simplified):
```python
async def run_autonomous_agent(project_dir, model, max_iterations):
    # Create project directory
    project_dir.mkdir(parents=True, exist_ok=True)

    # Check if first run
    tests_file = project_dir / "feature_list.json"
    is_first_run = not tests_file.exists()

    if is_first_run:
        # Copy app spec into project for agent to read
        copy_spec_to_project(project_dir)

    iteration = 0
    while True:
        iteration += 1

        if max_iterations and iteration > max_iterations:
            break

        # Create FRESH client each iteration
        client = create_client(project_dir, model)

        # Select prompt based on phase
        if is_first_run:
            prompt = get_initializer_prompt()
            is_first_run = False  # Only use once
        else:
            prompt = get_coding_prompt()

        # Run session
        async with client:
            status, response = await run_agent_session(client, prompt, project_dir)

        # Print progress
        print_progress_summary(project_dir)

        # Auto-continue
        await asyncio.sleep(3)
```

**Key Insights**:
1. **Fresh client per iteration** - No context carryover between sessions
2. **Binary prompt selection** - Only two prompts: initializer OR coding
3. **`is_first_run` flag** - Based solely on `feature_list.json` existence
4. **No state in Python** - All state is in files (`feature_list.json`, git)

---

### 3. `client.py` - Claude SDK Configuration

**Purpose**: Configure the Claude Agent SDK client with security settings

**Key Configuration**:
```python
ClaudeSDKClient(
    options=ClaudeCodeOptions(
        model=model,
        system_prompt="You are an expert full-stack developer building a production-quality web application.",
        allowed_tools=[
            "Read", "Write", "Edit", "Glob", "Grep", "Bash",
            # Playwright MCP tools for browser testing
            "mcp__playwright__browser_navigate",
            "mcp__playwright__browser_snapshot",
            "mcp__playwright__browser_click",
            # ... more browser tools
        ],
        mcp_servers={
            "playwright": {
                "command": "npx",
                "args": ["@playwright/mcp@latest", "--headless"]
            }
        },
        hooks={
            "PreToolUse": [
                HookMatcher(matcher="Bash", hooks=[bash_security_hook]),
            ],
        },
        max_turns=1000,
        cwd=str(project_dir.resolve()),
        settings=str(settings_file.resolve()),
    )
)
```

**Key Insights**:
1. **Simple system prompt** - Just "You are an expert full-stack developer..."
2. **All the intelligence is in the task prompts**, not the system prompt
3. **Playwright MCP** for browser-based testing (critical for verification)
4. **Security hooks** validate bash commands before execution
5. **1000 max turns** per session - generous but bounded

---

### 4. `security.py` - Bash Command Validation

**Purpose**: Allowlist-based bash command filtering

**Allowed Commands**:
```python
ALLOWED_COMMANDS = {
    # File inspection
    "ls", "cat", "head", "tail", "wc", "grep",
    # File operations
    "cp", "mkdir", "chmod", "mv", "rm", "touch",
    # Node.js
    "npm", "npx", "pnpm", "node",
    # Version control
    "git",
    # Docker
    "docker",
    # Process management
    "ps", "lsof", "sleep", "kill", "pkill",
    # Network
    "curl",
    # Shell
    "sh", "bash",
}
```

**Special Validation**:
- `pkill` - Only allowed for dev processes (node, npm, vite)
- `chmod` - Only `+x` variants (make executable)
- `init.sh` - Only `./init.sh` allowed

**Key Insight**: Defense in depth - even with sandbox, bash commands are filtered.

---

### 5. `prompts/initializer_prompt.md` - First Session

**Purpose**: Generate the test list and project foundation

**Length**: ~470 lines

**Structure**:
```markdown
## YOUR ROLE - INITIALIZER AGENT (Session 1 of Many)

### FIRST: Read the Project Specification
Start by reading `app_spec.txt`...

### CRITICAL FIRST TASK: Create feature_list.json
Create a file with 200 detailed end-to-end test cases...

## MANDATORY TEST CATEGORIES (20 categories!)
A. Security & Access Control
B. Navigation Integrity
C. Real Data Verification
D. Workflow Completeness
E. Error Handling
F. UI-Backend Integration
G. State & Persistence
H. URL & Direct Access
I. Double-Action & Idempotency
J. Data Cleanup & Cascade
K. Default & Reset
L. Search & Filter Edge Cases
M. Form Validation
N. Feedback & Notification
O. Responsive & Layout
P. Accessibility
Q. Temporal & Timezone
R. Concurrency & Race Conditions
S. Export/Import
T. Performance

## ABSOLUTE PROHIBITION: NO MOCK DATA
... detailed rules ...

### SECOND TASK: Create init.sh
### THIRD TASK: Initialize Git
### FOURTH TASK: Create Project Structure
### ENDING THIS SESSION
```

**Key Insights**:
1. **Extremely detailed** - Every category has specific test examples
2. **Test count tied to complexity** - Simple: 150, Medium: 250, Complex: 400+
3. **Mock data prohibition** is explicit and repeated
4. **Session ending instructions** ensure clean handoff

---

### 6. `prompts/coding_prompt.md` - Continuation Sessions

**Purpose**: Guide the agent through implementing features

**Length**: ~295 lines

**Structure**:
```markdown
## YOUR ROLE - CODING AGENT

### STEP 1: GET YOUR BEARINGS (MANDATORY)
pwd, ls, cat app_spec.txt, cat feature_list.json...

### STEP 2: START SERVERS (IF NOT RUNNING)
./init.sh

### STEP 3: VERIFICATION TEST (CRITICAL!)
Test 1-2 passing features to catch regressions...

### STEP 4: CHOOSE ONE FEATURE TO IMPLEMENT
Pick highest-priority feature with "passes": false

### STEP 5: IMPLEMENT THE FEATURE

### STEP 6: VERIFY WITH BROWSER AUTOMATION
Navigate, click, type, screenshot...

### STEP 6.5: MANDATORY VERIFICATION CHECKLIST
[ ] Security Verification
[ ] Real Data Verification
[ ] Navigation Verification
[ ] Integration Verification

### STEP 6.6: MOCK DATA DETECTION SWEEP
Code search for forbidden patterns...

### STEP 7: UPDATE feature_list.json (CAREFULLY!)
ONLY change "passes": false → "passes": true

### STEP 8: COMMIT YOUR PROGRESS

### STEP 9: UPDATE PROGRESS NOTES

### STEP 10: END SESSION CLEANLY

## TESTING REQUIREMENTS
Browser automation tool reference...

## IMPORTANT REMINDERS
```

**Key Insights**:
1. **Step-by-step workflow** - Agent can't skip steps
2. **Verification is mandatory** before marking tests passing
3. **Regression testing** at start of each session
4. **Mock data detection** is baked into the workflow
5. **Clean session ending** ensures state is persisted

---

### 7. `prompts/app_spec.txt` - Application Specification

**Purpose**: Define what to build

**Structure**: XML format with sections:
- `<overview>` - What the app does
- `<technology_stack>` - Frontend, backend, database
- `<core_features>` - Detailed feature list
- `<database_schema>` - Tables and fields
- `<api_endpoints_summary>` - All endpoints
- `<ui_layout>` - Layout structure
- `<design_system>` - Colors, typography
- `<implementation_steps>` - Build order
- `<success_criteria>` - Definition of done

**Key Insight**: Very comprehensive spec - agent has everything it needs.

---

### 8. `.claude/commands/create-spec.md` - Spec Generator

**Purpose**: Interactive wizard to create app_spec.txt

**Length**: ~530 lines

**Flow**:
1. Phase 1: Project Overview (name, description, audience)
2. Phase 2: Involvement Level (Quick vs Detailed mode)
3. Phase 3: Scale & Complexity (Simple/Medium/Complex)
4. Phase 4: Features (main exploration phase)
5. Phase 5: Technical Details (derived or discussed)
6. Phase 6: Success Criteria
7. Phase 7: Review & Approval
8. File Generation

**Key Insight**: The spec generator is a Claude Code slash command that guides users through creating comprehensive specifications.

---

## Progress Tracking

### `feature_list.json` Format

```json
[
  {
    "category": "functional",
    "description": "User can log in with valid credentials",
    "steps": [
      "Step 1: Navigate to login page",
      "Step 2: Enter valid email and password",
      "Step 3: Click login button",
      "Step 4: Verify redirect to dashboard"
    ],
    "passes": false
  },
  {
    "category": "security",
    "description": "Unauthenticated user cannot access protected routes",
    "steps": [
      "Step 1: Clear all cookies/session",
      "Step 2: Navigate directly to /dashboard",
      "Step 3: Verify redirect to login page"
    ],
    "passes": true
  }
]
```

### Progress Counting

```python
def count_passing_tests(project_dir):
    tests_file = project_dir / "feature_list.json"
    with open(tests_file) as f:
        tests = json.load(f)
    total = len(tests)
    passing = sum(1 for test in tests if test.get("passes", False))
    return passing, total
```

### Webhook Notifications

When progress increases, sends to N8N webhook:
```json
{
  "event": "test_progress",
  "passing": 45,
  "total": 200,
  "percentage": 22.5,
  "completed_tests": ["[Auth] User can log in..."],
  "timestamp": "2025-01-15T14:30:00.000Z"
}
```

---

## Key Design Patterns

### 1. Fresh Context Per Session

Each iteration creates a completely new Claude session. No memory of previous sessions except what's in files.

**Why it works**: The prompts contain all the instructions needed. The agent reads state from files.

### 2. Prompt-Driven Behavior

The "agent types" are just different prompts. There's no complex agent orchestration - just:
- If no `feature_list.json` → use initializer prompt
- Otherwise → use coding prompt

### 3. File-Based State

All state is in the project directory:
- `feature_list.json` - What to build, what's done
- `claude-progress.txt` - Human-readable notes
- Git history - Full audit trail

### 4. Verification Through UI

Tests must be verified through actual browser interaction, not just API calls. This ensures:
- Frontend and backend work together
- UI looks correct
- Real data flows through the system

### 5. Mock Data Prevention

Multiple layers of defense:
- Explicit prohibition in prompts
- Detection sweep in workflow
- Verification requires unique test data
- Code search for forbidden patterns

---

## Comparison: Their System vs Our Needs

| Aspect | autonomous-coding | Our NexusERP Needs |
|--------|-------------------|-------------------|
| Project Type | Greenfield | Brownfield |
| Spec Format | XML app_spec.txt | Existing .schema/ docs |
| Test Format | feature_list.json | Beads issues + deps |
| Conventions | In app_spec.txt | CLAUDE.md + existing patterns |
| Database | Created from scratch | Existing Supabase schema |
| Agent Types | 2 prompts | 4+ specialized agents |
| Progress Tracking | JSON + webhook | Beads + GitHub Issues |
| UI | Terminal | Electron app |

---

## Adaptation Opportunities

### What to Keep

1. **Fresh session per iteration** - Proven pattern
2. **Detailed step-by-step prompts** - Key to success
3. **File-based state persistence** - Simple, reliable
4. **Verification requirements** - Quality gate
5. **Security hooks** - Defense in depth

### What to Change

1. **Add dependency tracking** - Beads over flat JSON
2. **Brownfield-aware prompts** - Read existing code first
3. **Schema validation phase** - Ensure docs match reality
4. **Convention injection** - Load CLAUDE.md into prompts
5. **Interactive spec generation** - Chat-based in Electron app
6. **Visual progress** - Dashboard instead of terminal

### What to Add

1. **Schema Validator Agent** - New prompt for checking schema
2. **Reviewer Agent** - Periodic quality review
3. **Project selection UI** - Multiple projects
4. **GitHub sync** - Bidirectional issue tracking
5. **Human checkpoints** - UI for approvals

---

## Next Steps

1. **Adapt Prompt Templates** - Create brownfield versions of:
   - `initializer_prompt.md` → `planning_prompt.md` (reads existing schema)
   - `coding_prompt.md` → `implementation_prompt.md` (respects conventions)
   - NEW: `schema_validation_prompt.md`
   - NEW: `review_prompt.md`

2. **Design Beads Integration** - Replace `feature_list.json` with:
   - Issue graph with dependencies
   - `bd ready` for computed unblocked work
   - Status tracking per issue

3. **Build Electron Integration** - Add to claude-code-manager:
   - Workflow management UI
   - Spec generation chat
   - Progress dashboard
   - Human checkpoint dialogs

4. **Create Convention Injection** - System to:
   - Load CLAUDE.md
   - Extract patterns from existing code
   - Inject into prompts at runtime

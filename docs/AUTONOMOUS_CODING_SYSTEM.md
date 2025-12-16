# Autonomous Coding System - Full Specification

> Comprehensive specification for building an Electron app that manages autonomous coding workflows for brownfield projects using the leonvanzyl/autonomous-coding pattern.

---

## 1. Executive Summary

### What We're Building

An Electron application that:
1. Manages Python-based autonomous coding sessions
2. Adapts the greenfield autonomous-coding pattern for **brownfield** projects
3. Handles all infrastructure (Python, venv, MCP servers) transparently
4. Provides a task list UI showing test completion progress
5. Integrates with existing projects that have `.schema/` documentation

### Core Principle

**The autonomous-coding workflow remains the core engine.** We are NOT replacing it with automaker's approach. We are:
- Wrapping it in an Electron app for ease of use
- Adapting prompts for brownfield (existing codebase) support
- Adding schema validation before starting
- Keeping Playwright MCP for browser automation (proven, works headless)
- Adding Supabase MCP for database introspection
- Supporting multiple workflows per project via git worktrees

---

## 2. System Architecture

### High-Level Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           ELECTRON APP                                       │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │  RENDERER PROCESS (React/Next.js)                                      │ │
│  │  • Project selection                                                   │ │
│  │  • Spec input (text area or file import)                              │ │
│  │  • Task list with completion progress                                  │ │
│  │  • Agent output viewer                                                 │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                    │ IPC                                     │
│                                    ▼                                         │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │  MAIN PROCESS (Node.js)                                                │ │
│  │  • Venv management (create, activate, install deps)                   │ │
│  │  • Python process spawning                                             │ │
│  │  • Progress event streaming                                            │ │
│  │  • Schema validation orchestration                                     │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                    │                                         │
│                                    ▼                                         │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │  PYTHON ORCHESTRATOR (in shared venv)                                  │ │
│  │  • autonomous_agent_demo.py (entry point)                              │ │
│  │  • agent.py (session loop)                                             │ │
│  │  • client.py (Claude SDK + MCP config)                                 │ │
│  │  • security.py (bash allowlist)                                        │ │
│  │  • prompts/ (brownfield-adapted prompts)                               │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                    │                                         │
│                                    ▼                                         │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │  CLAUDE CODE SESSION (via claude-code-sdk)                             │ │
│  │  • Tools: Read, Write, Edit, Glob, Grep, Bash                         │ │
│  │  • MCP: Supabase (schema), Chrome DevTools (browser testing)          │ │
│  │  • Hooks: Bash security validation                                     │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Directory Structure

```
~/.autonomous-coding/                    # Global app data
├── venv/                                # Shared Python virtual environment
│   ├── Scripts/ (Windows) or bin/       # Python, pip executables
│   └── Lib/site-packages/               # Installed packages
├── config.yaml                          # Global settings
├── logs/                                # Execution logs
└── prompts/                             # Prompt templates (can be customized)
    ├── schema_validation_prompt.md      # Phase 0: Schema check
    ├── initializer_prompt_brownfield.md # Phase 1: Test generation
    └── coding_prompt_brownfield.md      # Phase 2+: Implementation

[PROJECT_DIR]/                           # User's existing project (main branch)
├── .schema/                             # Existing schema documentation
├── CLAUDE.md                            # Project conventions
├── src/                                 # Existing source code
├── .autonomous/                         # Workflow registry (shared across worktrees)
│   ├── config.yaml                      # Project-level config
│   ├── schema_validation.json           # Schema check results (shared)
│   └── workflows/                       # Workflow metadata
│       ├── o2c.yaml                     # O2C workflow config
│       └── p2p.yaml                     # P2P workflow config
├── .worktrees/                          # Git worktrees for each workflow
│   ├── o2c/                             # O2C workflow worktree
│   │   ├── .autonomous-workflow/        # Workflow-specific state
│   │   │   ├── app_spec.txt             # What NEW features to build
│   │   │   ├── feature_list.json        # Test cases (source of truth)
│   │   │   ├── progress.txt             # Human-readable notes
│   │   │   └── sessions/                # Session logs
│   │   │       ├── session_001.log
│   │   │       └── session_002.log
│   │   └── [project files - o2c branch]
│   └── p2p/                             # P2P workflow worktree
│       ├── .autonomous-workflow/
│       │   ├── app_spec.txt
│       │   ├── feature_list.json
│       │   └── ...
│       └── [project files - p2p branch]
└── [existing project files]
```

---

## 3. Virtual Environment Management

### Location

```
~/.autonomous-coding/venv/
```

### Initialization (First Run)

```python
# Main process (Node.js) executes:
import subprocess
import sys
from pathlib import Path

VENV_PATH = Path.home() / ".autonomous-coding" / "venv"

def ensure_venv():
    if not VENV_PATH.exists():
        # Create venv
        subprocess.run([sys.executable, "-m", "venv", str(VENV_PATH)], check=True)

        # Install dependencies
        pip = VENV_PATH / "Scripts" / "pip.exe"  # Windows
        subprocess.run([str(pip), "install", "claude-code-sdk>=0.0.25", "python-dotenv>=1.0.0"], check=True)

    return VENV_PATH
```

### Activation (Each Run)

The Electron main process spawns Python using the venv's interpreter directly:

```javascript
// main/services/autonomous-runner.ts
const venvPython = path.join(
  os.homedir(),
  '.autonomous-coding',
  'venv',
  process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'
);

const child = spawn(venvPython, ['autonomous_agent_demo.py', '--project-dir', projectPath], {
  cwd: orchestratorPath,
  env: {
    ...process.env,
    ANTHROPIC_API_KEY: apiKey,
    SUPABASE_ACCESS_TOKEN: supabaseToken,
  }
});
```

### Dependency Updates

```javascript
async function updateDependencies() {
  const pip = path.join(venvPath, 'Scripts', 'pip.exe');
  await execAsync(`"${pip}" install --upgrade claude-code-sdk`);
}
```

---

## 4. MCP Server Configuration

### client.py Modifications

```python
"""
Claude SDK Client Configuration - Brownfield Edition
"""

import json
import os
from pathlib import Path

from claude_code_sdk import ClaudeCodeOptions, ClaudeSDKClient
from claude_code_sdk.types import HookMatcher

from security import bash_security_hook


# Playwright MCP tools for browser automation (proven, works headless)
PLAYWRIGHT_TOOLS = [
    # Core navigation & snapshots
    "mcp__playwright__browser_navigate",
    "mcp__playwright__browser_snapshot",
    # Interactions
    "mcp__playwright__browser_click",
    "mcp__playwright__browser_fill_form",
    "mcp__playwright__browser_select_option",
    "mcp__playwright__browser_hover",
    "mcp__playwright__browser_type",
    "mcp__playwright__browser_press_key",
    # Waiting & verification
    "mcp__playwright__browser_wait_for",
    "mcp__playwright__browser_verify_element_visible",
    "mcp__playwright__browser_verify_text_visible",
    # Dialogs (alert, confirm, prompt)
    "mcp__playwright__browser_handle_dialog",
    # Debugging & escape hatch
    "mcp__playwright__browser_console_messages",
    "mcp__playwright__browser_evaluate",
    "mcp__playwright__browser_run_code",
    "mcp__playwright__browser_close",
]

# Supabase MCP tools for database introspection
SUPABASE_TOOLS = [
    "mcp__supabase__list_tables",
    "mcp__supabase__list_extensions",
    "mcp__supabase__list_migrations",
    "mcp__supabase__execute_sql",
    "mcp__supabase__apply_migration",
    "mcp__supabase__get_project",
    "mcp__supabase__get_project_url",
    "mcp__supabase__generate_typescript_types",
    "mcp__supabase__list_projects",  # For auto-detection
]

# Built-in tools
BUILTIN_TOOLS = [
    "Read",
    "Write",
    "Edit",
    "Glob",
    "Grep",
    "Bash",
]


def auto_detect_supabase_project_id(project_dir: Path) -> str | None:
    """
    Auto-detect Supabase project ID from project configuration.

    Checks in order:
    1. .autonomous/config.yaml (supabase.project_id)
    2. supabase/config.toml (project_id)
    3. .env file (SUPABASE_PROJECT_ID or extract from SUPABASE_URL)

    Returns None if not found (will prompt user).
    """
    import re

    # Check .autonomous/config.yaml
    config_file = project_dir / ".autonomous" / "config.yaml"
    if config_file.exists():
        import yaml
        with open(config_file) as f:
            config = yaml.safe_load(f)
            if config and config.get("supabase", {}).get("project_id"):
                return config["supabase"]["project_id"]

    # Check supabase/config.toml
    supabase_config = project_dir / "supabase" / "config.toml"
    if supabase_config.exists():
        content = supabase_config.read_text()
        match = re.search(r'project_id\s*=\s*"([^"]+)"', content)
        if match:
            return match.group(1)

    # Check .env
    env_file = project_dir / ".env"
    if env_file.exists():
        content = env_file.read_text()
        # Direct project ID
        match = re.search(r'SUPABASE_PROJECT_ID\s*=\s*(\S+)', content)
        if match:
            return match.group(1)
        # Extract from URL (https://PROJECT_ID.supabase.co)
        match = re.search(r'SUPABASE_URL\s*=\s*https://([^.]+)\.supabase\.co', content)
        if match:
            return match.group(1)

    return None


def create_client(project_dir: Path, model: str, supabase_project_id: str | None = None) -> ClaudeSDKClient:
    """
    Create a Claude Agent SDK client configured for brownfield development.

    MCP Servers:
    - Playwright: Browser automation and testing (headless)
    - Supabase: Database schema introspection and migrations

    Args:
        project_dir: Project directory path
        model: Claude model to use
        supabase_project_id: Optional explicit project ID (auto-detected if not provided)
    """
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    oauth_token = os.environ.get("CLAUDE_CODE_OAUTH_TOKEN")
    supabase_token = os.environ.get("SUPABASE_ACCESS_TOKEN")

    if not api_key and not oauth_token:
        raise ValueError("No Claude auth configured. Set ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN.")

    # Auto-detect Supabase project ID if not provided
    if not supabase_project_id:
        supabase_project_id = auto_detect_supabase_project_id(project_dir)

    if not supabase_token:
        print("Warning: SUPABASE_ACCESS_TOKEN not set. Supabase MCP will not be available.")
    elif not supabase_project_id:
        print("Warning: Could not auto-detect Supabase project ID. User will be prompted.")

    # Security settings - allow access to project directory
    security_settings = {
        "sandbox": {"enabled": True, "autoAllowBashIfSandboxed": True},
        "permissions": {
            "defaultMode": "acceptEdits",
            "allow": [
                "Read(./**)",
                "Write(./**)",
                "Edit(./**)",
                "Glob(./**)",
                "Grep(./**)",
                "Bash(*)",
                *PLAYWRIGHT_TOOLS,
                *SUPABASE_TOOLS,
            ],
        },
    }

    project_dir.mkdir(parents=True, exist_ok=True)
    settings_file = project_dir / ".claude_settings.json"
    with open(settings_file, "w") as f:
        json.dump(security_settings, f, indent=2)

    # Configure MCP servers
    mcp_servers = {
        "playwright": {
            "command": "npx",
            "args": ["@playwright/mcp@latest", "--headless"]
        }
    }

    # Add Supabase MCP if token is available
    if supabase_token:
        mcp_servers["supabase"] = {
            "command": "npx",
            "args": [
                "-y",
                "@supabase/mcp-server-supabase@latest",
                "--access-token",
                supabase_token
            ]
        }

    return ClaudeSDKClient(
        options=ClaudeCodeOptions(
            model=model,
            system_prompt="You are an expert full-stack developer working on an EXISTING codebase. Always respect existing patterns, conventions, and architecture.",
            allowed_tools=[
                *BUILTIN_TOOLS,
                *PLAYWRIGHT_TOOLS,
                *SUPABASE_TOOLS,
            ],
            mcp_servers=mcp_servers,
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

---

## 5. Workflow Phases

### Phase 0: Schema Validation (NEW)

**Trigger**: Automatically when project is selected

**Purpose**: Ensure `.schema/` documentation matches actual Supabase database

**Prompt**: `schema_validation_prompt.md`

```markdown
## YOUR ROLE - SCHEMA VALIDATOR

You are validating that the project's schema documentation matches the actual database.

### STEP 1: Read Existing Documentation
Read all files in `.schema/database/` to understand what the documentation claims.

### STEP 2: Query Actual Database
Use `mcp__supabase__list_tables` to get the actual database schema.
Use `mcp__supabase__execute_sql` if needed for detailed column info:
```sql
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public';
```

### STEP 3: Compare and Report
Create `.autonomous/schema_validation.json`:
```json
{
  "validated_at": "2025-01-15T10:00:00Z",
  "status": "discrepancies_found",  // or "valid"
  "tables": {
    "matching": ["users", "invoices", "..."],
    "missing_in_docs": ["new_table"],
    "missing_in_db": ["deprecated_table"],
    "column_mismatches": [
      {
        "table": "users",
        "issue": "Column 'middle_name' exists in DB but not in docs"
      }
    ]
  },
  "recommendation": "Update .schema/database/users.md to include middle_name column"
}
```

### STEP 4: Update Documentation (If Approved)
If discrepancies found and user approves updates:
- Add missing tables/columns to `.schema/` docs
- Mark deprecated items
- Regenerate TypeScript types if available

### OUTPUT
End with a summary:
- Total tables checked
- Discrepancies found (if any)
- Recommended actions
```

---

### Phase 1: Test Generation (Brownfield-Adapted)

**Trigger**: After schema validation passes, when user provides spec

**Purpose**: Generate `feature_list.json` with tests for NEW features only

**Prompt**: `initializer_prompt_brownfield.md`

```markdown
## YOUR ROLE - INITIALIZER AGENT (Brownfield Mode)

You are setting up an autonomous coding workflow for an EXISTING codebase.
Your job is to generate test cases for NEW features while respecting what already exists.

### CRITICAL DIFFERENCE FROM GREENFIELD
- This is NOT a new project - code already exists
- You must UNDERSTAND the existing codebase before generating tests
- Tests should cover NEW functionality only
- New code must INTEGRATE with existing patterns

---

### STEP 1: Understand the Existing Codebase

#### 1.1 Read Schema Documentation
```bash
ls .schema/
cat .schema/_index.md
```
Read all relevant schema files to understand:
- Database structure
- API patterns
- Data flows

#### 1.2 Read Project Conventions
```bash
cat CLAUDE.md
```
Understand:
- Naming conventions
- File structure patterns
- UI/UX standards
- Technology stack

#### 1.3 Explore Existing Code
```bash
ls -la src/
```
Find and read 2-3 similar features to understand:
- Component patterns
- State management approach
- API integration style
- Test patterns

---

### STEP 2: Read the New Feature Specification
```bash
cat .autonomous/app_spec.txt
```
This describes ONLY the new features to be built.

---

### STEP 3: Create feature_list.json

Generate test cases for the NEW features. The number of tests depends on complexity:
- Simple feature set: 100-150 tests
- Medium complexity: 150-250 tests
- Complex/large scope: 250-400 tests

#### Test Categories (Scoped to NEW Features)

**A. Integration with Existing (15% of tests)**
- New features work with existing authentication
- New features use existing UI components correctly
- New API endpoints follow existing patterns
- New database operations respect existing schema

**B. No Regressions (10% of tests)**
- Existing functionality still works after changes
- Existing API contracts are maintained
- Existing UI flows are not broken

**C. Security & Access Control (10% of tests)**
- New endpoints require proper authentication
- New data respects RLS policies
- New features follow existing permission patterns

**D. Real Data Verification (15% of tests)**
- New features work with actual database data
- No mock/placeholder data in final implementation
- Data flows correctly between new and existing components

**E. Navigation & Routing (8% of tests)**
- New pages integrate with existing navigation
- URLs follow existing patterns
- Deep links work correctly

**F. Form Validation (8% of tests)**
- New forms validate input correctly
- Error messages are consistent with existing
- Submission flows work end-to-end

**G. Error Handling (8% of tests)**
- New features handle errors gracefully
- Error states match existing patterns
- Recovery flows work correctly

**H. State & Persistence (8% of tests)**
- New state integrates with existing stores
- Data persists correctly
- Optimistic updates work if used

**I. UI/UX Consistency (8% of tests)**
- New UI matches existing design system
- Responsive behavior is consistent
- Loading states match existing patterns

**J. API Integration (10% of tests)**
- New endpoints work correctly
- Request/response formats are consistent
- Error responses follow existing patterns

---

### STEP 4: Create feature_list.json

Write to `.autonomous/feature_list.json`:

```json
[
  {
    "id": 1,
    "category": "integration",
    "description": "[Integration] New invoice form uses existing customer lookup component",
    "steps": [
      "Navigate to new invoice page",
      "Click customer selection field",
      "Verify existing CustomerLookup component appears",
      "Select a customer",
      "Verify customer data populates invoice form"
    ],
    "passes": false,
    "priority": 1,
    "existing_dependencies": ["src/components/CustomerLookup.tsx", "src/hooks/useCustomers.ts"]
  },
  {
    "id": 2,
    "category": "security",
    "description": "[Security] New invoice endpoints require authentication",
    "steps": [
      "Clear authentication tokens",
      "Attempt to access /api/invoices",
      "Verify 401 response",
      "Authenticate as valid user",
      "Verify endpoint now accessible"
    ],
    "passes": false,
    "priority": 1,
    "existing_dependencies": ["src/middleware/auth.ts"]
  }
]
```

#### Required Fields
- `id`: Sequential number
- `category`: One of the categories above
- `description`: [Category] Clear description of what's being tested
- `steps`: Detailed steps to verify
- `passes`: Always `false` initially
- `priority`: 1 (high), 2 (medium), 3 (low)
- `existing_dependencies`: Files in existing codebase this test relates to

---

### STEP 5: Create Progress File

Write to `.autonomous/progress.txt`:

```
# Autonomous Coding Progress - [Project Name]
# Started: [Date]
# Mode: Brownfield (existing codebase)

## Existing Codebase Analysis
- Schema docs: .schema/ (X tables documented)
- Conventions: CLAUDE.md
- Existing features: [list key existing features]

## New Features Scope
[Summary from app_spec.txt]

## Test Summary
- Total tests: X
- By category:
  - Integration: X
  - Security: X
  - [etc.]

## Session Log
[Session 1] Initialized - Generated X test cases
```

---

### STEP 6: Initialize Git Branch (If Not Exists)

```bash
# Check if we're in a git repo
git status

# Create feature branch for new work
git checkout -b feature/autonomous-[feature-name]

# Initial commit
git add .autonomous/
git commit -m "chore: Initialize autonomous coding workflow for [feature]"
```

---

### ABSOLUTE PROHIBITIONS

1. **NO MOCK DATA** - All tests must use real database data
2. **NO REFACTORING** - Do not modify existing code unless explicitly required
3. **NO PATTERN CHANGES** - Match existing patterns exactly
4. **NO ASSUMPTIONS** - If unclear, read existing code first

---

### SESSION END

Before ending this session:
1. Verify `feature_list.json` was created with all tests
2. Verify `progress.txt` was created
3. Verify git branch and initial commit
4. Output summary of tests generated by category
```

---

### Phase 2+: Implementation (Brownfield-Adapted)

**Trigger**: After test generation, loops until all tests pass

**Purpose**: Implement features one test at a time

**Prompt**: `coding_prompt_brownfield.md`

```markdown
## YOUR ROLE - CODING AGENT (Brownfield Mode)

You are implementing NEW features in an EXISTING codebase.
Your code must integrate seamlessly with what already exists.

---

### STEP 0: UNDERSTAND EXISTING PATTERNS (EVERY SESSION)

Before ANY implementation:

#### 0.1 Read Conventions
```bash
cat CLAUDE.md
```

#### 0.2 Find Similar Existing Code
For each feature you implement, FIRST find and read similar existing code:
```bash
# Example: If implementing a new form
ls src/components/*Form*
cat src/components/CustomerForm.tsx  # Read existing form pattern
```

You MUST match:
- File naming conventions
- Component structure
- State management patterns
- API call patterns
- Error handling patterns
- UI component usage

---

### STEP 1: GET YOUR BEARINGS

```bash
pwd
ls -la
cat .autonomous/feature_list.json
cat .autonomous/progress.txt
```

Count passing vs failing tests.

---

### STEP 2: START DEV SERVER (If Not Running)

Check if the dev server is running:
```bash
# Check for running node processes
ps aux | grep -E "(node|next|vite)" | grep -v grep
```

If not running, start it:
```bash
npm run dev &
sleep 5
```

---

### STEP 3: REGRESSION CHECK (CRITICAL)

Before implementing anything new, verify 2-3 PASSING tests still work:

1. Pick tests marked `"passes": true`
2. Use Chrome DevTools MCP to verify they still pass
3. If ANY regression found: STOP and fix before proceeding

```javascript
// Use Chrome DevTools MCP
mcp__chrome-devtools__navigate_page({ url: "http://localhost:3000/..." })
mcp__chrome-devtools__take_snapshot()
// Verify expected elements exist
```

---

### STEP 4: CHOOSE ONE FAILING TEST

From `feature_list.json`, pick the highest priority test with `"passes": false`.

Consider:
- Priority (1 = highest)
- Dependencies (implement dependencies first)
- `existing_dependencies` (understand related existing code)

Read the test's `existing_dependencies` files to understand integration points.

---

### STEP 5: IMPLEMENT THE FEATURE

#### 5.1 Match Existing Patterns
- Use the SAME file structure as similar features
- Use the SAME component patterns
- Use the SAME state management approach
- Use the SAME API patterns

#### 5.2 Follow Conventions
Everything in CLAUDE.md applies:
- Design tokens (not raw colors)
- Typography scale
- Component structure

#### 5.3 Write the Code
Create/modify files following existing patterns exactly.

#### 5.4 Add Tests (If Project Has Tests)
```bash
ls src/**/*.test.ts
```
If tests exist, add tests matching existing test patterns.

---

### STEP 6: VERIFY WITH BROWSER

Use Playwright MCP to verify the implementation:

```javascript
// Navigate to the feature
mcp__playwright__browser_navigate({ url: "http://localhost:3000/new-feature" })

// Take a snapshot to understand the page
mcp__playwright__browser_snapshot()

// Interact with elements
mcp__playwright__browser_type({ selector: "#email-input", text: "test@example.com" })
mcp__playwright__browser_click({ selector: "#submit-button" })

// Wait for result
mcp__playwright__browser_wait_for({ text: "Success" })

// Verify with another snapshot
mcp__playwright__browser_snapshot()
```

---

### STEP 6.5: MANDATORY VERIFICATION CHECKLIST

Before marking any test as passing, verify ALL of these:

#### [ ] Integration Verification
- New code calls existing functions correctly
- Existing components render correctly in new context
- Data flows between new and existing code

#### [ ] Convention Verification
- File names match convention
- Component names match convention
- CSS uses design tokens (not raw colors)

#### [ ] Data Verification
- Feature works with REAL database data
- No hardcoded/mock data anywhere
- Supabase queries return expected results

#### [ ] No Regressions
- Existing features still work
- No console errors from existing code
- No TypeScript errors

---

### STEP 7: UPDATE feature_list.json

ONLY after verification passes:

```bash
# Read current state
cat .autonomous/feature_list.json
```

Update ONLY the test you just verified:
- Change `"passes": false` to `"passes": true`
- Do NOT change any other tests

```bash
# Write updated file
# Be careful to preserve all other tests exactly
```

---

### STEP 8: COMMIT PROGRESS

```bash
git add -A
git commit -m "feat: [Test ID] [Test description]

- Implemented [specific changes]
- Verified with browser automation
- Passes: X/Y tests"
```

---

### STEP 9: UPDATE PROGRESS NOTES

Append to `.autonomous/progress.txt`:

```
[Session N] [Date/Time]
- Implemented: [Test description]
- Files changed: [list]
- Notes: [any observations]
- Status: X/Y tests passing
```

---

### STEP 10: END SESSION CLEANLY

Before ending:
1. All files saved
2. Git committed
3. Progress notes updated
4. Dev server still running (or note if stopped)

Output:
```
SESSION COMPLETE
================
Tests passing: X/Y (Z%)
Implemented this session: [Test description]
Next priority: [Next failing test]
```

---

### BROWSER TESTING REFERENCE

Playwright MCP tools:

| Action | Tool |
|--------|------|
| Go to URL | `browser_navigate({ url: "..." })` |
| Get page content | `browser_snapshot()` |
| Click element | `browser_click({ selector: "..." })` |
| Type in field | `browser_type({ selector: "...", text: "..." })` |
| Fill form | `browser_fill_form({ ... })` |
| Wait for text | `browser_wait_for({ text: "..." })` |
| Verify visible | `browser_verify_text_visible({ text: "..." })` |
| Check console | `browser_console_messages()` |
| Run JS | `browser_evaluate({ expression: "..." })` |

---

### DATABASE REFERENCE

Supabase MCP tools:

| Action | Tool |
|--------|------|
| List tables | `mcp__supabase__list_tables({ project_id: "..." })` |
| Run SQL | `mcp__supabase__execute_sql({ project_id: "...", query: "..." })` |
| Apply migration | `mcp__supabase__apply_migration({ ... })` |

---

### IMPORTANT REMINDERS

1. **ALWAYS read existing code before writing new code**
2. **ALWAYS match existing patterns exactly**
3. **NEVER refactor existing code unless explicitly required**
4. **NEVER use mock data - use real database**
5. **ALWAYS verify with browser before marking test passing**
6. **COMMIT after each passing test**
```

---

## 6. User Interface Specification

### Main Window Layout

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Autonomous Coding Manager                                    [_] [□] [X]   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │  PROJECT                                                                ││
│  │  ┌─────────────────────────────────────────────────────┐  [Change]     ││
│  │  │  NexusERP                                           │               ││
│  │  │  C:\claude_projects\erp                             │               ││
│  │  │  Schema: ✓ Valid (checked 2 min ago)               │  [Revalidate] ││
│  │  └─────────────────────────────────────────────────────┘               ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │  WORKFLOWS                                              [+ New Workflow] ││
│  │  ┌─────────────────────────────────────────────────────────────────────┐││
│  │  │  ● O2C Module        47/185 (25%)    In Progress    [Select]       │││
│  │  │  ○ P2P Module        0/0             Not Started    [Select]       │││
│  │  │  ✓ GL Core           120/120 (100%)  Completed      [View]         │││
│  │  └─────────────────────────────────────────────────────────────────────┘││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │  SELECTED: O2C Module                                      [Edit Spec]  ││
│  │  Branch: autonomous/o2c | Worktree: .worktrees/o2c                      ││
│  │  ┌─────────────────────────────────────────────────────────────────────┐││
│  │  │  Build the Order-to-Cash module including:                         │││
│  │  │  - Customer management                                              │││
│  │  │  - Quote creation and approval                                      │││
│  │  │  - Invoice generation                                               │││
│  │  │  ...                                                                │││
│  │  └─────────────────────────────────────────────────────────────────────┘││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │  PROGRESS                                        [Start] [Pause] [Stop] ││
│  │                                                                         ││
│  │  ████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░  47/185 tests (25%)          ││
│  │                                                                         ││
│  │  ┌───────────────────┬────────┬────────┬─────────────────────────────┐ ││
│  │  │ Category          │ Done   │ Total  │ Status                      │ ││
│  │  ├───────────────────┼────────┼────────┼─────────────────────────────┤ ││
│  │  │ Integration       │ 12     │ 28     │ ● In Progress               │ ││
│  │  │ Security          │ 8      │ 18     │ ✓ Complete                  │ ││
│  │  │ Real Data         │ 5      │ 28     │ ○ Pending                   │ ││
│  │  │ Navigation        │ 10     │ 15     │ ● In Progress               │ ││
│  │  │ Forms             │ 7      │ 15     │ ○ Pending                   │ ││
│  │  │ Error Handling    │ 3      │ 15     │ ○ Pending                   │ ││
│  │  │ State             │ 2      │ 15     │ ○ Pending                   │ ││
│  │  │ UI Consistency    │ 0      │ 15     │ ○ Blocked                   │ ││
│  │  │ API               │ 0      │ 18     │ ○ Blocked                   │ ││
│  │  │ No Regressions    │ 0      │ 18     │ ○ Blocked                   │ ││
│  │  └───────────────────┴────────┴────────┴─────────────────────────────┘ ││
│  │                                                                         ││
│  │  Current: [Integration] Invoice form uses CustomerLookup component     ││
│  │  Session: #12 | Duration: 8m 23s | Model: claude-sonnet-4              ││
│  │                                                                         ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │  OUTPUT                                                    [Expand]     ││
│  │  ┌─────────────────────────────────────────────────────────────────────┐││
│  │  │  [14:32:05] Reading existing CustomerLookup component...           │││
│  │  │  [14:32:08] Found pattern: React functional component with hooks   │││
│  │  │  [14:32:12] Creating InvoiceForm.tsx following same pattern...     │││
│  │  │  [14:32:45] Running browser verification...                        │││
│  │  │  [14:32:48] ✓ CustomerLookup renders in invoice form               │││
│  │  │  [14:32:51] ✓ Customer selection populates form                    │││
│  │  │  [14:32:54] Test PASSED - updating feature_list.json               │││
│  │  │  ...                                                                │││
│  │  └─────────────────────────────────────────────────────────────────────┘││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│  Ready | Sessions: 12 | Cost: ~$4.50 | Last commit: 2 min ago              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### UI Components

#### Project Selector
- Dropdown or dialog to select project directory
- Shows recent projects
- "Browse" to select new directory
- Validates project has required structure (.schema/, CLAUDE.md)

#### Schema Status
- Automatic check on project selection
- Shows: ✓ Valid, ⚠️ Discrepancies, ✗ Invalid
- "Revalidate" button triggers schema validation phase
- "View Details" shows schema_validation.json

#### Spec Editor
- Multi-line text area for spec input
- "Import" button to load from .md file
- "Edit Spec" to modify after initial input
- Saved to `.autonomous/app_spec.txt`

#### Progress Panel
- Overall progress bar with percentage
- Table of categories with completion status
- Current test being worked on
- Session info (number, duration, model)

#### Output Panel
- Scrolling log of agent output
- Timestamps for each entry
- Expandable to full screen
- "Clear" button

#### Control Buttons
- **Start**: Begin autonomous process
- **Pause**: Stop after current test completes
- **Stop**: Immediate stop (saves state)

---

## 7. Configuration

### Global Config (`~/.autonomous-coding/config.yaml`)

```yaml
# Model settings
models:
  default: "claude-sonnet-4-20250514"
  schema_validation: "claude-sonnet-4-20250514"
  test_generation: "claude-opus-4-20250514"  # More thorough for planning
  implementation: "claude-sonnet-4-20250514"

# Test generation
test_generation:
  auto_detect_complexity: true
  min_tests: 100
  max_tests: 400

# Authentication
auth:
  # Set via environment or store encrypted
  anthropic_api_key: "${ANTHROPIC_API_KEY}"
  supabase_access_token: "${SUPABASE_ACCESS_TOKEN}"

# Behavior
behavior:
  auto_commit: true
  commit_after_each_test: true
  pause_on_regression: true
  max_sessions_per_run: 50  # Safety limit

# MCP Servers
mcp:
  playwright: true   # Browser automation (headless)
  supabase: true     # Database introspection
```

### Project Config (`[PROJECT]/.autonomous/config.yaml`)

```yaml
# Project-specific settings
project:
  name: "NexusERP"
  type: "brownfield"

# Schema location
schema:
  directory: ".schema/"

# Conventions
conventions:
  file: "CLAUDE.md"

# Supabase project (for MCP)
supabase:
  project_id: "your-project-id"  # Auto-detected if not set

# Git worktree settings
worktrees:
  directory: ".worktrees/"       # Where worktrees are created
  branch_prefix: "autonomous/"   # Branch naming: autonomous/o2c, autonomous/p2p
```

### Workflow Config (`[PROJECT]/.autonomous/workflows/o2c.yaml`)

```yaml
# Workflow-specific settings
workflow:
  id: "o2c"
  name: "Order to Cash Module"
  created_at: "2025-01-15T10:00:00Z"
  status: "in_progress"  # pending | in_progress | paused | completed

# Worktree location
worktree:
  path: ".worktrees/o2c"
  branch: "autonomous/o2c"

# Spec reference
spec:
  source: "docs/FULL_SPEC_O2C.md"  # Original spec file (for reference)
  # Actual spec copied to .worktrees/o2c/.autonomous-workflow/app_spec.txt

# Progress tracking
progress:
  total_tests: 185
  passing_tests: 47
  current_session: 12
  last_activity: "2025-01-15T14:30:00Z"

# Resume behavior
resume:
  mode: "retry"  # retry | skip | ask
  last_test_id: 48
  last_test_status: "in_progress"
```

---

## 8. Error Handling

### Schema Validation Failures

```
┌─────────────────────────────────────────────────────────────────┐
│  ⚠️ Schema Discrepancies Found                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  3 issues found in schema validation:                           │
│                                                                  │
│  1. Table 'audit_logs' exists in DB but not in docs            │
│  2. Column 'users.middle_name' missing from docs                │
│  3. Column 'invoices.legacy_id' in docs but not in DB          │
│                                                                  │
│  [ ] Auto-update documentation                                  │
│  [ ] I'll fix manually                                          │
│                                                                  │
│                              [Cancel]  [Continue Anyway]        │
└─────────────────────────────────────────────────────────────────┘
```

### Regression Detected

```
┌─────────────────────────────────────────────────────────────────┐
│  ❌ Regression Detected                                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Test that was passing now fails:                               │
│                                                                  │
│  [Security] Protected routes require authentication             │
│                                                                  │
│  Expected: Redirect to /login                                   │
│  Actual: 500 Server Error                                       │
│                                                                  │
│  Process paused. Options:                                       │
│                                                                  │
│  [View Output]  [Resume (Agent Will Fix)]  [Stop & Investigate] │
└─────────────────────────────────────────────────────────────────┘
```

### Session Failure

```
┌─────────────────────────────────────────────────────────────────┐
│  ⚠️ Session Failed                                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Session #12 ended with error:                                  │
│                                                                  │
│  "Max turns (1000) exceeded without completing test"            │
│                                                                  │
│  Progress saved at: 47/185 tests                                │
│  Last successful commit: feat: [Test 46] ...                    │
│                                                                  │
│  [View Full Log]  [Retry Test]  [Skip Test]  [Stop]             │
└─────────────────────────────────────────────────────────────────┘
```

---

## 9. Implementation Phases

### Phase 1: Core Infrastructure
1. Venv management (create, activate, install)
2. Python orchestrator integration
3. Basic UI (project select, start/stop)
4. Progress file watching

### Phase 2: Brownfield Adaptations
1. Schema validation phase
2. Brownfield prompts (initializer + coding)
3. Supabase MCP integration
4. Chrome DevTools MCP integration

### Phase 3: UI Polish
1. Full progress panel
2. Output viewer
3. Configuration UI
4. Error handling dialogs

### Phase 4: Enhancements
1. Cost tracking
2. Session history
3. Test filtering/search
4. Manual test marking

---

## 10. File Manifest

### Files to Create/Modify in Orchestrator

| File | Status | Description |
|------|--------|-------------|
| `client.py` | Modify | Add Supabase MCP, swap Playwright for Chrome DevTools |
| `prompts/schema_validation_prompt.md` | Create | New Phase 0 prompt |
| `prompts/initializer_prompt_brownfield.md` | Create | Brownfield test generation |
| `prompts/coding_prompt_brownfield.md` | Create | Brownfield implementation |
| `agent.py` | Modify | Add schema validation phase, brownfield mode flag |
| `config.py` | Create | Configuration management |

### Files to Create in Electron App

| File | Description |
|------|-------------|
| `main/services/venv-manager.ts` | Python venv management |
| `main/services/orchestrator-runner.ts` | Spawn/monitor Python process |
| `main/services/progress-watcher.ts` | Watch feature_list.json for changes |
| `main/services/worktree-manager.ts` | Git worktree create/list/delete |
| `main/services/workflow-manager.ts` | Workflow CRUD and state |
| `main/services/schema-validator.ts` | Trigger schema validation phase |
| `renderer/components/ProjectSelector.tsx` | Project selection UI |
| `renderer/components/WorkflowList.tsx` | List workflows with status |
| `renderer/components/WorkflowCreate.tsx` | New workflow dialog |
| `renderer/components/SpecEditor.tsx` | Spec input/import UI |
| `renderer/components/ProgressPanel.tsx` | Test completion display |
| `renderer/components/OutputViewer.tsx` | Agent output log |
| `renderer/stores/autonomous-store.ts` | State management |

---

## 11. Resolved Design Decisions

| Question | Decision | Rationale |
|----------|----------|-----------|
| **Browser Automation** | Playwright MCP | Proven, works headless, same as original autonomous-coding |
| **Supabase Project ID** | Auto-detect, prompt if fails | Check config.yaml → config.toml → .env → ask user |
| **Cost Tracking** | Not needed | User on Max plan with OAuth token |
| **Multiple Workflows** | Yes, via git worktrees | Each workflow gets isolated branch and worktree |
| **Resume Behavior** | Retry the test | Safer - don't leave broken code from partial implementation |

---

## 12. Success Criteria

The system is complete when:

1. [ ] User can select an existing project with `.schema/` docs
2. [ ] Schema validation runs automatically and reports discrepancies
3. [ ] User can create multiple workflows per project
4. [ ] Each workflow gets its own git worktree and branch
5. [ ] User can input spec (text or import file) per workflow
6. [ ] Test generation creates appropriate number of tests for complexity
7. [ ] Implementation sessions run autonomously in the worktree
8. [ ] Progress is displayed in real-time per workflow
9. [ ] Regressions are detected and handled
10. [ ] All infrastructure (venv, Python, MCP) is managed by app
11. [ ] Process can be paused/resumed cleanly (retry mode)
12. [ ] Commits are made after each passing test
13. [ ] Supabase project ID is auto-detected or prompted
14. [ ] Workflows can run concurrently (different worktrees)

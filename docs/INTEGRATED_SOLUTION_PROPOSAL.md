# Integrated Autonomous Coding Solution

> Combining the best of autonomous-coding + automaker + your claude-code-manager
> into a seamless, user-friendly experience.

---

## What You Want (Summary)

1. **App handles everything** - No worrying about Python, venv, execution
2. **Focus on spec creation** - Proper interactive workflow to create detailed specs
3. **Brownfield support** - New features only, respect existing codebase
4. **Auto-detected complexity** - Test count based on project analysis
5. **Proven format** - `feature_list.json` (autonomous-coding pattern)
6. **Shared infrastructure** - `~/.autonomous-coding/venv/` reused across projects

---

## Two Systems Analyzed

### autonomous-coding (Python)
```
✓ Proven two-agent pattern (initializer + coding)
✓ Comprehensive test generation (150-400)
✓ 20 mandatory test categories
✓ Browser-based verification
✓ External orchestrator (survives compaction)

✗ CLI only - no visual interface
✗ Static spec file - no interactive creation
✗ Greenfield focused - no brownfield support
✗ Manual venv setup per project
```

### automaker (Electron)
```
✓ Visual Kanban board
✓ Spec generation from overview
✓ Feature suggestions
✓ Real-time agent output
✓ Session management
✓ Survives Next.js restarts

✗ Only 20-100 features (not comprehensive tests)
✗ No dependency-aware test categories
✗ No brownfield adaptation
✗ Simple spec generation (not detailed workflow)
```

---

## Proposed Integrated Solution

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      CLAUDE CODE MANAGER v2                                  │
│                    (Your Existing App - Extended)                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                        SPEC CREATION WIZARD                             │ │
│  │  Phase 1: Project Context                                               │ │
│  │     • Select project (new or existing)                                  │ │
│  │     • Auto-detect: schema, conventions, existing features               │ │
│  │     • Complexity assessment → test count recommendation                 │ │
│  │                                                                         │ │
│  │  Phase 2: Detailed Spec Chat                                            │ │
│  │     • Interactive multi-turn conversation                               │ │
│  │     • Guided questions (like create-spec.md but better)                 │ │
│  │     • Reference existing schema, code patterns                          │ │
│  │     • Edge case exploration                                             │ │
│  │     • Generates comprehensive spec document                             │ │
│  │                                                                         │ │
│  │  Phase 3: Test Generation                                               │ │
│  │     • Generate feature_list.json from spec                              │ │
│  │     • 20 mandatory categories                                           │ │
│  │     • Brownfield-aware (skip existing functionality)                    │ │
│  │     • Review and approve before proceeding                              │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                    │                                         │
│                                    ▼                                         │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                      AUTONOMOUS EXECUTION ENGINE                        │ │
│  │                                                                         │ │
│  │  • Manages Python venv automatically (~/.autonomous-coding/venv/)       │ │
│  │  • Runs autonomous-coding pattern (initializer + coding agents)         │ │
│  │  • Injects brownfield context (schema, conventions)                     │ │
│  │  • Streams progress to UI                                               │ │
│  │  • Human checkpoints for review                                         │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                    │                                         │ │
│                                    ▼                                         │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                        PROGRESS DASHBOARD                               │ │
│  │                                                                         │ │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐        │ │
│  │  │  Tests: 45/200  │  │  Current:       │  │  Session: #7    │        │ │
│  │  │  ████████░░░░░  │  │  Auth Login     │  │  Runtime: 2h    │        │ │
│  │  │  22.5%          │  │  ● Running      │  │  Commits: 12    │        │ │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────┘        │ │
│  │                                                                         │ │
│  │  Recent Activity:                                                       │ │
│  │  ✓ [Auth] User can log in with valid credentials                       │ │
│  │  ✓ [Auth] Invalid login shows error message                            │ │
│  │  ● [Auth] Password reset flow... (in progress)                         │ │
│  │                                                                         │ │
│  │  [▶ Resume] [⏸ Pause] [⏹ Stop] [View Logs] [View Code]                │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Detailed Spec Creation Workflow

This is the key differentiator - a proper interactive workflow for creating detailed specs.

### Phase 1: Project Context

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  SPEC CREATION - Phase 1: Project Context                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Project Selection                                                           │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │  ○ New Project                                                          │ │
│  │  ● Existing Project: NexusERP                                          │ │
│  │    Path: C:\claude_projects\erp                                         │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  Auto-Detected Context                                          [Analyzing] │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │  ✓ Schema Documentation: .schema/ (15 files)                           │ │
│  │  ✓ Conventions: CLAUDE.md found                                        │ │
│  │  ✓ Database: Supabase (PostgreSQL)                                     │ │
│  │  ✓ Framework: Next.js 14 (App Router)                                  │ │
│  │  ✓ Existing Modules: GL, Workflows, AR, P2P                            │ │
│  │                                                                         │ │
│  │  Complexity Assessment: COMPLEX                                         │ │
│  │  Recommended Test Count: 400+ tests                                     │ │
│  │  Reason: Multi-tenant, financial transactions, compliance               │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│                                                   [Continue to Spec Chat →] │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Phase 2: Detailed Spec Chat (The Core Innovation)

Instead of a simple text area, this is a **guided multi-turn conversation** that ensures comprehensive spec coverage.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  SPEC CREATION - Phase 2: Detailed Specification                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Progress: ████████░░░░░░░░░░░░ 40%                                         │
│  Sections: Overview ✓ | Users ✓ | Core Features ● | Edge Cases ○ | ...     │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │  ASSISTANT                                                              │ │
│  │  ─────────────────────────────────────────────────────────────────────  │ │
│  │  Based on your project context, I see you have an existing ERP system   │ │
│  │  with GL, Workflows, AR, and P2P modules. You mentioned building the    │ │
│  │  full O2C (Order-to-Cash) process.                                      │ │
│  │                                                                         │ │
│  │  Let's work through the O2C specification systematically.               │ │
│  │                                                                         │ │
│  │  **CORE FEATURES: Customer Management**                                 │ │
│  │                                                                         │ │
│  │  1. What customer data needs to be captured?                            │ │
│  │     □ Basic info (name, contact, address)                               │ │
│  │     □ Credit terms and limits                                           │ │
│  │     □ Payment terms (30/60/90 days)                                     │ │
│  │     □ Tax registration (VAT numbers)                                    │ │
│  │     □ Bank details                                                      │ │
│  │     □ Multiple contacts per customer                                    │ │
│  │     □ Other: _______________                                            │ │
│  │                                                                         │ │
│  │  2. How do customers relate to existing modules?                        │ │
│  │     I see you have AR Aging. Should customers link to:                  │ │
│  │     ○ New customer table (O2C owns customer master)                     │ │
│  │     ○ Existing GL accounts (customers as account types)                 │ │
│  │     ○ Hybrid: Customer master + GL integration                          │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │  YOUR RESPONSE                                                          │ │
│  │  ─────────────────────────────────────────────────────────────────────  │ │
│  │  All of the above for customer data. For the relationship, we need      │ │
│  │  hybrid - customer master with automatic GL integration. Each customer  │ │
│  │  should auto-create a debtor control account in the AR subledger.       │ │
│  │                                                                         │ │
│  │  Also important: customers need B-BBEE compliance tracking since        │ │
│  │  this is for South African businesses.                                  │ │
│  │                                                                         │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  [← Back] [Save Draft]                                         [Continue →] │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Guided Question Categories

The spec chat covers ALL of these systematically:

```
SPEC CHAT SECTIONS (Guided Order)
═══════════════════════════════════

1. PROJECT OVERVIEW
   • What are you building? (high-level)
   • Who uses it? (user types/roles)
   • What problem does it solve?

2. EXISTING CONTEXT (Brownfield)
   • What already exists?
   • What integrations are needed?
   • What must NOT change?

3. USER MANAGEMENT
   • User types and roles
   • Permissions matrix
   • Authentication requirements

4. CORE FEATURES (Main Loop)
   For each feature area:
   • What data is involved?
   • What operations are needed?
   • What workflows exist?
   • How does it integrate?

5. DATA MODEL
   • Entities and relationships
   • Validation rules
   • Cascade/deletion rules

6. BUSINESS RULES
   • Calculations and formulas
   • Approval workflows
   • Status transitions
   • Compliance requirements

7. EDGE CASES (Critical!)
   • What happens when X fails?
   • Concurrent access scenarios
   • Large data scenarios
   • Error recovery

8. INTEGRATIONS
   • External systems
   • Import/Export
   • APIs

9. UI/UX REQUIREMENTS
   • Key screens
   • Navigation flow
   • Design system adherence

10. SECURITY
    • RLS requirements
    • Audit logging
    • Sensitive data handling

11. COMPLIANCE
    • Regulatory requirements
    • Reporting needs
    • Data retention
```

### Phase 3: Test Generation

After spec is complete, generate comprehensive tests:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  SPEC CREATION - Phase 3: Test Generation                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Generating tests from specification...                                      │
│                                                                              │
│  Complexity: COMPLEX                                                         │
│  Target: 400+ tests across 20 categories                                     │
│                                                                              │
│  Category Distribution:                                                      │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │  A. Security & Access Control          40 tests  ████████████████      │ │
│  │  B. Navigation Integrity               40 tests  ████████████████      │ │
│  │  C. Real Data Verification             50 tests  ████████████████████  │ │
│  │  D. Workflow Completeness              40 tests  ████████████████      │ │
│  │  E. Error Handling                     25 tests  ██████████            │ │
│  │  F. UI-Backend Integration             35 tests  ██████████████        │ │
│  │  G. State & Persistence                15 tests  ██████                │ │
│  │  H. URL & Direct Access                20 tests  ████████              │ │
│  │  I. Double-Action & Idempotency        15 tests  ██████                │ │
│  │  J. Data Cleanup & Cascade             20 tests  ████████              │ │
│  │  K. Default & Reset                    12 tests  █████                 │ │
│  │  L. Search & Filter Edge Cases         20 tests  ████████              │ │
│  │  M. Form Validation                    25 tests  ██████████            │ │
│  │  N. Feedback & Notification            15 tests  ██████                │ │
│  │  O. Responsive & Layout                15 tests  ██████                │ │
│  │  P. Accessibility                      15 tests  ██████                │ │
│  │  Q. Temporal & Timezone                12 tests  █████                 │ │
│  │  R. Concurrency & Race Conditions      15 tests  ██████                │ │
│  │  S. Export/Import                      10 tests  ████                  │ │
│  │  T. Performance                        10 tests  ████                  │ │
│  │  ─────────────────────────────────────────────────────────────────     │ │
│  │  TOTAL                                424 tests                        │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  [View Full Test List] [Edit Categories] [Regenerate]                        │
│                                                                              │
│                                                        [Start Implementation →] │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Automatic Infrastructure Management

The app handles ALL Python/venv complexity:

### First-Time Setup (Automatic)

```typescript
// In Electron main process
class AutonomousEngine {
  private venvPath = path.join(os.homedir(), '.autonomous-coding', 'venv');

  async ensureEnvironment(): Promise<void> {
    // 1. Check if venv exists
    if (!await this.venvExists()) {
      await this.createVenv();
    }

    // 2. Check/install dependencies
    await this.ensureDependencies();

    // 3. Copy/update agent scripts
    await this.syncAgentScripts();
  }

  private async createVenv(): Promise<void> {
    // Show UI: "Setting up autonomous coding environment..."
    this.events.emit('setup:progress', 'Creating Python environment...');

    // Windows: python -m venv path
    await execPromise(`python -m venv "${this.venvPath}"`);

    // Install dependencies
    const pip = path.join(this.venvPath, 'Scripts', 'pip.exe');
    await execPromise(`"${pip}" install claude-code-sdk python-dotenv`);

    this.events.emit('setup:complete', 'Environment ready!');
  }
}
```

### Running Autonomous Agent (Hidden Complexity)

```typescript
async runAutonomousAgent(projectPath: string, config: AgentConfig): Promise<void> {
  // User sees: "Starting implementation..." with nice UI
  // Behind the scenes:

  // 1. Ensure environment ready
  await this.ensureEnvironment();

  // 2. Activate venv and run
  const python = path.join(this.venvPath, 'Scripts', 'python.exe');
  const agentScript = path.join(this.venvPath, 'autonomous-agent', 'agent.py');

  // 3. Build command with all necessary args
  const args = [
    agentScript,
    '--project-dir', projectPath,
    '--model', config.model || 'claude-sonnet-4-5-20250929',
    '--brownfield',  // Our addition
    '--schema-dir', path.join(projectPath, '.schema'),
    '--conventions', path.join(projectPath, 'CLAUDE.md'),
  ];

  // 4. Spawn process, stream output to UI
  const process = spawn(python, args, {
    cwd: projectPath,
    env: { ...process.env, ANTHROPIC_API_KEY: config.apiKey }
  });

  process.stdout.on('data', (data) => {
    this.events.emit('agent:output', data.toString());
  });
}
```

---

## User Experience Flow

### Starting a New Spec

1. **Open app** → See project list
2. **Select project** → Click "Create New Spec" or "Start Autonomous"
3. **Context analysis** → App auto-detects schema, conventions, complexity
4. **Spec chat** → Guided conversation (10-30 minutes of quality input)
5. **Review spec** → Edit if needed
6. **Generate tests** → Review test distribution
7. **Start** → Click "Begin Implementation"
8. **Monitor** → Watch progress dashboard
9. **Review** → Periodic human checkpoints
10. **Complete** → All tests pass, merge code

### Resuming Work

1. **Open app** → See active workflows
2. **Select workflow** → "O2C Module - 45/424 tests passing"
3. **Resume** → Click "Continue"
4. **App handles everything** → Python, venv, context injection

---

## Key Files to Create

### In claude-code-manager

```
src/main/
├── services/
│   ├── autonomous-engine.ts     # Python/venv management
│   ├── spec-wizard.ts           # Spec creation chat logic
│   ├── test-generator.ts        # Generate feature_list.json
│   └── progress-tracker.ts      # Track test completion
│
├── prompts/
│   ├── spec-chat/               # Guided spec questions
│   │   ├── 01-overview.md
│   │   ├── 02-existing-context.md
│   │   ├── 03-user-management.md
│   │   ├── ...
│   │   └── 11-compliance.md
│   │
│   ├── brownfield/              # Brownfield adaptations
│   │   ├── context-injection.md
│   │   ├── schema-validation.md
│   │   └── convention-adherence.md
│   │
│   └── agents/                  # Agent prompts (adapted from autonomous-coding)
│       ├── initializer.md
│       └── coding.md

src/renderer/
├── views/
│   ├── spec-wizard/             # Spec creation UI
│   │   ├── ContextStep.tsx
│   │   ├── SpecChatStep.tsx
│   │   ├── TestGenerationStep.tsx
│   │   └── ReviewStep.tsx
│   │
│   └── autonomous-dashboard/    # Progress monitoring UI
│       ├── Dashboard.tsx
│       ├── TestProgress.tsx
│       └── AgentOutput.tsx
```

### In shared location (~/.autonomous-coding/)

```
~/.autonomous-coding/
├── venv/                        # Python virtual environment
│   ├── Scripts/                 # Windows
│   │   ├── python.exe
│   │   └── pip.exe
│   └── Lib/
│       └── site-packages/
│           └── claude_code_sdk/
│
├── agents/                      # Agent scripts (synced from app)
│   ├── agent.py
│   ├── client.py
│   ├── security.py
│   └── prompts/
│
└── config.json                  # Global configuration
```

---

## Next Steps

1. **Design spec chat flow** - Define all questions and logic
2. **Build autonomous engine** - Python/venv management
3. **Adapt agent prompts** - Brownfield support
4. **Build UI components** - Spec wizard + dashboard
5. **Test with NexusERP O2C** - Real-world validation

---

## Questions for You

1. **Spec chat detail level**: How long should the spec conversation be?
   - Quick: 5-10 questions, ~10 minutes
   - Thorough: 30-50 questions, ~30 minutes
   - Comprehensive: 100+ questions, ~1 hour

2. **Test review granularity**: Before starting implementation:
   - A) Just show summary (424 tests, category breakdown)
   - B) Show all test titles (scrollable list)
   - C) Allow editing individual tests

3. **Progress monitoring**: During implementation:
   - A) Simple progress bar + current test
   - B) Full agent output streaming
   - C) Both with toggle

4. **Human checkpoints**: When should the agent pause for review?
   - A) Every N tests (e.g., every 10)
   - B) At phase boundaries (e.g., after all auth tests)
   - C) On errors only
   - D) Configurable

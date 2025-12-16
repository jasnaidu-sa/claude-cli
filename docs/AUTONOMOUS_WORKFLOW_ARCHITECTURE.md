# Autonomous Workflow Architecture

> Extending Claude Code Manager to support long-running autonomous coding workflows.
> This document captures the design decisions and architecture for integrating autonomous coding capabilities.

## Problem Statement

Claude Code sessions lose context after compaction, making long-running implementation tasks unreliable. Existing solutions (CLAUDE.md, hooks, checkpoint files) fail to reliably TRIGGER action after compaction - they only persist STATE.

**The fundamental insight**: There are TWO problems:
1. **STATE** - Where is the work, what's done, what's next? (Beads/JSON solve this)
2. **TRIGGER** - What makes Claude ACT on that state after compaction? (Only external orchestration solves this)

## Solution: External Orchestration via Claude Code Manager

Instead of a standalone Python script, extend the existing Claude Code Manager Electron app to:
1. Provide interactive spec generation via chat
2. Manage project selection/creation
3. Orchestrate autonomous agent sessions
4. Monitor progress with visual dashboard
5. Sync with GitHub Issues

---

## Architecture Overview

### Current vs Proposed

```
CURRENT (Manual Sessions)              PROPOSED (+ Autonomous Workflows)
┌─────────────────────────┐           ┌─────────────────────────────────┐
│ SessionManager          │           │ SessionManager (existing)       │
│ • Manual PTY sessions   │           │ WorkflowManager (NEW)           │
│ • User types commands   │           │ • Orchestrates agent sessions   │
│                         │           │ • Never loses context           │
│ FileWatcher             │           │ • Manages issue graph           │
│ ConfigStore             │           │                                 │
└─────────────────────────┘           │ SpecGenerator (NEW)             │
                                      │ • Chat → structured spec        │
                                      │                                 │
                                      │ BeadsService (NEW)              │
                                      │ • Issue tracking with deps      │
                                      │                                 │
                                      │ AgentRunner (NEW)               │
                                      │ • Automated Claude Code input   │
                                      └─────────────────────────────────┘
```

### Full Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        CLAUDE CODE MANAGER v2                                │
│                  (Manual Sessions + Autonomous Workflows)                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                         NAVIGATION MODES                             │    │
│  │    [Sessions]    [Workflows]    [Projects]    [Settings]            │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  SESSIONS VIEW (Existing)          WORKFLOWS VIEW (New)                      │
│  ┌───────────────────────┐        ┌─────────────────────────────────────┐   │
│  │ Manual Claude Code    │        │  ┌─────────────────────────────┐    │   │
│  │ sessions (as-is)      │        │  │      SPEC CHAT              │    │   │
│  │                       │        │  │  "What do you want to build?"│   │   │
│  │ [+ New Session]       │        │  │  → Clarifying questions      │   │   │
│  │                       │        │  │  → Generates spec.json       │   │   │
│  └───────────────────────┘        │  └─────────────────────────────┘    │   │
│                                   │                                      │   │
│                                   │  ┌─────────────────────────────┐    │   │
│                                   │  │      ISSUE GRAPH            │    │   │
│                                   │  │  ● Complete (15)            │    │   │
│                                   │  │  ◐ In Progress (1)          │    │   │
│                                   │  │  ○ Ready (3)                │    │   │
│                                   │  │  ◌ Blocked (12)             │    │   │
│                                   │  └─────────────────────────────┘    │   │
│                                   │                                      │   │
│                                   │  ┌─────────────────────────────┐    │   │
│                                   │  │      AGENT ACTIVITY         │    │   │
│                                   │  │  [Planning Agent] ✓ Done    │    │   │
│                                   │  │  [Impl Agent #7] ● Running  │    │   │
│                                   │  │  [Review] ○ Pending @10     │    │   │
│                                   │  └─────────────────────────────┘    │   │
│                                   │                                      │   │
│                                   │  [▶ Start] [⏸ Pause] [⏹ Stop]       │   │
│                                   └─────────────────────────────────────┘   │
│                                                                              │
│  PROJECTS VIEW (New)                                                         │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  Recent Projects          Workflows                                   │   │
│  │  ┌────────────────┐      ┌────────────────────────────────────────┐  │   │
│  │  │ NexusERP       │──────│ O2C Module: 15/31 issues complete      │  │   │
│  │  │ C:\claude_...  │      │ Cash Flow: Not started                 │  │   │
│  │  └────────────────┘      └────────────────────────────────────────┘  │   │
│  │  ┌────────────────┐                                                   │   │
│  │  │ MyOtherProject │      No workflows                                │   │
│  │  └────────────────┘                                                   │   │
│  │                                                                       │   │
│  │  [+ New Project]  [Import Existing]                                   │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Multi-Agent Architecture

### Agent Types

| Agent | Purpose | Frequency | Model |
|-------|---------|-----------|-------|
| **Schema Validator** | Ensure .schema/ docs match actual database | Once per workflow | Sonnet |
| **Planning** | Generate full issue graph from spec | Once per spec | Opus (deep reasoning) |
| **Implementation** | Implement + test each issue | Many times | Sonnet (cost/capability) |
| **Reviewer** | Quality gate, catch drift | Every 5-10 issues | Opus (catches subtle issues) |

### Agent Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                      ORCHESTRATOR (Electron Main Process)        │
│                    Never compacts, manages flow                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │   AGENT 0    │  │   AGENT 1    │  │   AGENT 2    │           │
│  │   Schema     │→ │   Planning   │→ │   Implement  │ ←──┐      │
│  │   Validator  │  │   (once)     │  │   (loops)    │    │      │
│  └──────────────┘  └──────────────┘  └──────────────┘    │      │
│         │                 │                │              │      │
│         ▼                 ▼                ▼              │      │
│  ┌──────────────────────────────────────────────────┐    │      │
│  │                     BEADS                         │    │      │
│  │  .beads/issues.jsonl  |  bd ready  |  bd done    │    │      │
│  └──────────────────────────────────────────────────┘    │      │
│                                                          │      │
│  ┌──────────────┐                                        │      │
│  │   AGENT 3    │  Runs after N implementations ─────────┘      │
│  │   Reviewer   │  or at phase completion                       │
│  │   (periodic) │                                               │
│  └──────────────┘                                               │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Workflow State Machine

```
                    ┌─────────────────────────────────────────────────────┐
                    │                                                     │
                    ▼                                                     │
┌────────┐    ┌─────────────┐    ┌──────────┐    ┌─────────────────┐     │
│  IDLE  │───►│ SPEC_CHAT   │───►│ PLANNING │───►│ IMPLEMENTING    │─────┤
└────────┘    └─────────────┘    └──────────┘    └─────────────────┘     │
                    │                  │                │                 │
                    ▼                  ▼                ▼                 │
              ┌───────────┐     ┌───────────┐    ┌─────────────┐         │
              │ USER      │     │ USER      │    │ REVIEW      │─────────┤
              │ REFINES   │     │ APPROVES  │    │ CHECKPOINT  │         │
              └───────────┘     │ GRAPH     │    └─────────────┘         │
                    │           └───────────┘          │                 │
                    └───────────────┬──────────────────┘                 │
                                    ▼                                    │
                              ┌───────────┐                              │
                              │ PAUSED    │──────────────────────────────┤
                              │ (Human    │                              │
                              │ Checkpoint│                              │
                              └───────────┘                              │
                                    │                                    │
                                    ▼                                    │
                              ┌───────────┐                              │
                              │ COMPLETED │◄─────────────────────────────┘
                              └───────────┘
```

---

## New Services (Main Process)

### Directory Structure

```
src/main/services/
├── session-manager.ts      # Existing - manual PTY sessions
├── config-store.ts         # Existing - app settings
├── file-watcher.ts         # Existing - FS events
│
├── workflow-manager.ts     # NEW - Autonomous workflow orchestration
├── spec-generator.ts       # NEW - Chat-to-spec conversion
├── beads-service.ts        # NEW - Beads issue management
├── agent-runner.ts         # NEW - Claude Code session automation
├── github-sync.ts          # NEW - GitHub Issues bidirectional sync
└── project-store.ts        # NEW - Project registry and config
```

### WorkflowManager

```typescript
export class WorkflowManager extends EventEmitter {
  private beads: BeadsService
  private agentRunner: AgentRunner

  async startWorkflow(projectPath: string, spec: SpecDocument): Promise<Workflow> {
    // 1. Schema validation phase
    await this.runSchemaValidator(projectPath)

    // 2. Planning phase - generates issue graph
    const issues = await this.runPlanningAgent(spec)
    await this.beads.createIssues(issues)

    // 3. Implementation loop
    this.emit('workflow:started')
    this.runImplementationLoop()
  }

  private async runImplementationLoop() {
    while (true) {
      const readyIssues = await this.beads.getReady()
      if (readyIssues.length === 0) break

      const current = readyIssues[0]
      this.emit('issue:started', current)

      const result = await this.agentRunner.implement(current)

      if (result.success) {
        await this.beads.markDone(current.id)
        this.emit('issue:completed', current)

        if (this.shouldReview()) {
          await this.runReviewAgent()
        }
      } else {
        this.emit('issue:failed', current, result.error)
        this.pause() // Human checkpoint
      }
    }
  }
}
```

### AgentRunner

```typescript
export class AgentRunner {
  private sessionManager: SessionManager

  async implement(issue: BeadsIssue): Promise<AgentResult> {
    const prompt = await this.buildImplementationPrompt(issue)
    const session = await this.sessionManager.create(this.projectPath)

    await this.sendPrompt(session.id, prompt)
    return this.waitForCompletion(session.id)
  }
}
```

---

## Data Structures

### SpecDocument

```typescript
interface SpecDocument {
  name: string
  description: string
  modules: SpecModule[]
  dependencies: Dependency[]
  constraints: string[]
  testingStrategy: string
}

interface SpecModule {
  name: string
  description: string
  priority: number
  dependsOn: string[]
  features: SpecFeature[]
}

interface SpecFeature {
  name: string
  description: string
  acceptanceCriteria: string[]
  testCases: string[]
}
```

### BeadsIssue

```typescript
interface BeadsIssue {
  id: string
  title: string
  description: string
  module: string
  type: 'database' | 'api' | 'ui' | 'integration' | 'test'
  priority: number
  blockedBy: string[]
  blocks: string[]
  status: 'pending' | 'ready' | 'in_progress' | 'done' | 'failed'
  acceptanceCriteria: string[]
  metadata: {
    estimatedComplexity: 'low' | 'medium' | 'high'
    schemaFiles: string[]
    relatedFiles: string[]
  }
}
```

### Workflow

```typescript
interface Workflow {
  id: string
  projectPath: string
  name: string
  spec: SpecDocument
  status: WorkflowStatus
  progress: {
    total: number
    completed: number
    failed: number
    inProgress: number
  }
  currentIssue: string | null
  createdAt: number
  updatedAt: number
}

type WorkflowStatus =
  | 'idle'
  | 'spec_chat'
  | 'planning'
  | 'implementing'
  | 'reviewing'
  | 'paused'
  | 'completed'
  | 'failed'
```

---

## Project Configuration

### autonomous.yaml

```yaml
project:
  name: "NexusERP"
  type: "brownfield"  # or "greenfield"

schema:
  directory: ".schema/"
  database_introspection: "supabase"
  validation_mode: "strict"

conventions:
  file: "CLAUDE.md"
  design_system: "tailwind-semantic"
  test_framework: "vitest"

specs:
  directory: "docs/specs/"
  current: "FULL_SPEC_O2C.md"

tracking:
  beads: true
  github_issues: true
  github_repo: "owner/repo"
  context_dir: ".claude-context/"

models:
  schema_validator: "claude-sonnet-4-20250514"
  planning: "claude-opus-4-20250514"
  implementation: "claude-sonnet-4-20250514"
  reviewer: "claude-opus-4-20250514"

review:
  frequency: 5  # Review every N completed issues

verification:
  typecheck: true
  lint: true
  tests: true
  test_command: "npm run test"
```

---

## Design Decisions

### 1. Issue Granularity: Feature-Level

Each issue represents a complete feature unit:
- Database schema + API + UI as needed
- Self-contained, testable
- ~20-40 issues per major module
- Session duration: 15-45 minutes

### 2. Verification: Tests

Each implementation session must:
- Run existing tests (no regressions)
- Add tests for new functionality
- Pass typecheck and lint
- Clear pass/fail signal for automation

### 3. Progress Tracking: Beads + GitHub Issues

- Beads for dependency-aware local tracking
- GitHub Issues for team visibility
- Bidirectional sync keeps both in sync

### 4. Planning: Full Graph Upfront

- Planning Agent generates complete issue graph from spec
- Human reviews and approves before implementation starts
- Enables accurate progress tracking and dependency management

---

## Cost Estimates

### Per Module (30 issues)

| Phase | Sessions | Model | Est. Cost |
|-------|----------|-------|-----------|
| Schema Validation | 1 | Sonnet | ~$0.50 |
| Planning | 1 | Opus | ~$5.00 |
| Implementation | 30 | Sonnet | ~$15.00 |
| Review (3x) | 3 | Opus | ~$15.00 |
| **Total** | 35 | - | **~$35-40** |

---

## Open Questions

1. **Spec Chat Model**: Claude API directly vs Claude Code session?
2. **Beads Integration**: CLI commands vs native JSONL vs SQLite?
3. **GitHub Sync**: Real-time vs one-way vs manual?
4. **Prompt Management**: Global vs project-specific vs hybrid?

---

## Related Documents

- [Prompt Management Strategy](./PROMPT_MANAGEMENT.md) - How prompts are organized and customized
- Original autonomous-coding repo: https://github.com/leonvanzyl/autonomous-coding
- Beads memory tool: https://github.com/steveyegge/beads

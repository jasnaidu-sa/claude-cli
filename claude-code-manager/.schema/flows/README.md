# Data Flows & System Diagrams

> Key workflows and data flows in Claude Code Manager.

---

## Core Workflows

### 1. Session Lifecycle

```
┌─────────────────────────────────────────────────────────────────┐
│  USER: Click "New Session"                                      │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  RENDERER: NewSessionModal → selectFolder()                     │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  IPC: session:create { projectPath }                            │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  MAIN: SessionManager.createSession()                           │
│  1. Spawn node-pty with Claude CLI                              │
│  2. Attach output listeners                                     │
│  3. Return session object                                       │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  RENDERER: session-store.addSession()                           │
│  SessionGrid renders new terminal                               │
└─────────────────────────────────────────────────────────────────┘

  ONGOING:
  ┌─────────────┐     session:output     ┌─────────────┐
  │  PTY Output │ ──────────────────────►│  xterm.js   │
  └─────────────┘                         └─────────────┘

  ┌─────────────┐     session:input      ┌─────────────┐
  │  User Type  │ ──────────────────────►│  PTY stdin  │
  └─────────────┘                         └─────────────┘
```

---

### 2. BVS Planning Flow

```
┌─────────────────────────────────────────────────────────────────┐
│  PHASE 1: EXPLORATION                                           │
│                                                                  │
│  User: "I want to add a budgeting feature"                      │
│       ↓                                                          │
│  Agent: Uses tools to explore codebase                          │
│       - list_files .schema/**/*                                  │
│       - read_file .schema/_index.md                              │
│       - read_file package.json                                   │
│       - search_code "budget" / "account"                         │
│       ↓                                                          │
│  Agent: Returns structured summary                               │
│       "Tech Stack: Next.js 14 + Supabase..."                     │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  PHASE 2: QUESTIONS                                              │
│                                                                  │
│  Agent outputs: ---QUESTIONS_START---                            │
│  [                                                               │
│    { id: "q1", category: "Scope", question: "...", options: [] }│
│  ]                                                               │
│  ---QUESTIONS_END---                                             │
│       ↓                                                          │
│  Frontend: Parses JSON, renders QuestionsPanel                   │
│       ↓                                                          │
│  User: Selects options (or types custom answer)                  │
│       ↓                                                          │
│  IPC: bvs:answer-questions { answers: { q1: "q1_a" } }          │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  PHASE 3: OPTIONS                                                │
│                                                                  │
│  Agent outputs: ---OPTIONS_START---                              │
│  [                                                               │
│    { id: "opt_a", name: "Full Implementation", ... }            │
│    { id: "opt_b", name: "Minimal MVP", ... }                    │
│  ]                                                               │
│  ---OPTIONS_END---                                               │
│       ↓                                                          │
│  User: Selects option                                            │
│       ↓                                                          │
│  IPC: bvs:select-option { optionId: "opt_a" }                   │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  PHASE 4: SECTIONS                                               │
│                                                                  │
│  Agent outputs: ---SECTIONS_START---                             │
│  [                                                               │
│    { id: "S1", name: "Database Schema", files: [...] }          │
│    { id: "S2", name: "API Endpoints", files: [...] }            │
│  ]                                                               │
│  ---SECTIONS_END---                                              │
│       ↓                                                          │
│  User: Reviews sections, clicks "Approve"                        │
│       ↓                                                          │
│  IPC: bvs:approve-plan                                           │
│       ↓                                                          │
│  Agent: Calls write_plan tool                                    │
│       ↓                                                          │
│  Output: .bvs/plan.md created                                    │
└─────────────────────────────────────────────────────────────────┘
```

---

### 3. Ralph Autonomous Workflow

```
┌─────────────────────────────────────────────────────────────────┐
│  STAGE 1: INITIATOR (Requirements Gathering)                     │
│                                                                  │
│  User opens Autonomous view, clicks "New Task"                   │
│       ↓                                                          │
│  IPC: initiator:start { projectPath }                            │
│       ↓                                                          │
│  Claude asks questions about:                                    │
│    - Objective                                                   │
│    - Scope & constraints                                         │
│    - Success criteria                                            │
│       ↓                                                          │
│  User answers conversationally                                   │
│       ↓                                                          │
│  IPC: initiator:summarize                                        │
│       ↓                                                          │
│  Output: RequirementsDoc                                         │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  STAGE 2: PROMPT GENERATION                                      │
│                                                                  │
│  IPC: initiator:generate-prompt                                  │
│       ↓                                                          │
│  Claude generates:                                               │
│    - Main prompt text                                            │
│    - Completion promise (how to know when done)                  │
│    - Max iterations                                              │
│    - Success indicators                                          │
│       ↓                                                          │
│  User reviews and edits prompt                                   │
│       ↓                                                          │
│  IPC: initiator:approve-prompt                                   │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  STAGE 3: EXECUTION                                              │
│                                                                  │
│  IPC: ralph:start { promptConfig, worktreePath? }                │
│       ↓                                                          │
│  Create git worktree (optional, for isolation)                   │
│       ↓                                                          │
│  Spawn Claude CLI with prompt                                    │
│       ↓                                                          │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │  ITERATION LOOP:                                         │    │
│  │    - Claude works on features                            │    │
│  │    - Runs tests, checks results                          │    │
│  │    - Updates progress                                    │    │
│  │    - Reaches checkpoint? → Emit event, wait for approval │    │
│  │    - Continue until done or max iterations               │    │
│  └─────────────────────────────────────────────────────────┘     │
│       ↓                                                          │
│  Output: Features completed, tests passing                       │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  STAGE 4: COMPLETION                                             │
│                                                                  │
│  If using worktree:                                              │
│    - Show diff vs main                                           │
│    - User reviews changes                                        │
│    - Merge to main branch                                        │
│                                                                  │
│  Final summary shown to user                                     │
└─────────────────────────────────────────────────────────────────┘
```

---

### 4. Ideas Kanban Flow

```
┌─────────────────────────────────────────────────────────────────┐
│  SOURCE: Outlook Email Sync                                      │
│                                                                  │
│  IPC: outlook:sync                                               │
│       ↓                                                          │
│  Fetch unread emails from configured address                     │
│       ↓                                                          │
│  For each email:                                                 │
│    - Extract URLs                                                │
│    - Fetch URL content (title, description, article)            │
│    - Claude generates summary                                    │
│    - Create Idea with stage: 'inbox'                            │
│       ↓                                                          │
│  IPC: outlook:sync-stream → emit ideas as created               │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  STAGE: INBOX → REVIEW                                           │
│                                                                  │
│  User drags idea to "Review" column                              │
│       ↓                                                          │
│  User clicks idea, opens discussion panel                        │
│       ↓                                                          │
│  IPC: ideas:discuss { ideaId, message }                          │
│       ↓                                                          │
│  Claude discusses the idea:                                      │
│    - Analyzes feasibility                                        │
│    - Suggests approaches                                         │
│    - Identifies greenfield vs brownfield                         │
│       ↓                                                          │
│  Conversation continues until user satisfied                     │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  STAGE: REVIEW → APPROVED → IN_PROGRESS                          │
│                                                                  │
│  User moves to "Approved"                                        │
│       ↓                                                          │
│  User clicks "Start Project"                                     │
│       ↓                                                          │
│  If brownfield: Link to existing project                         │
│  If greenfield: Create new project folder                        │
│       ↓                                                          │
│  Launch Ralph workflow with idea context                         │
│       ↓                                                          │
│  Stage changes to "In Progress"                                  │
│  workflowId linked to idea                                       │
└─────────────────────────────────────────────────────────────────┘
```

---

### 5. Git Worktree Flow

```
┌─────────────────────────────────────────────────────────────────┐
│  CREATE WORKTREE                                                 │
│                                                                  │
│  IPC: git:worktree-create { projectPath, branchName }            │
│       ↓                                                          │
│  git worktree add ../project-{branch} -b {branch}                │
│       ↓                                                          │
│  Return: { path: worktreePath, branch: branchName }              │
│       ↓                                                          │
│  Can now run Claude CLI in isolated worktree                     │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  MERGE WORKTREE                                                  │
│                                                                  │
│  IPC: git:worktree-diff { worktreePath }                         │
│       ↓                                                          │
│  Show diff to user for review                                    │
│       ↓                                                          │
│  IPC: git:worktree-merge { worktreePath, targetBranch: 'main' }  │
│       ↓                                                          │
│  git checkout main                                               │
│  git merge {worktree-branch}                                     │
│       ↓                                                          │
│  IPC: git:worktree-delete { worktreePath }                       │
│       ↓                                                          │
│  git worktree remove {worktreePath}                              │
└─────────────────────────────────────────────────────────────────┘
```

---

## Data Flow Diagrams

### Session Data Flow

```
┌─────────────┐    spawn     ┌─────────────┐
│ Main Process│ ────────────►│  Claude CLI │
│             │              │  (node-pty) │
└──────┬──────┘              └──────┬──────┘
       │                            │
       │ session:create             │ stdout
       │ session:input              │ stderr
       │                            │
       ▼                            ▼
┌─────────────┐    IPC       ┌─────────────┐
│  Renderer   │◄─────────────│   Session   │
│  (React)    │ output event │   Manager   │
└──────┬──────┘              └─────────────┘
       │
       ▼
┌─────────────┐
│  xterm.js   │
│  Terminal   │
└─────────────┘
```

### Agent SDK Flow

```
┌─────────────────────────────────────────────────────────────────┐
│  BVS Planning Agent                                              │
│                                                                  │
│  ┌──────────────┐                                                │
│  │ User Message │                                                │
│  └──────┬───────┘                                                │
│         │                                                        │
│         ▼                                                        │
│  ┌──────────────────────────────────────────────────────┐        │
│  │  sdk.query({ prompt: messageGenerator, options })     │       │
│  └──────────────────────────┬───────────────────────────┘        │
│                             │                                    │
│    ┌────────────────────────┼────────────────────────┐           │
│    │                        │                        │           │
│    ▼                        ▼                        ▼           │
│  ┌────────┐           ┌──────────┐            ┌──────────┐       │
│  │ stream │           │ tool_use │            │  result  │       │
│  │ _event │           │  message │            │  message │       │
│  └───┬────┘           └────┬─────┘            └────┬─────┘       │
│      │                     │                       │             │
│      ▼                     ▼                       ▼             │
│  ┌────────┐         ┌──────────────┐        ┌──────────┐         │
│  │ Append │         │ Execute tool │        │ Finalize │         │
│  │ to UI  │         │ (read_file,  │        │ response │         │
│  └────────┘         │  list_files) │        └──────────┘         │
│                     └──────────────┘                             │
└─────────────────────────────────────────────────────────────────┘
```

---

## Checkpoint Flow

```
┌─────────────────────────────────────────────────────────────────┐
│  During Ralph Execution                                          │
│                                                                  │
│  Feature processing...                                           │
│       ↓                                                          │
│  Check conditions:                                               │
│    - N consecutive failures? → failure_threshold checkpoint      │
│    - Category complete? → category_complete checkpoint           │
│    - Risky operation? → risk_boundary checkpoint                 │
│       ↓                                                          │
│  Create Checkpoint:                                              │
│    - Capture git state (commit SHA)                              │
│    - Capture test state (passing/failing)                        │
│    - List modified files                                         │
│       ↓                                                          │
│  IPC: ralph:checkpoint { type, context }                         │
│       ↓                                                          │
│  UI shows CheckpointModal                                        │
│       ↓                                                          │
│  User decides: Approve / Skip / Reject                           │
│       ↓                                                          │
│  If Reject:                                                      │
│    git reset --hard {lastGoodCommit}                             │
│       ↓                                                          │
│  Continue or stop execution                                      │
└─────────────────────────────────────────────────────────────────┘
```

---

## Event Flow Summary

| Source | Event | Consumer | Purpose |
|--------|-------|----------|---------|
| PTY | stdout | session:output | Terminal display |
| Agent SDK | stream_event | bvs:response-chunk | Streaming text |
| Agent SDK | tool_use | bvs:tool-start | Show tool activity |
| Orchestrator | progress | ralph:progress | Update progress UI |
| Orchestrator | checkpoint | ralph:checkpoint | Show checkpoint modal |
| Ideas sync | idea created | outlook:sync-stream | Progressive update |
| Discussion | AI response | ideas:discuss-stream | Streaming chat |

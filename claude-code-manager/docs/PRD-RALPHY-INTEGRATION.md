# PRD: AI-Assisted Merge Conflict Resolution and Worktree Lifecycle Management

## Executive Summary

Integrate Ralphy's parallel execution architecture into Claude Code Manager to enable concurrent task processing with git worktree isolation, automatic YAML task file generation from PRDs, AI-powered merge conflict resolution, and human-in-the-loop checkpoints for critical merge decisions.

---

## Problem Statement

### Current Limitations

1. **Sequential Execution Only**: Our Ralph Loop processes features one at a time, significantly increasing total execution time for projects with independent tasks.

2. **No PRD Import**: Users must manually describe requirements through the Initiator chat. Existing PRD documents, markdown specs, or GitHub issues cannot be imported directly.

3. **No Dependency Management**: Tasks are executed in order defined, with no ability to express "Task B depends on Task A" or "Tasks C and D can run in parallel."

4. **No Merge Conflict Handling**: When manual intervention creates conflicts or parallel work is attempted, users must resolve conflicts manually.

5. **No Task File Generation**: Requirements gathered through Initiator are converted directly to prompts without creating a reusable, editable task specification.

### User Pain Points

- "I have a 20-task PRD. Running sequentially takes hours when half the tasks are independent."
- "I want to import my existing markdown specs, not re-type everything in chat."
- "When I work on a branch while Ralph runs, merge conflicts block everything."
- "I can't see or edit the task breakdown before execution starts."

---

## Goals & Success Metrics

### Primary Goals

1. **Parallel Task Execution**: Run up to N concurrent AI agents in isolated git worktrees
2. **PRD → YAML Conversion**: Automatically parse PRDs and generate structured YAML task files with dependencies
3. **AI Merge Resolution**: Intelligently resolve merge conflicts using Claude's code understanding
4. **Checkpoint Integration**: Maintain human approval gates for risky merge operations
5. **Mobile Visibility**: Surface parallel execution status and merge approvals in mobile app

### Success Metrics

| Metric | Target |
|--------|--------|
| Execution time reduction (10+ task PRDs) | 50-70% faster |
| PRD import success rate | >95% |
| Auto-merge conflict resolution success | >80% |
| User intervention required for merges | <20% |
| Mobile checkpoint response time | <5 min avg |

---

## Feature Specification

### Feature 1: PRD Import and YAML Task Generation

#### 1.1 PRD Parser

Accept PRD input from multiple sources:

```
Sources:
├── Markdown file (.md)
├── Plain text paste
├── GitHub Issue URL
├── Notion page URL (via API)
└── Initiator chat conversation
```

#### 1.2 AI-Powered Task Extraction

Use Claude to analyze PRD and extract:

```yaml
# Generated output structure
project:
  name: "Feature Name"
  description: "Brief description"
  base_branch: "main"

tasks:
  - id: task-001
    title: "Create User authentication schema"
    description: "Design and implement database schema for users..."
    category: "backend"
    parallel_group: 1
    estimated_complexity: "medium"
    dependencies: []
    acceptance_criteria:
      - "User table exists with required fields"
      - "Migration runs without errors"

  - id: task-002
    title: "Implement login API endpoint"
    description: "Create POST /api/auth/login endpoint..."
    category: "backend"
    parallel_group: 2
    estimated_complexity: "medium"
    dependencies: ["task-001"]
    acceptance_criteria:
      - "Endpoint returns JWT on valid credentials"
      - "Returns 401 on invalid credentials"

  - id: task-003
    title: "Create login form component"
    description: "React component for user login..."
    category: "frontend"
    parallel_group: 2  # Can run parallel with task-002
    estimated_complexity: "low"
    dependencies: []
    acceptance_criteria:
      - "Form validates email format"
      - "Shows loading state during submission"

settings:
  max_parallel_agents: 3
  checkpoint_before_merge: true
  auto_create_pr: false
  run_tests_per_task: true
  run_lint_per_task: true
```

#### 1.3 Dependency Graph Analysis

Automatically detect dependencies based on:

1. **Explicit mentions**: "after the user model is created", "once authentication is complete"
2. **Code references**: Task B mentions files/functions that Task A creates
3. **Logical ordering**: Database schema before API, API before frontend
4. **Category grouping**: Group related tasks (all auth tasks, all UI tasks)

Generate parallel groups:
```
Group 0: Independent setup tasks (can start immediately)
Group 1: Foundation tasks (models, schemas)
Group 2: Tasks depending on Group 1
Group 3: Tasks depending on Group 2
...
```

#### 1.4 YAML Editor UI

Provide editable UI before execution:

```
┌─────────────────────────────────────────────────────────────┐
│ Task Breakdown Editor                            [Save] [Run]│
├─────────────────────────────────────────────────────────────┤
│ ┌─────────────────────┐  ┌────────────────────────────────┐ │
│ │ Dependency Graph    │  │ Task Details                   │ │
│ │                     │  │                                │ │
│ │  [task-001]         │  │ Title: Create User auth schema │ │
│ │      ↓              │  │ Category: backend              │ │
│ │  [task-002]←────┐   │  │ Parallel Group: 1              │ │
│ │      ↓          │   │  │ Dependencies: none             │ │
│ │  [task-004]  [task-003] │ Complexity: medium             │ │
│ │      ↓          │   │  │                                │ │
│ │  [task-005]←────┘   │  │ Acceptance Criteria:           │ │
│ │                     │  │ ☑ User table exists            │ │
│ └─────────────────────┘  │ ☑ Migration runs               │ │
│                          └────────────────────────────────┘ │
│ Parallel Groups: 3 │ Est. Time: ~45 min │ Agents: 3        │
└─────────────────────────────────────────────────────────────┘
```

---

### Feature 2: Git Worktree Parallel Execution

#### 2.1 Worktree Lifecycle Management

```
Execution Flow:

PRD → YAML → [Group 0 Tasks] → [Group 1 Tasks] → ... → Merge All → Done
                   │                  │
                   ↓                  ↓
              ┌────┴────┐        ┌────┴────┐
              │         │        │         │
           Agent 1   Agent 2  Agent 3   Agent 4
              │         │        │         │
           Worktree  Worktree Worktree  Worktree
              │         │        │         │
           Branch    Branch   Branch    Branch
              │         │        │         │
              └────┬────┘        └────┬────┘
                   ↓                  ↓
              Merge to base      Merge to base
                   │                  │
                   └────────┬─────────┘
                            ↓
                    Checkpoint Gate
                            ↓
                     Next Group
```

#### 2.2 Worktree Creation

For each parallel agent:

```typescript
interface WorktreeConfig {
  agentId: string;
  taskId: string;
  baseBranch: string;
  worktreePath: string;
  branchName: string;  // ralph/{sessionId}/agent-{n}-{task-slug}
}

async function createAgentWorktree(config: WorktreeConfig): Promise<void> {
  // 1. Create branch from base
  await git.branch(config.branchName, config.baseBranch);

  // 2. Create worktree
  await git.worktree.add(config.worktreePath, config.branchName);

  // 3. Copy necessary config files
  await copyProjectConfig(config.worktreePath);

  // 4. Initialize agent state
  await initializeAgentState(config);
}
```

#### 2.3 Agent Isolation

Each agent operates in complete isolation:

- Separate filesystem (worktree)
- Separate git branch
- Separate Claude session
- Separate checkpoint queue
- Shared: WebSocket connection to manager for status updates

#### 2.4 Worktree Cleanup

```typescript
async function cleanupWorktree(config: WorktreeConfig): Promise<CleanupResult> {
  const status = await git.status(config.worktreePath);

  if (status.isDirty) {
    // Preserve for manual inspection
    return {
      cleaned: false,
      reason: 'uncommitted_changes',
      path: config.worktreePath
    };
  }

  // Remove worktree
  await git.worktree.remove(config.worktreePath);

  // Optionally delete branch if merged
  if (await isBranchMerged(config.branchName, config.baseBranch)) {
    await git.branch.delete(config.branchName);
  }

  return { cleaned: true };
}
```

---

### Feature 3: AI-Powered Merge Conflict Resolution

#### 3.1 Merge Strategy

```
After parallel group completes:

1. Attempt fast-forward merge (no conflicts possible)
   ↓ (if fails)
2. Attempt standard merge
   ↓ (if conflicts)
3. AI-assisted conflict resolution
   ↓ (if AI fails)
4. Create checkpoint for human review
```

#### 3.2 AI Merge Resolution

```typescript
interface MergeConflict {
  file: string;
  oursContent: string;    // Current branch version
  theirsContent: string;  // Incoming branch version
  baseContent: string;    // Common ancestor
  conflictMarkers: string; // Raw conflict text
}

async function resolveConflictWithAI(
  conflict: MergeConflict,
  context: MergeContext
): Promise<MergeResolution> {

  const prompt = `
You are resolving a git merge conflict. Both versions contain valid changes that need to be intelligently combined.

## Context
- Base branch: ${context.baseBranch}
- Merging branch: ${context.mergingBranch}
- File: ${conflict.file}

## Our version (${context.baseBranch}):
\`\`\`
${conflict.oursContent}
\`\`\`

## Their version (${context.mergingBranch}):
\`\`\`
${conflict.theirsContent}
\`\`\`

## Common ancestor:
\`\`\`
${conflict.baseContent}
\`\`\`

## Task that created "ours": ${context.oursTask}
## Task that created "theirs": ${context.theirsTask}

Resolve this conflict by:
1. Understanding what each version is trying to accomplish
2. Combining both changes where they don't conflict logically
3. Choosing the better implementation where they do conflict
4. Ensuring the result is syntactically valid and functionally correct

Return ONLY the resolved file content, no explanations.
`;

  const resolution = await claude.complete(prompt);

  // Validate resolution
  if (containsConflictMarkers(resolution)) {
    throw new Error('AI resolution still contains conflict markers');
  }

  // Syntax check based on file type
  await validateSyntax(conflict.file, resolution);

  return {
    file: conflict.file,
    resolvedContent: resolution,
    confidence: calculateConfidence(conflict, resolution),
  };
}
```

#### 3.3 Confidence Scoring

```typescript
function calculateMergeConfidence(
  conflict: MergeConflict,
  resolution: string
): number {
  let confidence = 1.0;

  // Reduce confidence for large conflicts
  const conflictSize = conflict.conflictMarkers.split('\n').length;
  if (conflictSize > 50) confidence -= 0.2;
  if (conflictSize > 100) confidence -= 0.2;

  // Reduce confidence for complex file types
  if (isComplexFile(conflict.file)) confidence -= 0.1;

  // Reduce confidence if resolution differs significantly from both
  const similarity = Math.max(
    calculateSimilarity(resolution, conflict.oursContent),
    calculateSimilarity(resolution, conflict.theirsContent)
  );
  if (similarity < 0.5) confidence -= 0.2;

  // Reduce confidence for files with test failures
  // (checked after resolution is applied)

  return Math.max(0, confidence);
}
```

#### 3.4 Merge Checkpoints

When confidence is below threshold or for critical files:

```typescript
interface MergeCheckpoint {
  type: 'merge_approval';
  sessionId: string;
  conflicts: MergeConflictSummary[];
  proposedResolutions: MergeResolution[];
  confidence: number;
  affectedFiles: string[];
  riskLevel: 'low' | 'medium' | 'high' | 'critical';

  // Actions available
  actions: ['approve', 'reject', 'edit', 'manual'];
}

// Trigger checkpoint if:
// - Confidence < 0.7
// - Critical files involved (package.json, migrations, configs)
// - More than 3 files conflicted
// - Resolution changes > 100 lines
```

---

### Feature 4: Enhanced Ralph Loop Orchestrator

#### 4.1 Session Configuration

```typescript
interface RalphSessionConfig {
  // Task source
  source:
    | { type: 'yaml'; path: string }
    | { type: 'prd'; content: string }
    | { type: 'github'; repo: string; label?: string }
    | { type: 'initiator'; sessionId: string };

  // Execution settings
  parallel: {
    enabled: boolean;
    maxAgents: number;  // 1-10, default 3
  };

  // Git settings
  git: {
    baseBranch: string;
    branchPerTask: boolean;
    createPR: boolean;
    draftPR: boolean;
    autoMerge: boolean;
  };

  // Quality gates
  quality: {
    runTests: boolean;
    runLint: boolean;
    requireTestPass: boolean;
  };

  // Checkpoints
  checkpoints: {
    beforeMerge: boolean;
    onConflict: boolean;
    betweenGroups: boolean;
    minConfidenceForAutoMerge: number;  // 0.0-1.0
  };

  // Limits
  limits: {
    maxIterations: number;  // 0 = unlimited
    maxRetries: number;
    retryDelay: number;  // seconds
    timeout: number;  // per task, minutes
  };
}
```

#### 4.2 Execution State Machine

```
                    ┌─────────────────┐
                    │     IDLE        │
                    └────────┬────────┘
                             │ start()
                             ↓
                    ┌─────────────────┐
                    │  PARSING_PRD    │
                    └────────┬────────┘
                             │ yaml generated
                             ↓
                    ┌─────────────────┐
                    │ AWAITING_REVIEW │←──────────────┐
                    └────────┬────────┘               │
                             │ user approves          │
                             ↓                        │
                    ┌─────────────────┐               │
              ┌────→│ EXECUTING_GROUP │               │
              │     └────────┬────────┘               │
              │              │ group complete         │
              │              ↓                        │
              │     ┌─────────────────┐               │
              │     │    MERGING      │               │
              │     └────────┬────────┘               │
              │              │                        │
              │      ┌───────┴───────┐                │
              │      ↓               ↓                │
              │  [success]    [conflicts]             │
              │      │               │                │
              │      │               ↓                │
              │      │      ┌─────────────────┐       │
              │      │      │  AI_RESOLVING   │       │
              │      │      └────────┬────────┘       │
              │      │               │                │
              │      │       ┌───────┴───────┐        │
              │      │       ↓               ↓        │
              │      │   [resolved]    [needs human]  │
              │      │       │               │        │
              │      │       │               ↓        │
              │      │       │      ┌─────────────────┐
              │      │       │      │CHECKPOINT_MERGE │
              │      │       │      └────────┬────────┘
              │      │       │               │        │
              │      ↓       ↓               ↓        │
              │     ┌─────────────────┐      │        │
              │     │  GROUP_MERGED   │←─────┘        │
              │     └────────┬────────┘               │
              │              │                        │
              │      ┌───────┴───────┐                │
              │      ↓               ↓                │
              │ [more groups]   [all done]            │
              │      │               │                │
              └──────┘               ↓                │
                            ┌─────────────────┐       │
                            │   COMPLETING    │       │
                            └────────┬────────┘       │
                                     │                │
                             ┌───────┴───────┐        │
                             ↓               ↓        │
                         [success]       [failed]     │
                             │               │        │
                             ↓               └────────┘
                    ┌─────────────────┐      (retry?)
                    │    COMPLETED    │
                    └─────────────────┘
```

#### 4.3 Agent Status Tracking

```typescript
interface AgentStatus {
  agentId: string;
  taskId: string;
  taskTitle: string;
  worktreePath: string;
  branchName: string;

  state:
    | 'initializing'
    | 'running'
    | 'testing'
    | 'committing'
    | 'completed'
    | 'failed'
    | 'waiting_checkpoint';

  progress: {
    currentStep: string;
    stepsCompleted: number;
    totalSteps: number;
    elapsedTime: number;
  };

  output: {
    lastLines: string[];  // Last 50 lines
    fullLogPath: string;
  };

  metrics: {
    tokensUsed: number;
    estimatedCost: number;
    filesModified: string[];
    testsRun: number;
    testsPassed: number;
  };
}
```

---

### Feature 5: Mobile App Integration

#### 5.1 Parallel Execution Dashboard

```
┌─────────────────────────────────────────────┐
│ Ralph Session: Auth System        ⏱ 12:34  │
├─────────────────────────────────────────────┤
│ Progress: Group 2 of 4                      │
│ ████████████░░░░░░░░░░░░░░░░░░  45%        │
├─────────────────────────────────────────────┤
│ Active Agents                               │
│ ┌─────────────────────────────────────────┐ │
│ │ 🟢 Agent 1: Create User model     2:15 │ │
│ │    └─ Running tests...                  │ │
│ ├─────────────────────────────────────────┤ │
│ │ 🟡 Agent 2: Create Post model     1:45 │ │
│ │    └─ Implementing...                   │ │
│ ├─────────────────────────────────────────┤ │
│ │ 🟢 Agent 3: Auth middleware       3:02 │ │
│ │    └─ Committing changes...             │ │
│ └─────────────────────────────────────────┘ │
├─────────────────────────────────────────────┤
│ Completed: 5  │  Running: 3  │  Pending: 4 │
└─────────────────────────────────────────────┘
```

#### 5.2 Merge Conflict Notification

Push notification for merge conflicts:

```
┌─────────────────────────────────────────────┐
│ 🔀 Merge Conflict Needs Review              │
│                                             │
│ 3 files have conflicts after parallel       │
│ execution of Group 2.                       │
│                                             │
│ AI Resolution Confidence: 72%               │
│                                             │
│ [View Details]  [Approve AI]  [Reject]     │
└─────────────────────────────────────────────┘
```

#### 5.3 Merge Resolution Review

```
┌─────────────────────────────────────────────┐
│ Merge Resolution Review           [Approve] │
├─────────────────────────────────────────────┤
│ Branches merging:                           │
│   ralph/agent-1-user-model                  │
│   ralph/agent-2-post-model                  │
│   → main                                    │
├─────────────────────────────────────────────┤
│ Conflicts Resolved: 3 files                 │
│                                             │
│ ┌─────────────────────────────────────────┐ │
│ │ 📄 src/models/index.ts                  │ │
│ │    Confidence: 85%                      │ │
│ │    Both added exports, combined them    │ │
│ │    [View Diff]                          │ │
│ ├─────────────────────────────────────────┤ │
│ │ 📄 src/types/index.ts                   │ │
│ │    Confidence: 90%                      │ │
│ │    Added User and Post types            │ │
│ │    [View Diff]                          │ │
│ ├─────────────────────────────────────────┤ │
│ │ ⚠️ package.json                         │ │
│ │    Confidence: 65%                      │ │
│ │    Dependency version conflict          │ │
│ │    [View Diff] [Edit]                   │ │
│ └─────────────────────────────────────────┘ │
├─────────────────────────────────────────────┤
│ Overall Confidence: 72%                     │
│                                             │
│ [Reject All]  [Edit Manually]  [Approve]   │
└─────────────────────────────────────────────┘
```

---

### Feature 6: YAML Task File Management

#### 6.1 Task File Storage

```
project/
├── .ralph/
│   ├── sessions/
│   │   └── {session-id}/
│   │       ├── config.yaml      # Session configuration
│   │       ├── tasks.yaml       # Generated/edited task file
│   │       ├── progress.json    # Execution progress
│   │       └── agents/
│   │           ├── agent-1/
│   │           │   ├── output.log
│   │           │   └── metrics.json
│   │           └── agent-2/
│   │               └── ...
│   └── templates/
│       └── default-tasks.yaml   # User's default template
```

#### 6.2 Task File Versioning

Track changes to task files:

```typescript
interface TaskFileVersion {
  version: number;
  timestamp: number;
  source: 'generated' | 'user_edit' | 'auto_update';
  changes: TaskChange[];
  content: string;  // Full YAML
}

// Keep history for rollback
// Auto-save before user edits
// Track which tasks were modified
```

#### 6.3 Template System

Allow users to define templates:

```yaml
# .ralph/templates/backend-feature.yaml
project:
  settings:
    max_parallel_agents: 3
    run_tests_per_task: true
    checkpoint_before_merge: true

task_defaults:
  acceptance_criteria:
    - "All tests pass"
    - "No TypeScript errors"
    - "Follows project conventions"

task_templates:
  database_model:
    category: "backend"
    parallel_group: 1
    acceptance_criteria:
      - "Migration created"
      - "Model types defined"

  api_endpoint:
    category: "backend"
    parallel_group: 2
    dependencies: ["database_model"]
    acceptance_criteria:
      - "Endpoint responds correctly"
      - "Error handling implemented"
```

---

## API Specifications

### New IPC Handlers

```typescript
// PRD Processing
'ralph:parse-prd': (content: string, options: ParseOptions) => Promise<TaskYaml>
'ralph:validate-yaml': (yaml: string) => Promise<ValidationResult>
'ralph:save-task-file': (sessionId: string, yaml: string) => Promise<void>
'ralph:load-task-file': (sessionId: string) => Promise<TaskYaml>

// Parallel Execution
'ralph:start-parallel': (sessionId: string, config: ParallelConfig) => Promise<void>
'ralph:get-agent-status': (sessionId: string) => Promise<AgentStatus[]>
'ralph:stop-agent': (sessionId: string, agentId: string) => Promise<void>

// Worktree Management
'ralph:list-worktrees': (sessionId: string) => Promise<WorktreeInfo[]>
'ralph:cleanup-worktrees': (sessionId: string) => Promise<CleanupResult>
'ralph:preserve-worktree': (worktreePath: string) => Promise<void>

// Merge Operations
'ralph:get-merge-status': (sessionId: string) => Promise<MergeStatus>
'ralph:resolve-conflicts': (sessionId: string, resolutions: Resolution[]) => Promise<void>
'ralph:approve-merge': (sessionId: string, checkpointId: string) => Promise<void>
'ralph:reject-merge': (sessionId: string, checkpointId: string, reason: string) => Promise<void>
```

### New API Server Endpoints

```typescript
// Task Files
POST   /api/ralph/parse-prd          // Parse PRD, return YAML
GET    /api/ralph/sessions/:id/tasks // Get task file
PUT    /api/ralph/sessions/:id/tasks // Update task file
POST   /api/ralph/sessions/:id/tasks/validate

// Parallel Execution
POST   /api/ralph/sessions/:id/start-parallel
GET    /api/ralph/sessions/:id/agents
GET    /api/ralph/sessions/:id/agents/:agentId
DELETE /api/ralph/sessions/:id/agents/:agentId

// Worktrees
GET    /api/ralph/sessions/:id/worktrees
DELETE /api/ralph/sessions/:id/worktrees/:path
POST   /api/ralph/sessions/:id/worktrees/:path/preserve

// Merge
GET    /api/ralph/sessions/:id/merge-status
POST   /api/ralph/sessions/:id/merge/resolve
POST   /api/ralph/sessions/:id/merge/approve
POST   /api/ralph/sessions/:id/merge/reject

// WebSocket events
ws://  /ws/ralph/:sessionId
       → agent:status
       → agent:output
       → merge:conflict
       → merge:resolved
       → checkpoint:created
       → group:complete
```

---

## Implementation Plan

### Phase 1: PRD Parser & YAML Generation (Week 1-2)

- [ ] Create PRD parser service
- [ ] Implement AI task extraction with Claude
- [ ] Build dependency graph analyzer
- [ ] Generate parallel groups automatically
- [ ] Create YAML editor component in desktop app
- [ ] Add task file storage and versioning

### Phase 2: Worktree Infrastructure (Week 2-3)

- [ ] Implement worktree creation/cleanup utilities
- [ ] Create agent isolation layer
- [ ] Build parallel execution orchestrator
- [ ] Add agent status tracking
- [ ] Implement inter-agent communication (via main process)

### Phase 3: AI Merge Resolution (Week 3-4)

- [ ] Build merge conflict detector
- [ ] Implement AI resolution prompt engineering
- [ ] Add confidence scoring system
- [ ] Create merge checkpoint flow
- [ ] Build resolution validation

### Phase 4: Mobile Integration (Week 4-5)

- [ ] Add parallel execution dashboard to mobile
- [ ] Implement merge conflict notifications
- [ ] Create merge resolution review UI
- [ ] Add agent monitoring views
- [ ] Test push notification flows

### Phase 5: Testing & Polish (Week 5-6)

- [ ] End-to-end testing with real PRDs
- [ ] Performance optimization
- [ ] Error recovery improvements
- [ ] Documentation
- [ ] User feedback integration

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| AI merge resolution fails frequently | Medium | High | Conservative confidence thresholds, easy fallback to manual |
| Worktree conflicts with user work | Low | Medium | Dedicated `.ralph-worktrees/` directory, cleanup on session end |
| Parallel agents interfere | Low | High | Complete worktree isolation, no shared state |
| PRD parsing misses tasks | Medium | Medium | Human review step before execution |
| Mobile latency for approvals | Medium | Medium | Timeout with default action, offline queue |

---

## Success Criteria

### MVP (Must Have)

1. ✅ Parse markdown PRD into YAML task file
2. ✅ Generate parallel groups based on dependencies
3. ✅ Execute up to 3 agents in parallel worktrees
4. ✅ Auto-merge with AI conflict resolution
5. ✅ Checkpoint for low-confidence merges
6. ✅ Mobile notification for merge approvals

### V1.1 (Should Have)

1. GitHub Issues as task source
2. YAML template system
3. Task file editor with dependency visualization
4. Merge resolution editing from mobile
5. Cost tracking per agent

### V1.2 (Nice to Have)

1. Notion integration for PRDs
2. Automatic PR creation
3. Custom merge strategies
4. Agent performance analytics
5. Task time estimation

---

## Appendix

### A. Sample PRD → YAML Transformation

**Input PRD:**
```markdown
# User Authentication System

## Overview
Implement complete user authentication with login, registration, and password reset.

## Requirements

### Backend
1. Create User model with email, password hash, and profile fields
2. Implement registration endpoint with email verification
3. Implement login endpoint with JWT tokens
4. Add password reset flow with email

### Frontend
5. Create registration form with validation
6. Create login form
7. Add password reset request form
8. Implement protected route wrapper

### Testing
9. Unit tests for auth service
10. Integration tests for auth endpoints
11. E2E tests for auth flows
```

**Output YAML:**
```yaml
project:
  name: "User Authentication System"
  description: "Complete user authentication with login, registration, and password reset"
  base_branch: "main"

settings:
  max_parallel_agents: 3
  checkpoint_before_merge: true
  run_tests_per_task: true

tasks:
  - id: auth-001
    title: "Create User model with email, password hash, and profile fields"
    category: "backend"
    parallel_group: 1
    dependencies: []
    estimated_complexity: "medium"
    acceptance_criteria:
      - "User model exists with all required fields"
      - "Password is properly hashed"
      - "Migration runs successfully"

  - id: auth-002
    title: "Implement registration endpoint with email verification"
    category: "backend"
    parallel_group: 2
    dependencies: ["auth-001"]
    estimated_complexity: "high"
    acceptance_criteria:
      - "POST /api/auth/register works"
      - "Email verification sent"
      - "Duplicate email rejected"

  - id: auth-003
    title: "Implement login endpoint with JWT tokens"
    category: "backend"
    parallel_group: 2
    dependencies: ["auth-001"]
    estimated_complexity: "medium"
    acceptance_criteria:
      - "POST /api/auth/login returns JWT"
      - "Invalid credentials return 401"
      - "Token contains user info"

  - id: auth-004
    title: "Add password reset flow with email"
    category: "backend"
    parallel_group: 2
    dependencies: ["auth-001"]
    estimated_complexity: "medium"
    acceptance_criteria:
      - "Reset email sent with token"
      - "Token expires after 24h"
      - "Password successfully reset"

  - id: auth-005
    title: "Create registration form with validation"
    category: "frontend"
    parallel_group: 2
    dependencies: []
    estimated_complexity: "medium"
    acceptance_criteria:
      - "Form validates all fields"
      - "Shows loading state"
      - "Displays errors properly"

  - id: auth-006
    title: "Create login form"
    category: "frontend"
    parallel_group: 2
    dependencies: []
    estimated_complexity: "low"
    acceptance_criteria:
      - "Form submits credentials"
      - "Stores JWT on success"
      - "Redirects after login"

  - id: auth-007
    title: "Add password reset request form"
    category: "frontend"
    parallel_group: 3
    dependencies: ["auth-004"]
    estimated_complexity: "low"
    acceptance_criteria:
      - "Form accepts email"
      - "Shows success message"

  - id: auth-008
    title: "Implement protected route wrapper"
    category: "frontend"
    parallel_group: 3
    dependencies: ["auth-006"]
    estimated_complexity: "medium"
    acceptance_criteria:
      - "Redirects unauthenticated users"
      - "Passes user to children"

  - id: auth-009
    title: "Unit tests for auth service"
    category: "testing"
    parallel_group: 3
    dependencies: ["auth-002", "auth-003", "auth-004"]
    estimated_complexity: "medium"
    acceptance_criteria:
      - "All service methods tested"
      - "Edge cases covered"

  - id: auth-010
    title: "Integration tests for auth endpoints"
    category: "testing"
    parallel_group: 4
    dependencies: ["auth-009"]
    estimated_complexity: "medium"
    acceptance_criteria:
      - "All endpoints tested"
      - "Error responses tested"

  - id: auth-011
    title: "E2E tests for auth flows"
    category: "testing"
    parallel_group: 4
    dependencies: ["auth-005", "auth-006", "auth-007", "auth-008"]
    estimated_complexity: "high"
    acceptance_criteria:
      - "Full registration flow tested"
      - "Full login flow tested"
      - "Password reset flow tested"
```

### B. Parallel Execution Timeline

```
Time →
──────────────────────────────────────────────────────────────────────

Group 1 (Foundation):
  [auth-001: User model                    ]
  └─ Creates base for all backend tasks

Group 2 (Parallel - Backend + Frontend):
  [auth-002: Registration endpoint         ]
  [auth-003: Login endpoint                ]
  [auth-004: Password reset                ]
  [auth-005: Registration form             ]
  [auth-006: Login form                    ]
  └─ 5 tasks running in parallel (3 agents, queue 2)

  ── Merge checkpoint ──

Group 3 (Dependent features):
  [auth-007: Reset form    ]
  [auth-008: Protected routes]
  [auth-009: Unit tests      ]
  └─ 3 tasks in parallel

  ── Merge checkpoint ──

Group 4 (Final testing):
  [auth-010: Integration tests]
  [auth-011: E2E tests        ]
  └─ 2 tasks in parallel

  ── Final merge ──

Total: 11 tasks
Without parallel: ~11 iterations
With parallel (3 agents): ~4 iterations (batches)
Estimated speedup: ~60%
```

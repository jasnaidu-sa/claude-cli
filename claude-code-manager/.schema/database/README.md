# Database / State Management

> Claude Code Manager uses Zustand stores for client-side state and electron-store for persistent configuration.
> No traditional database - all state is in-memory or file-based.

---

## State Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  RENDERER (Zustand Stores)                                      │
│  ┌─────────────────┐  ┌─────────────────┐                       │
│  │  session-store  │  │    ui-store     │                       │
│  │  (sessions)     │  │  (panels/theme) │                       │
│  └─────────────────┘  └─────────────────┘                       │
├─────────────────────────────────────────────────────────────────┤
│  MAIN PROCESS (In-Memory + File Persistence)                    │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │ Session Manager │  │ Ideas Manager   │  │ Ralph Sessions  │  │
│  │ (Map<id,PTY>)   │  │ (.ideas.json)   │  │ (.ralph/)       │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘  │
│  ┌─────────────────┐  ┌─────────────────┐                       │
│  │ Config Store    │  │ BVS Planning    │                       │
│  │ (electron-store)│  │ (.bvs/)         │                       │
│  └─────────────────┘  └─────────────────┘                       │
└─────────────────────────────────────────────────────────────────┘
```

---

## Zustand Stores (Renderer)

### session-store.ts

Terminal session state for Claude CLI instances.

```typescript
interface SessionState {
  sessions: Session[]
  activeSessionId: string | null
  isLoading: boolean
}

interface Session {
  id: string              // UUID
  projectPath: string     // Absolute path to project
  projectName: string     // Directory name
  status: SessionStatus   // 'idle' | 'running' | 'thinking' | 'editing' | 'error'
  editedFiles: EditedFile[]
  createdAt: number       // Unix timestamp
}

interface EditedFile {
  path: string
  action: 'read' | 'edit' | 'write' | 'create' | 'delete'
  timestamp: number
  status: 'pending' | 'completed'
}
```

**Actions:**
- `setSessions(sessions)` - Replace all sessions
- `addSession(session)` - Add new session, set as active
- `removeSession(sessionId)` - Remove session
- `updateSessionStatus(sessionId, status, editedFiles?)` - Update status
- `setActiveSession(sessionId)` - Set active session
- `getActiveSession()` - Get current active session

---

### ui-store.ts

UI state with localStorage persistence.

```typescript
interface UIState {
  viewMode: 'grid' | 'single'
  sidebarOpen: boolean
  activePanel: Panel | null   // 'files' | 'browser' | 'settings' | 'worktrees' | 'autonomous' | 'ideas' | 'bvs'
  browserUrl: string
  showNewSessionModal: boolean
  gridColumns: number         // 1-4
  theme: 'light' | 'dark' | 'system'
  selectedFile: { path: string; content: string } | null
}
```

**Persisted fields:** `gridColumns`, `theme`, `sidebarOpen`

---

## Main Process State

### Session Manager

In-memory Map of PTY instances.

```typescript
// Location: src/main/services/session-manager.ts
Map<sessionId, {
  pty: IPty           // node-pty instance
  projectPath: string
  status: SessionStatus
}>
```

---

### Ideas Manager

File-based persistence in project directory.

```typescript
// Location: src/main/services/ideas-manager.ts
// Storage: {projectPath}/.ideas.json

interface Idea {
  id: string
  title: string
  description: string
  stage: IdeaStage      // 'inbox' | 'review' | 'approved' | 'in_progress' | 'completed' | 'declined'
  projectType: ProjectType  // 'greenfield' | 'brownfield' | 'undetermined'

  // Email source
  emailSource: {
    messageId: string
    from: string
    subject: string
    receivedAt: number
    body: string
  }

  // Extracted URLs
  extractedUrls?: {
    url: string
    title: string | null
    description: string | null
    articleContent?: string
    summary?: string
  }[]

  // Discussion
  discussionMessages?: {
    id: string
    role: 'user' | 'assistant'
    content: string
    timestamp: number
  }[]
  sessionId?: string    // Agent SDK session for conversation

  // Workflow tracking
  createdAt: number
  updatedAt: number
  workflowId?: string   // Linked workflow when project starts
  tags?: string[]
  priority?: 'low' | 'medium' | 'high' | 'urgent'
}
```

---

### BVS Planning Sessions

File-based persistence per project.

```typescript
// Location: src/main/services/bvs-planning-agent-v2.ts
// Storage: {projectPath}/.bvs/planning-session.json

interface PlanningSessionV2 {
  id: string
  projectPath: string
  messages: PlanningMessage[]
  phase: 'exploring' | 'options' | 'planning' | 'approval' | 'complete'
  selectedOption?: string
  proposedSections?: PlannedSection[]
  sdkSessionId?: string     // Agent SDK session for continuity
  createdAt: number
  updatedAt: number
  totalCostUsd?: number
}

interface PlanningMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  questions?: PlanningQuestion[]
  options?: PlanningOption[]
  sections?: PlannedSection[]
  toolCalls?: { name: string; input: Record<string, unknown>; result?: string }[]
}

interface PlanningQuestion {
  id: string
  category: string
  question: string
  options: { id: string; label: string; description: string }[]
}

interface PlanningOption {
  id: string
  name: string
  description: string
  recommended?: boolean
  sectionCount: number
  complexity: 'low' | 'medium' | 'high'
}

interface PlannedSection {
  id: string
  name: string
  description: string
  files: { path: string; action: 'create' | 'modify' | 'delete' }[]
  dependencies: string[]
  successCriteria: string[]
}
```

---

### Ralph Session State

File-based persistence per project.

```typescript
// Location: src/main/services/ralph-orchestrator-service.ts
// Storage: {projectPath}/.ralph/

interface RalphExecutionState {
  sessionId: string
  projectPath: string
  phase: 'validation' | 'generation' | 'implementation'
  status: 'idle' | 'starting' | 'running' | 'paused' | 'completed' | 'error'
  features: RalphFeature[]
  iteration: number
  maxIterations: number
  testsTotal: number
  testsPassing: number
  currentFeature?: string
  startedAt: number
  completedAt?: number
  error?: string
}

interface RalphFeature {
  id: string
  name: string
  description?: string
  category: string
  status: 'pending' | 'in_progress' | 'passed' | 'failed' | 'skipped'
  riskScore?: number
  error?: string
}

interface RalphCheckpoint {
  id: string
  type: 'soft' | 'hard'
  featureId: string
  featureName: string
  riskScore: number
  reason: string
  riskFactors: { category: string; score: number; details: string }[]
  affectedFiles: string[]
  blastRadius: number
  createdAt: number
  resolution?: 'approved' | 'skipped' | 'rejected'
}
```

---

### Initiator Session State

In-memory with Agent SDK session persistence.

```typescript
// Location: src/main/services/initiator-service.ts

interface InitiatorSession {
  id: string
  projectPath: string
  messages: InitiatorMessage[]
  phase: 'gathering' | 'summarizing' | 'generating' | 'reviewing' | 'approved'
  requirements: RequirementsDoc | null
  generatedPrompt: RalphPromptConfig | null
  createdAt: number
  updatedAt: number
  totalCostUsd: number
}

interface RequirementsDoc {
  objective: string
  scope: string[]
  successCriteria: string[]
  constraints: string[]
  outOfScope: string[]
  projectType: 'greenfield' | 'brownfield' | 'undetermined'
  complexity: 'quick' | 'standard' | 'enterprise'
  estimatedFeatures: number
}
```

---

### Config Store

Persistent configuration via electron-store.

```typescript
// Location: src/main/services/config-store.ts
// Storage: %APPDATA%/claude-code-manager/config.json

interface AppConfig {
  claudeCliPath: string
  defaultProjectsDir: string
  theme: 'dark' | 'light' | 'system'
  fontSize: number
  recentProjects: string[]

  autonomous: {
    defaultModel: string
    availableModels: { id: string; name: string; enabled: boolean }[]
    autoStartOnCreate: boolean
    confirmBeforeStart: boolean
    mcpServers: { name: string; command: string; args: string[]; enabled: boolean }[]
    maxConcurrentSessions: number
  }

  apiServer?: {
    enabled: boolean
    port: number           // Default: 3847
    authEnabled: boolean
  }
}
```

---

### Outlook Configuration

Stored in config-store.

```typescript
interface OutlookConfig {
  clientId: string
  clientSecret?: string
  tenantId: string
  redirectUri: string
  sourceEmailAddress: string
  lastSyncAt?: number
  accessToken?: string
  refreshToken?: string
  tokenExpiresAt?: number
}
```

---

## Workflow & Checkpoint Types

### Workflow Configuration

```typescript
interface WorkflowConfig {
  id: string
  name: string
  description?: string
  projectPath: string
  worktreePath?: string
  specFile: string
  model: string
  status: 'pending' | 'validating' | 'generating' | 'implementing' | 'paused' | 'completed' | 'error'
  createdAt: number
  updatedAt: number
  progress?: WorkflowProgress
  error?: string
}

interface WorkflowProgress {
  phase: 'validation' | 'generation' | 'implementation'
  testsTotal: number
  testsPassing: number
  currentTest?: string
  categories?: { name: string; total: number; passing: number }[]
}
```

---

### Checkpoint Configuration

```typescript
interface CheckpointConfig {
  enableCategoryCheckpoints: boolean
  enableFailureCheckpoints: boolean
  enableRiskCheckpoints: boolean
  failureThreshold: number              // Default: 3
  categoryCompletionThreshold: number   // Default: 100
  riskKeywords: string[]                // ['migration', 'delete', 'drop', 'alter', 'truncate', 'schema']
  autoApproveIfAllPassing: boolean
  autoApproveCategories: string[]
  enableAutoRollback: boolean
  keepRollbackHistory: number           // Default: 10
}

interface Checkpoint {
  id: string
  workflowId: string
  sessionId: string
  type: 'category_complete' | 'failure_threshold' | 'risk_boundary' | 'feature_complete' | 'manual'
  status: 'pending' | 'approved' | 'rejected' | 'rolled_back' | 'skipped'
  createdAt: number
  resolvedAt?: number
  context: {
    testsTotal: number
    testsPassing: number
    testsFailing: number
    completedCategories: string[]
    triggerReason: string
    gitCommit: string
    gitBranch: string
    modifiedFiles: string[]
    changesSummary: string
  }
  feedback?: string
  rollbackTarget?: string
}
```

---

## State Relationships

```
Session (UI)
    │
    ├── 1:1 ── PTY Process (Main)
    │
    └── 1:N ── EditedFile[]

Idea (Ideas Kanban)
    │
    ├── 1:1 ── EmailSource
    ├── 1:N ── ExtractedUrl[]
    ├── 1:N ── DiscussionMessage[]
    └── 1:1 ── Workflow (when started)

PlanningSession (BVS)
    │
    ├── 1:N ── PlanningMessage[]
    │              ├── 1:N ── Question[]
    │              ├── 1:N ── Option[]
    │              └── 1:N ── Section[]
    └── 1:1 ── Agent SDK Session

RalphExecution
    │
    ├── 1:1 ── InitiatorSession (requirements)
    ├── 1:N ── Feature[]
    ├── 1:N ── Checkpoint[]
    └── 1:1 ── Context (running summary, decisions, failures)
```

---

## File Storage Locations

| Data | Location |
|------|----------|
| App Config | `%APPDATA%/claude-code-manager/config.json` |
| Ideas | `{projectPath}/.ideas.json` |
| BVS Plans | `{projectPath}/.bvs/planning-session.json` |
| BVS Output | `{projectPath}/.bvs/plan.md` |
| Ralph State | `{projectPath}/.ralph/` |
| Browser Cookies | `%APPDATA%/claude-code-manager/browser-cookies.json` |

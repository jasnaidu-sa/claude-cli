# API / IPC Documentation

> Claude Code Manager uses Electron IPC for main-renderer communication and an HTTP/WebSocket API server for remote access.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  RENDERER                                                        │
│  window.electron.* ──────────────────────────────────────────┐   │
│                                                               │   │
├───────────────────────────────────────────────────────────────┼───┤
│  PRELOAD (Context Bridge)                                     │   │
│  ipcRenderer.invoke() / ipcRenderer.on()                      │   │
├───────────────────────────────────────────────────────────────┼───┤
│  MAIN PROCESS                                                 │   │
│  ┌─────────────────────────────────────────────────────────┐  │   │
│  │ IPC Handlers (src/main/ipc/)                            │◄─┘   │
│  │ ├── session-handlers                                    │      │
│  │ ├── bvs-handlers                                        │      │
│  │ ├── ideas-handlers                                      │      │
│  │ ├── ralph-handlers                                      │      │
│  │ ├── discovery-handlers                                  │      │
│  │ └── ...                                                 │      │
│  └─────────────────────────────────────────────────────────┘      │
│                                                                    │
│  ┌─────────────────────────────────────────────────────────┐      │
│  │ API Server (src/main/api-server/)                       │◄──── │ Remote
│  │ HTTP REST + WebSocket on port 3847                      │      │ Clients
│  └─────────────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────────┘
```

---

## IPC Handlers

### Session Management

| Channel | Type | Description |
|---------|------|-------------|
| `session:create` | invoke | Create new Claude CLI session |
| `session:destroy` | invoke | Terminate session |
| `session:list` | invoke | List all sessions |
| `session:input` | invoke | Send input to session PTY |
| `session:resize` | invoke | Resize terminal |
| `session:output` | event | Terminal output stream |
| `session:status` | event | Status change notification |

**session:create**
```typescript
// Request
{ projectPath: string }

// Response
{ id: string; projectPath: string; projectName: string; status: string; createdAt: number }
```

**session:input**
```typescript
// Request
{ sessionId: string; data: string }
```

---

### BVS Planning Agent

| Channel | Type | Description |
|---------|------|-------------|
| `bvs:create-session` | invoke | Start new planning session |
| `bvs:send-message` | invoke | Send user message |
| `bvs:answer-questions` | invoke | Submit question answers |
| `bvs:select-option` | invoke | Select implementation option |
| `bvs:approve-plan` | invoke | Approve and write plan |
| `bvs:clear-session` | invoke | Clear session for fresh start |
| `bvs-planning:response-chunk` | event | Streaming response text |
| `bvs-planning:tool-start` | event | Tool execution started |
| `bvs-planning:tool-result` | event | Tool execution completed |
| `bvs-planning:questions-ready` | event | Questions parsed and ready |
| `bvs-planning:options-ready` | event | Options parsed and ready |
| `bvs-planning:sections-ready` | event | Sections parsed and ready |
| `bvs-planning:plan-written` | event | Plan file written |

**bvs:create-session**
```typescript
// Request
{ projectPath: string }

// Response
PlanningSessionV2
```

**bvs:answer-questions**
```typescript
// Request
{ sessionId: string; answers: Record<string, string> }
// Note: Custom answers use format "custom:user text"

// Response
PlanningMessage
```

---

### Ideas Kanban

| Channel | Type | Description |
|---------|------|-------------|
| `ideas:list` | invoke | List all ideas |
| `ideas:get` | invoke | Get single idea |
| `ideas:create` | invoke | Create new idea |
| `ideas:update` | invoke | Update idea |
| `ideas:delete` | invoke | Delete idea |
| `ideas:move-stage` | invoke | Move to different stage |
| `ideas:add-discussion` | invoke | Add discussion message |
| `ideas:discuss` | invoke | Send message, get AI response |
| `ideas:discuss-stream` | event | Streaming AI response |

**ideas:discuss**
```typescript
// Request
{ ideaId: string; message: string }

// Response
{ response: string; sessionId: string }
```

---

### Outlook Integration

| Channel | Type | Description |
|---------|------|-------------|
| `outlook:configure` | invoke | Save Outlook config |
| `outlook:get-config` | invoke | Get current config |
| `outlook:authenticate` | invoke | Start OAuth flow |
| `outlook:fetch-emails` | invoke | Fetch emails (one-time) |
| `outlook:sync` | invoke | Sync emails to ideas |
| `outlook:sync-stream` | event | Progressive sync updates |
| `outlook:status` | invoke | Get auth status |

**outlook:configure**
```typescript
// Request
{
  clientId: string
  clientSecret?: string
  tenantId: string
  sourceEmailAddress: string
}
```

---

### Ralph Orchestrator (Initiator)

| Channel | Type | Description |
|---------|------|-------------|
| `initiator:start` | invoke | Start requirements gathering |
| `initiator:get-session` | invoke | Get current session |
| `initiator:send-message` | invoke | Send user message |
| `initiator:summarize` | invoke | Generate requirements doc |
| `initiator:generate-prompt` | invoke | Generate execution prompt |
| `initiator:update-prompt` | invoke | Update prompt config |
| `initiator:approve-prompt` | invoke | Approve and proceed |
| `initiator:cancel` | invoke | Cancel session |
| `initiator:response-chunk` | event | Streaming response |
| `initiator:requirements-ready` | event | Requirements doc ready |
| `initiator:prompt-ready` | event | Prompt config ready |

**initiator:start**
```typescript
// Request
{ projectPath: string }

// Response
InitiatorSession
```

---

### Ralph Orchestrator (Execution)

| Channel | Type | Description |
|---------|------|-------------|
| `ralph:start` | invoke | Start execution |
| `ralph:stop` | invoke | Stop execution |
| `ralph:pause` | invoke | Pause execution |
| `ralph:resume` | invoke | Resume execution |
| `ralph:status` | invoke | Get current status |
| `ralph:stream-chunk` | event | Streaming output |
| `ralph:progress` | event | Progress updates |
| `ralph:checkpoint` | event | Checkpoint reached |
| `ralph:error` | event | Error occurred |

**ralph:start**
```typescript
// Request
{
  projectPath: string
  promptConfig: RalphPromptConfig
  worktreePath?: string
}

// Response
{ sessionId: string }
```

---

### Discovery Chat

| Channel | Type | Description |
|---------|------|-------------|
| `discovery:create-session` | invoke | Create discovery session |
| `discovery:send-message` | invoke | Send message |
| `discovery:get-messages` | invoke | Get message history |
| `discovery:cancel-request` | invoke | Cancel current request |
| `discovery:close-session` | invoke | Close session |
| `discovery:response-chunk` | event | Streaming response |
| `discovery:response-complete` | event | Response finished |

---

### Git / Worktree

| Channel | Type | Description |
|---------|------|-------------|
| `git:status` | invoke | Get git status |
| `git:worktree-list` | invoke | List worktrees |
| `git:worktree-create` | invoke | Create worktree |
| `git:worktree-delete` | invoke | Delete worktree |
| `git:worktree-merge` | invoke | Merge worktree to main |
| `git:worktree-diff` | invoke | Get diff vs main |

**git:worktree-create**
```typescript
// Request
{ projectPath: string; branchName: string; baseBranch?: string }

// Response
{ path: string; branch: string }
```

---

### Browser Control

| Channel | Type | Description |
|---------|------|-------------|
| `browser:navigate` | invoke | Navigate to URL |
| `browser:back` | invoke | Go back |
| `browser:forward` | invoke | Go forward |
| `browser:refresh` | invoke | Refresh page |
| `browser:snapshot` | invoke | Get page snapshot |
| `browser:screenshot` | invoke | Take screenshot |

---

### Configuration

| Channel | Type | Description |
|---------|------|-------------|
| `config:get` | invoke | Get config value |
| `config:set` | invoke | Set config value |
| `dialog:select-folder` | invoke | Open folder picker |

---

## API Server (Remote Access)

### Configuration

```typescript
// Default: port 3847
// Auth: Token-based (generated on startup)
```

### REST Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/sessions` | List sessions |
| POST | `/api/sessions` | Create session |
| DELETE | `/api/sessions/:id` | Delete session |
| POST | `/api/sessions/:id/input` | Send input |
| GET | `/api/ideas` | List ideas |
| POST | `/api/ideas` | Create idea |
| GET | `/api/status` | Server status |

### WebSocket

```
ws://localhost:3847/ws?token={auth_token}
```

**Events (Server → Client):**
```typescript
{ type: 'session:output'; sessionId: string; data: string }
{ type: 'session:status'; sessionId: string; status: string }
{ type: 'ideas:update'; idea: Idea }
```

**Commands (Client → Server):**
```typescript
{ type: 'session:input'; sessionId: string; data: string }
{ type: 'session:resize'; sessionId: string; cols: number; rows: number }
```

---

## Preload Bridge

The preload script exposes APIs to the renderer via `window.electron`:

```typescript
window.electron = {
  session: {
    create: (projectPath) => ipcRenderer.invoke('session:create', { projectPath }),
    destroy: (sessionId) => ipcRenderer.invoke('session:destroy', { sessionId }),
    list: () => ipcRenderer.invoke('session:list'),
    sendInput: (sessionId, data) => ipcRenderer.invoke('session:input', { sessionId, data }),
    onOutput: (callback) => ipcRenderer.on('session:output', callback),
    onStatus: (callback) => ipcRenderer.on('session:status', callback),
  },

  bvs: {
    createSession: (projectPath) => ipcRenderer.invoke('bvs:create-session', { projectPath }),
    sendMessage: (sessionId, message) => ipcRenderer.invoke('bvs:send-message', { sessionId, message }),
    answerQuestions: (sessionId, answers) => ipcRenderer.invoke('bvs:answer-questions', { sessionId, answers }),
    selectOption: (sessionId, optionId) => ipcRenderer.invoke('bvs:select-option', { sessionId, optionId }),
    approvePlan: (sessionId) => ipcRenderer.invoke('bvs:approve-plan', { sessionId }),
    clearSession: (projectPath) => ipcRenderer.invoke('bvs:clear-session', { projectPath }),
  },

  ideas: {
    list: () => ipcRenderer.invoke('ideas:list'),
    create: (idea) => ipcRenderer.invoke('ideas:create', idea),
    update: (id, updates) => ipcRenderer.invoke('ideas:update', { id, updates }),
    discuss: (ideaId, message) => ipcRenderer.invoke('ideas:discuss', { ideaId, message }),
  },

  ralph: {
    startInitiator: (projectPath) => ipcRenderer.invoke('initiator:start', { projectPath }),
    sendMessage: (sessionId, message) => ipcRenderer.invoke('initiator:send-message', { sessionId, message }),
    startExecution: (config) => ipcRenderer.invoke('ralph:start', config),
    onProgress: (callback) => ipcRenderer.on('ralph:progress', callback),
    onCheckpoint: (callback) => ipcRenderer.on('ralph:checkpoint', callback),
  },

  config: {
    get: (key) => ipcRenderer.invoke('config:get', { key }),
    set: (key, value) => ipcRenderer.invoke('config:set', { key, value }),
  },

  dialog: {
    selectFolder: (options) => ipcRenderer.invoke('dialog:select-folder', options),
  },
}
```

---

## IPC Handler Files

| File | Purpose |
|------|---------|
| `src/main/ipc/index.ts` | Handler registration |
| `src/main/ipc/bvs-handlers.ts` | BVS Planning Agent |
| `src/main/ipc/ideas-handlers.ts` | Ideas Kanban |
| `src/main/ipc/ralph-handlers.ts` | Ralph Orchestrator |
| `src/main/ipc/initiator-handlers.ts` | Initiator (requirements) |
| `src/main/ipc/discovery-handlers.ts` | Discovery Chat |
| `src/main/ipc/git-handlers.ts` | Git/Worktree |
| `src/main/ipc/autocoder-handlers.ts` | Autocoder UI |
| `src/main/ipc/workflow-handlers.ts` | Workflow management |
| `src/main/ipc/progress-handlers.ts` | Progress watching |
| `src/main/ipc/schema-handlers.ts` | Schema validation |
| `src/main/ipc/venv-handlers.ts` | Python venv |
| `src/main/ipc/context-handlers.ts` | Context gathering |
| `src/main/ipc/preflight-handlers.ts` | Preflight checks |
| `src/main/ipc/journey-handlers.ts` | Journey analysis |
| `src/main/ipc/spec-builder-handlers.ts` | Spec building |
| `src/main/ipc/orchestrator-handlers.ts` | Python orchestrator |

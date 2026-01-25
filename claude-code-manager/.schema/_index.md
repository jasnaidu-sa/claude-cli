# Claude Code Manager - Schema Documentation

> Desktop GUI for managing Claude Code CLI sessions with autonomous coding capabilities.
> Last updated: 2026-01-21

## Quick Navigation

| Section | Description |
|---------|-------------|
| [Database/State](./database/README.md) | Zustand stores, config persistence, session state |
| [API/IPC](./api/README.md) | Electron IPC handlers, API server endpoints |
| [Pages/Views](./pages/README.md) | React components and UI structure |
| [Data Flows](./flows/README.md) | System workflows and data flow diagrams |
| [Patterns](./patterns/) | Reusable technical patterns |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    Claude Code Manager                           │
├─────────────────────────────────────────────────────────────────┤
│  RENDERER (React + Zustand)                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │  Sessions    │  │  Autonomous  │  │   Ideas      │          │
│  │  (Terminal)  │  │  (Ralph)     │  │   (Kanban)   │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │  Browser     │  │  Worktrees   │  │   BVS        │          │
│  │  (Preview)   │  │  (Git)       │  │   (Planning) │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
├─────────────────────────────────────────────────────────────────┤
│  PRELOAD (Context Bridge)                                       │
│  window.electron.* IPC bridge                                   │
├─────────────────────────────────────────────────────────────────┤
│  MAIN PROCESS (Electron + Node.js)                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ Session Mgr  │  │ Ralph Orch   │  │ Ideas Mgr    │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ Git Service  │  │ Discovery    │  │ BVS Planning │          │
│  │ (Worktrees)  │  │ Chat SDK     │  │ Agent V2     │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
├─────────────────────────────────────────────────────────────────┤
│  API SERVER (Express + WebSocket)                               │
│  HTTP REST + WebSocket for remote/mobile access                 │
├─────────────────────────────────────────────────────────────────┤
│  EXTERNAL                                                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ Claude CLI   │  │ Agent SDK    │  │ node-pty     │          │
│  │ (Subprocess) │  │ (Streaming)  │  │ (Terminal)   │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
└─────────────────────────────────────────────────────────────────┘
```

---

## Technology Stack

| Layer | Technology |
|-------|------------|
| Framework | Electron 33 |
| Frontend | React 18, TypeScript 5.7 |
| Styling | Tailwind CSS 3.4 |
| State | Zustand 4.5 |
| Terminal | xterm.js 5.5, node-pty |
| AI Integration | @anthropic-ai/claude-agent-sdk |
| Build | electron-vite, Vite 5 |
| Process | Express 5, WebSocket (ws) |

---

## Core Modules

### 1. Session Manager
Terminal sessions running Claude Code CLI subprocesses.
- **Location**: `src/main/services/session-manager.ts`
- **Features**: PTY management, output streaming, session lifecycle

### 2. Ralph Orchestrator (Autonomous Coding)
End-to-end autonomous coding workflow:
- **Initiator**: Requirements gathering via AI chat
- **Execution**: Parallel worktree execution with checkpoints
- **Location**: `src/main/services/ralph-orchestrator-service.ts`

### 3. Discovery Chat
AI-powered project exploration and planning:
- **SDK Version**: Uses Claude Agent SDK for streaming
- **Location**: `src/main/services/discovery-chat-service-sdk.ts`

### 4. Ideas Kanban
Idea capture, discussion, and project pipeline:
- **Stages**: Inbox → Discussing → Approved → In Progress → Done
- **Outlook Integration**: Email-to-idea sync
- **Location**: `src/main/services/ideas-manager.ts`

### 5. BVS Planning Agent V2
Bounded Verified Sections planning with conversational discovery:
- **Features**: .schema exploration, question cards, implementation options
- **Location**: `src/main/services/bvs-planning-agent-v2.ts`

### 6. Git Worktree Service
Parallel development via git worktrees:
- **Location**: `src/main/services/git-worktree-service.ts`
- **Features**: Create, list, delete worktrees; merge conflict detection

### 7. API Server
HTTP/WebSocket server for remote access:
- **Port**: 3847 (configurable)
- **Auth**: Token-based authentication
- **Location**: `src/main/api-server/index.ts`

---

## File Structure

```
src/
├── main/                      # Electron main process
│   ├── index.ts              # App entry, window creation
│   ├── api-server/           # HTTP/WebSocket API server
│   │   └── index.ts          # Express + WS server
│   ├── ipc/                   # IPC handlers (main ↔ renderer)
│   │   ├── index.ts          # Handler registration
│   │   ├── autocoder-handlers.ts
│   │   ├── bvs-handlers.ts
│   │   ├── discovery-handlers.ts
│   │   ├── git-handlers.ts
│   │   ├── ideas-handlers.ts
│   │   ├── initiator-handlers.ts
│   │   ├── ralph-handlers.ts
│   │   └── ...
│   └── services/              # Business logic
│       ├── session-manager.ts
│       ├── ralph-orchestrator-service.ts
│       ├── discovery-chat-service-sdk.ts
│       ├── ideas-manager.ts
│       ├── bvs-planning-agent-v2.ts
│       ├── git-worktree-service.ts
│       └── ...
├── preload/                   # Context bridge
│   └── index.ts              # window.electron.* APIs
├── renderer/                  # React frontend
│   ├── App.tsx               # Root component, routing
│   ├── components/           # UI components
│   │   ├── layout/           # TitleBar, Sidebar
│   │   ├── session/          # SessionGrid, Terminal
│   │   ├── autonomous/       # Ralph workflow UI
│   │   ├── ideas/            # Ideas Kanban
│   │   ├── bvs/              # BVS Planning UI
│   │   ├── browser/          # Embedded browser
│   │   └── ui/               # Shared UI components
│   ├── stores/               # Zustand stores
│   │   ├── session-store.ts
│   │   ├── ui-store.ts
│   │   └── ...
│   └── hooks/                # Custom React hooks
└── shared/                   # Shared types
    └── types.ts              # TypeScript interfaces
```

---

## Key Concepts

### Session Lifecycle
```
idle → running → thinking → editing → idle
         ↓
       error
```

### Checkpoint Types (Harness Framework)
- `category_complete`: After completing all tests in a category
- `failure_threshold`: When N consecutive failures occur
- `risk_boundary`: Before risky operations (migrations, etc.)
- `feature_complete`: After completing a major feature
- `manual`: User-requested checkpoint

### Idea Stages
```
inbox → discussing → approved → in_progress → done
                                      ↓
                                  archived
```

---

## Communication Patterns

### IPC (Main ↔ Renderer)
```typescript
// Renderer invokes main
const result = await window.electron.session.create(projectPath)

// Main sends to renderer (events)
mainWindow.webContents.send('session:output', data)
```

### API Server (Remote Access)
```typescript
// REST endpoints
GET  /api/sessions
POST /api/sessions/:id/input
GET  /api/ideas

// WebSocket
ws://localhost:3847/ws?token=...
```

### Agent SDK (Claude Integration)
```typescript
// Streaming query with tools
const queryResult = sdk.query({
  prompt: messageGenerator(),
  options: { model, tools, maxTurns }
})

for await (const message of queryResult) {
  // Handle streaming response
}
```

---

## Configuration

### Stored in electron-store
- `claudeCliPath`: Path to Claude CLI
- `defaultProjectsDir`: Default projects directory
- `theme`: 'dark' | 'light' | 'system'
- `autonomous`: Ralph configuration
- `apiServer`: Remote access configuration

### Environment Variables
- `ELECTRON_RENDERER_URL`: Dev server URL
- `CLAUDE_HOME`: Claude CLI home directory

---

## Related Documentation

- [Windows Subprocess Pattern](./patterns/windows-subprocess-stdio.md)
- [Assistant Chat Integration](./assistant-chat-integration.md)

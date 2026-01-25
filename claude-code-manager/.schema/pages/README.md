# Pages & Components

> React component structure for Claude Code Manager.

---

## Application Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  TitleBar (custom window controls)                              │
├─────────┬───────────────────────────────────────────────────────┤
│         │                                                        │
│         │  ┌─────────────────────────────────────────────────┐  │
│ Sidebar │  │  Main Content Area                               │  │
│         │  │  (SessionGrid or Right Panel)                    │  │
│  - Home │  │                                                   │  │
│  - Ideas│  │  ┌───────────────┐  ┌───────────────┐            │  │
│  - BVS  │  │  │  Terminal 1   │  │  Terminal 2   │            │  │
│  - Auto │  │  │  (xterm.js)   │  │  (xterm.js)   │            │  │
│  - Files│  │  └───────────────┘  └───────────────┘            │  │
│  - Git  │  │                                                   │  │
│  - Gear │  └─────────────────────────────────────────────────┘  │
│         │                                                        │
└─────────┴───────────────────────────────────────────────────────┘
```

---

## Component Hierarchy

```
App.tsx
├── TitleBar
├── Sidebar
│   ├── NavItem (Home)
│   ├── NavItem (Ideas)
│   ├── NavItem (BVS Planning)
│   ├── NavItem (Autonomous)
│   ├── NavItem (Files)
│   ├── NavItem (Worktrees)
│   └── NavItem (Settings)
├── SessionGrid
│   └── TerminalCard[]
│       └── Terminal (xterm.js)
├── NewSessionModal
└── Right Panels (conditional)
    ├── Settings
    ├── Browser
    ├── WorktreePanel
    ├── AutonomousView
    ├── IdeasView
    ├── BvsView
    └── FileViewer
```

---

## Main Views

### SessionGrid (`/src/renderer/components/session/`)

Terminal grid for Claude CLI sessions.

**Components:**
- `SessionGrid.tsx` - Grid layout of terminal cards
- `TerminalCard.tsx` - Individual terminal wrapper
- `Terminal.tsx` - xterm.js integration
- `NewSessionModal.tsx` - Create new session dialog

**Features:**
- Configurable grid columns (1-4)
- Status indicators (idle/running/thinking/editing)
- Edited files list per session
- Terminal resize handling

---

### BvsView (`/src/renderer/components/bvs/`)

BVS Planning Agent interface.

**Components:**
- `BvsView.tsx` - Main container
- `BvsPlanningChatV2.tsx` - Chat interface with streaming
- `QuestionsPanel` - Question cards with options
- `OptionsPanel` - Implementation option selection
- `SectionsPanel` - Section review and approval
- `ToolActivityIndicator` - Shows tool execution status

**Features:**
- Project picker
- Start Fresh button
- Streaming responses
- Question cards with custom answer option
- Tool activity indicator ("Analyzing codebase...")
- Plan approval workflow

---

### AutonomousView (`/src/renderer/components/autonomous/`)

Ralph autonomous coding workflow.

**Components:**
- `AutonomousView.tsx` - Main container with phase routing
- `InitiatorChat.tsx` - Requirements gathering chat
- `RequirementsSummary.tsx` - Display requirements doc
- `PromptReview.tsx` - Edit generated prompt
- `ExecutionDashboard.tsx` - Live execution view
- `RalphKanbanBoard.tsx` - Feature progress Kanban
- `RalphProgressPanel.tsx` - Progress stats
- `CheckpointModal.tsx` - Checkpoint approval dialog
- `RalphSessionHistory.tsx` - Past sessions list

**Features:**
- Multi-phase workflow (Initiator → Prompt → Execution)
- Real-time progress updates
- Checkpoint approval/rejection
- Feature Kanban board
- Session history

---

### IdeasView (`/src/renderer/components/ideas/`)

Ideas Kanban board.

**Components:**
- `IdeasView.tsx` - Main Kanban container
- `IdeaColumn.tsx` - Stage column
- `IdeaCard.tsx` - Draggable idea card
- `IdeaDetailPanel.tsx` - Idea details with discussion
- `OutlookSyncPanel.tsx` - Email sync configuration
- `DiscussionChat.tsx` - AI discussion interface

**Features:**
- Drag-and-drop between stages
- Outlook email sync
- AI-powered discussion
- URL content extraction
- Project linking

---

### WorktreePanel (`/src/renderer/components/worktree/`)

Git worktree management.

**Components:**
- `WorktreePanel.tsx` - Main container
- `WorktreeList.tsx` - List of worktrees
- `WorktreeCard.tsx` - Individual worktree
- `CreateWorktreeModal.tsx` - Create new worktree
- `MergeConfirmModal.tsx` - Merge confirmation

**Features:**
- List all worktrees
- Create new worktree
- View diff vs main
- Merge to main
- Delete worktree

---

### Browser (`/src/renderer/components/browser/`)

Embedded browser for previews.

**Components:**
- `Browser.tsx` - Main container
- `BrowserToolbar.tsx` - URL bar, navigation
- `BrowserView.tsx` - webview wrapper

**Features:**
- URL navigation
- Back/Forward/Refresh
- Dev server auto-detection
- Page snapshots

---

### Settings (`/src/renderer/components/settings/`)

Application settings.

**Components:**
- `Settings.tsx` - Settings panel
- `GeneralSettings.tsx` - Theme, paths
- `AutonomousSettings.tsx` - Ralph configuration
- `McpServerSettings.tsx` - MCP server configuration

**Features:**
- Theme selection
- Claude CLI path
- Default projects directory
- MCP server management
- Autonomous coding settings

---

### FileViewer (`/src/renderer/components/file-explorer/`)

File content viewer.

**Components:**
- `FileViewer.tsx` - Code viewer
- `FileTree.tsx` - Directory tree (planned)

**Features:**
- Syntax highlighting
- Read-only view
- Linked from session edited files

---

## Layout Components

### TitleBar (`/src/renderer/components/layout/TitleBar.tsx`)

Custom window title bar (frameless window).

**Features:**
- Window drag region
- Minimize/Maximize/Close buttons
- App title

---

### Sidebar (`/src/renderer/components/layout/Sidebar.tsx`)

Navigation sidebar.

**Features:**
- Collapsible
- Active panel indicator
- New session button
- Grid columns selector

---

## Shared UI Components (`/src/renderer/components/ui/`)

| Component | Purpose |
|-----------|---------|
| `Button.tsx` | Standard button variants |
| `Card.tsx` | Card container |
| `Input.tsx` | Text input |
| `Modal.tsx` | Modal dialog |
| `ResizeHandle.tsx` | Panel resize handle |
| `Spinner.tsx` | Loading indicator |
| `Tooltip.tsx` | Hover tooltips |

---

## State Connections

| View | Store | Key State |
|------|-------|-----------|
| SessionGrid | session-store | `sessions`, `activeSessionId` |
| All views | ui-store | `activePanel`, `theme` |
| BvsView | Local + IPC events | `session`, `messages`, `questions` |
| AutonomousView | Local + IPC events | `phase`, `features`, `progress` |
| IdeasView | Local + IPC | `ideas`, `selectedIdea` |
| Settings | config-store (IPC) | `config` |

---

## Routing (Panel-based)

No traditional routing - panels controlled by `ui-store.activePanel`:

```typescript
type Panel = 'files' | 'browser' | 'settings' | 'worktrees' | 'autonomous' | 'ideas' | 'bvs'

// App.tsx
switch (activePanel) {
  case 'settings': return <Settings />
  case 'browser': return <Browser />
  case 'worktrees': return <WorktreePanel />
  case 'autonomous': return <AutonomousView />
  case 'ideas': return <IdeasView />
  case 'bvs': return <BvsView />
  case 'files': return selectedFile ? <FileViewer /> : null
  default: return null
}
```

---

## Component File Locations

```
src/renderer/
├── App.tsx                          # Root component
├── components/
│   ├── layout/
│   │   ├── TitleBar.tsx
│   │   └── Sidebar.tsx
│   ├── session/
│   │   ├── SessionGrid.tsx
│   │   ├── TerminalCard.tsx
│   │   ├── Terminal.tsx
│   │   └── NewSessionModal.tsx
│   ├── bvs/
│   │   ├── BvsView.tsx
│   │   └── BvsPlanningChatV2.tsx
│   ├── autonomous/
│   │   ├── AutonomousView.tsx
│   │   ├── InitiatorChat.tsx
│   │   ├── ExecutionDashboard.tsx
│   │   ├── RalphKanbanBoard.tsx
│   │   ├── CheckpointModal.tsx
│   │   └── ...
│   ├── ideas/
│   │   ├── IdeasView.tsx
│   │   ├── IdeaColumn.tsx
│   │   ├── IdeaCard.tsx
│   │   └── DiscussionChat.tsx
│   ├── worktree/
│   │   ├── WorktreePanel.tsx
│   │   └── ...
│   ├── browser/
│   │   └── Browser.tsx
│   ├── settings/
│   │   └── Settings.tsx
│   ├── file-explorer/
│   │   └── FileViewer.tsx
│   └── ui/
│       ├── Button.tsx
│       ├── Card.tsx
│       ├── Modal.tsx
│       └── ...
├── stores/
│   ├── session-store.ts
│   └── ui-store.ts
└── hooks/
    ├── useDevServerAutoStart.ts
    └── ...
```

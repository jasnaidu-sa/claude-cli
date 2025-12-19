# index.ts (Preload)

## Purpose
Electron preload script that exposes IPC APIs to the renderer process. Provides a type-safe bridge between the main process and renderer, handling all cross-process communication.

## Interactions

### contextBridge
- Exposes `electronAPI` object to `window.electron`
- All renderer access to main process goes through this API

### ipcRenderer
- Invokes IPC handlers registered in main process
- Sets up event listeners for streamed responses

## API Namespaces

### session
- `get()` / `set()` / `clear()` - Session storage

### config
- `get(key)` / `set(key, value)` - Config store access

### dialog
- `selectFolder()` - Native folder picker

### discovery
- `createSession(path, isNew)` - Create discovery session
- `createFreshSession(path, isNew)` - Archive existing and create fresh
- `sendMessage(sessionId, content)` - Send chat message
- `getMessages(sessionId)` - Get chat history
- `cancelRequest()` - Cancel active request
- `closeSession(sessionId)` - Close session
- **Draft Management:**
  - `listDrafts(projectPath)` - List all drafts with metadata
  - `loadDraft(projectPath, draftId)` - Load specific draft
  - `deleteDraft(projectPath, draftId)` - Delete a draft
- Event listeners: `onResponseChunk`, `onResponseComplete`, `onAgentStatus`, `onError`

### preflight
- `check(path, isNew)` - Run preflight checks
- `runVenvSetup(path)` - Setup Python venv

### journey
- `start(sessionId, path)` - Start journey analysis
- `stop()` - Stop analysis

### workflow
- `create(options)` / `start(id)` / `pause(id)` - Workflow management
- `getAll()` / `getById(id)` / `delete(id)`

### specBuilder
- `buildSpec(sessionId, path)` - Generate spec from discovery
- `regenerateSpec(params)` - Regenerate with feedback

## Key Types

### DraftMetadata
```typescript
interface DraftMetadata {
  id: string
  name: string
  description: string
  createdAt: number
  updatedAt: number
  messageCount: number
  userMessageCount: number
  assistantMessageCount: number
  discoveryReady: boolean
  isNewProject: boolean
  preview: string
}
```

### DiscoverySession
```typescript
interface DiscoverySession {
  id: string
  projectPath: string
  isNewProject: boolean
  messages: DiscoveryChatMessage[]
  agentStatuses: DiscoveryAgentStatus[]
  createdAt: number
  discoveryReady?: boolean
}
```

## Change History
- 2025-12-19: Added draft management APIs (listDrafts, loadDraft, deleteDraft) and DraftMetadata type
- 2025-12-18: Part of Option C architecture implementation

# discovery-chat-service.ts

## Purpose
Service managing the discovery chat conversation with Claude. Handles message streaming, conversation state, agent communication, and multi-draft session management for the discovery phase.

## Interactions

### Claude CLI
- Spawns Claude CLI subprocess for conversation
- Uses `--print --verbose --output-format stream-json` flags
- Streams responses back to renderer

### IPC Events
- Emits stream events for message chunks
- Emits completion events
- Emits error events
- Handles draft management requests

### Store Integration
- Manages conversation history
- Tracks message state
- Manages draft sessions on disk

### File System
- Session storage: `.autonomous/session.json`
- Draft storage: `.autonomous/drafts/{draft-id}/session.json`
- Draft index: `.autonomous/drafts-index.json`

## Data Flow
1. Receives user message from IPC handler
2. Spawns Claude CLI with discovery prompt
3. Streams response chunks back via IPC
4. Updates conversation state on completion
5. Auto-saves session to disk after each message

### Draft Management
1. `saveDraftToDisk()` - Archive session as draft with auto-generated metadata
2. `listDrafts()` - Return all drafts for a project (sorted by updatedAt)
3. `loadDraft()` - Load specific draft by ID
4. `deleteDraft()` - Remove draft and update index
5. `clearSessionFromDisk()` - Archives to drafts before clearing (optional)

## Key Interfaces

### DraftMetadata
```typescript
interface DraftMetadata {
  id: string
  name: string           // Auto-generated from first user message
  description: string    // Auto-generated from conversation topics
  createdAt: number
  updatedAt: number
  messageCount: number
  userMessageCount: number
  assistantMessageCount: number
  discoveryReady: boolean
  isNewProject: boolean
  preview: string        // First user message preview
}
```

## Change History
- 2025-12-19: Added multi-draft session support with timeline view
  - `saveDraftToDisk()`, `listDrafts()`, `loadDraft()`, `deleteDraft()`
  - DraftMetadata interface for timeline display
  - Auto-generated names and descriptions
  - Archive-on-clear pattern
- 2025-12-18: Part of Option C architecture implementation

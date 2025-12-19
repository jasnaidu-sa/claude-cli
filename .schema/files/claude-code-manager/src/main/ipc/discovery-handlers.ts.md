# discovery-handlers.ts

## Purpose
IPC handlers for the discovery chat phase in the autonomous workflow. Registers handlers for discovery-related operations between renderer and main process, including multi-draft session management.

## Interactions

### IPC Channels

#### Session Management
- `DISCOVERY:CREATE_SESSION` - Creates a new discovery chat session
- `DISCOVERY:CREATE_FRESH_SESSION` - Archives existing and creates fresh session
- `DISCOVERY:CHECK_EXISTING_SESSION` - Checks if project has existing session
- `DISCOVERY:SEND_MESSAGE` - Sends user message to discovery agent
- `DISCOVERY:GET_HISTORY` - Retrieves chat history
- `DISCOVERY:GET_SESSION` - Gets session info
- `DISCOVERY:CLOSE_SESSION` - Closes and saves session
- `DISCOVERY:STREAM_*` - Various streaming event channels

#### Draft Management
- `discovery:list-drafts` - Lists all drafts for a project with metadata
- `discovery:load-draft` - Loads a specific draft by ID
- `discovery:delete-draft` - Deletes a draft and updates index

### Services
- `DiscoveryChatService` - Manages discovery conversation state and agent interaction
- Draft functions from discovery-chat-service.ts (`listDrafts`, `loadDraft`, `deleteDraft`)

## Data Flow

### Message Flow
1. Renderer calls IPC handler via preload API
2. Handler validates input and delegates to DiscoveryChatService
3. Service processes request and streams responses back
4. Handler forwards stream events to renderer

### Draft Management Flow
1. `listDrafts(projectPath)` - Returns DraftMetadata[] sorted by updatedAt
2. `loadDraft(projectPath, draftId)` - Returns full session from draft
3. `deleteDraft(projectPath, draftId)` - Removes draft dir and updates index

## Change History
- 2025-12-19: Added draft management IPC handlers (list, load, delete)
- 2025-12-18: Fixed duplicate CREATE_SESSION key issue in channel registration

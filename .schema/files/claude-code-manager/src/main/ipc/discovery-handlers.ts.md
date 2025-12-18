# discovery-handlers.ts

## Purpose
IPC handlers for the discovery chat phase in the autonomous workflow. Registers handlers for discovery-related operations between renderer and main process.

## Interactions

### IPC Channels
- `DISCOVERY:CREATE_SESSION` - Creates a new discovery chat session
- `DISCOVERY:SEND_MESSAGE` - Sends user message to discovery agent
- `DISCOVERY:GET_HISTORY` - Retrieves chat history
- `DISCOVERY:STREAM_*` - Various streaming event channels

### Services
- `DiscoveryChatService` - Manages discovery conversation state and agent interaction

## Data Flow
1. Renderer calls IPC handler via preload API
2. Handler validates input and delegates to DiscoveryChatService
3. Service processes request and streams responses back
4. Handler forwards stream events to renderer

## Change History
- 2025-12-18: Fixed duplicate CREATE_SESSION key issue in channel registration

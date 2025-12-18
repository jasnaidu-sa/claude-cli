# DiscoveryChat.tsx

## Purpose
Phase 2 component for the discovery conversation. Users describe what they want to build through a chat interface. This is conversation-only (no MCP tools during chat per Option C architecture).

## Interactions

### Store Integration
- Uses `useAutonomousStore` for:
  - `chatMessages` - Conversation history
  - `addChatMessage` - Add new message
  - `selectedProject` - Current project context
  - `goToNextPhase` - Navigate to spec generation
  - `discoveryReadiness` - Track readiness for spec gen

### IPC
- Calls discovery service to send messages
- Receives streamed responses

## Data Flow
1. User types message in input
2. Message sent to discovery service via IPC
3. Response streamed back and displayed
4. After MIN_DISCOVERY_MESSAGES, can proceed to spec generation

## UI Elements
- Message list with user/assistant bubbles
- Input field with send button
- Progress indicator
- Continue button (when ready)

## Key Behaviors
- Conversation-only (no MCP tools)
- Minimum 4 user messages before proceeding
- Auto-summarization for context management

## Change History
- 2025-12-18: Part of Option C architecture - conversation only mode

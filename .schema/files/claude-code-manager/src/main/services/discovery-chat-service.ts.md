# discovery-chat-service.ts

## Purpose
Service managing the discovery chat conversation with Claude. Handles message streaming, conversation state, and agent communication for the discovery phase.

## Interactions

### Claude CLI
- Spawns Claude CLI subprocess for conversation
- Uses `--print --verbose --output-format stream-json` flags
- Streams responses back to renderer

### IPC Events
- Emits stream events for message chunks
- Emits completion events
- Emits error events

### Store Integration
- Manages conversation history
- Tracks message state

## Data Flow
1. Receives user message from IPC handler
2. Spawns Claude CLI with discovery prompt
3. Streams response chunks back via IPC
4. Updates conversation state on completion

## Change History
- 2025-12-18: Part of Option C architecture implementation

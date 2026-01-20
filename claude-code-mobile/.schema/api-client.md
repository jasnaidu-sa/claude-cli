# Mobile App API Client

## Overview

The mobile app connects to the Claude Code Manager desktop app via REST API and WebSocket for real-time updates. The API server runs on the desktop and exposes IPC functionality over HTTP.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│ React Native Mobile App                             │
│ - Zustand stores (connection, ralph, ideas)         │
│ - API client (src/api/client.ts)                    │
└────────────────┬────────────────────────────────────┘
                 │ HTTP REST + WebSocket
                 │
┌────────────────▼────────────────────────────────────┐
│ Claude Code Manager (Electron)                      │
│ - API Server (src/main/api-server/index.ts)         │
│ - Express.js REST endpoints                         │
│ - WebSocket for real-time events                    │
└─────────────────────────────────────────────────────┘
```

## Connection Flow

1. User enters server URL and auth token in ConnectScreen
2. `apiClient.configure(serverUrl, authToken)` stores credentials
3. `apiClient.testConnection()` calls `/api/health` to verify
4. On success, `apiClient.connectWebSocket()` establishes real-time connection
5. Credentials stored via platform-aware storage (SecureStore on native, localStorage on web)

## API Endpoints

All endpoints require `Authorization: Bearer <token>` header.

### Health & Info
- `GET /api/health` - Server health check
- `GET /api/info` - Server version info

### Sessions (Terminal)
- `POST /api/sessions` - Create terminal session
- `GET /api/sessions` - List all sessions
- `DELETE /api/sessions/:id` - Close session
- `POST /api/sessions/:id/input` - Send input to session
- `POST /api/sessions/:id/resize` - Resize terminal

### Ralph Loop
- `GET /api/ralph` - List all Ralph sessions
- `GET /api/ralph/:id` - Get session details
- `POST /api/ralph/start` - Start new Ralph session
- `POST /api/ralph/:id/stop` - Stop session
- `POST /api/ralph/:id/pause` - Pause session
- `POST /api/ralph/:id/resume` - Resume session
- `POST /api/ralph/:id/checkpoint/:checkpointId/approve` - Approve checkpoint
- `POST /api/ralph/:id/checkpoint/:checkpointId/skip` - Skip checkpoint
- `POST /api/ralph/:id/checkpoint/:checkpointId/reject` - Reject checkpoint

### Initiator (Requirements Chat)
- `POST /api/initiator/start` - Start requirements chat
- `POST /api/initiator/:id/message` - Send message
- `GET /api/initiator/:id` - Get session state
- `POST /api/initiator/:id/generate` - Generate Ralph prompt
- `POST /api/initiator/:id/approve` - Approve and start Ralph

### Files
- `GET /api/files/read-dir?path=...&depth=...` - List directory
- `GET /api/files/read?path=...` - Read file content

### Config
- `GET /api/config?key=...` - Get config value
- `POST /api/config` - Set config value

## Response Format

Server returns responses in format:
```json
{
  "success": true,
  "sessions": [...],  // or "data", "session", etc.
  "error": "..."      // on failure
}
```

The API client normalizes this to:
```typescript
interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
}
```

## WebSocket Events

### Client → Server
```json
{ "type": "subscribe", "channels": ["ralph:*"] }
{ "type": "unsubscribe", "channels": ["ralph:*"] }
{ "type": "ping" }
```

### Server → Client
```json
{ "channel": "ralph:session:update", "data": {...}, "timestamp": 123 }
{ "channel": "ralph:checkpoint:pending", "data": {...}, "timestamp": 123 }
{ "channel": "initiator:response:chunk", "data": {...}, "timestamp": 123 }
```

## Platform-Aware Storage

The connection store uses a platform-aware wrapper for secure storage:

```typescript
const storage = {
  async getItemAsync(key: string): Promise<string | null> {
    if (Platform.OS === 'web') {
      return localStorage.getItem(key)
    }
    const SecureStore = await import('expo-secure-store')
    return SecureStore.getItemAsync(key)
  },
  // setItemAsync, deleteItemAsync similar
}
```

**Why**: `expo-secure-store` only works on native platforms (iOS/Android), not web.

## Key Files

| File | Purpose |
|------|---------|
| `src/api/client.ts` | API client with all endpoints |
| `src/stores/connection-store.ts` | Connection state management |
| `src/stores/ralph-store.ts` | Ralph session state |
| `src/screens/ConnectScreen.tsx` | Connection UI |
| `src/screens/DashboardScreen.tsx` | Main dashboard |

## Error Handling

The API client handles errors at multiple levels:

1. **Network errors**: Caught in try/catch, returned as `{ success: false, error: "Network error" }`
2. **HTTP errors**: Non-2xx responses return `{ success: false, error: "HTTP 404" }`
3. **Server errors**: Server returns `{ success: false, error: "..." }`

## Security

- Auth token required for all endpoints except `/api/health`
- Token stored securely (SecureStore on native, localStorage on web)
- WebSocket connections authenticated via query parameter
- CORS enabled for cross-origin requests from mobile

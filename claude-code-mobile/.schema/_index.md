# Claude Code Mobile Schema

## Overview

React Native mobile companion app for Claude Code Manager. Connects to the desktop app via REST API and WebSocket for remote monitoring and control.

## Documentation

- [API Client](./api-client.md) - REST API and WebSocket integration

## Project Structure

```
claude-code-mobile/
├── src/
│   ├── api/
│   │   └── client.ts          # API client for desktop connection
│   ├── components/
│   │   ├── AgentMonitorCard.tsx    # Parallel agent status
│   │   ├── MergeConflictCard.tsx   # Conflict resolution UI
│   │   ├── ConnectionBanner.tsx    # Connection status
│   │   └── ...
│   ├── screens/
│   │   ├── ConnectScreen.tsx       # Server connection
│   │   ├── DashboardScreen.tsx     # Main dashboard
│   │   ├── SessionDetailScreen.tsx # Ralph session details
│   │   └── ...
│   ├── stores/
│   │   ├── connection-store.ts     # Connection state
│   │   ├── ralph-store.ts          # Ralph sessions
│   │   └── ideas-store.ts          # Ideas/Kanban
│   ├── services/
│   │   └── NotificationService.ts  # Push notifications
│   └── types/
│       └── index.ts                # TypeScript types
├── App.tsx                         # Root component
└── app.json                        # Expo config
```

## Key Features

1. **Remote Connection** - Connect to desktop app via local network
2. **Session Monitoring** - View active Ralph Loop sessions
3. **Checkpoint Approval** - Approve/reject checkpoints remotely
4. **Parallel Execution** - Monitor multiple agents running in parallel
5. **Merge Conflict Resolution** - Review AI-resolved conflicts
6. **Push Notifications** - Get notified of checkpoints and errors

## Platform Support

- iOS (via Expo)
- Android (via Expo)
- Web (via react-native-web)

## Web-Specific Notes

When running on web (`npx expo start --web`):
- `expo-secure-store` is not available - uses `localStorage` instead
- Push notifications are not supported
- Some native features may be limited

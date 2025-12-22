# auth-manager.ts

**Last Updated**: 2025-12-22

## Overview

Centralized authentication manager that provides unified access to Claude authentication across all services in the Electron application. Handles OAuth tokens from Claude CLI and API key fallbacks.

## Purpose

Eliminates authentication duplication and ensures all services (orchestrator, AI merge conflict resolution, discovery chat, research agents) use the same authentication source with consistent token validation and caching.

## Key Components

### AuthManager Class

Singleton service managing Claude authentication with smart caching and expiration handling.

**Authentication Sources (Priority Order)**:
1. **OAuth Token** - `~/.claude/.credentials.json` (from `claude auth login`)
2. **ANTHROPIC_API_KEY** - Environment variable
3. **CLAUDE_API_KEY** - Alternative environment variable
4. **ANTHROPIC_SESSION_KEY** - Manual override

### Core Methods

#### `getAuthToken(): Promise<string | null>`
Returns the first available authentication token from priority list.

**Caching Strategy**:
- OAuth tokens: 4 minutes (refresh before 5-minute expiration buffer)
- API keys: 1 hour (static tokens)

**Returns**: Authentication token or null if none available

#### `getClaudeOAuthToken(): Promise<string | undefined>`
Reads OAuth token from Claude CLI credentials file.

**Token Validation**:
- Checks `~/.claude/.credentials.json` exists
- Parses `claudeAiOauth.accessToken`
- Validates `expiresAt > now + 5 minutes`
- Returns undefined if expired or missing

**Error Handling**: Silently returns undefined for missing files (not an error condition)

#### `isAuthAvailable(): Promise<boolean>`
Checks if any authentication method is configured.

**Use Case**: UI can call this to show/hide AI features

#### `clearCache(): void`
Forces token refresh on next request.

**Use Case**: Called after authentication changes or errors

## Integration Points

### Services Using AuthManager

1. **claude-api-service.ts**
   - AI merge conflict resolution
   - Calls `getAuthToken()` before each API request

2. **git-service.ts**
   - `isAIResolutionAvailable()` checks auth availability
   - Returns boolean for UI feature toggling

3. **orchestrator-runner.ts**
   - Could be migrated to use AuthManager (currently has duplicate logic)
   - Same OAuth source, different implementation

## OAuth Credentials Format

**File**: `~/.claude/.credentials.json`

```json
{
  "claudeAiOauth": {
    "accessToken": "sk-ant-...",
    "expiresAt": 1735123456789
  }
}
```

**Created By**: `claude auth login` command from Claude CLI

## Token Expiration

### OAuth Tokens
- Typical lifetime: Hours to days
- Validation buffer: 5 minutes before expiration
- Refresh trigger: Cache expires after 4 minutes

### API Keys
- No expiration
- Cached for 1 hour to reduce file I/O

## Error Scenarios

### Missing Credentials File
- **Behavior**: Returns null, falls back to environment variables
- **Not an Error**: User may be using API keys instead

### Expired Token
- **Behavior**: Logs warning, returns null
- **User Action**: Run `claude auth login` to refresh

### Invalid JSON
- **Behavior**: Catches parse error, returns null
- **Logged**: Warning with error message

## Usage Example

```typescript
import { authManager } from './auth-manager';

// Check if AI features should be enabled
const isAvailable = await authManager.isAuthAvailable();

// Get token for API request
const token = await authManager.getAuthToken();
if (!token) {
  throw new Error('Authentication required');
}

// Use token in API call
const response = await fetch(API_URL, {
  headers: {
    'x-api-key': token
  }
});
```

## Benefits

### For Max Plan Users
✅ Automatic OAuth token usage from `claude auth login`
✅ No manual token extraction needed
✅ Seamless integration with existing auth
✅ Automatic expiration handling

### For API Key Users
✅ Standard environment variable support
✅ Fallback when OAuth not configured
✅ Same API for all users

### For Developers
✅ Single source of truth for authentication
✅ Consistent error messages
✅ Easy to test and mock
✅ Reduces code duplication

## Security Considerations

- **Token Storage**: Reads from secure user home directory
- **No Token Logging**: Access tokens never logged
- **Cache Duration**: Conservative (4 min) to avoid stale tokens
- **Validation**: Always checks expiration before returning cached token

## Future Enhancements

- [ ] Token refresh API integration
- [ ] Multiple credential profile support
- [ ] Metrics for auth failures
- [ ] Integration with Electron secure storage

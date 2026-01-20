# Project Assistant Chat Integration

## Overview

The Project Assistant provides a read-only conversational AI interface for users to ask questions about their project's codebase, features, and progress. It uses the Claude Agent SDK to create isolated chat sessions with proper security constraints.

## Architecture

```
┌─────────────────────────────────────────────────┐
│ React UI (AutonomousView)                      │
│ - Project Assistant button                     │
│ - Chat interface with message streaming        │
└────────────────┬────────────────────────────────┘
                 │ WebSocket (/api/assistant/ws)
                 │
┌────────────────▼────────────────────────────────┐
│ FastAPI Backend (assistant_chat.py)            │
│ - WebSocket message routing                    │
│ - Session lifecycle management                 │
└────────────────┬────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────┐
│ AssistantChatSession (assistant_chat_session.py)│
│ - Claude SDK client initialization             │
│ - Read-only tool permissions                   │
│ - MCP server configuration                     │
│ - Conversation persistence (SQLite)            │
└────────────────┬────────────────────────────────┘
                 │ stdio JSON protocol
                 │
┌────────────────▼────────────────────────────────┐
│ Claude Agent SDK Bundled CLI                   │
│ - claude.exe (bundled with SDK)                │
│ - Project-specific CLAUDE_HOME                 │
│ - Copied session-env for auth                  │
└─────────────────────────────────────────────────┘
```

## Key Components

### 1. Session Management (`assistant_chat_session.py`)

**Initialization Flow:**
```python
session = AssistantChatSession(project_name, project_dir)
async for chunk in session.start():
    # Yields: conversation_created, text, response_done
    pass
```

**Critical Configuration:**

1. **Use Bundled CLI (Windows Fix)**:
   ```python
   system_cli = None  # Uses SDK's bundled claude.exe
   # Located at: {venv}/Lib/site-packages/claude_agent_sdk/_bundled/claude.exe
   ```

   **Why**: npm-installed `claude.CMD` uses Windows CMD wrapper which buffers stdio and breaks the SDK's JSON protocol handshake. The bundled CLI has proper unbuffered stdio handling.

2. **Project-Specific CLAUDE_HOME**:
   ```python
   project_claude_dir = self.project_dir / ".claude"
   claude_env["CLAUDE_HOME"] = str(project_claude_dir.resolve())
   ```

   **Why**: Avoids lock file conflicts (`history.jsonl.lock`) with user's main Claude Code session.

3. **Copy Authentication Credentials**:
   ```bash
   cp -r ~/.claude/session-env {project}/.claude/session-env
   ```

   **Why**: Custom CLAUDE_HOME requires auth credentials in project directory for API access.

4. **Windows ProactorEventLoopPolicy**:
   ```python
   if sys.platform == 'win32':
       asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
   ```

   **Why**: Windows requires ProactorEventLoop for subprocess stdio support (SelectorEventLoop doesn't support it).

5. **30-Second Timeout**:
   ```python
   await asyncio.wait_for(self.client.__aenter__(), timeout=30.0)
   ```

   **Why**: First initialization takes 18-20 seconds (bundled CLI startup, auth, MCP server, handshake).

### 2. Read-Only Permissions

**Allowed Tools** (no Write/Edit/Bash):
```python
READONLY_BUILTIN_TOOLS = [
    "Read",
    "Glob",
    "Grep",
    "WebFetch",
    "WebSearch",
]

READONLY_FEATURE_MCP_TOOLS = [
    "mcp__features__feature_get_stats",
    "mcp__features__feature_get_next",
    "mcp__features__feature_get_for_regression",
]
```

**Permission Mode**:
```python
permission_mode="bypassPermissions"  # Safe because only read-only tools
```

### 3. MCP Server Configuration

**Features MCP** (read-only feature management):
```python
mcp_servers = {
    "features": {
        "command": sys.executable,
        "args": ["-m", "mcp_server.feature_mcp"],
        "env": {
            "PROJECT_DIR": str(self.project_dir.resolve()),
            "PYTHONPATH": str(ROOT_DIR.resolve()),
            # Minimal env vars to avoid Windows command line length limits
            "PATH": os.environ.get("PATH", ""),
            "SYSTEMROOT": os.environ.get("SYSTEMROOT", ""),
            "TEMP": os.environ.get("TEMP", ""),
            "TMP": os.environ.get("TMP", ""),
        },
    },
}
```

### 4. Conversation Persistence

**Database** (`assistant_database.py`):
- SQLite: `{project}/.claude/assistant_conversations.db`
- Tables: `conversations`, `messages`
- Schema:
  ```sql
  CREATE TABLE conversations (
      id INTEGER PRIMARY KEY,
      project_name TEXT,
      created_at TEXT
  );

  CREATE TABLE messages (
      id INTEGER PRIMARY KEY,
      conversation_id INTEGER,
      role TEXT,  -- 'user' or 'assistant'
      content TEXT,
      created_at TEXT,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id)
  );
  ```

### 5. WebSocket Protocol

**Client → Server Messages**:
```typescript
{ type: 'start' }  // Initialize session
{ type: 'message', content: string }  // User message
{ type: 'ping' }  // Keep-alive
```

**Server → Client Messages**:
```typescript
{ type: 'conversation_created', conversation_id: number }
{ type: 'text', content: string }  // Streaming response
{ type: 'tool_call', tool: string, input: object }
{ type: 'response_done' }
{ type: 'error', content: string }
```

## System Prompt

Generated dynamically with project context:

```python
def get_system_prompt(project_name: str, project_dir: Path) -> str:
    # Includes:
    # - Project specification (prompts/app_spec.txt)
    # - Read-only tool list
    # - Feature management tools
    # - Guidelines for explaining code
```

**Key Instructions**:
- You have READ-ONLY access
- Cannot modify files
- Direct users to main coding agent for changes
- Reference specific file paths and line numbers
- Use feature tools to answer progress questions

## Session Registry

**Thread-Safe Global Registry**:
```python
_sessions: dict[str, AssistantChatSession] = {}
_sessions_lock = threading.Lock()

# One session per project name
get_session(project_name) -> AssistantChatSession | None
create_session(project_name, project_dir) -> AssistantChatSession
remove_session(project_name) -> None
cleanup_all_sessions() -> None  # On server shutdown
```

## Performance Characteristics

| Metric | Value | Notes |
|--------|-------|-------|
| First initialization | 18-20s | Bundled CLI startup + auth + MCP |
| Subsequent queries | <2s | Subprocess stays alive |
| Memory overhead | ~95MB | Python backend process |
| Concurrent sessions | Multiple | One per project |

## Error Handling

**Common Issues**:

1. **Timeout (>30s)**:
   - Check: Using bundled CLI (cli_path=None)?
   - Check: session-env copied to project .claude?
   - Check: ProactorEventLoopPolicy set on Windows?

2. **Permission Denied**:
   - Cause: Trying to pass command with args as cli_path
   - Fix: Use single executable (None for bundled)

3. **Lock File Conflict**:
   - Cause: Using same CLAUDE_HOME as main session
   - Fix: Project-specific .claude directory

4. **Authentication Failed**:
   - Cause: Missing session-env in project directory
   - Fix: Copy from ~/.claude/session-env

## Testing

**Manual Test**:
```bash
# 1. Start Electron app
npm run dev

# 2. Navigate to Autocoder section
# 3. Click "Project Assistant" button
# 4. Wait 18-20 seconds for initialization
# 5. Verify greeting appears
# 6. Send test message: "What features are pending?"
```

**Automated Test** (future):
```python
async def test_assistant_initialization():
    session = AssistantChatSession("test-project", Path("/test"))
    messages = [msg async for msg in session.start()]
    assert any(msg['type'] == 'conversation_created' for msg in messages)
    assert any(msg['type'] == 'text' for msg in messages)
    await session.close()
```

## Security Considerations

1. **Read-Only**: No Write, Edit, or Bash tools available
2. **Sandboxed**: Project directory isolation via CLAUDE_HOME
3. **No Shell Access**: Bash disabled to prevent command execution
4. **Bypass Permissions**: Safe because tools are read-only
5. **Session Isolation**: Each project gets independent session

## Future Improvements

1. **Caching**: Pre-warm bundled CLI on app startup
2. **Progress Indicator**: Show initialization status during 20s wait
3. **Session Reuse**: Keep subprocess alive between UI reopens
4. **Parallel Init**: Start initialization when project is selected
5. **Debug Mode**: Optional verbose logging for troubleshooting

# Windows Claude Agent SDK Subprocess Initialization Timeout

## Problem

Project Assistant feature was stuck in loading state and timing out after 30 seconds with error:
```
Claude CLI initialization timeout - subprocess not responding
```

The subprocess would start (confirmed via PID) but never complete the JSON protocol handshake with the Claude Agent SDK.

## Root Cause

**Windows CMD wrapper stdio buffering issue**

When using the npm-installed Claude CLI (`claude.CMD`), Windows wraps the command in `cmd.exe`, which buffers stdin/stdout. The Claude Agent SDK uses an unbuffered JSON protocol over stdio for communication with the CLI subprocess. The buffering prevented the initialization handshake from completing.

**Sequence of failures:**
1. ❌ Using `claude.CMD` from npm → subprocess starts but times out (CMD wrapper buffers stdio)
2. ❌ Creating custom `.bat` wrapper → subprocess starts but times out (batch files still wrapped in cmd.exe)
3. ❌ Creating Python wrapper with `subprocess.run()` → Permission denied (SDK needs single executable, not command with args)
4. ✅ **Using SDK's bundled Claude CLI** → Success!

## Solution

Use the Claude Agent SDK's bundled Claude CLI instead of the npm-installed version:

```python
# assistant_chat_session.py line ~211
system_cli = None  # None = use bundled CLI
```

The bundled CLI is located at:
```
{venv}/Lib/site-packages/claude_agent_sdk/_bundled/claude.exe
```

This CLI is specifically designed for SDK subprocess integration with proper unbuffered stdio handling.

## Additional Requirements

1. **Project-specific CLAUDE_HOME**: Set to avoid lock file conflicts with main Claude Code session
   ```python
   claude_env["CLAUDE_HOME"] = str(project_claude_dir.resolve())
   ```

2. **Copy authentication credentials**: The project-specific .claude directory needs session-env
   ```bash
   cp -r ~/.claude/session-env {project}/.claude/session-env
   ```

3. **Windows ProactorEventLoopPolicy**: Required for subprocess support
   ```python
   asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
   ```

4. **30-second timeout**: Initialization takes 18-20 seconds on first run (acceptable)

## Performance Notes

**First initialization**: 18-20 seconds
- Bundled CLI startup overhead
- API authentication with copied session-env
- MCP server subprocess initialization (features MCP)
- JSON handshake completion

**Subsequent interactions**: Much faster (subprocess stays alive)

## Files Modified

- `claude-code-manager/python/autocoder/server/services/assistant_chat_session.py:208-212`

## Related Issues

- Windows asyncio event loop policy (fixed)
- Lock file conflicts with main Claude session (fixed via project-specific CLAUDE_HOME)
- Authentication credentials missing (fixed via session-env copy)

## Testing

1. Navigate to Autocoder section in Electron app
2. Click "Project Assistant" button
3. Wait 18-20 seconds for initialization
4. Assistant greeting should appear successfully

## References

- [Claude Agent SDK Python](https://github.com/anthropics/claude-agent-sdk-python)
- [Agent SDK Bundled CLI](https://platform.claude.com/docs/en/agent-sdk/python)

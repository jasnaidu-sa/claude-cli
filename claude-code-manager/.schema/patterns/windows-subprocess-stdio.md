# Windows Subprocess STDIO Buffering Pattern

## Problem Category

When spawning subprocesses on Windows that communicate via stdin/stdout using line-based or JSON protocols, CMD/batch wrappers can buffer the streams and break the communication.

## Common Symptoms

- Subprocess starts successfully (PID exists)
- Subprocess appears to be running
- No output in debug logs
- Parent process times out waiting for response
- Works on Linux/Mac, fails on Windows

## Root Cause

**Windows CMD Wrapper Buffering**

npm-installed CLI tools (like `claude`, `node`, etc.) use wrapper scripts:
- Unix: Shell script (`#!/bin/sh`)
- Windows: Batch file (`.CMD`) or PowerShell (`.ps1`)

When you execute `claude` on Windows, it actually runs:
```
cmd.exe /c claude.CMD [args]
```

This introduces stdio buffering that breaks unbuffered protocols.

## Solution Patterns

### Pattern 1: Use Direct Executable (Preferred)

**Instead of npm wrapper:**
```python
# ❌ Buffered
cli_path = shutil.which("claude")  # → C:\...\npm\claude.CMD

# ✅ Unbuffered
cli_path = None  # Use bundled executable
```

**For bundled tools (like Claude SDK):**
```python
# SDK bundles claude.exe specifically to avoid this
# Located at: {venv}/Lib/site-packages/claude_agent_sdk/_bundled/claude.exe
options = ClaudeAgentOptions(cli_path=None)  # Uses bundled
```

### Pattern 2: Locate Underlying Executable

**Find the actual .exe:**
```python
# Read the CMD wrapper to find the real executable
npm_dir = Path(os.environ.get("APPDATA")) / "npm"
cli_js = npm_dir / "node_modules" / "@anthropic-ai" / "claude-code" / "cli.js"

# Use node.exe directly
node_path = shutil.which("node")  # C:\Program Files\nodejs\node.exe
cli_path = node_path  # Pass node, not claude wrapper
cli_args = [str(cli_js)]  # Pass cli.js as argument
```

**⚠️ Warning**: Many subprocess libraries expect single executable, not command+args.

### Pattern 3: Python os.execv() Wrapper

**Create unbuffered Python wrapper:**
```python
wrapper = """
import sys
import os
os.execv({node_path!r}, [{node_path!r}, {cli_js!r}, *sys.argv[1:]])
"""
wrapper_file.write_text(wrapper)

# Execute wrapper with Python
cli_path = f'"{sys.executable}" "{wrapper_file}"'
```

**⚠️ Warning**: Still passes command+args, may fail with libraries expecting single executable.

### Pattern 4: Avoid Wrappers Entirely

**Use language-specific subprocess APIs:**
```python
# Instead of shelling out to CLI
import subprocess
result = subprocess.run(
    ["node", "cli.js", *args],
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    text=False,  # Binary mode for unbuffered
)
```

**Best for**: Direct integration, not delegating to SDK/library.

## Claude Agent SDK Specific

### Windows Requirements

1. **Use Bundled CLI**:
   ```python
   cli_path = None  # SDK default
   ```

2. **ProactorEventLoopPolicy**:
   ```python
   if sys.platform == 'win32':
       asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
   ```

3. **Project-Specific Environment**:
   ```python
   # Avoid lock file conflicts
   env["CLAUDE_HOME"] = str(project_dir / ".claude")
   # Copy authentication
   shutil.copytree("~/.claude/session-env", project_dir / ".claude" / "session-env")
   ```

### Debugging Checklist

When subprocess communication fails on Windows:

- [ ] Is the CLI a npm wrapper (`.CMD`, `.ps1`)?
- [ ] Does the protocol use unbuffered stdin/stdout?
- [ ] Is there a bundled executable available?
- [ ] Can you use the underlying .exe directly?
- [ ] Is ProactorEventLoopPolicy set (for asyncio)?
- [ ] Are environment variables properly inherited?
- [ ] Is the subprocess actually starting? (check PID)
- [ ] Is stderr being captured? (may show errors)

## Other Affected Scenarios

This pattern applies to any Windows subprocess using stdio protocols:

- **MCP Servers**: Model Context Protocol servers using stdio transport
- **Language Servers**: LSP servers (TypeScript, Python, etc.)
- **CLI Tools**: Any npm-installed CLI using JSON/line protocols
- **IPC**: Inter-process communication via pipes
- **REPL Integration**: Read-eval-print loops over stdin/stdout

## Performance Impact

**Buffering overhead:**
- Adds 5-10ms latency per message
- Batches messages unpredictably
- Can cause 1-2 second delays for small messages
- May block indefinitely on flush

**Unbuffered (direct executable):**
- Immediate message passing
- Predictable latency
- No unexpected blocking

## Testing

**Verify unbuffered communication:**
```python
import subprocess
import time

proc = subprocess.Popen(
    [cli_path, "agent"],
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
)

# Send message
start = time.time()
proc.stdin.write(b'{"type":"init"}\n')
proc.stdin.flush()

# Read response
response = proc.stdout.readline()
elapsed = time.time() - start

print(f"Response time: {elapsed*1000:.0f}ms")
# Should be < 100ms for unbuffered
```

## References

- [Windows Subprocess MSDN](https://docs.microsoft.com/en-us/windows/win32/procthread/creating-processes)
- [Python asyncio Windows](https://docs.python.org/3/library/asyncio-platforms.html#windows)
- [Node.js child_process Windows](https://nodejs.org/api/child_process.html#child_process_spawning_bat_and_cmd_files_on_windows)

## Related Issues

- `.schema/assistant-chat-integration.md` - Claude SDK subprocess
- `.claude-context/solutions/windows-claude-sdk-subprocess-timeout.md` - Specific fix

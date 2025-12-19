# context-handlers.ts

**NOTE**: This file was created as part of initial Context Agent exploration but is NOT currently used. The Context Agent was revised to be a module inside the Python orchestrator, not a subprocess.

## Original Purpose

Electron IPC handlers for Context Agent operations when it was designed as a subprocess (like research-agent-runner).

## Status

**OBSOLETE** - Context Agent is now integrated as a module in `autonomous-orchestrator/agent.py`, not spawned as subprocess.

## What Remains

This file provides TypeScript types and IPC patterns that may be useful if we later add UI visibility for Context Agent operations, but the subprocess spawning pattern was abandoned.

## Architecture Change

**Original Design** (subprocess):
```
Electron → IPC → context-agent-runner.ts → spawn Python subprocess
```

**Current Design** (module):
```
Python orchestrator → context_agent.py (module, not subprocess)
```

## Related Files

- `context-agent-runner.ts` - Also obsolete, subprocess runner
- `autonomous-orchestrator/context_agent.py` - Actual implementation (module)
- `autonomous-orchestrator/agent.py` - Integration point

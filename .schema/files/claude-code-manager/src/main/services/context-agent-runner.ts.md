# context-agent-runner.ts

**NOTE**: This file was created as part of initial Context Agent exploration but is NOT currently used. The Context Agent was revised to be a module inside the Python orchestrator, not a subprocess.

## Original Purpose

TypeScript service for spawning Context Agent as a subprocess (following research-agent-runner.ts pattern).

## Status

**OBSOLETE** - Context Agent is now integrated as a module in `autonomous-orchestrator/agent.py`, not spawned as subprocess.

## Architecture Change

The user corrected the architecture:
> "note that these agents will be in the python process and not in electron by itself. it is there to augment the two agent system that does work autonomously."

**Original Design** (subprocess):
```typescript
class ContextAgentRunner {
  async summarizeContext(request) {
    // Spawn Python subprocess
    const process = spawn('python', ['context_agent.py'])
    // Read stdout/stderr
  }
}
```

**Current Design** (module):
```python
class AutonomousAgent:
    def __init__(self, config):
        self.context_agent = ContextAgent(project_path)  # Module, not subprocess
```

## What Remains

This file demonstrates subprocess spawning patterns that may be useful for other agents, but is not actively used.

## Related Files

- `context-handlers.ts` - Also obsolete, IPC handlers
- `autonomous-orchestrator/context_agent.py` - Actual implementation (module)
- `autonomous-orchestrator/harness_agent.py` - Base class for module-based agents

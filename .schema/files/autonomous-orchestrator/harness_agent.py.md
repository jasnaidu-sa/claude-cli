# harness_agent.py

Base class for harness agents that augment the autonomous orchestrator.

## Purpose

Provides common patterns for agent coordination via blackboard pattern. All harness agents (Context, Checkpoint, Impact) extend this base class.

## Key Classes

### `AgentState`
- **Purpose**: Track agent execution state
- **Fields**: phase, progress, message, started_at

### `HarnessAgent`
- **Purpose**: Base class for all harness agents
- **Key Methods**:
  - `read_blackboard()` - Read shared state from `.autonomous/state/execution-state.json`
  - `write_blackboard(updates)` - Merge updates into shared state
  - `emit_progress(phase, progress, message)` - Emit progress for visibility
  - `emit_error(error)` - Log error without crashing orchestrator
  - Utility methods: `ensure_directory()`, `read_json_file()`, `write_json_file()`

## Architecture

Harness agents:
- Live INSIDE the Python orchestrator process (not subprocesses)
- Coordinate via blackboard pattern (shared JSON file)
- Are stateless (read state from disk each time)
- Emit progress to stdout for orchestrator to capture
- Are fault-tolerant (errors logged, not crashed)

## Blackboard Pattern

All agents read/write to `.autonomous/state/execution-state.json`:
```python
{
  "contextSummary": {...},
  "checkpointDecision": {...},
  "impactFlags": [...],
  "lastUpdated": timestamp
}
```

## Usage

```python
from harness_agent import HarnessAgent

class MyAgent(HarnessAgent):
    def __init__(self, project_path: Path):
        super().__init__(project_path)

    def do_work(self):
        self.start_phase("working", "Starting...")

        # Read state
        state = self.read_blackboard()

        # Do work
        self.emit_progress("working", 50, "Halfway...")

        # Update state
        self.write_blackboard({"myValue": 42})

        self.complete_phase("Done")
```

## Related Files

- `context_agent.py` - Context Agent implementation
- `agent.py` - Orchestrator that uses harness agents
- `.claude/skills/agent-harness/skill.md` - Full documentation

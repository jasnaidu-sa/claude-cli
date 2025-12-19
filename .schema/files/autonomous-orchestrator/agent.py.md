# agent.py

Main autonomous coding agent with Context Agent integration.

## Purpose

Implements the main session loop for autonomous coding. Coordinates with Claude API and integrates Context Agent for compressed context management.

## Key Classes

### `AgentState`
- **Purpose**: Track agent execution state
- **Fields**: iteration, phase, status, started_at, current_test, tests_total, tests_passing, tests_failing, errors, paused

### `AutonomousAgent`
- **Purpose**: Main orchestrator for autonomous coding
- **Key Attributes**:
  - `config` - Agent configuration
  - `client` - Claude API client
  - `security` - Bash security filter
  - `state` - Agent state
  - `context_agent` - **NEW**: Context Agent instance
  - `completed_features` - **NEW**: List of completed feature IDs
  - `features_since_last_summary` - **NEW**: Counter for summarization trigger

## Context Agent Integration

### Initialization (line 45-56)
```python
def __init__(self, config):
    # ... existing init ...
    self.context_agent = ContextAgent(config.get_project_root())
    self.completed_features = []
    self.features_since_last_summary = 0
```

### New Methods

#### `write_feature_log(feature)` (line 288-306)
- **Purpose**: Write feature completion log for Context Agent
- **Output**: `.autonomous/logs/{feature-id}.json`
- **Called**: After each feature completes

#### `inject_context(base_message, feature_id)` (line 308-341)
- **Purpose**: Inject compressed context into feature prompt
- **Returns**: Enriched message with context section
- **Format**:
  - Running summary
  - Top 3 key decisions
  - Top 2 recent failures (with prevention tips)
  - All active constraints
- **Fallback**: Returns base message if context injection fails

#### `trigger_context_summarization()` (line 343-366)
- **Purpose**: Trigger context summarization after batch
- **Called**: Every 5 features + at workflow end
- **Updates**: Compressed summary, decisions, failures, constraints

### Implementation Loop Changes (line 182-298)

**Before feature execution**:
1. Set feature ID and start timestamp
2. Build base message
3. **Inject context** using `inject_context()`

**After feature execution**:
1. Check if tests passed
2. **Write feature log** using `write_feature_log()`
3. Track completed feature ID
4. Increment features counter
5. **Trigger summarization every 5 features**

**After all features**:
1. **Final summarization** for remaining features

## Phases

1. **validation**: Schema validation phase
2. **generation**: Test generation phase
3. **implementation**: Main implementation loop (Context Agent active here)

## Data Flow

```
Feature Start
    ↓
inject_context(feature_id)
    ↓ Calls ContextAgent.get_injection()
    ↓ Returns: summary, decisions, failures, constraints (<2K tokens)
    ↓
Send enriched message to Claude
    ↓
Feature Complete
    ↓
write_feature_log(feature)
    ↓ Writes to .autonomous/logs/{id}.json
    ↓
Track completed feature
    ↓
Check count (every 5 features)
    ↓
trigger_context_summarization()
    ↓ Calls ContextAgent.summarize()
    ↓ Updates: running-summary, decisions, failures, constraints
```

## Configuration

Uses `AgentConfig` from `config.py`:
- `project_path` - Project root
- `phase` - Current phase
- `max_iterations` - Max iteration limit
- `pause_on_error` - Pause on errors

## Related Files

- `context_agent.py` - Context Agent implementation
- `harness_agent.py` - Base class for agents
- `config.py` - Agent configuration
- `client.py` - Claude API client
- `.claude-context/CONTEXT_AGENT_INTEGRATION.md` - Integration details

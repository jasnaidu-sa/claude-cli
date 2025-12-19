# context_agent.py

Context Agent for maintaining compressed, relevant context during autonomous execution.

## Purpose

Solves the "lost in the middle" problem by maintaining compressed context under 2K tokens. Part of the Agent Harness Framework (Phase 1).

## Key Classes

### `RunningSummary`
- **Fields**: content, token_count, updated_at, trigger, features_since_last_update, total_features_completed
- **Purpose**: Compressed summary of project state (max 2K tokens)

### `KeyDecision`
- **Fields**: id, feature_id, decision, rationale, impact, timestamp, category
- **Purpose**: Track critical design decisions

### `FailureRecord`
- **Fields**: id, feature_id, description, root_cause, resolution, prevention, timestamp, severity
- **Purpose**: Record failures with root causes for learning

### `ActiveConstraint`
- **Fields**: id, description, reason, affected_areas, added_at, expires_at, type
- **Purpose**: Track active constraints limiting implementation

### `ContextAgent`
- **Extends**: `HarnessAgent`
- **Key Methods**:
  - `summarize(completed_features, trigger, category_id)` - Main summarization
  - `get_injection(feature_id)` - Get context for feature execution
  - `load_running_summary()`, `save_running_summary()` - Persistence
  - `load_decisions()`, `save_decisions()` - Decision management
  - `load_failures()`, `save_failures()` - Failure tracking
  - `load_constraints()`, `save_constraints()` - Constraint management

## Workflow

### Summarization Triggers
1. **Every 5 features**: `trigger="feature_count"`
2. **After category**: `trigger="category_complete"`
3. **Manual**: `trigger="manual"`

### Summarization Process
1. Load existing context (summary, decisions, failures, constraints)
2. Load feature logs for completed features
3. Compress old summary, add new information
4. Extract decisions/failures from logs
5. Update constraints (remove expired)
6. Save everything to `.autonomous/context/`
7. Update blackboard state

### Context Injection
Before each feature execution:
1. Get relevant context (<2K tokens)
2. Include: summary, top 3 decisions, top 2 failures, all constraints
3. Inject into feature prompt

## Storage

`.autonomous/context/`:
- `running-summary.json` - Compressed summary (max 2K tokens)
- `key-decisions.json` - Top 20 recent decisions
- `failure-memory.json` - Top 10 recent failures
- `active-constraints.json` - Active constraints

`.autonomous/logs/`:
- `{feature-id}.json` - Feature completion logs

`.autonomous/state/`:
- `execution-state.json` - Blackboard state

## Token Budgets

- Running Summary: Max 2000 tokens
- Context Injection: ~2000 tokens total
  - Summary: ~1500 tokens
  - Decisions (3): ~150 tokens
  - Failures (2): ~100 tokens
  - Constraints: ~250 tokens

## Integration

```python
# In orchestrator
from context_agent import ContextAgent

class Orchestrator:
    def __init__(self, project_path):
        self.context_agent = ContextAgent(project_path)

    async def execute_feature(self, feature):
        # Get context injection
        context = self.context_agent.get_injection(feature.id)

        # Execute with enriched context
        enriched_prompt = self.inject_context(prompt, context)
        response = await claude.send_message(enriched_prompt)

        # Write log
        self.write_feature_log(feature)

        # Trigger summarization every 5 features
        if self.completed_count % 5 == 0:
            self.context_agent.summarize(self.completed_features)
```

## Related Files

- `harness_agent.py` - Base class
- `agent.py` - Orchestrator integration
- `.claude/skills/agent-harness/skill.md` - Architecture documentation
- `.claude-context/CONTEXT_AGENT_INTEGRATION.md` - Integration summary

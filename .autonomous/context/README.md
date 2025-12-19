# Context Storage

This directory contains context maintained by the Context Agent to solve the "lost in the middle" problem in autonomous coding workflows.

## Files

### `running-summary.json`
Compressed summary of project state (max 2000 tokens).

```json
{
  "content": "# Project Summary\n\n## Completed Work\n...",
  "tokenCount": 1847,
  "updatedAt": 1734604800000,
  "trigger": "category_complete",
  "featuresSinceLastUpdate": 8,
  "totalFeaturesCompleted": 23
}
```

### `key-decisions.json`
Critical design decisions that affect future work.

```json
[
  {
    "id": "dec-001",
    "featureId": "feat-005",
    "decision": "Using JWT tokens for authentication",
    "rationale": "Stateless auth simplifies scaling",
    "impact": [
      "All API endpoints must validate JWT",
      "User sessions stored in token, not DB"
    ],
    "timestamp": 1734604500000,
    "category": "architecture"
  }
]
```

### `failure-memory.json`
Record of failures with root cause analysis.

```json
[
  {
    "id": "fail-001",
    "featureId": "feat-012",
    "description": "Database migration failed in production",
    "rootCause": "Migration tried to add NOT NULL column without default",
    "resolution": "Added default value to column definition",
    "prevention": "Always include defaults for NOT NULL columns in migrations",
    "timestamp": 1734603000000,
    "severity": "high"
  }
]
```

### `active-constraints.json`
Current constraints limiting implementation options.

```json
[
  {
    "id": "con-001",
    "description": "Must support Node.js 18+",
    "reason": "Client requirement for production environment",
    "affectedAreas": ["package.json", "CI/CD", "async/await patterns"],
    "addedAt": 1734600000000,
    "expiresAt": null,
    "type": "technical"
  }
]
```

## Context Agent Workflow

1. **Triggers**
   - After every 5 features completed
   - After each category completes
   - Manual request

2. **Summarization Process**
   - Load recent feature logs from `.autonomous/logs/`
   - Compress older context, keep recent details
   - Extract key decisions from feature specs
   - Record failures with root causes
   - Update active constraints

3. **Context Injection**
   - Before each feature execution
   - Load current context
   - Filter relevant decisions/failures for this feature
   - Inject into execution prompt (under 2K tokens)

## Token Budget

- **Running Summary**: Max 1500 tokens
- **Decisions**: ~50 tokens each (max 10 recent)
- **Failures**: ~50 tokens each (max 5 relevant)
- **Constraints**: ~30 tokens each (all active)
- **Total**: Under 2000 tokens

## Maintenance

- Old decisions archived after 50 features
- Resolved failures moved to archive after 100 features
- Expired constraints removed automatically
- Summary re-compressed every 20 features

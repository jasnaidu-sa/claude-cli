# Impact Assessment Storage

This directory contains forward-looking analysis of how completed features affect future features. The Impact Agent proactively detects conflicts before they cause implementation failures.

## Purpose

- **Proactive Conflict Detection**: Identify issues before features are implemented
- **Re-spec Recommendations**: Automatically suggest spec updates based on completed work
- **Audit Trail**: Track all impact assessments and revision decisions

## Triggers

### 1. High-Risk Feature Completion

**When**: Immediately after a feature with `hard-checkpoint` risk completes
**Scope**: Analyze only features with direct dependencies
**File naming**: `high-risk-{feature-id}.json`

### 2. Category Completion

**When**: After all features in a category complete
**Scope**: Analyze all remaining features across all categories
**File naming**: `category-{category-name}-impact.json`

## File Structure

```
.autonomous/impact/
├── high-risk-feat-003.json          # Impact from high-risk feature
├── category-auth-impact.json        # Impact from category completion
├── revision-flags.json              # Aggregate of flagged features
└── respec-history.json              # Audit trail of re-specs
```

## Conflict Types

### 1. API Breaking Changes (40 pts)
- Endpoint URL changed
- Request/response schema changed
- Authentication method changed

### 2. Architectural Drift (15 pts)
- Major paradigm shift (REST → GraphQL)
- Pattern mismatch (Redux → Context)
- Technology change (SQL → NoSQL)

### 3. Resource Conflicts (20 pts)
- Same file modified by both features
- Module/directory collision

### 4. Dependency Invalidation (35 pts)
- Dependent feature expects functionality that was removed
- Assumptions broken by completed implementation

## Conflict Scoring

Total conflict score ranges from 0-100 points:

**0-30 pts**: No action needed (low impact)
**31-60 pts**: Minor adjustment (auto-update spec)
**61-80 pts**: Moderate revision (show preview, need approval)
**81-100 pts**: Major re-spec (spec fundamentally broken, require approval)

## Impact Assessment File Format

### Individual Assessment

```json
{
  "trigger": "high-risk-completion",
  "triggerFeatureId": "feat-003",
  "triggerCategory": null,
  "analyzedFeatures": 8,
  "flaggedFeatures": [
    {
      "featureId": "feat-007",
      "featureName": "Add user profile page",
      "conflictScore": 75,
      "conflicts": [
        {
          "conflictType": "api-break",
          "severity": 40,
          "description": "API endpoint changed",
          "affectedFiles": ["src/api/auth/routes.ts"],
          "completedFeatureId": "feat-003",
          "evidence": {
            "expectedEndpoint": "/api/login",
            "completedFiles": ["src/auth/routes.ts"]
          }
        }
      ],
      "recommendation": "moderate-revision",
      "proposedRevision": "Update spec to use new endpoint",
      "dependencyChain": ["feat-003", "feat-007"]
    }
  ],
  "timestamp": 1734610000000,
  "analysisTimeMs": 450
}
```

### Revision Flags

Aggregate file tracking all flagged features:

```json
{
  "flaggedFeatures": [
    {
      "featureId": "feat-007",
      "status": "pending-revision",
      "conflictScore": 75,
      "recommendation": "moderate-revision",
      "flaggedAt": 1734610000000,
      "flaggedBy": "feat-003",
      "resolvedAt": null
    }
  ],
  "stats": {
    "totalFlagged": 5,
    "pendingRevision": 2,
    "autoAdjusted": 2,
    "manuallyRevised": 1,
    "majorRespecs": 0
  }
}
```

## Re-spec Workflow

### Minor Adjustment (auto)
1. Impact Agent detects low-severity conflict (31-60 pts)
2. Generates proposed changes
3. Auto-applies changes to feature spec
4. Logs adjustment to `respec-history.json`

### Moderate Revision (soft checkpoint)
1. Impact Agent detects medium-severity conflict (61-80 pts)
2. Generates proposed revision text
3. Emits `impact` event with type `soft-respec`
4. Shows preview to user
5. User approves or rejects
6. Applies revision if approved

### Major Re-spec (hard checkpoint)
1. Impact Agent detects high-severity conflict (81-100 pts)
2. Generates re-spec reason
3. Emits `impact` event with type `hard-respec`
4. Pauses workflow
5. Requires explicit user approval
6. Feature marked for complete re-specification

## Integration with Other Agents

### Context Agent
- Uses feature logs to understand what was actually implemented
- Provides historical context about similar features

### Checkpoint Agent
- Checkpoint risk scores determine impact assessment triggers
- High-risk features (hard-checkpoint) trigger immediate impact analysis

### Blackboard Pattern
- Impact assessments written to `.autonomous/state/execution-state.json`
- Other agents can read latest impact analysis results

## Usage Example

```python
from impact_agent import ImpactAgent

agent = ImpactAgent(project_path)

# After high-risk feature completes
impact = agent.assess_impact(
    completed_feature=feature,
    trigger="high-risk-completion",
    scope="direct-dependencies",
    remaining_features=pending_features
)

# Check results
for flagged in impact.flagged_features:
    print(f"{flagged.feature_id}: {flagged.recommendation}")
    if flagged.recommendation == "major-respec":
        # Pause workflow, require approval
        print(f"Reason: {flagged.respec_reason}")
```

## Performance

- **Analysis speed**: <2 seconds per feature
- **Accuracy target**: 90%+ catch rate for real conflicts
- **False positive target**: <10%

## Future Enhancements

1. **Transitive Dependency Analysis**: Currently analyzes 1 level deep, could expand to 2 levels
2. **ML-based Conflict Detection**: Learn from past conflicts to improve detection
3. **Automatic Spec Rewriting**: Generate complete updated specs, not just suggestions
4. **Visual Diff Preview**: Show before/after spec comparison in UI
5. **Conflict Resolution History**: Track which recommendations were helpful vs. false positives

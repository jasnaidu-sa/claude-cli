# Checkpoint Agent Storage

This directory contains checkpoint decisions for risk-based human intervention.

## Purpose

The Checkpoint Agent assesses risk before each feature execution and creates checkpoint decisions. These decisions determine whether execution proceeds automatically or requires human review.

## Files

### Individual Checkpoints

`checkpoint-{feature-id}.json` - One file per feature assessed

**Example**: `checkpoint-feat-003.json`
```json
{
  "feature_id": "feat-003",
  "decision": "soft-checkpoint",
  "risk_score": 65,
  "risk_factors": {
    "file_count_score": 15,
    "file_type_score": 30,
    "recent_failures_score": 10,
    "blast_radius_score": 10,
    "total_score": 65
  },
  "reason": "High-risk file types (30 pts), Multiple files (15 pts), Recent failures (10 pts)",
  "timestamp": 1734604800000,
  "approved": true,
  "approved_at": 1734604850000,
  "skipped": null
}
```

### Decisions Log

`decisions-log.json` - Audit trail of all checkpoint decisions

**Structure**:
```json
{
  "decisions": [
    {
      "featureId": "feat-001",
      "decision": "auto-proceed",
      "riskScore": 15,
      "timestamp": 1734604700000,
      "approved": null,
      "skipped": null
    },
    {
      "featureId": "feat-002",
      "decision": "soft-checkpoint",
      "riskScore": 55,
      "timestamp": 1734604750000,
      "approved": true,
      "skipped": null
    }
  ],
  "stats": {
    "totalDecisions": 2,
    "autoProceed": 1,
    "softCheckpoints": 1,
    "hardCheckpoints": 0
  }
}
```

## Decision Types

### `auto-proceed` (Risk: 0-30)
- **Meaning**: Low risk, no checkpoint needed
- **Action**: Feature executes automatically
- **Example**: UI component changes, test updates

### `soft-checkpoint` (Risk: 31-70)
- **Meaning**: Medium risk, show preview
- **Action**: Display preview with option to skip
- **Example**: API endpoint changes, business logic updates

### `hard-checkpoint` (Risk: 71-100)
- **Meaning**: High risk, require approval
- **Action**: Pause and wait for explicit approval
- **Example**: Authentication changes, payment logic, migrations

## Risk Factors

### File Count (0-25 points)
- 1-3 files: 0 pts
- 4-6 files: 10 pts
- 7-10 files: 15 pts
- 11+ files: 25 pts

### File Type (0-30 points)
- Auth/Security: 30 pts
- Payment/Financial: 30 pts
- Data integrity: 25 pts
- Business logic: 20 pts
- API endpoints: 15 pts
- UI components: 5 pts
- Tests/Docs: 0 pts

### Recent Failures (0-20 points)
- Similar feature failed: 20 pts
- Same category failed: 15 pts
- Any recent failure: 10 pts
- No failures: 0 pts

### Blast Radius (0-25 points)
- Affects 5+ features: 25 pts
- Affects 3-4 features: 15 pts
- Affects 1-2 features: 10 pts
- Isolated: 0 pts

## Workflow

1. **Before Feature Execution**: Checkpoint Agent assesses risk
2. **Decision Saved**: Individual checkpoint file + decisions log updated
3. **Blackboard Updated**: Decision written to execution state
4. **Orchestrator Action**:
   - `auto-proceed`: Continue immediately
   - `soft-checkpoint`: Show preview, allow skip
   - `hard-checkpoint`: Pause, require approval
5. **User Response**: Approval/skip recorded in checkpoint file

## Maintenance

- Checkpoint files are kept indefinitely for audit trail
- No automatic cleanup (small file sizes)
- Can be archived manually after workflow completion

## Integration

Checkpoint Agent is used by orchestrator:
```python
from checkpoint_agent import CheckpointAgent

agent = CheckpointAgent(project_path)
decision = agent.assess_risk(feature)

if decision.decision == "hard-checkpoint":
    # Pause and wait
    await pause_for_approval(feature, decision)
elif decision.decision == "soft-checkpoint":
    # Show preview with skip option
    if not await show_preview(feature, decision):
        agent.mark_skipped(feature.id)
        return  # Skip this feature
    agent.mark_approved(feature.id)
else:
    # auto-proceed - no action needed
    pass
```

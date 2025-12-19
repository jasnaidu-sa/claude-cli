# Phase 2: Checkpoint Agent Implementation Plan

## Overview

Implement the Checkpoint Agent to provide risk-based human intervention points during autonomous execution. Solves the reliability problem by pausing at high-risk points for human review.

## Goals

- Assess risk before each feature execution
- Return decision: `auto-proceed` | `soft-checkpoint` | `hard-checkpoint`
- Consider: file count, file types, recent failures, blast radius
- Integrate with orchestrator for pause/preview flows

## Risk Assessment Model

### Risk Factors

1. **File Count** (0-25 points)
   - 1-3 files: 0 points
   - 4-6 files: 10 points
   - 7-10 files: 15 points
   - 11+ files: 25 points

2. **File Types** (0-30 points)
   - Auth/Security files: 30 points
   - Payment/Financial: 30 points
   - Data integrity/Migration: 25 points
   - Core business logic: 20 points
   - API endpoints: 15 points
   - UI components: 5 points
   - Tests/Docs: 0 points

3. **Recent Failures** (0-20 points)
   - Similar feature failed in last 5: 20 points
   - Same category failed in last 5: 15 points
   - Any failure in last 5: 10 points
   - No recent failures: 0 points

4. **Blast Radius** (0-25 points)
   - Affects 5+ other features: 25 points
   - Affects 3-4 features: 15 points
   - Affects 1-2 features: 10 points
   - Isolated change: 0 points

### Risk Scoring

Total: 0-100 points

- **0-30**: `auto-proceed` - Low risk, no checkpoint needed
- **31-70**: `soft-checkpoint` - Medium risk, show preview with skip option
- **71-100**: `hard-checkpoint` - High risk, require explicit approval

## Implementation Steps

### 1. Create CheckpointAgent Class

**File**: `autonomous-orchestrator/checkpoint_agent.py`

**Dataclasses**:
```python
@dataclass
class RiskFactors:
    file_count_score: int
    file_type_score: int
    recent_failures_score: int
    blast_radius_score: int
    total_score: int

@dataclass
class CheckpointDecision:
    feature_id: str
    decision: str  # 'auto-proceed' | 'soft-checkpoint' | 'hard-checkpoint'
    risk_score: int
    risk_factors: RiskFactors
    reason: str
    timestamp: int
```

**Key Methods**:
- `assess_risk(feature)` - Main risk assessment
- `calculate_file_count_score(feature)` - Analyze file count
- `calculate_file_type_score(feature)` - Analyze file types
- `calculate_failure_score(feature)` - Check recent failures
- `calculate_blast_radius(feature)` - Estimate impact
- `save_decision(decision)` - Persist to `.autonomous/checkpoints/`

### 2. Integrate with Orchestrator

**File**: `autonomous-orchestrator/agent.py`

**Changes**:
- Initialize CheckpointAgent in `__init__`
- Add `handle_checkpoint(decision, feature)` method
- Call `assess_risk()` before each feature execution
- Implement pause/wait logic for checkpoints
- Add user input handling for approval/skip

### 3. Checkpoint Storage

**Directory**: `.autonomous/checkpoints/`

**Files**:
- `checkpoint-{feature-id}.json` - Individual checkpoint decisions
- `decisions-log.json` - Audit trail of all checkpoint decisions

### 4. Blackboard Updates

Update `.autonomous/state/execution-state.json` with:
```json
{
  "checkpointDecision": {
    "featureId": "feat-005",
    "decision": "soft-checkpoint",
    "riskScore": 65,
    "reason": "Modifies authentication logic",
    "timestamp": 1734604800000
  }
}
```

### 5. Testing

**File**: `autonomous-orchestrator/test_checkpoint_agent.py`

**Test Cases**:
1. Low risk feature (auto-proceed)
2. Medium risk feature (soft-checkpoint)
3. High risk feature (hard-checkpoint)
4. Risk factor calculations
5. Decision persistence
6. Orchestrator integration

## Integration Points

### Before Feature Execution

```python
# In orchestrator implementation loop
async def execute_feature(self, feature):
    # CHECKPOINT: Assess risk
    decision = self.checkpoint_agent.assess_risk(feature)

    if decision.decision == "hard-checkpoint":
        await self.pause_for_approval(feature, decision)
    elif decision.decision == "soft-checkpoint":
        if not await self.show_preview_with_skip(feature, decision):
            return  # User skipped
    # else auto-proceed

    # Continue with execution...
```

### User Interaction

For checkpoints, orchestrator needs to:
1. Emit checkpoint event with decision
2. Wait for user input via stdin or IPC
3. Resume or skip based on response

## Risk Heuristics

### High-Risk Patterns

- Files matching: `auth`, `login`, `password`, `token`, `session`
- Files matching: `payment`, `billing`, `checkout`, `stripe`, `paypal`
- Files matching: `migration`, `schema`, `database`, `sql`
- Core business logic files (determined by frequency of changes)

### Blast Radius Detection

Analyze feature dependencies:
1. Read feature spec for mentioned dependencies
2. Check git history for co-changed files
3. Scan imports/references in codebase
4. Count affected downstream features

## Success Metrics

1. Risk assessment completes in <500ms
2. Decisions logged to audit trail
3. False positive rate <20% (too many checkpoints)
4. False negative rate <5% (missed high-risk changes)

## Output Structure

```
.autonomous/checkpoints/
├── checkpoint-feat-001.json
├── checkpoint-feat-002.json
├── checkpoint-feat-003.json
└── decisions-log.json
```

**checkpoint-{id}.json**:
```json
{
  "featureId": "feat-003",
  "decision": "soft-checkpoint",
  "riskScore": 65,
  "riskFactors": {
    "fileCountScore": 15,
    "fileTypeScore": 30,
    "recentFailuresScore": 10,
    "blastRadiusScore": 10,
    "totalScore": 65
  },
  "reason": "Modifies authentication logic (30 pts), 7-10 files (15 pts), recent failure in auth category (10 pts)",
  "timestamp": 1734604800000,
  "approved": true,
  "approvedAt": 1734604850000
}
```

**decisions-log.json**:
```json
{
  "decisions": [
    {
      "featureId": "feat-001",
      "decision": "auto-proceed",
      "riskScore": 15,
      "timestamp": 1734604700000
    },
    {
      "featureId": "feat-002",
      "decision": "auto-proceed",
      "riskScore": 20,
      "timestamp": 1734604750000
    },
    {
      "featureId": "feat-003",
      "decision": "soft-checkpoint",
      "riskScore": 65,
      "timestamp": 1734604800000,
      "approved": true
    }
  ],
  "stats": {
    "totalDecisions": 3,
    "autoProceed": 2,
    "softCheckpoints": 1,
    "hardCheckpoints": 0
  }
}
```

## Dependencies

- Context Agent (for failure history)
- Feature specs (for file analysis)
- Git history (for co-change analysis)
- Orchestrator state (for current workflow)

## Timeline

1. Create CheckpointAgent class (1-2 hours)
2. Implement risk assessment logic (2-3 hours)
3. Integrate with orchestrator (1-2 hours)
4. Add user interaction handling (1-2 hours)
5. Testing (1-2 hours)
6. Documentation (1 hour)

**Total**: 7-12 hours

## Next Phase

**Phase 3**: Impact Assessment Agent - Forward-looking conflict detection after category completion.

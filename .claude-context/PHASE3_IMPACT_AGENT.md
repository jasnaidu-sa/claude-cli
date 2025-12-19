# Phase 3: Impact Assessment Agent

## Overview

The Impact Assessment Agent provides forward-looking analysis to detect how completed work affects future features. Unlike reactive agents, it proactively identifies conflicts before they cause implementation failures.

## Goals

1. **Proactive Conflict Detection**: Identify issues before features are implemented
2. **Dual-Trigger Analysis**: Run after high-risk features AND category completion
3. **Comprehensive Conflict Types**: API breaks, architecture drift, resource collisions
4. **Agent-Driven Re-spec**: Automatically recommend and trigger re-specification
5. **Balanced Performance**: Deep enough to catch real issues, fast enough to not block workflow

## Core Responsibilities

### 1. Dependency Analysis (Balanced Depth)
- **Direct dependencies**: Features that explicitly depend on completed work
- **One-level transitive**: Features that depend on direct dependents
- **Stops at**: Two levels deep (prevents analysis paralysis)

### 2. Conflict Detection (All Types)

#### A. API Breaking Changes
- Completed feature modified API contract
- Future features expect old contract
- Example: Auth endpoint changed from `/login` to `/auth/login`

#### B. Architectural Drift
- Completed implementation diverged from spec
- Future features assume original architecture
- Example: Spec said "REST API", implementation used GraphQL

#### C. Resource Conflicts
- File/module collisions between completed and future features
- Same files targeted by multiple features
- Example: Both features modify `user-service.ts`

#### D. Dependency Invalidation
- Completed feature broke assumptions of dependent features
- Example: Removed database field that future feature needs

### 3. Re-spec Recommendation Engine

Agent analyzes conflicts and recommends:
- **Minor adjustment**: Update file paths, small scope change (auto-approve)
- **Moderate revision**: Change implementation approach (soft checkpoint)
- **Major re-spec**: Spec is invalid, needs rewrite (hard checkpoint)

## Trigger Points

### Trigger 1: High-Risk Feature Completion
**When**: Immediately after any feature with `hard-checkpoint` risk level completes
**Why**: High-risk features (auth, payment, migrations) are most likely to invalidate future work
**Scope**: Analyze only features with direct dependencies on the completed feature

### Trigger 2: Category Completion
**When**: After all features in a category complete
**Why**: Categories represent logical units; completion is natural checkpoint
**Scope**: Analyze all remaining features across all categories

## Impact Assessment Model

### Conflict Scoring (0-100 points)

#### 1. Dependency Depth (0-25 points)
- No dependency: 0 pts
- Direct dependency: 25 pts
- Transitive dependency (1 level): 15 pts

#### 2. Breaking Change Severity (0-40 points)
- **API Contract Changes**: 40 pts
  - Endpoint URL changed
  - Request/response schema changed
  - Authentication method changed
- **Database Schema Changes**: 35 pts
  - Table/column removed or renamed
  - Relationship changed
- **Module Signature Changes**: 25 pts
  - Function signature changed
  - Class interface changed
- **Configuration Changes**: 15 pts
  - Environment variables changed
  - Config file structure changed

#### 3. Resource Conflict (0-20 points)
- Same file in both features: 20 pts
- Same module/directory: 10 pts
- Related but different files: 5 pts
- No overlap: 0 pts

#### 4. Architectural Drift (0-15 points)
- Major drift (different paradigm): 15 pts
- Moderate drift (different patterns): 10 pts
- Minor drift (style differences): 5 pts
- No drift: 0 pts

### Re-spec Decision Thresholds

**Conflict Score** → **Recommendation**
- **0-30 pts**: No action needed (low impact)
- **31-60 pts**: Minor adjustment (auto-update spec)
- **61-80 pts**: Moderate revision (soft checkpoint, show preview)
- **81-100 pts**: Major re-spec (hard checkpoint, require approval)

## Integration with Orchestrator

### Location in Agent.py

```python
# After feature completion (line ~290)
if feature_status == "passed":
    # Existing context update
    self.write_feature_log(current_feature)

    # NEW: Check if high-risk feature completed
    if checkpoint_decision.decision == "hard-checkpoint":
        # Trigger immediate impact analysis
        impact_results = self.impact_agent.assess_impact(
            completed_feature=current_feature,
            trigger="high-risk-completion",
            scope="direct-dependencies"
        )
        self.handle_impact_results(impact_results)

    # Existing completion tracking
    self.completed_features.append(feature_id)

# After category completion (NEW check)
if self.is_category_complete(current_category):
    # Trigger comprehensive impact analysis
    impact_results = self.impact_agent.assess_impact(
        completed_category=current_category,
        trigger="category-completion",
        scope="all-remaining"
    )
    self.handle_impact_results(impact_results)
```

### Impact Handling Flow

```python
def handle_impact_results(self, results: ImpactAssessment) -> None:
    """Handle impact assessment results and trigger re-specs."""

    for flagged_feature in results.flagged_features:
        if flagged_feature.recommendation == "no-action":
            # Log only, continue
            self.emit_progress(f"Feature {flagged_feature.id}: No impact")

        elif flagged_feature.recommendation == "minor-adjustment":
            # Auto-update spec
            self.emit_output("impact", json.dumps({
                "type": "auto-adjustment",
                "featureId": flagged_feature.id,
                "changes": flagged_feature.proposed_changes
            }))
            self.impact_agent.apply_adjustment(flagged_feature)

        elif flagged_feature.recommendation == "moderate-revision":
            # Soft checkpoint: show preview, allow skip
            self.emit_output("impact", json.dumps({
                "type": "soft-respec",
                "featureId": flagged_feature.id,
                "conflictScore": flagged_feature.conflict_score,
                "conflicts": flagged_feature.conflicts,
                "proposedRevision": flagged_feature.proposed_revision
            }))
            # TODO: Wait for user approval
            self.impact_agent.apply_revision(flagged_feature)

        elif flagged_feature.recommendation == "major-respec":
            # Hard checkpoint: require approval
            self.emit_output("impact", json.dumps({
                "type": "hard-respec",
                "featureId": flagged_feature.id,
                "conflictScore": flagged_feature.conflict_score,
                "conflicts": flagged_feature.conflicts,
                "reason": flagged_feature.respec_reason
            }))
            # TODO: Pause and wait for explicit approval
            self.impact_agent.apply_respec(flagged_feature)
```

## Data Structures

### ImpactAssessment

```python
@dataclass
class ConflictDetail:
    """Detailed conflict information"""
    conflict_type: str  # 'api-break' | 'arch-drift' | 'resource-collision' | 'dependency-invalid'
    severity: int  # Points contributed to conflict score
    description: str
    affected_files: List[str]
    completed_feature_id: str
    evidence: Dict[str, Any]  # Specific evidence (changed endpoints, removed fields, etc.)

@dataclass
class FlaggedFeature:
    """Feature flagged for potential revision"""
    feature_id: str
    feature_name: str
    conflict_score: int
    conflicts: List[ConflictDetail]
    recommendation: str  # 'no-action' | 'minor-adjustment' | 'moderate-revision' | 'major-respec'
    proposed_changes: Optional[Dict[str, Any]]  # For minor adjustments
    proposed_revision: Optional[str]  # For moderate revisions
    respec_reason: Optional[str]  # For major re-specs
    dependency_chain: List[str]  # Feature IDs in dependency path

@dataclass
class ImpactAssessment:
    """Complete impact assessment result"""
    trigger: str  # 'high-risk-completion' | 'category-completion'
    trigger_feature_id: Optional[str]
    trigger_category: Optional[str]
    analyzed_features: int
    flagged_features: List[FlaggedFeature]
    timestamp: int
    analysis_time_ms: int
```

## Storage Structure

```
.autonomous/impact/
├── high-risk-feat-003.json          # Impact from high-risk feature
├── category-auth-impact.json        # Impact from category completion
├── revision-flags.json              # Aggregate of all flagged features
└── respec-history.json              # Audit trail of re-specs applied
```

### Individual Impact File

**Example**: `high-risk-feat-003.json`

```json
{
  "trigger": "high-risk-completion",
  "triggerFeatureId": "feat-003",
  "triggerFeatureName": "Implement OAuth authentication",
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
          "description": "Auth endpoint changed from /api/login to /api/auth/login",
          "affectedFiles": ["src/api/auth/routes.ts"],
          "completedFeatureId": "feat-003",
          "evidence": {
            "oldEndpoint": "/api/login",
            "newEndpoint": "/api/auth/login",
            "method": "POST"
          }
        },
        {
          "conflictType": "resource-collision",
          "severity": 20,
          "description": "Both features modify src/services/user-service.ts",
          "affectedFiles": ["src/services/user-service.ts"],
          "completedFeatureId": "feat-003",
          "evidence": {
            "modifiedBy": ["feat-003", "feat-007"]
          }
        }
      ],
      "recommendation": "moderate-revision",
      "proposedRevision": "Update spec to use new auth endpoint /api/auth/login instead of /api/login. Consider splitting user-service.ts to avoid file collision.",
      "dependencyChain": ["feat-003", "feat-007"]
    }
  ],
  "timestamp": 1734610000000,
  "analysisTimeMs": 450
}
```

### Revision Flags File

**File**: `revision-flags.json`

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
    },
    {
      "featureId": "feat-012",
      "status": "revised",
      "conflictScore": 45,
      "recommendation": "minor-adjustment",
      "flaggedAt": 1734610500000,
      "flaggedBy": "category-auth",
      "resolvedAt": 1734610600000,
      "resolution": "auto-adjusted"
    }
  ],
  "stats": {
    "totalFlagged": 2,
    "pendingRevision": 1,
    "autoAdjusted": 1,
    "manuallyRevised": 0,
    "majorRespecs": 0
  }
}
```

## Conflict Detection Algorithms

### 1. API Breaking Change Detection

```python
def detect_api_breaks(self, completed_feature, future_feature) -> List[ConflictDetail]:
    """Detect API contract changes."""
    conflicts = []

    # Load completed feature's git diff
    diff = self.get_feature_diff(completed_feature["id"])

    # Check for endpoint changes
    old_endpoints = self.extract_endpoints_from_spec(future_feature["spec"])
    new_endpoints = self.extract_endpoints_from_diff(diff)

    for old_ep in old_endpoints:
        if old_ep not in new_endpoints:
            # Endpoint removed or changed
            conflicts.append(ConflictDetail(
                conflict_type="api-break",
                severity=40,
                description=f"Endpoint {old_ep} no longer exists or changed",
                affected_files=self.get_affected_files(diff, old_ep),
                completed_feature_id=completed_feature["id"],
                evidence={"oldEndpoint": old_ep, "availableEndpoints": new_endpoints}
            ))

    return conflicts
```

### 2. Architectural Drift Detection

```python
def detect_arch_drift(self, completed_feature, future_feature) -> List[ConflictDetail]:
    """Detect architecture divergence from spec."""
    conflicts = []

    # Load original spec and implementation summary
    spec_arch = self.extract_architecture(completed_feature.get("spec", ""))
    impl_arch = self.extract_architecture_from_code(completed_feature["id"])

    # Check for major paradigm shifts
    if spec_arch["pattern"] != impl_arch["pattern"]:
        conflicts.append(ConflictDetail(
            conflict_type="arch-drift",
            severity=15,
            description=f"Implementation used {impl_arch['pattern']} instead of {spec_arch['pattern']}",
            affected_files=completed_feature.get("files", []),
            completed_feature_id=completed_feature["id"],
            evidence={"specPattern": spec_arch["pattern"], "implPattern": impl_arch["pattern"]}
        ))

    return conflicts
```

### 3. Resource Conflict Detection

```python
def detect_resource_conflicts(self, completed_feature, future_feature) -> List[ConflictDetail]:
    """Detect file/module collisions."""
    conflicts = []

    completed_files = set(completed_feature.get("files", []))
    future_files = set(future_feature.get("files", []))

    overlapping = completed_files & future_files

    if overlapping:
        conflicts.append(ConflictDetail(
            conflict_type="resource-collision",
            severity=20,
            description=f"{len(overlapping)} files modified by both features",
            affected_files=list(overlapping),
            completed_feature_id=completed_feature["id"],
            evidence={"overlappingFiles": list(overlapping)}
        ))

    return conflicts
```

### 4. Dependency Invalidation Detection

```python
def detect_dependency_invalidation(self, completed_feature, future_feature) -> List[ConflictDetail]:
    """Detect broken assumptions in dependent features."""
    conflicts = []

    # Check if future feature explicitly depends on completed feature
    if completed_feature["id"] not in future_feature.get("dependencies", []):
        return conflicts

    # Load feature specs
    completed_spec = completed_feature.get("spec", "")
    future_spec = future_feature.get("spec", "")

    # Extract assumptions from future spec
    assumptions = self.extract_assumptions(future_spec)

    # Check if completed implementation broke assumptions
    for assumption in assumptions:
        if not self.verify_assumption(assumption, completed_feature["id"]):
            conflicts.append(ConflictDetail(
                conflict_type="dependency-invalid",
                severity=35,
                description=f"Assumption broken: {assumption['description']}",
                affected_files=assumption.get("relatedFiles", []),
                completed_feature_id=completed_feature["id"],
                evidence={"assumption": assumption, "verified": False}
            ))

    return conflicts
```

## Re-spec Recommendation Logic

```python
def generate_recommendation(self, conflict_score: int, conflicts: List[ConflictDetail]) -> str:
    """Determine re-spec recommendation based on conflict score."""

    if conflict_score <= 30:
        return "no-action"

    elif conflict_score <= 60:
        # Minor adjustment: can auto-fix
        return "minor-adjustment"

    elif conflict_score <= 80:
        # Moderate revision: show preview, need approval
        return "moderate-revision"

    else:
        # Major re-spec: spec is fundamentally broken
        return "major-respec"

def generate_proposed_changes(self, feature: Dict, conflicts: List[ConflictDetail]) -> Dict:
    """Generate proposed spec changes for minor adjustments."""
    changes = {}

    for conflict in conflicts:
        if conflict.conflict_type == "api-break":
            # Update endpoint URLs
            changes["endpoints"] = conflict.evidence.get("newEndpoint")

        elif conflict.conflict_type == "resource-collision":
            # Suggest file path changes
            changes["files"] = self.suggest_alternative_files(conflict.affected_files)

    return changes

def generate_proposed_revision(self, feature: Dict, conflicts: List[ConflictDetail]) -> str:
    """Generate proposed spec revision for moderate changes."""
    revision_parts = []

    for conflict in conflicts:
        if conflict.conflict_type == "api-break":
            revision_parts.append(
                f"- Update API endpoint from {conflict.evidence['oldEndpoint']} "
                f"to {conflict.evidence['newEndpoint']}"
            )

        elif conflict.conflict_type == "arch-drift":
            revision_parts.append(
                f"- Adjust architecture to use {conflict.evidence['implPattern']} "
                f"pattern instead of {conflict.evidence['specPattern']}"
            )

        elif conflict.conflict_type == "resource-collision":
            revision_parts.append(
                f"- Resolve file collision in {', '.join(conflict.affected_files)}"
            )

    return "\n".join(revision_parts)
```

## Testing Strategy

### Test Suites

1. **Basic Impact Assessment**
   - Low impact (no conflicts)
   - Medium impact (minor adjustments)
   - High impact (major re-spec)
   - Dual trigger behavior

2. **Conflict Detection**
   - API breaking changes
   - Architectural drift
   - Resource collisions
   - Dependency invalidation

3. **Dependency Analysis**
   - Direct dependencies
   - Transitive dependencies (1 level)
   - Dependency chain tracking

4. **Re-spec Recommendations**
   - Auto-adjustment application
   - Moderate revision proposals
   - Major re-spec flagging

5. **Storage and Audit**
   - Impact file persistence
   - Revision flags tracking
   - Re-spec history

## Success Metrics

- **Detection accuracy**: 90%+ catch rate for real conflicts
- **False positive rate**: <10% (avoid flagging non-issues)
- **Performance**: <2 seconds per feature analyzed
- **Proactive value**: 50%+ of flagged conflicts would have caused implementation failure

## Dependencies

- **Context Agent**: Uses feature logs and decision history
- **Checkpoint Agent**: Consumes risk scores to determine triggers
- **Git integration**: Reads diffs to detect actual changes
- **Spec parser**: Extracts structure from feature specs

## Implementation Steps

1. Create `ImpactAgent` class extending `HarnessAgent`
2. Implement conflict detection algorithms (4 types)
3. Implement dependency analysis (balanced depth)
4. Implement re-spec recommendation engine
5. Create storage structure and schemas
6. Integrate into orchestrator (dual triggers)
7. Add impact handling flow
8. Create comprehensive test suite
9. Document integration and usage

## Timeline

- **Day 1**: Core ImpactAgent class + conflict detection
- **Day 2**: Dependency analysis + recommendation engine
- **Day 3**: Orchestrator integration + testing
- **Day 4**: Documentation + refinement

Estimated: 3-4 days for full implementation

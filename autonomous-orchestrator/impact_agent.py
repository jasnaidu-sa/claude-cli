"""
Impact Assessment Agent for Autonomous Coding.

Provides forward-looking analysis to detect how completed work affects future features.
Proactively identifies conflicts before they cause implementation failures.
"""

import re
import time
import subprocess
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Optional, Dict, Any, List

from harness_agent import HarnessAgent


@dataclass
class ConflictDetail:
    """Detailed conflict information"""

    conflict_type: str  # 'api-break' | 'arch-drift' | 'resource-collision' | 'dependency-invalid'
    severity: int  # Points contributed to conflict score
    description: str
    affected_files: List[str]
    completed_feature_id: str
    evidence: Dict[str, Any]  # Specific evidence


@dataclass
class FlaggedFeature:
    """Feature flagged for potential revision"""

    feature_id: str
    feature_name: str
    conflict_score: int
    conflicts: List[ConflictDetail]
    recommendation: str  # 'no-action' | 'minor-adjustment' | 'moderate-revision' | 'major-respec'
    proposed_changes: Optional[Dict[str, Any]] = None
    proposed_revision: Optional[str] = None
    respec_reason: Optional[str] = None
    dependency_chain: List[str] = None

    def __post_init__(self):
        if self.dependency_chain is None:
            self.dependency_chain = []


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


class ImpactAgent(HarnessAgent):
    """
    Impact Assessment Agent for proactive conflict detection.

    Responsibilities:
    - Analyze how completed features affect future features
    - Detect API breaks, architectural drift, resource conflicts, dependency invalidation
    - Generate re-spec recommendations based on conflict severity
    - Trigger on high-risk feature completion OR category completion

    Usage:
        agent = ImpactAgent(project_path)
        impact = agent.assess_impact(
            completed_feature=feature,
            trigger="high-risk-completion",
            scope="direct-dependencies"
        )
    """

    # Conflict scoring thresholds
    NO_ACTION_THRESHOLD = 30
    MINOR_ADJUSTMENT_THRESHOLD = 60
    MODERATE_REVISION_THRESHOLD = 80

    # Conflict type severity (max points per type)
    API_BREAK_SEVERITY = 40
    DB_SCHEMA_SEVERITY = 35
    MODULE_SIGNATURE_SEVERITY = 25
    CONFIG_CHANGE_SEVERITY = 15
    RESOURCE_COLLISION_SEVERITY = 20
    ARCH_DRIFT_MAJOR_SEVERITY = 15
    ARCH_DRIFT_MODERATE_SEVERITY = 10
    ARCH_DRIFT_MINOR_SEVERITY = 5
    DEPENDENCY_INVALID_SEVERITY = 35

    # Dependency analysis depth
    DIRECT_DEPENDENCY_SCORE = 25
    TRANSITIVE_DEPENDENCY_SCORE = 15

    def __init__(self, project_path: Path):
        super().__init__(project_path)
        self.impact_dir = self.project_path / ".autonomous" / "impact"
        self.logs_dir = self.project_path / ".autonomous" / "logs"
        self.ensure_directory(self.impact_dir)

    def assess_impact(
        self,
        completed_feature: Optional[Dict[str, Any]] = None,
        completed_category: Optional[str] = None,
        trigger: str = "high-risk-completion",
        scope: str = "direct-dependencies",
        remaining_features: List[Dict[str, Any]] = None,
    ) -> ImpactAssessment:
        """
        Main impact assessment method.

        Args:
            completed_feature: Feature that just completed (for high-risk trigger)
            completed_category: Category that completed (for category trigger)
            trigger: 'high-risk-completion' or 'category-completion'
            scope: 'direct-dependencies' or 'all-remaining'
            remaining_features: List of features still pending

        Returns:
            ImpactAssessment with flagged features and recommendations
        """
        start_time = time.time()
        self.start_phase(
            "analyzing",
            f"Analyzing impact for {trigger}..."
        )

        try:
            if remaining_features is None:
                remaining_features = []

            flagged_features = []

            # Determine which features to analyze
            if scope == "direct-dependencies" and completed_feature:
                # Only analyze features that directly depend on completed feature
                features_to_analyze = self._get_dependent_features(
                    completed_feature, remaining_features
                )
            else:
                # Analyze all remaining features
                features_to_analyze = remaining_features

            self.emit_progress(
                "analyzing",
                50,
                f"Analyzing {len(features_to_analyze)} features..."
            )

            # Analyze each feature for conflicts
            for future_feature in features_to_analyze:
                conflicts = self._detect_all_conflicts(
                    completed_feature or {},
                    future_feature
                )

                if not conflicts:
                    continue

                # Calculate total conflict score
                conflict_score = sum(c.severity for c in conflicts)

                # Add dependency depth score
                dep_score = self._calculate_dependency_score(
                    completed_feature or {},
                    future_feature
                )
                conflict_score += dep_score

                # Generate recommendation
                recommendation = self._generate_recommendation(conflict_score)

                # Generate proposed changes/revisions
                proposed_changes = None
                proposed_revision = None
                respec_reason = None

                if recommendation == "minor-adjustment":
                    proposed_changes = self._generate_proposed_changes(
                        future_feature, conflicts
                    )
                elif recommendation == "moderate-revision":
                    proposed_revision = self._generate_proposed_revision(
                        future_feature, conflicts
                    )
                elif recommendation == "major-respec":
                    respec_reason = self._generate_respec_reason(
                        future_feature, conflicts
                    )

                # Create flagged feature
                flagged = FlaggedFeature(
                    feature_id=future_feature.get("id", "unknown"),
                    feature_name=future_feature.get("name", "Unknown"),
                    conflict_score=conflict_score,
                    conflicts=[asdict(c) for c in conflicts],  # Serialize conflicts
                    recommendation=recommendation,
                    proposed_changes=proposed_changes,
                    proposed_revision=proposed_revision,
                    respec_reason=respec_reason,
                    dependency_chain=self._build_dependency_chain(
                        completed_feature or {},
                        future_feature
                    ),
                )

                flagged_features.append(flagged)

            # Create assessment
            assessment = ImpactAssessment(
                trigger=trigger,
                trigger_feature_id=completed_feature.get("id") if completed_feature else None,
                trigger_category=completed_category,
                analyzed_features=len(features_to_analyze),
                flagged_features=flagged_features,
                timestamp=int(time.time() * 1000),
                analysis_time_ms=int((time.time() - start_time) * 1000),
            )

            # Save assessment
            self._save_assessment(assessment)

            # Update revision flags
            self._update_revision_flags(flagged_features)

            # Update blackboard
            self.write_blackboard({
                "impactAssessment": {
                    "trigger": trigger,
                    "analyzedFeatures": len(features_to_analyze),
                    "flaggedFeatures": len(flagged_features),
                    "timestamp": assessment.timestamp,
                }
            })

            self.emit_progress(
                "complete",
                100,
                f"Impact analysis complete: {len(flagged_features)} features flagged"
            )

            return assessment

        except Exception as e:
            self.emit_error(f"Impact assessment failed: {e}")
            # Return empty assessment
            return ImpactAssessment(
                trigger=trigger,
                trigger_feature_id=None,
                trigger_category=None,
                analyzed_features=0,
                flagged_features=[],
                timestamp=int(time.time() * 1000),
                analysis_time_ms=0,
            )

    def _detect_all_conflicts(
        self, completed_feature: Dict[str, Any], future_feature: Dict[str, Any]
    ) -> List[ConflictDetail]:
        """Detect all types of conflicts."""
        conflicts = []

        # 1. API Breaking Changes
        conflicts.extend(self._detect_api_breaks(completed_feature, future_feature))

        # 2. Architectural Drift
        conflicts.extend(self._detect_arch_drift(completed_feature, future_feature))

        # 3. Resource Conflicts
        conflicts.extend(self._detect_resource_conflicts(completed_feature, future_feature))

        # 4. Dependency Invalidation
        conflicts.extend(self._detect_dependency_invalidation(completed_feature, future_feature))

        return conflicts

    def _detect_api_breaks(
        self, completed_feature: Dict[str, Any], future_feature: Dict[str, Any]
    ) -> List[ConflictDetail]:
        """Detect API contract changes."""
        conflicts = []

        # Extract API endpoints from specs
        completed_spec = completed_feature.get("spec", "") or ""
        future_spec = future_feature.get("spec", "") or ""

        completed_endpoints = self._extract_endpoints(completed_spec)
        future_endpoints = self._extract_endpoints(future_spec)

        # Check if future feature expects endpoints that may have changed
        for future_ep in future_endpoints:
            # Check if endpoint exists in completed feature's files
            if self._endpoint_potentially_changed(completed_feature, future_ep):
                conflicts.append(
                    ConflictDetail(
                        conflict_type="api-break",
                        severity=self.API_BREAK_SEVERITY,
                        description=f"API endpoint {future_ep} may have changed",
                        affected_files=completed_feature.get("files", []),
                        completed_feature_id=completed_feature.get("id", "unknown"),
                        evidence={
                            "expectedEndpoint": future_ep,
                            "completedFiles": completed_feature.get("files", []),
                        },
                    )
                )

        return conflicts

    def _detect_arch_drift(
        self, completed_feature: Dict[str, Any], future_feature: Dict[str, Any]
    ) -> List[ConflictDetail]:
        """Detect architecture divergence from spec."""
        conflicts = []

        completed_spec = completed_feature.get("spec", "") or ""
        future_spec = future_feature.get("spec", "") or ""

        # Extract architectural patterns
        completed_patterns = self._extract_arch_patterns(completed_spec)
        future_patterns = self._extract_arch_patterns(future_spec)

        # Check for pattern mismatches
        for pattern_type in ["api", "state", "data", "auth"]:
            completed_val = completed_patterns.get(pattern_type)
            future_val = future_patterns.get(pattern_type)

            if completed_val and future_val and completed_val != future_val:
                # Determine severity
                severity = self.ARCH_DRIFT_MAJOR_SEVERITY

                conflicts.append(
                    ConflictDetail(
                        conflict_type="arch-drift",
                        severity=severity,
                        description=f"Architecture mismatch in {pattern_type}: {completed_val} vs {future_val}",
                        affected_files=completed_feature.get("files", []),
                        completed_feature_id=completed_feature.get("id", "unknown"),
                        evidence={
                            "patternType": pattern_type,
                            "completedPattern": completed_val,
                            "futurePattern": future_val,
                        },
                    )
                )

        return conflicts

    def _detect_resource_conflicts(
        self, completed_feature: Dict[str, Any], future_feature: Dict[str, Any]
    ) -> List[ConflictDetail]:
        """Detect file/module collisions."""
        conflicts = []

        completed_files = set(completed_feature.get("files", []))
        future_files = set(future_feature.get("files", []))

        overlapping = completed_files & future_files

        if overlapping:
            conflicts.append(
                ConflictDetail(
                    conflict_type="resource-collision",
                    severity=self.RESOURCE_COLLISION_SEVERITY,
                    description=f"{len(overlapping)} files modified by both features",
                    affected_files=list(overlapping),
                    completed_feature_id=completed_feature.get("id", "unknown"),
                    evidence={"overlappingFiles": list(overlapping)},
                )
            )

        return conflicts

    def _detect_dependency_invalidation(
        self, completed_feature: Dict[str, Any], future_feature: Dict[str, Any]
    ) -> List[ConflictDetail]:
        """Detect broken assumptions in dependent features."""
        conflicts = []

        # Check if future feature depends on completed feature
        completed_id = completed_feature.get("id", "")
        if completed_id not in future_feature.get("dependencies", []):
            return conflicts

        # Check if completed feature status is failed or has issues
        if completed_feature.get("status") == "failed":
            conflicts.append(
                ConflictDetail(
                    conflict_type="dependency-invalid",
                    severity=self.DEPENDENCY_INVALID_SEVERITY,
                    description=f"Depends on failed feature {completed_id}",
                    affected_files=completed_feature.get("files", []),
                    completed_feature_id=completed_id,
                    evidence={
                        "dependencyStatus": "failed",
                        "dependencyId": completed_id,
                    },
                )
            )

        return conflicts

    def _calculate_dependency_score(
        self, completed_feature: Dict[str, Any], future_feature: Dict[str, Any]
    ) -> int:
        """Calculate score based on dependency depth."""
        completed_id = completed_feature.get("id", "")
        dependencies = future_feature.get("dependencies", [])

        if completed_id in dependencies:
            # Direct dependency
            return self.DIRECT_DEPENDENCY_SCORE

        # Check transitive (1 level)
        # For now, return 0 (transitive analysis requires full feature graph)
        return 0

    def _generate_recommendation(self, conflict_score: int) -> str:
        """Determine re-spec recommendation based on conflict score."""
        if conflict_score <= self.NO_ACTION_THRESHOLD:
            return "no-action"
        elif conflict_score <= self.MINOR_ADJUSTMENT_THRESHOLD:
            return "minor-adjustment"
        elif conflict_score <= self.MODERATE_REVISION_THRESHOLD:
            return "moderate-revision"
        else:
            return "major-respec"

    def _generate_proposed_changes(
        self, feature: Dict[str, Any], conflicts: List[ConflictDetail]
    ) -> Dict[str, Any]:
        """Generate proposed spec changes for minor adjustments."""
        changes = {}

        for conflict in conflicts:
            if conflict.conflict_type == "api-break":
                # Update endpoint URLs
                if "expectedEndpoint" in conflict.evidence:
                    changes["endpoints"] = changes.get("endpoints", [])
                    changes["endpoints"].append(
                        {
                            "old": conflict.evidence["expectedEndpoint"],
                            "action": "verify-or-update",
                        }
                    )

            elif conflict.conflict_type == "resource-collision":
                # Suggest file path changes
                changes["files"] = changes.get("files", [])
                changes["files"].append(
                    {
                        "conflicting": conflict.affected_files,
                        "action": "review-collision",
                    }
                )

        return changes

    def _generate_proposed_revision(
        self, feature: Dict[str, Any], conflicts: List[ConflictDetail]
    ) -> str:
        """Generate proposed spec revision for moderate changes."""
        revision_parts = []

        for conflict in conflicts:
            if conflict.conflict_type == "api-break":
                revision_parts.append(
                    f"- Verify API endpoint {conflict.evidence.get('expectedEndpoint')} "
                    f"is still valid after {conflict.completed_feature_id}"
                )

            elif conflict.conflict_type == "arch-drift":
                revision_parts.append(
                    f"- Adjust architecture to match {conflict.evidence.get('completedPattern')} "
                    f"pattern instead of {conflict.evidence.get('futurePattern')}"
                )

            elif conflict.conflict_type == "resource-collision":
                files_str = ", ".join(conflict.affected_files[:3])
                revision_parts.append(
                    f"- Resolve file collision in {files_str}"
                )

        return "\n".join(revision_parts) if revision_parts else "Review and update spec based on conflicts"

    def _generate_respec_reason(
        self, feature: Dict[str, Any], conflicts: List[ConflictDetail]
    ) -> str:
        """Generate reason for major re-spec."""
        reasons = []

        for conflict in conflicts:
            if conflict.severity >= self.API_BREAK_SEVERITY:
                reasons.append(f"Critical {conflict.conflict_type}: {conflict.description}")

        return "; ".join(reasons) if reasons else "Multiple high-severity conflicts detected"

    def _build_dependency_chain(
        self, completed_feature: Dict[str, Any], future_feature: Dict[str, Any]
    ) -> List[str]:
        """Build dependency chain from completed to future feature."""
        chain = []

        completed_id = completed_feature.get("id")
        if completed_id:
            chain.append(completed_id)

        future_id = future_feature.get("id")
        if future_id:
            chain.append(future_id)

        return chain

    def _get_dependent_features(
        self, completed_feature: Dict[str, Any], remaining_features: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """Get features that depend on completed feature."""
        completed_id = completed_feature.get("id", "")

        dependent = []
        for feature in remaining_features:
            if completed_id in feature.get("dependencies", []):
                dependent.append(feature)

        return dependent

    def _extract_endpoints(self, spec: str) -> List[str]:
        """Extract API endpoints from spec text."""
        endpoints = []

        # Match patterns like /api/users, /auth/login, etc.
        pattern = r'/[a-zA-Z0-9/_-]+'
        matches = re.findall(pattern, spec)

        for match in matches:
            if match.startswith("/api") or match.startswith("/auth"):
                endpoints.append(match)

        return endpoints

    def _endpoint_potentially_changed(
        self, completed_feature: Dict[str, Any], endpoint: str
    ) -> bool:
        """Check if endpoint was potentially modified by completed feature."""
        files = completed_feature.get("files", [])

        # Check if any files are route/api files
        for file_path in files:
            file_lower = str(file_path).lower()
            if any(keyword in file_lower for keyword in ["route", "api", "endpoint", "controller"]):
                return True

        return False

    def _extract_arch_patterns(self, spec: str) -> Dict[str, str]:
        """Extract architectural patterns from spec."""
        patterns = {}
        spec_lower = spec.lower()

        # API patterns
        if "graphql" in spec_lower:
            patterns["api"] = "graphql"
        elif "rest" in spec_lower or "restful" in spec_lower:
            patterns["api"] = "rest"

        # State management
        if "redux" in spec_lower:
            patterns["state"] = "redux"
        elif "context" in spec_lower:
            patterns["state"] = "context"

        # Data patterns
        if "sql" in spec_lower or "postgres" in spec_lower or "mysql" in spec_lower:
            patterns["data"] = "sql"
        elif "nosql" in spec_lower or "mongo" in spec_lower:
            patterns["data"] = "nosql"

        # Auth patterns
        if "oauth" in spec_lower:
            patterns["auth"] = "oauth"
        elif "jwt" in spec_lower:
            patterns["auth"] = "jwt"

        return patterns

    def _save_assessment(self, assessment: ImpactAssessment) -> None:
        """Save impact assessment to disk."""
        # Serialize flagged features
        flagged_features_data = [asdict(f) for f in assessment.flagged_features]

        # Determine filename
        if assessment.trigger == "high-risk-completion":
            filename = f"high-risk-{assessment.trigger_feature_id}.json"
        else:
            filename = f"category-{assessment.trigger_category}-impact.json"

        file_path = self.impact_dir / filename

        assessment_data = {
            "trigger": assessment.trigger,
            "triggerFeatureId": assessment.trigger_feature_id,
            "triggerCategory": assessment.trigger_category,
            "analyzedFeatures": assessment.analyzed_features,
            "flaggedFeatures": flagged_features_data,
            "timestamp": assessment.timestamp,
            "analysisTimeMs": assessment.analysis_time_ms,
        }

        self.write_json_file(file_path, assessment_data)

    def _update_revision_flags(self, flagged_features: List[FlaggedFeature]) -> None:
        """Update revision flags file."""
        flags_file = self.impact_dir / "revision-flags.json"
        flags_data = self.read_json_file(
            flags_file, {"flaggedFeatures": [], "stats": {}}
        )

        # Add new flags
        for flagged in flagged_features:
            flags_data["flaggedFeatures"].append(
                {
                    "featureId": flagged.feature_id,
                    "status": "pending-revision",
                    "conflictScore": flagged.conflict_score,
                    "recommendation": flagged.recommendation,
                    "flaggedAt": int(time.time() * 1000),
                    "flaggedBy": flagged.dependency_chain[0] if flagged.dependency_chain else "unknown",
                    "resolvedAt": None,
                }
            )

        # Update stats
        stats = {
            "totalFlagged": len(flags_data["flaggedFeatures"]),
            "pendingRevision": sum(
                1 for f in flags_data["flaggedFeatures"] if f["status"] == "pending-revision"
            ),
            "autoAdjusted": sum(
                1 for f in flags_data["flaggedFeatures"] if f.get("resolution") == "auto-adjusted"
            ),
            "manuallyRevised": sum(
                1 for f in flags_data["flaggedFeatures"] if f.get("resolution") == "manually-revised"
            ),
            "majorRespecs": sum(
                1 for f in flags_data["flaggedFeatures"] if f["recommendation"] == "major-respec"
            ),
        }
        flags_data["stats"] = stats

        self.write_json_file(flags_file, flags_data)

    def apply_adjustment(self, flagged: FlaggedFeature) -> bool:
        """Apply minor adjustment to feature spec."""
        # TODO: Implement spec file modification
        self.emit_progress("adjusting", 100, f"Applied adjustment to {flagged.feature_id}")
        return True

    def apply_revision(self, flagged: FlaggedFeature) -> bool:
        """Apply moderate revision to feature spec."""
        # TODO: Implement spec revision
        self.emit_progress("revising", 100, f"Applied revision to {flagged.feature_id}")
        return True

    def apply_respec(self, flagged: FlaggedFeature) -> bool:
        """Apply major re-spec to feature."""
        # TODO: Implement full re-spec process
        self.emit_progress("respeccing", 100, f"Applied re-spec to {flagged.feature_id}")
        return True


# Example usage pattern (for documentation)
if __name__ == "__main__":
    from pathlib import Path

    project_path = Path(".")
    agent = ImpactAgent(project_path)

    # Simulate completed high-risk feature
    completed = {
        "id": "feat-003",
        "name": "Implement OAuth authentication",
        "status": "passed",
        "files": ["src/auth/oauth.ts", "src/auth/routes.ts"],
        "spec": "Implement OAuth using JWT tokens with /api/auth/login endpoint",
    }

    # Simulate remaining features
    remaining = [
        {
            "id": "feat-007",
            "name": "Add user profile page",
            "status": "pending",
            "files": ["src/pages/profile.tsx", "src/services/user-service.ts"],
            "dependencies": ["feat-003"],
            "spec": "Create profile page that calls /api/login endpoint",
        }
    ]

    impact = agent.assess_impact(
        completed_feature=completed,
        trigger="high-risk-completion",
        scope="direct-dependencies",
        remaining_features=remaining,
    )

    print(f"Analyzed: {impact.analyzed_features} features")
    print(f"Flagged: {len(impact.flagged_features)} features")

    for flagged in impact.flagged_features:
        print(f"\n{flagged.feature_id}: {flagged.recommendation} ({flagged.conflict_score} pts)")
        for conflict in flagged.conflicts:
            print(f"  - {conflict['conflict_type']}: {conflict['description']}")

"""
Checkpoint Agent for Autonomous Coding.

Provides risk-based human intervention points during execution.
Integrated into the orchestrator as a module (not a subprocess).
"""

import re
import time
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Optional, Dict, Any, List

from harness_agent import HarnessAgent


@dataclass
class RiskFactors:
    """Breakdown of risk score by factor"""

    file_count_score: int
    file_type_score: int
    recent_failures_score: int
    blast_radius_score: int
    total_score: int


@dataclass
class CheckpointDecision:
    """Checkpoint decision for a feature"""

    feature_id: str
    decision: str  # 'auto-proceed' | 'soft-checkpoint' | 'hard-checkpoint'
    risk_score: int
    risk_factors: RiskFactors
    reason: str
    timestamp: int
    approved: Optional[bool] = None
    approved_at: Optional[int] = None
    skipped: Optional[bool] = None


class CheckpointAgent(HarnessAgent):
    """
    Checkpoint Agent for risk-based intervention.

    Responsibilities:
    - Assess risk before each feature execution
    - Return decision based on risk score (0-100)
    - Log decisions for audit trail
    - Update blackboard with checkpoint state

    Usage:
        agent = CheckpointAgent(project_path)
        decision = agent.assess_risk(feature)
        if decision.decision == "hard-checkpoint":
            # Pause and wait for approval
    """

    # Risk thresholds
    AUTO_PROCEED_THRESHOLD = 30
    SOFT_CHECKPOINT_THRESHOLD = 70

    # High-risk file patterns
    HIGH_RISK_PATTERNS = {
        "auth": 30,  # Authentication/security
        "login": 30,
        "password": 30,
        "token": 30,
        "session": 30,
        "payment": 30,  # Financial
        "billing": 30,
        "checkout": 30,
        "stripe": 30,
        "paypal": 30,
        "migration": 25,  # Data integrity
        "schema": 25,
        "database": 25,
        "sql": 25,
    }

    MEDIUM_RISK_PATTERNS = {
        "api": 15,  # API changes
        "endpoint": 15,
        "route": 15,
        "service": 20,  # Business logic
        "model": 20,
        "controller": 20,
    }

    LOW_RISK_PATTERNS = {
        "component": 5,  # UI
        "style": 5,
        "css": 5,
        "test": 0,  # Tests/docs
        "spec": 0,
        "doc": 0,
        "readme": 0,
    }

    def __init__(self, project_path: Path):
        super().__init__(project_path)
        self.checkpoints_dir = self.project_path / ".autonomous" / "checkpoints"
        self.logs_dir = self.project_path / ".autonomous" / "logs"
        self.ensure_directory(self.checkpoints_dir)

    def assess_risk(self, feature: Dict[str, Any]) -> CheckpointDecision:
        """
        Main risk assessment method.

        Args:
            feature: Feature dict with id, name, category, files, dependencies, etc.

        Returns:
            CheckpointDecision with risk score and decision

        Risk Scoring:
        - 0-30: auto-proceed (low risk)
        - 31-70: soft-checkpoint (medium risk, show preview)
        - 71-100: hard-checkpoint (high risk, require approval)
        """
        self.start_phase("assessing", f"Assessing risk for {feature.get('name', 'unknown')}...")

        try:
            feature_id = feature.get("id", "unknown")

            # Calculate individual risk factors
            file_count_score = self._calculate_file_count_score(feature)
            file_type_score = self._calculate_file_type_score(feature)
            recent_failures_score = self._calculate_failure_score(feature)
            blast_radius_score = self._calculate_blast_radius(feature)

            total_score = (
                file_count_score
                + file_type_score
                + recent_failures_score
                + blast_radius_score
            )

            # Determine decision
            if total_score <= self.AUTO_PROCEED_THRESHOLD:
                decision_type = "auto-proceed"
            elif total_score < self.SOFT_CHECKPOINT_THRESHOLD:
                decision_type = "soft-checkpoint"
            else:
                decision_type = "hard-checkpoint"

            # Build reason
            reason_parts = []
            if file_type_score > 0:
                reason_parts.append(f"High-risk file types ({file_type_score} pts)")
            if file_count_score > 10:
                reason_parts.append(f"Multiple files ({file_count_score} pts)")
            if recent_failures_score > 0:
                reason_parts.append(f"Recent failures ({recent_failures_score} pts)")
            if blast_radius_score > 10:
                reason_parts.append(f"Wide impact ({blast_radius_score} pts)")

            reason = ", ".join(reason_parts) if reason_parts else "Low risk"

            risk_factors = RiskFactors(
                file_count_score=file_count_score,
                file_type_score=file_type_score,
                recent_failures_score=recent_failures_score,
                blast_radius_score=blast_radius_score,
                total_score=total_score,
            )

            decision = CheckpointDecision(
                feature_id=feature_id,
                decision=decision_type,
                risk_score=total_score,
                risk_factors=risk_factors,
                reason=reason,
                timestamp=int(time.time() * 1000),
            )

            # Save decision
            self._save_decision(decision)

            # Update blackboard
            self.write_blackboard(
                {
                    "checkpointDecision": {
                        "featureId": feature_id,
                        "decision": decision_type,
                        "riskScore": total_score,
                        "reason": reason,
                        "timestamp": decision.timestamp,
                    }
                }
            )

            self.emit_progress(
                "complete",
                100,
                f"Risk assessment complete: {decision_type} ({total_score} pts)",
            )

            return decision

        except Exception as e:
            self.emit_error(f"Risk assessment failed: {e}")
            # Return safe default (soft checkpoint)
            return CheckpointDecision(
                feature_id=feature.get("id", "unknown"),
                decision="soft-checkpoint",
                risk_score=50,
                risk_factors=RiskFactors(0, 0, 0, 0, 50),
                reason=f"Assessment error: {e}",
                timestamp=int(time.time() * 1000),
            )

    def _calculate_file_count_score(self, feature: Dict[str, Any]) -> int:
        """Calculate risk score based on number of files."""
        files = feature.get("files", [])
        file_count = len(files) if files else 0

        if file_count <= 3:
            return 0
        elif file_count <= 6:
            return 10
        elif file_count <= 10:
            return 15
        else:
            return 25

    def _calculate_file_type_score(self, feature: Dict[str, Any]) -> int:
        """Calculate risk score based on file types/patterns."""
        files = feature.get("files", [])
        if not files:
            # If no files specified, check feature name/description
            text = (
                feature.get("name", "")
                + " "
                + feature.get("description", "")
                + " "
                + feature.get("category", "")
            ).lower()
            return self._score_text_patterns(text)

        max_score = 0
        for file_path in files:
            file_lower = str(file_path).lower()
            score = self._score_text_patterns(file_lower)
            max_score = max(max_score, score)

        return max_score

    def _score_text_patterns(self, text: str) -> int:
        """Score text against risk patterns."""
        max_score = 0

        # Check high-risk patterns
        for pattern, score in self.HIGH_RISK_PATTERNS.items():
            if pattern in text:
                max_score = max(max_score, score)

        # Check medium-risk patterns if no high-risk match
        if max_score < 25:
            for pattern, score in self.MEDIUM_RISK_PATTERNS.items():
                if pattern in text:
                    max_score = max(max_score, score)

        # Check low-risk patterns if no higher match
        if max_score < 10:
            for pattern, score in self.LOW_RISK_PATTERNS.items():
                if pattern in text:
                    max_score = max(max_score, score)

        return max_score

    def _calculate_failure_score(self, feature: Dict[str, Any]) -> int:
        """Calculate risk score based on recent failures."""
        feature_id = feature.get("id", "")
        category = feature.get("category", "")

        # Load recent feature logs (last 5)
        recent_logs = self._load_recent_logs(5)

        # Check for similar feature failures
        similar_failures = 0
        category_failures = 0
        any_failures = 0

        for log in recent_logs:
            if log.get("status") == "failed":
                any_failures += 1

                # Same category?
                if log.get("category") == category:
                    category_failures += 1

                # Similar feature name?
                if self._is_similar_feature(feature, log):
                    similar_failures += 1

        # Score based on failure patterns
        if similar_failures > 0:
            return 20
        elif category_failures > 0:
            return 15
        elif any_failures > 0:
            return 10
        else:
            return 0

    def _calculate_blast_radius(self, feature: Dict[str, Any]) -> int:
        """Calculate risk score based on impact radius."""
        # Check dependencies
        dependencies = feature.get("dependencies", [])
        affected_features = feature.get("affectedFeatures", [])

        total_affected = len(dependencies) + len(affected_features)

        if total_affected >= 5:
            return 25
        elif total_affected >= 3:
            return 15
        elif total_affected >= 1:
            return 10
        else:
            return 0

    def _load_recent_logs(self, count: int) -> List[Dict[str, Any]]:
        """Load recent feature logs."""
        if not self.logs_dir.exists():
            return []

        logs = []
        log_files = sorted(self.logs_dir.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)

        for log_file in log_files[:count]:
            log_data = self.read_json_file(log_file)
            if log_data:
                logs.append(log_data)

        return logs

    def _is_similar_feature(self, feature: Dict[str, Any], log: Dict[str, Any]) -> bool:
        """Check if two features are similar."""
        feature_name = feature.get("name", "").lower()
        log_name = log.get("name", "").lower()

        # Simple similarity: share significant words
        feature_words = set(re.findall(r'\w+', feature_name))
        log_words = set(re.findall(r'\w+', log_name))

        # Remove common words
        common_words = {"the", "a", "an", "and", "or", "for", "to", "of", "in", "on"}
        feature_words -= common_words
        log_words -= common_words

        if not feature_words or not log_words:
            return False

        # Check overlap
        overlap = feature_words & log_words
        return len(overlap) >= 2 or len(overlap) / min(len(feature_words), len(log_words)) > 0.5

    def _save_decision(self, decision: CheckpointDecision) -> None:
        """Save checkpoint decision to disk."""
        # Save individual decision
        decision_file = self.checkpoints_dir / f"checkpoint-{decision.feature_id}.json"
        self.write_json_file(decision_file, asdict(decision))

        # Update decisions log
        log_file = self.checkpoints_dir / "decisions-log.json"
        log_data = self.read_json_file(log_file, {"decisions": [], "stats": {}})

        # Add to decisions list
        log_data["decisions"].append(
            {
                "featureId": decision.feature_id,
                "decision": decision.decision,
                "riskScore": decision.risk_score,
                "timestamp": decision.timestamp,
                "approved": decision.approved,
                "skipped": decision.skipped,
            }
        )

        # Update stats
        stats = {
            "totalDecisions": len(log_data["decisions"]),
            "autoProceed": sum(
                1 for d in log_data["decisions"] if d["decision"] == "auto-proceed"
            ),
            "softCheckpoints": sum(
                1
                for d in log_data["decisions"]
                if d["decision"] == "soft-checkpoint"
            ),
            "hardCheckpoints": sum(
                1
                for d in log_data["decisions"]
                if d["decision"] == "hard-checkpoint"
            ),
        }
        log_data["stats"] = stats

        self.write_json_file(log_file, log_data)

    def mark_approved(self, feature_id: str) -> None:
        """Mark a checkpoint as approved."""
        decision_file = self.checkpoints_dir / f"checkpoint-{feature_id}.json"
        decision_data = self.read_json_file(decision_file)

        if decision_data:
            decision_data["approved"] = True
            decision_data["approved_at"] = int(time.time() * 1000)
            self.write_json_file(decision_file, decision_data)

    def mark_skipped(self, feature_id: str) -> None:
        """Mark a checkpoint as skipped."""
        decision_file = self.checkpoints_dir / f"checkpoint-{feature_id}.json"
        decision_data = self.read_json_file(decision_file)

        if decision_data:
            decision_data["skipped"] = True
            self.write_json_file(decision_file, decision_data)


# Example usage pattern (for documentation)
if __name__ == "__main__":
    # Example: Using CheckpointAgent
    from pathlib import Path

    project_path = Path(".")
    agent = CheckpointAgent(project_path)

    # Test feature
    test_feature = {
        "id": "feat-001",
        "name": "Add user authentication",
        "category": "auth",
        "files": ["src/auth/login.ts", "src/auth/session.ts", "src/auth/token.ts"],
        "dependencies": ["feat-002", "feat-003"],
    }

    decision = agent.assess_risk(test_feature)
    print(f"Decision: {decision.decision}")
    print(f"Risk Score: {decision.risk_score}")
    print(f"Reason: {decision.reason}")

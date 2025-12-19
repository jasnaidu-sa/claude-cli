"""
Context Agent for Autonomous Coding.

Maintains compressed, relevant context to solve the "lost in the middle" problem.
Integrated into the orchestrator as a module (not a subprocess).
"""

import time
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Optional, Dict, Any, List

from harness_agent import HarnessAgent


# Token estimation (rough approximation)
def estimate_tokens(text: str) -> int:
    """Estimate token count (4 chars ≈ 1 token)"""
    return len(text) // 4


@dataclass
class RunningSummary:
    """Running summary of project state"""

    content: str
    token_count: int
    updated_at: int
    trigger: str  # 'feature_count' | 'category_complete' | 'manual'
    features_since_last_update: int
    total_features_completed: int


@dataclass
class KeyDecision:
    """Critical design decision"""

    id: str
    feature_id: str
    decision: str
    rationale: str
    impact: List[str]
    timestamp: int
    category: str  # 'architecture' | 'security' | 'performance' | 'ux' | 'data' | 'integration' | 'other'


@dataclass
class FailureRecord:
    """Record of failure with root cause"""

    id: str
    feature_id: str
    description: str
    root_cause: str
    resolution: str
    prevention: str
    timestamp: int
    severity: str  # 'low' | 'medium' | 'high' | 'critical'


@dataclass
class ActiveConstraint:
    """Active constraint limiting implementation"""

    id: str
    description: str
    reason: str
    affected_areas: List[str]
    added_at: int
    expires_at: Optional[int]
    type: str  # 'technical' | 'business' | 'security' | 'performance' | 'compatibility' | 'other'


class ContextAgent(HarnessAgent):
    """
    Context Agent for maintaining compressed project context.

    Responsibilities:
    - Summarize completed features
    - Extract key decisions
    - Record failures with root causes
    - Track active constraints
    - Compress context under 2K tokens

    Usage:
        agent = ContextAgent(project_path)
        agent.summarize(["feat-001", "feat-002"], trigger="feature_count")
        context = agent.get_injection("feat-003")
    """

    def __init__(self, project_path: Path):
        super().__init__(project_path)
        self.context_dir = self.project_path / ".autonomous" / "context"
        self.logs_dir = self.project_path / ".autonomous" / "logs"
        self.ensure_directory(self.context_dir)

    def load_running_summary(self) -> Optional[RunningSummary]:
        """Load existing running summary"""
        summary_file = self.context_dir / "running-summary.json"
        data = self.read_json_file(summary_file)
        if data:
            return RunningSummary(**data)
        return None

    def save_running_summary(self, summary: RunningSummary) -> None:
        """Save running summary to disk"""
        summary_file = self.context_dir / "running-summary.json"
        self.write_json_file(summary_file, asdict(summary))

    def load_decisions(self) -> List[KeyDecision]:
        """Load key decisions"""
        decisions_file = self.context_dir / "key-decisions.json"
        data = self.read_json_file(decisions_file, [])
        return [KeyDecision(**d) for d in data] if data else []

    def save_decisions(self, decisions: List[KeyDecision]) -> None:
        """Save key decisions to disk"""
        decisions_file = self.context_dir / "key-decisions.json"
        self.write_json_file(decisions_file, [asdict(d) for d in decisions])

    def load_failures(self) -> List[FailureRecord]:
        """Load failure records"""
        failures_file = self.context_dir / "failure-memory.json"
        data = self.read_json_file(failures_file, [])
        return [FailureRecord(**f) for f in data] if data else []

    def save_failures(self, failures: List[FailureRecord]) -> None:
        """Save failure records to disk"""
        failures_file = self.context_dir / "failure-memory.json"
        self.write_json_file(failures_file, [asdict(f) for f in failures])

    def load_constraints(self) -> List[ActiveConstraint]:
        """Load active constraints"""
        constraints_file = self.context_dir / "active-constraints.json"
        data = self.read_json_file(constraints_file, [])
        return [ActiveConstraint(**c) for c in data] if data else []

    def save_constraints(self, constraints: List[ActiveConstraint]) -> None:
        """Save active constraints to disk"""
        constraints_file = self.context_dir / "active-constraints.json"
        self.write_json_file(constraints_file, [asdict(c) for c in constraints])

    def load_feature_logs(self, feature_ids: List[str]) -> Dict[str, Any]:
        """Load logs for specific features"""
        feature_data = {}

        for feature_id in feature_ids:
            log_file = self.logs_dir / f"{feature_id}.json"
            data = self.read_json_file(log_file)
            if data:
                feature_data[feature_id] = data

        return feature_data

    def summarize(
        self,
        completed_features: List[str],
        trigger: str = "manual",
        category_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Main summarization method.

        Args:
            completed_features: List of feature IDs completed since last summary
            trigger: What triggered this summary ('feature_count' | 'category_complete' | 'manual')
            category_id: Optional category ID (if trigger is category_complete)

        Returns:
            Dict with summary result

        Steps:
        1. Load existing context
        2. Load feature logs
        3. Compress old summary, add new info
        4. Extract decisions/failures
        5. Update constraints
        6. Save everything
        7. Update blackboard
        """
        self.start_phase("loading", "Loading existing context...")

        try:
            # Phase 1: Loading
            current_summary = self.load_running_summary()
            decisions = self.load_decisions()
            failures = self.load_failures()
            constraints = self.load_constraints()

            # Phase 2: Analyzing
            self.emit_progress(
                "analyzing", 30, f"Analyzing {len(completed_features)} features..."
            )
            feature_logs = self.load_feature_logs(completed_features)

            # Phase 3: Summarizing
            self.emit_progress("summarizing", 50, "Compressing context...")
            new_summary = self._create_summary(
                current_summary, feature_logs, trigger, len(completed_features)
            )

            # Phase 4: Extracting
            self.emit_progress(
                "extracting", 70, "Extracting decisions and failures..."
            )
            new_decisions = self._extract_decisions(feature_logs)
            new_failures = self._extract_failures(feature_logs)

            # Phase 5: Saving
            self.emit_progress("saving", 90, "Saving context...")

            # Append new decisions/failures
            all_decisions = decisions + new_decisions
            all_failures = failures + new_failures

            # Keep only recent decisions (last 20)
            all_decisions = sorted(
                all_decisions, key=lambda d: d.timestamp, reverse=True
            )[:20]

            # Keep only recent failures (last 10)
            all_failures = sorted(
                all_failures, key=lambda f: f.timestamp, reverse=True
            )[:10]

            # Clean up expired constraints
            now = int(time.time() * 1000)
            active_constraints = [
                c
                for c in constraints
                if c.expires_at is None or c.expires_at > now
            ]

            # Save everything
            self.save_running_summary(new_summary)
            self.save_decisions(all_decisions)
            self.save_failures(all_failures)
            self.save_constraints(active_constraints)

            # Update blackboard
            self.write_blackboard(
                {
                    "contextSummary": {
                        "content": new_summary.content,
                        "tokenCount": new_summary.token_count,
                        "lastUpdated": new_summary.updated_at,
                    },
                    "lastContextUpdate": new_summary.updated_at,
                    "totalFeaturesCompleted": new_summary.total_features_completed,
                }
            )

            self.complete_phase("Context summarization complete")

            return {
                "success": True,
                "summary": asdict(new_summary),
                "newDecisions": len(new_decisions),
                "newFailures": len(new_failures),
                "activeConstraints": len(active_constraints),
            }

        except Exception as e:
            self.emit_error(f"Summarization failed: {e}")
            return {"success": False, "error": str(e)}

    def get_injection(self, feature_id: str) -> Dict[str, Any]:
        """
        Get context injection for a feature.

        Returns relevant context under 2K tokens to inject into execution prompt.

        Args:
            feature_id: Feature ID to get context for

        Returns:
            Dict with:
            - summary: Running summary text
            - decisions: Relevant decisions (filtered)
            - failures: Relevant failures (filtered)
            - constraints: All active constraints
            - tokenCount: Estimated token count
        """
        # Load current context
        summary = self.load_running_summary()
        decisions = self.load_decisions()
        failures = self.load_failures()
        constraints = self.load_constraints()

        if not summary:
            return {
                "summary": "",
                "decisions": [],
                "failures": [],
                "constraints": [],
                "tokenCount": 0,
            }

        # For now, include top 5 recent decisions, top 3 recent failures
        # In production, would filter by relevance to feature_id
        relevant_decisions = decisions[:5]
        relevant_failures = failures[:3]

        total_tokens = summary.token_count
        total_tokens += len(relevant_decisions) * 50  # ~50 tokens per decision
        total_tokens += len(relevant_failures) * 50  # ~50 tokens per failure
        total_tokens += len(constraints) * 30  # ~30 tokens per constraint

        return {
            "summary": summary.content,
            "decisions": [asdict(d) for d in relevant_decisions],
            "failures": [asdict(f) for d in relevant_failures],
            "constraints": [asdict(c) for c in constraints],
            "tokenCount": total_tokens,
        }

    def _create_summary(
        self,
        current: Optional[RunningSummary],
        feature_logs: Dict[str, Any],
        trigger: str,
        num_features: int,
    ) -> RunningSummary:
        """Create new running summary"""

        # For now, create a simple summary
        # In production, this would use Claude Haiku to intelligently compress

        summary_parts = []

        if current:
            # Include previous summary (compressed)
            summary_parts.append(f"## Previous State\n{current.content[:500]}...")

        summary_parts.append(f"\n## Recent Updates ({len(feature_logs)} features)")

        for feature_id, log in feature_logs.items():
            feature_name = log.get("name", feature_id)
            status = log.get("status", "unknown")
            summary_parts.append(f"- {feature_name}: {status}")

        content = "\n".join(summary_parts)
        token_count = estimate_tokens(content)

        # Ensure under 2000 tokens
        if token_count > 2000:
            content = content[:8000]  # Rough cut (4 chars per token)
            token_count = 2000

        total_completed = (
            current.total_features_completed if current else 0
        ) + num_features

        return RunningSummary(
            content=content,
            token_count=token_count,
            updated_at=int(time.time() * 1000),
            trigger=trigger,
            features_since_last_update=num_features,
            total_features_completed=total_completed,
        )

    def _extract_decisions(self, feature_logs: Dict[str, Any]) -> List[KeyDecision]:
        """Extract key decisions from feature logs"""
        # TODO: Use Claude Haiku to extract decisions from logs
        # For now, return empty list
        return []

    def _extract_failures(self, feature_logs: Dict[str, Any]) -> List[FailureRecord]:
        """Extract failures from feature logs"""
        # TODO: Use Claude Haiku to analyze failures
        # For now, return empty list
        return []

"""
Agent module for Autonomous Coding Agent.

Implements the main session loop for autonomous coding.
"""

import asyncio
import json
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, Any, List
from dataclasses import dataclass, field

from config import AgentConfig
from client import get_client
from security import BashSecurityFilter, sanitize_output
from context_agent import ContextAgent
from checkpoint_agent import CheckpointAgent
from impact_agent import ImpactAgent


@dataclass
class AgentState:
    """State tracking for the agent."""
    iteration: int = 0
    phase: str = "initialization"
    status: str = "idle"
    started_at: Optional[float] = None
    current_test: Optional[str] = None
    tests_total: int = 0
    tests_passing: int = 0
    tests_failing: int = 0
    errors: List[str] = field(default_factory=list)
    paused: bool = False


class AutonomousAgent:
    """
    Main autonomous coding agent.

    Manages the session loop, coordinates with Claude,
    and tracks progress.
    """

    def __init__(self, config: AgentConfig):
        self.config = config
        self.client = get_client(config)
        self.security = BashSecurityFilter(config.get_project_root())
        self.state = AgentState()
        self.output_dir = config.get_output_dir()
        self.output_dir.mkdir(parents=True, exist_ok=True)

        # Initialize harness agents
        self.context_agent = ContextAgent(config.get_project_root())
        self.checkpoint_agent = CheckpointAgent(config.get_project_root())
        self.impact_agent = ImpactAgent(config.get_project_root())
        self.completed_features: List[str] = []
        self.features_since_last_summary = 0
        self.current_category: Optional[str] = None
        self.category_features: Dict[str, List[str]] = {}

    def emit_output(self, output_type: str, data: str):
        """Emit output to stdout for the Electron app to capture."""
        output = {
            "type": output_type,
            "data": sanitize_output(data),
            "timestamp": time.time()
        }
        print(json.dumps(output), flush=True)

    def emit_progress(self, message: str):
        """Emit progress update."""
        progress = {
            "type": "progress",
            "phase": self.state.phase,
            "iteration": self.state.iteration,
            "tests_total": self.state.tests_total,
            "tests_passing": self.state.tests_passing,
            "current_test": self.state.current_test,
            "message": message,
            "timestamp": time.time()
        }
        print(json.dumps(progress), flush=True)

    def emit_status(self, status: str):
        """Emit status update."""
        self.state.status = status
        status_obj = {
            "type": "status",
            "status": status,
            "phase": self.state.phase,
            "iteration": self.state.iteration,
            "timestamp": time.time()
        }
        print(json.dumps(status_obj), flush=True)

    def load_system_prompt(self) -> str:
        """Load the appropriate system prompt for the current phase."""
        prompt_file = self.get_prompt_file()
        if prompt_file.exists():
            return prompt_file.read_text()

        # Default prompt if file not found
        return self.get_default_prompt()

    def get_prompt_file(self) -> Path:
        """Get the prompt file path for the current phase."""
        prompts_dir = Path(__file__).parent / "prompts"
        phase_prompts = {
            "validation": "schema_validation_prompt.md",
            "generation": "initializer_prompt_brownfield.md",
            "implementation": "coding_prompt_brownfield.md"
        }
        filename = phase_prompts.get(self.config.phase, "coding_prompt_brownfield.md")
        return prompts_dir / filename

    def get_default_prompt(self) -> str:
        """Get default system prompt."""
        return f"""You are an autonomous coding agent working on a software project.

Project Path: {self.config.project_path}
Phase: {self.config.phase}

Your task is to implement the features described in the specification,
following best practices and the existing codebase patterns.

Rules:
1. Read and understand existing code before making changes
2. Run tests after each significant change
3. Commit changes with descriptive messages
4. Report progress as you work

Output structured JSON for progress updates:
{{"type": "progress", "message": "...", "tests_passing": N, "tests_total": M}}
"""

    def load_spec(self) -> Optional[str]:
        """Load the specification content."""
        return self.config.get_spec_content()

    async def run_validation_phase(self):
        """Run schema validation phase."""
        self.state.phase = "validation"
        self.emit_status("running")
        self.emit_progress("Starting schema validation")

        spec = self.load_spec()
        if not spec:
            self.emit_output("stderr", "No specification file found")
            return

        prompt = self.load_system_prompt()
        message = f"""Please validate the project schema against this specification:

{spec}

Check for:
1. Missing schema documentation
2. Outdated schema sections
3. Inconsistencies between code and schema

Output a JSON file at .autonomous/schema_validation.json with your findings."""

        response = await self.client.send_message(message, prompt)
        self.emit_output("stdout", response)
        self.emit_progress("Schema validation complete")

    async def run_generation_phase(self):
        """Run test generation phase."""
        self.state.phase = "generation"
        self.emit_status("running")
        self.emit_progress("Starting test generation")

        spec = self.load_spec()
        if not spec:
            self.emit_output("stderr", "No specification file found")
            return

        prompt = self.load_system_prompt()
        message = f"""Based on this specification, generate a comprehensive feature list
with test cases:

{spec}

Create a feature_list.json file at .autonomous/feature_list.json with all features
categorized and ready for implementation."""

        response = await self.client.send_message(message, prompt)
        self.emit_output("stdout", response)
        self.emit_progress("Test generation complete")

    async def run_implementation_phase(self):
        """Run the main implementation loop."""
        self.state.phase = "implementation"
        self.emit_status("running")
        self.emit_progress("Starting implementation")

        # Load feature list
        feature_list_path = self.output_dir / "feature_list.json"
        if not feature_list_path.exists():
            self.emit_output("stderr", "No feature_list.json found. Run generation phase first.")
            return

        try:
            features = json.loads(feature_list_path.read_text())
        except json.JSONDecodeError as e:
            self.emit_output("stderr", f"Invalid feature_list.json: {e}")
            return

        feature_items = features.get("features", [])
        self.state.tests_total = len(feature_items)

        spec = self.load_spec()
        prompt = self.load_system_prompt()

        # Implementation loop
        while self.state.iteration < self.config.max_iterations:
            if self.state.paused:
                await asyncio.sleep(1)
                continue

            self.state.iteration += 1

            # Find next pending feature
            pending = [f for f in feature_items if f.get("status") == "pending"]
            if not pending:
                self.emit_progress("All features implemented!")
                break

            current_feature = pending[0]
            feature_id = current_feature.get("id", f"feature-{self.state.iteration}")
            self.state.current_test = current_feature.get("name", "Unknown")
            self.emit_progress(f"Implementing: {self.state.current_test}")

            # CHECKPOINT: Assess risk before execution
            checkpoint_decision = self.checkpoint_agent.assess_risk(current_feature)

            # Handle checkpoint (pause, preview, or proceed)
            should_proceed = self.handle_checkpoint(checkpoint_decision, current_feature)

            if not should_proceed:
                # User skipped this feature
                current_feature["status"] = "skipped"
                self.save_feature_list(features)
                continue

            # Update feature status with start time
            current_feature["status"] = "in_progress"
            current_feature["id"] = feature_id  # Ensure ID is set
            current_feature["startedAt"] = int(time.time() * 1000)
            self.save_feature_list(features)

            # Build base message
            base_message = f"""Implement this feature:

Feature ID: {feature_id}
Name: {current_feature.get('name')}
Category: {current_feature.get('category')}

Specification context:
{spec or 'No spec provided'}

Please:
1. Read relevant existing code
2. Implement the feature
3. Run tests
4. Commit if tests pass

Report your progress."""

            # Inject context from Context Agent
            message = self.inject_context(base_message, feature_id)

            try:
                response = await self.client.send_message(message, prompt)
                self.emit_output("stdout", response)

                # Check if implementation succeeded (simple heuristic)
                if "test" in response.lower() and "pass" in response.lower():
                    current_feature["status"] = "passed"
                    self.state.tests_passing += 1
                else:
                    current_feature["status"] = "failed"
                    self.state.tests_failing += 1

                # Write feature log for Context Agent
                self.write_feature_log(current_feature)

                # Track completed features for summarization
                self.completed_features.append(feature_id)
                self.features_since_last_summary += 1

                # Track category progress
                feature_category = current_feature.get("category", "uncategorized")
                if feature_category not in self.category_features:
                    self.category_features[feature_category] = []
                self.category_features[feature_category].append(feature_id)

                self.save_feature_list(features)
                self.emit_progress(f"Completed: {self.state.current_test}")

                # IMPACT ASSESSMENT: Trigger 1 - High-risk feature completion
                if checkpoint_decision.decision == "hard-checkpoint":
                    # High-risk feature completed, analyze direct dependencies
                    remaining = [f for f in feature_items if f.get("status") == "pending"]
                    if remaining:
                        self.emit_progress("Analyzing impact of high-risk feature...")
                        impact_results = self.impact_agent.assess_impact(
                            completed_feature=current_feature,
                            trigger="high-risk-completion",
                            scope="direct-dependencies",
                            remaining_features=remaining
                        )
                        self.handle_impact_results(impact_results)

                # IMPACT ASSESSMENT: Trigger 2 - Category completion check
                if self.is_category_complete(feature_category, feature_items):
                    # Category completed, analyze all remaining features
                    remaining = [f for f in feature_items if f.get("status") == "pending"]
                    if remaining:
                        self.emit_progress(f"Category '{feature_category}' complete. Analyzing impact...")
                        impact_results = self.impact_agent.assess_impact(
                            completed_category=feature_category,
                            trigger="category-completion",
                            scope="all-remaining",
                            remaining_features=remaining
                        )
                        self.handle_impact_results(impact_results)

                # Trigger context summarization every 5 features
                if self.features_since_last_summary >= 5:
                    self.trigger_context_summarization()

            except Exception as e:
                self.emit_output("stderr", f"Error: {e}")
                current_feature["status"] = "failed"
                self.state.errors.append(str(e))

                if self.config.pause_on_error:
                    self.state.paused = True
                    self.emit_status("paused")

            # Brief pause between iterations
            await asyncio.sleep(0.5)

        # Final context summarization for remaining features
        if self.completed_features:
            self.trigger_context_summarization()

        self.emit_progress("Implementation phase complete")

    def save_feature_list(self, features: Dict[str, Any]):
        """Save updated feature list."""
        feature_list_path = self.output_dir / "feature_list.json"
        features["updatedAt"] = time.time()
        features["currentTest"] = self.state.current_test
        feature_list_path.write_text(json.dumps(features, indent=2))

    def write_feature_log(self, feature: Dict[str, Any]):
        """Write feature completion log for Context Agent."""
        logs_dir = self.config.get_project_root() / ".autonomous" / "logs"
        logs_dir.mkdir(parents=True, exist_ok=True)

        feature_id = feature.get("id", "unknown")
        log_file = logs_dir / f"{feature_id}.json"

        log_data = {
            "id": feature_id,
            "name": feature.get("name", "Unknown"),
            "category": feature.get("category", "uncategorized"),
            "status": feature.get("status", "unknown"),
            "startedAt": feature.get("startedAt", time.time() * 1000),
            "completedAt": int(time.time() * 1000),
            "iteration": self.state.iteration
        }

        log_file.write_text(json.dumps(log_data, indent=2))

    def inject_context(self, base_message: str, feature_id: str) -> str:
        """Inject compressed context into prompt."""
        try:
            context_injection = self.context_agent.get_injection(feature_id)

            if context_injection["tokenCount"] == 0:
                return base_message

            context_section = "\n\n## Project Context\n\n"
            context_section += f"**Summary:**\n{context_injection['summary']}\n\n"

            if context_injection["decisions"]:
                context_section += "**Key Decisions:**\n"
                for decision in context_injection["decisions"][:3]:
                    context_section += f"- {decision['decision']} (Feature {decision['featureId']})\n"
                context_section += "\n"

            if context_injection["failures"]:
                context_section += "**Recent Failures to Avoid:**\n"
                for failure in context_injection["failures"][:2]:
                    context_section += f"- {failure['description']}: {failure['prevention']}\n"
                context_section += "\n"

            if context_injection["constraints"]:
                context_section += "**Active Constraints:**\n"
                for constraint in context_injection["constraints"]:
                    context_section += f"- {constraint['description']}\n"
                context_section += "\n"

            return base_message + context_section

        except Exception as e:
            self.emit_output("stderr", f"Context injection failed: {e}")
            return base_message

    def trigger_context_summarization(self):
        """Trigger context summarization after batch of features."""
        if not self.completed_features:
            return

        try:
            self.emit_progress("Summarizing context...")
            result = self.context_agent.summarize(
                self.completed_features,
                trigger="feature_count"
            )

            if result["success"]:
                self.emit_progress(
                    f"Context updated: {result['newDecisions']} decisions, "
                    f"{result['newFailures']} failures tracked"
                )
                self.completed_features = []
                self.features_since_last_summary = 0
            else:
                self.emit_output("stderr", f"Context summarization failed: {result.get('error')}")

        except Exception as e:
            self.emit_output("stderr", f"Context summarization error: {e}")

    def handle_checkpoint(self, decision, feature: Dict[str, Any]) -> bool:
        """
        Handle checkpoint decision.

        Args:
            decision: CheckpointDecision from checkpoint agent
            feature: Feature dict

        Returns:
            True to proceed, False to skip feature
        """
        if decision.decision == "auto-proceed":
            # Low risk, proceed automatically
            return True

        elif decision.decision == "soft-checkpoint":
            # Medium risk, show preview with skip option
            self.emit_output(
                "checkpoint",
                json.dumps({
                    "type": "soft",
                    "featureId": feature.get("id"),
                    "featureName": feature.get("name"),
                    "riskScore": decision.risk_score,
                    "reason": decision.reason,
                    "riskFactors": decision.risk_factors.__dict__
                })
            )

            # For now, auto-approve soft checkpoints
            # TODO: Wait for user input via stdin or IPC
            self.checkpoint_agent.mark_approved(feature.get("id"))
            return True

        elif decision.decision == "hard-checkpoint":
            # High risk, require explicit approval
            self.emit_output(
                "checkpoint",
                json.dumps({
                    "type": "hard",
                    "featureId": feature.get("id"),
                    "featureName": feature.get("name"),
                    "riskScore": decision.risk_score,
                    "reason": decision.reason,
                    "riskFactors": decision.risk_factors.__dict__
                })
            )

            # For now, auto-approve hard checkpoints
            # TODO: Pause and wait for explicit user approval
            self.checkpoint_agent.mark_approved(feature.get("id"))
            return True

        return True

    def is_category_complete(self, category: str, all_features: List[Dict[str, Any]]) -> bool:
        """Check if all features in a category are completed."""
        category_features = [f for f in all_features if f.get("category") == category]

        if not category_features:
            return False

        # Check if all features in this category are completed (passed or failed, not pending)
        completed_features = [
            f for f in category_features
            if f.get("status") in ["passed", "failed", "skipped"]
        ]

        return len(completed_features) == len(category_features)

    def handle_impact_results(self, assessment) -> None:
        """
        Handle impact assessment results and trigger re-specs.

        Args:
            assessment: ImpactAssessment object from impact agent
        """
        if not assessment.flagged_features:
            self.emit_progress("No impact conflicts detected")
            return

        for flagged_data in assessment.flagged_features:
            # Reconstruct FlaggedFeature from dict (if needed)
            feature_id = flagged_data.feature_id if hasattr(flagged_data, 'feature_id') else flagged_data.get("feature_id")
            recommendation = flagged_data.recommendation if hasattr(flagged_data, 'recommendation') else flagged_data.get("recommendation")
            conflict_score = flagged_data.conflict_score if hasattr(flagged_data, 'conflict_score') else flagged_data.get("conflict_score")

            if recommendation == "no-action":
                # Log only, continue
                self.emit_progress(f"Feature {feature_id}: No action needed")

            elif recommendation == "minor-adjustment":
                # Auto-update spec
                proposed_changes = flagged_data.proposed_changes if hasattr(flagged_data, 'proposed_changes') else flagged_data.get("proposed_changes")
                self.emit_output(
                    "impact",
                    json.dumps({
                        "type": "auto-adjustment",
                        "featureId": feature_id,
                        "conflictScore": conflict_score,
                        "changes": proposed_changes
                    })
                )
                self.impact_agent.apply_adjustment(flagged_data)

            elif recommendation == "moderate-revision":
                # Soft checkpoint: show preview, allow skip
                conflicts = flagged_data.conflicts if hasattr(flagged_data, 'conflicts') else flagged_data.get("conflicts")
                proposed_revision = flagged_data.proposed_revision if hasattr(flagged_data, 'proposed_revision') else flagged_data.get("proposed_revision")

                self.emit_output(
                    "impact",
                    json.dumps({
                        "type": "soft-respec",
                        "featureId": feature_id,
                        "conflictScore": conflict_score,
                        "conflicts": conflicts,
                        "proposedRevision": proposed_revision
                    })
                )
                # TODO: Wait for user approval
                self.impact_agent.apply_revision(flagged_data)

            elif recommendation == "major-respec":
                # Hard checkpoint: require approval
                conflicts = flagged_data.conflicts if hasattr(flagged_data, 'conflicts') else flagged_data.get("conflicts")
                respec_reason = flagged_data.respec_reason if hasattr(flagged_data, 'respec_reason') else flagged_data.get("respec_reason")

                self.emit_output(
                    "impact",
                    json.dumps({
                        "type": "hard-respec",
                        "featureId": feature_id,
                        "conflictScore": conflict_score,
                        "conflicts": conflicts,
                        "reason": respec_reason
                    })
                )
                # TODO: Pause and wait for explicit approval
                self.impact_agent.apply_respec(flagged_data)

    async def run(self):
        """Run the agent based on configured phase."""
        self.state.started_at = time.time()
        self.emit_status("starting")

        try:
            if self.config.phase == "validation":
                await self.run_validation_phase()
            elif self.config.phase == "generation":
                await self.run_generation_phase()
            elif self.config.phase == "implementation":
                await self.run_implementation_phase()
            else:
                self.emit_output("stderr", f"Unknown phase: {self.config.phase}")

            self.emit_status("completed")

        except Exception as e:
            self.emit_output("stderr", f"Agent error: {e}")
            self.emit_status("error")
            raise

    def pause(self):
        """Pause the agent."""
        self.state.paused = True
        self.emit_status("paused")

    def resume(self):
        """Resume the agent."""
        self.state.paused = False
        self.emit_status("running")

    def stop(self):
        """Stop the agent."""
        self.emit_status("stopping")
        # Set iteration to max to break loop
        self.state.iteration = self.config.max_iterations

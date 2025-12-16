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
            self.state.current_test = current_feature.get("name", "Unknown")
            self.emit_progress(f"Implementing: {self.state.current_test}")

            # Update feature status
            current_feature["status"] = "in_progress"
            self.save_feature_list(features)

            # Ask Claude to implement
            message = f"""Implement this feature:

Feature ID: {current_feature.get('id')}
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

                self.save_feature_list(features)
                self.emit_progress(f"Completed: {self.state.current_test}")

            except Exception as e:
                self.emit_output("stderr", f"Error: {e}")
                current_feature["status"] = "failed"
                self.state.errors.append(str(e))

                if self.config.pause_on_error:
                    self.state.paused = True
                    self.emit_status("paused")

            # Brief pause between iterations
            await asyncio.sleep(0.5)

        self.emit_progress("Implementation phase complete")

    def save_feature_list(self, features: Dict[str, Any]):
        """Save updated feature list."""
        feature_list_path = self.output_dir / "feature_list.json"
        features["updatedAt"] = time.time()
        features["currentTest"] = self.state.current_test
        feature_list_path.write_text(json.dumps(features, indent=2))

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

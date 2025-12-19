"""
Harness Agent Base Class

Base class for agents that augment the autonomous orchestrator.
Provides common patterns for agent coordination via blackboard.
"""

import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Any, Optional


@dataclass
class AgentState:
    """Base state tracking for harness agents"""

    phase: str = "idle"
    progress: int = 0
    message: str = ""
    started_at: Optional[float] = None


class HarnessAgent:
    """
    Base class for harness agents that augment the orchestrator.

    Provides:
    - Blackboard read/write (shared state coordination)
    - Progress emission (for visibility)
    - State management
    - Common utilities
    """

    def __init__(self, project_path: Path):
        self.project_path = Path(project_path)
        self.state_dir = self.project_path / ".autonomous" / "state"
        self.state_dir.mkdir(parents=True, exist_ok=True)
        self.state = AgentState()

    def read_blackboard(self) -> Dict[str, Any]:
        """
        Read current execution state from blackboard.

        Blackboard: .autonomous/state/execution-state.json

        Returns:
            Dict with current execution state
        """
        state_file = self.state_dir / "execution-state.json"
        if state_file.exists():
            try:
                return json.loads(state_file.read_text())
            except json.JSONDecodeError:
                print(f"[{self.__class__.__name__}] Warning: Could not parse blackboard state")
                return {}
        return {}

    def write_blackboard(self, updates: Dict[str, Any]) -> None:
        """
        Update execution state on blackboard.

        Args:
            updates: Dictionary of updates to merge into state

        Note:
            Updates are merged with existing state, not replaced.
            Always adds lastUpdated timestamp.
        """
        state_file = self.state_dir / "execution-state.json"

        # Read current state
        current = self.read_blackboard()

        # Merge updates
        current.update(updates)
        current["lastUpdated"] = int(time.time() * 1000)

        # Write back
        state_file.write_text(json.dumps(current, indent=2))

    def emit_progress(self, phase: str, progress: int, message: str) -> None:
        """
        Emit progress update for visibility.

        Args:
            phase: Current phase (e.g., 'loading', 'analyzing', 'complete')
            progress: Progress percentage (0-100)
            message: Human-readable progress message

        Note:
            Progress is logged to stdout for orchestrator to capture.
            Can be picked up by UI for display.
        """
        self.state.phase = phase
        self.state.progress = progress
        self.state.message = message

        # Log to stdout (orchestrator captures this)
        print(
            f"[{self.__class__.__name__}] {phase}: {message} ({progress}%)", flush=True
        )

    def emit_error(self, error: str) -> None:
        """
        Emit error message.

        Args:
            error: Error message

        Note:
            Errors are logged but do NOT crash the orchestrator.
            Agents should be fault-tolerant.
        """
        print(f"[{self.__class__.__name__}] ERROR: {error}", flush=True)

    def get_state_value(self, key: str, default: Any = None) -> Any:
        """
        Get a value from blackboard state.

        Args:
            key: Key to retrieve
            default: Default value if key not found

        Returns:
            Value from state or default
        """
        state = self.read_blackboard()
        return state.get(key, default)

    def set_state_value(self, key: str, value: Any) -> None:
        """
        Set a single value in blackboard state.

        Args:
            key: Key to set
            value: Value to set

        Note:
            For multiple updates, use write_blackboard() instead
            to avoid multiple file writes.
        """
        self.write_blackboard({key: value})

    def ensure_directory(self, dir_path: Path) -> None:
        """
        Ensure a directory exists.

        Args:
            dir_path: Directory path to create
        """
        dir_path.mkdir(parents=True, exist_ok=True)

    def read_json_file(self, file_path: Path, default: Any = None) -> Any:
        """
        Read JSON file safely.

        Args:
            file_path: Path to JSON file
            default: Default value if file doesn't exist or can't be parsed

        Returns:
            Parsed JSON or default
        """
        if not file_path.exists():
            return default

        try:
            return json.loads(file_path.read_text())
        except json.JSONDecodeError as e:
            self.emit_error(f"Failed to parse {file_path}: {e}")
            return default

    def write_json_file(self, file_path: Path, data: Any) -> None:
        """
        Write JSON file safely.

        Args:
            file_path: Path to write to
            data: Data to serialize

        Note:
            Creates parent directories if needed.
        """
        file_path.parent.mkdir(parents=True, exist_ok=True)
        file_path.write_text(json.dumps(data, indent=2))

    def start_phase(self, phase: str, message: str) -> None:
        """
        Mark start of a phase.

        Args:
            phase: Phase name
            message: Phase description
        """
        self.state.started_at = time.time()
        self.emit_progress(phase, 0, message)

    def complete_phase(self, message: str = "Complete") -> None:
        """
        Mark completion of current phase.

        Args:
            message: Completion message
        """
        duration = (
            time.time() - self.state.started_at if self.state.started_at else 0
        )
        self.emit_progress("complete", 100, f"{message} (took {duration:.1f}s)")


# Example usage pattern (for documentation)
if __name__ == "__main__":
    # Example: Using HarnessAgent base class
    class ExampleAgent(HarnessAgent):
        """Example agent implementation"""

        def do_work(self):
            """Example work method"""
            self.start_phase("working", "Starting work...")

            # Do some work
            self.emit_progress("working", 50, "Halfway done...")

            # Update blackboard
            self.write_blackboard({"exampleValue": 42, "status": "working"})

            # Read from blackboard
            state = self.read_blackboard()
            print(f"Current state: {state}")

            self.complete_phase("Work complete")

    # Test
    agent = ExampleAgent(Path("."))
    agent.do_work()

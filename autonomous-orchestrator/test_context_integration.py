"""
Test Context Agent Integration

Simple test to verify Context Agent works correctly with the orchestrator.
"""

# Set UTF-8 encoding for Windows console
import sys
import io
if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

import json
import tempfile
import shutil
from pathlib import Path
from context_agent import ContextAgent


def test_context_agent_basic():
    """Test basic Context Agent functionality."""
    print("\n=== Testing Context Agent Basic Operations ===\n")

    # Create temporary test project
    with tempfile.TemporaryDirectory() as tmpdir:
        project_path = Path(tmpdir)
        print(f"Test project: {project_path}")

        # Initialize Context Agent
        agent = ContextAgent(project_path)
        print("[OK] Context Agent initialized")

        # Create test feature logs
        logs_dir = project_path / ".autonomous" / "logs"
        logs_dir.mkdir(parents=True, exist_ok=True)

        test_features = [
            {
                "id": "feat-001",
                "name": "User Authentication",
                "category": "auth",
                "status": "passed",
                "startedAt": 1734600000000,
                "completedAt": 1734600300000,
            },
            {
                "id": "feat-002",
                "name": "Login Form",
                "category": "auth",
                "status": "passed",
                "startedAt": 1734600400000,
                "completedAt": 1734600700000,
            },
            {
                "id": "feat-003",
                "name": "Password Reset",
                "category": "auth",
                "status": "failed",
                "startedAt": 1734600800000,
                "completedAt": 1734601100000,
            },
        ]

        for feature in test_features:
            log_file = logs_dir / f"{feature['id']}.json"
            log_file.write_text(json.dumps(feature, indent=2))

        print(f"[OK] Created {len(test_features)} test feature logs")

        # Test summarization
        print("\n--- Testing Summarization ---")
        result = agent.summarize(
            ["feat-001", "feat-002", "feat-003"], trigger="manual"
        )

        if result["success"]:
            print("[OK] Summarization succeeded")
            print(f"  - New decisions: {result['newDecisions']}")
            print(f"  - New failures: {result['newFailures']}")
            print(f"  - Active constraints: {result['activeConstraints']}")

            # Check files were created
            context_dir = project_path / ".autonomous" / "context"
            assert (context_dir / "running-summary.json").exists(), "Missing running-summary.json"
            assert (context_dir / "key-decisions.json").exists(), "Missing key-decisions.json"
            assert (context_dir / "failure-memory.json").exists(), "Missing failure-memory.json"
            assert (
                context_dir / "active-constraints.json"
            ).exists(), "Missing active-constraints.json"
            print("[OK] All context files created")

            # Load and verify summary
            summary_file = context_dir / "running-summary.json"
            summary = json.loads(summary_file.read_text())
            print(f"  - Summary token count: {summary['token_count']}")
            print(f"  - Total features completed: {summary['total_features_completed']}")
            print(f"  - Trigger: {summary['trigger']}")

            assert summary["token_count"] < 2000, "Summary exceeds 2K token limit!"
            print("[OK] Summary within token budget")

        else:
            print(f"[FAIL] Summarization failed: {result.get('error')}")
            return False

        # Test context injection
        print("\n--- Testing Context Injection ---")
        injection = agent.get_injection("feat-004")

        print(f"[OK] Got context injection for feat-004")
        print(f"  - Token count: {injection.get('tokenCount', 0)}")
        print(f"  - Summary length: {len(injection.get('summary', ''))} chars")
        print(f"  - Decisions: {len(injection.get('decisions', []))}")
        print(f"  - Failures: {len(injection.get('failures', []))}")
        print(f"  - Constraints: {len(injection.get('constraints', []))}")

        assert injection.get("tokenCount", 0) < 2500, "Injection exceeds token budget!"
        print("[OK] Injection within token budget")

        # Test blackboard updates
        print("\n--- Testing Blackboard Updates ---")
        state_file = project_path / ".autonomous" / "state" / "execution-state.json"
        assert state_file.exists(), "Blackboard state file not created!"

        state = json.loads(state_file.read_text())
        assert "contextSummary" in state, "contextSummary not in blackboard!"
        assert "lastUpdated" in state, "lastUpdated not in blackboard!"
        print("[OK] Blackboard updated correctly")
        print(f"  - Context summary token count: {state['contextSummary']['tokenCount']}")
        print(f"  - Last updated: {state['lastUpdated']}")

        print("\n=== All Tests Passed [OK] ===\n")
        return True


def test_context_agent_with_orchestrator_pattern():
    """Test Context Agent using the orchestrator integration pattern."""
    print("\n=== Testing Orchestrator Integration Pattern ===\n")

    with tempfile.TemporaryDirectory() as tmpdir:
        project_path = Path(tmpdir)
        print(f"Test project: {project_path}")

        # Simulate orchestrator initialization
        context_agent = ContextAgent(project_path)
        completed_features = []
        features_since_last_summary = 0

        print("[OK] Initialized (simulating orchestrator)")

        # Simulate feature execution loop
        test_features = [
            {"id": "feat-001", "name": "Feature 1", "category": "core", "status": "passed"},
            {"id": "feat-002", "name": "Feature 2", "category": "core", "status": "passed"},
            {"id": "feat-003", "name": "Feature 3", "category": "auth", "status": "passed"},
            {"id": "feat-004", "name": "Feature 4", "category": "auth", "status": "failed"},
            {"id": "feat-005", "name": "Feature 5", "category": "api", "status": "passed"},
            {"id": "feat-006", "name": "Feature 6", "category": "api", "status": "passed"},
        ]

        # Create logs directory
        logs_dir = project_path / ".autonomous" / "logs"
        logs_dir.mkdir(parents=True, exist_ok=True)

        for i, feature in enumerate(test_features, 1):
            feature_id = feature["id"]
            print(f"\n[Feature {i}] {feature['name']} ({feature_id})")

            # 1. Get context injection (before execution)
            injection = context_agent.get_injection(feature_id)
            print(f"  [OK] Got context injection ({injection.get('tokenCount', 0)} tokens)")

            # 2. Simulate execution (write log)
            log_file = logs_dir / f"{feature_id}.json"
            log_file.write_text(json.dumps(feature, indent=2))
            print(f"  [OK] Wrote feature log")

            # 3. Track completion
            completed_features.append(feature_id)
            features_since_last_summary += 1

            # 4. Trigger summarization every 5 features
            if features_since_last_summary >= 5:
                print(f"\n  [SUMMARIZE] Triggering summarization ({len(completed_features)} features)...")
                result = context_agent.summarize(completed_features, trigger="feature_count")

                if result["success"]:
                    print(f"  [OK] Context updated:")
                    print(f"    - New decisions: {result['newDecisions']}")
                    print(f"    - New failures: {result['newFailures']}")
                    completed_features = []
                    features_since_last_summary = 0
                else:
                    print(f"  [FAIL] Summarization failed: {result.get('error')}")

        # Final summarization
        if completed_features:
            print(f"\n[SUMMARIZE] Final summarization ({len(completed_features)} remaining features)...")
            result = context_agent.summarize(completed_features, trigger="manual")
            if result["success"]:
                print("[OK] Final context update complete")

        print("\n=== Orchestrator Integration Test Passed [OK] ===\n")
        return True


if __name__ == "__main__":
    try:
        # Run basic test
        success1 = test_context_agent_basic()

        # Run orchestrator pattern test
        success2 = test_context_agent_with_orchestrator_pattern()

        if success1 and success2:
            print("\n" + "=" * 60)
            print("[SUCCESS] ALL TESTS PASSED")
            print("=" * 60 + "\n")
        else:
            print("\n" + "=" * 60)
            print("[FAIL] SOME TESTS FAILED")
            print("=" * 60 + "\n")
            exit(1)

    except Exception as e:
        print(f"\n[ERROR] Test error: {e}")
        import traceback

        traceback.print_exc()
        exit(1)

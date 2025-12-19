"""
Test Checkpoint Agent

Tests for risk assessment and checkpoint decision logic.
"""

# Set UTF-8 encoding for Windows console
import sys
import io
if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

import json
import tempfile
from pathlib import Path
from checkpoint_agent import CheckpointAgent


def test_checkpoint_agent_basic():
    """Test basic checkpoint agent functionality."""
    print("\n=== Testing Checkpoint Agent Basic Operations ===\n")

    with tempfile.TemporaryDirectory() as tmpdir:
        project_path = Path(tmpdir)
        print(f"Test project: {project_path}")

        # Initialize Checkpoint Agent
        agent = CheckpointAgent(project_path)
        print("[OK] Checkpoint Agent initialized")

        # Test 1: Low risk feature (auto-proceed)
        print("\n--- Test 1: Low Risk Feature ---")
        low_risk_feature = {
            "id": "feat-001",
            "name": "Update button color",
            "category": "ui",
            "files": ["src/components/Button.tsx"],
            "dependencies": []
        }

        decision = agent.assess_risk(low_risk_feature)
        print(f"Decision: {decision.decision}")
        print(f"Risk Score: {decision.risk_score}")
        print(f"Reason: {decision.reason}")

        assert decision.decision == "auto-proceed", f"Expected auto-proceed, got {decision.decision}"
        assert decision.risk_score <= 30, f"Expected score <=30, got {decision.risk_score}"
        print("[OK] Low risk correctly identified")

        # Test 2: Medium risk feature (soft-checkpoint)
        print("\n--- Test 2: Medium Risk Feature ---")
        medium_risk_feature = {
            "id": "feat-002",
            "name": "Add user profile API",
            "category": "api",
            "files": [
                "src/api/user/profile.ts",
                "src/api/user/routes.ts",
                "src/services/user-service.ts",
                "src/models/user.ts"
            ],
            "dependencies": ["feat-003"]
        }

        decision = agent.assess_risk(medium_risk_feature)
        print(f"Decision: {decision.decision}")
        print(f"Risk Score: {decision.risk_score}")
        print(f"Reason: {decision.reason}")

        assert decision.decision == "soft-checkpoint", f"Expected soft-checkpoint, got {decision.decision}"
        assert 31 <= decision.risk_score <= 70, f"Expected score 31-70, got {decision.risk_score}"
        print("[OK] Medium risk correctly identified")

        # Test 3: High risk feature (hard-checkpoint)
        print("\n--- Test 3: High Risk Feature ---")
        high_risk_feature = {
            "id": "feat-003",
            "name": "Implement OAuth authentication",
            "category": "auth",
            "files": [
                "src/auth/oauth.ts",
                "src/auth/token.ts",
                "src/auth/session.ts",
                "src/auth/login.ts",
                "src/auth/middleware.ts",
                "src/services/auth-service.ts",
                "src/config/auth-config.ts"
            ],
            "dependencies": ["feat-001", "feat-002", "feat-004", "feat-005", "feat-006"]
        }

        decision = agent.assess_risk(high_risk_feature)
        print(f"Decision: {decision.decision}")
        print(f"Risk Score: {decision.risk_score}")
        print(f"Reason: {decision.reason}")

        assert decision.decision == "hard-checkpoint", f"Expected hard-checkpoint, got {decision.decision}"
        assert decision.risk_score >= 70, f"Expected score >=70, got {decision.risk_score}"
        print("[OK] High risk correctly identified")

        # Test 4: Check checkpoint files created
        print("\n--- Test 4: Checkpoint Files ---")
        checkpoints_dir = project_path / ".autonomous" / "checkpoints"

        assert (checkpoints_dir / "checkpoint-feat-001.json").exists(), "Missing checkpoint-feat-001.json"
        assert (checkpoints_dir / "checkpoint-feat-002.json").exists(), "Missing checkpoint-feat-002.json"
        assert (checkpoints_dir / "checkpoint-feat-003.json").exists(), "Missing checkpoint-feat-003.json"
        assert (checkpoints_dir / "decisions-log.json").exists(), "Missing decisions-log.json"
        print("[OK] All checkpoint files created")

        # Test 5: Verify decisions log
        print("\n--- Test 5: Decisions Log ---")
        log_file = checkpoints_dir / "decisions-log.json"
        log_data = json.loads(log_file.read_text())

        assert len(log_data["decisions"]) == 3, f"Expected 3 decisions, got {len(log_data['decisions'])}"
        assert log_data["stats"]["totalDecisions"] == 3
        assert log_data["stats"]["autoProceed"] == 1
        assert log_data["stats"]["softCheckpoints"] == 1
        assert log_data["stats"]["hardCheckpoints"] == 1
        print("[OK] Decisions log accurate")
        print(f"  Stats: {log_data['stats']}")

        # Test 6: Blackboard updates
        print("\n--- Test 6: Blackboard Updates ---")
        state_file = project_path / ".autonomous" / "state" / "execution-state.json"
        assert state_file.exists(), "Blackboard state file not created!"

        state = json.loads(state_file.read_text())
        assert "checkpointDecision" in state, "checkpointDecision not in blackboard!"
        print("[OK] Blackboard updated correctly")
        print(f"  Last checkpoint: {state['checkpointDecision']['decision']} ({state['checkpointDecision']['riskScore']} pts)")

        print("\n=== All Tests Passed [OK] ===\n")
        return True


def test_risk_factor_calculations():
    """Test individual risk factor calculations."""
    print("\n=== Testing Risk Factor Calculations ===\n")

    with tempfile.TemporaryDirectory() as tmpdir:
        project_path = Path(tmpdir)
        agent = CheckpointAgent(project_path)
        print("[OK] Agent initialized")

        # Test file count scoring
        print("\n--- Test: File Count Scoring ---")
        test_cases = [
            (["file1.ts"], 0, "1-3 files"),
            (["file1.ts", "file2.ts", "file3.ts"], 0, "1-3 files"),
            (["f1.ts", "f2.ts", "f3.ts", "f4.ts"], 10, "4-6 files"),
            (["f1.ts", "f2.ts", "f3.ts", "f4.ts", "f5.ts", "f6.ts"], 10, "4-6 files"),
            (["f1.ts", "f2.ts", "f3.ts", "f4.ts", "f5.ts", "f6.ts", "f7.ts"], 15, "7-10 files"),
            ([f"f{i}.ts" for i in range(12)], 25, "11+ files"),
        ]

        for files, expected_score, desc in test_cases:
            feature = {"files": files}
            score = agent._calculate_file_count_score(feature)
            assert score == expected_score, f"{desc}: Expected {expected_score}, got {score}"
            print(f"[OK] {desc}: {score} pts")

        # Test file type scoring
        print("\n--- Test: File Type Scoring ---")
        type_tests = [
            ({"files": ["src/auth/login.ts"]}, 30, "auth file"),
            ({"files": ["src/payment/checkout.ts"]}, 30, "payment file"),
            ({"files": ["src/migration/001_init.sql"]}, 25, "migration file"),
            ({"files": ["src/api/users.ts"]}, 15, "API file"),
            ({"files": ["src/components/Button.tsx"]}, 5, "component file"),
            ({"files": ["src/tests/user.test.ts"]}, 0, "test file"),
        ]

        for feature, expected_min, desc in type_tests:
            score = agent._calculate_file_type_score(feature)
            assert score >= expected_min, f"{desc}: Expected >={expected_min}, got {score}"
            print(f"[OK] {desc}: {score} pts")

        # Test pattern matching on feature name
        print("\n--- Test: Pattern Matching on Feature Name ---")
        name_tests = [
            ({"name": "Add user authentication", "files": []}, 30, "auth in name"),
            ({"name": "Update payment processing", "files": []}, 30, "payment in name"),
            ({"name": "Create API endpoint", "files": []}, 15, "API in name"),
            ({"name": "Style button component", "files": []}, 5, "component in name"),
        ]

        for feature, expected_min, desc in name_tests:
            score = agent._calculate_file_type_score(feature)
            assert score >= expected_min, f"{desc}: Expected >={expected_min}, got {score}"
            print(f"[OK] {desc}: {score} pts")

        # Test blast radius
        print("\n--- Test: Blast Radius ---")
        blast_tests = [
            ({"dependencies": []}, 0, "no dependencies"),
            ({"dependencies": ["feat-001"]}, 10, "1 dependency"),
            ({"dependencies": ["feat-001", "feat-002", "feat-003"]}, 15, "3 dependencies"),
            ({"dependencies": [f"feat-{i:03d}" for i in range(6)]}, 25, "6 dependencies"),
        ]

        for feature, expected_score, desc in blast_tests:
            score = agent._calculate_blast_radius(feature)
            assert score == expected_score, f"{desc}: Expected {expected_score}, got {score}"
            print(f"[OK] {desc}: {score} pts")

        print("\n=== Risk Factor Tests Passed [OK] ===\n")
        return True


def test_failure_detection():
    """Test recent failure detection."""
    print("\n=== Testing Failure Detection ===\n")

    with tempfile.TemporaryDirectory() as tmpdir:
        project_path = Path(tmpdir)
        logs_dir = project_path / ".autonomous" / "logs"
        logs_dir.mkdir(parents=True, exist_ok=True)

        # Create some fake failure logs
        logs = [
            {"id": "feat-001", "name": "User authentication", "category": "auth", "status": "failed"},
            {"id": "feat-002", "name": "Login form", "category": "auth", "status": "passed"},
            {"id": "feat-003", "name": "Payment processing", "category": "payment", "status": "failed"},
            {"id": "feat-004", "name": "API endpoint", "category": "api", "status": "passed"},
            {"id": "feat-005", "name": "User profile", "category": "auth", "status": "passed"},
        ]

        for log in logs:
            log_file = logs_dir / f"{log['id']}.json"
            log_file.write_text(json.dumps(log))

        agent = CheckpointAgent(project_path)
        print(f"[OK] Created {len(logs)} test logs")

        # Test 1: Similar feature name (should get 20 pts)
        print("\n--- Test 1: Similar Feature Failed ---")
        feature = {"id": "feat-006", "name": "User authentication flow", "category": "other"}
        score = agent._calculate_failure_score(feature)
        assert score == 20, f"Expected 20 pts for similar feature, got {score}"
        print(f"[OK] Similar feature detected: {score} pts")

        # Test 2: Same category failed (should get 15 pts)
        print("\n--- Test 2: Category Failed ---")
        feature = {"id": "feat-007", "name": "Session management", "category": "auth"}
        score = agent._calculate_failure_score(feature)
        assert score >= 15, f"Expected >=15 pts for category failure, got {score}"
        print(f"[OK] Category failure detected: {score} pts")

        # Test 3: Different category, different name (should get 10 pts - recent failure exists)
        print("\n--- Test 3: Recent Failure Exists ---")
        feature = {"id": "feat-008", "name": "Dashboard component", "category": "ui"}
        score = agent._calculate_failure_score(feature)
        assert score == 10, f"Expected 10 pts for recent failure, got {score}"
        print(f"[OK] Recent failure detected: {score} pts")

        print("\n=== Failure Detection Tests Passed [OK] ===\n")
        return True


def test_mark_approved_skipped():
    """Test marking checkpoints as approved/skipped."""
    print("\n=== Testing Approval/Skip Marking ===\n")

    with tempfile.TemporaryDirectory() as tmpdir:
        project_path = Path(tmpdir)
        agent = CheckpointAgent(project_path)

        # Create a checkpoint
        feature = {
            "id": "feat-001",
            "name": "Test feature",
            "category": "test",
            "files": ["test.ts"]
        }

        decision = agent.assess_risk(feature)
        print(f"[OK] Created checkpoint: {decision.decision}")

        # Test marking as approved
        print("\n--- Test: Mark Approved ---")
        agent.mark_approved("feat-001")

        checkpoint_file = project_path / ".autonomous" / "checkpoints" / "checkpoint-feat-001.json"
        checkpoint_data = json.loads(checkpoint_file.read_text())

        assert checkpoint_data["approved"] == True, "Checkpoint not marked as approved"
        assert "approved_at" in checkpoint_data, "No approved_at timestamp"
        print("[OK] Checkpoint marked as approved")

        # Create another checkpoint for skip test
        feature2 = {
            "id": "feat-002",
            "name": "Test feature 2",
            "category": "test",
            "files": ["test2.ts"]
        }
        agent.assess_risk(feature2)

        # Test marking as skipped
        print("\n--- Test: Mark Skipped ---")
        agent.mark_skipped("feat-002")

        checkpoint_file2 = project_path / ".autonomous" / "checkpoints" / "checkpoint-feat-002.json"
        checkpoint_data2 = json.loads(checkpoint_file2.read_text())

        assert checkpoint_data2["skipped"] == True, "Checkpoint not marked as skipped"
        print("[OK] Checkpoint marked as skipped")

        print("\n=== Approval/Skip Tests Passed [OK] ===\n")
        return True


if __name__ == "__main__":
    try:
        # Run all tests
        success1 = test_checkpoint_agent_basic()
        success2 = test_risk_factor_calculations()
        success3 = test_failure_detection()
        success4 = test_mark_approved_skipped()

        if success1 and success2 and success3 and success4:
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

#!/usr/bin/env python
"""
Orchestrator Test Runner

Runs all three phases (validation, generation, implementation)
with streaming output for monitoring.
"""

import subprocess
import sys
import os
import json
from datetime import datetime
from pathlib import Path

# Configuration
PROJECT_PATH = Path(__file__).parent.absolute()
ORCHESTRATOR_PATH = PROJECT_PATH.parent / "autonomous-orchestrator" / "autonomous_agent_demo.py"
SPEC_FILE = ".autonomous/spec.md"
WORKFLOW_ID = f"test-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
MODEL = "claude-sonnet-4"
LOG_FILE = PROJECT_PATH / ".autonomous" / "orchestrator_output.log"

def run_phase(phase: str, extra_args: list = None):
    """Run a single orchestrator phase with streaming output."""
    print(f"\n{'='*60}")
    print(f"PHASE: {phase.upper()}")
    print(f"{'='*60}\n")

    args = [
        sys.executable,
        str(ORCHESTRATOR_PATH),
        "--project-path", str(PROJECT_PATH),
        "--workflow-id", WORKFLOW_ID,
        "--phase", phase,
        "--model", MODEL,
    ]

    if extra_args:
        args.extend(extra_args)

    if phase in ["generation", "implementation"]:
        args.extend(["--spec-file", SPEC_FILE])

    print(f"Command: {' '.join(args)}\n")

    # Run with real-time output streaming
    process = subprocess.Popen(
        args,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        env={**os.environ, "PYTHONUNBUFFERED": "1"}
    )

    output_lines = []
    with open(LOG_FILE, "a", encoding="utf-8") as log:
        log.write(f"\n\n{'='*60}\n")
        log.write(f"PHASE: {phase} - {datetime.now().isoformat()}\n")
        log.write(f"{'='*60}\n\n")

        for line in process.stdout:
            # Print to console
            print(line, end="", flush=True)
            # Write to log
            log.write(line)
            log.flush()
            output_lines.append(line)

            # Try to parse JSON events
            try:
                event = json.loads(line.strip())
                if event.get("type") == "status" and event.get("status") == "error":
                    print(f"\n[ERROR] Phase {phase} failed!")
                    break
            except json.JSONDecodeError:
                pass

    process.wait()
    return process.returncode, output_lines

def main():
    print(f"""
============================================================
           ORCHESTRATOR PIPELINE TEST
============================================================
  Project:  {PROJECT_PATH.name}
  Workflow: {WORKFLOW_ID}
  Model:    {MODEL}
  Spec:     {SPEC_FILE}
============================================================
""")

    # Clear previous log
    LOG_FILE.parent.mkdir(exist_ok=True)
    with open(LOG_FILE, "w", encoding="utf-8") as f:
        f.write(f"Orchestrator Test Log - {datetime.now().isoformat()}\n")
        f.write(f"Workflow ID: {WORKFLOW_ID}\n")

    results = {}

    # Phase 1: Validation
    print("\n[1/3] Starting VALIDATION phase...")
    code, output = run_phase("validation")
    results["validation"] = {"code": code, "lines": len(output)}
    if code != 0:
        print(f"\n[WARN] Validation returned code {code}, continuing anyway...")

    # Phase 2: Generation
    print("\n[2/3] Starting GENERATION phase...")
    code, output = run_phase("generation")
    results["generation"] = {"code": code, "lines": len(output)}
    if code != 0:
        print(f"\n[ERROR] Generation failed with code {code}")
        return 1

    # Phase 3: Implementation
    print("\n[3/3] Starting IMPLEMENTATION phase...")
    code, output = run_phase("implementation", ["--max-iterations", "50"])
    results["implementation"] = {"code": code, "lines": len(output)}

    # Summary
    val_status = "PASS" if results["validation"]["code"] == 0 else "FAIL"
    gen_status = "PASS" if results["generation"]["code"] == 0 else "FAIL"
    imp_status = "PASS" if results["implementation"]["code"] == 0 else "FAIL"

    print(f"""
============================================================
                    TEST COMPLETE
============================================================
  Validation:     {val_status} ({results["validation"]["lines"]} lines)
  Generation:     {gen_status} ({results["generation"]["lines"]} lines)
  Implementation: {imp_status} ({results["implementation"]["lines"]} lines)
============================================================
  Log file: {LOG_FILE}
============================================================
""")

    # Check generated files
    print("\nGenerated files in .autonomous/:")
    for f in (PROJECT_PATH / ".autonomous").iterdir():
        if f.is_file():
            print(f"  - {f.name} ({f.stat().st_size} bytes)")

    # Check src files
    print("\nGenerated files in src/:")
    src_path = PROJECT_PATH / "src"
    if src_path.exists():
        for f in src_path.iterdir():
            if f.is_file():
                print(f"  - {f.name} ({f.stat().st_size} bytes)")

    return 0 if all(r["code"] == 0 for r in results.values()) else 1

if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""
Autonomous Coding Agent - Entry Point

This is the main entry point for the autonomous coding agent.
It can be run directly or spawned by the Electron app.

Usage:
    python autonomous_agent_demo.py --project-path /path/to/project --phase implementation

Environment Variables:
    ANTHROPIC_API_KEY - Required API key for Claude
    PROJECT_PATH - Path to the project (can also be --project-path)
    WORKFLOW_ID - Workflow identifier
    PHASE - validation, generation, or implementation
    SPEC_FILE - Path to specification file
"""

import argparse
import asyncio
import json
import os
import signal
import sys
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from config import load_config, AgentConfig
from agent import AutonomousAgent


def setup_signal_handlers(agent: AutonomousAgent):
    """Set up signal handlers for graceful shutdown."""

    def handle_sigint(signum, frame):
        print(json.dumps({
            "type": "system",
            "data": "Received interrupt signal, stopping...",
            "timestamp": __import__("time").time()
        }), flush=True)
        agent.stop()

    def handle_sigterm(signum, frame):
        print(json.dumps({
            "type": "system",
            "data": "Received termination signal, stopping...",
            "timestamp": __import__("time").time()
        }), flush=True)
        agent.stop()

    # Only set handlers on Unix-like systems
    if sys.platform != "win32":
        signal.signal(signal.SIGINT, handle_sigint)
        signal.signal(signal.SIGTERM, handle_sigterm)
    else:
        # On Windows, use a simpler approach
        signal.signal(signal.SIGINT, handle_sigint)


def parse_args() -> argparse.Namespace:
    """Parse command-line arguments."""
    parser = argparse.ArgumentParser(
        description="Autonomous Coding Agent",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__
    )

    parser.add_argument(
        "--project-path", "-p",
        type=str,
        help="Path to the project directory"
    )

    parser.add_argument(
        "--workflow-id", "-w",
        type=str,
        help="Workflow identifier"
    )

    parser.add_argument(
        "--phase",
        type=str,
        choices=["validation", "generation", "implementation"],
        help="Agent phase to run"
    )

    parser.add_argument(
        "--spec-file", "-s",
        type=str,
        help="Path to specification file"
    )

    parser.add_argument(
        "--model", "-m",
        type=str,
        help="Claude model to use"
    )

    parser.add_argument(
        "--config", "-c",
        type=str,
        help="Path to config file"
    )

    parser.add_argument(
        "--max-iterations",
        type=int,
        help="Maximum iterations for implementation loop"
    )

    parser.add_argument(
        "--timeout",
        type=int,
        help="Timeout in seconds"
    )

    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Enable verbose output"
    )

    parser.add_argument(
        "--supabase-project-id",
        type=str,
        help="Supabase project ID for MCP integration"
    )

    return parser.parse_args()


def emit_startup_message(config: AgentConfig):
    """Emit startup message with configuration."""
    startup = {
        "type": "system",
        "data": f"Autonomous Agent starting",
        "config": {
            "model": config.model,
            "phase": config.phase,
            "project_path": config.project_path,
            "workflow_id": config.workflow_id
        },
        "timestamp": __import__("time").time()
    }
    print(json.dumps(startup), flush=True)


async def main():
    """Main entry point."""
    args = parse_args()

    # Convert args to dict for config
    args_dict = {
        "project_path": args.project_path,
        "workflow_id": args.workflow_id,
        "phase": args.phase,
        "spec_file": args.spec_file,
        "model": args.model,
        "max_iterations": args.max_iterations,
        "timeout_seconds": args.timeout,
        "verbose": args.verbose,
        "supabase_project_id": args.supabase_project_id
    }

    # Remove None values
    args_dict = {k: v for k, v in args_dict.items() if v is not None}

    # Load configuration
    config = load_config(
        config_file=args.config,
        args=args_dict
    )

    # Validate configuration
    errors = config.validate()
    if errors:
        error_msg = {
            "type": "error",
            "data": f"Configuration errors: {', '.join(errors)}",
            "timestamp": __import__("time").time()
        }
        print(json.dumps(error_msg), flush=True)
        sys.exit(1)

    # Emit startup message
    emit_startup_message(config)

    # Create and run agent
    agent = AutonomousAgent(config)
    setup_signal_handlers(agent)

    try:
        await agent.run()
    except KeyboardInterrupt:
        agent.stop()
    except Exception as e:
        error_msg = {
            "type": "error",
            "data": str(e),
            "timestamp": __import__("time").time()
        }
        print(json.dumps(error_msg), flush=True)
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())

"""
Configuration module for Autonomous Coding Agent.

Handles loading configuration from environment variables,
config files, and command-line arguments.
"""

import os
import json
from dataclasses import dataclass, field
from typing import Optional, List, Dict, Any
from pathlib import Path


@dataclass
class MCPServerConfig:
    """Configuration for an MCP server."""
    name: str
    command: str
    args: List[str] = field(default_factory=list)
    env: Dict[str, str] = field(default_factory=dict)


@dataclass
class AgentConfig:
    """Main configuration for the autonomous agent."""

    # Claude API settings
    model: str = "claude-sonnet-4-20250514"
    api_key: Optional[str] = None
    oauth_token: Optional[str] = None  # CLAUDE_CODE_OAUTH_TOKEN support
    max_tokens: int = 16384

    # Project settings
    project_path: str = "."
    workflow_id: Optional[str] = None
    spec_file: Optional[str] = None

    # Phase settings
    phase: str = "implementation"  # validation, generation, implementation

    # MCP servers
    mcp_servers: List[MCPServerConfig] = field(default_factory=list)

    # Behavior settings
    max_iterations: int = 100
    timeout_seconds: int = 3600
    pause_on_error: bool = True

    # Output settings
    output_dir: str = ".autonomous"
    verbose: bool = True

    # Supabase integration
    supabase_project_id: Optional[str] = None

    @classmethod
    def from_env(cls) -> "AgentConfig":
        """Load configuration from environment variables."""
        config = cls()

        # API key from environment (supports both API key and OAuth token)
        config.api_key = os.getenv("ANTHROPIC_API_KEY")
        config.oauth_token = os.getenv("CLAUDE_CODE_OAUTH_TOKEN")

        # Model override
        if model := os.getenv("CLAUDE_MODEL"):
            config.model = model

        # Project settings
        if project_path := os.getenv("PROJECT_PATH"):
            config.project_path = project_path
        if workflow_id := os.getenv("WORKFLOW_ID"):
            config.workflow_id = workflow_id
        if spec_file := os.getenv("SPEC_FILE"):
            config.spec_file = spec_file
        if phase := os.getenv("PHASE"):
            config.phase = phase

        # Supabase
        if supabase_id := os.getenv("SUPABASE_PROJECT_ID"):
            config.supabase_project_id = supabase_id

        # Behavior
        if max_iter := os.getenv("MAX_ITERATIONS"):
            config.max_iterations = int(max_iter)
        if timeout := os.getenv("TIMEOUT_SECONDS"):
            config.timeout_seconds = int(timeout)

        return config

    @classmethod
    def from_file(cls, config_path: str) -> "AgentConfig":
        """Load configuration from a JSON file."""
        with open(config_path, "r") as f:
            data = json.load(f)

        config = cls()

        # Map JSON fields to config
        for key, value in data.items():
            if hasattr(config, key):
                if key == "mcp_servers" and isinstance(value, list):
                    config.mcp_servers = [
                        MCPServerConfig(**server) for server in value
                    ]
                else:
                    setattr(config, key, value)

        return config

    def merge_with_args(self, args: Dict[str, Any]) -> "AgentConfig":
        """Merge command-line arguments into config."""
        for key, value in args.items():
            if value is not None and hasattr(self, key):
                setattr(self, key, value)
        return self

    def get_project_root(self) -> Path:
        """Get the absolute project root path."""
        return Path(self.project_path).resolve()

    def get_output_dir(self) -> Path:
        """Get the output directory path."""
        return self.get_project_root() / self.output_dir

    def get_spec_content(self) -> Optional[str]:
        """Read spec file content if configured."""
        if not self.spec_file:
            return None

        spec_path = Path(self.spec_file)
        if not spec_path.is_absolute():
            spec_path = self.get_project_root() / spec_path

        if spec_path.exists():
            return spec_path.read_text(encoding='utf-8')
        return None

    def validate(self) -> List[str]:
        """Validate configuration and return list of errors."""
        errors = []

        # Support both API key and OAuth token (claude-agent-sdk handles both)
        api_key = self.api_key or os.getenv("ANTHROPIC_API_KEY")
        oauth_token = self.oauth_token or os.getenv("CLAUDE_CODE_OAUTH_TOKEN")
        if not api_key and not oauth_token:
            errors.append(
                "No Claude auth configured. Set either ANTHROPIC_API_KEY or "
                "CLAUDE_CODE_OAUTH_TOKEN (from `claude setup-token`)"
            )

        if not Path(self.project_path).exists():
            errors.append(f"Project path does not exist: {self.project_path}")

        if self.phase not in ["validation", "generation", "implementation"]:
            errors.append(f"Invalid phase: {self.phase}")

        return errors

    def has_auth(self) -> bool:
        """Check if any authentication method is configured."""
        api_key = self.api_key or os.getenv("ANTHROPIC_API_KEY")
        oauth_token = self.oauth_token or os.getenv("CLAUDE_CODE_OAUTH_TOKEN")
        return bool(api_key or oauth_token)


def load_config(
    config_file: Optional[str] = None,
    args: Optional[Dict[str, Any]] = None
) -> AgentConfig:
    """
    Load configuration with precedence:
    1. Command-line arguments (highest)
    2. Environment variables
    3. Config file
    4. Defaults (lowest)
    """
    # Start with defaults + env
    config = AgentConfig.from_env()

    # Override with config file if provided
    if config_file and Path(config_file).exists():
        file_config = AgentConfig.from_file(config_file)
        # Merge file config, keeping env overrides
        for key in vars(file_config):
            file_value = getattr(file_config, key)
            env_value = getattr(config, key)
            # Only use file value if env didn't set it (still default)
            default_config = AgentConfig()
            if getattr(default_config, key) == env_value:
                setattr(config, key, file_value)

    # Override with command-line args
    if args:
        config.merge_with_args(args)

    return config

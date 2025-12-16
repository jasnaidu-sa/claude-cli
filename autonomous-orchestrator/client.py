"""
Claude SDK Client module for Autonomous Coding Agent.

Creates and configures the Claude client with MCP server support.
"""

import os
import sys
from typing import Optional, List, Dict, Any
from pathlib import Path

# Try to import claude_code_sdk
try:
    from claude_code_sdk import Claude, ClaudeOptions, SessionConfig
    from claude_code_sdk.mcp import MCPServerConfig as SDKMCPServerConfig
    CLAUDE_SDK_AVAILABLE = True
except ImportError:
    CLAUDE_SDK_AVAILABLE = False

from config import AgentConfig, MCPServerConfig


def create_claude_client(config: AgentConfig) -> Any:
    """
    Create a Claude client with the given configuration.

    Returns:
        Configured Claude client instance
    """
    if not CLAUDE_SDK_AVAILABLE:
        raise ImportError(
            "claude_code_sdk is not installed. "
            "Please run: pip install claude-code-sdk"
        )

    # Validate API key
    api_key = config.api_key or os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise ValueError("ANTHROPIC_API_KEY is required")

    # Build MCP server configurations
    mcp_servers = []
    for server_config in config.mcp_servers:
        mcp_servers.append(
            SDKMCPServerConfig(
                name=server_config.name,
                command=server_config.command,
                args=server_config.args,
                env=server_config.env
            )
        )

    # Add default MCP servers if not configured
    if not mcp_servers:
        mcp_servers = get_default_mcp_servers(config)

    # Create client options
    options = ClaudeOptions(
        model=config.model,
        max_tokens=config.max_tokens,
        mcp_servers=mcp_servers
    )

    # Create and return client
    client = Claude(api_key=api_key, options=options)
    return client


def get_default_mcp_servers(config: AgentConfig) -> List[Any]:
    """Get default MCP server configurations based on config."""
    if not CLAUDE_SDK_AVAILABLE:
        return []

    servers = []

    # Playwright MCP server for browser testing
    servers.append(
        SDKMCPServerConfig(
            name="playwright",
            command="npx",
            args=["@anthropic-ai/mcp-server-playwright"],
            env={}
        )
    )

    # Supabase MCP server if project ID configured
    if config.supabase_project_id:
        servers.append(
            SDKMCPServerConfig(
                name="supabase",
                command="npx",
                args=["@anthropic-ai/mcp-server-supabase"],
                env={
                    "SUPABASE_PROJECT_ID": config.supabase_project_id
                }
            )
        )

    return servers


def create_session_config(config: AgentConfig) -> Any:
    """Create session configuration for the Claude client."""
    if not CLAUDE_SDK_AVAILABLE:
        raise ImportError("claude_code_sdk is not installed")

    return SessionConfig(
        working_directory=str(config.get_project_root()),
        timeout_seconds=config.timeout_seconds
    )


class ClaudeClientWrapper:
    """
    Wrapper around Claude client for easier usage in the agent.

    Provides a simplified interface for sending messages and
    handling responses.
    """

    def __init__(self, config: AgentConfig):
        self.config = config
        self.client = create_claude_client(config)
        self.session_config = create_session_config(config)
        self.conversation_history: List[Dict[str, Any]] = []

    async def send_message(
        self,
        message: str,
        system_prompt: Optional[str] = None
    ) -> str:
        """
        Send a message to Claude and get a response.

        Args:
            message: The user message to send
            system_prompt: Optional system prompt to use

        Returns:
            Claude's response text
        """
        # Add message to history
        self.conversation_history.append({
            "role": "user",
            "content": message
        })

        # Build request
        request = {
            "messages": self.conversation_history,
            "system": system_prompt
        }

        # Send request
        response = await self.client.chat(
            messages=self.conversation_history,
            system=system_prompt,
            session_config=self.session_config
        )

        # Extract response text
        response_text = response.content[0].text if response.content else ""

        # Add to history
        self.conversation_history.append({
            "role": "assistant",
            "content": response_text
        })

        return response_text

    def clear_history(self):
        """Clear conversation history."""
        self.conversation_history = []

    def get_history(self) -> List[Dict[str, Any]]:
        """Get conversation history."""
        return self.conversation_history.copy()


# Fallback for when SDK is not available
class MockClaudeClient:
    """Mock client for testing without the SDK."""

    def __init__(self, config: AgentConfig):
        self.config = config
        print("[MOCK] Claude client initialized (SDK not available)")

    async def send_message(self, message: str, system_prompt: Optional[str] = None) -> str:
        """Mock send message."""
        print(f"[MOCK] Sending message: {message[:100]}...")
        return "[MOCK RESPONSE] Claude SDK not available. Install with: pip install claude-code-sdk"

    def clear_history(self):
        """Mock clear history."""
        pass

    def get_history(self) -> List[Dict[str, Any]]:
        """Mock get history."""
        return []


def get_client(config: AgentConfig) -> Any:
    """
    Get a Claude client instance.

    Returns ClaudeClientWrapper if SDK is available,
    otherwise returns MockClaudeClient.
    """
    if CLAUDE_SDK_AVAILABLE:
        return ClaudeClientWrapper(config)
    else:
        return MockClaudeClient(config)

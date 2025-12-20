"""
Claude Agent SDK Client module for Autonomous Coding Agent.

Creates and configures the Claude client with streaming support.
Uses the official claude-agent-sdk package with ClaudeSDKClient pattern.
"""

import os
import sys
import json
import time
from typing import Optional, List, Dict, Any, Callable, AsyncIterator
from pathlib import Path
from dataclasses import dataclass, field

# Try to import claude_agent_sdk (the current package name)
try:
    from claude_agent_sdk import (
        ClaudeSDKClient,
        ClaudeAgentOptions,
        AssistantMessage,
        UserMessage,
        ResultMessage,
        SystemMessage,
        TextBlock,
        ToolUseBlock,
        ToolResultBlock
    )
    CLAUDE_SDK_AVAILABLE = True
except ImportError:
    CLAUDE_SDK_AVAILABLE = False

from config import AgentConfig


@dataclass
class StreamEvent:
    """Event emitted during streaming."""
    type: str  # 'text', 'tool_start', 'tool_result', 'progress', 'error', 'complete'
    data: Any
    timestamp: float = field(default_factory=time.time)

    def to_json(self) -> str:
        return json.dumps({
            "type": self.type,
            "data": self.data,
            "timestamp": self.timestamp
        })


class StreamingClaudeClient:
    """
    Streaming client using Claude Agent SDK.

    Uses ClaudeSDKClient with query() + receive_response() pattern
    for real-time streaming of responses.
    """

    def __init__(
        self,
        config: AgentConfig,
        on_event: Optional[Callable[[StreamEvent], None]] = None
    ):
        """
        Initialize streaming client.

        Args:
            config: Agent configuration
            on_event: Optional callback for stream events
        """
        self.config = config
        self.on_event = on_event or self._default_event_handler
        self.conversation_history: List[Dict[str, Any]] = []
        self._validate_setup()

    def _validate_setup(self):
        """Validate SDK is available and auth is configured."""
        if not CLAUDE_SDK_AVAILABLE:
            raise ImportError(
                "claude-agent-sdk is not installed. "
                "Please run: pip install claude-agent-sdk"
            )

        # Support both API key and OAuth token (SDK handles both automatically)
        api_key = self.config.api_key or os.getenv("ANTHROPIC_API_KEY")
        oauth_token = self.config.oauth_token or os.getenv("CLAUDE_CODE_OAUTH_TOKEN")
        if not api_key and not oauth_token:
            raise ValueError(
                "No Claude auth configured. Set either ANTHROPIC_API_KEY or "
                "CLAUDE_CODE_OAUTH_TOKEN (from `claude setup-token`)"
            )

    def _default_event_handler(self, event: StreamEvent):
        """Default event handler - prints to stdout as JSON."""
        print(event.to_json(), flush=True)

    def _emit(self, event_type: str, data: Any):
        """Emit a stream event."""
        event = StreamEvent(type=event_type, data=data)
        self.on_event(event)

    def _build_options(self, system_prompt: Optional[str] = None) -> 'ClaudeAgentOptions':
        """Build ClaudeAgentOptions from config."""
        options_dict = {
            "cwd": str(self.config.get_project_root()),
            "allowed_tools": [
                "Read", "Write", "Edit", "Bash",
                "Glob", "Grep", "LS", "Task"
            ],
            "permission_mode": "acceptEdits",  # Auto-approve file edits
            "max_turns": self.config.max_iterations or 100,
            "include_partial_messages": True,  # Enable incremental streaming
        }

        if system_prompt:
            options_dict["system_prompt"] = system_prompt

        return ClaudeAgentOptions(**options_dict)

    async def send_message(
        self,
        message: str,
        system_prompt: Optional[str] = None
    ) -> str:
        """
        Send a message and stream the response.

        Args:
            message: The user message to send
            system_prompt: Optional system prompt

        Returns:
            Complete response text
        """
        options = self._build_options(system_prompt)

        full_response = ""
        tool_uses = []

        try:
            async with ClaudeSDKClient(options=options) as client:
                # Send the query
                await client.query(message)

                # Stream the response
                async for msg in client.receive_response():
                    msg_type = type(msg).__name__

                    if msg_type == "AssistantMessage":
                        # Process content blocks
                        for block in msg.content:
                            block_type = type(block).__name__

                            if block_type == "TextBlock":
                                # Emit real-time text
                                self._emit("text", block.text)
                                full_response += block.text

                            elif block_type == "ToolUseBlock":
                                # Emit tool usage
                                tool_info = {
                                    "name": block.name,
                                    "id": getattr(block, 'id', None),
                                    "input": getattr(block, 'input', {})
                                }
                                self._emit("tool_start", tool_info)
                                tool_uses.append(tool_info)

                    elif msg_type == "UserMessage":
                        # Tool results
                        for block in msg.content:
                            block_type = type(block).__name__

                            if block_type == "ToolResultBlock":
                                result_info = {
                                    "tool_use_id": getattr(block, 'tool_use_id', None),
                                    "content": getattr(block, 'content', None),
                                    "is_error": getattr(block, 'is_error', False)
                                }
                                self._emit("tool_result", result_info)

                    elif msg_type == "ResultMessage":
                        # Final result with usage stats
                        result_info = {
                            "session_id": getattr(msg, 'session_id', None),
                            "total_cost_usd": getattr(msg, 'total_cost_usd', None),
                            "usage": getattr(msg, 'usage', None)
                        }
                        self._emit("complete", result_info)

                    elif msg_type == "SystemMessage":
                        # System events
                        self._emit("system", str(msg))

        except Exception as e:
            self._emit("error", str(e))
            raise

        # Store in conversation history
        self.conversation_history.append({
            "role": "user",
            "content": message
        })
        self.conversation_history.append({
            "role": "assistant",
            "content": full_response,
            "tool_uses": tool_uses
        })

        return full_response

    async def stream_message(
        self,
        message: str,
        system_prompt: Optional[str] = None
    ) -> AsyncIterator[StreamEvent]:
        """
        Send a message and yield stream events.

        This is an alternative to send_message() that yields events
        instead of using a callback, for more flexible consumption.

        Args:
            message: The user message to send
            system_prompt: Optional system prompt

        Yields:
            StreamEvent objects as they occur
        """
        options = self._build_options(system_prompt)

        full_response = ""
        tool_uses = []

        try:
            async with ClaudeSDKClient(options=options) as client:
                await client.query(message)

                async for msg in client.receive_response():
                    msg_type = type(msg).__name__

                    if msg_type == "AssistantMessage":
                        for block in msg.content:
                            block_type = type(block).__name__

                            if block_type == "TextBlock":
                                full_response += block.text
                                yield StreamEvent(type="text", data=block.text)

                            elif block_type == "ToolUseBlock":
                                tool_info = {
                                    "name": block.name,
                                    "id": getattr(block, 'id', None),
                                    "input": getattr(block, 'input', {})
                                }
                                tool_uses.append(tool_info)
                                yield StreamEvent(type="tool_start", data=tool_info)

                    elif msg_type == "UserMessage":
                        for block in msg.content:
                            block_type = type(block).__name__

                            if block_type == "ToolResultBlock":
                                yield StreamEvent(type="tool_result", data={
                                    "tool_use_id": getattr(block, 'tool_use_id', None),
                                    "content": getattr(block, 'content', None),
                                    "is_error": getattr(block, 'is_error', False)
                                })

                    elif msg_type == "ResultMessage":
                        yield StreamEvent(type="complete", data={
                            "session_id": getattr(msg, 'session_id', None),
                            "total_cost_usd": getattr(msg, 'total_cost_usd', None),
                            "usage": getattr(msg, 'usage', None)
                        })

                    elif msg_type == "SystemMessage":
                        yield StreamEvent(type="system", data=str(msg))

        except Exception as e:
            yield StreamEvent(type="error", data=str(e))
            raise

        # Store in history
        self.conversation_history.append({
            "role": "user",
            "content": message
        })
        self.conversation_history.append({
            "role": "assistant",
            "content": full_response,
            "tool_uses": tool_uses
        })

    def clear_history(self):
        """Clear conversation history."""
        self.conversation_history = []

    def get_history(self) -> List[Dict[str, Any]]:
        """Get conversation history."""
        return self.conversation_history.copy()


# Legacy wrapper for backwards compatibility
class ClaudeClientWrapper:
    """
    Legacy wrapper - delegates to StreamingClaudeClient.

    Maintained for backwards compatibility with existing code.
    """

    def __init__(self, config: AgentConfig):
        self._streaming_client = StreamingClaudeClient(config)

    async def send_message(
        self,
        message: str,
        system_prompt: Optional[str] = None
    ) -> str:
        """Send a message and get response (blocking style)."""
        return await self._streaming_client.send_message(message, system_prompt)

    def clear_history(self):
        """Clear conversation history."""
        self._streaming_client.clear_history()

    def get_history(self) -> List[Dict[str, Any]]:
        """Get conversation history."""
        return self._streaming_client.get_history()


# Mock client for testing without SDK
class MockClaudeClient:
    """Mock client for testing without the SDK."""

    def __init__(self, config: AgentConfig):
        self.config = config
        self.conversation_history: List[Dict[str, Any]] = []
        print("[MOCK] Claude client initialized (SDK not available)")

    async def send_message(
        self,
        message: str,
        system_prompt: Optional[str] = None
    ) -> str:
        """Mock send message."""
        print(f"[MOCK] Sending message: {message[:100]}...")
        response = "[MOCK RESPONSE] Claude Agent SDK not available. Install with: pip install claude-agent-sdk"

        self.conversation_history.append({"role": "user", "content": message})
        self.conversation_history.append({"role": "assistant", "content": response})

        return response

    async def stream_message(self, message: str, system_prompt: Optional[str] = None):
        """Mock stream message."""
        yield StreamEvent(type="text", data="[MOCK] SDK not available")
        yield StreamEvent(type="complete", data={"session_id": "mock"})

    def clear_history(self):
        """Mock clear history."""
        self.conversation_history = []

    def get_history(self) -> List[Dict[str, Any]]:
        """Mock get history."""
        return self.conversation_history.copy()


def get_client(config: AgentConfig, on_event: Optional[Callable[[StreamEvent], None]] = None) -> Any:
    """
    Get a Claude client instance.

    Returns StreamingClaudeClient if SDK is available,
    otherwise returns MockClaudeClient.

    Args:
        config: Agent configuration
        on_event: Optional callback for stream events
    """
    if CLAUDE_SDK_AVAILABLE:
        return StreamingClaudeClient(config, on_event)
    else:
        return MockClaudeClient(config)


def get_streaming_client(
    config: AgentConfig,
    on_event: Optional[Callable[[StreamEvent], None]] = None
) -> StreamingClaudeClient:
    """
    Get a streaming Claude client.

    Args:
        config: Agent configuration
        on_event: Callback for stream events

    Returns:
        StreamingClaudeClient instance

    Raises:
        ImportError: If SDK is not available
    """
    if not CLAUDE_SDK_AVAILABLE:
        raise ImportError(
            "claude-agent-sdk is not installed. "
            "Please run: pip install claude-agent-sdk"
        )
    return StreamingClaudeClient(config, on_event)

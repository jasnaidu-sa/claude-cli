"""
Discovery Agent - REAL-TIME streaming using Anthropic SDK directly.

This provides TRUE word-by-word streaming, not snapshots.
Uses client.messages.stream() for incremental text chunks.
"""

import json
import sys
import os
import asyncio
from pathlib import Path
from typing import Optional, Dict, Any, List
from dataclasses import dataclass
from anthropic import AsyncAnthropic


@dataclass
class DiscoverySession:
    """Discovery conversation session state."""
    session_id: str
    project_path: Path
    is_new_project: bool
    messages: List[Dict[str, Any]]
    created_at: float

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.session_id,
            "projectPath": str(self.project_path),
            "isNewProject": self.is_new_project,
            "messages": self.messages,
            "createdAt": self.created_at
        }


class DiscoveryAgentStreaming:
    """
    Discovery conversation agent using Anthropic SDK for TRUE real-time streaming.

    This agent provides word-by-word streaming using client.messages.stream(),
    giving the exact experience of Claude Code CLI in interactive mode.
    """

    def __init__(
        self,
        project_path: str,
        session_id: str,
        is_new_project: bool = False,
        api_key: Optional[str] = None
    ):
        """
        Initialize Discovery Agent with Anthropic SDK.

        Args:
            project_path: Path to the project being analyzed
            session_id: Unique session identifier
            is_new_project: Whether this is a new project (no existing code)
            api_key: Anthropic API key (optional, will use env var if not provided)
        """
        self.project_path = Path(project_path)
        self.session_id = session_id
        self.is_new_project = is_new_project

        # Initialize Anthropic client
        # If no API key provided, try to get from Claude Code auth
        if not api_key:
            api_key = os.getenv("ANTHROPIC_API_KEY")

        self.client = AsyncAnthropic(api_key=api_key)

        # Load existing session or create new
        self.session = self._load_or_create_session()

    def _build_system_prompt(self) -> str:
        """Build system prompt for Discovery phase."""
        base_prompt = """You are a helpful assistant guiding a developer through the Discovery phase of an autonomous coding system.

Your role is to:
1. Understand the developer's goals and requirements through natural conversation
2. Ask clarifying questions to uncover technical details, constraints, and edge cases
3. Build a comprehensive understanding of what needs to be built
4. Help scope the work appropriately

Guidelines:
- Be conversational and friendly, not robotic
- Ask 1-2 focused questions at a time (don't overwhelm)
- Dig deeper into technical specifics when needed
- Confirm your understanding by summarizing back
- After 3-5 exchanges, you'll have enough context to generate a specification

Keep responses concise and focused. This is an iterative conversation, not a one-shot Q&A."""

        if self.is_new_project:
            base_prompt += "\n\nNote: This is a NEW project (no existing codebase). Focus on requirements and architecture."
        else:
            base_prompt += "\n\nNote: This is an EXISTING project. Consider existing patterns and constraints."

        return base_prompt

    def _load_or_create_session(self) -> DiscoverySession:
        """Load existing session from disk or create new one."""
        session_file = self.project_path / ".autonomous" / "session.json"

        if session_file.exists():
            try:
                with open(session_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    return DiscoverySession(
                        session_id=data["id"],
                        project_path=self.project_path,
                        is_new_project=data.get("isNewProject", False),
                        messages=data.get("messages", []),
                        created_at=data.get("createdAt", 0)
                    )
            except Exception as e:
                print(json.dumps({
                    "type": "error",
                    "error": f"Error loading session: {e}"
                }), file=sys.stderr, flush=True)

        # Create new session
        import time
        return DiscoverySession(
            session_id=self.session_id,
            project_path=self.project_path,
            is_new_project=self.is_new_project,
            messages=[],
            created_at=time.time()
        )

    def _save_session(self) -> None:
        """Save session to disk."""
        session_dir = self.project_path / ".autonomous"
        session_dir.mkdir(parents=True, exist_ok=True)

        session_file = session_dir / "session.json"
        with open(session_file, "w", encoding="utf-8") as f:
            json.dump(self.session.to_dict(), f, indent=2)

    def _emit_event(self, event_type: str, data: Dict[str, Any]) -> None:
        """
        Emit a streaming event to stdout for Electron to consume.

        Format: newline-delimited JSON
        """
        event_data = {
            "type": event_type,
            "sessionId": self.session_id,
            **data
        }
        print(json.dumps(event_data), flush=True)

    async def send_message(self, content: str) -> str:
        """
        Send a message and get REAL-TIME streaming response.

        This uses client.messages.stream() for true word-by-word streaming.
        Each text delta arrives as it's generated, giving live feedback.

        Args:
            content: User message content

        Returns:
            Complete response text (accumulated from stream)
        """
        # Add user message to session
        self.session.messages.append({
            "role": "user",
            "content": content
        })

        # Send start event
        self._emit_event("stream_start", {
            "messageId": f"msg-{len(self.session.messages)}"
        })

        response_text = ""

        try:
            # Build message list for API (exclude system prompt from messages)
            api_messages = [
                {"role": msg["role"], "content": msg["content"]}
                for msg in self.session.messages
            ]

            # Use Anthropic SDK streaming - THIS IS THE KEY!
            # client.messages.stream() gives TRUE incremental streaming
            async with self.client.messages.stream(
                model="claude-sonnet-4-5-20250929",
                max_tokens=4096,
                system=self._build_system_prompt(),
                messages=api_messages
            ) as stream:
                # Stream text deltas in REAL-TIME
                async for text in stream.text_stream:
                    # THIS IS IT - Real-time word-by-word streaming!
                    response_text += text

                    # Emit each chunk immediately
                    self._emit_event("text_delta", {
                        "delta": text,
                        "accumulated": response_text
                    })

            # Add assistant response to session
            self.session.messages.append({
                "role": "assistant",
                "content": response_text
            })

            # Save session to disk
            self._save_session()

            # Send completion event
            self._emit_event("stream_complete", {
                "messageCount": len(self.session.messages),
                "responseLength": len(response_text)
            })

            return response_text

        except Exception as e:
            # Send error event
            self._emit_event("stream_error", {
                "error": str(e)
            })
            raise

    def get_messages(self) -> List[Dict[str, Any]]:
        """Get all messages in the session."""
        return self.session.messages

    def get_session_info(self) -> Dict[str, Any]:
        """Get session metadata."""
        return self.session.to_dict()


# CLI Interface for Electron to spawn
async def main():
    import argparse

    parser = argparse.ArgumentParser(description="Discovery Agent with REAL-TIME Anthropic SDK streaming")
    parser.add_argument("--project-path", required=True, help="Path to project")
    parser.add_argument("--session-id", required=True, help="Session ID")
    parser.add_argument("--new-project", action="store_true", help="New project flag")
    parser.add_argument("--message", help="Message to send (if provided, sends and exits)")
    parser.add_argument("--api-key", help="Anthropic API key (optional, uses env var if not provided)")

    args = parser.parse_args()

    # Create agent
    agent = DiscoveryAgentStreaming(
        project_path=args.project_path,
        session_id=args.session_id,
        is_new_project=args.new_project,
        api_key=args.api_key
    )

    # If message provided, send it
    if args.message:
        await agent.send_message(args.message)
    else:
        # Interactive mode - read from stdin
        print(json.dumps({
            "type": "ready",
            "sessionId": args.session_id
        }), flush=True)

        # Read newline-delimited JSON from stdin
        for line in sys.stdin:
            try:
                data = json.loads(line.strip())
                if data.get("type") == "message":
                    await agent.send_message(data["content"])
            except json.JSONDecodeError as e:
                print(json.dumps({
                    "type": "error",
                    "error": f"JSON decode error: {e}"
                }), file=sys.stderr, flush=True)
            except Exception as e:
                print(json.dumps({
                    "type": "error",
                    "error": str(e)
                }), file=sys.stderr, flush=True)


if __name__ == "__main__":
    asyncio.run(main())

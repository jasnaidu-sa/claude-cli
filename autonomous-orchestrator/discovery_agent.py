"""
Discovery Agent - Real-time streaming conversation agent using Claude Agent SDK.

Replaces the Claude CLI subprocess approach with native Agent SDK streaming.
This provides:
- Real-time incremental text streaming
- Proper tool usage visibility
- No lag between chunks
- Exactly the experience Auto-Claude has
"""

import json
import sys
import os
from pathlib import Path
from typing import Optional, Dict, Any, List
from dataclasses import dataclass
from claude_agent_sdk import query, ClaudeAgentOptions, AssistantMessage, ResultMessage, UserMessage


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


class DiscoveryAgent:
    """
    Discovery conversation agent using Claude Agent SDK for real-time streaming.

    This agent handles the Discovery phase conversation with true incremental streaming,
    replacing the Claude CLI subprocess approach that only sent snapshots.
    """

    def __init__(
        self,
        project_path: str,
        session_id: str,
        is_new_project: bool = False
    ):
        """
        Initialize Discovery Agent.

        Args:
            project_path: Path to the project being analyzed
            session_id: Unique session identifier
            is_new_project: Whether this is a new project (no existing code)
        """
        self.project_path = Path(project_path)
        self.session_id = session_id
        self.is_new_project = is_new_project

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
                print(f"[DiscoveryAgent] Error loading session: {e}", file=sys.stderr)

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

    def _emit_stream_event(self, event_type: str, data: Dict[str, Any]) -> None:
        """
        Emit a streaming event to stdout for Electron to consume.

        This outputs newline-delimited JSON that the TypeScript service can parse.
        """
        event_data = {
            "type": "stream_event",
            "sessionId": self.session_id,
            "event": {
                "eventType": event_type,
                **data
            }
        }
        print(json.dumps(event_data), flush=True)

    async def send_message(self, content: str) -> str:
        """
        Send a message and get streaming response using Agent SDK query().

        This method streams messages in real-time as Claude thinks and responds.
        Each chunk arrives immediately, giving the user live feedback.

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

        # Send system event to indicate start
        self._emit_stream_event("system", {"chunk": "🤖 Agent SDK starting...\n"})

        # Build full prompt including conversation history
        # Note: query() is stateless, so we need to build context manually
        conversation_context = "\n\n".join([
            f"{msg['role'].upper()}: {msg['content']}"
            for msg in self.session.messages[:-1]  # Exclude current message
        ])

        full_prompt = f"{conversation_context}\n\nUSER: {content}" if conversation_context else content

        response_text = ""

        try:
            # Use query() with async for to stream messages
            # This gives us REAL-TIME streaming, not snapshots!
            async for message in query(
                prompt=full_prompt,
                options=ClaudeAgentOptions(
                    model="claude-sonnet-4-5-20250929",
                    system_prompt=self._build_system_prompt(),
                    allowed_tools=[],  # Discovery doesn't need tools
                    permission_mode="bypassPermissions",  # No prompts needed
                    max_turns=1,  # Single response
                    cwd=str(self.project_path)
                )
            ):
                # Handle different message types
                if isinstance(message, AssistantMessage):
                    # Assistant message contains text blocks or tool calls
                    for block in message.content:
                        if hasattr(block, "text"):
                            # TEXT CHUNK - This is the real-time streaming!
                            chunk = block.text
                            response_text += chunk
                            self._emit_stream_event("text", {"chunk": chunk})

                        elif hasattr(block, "name"):
                            # Tool being called (shouldn't happen with no tools)
                            self._emit_stream_event("tool_use", {
                                "toolName": block.name,
                                "toolArgs": block.input if hasattr(block, "input") else {}
                            })

                elif isinstance(message, ResultMessage):
                    # Final result message
                    self._emit_stream_event("result", {"subtype": message.subtype})

            # Add assistant response to session
            self.session.messages.append({
                "role": "assistant",
                "content": response_text
            })

            # Save session to disk
            self._save_session()

            # Send completion event
            print(json.dumps({
                "type": "stream_complete",
                "sessionId": self.session_id,
                "messageCount": len(self.session.messages)
            }), flush=True)

            return response_text

        except Exception as e:
            # Send error event
            print(json.dumps({
                "type": "stream_error",
                "sessionId": self.session_id,
                "error": str(e)
            }), flush=True)
            raise

    def get_messages(self) -> List[Dict[str, Any]]:
        """Get all messages in the session."""
        return self.session.messages

    def get_session_info(self) -> Dict[str, Any]:
        """Get session metadata."""
        return self.session.to_dict()


# CLI Interface for Electron to spawn
if __name__ == "__main__":
    import asyncio
    import argparse

    parser = argparse.ArgumentParser(description="Discovery Agent with real-time streaming")
    parser.add_argument("--project-path", required=True, help="Path to project")
    parser.add_argument("--session-id", required=True, help="Session ID")
    parser.add_argument("--new-project", action="store_true", help="New project flag")
    parser.add_argument("--message", help="Message to send (if provided, sends and exits)")

    args = parser.parse_args()

    # Create agent
    agent = DiscoveryAgent(
        project_path=args.project_path,
        session_id=args.session_id,
        is_new_project=args.new_project
    )

    # If message provided, send it
    if args.message:
        async def send():
            await agent.send_message(args.message)

        asyncio.run(send())
    else:
        # Interactive mode - read from stdin
        print(json.dumps({
            "type": "ready",
            "sessionId": args.session_id
        }), flush=True)

        async def handle_stdin():
            """Read messages from stdin and respond."""
            import sys
            for line in sys.stdin:
                try:
                    data = json.loads(line.strip())
                    if data.get("type") == "message":
                        await agent.send_message(data["content"])
                except Exception as e:
                    print(json.dumps({
                        "type": "error",
                        "error": str(e)
                    }), file=sys.stderr, flush=True)

        asyncio.run(handle_stdin())

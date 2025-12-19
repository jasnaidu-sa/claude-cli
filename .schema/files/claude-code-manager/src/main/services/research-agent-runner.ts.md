# research-agent-runner.ts

## Purpose
Manages background research agents that analyze codebases and user requirements during the autonomous coding workflow. Spawns Claude CLI processes to run specialized analysis agents.

## Agent Types
- `user-journey`: Analyzes existing codebase for brownfield projects (tech stack, patterns, user flows)
- `process`: Extracts requirements and constraints from user descriptions
- `codebase`: Analyzes existing codebase patterns and conventions
- `spec-builder`: Builds detailed specifications from conversation context

## Key Features
- Spawns Claude CLI with `--print` mode for non-interactive output
- Uses `--strict-mcp-config` to avoid MCP tool conflicts
- Creates minimal MCP config file for user-journey agent (Windows shell compatibility)
- Secure environment with minimal allowed variables
- Event-based completion notifications

## Interactions
- **Claude CLI**: Spawns as child process with stdin/stdout pipes
- **Config Store**: Reads Claude CLI path
- **File System**: Creates/reads MCP config files in project directory
- **Event Emitter**: Emits 'status' and 'complete' events

## Data Flow
1. Receives agent run request with type, session ID, project path
2. Validates project path and creates safe environment
3. Creates appropriate MCP config (minimal for user-journey, full for others)
4. Spawns Claude CLI with prompt via stdin
5. Collects stdout output and emits completion event

## Security
- Path traversal prevention
- Shell metacharacter validation
- Credential sanitization in output
- Minimal environment variables passed to subprocess

## Change History
- 2024-12-19: Fixed Windows shell escaping for MCP config JSON (creates file instead of inline)
- 2024-12-19: Added user-journey agent type for brownfield analysis
- 2024-12-18: Initial implementation with process, codebase, spec-builder agents

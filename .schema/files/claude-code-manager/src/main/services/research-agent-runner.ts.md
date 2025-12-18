# research-agent-runner.ts

## Purpose
Service for running research agents that analyze codebases. Used in journey_analysis phase to understand existing project patterns before discovery chat.

## Interactions

### Claude CLI
- Spawns Claude CLI with research prompts
- Uses streaming output for progress updates

### Analysis Types
- User journey analysis
- Entry point detection
- Data model extraction
- Pattern recognition

## Data Flow
1. Receives project path and analysis type
2. Spawns research agent with appropriate prompt
3. Parses analysis results
4. Returns JourneyAnalysis object

## Change History
- 2025-12-18: Part of Option C architecture implementation

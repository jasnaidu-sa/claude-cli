# journey-handlers.ts

## Purpose
IPC handlers for the Journey Analysis phase (Phase 1) of the autonomous coding workflow. Manages automatic codebase analysis for existing (brownfield) projects before the discovery chat begins.

## IPC Channels
- `journey:start-analysis`: Start journey analysis for a project path
- `journey:cancel`: Cancel running analysis
- `journey:get-status`: Get current analysis status
- `journey:complete` (event): Emitted when analysis completes
- `journey:status` (event): Emitted for status updates

## Key Features
- Runs user-journey research agent via ResearchAgentRunner
- Parses JSON output from agent into JourneyAnalysis structure
- Tracks active analysis tasks per project path
- Forwards status updates to renderer

## Interactions
- **ResearchAgentRunner**: Spawns and monitors user-journey agent
- **Main Window**: Sends completion/status events via webContents
- **Renderer**: Receives events in JourneyAnalysis component

## Data Flow
1. Renderer calls start-analysis with project path
2. Handler creates session ID and runs user-journey agent
3. Listens for agent completion events
4. Parses JSON output into JourneyAnalysis structure
5. Sends journey:complete event to renderer

## Output Structure
```typescript
{
  userFlows: string[],     // Main user flows/features
  entryPoints: string[],   // Entry point files
  dataModels: string[],    // Main data models
  techStack: string[],     // Technologies used
  patterns: string[],      // Code patterns
  summary: string          // Brief project summary
}
```

## Change History
- 2024-12-19: Initial implementation for brownfield project analysis

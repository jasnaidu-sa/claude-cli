# JourneyAnalysis.tsx

## Purpose
Phase 1 component for automatic user journey analysis on brownfield projects. Analyzes existing codebase to understand patterns, entry points, data models, and user flows before discovery chat.

## Interactions

### Store Integration
- Uses `useAutonomousStore` for:
  - `selectedProject` - Current project being analyzed
  - `journeyAnalysis` - Analysis results
  - `setJourneyAnalysis` - Update analysis results
  - `goToNextPhase` - Navigate to next phase
  - `updateAgentStatus` - Track agent progress

## Data Flow
1. Component mounts and triggers runAnalysis()
2. Simulates analysis (will connect to research agent)
3. Produces JourneyAnalysis object with findings
4. Auto-advances to discovery_chat after 1.5 seconds

## JourneyAnalysis Interface
```typescript
interface JourneyAnalysis {
  completed: boolean
  userFlows: string[]      // Discovered user flows
  entryPoints: string[]    // Main entry points
  dataModels: string[]     // Data models found
  techStack: string[]      // Technologies detected
  patterns: string[]       // Architectural patterns
  summary: string          // Human-readable summary
}
```

## UI Elements
- Analysis progress indicators (4 areas: Users, Entry Points, Data Models, Patterns)
- Completion summary card with stats
- Continue button

## Phase Skipping
This phase is automatically skipped for greenfield (new) projects since there's no existing code to analyze.

## Change History
- 2025-12-18: Created as part of Option C architecture

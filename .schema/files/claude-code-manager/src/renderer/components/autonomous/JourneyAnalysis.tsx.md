# JourneyAnalysis.tsx

## Purpose
React component for Phase 1 of the autonomous coding workflow. Displays automatic codebase analysis progress and results for existing (brownfield) projects.

## Key Features
- Auto-starts analysis when component mounts
- Shows loading state with analysis categories
- Displays parsed analysis results (tech stack, patterns, flows)
- Skip and retry functionality
- Auto-advances to next phase on completion

## State
- `analyzing`: Whether analysis is in progress
- `error`: Error message if analysis failed
- `statusText`: Current status from agent

## IPC Events
- Calls `window.electron.journey.startAnalysis(projectPath)`
- Listens for `journey:complete` and `journey:status` events
- Can call `cancelAnalysis` to abort

## Store Integration
- Uses `useAutonomousStore` for:
  - `selectedProject`: Current project being analyzed
  - `journeyAnalysis`: Analysis results
  - `setJourneyAnalysis`: Update results
  - `goToNextPhase`: Advance workflow
  - `updateAgentStatus`: Track agent status

## UI States
1. Loading: Shows spinner with analysis categories
2. Error: Shows error with retry/skip options
3. Complete: Shows analysis summary with continue button

## Change History
- 2024-12-19: Enhanced UI with tech stack display and status updates
- 2024-12-18: Initial implementation

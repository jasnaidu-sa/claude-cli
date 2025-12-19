# AutonomousView.tsx

## Purpose
Main view component for autonomous coding mode with phase-based routing. Orchestrates the 8-phase autonomous workflow and provides the container layout with navigation controls.

## Interactions

### Child Components (Phase-Based)
- `ProjectPicker` - project_select phase
- `PreflightCheck` - preflight phase
- `JourneyAnalysis` - journey_analysis phase
- `DiscoveryChat` - discovery_chat phase
- `SpecGenerating` - spec_generating phase
- `SpecReview` - spec_review phase
- `ExecutionDashboard` - executing phase
- `CompletionSummary` - completed phase

### Store Integration
- Uses `useAutonomousStore` for phase state and navigation
- Uses `useSessionStore` for session data

### Props
- `onClose?: () => void` - Callback when view is closed

## Data Flow
1. Reads currentPhase from store
2. Renders appropriate phase component via renderPhaseContent()
3. Shows phase progress indicator and navigation controls
4. Handles phase navigation via store actions

## UI Elements
- Header with phase title, step indicator, project indicator
- Progress bar showing completion percentage
- Back button (when canGoBack)
- Reset button (when not on first phase)
- Close button

## Theme Integration
- Progress bar uses `primary` color
- "(New)" badge uses `primary` instead of amber-500

## Change History
- 2025-12-19: Updated colors to use theme variables (primary instead of amber-500)
- 2025-12-18: Added new phases (preflight, journey_analysis, spec_generating)
- 2025-12-18: Updated PHASE_INFO with all 8 phases
- 2025-12-18: Added imports for new phase components

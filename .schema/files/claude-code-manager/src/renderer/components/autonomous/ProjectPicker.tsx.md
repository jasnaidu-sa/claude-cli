# ProjectPicker.tsx

## Purpose
Phase 0a component for selecting or creating a project. First step in the autonomous workflow where users choose an existing project (brownfield) or create a new one (greenfield).

## Interactions

### Store Integration
- Uses `useAutonomousStore` for:
  - `setSelectedProject` - Set chosen project
  - `goToNextPhase` - Navigate to preflight check

### IPC
- Calls file system APIs for project listing
- Uses dialog APIs for folder selection

## Data Flow
1. Lists available projects or shows create new option
2. User selects project or creates new
3. Sets selectedProject with isNew flag
4. Advances to preflight phase

## UI Elements
- Project list with recent projects
- Create new project button
- Folder picker dialog
- Project name input (for new projects)

## Project Object
```typescript
interface SelectedProject {
  name: string
  path: string
  isNew: boolean  // true = greenfield, false = brownfield
}
```

## Phase Routing Impact
- If isNew=true, journey_analysis phase is skipped
- If isNew=false, journey_analysis runs to analyze existing code

## Change History
- 2025-12-18: Part of Option C architecture implementation

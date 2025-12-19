# ExecutionDashboard.tsx

## Purpose
Main dashboard for workflow execution. Shows phase stepper, progress overview, and manages the transition between execution states.

## Key Features
- Phase stepper with visual progress
- Auto-workflow creation from spec
- Real-time progress tracking
- Phase transition animations

## Props
- `workflow?: Workflow` - Current workflow (optional, can auto-create)
- `specPath?: string` - Path to spec for auto-creation

## State Management
- Uses `useAutonomousStore` for global state
- Subscribes to workflow progress updates

## Theme Integration
- Phase stepper uses `primary` color for active/completed phases
- Loading spinner uses `primary` color
- Progress indicators use theme colors

## Change History
- 2025-12-19: Updated colors to use theme variables (primary instead of amber-500)

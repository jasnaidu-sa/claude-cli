# ExecutionDashboard.tsx

## Purpose
Main dashboard for workflow execution. Shows phase stepper, progress overview, and manages the transition between execution states.

## Key Features
- Phase stepper with visual progress
- Auto-workflow creation from spec
- Real-time progress tracking
- Phase transition animations
- **Read-only mode** for viewing completed/paused workflows from history
- Kanban view integration for historical workflow viewing

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

## Read-Only Mode

### Detection
Read-only mode is active when:
- Workflow status is `completed`
- Workflow status is `paused` AND no active session exists
- Workflow status is `error` AND no active session exists

### UI Changes in Read-Only Mode
- **Status indicator**: Shows "📋 View Mode", "⏸️ Paused Workflow", or "❌ Failed Workflow"
- **No control buttons**: Start/Pause/Stop buttons hidden
- **Back button**: Replaces control buttons, returns to project selection
- **Completion timestamp**: Shows when workflow completed
- **ProgressPanel**: Automatically defaults to Kanban view
- **Bottom panel**: Output viewer collapsed by default

### Use Cases
1. **Viewing completed work**: See all features that were built
2. **Reviewing paused workflows**: Understand where execution stopped
3. **Analyzing failures**: View error state and progress before failure
4. **Historical reference**: Browse past implementations for learning/reference

## Change History
- 2025-12-21: Added read-only mode for viewing historical workflows from History modal. Detects completed/paused/error workflows and hides control buttons, shows completion info.
- 2025-12-19: Updated colors to use theme variables (primary instead of amber-500)

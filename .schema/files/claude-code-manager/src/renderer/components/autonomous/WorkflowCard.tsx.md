# WorkflowCard.tsx

## Purpose
Card component displaying a single workflow in the workflow list. Shows status, progress, and provides quick actions.

## Key Features
- Workflow status badge
- Progress bar (if running)
- Quick actions (view, delete, resume)
- Last updated timestamp

## Props
- `workflow: Workflow` - Workflow data
- `onClick: () => void` - Click handler
- `onDelete: () => void` - Delete handler

## Theme Integration
- Status indicators use semantic colors (emerald for success, yellow for pending)
- Progress bar uses `primary` color
- Card uses theme card background

## Change History
- 2025-12-19: Updated progress bar and status colors to use theme variables

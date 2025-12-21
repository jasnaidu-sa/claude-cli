# WorkflowHistory.tsx

## Purpose
Full-screen modal displaying all historical workflows across all projects. Allows users to view past work, resume paused workflows, and manage their autonomous coding history.

## Key Features
- **Global workflow list** across all projects
- **Advanced filtering** by project, status, and search query
- **Sorting options**: recent activity, created date, project name, status
- **Pagination**: 20 workflows per page
- **Archive functionality**: Hide/show archived workflows
- **Status-based actions**: View, Resume, Retry, Archive
- **Search**: Filter by workflow name or project name

## Props

### WorkflowHistoryProps
- `onClose: () => void` - Close modal handler
- `onSelectWorkflow: (workflow: WorkflowConfig, viewMode: 'view' | 'resume') => void` - Workflow selection handler

## Filter Options

### Status Filter
- **All**: Shows all workflows (default)
- **Completed**: Shows only completed workflows
- **In Progress**: Shows implementing/generating workflows
- **Paused**: Shows paused workflows
- **Error**: Shows failed workflows

### Sort Options
- **Recent Activity** (default): Sorts by last activity (completedAt → updatedAt → createdAt)
- **Created Date**: Sorts by createdAt descending
- **Project Name**: Alphabetical by project
- **Status**: Groups by status (in-progress → paused → error → completed)

## User Interactions

### View Results (Completed Workflows)
1. User clicks `[View Results]`
2. Calls `onSelectWorkflow(workflow, 'view')`
3. Navigation handled by parent (ProjectPicker)
4. Opens ExecutionDashboard in read-only mode with Kanban view

### Resume (Paused/Error Workflows)
1. User clicks `[Resume]` or `[Retry]`
2. Calls `onSelectWorkflow(workflow, 'resume')`
3. Navigation handled by parent
4. Opens ExecutionDashboard with ability to continue execution

### Archive
1. User clicks Archive button (trash icon)
2. Adds workflow ID to local archived set
3. Workflow hidden from list unless "Show Archived" toggled
4. **Note**: Archive state is component-local (not persisted)

## Pagination
- Shows 20 workflows per page
- Previous/Next navigation buttons
- Displays "Page X of Y"
- Automatically resets to page 1 when filters change

## Empty States
- No workflows: "Start your first autonomous coding workflow to see it here"
- No matches: "Try adjusting your search or filters"

## Integration with Store
- Reads from `useAutonomousStore().workflows`
- No direct mutations - all actions delegated to parent via callbacks

## Layout
- **Modal overlay**: 50% black background
- **Modal size**: max-w-5xl, 85vh height
- **Header**: Title + close button
- **Filters**: Search, status dropdown, sort dropdown, archived toggle
- **Content**: Scrollable list of WorkflowHistoryCard components
- **Pagination**: Fixed at bottom

## Theme Integration
- Uses card background for modal
- Status badges with color-coded backgrounds
- Hover states on cards
- Consistent with Kanban board styling

## Change History
- 2025-12-21: Created workflow history modal with filtering, sorting, pagination, and archive functionality

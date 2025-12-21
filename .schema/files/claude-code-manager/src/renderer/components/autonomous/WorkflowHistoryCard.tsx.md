# WorkflowHistoryCard.tsx

## Purpose
Individual workflow card component displayed in the WorkflowHistory modal. Shows workflow status, progress summary, and context-aware action buttons.

## Props

### WorkflowHistoryCardProps
- `workflow: WorkflowConfig` - Workflow data to display
- `onViewResults: (workflow: WorkflowConfig) => void` - View results handler
- `onResume: (workflow: WorkflowConfig) => void` - Resume handler
- `onArchive: (workflow: WorkflowConfig) => void` - Archive handler

## Card Layout

### Header Section (Top to Bottom)
1. **Project name** (prominent):
   - Folder icon (primary color)
   - Medium font weight, primary color
   - Extracted from projectPath.split(/[/\\]/).pop()
2. **Workflow name**:
   - Bold, large text, truncated with hover tooltip
   - Spec-based title (e.g., "Counter Component")
3. **Description** (if present):
   - Muted text, 2-line clamp
   - Spec overview section (max 200 chars)
4. **Timestamp**: Context-aware based on status
   - Completed: "Completed 2h ago"
   - Paused: "Last active 3 days ago"
   - Error: "Failed 1 week ago"
   - In Progress: "Started 30m ago"
5. **Status badge**: Color-coded pill (green/amber/red/blue)

### Progress Section
- **Test progress**: "X/Y tests passing" with checkmark icon
- **Created date**: "Created Dec 20" with calendar icon

### Error Section (if present)
- Red background banner
- Displays `workflow.error` message

### Action Buttons (Context-aware)

**For Completed Workflows:**
- `[View Results]` - Opens ExecutionDashboard in read-only mode
- `[Archive]` (icon only) - Hides from list

**For Paused/Error Workflows:**
- `[View Progress]` - Opens ExecutionDashboard to see where it stopped
- `[Resume]` or `[Retry]` - Continue or restart execution
- `[Archive]` (icon only) - Hides from list

**For In-Progress Workflows:**
- `[View Dashboard]` - Jump to active ExecutionDashboard
- `[Archive]` (icon only) - Hides from list

## Status Badges

### Completed
- Green pill: `bg-green-500/10 border-green-500/20 text-green-400`
- Icon: CheckCircle2
- Text: "Completed"

### Paused
- Amber pill: `bg-amber-500/10 border-amber-500/20 text-amber-400`
- Icon: Pause
- Text: "Paused"

### Error
- Red pill: `bg-red-500/10 border-red-500/20 text-red-400`
- Icon: XCircle
- Text: "Error"

### In Progress (implementing/generating)
- Blue pill: `bg-blue-500/10 border-blue-500/20 text-blue-400`
- Icon: Loader2 (spinning)
- Text: "In Progress"

### Validating
- Purple pill: `bg-purple-500/10 border-purple-500/20 text-purple-400`
- Icon: Loader2 (spinning)
- Text: "Validating"

## Card Styling
- **Hover effect**: `hover:border-primary/30`
- **Status-based background**:
  - Completed: `border-green-500/20 bg-green-500/5`
  - Paused/Error: `border-amber-500/20 bg-amber-500/5`
  - In Progress: `border-blue-500/20 bg-blue-500/5`

## Helper Functions

### formatRelativeTime(timestamp: number)
Formats timestamp as relative time:
- < 1 min: "just now"
- < 1 hour: "Xm ago"
- < 1 day: "Xh ago"
- < 1 week: "Xd ago"
- < 4 weeks: "Xw ago"
- Older: "Dec 20, 2024"

### formatDate(timestamp: number)
Formats as short date:
- Current year: "Dec 20"
- Previous years: "Dec 20, 2023"

## Theme Integration
- Uses card background
- Status-specific color schemes
- Consistent button styling with rest of app
- Lucide icons throughout

## Change History
- 2025-12-21: Enhanced layout to make project name prominent and display workflow description
- 2025-12-21: Created workflow history card with status-based actions and formatting

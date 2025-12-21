# ProgressPanel.tsx

## Purpose
Shows overall progress during workflow execution. Displays progress bar, current feature being worked on, and time estimates.

## Key Features
- Overall progress bar
- Current feature indicator
- Time elapsed/remaining
- Phase breakdown
- View mode toggle (Stats/Kanban)
- Real-time feature updates via 2-second polling of feature_list.json

## Props
- `progress: ProgressSnapshot` - Current progress data
- `currentFeature?: string` - Feature being executed

## Theme Integration
- Progress bar uses `primary` color
- Current test indicator uses `primary` background
- Text uses theme foreground colors

## Change History
- 2025-12-21: Added 2-second polling interval for feature_list.json to ensure Kanban board updates in real-time during execution. Removed dependency on progress object reference changes.
- 2025-12-19: Updated progress bar and indicator colors to use primary

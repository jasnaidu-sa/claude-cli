# ProgressPanel.tsx

## Purpose
Shows overall progress during workflow execution. Displays progress bar, current feature being worked on, and time estimates.

## Key Features
- Overall progress bar
- Current feature indicator
- Time elapsed/remaining
- Phase breakdown

## Props
- `progress: ProgressSnapshot` - Current progress data
- `currentFeature?: string` - Feature being executed

## Theme Integration
- Progress bar uses `primary` color
- Current test indicator uses `primary` background
- Text uses theme foreground colors

## Change History
- 2025-12-19: Updated progress bar and indicator colors to use primary

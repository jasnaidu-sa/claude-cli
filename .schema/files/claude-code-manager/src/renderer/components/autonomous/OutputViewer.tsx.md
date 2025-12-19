# OutputViewer.tsx

## Purpose
Displays real-time output from the Python orchestrator during workflow execution. Shows streaming logs with syntax highlighting.

## Key Features
- Real-time log streaming
- Auto-scroll to bottom
- Copy output to clipboard
- Search within output

## Props
- `output: string` - Current output text
- `isRunning: boolean` - Whether execution is in progress

## Theme Integration
- Uses monospace font for output
- Background uses card color
- Text uses foreground color

## Change History
- 2025-12-19: Minor styling adjustments for theme consistency

# ControlPanel.tsx

## Purpose
Control panel for workflow execution. Provides model selection, start/pause/stop controls, and execution settings.

## Key Features
- Model selection (haiku, sonnet, opus)
- Start/Pause/Resume/Stop buttons
- Execution mode toggle
- Status indicators

## Props
- `workflow: Workflow` - Current workflow
- `onStart: () => void` - Start handler
- `onPause: () => void` - Pause handler
- `onStop: () => void` - Stop handler

## Theme Integration
- Model selection uses `primary` border for selected model
- Status indicators use semantic colors
- Buttons use theme color system

## Change History
- 2025-12-19: Updated model selection border to use primary color

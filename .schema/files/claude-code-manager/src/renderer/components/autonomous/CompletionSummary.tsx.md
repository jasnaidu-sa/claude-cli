# CompletionSummary.tsx

## Purpose
Shows the final summary after workflow completion. Displays total time, test results, commit options, and allows user to commit changes or merge to main.

## Key Features
- Total execution time display
- Category completion breakdown
- Commit message generation
- Git operations (commit, merge, push)
- Report generation

## Props
- `workflow: Workflow` - Completed workflow data
- `onCommit: () => void` - Commit handler
- `onMerge: () => void` - Merge handler

## Theme Integration
- Uses `primary` color for action buttons and highlights
- Uses `emerald-500` for success states
- Category icons use `primary` instead of hardcoded colors

## Change History
- 2025-12-21: Fixed elapsed time calculation to use orchestrator sessions instead of workflow.startedAt/completedAt. Now sums all session durations to show accurate total execution time.
- 2025-12-19: Updated colors to use theme variables (primary instead of amber-500)

# CategoryProgress.tsx

## Purpose
Displays progress for a single category of features during workflow execution. Shows completion percentage, test results, and individual feature status.

## Props
- `category: CategorySnapshot` - Category data with features and progress
- `isExpanded: boolean` - Whether to show feature details
- `onToggle: () => void` - Expand/collapse handler

## Key Elements
- Progress bar with completion percentage (primary color)
- Feature list with pass/fail indicators
- Expandable/collapsible UI

## Theme Integration
- Uses `primary` color for progress bars and active states
- Uses `emerald-500` for success checkmarks
- Uses semantic colors for test status indicators

## Change History
- 2025-12-19: Updated colors to use theme variables (primary instead of amber-500)

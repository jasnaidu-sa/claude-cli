# SpecReview.tsx

## Purpose
Phase 4 component for reviewing and approving the generated specification before execution. Provides markdown editing, validation, and approval flow.

## Interactions

### Store Integration
- Uses `useAutonomousStore` for:
  - `selectedProject` - Current project
  - `generatedSpec` - Specification to review
  - `setGeneratedSpec` - Update spec after edits
  - `goToNextPhase` - Proceed to execution

### Validation
- Validates spec sections for completeness
- Checks required fields and format

## Data Flow
1. Displays generatedSpec.markdown in editor/preview
2. User can edit in markdown mode
3. Validation runs on changes
4. On approval, updates spec and advances to executing phase

## UI Elements
- Two-column layout (outline + content)
- Edit/Preview toggle
- Validation warnings
- Section navigation
- Approve and Start button
- Confirmation dialog

## Key Functions
- `handleSaveEdit()` - Saves edited markdown back to spec
- `handleApproveAndStart()` - Shows confirmation dialog
- `handleConfirmApproval()` - Finalizes spec and advances phase
- `convertToAppSpec()` - Converts markdown to app_spec.txt format

## GeneratedSpec Properties
- `markdown` - Full specification text
- `appSpecTxt` - Format for Python orchestrator
- `sections` - Parsed sections array
- `featureCount` - Number of features
- `readyForExecution` - Validation passed

## Change History
- 2025-12-18: Added featureCount, readyForExecution to GeneratedSpec objects

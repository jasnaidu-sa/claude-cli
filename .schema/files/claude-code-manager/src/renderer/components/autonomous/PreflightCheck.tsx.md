# PreflightCheck.tsx

## Purpose
Phase 0b component that validates the environment before proceeding with discovery. Checks Python venv, schema freshness, MCP configuration, and git status.

## Interactions

### Store Integration
- Uses `useAutonomousStore` for:
  - `selectedProject` - Current project being worked on
  - `preflightStatus` - Current check results
  - `setPreflightStatus` - Update check results
  - `goToNextPhase` - Navigate to next phase
  - `ensureVenv` - Setup Python virtual environment
  - `venvStatus` - Current venv status

### Preload API
- `ensureVenv()` - Creates/validates Python venv

## Data Flow
1. Component mounts and triggers runPreflightChecks()
2. Checks venv status via ensureVenv()
3. Updates PreflightStatus with results
4. Auto-advances to next phase after 1.5 seconds (if no errors)

## UI Elements
- Status icons for each check (venv, schema, MCP, git)
- Warnings section (yellow) for non-blocking issues
- Re-check button for manual retry
- Continue button to proceed

## States
- `checking: boolean` - Currently running checks
- `preflightStatus: PreflightStatus | null` - Check results

## Change History
- 2025-12-18: Created as part of Option C architecture

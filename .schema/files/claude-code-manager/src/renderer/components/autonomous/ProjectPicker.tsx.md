# ProjectPicker.tsx

## Purpose
Phase 0a component for selecting or creating a project. First step in the autonomous workflow where users choose an existing project (brownfield) or create a new one (greenfield). Includes timeline view for managing multiple draft sessions.

## Interactions

### Store Integration
- Uses `useAutonomousStore` for:
  - `setSelectedProject` - Set chosen project
  - `goToNextPhase` - Navigate to preflight check
- Uses `useSessionStore` for recent sessions

### IPC
- `window.electron.discovery.listDrafts(path)` - Get all drafts for a project
- `window.electron.discovery.loadDraft(path, draftId)` - Load specific draft
- `window.electron.discovery.deleteDraft(path, draftId)` - Delete a draft
- `window.electron.discovery.createFreshSession(path, isNew)` - Start fresh
- `window.electron.dialog.selectFolder()` - Folder selection dialog
- `window.electron.config.get/set('recentProjects')` - Recent projects storage

## Data Flow
1. User selects project (existing or browse)
2. `checkAndSelectProject()` calls `listDrafts()` for the project
3. If drafts exist, shows timeline dialog with all drafts
4. User can:
   - Select a draft to continue (calls `loadDraft`)
   - Delete individual drafts (calls `deleteDraft`)
   - Start fresh (archives existing, calls `createFreshSession`)
5. Sets selectedProject and advances to next phase

## UI Elements
- Two main option cards (New Project / Existing Project)
- Recent projects list
- **Drafts Timeline Dialog** (shown when drafts exist):
  - Visual timeline with markers
  - Draft cards showing name, description, timestamp
  - "Current" badge for most recent
  - Ready-for-spec indicator (green checkmark)
  - Delete buttons per draft
  - Actions: Cancel, Start Fresh, Continue Latest

## Key Interfaces

### DraftsDialogState
```typescript
interface DraftsDialogState {
  isOpen: boolean
  projectPath: string
  projectName: string
  isNew: boolean
  drafts: DraftMetadata[]
  isLoading: boolean
}
```

## Project Object
```typescript
interface SelectedProject {
  name: string
  path: string
  isNew: boolean  // true = greenfield, false = brownfield
}
```

## Phase Routing Impact
- If isNew=true, journey_analysis phase is skipped
- If isNew=false, journey_analysis runs to analyze existing code

## Change History
- 2025-12-19: Added multi-draft timeline UI with resume/delete/start-fresh actions
- 2025-12-18: Part of Option C architecture implementation

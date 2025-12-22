# worktree-lifecycle-manager.ts

**Last Updated**: 2025-12-22

## Overview

Service for managing the lifecycle of git worktrees created for workflows. Tracks worktree status, implements auto-cleanup policies, and detects stale worktrees.

## Purpose

Automates worktree management to prevent accumulation of orphaned worktrees, reduce manual cleanup burden, and maintain a clean git repository state.

## Key Components

### WorktreeLifecycleManager Class

Singleton service managing lifecycle state for all worktrees.

**State Storage**: Persisted in `.git/.worktree-lifecycle.json`

**In-Memory Cache**: `Map<string, WorktreeLifecycle>`

### Lifecycle State

```typescript
interface WorktreeLifecycle {
  workflowId: string              // Associated workflow
  worktreePath: string            // Absolute path to worktree
  createdAt: number               // Timestamp (ms)
  status: 'active' | 'testing' | 'merged' | 'discarded'
  autoCleanupAfterMerge: boolean  // Remove after successful merge
  autoCleanupAfterDays: number    // Remove after N days inactive
}
```

**Status Meanings**:
- **active**: Currently being worked on
- **testing**: Ready for testing/review
- **merged**: Successfully merged into target branch
- **discarded**: Abandoned, can be cleaned up

### Core Methods

#### `initialize(repoPath: string): Promise<void>`

Initializes lifecycle manager with storage location.

**Process**:
1. Normalize repository path
2. Set storage path: `<repo>/.git/.worktree-lifecycle.json`
3. Load existing lifecycles from storage

**Storage Format**:
```json
{
  "/path/to/worktree1": {
    "workflowId": "workflow-123",
    "worktreePath": "/path/to/worktree1",
    "createdAt": 1735123456789,
    "status": "active",
    "autoCleanupAfterMerge": true,
    "autoCleanupAfterDays": 7
  },
  "/path/to/worktree2": { ... }
}
```

**Called By**: `git-service.initializeLifecycleTracking()`

#### `createManagedWorktree(workflowId, worktreePath, autoCleanupAfterMerge, autoCleanupAfterDays): Promise<WorktreeLifecycle>`

Creates a lifecycle tracking entry for a new worktree.

**Defaults**:
- `autoCleanupAfterMerge`: true
- `autoCleanupAfterDays`: 7

**Process**:
1. Normalize worktree path
2. Create lifecycle object with current timestamp
3. Add to in-memory map
4. Persist to storage
5. Return lifecycle

**Use Case**: Called after `git worktree add` to begin tracking

#### `updateStatus(worktreePath, status): Promise<void>`

Updates worktree status.

**Validation**: Throws error if worktree not managed

**Status Transitions**:
```
active → testing → merged/discarded
active → merged (direct merge)
active → discarded (abandoned)
```

**Persistence**: Immediately saved to storage

#### `onMergeSuccess(worktreePath, repoPath): Promise<boolean>`

Handles successful merge, triggers cleanup if configured.

**Process**:
1. Find lifecycle for worktree
2. Update status to 'merged'
3. Save to storage
4. If `autoCleanupAfterMerge === true`:
   - Call `cleanupWorktree()`
   - Return true
5. Else:
   - Keep worktree
   - Return false

**Return**: `true` if cleanup performed, `false` otherwise

**Called By**: `git-service.mergeWithConflictResolution()` after successful AI merge

#### `findStaleWorktrees(repoPath): Promise<WorktreeLifecycle[]>`

Finds worktrees older than their `autoCleanupAfterDays` threshold.

**Process**:
1. Calculate age for each worktree
2. Compare to `autoCleanupAfterDays`
3. Verify worktree directory still exists
4. Clean up tracking for missing worktrees
5. Return stale worktrees

**Age Calculation**:
```typescript
const ageInDays = (Date.now() - lifecycle.createdAt) / (1000 * 60 * 60 * 24)
if (ageInDays > lifecycle.autoCleanupAfterDays) {
  // Stale
}
```

**Self-Healing**: Removes tracking for worktrees that no longer exist

#### `cleanupStale(repoPath, dryRun): Promise<string[]>`

Cleanup stale worktrees.

**Dry Run Mode**: Returns list without deleting (preview)

**Process**:
1. Find stale worktrees
2. For each stale worktree:
   - If `dryRun`: Add to list
   - Else: Call `cleanupWorktree()`, add to list on success
3. Return list of cleaned paths

**Error Handling**: Logs errors but continues with other worktrees

### Cleanup Operations

#### `cleanupWorktree(worktreePath, repoPath): Promise<void>`

Private method to actually remove a worktree.

**Process**:
1. Run `git worktree remove <path> --force`
2. Remove from lifecycle map
3. Save updated state to storage

**Force Flag**: Used to remove worktrees even with uncommitted changes

**Error Handling**: Throws if git command fails

### Query Methods

#### `getLifecycle(worktreePath): WorktreeLifecycle | undefined`

Returns lifecycle for a specific worktree (synchronous).

**Normalization**: Path normalized before lookup

#### `getAllLifecycles(): WorktreeLifecycle[]`

Returns all tracked lifecycles as array.

**Use Case**: UI display of all managed worktrees

#### `getLifecyclesByWorkflow(workflowId): WorktreeLifecycle[]`

Returns all worktrees associated with a workflow.

**Use Case**: Show worktrees for a specific autonomous workflow

#### `getStats(): { total, byStatus, avgAgeInDays }`

Returns statistics about managed worktrees.

**Output**:
```typescript
{
  total: 5,
  byStatus: {
    active: 2,
    testing: 1,
    merged: 1,
    discarded: 1
  },
  avgAgeInDays: 3.5
}
```

**Use Case**: Dashboard metrics, health monitoring

### Storage Operations

#### `loadLifecycles(): Promise<void>`

Private method to load lifecycles from storage.

**Error Handling**:
- File not found (ENOENT): Silent, start fresh
- Invalid JSON: Warns but continues with empty state
- Other errors: Warns but continues

**Recovery**: Always succeeds, never throws

#### `saveLifecycles(): Promise<void>`

Private method to save lifecycles to storage.

**Format**: Pretty-printed JSON with 2-space indent

**Error Handling**:
- Write errors: Logged but don't throw
- Continues operation even if persistence fails

**Atomicity**: Not atomic (could lose state on crash during write)

## Integration Points

### Used By
- `git-service.ts`
  - `createManagedWorktree()` - Create worktree with tracking
  - `mergeWithConflictResolution()` - Auto-cleanup after merge
  - `cleanupStaleWorktrees()` - Batch cleanup
  - `initializeLifecycleTracking()` - Initialize on startup

- `git-handlers.ts` (IPC)
  - `git:create-managed-worktree`
  - `git:get-lifecycle`
  - `git:get-all-lifecycles`
  - `git:update-lifecycle-status`
  - `git:cleanup-stale-worktrees`

### Frontend Integration
- `worktree-store.ts` - Zustand store methods
- `LifecycleStatusBadge.tsx` - Visual status indicators
- `MergeModal.tsx` - Triggers auto-cleanup

## Cleanup Policies

### Policy 1: After Successful Merge
**Trigger**: `onMergeSuccess()` called
**Condition**: `autoCleanupAfterMerge === true`
**Action**: Immediate removal via `git worktree remove --force`

**Use Case**: Short-lived feature branches

**Benefits**:
- No manual cleanup needed
- Prevents worktree accumulation
- Clean repository state

**Risk**: Loses local changes if merge was premature

### Policy 2: Age-Based Cleanup
**Trigger**: Manual or scheduled `cleanupStale()` call
**Condition**: Worktree older than `autoCleanupAfterDays`
**Action**: Removal via `git worktree remove --force`

**Use Case**: Long-running or abandoned worktrees

**Configuration**: Per-worktree setting (default: 7 days)

**Benefits**:
- Catches orphaned worktrees
- Periodic maintenance
- Configurable threshold

**Risk**: May remove worktrees still in use if threshold too low

## Error Scenarios

### Storage File Corruption
**Symptom**: JSON.parse() throws
**Behavior**: Logs warning, starts with empty state
**Recovery**: Creates new storage file on next save

### Git Command Failure
**Symptom**: `git worktree remove` returns non-zero
**Behavior**: Throws error with git output
**Recovery**: Manual intervention needed

### Missing Worktree
**Symptom**: Lifecycle exists but directory doesn't
**Behavior**: Removes tracking entry (self-healing)
**Recovery**: Automatic during `findStaleWorktrees()`

### Unmanaged Worktree
**Symptom**: `updateStatus()` called for untracked worktree
**Behavior**: Throws "Worktree not managed" error
**Recovery**: Call `createManagedWorktree()` first

## Performance Characteristics

### Memory Usage
- In-memory map: ~200 bytes per worktree
- Typical repository: 5-10 worktrees = 1-2 KB
- Negligible overhead

### Storage I/O
- Read: On initialization only
- Write: On every state change (immediate)
- File size: ~200-500 bytes per worktree

### Git Operations
- `git worktree remove`: 100-500ms per worktree
- Batch cleanup: Sequential (could be parallelized)

## Security Considerations

### Path Validation
- All paths normalized with `path.normalize()` and `path.resolve()`
- Prevents path traversal attacks
- Paths validated against file system

### Force Flag
- `--force` flag allows removing worktrees with changes
- Risk: Data loss if worktree had uncommitted work
- Justification: Cleanup should not be blocked

### Storage Location
- Inside `.git/` directory (not tracked by git)
- Not exposed to repository users
- Persists across branches

## Testing

**Test File**: `__tests__/worktree-lifecycle-manager.test.ts`

**Coverage**:
- API surface validation
- Lifecycle CRUD operations
- Statistics calculation
- Error handling for unmanaged worktrees

**Integration Testing**:
```bash
# Create worktree with tracking
git worktree add ../test-worktree feature-branch

# Register with lifecycle manager
lifecycle.createManagedWorktree('workflow-123', '../test-worktree')

# Simulate merge
lifecycle.onMergeSuccess('../test-worktree', '.')
# → Worktree should be removed
```

## Future Enhancements

- [ ] Parallel batch cleanup
- [ ] Configurable cleanup strategies (custom rules)
- [ ] Metrics export (Prometheus, etc.)
- [ ] Notification system (email/Slack on stale worktrees)
- [ ] Integration with git hooks
- [ ] Backup worktree before cleanup
- [ ] UI for lifecycle management dashboard

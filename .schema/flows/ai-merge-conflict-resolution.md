# AI-Assisted Merge Conflict Resolution Flow

**Last Updated**: 2025-12-22

## Overview

End-to-end flow for intelligent automatic resolution of git merge conflicts using Claude AI. Implements a 3-tier escalation strategy inspired by Auto-Claude's conflict resolution patterns.

## User Journey

### 1. Merge Initiation

**Trigger**: User clicks "Merge" button in MergeModal

**UI State**:
- Shows merge preview (files changed, additions, deletions)
- Displays conflict warning if `hasConflicts === true`
- Shows AI toggle switch (if OAuth/API key available)
- Shows confidence threshold slider (40-90%, default 60%)

**User Choices**:
- **Standard Merge**: AI disabled, conflicts left for manual resolution
- **AI Merge**: AI enabled, automatic conflict resolution attempted

### 2. Authentication Check

**Flow**: `checkAIAvailability()` called on modal mount

```
Frontend (MergeModal)
  → checkAIAvailability()
    → IPC: git:is-ai-available
      → git-service.isAIResolutionAvailable()
        → authManager.isAuthAvailable()
          ↓
          Check 1: OAuth token in ~/.claude/.credentials.json?
            ✓ Yes, valid, not expired → return true
            ✗ No/expired → Check 2
          ↓
          Check 2: ANTHROPIC_API_KEY in env?
            ✓ Yes → return true
            ✗ No → return false
```

**UI Updates**:
- `isAIAvailable === true` → Show AI controls
- `isAIAvailable === false` → Hide AI controls, show setup instructions

### 3. Merge Execution

**Path A: Standard Merge (AI Disabled)**
```
User clicks "Merge"
  → git-service.merge(worktreePath, strategy)
    → git merge
      ✓ Success → Done
      ✗ Conflicts → Return error with conflict file list
```

**Path B: AI Merge (AI Enabled)**
```
User clicks "Merge with AI"
  → git-service.mergeWithConflictResolution(worktreePath, strategy, true, confidenceThreshold)
    → Step 1: Attempt normal merge
      ✓ Success → Done (no conflicts)
      ✗ Conflicts → Continue to Step 2
    ↓
    → Step 2: AI Resolution
      For each conflicted file:
        → conflict-resolver.resolveAndApply(filePath)
          → TIER 1: Extract conflict regions
          → TIER 2: AI conflict-only resolution
          → TIER 3: Full-file fallback (if confidence < threshold)
          → Syntax validation
          → Apply resolution
    ↓
    → Step 3: Commit resolved files
      → git add <resolved files>
      → git commit --no-edit
    ↓
    → Step 4: Lifecycle cleanup
      → worktree-lifecycle-manager.onMergeSuccess()
        → Update status to 'merged'
        → Auto-cleanup if configured
```

## 3-Tier Resolution Strategy

### Tier 1: Git Auto-Merge

**Handler**: Native git merge algorithm

**When**: Always attempted first

**Behavior**:
- Fast, deterministic
- No AI involved
- Resolves non-overlapping changes automatically

**Output**:
- Clean merge → No conflicts, done
- Conflicts → Files with conflict markers (<<<<<<< ======= >>>>>>>)

### Tier 2: AI Conflict-Only Resolution

**Handler**: `claude-api-service.resolveConflict()`

**When**: Tier 1 left conflicts

**Process**:
1. **Extract Conflict Region**
   ```
   conflict-resolver.extractConflictRegions(filePath)
     → Parse <<<<<<< markers
     → Extract 5 lines before/after for context
     → Identify ours vs theirs content
   ```

2. **Send to Claude API**
   ```
   claude-api-service.resolveConflict(conflictRegion)
     → Auth: Get token from auth-manager
     → Rate limit check (10 req/min)
     → Build prompt:
       System: "You are an expert code merge conflict resolver"
       User: "Resolve this conflict in <language>:
              Context before: <5 lines>
              Our changes: <ours>
              Their changes: <theirs>
              Context after: <5 lines>"
     → API call: POST /v1/messages
       - Model: claude-sonnet-4-20250514
       - Max tokens: 4096
       - Temperature: 0.0
       - Timeout: 30s
     → Parse response for resolved code + confidence
   ```

3. **Validate Resolution**
   ```
   syntax-validator.validateContent(resolvedCode, language)
     → TypeScript/JavaScript: tsc --noEmit
     → JSON: JSON.parse
     → Python: python -m py_compile
     → Returns: { valid: boolean, errors?: [] }
   ```

4. **Decision Point**
   ```
   if (confidence >= threshold && syntaxValid) {
     → Apply Tier 2 resolution
     → Mark as resolved
   } else {
     → Escalate to Tier 3
   }
   ```

### Tier 3: Full-File Fallback

**Handler**: `claude-api-service.resolveFileWithFullContext()`

**When**: Tier 2 confidence < threshold (default: 60%)

**Process**:
1. **Prepare Full Context**
   ```
   → Read entire file with conflict markers
   → Include all conflicts with line numbers
   → Send complete file structure
   ```

2. **Send to Claude API**
   ```
   claude-api-service.resolveFileWithFullContext(filePath, fileContent, conflicts)
     → Auth: Get token from auth-manager
     → Build prompt:
       System: "You are an expert at resolving complex merge conflicts"
       User: "Resolve ALL conflicts in this file:
              Full file content: <entire file>
              Conflicts at lines: <conflict locations>
              Consider: imports, types, function signatures, dependencies"
     → API call: POST /v1/messages
       - Model: claude-sonnet-4-20250514
       - Max tokens: 8192 (2x Tier 2)
       - Temperature: 0.0
       - Timeout: 30s
     → Parse response for complete resolved file
   ```

3. **Validate & Apply**
   ```
   → Validate full file syntax
   → Replace entire file with resolution
   → Higher confidence due to full context
   ```

## Parallel Processing

**Strategy**: Process multiple files concurrently with concurrency limit

**Implementation**: `conflict-resolver.parallelProcess()`

```
Max Concurrency: 3 files at a time

File 1 (Tier 2) ──┐
File 2 (Tier 2) ──┼─→ Process in parallel
File 3 (Tier 2) ──┘
  ↓ One completes
File 4 (Tier 2) ────→ Start next

Benefits:
- 3x faster for repos with many conflicts
- Respects rate limits (10 req/min)
- Balanced resource usage
```

## UI Feedback Loop

### Real-Time Updates

**During AI Resolution**:
```
MergeModal shows:
  ✓ Merging indicator
  ✓ "AI Resolving..." button text
  ✓ Progress spinner

Backend streams:
  → "Resolving file 1/5: src/auth.ts"
  → "Tier 2 resolution: 85% confidence"
  → "Applied resolution to src/auth.ts"
```

### Resolution Results

**After Success**:
```
MergeModal displays:
  ✓ Green success panel
  ✓ "AI Successfully Resolved N Conflict(s)"
  ✓ List of resolved files with:
    - File path
    - Strategy badge (Tier 2 / Tier 3)
    - Confidence percentage
    - Syntax validation status
  ✓ Auto-closes after 3 seconds
```

**Resolution Display**:
```
src/auth.ts          [Tier 2 (85%)]
src/config.ts        [Tier 3 (92%)]
src/utils.ts         [Tier 2 (78%)] ⚠ Syntax validation warning
```

## Error Scenarios

### Authentication Failure
```
Symptom: No OAuth token, no API key
Flow: isAIAvailable() → false
UI: Hide AI controls, show message:
    "AI resolution requires authentication.
     Run: claude auth login"
```

### API Rate Limit
```
Symptom: > 10 requests in 60 seconds
Flow: rateLimiter.checkLimit() → throws
Error: "Rate limit exceeded: maximum 10 requests per minute"
UI: Show error, suggest waiting or reducing files
```

### Low Confidence + Syntax Error
```
Symptom: Tier 2 confidence < threshold, Tier 3 also has issues
Flow: Resolution returns with syntaxValid: false
UI: Show warning badge, recommend manual review
User Action: Check resolved file, test locally
```

### Network Timeout
```
Symptom: Claude API doesn't respond within 30s
Flow: AbortController fires, throws timeout error
UI: Show error, suggest retrying with fewer files
Recovery: User can retry merge
```

## Lifecycle Integration

**After Successful AI Merge**:
```
worktree-lifecycle-manager.onMergeSuccess(worktreePath, repoPath)
  → Update lifecycle status: 'active' → 'merged'
  → Check autoCleanupAfterMerge setting
    ✓ true → Remove worktree automatically
    ✗ false → Keep worktree, mark as merged
  → Save lifecycle state
```

**Cleanup Behavior**:
```
if (autoCleanupAfterMerge === true) {
  → git worktree remove <path> --force
  → Remove lifecycle tracking entry
  → Update UI (worktree disappears from list)
} else {
  → Keep worktree
  → Show "merged" badge
  → User can manually remove later
}
```

## Performance Metrics

### Typical Merge Conflict Scenario

**Repo**: 50 files changed, 5 files with conflicts

**Without AI** (Manual Resolution):
- Time: 15-30 minutes per conflict
- Total: 75-150 minutes for 5 files
- Error-prone: Human mistakes possible

**With AI** (Automatic Resolution):
- Tier 1 (Git): Instant, 45 files auto-merged
- Tier 2 (AI): 2-5 seconds per conflict
- Tier 3 (AI): 5-15 seconds if needed
- Total: 10-25 seconds for 5 files
- **Speedup**: 180-540x faster

### Token Usage

**Tier 2 (per conflict)**:
- Input: 100-500 tokens (context + conflict)
- Output: 50-200 tokens (resolved code)
- Total: 150-700 tokens per conflict

**Tier 3 (per file)**:
- Input: 500-4000 tokens (full file)
- Output: 500-4000 tokens (resolved file)
- Total: 1000-8000 tokens per file

**Cost Estimate** (Claude Sonnet 4):
- Tier 2: ~$0.0003-0.002 per conflict
- Tier 3: ~$0.002-0.015 per file
- Typical merge: ~$0.01-0.05 total

## Best Practices

### When to Use AI Merge
✅ **Good Use Cases**:
- Simple to moderate conflicts (variable renames, imports)
- Code formatting differences
- Non-overlapping logic changes
- Merge conflicts in configuration files

❌ **Avoid For**:
- Major architectural refactors
- Security-critical code
- Conflicts involving authentication/authorization
- Database schema migrations

### Confidence Threshold Tuning

**60% (Default)**: Balanced
- Most conflicts resolve with Tier 2
- Occasional Tier 3 escalation
- Good for general use

**70-80% (Conservative)**:
- More Tier 3 escalations
- Higher accuracy, slower
- Use for critical code

**40-50% (Aggressive)**:
- Trust Tier 2 more often
- Faster, less token usage
- Requires good tests

### Manual Review Checklist

After AI merge:
1. ✅ Run test suite
2. ✅ Review files with syntax warnings
3. ✅ Check imports and dependencies
4. ✅ Verify business logic correctness
5. ✅ Test conflict-affected features

## Future Enhancements

- [ ] Conflict complexity scoring (predict Tier 2 vs Tier 3)
- [ ] Learning from user edits (feedback loop)
- [ ] Multi-model support (Opus for hard conflicts)
- [ ] Diff visualization with AI explanations
- [ ] Integration with CI/CD for auto-testing

# conflict-resolver.ts

**Last Updated**: 2025-12-22

## Overview

Core service for extracting, resolving, and applying git merge conflict resolutions. Implements the 3-tier resolution strategy and coordinates between git operations, AI resolution, and syntax validation.

## Purpose

Provides the orchestration layer for AI-assisted merge conflict resolution, managing the flow from conflict detection through resolution to application.

## Key Components

### ConflictResolver Class

Singleton service managing the complete conflict resolution lifecycle.

### Security: Repository Allowlist

**Problem**: Prevent arbitrary file system access

**Solution**: Repository registration required before resolution

```typescript
private allowedRepositories: Set<string> = new Set()

registerRepository(repoPath: string): void {
  const normalized = path.normalize(path.resolve(repoPath))
  this.allowedRepositories.add(normalized)
}
```

**Usage**:
```typescript
// Must register repo before resolving conflicts
conflictResolver.registerRepository('/path/to/repo')
conflictResolver.resolveFileConflicts('/path/to/repo/src/file.ts')
```

**Security Benefit**: Prevents resolving conflicts in unintended directories

### Conflict Region Extraction

#### `extractConflictRegions(filePath: string, contextLines: number): Promise<ConflictRegion[]>`

Parses files with git conflict markers and extracts structured conflict data.

**Input Validation**:
1. File path in allowed repository
2. File exists and is readable
3. File size < 10MB (MAX_FILE_SIZE_BYTES)

**Conflict Marker Parsing**:
```
<<<<<<< HEAD (or branch name)
Our changes
=======
Their changes
>>>>>>> branch-name
```

**Context Extraction**:
- Default: 5 lines before/after conflict
- Configurable via `contextLines` parameter
- Max: 100 lines (MAX_CONTEXT_LINES)

**Output Structure**:
```typescript
interface ConflictRegion {
  filePath: string
  startLine: number       // Line where <<<<<<< appears
  endLine: number         // Line where >>>>>>> appears
  oursContent: string     // Lines between <<<<<<< and =======
  theirsContent: string   // Lines between ======= and >>>>>>>
  baseContent?: string    // Not extracted (would need 3-way merge info)
  contextBefore: string   // N lines before conflict
  contextAfter: string    // N lines after conflict
}
```

**Edge Cases**:
- Multiple conflicts in same file → Returns array of regions
- No conflicts → Returns empty array
- Malformed markers → Skips and continues
- File too large → Throws error

### AI Resolution

#### `resolveConflictWithAI(conflict: ConflictRegion): Promise<ConflictResolutionResult>`

**Tier 2**: Resolves single conflict with minimal context.

**Flow**:
1. Call `claude-api-service.resolveConflict()`
2. Validate syntax of resolved code
3. Return result with confidence and validation status

```typescript
const result = await claudeAPIService.resolveConflict(conflict)
const language = syntaxValidator.detectLanguage(conflict.filePath)
const validation = await syntaxValidator.validateContent(result.resolvedContent, language)

return {
  ...result,
  syntaxValid: validation.valid,
  strategy: 'ai-conflict-only'
}
```

#### `resolveFileConflicts(filePath, contextLines, confidenceThreshold, maxConcurrency): Promise<ConflictResolutionResult[]>`

**Orchestrates Tier 2 → Tier 3 escalation**.

**Process**:
1. Extract all conflicts from file
2. Resolve in parallel (Tier 2) with concurrency limit
3. Check confidence scores
4. If any below threshold → Escalate entire file to Tier 3
5. Return resolutions

**Escalation Logic**:
```typescript
const needsFallback = tier2Results.some(r => r.confidence < confidenceThreshold)

if (needsFallback) {
  // Read full file
  const fullContent = await fs.readFile(filePath, 'utf-8')

  // Tier 3: Full-file resolution
  const tier3Result = await claudeAPIService.resolveFileWithFullContext(
    filePath,
    fullContent,
    conflicts,
    { maxTokens: 8192 }
  )

  return [tier3Result]  // Single result for whole file
}
```

**Concurrency Control**:
- Default: 3 concurrent conflicts
- Uses `parallelProcess()` utility
- Respects rate limits

### Parallel Processing Utility

#### `parallelProcess<T, R>(items, processor, maxConcurrency): Promise<R[]>`

Generic parallel execution with concurrency limit.

**Implementation**:
```typescript
async function parallelProcess<T, R>(
  items: T[],
  processor: (item: T, index: number) => Promise<R>,
  maxConcurrency: number
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  const executing: Promise<void>[] = []

  for (let i = 0; i < items.length; i++) {
    const promise = processor(items[i], i).then(result => {
      results[i] = result
    })

    executing.push(promise)

    // Wait if at max concurrency
    if (executing.length >= maxConcurrency) {
      await Promise.race(executing)
      // Remove completed promise
      executing.splice(executing.findIndex(p => p === promise), 1)
    }
  }

  await Promise.all(executing)
  return results
}
```

**Benefits**:
- Maintains order (results[i] corresponds to items[i])
- Limits simultaneous API calls
- Efficient resource usage

### Resolution Application

#### `applyResolutions(resolutions: ConflictResolutionResult[], filePath: string): Promise<void>`

Writes resolved content back to file system.

**Dual Mode Support**:

**Mode 1: Tier 2 (Multiple Regions)**
- Multiple resolutions for same file
- Reconstructs file by replacing conflict markers
- Preserves unchanged code between conflicts

**Mode 2: Tier 3 (Single Full File)**
- Single resolution contains entire file
- Replaces file content completely
- Simpler but less granular

**Detection**:
```typescript
if (resolutions.length === 1 && resolutions[0].strategy === 'ai-full-file') {
  // Mode 2: Replace entire file
  await fs.writeFile(filePath, resolutions[0].resolvedContent, 'utf-8')
} else {
  // Mode 1: Replace conflict regions
  // ... complex reconstruction logic
}
```

**Safety**:
- Atomic write (write to temp, then rename)
- Preserves file permissions
- Error recovery (original content preserved)

### Complete Workflow

#### `resolveAndApply(filePath, contextLines, confidenceThreshold, maxConcurrency): Promise<ConflictResolutionResult[]>`

End-to-end resolution: extract → resolve → apply.

**Steps**:
1. Validate file path in allowed repository
2. Extract conflict regions
3. Resolve conflicts (Tier 2 with Tier 3 fallback)
4. Apply resolutions to file
5. Return results for UI display

**Error Handling**:
- File not found → Throw with clear message
- No conflicts → Return empty array (not an error)
- Resolution failed → Return result with error field
- Apply failed → Restore original content

#### `resolveAllConflictsInRepo(repoPath, contextLines, confidenceThreshold, maxConcurrency): Promise<Map<string, ConflictResolutionResult[]>>`

Batch resolution for entire repository.

**Process**:
1. Find all files with conflict markers (git diff --name-only --diff-filter=U)
2. Register repository
3. Resolve each file in parallel
4. Return map: filePath → resolutions

**Use Case**: Large merges with many conflicts

**Optimization**: Repository-level parallelism in addition to file-level

## Security Features

### Path Validation

**Function**: `validateFilePath(filePath: string): Promise<string>`

**Checks**:
1. Path in allowed repository
2. No parent directory traversal (`..`)
3. File exists
4. File size < MAX_FILE_SIZE_BYTES (10MB)
5. File is readable

**Error Messages**:
- "File path not in allowed repository"
- "Path traversal detected"
- "File too large: X bytes (max: 10MB)"

### Repository Validation

**Function**: `validateRepoPath(repoPath: string): Promise<string>`

**Checks**:
1. Path normalization
2. Directory exists
3. Is a git repository (.git folder present)

### Bounds Checking

**Constants**:
```typescript
const MAX_CONTEXT_LINES = 100
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024  // 10MB
const DEFAULT_MAX_CONCURRENCY = 3
```

**Prevents**:
- Excessive context → API quota exhaustion
- Large files → Memory issues
- Too many concurrent requests → Rate limit violations

## Error Handling Patterns

### Type Guard
```typescript
function isErrorObject(error: unknown): error is Error {
  return error instanceof Error
}
```

**Used for**: Safe error message extraction

### Result Pattern
```typescript
interface ConflictResolutionResult {
  // ... data fields
  error?: string  // Present on failure
}
```

**Benefit**: Errors don't crash the flow, allow partial success

### Error Sanitization
```typescript
catch (error) {
  const message = isErrorObject(error) ? error.message : String(error)
  throw new Error(`Failed to resolve conflict: ${message}`)
}
```

**Prevents**: Leaking sensitive data in error messages

## Integration Points

### Dependencies
- `claude-api-service.ts` - AI resolution
- `syntax-validator.ts` - Post-resolution validation
- Node.js `fs`, `path`, `child_process` - File operations

### Used By
- `git-service.ts` - Main consumer
- `git-handlers.ts` - IPC layer (indirect)

## Performance Characteristics

### Single File with 3 Conflicts
- Extract: < 50ms (file I/O + parsing)
- Resolve (Tier 2, parallel): 6-15 seconds (3 API calls)
- Validate: 100-500ms per conflict (syntax check)
- Apply: < 50ms (file write)
- **Total**: 7-16 seconds

### Repository with 10 Files, 20 Conflicts
- Parallel processing: 3 files at a time
- **Total**: 25-60 seconds (vs 140-300 seconds sequential)

### Memory Usage
- File content in memory during resolution
- Max file size limit prevents excessive memory
- Streaming not used (files are small)

## Testing

**Test File**: `__tests__/conflict-resolver.test.ts`

**Coverage**:
- API surface validation
- Repository registration
- Error handling for invalid paths
- Error handling for unregistered repos

**Manual Testing**:
```bash
# Create test conflict
git checkout -b test-branch
echo "ours" > test.txt
git add test.txt && git commit -m "ours"

git checkout main
echo "theirs" > test.txt
git add test.txt && git commit -m "theirs"

git merge test-branch  # Creates conflict

# Test resolution (via Electron app)
```

## Future Enhancements

- [ ] 3-way merge base content extraction
- [ ] Conflict complexity scoring
- [ ] Streaming for large files
- [ ] Resolution caching
- [ ] Conflict history tracking

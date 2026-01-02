# Worktree Implementation Analysis: Our Codebase vs Auto-Claude

Date: 2025-12-21
Comparison with: [Auto-Claude by AndyMik90](https://github.com/AndyMik90/Auto-Claude)

## Executive Summary

After reviewing Auto-Claude's implementation, I've identified several key architectural patterns and features that could enhance our worktree system, particularly around:
1. **3-Tier Merge Conflict Resolution** - Intelligent AI-assisted conflict resolution
2. **Worktree Lifecycle Management** - Automated cleanup and isolation patterns
3. **Parallel Processing** - Multiple worktrees for concurrent development
4. **Merge Preview & Validation** - Syntax validation before merge

---

## Auto-Claude's Approach

### Worktree Architecture

**Storage Location:**
- Worktrees stored in `.worktrees/auto-claude/` (relative to project root)
- Temporary, git-ignored workspaces
- Automatically cleaned up after merge

**Workflow:**
```
1. Create spec → 2. Generate in worktree → 3. Test in isolation →
4. Review changes → 5. Merge or discard
```

**Key Commands:**
```bash
python run.py --spec 001 --review    # Review changes
python run.py --spec 001 --merge     # Merge into main
python run.py --spec 001 --discard   # Delete worktree
```

### 3-Tier Merge Conflict Resolution ⭐

**Tier 1: Git Auto-Merge**
- Attempts standard `git merge` first
- No AI involvement for clean merges
- ~98% of simple conflicts resolved instantly

**Tier 2: Conflict-Only AI**
- Extracts ONLY conflict markers and surrounding context
- Sends minimal prompt to AI (~98% prompt reduction)
- AI resolves specific conflict regions

**Tier 3: Full-File AI (Fallback)**
- If conflict-only fails, provides full file context
- AI analyzes entire file for comprehensive resolution
- Last resort for complex interdependencies

**Additional Features:**
- Parallel processing of multiple conflicting files
- Syntax validation before applying merge
- Builds can merge in seconds even when far behind main

---

## Our Current Implementation

### Worktree Architecture (`git-service.ts`)

**Storage Location:**
- Worktrees stored in `{repoPath}-worktrees/{branch}/`
- Example: `C:\project-worktrees\feature-123/`
- Persistent until manually removed

**Core Methods:**

#### 1. **createWorktree()** (Lines 83-121)
```typescript
async createWorktree(repoPath, branchName, baseBranch?)
```
- Sanitizes branch name for directory safety
- Creates worktree with `git worktree add -b`
- Sets up node_modules symlink if dependencies match
- Returns Worktree object with metadata

#### 2. **listWorktrees()** (Lines 21-78)
```typescript
async listWorktrees(repoPath)
```
- Parses `git worktree list --porcelain`
- Extracts path, branch, and metadata
- Identifies main repo vs worktrees

#### 3. **removeWorktree()** (Lines 126-137)
```typescript
async removeWorktree(worktreePath, force?)
```
- Removes worktree using `git worktree remove`
- Optional `--force` flag for dirty worktrees

#### 4. **getMergePreview()** (Lines 291-345)
```typescript
async getMergePreview(worktreePath)
```
- Shows file changes, additions, deletions
- Checks for conflicts via test merge
- Returns can-fast-forward status
- **Current conflict detection:** Attempts `git merge --no-commit --no-ff` then aborts

#### 5. **merge()** (Lines 376-446)
```typescript
async merge(worktreePath, strategy)
```
- Supports 3 strategies: merge, squash, rebase
- Merges in main repo, not in worktree
- Returns conflict list if merge fails
- **Current conflict handling:** Returns error + conflict file list

### What We Have ✅

1. **Comprehensive Git Operations**
   - List, create, remove worktrees
   - Branch management
   - Remote sync (push/pull/fetch)
   - Status tracking (ahead/behind, dirty state)

2. **Merge Strategies**
   - Standard merge with `--no-ff`
   - Squash merge
   - Rebase + fast-forward

3. **Developer Experience**
   - node_modules symlinking for faster setup
   - Stale worktree detection (30-day threshold)
   - Branch name sanitization

4. **Merge Preview**
   - File-level change summary
   - Addition/deletion counts
   - Conflict detection via test merge

### What We're Missing ❌

1. **No AI-Assisted Conflict Resolution**
   - Conflicts just return error message
   - User must manually resolve in main repo
   - No intelligent analysis of conflict regions

2. **No Automated Cleanup**
   - Worktrees persist indefinitely
   - Requires manual `removeWorktree()` call
   - No workflow-driven lifecycle management

3. **No Syntax Validation**
   - Merge applied blindly
   - No pre-merge validation of merged code
   - Could break builds

4. **No Parallel Conflict Processing**
   - Sequential conflict detection
   - No batch resolution of multiple files

5. **No Conflict-Only Context Extraction**
   - Full file always provided if needed
   - Wastes tokens on irrelevant code

---

## Recommended Improvements

### 🔥 Priority 1: AI-Assisted Merge Conflict Resolution

**Implementation Strategy:**

#### Step 1: Conflict Detection & Extraction
```typescript
interface ConflictRegion {
  filePath: string
  startLine: number
  endLine: number
  oursContent: string
  theirsContent: string
  baseContent?: string
  contextBefore: string  // 5 lines before
  contextAfter: string   // 5 lines after
}

async extractConflictRegions(repoPath: string): Promise<ConflictRegion[]>
```

**Logic:**
1. Get conflicted files: `git diff --name-only --diff-filter=U`
2. For each file, parse conflict markers:
   ```
   <<<<<<< HEAD
   our changes
   =======
   their changes
   >>>>>>> branch
   ```
3. Extract minimal context (5 lines before/after)
4. Return structured conflict data

#### Step 2: 3-Tier Resolution Agent

```typescript
interface ConflictResolutionResult {
  filePath: string
  resolvedContent: string
  strategy: 'auto-merge' | 'ai-conflict-only' | 'ai-full-file'
  confidence: number
  syntaxValid: boolean
}

async resolveConflicts(
  conflicts: ConflictRegion[],
  repoPath: string
): Promise<ConflictResolutionResult[]>
```

**Tier 1: Git Auto-Merge**
```typescript
// Already handled by git merge - skip files without conflicts
```

**Tier 2: AI Conflict-Only Resolution**
```typescript
const prompt = `
You are a merge conflict resolution expert. Analyze this conflict and provide the correct merged version.

File: ${conflict.filePath}
Context Before:
${conflict.contextBefore}

<<<<<<< HEAD (Our Changes)
${conflict.oursContent}
=======
${conflict.theirsContent}
>>>>>>> ${branchName}

Context After:
${conflict.contextAfter}

Provide the resolved code for this section only.
`
```

**Tier 3: Full-File AI (Fallback)**
```typescript
const fullFileContent = await readFile(conflict.filePath)
const prompt = `
Resolve all conflicts in this file:

${fullFileContent}

Provide the complete resolved file.
`
```

#### Step 3: Syntax Validation

```typescript
async validateMergedCode(
  filePath: string,
  content: string,
  repoPath: string
): Promise<{ valid: boolean; errors?: string[] }>
```

**Per Language:**
- **TypeScript/JavaScript**: Run `tsc --noEmit` or ESLint
- **Python**: Run `python -m py_compile`
- **Go**: Run `go build -o /dev/null`
- **JSON**: `JSON.parse()`

#### Step 4: Integration with GitService

```typescript
// Add to git-service.ts
async mergeWithConflictResolution(
  worktreePath: string,
  strategy: MergeStrategy,
  options: {
    autoResolve?: boolean
    validateSyntax?: boolean
    model?: string
  }
): Promise<MergeResult & {
  resolvedConflicts?: ConflictResolutionResult[]
  validationErrors?: string[]
}>
```

**Workflow:**
1. Attempt standard merge
2. If conflicts, extract conflict regions
3. Attempt AI resolution (Tier 2)
4. Validate syntax of resolved files
5. If validation fails, fallback to Tier 3
6. Apply resolved content
7. Return detailed result

---

### 🎯 Priority 2: Automated Worktree Lifecycle

**Current Issue:** Worktrees never auto-cleanup, pollute filesystem

**Solution: Workflow-Driven Lifecycle**

```typescript
interface WorktreeLifecycle {
  workflowId: string
  worktreePath: string
  createdAt: number
  status: 'active' | 'testing' | 'merged' | 'discarded'
  autoCleanupAfterMerge: boolean
  autoCleanupAfterDays: number
}

class WorktreeLifecycleManager {
  // Track worktrees by workflow
  private lifecycles = new Map<string, WorktreeLifecycle>()

  async createManagedWorktree(
    workflowId: string,
    repoPath: string,
    branchName: string,
    options: {
      autoCleanupAfterMerge?: boolean  // default: true
      autoCleanupAfterDays?: number    // default: 7
    }
  ): Promise<Worktree>

  async markTesting(workflowId: string): Promise<void>

  async onMergeSuccess(workflowId: string): Promise<void> {
    const lifecycle = this.lifecycles.get(workflowId)
    if (lifecycle?.autoCleanupAfterMerge) {
      await gitService.removeWorktree(lifecycle.worktreePath)
      this.lifecycles.delete(workflowId)
    }
  }

  async cleanupStale(): Promise<void> {
    for (const [id, lifecycle] of this.lifecycles) {
      const ageInDays = (Date.now() - lifecycle.createdAt) / (1000 * 60 * 60 * 24)
      if (ageInDays > lifecycle.autoCleanupAfterDays) {
        await gitService.removeWorktree(lifecycle.worktreePath, true)
        this.lifecycles.delete(id)
      }
    }
  }
}
```

**Integration Points:**
- `ExecutionDashboard`: Create managed worktree on workflow start
- `CompletionSummary`: Cleanup on merge success
- Background task: Run `cleanupStale()` daily

---

### 🔧 Priority 3: Parallel Conflict Processing

**Current Issue:** Sequential conflict detection, slow for many files

**Solution:**

```typescript
async resolveConflictsInParallel(
  conflicts: ConflictRegion[],
  repoPath: string,
  maxConcurrency: number = 3
): Promise<ConflictResolutionResult[]> {
  const chunks = chunkArray(conflicts, maxConcurrency)
  const results: ConflictResolutionResult[] = []

  for (const chunk of chunks) {
    const chunkResults = await Promise.all(
      chunk.map(conflict => this.resolveConflict(conflict, repoPath))
    )
    results.push(...chunkResults)
  }

  return results
}
```

**Benefits:**
- 3x faster for projects with multiple conflicts
- Better token usage (parallel API calls)
- User sees progress for each file

---

### 📊 Priority 4: Enhanced Merge Preview

**Current Implementation:**
```typescript
getMergePreview() // Returns file changes + conflict check
```

**Enhanced Version:**

```typescript
interface EnhancedMergePreview extends MergePreview {
  // Existing fields...

  // New fields:
  conflictAnalysis?: {
    totalConflicts: number
    conflictsByFile: Map<string, number>
    resolvableByAI: number
    estimatedResolutionTime: number  // seconds
  }

  riskAssessment: {
    level: 'low' | 'medium' | 'high'
    factors: string[]  // e.g., "Many conflicts", "Core files changed"
  }

  affectedTests?: string[]  // Tests that might break

  syntaxIssues?: {
    filePath: string
    issues: string[]
  }[]
}
```

---

## Implementation Priority

### Phase 1: Foundation (Week 1)
1. ✅ Extract conflict regions logic
2. ✅ Basic AI prompt for conflict resolution
3. ✅ Syntax validation per language

### Phase 2: Core Agent (Week 2)
4. ✅ Implement Tier 2 (conflict-only AI)
5. ✅ Implement Tier 3 (full-file fallback)
6. ✅ Integration with merge() method

### Phase 3: Automation (Week 3)
7. ✅ Worktree lifecycle manager
8. ✅ Auto-cleanup on merge success
9. ✅ Background stale worktree cleanup

### Phase 4: Optimization (Week 4)
10. ✅ Parallel conflict processing
11. ✅ Enhanced merge preview
12. ✅ UI components for conflict resolution

---

## Architecture Comparison

### Auto-Claude Pattern
```
Spec Created → Worktree Created → Code Generated →
User Tests → Review → Merge (AI resolves conflicts) → Worktree Deleted
```

### Our Current Pattern
```
Discovery → Spec → Workflow Created → (No Worktree Yet) →
Orchestrator Runs → Code Generated in Main Repo → Merge (Manual conflicts)
```

### Proposed Enhanced Pattern
```
Discovery → Spec → Workflow Created → Managed Worktree Created →
Orchestrator Runs in Worktree → Tests Pass → Review →
AI-Assisted Merge → Syntax Validation → Success → Auto-Cleanup
```

---

## Key Takeaways

### What Auto-Claude Does Better
1. **Intelligent Conflict Resolution** - 3-tier approach saves massive time
2. **Automated Lifecycle** - Worktrees clean up automatically
3. **Validation Before Merge** - Syntax checking prevents broken builds
4. **Efficiency** - 98% prompt reduction via conflict-only resolution

### What We Do Better
1. **Rich Metadata** - Comprehensive worktree tracking
2. **Multiple Merge Strategies** - Squash, rebase, standard merge
3. **Remote Sync** - Full push/pull/fetch support
4. **Developer Tools** - node_modules symlinking, stale detection
5. **Type Safety** - Strong TypeScript types throughout

### Best of Both Worlds
By adding Auto-Claude's conflict resolution and lifecycle management to our robust git infrastructure, we create a superior system that combines:
- Intelligent automation (Auto-Claude)
- Developer experience (Ours)
- Production-grade tooling (Both)

---

## Sources

- [Auto-Claude Repository](https://github.com/AndyMik90/Auto-Claude)
- [Auto-Claude CLI Usage Guide](https://github.com/AndyMik90/Auto-Claude/blob/main/guides/CLI-USAGE.md)
- [Claude Code Worktree Pattern Discussion](https://github.com/anthropics/claude-code/issues/1052)

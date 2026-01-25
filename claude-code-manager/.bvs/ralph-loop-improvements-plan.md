# Ralph Loop-Inspired BVS Improvements - Execution Plan

**Created:** 2026-01-23
**Total Sections:** 17
**Estimated Time:** 51 hours
**Parallel Levels:** 5

---

## Overview

This plan implements subtask-level execution with fresh context, session limits, build verification, cost tracking, and attended modes to improve BVS reliability and reduce token waste.

---

## Execution Strategy

### Parallel Execution Groups

The 17 sections are organized into 5 parallel levels based on dependencies:

- **Level 0:** 4 sections (can run in parallel)
- **Level 1:** 6 sections (can run in parallel)
- **Level 2:** 2 sections (can run in parallel)
- **Level 3:** 4 sections (can run in parallel)
- **Level 4:** 1 section

**Critical Path:** RALPH-001 → RALPH-002 → RALPH-003 → RALPH-005 → RALPH-006 (16 hours)

---

## Level 0: Foundation Types & Services (4 sections in parallel)

### RALPH-001: Add Subtask and Metrics Types ⭐ CRITICAL
**Priority:** High | **Effort:** 1 hour

**Files:**
- `src/shared/bvs-types.ts` (modify)

**What to Build:**
```typescript
// Add these interfaces to bvs-types.ts

export interface Subtask {
  id: string                    // e.g., "AUTH-001-schema"
  name: string                  // Human-readable
  files: BvsFile[]
  estimatedLines: number
  dependencies?: string[]
}

export interface SubtaskResult {
  subtask: Subtask
  status: 'completed' | 'failed'
  turnsUsed: number
  tokensUsed: number
  model: string
  files: BvsFile[]
  errors: string[]
  startedAt: number
  completedAt: number
}

export interface BvsExecutionLimits {
  maxIterationsPerWorker: number  // Default: 20
  maxTotalIterations: number      // Default: 100
  maxCostPerWorker: number        // Default: $0.50
  maxTotalCost: number            // Default: $5.00
}

export const DEFAULT_LIMITS: BvsExecutionLimits = {
  maxIterationsPerWorker: 20,
  maxTotalIterations: 100,
  maxCostPerWorker: 0.50,
  maxTotalCost: 5.00
}

export interface SubtaskMetrics {
  subtaskId: string
  name: string
  iterations: number
  tokensUsed: number
  costUsd: number
  timeElapsed: number
}

export enum BvsExecutionMode {
  ATTENDED_SINGLE = 'attended-single',
  ATTENDED_LEVEL = 'attended-level',
  SEMI_ATTENDED = 'semi-attended',
  UNATTENDED = 'unattended'
}

export interface BvsExecutionConfig {
  mode: BvsExecutionMode
  limits: BvsExecutionLimits
  notifications: {
    onSectionComplete: boolean
    onMergePointReached: boolean
    onConflict: boolean
    onFailure: boolean
  }
}

// Extend BvsWorkerMetrics
export interface BvsWorkerMetrics {
  // ... existing fields ...
  subtasks: SubtaskMetrics[]  // NEW
}
```

**Success Criteria:**
- ✅ All interfaces compile
- ✅ DEFAULT_LIMITS exported
- ✅ No breaking changes to existing types

---

### RALPH-009: Add Build Verification to Quality Gates
**Priority:** High | **Effort:** 2 hours

**Files:**
- `src/main/services/bvs-quality-gate-service.ts` (modify)

**What to Build:**
```typescript
// Add to QualityGateConfig
export interface QualityGateConfig {
  typecheck: boolean
  lint: boolean
  tests: boolean
  build: boolean        // NEW
  coverage?: number     // NEW
}

// Add build detection
async function detectBuildCommand(projectPath: string): Promise<string> {
  const pkgPath = path.join(projectPath, 'package.json')
  const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'))

  const buildScripts = ['build', 'compile', 'tsc', 'build:prod']

  for (const script of buildScripts) {
    if (pkg.scripts?.[script]) {
      return script
    }
  }

  throw new Error('No build script found in package.json')
}

// Add build execution
async function runBuild(projectPath: string): Promise<QualityCheck> {
  console.log('[QualityGate] Running build verification...')

  const buildCmd = await detectBuildCommand(projectPath)

  const result = await safeExec('npm', ['run', buildCmd], {
    cwd: projectPath,
    timeout: 300000 // 5 minutes
  })

  return {
    name: 'Build',
    passed: result.exitCode === 0,
    output: result.stdout,
    errors: result.exitCode !== 0 ? [result.stderr] : [],
    duration: 0
  }
}

// Update runQualityGates
export async function runQualityGates(
  projectPath: string,
  config: QualityGateConfig
): Promise<QualityGateResult> {
  const results: QualityCheck[] = []

  if (config.typecheck) results.push(await runTypeCheck(projectPath))
  if (config.lint) results.push(await runLint(projectPath))
  if (config.tests) results.push(await runTests(projectPath, config.coverage))
  if (config.build) results.push(await runBuild(projectPath)) // NEW

  return {
    passed: results.every(r => r.passed),
    checks: results,
    timestamp: Date.now()
  }
}
```

**Success Criteria:**
- ✅ Detects build command from package.json
- ✅ Runs build with 5min timeout
- ✅ Captures build failures
- ✅ Integrates with existing quality gates

---

### RALPH-011: Create SessionLimitError Class
**Priority:** Medium | **Effort:** 0.5 hours

**Files:**
- `src/main/services/bvs-orchestrator-service.ts` (modify)

**What to Build:**
```typescript
export class SessionLimitError extends Error {
  constructor(
    public limitType: 'iteration' | 'cost',
    public currentValue: number,
    public limit: number,
    message: string
  ) {
    super(message)
    this.name = 'SessionLimitError'
  }
}
```

**Success Criteria:**
- ✅ Class extends Error
- ✅ Properties are public and typed
- ✅ Compiles without errors

---

### RALPH-013: Create Plan Validator Service
**Priority:** Medium | **Effort:** 5 hours

**Files:**
- `src/main/services/bvs-plan-validator-service.ts` (create new)

**What to Build:**
Full plan validation service with:
- File count validation (warn if >5 files per section)
- Success criteria validation (error if missing, warn if not binary)
- Dependency cycle detection (error if cycles found)
- File existence validation (error if modify action on missing file)

**Key Functions:**
- `validatePlan()` - Main validation entry point
- `isBinaryCriterion()` - Check if criteria is pass/fail
- `detectDependencyCycles()` - DFS cycle detection
- `fileExists()` - Async file existence check

**Success Criteria:**
- ✅ Returns errors and warnings arrays
- ✅ All validation checks implemented
- ✅ Compiles without errors

---

## Level 1: Core Logic (6 sections in parallel)

### RALPH-002: Implement identifySubtasks() Method ⭐ CRITICAL
**Priority:** High | **Effort:** 4 hours | **Depends on:** RALPH-001

**Files:**
- `src/main/services/bvs-worker-agent-service.ts` (modify)

**What to Build:**
```typescript
private identifySubtasks(section: BvsSection): Subtask[] {
  const subtasks: Subtask[] = []

  // Group 1: Database/schema changes
  const schemaFiles = section.files.filter(f =>
    f.path.includes('schema') ||
    f.path.includes('migration') ||
    f.path.endsWith('.sql')
  )
  if (schemaFiles.length > 0) {
    subtasks.push({
      id: `${section.id}-schema`,
      name: 'Database schema changes',
      files: schemaFiles,
      estimatedLines: this.estimateLines(schemaFiles)
    })
  }

  // Group 2: Type definitions
  const typeFiles = section.files.filter(f =>
    f.path.includes('types') ||
    f.path.includes('interfaces') ||
    f.path.endsWith('.d.ts')
  )
  if (typeFiles.length > 0) {
    subtasks.push({
      id: `${section.id}-types`,
      name: 'Type definitions',
      files: typeFiles,
      estimatedLines: this.estimateLines(typeFiles)
    })
  }

  // Group 3: Implementation files
  const implFiles = section.files.filter(f =>
    !f.path.includes('test') &&
    !f.path.includes('spec') &&
    !f.path.includes('schema') &&
    !f.path.includes('types')
  )
  if (implFiles.length > 0) {
    if (implFiles.length > 2 || this.estimateLines(implFiles) > 150) {
      // Split large implementations
      for (const file of implFiles) {
        subtasks.push({
          id: `${section.id}-impl-${path.basename(file.path, path.extname(file.path))}`,
          name: `Implement ${path.basename(file.path)}`,
          files: [file],
          estimatedLines: this.estimateLines([file])
        })
      }
    } else {
      subtasks.push({
        id: `${section.id}-impl`,
        name: 'Implementation',
        files: implFiles,
        estimatedLines: this.estimateLines(implFiles)
      })
    }
  }

  // Group 4: Tests
  const testFiles = section.files.filter(f =>
    f.path.includes('test') || f.path.includes('spec')
  )
  if (testFiles.length > 0) {
    subtasks.push({
      id: `${section.id}-tests`,
      name: 'Tests',
      files: testFiles,
      estimatedLines: this.estimateLines(testFiles)
    })
  }

  return subtasks
}

private estimateLines(files: BvsFile[]): number {
  // Simple heuristic: 50 lines per new file, 30 per modified
  return files.reduce((sum, f) =>
    sum + (f.action === 'create' ? 50 : 30), 0
  )
}
```

**Success Criteria:**
- ✅ Groups schema files together
- ✅ Groups type files together
- ✅ Splits large implementation files
- ✅ Groups test files together
- ✅ Returns array of Subtask objects

---

### RALPH-007: Implement Subtask Commit Logic
**Priority:** Medium | **Effort:** 1 hour | **Depends on:** RALPH-001

**Files:**
- `src/main/services/bvs-worker-agent-service.ts` (modify)

**What to Build:**
```typescript
private async commitSubtask(result: SubtaskResult, subtask: Subtask): Promise<void> {
  const commitMessage = `feat(${subtask.id}): ${subtask.name}

Files changed:
${result.files.map(f => `- ${f.path}`).join('\n')}

Co-Authored-By: Claude ${result.model} <noreply@anthropic.com>`

  await runGit(['add', ...result.files.map(f => f.path)], { cwd: this.worktreePath })
  await runGit(['commit', '-m', commitMessage], { cwd: this.worktreePath })

  console.log(`[Worker] Committed subtask: ${subtask.id}`)
}
```

**Success Criteria:**
- ✅ Commits after each subtask
- ✅ Descriptive commit messages
- ✅ Lists files changed

---

### RALPH-008: Implement Cost Tracking
**Priority:** High | **Effort:** 3 hours | **Depends on:** RALPH-001

**Files:**
- `src/main/services/bvs-worker-agent-service.ts` (modify)

**What to Build:**
```typescript
function calculateCost(tokens: number, model: string): number {
  const COSTS: Record<string, { input: number; output: number }> = {
    'claude-sonnet-4-20250514': { input: 3.00, output: 15.00 },
    'claude-haiku-4-20250514': { input: 0.80, output: 4.00 }
  }

  const pricing = COSTS[model] || COSTS['claude-sonnet-4-20250514']

  // Rough estimate: 70% input, 30% output
  const inputTokens = tokens * 0.7
  const outputTokens = tokens * 0.3

  return (
    (inputTokens / 1_000_000) * pricing.input +
    (outputTokens / 1_000_000) * pricing.output
  )
}

// In executeSection():
for (const subtask of subtasks) {
  let subtaskTokens = 0
  let subtaskIterations = 0

  const agent = new ClaudeAgent({
    model: this.selectModelForSubtask(subtask),
    onTokenUsage: (usage) => {
      subtaskTokens += usage.input_tokens + usage.output_tokens
      subtaskIterations++
    }
  })

  // ... execute subtask ...

  const subtaskCost = calculateCost(subtaskTokens, agent.model)

  subtaskMetrics.push({
    subtaskId: subtask.id,
    name: subtask.name,
    iterations: subtaskIterations,
    tokensUsed: subtaskTokens,
    costUsd: subtaskCost,
    timeElapsed: Date.now() - subtaskStart
  })
}
```

**Success Criteria:**
- ✅ Tracks tokens per subtask
- ✅ Calculates cost using model pricing
- ✅ Stores metrics in SubtaskMetrics array

---

### RALPH-010: Implement Session Limits
**Priority:** High | **Effort:** 3 hours | **Depends on:** RALPH-001

**Files:**
- `src/main/services/bvs-orchestrator-service.ts` (modify)

**What to Build:**
```typescript
async executeWithMergePoints(
  sessionId: string,
  limits: BvsExecutionLimits = DEFAULT_LIMITS
): Promise<BvsSessionResult> {
  const session = this.getSession(sessionId)
  let totalIterations = 0
  let totalCost = 0

  for (const level of session.plan.levels) {
    // Check limits BEFORE starting level
    if (totalIterations >= limits.maxTotalIterations) {
      throw new SessionLimitError(
        'iteration',
        totalIterations,
        limits.maxTotalIterations,
        'Session hit maximum iteration limit. Progress saved.'
      )
    }

    if (totalCost >= limits.maxTotalCost) {
      throw new SessionLimitError(
        'cost',
        totalCost,
        limits.maxTotalCost,
        `Session hit maximum cost limit ($${totalCost.toFixed(2)}). Progress saved.`
      )
    }

    const workers = await this.executeWorkersForLevel(level, limits)

    // Aggregate metrics
    for (const worker of workers) {
      totalIterations += worker.metrics.iterations
      totalCost += worker.metrics.costUsd
    }

    // Emit progress
    this.emit('progress', {
      level: level.groupId,
      totalIterations,
      totalCost,
      remainingIterations: limits.maxTotalIterations - totalIterations,
      remainingBudget: limits.maxTotalCost - totalCost
    })
  }

  return { success: true, totalIterations, totalCost, completedAt: Date.now() }
}
```

**Success Criteria:**
- ✅ Checks limits before each level
- ✅ Throws SessionLimitError on exceed
- ✅ Emits progress with remaining budget

---

### RALPH-012: Implement Attended Modes
**Priority:** Medium | **Effort:** 4 hours | **Depends on:** RALPH-001

**Files:**
- `src/main/services/bvs-orchestrator-service.ts` (modify)

**What to Build:**
```typescript
async executeWithMergePoints(
  sessionId: string,
  config: BvsExecutionConfig
): Promise<BvsSessionResult> {
  // ... existing code ...

  for (const level of session.plan.levels) {
    const workers = await this.executeWorkersForLevel(level, config.limits)

    // Attended mode: pause and wait
    if (config.mode === BvsExecutionMode.ATTENDED_LEVEL) {
      await this.waitForUserApproval(sessionId, { type: 'level', id: level.groupId })
    }

    if (config.mode === BvsExecutionMode.ATTENDED_SINGLE) {
      for (const worker of workers) {
        await this.waitForUserApproval(sessionId, { type: 'section', id: worker.sectionId })
      }
    }
  }
}

private async waitForUserApproval(
  sessionId: string,
  context: { type: 'level' | 'section'; id: string }
): Promise<void> {
  return new Promise((resolve) => {
    this.emit('approval-required', {
      sessionId,
      context,
      approve: () => resolve(),
      message: `Review changes and approve to continue`
    })
  })
}
```

**Success Criteria:**
- ✅ Waits for approval in attended modes
- ✅ Emits approval-required event
- ✅ Resolves promise on approval

---

### RALPH-014: Add IPC Handlers
**Priority:** Medium | **Effort:** 2 hours | **Depends on:** RALPH-001, RALPH-013

**Files:**
- `src/main/ipc/bvs-handlers.ts` (modify)

**What to Build:**
```typescript
ipcMain.handle('bvs:start-execution-with-config', async (_event, sessionId: string, config: BvsExecutionConfig) => {
  try {
    await orchestrator.executeWithMergePoints(sessionId, config)
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
})

ipcMain.handle('bvs:validate-plan', async (_event, projectPath: string, plan: BvsExecutionPlan) => {
  const { validatePlan } = await import('../services/bvs-plan-validator-service')
  const result = await validatePlan(projectPath, plan)
  return result
})
```

**Success Criteria:**
- ✅ Handlers registered
- ✅ Accept config with limits and mode
- ✅ Return validation results

---

## Level 2: Execution Core (2 sections in parallel)

### RALPH-003: Implement Subtask Execution Loop ⭐ CRITICAL
**Priority:** High | **Effort:** 6 hours | **Depends on:** RALPH-002

**Files:**
- `src/main/services/bvs-worker-agent-service.ts` (modify)

**What to Build:**
Refactor `executeSection()` to:
1. Call `identifySubtasks(section)`
2. Loop over subtasks
3. Create fresh `ClaudeAgent` per subtask with `maxTurns: 5`
4. Execute with `buildSubtaskPrompt()`
5. Store results
6. Call `aggregateResults()`

**Success Criteria:**
- ✅ Each subtask gets fresh agent
- ✅ Turn limit is 5 per subtask
- ✅ Results accumulated
- ✅ Agent instances destroyed between subtasks

---

### RALPH-015: Update Preload APIs
**Priority:** Medium | **Effort:** 1 hour | **Depends on:** RALPH-014

**Files:**
- `src/preload/index.ts` (modify)

**What to Build:**
```typescript
// Type definitions
startExecutionWithConfig: (sessionId: string, config: BvsExecutionConfig) => Promise<{ success: boolean; error?: string }>
validatePlan: (projectPath: string, plan: BvsExecutionPlan) => Promise<PlanValidationResult>

// Implementations
startExecutionWithConfig: (sessionId, config) =>
  ipcRenderer.invoke('bvs:start-execution-with-config', sessionId, config)
validatePlan: (projectPath, plan) =>
  ipcRenderer.invoke('bvs:validate-plan', projectPath, plan)
```

**Success Criteria:**
- ✅ Type definitions added
- ✅ Implementations call IPC
- ✅ Compiles without errors

---

## Level 3: Refinements (4 sections in parallel)

### RALPH-004: Implement Subtask Prompt Building
**Priority:** High | **Effort:** 2 hours | **Depends on:** RALPH-003, RALPH-001

**Files:**
- `src/main/services/bvs-worker-agent-service.ts` (modify)

**What to Build:**
```typescript
private buildSubtaskPrompt(
  subtask: Subtask,
  section: BvsSection,
  previousResults: SubtaskResult[]
): string {
  return `You are working on: ${section.name}

## This Subtask
${subtask.name}

Files to work on:
${subtask.files.map(f => `- ${f.path} (${f.action})`).join('\n')}

## Previous Subtasks Completed
${previousResults.map(r => `✓ ${r.subtask.name} - ${r.files.length} files changed`).join('\n')}

## Section Context
${section.description}

Success criteria for this subtask:
${this.generateSubtaskCriteria(subtask)}

IMPORTANT: Focus ONLY on the files listed above. Do not modify other files.
After implementing, verify your changes work before completing.`
}
```

**Success Criteria:**
- ✅ Includes subtask context
- ✅ Lists previous completions
- ✅ Constrains scope to subtask files

---

### RALPH-005: Implement Progressive Feedback ⭐ CRITICAL
**Priority:** High | **Effort:** 3 hours | **Depends on:** RALPH-003

**Files:**
- `src/main/services/bvs-worker-agent-service.ts` (modify)

**What to Build:**
```typescript
private async verifySubtask(result: SubtaskResult): Promise<VerificationResult> {
  const modifiedFiles = result.files.map(f => f.path)

  const checks = await Promise.all([
    this.runTypeCheckOnFiles(modifiedFiles),
    this.runLintOnFiles(modifiedFiles)
  ])

  return {
    passed: checks.every(c => c.passed),
    failures: checks.flatMap(c => c.failures)
  }
}
```

**Success Criteria:**
- ✅ Runs typecheck on modified files
- ✅ Runs lint on modified files
- ✅ Returns verification result
- ✅ Called after each subtask

---

### RALPH-016: Build Execution Config UI
**Priority:** Medium | **Effort:** 6 hours | **Depends on:** RALPH-015

**Files:**
- `src/renderer/components/bvs/BvsExecutionConfig.tsx` (create)

**What to Build:**
React components for:
- `ExecutionModeSelector` - dropdown with 4 modes
- `LimitConfiguration` - inputs for max iterations/cost
- `CostDisplay` - real-time tracking
- `InfoBanner` - first-time guidance

**Success Criteria:**
- ✅ Mode selector works
- ✅ Limits editable
- ✅ First-time users see recommendation
- ✅ Integrates with dashboard

---

### RALPH-017: Build Plan Validation UI
**Priority:** Medium | **Effort:** 4 hours | **Depends on:** RALPH-015

**Files:**
- `src/renderer/components/bvs/BvsPlanValidator.tsx` (create)

**What to Build:**
React components for:
- `ValidationResult` - error/warning display
- `ValidationSummary` - counts by severity
- `ProceedButton` - conditional enabling

**Success Criteria:**
- ✅ Displays errors in red
- ✅ Displays warnings in yellow
- ✅ Groups by section
- ✅ Proceed disabled if errors exist

---

## Level 4: Final Polish (1 section)

### RALPH-006: Implement Subtask Retry Logic
**Priority:** Medium | **Effort:** 2 hours | **Depends on:** RALPH-005

**Files:**
- `src/main/services/bvs-worker-agent-service.ts` (modify)

**What to Build:**
```typescript
private async retrySubtask(
  agent: ClaudeAgent,
  subtask: Subtask,
  verification: VerificationResult
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const retryPrompt = `Previous attempt failed verification:

${verification.failures.join('\n')}

Please fix these issues and try again.`

    const result = await agent.run({ prompt: retryPrompt, tools: WORKER_TOOLS })

    const newVerification = await this.verifySubtask(result)
    if (newVerification.passed) {
      return // Success
    }
  }

  throw new Error('Subtask failed after 3 retry attempts')
}
```

**Success Criteria:**
- ✅ Retries up to 3 times
- ✅ Includes failure details in retry prompt
- ✅ Returns on success
- ✅ Throws on exhaustion

---

## Verification & Testing

After implementing all sections, verify:

1. **TypeScript Compilation**
   ```bash
   cd claude-code-manager && npm run typecheck
   ```

2. **Manual Testing**
   - Create test BVS project
   - Run execution with ATTENDED_SINGLE mode
   - Verify subtask splitting works
   - Verify cost tracking displays
   - Verify session limits trigger

3. **Integration Testing**
   - Test full execution with all 17 sections
   - Verify build verification works
   - Verify plan validation catches errors
   - Verify attended modes pause correctly

---

## Success Metrics

### Before
- Context: Entire section in one 15-turn session
- Output quality: Degrades after turn 10+
- Build errors: Caught at final merge only
- Cost: Unknown per section
- Limits: None (risk of runaway)

### After
- Context: Fresh instance per subtask (5 turns each)
- Output quality: Consistent across all subtasks
- Build errors: Caught at every merge point
- Cost: Real-time tracking with breakdown
- Limits: Configurable with early termination

---

## Next Steps

1. ✅ Plan created and approved
2. ⬜ Start with Level 0 (4 sections in parallel)
3. ⬜ Move to Level 1 after Level 0 complete
4. ⬜ Continue through all 5 levels
5. ⬜ Run verification and testing
6. ⬜ Gather feedback and iterate

---

**Total Estimated Time:** 51 hours (~2 weeks of focused work)
**Critical Path:** 16 hours (can complete in 2-3 days if focused)
**Parallelization:** Up to 6 sections can run simultaneously

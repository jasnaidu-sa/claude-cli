# PRD: Ralph Loop-Inspired BVS Improvements

**Created:** 2026-01-23
**Updated:** 2026-01-23
**Status:** Draft - Revised
**Priority:** High

---

## Executive Summary

Integrate proven Ralph Loop best practices into BVS to improve reliability, reduce token waste, and provide better user experience. Focus on **execution-level improvements** since BVS planning is already superior to basic Ralph Loop.

## Background

**Current BVS Workflow (Already Excellent):**
```
User describes task → BVS Planning Agent V2 (interactive) →
  ↓
Codebase exploration (tools: read_file, list_files, search_code) →
  ↓
Present implementation options →
  ↓
User selects approach →
  ↓
Generate atomic sections (3-5 files max per section) →
  ↓
User approves plan →
  ↓
Write plan.md & plan.json →
  ↓
Parallel execution with merge points
```

**What BVS Already Has (Don't Need to Build):**
- ✅ **Interactive planning** - bvs-planning-agent-v2.ts with codebase exploration
- ✅ **AI-guided section sizing** - "Each section should be 3-5 files max"
- ✅ **Dependency-based parallelization** - Automatic level grouping
- ✅ **Project directory structure** - .bvs/projects/
- ✅ **Quality gates** - typecheck, lint, tests at merge points
- ✅ **Retry mechanism** - Up to 3 attempts per worker
- ✅ **Complexity analysis** - Model selection (Haiku/Sonnet)
- ✅ **Git worktree isolation** - True process isolation
- ✅ **AI conflict resolution** - Sonnet auto-resolves conflicts

**What's Missing (From Ralph Loop Best Practices):**

### Critical Gap: Context Management
**The Core Issue:**
Even BVS's small sections (3-5 files) run in ONE Agent SDK session with up to 15 turns. By turn 10+, context is bloated with all previous attempts, errors, and corrections → output quality degrades.

**Ralph Loop Solution:**
Fresh Claude instance per atomic task = clean context every iteration.

### Other Gaps:
1. **No subtask-level execution** - Sections don't split into smaller units with fresh context
2. **No build verification** - Quality gates missing `npm run build`
3. **No session limits** - No max iterations or cost caps
4. **No attended modes** - Can't practice with single section/level
5. **No progressive feedback** - Quality checks only at merge points
6. **No plan validation** - Sections could violate 3-5 file guidance
7. **No cost tracking** - No token/cost metrics per section

---

## Success Criteria (Binary, Testable)

### Must Have (P0)
1. ✅ Each section executes as subtasks with fresh Agent SDK instance per subtask
2. ✅ Build verification passes after each merge point
3. ✅ Session stops if max iterations reached (configurable)
4. ✅ Session stops if max cost exceeded (configurable)
5. ✅ Each worker logs token usage and cost

### Should Have (P1)
6. ✅ Attended mode requires user approval before each merge point
7. ✅ Quality gates run after each subtask (not just at merge)
8. ✅ Plan validation warns about sections exceeding 300 lines
9. ✅ Progressive feedback loop: subtask → verify → fix → commit

### Nice to Have (P2)
10. ✅ Coverage thresholds configurable per section
11. ✅ Documentation validation in quality gates
12. ✅ Cost estimates shown before execution
13. ✅ Progressive practice UI (single section → level → full auto)

---

## User Stories

### Story 1: Fresh Context Per Subtask (CRITICAL)
**As a** developer using BVS
**I want** each logical subtask within a section to run in a fresh Agent SDK instance
**So that** context doesn't bloat and degrade output quality on complex sections

**Current Problem:**
```typescript
// Section: "User authentication endpoint" (5 files)
// Executes in ONE Agent SDK session with 15 turns:
Turn 1-3: Write endpoint handler → hits error
Turn 4-6: Fix error, add validation → another error
Turn 7-9: Fix validation, add tests → test fails
Turn 10-12: Debug test, fix handler → cascading changes
Turn 13-15: Context is now bloated with ALL previous attempts
```

**Desired Solution:**
```typescript
// Same section, split into subtasks:
Subtask 1: Write endpoint handler (fresh instance, 5 turns max)
  → Commit
Subtask 2: Add input validation (fresh instance, 5 turns max)
  → Commit
Subtask 3: Write unit tests (fresh instance, 5 turns max)
  → Commit
Subtask 4: Write integration test (fresh instance, 5 turns max)
  → Commit
```

**Acceptance Criteria:**
- Worker service identifies logical subtasks from section files
- Each subtask gets fresh Agent SDK instance with lower turn limit (5)
- Each subtask commits independently before next starts
- Context window stays <50% capacity per subtask
- Total turns may increase but output quality improves

---

### Story 2: Prevent Runaway Costs
**As a** developer using BVS
**I want** session-wide iteration and cost limits
**So that** I don't accidentally burn through my Claude API budget

**Acceptance Criteria:**
- User sets `maxIterations` and `maxCostUsd` when starting execution
- Execution stops immediately when either limit is reached
- Clear error message explains which limit was hit
- Partial progress is saved and can be resumed

---

### Story 3: Build Verification
**As a** developer using BVS
**I want** build verification as part of quality gates
**So that** I catch compilation errors before merging to main

**Acceptance Criteria:**
- After each merge point, run `npm run build` (or equivalent)
- If build fails, mark merge point as failed
- Report build errors clearly to user
- Don't proceed to next level if build fails

---

### Story 4: Attended Practice Mode
**As a** first-time BVS user
**I want** to run one section at a time with manual approval
**So that** I can learn how BVS works before running unattended

**Acceptance Criteria:**
- Execution mode dropdown: "Single Section" | "Single Level" | "Full Auto"
- "Single Section" mode pauses after each section completes
- User reviews code changes before approving next section
- UI shows clear "Approve & Continue" button
- Mode persists in user preferences

---

### Story 5: Plan Validation
**As a** developer using BVS
**I want** my plan validated before execution starts
**So that** I catch issues early instead of failing mid-execution

**Acceptance Criteria:**
- Validate sections follow 3-5 file guidance (warning if exceeded)
- Validate success criteria are binary (pass/fail)
- Validate dependencies form a DAG (no cycles)
- Validate files exist for "modify" actions
- Show validation warnings/errors in UI before execution
- User can proceed with warnings (errors block execution)

---

### Story 6: Progressive Feedback Loop
**As a** developer using BVS
**I want** quality checks to run after each subtask
**So that** workers self-correct immediately instead of failing at merge

**Acceptance Criteria:**
- After each subtask, run: typecheck, lint on modified files
- If checks fail, worker retries fix (up to 3 times)
- Only commit subtask when checks pass
- Log all self-corrections for transparency
- Don't wait until merge point to discover issues

---

### Story 7: Cost Tracking & Transparency
**As a** developer using BVS
**I want** to see token usage and cost per section
**So that** I understand which parts of my project are expensive

**Acceptance Criteria:**
- Each worker logs: tokensUsed, modelUsed, costUsd
- Progress UI shows cumulative cost in real-time
- Session summary shows total cost and breakdown by section
- Cost data saved to `.bvs/projects/{id}/execution.json`
- Estimate cost before starting execution

---

## Technical Design

### 1. Fresh Context Per Subtask (P0 - CRITICAL)

**The Core Change:**

**Current Implementation:**
```typescript
// bvs-worker-agent-service.ts
async executeSection(config: WorkerConfig): Promise<WorkerResult> {
  const { section, model, maxTurns } = config

  // ONE Agent SDK instance for entire section
  const agent = new ClaudeAgent({ model, maxTurns: 15 })

  const result = await agent.run({
    prompt: this.buildTaskPrompt(section),
    tools: WORKER_TOOLS
  })

  // All 3-5 files created/modified in one session
  return result
}
```

**Proposed Implementation:**
```typescript
// bvs-worker-agent-service.ts
async executeSection(config: WorkerConfig): Promise<WorkerResult> {
  const { section } = config

  // NEW: Identify logical subtasks from section
  const subtasks = this.identifySubtasks(section)

  console.log(`[Worker] Section has ${subtasks.length} subtasks`)

  const results: SubtaskResult[] = []

  for (const subtask of subtasks) {
    // Fresh Agent SDK instance per subtask (Ralph Loop style)
    const agent = new ClaudeAgent({
      model: this.selectModelForSubtask(subtask),
      maxTurns: 5 // Lower limit per subtask
    })

    console.log(`[Worker] Executing subtask: ${subtask.name}`)

    const result = await agent.run({
      prompt: this.buildSubtaskPrompt(subtask, section, results),
      tools: WORKER_TOOLS
    })

    // Progressive feedback - verify immediately
    const verification = await this.verifySubtask(result)
    if (!verification.passed) {
      await this.retrySubtask(agent, subtask, verification)
    }

    // Commit subtask independently
    await this.commitSubtask(result, subtask)
    results.push(result)

    // Agent instance destroyed here → fresh context for next subtask
  }

  return this.aggregateResults(results)
}
```

**New Methods:**

```typescript
/**
 * Identify logical subtasks from a section
 *
 * Strategy:
 * 1. Group by file purpose (handler, types, tests, config)
 * 2. Group by action (create vs modify)
 * 3. Ensure each subtask is <100 lines of changes
 */
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

  // Group 3: Implementation (handlers, services, components)
  const implFiles = section.files.filter(f =>
    !f.path.includes('test') &&
    !f.path.includes('spec') &&
    !f.path.includes('schema') &&
    !f.path.includes('types')
  )
  if (implFiles.length > 0) {
    // Split large implementations further
    if (implFiles.length > 2 || this.estimateLines(implFiles) > 150) {
      // One subtask per implementation file
      for (const file of implFiles) {
        subtasks.push({
          id: `${section.id}-impl-${path.basename(file.path, path.extname(file.path))}`,
          name: `Implement ${path.basename(file.path)}`,
          files: [file],
          estimatedLines: this.estimateLines([file])
        })
      }
    } else {
      // Small implementation - one subtask
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
    f.path.includes('test') ||
    f.path.includes('spec')
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

/**
 * Build prompt for a subtask with context from previous subtasks
 */
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

/**
 * Verify a subtask immediately after execution
 */
private async verifySubtask(result: SubtaskResult): Promise<VerificationResult> {
  const modifiedFiles = result.files.map(f => f.path)

  // Run quality checks on modified files only
  const checks = await Promise.all([
    this.runTypeCheckOnFiles(modifiedFiles),
    this.runLintOnFiles(modifiedFiles)
  ])

  return {
    passed: checks.every(c => c.passed),
    failures: checks.flatMap(c => c.failures)
  }
}

/**
 * Commit a subtask independently
 */
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

**Interface Additions:**

```typescript
// bvs-worker-agent-service.ts

export interface Subtask {
  id: string                    // e.g., "AUTH-001-schema", "AUTH-001-impl"
  name: string                  // Human-readable name
  files: BvsFile[]              // Files for this subtask
  estimatedLines: number        // Rough estimate of changes
  dependencies?: string[]       // Other subtask IDs (within same section)
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
```

---

### 2. Build Verification (P0)

**File:** `bvs-quality-gate-service.ts`

```typescript
export interface QualityGateConfig {
  typecheck: boolean
  lint: boolean
  tests: boolean
  build: boolean        // NEW
  coverage?: number     // NEW (optional threshold)
}

export async function runQualityGates(
  projectPath: string,
  config: QualityGateConfig
): Promise<QualityGateResult> {
  const results: QualityCheck[] = []

  if (config.typecheck) {
    results.push(await runTypeCheck(projectPath))
  }

  if (config.lint) {
    results.push(await runLint(projectPath))
  }

  if (config.tests) {
    results.push(await runTests(projectPath, config.coverage))
  }

  // NEW: Build verification
  if (config.build) {
    results.push(await runBuild(projectPath))
  }

  return {
    passed: results.every(r => r.passed),
    checks: results,
    timestamp: Date.now()
  }
}

async function runBuild(projectPath: string): Promise<QualityCheck> {
  console.log('[QualityGate] Running build verification...')

  // Detect build command from package.json
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

async function detectBuildCommand(projectPath: string): Promise<string> {
  const pkgPath = path.join(projectPath, 'package.json')
  const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'))

  // Common build script names
  const buildScripts = ['build', 'compile', 'tsc', 'build:prod']

  for (const script of buildScripts) {
    if (pkg.scripts?.[script]) {
      return script
    }
  }

  throw new Error('No build script found in package.json')
}
```

---

### 3. Session Limits (P0)

**File:** `bvs-types.ts`

```typescript
export interface BvsExecutionLimits {
  maxIterationsPerWorker: number  // Based on complexity (default: 20)
  maxTotalIterations: number      // Global safety net (default: 100)
  maxCostPerWorker: number        // Token budget per worker (default: $0.50)
  maxTotalCost: number            // Session budget (default: $5.00)
}

export const DEFAULT_LIMITS: BvsExecutionLimits = {
  maxIterationsPerWorker: 20,
  maxTotalIterations: 100,
  maxCostPerWorker: 0.50,
  maxTotalCost: 5.00
}
```

**File:** `bvs-orchestrator-service.ts`

```typescript
export class BvsOrchestrator {
  async executeWithMergePoints(
    sessionId: string,
    limits: BvsExecutionLimits = DEFAULT_LIMITS
  ): Promise<BvsSessionResult> {
    const session = this.getSession(sessionId)
    let totalIterations = 0
    let totalCost = 0

    for (const level of session.plan.levels) {
      // Check global limits BEFORE starting level
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

      // Execute workers for this level
      const workers = await this.executeWorkersForLevel(level, limits)

      // Aggregate metrics
      for (const worker of workers) {
        totalIterations += worker.metrics.iterations
        totalCost += worker.metrics.costUsd
      }

      // Update UI with progress
      this.emit('progress', {
        level: level.groupId,
        totalIterations,
        totalCost,
        remainingIterations: limits.maxTotalIterations - totalIterations,
        remainingBudget: limits.maxTotalCost - totalCost
      })
    }

    return {
      success: true,
      totalIterations,
      totalCost,
      completedAt: Date.now()
    }
  }
}

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

---

### 4. Attended Execution Modes (P1)

**File:** `bvs-types.ts`

```typescript
export enum BvsExecutionMode {
  ATTENDED_SINGLE = 'attended-single',   // Pause after each section
  ATTENDED_LEVEL = 'attended-level',     // Pause after each level
  SEMI_ATTENDED = 'semi-attended',       // Pause at merge points
  UNATTENDED = 'unattended'              // Full automation
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
```

**File:** `bvs-orchestrator-service.ts`

```typescript
async executeWithMergePoints(
  sessionId: string,
  config: BvsExecutionConfig
): Promise<BvsSessionResult> {
  // ... existing code ...

  for (const level of session.plan.levels) {
    const workers = await this.executeWorkersForLevel(level, config.limits)

    // ATTENDED MODE: Pause and wait for approval
    if (config.mode === BvsExecutionMode.ATTENDED_LEVEL) {
      await this.waitForUserApproval(sessionId, level)
    }

    if (config.mode === BvsExecutionMode.ATTENDED_SINGLE) {
      for (const worker of workers) {
        await this.waitForUserApproval(sessionId, worker)
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

**UI Component:**

```tsx
// BvsExecutionDashboard.tsx
function ExecutionModeSelector() {
  const isFirstTime = userStore.bvsSessionCount === 0

  return (
    <div>
      <Select defaultValue={isFirstTime ? 'attended-single' : 'unattended'}>
        <option value="attended-single">
          Single Section {isFirstTime && '(Recommended)'}
        </option>
        <option value="attended-level">
          Single Level
        </option>
        <option value="semi-attended">
          Pause at Merge Points
        </option>
        <option value="unattended">
          Full Auto
        </option>
      </Select>

      {isFirstTime && (
        <InfoBanner>
          First time? We recommend "Single Section" mode to learn how BVS works.
        </InfoBanner>
      )}
    </div>
  )
}
```

---

### 5. Plan Validation (P1)

**File:** `bvs-plan-validator-service.ts` (NEW)

```typescript
export interface PlanValidationResult {
  passed: boolean
  errors: ValidationError[]
  warnings: ValidationWarning[]
}

export interface ValidationError {
  sectionId?: string
  message: string
  severity: 'error'
}

export interface ValidationWarning {
  sectionId?: string
  message: string
  severity: 'warning'
}

export async function validatePlan(
  projectPath: string,
  plan: BvsExecutionPlan
): Promise<PlanValidationResult> {
  const errors: ValidationError[] = []
  const warnings: ValidationWarning[] = []

  // 1. Section file count (3-5 recommended)
  for (const section of plan.sections) {
    if (section.files.length === 0) {
      errors.push({
        sectionId: section.id,
        message: 'Section has no files',
        severity: 'error'
      })
    }

    if (section.files.length > 5) {
      warnings.push({
        sectionId: section.id,
        message: `Section has ${section.files.length} files (recommended: 3-5). Consider splitting into smaller sections.`,
        severity: 'warning'
      })
    }
  }

  // 2. Success criteria are binary
  for (const section of plan.sections) {
    if (!section.successCriteria || section.successCriteria.length === 0) {
      errors.push({
        sectionId: section.id,
        message: 'Missing success criteria',
        severity: 'error'
      })
    }

    for (const criterion of section.successCriteria || []) {
      if (!isBinaryCriterion(criterion)) {
        warnings.push({
          sectionId: section.id,
          message: `Criterion may not be binary: "${criterion}"`,
          severity: 'warning'
        })
      }
    }
  }

  // 3. Dependencies form DAG (no cycles)
  const cycles = detectDependencyCycles(plan.sections)
  if (cycles.length > 0) {
    errors.push({
      message: `Dependency cycles detected: ${cycles.map(c => c.join(' → ')).join(', ')}`,
      severity: 'error'
    })
  }

  // 4. Files exist for "modify" actions
  for (const section of plan.sections) {
    for (const file of section.files) {
      if (file.action === 'modify') {
        const exists = await fileExists(path.join(projectPath, file.path))
        if (!exists) {
          errors.push({
            sectionId: section.id,
            message: `File marked for modification does not exist: ${file.path}`,
            severity: 'error'
          })
        }
      }
    }
  }

  return {
    passed: errors.length === 0,
    errors,
    warnings
  }
}

function isBinaryCriterion(criterion: string): boolean {
  const binaryPatterns = [
    /all .* pass/i,
    /tests? pass/i,
    /build succeeds/i,
    /no (errors?|warnings?)/i,
    /coverage >=? \d+%/i,
    /compiles? (successfully|without errors?)/i
  ]

  return binaryPatterns.some(pattern => pattern.test(criterion))
}

function detectDependencyCycles(sections: BvsSection[]): string[][] {
  const cycles: string[][] = []
  const visited = new Set<string>()
  const recursionStack = new Set<string>()

  function dfs(sectionId: string, path: string[]): void {
    if (recursionStack.has(sectionId)) {
      // Found a cycle
      const cycleStart = path.indexOf(sectionId)
      cycles.push([...path.slice(cycleStart), sectionId])
      return
    }

    if (visited.has(sectionId)) return

    visited.add(sectionId)
    recursionStack.add(sectionId)

    const section = sections.find(s => s.id === sectionId)
    if (section) {
      for (const dep of section.dependencies) {
        dfs(dep, [...path, sectionId])
      }
    }

    recursionStack.delete(sectionId)
  }

  for (const section of sections) {
    dfs(section.id, [])
  }

  return cycles
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}
```

---

### 6. Cost Tracking (P1)

**File:** `bvs-types.ts`

```typescript
export interface BvsWorkerMetrics {
  workerId: BvsWorkerId
  sectionId: string
  iterations: number
  tokensUsed: number
  modelUsed: string
  costUsd: number
  timeElapsed: number
  startedAt: number
  completedAt: number
  subtasks: SubtaskMetrics[]  // NEW: Per-subtask breakdown
}

export interface SubtaskMetrics {
  subtaskId: string
  name: string
  iterations: number
  tokensUsed: number
  costUsd: number
  timeElapsed: number
}

export interface BvsSessionMetrics {
  sessionId: string
  totalIterations: number
  totalTokens: number
  totalCostUsd: number
  workerMetrics: BvsWorkerMetrics[]
  qualityGateResults: QualityGateResult[]
}
```

**File:** `bvs-worker-agent-service.ts`

```typescript
async executeSection(config: WorkerConfig): Promise<WorkerResult> {
  const startTime = Date.now()
  const subtaskMetrics: SubtaskMetrics[] = []

  const subtasks = this.identifySubtasks(config.section)

  for (const subtask of subtasks) {
    const subtaskStart = Date.now()
    let subtaskTokens = 0
    let subtaskIterations = 0

    const agent = new ClaudeAgent({
      model: this.selectModelForSubtask(subtask),
      onTokenUsage: (usage) => {
        subtaskTokens += usage.input_tokens + usage.output_tokens
        subtaskIterations++
      }
    })

    await agent.run(this.buildSubtaskPrompt(subtask))

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

  const totalTokens = subtaskMetrics.reduce((sum, m) => sum + m.tokensUsed, 0)
  const totalCost = subtaskMetrics.reduce((sum, m) => sum + m.costUsd, 0)

  return {
    success: true,
    metrics: {
      workerId: config.workerId,
      sectionId: config.sectionId,
      iterations: subtaskMetrics.reduce((sum, m) => sum + m.iterations, 0),
      tokensUsed: totalTokens,
      modelUsed: config.model,
      costUsd: totalCost,
      timeElapsed: Date.now() - startTime,
      startedAt: startTime,
      completedAt: Date.now(),
      subtasks: subtaskMetrics
    }
  }
}

function calculateCost(tokens: number, model: string): number {
  // Pricing as of 2026-01
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
```

---

## Implementation Plan

### Phase 1: Context Management & Safety (Week 1)
**Priority: P0 - Core improvements**

**Story 1: Fresh Context Per Subtask**
- Task 1.1: Implement `identifySubtasks()` method
  - Files: `bvs-worker-agent-service.ts`
  - Effort: 4 hours
  - Success: Sections split into logical subtasks

- Task 1.2: Implement subtask execution loop
  - Files: `bvs-worker-agent-service.ts`
  - Effort: 6 hours
  - Success: Each subtask gets fresh Agent SDK instance

- Task 1.3: Implement progressive feedback per subtask
  - Files: `bvs-worker-agent-service.ts`
  - Effort: 3 hours
  - Success: Quality checks run after each subtask

**Story 2: Session Limits**
- Task 1.4: Add session limit types and defaults
  - Files: `bvs-types.ts`
  - Effort: 1 hour

- Task 1.5: Implement limit checking in orchestrator
  - Files: `bvs-orchestrator-service.ts`
  - Effort: 3 hours
  - Success: Execution stops at max iterations/cost

**Story 3: Build Verification**
- Task 1.6: Add build verification to quality gates
  - Files: `bvs-quality-gate-service.ts`
  - Effort: 2 hours
  - Success: Build runs after each merge point

**Total Phase 1: 19 hours**

---

### Phase 2: Transparency & UX (Week 2)
**Priority: P1 - User experience**

**Story 7: Cost Tracking**
- Task 2.1: Add cost tracking to worker metrics
  - Files: `bvs-worker-agent-service.ts`, `bvs-types.ts`
  - Effort: 3 hours
  - Success: Each worker logs tokens and cost

- Task 2.2: Display cost in UI
  - Files: UI components
  - Effort: 3 hours
  - Success: Real-time cost display

**Story 4: Attended Modes**
- Task 2.3: Implement execution modes
  - Files: `bvs-orchestrator-service.ts`, `bvs-types.ts`
  - Effort: 4 hours

- Task 2.4: Build mode selector UI
  - Files: UI components
  - Effort: 3 hours
  - Success: Single section/level/full auto modes work

**Story 5: Plan Validation**
- Task 2.5: Create plan validator service
  - Files: `bvs-plan-validator-service.ts` (new)
  - Effort: 5 hours
  - Success: Plans validated before execution

- Task 2.6: Display validation results in UI
  - Files: UI components
  - Effort: 2 hours

**Total Phase 2: 20 hours**

---

### Phase 3: Polish (Week 3)
**Priority: P2 - Nice to have**

- Task 3.1: Coverage thresholds
  - Files: `bvs-quality-gate-service.ts`
  - Effort: 2 hours

- Task 3.2: Documentation validation
  - Files: `bvs-quality-gate-service.ts`
  - Effort: 3 hours

- Task 3.3: Cost estimation UI
  - Files: UI components
  - Effort: 3 hours

- Task 3.4: Progressive practice onboarding
  - Files: UI components
  - Effort: 4 hours

**Total Phase 3: 12 hours**

**Grand Total: 51 hours (~2 weeks of focused work)**

---

## Metrics for Success

### Before (Current BVS)
- Context management: Entire section in one Agent session (15 turns)
- Output quality: Degrades after turn 10+ due to context bloat
- Build verification: Only at final merge (catch errors late)
- Cost tracking: None (unknown spend per section)
- Session limits: None (risk of runaway costs)
- First-time UX: Jump straight to full automation

### After (With Ralph Loop Improvements)
- Context management: Fresh instance per subtask (5 turns each)
- Output quality: Consistent across all subtasks
- Build verification: Every merge point (catch errors early)
- Cost tracking: Real-time display with per-section breakdown
- Session limits: Max 100 iterations, $5 cost (configurable)
- First-time UX: Attended mode with progressive practice

---

## Risks & Mitigations

### Risk 1: Subtask overhead increases total turns
**Impact:** More Agent SDK calls = higher cost
**Mitigation:**
- Only split sections with >3 files
- Lower turn limit per subtask (5 vs 15) offsets increase
- Better output quality reduces retries

### Risk 2: Subtask identification is naive
**Impact:** Poor grouping leads to dependencies between subtasks
**Mitigation:**
- Start with simple file-purpose heuristics
- Iterate based on real usage patterns
- Allow user to adjust subtask boundaries in UI

### Risk 3: Plan validation is too strict
**Impact:** Blocks valid plans that violate guidelines
**Mitigation:**
- Separate errors (blocking) from warnings (informational)
- Let users proceed with warnings
- Make all validation configurable

### Risk 4: Attended mode disrupts flow
**Impact:** Users find manual approvals annoying
**Mitigation:**
- Make it opt-in (default to semi-attended)
- Only recommend for first-time users
- Persist preference to avoid re-asking

---

## Open Questions

1. **Should subtask splitting be mandatory or optional?**
   - **Recommendation:** Mandatory for sections >3 files, optional for smaller sections

2. **What should default session limits be?**
   - **Recommendation:** 100 iterations, $5 cost (configurable in UI)

3. **How granular should cost tracking be?**
   - **Recommendation:** Per-subtask minimum, with session rollup

4. **Should build verification be mandatory?**
   - **Recommendation:** Optional but enabled by default

---

## Comparison: BVS vs Ralph Loop

| Feature | Ralph Loop | BVS Current | BVS After This PRD |
|---------|-----------|-------------|---------------------|
| **Planning** | Manual PRD | ✅ AI-driven interactive | ✅ AI-driven interactive |
| **Section sizing** | Manual | ✅ 3-5 files guidance | ✅ 3-5 files + validation |
| **Fresh context** | ✅ Per task | ❌ Per section | ✅ Per subtask |
| **Build verification** | ✅ Yes | ❌ No | ✅ Yes |
| **Session limits** | ✅ --max-iterations | ❌ No | ✅ Yes (iter + cost) |
| **Cost tracking** | Manual | ❌ No | ✅ Real-time |
| **Attended mode** | ✅ Default | ❌ No | ✅ Yes (3 modes) |
| **Plan validation** | Manual | ❌ No | ✅ Automated |
| **Parallel execution** | ❌ Sequential | ✅ Parallel | ✅ Parallel |
| **AI conflict resolution** | ❌ Manual | ✅ Automated | ✅ Automated |
| **Progressive feedback** | ✅ After each task | ❌ At merge only | ✅ After each subtask |

**Summary:** BVS will combine the best of both - Ralph Loop's context management + BVS's parallel execution and planning.

---

## Next Steps

1. ✅ Review and approve this PRD
2. ⬜ Use BVS Planning Agent to convert PRD to executable plan
3. ⬜ Start Phase 1 (Context Management & Safety)
4. ⬜ Gather user feedback after Phase 1
5. ⬜ Iterate based on real-world usage

---

**PRD Author:** Claude Sonnet 4.5
**Reviewed By:** [Pending]
**Created:** 2026-01-23
**Last Updated:** 2026-01-23 (Revised - Focus on subtask-level execution)

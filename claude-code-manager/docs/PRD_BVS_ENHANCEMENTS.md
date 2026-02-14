# PRD: BVS (Bounded Verified Sections) Enhancements

**Version:** 1.0
**Date:** 2026-02-01
**Author:** Claude Code Manager Team
**Status:** Draft

---

## 1. Executive Summary

This PRD outlines enhancements to the BVS (Bounded Verified Sections) system to address gaps identified in the current implementation. The primary focus is implementing the **subagent spawning capability** that enables specialized agents for code review, architecture diagnosis, and intelligent retry - transforming placeholder implementations into functional features.

### Goals
- Enable real code review with specialized reviewer agents
- Implement smart retry with architect-based failure diagnosis
- Apply captured learnings to improve future runs
- Integrate E2E testing into the execution flow
- Enable true parallel execution with git worktrees

### Success Metrics
- Code review catches 80%+ of issues before manual review
- Retry success rate increases from ~30% to ~70% with architect diagnosis
- 20% reduction in total execution time through parallel workers
- Learning system reduces model selection errors by 50%

---

## 2. Problem Statement

### Current Gaps

| Feature | Current State | Impact |
|---------|--------------|--------|
| Code Review | Returns mock empty results | Zero automated quality feedback |
| Retry Logic | Blind retry with same approach | Repeated failures, wasted tokens |
| Learning | Captures but never applies | No improvement over time |
| E2E Testing | Service exists, not integrated | UI bugs slip through |
| Parallel | Infrastructure ready, disabled | Slower execution than possible |

### Root Cause
The BVS system lacks a **subagent spawning mechanism** - the ability to spawn specialized agents for specific tasks like reviewing, diagnosing, or fixing. This single capability unlocks all the placeholder features.

---

## 3. Requirements

### 3.1 Subagent Service (Foundation)

**Priority:** P0 - Critical
**Effort:** Large

#### Description
Create a `BvsSubagentService` that can spawn specialized agents using the Agent SDK. This is the foundation for all other enhancements.

#### Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| SUB-001 | Spawn single agent with type, prompt, and file context | Must |
| SUB-002 | Spawn multiple agents in parallel | Must |
| SUB-003 | Support background execution with output streaming | Must |
| SUB-004 | Track agent cost and token usage | Must |
| SUB-005 | Cancel running agents | Should |
| SUB-006 | Agent timeout with graceful termination | Should |
| SUB-007 | Agent result caching for repeated queries | Could |

#### Agent Types

| Type | Variant | Purpose |
|------|---------|---------|
| `reviewer` | correctness | Bugs, logic errors, security |
| `reviewer` | typescript | Type safety, generics |
| `reviewer` | conventions | Naming, patterns, structure |
| `reviewer` | simplicity | DRY, readability, complexity |
| `reviewer` | security | OWASP Top 10, secrets |
| `reviewer` | performance | N+1, memory, bundle size |
| `architect` | - | Failure diagnosis, approach design |
| `fixer` | - | Apply specific fixes |
| `tester` | - | Generate test cases |

#### Technical Design

```typescript
// bvs-subagent-service.ts
export interface SubagentConfig {
  type: 'reviewer' | 'architect' | 'fixer' | 'tester'
  variant?: string
  prompt: string
  files?: string[]
  model?: 'haiku' | 'sonnet' | 'auto'
  maxTurns?: number
  timeout?: number
  runInBackground?: boolean
}

export interface SubagentResult {
  agentId: string
  type: string
  variant?: string
  status: 'completed' | 'failed' | 'timeout' | 'cancelled'
  output: string
  structuredOutput?: Record<string, unknown>
  cost: number
  tokensUsed: { input: number; output: number }
  duration: number
  error?: string
}

export class BvsSubagentService extends EventEmitter {
  async spawn(config: SubagentConfig): Promise<SubagentResult>
  async spawnParallel(configs: SubagentConfig[]): Promise<SubagentResult[]>
  async cancel(agentId: string): Promise<void>
  getActiveAgents(): string[]
}
```

#### Acceptance Criteria
- [ ] Can spawn a reviewer agent that returns structured issues
- [ ] Can spawn 4 reviewer agents in parallel
- [ ] Agent output streams to UI in real-time
- [ ] Cost tracking accurate within 5%
- [ ] Timeout terminates agent cleanly

---

### 3.2 Code Review Integration

**Priority:** P0 - Critical
**Effort:** Medium
**Depends on:** SUB-001, SUB-002

#### Description
Wire up the existing `BvsCodeReviewService` to use real subagents instead of returning mock results.

#### Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| REV-001 | Run all configured reviewers after section completion | Must |
| REV-002 | Parse structured output from reviewer agents | Must |
| REV-003 | Block on P0/P1 issues (configurable) | Must |
| REV-004 | Log P2 issues to review-notes.md | Must |
| REV-005 | Display issues in section detail panel | Must |
| REV-006 | One-click fix for simple issues | Should |
| REV-007 | Aggregate issues across all reviewers | Should |
| REV-008 | Skip review for trivial changes (<10 lines) | Could |

#### Reviewer System Prompts

Each reviewer agent receives a specialized system prompt:

**Correctness Reviewer:**
```
You are a code correctness reviewer. Analyze the provided files for:
- Logic errors and bugs
- Unhandled edge cases (null, empty, boundary conditions)
- Race conditions and async issues
- Security vulnerabilities (injection, XSS, auth bypass)
- Error handling gaps

Output format (JSON):
{
  "issues": [
    {
      "priority": "P0|P1|P2",
      "file": "path/to/file.ts",
      "line": 42,
      "message": "Description of issue",
      "suggestion": "How to fix it",
      "category": "bug|edge-case|security|async|error-handling"
    }
  ],
  "summary": "Brief overall assessment"
}
```

#### UI Integration

```
┌─────────────────────────────────────────────────┐
│ Section: S3 - API Routes                        │
├─────────────────────────────────────────────────┤
│ Status: Review In Progress                      │
│                                                 │
│ Reviewers:                                      │
│ ✓ Correctness    2 issues (0 P0, 1 P1, 1 P2)   │
│ ◐ TypeScript     Running...                    │
│ ○ Conventions    Pending                        │
│ ○ Security       Pending                        │
│                                                 │
│ [View Issues] [Skip Review] [Re-run]           │
└─────────────────────────────────────────────────┘
```

#### Acceptance Criteria
- [ ] All 6 reviewer types produce real output
- [ ] P0 issues block section completion
- [ ] Issues display with file:line links
- [ ] Review takes <60s for typical section (5-10 files)
- [ ] Parallel reviewers complete faster than sequential

---

### 3.3 Smart Retry with Architect Diagnosis

**Priority:** P0 - Critical
**Effort:** Medium
**Depends on:** SUB-001

#### Description
Before retrying a failed section, spawn an architect agent to diagnose the root cause and suggest a different approach. Include this diagnosis in the retry prompt.

#### Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| RET-001 | Spawn architect agent on retry request | Must |
| RET-002 | Pass previous error and output to architect | Must |
| RET-003 | Include diagnosis in worker retry prompt | Must |
| RET-004 | Track diagnosis effectiveness (retry success rate) | Should |
| RET-005 | Allow user to edit diagnosis before retry | Should |
| RET-006 | Skip diagnosis for simple errors (file not found, etc.) | Could |

#### Architect System Prompt

```
You are an architect agent diagnosing a failed code generation task.

FAILED SECTION: {section.name}
DESCRIPTION: {section.description}
SUCCESS CRITERIA: {section.successCriteria}

PREVIOUS ATTEMPT:
- Error: {section.lastError}
- Output: {section.workerOutput (last 2000 chars)}
- Files Changed: {section.filesChanged}
- Turns Used: {section.turnsUsed}/{section.maxTurns}

DIAGNOSIS TASK:
1. Identify the ROOT CAUSE of the failure
2. Determine if this is a:
   - Approach problem (wrong strategy)
   - Implementation problem (right strategy, wrong execution)
   - Environment problem (missing deps, permissions, etc.)
   - Specification problem (unclear requirements)
3. Suggest a DIFFERENT approach that avoids the same failure
4. Identify any files the worker should read first

Output format (JSON):
{
  "rootCause": "Brief description of why it failed",
  "failureType": "approach|implementation|environment|specification",
  "diagnosis": "Detailed analysis...",
  "suggestedApproach": "What the worker should do differently...",
  "filesToReadFirst": ["path/to/file.ts"],
  "warningsForWorker": ["Don't use X because...", "Make sure to Y..."]
}
```

#### Worker Retry Prompt Enhancement

```
RETRY CONTEXT (Attempt {retryCount + 1}):

Previous attempt failed. An architect agent has analyzed the failure:

ROOT CAUSE: {diagnosis.rootCause}
FAILURE TYPE: {diagnosis.failureType}

SUGGESTED APPROACH:
{diagnosis.suggestedApproach}

FILES TO READ FIRST:
{diagnosis.filesToReadFirst}

WARNINGS:
{diagnosis.warningsForWorker}

DO NOT repeat the same approach. Use the architect's guidance.
```

#### Acceptance Criteria
- [ ] Architect diagnosis completes in <30s
- [ ] Retry success rate improves by 40%+ (measured)
- [ ] Diagnosis visible in section detail panel
- [ ] User can edit diagnosis before retry
- [ ] Diagnosis skipped for obvious errors

---

### 3.4 Learning Application

**Priority:** P1 - High
**Effort:** Medium
**Depends on:** None (enhances existing service)

#### Description
The learning capture service already records learnings from limit violations. This enhancement applies those learnings to improve future planning and execution.

#### Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| LRN-001 | Load relevant learnings at planning start | Must |
| LRN-002 | Inject learnings into planning system prompt | Must |
| LRN-003 | Adjust complexity scores based on historical data | Must |
| LRN-004 | Warn user when similar patterns caused failures | Should |
| LRN-005 | Track learning effectiveness (which learnings helped) | Should |
| LRN-006 | Cross-project learning (same patterns across projects) | Could |
| LRN-007 | Learning decay (older learnings less weight) | Could |

#### Learning Categories

| Category | Application |
|----------|-------------|
| `cost_overrun` | Increase turn estimates for similar sections |
| `iteration_overrun` | Suggest section splitting |
| `model_selection` | Override auto model selection |
| `file_grouping` | Suggest different file groupings |
| `retry_pattern` | Pre-populate architect warnings |

#### Integration Points

**Planning Phase:**
```typescript
// In processMessage()
const learnings = await this.learningService.getRelevantLearnings({
  projectPath: session.projectPath,
  sectionPatterns: this.extractPatterns(sections),
  limit: 10
})

const learningPrompt = learnings.length > 0 ? `
HISTORICAL LEARNINGS (apply to your planning):
${learnings.map(l => `- [${l.category}] ${l.recommendation}`).join('\n')}

Adjust your section estimates and approaches based on these learnings.
` : ''
```

**Complexity Analysis:**
```typescript
// In analyzeComplexity()
const historicalData = await this.learningService.getComplexityHistory({
  filePatterns: section.files.map(f => f.path),
  limit: 5
})

if (historicalData.avgActualTurns > estimatedTurns * 1.5) {
  // Historical data shows we underestimate this pattern
  adjustedTurns = Math.ceil(historicalData.avgActualTurns * 1.1)
}
```

#### Acceptance Criteria
- [ ] Learnings loaded within 100ms at planning start
- [ ] Relevant learnings appear in planning UI
- [ ] Complexity estimates improve over time (measured)
- [ ] User can dismiss/ignore specific learnings
- [ ] Learning database stays under 10MB

---

### 3.5 E2E Testing Integration

**Priority:** P1 - High
**Effort:** Medium
**Depends on:** None (service exists)

#### Description
Integrate the existing `BvsE2ETestingService` into the execution flow. Run E2E tests automatically for sections that modify UI components.

#### Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| E2E-001 | Auto-detect UI sections (components, pages, styles) | Must |
| E2E-002 | Run E2E tests after section completion | Must |
| E2E-003 | Capture screenshots on failure | Must |
| E2E-004 | Display E2E results in section detail panel | Must |
| E2E-005 | Allow manual E2E URL override in section config | Should |
| E2E-006 | Generate E2E tests from success criteria | Should |
| E2E-007 | Visual regression detection | Could |

#### Section Detection Heuristics

```typescript
function shouldRunE2E(section: BvsSection): boolean {
  const uiPatterns = [
    /components?\//i,
    /pages?\//i,
    /views?\//i,
    /\.tsx$/,
    /\.css$/,
    /\.scss$/,
    /styles?\//i
  ]

  return section.files.some(f =>
    uiPatterns.some(p => p.test(f.path))
  )
}
```

#### E2E Test Configuration

```typescript
// In section definition (plan.json)
{
  "id": "S4",
  "name": "Budget Dashboard",
  "e2e": {
    "enabled": true,
    "url": "http://localhost:3000/budgets",
    "waitFor": ".budget-table",
    "assertions": [
      { "type": "visible", "selector": ".budget-header" },
      { "type": "count", "selector": ".budget-row", "min": 1 },
      { "type": "text", "selector": ".total-amount", "contains": "$" }
    ],
    "interactions": [
      { "action": "click", "selector": ".add-budget-btn" },
      { "action": "type", "selector": "#budget-name", "text": "Test Budget" },
      { "action": "click", "selector": ".save-btn" }
    ]
  }
}
```

#### UI Display

```
┌─────────────────────────────────────────────────┐
│ E2E Test Results                                │
├─────────────────────────────────────────────────┤
│ URL: http://localhost:3000/budgets              │
│ Status: ✓ Passed (3/3 assertions)               │
│                                                 │
│ Screenshots:                                    │
│ [Before] [After] [Diff]                        │
│                                                 │
│ Interactions:                                   │
│ ✓ Click .add-budget-btn                        │
│ ✓ Type #budget-name                            │
│ ✓ Click .save-btn                              │
│                                                 │
│ Console: No errors                              │
└─────────────────────────────────────────────────┘
```

#### Acceptance Criteria
- [ ] UI sections automatically trigger E2E
- [ ] E2E completes within 60s timeout
- [ ] Screenshots captured and viewable
- [ ] E2E failures block section completion
- [ ] Manual URL override works

---

### 3.6 Parallel Execution with Worktrees

**Priority:** P2 - Medium
**Effort:** Large
**Depends on:** None (infrastructure exists)

#### Description
Enable true parallel execution using git worktrees. Currently disabled due to merge complexity.

#### Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| PAR-001 | Create worktree per parallel worker | Must |
| PAR-002 | Execute sections in parallel (up to maxWorkers) | Must |
| PAR-003 | Merge worktrees at level completion | Must |
| PAR-004 | Detect and report merge conflicts | Must |
| PAR-005 | Auto-resolve simple conflicts with AI | Should |
| PAR-006 | Manual conflict resolution UI | Should |
| PAR-007 | Rollback on merge failure | Should |
| PAR-008 | Worktree cleanup on completion/failure | Must |

#### Merge Strategy

```
Level 0: [S1] [S2] [S3]  ← Execute in parallel (3 worktrees)
              ↓
         MERGE POINT     ← Merge all to main, resolve conflicts
              ↓
Level 1: [S4] [S5]       ← Execute in parallel (2 worktrees)
              ↓
         MERGE POINT     ← Merge, verify integration
              ↓
Level 2: [S6]            ← Final section
              ↓
         COMPLETE
```

#### Conflict Resolution Flow

```typescript
interface MergeConflict {
  file: string
  workerA: string
  workerB: string
  conflictType: 'content' | 'delete-modify' | 'add-add'
  markers: {
    ours: string
    theirs: string
  }
}

async function resolveConflict(conflict: MergeConflict): Promise<string> {
  // 1. Try auto-resolution for simple cases
  if (conflict.conflictType === 'add-add' && isImportOnly(conflict)) {
    return mergeImports(conflict.markers.ours, conflict.markers.theirs)
  }

  // 2. Use AI for complex conflicts
  const resolution = await subagentService.spawn({
    type: 'fixer',
    prompt: `Resolve this merge conflict intelligently:

      File: ${conflict.file}

      Version A (${conflict.workerA}):
      ${conflict.markers.ours}

      Version B (${conflict.workerB}):
      ${conflict.markers.theirs}

      Output ONLY the merged code, no explanations.`
  })

  return resolution.output
}
```

#### Acceptance Criteria
- [ ] 3 workers execute truly in parallel
- [ ] Worktrees created in temp directory
- [ ] Simple conflicts auto-resolved
- [ ] Complex conflicts pause for user input
- [ ] Cleanup happens even on failure
- [ ] 30%+ speedup for projects with parallel sections

---

## 4. Non-Functional Requirements

### 4.1 Performance

| Metric | Target |
|--------|--------|
| Subagent spawn time | <2s |
| Parallel reviewer completion | <90s for 5 reviewers |
| Architect diagnosis | <30s |
| E2E test execution | <60s |
| Learning query | <100ms |

### 4.2 Reliability

| Metric | Target |
|--------|--------|
| Subagent success rate | >95% |
| Merge conflict auto-resolution | >70% |
| E2E test stability | >90% (no flaky tests) |

### 4.3 Cost

| Metric | Target |
|--------|--------|
| Code review cost per section | <$0.50 |
| Architect diagnosis cost | <$0.20 |
| Total overhead per section | <$1.00 |

---

## 5. Implementation Plan

### Phase 1: Foundation (Week 1-2)
- [ ] Create `BvsSubagentService` with spawn/cancel
- [ ] Implement reviewer agent system prompts
- [ ] Wire up `runSingleReviewer()` to use real agents
- [ ] Add subagent UI components

### Phase 2: Quality (Week 3-4)
- [ ] Implement architect diagnosis flow
- [ ] Enhance retry with diagnosis context
- [ ] Integrate E2E testing into execution
- [ ] Add E2E results to section detail panel

### Phase 3: Intelligence (Week 5-6)
- [ ] Implement learning application
- [ ] Add learning UI to planning phase
- [ ] Create learning effectiveness tracking
- [ ] Cross-project learning (optional)

### Phase 4: Performance (Week 7-8)
- [ ] Enable worktree parallel execution
- [ ] Implement merge conflict resolution
- [ ] Add parallel execution UI
- [ ] Performance optimization and testing

---

## 6. Risks and Mitigations

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Subagent costs too high | High | Medium | Implement cost caps, use Haiku for simple reviews |
| Merge conflicts block progress | High | Medium | Good auto-resolution, easy manual override |
| E2E tests flaky | Medium | High | Retry logic, stability filters |
| Learning creates bias | Medium | Low | Decay old learnings, user override |
| Parallel execution race conditions | High | Low | Exclusive file ownership, integration tests |

---

## 7. Success Criteria

### MVP (Phase 1-2)
- [ ] Code review produces real issues
- [ ] Retry with diagnosis improves success rate
- [ ] E2E tests run for UI sections

### Full Release (Phase 3-4)
- [ ] Learning system improves estimates over time
- [ ] Parallel execution provides measurable speedup
- [ ] All metrics meet NFR targets

---

## 8. Appendix

### A. Reviewer Agent Prompts

See `docs/BVS_REVIEWER_PROMPTS.md` (to be created)

### B. Architecture Diagrams

See `docs/BVS_ARCHITECTURE.md` (to be created)

### C. API Specifications

See `docs/BVS_SUBAGENT_API.md` (to be created)

# PRD: Bounded Verified Sections (BVS) Workflow

**Project:** Claude Code Manager - Autonomous Coding Reliability System
**Status:** Planning
**Last Updated:** 2026-01-20
**Version:** 1.5

---

## Executive Summary

Implement a Bounded Verified Sections (BVS) workflow system that ensures reliable autonomous code generation through incremental verification, real-time type checking, and E2E visual testing. The system breaks work into small, verifiable sections with continuous feedback loops to catch errors early and prevent error accumulation.

**Key Innovation:** The main Claude Code agent acts as an intelligent orchestrator, analyzing section dependencies and spawning multiple worker agents in parallel for independent sections. This dramatically reduces execution time while maintaining verification integrity.

---

## Problem Statement

### Current State
- Autonomous coding generates multiple files before any verification
- Type errors compound across files, creating cascading failures
- No visual verification - broken UIs go unnoticed until manual testing
- Convention violations accumulate, requiring large refactors
- Errors discovered late are expensive to fix (context lost, dependencies built)
- No learning mechanism - same mistakes repeated across sessions

### Desired State
- Work broken into bounded sections (3-5 files) with verification gates
- TypeScript errors caught immediately after each edit (Cursor-style)
- E2E visual testing after each section via Claude-in-Chrome
- Conventions enforced continuously with immediate feedback
- Learning system captures patterns and prevents repeat mistakes
- Errors caught early are cheap to fix (context fresh, minimal dependencies)

---

## Goals & Success Metrics

### Primary Goals
1. **Early Error Detection** - Catch 95% of errors within same section they're introduced
2. **Type Safety** - Zero accumulated type errors between sections
3. **Visual Correctness** - UI verified working after each section
4. **Convention Compliance** - 100% adherence to project standards
5. **Continuous Learning** - Patterns extracted and reused across sessions

### Success Metrics
| Metric | Target | Measurement |
|--------|--------|-------------|
| Type Error Escape Rate | <5% | Errors found in later sections / total errors |
| Section Completion Rate | >90% | Sections passing all gates on first attempt |
| E2E Test Coverage | >80% | UI features visually verified |
| Fix Iteration Count | <2 avg | Average fix attempts per section |
| Learning Reuse Rate | >50% | Learnings applied in subsequent sections |

---

## User Stories

### US-0: Task Input - PRD Upload OR Interactive Planning
**As a** user starting a new task
**I want** to either upload a PRD or chat with an agent to define the work
**So that** I can use whichever method suits my current situation

**Acceptance Criteria:**

**Option A: PRD Upload**
- [ ] Can upload PRD as file attachment (md, txt, pdf)
- [ ] Can paste PRD content directly
- [ ] System analyzes PRD structure (features, phases, requirements)
- [ ] Codebase analysis runs to understand existing patterns
- [ ] Generates bounded sections with dependencies
- [ ] User can review and approve plan before execution

**Option B: Interactive Planning Chat**
- [ ] Can start planning chat without a PRD
- [ ] Agent asks clarifying questions about the task
- [ ] Agent explores codebase to understand context
- [ ] Agent proposes features and sections iteratively
- [ ] User can refine and adjust during conversation
- [ ] Final plan generated from chat conversation
- [ ] Same review/approve flow as PRD upload

**Common:**
- [ ] Can modify sections (reorder, split, merge)
- [ ] Plan saved to `.bvs/plan.json` for execution
- [ ] Can switch between modes (start chat, then upload PRD)

### US-1: Incremental TypeScript Verification
**As a** user running autonomous code generation
**I want** type errors caught immediately after each edit
**So that** errors don't compound across multiple files

**Acceptance Criteria:**
- [ ] TypeScript check runs after every Edit/Write operation
- [ ] Uses `tsc --incremental --noEmit` for speed
- [ ] Errors displayed immediately with file:line reference
- [ ] Edit must be fixed before proceeding to next edit
- [ ] Option to run full typecheck at section end

### US-2: Bounded Section Workflow
**As a** user wanting reliable autonomous coding
**I want** work broken into small verified sections
**So that** I can trust each section is correct before building on it

**Acceptance Criteria:**
- [ ] Sections limited to 3-5 related files
- [ ] Each section has defined scope and success criteria
- [ ] Verification gate must pass before next section starts
- [ ] Progress tracked per section with clear status
- [ ] Can resume from any completed section

### US-2.5: Parallel Section Execution
**As a** user wanting fast execution
**I want** independent sections to run in parallel
**So that** total execution time is minimized

**Acceptance Criteria:**
- [ ] Main agent analyzes dependency graph to identify parallel opportunities
- [ ] Independent sections (no shared dependencies) execute simultaneously
- [ ] Each worker agent runs in isolated worktree/context
- [ ] Orchestrator monitors all workers and handles failures
- [ ] Results merged safely after parallel sections complete
- [ ] Verification runs after merge to catch integration issues
- [ ] User can configure max parallel workers (default: 3)
- [ ] Progress UI shows all parallel workers with individual status

### US-3: E2E Visual Verification
**As a** user building UI features
**I want** visual verification after each section
**So that** I catch rendering issues and broken interactions early

**Acceptance Criteria:**
- [ ] Dev server started automatically if not running
- [ ] Claude-in-Chrome navigates to affected pages
- [ ] Screenshots captured for visual verification
- [ ] Console errors detected and reported
- [ ] Interactive elements tested (click, input, navigation)
- [ ] Clear pass/fail with actionable feedback

### US-4: Convention Enforcement
**As a** user maintaining code quality
**I want** conventions checked continuously
**So that** style drift doesn't accumulate

**Acceptance Criteria:**
- [ ] Conventions loaded from `.bvs/conventions.md`
- [ ] Checked after each edit against relevant rules
- [ ] Clear violation messages with rule reference
- [ ] Auto-fix suggestions where possible
- [ ] Can add new conventions during session

### US-5: Learning System
**As a** user running multiple sessions
**I want** patterns and fixes captured for reuse
**So that** the same mistakes aren't repeated

**Acceptance Criteria:**
- [ ] Learnings captured in `.bvs/learnings.md`
- [ ] Includes: problem, solution, prevention rule
- [ ] Learnings loaded at session start
- [ ] Applied as pre-checks before similar code
- [ ] User can edit/remove learnings

### US-6: Quality Gate
**As a** user ensuring code quality
**I want** comprehensive verification at section end
**So that** no issues escape to later sections

**Acceptance Criteria:**
- [ ] Runs: lint, typecheck, unit tests
- [ ] All must pass to proceed
- [ ] Clear error messages with fix guidance
- [ ] Max 3 fix attempts before escalation
- [ ] Can skip with explicit user approval

---

## Feature Breakdown

### Phase 0: Task Input (PRD Upload OR Interactive Planning)

| Feature | Priority | Status | Notes |
|---------|----------|--------|-------|
| **PRD Upload Path** |
| F0.1 - PRD Upload Interface | P0 | **Done** | File upload + paste support - `BvsPlanningChat.tsx` |
| F0.2 - PRD Parser | P0 | **Done** | Extract structure from md/txt/pdf - `bvs-prd-parser-service.ts` |
| **Interactive Planning Path** |
| F0.2b - Planning Chat UI | P0 | **Done** | Chat interface for task definition - `BvsPlanningChat.tsx` |
| F0.2c - Planning Agent | P0 | **Done** | Agent that asks questions, explores codebase - `bvs-planning-agent-service.ts` |
| F0.2d - Iterative Proposal | P0 | **Done** | Agent proposes sections, user refines - `bvs-planning-agent-service.ts` |
| F0.2e - Chat-to-Plan Converter | P0 | **Done** | Convert chat findings to plan.json - `bvs-planning-agent-service.ts` |
| **Common** |
| F0.3 - Codebase Analyzer | P0 | **Done** | Scan existing patterns, conventions - `bvs-planning-agent-service.ts` |
| F0.4 - Section Generator | P0 | **Done** | Break features into bounded sections - `bvs-prd-parser-service.ts` |
| F0.5 - Dependency Resolver | P0 | **Done** | Order sections by dependencies - `bvs-parallel-worker-manager.ts` |
| F0.6 - Plan Review UI | P0 | **Done** | Display, edit, approve plan - `BvsPlanReview.tsx` |
| F0.7 - Plan Persistence | P1 | **Done** | Save to .bvs/plan.json - `bvs-orchestrator-service.ts` |
| F0.8 - Complexity Estimator | P1 | **Done** | Estimate effort per section - `bvs-complexity-risk-service.ts` |
| F0.9 - Risk Assessment | P2 | **Done** | Flag high-risk sections - `bvs-complexity-risk-service.ts` |

### Phase 0.5: Parallel Orchestration System

| Feature | Priority | Status | Notes |
|---------|----------|--------|-------|
| F0.10 - Dependency Graph Builder | P0 | **Done** | Build DAG from section dependencies - `bvs-parallel-worker-manager.ts` |
| F0.11 - Parallel Opportunity Analyzer | P0 | **Done** | Identify sections that can run in parallel - `bvs-parallel-worker-manager.ts` |
| F0.12 - Worker Agent Spawner | P0 | **Done** | Launch Task agents with section context - `bvs-parallel-worker-manager.ts` |
| F0.13 - Worktree Manager | P0 | **Done** | Create isolated git worktrees per worker - `bvs-parallel-worker-manager.ts` |
| F0.14 - Worker Monitor | P0 | **Done** | Track status, handle failures, timeouts - `bvs-parallel-worker-manager.ts` |
| F0.15 - Result Merger | P0 | **Done** | Safely merge parallel worker outputs - `bvs-parallel-worker-manager.ts` |
| F0.16 - Conflict Detector | P1 | **Done** | Detect merge conflicts between workers - `bvs-parallel-worker-manager.ts` |
| F0.17 - Integration Verifier | P1 | **Done** | Run verification after parallel merge - `bvs-parallel-worker-manager.ts` |
| F0.18 - Parallel Progress UI | P1 | **Done** | Multi-worker progress visualization - `BvsParallelProgress.tsx` |

### Phase 1: Core BVS Infrastructure

| Feature | Priority | Status | Notes |
|---------|----------|--------|-------|
| F1.1 - BVS Configuration System | P0 | **Done** | `.bvs/` directory structure - `bvs-orchestrator-service.ts` |
| F1.2 - Section Definition Schema | P0 | **Done** | Section boundaries and success criteria - `bvs-types.ts` |
| F1.3 - Progress Tracking | P0 | **Done** | Section completion state - `bvs-orchestrator-service.ts` |
| F1.4 - Convention File Format | P0 | **Done** | `.bvs/conventions.md` structure - `bvs-orchestrator-service.ts` |
| F1.5 - Learning File Format | P0 | **Done** | `.bvs/learnings.md` structure - `bvs-orchestrator-service.ts` |

### Phase 2: TypeScript Verification Layer

| Feature | Priority | Status | Notes |
|---------|----------|--------|-------|
| F2.1 - Post-Edit TypeCheck Hook | P0 | **Done** | Run tsc after Edit/Write - `bvs-typecheck-service.ts` |
| F2.2 - Incremental Compilation | P0 | **Done** | Use tsc --incremental for speed - `bvs-typecheck-service.ts` |
| F2.3 - Error Parser | P0 | **Done** | Extract file:line:message - `bvs-typecheck-service.ts` |
| F2.4 - Immediate Fix Loop | P0 | **Done** | Block until type error fixed - `bvs-quality-gate-service.ts` |
| F2.5 - Full TypeCheck Gate | P1 | **Done** | Complete check at section end - `bvs-typecheck-service.ts` |

### Phase 3: E2E Testing Integration

| Feature | Priority | Status | Notes |
|---------|----------|--------|-------|
| F3.1 - Dev Server Manager | P0 | **Done** | Start/stop/detect dev server - `bvs-e2e-testing-service.ts` |
| F3.2 - Page Navigation Logic | P0 | **Done** | Map changed files to URLs - `bvs-e2e-testing-service.ts` |
| F3.3 - Screenshot Capture | P0 | **Done** | Visual state recording - `bvs-e2e-testing-service.ts` |
| F3.4 - Console Error Detection | P0 | **Done** | Read browser console - `bvs-e2e-testing-service.ts` |
| F3.5 - Interactive Testing | P1 | **Done** | Click, input, navigate - `bvs-e2e-testing-service.ts` |
| F3.6 - Visual Diff (Future) | P2 | **Done** | Compare screenshots - `bvs-e2e-testing-service.ts` |

### Phase 4: Quality Gate System

| Feature | Priority | Status | Notes |
|---------|----------|--------|-------|
| F4.1 - Lint Runner | P0 | **Done** | npm run lint with parsing - `bvs-quality-gate-service.ts` |
| F4.2 - TypeCheck Runner | P0 | **Done** | Full tsc --noEmit - `bvs-quality-gate-service.ts` |
| F4.3 - Test Runner | P0 | **Done** | npm test with result parsing - `bvs-quality-gate-service.ts` |
| F4.4 - Gate Orchestrator | P0 | **Done** | Run all, report aggregate - `bvs-quality-gate-service.ts` |
| F4.5 - Fix Attempt Tracker | P1 | **Done** | Count attempts, escalate - `bvs-quality-gate-service.ts` |
| F4.6 - Skip with Approval | P2 | **Done** | User override option - `bvs-quality-gate-service.ts` |

### Phase 4.5: Code Review System (Start-Task Agents)

| Feature | Priority | Status | Notes |
|---------|----------|--------|-------|
| F4.7 - Review Agent Spawner | P0 | **Done** | Spawn parallel review agents via Task tool - `bvs-code-review-service.ts` |
| F4.8 - Correctness Reviewer | P0 | **Done** | work-reviewer-correctness agent - `bvs-code-review-service.ts` |
| F4.9 - TypeScript Reviewer | P0 | **Done** | work-reviewer-typescript agent - `bvs-code-review-service.ts` |
| F4.10 - Conventions Reviewer | P0 | **Done** | work-reviewer-conventions agent - `bvs-code-review-service.ts` |
| F4.11 - Simplicity Reviewer | P0 | **Done** | work-reviewer-simplicity agent - `bvs-code-review-service.ts` |
| F4.12 - Review Aggregator | P0 | **Done** | Combine findings, prioritize P0/P1/P2 - `bvs-code-review-service.ts` |
| F4.13 - Auto-Fix Applier | P1 | **Done** | Apply fixes for P0/P1 issues - `bvs-quality-gate-service.ts` |
| F4.14 - Review Notes Logger | P1 | **Done** | Log P2 issues to .bvs/review-notes.md - `bvs-code-review-service.ts` |
| F4.15 - Re-Review Loop | P1 | **Done** | Re-run affected reviewers after fixes - `bvs-quality-gate-service.ts` |

### Phase 5: Learning System

| Feature | Priority | Status | Notes |
|---------|----------|--------|-------|
| F5.1 - Learning Capture | P1 | **Done** | Extract from fix sessions - `bvs-learning-service.ts` |
| F5.2 - Learning Storage | P1 | **Done** | Append to learnings.md - `bvs-learning-service.ts` |
| F5.3 - Learning Loader | P1 | **Done** | Read at session start - `bvs-learning-service.ts` |
| F5.4 - Learning Application | P1 | **Done** | Pre-check before similar code - `bvs-learning-service.ts` |
| F5.5 - Learning Editor UI | P2 | **Done** | View/edit/delete learnings - `BvsLearningBrowser.tsx` |

### Phase 6: UI Components

| Feature | Priority | Status | Notes |
|---------|----------|--------|-------|
| **Kanban Board** |
| F6.1 - BVS Kanban Dashboard | P0 | **Done** | Main 4-column Kanban view - `BvsDashboard.tsx` |
| F6.2 - Section Cards | P0 | **Done** | Medium detail cards with progress - `BvsKanbanBoard.tsx` |
| F6.3 - Worker Color Coding | P0 | **Done** | Distinct colors per parallel worker - `BvsKanbanBoard.tsx` |
| F6.4 - Auto-Card Movement | P0 | **Done** | Cards animate between columns - CSS transitions |
| F6.5 - Progress Animations | P0 | **Done** | Real-time progress bar updates - `BvsKanbanBoard.tsx` |
| **Detail Panel** |
| F6.6 - Slide-Out Detail Panel | P0 | **Done** | Click card to open modal - `SectionDetailModal` |
| F6.7 - Section Logs Viewer | P1 | **Done** | TypeCheck/Lint/Test output - `BvsSectionLogsViewer.tsx` |
| F6.8 - E2E Results Viewer | P1 | **Done** | Screenshots + console output - `BvsE2EResultsViewer.tsx` |
| F6.9 - Error Details View | P1 | **Done** | Full error context + fix suggestions - `SectionDetailModal` |
| **Notifications** |
| F6.10 - Toast Notifications | P1 | **Done** | Completions, failures, warnings - `NotificationToast` |
| F6.11 - Sound Alerts | P2 | **Done** | Optional audio for key events - `BvsSoundAlerts.tsx` |
| **Other** |
| F6.12 - Learning Browser | P2 | **Done** | View accumulated learnings - `BvsLearningBrowser.tsx` |
| F6.13 - Convention Editor | P2 | **Done** | Edit project conventions - `BvsConventionEditor.tsx` |

---

## UI Design Specification

### Overall Layout

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│ BVS Execution: Mobile App Features                    ⏱ 12:34  [⏸ Pause] [⏹ Stop] │
├─────────────────────────────────────────────────────────────────────────────────────┤
│ Progress: ████████████░░░░░░░░ 58% (7/12 sections)    Workers: 🟢3 active          │
├──────────────────────────────────────────────────────────────┬──────────────────────┤
│                                                              │                      │
│   PENDING (3)      IN PROGRESS (3)    VERIFYING (1)   DONE (5)   │  DETAIL PANEL    │
│   ┌─────────┐      ┌─────────┐       ┌─────────┐    ┌─────────┐  │  (slide out)     │
│   │         │      │ 🟦      │       │         │    │ ✓       │  │                  │
│   │         │      │         │       │         │    │         │  │                  │
│   └─────────┘      └─────────┘       └─────────┘    └─────────┘  │                  │
│   ┌─────────┐      ┌─────────┐                      ┌─────────┐  │                  │
│   │         │      │ 🟩      │                      │ ✓       │  │                  │
│   │         │      │         │                      │         │  │                  │
│   └─────────┘      └─────────┘                      └─────────┘  │                  │
│   ┌─────────┐      ┌─────────┐                      ┌─────────┐  │                  │
│   │         │      │ 🟨      │                      │ ✓       │  │                  │
│   │         │      │         │                      │         │  │                  │
│   └─────────┘      └─────────┘                      └─────────┘  │                  │
│                                                                  │                  │
├──────────────────────────────────────────────────────────────────┴──────────────────┤
│ 🔔 Section 3 (api-client) completed successfully                              [x]  │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### Kanban Columns

| Column | Status | Card Appearance |
|--------|--------|-----------------|
| **PENDING** | Waiting for dependencies | Muted/grayed, shows "Waiting for: X" |
| **IN PROGRESS** | Being implemented | Worker color border, animated progress bar |
| **VERIFYING** | Quality gate / E2E testing | Pulsing border, verification step indicator |
| **DONE** | Completed successfully | Green checkmark, subtle glow, then fade to normal |

### Section Card Design (Medium Detail)

```
┌─────────────────────────────────────┐
│ 🟦 auth-service                     │  ← Worker color indicator (blue = worker 1)
│─────────────────────────────────────│
│ 📁 3 files  │  ⏱ 2:34              │  ← File count + elapsed time
│─────────────────────────────────────│
│ ████████████░░░░░░░░ 65%           │  ← Animated progress bar
│─────────────────────────────────────│
│ 🔧 Implementing: auth.ts:42        │  ← Current step + location
└─────────────────────────────────────┘

Card States:
┌─────────────────────────────────────┐
│ ⏳ settings-ui                      │  ← PENDING: No color, waiting icon
│─────────────────────────────────────│
│ 📁 2 files                          │
│─────────────────────────────────────│
│ Waiting for: auth-service           │  ← Shows dependency
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ 🔍 api-types                        │  ← VERIFYING: Magnifying glass icon
│─────────────────────────────────────│
│ 📁 2 files  │  ⏱ 1:45              │
│─────────────────────────────────────│
│ ░░░░░░░░░░░░░░░░░░░░ (pulsing)     │  ← Pulsing bar during verification
│─────────────────────────────────────│
│ 🧪 Running E2E: /settings           │  ← Verification step
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ ✓ shared-types                      │  ← DONE: Checkmark, green tint
│─────────────────────────────────────│
│ 📁 2 files  │  ⏱ 1:12              │
│─────────────────────────────────────│
│ ████████████████████ 100%          │  ← Full green bar
│─────────────────────────────────────│
│ ✓ All checks passed                 │  ← Success message
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ ❌ database-service         [Retry] │  ← FAILED: Red border, retry button
│─────────────────────────────────────│
│ 📁 4 files  │  ⏱ 3:21              │
│─────────────────────────────────────│
│ ████████████████░░░░ 80%           │  ← Red progress bar
│─────────────────────────────────────│
│ ❌ TypeCheck failed: 3 errors       │  ← Error summary
└─────────────────────────────────────┘
```

### Worker Color Scheme

| Worker | Color | Hex | Use Case |
|--------|-------|-----|----------|
| Worker 1 | Blue | `#3B82F6` | First parallel worker |
| Worker 2 | Green | `#22C55E` | Second parallel worker |
| Worker 3 | Yellow | `#EAB308` | Third parallel worker |
| Worker 4 | Purple | `#A855F7` | Fourth parallel worker (if needed) |
| Worker 5 | Orange | `#F97316` | Fifth parallel worker (if needed) |
| Sequential | Gray | `#6B7280` | Non-parallel sections |
| Verifying | Cyan | `#06B6D4` | Quality gate phase |
| Error | Red | `#EF4444` | Failed sections |

### Slide-Out Detail Panel

```
┌──────────────────────────────────────────────┐
│ Section: auth-service                    [x] │
├──────────────────────────────────────────────┤
│ [Overview] [Logs] [E2E] [Errors]             │  ← Tab navigation
├──────────────────────────────────────────────┤
│                                              │
│ OVERVIEW                                     │
│ ────────────────────────────────────         │
│ Status: In Progress (Worker 1 🟦)            │
│ Progress: 65% (8/12 edits)                   │
│ Elapsed: 2:34                                │
│                                              │
│ FILES                                        │
│ ────────────────────────────────────         │
│ ✓ src/main/services/auth.ts        (done)   │
│ 🔧 src/main/services/auth-types.ts (active) │
│ ○ src/shared/auth-constants.ts     (pending)│
│                                              │
│ CURRENT STEP                                 │
│ ────────────────────────────────────         │
│ Implementing auth-types.ts                   │
│ Line 42: Adding OAuth token interface        │
│                                              │
│ SUCCESS CRITERIA                             │
│ ────────────────────────────────────         │
│ ✓ Types compile without errors               │
│ ○ OAuth flow implemented                     │
│ ○ Token refresh logic works                  │
│                                              │
│ DEPENDENCIES                                 │
│ ────────────────────────────────────         │
│ ✓ shared-types (completed)                   │
│                                              │
│ DEPENDENTS (blocked until this completes)    │
│ ────────────────────────────────────         │
│ • auth-ui (pending)                          │
│ • settings-logout (pending)                  │
│                                              │
└──────────────────────────────────────────────┘
```

### Detail Panel - Logs Tab

```
┌──────────────────────────────────────────────┐
│ Section: auth-service                    [x] │
├──────────────────────────────────────────────┤
│ [Overview] [Logs] [E2E] [Errors]             │
├──────────────────────────────────────────────┤
│                                              │
│ TYPECHECK OUTPUT                             │
│ ────────────────────────────────────         │
│ ┌──────────────────────────────────────────┐ │
│ │ $ tsc --incremental --noEmit             │ │
│ │                                          │ │
│ │ src/main/services/auth.ts:42:10          │ │
│ │   error TS2322: Type 'string' is not     │ │
│ │   assignable to type 'number'.           │ │
│ │                                          │ │
│ │ Found 1 error.                           │ │
│ └──────────────────────────────────────────┘ │
│                                              │
│ LINT OUTPUT                                  │
│ ────────────────────────────────────         │
│ ┌──────────────────────────────────────────┐ │
│ │ $ npm run lint                           │ │
│ │                                          │ │
│ │ ✓ All files passed linting               │ │
│ └──────────────────────────────────────────┘ │
│                                              │
│ TEST OUTPUT                                  │
│ ────────────────────────────────────         │
│ ┌──────────────────────────────────────────┐ │
│ │ $ npm test -- --filter auth              │ │
│ │                                          │ │
│ │ PASS src/main/services/auth.test.ts      │ │
│ │   ✓ should authenticate user (23ms)      │ │
│ │   ✓ should refresh token (12ms)          │ │
│ │                                          │ │
│ │ Tests: 2 passed, 2 total                 │ │
│ └──────────────────────────────────────────┘ │
│                                              │
└──────────────────────────────────────────────┘
```

### Detail Panel - E2E Tab

```
┌──────────────────────────────────────────────┐
│ Section: auth-service                    [x] │
├──────────────────────────────────────────────┤
│ [Overview] [Logs] [E2E] [Errors]             │
├──────────────────────────────────────────────┤
│                                              │
│ E2E TEST: /login                             │
│ ────────────────────────────────────         │
│ Status: ✓ Passed                             │
│                                              │
│ SCREENSHOT (after test)                      │
│ ┌──────────────────────────────────────────┐ │
│ │                                          │ │
│ │    ┌─────────────────────────┐           │ │
│ │    │      Login Form         │           │ │
│ │    │  ┌─────────────────┐    │           │ │
│ │    │  │ Email           │    │           │ │
│ │    │  └─────────────────┘    │           │ │
│ │    │  ┌─────────────────┐    │           │ │
│ │    │  │ Password        │    │           │ │
│ │    │  └─────────────────┘    │           │ │
│ │    │  [  Sign In  ]          │           │ │
│ │    └─────────────────────────┘           │ │
│ │                                          │ │
│ └──────────────────────────────────────────┘ │
│ [View Full Size]                             │
│                                              │
│ CONSOLE OUTPUT                               │
│ ────────────────────────────────────         │
│ ┌──────────────────────────────────────────┐ │
│ │ ✓ No console errors detected             │ │
│ └──────────────────────────────────────────┘ │
│                                              │
│ INTERACTIONS TESTED                          │
│ ────────────────────────────────────         │
│ ✓ Fill email input                           │
│ ✓ Fill password input                        │
│ ✓ Click submit button                        │
│ ✓ Verify redirect to /dashboard              │
│                                              │
└──────────────────────────────────────────────┘
```

### Toast Notifications

```
┌─────────────────────────────────────────────────────────────────┐
│ Notification Types                                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ SUCCESS (green, auto-dismiss 3s)                                │
│ ┌───────────────────────────────────────────────────────┐       │
│ │ ✓ Section "auth-service" completed successfully   [x] │       │
│ └───────────────────────────────────────────────────────┘       │
│                                                                 │
│ WARNING (yellow, auto-dismiss 5s)                               │
│ ┌───────────────────────────────────────────────────────┐       │
│ │ ⚠ Section "api-client" had 2 lint warnings       [x] │       │
│ └───────────────────────────────────────────────────────┘       │
│                                                                 │
│ ERROR (red, persists until dismissed)                           │
│ ┌───────────────────────────────────────────────────────┐       │
│ │ ❌ Section "database" failed: TypeCheck errors        │       │
│ │    [View Details]  [Retry]                       [x] │       │
│ └───────────────────────────────────────────────────────┘       │
│                                                                 │
│ INFO (blue, auto-dismiss 3s)                                    │
│ ┌───────────────────────────────────────────────────────┐       │
│ │ ℹ Starting parallel group 2 (3 workers)          [x] │       │
│ └───────────────────────────────────────────────────────┘       │
│                                                                 │
│ MERGE (purple, auto-dismiss 5s)                                 │
│ ┌───────────────────────────────────────────────────────┐       │
│ │ 🔀 Merging 3 parallel workers...                 [x] │       │
│ └───────────────────────────────────────────────────────┘       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Card Animation Specifications

| Animation | Trigger | Duration | Easing |
|-----------|---------|----------|--------|
| Card slide to new column | Status change | 300ms | ease-out |
| Progress bar update | Progress event | 200ms | linear |
| Card highlight on select | Click | 150ms | ease-in-out |
| Worker color pulse | Active work | 2000ms | infinite pulse |
| Success glow | Section complete | 500ms | ease-out then fade |
| Error shake | Section failed | 300ms | ease-in-out (3 shakes) |
| Panel slide in | Card click | 250ms | ease-out |
| Panel slide out | Close/deselect | 200ms | ease-in |
| Toast enter | Notification | 200ms | slide-up + fade-in |
| Toast exit | Auto/manual dismiss | 150ms | fade-out |

### Responsive Behavior

| Viewport | Layout Change |
|----------|---------------|
| ≥1400px | 4 columns + detail panel side-by-side |
| 1200-1399px | 4 columns, detail panel overlays |
| 900-1199px | 3 columns (combine PENDING+IN PROGRESS), detail panel overlays |
| <900px | 2 columns (stacked), detail panel full-width bottom sheet |

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `←` `→` | Navigate between cards |
| `↑` `↓` | Navigate within column |
| `Enter` | Open detail panel for selected card |
| `Escape` | Close detail panel |
| `Space` | Pause/Resume execution |
| `R` | Retry failed section (when selected) |
| `L` | Toggle logs tab in detail panel |
| `E` | Toggle E2E tab in detail panel |
| `1-4` | Jump to column (1=Pending, 2=In Progress, 3=Verifying, 4=Done) |

---

## Technical Architecture

### System Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        BVS WORKFLOW - COMPLETE FLOW                     │
└─────────────────────────────────────────────────────────────────────────┘

═══════════════════════════════════════════════════════════════════════════
 PHASE 0: TASK INPUT (PRD UPLOAD OR INTERACTIVE PLANNING)
═══════════════════════════════════════════════════════════════════════════

   ┌─────────────────────────────────────────────────────────────────┐
   │  STEP 0.0: CHOOSE INPUT METHOD                                  │
   │                                                                 │
   │  ┌─────────────────────────────────────────────────────────────┐│
   │  │ How would you like to start?                                ││
   │  │                                                             ││
   │  │  ┌─────────────────────┐    ┌─────────────────────┐         ││
   │  │  │ 📄 Upload PRD       │    │ 💬 Planning Chat    │         ││
   │  │  │                     │    │                     │         ││
   │  │  │ I have a PRD doc    │    │ Let's figure out    │         ││
   │  │  │ ready to upload     │    │ the task together   │         ││
   │  │  └─────────────────────┘    └─────────────────────┘         ││
   │  │                                                             ││
   │  │  [Recent Plans ▼]                                           ││
   │  └─────────────────────────────────────────────────────────────┘│
   └─────────────────────────────────────────────────────────────────┘
                                    │
              ┌─────────────────────┴─────────────────────┐
              │                                           │
        Upload PRD                                  Planning Chat
              │                                           │
              ▼                                           ▼
   ┌──────────────────────────┐            ┌──────────────────────────┐
   │  PATH A: PRD UPLOAD      │            │  PATH B: INTERACTIVE     │
   │                          │            │  PLANNING CHAT           │
   └──────────────────────────┘            └──────────────────────────┘
              │                                           │
              ▼                                           ▼
   ┌─────────────────────────────────────────────────────────────────┐
   │  STEP 0.1a: PRD INPUT (Path A)                                  │
   │                                                                 │
   │  User provides PRD via:                                         │
   │  • File upload (drag & drop .md, .txt, .pdf)                    │
   │  • Paste content directly                                       │
   │  • URL to PRD document                                          │
   │  • Select from recent PRDs                                      │
   └─────────────────────────────────────────────────────────────────┘

   ┌─────────────────────────────────────────────────────────────────┐
   │  STEP 0.1b: PLANNING CHAT (Path B)                              │
   │                                                                 │
   │  Interactive conversation with Planning Agent:                  │
   │                                                                 │
   │  ┌─────────────────────────────────────────────────────────────┐│
   │  │ Planning Agent                                              ││
   │  │─────────────────────────────────────────────────────────────││
   │  │ 🤖 What would you like to build or change? Tell me about    ││
   │  │    the feature, bug fix, or enhancement you have in mind.   ││
   │  │                                                             ││
   │  │ 👤 I want to add user authentication to the app             ││
   │  │                                                             ││
   │  │ 🤖 Got it! Let me ask a few questions to understand better: ││
   │  │    1. What auth method? (email/password, OAuth, SSO?)       ││
   │  │    2. Do you need registration, or just login?              ││
   │  │    3. Should sessions persist across browser restarts?      ││
   │  │                                                             ││
   │  │ 👤 OAuth with Google, login only, yes persist sessions      ││
   │  │                                                             ││
   │  │ 🤖 Let me explore your codebase to understand the current   ││
   │  │    architecture...                                          ││
   │  │    [Exploring: src/main/services/, src/renderer/...]        ││
   │  │                                                             ││
   │  │ 🤖 Based on my analysis, here's what I propose:             ││
   │  │                                                             ││
   │  │    Section 1: Auth Types (src/shared/auth-types.ts)         ││
   │  │    Section 2: OAuth Service (src/main/services/oauth.ts)    ││
   │  │    Section 3: Auth Store (src/renderer/stores/auth.ts)      ││
   │  │    Section 4: Login UI (src/renderer/components/Login.tsx)  ││
   │  │                                                             ││
   │  │    Does this look right? Want me to adjust anything?        ││
   │  │                                                             ││
   │  │ 👤 Add a logout button to the settings page too             ││
   │  │                                                             ││
   │  │ 🤖 Good call! I'll add:                                     ││
   │  │    Section 5: Settings Logout (modify Settings.tsx)         ││
   │  │                                                             ││
   │  │    Ready to generate the execution plan?                    ││
   │  │                                                             ││
   │  │           [Continue Chatting]  [Generate Plan →]            ││
   │  └─────────────────────────────────────────────────────────────┘│
   │                                                                 │
   │  Planning Agent Capabilities:                                   │
   │  • Ask clarifying questions about requirements                  │
   │  • Explore codebase to understand architecture                  │
   │  • Identify affected files and dependencies                     │
   │  • Propose bounded sections iteratively                         │
   │  • Adjust based on user feedback                                │
   │  • Generate structured plan from conversation                   │
   └─────────────────────────────────────────────────────────────────┘
                                    │
            ┌───────────────────────┴───────────────────────┐
            │ (Both paths converge here)                    │
            └───────────────────────┬───────────────────────┘
                                    ▼
   ┌─────────────────────────────────────────────────────────────────┐
   │  STEP 0.2: PRD PARSING                                          │
   │                                                                 │
   │  Extract structured data:                                       │
   │  • Title and description                                        │
   │  • User stories with acceptance criteria                        │
   │  • Feature breakdown (phases, features, priorities)             │
   │  • Technical requirements and constraints                       │
   │  • Dependencies between features                                │
   │  • Success metrics                                              │
   │                                                                 │
   │  Output: ParsedPRD object                                       │
   └─────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
   ┌─────────────────────────────────────────────────────────────────┐
   │  STEP 0.3: CODEBASE ANALYSIS (Parallel)                         │
   │                                                                 │
   │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
   │  │ File Structure  │  │ Pattern         │  │ Dependency      │  │
   │  │ Scanner         │  │ Extractor       │  │ Mapper          │  │
   │  │                 │  │                 │  │                 │  │
   │  │ • Directory     │  │ • Naming        │  │ • Import graph  │  │
   │  │   layout        │  │   conventions   │  │ • Component     │  │
   │  │ • File types    │  │ • Code patterns │  │   hierarchy     │  │
   │  │ • Entry points  │  │ • State mgmt    │  │ • Service deps  │  │
   │  └─────────────────┘  └─────────────────┘  └─────────────────┘  │
   │                                                                 │
   │  Output: CodebaseContext object                                 │
   └─────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
   ┌─────────────────────────────────────────────────────────────────┐
   │  STEP 0.4: SECTION GENERATION                                   │
   │                                                                 │
   │  For each feature in PRD:                                       │
   │    1. Identify affected files (existing + new)                  │
   │    2. Group related files (max 5 per section)                   │
   │    3. Define section scope and success criteria                 │
   │    4. Map to E2E test scenarios                                 │
   │    5. Estimate complexity (S/M/L/XL)                            │
   │                                                                 │
   │  Grouping Rules:                                                │
   │  • Same feature = same section (if ≤5 files)                    │
   │  • Service + Types = same section                               │
   │  • Component + Styles + Tests = same section                    │
   │  • Split large features into sub-sections                       │
   │                                                                 │
   │  Output: Section[] (unordered)                                  │
   └─────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
   ┌─────────────────────────────────────────────────────────────────┐
   │  STEP 0.5: DEPENDENCY RESOLUTION                                │
   │                                                                 │
   │  Build dependency graph:                                        │
   │    • Types before implementations                               │
   │    • Services before UI components                              │
   │    • Shared utilities before consumers                          │
   │    • Infrastructure before features                             │
   │                                                                 │
   │  Topological sort to determine execution order                  │
   │                                                                 │
   │  Example ordering:                                              │
   │    1. shared-types (no deps)                                    │
   │    2. auth-service (depends on types)                           │
   │    3. auth-store (depends on service)                           │
   │    4. login-component (depends on store)                        │
   │    5. login-page (depends on component)                         │
   │                                                                 │
   │  Output: Section[] (ordered by dependencies)                    │
   └─────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
   ┌─────────────────────────────────────────────────────────────────┐
   │  STEP 0.6: PLAN REVIEW UI                                       │
   │                                                                 │
   │  Display to user:                                               │
   │  ┌─────────────────────────────────────────────────────────────┐│
   │  │ BVS Execution Plan                                          ││
   │  │─────────────────────────────────────────────────────────────││
   │  │ PRD: Mobile App Full Feature Implementation                 ││
   │  │ Total Sections: 12  │  Est. Complexity: Large               ││
   │  │─────────────────────────────────────────────────────────────││
   │  │                                                             ││
   │  │ ┌─ Section 1: Foundation Types ──────────────────────────┐  ││
   │  │ │ Files: 2  │  Complexity: S  │  E2E: None               │  ││
   │  │ │ • src/shared/types.ts (modify)                         │  ││
   │  │ │ • src/shared/api-types.ts (create)                     │  ││
   │  │ │ Success: Types compile, no any usage                   │  ││
   │  │ └────────────────────────────────────────────────────────┘  ││
   │  │                          ↓                                  ││
   │  │ ┌─ Section 2: API Client Extensions ─────────────────────┐  ││
   │  │ │ Files: 3  │  Complexity: M  │  E2E: /settings          │  ││
   │  │ │ • src/api/client.ts (modify)                           │  ││
   │  │ │ • src/api/endpoints.ts (create)                        │  ││
   │  │ │ • src/hooks/useApi.ts (create)                         │  ││
   │  │ │ Success: API calls work, types match                   │  ││
   │  │ └────────────────────────────────────────────────────────┘  ││
   │  │                          ↓                                  ││
   │  │ ... more sections ...                                       ││
   │  │                                                             ││
   │  │ [Edit Sections]  [Reorder]  [Split/Merge]                   ││
   │  │                                                             ││
   │  │           [ Cancel ]     [ Approve & Start ]                ││
   │  └─────────────────────────────────────────────────────────────┘│
   │                                                                 │
   │  User Actions:                                                  │
   │  • Approve: Save plan, start execution                          │
   │  • Edit: Modify section files/scope                             │
   │  • Reorder: Change execution order                              │
   │  • Split: Break section into smaller parts                      │
   │  • Merge: Combine related sections                              │
   │  • Cancel: Discard plan                                         │
   └─────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
   ┌─────────────────────────────────────────────────────────────────┐
   │  STEP 0.7: PLAN PERSISTENCE                                     │
   │                                                                 │
   │  Save to .bvs/plan.json:                                        │
   │  • PRD metadata (source, parsed structure)                      │
   │  • Codebase context snapshot                                    │
   │  • Ordered section list with full definitions                   │
   │  • Conventions to enforce                                       │
   │  • E2E test mappings                                            │
   │                                                                 │
   │  Initialize .bvs/ directory structure                           │
   └─────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
═══════════════════════════════════════════════════════════════════════════
 PHASE 0.5: PARALLEL ORCHESTRATION
═══════════════════════════════════════════════════════════════════════════

   ┌─────────────────────────────────────────────────────────────────┐
   │  ORCHESTRATOR: MAIN CLAUDE CODE AGENT                           │
   │                                                                 │
   │  Responsibilities:                                              │
   │  • Analyze dependency graph from plan.json                      │
   │  • Identify parallelization opportunities                       │
   │  • Spawn and monitor worker agents                              │
   │  • Handle failures and retries                                  │
   │  • Merge results and verify integration                         │
   │  • Report overall progress to user                              │
   └─────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
   ┌─────────────────────────────────────────────────────────────────┐
   │  STEP 0.5.1: BUILD DEPENDENCY GRAPH                             │
   │                                                                 │
   │  From plan.json sections, build DAG:                            │
   │                                                                 │
   │     section-001 (types)                                         │
   │           │                                                     │
   │           ├──────────────┬──────────────┐                       │
   │           ▼              ▼              ▼                       │
   │     section-002    section-003    section-004                   │
   │     (auth-svc)     (api-client)   (utils)                       │
   │           │              │              │                       │
   │           └──────────────┼──────────────┘                       │
   │                          ▼                                      │
   │                    section-005                                  │
   │                    (auth-ui)                                    │
   │                                                                 │
   │  Parallel Groups:                                               │
   │  • Group 1: [section-001] - must run first (no deps)            │
   │  • Group 2: [section-002, section-003, section-004] - parallel  │
   │  • Group 3: [section-005] - depends on group 2                  │
   └─────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
   ┌─────────────────────────────────────────────────────────────────┐
   │  STEP 0.5.2: CREATE ISOLATED WORKTREES                          │
   │                                                                 │
   │  For parallel execution, each worker gets isolated worktree:    │
   │                                                                 │
   │  Main Repo: /project                                            │
   │      │                                                          │
   │      ├── .bvs-worktrees/                                        │
   │      │   ├── worker-001/  ← section-002 (auth-svc)              │
   │      │   ├── worker-002/  ← section-003 (api-client)            │
   │      │   └── worker-003/  ← section-004 (utils)                 │
   │      │                                                          │
   │      └── (main working tree for sequential sections)            │
   │                                                                 │
   │  Each worktree:                                                 │
   │  • Fresh git worktree from current HEAD                         │
   │  • Own node_modules (symlinked for speed)                       │
   │  • Own .tsbuildinfo for incremental compilation                 │
   └─────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
   ┌─────────────────────────────────────────────────────────────────┐
   │  STEP 0.5.3: SPAWN WORKER AGENTS (Parallel)                     │
   │                                                                 │
   │  Orchestrator uses Task tool to spawn workers in parallel:      │
   │                                                                 │
   │  // Single message with multiple Task tool calls:               │
   │  Task(subagent_type="developer", run_in_background=true,        │
   │       prompt="Execute BVS section-002 in worker-001...")        │
   │  Task(subagent_type="developer", run_in_background=true,        │
   │       prompt="Execute BVS section-003 in worker-002...")        │
   │  Task(subagent_type="developer", run_in_background=true,        │
   │       prompt="Execute BVS section-004 in worker-003...")        │
   │                                                                 │
   │  Worker Agent Receives:                                         │
   │  • Section definition with files and success criteria           │
   │  • Worktree path for isolated execution                         │
   │  • Conventions and learnings files                              │
   │  • Instructions for typecheck-after-edit                        │
   │  • Quality gate requirements                                    │
   └─────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
   ┌─────────────────────────────────────────────────────────────────┐
   │  STEP 0.5.4: MONITOR WORKERS                                    │
   │                                                                 │
   │  Orchestrator polls worker status:                              │
   │                                                                 │
   │  ┌─────────────────────────────────────────────────────────┐    │
   │  │ Worker Status Dashboard                                 │    │
   │  │─────────────────────────────────────────────────────────│    │
   │  │ Worker 1 (section-002): ████████░░ 80% - Running tests  │    │
   │  │ Worker 2 (section-003): ██████████ 100% - COMPLETE ✓    │    │
   │  │ Worker 3 (section-004): ███░░░░░░░ 30% - Implementing   │    │
   │  │─────────────────────────────────────────────────────────│    │
   │  │ Overall: 2/3 sections complete                          │    │
   │  └─────────────────────────────────────────────────────────┘    │
   │                                                                 │
   │  On Worker Failure:                                             │
   │  • Log error with context                                       │
   │  • Attempt retry (max 2 retries)                                │
   │  • If still failing, pause other workers                        │
   │  • Escalate to user for decision                                │
   └─────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
   ┌─────────────────────────────────────────────────────────────────┐
   │  STEP 0.5.5: MERGE RESULTS                                      │
   │                                                                 │
   │  When all workers in a parallel group complete:                 │
   │                                                                 │
   │  1. Collect commits from each worktree:                         │
   │     worker-001: commits [a1, a2, a3]                            │
   │     worker-002: commits [b1, b2]                                │
   │     worker-003: commits [c1, c2, c3, c4]                        │
   │                                                                 │
   │  2. Cherry-pick to main working tree:                           │
   │     git cherry-pick a1 a2 a3 b1 b2 c1 c2 c3 c4                  │
   │                                                                 │
   │  3. If conflicts detected:                                      │
   │     • Use AI conflict resolution (existing feature)             │
   │     • Or escalate to user if complex                            │
   │                                                                 │
   │  4. Cleanup worktrees:                                          │
   │     git worktree remove worker-001                              │
   │     git worktree remove worker-002                              │
   │     git worktree remove worker-003                              │
   └─────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
   ┌─────────────────────────────────────────────────────────────────┐
   │  STEP 0.5.6: INTEGRATION VERIFICATION                           │
   │                                                                 │
   │  After merge, run full verification on main:                    │
   │                                                                 │
   │  1. Full TypeScript compilation (not incremental)               │
   │     └─ Catch any cross-section type conflicts                   │
   │                                                                 │
   │  2. Lint entire codebase                                        │
   │     └─ Ensure no convention violations                          │
   │                                                                 │
   │  3. Run all unit tests                                          │
   │     └─ Catch integration issues                                 │
   │                                                                 │
   │  4. E2E tests for all affected pages                            │
   │     └─ Visual verification of merged functionality              │
   │                                                                 │
   │  If verification fails:                                         │
   │  • Identify which section(s) caused issue                       │
   │  • Spawn fix agent targeting specific files                     │
   │  • Re-run verification                                          │
   │  • Max 3 fix attempts before escalating                         │
   └─────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
═══════════════════════════════════════════════════════════════════════════
 PHASE 1+: EXECUTION (Sequential sections or next parallel group)
═══════════════════════════════════════════════════════════════════════════

   ┌─────────────────────────────────────────────────────────────────┐
   │  SESSION START                                                   │
   │  1. Load .bvs/plan.json (execution plan)                         │
   │  2. Load .bvs/conventions.md                                     │
   │  3. Load .bvs/learnings.md                                       │
   │  4. Load .bvs/progress.json (if resuming)                        │
   │  5. Initialize TypeScript incremental state                      │
   │  6. Build dependency graph for parallel opportunities            │
   └─────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
   ┌─────────────────────────────────────────────────────────────────┐
   │  FOR EACH SECTION (3-5 files)                                   │
   │                                                                 │
   │  ┌───────────────────────────────────────────────────────────┐  │
   │  │  IMPLEMENT PHASE                                          │  │
   │  │                                                           │  │
   │  │  For each file edit:                                      │  │
   │  │    1. Edit/Write file                                     │  │
   │  │    2. Run tsc --incremental --noEmit                      │  │
   │  │       ├─ Pass → Continue to next edit                     │  │
   │  │       └─ Fail → Fix immediately (loop until pass)         │  │
   │  │    3. Check conventions (quick scan)                      │  │
   │  │       ├─ Pass → Continue                                  │  │
   │  │       └─ Fail → Fix immediately                           │  │
   │  └───────────────────────────────────────────────────────────┘  │
   │                         │                                       │
   │                         ▼                                       │
   │  ┌───────────────────────────────────────────────────────────┐  │
   │  │  VERIFY PHASE (Quality Gate)                              │  │
   │  │                                                           │  │
   │  │  1. npm run lint                                          │  │
   │  │     ├─ Pass → Continue                                    │  │
   │  │     └─ Fail → Fix (max 3 attempts) → Escalate             │  │
   │  │                                                           │  │
   │  │  2. npm run typecheck (full)                              │  │
   │  │     ├─ Pass → Continue                                    │  │
   │  │     └─ Fail → Fix (max 3 attempts) → Escalate             │  │
   │  │                                                           │  │
   │  │  3. npm test (affected tests)                             │  │
   │  │     ├─ Pass → Continue                                    │  │
   │  │     └─ Fail → Fix (max 3 attempts) → Escalate             │  │
   │  └───────────────────────────────────────────────────────────┘  │
   │                         │                                       │
   │                         ▼                                       │
   │  ┌───────────────────────────────────────────────────────────┐  │
   │  │  CODE REVIEW PHASE (Start-Task Review Agents)             │  │
   │  │                                                           │  │
   │  │  Run parallel review agents from start-task workflow:     │  │
   │  │                                                           │  │
   │  │  1. Spawn parallel review agents using Task tool:         │  │
   │  │     ┌─────────────────────────────────────────────────┐   │  │
   │  │     │ work-reviewer-correctness                       │   │  │
   │  │     │ • Bugs, logic errors, edge cases                │   │  │
   │  │     │ • Security vulnerabilities                      │   │  │
   │  │     └─────────────────────────────────────────────────┘   │  │
   │  │     ┌─────────────────────────────────────────────────┐   │  │
   │  │     │ work-reviewer-typescript                        │   │  │
   │  │     │ • Type safety, generics usage                   │   │  │
   │  │     │ • Null safety, avoidance of 'any'               │   │  │
   │  │     └─────────────────────────────────────────────────┘   │  │
   │  │     ┌─────────────────────────────────────────────────┐   │  │
   │  │     │ work-reviewer-conventions                       │   │  │
   │  │     │ • Project naming, file structure, patterns      │   │  │
   │  │     │ • Import order, component patterns              │   │  │
   │  │     └─────────────────────────────────────────────────┘   │  │
   │  │     ┌─────────────────────────────────────────────────┐   │  │
   │  │     │ work-reviewer-simplicity                        │   │  │
   │  │     │ • DRY principles, elegance, readability         │   │  │
   │  │     │ • Unnecessary complexity                        │   │  │
   │  │     └─────────────────────────────────────────────────┘   │  │
   │  │                                                           │  │
   │  │  2. Aggregate review findings by priority:                │  │
   │  │     ├─ P0 (Critical): Fix immediately, block progress     │  │
   │  │     ├─ P1 (Major): Fix before section complete            │  │
   │  │     └─ P2 (Minor): Fix or acknowledge, continue           │  │
   │  │                                                           │  │
   │  │  3. Apply fixes for P0/P1 issues automatically            │  │
   │  │     └─ Re-run affected reviewers if fixes made            │  │
   │  │                                                           │  │
   │  │  4. Log P2 issues to .bvs/review-notes.md                 │  │
   │  └───────────────────────────────────────────────────────────┘  │
   │                         │                                       │
   │                         ▼                                       │
   │  ┌───────────────────────────────────────────────────────────┐  │
   │  │  E2E TEST PHASE (Claude-in-Chrome)                        │  │
   │  │                                                           │  │
   │  │  1. Ensure dev server running                             │  │
   │  │     └─ Start if not: npm run dev                          │  │
   │  │                                                           │  │
   │  │  2. Determine affected pages from changed files           │  │
   │  │     └─ Map: src/components/X → pages using X              │  │
   │  │                                                           │  │
   │  │  3. For each affected page:                               │  │
   │  │     a. Navigate to page                                   │  │
   │  │     b. Wait for load                                      │  │
   │  │     c. Screenshot (before interactions)                   │  │
   │  │     d. Check console for errors                           │  │
   │  │     e. Test interactive elements (if applicable)          │  │
   │  │     f. Screenshot (after interactions)                    │  │
   │  │                                                           │  │
   │  │  4. Analyze results:                                      │  │
   │  │     ├─ No errors, renders correctly → Pass                │  │
   │  │     └─ Errors or visual issues → Fix → Re-test            │  │
   │  └───────────────────────────────────────────────────────────┘  │
   │                         │                                       │
   │                         ▼                                       │
   │  ┌───────────────────────────────────────────────────────────┐  │
   │  │  LEARN PHASE                                              │  │
   │  │                                                           │  │
   │  │  1. Extract learnings from any fixes made:                │  │
   │  │     - What was the error?                                 │  │
   │  │     - What was the fix?                                   │  │
   │  │     - What pattern should be followed?                    │  │
   │  │                                                           │  │
   │  │  2. Append to .bvs/learnings.md                           │  │
   │  │                                                           │  │
   │  │  3. Update .bvs/progress.json                             │  │
   │  │     - Mark section complete                               │  │
   │  │     - Record metrics (time, attempts, issues)             │  │
   │  │                                                           │  │
   │  │  4. Proceed to next section                               │  │
   │  └───────────────────────────────────────────────────────────┘  │
   └─────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
   ┌─────────────────────────────────────────────────────────────────┐
   │  SESSION COMPLETE                                               │
   │  1. Final E2E smoke test (all main flows)                       │
   │  2. Generate session report                                     │
   │  3. Offer commit strategy (squash/category/checkpoint)          │
   └─────────────────────────────────────────────────────────────────┘
```

### Data Flow

```
.bvs/
├── config.json              # BVS configuration
├── plan.json                # Generated execution plan from PRD
├── conventions.md           # Project coding conventions
├── learnings.md             # Accumulated patterns and fixes
├── progress.json            # Section completion tracking
├── prd/
│   ├── original.md          # Original uploaded PRD
│   ├── parsed.json          # Parsed PRD structure
│   └── codebase-context.json # Codebase analysis snapshot
├── sections/
│   ├── section-001.json     # Section definition + status
│   ├── section-002.json
│   └── ...
├── screenshots/
│   ├── section-001/
│   │   ├── page-home-before.png
│   │   ├── page-home-after.png
│   │   └── ...
│   └── ...
└── logs/
    ├── prd-parse.log        # PRD parsing output
    ├── codebase-analysis.log # Codebase analysis output
    ├── typecheck.log        # TypeScript check output
    ├── lint.log             # Lint output
    ├── test.log             # Test output
    └── e2e.log              # E2E test output
```

### File Formats

#### .bvs/plan.json (Generated from PRD)
```json
{
  "version": "1.0",
  "generatedAt": "2026-01-20T10:00:00Z",
  "prd": {
    "source": "file",
    "filename": "mobile-app-prd.md",
    "title": "Claude Code Mobile App - Full Feature Implementation",
    "summary": "Build comprehensive React Native/Expo mobile app with full feature parity...",
    "totalFeatures": 25,
    "estimatedComplexity": "large"
  },
  "codebaseContext": {
    "framework": "electron-react",
    "language": "typescript",
    "stateManagement": "zustand",
    "styling": "tailwind",
    "testing": "vitest",
    "conventions": {
      "componentPattern": "functional",
      "fileNaming": "kebab-case",
      "importOrder": ["external", "internal", "relative", "types"]
    },
    "entryPoints": {
      "main": "src/main/index.ts",
      "renderer": "src/renderer/main.tsx",
      "preload": "src/preload/index.ts"
    }
  },
  "sections": [
    {
      "id": "section-001",
      "name": "foundation-types",
      "description": "Add shared types for mobile API communication",
      "prdFeatures": ["F1.1", "F1.2"],
      "files": [
        {
          "path": "src/shared/types.ts",
          "action": "modify",
          "description": "Add mobile-specific API types"
        },
        {
          "path": "src/shared/mobile-types.ts",
          "action": "create",
          "description": "New types for mobile app communication"
        }
      ],
      "dependencies": [],
      "successCriteria": [
        "TypeScript compiles with no errors",
        "No 'any' types used",
        "All types exported correctly"
      ],
      "e2eTests": [],
      "complexity": "S",
      "estimatedEdits": 15
    },
    {
      "id": "section-002",
      "name": "api-client-extensions",
      "description": "Extend API client with new endpoints for mobile",
      "prdFeatures": ["F1.3"],
      "files": [
        {
          "path": "src/api/client.ts",
          "action": "modify",
          "description": "Add new endpoint methods"
        },
        {
          "path": "src/api/mobile-endpoints.ts",
          "action": "create",
          "description": "Mobile-specific API endpoints"
        },
        {
          "path": "src/hooks/useMobileApi.ts",
          "action": "create",
          "description": "React hook for mobile API calls"
        }
      ],
      "dependencies": ["section-001"],
      "successCriteria": [
        "API calls return expected data shapes",
        "Error handling works correctly",
        "Types match between client and server"
      ],
      "e2eTests": [
        {
          "page": "/settings",
          "scenario": "connection-test",
          "description": "Verify API client connects successfully"
        }
      ],
      "complexity": "M",
      "estimatedEdits": 35
    }
  ],
  "totalSections": 12,
  "executionOrder": ["section-001", "section-002", "..."],
  "e2eMapping": {
    "src/renderer/components/Dashboard.tsx": ["/", "/dashboard"],
    "src/renderer/components/Settings.tsx": ["/settings"],
    "src/main/api-server/index.ts": ["/", "/settings"]
  }
}
```

#### .bvs/config.json
```json
{
  "version": "1.0",
  "project": {
    "name": "claude-code-manager",
    "devServer": {
      "command": "npm run dev",
      "port": 5173,
      "startupTimeout": 30000
    }
  },
  "section": {
    "maxFiles": 5,
    "defaultTimeout": 300000
  },
  "parallelExecution": {
    "enabled": true,
    "maxWorkers": 3,
    "worktreeBasePath": ".bvs-worktrees",
    "workerTimeout": 600000,
    "retryAttempts": 2,
    "cleanupOnSuccess": true,
    "cleanupOnFailure": false,
    "symlinkNodeModules": true
  },
  "typecheck": {
    "command": "npx tsc --incremental --noEmit",
    "runAfterEdit": true
  },
  "qualityGate": {
    "lint": {
      "command": "npm run lint",
      "required": true
    },
    "typecheck": {
      "command": "npm run typecheck",
      "required": true
    },
    "test": {
      "command": "npm test",
      "required": true,
      "filter": "affected"
    },
    "maxFixAttempts": 3
  },
  "e2e": {
    "enabled": true,
    "screenshotOnPass": true,
    "screenshotOnFail": true,
    "interactiveTests": true
  },
  "learning": {
    "autoCapture": true,
    "minSeverity": "warning"
  }
}
```

#### .bvs/conventions.md
```markdown
# Project Conventions

## File Structure
- Components in `src/renderer/components/`
- Services in `src/main/services/`
- Types in `src/shared/types.ts`

## Naming
- Components: PascalCase (e.g., `UserProfile.tsx`)
- Services: kebab-case (e.g., `user-service.ts`)
- Functions: camelCase (e.g., `getUserById`)
- Constants: SCREAMING_SNAKE_CASE (e.g., `MAX_RETRIES`)

## TypeScript
- No `any` type - use `unknown` and narrow
- Explicit return types on exported functions
- Interface over type for object shapes

## React
- Functional components only
- Props interface named `{Component}Props`
- Use `useState` for local state, Zustand for global

## Error Handling
- Always wrap async operations in try/catch
- Use Result type for fallible operations
- Log errors with context before re-throwing

## Imports
- Group: external, internal, relative, types
- Absolute imports for cross-directory
- Relative imports within same directory
```

#### .bvs/learnings.md
```markdown
# Learnings

## L001: Missing null check on optional chain
**Date:** 2026-01-20
**Section:** auth-integration
**Severity:** error

**Problem:**
```typescript
const user = data?.user
console.log(user.name)  // Error: user might be undefined
```

**Solution:**
```typescript
const user = data?.user
if (user) {
  console.log(user.name)
}
```

**Prevention Rule:**
Always add null/undefined check after optional chain before accessing properties.

---

## L002: Zustand store not updating on nested object change
**Date:** 2026-01-20
**Section:** state-management
**Severity:** warning

**Problem:**
```typescript
set({ config: { ...state.config, theme: 'dark' } })  // UI doesn't update
```

**Solution:**
```typescript
set((state) => ({
  config: { ...state.config, theme: 'dark' }
}))  // Correct: use updater function
```

**Prevention Rule:**
Always use updater function form of `set()` when updating nested state.

---
```

#### .bvs/progress.json
```json
{
  "sessionId": "bvs-2026-01-20-001",
  "startedAt": "2026-01-20T10:00:00Z",
  "status": "in_progress",
  "sections": [
    {
      "id": "section-001",
      "name": "auth-service",
      "files": ["src/main/services/auth.ts", "src/shared/auth-types.ts"],
      "status": "completed",
      "startedAt": "2026-01-20T10:00:00Z",
      "completedAt": "2026-01-20T10:15:00Z",
      "metrics": {
        "edits": 12,
        "typecheckRuns": 14,
        "typecheckFixes": 2,
        "qualityGateAttempts": 1,
        "e2eTests": 3,
        "learningsCapture": 1
      }
    },
    {
      "id": "section-002",
      "name": "auth-ui",
      "files": ["src/renderer/components/Login.tsx"],
      "status": "in_progress",
      "startedAt": "2026-01-20T10:15:00Z"
    }
  ],
  "totals": {
    "sectionsCompleted": 1,
    "sectionsTotal": 5,
    "filesModified": 2,
    "learningsCaptured": 1
  }
}
```

### E2E Test Mapping

```typescript
// Map changed files to pages/routes for E2E testing
const fileToPageMapping = {
  // Components map to pages that use them
  "src/renderer/components/Login.tsx": ["/login"],
  "src/renderer/components/Dashboard.tsx": ["/", "/dashboard"],
  "src/renderer/components/Settings.tsx": ["/settings"],

  // Services may affect multiple pages
  "src/main/services/auth.ts": ["/login", "/", "/settings"],

  // Shared types affect all pages using them
  "src/shared/types.ts": ["*"],  // Full smoke test

  // API routes
  "src/main/api-server/index.ts": ["/", "/settings"],
}

// E2E test scenarios per page
const pageTestScenarios = {
  "/login": {
    load: true,
    screenshot: true,
    consoleCheck: true,
    interactions: [
      { type: "input", selector: "[name=email]", value: "test@example.com" },
      { type: "input", selector: "[name=password]", value: "password" },
      { type: "click", selector: "button[type=submit]" },
      { type: "waitForNavigation", url: "/" }
    ]
  },
  "/": {
    load: true,
    screenshot: true,
    consoleCheck: true,
    interactions: [
      { type: "click", selector: "[data-testid=new-session]" },
      { type: "waitForElement", selector: "[data-testid=session-modal]" }
    ]
  },
  "/settings": {
    load: true,
    screenshot: true,
    consoleCheck: true,
    interactions: []
  }
}
```

### TypeScript Verification Flow

```
┌─────────────────────────────────────────────────────────────────┐
│  TYPECHECK AFTER EDIT                                           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
        ┌─────────────────────────────────────┐
        │  Run: tsc --incremental --noEmit    │
        │  (Uses .tsbuildinfo for speed)      │
        │  Typical time: 500ms - 2s           │
        └─────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              │                               │
         Exit Code 0                     Exit Code 1+
         (No Errors)                     (Has Errors)
              │                               │
              ▼                               ▼
    ┌─────────────────┐          ┌─────────────────────────┐
    │ Continue to     │          │ Parse Error Output      │
    │ next edit       │          │                         │
    └─────────────────┘          │ src/foo.ts(10,5):       │
                                 │   error TS2322:         │
                                 │   Type 'string' is not  │
                                 │   assignable to 'number'│
                                 └─────────────────────────┘
                                              │
                                              ▼
                                 ┌─────────────────────────┐
                                 │ FIX IMMEDIATELY         │
                                 │                         │
                                 │ 1. Display error        │
                                 │ 2. Fix the edit         │
                                 │ 3. Re-run typecheck     │
                                 │ 4. Loop until pass      │
                                 │                         │
                                 │ Max attempts: 5         │
                                 │ Then: Escalate to user  │
                                 └─────────────────────────┘
```

---

## Dependencies

### External
- TypeScript 5.x (incremental compilation support)
- Node.js 20+ (Electron main process)
- Claude-in-Chrome MCP (E2E testing)
- Chrome browser (for E2E)

### Internal
- `@anthropic-ai/claude-code` (agent orchestration)
- Electron IPC (main/renderer communication)
- Zustand (state management)

---

## Implementation Considerations

### Performance

| Operation | Target Time | Notes |
|-----------|-------------|-------|
| Incremental typecheck | <2s | Use tsc --incremental |
| Full typecheck | <10s | Full project scan |
| Lint | <5s | ESLint with cache |
| E2E page test | <10s | Including screenshot |
| Dev server startup | <30s | With timeout fallback |

### Error Messages

All errors should follow this format:
```
[BVS-{PHASE}] {FILE}:{LINE}:{COL} - {MESSAGE}

Context:
  {2 lines before}
> {error line}
  {2 lines after}

Suggested fix:
  {specific fix guidance}
```

Example:
```
[BVS-TYPECHECK] src/services/auth.ts:42:10 - Type 'string' is not assignable to type 'number'

Context:
  40:   const config = loadConfig()
  41:   const timeout = config.timeout
> 42:   return timeout  // Expected number, got string
  43: }

Suggested fix:
  Add parseInt() or ensure config.timeout is typed as number:
  return parseInt(timeout, 10)
```

### E2E Test Reliability

To ensure E2E tests are reliable:

1. **Wait for hydration**: Don't interact until React is fully mounted
2. **Retry on flaky selectors**: Up to 3 retries with increasing delay
3. **Screenshot on failure**: Always capture state for debugging
4. **Console error filtering**: Ignore known benign errors (React dev warnings)
5. **Timeout handling**: Graceful failure with context

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| TypeCheck too slow | Medium | Medium | Incremental mode, skip unchanged |
| E2E flaky tests | High | Medium | Retries, stable selectors, waits |
| Dev server won't start | Low | High | Timeout + user notification |
| False positive errors | Medium | Medium | Validation step, user override |
| Learning file grows too large | Low | Low | Archiving, relevance scoring |
| Chrome not available | Low | High | Graceful skip, user notification |

---

## Future Enhancements

### Phase 7 (Future): Advanced Features
- [ ] Visual diff comparison (screenshot diff)
- [ ] AI-powered fix suggestions
- [ ] Parallel section execution (independent sections)
- [ ] Integration with CI/CD
- [ ] Team-shared learnings repository
- [ ] Custom E2E test authoring UI

### Phase 8 (Future): Analytics
- [ ] Section completion time trends
- [ ] Error category analysis
- [ ] Learning effectiveness metrics
- [ ] Developer productivity insights

---

## API Reference

### PRD Intake Types

```typescript
// PRD Input sources
type PRDSource =
  | { type: 'file'; file: File }           // Uploaded file
  | { type: 'paste'; content: string }      // Pasted content
  | { type: 'url'; url: string }            // URL to fetch
  | { type: 'recent'; planId: string }      // Previous plan

// Parsed PRD structure
interface ParsedPRD {
  title: string
  description: string
  userStories: UserStory[]
  features: Feature[]
  phases: Phase[]
  technicalRequirements: string[]
  constraints: string[]
  successMetrics: Metric[]
  dependencies: Dependency[]
}

interface UserStory {
  id: string
  asA: string
  iWant: string
  soThat: string
  acceptanceCriteria: string[]
}

interface Feature {
  id: string
  name: string
  description: string
  priority: 'P0' | 'P1' | 'P2' | 'P3'
  phase: string
  status: 'not_started' | 'in_progress' | 'completed'
  notes?: string
}

interface Phase {
  id: string
  name: string
  description: string
  features: string[]  // Feature IDs
}

// Codebase analysis result
interface CodebaseContext {
  framework: string
  language: string
  stateManagement?: string
  styling?: string
  testing?: string
  conventions: {
    componentPattern: string
    fileNaming: string
    importOrder: string[]
  }
  entryPoints: Record<string, string>
  existingPatterns: Pattern[]
  dependencyGraph: DependencyGraph
}

interface Pattern {
  type: 'component' | 'service' | 'hook' | 'util'
  example: string
  description: string
}

// Generated section
interface Section {
  id: string
  name: string
  description: string
  prdFeatures: string[]  // Feature IDs from PRD
  files: SectionFile[]
  dependencies: string[]  // Section IDs this depends on
  successCriteria: string[]
  e2eTests: E2ETest[]
  complexity: 'S' | 'M' | 'L' | 'XL'
  estimatedEdits: number
}

interface SectionFile {
  path: string
  action: 'create' | 'modify' | 'delete'
  description: string
}

interface E2ETest {
  page: string
  scenario: string
  description: string
  interactions?: Interaction[]
}

// Full execution plan
interface ExecutionPlan {
  version: string
  generatedAt: string
  prd: {
    source: string
    filename?: string
    title: string
    summary: string
    totalFeatures: number
    estimatedComplexity: 'small' | 'medium' | 'large' | 'xlarge'
  }
  codebaseContext: CodebaseContext
  sections: Section[]
  totalSections: number
  executionOrder: string[]  // Section IDs in order
  e2eMapping: Record<string, string[]>  // file -> pages
}
```

### Parallel Orchestration Types

```typescript
// Dependency graph for parallel analysis
interface DependencyGraph {
  nodes: Map<string, SectionNode>
  edges: Map<string, string[]>  // section -> depends on sections
}

interface SectionNode {
  sectionId: string
  dependencies: string[]
  dependents: string[]
  level: number  // 0 = no deps, 1 = depends on level 0, etc.
}

// Parallel execution groups
interface ParallelGroup {
  groupId: string
  level: number
  sections: string[]  // Section IDs that can run in parallel
  estimatedDuration: number
}

// Worker state
interface WorkerState {
  workerId: string
  sectionId: string
  worktreePath: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'retrying'
  progress: number  // 0-100
  currentStep: string
  startedAt?: string
  completedAt?: string
  error?: string
  retryCount: number
  commits: string[]  // Commit SHAs created by this worker
}

// Merge result
interface MergeResult {
  success: boolean
  mergedCommits: string[]
  conflicts?: ConflictInfo[]
  resolutionApplied?: boolean
}

interface ConflictInfo {
  file: string
  workerA: string
  workerB: string
  resolved: boolean
  resolution?: 'auto' | 'manual' | 'ai'
}

// Integration verification result
interface IntegrationResult {
  typecheck: { passed: boolean; errors?: string[] }
  lint: { passed: boolean; errors?: string[] }
  tests: { passed: boolean; failed?: string[] }
  e2e: { passed: boolean; failures?: E2EFailure[] }
  overall: boolean
}

interface E2EFailure {
  page: string
  issue: string
  screenshot?: string
}
```

### Orchestrator Service API

```typescript
interface OrchestratorService {
  // Dependency analysis
  buildDependencyGraph(sections: Section[]): DependencyGraph
  identifyParallelGroups(graph: DependencyGraph): ParallelGroup[]

  // Worktree management
  createWorktree(workerId: string, sectionId: string): Promise<string>  // Returns path
  removeWorktree(workerId: string): Promise<void>
  listActiveWorktrees(): Promise<WorkerState[]>

  // Worker management
  spawnWorker(section: Section, worktreePath: string): Promise<string>  // Returns worker ID
  getWorkerStatus(workerId: string): Promise<WorkerState>
  cancelWorker(workerId: string): Promise<void>
  retryWorker(workerId: string): Promise<void>

  // Parallel execution
  executeParallelGroup(group: ParallelGroup): Promise<WorkerState[]>
  waitForGroup(groupId: string): Promise<WorkerState[]>

  // Merge and verification
  mergeWorkerResults(workers: WorkerState[]): Promise<MergeResult>
  runIntegrationVerification(): Promise<IntegrationResult>

  // Events
  on(event: 'worker-progress', handler: (state: WorkerState) => void): void
  on(event: 'worker-complete', handler: (state: WorkerState) => void): void
  on(event: 'worker-failed', handler: (state: WorkerState) => void): void
  on(event: 'group-complete', handler: (groupId: string, results: WorkerState[]) => void): void
  on(event: 'merge-conflict', handler: (conflict: ConflictInfo) => void): void
}
```

### PRD Intake Service API

```typescript
interface PRDIntakeService {
  // PRD Input
  uploadPRD(source: PRDSource): Promise<string>  // Returns PRD ID

  // Parsing
  parsePRD(prdId: string): Promise<ParsedPRD>

  // Codebase Analysis
  analyzeCodebase(projectPath: string): Promise<CodebaseContext>

  // Plan Generation
  generateSections(prd: ParsedPRD, context: CodebaseContext): Promise<Section[]>
  resolveDependencies(sections: Section[]): Promise<Section[]>  // Ordered

  // Plan Management
  savePlan(plan: ExecutionPlan): Promise<void>
  loadPlan(planId: string): Promise<ExecutionPlan>

  // User Modifications
  reorderSections(sectionIds: string[]): Promise<void>
  splitSection(sectionId: string, splitAt: number): Promise<[Section, Section]>
  mergeSections(sectionIds: string[]): Promise<Section>
  updateSection(sectionId: string, updates: Partial<Section>): Promise<Section>

  // Events
  on(event: 'parse-progress', handler: (progress: number) => void): void
  on(event: 'analysis-progress', handler: (stage: string) => void): void
  on(event: 'plan-ready', handler: (plan: ExecutionPlan) => void): void
}
```

### BVS Service API

```typescript
interface BVSService {
  // Plan-based session start
  startSessionFromPlan(planId: string): Promise<BVSSession>

  // Session management
  startSession(config: BVSConfig): Promise<BVSSession>
  resumeSession(sessionId: string): Promise<BVSSession>
  pauseSession(): Promise<void>
  endSession(): Promise<BVSReport>

  // Section management
  startSection(definition: SectionDefinition): Promise<Section>
  completeSection(): Promise<SectionResult>

  // Verification
  runTypeCheck(): Promise<TypeCheckResult>
  runQualityGate(): Promise<QualityGateResult>
  runE2ETest(pages: string[]): Promise<E2EResult>

  // Learning
  captureLearning(learning: Learning): Promise<void>
  loadLearnings(): Promise<Learning[]>

  // Events
  on(event: 'typecheck-complete', handler: (result: TypeCheckResult) => void): void
  on(event: 'section-complete', handler: (section: Section) => void): void
  on(event: 'e2e-complete', handler: (result: E2EResult) => void): void
  on(event: 'error', handler: (error: BVSError) => void): void
}
```

### IPC Channels

```typescript
// Main process handlers
const BVS_CHANNELS = {
  // PRD Intake (Phase 0)
  UPLOAD_PRD: 'bvs:upload-prd',
  PARSE_PRD: 'bvs:parse-prd',
  ANALYZE_CODEBASE: 'bvs:analyze-codebase',
  GENERATE_PLAN: 'bvs:generate-plan',
  SAVE_PLAN: 'bvs:save-plan',
  LOAD_PLAN: 'bvs:load-plan',
  LIST_RECENT_PLANS: 'bvs:list-recent-plans',

  // Plan Modification
  REORDER_SECTIONS: 'bvs:reorder-sections',
  SPLIT_SECTION: 'bvs:split-section',
  MERGE_SECTIONS: 'bvs:merge-sections',
  UPDATE_SECTION: 'bvs:update-section',

  // Parallel Orchestration
  BUILD_DEPENDENCY_GRAPH: 'bvs:build-dependency-graph',
  IDENTIFY_PARALLEL_GROUPS: 'bvs:identify-parallel-groups',
  CREATE_WORKTREE: 'bvs:create-worktree',
  REMOVE_WORKTREE: 'bvs:remove-worktree',
  SPAWN_WORKER: 'bvs:spawn-worker',
  GET_WORKER_STATUS: 'bvs:get-worker-status',
  CANCEL_WORKER: 'bvs:cancel-worker',
  RETRY_WORKER: 'bvs:retry-worker',
  EXECUTE_PARALLEL_GROUP: 'bvs:execute-parallel-group',
  MERGE_WORKER_RESULTS: 'bvs:merge-worker-results',
  RUN_INTEGRATION_VERIFICATION: 'bvs:run-integration-verification',

  // Orchestration Events (main → renderer)
  WORKER_PROGRESS: 'bvs:worker-progress',
  WORKER_COMPLETE: 'bvs:worker-complete',
  WORKER_FAILED: 'bvs:worker-failed',
  GROUP_COMPLETE: 'bvs:group-complete',
  MERGE_CONFLICT: 'bvs:merge-conflict',
  INTEGRATION_RESULT: 'bvs:integration-result',

  // PRD Events (main → renderer)
  PARSE_PROGRESS: 'bvs:parse-progress',
  ANALYSIS_PROGRESS: 'bvs:analysis-progress',
  PLAN_READY: 'bvs:plan-ready',

  // Session
  START_SESSION: 'bvs:start-session',
  START_SESSION_FROM_PLAN: 'bvs:start-session-from-plan',
  RESUME_SESSION: 'bvs:resume-session',
  PAUSE_SESSION: 'bvs:pause-session',
  END_SESSION: 'bvs:end-session',
  GET_SESSION_STATUS: 'bvs:get-session-status',

  // Section
  START_SECTION: 'bvs:start-section',
  COMPLETE_SECTION: 'bvs:complete-section',

  // Verification
  RUN_TYPECHECK: 'bvs:run-typecheck',
  RUN_QUALITY_GATE: 'bvs:run-quality-gate',
  RUN_E2E_TEST: 'bvs:run-e2e-test',

  // Learning
  CAPTURE_LEARNING: 'bvs:capture-learning',
  LOAD_LEARNINGS: 'bvs:load-learnings',

  // Events (main → renderer)
  TYPECHECK_RESULT: 'bvs:typecheck-result',
  SECTION_PROGRESS: 'bvs:section-progress',
  E2E_RESULT: 'bvs:e2e-result',
  ERROR: 'bvs:error',
}
```

---

## Open Questions

### PRD Intake
1. What PRD formats should be supported? (md, txt, pdf, docx, notion export?)
2. How to handle PRDs with unclear or missing feature breakdowns?
3. Should we support partial PRDs (just user stories, no technical details)?
4. How to handle PRDs that reference external systems not in codebase?
5. Should the codebase analysis be cached for repeated PRD uploads?

### Section Generation
6. Should sections be auto-generated only, or allow manual section creation?
7. How to handle circular dependencies between features?
8. What's the maximum section size before forcing a split?

### Parallel Execution
9. What's the optimal max worker count based on system resources?
10. How to handle workers that take significantly longer than others?
11. Should we allow partial merges (merge completed workers while others run)?
12. How to handle shared file conflicts between parallel workers?
13. Should workers share a node_modules symlink or have isolated copies?

### Execution
14. How to handle E2E tests for non-web parts of the app (Electron main process)?
15. Should we support multiple dev servers (frontend + backend)?
16. How aggressive should auto-fix attempts be before escalating?
17. Should learnings be project-specific or shared across projects?
18. How to handle E2E tests that require authentication state?

---

## Changelog

| Date | Version | Changes |
|------|---------|---------|
| 2026-01-20 | 1.4 | Added UI Design Specification: Kanban board, worker colors, slide-out panel, animations |
| 2026-01-20 | 1.3 | Added Interactive Planning Chat as alternative to PRD upload |
| 2026-01-20 | 1.2 | Added Phase 0.5: Parallel Orchestration with worker agents |
| 2026-01-20 | 1.1 | Added Phase 0: PRD Intake and Planning with full workflow |
| 2026-01-20 | 1.0 | Initial PRD created |


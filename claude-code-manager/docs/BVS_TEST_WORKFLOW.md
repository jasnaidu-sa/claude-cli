# BVS Assisted Development Test Workflow

## Overview

This document outlines the complete workflow for testing the BVS (Bounded Verified Sections) system with an existing plan. The test will validate the entire development cycle from plan selection through execution to completion/pause/resume.

---

## Current Test Plan

**Plan**: Ralph Loop Improvements (`ralph-loop-improvements-plan.json`)
**Total Features**: 17 sections organized in 5 dependency levels
**Status**: All sections pending, ready for execution

### Plan Structure

```
Level 0 (4 sections - Can run in parallel):
- RALPH-001: Add Subtask and Metrics Types
- RALPH-009: Add Build Verification to Quality Gates
- RALPH-011: Create SessionLimitError Class
- RALPH-013: Create Plan Validator Service

Level 1 (6 sections - Depends on Level 0):
- RALPH-002: Implement identifySubtasks() Method
- RALPH-007: Implement Subtask Commit Logic
- RALPH-008: Implement Cost Tracking in Workers
- RALPH-010: Implement Session Limits in Orchestrator
- RALPH-012: Implement Attended Execution Modes
- RALPH-014: Add IPC Handlers for Execution Config

Level 2 (2 sections - Depends on Level 1):
- RALPH-003: Implement Subtask Execution Loop
- RALPH-015: Update Preload with New APIs

Level 3 (4 sections - Depends on Level 2):
- RALPH-004: Implement Subtask Prompt Building
- RALPH-005: Implement Progressive Feedback Per Subtask
- RALPH-016: Build Execution Config UI
- RALPH-017: Build Plan Validation UI

Level 4 (1 section - Depends on Level 3):
- RALPH-006: Implement Subtask Retry Logic
```

---

## Test Objectives

### Primary Goals
1. **Validate Plan Loading** - Verify plan can be loaded and displayed correctly
2. **Validate Phase Selection** - User can choose specific phases/levels to execute
3. **Validate Execution Flow** - Sections execute with proper orchestration
4. **Validate Quality Gates** - TypeCheck, lint, tests run correctly
5. **Validate Progress Tracking** - UI updates in real-time
6. **Validate Pause/Resume** - Can stop mid-execution and resume later
7. **Validate Parallel Execution** - Independent sections run concurrently
8. **Validate Error Handling** - Failures are caught and reported properly

### Success Criteria
- ✅ Plan loads without errors
- ✅ Can select subset of phases (e.g., only Level 0 or Levels 0-2)
- ✅ Selected sections execute in dependency order
- ✅ UI shows real-time progress (Kanban board updates)
- ✅ Quality gates catch errors immediately
- ✅ Can pause execution gracefully
- ✅ Can resume from checkpoint
- ✅ Parallel sections complete faster than sequential
- ✅ All commits are atomic and properly attributed

---

## Pre-Test Setup

### 1. Verify System State

**Check Electron App**:
```bash
# Ensure dev server is running
cd C:\claude_projects\claude-cli\claude-code-manager
npm run dev
```

**Check Project State**:
- All Ralph Loop features already completed (17/17 done)
- This plan is for **new improvements** (not already implemented features)
- Git working directory should be clean or at least committed

**Check UI Access**:
- Open Electron app
- Navigate to BVS view
- Verify plan appears in plan list

### 2. Checkpoint System

**Current Checkpoint File**: `.bvs/checkpoint.json`

**Checkpoint Structure**:
```json
{
  "planId": "ralph-loop-improvements",
  "sessionId": "session-123",
  "completedSections": ["RALPH-001"],
  "currentLevel": 1,
  "pausedAt": 1737680000000,
  "status": "paused",
  "config": {
    "mode": "ATTENDED_LEVEL",
    "limits": {
      "maxIterationsPerWorker": 20,
      "maxCostPerWorker": 0.50
    }
  }
}
```

### 3. UI State

**BVS View Components**:
- **BvsDashboard**: Kanban board with 4 columns (Pending, In Progress, Verifying, Done)
- **BvsExecutionDashboard**: Control panel (start, pause, stop, config)
- **BvsPlanReview**: Plan editor/viewer
- **BvsKanbanBoard**: Real-time section status visualization

---

## Test Workflow: Step-by-Step

### Phase 1: Plan Selection and Review

#### Step 1.1: Load Existing Plan

**Action**: Open BVS view and locate plan

**UI Flow**:
1. Click "BVS" tab in sidebar
2. See plan card: "Ralph Loop Improvements" (17 sections)
3. Click "Review Plan" button

**Expected UI**:
```
┌─────────────────────────────────────────────────────────────┐
│ Plan: Ralph Loop Improvements                    [Edit][Run] │
├─────────────────────────────────────────────────────────────┤
│ 17 sections in 5 dependency levels                          │
│ Estimated time: 12-16 hours                                  │
│ Total files: 8 files to modify/create                        │
│                                                              │
│ Dependency Graph:                                            │
│ Level 0: 4 sections (can run in parallel)                    │
│ Level 1: 6 sections (depends on Level 0)                     │
│ Level 2: 2 sections                                          │
│ Level 3: 4 sections                                          │
│ Level 4: 1 section                                           │
└─────────────────────────────────────────────────────────────┘
```

**Validation**:
- ✅ Plan loads without errors
- ✅ All 17 sections visible
- ✅ Dependency graph displays correctly
- ✅ File counts match plan definition

#### Step 1.2: Choose Execution Scope

**Decision Point**: User selects which phases to execute

**Options**:
1. **Test Option 1: Single Level** - Execute only Level 0 (4 sections)
2. **Test Option 2: Multiple Levels** - Execute Levels 0-2 (12 sections)
3. **Test Option 3: Full Plan** - Execute all 17 sections
4. **Test Option 4: Single Section** - Execute just RALPH-001 for quick validation

**UI Enhancement Needed**:
```
┌─────────────────────────────────────────────────────────────┐
│ Execution Scope                                              │
├─────────────────────────────────────────────────────────────┤
│ ○ Full Plan (17 sections, 5 levels)                          │
│ ● Custom Selection:                                          │
│   Level 0: [✓] 4 sections                                    │
│   Level 1: [✓] 6 sections                                    │
│   Level 2: [ ] 2 sections                                    │
│   Level 3: [ ] 4 sections                                    │
│   Level 4: [ ] 1 section                                     │
│                                                              │
│ Selected: 10 sections across 2 levels                        │
│ Estimated time: 6-8 hours                                    │
│                                                              │
│ [Cancel] [Start Execution]                                   │
└─────────────────────────────────────────────────────────────┘
```

**For Our Test**: Let's use **Test Option 1** (Level 0 only - 4 sections)

**Why Level 0**:
- ✅ Small scope (4 sections)
- ✅ Can run in parallel (tests parallel orchestration)
- ✅ Quick validation (~1-2 hours)
- ✅ Foundation types for later phases
- ✅ No external dependencies

---

### Phase 2: Execution Configuration

#### Step 2.1: Configure Execution Settings

**UI Configuration Panel**:
```
┌─────────────────────────────────────────────────────────────┐
│ Execution Configuration                                      │
├─────────────────────────────────────────────────────────────┤
│ Execution Mode:                                              │
│ ● ATTENDED_LEVEL    Pause after each level completes         │
│ ○ ATTENDED_SINGLE   Pause after each section completes       │
│ ○ SEMI_ATTENDED     Pause only at merge points               │
│ ○ UNATTENDED        Full automation, no pauses               │
│                                                              │
│ Session Limits:                                              │
│ Max iterations per section: [20]                             │
│ Max cost per section: [$0.50]                                │
│ Max total cost: [$5.00]                                      │
│                                                              │
│ Quality Gates:                                               │
│ [✓] TypeCheck after each edit                                │
│ [✓] Lint at section end                                      │
│ [✓] Build verification                                       │
│ [✓] Code review (work-reviewer-* agents)                     │
│                                                              │
│ Parallel Execution:                                          │
│ Max parallel workers: [4] (Level 0 has 4 sections)           │
│                                                              │
│ [Cancel] [Start with Config]                                 │
└─────────────────────────────────────────────────────────────┘
```

**Recommended Test Config**:
- **Mode**: ATTENDED_LEVEL (pause after Level 0 completes)
- **Iterations**: 20 per section
- **Cost**: $0.50 per section, $5.00 total
- **Quality Gates**: All enabled
- **Parallel Workers**: 4 (matches Level 0 section count)

**Why This Config**:
- ✅ Attended mode allows inspection after Level 0
- ✅ Limits prevent runaway costs
- ✅ All quality gates validate system robustness
- ✅ Max parallelism tests concurrent execution

#### Step 2.2: Start Execution

**Action**: Click "Start with Config" button

**Expected Behavior**:
1. UI transitions to Execution Dashboard
2. Kanban board appears with 4 columns
3. 4 sections appear in "PENDING" column
4. Session ID generated and displayed
5. Checkpoint created at `.bvs/checkpoint.json`

**Initial UI State**:
```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│ BVS Execution: Ralph Loop Improvements (Level 0)      ⏱ 00:00  [⏸ Pause] [⏹ Stop] │
├─────────────────────────────────────────────────────────────────────────────────────┤
│ Progress: ░░░░░░░░░░░░░░░░░░░░ 0% (0/4 sections)    Workers: 🟢 Ready              │
├──────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│   PENDING (4)      IN PROGRESS (0)    VERIFYING (0)   DONE (0)                      │
│   ┌─────────┐                                                                       │
│   │ RALPH-  │                                                                       │
│   │  001    │                                                                       │
│   └─────────┘                                                                       │
│   ┌─────────┐                                                                       │
│   │ RALPH-  │                                                                       │
│   │  009    │                                                                       │
│   └─────────┘                                                                       │
│   ┌─────────┐                                                                       │
│   │ RALPH-  │                                                                       │
│   │  011    │                                                                       │
│   └─────────┘                                                                       │
│   ┌─────────┐                                                                       │
│   │ RALPH-  │                                                                       │
│   │  013    │                                                                       │
│   └─────────┘                                                                       │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

---

### Phase 3: Execution Monitoring

#### Step 3.1: Parallel Worker Startup

**Expected Behavior**:
- Orchestrator analyzes dependency graph
- Identifies Level 0 sections have no dependencies
- Spawns 4 workers in parallel
- Each worker gets assigned a section
- UI shows workers with distinct colors

**UI After Worker Spawn**:
```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│ BVS Execution: Ralph Loop Improvements (Level 0)      ⏱ 00:05  [⏸ Pause] [⏹ Stop] │
├─────────────────────────────────────────────────────────────────────────────────────┤
│ Progress: ████░░░░░░░░░░░░░░░░ 0% (0/4 sections)    Workers: 🟦🟩🟨🟪 4 active      │
├──────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│   PENDING (0)      IN PROGRESS (4)    VERIFYING (0)   DONE (0)                      │
│                    ┌─────────┐                                                      │
│                    │ 🟦      │                                                      │
│                    │ RALPH-  │                                                      │
│                    │  001    │                                                      │
│                    │ █░░░ 5% │                                                      │
│                    └─────────┘                                                      │
│                    ┌─────────┐                                                      │
│                    │ 🟩      │                                                      │
│                    │ RALPH-  │                                                      │
│                    │  009    │                                                      │
│                    │ ██░░ 10%│                                                      │
│                    └─────────┘                                                      │
│                    ┌─────────┐                                                      │
│                    │ 🟨      │                                                      │
│                    │ RALPH-  │                                                      │
│                    │  011    │                                                      │
│                    │ ░░░░ 0% │                                                      │
│                    └─────────┘                                                      │
│                    ┌─────────┐                                                      │
│                    │ 🟪      │                                                      │
│                    │ RALPH-  │                                                      │
│                    │  013    │                                                      │
│                    │ █░░░ 3% │                                                      │
│                    └─────────┘                                                      │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

**Worker Assignment**:
- 🟦 Worker 1 (Blue) → RALPH-001 (Add Subtask Types)
- 🟩 Worker 2 (Green) → RALPH-009 (Build Verification)
- 🟨 Worker 3 (Yellow) → RALPH-011 (SessionLimitError Class)
- 🟪 Worker 4 (Purple) → RALPH-013 (Plan Validator Service)

#### Step 3.2: Real-Time Progress Updates

**Expected Events**:
1. **File Operations** - Edit/Write tool calls visible in logs
2. **TypeCheck Feedback** - After each edit, TypeScript check runs
3. **Progress Bar Updates** - Section progress bars animate
4. **Console Logs** - Bottom panel shows worker output
5. **Toast Notifications** - Key events (section started, completed, failed)

**Click on Section Card** - Opens detail panel:
```
┌─────────────────────────────────────────────────────────────┐
│ Section Details: RALPH-001                        [✕ Close] │
├─────────────────────────────────────────────────────────────┤
│ Name: Add Subtask and Metrics Types                         │
│ Status: IN PROGRESS                                          │
│ Worker: 🟦 W1 (Blue)                                         │
│ Model: claude-sonnet-4.5                                     │
│                                                              │
│ Progress:                                                    │
│ ████████░░░░░░░░ 45% (Turn 3/15)                            │
│                                                              │
│ Files:                                                       │
│ ✓ src/shared/bvs-types.ts (modified)                        │
│                                                              │
│ Recent Activity:                                             │
│ 00:03 - Started execution                                    │
│ 00:05 - Read src/shared/bvs-types.ts                        │
│ 00:06 - Edit: Added BvsSubtask interface                    │
│ 00:07 - TypeCheck: ✓ Passed                                 │
│ 00:08 - Edit: Added SubtaskResult interface                 │
│ 00:09 - TypeCheck: ✓ Passed                                 │
│ 00:10 - Edit: Added BvsExecutionLimits interface            │
│ 00:11 - TypeCheck: ✓ Passed                                 │
│                                                              │
│ Cost: $0.03 / $0.50 limit                                    │
│ Tokens: 1,245 in, 3,890 out                                 │
│                                                              │
│ [View Full Logs]                                             │
└─────────────────────────────────────────────────────────────┘
```

**Validation Points**:
- ✅ Progress updates in real-time
- ✅ TypeCheck runs after each edit
- ✅ Logs show clear activity timeline
- ✅ Cost tracking increments correctly
- ✅ Worker colors remain consistent

#### Step 3.3: Section Completion

**Expected Behavior** (per section):
1. Implementation completes all file operations
2. Section moves to "VERIFYING" column
3. Quality gates run:
   - Full TypeCheck
   - Lint
   - Build (if build script exists)
   - Code review agents (parallel)
4. All gates pass → moves to "DONE" column
5. Git commit created with section ID
6. Next dependent section (if any) unblocks

**UI After First Section Completes**:
```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│ BVS Execution: Ralph Loop Improvements (Level 0)      ⏱ 08:23  [⏸ Pause] [⏹ Stop] │
├─────────────────────────────────────────────────────────────────────────────────────┤
│ Progress: ██████░░░░░░░░░░░░░░ 25% (1/4 sections)   Workers: 🟩🟨🟪 3 active       │
├──────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│   PENDING (0)      IN PROGRESS (2)    VERIFYING (1)   DONE (1)                      │
│                    ┌─────────┐       ┌─────────┐    ┌─────────┐                    │
│                    │ 🟩      │       │ 🟨      │    │ ✓       │                    │
│                    │ RALPH-  │       │ RALPH-  │    │ RALPH-  │                    │
│                    │  009    │       │  011    │    │  001    │                    │
│                    │ ████ 85%│       │Reviewing│    │ DONE    │                    │
│                    └─────────┘       └─────────┘    └─────────┘                    │
│                    ┌─────────┐                                                      │
│                    │ 🟪      │                                                      │
│                    │ RALPH-  │                                                      │
│                    │  013    │                                                      │
│                    │ ███░ 60%│                                                      │
│                    └─────────┘                                                      │
│                                                                                      │
│ 🔔 RALPH-001 completed successfully                                          [x]   │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

**Toast Notification**:
```
┌─────────────────────────────────────┐
│ ✅ Section Completed                │
│                                     │
│ RALPH-001: Add Subtask Types        │
│ ✓ TypeCheck passed                  │
│ ✓ Lint passed                       │
│ ✓ Build passed                      │
│ ✓ Code review: 0 issues             │
│                                     │
│ Cost: $0.08 | Time: 8m 23s          │
│ Commit: abc1234                     │
│                                     │
│ [View Details]                      │
└─────────────────────────────────────┘
```

**Git Verification**:
```bash
git log --oneline -1
# Expected: abc1234 feat(RALPH-001): Add Subtask and Metrics Types
```

---

### Phase 4: Level Completion & Pause

#### Step 4.1: All Level 0 Sections Complete

**Expected Final State**:
```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│ BVS Execution: Ralph Loop Improvements (Level 0)      ⏱ 32:15  [⏸ Pause] [⏹ Stop] │
├─────────────────────────────────────────────────────────────────────────────────────┤
│ Progress: ████████████████████ 100% (4/4 sections)  Workers: Idle                   │
├──────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│   PENDING (0)      IN PROGRESS (0)    VERIFYING (0)   DONE (4)                      │
│                                                       ┌─────────┐                    │
│                                                       │ ✓       │                    │
│                                                       │ RALPH-  │                    │
│                                                       │  001    │                    │
│                                                       └─────────┘                    │
│                                                       ┌─────────┐                    │
│                                                       │ ✓       │                    │
│                                                       │ RALPH-  │                    │
│                                                       │  009    │                    │
│                                                       └─────────┘                    │
│                                                       ┌─────────┐                    │
│                                                       │ ✓       │                    │
│                                                       │ RALPH-  │                    │
│                                                       │  011    │                    │
│                                                       └─────────┘                    │
│                                                       ┌─────────┐                    │
│                                                       │ ✓       │                    │
│                                                       │ RALPH-  │                    │
│                                                       │  013    │                    │
│                                                       └─────────┘                    │
│                                                                                      │
│ 🎉 Level 0 completed! All sections passed quality gates.                             │
│                                                                                      │
│ Summary:                                                                             │
│ - 4 sections completed                                                               │
│ - Total time: 32m 15s                                                                │
│ - Total cost: $0.31                                                                  │
│ - Avg cost per section: $0.08                                                        │
│ - All quality gates passed                                                           │
│ - 4 commits created                                                                  │
│                                                                                      │
│ Execution Mode: ATTENDED_LEVEL                                                       │
│ Next: Level 1 (6 sections) requires approval to continue                             │
│                                                                                      │
│ [Continue to Level 1] [Stop Here] [View Results]                                     │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

#### Step 4.2: Attended Mode Approval Dialog

**Modal Appears** (because mode is ATTENDED_LEVEL):
```
┌─────────────────────────────────────────────────────────────┐
│ Level Completion Checkpoint                                  │
├─────────────────────────────────────────────────────────────┤
│ Level 0 has completed successfully.                          │
│                                                              │
│ Results:                                                     │
│ ✓ 4/4 sections completed                                     │
│ ✓ All quality gates passed                                   │
│ ✓ No P0/P1 review issues                                     │
│ ✓ TypeCheck: 0 errors                                        │
│ ✓ Build: Success                                             │
│                                                              │
│ Next Level: Level 1                                          │
│ - 6 sections                                                 │
│ - Estimated time: 4-6 hours                                  │
│ - Estimated cost: $0.40-0.60                                 │
│ - Dependencies: All Level 0 sections ✓                       │
│                                                              │
│ Current Budget Remaining:                                    │
│ - Iterations: 80/100 (20 per section used)                   │
│ - Cost: $4.69/$5.00 remaining                                │
│                                                              │
│ Continue execution?                                          │
│                                                              │
│ [Continue] [Pause Here] [Modify Config] [Stop]               │
└─────────────────────────────────────────────────────────────┘
```

**Decision Point**: User chooses action

**Test Scenario**: Click "Pause Here" to test pause/resume functionality

#### Step 4.3: Pause Execution

**Action**: Click "Pause Here" button

**Expected Behavior**:
1. Checkpoint saved to `.bvs/checkpoint.json`
2. Session status updated to "paused"
3. UI shows "Paused" banner
4. Resume button appears

**Checkpoint File** (`.bvs/checkpoint.json`):
```json
{
  "planId": "ralph-loop-improvements",
  "planTitle": "Ralph Loop Improvements",
  "sessionId": "session-20260126-143022",
  "projectPath": "C:/claude_projects/claude-cli/claude-code-manager",
  "startedAt": 1737901822000,
  "pausedAt": 1737903757000,
  "status": "paused",
  "currentLevel": 0,
  "completedSections": [
    "RALPH-001",
    "RALPH-009",
    "RALPH-011",
    "RALPH-013"
  ],
  "completedLevels": [0],
  "nextLevel": 1,
  "config": {
    "mode": "ATTENDED_LEVEL",
    "limits": {
      "maxIterationsPerSection": 20,
      "maxCostPerSection": 0.50,
      "maxTotalCost": 5.00
    },
    "qualityGates": {
      "typecheck": true,
      "lint": true,
      "build": true,
      "codeReview": true
    },
    "parallel": {
      "maxWorkers": 4
    }
  },
  "metrics": {
    "totalTime": 1935000,
    "totalCost": 0.31,
    "sectionsCompleted": 4,
    "sectionsTotal": 4,
    "iterationsUsed": 20
  },
  "selectedLevels": [0],
  "selectedSections": [
    "RALPH-001",
    "RALPH-009",
    "RALPH-011",
    "RALPH-013"
  ]
}
```

**Paused UI State**:
```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│ BVS Execution: PAUSED                                 ⏱ 32:15  [▶ Resume] [⏹ Stop] │
├─────────────────────────────────────────────────────────────────────────────────────┤
│ ⏸ Execution paused at Level 0 completion                                            │
│                                                                                      │
│ Session: session-20260126-143022                                                     │
│ Started: Today 2:30 PM                                                               │
│ Paused: Today 3:02 PM                                                                │
│                                                                                      │
│ Progress:                                                                            │
│ Level 0: ████████████████████ 100% (4/4 sections) ✓ DONE                            │
│ Level 1: Pending (6 sections)                                                        │
│                                                                                      │
│ [Resume from Level 1] [View Summary] [Export Results]                                │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

---

### Phase 5: Resume Execution

#### Step 5.1: Close and Reopen App

**Test Persistence**:
1. Close Electron app completely
2. Reopen app
3. Navigate to BVS view
4. Verify paused session appears

**Expected UI** (on app reopening):
```
┌─────────────────────────────────────────────────────────────┐
│ BVS Sessions                                                 │
├─────────────────────────────────────────────────────────────┤
│ Active Sessions:                                             │
│                                                              │
│ ⏸ Paused Session                                             │
│ Ralph Loop Improvements                                      │
│ 4/17 sections completed (Level 0 done)                       │
│ Paused: 2 hours ago                                          │
│ Cost: $0.31 / $5.00                                          │
│                                                              │
│ [Resume] [View Details] [Delete]                             │
│                                                              │
│ ─────────────────────────────────────────────────────────    │
│                                                              │
│ [Start New Session]                                          │
└─────────────────────────────────────────────────────────────┘
```

#### Step 5.2: Resume from Checkpoint

**Action**: Click "Resume" button

**Expected Behavior**:
1. Checkpoint loaded from file
2. Session state restored
3. UI returns to execution dashboard
4. Shows completed sections in "DONE" column
5. Shows approval dialog for Level 1

**Resume Flow**:
```
Load checkpoint.json
  ↓
Restore session state:
  - Plan loaded
  - Completed sections marked done
  - Current level identified (1)
  - Config restored
  ↓
Show execution dashboard with completed work
  ↓
Prompt for next level approval (ATTENDED_LEVEL mode)
```

**UI After Resume**:
```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│ BVS Execution: Ralph Loop Improvements (Resumed)      ⏱ 00:00  [⏸ Pause] [⏹ Stop] │
├─────────────────────────────────────────────────────────────────────────────────────┤
│ Session resumed from Level 0 checkpoint                                              │
│                                                                                      │
│   PENDING (0)      IN PROGRESS (0)    VERIFYING (0)   DONE (4)                      │
│                                                       ┌─────────┐                    │
│                                                       │ ✓       │                    │
│                                                       │ RALPH-  │                    │
│                                                       │  001    │                    │
│                                                       └─────────┘                    │
│                                                       ┌─────────┐                    │
│                                                       │ ✓       │                    │
│                                                       │ RALPH-  │                    │
│                                                       │  009    │                    │
│                                                       └─────────┘                    │
│                                                       ┌─────────┐                    │
│                                                       │ ✓       │                    │
│                                                       │ RALPH-  │                    │
│                                                       │  011    │                    │
│                                                       └─────────┘                    │
│                                                       ┌─────────┐                    │
│                                                       │ ✓       │                    │
│                                                       │ RALPH-  │                    │
│                                                       │  013    │                    │
│                                                       └─────────┘                    │
│                                                                                      │
│ Ready to continue with Level 1 (6 sections)                                          │
│                                                                                      │
│ [Continue to Level 1]                                                                │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

**Validation**:
- ✅ Checkpoint loaded successfully
- ✅ All completed sections show as DONE
- ✅ Progress tracking restored
- ✅ Config settings preserved
- ✅ Cost tracking continues from previous total

---

### Phase 6: Error Handling Test (Optional)

#### Step 6.1: Simulate TypeCheck Failure

**Test Scenario**: Introduce intentional type error to verify quality gates

**Manual Edit**:
1. During execution, manually edit a file being modified
2. Introduce type error (e.g., wrong type annotation)
3. Watch for immediate TypeCheck failure
4. Verify worker retries up to 3 times
5. Verify worker reports failure if not fixed

**Expected Behavior**:
- Worker immediately detects TypeCheck error
- Shows error in UI with file:line reference
- Worker attempts retry with error context
- If retry fails 3 times, section marked as failed
- User can choose to skip or manually fix

**Error UI**:
```
┌─────────────────────────────────────────────────────────────┐
│ Section Failed: RALPH-001                         [✕ Close] │
├─────────────────────────────────────────────────────────────┤
│ ❌ TypeCheck failed after 3 retry attempts                   │
│                                                              │
│ Error:                                                       │
│ src/shared/bvs-types.ts:45:12 - error TS2322:               │
│ Type 'string' is not assignable to type 'number'.           │
│                                                              │
│ 45   maxTurns: "invalid"                                     │
│                ~~~~~~~~~~                                    │
│                                                              │
│ Retry History:                                               │
│ - Attempt 1: Failed (same error)                             │
│ - Attempt 2: Failed (different error introduced)             │
│ - Attempt 3: Failed (same error persists)                    │
│                                                              │
│ Cost: $0.12 (3 retry attempts)                               │
│                                                              │
│ Actions:                                                     │
│ [Manual Fix Required] [Skip Section] [View Full Logs]        │
└─────────────────────────────────────────────────────────────┘
```

---

## Test Checklist

### Pre-Execution
- [ ] Electron app runs without errors
- [ ] BVS view accessible
- [ ] Plan loads and displays correctly
- [ ] Dependency graph renders properly
- [ ] Can select subset of levels/sections
- [ ] Config UI shows all options

### During Execution
- [ ] Workers spawn in parallel
- [ ] Section cards move between columns
- [ ] Progress bars update in real-time
- [ ] Worker colors remain consistent
- [ ] TypeCheck runs after each edit
- [ ] Console logs show activity
- [ ] Toast notifications appear for key events
- [ ] Click on section opens detail panel
- [ ] Cost tracking increments correctly
- [ ] Timer updates every second

### Quality Gates
- [ ] TypeCheck catches errors immediately
- [ ] Lint runs at section end
- [ ] Build verification executes (if configured)
- [ ] Code review agents run in parallel
- [ ] Review results displayed with P0/P1/P2 priorities
- [ ] All gates must pass before "DONE"

### Section Completion
- [ ] Section moves to VERIFYING column
- [ ] All quality gates execute
- [ ] Git commit created with proper message
- [ ] Section moves to DONE column with checkmark
- [ ] Completion toast appears
- [ ] Next dependent sections unblock

### Level Completion (ATTENDED_LEVEL mode)
- [ ] Approval dialog appears
- [ ] Shows summary of completed sections
- [ ] Shows next level info
- [ ] Budget remaining displayed
- [ ] Can choose: Continue, Pause, Modify Config, Stop

### Pause/Resume
- [ ] Pause creates checkpoint file
- [ ] Checkpoint contains all necessary state
- [ ] UI shows "Paused" banner
- [ ] Can close app while paused
- [ ] On reopen, paused session appears
- [ ] Resume loads checkpoint correctly
- [ ] Completed sections remain in DONE
- [ ] Can continue from next level

### Error Handling
- [ ] TypeCheck failure detected immediately
- [ ] Retry logic attempts up to 3 times
- [ ] After 3 failures, section marked failed
- [ ] Error details shown with file:line reference
- [ ] User can choose to skip or fix manually
- [ ] Failed sections logged to checkpoint

### Parallel Execution
- [ ] Multiple workers active simultaneously
- [ ] No race conditions or conflicts
- [ ] Workers complete at different times
- [ ] UI handles async updates correctly
- [ ] Merge happens after all workers finish

---

## Manual Test Steps

### Test Run: Level 0 Only (4 Sections)

**Duration**: ~30-45 minutes
**Scope**: RALPH-001, RALPH-009, RALPH-011, RALPH-013

1. **Start**:
   ```
   Open Electron app → BVS view → Load plan → Select Level 0 only
   ```

2. **Configure**:
   ```
   Mode: ATTENDED_LEVEL
   Iterations: 20 per section
   Cost: $0.50 per section
   Quality Gates: All enabled
   Parallel Workers: 4
   ```

3. **Execute**:
   ```
   Click "Start with Config" → Watch Kanban board
   ```

4. **Monitor**:
   ```
   - Observe 4 workers spawn
   - Watch sections move through columns
   - Click on sections to view details
   - Verify TypeCheck runs after edits
   - Check console logs for activity
   ```

5. **Pause**:
   ```
   When Level 0 completes → Click "Pause Here"
   ```

6. **Close and Reopen**:
   ```
   Close app → Reopen → Navigate to BVS → Verify paused session
   ```

7. **Resume**:
   ```
   Click "Resume" → Verify state restored → View completed sections
   ```

8. **Verify Git**:
   ```bash
   git log --oneline -4
   # Should see 4 commits for Level 0 sections
   ```

9. **Verify Files**:
   ```bash
   # Check that types were actually added
   cat src/shared/bvs-types.ts | grep BvsSubtask
   cat src/main/services/bvs-quality-gate-service.ts | grep runBuild
   ```

---

## Success Metrics

### Functional
- ✅ All 4 Level 0 sections complete successfully
- ✅ All quality gates pass
- ✅ 4 git commits created
- ✅ Checkpoint save/restore works
- ✅ Parallel execution faster than sequential
- ✅ No crashes or errors

### Performance
- ✅ Parallel sections complete in <15 minutes each
- ✅ Total Level 0 time <45 minutes
- ✅ Cost per section <$0.15
- ✅ Total cost <$0.50

### UI/UX
- ✅ Real-time updates smooth (no lag)
- ✅ Worker colors clear and consistent
- ✅ Progress bars accurate
- ✅ Toast notifications timely
- ✅ Detail panels informative
- ✅ Logs readable and useful

---

## Next Steps After Test

### If Test Passes:
1. Continue with Level 1 (6 sections)
2. Test Level 1 execution and completion
3. Eventually complete all 17 sections
4. Validate full plan execution end-to-end

### If Test Fails:
1. Document failure mode (screenshot, logs)
2. Identify root cause (orchestrator, worker, UI, etc.)
3. Fix issue
4. Re-run test from checkpoint or start
5. Iterate until test passes

### After All Tests Pass:
1. Create new plan for agent enhancements (work-researcher, work-explorer, work-analyst)
2. Test that plan with BVS system
3. Validate new agents work correctly
4. Measure improvement in code quality and cost

---

## Discussion Points

### Questions for User:

1. **Execution Scope**: Do you want to test just Level 0 (4 sections, ~30 min), or multiple levels?

2. **Execution Mode**: Should we use ATTENDED_LEVEL (pause after each level), ATTENDED_SINGLE (pause after each section), or UNATTENDED (fully automated)?

3. **Error Testing**: Should we intentionally introduce errors to test retry logic and error handling?

4. **Parallel Workers**: Level 0 has 4 sections - do you want to test with 4 parallel workers, or reduce to test sequential behavior?

5. **Quality Gates**: Should we enable all gates (TypeCheck, Lint, Build, Code Review), or disable some for faster testing?

6. **Resume Testing**: Should we pause after Level 0 and test resume, or continue through multiple levels?

### Recommendations:

**For Initial Test Run**:
- ✅ Scope: Level 0 only (4 sections)
- ✅ Mode: ATTENDED_LEVEL (pause after Level 0)
- ✅ Workers: 4 (test max parallelism)
- ✅ Quality Gates: All enabled (test full system)
- ✅ Resume: Yes (pause after Level 0, close app, reopen, resume)

**Rationale**: This tests all core functionality (parallel execution, quality gates, pause/resume) with minimal time investment (~30-45 minutes).

---

## Ready to Start?

Once you confirm the test parameters, I can:
1. Start the Electron dev server if not running
2. Navigate to BVS view
3. Load the Ralph Loop plan
4. Configure execution settings
5. Start execution with Level 0
6. Monitor progress and provide real-time updates
7. Help diagnose any issues that arise
8. Validate checkpoint save/resume functionality

Please confirm:
- Which levels/sections to execute
- Execution mode preference
- Whether to test error handling
- Any specific aspects to focus on during testing

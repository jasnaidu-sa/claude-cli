# Phase Selection UI Implementation

## Overview

The BVS system currently loads and displays plans but **lacks a UI component for selecting which phases/sections to execute** before starting. This document outlines the implementation needed to add this critical feature.

---

## Current State Analysis

### What Works
✅ Plans load from `.bvs/projects/<project-id>/project.json`
✅ Kanban board displays all sections
✅ Execution can start with full plan
✅ Dependency graph calculated correctly

### What's Missing
❌ No UI to select subset of phases before execution
❌ No way to execute only Phase 1, or Phases 1-3
❌ No cost/time estimation for selected phases
❌ No validation that selected phases have dependencies met

---

## ERP Budgeting Module Plan Structure

Based on your screenshot, the plan has **15 sections** organized (likely) in phases. To find the actual file:

### Location
```
<your-erp-project>/.bvs/projects/<project-id>/project.json
```

### Expected Structure
```json
{
  "id": "erp-budgeting-migration-xyz",
  "name": "ERP Budgeting Module",
  "description": "Migrate budgeting functionality from planning system to ERP",
  "status": "ready",
  "createdAt": 1737901822000,
  "updatedAt": 1737901822000,
  "plan": {
    "title": "ERP Budgeting Module",
    "description": "Move budget management from planning to ERP system",
    "sections": [
      {
        "id": "BUDGET-001",
        "name": "Database Schema - Budget Core Tables",
        "phase": 1,
        "files": [...],
        "dependencies": []
      },
      {
        "id": "BUDGET-002",
        "name": "Database Schema - Templates & Variance",
        "phase": 1,
        "files": [...],
        "dependencies": ["BUDGET-001"]
      },
      // ... 13 more sections
    ],
    "phases": [
      {
        "phaseNumber": 1,
        "name": "Database Foundation",
        "sections": ["BUDGET-001", "BUDGET-002"],
        "estimatedHours": 4
      },
      {
        "phaseNumber": 2,
        "name": "API Layer",
        "sections": ["BUDGET-003", "BUDGET-004", "BUDGET-005"],
        "estimatedHours": 6
      },
      {
        "phaseNumber": 3,
        "name": "Business Logic",
        "sections": ["BUDGET-006", "BUDGET-007", "BUDGET-008"],
        "estimatedHours": 8
      },
      {
        "phaseNumber": 4,
        "name": "UI Components",
        "sections": ["BUDGET-009", "BUDGET-010", "BUDGET-011"],
        "estimatedHours": 6
      },
      {
        "phaseNumber": 5,
        "name": "Integration & Polish",
        "sections": ["BUDGET-012", "BUDGET-013", "BUDGET-014", "BUDGET-015"],
        "estimatedHours": 4
      }
    ]
  }
}
```

---

## Required Implementation

### Component 1: Phase Selection Modal

**File**: `src/renderer/components/bvs/BvsPhaseSelector.tsx`

```tsx
import React, { useState, useMemo } from 'react'
import { Check, Clock, DollarSign, AlertTriangle } from 'lucide-react'
import { Button } from '../ui/button'
import type { BvsExecutionPlan, BvsSection } from '@shared/bvs-types'

interface Phase {
  phaseNumber: number
  name: string
  sections: string[]  // Section IDs
  estimatedHours: number
  estimatedCost: number
}

interface PhaseSelectionProps {
  plan: BvsExecutionPlan
  onConfirm: (config: ExecutionConfig) => void
  onCancel: () => void
}

interface ExecutionConfig {
  selectedPhases: number[]
  selectedSections: string[]
  estimatedHours: number
  estimatedCost: number
}

export function BvsPhaseSelector({ plan, onConfirm, onCancel }: PhaseSelectionProps) {
  // Extract phases from plan (or derive from sections if not explicitly defined)
  const phases = useMemo(() => derivePhases(plan), [plan])

  const [selectedPhases, setSelectedPhases] = useState<Set<number>>(new Set())
  const [selectionMode, setSelectionMode] = useState<'all' | 'custom'>('custom')

  // Toggle phase selection
  const togglePhase = (phaseNumber: number) => {
    setSelectedPhases(prev => {
      const next = new Set(prev)
      if (next.has(phaseNumber)) {
        next.delete(phaseNumber)
      } else {
        next.add(phaseNumber)
      }
      return next
    })
  }

  // Calculate selected sections based on phases
  const selectedSections = useMemo(() => {
    if (selectionMode === 'all') {
      return plan.sections.map(s => s.id)
    }
    const sections: string[] = []
    phases.forEach(phase => {
      if (selectedPhases.has(phase.phaseNumber)) {
        sections.push(...phase.sections)
      }
    })
    return sections
  }, [selectedPhases, phases, plan.sections, selectionMode])

  // Calculate totals
  const totals = useMemo(() => {
    const selectedPhasesList = Array.from(selectedPhases)
      .map(num => phases.find(p => p.phaseNumber === num))
      .filter(Boolean) as Phase[]

    return {
      hours: selectedPhasesList.reduce((sum, p) => sum + p.estimatedHours, 0),
      cost: selectedPhasesList.reduce((sum, p) => sum + p.estimatedCost, 0),
      sections: selectedSections.length
    }
  }, [selectedPhases, phases, selectedSections])

  // Validate dependencies
  const validation = useMemo(() => {
    return validatePhaseSelection(plan.sections, selectedSections)
  }, [plan.sections, selectedSections])

  const handleConfirm = () => {
    if (!validation.valid) {
      alert(validation.error)
      return
    }

    onConfirm({
      selectedPhases: Array.from(selectedPhases),
      selectedSections,
      estimatedHours: totals.hours,
      estimatedCost: totals.cost
    })
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-3xl w-full max-h-[80vh] overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
            Select Phases to Execute
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            {plan.title} • {plan.sections.length} sections across {phases.length} phases
          </p>
        </div>

        {/* Body */}
        <div className="px-6 py-4 overflow-y-auto max-h-[50vh]">
          {/* Selection Mode */}
          <div className="flex gap-4 mb-6">
            <label className="flex items-center cursor-pointer">
              <input
                type="radio"
                checked={selectionMode === 'all'}
                onChange={() => setSelectionMode('all')}
                className="mr-2"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">
                All Phases ({plan.sections.length} sections)
              </span>
            </label>
            <label className="flex items-center cursor-pointer">
              <input
                type="radio"
                checked={selectionMode === 'custom'}
                onChange={() => setSelectionMode('custom')}
                className="mr-2"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">
                Custom Selection
              </span>
            </label>
          </div>

          {/* Phase List */}
          {selectionMode === 'custom' && (
            <div className="space-y-3">
              {phases.map(phase => {
                const isSelected = selectedPhases.has(phase.phaseNumber)
                const phaseSections = plan.sections.filter(s =>
                  phase.sections.includes(s.id)
                )

                return (
                  <div
                    key={phase.phaseNumber}
                    onClick={() => togglePhase(phase.phaseNumber)}
                    className={`
                      border rounded-lg p-4 cursor-pointer transition-all
                      ${isSelected
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                        : 'border-gray-300 dark:border-gray-600 hover:border-gray-400'
                      }
                    `}
                  >
                    <div className="flex items-start gap-3">
                      {/* Checkbox */}
                      <div className={`
                        w-5 h-5 rounded border-2 flex items-center justify-center mt-0.5
                        ${isSelected
                          ? 'bg-blue-500 border-blue-500'
                          : 'border-gray-400 dark:border-gray-500'
                        }
                      `}>
                        {isSelected && <Check className="w-3 h-3 text-white" />}
                      </div>

                      {/* Content */}
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-2">
                          <h3 className="font-medium text-gray-900 dark:text-white">
                            Phase {phase.phaseNumber}: {phase.name}
                          </h3>
                          <div className="flex items-center gap-4 text-sm text-gray-600 dark:text-gray-400">
                            <span className="flex items-center gap-1">
                              <Clock className="w-4 h-4" />
                              {phase.estimatedHours}h
                            </span>
                            <span className="flex items-center gap-1">
                              <DollarSign className="w-4 h-4" />
                              ${phase.estimatedCost.toFixed(2)}
                            </span>
                          </div>
                        </div>

                        <div className="text-sm text-gray-600 dark:text-gray-400">
                          {phaseSections.length} sections: {phaseSections.map(s => s.name).join(', ')}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Validation Warnings */}
          {!validation.valid && (
            <div className="mt-4 p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-300 dark:border-yellow-700 rounded-lg">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-5 h-5 text-yellow-600 dark:text-yellow-400 mt-0.5" />
                <div>
                  <h4 className="font-medium text-yellow-800 dark:text-yellow-200">
                    Dependency Warning
                  </h4>
                  <p className="text-sm text-yellow-700 dark:text-yellow-300 mt-1">
                    {validation.error}
                  </p>
                  {validation.missingSections && validation.missingSections.length > 0 && (
                    <ul className="mt-2 text-sm text-yellow-700 dark:text-yellow-300 list-disc list-inside">
                      {validation.missingSections.map(section => (
                        <li key={section.id}>
                          {section.name} (required by selected sections)
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
          {/* Summary */}
          <div className="flex items-center justify-between mb-4">
            <div className="text-sm text-gray-600 dark:text-gray-400">
              <span className="font-medium text-gray-900 dark:text-white">
                Selected: {totals.sections} sections
              </span>
              {selectionMode === 'custom' && (
                <span> across {selectedPhases.size} phases</span>
              )}
            </div>
            <div className="flex items-center gap-4 text-sm">
              <span className="flex items-center gap-1 text-gray-700 dark:text-gray-300">
                <Clock className="w-4 h-4" />
                <span className="font-medium">{totals.hours}h</span>
              </span>
              <span className="flex items-center gap-1 text-gray-700 dark:text-gray-300">
                <DollarSign className="w-4 h-4" />
                <span className="font-medium">${totals.cost.toFixed(2)}</span>
              </span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3">
            <Button
              variant="outline"
              onClick={onCancel}
            >
              Cancel
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={totals.sections === 0 || !validation.valid}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              Configure & Start Execution
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Derive phases from plan structure
 * If plan has explicit phases, use them
 * Otherwise, infer from section metadata
 */
function derivePhases(plan: BvsExecutionPlan): Phase[] {
  // Check if plan has explicit phases
  if ((plan as any).phases) {
    return (plan as any).phases.map((p: any) => ({
      ...p,
      estimatedCost: p.estimatedCost || estimatePhasesCost(p.sections.length)
    }))
  }

  // Otherwise, derive from dependency graph levels
  const graph = plan.dependencyGraph
  if (!graph || !graph.levels) {
    // Fallback: treat all sections as one phase
    return [{
      phaseNumber: 1,
      name: 'All Sections',
      sections: plan.sections.map(s => s.id),
      estimatedHours: plan.sections.length * 2, // rough estimate
      estimatedCost: estimatePhaseCost(plan.sections.length)
    }]
  }

  // Create phases from dependency levels
  return graph.levels.map((levelSections, index) => ({
    phaseNumber: index,
    name: `Level ${index}`,
    sections: levelSections,
    estimatedHours: levelSections.length * 2,
    estimatedCost: estimatePhaseCost(levelSections.length)
  }))
}

/**
 * Estimate cost based on number of sections
 */
function estimatePhaseCost(sectionCount: number): number {
  // Rough estimate: $0.10 per section
  return sectionCount * 0.10
}

/**
 * Validate that selected sections have all dependencies met
 */
function validatePhaseSelection(
  allSections: BvsSection[],
  selectedSectionIds: string[]
): { valid: boolean; error?: string; missingSections?: BvsSection[] } {
  const selectedSet = new Set(selectedSectionIds)
  const missingSections: BvsSection[] = []

  for (const sectionId of selectedSectionIds) {
    const section = allSections.find(s => s.id === sectionId)
    if (!section) continue

    // Check if all dependencies are selected
    for (const depId of section.dependencies) {
      if (!selectedSet.has(depId)) {
        const depSection = allSections.find(s => s.id === depId)
        if (depSection && !missingSections.find(s => s.id === depId)) {
          missingSections.push(depSection)
        }
      }
    }
  }

  if (missingSections.length > 0) {
    return {
      valid: false,
      error: `${missingSections.length} required dependencies are not selected`,
      missingSections
    }
  }

  return { valid: true }
}
```

---

### Component 2: Integration with Execution Flow

**File**: `src/renderer/components/bvs/BvsExecutionDashboard.tsx`

**Modifications Needed**:

```tsx
// Add import
import { BvsPhaseSelector } from './BvsPhaseSelector'

// Add state
const [showPhaseSelector, setShowPhaseSelector] = useState(false)
const [executionConfig, setExecutionConfig] = useState<ExecutionConfig | null>(null)

// Modify start execution flow
const handleStartExecution = () => {
  // Instead of starting immediately, show phase selector
  setShowPhaseSelector(true)
}

const handlePhaseSelectionConfirm = (config: ExecutionConfig) => {
  setExecutionConfig(config)
  setShowPhaseSelector(false)

  // Start execution with selected configuration
  startExecutionWithConfig(config)
}

// In render
return (
  <>
    {/* Existing dashboard UI */}
    <div>
      {/* ... existing content */}
      <Button onClick={handleStartExecution}>
        Start Execution
      </Button>
    </div>

    {/* Phase Selector Modal */}
    {showPhaseSelector && (
      <BvsPhaseSelector
        plan={currentPlan}
        onConfirm={handlePhaseSelectionConfirm}
        onCancel={() => setShowPhaseSelector(false)}
      />
    )}
  </>
)
```

---

### Component 3: Backend Support

**File**: `src/main/services/bvs-orchestrator-service.ts`

**Modifications Needed**:

```typescript
/**
 * Start execution with phase/section selection
 */
async executeSelectedSections(
  projectPath: string,
  sessionId: string,
  selectedSectionIds: string[],
  config: BvsExecutionConfig
): Promise<void> {
  // Load full plan
  const plan = await this.loadPlan(projectPath, sessionId)

  // Filter sections to only selected ones
  const selectedSections = plan.sections.filter(s =>
    selectedSectionIds.includes(s.id)
  )

  // Create filtered plan
  const filteredPlan: BvsExecutionPlan = {
    ...plan,
    sections: selectedSections
  }

  // Rebuild dependency graph for selected sections only
  filteredPlan.dependencyGraph = this.buildDependencyGraph(selectedSections)

  // Execute with filtered plan
  await this.executeWithMergePoints(projectPath, filteredPlan, config)
}
```

---

### Component 4: IPC Handler

**File**: `src/main/ipc/bvs-handlers.ts`

**Add Handler**:

```typescript
ipcMain.handle(
  'bvs:start-execution-with-selection',
  async (
    _event: IpcMainInvokeEvent,
    projectPath: string,
    sessionId: string,
    selectedSectionIds: string[],
    config: BvsExecutionConfig
  ) => {
    try {
      const orchestrator = getBvsOrchestratorService()
      await orchestrator.executeSelectedSections(
        projectPath,
        sessionId,
        selectedSectionIds,
        config
      )
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: message }
    }
  }
)
```

---

### Component 5: Preload API

**File**: `src/preload/index.ts`

**Add Method**:

```typescript
bvs: {
  // ... existing methods

  startExecutionWithSelection: (
    projectPath: string,
    sessionId: string,
    selectedSectionIds: string[],
    config: BvsExecutionConfig
  ) => ipcRenderer.invoke(
    'bvs:start-execution-with-selection',
    projectPath,
    sessionId,
    selectedSectionIds,
    config
  )
}
```

---

## Implementation Checklist

### Phase 1: UI Component (2-3 hours)
- [ ] Create `BvsPhaseSelector.tsx` component
- [ ] Add phase derivation logic
- [ ] Add dependency validation
- [ ] Add cost/time estimation
- [ ] Style with Tailwind
- [ ] Test with mock data

### Phase 2: Integration (1-2 hours)
- [ ] Modify `BvsExecutionDashboard.tsx`
- [ ] Add phase selector trigger
- [ ] Wire up confirmation flow
- [ ] Handle cancel action

### Phase 3: Backend (2-3 hours)
- [ ] Add `executeSelectedSections` to orchestrator
- [ ] Implement section filtering
- [ ] Rebuild dependency graph for subset
- [ ] Test execution with selected sections

### Phase 4: IPC/Preload (30 min)
- [ ] Add IPC handler
- [ ] Add preload API method
- [ ] Update TypeScript types

### Phase 5: Testing (1-2 hours)
- [ ] Test with ERP Budgeting Module plan
- [ ] Test selecting single phase
- [ ] Test selecting multiple phases
- [ ] Test dependency validation
- [ ] Test execution with subset
- [ ] Test pause/resume with selected sections

---

## Test Workflow with Phase Selection

### Step 1: Load ERP Budgeting Module Plan

**Expected**: Plan loads showing all 15 sections in PENDING

### Step 2: Click "Start Execution" Button

**Expected**: Phase selector modal appears

**UI Display**:
```
┌─────────────────────────────────────────────────────────────┐
│ Select Phases to Execute                                    │
│ ERP Budgeting Module • 15 sections across 5 phases          │
├─────────────────────────────────────────────────────────────┤
│ ○ All Phases (15 sections)                                  │
│ ● Custom Selection:                                         │
│                                                              │
│ ┌──────────────────────────────────────────────────────────┐│
│ │ ✓ Phase 1: Database Foundation                2h  $0.20 ││
│ │   2 sections: Database Schema - Budget Core Tables,     ││
│ │   Database Schema - Templates & Variance                ││
│ └──────────────────────────────────────────────────────────┘│
│ ┌──────────────────────────────────────────────────────────┐│
│ │ ✓ Phase 2: API Layer                          4h  $0.30 ││
│ │   3 sections: API Routes - Budget CRUD Operations,      ││
│ │   Workflow Integration - Budget Approval, etc.          ││
│ └──────────────────────────────────────────────────────────┘│
│ ┌──────────────────────────────────────────────────────────┐│
│ │   Phase 3: Business Logic                     6h  $0.30 ││
│ │   3 sections: Reforecast Automation, Variance Analysis  ││
│ └──────────────────────────────────────────────────────────┘│
│                                                              │
│ Selected: 5 sections across 2 phases    6h    $0.50         │
│                                                              │
│ [Cancel] [Configure & Start Execution]                      │
└─────────────────────────────────────────────────────────────┘
```

### Step 3: Select Phases 1-2

**User Action**: Check Phase 1 and Phase 2 checkboxes

**Expected**:
- Summary updates: "5 sections across 2 phases"
- Time estimate: 6 hours
- Cost estimate: $0.50
- Dependencies validated (all Phase 2 dependencies in Phase 1)

### Step 4: Click "Configure & Start Execution"

**Expected**: Modal closes, execution config modal appears

### Step 5: Configure Execution Settings

**Same as before**: ATTENDED_LEVEL mode, limits, quality gates

### Step 6: Execution Starts with Only Selected Sections

**Expected**:
- Only sections from Phase 1 and Phase 2 execute
- Kanban shows only 5 sections total
- Phase 3-5 sections not loaded
- Execution completes after Phase 2
- Can later load and execute Phase 3-5 separately

---

## Finding Your ERP Plan File

To find the actual ERP Budgeting Module plan file on your system:

```bash
# Search for any BVS project directories
find ~ -type d -name ".bvs" 2>/dev/null

# Or search for the specific plan name
grep -r "ERP Budgeting Module" --include="*.json" 2>/dev/null

# Check common project locations
ls -la ~/projects/*/.bvs/projects/*/project.json 2>/dev/null
ls -la C:/projects/*/.bvs/projects/*/project.json 2>/dev/null
```

Once found, you can:
1. Copy the plan to claude-code-manager for testing
2. Or point the test to the actual ERP project directory

---

## Discussion Points

### Questions:

1. **ERP Plan Location**: Where is your actual ERP project located? We need to find the `.bvs/projects/*/project.json` file to see the full plan structure.

2. **Phase Organization**: Are the 15 sections already organized into explicit phases in the plan JSON, or should we derive phases from the dependency graph?

3. **Implementation Order**: Should I implement the Phase Selection UI first, or would you like to test with the current system (all sections) first to validate the workflow?

4. **Test Scope**: For initial testing, do you want to execute:
   - Just Phase 1 (Foundation)
   - Phases 1-2 (Foundation + API)
   - All 15 sections

### Recommendations:

**Option A: Implement Phase Selection First** (3-4 hours work)
- Build the UI component
- Add backend filtering
- Test with ERP plan

**Option B: Test Current System First** (30 minutes)
- Load ERP plan
- Execute all 15 sections
- Validate workflow end-to-end
- Then add phase selection

**My Recommendation**: **Option B** - Test the full workflow first to ensure everything works, then add phase selection as an enhancement. This way you can validate the core BVS functionality with your real-world ERP plan before adding complexity.

Let me know:
1. Where to find your ERP plan file
2. Whether to implement phase selection first or test current system
3. Which phases you want to execute for testing

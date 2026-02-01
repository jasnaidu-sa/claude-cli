/**
 * BVS Phase Selector - UI for selecting which phases/sections to execute
 *
 * Features:
 * - Phase-based selection with checkboxes
 * - Dependency validation (ensures selected sections have prerequisites)
 * - Cost and time estimation per phase
 * - Selection modes: All phases vs Custom selection
 */

import React, { useState, useMemo } from 'react'
import { Check, Clock, DollarSign, AlertTriangle, X } from 'lucide-react'
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

export interface ExecutionConfig {
  selectedPhases: number[]
  selectedSections: string[]
  estimatedHours: number
  estimatedCost: number
}

export function BvsPhaseSelector({ plan, onConfirm, onCancel }: PhaseSelectionProps) {
  // Extract phases from plan (or derive from sections if not explicitly defined)
  const phases = useMemo(() => {
    console.log('[BvsPhaseSelector] Plan structure:', {
      hasPlanPhases: !!(plan as any).phases,
      planPhases: (plan as any).phases,
      hasDependencyGraph: !!plan.dependencyGraph,
      dependencyGraphLevels: plan.dependencyGraph?.levels,
      sectionsCount: plan.sections.length,
      sections: plan.sections
    })
    return derivePhases(plan)
  }, [plan])

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
        // Ensure phase.sections is an array
        const sectionIds = Array.isArray(phase.sections) ? phase.sections : []
        sections.push(...sectionIds)
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
      <div className="bg-background rounded-lg shadow-xl max-w-3xl w-full max-h-[80vh] overflow-hidden border border-border">
        {/* Header */}
        <div className="px-6 py-4 border-b border-border">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-foreground">
                Select Phases to Execute
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                {plan.title} • {plan.sections.length} sections across {phases.length} phases
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={onCancel}>
              <X className="h-4 w-4" />
            </Button>
          </div>
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
              <span className="text-sm text-foreground">
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
              <span className="text-sm text-foreground">
                Custom Selection
              </span>
            </label>
          </div>

          {/* Phase List */}
          {selectionMode === 'custom' && (
            <div className="space-y-3">
              {phases.map(phase => {
                const isSelected = selectedPhases.has(phase.phaseNumber)
                // Ensure phase.sections is an array
                const sectionIds = Array.isArray(phase.sections) ? phase.sections : []
                const phaseSections = plan.sections.filter(s =>
                  sectionIds.includes(s.id)
                )

                return (
                  <div
                    key={phase.phaseNumber}
                    onClick={() => togglePhase(phase.phaseNumber)}
                    className={`
                      border rounded-lg p-4 cursor-pointer transition-all
                      ${isSelected
                        ? 'border-primary bg-primary/10'
                        : 'border-border hover:border-primary/50'
                      }
                    `}
                  >
                    <div className="flex items-start gap-3">
                      {/* Checkbox */}
                      <div className={`
                        w-5 h-5 rounded border-2 flex items-center justify-center mt-0.5
                        ${isSelected
                          ? 'bg-primary border-primary'
                          : 'border-muted-foreground'
                        }
                      `}>
                        {isSelected && <Check className="w-3 h-3 text-primary-foreground" />}
                      </div>

                      {/* Content */}
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-2">
                          <h3 className="font-medium text-foreground">
                            Phase {phase.phaseNumber}: {phase.name}
                          </h3>
                          <div className="flex items-center gap-4 text-sm text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Clock className="w-4 h-4" />
                              {phase.estimatedHours || 0}h
                            </span>
                            <span className="flex items-center gap-1">
                              <DollarSign className="w-4 h-4" />
                              ${(phase.estimatedCost || 0).toFixed(2)}
                            </span>
                          </div>
                        </div>

                        <div className="text-sm text-muted-foreground">
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
            <div className="mt-4 p-4 bg-destructive/10 border border-destructive/50 rounded-lg">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-5 h-5 text-destructive mt-0.5" />
                <div>
                  <h4 className="font-medium text-destructive">
                    Dependency Warning
                  </h4>
                  <p className="text-sm text-destructive mt-1">
                    {validation.error}
                  </p>
                  {validation.missingSections && validation.missingSections.length > 0 && (
                    <ul className="mt-2 text-sm text-destructive list-disc list-inside">
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
        <div className="px-6 py-4 border-t border-border bg-muted/30">
          {/* Summary */}
          <div className="flex items-center justify-between mb-4">
            <div className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">
                Selected: {totals.sections} sections
              </span>
              {selectionMode === 'custom' && (
                <span> across {selectedPhases.size} phases</span>
              )}
            </div>
            <div className="flex items-center gap-4 text-sm">
              <span className="flex items-center gap-1 text-foreground">
                <Clock className="w-4 h-4" />
                <span className="font-medium">{totals.hours || 0}h</span>
              </span>
              <span className="flex items-center gap-1 text-foreground">
                <DollarSign className="w-4 h-4" />
                <span className="font-medium">${(totals.cost || 0).toFixed(2)}</span>
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
              Start Execution
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
 * Otherwise, infer from section metadata or dependency graph
 */
function derivePhases(plan: BvsExecutionPlan): Phase[] {
  // Check if plan has explicit phases
  if ((plan as any).phases && Array.isArray((plan as any).phases)) {
    return (plan as any).phases.map((p: any) => {
      const sectionCount = Array.isArray(p.sections) ? p.sections.length : 0
      return {
        phaseNumber: p.phaseNumber || 1,
        name: p.name || 'Unnamed Phase',
        sections: Array.isArray(p.sections) ? p.sections : [],
        estimatedHours: p.estimatedHours || sectionCount * 2,
        estimatedCost: p.estimatedCost || estimatePhaseCost(sectionCount)
      }
    })
  }

  // Otherwise, derive from dependency graph levels
  const graph = plan.dependencyGraph
  if (graph && graph.levels && Array.isArray(graph.levels) && graph.levels.length > 0) {
    // Check if levels have the new structure {level: number, sectionIds: string[]}
    const firstLevel = graph.levels[0]

    if (firstLevel && typeof firstLevel === 'object' && 'sectionIds' in firstLevel) {
      // New structure: array of {level: number, sectionIds: string[]}
      return graph.levels.map((levelObj: any) => {
        const sectionIds = Array.isArray(levelObj.sectionIds) ? levelObj.sectionIds : []
        const sectionCount = sectionIds.length
        return {
          phaseNumber: (levelObj.level || 0) + 1,
          name: `Level ${(levelObj.level || 0) + 1}`,
          sections: sectionIds,
          estimatedHours: sectionCount * 2,
          estimatedCost: estimatePhaseCost(sectionCount)
        }
      })
    } else if (Array.isArray(firstLevel)) {
      // Old structure: array of arrays of section IDs
      return graph.levels.map((levelSections: any, index: number) => {
        const sectionCount = Array.isArray(levelSections) ? levelSections.length : 0
        return {
          phaseNumber: index + 1,
          name: `Level ${index + 1}`,
          sections: Array.isArray(levelSections) ? levelSections : [],
          estimatedHours: sectionCount * 2,
          estimatedCost: estimatePhaseCost(sectionCount)
        }
      })
    }
  }

  // Fallback: treat all sections as one phase
  return [{
    phaseNumber: 1,
    name: 'All Sections',
    sections: plan.sections.map(s => s.id),
    estimatedHours: plan.sections.length * 2,
    estimatedCost: estimatePhaseCost(plan.sections.length)
  }]
}

/**
 * Estimate cost based on number of sections
 */
function estimatePhaseCost(sectionCount: number): number {
  // Rough estimate: $0.10 per section
  const count = typeof sectionCount === 'number' && !isNaN(sectionCount) ? sectionCount : 0
  return count * 0.10
}

/**
 * Validate that selected sections have all dependencies met
 * Dependencies are satisfied if they are either:
 * 1. Selected for execution, OR
 * 2. Already completed (status === 'done')
 */
function validatePhaseSelection(
  allSections: BvsSection[],
  selectedSectionIds: string[]
): { valid: boolean; error?: string; missingSections?: BvsSection[] } {
  const selectedSet = new Set(selectedSectionIds)
  const missingSections: BvsSection[] = []

  // Build set of completed section IDs
  const completedSet = new Set(
    allSections
      .filter(s => s.status === 'done')
      .map(s => s.id)
  )

  for (const sectionId of selectedSectionIds) {
    const section = allSections.find(s => s.id === sectionId)
    if (!section) continue

    // Check if all dependencies are either selected OR already completed
    for (const depId of section.dependencies) {
      const isSatisfied = selectedSet.has(depId) || completedSet.has(depId)
      if (!isSatisfied) {
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

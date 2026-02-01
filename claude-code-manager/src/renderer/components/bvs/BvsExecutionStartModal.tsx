/**
 * BVS Execution Start Modal
 *
 * Unified modal shown when clicking on a BVS project.
 * Provides two main options:
 * 1. Resume a previous partial run (draft progress saved to disk)
 * 2. Start a new execution with section selection
 *
 * Previous runs are stored in .bvs/projects/{projectId}/runs/
 */

import React, { useState, useEffect, useMemo } from 'react'
import {
  Play,
  Clock,
  History,
  ChevronRight,
  Loader2,
  Trash2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  AlertTriangle,
  Check,
  ListChecks
} from 'lucide-react'
import { Button } from '../ui/button'
import { cn } from '@renderer/lib/utils'
import type { BvsProjectItem } from '@preload/index'
import type { BvsExecutionPlan, BvsSection } from '@shared/bvs-types'

// Execution run stored on disk
export interface ExecutionRun {
  id: string
  startedAt: number
  pausedAt?: number
  status: 'in_progress' | 'paused' | 'completed' | 'failed'
  selectedPhases: number[]
  selectedSections: string[]
  sectionsCompleted: string[]
  sectionsFailed: string[]
  sectionsInProgress: string[]
  currentLevel: number
}

export interface ExecutionConfig {
  selectedPhases: number[]
  selectedSections: string[]
  estimatedHours: number
  estimatedCost: number
}

interface BvsExecutionStartModalProps {
  project: BvsProjectItem
  projectPath: string
  plan: BvsExecutionPlan | null
  onStartExecution: (config: ExecutionConfig) => Promise<void>
  onResumeRun: (runId: string) => Promise<void>
  onDeleteRun: (runId: string) => Promise<void>
  onClose: () => void
}

type ModalView = 'main' | 'section-selector'

export function BvsExecutionStartModal({
  project,
  projectPath,
  plan,
  onStartExecution,
  onResumeRun,
  onDeleteRun,
  onClose
}: BvsExecutionStartModalProps) {
  const [view, setView] = useState<ModalView>('main')
  const [runs, setRuns] = useState<ExecutionRun[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isStarting, setIsStarting] = useState(false)
  const [deletingRunId, setDeletingRunId] = useState<string | null>(null)

  // Section selection state
  const [selectedSections, setSelectedSections] = useState<Set<string>>(new Set())
  const [selectAll, setSelectAll] = useState(false)

  // Load previous runs on mount
  useEffect(() => {
    loadRuns()
  }, [project.id])

  // Initialize with all sections selected
  useEffect(() => {
    if (plan?.sections) {
      setSelectedSections(new Set(plan.sections.map(s => s.id)))
      setSelectAll(true)
    }
  }, [plan])

  const loadRuns = async () => {
    setIsLoading(true)
    try {
      const result = await window.electron.bvsPlanning.listExecutionRuns(projectPath, project.id)
      if (result.success && result.runs) {
        // Sort by most recent first, filter out completed runs
        const activeRuns = result.runs
          .filter((r: ExecutionRun) => r.status !== 'completed')
          .sort((a: ExecutionRun, b: ExecutionRun) => (b.pausedAt || b.startedAt) - (a.pausedAt || a.startedAt))
        setRuns(activeRuns)
      }
    } catch (error) {
      console.error('[BvsExecutionStartModal] Error loading runs:', error)
    } finally {
      setIsLoading(false)
    }
  }

  // Get dependencies for a section
  const getDependencies = (sectionId: string): string[] => {
    if (!plan) return []
    const section = plan.sections.find(s => s.id === sectionId)
    return section?.dependencies || []
  }

  // Get all dependencies recursively
  const getAllDependencies = (sectionId: string, visited = new Set<string>()): string[] => {
    if (visited.has(sectionId)) return []
    visited.add(sectionId)

    const deps = getDependencies(sectionId)
    const allDeps: string[] = [...deps]

    for (const depId of deps) {
      allDeps.push(...getAllDependencies(depId, visited))
    }

    return [...new Set(allDeps)]
  }

  // Toggle section selection with dependency auto-selection
  // Don't auto-select dependencies that are already completed
  const toggleSection = (sectionId: string) => {
    setSelectedSections(prev => {
      const next = new Set(prev)

      if (next.has(sectionId)) {
        // Deselecting - just remove this section
        next.delete(sectionId)
      } else {
        // Selecting - auto-select non-completed dependencies only
        next.add(sectionId)
        const deps = getAllDependencies(sectionId)
        deps.forEach(depId => {
          // Only auto-select if the dependency is not already completed
          const depSection = plan?.sections.find(s => s.id === depId)
          if (depSection && depSection.status !== 'done') {
            next.add(depId)
          }
        })
      }

      // Update selectAll state (count only non-completed sections)
      const nonCompletedCount = plan?.sections.filter(s => s.status !== 'done').length || 0
      const selectedNonCompleted = Array.from(next).filter(id => {
        const section = plan?.sections.find(s => s.id === id)
        return section && section.status !== 'done'
      }).length
      setSelectAll(selectedNonCompleted === nonCompletedCount)

      return next
    })
  }

  // Toggle all sections (only non-completed ones)
  const toggleAllSections = () => {
    if (selectAll) {
      setSelectedSections(new Set())
      setSelectAll(false)
    } else {
      // Only select non-completed sections
      const nonCompletedIds = plan?.sections
        .filter(s => s.status !== 'done')
        .map(s => s.id) || []
      setSelectedSections(new Set(nonCompletedIds))
      setSelectAll(true)
    }
  }

  // Check if a section is auto-selected (dependency of another selected section)
  const isAutoSelected = (sectionId: string): boolean => {
    if (!selectedSections.has(sectionId)) return false

    // Check if any other selected section depends on this one
    for (const selectedId of selectedSections) {
      if (selectedId === sectionId) continue
      const deps = getAllDependencies(selectedId)
      if (deps.includes(sectionId)) return true
    }
    return false
  }

  // Validate selection - check for missing dependencies
  // Dependencies are satisfied if they are either selected OR already completed
  const validation = useMemo(() => {
    if (!plan) return { valid: true, missingDeps: [] }

    const missingDeps: { section: BvsSection; missingDep: BvsSection }[] = []

    // Build set of completed section IDs
    const completedSections = new Set(
      plan.sections
        .filter(s => s.status === 'done')
        .map(s => s.id)
    )

    for (const sectionId of selectedSections) {
      const section = plan.sections.find(s => s.id === sectionId)
      if (!section) continue

      for (const depId of section.dependencies || []) {
        // Dependency is satisfied if selected OR already completed
        const isSatisfied = selectedSections.has(depId) || completedSections.has(depId)
        if (!isSatisfied) {
          const depSection = plan.sections.find(s => s.id === depId)
          if (depSection) {
            missingDeps.push({ section, missingDep: depSection })
          }
        }
      }
    }

    return { valid: missingDeps.length === 0, missingDeps }
  }, [selectedSections, plan])

  const handleStartExecution = async () => {
    if (!validation.valid) {
      alert('Please resolve dependency issues before starting.')
      return
    }

    setIsStarting(true)
    try {
      await onStartExecution({
        selectedPhases: [],
        selectedSections: Array.from(selectedSections),
        estimatedHours: selectedSections.size * 2,
        estimatedCost: selectedSections.size * 0.10
      })
    } catch (error) {
      console.error('[BvsExecutionStartModal] Error starting execution:', error)
      alert(`Failed to start: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setIsStarting(false)
    }
  }

  const handleResumeRun = async (runId: string) => {
    setIsStarting(true)
    try {
      await onResumeRun(runId)
    } catch (error) {
      console.error('[BvsExecutionStartModal] Error resuming run:', error)
      alert(`Failed to resume: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setIsStarting(false)
    }
  }

  const handleDeleteRun = async (runId: string) => {
    if (!confirm('Delete this draft? This cannot be undone.')) return

    setDeletingRunId(runId)
    try {
      await onDeleteRun(runId)
      setRuns(prev => prev.filter(r => r.id !== runId))
    } catch (error) {
      console.error('[BvsExecutionStartModal] Error deleting run:', error)
      alert(`Failed to delete: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setDeletingRunId(null)
    }
  }

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const getRunStatusIcon = (status: ExecutionRun['status']) => {
    switch (status) {
      case 'in_progress':
        return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />
      case 'paused':
        return <Clock className="h-4 w-4 text-yellow-500" />
      case 'completed':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />
      case 'failed':
        return <XCircle className="h-4 w-4 text-red-500" />
      default:
        return <AlertCircle className="h-4 w-4 text-gray-500" />
    }
  }

  // Main modal view
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 py-8">
      <div className="bg-background rounded-lg shadow-xl w-full max-w-3xl mx-4 h-full max-h-full overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-border flex-shrink-0">
          <h2 className="text-xl font-semibold">{project.name}</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {project.sectionsTotal} sections • {project.sectionsCompleted} completed
          </p>
        </div>

        {/* Body - Scrollable */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Previous Runs (Drafts) Section */}
          {isLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : runs.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-medium flex items-center gap-2">
                <History className="h-4 w-4" />
                Resume Previous Run
              </h3>
              <div className="space-y-2">
                {runs.map(run => {
                  const completedCount = run.sectionsCompleted?.length || 0
                  const totalSelected = run.selectedSections?.length || 0
                  const progress = totalSelected > 0
                    ? Math.round((completedCount / totalSelected) * 100)
                    : 0

                  return (
                    <div
                      key={run.id}
                      className="flex items-center gap-3 p-3 rounded-lg border border-border hover:border-primary/50 transition-colors"
                    >
                      {getRunStatusIcon(run.status)}

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium truncate">
                            {formatDate(run.startedAt)}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {completedCount}/{totalSelected} sections ({progress}%)
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1">
                        <Button
                          variant="default"
                          size="sm"
                          onClick={() => handleResumeRun(run.id)}
                          disabled={isStarting}
                          className="h-8"
                        >
                          <Play className="h-4 w-4 mr-1" />
                          Resume
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteRun(run.id)}
                          disabled={deletingRunId === run.id}
                          className="h-8 px-2 text-red-500 hover:text-red-600"
                        >
                          {deletingRunId === run.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Divider */}
              <div className="relative py-2">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background px-2 text-muted-foreground">or start new</span>
                </div>
              </div>
            </div>
          )}

          {/* Section Selection */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium flex items-center gap-2">
                <ListChecks className="h-4 w-4" />
                Select Sections to Execute
              </h3>
              <label className="flex items-center gap-2 cursor-pointer text-sm">
                <input
                  type="checkbox"
                  checked={selectAll}
                  onChange={toggleAllSections}
                  className="rounded"
                />
                Select All
              </label>
            </div>

            {/* Section List */}
            {plan?.sections ? (
              <div className="space-y-2 flex-1 overflow-y-auto border border-border rounded-lg p-2">
                {plan.sections.map((section, index) => {
                  const isCompleted = section.status === 'done'
                  const isSelected = selectedSections.has(section.id)
                  const autoSelected = isAutoSelected(section.id)
                  const hasDeps = (section.dependencies?.length || 0) > 0

                  return (
                    <div
                      key={section.id}
                      onClick={() => !isCompleted && toggleSection(section.id)}
                      className={cn(
                        'flex items-start gap-3 p-3 rounded-lg transition-all',
                        isCompleted
                          ? 'bg-green-500/10 border border-green-500/30 cursor-default opacity-70'
                          : isSelected
                            ? 'bg-primary/10 border border-primary cursor-pointer'
                            : 'border border-transparent hover:bg-muted/50 cursor-pointer'
                      )}
                    >
                      {/* Checkbox or Done indicator */}
                      <div className={cn(
                        'w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 mt-0.5',
                        isCompleted
                          ? 'bg-green-500 border-green-500'
                          : isSelected
                            ? 'bg-primary border-primary'
                            : 'border-muted-foreground'
                      )}>
                        {(isCompleted || isSelected) && <Check className={cn(
                          'w-3 h-3',
                          isCompleted ? 'text-white' : 'text-primary-foreground'
                        )} />}
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground font-mono">
                            S{index + 1}
                          </span>
                          <span className={cn(
                            'font-medium truncate',
                            isCompleted && 'text-muted-foreground'
                          )}>
                            {section.name}
                          </span>
                          {isCompleted && (
                            <span className="text-xs px-1.5 py-0.5 bg-green-500/20 text-green-600 dark:text-green-400 rounded">
                              Done
                            </span>
                          )}
                          {!isCompleted && autoSelected && (
                            <span className="text-xs px-1.5 py-0.5 bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 rounded">
                              Required
                            </span>
                          )}
                        </div>
                        {section.description && (
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
                            {section.description}
                          </p>
                        )}
                        {hasDeps && (
                          <p className="text-xs text-muted-foreground mt-1">
                            Depends on: {section.dependencies?.map((d, i) => {
                              const depSection = plan.sections.find(s => s.id === d)
                              const depIndex = plan.sections.findIndex(s => s.id === d)
                              return depSection ? `S${depIndex + 1}` : d
                            }).join(', ')}
                          </p>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
                <p className="text-sm">Loading sections...</p>
              </div>
            )}

            {/* Validation Warning */}
            {!validation.valid && (
              <div className="p-3 bg-destructive/10 border border-destructive/50 rounded-lg">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-destructive mt-0.5 flex-shrink-0" />
                  <div className="text-sm">
                    <p className="font-medium text-destructive">Missing Dependencies</p>
                    <ul className="mt-1 text-destructive/80">
                      {validation.missingDeps.slice(0, 3).map((item, i) => (
                        <li key={i}>
                          {item.section.name} requires {item.missingDep.name}
                        </li>
                      ))}
                      {validation.missingDeps.length > 3 && (
                        <li>...and {validation.missingDeps.length - 3} more</li>
                      )}
                    </ul>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-border flex-shrink-0">
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm text-muted-foreground">
              {selectedSections.size} of {plan?.sections.filter(s => s.status !== 'done').length || 0} pending sections selected
              {(plan?.sections.filter(s => s.status === 'done').length || 0) > 0 && (
                <span className="ml-2 text-green-600 dark:text-green-400">
                  ({plan?.sections.filter(s => s.status === 'done').length} already done)
                </span>
              )}
            </span>
          </div>
          <div className="flex gap-3">
            <Button
              variant="outline"
              className="flex-1"
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              className="flex-1"
              onClick={handleStartExecution}
              disabled={isStarting || selectedSections.size === 0 || !validation.valid}
            >
              {isStarting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Play className="h-4 w-4 mr-2" />
              )}
              Start Execution ({selectedSections.size} sections)
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

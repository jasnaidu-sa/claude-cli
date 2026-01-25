/**
 * BVS Execution Dashboard - 4-column Kanban board for section execution
 *
 * Columns: PENDING | IN PROGRESS | VERIFYING | DONE
 * Features:
 * - Real-time progress updates via polling
 * - Slide-out detail panel on card click
 * - Resume/Pause/Stop controls
 * - Worker color coding for parallel execution
 */

import React, { useState, useEffect, useRef, useMemo } from 'react'
import {
  ChevronRight,
  Play,
  Pause,
  Square,
  Clock,
  Loader2,
  RefreshCw,
  AlertCircle,
  MessageSquare,
  AlertTriangle
} from 'lucide-react'
import { Button } from '../ui/button'
import { cn } from '@renderer/lib/utils'
import { BvsKanbanCard, type BvsSectionData } from './BvsKanbanCard'
import { BvsSectionDetailPanel } from './BvsSectionDetailPanel'
import { BvsPlanRevisionChat, type PlanIssue, type PlanChange } from './BvsPlanRevisionChat'
import type { BvsProjectItem } from '@preload/index'

interface BvsExecutionDashboardProps {
  project: BvsProjectItem
  projectPath: string
  onBack: () => void
  onProjectUpdate: (project: BvsProjectItem | null) => void
}

// Column definitions - dark mode aware
const COLUMNS = [
  { id: 'pending', label: 'PENDING', bgColor: 'bg-gray-100 dark:bg-gray-800/50', headerColor: 'text-gray-600 dark:text-gray-400' },
  { id: 'in_progress', label: 'IN PROGRESS', bgColor: 'bg-blue-50 dark:bg-blue-900/30', headerColor: 'text-blue-600 dark:text-blue-400' },
  { id: 'verifying', label: 'VERIFYING', bgColor: 'bg-cyan-50 dark:bg-cyan-900/30', headerColor: 'text-cyan-600 dark:text-cyan-400' },
  { id: 'done', label: 'DONE', bgColor: 'bg-green-50 dark:bg-green-900/30', headerColor: 'text-green-600 dark:text-green-400' },
] as const

type ColumnId = typeof COLUMNS[number]['id']

export function BvsExecutionDashboard({
  project,
  projectPath,
  onBack,
  onProjectUpdate
}: BvsExecutionDashboardProps) {
  const [executionSessionId, setExecutionSessionId] = useState<string | null>(null)
  const [sections, setSections] = useState<BvsSectionData[]>([])
  const [selectedSection, setSelectedSection] = useState<BvsSectionData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [hasActiveSession, setHasActiveSession] = useState(false)
  const [elapsedTime, setElapsedTime] = useState(0)
  const [showRevisionChat, setShowRevisionChat] = useState(false)
  const [planIssues, setPlanIssues] = useState<PlanIssue[]>([])
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const pollInterval = useRef<NodeJS.Timeout | null>(null)
  const timerInterval = useRef<NodeJS.Timeout | null>(null)

  // Group sections by status for Kanban columns
  const sectionsByColumn = useMemo(() => {
    const grouped: Record<ColumnId, BvsSectionData[]> = {
      pending: [],
      in_progress: [],
      verifying: [],
      done: [],
    }

    sections.forEach((section) => {
      // Map section status to column
      let columnId: ColumnId = 'pending'
      if (section.status === 'in_progress') columnId = 'in_progress'
      else if (section.status === 'verifying') columnId = 'verifying'
      else if (section.status === 'done' || section.status === 'failed') columnId = 'done'
      else columnId = 'pending'

      grouped[columnId].push(section)
    })

    return grouped
  }, [sections])

  // Count active workers
  const activeWorkers = useMemo(() => {
    const workers = new Set<string>()
    sections.forEach((s) => {
      if (s.status === 'in_progress' && s.workerId) {
        workers.add(s.workerId)
      }
    })
    return workers.size
  }, [sections])

  // Load sections from plan.json as fallback
  useEffect(() => {
    const loadPlanSections = async () => {
      try {
        setIsLoading(true)
        const planResult = await window.electron.bvsPlanning.loadPlan(projectPath, project.id)
        if (planResult.success && planResult.plan?.sections) {
          // Map plan sections to display format
          const mappedSections: BvsSectionData[] = planResult.plan.sections.map((s: any) => ({
            id: s.id,
            name: s.name,
            description: s.description,
            status: s.status || 'pending',
            progress: s.progress || 0,
            workerId: s.workerId,
            currentStep: s.currentStep,
            currentFile: s.currentFile,
            currentLine: s.currentLine,
            files: s.files?.map((f: any) => ({
              path: f.path,
              status: f.status || 'pending'
            })),
            dependencies: s.dependencies || [],
            dependents: s.dependents || [],
            elapsedSeconds: s.elapsedSeconds,
            errorMessage: s.errorMessage,
            successCriteria: s.successCriteria?.map((c: any) => ({
              description: typeof c === 'string' ? c : c.description,
              passed: c.passed || false
            }))
          }))
          setSections(mappedSections)

          // Auto-analyze plan for issues on first load
          analyzePlanForIssues()
        }
      } catch (error) {
        console.error('[BvsExecutionDashboard] Error loading plan:', error)
      } finally {
        setIsLoading(false)
      }
    }

    loadPlanSections()
  }, [project.id, projectPath])

  // Poll for session updates
  useEffect(() => {
    const loadSession = async () => {
      try {
        const result = await window.electron.bvsPlanning.listExecutionSessions()
        if (result.success && result.sessions) {
          const session = result.sessions.find((s: any) => s.projectId === project.id)
          if (session) {
            setHasActiveSession(true)
            setExecutionSessionId(session.id)
            if (session.plan?.sections) {
              // Update sections with live status from session
              setSections(session.plan.sections.map((s: any) => ({
                id: s.id,
                name: s.name,
                description: s.description,
                status: s.status || 'pending',
                progress: s.progress || 0,
                workerId: s.workerId,
                currentStep: s.currentStep,
                currentFile: s.currentFile,
                currentLine: s.currentLine,
                files: s.files?.map((f: any) => ({
                  path: f.path,
                  status: f.status || 'pending'
                })),
                dependencies: s.dependencies || [],
                dependents: s.dependents || [],
                elapsedSeconds: s.elapsedSeconds,
                errorMessage: s.errorMessage,
                successCriteria: s.successCriteria?.map((c: any) => ({
                  description: typeof c === 'string' ? c : c.description,
                  passed: c.passed || false
                }))
              })))
            }
            // Update project progress from session
            if (session.sectionsCompleted !== project.sectionsCompleted) {
              onProjectUpdate({
                ...project,
                sectionsCompleted: session.sectionsCompleted,
                sectionsFailed: session.sectionsFailed,
              })
            }
          } else {
            setHasActiveSession(false)
          }
        }
      } catch (error) {
        console.error('[BvsExecutionDashboard] Error loading session:', error)
      }
    }

    loadSession()
    pollInterval.current = setInterval(loadSession, 2000)

    return () => {
      if (pollInterval.current) {
        clearInterval(pollInterval.current)
      }
    }
  }, [project.id])

  // Elapsed time counter when executing
  useEffect(() => {
    if (hasActiveSession && project.status === 'in_progress') {
      timerInterval.current = setInterval(() => {
        setElapsedTime((prev) => prev + 1)
      }, 1000)
    } else {
      if (timerInterval.current) {
        clearInterval(timerInterval.current)
      }
    }

    return () => {
      if (timerInterval.current) {
        clearInterval(timerInterval.current)
      }
    }
  }, [hasActiveSession, project.status])

  const handleBack = () => {
    if (pollInterval.current) clearInterval(pollInterval.current)
    if (timerInterval.current) clearInterval(timerInterval.current)
    onBack()
  }

  const handleStartExecution = async () => {
    try {
      const result = await window.electron.bvsPlanning.startExecution(projectPath, project.id)
      if (result.success) {
        setExecutionSessionId(result.sessionId)
        setHasActiveSession(true)
        // Refresh project status
        const projectResult = await window.electron.bvsPlanning.getProject(projectPath, project.id)
        if (projectResult.success && projectResult.project) {
          onProjectUpdate(projectResult.project)
        }
      } else {
        alert(`Failed to start execution: ${result.error}`)
      }
    } catch (err) {
      alert(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }

  const handlePauseExecution = async () => {
    if (executionSessionId) {
      await window.electron.bvsPlanning.pauseExecution(executionSessionId)
    }
  }

  const handleResumeExecution = async () => {
    if (executionSessionId) {
      await window.electron.bvsPlanning.resumeExecution(executionSessionId)
    } else {
      // No active session, start fresh
      await handleStartExecution()
    }
  }

  const handleRetrySection = async (sectionId: string) => {
    // TODO: Implement section retry
    console.log('Retry section:', sectionId)
  }

  const handleOpenRevisionChat = async () => {
    // Auto-pause if running
    if (hasActiveSession && project.status === 'in_progress' && executionSessionId) {
      await window.electron.bvsPlanning.pauseExecution(executionSessionId)
    }

    // Close detail panel if open
    setSelectedSection(null)

    // Analyze the plan for issues
    await analyzePlanForIssues()

    // Show revision chat
    setShowRevisionChat(true)
  }

  const analyzePlanForIssues = async () => {
    setIsAnalyzing(true)
    try {
      const result = await window.electron.bvsPlanning.analyzePlan(projectPath, project.id)
      if (result.success) {
        setPlanIssues(result.issues || [])
      }
    } catch (error) {
      console.error('[BvsExecutionDashboard] Error analyzing plan:', error)
    } finally {
      setIsAnalyzing(false)
    }
  }

  const handleApplyChanges = async (changes: PlanChange[]) => {
    try {
      const result = await window.electron.bvsPlanning.applyPlanChanges(
        projectPath,
        project.id,
        changes
      )
      if (result.success) {
        // Reload sections from updated plan
        const planResult = await window.electron.bvsPlanning.loadPlan(projectPath, project.id)
        if (planResult.success && planResult.plan?.sections) {
          const mappedSections: BvsSectionData[] = planResult.plan.sections.map((s: any) => ({
            id: s.id,
            name: s.name,
            description: s.description,
            status: s.status || 'pending',
            progress: s.progress || 0,
            workerId: s.workerId,
            currentStep: s.currentStep,
            currentFile: s.currentFile,
            currentLine: s.currentLine,
            files: s.files?.map((f: any) => ({
              path: f.path,
              status: f.status || 'pending'
            })),
            dependencies: s.dependencies || [],
            dependents: s.dependents || [],
            elapsedSeconds: s.elapsedSeconds,
            errorMessage: s.errorMessage,
            successCriteria: s.successCriteria?.map((c: any) => ({
              description: typeof c === 'string' ? c : c.description,
              passed: c.passed || false
            }))
          }))
          setSections(mappedSections)
        }

        // Re-analyze for any remaining issues
        await analyzePlanForIssues()
      } else {
        throw new Error(result.error || 'Failed to apply changes')
      }
    } catch (error) {
      console.error('[BvsExecutionDashboard] Error applying changes:', error)
      throw error
    }
  }

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const progressPercent = project.sectionsTotal > 0
    ? Math.round((project.sectionsCompleted / project.sectionsTotal) * 100)
    : 0

  // Check if we need to show resume button (project in_progress but no active session)
  const showResumeButton = project.status === 'in_progress' && !hasActiveSession

  return (
    <div className="h-full flex flex-col">
      {/* Header Bar */}
      <div className="flex items-center justify-between p-4 border-b border-border bg-background">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={handleBack}>
            <ChevronRight className="h-4 w-4 rotate-180" />
            Back
          </Button>
          <div>
            <h2 className="text-lg font-semibold">{project.name}</h2>
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <span>
                Progress: {project.sectionsCompleted}/{project.sectionsTotal} sections ({progressPercent}%)
              </span>
              {hasActiveSession && (
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {formatTime(elapsedTime)}
                </span>
              )}
              {activeWorkers > 0 && (
                <span className="flex items-center gap-1">
                  <span className="inline-block w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                  {activeWorkers} worker{activeWorkers > 1 ? 's' : ''} active
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2">
          {/* Revise Plan Button - Always visible */}
          <Button
            variant={showRevisionChat ? "secondary" : "outline"}
            size="sm"
            onClick={handleOpenRevisionChat}
            className="relative"
          >
            <MessageSquare className="h-4 w-4 mr-1" />
            Revise Plan
            {planIssues.length > 0 && !showRevisionChat && (
              <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-yellow-500 text-[10px] font-medium flex items-center justify-center text-white">
                {planIssues.length}
              </span>
            )}
          </Button>

          {showResumeButton && (
            <Button variant="default" size="sm" onClick={handleResumeExecution}>
              <Play className="h-4 w-4 mr-1" />
              Resume Execution
            </Button>
          )}
          {hasActiveSession && project.status === 'in_progress' && (
            <Button variant="outline" size="sm" onClick={handlePauseExecution}>
              <Pause className="h-4 w-4 mr-1" />
              Pause
            </Button>
          )}
          {hasActiveSession && project.status === 'paused' && (
            <Button variant="default" size="sm" onClick={handleResumeExecution}>
              <Play className="h-4 w-4 mr-1" />
              Resume
            </Button>
          )}
        </div>
      </div>

      {/* Progress Bar */}
      <div className="px-4 py-2 bg-muted/30 border-b border-border">
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-500"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Kanban Board + Detail Panel */}
      <div className="flex-1 flex overflow-hidden">
        {/* Kanban Columns */}
        <div className="flex-1 flex overflow-x-auto p-4 gap-4">
          {isLoading ? (
            <div className="flex-1 flex items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : sections.length === 0 ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center text-muted-foreground">
                <AlertCircle className="h-12 w-12 mx-auto mb-2 opacity-50" />
                <p>No sections found in plan</p>
              </div>
            </div>
          ) : (
            COLUMNS.map((column) => (
              <div
                key={column.id}
                className={cn(
                  'flex-shrink-0 w-72 flex flex-col rounded-lg',
                  column.bgColor
                )}
              >
                {/* Column Header */}
                <div className="p-3 border-b border-border/50">
                  <div className="flex items-center justify-between">
                    <h3 className={cn('text-xs font-semibold uppercase tracking-wide', column.headerColor)}>
                      {column.label}
                    </h3>
                    <span className={cn(
                      'px-2 py-0.5 rounded-full text-xs font-medium',
                      column.bgColor,
                      column.headerColor
                    )}>
                      {sectionsByColumn[column.id].length}
                    </span>
                  </div>
                </div>

                {/* Column Cards */}
                <div className="flex-1 p-2 space-y-2 overflow-y-auto">
                  {sectionsByColumn[column.id].map((section) => (
                    <BvsKanbanCard
                      key={section.id}
                      section={section}
                      onClick={() => setSelectedSection(section)}
                      onRetry={section.status === 'failed' ? () => handleRetrySection(section.id) : undefined}
                      isSelected={selectedSection?.id === section.id}
                    />
                  ))}
                  {sectionsByColumn[column.id].length === 0 && (
                    <div className="p-4 text-center text-xs text-muted-foreground">
                      No sections
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Detail Panel */}
        {selectedSection && !showRevisionChat && (
          <BvsSectionDetailPanel
            section={selectedSection}
            onClose={() => setSelectedSection(null)}
          />
        )}

        {/* Revision Chat Panel */}
        {showRevisionChat && (
          <BvsPlanRevisionChat
            projectPath={projectPath}
            projectId={project.id}
            issues={planIssues}
            onClose={() => setShowRevisionChat(false)}
            onApplyChanges={handleApplyChanges}
            onRefreshIssues={analyzePlanForIssues}
            isAnalyzing={isAnalyzing}
          />
        )}
      </div>
    </div>
  )
}

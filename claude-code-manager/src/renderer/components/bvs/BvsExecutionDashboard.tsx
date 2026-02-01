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
  AlertTriangle,
  CheckCircle2
} from 'lucide-react'
import { Button } from '../ui/button'
import { cn } from '@renderer/lib/utils'
import { BvsKanbanCard, type BvsSectionData } from './BvsKanbanCard'
import { BvsSectionDetailPanel } from './BvsSectionDetailPanel'
import { BvsPlanRevisionChat, type PlanIssue, type PlanChange } from './BvsPlanRevisionChat'
import { BvsPhaseSelector, type ExecutionConfig } from './BvsPhaseSelector'
import { BvsExecutionStartModal } from './BvsExecutionStartModal'
import type { BvsProjectItem } from '@preload/index'
import type { BvsExecutionPlan } from '@shared/bvs-types'

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
  const [sessionStatus, setSessionStatus] = useState<'running' | 'paused' | 'completed' | 'failed' | null>(null)
  const [elapsedTime, setElapsedTime] = useState(0)
  const [showRevisionChat, setShowRevisionChat] = useState(false)
  const [planIssues, setPlanIssues] = useState<PlanIssue[]>([])
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [showStartModal, setShowStartModal] = useState(false)
  const [currentPlan, setCurrentPlan] = useState<BvsExecutionPlan | null>(null)
  const pollInterval = useRef<NodeJS.Timeout | null>(null)
  const timerInterval = useRef<NodeJS.Timeout | null>(null)

  // Show start modal after plan is loaded - allows user to choose phases or resume a run
  useEffect(() => {
    // Only show modal when:
    // 1. Plan is loaded (currentPlan is not null)
    // 2. Not currently loading
    // 3. No active running session
    if (currentPlan && !isLoading && !hasActiveSession) {
      console.log('[BvsExecutionDashboard] Plan loaded, showing start modal')
      setShowStartModal(true)
    }
  }, [currentPlan, isLoading, hasActiveSession])

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
      if (section.status === 'in_progress' || (section.status as string) === 'retrying') columnId = 'in_progress'
      else if (section.status === 'verifying') columnId = 'verifying'
      else if (section.status === 'done' || section.status === 'failed' || (section.status as string) === 'skipped') columnId = 'done'
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

  // Check if all sections are completed (done or failed, but none pending/in_progress)
  const allSectionsComplete = useMemo(() => {
    if (sections.length === 0) return false
    return sections.every(s => s.status === 'done' || s.status === 'failed')
  }, [sections])

  // Check if execution finished successfully (all done, none failed)
  const executionSuccessful = useMemo(() => {
    if (sections.length === 0) return false
    return sections.every(s => s.status === 'done')
  }, [sections])

  // Helper function to map section data
  const mapSectionData = (s: any): BvsSectionData => ({
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
    workerOutput: s.workerOutput || '',
    successCriteria: s.successCriteria?.map((c: any) => ({
      description: typeof c === 'string' ? c : c.description,
      passed: c.passed || false
    }))
  })

  // Load plan on mount and auto-restore session if there's progress
  // This ensures retry/skip buttons work even after app restart
  useEffect(() => {
    const loadInitialData = async () => {
      try {
        setIsLoading(true)

        // Always load the plan first - needed for phase selector
        const planResult = await window.electron.bvsPlanning.loadPlan(projectPath, project.id)
        if (planResult.success && planResult.plan?.sections) {
          // Store the full plan for phase selector
          setCurrentPlan(planResult.plan)

          // Map plan sections to display format
          const mappedSections: BvsSectionData[] = planResult.plan.sections.map(mapSectionData)
          setSections(mappedSections)

          // Auto-analyze plan for issues on first load
          analyzePlanForIssues()
        }

        // Check for existing execution session in memory (for live updates)
        // When multiple sessions exist for the same project, prefer the most recent running one
        const sessionResult = await window.electron.bvsPlanning.listExecutionSessions()
        let existingSession: any = null
        if (sessionResult.success && sessionResult.sessions) {
          const projectSessions = sessionResult.sessions
            .filter((s: any) => s.projectId === project.id)
            .sort((a: any, b: any) => (b.startedAt || 0) - (a.startedAt || 0))
          // Prefer a running session, otherwise take the most recent
          existingSession = projectSessions.find((s: any) => s.status === 'running') || projectSessions[0] || null
        }

        // If no session in memory but project has progress (was started before),
        // restore the session so retry/skip buttons work
        if (!existingSession && planResult.success && planResult.plan?.sections) {
          const hasProgress = planResult.plan.sections.some(
            (s: any) => s.status === 'done' || s.status === 'failed' || s.status === 'in_progress'
          )

          if (hasProgress) {
            console.log('[BvsExecutionDashboard] Project has progress but no session in memory, restoring...')
            try {
              const restoreResult = await window.electron.bvsPlanning.restoreSession(projectPath, project.id)
              if (restoreResult.success && restoreResult.session) {
                existingSession = restoreResult.session
                console.log('[BvsExecutionDashboard] Session restored:', existingSession.id)
              } else {
                console.warn('[BvsExecutionDashboard] Failed to restore session:', restoreResult.error)
              }
            } catch (restoreError) {
              console.error('[BvsExecutionDashboard] Error restoring session:', restoreError)
            }
          }
        }

        if (existingSession) {
          console.log('[BvsExecutionDashboard] Found existing session:', existingSession.id, 'status:', existingSession.status)
          setHasActiveSession(true)
          setExecutionSessionId(existingSession.id)
          setSessionStatus(existingSession.status || 'running')

          // Update sections with live status from session
          if (existingSession.plan?.sections) {
            const sessionSections: BvsSectionData[] = existingSession.plan.sections.map(mapSectionData)
            setSections(sessionSections)
          }
        }
      } catch (error) {
        console.error('[BvsExecutionDashboard] Error loading initial data:', error)
      } finally {
        setIsLoading(false)
      }
    }

    loadInitialData()
  }, [project.id, projectPath])

  // Listen for real-time BVS events with debouncing to prevent flashing
  useEffect(() => {
    // Queue for batching updates to reduce re-renders
    let pendingUpdates: Map<string, any> = new Map()
    let updateTimer: NodeJS.Timeout | null = null

    const flushUpdates = () => {
      if (pendingUpdates.size === 0) return

      const updates = new Map(pendingUpdates)
      pendingUpdates.clear()

      setSections(prevSections => {
        return prevSections.map(s => {
          const update = updates.get(s.id)
          if (!update) return s

          // Only apply changes if there are actual differences
          const newSection = {
            ...s,
            status: update.status || s.status,
            progress: update.progress ?? s.progress,
            currentStep: update.currentStep || s.currentStep,
            currentFile: update.currentFile || s.currentFile,
            currentLine: update.currentLine || s.currentLine,
            workerId: update.workerId || s.workerId,
            elapsedSeconds: update.elapsedSeconds || s.elapsedSeconds,
            errorMessage: update.errorMessage || s.errorMessage,
            workerOutput: update.workerOutput !== undefined
              ? (s.workerOutput || '') + update.workerOutput
              : s.workerOutput
          }
          return newSection
        })
      })

      // Also update selectedSection if it's one of the updated sections
      setSelectedSection(prev => {
        if (prev && updates.has(prev.id)) {
          const update = updates.get(prev.id)
          return {
            ...prev,
            status: update.status || prev.status,
            progress: update.progress ?? prev.progress,
            currentStep: update.currentStep || prev.currentStep,
            currentFile: update.currentFile || prev.currentFile,
            currentLine: update.currentLine || prev.currentLine,
            workerId: update.workerId || prev.workerId,
            elapsedSeconds: update.elapsedSeconds || prev.elapsedSeconds,
            errorMessage: update.errorMessage || prev.errorMessage,
            workerOutput: update.workerOutput !== undefined
              ? (prev.workerOutput || '') + update.workerOutput
              : prev.workerOutput
          }
        }
        return prev
      })
    }

    const handleBvsEvent = (eventData: any) => {
      // Track event time so polling doesn't double-update
      lastEventTimeRef.current = Date.now()

      // Only log significant events, not progress updates
      if (eventData.type !== 'worker_output') {
        console.log('[BvsExecutionDashboard] Received BVS event:', eventData.type, eventData.sectionId || '', eventData.status || '')
      }

      // Handle session completion - update session status and force final state sync
      if (eventData.type === 'session_complete') {
        console.log('[BvsExecutionDashboard] Session completed!', eventData)
        setSessionStatus('completed')

        // Update project progress counts
        if (eventData.sectionsCompleted !== undefined) {
          onProjectUpdate({
            ...project,
            sectionsCompleted: (project.sectionsCompleted || 0) + (eventData.sectionsCompleted || 0),
            sectionsFailed: eventData.sectionsFailed || 0,
          })
        }

        // Force flush any pending section updates immediately
        if (updateTimer) {
          clearTimeout(updateTimer)
        }
        flushUpdates()

        // Also force a poll to sync final section statuses from backend
        lastEventTimeRef.current = 0  // Reset so poll doesn't skip
        return
      }

      // Update sections based on event type
      if (eventData.type === 'section_update' || eventData.type === 'worker_update') {
        // Merge with any pending update for this section
        const existing = pendingUpdates.get(eventData.sectionId) || {}
        pendingUpdates.set(eventData.sectionId, {
          ...existing,
          status: eventData.status || existing.status,
          progress: eventData.progress ?? existing.progress,
          currentStep: eventData.currentStep || existing.currentStep,
          currentFile: eventData.currentFile || existing.currentFile,
          currentLine: eventData.currentLine || existing.currentLine,
          workerId: eventData.workerId || existing.workerId,
          elapsedSeconds: eventData.elapsedSeconds || existing.elapsedSeconds,
          errorMessage: eventData.errorMessage || existing.errorMessage
        })
      }

      // Capture worker output in section data
      if (eventData.type === 'worker_output' && eventData.sectionId) {
        const existing = pendingUpdates.get(eventData.sectionId) || {}
        pendingUpdates.set(eventData.sectionId, {
          ...existing,
          workerOutput: (existing.workerOutput || '') + eventData.output
        })
      }

      // Debounce: flush updates after 100ms of no new events
      if (updateTimer) {
        clearTimeout(updateTimer)
      }
      updateTimer = setTimeout(flushUpdates, 100)
    }

    // Subscribe to BVS events using the exposed API
    const unsubscribe = window.electron.bvsPlanning.onBvsEvent(handleBvsEvent)

    return () => {
      if (updateTimer) {
        clearTimeout(updateTimer)
      }
      unsubscribe()
    }
  }, [])

  // Track last real-time event time to coordinate with polling
  const lastEventTimeRef = useRef<number>(0)

  // Poll for session updates - reduced frequency since we have real-time events
  // The poll is mainly for recovery/sync, not primary updates
  useEffect(() => {
    const loadSession = async () => {
      // Skip poll if we recently received a real-time event (within 2 seconds)
      const now = Date.now()
      if (now - lastEventTimeRef.current < 2000) {
        return
      }

      try {
        const result = await window.electron.bvsPlanning.listExecutionSessions()
        if (result.success && result.sessions) {
          // When multiple sessions exist for the same project, prefer running, then most recent
          const projectSessions = result.sessions
            .filter((s: any) => s.projectId === project.id)
            .sort((a: any, b: any) => (b.startedAt || 0) - (a.startedAt || 0))
          const session = projectSessions.find((s: any) => s.status === 'running') || projectSessions[0]
          if (session) {
            setHasActiveSession(true)
            setExecutionSessionId(session.id)
            setSessionStatus(session.status || 'running')
            if (session.plan?.sections) {
              // Only update if there are actual changes (compare by status/progress)
              setSections(prevSections => {
                const newSections: BvsSectionData[] = session.plan.sections.map((s: any) => ({
                  ...mapSectionData(s),
                  // Preserve accumulated worker output from real-time events
                  workerOutput: prevSections.find(p => p.id === s.id)?.workerOutput || '',
                }))

                // Check if anything actually changed to avoid unnecessary re-renders
                const hasChanges = newSections.some((ns, i) => {
                  const ps = prevSections[i]
                  if (!ps) return true
                  return ns.status !== ps.status ||
                         ns.progress !== ps.progress ||
                         ns.currentStep !== ps.currentStep
                })

                return hasChanges ? newSections : prevSections
              })
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
            // No active session found - but don't clear sections
            // They are loaded from the plan initially and should persist
            setHasActiveSession(false)
            setSessionStatus(null)
          }
        }
      } catch (error) {
        console.error('[BvsExecutionDashboard] Error loading session:', error)
      }
    }

    loadSession()
    // Poll every 5 seconds since real-time events handle most updates
    pollInterval.current = setInterval(loadSession, 5000)

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

  // Mark project as complete and navigate back
  const handleMarkComplete = async () => {
    try {
      // Update project status to completed
      const result = await window.electron.bvsPlanning.updateProjectStatus(
        projectPath,
        project.id,
        'completed'
      )
      if (result.success && result.project) {
        onProjectUpdate(result.project)
      }
      // Navigate back to project list
      handleBack()
    } catch (error) {
      console.error('[BvsExecutionDashboard] Error marking project complete:', error)
      alert(`Error marking project complete: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  // Start a fresh execution with selected phases/sections
  const handleStartExecution = async (config: ExecutionConfig) => {
    setShowStartModal(false)

    try {
      // Start execution with selected sections
      const result = await window.electron.bvsPlanning.startExecutionWithSelection(
        projectPath,
        project.id,
        config.selectedSections,
        {
          mode: 'ATTENDED_LEVEL',
          limits: {
            maxIterationsPerSubtask: 5,
            maxCostPerSubtask: 0.50,
            maxCostPerSection: 5.00,
            maxTotalCost: 50.00,
            stopOnLimitExceeded: true,
          },
          enableSubtaskSplitting: true,
          enableBuildVerification: true,
          autoCommitSubtasks: true,
        }
      )

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

  // Resume a previous execution run
  const handleResumeRun = async (runId: string) => {
    setShowStartModal(false)

    try {
      const result = await window.electron.bvsPlanning.resumeExecutionRun(
        projectPath,
        project.id,
        runId
      )

      if (result.success) {
        setExecutionSessionId(result.sessionId)
        setHasActiveSession(true)
        // Refresh project status
        const projectResult = await window.electron.bvsPlanning.getProject(projectPath, project.id)
        if (projectResult.success && projectResult.project) {
          onProjectUpdate(projectResult.project)
        }
      } else {
        alert(`Failed to resume run: ${result.error}`)
      }
    } catch (err) {
      alert(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }

  // Delete a previous execution run
  const handleDeleteRun = async (runId: string) => {
    try {
      await window.electron.bvsPlanning.deleteExecutionRun(
        projectPath,
        project.id,
        runId
      )
    } catch (err) {
      throw err
    }
  }

  const handlePauseExecution = async () => {
    if (executionSessionId) {
      await window.electron.bvsPlanning.pauseExecution(executionSessionId)
    }
  }

  const handleShowStartModal = () => {
    setShowStartModal(true)
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

  // Determine which buttons to show based on session state
  const showPauseButton = hasActiveSession && sessionStatus === 'running'
  const showStartResumeButton = !hasActiveSession || sessionStatus === 'paused'

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
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">{project.name}</h2>
            </div>
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

          {/* Complete Button - shown when all sections are done */}
          {allSectionsComplete && (
            <Button
              variant="default"
              size="sm"
              onClick={handleMarkComplete}
              className={cn(
                executionSuccessful
                  ? "bg-green-600 hover:bg-green-700"
                  : "bg-yellow-600 hover:bg-yellow-700"
              )}
            >
              <CheckCircle2 className="h-4 w-4 mr-1" />
              {executionSuccessful ? 'Complete' : 'Complete (with failures)'}
            </Button>
          )}

          {showStartResumeButton && !allSectionsComplete && (
            <Button variant="default" size="sm" onClick={handleShowStartModal}>
              <Play className="h-4 w-4 mr-1" />
              {hasActiveSession ? 'Resume' : 'Start / Resume'}
            </Button>
          )}
          {showPauseButton && (
            <Button variant="outline" size="sm" onClick={handlePauseExecution}>
              <Pause className="h-4 w-4 mr-1" />
              Pause
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
            sessionId={executionSessionId}
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

      {/* Execution Start Modal - phase selection and run resumption */}
      {showStartModal && (
        <BvsExecutionStartModal
          project={project}
          projectPath={projectPath}
          plan={currentPlan}
          onStartExecution={handleStartExecution}
          onResumeRun={handleResumeRun}
          onDeleteRun={handleDeleteRun}
          onClose={() => setShowStartModal(false)}
        />
      )}
    </div>
  )
}

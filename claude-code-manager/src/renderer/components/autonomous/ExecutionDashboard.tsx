/**
 * ExecutionDashboard Component (FEAT-026)
 *
 * Phase 4: Execution dashboard - shows real-time progress of the autonomous
 * coding process with streaming output. Enhanced with:
 * - Auto-create workflow from spec
 * - Collapsible spec summary panel
 * - Phase progress stepper
 * - Better status display with time tracking
 * - Error recovery with retry
 */

import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  Play,
  Pause,
  Square,
  RefreshCw,
  Terminal,
  ChevronDown,
  ChevronUp,
  FileText,
  Clock,
  AlertTriangle,
  ArrowLeft,
  CheckCircle,
  Circle,
  Loader2,
  Cpu,
  Code
} from 'lucide-react'
import { Button } from '../ui/button'
import { ProgressPanel } from './ProgressPanel'
import { OutputViewer } from './OutputViewer'
import { ResizeHandle } from '../ui/ResizeHandle'
import { useAutonomousStore } from '@renderer/stores/autonomous-store'
import { cn } from '@renderer/lib/utils'
import { parseSpecMetadata } from '@renderer/lib/spec-parser'

/** Implementation phases for the stepper UI */
type ImplementationPhase = 'initialization' | 'implementation' | 'verification'

/** Orchestrator phases (Python agent phases) */
type OrchestratorPhase = 'generation' | 'implementation'

interface PhaseInfo {
  id: ImplementationPhase
  label: string
  description: string
}

const IMPLEMENTATION_PHASES: PhaseInfo[] = [
  {
    id: 'initialization',
    label: 'Initialization',
    description: 'Creating test files from spec'
  },
  {
    id: 'implementation',
    label: 'Implementation',
    description: 'Writing code to pass tests'
  },
  {
    id: 'verification',
    label: 'Verification',
    description: 'Running final test suite'
  }
]

/** Format elapsed time as HH:MM:SS or MM:SS */
function formatElapsedTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

/** Estimate remaining time based on progress rate */
function estimateRemainingTime(
  elapsedMs: number,
  passing: number,
  total: number
): string | null {
  if (passing === 0 || total === 0) return null

  const progressRate = passing / elapsedMs // tests per ms
  const remaining = total - passing
  const estimatedMs = remaining / progressRate

  // Cap estimate at 99 hours to avoid ridiculous numbers
  if (estimatedMs > 99 * 60 * 60 * 1000) return null

  return formatElapsedTime(estimatedMs)
}

/**
 * Check if feature_list.json exists for a project
 * Returns true if the file exists, false otherwise
 */
async function checkFeatureListExists(projectPath: string): Promise<boolean> {
  try {
    // Use IPC to check if the file exists
    const featureListPath = `${projectPath}/.autonomous/feature_list.json`
    const result = await window.electron.fs.exists(featureListPath)
    return result
  } catch {
    return false
  }
}

export function ExecutionDashboard() {
  const {
    selectedProject,
    activeWorkflowId,
    getActiveWorkflow,
    sessionsByWorkflow,
    startOrchestrator,
    stopOrchestrator,
    pauseOrchestrator,
    goToNextPhase,
    goToPreviousPhase,
    progressByWorkflow,
    generatedSpec,
    createWorkflow,
    setActiveWorkflow,
    isLoading,
    error,
    setError
  } = useAutonomousStore()

  // Local state
  const [bottomPanelHeight, setBottomPanelHeight] = useState(250)
  const [isSpecExpanded, setIsSpecExpanded] = useState(false)
  const [isCreatingWorkflow, setIsCreatingWorkflow] = useState(false)
  const [isStartingOrchestrator, setIsStartingOrchestrator] = useState(false)
  const [workflowError, setWorkflowError] = useState<string | null>(null)
  const [elapsedTime, setElapsedTime] = useState(0)
  const [currentPhase, setCurrentPhase] = useState<ImplementationPhase>('initialization')
  const [hasAutoStartedImplementation, setHasAutoStartedImplementation] = useState(false)

  // Refs for timer
  const startTimeRef = useRef<number | null>(null)
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null)

  const activeWorkflow = getActiveWorkflow()
  const workflowSessions = activeWorkflowId ? sessionsByWorkflow[activeWorkflowId] || [] : []
  const activeSession = workflowSessions.find(s =>
    ['starting', 'running', 'paused'].includes(s.status)
  )
  const progress = activeWorkflowId ? progressByWorkflow[activeWorkflowId] : null

  // Determine if we're in read-only mode (viewing completed/paused workflows from history)
  const isReadOnly = activeWorkflow && (
    activeWorkflow.status === 'completed' ||
    (activeWorkflow.status === 'paused' && !activeSession) ||
    (activeWorkflow.status === 'error' && !activeSession)
  )

  // Determine current implementation phase based on progress
  useEffect(() => {
    if (!progress) {
      setCurrentPhase('initialization')
      return
    }

    if (progress.total === 0) {
      setCurrentPhase('initialization')
    } else if (progress.passing === progress.total) {
      setCurrentPhase('verification')
    } else {
      setCurrentPhase('implementation')
    }
  }, [progress])

  // Auto-create workflow and start execution when component mounts with generatedSpec but no activeWorkflow
  useEffect(() => {
    const autoCreateAndStartWorkflow = async () => {
      // Guard against double-execution
      if (!selectedProject || !generatedSpec || activeWorkflowId || isCreatingWorkflow || isStartingOrchestrator) {
        return
      }

      setIsCreatingWorkflow(true)
      setWorkflowError(null)

      try {
        // Parse spec to extract meaningful title and description
        const specMetadata = parseSpecMetadata(generatedSpec.appSpecTxt)

        const workflow = await createWorkflow({
          projectPath: selectedProject.path,
          name: specMetadata.title,
          description: specMetadata.description,
          specContent: generatedSpec.appSpecTxt,
          model: 'claude-sonnet-4-20250514'
        })

        if (workflow) {
          setActiveWorkflow(workflow.id)

          // Auto-start the orchestrator after workflow creation
          // Reset timer on new start
          startTimeRef.current = null
          setElapsedTime(0)
          setIsStartingOrchestrator(true)

          // Delay slightly to allow state to settle
          // Start with generation phase to create feature_list.json
          // User can review features before starting implementation
          setTimeout(async () => {
            try {
              const specFile = '.autonomous/spec.md'

              await startOrchestrator({
                projectPath: selectedProject.path,
                workflowId: workflow.id,
                phase: 'generation',
                model: workflow.model,
                specFile
              })
              console.log('[ExecutionDashboard] Auto-started generation phase for workflow:', workflow.id)
            } catch (startErr) {
              console.error('[ExecutionDashboard] Failed to auto-start orchestrator:', startErr)
              setWorkflowError('Workflow created but failed to start execution. Click Start to try again.')
            } finally {
              setIsStartingOrchestrator(false)
            }
          }, 500)
        } else {
          setWorkflowError('Failed to create workflow. Please try again.')
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error creating workflow'
        setWorkflowError(message)
      } finally {
        setIsCreatingWorkflow(false)
      }
    }

    autoCreateAndStartWorkflow()
  }, [selectedProject, generatedSpec, activeWorkflowId, isCreatingWorkflow, isStartingOrchestrator, createWorkflow, setActiveWorkflow, startOrchestrator])

  // Timer for elapsed time
  useEffect(() => {
    if (activeSession?.status === 'running') {
      if (!startTimeRef.current) {
        startTimeRef.current = Date.now() - elapsedTime
      }

      timerIntervalRef.current = setInterval(() => {
        if (startTimeRef.current) {
          setElapsedTime(Date.now() - startTimeRef.current)
        }
      }, 1000)

      return () => {
        if (timerIntervalRef.current) {
          clearInterval(timerIntervalRef.current)
        }
      }
    } else if (activeSession?.status === 'paused') {
      // Keep the elapsed time but stop the timer
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current)
      }
    } else {
      // Reset timer when session ends
      if (!activeSession) {
        startTimeRef.current = null
        // Don't reset elapsedTime to preserve display
      }
    }
  }, [activeSession?.status, elapsedTime])

  // Check if all tests pass to auto-advance to completion
  useEffect(() => {
    if (progress && progress.total > 0 && progress.passing === progress.total) {
      // All tests pass, advance to completion phase
      goToNextPhase()
    }
  }, [progress, goToNextPhase])

  // Auto-continue from generation to implementation phase
  useEffect(() => {
    const autoContinueToImplementation = async () => {
      // Only auto-continue if:
      // 1. We have an active workflow and selected project
      // 2. Generation phase just completed (session is completed and phase is generation)
      // 3. We haven't already auto-started implementation
      // 4. We're not currently starting another orchestrator
      if (!activeWorkflow || !selectedProject || hasAutoStartedImplementation || isStartingOrchestrator) {
        return
      }

      // Check if we just completed generation phase
      const lastSession = workflowSessions[workflowSessions.length - 1]
      if (lastSession?.phase === 'generation' && lastSession?.status === 'completed') {
        console.log('[ExecutionDashboard] Generation complete, auto-starting implementation phase...')

        setHasAutoStartedImplementation(true)
        setIsStartingOrchestrator(true)

        // Small delay to show transition notification
        await new Promise(resolve => setTimeout(resolve, 1000))

        try {
          await startOrchestrator({
            projectPath: selectedProject.path,
            workflowId: activeWorkflow.id,
            phase: 'implementation',
            model: activeWorkflow.model
          })
          console.log('[ExecutionDashboard] Implementation phase started successfully')
        } catch (err) {
          console.error('[ExecutionDashboard] Failed to auto-start implementation:', err)
          setWorkflowError('Failed to start implementation phase. Click Start to try again.')
        } finally {
          setIsStartingOrchestrator(false)
        }
      }
    }

    autoContinueToImplementation()
  }, [activeWorkflow, selectedProject, workflowSessions, hasAutoStartedImplementation, isStartingOrchestrator, startOrchestrator])

  const handleBottomPanelResize = useCallback((delta: number) => {
    setBottomPanelHeight(prev => Math.max(100, Math.min(500, prev - delta)))
  }, [])

  const handleStart = async () => {
    if (!activeWorkflow || !selectedProject || isStartingOrchestrator) return

    // Reset timer on new start
    startTimeRef.current = null
    setElapsedTime(0)
    setIsStartingOrchestrator(true)

    try {
      // Smart phase selection with human-in-the-loop checkpoints:
      // - If feature_list.json doesn't exist: Start with 'generation' phase
      // - If feature_list.json exists: Start with 'implementation' phase
      // Each phase runs independently to allow checkpoint review between phases
      const featureListPath = `${selectedProject.path}/.autonomous/feature_list.json`
      let phase: 'generation' | 'implementation' = 'generation'

      try {
        const result = await window.electron.files.readFile(featureListPath)
        if (result.success && result.content) {
          phase = 'implementation'
          console.log('[ExecutionDashboard] feature_list.json exists, starting implementation phase')
        } else {
          console.log('[ExecutionDashboard] feature_list.json not found, starting generation phase')
        }
      } catch {
        console.log('[ExecutionDashboard] Could not check feature_list.json, defaulting to generation phase')
      }

      const specFile = phase === 'generation' ? '.autonomous/spec.md' : undefined

      await startOrchestrator({
        projectPath: selectedProject.path,
        workflowId: activeWorkflow.id,
        phase,
        model: activeWorkflow.model,
        specFile
      })
    } finally {
      setIsStartingOrchestrator(false)
    }
  }

  const handlePause = async () => {
    if (activeSession) {
      await pauseOrchestrator(activeSession.id)
    }
  }

  const handleStop = async () => {
    if (activeSession) {
      await stopOrchestrator(activeSession.id)
    }
  }

  const handleRetry = async () => {
    setWorkflowError(null)
    setError(null)

    // If we have a workflow, restart the orchestrator
    if (activeWorkflow && selectedProject) {
      startTimeRef.current = null
      setElapsedTime(0)

      // Smart phase selection for retry
      const featureListPath = `${selectedProject.path}/.autonomous/feature_list.json`
      let phase: 'generation' | 'implementation' = 'generation'

      try {
        const result = await window.electron.files.readFile(featureListPath)
        if (result.success && result.content) {
          phase = 'implementation'
        }
      } catch {
        // Default to generation
      }

      const specFile = phase === 'generation' ? '.autonomous/spec.md' : undefined

      console.log(`[ExecutionDashboard] Retry: Starting ${phase} phase`)

      await startOrchestrator({
        projectPath: selectedProject.path,
        workflowId: activeWorkflow.id,
        phase,
        model: activeWorkflow.model,
        specFile
      })
    }
  }

  const handleBackToSpec = () => {
    goToPreviousPhase()
  }

  // Extract spec summary (first 500 chars)
  const specSummary = generatedSpec?.markdown
    ? generatedSpec.markdown.slice(0, 500) + (generatedSpec.markdown.length > 500 ? '...' : '')
    : null

  // Count features from spec sections
  const featureCount = generatedSpec?.sections?.filter(s =>
    s.title.toLowerCase().includes('feature') || s.title.toLowerCase().includes('requirement')
  ).length || 0

  // Placeholder loading state while creating workflow
  if (isCreatingWorkflow) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8 text-center">
        <Loader2 className="h-12 w-12 text-primary animate-spin mb-4" />
        <h3 className="font-medium text-lg mb-2">Creating Workflow</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Setting up the workflow from your approved specification...
        </p>
      </div>
    )
  }

  // Error state for workflow creation
  if (workflowError && !activeWorkflow) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8 text-center">
        <AlertTriangle className="h-12 w-12 text-destructive mb-4" />
        <h3 className="font-medium text-lg mb-2">Workflow Creation Failed</h3>
        <p className="text-sm text-muted-foreground mb-4 max-w-md">
          {workflowError}
        </p>
        <div className="flex gap-3">
          <Button variant="outline" onClick={handleBackToSpec}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back to Spec Review
          </Button>
          <Button onClick={() => {
            setWorkflowError(null)
            setIsCreatingWorkflow(false)
          }}>
            <RefreshCw className="h-4 w-4 mr-1" />
            Retry
          </Button>
        </div>
      </div>
    )
  }

  // Placeholder for when no workflow exists yet and no spec
  if (!activeWorkflow && !generatedSpec) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8 text-center">
        <RefreshCw className="h-12 w-12 text-muted-foreground/30 mb-4" />
        <h3 className="font-medium text-lg mb-2">No Specification Available</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Please complete the spec review phase first.
        </p>
        <Button variant="outline" onClick={handleBackToSpec}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to Spec Review
        </Button>
      </div>
    )
  }

  // Check for orchestrator error
  const hasOrchestratorError = error || (activeSession?.status === 'error')
  const errorMessage = error || activeSession?.error

  return (
    <div className="h-full flex flex-col">
      {/* Control Bar */}
      <div className="h-12 px-4 flex items-center justify-between border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          {/* Status indicator */}
          <div className={cn(
            'h-3 w-3 rounded-full',
            activeSession?.status === 'running' && 'bg-emerald-500 animate-pulse',
            activeSession?.status === 'paused' && 'bg-yellow-500',
            activeSession?.status === 'starting' && 'bg-primary animate-pulse',
            activeSession?.status === 'error' && 'bg-red-500',
            !activeSession && 'bg-secondary'
          )} />
          <span className="font-medium text-sm">
            {isReadOnly && activeWorkflow?.status === 'completed' && '📋 View Mode'}
            {isReadOnly && activeWorkflow?.status === 'paused' && '⏸️ Paused Workflow'}
            {isReadOnly && activeWorkflow?.status === 'error' && '❌ Failed Workflow'}
            {!isReadOnly && activeSession?.status === 'running' && 'Executing...'}
            {!isReadOnly && activeSession?.status === 'paused' && 'Paused'}
            {!isReadOnly && activeSession?.status === 'starting' && 'Starting...'}
            {!isReadOnly && activeSession?.status === 'error' && 'Error'}
            {!isReadOnly && !activeSession && 'Ready to Start'}
          </span>

          {/* Agent Type Badge */}
          {activeSession && (
            <div className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border',
              activeSession.phase === 'generation'
                ? 'bg-blue-500/10 border-blue-500/20 text-blue-400'
                : 'bg-purple-500/10 border-purple-500/20 text-purple-400'
            )}>
              {activeSession.phase === 'generation' ? (
                <>
                  <Cpu className="h-3 w-3" />
                  <span>GENERATION</span>
                </>
              ) : (
                <>
                  <Code className="h-3 w-3" />
                  <span>IMPLEMENTATION</span>
                </>
              )}
            </div>
          )}

          {/* Progress summary */}
          {progress && (
            <span className="text-sm text-muted-foreground">
              {progress.passing}/{progress.total} tests passing ({progress.percentage}%)
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Time display */}
          {(activeSession || elapsedTime > 0) && (
            <div className="flex items-center gap-1 text-sm text-muted-foreground mr-2">
              <Clock className="h-4 w-4" />
              <span>{formatElapsedTime(elapsedTime)}</span>
              {progress && progress.passing > 0 && progress.passing < progress.total && (
                <span className="text-xs">
                  (est. {estimateRemainingTime(elapsedTime, progress.passing, progress.total) || '...'} remaining)
                </span>
              )}
            </div>
          )}

          {/* Read-only mode info */}
          {isReadOnly && activeWorkflow && (
            <div className="flex items-center gap-2">
              {activeWorkflow.completedAt && (
                <span className="text-xs text-muted-foreground">
                  Completed {new Date(activeWorkflow.completedAt).toLocaleString()}
                </span>
              )}
              <Button variant="outline" size="sm" onClick={goToPreviousPhase}>
                <ArrowLeft className="h-4 w-4 mr-1" />
                Back
              </Button>
            </div>
          )}

          {/* Control buttons (hidden in read-only mode) */}
          {!isReadOnly && !activeSession ? (
            <Button
              size="sm"
              onClick={handleStart}
              disabled={isLoading || !activeWorkflow || isStartingOrchestrator || isCreatingWorkflow}
            >
              {isStartingOrchestrator || isCreatingWorkflow ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  Starting...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-1" />
                  Start
                </>
              )}
            </Button>
          ) : !isReadOnly && activeSession.status === 'running' ? (
            <>
              <Button variant="outline" size="sm" onClick={handlePause}>
                <Pause className="h-4 w-4 mr-1" />
                Pause
              </Button>
              <Button variant="destructive" size="sm" onClick={handleStop}>
                <Square className="h-4 w-4 mr-1" />
                Stop
              </Button>
            </>
          ) : !isReadOnly && activeSession.status === 'paused' ? (
            <>
              <Button size="sm" onClick={handleStart} disabled={isStartingOrchestrator}>
                {isStartingOrchestrator ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    Resuming...
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 mr-1" />
                    Resume
                  </>
                )}
              </Button>
              <Button variant="destructive" size="sm" onClick={handleStop}>
                <Square className="h-4 w-4 mr-1" />
                Stop
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {/* Error Recovery Panel */}
      {hasOrchestratorError && (
        <div className="px-4 py-3 bg-destructive/10 border-b border-destructive/20">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <h4 className="font-medium text-destructive text-sm">Orchestrator Error</h4>
              <p className="text-sm text-muted-foreground mt-1 break-words">
                {errorMessage || 'An unexpected error occurred during execution.'}
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              <Button variant="outline" size="sm" onClick={handleBackToSpec}>
                <ArrowLeft className="h-4 w-4 mr-1" />
                Back to Spec
              </Button>
              <Button size="sm" onClick={handleRetry}>
                <RefreshCw className="h-4 w-4 mr-1" />
                Retry
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Phase Transition Notification */}
      {activeSession?.phase === 'generation' && activeSession?.status === 'completed' && !hasAutoStartedImplementation && (
        <div className="px-4 py-3 bg-blue-500/10 border-b border-blue-500/20">
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 text-blue-400 animate-spin" />
            <span className="text-sm text-blue-400 font-medium">
              Feature generation complete. Starting implementation phase...
            </span>
          </div>
        </div>
      )}

      {/* Simple Progress Bar */}
      {progress && progress.total > 0 && (
        <div className="px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-medium">
              Progress: {progress.passing} / {progress.total} tests
            </div>
            <div className="text-sm text-muted-foreground">
              {progress.percentage}%
            </div>
          </div>
          <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
            <div
              className={cn(
                'h-full transition-all duration-500',
                progress.percentage === 100
                  ? 'bg-green-500'
                  : 'bg-primary'
              )}
              style={{ width: `${progress.percentage}%` }}
            />
          </div>
        </div>
      )}

      {/* Collapsible Spec Summary Panel */}
      {specSummary && (
        <div className="border-b border-border shrink-0">
          <button
            className="w-full px-4 py-2 flex items-center justify-between hover:bg-accent/50 transition-colors"
            onClick={() => setIsSpecExpanded(!isSpecExpanded)}
            aria-expanded={isSpecExpanded}
            aria-controls="spec-summary-content"
          >
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Spec Summary</span>
              {featureCount > 0 && (
                <span className="text-xs bg-secondary px-2 py-0.5 rounded-full">
                  {featureCount} features
                </span>
              )}
              {progress && (
                <span className="text-xs bg-secondary px-2 py-0.5 rounded-full">
                  {progress.total} tests
                </span>
              )}
            </div>
            {isSpecExpanded ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </button>

          {isSpecExpanded && (
            <div
              id="spec-summary-content"
              className="px-4 pb-3 max-h-64 overflow-auto"
            >
              <div className="p-3 bg-secondary/30 rounded-md">
                <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono">
                  {isSpecExpanded && generatedSpec?.markdown ? generatedSpec.markdown : specSummary}
                </pre>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Current Test Status */}
      {progress?.currentTest && activeSession?.status === 'running' && (
        <div className="px-4 py-2 bg-primary/5 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 text-primary animate-spin" />
            <span className="text-sm">
              <span className="text-muted-foreground">Currently working on:</span>{' '}
              <span className="font-mono text-xs">{progress.currentTest}</span>
            </span>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 min-h-0 flex flex-col">
        {/* Progress Panel */}
        {activeWorkflow && (
          <div className="flex-1 min-h-0 overflow-hidden">
            <ProgressPanel workflow={activeWorkflow} />
          </div>
        )}

        {/* Resize Handle */}
        <ResizeHandle
          direction="vertical"
          onResize={handleBottomPanelResize}
          className="bg-border"
        />

        {/* Output Viewer */}
        <div
          style={{ height: bottomPanelHeight }}
          className="shrink-0 border-t border-border"
        >
          {activeSession ? (
            <OutputViewer sessionId={activeSession.id} />
          ) : (
            <div className="h-full flex items-center justify-center text-muted-foreground">
              <Terminal className="h-5 w-5 mr-2 opacity-50" />
              <span className="text-sm">Output will appear here when execution starts</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

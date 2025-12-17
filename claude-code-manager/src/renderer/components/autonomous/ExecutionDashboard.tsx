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
  Loader2
} from 'lucide-react'
import { Button } from '../ui/button'
import { ProgressPanel } from './ProgressPanel'
import { OutputViewer } from './OutputViewer'
import { ResizeHandle } from '../ui/ResizeHandle'
import { useAutonomousStore } from '@renderer/stores/autonomous-store'
import { cn } from '@renderer/lib/utils'

/** Implementation phases for the stepper UI */
type ImplementationPhase = 'initialization' | 'implementation' | 'verification'

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
  const [workflowError, setWorkflowError] = useState<string | null>(null)
  const [elapsedTime, setElapsedTime] = useState(0)
  const [currentPhase, setCurrentPhase] = useState<ImplementationPhase>('initialization')

  // Refs for timer
  const startTimeRef = useRef<number | null>(null)
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null)

  const activeWorkflow = getActiveWorkflow()
  const workflowSessions = activeWorkflowId ? sessionsByWorkflow[activeWorkflowId] || [] : []
  const activeSession = workflowSessions.find(s =>
    ['starting', 'running', 'paused'].includes(s.status)
  )
  const progress = activeWorkflowId ? progressByWorkflow[activeWorkflowId] : null

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

  // Auto-create workflow when component mounts with generatedSpec but no activeWorkflow
  useEffect(() => {
    const autoCreateWorkflow = async () => {
      if (!selectedProject || !generatedSpec || activeWorkflowId || isCreatingWorkflow) {
        return
      }

      setIsCreatingWorkflow(true)
      setWorkflowError(null)

      try {
        const workflow = await createWorkflow({
          projectPath: selectedProject.path,
          name: `Auto-generated workflow ${new Date().toLocaleString()}`,
          specContent: generatedSpec.appSpecTxt,
          model: 'claude-sonnet-4-20250514'
        })

        if (workflow) {
          setActiveWorkflow(workflow.id)
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

    autoCreateWorkflow()
  }, [selectedProject, generatedSpec, activeWorkflowId, isCreatingWorkflow, createWorkflow, setActiveWorkflow])

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

  const handleBottomPanelResize = useCallback((delta: number) => {
    setBottomPanelHeight(prev => Math.max(100, Math.min(500, prev - delta)))
  }, [])

  const handleStart = async () => {
    if (!activeWorkflow || !selectedProject) return

    // Reset timer on new start
    startTimeRef.current = null
    setElapsedTime(0)

    await startOrchestrator({
      projectPath: selectedProject.path,
      workflowId: activeWorkflow.id,
      phase: 'implementation',
      model: activeWorkflow.model
    })
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

      await startOrchestrator({
        projectPath: selectedProject.path,
        workflowId: activeWorkflow.id,
        phase: 'implementation',
        model: activeWorkflow.model
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
            activeSession?.status === 'starting' && 'bg-blue-500 animate-pulse',
            activeSession?.status === 'error' && 'bg-red-500',
            !activeSession && 'bg-secondary'
          )} />
          <span className="font-medium text-sm">
            {activeSession?.status === 'running' && 'Executing...'}
            {activeSession?.status === 'paused' && 'Paused'}
            {activeSession?.status === 'starting' && 'Starting...'}
            {activeSession?.status === 'error' && 'Error'}
            {!activeSession && 'Ready to Start'}
          </span>

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

          {!activeSession ? (
            <Button size="sm" onClick={handleStart} disabled={isLoading || !activeWorkflow}>
              <Play className="h-4 w-4 mr-1" />
              Start
            </Button>
          ) : activeSession.status === 'running' ? (
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
          ) : activeSession.status === 'paused' ? (
            <>
              <Button size="sm" onClick={handleStart}>
                <Play className="h-4 w-4 mr-1" />
                Resume
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

      {/* Phase Progress Stepper */}
      <div className="px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center justify-between">
          {IMPLEMENTATION_PHASES.map((phase, index) => {
            const isActive = phase.id === currentPhase
            const isComplete = IMPLEMENTATION_PHASES.findIndex(p => p.id === currentPhase) > index
            const isLast = index === IMPLEMENTATION_PHASES.length - 1

            return (
              <React.Fragment key={phase.id}>
                <div className="flex items-center gap-2">
                  {/* Step indicator */}
                  <div className={cn(
                    'h-8 w-8 rounded-full flex items-center justify-center border-2 transition-colors',
                    isComplete && 'bg-emerald-500 border-emerald-500',
                    isActive && 'border-primary bg-primary/10',
                    !isComplete && !isActive && 'border-muted-foreground/30'
                  )}>
                    {isComplete ? (
                      <CheckCircle className="h-5 w-5 text-white" />
                    ) : isActive ? (
                      <Loader2 className="h-4 w-4 text-primary animate-spin" />
                    ) : (
                      <Circle className="h-4 w-4 text-muted-foreground/30" />
                    )}
                  </div>

                  {/* Step label */}
                  <div>
                    <p className={cn(
                      'text-sm font-medium',
                      isActive && 'text-primary',
                      isComplete && 'text-emerald-500',
                      !isComplete && !isActive && 'text-muted-foreground'
                    )}>
                      {phase.label}
                    </p>
                    <p className="text-xs text-muted-foreground hidden sm:block">
                      {phase.description}
                    </p>
                  </div>
                </div>

                {/* Connector line */}
                {!isLast && (
                  <div className={cn(
                    'flex-1 h-0.5 mx-3',
                    isComplete ? 'bg-emerald-500' : 'bg-muted-foreground/20'
                  )} />
                )}
              </React.Fragment>
            )
          })}
        </div>
      </div>

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

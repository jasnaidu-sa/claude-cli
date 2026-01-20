/**
 * RalphExecutionDashboard Component
 *
 * Main execution UI for Ralph Loop orchestrator. Displays:
 * - Feature progress with status indicators
 * - Real-time streaming output
 * - Checkpoint handling with approve/skip/reject
 * - Control buttons (start/stop/pause/resume)
 * - Phase progress stepper
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
  X,
  AlertCircle,
  SkipForward,
  List,
  LayoutGrid
} from 'lucide-react'
import { Button } from '../ui/button'
import { RalphProgressPanel } from './RalphProgressPanel'
import { RalphKanbanBoard } from './RalphKanbanBoard'
import { CheckpointModal } from './CheckpointModal'
import { OutputViewer } from './OutputViewer'
import { ResizeHandle } from '../ui/ResizeHandle'
import { cn } from '@renderer/lib/utils'
import type {
  RalphSession,
  RalphFeature,
  RalphProgressData,
  RalphCheckpointData,
  RalphStatusData,
  RalphStreamChunkData,
  RalphErrorData,
  RalphOrchestratorConfig
} from '../../../preload/index'
import type { RalphPhase, RalphCheckpoint, RalphPromptConfig } from '../../../shared/types'

interface RalphExecutionDashboardProps {
  projectPath: string
  promptConfig: RalphPromptConfig
  onBack: () => void
  onComplete?: (session: RalphSession) => void
}

/** Phase info for stepper UI */
interface PhaseInfo {
  id: RalphPhase
  label: string
  description: string
}

const RALPH_PHASES: PhaseInfo[] = [
  {
    id: 'validation',
    label: 'Validation',
    description: 'Validating project and spec'
  },
  {
    id: 'generation',
    label: 'Generation',
    description: 'Generating feature list'
  },
  {
    id: 'implementation',
    label: 'Implementation',
    description: 'Implementing features'
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

export function RalphExecutionDashboard({
  projectPath,
  promptConfig,
  onBack,
  onComplete
}: RalphExecutionDashboardProps): React.ReactElement {
  // Session state
  const [session, setSession] = useState<RalphSession | null>(null)
  const [isStarting, setIsStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // UI state
  const [showSpec, setShowSpec] = useState(false)
  const [streamOutput, setStreamOutput] = useState<string[]>([])
  const [activeCheckpoint, setActiveCheckpoint] = useState<RalphCheckpoint | null>(null)
  const [elapsedTime, setElapsedTime] = useState(0)
  const [panelHeight, setPanelHeight] = useState(200)
  const [viewMode, setViewMode] = useState<'list' | 'kanban'>('kanban') // Default to kanban

  // Refs
  const startTimeRef = useRef<number | null>(null)
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const outputRef = useRef<HTMLDivElement>(null)

  // Start session
  const startSession = useCallback(async () => {
    setIsStarting(true)
    setError(null)
    setStreamOutput([])

    try {
      const config: RalphOrchestratorConfig = {
        projectPath,
        promptConfig,
        phase: 'validation'
      }

      const result = await window.electron.ralph.start(config)

      if (result.success && result.session) {
        setSession(result.session)
        startTimeRef.current = Date.now()

        // Start timer
        timerRef.current = setInterval(() => {
          if (startTimeRef.current) {
            setElapsedTime(Date.now() - startTimeRef.current)
          }
        }, 1000)
      } else {
        setError(result.error || 'Failed to start session')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start session')
    } finally {
      setIsStarting(false)
    }
  }, [projectPath, promptConfig])

  // Stop session
  const stopSession = useCallback(async () => {
    if (!session) return

    try {
      await window.electron.ralph.stop(session.id)
      setSession((prev: RalphSession | null) => prev ? { ...prev, status: 'completed' as const } : null)

      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stop session')
    }
  }, [session])

  // Pause session
  const pauseSession = useCallback(async () => {
    if (!session) return

    try {
      await window.electron.ralph.pause(session.id)
      setSession((prev: RalphSession | null) => prev ? { ...prev, status: 'paused' as const } : null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to pause session')
    }
  }, [session])

  // Resume session
  const resumeSession = useCallback(async () => {
    if (!session) return

    try {
      await window.electron.ralph.resume(session.id)
      setSession((prev: RalphSession | null) => prev ? { ...prev, status: 'running' as const } : null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resume session')
    }
  }, [session])

  // Checkpoint handlers
  const handleApproveCheckpoint = useCallback(async (comment?: string) => {
    if (!session || !activeCheckpoint) return

    try {
      await window.electron.ralph.approveCheckpoint(session.id, activeCheckpoint.id, comment)
      setActiveCheckpoint(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve checkpoint')
    }
  }, [session, activeCheckpoint])

  const handleSkipCheckpoint = useCallback(async (comment?: string) => {
    if (!session || !activeCheckpoint) return

    try {
      await window.electron.ralph.skipCheckpoint(session.id, activeCheckpoint.id, comment)
      setActiveCheckpoint(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to skip checkpoint')
    }
  }, [session, activeCheckpoint])

  const handleRejectCheckpoint = useCallback(async (comment?: string) => {
    if (!session || !activeCheckpoint) return

    try {
      await window.electron.ralph.rejectCheckpoint(session.id, activeCheckpoint.id, comment)
      setActiveCheckpoint(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reject checkpoint')
    }
  }, [session, activeCheckpoint])

  // Event listeners
  useEffect(() => {
    if (!session) return

    const unsubProgress = window.electron.ralph.onProgress((data: RalphProgressData) => {
      if (data.sessionId !== session.id) return

      // Update session with progress
      setSession((prev: RalphSession | null) => {
        if (!prev) return null
        return {
          ...prev,
          phase: data.phase || prev.phase,
          iteration: data.iteration ?? prev.iteration,
          features: data.featureId
            ? prev.features.map((f: RalphFeature) =>
                f.id === data.featureId
                  ? { ...f, status: (data.status as typeof f.status) || f.status }
                  : f
              )
            : prev.features
        }
      })
    })

    const unsubCheckpoint = window.electron.ralph.onCheckpoint((data: RalphCheckpointData) => {
      if (data.sessionId !== session.id) return
      setActiveCheckpoint(data.data)
    })

    const unsubStatus = window.electron.ralph.onStatus((data: RalphStatusData) => {
      if (data.sessionId !== session.id) return

      setSession((prev: RalphSession | null) => {
        if (!prev) return null
        return {
          ...prev,
          status: data.status,
          phase: data.phase,
          iteration: data.iteration
        }
      })

      // Handle completion
      if (data.status === 'completed') {
        if (timerRef.current) {
          clearInterval(timerRef.current)
          timerRef.current = null
        }
        if (onComplete) {
          window.electron.ralph.getStatus(session.id).then(result => {
            if (result.success && result.session) {
              onComplete(result.session)
            }
          })
        }
      }
    })

    const unsubStreamChunk = window.electron.ralph.onStreamChunk((data: RalphStreamChunkData) => {
      if (data.sessionId !== session.id) return

      const output = typeof data.data === 'string' ? data.data : JSON.stringify(data.data)
      setStreamOutput(prev => [...prev, output])

      // Auto-scroll output
      if (outputRef.current) {
        outputRef.current.scrollTop = outputRef.current.scrollHeight
      }
    })

    const unsubError = window.electron.ralph.onError((data: RalphErrorData) => {
      if (data.sessionId !== session.id) return
      setError(data.error)
      setSession((prev: RalphSession | null) => prev ? { ...prev, status: 'error' as const } : null)
    })

    return () => {
      unsubProgress()
      unsubCheckpoint()
      unsubStatus()
      unsubStreamChunk()
      unsubError()
    }
  }, [session?.id, onComplete])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
      }
    }
  }, [])

  // Get phase index for stepper
  const getCurrentPhaseIndex = (): number => {
    if (!session) return 0
    return RALPH_PHASES.findIndex(p => p.id === session.phase)
  }

  // Render phase stepper
  const renderPhaseStepper = () => (
    <div className="flex items-center justify-center gap-2 mb-4">
      {RALPH_PHASES.map((phase, index) => {
        const currentIndex = getCurrentPhaseIndex()
        const isComplete = index < currentIndex
        const isCurrent = index === currentIndex
        const isPending = index > currentIndex

        return (
          <React.Fragment key={phase.id}>
            {index > 0 && (
              <div
                className={cn(
                  'h-0.5 w-8',
                  isComplete ? 'bg-green-500' : 'bg-gray-600'
                )}
              />
            )}
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  'w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium',
                  isComplete && 'bg-green-500 text-white',
                  isCurrent && 'bg-blue-500 text-white',
                  isPending && 'bg-gray-700 text-gray-400'
                )}
              >
                {isComplete ? (
                  <CheckCircle className="w-4 h-4" />
                ) : isCurrent && session?.status === 'running' ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  index + 1
                )}
              </div>
              <span
                className={cn(
                  'text-xs mt-1',
                  isCurrent ? 'text-white' : 'text-gray-400'
                )}
              >
                {phase.label}
              </span>
            </div>
          </React.Fragment>
        )
      })}
    </div>
  )

  // Render status badge
  const renderStatusBadge = () => {
    if (!session) return null

    const statusConfig = {
      idle: { bg: 'bg-gray-500', text: 'Idle' },
      starting: { bg: 'bg-yellow-500', text: 'Starting' },
      running: { bg: 'bg-blue-500', text: 'Running' },
      paused: { bg: 'bg-yellow-500', text: 'Paused' },
      completed: { bg: 'bg-green-500', text: 'Completed' },
      error: { bg: 'bg-red-500', text: 'Error' }
    }

    const config = statusConfig[session.status as keyof typeof statusConfig] || statusConfig.idle

    return (
      <span
        className={cn(
          'px-2 py-0.5 rounded-full text-xs font-medium text-white',
          config.bg
        )}
      >
        {config.text}
      </span>
    )
  }

  // Calculate progress stats
  const getProgressStats = () => {
    if (!session || !session.features.length) {
      return { total: 0, passed: 0, failed: 0, inProgress: 0, pending: 0 }
    }

    return {
      total: session.features.length,
      passed: session.features.filter((f: RalphFeature) => f.status === 'passed').length,
      failed: session.features.filter((f: RalphFeature) => f.status === 'failed').length,
      inProgress: session.features.filter((f: RalphFeature) => f.status === 'in_progress').length,
      pending: session.features.filter((f: RalphFeature) => f.status === 'pending').length
    }
  }

  const stats = getProgressStats()

  return (
    <div className="flex flex-col h-full bg-gray-900 text-white">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={onBack}
            className="text-gray-400 hover:text-white"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h2 className="text-lg font-semibold">Ralph Execution</h2>
            <p className="text-sm text-gray-400 truncate max-w-md">{projectPath}</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Timer */}
          {session && (
            <div className="flex items-center gap-1 text-gray-400">
              <Clock className="w-4 h-4" />
              <span className="font-mono text-sm">{formatElapsedTime(elapsedTime)}</span>
            </div>
          )}

          {/* Status badge */}
          {renderStatusBadge()}

          {/* Control buttons */}
          <div className="flex items-center gap-2">
            {!session ? (
              <Button
                onClick={startSession}
                disabled={isStarting}
                className="bg-green-600 hover:bg-green-700"
              >
                {isStarting ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Play className="w-4 h-4 mr-2" />
                )}
                Start
              </Button>
            ) : session.status === 'running' ? (
              <>
                <Button
                  onClick={pauseSession}
                  variant="outline"
                  className="border-yellow-500 text-yellow-500 hover:bg-yellow-500/10"
                >
                  <Pause className="w-4 h-4 mr-2" />
                  Pause
                </Button>
                <Button
                  onClick={stopSession}
                  variant="outline"
                  className="border-red-500 text-red-500 hover:bg-red-500/10"
                >
                  <Square className="w-4 h-4 mr-2" />
                  Stop
                </Button>
              </>
            ) : session.status === 'paused' ? (
              <>
                <Button
                  onClick={resumeSession}
                  className="bg-green-600 hover:bg-green-700"
                >
                  <Play className="w-4 h-4 mr-2" />
                  Resume
                </Button>
                <Button
                  onClick={stopSession}
                  variant="outline"
                  className="border-red-500 text-red-500 hover:bg-red-500/10"
                >
                  <Square className="w-4 h-4 mr-2" />
                  Stop
                </Button>
              </>
            ) : session.status === 'completed' || session.status === 'error' ? (
              <Button
                onClick={startSession}
                className="bg-green-600 hover:bg-green-700"
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Restart
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      {/* Phase stepper */}
      {session && renderPhaseStepper()}

      {/* Error display */}
      {error && (
        <div className="mx-4 mt-2 p-3 bg-red-900/30 border border-red-700 rounded-lg flex items-center gap-2">
          <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
          <span className="text-red-300 text-sm">{error}</span>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setError(null)}
            className="ml-auto text-red-400 hover:text-red-300"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      )}

      {/* Main content area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Feature progress */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Progress summary header with view toggle */}
          {session && session.features.length > 0 && (
            <div className="p-4 pb-2 flex-shrink-0">
              <div className="flex items-center justify-between mb-3">
                {/* Stats summary */}
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-4 text-sm">
                    <span className="text-gray-400">{stats.total} total</span>
                    <span className="text-green-400">{stats.passed} passed</span>
                    <span className="text-red-400">{stats.failed} failed</span>
                    <span className="text-blue-400">{stats.inProgress} in progress</span>
                    <span className="text-gray-500">{stats.pending} pending</span>
                  </div>
                </div>

                {/* View toggle */}
                <div className="flex items-center gap-1 bg-gray-800 rounded-lg p-1">
                  <Button
                    variant={viewMode === 'kanban' ? 'secondary' : 'ghost'}
                    size="sm"
                    onClick={() => setViewMode('kanban')}
                    className="h-7 px-2 gap-1"
                    title="Kanban view"
                  >
                    <LayoutGrid className="w-4 h-4" />
                    <span className="text-xs">Kanban</span>
                  </Button>
                  <Button
                    variant={viewMode === 'list' ? 'secondary' : 'ghost'}
                    size="sm"
                    onClick={() => setViewMode('list')}
                    className="h-7 px-2 gap-1"
                    title="List view"
                  >
                    <List className="w-4 h-4" />
                    <span className="text-xs">List</span>
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Feature display area */}
          <div className="flex-1 overflow-auto">
            {session && session.features.length > 0 ? (
              viewMode === 'kanban' ? (
                <RalphKanbanBoard features={session.features} currentFeatureId={session.currentFeatureId} />
              ) : (
                <div className="p-4 pt-0">
                  <RalphProgressPanel features={session.features} currentFeatureId={session.currentFeatureId} />
                </div>
              )
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-gray-400">
                {!session ? (
                  <>
                    <Cpu className="w-12 h-12 mb-4 opacity-50" />
                    <p>Click Start to begin Ralph execution</p>
                    <p className="text-sm mt-2">
                      Using prompt: <span className="text-white">{promptConfig.prompt.substring(0, 50)}...</span>
                    </p>
                  </>
                ) : session.status === 'starting' ? (
                  <>
                    <Loader2 className="w-12 h-12 mb-4 animate-spin" />
                    <p>Starting Ralph orchestrator...</p>
                  </>
                ) : (
                  <>
                    <FileText className="w-12 h-12 mb-4 opacity-50" />
                    <p>Waiting for features...</p>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Collapsible spec panel */}
        {showSpec && (
          <div className="w-80 border-l border-gray-800 p-4 overflow-auto">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-medium">Prompt Configuration</h3>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowSpec(false)}
                className="text-gray-400"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
            <div className="space-y-3 text-sm">
              <div>
                <label className="text-gray-400">Max Iterations</label>
                <p className="font-mono">{promptConfig.maxIterations}</p>
              </div>
              <div>
                <label className="text-gray-400">Checkpoint Threshold</label>
                <p className="font-mono">{promptConfig.checkpointThreshold}</p>
              </div>
              <div>
                <label className="text-gray-400">Completion Promise</label>
                <p className="font-mono text-green-400">{promptConfig.completionPromise}</p>
              </div>
              <div>
                <label className="text-gray-400">Prompt</label>
                <pre className="mt-1 p-2 bg-gray-800 rounded text-xs overflow-auto max-h-60 whitespace-pre-wrap">
                  {promptConfig.prompt}
                </pre>
              </div>
            </div>
          </div>
        )}

        {/* Spec toggle button */}
        {!showSpec && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShowSpec(true)}
            className="absolute right-4 top-20 text-gray-400 hover:text-white"
          >
            <FileText className="w-4 h-4" />
          </Button>
        )}
      </div>

      {/* Bottom: Output viewer with resize handle */}
      <ResizeHandle
        direction="horizontal"
        onResize={(delta: number) => setPanelHeight((prev: number) => Math.max(100, Math.min(400, prev - delta)))}
      />
      <div style={{ height: panelHeight }} className="border-t border-gray-800">
        <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-800">
          <Terminal className="w-4 h-4 text-gray-400" />
          <span className="text-sm font-medium">Output</span>
          <span className="text-xs text-gray-500">({streamOutput.length} lines)</span>
        </div>
        <div
          ref={outputRef}
          className="h-[calc(100%-32px)] overflow-auto p-2 font-mono text-xs bg-gray-950"
        >
          {streamOutput.map((line, i) => (
            <div key={i} className="text-gray-300 whitespace-pre-wrap">
              {line}
            </div>
          ))}
          {streamOutput.length === 0 && (
            <div className="text-gray-500">Waiting for output...</div>
          )}
        </div>
      </div>

      {/* Checkpoint modal */}
      {activeCheckpoint && session && (
        <CheckpointModal
          checkpoint={activeCheckpoint}
          onApprove={handleApproveCheckpoint}
          onSkip={handleSkipCheckpoint}
          onReject={handleRejectCheckpoint}
        />
      )}
    </div>
  )
}

export default RalphExecutionDashboard

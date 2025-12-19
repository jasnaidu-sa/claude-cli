/**
 * ControlPanel Component
 *
 * Provides workflow control buttons (Start/Pause/Stop),
 * model selector, and session stats display.
 */

import React, { useState } from 'react'
import {
  Play,
  Pause,
  Square,
  RefreshCw,
  Settings2,
  Clock,
  Cpu,
  CheckCircle,
  AlertTriangle
} from 'lucide-react'
import { Button } from '../ui/button'
import { cn } from '@renderer/lib/utils'
import { useAutonomousStore } from '@renderer/stores/autonomous-store'
import type { WorkflowConfig, WorkflowStatus, OrchestratorPhase } from '@shared/types'

interface ControlPanelProps {
  workflow: WorkflowConfig
  onRevalidateSchema?: () => Promise<void>
}

const AVAILABLE_MODELS = [
  { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4' },
  { id: 'claude-opus-4-20250514', name: 'Claude Opus 4' },
  { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' }
]

function getPhaseText(phase: OrchestratorPhase): string {
  switch (phase) {
    case 'validation':
      return 'Validating Schema'
    case 'generation':
      return 'Generating Tests'
    case 'implementation':
      return 'Implementing Features'
    default:
      return phase
  }
}

function formatDuration(startMs: number, endMs?: number): string {
  const durationMs = (endMs || Date.now()) - startMs
  const seconds = Math.floor(durationMs / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`
  }
  return `${seconds}s`
}

export function ControlPanel({ workflow, onRevalidateSchema }: ControlPanelProps) {
  const [selectedModel, setSelectedModel] = useState(workflow.model)
  const [isStarting, setIsStarting] = useState(false)

  const {
    sessionsByWorkflow,
    startOrchestrator,
    stopOrchestrator,
    pauseOrchestrator,
    isLoading,
    schemaStatus
  } = useAutonomousStore()

  // Get active session for this workflow
  const workflowSessions = sessionsByWorkflow[workflow.id] || []
  const activeSession = workflowSessions.find(s =>
    ['starting', 'running', 'paused'].includes(s.status)
  )

  // Determine button states
  const isRunning = ['validating', 'generating', 'implementing'].includes(workflow.status)
  const isPaused = workflow.status === 'paused'
  const canStart = ['pending', 'paused', 'error'].includes(workflow.status)
  const canPause = isRunning
  const canStop = isRunning || isPaused

  // Schema validation status
  const projectPath = workflow.worktreePath || workflow.projectPath
  const validationStatus = schemaStatus[projectPath]
  const isValidating = validationStatus === 'validating'

  const handleStart = async () => {
    setIsStarting(true)
    try {
      // Start orchestrator with selected model
      // The model is passed directly to the orchestrator, not stored in workflow
      await startOrchestrator({
        projectPath: workflow.worktreePath || workflow.projectPath,
        workflowId: workflow.id,
        phase: workflow.status === 'pending' ? 'validation' : 'implementation',
        model: selectedModel,
        specFile: workflow.specFile
      })
    } finally {
      setIsStarting(false)
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

  const handleRevalidate = async () => {
    if (onRevalidateSchema) {
      await onRevalidateSchema()
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Settings2 className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-semibold text-sm">Controls</h2>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4 space-y-6">
        {/* Main Actions */}
        <div className="space-y-3">
          <h3 className="text-sm font-medium">Workflow Actions</h3>

          <div className="flex items-center gap-2">
            {canStart && (
              <Button
                onClick={handleStart}
                disabled={isLoading || isStarting}
                className="flex-1"
              >
                <Play className="h-4 w-4 mr-2" />
                {isPaused ? 'Resume' : 'Start'}
              </Button>
            )}

            {canPause && (
              <Button
                variant="secondary"
                onClick={handlePause}
                disabled={isLoading}
                className="flex-1"
              >
                <Pause className="h-4 w-4 mr-2" />
                Pause
              </Button>
            )}

            {canStop && (
              <Button
                variant="destructive"
                onClick={handleStop}
                disabled={isLoading}
              >
                <Square className="h-4 w-4 mr-2" />
                Stop
              </Button>
            )}
          </div>

          {/* Status indicator */}
          {isRunning && activeSession && (
            <div className="flex items-center gap-2 p-2 bg-primary/10 rounded-md">
              <div className="h-2 w-2 bg-primary rounded-full animate-pulse" />
              <span className="text-sm">
                {getPhaseText(activeSession.phase)}
              </span>
            </div>
          )}
        </div>

        {/* Model Selection */}
        <div className="space-y-3">
          <h3 className="text-sm font-medium">Model</h3>
          <div className="grid grid-cols-1 gap-2">
            {AVAILABLE_MODELS.map((model) => (
              <button
                key={model.id}
                type="button"
                onClick={() => setSelectedModel(model.id)}
                disabled={isRunning}
                className={cn(
                  'p-3 rounded-md border text-left transition-colors text-sm',
                  selectedModel === model.id
                    ? 'border-primary bg-primary/10'
                    : 'border-border hover:border-primary/50',
                  isRunning && 'opacity-50 cursor-not-allowed'
                )}
              >
                <div className="flex items-center gap-2">
                  <Cpu className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">{model.name}</span>
                </div>
              </button>
            ))}
          </div>
          {selectedModel !== workflow.model && (
            <p className="text-xs text-yellow-500">
              Model will be updated when you start the workflow
            </p>
          )}
        </div>

        {/* Schema Validation */}
        <div className="space-y-3">
          <h3 className="text-sm font-medium">Schema Validation</h3>

          <div className="flex items-center gap-2 p-3 bg-secondary/30 rounded-md">
            {workflow.schemaValidation ? (
              workflow.schemaValidation.valid ? (
                <>
                  <CheckCircle className="h-4 w-4 text-emerald-500" />
                  <span className="text-sm">Schema valid</span>
                </>
              ) : (
                <>
                  <AlertTriangle className="h-4 w-4 text-yellow-500" />
                  <span className="text-sm">
                    {workflow.schemaValidation.discrepancies.length} discrepancies found
                  </span>
                </>
              )
            ) : (
              <>
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Not validated</span>
              </>
            )}
          </div>

          <Button
            variant="outline"
            onClick={handleRevalidate}
            disabled={isValidating || isRunning}
            className="w-full"
          >
            <RefreshCw className={cn('h-4 w-4 mr-2', isValidating && 'animate-spin')} />
            {isValidating ? 'Validating...' : 'Re-validate Schema'}
          </Button>
        </div>

        {/* Session Stats */}
        {workflow.startedAt && (
          <div className="space-y-3">
            <h3 className="text-sm font-medium">Session Stats</h3>

            <div className="space-y-2 text-sm">
              <div className="flex justify-between py-1.5 border-b border-border">
                <span className="text-muted-foreground">Duration</span>
                <span className="font-mono">
                  {formatDuration(workflow.startedAt, workflow.completedAt)}
                </span>
              </div>

              <div className="flex justify-between py-1.5 border-b border-border">
                <span className="text-muted-foreground">Started</span>
                <span>{new Date(workflow.startedAt).toLocaleString()}</span>
              </div>

              {workflow.completedAt && (
                <div className="flex justify-between py-1.5 border-b border-border">
                  <span className="text-muted-foreground">Completed</span>
                  <span>{new Date(workflow.completedAt).toLocaleString()}</span>
                </div>
              )}

              <div className="flex justify-between py-1.5">
                <span className="text-muted-foreground">Sessions</span>
                <span>{workflowSessions.length}</span>
              </div>
            </div>
          </div>
        )}

        {/* Error Display */}
        {workflow.error && (
          <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-md">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="h-4 w-4 text-red-500" />
              <span className="text-sm font-medium text-red-500">Error</span>
            </div>
            <p className="text-xs text-red-400">{workflow.error}</p>
          </div>
        )}
      </div>
    </div>
  )
}

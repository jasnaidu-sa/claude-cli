/**
 * WorkflowCard Component
 *
 * Displays a single workflow with status, progress indicators,
 * and action buttons.
 */

import React from 'react'
import {
  Play,
  Pause,
  Square,
  Trash2,
  CheckCircle,
  AlertCircle,
  Circle,
  Clock,
  RefreshCw
} from 'lucide-react'
import { Button } from '../ui/button'
import { cn } from '@renderer/lib/utils'
import type { WorkflowConfig, WorkflowStatus } from '@shared/types'

interface WorkflowCardProps {
  workflow: WorkflowConfig
  isActive: boolean
  onSelect: (workflowId: string) => void
  onStart: (workflowId: string) => void
  onPause: (workflowId: string) => void
  onStop: (workflowId: string) => void
  onDelete: (workflowId: string) => void
}

function getStatusIcon(status: WorkflowStatus) {
  switch (status) {
    case 'pending':
      return <Clock className="h-4 w-4 text-muted-foreground" />
    case 'validating':
      return <RefreshCw className="h-4 w-4 text-yellow-500 animate-spin" />
    case 'generating':
      return <RefreshCw className="h-4 w-4 text-primary animate-spin" />
    case 'implementing':
      return <Circle className="h-4 w-4 text-emerald-500 fill-emerald-500 animate-pulse" />
    case 'paused':
      return <Pause className="h-4 w-4 text-yellow-500" />
    case 'completed':
      return <CheckCircle className="h-4 w-4 text-emerald-500" />
    case 'error':
      return <AlertCircle className="h-4 w-4 text-red-500" />
    default:
      return <Circle className="h-4 w-4 text-muted-foreground" />
  }
}

function getStatusText(status: WorkflowStatus): string {
  switch (status) {
    case 'pending':
      return 'Pending'
    case 'validating':
      return 'Validating Schema'
    case 'generating':
      return 'Generating Tests'
    case 'implementing':
      return 'Implementing'
    case 'paused':
      return 'Paused'
    case 'completed':
      return 'Completed'
    case 'error':
      return 'Error'
    default:
      return status
  }
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export function WorkflowCard({
  workflow,
  isActive,
  onSelect,
  onStart,
  onPause,
  onStop,
  onDelete
}: WorkflowCardProps) {
  const isRunning = ['validating', 'generating', 'implementing'].includes(workflow.status)
  const isPaused = workflow.status === 'paused'
  const canStart = workflow.status === 'pending' || workflow.status === 'paused' || workflow.status === 'error'

  // Calculate progress percentage
  const progress = workflow.progress
  const percentage = progress ? Math.round((progress.testsPassing / progress.testsTotal) * 100) || 0 : 0

  const handleCardClick = (e: React.MouseEvent) => {
    // Don't select if clicking a button
    if ((e.target as HTMLElement).closest('button')) return
    onSelect(workflow.id)
  }

  return (
    <div
      onClick={handleCardClick}
      className={cn(
        'p-4 rounded-lg border cursor-pointer transition-all',
        'hover:border-primary/50',
        isActive ? 'border-primary bg-primary/5 ring-1 ring-primary/20' : 'border-border bg-card'
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-sm truncate">{workflow.name}</h3>
          {workflow.description && (
            <p className="text-xs text-muted-foreground truncate mt-0.5">
              {workflow.description}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1.5 ml-2">
          {getStatusIcon(workflow.status)}
          <span className="text-xs text-muted-foreground">
            {getStatusText(workflow.status)}
          </span>
        </div>
      </div>

      {/* Progress Bar (if running or has progress) */}
      {progress && progress.testsTotal > 0 && (
        <div className="mb-3">
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-muted-foreground">
              {progress.testsPassing}/{progress.testsTotal} tests passing
            </span>
            <span className="font-medium">{percentage}%</span>
          </div>
          <div className="h-2 bg-secondary rounded-full overflow-hidden">
            <div
              className={cn(
                'h-full transition-all duration-500',
                percentage === 100 ? 'bg-emerald-500' : 'bg-primary'
              )}
              style={{ width: `${percentage}%` }}
            />
          </div>
          {progress.currentTest && (
            <p className="text-xs text-muted-foreground mt-1 truncate">
              Current: {progress.currentTest}
            </p>
          )}
        </div>
      )}

      {/* Model & Date Info */}
      <div className="flex items-center justify-between text-xs text-muted-foreground mb-3">
        <span className="px-1.5 py-0.5 bg-secondary rounded">
          {workflow.model}
        </span>
        <span>{formatDate(workflow.updatedAt)}</span>
      </div>

      {/* Error Display */}
      {workflow.error && (
        <div className="mb-3 p-2 bg-red-500/10 border border-red-500/20 rounded text-xs text-red-500">
          {workflow.error}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          {canStart && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onStart(workflow.id)}
              className="h-7 px-2"
            >
              <Play className="h-3 w-3 mr-1" />
              {isPaused ? 'Resume' : 'Start'}
            </Button>
          )}

          {isRunning && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onPause(workflow.id)}
                className="h-7 px-2"
              >
                <Pause className="h-3 w-3 mr-1" />
                Pause
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onStop(workflow.id)}
                className="h-7 px-2 hover:text-destructive"
              >
                <Square className="h-3 w-3 mr-1" />
                Stop
              </Button>
            </>
          )}
        </div>

        <Button
          variant="ghost"
          size="icon"
          onClick={() => onDelete(workflow.id)}
          className="h-7 w-7 hover:bg-destructive/10 hover:text-destructive"
          disabled={isRunning}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  )
}

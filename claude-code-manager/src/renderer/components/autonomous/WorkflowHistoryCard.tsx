/**
 * WorkflowHistoryCard Component
 *
 * Individual workflow card in the history modal.
 * Shows workflow status, progress, timestamps, and action buttons.
 */

import React from 'react'
import {
  CheckCircle2,
  Pause,
  XCircle,
  Loader2,
  Clock,
  Calendar,
  FolderOpen,
  Eye,
  Play,
  RotateCw,
  Archive
} from 'lucide-react'
import { Button } from '../ui/button'
import { cn } from '@renderer/lib/utils'
import type { WorkflowConfig, WorkflowStatus } from '@shared/types'

interface WorkflowHistoryCardProps {
  workflow: WorkflowConfig
  onViewResults: (workflow: WorkflowConfig) => void
  onResume: (workflow: WorkflowConfig) => void
  onArchive: (workflow: WorkflowConfig) => void
}

function getStatusBadge(status: WorkflowStatus) {
  switch (status) {
    case 'completed':
      return (
        <div className="flex items-center gap-1.5 text-xs text-green-400 bg-green-500/10 px-2 py-1 rounded-full border border-green-500/20">
          <CheckCircle2 className="h-3.5 w-3.5" />
          <span>Completed</span>
        </div>
      )
    case 'paused':
      return (
        <div className="flex items-center gap-1.5 text-xs text-amber-400 bg-amber-500/10 px-2 py-1 rounded-full border border-amber-500/20">
          <Pause className="h-3.5 w-3.5" />
          <span>Paused</span>
        </div>
      )
    case 'error':
      return (
        <div className="flex items-center gap-1.5 text-xs text-red-400 bg-red-500/10 px-2 py-1 rounded-full border border-red-500/20">
          <XCircle className="h-3.5 w-3.5" />
          <span>Error</span>
        </div>
      )
    case 'implementing':
    case 'generating':
      return (
        <div className="flex items-center gap-1.5 text-xs text-blue-400 bg-blue-500/10 px-2 py-1 rounded-full border border-blue-500/20">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span>In Progress</span>
        </div>
      )
    case 'validating':
      return (
        <div className="flex items-center gap-1.5 text-xs text-purple-400 bg-purple-500/10 px-2 py-1 rounded-full border border-purple-500/20">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span>Validating</span>
        </div>
      )
    default:
      return (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-secondary px-2 py-1 rounded-full">
          <Clock className="h-3.5 w-3.5" />
          <span>Pending</span>
        </div>
      )
  }
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  const weeks = Math.floor(days / 7)

  if (seconds < 60) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`
  if (weeks < 4) return `${weeks}w ago`
  return new Date(timestamp).toLocaleDateString()
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: timestamp < Date.now() - 365 * 24 * 60 * 60 * 1000 ? 'numeric' : undefined
  })
}

export function WorkflowHistoryCard({
  workflow,
  onViewResults,
  onResume,
  onArchive
}: WorkflowHistoryCardProps) {
  // Extract project name from path
  const projectName = workflow.projectPath.split(/[/\\]/).pop() || 'Unknown'

  // Get progress info
  const progress = workflow.progress
  const testsTotal = progress?.testsTotal || 0
  const testsPassing = progress?.testsPassing || 0
  const progressText = testsTotal > 0 ? `${testsPassing}/${testsTotal} tests passing` : 'No tests'

  // Get timestamp text based on status
  let timestampText = ''
  if (workflow.status === 'completed' && workflow.completedAt) {
    timestampText = `Completed ${formatRelativeTime(workflow.completedAt)}`
  } else if (workflow.status === 'paused' && workflow.updatedAt) {
    timestampText = `Last active ${formatRelativeTime(workflow.updatedAt)}`
  } else if (workflow.status === 'error' && workflow.updatedAt) {
    timestampText = `Failed ${formatRelativeTime(workflow.updatedAt)}`
  } else if (workflow.startedAt) {
    timestampText = `Started ${formatRelativeTime(workflow.startedAt)}`
  }

  // Determine which actions to show based on status
  const isCompleted = workflow.status === 'completed'
  const isPausedOrError = workflow.status === 'paused' || workflow.status === 'error'
  const isInProgress = workflow.status === 'implementing' || workflow.status === 'generating'

  return (
    <div
      className={cn(
        'group p-4 rounded-lg border bg-card hover:border-primary/30 transition-all',
        isCompleted && 'border-green-500/20 bg-green-500/5',
        isPausedOrError && 'border-amber-500/20 bg-amber-500/5',
        isInProgress && 'border-blue-500/20 bg-blue-500/5'
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          {/* Project name - prominent */}
          <div className="flex items-center gap-1.5 mb-1">
            <FolderOpen className="h-4 w-4 text-primary" />
            <span className="font-medium text-sm text-primary">{projectName}</span>
          </div>
          {/* Workflow name */}
          <h3 className="font-semibold text-base mb-1 truncate" title={workflow.name}>
            {workflow.name}
          </h3>
          {/* Description */}
          {workflow.description && (
            <p className="text-sm text-muted-foreground mb-1 line-clamp-2">
              {workflow.description}
            </p>
          )}
          {/* Timestamp */}
          <div className="text-xs text-muted-foreground">
            {timestampText}
          </div>
        </div>
        {getStatusBadge(workflow.status)}
      </div>

      {/* Progress & Details */}
      <div className="flex items-center gap-4 mb-3 text-sm">
        <div className="flex items-center gap-1.5">
          <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
          <span>{progressText}</span>
        </div>
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Calendar className="h-4 w-4" />
          <span>Created {formatDate(workflow.createdAt)}</span>
        </div>
      </div>

      {/* Error message if present */}
      {workflow.error && (
        <div className="mb-3 p-2 bg-red-500/10 border border-red-500/20 rounded text-xs text-red-400">
          {workflow.error}
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex items-center gap-2">
        {isCompleted && (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onViewResults(workflow)}
              className="flex-1"
            >
              <Eye className="h-3.5 w-3.5 mr-1.5" />
              View Results
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onArchive(workflow)}
            >
              <Archive className="h-3.5 w-3.5" />
            </Button>
          </>
        )}

        {isPausedOrError && (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onViewResults(workflow)}
              className="flex-1"
            >
              <Eye className="h-3.5 w-3.5 mr-1.5" />
              View Progress
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={() => onResume(workflow)}
              className="flex-1"
            >
              {workflow.status === 'error' ? (
                <>
                  <RotateCw className="h-3.5 w-3.5 mr-1.5" />
                  Retry
                </>
              ) : (
                <>
                  <Play className="h-3.5 w-3.5 mr-1.5" />
                  Resume
                </>
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onArchive(workflow)}
            >
              <Archive className="h-3.5 w-3.5" />
            </Button>
          </>
        )}

        {isInProgress && (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onViewResults(workflow)}
              className="flex-1"
            >
              <Eye className="h-3.5 w-3.5 mr-1.5" />
              View Dashboard
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onArchive(workflow)}
            >
              <Archive className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

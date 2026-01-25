/**
 * BVS Subtask Progress Component (RALPH-006)
 *
 * Visual representation of Ralph Loop subtask execution:
 * - Timeline view of subtasks
 * - Status indicators
 * - Progress bars
 * - Turn usage tracking
 * - Real-time updates
 */

import React, { useState, useEffect } from 'react'
import {
  CheckCircle2,
  Circle,
  Loader2,
  XCircle,
  Clock,
  Zap,
  ChevronDown,
  ChevronRight,
  FileText,
  GitCommit,
  AlertTriangle
} from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import type { BvsSubtask } from '@shared/bvs-types'

interface BvsSubtaskProgressProps {
  sessionId: string
  sectionId: string
  subtasks?: BvsSubtask[]
  onRefresh?: () => void
}

export function BvsSubtaskProgress({
  sessionId,
  sectionId,
  subtasks = [],
  onRefresh
}: BvsSubtaskProgressProps) {
  const [isExpanded, setIsExpanded] = useState(true)
  const [expandedSubtasks, setExpandedSubtasks] = useState<Set<string>>(new Set())

  // Poll for subtask updates
  useEffect(() => {
    const loadSubtasks = async () => {
      try {
        const result = await window.electron.bvsPlanning.getSubtaskProgress(sessionId, sectionId)
        if (result.success && onRefresh) {
          onRefresh()
        }
      } catch (error) {
        console.error('[BvsSubtaskProgress] Error loading subtasks:', error)
      }
    }

    // Poll every 2 seconds during execution
    const hasActive = subtasks.some(s => s.status === 'in_progress')
    if (hasActive) {
      const interval = setInterval(loadSubtasks, 2000)
      return () => clearInterval(interval)
    }
  }, [sessionId, sectionId, subtasks, onRefresh])

  const toggleSubtask = (subtaskId: string) => {
    setExpandedSubtasks(prev => {
      const next = new Set(prev)
      if (next.has(subtaskId)) {
        next.delete(subtaskId)
      } else {
        next.add(subtaskId)
      }
      return next
    })
  }

  const getStatusIcon = (status: string, size = 'h-4 w-4') => {
    switch (status) {
      case 'done':
        return <CheckCircle2 className={cn(size, 'text-green-500')} />
      case 'failed':
        return <XCircle className={cn(size, 'text-red-500')} />
      case 'in_progress':
        return <Loader2 className={cn(size, 'text-blue-500 animate-spin')} />
      default:
        return <Circle className={cn(size, 'text-gray-300')} />
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'done':
        return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
      case 'failed':
        return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
      case 'in_progress':
        return 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
      default:
        return 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300'
    }
  }

  const formatDuration = (ms?: number) => {
    if (!ms) return '—'
    const seconds = Math.floor(ms / 1000)
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const completedCount = subtasks.filter(s => s.status === 'done').length
  const failedCount = subtasks.filter(s => s.status === 'failed').length
  const inProgressCount = subtasks.filter(s => s.status === 'in_progress').length

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-3 bg-muted/30 hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
          <Zap className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          <span className="text-sm font-semibold">Subtask Progress</span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {completedCount > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 font-medium">
              {completedCount} done
            </span>
          )}
          {failedCount > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 font-medium">
              {failedCount} failed
            </span>
          )}
          {inProgressCount > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-medium flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              {inProgressCount} active
            </span>
          )}
        </div>
      </button>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="p-4">
          {subtasks.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              No subtasks yet. Subtasks will appear when execution starts.
            </div>
          ) : (
            <div className="space-y-3">
              {/* Timeline */}
              <div className="relative">
                {subtasks.map((subtask, index) => {
                  const isExpanded = expandedSubtasks.has(subtask.id)
                  const isLast = index === subtasks.length - 1

                  return (
                    <div key={subtask.id} className="relative">
                      {/* Timeline connector */}
                      {!isLast && (
                        <div className="absolute left-[11px] top-8 bottom-0 w-0.5 bg-border" />
                      )}

                      {/* Subtask Card */}
                      <div className="relative">
                        <button
                          onClick={() => toggleSubtask(subtask.id)}
                          className="w-full flex items-start gap-3 p-3 rounded-lg hover:bg-muted/50 transition-colors text-left"
                        >
                          {/* Status Icon */}
                          <div className="flex-shrink-0 mt-0.5">
                            {getStatusIcon(subtask.status)}
                          </div>

                          {/* Content */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2 mb-1">
                              <div className="flex-1 min-w-0">
                                <h4 className="text-sm font-medium truncate">{subtask.name}</h4>
                                <p className="text-xs text-muted-foreground mt-0.5 truncate">
                                  {subtask.description}
                                </p>
                              </div>
                              <div className="flex items-center gap-1">
                                {isExpanded ? (
                                  <ChevronDown className="h-3 w-3 text-muted-foreground" />
                                ) : (
                                  <ChevronRight className="h-3 w-3 text-muted-foreground" />
                                )}
                              </div>
                            </div>

                            {/* Progress Bar (for in_progress only) */}
                            {subtask.status === 'in_progress' && (
                              <div className="mb-2">
                                <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                                  <span>Turn {subtask.turnsUsed} of {subtask.maxTurns}</span>
                                  <span>{Math.round((subtask.turnsUsed / subtask.maxTurns) * 100)}%</span>
                                </div>
                                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-blue-500 transition-all duration-300"
                                    style={{ width: `${(subtask.turnsUsed / subtask.maxTurns) * 100}%` }}
                                  />
                                </div>
                              </div>
                            )}

                            {/* Quick Stats */}
                            <div className="flex items-center gap-3 text-xs">
                              <span className={cn(
                                'px-2 py-0.5 rounded font-medium',
                                getStatusColor(subtask.status)
                              )}>
                                {subtask.status.replace('_', ' ')}
                              </span>
                              <span className="text-muted-foreground flex items-center gap-1">
                                <FileText className="h-3 w-3" />
                                {subtask.files.length} file{subtask.files.length !== 1 ? 's' : ''}
                              </span>
                              {subtask.duration && (
                                <span className="text-muted-foreground flex items-center gap-1">
                                  <Clock className="h-3 w-3" />
                                  {formatDuration(subtask.duration)}
                                </span>
                              )}
                            </div>
                          </div>
                        </button>

                        {/* Expanded Details */}
                        {isExpanded && (
                          <div className="ml-9 mr-3 mb-3 p-3 bg-muted/30 rounded-lg space-y-3">
                            {/* Files */}
                            <div>
                              <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                                Files ({subtask.files.length})
                              </h5>
                              <div className="space-y-1">
                                {subtask.files.map((file, i) => (
                                  <div key={i} className="text-xs font-mono text-muted-foreground truncate">
                                    {file}
                                  </div>
                                ))}
                              </div>
                            </div>

                            {/* Metrics */}
                            {subtask.metrics && (
                              <div>
                                <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                                  Metrics
                                </h5>
                                <div className="grid grid-cols-2 gap-2">
                                  <div className="text-xs">
                                    <span className="text-muted-foreground">Model:</span>
                                    <span className="ml-1 font-medium">{subtask.metrics.model}</span>
                                  </div>
                                  <div className="text-xs">
                                    <span className="text-muted-foreground">Turns:</span>
                                    <span className="ml-1 font-medium">{subtask.metrics.turnsUsed}</span>
                                  </div>
                                  <div className="text-xs">
                                    <span className="text-muted-foreground">Input:</span>
                                    <span className="ml-1 font-medium">{subtask.metrics.tokensInput.toLocaleString()}</span>
                                  </div>
                                  <div className="text-xs">
                                    <span className="text-muted-foreground">Output:</span>
                                    <span className="ml-1 font-medium">{subtask.metrics.tokensOutput.toLocaleString()}</span>
                                  </div>
                                  <div className="text-xs">
                                    <span className="text-muted-foreground">Cost:</span>
                                    <span className="ml-1 font-medium">${subtask.metrics.costUsd.toFixed(4)}</span>
                                  </div>
                                  <div className="text-xs">
                                    <span className="text-muted-foreground">Changes:</span>
                                    <span className="ml-1 font-medium">
                                      +{subtask.metrics.linesAdded} -{subtask.metrics.linesRemoved}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            )}

                            {/* Commit */}
                            {subtask.commitSha && (
                              <div>
                                <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                                  Commit
                                </h5>
                                <div className="flex items-center gap-2 text-xs">
                                  <GitCommit className="h-3 w-3 text-muted-foreground" />
                                  <code className="font-mono text-muted-foreground">{subtask.commitSha}</code>
                                </div>
                              </div>
                            )}

                            {/* Error */}
                            {subtask.error && (
                              <div>
                                <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                                  Error
                                </h5>
                                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded p-2">
                                  <div className="flex items-start gap-2">
                                    <AlertTriangle className="h-3 w-3 text-red-500 flex-shrink-0 mt-0.5" />
                                    <p className="text-xs text-red-800 dark:text-red-200">{subtask.error}</p>
                                  </div>
                                </div>
                              </div>
                            )}

                            {/* Retry Count */}
                            {subtask.retryCount > 0 && (
                              <div className="text-xs text-muted-foreground">
                                Retry attempt: {subtask.retryCount}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Summary Footer */}
              <div className="pt-3 border-t border-border">
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div>
                    <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                      {completedCount}
                    </div>
                    <div className="text-xs text-muted-foreground">Completed</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                      {inProgressCount}
                    </div>
                    <div className="text-xs text-muted-foreground">In Progress</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-red-600 dark:text-red-400">
                      {failedCount}
                    </div>
                    <div className="text-xs text-muted-foreground">Failed</div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

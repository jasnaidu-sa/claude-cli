/**
 * BVS Subtask Metrics Component (RALPH-004)
 *
 * Displays cost tracking and metrics for Ralph Loop subtask execution:
 * - Per-subtask costs (tokens, USD)
 * - Aggregated section costs
 * - Model selection visualization
 * - Session limits and budget tracking
 * - Real-time cost updates
 */

import React, { useState, useEffect } from 'react'
import {
  DollarSign,
  Zap,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  ChevronDown,
  ChevronRight,
  Clock,
  FileText,
  Database
} from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import type { BvsSubtask, BvsSubtaskMetrics } from '@shared/bvs-types'

interface BvsSubtaskMetricsProps {
  sessionId: string
  sectionId: string
  subtasks?: BvsSubtask[]
  onRefresh?: () => void
}

interface AggregatedMetrics {
  totalCost: number
  totalTokensInput: number
  totalTokensOutput: number
  avgCostPerSubtask: number
  haikuCount: number
  sonnetCount: number
  totalDuration: number
}

export function BvsSubtaskMetrics({
  sessionId,
  sectionId,
  subtasks = [],
  onRefresh
}: BvsSubtaskMetricsProps) {
  const [isExpanded, setIsExpanded] = useState(true)
  const [isLoading, setIsLoading] = useState(false)
  const [sessionCost, setSessionCost] = useState<number | null>(null)
  const [sessionLimits, setSessionLimits] = useState({
    maxCostPerSubtask: 0.50,
    maxCostPerSection: 5.00,
    maxTotalCost: 50.00
  })

  // Poll for session cost updates
  useEffect(() => {
    let failureCount = 0
    const MAX_FAILURES = 3

    const loadSessionCost = async () => {
      try {
        const result = await window.electron.bvsGetSessionCost(sessionId)
        if (result.success && typeof result.cost === 'number') {
          setSessionCost(result.cost)
          failureCount = 0 // Reset on success
        } else {
          failureCount++
        }
      } catch (error) {
        failureCount++
        console.error('[BvsSubtaskMetrics] Error loading session cost:', error)
      }
    }

    loadSessionCost()
    const interval = setInterval(() => {
      if (failureCount < MAX_FAILURES) {
        loadSessionCost()
      } else {
        console.warn('[BvsSubtaskMetrics] Stopped polling after multiple failures')
        clearInterval(interval)
      }
    }, 5000)

    return () => clearInterval(interval)
  }, [sessionId])

  // Calculate aggregated metrics
  const aggregated: AggregatedMetrics = subtasks.reduce(
    (acc, subtask) => {
      if (!subtask.metrics) return acc

      // Defensive checks for each metric property
      const costUsd = subtask.metrics.costUsd ?? 0
      const tokensInput = subtask.metrics.tokensInput ?? 0
      const tokensOutput = subtask.metrics.tokensOutput ?? 0

      return {
        totalCost: acc.totalCost + costUsd,
        totalTokensInput: acc.totalTokensInput + tokensInput,
        totalTokensOutput: acc.totalTokensOutput + tokensOutput,
        avgCostPerSubtask: 0, // calculated after reduce
        haikuCount: acc.haikuCount + (subtask.metrics.model === 'haiku' ? 1 : 0),
        sonnetCount: acc.sonnetCount + (subtask.metrics.model === 'sonnet' ? 1 : 0),
        totalDuration: acc.totalDuration + (subtask.duration ?? 0)
      }
    },
    {
      totalCost: 0,
      totalTokensInput: 0,
      totalTokensOutput: 0,
      avgCostPerSubtask: 0,
      haikuCount: 0,
      sonnetCount: 0,
      totalDuration: 0
    }
  )

  const completedSubtasks = subtasks.filter(s => s.status === 'done' || s.status === 'failed')
  aggregated.avgCostPerSubtask = completedSubtasks.length > 0
    ? aggregated.totalCost / completedSubtasks.length
    : 0

  // Check if approaching limits
  const approachingSubtaskLimit = aggregated.avgCostPerSubtask > sessionLimits.maxCostPerSubtask * 0.8
  const approachingSectionLimit = aggregated.totalCost > sessionLimits.maxCostPerSection * 0.8
  const approachingTotalLimit = sessionCost !== null && sessionCost > sessionLimits.maxTotalCost * 0.8

  const formatCost = (usd: number) => {
    return `$${usd.toFixed(4)}`
  }

  const formatTokens = (tokens: number) => {
    if (tokens >= 1_000_000) {
      return `${(tokens / 1_000_000).toFixed(2)}M`
    } else if (tokens >= 1_000) {
      return `${(tokens / 1_000).toFixed(1)}K`
    }
    return tokens.toString()
  }

  const formatDuration = (ms: number) => {
    const seconds = Math.floor(ms / 1000)
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const getModelBadgeColor = (model: string) => {
    return model === 'haiku'
      ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
      : 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'done':
        return <CheckCircle2 className="h-3 w-3 text-green-500" />
      case 'failed':
        return <AlertTriangle className="h-3 w-3 text-red-500" />
      case 'in_progress':
        return <Loader2 className="h-3 w-3 text-blue-500 animate-spin" />
      default:
        return <Clock className="h-3 w-3 text-gray-400" />
    }
  }

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
          <DollarSign className="h-4 w-4 text-green-600 dark:text-green-400" />
          <span className="text-sm font-semibold">Cost Tracking</span>
          <span className="text-xs text-muted-foreground">
            ({completedSubtasks.length}/{subtasks.length} subtasks)
          </span>
        </div>
        <div className="flex items-center gap-3">
          {approachingSectionLimit && (
            <AlertTriangle className="h-4 w-4 text-yellow-500" />
          )}
          <span className="text-sm font-mono font-medium">
            {formatCost(aggregated.totalCost)}
          </span>
        </div>
      </button>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="p-4 space-y-4">
          {/* Summary Cards */}
          <div className="grid grid-cols-2 gap-3">
            {/* Total Cost */}
            <div className="bg-background border border-border rounded-lg p-3">
              <div className="flex items-center gap-2 mb-1">
                <DollarSign className="h-3 w-3 text-green-600 dark:text-green-400" />
                <span className="text-xs text-muted-foreground">Section Cost</span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-lg font-mono font-semibold">
                  {formatCost(aggregated.totalCost)}
                </span>
                <span className="text-xs text-muted-foreground">
                  / {formatCost(sessionLimits.maxCostPerSection)}
                </span>
              </div>
              {approachingSectionLimit && (
                <div className="mt-1 text-xs text-yellow-600 dark:text-yellow-400 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  Approaching limit
                </div>
              )}
            </div>

            {/* Session Cost */}
            <div className="bg-background border border-border rounded-lg p-3">
              <div className="flex items-center gap-2 mb-1">
                <TrendingUp className="h-3 w-3 text-blue-600 dark:text-blue-400" />
                <span className="text-xs text-muted-foreground">Session Total</span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-lg font-mono font-semibold">
                  {sessionCost !== null ? formatCost(sessionCost) : '—'}
                </span>
                <span className="text-xs text-muted-foreground">
                  / {formatCost(sessionLimits.maxTotalCost)}
                </span>
              </div>
              {approachingTotalLimit && (
                <div className="mt-1 text-xs text-yellow-600 dark:text-yellow-400 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  Approaching limit
                </div>
              )}
            </div>

            {/* Tokens */}
            <div className="bg-background border border-border rounded-lg p-3">
              <div className="flex items-center gap-2 mb-1">
                <Database className="h-3 w-3 text-purple-600 dark:text-purple-400" />
                <span className="text-xs text-muted-foreground">Tokens Used</span>
              </div>
              <div className="space-y-0.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Input:</span>
                  <span className="font-mono font-medium">{formatTokens(aggregated.totalTokensInput)}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Output:</span>
                  <span className="font-mono font-medium">{formatTokens(aggregated.totalTokensOutput)}</span>
                </div>
              </div>
            </div>

            {/* Model Distribution */}
            <div className="bg-background border border-border rounded-lg p-3">
              <div className="flex items-center gap-2 mb-1">
                <Zap className="h-3 w-3 text-yellow-600 dark:text-yellow-400" />
                <span className="text-xs text-muted-foreground">Model Split</span>
              </div>
              <div className="space-y-0.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Haiku:</span>
                  <span className="font-mono font-medium text-green-600 dark:text-green-400">
                    {aggregated.haikuCount}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Sonnet:</span>
                  <span className="font-mono font-medium text-purple-600 dark:text-purple-400">
                    {aggregated.sonnetCount}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Subtask List */}
          {subtasks.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Subtask Breakdown
              </h4>
              <div className="space-y-2">
                {subtasks.map((subtask) => (
                  <div
                    key={subtask.id}
                    className="bg-background border border-border rounded-lg p-3 space-y-2"
                  >
                    {/* Subtask Header */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2 flex-1 min-w-0">
                        {getStatusIcon(subtask.status)}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{subtask.name}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {subtask.files.length} file{subtask.files.length !== 1 ? 's' : ''}
                          </p>
                        </div>
                      </div>
                      {subtask.metrics && (
                        <div className="flex flex-col items-end gap-1">
                          <span className="text-sm font-mono font-semibold">
                            {formatCost(subtask.metrics.costUsd)}
                          </span>
                          <span className={cn(
                            'text-xs px-1.5 py-0.5 rounded font-medium',
                            getModelBadgeColor(subtask.metrics.model)
                          )}>
                            {subtask.metrics.model}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Subtask Metrics */}
                    {subtask.metrics && (
                      <div className="grid grid-cols-3 gap-2 pt-2 border-t border-border/50">
                        <div className="text-xs">
                          <span className="text-muted-foreground">Turns:</span>
                          <span className="ml-1 font-mono font-medium">
                            {subtask.turnsUsed}/{subtask.maxTurns}
                          </span>
                        </div>
                        <div className="text-xs">
                          <span className="text-muted-foreground">Tokens:</span>
                          <span className="ml-1 font-mono font-medium">
                            {formatTokens(subtask.metrics.tokensInput + subtask.metrics.tokensOutput)}
                          </span>
                        </div>
                        {subtask.duration && (
                          <div className="text-xs">
                            <span className="text-muted-foreground">Time:</span>
                            <span className="ml-1 font-mono font-medium">
                              {formatDuration(subtask.duration)}
                            </span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Warning if approaching subtask limit */}
                    {subtask.metrics && subtask.metrics.costUsd > sessionLimits.maxCostPerSubtask * 0.9 && (() => {
                      const percentOfLimit = sessionLimits.maxCostPerSubtask > 0
                        ? Math.round((subtask.metrics.costUsd / sessionLimits.maxCostPerSubtask) * 100)
                        : 100
                      return (
                        <div className="pt-2 border-t border-border/50">
                          <div className="text-xs text-yellow-600 dark:text-yellow-400 flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3" />
                            High cost subtask ({percentOfLimit}% of limit)
                          </div>
                        </div>
                      )
                    })()}

                    {/* Commit SHA if available */}
                    {subtask.commitSha && (
                      <div className="text-xs text-muted-foreground flex items-center gap-1">
                        <FileText className="h-3 w-3" />
                        Commit: <code className="font-mono">{subtask.commitSha}</code>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Cost Optimization Tip */}
          {aggregated.sonnetCount > aggregated.haikuCount && completedSubtasks.length >= 3 && (
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
              <div className="flex items-start gap-2">
                <Zap className="h-4 w-4 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
                <div className="text-xs text-blue-800 dark:text-blue-200">
                  <p className="font-medium mb-1">Cost Optimization Tip</p>
                  <p>
                    Most subtasks used Sonnet. Consider breaking sections into smaller
                    atomic units (≤4 files) to leverage Haiku's lower cost.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

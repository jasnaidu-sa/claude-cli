/**
 * ProgressPanel Component
 *
 * Displays overall workflow progress with a progress bar,
 * current test indicator, category breakdown, and Kanban board.
 */

import React, { useEffect, useState } from 'react'
import {
  CheckCircle,
  XCircle,
  Clock,
  Activity,
  RefreshCw,
  BarChart3,
  LayoutGrid
} from 'lucide-react'
import { Button } from '../ui/button'
import { CategoryProgress } from './CategoryProgress'
import { KanbanBoard, type Feature } from './KanbanBoard'
import { useAutonomousStore } from '@renderer/stores/autonomous-store'
import { cn } from '@renderer/lib/utils'
import type { WorkflowConfig } from '@shared/types'

interface ProgressPanelProps {
  workflow: WorkflowConfig
}

export function ProgressPanel({ workflow }: ProgressPanelProps) {
  const {
    progressByWorkflow,
    watchProgress,
    unwatchProgress,
    isLoading
  } = useAutonomousStore()

  const [features, setFeatures] = useState<Feature[]>([])
  const [viewMode, setViewMode] = useState<'stats' | 'kanban'>('stats')

  const progress = progressByWorkflow[workflow.id]

  // Start watching progress when component mounts
  useEffect(() => {
    const projectPath = workflow.worktreePath || workflow.projectPath
    watchProgress(workflow.id, projectPath)

    return () => {
      unwatchProgress(workflow.id)
    }
  }, [workflow.id, workflow.projectPath, workflow.worktreePath, watchProgress, unwatchProgress])

  // Load feature_list.json with polling
  useEffect(() => {
    const loadFeatures = async () => {
      const projectPath = workflow.worktreePath || workflow.projectPath
      const featureListPath = `${projectPath}/.autonomous/feature_list.json`

      try {
        const result = await window.electron.files.readFile(featureListPath)
        if (result.success && result.content) {
          const parsed = JSON.parse(result.content)
          if (parsed.features && Array.isArray(parsed.features)) {
            setFeatures(parsed.features)
          }
        }
      } catch (err) {
        // No feature_list.json yet
        setFeatures([])
      }
    }

    // Initial load
    loadFeatures()

    // Poll every 2 seconds to check for feature updates
    const pollInterval = setInterval(loadFeatures, 2000)

    return () => {
      clearInterval(pollInterval)
    }
  }, [workflow.projectPath, workflow.worktreePath])

  // Calculate stats
  const total = progress?.total || workflow.progress?.testsTotal || 0
  const passing = progress?.passing || workflow.progress?.testsPassing || 0
  const failing = progress?.failing || 0
  const pending = progress?.pending || (total - passing - failing)
  const percentage = total > 0 ? Math.round((passing / total) * 100) : 0
  const currentTest = progress?.currentTest || workflow.progress?.currentTest
  const categories = progress?.categories || []

  const handleRefresh = () => {
    const projectPath = workflow.worktreePath || workflow.projectPath
    watchProgress(workflow.id, projectPath)
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          {viewMode === 'stats' ? (
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          ) : (
            <LayoutGrid className="h-4 w-4 text-muted-foreground" />
          )}
          <h2 className="font-semibold text-sm">
            {viewMode === 'stats' ? 'Progress' : 'Kanban Board'}
          </h2>
          {isLoading && (
            <RefreshCw className="h-3 w-3 animate-spin text-muted-foreground" />
          )}
          {features.length > 0 && (
            <span className="text-xs text-muted-foreground">
              ({features.length} features)
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {/* View Mode Toggle */}
          {features.length > 0 && (
            <>
              <Button
                variant={viewMode === 'stats' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setViewMode('stats')}
                className="h-7 px-2"
              >
                <BarChart3 className="h-3 w-3 mr-1" />
                Stats
              </Button>
              <Button
                variant={viewMode === 'kanban' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setViewMode('kanban')}
                className="h-7 px-2"
              >
                <LayoutGrid className="h-3 w-3 mr-1" />
                Kanban
              </Button>
              <div className="w-px h-4 bg-border mx-1" />
            </>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={handleRefresh}
            disabled={isLoading}
            className="h-7 w-7"
          >
            <RefreshCw className={cn('h-3 w-3', isLoading && 'animate-spin')} />
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {viewMode === 'kanban' && features.length > 0 ? (
          <div className="h-full p-4">
            <KanbanBoard features={features} className="h-full" />
          </div>
        ) : (
          <div className="h-full overflow-auto p-4 space-y-6">
            {/* Overall Progress */}
            <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Overall Progress</span>
            <span className="text-2xl font-bold">
              {percentage}%
            </span>
          </div>

          {/* Progress Bar */}
          <div className="h-3 bg-secondary rounded-full overflow-hidden">
            <div
              className={cn(
                'h-full transition-all duration-500 ease-out',
                percentage === 100 ? 'bg-emerald-500' : 'bg-primary'
              )}
              style={{ width: `${percentage}%` }}
            />
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-3">
            <div className="flex items-center gap-2 p-2 bg-emerald-500/10 rounded-md">
              <CheckCircle className="h-4 w-4 text-emerald-500" />
              <div>
                <div className="text-lg font-semibold text-emerald-500">{passing}</div>
                <div className="text-xs text-muted-foreground">Passing</div>
              </div>
            </div>

            <div className="flex items-center gap-2 p-2 bg-red-500/10 rounded-md">
              <XCircle className="h-4 w-4 text-red-500" />
              <div>
                <div className="text-lg font-semibold text-red-500">{failing}</div>
                <div className="text-xs text-muted-foreground">Failing</div>
              </div>
            </div>

            <div className="flex items-center gap-2 p-2 bg-secondary/50 rounded-md">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <div>
                <div className="text-lg font-semibold">{pending}</div>
                <div className="text-xs text-muted-foreground">Pending</div>
              </div>
            </div>
          </div>
        </div>

        {/* Current Test */}
        {currentTest && (
          <div className="p-3 bg-primary/10 border border-primary/20 rounded-lg">
            <div className="flex items-center gap-2 mb-1">
              <Activity className="h-4 w-4 text-primary animate-pulse" />
              <span className="text-xs font-medium text-primary">Currently Running</span>
            </div>
            <p className="text-sm font-mono truncate">{currentTest}</p>
          </div>
        )}

        {/* Category Breakdown */}
        {categories.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-medium">By Category</h3>
            <CategoryProgress categories={categories} />
          </div>
        )}

        {/* Empty State */}
        {total === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <BarChart3 className="h-12 w-12 text-muted-foreground/30 mb-3" />
            <h3 className="font-medium text-muted-foreground mb-1">No Progress Data</h3>
            <p className="text-sm text-muted-foreground/70">
              Start the workflow to see progress updates.
            </p>
          </div>
        )}

        {/* Session Info */}
        {workflow.startedAt && (
          <div className="pt-4 border-t border-border">
            <h3 className="text-sm font-medium mb-2">Session Info</h3>
            <div className="space-y-1 text-xs text-muted-foreground">
              <div className="flex justify-between">
                <span>Started:</span>
                <span>{new Date(workflow.startedAt).toLocaleString()}</span>
              </div>
              {workflow.completedAt && (
                <div className="flex justify-between">
                  <span>Completed:</span>
                  <span>{new Date(workflow.completedAt).toLocaleString()}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span>Model:</span>
                <span className="font-mono">{workflow.model}</span>
              </div>
            </div>
          </div>
        )}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * RalphKanbanBoard Component
 *
 * Displays features in a Kanban-style board with columns for each status:
 * - Pending: Features not yet started
 * - In Progress: Features currently being worked on
 * - Passed: Successfully completed features
 * - Failed: Features that failed
 * - Skipped: Features that were skipped
 */

import React from 'react'
import {
  CheckCircle,
  XCircle,
  Circle,
  Loader2,
  SkipForward,
  Folder,
  AlertCircle,
  Clock
} from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import type { RalphFeature } from '../../../preload/index'

interface RalphKanbanBoardProps {
  features: RalphFeature[]
  currentFeatureId: string | null
}

type FeatureStatus = 'pending' | 'in_progress' | 'passed' | 'failed' | 'skipped'

interface KanbanColumn {
  id: FeatureStatus
  title: string
  icon: React.ReactNode
  bgColor: string
  borderColor: string
  headerBg: string
  emptyText: string
}

const KANBAN_COLUMNS: KanbanColumn[] = [
  {
    id: 'pending',
    title: 'Pending',
    icon: <Circle className="w-4 h-4" />,
    bgColor: 'bg-gray-800/50',
    borderColor: 'border-gray-600',
    headerBg: 'bg-gray-700',
    emptyText: 'No pending features'
  },
  {
    id: 'in_progress',
    title: 'In Progress',
    icon: <Loader2 className="w-4 h-4 animate-spin" />,
    bgColor: 'bg-blue-900/20',
    borderColor: 'border-blue-600',
    headerBg: 'bg-blue-800',
    emptyText: 'No features in progress'
  },
  {
    id: 'passed',
    title: 'Passed',
    icon: <CheckCircle className="w-4 h-4" />,
    bgColor: 'bg-green-900/20',
    borderColor: 'border-green-600',
    headerBg: 'bg-green-800',
    emptyText: 'No passed features yet'
  },
  {
    id: 'failed',
    title: 'Failed',
    icon: <XCircle className="w-4 h-4" />,
    bgColor: 'bg-red-900/20',
    borderColor: 'border-red-600',
    headerBg: 'bg-red-800',
    emptyText: 'No failed features'
  },
  {
    id: 'skipped',
    title: 'Skipped',
    icon: <SkipForward className="w-4 h-4" />,
    bgColor: 'bg-yellow-900/20',
    borderColor: 'border-yellow-600',
    headerBg: 'bg-yellow-800',
    emptyText: 'No skipped features'
  }
]

/** Get status icon for a feature */
function getStatusIcon(status: FeatureStatus, isCurrent: boolean) {
  if (isCurrent && status === 'in_progress') {
    return <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
  }

  switch (status) {
    case 'passed':
      return <CheckCircle className="w-4 h-4 text-green-400" />
    case 'failed':
      return <XCircle className="w-4 h-4 text-red-400" />
    case 'in_progress':
      return <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
    case 'skipped':
      return <SkipForward className="w-4 h-4 text-yellow-400" />
    case 'pending':
    default:
      return <Circle className="w-4 h-4 text-gray-500" />
  }
}

/** Feature card component */
function FeatureCard({
  feature,
  isCurrent,
  column
}: {
  feature: RalphFeature
  isCurrent: boolean
  column: KanbanColumn
}) {
  return (
    <div
      className={cn(
        'rounded-lg p-3 border transition-all',
        'hover:shadow-lg hover:scale-[1.02]',
        isCurrent ? 'ring-2 ring-blue-500 bg-blue-900/30' : 'bg-gray-800/80',
        column.borderColor.replace('border-', 'border-l-4 border-l-')
      )}
    >
      {/* Header: Icon + Name */}
      <div className="flex items-start gap-2">
        <div className="mt-0.5 flex-shrink-0">
          {getStatusIcon(feature.status as FeatureStatus, isCurrent)}
        </div>
        <div className="flex-1 min-w-0">
          <p
            className={cn(
              'text-sm font-medium truncate',
              isCurrent ? 'text-blue-300' : 'text-white'
            )}
            title={feature.name}
          >
            {feature.name}
          </p>
          {feature.description && (
            <p className="text-xs text-gray-400 truncate mt-0.5" title={feature.description}>
              {feature.description}
            </p>
          )}
        </div>
      </div>

      {/* Meta row: Category + Attempts */}
      <div className="flex items-center gap-2 mt-2 text-xs">
        {feature.category && (
          <div className="flex items-center gap-1 text-gray-500">
            <Folder className="w-3 h-3" />
            <span className="truncate max-w-[100px]">{feature.category}</span>
          </div>
        )}
        {feature.attempts > 1 && (
          <div className="flex items-center gap-1 text-yellow-500 bg-yellow-900/30 px-1.5 py-0.5 rounded">
            <Clock className="w-3 h-3" />
            <span>{feature.attempts} attempts</span>
          </div>
        )}
        {isCurrent && (
          <span className="ml-auto text-blue-400 bg-blue-900/50 px-1.5 py-0.5 rounded font-medium">
            Current
          </span>
        )}
      </div>
    </div>
  )
}

export function RalphKanbanBoard({
  features,
  currentFeatureId
}: RalphKanbanBoardProps): React.ReactElement {
  // Group features by status
  const featuresByStatus = React.useMemo(() => {
    const grouped: Record<FeatureStatus, RalphFeature[]> = {
      pending: [],
      in_progress: [],
      passed: [],
      failed: [],
      skipped: []
    }

    for (const feature of features) {
      const status = feature.status as FeatureStatus
      if (grouped[status]) {
        grouped[status].push(feature)
      } else {
        grouped.pending.push(feature)
      }
    }

    return grouped
  }, [features])

  // Empty state
  if (features.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-gray-400">
        <AlertCircle className="w-12 h-12 mb-4 opacity-50" />
        <p>No features yet</p>
        <p className="text-sm mt-1">Features will appear here once execution begins</p>
      </div>
    )
  }

  return (
    <div className="h-full flex gap-3 p-4 overflow-x-auto">
      {KANBAN_COLUMNS.map((column) => {
        const columnFeatures = featuresByStatus[column.id]
        const count = columnFeatures.length

        return (
          <div
            key={column.id}
            className={cn(
              'flex-1 min-w-[220px] max-w-[300px] flex flex-col rounded-lg border',
              column.bgColor,
              column.borderColor
            )}
          >
            {/* Column header */}
            <div
              className={cn(
                'flex items-center gap-2 px-3 py-2 rounded-t-lg',
                column.headerBg
              )}
            >
              {column.icon}
              <span className="font-medium text-sm text-white">{column.title}</span>
              <span className="ml-auto text-xs bg-black/30 px-2 py-0.5 rounded-full text-white">
                {count}
              </span>
            </div>

            {/* Column content */}
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              {columnFeatures.length > 0 ? (
                columnFeatures.map((feature) => (
                  <FeatureCard
                    key={feature.id}
                    feature={feature}
                    isCurrent={feature.id === currentFeatureId}
                    column={column}
                  />
                ))
              ) : (
                <div className="text-center text-xs text-gray-500 py-4">
                  {column.emptyText}
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default RalphKanbanBoard

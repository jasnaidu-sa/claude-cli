/**
 * RalphProgressPanel Component
 *
 * Displays feature progress with status indicators.
 * Groups features by category and shows:
 * - Feature status (pending, in_progress, passed, failed, skipped)
 * - Attempt count
 * - Category progress bars
 */

import React, { useState, useMemo } from 'react'
import {
  CheckCircle,
  XCircle,
  Circle,
  Loader2,
  SkipForward,
  ChevronDown,
  ChevronRight,
  Folder
} from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import type { RalphFeature } from '../../../preload/index'

interface RalphProgressPanelProps {
  features: RalphFeature[]
  currentFeatureId: string | null
}

/** Get status icon component */
function getStatusIcon(status: RalphFeature['status'], isCurrent: boolean) {
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

/** Get status color class */
function getStatusColor(status: RalphFeature['status']): string {
  switch (status) {
    case 'passed':
      return 'border-green-600 bg-green-900/20'
    case 'failed':
      return 'border-red-600 bg-red-900/20'
    case 'in_progress':
      return 'border-blue-600 bg-blue-900/20'
    case 'skipped':
      return 'border-yellow-600 bg-yellow-900/20'
    case 'pending':
    default:
      return 'border-gray-700 bg-gray-800/50'
  }
}

interface CategoryGroup {
  name: string
  features: RalphFeature[]
  stats: {
    total: number
    passed: number
    failed: number
    inProgress: number
    pending: number
    skipped: number
  }
}

export function RalphProgressPanel({
  features,
  currentFeatureId
}: RalphProgressPanelProps): React.ReactElement {
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set())

  // Group features by category
  const categoryGroups = useMemo(() => {
    const groups: Map<string, CategoryGroup> = new Map()

    for (const feature of features) {
      const category = feature.category || 'Uncategorized'

      if (!groups.has(category)) {
        groups.set(category, {
          name: category,
          features: [],
          stats: { total: 0, passed: 0, failed: 0, inProgress: 0, pending: 0, skipped: 0 }
        })
      }

      const group = groups.get(category)!
      group.features.push(feature)
      group.stats.total++

      switch (feature.status) {
        case 'passed':
          group.stats.passed++
          break
        case 'failed':
          group.stats.failed++
          break
        case 'in_progress':
          group.stats.inProgress++
          break
        case 'skipped':
          group.stats.skipped++
          break
        case 'pending':
        default:
          group.stats.pending++
      }
    }

    return Array.from(groups.values())
  }, [features])

  // Toggle category expansion
  const toggleCategory = (category: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev)
      if (next.has(category)) {
        next.delete(category)
      } else {
        next.add(category)
      }
      return next
    })
  }

  // Expand all categories by default when features change
  React.useEffect(() => {
    if (features.length > 0 && expandedCategories.size === 0) {
      setExpandedCategories(new Set(categoryGroups.map(g => g.name)))
    }
  }, [features.length, categoryGroups])

  if (features.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-gray-400">
        <Circle className="w-12 h-12 mb-4 opacity-50" />
        <p>No features yet</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {categoryGroups.map((group) => {
        const isExpanded = expandedCategories.has(group.name)
        const progressPercent = group.stats.total > 0
          ? Math.round(((group.stats.passed + group.stats.failed + group.stats.skipped) / group.stats.total) * 100)
          : 0

        return (
          <div key={group.name} className="bg-gray-800 rounded-lg overflow-hidden">
            {/* Category header */}
            <button
              onClick={() => toggleCategory(group.name)}
              className="w-full flex items-center gap-3 p-3 hover:bg-gray-750 transition-colors"
            >
              {isExpanded ? (
                <ChevronDown className="w-4 h-4 text-gray-400" />
              ) : (
                <ChevronRight className="w-4 h-4 text-gray-400" />
              )}
              <Folder className="w-4 h-4 text-blue-400" />
              <span className="flex-1 text-left font-medium text-white">{group.name}</span>

              {/* Mini stats */}
              <div className="flex items-center gap-2 text-xs">
                {group.stats.passed > 0 && (
                  <span className="text-green-400">{group.stats.passed}✓</span>
                )}
                {group.stats.failed > 0 && (
                  <span className="text-red-400">{group.stats.failed}✗</span>
                )}
                {group.stats.inProgress > 0 && (
                  <span className="text-blue-400">{group.stats.inProgress}⟳</span>
                )}
                <span className="text-gray-500">
                  {group.stats.passed + group.stats.failed + group.stats.skipped}/{group.stats.total}
                </span>
              </div>

              {/* Progress bar */}
              <div className="w-24 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                <div className="h-full flex">
                  <div
                    className="bg-green-500 transition-all"
                    style={{ width: `${(group.stats.passed / group.stats.total) * 100}%` }}
                  />
                  <div
                    className="bg-red-500 transition-all"
                    style={{ width: `${(group.stats.failed / group.stats.total) * 100}%` }}
                  />
                  <div
                    className="bg-yellow-500 transition-all"
                    style={{ width: `${(group.stats.skipped / group.stats.total) * 100}%` }}
                  />
                </div>
              </div>
            </button>

            {/* Feature list */}
            {isExpanded && (
              <div className="border-t border-gray-700">
                {group.features.map((feature) => {
                  const isCurrent = feature.id === currentFeatureId

                  return (
                    <div
                      key={feature.id}
                      className={cn(
                        'flex items-center gap-3 px-4 py-2 border-l-2 transition-colors',
                        getStatusColor(feature.status),
                        isCurrent && 'bg-blue-900/30'
                      )}
                    >
                      {getStatusIcon(feature.status, isCurrent)}

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              'text-sm truncate',
                              isCurrent ? 'text-white font-medium' : 'text-gray-300'
                            )}
                          >
                            {feature.name}
                          </span>
                          {feature.attempts > 1 && (
                            <span className="text-xs text-yellow-500 bg-yellow-900/30 px-1.5 py-0.5 rounded">
                              {feature.attempts} attempts
                            </span>
                          )}
                        </div>
                        {feature.description && (
                          <p className="text-xs text-gray-500 truncate">{feature.description}</p>
                        )}
                      </div>

                      {isCurrent && (
                        <span className="text-xs text-blue-400 font-medium">Current</span>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default RalphProgressPanel

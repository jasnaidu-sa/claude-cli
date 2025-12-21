/**
 * KanbanBoard Component
 *
 * Visual Kanban board for feature tracking.
 * Shows features organized in columns: To-Do, In Progress, Done.
 * Inspired by Leon's autonomous-coding-with-ui.
 */

import React, { useMemo, useState } from 'react'
import { CheckCircle2, Circle, Clock, XCircle, X, FileText, TestTube } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { Button } from '../ui/button'

export interface Feature {
  id: string
  name: string
  category: string
  description: string
  status: 'pending' | 'in_progress' | 'passed' | 'failed'
  priority?: number
  testCases?: Array<{
    name: string
    type: string
  }>
  dependencies?: string[]
}

interface KanbanBoardProps {
  features: Feature[]
  className?: string
}

function getStatusBadge(status: Feature['status']) {
  switch (status) {
    case 'pending':
      return (
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Circle className="h-3 w-3" />
          <span>Pending</span>
        </div>
      )
    case 'in_progress':
      return (
        <div className="flex items-center gap-1 text-xs text-blue-400">
          <Clock className="h-3 w-3 animate-pulse" />
          <span>In Progress</span>
        </div>
      )
    case 'passed':
      return (
        <div className="flex items-center gap-1 text-xs text-green-400">
          <CheckCircle2 className="h-3 w-3" />
          <span>Passed</span>
        </div>
      )
    case 'failed':
      return (
        <div className="flex items-center gap-1 text-xs text-red-400">
          <XCircle className="h-3 w-3" />
          <span>Failed</span>
        </div>
      )
  }
}

function getCategoryColor(category: string): string {
  // Generate consistent color based on category name
  const colors = [
    'bg-blue-500/10 border-blue-500/20 text-blue-400',
    'bg-purple-500/10 border-purple-500/20 text-purple-400',
    'bg-green-500/10 border-green-500/20 text-green-400',
    'bg-orange-500/10 border-orange-500/20 text-orange-400',
    'bg-pink-500/10 border-pink-500/20 text-pink-400',
    'bg-cyan-500/10 border-cyan-500/20 text-cyan-400'
  ]

  const hash = category.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
  return colors[hash % colors.length]
}

function FeatureCard({ feature, onClick }: { feature: Feature; onClick?: () => void }) {
  const categoryColor = getCategoryColor(feature.category)

  return (
    <div
      onClick={onClick}
      className={cn(
        'p-3 rounded-lg border bg-card transition-all hover:shadow-md cursor-pointer',
        feature.status === 'passed' && 'border-green-500/20 bg-green-500/5',
        feature.status === 'failed' && 'border-red-500/20 bg-red-500/5',
        feature.status === 'in_progress' && 'border-blue-500/20 bg-blue-500/5'
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm truncate" title={feature.name}>
            {feature.name}
          </div>
          <div className={cn('text-xs px-2 py-0.5 rounded-full border inline-block mt-1', categoryColor)}>
            {feature.category}
          </div>
        </div>
        {getStatusBadge(feature.status)}
      </div>

      {/* Description */}
      {feature.description && (
        <div className="text-xs text-muted-foreground line-clamp-2 mb-2">
          {feature.description}
        </div>
      )}

      {/* Test cases count */}
      {feature.testCases && feature.testCases.length > 0 && (
        <div className="text-xs text-muted-foreground flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3" />
          {feature.testCases.length} test{feature.testCases.length !== 1 ? 's' : ''}
        </div>
      )}

      {/* Dependencies indicator */}
      {feature.dependencies && feature.dependencies.length > 0 && (
        <div className="text-xs text-amber-500 mt-1">
          Depends on {feature.dependencies.length} feature{feature.dependencies.length !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  )
}

function KanbanColumn({ title, features, count, icon, onFeatureClick }: { title: string; features: Feature[]; count: number; icon: React.ReactNode; onFeatureClick?: (feature: Feature) => void }) {
  return (
    <div className="flex flex-col h-full">
      {/* Column Header */}
      <div className="px-3 py-2 border-b border-border bg-muted/30 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          {icon}
          <span className="font-semibold text-sm">{title}</span>
        </div>
        <span className="text-xs text-muted-foreground bg-background px-2 py-0.5 rounded-full">
          {count}
        </span>
      </div>

      {/* Column Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {features.length === 0 ? (
          <div className="text-xs text-muted-foreground text-center py-8">
            No features
          </div>
        ) : (
          features.map((feature) => (
            <FeatureCard
              key={feature.id}
              feature={feature}
              onClick={() => onFeatureClick?.(feature)}
            />
          ))
        )}
      </div>
    </div>
  )
}

function FeatureDetailModal({ feature, onClose }: { feature: Feature; onClose: () => void }) {
  const categoryColor = getCategoryColor(feature.category)

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-card border border-border rounded-lg shadow-lg max-w-2xl w-full mx-4 max-h-[80vh] overflow-auto" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="p-4 border-b border-border flex items-start justify-between sticky top-0 bg-card z-10">
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold mb-2">{feature.name}</h2>
            <div className="flex items-center gap-2">
              <div className={cn('text-xs px-2 py-1 rounded-full border inline-block', categoryColor)}>
                {feature.category}
              </div>
              {getStatusBadge(feature.status)}
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="shrink-0">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Description */}
          {feature.description && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <h3 className="font-medium text-sm">Description</h3>
              </div>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{feature.description}</p>
            </div>
          )}

          {/* Test Cases */}
          {feature.testCases && feature.testCases.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <TestTube className="h-4 w-4 text-muted-foreground" />
                <h3 className="font-medium text-sm">Test Cases ({feature.testCases.length})</h3>
              </div>
              <div className="space-y-2">
                {feature.testCases.map((testCase, idx) => (
                  <div key={idx} className="text-sm bg-secondary/30 p-2 rounded border border-border">
                    <div className="font-mono text-xs text-muted-foreground mb-1">{testCase.type}</div>
                    <div>{testCase.name}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Dependencies */}
          {feature.dependencies && feature.dependencies.length > 0 && (
            <div>
              <h3 className="font-medium text-sm mb-2">Dependencies</h3>
              <div className="space-y-1">
                {feature.dependencies.map((dep, idx) => (
                  <div key={idx} className="text-sm text-amber-500 font-mono bg-amber-500/10 p-2 rounded border border-amber-500/20">
                    {dep}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Priority */}
          {feature.priority !== undefined && (
            <div>
              <h3 className="font-medium text-sm mb-2">Priority</h3>
              <div className="text-sm">
                <span className="font-mono bg-secondary/30 px-2 py-1 rounded">{feature.priority}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function KanbanBoard({ features, className }: KanbanBoardProps) {
  const [selectedFeature, setSelectedFeature] = useState<Feature | null>(null)

  // Organize features by status
  const columns = useMemo(() => {
    const todo = features.filter((f) => f.status === 'pending')
    const inProgress = features.filter((f) => f.status === 'in_progress')
    const done = features.filter((f) => f.status === 'passed' || f.status === 'failed')

    return { todo, inProgress, done }
  }, [features])

  return (
    <>
      <div className={cn('grid grid-cols-3 gap-4 h-full', className)}>
        {/* To-Do Column */}
        <div className="border border-border rounded-lg overflow-hidden bg-card">
          <KanbanColumn
            title="To-Do"
            features={columns.todo}
            count={columns.todo.length}
            icon={<Circle className="h-4 w-4 text-muted-foreground" />}
            onFeatureClick={setSelectedFeature}
          />
        </div>

        {/* In Progress Column */}
        <div className="border border-border rounded-lg overflow-hidden bg-card">
          <KanbanColumn
            title="In Progress"
            features={columns.inProgress}
            count={columns.inProgress.length}
            icon={<Clock className="h-4 w-4 text-blue-400 animate-pulse" />}
            onFeatureClick={setSelectedFeature}
          />
        </div>

        {/* Done Column */}
        <div className="border border-border rounded-lg overflow-hidden bg-card">
          <KanbanColumn
            title="Done"
            features={columns.done}
            count={columns.done.length}
            icon={<CheckCircle2 className="h-4 w-4 text-green-400" />}
            onFeatureClick={setSelectedFeature}
          />
        </div>
      </div>

      {/* Feature Detail Modal */}
      {selectedFeature && (
        <FeatureDetailModal
          feature={selectedFeature}
          onClose={() => setSelectedFeature(null)}
        />
      )}
    </>
  )
}

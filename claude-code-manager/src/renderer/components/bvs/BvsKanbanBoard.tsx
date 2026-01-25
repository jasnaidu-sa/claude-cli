/**
 * BVS Kanban Board Component
 *
 * Visual Kanban board for BVS section tracking.
 * 4 columns: PENDING, IN PROGRESS, VERIFYING, DONE
 * Shows worker color coding and real-time progress.
 *
 * Based on PRD Phase 6 UI Components (F6.1-F6.5)
 */

import React, { useMemo, useState } from 'react'
import {
  CheckCircle2,
  Circle,
  Clock,
  XCircle,
  X,
  FileText,
  Eye,
  RotateCcw,
  FolderOpen,
  AlertTriangle,
} from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { Button } from '../ui/button'
import type {
  BvsSection,
  BvsSectionStatus,
  BvsWorkerId,
} from '@shared/bvs-types'
import { BVS_WORKER_COLORS } from '@shared/bvs-types'

// ============================================================================
// Props & Types
// ============================================================================

interface BvsKanbanBoardProps {
  sections: BvsSection[]
  onSectionClick?: (section: BvsSection) => void
  onRetrySection?: (sectionId: string) => void
  className?: string
}

// ============================================================================
// Helper Functions
// ============================================================================

function getWorkerColor(workerId?: BvsWorkerId): { name: string; hex: string } | null {
  if (!workerId) return null
  return BVS_WORKER_COLORS[workerId] || null
}

function getStatusIcon(status: BvsSectionStatus) {
  switch (status) {
    case 'pending':
      return <Circle className="h-4 w-4 text-muted-foreground" />
    case 'in_progress':
      return <Clock className="h-4 w-4 text-blue-400 animate-pulse" />
    case 'verifying':
      return <Eye className="h-4 w-4 text-cyan-400 animate-pulse" />
    case 'done':
      return <CheckCircle2 className="h-4 w-4 text-green-400" />
    case 'failed':
      return <XCircle className="h-4 w-4 text-red-400" />
    case 'retrying':
      return <RotateCcw className="h-4 w-4 text-amber-400 animate-spin" />
    default:
      return <Circle className="h-4 w-4" />
  }
}

function formatElapsedTime(seconds?: number): string {
  if (!seconds) return '0:00'
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

// ============================================================================
// Section Card Component
// ============================================================================

interface SectionCardProps {
  section: BvsSection
  onClick?: () => void
  onRetry?: () => void
}

function SectionCard({ section, onClick, onRetry }: SectionCardProps) {
  const workerColor = getWorkerColor(section.workerId)
  const isActive = section.status === 'in_progress' || section.status === 'verifying'
  const isFailed = section.status === 'failed'
  const isDone = section.status === 'done'

  return (
    <div
      onClick={onClick}
      className={cn(
        'p-3 rounded-lg border transition-all hover:shadow-md cursor-pointer relative overflow-hidden',
        // Worker color left border when active
        workerColor && isActive && 'border-l-4',
        // Status-based background
        section.status === 'pending' && 'bg-card',
        section.status === 'in_progress' && 'bg-blue-500/5 border-blue-500/20',
        section.status === 'verifying' && 'bg-cyan-500/5 border-cyan-500/20',
        section.status === 'done' && 'bg-green-500/5 border-green-500/20',
        section.status === 'failed' && 'bg-red-500/5 border-red-500/20',
        section.status === 'retrying' && 'bg-amber-500/5 border-amber-500/20'
      )}
      style={
        workerColor && isActive
          ? { borderLeftColor: workerColor.hex }
          : undefined
      }
    >
      {/* Header: Name + Worker Color Indicator */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {workerColor && isActive && (
            <div
              className="w-3 h-3 rounded-full shrink-0"
              style={{ backgroundColor: workerColor.hex }}
              title={`Worker ${section.workerId}`}
            />
          )}
          <span className="font-semibold text-sm truncate" title={section.name}>
            {section.name}
          </span>
        </div>
        {isFailed && onRetry && (
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              onRetry()
            }}
            className="shrink-0 h-6 px-2 text-xs"
          >
            Retry
          </Button>
        )}
      </div>

      {/* File count + Elapsed time */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground mb-2">
        <div className="flex items-center gap-1">
          <FolderOpen className="h-3 w-3" />
          <span>{section.files.length} files</span>
        </div>
        {section.elapsedSeconds !== undefined && section.elapsedSeconds > 0 && (
          <div className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            <span>{formatElapsedTime(section.elapsedSeconds)}</span>
          </div>
        )}
      </div>

      {/* Progress bar */}
      <div className="w-full h-1.5 bg-secondary/50 rounded-full overflow-hidden mb-2">
        <div
          className={cn(
            'h-full transition-all duration-300',
            section.status === 'pending' && 'bg-muted-foreground/30',
            section.status === 'in_progress' && 'bg-blue-500',
            section.status === 'verifying' && 'bg-cyan-500 animate-pulse',
            section.status === 'done' && 'bg-green-500',
            section.status === 'failed' && 'bg-red-500',
            section.status === 'retrying' && 'bg-amber-500'
          )}
          style={{ width: `${section.progress}%` }}
        />
      </div>

      {/* Current step or status message */}
      <div className="text-xs text-muted-foreground truncate">
        {section.status === 'pending' && section.dependencies.length > 0 && (
          <span className="text-amber-500">
            Waiting for: {section.dependencies.slice(0, 2).join(', ')}
            {section.dependencies.length > 2 && ` +${section.dependencies.length - 2} more`}
          </span>
        )}
        {section.status === 'in_progress' && section.currentStep && (
          <span className="flex items-center gap-1">
            <span className="text-blue-400">🔧</span>
            {section.currentStep}
          </span>
        )}
        {section.status === 'verifying' && (
          <span className="flex items-center gap-1">
            <span>🔍</span>
            Running verification...
          </span>
        )}
        {section.status === 'done' && (
          <span className="text-green-400">✓ All checks passed</span>
        )}
        {section.status === 'failed' && section.lastError && (
          <span className="text-red-400 flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" />
            {section.lastError}
          </span>
        )}
        {section.status === 'retrying' && (
          <span className="text-amber-400">
            Retry attempt {section.retryCount}/{section.maxRetries}
          </span>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// Kanban Column Component
// ============================================================================

interface KanbanColumnProps {
  title: string
  status: BvsSectionStatus | BvsSectionStatus[]
  sections: BvsSection[]
  icon: React.ReactNode
  headerClassName?: string
  onSectionClick?: (section: BvsSection) => void
  onRetrySection?: (sectionId: string) => void
}

function KanbanColumn({
  title,
  sections,
  icon,
  headerClassName,
  onSectionClick,
  onRetrySection,
}: KanbanColumnProps) {
  return (
    <div className="flex flex-col h-full border border-border rounded-lg overflow-hidden bg-card">
      {/* Column Header */}
      <div
        className={cn(
          'px-3 py-2 border-b border-border bg-muted/30 flex items-center justify-between shrink-0',
          headerClassName
        )}
      >
        <div className="flex items-center gap-2">
          {icon}
          <span className="font-semibold text-sm">{title}</span>
        </div>
        <span className="text-xs text-muted-foreground bg-background px-2 py-0.5 rounded-full">
          {sections.length}
        </span>
      </div>

      {/* Column Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {sections.length === 0 ? (
          <div className="text-xs text-muted-foreground text-center py-8">
            No sections
          </div>
        ) : (
          sections.map((section) => (
            <SectionCard
              key={section.id}
              section={section}
              onClick={() => onSectionClick?.(section)}
              onRetry={
                section.status === 'failed'
                  ? () => onRetrySection?.(section.id)
                  : undefined
              }
            />
          ))
        )}
      </div>
    </div>
  )
}

// ============================================================================
// Section Detail Modal
// ============================================================================

interface SectionDetailModalProps {
  section: BvsSection
  onClose: () => void
  onRetry?: () => void
}

function SectionDetailModal({ section, onClose, onRetry }: SectionDetailModalProps) {
  const workerColor = getWorkerColor(section.workerId)

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-lg shadow-lg max-w-2xl w-full mx-4 max-h-[80vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-border flex items-start justify-between sticky top-0 bg-card z-10">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              {workerColor && (
                <div
                  className="w-4 h-4 rounded-full"
                  style={{ backgroundColor: workerColor.hex }}
                  title={`Worker ${section.workerId}`}
                />
              )}
              <h2 className="text-lg font-semibold">{section.name}</h2>
            </div>
            <div className="flex items-center gap-2">
              {getStatusIcon(section.status)}
              <span className="text-sm capitalize">{section.status.replace('_', ' ')}</span>
              {section.elapsedSeconds && (
                <span className="text-sm text-muted-foreground">
                  • {formatElapsedTime(section.elapsedSeconds)}
                </span>
              )}
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="shrink-0">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Description */}
          {section.description && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <h3 className="font-medium text-sm">Description</h3>
              </div>
              <p className="text-sm text-muted-foreground">{section.description}</p>
            </div>
          )}

          {/* Files */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <FolderOpen className="h-4 w-4 text-muted-foreground" />
              <h3 className="font-medium text-sm">Files ({section.files.length})</h3>
            </div>
            <div className="space-y-1">
              {section.files.map((file) => (
                <div
                  key={file.path}
                  className={cn(
                    'text-sm font-mono p-2 rounded border',
                    file.status === 'pending' && 'bg-muted/20 border-border',
                    file.status === 'active' && 'bg-blue-500/10 border-blue-500/20',
                    file.status === 'done' && 'bg-green-500/10 border-green-500/20'
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="truncate">{file.path}</span>
                    <span className="text-xs text-muted-foreground capitalize">
                      {file.action}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Success Criteria */}
          {section.successCriteria.length > 0 && (
            <div>
              <h3 className="font-medium text-sm mb-2">Success Criteria</h3>
              <div className="space-y-1">
                {section.successCriteria.map((criteria) => (
                  <div
                    key={criteria.id}
                    className={cn(
                      'text-sm p-2 rounded border flex items-center gap-2',
                      criteria.passed
                        ? 'bg-green-500/10 border-green-500/20'
                        : 'bg-muted/20 border-border'
                    )}
                  >
                    {criteria.passed ? (
                      <CheckCircle2 className="h-4 w-4 text-green-400 shrink-0" />
                    ) : (
                      <Circle className="h-4 w-4 text-muted-foreground shrink-0" />
                    )}
                    <span>{criteria.description}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Dependencies */}
          {section.dependencies.length > 0 && (
            <div>
              <h3 className="font-medium text-sm mb-2">Dependencies</h3>
              <div className="flex flex-wrap gap-2">
                {section.dependencies.map((dep) => (
                  <span
                    key={dep}
                    className="text-xs bg-amber-500/10 text-amber-500 border border-amber-500/20 px-2 py-1 rounded"
                  >
                    {dep}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Error (if failed) */}
          {section.status === 'failed' && section.lastError && (
            <div>
              <h3 className="font-medium text-sm mb-2 text-red-400">Error</h3>
              <div className="text-sm bg-red-500/10 border border-red-500/20 p-3 rounded font-mono">
                {section.lastError}
              </div>
              {onRetry && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onRetry}
                  className="mt-3"
                >
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Retry Section
                </Button>
              )}
            </div>
          )}

          {/* Commits */}
          {section.commits.length > 0 && (
            <div>
              <h3 className="font-medium text-sm mb-2">Commits</h3>
              <div className="space-y-1">
                {section.commits.map((commit, idx) => (
                  <div
                    key={idx}
                    className="text-xs font-mono bg-muted/30 p-2 rounded border border-border"
                  >
                    {commit}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Main Component
// ============================================================================

export function BvsKanbanBoard({
  sections,
  onSectionClick,
  onRetrySection,
  className,
}: BvsKanbanBoardProps) {
  const [selectedSection, setSelectedSection] = useState<BvsSection | null>(null)

  // Organize sections by status into 4 columns
  const columns = useMemo(() => {
    const pending = sections.filter((s) => s.status === 'pending')
    const inProgress = sections.filter(
      (s) => s.status === 'in_progress' || s.status === 'retrying'
    )
    const verifying = sections.filter((s) => s.status === 'verifying')
    const done = sections.filter((s) => s.status === 'done' || s.status === 'failed')

    return { pending, inProgress, verifying, done }
  }, [sections])

  const handleSectionClick = (section: BvsSection) => {
    setSelectedSection(section)
    onSectionClick?.(section)
  }

  return (
    <>
      <div className={cn('grid grid-cols-4 gap-4 h-full', className)}>
        {/* PENDING Column */}
        <KanbanColumn
          title="PENDING"
          status="pending"
          sections={columns.pending}
          icon={<Circle className="h-4 w-4 text-muted-foreground" />}
          onSectionClick={handleSectionClick}
          onRetrySection={onRetrySection}
        />

        {/* IN PROGRESS Column */}
        <KanbanColumn
          title="IN PROGRESS"
          status={['in_progress', 'retrying']}
          sections={columns.inProgress}
          icon={<Clock className="h-4 w-4 text-blue-400 animate-pulse" />}
          headerClassName="bg-blue-500/10"
          onSectionClick={handleSectionClick}
          onRetrySection={onRetrySection}
        />

        {/* VERIFYING Column */}
        <KanbanColumn
          title="VERIFYING"
          status="verifying"
          sections={columns.verifying}
          icon={<Eye className="h-4 w-4 text-cyan-400 animate-pulse" />}
          headerClassName="bg-cyan-500/10"
          onSectionClick={handleSectionClick}
          onRetrySection={onRetrySection}
        />

        {/* DONE Column */}
        <KanbanColumn
          title="DONE"
          status={['done', 'failed']}
          sections={columns.done}
          icon={<CheckCircle2 className="h-4 w-4 text-green-400" />}
          headerClassName="bg-green-500/10"
          onSectionClick={handleSectionClick}
          onRetrySection={onRetrySection}
        />
      </div>

      {/* Section Detail Modal */}
      {selectedSection && (
        <SectionDetailModal
          section={selectedSection}
          onClose={() => setSelectedSection(null)}
          onRetry={
            selectedSection.status === 'failed'
              ? () => {
                  onRetrySection?.(selectedSection.id)
                  setSelectedSection(null)
                }
              : undefined
          }
        />
      )}
    </>
  )
}

export default BvsKanbanBoard

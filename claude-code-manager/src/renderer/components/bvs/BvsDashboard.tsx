/**
 * BVS Dashboard Component
 *
 * Main dashboard for BVS workflow execution.
 * Shows progress header, worker status, Kanban board, and notifications.
 *
 * Based on PRD UI Design Specification.
 */

import React, { useEffect, useState } from 'react'
import {
  Play,
  Pause,
  Square,
  Clock,
  Users,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { Button } from '../ui/button'
import { BvsKanbanBoard } from './BvsKanbanBoard'
import type {
  BvsSession,
  BvsWorkerId,
  BvsWorkerInfo,
} from '@shared/bvs-types'
import { BVS_WORKER_COLORS } from '@shared/bvs-types'

// ============================================================================
// Props
// ============================================================================

interface BvsDashboardProps {
  session: BvsSession | null
  onStart?: () => void
  onPause?: () => void
  onResume?: () => void
  onStop?: () => void
  onRetrySection?: (sectionId: string) => void
  className?: string
}

// ============================================================================
// Helper Functions
// ============================================================================

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  if (mins >= 60) {
    const hours = Math.floor(mins / 60)
    const remainingMins = mins % 60
    return `${hours}:${remainingMins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

// ============================================================================
// Worker Badge Component
// ============================================================================

interface WorkerBadgeProps {
  worker: BvsWorkerInfo
}

function WorkerBadge({ worker }: WorkerBadgeProps) {
  const color = BVS_WORKER_COLORS[worker.workerId]
  const isActive = worker.state === 'running'

  return (
    <div
      className={cn(
        'flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm transition-all',
        isActive
          ? 'bg-opacity-20 border-opacity-40'
          : 'bg-muted/20 border-muted text-muted-foreground'
      )}
      style={
        isActive
          ? {
              backgroundColor: `${color.hex}20`,
              borderColor: `${color.hex}60`,
              color: color.hex,
            }
          : undefined
      }
    >
      <div
        className={cn('w-2 h-2 rounded-full', isActive && 'animate-pulse')}
        style={{ backgroundColor: isActive ? color.hex : undefined }}
      />
      <span className="font-medium">{worker.workerId}</span>
      {isActive && worker.sectionId && (
        <span className="text-xs opacity-70 truncate max-w-24" title={worker.sectionId}>
          {worker.sectionId}
        </span>
      )}
    </div>
  )
}

// ============================================================================
// Progress Header Component
// ============================================================================

interface ProgressHeaderProps {
  session: BvsSession
  onStart?: () => void
  onPause?: () => void
  onResume?: () => void
  onStop?: () => void
}

function ProgressHeader({ session, onStart, onPause, onResume, onStop }: ProgressHeaderProps) {
  const [elapsedSeconds, setElapsedSeconds] = useState(session.totalElapsedSeconds)

  // Update elapsed time every second when running
  useEffect(() => {
    if (session.status !== 'running') {
      setElapsedSeconds(session.totalElapsedSeconds)
      return
    }

    const interval = setInterval(() => {
      if (session.startedAt) {
        const elapsed = Math.floor((Date.now() - session.startedAt) / 1000)
        setElapsedSeconds(elapsed)
      }
    }, 1000)

    return () => clearInterval(interval)
  }, [session.status, session.startedAt, session.totalElapsedSeconds])

  const progressPercent = session.sectionsTotal > 0
    ? Math.round((session.sectionsCompleted / session.sectionsTotal) * 100)
    : 0

  const activeWorkers = session.workers.filter((w) => w.state === 'running')

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      {/* Title row */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">
            BVS Execution: {session.projectName}
          </h2>
          <div className="flex items-center gap-1 text-sm text-muted-foreground">
            <Clock className="h-4 w-4" />
            <span>{formatDuration(elapsedSeconds)}</span>
          </div>
        </div>

        {/* Control buttons */}
        <div className="flex items-center gap-2">
          {session.status === 'idle' || session.status === 'awaiting_approval' ? (
            <Button size="sm" onClick={onStart}>
              <Play className="h-4 w-4 mr-1" />
              Start
            </Button>
          ) : session.status === 'running' ? (
            <>
              <Button variant="outline" size="sm" onClick={onPause}>
                <Pause className="h-4 w-4 mr-1" />
                Pause
              </Button>
              <Button variant="destructive" size="sm" onClick={onStop}>
                <Square className="h-4 w-4 mr-1" />
                Stop
              </Button>
            </>
          ) : session.status === 'paused' ? (
            <>
              <Button size="sm" onClick={onResume}>
                <Play className="h-4 w-4 mr-1" />
                Resume
              </Button>
              <Button variant="destructive" size="sm" onClick={onStop}>
                <Square className="h-4 w-4 mr-1" />
                Stop
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {/* Progress bar and stats */}
      <div className="space-y-3">
        {/* Progress bar */}
        <div className="relative">
          <div className="w-full h-3 bg-secondary/50 rounded-full overflow-hidden">
            <div
              className={cn(
                'h-full transition-all duration-300',
                session.status === 'completed' ? 'bg-green-500' : 'bg-blue-500'
              )}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <span className="absolute right-0 top-1/2 -translate-y-1/2 text-sm font-medium px-2">
            {progressPercent}%
          </span>
        </div>

        {/* Stats row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-6 text-sm">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-400" />
              <span>
                {session.sectionsCompleted}/{session.sectionsTotal} sections
              </span>
            </div>
            {session.sectionsFailed > 0 && (
              <div className="flex items-center gap-2 text-red-400">
                <AlertTriangle className="h-4 w-4" />
                <span>{session.sectionsFailed} failed</span>
              </div>
            )}
          </div>

          {/* Workers status */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 text-sm text-muted-foreground mr-2">
              <Users className="h-4 w-4" />
              <span>Workers:</span>
            </div>
            {session.workers.length > 0 ? (
              <div className="flex items-center gap-1">
                {session.workers.map((worker) => (
                  <WorkerBadge key={worker.workerId} worker={worker} />
                ))}
              </div>
            ) : (
              <span className="text-sm text-muted-foreground">
                {activeWorkers.length} active
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Notification Toast
// ============================================================================

interface NotificationToastProps {
  message: string
  type: 'success' | 'error' | 'warning' | 'info'
  onClose: () => void
}

function NotificationToast({ message, type, onClose }: NotificationToastProps) {
  useEffect(() => {
    const timer = setTimeout(onClose, 5000)
    return () => clearTimeout(timer)
  }, [onClose])

  return (
    <div
      className={cn(
        'fixed bottom-4 right-4 px-4 py-3 rounded-lg shadow-lg border flex items-center gap-3 z-50 animate-in slide-in-from-bottom-2',
        type === 'success' && 'bg-green-500/10 border-green-500/20 text-green-400',
        type === 'error' && 'bg-red-500/10 border-red-500/20 text-red-400',
        type === 'warning' && 'bg-amber-500/10 border-amber-500/20 text-amber-400',
        type === 'info' && 'bg-blue-500/10 border-blue-500/20 text-blue-400'
      )}
    >
      {type === 'success' && <CheckCircle2 className="h-5 w-5" />}
      {type === 'error' && <AlertTriangle className="h-5 w-5" />}
      {type === 'warning' && <AlertTriangle className="h-5 w-5" />}
      {type === 'info' && <RefreshCw className="h-5 w-5" />}
      <span>{message}</span>
      <Button
        variant="ghost"
        size="sm"
        onClick={onClose}
        className="ml-2 h-6 w-6 p-0"
      >
        ×
      </Button>
    </div>
  )
}

// ============================================================================
// Main Component
// ============================================================================

export function BvsDashboard({
  session,
  onStart,
  onPause,
  onResume,
  onStop,
  onRetrySection,
  className,
}: BvsDashboardProps) {
  const [notification, setNotification] = useState<{
    message: string
    type: 'success' | 'error' | 'warning' | 'info'
  } | null>(null)

  // Show notification when section completes
  useEffect(() => {
    if (!session) return

    // Listen for BVS events via window.electron if available
    // This is a placeholder - actual implementation would use IPC
  }, [session])

  if (!session) {
    return (
      <div className={cn('flex items-center justify-center h-full', className)}>
        <div className="text-center text-muted-foreground">
          <div className="text-lg font-medium mb-2">No BVS Session Active</div>
          <div className="text-sm">Create a new session to get started</div>
        </div>
      </div>
    )
  }

  return (
    <div className={cn('flex flex-col h-full gap-4', className)}>
      {/* Progress Header */}
      <ProgressHeader
        session={session}
        onStart={onStart}
        onPause={onPause}
        onResume={onResume}
        onStop={onStop}
      />

      {/* Kanban Board */}
      <div className="flex-1 min-h-0">
        <BvsKanbanBoard
          sections={session.plan?.sections || []}
          onRetrySection={onRetrySection}
          className="h-full"
        />
      </div>

      {/* Notification Toast */}
      {notification && (
        <NotificationToast
          message={notification.message}
          type={notification.type}
          onClose={() => setNotification(null)}
        />
      )}
    </div>
  )
}

export default BvsDashboard

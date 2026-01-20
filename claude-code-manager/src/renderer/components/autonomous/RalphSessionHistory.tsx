/**
 * RalphSessionHistory Component
 *
 * Displays a list of past Ralph Loop sessions with ability to:
 * - View session details
 * - Resume a session
 * - Delete sessions
 */

import React from 'react'
import {
  Clock,
  Play,
  Trash2,
  CheckCircle,
  XCircle,
  Pause,
  FolderOpen,
  ChevronRight,
  AlertCircle
} from 'lucide-react'
import { Button } from '../ui/button'
import { cn } from '@renderer/lib/utils'
import type { RalphSessionSummary, RalphSessionPhase, RalphStatus } from '@shared/types'

interface RalphSessionHistoryProps {
  sessions: RalphSessionSummary[]
  currentSessionId: string | null
  onResume: (sessionId: string) => void
  onDelete: (sessionId: string) => void
  onClose: () => void
}

/** Get status icon based on session status */
function getStatusIcon(status: RalphStatus) {
  switch (status) {
    case 'completed':
      return <CheckCircle className="h-4 w-4 text-green-400" />
    case 'running':
      return <Play className="h-4 w-4 text-blue-400" />
    case 'paused':
      return <Pause className="h-4 w-4 text-yellow-400" />
    case 'error':
      return <XCircle className="h-4 w-4 text-red-400" />
    default:
      return <Clock className="h-4 w-4 text-gray-400" />
  }
}

/** Get phase display name */
function getPhaseLabel(phase: RalphSessionPhase): string {
  switch (phase) {
    case 'initiator':
      return 'Gathering Requirements'
    case 'requirements':
      return 'Requirements Review'
    case 'prompt_review':
      return 'Prompt Review'
    case 'executing':
      return 'Executing'
    case 'completed':
      return 'Completed'
    default:
      return phase
  }
}

/** Format relative time */
function formatRelativeTime(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp

  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`

  return new Date(timestamp).toLocaleDateString()
}

export function RalphSessionHistory({
  sessions,
  currentSessionId,
  onResume,
  onDelete,
  onClose
}: RalphSessionHistoryProps): React.ReactElement {
  const [confirmDelete, setConfirmDelete] = React.useState<string | null>(null)

  const handleDelete = (sessionId: string) => {
    if (confirmDelete === sessionId) {
      onDelete(sessionId)
      setConfirmDelete(null)
    } else {
      setConfirmDelete(sessionId)
      // Auto-reset after 3 seconds
      setTimeout(() => setConfirmDelete(null), 3000)
    }
  }

  if (sessions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center">
        <AlertCircle className="h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-medium mb-2">No Previous Sessions</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Your Ralph Loop session history will appear here.
        </p>
        <Button variant="outline" onClick={onClose}>
          Start New Session
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <h3 className="font-medium">Session History</h3>
        <span className="text-xs text-muted-foreground">
          {sessions.length} session{sessions.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Session List */}
      <div className="flex-1 overflow-y-auto">
        {sessions.map((session) => {
          const isCurrent = session.id === currentSessionId
          const isDeleting = confirmDelete === session.id

          return (
            <div
              key={session.id}
              className={cn(
                'border-b p-3 hover:bg-muted/50 transition-colors',
                isCurrent && 'bg-primary/5 border-l-2 border-l-primary'
              )}
            >
              {/* Top row: Status, Task, Time */}
              <div className="flex items-start gap-2 mb-2">
                <div className="mt-0.5">
                  {getStatusIcon(session.status)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate" title={session.taskDescription}>
                    {session.taskDescription || 'Untitled Session'}
                  </p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                    <span>{getPhaseLabel(session.phase)}</span>
                    <span>·</span>
                    <span>{formatRelativeTime(session.updatedAt)}</span>
                  </div>
                </div>
              </div>

              {/* Middle row: Project info */}
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2 ml-6">
                <FolderOpen className="h-3 w-3" />
                <span className="truncate" title={session.projectPath}>
                  {session.projectName}
                </span>
              </div>

              {/* Bottom row: Stats and Actions */}
              <div className="flex items-center justify-between ml-6">
                {/* Stats */}
                <div className="flex items-center gap-3 text-xs">
                  {session.featuresTotal > 0 && (
                    <>
                      <span className="text-green-400">
                        {session.featuresPassed} passed
                      </span>
                      {session.featuresFailed > 0 && (
                        <span className="text-red-400">
                          {session.featuresFailed} failed
                        </span>
                      )}
                      <span className="text-muted-foreground">
                        / {session.featuresTotal} total
                      </span>
                    </>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1">
                  {/* Resume button - only for non-completed sessions */}
                  {session.status !== 'completed' && !isCurrent && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onResume(session.id)}
                      className="h-7 text-xs gap-1"
                    >
                      <ChevronRight className="h-3 w-3" />
                      Resume
                    </Button>
                  )}

                  {/* Delete button */}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(session.id)}
                    className={cn(
                      'h-7 text-xs',
                      isDeleting && 'text-red-400 hover:text-red-500 hover:bg-red-500/10'
                    )}
                  >
                    <Trash2 className="h-3 w-3" />
                    {isDeleting && <span className="ml-1">Confirm?</span>}
                  </Button>
                </div>
              </div>

              {/* Current session indicator */}
              {isCurrent && (
                <div className="mt-2 ml-6 text-xs text-primary">
                  Current session
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t bg-muted/30">
        <Button
          variant="outline"
          size="sm"
          onClick={onClose}
          className="w-full"
        >
          Close History
        </Button>
      </div>
    </div>
  )
}

export default RalphSessionHistory

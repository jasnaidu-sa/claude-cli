import React from 'react'
import { SessionCard } from './SessionCard'
import { useSessionStore } from '@renderer/stores/session-store'
import { useUIStore } from '@renderer/stores/ui-store'
import { Plus, FolderPlus } from 'lucide-react'
import { Button } from '../ui/button'

export function SessionGrid() {
  const { sessions, activeSessionId } = useSessionStore()
  const { viewMode, setShowNewSessionModal, gridColumns } = useUIStore()

  if (sessions.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <FolderPlus className="h-16 w-16 text-muted-foreground/30 mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">No Active Sessions</h2>
          <p className="text-muted-foreground mb-6 max-w-md">
            Start a new Claude Code session by selecting a project folder.
            You can run multiple sessions simultaneously.
          </p>
          <Button onClick={() => setShowNewSessionModal(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            New Session
          </Button>
        </div>
      </div>
    )
  }

  // Single column view (from settings or single session)
  if (gridColumns === 1 || viewMode === 'single') {
    const activeSession = sessions.find((s) => s.id === activeSessionId) || sessions[0]
    return (
      <div className="h-full p-4">
        <SessionCard
          session={activeSession}
          isActive={true}
          compact={false}
        />
      </div>
    )
  }

  // Grid view using CSS grid - stable layout that doesn't remount
  const sessionCount = sessions.length
  const effectiveCols = Math.min(gridColumns, sessionCount)
  const rowCount = Math.ceil(sessionCount / effectiveCols)

  return (
    <div
      className="h-full p-4 grid gap-2"
      style={{
        gridTemplateColumns: `repeat(${effectiveCols}, 1fr)`,
        gridTemplateRows: `repeat(${rowCount}, 1fr)`
      }}
    >
      {sessions.map((session) => (
        <SessionCard
          key={session.id}
          session={session}
          isActive={session.id === activeSessionId}
          compact={false}
        />
      ))}
    </div>
  )
}

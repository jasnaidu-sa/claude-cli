import React, { useState, useCallback } from 'react'
import { X, Circle, Maximize2, FileEdit, FolderOpen } from 'lucide-react'
import { Button } from '../ui/button'
import { Terminal } from '../terminal/Terminal'
import { FileTree } from '../file-explorer/FileTree'
import { EditTracker } from '../edit-tracker/EditTracker'
import { ResizeHandle } from '../ui/ResizeHandle'
import { cn, getStatusColor } from '@renderer/lib/utils'
import { useSessionStore } from '@renderer/stores/session-store'
import { useUIStore } from '@renderer/stores/ui-store'
import type { Session } from '@shared/types'

interface SessionCardProps {
  session: Session
  isActive: boolean
  compact?: boolean
}

export function SessionCard({ session, isActive, compact = false }: SessionCardProps) {
  const { removeSession, setActiveSession } = useSessionStore()
  const { setViewMode } = useUIStore()
  // Default to showing files only in expanded (non-compact) mode
  const [showFiles, setShowFiles] = useState(false)
  const [fileTreeWidth, setFileTreeWidth] = useState(200)

  const handleFileTreeResize = useCallback((delta: number) => {
    setFileTreeWidth(prev => Math.max(120, Math.min(400, prev + delta)))
  }, [])

  const handleClose = async () => {
    await window.electron.session.destroy(session.id)
    removeSession(session.id)
  }

  const handleExpand = () => {
    setActiveSession(session.id)
    setViewMode('single')
  }

  return (
    <div
      className={cn(
        'flex flex-col bg-card rounded-lg border overflow-hidden transition-all h-full',
        isActive ? 'border-primary/50 ring-1 ring-primary/20' : 'border-border'
      )}
    >
      {/* Header */}
      <div className="h-10 px-3 flex items-center justify-between border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-2">
          <Circle
            className={cn(
              'h-2 w-2 fill-current',
              session.status === 'idle' && 'text-gray-500',
              session.status === 'running' && 'text-green-500 animate-pulse',
              session.status === 'thinking' && 'text-yellow-500 animate-pulse',
              session.status === 'editing' && 'text-blue-500 animate-pulse',
              session.status === 'error' && 'text-red-500'
            )}
          />
          <span className="font-medium text-sm truncate max-w-[150px]">
            {session.projectName}
          </span>
          <span className="text-xs text-muted-foreground capitalize">
            {session.status}
          </span>
        </div>

        <div className="flex items-center gap-1">
          {session.editedFiles.length > 0 && (
            <span className="text-xs bg-yellow-500/20 text-yellow-500 px-1.5 py-0.5 rounded flex items-center gap-1">
              <FileEdit className="h-3 w-3" />
              {session.editedFiles.length}
            </span>
          )}

          {compact && (
            <Button variant="ghost" size="icon" onClick={handleExpand} className="h-7 w-7">
              <Maximize2 className="h-3 w-3" />
            </Button>
          )}

          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShowFiles(!showFiles)}
            className="h-7 w-7"
          >
            <FolderOpen className={cn('h-3 w-3', showFiles && 'text-primary')} />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            onClick={handleClose}
            className="h-7 w-7 hover:bg-destructive/10 hover:text-destructive"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Content - flexbox layout for stable rendering */}
      <div className="flex-1 min-h-0 flex">
        {showFiles && (
          <>
            <div
              style={{ width: fileTreeWidth }}
              className="h-full flex flex-col border-r border-border shrink-0"
            >
              <div className="flex-1 overflow-auto">
                <FileTree
                  projectPath={session.projectPath}
                  editedFiles={session.editedFiles}
                />
              </div>
              {session.editedFiles.length > 0 && (
                <div className="border-t border-border">
                  <EditTracker files={session.editedFiles} />
                </div>
              )}
            </div>
            <ResizeHandle
              direction="horizontal"
              onResize={handleFileTreeResize}
              className="bg-border"
            />
          </>
        )}
        <div className="flex-1 min-w-0 h-full">
          <Terminal sessionId={session.id} />
        </div>
      </div>
    </div>
  )
}

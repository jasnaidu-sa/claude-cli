import React, { useState } from 'react'
import { X, AlertTriangle, FileWarning, Terminal } from 'lucide-react'
import { Button } from '../ui/button'
import { useWorktreeStore } from '@renderer/stores/worktree-store'
import { useSessionStore } from '@renderer/stores/session-store'
import type { Worktree } from '@shared/types/git'

interface ConflictModalProps {
  worktree: Worktree
  conflicts: string[]
  onClose: () => void
  onResolved: () => void
}

export function ConflictModal({ worktree, conflicts, onClose, onResolved }: ConflictModalProps) {
  const { abortMerge } = useWorktreeStore()
  const { addSession } = useSessionStore()
  const [isAborting, setIsAborting] = useState(false)

  const handleResolveWithClaude = async () => {
    // Create a session in the worktree so Claude can help resolve conflicts
    const result = await window.electron.session.create(worktree.path)
    if (result.success && result.session) {
      addSession(result.session)
    }
    onClose()
  }

  const handleAbort = async () => {
    setIsAborting(true)
    try {
      await abortMerge(worktree.parentRepo)
      onClose()
    } catch (err) {
      console.error('Failed to abort merge:', err)
    } finally {
      setIsAborting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card border border-border rounded-lg w-full max-w-md shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border bg-destructive/5">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <h2 className="text-lg font-semibold">Merge Conflicts</h2>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          <p className="text-sm text-muted-foreground">
            The following files have conflicts that need to be resolved:
          </p>

          {/* Conflict file list */}
          <div className="space-y-1 max-h-48 overflow-auto border border-border rounded-md">
            {conflicts.map((file, i) => (
              <div
                key={i}
                className="flex items-center gap-2 p-2 text-sm hover:bg-muted/50"
              >
                <FileWarning className="h-4 w-4 text-destructive shrink-0" />
                <span className="truncate font-mono text-xs">{file}</span>
              </div>
            ))}
          </div>

          {/* Resolution options */}
          <div className="space-y-2">
            <div className="text-sm font-medium">Resolution Options</div>

            <Button
              className="w-full justify-start gap-2"
              variant="outline"
              onClick={handleResolveWithClaude}
            >
              <Terminal className="h-4 w-4" />
              Resolve with Claude
              <span className="text-xs text-muted-foreground ml-auto">
                Start session in worktree
              </span>
            </Button>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-between p-4 border-t border-border">
          <Button
            variant="destructive"
            onClick={handleAbort}
            disabled={isAborting}
          >
            {isAborting ? 'Aborting...' : 'Abort Merge'}
          </Button>
          <Button onClick={onResolved}>
            I've Resolved Conflicts
          </Button>
        </div>
      </div>
    </div>
  )
}

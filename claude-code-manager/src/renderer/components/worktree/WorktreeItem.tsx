import React, { useState } from 'react'
import {
  GitMerge, Trash2, ArrowUpCircle, ArrowDownCircle,
  MoreHorizontal, Play
} from 'lucide-react'
import { Button } from '../ui/button'
import { useWorktreeStore } from '@renderer/stores/worktree-store'
import { useSessionStore } from '@renderer/stores/session-store'
import { MergeModal } from './MergeModal'
import { cn } from '@renderer/lib/utils'
import type { Worktree } from '@shared/types/git'

interface WorktreeItemProps {
  worktree: Worktree
}

export function WorktreeItem({ worktree }: WorktreeItemProps) {
  const { statusByWorktree, removeWorktree, pull, push } = useWorktreeStore()
  const { addSession } = useSessionStore()
  const [showMerge, setShowMerge] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  const status = statusByWorktree[worktree.id]

  const handleStartSession = async () => {
    // Create a new Claude session for this worktree
    const result = await window.electron.session.create(worktree.path)
    if (result.success && result.session) {
      addSession(result.session)
    }
  }

  const handleDelete = async () => {
    if (!confirm(`Delete worktree "${worktree.branch}"? This cannot be undone.`)) return
    setIsDeleting(true)
    await removeWorktree(worktree.path, false)
    setIsDeleting(false)
  }

  const handlePull = async () => {
    await pull(worktree.path)
  }

  const handlePush = async () => {
    await push(worktree.path, !status?.ahead)
  }

  return (
    <>
      <div className="flex items-center justify-between p-2 hover:bg-muted/30 group">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {/* Status indicator */}
          <div className={cn(
            "w-2 h-2 rounded-full shrink-0",
            status?.hasConflicts ? "bg-red-500" :
            status?.isDirty ? "bg-yellow-500" : "bg-green-500"
          )} />

          {/* Branch name */}
          <span className="text-xs truncate">{worktree.branch}</span>

          {/* Main badge */}
          {worktree.isMain && (
            <span className="text-[10px] px-1 bg-primary/20 text-primary rounded shrink-0">
              main
            </span>
          )}
        </div>

        {/* Action buttons - show on hover */}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {/* Pull indicator */}
          {status?.behind > 0 && (
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5"
              onClick={handlePull}
              title={`Pull ${status.behind} commit(s)`}
            >
              <ArrowDownCircle className="h-3 w-3 text-blue-500" />
            </Button>
          )}

          {/* Push indicator */}
          {status?.ahead > 0 && (
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5"
              onClick={handlePush}
              title={`Push ${status.ahead} commit(s)`}
            >
              <ArrowUpCircle className="h-3 w-3 text-green-500" />
            </Button>
          )}

          {/* Start session */}
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5"
            onClick={handleStartSession}
            title="Start Claude session"
          >
            <Play className="h-3 w-3" />
          </Button>

          {/* Merge (not for main) */}
          {!worktree.isMain && (
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5"
              onClick={() => setShowMerge(true)}
              title="Merge to parent branch"
            >
              <GitMerge className="h-3 w-3" />
            </Button>
          )}

          {/* Delete (not for main) */}
          {!worktree.isMain && (
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 hover:text-destructive"
              onClick={handleDelete}
              disabled={isDeleting}
              title="Delete worktree"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>

      {showMerge && (
        <MergeModal
          worktree={worktree}
          onClose={() => setShowMerge(false)}
        />
      )}
    </>
  )
}

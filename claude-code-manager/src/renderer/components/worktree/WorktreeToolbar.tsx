import React, { useState, useEffect } from 'react'
import { GitMerge, Trash2, ArrowUpCircle, ArrowDownCircle } from 'lucide-react'
import { Button } from '../ui/button'
import { useWorktreeStore } from '@renderer/stores/worktree-store'
import { LifecycleStatusBadge } from './LifecycleStatusBadge'
import type { Worktree } from '@shared/types/git'

interface WorktreeToolbarProps {
  worktree: Worktree
  onMerge: () => void
  onDelete: () => void
}

export function WorktreeToolbar({ worktree, onMerge, onDelete }: WorktreeToolbarProps) {
  const { statusByWorktree, pull, push, getLifecycle } = useWorktreeStore()
  const [lifecycle, setLifecycle] = useState<any>(null)
  const [isPulling, setIsPulling] = useState(false)
  const [isPushing, setIsPushing] = useState(false)

  const status = statusByWorktree[worktree.id]

  useEffect(() => {
    loadLifecycle()
  }, [worktree.path])

  const loadLifecycle = async () => {
    const lifecycleData = await getLifecycle(worktree.path)
    setLifecycle(lifecycleData)
  }

  const handlePull = async () => {
    setIsPulling(true)
    try {
      await pull(worktree.path)
    } finally {
      setIsPulling(false)
    }
  }

  const handlePush = async () => {
    setIsPushing(true)
    try {
      await push(worktree.path, !status?.ahead)
    } finally {
      setIsPushing(false)
    }
  }

  return (
    <div className="flex items-center gap-1 border-l border-border pl-2 ml-2">
      {/* Lifecycle Status Badge */}
      {lifecycle && (
        <LifecycleStatusBadge worktreePath={worktree.path} showLabel={true} />
      )}

      {/* Pull Button (if behind) */}
      {status?.behind > 0 && (
        <Button
          size="sm"
          variant="ghost"
          onClick={handlePull}
          disabled={isPulling}
          className="h-7 px-2"
          title={`Pull ${status.behind} commit(s)`}
        >
          <ArrowDownCircle className="h-3.5 w-3.5 text-blue-500" />
          <span className="text-xs ml-1">{status.behind}</span>
        </Button>
      )}

      {/* Push Button (if ahead) */}
      {status?.ahead > 0 && (
        <Button
          size="sm"
          variant="ghost"
          onClick={handlePush}
          disabled={isPushing}
          className="h-7 px-2"
          title={`Push ${status.ahead} commit(s)`}
        >
          <ArrowUpCircle className="h-3.5 w-3.5 text-green-500" />
          <span className="text-xs ml-1">{status.ahead}</span>
        </Button>
      )}

      {/* Merge Button (primary action) */}
      {!worktree.isMain && (
        <Button
          size="sm"
          onClick={onMerge}
          className="h-7 px-2"
          title="Merge to parent branch (with AI conflict resolution)"
        >
          <GitMerge className="h-3.5 w-3.5 mr-1" />
          <span className="text-xs">Merge</span>
          {status?.hasConflicts && (
            <span className="ml-1 text-[10px] bg-red-500/20 text-red-500 px-1 rounded">
              {status.conflictCount || '!'}
            </span>
          )}
        </Button>
      )}

      {/* Delete Button (destructive action) */}
      {!worktree.isMain && (
        <Button
          size="sm"
          variant="ghost"
          onClick={onDelete}
          className="h-7 w-7 hover:text-destructive"
          title="Delete worktree"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  )
}

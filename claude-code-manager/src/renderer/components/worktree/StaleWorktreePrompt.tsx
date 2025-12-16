import React, { useState } from 'react'
import { X, Clock, Trash2, AlertCircle, Loader2 } from 'lucide-react'
import { Button } from '../ui/button'
import { useWorktreeStore } from '@renderer/stores/worktree-store'
import type { Worktree } from '@shared/types/git'

interface StaleWorktreePromptProps {
  worktrees: Worktree[]
  onClose: () => void
}

export function StaleWorktreePrompt({ worktrees, onClose }: StaleWorktreePromptProps) {
  const { removeWorktree, refreshWorktrees } = useWorktreeStore()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleted, setDeleted] = useState<string[]>([])

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const selectAll = () => {
    setSelected(new Set(worktrees.map(w => w.id)))
  }

  const handleDelete = async () => {
    if (selected.size === 0) return

    setIsDeleting(true)
    const toDelete = worktrees.filter(w => selected.has(w.id))

    for (const worktree of toDelete) {
      try {
        await removeWorktree(worktree.path, true)
        setDeleted(prev => [...prev, worktree.id])
      } catch (err) {
        console.error(`Failed to delete ${worktree.branch}:`, err)
      }
    }

    await refreshWorktrees()
    setIsDeleting(false)

    if (deleted.length === worktrees.length) {
      onClose()
    }
  }

  const formatAge = (timestamp: number): string => {
    const days = Math.floor((Date.now() - timestamp) / (1000 * 60 * 60 * 24))
    if (days === 0) return 'Today'
    if (days === 1) return 'Yesterday'
    if (days < 7) return `${days} days ago`
    if (days < 30) return `${Math.floor(days / 7)} weeks ago`
    return `${Math.floor(days / 30)} months ago`
  }

  const remainingWorktrees = worktrees.filter(w => !deleted.includes(w.id))

  if (remainingWorktrees.length === 0) {
    return null
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card border border-border rounded-lg w-full max-w-md shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border bg-yellow-500/5">
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-yellow-500" />
            <h2 className="text-lg font-semibold">Stale Worktrees</h2>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          <div className="flex items-start gap-2 p-3 bg-muted/50 rounded-md">
            <AlertCircle className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <p className="text-sm text-muted-foreground">
              These worktrees haven't been accessed in over 14 days.
              Consider cleaning them up to free disk space.
            </p>
          </div>

          {/* Worktree list */}
          <div className="space-y-1 max-h-64 overflow-auto">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">
                {selected.size} of {remainingWorktrees.length} selected
              </span>
              <Button variant="ghost" size="sm" onClick={selectAll}>
                Select All
              </Button>
            </div>

            {remainingWorktrees.map(worktree => (
              <label
                key={worktree.id}
                className="flex items-center gap-3 p-2 hover:bg-muted/50 rounded-md cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selected.has(worktree.id)}
                  onChange={() => toggleSelect(worktree.id)}
                  className="rounded border-border"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{worktree.branch}</div>
                  <div className="text-xs text-muted-foreground">
                    Last accessed: {formatAge(worktree.lastAccessedAt)}
                  </div>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-between p-4 border-t border-border">
          <Button variant="ghost" onClick={onClose}>
            Remind Me Later
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={selected.size === 0 || isDeleting}
          >
            {isDeleting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Deleting...
              </>
            ) : (
              <>
                <Trash2 className="h-4 w-4 mr-2" />
                Delete Selected ({selected.size})
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}

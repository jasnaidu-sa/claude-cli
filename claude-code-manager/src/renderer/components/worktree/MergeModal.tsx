import React, { useState, useEffect } from 'react'
import { X, GitMerge, AlertTriangle, Loader2, FileCode } from 'lucide-react'
import { Button } from '../ui/button'
import { useWorktreeStore } from '@renderer/stores/worktree-store'
import { cn } from '@renderer/lib/utils'
import type { Worktree, MergePreview, MergeStrategy } from '@shared/types/git'

interface MergeModalProps {
  worktree: Worktree
  onClose: () => void
}

export function MergeModal({ worktree, onClose }: MergeModalProps) {
  const { getMergePreview, merge, abortMerge } = useWorktreeStore()

  const [preview, setPreview] = useState<MergePreview | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isMerging, setIsMerging] = useState(false)
  const [strategy, setStrategy] = useState<MergeStrategy>('merge')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadPreview()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worktree.path])

  const loadPreview = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const previewData = await getMergePreview(worktree.path)
      setPreview(previewData)
    } catch (err) {
      setError('Failed to load merge preview')
    } finally {
      setIsLoading(false)
    }
  }

  const handleMerge = async () => {
    setIsMerging(true)
    setError(null)
    try {
      const result = await merge(worktree.path, strategy)
      if (result.success) {
        onClose()
      } else if (result.conflicts && result.conflicts.length > 0) {
        setError(`Merge conflicts in: ${result.conflicts.join(', ')}`)
      } else {
        setError(result.error || 'Merge failed')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Merge failed')
    } finally {
      setIsMerging(false)
    }
  }

  const handleAbort = async () => {
    try {
      await abortMerge(worktree.parentRepo)
      onClose()
    } catch (err) {
      setError('Failed to abort merge')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-card border border-border rounded-lg shadow-xl w-full max-w-lg mx-4">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <GitMerge className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">
              Merge: {worktree.branch} → {worktree.parentBranch}
            </h2>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4 max-h-96 overflow-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : preview ? (
            <>
              {/* Conflict warning */}
              {preview.hasConflicts && (
                <div className="flex items-center gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-md">
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                  <span className="text-sm text-destructive">
                    {preview.conflictFiles?.length || 0} file(s) will have conflicts
                  </span>
                </div>
              )}

              {/* Stats */}
              <div className="grid grid-cols-3 gap-4 text-center">
                <div className="p-3 bg-muted/50 rounded-md">
                  <div className="text-2xl font-bold">{preview.filesChanged}</div>
                  <div className="text-xs text-muted-foreground">Files Changed</div>
                </div>
                <div className="p-3 bg-green-500/10 rounded-md">
                  <div className="text-2xl font-bold text-green-500">+{preview.additions}</div>
                  <div className="text-xs text-muted-foreground">Additions</div>
                </div>
                <div className="p-3 bg-red-500/10 rounded-md">
                  <div className="text-2xl font-bold text-red-500">-{preview.deletions}</div>
                  <div className="text-xs text-muted-foreground">Deletions</div>
                </div>
              </div>

              {/* File list */}
              <div className="space-y-1 max-h-40 overflow-auto">
                <div className="text-sm font-medium mb-2">Changed Files</div>
                {preview.files.map((file, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 text-xs p-1.5 hover:bg-muted/50 rounded"
                  >
                    <FileCode className="h-3 w-3 text-muted-foreground" />
                    <span className="truncate flex-1">{file.path}</span>
                    <span className="text-green-500">+{file.additions}</span>
                    <span className="text-red-500">-{file.deletions}</span>
                  </div>
                ))}
              </div>

              {/* Strategy selection */}
              <div className="space-y-2">
                <div className="text-sm font-medium">Merge Strategy</div>
                <div className="flex gap-2">
                  {(['merge', 'squash', 'rebase'] as MergeStrategy[]).map((s) => (
                    <Button
                      key={s}
                      variant={strategy === s ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setStrategy(s)}
                      className="flex-1 capitalize"
                    >
                      {s}
                    </Button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  {strategy === 'merge' && 'Create a merge commit preserving history'}
                  {strategy === 'squash' && 'Combine all commits into one'}
                  {strategy === 'rebase' && 'Replay commits on top of target branch'}
                </p>
              </div>
            </>
          ) : (
            <div className="text-center text-muted-foreground py-8">
              No changes to merge
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md">
              <div className="text-sm text-destructive">{error}</div>
              {error.includes('conflicts') && (
                <Button variant="outline" size="sm" className="mt-2" onClick={handleAbort}>
                  Abort Merge
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 p-4 border-t border-border">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleMerge}
            disabled={isLoading || isMerging || !preview || preview.filesChanged === 0}
            className={cn(preview?.hasConflicts && 'bg-yellow-600 hover:bg-yellow-700')}
          >
            {isMerging ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Merging...
              </>
            ) : preview?.hasConflicts ? (
              'Merge (with conflicts)'
            ) : (
              'Merge'
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}

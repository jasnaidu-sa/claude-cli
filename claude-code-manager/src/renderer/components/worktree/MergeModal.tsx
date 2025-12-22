import React, { useState, useEffect } from 'react'
import { X, GitMerge, AlertTriangle, Loader2, FileCode, Brain, Sparkles } from 'lucide-react'
import { Button } from '../ui/button'
import { useWorktreeStore } from '@renderer/stores/worktree-store'
import { cn } from '@renderer/lib/utils'
import type { Worktree, MergePreview, MergeStrategy, ConflictResolutionResult } from '@shared/types/git'

interface MergeModalProps {
  worktree: Worktree
  onClose: () => void
}

export function MergeModal({ worktree, onClose }: MergeModalProps) {
  const { getMergePreview, merge, mergeWithAI, abortMerge, checkAIAvailability, isAIAvailable } = useWorktreeStore()

  const [preview, setPreview] = useState<MergePreview | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isMerging, setIsMerging] = useState(false)
  const [strategy, setStrategy] = useState<MergeStrategy>('merge')
  const [error, setError] = useState<string | null>(null)
  const [useAI, setUseAI] = useState(true)
  const [confidenceThreshold, setConfidenceThreshold] = useState(60)
  const [resolutions, setResolutions] = useState<ConflictResolutionResult[]>([])
  const [showAIDetails, setShowAIDetails] = useState(false)

  useEffect(() => {
    loadPreview()
    checkAIAvailability()
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
    setResolutions([])
    try {
      // Use AI merge if conflicts expected and AI available
      const shouldUseAI = useAI && preview?.hasConflicts && isAIAvailable

      if (shouldUseAI) {
        const result = await mergeWithAI(worktree.path, strategy, true, confidenceThreshold)
        if (result.success) {
          if (result.resolutions && result.resolutions.length > 0) {
            setResolutions(result.resolutions)
            setShowAIDetails(true)
          }
          setTimeout(() => onClose(), result.resolutions ? 3000 : 0)
        } else if (result.conflicts && result.conflicts.length > 0) {
          setError(`Merge conflicts in: ${result.conflicts.join(', ')}`)
        } else {
          setError(result.error || 'Merge failed')
        }
      } else {
        const result = await merge(worktree.path, strategy)
        if (result.success) {
          onClose()
        } else if (result.conflicts && result.conflicts.length > 0) {
          setError(`Merge conflicts in: ${result.conflicts.join(', ')}`)
        } else {
          setError(result.error || 'Merge failed')
        }
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

              {/* AI Conflict Resolution */}
              {preview.hasConflicts && isAIAvailable && (
                <div className="space-y-3 p-3 border border-primary/20 rounded-lg bg-primary/5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Brain className="h-4 w-4 text-primary" />
                      <span className="text-sm font-medium">AI Conflict Resolution</span>
                      <Sparkles className="h-3 w-3 text-primary" />
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setUseAI(!useAI)}
                      className={cn('h-7', useAI && 'bg-primary/10')}
                    >
                      {useAI ? 'Enabled' : 'Disabled'}
                    </Button>
                  </div>

                  {useAI && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">Confidence Threshold</span>
                        <span className="font-medium">{confidenceThreshold}%</span>
                      </div>
                      <input
                        type="range"
                        min="40"
                        max="90"
                        step="10"
                        value={confidenceThreshold}
                        onChange={(e) => setConfidenceThreshold(Number(e.target.value))}
                        className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer"
                      />
                      <p className="text-xs text-muted-foreground">
                        Higher threshold = safer resolutions, may fall back to full-file analysis
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* AI Resolution Results */}
              {resolutions.length > 0 && showAIDetails && (
                <div className="space-y-2 p-3 border border-green-500/20 rounded-lg bg-green-500/5">
                  <div className="flex items-center gap-2 text-sm font-medium text-green-600">
                    <Sparkles className="h-4 w-4" />
                    AI Successfully Resolved {resolutions.length} Conflict(s)
                  </div>
                  <div className="space-y-1 max-h-32 overflow-auto">
                    {resolutions.map((res, i) => (
                      <div key={i} className="text-xs p-2 bg-muted/30 rounded">
                        <div className="flex items-center justify-between">
                          <span className="truncate flex-1">{res.filePath}</span>
                          <span
                            className={cn(
                              'ml-2 px-1.5 py-0.5 rounded text-xs font-medium',
                              res.strategy === 'ai-conflict-only' && 'bg-blue-500/20 text-blue-600',
                              res.strategy === 'ai-full-file' && 'bg-purple-500/20 text-purple-600',
                              res.strategy === 'auto-merge' && 'bg-green-500/20 text-green-600'
                            )}
                          >
                            {res.strategy === 'ai-conflict-only' && `Tier 2 (${res.confidence}%)`}
                            {res.strategy === 'ai-full-file' && `Tier 3 (${res.confidence}%)`}
                            {res.strategy === 'auto-merge' && 'Git Auto'}
                          </span>
                        </div>
                        {!res.syntaxValid && (
                          <div className="text-yellow-600 text-xs mt-1">
                            ⚠ Syntax validation warning
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
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
            className={cn(
              preview?.hasConflicts && !useAI && 'bg-yellow-600 hover:bg-yellow-700',
              preview?.hasConflicts && useAI && isAIAvailable && 'bg-primary'
            )}
          >
            {isMerging ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {useAI && preview?.hasConflicts && isAIAvailable ? 'AI Resolving...' : 'Merging...'}
              </>
            ) : preview?.hasConflicts && useAI && isAIAvailable ? (
              <>
                <Brain className="h-4 w-4 mr-2" />
                Merge with AI
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

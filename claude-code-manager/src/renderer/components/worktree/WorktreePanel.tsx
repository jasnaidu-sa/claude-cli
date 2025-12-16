import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { GitBranch, Plus, RefreshCw, Clock, ChevronDown, ChevronRight } from 'lucide-react'
import { Button } from '../ui/button'
import { useWorktreeStore } from '@renderer/stores/worktree-store'
import { useSessionStore } from '@renderer/stores/session-store'
import { WorktreeList } from './WorktreeList'
import { CreateWorktreeModal } from './CreateWorktreeModal'
import { cn } from '@renderer/lib/utils'

export function WorktreePanel() {
  const {
    worktreesByRepo,
    staleWorktrees,
    isLoading,
    refreshWorktrees
  } = useWorktreeStore()

  const { sessions } = useSessionStore()

  const [showCreate, setShowCreate] = useState(false)
  const [expandedRepos, setExpandedRepos] = useState<Set<string>>(new Set())

  // Get unique repo paths from sessions
  const repoPaths = useMemo(() => {
    const paths = sessions.map(s => s.projectPath)
    return [...new Set(paths)]
  }, [sessions])

  const handleRefresh = useCallback(() => {
    refreshWorktrees(repoPaths)
  }, [refreshWorktrees, repoPaths])

  // Refresh worktrees on mount, when sessions change, and every 30s
  useEffect(() => {
    handleRefresh()
    const interval = setInterval(handleRefresh, 30000)
    return () => clearInterval(interval)
  }, [handleRefresh])

  const toggleRepo = (repoPath: string) => {
    setExpandedRepos(prev => {
      const next = new Set(prev)
      if (next.has(repoPath)) {
        next.delete(repoPath)
      } else {
        next.add(repoPath)
      }
      return next
    })
  }

  const repoCount = Object.keys(worktreesByRepo).length

  return (
    <div className="flex flex-col h-full border-t border-border">
      {/* Header */}
      <div className="flex items-center justify-between p-2 border-b border-border">
        <div className="flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Worktrees</span>
          {repoCount > 0 && (
            <span className="text-xs text-muted-foreground">({repoCount})</span>
          )}
        </div>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleRefresh}
            disabled={isLoading}
            className="h-6 w-6"
          >
            <RefreshCw className={cn("h-3 w-3", isLoading && "animate-spin")} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShowCreate(true)}
            className="h-6 w-6"
          >
            <Plus className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Stale worktree warning */}
      {staleWorktrees.length > 0 && (
        <div className="p-2 bg-yellow-500/10 border-b border-yellow-500/20 flex items-center gap-2">
          <Clock className="h-3 w-3 text-yellow-500" />
          <span className="text-xs text-yellow-500">
            {staleWorktrees.length} stale worktree{staleWorktrees.length > 1 ? 's' : ''}
          </span>
        </div>
      )}

      {/* Worktree list grouped by repo */}
      <div className="flex-1 overflow-auto">
        {Object.entries(worktreesByRepo).map(([repoPath, worktrees]) => (
          <div key={repoPath} className="border-b border-border last:border-b-0">
            {/* Repo header - collapsible */}
            <div
              className="flex items-center gap-2 p-2 hover:bg-muted/50 cursor-pointer"
              onClick={() => toggleRepo(repoPath)}
            >
              {expandedRepos.has(repoPath) ? (
                <ChevronDown className="h-3 w-3 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-3 w-3 text-muted-foreground" />
              )}
              <span className="text-xs font-medium truncate flex-1">
                {getRepoName(repoPath)}
              </span>
              <span className="text-xs text-muted-foreground">
                {worktrees.length}
              </span>
            </div>

            {/* Worktree items */}
            {expandedRepos.has(repoPath) && (
              <WorktreeList worktrees={worktrees} />
            )}
          </div>
        ))}

        {repoCount === 0 && !isLoading && (
          <div className="p-4 text-center text-sm text-muted-foreground">
            No worktrees found
          </div>
        )}
      </div>

      {/* Create modal */}
      {showCreate && (
        <CreateWorktreeModal onClose={() => setShowCreate(false)} />
      )}
    </div>
  )
}

function getRepoName(repoPath: string): string {
  return repoPath.split(/[/\\]/).pop() || repoPath
}

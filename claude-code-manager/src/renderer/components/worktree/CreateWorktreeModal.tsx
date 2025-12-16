import React, { useState, useEffect } from 'react'
import { X, GitBranch, Loader2, FolderOpen } from 'lucide-react'
import { Button } from '../ui/button'
import { useWorktreeStore } from '@renderer/stores/worktree-store'
import { useSessionStore } from '@renderer/stores/session-store'
import { cn } from '@renderer/lib/utils'
import type { Branch } from '@shared/types/git'

interface CreateWorktreeModalProps {
  onClose: () => void
  defaultRepoPath?: string
}

export function CreateWorktreeModal({ onClose, defaultRepoPath }: CreateWorktreeModalProps) {
  const { createWorktree } = useWorktreeStore()
  const { sessions, addSession } = useSessionStore()

  const [selectedRepo, setSelectedRepo] = useState(defaultRepoPath || '')
  const [branchName, setBranchName] = useState('')
  const [baseBranch, setBaseBranch] = useState('')
  const [branches, setBranches] = useState<Branch[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [startSession, setStartSession] = useState(true)

  // Get unique repos from sessions
  const repos = [...new Set(sessions.map((s) => s.projectPath))]

  // Load branches when repo is selected
  useEffect(() => {
    if (selectedRepo) {
      loadBranches()
    }
  }, [selectedRepo])

  const loadBranches = async () => {
    try {
      const branchList = await window.electron.git.listBranches(selectedRepo)
      setBranches(branchList.filter((b) => !b.isRemote))

      // Find default branch
      const defaultBranch =
        branchList.find((b) => b.isCurrent) ||
        branchList.find((b) => b.name === 'main') ||
        branchList.find((b) => b.name === 'master') ||
        branchList[0]

      if (defaultBranch) {
        setBaseBranch(defaultBranch.name)
      }
    } catch (err) {
      setError('Failed to load branches')
    }
  }

  const handleCreate = async () => {
    if (!selectedRepo || !branchName) return

    setIsLoading(true)
    setError(null)

    try {
      console.log('[CreateWorktree] Starting worktree creation...', { selectedRepo, branchName, baseBranch })

      const worktree = await createWorktree({
        repoPath: selectedRepo,
        branchName,
        baseBranch,
        createBranch: true
      })

      console.log('[CreateWorktree] Worktree result:', worktree)

      if (!worktree) {
        setError('Failed to create worktree - check console for details')
        return
      }

      if (startSession) {
        console.log('[CreateWorktree] Creating session in worktree path:', worktree.path)

        const result = await window.electron.session.create(worktree.path)
        console.log('[CreateWorktree] Session creation result:', result)

        if (result.success && result.session) {
          console.log('[CreateWorktree] Adding session to store:', result.session)
          addSession(result.session)
        } else {
          console.error('[CreateWorktree] Session creation failed:', result.error)
          setError(`Worktree created, but session failed: ${result.error || 'Unknown error'}`)
          return
        }
      }

      onClose()
    } catch (err) {
      console.error('[CreateWorktree] Error:', err)
      setError(err instanceof Error ? err.message : 'Failed to create worktree')
    } finally {
      setIsLoading(false)
    }
  }

  const handleSelectFolder = async () => {
    const result = await window.electron.dialog.selectFolder()
    if (result.success && result.path) {
      setSelectedRepo(result.path)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-card border border-border rounded-lg shadow-xl w-full max-w-md mx-4 animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <GitBranch className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Create Worktree</h2>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Repository selection */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Repository</label>
            {repos.length > 0 ? (
              <div className="space-y-2">
                <select
                  value={selectedRepo}
                  onChange={(e) => setSelectedRepo(e.target.value)}
                  className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">Select a repository...</option>
                  {repos.map((repo) => (
                    <option key={repo} value={repo}>
                      {repo.split(/[/\\]/).pop()}
                    </option>
                  ))}
                </select>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleSelectFolder}
                  className="w-full text-xs"
                >
                  <FolderOpen className="h-3 w-3 mr-2" />
                  Or select another folder
                </Button>
              </div>
            ) : (
              <Button variant="outline" className="w-full" onClick={handleSelectFolder}>
                <FolderOpen className="h-4 w-4 mr-2" />
                Select Repository Folder
              </Button>
            )}
          </div>

          {selectedRepo && (
            <>
              {/* Branch name */}
              <div className="space-y-2">
                <label className="text-sm font-medium">New Branch Name</label>
                <input
                  type="text"
                  value={branchName}
                  onChange={(e) => setBranchName(e.target.value)}
                  placeholder="feature/my-feature"
                  className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  autoFocus
                />
              </div>

              {/* Base branch */}
              {branches.length > 0 && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">Base Branch</label>
                  <select
                    value={baseBranch}
                    onChange={(e) => setBaseBranch(e.target.value)}
                    className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    {branches.map((branch) => (
                      <option key={branch.name} value={branch.name}>
                        {branch.name}
                        {branch.isCurrent ? ' (current)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Start session option */}
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={startSession}
                  onChange={(e) => setStartSession(e.target.checked)}
                  className="rounded border-border"
                />
                Start Claude session immediately
              </label>
            </>
          )}

          {/* Error */}
          {error && (
            <div className="p-2 bg-destructive/10 text-destructive text-sm rounded border border-destructive/20">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 p-4 border-t border-border">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={!selectedRepo || !branchName || isLoading}>
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Creating...
              </>
            ) : (
              'Create Worktree'
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}

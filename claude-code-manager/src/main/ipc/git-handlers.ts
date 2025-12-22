import { ipcMain } from 'electron'
import { gitService } from '../services/git-service'
import { worktreeLifecycleManager } from '../services/worktree-lifecycle-manager'
import type {
  CreateWorktreeOptions,
  MergeStrategy,
  Worktree,
  WorktreeStatus,
  Branch,
  MergePreview,
  MergeResult,
  RemoteStatus,
  ConflictResolutionResult,
  WorktreeLifecycle
} from '@shared/types/git'

export function registerGitHandlers(): void {
  // Worktree operations
  ipcMain.handle('git:list-worktrees', async (_event, repoPath: string) => {
    try {
      return await gitService.listWorktrees(repoPath)
    } catch (error) {
      throw new Error(`Failed to list worktrees: ${String(error)}`)
    }
  })

  ipcMain.handle('git:create-worktree', async (_event, options: CreateWorktreeOptions) => {
    try {
      console.log('[GitHandler] Creating worktree with options:', options)
      const worktree = await gitService.createWorktree(options.repoPath, options.branchName, options.baseBranch)
      console.log('[GitHandler] Worktree created:', worktree)
      return worktree
    } catch (error) {
      console.error('[GitHandler] Error creating worktree:', error)
      throw new Error(`Failed to create worktree: ${String(error)}`)
    }
  })

  ipcMain.handle('git:remove-worktree', async (_event, worktreePath: string, force?: boolean) => {
    try {
      return await gitService.removeWorktree(worktreePath, force)
    } catch (error) {
      throw new Error(`Failed to remove worktree: ${String(error)}`)
    }
  })

  // Status
  ipcMain.handle('git:get-status', async (_event, worktreePath: string) => {
    try {
      return await gitService.getStatus(worktreePath)
    } catch (error) {
      throw new Error(`Failed to get status: ${String(error)}`)
    }
  })

  // Branches
  ipcMain.handle('git:list-branches', async (_event, repoPath: string) => {
    try {
      return await gitService.listBranches(repoPath)
    } catch (error) {
      throw new Error(`Failed to list branches: ${String(error)}`)
    }
  })

  // Merge operations
  ipcMain.handle('git:merge-preview', async (_event, worktreePath: string) => {
    try {
      return await gitService.getMergePreview(worktreePath)
    } catch (error) {
      throw new Error(`Failed to get merge preview: ${String(error)}`)
    }
  })

  ipcMain.handle('git:merge', async (_event, worktreePath: string, strategy: MergeStrategy) => {
    try {
      return await gitService.merge(worktreePath, strategy)
    } catch (error) {
      throw new Error(`Failed to merge: ${String(error)}`)
    }
  })

  ipcMain.handle('git:abort-merge', async (_event, repoPath: string) => {
    try {
      return await gitService.abortMerge(repoPath)
    } catch (error) {
      throw new Error(`Failed to abort merge: ${String(error)}`)
    }
  })

  // Remote operations
  ipcMain.handle('git:pull', async (_event, worktreePath: string) => {
    try {
      return await gitService.pull(worktreePath)
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('git:push', async (_event, worktreePath: string, setUpstream?: boolean) => {
    try {
      return await gitService.push(worktreePath, setUpstream)
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('git:fetch', async (_event, repoPath: string) => {
    try {
      return await gitService.fetch(repoPath)
    } catch (error) {
      throw new Error(`Failed to fetch: ${String(error)}`)
    }
  })

  ipcMain.handle('git:get-remote-status', async (_event, worktreePath: string) => {
    try {
      return await gitService.getRemoteStatus(worktreePath)
    } catch (error) {
      throw new Error(`Failed to get remote status: ${String(error)}`)
    }
  })

  // Stale detection
  ipcMain.handle('git:get-stale-worktrees', async (_event, repoPath: string, daysThreshold?: number) => {
    try {
      return await gitService.getStaleWorktrees(repoPath, daysThreshold ?? 30)
    } catch (error) {
      throw new Error(`Failed to get stale worktrees: ${String(error)}`)
    }
  })

  // AI-powered conflict resolution
  ipcMain.handle(
    'git:merge-with-ai',
    async (
      _event,
      worktreePath: string,
      strategy: MergeStrategy,
      useAI: boolean = true,
      confidenceThreshold: number = 60
    ): Promise<MergeResult & { resolutions?: ConflictResolutionResult[] }> => {
      try {
        console.log('[GitHandler] Merging with AI:', { worktreePath, strategy, useAI, confidenceThreshold })
        const result = await gitService.mergeWithConflictResolution(
          worktreePath,
          strategy,
          useAI,
          confidenceThreshold
        )
        console.log('[GitHandler] Merge result:', result)
        return result
      } catch (error) {
        console.error('[GitHandler] Error merging with AI:', error)
        throw new Error(`Failed to merge with AI: ${String(error)}`)
      }
    }
  )

  // Check AI availability
  ipcMain.handle('git:is-ai-available', async (_event): Promise<boolean> => {
    try {
      return gitService.isAIResolutionAvailable()
    } catch (error) {
      return false
    }
  })

  // Worktree lifecycle management
  ipcMain.handle('git:init-lifecycle-tracking', async (_event, repoPath: string): Promise<void> => {
    try {
      await gitService.initializeLifecycleTracking(repoPath)
    } catch (error) {
      throw new Error(`Failed to initialize lifecycle tracking: ${String(error)}`)
    }
  })

  ipcMain.handle(
    'git:create-managed-worktree',
    async (
      _event,
      repoPath: string,
      branchName: string,
      baseBranch: string | undefined,
      workflowId: string
    ): Promise<Worktree> => {
      try {
        console.log('[GitHandler] Creating managed worktree:', {
          repoPath,
          branchName,
          baseBranch,
          workflowId
        })
        const worktree = await gitService.createManagedWorktree(
          repoPath,
          branchName,
          baseBranch,
          workflowId
        )
        console.log('[GitHandler] Managed worktree created:', worktree)
        return worktree
      } catch (error) {
        console.error('[GitHandler] Error creating managed worktree:', error)
        throw new Error(`Failed to create managed worktree: ${String(error)}`)
      }
    }
  )

  ipcMain.handle(
    'git:cleanup-stale-worktrees',
    async (_event, repoPath: string, dryRun: boolean = false): Promise<string[]> => {
      try {
        return await gitService.cleanupStaleWorktrees(repoPath, dryRun)
      } catch (error) {
        throw new Error(`Failed to cleanup stale worktrees: ${String(error)}`)
      }
    }
  )

  ipcMain.handle('git:get-lifecycle', async (_event, worktreePath: string): Promise<WorktreeLifecycle | null> => {
    try {
      return worktreeLifecycleManager.getLifecycle(worktreePath) ?? null
    } catch (error) {
      throw new Error(`Failed to get lifecycle: ${String(error)}`)
    }
  })

  ipcMain.handle('git:get-all-lifecycles', async (_event): Promise<WorktreeLifecycle[]> => {
    try {
      return worktreeLifecycleManager.getAllLifecycles()
    } catch (error) {
      throw new Error(`Failed to get all lifecycles: ${String(error)}`)
    }
  })

  ipcMain.handle(
    'git:update-lifecycle-status',
    async (_event, worktreePath: string, status: WorktreeLifecycle['status']): Promise<void> => {
      try {
        await worktreeLifecycleManager.updateStatus(worktreePath, status)
      } catch (error) {
        throw new Error(`Failed to update lifecycle status: ${String(error)}`)
      }
    }
  )
}

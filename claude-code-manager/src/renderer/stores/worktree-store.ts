import { create } from 'zustand'
import type { Worktree, WorktreeStatus, MergePreview, MergeResult, MergeStrategy, CreateWorktreeOptions, ConflictResolutionResult, WorktreeLifecycle } from '@shared/types/git'

interface WorktreeState {
  // State
  worktrees: Worktree[]
  worktreesByRepo: Record<string, Worktree[]>  // grouped by parentRepo
  statusByWorktree: Record<string, WorktreeStatus>
  staleWorktrees: Worktree[]
  isLoading: boolean
  error: string | null
  isAIAvailable: boolean | null

  // Actions
  refreshWorktrees: (repoPaths?: string[]) => Promise<void>
  refreshWorktreeStatus: (worktreeId: string) => Promise<void>
  createWorktree: (options: CreateWorktreeOptions) => Promise<Worktree | null>
  removeWorktree: (worktreePath: string, force?: boolean) => Promise<boolean>

  // Merge actions
  getMergePreview: (worktreePath: string) => Promise<MergePreview | null>
  merge: (worktreePath: string, strategy: MergeStrategy) => Promise<MergeResult>
  mergeWithAI: (worktreePath: string, strategy: MergeStrategy, useAI?: boolean, confidenceThreshold?: number) => Promise<MergeResult & { resolutions?: ConflictResolutionResult[] }>
  abortMerge: (repoPath: string) => Promise<void>

  // AI and lifecycle actions
  checkAIAvailability: () => Promise<boolean>
  getLifecycle: (worktreePath: string) => Promise<WorktreeLifecycle | null>
  getAllLifecycles: () => Promise<WorktreeLifecycle[]>
  updateLifecycleStatus: (worktreePath: string, status: WorktreeLifecycle['status']) => Promise<void>

  // Remote actions
  pull: (worktreePath: string) => Promise<{ success: boolean; error?: string }>
  push: (worktreePath: string, setUpstream?: boolean) => Promise<{ success: boolean; error?: string }>
  fetch: (repoPath: string) => Promise<void>

  // Stale detection
  checkStaleWorktrees: (repoPath: string, daysThreshold?: number) => Promise<void>

  // Helpers
  getWorktreeByPath: (path: string) => Worktree | undefined
  getWorktreesByRepo: (repoPath: string) => Worktree[]
  setError: (error: string | null) => void
  setLoading: (loading: boolean) => void
}

export const useWorktreeStore = create<WorktreeState>((set, get) => ({
  // Initial state
  worktrees: [],
  worktreesByRepo: {},
  statusByWorktree: {},
  staleWorktrees: [],
  isLoading: false,
  error: null,
  isAIAvailable: null,

  // Actions
  refreshWorktrees: async (repoPaths?: string[]) => {
    set({ isLoading: true, error: null })
    try {
      // If no repo paths provided, we can't list worktrees
      // In a real app, you'd get this from sessions or a config
      if (!repoPaths || repoPaths.length === 0) {
        set({ worktrees: [], worktreesByRepo: {}, isLoading: false })
        return
      }

      const allWorktrees: Worktree[] = []
      for (const repoPath of repoPaths) {
        try {
          const worktrees = await window.electron.git.listWorktrees(repoPath)
          allWorktrees.push(...worktrees)
        } catch {
          // Ignore errors for individual repos
        }
      }

      // Group worktrees by parent repo
      const worktreesByRepo: Record<string, Worktree[]> = {}
      for (const worktree of allWorktrees) {
        const repo = worktree.parentRepo
        if (!worktreesByRepo[repo]) {
          worktreesByRepo[repo] = []
        }
        worktreesByRepo[repo].push(worktree)
      }

      set({ worktrees: allWorktrees, worktreesByRepo, isLoading: false })

      // Refresh status for all worktrees
      for (const worktree of allWorktrees) {
        get().refreshWorktreeStatus(worktree.id).catch(console.error)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to refresh worktrees'
      set({ error: message, isLoading: false })
    }
  },

  refreshWorktreeStatus: async (worktreeId: string) => {
    try {
      const worktree = get().worktrees.find(w => w.id === worktreeId)
      if (!worktree) {
        return
      }

      const status = await window.electron.git.getStatus(worktree.path)

      set((state) => ({
        statusByWorktree: {
          ...state.statusByWorktree,
          [worktreeId]: { ...status, worktreeId }
        }
      }))
    } catch (error) {
      console.error(`Failed to refresh status for worktree ${worktreeId}:`, error)
    }
  },

  createWorktree: async (options: CreateWorktreeOptions) => {
    set({ isLoading: true, error: null })
    try {
      const worktree = await window.electron.git.createWorktree(options)

      // Add to worktrees list and group by repo
      set((state) => {
        const newWorktrees = [...state.worktrees, worktree]
        const worktreesByRepo = { ...state.worktreesByRepo }
        const repo = worktree.parentRepo
        worktreesByRepo[repo] = [...(worktreesByRepo[repo] || []), worktree]

        return {
          worktrees: newWorktrees,
          worktreesByRepo,
          isLoading: false
        }
      })

      // Refresh status for the new worktree
      get().refreshWorktreeStatus(worktree.id).catch(console.error)

      return worktree
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create worktree'
      set({ error: message, isLoading: false })
      return null
    }
  },

  removeWorktree: async (worktreePath: string, force = false) => {
    set({ isLoading: true, error: null })
    try {
      await window.electron.git.removeWorktree(worktreePath, force)

      // Remove from worktrees list and grouped data
      set((state) => {
        const worktree = state.worktrees.find(w => w.path === worktreePath)
        const newWorktrees = state.worktrees.filter(w => w.path !== worktreePath)

        const worktreesByRepo = { ...state.worktreesByRepo }
        if (worktree) {
          const repo = worktree.parentRepo
          worktreesByRepo[repo] = (worktreesByRepo[repo] || []).filter(w => w.path !== worktreePath)
          if (worktreesByRepo[repo].length === 0) {
            delete worktreesByRepo[repo]
          }
        }

        const statusByWorktree = { ...state.statusByWorktree }
        if (worktree) {
          delete statusByWorktree[worktree.id]
        }

        return {
          worktrees: newWorktrees,
          worktreesByRepo,
          statusByWorktree,
          isLoading: false
        }
      })

      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to remove worktree'
      set({ error: message, isLoading: false })
      return false
    }
  },

  getMergePreview: async (worktreePath: string) => {
    set({ error: null })
    try {
      const preview = await window.electron.git.getMergePreview(worktreePath)
      return preview
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get merge preview'
      set({ error: message })
      return null
    }
  },

  merge: async (worktreePath: string, strategy: MergeStrategy) => {
    set({ isLoading: true, error: null })
    try {
      const result = await window.electron.git.merge(worktreePath, strategy)
      set({ isLoading: false })

      // Refresh status after merge
      const worktree = get().worktrees.find(w => w.path === worktreePath)
      if (worktree) {
        get().refreshWorktreeStatus(worktree.id).catch(console.error)
      }

      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to merge'
      set({ error: message, isLoading: false })
      throw error
    }
  },

  mergeWithAI: async (worktreePath: string, strategy: MergeStrategy, useAI = true, confidenceThreshold = 60) => {
    set({ isLoading: true, error: null })
    try {
      const result = await window.electron.git.mergeWithAI(worktreePath, strategy, useAI, confidenceThreshold)
      set({ isLoading: false })

      // Refresh status after merge
      const worktree = get().worktrees.find(w => w.path === worktreePath)
      if (worktree) {
        get().refreshWorktreeStatus(worktree.id).catch(console.error)
      }

      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to merge with AI'
      set({ error: message, isLoading: false })
      throw error
    }
  },

  abortMerge: async (repoPath: string) => {
    set({ isLoading: true, error: null })
    try {
      await window.electron.git.abortMerge(repoPath)
      set({ isLoading: false })

      // Refresh status for affected worktrees
      const worktrees = get().worktrees.filter(w => w.path === repoPath || w.parentRepo === repoPath)
      for (const worktree of worktrees) {
        get().refreshWorktreeStatus(worktree.id).catch(console.error)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to abort merge'
      set({ error: message, isLoading: false })
      throw error
    }
  },

  pull: async (worktreePath: string) => {
    set({ error: null })
    try {
      const result = await window.electron.git.pull(worktreePath)

      // Refresh status after pull
      const worktree = get().worktrees.find(w => w.path === worktreePath)
      if (worktree) {
        get().refreshWorktreeStatus(worktree.id).catch(console.error)
      }

      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to pull'
      set({ error: message })
      return { success: false, error: message }
    }
  },

  push: async (worktreePath: string, setUpstream = false) => {
    set({ error: null })
    try {
      const result = await window.electron.git.push(worktreePath, setUpstream)

      // Refresh status after push
      const worktree = get().worktrees.find(w => w.path === worktreePath)
      if (worktree) {
        get().refreshWorktreeStatus(worktree.id).catch(console.error)
      }

      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to push'
      set({ error: message })
      return { success: false, error: message }
    }
  },

  fetch: async (repoPath: string) => {
    set({ error: null })
    try {
      await window.electron.git.fetch(repoPath)

      // Refresh status for all worktrees in this repo
      const worktrees = get().worktrees.filter(w => w.parentRepo === repoPath)
      for (const worktree of worktrees) {
        get().refreshWorktreeStatus(worktree.id).catch(console.error)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch'
      set({ error: message })
      throw error
    }
  },

  checkStaleWorktrees: async (repoPath: string, daysThreshold = 30) => {
    set({ error: null })
    try {
      const staleWorktrees = await window.electron.git.getStaleWorktrees(repoPath, daysThreshold)
      set({ staleWorktrees })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to check stale worktrees'
      set({ error: message })
    }
  },

  // AI and lifecycle methods
  checkAIAvailability: async () => {
    try {
      const isAvailable = await window.electron.git.isAIAvailable()
      set({ isAIAvailable: isAvailable })
      return isAvailable
    } catch (error) {
      set({ isAIAvailable: false })
      return false
    }
  },

  getLifecycle: async (worktreePath: string) => {
    try {
      return await window.electron.git.getLifecycle(worktreePath)
    } catch (error) {
      console.error('Failed to get lifecycle:', error)
      return null
    }
  },

  getAllLifecycles: async () => {
    try {
      return await window.electron.git.getAllLifecycles()
    } catch (error) {
      console.error('Failed to get all lifecycles:', error)
      return []
    }
  },

  updateLifecycleStatus: async (worktreePath: string, status: WorktreeLifecycle['status']) => {
    try {
      await window.electron.git.updateLifecycleStatus(worktreePath, status)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update lifecycle status'
      set({ error: message })
      throw error
    }
  },

  // Helpers
  getWorktreeByPath: (path: string) => {
    return get().worktrees.find(w => w.path === path)
  },

  getWorktreesByRepo: (repoPath: string) => {
    return get().worktreesByRepo[repoPath] || []
  },

  setError: (error: string | null) => set({ error }),

  setLoading: (isLoading: boolean) => set({ isLoading })
}))

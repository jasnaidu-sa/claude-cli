/**
 * Ideas Store
 *
 * Zustand store for managing project ideas from email.
 * Handles loading, caching, and optimistic updates for ideas Kanban.
 */

import { create } from 'zustand'
import type { Idea, IdeaStage, OutlookConfig, ProjectType } from '@shared/types'
import type { CreateIdeaOptions, UpdateIdeaOptions } from '../../preload'

interface OutlookStatus {
  configured: boolean
  authenticated: boolean
  sourceEmail: string | null
  lastSyncAt: number | null
}

interface IdeasState {
  // Ideas data
  ideas: Idea[]
  loading: boolean
  error: string | null

  // Selected idea for detail view/review
  selectedIdeaId: string | null

  // Outlook integration
  outlookStatus: OutlookStatus | null
  outlookConfig: OutlookConfig | null
  syncing: boolean

  // Actions
  loadIdeas: (stage?: IdeaStage) => Promise<void>
  getIdea: (ideaId: string) => Promise<Idea | undefined>
  createIdea: (options: CreateIdeaOptions) => Promise<Idea | undefined>
  updateIdea: (ideaId: string, options: UpdateIdeaOptions) => Promise<Idea | undefined>
  deleteIdea: (ideaId: string) => Promise<boolean>
  moveStage: (ideaId: string, newStage: IdeaStage) => Promise<Idea | undefined>
  addDiscussionMessage: (ideaId: string, role: 'user' | 'assistant', content: string) => Promise<Idea | undefined>
  startProject: (ideaId: string, projectType: ProjectType, projectPath?: string, projectName?: string) => Promise<Idea | undefined>

  // Outlook actions
  configureOutlook: (config: Partial<OutlookConfig>) => Promise<boolean>
  loadOutlookStatus: () => Promise<void>
  authenticateOutlook: () => Promise<boolean>
  syncEmails: () => Promise<number>
  fetchEmails: (options?: { maxResults?: number; sinceDate?: string; onlySinceLastSync?: boolean }) => Promise<number>

  // UI actions
  setSelectedIdea: (ideaId: string | null) => void
  clearError: () => void

  // Computed getters
  getIdeasByStage: (stage: IdeaStage) => Idea[]
  getStats: () => {
    total: number
    byStage: Record<IdeaStage, number>
  }
}

export const useIdeasStore = create<IdeasState>()((set, get) => ({
  // Initial state
  ideas: [],
  loading: false,
  error: null,
  selectedIdeaId: null,
  outlookStatus: null,
  outlookConfig: null,
  syncing: false,

  // Load ideas from backend
  loadIdeas: async (stage?: IdeaStage) => {
    set({ loading: true, error: null })
    try {
      const result = await window.electron.ideas.list(stage)
      if (result.success && result.ideas) {
        set({ ideas: result.ideas, loading: false })
      } else {
        set({ error: result.error || 'Failed to load ideas', loading: false })
      }
    } catch (err) {
      set({ error: String(err), loading: false })
    }
  },

  // Get single idea
  getIdea: async (ideaId: string) => {
    try {
      const result = await window.electron.ideas.get(ideaId)
      if (result.success && result.idea) {
        // Update local cache
        set((state) => ({
          ideas: state.ideas.map((i) => (i.id === ideaId ? result.idea! : i))
        }))
        return result.idea
      }
    } catch (err) {
      set({ error: String(err) })
    }
    return undefined
  },

  // Create new idea
  createIdea: async (options: CreateIdeaOptions) => {
    try {
      const result = await window.electron.ideas.create(options)
      if (result.success && result.idea) {
        set((state) => ({
          ideas: [result.idea!, ...state.ideas]
        }))
        return result.idea
      } else {
        set({ error: result.error || 'Failed to create idea' })
      }
    } catch (err) {
      set({ error: String(err) })
    }
    return undefined
  },

  // Update idea
  updateIdea: async (ideaId: string, options: UpdateIdeaOptions) => {
    try {
      const result = await window.electron.ideas.update(ideaId, options)
      if (result.success && result.idea) {
        set((state) => ({
          ideas: state.ideas.map((i) => (i.id === ideaId ? result.idea! : i))
        }))
        return result.idea
      } else {
        set({ error: result.error || 'Failed to update idea' })
      }
    } catch (err) {
      set({ error: String(err) })
    }
    return undefined
  },

  // Delete idea
  deleteIdea: async (ideaId: string) => {
    try {
      const result = await window.electron.ideas.delete(ideaId)
      if (result.success) {
        set((state) => ({
          ideas: state.ideas.filter((i) => i.id !== ideaId),
          selectedIdeaId: state.selectedIdeaId === ideaId ? null : state.selectedIdeaId
        }))
        return true
      } else {
        set({ error: result.error || 'Failed to delete idea' })
      }
    } catch (err) {
      set({ error: String(err) })
    }
    return false
  },

  // Move idea to new stage
  moveStage: async (ideaId: string, newStage: IdeaStage) => {
    // Optimistic update
    const previousIdeas = get().ideas
    set((state) => ({
      ideas: state.ideas.map((i) =>
        i.id === ideaId ? { ...i, stage: newStage, updatedAt: Date.now() } : i
      )
    }))

    try {
      const result = await window.electron.ideas.moveStage(ideaId, newStage)
      if (result.success && result.idea) {
        set((state) => ({
          ideas: state.ideas.map((i) => (i.id === ideaId ? result.idea! : i))
        }))
        return result.idea
      } else {
        // Rollback on failure
        set({ ideas: previousIdeas, error: result.error || 'Failed to move idea' })
      }
    } catch (err) {
      set({ ideas: previousIdeas, error: String(err) })
    }
    return undefined
  },

  // Add discussion message
  addDiscussionMessage: async (ideaId: string, role: 'user' | 'assistant', content: string) => {
    try {
      const result = await window.electron.ideas.addDiscussion(ideaId, role, content)
      if (result.success && result.idea) {
        set((state) => ({
          ideas: state.ideas.map((i) => (i.id === ideaId ? result.idea! : i))
        }))
        return result.idea
      } else {
        set({ error: result.error || 'Failed to add discussion message' })
      }
    } catch (err) {
      set({ error: String(err) })
    }
    return undefined
  },

  // Start project from idea
  startProject: async (ideaId: string, projectType: ProjectType, projectPath?: string, projectName?: string) => {
    try {
      const result = await window.electron.ideas.startProject(ideaId, projectType, projectPath, projectName)
      if (result.success && result.idea) {
        set((state) => ({
          ideas: state.ideas.map((i) => (i.id === ideaId ? result.idea! : i))
        }))
        return result.idea
      } else {
        set({ error: result.error || 'Failed to start project' })
      }
    } catch (err) {
      set({ error: String(err) })
    }
    return undefined
  },

  // Outlook: Configure
  configureOutlook: async (config: Partial<OutlookConfig>) => {
    try {
      const result = await window.electron.outlook.configure(config)
      if (result.success) {
        await get().loadOutlookStatus()
        return true
      } else {
        set({ error: result.error || 'Failed to configure Outlook' })
      }
    } catch (err) {
      set({ error: String(err) })
    }
    return false
  },

  // Outlook: Load status
  loadOutlookStatus: async () => {
    try {
      const [statusResult, configResult] = await Promise.all([
        window.electron.outlook.getStatus(),
        window.electron.outlook.getConfig()
      ])

      if (statusResult.success && statusResult.status) {
        set({ outlookStatus: statusResult.status })
      }
      if (configResult.success && configResult.config) {
        set({ outlookConfig: configResult.config })
      }
    } catch (err) {
      console.error('Failed to load Outlook status:', err)
    }
  },

  // Outlook: Authenticate
  authenticateOutlook: async () => {
    try {
      const result = await window.electron.outlook.authenticate()
      if (result.success) {
        await get().loadOutlookStatus()
        return true
      } else {
        set({ error: result.error || 'Failed to authenticate with Outlook' })
      }
    } catch (err) {
      set({ error: String(err) })
    }
    return false
  },

  // Outlook: Sync emails (only since last sync)
  syncEmails: async () => {
    set({ syncing: true, error: null })
    try {
      const result = await window.electron.outlook.sync()
      if (result.success) {
        // Reload ideas to get the new ones
        await get().loadIdeas()
        set({ syncing: false })
        return result.count || 0
      } else {
        set({ error: result.error || 'Failed to sync emails', syncing: false })
      }
    } catch (err) {
      set({ error: String(err), syncing: false })
    }
    return 0
  },

  // Outlook: Fetch emails with options
  fetchEmails: async (options) => {
    set({ syncing: true, error: null })
    try {
      const result = await window.electron.outlook.fetchEmails(options)
      if (result.success) {
        // Reload ideas to get the new ones
        await get().loadIdeas()
        set({ syncing: false })
        return result.count || 0
      } else {
        set({ error: result.error || 'Failed to fetch emails', syncing: false })
      }
    } catch (err) {
      set({ error: String(err), syncing: false })
    }
    return 0
  },

  // UI: Set selected idea
  setSelectedIdea: (ideaId: string | null) => {
    set({ selectedIdeaId: ideaId })
  },

  // UI: Clear error
  clearError: () => {
    set({ error: null })
  },

  // Computed: Get ideas by stage
  getIdeasByStage: (stage: IdeaStage) => {
    return get().ideas.filter((i) => i.stage === stage)
  },

  // Computed: Get stats
  getStats: () => {
    const ideas = get().ideas
    const byStage: Record<IdeaStage, number> = {
      inbox: 0,
      pending: 0,
      review: 0,
      approved: 0,
      in_progress: 0,
      completed: 0
    }

    for (const idea of ideas) {
      byStage[idea.stage]++
    }

    return {
      total: ideas.length,
      byStage
    }
  }
}))

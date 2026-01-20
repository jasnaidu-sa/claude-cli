import { create } from 'zustand'
import { apiClient } from '../api/client'
import type { Idea, IdeaStage } from '../types'

interface IdeasState {
  ideas: Idea[]
  selectedIdea: Idea | null
  isLoading: boolean
  isSyncing: boolean
  error: string | null
  lastSync: number | null

  // Actions
  loadIdeas: (stage?: IdeaStage) => Promise<void>
  getIdea: (ideaId: string) => Promise<void>
  moveIdea: (ideaId: string, newStage: IdeaStage) => Promise<boolean>
  addDiscussion: (ideaId: string, content: string) => Promise<boolean>
  selectIdea: (idea: Idea | null) => void
  syncIdeas: () => Promise<void>
}

export const useIdeasStore = create<IdeasState>((set, get) => ({
  ideas: [],
  selectedIdea: null,
  isLoading: false,
  isSyncing: false,
  error: null,
  lastSync: null,

  loadIdeas: async (stage?: IdeaStage) => {
    set({ isLoading: true, error: null })

    try {
      const result = await apiClient.ideas.list(stage)

      if (result.success && result.data) {
        set({
          ideas: result.data,
          isLoading: false,
          lastSync: Date.now(),
        })
      } else {
        set({
          error: result.error || 'Failed to load ideas',
          isLoading: false,
        })
      }
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to load ideas',
        isLoading: false,
      })
    }
  },

  getIdea: async (ideaId: string) => {
    try {
      const result = await apiClient.ideas.get(ideaId)

      if (result.success && result.data) {
        set({ selectedIdea: result.data })

        // Also update in the ideas list
        set(state => ({
          ideas: state.ideas.map(i =>
            i.id === ideaId ? result.data! : i
          ),
        }))
      }
    } catch (error) {
      console.error('Failed to get idea:', error)
    }
  },

  moveIdea: async (ideaId: string, newStage: IdeaStage) => {
    // Optimistic update
    set(state => ({
      ideas: state.ideas.map(idea =>
        idea.id === ideaId ? { ...idea, stage: newStage } : idea
      ),
      selectedIdea: state.selectedIdea?.id === ideaId
        ? { ...state.selectedIdea, stage: newStage }
        : state.selectedIdea,
    }))

    try {
      const result = await apiClient.ideas.moveStage(ideaId, newStage)

      if (!result.success) {
        // Revert on failure - reload ideas
        get().loadIdeas()
        set({ error: result.error || 'Failed to move idea' })
        return false
      }

      return true
    } catch (error) {
      get().loadIdeas()
      set({ error: error instanceof Error ? error.message : 'Failed to move idea' })
      return false
    }
  },

  addDiscussion: async (ideaId: string, content: string) => {
    try {
      const result = await apiClient.ideas.addDiscussion(ideaId, 'user', content)

      if (result.success && result.data) {
        // Update the idea in our state
        set(state => ({
          ideas: state.ideas.map(i =>
            i.id === ideaId ? result.data! : i
          ),
          selectedIdea: state.selectedIdea?.id === ideaId
            ? result.data!
            : state.selectedIdea,
        }))
        return true
      } else {
        set({ error: result.error || 'Failed to add discussion' })
        return false
      }
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to add discussion' })
      return false
    }
  },

  selectIdea: (idea: Idea | null) => {
    set({ selectedIdea: idea })
  },

  syncIdeas: async () => {
    const { lastSync } = get()
    if (!lastSync) {
      return get().loadIdeas()
    }

    set({ isSyncing: true })

    try {
      const result = await apiClient.sync.delta(lastSync)

      if (result.success && result.data) {
        set(state => {
          // Remove deleted ideas
          let updatedIdeas = state.ideas.filter(
            i => !result.data!.ideas.deleted.includes(i.id)
          )

          // Update or add updated ideas
          for (const updated of result.data!.ideas.updated) {
            const index = updatedIdeas.findIndex(i => i.id === updated.id)
            if (index >= 0) {
              updatedIdeas[index] = updated
            } else {
              updatedIdeas.push(updated)
            }
          }

          return {
            ideas: updatedIdeas,
            lastSync: Date.now(),
            isSyncing: false,
          }
        })
      } else {
        set({ isSyncing: false })
      }
    } catch (error) {
      set({ isSyncing: false })
      console.error('Failed to sync ideas:', error)
    }
  },
}))

// Helper function to group ideas by stage
export function groupIdeasByStage(ideas: Idea[]): Record<IdeaStage, Idea[]> {
  const stages: IdeaStage[] = ['inbox', 'reviewing', 'planning', 'ready', 'in_progress', 'done', 'archived']

  return stages.reduce((acc, stage) => {
    acc[stage] = ideas.filter(idea => idea.stage === stage)
    return acc
  }, {} as Record<IdeaStage, Idea[]>)
}

// Helper function to get stage info
export function getStageInfo(stage: IdeaStage): { label: string; color: string } {
  const stages: Record<IdeaStage, { label: string; color: string }> = {
    inbox: { label: 'Inbox', color: '#6b7280' },
    reviewing: { label: 'Reviewing', color: '#3b82f6' },
    planning: { label: 'Planning', color: '#8b5cf6' },
    ready: { label: 'Ready', color: '#22c55e' },
    in_progress: { label: 'In Progress', color: '#f59e0b' },
    done: { label: 'Done', color: '#10b981' },
    archived: { label: 'Archived', color: '#4b5563' },
  }

  return stages[stage] || { label: stage, color: '#666' }
}

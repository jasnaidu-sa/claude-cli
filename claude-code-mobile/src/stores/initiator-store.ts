import { create } from 'zustand'
import { apiClient, type InitiatorSession, type InitiatorMessage } from '../api/client'

interface InitiatorState {
  // Current session
  session: InitiatorSession | null
  isLoading: boolean
  isSending: boolean
  error: string | null

  // Generated prompt
  generatedPrompt: string | null
  requirements: string[]

  // Actions
  startSession: (projectPath: string) => Promise<boolean>
  sendMessage: (message: string) => Promise<boolean>
  generatePrompt: () => Promise<boolean>
  approveAndStart: (prompt: string) => Promise<string | null>
  clearSession: () => void
  subscribeToEvents: () => () => void
}

export const useInitiatorStore = create<InitiatorState>((set, get) => ({
  session: null,
  isLoading: false,
  isSending: false,
  error: null,
  generatedPrompt: null,
  requirements: [],

  startSession: async (projectPath: string) => {
    set({ isLoading: true, error: null })

    try {
      const result = await apiClient.initiator.start(projectPath)

      if (result.success && result.data) {
        set({
          session: result.data,
          isLoading: false,
          generatedPrompt: null,
          requirements: [],
        })
        return true
      } else {
        set({
          error: result.error || 'Failed to start initiator session',
          isLoading: false,
        })
        return false
      }
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to start session',
        isLoading: false,
      })
      return false
    }
  },

  sendMessage: async (message: string) => {
    const { session } = get()
    if (!session) {
      set({ error: 'No active session' })
      return false
    }

    set({ isSending: true, error: null })

    try {
      const result = await apiClient.initiator.sendMessage(session.id, message)

      if (result.success && result.data) {
        // Add user message immediately
        const userMessage: InitiatorMessage = {
          id: `user-${Date.now()}`,
          role: 'user',
          content: message,
          timestamp: Date.now(),
        }

        set(state => ({
          session: state.session ? {
            ...state.session,
            messages: [...state.session.messages, userMessage, result.data!],
          } : null,
          isSending: false,
        }))
        return true
      } else {
        set({
          error: result.error || 'Failed to send message',
          isSending: false,
        })
        return false
      }
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to send message',
        isSending: false,
      })
      return false
    }
  },

  generatePrompt: async () => {
    const { session } = get()
    if (!session) {
      set({ error: 'No active session' })
      return false
    }

    set({ isLoading: true, error: null })

    try {
      const result = await apiClient.initiator.generatePrompt(session.id)

      if (result.success && result.data) {
        set({
          generatedPrompt: result.data.prompt,
          requirements: result.data.requirements,
          isLoading: false,
          session: { ...session, status: 'ready' },
        })
        return true
      } else {
        set({
          error: result.error || 'Failed to generate prompt',
          isLoading: false,
        })
        return false
      }
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to generate prompt',
        isLoading: false,
      })
      return false
    }
  },

  approveAndStart: async (prompt: string) => {
    const { session } = get()
    if (!session) {
      set({ error: 'No active session' })
      return null
    }

    set({ isLoading: true, error: null })

    try {
      const result = await apiClient.initiator.approveAndStart(session.id, prompt)

      if (result.success && result.data) {
        set({
          session: { ...session, status: 'started' },
          isLoading: false,
        })
        return result.data.ralphSessionId
      } else {
        set({
          error: result.error || 'Failed to start session',
          isLoading: false,
        })
        return null
      }
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to start session',
        isLoading: false,
      })
      return null
    }
  },

  clearSession: () => {
    set({
      session: null,
      isLoading: false,
      isSending: false,
      error: null,
      generatedPrompt: null,
      requirements: [],
    })
  },

  subscribeToEvents: () => {
    const unsubMessage = apiClient.initiator.onMessage((data) => {
      set(state => {
        if (state.session?.id === data.sessionId) {
          return {
            session: {
              ...state.session,
              messages: [...state.session.messages, data.message],
            },
          }
        }
        return state
      })
    })

    const unsubRequirements = apiClient.initiator.onRequirementsUpdate((data) => {
      set(state => {
        if (state.session?.id === data.sessionId) {
          return {
            requirements: data.requirements,
          }
        }
        return state
      })
    })

    return () => {
      unsubMessage()
      unsubRequirements()
    }
  },
}))

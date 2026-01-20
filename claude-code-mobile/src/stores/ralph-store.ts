import { create } from 'zustand'
import { apiClient } from '../api/client'
import type { RalphSession, RalphCheckpoint, RalphProgressEvent } from '../types'

interface RalphState {
  sessions: RalphSession[]
  activeSession: RalphSession | null
  pendingCheckpoints: RalphCheckpoint[]
  isLoading: boolean
  error: string | null

  // Actions
  loadSessions: () => Promise<void>
  selectSession: (sessionId: string) => void
  pauseSession: (sessionId: string) => Promise<void>
  resumeSession: (sessionId: string) => Promise<void>
  stopSession: (sessionId: string) => Promise<void>
  approveCheckpoint: (sessionId: string, checkpointId: string, comment?: string) => Promise<void>
  skipCheckpoint: (sessionId: string, checkpointId: string, comment?: string) => Promise<void>
  rejectCheckpoint: (sessionId: string, checkpointId: string, comment?: string) => Promise<void>
  subscribeToEvents: () => () => void
}

export const useRalphStore = create<RalphState>((set, get) => ({
  sessions: [],
  activeSession: null,
  pendingCheckpoints: [],
  isLoading: false,
  error: null,

  loadSessions: async () => {
    set({ isLoading: true, error: null })

    try {
      const result = await apiClient.ralph.getAllSessions()

      if (result.success && result.data) {
        set({ sessions: result.data, isLoading: false })

        // Auto-select first running session
        const runningSession = result.data.find(s => s.status === 'running')
        if (runningSession) {
          set({ activeSession: runningSession })
        }
      } else {
        set({ error: result.error || 'Failed to load sessions', isLoading: false })
      }
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to load sessions',
        isLoading: false,
      })
    }
  },

  selectSession: (sessionId: string) => {
    const session = get().sessions.find(s => s.id === sessionId)
    if (session) {
      set({ activeSession: session })
    }
  },

  pauseSession: async (sessionId: string) => {
    const result = await apiClient.ralph.pause(sessionId)
    if (!result.success) {
      set({ error: result.error || 'Failed to pause session' })
    }
  },

  resumeSession: async (sessionId: string) => {
    const result = await apiClient.ralph.resume(sessionId)
    if (!result.success) {
      set({ error: result.error || 'Failed to resume session' })
    }
  },

  stopSession: async (sessionId: string) => {
    const result = await apiClient.ralph.stop(sessionId)
    if (!result.success) {
      set({ error: result.error || 'Failed to stop session' })
    }
  },

  approveCheckpoint: async (sessionId: string, checkpointId: string, comment?: string) => {
    const result = await apiClient.ralph.approveCheckpoint(sessionId, checkpointId, comment)
    if (result.success) {
      // Remove checkpoint from pending list
      set(state => ({
        pendingCheckpoints: state.pendingCheckpoints.filter(c => c.id !== checkpointId),
      }))
    } else {
      set({ error: result.error || 'Failed to approve checkpoint' })
    }
  },

  skipCheckpoint: async (sessionId: string, checkpointId: string, comment?: string) => {
    const result = await apiClient.ralph.skipCheckpoint(sessionId, checkpointId, comment)
    if (result.success) {
      set(state => ({
        pendingCheckpoints: state.pendingCheckpoints.filter(c => c.id !== checkpointId),
      }))
    } else {
      set({ error: result.error || 'Failed to skip checkpoint' })
    }
  },

  rejectCheckpoint: async (sessionId: string, checkpointId: string, comment?: string) => {
    const result = await apiClient.ralph.rejectCheckpoint(sessionId, checkpointId, comment)
    if (result.success) {
      set(state => ({
        pendingCheckpoints: state.pendingCheckpoints.filter(c => c.id !== checkpointId),
      }))
    } else {
      set({ error: result.error || 'Failed to reject checkpoint' })
    }
  },

  subscribeToEvents: () => {
    // Subscribe to progress events
    const unsubProgress = apiClient.ralph.onProgress((data: unknown) => {
      const event = data as RalphProgressEvent
      set(state => {
        const sessions = state.sessions.map(s => {
          if (s.id === event.sessionId) {
            return {
              ...s,
              phase: event.phase || s.phase,
              iteration: event.iteration ?? s.iteration,
            }
          }
          return s
        })

        const activeSession = state.activeSession?.id === event.sessionId
          ? sessions.find(s => s.id === event.sessionId) || state.activeSession
          : state.activeSession

        return { sessions, activeSession }
      })
    })

    // Subscribe to checkpoint events
    const unsubCheckpoint = apiClient.ralph.onCheckpoint((data) => {
      const checkpoint = data.data as RalphCheckpoint
      set(state => ({
        pendingCheckpoints: [...state.pendingCheckpoints, checkpoint],
      }))
    })

    // Subscribe to status events
    const unsubStatus = apiClient.ralph.onStatus((data: unknown) => {
      const status = data as { sessionId: string; status: string; phase: string }
      set(state => {
        const sessions = state.sessions.map(s => {
          if (s.id === status.sessionId) {
            return {
              ...s,
              status: status.status as RalphSession['status'],
            }
          }
          return s
        })

        const activeSession = state.activeSession?.id === status.sessionId
          ? sessions.find(s => s.id === status.sessionId) || state.activeSession
          : state.activeSession

        return { sessions, activeSession }
      })
    })

    // Return cleanup function
    return () => {
      unsubProgress()
      unsubCheckpoint()
      unsubStatus()
    }
  },
}))

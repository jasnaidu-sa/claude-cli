import { create } from 'zustand'
import type { Session, EditedFile } from '@shared/types'

interface SessionState {
  sessions: Session[]
  activeSessionId: string | null
  isLoading: boolean

  // Actions
  setSessions: (sessions: Session[]) => void
  addSession: (session: Session) => void
  removeSession: (sessionId: string) => void
  updateSessionStatus: (sessionId: string, status: Session['status'], editedFiles?: EditedFile[]) => void
  setActiveSession: (sessionId: string | null) => void
  setLoading: (loading: boolean) => void

  // Computed
  getActiveSession: () => Session | undefined
}

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  isLoading: false,

  setSessions: (sessions) => set({ sessions }),

  addSession: (session) => {
    console.log('[SessionStore] Adding session:', session)
    set((state) => {
      console.log('[SessionStore] Current sessions before add:', state.sessions.length)
      return {
        sessions: [...state.sessions, session],
        activeSessionId: session.id
      }
    })
  },

  removeSession: (sessionId) =>
    set((state) => {
      const newSessions = state.sessions.filter((s) => s.id !== sessionId)
      const newActiveId =
        state.activeSessionId === sessionId
          ? newSessions[0]?.id || null
          : state.activeSessionId
      return {
        sessions: newSessions,
        activeSessionId: newActiveId
      }
    }),

  updateSessionStatus: (sessionId, status, editedFiles) =>
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === sessionId
          ? {
              ...s,
              status,
              editedFiles: editedFiles || s.editedFiles
            }
          : s
      )
    })),

  setActiveSession: (sessionId) => set({ activeSessionId: sessionId }),

  setLoading: (isLoading) => set({ isLoading }),

  getActiveSession: () => {
    const state = get()
    return state.sessions.find((s) => s.id === state.activeSessionId)
  }
}))

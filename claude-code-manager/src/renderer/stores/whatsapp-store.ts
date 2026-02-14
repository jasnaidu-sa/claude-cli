/**
 * WhatsApp Store
 *
 * Zustand store for WhatsApp AI Assistant state management.
 * Handles connection, conversations, messages, agent streaming,
 * tasks, heartbeat, memory stats, and UI state.
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  WhatsAppConnectionState,
  WhatsAppMessage,
  WhatsAppConversation,
  WhatsAppAgentMode,
  ScheduledTask,
  HeartbeatResult,
} from '@shared/whatsapp-types'

const LOG = '[WhatsAppStore]'

interface WhatsAppStore {
  // Connection
  connectionState: WhatsAppConnectionState
  setConnectionState: (state: WhatsAppConnectionState) => void

  // Conversations
  conversations: WhatsAppConversation[]
  activeConversationJid: string | null
  setConversations: (convos: WhatsAppConversation[]) => void
  setActiveConversation: (jid: string | null) => void
  updateConversation: (jid: string, updates: Partial<WhatsAppConversation>) => void

  // Messages
  messages: Record<string, WhatsAppMessage[]>
  setMessages: (jid: string, msgs: WhatsAppMessage[]) => void
  addMessage: (jid: string, msg: WhatsAppMessage) => void

  // Agent streaming
  agentStreaming: Record<string, boolean>
  agentStreamText: Record<string, string>
  setAgentStreaming: (jid: string, streaming: boolean) => void
  appendAgentStreamText: (jid: string, chunk: string) => void
  clearAgentStreamText: (jid: string) => void

  // Tasks
  tasks: ScheduledTask[]
  setTasks: (tasks: ScheduledTask[]) => void

  // Heartbeat
  heartbeatRunning: boolean
  lastHeartbeatResult: HeartbeatResult | null
  setHeartbeatRunning: (running: boolean) => void
  setLastHeartbeatResult: (result: HeartbeatResult) => void

  // Memory
  memoryStats: { totalChunks: number; totalSources: number; dbSizeBytes: number } | null
  setMemoryStats: (stats: { totalChunks: number; totalSources: number; dbSizeBytes: number } | null) => void

  // UI
  showQrModal: boolean
  showSettings: boolean
  setShowQrModal: (show: boolean) => void
  setShowSettings: (show: boolean) => void

  // Actions (call preload API + update store)
  connect: () => Promise<void>
  disconnect: () => Promise<void>
  sendMessage: (jid: string, text: string) => Promise<void>
  loadConversations: () => Promise<void>
  loadMessages: (jid: string) => Promise<void>
  loadTasks: () => Promise<void>
  loadHeartbeatStatus: () => Promise<void>
  loadMemoryStats: () => Promise<void>
  registerConversation: (jid: string, config: Partial<WhatsAppConversation>) => Promise<void>

  // IPC listener setup / teardown
  initListeners: () => () => void
}

export const useWhatsAppStore = create<WhatsAppStore>()(
  persist(
    (set, get) => ({
      // ------------------------------------------------------------------
      // Initial state
      // ------------------------------------------------------------------
      connectionState: {
        status: 'disconnected',
        reconnectAttempt: 0,
      },
      conversations: [],
      activeConversationJid: null,
      messages: {},
      agentStreaming: {},
      agentStreamText: {},
      tasks: [],
      heartbeatRunning: false,
      lastHeartbeatResult: null,
      memoryStats: null,
      showQrModal: false,
      showSettings: false,

      // ------------------------------------------------------------------
      // Setters
      // ------------------------------------------------------------------
      setConnectionState: (connectionState) => set({ connectionState }),

      setConversations: (conversations) => set({ conversations }),

      setActiveConversation: (activeConversationJid) => set({ activeConversationJid }),

      updateConversation: (jid, updates) =>
        set((state) => ({
          conversations: state.conversations.map((c) =>
            c.jid === jid ? { ...c, ...updates } : c
          ),
        })),

      setMessages: (jid, msgs) =>
        set((state) => ({
          messages: { ...state.messages, [jid]: msgs },
        })),

      addMessage: (jid, msg) =>
        set((state) => {
          const existing = state.messages[jid] || []
          // Avoid duplicates
          if (existing.some((m) => m.id === msg.id)) return state
          return {
            messages: { ...state.messages, [jid]: [...existing, msg] },
          }
        }),

      setAgentStreaming: (jid, streaming) =>
        set((state) => ({
          agentStreaming: { ...state.agentStreaming, [jid]: streaming },
        })),

      appendAgentStreamText: (jid, chunk) =>
        set((state) => ({
          agentStreamText: {
            ...state.agentStreamText,
            [jid]: (state.agentStreamText[jid] || '') + chunk,
          },
        })),

      clearAgentStreamText: (jid) =>
        set((state) => ({
          agentStreamText: { ...state.agentStreamText, [jid]: '' },
        })),

      setTasks: (tasks) => set({ tasks }),

      setHeartbeatRunning: (heartbeatRunning) => set({ heartbeatRunning }),

      setLastHeartbeatResult: (lastHeartbeatResult) => set({ lastHeartbeatResult }),

      setMemoryStats: (memoryStats) => set({ memoryStats }),

      setShowQrModal: (showQrModal) => set({ showQrModal }),

      setShowSettings: (showSettings) => set({ showSettings }),

      // ------------------------------------------------------------------
      // Async actions (call preload API then update store)
      // ------------------------------------------------------------------

      connect: async () => {
        try {
          console.log(LOG, 'Connecting...')
          // Show QR modal immediately so user can see status
          set({ showQrModal: true })
          const result = await window.electron.whatsapp.connect()
          if (!result.success) {
            console.error(LOG, 'Connect failed:', result.error)
          }
          // Fetch current state (may already have QR code from auto-connect)
          const statusResult = await window.electron.whatsapp.getStatus()
          if (statusResult.success && statusResult.data) {
            set({ connectionState: statusResult.data })
          }
        } catch (err) {
          console.error(LOG, 'Connect error:', err)
        }
      },

      disconnect: async () => {
        try {
          console.log(LOG, 'Disconnecting...')
          const result = await window.electron.whatsapp.disconnect()
          if (!result.success) {
            console.error(LOG, 'Disconnect failed:', result.error)
          }
        } catch (err) {
          console.error(LOG, 'Disconnect error:', err)
        }
      },

      sendMessage: async (jid: string, text: string) => {
        try {
          const result = await window.electron.whatsapp.sendMessage(jid, text)
          if (result.success && result.data) {
            get().addMessage(jid, result.data)
          }
        } catch (err) {
          console.error(LOG, 'Send message error:', err)
        }
      },

      loadConversations: async () => {
        try {
          const result = await window.electron.whatsapp.listConversations()
          if (result.success && result.data) {
            set({ conversations: result.data })
          }
        } catch (err) {
          console.error(LOG, 'Load conversations error:', err)
        }
      },

      loadMessages: async (jid: string) => {
        try {
          const result = await window.electron.whatsapp.getMessages(jid)
          if (result.success && result.data) {
            const msgs = result.data
            set((state) => ({
              messages: { ...state.messages, [jid]: msgs },
            }))
          }
        } catch (err) {
          console.error(LOG, 'Load messages error:', err)
        }
      },

      loadTasks: async () => {
        try {
          const result = await window.electron.whatsapp.taskList()
          if (result.success && result.data) {
            const tasks = result.data as ScheduledTask[]
            set({ tasks })
          }
        } catch (err) {
          console.error(LOG, 'Load tasks error:', err)
        }
      },

      loadHeartbeatStatus: async () => {
        try {
          const result = await window.electron.whatsapp.heartbeatStatus()
          if (result.success && result.data) {
            set({
              heartbeatRunning: result.data.running,
              lastHeartbeatResult: result.data.lastResult,
            })
          }
        } catch (err) {
          console.error(LOG, 'Load heartbeat status error:', err)
        }
      },

      loadMemoryStats: async () => {
        try {
          const result = await window.electron.whatsapp.memoryStats()
          if (result.success && result.data) {
            set({ memoryStats: result.data })
          }
        } catch (err) {
          console.error(LOG, 'Load memory stats error:', err)
        }
      },

      registerConversation: async (jid: string, config: Partial<WhatsAppConversation>) => {
        try {
          const result = await window.electron.whatsapp.registerConversation(jid, config)
          if (result.success) {
            await get().loadConversations()
          }
        } catch (err) {
          console.error(LOG, 'Register conversation error:', err)
        }
      },

      // ------------------------------------------------------------------
      // IPC Event Listeners
      // ------------------------------------------------------------------

      initListeners: () => {
        const unsubs: Array<() => void> = []

        // Fetch current connection state on mount (may have QR from auto-connect)
        window.electron.whatsapp.getStatus().then((result) => {
          if (result.success && result.data) {
            console.log(LOG, 'Initial status:', result.data.status)
            set({ connectionState: result.data })
            if (result.data.status === 'qr_ready') {
              set({ showQrModal: true })
            }
          }
        }).catch((err) => {
          console.error(LOG, 'Failed to fetch initial status:', err)
        })

        // Connection state changes
        unsubs.push(
          window.electron.whatsapp.onConnectionUpdate((state) => {
            console.log(LOG, 'Connection update:', state.status)
            set({ connectionState: state })

            // Auto-show QR modal when QR is ready
            if (state.status === 'qr_ready') {
              set({ showQrModal: true })
            }
            // Auto-hide QR modal on connect
            if (state.status === 'connected') {
              set({ showQrModal: false })
            }
          })
        )

        // Inbound messages
        unsubs.push(
          window.electron.whatsapp.onMessageReceived((msg) => {
            get().addMessage(msg.conversationJid, msg)
            // Update conversation last message time
            get().updateConversation(msg.conversationJid, {
              lastMessageAt: msg.timestamp,
            })
          })
        )

        // Outbound messages (sent by agent or manually)
        unsubs.push(
          window.electron.whatsapp.onMessageSent((msg) => {
            get().addMessage(msg.conversationJid, msg)
          })
        )

        // Agent streaming
        unsubs.push(
          window.electron.whatsapp.onAgentStream((data) => {
            const { jid, chunk, done } = data as {
              jid: string
              chunk?: string
              done?: boolean
            }
            if (done) {
              get().setAgentStreaming(jid, false)
              get().clearAgentStreamText(jid)
            } else if (chunk) {
              get().setAgentStreaming(jid, true)
              get().appendAgentStreamText(jid, chunk)
            }
          })
        )

        // Heartbeat results
        unsubs.push(
          window.electron.whatsapp.onHeartbeatResult((result) => {
            set({ lastHeartbeatResult: result })
          })
        )

        // Task executed
        unsubs.push(
          window.electron.whatsapp.onTaskExecuted(() => {
            // Reload tasks to get updated state
            get().loadTasks()
          })
        )

        // BVS progress
        unsubs.push(
          window.electron.whatsapp.onBvsProgress((_data) => {
            // BVS progress events can be handled here if needed
          })
        )

        console.log(LOG, 'IPC listeners initialized')

        // Return cleanup function
        return () => {
          unsubs.forEach((unsub) => unsub())
          console.log(LOG, 'IPC listeners cleaned up')
        }
      },
    }),
    {
      name: 'whatsapp-store',
      partialize: (state) => ({
        // Only persist non-transient state
        activeConversationJid: state.activeConversationJid,
      }),
    }
  )
)

import { create } from 'zustand'
import { Platform } from 'react-native'
import { apiClient } from '../api/client'

// Platform-aware secure storage wrapper
// expo-secure-store only works on native platforms, not web
const storage = {
  async getItemAsync(key: string): Promise<string | null> {
    if (Platform.OS === 'web') {
      return localStorage.getItem(key)
    }
    // Dynamic import for native only
    const SecureStore = await import('expo-secure-store')
    return storage.getItemAsync(key)
  },
  async setItemAsync(key: string, value: string): Promise<void> {
    if (Platform.OS === 'web') {
      localStorage.setItem(key, value)
      return
    }
    const SecureStore = await import('expo-secure-store')
    return storage.setItemAsync(key, value)
  },
  async deleteItemAsync(key: string): Promise<void> {
    if (Platform.OS === 'web') {
      localStorage.removeItem(key)
      return
    }
    const SecureStore = await import('expo-secure-store')
    return storage.deleteItemAsync(key)
  }
}

// Offline queue item type
interface QueuedAction {
  id: string
  type: string
  payload: unknown
  createdAt: number
  retryCount: number
}

export type ConnectionQuality = 'excellent' | 'good' | 'fair' | 'poor' | 'offline'

interface ConnectionState {
  serverUrl: string
  authToken: string
  isConnected: boolean
  isConnecting: boolean
  error: string | null
  connectionQuality: ConnectionQuality
  lastPingTime: number | null
  offlineQueue: QueuedAction[]
  isProcessingQueue: boolean

  // Actions
  setServerUrl: (url: string) => void
  setAuthToken: (token: string) => void
  connect: () => Promise<boolean>
  disconnect: () => void
  loadSavedConnection: () => Promise<void>
  clearConnection: () => Promise<void>

  // Offline queue actions
  queueAction: (type: string, payload: unknown) => string
  removeFromQueue: (id: string) => void
  processQueue: () => Promise<void>
  clearQueue: () => void

  // Connection quality
  updateConnectionQuality: (quality: ConnectionQuality) => void
  ping: () => Promise<number | null>
}

const STORAGE_KEYS = {
  SERVER_URL: 'claude_code_server_url',
  AUTH_TOKEN: 'claude_code_auth_token',
  OFFLINE_QUEUE: 'claude_code_offline_queue',
}

// Generate unique ID for queue items
const generateId = (): string => {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  serverUrl: '',
  authToken: '',
  isConnected: false,
  isConnecting: false,
  error: null,
  connectionQuality: 'offline',
  lastPingTime: null,
  offlineQueue: [],
  isProcessingQueue: false,

  setServerUrl: (url: string) => {
    set({ serverUrl: url, error: null })
  },

  setAuthToken: (token: string) => {
    set({ authToken: token, error: null })
  },

  connect: async () => {
    const { serverUrl, authToken } = get()

    if (!serverUrl || !authToken) {
      set({ error: 'Server URL and auth token are required' })
      return false
    }

    set({ isConnecting: true, error: null })

    try {
      // Configure the API client
      apiClient.configure(serverUrl, authToken)

      // Test the connection
      const result = await apiClient.testConnection()

      if (!result.success) {
        set({
          isConnecting: false,
          error: result.error || 'Failed to connect to server',
        })
        return false
      }

      // Connect WebSocket for real-time events
      await apiClient.connectWebSocket()

      // Save credentials securely
      await storage.setItemAsync(STORAGE_KEYS.SERVER_URL, serverUrl)
      await storage.setItemAsync(STORAGE_KEYS.AUTH_TOKEN, authToken)

      set({
        isConnected: true,
        isConnecting: false,
        error: null,
      })

      return true
    } catch (error) {
      set({
        isConnecting: false,
        error: error instanceof Error ? error.message : 'Connection failed',
      })
      return false
    }
  },

  disconnect: () => {
    apiClient.disconnectWebSocket()
    set({
      isConnected: false,
      error: null,
    })
  },

  loadSavedConnection: async () => {
    try {
      const serverUrl = await storage.getItemAsync(STORAGE_KEYS.SERVER_URL)
      const authToken = await storage.getItemAsync(STORAGE_KEYS.AUTH_TOKEN)

      if (serverUrl && authToken) {
        set({ serverUrl, authToken })

        // Auto-connect with saved credentials
        apiClient.configure(serverUrl, authToken)
        const result = await apiClient.testConnection()

        if (result.success) {
          await apiClient.connectWebSocket()
          set({ isConnected: true })
        }
      }
    } catch (error) {
      console.error('Failed to load saved connection:', error)
    }
  },

  clearConnection: async () => {
    apiClient.disconnectWebSocket()

    await storage.deleteItemAsync(STORAGE_KEYS.SERVER_URL)
    await storage.deleteItemAsync(STORAGE_KEYS.AUTH_TOKEN)

    set({
      serverUrl: '',
      authToken: '',
      isConnected: false,
      error: null,
      connectionQuality: 'offline',
    })
  },

  // ============================================================================
  // Offline Queue Management
  // ============================================================================

  queueAction: (type: string, payload: unknown): string => {
    const id = generateId()
    const action: QueuedAction = {
      id,
      type,
      payload,
      createdAt: Date.now(),
      retryCount: 0,
    }

    set((state) => {
      const newQueue = [...state.offlineQueue, action]
      // Persist queue to storage
      storage.setItemAsync(STORAGE_KEYS.OFFLINE_QUEUE, JSON.stringify(newQueue)).catch(console.error)
      return { offlineQueue: newQueue }
    })

    return id
  },

  removeFromQueue: (id: string) => {
    set((state) => {
      const newQueue = state.offlineQueue.filter((a) => a.id !== id)
      storage.setItemAsync(STORAGE_KEYS.OFFLINE_QUEUE, JSON.stringify(newQueue)).catch(console.error)
      return { offlineQueue: newQueue }
    })
  },

  processQueue: async () => {
    const { isConnected, offlineQueue, isProcessingQueue } = get()

    if (!isConnected || isProcessingQueue || offlineQueue.length === 0) {
      return
    }

    set({ isProcessingQueue: true })

    const processedIds: string[] = []
    const failedActions: QueuedAction[] = []

    for (const action of offlineQueue) {
      try {
        // Process different action types
        let success = false
        const payload = action.payload as Record<string, unknown>

        switch (action.type) {
          case 'checkpoint:approve':
            const approveResult = await apiClient.ralph.approveCheckpoint(
              payload.sessionId as string,
              payload.checkpointId as string,
              payload.comment as string | undefined
            )
            success = approveResult.success
            break

          case 'checkpoint:skip':
            const skipResult = await apiClient.ralph.skipCheckpoint(
              payload.sessionId as string,
              payload.checkpointId as string,
              payload.comment as string | undefined
            )
            success = skipResult.success
            break

          case 'checkpoint:reject':
            const rejectResult = await apiClient.ralph.rejectCheckpoint(
              payload.sessionId as string,
              payload.checkpointId as string,
              payload.comment as string | undefined
            )
            success = rejectResult.success
            break

          case 'session:pause':
            const pauseResult = await apiClient.ralph.pause(payload.sessionId as string)
            success = pauseResult.success
            break

          case 'session:resume':
            const resumeResult = await apiClient.ralph.resume(payload.sessionId as string)
            success = resumeResult.success
            break

          case 'idea:move':
            const moveResult = await apiClient.ideas.moveStage(
              payload.ideaId as string,
              payload.stage as 'inbox' | 'reviewing' | 'planning' | 'ready' | 'in_progress' | 'done' | 'archived'
            )
            success = moveResult.success
            break

          default:
            console.warn(`Unknown queued action type: ${action.type}`)
            success = true // Remove unknown actions
        }

        if (success) {
          processedIds.push(action.id)
        } else if (action.retryCount < 3) {
          failedActions.push({ ...action, retryCount: action.retryCount + 1 })
        } else {
          // Max retries reached, remove from queue
          processedIds.push(action.id)
        }
      } catch (error) {
        console.error(`Failed to process queued action ${action.id}:`, error)
        if (action.retryCount < 3) {
          failedActions.push({ ...action, retryCount: action.retryCount + 1 })
        } else {
          processedIds.push(action.id)
        }
      }
    }

    // Update queue with remaining failed actions
    set((state) => {
      const newQueue = state.offlineQueue
        .filter((a) => !processedIds.includes(a.id))
        .map((a) => failedActions.find((f) => f.id === a.id) || a)

      storage.setItemAsync(STORAGE_KEYS.OFFLINE_QUEUE, JSON.stringify(newQueue)).catch(console.error)
      return { offlineQueue: newQueue, isProcessingQueue: false }
    })
  },

  clearQueue: () => {
    storage.deleteItemAsync(STORAGE_KEYS.OFFLINE_QUEUE).catch(console.error)
    set({ offlineQueue: [] })
  },

  // ============================================================================
  // Connection Quality Monitoring
  // ============================================================================

  updateConnectionQuality: (quality: ConnectionQuality) => {
    set({ connectionQuality: quality })
  },

  ping: async (): Promise<number | null> => {
    const startTime = Date.now()

    try {
      const result = await apiClient.testConnection()

      if (result.success) {
        const pingTime = Date.now() - startTime
        let quality: ConnectionQuality = 'excellent'

        if (pingTime > 500) quality = 'poor'
        else if (pingTime > 200) quality = 'good'

        set({
          connectionQuality: quality,
          lastPingTime: pingTime,
          isConnected: true,
        })

        // Process any queued actions now that we're connected
        get().processQueue()

        return pingTime
      } else {
        set({ connectionQuality: 'offline', isConnected: false })
        return null
      }
    } catch {
      set({ connectionQuality: 'offline', isConnected: false })
      return null
    }
  },
}))

// Load offline queue on startup
export async function loadOfflineQueue(): Promise<void> {
  try {
    const queueJson = await storage.getItemAsync(STORAGE_KEYS.OFFLINE_QUEUE)
    if (queueJson) {
      const queue = JSON.parse(queueJson) as QueuedAction[]
      useConnectionStore.setState({ offlineQueue: queue })
    }
  } catch (error) {
    console.error('Failed to load offline queue:', error)
  }
}

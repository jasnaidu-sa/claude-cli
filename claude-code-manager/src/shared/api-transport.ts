/**
 * API Transport Abstraction Layer
 *
 * Provides a unified interface for both IPC (Electron) and HTTP (remote) communication.
 * The renderer/mobile app uses this layer, and it automatically routes to the correct
 * transport based on the connection mode.
 *
 * Usage:
 *   const api = createApiClient()  // Auto-detects mode
 *   await api.ralph.start(config)  // Works in both IPC and HTTP mode
 */

// Connection modes
export type ConnectionMode = 'standalone' | 'server' | 'client'

// API Client configuration
export interface ApiClientConfig {
  mode: ConnectionMode
  serverUrl?: string      // Required for client mode
  authToken?: string      // Required for client mode with auth
}

// Result type for API calls
export interface ApiResult<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

// Event callback types
export type EventCallback<T = unknown> = (data: T) => void
export type UnsubscribeFn = () => void

/**
 * WebSocket client for real-time events in client mode
 */
class WebSocketClient {
  private ws: WebSocket | null = null
  private url: string
  private token?: string
  private listeners: Map<string, Set<EventCallback>> = new Map()
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5
  private reconnectDelay = 1000

  constructor(url: string, token?: string) {
    this.url = url
    this.token = token
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const wsUrl = this.url.replace(/^http/, 'ws')
        const fullUrl = this.token ? `${wsUrl}?token=${this.token}` : wsUrl
        this.ws = new WebSocket(fullUrl)

        this.ws.onopen = () => {
          console.log('[WebSocketClient] Connected')
          this.reconnectAttempts = 0
          resolve()
        }

        this.ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data)
            if (message.channel) {
              this.emit(message.channel, message.data)
            }
          } catch (e) {
            console.error('[WebSocketClient] Failed to parse message:', e)
          }
        }

        this.ws.onclose = () => {
          console.log('[WebSocketClient] Disconnected')
          this.attemptReconnect()
        }

        this.ws.onerror = (error) => {
          console.error('[WebSocketClient] Error:', error)
          reject(error)
        }
      } catch (error) {
        reject(error)
      }
    })
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[WebSocketClient] Max reconnect attempts reached')
      return
    }

    this.reconnectAttempts++
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1)
    console.log(`[WebSocketClient] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`)

    setTimeout(() => {
      this.connect().catch(console.error)
    }, delay)
  }

  on(channel: string, callback: EventCallback): UnsubscribeFn {
    if (!this.listeners.has(channel)) {
      this.listeners.set(channel, new Set())
    }
    this.listeners.get(channel)!.add(callback)

    return () => {
      this.listeners.get(channel)?.delete(callback)
    }
  }

  private emit(channel: string, data: unknown): void {
    const callbacks = this.listeners.get(channel)
    if (callbacks) {
      callbacks.forEach(cb => cb(data))
    }

    // Also emit to wildcard listeners
    const wildcardCallbacks = this.listeners.get('*')
    if (wildcardCallbacks) {
      wildcardCallbacks.forEach(cb => cb({ channel, data }))
    }
  }

  send(message: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message))
    }
  }

  disconnect(): void {
    this.maxReconnectAttempts = 0  // Prevent reconnection
    this.ws?.close()
    this.ws = null
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }
}

/**
 * HTTP Transport - calls remote API server
 */
class HttpTransport {
  private baseUrl: string
  private token?: string
  private wsClient: WebSocketClient

  constructor(baseUrl: string, token?: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '')  // Remove trailing slash
    this.token = token
    this.wsClient = new WebSocketClient(`${this.baseUrl}/ws`, token)
  }

  async connect(): Promise<void> {
    await this.wsClient.connect()
  }

  private async fetch<T>(path: string, options: RequestInit = {}): Promise<ApiResult<T>> {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...options.headers as Record<string, string>
      }

      if (this.token) {
        headers['Authorization'] = `Bearer ${this.token}`
      }

      const response = await fetch(`${this.baseUrl}/api${path}`, {
        ...options,
        headers
      })

      const data = await response.json()
      return data
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  async get<T>(path: string): Promise<ApiResult<T>> {
    return this.fetch<T>(path, { method: 'GET' })
  }

  async post<T>(path: string, body?: unknown): Promise<ApiResult<T>> {
    return this.fetch<T>(path, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined
    })
  }

  async delete<T>(path: string): Promise<ApiResult<T>> {
    return this.fetch<T>(path, { method: 'DELETE' })
  }

  on(channel: string, callback: EventCallback): UnsubscribeFn {
    return this.wsClient.on(channel, callback)
  }

  disconnect(): void {
    this.wsClient.disconnect()
  }
}

/**
 * IPC Transport - uses Electron IPC (when in standalone/server mode)
 */
class IpcTransport {
  // In IPC mode, we use window.electron directly
  // This is just a wrapper for type consistency

  get electron(): typeof window.electron {
    if (typeof window !== 'undefined' && window.electron) {
      return window.electron
    }
    throw new Error('Electron API not available - are you in a browser context?')
  }
}

/**
 * Unified API Client
 *
 * Provides the same interface regardless of transport (IPC or HTTP)
 */
export class ApiClient {
  private config: ApiClientConfig
  private httpTransport?: HttpTransport
  private ipcTransport?: IpcTransport

  constructor(config: ApiClientConfig) {
    this.config = config

    if (config.mode === 'client') {
      if (!config.serverUrl) {
        throw new Error('serverUrl is required in client mode')
      }
      this.httpTransport = new HttpTransport(config.serverUrl, config.authToken)
    } else {
      this.ipcTransport = new IpcTransport()
    }
  }

  /**
   * Connect to remote server (client mode only)
   */
  async connect(): Promise<void> {
    if (this.httpTransport) {
      await this.httpTransport.connect()
    }
  }

  /**
   * Disconnect from remote server
   */
  disconnect(): void {
    this.httpTransport?.disconnect()
  }

  /**
   * Check if using remote connection
   */
  get isRemote(): boolean {
    return this.config.mode === 'client'
  }

  // ============================================================================
  // Session API (Terminal sessions)
  // ============================================================================

  session = {
    create: async (projectPath: string) => {
      if (this.httpTransport) {
        return this.httpTransport.post('/sessions', { projectPath })
      }
      return this.ipcTransport!.electron.session.create(projectPath)
    },

    destroy: async (sessionId: string) => {
      if (this.httpTransport) {
        return this.httpTransport.delete(`/sessions/${sessionId}`)
      }
      return this.ipcTransport!.electron.session.destroy(sessionId)
    },

    list: async () => {
      if (this.httpTransport) {
        const result = await this.httpTransport.get<{ sessions: unknown[] }>('/sessions')
        return result.data?.sessions || []
      }
      return this.ipcTransport!.electron.session.list()
    },

    input: (sessionId: string, data: string) => {
      if (this.httpTransport) {
        this.httpTransport.post(`/sessions/${sessionId}/input`, { data })
        return
      }
      this.ipcTransport!.electron.session.input(sessionId, data)
    },

    resize: (sessionId: string, cols: number, rows: number) => {
      if (this.httpTransport) {
        this.httpTransport.post(`/sessions/${sessionId}/resize`, { cols, rows })
        return
      }
      this.ipcTransport!.electron.session.resize(sessionId, cols, rows)
    },

    onOutput: (callback: EventCallback) => {
      if (this.httpTransport) {
        return this.httpTransport.on('session:output', callback)
      }
      return this.ipcTransport!.electron.session.onOutput(callback as any)
    }
  }

  // ============================================================================
  // Files API
  // ============================================================================

  files = {
    readDir: async (dirPath: string, depth?: number) => {
      if (this.httpTransport) {
        const query = depth !== undefined ? `?path=${encodeURIComponent(dirPath)}&depth=${depth}` : `?path=${encodeURIComponent(dirPath)}`
        return this.httpTransport.get(`/files/read-dir${query}`)
      }
      return this.ipcTransport!.electron.files.readDir(dirPath, depth)
    },

    readFile: async (filePath: string) => {
      if (this.httpTransport) {
        return this.httpTransport.get(`/files/read?path=${encodeURIComponent(filePath)}`)
      }
      return this.ipcTransport!.electron.files.readFile(filePath)
    },

    writeFile: async (filePath: string, content: string) => {
      if (this.httpTransport) {
        return this.httpTransport.post('/files/write', { path: filePath, content })
      }
      return this.ipcTransport!.electron.files.writeFile(filePath, content)
    },

    onChange: (callback: EventCallback) => {
      if (this.httpTransport) {
        return this.httpTransport.on('files:change', callback)
      }
      return this.ipcTransport!.electron.files.onChange(callback as any)
    }
  }

  // ============================================================================
  // Config API
  // ============================================================================

  appConfig = {
    get: async (key?: string) => {
      if (this.httpTransport) {
        const query = key ? `?key=${encodeURIComponent(key)}` : ''
        return this.httpTransport.get(`/config${query}`)
      }
      return this.ipcTransport!.electron.config.get(key as any)
    },

    set: async (key: string, value: unknown) => {
      if (this.httpTransport) {
        return this.httpTransport.post('/config', { key, value })
      }
      return this.ipcTransport!.electron.config.set(key as any, value as any)
    }
  }

  // ============================================================================
  // Ralph Loop API
  // ============================================================================

  ralph = {
    start: async (config: unknown) => {
      if (this.httpTransport) {
        return this.httpTransport.post('/ralph/start', config)
      }
      return this.ipcTransport!.electron.ralph.start(config as any)
    },

    stop: async (sessionId: string) => {
      if (this.httpTransport) {
        return this.httpTransport.post(`/ralph/${sessionId}/stop`)
      }
      return this.ipcTransport!.electron.ralph.stop(sessionId)
    },

    pause: async (sessionId: string) => {
      if (this.httpTransport) {
        return this.httpTransport.post(`/ralph/${sessionId}/pause`)
      }
      return this.ipcTransport!.electron.ralph.pause(sessionId)
    },

    resume: async (sessionId: string) => {
      if (this.httpTransport) {
        return this.httpTransport.post(`/ralph/${sessionId}/resume`)
      }
      return this.ipcTransport!.electron.ralph.resume(sessionId)
    },

    getStatus: async (sessionId: string) => {
      if (this.httpTransport) {
        return this.httpTransport.get(`/ralph/${sessionId}`)
      }
      return this.ipcTransport!.electron.ralph.getStatus(sessionId)
    },

    getAllSessions: async () => {
      if (this.httpTransport) {
        return this.httpTransport.get('/ralph')
      }
      return this.ipcTransport!.electron.ralph.getAllSessions()
    },

    approveCheckpoint: async (sessionId: string, checkpointId: string, comment?: string) => {
      if (this.httpTransport) {
        return this.httpTransport.post(`/ralph/${sessionId}/checkpoint/${checkpointId}/approve`, { comment })
      }
      return this.ipcTransport!.electron.ralph.approveCheckpoint(sessionId, checkpointId, comment)
    },

    skipCheckpoint: async (sessionId: string, checkpointId: string, comment?: string) => {
      if (this.httpTransport) {
        return this.httpTransport.post(`/ralph/${sessionId}/checkpoint/${checkpointId}/skip`, { comment })
      }
      return this.ipcTransport!.electron.ralph.skipCheckpoint(sessionId, checkpointId, comment)
    },

    rejectCheckpoint: async (sessionId: string, checkpointId: string, comment?: string) => {
      if (this.httpTransport) {
        return this.httpTransport.post(`/ralph/${sessionId}/checkpoint/${checkpointId}/reject`, { comment })
      }
      return this.ipcTransport!.electron.ralph.rejectCheckpoint(sessionId, checkpointId, comment)
    },

    // Event subscriptions
    onSessionUpdate: (callback: EventCallback) => {
      if (this.httpTransport) {
        return this.httpTransport.on('ralph:session:update', callback)
      }
      return this.ipcTransport!.electron.ralph.onProgress(callback as any)
    },

    onCheckpointPending: (callback: EventCallback) => {
      if (this.httpTransport) {
        return this.httpTransport.on('ralph:checkpoint:pending', callback)
      }
      return this.ipcTransport!.electron.ralph.onCheckpoint(callback as any)
    }
  }

  // ============================================================================
  // Initiator API
  // ============================================================================

  initiator = {
    start: async (projectPath: string, options?: { forceNew?: boolean }) => {
      if (this.httpTransport) {
        return this.httpTransport.post('/initiator/start', { projectPath, ...options })
      }
      return this.ipcTransport!.electron.initiator.start(projectPath, options)
    },

    sendMessage: async (sessionId: string, content: string, attachmentPaths?: string[]) => {
      if (this.httpTransport) {
        return this.httpTransport.post(`/initiator/${sessionId}/message`, { content, attachmentPaths })
      }
      return this.ipcTransport!.electron.initiator.sendMessage(sessionId, content, attachmentPaths)
    },

    summarize: async (sessionId: string) => {
      if (this.httpTransport) {
        return this.httpTransport.post(`/initiator/${sessionId}/summarize`)
      }
      return this.ipcTransport!.electron.initiator.summarize(sessionId)
    },

    generatePrompt: async (sessionId: string) => {
      if (this.httpTransport) {
        return this.httpTransport.post(`/initiator/${sessionId}/generate`)
      }
      return this.ipcTransport!.electron.initiator.generatePrompt(sessionId)
    },

    approvePrompt: async (sessionId: string) => {
      if (this.httpTransport) {
        return this.httpTransport.post(`/initiator/${sessionId}/approve`)
      }
      return this.ipcTransport!.electron.initiator.approvePrompt(sessionId)
    },

    getSession: async (sessionId: string) => {
      if (this.httpTransport) {
        return this.httpTransport.get(`/initiator/${sessionId}`)
      }
      return this.ipcTransport!.electron.initiator.getSession(sessionId)
    },

    // Event subscriptions
    onResponseChunk: (callback: EventCallback) => {
      if (this.httpTransport) {
        return this.httpTransport.on('initiator:response:chunk', callback)
      }
      return this.ipcTransport!.electron.initiator.onResponseChunk(callback as any)
    },

    onResponseComplete: (callback: EventCallback) => {
      if (this.httpTransport) {
        return this.httpTransport.on('initiator:response:complete', callback)
      }
      return this.ipcTransport!.electron.initiator.onResponseComplete(callback as any)
    }
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

let apiClientInstance: ApiClient | null = null

/**
 * Get the connection configuration from storage
 */
export function getConnectionConfig(): ApiClientConfig {
  // Check localStorage for saved config
  if (typeof window !== 'undefined' && window.localStorage) {
    const saved = window.localStorage.getItem('connectionConfig')
    if (saved) {
      try {
        return JSON.parse(saved)
      } catch {
        // Ignore parse errors
      }
    }
  }

  // Default to standalone mode
  return { mode: 'standalone' }
}

/**
 * Save connection configuration
 */
export function saveConnectionConfig(config: ApiClientConfig): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem('connectionConfig', JSON.stringify(config))
  }
}

/**
 * Create or get the API client instance
 */
export function getApiClient(): ApiClient {
  if (!apiClientInstance) {
    const config = getConnectionConfig()
    apiClientInstance = new ApiClient(config)
  }
  return apiClientInstance
}

/**
 * Create a new API client with specific config (resets singleton)
 */
export function createApiClient(config: ApiClientConfig): ApiClient {
  if (apiClientInstance) {
    apiClientInstance.disconnect()
  }
  apiClientInstance = new ApiClient(config)
  saveConnectionConfig(config)
  return apiClientInstance
}

/**
 * Test connection to a remote server
 */
export async function testConnection(serverUrl: string, authToken?: string): Promise<{ success: boolean; error?: string }> {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    }
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`
    }

    const response = await fetch(`${serverUrl}/api/health`, { headers })
    const data = await response.json()

    if (data.status === 'ok') {
      return { success: true }
    }
    return { success: false, error: 'Server returned unexpected response' }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Connection failed'
    }
  }
}

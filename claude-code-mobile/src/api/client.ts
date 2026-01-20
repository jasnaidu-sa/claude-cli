/**
 * API Client for connecting to the Claude Code Manager desktop app
 */

import type {
  ApiResponse,
  RalphSession,
  RalphCheckpoint,
  Idea,
  IdeaStage,
  WebSocketMessage,
  ParallelSessionStatus,
  AgentStatus,
  MergeConflict,
  MergeConflictCheckpoint,
  ConflictResolutionStrategy,
} from '../types'

type EventCallback = (data: unknown) => void
type UnsubscribeFn = () => void

class ApiClient {
  private baseUrl: string = ''
  private authToken: string = ''
  private ws: WebSocket | null = null
  private eventListeners: Map<string, Set<EventCallback>> = new Map()
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5
  private reconnectDelay = 1000
  private isConnecting = false

  configure(serverUrl: string, authToken: string) {
    this.baseUrl = serverUrl.replace(/\/$/, '')
    this.authToken = authToken
  }

  isConfigured(): boolean {
    return !!this.baseUrl && !!this.authToken
  }

  private getHeaders(): HeadersInit {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.authToken}`,
    }
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<ApiResponse<T>> {
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: this.getHeaders(),
        body: body ? JSON.stringify(body) : undefined,
      })

      const json = await response.json()

      if (!response.ok) {
        return {
          success: false,
          error: json.error || `HTTP ${response.status}`,
        }
      }

      // Server returns { success: true, sessions/data/etc: [...] }
      // Normalize to { success: true, data: [...] }
      if (json.success !== undefined) {
        // Extract the data field - could be 'sessions', 'data', 'session', etc.
        const dataKey = Object.keys(json).find(k => k !== 'success' && k !== 'error')
        const data = dataKey ? json[dataKey] : json
        return { success: json.success, data, error: json.error }
      }

      return { success: true, data: json as T }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Network error',
      }
    }
  }

  // ============================================================================
  // Connection Management
  // ============================================================================

  async testConnection(): Promise<ApiResponse<{ version: string }>> {
    return this.request('GET', '/api/health')
  }

  // ============================================================================
  // WebSocket for Real-time Events
  // ============================================================================

  connectWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        resolve()
        return
      }

      if (this.isConnecting) {
        // Wait for existing connection attempt
        const checkConnection = setInterval(() => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            clearInterval(checkConnection)
            resolve()
          }
        }, 100)
        return
      }

      this.isConnecting = true

      try {
        const wsUrl = this.baseUrl.replace(/^http/, 'ws')
        const fullUrl = `${wsUrl}?token=${encodeURIComponent(this.authToken)}`

        this.ws = new WebSocket(fullUrl)

        this.ws.onopen = () => {
          console.log('[ApiClient] WebSocket connected')
          this.reconnectAttempts = 0
          this.isConnecting = false

          // Subscribe to all channels
          this.ws?.send(JSON.stringify({
            type: 'subscribe',
            channels: ['*'],
          }))

          resolve()
        }

        this.ws.onmessage = (event) => {
          try {
            const message: WebSocketMessage = JSON.parse(event.data)
            this.emit(message.channel, message.data)
          } catch (e) {
            console.error('[ApiClient] Failed to parse message:', e)
          }
        }

        this.ws.onclose = () => {
          console.log('[ApiClient] WebSocket disconnected')
          this.isConnecting = false
          this.attemptReconnect()
        }

        this.ws.onerror = (error) => {
          console.error('[ApiClient] WebSocket error:', error)
          this.isConnecting = false
          reject(error)
        }
      } catch (error) {
        this.isConnecting = false
        reject(error)
      }
    })
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[ApiClient] Max reconnect attempts reached')
      this.emit('connection:lost', {})
      return
    }

    this.reconnectAttempts++
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1)

    console.log(`[ApiClient] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`)

    setTimeout(() => {
      this.connectWebSocket().catch(console.error)
    }, delay)
  }

  disconnectWebSocket(): void {
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }

  private emit(channel: string, data: unknown): void {
    const listeners = this.eventListeners.get(channel)
    if (listeners) {
      listeners.forEach((callback) => callback(data))
    }

    // Also emit to wildcard listeners
    const wildcardListeners = this.eventListeners.get('*')
    if (wildcardListeners) {
      wildcardListeners.forEach((callback) => callback({ channel, data }))
    }
  }

  on(channel: string, callback: EventCallback): UnsubscribeFn {
    if (!this.eventListeners.has(channel)) {
      this.eventListeners.set(channel, new Set())
    }
    this.eventListeners.get(channel)!.add(callback)

    return () => {
      this.eventListeners.get(channel)?.delete(callback)
    }
  }

  // ============================================================================
  // Ralph Loop API
  // ============================================================================

  ralph = {
    getAllSessions: (): Promise<ApiResponse<RalphSession[]>> => {
      return this.request('GET', '/api/ralph')
    },

    getSession: (sessionId: string): Promise<ApiResponse<RalphSession>> => {
      return this.request('GET', `/api/ralph/${sessionId}`)
    },

    start: (config: {
      projectPath: string
      promptConfig: unknown
    }): Promise<ApiResponse<RalphSession>> => {
      return this.request('POST', '/api/ralph/start', config)
    },

    stop: (sessionId: string): Promise<ApiResponse<void>> => {
      return this.request('POST', `/api/ralph/${sessionId}/stop`)
    },

    pause: (sessionId: string): Promise<ApiResponse<void>> => {
      return this.request('POST', `/api/ralph/${sessionId}/pause`)
    },

    resume: (sessionId: string): Promise<ApiResponse<void>> => {
      return this.request('POST', `/api/ralph/${sessionId}/resume`)
    },

    approveCheckpoint: (
      sessionId: string,
      checkpointId: string,
      comment?: string
    ): Promise<ApiResponse<void>> => {
      return this.request('POST', `/api/ralph/${sessionId}/checkpoint/${checkpointId}/approve`, { comment })
    },

    skipCheckpoint: (
      sessionId: string,
      checkpointId: string,
      comment?: string
    ): Promise<ApiResponse<void>> => {
      return this.request('POST', `/api/ralph/${sessionId}/checkpoint/${checkpointId}/skip`, { comment })
    },

    rejectCheckpoint: (
      sessionId: string,
      checkpointId: string,
      comment?: string
    ): Promise<ApiResponse<void>> => {
      return this.request('POST', `/api/ralph/${sessionId}/checkpoint/${checkpointId}/reject`, { comment })
    },

    // Event subscriptions
    onProgress: (callback: (data: unknown) => void): UnsubscribeFn => {
      return this.on('ralph:progress', callback)
    },

    onCheckpoint: (callback: (data: { sessionId: string; data: RalphCheckpoint }) => void): UnsubscribeFn => {
      return this.on('ralph:checkpoint', callback as EventCallback)
    },

    onStatus: (callback: (data: unknown) => void): UnsubscribeFn => {
      return this.on('ralph:status', callback)
    },

    onError: (callback: (data: { sessionId: string; error: string }) => void): UnsubscribeFn => {
      return this.on('ralph:error', callback as EventCallback)
    },
  }

  // ============================================================================
  // Ideas API
  // ============================================================================

  ideas = {
    list: (stage?: IdeaStage): Promise<ApiResponse<Idea[]>> => {
      const query = stage ? `?stage=${stage}` : ''
      return this.request('GET', `/api/ideas${query}`)
    },

    get: (ideaId: string): Promise<ApiResponse<Idea>> => {
      return this.request('GET', `/api/ideas/${ideaId}`)
    },

    moveStage: (ideaId: string, newStage: IdeaStage): Promise<ApiResponse<Idea>> => {
      return this.request('POST', `/api/ideas/${ideaId}/move`, { stage: newStage })
    },

    addDiscussion: (
      ideaId: string,
      role: 'user' | 'assistant',
      content: string
    ): Promise<ApiResponse<Idea>> => {
      return this.request('POST', `/api/ideas/${ideaId}/discussion`, { role, content })
    },
  }

  // ============================================================================
  // Projects API
  // ============================================================================

  projects = {
    list: (): Promise<ApiResponse<{ path: string; name: string }[]>> => {
      return this.request('GET', '/api/config?key=recentProjects')
    },

    get: (projectPath: string): Promise<ApiResponse<{ path: string; name: string; worktrees: string[] }>> => {
      return this.request('GET', `/api/projects/${encodeURIComponent(projectPath)}`)
    },
  }

  // ============================================================================
  // Files API (Read-only)
  // ============================================================================

  files = {
    getTree: (projectPath: string, depth = 3): Promise<ApiResponse<FileTreeNode[]>> => {
      return this.request('GET', `/api/files/read-dir?path=${encodeURIComponent(projectPath)}&depth=${depth}`)
    },

    getContent: (filePath: string): Promise<ApiResponse<{ content: string; language: string }>> => {
      return this.request('GET', `/api/files/read?path=${encodeURIComponent(filePath)}`)
    },
  }

  // ============================================================================
  // Terminal API (Interactive)
  // ============================================================================

  terminal = {
    createSession: (config: {
      projectPath?: string
      shell?: 'bash' | 'zsh' | 'powershell'
    }): Promise<ApiResponse<TerminalSession>> => {
      return this.request('POST', '/api/sessions', config)
    },

    listSessions: (): Promise<ApiResponse<TerminalSession[]>> => {
      return this.request('GET', '/api/sessions')
    },

    closeSession: (sessionId: string): Promise<ApiResponse<void>> => {
      return this.request('DELETE', `/api/sessions/${sessionId}`)
    },

    // WebSocket connection for terminal I/O
    connectTerminal: (sessionId: string): WebSocket | null => {
      if (!this.baseUrl || !this.authToken) return null

      const wsUrl = this.baseUrl.replace(/^http/, 'ws')
      const fullUrl = `${wsUrl}/ws/terminal/${sessionId}?token=${encodeURIComponent(this.authToken)}`

      return new WebSocket(fullUrl)
    },
  }

  // ============================================================================
  // Initiator API (Requirements Chat)
  // ============================================================================

  initiator = {
    start: (projectPath: string): Promise<ApiResponse<InitiatorSession>> => {
      return this.request('POST', '/api/initiator/start', { projectPath })
    },

    sendMessage: (sessionId: string, message: string): Promise<ApiResponse<InitiatorMessage>> => {
      return this.request('POST', `/api/initiator/${sessionId}/message`, { content: message })
    },

    getSession: (sessionId: string): Promise<ApiResponse<InitiatorSession>> => {
      return this.request('GET', `/api/initiator/${sessionId}`)
    },

    generatePrompt: (sessionId: string): Promise<ApiResponse<{ prompt: string; requirements: string[] }>> => {
      return this.request('POST', `/api/initiator/${sessionId}/generate`)
    },

    approveAndStart: (sessionId: string, prompt: string): Promise<ApiResponse<{ ralphSessionId: string }>> => {
      return this.request('POST', `/api/initiator/${sessionId}/approve`, { prompt })
    },

    // Event subscriptions
    onMessage: (callback: (data: { sessionId: string; message: InitiatorMessage }) => void): UnsubscribeFn => {
      return this.on('initiator:message', callback as EventCallback)
    },

    onRequirementsUpdate: (callback: (data: { sessionId: string; requirements: string[] }) => void): UnsubscribeFn => {
      return this.on('initiator:requirements', callback as EventCallback)
    },
  }

  // ============================================================================
  // Sync API
  // ============================================================================

  sync = {
    getState: (): Promise<ApiResponse<SyncState>> => {
      return this.request('GET', '/api/sync/state')
    },

    delta: (since: number): Promise<ApiResponse<SyncDelta>> => {
      return this.request('GET', `/api/sync/delta?since=${since}`)
    },
  }

  // ============================================================================
  // Notifications API
  // ============================================================================

  notifications = {
    register: (deviceToken: string, platform: 'ios' | 'android'): Promise<ApiResponse<void>> => {
      return this.request('POST', '/api/notifications/register', { deviceToken, platform })
    },

    unregister: (deviceToken: string): Promise<ApiResponse<void>> => {
      return this.request('POST', '/api/notifications/unregister', { deviceToken })
    },
  }

  // ============================================================================
  // Parallel Execution / Agents API
  // ============================================================================

  agents = {
    getParallelStatus: (sessionId: string): Promise<ApiResponse<ParallelSessionStatus>> => {
      return this.request('GET', `/api/ralph/${sessionId}/parallel-status`)
    },

    getAgentStatus: (sessionId: string, agentId: string): Promise<ApiResponse<AgentStatus>> => {
      return this.request('GET', `/api/ralph/${sessionId}/agents/${agentId}`)
    },

    listAgents: (sessionId: string): Promise<ApiResponse<AgentStatus[]>> => {
      return this.request('GET', `/api/ralph/${sessionId}/agents`)
    },

    // Event subscriptions
    onAgentStateChange: (
      callback: (data: { sessionId: string; agent: AgentStatus }) => void
    ): UnsubscribeFn => {
      return this.on('agent:state', callback as EventCallback)
    },

    onAgentProgress: (
      callback: (data: { sessionId: string; agentId: string; progress: AgentStatus['progress'] }) => void
    ): UnsubscribeFn => {
      return this.on('agent:progress', callback as EventCallback)
    },

    onAgentComplete: (
      callback: (data: { sessionId: string; agent: AgentStatus }) => void
    ): UnsubscribeFn => {
      return this.on('agent:complete', callback as EventCallback)
    },

    onAgentError: (
      callback: (data: { sessionId: string; agentId: string; error: string }) => void
    ): UnsubscribeFn => {
      return this.on('agent:error', callback as EventCallback)
    },
  }

  // ============================================================================
  // Merge Conflicts API
  // ============================================================================

  conflicts = {
    listConflicts: (sessionId: string): Promise<ApiResponse<MergeConflict[]>> => {
      return this.request('GET', `/api/ralph/${sessionId}/conflicts`)
    },

    getConflict: (sessionId: string, conflictId: string): Promise<ApiResponse<MergeConflict>> => {
      return this.request('GET', `/api/ralph/${sessionId}/conflicts/${conflictId}`)
    },

    getPendingCheckpoint: (sessionId: string): Promise<ApiResponse<MergeConflictCheckpoint | null>> => {
      return this.request('GET', `/api/ralph/${sessionId}/conflict-checkpoint`)
    },

    approveResolution: (
      sessionId: string,
      conflictId: string,
      strategy?: ConflictResolutionStrategy
    ): Promise<ApiResponse<void>> => {
      return this.request('POST', `/api/ralph/${sessionId}/conflicts/${conflictId}/approve`, { strategy })
    },

    rejectResolution: (
      sessionId: string,
      conflictId: string,
      reason?: string
    ): Promise<ApiResponse<void>> => {
      return this.request('POST', `/api/ralph/${sessionId}/conflicts/${conflictId}/reject`, { reason })
    },

    approveAllResolutions: (sessionId: string): Promise<ApiResponse<void>> => {
      return this.request('POST', `/api/ralph/${sessionId}/conflicts/approve-all`)
    },

    // Event subscriptions
    onConflictDetected: (
      callback: (data: { sessionId: string; conflict: MergeConflict }) => void
    ): UnsubscribeFn => {
      return this.on('conflict:detected', callback as EventCallback)
    },

    onConflictResolved: (
      callback: (data: { sessionId: string; conflict: MergeConflict }) => void
    ): UnsubscribeFn => {
      return this.on('conflict:resolved', callback as EventCallback)
    },

    onConflictCheckpoint: (
      callback: (data: { sessionId: string; checkpoint: MergeConflictCheckpoint }) => void
    ): UnsubscribeFn => {
      return this.on('conflict:checkpoint', callback as EventCallback)
    },
  }

  // ============================================================================
  // Connection Events
  // ============================================================================

  onConnectionLost(callback: () => void): UnsubscribeFn {
    return this.on('connection:lost', callback as EventCallback)
  }

  onReconnected(callback: () => void): UnsubscribeFn {
    return this.on('connection:reconnected', callback as EventCallback)
  }
}

// Additional types for new APIs
export interface FileTreeNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileTreeNode[]
  size?: number
  modifiedAt?: number
}

export interface TerminalSession {
  id: string
  projectPath?: string
  shell: string
  createdAt: number
  lastActive: number
}

export interface InitiatorSession {
  id: string
  projectPath: string
  messages: InitiatorMessage[]
  requirements: string[]
  status: 'gathering' | 'ready' | 'approved' | 'started'
  createdAt: number
}

export interface InitiatorMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

export interface SyncState {
  lastSync: number
  sessionsVersion: number
  ideasVersion: number
  checkpointsVersion: number
}

export interface SyncDelta {
  sessions: { updated: RalphSession[]; deleted: string[] }
  ideas: { updated: Idea[]; deleted: string[] }
  checkpoints: { updated: RalphCheckpoint[]; deleted: string[] }
}

// Singleton instance
export const apiClient = new ApiClient()

/**
 * Discovery Chat Service
 *
 * Handles the discovery phase chat with Claude CLI.
 * Manages message streaming and coordinates with research agents.
 *
 * Flow:
 * 1. User sends message
 * 2. Service spawns Claude CLI with the message
 * 3. Response is streamed back to renderer
 * 4. Research agents are triggered based on conversation context
 */

import { spawn, ChildProcess } from 'child_process'
import { EventEmitter } from 'events'
import { getMainWindow } from '../index'
import { ConfigStore } from './config-store'

// Message types for discovery chat
export interface DiscoveryChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
}

// Agent status for research agents
export interface DiscoveryAgentStatus {
  name: string
  status: 'idle' | 'running' | 'complete' | 'error'
  output?: string
  error?: string
}

// Session for a discovery chat
export interface DiscoverySession {
  id: string
  projectPath: string
  isNewProject: boolean
  messages: DiscoveryChatMessage[]
  agentStatuses: DiscoveryAgentStatus[]
  createdAt: number
}

// IPC channel names for discovery chat
export const DISCOVERY_CHAT_CHANNELS = {
  MESSAGE: 'discovery:message',
  RESPONSE: 'discovery:response',
  RESPONSE_CHUNK: 'discovery:response-chunk',
  RESPONSE_COMPLETE: 'discovery:response-complete',
  AGENT_STATUS: 'discovery:agent-status',
  ERROR: 'discovery:error'
} as const

export class DiscoveryChatService extends EventEmitter {
  private sessions: Map<string, DiscoverySession> = new Map()
  private activeProcess: ChildProcess | null = null
  private configStore: ConfigStore

  constructor(configStore: ConfigStore) {
    super()
    this.configStore = configStore
  }

  /**
   * Create a new discovery session for a project
   */
  createSession(projectPath: string, isNewProject: boolean): DiscoverySession {
    const id = this.generateId()

    const session: DiscoverySession = {
      id,
      projectPath,
      isNewProject,
      messages: [],
      agentStatuses: [],
      createdAt: Date.now()
    }

    // Add initial system message
    session.messages.push({
      id: this.generateId(),
      role: 'system',
      content: `Discovery session started for ${isNewProject ? 'new' : 'existing'} project at: ${projectPath}`,
      timestamp: Date.now()
    })

    this.sessions.set(id, session)
    return session
  }

  /**
   * Get an existing session
   */
  getSession(sessionId: string): DiscoverySession | null {
    return this.sessions.get(sessionId) || null
  }

  /**
   * Send a message to Claude CLI and stream the response
   */
  async sendMessage(sessionId: string, content: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    // Add user message to history
    const userMessage: DiscoveryChatMessage = {
      id: this.generateId(),
      role: 'user',
      content,
      timestamp: Date.now()
    }
    session.messages.push(userMessage)

    // Build context from previous messages
    const context = this.buildContext(session)

    // Get Claude CLI path from config
    const claudePath = this.configStore.get('claudeCliPath')

    // Kill any existing process
    this.killActiveProcess()

    try {
      // Build the prompt with context
      const prompt = this.buildDiscoveryPrompt(session, content)

      // Spawn Claude CLI with the message
      // Using --print flag for non-interactive mode
      this.activeProcess = spawn(claudePath, ['--print', prompt], {
        cwd: session.projectPath,
        shell: true,
        env: {
          ...process.env,
          // Disable any interactive features
          CI: 'true'
        }
      })

      let responseContent = ''
      const responseId = this.generateId()

      // Handle stdout (Claude's response)
      this.activeProcess.stdout?.on('data', (data: Buffer) => {
        const chunk = data.toString()
        responseContent += chunk

        // Send chunk to renderer
        this.sendToRenderer(DISCOVERY_CHAT_CHANNELS.RESPONSE_CHUNK, {
          sessionId,
          messageId: responseId,
          chunk,
          timestamp: Date.now()
        })
      })

      // Handle stderr (errors or debug info)
      this.activeProcess.stderr?.on('data', (data: Buffer) => {
        console.error('[DiscoveryChat] Claude stderr:', data.toString())
      })

      // Handle process completion
      this.activeProcess.on('close', (code) => {
        this.activeProcess = null

        if (code === 0 && responseContent) {
          // Add assistant response to history
          const assistantMessage: DiscoveryChatMessage = {
            id: responseId,
            role: 'assistant',
            content: responseContent.trim(),
            timestamp: Date.now()
          }
          session.messages.push(assistantMessage)

          // Send completion event
          this.sendToRenderer(DISCOVERY_CHAT_CHANNELS.RESPONSE_COMPLETE, {
            sessionId,
            message: assistantMessage
          })
        } else {
          // Send error event
          this.sendToRenderer(DISCOVERY_CHAT_CHANNELS.ERROR, {
            sessionId,
            error: `Claude process exited with code ${code}`
          })
        }
      })

      this.activeProcess.on('error', (error) => {
        this.activeProcess = null
        this.sendToRenderer(DISCOVERY_CHAT_CHANNELS.ERROR, {
          sessionId,
          error: error.message
        })
      })

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      this.sendToRenderer(DISCOVERY_CHAT_CHANNELS.ERROR, {
        sessionId,
        error: message
      })
    }
  }

  /**
   * Update agent status
   */
  updateAgentStatus(sessionId: string, agentName: string, status: DiscoveryAgentStatus['status'], output?: string, error?: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return

    const existingIndex = session.agentStatuses.findIndex(a => a.name === agentName)
    const newStatus: DiscoveryAgentStatus = { name: agentName, status, output, error }

    if (existingIndex >= 0) {
      session.agentStatuses[existingIndex] = newStatus
    } else {
      session.agentStatuses.push(newStatus)
    }

    // Notify renderer
    this.sendToRenderer(DISCOVERY_CHAT_CHANNELS.AGENT_STATUS, {
      sessionId,
      agent: newStatus
    })
  }

  /**
   * Cancel active request
   */
  cancelRequest(): void {
    this.killActiveProcess()
  }

  /**
   * Close a session
   */
  closeSession(sessionId: string): void {
    this.sessions.delete(sessionId)
    if (this.activeProcess) {
      this.killActiveProcess()
    }
  }

  /**
   * Get all messages for a session
   */
  getMessages(sessionId: string): DiscoveryChatMessage[] {
    const session = this.sessions.get(sessionId)
    return session?.messages || []
  }

  // Private helpers

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
  }

  private killActiveProcess(): void {
    if (this.activeProcess) {
      this.activeProcess.kill('SIGTERM')
      this.activeProcess = null
    }
  }

  private buildContext(session: DiscoverySession): string {
    // Build conversation context from message history
    return session.messages
      .map(m => `${m.role}: ${m.content}`)
      .join('\n\n')
  }

  private buildDiscoveryPrompt(session: DiscoverySession, userMessage: string): string {
    const isNew = session.isNewProject

    // Build system prompt for discovery
    const systemPrompt = isNew
      ? `You are helping plan a new software project. The user will describe what they want to build.
Ask clarifying questions to understand:
- The main features and functionality
- Technology preferences and constraints
- User experience requirements
- Integration needs
- Scale and performance considerations

Be thorough but concise. After gathering requirements, you'll help create a detailed specification.`
      : `You are helping plan features for an existing codebase at: ${session.projectPath}
The user will describe what they want to add or change.
Ask clarifying questions to understand:
- The specific features or changes needed
- How they integrate with existing code
- Any constraints or dependencies
- Testing and deployment requirements

Be thorough but concise. After gathering requirements, you'll help create a detailed specification.`

    // Build full prompt with context
    const context = this.buildContext(session)
    return `${systemPrompt}

Previous conversation:
${context}

User: ${userMessage}`
  }

  private sendToRenderer(channel: string, data: unknown): void {
    const mainWindow = getMainWindow()
    if (mainWindow) {
      mainWindow.webContents.send(channel, data)
    }
  }
}
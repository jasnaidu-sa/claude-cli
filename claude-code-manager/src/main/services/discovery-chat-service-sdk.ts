/**
 * Discovery Chat Service - Agent SDK Implementation
 *
 * Fast, streaming chat service using the Claude Agent SDK.
 * Replaces the CLI-based implementation for better performance.
 *
 * Key improvements over CLI version:
 * - No process spawn overhead (direct API connection)
 * - True token-by-token streaming via SDKPartialAssistantMessage
 * - Session persistence with resume capability
 * - Built-in cost tracking
 * - Haiku model for fast Q&A responses
 *
 * NOTE: Uses dynamic import() because the Agent SDK is ESM-only
 * and Electron main process uses CommonJS.
 */

import { EventEmitter } from 'events'
import * as fs from 'fs/promises'
import * as path from 'path'
import { getMainWindow } from '../index'
import type { ComplexityAnalysis } from '../../shared/types'
import { analyzeComplexity } from './complexity-analyzer'

// Type imports only (these work with CommonJS)
import type { Query, SDKMessage, SDKUserMessage, Options } from '@anthropic-ai/claude-agent-sdk'

// Dynamic import helper for ESM module
let sdkModule: typeof import('@anthropic-ai/claude-agent-sdk') | null = null

async function getSDK(): Promise<typeof import('@anthropic-ai/claude-agent-sdk')> {
  if (!sdkModule) {
    // Dynamic import for ESM module in CommonJS context
    sdkModule = await import('@anthropic-ai/claude-agent-sdk')
    console.log('[DiscoveryChatSDK] Agent SDK loaded successfully')
  }
  return sdkModule
}

// Constants
const HAIKU_MODEL = 'claude-3-5-haiku-20241022'
const SONNET_MODEL = 'claude-sonnet-4-5-20250929'
const MAX_TURNS_DISCOVERY = 1 // Single turn for Q&A
const MAX_RECENT_MESSAGES = 6

// Autonomous directory structure
const AUTONOMOUS_DIR = '.autonomous'
const SESSION_FILE = 'session.json'
const SPEC_FILE = 'spec.md'
const SDK_SESSION_FILE = 'sdk-session.json'

// IPC channel names
export const DISCOVERY_CHAT_CHANNELS = {
  MESSAGE: 'discovery:message',
  RESPONSE: 'discovery:response',
  RESPONSE_CHUNK: 'discovery:response-chunk',
  RESPONSE_COMPLETE: 'discovery:response-complete',
  AGENT_STATUS: 'discovery:agent-status',
  ERROR: 'discovery:error',
  SESSION_LOADED: 'discovery:session-loaded',
  SPEC_READY: 'discovery:spec-ready'
} as const

// Message types
export interface DiscoveryChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
}

// Session state
export interface DiscoverySession {
  id: string
  projectPath: string
  isNewProject: boolean
  messages: DiscoveryChatMessage[]
  createdAt: number
  sdkSessionId?: string // Claude Agent SDK session ID for resume
  runningSummary?: string
  lastSummarizedIndex?: number
  discoveryReady?: boolean
  totalCostUsd?: number
}

/**
 * Generate unique ID
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 10)}`
}

/**
 * Ensure .autonomous directory exists
 */
async function ensureAutonomousDir(projectPath: string): Promise<string> {
  const autonomousPath = path.join(projectPath, AUTONOMOUS_DIR)
  await fs.mkdir(autonomousPath, { recursive: true })
  return autonomousPath
}

/**
 * Save session to disk
 */
async function saveSessionToDisk(projectPath: string, session: DiscoverySession): Promise<void> {
  const autonomousPath = await ensureAutonomousDir(projectPath)
  const sessionPath = path.join(autonomousPath, SESSION_FILE)

  const sessionData = {
    ...session,
    updatedAt: Date.now()
  }

  await fs.writeFile(sessionPath, JSON.stringify(sessionData, null, 2))
  console.log('[DiscoveryChatSDK] Session saved to disk')
}

/**
 * Load session from disk
 */
async function loadSessionFromDisk(projectPath: string): Promise<DiscoverySession | null> {
  const sessionPath = path.join(projectPath, AUTONOMOUS_DIR, SESSION_FILE)

  try {
    const content = await fs.readFile(sessionPath, 'utf-8')
    const data = JSON.parse(content)
    console.log('[DiscoveryChatSDK] Loaded session with', data.messages?.length || 0, 'messages')
    return data as DiscoverySession
  } catch {
    return null
  }
}

/**
 * Save spec to disk
 */
async function saveSpecToDisk(projectPath: string, specContent: string): Promise<string> {
  const autonomousPath = await ensureAutonomousDir(projectPath)
  const specPath = path.join(autonomousPath, SPEC_FILE)

  const header = `# Project Specification

> Generated: ${new Date().toISOString()}
> Project: ${projectPath}

---

`

  await fs.writeFile(specPath, header + specContent)
  console.log('[DiscoveryChatSDK] Spec saved:', specPath)
  return specPath
}

/**
 * Save complexity analysis
 */
async function saveComplexityToDisk(projectPath: string, analysis: ComplexityAnalysis): Promise<void> {
  const autonomousPath = await ensureAutonomousDir(projectPath)
  const complexityPath = path.join(autonomousPath, 'complexity.json')
  await fs.writeFile(complexityPath, JSON.stringify(analysis, null, 2))
}

/**
 * Clear session from disk
 */
async function clearSessionFromDisk(projectPath: string): Promise<void> {
  const sessionPath = path.join(projectPath, AUTONOMOUS_DIR, SESSION_FILE)
  try {
    await fs.unlink(sessionPath)
    console.log('[DiscoveryChatSDK] Session cleared')
  } catch {
    // File might not exist
  }
}

/**
 * Discovery Chat Service using Agent SDK
 */
export class DiscoveryChatServiceSDK extends EventEmitter {
  private sessions: Map<string, DiscoverySession> = new Map()
  private activeQueries: Map<string, Query> = new Map()

  constructor() {
    super()
  }

  /**
   * Create or load a discovery session
   */
  async createSession(projectPath: string, isNewProject: boolean): Promise<DiscoverySession> {
    // Try to load existing session
    const existingSession = await loadSessionFromDisk(projectPath)

    if (existingSession) {
      console.log('[DiscoveryChatSDK] Resuming session:', existingSession.id)
      this.sessions.set(existingSession.id, existingSession)
      return existingSession
    }

    // Create new session
    const id = generateId()
    const session: DiscoverySession = {
      id,
      projectPath,
      isNewProject,
      messages: [{
        id: generateId(),
        role: 'system',
        content: `Discovery session started for ${isNewProject ? 'new' : 'existing'} project at: ${projectPath}`,
        timestamp: Date.now()
      }],
      createdAt: Date.now()
    }

    this.sessions.set(id, session)
    await saveSessionToDisk(projectPath, session)

    return session
  }

  /**
   * Create fresh session, clearing any existing one
   */
  async createFreshSession(projectPath: string, isNewProject: boolean): Promise<DiscoverySession> {
    await clearSessionFromDisk(projectPath)

    // Clear from memory
    for (const [sessionId, session] of this.sessions) {
      if (session.projectPath === projectPath) {
        this.sessions.delete(sessionId)
        this.cancelQuery(sessionId)
      }
    }

    return this.createSession(projectPath, isNewProject)
  }

  /**
   * Get existing session
   */
  getSession(sessionId: string): DiscoverySession | null {
    return this.sessions.get(sessionId) || null
  }

  /**
   * Send a message and stream the response
   */
  async sendMessage(sessionId: string, content: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    // Add user message to history
    const userMessage: DiscoveryChatMessage = {
      id: generateId(),
      role: 'user',
      content,
      timestamp: Date.now()
    }
    session.messages.push(userMessage)

    const responseId = generateId()
    const startTime = Date.now()

    try {
      // Build the prompt with conversation context
      const prompt = this.buildDiscoveryPrompt(session, content)

      console.log('[DiscoveryChatSDK] Starting query with Agent SDK')
      console.log('[DiscoveryChatSDK] Project path:', session.projectPath)

      // Notify UI that we're starting
      this.sendToRenderer(DISCOVERY_CHAT_CHANNELS.RESPONSE_CHUNK, {
        sessionId,
        messageId: responseId,
        chunk: '',
        fullContent: '',
        eventType: 'system',
        toolName: 'Connecting to Claude...',
        timestamp: Date.now()
      })

      // Build SDK options
      const options: Options = {
        model: HAIKU_MODEL, // Fast model for discovery Q&A
        maxTurns: MAX_TURNS_DISCOVERY,
        cwd: session.projectPath,
        includePartialMessages: true, // Enable streaming!
        permissionMode: 'default',
        // No tools needed for pure Q&A discovery
        tools: [],
        // Resume from previous SDK session if available
        ...(session.sdkSessionId ? { resume: session.sdkSessionId } : {})
      }

      // Create async generator for streaming input
      async function* generateMessages(): AsyncGenerator<SDKUserMessage> {
        yield {
          type: 'user' as const,
          message: {
            role: 'user' as const,
            content: prompt
          },
          parent_tool_use_id: null,
          session_id: sessionId
        }
      }

      // Get SDK dynamically (ESM module)
      const sdk = await getSDK()

      // Start the query
      const queryResult = sdk.query({
        prompt: generateMessages(),
        options
      })

      // Store for potential cancellation
      this.activeQueries.set(sessionId, queryResult)

      let responseContent = ''
      let sdkSessionId: string | undefined

      // Process streaming messages
      for await (const message of queryResult) {
        // Capture SDK session ID for resume
        if (message.type === 'system' && message.subtype === 'init') {
          sdkSessionId = message.session_id
          session.sdkSessionId = sdkSessionId
          console.log('[DiscoveryChatSDK] SDK session ID:', sdkSessionId)

          this.sendToRenderer(DISCOVERY_CHAT_CHANNELS.RESPONSE_CHUNK, {
            sessionId,
            messageId: responseId,
            chunk: '',
            fullContent: '',
            eventType: 'system',
            toolName: `Model: ${message.model}`,
            timestamp: Date.now()
          })
        }

        // Handle streaming partial messages (token-by-token!)
        if (message.type === 'stream_event' && message.event) {
          const event = message.event as { type: string; delta?: { type?: string; text?: string } }

          if (event.type === 'content_block_delta' && event.delta?.text) {
            const delta = event.delta.text
            responseContent += delta

            // Stream to UI immediately!
            this.sendToRenderer(DISCOVERY_CHAT_CHANNELS.RESPONSE_CHUNK, {
              sessionId,
              messageId: responseId,
              chunk: delta,
              fullContent: responseContent,
              eventType: 'text',
              timestamp: Date.now()
            })
          }
        }

        // Handle complete assistant message (fallback)
        if (message.type === 'assistant' && message.message?.content) {
          for (const block of message.message.content) {
            if (block.type === 'text' && 'text' in block) {
              const newText = block.text as string
              if (newText.length > responseContent.length) {
                const delta = newText.slice(responseContent.length)
                responseContent = newText

                this.sendToRenderer(DISCOVERY_CHAT_CHANNELS.RESPONSE_CHUNK, {
                  sessionId,
                  messageId: responseId,
                  chunk: delta,
                  fullContent: responseContent,
                  eventType: 'text',
                  timestamp: Date.now()
                })
              }
            }
          }
        }

        // Handle final result
        if (message.type === 'result') {
          const duration = Date.now() - startTime
          console.log('[DiscoveryChatSDK] Query complete in', duration, 'ms')
          console.log('[DiscoveryChatSDK] Cost:', message.total_cost_usd, 'USD')

          // Update session cost
          session.totalCostUsd = (session.totalCostUsd || 0) + (message.total_cost_usd || 0)

          // Use result text if we didn't get streaming content
          if (!responseContent && 'result' in message) {
            responseContent = message.result as string
          }
        }
      }

      // Clean up
      this.activeQueries.delete(sessionId)

      // Add assistant response to history
      if (responseContent.trim()) {
        const assistantMessage: DiscoveryChatMessage = {
          id: responseId,
          role: 'assistant',
          content: responseContent.trim(),
          timestamp: Date.now()
        }
        session.messages.push(assistantMessage)

        // Check for discovery ready marker
        if (responseContent.includes('[DISCOVERY_READY]')) {
          session.discoveryReady = true
          console.log('[DiscoveryChatSDK] Discovery marked as ready')
        }

        // Save session
        await saveSessionToDisk(session.projectPath, session)

        // Send completion
        this.sendToRenderer(DISCOVERY_CHAT_CHANNELS.RESPONSE_COMPLETE, {
          sessionId,
          message: assistantMessage
        })
      } else {
        this.sendToRenderer(DISCOVERY_CHAT_CHANNELS.RESPONSE_COMPLETE, {
          sessionId,
          message: null
        })
      }

    } catch (error) {
      this.activeQueries.delete(sessionId)
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      console.error('[DiscoveryChatSDK] Query error:', errorMessage)

      this.sendToRenderer(DISCOVERY_CHAT_CHANNELS.ERROR, {
        sessionId,
        error: errorMessage
      })
    }
  }

  /**
   * Generate Quick Spec from conversation
   */
  async generateQuickSpec(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    if (session.messages.length < 3) {
      throw new Error('Need at least 3 messages before generating spec')
    }

    const responseId = generateId()

    this.sendToRenderer(DISCOVERY_CHAT_CHANNELS.RESPONSE_CHUNK, {
      sessionId,
      messageId: responseId,
      chunk: '🚀 Generating Quick Spec...\n',
      fullContent: '',
      eventType: 'system',
      timestamp: Date.now()
    })

    try {
      // Build conversation context
      const conversation = this.buildContext(session)

      const prompt = `Based on this conversation, generate a detailed specification document.

IMPORTANT: Output the spec DIRECTLY in your response. Do NOT use any tools.

${conversation}

Generate a spec in markdown format with these sections:
# Feature Specification

## Overview
Brief description of what needs to be built.

## Requirements
- Functional requirements from conversation
- Technical constraints mentioned

## Implementation Steps
1. Numbered steps for implementation
2. Include key components to create

## Testing
- How to verify the feature works`

      // Use Sonnet for better spec generation
      const options: Options = {
        model: SONNET_MODEL,
        maxTurns: 1,
        cwd: session.projectPath,
        includePartialMessages: true,
        permissionMode: 'default',
        tools: []
      }

      async function* generateMessages(): AsyncGenerator<SDKUserMessage> {
        yield {
          type: 'user' as const,
          message: {
            role: 'user' as const,
            content: prompt
          },
          parent_tool_use_id: null,
          session_id: sessionId
        }
      }

      // Get SDK dynamically (ESM module)
      const sdk = await getSDK()

      const queryResult = sdk.query({
        prompt: generateMessages(),
        options
      })

      let specContent = ''

      for await (const message of queryResult) {
        // Stream partial messages
        if (message.type === 'stream_event' && message.event) {
          const event = message.event as { type: string; delta?: { type?: string; text?: string } }
          if (event.type === 'content_block_delta' && event.delta?.text) {
            const delta = event.delta.text
            specContent += delta

            this.sendToRenderer(DISCOVERY_CHAT_CHANNELS.RESPONSE_CHUNK, {
              sessionId,
              messageId: responseId,
              chunk: delta,
              fullContent: specContent,
              eventType: 'content',
              timestamp: Date.now()
            })
          }
        }

        // Handle assistant message fallback
        if (message.type === 'assistant' && message.message?.content) {
          for (const block of message.message.content) {
            if (block.type === 'text' && 'text' in block) {
              const newText = block.text as string
              if (newText.length > specContent.length) {
                const delta = newText.slice(specContent.length)
                specContent = newText

                this.sendToRenderer(DISCOVERY_CHAT_CHANNELS.RESPONSE_CHUNK, {
                  sessionId,
                  messageId: responseId,
                  chunk: delta,
                  fullContent: specContent,
                  eventType: 'content',
                  timestamp: Date.now()
                })
              }
            }
          }
        }

        // Final result
        if (message.type === 'result') {
          console.log('[DiscoveryChatSDK] Spec generation complete')
          console.log('[DiscoveryChatSDK] Cost:', message.total_cost_usd, 'USD')

          if (!specContent && 'result' in message) {
            specContent = message.result as string
          }
        }
      }

      // Save spec
      await saveSpecToDisk(session.projectPath, specContent)

      // Analyze complexity
      const messages = session.messages.map(m => ({
        role: m.role,
        content: m.content
      }))
      const complexityAnalysis = analyzeComplexity(messages)
      await saveComplexityToDisk(session.projectPath, complexityAnalysis)

      // Notify UI
      this.sendToRenderer(DISCOVERY_CHAT_CHANNELS.SPEC_READY, {
        sessionId,
        spec: specContent
      })

      this.sendToRenderer(DISCOVERY_CHAT_CHANNELS.RESPONSE_CHUNK, {
        sessionId,
        messageId: responseId,
        chunk: '\n✅ Quick Spec generated successfully!\n',
        fullContent: '',
        eventType: 'system',
        timestamp: Date.now()
      })

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      this.sendToRenderer(DISCOVERY_CHAT_CHANNELS.RESPONSE_CHUNK, {
        sessionId,
        messageId: responseId,
        chunk: `\n❌ Spec generation failed: ${errorMsg}\n`,
        fullContent: '',
        eventType: 'stderr',
        timestamp: Date.now()
      })
      throw error
    }
  }

  /**
   * Cancel active query
   */
  cancelQuery(sessionId: string): void {
    const activeQuery = this.activeQueries.get(sessionId)
    if (activeQuery) {
      activeQuery.interrupt().catch(console.error)
      this.activeQueries.delete(sessionId)
    }
  }

  /**
   * Close session
   */
  closeSession(sessionId: string): void {
    this.cancelQuery(sessionId)
    this.sessions.delete(sessionId)
  }

  /**
   * Get messages for session
   */
  getMessages(sessionId: string): DiscoveryChatMessage[] {
    return this.sessions.get(sessionId)?.messages || []
  }

  /**
   * Cleanup all sessions
   */
  cleanup(): void {
    for (const sessionId of this.activeQueries.keys()) {
      this.cancelQuery(sessionId)
    }
    this.sessions.clear()
    this.activeQueries.clear()
  }

  /**
   * Build conversation context
   */
  private buildContext(session: DiscoverySession): string {
    const messages = session.messages
    const totalMessages = messages.length

    if (totalMessages <= MAX_RECENT_MESSAGES) {
      return messages
        .map(m => `${m.role}: ${m.content}`)
        .join('\n\n')
    }

    const parts: string[] = []

    if (session.runningSummary) {
      parts.push(`<previous_discussion_summary>
${session.runningSummary}
</previous_discussion_summary>`)
    }

    const recentMessages = messages.slice(-MAX_RECENT_MESSAGES)
    if (recentMessages.length > 0) {
      const recentContext = recentMessages
        .map(m => `${m.role}: ${m.content}`)
        .join('\n\n')
      parts.push(`<recent_messages>
${recentContext}
</recent_messages>`)
    }

    return parts.join('\n\n')
  }

  /**
   * Build discovery prompt
   */
  private buildDiscoveryPrompt(session: DiscoverySession, userMessage: string): string {
    const isNew = session.isNewProject

    const baseInstructions = `
IMPORTANT INTERACTION RULES:
- This is a CONVERSATION-ONLY discovery phase. You have NO tools available.
- DO NOT try to explore files, run commands, or use any tools.
- Your ONLY job is to ask excellent clarifying questions.
- Keep responses concise - focus on 3-5 related questions per turn.

READINESS INDICATOR:
When you have gathered enough information, end your response with:
[DISCOVERY_READY]`

    const systemPrompt = isNew
      ? `You are a HEAVY SPEC discovery assistant helping plan a new software project.
${baseInstructions}

Ask EXHAUSTIVE clarifying questions about:
1. FEATURES - Every feature broken into atomic, testable units
2. TECHNOLOGY - Exact frameworks, libraries, versions
3. USER EXPERIENCE - Every screen, interaction, error state
4. DATA - What data is stored, how it flows
5. EDGE CASES - Error handling, validation
6. ACCEPTANCE CRITERIA - How to verify completion`
      : `You are a HEAVY SPEC discovery assistant for an existing codebase at: ${session.projectPath}
${baseInstructions}

Ask EXHAUSTIVE clarifying questions about:
1. SPECIFIC CHANGES - What needs to be added or modified
2. EXISTING PATTERNS - How similar features work
3. INTEGRATION POINTS - What existing code will interact
4. DATA CHANGES - New models, fields, migrations
5. TESTING - What tests need to be written`

    const context = this.buildContext(session)
    const contextSection = context.trim()
      ? `\n<conversation_history>\n${context}\n</conversation_history>\n`
      : ''

    return `${systemPrompt}
${contextSection}
<current_user_message>
${userMessage}
</current_user_message>

Respond with your questions.`
  }

  /**
   * Send message to renderer
   */
  private sendToRenderer(channel: string, data: unknown): void {
    const mainWindow = getMainWindow()
    if (mainWindow) {
      mainWindow.webContents.send(channel, data)
    }
  }
}

// Export singleton instance
export const discoveryChatServiceSDK = new DiscoveryChatServiceSDK()

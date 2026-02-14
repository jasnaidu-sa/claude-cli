/**
 * WhatsApp Agent Service - Central Agent Orchestrator
 *
 * Implements P3-T1 from PRD_WHATSAPP_AI_ASSISTANT.
 *
 * The central agent orchestrator that:
 * - Receives messages from WhatsAppService via GroupQueueService
 * - Detects agent mode (explicit commands + natural language analysis)
 * - Builds context: identity + memory search + project CLAUDE.md
 * - Executes Agent SDK queries with streaming
 * - Provides 4 MCP servers (WhatsApp tools, Memory tools, BVS tools, Task tools)
 * - Manages sessions: Map<string, string> for jid -> sessionId
 * - Tracks cost per conversation
 * - Formats messages as XML (NanoClaw pattern)
 * - Handles errors: on agent failure, sends error message to WhatsApp
 */

import { EventEmitter } from 'events'
import { z } from 'zod'
import type {
  WhatsAppMessage,
  WhatsAppConversation,
  WhatsAppAgentMode,
  AgentModeConfig,
  MemorySearchResult,
  ScheduledTask,
} from '@shared/whatsapp-types'
import type { WhatsAppService } from './whatsapp-service'
import type { VectorMemoryService } from './vector-memory-service'
import type { AgentIdentityService } from './agent-identity-service'
import type { GroupQueueService } from './group-queue-service'
import type { ConfigStore } from './config-store'
import type { SkillsManagerService } from './skills-manager-service'
import type { SkillsConfigStore } from './skills-config-store'
import type { PatternCrystallizerService } from './pattern-crystallizer-service'
import type { EpisodeStoreService } from './episode-store-service'
import type { HooksService, HookContext } from './hooks-service'
import type { ContextManagerService, AssembleContextOptions } from './context-manager-service'
import { createAgentSelfToolsMcpServer } from './agent-self-tools-mcp'

// Agent SDK types
import type { Options, SDKUserMessage, Query } from '@anthropic-ai/claude-agent-sdk'

// ============================================================================
// Constants
// ============================================================================

const LOG_PREFIX = '[WhatsAppAgentService]'

/** Maximum memory search results to inject into context. */
const MAX_MEMORY_RESULTS = 5

/** Minimum memory score to include in context. */
const MIN_MEMORY_SCORE = 0.3

/** Cost threshold (USD) at which the agent notifies the user about spending. */
const COST_NOTIFICATION_THRESHOLD = 0.50

// ============================================================================
// Types
// ============================================================================

/** Cost tracking per conversation. */
interface ConversationCost {
  totalCostUsd: number
  totalTokensInput: number
  totalTokensOutput: number
  queryCount: number
  lastQueryCostUsd: number
}

/** Agent stream event emitted to the renderer via IPC. */
export interface AgentStreamEvent {
  conversationJid: string
  type: 'start' | 'chunk' | 'complete' | 'error'
  text?: string
  costUsd?: number
  mode?: WhatsAppAgentMode
  error?: string
}

// ============================================================================
// SDK Module Singleton
// ============================================================================

let sdkModule: typeof import('@anthropic-ai/claude-agent-sdk') | null = null

async function getSDK(): Promise<typeof import('@anthropic-ai/claude-agent-sdk')> {
  if (!sdkModule) {
    sdkModule = await import('@anthropic-ai/claude-agent-sdk')
    console.log(LOG_PREFIX, 'Agent SDK loaded')
  }
  return sdkModule
}

/**
 * Get the path to the Claude Code CLI executable bundled with the SDK.
 * In packaged Electron apps, the SDK is extracted from asar to app.asar.unpacked.
 */
function getClaudeCodeCliPath(): string | undefined {
  try {
    const path = require('path')
    const sdkPath = require.resolve('@anthropic-ai/claude-agent-sdk')
    const sdkDir = path.dirname(sdkPath)
    let cliPath = path.join(sdkDir, 'cli.js')

    if (cliPath.includes('app.asar') && !cliPath.includes('app.asar.unpacked')) {
      cliPath = cliPath.replace('app.asar', 'app.asar.unpacked')
    }

    return cliPath
  } catch {
    return undefined
  }
}

// ============================================================================
// Mode Detection Patterns
// ============================================================================

/** Explicit command prefix mapping. */
const EXPLICIT_COMMAND_MAP: Record<string, WhatsAppAgentMode> = {
  '/fix': 'quick_fix',
  '/quickfix': 'quick_fix',
  '/research': 'research',
  '/search': 'research',
  '/build': 'bvs_spawn',
  '/implement': 'bvs_spawn',
  '/bvs': 'bvs_spawn',
  '/chat': 'chat',
}

/** Keyword patterns for natural language mode detection. */
const MODE_KEYWORD_PATTERNS: Array<{
  mode: WhatsAppAgentMode
  patterns: RegExp[]
}> = [
  {
    mode: 'quick_fix',
    patterns: [
      /\b(?:fix|change|update|modify|patch|tweak|adjust)\b.*\b(?:file|code|line|function|bug|error|typo)\b/i,
      /\b(?:file|code|line|function|bug|error|typo)\b.*\b(?:fix|change|update|modify|patch|tweak|adjust)\b/i,
    ],
  },
  {
    mode: 'research',
    patterns: [
      /\b(?:research|find out|look up|investigate|what is|what are|explain|how does|how do|tell me about|compare)\b/i,
    ],
  },
  {
    mode: 'bvs_spawn',
    patterns: [
      /\b(?:implement|build|create|develop|scaffold|set up|architect)\b.*\b(?:feature|module|service|component|system|page|api|endpoint)\b/i,
      /\b(?:feature|module|service|component|system|page|api|endpoint)\b.*\b(?:implement|build|create|develop|scaffold|set up|architect)\b/i,
    ],
  },
]

// ============================================================================
// WhatsAppAgentService
// ============================================================================

export class WhatsAppAgentService extends EventEmitter {
  private whatsappService: WhatsAppService
  private memoryService: VectorMemoryService
  private identityService: AgentIdentityService
  private queueService: GroupQueueService
  private configStore: ConfigStore

  /** Session management: jid -> SDK session ID */
  private sessions: Map<string, string> = new Map()

  /** Per-conversation mode overrides. */
  private modeOverrides: Map<string, WhatsAppAgentMode> = new Map()

  /** Cost tracking per conversation. */
  private costs: Map<string, ConversationCost> = new Map()

  /** Active abort controllers for running queries. */
  private activeAbortControllers: Map<string, AbortController> = new Map()

  /** Self-extension services (set after construction via setSkillsServices). */
  private skillsManager: SkillsManagerService | null = null
  private skillsConfigStore: SkillsConfigStore | null = null
  private patternCrystallizer: PatternCrystallizerService | null = null

  /** LLM router for cost-optimized model routing (set via setLlmRouter). */
  private llmRouter: import('./llm-router-service').LlmRouterService | null = null

  /** Unified Agent Architecture memory services (set via setMemoryServices). */
  private episodeStore: EpisodeStoreService | null = null
  private hooksService: HooksService | null = null
  private contextManager: ContextManagerService | null = null

  constructor(
    whatsappService: WhatsAppService,
    memoryService: VectorMemoryService,
    identityService: AgentIdentityService,
    queueService: GroupQueueService,
    configStore: ConfigStore,
  ) {
    super()
    this.whatsappService = whatsappService
    this.memoryService = memoryService
    this.identityService = identityService
    this.queueService = queueService
    this.configStore = configStore
  }

  // ==========================================================================
  // Self-Extension Integration
  // ==========================================================================

  /**
   * Set the skills services for self-extension capabilities.
   * Called after construction because these services are initialized later.
   */
  setSkillsServices(
    skillsManager: SkillsManagerService,
    skillsConfigStore: SkillsConfigStore,
    patternCrystallizer: PatternCrystallizerService,
  ): void {
    this.skillsManager = skillsManager
    this.skillsConfigStore = skillsConfigStore
    this.patternCrystallizer = patternCrystallizer
    console.log(LOG_PREFIX, 'Skills services wired')
  }

  setLlmRouter(router: import('./llm-router-service').LlmRouterService): void {
    this.llmRouter = router
    console.log(LOG_PREFIX, 'LLM Router wired')
  }

  /**
   * Set the Unified Agent Architecture memory services.
   * Called after construction because these services are initialized later.
   */
  setMemoryServices(
    episodeStore: EpisodeStoreService,
    hooksService: HooksService,
    contextManager: ContextManagerService,
  ): void {
    this.episodeStore = episodeStore
    this.hooksService = hooksService
    this.contextManager = contextManager
    console.log(LOG_PREFIX, 'Memory services wired into WhatsApp Agent')
  }

  // ==========================================================================
  // Initialization
  // ==========================================================================

  /**
   * Initialize the agent service: wire up queue processing functions and
   * subscribe to WhatsApp message events for queueing.
   */
  async initialize(): Promise<void> {
    // Wire queue processing functions
    this.queueService.setProcessMessagesFn((jid) => this.processMessages(jid))
    this.queueService.setProcessTaskFn((jid, task) => this.processTask(jid, task))

    // Listen for incoming messages and enqueue for processing
    this.whatsappService.on('message-received', (msg: WhatsAppMessage) => {
      console.log(LOG_PREFIX, `[MSG-IN] Received message-received event: jid=${msg.conversationJid}, fromMe=${msg.isFromMe}, content="${msg.content.substring(0, 50)}"`)
      const config = this.configStore.getWhatsAppConfig()

      // For self-chat: allow fromMe messages (user talks to themselves)
      // For all other chats: skip messages from the bot itself
      const conversation = this.whatsappService.getConversation(msg.conversationJid)
      console.log(LOG_PREFIX, `[MSG-IN] Conversation: chatType=${conversation?.chatType}, isRegistered=${conversation?.isRegistered}, requiresTrigger=${conversation?.requiresTrigger}, selfChatMode=${config.selfChatMode}`)
      if (msg.isFromMe) {
        const isSelfChat = conversation?.chatType === 'self'
        if (!isSelfChat || !config.selfChatMode) {
          console.log(LOG_PREFIX, `[MSG-IN] SKIP: fromMe but not self-chat or selfChatMode disabled`)
          return
        }
      }

      if (!conversation?.isRegistered) {
        // Auto-register self-chat conversations when selfChatMode is enabled
        if (conversation?.chatType === 'self' && config.selfChatMode) {
          console.log(LOG_PREFIX, 'Auto-registering self-chat conversation:', msg.conversationJid)
          this.whatsappService.registerConversation(msg.conversationJid, {
            isRegistered: true,
            chatType: 'self',
            agentMode: config.defaultAgentMode || 'auto',
            requiresTrigger: true,
            triggerPattern: config.defaultTriggerPattern || '^@Claude\\b',
          })
        } else {
          console.log(LOG_PREFIX, `[MSG-IN] SKIP: not registered and not auto-registerable`)
          return
        }
      }

      // Re-fetch conversation after potential registration
      const updatedConversation = this.whatsappService.getConversation(msg.conversationJid)

      // Check trigger pattern
      if (updatedConversation?.requiresTrigger && updatedConversation?.triggerPattern) {
        const triggerRegex = new RegExp(updatedConversation.triggerPattern, 'i')
        console.log(LOG_PREFIX, `[MSG-IN] Trigger check: pattern="${updatedConversation.triggerPattern}", content="${msg.content.substring(0, 50)}", matches=${triggerRegex.test(msg.content)}`)
        if (!triggerRegex.test(msg.content)) {
          console.log(LOG_PREFIX, `[MSG-IN] SKIP: trigger pattern not matched`)
          return
        }
      }

      // Self-chat mode check
      if (updatedConversation?.chatType === 'self' && !config.selfChatMode) {
        console.log(LOG_PREFIX, `[MSG-IN] SKIP: self-chat mode disabled`)
        return
      }

      console.log(LOG_PREFIX, `[MSG-IN] ENQUEUE: ${msg.conversationJid}`)
      this.queueService.enqueueMessage(msg.conversationJid)
    })

    console.log(LOG_PREFIX, 'Initialized')
  }

  // ==========================================================================
  // Message Processing (called by GroupQueueService)
  // ==========================================================================

  /**
   * Process pending messages for a conversation. Called by the queue service
   * when it is this conversation's turn to run.
   */
  async processMessages(conversationJid: string): Promise<void> {
    console.log(LOG_PREFIX, `[PROCESS] processMessages called for: ${conversationJid}`)
    const conversation = this.whatsappService.getConversation(conversationJid)
    if (!conversation) {
      console.warn(LOG_PREFIX, `Conversation not found: ${conversationJid}`)
      return
    }

    // Get unprocessed messages since last agent response
    const since = conversation.lastAgentResponseAt ?? 0
    const allMessages = this.whatsappService.getMessages(conversationJid, since)
    const isSelfChat = conversation.chatType === 'self'
    console.log(LOG_PREFIX, `[PROCESS] since=${since}, allMessages=${allMessages.length}, isSelfChat=${isSelfChat}`)
    for (const m of allMessages) {
      console.log(LOG_PREFIX, `[PROCESS]   msg: id=${m.id}, isProcessed=${m.isProcessed}, isFromMe=${m.isFromMe}, direction=${m.direction}, content="${m.content.substring(0, 40)}"`)
    }
    const unprocessed = allMessages.filter(
      (m) => !m.isProcessed && (isSelfChat ? m.isFromMe : (!m.isFromMe && m.direction === 'inbound')),
    )

    console.log(LOG_PREFIX, `[PROCESS] unprocessed=${unprocessed.length}`)
    if (unprocessed.length === 0) {
      return
    }

    // Send ack reaction on the first message
    const config = this.configStore.getWhatsAppConfig()
    try {
      const firstMsg = unprocessed[0]
      const messageKey = firstMsg.metadata?.baileysMessageKey
      if (messageKey) {
        await this.whatsappService.sendReaction(
          conversationJid,
          messageKey as any,
          config.ackReactionEmoji,
        )
      }
    } catch (err) {
      console.warn(LOG_PREFIX, 'Failed to send ack reaction:', err)
    }

    // Detect mode from the latest message
    const latestMessage = unprocessed[unprocessed.length - 1]
    const mode = this.detectMode(latestMessage.content, conversation)

    // Execute agent
    try {
      await this.executeAgent(conversation, unprocessed, mode)
    } catch (err) {
      console.error(LOG_PREFIX, `Agent execution failed for ${conversationJid}:`, err)

      // Send error message to WhatsApp
      const errorMessage = err instanceof Error ? err.message : String(err)
      try {
        await this.whatsappService.sendMessage(
          conversationJid,
          `Sorry, I encountered an error processing your message:\n\n${errorMessage}`,
        )
      } catch (sendErr) {
        console.error(LOG_PREFIX, 'Failed to send error message:', sendErr)
      }

      // Emit error event for UI
      this.emit('stream-chunk', {
        conversationJid,
        type: 'error',
        error: errorMessage,
      } as AgentStreamEvent)
    }
  }

  /**
   * Process a scheduled task for a conversation. Called by the queue service.
   */
  async processTask(conversationJid: string, task: ScheduledTask): Promise<void> {
    const conversation = this.whatsappService.getConversation(conversationJid)
    if (!conversation) {
      console.warn(LOG_PREFIX, `Conversation not found for task: ${conversationJid}`)
      return
    }

    // Create a synthetic message from the task prompt
    const syntheticMessage: WhatsAppMessage = {
      id: `task-${task.id}-${Date.now()}`,
      conversationJid,
      senderJid: 'scheduler',
      senderName: 'Scheduler',
      direction: 'inbound',
      type: 'text',
      content: `[Scheduled Task: ${task.name}]\n\n${task.prompt}`,
      timestamp: Date.now(),
      isFromMe: false,
      isProcessed: false,
    }

    // Execute with chat mode for tasks (unless the prompt suggests otherwise)
    const mode = this.detectMode(task.prompt, conversation)

    try {
      await this.executeAgent(conversation, [syntheticMessage], mode)
    } catch (err) {
      console.error(LOG_PREFIX, `Task execution failed: ${task.id}`, err)

      try {
        await this.whatsappService.sendMessage(
          conversationJid,
          `Scheduled task "${task.name}" failed:\n${err instanceof Error ? err.message : String(err)}`,
        )
      } catch {
        // Ignore send errors
      }
    }
  }

  // ==========================================================================
  // Mode Detection
  // ==========================================================================

  /**
   * Detect the agent mode from a message. Checks explicit command prefixes first,
   * then falls back to natural language pattern analysis.
   */
  detectMode(message: string, conversation: WhatsAppConversation): WhatsAppAgentMode {
    // Check for per-conversation override
    const override = this.modeOverrides.get(conversation.jid)
    if (override && override !== 'auto') {
      return override
    }

    // Check conversation default if not auto
    if (conversation.agentMode !== 'auto') {
      return conversation.agentMode
    }

    // Check explicit command prefixes
    const trimmed = message.trim().toLowerCase()
    for (const [prefix, mode] of Object.entries(EXPLICIT_COMMAND_MAP)) {
      if (trimmed.startsWith(prefix)) {
        return mode
      }
    }

    // Natural language analysis
    for (const { mode, patterns } of MODE_KEYWORD_PATTERNS) {
      for (const pattern of patterns) {
        if (pattern.test(message)) {
          return mode
        }
      }
    }

    // Default to chat mode
    return 'chat'
  }

  /**
   * Set a mode override for a conversation.
   */
  setConversationMode(jid: string, mode: WhatsAppAgentMode): void {
    if (mode === 'auto') {
      this.modeOverrides.delete(jid)
    } else {
      this.modeOverrides.set(jid, mode)
    }
    this.emit('mode-switched', { jid, mode })
  }

  /**
   * Get the current mode for a conversation.
   */
  getConversationMode(jid: string): WhatsAppAgentMode {
    return this.modeOverrides.get(jid) ?? 'auto'
  }

  // ==========================================================================
  // Agent Execution
  // ==========================================================================

  /**
   * Core agent execution flow:
   * 1. Get mode config
   * 2. Build context (identity + memory + project CLAUDE.md)
   * 3. Format messages as XML
   * 4. Create MCP servers
   * 5. Execute SDK query with streaming
   * 6. Stream chunks to IPC + send final response to WhatsApp
   * 7. Update memory + track cost
   */
  private async executeAgent(
    conversation: WhatsAppConversation,
    messages: WhatsAppMessage[],
    mode: WhatsAppAgentMode,
  ): Promise<void> {
    const config = this.configStore.getWhatsAppConfig()
    const modeConfig = config.modeConfigs[mode] ?? config.modeConfigs.chat
    const jid = conversation.jid

    console.log(LOG_PREFIX, `Executing agent for ${jid} in ${mode} mode (model: ${modeConfig.model})`)

    // Emit stream start
    this.emit('stream-chunk', {
      conversationJid: jid,
      type: 'start',
      mode,
    } as AgentStreamEvent)

    // Send typing indicator
    try {
      await this.whatsappService.sendTypingIndicator(jid)
    } catch {
      // Non-critical
    }

    // 0a. Insert user message episodes (sync writes for immediate consistency)
    if (this.episodeStore) {
      const sessionId = this.sessions.get(jid) ?? `wa-${jid}-${Date.now()}`
      for (const msg of messages) {
        try {
          this.episodeStore.insertEpisode(
            sessionId,
            'whatsapp',
            jid,
            'user',
            msg.content,
          )
        } catch (err) {
          console.warn(LOG_PREFIX, 'Failed to insert user episode:', err)
        }
      }
    }

    // 0b. Run pre-response hooks (can abort the operation)
    if (this.hooksService) {
      const hookCtx: HookContext = {
        event: 'agent:respond',
        phase: 'pre',
        data: {
          jid,
          mode,
          messageCount: messages.length,
          latestContent: messages[messages.length - 1]?.content ?? '',
        },
        timestamp: new Date().toISOString(),
      }
      const hookResult = await this.hooksService.run('agent:respond', 'pre', hookCtx)
      if (hookResult && !hookResult.continue) {
        console.log(LOG_PREFIX, `Pre-response hook aborted execution for ${jid}`)
        this.emit('stream-chunk', {
          conversationJid: jid,
          type: 'complete',
          text: '',
          mode,
        } as AgentStreamEvent)
        return
      }
    }

    // 1. Build system prompt context
    const systemPrompt = await this.buildSystemPrompt(conversation, messages, mode, modeConfig)

    // 2. Format messages as XML (NanoClaw pattern)
    const xmlMessages = this.formatMessagesAsXml(conversation, messages)

    // 3. Strip explicit command prefix from the user prompt
    const userPrompt = this.stripCommandPrefix(
      messages.map((m) => m.content).join('\n\n'),
    )

    // 4. Build the combined prompt
    const fullPrompt = `${xmlMessages}\n\n${userPrompt}`

    // 5. Get SDK and create MCP servers
    const sdk = await getSDK()

    const whatsappMcpServer = this.createWhatsAppMcpServer(sdk)
    const memoryMcpServer = this.createMemoryMcpServer(sdk)
    const bvsMcpServer = this.createBvsMcpServer(sdk)
    const taskMcpServer = this.createTaskMcpServer(sdk)

    // Create self-tools MCP server if skills services are available
    let selfToolsMcpServer: ReturnType<typeof sdk.createSdkMcpServer> | null = null
    if (this.skillsManager && this.skillsConfigStore) {
      selfToolsMcpServer = createAgentSelfToolsMcpServer(
        sdk,
        this.skillsManager,
        this.skillsConfigStore,
        this.patternCrystallizer,
      )
    }

    // 6. Build SDK options
    const abortController = new AbortController()
    this.activeAbortControllers.set(jid, abortController)

    const cliPath = getClaudeCodeCliPath()

    const sdkEnv: Record<string, string | undefined> = {
      ...process.env,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      CLAUDE_API_KEY: process.env.CLAUDE_API_KEY,
      HOME: process.env.HOME || process.env.USERPROFILE || '',
      USERPROFILE: process.env.USERPROFILE || process.env.HOME || '',
      PATH: process.env.PATH,
    }

    const cwd = conversation.projectPath || process.cwd()

    const options: Options = {
      model: modeConfig.model,
      maxTurns: modeConfig.maxTurns,
      maxBudgetUsd: modeConfig.maxBudgetUsd,
      cwd,
      systemPrompt,
      includePartialMessages: true,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      abortController,
      env: sdkEnv,
      mcpServers: {
        'whatsapp-tools': whatsappMcpServer,
        'memory-tools': memoryMcpServer,
        'bvs-tools': bvsMcpServer,
        'task-tools': taskMcpServer,
        ...(selfToolsMcpServer ? { 'agent-self-tools': selfToolsMcpServer } : {}),
      },
      allowedTools: ['mcp__*'],
      ...(cliPath ? { pathToClaudeCodeExecutable: cliPath } : {}),
      // Resume session if one exists for this conversation
      ...(this.sessions.has(jid) ? { resume: this.sessions.get(jid) } : {}),
    }

    // 7. Create message generator
    async function* generateMessages(): AsyncGenerator<SDKUserMessage> {
      yield {
        type: 'user' as const,
        message: {
          role: 'user' as const,
          content: fullPrompt,
        },
        parent_tool_use_id: null,
        session_id: '',
      } as SDKUserMessage
    }

    // 8. Execute query with streaming
    let responseText = ''
    let totalCostUsd = 0
    let totalTokensInput = 0
    let totalTokensOutput = 0
    let sessionId: string | null = null

    try {
      const queryResult = sdk.query({
        prompt: generateMessages(),
        options,
      })

      for await (const message of queryResult) {
        // Capture session ID
        if (message.type === 'system' && (message as any).subtype === 'init') {
          sessionId = (message as any).session_id
          if (sessionId) {
            this.sessions.set(jid, sessionId)
          }
        }

        // Handle streaming text
        if (message.type === 'assistant') {
          const content = (message as any).message?.content
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === 'text' && block.text) {
                // Only emit new text (assistant messages may repeat previous content)
                const newText = block.text
                if (newText.length > responseText.length && newText.startsWith(responseText)) {
                  const chunk = newText.slice(responseText.length)
                  responseText = newText

                  this.emit('stream-chunk', {
                    conversationJid: jid,
                    type: 'chunk',
                    text: chunk,
                  } as AgentStreamEvent)
                }
              }
            }
          }
        }

        // Handle partial streaming messages
        if (message.type === 'stream_event' && (message as any).event) {
          const event = (message as any).event as {
            type: string
            delta?: { text?: string }
          }
          if (event.type === 'content_block_delta' && event.delta?.text) {
            const chunk = event.delta.text
            responseText += chunk

            this.emit('stream-chunk', {
              conversationJid: jid,
              type: 'chunk',
              text: chunk,
            } as AgentStreamEvent)
          }
        }

        // Handle result message with cost data
        if (message.type === 'result') {
          const resultMsg = message as any
          totalCostUsd = resultMsg.total_cost_usd || 0
          totalTokensInput = resultMsg.usage?.input_tokens || resultMsg.usage?.inputTokens || 0
          totalTokensOutput = resultMsg.usage?.output_tokens || resultMsg.usage?.outputTokens || 0

          // Capture final text from result
          if (resultMsg.result && typeof resultMsg.result === 'string' && resultMsg.result.length > responseText.length) {
            responseText = resultMsg.result
          }

          console.log(
            LOG_PREFIX,
            `Query complete: cost=$${totalCostUsd.toFixed(4)}, tokens=${totalTokensInput}/${totalTokensOutput}`,
          )
        }
      }
    } finally {
      this.activeAbortControllers.delete(jid)
    }

    // 9. Send response to WhatsApp
    if (responseText.trim()) {
      await this.whatsappService.sendMessage(jid, responseText.trim())
    } else {
      await this.whatsappService.sendMessage(
        jid,
        'I processed your message but had no text response to send.',
      )
    }

    // 9a. Insert assistant response episode + WAL entry for async embedding
    if (this.episodeStore && responseText.trim()) {
      const epSessionId = this.sessions.get(jid) ?? sessionId ?? `wa-${jid}-${Date.now()}`
      try {
        const episodeId = this.episodeStore.insertEpisode(
          epSessionId,
          'whatsapp',
          jid,
          'assistant',
          responseText.trim(),
        )
        // Queue WAL entry for async embedding
        this.episodeStore.insertWalEntry(
          episodeId,
          'embed_episode',
          { sessionId: epSessionId, channel: 'whatsapp', sourceId: jid },
        )
      } catch (err) {
        console.warn(LOG_PREFIX, 'Failed to insert assistant episode:', err)
      }
    }

    // 9b. Fire-and-forget post-response hooks
    if (this.hooksService) {
      const postCtx: HookContext = {
        event: 'agent:respond',
        phase: 'post',
        data: {
          jid,
          mode,
          responseLength: responseText.length,
          costUsd: totalCostUsd,
        },
        timestamp: new Date().toISOString(),
      }
      this.hooksService.run('agent:respond', 'post', postCtx).catch((err) =>
        console.warn(LOG_PREFIX, 'Post-response hook error:', err),
      )
    }

    // 10. Update conversation metadata
    this.whatsappService.updateConversation(jid, {
      lastAgentResponseAt: Date.now(),
      sessionId: sessionId ?? conversation.sessionId,
    })

    // 11. Mark messages as processed
    // (Messages are stored by WhatsAppService; we update via conversation metadata)

    // 12. Track cost
    this.trackCost(jid, totalCostUsd, totalTokensInput, totalTokensOutput)

    // 13. Notify if cost exceeded threshold
    if (totalCostUsd > COST_NOTIFICATION_THRESHOLD) {
      try {
        await this.whatsappService.sendMessage(
          jid,
          `Note: This query cost $${totalCostUsd.toFixed(4)} (${totalTokensInput + totalTokensOutput} tokens).`,
        )
      } catch {
        // Non-critical
      }
    }

    // 14. Record pattern observation for crystallization
    if (this.patternCrystallizer) {
      this.patternCrystallizer.recordObservation({
        sessionId: sessionId ?? 'unknown',
        goalSummary: messages.map((m) => m.content).join(' ').slice(0, 200),
        toolSequence: ['sdk_query'], // Tool sequence would be populated from SDK events in production
        toolArgs: [],
        outcome: responseText.trim() ? 'success' : 'failure',
        durationMs: Date.now() - Date.now(), // Would use actual timing
        costUsd: totalCostUsd,
        timestamp: Date.now(),
        source: 'whatsapp',
      })
    }

    // 15. Index conversation into memory (async, non-blocking)
    // Only use legacy vector indexing if episodeStore is not available
    // (when episodeStore is present, the WAL entry from step 9a handles async embedding)
    if (!this.episodeStore) {
      const memConfig = config.memory
      if (memConfig.enabled && memConfig.autoIndexConversations) {
        this.memoryService
          .indexConversation(jid, messages)
          .catch((err) => console.warn(LOG_PREFIX, 'Memory indexing failed:', err))
      }
    }

    // 15. Emit stream complete
    this.emit('stream-chunk', {
      conversationJid: jid,
      type: 'complete',
      text: responseText,
      costUsd: totalCostUsd,
      mode,
    } as AgentStreamEvent)
  }

  // ==========================================================================
  // Context Building
  // ==========================================================================

  /**
   * Build the system prompt by combining identity, memory search results,
   * and project context.
   */
  private async buildSystemPrompt(
    conversation: WhatsAppConversation,
    messages: WhatsAppMessage[],
    mode: WhatsAppAgentMode,
    _modeConfig: AgentModeConfig,
  ): Promise<string> {
    const parts: string[] = []

    // 1. Identity context (SOUL.md + USER.md + mode instructions + environment)
    const identityContext = this.identityService.buildSystemPromptContext(
      mode,
      conversation.projectPath,
    )
    if (identityContext) {
      parts.push(identityContext)
    }

    // 2. Memory search for relevant context
    const memoryContext = await this.buildMemoryContext(messages)
    if (memoryContext) {
      parts.push(memoryContext)
    }

    // 3. Available skills context
    if (this.skillsManager) {
      const skills = this.skillsManager.listSkills().filter((s) => s.active)
      if (skills.length > 0) {
        const skillLines = skills.map((s) => {
          const triggers = s.frontmatter.triggers
            .map((t) => t.command || t.cron || t.keywords?.join(',') || t.event || '')
            .filter(Boolean)
            .join(', ')
          return `- ${s.frontmatter.name} (${s.id}): ${s.frontmatter.description} [triggers: ${triggers}]`
        })
        parts.push(
          `# Available Skills\n\nYou have ${skills.length} skills available. Use the agent-self-tools MCP to manage them.\n\n${skillLines.join('\n')}`,
        )
      }
    }

    // 4. Conversation cost summary
    const costSummary = this.getCostSummary(conversation.jid)
    if (costSummary) {
      parts.push(costSummary)
    }

    // 5. Context Manager budgeting (if available)
    if (this.contextManager) {
      const assembled = this.contextManager.assembleContext({
        systemPrompt: parts[0] ?? '',
        memoryContext: memoryContext ?? '',
        recentMessages: messages.map((m) => ({
          role: m.isFromMe ? 'assistant' : 'user',
          content: m.content,
        })),
      })
      // Return the budgeted assembly as a single string
      return assembled.sections.map((s) => s.content).join('\n\n---\n\n')
    }

    return parts.join('\n\n---\n\n')
  }

  /**
   * Search vector memory for relevant context based on the incoming messages.
   */
  private async buildMemoryContext(messages: WhatsAppMessage[]): Promise<string | null> {
    const config = this.configStore.getWhatsAppConfig()
    if (!config.memory.enabled) return null

    try {
      // Build query from the latest messages
      const queryText = messages
        .map((m) => m.content)
        .join(' ')
        .slice(0, 500) // Limit query length

      const results: MemorySearchResult[] = await this.memoryService.search({
        query: queryText,
        limit: MAX_MEMORY_RESULTS,
        minScore: MIN_MEMORY_SCORE,
      })

      if (results.length === 0) return null

      const memoryLines = results.map(
        (r) =>
          `[Memory: ${r.chunk.source}/${r.chunk.sourceId} (score: ${r.score.toFixed(2)})]\n${r.chunk.content}`,
      )

      return `# Relevant Memory\n\n${memoryLines.join('\n\n')}`
    } catch (err) {
      console.warn(LOG_PREFIX, 'Memory search failed:', err)
      return null
    }
  }

  // ==========================================================================
  // XML Message Formatting (NanoClaw Pattern)
  // ==========================================================================

  /**
   * Format messages as XML for the agent, following the NanoClaw pattern.
   */
  private formatMessagesAsXml(
    conversation: WhatsAppConversation,
    messages: WhatsAppMessage[],
  ): string {
    const lines: string[] = []
    lines.push(
      `<new_messages conversation="${this.escapeXml(conversation.name)}" jid="${this.escapeXml(conversation.jid)}">`,
    )

    for (const msg of messages) {
      const time = new Date(msg.timestamp).toISOString()
      const sender = this.escapeXml(msg.senderName || msg.senderJid)
      const content = this.escapeXml(msg.content)
      lines.push(`<msg sender="${sender}" time="${time}">${content}</msg>`)
    }

    lines.push('</new_messages>')
    return lines.join('\n')
  }

  /**
   * Escape special XML characters in text.
   */
  private escapeXml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')
  }

  /**
   * Strip explicit command prefixes (e.g., /fix, /research) from the user prompt.
   */
  private stripCommandPrefix(text: string): string {
    for (const prefix of Object.keys(EXPLICIT_COMMAND_MAP)) {
      if (text.trim().toLowerCase().startsWith(prefix)) {
        return text.trim().slice(prefix.length).trim()
      }
    }
    return text
  }

  // ==========================================================================
  // Cost Tracking
  // ==========================================================================

  /**
   * Track cost for a conversation query.
   */
  private trackCost(
    jid: string,
    costUsd: number,
    tokensInput: number,
    tokensOutput: number,
  ): void {
    const existing = this.costs.get(jid) ?? {
      totalCostUsd: 0,
      totalTokensInput: 0,
      totalTokensOutput: 0,
      queryCount: 0,
      lastQueryCostUsd: 0,
    }

    existing.totalCostUsd += costUsd
    existing.totalTokensInput += tokensInput
    existing.totalTokensOutput += tokensOutput
    existing.queryCount += 1
    existing.lastQueryCostUsd = costUsd

    this.costs.set(jid, existing)
  }

  /**
   * Get a cost summary string for system prompt context.
   */
  private getCostSummary(jid: string): string | null {
    const cost = this.costs.get(jid)
    if (!cost || cost.queryCount === 0) return null

    return [
      '# Session Cost',
      '',
      `- Queries this session: ${cost.queryCount}`,
      `- Total cost: $${cost.totalCostUsd.toFixed(4)}`,
      `- Last query: $${cost.lastQueryCostUsd.toFixed(4)}`,
    ].join('\n')
  }

  /**
   * Get cost tracking data for a conversation (public accessor).
   */
  getConversationCost(jid: string): ConversationCost | undefined {
    return this.costs.get(jid)
  }

  // ==========================================================================
  // MCP Server Factories
  // ==========================================================================

  /**
   * Create the WhatsApp tools MCP server.
   * Tools: send_whatsapp_message, react_to_message, list_conversations, get_conversation_history
   */
  private createWhatsAppMcpServer(
    sdk: typeof import('@anthropic-ai/claude-agent-sdk'),
  ): ReturnType<typeof sdk.createSdkMcpServer> {
    const toolResult = (text: string) => ({
      content: [{ type: 'text' as const, text }],
    })

    return sdk.createSdkMcpServer({
      name: 'whatsapp-tools',
      tools: [
        sdk.tool(
          'send_whatsapp_message',
          'Send a text message to a WhatsApp conversation',
          {
            jid: z.string().describe('The conversation JID to send the message to'),
            text: z.string().describe('The message text to send'),
          },
          async (input) => {
            try {
              await this.whatsappService.sendMessage(input.jid, input.text)
              return toolResult(`Message sent to ${input.jid}`)
            } catch (e: any) {
              return toolResult(`Error sending message: ${e.message}`)
            }
          },
        ),
        sdk.tool(
          'react_to_message',
          'React to a specific WhatsApp message with an emoji',
          {
            jid: z.string().describe('The conversation JID'),
            message_id: z.string().describe('The message ID to react to'),
            emoji: z.string().describe('The emoji reaction to send'),
          },
          async (input) => {
            try {
              // Look up the message to get its Baileys key
              const messages = this.whatsappService.getMessages(input.jid)
              const msg = messages.find((m) => m.id === input.message_id)
              if (!msg?.metadata?.baileysMessageKey) {
                return toolResult('Message not found or missing message key')
              }
              await this.whatsappService.sendReaction(
                input.jid,
                msg.metadata.baileysMessageKey as any,
                input.emoji,
              )
              return toolResult(`Reacted with ${input.emoji}`)
            } catch (e: any) {
              return toolResult(`Error reacting: ${e.message}`)
            }
          },
        ),
        sdk.tool(
          'list_conversations',
          'List all registered WhatsApp conversations',
          {},
          async () => {
            try {
              const convos = this.whatsappService.listConversations()
              const registered = convos.filter((c) => c.isRegistered)
              const summary = registered.map(
                (c) =>
                  `- ${c.name} (${c.jid}) [${c.chatType}] mode=${c.agentMode}`,
              )
              return toolResult(
                `Registered conversations (${registered.length}):\n${summary.join('\n')}`,
              )
            } catch (e: any) {
              return toolResult(`Error listing conversations: ${e.message}`)
            }
          },
        ),
        sdk.tool(
          'get_conversation_history',
          'Get recent messages from a WhatsApp conversation',
          {
            jid: z.string().describe('The conversation JID'),
            limit: z
              .number()
              .optional()
              .describe('Maximum number of messages to return (default: 20)'),
          },
          async (input) => {
            try {
              const limit = input.limit ?? 20
              const messages = this.whatsappService.getMessages(
                input.jid,
                undefined,
                limit,
              )
              const formatted = messages.map(
                (m) =>
                  `[${m.isFromMe ? 'Assistant' : m.senderName}] (${new Date(m.timestamp).toISOString()}): ${m.content}`,
              )
              return toolResult(
                `Last ${messages.length} messages:\n${formatted.join('\n')}`,
              )
            } catch (e: any) {
              return toolResult(`Error getting history: ${e.message}`)
            }
          },
        ),
      ],
    })
  }

  /**
   * Create the Memory tools MCP server.
   * Tools: search_memory, save_memory, forget_memory
   */
  private createMemoryMcpServer(
    sdk: typeof import('@anthropic-ai/claude-agent-sdk'),
  ): ReturnType<typeof sdk.createSdkMcpServer> {
    const toolResult = (text: string) => ({
      content: [{ type: 'text' as const, text }],
    })

    return sdk.createSdkMcpServer({
      name: 'memory-tools',
      tools: [
        sdk.tool(
          'search_memory',
          'Search long-term vector memory for relevant information from past conversations, projects, and notes',
          {
            query: z.string().describe('The search query'),
            limit: z
              .number()
              .optional()
              .describe('Maximum results to return (default: 5)'),
            sources: z
              .array(z.enum(['conversation', 'project', 'user_note', 'agent_learning']))
              .optional()
              .describe('Filter by memory source types'),
          },
          async (input) => {
            try {
              const results = await this.memoryService.search({
                query: input.query,
                limit: input.limit ?? 5,
                sources: input.sources as any,
              })

              if (results.length === 0) {
                return toolResult('No relevant memories found.')
              }

              const formatted = results.map(
                (r) =>
                  `[Score: ${r.score.toFixed(2)} | Source: ${r.chunk.source}/${r.chunk.sourceId}]\n${r.chunk.content}`,
              )
              return toolResult(
                `Found ${results.length} relevant memories:\n\n${formatted.join('\n\n---\n\n')}`,
              )
            } catch (e: any) {
              return toolResult(`Error searching memory: ${e.message}`)
            }
          },
        ),
        sdk.tool(
          'save_memory',
          'Save important information to long-term memory for future reference',
          {
            content: z.string().describe('The content to save'),
            source: z
              .enum(['conversation', 'project', 'user_note', 'agent_learning'])
              .describe('The type of memory source'),
            source_id: z
              .string()
              .describe('Identifier for the source (e.g., conversation JID or file path)'),
          },
          async (input) => {
            try {
              const count = await this.memoryService.indexText(
                input.source,
                input.source_id,
                input.content,
              )
              return toolResult(`Saved ${count} memory chunks from the provided content.`)
            } catch (e: any) {
              return toolResult(`Error saving memory: ${e.message}`)
            }
          },
        ),
        sdk.tool(
          'forget_memory',
          'Delete a specific memory chunk by its source',
          {
            source: z
              .enum(['conversation', 'project', 'user_note', 'agent_learning'])
              .describe('The memory source type'),
            source_id: z
              .string()
              .describe('The source identifier to delete memories for'),
          },
          async (input) => {
            try {
              const count = await this.memoryService.deleteBySource(
                input.source,
                input.source_id,
              )
              return toolResult(`Deleted ${count} memory chunks.`)
            } catch (e: any) {
              return toolResult(`Error deleting memory: ${e.message}`)
            }
          },
        ),
      ],
    })
  }

  /**
   * Create the BVS tools MCP server.
   * Tools: list_projects, get_project_status, create_bvs_plan, get_bvs_progress
   */
  private createBvsMcpServer(
    sdk: typeof import('@anthropic-ai/claude-agent-sdk'),
  ): ReturnType<typeof sdk.createSdkMcpServer> {
    const toolResult = (text: string) => ({
      content: [{ type: 'text' as const, text }],
    })

    return sdk.createSdkMcpServer({
      name: 'bvs-tools',
      tools: [
        sdk.tool(
          'list_projects',
          'List all known projects from recent projects and registered conversations',
          {},
          async () => {
            try {
              const recentProjects = this.configStore.get('recentProjects') ?? []
              const conversations = this.whatsappService.listConversations()
              const projectPaths = new Set<string>()

              for (const p of recentProjects) {
                projectPaths.add(p)
              }
              for (const c of conversations) {
                if (c.projectPath) {
                  projectPaths.add(c.projectPath)
                }
              }

              if (projectPaths.size === 0) {
                return toolResult('No known projects found.')
              }

              const projectList = Array.from(projectPaths)
                .map((p) => `- ${p}`)
                .join('\n')
              return toolResult(
                `Known projects (${projectPaths.size}):\n${projectList}`,
              )
            } catch (e: any) {
              return toolResult(`Error listing projects: ${e.message}`)
            }
          },
        ),
        sdk.tool(
          'get_project_status',
          'Get the current status of a project (git status, recent changes)',
          {
            project_path: z.string().describe('Absolute path to the project directory'),
          },
          async (input) => {
            try {
              const { execSync } = require('child_process')
              const gitStatus = execSync('git status --short', {
                cwd: input.project_path,
                encoding: 'utf-8',
                timeout: 10000,
              }).trim()

              const gitLog = execSync('git log --oneline -5', {
                cwd: input.project_path,
                encoding: 'utf-8',
                timeout: 10000,
              }).trim()

              const gitBranch = execSync('git branch --show-current', {
                cwd: input.project_path,
                encoding: 'utf-8',
                timeout: 10000,
              }).trim()

              return toolResult(
                [
                  `Project: ${input.project_path}`,
                  `Branch: ${gitBranch}`,
                  '',
                  'Git Status:',
                  gitStatus || '(clean)',
                  '',
                  'Recent Commits:',
                  gitLog,
                ].join('\n'),
              )
            } catch (e: any) {
              return toolResult(`Error getting project status: ${e.message}`)
            }
          },
        ),
        sdk.tool(
          'create_bvs_plan',
          'Create a BVS (Bounded Verified Section) plan for implementing a complex feature. This triggers the BVS planning flow in the desktop app.',
          {
            project_path: z.string().describe('Absolute path to the project directory'),
            description: z
              .string()
              .describe('Description of the feature to implement'),
          },
          async (input) => {
            try {
              // Emit an event that the IPC handlers can forward to the BVS planning system
              this.emit('bvs-plan-requested', {
                projectPath: input.project_path,
                description: input.description,
                source: 'whatsapp',
              })

              return toolResult(
                `BVS planning request submitted for: ${input.description}\n` +
                  `Project: ${input.project_path}\n` +
                  'The plan will be created in the desktop app. You will receive a notification when it is ready for review.',
              )
            } catch (e: any) {
              return toolResult(`Error creating BVS plan: ${e.message}`)
            }
          },
        ),
        sdk.tool(
          'get_bvs_progress',
          'Get the current progress of BVS execution for a project',
          {
            project_path: z.string().describe('Absolute path to the project directory'),
          },
          async (input) => {
            try {
              // Emit event to query BVS orchestrator state
              // The response comes asynchronously through the event system
              this.emit('bvs-progress-requested', {
                projectPath: input.project_path,
              })

              return toolResult(
                `BVS progress query submitted for: ${input.project_path}\n` +
                  'Check the desktop app for detailed progress information.',
              )
            } catch (e: any) {
              return toolResult(`Error getting BVS progress: ${e.message}`)
            }
          },
        ),
      ],
    })
  }

  /**
   * Create the Task tools MCP server.
   * Tools: schedule_task, list_tasks, cancel_task, pause_task, resume_task
   */
  private createTaskMcpServer(
    sdk: typeof import('@anthropic-ai/claude-agent-sdk'),
  ): ReturnType<typeof sdk.createSdkMcpServer> {
    const toolResult = (text: string) => ({
      content: [{ type: 'text' as const, text }],
    })

    return sdk.createSdkMcpServer({
      name: 'task-tools',
      tools: [
        sdk.tool(
          'schedule_task',
          'Create a new scheduled task that runs a prompt on a cron schedule, interval, or one-time',
          {
            name: z.string().describe('Human-readable name for the task'),
            prompt: z.string().describe('The prompt to execute when the task runs'),
            schedule_type: z
              .enum(['cron', 'interval', 'once'])
              .describe('How the task is scheduled'),
            schedule_value: z
              .string()
              .describe(
                'Cron expression (e.g., "0 9 * * *"), interval in ms (e.g., "3600000"), or ISO timestamp',
              ),
            context_mode: z
              .enum(['conversation', 'isolated'])
              .optional()
              .describe(
                'Whether to run in conversation context or isolated (default: isolated)',
              ),
          },
          async (input) => {
            try {
              // Emit event for the TaskSchedulerService to handle
              this.emit('task-schedule-requested', {
                name: input.name,
                prompt: input.prompt,
                scheduleType: input.schedule_type,
                scheduleValue: input.schedule_value,
                contextMode: input.context_mode ?? 'isolated',
              })

              return toolResult(
                `Task "${input.name}" scheduled (${input.schedule_type}: ${input.schedule_value}).`,
              )
            } catch (e: any) {
              return toolResult(`Error scheduling task: ${e.message}`)
            }
          },
        ),
        sdk.tool(
          'list_tasks',
          'List all scheduled tasks, optionally filtered by status',
          {
            status: z
              .enum(['active', 'paused', 'completed', 'failed'])
              .optional()
              .describe('Filter by task status'),
          },
          async (input) => {
            try {
              // Emit event for TaskSchedulerService
              // We return a placeholder since the actual data comes through the event system
              this.emit('task-list-requested', {
                status: input.status,
              })

              return toolResult(
                'Task list requested. Check the desktop app for the full list of scheduled tasks.',
              )
            } catch (e: any) {
              return toolResult(`Error listing tasks: ${e.message}`)
            }
          },
        ),
        sdk.tool(
          'cancel_task',
          'Cancel (delete) a scheduled task by its ID',
          {
            task_id: z.string().describe('The task ID to cancel'),
          },
          async (input) => {
            try {
              this.emit('task-cancel-requested', { taskId: input.task_id })
              return toolResult(`Task ${input.task_id} cancellation requested.`)
            } catch (e: any) {
              return toolResult(`Error cancelling task: ${e.message}`)
            }
          },
        ),
        sdk.tool(
          'pause_task',
          'Pause a running scheduled task',
          {
            task_id: z.string().describe('The task ID to pause'),
          },
          async (input) => {
            try {
              this.emit('task-pause-requested', { taskId: input.task_id })
              return toolResult(`Task ${input.task_id} pause requested.`)
            } catch (e: any) {
              return toolResult(`Error pausing task: ${e.message}`)
            }
          },
        ),
        sdk.tool(
          'resume_task',
          'Resume a paused scheduled task',
          {
            task_id: z.string().describe('The task ID to resume'),
          },
          async (input) => {
            try {
              this.emit('task-resume-requested', { taskId: input.task_id })
              return toolResult(`Task ${input.task_id} resume requested.`)
            } catch (e: any) {
              return toolResult(`Error resuming task: ${e.message}`)
            }
          },
        ),
      ],
    })
  }

  // ==========================================================================
  // Session Management
  // ==========================================================================

  /**
   * Get the current session ID for a conversation.
   */
  getSessionId(jid: string): string | undefined {
    return this.sessions.get(jid)
  }

  /**
   * Clear the session for a conversation, starting a fresh conversation next time.
   */
  clearSession(jid: string): void {
    this.sessions.delete(jid)
  }

  /**
   * Abort the currently running agent query for a conversation, if any.
   */
  abortQuery(jid: string): boolean {
    const controller = this.activeAbortControllers.get(jid)
    if (controller) {
      controller.abort()
      this.activeAbortControllers.delete(jid)
      console.log(LOG_PREFIX, `Aborted query for ${jid}`)
      return true
    }
    return false
  }

  // ==========================================================================
  // Cleanup
  // ==========================================================================

  /**
   * Clean up resources when shutting down.
   */
  async destroy(): Promise<void> {
    // Abort all active queries
    for (const [jid, controller] of this.activeAbortControllers) {
      controller.abort()
      console.log(LOG_PREFIX, `Aborted active query for ${jid} during shutdown`)
    }
    this.activeAbortControllers.clear()
    this.sessions.clear()
    this.modeOverrides.clear()
    this.costs.clear()
    this.removeAllListeners()
  }
}

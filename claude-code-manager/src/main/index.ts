import { app, BrowserWindow, shell, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerIpcHandlers } from './ipc'
import { SessionManager } from './services/session-manager'
import { ConfigStore } from './services/config-store'
import { BrowserBridge } from './services/browser-bridge'
import { DevServerManager } from './services/dev-server'
import { DiscoveryChatService } from './services/discovery-chat-service'
import { DiscoveryChatServiceSDK } from './services/discovery-chat-service-sdk'
import { ResearchAgentRunner } from './services/research-agent-runner'
import { startApiServer, stopApiServer, getApiServer, type ApiServerConfig } from './api-server'
import { networkInterfaces } from 'os'

// WhatsApp services
import { WhatsAppService } from './services/whatsapp-service'
import { WhatsAppAgentService } from './services/whatsapp-agent-service'
import { VectorMemoryService } from './services/vector-memory-service'
import { GroupQueueService } from './services/group-queue-service'
import { AgentIdentityService } from './services/agent-identity-service'
import { TaskSchedulerService } from './services/task-scheduler-service'
import { HeartbeatService } from './services/heartbeat-service'
import { registerWhatsAppHandlers } from './ipc/whatsapp-handlers'

// Self-extension services
import { SkillsManagerService } from './services/skills-manager-service'
import { SkillsConfigStore } from './services/skills-config-store'
import { SkillExecutorService } from './services/skill-executor-service'
import { PatternCrystallizerService } from './services/pattern-crystallizer-service'

// Telegram + Channel Router services
import { TelegramService } from './services/telegram-service'
import { ChannelRouterService } from './services/channel-router-service'
import { registerTelegramHandlers, registerChannelUxHandlers } from './ipc/telegram-handlers'
import { getSettingsDeps } from './ipc/settings-handlers'
import type { TelegramConfig } from '@shared/channel-types'

// LLM Router services
import { OpenRouterService } from './services/openrouter-service'
import { LlmRouterService } from './services/llm-router-service'

// Enhanced Channel UX
import { ChannelUxService } from './services/channel-ux-service'

// Unified Agent Architecture services
import { EpisodeStoreService } from './services/episode-store-service'
import { HooksService } from './services/hooks-service'
import { MarkdownSyncService } from './services/markdown-sync-service'
import { ContextManagerService } from './services/context-manager-service'
import { HealthCheckService } from './services/health-check-service'
import { SemanticMemoryService } from './services/semantic-memory-service'
import { ConsolidationService } from './services/consolidation-service'

// Settings IPC handlers
import { registerSettingsHandlers } from './ipc/settings-handlers'

/**
 * Get all local IP addresses for the machine
 */
function getLocalAddresses(): string[] {
  const addresses: string[] = []
  const nets = networkInterfaces()

  for (const name of Object.keys(nets)) {
    const netInterfaces = nets[name]
    if (!netInterfaces) continue

    for (const net of netInterfaces) {
      // Skip internal and non-IPv4 addresses
      if (net.internal) continue
      if (net.family === 'IPv4') {
        addresses.push(net.address)
      }
    }
  }

  // Always include localhost
  if (!addresses.includes('127.0.0.1')) {
    addresses.unshift('127.0.0.1')
  }

  return addresses
}

// Global references
let mainWindow: BrowserWindow | null = null
export let sessionManager: SessionManager
export let configStore: ConfigStore
export let browserBridge: BrowserBridge
export let devServerManager: DevServerManager
export let discoveryChatService: DiscoveryChatService
export let discoveryChatServiceSDK: DiscoveryChatServiceSDK
export let researchAgentRunner: ResearchAgentRunner

// WhatsApp service references (conditionally initialized)
export let whatsappService: WhatsAppService | null = null
export let whatsappAgentService: WhatsAppAgentService | null = null
export let vectorMemoryService: VectorMemoryService | null = null
export let groupQueueService: GroupQueueService | null = null
export let agentIdentityService: AgentIdentityService | null = null
export let taskSchedulerService: TaskSchedulerService | null = null
export let heartbeatService: HeartbeatService | null = null

// Self-extension service references
export let skillsManager: SkillsManagerService | null = null
export let skillsConfigStore: SkillsConfigStore | null = null
export let skillExecutor: SkillExecutorService | null = null
export let patternCrystallizer: PatternCrystallizerService | null = null

// Telegram + Channel Router references
export let telegramService: TelegramService | null = null
export let channelRouter: ChannelRouterService | null = null

// LLM Router references
export let openRouterService: OpenRouterService | null = null
export let llmRouterService: LlmRouterService | null = null

// Enhanced Channel UX reference
export let channelUxService: ChannelUxService | null = null

// Unified Agent Architecture service references
export let episodeStore: EpisodeStoreService | null = null
export let hooksService: HooksService | null = null
export let markdownSyncService: MarkdownSyncService | null = null
export let contextManagerService: ContextManagerService | null = null
export let healthCheckService: HealthCheckService | null = null
export let semanticMemoryService: SemanticMemoryService | null = null
export let consolidationService: ConsolidationService | null = null

// Feature flag for SDK vs CLI discovery chat
export const USE_SDK_DISCOVERY = true

// Connection mode: 'standalone' | 'server' | 'client'
export type ConnectionMode = 'standalone' | 'server' | 'client'

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    // Ensure 1:1 zoom factor for crisp text rendering
    mainWindow?.webContents.setZoomFactor(1.0)
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Load the app
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Global error handlers to prevent app crashes from unhandled errors
// These catch errors from Agent SDK subprocess issues (write EOF, etc.)
process.on('uncaughtException', (error) => {
  console.error('[Main] Uncaught exception:', error.message)
  console.error('[Main] Stack:', error.stack)
  // Don't crash the app - just log it
  // Common errors like "write EOF" from Agent SDK are non-fatal
})

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Main] Unhandled rejection at:', promise)
  console.error('[Main] Reason:', reason)
  // Don't crash the app - just log it
})

// App lifecycle
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.personal.claude-code-manager')

  // Initialize services
  configStore = new ConfigStore()
  sessionManager = new SessionManager()
  browserBridge = new BrowserBridge()
  devServerManager = new DevServerManager()
  discoveryChatService = new DiscoveryChatService(configStore)
  discoveryChatServiceSDK = new DiscoveryChatServiceSDK()
  researchAgentRunner = new ResearchAgentRunner(configStore)

  console.log('[Main] Discovery chat using:', USE_SDK_DISCOVERY ? 'Agent SDK (fast)' : 'CLI (legacy)')

  // Register IPC handlers
  registerIpcHandlers()

  // Register API server IPC handlers
  registerApiServerHandlers()

  // Check if we should auto-start the API server
  const serverConfig = configStore.get('apiServer')
  if (serverConfig?.enabled) {
    console.log('[Main] Auto-starting API server on port', serverConfig.port || 3000)
    startApiServer({
      port: serverConfig.port || 3000,
      enableAuth: serverConfig.authEnabled ?? true
    }).then((server) => {
      console.log('[Main] API server started, auth token:', server.getAuthToken())
    }).catch((err) => {
      console.error('[Main] Failed to start API server:', err)
    })
  }

  // Initialize WhatsApp services (async, conditional)
  ;(async () => {
    try {
      const whatsappConfig = configStore.getWhatsAppConfig()
      if (!whatsappConfig?.enabled) {
        console.log('[Main] WhatsApp integration disabled')
        return
      }

      console.log('[Main] Initializing WhatsApp services...')

      // Phase 2 services (no inter-dependencies)
      agentIdentityService = new AgentIdentityService(configStore)
      vectorMemoryService = new VectorMemoryService(configStore)
      groupQueueService = new GroupQueueService(whatsappConfig.maxConcurrentAgents || 3)
      whatsappService = new WhatsAppService(configStore)

      // Initialize async services
      await agentIdentityService.initialize()
      await vectorMemoryService.initialize()

      // Initialize Unified Agent Architecture services
      const db = vectorMemoryService.getDb()

      // Episode Store (synchronous writes + WAL background worker)
      episodeStore = new EpisodeStoreService(db)
      episodeStore.startBackgroundWorker()
      console.log('[Main] Episode Store initialized')

      // Hooks Service
      hooksService = new HooksService()
      console.log('[Main] Hooks Service initialized')

      // Markdown Sync Service
      const workspacePath = (agentIdentityService as any).getWorkspacePath?.()
        || join(app.getPath('userData'), 'whatsapp-workspace')
      markdownSyncService = new MarkdownSyncService(episodeStore, workspacePath)
      console.log('[Main] Markdown Sync initialized')

      // Context Manager
      contextManagerService = new ContextManagerService(episodeStore)
      console.log('[Main] Context Manager initialized')

      // Health Check Service
      healthCheckService = new HealthCheckService(db)
      console.log('[Main] Health Check Service initialized')

      // Semantic Memory Service
      semanticMemoryService = new SemanticMemoryService(db)
      await semanticMemoryService.initialize()
      console.log('[Main] Semantic Memory initialized')

      // Consolidation Service
      consolidationService = new ConsolidationService(episodeStore, semanticMemoryService)
      console.log('[Main] Consolidation Service initialized')

      // Phase 3 services (depend on Phase 2)
      whatsappAgentService = new WhatsAppAgentService(
        whatsappService, vectorMemoryService, agentIdentityService, groupQueueService, configStore
      )
      taskSchedulerService = new TaskSchedulerService(groupQueueService, whatsappService)
      heartbeatService = new HeartbeatService(
        whatsappService, agentIdentityService, configStore,
        null, // ideasManager - can be wired later if needed
        null  // bvsOrchestrator - can be wired later if needed
      )

      // Initialize agent service (registers message-received listener)
      await whatsappAgentService.initialize()

      // Wire queue processing functions (overrides the ones set in initialize, same effect)
      groupQueueService.setProcessMessagesFn((jid: string) => whatsappAgentService!.processMessages(jid))
      groupQueueService.setProcessTaskFn((jid: string, task: any) => whatsappAgentService!.processTask(jid, task))

      // Register IPC handlers for WhatsApp (must happen after service creation)
      registerWhatsAppHandlers(
        whatsappService,
        whatsappAgentService,
        vectorMemoryService,
        taskSchedulerService,
        heartbeatService,
        agentIdentityService,
        configStore
      )

      // Auto-connect if configured
      if (whatsappConfig.autoConnect) {
        whatsappService.connect().catch((err: Error) =>
          console.error('[Main] WhatsApp auto-connect failed:', err.message)
        )
      }

      // Start scheduler
      taskSchedulerService.start()

      // Start heartbeat if enabled
      if (whatsappConfig.heartbeat?.enabled) {
        heartbeatService.start()
      }

      // Initialize self-extension services
      console.log('[Main] Initializing self-extension services...')
      skillsConfigStore = new SkillsConfigStore()
      await skillsConfigStore.loadImmutableConfig()

      skillsManager = new SkillsManagerService()
      await skillsManager.initialize()

      patternCrystallizer = new PatternCrystallizerService(skillsManager, skillsConfigStore)

      // Initialize pattern crystallizer with SQLite (Phase 7 - Procedural Persistence)
      if (db) {
        await patternCrystallizer.initialize(db)
      }

      skillExecutor = new SkillExecutorService(skillsManager, skillsConfigStore)

      // Wire skill executor to send output via WhatsApp
      skillExecutor.setSendToChannel(async (message: string) => {
        if (whatsappService?.isConnected()) {
          const config = configStore.getWhatsAppConfig()
          if (config.heartbeat?.targetConversationJid) {
            await whatsappService.sendMessage(config.heartbeat.targetConversationJid, message)
          }
        }
      })

      // Wire skills into the agent service
      whatsappAgentService.setSkillsServices(skillsManager, skillsConfigStore, patternCrystallizer)

      // Wire Unified Agent Architecture memory services into the agent
      if (episodeStore && hooksService && contextManagerService) {
        whatsappAgentService.setMemoryServices(episodeStore, hooksService, contextManagerService)
      }

      skillExecutor.start()
      console.log('[Main] Self-extension services initialized')

      // Initialize Channel Router
      channelRouter = new ChannelRouterService()

      // Register WhatsApp as a channel transport (adapter)
      const whatsappTransport = {
        channelType: 'whatsapp' as const,
        isConnected: () => whatsappService?.isConnected() ?? false,
        sendMessage: async (chatId: string, content: string) => {
          const msg = await whatsappService!.sendMessage(chatId, content)
          return {
            id: msg.id,
            channel: 'whatsapp' as const,
            chatId,
            senderId: msg.senderJid,
            senderName: msg.senderName,
            content: msg.content,
            timestamp: msg.timestamp,
            isFromMe: true,
          }
        },
        sendTypingIndicator: (chatId: string) =>
          whatsappService?.sendTypingIndicator(chatId) ?? Promise.resolve(),
        getPrimaryNotificationChatId: () => {
          const config = configStore.getWhatsAppConfig()
          return config.heartbeat?.targetConversationJid || null
        },
      }
      channelRouter.registerChannel(whatsappTransport)

      // Helper: lazily create TelegramService, register real IPC handlers, and connect.
      // Called both at startup (if already configured) and on-demand from the renderer.
      const { TELEGRAM_IPC_CHANNELS: TG_CHANNELS } = await import('@shared/telegram-ipc-channels')

      // Simple conversation history per chat (last N messages for context)
      const telegramChatHistory = new Map<string, Array<{ role: 'user' | 'assistant'; content: string }>>()
      const MAX_HISTORY = 20

      // Process a Telegram message — uses OpenRouter if available, falls back to Agent SDK
      async function handleTelegramMessage(msg: any) {
        if (!telegramService) return
        const chatId = msg.chatId
        const content = msg.content?.trim()
        if (!content) return

        // Filter group messages by trigger pattern
        const tgConfig = telegramService.getConfig()
        const isGroup = String(chatId).startsWith('-')
        if (isGroup && tgConfig.triggerPattern) {
          const pattern = tgConfig.triggerPattern
          if (!content.includes(pattern) && !content.startsWith('/')) {
            return // Ignore group messages that don't match trigger
          }
        }

        console.log('[Main] Processing Telegram message:', content.substring(0, 50))

        // Add user message to history
        const history = telegramChatHistory.get(chatId) ?? []
        history.push({ role: 'user', content })
        if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY)
        telegramChatHistory.set(chatId, history)

        // Send typing indicator and keep it alive every 4s while processing
        let typingActive = true
        const typingLoop = (async () => {
          while (typingActive) {
            try { await telegramService!.sendTypingIndicator(chatId) } catch { /* ignore */ }
            await new Promise((r) => setTimeout(r, 4000))
          }
        })()

        try {
          let responseText = ''

          // Check both module-level and settings deps for OpenRouter
          const orService = openRouterService || getSettingsDeps()?.openRouterService
          if (orService) {
            // ---- OpenRouter path (fast, cheap) ----
            console.log('[Main] Using OpenRouter for Telegram response')
            const messages = [
              { role: 'system' as const, content: 'You are a helpful AI assistant communicating via Telegram. Be concise — aim for 1-3 short paragraphs max.' },
              ...history,
            ]
            // Append :online to enable OpenRouter's built-in web search
            const baseModel = orService.getConfig().defaultModel
            const onlineModel = baseModel.includes(':online') ? baseModel : `${baseModel}:online`
            const result = await orService.complete(messages, {
              model: onlineModel,
              temperature: 0.7,
              maxTokens: 1024,
            })
            responseText = result.content
            console.log(`[Main] OpenRouter response: model=${result.model}, cost=$${result.costUsd.toFixed(4)}, ${result.durationMs}ms`)
          } else {
            // ---- Agent SDK fallback ----
            console.log('[Main] Using Agent SDK for Telegram response (no OpenRouter key)')
            let sdkModule = await import('@anthropic-ai/claude-agent-sdk')
            const systemPrompt = 'You are a helpful AI assistant communicating via Telegram. Be concise — aim for 1-3 short paragraphs max.'

            async function* generateMessages(): AsyncGenerator<import('@anthropic-ai/claude-agent-sdk').SDKUserMessage> {
              yield {
                type: 'user' as const,
                message: { role: 'user' as const, content },
                parent_tool_use_id: null,
                session_id: '',
              } as import('@anthropic-ai/claude-agent-sdk').SDKUserMessage
            }

            const queryResult = sdkModule.query({
              prompt: generateMessages(),
              options: {
                model: 'claude-haiku-4-5-20251001',
                maxTurns: 1,
                systemPrompt,
                cwd: process.cwd(),
                permissionMode: 'bypassPermissions',
                allowDangerouslySkipPermissions: true,
                env: {
                  ...process.env,
                  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
                  CLAUDE_API_KEY: process.env.CLAUDE_API_KEY,
                  HOME: process.env.HOME || process.env.USERPROFILE || '',
                  USERPROFILE: process.env.USERPROFILE || process.env.HOME || '',
                  PATH: process.env.PATH,
                },
              },
            })

            for await (const message of queryResult) {
              if (message.type === 'assistant') {
                const msgContent = (message as any).message?.content
                if (Array.isArray(msgContent)) {
                  for (const block of msgContent) {
                    if (block.type === 'text' && block.text && block.text.length > responseText.length) {
                      responseText = block.text
                    }
                  }
                }
              }
              if (message.type === 'result') {
                const resultMsg = message as any
                if (resultMsg.result && typeof resultMsg.result === 'string' && resultMsg.result.length > responseText.length) {
                  responseText = resultMsg.result
                }
              }
            }
          }

          // Stop typing indicator
          typingActive = false
          await typingLoop

          // Add assistant response to history
          if (responseText.trim()) {
            history.push({ role: 'assistant', content: responseText.trim() })
            if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY)
            telegramChatHistory.set(chatId, history)
            await telegramService.sendMessage(chatId, responseText.trim())
          } else {
            await telegramService.sendMessage(chatId, 'I processed your message but had no text response.')
          }

          console.log('[Main] Telegram response sent to chat:', chatId)
        } catch (err) {
          typingActive = false
          await typingLoop
          console.error('[Main] Telegram agent error:', err)
          try {
            const errorMsg = err instanceof Error ? err.message : String(err)
            await telegramService.sendMessage(chatId, `Sorry, I encountered an error: ${errorMsg}`)
          } catch {
            // Ignore send errors
          }
        }
      }

      const initializeTelegram = (config: TelegramConfig): TelegramService => {
        console.log('[Main] Initializing Telegram service...')
        const svc = new TelegramService({
          ...config,
          routingRules: config.routingRules ?? [],
          autoCreateGroups: config.autoCreateGroups ?? false,
          fallbackChatId: config.fallbackChatId ?? null,
        })
        telegramService = svc
        channelRouter!.registerChannel(svc)

        // Wire Telegram messages to agent processing
        svc.on('message-received', (msg: any) => {
          console.log('[Main] Telegram message received:', msg.content?.substring(0, 50))
          handleTelegramMessage(msg).catch((err) =>
            console.error('[Main] Telegram message handler error:', err)
          )
        })

        // Wire cross-channel forwarding
        svc.on('message-received', (msg: any) => {
          channelUxService?.forwardMessage(msg)
        })

        // Replace fallback IPC handlers with real ones
        registerTelegramHandlers(svc, channelRouter!, configStore)
        return svc
      }

      // Register fallback Telegram IPC handlers (for when Telegram is not yet configured).
      // These return safe defaults so the renderer never finds an unhandled channel.
      // TELEGRAM_CONFIG_SET and TELEGRAM_CONNECT lazily create the service on first use.
      const telegramFallbackHandler = async () => ({
        success: true,
        data: { status: 'disconnected' },
      })
      for (const channel of [TG_CHANNELS.TELEGRAM_GET_STATUS, TG_CHANNELS.TELEGRAM_CONFIG_GET]) {
        ipcMain.handle(channel, telegramFallbackHandler)
      }

      // Fallback CONFIG_SET: saves config and lazily creates the service
      ipcMain.handle(TG_CHANNELS.TELEGRAM_CONFIG_SET, async (_event: any, config: Partial<TelegramConfig>) => {
        try {
          // Persist to config store
          const whatsappConfig = (configStore.get('whatsapp') as any) || {}
          const existingTelegramConfig = whatsappConfig.telegram || {}
          const mergedConfig = { ...existingTelegramConfig, ...config }
          configStore.set('whatsapp', { ...whatsappConfig, telegram: mergedConfig } as any)
          console.log('[Main] Telegram config saved (lazy handler)')

          // If we now have enough to create the service, do it
          if (!telegramService && mergedConfig.enabled && mergedConfig.botToken) {
            initializeTelegram(mergedConfig as TelegramConfig)
          } else if (telegramService) {
            telegramService.updateConfig(config)
          }

          return { success: true }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          return { success: false, error: message }
        }
      })

      // Fallback CONNECT: creates the service if needed, then connects
      ipcMain.handle(TG_CHANNELS.TELEGRAM_CONNECT, async () => {
        try {
          if (!telegramService) {
            // Load config from store and create service
            const whatsappConfig = (configStore.get('whatsapp') as any) || {}
            const tgConfig = whatsappConfig.telegram
            if (!tgConfig?.botToken) {
              return { success: false, error: 'No bot token configured' }
            }
            initializeTelegram({ ...tgConfig } as TelegramConfig)
          }
          console.log('[Main] Telegram connecting (lazy handler)...')
          await telegramService!.connect()
          return { success: true }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          console.error('[Main] Telegram connect failed:', message)
          return { success: false, error: message }
        }
      })

      // Fallback GET_MESSAGES: returns empty until real handlers are registered
      ipcMain.handle(TG_CHANNELS.TELEGRAM_GET_MESSAGES, async () => {
        return { success: true, data: [] }
      })

      // Fallback SEND_MESSAGE: no-op until service is ready
      ipcMain.handle(TG_CHANNELS.TELEGRAM_SEND_MESSAGE, async () => {
        return { success: false, error: 'Telegram not connected' }
      })

      // Fallback ANSWER_CALLBACK
      ipcMain.handle(TG_CHANNELS.TELEGRAM_ANSWER_CALLBACK, async () => {
        return { success: false, error: 'Telegram not connected' }
      })

      // Fallback channel router handlers
      ipcMain.handle(TG_CHANNELS.CHANNEL_ROUTER_STATUS, async () => {
        return { success: true, data: { channels: [] } }
      })
      ipcMain.handle(TG_CHANNELS.CHANNEL_ROUTER_SEND, async () => {
        return { success: false, error: 'Channel router not ready' }
      })
      ipcMain.handle(TG_CHANNELS.CHANNEL_ROUTER_SEND_ALL, async () => {
        return { success: false, error: 'Channel router not ready' }
      })

      // Fallback Routing Rules handlers
      ipcMain.handle(TG_CHANNELS.TELEGRAM_ROUTING_RULES_GET, async () => {
        return { success: true, data: [] }
      })
      ipcMain.handle(TG_CHANNELS.TELEGRAM_ROUTING_RULES_UPSERT, async () => {
        return { success: false, error: 'Telegram not connected' }
      })
      ipcMain.handle(TG_CHANNELS.TELEGRAM_ROUTING_RULES_DELETE, async () => {
        return { success: false, error: 'Telegram not connected' }
      })

      // Fallback DISCONNECT
      ipcMain.handle(TG_CHANNELS.TELEGRAM_DISCONNECT, async () => {
        try {
          if (telegramService) {
            await telegramService.disconnect()
          }
          return { success: true }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          return { success: false, error: message }
        }
      })

      // Initialize Telegram at startup if already configured
      const telegramConfig = (configStore.get('whatsapp') as any)?.telegram
      if (telegramConfig?.enabled && telegramConfig?.botToken) {
        initializeTelegram(telegramConfig as TelegramConfig)

        // Auto-connect Telegram
        telegramService!.connect().catch((err: Error) =>
          console.error('[Main] Telegram auto-connect failed:', err.message)
        )
      }

      // Update skill executor to use channel router for output
      skillExecutor.setSendToChannel(async (message: string) => {
        await channelRouter!.sendToAll(message)
      })

      // Initialize LLM Router (OpenRouter is optional, depends on API key)
      const openRouterApiKey = (configStore.get('whatsapp') as any)?.openRouter?.apiKey
      if (openRouterApiKey) {
        const openRouterConfig = (configStore.get('whatsapp') as any)?.openRouter || {}
        openRouterService = new OpenRouterService({
          apiKey: openRouterApiKey,
          defaultModel: openRouterConfig.defaultModel || 'deepseek/deepseek-chat-v3-0324',
        })
        console.log('[Main] OpenRouter configured with model:', openRouterConfig.defaultModel || 'deepseek/deepseek-chat-v3-0324')
      } else {
        console.log('[Main] OpenRouter not configured (no API key), using Agent SDK for all LLM tasks')
      }

      llmRouterService = new LlmRouterService(skillsConfigStore!, openRouterService)

      // Wire LLM router into the agent service and skill executor
      whatsappAgentService.setLlmRouter(llmRouterService)
      skillExecutor!.setLlmRouter(llmRouterService)

      console.log('[Main] LLM Router initialized')

      // Initialize Enhanced Channel UX
      const forwardConfig = (configStore.get('whatsapp') as any)?.crossChannelForwarding
      channelUxService = new ChannelUxService(channelRouter!, telegramService, forwardConfig)

      // Register channel UX IPC handlers (must be after channelUxService is created)
      registerChannelUxHandlers(channelUxService)

      // Register settings IPC handlers (OpenRouter, LLM, Skills, Channel Router)
      registerSettingsHandlers({
        openRouterService,
        llmRouterService,
        skillsManager,
        skillsConfigStore,
        channelRouter,
        skillExecutor,
        configStore,
      })

      // Wire cross-channel forwarding for WhatsApp
      // (Telegram forwarding is handled inside initializeTelegram)
      if (whatsappService) {
        whatsappService.on('message-received', (msg: any) => {
          if (msg.isFromMe) return
          // Check if this is an approval response first
          const isApprovalResponse = channelUxService?.resolveWhatsAppApproval(msg.conversationJid, msg.content)
          if (!isApprovalResponse) {
            // Forward non-approval messages
            channelUxService?.forwardMessage({
              id: msg.id,
              channel: 'whatsapp',
              chatId: msg.conversationJid,
              senderId: msg.senderJid,
              senderName: msg.senderName,
              content: msg.content,
              timestamp: msg.timestamp,
              isFromMe: false,
            })
          }
        })
      }

      console.log('[Main] Enhanced Channel UX initialized')
      console.log('[Main] WhatsApp services initialized successfully')
    } catch (err) {
      console.error('[Main] WhatsApp initialization failed:', err)
    }
  })()

  // Default open or close DevTools by F12 in development
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', async () => {
  // Clean up all sessions and services
  sessionManager.destroyAll()
  devServerManager.stopAll()
  discoveryChatService.cleanup()
  discoveryChatServiceSDK.cleanup()

  // Clean up self-extension services
  if (skillExecutor) skillExecutor.stop()
  if (skillsManager) await skillsManager.destroy()

  // Clean up Unified Agent Architecture services
  if (episodeStore) episodeStore.stopBackgroundWorker()
  if (markdownSyncService) markdownSyncService.stopFileWatcher()

  // Clean up WhatsApp services
  if (heartbeatService) heartbeatService.stop()
  if (taskSchedulerService) taskSchedulerService.stop()
  if (whatsappService) await whatsappService.disconnect().catch(() => {})

  // Stop API server if running
  await stopApiServer()

  if (process.platform !== 'darwin') {
    app.quit()
  }
})

/**
 * Register IPC handlers for API server management
 */
function registerApiServerHandlers(): void {
  // Start API server
  ipcMain.handle('api-server:start', async (_event, config: ApiServerConfig) => {
    try {
      const server = await startApiServer(config)
      // Save config
      configStore.set('apiServer', {
        enabled: true,
        port: config.port,
        authEnabled: config.enableAuth ?? true
      })
      return {
        success: true,
        data: {
          port: config.port,
          authToken: server.getAuthToken(),
          status: server.getStatus(),
          addresses: getLocalAddresses()
        }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  })

  // Stop API server
  ipcMain.handle('api-server:stop', async () => {
    try {
      await stopApiServer()
      // Update config - preserve port but mark as disabled
      const currentConfig = configStore.get('apiServer')
      configStore.set('apiServer', {
        enabled: false,
        port: currentConfig?.port ?? 3847,
        authEnabled: currentConfig?.authEnabled ?? true
      })
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  })

  // Get API server status
  ipcMain.handle('api-server:status', async () => {
    try {
      const server = getApiServer()
      if (!server) {
        return {
          success: true,
          data: { running: false }
        }
      }
      return {
        success: true,
        data: {
          ...server.getStatus(),
          authToken: server.getAuthToken()
        }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  })

  console.log('[Main] API server handlers registered')
}

// Export window getter
export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

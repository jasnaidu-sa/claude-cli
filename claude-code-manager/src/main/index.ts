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
      markdownSyncService = new MarkdownSyncService(episodeStore)
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

      // Initialize Telegram if configured
      const telegramConfig = (configStore.get('whatsapp') as any)?.telegram
      if (telegramConfig?.enabled && telegramConfig?.botToken) {
        console.log('[Main] Initializing Telegram service...')
        telegramService = new TelegramService(telegramConfig)
        channelRouter.registerChannel(telegramService)

        // Wire Telegram messages to agent service
        telegramService.on('message-received', (msg: any) => {
          // Route telegram messages through the agent service
          // by creating synthetic WhatsApp messages or handling directly
          console.log('[Main] Telegram message received:', msg.content?.substring(0, 50))
        })

        registerTelegramHandlers(telegramService, channelRouter, configStore)

        // Auto-connect Telegram
        telegramService.connect().catch((err: Error) =>
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
      })

      // Wire cross-channel forwarding if both channels are available
      if (telegramService) {
        telegramService.on('message-received', (msg: any) => {
          channelUxService?.forwardMessage(msg)
        })
      }
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

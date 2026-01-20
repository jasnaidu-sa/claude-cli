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

import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerIpcHandlers } from './ipc'
import { SessionManager } from './services/session-manager'
import { ConfigStore } from './services/config-store'
import { BrowserBridge } from './services/browser-bridge'
import { DevServerManager } from './services/dev-server'

// Global references
let mainWindow: BrowserWindow | null = null
export let sessionManager: SessionManager
export let configStore: ConfigStore
export let browserBridge: BrowserBridge
export let devServerManager: DevServerManager

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

  // Register IPC handlers
  registerIpcHandlers()

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

app.on('window-all-closed', () => {
  // Clean up all sessions and dev servers
  sessionManager.destroyAll()
  devServerManager.stopAll()

  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Export window getter
export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

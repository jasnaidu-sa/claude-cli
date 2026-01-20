/**
 * Autocoder UI Service
 *
 * Manages the autocoder FastAPI backend and embedded web UI.
 * Spawns Python processes and embeds the React UI in Electron via BrowserView.
 */

import { BrowserView, BrowserWindow, app } from 'electron'
import { ChildProcess, spawn } from 'child_process'
import * as path from 'path'
import { getPythonVenvManager } from './python-venv-manager'

export interface AutocoderConfig {
  projectPath: string
}

export class AutocoderUIService {
  private fastApiProcess: ChildProcess | null = null
  private browserView: BrowserView | null = null
  private mainWindow: BrowserWindow | null = null
  private config: AutocoderConfig | null = null
  private isStarting = false
  private isRunning = false

  constructor() {}

  /**
   * Start autocoder backend and UI
   */
  async start(mainWindow: BrowserWindow, config: AutocoderConfig): Promise<void> {
    if (this.isStarting || this.isRunning) {
      console.log('[Autocoder] Already starting or running')
      return
    }

    this.isStarting = true
    this.mainWindow = mainWindow
    this.config = config

    try {
      console.log('[Autocoder] Starting autocoder UI service...')
      console.log('[Autocoder] Project path:', config.projectPath)

      // Ensure Python venv is ready
      const venvManager = getPythonVenvManager()
      await venvManager.ensureReady()

      // UI is pre-built (dist folder included in repo)
      // No need to build on startup

      // Start FastAPI backend (serves pre-built UI)
      await this.startBackend(config)

      // Wait for FastAPI to be ready
      await this.waitForServer('http://localhost:8000/api/health', 30000)
      console.log('[Autocoder] FastAPI backend ready')

      // Create and configure BrowserView
      await this.createBrowserView()

      this.isRunning = true
      this.isStarting = false

      console.log('[Autocoder] UI service started successfully')
    } catch (error) {
      this.isStarting = false
      this.isRunning = false
      console.error('[Autocoder] Failed to start:', error)
      await this.cleanup()
      throw error
    }
  }

  /**
   * Start FastAPI backend directly via uvicorn (skip start_ui.py to avoid double venv creation)
   */
  private async startBackend(config: AutocoderConfig): Promise<void> {
    const venvManager = getPythonVenvManager()
    const pythonPath = venvManager.getPythonPath()
    const autocoderPath = venvManager.getAutocoderPath()

    console.log('[Autocoder] Starting FastAPI backend via uvicorn...')
    console.log('[Autocoder] Python:', pythonPath)
    console.log('[Autocoder] Path:', autocoderPath)

    // Build environment
    // Note: ANTHROPIC_API_KEY should come from system env or autocoder's .env file
    const env = {
      ...process.env,
      PROJECT_DIR: config.projectPath,
      PYTHONPATH: autocoderPath,
      PYTHONUNBUFFERED: '1' // Disable Python output buffering
    }

    // Use custom entry point that sets Windows asyncio policy before uvicorn
    this.fastApiProcess = spawn(
      pythonPath,
      ['run_server.py'],
      {
        cwd: autocoderPath,
        env,
        stdio: ['ignore', 'pipe', 'pipe']
      }
    )

    // Log output
    this.fastApiProcess.stdout?.on('data', (data) => {
      const output = data.toString()
      console.log('[Autocoder Backend]', output.trim())

      // Send to renderer for debug view
      this.mainWindow?.webContents.send('autocoder:log', {
        type: 'stdout',
        message: output.trim()
      })
    })

    this.fastApiProcess.stderr?.on('data', (data) => {
      const output = data.toString()
      console.error('[Autocoder Backend]', output.trim())

      // Send to renderer for debug view
      this.mainWindow?.webContents.send('autocoder:log', {
        type: 'stderr',
        message: output.trim()
      })
    })

    this.fastApiProcess.on('error', (error) => {
      console.error('[Autocoder] Process error:', error)
      this.mainWindow?.webContents.send('autocoder:error', {
        message: `Backend process error: ${error.message}`
      })
    })

    this.fastApiProcess.on('exit', (code, signal) => {
      console.log('[Autocoder] Process exited:', { code, signal })
      this.isRunning = false
      this.fastApiProcess = null

      this.mainWindow?.webContents.send('autocoder:stopped', {
        code,
        signal
      })
    })

    console.log('[Autocoder] Backend process spawned, PID:', this.fastApiProcess.pid)
  }

  /**
   * Create BrowserView and load autocoder UI
   */
  private async createBrowserView(): Promise<void> {
    if (!this.mainWindow) {
      throw new Error('Main window not set')
    }

    console.log('[Autocoder] Creating BrowserView...')

    this.browserView = new BrowserView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true
      }
    })

    this.mainWindow.setBrowserView(this.browserView)

    // Position the browser view (leave space for app header/nav)
    this.updateBrowserViewBounds()

    // Handle window resize
    this.mainWindow.on('resize', () => {
      this.updateBrowserViewBounds()
    })

    // Load autocoder UI (served by FastAPI)
    console.log('[Autocoder] Loading UI from http://localhost:8000')
    await this.browserView.webContents.loadURL('http://localhost:8000')

    // Inject theme after load
    this.browserView.webContents.on('did-finish-load', () => {
      console.log('[Autocoder] UI loaded, injecting theme...')
      this.injectTheme()
    })

    // Handle navigation within BrowserView
    this.browserView.webContents.on('will-navigate', (event, url) => {
      // Only allow navigation within autocoder UI
      if (!url.startsWith('http://localhost:8000')) {
        event.preventDefault()
        console.warn('[Autocoder] Blocked navigation to:', url)
      }
    })

    console.log('[Autocoder] BrowserView created successfully')
  }

  /**
   * Update BrowserView bounds based on window size
   */
  private updateBrowserViewBounds(): void {
    if (!this.browserView || !this.mainWindow) return

    const bounds = this.mainWindow.getBounds()

    // Leave space for header (64px) - adjust based on your UI
    this.browserView.setBounds({
      x: 0,
      y: 64,
      width: bounds.width,
      height: bounds.height - 64
    })
  }

  /**
   * Inject theme CSS to match app style
   */
  private async injectTheme(): Promise<void> {
    if (!this.browserView) return

    try {
      // CSS to override autocoder's default theme
      const themeCSS = `
        /* Match Claude Code Manager theme */
        :root {
          --background: 222.2 84% 4.9%;
          --foreground: 210 40% 98%;
          --card: 222.2 84% 4.9%;
          --card-foreground: 210 40% 98%;
          --popover: 222.2 84% 4.9%;
          --popover-foreground: 210 40% 98%;
          --primary: 210 40% 98%;
          --primary-foreground: 222.2 47.4% 11.2%;
          --secondary: 217.2 32.6% 17.5%;
          --secondary-foreground: 210 40% 98%;
          --muted: 217.2 32.6% 17.5%;
          --muted-foreground: 215 20.2% 65.1%;
          --accent: 217.2 32.6% 17.5%;
          --accent-foreground: 210 40% 98%;
          --destructive: 0 62.8% 30.6%;
          --destructive-foreground: 210 40% 98%;
          --border: 217.2 32.6% 17.5%;
          --input: 217.2 32.6% 17.5%;
          --ring: 212.7 26.8% 83.9%;
        }

        /* Override default styles */
        body {
          background-color: hsl(var(--background)) !important;
          color: hsl(var(--foreground)) !important;
        }

        /* Card styles */
        .bg-white, .bg-gray-50 {
          background-color: hsl(var(--card)) !important;
          color: hsl(var(--card-foreground)) !important;
        }

        /* Border styles */
        .border-gray-200, .border-gray-300 {
          border-color: hsl(var(--border)) !important;
        }

        /* Button styles */
        .bg-blue-600, .bg-blue-500 {
          background-color: hsl(var(--primary)) !important;
          color: hsl(var(--primary-foreground)) !important;
        }

        /* Text colors */
        .text-gray-900 {
          color: hsl(var(--foreground)) !important;
        }

        .text-gray-600, .text-gray-500 {
          color: hsl(var(--muted-foreground)) !important;
        }

        /* Hide scrollbars for cleaner look */
        ::-webkit-scrollbar {
          width: 8px;
          height: 8px;
        }

        ::-webkit-scrollbar-track {
          background: hsl(var(--background));
        }

        ::-webkit-scrollbar-thumb {
          background: hsl(var(--muted));
          border-radius: 4px;
        }

        ::-webkit-scrollbar-thumb:hover {
          background: hsl(var(--muted-foreground));
        }
      `

      await this.browserView.webContents.insertCSS(themeCSS)
      console.log('[Autocoder] Theme injected successfully')
    } catch (error) {
      console.error('[Autocoder] Failed to inject theme:', error)
    }
  }

  /**
   * Wait for a server to be ready
   */
  private async waitForServer(url: string, timeout = 30000): Promise<void> {
    const start = Date.now()

    console.log(`[Autocoder] Waiting for ${url}...`)

    while (Date.now() - start < timeout) {
      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 5000)

        const response = await fetch(url, {
          signal: controller.signal
        })

        clearTimeout(timeoutId)

        if (response.ok) {
          console.log(`[Autocoder] ${url} is ready`)
          return
        }
      } catch (error) {
        // Server not ready yet, continue waiting
      }

      await new Promise((resolve) => setTimeout(resolve, 500))
    }

    throw new Error(`Server at ${url} did not start within ${timeout}ms`)
  }

  /**
   * Show the BrowserView
   */
  show(): void {
    if (this.browserView && this.mainWindow) {
      this.mainWindow.setBrowserView(this.browserView)
      this.updateBrowserViewBounds()
      console.log('[Autocoder] BrowserView shown')
    }
  }

  /**
   * Hide the BrowserView (but keep backend running)
   */
  hide(): void {
    if (this.mainWindow) {
      this.mainWindow.setBrowserView(null)
      console.log('[Autocoder] BrowserView hidden')
    }
  }

  /**
   * Stop autocoder backend and clean up
   */
  async stop(): Promise<void> {
    console.log('[Autocoder] Stopping UI service...')
    await this.cleanup()
    this.isRunning = false
    console.log('[Autocoder] UI service stopped')
  }

  /**
   * Clean up resources
   */
  private async cleanup(): Promise<void> {
    // Kill backend process
    if (this.fastApiProcess) {
      console.log('[Autocoder] Killing backend process...')
      this.fastApiProcess.kill('SIGTERM')

      // Force kill after 5 seconds
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          if (this.fastApiProcess) {
            console.log('[Autocoder] Force killing backend process...')
            this.fastApiProcess.kill('SIGKILL')
          }
          resolve()
        }, 5000)

        this.fastApiProcess?.on('exit', () => {
          clearTimeout(timeout)
          resolve()
        })
      })

      this.fastApiProcess = null
    }

    // Destroy BrowserView
    if (this.browserView) {
      console.log('[Autocoder] Destroying BrowserView...')
      try {
        // @ts-ignore - webContents.destroy() exists but TypeScript doesn't know about it
        this.browserView.webContents.destroy()
      } catch (error) {
        console.error('[Autocoder] Error destroying BrowserView:', error)
      }
      this.browserView = null
    }

    this.mainWindow = null
    this.config = null
  }

  /**
   * Check if service is running
   */
  isServiceRunning(): boolean {
    return this.isRunning
  }

  /**
   * Get current config
   */
  getConfig(): AutocoderConfig | null {
    return this.config
  }
}

// Singleton instance
let instance: AutocoderUIService | null = null

export function getAutocoderUIService(): AutocoderUIService {
  if (!instance) {
    instance = new AutocoderUIService()
  }
  return instance
}

import { spawn, ChildProcess } from 'child_process'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { ipcMain } from 'electron'
import { IPC_CHANNELS, DevServerInfo } from '@shared/types'
import { getMainWindow } from '../index'

interface DevServerProcess {
  sessionId: string
  process: ChildProcess
  port: number
  script: string
  logs: string[]
}

export class DevServerManager {
  private servers: Map<string, DevServerProcess> = new Map()

  // Common dev server patterns and their default ports
  private devScripts = [
    { script: 'dev', port: 3000 },      // Next.js, Vite, etc.
    { script: 'start', port: 3000 },    // Create React App
    { script: 'serve', port: 8080 },    // Vue CLI
    { script: 'develop', port: 8000 }   // Gatsby
  ]

  constructor() {
    this.registerHandlers()
  }

  private registerHandlers(): void {
    ipcMain.handle(IPC_CHANNELS.DEVSERVER_DETECT, async (_event, projectPath: string) => {
      return this.detectDevServer(projectPath)
    })

    ipcMain.handle(IPC_CHANNELS.DEVSERVER_START, async (_event, { sessionId, projectPath, script }: { sessionId: string; projectPath: string; script?: string }) => {
      return this.startDevServer(sessionId, projectPath, script)
    })

    ipcMain.handle(IPC_CHANNELS.DEVSERVER_STOP, async (_event, sessionId: string) => {
      return this.stopDevServer(sessionId)
    })

    ipcMain.handle(IPC_CHANNELS.DEVSERVER_STATUS, async (_event, sessionId: string) => {
      return this.getStatus(sessionId)
    })
  }

  async detectDevServer(projectPath: string): Promise<DevServerInfo | null> {
    try {
      const packageJsonPath = join(projectPath, 'package.json')
      console.log(`[DevServerManager] Looking for package.json at: ${packageJsonPath}`)
      const packageJsonContent = await readFile(packageJsonPath, 'utf-8')
      const packageJson = JSON.parse(packageJsonContent)

      if (!packageJson.scripts) {
        console.log(`[DevServerManager] No scripts found in package.json`)
        return null
      }

      console.log(`[DevServerManager] Available scripts:`, Object.keys(packageJson.scripts))

      // Find available dev script
      for (const { script, port } of this.devScripts) {
        if (packageJson.scripts[script]) {
          // Try to extract port from script
          const scriptContent = packageJson.scripts[script]
          const portMatch = scriptContent.match(/(?:-p|--port|PORT=)\s*(\d+)/)
          const detectedPort = portMatch ? parseInt(portMatch[1], 10) : port

          console.log(`[DevServerManager] Found dev script: ${script} -> ${scriptContent}`)
          return {
            port: detectedPort,
            url: `http://localhost:${detectedPort}`,
            script: script,
            running: false
          }
        }
      }

      console.log(`[DevServerManager] No matching dev script found (looking for: ${this.devScripts.map(s => s.script).join(', ')})`)
      return null
    } catch (error) {
      console.log(`[DevServerManager] Error detecting dev server:`, error)
      return null
    }
  }

  async startDevServer(sessionId: string, projectPath: string, script?: string): Promise<{ success: boolean; info?: DevServerInfo; error?: string }> {
    // Stop existing server for this session
    await this.stopDevServer(sessionId)

    // Detect dev server if script not provided
    let devInfo = await this.detectDevServer(projectPath)
    if (!devInfo && !script) {
      return { success: false, error: 'No dev server script found in package.json' }
    }

    const useScript = script || devInfo?.script || 'dev'
    const port = devInfo?.port || 3000

    try {
      // Use npm run or npx based on what's available
      const isWindows = process.platform === 'win32'
      const npmCmd = isWindows ? 'npm.cmd' : 'npm'

      const child = spawn(npmCmd, ['run', useScript], {
        cwd: projectPath,
        shell: true,
        env: {
          ...process.env,
          PORT: String(port),
          BROWSER: 'none' // Prevent auto-opening browser
        }
      })

      const serverProcess: DevServerProcess = {
        sessionId,
        process: child,
        port,
        script: useScript,
        logs: []
      }

      // Capture logs
      child.stdout?.on('data', (data) => {
        const text = data.toString()
        serverProcess.logs.push(text)
        // Keep last 500 lines
        if (serverProcess.logs.length > 500) {
          serverProcess.logs = serverProcess.logs.slice(-500)
        }
        this.notifyLogUpdate(sessionId, text)
      })

      child.stderr?.on('data', (data) => {
        const text = data.toString()
        serverProcess.logs.push(`[stderr] ${text}`)
        if (serverProcess.logs.length > 500) {
          serverProcess.logs = serverProcess.logs.slice(-500)
        }
        this.notifyLogUpdate(sessionId, text)
      })

      child.on('exit', (code) => {
        this.servers.delete(sessionId)
        this.notifyStatusChange(sessionId, false, code)
      })

      child.on('error', (error) => {
        console.error(`Dev server error for ${sessionId}:`, error)
        this.servers.delete(sessionId)
      })

      this.servers.set(sessionId, serverProcess)

      // Wait a moment for server to start
      await new Promise(resolve => setTimeout(resolve, 1000))

      const info: DevServerInfo = {
        port,
        url: `http://localhost:${port}`,
        script: useScript,
        running: true
      }

      this.notifyStatusChange(sessionId, true)

      return { success: true, info }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  async stopDevServer(sessionId: string): Promise<{ success: boolean }> {
    const server = this.servers.get(sessionId)
    if (!server) return { success: true }

    try {
      // Kill the process tree
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(server.process.pid), '/f', '/t'])
      } else {
        server.process.kill('SIGTERM')
      }
      this.servers.delete(sessionId)
      return { success: true }
    } catch {
      return { success: false }
    }
  }

  getStatus(sessionId: string): DevServerInfo | null {
    const server = this.servers.get(sessionId)
    if (!server) return null

    return {
      port: server.port,
      url: `http://localhost:${server.port}`,
      script: server.script,
      running: true
    }
  }

  getLogs(sessionId: string): string[] {
    return this.servers.get(sessionId)?.logs || []
  }

  stopAll(): void {
    for (const [sessionId] of this.servers) {
      this.stopDevServer(sessionId)
    }
  }

  private notifyStatusChange(sessionId: string, running: boolean, exitCode?: number | null): void {
    const mainWindow = getMainWindow()
    if (mainWindow) {
      mainWindow.webContents.send('devserver:status-change', { sessionId, running, exitCode })
    }
  }

  private notifyLogUpdate(sessionId: string, log: string): void {
    const mainWindow = getMainWindow()
    if (mainWindow) {
      mainWindow.webContents.send('devserver:log', { sessionId, log })
    }
  }
}

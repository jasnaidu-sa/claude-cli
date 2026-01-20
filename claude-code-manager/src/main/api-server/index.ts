/**
 * API Server for Remote Access
 *
 * Exposes all IPC functionality over HTTP/WebSocket for remote clients.
 * This allows the same Electron app to be used in client mode, connecting
 * to a remote server instead of using local IPC.
 *
 * Architecture:
 * - REST API: For request/response operations (file read, git status, etc.)
 * - WebSocket: For real-time events (Ralph Loop updates, file changes, etc.)
 * - Authentication: Token-based auth for security
 */

import express, { Express, Request, Response, NextFunction } from 'express'
import { createServer, Server as HttpServer } from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import cors from 'cors'
import { randomBytes, createHash } from 'crypto'
import { EventEmitter } from 'events'

// Import services
import { getMainWindow, sessionManager, configStore, discoveryChatService } from '../index'
import { fileWatcher } from '../services/file-watcher'
import { getRalphOrchestratorService } from '../services/ralph-orchestrator-service'
import { getInitiatorService } from '../services/initiator-service'
import { readFile, writeFile } from 'fs/promises'
import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'

// Types
export interface ApiServerConfig {
  port: number
  authToken?: string  // If not provided, one will be generated
  enableAuth: boolean
}

export interface ConnectedClient {
  id: string
  ws: WebSocket
  subscriptions: Set<string>  // Event channels subscribed to
  authenticatedAt: number
}

// Event emitter for broadcasting to WebSocket clients
class ApiEventEmitter extends EventEmitter {
  private clients: Map<string, ConnectedClient> = new Map()

  addClient(client: ConnectedClient): void {
    this.clients.set(client.id, client)
  }

  removeClient(clientId: string): void {
    this.clients.delete(clientId)
  }

  getClient(clientId: string): ConnectedClient | undefined {
    return this.clients.get(clientId)
  }

  broadcast(channel: string, data: unknown): void {
    const message = JSON.stringify({ channel, data, timestamp: Date.now() })
    for (const client of this.clients.values()) {
      if (client.subscriptions.has(channel) || client.subscriptions.has('*')) {
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.send(message)
        }
      }
    }
  }

  getClientCount(): number {
    return this.clients.size
  }
}

/**
 * API Server Class
 */
export class ApiServer {
  private app: Express
  private server: HttpServer
  private wss: WebSocketServer
  private events: ApiEventEmitter
  private config: ApiServerConfig
  private authToken: string
  private isRunning: boolean = false

  constructor(config: ApiServerConfig) {
    this.config = config
    this.authToken = config.authToken || this.generateToken()
    this.events = new ApiEventEmitter()

    // Create Express app
    this.app = express()
    this.app.use(cors())
    this.app.use(express.json({ limit: '50mb' }))  // Large limit for file content

    // Create HTTP server
    this.server = createServer(this.app)

    // Create WebSocket server
    this.wss = new WebSocketServer({ server: this.server })

    // Setup routes and WebSocket handlers
    this.setupMiddleware()
    this.setupRoutes()
    this.setupWebSocket()
    this.setupEventForwarding()
  }

  /**
   * Generate a secure auth token
   */
  private generateToken(): string {
    return randomBytes(32).toString('hex')
  }

  /**
   * Authentication middleware
   */
  private setupMiddleware(): void {
    // Auth middleware
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      // Skip auth for health check
      if (req.path === '/health' || req.path === '/api/health') {
        return next()
      }

      if (!this.config.enableAuth) {
        return next()
      }

      const token = req.headers.authorization?.replace('Bearer ', '')
      if (!token || token !== this.authToken) {
        return res.status(401).json({ error: 'Unauthorized' })
      }

      next()
    })

    // Request logging
    this.app.use((req: Request, _res: Response, next: NextFunction) => {
      console.log(`[ApiServer] ${req.method} ${req.path}`)
      next()
    })
  }

  /**
   * Setup REST API routes
   */
  private setupRoutes(): void {
    const router = express.Router()

    // ========================================================================
    // Health & Info
    // ========================================================================

    router.get('/health', (_req, res) => {
      res.json({
        status: 'ok',
        version: '1.0.0',
        clients: this.events.getClientCount(),
        uptime: process.uptime()
      })
    })

    router.get('/info', (_req, res) => {
      res.json({
        version: '1.0.0',
        platform: process.platform,
        nodeVersion: process.version,
        electronVersion: process.versions.electron
      })
    })

    // ========================================================================
    // Session Management (Terminal Sessions)
    // ========================================================================

    router.post('/sessions', async (req, res) => {
      try {
        const { projectPath } = req.body
        const session = sessionManager.create(projectPath)
        configStore.addRecentProject(projectPath)
        res.json({ success: true, session })
      } catch (error) {
        res.json({ success: false, error: String(error) })
      }
    })

    router.delete('/sessions/:sessionId', async (req, res) => {
      try {
        const success = sessionManager.destroy(req.params.sessionId)
        res.json({ success })
      } catch (error) {
        res.json({ success: false, error: String(error) })
      }
    })

    router.get('/sessions', async (_req, res) => {
      try {
        const sessions = sessionManager.getAllSessions()
        res.json({ success: true, sessions })
      } catch (error) {
        res.json({ success: false, error: String(error) })
      }
    })

    router.post('/sessions/:sessionId/input', async (req, res) => {
      try {
        const { data } = req.body
        sessionManager.write(req.params.sessionId, data)
        res.json({ success: true })
      } catch (error) {
        res.json({ success: false, error: String(error) })
      }
    })

    router.post('/sessions/:sessionId/resize', async (req, res) => {
      try {
        const { cols, rows } = req.body
        sessionManager.resize(req.params.sessionId, cols, rows)
        res.json({ success: true })
      } catch (error) {
        res.json({ success: false, error: String(error) })
      }
    })

    // ========================================================================
    // File System
    // ========================================================================

    router.get('/files/read-dir', async (req, res) => {
      try {
        const dirPath = req.query.path as string
        const depth = req.query.depth ? parseInt(req.query.depth as string) : undefined
        const files = await fileWatcher.readDirectory(dirPath, depth)
        res.json({ success: true, files })
      } catch (error) {
        res.json({ success: false, error: String(error) })
      }
    })

    router.get('/files/read', async (req, res) => {
      try {
        const filePath = req.query.path as string
        const content = await readFile(filePath, 'utf-8')
        res.json({ success: true, content })
      } catch (error) {
        res.json({ success: false, error: String(error) })
      }
    })

    router.post('/files/write', async (req, res) => {
      try {
        const { path: filePath, content } = req.body
        await writeFile(filePath, content, 'utf-8')
        res.json({ success: true })
      } catch (error) {
        res.json({ success: false, error: String(error) })
      }
    })

    // ========================================================================
    // Config
    // ========================================================================

    router.get('/config', async (req, res) => {
      try {
        const key = req.query.key as string | undefined
        if (key) {
          const value = configStore.get(key as any)
          res.json({ success: true, value })
        } else {
          const config = configStore.getAll()
          res.json({ success: true, config })
        }
      } catch (error) {
        res.json({ success: false, error: String(error) })
      }
    })

    router.post('/config', async (req, res) => {
      try {
        const { key, value } = req.body
        configStore.set(key, value)
        res.json({ success: true })
      } catch (error) {
        res.json({ success: false, error: String(error) })
      }
    })

    // ========================================================================
    // Ralph Loop
    // ========================================================================

    router.post('/ralph/start', async (req, res) => {
      try {
        const config = req.body
        const orchestratorService = getRalphOrchestratorService()
        const session = await orchestratorService.start(config)
        res.json({ success: true, session })
      } catch (error) {
        res.json({ success: false, error: String(error) })
      }
    })

    router.post('/ralph/:sessionId/stop', async (req, res) => {
      try {
        const orchestratorService = getRalphOrchestratorService()
        await orchestratorService.stop(req.params.sessionId)
        res.json({ success: true })
      } catch (error) {
        res.json({ success: false, error: String(error) })
      }
    })

    router.post('/ralph/:sessionId/pause', async (req, res) => {
      try {
        const orchestratorService = getRalphOrchestratorService()
        await orchestratorService.pause(req.params.sessionId)
        res.json({ success: true })
      } catch (error) {
        res.json({ success: false, error: String(error) })
      }
    })

    router.post('/ralph/:sessionId/resume', async (req, res) => {
      try {
        const orchestratorService = getRalphOrchestratorService()
        await orchestratorService.resume(req.params.sessionId)
        res.json({ success: true })
      } catch (error) {
        res.json({ success: false, error: String(error) })
      }
    })

    router.get('/ralph/:sessionId', async (req, res) => {
      try {
        const orchestratorService = getRalphOrchestratorService()
        const session = orchestratorService.getSession(req.params.sessionId)
        if (!session) {
          res.json({ success: false, error: 'Session not found' })
        } else {
          res.json({ success: true, session })
        }
      } catch (error) {
        res.json({ success: false, error: String(error) })
      }
    })

    router.get('/ralph', async (_req, res) => {
      try {
        const orchestratorService = getRalphOrchestratorService()
        const sessions = orchestratorService.getAllSessions()
        res.json({ success: true, sessions })
      } catch (error) {
        res.json({ success: false, error: String(error) })
      }
    })

    router.post('/ralph/:sessionId/checkpoint/:checkpointId/approve', async (req, res) => {
      try {
        const { comment } = req.body
        const orchestratorService = getRalphOrchestratorService()
        await orchestratorService.respondToCheckpoint(
          req.params.sessionId,
          req.params.checkpointId,
          'approve',
          comment
        )
        res.json({ success: true })
      } catch (error) {
        res.json({ success: false, error: String(error) })
      }
    })

    router.post('/ralph/:sessionId/checkpoint/:checkpointId/skip', async (req, res) => {
      try {
        const { comment } = req.body
        const orchestratorService = getRalphOrchestratorService()
        await orchestratorService.respondToCheckpoint(
          req.params.sessionId,
          req.params.checkpointId,
          'skip',
          comment
        )
        res.json({ success: true })
      } catch (error) {
        res.json({ success: false, error: String(error) })
      }
    })

    router.post('/ralph/:sessionId/checkpoint/:checkpointId/reject', async (req, res) => {
      try {
        const { comment } = req.body
        const orchestratorService = getRalphOrchestratorService()
        await orchestratorService.respondToCheckpoint(
          req.params.sessionId,
          req.params.checkpointId,
          'reject',
          comment
        )
        res.json({ success: true })
      } catch (error) {
        res.json({ success: false, error: String(error) })
      }
    })

    // Ralph session history
    router.get('/ralph/history', async (req, res) => {
      try {
        const projectPath = req.query.projectPath as string | undefined
        const sessionHistoryPath = path.join(app.getPath('userData'), 'ralph-sessions')

        if (!fs.existsSync(sessionHistoryPath)) {
          return res.json({ success: true, sessions: [] })
        }

        const files = fs.readdirSync(sessionHistoryPath).filter(f => f.endsWith('.json'))
        const sessions = []

        for (const file of files) {
          try {
            const content = fs.readFileSync(path.join(sessionHistoryPath, file), 'utf-8')
            const session = JSON.parse(content)
            if (!projectPath || session.projectPath === projectPath) {
              sessions.push(session)
            }
          } catch {
            // Skip invalid files
          }
        }

        sessions.sort((a: any, b: any) => b.updatedAt - a.updatedAt)
        res.json({ success: true, sessions })
      } catch (error) {
        res.json({ success: false, error: String(error), sessions: [] })
      }
    })

    // ========================================================================
    // Initiator (Ralph Loop task definition)
    // ========================================================================

    router.post('/initiator/start', async (req, res) => {
      try {
        const { projectPath, forceNew } = req.body
        const initiatorService = getInitiatorService()
        const session = forceNew
          ? await initiatorService.createFreshSession(projectPath)
          : await initiatorService.createSession(projectPath)
        res.json({ success: true, data: session })
      } catch (error) {
        res.json({ success: false, error: String(error) })
      }
    })

    router.post('/initiator/:sessionId/message', async (req, res) => {
      try {
        const { content, attachmentPaths } = req.body
        const initiatorService = getInitiatorService()
        await initiatorService.sendMessage(req.params.sessionId, content, attachmentPaths)
        res.json({ success: true })
      } catch (error) {
        res.json({ success: false, error: String(error) })
      }
    })

    router.post('/initiator/:sessionId/summarize', async (req, res) => {
      try {
        const initiatorService = getInitiatorService()
        const requirements = await initiatorService.summarizeRequirements(req.params.sessionId)
        res.json({ success: true, data: requirements })
      } catch (error) {
        res.json({ success: false, error: String(error) })
      }
    })

    router.post('/initiator/:sessionId/generate', async (req, res) => {
      try {
        const initiatorService = getInitiatorService()
        const prompt = await initiatorService.generateRalphPrompt(req.params.sessionId)
        res.json({ success: true, data: prompt })
      } catch (error) {
        res.json({ success: false, error: String(error) })
      }
    })

    router.post('/initiator/:sessionId/approve', async (req, res) => {
      try {
        const initiatorService = getInitiatorService()
        const result = await initiatorService.approvePrompt(req.params.sessionId)
        res.json({ success: true, data: result })
      } catch (error) {
        res.json({ success: false, error: String(error) })
      }
    })

    router.get('/initiator/:sessionId', async (req, res) => {
      try {
        const initiatorService = getInitiatorService()
        const session = initiatorService.getSession(req.params.sessionId)
        if (!session) {
          res.json({ success: false, error: 'Session not found' })
        } else {
          res.json({ success: true, data: session })
        }
      } catch (error) {
        res.json({ success: false, error: String(error) })
      }
    })

    // Mount router
    this.app.use('/api', router)
  }

  /**
   * Setup WebSocket handlers
   */
  private setupWebSocket(): void {
    this.wss.on('connection', (ws: WebSocket, req) => {
      const clientId = randomBytes(16).toString('hex')
      console.log(`[ApiServer] WebSocket client connected: ${clientId}`)

      // Check auth for WebSocket
      if (this.config.enableAuth) {
        const url = new URL(req.url || '', `http://${req.headers.host}`)
        const token = url.searchParams.get('token')
        if (token !== this.authToken) {
          ws.close(4001, 'Unauthorized')
          return
        }
      }

      const client: ConnectedClient = {
        id: clientId,
        ws,
        subscriptions: new Set(['*']),  // Subscribe to all by default
        authenticatedAt: Date.now()
      }

      this.events.addClient(client)

      // Handle incoming messages
      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString())
          this.handleWebSocketMessage(client, message)
        } catch (error) {
          console.error('[ApiServer] Invalid WebSocket message:', error)
        }
      })

      // Handle disconnect
      ws.on('close', () => {
        console.log(`[ApiServer] WebSocket client disconnected: ${clientId}`)
        this.events.removeClient(clientId)
      })

      // Send welcome message
      ws.send(JSON.stringify({
        type: 'connected',
        clientId,
        timestamp: Date.now()
      }))
    })
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleWebSocketMessage(client: ConnectedClient, message: any): void {
    switch (message.type) {
      case 'subscribe':
        if (Array.isArray(message.channels)) {
          message.channels.forEach((ch: string) => client.subscriptions.add(ch))
        }
        break

      case 'unsubscribe':
        if (Array.isArray(message.channels)) {
          message.channels.forEach((ch: string) => client.subscriptions.delete(ch))
        }
        break

      case 'ping':
        client.ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }))
        break

      default:
        console.log('[ApiServer] Unknown WebSocket message type:', message.type)
    }
  }

  /**
   * Setup event forwarding from main process to WebSocket clients
   */
  private setupEventForwarding(): void {
    // Forward events from main window to WebSocket clients
    const mainWindow = getMainWindow()
    if (mainWindow) {
      // Intercept webContents.send calls and broadcast to WebSocket clients
      const originalSend = mainWindow.webContents.send.bind(mainWindow.webContents)
      mainWindow.webContents.send = (channel: string, ...args: any[]) => {
        // Call original for local Electron renderer
        originalSend(channel, ...args)
        // Also broadcast to WebSocket clients
        this.events.broadcast(channel, args.length === 1 ? args[0] : args)
      }
    }

    // Also listen for Ralph Loop events
    const ralphService = getRalphOrchestratorService()
    ralphService.on('session:update', (session) => {
      this.events.broadcast('ralph:session:update', session)
    })
    ralphService.on('checkpoint:pending', (data) => {
      this.events.broadcast('ralph:checkpoint:pending', data)
    })
    ralphService.on('task:complete', (data) => {
      this.events.broadcast('ralph:task:complete', data)
    })
    ralphService.on('session:complete', (data) => {
      this.events.broadcast('ralph:session:complete', data)
    })

    // Listen for Initiator events
    const initiatorService = getInitiatorService()
    initiatorService.on('response:chunk', (data) => {
      this.events.broadcast('initiator:response:chunk', data)
    })
    initiatorService.on('response:complete', (data) => {
      this.events.broadcast('initiator:response:complete', data)
    })
  }

  /**
   * Start the API server
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.server.listen(this.config.port, () => {
          this.isRunning = true
          console.log(`[ApiServer] HTTP server listening on port ${this.config.port}`)
          console.log(`[ApiServer] WebSocket server ready`)
          if (this.config.enableAuth) {
            console.log(`[ApiServer] Auth token: ${this.authToken}`)
          }
          resolve()
        })
      } catch (error) {
        reject(error)
      }
    })
  }

  /**
   * Stop the API server
   */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      // Close all WebSocket connections
      this.wss.clients.forEach((client) => {
        client.close()
      })

      // Close HTTP server
      this.server.close(() => {
        this.isRunning = false
        console.log('[ApiServer] Server stopped')
        resolve()
      })
    })
  }

  /**
   * Get server status
   */
  getStatus(): { running: boolean; port: number; clients: number; authEnabled: boolean } {
    return {
      running: this.isRunning,
      port: this.config.port,
      clients: this.events.getClientCount(),
      authEnabled: this.config.enableAuth
    }
  }

  /**
   * Get the auth token (for displaying to user)
   */
  getAuthToken(): string {
    return this.authToken
  }

  /**
   * Broadcast an event to all connected clients
   */
  broadcast(channel: string, data: unknown): void {
    this.events.broadcast(channel, data)
  }
}

// Singleton instance
let apiServer: ApiServer | null = null

export function getApiServer(): ApiServer | null {
  return apiServer
}

export function createApiServer(config: ApiServerConfig): ApiServer {
  if (apiServer) {
    return apiServer
  }
  apiServer = new ApiServer(config)
  return apiServer
}

export async function startApiServer(config: ApiServerConfig): Promise<ApiServer> {
  const server = createApiServer(config)
  await server.start()
  return server
}

export async function stopApiServer(): Promise<void> {
  if (apiServer) {
    await apiServer.stop()
    apiServer = null
  }
}

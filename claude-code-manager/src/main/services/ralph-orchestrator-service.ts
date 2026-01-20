/**
 * Ralph Orchestrator Service
 *
 * Manages the Ralph Loop autonomous orchestrator Python process.
 * Spawns the autonomous_agent_demo.py script and handles:
 * - JSON line output parsing for progress/checkpoint events
 * - stdin communication for checkpoint responses
 * - Process lifecycle (start/stop/pause/resume)
 * - State persistence via .autonomous/ directory
 */

import { EventEmitter } from 'events'
import { ChildProcess, spawn } from 'child_process'
import * as path from 'path'
import * as fs from 'fs/promises'
import { app } from 'electron'
import { getMainWindow } from '../index'
import { getPythonVenvManager } from './python-venv-manager'
import { IPC_CHANNELS } from '@shared/types'
import type {
  RalphPhase,
  RalphStatus,
  RalphExecutionState,
  RalphProgressEvent,
  RalphCheckpointEvent,
  RalphStatusEvent,
  RalphFeature,
  RalphCheckpoint,
  RalphPromptConfig
} from '@shared/types'

// Configuration for starting Ralph orchestrator
export interface RalphOrchestratorConfig {
  projectPath: string
  promptConfig: RalphPromptConfig
  phase?: RalphPhase
  resumeFromCheckpoint?: string
}

// Session representing a running Ralph execution
export interface RalphSession {
  id: string
  projectPath: string
  config: RalphOrchestratorConfig
  status: RalphStatus
  phase: RalphPhase
  iteration: number
  features: RalphFeature[]
  currentFeatureId: string | null
  startedAt: number
  pausedAt: number | null
  completedAt: number | null
  error: string | null
  totalCostUsd: number
}

// Constants
const AUTONOMOUS_DIR = '.autonomous'
const STATE_FILE = 'state/execution-state.json'
const FEATURE_LIST_FILE = 'feature_list.json'

/**
 * Generate unique session ID
 */
function generateId(): string {
  return `ralph-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
}

/**
 * Ralph Orchestrator Service
 */
export class RalphOrchestratorService extends EventEmitter {
  private sessions: Map<string, RalphSession> = new Map()
  private processes: Map<string, ChildProcess> = new Map()
  private outputBuffers: Map<string, string> = new Map()

  constructor() {
    super()
  }

  /**
   * Send event to renderer process
   */
  private sendToRenderer(channel: string, data: unknown): void {
    const mainWindow = getMainWindow()
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, data)
    }
  }

  /**
   * Get autonomous directory path
   */
  private getAutonomousDir(projectPath: string): string {
    return path.join(projectPath, AUTONOMOUS_DIR)
  }

  /**
   * Ensure .autonomous directory exists
   */
  private async ensureAutonomousDir(projectPath: string): Promise<string> {
    const autonomousPath = this.getAutonomousDir(projectPath)
    await fs.mkdir(path.join(autonomousPath, 'state'), { recursive: true })
    await fs.mkdir(path.join(autonomousPath, 'context'), { recursive: true })
    await fs.mkdir(path.join(autonomousPath, 'checkpoints'), { recursive: true })
    await fs.mkdir(path.join(autonomousPath, 'logs'), { recursive: true })
    return autonomousPath
  }

  /**
   * Load execution state from disk
   */
  private async loadExecutionState(projectPath: string): Promise<RalphExecutionState | null> {
    const statePath = path.join(this.getAutonomousDir(projectPath), STATE_FILE)
    try {
      const content = await fs.readFile(statePath, 'utf-8')
      return JSON.parse(content) as RalphExecutionState
    } catch {
      return null
    }
  }

  /**
   * Save execution state to disk
   */
  private async saveExecutionState(projectPath: string, state: RalphExecutionState): Promise<void> {
    const statePath = path.join(this.getAutonomousDir(projectPath), STATE_FILE)
    await fs.mkdir(path.dirname(statePath), { recursive: true })
    await fs.writeFile(statePath, JSON.stringify(state, null, 2))
  }

  /**
   * Load feature list from disk
   */
  private async loadFeatureList(projectPath: string): Promise<RalphFeature[]> {
    const featurePath = path.join(this.getAutonomousDir(projectPath), FEATURE_LIST_FILE)
    try {
      const content = await fs.readFile(featurePath, 'utf-8')
      return JSON.parse(content) as RalphFeature[]
    } catch {
      return []
    }
  }

  /**
   * Save feature list to disk
   */
  private async saveFeatureList(projectPath: string, features: RalphFeature[]): Promise<void> {
    const featurePath = path.join(this.getAutonomousDir(projectPath), FEATURE_LIST_FILE)
    await fs.writeFile(featurePath, JSON.stringify(features, null, 2))
  }

  /**
   * Get Python path from venv manager
   */
  private async getPythonPath(): Promise<string> {
    const venvManager = getPythonVenvManager()
    await venvManager.ensureReady()
    return venvManager.getPythonPath()
  }

  /**
   * Get orchestrator script path
   */
  private getOrchestratorPath(): string {
    // Development: relative to project
    // Production: bundled with app
    const devPath = path.join(process.cwd(), 'autonomous-orchestrator')
    const prodPath = path.join(app.getAppPath(), 'autonomous-orchestrator')

    // Check if dev path exists first
    try {
      require('fs').accessSync(devPath)
      return devPath
    } catch {
      return prodPath
    }
  }

  /**
   * Parse JSON line from process stdout
   */
  private parseJsonLine(sessionId: string, line: string): void {
    const trimmed = line.trim()
    if (!trimmed) return

    try {
      const event = JSON.parse(trimmed)
      this.handleStreamEvent(sessionId, event)
    } catch {
      // Non-JSON output (debug logs)
      this.sendToRenderer(IPC_CHANNELS.RALPH_STREAM_CHUNK, {
        sessionId,
        type: 'stdout',
        data: trimmed,
        timestamp: Date.now()
      })
    }
  }

  /**
   * Handle parsed stream event from Python process
   */
  private handleStreamEvent(sessionId: string, event: Record<string, unknown>): void {
    const session = this.sessions.get(sessionId)
    if (!session) return

    const eventType = event.type as string

    switch (eventType) {
      case 'progress': {
        const progressEvent = event as unknown as RalphProgressEvent
        session.phase = progressEvent.phase
        session.iteration = progressEvent.iteration

        this.sendToRenderer(IPC_CHANNELS.RALPH_PROGRESS, {
          sessionId,
          ...progressEvent
        })
        break
      }

      case 'checkpoint': {
        const checkpointEvent = event as unknown as RalphCheckpointEvent

        // For hard checkpoints, pause and wait for user response
        if (checkpointEvent.data.type === 'hard') {
          session.status = 'paused'
          session.pausedAt = Date.now()
        }

        this.sendToRenderer(IPC_CHANNELS.RALPH_CHECKPOINT, {
          sessionId,
          ...checkpointEvent
        })
        break
      }

      case 'status': {
        const statusEvent = event as unknown as RalphStatusEvent
        session.status = statusEvent.status
        session.phase = statusEvent.phase
        session.iteration = statusEvent.iteration

        if (statusEvent.status === 'completed') {
          session.completedAt = Date.now()
        }

        this.sendToRenderer(IPC_CHANNELS.RALPH_STATUS, {
          sessionId,
          ...statusEvent
        })
        break
      }

      case 'feature_update': {
        const featureId = event.featureId as string
        const status = event.status as RalphFeature['status']

        const feature = session.features.find(f => f.id === featureId)
        if (feature) {
          feature.status = status
          if (status === 'passed') {
            feature.completedAt = Date.now()
          }
        }

        // Also update current feature
        if (status === 'in_progress') {
          session.currentFeatureId = featureId
        }

        this.sendToRenderer(IPC_CHANNELS.RALPH_PROGRESS, {
          sessionId,
          type: 'feature_update',
          featureId,
          status,
          timestamp: Date.now()
        })
        break
      }

      case 'cost_update': {
        session.totalCostUsd = (event.totalCost as number) || 0
        break
      }

      case 'error': {
        session.status = 'error'
        session.error = (event.message as string) || 'Unknown error'

        this.sendToRenderer(IPC_CHANNELS.RALPH_ERROR, {
          sessionId,
          error: session.error,
          timestamp: Date.now()
        })
        break
      }

      default:
        // Unknown event type, just forward as stream chunk
        this.sendToRenderer(IPC_CHANNELS.RALPH_STREAM_CHUNK, {
          sessionId,
          type: 'event',
          data: event,
          timestamp: Date.now()
        })
    }
  }

  /**
   * Start a new Ralph orchestrator session
   */
  async start(config: RalphOrchestratorConfig): Promise<RalphSession> {
    const sessionId = generateId()

    console.log('[RalphOrchestrator] Starting session:', sessionId)
    console.log('[RalphOrchestrator] Project path:', config.projectPath)

    // Ensure .autonomous directory exists
    await this.ensureAutonomousDir(config.projectPath)

    // Check for existing state to resume
    const existingState = await this.loadExecutionState(config.projectPath)
    const existingFeatures = await this.loadFeatureList(config.projectPath)

    // Create session
    const session: RalphSession = {
      id: sessionId,
      projectPath: config.projectPath,
      config,
      status: 'starting',
      phase: config.phase || existingState?.phase || 'validation',
      iteration: existingState?.iteration || 0,
      features: existingFeatures.length > 0 ? existingFeatures : [],
      currentFeatureId: existingState?.currentFeature || null,
      startedAt: Date.now(),
      pausedAt: null,
      completedAt: null,
      error: null,
      totalCostUsd: 0
    }

    this.sessions.set(sessionId, session)

    try {
      // Get Python path
      const pythonPath = await this.getPythonPath()
      const orchestratorPath = this.getOrchestratorPath()

      console.log('[RalphOrchestrator] Python:', pythonPath)
      console.log('[RalphOrchestrator] Orchestrator:', orchestratorPath)

      // Build command args
      const args = [
        'autonomous_agent_demo.py',
        '--project-path', config.projectPath,
        '--max-iterations', String(config.promptConfig.maxIterations),
        '--checkpoint-threshold', String(config.promptConfig.checkpointThreshold)
      ]

      if (config.phase) {
        args.push('--phase', config.phase)
      }

      if (config.resumeFromCheckpoint) {
        args.push('--resume-from', config.resumeFromCheckpoint)
      }

      // Spawn process
      const proc = spawn(pythonPath, args, {
        cwd: orchestratorPath,
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1',
          PROJECT_PATH: config.projectPath
        },
        stdio: ['pipe', 'pipe', 'pipe']
      })

      this.processes.set(sessionId, proc)
      this.outputBuffers.set(sessionId, '')

      // Handle stdout (JSON lines)
      proc.stdout?.on('data', (data: Buffer) => {
        const buffer = this.outputBuffers.get(sessionId) || ''
        const newData = buffer + data.toString()
        const lines = newData.split('\n')

        // Keep incomplete line in buffer
        this.outputBuffers.set(sessionId, lines.pop() || '')

        // Process complete lines
        for (const line of lines) {
          this.parseJsonLine(sessionId, line)
        }
      })

      // Handle stderr (debug logs)
      proc.stderr?.on('data', (data: Buffer) => {
        const output = data.toString().trim()
        console.error('[RalphOrchestrator stderr]', output)

        this.sendToRenderer(IPC_CHANNELS.RALPH_STREAM_CHUNK, {
          sessionId,
          type: 'stderr',
          data: output,
          timestamp: Date.now()
        })
      })

      // Handle process errors
      proc.on('error', (error: Error) => {
        console.error('[RalphOrchestrator] Process error:', error)
        session.status = 'error'
        session.error = error.message

        this.sendToRenderer(IPC_CHANNELS.RALPH_ERROR, {
          sessionId,
          error: error.message,
          timestamp: Date.now()
        })
      })

      // Handle process exit
      proc.on('exit', (code: number | null, signal: string | null) => {
        console.log('[RalphOrchestrator] Process exited:', { code, signal })

        this.processes.delete(sessionId)
        this.outputBuffers.delete(sessionId)

        // Update session status
        if (code === 0) {
          session.status = 'completed'
          session.completedAt = Date.now()
        } else if (signal) {
          // Killed by signal (could be pause or stop)
          if (session.status !== 'paused') {
            session.status = 'error'
            session.error = `Process killed by signal: ${signal}`
          }
        } else {
          session.status = 'error'
          session.error = `Process exited with code: ${code}`
        }

        this.sendToRenderer(IPC_CHANNELS.RALPH_STATUS, {
          sessionId,
          type: 'status',
          status: session.status,
          phase: session.phase,
          iteration: session.iteration,
          timestamp: Date.now()
        })
      })

      // Update status to running
      session.status = 'running'

      this.sendToRenderer(IPC_CHANNELS.RALPH_STATUS, {
        sessionId,
        type: 'status',
        status: 'running',
        phase: session.phase,
        iteration: session.iteration,
        timestamp: Date.now()
      })

      console.log('[RalphOrchestrator] Process started, PID:', proc.pid)

      return session

    } catch (error) {
      console.error('[RalphOrchestrator] Failed to start:', error)
      session.status = 'error'
      session.error = error instanceof Error ? error.message : String(error)

      this.sendToRenderer(IPC_CHANNELS.RALPH_ERROR, {
        sessionId,
        error: session.error,
        timestamp: Date.now()
      })

      throw error
    }
  }

  /**
   * Stop a running session
   */
  async stop(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    const proc = this.processes.get(sessionId)

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    console.log('[RalphOrchestrator] Stopping session:', sessionId)

    if (proc) {
      // Send SIGTERM for graceful shutdown
      proc.kill('SIGTERM')

      // Wait a bit then force kill if needed
      setTimeout(() => {
        if (this.processes.has(sessionId)) {
          proc.kill('SIGKILL')
        }
      }, 5000)
    }

    session.status = 'error'
    session.error = 'Stopped by user'

    // Save state for potential resume
    await this.saveExecutionState(session.projectPath, {
      sessionId: sessionId,
      projectPath: session.projectPath,
      phase: session.phase,
      status: session.status,
      features: session.features,
      iteration: session.iteration,
      maxIterations: session.config.promptConfig.maxIterations,
      testsTotal: 0,
      testsPassing: 0,
      currentFeature: session.currentFeatureId || undefined,
      startedAt: session.startedAt,
      completedAt: undefined,
      error: session.error || undefined
    })
  }

  /**
   * Pause a running session
   */
  async pause(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    const proc = this.processes.get(sessionId)

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    if (session.status !== 'running') {
      throw new Error(`Cannot pause session in status: ${session.status}`)
    }

    console.log('[RalphOrchestrator] Pausing session:', sessionId)

    // Send SIGTSTP to pause (like Ctrl+Z)
    if (proc) {
      proc.kill('SIGTSTP')
    }

    session.status = 'paused'
    session.pausedAt = Date.now()

    // Save state
    await this.saveExecutionState(session.projectPath, {
      sessionId: sessionId,
      projectPath: session.projectPath,
      phase: session.phase,
      status: session.status,
      features: session.features,
      iteration: session.iteration,
      maxIterations: session.config.promptConfig.maxIterations,
      testsTotal: 0,
      testsPassing: 0,
      currentFeature: session.currentFeatureId || undefined,
      startedAt: session.startedAt,
      pausedAt: session.pausedAt || undefined,
      completedAt: undefined,
      error: session.error || undefined
    })

    this.sendToRenderer(IPC_CHANNELS.RALPH_STATUS, {
      sessionId,
      type: 'status',
      status: 'paused',
      phase: session.phase,
      iteration: session.iteration,
      timestamp: Date.now()
    })
  }

  /**
   * Resume a paused session
   */
  async resume(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    const proc = this.processes.get(sessionId)

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    if (session.status !== 'paused') {
      throw new Error(`Cannot resume session in status: ${session.status}`)
    }

    console.log('[RalphOrchestrator] Resuming session:', sessionId)

    // Send SIGCONT to resume
    if (proc) {
      proc.kill('SIGCONT')
    }

    session.status = 'running'
    session.pausedAt = null

    this.sendToRenderer(IPC_CHANNELS.RALPH_STATUS, {
      sessionId,
      type: 'status',
      status: 'running',
      phase: session.phase,
      iteration: session.iteration,
      timestamp: Date.now()
    })
  }

  /**
   * Respond to a checkpoint (approve/skip/reject)
   */
  async respondToCheckpoint(
    sessionId: string,
    checkpointId: string,
    response: 'approve' | 'skip' | 'reject',
    comment?: string
  ): Promise<void> {
    const proc = this.processes.get(sessionId)
    const session = this.sessions.get(sessionId)

    if (!proc || !session) {
      throw new Error(`Session not found or not running: ${sessionId}`)
    }

    console.log('[RalphOrchestrator] Checkpoint response:', { sessionId, checkpointId, response })

    // Write response to stdin as JSON
    const responseJson = JSON.stringify({
      type: 'checkpoint_response',
      checkpointId,
      response,
      comment,
      timestamp: Date.now()
    }) + '\n'

    proc.stdin?.write(responseJson)

    // If approving or skipping, update status back to running
    if (response === 'approve' || response === 'skip') {
      session.status = 'running'
      session.pausedAt = null
    } else {
      // Rejected - will stop
      session.status = 'error'
      session.error = 'Checkpoint rejected by user'
    }
  }

  /**
   * Get session status
   */
  getSession(sessionId: string): RalphSession | null {
    return this.sessions.get(sessionId) || null
  }

  /**
   * Get all sessions for a project
   */
  getProjectSessions(projectPath: string): RalphSession[] {
    return Array.from(this.sessions.values()).filter(
      s => s.projectPath === projectPath
    )
  }

  /**
   * Get all active sessions
   */
  getAllSessions(): RalphSession[] {
    return Array.from(this.sessions.values())
  }

  /**
   * Cleanup all sessions
   */
  async cleanup(): Promise<void> {
    console.log('[RalphOrchestrator] Cleaning up all sessions')

    for (const [sessionId, proc] of this.processes) {
      try {
        proc.kill('SIGTERM')
        this.processes.delete(sessionId)
      } catch (error) {
        console.error(`[RalphOrchestrator] Error killing process ${sessionId}:`, error)
      }
    }

    this.sessions.clear()
    this.outputBuffers.clear()
  }
}

// Singleton instance
let orchestratorService: RalphOrchestratorService | null = null

export function getRalphOrchestratorService(): RalphOrchestratorService {
  if (!orchestratorService) {
    orchestratorService = new RalphOrchestratorService()
  }
  return orchestratorService
}

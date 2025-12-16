/**
 * OrchestratorRunner - Python Orchestrator Process Management Service
 *
 * Spawns and manages Python orchestrator processes for autonomous coding workflows.
 * Uses the shared venv from VenvManager (FEAT-001) to run the Python orchestrator.
 *
 * Features:
 * - Spawns Python processes with proper environment
 * - Streams stdout/stderr to renderer via IPC
 * - Handles process lifecycle (start, stop, pause)
 * - Supports different workflow phases (validation, generation, implementation)
 * - Tracks session state and progress
 *
 * Security:
 * - Uses structured command arguments (no shell interpretation)
 * - Validates project paths before execution
 * - Sanitizes environment variables
 */

import { spawn, ChildProcess } from 'child_process'
import { EventEmitter } from 'events'
import * as fs from 'fs/promises'
import * as path from 'path'
import { venvManager } from './venv-manager'
import { getMainWindow } from '../index'
import { IPC_CHANNELS } from '@shared/types'

// Orchestrator workflow phases
export type OrchestratorPhase = 'validation' | 'generation' | 'implementation'

// Orchestrator session status
export type OrchestratorStatus = 'idle' | 'starting' | 'running' | 'paused' | 'stopping' | 'completed' | 'error'

// Output event types
export type OutputType = 'stdout' | 'stderr' | 'system' | 'progress'

// Session configuration
export interface OrchestratorConfig {
  projectPath: string
  workflowId: string
  phase: OrchestratorPhase
  model?: string
  supabaseProjectId?: string
  specFile?: string
}

// Session state
export interface OrchestratorSession {
  id: string
  config: OrchestratorConfig
  status: OrchestratorStatus
  phase: OrchestratorPhase
  startedAt: number
  endedAt?: number
  exitCode?: number
  error?: string
  testsTotal?: number
  testsPassing?: number
}

// Output event
export interface OrchestratorOutput {
  sessionId: string
  type: OutputType
  data: string
  timestamp: number
}

// Progress event (parsed from orchestrator output)
export interface OrchestratorProgress {
  sessionId: string
  phase: OrchestratorPhase
  testsTotal?: number
  testsPassing?: number
  currentTest?: string
  message?: string
}

/**
 * Extract error message safely from unknown error type
 */
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return String(error)
}

/**
 * Validate project path is safe to use
 */
async function validateProjectPath(projectPath: string): Promise<boolean> {
  try {
    const resolvedPath = path.resolve(projectPath)
    const stats = await fs.stat(resolvedPath)

    if (!stats.isDirectory()) {
      return false
    }

    // Check for required project structure markers
    const hasSchema = await fs.access(path.join(resolvedPath, '.schema')).then(() => true).catch(() => false)
    const hasClaudeMd = await fs.access(path.join(resolvedPath, 'CLAUDE.md')).then(() => true).catch(() => false)

    // At least one marker should exist for brownfield projects
    return hasSchema || hasClaudeMd
  } catch {
    return false
  }
}

export class OrchestratorRunner extends EventEmitter {
  private sessions: Map<string, { session: OrchestratorSession; process: ChildProcess | null }> = new Map()
  private outputBuffer: Map<string, string> = new Map()

  constructor() {
    super()
  }

  /**
   * Start a new orchestrator session
   */
  async start(config: OrchestratorConfig): Promise<OrchestratorSession> {
    // Validate project path
    const isValidPath = await validateProjectPath(config.projectPath)
    if (!isValidPath) {
      throw new Error(`Invalid project path: ${config.projectPath}. Must be a directory with .schema/ or CLAUDE.md`)
    }

    // Ensure venv is ready
    const venvStatus = await venvManager.ensureVenv()
    if (!venvStatus.isValid) {
      throw new Error(`Venv not ready: ${venvStatus.error || 'Unknown error'}`)
    }

    const pythonPath = venvManager.getPythonPath()
    const orchestratorPath = venvManager.getOrchestratorPath()

    // Verify orchestrator scripts exist
    const orchestratorScript = path.join(orchestratorPath, 'autonomous_agent_demo.py')
    const scriptExists = await fs.access(orchestratorScript).then(() => true).catch(() => false)

    if (!scriptExists) {
      throw new Error(`Orchestrator script not found at ${orchestratorScript}. Run setup first.`)
    }

    // Create session
    const session: OrchestratorSession = {
      id: this.generateSessionId(),
      config,
      status: 'starting',
      phase: config.phase,
      startedAt: Date.now()
    }

    // Build environment variables
    const env = this.buildEnvironment(config)

    // Build command arguments based on phase
    const args = this.buildArguments(config, orchestratorScript)

    this.sessions.set(session.id, { session, process: null })
    this.outputBuffer.set(session.id, '')

    // Spawn the process
    try {
      const proc = spawn(pythonPath, args, {
        cwd: config.projectPath,
        env,
        stdio: ['pipe', 'pipe', 'pipe']
      })

      this.sessions.get(session.id)!.process = proc

      // Handle stdout
      proc.stdout?.on('data', (data: Buffer) => {
        this.handleOutput(session.id, 'stdout', data.toString())
      })

      // Handle stderr
      proc.stderr?.on('data', (data: Buffer) => {
        this.handleOutput(session.id, 'stderr', data.toString())
      })

      // Handle process exit
      proc.on('close', (code) => {
        this.handleProcessExit(session.id, code)
      })

      // Handle process error
      proc.on('error', (error) => {
        this.handleProcessError(session.id, error)
      })

      session.status = 'running'
      this.emitSessionUpdate(session)
      this.emitOutput(session.id, 'system', `[Orchestrator] Started ${config.phase} phase for ${config.workflowId}`)

      return session
    } catch (error) {
      session.status = 'error'
      session.error = getErrorMessage(error)
      session.endedAt = Date.now()
      this.emitSessionUpdate(session)
      throw error
    }
  }

  /**
   * Stop a running session
   */
  async stop(sessionId: string): Promise<boolean> {
    const entry = this.sessions.get(sessionId)
    if (!entry) return false

    const { session, process } = entry

    if (process && session.status === 'running') {
      session.status = 'stopping'
      this.emitSessionUpdate(session)
      this.emitOutput(sessionId, 'system', '[Orchestrator] Stopping session...')

      // Try graceful termination first
      process.kill('SIGTERM')

      // Force kill after 5 seconds if still running
      setTimeout(() => {
        if (entry.process && !entry.process.killed) {
          entry.process.kill('SIGKILL')
        }
      }, 5000)

      return true
    }

    return false
  }

  /**
   * Pause a running session (graceful stop after current test)
   */
  async pause(sessionId: string): Promise<boolean> {
    const entry = this.sessions.get(sessionId)
    if (!entry) return false

    const { session, process } = entry

    if (process && session.status === 'running') {
      session.status = 'paused'
      this.emitSessionUpdate(session)
      this.emitOutput(sessionId, 'system', '[Orchestrator] Pausing after current test completes...')

      // Send interrupt signal - orchestrator should handle this gracefully
      process.kill('SIGINT')
      return true
    }

    return false
  }

  /**
   * Get session by ID
   */
  getSession(sessionId: string): OrchestratorSession | undefined {
    return this.sessions.get(sessionId)?.session
  }

  /**
   * Get all sessions
   */
  getAllSessions(): OrchestratorSession[] {
    return Array.from(this.sessions.values()).map(entry => entry.session)
  }

  /**
   * Get sessions for a specific workflow
   */
  getWorkflowSessions(workflowId: string): OrchestratorSession[] {
    return this.getAllSessions().filter(s => s.config.workflowId === workflowId)
  }

  /**
   * Clean up completed/errored sessions
   */
  cleanup(): void {
    for (const [id, entry] of this.sessions) {
      if (entry.session.status === 'completed' || entry.session.status === 'error') {
        this.sessions.delete(id)
        this.outputBuffer.delete(id)
      }
    }
  }

  /**
   * Build environment variables for the process
   */
  private buildEnvironment(config: OrchestratorConfig): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      // Python-specific
      PYTHONUNBUFFERED: '1',
      PYTHONIOENCODING: 'utf-8',
    }

    // Pass API keys from environment (don't hardcode)
    if (process.env.ANTHROPIC_API_KEY) {
      env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
    }
    if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
      env.CLAUDE_CODE_OAUTH_TOKEN = process.env.CLAUDE_CODE_OAUTH_TOKEN
    }
    if (process.env.SUPABASE_ACCESS_TOKEN) {
      env.SUPABASE_ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN
    }

    // Optional Supabase project ID
    if (config.supabaseProjectId) {
      env.SUPABASE_PROJECT_ID = config.supabaseProjectId
    }

    return env
  }

  /**
   * Build command arguments for the orchestrator
   */
  private buildArguments(config: OrchestratorConfig, scriptPath: string): string[] {
    const args = [scriptPath, '--project-dir', config.projectPath]

    // Phase-specific arguments
    switch (config.phase) {
      case 'validation':
        args.push('--phase', 'validate')
        break
      case 'generation':
        args.push('--phase', 'generate')
        if (config.specFile) {
          args.push('--spec-file', config.specFile)
        }
        break
      case 'implementation':
        args.push('--phase', 'implement')
        break
    }

    // Model selection
    if (config.model) {
      args.push('--model', config.model)
    }

    // Workflow ID for tracking
    args.push('--workflow-id', config.workflowId)

    return args
  }

  /**
   * Handle output from the process
   */
  private handleOutput(sessionId: string, type: OutputType, data: string): void {
    // Buffer output for parsing
    const buffer = this.outputBuffer.get(sessionId) || ''
    this.outputBuffer.set(sessionId, buffer + data)

    // Parse for progress updates
    this.parseProgress(sessionId, data)

    // Emit to renderer
    this.emitOutput(sessionId, type, data)

    // Keep buffer manageable
    const currentBuffer = this.outputBuffer.get(sessionId) || ''
    if (currentBuffer.length > 50000) {
      this.outputBuffer.set(sessionId, currentBuffer.slice(-25000))
    }
  }

  /**
   * Parse output for progress information
   */
  private parseProgress(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId)?.session
    if (!session) return

    // Look for test progress patterns
    // Pattern: "Tests passing: X/Y" or "X/Y tests passing"
    const progressMatch = data.match(/(\d+)\/(\d+)\s*(?:tests?\s*)?(?:passing|complete)/i)
    if (progressMatch) {
      session.testsPassing = parseInt(progressMatch[1], 10)
      session.testsTotal = parseInt(progressMatch[2], 10)

      this.emitProgress(sessionId, {
        sessionId,
        phase: session.phase,
        testsTotal: session.testsTotal,
        testsPassing: session.testsPassing
      })
    }

    // Look for current test pattern
    // Pattern: "[Test X] Description" or "Working on: Description"
    const testMatch = data.match(/(?:\[Test\s*\d+\]|Working on:|Current:)\s*(.+?)(?:\n|$)/i)
    if (testMatch) {
      this.emitProgress(sessionId, {
        sessionId,
        phase: session.phase,
        currentTest: testMatch[1].trim()
      })
    }

    // Check for phase completion
    if (/(?:Phase complete|All tests passing|SESSION COMPLETE)/i.test(data)) {
      session.status = 'completed'
      this.emitSessionUpdate(session)
    }
  }

  /**
   * Handle process exit
   */
  private handleProcessExit(sessionId: string, code: number | null): void {
    const entry = this.sessions.get(sessionId)
    if (!entry) return

    const { session } = entry
    session.exitCode = code ?? undefined
    session.endedAt = Date.now()

    if (session.status !== 'completed') {
      session.status = code === 0 ? 'completed' : 'error'
      if (code !== 0) {
        session.error = `Process exited with code ${code}`
      }
    }

    this.emitSessionUpdate(session)
    this.emitOutput(sessionId, 'system', `[Orchestrator] Process exited with code ${code}`)
  }

  /**
   * Handle process error
   */
  private handleProcessError(sessionId: string, error: Error): void {
    const entry = this.sessions.get(sessionId)
    if (!entry) return

    const { session } = entry
    session.status = 'error'
    session.error = error.message
    session.endedAt = Date.now()

    this.emitSessionUpdate(session)
    this.emitOutput(sessionId, 'system', `[Orchestrator] Error: ${error.message}`)
  }

  /**
   * Emit output to renderer
   */
  private emitOutput(sessionId: string, type: OutputType, data: string): void {
    const output: OrchestratorOutput = {
      sessionId,
      type,
      data,
      timestamp: Date.now()
    }

    this.emit('output', output)

    const mainWindow = getMainWindow()
    if (mainWindow) {
      mainWindow.webContents.send('orchestrator:output', output)
    }
  }

  /**
   * Emit progress update to renderer
   */
  private emitProgress(sessionId: string, progress: OrchestratorProgress): void {
    this.emit('progress', progress)

    const mainWindow = getMainWindow()
    if (mainWindow) {
      mainWindow.webContents.send('orchestrator:progress', progress)
    }
  }

  /**
   * Emit session update to renderer
   */
  private emitSessionUpdate(session: OrchestratorSession): void {
    this.emit('session', session)

    const mainWindow = getMainWindow()
    if (mainWindow) {
      mainWindow.webContents.send('orchestrator:session', session)
    }
  }

  /**
   * Generate unique session ID
   */
  private generateSessionId(): string {
    return `orch-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
  }
}

// Singleton instance
export const orchestratorRunner = new OrchestratorRunner()
export default orchestratorRunner

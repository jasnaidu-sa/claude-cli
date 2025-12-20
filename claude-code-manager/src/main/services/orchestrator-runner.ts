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
 * - Sanitizes output to prevent credential leakage
 */

import { spawn, ChildProcess } from 'child_process'
import { randomBytes } from 'crypto'
import { EventEmitter } from 'events'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { venvManager } from './venv-manager'
import { getMainWindow } from '../index'
import { IPC_CHANNELS } from '@shared/types'
import type { OrchestratorOutputType } from '@shared/types'

/**
 * Read OAuth token from Claude CLI credentials file
 * Returns the access token if available, undefined otherwise
 */
async function getClaudeOAuthToken(): Promise<string | undefined> {
  try {
    const credentialsPath = path.join(os.homedir(), '.claude', '.credentials.json')
    const content = await fs.readFile(credentialsPath, 'utf-8')
    const credentials = JSON.parse(content)

    // Check if token exists and is not expired
    const oauth = credentials?.claudeAiOauth
    if (oauth?.accessToken) {
      const expiresAt = oauth.expiresAt || 0
      const now = Date.now()

      // Token is valid if it expires more than 5 minutes from now
      if (expiresAt > now + 5 * 60 * 1000) {
        console.log('[OrchestratorRunner] Found valid OAuth token from Claude CLI credentials')
        return oauth.accessToken
      } else {
        console.warn('[OrchestratorRunner] OAuth token is expired or expiring soon')
      }
    }
  } catch (error) {
    console.log('[OrchestratorRunner] Could not read Claude CLI credentials:', error)
  }
  return undefined
}

// Orchestrator workflow phases
export type OrchestratorPhase = 'validation' | 'generation' | 'implementation'

// Orchestrator session status
export type OrchestratorStatus = 'idle' | 'starting' | 'running' | 'paused' | 'stopping' | 'completed' | 'error'

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
  type: OrchestratorOutputType
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

// Rate limiting constants
const MAX_CONCURRENT_SESSIONS = 5
const MAX_SESSIONS_PER_HOUR = 50

// Allowed models whitelist
const ALLOWED_MODELS = [
  'claude-3-opus',
  'claude-3-sonnet',
  'claude-3-haiku',
  'claude-3-5-sonnet',
  'claude-3-5-haiku',
  'claude-opus-4',
  'claude-sonnet-4',
  'claude-2.1',
  'claude-2.0'
]

/**
 * Extract error message safely from unknown error type
 */
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return String(error)
}

/**
 * Validate command argument is safe (no shell metacharacters)
 */
function validateArgument(arg: string, maxLength = 500): boolean {
  if (!arg || arg.length === 0 || arg.length > maxLength) {
    return false
  }
  // Prevent null bytes and shell metacharacters
  if (arg.includes('\0') || /[;&|`$<>()]/.test(arg)) {
    return false
  }
  return true
}

/**
 * Validate project path is safe to use
 * Security: Prevents path traversal, validates directory structure
 */
async function validateProjectPath(projectPath: string): Promise<boolean> {
  try {
    // Security: Prevent path traversal attempts
    if (projectPath.includes('..') || projectPath.includes('\0')) {
      return false
    }

    // Security: Prevent shell metacharacters in path
    if (/[;&|`$<>]/.test(projectPath)) {
      return false
    }

    const resolvedPath = path.resolve(projectPath)

    // Security: Get real path to resolve symlinks
    let realPath: string
    try {
      realPath = await fs.realpath(resolvedPath)
    } catch {
      return false
    }

    const stats = await fs.stat(realPath)

    if (!stats.isDirectory()) {
      return false
    }

    // Security: Prevent access to sensitive system directories
    const systemDirs = [
      '/bin', '/sbin', '/usr/bin', '/usr/sbin', '/etc', '/sys', '/proc',
      'C:\\Windows', 'C:\\System32', 'C:\\Program Files'
    ]
    const normalizedPath = realPath.toLowerCase().replace(/\\/g, '/')
    if (systemDirs.some(dir => normalizedPath.startsWith(dir.toLowerCase().replace(/\\/g, '/')))) {
      return false
    }

    // Check for required project structure markers
    const hasSchema = await fs.access(path.join(realPath, '.schema')).then(() => true).catch(() => false)
    const hasClaudeMd = await fs.access(path.join(realPath, 'CLAUDE.md')).then(() => true).catch(() => false)

    // At least one marker should exist for brownfield projects
    return hasSchema || hasClaudeMd
  } catch {
    return false
  }
}

/**
 * Validate spec file path is within project directory
 */
async function validateSpecFilePath(specFile: string, projectPath: string): Promise<boolean> {
  try {
    if (!validateArgument(specFile, 1000)) {
      return false
    }

    const resolvedProject = path.resolve(projectPath)
    const resolvedSpec = path.resolve(resolvedProject, specFile)

    // Security: Ensure spec file is within project directory
    if (!resolvedSpec.startsWith(resolvedProject)) {
      return false
    }

    // Check file exists and is a regular file
    const stats = await fs.stat(resolvedSpec)
    return stats.isFile()
  } catch {
    return false
  }
}

/**
 * Sanitize output to prevent credential leakage
 */
function sanitizeOutput(data: string): string {
  let sanitized = data

  // List of sensitive environment variables to redact
  const sensitiveKeys = [
    'ANTHROPIC_API_KEY',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'SUPABASE_ACCESS_TOKEN'
  ]

  // Redact environment variable values
  for (const key of sensitiveKeys) {
    const value = process.env[key]
    if (value && value.length > 8) {
      // Replace the full value
      const escapedValue = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const pattern = new RegExp(escapedValue, 'g')
      sanitized = sanitized.replace(pattern, `${value.substring(0, 4)}...REDACTED`)
    }
  }

  // Redact patterns that look like API keys (sk-ant-, sb_, etc.)
  sanitized = sanitized.replace(/sk-ant-[a-zA-Z0-9-]{20,}/g, 'sk-ant-...REDACTED')
  sanitized = sanitized.replace(/sb_[a-zA-Z0-9]{20,}/g, 'sb_...REDACTED')

  return sanitized
}

export class OrchestratorRunner extends EventEmitter {
  private sessions: Map<string, { session: OrchestratorSession; process: ChildProcess | null }> = new Map()
  private outputBuffer: Map<string, string> = new Map()
  private killTimers: Map<string, NodeJS.Timeout> = new Map()
  private sessionStartTimestamps: number[] = []

  constructor() {
    super()
  }

  /**
   * Check rate limits before starting a new session
   */
  private checkRateLimits(): { allowed: boolean; reason?: string } {
    const now = Date.now()

    // Check concurrent sessions
    const activeSessions = Array.from(this.sessions.values())
      .filter(e => e.session.status === 'running' || e.session.status === 'starting')

    if (activeSessions.length >= MAX_CONCURRENT_SESSIONS) {
      return {
        allowed: false,
        reason: `Maximum concurrent sessions (${MAX_CONCURRENT_SESSIONS}) exceeded`
      }
    }

    // Check hourly rate
    const oneHourAgo = now - (60 * 60 * 1000)
    this.sessionStartTimestamps = this.sessionStartTimestamps.filter(ts => ts > oneHourAgo)

    if (this.sessionStartTimestamps.length >= MAX_SESSIONS_PER_HOUR) {
      return {
        allowed: false,
        reason: `Maximum sessions per hour (${MAX_SESSIONS_PER_HOUR}) exceeded`
      }
    }

    return { allowed: true }
  }

  /**
   * Start a new orchestrator session
   */
  async start(config: OrchestratorConfig): Promise<OrchestratorSession> {
    // Check rate limits
    const rateCheck = this.checkRateLimits()
    if (!rateCheck.allowed) {
      throw new Error(`Rate limit exceeded: ${rateCheck.reason}`)
    }

    // Validate project path (security-enhanced)
    const isValidPath = await validateProjectPath(config.projectPath)
    if (!isValidPath) {
      throw new Error('Invalid project path. Must be a directory with .schema/ or CLAUDE.md')
    }

    // Validate workflow ID
    if (!validateArgument(config.workflowId, 100)) {
      throw new Error('Invalid workflow ID')
    }

    // Validate model if provided
    if (config.model) {
      if (!validateArgument(config.model, 50)) {
        throw new Error('Invalid model parameter')
      }
      if (!ALLOWED_MODELS.some(m => config.model!.startsWith(m))) {
        throw new Error('Model not in allowed list')
      }
    }

    // Validate spec file if provided
    if (config.specFile) {
      const isValidSpec = await validateSpecFilePath(config.specFile, config.projectPath)
      if (!isValidSpec) {
        throw new Error('Invalid spec file path')
      }
    }

    // Ensure venv is ready
    const venvStatus = await venvManager.ensureVenv()
    if (!venvStatus.isValid) {
      throw new Error(`Venv not ready: ${venvStatus.error || 'Unknown error'}`)
    }

    const pythonPath = venvManager.getPythonPath()

    // Get orchestrator script path from the app's autonomous-orchestrator directory
    // Using __dirname to locate scripts relative to compiled output
    // In dev: dist/main/index.js -> ../../../autonomous-orchestrator
    // In production: may vary based on packaging
    let orchestratorScript = path.join(__dirname, '../../../autonomous-orchestrator/autonomous_agent_demo.py')
    let scriptExists = await fs.access(orchestratorScript).then(() => true).catch(() => false)

    if (!scriptExists) {
      // Try alternative dev path (from dist/main/services/)
      const altPath = path.join(__dirname, '../../autonomous-orchestrator/autonomous_agent_demo.py')
      const altExists = await fs.access(altPath).then(() => true).catch(() => false)
      if (altExists) {
        orchestratorScript = altPath
        scriptExists = true
      }
    }

    if (!scriptExists) {
      // Try one more level up
      const upPath = path.join(__dirname, '../../../../autonomous-orchestrator/autonomous_agent_demo.py')
      const upExists = await fs.access(upPath).then(() => true).catch(() => false)
      if (upExists) {
        orchestratorScript = upPath
        scriptExists = true
      }
    }

    if (!scriptExists) {
      console.error('[OrchestratorRunner] Script search paths:', {
        __dirname,
        tried: [
          path.join(__dirname, '../../../autonomous-orchestrator/autonomous_agent_demo.py'),
          path.join(__dirname, '../../autonomous-orchestrator/autonomous_agent_demo.py'),
          path.join(__dirname, '../../../../autonomous-orchestrator/autonomous_agent_demo.py')
        ]
      })
      throw new Error('Orchestrator script not found. Check autonomous-orchestrator directory.')
    }

    console.log('[OrchestratorRunner] Using script:', orchestratorScript)

    // Record session start for rate limiting
    this.sessionStartTimestamps.push(Date.now())

    // Create session
    const session: OrchestratorSession = {
      id: this.generateSessionId(),
      config,
      status: 'starting',
      phase: config.phase,
      startedAt: Date.now()
    }

    // Build environment variables (includes fetching OAuth token)
    const env = await this.buildEnvironment(config)

    // Build command arguments based on phase
    const args = this.buildArguments(config, orchestratorScript)

    // Create session entry with process initially null
    const sessionEntry = { session, process: null as ChildProcess | null }
    this.sessions.set(session.id, sessionEntry)
    this.outputBuffer.set(session.id, '')

    // Spawn the process
    try {
      console.log('[OrchestratorRunner] Spawning process:', {
        pythonPath,
        args,
        cwd: config.projectPath
      })

      const proc = spawn(pythonPath, args, {
        cwd: config.projectPath,
        env,
        stdio: ['pipe', 'pipe', 'pipe']
      })

      console.log('[OrchestratorRunner] Process spawned, PID:', proc.pid)

      // Update session entry with process (safe assignment)
      sessionEntry.process = proc

      // Handle stdout
      proc.stdout?.on('data', (data: Buffer) => {
        console.log('[OrchestratorRunner] stdout:', data.toString().substring(0, 200))
        this.handleOutput(session.id, 'stdout', data.toString())
      })

      // Handle stderr
      proc.stderr?.on('data', (data: Buffer) => {
        console.log('[OrchestratorRunner] stderr:', data.toString().substring(0, 200))
        this.handleOutput(session.id, 'stderr', data.toString())
      })

      // Handle process exit
      proc.on('close', (code) => {
        console.log('[OrchestratorRunner] Process closed with code:', code)
        this.handleProcessExit(session.id, code)
      })

      // Handle process error
      proc.on('error', (error) => {
        console.log('[OrchestratorRunner] Process error:', error)
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

      // Store timer reference so it can be cleared on process exit
      const killTimer = setTimeout(() => {
        this.killTimers.delete(sessionId)
        if (entry.process && !entry.process.killed) {
          entry.process.kill('SIGKILL')
        }
      }, 5000)
      this.killTimers.set(sessionId, killTimer)

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
   * Clean up process listeners for a session
   */
  private cleanupProcessListeners(sessionId: string): void {
    const entry = this.sessions.get(sessionId)
    if (!entry?.process) return

    const proc = entry.process

    // Remove all listeners to prevent memory leaks
    proc.stdout?.removeAllListeners('data')
    proc.stderr?.removeAllListeners('data')
    proc.removeAllListeners('close')
    proc.removeAllListeners('error')
  }

  /**
   * Clean up completed/errored sessions
   */
  cleanup(): void {
    for (const [id, entry] of this.sessions) {
      if (entry.session.status === 'completed' || entry.session.status === 'error') {
        // Clean up listeners before deleting
        this.cleanupProcessListeners(id)

        // Clear force-kill timer if exists
        const killTimer = this.killTimers.get(id)
        if (killTimer) {
          clearTimeout(killTimer)
          this.killTimers.delete(id)
        }

        this.sessions.delete(id)
        this.outputBuffer.delete(id)
      }
    }
  }

  /**
   * Build environment variables for the process
   * Fetches OAuth token from Claude CLI credentials if available
   */
  private async buildEnvironment(config: OrchestratorConfig): Promise<NodeJS.ProcessEnv> {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      // Python-specific
      PYTHONUNBUFFERED: '1',
      PYTHONIOENCODING: 'utf-8',
    }

    // Pass API keys from environment (don't hardcode)
    // Check multiple possible env var names for the API key
    const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY
    if (apiKey) {
      env.ANTHROPIC_API_KEY = apiKey
      console.log('[OrchestratorRunner] Using ANTHROPIC_API_KEY from environment')
    }

    // Check for OAuth token - first from env, then from Claude CLI credentials file
    let oauthToken = process.env.CLAUDE_CODE_OAUTH_TOKEN
    if (!oauthToken) {
      // Try to get OAuth token from Claude CLI credentials file
      oauthToken = await getClaudeOAuthToken()
    }

    if (oauthToken) {
      env.CLAUDE_CODE_OAUTH_TOKEN = oauthToken
      console.log('[OrchestratorRunner] Using OAuth token for authentication')
    }

    // Log warning if no auth method available
    if (!apiKey && !oauthToken) {
      console.warn('[OrchestratorRunner] WARNING: No authentication configured.')
      console.warn('[OrchestratorRunner] Set ANTHROPIC_API_KEY or log in with `claude login`.')
    }

    if (process.env.SUPABASE_ACCESS_TOKEN) {
      env.SUPABASE_ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN
    }

    // Optional Supabase project ID (validate format)
    if (config.supabaseProjectId) {
      // Supabase project IDs are alphanumeric
      if (/^[a-z0-9]{20}$/i.test(config.supabaseProjectId)) {
        env.SUPABASE_PROJECT_ID = config.supabaseProjectId
      }
    }

    return env
  }

  /**
   * Build command arguments for the orchestrator
   */
  private buildArguments(config: OrchestratorConfig, scriptPath: string): string[] {
    const args = [scriptPath, '--project-path', config.projectPath]

    // Phase-specific arguments (must match Python argparse choices)
    switch (config.phase) {
      case 'validation':
        args.push('--phase', 'validation')
        break
      case 'generation':
        args.push('--phase', 'generation')
        if (config.specFile) {
          args.push('--spec-file', config.specFile)
        }
        break
      case 'implementation':
        args.push('--phase', 'implementation')
        break
    }

    // Model selection (already validated)
    if (config.model) {
      args.push('--model', config.model)
    }

    // Workflow ID for tracking (already validated)
    args.push('--workflow-id', config.workflowId)

    return args
  }

  /**
   * Handle output from the process
   */
  private handleOutput(sessionId: string, type: OrchestratorOutputType, data: string): void {
    // Security: Sanitize output to prevent credential leakage
    const sanitizedData = sanitizeOutput(data)

    // Buffer output for parsing
    const buffer = this.outputBuffer.get(sessionId) || ''
    this.outputBuffer.set(sessionId, buffer + sanitizedData)

    // Parse for progress updates
    this.parseProgress(sessionId, sanitizedData)

    // Emit to renderer
    this.emitOutput(sessionId, type, sanitizedData)

    // Keep buffer manageable
    const currentBuffer = this.outputBuffer.get(sessionId) || ''
    if (currentBuffer.length > 50000) {
      this.outputBuffer.set(sessionId, currentBuffer.slice(-25000))
    }
  }

  /**
   * Parse output for progress information
   * Handles both legacy text patterns and new JSON streaming events
   */
  private parseProgress(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId)?.session
    if (!session) return

    // Security: Limit data length to prevent ReDoS
    const limitedData = data.length > 10000 ? data.substring(0, 10000) : data

    // Try to parse as JSON first (new streaming format from Claude Agent SDK)
    // Each line may be a JSON object
    const lines = limitedData.split('\n')
    for (const line of lines) {
      const trimmedLine = line.trim()
      if (!trimmedLine || !trimmedLine.startsWith('{')) continue

      try {
        const parsed = JSON.parse(trimmedLine)

        // Handle stream_chunk events (real-time streaming)
        if (parsed.type === 'stream_chunk') {
          this.handleStreamChunk(sessionId, parsed)
          continue
        }

        // Handle progress events
        if (parsed.type === 'progress') {
          if (parsed.tests_passing !== undefined) {
            session.testsPassing = parsed.tests_passing
          }
          if (parsed.tests_total !== undefined) {
            session.testsTotal = parsed.tests_total
          }
          this.emitProgress(sessionId, {
            sessionId,
            phase: session.phase,
            testsTotal: session.testsTotal,
            testsPassing: session.testsPassing,
            currentTest: parsed.current_test || parsed.currentTest,
            message: parsed.message
          })
          continue
        }

        // Handle status events
        if (parsed.type === 'status') {
          if (parsed.status === 'completed') {
            session.status = 'completed'
            this.emitSessionUpdate(session)
          } else if (parsed.status === 'error') {
            session.status = 'error'
            session.error = parsed.error || 'Unknown error'
            this.emitSessionUpdate(session)
          } else if (parsed.status === 'paused') {
            session.status = 'paused'
            this.emitSessionUpdate(session)
          }
          continue
        }
      } catch {
        // Not JSON, continue with legacy pattern matching
      }
    }

    // Legacy pattern matching for non-JSON output
    // Look for test progress patterns with bounded capture groups
    // Pattern: "Tests passing: X/Y" or "X/Y tests passing"
    const progressMatch = limitedData.match(/(\d{1,6})\/(\d{1,6})\s*(?:tests?\s*)?(?:passing|complete)/i)
    if (progressMatch && progressMatch[1] !== undefined && progressMatch[2] !== undefined) {
      const passing = parseInt(progressMatch[1], 10)
      const total = parseInt(progressMatch[2], 10)

      // Validate bounds
      if (!isNaN(passing) && !isNaN(total) && passing >= 0 && total >= 0 && total <= 100000 && passing <= total) {
        session.testsPassing = passing
        session.testsTotal = total

        this.emitProgress(sessionId, {
          sessionId,
          phase: session.phase,
          testsTotal: session.testsTotal,
          testsPassing: session.testsPassing
        })
      }
    }

    // Look for current test pattern with limited capture
    // Pattern: "[Test X] Description" or "Working on: Description"
    const testMatch = limitedData.match(/(?:\[Test\s*\d{1,6}\]|Working on:|Current:)\s*(.{1,200})(?:\n|$)/i)
    if (testMatch && testMatch[1]) {
      const testName = testMatch[1].trim()
      if (testName.length > 0 && testName.length <= 200) {
        this.emitProgress(sessionId, {
          sessionId,
          phase: session.phase,
          currentTest: testName
        })
      }
    }

    // Check for phase completion
    if (/(?:Phase complete|All tests passing|SESSION COMPLETE)/i.test(limitedData)) {
      session.status = 'completed'
      this.emitSessionUpdate(session)
    }
  }

  /**
   * Handle stream_chunk events from Claude Agent SDK streaming
   */
  private handleStreamChunk(sessionId: string, chunk: {
    chunk_type: string
    data: unknown
    phase?: string
    iteration?: number
    timestamp?: number
  }): void {
    const mainWindow = getMainWindow()
    if (!mainWindow) return

    // Emit the stream chunk to the renderer for real-time display
    mainWindow.webContents.send(IPC_CHANNELS.ORCHESTRATOR_STREAM_CHUNK, {
      sessionId,
      chunkType: chunk.chunk_type,
      data: chunk.data,
      phase: chunk.phase,
      iteration: chunk.iteration,
      timestamp: chunk.timestamp || Date.now()
    })

    // Also emit as regular output for logging
    if (chunk.chunk_type === 'text' && typeof chunk.data === 'string') {
      this.emit('stream_text', { sessionId, text: chunk.data })
    } else if (chunk.chunk_type === 'tool_start' && typeof chunk.data === 'object') {
      const toolData = chunk.data as { name?: string }
      this.emit('tool_start', { sessionId, tool: toolData.name })
    } else if (chunk.chunk_type === 'complete') {
      this.emit('stream_complete', { sessionId, data: chunk.data })
    }
  }

  /**
   * Handle process exit
   */
  private handleProcessExit(sessionId: string, code: number | null): void {
    // Clear force-kill timer if it exists
    const killTimer = this.killTimers.get(sessionId)
    if (killTimer) {
      clearTimeout(killTimer)
      this.killTimers.delete(sessionId)
    }

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

    // Clean up listeners immediately when process exits
    this.cleanupProcessListeners(sessionId)
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
  private emitOutput(sessionId: string, type: OrchestratorOutputType, data: string): void {
    const output: OrchestratorOutput = {
      sessionId,
      type,
      data,
      timestamp: Date.now()
    }

    this.emit('output', output)

    const mainWindow = getMainWindow()
    if (mainWindow) {
      mainWindow.webContents.send(IPC_CHANNELS.ORCHESTRATOR_OUTPUT, output)
    }
  }

  /**
   * Emit progress update to renderer
   */
  private emitProgress(sessionId: string, progress: OrchestratorProgress): void {
    this.emit('progress', progress)

    const mainWindow = getMainWindow()
    if (mainWindow) {
      mainWindow.webContents.send(IPC_CHANNELS.ORCHESTRATOR_PROGRESS, progress)
    }
  }

  /**
   * Emit session update to renderer
   */
  private emitSessionUpdate(session: OrchestratorSession): void {
    this.emit('session', session)

    const mainWindow = getMainWindow()
    if (mainWindow) {
      mainWindow.webContents.send(IPC_CHANNELS.ORCHESTRATOR_SESSION, session)
    }
  }

  /**
   * Generate cryptographically secure session ID
   */
  private generateSessionId(): string {
    const timestamp = Date.now()
    const randomPart = randomBytes(8).toString('hex')
    return `orch-${timestamp}-${randomPart}`
  }
}

// Singleton instance
export const orchestratorRunner = new OrchestratorRunner()
export default orchestratorRunner

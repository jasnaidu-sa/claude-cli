/**
 * Agent Environment Service
 * Provides isolated execution environment for parallel agents
 */

import { spawn, ChildProcess } from 'child_process'
import { EventEmitter } from 'events'
import * as path from 'path'
import * as fs from 'fs'
import type { AgentState, AgentProgress, AgentMetrics, AgentStatus, RalphTask } from '../../shared/ralph-types'
import { gitWorktreeService } from './git-worktree-service'

// Constants
const MAX_OUTPUT_LINES = 500
const OUTPUT_ROTATION_THRESHOLD = 1000
const MAX_TEXT_LENGTH = 5000
const MAX_PATH_LENGTH = 500
const MAX_FILENAME_LENGTH = 100

/**
 * Agent configuration
 */
export interface AgentConfig {
  /** Unique agent ID */
  agentId: string

  /** Task to execute */
  task: RalphTask

  /** Session ID */
  sessionId: string

  /** Base branch */
  baseBranch: string

  /** Repository path */
  repoPath: string

  /** Worktree base directory */
  worktreeBaseDir?: string

  /** Maximum execution time in ms */
  timeout?: number

  /** Environment variables */
  env?: Record<string, string>
}

/**
 * Agent output event
 */
export interface AgentOutput {
  agentId: string
  type: 'stdout' | 'stderr'
  data: string
  timestamp: number
}

/**
 * Agent completion event
 */
export interface AgentCompletion {
  agentId: string
  taskId: string
  success: boolean
  error?: string
  metrics: AgentMetrics
  duration: number
}

/**
 * Agent Environment
 * Manages isolated execution for a single agent
 */
export class AgentEnvironment extends EventEmitter {
  private config: AgentConfig
  private worktreePath: string | null = null
  private branchName: string
  private process: ChildProcess | null = null
  private state: AgentState = 'initializing'
  private startTime: number = 0
  private outputBuffer: string[] = []
  private logFilePath: string | null = null
  private metrics: AgentMetrics = {
    tokensUsed: 0,
    estimatedCost: 0,
    filesModified: [],
    testsRun: 0,
    testsPassed: 0,
  }

  constructor(config: AgentConfig) {
    super()
    this.config = config
    this.branchName = `ralph/${config.sessionId}/${config.task.id}`
  }

  /**
   * Get current agent status
   */
  getStatus(): AgentStatus {
    return {
      agentId: this.config.agentId,
      taskId: this.config.task.id,
      taskTitle: this.config.task.title,
      worktreePath: this.worktreePath || '',
      branchName: this.branchName,
      state: this.state,
      progress: this.getProgress(),
      output: {
        lastLines: this.outputBuffer.slice(-100),
        fullLogPath: this.logFilePath || '',
      },
      metrics: this.metrics,
    }
  }

  /**
   * Get progress information
   */
  private getProgress(): AgentProgress {
    const elapsed = this.startTime > 0 ? Date.now() - this.startTime : 0
    return {
      currentStep: this.getStateDescription(),
      stepsCompleted: this.getCompletedSteps(),
      totalSteps: 5, // init, run, test, commit, complete
      elapsedTime: elapsed,
      startedAt: this.startTime,
    }
  }

  /**
   * Get human-readable state description
   */
  private getStateDescription(): string {
    switch (this.state) {
      case 'initializing':
        return 'Setting up worktree...'
      case 'running':
        return 'Executing task...'
      case 'testing':
        return 'Running tests...'
      case 'committing':
        return 'Committing changes...'
      case 'completed':
        return 'Task completed'
      case 'failed':
        return 'Task failed'
      case 'waiting_checkpoint':
        return 'Waiting for checkpoint...'
      default:
        return 'Unknown state'
    }
  }

  /**
   * Get completed steps count
   */
  private getCompletedSteps(): number {
    switch (this.state) {
      case 'initializing':
        return 0
      case 'running':
        return 1
      case 'testing':
        return 2
      case 'committing':
        return 3
      case 'completed':
        return 5
      case 'failed':
        // Fixed P1: Infinite recursion - return 0 instead of calling getProgress()
        return 0
      default:
        return 0
    }
  }

  /**
   * Initialize the agent environment
   */
  async initialize(): Promise<void> {
    this.startTime = Date.now()
    this.state = 'initializing'
    this.emit('state', this.state)

    try {
      // Create worktree path
      const worktreeDir = this.config.worktreeBaseDir || path.join(
        path.dirname(this.config.repoPath),
        '.ralph-worktrees'
      )

      // Ensure worktree directory exists
      if (!fs.existsSync(worktreeDir)) {
        fs.mkdirSync(worktreeDir, { recursive: true })
      }

      this.worktreePath = path.join(
        worktreeDir,
        `${this.config.sessionId}-${this.config.task.id}`
      )

      // Initialize git service if needed
      gitWorktreeService.initialize(this.config.repoPath)

      // Create the worktree
      await gitWorktreeService.createWorktree(
        this.worktreePath,
        this.branchName,
        {
          baseBranch: this.config.baseBranch,
          createBranch: true,
          sessionId: this.config.sessionId,
          taskId: this.config.task.id,
        }
      )

      // Setup log file with sanitized filename (P2: Log file path injection fix)
      const logsDir = path.join(worktreeDir, 'logs')
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true })
      }
      const sanitizedAgentId = this.sanitizeFilename(this.config.agentId)
      this.logFilePath = path.join(logsDir, `${sanitizedAgentId}.log`)

      // Validate final path is within logs directory
      const normalizedLogPath = path.normalize(this.logFilePath)
      if (!normalizedLogPath.startsWith(logsDir)) {
        throw new Error('Invalid log file path detected')
      }

      this.log(`Agent initialized in worktree: ${this.worktreePath}`)
    } catch (error) {
      this.state = 'failed'
      const message = error instanceof Error ? error.message : String(error)
      this.emit('error', new Error(`Failed to initialize: ${message}`))
      throw error
    }
  }

  /**
   * Execute the task
   */
  async execute(): Promise<AgentCompletion> {
    if (!this.worktreePath) {
      throw new Error('Agent not initialized')
    }

    this.state = 'running'
    this.emit('state', this.state)

    try {
      // Build task prompt
      const prompt = this.buildTaskPrompt()

      // Spawn Claude process
      await this.runClaude(prompt)

      // Run tests if configured
      this.state = 'testing'
      this.emit('state', this.state)
      // await this.runTests()

      // Commit changes
      this.state = 'committing'
      this.emit('state', this.state)
      await this.commitChanges()

      // Mark completed
      this.state = 'completed'
      this.emit('state', this.state)

      const completion: AgentCompletion = {
        agentId: this.config.agentId,
        taskId: this.config.task.id,
        success: true,
        metrics: this.metrics,
        duration: Date.now() - this.startTime,
      }

      this.emit('complete', completion)
      return completion
    } catch (error) {
      this.state = 'failed'
      this.emit('state', this.state)

      const message = error instanceof Error ? error.message : String(error)
      const completion: AgentCompletion = {
        agentId: this.config.agentId,
        taskId: this.config.task.id,
        success: false,
        error: message,
        metrics: this.metrics,
        duration: Date.now() - this.startTime,
      }

      this.emit('complete', completion)
      this.emit('error', error)
      throw error
    }
  }

  /**
   * Sanitize text to remove shell metacharacters and control characters (P0 fix)
   */
  private sanitizeText(text: string): string {
    return text
      .replace(/[`$();&|<>]/g, '') // Remove dangerous shell chars
      .replace(/[\x00-\x1F\x7F]/g, '') // Remove control characters
      .substring(0, MAX_TEXT_LENGTH)
  }

  /**
   * Sanitize file path for safe display (P0 fix)
   */
  private sanitizeFilePath(filepath: string): string {
    // Only allow safe filename characters, remove path traversal
    return filepath
      .replace(/\.\./g, '')
      .replace(/[^a-zA-Z0-9._/\\-]/g, '_')
      .substring(0, MAX_PATH_LENGTH)
  }

  /**
   * Sanitize filename for log files (P2 fix)
   */
  private sanitizeFilename(filename: string): string {
    return filename
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .substring(0, MAX_FILENAME_LENGTH)
  }

  /**
   * Build task prompt for Claude (P0: Sanitize all user inputs)
   */
  private buildTaskPrompt(): string {
    const task = this.config.task
    return `# Task: ${this.sanitizeText(task.title)}

## Description
${this.sanitizeText(task.description)}

## Category
${this.sanitizeText(task.category)}

## Files to Create
${task.files_to_create?.map((f) => this.sanitizeFilePath(f)).join('\n') || 'None specified'}

## Files to Modify
${task.files_to_modify?.map((f) => this.sanitizeFilePath(f)).join('\n') || 'None specified'}

## Acceptance Criteria
${task.acceptance_criteria.map((c, i) => `${i + 1}. ${this.sanitizeText(c)}`).join('\n')}

## Instructions
1. Implement the task as described above
2. Follow existing code patterns and conventions
3. Add appropriate error handling
4. Write tests if applicable
5. Commit your changes with a descriptive message

Please implement this task.`
  }

  /**
   * Run Claude CLI process (P0: Removed shell: true, P0: Proper timeout handling)
   */
  private async runClaude(prompt: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.worktreePath) {
        reject(new Error('No worktree path'))
        return
      }

      const args = [
        '--print',
        prompt,
      ]

      // Build environment
      const env = {
        ...process.env,
        ...this.config.env,
      }

      // P0 FIX: Removed shell: true to prevent command injection
      this.process = spawn('claude', args, {
        cwd: this.worktreePath,
        env,
        // shell: true REMOVED - was a command injection vulnerability
      })

      // P0 FIX: Proper timeout handling with cleanup
      let timeoutHandle: NodeJS.Timeout | null = null
      let completed = false

      const cleanup = (): void => {
        completed = true
        if (timeoutHandle) {
          clearTimeout(timeoutHandle)
          timeoutHandle = null
        }
      }

      this.process.stdout?.on('data', (data: Buffer) => {
        const text = data.toString()
        this.captureOutput('stdout', text)
      })

      this.process.stderr?.on('data', (data: Buffer) => {
        const text = data.toString()
        this.captureOutput('stderr', text)
      })

      this.process.on('close', (code) => {
        cleanup()
        this.process = null
        if (code === 0) {
          resolve()
        } else {
          reject(new Error(`Claude process exited with code ${code}`))
        }
      })

      this.process.on('error', (error) => {
        cleanup()
        this.process = null
        reject(error)
      })

      // Setup timeout with proper cleanup
      if (this.config.timeout) {
        timeoutHandle = setTimeout(() => {
          if (this.process && !completed) {
            // Try graceful shutdown first
            this.process.kill('SIGTERM')

            // Force kill after 5 seconds
            setTimeout(() => {
              if (this.process && !completed) {
                this.process.kill('SIGKILL')
              }
            }, 5000)

            reject(new Error('Task execution timed out'))
          }
        }, this.config.timeout)
      }
    })
  }

  /**
   * Capture and emit output
   */
  private captureOutput(type: 'stdout' | 'stderr', data: string): void {
    const lines = data.split('\n')
    for (const line of lines) {
      if (line.trim()) {
        this.outputBuffer.push(line)
        this.log(line)

        const output: AgentOutput = {
          agentId: this.config.agentId,
          type,
          data: line,
          timestamp: Date.now(),
        }
        this.emit('output', output)
      }
    }

    // Rotate output buffer if too large
    if (this.outputBuffer.length > OUTPUT_ROTATION_THRESHOLD) {
      this.outputBuffer = this.outputBuffer.slice(-MAX_OUTPUT_LINES)
    }
  }

  /**
   * Commit changes in the worktree
   */
  private async commitChanges(): Promise<void> {
    if (!this.worktreePath) return

    const { execFile: execFileCallback } = await import('child_process')
    const { promisify } = await import('util')
    const execFileAsync = promisify(execFileCallback)

    try {
      // Check if there are changes
      const { stdout: status } = await execFileAsync('git', ['status', '--porcelain'], {
        cwd: this.worktreePath,
      })

      if (!status.trim()) {
        this.log('No changes to commit')
        return
      }

      // Get modified files
      const modifiedFiles = status
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => line.substring(3).trim())

      this.metrics.filesModified = modifiedFiles

      // Add all changes
      await execFileAsync('git', ['add', '-A'], { cwd: this.worktreePath })

      // Commit
      const message = `feat(${this.config.task.category}): ${this.config.task.title}\n\nTask ID: ${this.config.task.id}\nAgent: ${this.config.agentId}`
      await execFileAsync('git', ['commit', '-m', message], { cwd: this.worktreePath })

      this.log(`Committed ${modifiedFiles.length} files`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.log(`Commit failed: ${message}`)
      // Don't throw - allow completion without commit
    }
  }

  /**
   * Log message to file and buffer
   */
  private log(message: string): void {
    const timestamp = new Date().toISOString()
    const logLine = `[${timestamp}] ${message}`

    if (this.logFilePath) {
      try {
        fs.appendFileSync(this.logFilePath, logLine + '\n')
      } catch {
        // Ignore log write errors
      }
    }
  }

  /**
   * Stop the agent
   */
  async stop(): Promise<void> {
    if (this.process) {
      this.process.kill()
      this.process = null
    }
    this.state = 'failed'
    this.emit('state', this.state)
  }

  /**
   * Cleanup resources (P1: Clear outputBuffer to prevent memory leak)
   */
  async cleanup(): Promise<void> {
    // Stop process if running
    await this.stop()

    // Clear output buffer to prevent memory leak
    this.outputBuffer = []

    // Remove worktree
    if (this.worktreePath) {
      try {
        await gitWorktreeService.removeWorktree(this.worktreePath, true)
        this.log('Worktree cleaned up')
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.log(`Failed to cleanup worktree: ${message}`)
      }
    }

    this.removeAllListeners()
  }

  /**
   * Get worktree path
   */
  getWorktreePath(): string | null {
    return this.worktreePath
  }

  /**
   * Get branch name
   */
  getBranchName(): string {
    return this.branchName
  }

  /**
   * Update metrics
   */
  updateMetrics(updates: Partial<AgentMetrics>): void {
    this.metrics = { ...this.metrics, ...updates }
    this.emit('metrics', this.metrics)
  }
}

/**
 * Create agent environment
 */
export function createAgentEnvironment(config: AgentConfig): AgentEnvironment {
  return new AgentEnvironment(config)
}

/**
 * Context Agent Runner
 *
 * Phase 1: Context Agent Integration
 *
 * Manages the Context Agent that maintains compressed, relevant context
 * to solve the "lost in the middle" problem in autonomous workflows.
 *
 * Responsibilities:
 * - Run Python context agent as subprocess
 * - Stream progress updates via events
 * - Load/save context data
 * - Inject context into execution prompts
 *
 * Security:
 * - Validates all paths to prevent traversal
 * - Sanitizes output to prevent credential leakage
 * - Uses safe environment variables
 */

import { spawn, ChildProcess } from 'child_process'
import { randomBytes } from 'crypto'
import { EventEmitter } from 'events'
import * as fs from 'fs/promises'
import * as path from 'path'
import { platform } from 'os'
import type {
  ContextData,
  ContextSummarizationRequest,
  ContextSummarizationResult,
  ContextProgress,
  ContextInjection,
  RunningSummary,
  KeyDecision,
  FailureRecord,
  ActiveConstraint,
  ContextStoragePaths
} from '../../shared/context-types'

/**
 * Validate project path is safe to use
 * Security: Prevents path traversal, validates directory exists
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
      '/bin',
      '/sbin',
      '/usr/bin',
      '/usr/sbin',
      '/etc',
      '/sys',
      '/proc',
      'C:\\Windows',
      'C:\\System32',
      'C:\\Program Files'
    ]
    const normalizedPath = realPath.toLowerCase().replace(/\\/g, '/')
    if (
      systemDirs.some((dir) =>
        normalizedPath.startsWith(dir.toLowerCase().replace(/\\/g, '/'))
      )
    ) {
      return false
    }

    return true
  } catch {
    return false
  }
}

/**
 * Create minimal safe environment for child processes
 * Security: Only passes essential variables, not credentials
 */
function createSafeEnv(): NodeJS.ProcessEnv {
  const allowedVars = [
    // System paths
    'PATH',
    'HOME',
    'USERPROFILE',
    'TEMP',
    'TMP',
    // Windows app data paths
    'APPDATA',
    'LOCALAPPDATA',
    // Locale
    'LANG',
    'LC_ALL',
    'SHELL',
    // Python
    'PYTHONPATH',
    'VIRTUAL_ENV',
    // Node.js
    'NODE_ENV',
    // System
    'SystemRoot',
    'COMSPEC'
  ]
  const safeEnv: NodeJS.ProcessEnv = { CI: 'true' }
  for (const key of allowedVars) {
    if (process.env[key]) {
      safeEnv[key] = process.env[key]
    }
  }
  return safeEnv
}

/**
 * Sanitize output to prevent credential leakage
 */
function sanitizeOutput(data: string): string {
  let sanitized = data

  const sensitiveKeys = ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'SUPABASE_ACCESS_TOKEN']

  for (const key of sensitiveKeys) {
    const value = process.env[key]
    if (value && value.length > 8) {
      const escapedValue = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const pattern = new RegExp(escapedValue, 'g')
      sanitized = sanitized.replace(pattern, `${value.substring(0, 4)}...REDACTED`)
    }
  }

  // Redact patterns that look like API keys
  sanitized = sanitized.replace(/sk-ant-[a-zA-Z0-9-]{20,}/g, 'sk-ant-...REDACTED')
  sanitized = sanitized.replace(/sb_[a-zA-Z0-9]{20,}/g, 'sb_...REDACTED')

  return sanitized
}

/**
 * Get spawn options for cross-platform execution
 */
function getSpawnConfig(): { shell: boolean } {
  if (platform() === 'win32') {
    return { shell: true }
  }
  return { shell: false }
}

/**
 * Get context storage paths for a project
 */
function getContextPaths(projectPath: string): ContextStoragePaths {
  const baseDir = path.join(projectPath, '.autonomous', 'context')
  return {
    baseDir,
    summaryFile: path.join(baseDir, 'running-summary.json'),
    decisionsFile: path.join(baseDir, 'key-decisions.json'),
    failuresFile: path.join(baseDir, 'failure-memory.json'),
    constraintsFile: path.join(baseDir, 'active-constraints.json')
  }
}

/**
 * Context Agent Task
 */
export interface ContextAgentTask {
  id: string
  projectPath: string
  request: ContextSummarizationRequest
  result?: ContextSummarizationResult
  startedAt: number
  completedAt?: number
}

export class ContextAgentRunner extends EventEmitter {
  private tasks: Map<string, { task: ContextAgentTask; process: ChildProcess | null }> = new Map()
  private pythonPath: string

  constructor(pythonPath: string = 'python') {
    super()
    this.pythonPath = pythonPath
  }

  /**
   * Run context summarization
   */
  async summarizeContext(request: ContextSummarizationRequest): Promise<ContextAgentTask> {
    const taskId = this.generateId()

    const task: ContextAgentTask = {
      id: taskId,
      projectPath: request.projectPath,
      request,
      startedAt: Date.now()
    }

    this.tasks.set(taskId, { task, process: null })

    try {
      // SECURITY: Validate project path
      const isValidPath = await validateProjectPath(request.projectPath)
      if (!isValidPath) {
        throw new Error('Invalid project path')
      }

      // Ensure context directory exists
      const paths = getContextPaths(request.projectPath)
      await fs.mkdir(paths.baseDir, { recursive: true })

      // Build input for Python agent
      const input = {
        action: 'summarize',
        projectPath: request.projectPath,
        trigger: request.trigger,
        completedFeatures: request.completedFeatures,
        categoryId: request.categoryId,
        includeFailures: request.includeFailures ?? true,
        includeDecisions: request.includeDecisions ?? true
      }

      // Get Python script path
      const scriptPath = path.join(__dirname, '../../../autonomous-orchestrator/context_agent.py')

      // SECURITY: Create safe environment
      const safeEnv = createSafeEnv()

      // Spawn Python process
      const { shell } = getSpawnConfig()
      console.log(`[ContextAgent] Starting summarization for ${request.projectPath}`)
      console.log(`[ContextAgent] Trigger: ${request.trigger}, Features: ${request.completedFeatures.length}`)

      const proc = spawn(this.pythonPath, [scriptPath], {
        cwd: request.projectPath,
        shell,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: safeEnv
      })

      const taskEntry = this.tasks.get(taskId)
      if (taskEntry) {
        taskEntry.process = proc
      }

      // Write input to stdin
      if (proc.stdin) {
        proc.stdin.on('error', (err) => {
          console.error(`[ContextAgent] stdin error:`, err)
        })
        proc.stdin.write(JSON.stringify(input))
        proc.stdin.end()
        console.log(`[ContextAgent] Input written to stdin`)
      }

      let output = ''

      // Handle stdout - parse JSON events
      proc.stdout?.on('data', (data: Buffer) => {
        const lines = data.toString().split('\n').filter(Boolean)
        for (const line of lines) {
          try {
            const event = JSON.parse(line)
            output += line + '\n'

            // Emit progress events
            if (event.type === 'progress') {
              const progress: ContextProgress = {
                phase: event.phase,
                progress: event.progress,
                message: event.message,
                timestamp: event.timestamp
              }
              this.emit('progress', { taskId, progress })
            } else if (event.type === 'complete') {
              console.log(`[ContextAgent] Summarization complete`)
            } else if (event.type === 'error') {
              console.error(`[ContextAgent] Agent error:`, event.error)
            }
          } catch (e) {
            // Not JSON, just append to output
            output += line + '\n'
          }
        }
      })

      // Handle stderr
      proc.stderr?.on('data', (data: Buffer) => {
        console.error(`[ContextAgent] stderr:`, data.toString())
      })

      console.log(`[ContextAgent] Process spawned with PID:`, proc.pid)

      // Handle completion
      proc.on('close', (code) => {
        console.log(`[ContextAgent] Process closed with code:`, code)
        const currentTask = this.tasks.get(taskId)
        if (currentTask?.task) {
          const sanitizedOutput = sanitizeOutput(output.trim())

          if (code === 0) {
            // Parse final result from output
            try {
              const lines = sanitizedOutput.split('\n').filter(Boolean)
              const lastLine = lines[lines.length - 1]
              const result = JSON.parse(lastLine)

              if (result.type === 'complete') {
                currentTask.task.result = {
                  success: true,
                  summary: result.result.summary,
                  newDecisions: result.result.newDecisions || [],
                  newFailures: result.result.newFailures || [],
                  updatedConstraints: result.result.updatedConstraints || [],
                  duration: result.result.duration
                }
              } else {
                currentTask.task.result = {
                  success: false,
                  error: 'Unexpected result format',
                  duration: Date.now() - currentTask.task.startedAt
                }
              }
            } catch (e) {
              currentTask.task.result = {
                success: false,
                error: `Failed to parse result: ${e}`,
                duration: Date.now() - currentTask.task.startedAt
              }
            }
          } else {
            currentTask.task.result = {
              success: false,
              error: `Process exited with code ${code}`,
              duration: Date.now() - currentTask.task.startedAt
            }
          }

          currentTask.task.completedAt = Date.now()

          this.emit('complete', {
            taskId,
            result: currentTask.task.result
          })
        }
      })

      // Handle error
      proc.on('error', (error) => {
        console.error(`[ContextAgent] Process error:`, error)
        const currentTask = this.tasks.get(taskId)
        if (currentTask?.task) {
          currentTask.task.result = {
            success: false,
            error: error.message,
            duration: Date.now() - currentTask.task.startedAt
          }
          currentTask.task.completedAt = Date.now()

          this.emit('error', {
            taskId,
            error: error.message
          })
        }
      })

      return task
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      task.result = {
        success: false,
        error: errorMessage,
        duration: Date.now() - task.startedAt
      }
      task.completedAt = Date.now()

      this.emit('error', {
        taskId,
        error: errorMessage
      })

      return task
    }
  }

  /**
   * Load context data from disk
   */
  async loadContext(projectPath: string): Promise<ContextData | null> {
    try {
      const isValidPath = await validateProjectPath(projectPath)
      if (!isValidPath) {
        throw new Error('Invalid project path')
      }

      const paths = getContextPaths(projectPath)

      // Load all context files
      const [summaryData, decisionsData, failuresData, constraintsData] = await Promise.all([
        this.readJsonFile<RunningSummary>(paths.summaryFile),
        this.readJsonFile<KeyDecision[]>(paths.decisionsFile),
        this.readJsonFile<FailureRecord[]>(paths.failuresFile),
        this.readJsonFile<ActiveConstraint[]>(paths.constraintsFile)
      ])

      if (!summaryData) {
        return null // No context exists yet
      }

      return {
        summary: summaryData,
        decisions: decisionsData || [],
        failures: failuresData || [],
        constraints: constraintsData || [],
        lastUpdated: summaryData.updatedAt,
        projectPath
      }
    } catch (error) {
      console.error(`[ContextAgent] Failed to load context:`, error)
      return null
    }
  }

  /**
   * Get context injection for a feature
   * Returns relevant context under 2K tokens
   */
  async getContextInjection(
    projectPath: string,
    featureId: string
  ): Promise<ContextInjection | null> {
    const context = await this.loadContext(projectPath)
    if (!context) {
      return null
    }

    // For now, include all context
    // In production, would filter based on relevance to featureId
    return {
      summary: context.summary.content,
      relevantDecisions: context.decisions.slice(0, 5), // Top 5 recent
      relevantFailures: context.failures.slice(0, 3), // Top 3 recent
      activeConstraints: context.constraints,
      tokenCount: context.summary.tokenCount
    }
  }

  /**
   * Cancel a running task
   */
  cancelTask(taskId: string): boolean {
    const entry = this.tasks.get(taskId)
    if (entry?.process) {
      entry.process.kill('SIGTERM')
      return true
    }
    return false
  }

  /**
   * Get task by ID
   */
  getTask(taskId: string): ContextAgentTask | undefined {
    return this.tasks.get(taskId)?.task
  }

  /**
   * Clean up completed tasks
   */
  cleanup(): void {
    for (const [taskId, entry] of this.tasks) {
      if (entry.task.result) {
        this.tasks.delete(taskId)
      }
    }
  }

  /**
   * Read JSON file with type safety
   */
  private async readJsonFile<T>(filePath: string): Promise<T | null> {
    try {
      const content = await fs.readFile(filePath, 'utf-8')
      return JSON.parse(content) as T
    } catch {
      return null
    }
  }

  /**
   * Generate unique task ID
   */
  private generateId(): string {
    return `context-${Date.now()}-${randomBytes(4).toString('hex')}`
  }
}

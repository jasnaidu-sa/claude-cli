/**
 * Research Agent Runner
 *
 * FEAT-020: Process Agent Integration
 *
 * Manages background research agents that run during discovery chat.
 * These agents analyze user requirements and codebase to help build specifications.
 *
 * Agent Types:
 * - process: Extracts requirements, constraints, and key features from user input
 * - codebase: Analyzes existing codebase patterns, tech stack, conventions
 * - spec-builder: Builds structured specification from conversation
 *
 * Security:
 * - Uses shell: false to prevent command injection
 * - Validates all paths and inputs
 * - Sanitizes output to prevent credential leakage
 */

import { spawn, ChildProcess } from 'child_process'
import { randomBytes } from 'crypto'
import { EventEmitter } from 'events'
import * as fs from 'fs/promises'
import * as path from 'path'
import { ConfigStore } from './config-store'

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
      '/bin', '/sbin', '/usr/bin', '/usr/sbin', '/etc', '/sys', '/proc',
      'C:\\Windows', 'C:\\System32', 'C:\\Program Files'
    ]
    const normalizedPath = realPath.toLowerCase().replace(/\\/g, '/')
    if (systemDirs.some(dir => normalizedPath.startsWith(dir.toLowerCase().replace(/\\/g, '/')))) {
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
  const allowedVars = ['PATH', 'HOME', 'USERPROFILE', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'SHELL']
  const safeEnv: NodeJS.ProcessEnv = {
    CI: 'true'
  }

  for (const key of allowedVars) {
    if (process.env[key]) {
      safeEnv[key] = process.env[key]
    }
  }

  return safeEnv
}

// Research agent types
export type ResearchAgentType = 'process' | 'codebase' | 'spec-builder'

// Agent status
export type AgentStatus = 'idle' | 'running' | 'complete' | 'error'

// Agent result
export interface AgentResult {
  agentType: ResearchAgentType
  status: AgentStatus
  output?: string
  error?: string
  startedAt: number
  completedAt?: number
}

// Agent task configuration
export interface AgentTask {
  id: string
  type: ResearchAgentType
  sessionId: string
  projectPath: string
  input: string
  result?: AgentResult
}

// Prompts for different agent types
const AGENT_PROMPTS: Record<ResearchAgentType, string> = {
  process: `You are a requirements analyst. Extract and structure the key requirements from the user's description.

Focus on:
1. Core features and functionality
2. Technical constraints or preferences
3. Integration requirements
4. User experience expectations
5. Non-functional requirements (performance, security, scalability)

Output a structured summary in JSON format:
{
  "features": ["list of features"],
  "constraints": ["technical constraints"],
  "integrations": ["required integrations"],
  "ux_requirements": ["UX expectations"],
  "non_functional": ["performance/security/etc requirements"]
}`,

  codebase: `You are a codebase analyst. Analyze the existing project structure and patterns.

Focus on:
1. Project structure and organization
2. Technology stack (frameworks, libraries)
3. Code conventions and patterns
4. Existing similar features to reference
5. Configuration and build setup

Output a structured summary in JSON format:
{
  "tech_stack": {"frontend": [], "backend": [], "database": [], "tools": []},
  "patterns": ["observed patterns"],
  "conventions": {"naming": "", "structure": ""},
  "similar_features": ["existing features to reference"],
  "config": {"build_tool": "", "test_framework": ""}
}`,

  'spec-builder': `You are a specification builder. Create a detailed technical specification from the gathered requirements and codebase analysis.

The specification should include:
1. Feature overview and scope
2. Technical approach
3. Component breakdown
4. API design (if applicable)
5. Data models (if applicable)
6. Testing strategy
7. Implementation phases

Output a structured specification in markdown format suitable for app-spec.txt.`
}

/**
 * Sanitize output to prevent credential leakage
 */
function sanitizeOutput(data: string): string {
  let sanitized = data

  const sensitiveKeys = [
    'ANTHROPIC_API_KEY',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'SUPABASE_ACCESS_TOKEN'
  ]

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

export class ResearchAgentRunner extends EventEmitter {
  private tasks: Map<string, { task: AgentTask; process: ChildProcess | null }> = new Map()
  private configStore: ConfigStore

  constructor(configStore: ConfigStore) {
    super()
    this.configStore = configStore
  }

  /**
   * Run a research agent
   */
  async runAgent(
    type: ResearchAgentType,
    sessionId: string,
    projectPath: string,
    context: string
  ): Promise<AgentTask> {
    const taskId = this.generateId()

    const task: AgentTask = {
      id: taskId,
      type,
      sessionId,
      projectPath,
      input: context,
      result: {
        agentType: type,
        status: 'running',
        startedAt: Date.now()
      }
    }

    this.tasks.set(taskId, { task, process: null })
    this.emit('status', { sessionId, agentName: type, status: 'running' })

    try {
      // SECURITY: Validate project path to prevent path traversal
      const isValidPath = await validateProjectPath(projectPath)
      if (!isValidPath) {
        throw new Error('Invalid project path')
      }

      // Build the prompt for this agent
      const prompt = this.buildPrompt(type, context, projectPath)

      // Get Claude CLI path and validate
      const claudePath = this.configStore.get('claudeCliPath')
      if (!claudePath || typeof claudePath !== 'string') {
        throw new Error('Claude CLI path not configured')
      }

      // SECURITY: Create minimal safe environment (no credentials)
      const safeEnv = createSafeEnv()

      // Spawn Claude CLI
      // SECURITY: Using shell: false and stdin to prevent command injection
      const proc = spawn(claudePath, ['--print', '-'], {
        cwd: projectPath,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: safeEnv
      })

      const taskEntry = this.tasks.get(taskId)
      if (taskEntry) {
        taskEntry.process = proc
      }

      // Write prompt to stdin
      if (proc.stdin) {
        proc.stdin.write(prompt)
        proc.stdin.end()
      }

      let output = ''

      // Handle stdout
      proc.stdout?.on('data', (data: Buffer) => {
        output += data.toString()
      })

      // Handle stderr
      proc.stderr?.on('data', (data: Buffer) => {
        console.error(`[ResearchAgent:${type}] stderr:`, data.toString())
      })

      // Handle completion
      proc.on('close', (code) => {
        const currentTask = this.tasks.get(taskId)
        if (currentTask?.task.result) {
          const sanitizedOutput = sanitizeOutput(output.trim())

          if (code === 0 && sanitizedOutput) {
            currentTask.task.result.status = 'complete'
            currentTask.task.result.output = sanitizedOutput
          } else {
            currentTask.task.result.status = 'error'
            currentTask.task.result.error = `Agent exited with code ${code}`
          }
          currentTask.task.result.completedAt = Date.now()

          this.emit('status', {
            sessionId,
            agentName: type,
            status: currentTask.task.result.status,
            output: currentTask.task.result.output,
            error: currentTask.task.result.error
          })
          this.emit('complete', { taskId, result: currentTask.task.result })
        }
      })

      // Handle error
      proc.on('error', (error) => {
        const currentTask = this.tasks.get(taskId)
        if (currentTask?.task.result) {
          currentTask.task.result.status = 'error'
          currentTask.task.result.error = error.message
          currentTask.task.result.completedAt = Date.now()

          this.emit('status', {
            sessionId,
            agentName: type,
            status: 'error',
            error: error.message
          })
        }
      })

      return task
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      task.result = {
        agentType: type,
        status: 'error',
        error: errorMessage,
        startedAt: task.result?.startedAt || Date.now(),
        completedAt: Date.now()
      }

      this.emit('status', {
        sessionId,
        agentName: type,
        status: 'error',
        error: errorMessage
      })

      return task
    }
  }

  /**
   * Cancel a running agent task
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
   * Cancel all tasks for a session
   */
  cancelSessionTasks(sessionId: string): void {
    for (const [taskId, entry] of this.tasks) {
      if (entry.task.sessionId === sessionId && entry.process) {
        entry.process.kill('SIGTERM')
      }
    }
  }

  /**
   * Get task result
   */
  getTask(taskId: string): AgentTask | undefined {
    return this.tasks.get(taskId)?.task
  }

  /**
   * Get all tasks for a session
   */
  getSessionTasks(sessionId: string): AgentTask[] {
    const results: AgentTask[] = []
    for (const entry of this.tasks.values()) {
      if (entry.task.sessionId === sessionId) {
        results.push(entry.task)
      }
    }
    return results
  }

  /**
   * Clean up completed tasks
   */
  cleanup(): void {
    for (const [taskId, entry] of this.tasks) {
      if (entry.task.result?.status === 'complete' || entry.task.result?.status === 'error') {
        this.tasks.delete(taskId)
      }
    }
  }

  /**
   * Build prompt for agent
   */
  private buildPrompt(type: ResearchAgentType, context: string, projectPath: string): string {
    const systemPrompt = AGENT_PROMPTS[type]

    switch (type) {
      case 'process':
        return `${systemPrompt}

User's description:
${context}

Analyze the above description and extract structured requirements.`

      case 'codebase':
        return `${systemPrompt}

Project path: ${projectPath}

Analyze the project structure and provide a structured summary of the codebase.`

      case 'spec-builder':
        return `${systemPrompt}

Context from conversation and analysis:
${context}

Build a comprehensive technical specification for the requested feature.`

      default:
        return `${systemPrompt}\n\n${context}`
    }
  }

  /**
   * Generate unique task ID
   */
  private generateId(): string {
    return `agent-${Date.now()}-${randomBytes(4).toString('hex')}`
  }
}

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

// Heavy Spec Architecture Prompts
// Philosophy: ALL intelligence in planning phase. Execution agents just follow the spec.
// The spec must be so detailed that no decision-making is required during implementation.
const AGENT_PROMPTS: Record<ResearchAgentType, string> = {
  process: `You are a HEAVY SPEC requirements analyst. Your job is to extract EXHAUSTIVE requirements.

IMPORTANT: The execution phase will use "dumb worker" agents that cannot make decisions.
Every requirement, constraint, and edge case MUST be captured NOW.

Extract and structure:
1. CORE FEATURES - Break each feature into atomic, testable units
2. TECHNICAL CONSTRAINTS - Language, framework, version requirements
3. INTEGRATION POINTS - Every external system, API, service
4. UX REQUIREMENTS - Every user interaction, error message, state
5. EDGE CASES - What happens when things go wrong?
6. NON-FUNCTIONAL - Performance targets, security requirements, scalability
7. ACCEPTANCE CRITERIA - How do we know each feature is complete?

Output a structured summary in JSON format:
{
  "features": [
    {
      "name": "feature name",
      "description": "detailed description",
      "acceptance_criteria": ["list of criteria"],
      "edge_cases": ["what can go wrong"]
    }
  ],
  "constraints": ["technical constraints with specific versions"],
  "integrations": ["detailed integration requirements"],
  "ux_requirements": ["every user-facing behavior"],
  "non_functional": ["specific, measurable requirements"],
  "dependencies": ["what must exist before implementation"]
}`,

  codebase: `You are a HEAVY SPEC codebase analyst. Your job is to capture EVERYTHING about the existing codebase.

IMPORTANT: The implementation agents are "dumb workers" that MUST match existing patterns exactly.
Every convention, pattern, and style choice MUST be documented NOW.

Analyze and document:
1. PROJECT STRUCTURE - Exact directory layout, file naming conventions
2. TECH STACK - Every framework, library, and tool with versions
3. CODE PATTERNS - How similar features are implemented
4. NAMING CONVENTIONS - Variables, functions, classes, files
5. ERROR HANDLING - How errors are caught, logged, displayed
6. TESTING PATTERNS - How tests are structured, named, organized
7. BUILD/DEPLOY - Build commands, environment variables, configs
8. SIMILAR FEATURES - Find 2-3 existing features most like the new one

Output a structured analysis in JSON format:
{
  "tech_stack": {
    "frontend": ["framework@version", ...],
    "backend": ["framework@version", ...],
    "database": ["type", "orm/driver"],
    "tools": ["build tools", "test runners", "linters"]
  },
  "patterns": {
    "component_structure": "how components are organized",
    "state_management": "how state is handled",
    "api_pattern": "how APIs are structured",
    "error_handling": "how errors are managed"
  },
  "conventions": {
    "naming": {"files": "", "functions": "", "classes": "", "variables": ""},
    "structure": "directory organization rules",
    "imports": "how imports are organized"
  },
  "similar_features": [
    {
      "name": "feature name",
      "files": ["list of relevant files"],
      "why_similar": "explanation"
    }
  ],
  "reference_implementations": ["paths to files that should be used as templates"]
}`,

  'spec-builder': `You are a HEAVY SPEC specification builder. Create an EXHAUSTIVELY DETAILED specification.

CRITICAL: The execution agents are "dumb workers" with NO decision-making ability.
Your spec must answer EVERY question they might have. If it's not in the spec, it won't happen.

The specification MUST include:

## 1. OVERVIEW
- Feature name and purpose
- User story format: "As a [user], I want [action], so that [benefit]"
- Success metrics

## 2. TECHNICAL APPROACH
- Architecture decisions and WHY
- Technology choices with justification
- File structure (exact paths and names)

## 3. IMPLEMENTATION DETAILS
For EACH component/file:
- Exact file path
- Purpose and responsibility
- Dependencies and imports
- Public interface (functions, props, methods)
- Internal implementation notes
- Error handling approach

## 4. DATA MODELS
- Database schema changes (exact SQL/migration)
- TypeScript types (complete definitions)
- API request/response shapes

## 5. API DESIGN
- Endpoints (method, path, params, body, response)
- Authentication/authorization requirements
- Error response format

## 6. USER INTERFACE
- Component hierarchy
- State management approach
- User interactions and feedback
- Loading/error/empty states

## 7. TEST CASES (MINIMUM 200)
List EVERY test case in format:
- TEST-001: [Category] Description of what to test
- Expected behavior
- Edge cases to cover

Categories: Unit, Integration, E2E, Error Handling, Edge Cases, Performance

## 8. IMPLEMENTATION ORDER
Numbered list of exact steps to implement, with dependencies between steps.

Output in markdown format. Be EXHAUSTIVE. Leave NOTHING to interpretation.`
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

/**
 * BVS Worker Agent Service
 *
 * Executes individual sections using Claude Agent SDK.
 * Features:
 * - Dynamic model selection (Haiku/Sonnet based on complexity)
 * - Configurable turn limits
 * - Incremental typecheck feedback after batch file changes
 * - Isolated execution in git worktrees
 */

import { EventEmitter } from 'events'
import * as path from 'path'
import * as fs from 'fs/promises'
import { execFile as execFileCb } from 'child_process'
import { promisify } from 'util'
import { glob } from 'glob'

import type { BvsSection, BvsSubtask } from '../../shared/bvs-types'
import type { ComplexityAnalysis, BvsModelId } from './bvs-complexity-analyzer-service'
import { BVS_MODELS } from './bvs-complexity-analyzer-service'

const execFile = promisify(execFileCb)

// ============================================================================
// Types
// ============================================================================

export interface WorkerConfig {
  workerId: string
  sectionId: string
  section: BvsSection
  worktreePath: string
  model: BvsModelId
  maxTurns: number
  projectContext: ProjectContext
  complexity: ComplexityAnalysis
}

export interface ProjectContext {
  projectPath: string
  projectName: string
  framework: string                    // e.g., "Next.js 14 App Router"
  database: string                     // e.g., "Supabase"
  patterns: string[]                   // e.g., ["Server components", "Zustand for state"]
  existingFiles: string[]              // Key files for reference
  completedSections: CompletedSection[]
}

export interface CompletedSection {
  id: string
  name: string
  files: string[]
  summary: string
}

export interface WorkerResult {
  workerId: string
  sectionId: string
  status: 'completed' | 'failed' | 'timeout'
  turnsUsed: number
  filesChanged: string[]
  qualityGatesPassed: boolean
  errors: string[]
  retryCount: number
  startedAt: number
  completedAt: number
  commits: string[]
}

export interface WorkerProgress {
  workerId: string
  sectionId: string
  currentTurn: number
  maxTurns: number
  currentStep: string
  currentFile?: string
  progress: number
}

// IPC channels for worker events
export const BVS_WORKER_CHANNELS = {
  WORKER_STARTED: 'bvs-worker:started',
  WORKER_PROGRESS: 'bvs-worker:progress',
  WORKER_TOOL_CALL: 'bvs-worker:tool-call',
  WORKER_TYPECHECK: 'bvs-worker:typecheck',
  WORKER_COMPLETED: 'bvs-worker:completed',
  WORKER_FAILED: 'bvs-worker:failed',
  WORKER_RETRY: 'bvs-worker:retry',
} as const

// Typecheck interval - run after every N file changes
const TYPECHECK_BATCH_SIZE = 3

// ============================================================================
// Safe Command Execution
// ============================================================================

interface ExecResult {
  stdout: string
  stderr: string
  exitCode: number
}

/**
 * Safely execute a command using execFile (no shell injection)
 */
async function safeExec(
  command: string,
  args: string[],
  options: { cwd?: string; timeout?: number } = {}
): Promise<ExecResult> {
  try {
    const { stdout, stderr } = await execFile(command, args, {
      cwd: options.cwd,
      timeout: options.timeout || 60000,
      maxBuffer: 10 * 1024 * 1024, // 10MB
    })
    return { stdout: stdout || '', stderr: stderr || '', exitCode: 0 }
  } catch (error) {
    if (error && typeof error === 'object') {
      const execError = error as { stdout?: string; stderr?: string; code?: number }
      return {
        stdout: execError.stdout || '',
        stderr: execError.stderr || '',
        exitCode: execError.code || 1,
      }
    }
    return { stdout: '', stderr: String(error), exitCode: 1 }
  }
}

/**
 * Run npx command safely
 */
async function runNpx(
  packageCommand: string,
  args: string[],
  options: { cwd?: string; timeout?: number } = {}
): Promise<ExecResult> {
  const isWindows = process.platform === 'win32'
  const npxCmd = isWindows ? 'npx.cmd' : 'npx'
  return safeExec(npxCmd, [packageCommand, ...args], options)
}

/**
 * Run git command safely
 */
async function runGit(
  args: string[],
  options: { cwd?: string; timeout?: number } = {}
): Promise<ExecResult> {
  return safeExec('git', args, options)
}

// ============================================================================
// Agent SDK Dynamic Import
// ============================================================================

let sdkModule: typeof import('@anthropic-ai/claude-code') | null = null

async function getSDK(): Promise<typeof import('@anthropic-ai/claude-code')> {
  if (!sdkModule) {
    sdkModule = await import('@anthropic-ai/claude-code')
    console.log('[BvsWorkerAgent] Agent SDK loaded')
  }
  return sdkModule
}

// ============================================================================
// Tool Definitions for Worker Agent
// ============================================================================

const WORKER_TOOLS = [
  {
    name: 'read_file',
    description: 'Read the contents of a file. Use this to understand existing code before modifications.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'File path relative to worktree root' }
      },
      required: ['path']
    }
  },
  {
    name: 'write_file',
    description: 'Create a new file or completely replace existing file contents.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'File path relative to worktree root' },
        content: { type: 'string', description: 'Complete file content' }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'edit_file',
    description: 'Make targeted edits to an existing file. Provide the exact text to find and replace.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'File path relative to worktree root' },
        old_string: { type: 'string', description: 'Exact text to find (must be unique in file)' },
        new_string: { type: 'string', description: 'Text to replace with' }
      },
      required: ['path', 'old_string', 'new_string']
    }
  },
  {
    name: 'list_files',
    description: 'List files matching a glob pattern.',
    input_schema: {
      type: 'object' as const,
      properties: {
        pattern: { type: 'string', description: 'Glob pattern (e.g., "src/**/*.ts")' }
      },
      required: ['pattern']
    }
  },
  {
    name: 'run_command',
    description: 'Run a shell command. Use sparingly - prefer direct file operations.',
    input_schema: {
      type: 'object' as const,
      properties: {
        command: { type: 'string', description: 'Command to run (will be split by spaces)' },
        timeout: { type: 'number', description: 'Timeout in ms (default: 30000)' }
      },
      required: ['command']
    }
  },
  {
    name: 'mark_complete',
    description: 'Mark the section as complete when all success criteria are met.',
    input_schema: {
      type: 'object' as const,
      properties: {
        summary: { type: 'string', description: 'Brief summary of what was implemented' },
        files_changed: { type: 'array', items: { type: 'string' }, description: 'List of files modified' }
      },
      required: ['summary', 'files_changed']
    }
  }
]

// ============================================================================
// Tool Execution
// ============================================================================

interface ToolResult {
  content: string
  isError?: boolean
}

async function executeTool(
  toolName: string,
  input: Record<string, unknown>,
  worktreePath: string
): Promise<ToolResult> {
  try {
    switch (toolName) {
      case 'read_file': {
        const relativePath = input.path as string
        if (!relativePath || typeof relativePath !== 'string') {
          return { content: 'Error: path is required', isError: true }
        }
        const filePath = path.join(worktreePath, relativePath)

        // Security: prevent path traversal
        const resolvedPath = path.resolve(filePath)
        if (!resolvedPath.startsWith(path.resolve(worktreePath))) {
          return { content: 'Error: path traversal not allowed', isError: true }
        }

        const content = await fs.readFile(filePath, 'utf-8')
        // Truncate very large files
        if (content.length > 50000) {
          return { content: content.substring(0, 50000) + '\n\n[... truncated, showing first 50k chars ...]' }
        }
        return { content }
      }

      case 'write_file': {
        const relativePath = input.path as string
        const content = input.content as string
        if (!relativePath || typeof relativePath !== 'string') {
          return { content: 'Error: path is required', isError: true }
        }
        if (typeof content !== 'string') {
          return { content: 'Error: content is required', isError: true }
        }

        const filePath = path.join(worktreePath, relativePath)

        // Security: prevent path traversal
        const resolvedPath = path.resolve(filePath)
        if (!resolvedPath.startsWith(path.resolve(worktreePath))) {
          return { content: 'Error: path traversal not allowed', isError: true }
        }

        // Ensure directory exists
        await fs.mkdir(path.dirname(filePath), { recursive: true })
        await fs.writeFile(filePath, content, 'utf-8')
        return { content: `File written successfully: ${relativePath}` }
      }

      case 'edit_file': {
        const relativePath = input.path as string
        const oldString = input.old_string as string
        const newString = input.new_string as string

        if (!relativePath || typeof relativePath !== 'string') {
          return { content: 'Error: path is required', isError: true }
        }
        if (typeof oldString !== 'string' || typeof newString !== 'string') {
          return { content: 'Error: old_string and new_string are required', isError: true }
        }

        const filePath = path.join(worktreePath, relativePath)

        // Security: prevent path traversal
        const resolvedPath = path.resolve(filePath)
        if (!resolvedPath.startsWith(path.resolve(worktreePath))) {
          return { content: 'Error: path traversal not allowed', isError: true }
        }

        let content = await fs.readFile(filePath, 'utf-8')

        if (!content.includes(oldString)) {
          return { content: 'Error: old_string not found in file. Make sure it is unique and exact.', isError: true }
        }

        // Check if old_string is unique
        const occurrences = content.split(oldString).length - 1
        if (occurrences > 1) {
          return { content: `Error: old_string appears ${occurrences} times in file. It must be unique.`, isError: true }
        }

        content = content.replace(oldString, newString)
        await fs.writeFile(filePath, content, 'utf-8')
        return { content: `File edited successfully: ${relativePath}` }
      }

      case 'list_files': {
        const pattern = input.pattern as string
        if (!pattern || typeof pattern !== 'string') {
          return { content: 'Error: pattern is required', isError: true }
        }

        const files = await glob(pattern, {
          cwd: worktreePath,
          nodir: true,
          ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**']
        })

        if (files.length === 0) {
          return { content: 'No files found matching pattern' }
        }
        if (files.length > 100) {
          return { content: files.slice(0, 100).join('\n') + `\n\n[... and ${files.length - 100} more files]` }
        }
        return { content: files.join('\n') }
      }

      case 'run_command': {
        const command = input.command as string
        const timeout = (input.timeout as number) || 30000

        if (!command || typeof command !== 'string') {
          return { content: 'Error: command is required', isError: true }
        }

        // Parse command safely - split by spaces but respect quotes
        const parts = command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || []
        if (parts.length === 0) {
          return { content: 'Error: empty command', isError: true }
        }

        const cmd = parts[0]!.replace(/^["']|["']$/g, '')
        const args = parts.slice(1).map(a => a.replace(/^["']|["']$/g, ''))

        // Disallow dangerous commands
        const dangerousCommands = ['rm', 'del', 'rmdir', 'format', 'dd', 'mkfs']
        if (dangerousCommands.includes(cmd.toLowerCase())) {
          return { content: `Error: command '${cmd}' is not allowed for safety`, isError: true }
        }

        const result = await safeExec(cmd, args, { cwd: worktreePath, timeout })
        const output = (result.stdout + result.stderr).trim()

        if (result.exitCode !== 0) {
          return { content: `Command exited with code ${result.exitCode}:\n${output}`, isError: true }
        }
        return { content: output || '(no output)' }
      }

      case 'mark_complete': {
        const summary = input.summary as string
        const filesChanged = input.files_changed as string[]

        if (!summary || typeof summary !== 'string') {
          return { content: 'Error: summary is required', isError: true }
        }

        return {
          content: `Section marked complete.\nSummary: ${summary}\nFiles: ${(filesChanged || []).join(', ')}`
        }
      }

      default:
        return { content: `Unknown tool: ${toolName}`, isError: true }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[BvsWorkerAgent] Tool error (${toolName}):`, error)
    return { content: `Tool error: ${message}`, isError: true }
  }
}

// ============================================================================
// Service
// ============================================================================

export class BvsWorkerAgentService extends EventEmitter {
  private activeWorkers: Map<string, AbortController> = new Map()

  constructor() {
    super()
  }

  /**
   * RALPH-002: Identify Subtasks
   *
   * Splits a section into atomic subtasks based on file purpose.
   * Ralph Loop principle: Fresh context per atomic unit.
   *
   * Grouping strategy:
   * 1. Schema files (database/types.ts, prisma.schema, etc.)
   * 2. Type definitions (*.types.ts, interfaces.ts)
   * 3. Implementation files (service.ts, utils.ts, components)
   * 4. Test files (*.test.ts, *.spec.ts)
   *
   * Each subtask gets max 5 turns instead of entire section getting 15.
   */
  identifySubtasks(section: BvsSection): BvsSubtask[] {
    const subtasks: BvsSubtask[] = []

    // Group files by purpose
    const schemaFiles: string[] = []
    const typeFiles: string[] = []
    const implFiles: string[] = []
    const testFiles: string[] = []

    for (const file of section.files) {
      const filePath = file.path.toLowerCase()

      // Schema files (database, migrations, schema definitions)
      if (
        filePath.includes('/schema') ||
        filePath.includes('prisma') ||
        filePath.includes('migration') ||
        filePath.includes('db.ts') ||
        filePath.includes('database.ts')
      ) {
        schemaFiles.push(file.path)
      }
      // Type files
      else if (
        filePath.endsWith('.types.ts') ||
        filePath.endsWith('-types.ts') ||
        filePath.includes('/types/') ||
        filePath.includes('interface')
      ) {
        typeFiles.push(file.path)
      }
      // Test files
      else if (
        filePath.includes('.test.') ||
        filePath.includes('.spec.') ||
        filePath.includes('__tests__')
      ) {
        testFiles.push(file.path)
      }
      // Implementation files (everything else)
      else {
        implFiles.push(file.path)
      }
    }

    // Create subtasks (only for non-empty groups)
    let subtaskIndex = 1

    if (schemaFiles.length > 0) {
      subtasks.push({
        id: `${section.id}-subtask-${subtaskIndex++}`,
        sectionId: section.id,
        name: 'Update schema and database',
        description: `Schema changes: ${schemaFiles.join(', ')}`,
        files: schemaFiles,
        status: 'pending',
        turnsUsed: 0,
        maxTurns: 5,
        retryCount: 0,
      })
    }

    if (typeFiles.length > 0) {
      subtasks.push({
        id: `${section.id}-subtask-${subtaskIndex++}`,
        sectionId: section.id,
        name: 'Update type definitions',
        description: `Type changes: ${typeFiles.join(', ')}`,
        files: typeFiles,
        status: 'pending',
        turnsUsed: 0,
        maxTurns: 5,
        retryCount: 0,
      })
    }

    if (implFiles.length > 0) {
      // Split implementation into chunks if >5 files
      if (implFiles.length > 5) {
        const chunks = this.chunkFiles(implFiles, 5)
        for (let i = 0; i < chunks.length; i++) {
          subtasks.push({
            id: `${section.id}-subtask-${subtaskIndex++}`,
            sectionId: section.id,
            name: `Implement core logic (part ${i + 1}/${chunks.length})`,
            description: `Implementation: ${chunks[i].join(', ')}`,
            files: chunks[i],
            status: 'pending',
            turnsUsed: 0,
            maxTurns: 5,
            retryCount: 0,
          })
        }
      } else {
        subtasks.push({
          id: `${section.id}-subtask-${subtaskIndex++}`,
          sectionId: section.id,
          name: 'Implement core logic',
          description: `Implementation: ${implFiles.join(', ')}`,
          files: implFiles,
          status: 'pending',
          turnsUsed: 0,
          maxTurns: 5,
          retryCount: 0,
        })
      }
    }

    if (testFiles.length > 0) {
      subtasks.push({
        id: `${section.id}-subtask-${subtaskIndex++}`,
        sectionId: section.id,
        name: 'Add tests',
        description: `Tests: ${testFiles.join(', ')}`,
        files: testFiles,
        status: 'pending',
        turnsUsed: 0,
        maxTurns: 5,
        retryCount: 0,
      })
    }

    // Fallback: If no files were categorized, create single subtask
    if (subtasks.length === 0 && section.files.length > 0) {
      subtasks.push({
        id: `${section.id}-subtask-1`,
        sectionId: section.id,
        name: section.name,
        description: `All files: ${section.files.map(f => f.path).join(', ')}`,
        files: section.files.map(f => f.path),
        status: 'pending',
        turnsUsed: 0,
        maxTurns: 5,
        retryCount: 0,
      })
    }

    return subtasks
  }

  /**
   * Split array into chunks of specified size
   */
  private chunkFiles(files: string[], chunkSize: number): string[][] {
    const chunks: string[][] = []
    for (let i = 0; i < files.length; i += chunkSize) {
      chunks.push(files.slice(i, i + chunkSize))
    }
    return chunks
  }

  /**
   * RALPH-008: Calculate Subtask Cost
   *
   * Estimates token usage and USD cost based on:
   * - Model (Haiku vs Sonnet pricing)
   * - Turns used
   * - Files changed
   *
   * Pricing (as of 2024):
   * - Haiku: $0.25/1M input, $1.25/1M output
   * - Sonnet: $3/1M input, $15/1M output
   */
  private calculateSubtaskCost(
    model: BvsModelId,
    turnsUsed: number,
    filesChanged: number
  ): {
    tokensInput: number
    tokensOutput: number
    costUsd: number
  } {
    // Rough estimates based on typical subtask patterns
    // Input: System prompt + context + file contents
    const inputTokensPerTurn = 2000 + (filesChanged * 500) // System + files
    const outputTokensPerTurn = 1000 // Code generation

    const tokensInput = inputTokensPerTurn * turnsUsed
    const tokensOutput = outputTokensPerTurn * turnsUsed

    // Pricing per 1M tokens
    const pricing = {
      haiku: { input: 0.25, output: 1.25 },
      sonnet: { input: 3.0, output: 15.0 },
    }

    const isHaiku = model === BVS_MODELS.HAIKU || model.includes('haiku')
    const modelPricing = pricing[isHaiku ? 'haiku' : 'sonnet']

    const costInput = (tokensInput / 1_000_000) * modelPricing.input
    const costOutput = (tokensOutput / 1_000_000) * modelPricing.output
    const costUsd = costInput + costOutput

    return {
      tokensInput,
      tokensOutput,
      costUsd,
    }
  }

  /**
   * RALPH-005: Model Selection Logic
   *
   * Selects appropriate model based on complexity:
   * - Haiku: Simple subtasks (≤4 files, straightforward changes)
   * - Sonnet: Complex subtasks (>4 files, or complex logic)
   *
   * Cost optimization while maintaining quality.
   */
  private selectModelForSubtask(subtask: BvsSubtask, baseComplexity: number): BvsModelId {
    // Simple heuristic: file count + base complexity
    const fileCount = subtask.files.length
    const subtaskComplexity = baseComplexity + fileCount

    // Haiku for simple subtasks (fast, cheap)
    if (subtaskComplexity <= 4) {
      return BVS_MODELS.HAIKU
    }

    // Sonnet for complex subtasks (slower, more capable)
    return BVS_MODELS.SONNET
  }

  /**
   * RALPH-003: Execute Section with Subtask Loop
   *
   * NEW execution flow: Fresh context per subtask instead of single 15-turn session.
   * Each subtask gets its own Agent SDK instance with 5 turns max.
   *
   * Benefits:
   * - Prevents context rot (AI degradation in long sessions)
   * - Better cost tracking per atomic unit
   * - Easier to retry individual subtasks
   * - Cleaner git history (commit per subtask)
   */
  async executeSectionWithSubtasks(config: WorkerConfig): Promise<WorkerResult> {
    const startedAt = Date.now()
    const { workerId, sectionId, section, worktreePath, projectContext } = config

    console.log(`[BvsWorker:${workerId}] Starting section with subtasks: ${section.name}`)

    const result: WorkerResult = {
      workerId,
      sectionId,
      status: 'failed',
      turnsUsed: 0,
      filesChanged: [],
      qualityGatesPassed: false,
      errors: [],
      retryCount: 0,
      startedAt,
      completedAt: 0,
      commits: [],
    }

    // RALPH-008: Track aggregated metrics
    const aggregatedMetrics = {
      totalCostUsd: 0,
      totalTokensInput: 0,
      totalTokensOutput: 0,
      subtaskMetrics: [] as any[],
    }

    try {
      // Step 1: Identify subtasks
      const subtasks = this.identifySubtasks(section)
      console.log(`[BvsWorker:${workerId}] Identified ${subtasks.length} subtasks`)

      // Update section with subtasks
      section.subtasks = subtasks

      // Step 2: Execute each subtask with fresh context
      for (let i = 0; i < subtasks.length; i++) {
        const subtask = subtasks[i]
        console.log(`[BvsWorker:${workerId}] Executing subtask ${i + 1}/${subtasks.length}: ${subtask.name}`)

        // RALPH-005: Select model based on subtask complexity
        const subtaskModel = this.selectModelForSubtask(subtask, config.complexity.score)
        console.log(`[BvsWorker:${workerId}] Selected model: ${subtaskModel} (base complexity: ${config.complexity.score}, files: ${subtask.files.length})`)

        // Mark subtask as in progress
        subtask.status = 'in_progress'
        subtask.startedAt = Date.now()

        try {
          // Execute subtask (fresh Agent SDK session, 5 turns max)
          const subtaskResult = await this.executeSubtask(
            workerId,
            sectionId,
            subtask,
            worktreePath,
            subtaskModel, // Use selected model, not base config model
            projectContext
          )

          // Update subtask with result
          subtask.status = subtaskResult.success ? 'done' : 'failed'
          subtask.turnsUsed = subtaskResult.turnsUsed
          subtask.completedAt = Date.now()
          subtask.duration = subtask.completedAt - subtask.startedAt
          subtask.metrics = {
            ...subtaskResult.metrics,
            model: subtaskModel, // Track actual model used
          }

          // Aggregate results
          result.turnsUsed += subtaskResult.turnsUsed
          result.filesChanged.push(...subtaskResult.filesChanged)

          // RALPH-008: Aggregate costs
          if (subtaskResult.metrics) {
            aggregatedMetrics.totalCostUsd += subtaskResult.metrics.costUsd
            aggregatedMetrics.totalTokensInput += subtaskResult.metrics.tokensInput
            aggregatedMetrics.totalTokensOutput += subtaskResult.metrics.tokensOutput
            aggregatedMetrics.subtaskMetrics.push(subtaskResult.metrics)
          }

          if (subtaskResult.commitHash) {
            result.commits.push(subtaskResult.commitHash)
            subtask.commitSha = subtaskResult.commitHash
          }

          if (!subtaskResult.success) {
            result.errors.push(...subtaskResult.errors)
            // Continue with other subtasks even if one fails
          }

        } catch (error) {
          subtask.status = 'failed'
          subtask.error = error instanceof Error ? error.message : String(error)
          result.errors.push(`Subtask ${subtask.name} failed: ${subtask.error}`)
        }
      }

      // Step 3: Determine overall status
      const allCompleted = subtasks.every(st => st.status === 'done')
      const anyFailed = subtasks.some(st => st.status === 'failed')

      if (allCompleted) {
        result.status = 'completed'
        result.qualityGatesPassed = true
      } else if (anyFailed) {
        result.status = 'failed'
      }

      // RALPH-008: Log cost summary
      console.log(`[BvsWorker:${workerId}] Section complete:`)
      console.log(`  - Subtasks: ${subtasks.length}`)
      console.log(`  - Total turns: ${result.turnsUsed}`)
      console.log(`  - Total cost: $${aggregatedMetrics.totalCostUsd.toFixed(4)}`)
      console.log(`  - Tokens in: ${aggregatedMetrics.totalTokensInput.toLocaleString()}`)
      console.log(`  - Tokens out: ${aggregatedMetrics.totalTokensOutput.toLocaleString()}`)

    } catch (error) {
      console.error(`[BvsWorker:${workerId}] Section execution error:`, error)
      result.status = 'failed'
      result.errors.push(error instanceof Error ? error.message : String(error))
    } finally {
      result.completedAt = Date.now()
      this.activeWorkers.delete(workerId)
    }

    return result
  }

  /**
   * RALPH-003: Execute Single Subtask
   *
   * Runs ONE subtask with fresh Agent SDK context.
   * Max 5 turns instead of 15 for entire section.
   */
  private async executeSubtask(
    workerId: string,
    sectionId: string,
    subtask: BvsSubtask,
    worktreePath: string,
    model: BvsModelId,
    projectContext: ProjectContext
  ): Promise<{
    success: boolean
    turnsUsed: number
    filesChanged: string[]
    commitHash?: string
    errors: string[]
    metrics?: any
  }> {
    const sdk = await getSDK()
    const filesChanged: string[] = []
    const errors: string[] = []
    let turnsUsed = 0

    // Build subtask-specific prompt
    const taskPrompt = this.buildSubtaskPrompt(subtask, projectContext)

    const options = {
      maxTurns: subtask.maxTurns,
      cwd: worktreePath,
      permissionMode: 'default' as const,
      tools: WORKER_TOOLS,
    }

    // Create message generator
    async function* generateMessages() {
      yield {
        type: 'user' as const,
        message: {
          role: 'user' as const,
          content: taskPrompt
        },
        parent_tool_use_id: null,
        session_id: `${workerId}-${subtask.id}`
      }
    }

    // Execute query
    const queryResult = sdk.query({
      prompt: generateMessages(),
      options,
    })

    // Process streaming response
    let isComplete = false
    for await (const message of queryResult) {
      if (message.type === 'tool_use') {
        turnsUsed++
        const toolName = (message as Record<string, unknown>).name as string || 'unknown'
        const toolInput = (message as Record<string, unknown>).input as Record<string, unknown> || {}

        // Track file changes
        if ((toolName === 'write_file' || toolName === 'edit_file')) {
          const filePath = toolInput.path as string
          if (filePath && !filesChanged.includes(filePath)) {
            filesChanged.push(filePath)
          }
        }

        // Check for completion
        if (toolName === 'mark_complete') {
          isComplete = true
        }
      }
    }

    // RALPH-007: Commit subtask changes
    let commitHash: string | undefined
    if (filesChanged.length > 0) {
      commitHash = await this.commitSubtask(worktreePath, subtask, workerId)
    }

    // RALPH-008: Calculate cost based on model and usage
    const cost = this.calculateSubtaskCost(model, turnsUsed, filesChanged.length)

    return {
      success: isComplete && errors.length === 0,
      turnsUsed,
      filesChanged,
      commitHash,
      errors,
      metrics: {
        turnsUsed,
        tokensInput: cost.tokensInput,
        tokensOutput: cost.tokensOutput,
        costUsd: cost.costUsd,
        model,
        filesChanged: filesChanged.length,
        linesAdded: 0, // Approximate - would need git diff
        linesRemoved: 0, // Approximate - would need git diff
      }
    }
  }

  /**
   * Build subtask-specific prompt
   */
  private buildSubtaskPrompt(subtask: BvsSubtask, projectContext: ProjectContext): string {
    return `
You are implementing a subtask as part of a larger feature.

SUBTASK: ${subtask.name}
DESCRIPTION: ${subtask.description}

FILES TO MODIFY:
${subtask.files.map(f => `- ${f}`).join('\n')}

PROJECT CONTEXT:
- Framework: ${projectContext.framework}
- Database: ${projectContext.database}
- Patterns: ${projectContext.patterns.join(', ')}

IMPORTANT:
- You have ${subtask.maxTurns} turns to complete this subtask
- Focus ONLY on the files listed above
- When done, call mark_complete()
- Previous subtasks in this section have already been completed
- Keep the implementation focused and atomic

Start implementing now.
`.trim()
  }

  /**
   * RALPH-007: Commit Subtask Changes
   */
  private async commitSubtask(
    worktreePath: string,
    subtask: BvsSubtask,
    workerId: string
  ): Promise<string | undefined> {
    try {
      const commitMessage = `feat(${subtask.sectionId}): ${subtask.name}

${subtask.description}

Files changed:
${subtask.files.map(f => `- ${f}`).join('\n')}

Subtask: ${subtask.id}
Worker: ${workerId}

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>`

      const { stdout } = await execFile('git', ['rev-parse', '--short', 'HEAD'], {
        cwd: worktreePath
      })

      await execFile('git', ['add', '.'], { cwd: worktreePath })
      await execFile('git', ['commit', '-m', commitMessage], { cwd: worktreePath })

      const { stdout: newHash } = await execFile('git', ['rev-parse', '--short', 'HEAD'], {
        cwd: worktreePath
      })

      return newHash.trim()
    } catch (error) {
      console.error(`[BvsWorker:${workerId}] Failed to commit subtask:`, error)
      return undefined
    }
  }

  /**
   * Execute a section with the configured model and turn limit
   * (Legacy method - use executeSectionWithSubtasks for Ralph Loop)
   */
  async executeSection(config: WorkerConfig): Promise<WorkerResult> {
    const startedAt = Date.now()
    const { workerId, sectionId, section, worktreePath, model, maxTurns, projectContext } = config

    console.log(`[BvsWorker:${workerId}] Starting section: ${section.name}`)
    console.log(`[BvsWorker:${workerId}] Model: ${model}, Max turns: ${maxTurns}`)

    // Create abort controller for this worker
    const abortController = new AbortController()
    this.activeWorkers.set(workerId, abortController)

    // Emit started event
    this.emit(BVS_WORKER_CHANNELS.WORKER_STARTED, {
      workerId,
      sectionId,
      model,
      maxTurns,
    })

    const result: WorkerResult = {
      workerId,
      sectionId,
      status: 'failed',
      turnsUsed: 0,
      filesChanged: [],
      qualityGatesPassed: false,
      errors: [],
      retryCount: 0,
      startedAt,
      completedAt: 0,
      commits: [],
    }

    try {
      const sdk = await getSDK()

      // Build prompts
      const systemPrompt = this.buildSystemPrompt(config)
      const taskPrompt = this.buildTaskPrompt(section, projectContext)

      let turnsUsed = 0
      let isComplete = false
      let fileChangesSinceLastCheck = 0
      const filesChanged = new Set<string>()

      // SDK options
      const options = {
        maxTurns,
        cwd: worktreePath,
        permissionMode: 'default' as const,
        tools: WORKER_TOOLS,
      }

      // Create message generator
      async function* generateMessages() {
        yield {
          type: 'user' as const,
          message: {
            role: 'user' as const,
            content: taskPrompt
          },
          parent_tool_use_id: null,
          session_id: workerId
        }
      }

      // Execute query
      const queryResult = sdk.query({
        prompt: generateMessages(),
        options,
        abortSignal: abortController.signal,
      })

      // Process streaming response
      for await (const message of queryResult) {
        // Check abort
        if (abortController.signal.aborted) {
          throw new Error('AbortError')
        }

        // Handle tool calls
        if (message.type === 'tool_use') {
          turnsUsed++
          const toolName = (message as Record<string, unknown>).name as string || 'unknown'
          const toolInput = (message as Record<string, unknown>).input as Record<string, unknown> || {}

          // Emit progress
          this.emit(BVS_WORKER_CHANNELS.WORKER_PROGRESS, {
            workerId,
            sectionId,
            currentTurn: turnsUsed,
            maxTurns,
            currentStep: this.extractCurrentStep(toolName, toolInput),
            progress: Math.min((turnsUsed / maxTurns) * 100, 95),
          } as WorkerProgress)

          // Emit tool call
          this.emit(BVS_WORKER_CHANNELS.WORKER_TOOL_CALL, {
            workerId,
            sectionId,
            tool: toolName,
            input: toolInput,
          })

          // Execute tool
          const toolResult = await executeTool(toolName, toolInput, worktreePath)

          // Track file changes
          if ((toolName === 'write_file' || toolName === 'edit_file') && !toolResult.isError) {
            const filePath = toolInput.path as string
            if (filePath) {
              filesChanged.add(filePath)
              fileChangesSinceLastCheck++

              // Run typecheck after batch of file changes
              if (fileChangesSinceLastCheck >= TYPECHECK_BATCH_SIZE) {
                const typecheckResult = await this.runIncrementalTypecheck(worktreePath)
                fileChangesSinceLastCheck = 0

                this.emit(BVS_WORKER_CHANNELS.WORKER_TYPECHECK, {
                  workerId,
                  sectionId,
                  passed: typecheckResult.passed,
                  errors: typecheckResult.errors,
                })

                // If typecheck fails, the errors will be in the next response context
                if (!typecheckResult.passed) {
                  console.log(`[BvsWorker:${workerId}] Typecheck failed: ${typecheckResult.errors.length} errors`)
                }
              }
            }
          }

          // Handle completion marker
          if (toolName === 'mark_complete' && !toolResult.isError) {
            isComplete = true
          }
        }
      }

      // Final typecheck if there were pending file changes
      if (fileChangesSinceLastCheck > 0) {
        const typecheckResult = await this.runIncrementalTypecheck(worktreePath)
        this.emit(BVS_WORKER_CHANNELS.WORKER_TYPECHECK, {
          workerId,
          sectionId,
          passed: typecheckResult.passed,
          errors: typecheckResult.errors,
        })

        if (!typecheckResult.passed) {
          result.errors = typecheckResult.errors
        }
      }

      // Update result
      result.turnsUsed = turnsUsed
      result.filesChanged = Array.from(filesChanged)

      if (isComplete && result.errors.length === 0) {
        result.status = 'completed'
        result.qualityGatesPassed = true
      } else if (turnsUsed >= maxTurns) {
        result.status = 'timeout'
        result.errors.push(`Reached maximum turns (${maxTurns}) without completing`)
      } else {
        result.status = 'failed'
      }

      // Commit changes if any files were modified
      if (filesChanged.size > 0) {
        const commitHash = await this.commitChanges(worktreePath, section.name, workerId)
        if (commitHash) {
          result.commits.push(commitHash)
        }
      }

    } catch (error) {
      console.error(`[BvsWorker:${workerId}] Execution error:`, error)

      if (error instanceof Error) {
        if (error.message === 'AbortError' || error.name === 'AbortError') {
          result.status = 'failed'
          result.errors.push('Worker was aborted')
        } else {
          result.status = 'failed'
          result.errors.push(error.message)
        }
      } else {
        result.status = 'failed'
        result.errors.push(`Unknown error: ${String(error)}`)
      }
    } finally {
      result.completedAt = Date.now()
      this.activeWorkers.delete(workerId)

      // Emit completion event
      this.emit(
        result.status === 'completed'
          ? BVS_WORKER_CHANNELS.WORKER_COMPLETED
          : BVS_WORKER_CHANNELS.WORKER_FAILED,
        result
      )
    }

    return result
  }

  /**
   * Abort a running worker
   */
  abortWorker(workerId: string): boolean {
    const controller = this.activeWorkers.get(workerId)
    if (controller) {
      controller.abort()
      return true
    }
    return false
  }

  /**
   * Abort all running workers
   */
  abortAll(): void {
    for (const [workerId, controller] of this.activeWorkers) {
      console.log(`[BvsWorkerAgent] Aborting worker: ${workerId}`)
      controller.abort()
    }
    this.activeWorkers.clear()
  }

  /**
   * Get count of active workers
   */
  getActiveWorkerCount(): number {
    return this.activeWorkers.size
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private buildSystemPrompt(config: WorkerConfig): string {
    const { section, worktreePath, projectContext, complexity } = config

    return `You are a BVS (Bounded Verified Sections) Worker Agent implementing a specific section of code.

## Your Task
Implement section: "${section.name}"
${section.description || ''}

## Working Directory
You are working in an isolated git worktree: ${worktreePath}
All file paths should be relative to this directory.

## Project Context
- **Project:** ${projectContext.projectName}
- **Framework:** ${projectContext.framework}
- **Database:** ${projectContext.database}
- **Patterns:** ${projectContext.patterns.join(', ')}

## Files to Create/Modify
${section.files.map(f => `- ${f.action.toUpperCase()}: ${f.path}`).join('\n')}

## Success Criteria
${section.successCriteria.map((c, i) => `${i + 1}. ${c.description}`).join('\n')}

## Dependencies Already Completed
${projectContext.completedSections.length > 0
  ? projectContext.completedSections.map(s => `- ${s.name}: ${s.summary}`).join('\n')
  : 'None - this section has no dependencies'}

## Complexity Assessment
- Score: ${complexity.score}/10
- Model: ${complexity.model === BVS_MODELS.HAIKU ? 'Haiku (simple task)' : 'Sonnet (complex task)'}
- Risk flags: ${complexity.riskFlags.length > 0 ? complexity.riskFlags.join('; ') : 'None'}

## CRITICAL RULES

1. **Stay In Scope**: Only modify files listed in "Files to Create/Modify"
2. **Read Before Edit**: Always read_file before attempting to edit_file
3. **Fix TypeScript Errors**: If you receive typecheck feedback, fix errors immediately
4. **Follow Patterns**: Match existing code patterns from the project
5. **Mark Complete**: When all success criteria are met, call mark_complete

## Tool Usage

- **read_file**: Read existing files to understand patterns
- **write_file**: Create new files or replace entire contents
- **edit_file**: Make targeted edits (old_string must be unique in file)
- **list_files**: Explore file structure
- **run_command**: Run commands (use sparingly)
- **mark_complete**: Signal completion with summary

Begin implementing the section now.`
  }

  private buildTaskPrompt(section: BvsSection, context: ProjectContext): string {
    const fileList = section.files.map(f => {
      const action = f.action === 'create' ? 'Create' : f.action === 'modify' ? 'Modify' : 'Delete'
      return `- ${action}: \`${f.path}\``
    }).join('\n')

    return `Implement section "${section.name}".

## Description
${section.description || 'No additional description provided.'}

## Files
${fileList}

## Success Criteria
${section.successCriteria.map((c, i) => `${i + 1}. ${c.description}`).join('\n')}

Start by reading any existing files you need to modify or reference, then implement the changes.
When all criteria are met, call mark_complete with a summary.`
  }

  private extractCurrentStep(toolName: string, input: Record<string, unknown>): string {
    const filePath = input?.path as string | undefined
    switch (toolName) {
      case 'read_file': return `Reading ${filePath || 'file'}`
      case 'write_file': return `Writing ${filePath || 'file'}`
      case 'edit_file': return `Editing ${filePath || 'file'}`
      case 'list_files': return `Listing files`
      case 'run_command': return `Running command`
      case 'mark_complete': return `Completing section`
      default: return 'Processing...'
    }
  }

  private async runIncrementalTypecheck(worktreePath: string): Promise<{ passed: boolean; errors: string[] }> {
    try {
      // Check if tsconfig exists
      const tsconfigPath = path.join(worktreePath, 'tsconfig.json')
      try {
        await fs.access(tsconfigPath)
      } catch {
        // No tsconfig, skip typecheck
        return { passed: true, errors: [] }
      }

      const result = await runNpx('tsc', ['--noEmit', '--incremental'], {
        cwd: worktreePath,
        timeout: 60000,
      })

      // If tsc failed to run at all (not found, etc)
      if (result.exitCode !== 0 && !result.stdout && !result.stderr) {
        return { passed: false, errors: ['TypeScript compiler failed to run'] }
      }

      const output = result.stdout + result.stderr
      const errors = this.parseTypescriptErrors(output)

      return {
        passed: result.exitCode === 0 && errors.length === 0,
        errors,
      }
    } catch (error) {
      console.error('[BvsWorkerAgent] Typecheck error:', error)
      return { passed: true, errors: [] } // Assume pass if we can't run tsc
    }
  }

  private parseTypescriptErrors(output: string): string[] {
    const errors: string[] = []
    // Use non-greedy quantifiers and limit iterations for safety
    const errorPattern = /^(.{1,500}?)\((\d+),(\d+)\): error (TS\d+): (.+?)$/gm

    let match
    let iterations = 0
    const maxIterations = 1000

    while ((match = errorPattern.exec(output)) !== null && iterations++ < maxIterations) {
      const [, file, line, col, code, message] = match
      errors.push(`${file}:${line}:${col} - ${code}: ${message}`)
    }

    return errors
  }

  private async commitChanges(worktreePath: string, sectionName: string, workerId: string): Promise<string | null> {
    try {
      // Stage all changes
      await runGit(['add', '-A'], { cwd: worktreePath })

      // Attempt commit - git will exit with code 1 if nothing to commit
      const commitMessage = `[BVS:${workerId}] ${sectionName}`
      const commitResult = await runGit(['commit', '-m', commitMessage], { cwd: worktreePath })

      if (commitResult.exitCode !== 0) {
        // Check if failure was due to nothing to commit
        const output = commitResult.stdout + commitResult.stderr
        if (output.includes('nothing to commit') || output.includes('no changes added')) {
          return null
        }
        console.error(`[BvsWorker:${workerId}] Commit failed:`, commitResult.stderr)
        return null
      }

      // Get commit hash
      const hashResult = await runGit(['rev-parse', 'HEAD'], { cwd: worktreePath })
      return hashResult.stdout.trim()
    } catch (error) {
      console.error(`[BvsWorker:${workerId}] Failed to commit:`, error)
      return null
    }
  }
}

// Singleton export
export const workerAgentService = new BvsWorkerAgentService()

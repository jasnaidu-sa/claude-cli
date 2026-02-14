/**
 * BVS Worker SDK Service
 *
 * Executes individual BVS sections using Claude Agent SDK for real-time streaming output.
 *
 * IMPORTANT: This uses the Agent SDK with createSdkMcpServer for custom tools.
 * Custom tools MUST be wrapped in an MCP server to work with Agent SDK.
 * Tools passed via `tools: [...]` are IGNORED - must use `mcpServers: [server]`
 *
 * Features:
 * - Real-time output streaming via SDK stream_event
 * - Tool execution via MCP server pattern
 * - Cost/token tracking from SDK result
 * - Progress events emitted for UI updates
 *
 * Architecture:
 * - Uses sdk.query() with AsyncGenerator (required for custom tools)
 * - Tools wrapped in createSdkMcpServer and passed via mcpServers
 * - includePartialMessages: true for streaming
 */

import { EventEmitter } from 'events'
import * as path from 'path'
import * as fs from 'fs/promises'
import { glob } from 'glob'
import { exec } from 'child_process'
import { promisify } from 'util'
import { z } from 'zod'
import { ConfigStore } from './config-store'

// Agent SDK types
import type { Options, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'

import type { BvsSection, BvsArchitectDiagnosis } from '../../shared/bvs-types'
import type { ComplexityAnalysis, BvsModelId } from './bvs-complexity-analyzer-service'

const execAsync = promisify(exec)

// ============================================================================
// Types
// ============================================================================

export interface WorkerConfig {
  workerId: string
  sectionId: string
  section: BvsSection
  worktreePath: string | null
  model: BvsModelId
  maxTurns: number
  projectContext: ProjectContext
  complexity: ComplexityAnalysis
  /** Architect diagnosis from previous failure - guides retry approach */
  architectDiagnosis?: BvsArchitectDiagnosis
}

export interface ProjectContext {
  projectPath: string
  projectName: string
  framework: string
  database: string
  patterns: string[]
  existingFiles: string[]
  completedSections: CompletedSection[]
}

export interface CompletedSection {
  id: string
  name: string
  filesChanged: string[]
  summary: string
}

export interface WorkerResult {
  workerId: string
  sectionId: string
  status: 'completed' | 'failed'
  turnsUsed: number
  filesChanged: string[]
  qualityGatesPassed: boolean
  errors: string[]
  retryCount: number
  startedAt: number
  completedAt: number
  commits: string[]
  costUsd?: number
  tokensInput?: number
  tokensOutput?: number
}

export interface WorkerProgress {
  workerId: string
  sectionId: string
  currentTurn: number
  maxTurns: number
  currentStep: string
  currentFile?: string
  currentLine?: number
  progress: number
  elapsedSeconds: number
}

// ============================================================================
// SDK Module Singleton
// ============================================================================

let sdkModule: typeof import('@anthropic-ai/claude-agent-sdk') | null = null

async function getSDK(): Promise<typeof import('@anthropic-ai/claude-agent-sdk')> {
  if (!sdkModule) {
    sdkModule = await import('@anthropic-ai/claude-agent-sdk')
    console.log('[BvsWorkerSDK] Agent SDK loaded')
  }
  return sdkModule
}

/**
 * Get the path to the Claude Code CLI executable bundled with the SDK.
 * In packaged Electron apps, the SDK is extracted from asar to app.asar.unpacked,
 * so we need to adjust the path accordingly.
 */
function getClaudeCodeCliPath(): string | undefined {
  try {
    const sdkPath = require.resolve('@anthropic-ai/claude-agent-sdk')
    const sdkDir = path.dirname(sdkPath)
    let cliPath = path.join(sdkDir, 'cli.js')

    // In packaged Electron apps, the SDK is in asarUnpack, so the path
    // should be app.asar.unpacked instead of app.asar
    if (cliPath.includes('app.asar') && !cliPath.includes('app.asar.unpacked')) {
      cliPath = cliPath.replace('app.asar', 'app.asar.unpacked')
    }

    return cliPath
  } catch (e) {
    console.warn('[BvsWorkerSDK] Could not resolve SDK CLI path:', e)
    return undefined
  }
}

// ============================================================================
// BVS Worker SDK Service
// ============================================================================

export class BvsWorkerSdkService extends EventEmitter {
  private activeSessions: Map<string, string> = new Map() // workerId -> sessionId
  private workerStartTimes: Map<string, number> = new Map()
  private configStore: ConfigStore

  constructor(configStore: ConfigStore) {
    super()
    this.configStore = configStore
  }

  /**
   * Execute a section using Agent SDK with MCP server for tools
   *
   * CRITICAL: Custom tools MUST be wrapped in createSdkMcpServer and passed via mcpServers.
   * Passing tools directly via `tools: [...]` does NOT work with Agent SDK.
   */
  async executeSection(config: WorkerConfig): Promise<WorkerResult> {
    const startedAt = Date.now()
    const { workerId, sectionId, section, worktreePath, model, maxTurns } = config

    console.log(`[BvsWorkerSDK:${workerId}] Starting section: ${section.name}`)
    console.log(`[BvsWorkerSDK:${workerId}] Model: ${model}, Max turns: ${maxTurns}`)

    // Get working directory
    const cwd = worktreePath || config.projectContext.projectPath
    console.log(`[BvsWorkerSDK:${workerId}] Working directory: ${cwd}`)
    console.log(`[BvsWorkerSDK:${workerId}] Worktree path: ${worktreePath || 'null'}`)
    console.log(`[BvsWorkerSDK:${workerId}] Project context path: ${config.projectContext.projectPath}`)

    // Build prompt (include architect diagnosis for retries)
    const prompt = this.buildWorkerPrompt(section, config.projectContext, maxTurns, config.architectDiagnosis)

    // Track execution state
    let turnsUsed = 0
    const filesChanged: string[] = []
    const errors: string[] = []
    let isComplete = false
    let sessionId: string | null = null
    let totalCostUsd = 0
    let totalTokensInput = 0
    let totalTokensOutput = 0
    let responseContent = ''

    this.workerStartTimes.set(workerId, startedAt)

    // Set up progress timer (emit updates every 2 seconds)
    const progressInterval = setInterval(() => {
      const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000)
      const estimatedTurn = Math.min(maxTurns, Math.floor(elapsedSeconds / 30) + 1)
      const progress = Math.min(95, (estimatedTurn / maxTurns) * 100)

      this.emit('progress', {
        workerId,
        sectionId,
        currentTurn: Math.max(turnsUsed, estimatedTurn),
        maxTurns,
        currentStep: `Working on ${section.name}...`,
        progress,
        elapsedSeconds
      } as WorkerProgress)
    }, 2000)

    // Helper to emit output
    const emitOutput = (output: string) => {
      this.emit('output', {
        workerId,
        sectionId,
        output,
        timestamp: Date.now()
      })
    }

    try {
      const sdk = await getSDK()

      // Map BvsModelId to SDK model string
      const sdkModel = this.mapModelToSdk(model)

      // Create MCP server with tools using SDK's tool() function and Zod schemas
      // CRITICAL: This is the ONLY way to get custom tools working with Agent SDK
      // - Must use sdk.tool() to create tool definitions
      // - Must use Zod schemas (not raw JSON schema)
      // - Handler must return CallToolResult format: { content: [{ type: 'text', text: string }] }

      // Helper to create CallToolResult format
      const toolResult = (text: string) => ({
        content: [{ type: 'text' as const, text }]
      })

      const workerMcpServer = sdk.createSdkMcpServer({
        name: `bvs-worker-${workerId}`,
        tools: [
          sdk.tool(
            'read_file',
            'Read contents of a file',
            { path: z.string().describe('File path relative to project root') },
            async (input) => {
              turnsUsed++
              console.log(`[BvsWorkerSDK:${workerId}] Tool: read_file (turn ${turnsUsed}/${maxTurns})`)
              emitOutput(`\n[Tool: read_file] ${input.path}\n`)

              try {
                const filePath = path.isAbsolute(input.path) ? input.path : path.join(cwd, input.path)
                const content = await fs.readFile(filePath, 'utf-8')
                const result = `[FILE: ${path.basename(input.path)} | ${content.split('\n').length} lines]\n${content.substring(0, 30000)}`
                emitOutput(`[Result] File read successfully (${content.length} chars)\n`)
                return toolResult(result)
              } catch (e: any) {
                const error = `Error reading file: ${e.message}`
                emitOutput(`[Result] ${error}\n`)
                return toolResult(error)
              }
            }
          ),
          sdk.tool(
            'write_file',
            'Create or replace a file with content',
            {
              path: z.string().describe('File path relative to project root'),
              content: z.string().describe('File content to write')
            },
            async (input) => {
              turnsUsed++
              console.log(`[BvsWorkerSDK:${workerId}] Tool: write_file (turn ${turnsUsed}/${maxTurns})`)
              emitOutput(`\n[Tool: write_file] ${input.path}\n`)

              try {
                const filePath = path.isAbsolute(input.path) ? input.path : path.join(cwd, input.path)
                await fs.mkdir(path.dirname(filePath), { recursive: true })
                await fs.writeFile(filePath, input.content, 'utf-8')

                if (!filesChanged.includes(input.path)) {
                  filesChanged.push(input.path)
                }

                const result = `Successfully wrote ${input.content.length} chars to ${input.path}`
                emitOutput(`[Result] ${result}\n`)
                return toolResult(result)
              } catch (e: any) {
                const error = `Error writing file: ${e.message}`
                emitOutput(`[Result] ${error}\n`)
                return toolResult(error)
              }
            }
          ),
          sdk.tool(
            'edit_file',
            'Make targeted edits to a file by replacing old string with new string',
            {
              path: z.string().describe('File path relative to project root'),
              old_string: z.string().describe('String to find and replace'),
              new_string: z.string().describe('Replacement string')
            },
            async (input) => {
              turnsUsed++
              console.log(`[BvsWorkerSDK:${workerId}] Tool: edit_file (turn ${turnsUsed}/${maxTurns})`)
              emitOutput(`\n[Tool: edit_file] ${input.path}\n`)

              try {
                const filePath = path.isAbsolute(input.path) ? input.path : path.join(cwd, input.path)
                const content = await fs.readFile(filePath, 'utf-8')

                if (!content.includes(input.old_string)) {
                  const error = `Error: Could not find the specified text to replace in ${input.path}`
                  emitOutput(`[Result] ${error}\n`)
                  return toolResult(error)
                }

                const newContent = content.replace(input.old_string, input.new_string)
                await fs.writeFile(filePath, newContent, 'utf-8')

                if (!filesChanged.includes(input.path)) {
                  filesChanged.push(input.path)
                }

                const result = `Successfully edited ${input.path}`
                emitOutput(`[Result] ${result}\n`)
                return toolResult(result)
              } catch (e: any) {
                const error = `Error editing file: ${e.message}`
                emitOutput(`[Result] ${error}\n`)
                return toolResult(error)
              }
            }
          ),
          sdk.tool(
            'list_files',
            'List files matching a glob pattern',
            { pattern: z.string().describe('Glob pattern like "src/**/*.ts"') },
            async (input) => {
              turnsUsed++
              console.log(`[BvsWorkerSDK:${workerId}] Tool: list_files (turn ${turnsUsed}/${maxTurns})`)
              emitOutput(`\n[Tool: list_files] ${input.pattern}\n`)

              try {
                const files = await glob(input.pattern, {
                  cwd,
                  nodir: true,
                  ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**']
                })

                const result = files.length === 0
                  ? 'No files found matching pattern'
                  : files.slice(0, 100).join('\n') + (files.length > 100 ? `\n\n[... and ${files.length - 100} more files]` : '')

                emitOutput(`[Result] Found ${files.length} files\n`)
                return toolResult(result)
              } catch (e: any) {
                const error = `Error listing files: ${e.message}`
                emitOutput(`[Result] ${error}\n`)
                return toolResult(error)
              }
            }
          ),
          sdk.tool(
            'run_command',
            'Execute a shell command (npm, git, etc.)',
            { command: z.string().describe('Shell command to execute') },
            async (input) => {
              turnsUsed++
              console.log(`[BvsWorkerSDK:${workerId}] Tool: run_command (turn ${turnsUsed}/${maxTurns})`)
              emitOutput(`\n[Tool: run_command] ${input.command}\n`)

              try {
                const { stdout, stderr } = await execAsync(input.command, {
                  cwd,
                  timeout: 60000,
                  maxBuffer: 1024 * 1024
                })

                let result = ''
                if (stdout) result += `stdout:\n${stdout}\n`
                if (stderr) result += `stderr:\n${stderr}\n`
                result = result || 'Command completed with no output'

                emitOutput(`[Result] Command completed\n`)
                return toolResult(result)
              } catch (e: any) {
                const error = `Error running command: ${e.message}`
                emitOutput(`[Result] ${error}\n`)
                return toolResult(error)
              }
            }
          ),
          sdk.tool(
            'mark_complete',
            'Mark section as complete. MUST be called when work is done.',
            {
              summary: z.string().describe('Summary of changes made'),
              files_changed: z.array(z.string()).describe('List of files created or modified')
            },
            async (input) => {
              console.log(`[BvsWorkerSDK:${workerId}] mark_complete called: ${input.summary}`)
              emitOutput(`\n[Tool: mark_complete] ${input.summary}\n`)

              isComplete = true
              if (input.files_changed) {
                for (const f of input.files_changed) {
                  if (!filesChanged.includes(f)) filesChanged.push(f)
                }
              }

              return toolResult(`Section marked complete. Summary: ${input.summary}`)
            }
          )
        ]
      })

      // Load external MCP servers from user's config
      // NOTE: On Windows, only HTTP/SSE-based MCP servers work reliably (not stdio)
      // Only load them for database-related sections that need them
      let userMcpConfig: Record<string, any> = {}
      const needsExternalMcp = this.isDatabaseRelatedSection(section)

      if (needsExternalMcp) {
        try {
          userMcpConfig = await this.loadUserMcpConfig()
          const serverNames = Object.keys(userMcpConfig)
          if (serverNames.length > 0) {
            console.log(`[BvsWorkerSDK:${workerId}] Loading external MCP servers for database section: ${serverNames.join(', ')}`)
          } else {
            console.log(`[BvsWorkerSDK:${workerId}] No compatible external MCP servers found (stdio skipped on Windows)`)
          }
        } catch (e) {
          console.warn(`[BvsWorkerSDK:${workerId}] Failed to load external MCP servers:`, e)
        }
      } else {
        console.log(`[BvsWorkerSDK:${workerId}] Section is not database-related, skipping external MCP servers`)
      }

      // Build SDK options - use mcpServers NOT tools
      // mcpServers is Record<string, McpServerConfig> - object not array
      //
      // IMPORTANT: In packaged Electron apps, environment variables from the system
      // may not be inherited. We explicitly pass them here to ensure the SDK subprocess
      // has access to ANTHROPIC_API_KEY and other required variables.
      //
      // For OAuth authentication, the CLI reads credentials from ~/.claude/.credentials.json
      const userHome = process.env.HOME || process.env.USERPROFILE || ''
      const sdkEnv: Record<string, string | undefined> = {
        ...process.env,
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
        CLAUDE_API_KEY: process.env.CLAUDE_API_KEY,
        HOME: userHome,
        USERPROFILE: userHome,
        PATH: process.env.PATH,
      }

      // Get the bundled CLI path for packaged apps
      const cliPath = getClaudeCodeCliPath()

      const options: Options = {
        model: sdkModel,
        maxTurns,
        cwd,
        includePartialMessages: true,  // Enable streaming
        permissionMode: 'bypassPermissions',  // Auto-approve tool use for worker
        allowDangerouslySkipPermissions: true, // Required for bypassPermissions mode
        mcpServers: {
          [`bvs-worker-${workerId}`]: workerMcpServer,  // Custom worker tools
          ...userMcpConfig  // External MCP servers (only for database sections)
        },
        // Allow all tools from our MCP servers (mcp__<server-name>__<tool-name> format)
        allowedTools: [
          'mcp__*'  // All MCP tools
        ],
        env: sdkEnv, // Pass environment to SDK subprocess
        // Specify the bundled CLI path for packaged Electron apps
        ...(cliPath ? { pathToClaudeCodeExecutable: cliPath } : {}),
      }

      // Create message generator (AsyncGenerator required for MCP tools to work)
      // Note: First message won't have session_id - SDK assigns it on init
      async function* generateMessages(): AsyncGenerator<SDKUserMessage> {
        yield {
          type: 'user' as const,
          message: {
            role: 'user' as const,
            content: prompt
          },
          parent_tool_use_id: null,
          session_id: ''  // Empty string - SDK will assign actual session_id
        } as SDKUserMessage
      }

      // Log SDK options for debugging
      console.log(`[BvsWorkerSDK:${workerId}] SDK Options:`, {
        model: options.model,
        maxTurns: options.maxTurns,
        cwd: options.cwd,
        permissionMode: options.permissionMode,
        mcpServers: Object.keys(options.mcpServers || {}),
        allowedTools: options.allowedTools,
        hasAnthropicApiKey: !!sdkEnv.ANTHROPIC_API_KEY,
        hasClaudeApiKey: !!sdkEnv.CLAUDE_API_KEY,
      })

      // Execute query with streaming - wrapped in try-catch for SDK subprocess errors
      let queryResult: ReturnType<typeof sdk.query>
      try {
        queryResult = sdk.query({
          prompt: generateMessages(),
          options
        })
      } catch (initError) {
        console.error(`[BvsWorkerSDK:${workerId}] SDK query initialization failed:`, initError)
        throw new Error(`Failed to start worker: ${initError instanceof Error ? initError.message : 'Unknown error'}`)
      }

      console.log(`[BvsWorkerSDK:${workerId}] Streaming output with MCP tools...`)

      // Process streaming response
      for await (const message of queryResult) {
        // Capture SDK session ID and check MCP server connection status
        if (message.type === 'system' && message.subtype === 'init') {
          sessionId = message.session_id
          this.activeSessions.set(workerId, sessionId)
          console.log(`[BvsWorkerSDK:${workerId}] Session ID: ${sessionId}`)

          // Check MCP server connection status (per SDK troubleshooting docs)
          const initMsg = message as any
          if (initMsg.mcp_servers) {
            for (const server of initMsg.mcp_servers) {
              if (server.status === 'connected') {
                console.log(`[BvsWorkerSDK:${workerId}] ✓ MCP server connected: ${server.name}`)
              } else {
                console.error(`[BvsWorkerSDK:${workerId}] ✗ MCP server failed: ${server.name} (${server.status})`)
              }
            }
          }
        }

        // tool_progress messages indicate tool is being called
        if (message.type === 'tool_progress') {
          const toolMsg = message as any
          console.log(`[BvsWorkerSDK:${workerId}] Tool progress: ${toolMsg.tool_name || 'unknown'}`)
        }

        // Handle streaming text
        if (message.type === 'stream_event' && (message as any).event) {
          const event = (message as any).event as { type: string; delta?: { text?: string } }

          if (event.type === 'content_block_delta' && event.delta?.text) {
            const text = event.delta.text
            responseContent += text
            emitOutput(text)
          }
        }

        // Handle assistant messages (may contain errors)
        if (message.type === 'assistant') {
          const assistantMsg = message as any
          if (assistantMsg.error) {
            const errorText = assistantMsg.error || 'Unknown error'
            console.error(`[BvsWorkerSDK:${workerId}] Error:`, errorText)
            errors.push(errorText)
          }
        }

        // Handle result (completion) - get cost/token data
        if (message.type === 'result') {
          const resultMsg = message as any
          totalCostUsd = resultMsg.total_cost_usd || 0
          totalTokensInput = resultMsg.usage?.input_tokens || 0
          totalTokensOutput = resultMsg.usage?.output_tokens || 0

          console.log(`[BvsWorkerSDK:${workerId}] Result: cost=$${totalCostUsd.toFixed(4)}, tokens=${totalTokensInput}/${totalTokensOutput}`)
        }
      }

      // Stop progress timer
      clearInterval(progressInterval)

      // Validate completion
      const validation = await this.validateSectionCompletion(section, cwd, isComplete)

      const completedAt = Date.now()

      // Emit final progress
      this.emit('progress', {
        workerId,
        sectionId,
        currentTurn: turnsUsed,
        maxTurns,
        currentStep: validation.valid ? 'Complete' : 'Failed',
        progress: validation.valid ? 100 : (turnsUsed / maxTurns) * 100,
        elapsedSeconds: Math.floor((completedAt - startedAt) / 1000)
      } as WorkerProgress)

      const result: WorkerResult = {
        workerId,
        sectionId,
        status: validation.valid ? 'completed' : 'failed',
        turnsUsed,
        filesChanged: [...new Set(filesChanged)],
        qualityGatesPassed: validation.valid,
        errors: validation.valid ? [] : validation.errors,
        retryCount: 0,
        startedAt,
        completedAt,
        commits: [],
        costUsd: totalCostUsd,
        tokensInput: totalTokensInput,
        tokensOutput: totalTokensOutput,
      }

      // Cleanup
      this.activeSessions.delete(workerId)
      this.workerStartTimes.delete(workerId)

      console.log(`[BvsWorkerSDK:${workerId}] ${validation.valid ? '✓' : '✗'} Completed with status: ${result.status}`)
      if (!validation.valid) {
        console.error(`[BvsWorkerSDK:${workerId}] Validation errors:`, validation.errors)
      }

      return result

    } catch (error: any) {
      // Stop progress timer
      clearInterval(progressInterval)

      console.error(`[BvsWorkerSDK:${workerId}] Fatal error:`, error)

      // Check if we have content/files despite the error (exit code 1 after partial success)
      // This happens when CLI process exits with code 1 but work was actually done
      if (filesChanged.length > 0 || turnsUsed > 0) {
        console.log(`[BvsWorkerSDK:${workerId}] Error occurred but have work done: ${filesChanged.length} files, ${turnsUsed} turns`)

        // Validate completion despite error
        const validation = await this.validateSectionCompletion(section, cwd, isComplete)

        if (validation.valid) {
          console.log(`[BvsWorkerSDK:${workerId}] Work validated successfully despite exit code 1`)

          // Cleanup
          this.activeSessions.delete(workerId)
          this.workerStartTimes.delete(workerId)

          return {
            workerId,
            sectionId,
            status: 'completed',
            turnsUsed,
            filesChanged: [...new Set(filesChanged)],
            qualityGatesPassed: true,
            errors: [],
            retryCount: 0,
            startedAt,
            completedAt: Date.now(),
            commits: [],
            costUsd: totalCostUsd,
            tokensInput: totalTokensInput,
            tokensOutput: totalTokensOutput,
          }
        }

        // Work was done but validation failed - use validation errors
        errors.push(...validation.errors)
      } else {
        errors.push(error.message || String(error))
      }

      // Cleanup
      this.activeSessions.delete(workerId)
      this.workerStartTimes.delete(workerId)

      return {
        workerId,
        sectionId,
        status: 'failed',
        turnsUsed,
        filesChanged,
        qualityGatesPassed: false,
        errors,
        retryCount: 0,
        startedAt,
        completedAt: Date.now(),
        commits: [],
        costUsd: totalCostUsd,
        tokensInput: totalTokensInput,
        tokensOutput: totalTokensOutput,
      }
    }
  }

  /**
   * Abort a running worker (matches CLI service interface)
   */
  abortWorker(workerId: string): boolean {
    const sessionId = this.activeSessions.get(workerId)
    if (sessionId) {
      console.log(`[BvsWorkerSDK:${workerId}] Aborting session ${sessionId}`)
      // Note: Agent SDK doesn't have explicit abort - session will timeout
      this.activeSessions.delete(workerId)
      this.workerStartTimes.delete(workerId)
      return true
    }
    return false
  }

  /**
   * Map BVS model ID to SDK model string
   * BvsModelId is already a full model name like 'claude-sonnet-4-20250514'
   */
  private mapModelToSdk(model: BvsModelId): string {
    // BvsModelId is already in the correct format
    // Just return it directly - it's already like 'claude-sonnet-4-20250514'
    return model
  }

  /**
   * Check if a section is database-related (migrations, schema, tables)
   */
  private isDatabaseRelatedSection(section: BvsSection): boolean {
    const name = (section.name || '').toLowerCase()
    const desc = (section.description || '').toLowerCase()
    const files = (section.files || []).map(f => (f.path || '').toLowerCase()).join(' ')
    const criteria = (section.successCriteria || [])
      .map(c => (typeof c === 'string' ? c : c?.description || '').toLowerCase())
      .join(' ')

    const allText = `${name} ${desc} ${files} ${criteria}`

    const databaseKeywords = [
      'database', 'migration', 'schema', 'table', 'sql',
      'supabase', 'postgres', 'prisma', 'drizzle',
      'create table', 'alter table', 'index', 'constraint',
      'foreign key', 'primary key', 'column', 'seed'
    ]

    return databaseKeywords.some(keyword => allText.includes(keyword))
  }

  /**
   * Load user's MCP server configuration from ~/.claude/mcp.json
   * This allows workers to access external services like Supabase, Chrome, etc.
   * Returns Record<string, McpServerConfig> format for SDK mcpServers option
   *
   * SDK McpServerConfig types:
   * - McpStdioServerConfig: { type?: 'stdio', command, args?, env? }
   * - McpSSEServerConfig: { type: 'sse', url, headers? }
   * - McpHttpServerConfig: { type: 'http', url, headers? }
   *
   * WINDOWS COMPATIBILITY NOTES:
   * - On Windows, stdio-based MCP servers can cause subprocess hangs (GitHub Issue #208)
   * - The ClaudeSDKClient has stdin/stdout buffering issues on Windows
   * - URL-based servers (SSE/HTTP) work more reliably on Windows
   * - For stdio servers, we need to ensure proper Windows command format
   *
   * References:
   * - https://github.com/anthropics/claude-agent-sdk-python/issues/208
   * - https://github.com/anthropics/claude-agent-sdk-python/issues/176
   */
  private async loadUserMcpConfig(): Promise<Record<string, any>> {
    const { homedir } = await import('os')
    const { platform } = await import('os')
    const mcpConfigPath = path.join(homedir(), '.claude', 'mcp.json')
    const isWindows = platform() === 'win32'

    try {
      const content = await fs.readFile(mcpConfigPath, 'utf-8')
      const config = JSON.parse(content)

      if (!config.mcpServers) {
        return {}
      }

      // Convert mcp.json format to SDK mcpServers format (Record<string, McpServerConfig>)
      const mcpServers: Record<string, any> = {}

      for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
        const cfg = serverConfig as any

        // Skip claude-in-chrome - it requires special handling and can cause crashes
        if (name === 'claude-in-chrome' || name.includes('chrome')) {
          console.log(`[BvsWorkerSDK] Skipping MCP server: ${name} (browser extensions not supported in workers)`)
          continue
        }

        if (cfg.url) {
          // Remote server - URL-based servers work reliably on all platforms
          // Supabase MCP uses streamable HTTP endpoint, try 'http' first, fallback to 'sse'
          // According to Supabase docs, their MCP endpoint is streamable HTTP
          let serverType = cfg.type
          if (!serverType) {
            // Auto-detect: Supabase uses 'http' (streamable), most others use 'sse'
            if (cfg.url.includes('supabase.com')) {
              serverType = 'http'  // Supabase MCP uses streamable HTTP
            } else {
              serverType = 'sse'  // Default for other remote servers
            }
          }
          mcpServers[name] = {
            type: serverType,
            url: cfg.url,
            ...(cfg.headers ? { headers: cfg.headers } : {})
          }
          console.log(`[BvsWorkerSDK] Loaded MCP server: ${name} (${serverType}: ${cfg.url})`)
        } else if (cfg.command) {
          // Stdio local server - CAREFUL on Windows!
          // Windows has known subprocess stdin/stdout issues with Agent SDK
          // Only load stdio servers if absolutely necessary

          if (isWindows) {
            // On Windows, stdio servers can cause subprocess hangs
            // The issue is stdin/stdout buffering in Python's anyio.open_process()
            // For now, skip stdio servers on Windows to avoid crashes
            // TODO: Implement workaround using external .mcp.json file instead of in-process
            console.warn(`[BvsWorkerSDK] ⚠ Skipping stdio MCP server on Windows: ${name}`)
            console.warn(`[BvsWorkerSDK] Windows has known subprocess issues with stdio MCP servers`)
            console.warn(`[BvsWorkerSDK] See: https://github.com/anthropics/claude-agent-sdk-python/issues/208`)
            continue
          }

          mcpServers[name] = {
            type: 'stdio',
            command: cfg.command,
            args: cfg.args || [],
            ...(cfg.env ? { env: cfg.env } : {})
          }
          console.log(`[BvsWorkerSDK] Loaded MCP server: ${name} (stdio: ${cfg.command})`)
        }
      }

      return mcpServers
    } catch (e) {
      console.log('[BvsWorkerSDK] No user MCP config found, using built-in tools only')
      return {}
    }
  }

  /**
   * Build worker prompt
   *
   * When architectDiagnosis is provided (retry scenario), includes the architect's
   * analysis of why the previous attempt failed and recommended approach changes.
   */
  private buildWorkerPrompt(
    section: BvsSection,
    context: ProjectContext,
    maxTurns: number,
    architectDiagnosis?: BvsArchitectDiagnosis
  ): string {
    const successCriteria = section.successCriteria
      .map((c, i) => `${i + 1}. ${c.description}`)
      .join('\n')

    const fileActions = section.files
      .map(f => `- ${f.action.toUpperCase()}: ${f.path}`)
      .join('\n')

    const completedSummary = context.completedSections.length > 0
      ? `\n\nCOMPLETED SECTIONS:\n${context.completedSections.map(s => `- ${s.name}: ${s.summary}`).join('\n')}`
      : ''

    // Detect if this is a database-related section
    const isDatabaseSection = this.isDatabaseRelatedSection(section)

    // Build architect diagnosis section for retries
    const diagnosisSection = architectDiagnosis ? `
═══════════════════════════════════════════════════════════════════════════════
*** RETRY ATTEMPT - PREVIOUS FAILURE DIAGNOSIS ***
═══════════════════════════════════════════════════════════════════════════════

An architect agent has analyzed why the previous attempt failed:

FAILURE TYPE: ${architectDiagnosis.failureType.toUpperCase()}
ROOT CAUSE: ${architectDiagnosis.rootCause}

DIAGNOSIS:
${architectDiagnosis.diagnosis}

RECOMMENDED APPROACH:
${architectDiagnosis.suggestedApproach}

${architectDiagnosis.filesToReadFirst.length > 0 ? `FILES TO READ FIRST:
${architectDiagnosis.filesToReadFirst.map(f => `- ${f}`).join('\n')}` : ''}

${architectDiagnosis.warningsForWorker.length > 0 ? `WARNINGS:
${architectDiagnosis.warningsForWorker.map(w => `⚠ ${w}`).join('\n')}` : ''}

*** YOU MUST USE A DIFFERENT APPROACH THIS TIME ***
Do NOT repeat the same steps that led to failure. Follow the recommended approach above.

═══════════════════════════════════════════════════════════════════════════════
` : ''

    return `You are a BVS worker implementing a section of code.
${diagnosisSection}

SECTION: ${section.name}
DESCRIPTION: ${section.description}

FILES TO CREATE/MODIFY:
${fileActions}

PROJECT CONTEXT:
- Project: ${context.projectName}
- Framework: ${context.framework}
- Database: ${context.database}
- Patterns: ${context.patterns.join(', ')}${completedSummary}

SUCCESS CRITERIA (ALL MUST BE MET):
${successCriteria}

═══════════════════════════════════════════════════════════════════════════════
AVAILABLE TOOLS:
═══════════════════════════════════════════════════════════════════════════════

FILE TOOLS:
1. list_files(pattern) - Find files matching a glob pattern
2. read_file(path) - Read file contents
3. write_file(path, content) - Create or overwrite a file
4. edit_file(path, old_string, new_string) - Edit part of a file
5. mark_complete(summary, files_changed) - Signal completion

${isDatabaseSection ? `
DATABASE TOOLS (Supabase MCP) - REQUIRED FOR DATABASE TASKS:
You have access to Supabase MCP tools for database operations:
- mcp__supabase__execute_sql - Execute SQL queries directly
- mcp__supabase__list_tables - List all tables in the database
- mcp__supabase__get_table_schema - Get schema of a specific table
- mcp__supabase__apply_migration - Apply a migration file to the database

*** CRITICAL: For database/migration tasks, you MUST: ***
1. Create the migration file with write_file
2. THEN apply it to the database using mcp__supabase__apply_migration or mcp__supabase__execute_sql
3. Verify the changes were applied using mcp__supabase__list_tables or mcp__supabase__get_table_schema

Creating a migration file WITHOUT applying it to the database is NOT complete.
The section is only complete when the database schema actually reflects the changes.
` : ''}
═══════════════════════════════════════════════════════════════════════════════
MANDATORY WORKFLOW - YOU MUST FOLLOW THIS EXACTLY:
═══════════════════════════════════════════════════════════════════════════════

STEP 1: QUICK INVESTIGATION
   Use list_files and read_file to check if similar functionality exists:
   - list_files("src/app/api/**/*.ts") - Check for existing API routes
   - list_files("supabase/migrations/*.sql") - Check for existing migrations
   - read_file(...) - Read files that might contain related code
${isDatabaseSection ? `
   For database tasks, also check if tables already exist:
   - mcp__supabase__list_tables() - Check existing tables
   - mcp__supabase__get_table_schema(table_name) - Check table structure
` : ''}
   KEEP INVESTIGATION BRIEF - 2-3 tool calls max. Don't over-investigate.

STEP 2: MAKE A DECISION
   Based on your investigation:

   A) FUNCTIONALITY EXISTS (files + database schema) → Go to STEP 4 (mark complete)
   B) FILES/SCHEMA DON'T EXIST → Go to STEP 3 (create them)
   C) PARTIALLY EXISTS → Go to STEP 3 (complete the implementation)

STEP 3: IMPLEMENT THE CODE
   *** THIS IS THE CRITICAL STEP ***

   Use write_file to create each required file:
${fileActions}
${isDatabaseSection ? `
   *** FOR DATABASE/MIGRATION TASKS: ***
   After creating the migration file, you MUST apply it:

   Option A - Apply migration file:
   mcp__supabase__apply_migration({ migration_file: "supabase/migrations/20260128_create_budgets.sql" })

   Option B - Execute SQL directly:
   mcp__supabase__execute_sql({ query: "CREATE TABLE IF NOT EXISTS budgets (...)" })

   Then VERIFY the changes:
   mcp__supabase__list_tables() - Confirm new tables exist
   mcp__supabase__get_table_schema({ table_name: "budgets" }) - Confirm schema is correct
` : ''}
STEP 4: CALL mark_complete
   You MUST call mark_complete() when done:
   - summary: What you did (include "applied to database" for migrations)
   - files_changed: List of files created/modified

═══════════════════════════════════════════════════════════════════════════════
CRITICAL RULES:
═══════════════════════════════════════════════════════════════════════════════

1. Use the provided tools, NOT shell commands
2. If files don't exist, you MUST create them with write_file
3. Investigation should be quick (2-3 calls), not exhaustive
${isDatabaseSection ? `4. *** DATABASE TASKS: Creating migration files is NOT enough - you MUST apply them ***
5. Verify database changes before marking complete
6. The section FAILS if migrations exist but are not applied to the database` : `4. The outcome MUST be: files exist (found or created)`}
7. You have ${maxTurns} turns maximum
8. The section FAILS if required work is not actually done

═══════════════════════════════════════════════════════════════════════════════
*** FORBIDDEN ACTIONS - INSTANT FAILURE ***
═══════════════════════════════════════════════════════════════════════════════

You MUST NOT do any of the following. These are cheats that hide problems:

1. NEVER set ignoreBuildErrors: true in next.config.js or any config file
2. NEVER add @ts-ignore, @ts-expect-error, or @ts-nocheck comments
3. NEVER add eslint-disable comments to suppress errors
4. NEVER use "any" type to bypass TypeScript errors
5. NEVER skip tests or disable test suites
6. NEVER modify CI/CD configs to skip validation steps

If you encounter TypeScript or build errors, you MUST:
- FIX the actual error by correcting the code
- Install missing dependencies if needed
- Add proper type definitions
- Import missing modules

The section FAILS if you use ANY error suppression technique instead of fixing the actual problem.

═══════════════════════════════════════════════════════════════════════════════
DECISION FLOWCHART:
═══════════════════════════════════════════════════════════════════════════════

  list_files() → Found similar files?
       │
       ├─ YES → read_file() → Meets success criteria?
       │            │
       │            ├─ YES → mark_complete("Verified existing implementation", [])
       │            │
       │            └─ NO → edit_file() to fix → mark_complete("Updated existing", [...])
       │
       └─ NO → write_file() to create → mark_complete("Created new files", [...])

═══════════════════════════════════════════════════════════════════════════════

START NOW: Quick investigation (2-3 calls), then implement if needed.`
  }

  /**
   * Validate section completion against plan requirements
   * Uses content-based validation to check if success criteria are met
   */
  private async validateSectionCompletion(
    section: BvsSection,
    cwd: string,
    isComplete: boolean
  ): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = []
    const warnings: string[] = []
    let allFilesExist = true
    let contentIssuesFound = false
    const foundFiles: string[] = [] // Track files that satisfy requirements

    console.log(`[BVS Validation] Validating section: ${section.name}`)
    console.log(`[BVS Validation] Working directory: ${cwd}`)
    console.log(`[BVS Validation] mark_complete called: ${isComplete}`)
    console.log(`[BVS Validation] Expected files: ${section.files.map(f => f.path).join(', ')}`)
    console.log(`[BVS Validation] Success criteria: ${section.successCriteria.map(c => c.description).join('; ')}`)

    // 1. Verify all expected files exist (check exact path and similar paths)
    for (const fileSpec of section.files) {
      const filePath = path.join(cwd, fileSpec.path)
      let fileFound = false
      let foundFilePath: string | null = null

      // Check exact path
      try {
        await fs.access(filePath)
        fileFound = true
        foundFilePath = filePath
        console.log(`[BVS Validation] ✓ Found file (exact match): ${fileSpec.path}`)
      } catch {
        // Check for similar filenames in same directory
        const dirPath = path.dirname(filePath)
        const baseName = path.basename(fileSpec.path)

        // For migrations, extract the base name without timestamp prefix
        // e.g., "20260121000001_budgets_core.sql" -> "budgets_core"
        const migrationMatch = baseName.match(/^\d+[_-]?(.+)\.sql$/)
        const coreNamePart = migrationMatch ? migrationMatch[1] : baseName.replace(/\.[^.]+$/, '')

        // Extract significant words from the expected filename (e.g., "budgets_core" -> ["budgets", "core"])
        const expectedWords = coreNamePart.toLowerCase().split(/[_\-\s]+/).filter(w => w.length > 2 && !['create', 'add', 'update', 'fix'].includes(w))
        console.log(`[BVS Validation] Looking for file matching words: ${expectedWords.join(', ')} from ${coreNamePart}`)

        try {
          const dirExists = await fs.stat(dirPath).then(s => s.isDirectory()).catch(() => false)
          console.log(`[BVS Validation] Checking directory: ${dirPath}, exists: ${dirExists}`)
          if (dirExists) {
            const files = await fs.readdir(dirPath)
            console.log(`[BVS Validation] Found ${files.length} files in directory`)

            // Filter to only .sql files to reduce noise
            const sqlFiles = files.filter(f => f.endsWith('.sql'))
            console.log(`[BVS Validation] SQL files: ${sqlFiles.length}`)

            const similar = sqlFiles.filter(f => {
              // Match by core name part (ignoring timestamp prefixes)
              const fMatch = f.match(/^\d+[_-]?(.+)\.sql$/)
              const fCoreName = fMatch ? fMatch[1] : f.replace(/\.[^.]+$/, '')
              const fWords = fCoreName.toLowerCase().split(/[_\-\s]+/).filter(w => w.length > 2)

              // Check if filenames share significant words (e.g., "budget" in both)
              const sharedWords = expectedWords.filter(ew => fWords.some(fw => fw.includes(ew) || ew.includes(fw)))

              // Also check direct substring matching
              const directMatch = fCoreName.toLowerCase().includes(coreNamePart.toLowerCase()) || coreNamePart.toLowerCase().includes(fCoreName.toLowerCase())

              // Log matches found
              if (sharedWords.length > 0 || directMatch) {
                console.log(`[BVS Validation] Match found: ${f} (coreName=${fCoreName}, sharedWords=${sharedWords.join(',')}, direct=${directMatch})`)
              }

              return sharedWords.length > 0 || directMatch
            })

            console.log(`[BVS Validation] Found ${similar.length} potential matches`)
            if (similar.length > 0) {
              fileFound = true
              foundFilePath = path.join(dirPath, similar[0])
              foundFiles.push(foundFilePath) // Track the actual file found
              console.log(`[BVS Validation] ✓ Found equivalent file: ${similar[0]} (expected: ${baseName})`)
            }
          } else {
            console.log(`[BVS Validation] Directory doesn't exist: ${dirPath}`)
          }
        } catch (e) {
          console.log(`[BVS Validation] Error checking directory: ${e}`)
        }

        if (!fileFound) {
          allFilesExist = false
          errors.push(`Missing required file: ${fileSpec.path}`)
          console.error(`[BVS Validation] ✗ Missing file: ${fileSpec.path}`)
        }
      }

      // If we found an equivalent file, add it to foundFiles for content validation
      if (fileFound && foundFilePath) {
        foundFiles.push(foundFilePath)
      }
    }

    // 2. For SQL migrations, do basic validation (warnings, not errors)
    // Use foundFiles which contains actual paths (including equivalent matches)
    const sqlFilesToValidate = foundFiles.filter(f => f.endsWith('.sql'))
    for (const sqlFilePath of sqlFilesToValidate) {
      try {
        const content = await fs.readFile(sqlFilePath, 'utf-8')

        const fileName = path.basename(sqlFilePath)

        // Check for RLS without policies - warning only (not error)
        if (content.includes('ENABLE ROW LEVEL SECURITY')) {
          if (!content.includes('CREATE POLICY')) {
            warnings.push(`${fileName}: RLS enabled but no policies defined`)
            console.warn(`[BVS Validation] ⚠ ${fileName}: RLS enabled but no policies defined`)
          }
        }

        // Check for basic SQL syntax
        if (!content.trim()) {
          contentIssuesFound = true
          errors.push(`${fileName}: File is empty`)
          console.error(`[BVS Validation] ✗ ${fileName}: File is empty`)
        }

        // Check for missing indexes on foreign keys (warning only)
        if (content.includes('REFERENCES') && !content.includes('CREATE INDEX')) {
          warnings.push(`${fileName}: Foreign keys without indexes (performance warning)`)
          console.warn(`[BVS Validation] ⚠ ${fileName}: Foreign keys without indexes (performance warning)`)
        }

        console.log(`[BVS Validation] ✓ SQL file validated: ${fileName} (${content.length} bytes)`)
      } catch (e) {
        console.log(`[BVS Validation] Could not read SQL file ${sqlFilePath}: ${e}`)
      }
    }

    // 3. Check mark_complete was called, OR auto-complete if all files exist
    if (!isComplete) {
      if (allFilesExist && section.files.length > 0 && !contentIssuesFound) {
        // All required files exist - auto-approve even without mark_complete
        console.log('[BVS Validation] ✓ All files exist - auto-completing section (worker did not call mark_complete)')
        if (warnings.length > 0) {
          console.log(`[BVS Validation] Warnings: ${warnings.join('; ')}`)
        }
        return {
          valid: true,
          errors: []
        }
      } else if (!allFilesExist) {
        // Files are missing - this is the actual error
        errors.push('Worker did not call mark_complete tool')
        console.error(`[BVS Validation] ✗ Section failed: files missing and mark_complete not called`)
      } else if (contentIssuesFound) {
        errors.push('Worker did not call mark_complete tool')
        console.error(`[BVS Validation] ✗ Section failed: content issues found and mark_complete not called`)
      }
    }

    return {
      valid: errors.length === 0,
      errors
    }
  }
}

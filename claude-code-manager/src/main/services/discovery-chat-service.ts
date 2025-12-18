/**
 * Discovery Chat Service
 *
 * Handles the discovery phase chat with Claude CLI.
 * Manages message streaming and coordinates with research agents.
 *
 * Flow:
 * 1. User sends message
 * 2. Service spawns Claude CLI with the message
 * 3. Response is streamed back to renderer
 * 4. Research agents are triggered based on conversation context
 */

import { spawn, ChildProcess } from 'child_process'
import { randomBytes } from 'crypto'
import { EventEmitter } from 'events'
import * as fs from 'fs/promises'
import * as path from 'path'
import { platform } from 'os'
import { app } from 'electron'
import { getMainWindow } from '../index'
import { ConfigStore } from './config-store'
import { ResearchAgentRunner } from './research-agent-runner'

/**
 * MCP servers required for autonomous mode discovery and research phases
 * OPTIMIZATION: Use --prefer-offline and --no-install to avoid re-downloading
 * For fastest startup, globally install: npm install -g @anthropic-ai/mcp-server-playwright
 */
const AUTONOMOUS_MCP_CONFIG = {
  mcpServers: {
    // Playwright for browser testing - cached npx for faster startup
    playwright: {
      command: 'npx',
      args: ['--prefer-offline', '@anthropic-ai/mcp-server-playwright']
    }
  }
}

/**
 * Ensure project has a clean MCP config for autonomous mode
 * Creates .mcp.json in project root with ONLY the servers needed
 * This overrides user-level MCP config to avoid tool name conflicts
 *
 * Per Claude Code docs: Project-level .mcp.json takes precedence over user config
 */
async function ensureProjectMcpConfig(projectPath: string): Promise<void> {
  const mcpConfigPath = path.join(projectPath, '.mcp.json')

  try {
    // Check if .mcp.json already exists
    const existingContent = await fs.readFile(mcpConfigPath, 'utf-8')
    const existing = JSON.parse(existingContent)

    // Check if it already has our required servers
    const hasSupabase = existing.mcpServers?.supabase
    const hasPlaywright = existing.mcpServers?.playwright

    if (hasSupabase && hasPlaywright) {
      console.log('[DiscoveryChat] Project MCP config already has required servers')
      return
    }

    // Merge our servers with existing config
    const merged = {
      mcpServers: {
        ...existing.mcpServers,
        ...AUTONOMOUS_MCP_CONFIG.mcpServers
      }
    }
    await fs.writeFile(mcpConfigPath, JSON.stringify(merged, null, 2))
    console.log('[DiscoveryChat] Updated project MCP config with required servers')
  } catch {
    // No existing config - create new one with only our servers
    await fs.writeFile(mcpConfigPath, JSON.stringify(AUTONOMOUS_MCP_CONFIG, null, 2))
    console.log('[DiscoveryChat] Created project MCP config with required servers')
  }
}

/**
 * Get spawn options for cross-platform CLI execution
 * On Windows, .cmd files require shell interpretation
 */
function getSpawnConfig(cliPath: string): { command: string; shellOption: boolean } {
  if (platform() === 'win32') {
    // On Windows, use shell: true for .cmd files (npm scripts)
    // This is safe because we pass input via stdin, not command line args
    return { command: cliPath, shellOption: true }
  }
  return { command: cliPath, shellOption: false }
}

/**
 * Validate project path is safe to use
 * Security: Prevents path traversal, validates directory exists
 */
async function validateProjectPath(projectPath: string): Promise<boolean> {
  try {
    if (projectPath.includes('..') || projectPath.includes('\0')) {
      return false
    }
    if (/[;&|`$<>]/.test(projectPath)) {
      return false
    }

    const resolvedPath = path.resolve(projectPath)
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
 */
function createSafeEnv(): NodeJS.ProcessEnv {
  const allowedVars = [
    // System paths
    'PATH', 'HOME', 'USERPROFILE', 'TEMP', 'TMP',
    // Windows app data paths (needed for Claude CLI to find credentials)
    'APPDATA', 'LOCALAPPDATA',
    // Locale
    'LANG', 'LC_ALL', 'SHELL',
    // Claude CLI authentication (required for API access)
    'ANTHROPIC_API_KEY', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX',
    // Node.js
    'NODE_ENV', 'npm_config_prefix',
    // System
    'SystemRoot', 'COMSPEC'
  ]
  const safeEnv: NodeJS.ProcessEnv = {
    CI: 'true',
    // Allow longer responses for spec generation (default is 32000)
    CLAUDE_CODE_MAX_OUTPUT_TOKENS: '128000'
  }
  for (const key of allowedVars) {
    if (process.env[key]) {
      safeEnv[key] = process.env[key]
    }
  }
  return safeEnv
}

// Autonomous directory for persistence
const AUTONOMOUS_DIR = '.autonomous'
const SESSION_FILE = 'session.json'
const SPEC_FILE = 'spec.md'
const AGENT_OUTPUTS_DIR = 'agent-outputs'

/**
 * Ensure .autonomous directory exists in project
 */
async function ensureAutonomousDir(projectPath: string): Promise<string> {
  const autonomousPath = path.join(projectPath, AUTONOMOUS_DIR)
  try {
    await fs.mkdir(autonomousPath, { recursive: true })
  } catch {
    // Directory might already exist
  }
  return autonomousPath
}

/**
 * Save session data to disk
 * Saves to: project/.autonomous/session.json
 */
async function saveSessionToDisk(projectPath: string, session: DiscoverySession): Promise<void> {
  const autonomousPath = await ensureAutonomousDir(projectPath)
  const sessionPath = path.join(autonomousPath, SESSION_FILE)

  const sessionData = {
    id: session.id,
    projectPath: session.projectPath,
    isNewProject: session.isNewProject,
    messages: session.messages,
    agentStatuses: session.agentStatuses,
    createdAt: session.createdAt,
    updatedAt: Date.now()
  }

  await fs.writeFile(sessionPath, JSON.stringify(sessionData, null, 2))
  console.log('[DiscoveryChat] Session saved to disk:', sessionPath)
}

/**
 * Load session from disk if it exists
 * Loads from: project/.autonomous/session.json
 */
async function loadSessionFromDisk(projectPath: string): Promise<DiscoverySession | null> {
  const sessionPath = path.join(projectPath, AUTONOMOUS_DIR, SESSION_FILE)

  try {
    const content = await fs.readFile(sessionPath, 'utf-8')
    const data = JSON.parse(content)

    console.log('[DiscoveryChat] Loaded existing session from disk:', sessionPath)
    console.log('[DiscoveryChat] Session has', data.messages?.length || 0, 'messages')

    return {
      id: data.id,
      projectPath: data.projectPath,
      isNewProject: data.isNewProject,
      messages: data.messages || [],
      agentStatuses: data.agentStatuses || [],
      createdAt: data.createdAt
    }
  } catch {
    // No existing session
    return null
  }
}

/**
 * Save spec document to disk
 * Saves to: project/.autonomous/spec.md
 */
async function saveSpecToDisk(projectPath: string, specContent: string): Promise<string> {
  const autonomousPath = await ensureAutonomousDir(projectPath)
  const specPath = path.join(autonomousPath, SPEC_FILE)

  // Add header with timestamp
  const header = `# Project Specification

> Generated: ${new Date().toISOString()}
> Project: ${projectPath}

---

`

  await fs.writeFile(specPath, header + specContent)
  console.log('[DiscoveryChat] Spec saved to disk:', specPath)
  return specPath
}

/**
 * Save agent output to disk
 * Saves to: project/.autonomous/agent-outputs/{agentType}-{timestamp}.json
 */
async function saveAgentOutputToDisk(
  projectPath: string,
  agentType: string,
  output: string
): Promise<string> {
  const autonomousPath = await ensureAutonomousDir(projectPath)
  const outputsDir = path.join(autonomousPath, AGENT_OUTPUTS_DIR)

  try {
    await fs.mkdir(outputsDir, { recursive: true })
  } catch {
    // Directory might already exist
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const filename = `${agentType}-${timestamp}.md`
  const outputPath = path.join(outputsDir, filename)

  await fs.writeFile(outputPath, output)
  console.log('[DiscoveryChat] Agent output saved:', outputPath)
  return outputPath
}

/**
 * Clear session from disk (for starting fresh)
 */
async function clearSessionFromDisk(projectPath: string): Promise<void> {
  const sessionPath = path.join(projectPath, AUTONOMOUS_DIR, SESSION_FILE)
  try {
    await fs.unlink(sessionPath)
    console.log('[DiscoveryChat] Session cleared from disk')
  } catch {
    // File might not exist
  }
}

// Message types for discovery chat
export interface DiscoveryChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
}

// Agent status for research agents
export interface DiscoveryAgentStatus {
  name: string
  status: 'idle' | 'running' | 'complete' | 'error'
  output?: string
  error?: string
}

// Session for a discovery chat
export interface DiscoverySession {
  id: string
  projectPath: string
  isNewProject: boolean
  messages: DiscoveryChatMessage[]
  agentStatuses: DiscoveryAgentStatus[]
  createdAt: number
}

// IPC channel names for discovery chat
export const DISCOVERY_CHAT_CHANNELS = {
  MESSAGE: 'discovery:message',
  RESPONSE: 'discovery:response',
  RESPONSE_CHUNK: 'discovery:response-chunk',
  RESPONSE_COMPLETE: 'discovery:response-complete',
  AGENT_STATUS: 'discovery:agent-status',
  ERROR: 'discovery:error',
  // Session management
  CREATE_SESSION: 'discovery:create-session',
  CREATE_FRESH_SESSION: 'discovery:create-fresh-session',
  SESSION_LOADED: 'discovery:session-loaded',
  // Spec management
  SPEC_READY: 'discovery:spec-ready'
} as const

// Export persistence helpers for external use
export { saveSpecToDisk, loadSessionFromDisk, clearSessionFromDisk }

export class DiscoveryChatService extends EventEmitter {
  private sessions: Map<string, DiscoverySession> = new Map()
  private activeProcess: ChildProcess | null = null
  private configStore: ConfigStore
  private researchRunner: ResearchAgentRunner
  // Track message count per session for agent triggering
  private messageCount: Map<string, number> = new Map()

  constructor(configStore: ConfigStore) {
    super()
    this.configStore = configStore
    this.researchRunner = new ResearchAgentRunner(configStore)

    // Listen for agent status updates
    this.researchRunner.on('status', (data) => {
      this.sendToRenderer(DISCOVERY_CHAT_CHANNELS.AGENT_STATUS, {
        sessionId: data.sessionId,
        agent: {
          name: data.agentName,
          status: data.status,
          output: data.output,
          error: data.error
        }
      })
    })

    // Listen for agent completion to save outputs
    this.researchRunner.on('complete', async (data: { taskId: string; result: { agentType: string; output?: string; status: string } }) => {
      const { result } = data
      if (result.status === 'complete' && result.output) {
        // Find the session for this task to get project path
        for (const session of this.sessions.values()) {
          const tasks = this.researchRunner.getSessionTasks(session.id)
          const task = tasks.find(t => t.id === data.taskId)
          if (task) {
            // Save agent output to disk
            await saveAgentOutputToDisk(session.projectPath, result.agentType, result.output)

            // If this is the spec-builder, also save as the main spec file
            if (result.agentType === 'spec-builder') {
              const specPath = await saveSpecToDisk(session.projectPath, result.output)
              console.log('[DiscoveryChat] Spec document saved:', specPath)

              // Notify renderer that spec is ready
              this.sendToRenderer(DISCOVERY_CHAT_CHANNELS.AGENT_STATUS, {
                sessionId: session.id,
                agent: {
                  name: 'spec-builder',
                  status: 'complete',
                  output: result.output,
                  specPath
                }
              })
            }
            break
          }
        }
      }
    })
  }

  /**
   * Create or load a discovery session for a project
   * If a session already exists on disk, it will be loaded (resumable sessions)
   */
  async createSession(projectPath: string, isNewProject: boolean): Promise<DiscoverySession> {
    // Try to load existing session from disk
    const existingSession = await loadSessionFromDisk(projectPath)

    if (existingSession) {
      // Resume existing session
      console.log('[DiscoveryChat] Resuming existing session:', existingSession.id)

      // Restore message count for agent triggering
      const userMessageCount = existingSession.messages.filter(m => m.role === 'user').length
      this.messageCount.set(existingSession.id, userMessageCount)

      this.sessions.set(existingSession.id, existingSession)
      return existingSession
    }

    // Create new session
    const id = this.generateId()

    const session: DiscoverySession = {
      id,
      projectPath,
      isNewProject,
      messages: [],
      agentStatuses: [],
      createdAt: Date.now()
    }

    // Add initial system message
    session.messages.push({
      id: this.generateId(),
      role: 'system',
      content: `Discovery session started for ${isNewProject ? 'new' : 'existing'} project at: ${projectPath}`,
      timestamp: Date.now()
    })

    this.sessions.set(id, session)

    // Save new session to disk
    await saveSessionToDisk(projectPath, session)

    return session
  }

  /**
   * Start a fresh session, clearing any existing one
   */
  async createFreshSession(projectPath: string, isNewProject: boolean): Promise<DiscoverySession> {
    // Clear existing session from disk
    await clearSessionFromDisk(projectPath)

    // Clear from memory if exists
    for (const [sessionId, session] of this.sessions) {
      if (session.projectPath === projectPath) {
        this.sessions.delete(sessionId)
        this.messageCount.delete(sessionId)
      }
    }

    // Create new session (will not find existing on disk now)
    return this.createSession(projectPath, isNewProject)
  }

  /**
   * Get an existing session
   */
  getSession(sessionId: string): DiscoverySession | null {
    return this.sessions.get(sessionId) || null
  }

  /**
   * Send a message to Claude CLI and stream the response
   */
  async sendMessage(sessionId: string, content: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    // Add user message to history
    const userMessage: DiscoveryChatMessage = {
      id: this.generateId(),
      role: 'user',
      content,
      timestamp: Date.now()
    }
    session.messages.push(userMessage)

    // Track message count for agent triggering
    const count = (this.messageCount.get(sessionId) || 0) + 1
    this.messageCount.set(sessionId, count)

    // Trigger research agents based on conversation progress
    this.triggerResearchAgents(sessionId, session, content, count)

    // Build context from previous messages
    const context = this.buildContext(session)

    // Get Claude CLI path from config and validate
    const claudePath = this.configStore.get('claudeCliPath')
    if (!claudePath || typeof claudePath !== 'string') {
      throw new Error('Claude CLI path not configured')
    }

    // SECURITY: Validate project path
    const isValidPath = await validateProjectPath(session.projectPath)
    if (!isValidPath) {
      throw new Error('Invalid project path')
    }

    // Kill any existing process
    this.killActiveProcess()

    try {
      // Build the prompt with context
      const prompt = this.buildDiscoveryPrompt(session, content)

      // SECURITY: Create minimal safe environment (no credentials)
      const safeEnv = createSafeEnv()

      // Ensure project has clean MCP config with only required servers (supabase, playwright)
      // This creates .mcp.json in project root
      await ensureProjectMcpConfig(session.projectPath)

      // Build path to project MCP config
      const projectMcpConfig = path.join(session.projectPath, '.mcp.json')

      console.log('[DiscoveryChat] Project path:', session.projectPath)
      console.log('[DiscoveryChat] MCP config path:', projectMcpConfig)
      console.log('[DiscoveryChat] Claude CLI path:', claudePath)

      // Spawn Claude CLI with the message
      // Using --print with stream-json for real-time streaming output
      // Using --strict-mcp-config to ONLY use project's .mcp.json, ignoring user's 9+ MCP servers
      // This fixes "tools: Tool names must be unique" error from tool conflicts
      // SECURITY: Input passed via stdin to prevent command injection
      const { command, shellOption } = getSpawnConfig(claudePath)
      const args = [
        '--print',
        '--verbose',
        '--output-format', 'stream-json',
        `--mcp-config=${projectMcpConfig}`,
        '--strict-mcp-config',
        '--dangerously-skip-permissions',  // Auto-approve since user selected project
        '-'
      ]
      console.log('[DiscoveryChat] Spawn command:', command, args)
      console.log('[DiscoveryChat] Spawning Claude CLI now...')

      this.activeProcess = spawn(command, args, {
        cwd: session.projectPath,
        shell: shellOption,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: safeEnv
      })

      // Log spawn event
      this.activeProcess.on('spawn', () => {
        console.log('[DiscoveryChat] Claude CLI process spawned successfully, PID:', this.activeProcess?.pid)
      })

      // Write prompt to stdin to avoid shell injection
      if (this.activeProcess.stdin) {
        console.log('[DiscoveryChat] Writing prompt to stdin, length:', prompt.length)
        this.activeProcess.stdin.write(prompt)
        this.activeProcess.stdin.end()
        console.log('[DiscoveryChat] stdin closed, waiting for response...')
      } else {
        console.error('[DiscoveryChat] No stdin available!')
      }

      let responseContent = ''
      const responseId = this.generateId()
      let jsonBuffer = ''

      // Track current tool for activity panel
      let currentToolName = ''

      // Handle stdout (Claude's streaming JSON response)
      this.activeProcess.stdout?.on('data', (data: Buffer) => {
        jsonBuffer += data.toString()

        // Process complete JSON lines (newline-delimited JSON)
        const lines = jsonBuffer.split('\n')
        jsonBuffer = lines.pop() || '' // Keep incomplete line in buffer

        for (const line of lines) {
          if (!line.trim()) continue

          try {
            const parsed = JSON.parse(line)

            // Debug: log event types to understand the stream
            console.log('[DiscoveryChat] Stream event type:', parsed.type, parsed.event?.type || '')

            // NOTE: Claude CLI outputs 'system', 'assistant', 'user', 'result' types
            // NOT 'stream_event' like the raw Anthropic API
            // See: claude-cli-electron skill for documentation

            if (parsed.type === 'system') {
              // System initialization event - show in activity panel
              const initInfo = parsed.subtype === 'init'
                ? `Initializing... Model: ${parsed.model || 'unknown'}, Tools: ${parsed.tools?.length || 0}`
                : 'System event received'
              this.sendToRenderer(DISCOVERY_CHAT_CHANNELS.RESPONSE_CHUNK, {
                sessionId,
                messageId: responseId,
                chunk: '',
                fullContent: responseContent,
                eventType: 'system',
                toolName: initInfo,
                timestamp: Date.now()
              })
            } else if (parsed.type === 'user') {
              // User message with tool results
              if (parsed.message?.content) {
                for (const block of parsed.message.content) {
                  if (block.type === 'tool_result') {
                    // Tool result - show preview
                    const content = typeof block.content === 'string'
                      ? block.content
                      : JSON.stringify(block.content)
                    const preview = content.substring(0, 300)
                    this.sendToRenderer(DISCOVERY_CHAT_CHANNELS.RESPONSE_CHUNK, {
                      sessionId,
                      messageId: responseId,
                      chunk: `\n📄 Result: ${preview}${content.length > 300 ? '...' : ''}\n`,
                      fullContent: responseContent,
                      eventType: 'tool_result',
                      timestamp: Date.now()
                    })
                  }
                }
              }
            } else if (parsed.type === 'assistant' && parsed.message?.content) {
              // Full message snapshot - extract text and tool usage
              for (const block of parsed.message.content) {
                if (block.type === 'text' && block.text) {
                  // Calculate new content (delta) to stream
                  const newText = block.text
                  if (newText !== responseContent) {
                    // Send the new portion as a chunk
                    const delta = newText.startsWith(responseContent)
                      ? newText.slice(responseContent.length)
                      : newText
                    if (delta) {
                      this.sendToRenderer(DISCOVERY_CHAT_CHANNELS.RESPONSE_CHUNK, {
                        sessionId,
                        messageId: responseId,
                        chunk: delta,
                        fullContent: newText,
                        eventType: 'text',
                        timestamp: Date.now()
                      })
                    }
                    responseContent = newText
                  }
                } else if (block.type === 'tool_use' && block.name) {
                  // Tool usage detected - notify for activity panel
                  // Only emit if this is a new tool (not already tracked)
                  if (block.name !== currentToolName) {
                    // Complete previous tool if any
                    if (currentToolName) {
                      this.sendToRenderer(DISCOVERY_CHAT_CHANNELS.RESPONSE_CHUNK, {
                        sessionId,
                        messageId: responseId,
                        chunk: '',
                        fullContent: responseContent,
                        eventType: 'tool_complete',
                        toolName: currentToolName,
                        timestamp: Date.now()
                      })
                    }
                    // Start new tool
                    currentToolName = block.name
                    this.sendToRenderer(DISCOVERY_CHAT_CHANNELS.RESPONSE_CHUNK, {
                      sessionId,
                      messageId: responseId,
                      chunk: '',
                      fullContent: responseContent,
                      eventType: 'tool_start',
                      toolName: block.name,
                      timestamp: Date.now()
                    })
                  }
                }
              }
            } else if (parsed.type === 'result' && parsed.result) {
              // Final result - stream if different from what we have
              if (typeof parsed.result === 'string' && parsed.result !== responseContent) {
                const delta = parsed.result.startsWith(responseContent)
                  ? parsed.result.slice(responseContent.length)
                  : parsed.result
                if (delta) {
                  this.sendToRenderer(DISCOVERY_CHAT_CHANNELS.RESPONSE_CHUNK, {
                    sessionId,
                    messageId: responseId,
                    chunk: delta,
                    fullContent: parsed.result,
                    eventType: 'text',
                    timestamp: Date.now()
                  })
                }
                responseContent = parsed.result
              }
            }
          } catch {
            // Not valid JSON, might be partial - ignore
          }
        }
      })

      // Handle stderr (errors or debug info)
      this.activeProcess.stderr?.on('data', (data: Buffer) => {
        const stderrStr = data.toString()
        console.error('[DiscoveryChat] Claude stderr:', stderrStr)
        // Send stderr to renderer for debugging
        this.sendToRenderer(DISCOVERY_CHAT_CHANNELS.RESPONSE_CHUNK, {
          sessionId,
          messageId: responseId,
          chunk: `\n⚠️ ${stderrStr}\n`,
          fullContent: responseContent,
          eventType: 'stderr',
          timestamp: Date.now()
        })
      })

      // Handle process completion
      this.activeProcess.on('close', async (code) => {
        this.activeProcess = null
        console.log('[DiscoveryChat] Process closed with code:', code, 'responseContent length:', responseContent.length)

        // Success if we have response content (code can be 0 or null for signal termination)
        if (responseContent.trim()) {
          // Add assistant response to history
          const assistantMessage: DiscoveryChatMessage = {
            id: responseId,
            role: 'assistant',
            content: responseContent.trim(),
            timestamp: Date.now()
          }
          session.messages.push(assistantMessage)

          // Save session to disk after each exchange
          try {
            await saveSessionToDisk(session.projectPath, session)
            console.log('[DiscoveryChat] Session saved after message exchange')
          } catch (saveError) {
            console.error('[DiscoveryChat] Failed to save session:', saveError)
          }

          // Send completion event
          this.sendToRenderer(DISCOVERY_CHAT_CHANNELS.RESPONSE_COMPLETE, {
            sessionId,
            message: assistantMessage
          })
        } else if (code !== 0 && code !== null) {
          // Only send error if we have no content AND non-zero exit code
          this.sendToRenderer(DISCOVERY_CHAT_CHANNELS.ERROR, {
            sessionId,
            error: `Claude process exited with code ${code}`
          })
        } else {
          // Process ended but no content - might be cancelled or empty response
          console.log('[DiscoveryChat] Process ended with no response content')
          this.sendToRenderer(DISCOVERY_CHAT_CHANNELS.RESPONSE_COMPLETE, {
            sessionId,
            message: null
          })
        }
      })

      this.activeProcess.on('error', (error) => {
        this.activeProcess = null
        this.sendToRenderer(DISCOVERY_CHAT_CHANNELS.ERROR, {
          sessionId,
          error: error.message
        })
      })

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      this.sendToRenderer(DISCOVERY_CHAT_CHANNELS.ERROR, {
        sessionId,
        error: message
      })
    }
  }

  /**
   * Update agent status
   */
  updateAgentStatus(sessionId: string, agentName: string, status: DiscoveryAgentStatus['status'], output?: string, error?: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return

    const existingIndex = session.agentStatuses.findIndex(a => a.name === agentName)
    const newStatus: DiscoveryAgentStatus = { name: agentName, status, output, error }

    if (existingIndex >= 0) {
      session.agentStatuses[existingIndex] = newStatus
    } else {
      session.agentStatuses.push(newStatus)
    }

    // Notify renderer
    this.sendToRenderer(DISCOVERY_CHAT_CHANNELS.AGENT_STATUS, {
      sessionId,
      agent: newStatus
    })
  }

  /**
   * Cancel active request
   */
  cancelRequest(): void {
    this.killActiveProcess()
  }

  /**
   * Close a session
   */
  closeSession(sessionId: string): void {
    this.sessions.delete(sessionId)
    if (this.activeProcess) {
      this.killActiveProcess()
    }
  }

  /**
   * Get all messages for a session
   */
  getMessages(sessionId: string): DiscoveryChatMessage[] {
    const session = this.sessions.get(sessionId)
    return session?.messages || []
  }

  /**
   * Cleanup all sessions and agents
   */
  cleanup(): void {
    // Cancel all active processes
    this.killActiveProcess()

    // Cancel all research agent tasks
    for (const sessionId of this.sessions.keys()) {
      this.researchRunner.cancelSessionTasks(sessionId)
    }

    // Clear all data
    this.sessions.clear()
    this.messageCount.clear()
    this.researchRunner.cleanup()
  }

  /**
   * Trigger research agents based on conversation progress
   * FEAT-020: Process Agent - runs on first user message
   * FEAT-021: Codebase Analyzer - runs on second message for existing projects
   * FEAT-022: Spec Builder - runs when user has provided enough context (3+ messages)
   */
  private triggerResearchAgents(
    sessionId: string,
    session: DiscoverySession,
    userMessage: string,
    messageCount: number
  ): void {
    const context = this.buildContext(session)

    // Process Agent: Run on first message to extract initial requirements
    if (messageCount === 1) {
      this.researchRunner.runAgent(
        'process',
        sessionId,
        session.projectPath,
        userMessage
      ).catch(err => {
        console.error('[DiscoveryChat] Process agent error:', err)
      })
    }

    // Codebase Analyzer: Run on second message for existing projects
    if (messageCount === 2 && !session.isNewProject) {
      this.researchRunner.runAgent(
        'codebase',
        sessionId,
        session.projectPath,
        `Analyze the codebase to understand patterns for: ${userMessage}`
      ).catch(err => {
        console.error('[DiscoveryChat] Codebase analyzer error:', err)
      })
    }

    // Spec Builder: Run after 3+ messages when enough context is gathered
    if (messageCount >= 3) {
      // Only run if not already running
      const existingTasks = this.researchRunner.getSessionTasks(sessionId)
      const specTask = existingTasks.find(t => t.type === 'spec-builder')
      if (!specTask || specTask.result?.status === 'complete' || specTask.result?.status === 'error') {
        this.researchRunner.runAgent(
          'spec-builder',
          sessionId,
          session.projectPath,
          context
        ).catch(err => {
          console.error('[DiscoveryChat] Spec builder error:', err)
        })
      }
    }
  }

  // Private helpers

  /**
   * Generate cryptographically secure ID
   */
  private generateId(): string {
    return `${Date.now()}-${randomBytes(4).toString('hex')}`
  }

  private killActiveProcess(): void {
    if (this.activeProcess) {
      this.activeProcess.kill('SIGTERM')
      this.activeProcess = null
    }
  }

  private buildContext(session: DiscoverySession): string {
    // Build conversation context from message history
    return session.messages
      .map(m => `${m.role}: ${m.content}`)
      .join('\n\n')
  }

  private buildDiscoveryPrompt(session: DiscoverySession, userMessage: string): string {
    const isNew = session.isNewProject

    // HEAVY SPEC Discovery Prompts
    // Goal: Extract EVERYTHING needed for "dumb worker" execution agents
    // CRITICAL: Added explicit STOP instructions to prevent auto-generating user responses
    const baseInstructions = `
IMPORTANT INTERACTION RULES:
- This is a SINGLE-TURN interaction. You respond ONCE, then STOP.
- NEVER generate fake user responses or continue the conversation.
- NEVER write "user:" or simulate what the user might say.
- Ask your questions, then STOP and WAIT for the actual user to respond.
- Each of your responses should end with your questions - nothing more.`

    const systemPrompt = isNew
      ? `You are a HEAVY SPEC discovery assistant helping plan a new software project.

CRITICAL: After discovery, execution will be done by "dumb worker" agents with NO decision-making ability.
You MUST extract EVERY detail now. If it's not captured here, it won't be implemented.
${baseInstructions}

Ask EXHAUSTIVE clarifying questions about:
1. FEATURES - Every feature broken into atomic, testable units
2. TECHNOLOGY - Exact frameworks, libraries, versions (or let user know you'll pick sensible defaults)
3. USER EXPERIENCE - Every screen, interaction, error state, loading state
4. DATA - What data is stored, how it flows, validation rules
5. EDGE CASES - What happens when things go wrong? Network errors? Invalid input?
6. SECURITY - Authentication, authorization, data protection
7. PERFORMANCE - Expected load, response time requirements
8. ACCEPTANCE CRITERIA - How do we know each feature is complete?

Be thorough. Ask ONE focused question set at a time (3-5 related questions max).
Dig deep on each answer before moving to the next topic.
Your goal is to make the specification SO COMPLETE that a junior developer could implement it.

Remember: Respond ONCE with your questions, then STOP. Do not simulate user answers.`
      : `You are a HEAVY SPEC discovery assistant for an existing codebase at: ${session.projectPath}

CRITICAL: After discovery, execution will be done by "dumb worker" agents with NO decision-making ability.
They will follow existing patterns EXACTLY. You MUST capture every detail now.
${baseInstructions}

Ask EXHAUSTIVE clarifying questions about:
1. SPECIFIC CHANGES - What exactly needs to be added or modified?
2. EXISTING PATTERNS - How do similar features work in this codebase?
3. INTEGRATION POINTS - What existing code will this interact with?
4. DATA CHANGES - Any new models, fields, migrations needed?
5. UI CHANGES - New components? Modifications to existing ones?
6. API CHANGES - New endpoints? Changes to existing ones?
7. TESTING - What tests need to be written?
8. EDGE CASES - Error handling, validation, boundary conditions

Be thorough. Ask ONE focused question set at a time (3-5 related questions max).
Reference specific files/patterns from the codebase when possible.
The spec must be detailed enough that no judgment calls are needed during implementation.

Remember: Respond ONCE with your questions, then STOP. Do not simulate user answers.`

    // Build full prompt with context - use clear delimiters to avoid role confusion
    const context = this.buildContext(session)
    const contextSection = context.trim()
      ? `\n<conversation_history>\n${context}\n</conversation_history>\n`
      : ''

    return `${systemPrompt}
${contextSection}
<current_user_message>
${userMessage}
</current_user_message>

Respond as the assistant with your questions. STOP after your response - do not generate any user messages.`
  }

  private sendToRenderer(channel: string, data: unknown): void {
    const mainWindow = getMainWindow()
    if (mainWindow) {
      mainWindow.webContents.send(channel, data)
    }
  }
}
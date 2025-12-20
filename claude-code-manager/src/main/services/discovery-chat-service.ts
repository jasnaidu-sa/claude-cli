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
import { analyzeComplexity } from './complexity-analyzer'
import type { ComplexityAnalysis } from '../../shared/types'

/**
 * MCP servers for research agents (NOT discovery chat)
 * Discovery chat is conversation-only, no MCP tools
 * Research agents use MCP for codebase exploration
 * OPTIMIZATION: Use --prefer-offline and --no-install to avoid re-downloading
 */
const RESEARCH_AGENT_MCP_CONFIG = {
  mcpServers: {
    // Playwright for browser testing - cached npx for faster startup
    playwright: {
      command: 'npx',
      args: ['--prefer-offline', '@anthropic-ai/mcp-server-playwright']
    }
  }
}

/**
 * Empty MCP config for discovery chat (conversation only)
 * Discovery phase is pure Q&A - Claude asks questions, user answers
 * No tools to prevent Claude from doing implementation work during discovery
 */
const EMPTY_MCP_CONFIG = {
  mcpServers: {}
}

/**
 * Ensure project has MCP config for autonomous mode
 *
 * Two modes:
 * 1. Discovery Chat (forDiscovery=true): EMPTY config - conversation only, no tools
 *    This prevents Claude from using tools during discovery, keeping responses fast
 *
 * 2. Research Agents (forDiscovery=false): Full config with Playwright etc.
 *    Research agents need MCP tools to explore the codebase
 *
 * Per Claude Code docs: Project-level .mcp.json takes precedence over user config
 */
async function ensureProjectMcpConfig(projectPath: string, forDiscovery: boolean = true): Promise<string> {
  // Use different config files for discovery vs research
  const configFileName = forDiscovery ? '.mcp-discovery.json' : '.mcp.json'
  const mcpConfigPath = path.join(projectPath, configFileName)

  const config = forDiscovery ? EMPTY_MCP_CONFIG : RESEARCH_AGENT_MCP_CONFIG

  try {
    // Check if config already exists with correct content
    const existingContent = await fs.readFile(mcpConfigPath, 'utf-8')
    const existing = JSON.parse(existingContent)

    // For discovery, we want empty config (no servers)
    if (forDiscovery) {
      const existingServerCount = Object.keys(existing.mcpServers || {}).length
      if (existingServerCount === 0) {
        console.log('[DiscoveryChat] Discovery MCP config already empty (no tools)')
        return mcpConfigPath
      }
      // Config has servers but we want empty - recreate
      console.log('[DiscoveryChat] Recreating empty discovery MCP config')
    } else {
      // For research agents, check if it has required servers
      const hasPlaywright = existing.mcpServers?.playwright
      if (hasPlaywright) {
        console.log('[DiscoveryChat] Research MCP config already has required servers')
        return mcpConfigPath
      }
      // Merge with existing
      const merged = {
        mcpServers: {
          ...existing.mcpServers,
          ...config.mcpServers
        }
      }
      await fs.writeFile(mcpConfigPath, JSON.stringify(merged, null, 2))
      console.log('[DiscoveryChat] Updated research MCP config with required servers')
      return mcpConfigPath
    }
  } catch {
    // No existing config - create new one
  }

  await fs.writeFile(mcpConfigPath, JSON.stringify(config, null, 2))
  console.log(`[DiscoveryChat] Created ${forDiscovery ? 'empty discovery' : 'research'} MCP config`)
  return mcpConfigPath
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
    // Windows app data paths (needed for Claude CLI to find OAuth credentials)
    'APPDATA', 'LOCALAPPDATA',
    // XDG paths (Linux/Mac OAuth credential storage)
    'XDG_CONFIG_HOME', 'XDG_DATA_HOME',
    // Locale
    'LANG', 'LC_ALL', 'SHELL',
    // Claude CLI authentication (API key or OAuth)
    'ANTHROPIC_API_KEY', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX',
    // Node.js
    'NODE_ENV', 'npm_config_prefix',
    // System
    'SystemRoot', 'COMSPEC',
    // Terminal (some CLIs need this)
    'TERM', 'COLORTERM'
  ]
  const safeEnv: NodeJS.ProcessEnv = {
    // NOTE: Not setting CI=true as it may interfere with OAuth auth flow
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
const SUMMARY_FILE = 'conversation-summary.md'
const DRAFTS_DIR = 'drafts'
const DRAFT_INDEX_FILE = 'drafts-index.json'

// Draft metadata for timeline view
export interface DraftMetadata {
  id: string
  name: string  // Auto-generated or user-provided name
  description: string  // Brief description of what was discussed
  createdAt: number
  updatedAt: number
  messageCount: number
  userMessageCount: number
  assistantMessageCount: number
  discoveryReady: boolean
  isNewProject: boolean
  // First user message as preview
  preview: string
}

// Context window management constants
// To avoid O(n²) token usage, we keep a running summary + last N messages
const MAX_RECENT_MESSAGES = 6  // Number of recent messages to include verbatim
const SUMMARY_TRIGGER_THRESHOLD = 10  // Generate summary when messages exceed this

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
    updatedAt: Date.now(),
    // Context management fields
    runningSummary: session.runningSummary,
    lastSummarizedIndex: session.lastSummarizedIndex,
    // Discovery status
    discoveryReady: session.discoveryReady
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
      createdAt: data.createdAt,
      // Context management fields
      runningSummary: data.runningSummary,
      lastSummarizedIndex: data.lastSummarizedIndex,
      // Discovery status
      discoveryReady: data.discoveryReady
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
 * Save complexity analysis to disk
 * Saves to: project/.autonomous/complexity.json
 */
async function saveComplexityToDisk(
  projectPath: string,
  analysis: ComplexityAnalysis
): Promise<string> {
  const autonomousPath = await ensureAutonomousDir(projectPath)
  const complexityPath = path.join(autonomousPath, 'complexity.json')

  await fs.writeFile(complexityPath, JSON.stringify(analysis, null, 2))
  console.log('[DiscoveryChat] Complexity analysis saved:', complexityPath)
  console.log('[DiscoveryChat] Complexity level:', analysis.level, 'Score:', analysis.score)
  return complexityPath
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
 * Optionally archive to drafts first
 */
async function clearSessionFromDisk(projectPath: string, archiveToDrafts: boolean = true): Promise<void> {
  const sessionPath = path.join(projectPath, AUTONOMOUS_DIR, SESSION_FILE)

  try {
    // If archiving, save current session to drafts first
    if (archiveToDrafts) {
      const existingSession = await loadSessionFromDisk(projectPath)
      if (existingSession && existingSession.messages.length > 1) {
        await saveDraftToDisk(projectPath, existingSession)
        console.log('[DiscoveryChat] Archived session to drafts before clearing')
      }
    }

    await fs.unlink(sessionPath)
    console.log('[DiscoveryChat] Session cleared from disk')
  } catch {
    // File might not exist
  }
}

/**
 * Save a session as a draft
 * Drafts are stored in: project/.autonomous/drafts/{draft-id}/
 * Each draft folder contains: session.json, spec.md (if generated)
 */
async function saveDraftToDisk(projectPath: string, session: DiscoverySession): Promise<DraftMetadata> {
  const autonomousPath = await ensureAutonomousDir(projectPath)
  const draftsDir = path.join(autonomousPath, DRAFTS_DIR)

  // Ensure drafts directory exists
  try {
    await fs.mkdir(draftsDir, { recursive: true })
  } catch {
    // Directory might already exist
  }

  // Generate draft ID and folder
  const draftId = `draft-${Date.now()}`
  const draftDir = path.join(draftsDir, draftId)
  await fs.mkdir(draftDir, { recursive: true })

  // Extract metadata from session
  const userMessages = session.messages.filter(m => m.role === 'user')
  const assistantMessages = session.messages.filter(m => m.role === 'assistant')

  // Generate name from first user message
  const firstUserMessage = userMessages[0]?.content || ''
  const name = generateDraftName(firstUserMessage)

  // Generate description from conversation
  const description = generateDraftDescription(session.messages)

  // Create metadata
  const metadata: DraftMetadata = {
    id: draftId,
    name,
    description,
    createdAt: session.createdAt,
    updatedAt: Date.now(),
    messageCount: session.messages.length,
    userMessageCount: userMessages.length,
    assistantMessageCount: assistantMessages.length,
    discoveryReady: session.discoveryReady || false,
    isNewProject: session.isNewProject,
    preview: firstUserMessage.substring(0, 200)
  }

  // Save session data
  const sessionData = {
    ...session,
    id: draftId,
    metadata
  }
  await fs.writeFile(
    path.join(draftDir, SESSION_FILE),
    JSON.stringify(sessionData, null, 2)
  )

  // Copy spec if it exists
  const specPath = path.join(autonomousPath, SPEC_FILE)
  try {
    const specContent = await fs.readFile(specPath, 'utf-8')
    await fs.writeFile(path.join(draftDir, SPEC_FILE), specContent)
  } catch {
    // No spec file to copy
  }

  // Update drafts index
  await updateDraftsIndex(projectPath, metadata)

  console.log('[DiscoveryChat] Draft saved:', draftId)
  return metadata
}

/**
 * Generate a name for a draft based on the first user message
 */
function generateDraftName(firstMessage: string): string {
  if (!firstMessage) return 'Untitled Draft'

  // Extract first sentence or first 50 chars
  const firstSentence = firstMessage.split(/[.!?]/)[0]
  const trimmed = firstSentence.substring(0, 50).trim()

  return trimmed.length < firstSentence.length ? trimmed + '...' : trimmed
}

/**
 * Generate a description summarizing the conversation
 */
function generateDraftDescription(messages: DiscoveryChatMessage[]): string {
  const userMessages = messages.filter(m => m.role === 'user')

  if (userMessages.length === 0) return 'Empty conversation'
  if (userMessages.length === 1) return 'Initial requirements captured'

  // Count topics discussed (simple heuristic)
  const topics: string[] = []
  for (const msg of userMessages) {
    const content = msg.content.toLowerCase()
    if (content.includes('feature') || content.includes('want')) topics.push('features')
    if (content.includes('ui') || content.includes('design') || content.includes('look')) topics.push('UI/design')
    if (content.includes('data') || content.includes('model') || content.includes('database')) topics.push('data model')
    if (content.includes('api') || content.includes('endpoint')) topics.push('API')
    if (content.includes('test') || content.includes('error')) topics.push('testing')
  }

  const uniqueTopics = [...new Set(topics)]
  if (uniqueTopics.length > 0) {
    return `Discussed: ${uniqueTopics.slice(0, 3).join(', ')}`
  }

  return `${userMessages.length} exchanges captured`
}

/**
 * Update the drafts index file
 */
async function updateDraftsIndex(projectPath: string, newDraft: DraftMetadata): Promise<void> {
  const autonomousPath = path.join(projectPath, AUTONOMOUS_DIR)
  const indexPath = path.join(autonomousPath, DRAFT_INDEX_FILE)

  let drafts: DraftMetadata[] = []

  // Load existing index
  try {
    const content = await fs.readFile(indexPath, 'utf-8')
    drafts = JSON.parse(content)
  } catch {
    // No existing index
  }

  // Add new draft (most recent first)
  drafts.unshift(newDraft)

  // Limit to 20 most recent drafts
  drafts = drafts.slice(0, 20)

  // Save updated index
  await fs.writeFile(indexPath, JSON.stringify(drafts, null, 2))
}

/**
 * List all drafts for a project
 */
async function listDrafts(projectPath: string): Promise<DraftMetadata[]> {
  const indexPath = path.join(projectPath, AUTONOMOUS_DIR, DRAFT_INDEX_FILE)

  try {
    const content = await fs.readFile(indexPath, 'utf-8')
    const drafts = JSON.parse(content) as DraftMetadata[]
    return drafts.sort((a, b) => b.updatedAt - a.updatedAt)
  } catch {
    // No drafts exist - check for legacy session and convert
    const existingSession = await loadSessionFromDisk(projectPath)
    if (existingSession && existingSession.messages.length > 1) {
      // Convert existing session to draft for display
      const userMessages = existingSession.messages.filter(m => m.role === 'user')
      const assistantMessages = existingSession.messages.filter(m => m.role === 'assistant')
      const firstUserMessage = userMessages[0]?.content || ''

      const legacyDraft: DraftMetadata = {
        id: 'current',
        name: generateDraftName(firstUserMessage),
        description: generateDraftDescription(existingSession.messages),
        createdAt: existingSession.createdAt,
        updatedAt: Date.now(),
        messageCount: existingSession.messages.length,
        userMessageCount: userMessages.length,
        assistantMessageCount: assistantMessages.length,
        discoveryReady: existingSession.discoveryReady || false,
        isNewProject: existingSession.isNewProject,
        preview: firstUserMessage.substring(0, 200)
      }

      return [legacyDraft]
    }

    return []
  }
}

/**
 * Load a specific draft by ID
 */
async function loadDraft(projectPath: string, draftId: string): Promise<DiscoverySession | null> {
  // Handle 'current' as the active session
  if (draftId === 'current') {
    return loadSessionFromDisk(projectPath)
  }

  const draftDir = path.join(projectPath, AUTONOMOUS_DIR, DRAFTS_DIR, draftId)
  const sessionPath = path.join(draftDir, SESSION_FILE)

  try {
    const content = await fs.readFile(sessionPath, 'utf-8')
    const data = JSON.parse(content)

    return {
      id: data.id,
      projectPath: data.projectPath,
      isNewProject: data.isNewProject,
      messages: data.messages || [],
      agentStatuses: data.agentStatuses || [],
      createdAt: data.createdAt,
      runningSummary: data.runningSummary,
      lastSummarizedIndex: data.lastSummarizedIndex,
      discoveryReady: data.discoveryReady
    }
  } catch {
    return null
  }
}

/**
 * Delete a draft
 */
async function deleteDraft(projectPath: string, draftId: string): Promise<boolean> {
  if (draftId === 'current') {
    await clearSessionFromDisk(projectPath, false) // Don't archive when explicitly deleting
    return true
  }

  const draftDir = path.join(projectPath, AUTONOMOUS_DIR, DRAFTS_DIR, draftId)

  try {
    // Remove draft directory
    await fs.rm(draftDir, { recursive: true })

    // Update index
    const indexPath = path.join(projectPath, AUTONOMOUS_DIR, DRAFT_INDEX_FILE)
    try {
      const content = await fs.readFile(indexPath, 'utf-8')
      let drafts = JSON.parse(content) as DraftMetadata[]
      drafts = drafts.filter(d => d.id !== draftId)
      await fs.writeFile(indexPath, JSON.stringify(drafts, null, 2))
    } catch {
      // Index might not exist
    }

    return true
  } catch {
    return false
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
  // Running summary of older messages (generated after SUMMARY_TRIGGER_THRESHOLD)
  runningSummary?: string
  // Index of last message included in the summary
  lastSummarizedIndex?: number
  // Flag indicating discovery is ready for spec generation
  discoveryReady?: boolean
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
export { saveSpecToDisk, loadSessionFromDisk, clearSessionFromDisk, listDrafts, loadDraft, deleteDraft, saveDraftToDisk }

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

      // Ensure project has EMPTY MCP config for discovery chat (conversation only)
      // This creates .mcp-discovery.json with NO servers - pure Q&A, no tools
      // Discovery chat should ask questions, not use tools to explore/implement
      const projectMcpConfig = await ensureProjectMcpConfig(session.projectPath, true)

      console.log('[DiscoveryChat] Project path:', session.projectPath)
      console.log('[DiscoveryChat] MCP config path:', projectMcpConfig)
      console.log('[DiscoveryChat] Claude CLI path:', claudePath)

      // Generate response ID for tracking
      const responseId = this.generateId()

      // STEP 1: Send system message to UI - Starting
      this.sendToRenderer(DISCOVERY_CHAT_CHANNELS.RESPONSE_CHUNK, {
        sessionId,
        messageId: responseId,
        chunk: '🔍 Starting Claude CLI...\n',
        fullContent: '',
        eventType: 'system',
        timestamp: Date.now()
      })

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
        '--include-partial-messages',  // CRITICAL: Get incremental text chunks!
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

        // STEP 1: Send system message to UI - Process started
        this.sendToRenderer(DISCOVERY_CHAT_CHANNELS.RESPONSE_CHUNK, {
          sessionId,
          messageId: responseId,
          chunk: `✓ Claude CLI started (PID: ${this.activeProcess?.pid})\n`,
          fullContent: '',
          eventType: 'system',
          timestamp: Date.now()
        })
      })

      // Write prompt to stdin to avoid shell injection
      if (this.activeProcess.stdin) {
        console.log('[DiscoveryChat] Writing prompt to stdin, length:', prompt.length)
        this.activeProcess.stdin.write(prompt)
        this.activeProcess.stdin.end()
        console.log('[DiscoveryChat] stdin closed, waiting for response...')

        // STEP 1: Send system message to UI - Waiting for response
        this.sendToRenderer(DISCOVERY_CHAT_CHANNELS.RESPONSE_CHUNK, {
          sessionId,
          messageId: responseId,
          chunk: '⏳ Waiting for response...\n',
          fullContent: '',
          eventType: 'system',
          timestamp: Date.now()
        })
      } else {
        console.error('[DiscoveryChat] No stdin available!')

        // STEP 1: Send error to UI
        this.sendToRenderer(DISCOVERY_CHAT_CHANNELS.RESPONSE_CHUNK, {
          sessionId,
          messageId: responseId,
          chunk: '❌ ERROR: No stdin available!\n',
          fullContent: '',
          eventType: 'stderr',
          timestamp: Date.now()
        })
      }

      let responseContent = ''
      let jsonBuffer = ''

      // Track current tool for activity panel
      let currentToolName = ''

      // Track if we've received first event
      let firstEventReceived = false

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

            // STEP 1: Send system message on first event
            if (!firstEventReceived) {
              firstEventReceived = true
              this.sendToRenderer(DISCOVERY_CHAT_CHANNELS.RESPONSE_CHUNK, {
                sessionId,
                messageId: responseId,
                chunk: '📡 Receiving response...\n',
                fullContent: '',
                eventType: 'system',
                timestamp: Date.now()
              })
            }

            // Handle stream events from --include-partial-messages
            // These are the REAL-TIME incremental chunks we want!
            if (parsed.type === 'stream_event' && parsed.event) {
              const event = parsed.event

              if (event.type === 'content_block_delta' && event.delta?.text) {
                // INCREMENTAL TEXT DELTA - This is word-by-word streaming!
                const delta = event.delta.text
                responseContent += delta

                this.sendToRenderer(DISCOVERY_CHAT_CHANNELS.RESPONSE_CHUNK, {
                  sessionId,
                  messageId: responseId,
                  chunk: delta,
                  fullContent: responseContent,
                  eventType: 'text',
                  timestamp: Date.now()
                })
              }
              // Other stream events (content_block_start, content_block_stop, message_delta, message_stop)
              // are handled implicitly - we just care about the text deltas
            }
            // NOTE: Claude CLI outputs 'system', 'assistant', 'user', 'result' types
            // WITH --include-partial-messages, we also get 'stream_event' types
            // See: claude-cli-electron skill for documentation

            else if (parsed.type === 'system') {
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

          // Check for discovery ready marker
          if (responseContent.includes('[DISCOVERY_READY]')) {
            session.discoveryReady = true
            console.log('[DiscoveryChat] Discovery marked as ready')
          }

          // Generate summary if needed (for context window management)
          try {
            await this.maybeGenerateSummary(session)
          } catch (summaryError) {
            console.error('[DiscoveryChat] Failed to generate summary:', summaryError)
          }

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
   *
   * STEP 2: DISABLED for simplified discovery flow
   * Research agents now run on-demand via generateSmartSpec() instead of automatically
   * This makes Discovery instant and reduces token usage for simple tasks
   *
   * OLD BEHAVIOR (commented out):
   * - FEAT-020: Process Agent - runs on first user message
   * - FEAT-021: Codebase Analyzer - runs on second message for existing projects
   * - FEAT-022: Spec Builder - runs when user has provided enough context (3+ messages)
   */
  private triggerResearchAgents(
    sessionId: string,
    session: DiscoverySession,
    userMessage: string,
    messageCount: number
  ): void {
    // STEP 2: Disabled automatic agent triggers
    // Agents now run only when user explicitly requests Smart Spec generation
    return

    /* OLD CODE - agents run automatically (DISABLED)
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
    */
    // END OLD CODE
  }

  /**
   * STEP 4: Generate Quick Spec (fast, conversation-only)
   * Uses conversation history and .schema/ files (if exist)
   * No codebase scanning - fast for simple tasks
   */
  async generateQuickSpec(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    // Check if enough conversation happened
    if (session.messages.length < 3) {
      throw new Error('Need at least 3 messages before generating spec')
    }

    // Notify UI that spec generation started
    this.sendToRenderer(DISCOVERY_CHAT_CHANNELS.RESPONSE_CHUNK, {
      sessionId,
      messageId: this.generateId(),
      chunk: '🚀 Generating Quick Spec from conversation...\n',
      fullContent: '',
      eventType: 'system',
      timestamp: Date.now()
    })

    // Build context from conversation
    const conversation = this.buildContext(session)

    // Check if .schema/ exists
    const schemaPath = path.join(session.projectPath, '.schema')
    let hasSchema = false
    try {
      const stats = await fs.stat(schemaPath)
      hasSchema = stats.isDirectory()
    } catch {
      hasSchema = false
    }

    // Build prompt for spec generation
    // IMPORTANT: Tell Claude to output spec directly WITHOUT using tools
    const prompt = hasSchema
      ? `Based on this conversation, generate a detailed specification document.

IMPORTANT: Output the spec DIRECTLY in your response. Do NOT use any tools (Read, Write, Edit, Bash, etc.). Just write the markdown content directly.

${conversation}

The project has .schema/ documentation available. Consider existing architecture patterns when generating the spec.

Generate a spec in markdown format with these sections:
# Feature Specification

## Overview
Brief description of what needs to be built.

## Requirements
- Functional requirements from conversation
- Technical constraints mentioned

## Architecture
- How this fits into existing codebase
- Key components to create/modify

## Implementation Steps
1. Numbered steps for implementation
2. Include file paths and key changes

## Testing
- How to verify the feature works

Remember: Output the full spec directly. Do NOT use any tools.`
      : `Based on this conversation, generate a detailed specification document.

IMPORTANT: Output the spec DIRECTLY in your response. Do NOT use any tools (Read, Write, Edit, Bash, etc.). Just write the markdown content directly.

${conversation}

Generate a spec in markdown format with these sections:
# Feature Specification

## Overview
Brief description of what needs to be built.

## Requirements
- Functional requirements from conversation
- Technical constraints mentioned

## Implementation Steps
1. Numbered steps for implementation
2. Include key components to create

## Testing
- How to verify the feature works

Remember: Output the full spec directly. Do NOT use any tools.`

    try {
      // Get Claude CLI path
      const claudePath = this.configStore.get('claudeCliPath')
      if (!claudePath || typeof claudePath !== 'string') {
        throw new Error('Claude CLI path not configured')
      }

      console.log('[QuickSpec] Starting Claude CLI process')
      console.log('[QuickSpec] Claude path:', claudePath)

      // Use empty MCP config (no tools needed for spec generation)
      const projectMcpConfig = await ensureProjectMcpConfig(session.projectPath, true)

      // Spawn Claude CLI to generate spec
      const { command, shellOption } = getSpawnConfig(claudePath)
      const args = [
        '--print',
        '--verbose',  // Required when using --output-format=stream-json with --print
        '--output-format', 'stream-json',
        '--include-partial-messages',  // CRITICAL: Get real-time streaming text deltas!
        `--mcp-config=${projectMcpConfig}`,
        '--strict-mcp-config',
        '--dangerously-skip-permissions',
        '-'
      ]

      console.log('[QuickSpec] Spawn command:', command)
      console.log('[QuickSpec] Spawn args:', args.join(' '))

      const process = spawn(command, args, {
        cwd: session.projectPath,
        shell: shellOption,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: createSafeEnv()
      })

      console.log('[QuickSpec] Process spawned with PID:', process.pid)

      // Write prompt
      if (process.stdin) {
        process.stdin.write(prompt)
        process.stdin.end()
        console.log('[QuickSpec] Prompt written to stdin, length:', prompt.length)
      }

      let specContent = ''
      let jsonBuffer = ''
      let stderrOutput = ''
      const responseId = this.generateId()
      let lastStreamedLength = 0 // Track what we've already streamed

      // Collect stderr for debugging
      process.stderr?.on('data', (data: Buffer) => {
        const text = data.toString()
        stderrOutput += text
        console.log('[QuickSpec] stderr chunk:', text.substring(0, 200))
      })

      // Debug: log when stdout receives data
      let stdoutChunkCount = 0

      // Collect response and stream to UI
      process.stdout?.on('data', (data: Buffer) => {
        stdoutChunkCount++
        const chunk = data.toString()
        console.log(`[QuickSpec] stdout chunk #${stdoutChunkCount}, length:`, chunk.length)
        jsonBuffer += chunk
        const lines = jsonBuffer.split('\n')
        jsonBuffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const parsed = JSON.parse(line)

            // Debug: log parsed JSON types (only log type, subtype for brevity)
            const subtype = parsed.subtype || parsed.event?.type || ''
            console.log('[QuickSpec] Parsed JSON type:', parsed.type, subtype ? `(${subtype})` : '')

            // WITH --include-partial-messages, we get 'stream_event' with content_block_delta
            // This is TRUE real-time streaming - word by word!
            if (parsed.type === 'stream_event' && parsed.event?.type === 'content_block_delta') {
              const delta = parsed.event.delta?.text
              if (delta) {
                specContent += delta
                this.sendToRenderer(DISCOVERY_CHAT_CHANNELS.RESPONSE_CHUNK, {
                  sessionId,
                  messageId: responseId,
                  chunk: delta,
                  fullContent: specContent,
                  eventType: 'content',
                  timestamp: Date.now()
                })
              }
            }
            // Also handle complete 'assistant' messages (fallback if partial messages not available)
            else if (parsed.type === 'assistant' && parsed.message?.content) {
              for (const block of parsed.message.content) {
                if (block.type === 'text' && block.text) {
                  const newText = block.text
                  // Calculate delta (new content since last stream)
                  if (newText.length > lastStreamedLength) {
                    const delta = newText.slice(lastStreamedLength)
                    console.log('[QuickSpec] Streaming assistant delta, length:', delta.length)

                    // Stream the new content to UI
                    this.sendToRenderer(DISCOVERY_CHAT_CHANNELS.RESPONSE_CHUNK, {
                      sessionId,
                      messageId: responseId,
                      chunk: delta,
                      fullContent: newText,
                      eventType: 'content',
                      timestamp: Date.now()
                    })

                    lastStreamedLength = newText.length
                  }
                  specContent = newText
                }
              }
            } else if (parsed.type === 'result' && parsed.result) {
              // Final result - update specContent (already streamed via deltas)
              const result = typeof parsed.result === 'string' ? parsed.result : JSON.stringify(parsed.result)
              // Only stream if we haven't already via deltas
              if (result.length > specContent.length) {
                const delta = result.slice(specContent.length)
                console.log('[QuickSpec] Streaming result delta, length:', delta.length)

                this.sendToRenderer(DISCOVERY_CHAT_CHANNELS.RESPONSE_CHUNK, {
                  sessionId,
                  messageId: responseId,
                  chunk: delta,
                  fullContent: result,
                  eventType: 'content',
                  timestamp: Date.now()
                })
              }
              specContent = result
            } else if (parsed.type === 'system') {
              // System messages - show initialization info
              if (parsed.subtype === 'init') {
                this.sendToRenderer(DISCOVERY_CHAT_CHANNELS.RESPONSE_CHUNK, {
                  sessionId,
                  messageId: responseId,
                  chunk: `📊 Model: ${parsed.model || 'claude'}\n`,
                  fullContent: '',
                  eventType: 'system',
                  timestamp: Date.now()
                })
              }
            }
          } catch {
            // Ignore parse errors
          }
        }
      })

      // Wait for completion
      await new Promise<void>((resolve, reject) => {
        process.on('close', (code) => {
          console.log('[QuickSpec] Process closed with code:', code)
          console.log('[QuickSpec] specContent length:', specContent.length)
          console.log('[QuickSpec] stderr length:', stderrOutput.length)
          if (code === 0 && specContent) {
            resolve()
          } else {
            console.log('[QuickSpec] Failed with code:', code, 'stderr:', stderrOutput)
            reject(new Error(`Quick spec generation failed with code ${code}: ${stderrOutput}`))
          }
        })
        process.on('error', (err) => {
          console.log('[QuickSpec] Process error:', err)
          reject(err)
        })
      })

      // Save spec to disk
      await saveSpecToDisk(session.projectPath, specContent)

      // Analyze and save complexity to disk for generation agent
      const messages = session.messages.map(m => ({
        role: m.role,
        content: m.content
      }))
      const complexityAnalysis = analyzeComplexity(messages)
      await saveComplexityToDisk(session.projectPath, complexityAnalysis)

      // Notify UI
      this.sendToRenderer(DISCOVERY_CHAT_CHANNELS.SPEC_READY, {
        sessionId,
        spec: specContent
      })

      this.sendToRenderer(DISCOVERY_CHAT_CHANNELS.RESPONSE_CHUNK, {
        sessionId,
        messageId: responseId,
        chunk: '✅ Quick Spec generated successfully!\n',
        fullContent: '',
        eventType: 'system',
        timestamp: Date.now()
      })

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      this.sendToRenderer(DISCOVERY_CHAT_CHANNELS.RESPONSE_CHUNK, {
        sessionId,
        messageId: this.generateId(),
        chunk: `❌ Quick Spec generation failed: ${errorMsg}\n`,
        fullContent: '',
        eventType: 'stderr',
        timestamp: Date.now()
      })
      throw error
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

  /**
   * Build context for Claude using running summary + recent messages
   * This avoids O(n²) token growth by summarizing older messages
   *
   * Context structure:
   * 1. Running summary (if exists) - captures key decisions from older messages
   * 2. Last N messages verbatim - maintains conversational flow
   */
  private buildContext(session: DiscoverySession): string {
    const messages = session.messages
    const totalMessages = messages.length

    // If we have few messages, just include all of them
    if (totalMessages <= MAX_RECENT_MESSAGES) {
      return messages
        .map(m => `${m.role}: ${m.content}`)
        .join('\n\n')
    }

    // Build context with summary + recent messages
    const parts: string[] = []

    // Add running summary if available
    if (session.runningSummary) {
      parts.push(`<previous_discussion_summary>
${session.runningSummary}
</previous_discussion_summary>`)
    }

    // Add recent messages verbatim
    const recentMessages = messages.slice(-MAX_RECENT_MESSAGES)
    if (recentMessages.length > 0) {
      const recentContext = recentMessages
        .map(m => `${m.role}: ${m.content}`)
        .join('\n\n')
      parts.push(`<recent_messages>
${recentContext}
</recent_messages>`)
    }

    return parts.join('\n\n')
  }

  /**
   * Generate a summary of messages that will be replaced by the summary
   * This is called when message count exceeds SUMMARY_TRIGGER_THRESHOLD
   */
  private generateSummaryPrompt(messages: DiscoveryChatMessage[]): string {
    const conversation = messages
      .map(m => `${m.role}: ${m.content}`)
      .join('\n\n')

    return `Summarize this discovery conversation, preserving ALL key information:
- Feature requirements mentioned
- Technology decisions made
- UI/UX requirements discussed
- Data model details
- Edge cases and error handling discussed
- User preferences and constraints

<conversation>
${conversation}
</conversation>

Provide a concise but COMPLETE summary. Do not lose any requirements or decisions.`
  }

  /**
   * Check if we need to generate a summary and do so
   * Called after each message exchange
   */
  private async maybeGenerateSummary(session: DiscoverySession): Promise<void> {
    const totalMessages = session.messages.length
    const lastSummarized = session.lastSummarizedIndex ?? 0

    // Check if we need to generate/update summary
    const messagesToSummarize = totalMessages - MAX_RECENT_MESSAGES
    if (messagesToSummarize <= lastSummarized || totalMessages < SUMMARY_TRIGGER_THRESHOLD) {
      return // Not enough new messages to warrant summarization
    }

    // For now, we'll generate summaries asynchronously in background
    // This could be enhanced to use Claude for better summaries
    // Simple approach: just capture key points from messages
    const messagesForSummary = session.messages.slice(0, messagesToSummarize)

    // Create a simple extractive summary (could be enhanced with LLM later)
    const summary = this.createSimpleSummary(messagesForSummary, session.runningSummary)
    session.runningSummary = summary
    session.lastSummarizedIndex = messagesToSummarize

    // Save summary to disk
    try {
      const autonomousPath = await ensureAutonomousDir(session.projectPath)
      const summaryPath = path.join(autonomousPath, SUMMARY_FILE)
      await fs.writeFile(summaryPath, summary)
      console.log('[DiscoveryChat] Conversation summary updated')
    } catch (err) {
      console.error('[DiscoveryChat] Failed to save summary:', err)
    }
  }

  /**
   * Create a simple extractive summary from messages
   * This extracts key points without using an LLM
   */
  private createSimpleSummary(messages: DiscoveryChatMessage[], existingSummary?: string): string {
    const parts: string[] = []

    if (existingSummary) {
      parts.push('Previous Summary:\n' + existingSummary)
      parts.push('\n---\n')
    }

    // Extract user responses (these contain the actual requirements)
    const userMessages = messages.filter(m => m.role === 'user')
    if (userMessages.length > 0) {
      parts.push('User Requirements & Responses:')
      for (const msg of userMessages) {
        // Keep first 500 chars of each user message
        const content = msg.content.length > 500
          ? msg.content.substring(0, 500) + '...'
          : msg.content
        parts.push(`- ${content}`)
      }
    }

    // Extract key decisions from assistant messages (look for specific patterns)
    const assistantMessages = messages.filter(m => m.role === 'assistant')
    const decisions: string[] = []
    for (const msg of assistantMessages) {
      // Look for "I'll" or "We'll" or "Let's" statements (decisions/confirmations)
      const lines = msg.content.split('\n')
      for (const line of lines) {
        if (line.match(/^(I'll|We'll|Let's|Understood|Got it|Perfect|Great)/i)) {
          decisions.push(line.trim())
        }
      }
    }
    if (decisions.length > 0) {
      parts.push('\nKey Confirmations:')
      for (const d of decisions.slice(0, 10)) { // Limit to 10 decisions
        parts.push(`- ${d}`)
      }
    }

    return parts.join('\n')
  }

  private buildDiscoveryPrompt(session: DiscoverySession, userMessage: string): string {
    const isNew = session.isNewProject

    // HEAVY SPEC Discovery Prompts
    // Goal: Extract EVERYTHING needed for "dumb worker" execution agents
    // CRITICAL: This is CONVERSATION ONLY - no tools, no code, just questions
    const baseInstructions = `
IMPORTANT INTERACTION RULES:
- This is a CONVERSATION-ONLY discovery phase. You have NO tools available.
- DO NOT try to explore files, run commands, or use any tools.
- Your ONLY job is to ask excellent clarifying questions.
- This is a SINGLE-TURN interaction. You respond ONCE, then STOP.
- NEVER generate fake user responses or continue the conversation.
- NEVER write "user:" or simulate what the user might say.
- Ask your questions, then STOP and WAIT for the actual user to respond.
- Keep responses concise - focus on 3-5 related questions per turn.

READINESS INDICATOR:
When you have gathered enough information (typically after 4+ exchanges covering all key areas),
end your response with this exact marker on its own line:
[DISCOVERY_READY]

Do NOT add this marker until you're confident you have:
- Clear understanding of ALL features
- UI/UX requirements defined
- Data model understood
- Edge cases and error handling covered
- Testing requirements clear`

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

Be thorough but focused. One topic area per turn.
Your goal is to make the specification SO COMPLETE that a junior developer could implement it.

Remember: CONVERSATION ONLY. No tools. Ask questions, wait for answers.`
      : `You are a HEAVY SPEC discovery assistant for an existing codebase at: ${session.projectPath}

CRITICAL: After discovery, execution will be done by "dumb worker" agents with NO decision-making ability.
They will follow existing patterns EXACTLY. You MUST capture every detail now.
${baseInstructions}

NOTE: You do NOT have access to the codebase right now. A separate User Journey agent has already
analyzed the codebase structure. Ask the user about specific patterns they want followed.

Ask EXHAUSTIVE clarifying questions about:
1. SPECIFIC CHANGES - What exactly needs to be added or modified?
2. EXISTING PATTERNS - Ask user: "How do similar features work in your codebase?"
3. INTEGRATION POINTS - What existing code will this interact with?
4. DATA CHANGES - Any new models, fields, migrations needed?
5. UI CHANGES - New components? Modifications to existing ones?
6. API CHANGES - New endpoints? Changes to existing ones?
7. TESTING - What tests need to be written?
8. EDGE CASES - Error handling, validation, boundary conditions

Be thorough but focused. One topic area per turn.
The spec must be detailed enough that no judgment calls are needed during implementation.

Remember: CONVERSATION ONLY. No tools. Ask questions, wait for answers.`

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
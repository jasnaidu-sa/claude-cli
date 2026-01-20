/**
 * IPC Handlers for Ideas Manager
 *
 * Provides IPC bridge between renderer and IdeasManager/OutlookIntegration services.
 * Handles CRUD operations, stage transitions, email sync, and AI discussion.
 *
 * AI Discussion now uses Claude Agent SDK for faster responses.
 */

import { ipcMain, BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '@shared/types'
import { getIdeasManager } from '../services/ideas-manager'
import { getOutlookService } from '../services/outlook-integration'
import { getLinkContentExtractor } from '../services/link-content-extractor'
import { getBrowserContentFetcher } from '../services/browser-content-fetcher'
import type { CreateIdeaOptions, UpdateIdeaOptions } from '../services/ideas-manager'
import type { Idea, IdeaStage, OutlookConfig, ProjectType } from '@shared/types'

// Agent SDK types (dynamic import for ESM compatibility)
import type { Query, SDKUserMessage, Options } from '@anthropic-ai/claude-agent-sdk'

// Dynamic import helper for ESM module
let sdkModule: typeof import('@anthropic-ai/claude-agent-sdk') | null = null

async function getSDK(): Promise<typeof import('@anthropic-ai/claude-agent-sdk')> {
  if (!sdkModule) {
    sdkModule = await import('@anthropic-ai/claude-agent-sdk')
    console.log('[IdeasHandler] Agent SDK loaded successfully')
  }
  return sdkModule
}

// Active queries for cancellation
const activeIdeasQueries: Map<string, Query> = new Map()

/**
 * Send progress update to all renderer windows
 */
function sendToAllWindows(channel: string, data: unknown): void {
  BrowserWindow.getAllWindows().forEach(win => {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, data)
    }
  })
}

/**
 * Extract error message safely from unknown error type
 */
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return String(error)
}

export function registerIdeasHandlers(): void {
  const ideasManager = getIdeasManager()
  const outlookService = getOutlookService()
  const browserFetcher = getBrowserContentFetcher()

  // Note: OAuth-based sites like Medium require browser-based login
  // Use the 'ideas:browser-login' IPC handler to open a login window

  // ============================================================================
  // Ideas CRUD Operations
  // ============================================================================

  // List all ideas (optionally filtered by stage)
  ipcMain.handle(
    IPC_CHANNELS.IDEAS_LIST,
    async (_event, stage?: IdeaStage): Promise<{ success: boolean; ideas?: Idea[]; error?: string }> => {
      try {
        const ideas = ideasManager.list(stage)
        return { success: true, ideas }
      } catch (error) {
        console.error('[IdeasHandler] Error listing ideas:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  // Get idea by ID
  ipcMain.handle(
    IPC_CHANNELS.IDEAS_GET,
    async (_event, ideaId: string): Promise<{ success: boolean; idea?: Idea; error?: string }> => {
      try {
        const idea = ideasManager.get(ideaId)
        if (!idea) {
          return { success: false, error: 'Idea not found' }
        }
        return { success: true, idea }
      } catch (error) {
        console.error('[IdeasHandler] Error getting idea:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  // Create new idea
  ipcMain.handle(
    IPC_CHANNELS.IDEAS_CREATE,
    async (_event, options: CreateIdeaOptions): Promise<{ success: boolean; idea?: Idea; error?: string }> => {
      try {
        const idea = ideasManager.create(options)
        return { success: true, idea }
      } catch (error) {
        console.error('[IdeasHandler] Error creating idea:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  // Update idea
  ipcMain.handle(
    IPC_CHANNELS.IDEAS_UPDATE,
    async (_event, ideaId: string, options: UpdateIdeaOptions): Promise<{ success: boolean; idea?: Idea; error?: string }> => {
      try {
        const idea = ideasManager.update(ideaId, options)
        return { success: true, idea }
      } catch (error) {
        console.error('[IdeasHandler] Error updating idea:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  // Delete idea
  ipcMain.handle(
    IPC_CHANNELS.IDEAS_DELETE,
    async (_event, ideaId: string): Promise<{ success: boolean; error?: string }> => {
      try {
        const deleted = ideasManager.delete(ideaId)
        if (!deleted) {
          return { success: false, error: 'Idea not found' }
        }
        return { success: true }
      } catch (error) {
        console.error('[IdeasHandler] Error deleting idea:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  // Move idea to new stage
  ipcMain.handle(
    IPC_CHANNELS.IDEAS_MOVE_STAGE,
    async (_event, ideaId: string, newStage: IdeaStage): Promise<{ success: boolean; idea?: Idea; error?: string }> => {
      try {
        const idea = ideasManager.moveStage(ideaId, newStage)
        return { success: true, idea }
      } catch (error) {
        console.error('[IdeasHandler] Error moving idea stage:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  // Add discussion message
  ipcMain.handle(
    IPC_CHANNELS.IDEAS_ADD_DISCUSSION,
    async (
      _event,
      ideaId: string,
      role: 'user' | 'assistant',
      content: string
    ): Promise<{ success: boolean; idea?: Idea; error?: string }> => {
      try {
        const idea = ideasManager.addDiscussionMessage(ideaId, role, content)
        return { success: true, idea }
      } catch (error) {
        console.error('[IdeasHandler] Error adding discussion message:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  // Start project from idea
  ipcMain.handle(
    IPC_CHANNELS.IDEAS_START_PROJECT,
    async (
      _event,
      ideaId: string,
      projectType: ProjectType,
      projectPath?: string,
      projectName?: string
    ): Promise<{ success: boolean; idea?: Idea; error?: string }> => {
      try {
        // Set project type
        let idea = ideasManager.setProjectType(ideaId, projectType,
          projectPath && projectName ? { path: projectPath, name: projectName } : undefined
        )

        // Move to in_progress if in approved stage
        if (idea.stage === 'approved') {
          idea = ideasManager.moveStage(ideaId, 'in_progress')
        }

        return { success: true, idea }
      } catch (error) {
        console.error('[IdeasHandler] Error starting project:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  // Link workflow to idea
  ipcMain.handle(
    IPC_CHANNELS.IDEAS_LINK_WORKFLOW,
    async (
      _event,
      ideaId: string,
      workflowId: string
    ): Promise<{ success: boolean; idea?: Idea; error?: string }> => {
      try {
        const idea = ideasManager.linkWorkflow(ideaId, workflowId)
        return { success: true, idea }
      } catch (error) {
        console.error('[IdeasHandler] Error linking workflow to idea:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  // ============================================================================
  // Bulk Operations
  // ============================================================================

  // Clear all ideas
  ipcMain.handle(
    'ideas:clear-all',
    async (): Promise<{ success: boolean; count?: number; error?: string }> => {
      try {
        const count = ideasManager.clearAll()
        return { success: true, count }
      } catch (error) {
        console.error('[IdeasHandler] Error clearing ideas:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  // Reprocess all ideas (extract URLs and update titles)
  ipcMain.handle(
    'ideas:reprocess-all',
    async (): Promise<{ success: boolean; processed?: number; updated?: number; error?: string }> => {
      try {
        const result = await ideasManager.reprocessAllIdeas()
        return { success: true, ...result }
      } catch (error) {
        console.error('[IdeasHandler] Error reprocessing ideas:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  // Reprocess single idea
  ipcMain.handle(
    'ideas:reprocess',
    async (_event, ideaId: string): Promise<{ success: boolean; idea?: Idea; error?: string }> => {
      try {
        const idea = await ideasManager.reprocessIdea(ideaId)
        return { success: true, idea }
      } catch (error) {
        console.error('[IdeasHandler] Error reprocessing idea:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  // ============================================================================
  // Browser-based Content Fetching (for paywalled sites)
  // ============================================================================

  // Open login window for paywalled sites (Medium, Substack, etc.)
  ipcMain.handle(
    'ideas:browser-login',
    async (_event, url?: string): Promise<{ success: boolean; error?: string }> => {
      try {
        // Default to Medium login if no URL specified
        const loginUrl = url || 'https://medium.com/m/signin'
        console.log(`[IdeasHandler] Opening browser login for: ${loginUrl}`)

        // This opens a visible browser window for manual login
        // When the window is closed, cookies are saved for future requests
        await browserFetcher.openLoginWindow(loginUrl)

        return { success: true }
      } catch (error) {
        console.error('[IdeasHandler] Error opening browser login:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  // Check if we have a session for a domain
  ipcMain.handle(
    'ideas:has-session',
    async (_event, domain: string): Promise<{ success: boolean; hasSession?: boolean; error?: string }> => {
      try {
        const hasSession = await browserFetcher.hasSessionFor(domain)
        return { success: true, hasSession }
      } catch (error) {
        console.error('[IdeasHandler] Error checking session:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  // Clear browser cookies
  ipcMain.handle(
    'ideas:clear-cookies',
    async (): Promise<{ success: boolean; error?: string }> => {
      try {
        browserFetcher.clearCookies()
        return { success: true }
      } catch (error) {
        console.error('[IdeasHandler] Error clearing cookies:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  // ============================================================================
  // Outlook Integration
  // ============================================================================

  // Configure Outlook
  ipcMain.handle(
    IPC_CHANNELS.OUTLOOK_CONFIGURE,
    async (_event, config: Partial<OutlookConfig>): Promise<{ success: boolean; error?: string }> => {
      try {
        outlookService.configure(config)
        return { success: true }
      } catch (error) {
        console.error('[IdeasHandler] Error configuring Outlook:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  // Get Outlook config
  ipcMain.handle(
    IPC_CHANNELS.OUTLOOK_GET_CONFIG,
    async (): Promise<{ success: boolean; config?: OutlookConfig | null; error?: string }> => {
      try {
        const config = outlookService.getConfig()
        return { success: true, config }
      } catch (error) {
        console.error('[IdeasHandler] Error getting Outlook config:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  // Authenticate with Outlook
  ipcMain.handle(
    IPC_CHANNELS.OUTLOOK_AUTHENTICATE,
    async (): Promise<{ success: boolean; error?: string }> => {
      try {
        await outlookService.authenticate()
        return { success: true }
      } catch (error) {
        console.error('[IdeasHandler] Error authenticating with Outlook:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  // Fetch emails from Outlook
  ipcMain.handle(
    IPC_CHANNELS.OUTLOOK_FETCH_EMAILS,
    async (_event, options?: {
      maxResults?: number
      sinceDate?: string
      onlySinceLastSync?: boolean
    }): Promise<{ success: boolean; count?: number; ideas?: Idea[]; error?: string }> => {
      try {
        const fetchOptions = options ? {
          ...options,
          sinceDate: options.sinceDate ? new Date(options.sinceDate) : undefined
        } : undefined

        const emails = await outlookService.fetchEmails(fetchOptions)
        const ideas = await ideasManager.createFromEmails(emails)

        return { success: true, count: ideas.length, ideas }
      } catch (error) {
        console.error('[IdeasHandler] Error fetching emails:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  // Sync emails (fetch and create ideas) - legacy batch mode
  ipcMain.handle(
    IPC_CHANNELS.OUTLOOK_SYNC,
    async (): Promise<{ success: boolean; count?: number; ideas?: Idea[]; error?: string }> => {
      try {
        const emails = await outlookService.fetchEmails({ onlySinceLastSync: true })
        const ideas = await ideasManager.createFromEmails(emails)

        return { success: true, count: ideas.length, ideas }
      } catch (error) {
        console.error('[IdeasHandler] Error syncing emails:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  // Sync emails with streaming - sends each idea as it completes
  // Pass fullRefresh: true to fetch ALL emails (not just since last sync)
  ipcMain.handle(
    IPC_CHANNELS.OUTLOOK_SYNC_STREAM,
    async (_event, options?: { fullRefresh?: boolean }): Promise<{ success: boolean; error?: string }> => {
      try {
        // For full refresh, fetch all emails WITHOUT updating lastSyncAt
        // This preserves the sync point so new emails aren't missed
        const fetchOptions = options?.fullRefresh
          ? { maxResults: 50, updateLastSync: false }  // No onlySinceLastSync, don't update timestamp
          : { onlySinceLastSync: true }  // Regular sync updates timestamp
        const emails = await outlookService.fetchEmails(fetchOptions)

        // Send initial progress
        sendToAllWindows(IPC_CHANNELS.OUTLOOK_SYNC_PROGRESS, {
          type: 'start',
          total: emails.length
        })

        // Process emails using streaming generator
        let count = 0
        for await (const idea of ideasManager.createFromEmailsStream(emails)) {
          count++
          // Send each idea as it completes
          sendToAllWindows(IPC_CHANNELS.OUTLOOK_SYNC_PROGRESS, {
            type: 'idea',
            idea,
            current: count,
            total: emails.length
          })
        }

        // Send completion
        sendToAllWindows(IPC_CHANNELS.OUTLOOK_SYNC_PROGRESS, {
          type: 'complete',
          count
        })

        return { success: true }
      } catch (error) {
        console.error('[IdeasHandler] Error in streaming sync:', error)
        sendToAllWindows(IPC_CHANNELS.OUTLOOK_SYNC_PROGRESS, {
          type: 'error',
          error: getErrorMessage(error)
        })
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  // Get Outlook status
  ipcMain.handle(
    IPC_CHANNELS.OUTLOOK_STATUS,
    async (): Promise<{
      success: boolean
      status?: {
        configured: boolean
        authenticated: boolean
        sourceEmail: string | null
        lastSyncAt: number | null
      }
      error?: string
    }> => {
      try {
        const status = outlookService.getStatus()
        return { success: true, status }
      } catch (error) {
        console.error('[IdeasHandler] Error getting Outlook status:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  // Reset Outlook sync timestamp - use when sync gets out of sync with email dates
  ipcMain.handle(
    'outlook:reset-sync',
    async (): Promise<{ success: boolean; error?: string }> => {
      try {
        outlookService.resetLastSyncAt()
        return { success: true }
      } catch (error) {
        console.error('[IdeasHandler] Error resetting sync:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  // ============================================================================
  // AI Discussion - Stream Claude responses for idea discussion (Agent SDK)
  // ============================================================================

  // Discuss idea with Claude - streaming response via Agent SDK (FAST!)
  // Mode can be 'chat' (default), 'plan' (read-only file access), or 'execute' (read+write)
  ipcMain.handle(
    IPC_CHANNELS.IDEAS_DISCUSS,
    async (
      _event,
      ideaId: string,
      userMessage: string,
      mode: 'chat' | 'plan' | 'execute' = 'chat'
    ): Promise<{ success: boolean; error?: string }> => {
      try {
        const idea = ideasManager.get(ideaId)
        if (!idea) {
          return { success: false, error: 'Idea not found' }
        }

        // Add user message to discussion first
        ideasManager.addDiscussionMessage(ideaId, 'user', userMessage)

        // Preload schema index if available (to avoid relying on model to read files)
        let schemaContext = ''
        if (idea.associatedProjectPath) {
          try {
            const fs = await import('fs/promises')
            const path = await import('path')
            const schemaIndexPath = path.join(idea.associatedProjectPath, '.schema', '_index.md')
            const schemaContent = await fs.readFile(schemaIndexPath, 'utf-8')
            schemaContext = `\n\n## Project Schema Documentation\n\n${schemaContent}\n\n`
            console.log('[IdeasHandler] Preloaded .schema/_index.md into context')
          } catch (err) {
            // Schema file doesn't exist or can't be read - continue without it
            console.log('[IdeasHandler] No .schema/_index.md found, continuing without preloaded schema')
          }
        }

        // Build context prompt with idea details (mode affects the system prompt)
        const contextPrompt = buildIdeaDiscussionPrompt(idea, userMessage, mode, schemaContext)

        console.log('[IdeasHandler] Starting SDK discussion for idea:', idea.title)
        console.log('[IdeasHandler] Using Agent SDK for fast response')

        // Load Agent SDK dynamically (ESM module)
        const sdk = await getSDK()

        // Determine if we should enable file tools (any mode with associated project gets read access)
        const hasProject = !!(idea.associatedProjectPath || idea.projectName)
        const projectPath = idea.associatedProjectPath || null
        const enableTools = hasProject // Enable tools for any mode if project exists

        console.log('[IdeasHandler] Mode:', mode, 'Project path:', projectPath, 'Enable tools:', enableTools)

        // Check if we have an existing session to resume
        const existingSessionId = idea.sessionId
        console.log('[IdeasHandler] Existing session ID:', existingSessionId || 'none')

        // Create async generator for streaming input (matching discovery-chat-service-sdk pattern)
        async function* generateMessages(): AsyncGenerator<SDKUserMessage> {
          yield {
            type: 'user' as const,
            message: {
              role: 'user' as const,
              content: contextPrompt
            },
            parent_tool_use_id: null,
            session_id: existingSessionId || ideaId // Use existing session or idea ID as fallback
          }
        }

        // SDK options - enable tools for plan mode with project
        const sdkOptions: Options = {
          model: 'claude-3-5-haiku-20241022', // Fast model for discussions
          maxTurns: enableTools ? 15 : 1, // Allow multiple turns if using tools
          includePartialMessages: true, // Get token-by-token streaming
          permissionMode: 'default'
        }

        // Resume existing session if available (maintains conversation context!)
        if (existingSessionId) {
          sdkOptions.resume = existingSessionId
          sdkOptions.forkSession = false // Continue the same session
          console.log('[IdeasHandler] Resuming session:', existingSessionId)
        }

        // Enable file tools based on mode
        if (enableTools && projectPath) {
          sdkOptions.cwd = projectPath // Set working directory to project

          if (mode === 'execute') {
            // Execute mode: full read+write capabilities
            sdkOptions.tools = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'LS', 'Bash']
            sdkOptions.maxTurns = 10 // Allow more turns for complex execution tasks
            console.log('[IdeasHandler] Enabled EXECUTE tools (read+write) for project:', projectPath)
          } else if (mode === 'plan') {
            // Plan mode: read-only with more turns for exploration
            sdkOptions.tools = ['Read', 'Glob', 'Grep', 'LS']
            sdkOptions.maxTurns = 15 // Allow many turns for exploration and file reading
            console.log('[IdeasHandler] Enabled PLAN tools (read-only) for project:', projectPath)
          } else {
            // Chat mode: read-only tools for context
            sdkOptions.tools = ['Read', 'Glob', 'Grep', 'LS']
            sdkOptions.maxTurns = 15 // Allow enough turns to read multiple files and respond
            console.log('[IdeasHandler] Enabled CHAT tools (read-only) for project:', projectPath)
          }
        } else {
          sdkOptions.tools = [] // No tools if no project
        }

        // Start SDK query with streaming
        const queryResult = sdk.query({
          prompt: generateMessages(),
          options: sdkOptions
        })

        // Store query for potential cancellation
        activeIdeasQueries.set(ideaId, queryResult)

        let fullResponse = ''
        let capturedSessionId: string | undefined
        const startTime = Date.now()

        // Process streaming messages (matching discovery-chat-service-sdk pattern)
        let chunkCount = 0
        for await (const message of queryResult) {
          // Capture session ID from system init message (for resuming conversation!)
          if (message.type === 'system' && message.subtype === 'init' && message.session_id) {
            capturedSessionId = message.session_id
            console.log('[IdeasHandler] Captured session ID:', capturedSessionId)
          }

          // Handle streaming partial messages (token-by-token!)
          if (message.type === 'stream_event' && message.event) {
            const event = message.event as { type: string; delta?: { type?: string; text?: string } }

            if (event.type === 'content_block_delta' && event.delta?.text) {
              const delta = event.delta.text
              fullResponse += delta
              chunkCount++

              // Send chunk to renderer
              sendToAllWindows(IPC_CHANNELS.IDEAS_DISCUSS_STREAM, {
                ideaId,
                type: 'chunk',
                chunk: delta
              })
            }
          }
          // Handle complete assistant message (fallback)
          else if (message.type === 'assistant' && message.message?.content) {
            for (const block of message.message.content) {
              if (block.type === 'text' && 'text' in block) {
                const newText = block.text as string
                if (newText.length > fullResponse.length) {
                  const delta = newText.slice(fullResponse.length)
                  sendToAllWindows(IPC_CHANNELS.IDEAS_DISCUSS_STREAM, {
                    ideaId,
                    type: 'chunk',
                    chunk: delta
                  })
                }
                fullResponse = newText
              }
            }
          }
          // Handle result (final message)
          else if (message.type === 'result') {
            const duration = Date.now() - startTime
            console.log('[IdeasHandler] SDK query complete in', duration, 'ms')
            console.log('[IdeasHandler] Cost:', message.total_cost_usd, 'USD')
          }
        }

        // Clean up active query
        activeIdeasQueries.delete(ideaId)

        console.log('[IdeasHandler] Received', chunkCount, 'chunks')
        console.log('[IdeasHandler] Full response length:', fullResponse.length)
        console.log('[IdeasHandler] Full response preview:', fullResponse.substring(0, 200))

        // Store session ID if captured (for conversation continuity!)
        if (capturedSessionId && !existingSessionId) {
          console.log('[IdeasHandler] Storing new session ID:', capturedSessionId)
          ideasManager.updateSessionId(ideaId, capturedSessionId)
        }

        // Add assistant response to discussion
        if (fullResponse.trim()) {
          console.log('[IdeasHandler] Adding response to discussion and sending completion')
          ideasManager.addDiscussionMessage(ideaId, 'assistant', fullResponse.trim())

          // Send completion event
          sendToAllWindows(IPC_CHANNELS.IDEAS_DISCUSS_STREAM, {
            ideaId,
            type: 'complete',
            fullResponse: fullResponse.trim()
          })
          console.log('[IdeasHandler] Completion event sent with full response')
        } else {
          console.log('[IdeasHandler] No response content, sending empty completion')
          // Still send complete even if no response
          sendToAllWindows(IPC_CHANNELS.IDEAS_DISCUSS_STREAM, {
            ideaId,
            type: 'complete'
          })
        }

        return { success: true }
      } catch (error) {
        console.error('[IdeasHandler] Error in SDK idea discussion:', error)
        activeIdeasQueries.delete(ideaId)
        sendToAllWindows(IPC_CHANNELS.IDEAS_DISCUSS_STREAM, {
          ideaId,
          type: 'error',
          error: getErrorMessage(error)
        })
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  // Cancel active idea discussion
  ipcMain.handle(
    'ideas:cancel-discuss',
    async (_event, ideaId: string): Promise<{ success: boolean; error?: string }> => {
      try {
        const activeQuery = activeIdeasQueries.get(ideaId)
        if (activeQuery) {
          // Query object doesn't have cancel method - just remove from map
          activeIdeasQueries.delete(ideaId)
          console.log('[IdeasHandler] Marked discussion cancelled for idea:', ideaId)
        }
        return { success: true }
      } catch (error) {
        console.error('[IdeasHandler] Error cancelling discussion:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )
}

/**
 * Build a context-rich prompt for idea discussion
 * @param mode - 'chat' for general discussion, 'plan' for structured planning, 'execute' for implementation
 * @param schemaContext - Preloaded schema content to include in the prompt
 */
function buildIdeaDiscussionPrompt(idea: Idea, userMessage: string, mode: 'chat' | 'plan' | 'execute' = 'chat', schemaContext = ''): string {
  const sections: string[] = []

  // System prompt differs based on mode
  if (mode === 'execute') {
    sections.push(`You are an expert software developer executing implementation tasks.

**CRITICAL INSTRUCTION**: You have Read, Write, Edit, Glob, Grep, LS, and Bash tools available. The project path is set as your working directory.
DO NOT ask the user to share files. USE THE READ TOOL to access files directly!

Your workflow:
1. **IMMEDIATELY Use Read Tool**: Start by reading .schema/_index.md and .claude-context/_index.md to understand the system
2. **Read Relevant Code**: Use Glob to find files, Read to examine them
3. **Implement Changes**: Use Write/Edit tools to make changes
4. **Follow Conventions**: Match patterns you discovered in schema/context files
5. **Be Precise**: Make only the requested changes
6. **Report What Changed**: List files modified and what you did

DO NOT say "I need access" or "please provide files" - you have full read/write access via tools!
Start by USING READ TOOL on .schema/ and .claude-context/ files, then implement.`)
  } else if (mode === 'plan') {
    sections.push(`You are a senior software architect helping to plan and scope a project idea.

**CRITICAL INSTRUCTION**: You have Read, Glob, Grep, and LS tools available. The project path is set as your working directory.
DO NOT ask the user to share files or provide file contents. USE THE READ TOOL to access files directly!

Your workflow:
1. **IMMEDIATELY Use Read Tool**: Start by reading .schema/_index.md and .claude-context/_index.md or README.md
2. **Explore with Tools**: Use Glob to find relevant schema files, use Read to examine them
3. **Clarify Requirements**: Ask probing questions about what's NOT in the documentation
4. **Identify Complexity**: Highlight technical challenges based on what you read in the schema
5. **Break Down Work**: Suggest phases that align with existing architecture (from schema/context)
6. **Technical Decisions**: Recommend approaches that match existing patterns you discovered
7. **Risk Assessment**: Flag blockers based on actual codebase knowledge

DO NOT say "I need access to files" or "please share files" - you already have access via Read tool!
Start your response by USING READ TOOL on documentation files, not by asking for them.`)
  } else {
    // Chat mode
    sections.push('You are a helpful assistant discussing a project idea.')
    sections.push('')
    // In chat mode with a project, mention file access is available
    if (idea.associatedProjectPath) {
      sections.push('**CRITICAL**: You have Read, Glob, Grep, and LS tools available. The project path is set as your working directory.')
      sections.push('**DO NOT ask the user for files - USE THE READ TOOL to access them directly!**')
      sections.push('')
      sections.push('When the user asks about the project:')
      sections.push('1. **IMMEDIATELY use Read tool** to read `.schema/_index.md` and `.claude-context/_index.md`')
      sections.push('2. **Use Glob** to find relevant files based on what the user is asking about')
      sections.push('3. **Use Read tool** on those files to get actual content')
      sections.push('4. Answer based on what you READ, not what you assume')
      sections.push('')
      sections.push('DO NOT say "I\'ll read..." and then stop - ACTUALLY USE THE READ TOOL!')
      sections.push('')
      sections.push('If the user needs you to:')
      sections.push('- Plan or architect changes → suggest **Plan** mode (purple button) for deeper analysis')
      sections.push('- Implement or modify code → suggest **Execute** mode (orange button) for write access')
    }
  }
  sections.push('')

  sections.push('## Idea Context')
  sections.push(`**Title:** ${idea.title}`)
  sections.push(`**Stage:** ${idea.stage}`)
  sections.push(`**Project Type:** ${idea.projectType}`)

  // Include project path if available (for brownfield projects)
  if (idea.associatedProjectPath) {
    sections.push(`**Project Path:** ${idea.associatedProjectPath}`)
    sections.push(`**Project Name:** ${idea.associatedProjectName || 'Unknown'}`)
    if (mode === 'execute') {
      sections.push('')
      sections.push('You have file tools (Read, Write, Edit, Glob, Grep, LS, Bash) with the project as your working directory.')
      sections.push('')
      sections.push('**FIRST ACTION - Use Read tool immediately**:')
      sections.push('1. Read `.schema/_index.md` to understand project structure and available schemas')
      sections.push('2. Read `.claude-context/_index.md` or `README.md` for architecture patterns')
      sections.push('3. Use Glob to find relevant code: `**/*survey*.{ts,tsx,js}` or similar patterns')
      sections.push('4. Read the found files to understand existing implementation')
      sections.push('')
      sections.push('DO NOT ask for file contents - use Read tool directly on the paths above!')
      sections.push('Then implement the requested changes using Write/Edit tools.')
    } else if (mode === 'plan') {
      sections.push('')
      sections.push('You have access to file reading tools (Read, Glob, Grep, LS) to explore this project.')
      sections.push('')
      sections.push('**CRITICAL - DO NOT ASK FOR FILES**: You can READ FILES DIRECTLY from the project path shown above.')
      sections.push('')
      sections.push('**FIRST ACTION - Read documentation immediately**:')
      sections.push('1. Use Read tool on `.schema/_index.md` to see all available schema documentation')
      sections.push('2. Use Read tool on `.claude-context/_index.md` or `README.md` for architecture overview')
      sections.push('3. Use Glob to find relevant schema files: `.schema/database/*.md`, `.schema/api/*.md`, `.schema/flows/*.md`')
      sections.push('4. Use Read tool on any `README.md`, `CLAUDE.md`, or `package.json` for project details')
      sections.push('')
      sections.push('DO NOT ask the user for file contents - use the Read tool to access files directly!')
      sections.push('Start your response by using Read tool on documentation files, then provide informed recommendations.')
    } else {
      // Chat mode - also gets read access but with lighter guidance
      sections.push('')
      sections.push('You have read-only file tools (Read, Glob, Grep, LS) available.')
      sections.push('')
      sections.push('**When answering questions**: You can read project files directly to give informed answers.')
      sections.push('- Check `.schema/_index.md` for technical specs if relevant')
      sections.push('- Check `.claude-context/README.md` for architecture context if needed')
      sections.push('- Use Glob/Read to examine code when helpful')
      sections.push('')
      sections.push('DO NOT ask users to share files - use Read tool directly!')
    }
  }
  sections.push('')

  // Include email source
  sections.push('### Original Request')
  sections.push(`From: ${idea.emailSource.from}`)
  sections.push(`Subject: ${idea.emailSource.subject}`)
  sections.push(`Body: ${idea.emailSource.body.substring(0, 500)}${idea.emailSource.body.length > 500 ? '...' : ''}`)
  sections.push('')

  // Include preloaded schema context if available
  if (schemaContext) {
    sections.push(schemaContext)
  }

  // Include article summaries if available
  if (idea.extractedUrls?.some(u => u.summary)) {
    sections.push('### Article Summaries')
    for (const url of idea.extractedUrls.filter(u => u.summary)) {
      sections.push(`**${url.title || url.url}**`)
      sections.push(url.summary || '')
      sections.push('')
    }
  }

  // Include previous discussion context
  if (idea.discussionMessages && idea.discussionMessages.length > 0) {
    sections.push('### Previous Discussion')
    // Include last few messages for context (not the user's new message which we added)
    const previousMessages = idea.discussionMessages.slice(-6, -1) // Exclude the message we just added
    for (const msg of previousMessages) {
      sections.push(`**${msg.role === 'user' ? 'User' : 'Assistant'}:** ${msg.content}`)
    }
    sections.push('')
  }

  sections.push('### User Request')
  sections.push(userMessage)
  sections.push('')

  if (mode === 'execute') {
    sections.push('Execute the requested changes. Read relevant files first to understand the codebase, then implement the changes. Report what you did.')
  } else if (mode === 'plan') {
    sections.push('Provide a structured planning response. If this is the first message, start by asking clarifying questions to understand the scope better.')
  } else {
    sections.push('Please provide a helpful response about this project idea.')
  }

  return sections.join('\n')
}

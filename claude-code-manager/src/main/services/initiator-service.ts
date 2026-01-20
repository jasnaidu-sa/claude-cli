/**
 * Initiator Service - Ralph Loop Prompt Generation
 *
 * Conversational service that helps users define their task requirements
 * and generates optimized Ralph Loop prompts for execution.
 *
 * Flow:
 * 1. User describes task in natural language
 * 2. Claude asks clarifying questions (scope, constraints, success criteria)
 * 3. Requirements are summarized for user approval
 * 4. Optimized Ralph Loop prompt is generated with completion promise
 *
 * Uses Claude Agent SDK for conversational flow with streaming support.
 */

import { EventEmitter } from 'events'
import * as fs from 'fs/promises'
import * as path from 'path'
import { getMainWindow } from '../index'

// Type imports only (these work with CommonJS)
import type { Query, SDKUserMessage, Options } from '@anthropic-ai/claude-agent-sdk'

// Dynamic import helper for ESM module
let sdkModule: typeof import('@anthropic-ai/claude-agent-sdk') | null = null

async function getSDK(): Promise<typeof import('@anthropic-ai/claude-agent-sdk')> {
  if (!sdkModule) {
    sdkModule = await import('@anthropic-ai/claude-agent-sdk')
    console.log('[InitiatorService] Agent SDK loaded successfully')
  }
  return sdkModule
}

// Constants
const HAIKU_MODEL = 'claude-3-5-haiku-20241022'
const SONNET_MODEL = 'claude-sonnet-4-5-20250929'
const MAX_TURNS = 1
const AUTONOMOUS_DIR = '.autonomous'
const INITIATOR_SESSION_FILE = 'initiator-session.json'
const RALPH_PROMPT_FILE = 'ralph-prompt.md'

// IPC channel names for initiator
export const INITIATOR_CHANNELS = {
  START: 'initiator:start',
  SEND_MESSAGE: 'initiator:send-message',
  GET_SESSION: 'initiator:get-session',
  SUMMARIZE: 'initiator:summarize',
  GENERATE_PROMPT: 'initiator:generate-prompt',
  APPROVE_PROMPT: 'initiator:approve-prompt',
  CANCEL: 'initiator:cancel',
  // Events
  RESPONSE_CHUNK: 'initiator:response-chunk',
  RESPONSE_COMPLETE: 'initiator:response-complete',
  REQUIREMENTS_READY: 'initiator:requirements-ready',
  PROMPT_READY: 'initiator:prompt-ready',
  ERROR: 'initiator:error'
} as const

// Question categories for requirements gathering
export type QuestionCategory =
  | 'objective'
  | 'scope'
  | 'success_criteria'
  | 'constraints'
  | 'project_context'
  | 'complexity'

// Attachment types
export type AttachmentType = 'text' | 'pdf' | 'image' | 'code' | 'markdown' | 'json' | 'unknown'

export interface InitiatorAttachment {
  id: string
  fileName: string
  filePath: string
  fileSize: number
  mimeType: string
  attachmentType: AttachmentType
  textContent?: string
  base64Data?: string
  error?: string
}

// Chat message type
export interface InitiatorMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  category?: QuestionCategory
  attachments?: InitiatorAttachment[]
}

// Requirements document structure
export interface RequirementsDoc {
  objective: string
  scope: string[]
  successCriteria: string[]
  constraints: string[]
  outOfScope: string[]
  projectType: 'greenfield' | 'brownfield' | 'undetermined'
  complexity: 'quick' | 'standard' | 'enterprise'
  estimatedFeatures: number
  gatheredAt: number
}

// Generated Ralph Loop prompt configuration
export interface RalphPromptConfig {
  prompt: string
  completionPromise: string
  maxIterations: number
  checkpointThreshold: number
  successIndicators: string[]
  generatedAt: number
}

// Session state
export interface InitiatorSession {
  id: string
  projectPath: string
  messages: InitiatorMessage[]
  phase: 'gathering' | 'summarizing' | 'generating' | 'reviewing' | 'approved'
  requirements: RequirementsDoc | null
  generatedPrompt: RalphPromptConfig | null
  createdAt: number
  updatedAt: number
  totalCostUsd: number
}

/**
 * Generate unique ID
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 10)}`
}

/**
 * Determine attachment type from file extension and mime type
 */
function getAttachmentType(filePath: string, mimeType: string): AttachmentType {
  const ext = path.extname(filePath).toLowerCase()

  // Check by extension first
  const codeExtensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.cs', '.rb', '.php', '.swift', '.kt', '.scala', '.vue', '.svelte']
  const markdownExtensions = ['.md', '.mdx', '.markdown']
  const textExtensions = ['.txt', '.log', '.csv', '.env', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf']

  if (codeExtensions.includes(ext)) return 'code'
  if (markdownExtensions.includes(ext)) return 'markdown'
  if (ext === '.json') return 'json'
  if (ext === '.pdf') return 'pdf'
  if (textExtensions.includes(ext)) return 'text'

  // Check by mime type
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('text/')) return 'text'
  if (mimeType === 'application/json') return 'json'
  if (mimeType === 'application/pdf') return 'pdf'

  return 'unknown'
}

/**
 * Process a file attachment - extract content for context
 */
async function processAttachment(filePath: string): Promise<InitiatorAttachment> {
  const id = generateId()
  const fileName = path.basename(filePath)

  try {
    const stats = await fs.stat(filePath)
    const fileSize = stats.size

    // Size limit: 5MB for text, 10MB for images
    const MAX_TEXT_SIZE = 5 * 1024 * 1024
    const MAX_IMAGE_SIZE = 10 * 1024 * 1024

    // Determine mime type (simple detection)
    const ext = path.extname(filePath).toLowerCase()
    let mimeType = 'application/octet-stream'

    const mimeMap: Record<string, string> = {
      '.txt': 'text/plain',
      '.md': 'text/markdown',
      '.json': 'application/json',
      '.js': 'text/javascript',
      '.ts': 'text/typescript',
      '.tsx': 'text/typescript',
      '.jsx': 'text/javascript',
      '.py': 'text/x-python',
      '.pdf': 'application/pdf',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
      '.html': 'text/html',
      '.css': 'text/css',
      '.xml': 'text/xml',
      '.yaml': 'text/yaml',
      '.yml': 'text/yaml',
      '.csv': 'text/csv'
    }

    mimeType = mimeMap[ext] || mimeType
    const attachmentType = getAttachmentType(filePath, mimeType)

    const attachment: InitiatorAttachment = {
      id,
      fileName,
      filePath,
      fileSize,
      mimeType,
      attachmentType
    }

    // Process based on type
    if (attachmentType === 'image') {
      if (fileSize > MAX_IMAGE_SIZE) {
        attachment.error = `Image too large (${(fileSize / 1024 / 1024).toFixed(1)}MB, max 10MB)`
      } else {
        // Read as base64 for images
        const buffer = await fs.readFile(filePath)
        attachment.base64Data = buffer.toString('base64')
      }
    } else if (attachmentType === 'pdf') {
      // For PDFs, we'll just note the file - actual PDF parsing would require a library
      attachment.textContent = `[PDF Document: ${fileName}]\nFile size: ${(fileSize / 1024).toFixed(1)}KB\nNote: PDF content extraction requires manual review or specialized processing.`
    } else {
      // Text-based files
      if (fileSize > MAX_TEXT_SIZE) {
        attachment.error = `File too large (${(fileSize / 1024 / 1024).toFixed(1)}MB, max 5MB)`
      } else {
        const content = await fs.readFile(filePath, 'utf-8')
        attachment.textContent = content
      }
    }

    console.log('[InitiatorService] Processed attachment:', fileName, attachmentType)
    return attachment
  } catch (error) {
    console.error('[InitiatorService] Error processing attachment:', error)
    return {
      id,
      fileName,
      filePath,
      fileSize: 0,
      mimeType: 'unknown',
      attachmentType: 'unknown',
      error: error instanceof Error ? error.message : 'Failed to process file'
    }
  }
}

/**
 * Ensure .autonomous directory exists
 */
async function ensureAutonomousDir(projectPath: string): Promise<string> {
  const autonomousPath = path.join(projectPath, AUTONOMOUS_DIR)
  await fs.mkdir(autonomousPath, { recursive: true })
  return autonomousPath
}

/**
 * Save session to disk
 */
async function saveSessionToDisk(projectPath: string, session: InitiatorSession): Promise<void> {
  const autonomousPath = await ensureAutonomousDir(projectPath)
  const sessionPath = path.join(autonomousPath, INITIATOR_SESSION_FILE)
  session.updatedAt = Date.now()
  await fs.writeFile(sessionPath, JSON.stringify(session, null, 2))
  console.log('[InitiatorService] Session saved to disk')
}

/**
 * Load session from disk
 */
async function loadSessionFromDisk(projectPath: string): Promise<InitiatorSession | null> {
  const sessionPath = path.join(projectPath, AUTONOMOUS_DIR, INITIATOR_SESSION_FILE)
  try {
    const content = await fs.readFile(sessionPath, 'utf-8')
    const data = JSON.parse(content)
    console.log('[InitiatorService] Loaded session with', data.messages?.length || 0, 'messages')
    return data as InitiatorSession
  } catch {
    return null
  }
}

/**
 * Save generated Ralph prompt to disk
 */
async function saveRalphPromptToDisk(projectPath: string, config: RalphPromptConfig): Promise<string> {
  const autonomousPath = await ensureAutonomousDir(projectPath)
  const promptPath = path.join(autonomousPath, RALPH_PROMPT_FILE)

  const content = `# Ralph Loop Execution Prompt

> Generated: ${new Date(config.generatedAt).toISOString()}
> Max Iterations: ${config.maxIterations}
> Checkpoint Threshold: ${config.checkpointThreshold}
> Completion Promise: ${config.completionPromise}

---

${config.prompt}

---

## Success Indicators
${config.successIndicators.map((s, i) => `${i + 1}. ${s}`).join('\n')}

## Completion Promise
When ALL success criteria are met and verified, output:
\`\`\`
<promise>${config.completionPromise}</promise>
\`\`\`

Do NOT output the promise until all criteria are genuinely complete.
`

  await fs.writeFile(promptPath, content)
  console.log('[InitiatorService] Ralph prompt saved:', promptPath)
  return promptPath
}

/**
 * Format attachments for inclusion in prompt
 */
function formatAttachmentsForPrompt(attachments: InitiatorAttachment[]): string {
  if (!attachments || attachments.length === 0) return ''

  const formatted = attachments.map(att => {
    if (att.error) {
      return `[Attachment: ${att.fileName}] Error: ${att.error}`
    }

    if (att.textContent) {
      // Truncate very long content
      const maxLen = 10000
      const content = att.textContent.length > maxLen
        ? att.textContent.substring(0, maxLen) + '\n... [truncated]'
        : att.textContent

      return `[Attachment: ${att.fileName}] (${att.attachmentType})
\`\`\`
${content}
\`\`\``
    }

    if (att.base64Data) {
      return `[Attachment: ${att.fileName}] (${att.attachmentType}) - Image provided`
    }

    return `[Attachment: ${att.fileName}] (${att.attachmentType})`
  })

  return '\n\n## Attached Documents:\n' + formatted.join('\n\n')
}

/**
 * Build the system prompt for requirements gathering
 *
 * SIMPLIFIED: Ralph Loop just needs:
 * 1. What to implement (from PRD/description)
 * 2. How to verify completion (success criteria)
 *
 * NO lengthy discovery - just extract and confirm.
 */
function buildGatheringPrompt(session: InitiatorSession): string {
  const recentMessages = session.messages.slice(-10)

  // Build conversation context including attachment info
  const conversationContext = recentMessages
    .filter(m => m.role !== 'system')
    .map(m => {
      let text = `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`
      if (m.attachments && m.attachments.length > 0) {
        text += formatAttachmentsForPrompt(m.attachments)
      }
      return text
    })
    .join('\n\n')

  return `You are a task extractor for Ralph Loop (an autonomous coding agent).

## Your ONLY Job
Read the user's PRD/spec/description and output a simple task summary.

## Output Format (use this EXACTLY):
READY_TO_SUMMARIZE:

**Tasks:**
1. [Task 1]
2. [Task 2]
...

**Success Criteria:**
- [How to verify task 1 is done]
- [How to verify task 2 is done]
...

**Ready to proceed?** Reply 'yes' to generate the execution prompt.

## Rules
- Extract directly from the document - DO NOT ask clarifying questions
- DO NOT explain, elaborate, or discuss implementation details
- DO NOT ask about infrastructure, databases, or technical setup
- If something is unclear, make a reasonable assumption and note it
- Keep it SHORT - just list the tasks and criteria
- ALWAYS start with "READY_TO_SUMMARIZE:" if you have ANY document/description

## User Input:
${conversationContext || 'No input yet.'}

Extract tasks and success criteria NOW. Do not ask questions.`
}

/**
 * Build the prompt for summarizing requirements
 */
function buildSummarizationPrompt(session: InitiatorSession): string {
  const messages = session.messages
    .filter(m => m.role !== 'system')
    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n\n')

  return `Based on the following conversation, create a structured requirements document.

## Conversation:
${messages}

## Output Format (respond with ONLY this JSON, no other text):
{
  "objective": "Single sentence describing the main goal",
  "scope": ["Feature 1", "Feature 2", "..."],
  "successCriteria": ["Criterion 1", "Criterion 2", "..."],
  "constraints": ["Constraint 1", "Constraint 2", "..."],
  "outOfScope": ["Excluded item 1", "Excluded item 2", "..."],
  "projectType": "greenfield" | "brownfield" | "undetermined",
  "complexity": "quick" | "standard" | "enterprise",
  "estimatedFeatures": <number>
}

Be thorough but concise. Include 3-8 items per array based on the conversation.`
}

/**
 * Build the prompt for generating Ralph Loop execution prompt
 */
function buildPromptGenerationPrompt(requirements: RequirementsDoc): string {
  return `Generate an optimized execution prompt for a Ralph Loop autonomous coding session.

## Requirements:
- Objective: ${requirements.objective}
- Scope: ${requirements.scope.join(', ')}
- Success Criteria: ${requirements.successCriteria.join('; ')}
- Constraints: ${requirements.constraints.join('; ')}
- Out of Scope: ${requirements.outOfScope.join(', ')}
- Project Type: ${requirements.projectType}
- Complexity: ${requirements.complexity}
- Estimated Features: ${requirements.estimatedFeatures}

## Generate a prompt with this structure:

\`\`\`markdown
## Task: [Clear, actionable task title]

### Requirements
[Bulleted list of specific requirements]

### Success Criteria
[Numbered list of verifiable success criteria]

### Constraints
[List of technical constraints and limitations]

### Out of Scope
[Explicitly excluded items to prevent scope creep]

### Implementation Notes
[Any specific implementation guidance]
\`\`\`

Also determine:
1. A completion promise phrase (e.g., "TASK_COMPLETE", "ALL_TESTS_PASSING")
2. Suggested maxIterations based on complexity (quick: 20, standard: 50, enterprise: 100)
3. Checkpoint threshold (0-100, higher = more checkpoints)

## Output Format (respond with ONLY this JSON, no other text):
{
  "prompt": "<the full markdown prompt>",
  "completionPromise": "<PROMISE_PHRASE>",
  "maxIterations": <number>,
  "checkpointThreshold": <number 0-100>,
  "successIndicators": ["indicator 1", "indicator 2", "..."]
}`
}

/**
 * Initiator Service Class
 */
export class InitiatorService extends EventEmitter {
  private sessions: Map<string, InitiatorSession> = new Map()
  private activeQueries: Map<string, Query> = new Map()

  constructor() {
    super()
  }

  /**
   * Send message to renderer process
   */
  private sendToRenderer(channel: string, data: unknown): void {
    const mainWindow = getMainWindow()
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, data)
    }
  }

  /**
   * Create or load an initiator session
   */
  async createSession(projectPath: string): Promise<InitiatorSession> {
    // Try to load existing session
    const existingSession = await loadSessionFromDisk(projectPath)

    if (existingSession && existingSession.phase !== 'approved') {
      console.log('[InitiatorService] Resuming session:', existingSession.id)
      this.sessions.set(existingSession.id, existingSession)
      return existingSession
    }

    // Create new session
    const id = generateId()
    const session: InitiatorSession = {
      id,
      projectPath,
      messages: [{
        id: generateId(),
        role: 'system',
        content: `Initiator session started for project: ${projectPath}`,
        timestamp: Date.now()
      }],
      phase: 'gathering',
      requirements: null,
      generatedPrompt: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      totalCostUsd: 0
    }

    this.sessions.set(id, session)
    await saveSessionToDisk(projectPath, session)

    return session
  }

  /**
   * Create fresh session, clearing any existing one
   */
  async createFreshSession(projectPath: string): Promise<InitiatorSession> {
    // Clear from memory
    for (const [sessionId, session] of this.sessions) {
      if (session.projectPath === projectPath) {
        this.sessions.delete(sessionId)
        this.cancelQuery(sessionId)
      }
    }

    // Create new session (will overwrite disk file)
    const id = generateId()
    const session: InitiatorSession = {
      id,
      projectPath,
      messages: [{
        id: generateId(),
        role: 'system',
        content: `Initiator session started for project: ${projectPath}`,
        timestamp: Date.now()
      }],
      phase: 'gathering',
      requirements: null,
      generatedPrompt: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      totalCostUsd: 0
    }

    this.sessions.set(id, session)
    await saveSessionToDisk(projectPath, session)

    return session
  }

  /**
   * Get existing session
   */
  getSession(sessionId: string): InitiatorSession | null {
    return this.sessions.get(sessionId) || null
  }

  /**
   * Cancel active query
   */
  cancelQuery(sessionId: string): void {
    const query = this.activeQueries.get(sessionId)
    if (query) {
      query.interrupt().catch(console.error)
      this.activeQueries.delete(sessionId)
      console.log('[InitiatorService] Query cancelled for session:', sessionId)
    }
  }

  /**
   * Process file attachments
   */
  async processAttachments(filePaths: string[]): Promise<InitiatorAttachment[]> {
    const attachments: InitiatorAttachment[] = []
    for (const filePath of filePaths) {
      const attachment = await processAttachment(filePath)
      attachments.push(attachment)
    }
    return attachments
  }

  /**
   * Send a message during requirements gathering phase
   */
  async sendMessage(sessionId: string, content: string, attachmentPaths?: string[]): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    if (session.phase !== 'gathering') {
      throw new Error(`Cannot send message in phase: ${session.phase}`)
    }

    // Process attachments if provided
    let attachments: InitiatorAttachment[] | undefined
    if (attachmentPaths && attachmentPaths.length > 0) {
      attachments = await this.processAttachments(attachmentPaths)
      console.log('[InitiatorService] Processed', attachments.length, 'attachments')
    }

    // Add user message to history
    const userMessage: InitiatorMessage = {
      id: generateId(),
      role: 'user',
      content,
      timestamp: Date.now(),
      attachments
    }
    session.messages.push(userMessage)

    const responseId = generateId()

    try {
      const prompt = buildGatheringPrompt(session)

      // Debug: log prompt length and attachment info
      console.log('[InitiatorService] Starting gathering query')
      console.log('[InitiatorService] User message has', attachments?.length || 0, 'attachments')
      if (attachments && attachments.length > 0) {
        attachments.forEach(att => {
          console.log('[InitiatorService] Attachment:', att.fileName,
            'type:', att.attachmentType,
            'hasContent:', !!att.textContent,
            'contentLen:', att.textContent?.length || 0,
            'error:', att.error || 'none')
        })
      }
      console.log('[InitiatorService] Prompt length:', prompt.length)
      // Log first 500 and last 500 chars of prompt for debugging
      if (prompt.length > 1000) {
        console.log('[InitiatorService] Prompt start:', prompt.substring(0, 500))
        console.log('[InitiatorService] Prompt end:', prompt.substring(prompt.length - 500))
      } else {
        console.log('[InitiatorService] Full prompt:', prompt)
      }

      // Notify UI that we're starting
      this.sendToRenderer(INITIATOR_CHANNELS.RESPONSE_CHUNK, {
        sessionId,
        messageId: responseId,
        chunk: '',
        fullContent: '',
        eventType: 'system',
        timestamp: Date.now()
      })

      // Get SDK and create query
      const sdk = await getSDK()

      const options: Options = {
        model: HAIKU_MODEL,
        maxTurns: MAX_TURNS,
        cwd: session.projectPath,
        includePartialMessages: true,
        permissionMode: 'default',
        tools: []
      }

      // Create async generator for streaming input (SDK format)
      async function* generateMessages(): AsyncGenerator<SDKUserMessage> {
        yield {
          type: 'user' as const,
          message: {
            role: 'user' as const,
            content: prompt
          },
          parent_tool_use_id: null,
          session_id: sessionId
        }
      }

      const query = sdk.query({ prompt: generateMessages(), options })
      this.activeQueries.set(sessionId, query)

      let fullResponse = ''

      // Process streaming response
      for await (const message of query) {
        // Handle streaming partial messages (token-by-token)
        if (message.type === 'stream_event' && message.event) {
          const event = message.event as { type: string; delta?: { type?: string; text?: string } }

          if (event.type === 'content_block_delta' && event.delta?.text) {
            const delta = event.delta.text
            fullResponse += delta

            this.sendToRenderer(INITIATOR_CHANNELS.RESPONSE_CHUNK, {
              sessionId,
              messageId: responseId,
              chunk: delta,
              fullContent: fullResponse,
              eventType: 'text',
              timestamp: Date.now()
            })
          }
        }

        // Handle complete assistant message (fallback)
        if (message.type === 'assistant' && message.message?.content) {
          for (const block of message.message.content) {
            if (block.type === 'text' && 'text' in block) {
              const newText = block.text as string
              if (newText.length > fullResponse.length) {
                const delta = newText.slice(fullResponse.length)
                fullResponse = newText

                this.sendToRenderer(INITIATOR_CHANNELS.RESPONSE_CHUNK, {
                  sessionId,
                  messageId: responseId,
                  chunk: delta,
                  fullContent: fullResponse,
                  eventType: 'text',
                  timestamp: Date.now()
                })
              }
            }
          }
        }
      }

      // Clean up
      this.activeQueries.delete(sessionId)

      // Check if assistant is ready to summarize
      const isReadyToSummarize = fullResponse.includes('READY_TO_SUMMARIZE:')

      // Check if user said "yes" to proceed - auto-trigger summarization
      const userSaidYes = content.toLowerCase().trim() === 'yes' ||
                          content.toLowerCase().trim() === 'y' ||
                          content.toLowerCase().includes('proceed') ||
                          content.toLowerCase().includes('looks good')

      // Add assistant message to history
      const assistantMessage: InitiatorMessage = {
        id: responseId,
        role: 'assistant',
        content: fullResponse.replace('READY_TO_SUMMARIZE:', '').trim(),
        timestamp: Date.now()
      }
      session.messages.push(assistantMessage)

      // Save session
      await saveSessionToDisk(session.projectPath, session)

      // Notify completion
      this.sendToRenderer(INITIATOR_CHANNELS.RESPONSE_COMPLETE, {
        sessionId,
        messageId: responseId,
        content: assistantMessage.content,
        isReadyToSummarize,
        timestamp: Date.now()
      })

      // Auto-trigger summarization if user confirmed and we have tasks extracted
      if (userSaidYes && session.messages.length >= 3) {
        console.log('[InitiatorService] User confirmed, auto-triggering summarization...')
        // Small delay to let UI update
        setTimeout(async () => {
          try {
            await this.summarizeRequirements(sessionId)
            // After summarization, also auto-generate the prompt
            const updatedSession = this.sessions.get(sessionId)
            if (updatedSession?.requirements) {
              console.log('[InitiatorService] Auto-generating Ralph prompt...')
              await this.generateRalphPrompt(sessionId)
            }
          } catch (err) {
            console.error('[InitiatorService] Auto-summarization failed:', err)
          }
        }, 100)
      }

    } catch (error) {
      console.error('[InitiatorService] Error in sendMessage:', error)
      this.activeQueries.delete(sessionId)

      this.sendToRenderer(INITIATOR_CHANNELS.ERROR, {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
        timestamp: Date.now()
      })
    }
  }

  /**
   * Summarize gathered requirements
   */
  async summarizeRequirements(sessionId: string): Promise<RequirementsDoc> {
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    session.phase = 'summarizing'

    try {
      const prompt = buildSummarizationPrompt(session)

      console.log('[InitiatorService] Starting summarization')

      const sdk = await getSDK()

      const options: Options = {
        model: SONNET_MODEL, // Use Sonnet for better JSON generation
        maxTurns: MAX_TURNS,
        cwd: session.projectPath,
        permissionMode: 'default',
        tools: []
      }

      async function* generateMessages(): AsyncGenerator<SDKUserMessage> {
        yield {
          type: 'user' as const,
          message: {
            role: 'user' as const,
            content: prompt
          },
          parent_tool_use_id: null,
          session_id: sessionId
        }
      }

      const query = sdk.query({ prompt: generateMessages(), options })

      let fullResponse = ''

      for await (const message of query) {
        // Handle complete assistant message
        if (message.type === 'assistant' && message.message?.content) {
          for (const block of message.message.content) {
            if (block.type === 'text' && 'text' in block) {
              fullResponse = block.text as string
            }
          }
        }
        // Handle result
        if (message.type === 'result' && 'result' in message && !fullResponse) {
          fullResponse = message.result as string
        }
      }

      // Parse JSON response
      const jsonMatch = fullResponse.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        throw new Error('Failed to parse requirements JSON from response')
      }

      const requirements: RequirementsDoc = {
        ...JSON.parse(jsonMatch[0]),
        gatheredAt: Date.now()
      }

      session.requirements = requirements
      await saveSessionToDisk(session.projectPath, session)

      // Notify UI
      this.sendToRenderer(INITIATOR_CHANNELS.REQUIREMENTS_READY, {
        sessionId,
        requirements,
        timestamp: Date.now()
      })

      return requirements

    } catch (error) {
      console.error('[InitiatorService] Error in summarizeRequirements:', error)
      session.phase = 'gathering' // Rollback phase

      this.sendToRenderer(INITIATOR_CHANNELS.ERROR, {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
        timestamp: Date.now()
      })

      throw error
    }
  }

  /**
   * Generate Ralph Loop prompt from requirements
   */
  async generateRalphPrompt(sessionId: string): Promise<RalphPromptConfig> {
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    if (!session.requirements) {
      throw new Error('Requirements must be summarized before generating prompt')
    }

    session.phase = 'generating'

    try {
      const prompt = buildPromptGenerationPrompt(session.requirements)

      console.log('[InitiatorService] Generating Ralph prompt')

      const sdk = await getSDK()

      const options: Options = {
        model: SONNET_MODEL,
        maxTurns: MAX_TURNS,
        cwd: session.projectPath,
        permissionMode: 'default',
        tools: []
      }

      async function* generateMessages(): AsyncGenerator<SDKUserMessage> {
        yield {
          type: 'user' as const,
          message: {
            role: 'user' as const,
            content: prompt
          },
          parent_tool_use_id: null,
          session_id: sessionId
        }
      }

      const query = sdk.query({ prompt: generateMessages(), options })

      let fullResponse = ''

      for await (const message of query) {
        // Handle complete assistant message
        if (message.type === 'assistant' && message.message?.content) {
          for (const block of message.message.content) {
            if (block.type === 'text' && 'text' in block) {
              fullResponse = block.text as string
            }
          }
        }
        // Handle result
        if (message.type === 'result' && 'result' in message && !fullResponse) {
          fullResponse = message.result as string
        }
      }

      // Parse JSON response
      const jsonMatch = fullResponse.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        throw new Error('Failed to parse Ralph prompt JSON from response')
      }

      const promptConfig: RalphPromptConfig = {
        ...JSON.parse(jsonMatch[0]),
        generatedAt: Date.now()
      }

      session.generatedPrompt = promptConfig
      session.phase = 'reviewing'
      await saveSessionToDisk(session.projectPath, session)

      // Also save the prompt as a markdown file
      await saveRalphPromptToDisk(session.projectPath, promptConfig)

      // Notify UI
      this.sendToRenderer(INITIATOR_CHANNELS.PROMPT_READY, {
        sessionId,
        promptConfig,
        timestamp: Date.now()
      })

      return promptConfig

    } catch (error) {
      console.error('[InitiatorService] Error in generateRalphPrompt:', error)
      session.phase = 'summarizing' // Rollback phase

      this.sendToRenderer(INITIATOR_CHANNELS.ERROR, {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
        timestamp: Date.now()
      })

      throw error
    }
  }

  /**
   * Update the generated prompt (user edits)
   */
  async updatePrompt(sessionId: string, updates: Partial<RalphPromptConfig>): Promise<RalphPromptConfig> {
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    if (!session.generatedPrompt) {
      throw new Error('No prompt to update')
    }

    session.generatedPrompt = {
      ...session.generatedPrompt,
      ...updates,
      generatedAt: Date.now()
    }

    await saveSessionToDisk(session.projectPath, session)
    await saveRalphPromptToDisk(session.projectPath, session.generatedPrompt)

    return session.generatedPrompt
  }

  /**
   * Approve the prompt and mark session as ready for execution
   */
  async approvePrompt(sessionId: string): Promise<{ session: InitiatorSession; promptPath: string }> {
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    if (!session.generatedPrompt) {
      throw new Error('No prompt to approve')
    }

    session.phase = 'approved'
    await saveSessionToDisk(session.projectPath, session)

    const promptPath = path.join(session.projectPath, AUTONOMOUS_DIR, RALPH_PROMPT_FILE)

    console.log('[InitiatorService] Prompt approved, ready for execution')

    return { session, promptPath }
  }
}

// Singleton instance
let initiatorService: InitiatorService | null = null

export function getInitiatorService(): InitiatorService {
  if (!initiatorService) {
    initiatorService = new InitiatorService()
  }
  return initiatorService
}

/**
 * IPC Handlers for Initiator Service
 *
 * Provides IPC bridge between renderer and InitiatorService.
 * Handles the conversational requirements gathering flow for Ralph Loop execution.
 *
 * Flow:
 * 1. Start session -> Ask clarifying questions
 * 2. Send messages -> Build requirements
 * 3. Summarize -> Generate structured requirements doc
 * 4. Generate prompt -> Create optimized Ralph Loop prompt
 * 5. Approve -> Ready for execution
 */

import { ipcMain } from 'electron'
import {
  getInitiatorService,
  INITIATOR_CHANNELS,
  type InitiatorSession,
  type RequirementsDoc,
  type RalphPromptConfig
} from '../services/initiator-service'

// Result types for IPC handlers
interface SuccessResult<T> {
  success: true
  data: T
}

interface ErrorResult {
  success: false
  error: string
}

type IpcResult<T> = SuccessResult<T> | ErrorResult

/**
 * Extract error message safely from unknown error type
 */
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return String(error)
}

/**
 * Register all initiator IPC handlers
 */
export function registerInitiatorHandlers(): void {
  const initiatorService = getInitiatorService()

  // ============================================================================
  // Session Management
  // ============================================================================

  /**
   * Start or resume an initiator session for a project
   * Returns existing session if one exists and is not approved
   */
  ipcMain.handle(
    INITIATOR_CHANNELS.START,
    async (
      _event,
      projectPath: string,
      options?: { forceNew?: boolean }
    ): Promise<IpcResult<InitiatorSession>> => {
      try {
        console.log('[InitiatorHandler] Starting session for:', projectPath)

        let session: InitiatorSession
        if (options?.forceNew) {
          session = await initiatorService.createFreshSession(projectPath)
        } else {
          session = await initiatorService.createSession(projectPath)
        }

        console.log('[InitiatorHandler] Session created/resumed:', session.id, 'phase:', session.phase)
        return { success: true, data: session }
      } catch (error) {
        console.error('[InitiatorHandler] Error starting session:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  /**
   * Get current session by ID
   */
  ipcMain.handle(
    INITIATOR_CHANNELS.GET_SESSION,
    async (_event, sessionId: string): Promise<IpcResult<InitiatorSession | null>> => {
      try {
        const session = initiatorService.getSession(sessionId)
        return { success: true, data: session }
      } catch (error) {
        console.error('[InitiatorHandler] Error getting session:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  /**
   * Cancel active session/query
   */
  ipcMain.handle(
    INITIATOR_CHANNELS.CANCEL,
    async (_event, sessionId: string): Promise<IpcResult<void>> => {
      try {
        initiatorService.cancelQuery(sessionId)
        return { success: true, data: undefined }
      } catch (error) {
        console.error('[InitiatorHandler] Error cancelling session:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  // ============================================================================
  // Requirements Gathering (Chat Phase)
  // ============================================================================

  /**
   * Send a message during the gathering phase
   * Triggers Claude to respond with clarifying questions
   * Response streams via INITIATOR_CHANNELS.RESPONSE_CHUNK events
   */
  ipcMain.handle(
    INITIATOR_CHANNELS.SEND_MESSAGE,
    async (
      _event,
      sessionId: string,
      content: string,
      attachmentPaths?: string[]
    ): Promise<IpcResult<void>> => {
      try {
        console.log('[InitiatorHandler] Sending message to session:', sessionId)
        console.log('[InitiatorHandler] Message content:', content.substring(0, 100))
        if (attachmentPaths && attachmentPaths.length > 0) {
          console.log('[InitiatorHandler] With attachments:', attachmentPaths.length)
          attachmentPaths.forEach((p, i) => console.log(`[InitiatorHandler] Attachment ${i}:`, p))
        } else {
          console.log('[InitiatorHandler] No attachments provided')
        }

        // This is async - responses stream via events
        await initiatorService.sendMessage(sessionId, content, attachmentPaths)

        return { success: true, data: undefined }
      } catch (error) {
        console.error('[InitiatorHandler] Error sending message:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  // ============================================================================
  // Requirements Summary
  // ============================================================================

  /**
   * Summarize gathered requirements into structured document
   * Transitions session from 'gathering' to 'summarizing'
   */
  ipcMain.handle(
    INITIATOR_CHANNELS.SUMMARIZE,
    async (_event, sessionId: string): Promise<IpcResult<RequirementsDoc>> => {
      try {
        console.log('[InitiatorHandler] Summarizing requirements for session:', sessionId)

        const requirements = await initiatorService.summarizeRequirements(sessionId)

        console.log('[InitiatorHandler] Requirements summarized:', {
          objective: requirements.objective,
          scopeCount: requirements.scope.length,
          complexity: requirements.complexity
        })

        return { success: true, data: requirements }
      } catch (error) {
        console.error('[InitiatorHandler] Error summarizing requirements:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  // ============================================================================
  // Prompt Generation
  // ============================================================================

  /**
   * Generate optimized Ralph Loop prompt from requirements
   * Transitions session from 'summarizing' to 'generating' then 'reviewing'
   */
  ipcMain.handle(
    INITIATOR_CHANNELS.GENERATE_PROMPT,
    async (_event, sessionId: string): Promise<IpcResult<RalphPromptConfig>> => {
      try {
        console.log('[InitiatorHandler] Generating Ralph prompt for session:', sessionId)

        const promptConfig = await initiatorService.generateRalphPrompt(sessionId)

        console.log('[InitiatorHandler] Prompt generated:', {
          completionPromise: promptConfig.completionPromise,
          maxIterations: promptConfig.maxIterations,
          checkpointThreshold: promptConfig.checkpointThreshold
        })

        return { success: true, data: promptConfig }
      } catch (error) {
        console.error('[InitiatorHandler] Error generating prompt:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  /**
   * Update the generated prompt (user edits before approval)
   */
  ipcMain.handle(
    'initiator:update-prompt',
    async (
      _event,
      sessionId: string,
      updates: Partial<RalphPromptConfig>
    ): Promise<IpcResult<RalphPromptConfig>> => {
      try {
        console.log('[InitiatorHandler] Updating prompt for session:', sessionId)

        const promptConfig = await initiatorService.updatePrompt(sessionId, updates)

        return { success: true, data: promptConfig }
      } catch (error) {
        console.error('[InitiatorHandler] Error updating prompt:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  // ============================================================================
  // Approval & Execution Handoff
  // ============================================================================

  /**
   * Approve the prompt and mark session as ready for Ralph Loop execution
   * Returns the session and prompt file path for the orchestrator
   */
  ipcMain.handle(
    INITIATOR_CHANNELS.APPROVE_PROMPT,
    async (
      _event,
      sessionId: string
    ): Promise<IpcResult<{ session: InitiatorSession; promptPath: string }>> => {
      try {
        console.log('[InitiatorHandler] Approving prompt for session:', sessionId)

        const result = await initiatorService.approvePrompt(sessionId)

        console.log('[InitiatorHandler] Prompt approved, ready for execution at:', result.promptPath)

        return { success: true, data: result }
      } catch (error) {
        console.error('[InitiatorHandler] Error approving prompt:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  console.log('[InitiatorHandler] All handlers registered')
}

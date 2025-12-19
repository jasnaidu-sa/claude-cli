/**
 * Discovery Chat IPC Handlers
 *
 * Handles IPC communication between renderer and the discovery chat service.
 */

import { ipcMain } from 'electron'
import { DiscoveryChatService, DISCOVERY_CHAT_CHANNELS, loadSessionFromDisk, listDrafts, loadDraft, deleteDraft, type DraftMetadata } from '../services/discovery-chat-service'

// IPC channel names - use service channels plus handler-specific ones
export const DISCOVERY_IPC_CHANNELS = {
  // Handler-specific channels (not in service channels)
  SEND_MESSAGE: 'discovery:send-message',
  GET_MESSAGES: 'discovery:get-messages',
  GET_SESSION: 'discovery:get-session',
  CHECK_EXISTING_SESSION: 'discovery:check-existing-session',
  CANCEL_REQUEST: 'discovery:cancel-request',
  CLOSE_SESSION: 'discovery:close-session',
  UPDATE_AGENT_STATUS: 'discovery:update-agent-status',
  // Draft management channels
  LIST_DRAFTS: 'discovery:list-drafts',
  LOAD_DRAFT: 'discovery:load-draft',
  DELETE_DRAFT: 'discovery:delete-draft',
  // Events and shared channels from service (includes CREATE_SESSION, CREATE_FRESH_SESSION)
  ...DISCOVERY_CHAT_CHANNELS
} as const

let discoveryChatService: DiscoveryChatService | null = null

export function setupDiscoveryHandlers(service: DiscoveryChatService): void {
  discoveryChatService = service

  // Check if an existing session exists for a project (without creating a new one)
  ipcMain.handle(DISCOVERY_IPC_CHANNELS.CHECK_EXISTING_SESSION, async (_event, projectPath: string) => {
    try {
      console.log('[DiscoveryHandler] Checking for existing session at:', projectPath)
      const existingSession = await loadSessionFromDisk(projectPath)

      if (existingSession) {
        console.log('[DiscoveryHandler] Found session with', existingSession.messages.length, 'messages')
        const userMessages = existingSession.messages.filter(m => m.role === 'user').length
        const assistantMessages = existingSession.messages.filter(m => m.role === 'assistant').length
        console.log('[DiscoveryHandler] User messages:', userMessages, 'Assistant messages:', assistantMessages)

        if (existingSession.messages.length > 1) {
          // Only return if there are meaningful messages (more than just system message)
          return {
            success: true,
            exists: true,
            session: {
              id: existingSession.id,
              projectPath: existingSession.projectPath,
              isNewProject: existingSession.isNewProject,
              messageCount: existingSession.messages.length,
              userMessageCount: userMessages,
              assistantMessageCount: assistantMessages,
              createdAt: existingSession.createdAt,
              discoveryReady: existingSession.discoveryReady
            }
          }
        }
      } else {
        console.log('[DiscoveryHandler] No existing session found')
      }
      return { success: true, exists: false }
    } catch (error) {
      console.error('[DiscoveryHandler] Error checking session:', error)
      const message = error instanceof Error ? error.message : 'Failed to check session'
      return { success: false, error: message }
    }
  })

  // Create a new discovery session (may load existing from disk)
  ipcMain.handle(DISCOVERY_IPC_CHANNELS.CREATE_SESSION, async (_event, projectPath: string, isNewProject: boolean) => {
    try {
      const session = await discoveryChatService!.createSession(projectPath, isNewProject)
      return { success: true, session }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create session'
      return { success: false, error: message }
    }
  })

  // Create a fresh session, clearing any existing one
  ipcMain.handle(DISCOVERY_IPC_CHANNELS.CREATE_FRESH_SESSION, async (_event, projectPath: string, isNewProject: boolean) => {
    try {
      const session = await discoveryChatService!.createFreshSession(projectPath, isNewProject)
      return { success: true, session }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create fresh session'
      return { success: false, error: message }
    }
  })

  // Send a message to Claude
  ipcMain.handle(DISCOVERY_IPC_CHANNELS.SEND_MESSAGE, async (_event, sessionId: string, content: string) => {
    try {
      await discoveryChatService!.sendMessage(sessionId, content)
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to send message'
      return { success: false, error: message }
    }
  })

  // Get all messages for a session
  ipcMain.handle(DISCOVERY_IPC_CHANNELS.GET_MESSAGES, async (_event, sessionId: string) => {
    try {
      const messages = discoveryChatService!.getMessages(sessionId)
      return { success: true, messages }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get messages'
      return { success: false, error: message }
    }
  })

  // Get session info
  ipcMain.handle(DISCOVERY_IPC_CHANNELS.GET_SESSION, async (_event, sessionId: string) => {
    try {
      const session = discoveryChatService!.getSession(sessionId)
      return { success: true, session }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get session'
      return { success: false, error: message }
    }
  })

  // Cancel active request
  ipcMain.handle(DISCOVERY_IPC_CHANNELS.CANCEL_REQUEST, async () => {
    try {
      discoveryChatService!.cancelRequest()
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to cancel request'
      return { success: false, error: message }
    }
  })

  // Close a session
  ipcMain.handle(DISCOVERY_IPC_CHANNELS.CLOSE_SESSION, async (_event, sessionId: string) => {
    try {
      discoveryChatService!.closeSession(sessionId)
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to close session'
      return { success: false, error: message }
    }
  })

  // Update agent status (called internally, but exposed for flexibility)
  ipcMain.handle(DISCOVERY_IPC_CHANNELS.UPDATE_AGENT_STATUS, async (
    _event,
    sessionId: string,
    agentName: string,
    status: 'idle' | 'running' | 'complete' | 'error',
    output?: string,
    error?: string
  ) => {
    try {
      discoveryChatService!.updateAgentStatus(sessionId, agentName, status, output, error)
      return { success: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update agent status'
      return { success: false, error: message }
    }
  })

  // List all drafts for a project
  ipcMain.handle(DISCOVERY_IPC_CHANNELS.LIST_DRAFTS, async (_event, projectPath: string) => {
    try {
      console.log('[DiscoveryHandler] Listing drafts for:', projectPath)
      const drafts = await listDrafts(projectPath)
      console.log('[DiscoveryHandler] Found', drafts.length, 'drafts')
      return { success: true, drafts }
    } catch (error) {
      console.error('[DiscoveryHandler] Error listing drafts:', error)
      const message = error instanceof Error ? error.message : 'Failed to list drafts'
      return { success: false, error: message }
    }
  })

  // Load a specific draft
  ipcMain.handle(DISCOVERY_IPC_CHANNELS.LOAD_DRAFT, async (_event, projectPath: string, draftId: string) => {
    try {
      console.log('[DiscoveryHandler] Loading draft:', draftId, 'from:', projectPath)
      const session = await loadDraft(projectPath, draftId)
      if (session) {
        return { success: true, session }
      }
      return { success: false, error: 'Draft not found' }
    } catch (error) {
      console.error('[DiscoveryHandler] Error loading draft:', error)
      const message = error instanceof Error ? error.message : 'Failed to load draft'
      return { success: false, error: message }
    }
  })

  // Delete a draft
  ipcMain.handle(DISCOVERY_IPC_CHANNELS.DELETE_DRAFT, async (_event, projectPath: string, draftId: string) => {
    try {
      console.log('[DiscoveryHandler] Deleting draft:', draftId, 'from:', projectPath)
      const success = await deleteDraft(projectPath, draftId)
      return { success }
    } catch (error) {
      console.error('[DiscoveryHandler] Error deleting draft:', error)
      const message = error instanceof Error ? error.message : 'Failed to delete draft'
      return { success: false, error: message }
    }
  })
}

export function getDiscoveryChatService(): DiscoveryChatService | null {
  return discoveryChatService
}

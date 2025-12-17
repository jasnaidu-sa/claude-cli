/**
 * Discovery Chat IPC Handlers
 *
 * Handles IPC communication between renderer and the discovery chat service.
 */

import { ipcMain } from 'electron'
import { DiscoveryChatService, DISCOVERY_CHAT_CHANNELS } from '../services/discovery-chat-service'

// IPC channel names
export const DISCOVERY_IPC_CHANNELS = {
  CREATE_SESSION: 'discovery:create-session',
  SEND_MESSAGE: 'discovery:send-message',
  GET_MESSAGES: 'discovery:get-messages',
  GET_SESSION: 'discovery:get-session',
  CANCEL_REQUEST: 'discovery:cancel-request',
  CLOSE_SESSION: 'discovery:close-session',
  UPDATE_AGENT_STATUS: 'discovery:update-agent-status',
  // Events (renderer listens)
  ...DISCOVERY_CHAT_CHANNELS
} as const

let discoveryChatService: DiscoveryChatService | null = null

export function setupDiscoveryHandlers(service: DiscoveryChatService): void {
  discoveryChatService = service

  // Create a new discovery session
  ipcMain.handle(DISCOVERY_IPC_CHANNELS.CREATE_SESSION, async (_event, projectPath: string, isNewProject: boolean) => {
    try {
      const session = discoveryChatService!.createSession(projectPath, isNewProject)
      return { success: true, session }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create session'
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
}

export function getDiscoveryChatService(): DiscoveryChatService | null {
  return discoveryChatService
}

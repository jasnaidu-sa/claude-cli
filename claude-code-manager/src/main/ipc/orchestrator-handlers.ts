/**
 * IPC Handlers for Python Orchestrator Runner
 *
 * Provides IPC bridge between renderer and orchestrator service.
 * Events are forwarded directly by the OrchestratorRunner service.
 */

import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/types'
import { orchestratorRunner } from '../services/orchestrator-runner'
import type { OrchestratorConfig, OrchestratorSession } from '../services/orchestrator-runner'

/**
 * Extract error message safely from unknown error type
 */
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return String(error)
}

export function registerOrchestratorHandlers(): void {
  // Start orchestrator session
  ipcMain.handle(IPC_CHANNELS.ORCHESTRATOR_START, async (_event, config: OrchestratorConfig): Promise<{ success: boolean; session?: OrchestratorSession; error?: string }> => {
    try {
      const session = await orchestratorRunner.start(config)
      return { success: true, session }
    } catch (error) {
      console.error('[OrchestratorHandler] Error starting session:', error)
      return { success: false, error: getErrorMessage(error) }
    }
  })

  // Stop orchestrator session
  ipcMain.handle(IPC_CHANNELS.ORCHESTRATOR_STOP, async (_event, sessionId: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const stopped = await orchestratorRunner.stop(sessionId)
      if (!stopped) {
        return { success: false, error: 'Session not found or not running' }
      }
      return { success: true }
    } catch (error) {
      console.error('[OrchestratorHandler] Error stopping session:', error)
      return { success: false, error: getErrorMessage(error) }
    }
  })

  // Pause orchestrator session
  ipcMain.handle(IPC_CHANNELS.ORCHESTRATOR_PAUSE, async (_event, sessionId: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const paused = await orchestratorRunner.pause(sessionId)
      if (!paused) {
        return { success: false, error: 'Session not found or not running' }
      }
      return { success: true }
    } catch (error) {
      console.error('[OrchestratorHandler] Error pausing session:', error)
      return { success: false, error: getErrorMessage(error) }
    }
  })

  // Get session by ID
  ipcMain.handle(IPC_CHANNELS.ORCHESTRATOR_GET_SESSION, async (_event, sessionId: string): Promise<OrchestratorSession | null> => {
    return orchestratorRunner.getSession(sessionId) || null
  })

  // Get all sessions
  ipcMain.handle(IPC_CHANNELS.ORCHESTRATOR_GET_ALL_SESSIONS, async (): Promise<OrchestratorSession[]> => {
    return orchestratorRunner.getAllSessions()
  })

  // Get sessions for workflow
  ipcMain.handle(IPC_CHANNELS.ORCHESTRATOR_GET_WORKFLOW_SESSIONS, async (_event, workflowId: string): Promise<OrchestratorSession[]> => {
    return orchestratorRunner.getWorkflowSessions(workflowId)
  })

  // Cleanup completed sessions
  ipcMain.handle(IPC_CHANNELS.ORCHESTRATOR_CLEANUP, async (): Promise<{ success: boolean }> => {
    orchestratorRunner.cleanup()
    return { success: true }
  })

  // Note: Event forwarding (output, progress, session) is handled directly
  // by OrchestratorRunner via mainWindow.webContents.send()
}

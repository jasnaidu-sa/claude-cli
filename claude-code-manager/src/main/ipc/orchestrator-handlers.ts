/**
 * IPC Handlers for Python Orchestrator Runner
 *
 * Provides IPC bridge between renderer and orchestrator service.
 */

import { ipcMain } from 'electron'
import { orchestratorRunner } from '../services/orchestrator-runner'
import type { OrchestratorConfig, OrchestratorSession, OrchestratorOutput, OrchestratorProgress } from '../services/orchestrator-runner'
import { getMainWindow } from '../index'

// IPC Channel constants for orchestrator
export const ORCHESTRATOR_CHANNELS = {
  START: 'orchestrator:start',
  STOP: 'orchestrator:stop',
  PAUSE: 'orchestrator:pause',
  GET_SESSION: 'orchestrator:get-session',
  GET_ALL_SESSIONS: 'orchestrator:get-all-sessions',
  GET_WORKFLOW_SESSIONS: 'orchestrator:get-workflow-sessions',
  CLEANUP: 'orchestrator:cleanup',
  // Events (renderer listens)
  OUTPUT: 'orchestrator:output',
  PROGRESS: 'orchestrator:progress',
  SESSION: 'orchestrator:session'
} as const

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
  ipcMain.handle(ORCHESTRATOR_CHANNELS.START, async (_event, config: OrchestratorConfig): Promise<{ success: boolean; session?: OrchestratorSession; error?: string }> => {
    try {
      const session = await orchestratorRunner.start(config)
      return { success: true, session }
    } catch (error) {
      console.error('[OrchestratorHandler] Error starting session:', error)
      return { success: false, error: getErrorMessage(error) }
    }
  })

  // Stop orchestrator session
  ipcMain.handle(ORCHESTRATOR_CHANNELS.STOP, async (_event, sessionId: string): Promise<{ success: boolean; error?: string }> => {
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
  ipcMain.handle(ORCHESTRATOR_CHANNELS.PAUSE, async (_event, sessionId: string): Promise<{ success: boolean; error?: string }> => {
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
  ipcMain.handle(ORCHESTRATOR_CHANNELS.GET_SESSION, async (_event, sessionId: string): Promise<OrchestratorSession | null> => {
    return orchestratorRunner.getSession(sessionId) || null
  })

  // Get all sessions
  ipcMain.handle(ORCHESTRATOR_CHANNELS.GET_ALL_SESSIONS, async (): Promise<OrchestratorSession[]> => {
    return orchestratorRunner.getAllSessions()
  })

  // Get sessions for workflow
  ipcMain.handle(ORCHESTRATOR_CHANNELS.GET_WORKFLOW_SESSIONS, async (_event, workflowId: string): Promise<OrchestratorSession[]> => {
    return orchestratorRunner.getWorkflowSessions(workflowId)
  })

  // Cleanup completed sessions
  ipcMain.handle(ORCHESTRATOR_CHANNELS.CLEANUP, async (): Promise<{ success: boolean }> => {
    orchestratorRunner.cleanup()
    return { success: true }
  })

  // Forward orchestrator events to renderer
  orchestratorRunner.on('output', (output: OrchestratorOutput) => {
    const mainWindow = getMainWindow()
    if (mainWindow) {
      mainWindow.webContents.send(ORCHESTRATOR_CHANNELS.OUTPUT, output)
    }
  })

  orchestratorRunner.on('progress', (progress: OrchestratorProgress) => {
    const mainWindow = getMainWindow()
    if (mainWindow) {
      mainWindow.webContents.send(ORCHESTRATOR_CHANNELS.PROGRESS, progress)
    }
  })

  orchestratorRunner.on('session', (session: OrchestratorSession) => {
    const mainWindow = getMainWindow()
    if (mainWindow) {
      mainWindow.webContents.send(ORCHESTRATOR_CHANNELS.SESSION, session)
    }
  })
}

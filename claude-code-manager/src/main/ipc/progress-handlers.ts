/**
 * IPC Handlers for Progress Watcher
 *
 * Provides IPC bridge between renderer and ProgressWatcher service.
 * Handles watch/unwatch operations and progress queries.
 */

import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/types'
import { progressWatcher } from '../services/progress-watcher'
import type { ProgressSnapshot } from '@shared/types'

/**
 * Extract error message safely from unknown error type
 */
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return String(error)
}

export function registerProgressHandlers(): void {
  // Start watching a workflow
  ipcMain.handle(
    IPC_CHANNELS.PROGRESS_WATCH,
    async (_event, workflowId: string, projectPath: string): Promise<{ success: boolean; snapshot?: ProgressSnapshot | null; error?: string }> => {
      try {
        const snapshot = await progressWatcher.watch(workflowId, projectPath)
        return { success: true, snapshot }
      } catch (error) {
        console.error('[ProgressHandler] Error starting watch:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  // Stop watching a workflow
  ipcMain.handle(
    IPC_CHANNELS.PROGRESS_UNWATCH,
    async (_event, workflowId: string): Promise<{ success: boolean; error?: string }> => {
      try {
        await progressWatcher.unwatch(workflowId)
        return { success: true }
      } catch (error) {
        console.error('[ProgressHandler] Error stopping watch:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  // Get current progress for a workflow
  ipcMain.handle(
    IPC_CHANNELS.PROGRESS_GET,
    async (_event, workflowId: string): Promise<ProgressSnapshot | null> => {
      try {
        return await progressWatcher.getProgress(workflowId)
      } catch (error) {
        console.error('[ProgressHandler] Error getting progress:', error)
        return null
      }
    }
  )

  // Note: PROGRESS_UPDATE is emitted by the service, not handled here
}

/**
 * IPC Handlers for Python Virtual Environment Management
 *
 * Security & Robustness:
 * - Safe error message extraction (no unsafe type assertions)
 * - Logging when progress events cannot be delivered
 */

import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/types'
import { venvManager } from '../services/venv-manager'
import type { VenvStatus, VenvCreationProgress } from '../services/venv-manager'
import { getMainWindow } from '../index'

/**
 * Extract error message safely from unknown error type
 * Avoids unsafe `as Error` type assertions
 */
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return String(error)
}

export function registerVenvHandlers(): void {
  // Get venv status
  ipcMain.handle(IPC_CHANNELS.VENV_STATUS, async (): Promise<VenvStatus> => {
    try {
      return await venvManager.getStatus()
    } catch (error) {
      console.error('[VenvHandler] Error getting status:', error)
      return {
        exists: false,
        pythonPath: null,
        pythonVersion: null,
        isValid: false,
        installedPackages: [],
        missingPackages: [],
        error: getErrorMessage(error)
      }
    }
  })

  // Ensure venv exists (create if needed)
  ipcMain.handle(IPC_CHANNELS.VENV_ENSURE, async (): Promise<VenvStatus> => {
    try {
      // Set up progress listener with null-window logging (P1 fix)
      const progressHandler = (progress: VenvCreationProgress) => {
        const mainWindow = getMainWindow()
        if (mainWindow) {
          mainWindow.webContents.send(IPC_CHANNELS.VENV_PROGRESS, progress)
        } else {
          console.warn('[VenvHandler] Cannot send progress - main window not available:', progress.message)
        }
      }

      venvManager.on('progress', progressHandler)

      try {
        const result = await venvManager.ensureVenv()
        return result
      } finally {
        venvManager.off('progress', progressHandler)
      }
    } catch (error) {
      console.error('[VenvHandler] Error ensuring venv:', error)
      return {
        exists: false,
        pythonPath: null,
        pythonVersion: null,
        isValid: false,
        installedPackages: [],
        missingPackages: [],
        error: getErrorMessage(error)
      }
    }
  })

  // Upgrade packages
  ipcMain.handle(IPC_CHANNELS.VENV_UPGRADE, async (): Promise<{ success: boolean; error?: string }> => {
    try {
      // Set up progress listener with null-window logging (P1 fix)
      const progressHandler = (progress: VenvCreationProgress) => {
        const mainWindow = getMainWindow()
        if (mainWindow) {
          mainWindow.webContents.send(IPC_CHANNELS.VENV_PROGRESS, progress)
        } else {
          console.warn('[VenvHandler] Cannot send progress - main window not available:', progress.message)
        }
      }

      venvManager.on('progress', progressHandler)

      try {
        await venvManager.upgradePackages()
        return { success: true }
      } finally {
        venvManager.off('progress', progressHandler)
      }
    } catch (error) {
      console.error('[VenvHandler] Error upgrading packages:', error)
      return { success: false, error: getErrorMessage(error) }
    }
  })
}

/**
 * IPC Handlers for Autocoder UI Service
 *
 * Handles communication between renderer and autocoder service.
 */

import { ipcMain, BrowserWindow } from 'electron'
import { getAutocoderUIService } from '../services/autocoder-ui-service'
import { getPythonVenvManager, PythonVenvManager } from '../services/python-venv-manager'

export function registerAutocoderHandlers(): void {
  /**
   * Start autocoder UI
   */
  ipcMain.handle('autocoder:start', async (event, projectPath: string) => {
    try {
      const mainWindow = BrowserWindow.fromWebContents(event.sender)
      if (!mainWindow) {
        throw new Error('Main window not found')
      }

      const autocoderService = getAutocoderUIService()

      // Check if already running
      if (autocoderService.isServiceRunning()) {
        console.log('[AutocoderIPC] Service already running, showing UI')
        autocoderService.show()
        return { success: true, message: 'Autocoder UI shown' }
      }

      // Start the service
      // Note: Autocoder handles API key via .env file or OAuth
      await autocoderService.start(mainWindow, {
        projectPath
      })

      return { success: true, message: 'Autocoder UI started successfully' }
    } catch (error) {
      console.error('[AutocoderIPC] Failed to start:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  })

  /**
   * Stop autocoder UI
   */
  ipcMain.handle('autocoder:stop', async () => {
    try {
      const autocoderService = getAutocoderUIService()
      await autocoderService.stop()

      return { success: true, message: 'Autocoder UI stopped successfully' }
    } catch (error) {
      console.error('[AutocoderIPC] Failed to stop:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  })

  /**
   * Show autocoder UI (if already running)
   */
  ipcMain.handle('autocoder:show', async () => {
    try {
      const autocoderService = getAutocoderUIService()

      if (!autocoderService.isServiceRunning()) {
        throw new Error('Autocoder service is not running')
      }

      autocoderService.show()

      return { success: true, message: 'Autocoder UI shown' }
    } catch (error) {
      console.error('[AutocoderIPC] Failed to show:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  })

  /**
   * Hide autocoder UI (keep running in background)
   */
  ipcMain.handle('autocoder:hide', async () => {
    try {
      const autocoderService = getAutocoderUIService()
      autocoderService.hide()

      return { success: true, message: 'Autocoder UI hidden' }
    } catch (error) {
      console.error('[AutocoderIPC] Failed to hide:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  })

  /**
   * Get autocoder status
   */
  ipcMain.handle('autocoder:status', async () => {
    try {
      const autocoderService = getAutocoderUIService()
      const isRunning = autocoderService.isServiceRunning()
      const config = autocoderService.getConfig()

      return {
        success: true,
        isRunning,
        projectPath: config?.projectPath || null
      }
    } catch (error) {
      console.error('[AutocoderIPC] Failed to get status:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  })

  /**
   * Setup Python environment
   */
  ipcMain.handle('autocoder:setup-python', async () => {
    try {
      const venvManager = getPythonVenvManager()

      // Check if Python is available
      const pythonCheck = await PythonVenvManager.checkPythonAvailable()

      if (!pythonCheck.available) {
        throw new Error(
          'Python is not installed. Please install Python 3.9 or higher from https://www.python.org/'
        )
      }

      // Ensure venv is ready
      await venvManager.ensureReady()

      return {
        success: true,
        message: 'Python environment ready',
        pythonVersion: pythonCheck.version
      }
    } catch (error) {
      console.error('[AutocoderIPC] Failed to setup Python:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  })

  /**
   * Update Python dependencies
   */
  ipcMain.handle('autocoder:update-dependencies', async () => {
    try {
      const venvManager = getPythonVenvManager()
      await venvManager.updateDependencies()

      return {
        success: true,
        message: 'Dependencies updated successfully'
      }
    } catch (error) {
      console.error('[AutocoderIPC] Failed to update dependencies:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  })

  console.log('[AutocoderIPC] Handlers registered')
}

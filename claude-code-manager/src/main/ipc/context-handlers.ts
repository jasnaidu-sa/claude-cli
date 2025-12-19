/**
 * Context Agent IPC Handlers
 *
 * Electron IPC handlers for Context Agent operations.
 * Provides bridge between renderer and Context Agent service.
 */

import { ipcMain, IpcMainInvokeEvent } from 'electron'
import { ContextAgentRunner } from '../services/context-agent-runner'
import type {
  ContextSummarizationRequest,
  ContextSummarizationResult,
  ContextData,
  ContextInjection
} from '../../shared/context-types'

let contextAgentRunner: ContextAgentRunner | null = null

/**
 * Initialize context agent handlers
 */
export function registerContextHandlers(pythonPath: string = 'python'): void {
  console.log('[ContextHandlers] Registering context handlers...')

  // Initialize runner
  contextAgentRunner = new ContextAgentRunner(pythonPath)

  // Set up event forwarding
  contextAgentRunner.on('progress', (data) => {
    // Forward progress to all renderer windows
    const windows = require('electron').BrowserWindow.getAllWindows()
    windows.forEach((win) => {
      win.webContents.send('context:progress', data)
    })
  })

  contextAgentRunner.on('complete', (data) => {
    const windows = require('electron').BrowserWindow.getAllWindows()
    windows.forEach((win) => {
      win.webContents.send('context:complete', data)
    })
  })

  contextAgentRunner.on('error', (data) => {
    const windows = require('electron').BrowserWindow.getAllWindows()
    windows.forEach((win) => {
      win.webContents.send('context:error', data)
    })
  })

  /**
   * Summarize context after feature batch or category
   */
  ipcMain.handle(
    'context:summarize',
    async (
      _event: IpcMainInvokeEvent,
      request: ContextSummarizationRequest
    ): Promise<{ success: boolean; taskId?: string; error?: string }> => {
      console.log('[ContextHandlers] SUMMARIZE called')
      console.log('[ContextHandlers] Request:', JSON.stringify(request, null, 2))

      try {
        if (!contextAgentRunner) {
          throw new Error('Context agent runner not initialized')
        }

        const task = await contextAgentRunner.summarizeContext(request)

        return {
          success: true,
          taskId: task.id
        }
      } catch (error) {
        console.error('[ContextHandlers] Summarize error:', error)
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error)
        }
      }
    }
  )

  /**
   * Load current context data
   */
  ipcMain.handle(
    'context:load',
    async (
      _event: IpcMainInvokeEvent,
      projectPath: string
    ): Promise<{ success: boolean; data?: ContextData; error?: string }> => {
      console.log('[ContextHandlers] LOAD called for:', projectPath)

      try {
        if (!contextAgentRunner) {
          throw new Error('Context agent runner not initialized')
        }

        const data = await contextAgentRunner.loadContext(projectPath)

        if (!data) {
          return {
            success: false,
            error: 'No context data found'
          }
        }

        return {
          success: true,
          data
        }
      } catch (error) {
        console.error('[ContextHandlers] Load error:', error)
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error)
        }
      }
    }
  )

  /**
   * Get context injection for a feature
   */
  ipcMain.handle(
    'context:get-injection',
    async (
      _event: IpcMainInvokeEvent,
      projectPath: string,
      featureId: string
    ): Promise<{ success: boolean; injection?: ContextInjection; error?: string }> => {
      console.log('[ContextHandlers] GET_INJECTION called for feature:', featureId)

      try {
        if (!contextAgentRunner) {
          throw new Error('Context agent runner not initialized')
        }

        const injection = await contextAgentRunner.getContextInjection(projectPath, featureId)

        if (!injection) {
          return {
            success: false,
            error: 'No context available for injection'
          }
        }

        return {
          success: true,
          injection
        }
      } catch (error) {
        console.error('[ContextHandlers] Get injection error:', error)
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error)
        }
      }
    }
  )

  /**
   * Cancel running summarization
   */
  ipcMain.handle(
    'context:cancel',
    async (_event: IpcMainInvokeEvent, taskId: string): Promise<{ success: boolean }> => {
      console.log('[ContextHandlers] CANCEL called for task:', taskId)

      try {
        if (!contextAgentRunner) {
          throw new Error('Context agent runner not initialized')
        }

        const cancelled = contextAgentRunner.cancelTask(taskId)

        return {
          success: cancelled
        }
      } catch (error) {
        console.error('[ContextHandlers] Cancel error:', error)
        return {
          success: false
        }
      }
    }
  )

  /**
   * Get task status
   */
  ipcMain.handle(
    'context:get-task',
    async (
      _event: IpcMainInvokeEvent,
      taskId: string
    ): Promise<{
      success: boolean
      task?: {
        id: string
        projectPath: string
        startedAt: number
        completedAt?: number
        result?: ContextSummarizationResult
      }
      error?: string
    }> => {
      console.log('[ContextHandlers] GET_TASK called for:', taskId)

      try {
        if (!contextAgentRunner) {
          throw new Error('Context agent runner not initialized')
        }

        const task = contextAgentRunner.getTask(taskId)

        if (!task) {
          return {
            success: false,
            error: 'Task not found'
          }
        }

        return {
          success: true,
          task: {
            id: task.id,
            projectPath: task.projectPath,
            startedAt: task.startedAt,
            completedAt: task.completedAt,
            result: task.result
          }
        }
      } catch (error) {
        console.error('[ContextHandlers] Get task error:', error)
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error)
        }
      }
    }
  )

  console.log('[ContextHandlers] Context handlers registered')
}

/**
 * Clean up context handlers
 */
export function unregisterContextHandlers(): void {
  ipcMain.removeHandler('context:summarize')
  ipcMain.removeHandler('context:load')
  ipcMain.removeHandler('context:get-injection')
  ipcMain.removeHandler('context:cancel')
  ipcMain.removeHandler('context:get-task')

  if (contextAgentRunner) {
    contextAgentRunner.cleanup()
    contextAgentRunner.removeAllListeners()
    contextAgentRunner = null
  }

  console.log('[ContextHandlers] Context handlers unregistered')
}

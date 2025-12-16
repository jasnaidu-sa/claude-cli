/**
 * IPC Handlers for Schema Validator
 *
 * Provides IPC bridge between renderer and SchemaValidator service.
 * Handles validation triggers and result queries.
 */

import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/types'
import { schemaValidator } from '../services/schema-validator'
import type { SchemaValidationResult } from '@shared/types'

/**
 * Extract error message safely from unknown error type
 */
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return String(error)
}

export function registerSchemaHandlers(): void {
  // Trigger schema validation
  ipcMain.handle(
    IPC_CHANNELS.SCHEMA_VALIDATE,
    async (_event, projectPath: string, workflowId: string, model?: string): Promise<{ success: boolean; sessionId?: string; error?: string }> => {
      try {
        return await schemaValidator.validate(projectPath, workflowId, model)
      } catch (error) {
        console.error('[SchemaHandler] Error triggering validation:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  // Get validation result
  ipcMain.handle(
    IPC_CHANNELS.SCHEMA_GET_RESULT,
    async (_event, projectPath: string): Promise<SchemaValidationResult | null> => {
      try {
        return await schemaValidator.getResult(projectPath)
      } catch (error) {
        console.error('[SchemaHandler] Error getting result:', error)
        return null
      }
    }
  )

  // Clear validation result
  ipcMain.handle(
    IPC_CHANNELS.SCHEMA_CLEAR,
    async (_event, projectPath: string): Promise<{ success: boolean; error?: string }> => {
      try {
        await schemaValidator.clear(projectPath)
        return { success: true }
      } catch (error) {
        console.error('[SchemaHandler] Error clearing result:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  // Get validation status
  ipcMain.handle(
    IPC_CHANNELS.SCHEMA_STATUS,
    async (_event, projectPath: string): Promise<{ status: string; error?: string }> => {
      const state = schemaValidator.getStatus(projectPath)
      return {
        status: state.status,
        error: state.error
      }
    }
  )
}

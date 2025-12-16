/**
 * IPC Handlers for Workflow Manager
 *
 * Provides IPC bridge between renderer and WorkflowManager service.
 * Handles CRUD operations and status/progress updates.
 */

import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/types'
import { workflowManager } from '../services/workflow-manager'
import type { CreateWorkflowOptions, UpdateWorkflowOptions } from '../services/workflow-manager'
import type { WorkflowConfig, WorkflowStatus, WorkflowProgress } from '@shared/types'

/**
 * Extract error message safely from unknown error type
 */
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return String(error)
}

export function registerWorkflowHandlers(): void {
  // Create workflow
  ipcMain.handle(
    IPC_CHANNELS.WORKFLOW_CREATE,
    async (_event, options: CreateWorkflowOptions): Promise<{ success: boolean; workflow?: WorkflowConfig; error?: string }> => {
      try {
        const workflow = await workflowManager.create(options)
        return { success: true, workflow }
      } catch (error) {
        console.error('[WorkflowHandler] Error creating workflow:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  // Get workflow by ID
  ipcMain.handle(
    IPC_CHANNELS.WORKFLOW_GET,
    async (_event, projectPath: string, workflowId: string): Promise<WorkflowConfig | null> => {
      try {
        return await workflowManager.get(projectPath, workflowId)
      } catch (error) {
        console.error('[WorkflowHandler] Error getting workflow:', error)
        return null
      }
    }
  )

  // Update workflow
  ipcMain.handle(
    IPC_CHANNELS.WORKFLOW_UPDATE,
    async (_event, projectPath: string, workflowId: string, updates: UpdateWorkflowOptions): Promise<{ success: boolean; workflow?: WorkflowConfig; error?: string }> => {
      try {
        const workflow = await workflowManager.update(projectPath, workflowId, updates)
        if (!workflow) {
          return { success: false, error: 'Workflow not found' }
        }
        return { success: true, workflow }
      } catch (error) {
        console.error('[WorkflowHandler] Error updating workflow:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  // Delete workflow
  ipcMain.handle(
    IPC_CHANNELS.WORKFLOW_DELETE,
    async (_event, projectPath: string, workflowId: string): Promise<{ success: boolean; error?: string }> => {
      try {
        const deleted = await workflowManager.delete(projectPath, workflowId)
        if (!deleted) {
          return { success: false, error: 'Workflow not found' }
        }
        return { success: true }
      } catch (error) {
        console.error('[WorkflowHandler] Error deleting workflow:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  // List all workflows (from cache)
  ipcMain.handle(
    IPC_CHANNELS.WORKFLOW_LIST,
    async (): Promise<WorkflowConfig[]> => {
      return workflowManager.listAll()
    }
  )

  // List workflows for a specific project
  ipcMain.handle(
    IPC_CHANNELS.WORKFLOW_LIST_FOR_PROJECT,
    async (_event, projectPath: string): Promise<WorkflowConfig[]> => {
      try {
        return await workflowManager.listForProject(projectPath)
      } catch (error) {
        console.error('[WorkflowHandler] Error listing workflows:', error)
        return []
      }
    }
  )

  // Update workflow status
  ipcMain.handle(
    IPC_CHANNELS.WORKFLOW_UPDATE_STATUS,
    async (_event, projectPath: string, workflowId: string, status: WorkflowStatus, error?: string): Promise<{ success: boolean; workflow?: WorkflowConfig; error?: string }> => {
      try {
        const workflow = await workflowManager.updateStatus(projectPath, workflowId, status, error)
        if (!workflow) {
          return { success: false, error: 'Workflow not found' }
        }
        return { success: true, workflow }
      } catch (err) {
        console.error('[WorkflowHandler] Error updating status:', err)
        return { success: false, error: getErrorMessage(err) }
      }
    }
  )

  // Update workflow progress
  ipcMain.handle(
    IPC_CHANNELS.WORKFLOW_UPDATE_PROGRESS,
    async (_event, projectPath: string, workflowId: string, progress: WorkflowProgress): Promise<{ success: boolean; workflow?: WorkflowConfig; error?: string }> => {
      try {
        const workflow = await workflowManager.updateProgress(projectPath, workflowId, progress)
        if (!workflow) {
          return { success: false, error: 'Workflow not found' }
        }
        return { success: true, workflow }
      } catch (error) {
        console.error('[WorkflowHandler] Error updating progress:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )
}

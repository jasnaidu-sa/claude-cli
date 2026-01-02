/**
 * IPC Handlers for Ideas Manager
 *
 * Provides IPC bridge between renderer and IdeasManager/OutlookIntegration services.
 * Handles CRUD operations, stage transitions, and email sync.
 */

import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/types'
import { getIdeasManager } from '../services/ideas-manager'
import { getOutlookService } from '../services/outlook-integration'
import type { CreateIdeaOptions, UpdateIdeaOptions } from '../services/ideas-manager'
import type { Idea, IdeaStage, OutlookConfig, ProjectType } from '@shared/types'

/**
 * Extract error message safely from unknown error type
 */
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return String(error)
}

export function registerIdeasHandlers(): void {
  const ideasManager = getIdeasManager()
  const outlookService = getOutlookService()

  // ============================================================================
  // Ideas CRUD Operations
  // ============================================================================

  // List all ideas (optionally filtered by stage)
  ipcMain.handle(
    IPC_CHANNELS.IDEAS_LIST,
    async (_event, stage?: IdeaStage): Promise<{ success: boolean; ideas?: Idea[]; error?: string }> => {
      try {
        const ideas = ideasManager.list(stage)
        return { success: true, ideas }
      } catch (error) {
        console.error('[IdeasHandler] Error listing ideas:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  // Get idea by ID
  ipcMain.handle(
    IPC_CHANNELS.IDEAS_GET,
    async (_event, ideaId: string): Promise<{ success: boolean; idea?: Idea; error?: string }> => {
      try {
        const idea = ideasManager.get(ideaId)
        if (!idea) {
          return { success: false, error: 'Idea not found' }
        }
        return { success: true, idea }
      } catch (error) {
        console.error('[IdeasHandler] Error getting idea:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  // Create new idea
  ipcMain.handle(
    IPC_CHANNELS.IDEAS_CREATE,
    async (_event, options: CreateIdeaOptions): Promise<{ success: boolean; idea?: Idea; error?: string }> => {
      try {
        const idea = ideasManager.create(options)
        return { success: true, idea }
      } catch (error) {
        console.error('[IdeasHandler] Error creating idea:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  // Update idea
  ipcMain.handle(
    IPC_CHANNELS.IDEAS_UPDATE,
    async (_event, ideaId: string, options: UpdateIdeaOptions): Promise<{ success: boolean; idea?: Idea; error?: string }> => {
      try {
        const idea = ideasManager.update(ideaId, options)
        return { success: true, idea }
      } catch (error) {
        console.error('[IdeasHandler] Error updating idea:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  // Delete idea
  ipcMain.handle(
    IPC_CHANNELS.IDEAS_DELETE,
    async (_event, ideaId: string): Promise<{ success: boolean; error?: string }> => {
      try {
        const deleted = ideasManager.delete(ideaId)
        if (!deleted) {
          return { success: false, error: 'Idea not found' }
        }
        return { success: true }
      } catch (error) {
        console.error('[IdeasHandler] Error deleting idea:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  // Move idea to new stage
  ipcMain.handle(
    IPC_CHANNELS.IDEAS_MOVE_STAGE,
    async (_event, ideaId: string, newStage: IdeaStage): Promise<{ success: boolean; idea?: Idea; error?: string }> => {
      try {
        const idea = ideasManager.moveStage(ideaId, newStage)
        return { success: true, idea }
      } catch (error) {
        console.error('[IdeasHandler] Error moving idea stage:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  // Add discussion message
  ipcMain.handle(
    IPC_CHANNELS.IDEAS_ADD_DISCUSSION,
    async (
      _event,
      ideaId: string,
      role: 'user' | 'assistant',
      content: string
    ): Promise<{ success: boolean; idea?: Idea; error?: string }> => {
      try {
        const idea = ideasManager.addDiscussionMessage(ideaId, role, content)
        return { success: true, idea }
      } catch (error) {
        console.error('[IdeasHandler] Error adding discussion message:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  // Start project from idea
  ipcMain.handle(
    IPC_CHANNELS.IDEAS_START_PROJECT,
    async (
      _event,
      ideaId: string,
      projectType: ProjectType,
      projectPath?: string,
      projectName?: string
    ): Promise<{ success: boolean; idea?: Idea; error?: string }> => {
      try {
        // Set project type
        let idea = ideasManager.setProjectType(ideaId, projectType,
          projectPath && projectName ? { path: projectPath, name: projectName } : undefined
        )

        // Move to in_progress if in approved stage
        if (idea.stage === 'approved') {
          idea = ideasManager.moveStage(ideaId, 'in_progress')
        }

        return { success: true, idea }
      } catch (error) {
        console.error('[IdeasHandler] Error starting project:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  // Link workflow to idea
  ipcMain.handle(
    IPC_CHANNELS.IDEAS_LINK_WORKFLOW,
    async (
      _event,
      ideaId: string,
      workflowId: string
    ): Promise<{ success: boolean; idea?: Idea; error?: string }> => {
      try {
        const idea = ideasManager.linkWorkflow(ideaId, workflowId)
        return { success: true, idea }
      } catch (error) {
        console.error('[IdeasHandler] Error linking workflow to idea:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  // ============================================================================
  // Outlook Integration
  // ============================================================================

  // Configure Outlook
  ipcMain.handle(
    IPC_CHANNELS.OUTLOOK_CONFIGURE,
    async (_event, config: Partial<OutlookConfig>): Promise<{ success: boolean; error?: string }> => {
      try {
        outlookService.configure(config)
        return { success: true }
      } catch (error) {
        console.error('[IdeasHandler] Error configuring Outlook:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  // Get Outlook config
  ipcMain.handle(
    IPC_CHANNELS.OUTLOOK_GET_CONFIG,
    async (): Promise<{ success: boolean; config?: OutlookConfig | null; error?: string }> => {
      try {
        const config = outlookService.getConfig()
        return { success: true, config }
      } catch (error) {
        console.error('[IdeasHandler] Error getting Outlook config:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  // Authenticate with Outlook
  ipcMain.handle(
    IPC_CHANNELS.OUTLOOK_AUTHENTICATE,
    async (): Promise<{ success: boolean; error?: string }> => {
      try {
        await outlookService.authenticate()
        return { success: true }
      } catch (error) {
        console.error('[IdeasHandler] Error authenticating with Outlook:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  // Fetch emails from Outlook
  ipcMain.handle(
    IPC_CHANNELS.OUTLOOK_FETCH_EMAILS,
    async (_event, options?: {
      maxResults?: number
      sinceDate?: string
      onlySinceLastSync?: boolean
    }): Promise<{ success: boolean; count?: number; ideas?: Idea[]; error?: string }> => {
      try {
        const fetchOptions = options ? {
          ...options,
          sinceDate: options.sinceDate ? new Date(options.sinceDate) : undefined
        } : undefined

        const emails = await outlookService.fetchEmails(fetchOptions)
        const ideas = ideasManager.createFromEmails(emails)

        return { success: true, count: ideas.length, ideas }
      } catch (error) {
        console.error('[IdeasHandler] Error fetching emails:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  // Sync emails (fetch and create ideas)
  ipcMain.handle(
    IPC_CHANNELS.OUTLOOK_SYNC,
    async (): Promise<{ success: boolean; count?: number; ideas?: Idea[]; error?: string }> => {
      try {
        const emails = await outlookService.fetchEmails({ onlySinceLastSync: true })
        const ideas = ideasManager.createFromEmails(emails)

        return { success: true, count: ideas.length, ideas }
      } catch (error) {
        console.error('[IdeasHandler] Error syncing emails:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )

  // Get Outlook status
  ipcMain.handle(
    IPC_CHANNELS.OUTLOOK_STATUS,
    async (): Promise<{
      success: boolean
      status?: {
        configured: boolean
        authenticated: boolean
        sourceEmail: string | null
        lastSyncAt: number | null
      }
      error?: string
    }> => {
      try {
        const status = outlookService.getStatus()
        return { success: true, status }
      } catch (error) {
        console.error('[IdeasHandler] Error getting Outlook status:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    }
  )
}

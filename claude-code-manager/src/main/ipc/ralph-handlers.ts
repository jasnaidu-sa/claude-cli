/**
 * Ralph IPC Handlers
 *
 * IPC handlers for the Ralph Loop orchestrator service.
 * Handles:
 * - Session lifecycle (start, stop, pause, resume)
 * - Checkpoint responses (approve, skip, reject)
 * - Status queries
 */

import { ipcMain } from 'electron'
import { app } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import { IPC_CHANNELS } from '@shared/types'
import type { RalphSessionSummary } from '@shared/types'
import { getRalphOrchestratorService } from '../services/ralph-orchestrator-service'
import type { RalphOrchestratorConfig } from '../services/ralph-orchestrator-service'
import { prdParserService } from '../services/prd-parser-service'
import { aiTaskExtractorService } from '../services/ai-task-extractor'
import { yamlTaskService, type YamlGenerationOptions } from '../services/yaml-task-service'
import { dependencyGraphService } from '../services/dependency-graph-service'
import type { RalphTask } from '../../shared/ralph-types'

// Session history storage path
const getSessionHistoryPath = () => path.join(app.getPath('userData'), 'ralph-sessions')

/**
 * Validate session ID to prevent path traversal
 * Only allows alphanumeric, hyphens, and underscores
 */
function isValidSessionId(sessionId: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(sessionId) && sessionId.length > 0 && sessionId.length <= 100
}

/**
 * Get safe session file path with validation
 */
function getSessionFilePath(sessionId: string): string | null {
  if (!isValidSessionId(sessionId)) {
    return null
  }
  return path.join(getSessionHistoryPath(), `${sessionId}.json`)
}

/**
 * Sanitize error messages to prevent information leakage
 */
function sanitizeError(error: unknown): string {
  if (error instanceof Error) {
    let message = error.message
    // Remove file paths from error messages
    message = message.replace(/[A-Z]:\\[^\s]+/g, '[PATH]') // Windows paths
    message = message.replace(/\/[^\s]+/g, '[PATH]') // Unix paths
    message = message.replace(/at .+:\d+:\d+/g, '') // Stack trace lines
    return message.substring(0, 500) // Limit length
  }
  return 'An unexpected error occurred'
}

// Ensure session history directory exists
const ensureSessionHistoryDir = () => {
  const dir = getSessionHistoryPath()
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

/**
 * Register all Ralph-related IPC handlers
 */
export function registerRalphHandlers(): void {
  const orchestratorService = getRalphOrchestratorService()

  // Start a new Ralph session
  ipcMain.handle(IPC_CHANNELS.RALPH_START, async (_event, config: RalphOrchestratorConfig) => {
    try {
      console.log('[RalphHandlers] Starting Ralph session')
      const session = await orchestratorService.start(config)
      return { success: true, session }
    } catch (error) {
      console.error('[RalphHandlers] Error starting session:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  })

  // Stop a running session
  ipcMain.handle(IPC_CHANNELS.RALPH_STOP, async (_event, sessionId: string) => {
    try {
      console.log('[RalphHandlers] Stopping session:', sessionId)
      await orchestratorService.stop(sessionId)
      return { success: true }
    } catch (error) {
      console.error('[RalphHandlers] Error stopping session:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  })

  // Pause a running session
  ipcMain.handle(IPC_CHANNELS.RALPH_PAUSE, async (_event, sessionId: string) => {
    try {
      console.log('[RalphHandlers] Pausing session:', sessionId)
      await orchestratorService.pause(sessionId)
      return { success: true }
    } catch (error) {
      console.error('[RalphHandlers] Error pausing session:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  })

  // Resume a paused session
  ipcMain.handle(IPC_CHANNELS.RALPH_RESUME, async (_event, sessionId: string) => {
    try {
      console.log('[RalphHandlers] Resuming session:', sessionId)
      await orchestratorService.resume(sessionId)
      return { success: true }
    } catch (error) {
      console.error('[RalphHandlers] Error resuming session:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  })

  // Get session status
  ipcMain.handle(IPC_CHANNELS.RALPH_STATUS, async (_event, sessionId: string) => {
    try {
      const session = orchestratorService.getSession(sessionId)
      if (!session) {
        return { success: false, error: 'Session not found' }
      }
      return { success: true, session }
    } catch (error) {
      console.error('[RalphHandlers] Error getting session:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  })

  // Respond to a checkpoint
  ipcMain.handle(
    IPC_CHANNELS.CHECKPOINT_APPROVE,
    async (_event, sessionId: string, checkpointId: string, comment?: string) => {
      try {
        console.log('[RalphHandlers] Approving checkpoint:', checkpointId)
        await orchestratorService.respondToCheckpoint(sessionId, checkpointId, 'approve', comment)
        return { success: true }
      } catch (error) {
        console.error('[RalphHandlers] Error approving checkpoint:', error)
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error)
        }
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.CHECKPOINT_SKIP,
    async (_event, sessionId: string, checkpointId: string, comment?: string) => {
      try {
        console.log('[RalphHandlers] Skipping checkpoint:', checkpointId)
        await orchestratorService.respondToCheckpoint(sessionId, checkpointId, 'skip', comment)
        return { success: true }
      } catch (error) {
        console.error('[RalphHandlers] Error skipping checkpoint:', error)
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error)
        }
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.CHECKPOINT_REJECT,
    async (_event, sessionId: string, checkpointId: string, comment?: string) => {
      try {
        console.log('[RalphHandlers] Rejecting checkpoint:', checkpointId)
        await orchestratorService.respondToCheckpoint(sessionId, checkpointId, 'reject', comment)
        return { success: true }
      } catch (error) {
        console.error('[RalphHandlers] Error rejecting checkpoint:', error)
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error)
        }
      }
    }
  )

  // Get all sessions (for project)
  ipcMain.handle('ralph:get-all-sessions', async () => {
    try {
      const sessions = orchestratorService.getAllSessions()
      return { success: true, sessions }
    } catch (error) {
      console.error('[RalphHandlers] Error getting all sessions:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  })

  // Get sessions for specific project
  ipcMain.handle('ralph:get-project-sessions', async (_event, projectPath: string) => {
    try {
      const sessions = orchestratorService.getProjectSessions(projectPath)
      return { success: true, sessions }
    } catch (error) {
      console.error('[RalphHandlers] Error getting project sessions:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  })

  // Cleanup all sessions
  ipcMain.handle('ralph:cleanup', async () => {
    try {
      await orchestratorService.cleanup()
      return { success: true }
    } catch (error) {
      console.error('[RalphHandlers] Error cleaning up:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  })

  // ==========================================================================
  // Session History Handlers
  // ==========================================================================

  // List all saved sessions (optionally filtered by project)
  ipcMain.handle('ralph:list-sessions', async (_event, projectPath?: string) => {
    try {
      ensureSessionHistoryDir()
      const dir = getSessionHistoryPath()
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'))

      const sessions: RalphSessionSummary[] = []
      for (const file of files) {
        try {
          const filePath = path.join(dir, file)
          // Check file still exists (race condition protection)
          if (!fs.existsSync(filePath)) continue
          const content = fs.readFileSync(filePath, 'utf-8')
          const session = JSON.parse(content) as RalphSessionSummary
          if (!projectPath || session.projectPath === projectPath) {
            sessions.push(session)
          }
        } catch {
          // Skip invalid files
        }
      }

      // Sort by updatedAt descending (most recent first)
      sessions.sort((a, b) => b.updatedAt - a.updatedAt)

      return { success: true, sessions }
    } catch (error) {
      console.error('[RalphHandlers] Error listing sessions:', error)
      return { success: false, error: sanitizeError(error), sessions: [] }
    }
  })

  // Save a session to history
  ipcMain.handle('ralph:save-session', async (_event, session: RalphSessionSummary) => {
    try {
      const filePath = getSessionFilePath(session.id)
      if (!filePath) {
        return { success: false, error: 'Invalid session ID' }
      }
      ensureSessionHistoryDir()
      fs.writeFileSync(filePath, JSON.stringify(session, null, 2))
      return { success: true }
    } catch (error) {
      console.error('[RalphHandlers] Error saving session:', error)
      return { success: false, error: sanitizeError(error) }
    }
  })

  // Get a specific session from history
  ipcMain.handle('ralph:get-session-history', async (_event, sessionId: string) => {
    try {
      const filePath = getSessionFilePath(sessionId)
      if (!filePath) {
        return { success: false, error: 'Invalid session ID' }
      }
      if (!fs.existsSync(filePath)) {
        return { success: false, error: 'Session not found' }
      }
      const content = fs.readFileSync(filePath, 'utf-8')
      const session = JSON.parse(content) as RalphSessionSummary
      return { success: true, session }
    } catch (error) {
      console.error('[RalphHandlers] Error getting session:', error)
      return { success: false, error: sanitizeError(error) }
    }
  })

  // Delete a session from history
  ipcMain.handle('ralph:delete-session', async (_event, sessionId: string) => {
    try {
      const filePath = getSessionFilePath(sessionId)
      if (!filePath) {
        return { success: false, error: 'Invalid session ID' }
      }
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
      }
      return { success: true }
    } catch (error) {
      console.error('[RalphHandlers] Error deleting session:', error)
      return { success: false, error: sanitizeError(error) }
    }
  })

  // ==========================================================================
  // PRD Parsing & YAML Generation Handlers
  // ==========================================================================

  // Parse PRD content to extract tasks
  ipcMain.handle(
    'ralph:parse-prd',
    async (
      _event,
      prdContent: string,
      options?: { includeCompleted?: boolean; minTitleLength?: number }
    ) => {
      try {
        console.log('[RalphHandlers] Parsing PRD content')
        const result = prdParserService.parse(prdContent, options)
        return { success: true, result }
      } catch (error) {
        console.error('[RalphHandlers] Error parsing PRD:', error)
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    }
  )

  // Generate YAML from PRD content
  ipcMain.handle(
    'ralph:generate-yaml-from-prd',
    async (
      _event,
      prdContent: string,
      outputPath: string,
      options?: YamlGenerationOptions
    ) => {
      try {
        console.log('[RalphHandlers] Generating YAML from PRD')
        const result = await yamlTaskService.generateFromPrd(prdContent, outputPath, options)
        return result
      } catch (error) {
        console.error('[RalphHandlers] Error generating YAML:', error)
        return {
          success: false,
          yamlPath: '',
          taskCount: 0,
          errors: [error instanceof Error ? error.message : String(error)],
        }
      }
    }
  )

  // Generate YAML from tasks array
  ipcMain.handle(
    'ralph:generate-yaml-from-tasks',
    async (
      _event,
      tasks: RalphTask[],
      projectInfo: { name: string; description: string; baseBranch?: string },
      options?: YamlGenerationOptions
    ) => {
      try {
        console.log('[RalphHandlers] Generating YAML from tasks')
        const yamlContent = yamlTaskService.generateFromTasks(tasks, projectInfo, options)
        return { success: true, yamlContent }
      } catch (error) {
        console.error('[RalphHandlers] Error generating YAML:', error)
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    }
  )

  // Validate YAML content
  ipcMain.handle('ralph:validate-yaml', async (_event, yamlContent: string) => {
    try {
      console.log('[RalphHandlers] Validating YAML content')
      const result = yamlTaskService.validateYaml(yamlContent)
      return { success: true, result }
    } catch (error) {
      console.error('[RalphHandlers] Error validating YAML:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  })

  // Load and validate YAML file
  ipcMain.handle('ralph:load-yaml-file', async (_event, filePath: string) => {
    try {
      console.log('[RalphHandlers] Loading YAML file:', filePath)
      const result = yamlTaskService.loadYamlFile(filePath)
      return { success: result.valid, result }
    } catch (error) {
      console.error('[RalphHandlers] Error loading YAML file:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  })

  // Update task in YAML file
  ipcMain.handle(
    'ralph:update-yaml-task',
    async (_event, filePath: string, taskId: string, updates: Partial<RalphTask>) => {
      try {
        console.log('[RalphHandlers] Updating task in YAML:', taskId)
        const success = yamlTaskService.updateTask(filePath, taskId, updates)
        return { success }
      } catch (error) {
        console.error('[RalphHandlers] Error updating YAML task:', error)
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    }
  )

  // Mark task as completed
  ipcMain.handle(
    'ralph:mark-task-completed',
    async (_event, filePath: string, taskId: string, completedBy?: string) => {
      try {
        console.log('[RalphHandlers] Marking task completed:', taskId)
        const success = yamlTaskService.markTaskCompleted(filePath, taskId, completedBy)
        return { success }
      } catch (error) {
        console.error('[RalphHandlers] Error marking task completed:', error)
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    }
  )

  // Initialize AI task extractor with API key
  ipcMain.handle('ralph:init-ai-extractor', async (_event, apiKey: string) => {
    try {
      console.log('[RalphHandlers] Initializing AI task extractor')
      aiTaskExtractorService.initialize(apiKey)
      return { success: true }
    } catch (error) {
      console.error('[RalphHandlers] Error initializing AI extractor:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  })

  // Extract tasks using AI
  ipcMain.handle('ralph:ai-extract-tasks', async (_event, prdContent: string) => {
    try {
      console.log('[RalphHandlers] Extracting tasks with AI')
      if (!aiTaskExtractorService.isInitialized()) {
        return { success: false, error: 'AI extractor not initialized. Call init-ai-extractor first.' }
      }
      const parsedResult = prdParserService.parse(prdContent)
      const result = await aiTaskExtractorService.extractTasks(prdContent, parsedResult)
      return { success: true, result }
    } catch (error) {
      console.error('[RalphHandlers] Error extracting tasks with AI:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  })

  // Suggest dependencies using AI
  ipcMain.handle('ralph:ai-suggest-dependencies', async (_event, tasks: RalphTask[]) => {
    try {
      console.log('[RalphHandlers] Suggesting dependencies with AI')
      if (!aiTaskExtractorService.isInitialized()) {
        return { success: false, error: 'AI extractor not initialized. Call init-ai-extractor first.' }
      }
      const dependencies = await aiTaskExtractorService.suggestDependencies(tasks)
      return { success: true, dependencies: Object.fromEntries(dependencies) }
    } catch (error) {
      console.error('[RalphHandlers] Error suggesting dependencies:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  })

  // Build dependency graph from tasks
  ipcMain.handle('ralph:build-dependency-graph', async (_event, tasks: RalphTask[]) => {
    try {
      console.log('[RalphHandlers] Building dependency graph')
      const graph = dependencyGraphService.buildGraph(tasks)
      return {
        success: true,
        graph: {
          hasCycles: graph.hasCycles,
          cyclePath: graph.cyclePath,
          groupCount: graph.groups.size,
          groups: Object.fromEntries(graph.groups),
        },
      }
    } catch (error) {
      console.error('[RalphHandlers] Error building dependency graph:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  })

  // Assign parallel groups to tasks
  ipcMain.handle('ralph:assign-parallel-groups', async (_event, tasks: RalphTask[]) => {
    try {
      console.log('[RalphHandlers] Assigning parallel groups')
      const result = dependencyGraphService.assignGroupsToTasks(tasks)
      return {
        success: true,
        tasks: result.tasks,
        groupCount: result.groupCount,
        groupSizes: Object.fromEntries(result.groupSizes),
        issues: result.issues,
      }
    } catch (error) {
      console.error('[RalphHandlers] Error assigning parallel groups:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  })

  // Get ready tasks (dependencies satisfied)
  ipcMain.handle(
    'ralph:get-ready-tasks',
    async (_event, tasks: RalphTask[], completedTaskIds: string[]) => {
      try {
        console.log('[RalphHandlers] Getting ready tasks')
        const completedSet = new Set(completedTaskIds)
        const readyTasks = dependencyGraphService.getReadyTasks(tasks, completedSet)
        return { success: true, readyTasks }
      } catch (error) {
        console.error('[RalphHandlers] Error getting ready tasks:', error)
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    }
  )

  // Generate Mermaid diagram for dependency graph
  ipcMain.handle('ralph:generate-mermaid-diagram', async (_event, tasks: RalphTask[]) => {
    try {
      console.log('[RalphHandlers] Generating Mermaid diagram')
      const diagram = dependencyGraphService.generateMermaidDiagram(tasks)
      return { success: true, diagram }
    } catch (error) {
      console.error('[RalphHandlers] Error generating Mermaid diagram:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  })

  // Validate task dependencies
  ipcMain.handle('ralph:validate-dependencies', async (_event, tasks: RalphTask[]) => {
    try {
      console.log('[RalphHandlers] Validating dependencies')
      const errors = dependencyGraphService.validateDependencies(tasks)
      return { success: errors.length === 0, errors }
    } catch (error) {
      console.error('[RalphHandlers] Error validating dependencies:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  })

  // List YAML files in project's .ralph/tasks directory
  ipcMain.handle('ralph:list-yaml-files', async (_event, projectPath: string) => {
    try {
      const tasksDir = path.join(projectPath, '.ralph', 'tasks')
      if (!fs.existsSync(tasksDir)) {
        return { success: true, files: [] }
      }

      const files = fs
        .readdirSync(tasksDir)
        .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
        .map((f) => ({
          name: f,
          path: path.join(tasksDir, f),
          modified: fs.statSync(path.join(tasksDir, f)).mtime.getTime(),
        }))
        .sort((a, b) => b.modified - a.modified)

      return { success: true, files }
    } catch (error) {
      console.error('[RalphHandlers] Error listing YAML files:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        files: [],
      }
    }
  })

  console.log('[RalphHandlers] Registered all Ralph IPC handlers')
}

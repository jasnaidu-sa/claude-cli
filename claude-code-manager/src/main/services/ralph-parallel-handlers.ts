/**
 * Ralph Parallel Execution IPC Handlers
 * Handles worktree management and parallel execution operations
 */

import { ipcMain, IpcMainInvokeEvent } from 'electron'
import { gitWorktreeService, WorktreeInfo, CreateWorktreeOptions } from './git-worktree-service'
import {
  createParallelOrchestrator,
  ParallelOrchestrator,
  OrchestratorConfig,
} from './parallel-orchestrator'
import { agentStatusTracker } from './agent-status-tracker'
import type { RalphTaskYaml, RalphSessionStatus, AgentStatus } from '../../shared/ralph-types'

// =============================================================================
// Security & Validation
// =============================================================================

const MAX_PATH_LENGTH = 500
const MAX_SESSION_ID_LENGTH = 100

/**
 * Validate session ID format
 */
function isValidSessionId(sessionId: string): boolean {
  return (
    typeof sessionId === 'string' &&
    sessionId.length > 0 &&
    sessionId.length <= MAX_SESSION_ID_LENGTH &&
    /^[a-zA-Z0-9_-]+$/.test(sessionId)
  )
}

/**
 * Validate path format
 */
function isValidPath(inputPath: string): boolean {
  return (
    typeof inputPath === 'string' &&
    inputPath.length > 0 &&
    inputPath.length <= MAX_PATH_LENGTH
  )
}

/**
 * Known safe error messages that can be returned to client
 */
const SAFE_ERROR_MESSAGES = [
  'Invalid repository path',
  'Invalid branch name',
  'Invalid session ID',
  'Session not found',
  'Session already running',
  'Agent not found',
  'Worktree path already exists',
  'Too many worktrees',
  'Path must be within repo or worktree directory',
  'Path traversal detected',
  'Branch name contains invalid characters',
  'Branch name uses reserved patterns',
  'Worktree path is required',
  'Invalid worktree path',
]

/**
 * Sanitize error for client (P1 fix: stricter error sanitization)
 */
function sanitizeError(error: unknown): string {
  if (error instanceof Error) {
    let message = error.message

    // Check if this is a known safe error message
    const isSafeMessage = SAFE_ERROR_MESSAGES.some((safe) => message.includes(safe))
    if (isSafeMessage) {
      // Remove any paths that might have been appended
      message = message.replace(/[A-Za-z]:\\(?:[^\\/:*?"<>|\r\n]+\\)*[^\\/:*?"<>|\r\n]*/g, '')
      message = message.replace(/\/(?:[^/\0]+\/)*[^/\0]*/g, '')
      return message.trim().substring(0, 200)
    }

    // For unknown errors, return generic message
    return 'Operation failed. Please check your input and try again.'
  }
  return 'An unexpected error occurred'
}

// =============================================================================
// Active Orchestrators
// =============================================================================

const activeOrchestrators: Map<string, ParallelOrchestrator> = new Map()

// =============================================================================
// Worktree Handlers
// =============================================================================

/**
 * Initialize worktree service
 */
ipcMain.handle(
  'ralph:worktree:initialize',
  async (_event: IpcMainInvokeEvent, repoPath: string): Promise<{ success: boolean; error?: string }> => {
    try {
      if (!isValidPath(repoPath)) {
        return { success: false, error: 'Invalid repository path' }
      }

      gitWorktreeService.initialize(repoPath)
      return { success: true }
    } catch (error) {
      return { success: false, error: sanitizeError(error) }
    }
  }
)

/**
 * Create a new worktree
 */
ipcMain.handle(
  'ralph:worktree:create',
  async (
    _event: IpcMainInvokeEvent,
    worktreePath: string,
    branchName: string,
    options: CreateWorktreeOptions
  ): Promise<{ success: boolean; worktree?: WorktreeInfo; error?: string }> => {
    try {
      if (!isValidPath(worktreePath)) {
        return { success: false, error: 'Invalid worktree path' }
      }

      if (!branchName || typeof branchName !== 'string' || branchName.length > 200) {
        return { success: false, error: 'Invalid branch name' }
      }

      // Validate options
      const safeOptions: CreateWorktreeOptions = {
        baseBranch: options.baseBranch,
        createBranch: options.createBranch,
        sessionId: options.sessionId && isValidSessionId(options.sessionId) ? options.sessionId : undefined,
        taskId: options.taskId,
      }

      const worktree = await gitWorktreeService.createWorktree(worktreePath, branchName, safeOptions)
      return { success: true, worktree }
    } catch (error) {
      return { success: false, error: sanitizeError(error) }
    }
  }
)

/**
 * Remove a worktree
 */
ipcMain.handle(
  'ralph:worktree:remove',
  async (
    _event: IpcMainInvokeEvent,
    worktreePath: string,
    force: boolean = false
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      if (!isValidPath(worktreePath)) {
        return { success: false, error: 'Invalid worktree path' }
      }

      await gitWorktreeService.removeWorktree(worktreePath, force)
      return { success: true }
    } catch (error) {
      return { success: false, error: sanitizeError(error) }
    }
  }
)

/**
 * List all worktrees
 */
ipcMain.handle(
  'ralph:worktree:list',
  async (_event: IpcMainInvokeEvent): Promise<{ success: boolean; worktrees?: WorktreeInfo[]; error?: string }> => {
    try {
      const worktrees = await gitWorktreeService.listWorktrees()
      return { success: true, worktrees }
    } catch (error) {
      return { success: false, error: sanitizeError(error) }
    }
  }
)

/**
 * Get worktree status
 */
ipcMain.handle(
  'ralph:worktree:status',
  async (
    _event: IpcMainInvokeEvent,
    worktreePath: string
  ): Promise<{ success: boolean; status?: WorktreeInfo; error?: string }> => {
    try {
      if (!isValidPath(worktreePath)) {
        return { success: false, error: 'Invalid worktree path' }
      }

      const status = await gitWorktreeService.getWorktreeStatus(worktreePath)
      return { success: true, status }
    } catch (error) {
      return { success: false, error: sanitizeError(error) }
    }
  }
)

/**
 * Cleanup session worktrees
 */
ipcMain.handle(
  'ralph:worktree:cleanup-session',
  async (
    _event: IpcMainInvokeEvent,
    sessionId: string
  ): Promise<{ success: boolean; cleaned?: string[]; error?: string }> => {
    try {
      if (!isValidSessionId(sessionId)) {
        return { success: false, error: 'Invalid session ID' }
      }

      const cleaned = await gitWorktreeService.cleanupSessionWorktrees(sessionId)
      return { success: true, cleaned }
    } catch (error) {
      return { success: false, error: sanitizeError(error) }
    }
  }
)

/**
 * Prune stale worktrees
 */
ipcMain.handle(
  'ralph:worktree:prune',
  async (_event: IpcMainInvokeEvent): Promise<{ success: boolean; error?: string }> => {
    try {
      await gitWorktreeService.pruneWorktrees()
      return { success: true }
    } catch (error) {
      return { success: false, error: sanitizeError(error) }
    }
  }
)

// =============================================================================
// Parallel Execution Handlers
// =============================================================================

/**
 * Start parallel execution
 */
ipcMain.handle(
  'ralph:parallel:start',
  async (
    _event: IpcMainInvokeEvent,
    config: {
      sessionId: string
      taskYaml: RalphTaskYaml
      repoPath: string
      maxAgents?: number
      runTests?: boolean
      runLint?: boolean
      checkpointBetweenGroups?: boolean
    }
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      if (!isValidSessionId(config.sessionId)) {
        return { success: false, error: 'Invalid session ID' }
      }

      if (!isValidPath(config.repoPath)) {
        return { success: false, error: 'Invalid repository path' }
      }

      // Check if session already exists
      if (activeOrchestrators.has(config.sessionId)) {
        return { success: false, error: 'Session already running' }
      }

      // Initialize worktree service
      gitWorktreeService.initialize(config.repoPath)

      // Create orchestrator
      const orchestratorConfig: OrchestratorConfig = {
        sessionId: config.sessionId,
        taskYaml: config.taskYaml,
        repoPath: config.repoPath,
        maxAgents: config.maxAgents,
        runTests: config.runTests,
        runLint: config.runLint,
        checkpointBetweenGroups: config.checkpointBetweenGroups,
      }

      const orchestrator = createParallelOrchestrator(orchestratorConfig)

      // P1 FIX: Helper to safely send to renderer (check if sender is destroyed)
      const safeSend = (channel: string, data: unknown): void => {
        if (!_event.sender.isDestroyed()) {
          _event.sender.send(channel, data)
        }
      }

      // Setup event forwarding to status tracker
      orchestrator.on('state', (state) => {
        const status = orchestrator.getStatus()
        agentStatusTracker.updateSessionStatus(status)
      })

      orchestrator.on('agent_state', ({ agentId, taskId, state }) => {
        agentStatusTracker.updateAgentStatus(agentId, { state })
      })

      orchestrator.on('agent_output', (output) => {
        // P1 FIX: Forward to renderer via main process with destroyed check
        safeSend('ralph:agent:output', output)
      })

      orchestrator.on('task_complete', ({ taskId, agentId, metrics }) => {
        agentStatusTracker.updateAgentMetrics(agentId, metrics)
      })

      orchestrator.on('checkpoint', (checkpoint) => {
        safeSend('ralph:checkpoint', checkpoint)
      })

      orchestrator.on('complete', (result) => {
        safeSend('ralph:session:complete', {
          sessionId: config.sessionId,
          ...result,
        })
        // P1 FIX: Clean up listeners before deleting
        orchestrator.removeAllListeners()
        activeOrchestrators.delete(config.sessionId)
      })

      orchestrator.on('error', (error) => {
        safeSend('ralph:session:error', {
          sessionId: config.sessionId,
          error: sanitizeError(error),
        })
      })

      // Store orchestrator
      activeOrchestrators.set(config.sessionId, orchestrator)

      // P1 FIX: Start execution with proper error handling and listener cleanup
      orchestrator.start().catch((error) => {
        console.error(`Session ${config.sessionId} failed:`, error instanceof Error ? error.message : 'unknown error')
        safeSend('ralph:session:error', {
          sessionId: config.sessionId,
          error: sanitizeError(error),
        })
        orchestrator.removeAllListeners()
        activeOrchestrators.delete(config.sessionId)
      })

      return { success: true }
    } catch (error) {
      return { success: false, error: sanitizeError(error) }
    }
  }
)

/**
 * Pause parallel execution
 */
ipcMain.handle(
  'ralph:parallel:pause',
  async (
    _event: IpcMainInvokeEvent,
    sessionId: string
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      if (!isValidSessionId(sessionId)) {
        return { success: false, error: 'Invalid session ID' }
      }

      const orchestrator = activeOrchestrators.get(sessionId)
      if (!orchestrator) {
        return { success: false, error: 'Session not found' }
      }

      await orchestrator.pause()
      return { success: true }
    } catch (error) {
      return { success: false, error: sanitizeError(error) }
    }
  }
)

/**
 * Resume parallel execution
 */
ipcMain.handle(
  'ralph:parallel:resume',
  async (
    _event: IpcMainInvokeEvent,
    sessionId: string
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      if (!isValidSessionId(sessionId)) {
        return { success: false, error: 'Invalid session ID' }
      }

      const orchestrator = activeOrchestrators.get(sessionId)
      if (!orchestrator) {
        return { success: false, error: 'Session not found' }
      }

      await orchestrator.resume()
      return { success: true }
    } catch (error) {
      return { success: false, error: sanitizeError(error) }
    }
  }
)

/**
 * Stop parallel execution
 */
ipcMain.handle(
  'ralph:parallel:stop',
  async (
    _event: IpcMainInvokeEvent,
    sessionId: string
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      if (!isValidSessionId(sessionId)) {
        return { success: false, error: 'Invalid session ID' }
      }

      const orchestrator = activeOrchestrators.get(sessionId)
      if (!orchestrator) {
        return { success: false, error: 'Session not found' }
      }

      await orchestrator.stop()
      activeOrchestrators.delete(sessionId)
      return { success: true }
    } catch (error) {
      return { success: false, error: sanitizeError(error) }
    }
  }
)

/**
 * Get session status
 */
ipcMain.handle(
  'ralph:parallel:status',
  async (
    _event: IpcMainInvokeEvent,
    sessionId: string
  ): Promise<{ success: boolean; status?: RalphSessionStatus; error?: string }> => {
    try {
      if (!isValidSessionId(sessionId)) {
        return { success: false, error: 'Invalid session ID' }
      }

      const orchestrator = activeOrchestrators.get(sessionId)
      if (!orchestrator) {
        // Try getting from status tracker
        const status = agentStatusTracker.getSessionStatus(sessionId)
        if (status) {
          return { success: true, status }
        }
        return { success: false, error: 'Session not found' }
      }

      const status = orchestrator.getStatus()
      return { success: true, status }
    } catch (error) {
      return { success: false, error: sanitizeError(error) }
    }
  }
)

/**
 * List all active sessions
 */
ipcMain.handle(
  'ralph:parallel:list',
  async (_event: IpcMainInvokeEvent): Promise<{ success: boolean; sessions?: RalphSessionStatus[]; error?: string }> => {
    try {
      const sessions: RalphSessionStatus[] = []

      for (const [sessionId, orchestrator] of activeOrchestrators) {
        sessions.push(orchestrator.getStatus())
      }

      return { success: true, sessions }
    } catch (error) {
      return { success: false, error: sanitizeError(error) }
    }
  }
)

// =============================================================================
// Agent Status Handlers
// =============================================================================

/**
 * Get agent status
 */
ipcMain.handle(
  'ralph:agent:status',
  async (
    _event: IpcMainInvokeEvent,
    agentId: string
  ): Promise<{ success: boolean; status?: AgentStatus; error?: string }> => {
    try {
      const status = agentStatusTracker.getAgentStatus(agentId)
      if (!status) {
        return { success: false, error: 'Agent not found' }
      }
      return { success: true, status }
    } catch (error) {
      return { success: false, error: sanitizeError(error) }
    }
  }
)

/**
 * Get all agents for a session
 */
ipcMain.handle(
  'ralph:agent:list',
  async (
    _event: IpcMainInvokeEvent,
    sessionId: string
  ): Promise<{ success: boolean; agents?: AgentStatus[]; error?: string }> => {
    try {
      if (!isValidSessionId(sessionId)) {
        return { success: false, error: 'Invalid session ID' }
      }

      const agents = agentStatusTracker.getSessionAgents(sessionId)
      return { success: true, agents }
    } catch (error) {
      return { success: false, error: sanitizeError(error) }
    }
  }
)

/**
 * Get session metrics
 */
ipcMain.handle(
  'ralph:agent:metrics',
  async (
    _event: IpcMainInvokeEvent,
    sessionId: string
  ): Promise<{
    success: boolean
    metrics?: {
      totalTokens: number
      totalCost: number
      totalFilesModified: number
      totalTestsRun: number
      totalTestsPassed: number
    }
    error?: string
  }> => {
    try {
      if (!isValidSessionId(sessionId)) {
        return { success: false, error: 'Invalid session ID' }
      }

      const metrics = agentStatusTracker.getSessionMetrics(sessionId)
      return { success: true, metrics }
    } catch (error) {
      return { success: false, error: sanitizeError(error) }
    }
  }
)

// =============================================================================
// Cleanup on App Exit
// =============================================================================

/**
 * Cleanup all active sessions
 */
export async function cleanupAllSessions(): Promise<void> {
  const promises: Promise<void>[] = []

  for (const [sessionId, orchestrator] of activeOrchestrators) {
    promises.push(
      orchestrator.cleanup().catch((error) => {
        console.error(`Failed to cleanup session ${sessionId}:`, error)
      })
    )
  }

  await Promise.allSettled(promises)
  activeOrchestrators.clear()
  agentStatusTracker.clear()
}

/**
 * Export handler registration function
 */
export function registerRalphParallelHandlers(): void {
  // Handlers are registered via ipcMain.handle above
  console.log('Ralph parallel handlers registered')
}

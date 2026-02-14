/**
 * BVS (Bounded Verified Sections) IPC Handlers
 *
 * Handles all IPC communication between renderer and main process
 * for the BVS workflow system.
 */

import { ipcMain, IpcMainInvokeEvent } from 'electron'
import { BVS_IPC_CHANNELS, type BvsConfig, type BvsExecutionPlan } from '@shared/bvs-types'
import { getBvsOrchestratorService } from '../services/bvs-orchestrator-service'
import { getBvsTypeCheckService } from '../services/bvs-typecheck-service'
import { getBvsCodeReviewService } from '../services/bvs-code-review-service'
import { getBvsPlanningAgentV2 } from '../services/bvs-planning-agent-v2'
import { getPlanRevisionService } from '../services/bvs-plan-revision-service'

/**
 * Register all BVS IPC handlers
 */
export function registerBvsHandlers(): void {
  const orchestrator = getBvsOrchestratorService()
  const typeChecker = getBvsTypeCheckService()
  const codeReviewer = getBvsCodeReviewService()
  const planningAgent = getBvsPlanningAgentV2()

  // ============================================================================
  // Planning Agent V2 Handlers (Agent SDK with tools)
  // ============================================================================

  /**
   * Start or resume a planning session
   * @param projectPath - Path to the project
   * @param forceNew - If true, always create a new session (don't resume existing)
   * @param bvsProjectId - If provided, resume this specific BVS project
   */
  ipcMain.handle(
    BVS_IPC_CHANNELS.BVS_START_PLANNING,
    async (_event: IpcMainInvokeEvent, projectPath: string, forceNew: boolean = false, bvsProjectId?: string) => {
      try {
        console.log('[BVS-IPC] Starting planning session:', { projectPath, forceNew, bvsProjectId })
        const session = await planningAgent.createSession(projectPath, forceNew, bvsProjectId)
        console.log('[BVS-IPC] Returning session to frontend:', {
          sessionId: session.id,
          phase: session.phase,
          messagesCount: session.messages?.length ?? 0,
        })
        return { success: true, session }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        console.error('[BVS-IPC] Failed to start planning session:', message)
        return { success: false, error: message }
      }
    }
  )

  /**
   * Send a message to the planning agent
   */
  ipcMain.handle(
    BVS_IPC_CHANNELS.BVS_SEND_PLANNING_MESSAGE,
    async (_event: IpcMainInvokeEvent, sessionId: string, message: string) => {
      try {
        const response = await planningAgent.processMessage(sessionId, message)
        const session = planningAgent.getSession(sessionId)
        return {
          success: true,
          response,
          session,
          phase: session?.phase || 'exploring'
        }
      } catch (error) {
        const errMessage = error instanceof Error ? error.message : 'Unknown error'
        return { success: false, error: errMessage }
      }
    }
  )

  /**
   * Cancel/abort an active planning request
   */
  ipcMain.handle(
    BVS_IPC_CHANNELS.BVS_CANCEL_PLANNING,
    async (_event: IpcMainInvokeEvent, sessionId: string) => {
      try {
        return planningAgent.cancelSession(sessionId)
      } catch (error) {
        const errMessage = error instanceof Error ? error.message : 'Unknown error'
        return { success: false, error: errMessage }
      }
    }
  )

  /**
   * Answer questions from question cards
   */
  ipcMain.handle(
    'bvs:answer-questions',
    async (_event: IpcMainInvokeEvent, sessionId: string, answers: Record<string, string>) => {
      try {
        const response = await planningAgent.answerQuestions(sessionId, answers)
        const session = planningAgent.getSession(sessionId)
        return {
          success: true,
          response,
          session,
          phase: session?.phase || 'exploring'
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return { success: false, error: message }
      }
    }
  )

  /**
   * Select an option from the presented choices
   */
  ipcMain.handle(
    'bvs:select-option',
    async (_event: IpcMainInvokeEvent, sessionId: string, optionId: string) => {
      try {
        const response = await planningAgent.selectOption(sessionId, optionId)
        const session = planningAgent.getSession(sessionId)
        return {
          success: true,
          response,
          session,
          phase: session?.phase || 'planning'
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return { success: false, error: message }
      }
    }
  )

  /**
   * Approve the proposed plan (Planning Agent V2)
   */
  ipcMain.handle(
    'bvs:planning-approve',
    async (_event: IpcMainInvokeEvent, sessionId: string) => {
      try {
        const response = await planningAgent.approvePlan(sessionId)
        const session = planningAgent.getSession(sessionId)
        return {
          success: true,
          response,
          session,
          phase: session?.phase || 'complete'
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return { success: false, error: message }
      }
    }
  )

  /**
   * Request changes to the plan
   */
  ipcMain.handle(
    'bvs:request-changes',
    async (_event: IpcMainInvokeEvent, sessionId: string, feedback: string) => {
      try {
        const response = await planningAgent.requestChanges(sessionId, feedback)
        const session = planningAgent.getSession(sessionId)
        return {
          success: true,
          response,
          session,
          phase: session?.phase || 'approval'
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return { success: false, error: message }
      }
    }
  )

  /**
   * Get current session state
   */
  ipcMain.handle(
    'bvs:get-planning-session',
    async (_event: IpcMainInvokeEvent, sessionId: string) => {
      const session = planningAgent.getSession(sessionId)
      return { success: !!session, session }
    }
  )

  /**
   * Clear planning session (delete from disk to start fresh)
   */
  ipcMain.handle(
    'bvs:clear-planning-session',
    async (_event: IpcMainInvokeEvent, projectPath: string) => {
      try {
        await planningAgent.clearSession(projectPath)
        return { success: true }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return { success: false, error: message }
      }
    }
  )

  // ============================================================================
  // Session Management
  // ============================================================================

  /**
   * Create a new BVS session
   */
  ipcMain.handle(
    BVS_IPC_CHANNELS.BVS_CREATE_SESSION,
    async (_event: IpcMainInvokeEvent, projectPath: string) => {
      try {
        const session = await orchestrator.createSession(projectPath)
        return { success: true, session }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return { success: false, error: message }
      }
    }
  )

  /**
   * Get session by ID
   */
  ipcMain.handle(
    BVS_IPC_CHANNELS.BVS_GET_SESSION,
    async (_event: IpcMainInvokeEvent, sessionId: string) => {
      const session = orchestrator.getSession(sessionId)
      return { success: !!session, session }
    }
  )

  /**
   * List all sessions
   */
  ipcMain.handle(
    BVS_IPC_CHANNELS.BVS_LIST_SESSIONS,
    async () => {
      const sessions = orchestrator.listSessions()
      console.log('[BVS] listSessions called, found:', sessions.length, 'sessions')
      if (sessions.length > 0) {
        console.log('[BVS] Session IDs:', sessions.map(s => s.id))
        console.log('[BVS] First session projectId:', sessions[0].projectId)
        console.log('[BVS] First session plan sections:', sessions[0].plan?.sections?.length || 0)
      }
      return { success: true, sessions }
    }
  )

  /**
   * Restore a session from progress file
   * Used when app restarts and in-memory sessions are lost
   */
  ipcMain.handle(
    BVS_IPC_CHANNELS.BVS_RESTORE_SESSION,
    async (_event: IpcMainInvokeEvent, projectPath: string, projectId: string) => {
      try {
        console.log('[BVS] Attempting to restore session for project:', projectId)
        const session = await orchestrator.restoreSessionFromProgress(projectPath, projectId)
        if (session) {
          console.log('[BVS] Session restored:', session.id, 'status:', session.status)
          return { success: true, session }
        } else {
          console.log('[BVS] No session to restore for project:', projectId)
          return { success: true, session: null }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        console.error('[BVS] Error restoring session:', message)
        return { success: false, error: message }
      }
    }
  )

  /**
   * Delete a session
   */
  ipcMain.handle(
    BVS_IPC_CHANNELS.BVS_DELETE_SESSION,
    async (_event: IpcMainInvokeEvent, sessionId: string) => {
      try {
        const deleted = await orchestrator.deleteSession(sessionId)
        return { success: deleted }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return { success: false, error: message }
      }
    }
  )

  // ============================================================================
  // Plan Management
  // ============================================================================

  /**
   * Analyze codebase and generate sections
   * NOTE: This is a placeholder - actual implementation would use agent
   */
  ipcMain.handle(
    BVS_IPC_CHANNELS.BVS_ANALYZE_CODEBASE,
    async (_event: IpcMainInvokeEvent, projectPath: string) => {
      try {
        // TODO: Implement codebase analysis using agent
        return {
          success: true,
          context: {
            framework: null,
            language: 'typescript',
            packageManager: 'npm',
            hasTypeScript: true,
            hasTests: true,
            testFramework: 'vitest',
            lintCommand: 'npm run lint',
            buildCommand: 'npm run build',
            devCommand: 'npm run dev',
            patterns: [],
            conventions: [],
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return { success: false, error: message }
      }
    }
  )

  /**
   * Approve plan for execution
   */
  ipcMain.handle(
    BVS_IPC_CHANNELS.BVS_APPROVE_PLAN,
    async (_event: IpcMainInvokeEvent, sessionId: string) => {
      try {
        await orchestrator.approvePlan(sessionId)
        return { success: true }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return { success: false, error: message }
      }
    }
  )

  // ============================================================================
  // Execution Control
  // ============================================================================

  /**
   * Start execution of approved plan
   */
  ipcMain.handle(
    BVS_IPC_CHANNELS.BVS_START_EXECUTION,
    async (_event: IpcMainInvokeEvent, sessionId: string) => {
      try {
        await orchestrator.startExecution(sessionId)
        return { success: true }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return { success: false, error: message }
      }
    }
  )

  /**
   * Pause execution
   */
  ipcMain.handle(
    BVS_IPC_CHANNELS.BVS_PAUSE_EXECUTION,
    async (_event: IpcMainInvokeEvent, sessionId: string) => {
      try {
        await orchestrator.pauseExecution(sessionId)
        return { success: true }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return { success: false, error: message }
      }
    }
  )

  /**
   * Resume execution
   */
  ipcMain.handle(
    BVS_IPC_CHANNELS.BVS_RESUME_EXECUTION,
    async (_event: IpcMainInvokeEvent, sessionId: string) => {
      try {
        await orchestrator.resumeExecution(sessionId)
        return { success: true }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return { success: false, error: message }
      }
    }
  )

  /**
   * Start execution with phase/section selection
   */
  ipcMain.handle(
    'bvs:start-execution-with-selection',
    async (
      _event: IpcMainInvokeEvent,
      projectPath: string,
      projectId: string,
      selectedSectionIds: string[],
      config: any
    ) => {
      try {
        console.log('[BVS] Starting execution with selection:', {
          projectPath,
          projectId,
          selectedSectionIds,
          config
        })

        // Load the plan from the project directory
        const plan = await orchestrator.loadPlan(projectPath, projectId)
        if (!plan) {
          console.error('[BVS] Plan not found for project:', projectId)
          return { success: false, error: 'Plan not found for project' }
        }
        console.log('[BVS] Plan loaded, total sections:', plan.sections?.length || 0)

        // Validate selected sections exist in plan
        const validSectionIds = selectedSectionIds.filter(id =>
          plan.sections.some(s => s.id === id)
        )
        if (validSectionIds.length === 0) {
          return { success: false, error: 'No valid sections selected for execution' }
        }
        console.log('[BVS] Valid selected sections:', validSectionIds.length)

        // Create a session from the plan
        console.log('[BVS] Creating session from plan...')
        const sessionId = await orchestrator.createSessionFromPlan(projectPath, projectId, plan)
        console.log('[BVS] Session created:', sessionId)

        // Execute selected sections
        console.log('[BVS] Starting execution with selected sections...')
        await orchestrator.executeSelectedSections(
          projectPath,
          sessionId,
          validSectionIds,
          config
        )
        console.log('[BVS] Execution started')

        // Update project status
        try {
          await planningAgent.updateProjectStatus(projectPath, projectId, 'in_progress', {
            executionStartedAt: Date.now()
          })
          console.log('[BVS] Project status updated to in_progress')
        } catch (statusError) {
          console.warn('[BVS] Failed to update project status:', statusError)
        }

        return { success: true, sessionId }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        console.error('[BVS] Error in startExecutionWithSelection:', error)
        return { success: false, error: message }
      }
    }
  )

  /**
   * Stop execution
   */
  ipcMain.handle(
    BVS_IPC_CHANNELS.BVS_STOP_EXECUTION,
    async (_event: IpcMainInvokeEvent, sessionId: string) => {
      try {
        await orchestrator.stopExecution(sessionId)
        return { success: true }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return { success: false, error: message }
      }
    }
  )

  /**
   * Retry a failed section
   */
  ipcMain.handle(
    BVS_IPC_CHANNELS.BVS_RETRY_SECTION,
    async (_event: IpcMainInvokeEvent, sessionId: string, sectionId: string) => {
      try {
        await orchestrator.retrySection(sessionId, sectionId)
        return { success: true }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return { success: false, error: message }
      }
    }
  )

  /**
   * Skip a failed section
   */
  ipcMain.handle(
    BVS_IPC_CHANNELS.BVS_SKIP_SECTION,
    async (_event: IpcMainInvokeEvent, sessionId: string, sectionId: string) => {
      try {
        await orchestrator.skipSection(sessionId, sectionId)
        return { success: true }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return { success: false, error: message }
      }
    }
  )

  /**
   * Start execution from a project directory
   * Loads plan from project dir and creates a new session
   */
  ipcMain.handle(
    'bvs:start-execution-from-project',
    async (_event: IpcMainInvokeEvent, projectPath: string, projectId: string) => {
      try {
        console.log('[BVS] Starting execution from project:', { projectPath, projectId })

        // Load the plan from the project directory
        const plan = await orchestrator.loadPlan(projectPath, projectId)
        if (!plan) {
          console.error('[BVS] Plan not found for project:', projectId)
          return { success: false, error: 'Plan not found for project' }
        }
        console.log('[BVS] Plan loaded, sections:', plan.sections?.length || 0)

        // Validate plan has sections
        if (!plan.sections || plan.sections.length === 0) {
          return { success: false, error: 'Plan has no sections to execute' }
        }

        // Create a session from the plan
        console.log('[BVS] Creating session from plan...')
        const sessionId = await orchestrator.createSessionFromPlan(projectPath, projectId, plan)
        console.log('[BVS] Session created:', sessionId)

        // Start execution
        console.log('[BVS] Starting execution...')
        await orchestrator.startExecution(sessionId)
        console.log('[BVS] Execution started')

        // Update project status
        try {
          await planningAgent.updateProjectStatus(projectPath, projectId, 'in_progress', {
            executionStartedAt: Date.now()
          })
          console.log('[BVS] Project status updated to in_progress')
        } catch (statusError) {
          console.warn('[BVS] Failed to update project status:', statusError)
          // Don't fail the whole operation if status update fails
        }

        return { success: true, sessionId }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        const stack = error instanceof Error ? error.stack : ''
        console.error('[BVS] Failed to start execution:', message)
        console.error('[BVS] Stack:', stack)
        return { success: false, error: message }
      }
    }
  )

  // ============================================================================
  // TypeScript Verification
  // ============================================================================

  /**
   * Run incremental TypeScript check
   */
  ipcMain.handle(
    BVS_IPC_CHANNELS.BVS_RUN_TYPECHECK,
    async (_event: IpcMainInvokeEvent, projectPath: string, incremental: boolean = true) => {
      try {
        const result = incremental
          ? await typeChecker.runIncrementalCheck(projectPath)
          : await typeChecker.runFullCheck(projectPath)
        return { success: true, result }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return { success: false, error: message }
      }
    }
  )

  // ============================================================================
  // Code Review
  // ============================================================================

  /**
   * Run code review on files
   */
  ipcMain.handle(
    BVS_IPC_CHANNELS.BVS_RUN_CODE_REVIEW,
    async (
      _event: IpcMainInvokeEvent,
      projectPath: string,
      files: string[],
      sectionId: string
    ) => {
      try {
        const result = await codeReviewer.runCodeReview(projectPath, files, sectionId)
        return { success: true, result }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return { success: false, error: message }
      }
    }
  )

  /**
   * Get review results for a section
   */
  ipcMain.handle(
    BVS_IPC_CHANNELS.BVS_GET_REVIEW_RESULTS,
    async (_event: IpcMainInvokeEvent, projectPath: string, sectionId: string) => {
      // This would retrieve stored review results
      return { success: true, result: null }
    }
  )

  // ============================================================================
  // Learning System
  // ============================================================================

  /**
   * Capture a learning
   */
  ipcMain.handle(
    BVS_IPC_CHANNELS.BVS_CAPTURE_LEARNING,
    async (
      _event: IpcMainInvokeEvent,
      projectPath: string,
      learning: {
        problem: string
        solution: string
        preventionRule: string
        files?: string[]
      }
    ) => {
      try {
        await orchestrator.captureLearning(projectPath, {
          id: `L${Date.now()}`,
          ...learning,
          createdAt: Date.now(),
          appliedCount: 0,
        })
        return { success: true }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return { success: false, error: message }
      }
    }
  )

  /**
   * Get learnings for a project
   */
  ipcMain.handle(
    BVS_IPC_CHANNELS.BVS_GET_LEARNINGS,
    async (_event: IpcMainInvokeEvent, projectPath: string) => {
      try {
        const content = await orchestrator.loadLearnings(projectPath)
        return { success: true, content }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return { success: false, error: message }
      }
    }
  )

  // ============================================================================
  // Configuration
  // ============================================================================

  /**
   * Get BVS configuration
   */
  ipcMain.handle(
    BVS_IPC_CHANNELS.BVS_GET_CONFIG,
    async (_event: IpcMainInvokeEvent, projectPath: string) => {
      try {
        const config = await orchestrator.loadConfig(projectPath)
        return { success: true, config }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return { success: false, error: message }
      }
    }
  )

  /**
   * Set BVS configuration
   */
  ipcMain.handle(
    BVS_IPC_CHANNELS.BVS_SET_CONFIG,
    async (_event: IpcMainInvokeEvent, projectPath: string, config: Partial<BvsConfig>) => {
      try {
        await orchestrator.saveConfig(projectPath, config)
        return { success: true }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return { success: false, error: message }
      }
    }
  )

  // ============================================================================
  // Project Management Handlers
  // ============================================================================

  /**
   * List all BVS projects for a codebase
   */
  ipcMain.handle(
    BVS_IPC_CHANNELS.BVS_LIST_PROJECTS,
    async (_event: IpcMainInvokeEvent, projectPath: string) => {
      try {
        const projects = await planningAgent.listProjects(projectPath)
        return { success: true, projects }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return { success: false, error: message, projects: [] }
      }
    }
  )

  /**
   * Get a specific project by ID
   */
  ipcMain.handle(
    BVS_IPC_CHANNELS.BVS_GET_PROJECT,
    async (_event: IpcMainInvokeEvent, projectPath: string, projectId: string) => {
      try {
        const project = await planningAgent.getProject(projectPath, projectId)
        if (!project) {
          return { success: false, error: 'Project not found' }
        }
        return { success: true, project }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return { success: false, error: message }
      }
    }
  )

  /**
   * Update project status
   */
  ipcMain.handle(
    BVS_IPC_CHANNELS.BVS_UPDATE_PROJECT,
    async (_event: IpcMainInvokeEvent, projectPath: string, projectId: string, updates: { status?: string; selectedSections?: string[] }) => {
      try {
        const project = await planningAgent.updateProjectStatus(
          projectPath,
          projectId,
          updates.status as 'planning' | 'ready' | 'in_progress' | 'paused' | 'completed' | 'cancelled',
          { selectedSections: updates.selectedSections }
        )
        if (!project) {
          return { success: false, error: 'Failed to update project' }
        }
        return { success: true, project }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return { success: false, error: message }
      }
    }
  )

  /**
   * Delete/archive a project
   */
  ipcMain.handle(
    BVS_IPC_CHANNELS.BVS_DELETE_PROJECT,
    async (_event: IpcMainInvokeEvent, projectPath: string, projectId: string, archive = true) => {
      try {
        const success = await planningAgent.deleteProject(projectPath, projectId, archive)
        return { success }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return { success: false, error: message }
      }
    }
  )

  /**
   * Resume a project (load its session)
   */
  ipcMain.handle(
    'bvs:resume-project',
    async (_event: IpcMainInvokeEvent, projectPath: string, projectId: string) => {
      try {
        const session = await planningAgent.resumeProject(projectPath, projectId)
        if (!session) {
          return { success: false, error: 'Failed to resume project' }
        }
        return { success: true, session }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return { success: false, error: message }
      }
    }
  )

  /**
   * Load plan for execution (with optional project ID)
   */
  ipcMain.handle(
    'bvs:load-plan',
    async (_event: IpcMainInvokeEvent, projectPath: string, projectId?: string) => {
      try {
        const plan = await orchestrator.loadPlan(projectPath, projectId)
        if (!plan) {
          return { success: false, error: 'Plan not found' }
        }
        return { success: true, plan }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return { success: false, error: message }
      }
    }
  )

  // ============================================================================
  // Plan Revision Handlers
  // ============================================================================

  const planRevision = getPlanRevisionService()

  /**
   * Analyze plan for issues
   */
  ipcMain.handle(
    'bvs:analyze-plan',
    async (_event: IpcMainInvokeEvent, projectPath: string, projectId: string) => {
      try {
        const result = await planRevision.analyzePlan(projectPath, projectId)
        return result
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return { success: false, issues: [], error: message }
      }
    }
  )

  /**
   * Send revision request to agent
   */
  ipcMain.handle(
    'bvs:revise-plan',
    async (_event: IpcMainInvokeEvent, request: any) => {
      try {
        const result = await planRevision.revisePlan(request)
        return result
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return { success: false, error: message }
      }
    }
  )

  /**
   * Apply plan changes
   */
  ipcMain.handle(
    'bvs:apply-plan-changes',
    async (_event: IpcMainInvokeEvent, projectPath: string, projectId: string, changes: any[]) => {
      try {
        const result = await planRevision.applyChanges(projectPath, projectId, changes)
        return result
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return { success: false, error: message }
      }
    }
  )

  // ============================================================================
  // Parallel Execution with Merge Points
  // ============================================================================

  /**
   * Start execution with parallel workers and merge points
   * This is the main execution method for Option B workflow
   */
  ipcMain.handle(
    'bvs:start-parallel-execution',
    async (_event: IpcMainInvokeEvent, sessionId: string) => {
      try {
        await orchestrator.executeWithMergePoints(sessionId)
        return { success: true }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return { success: false, error: message }
      }
    }
  )

  /**
   * Start parallel execution from a project directory
   * Loads plan and creates session, then starts execution with merge points
   */
  ipcMain.handle(
    'bvs:start-parallel-execution-from-project',
    async (_event: IpcMainInvokeEvent, projectPath: string, projectId: string) => {
      try {
        console.log('[BVS] Starting parallel execution from project:', { projectPath, projectId })

        // Load the plan from the project directory
        const plan = await orchestrator.loadPlan(projectPath, projectId)
        if (!plan) {
          return { success: false, error: 'Plan not found for project' }
        }

        // Validate plan has sections
        if (!plan.sections || plan.sections.length === 0) {
          return { success: false, error: 'Plan has no sections to execute' }
        }

        // Create a session from the plan
        const sessionId = await orchestrator.createSessionFromPlan(projectPath, projectId, plan)
        console.log('[BVS] Session created:', sessionId)

        // Update project status
        try {
          await planningAgent.updateProjectStatus(projectPath, projectId, 'in_progress', {
            executionStartedAt: Date.now()
          })
        } catch {
          // Don't fail if status update fails
        }

        // Start parallel execution with merge points
        await orchestrator.executeWithMergePoints(sessionId)
        console.log('[BVS] Parallel execution started')

        return { success: true, sessionId }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        console.error('[BVS] Failed to start parallel execution:', message)
        return { success: false, error: message }
      }
    }
  )

  /**
   * Get complexity analysis for all sections in a plan
   */
  ipcMain.handle(
    'bvs:analyze-complexity',
    async (_event: IpcMainInvokeEvent, projectPath: string, projectId: string) => {
      try {
        const { complexityAnalyzer } = await import('../services/bvs-complexity-analyzer-service')

        const plan = await orchestrator.loadPlan(projectPath, projectId)
        if (!plan || !plan.sections) {
          return { success: false, error: 'Plan not found' }
        }

        const analyses = complexityAnalyzer.analyzeAll(plan.sections)
        const distribution = complexityAnalyzer.getModelDistribution(plan.sections)

        return {
          success: true,
          analyses,
          distribution,
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return { success: false, error: message }
      }
    }
  )

  // ============================================================================
  // RALPH-014: Ralph Loop IPC Handlers
  // ============================================================================

  /**
   * Get session cost tracking
   */
  ipcMain.handle(
    'bvs:get-session-cost',
    async (_event: IpcMainInvokeEvent, sessionId: string) => {
      try {
        const cost = orchestrator.getSessionCost(sessionId)
        return { success: true, cost }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return { success: false, error: message }
      }
    }
  )

  /**
   * Set execution config (modes, limits)
   */
  ipcMain.handle(
    'bvs:set-execution-config',
    async (_event: IpcMainInvokeEvent, config: any) => {
      try {
        // TODO: Add setExecutionConfig method to orchestrator
        return { success: true }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return { success: false, error: message }
      }
    }
  )

  /**
   * Get subtask progress for a section
   */
  ipcMain.handle(
    'bvs:get-subtask-progress',
    async (_event: IpcMainInvokeEvent, sessionId: string, sectionId: string) => {
      try {
        const session = await orchestrator.getSession(sessionId)
        if (!session) {
          return { success: false, error: 'Session not found' }
        }
        if (!session.plan) {
          return { success: false, error: 'No plan found' }
        }

        const section = session.plan.sections.find(s => s.id === sectionId)
        if (!section) {
          return { success: false, error: 'Section not found' }
        }

        return {
          success: true,
          subtasks: section.subtasks || []
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return { success: false, error: message }
      }
    }
  )

  /**
   * Approve paused execution
   */
  ipcMain.handle(
    'bvs:approve-continue',
    async (_event: IpcMainInvokeEvent, sessionId: string) => {
      try {
        await orchestrator.resumeExecution(sessionId)
        return { success: true }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return { success: false, error: message }
      }
    }
  )

  // ============================================================================
  // Execution Runs - Persistent storage for partial runs
  // ============================================================================

  /**
   * List execution runs for a project
   */
  ipcMain.handle(
    BVS_IPC_CHANNELS.BVS_LIST_EXECUTION_RUNS,
    async (_event: IpcMainInvokeEvent, projectPath: string, projectId: string) => {
      try {
        const runs = await orchestrator.listExecutionRuns(projectPath, projectId)
        return { success: true, runs }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return { success: false, error: message, runs: [] }
      }
    }
  )

  /**
   * Get a specific execution run
   */
  ipcMain.handle(
    BVS_IPC_CHANNELS.BVS_GET_EXECUTION_RUN,
    async (_event: IpcMainInvokeEvent, projectPath: string, projectId: string, runId: string) => {
      try {
        const run = await orchestrator.getExecutionRun(projectPath, projectId, runId)
        if (!run) {
          return { success: false, error: 'Run not found' }
        }
        return { success: true, run }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return { success: false, error: message }
      }
    }
  )

  /**
   * Delete an execution run
   */
  ipcMain.handle(
    BVS_IPC_CHANNELS.BVS_DELETE_EXECUTION_RUN,
    async (_event: IpcMainInvokeEvent, projectPath: string, projectId: string, runId: string) => {
      try {
        await orchestrator.deleteExecutionRun(projectPath, projectId, runId)
        return { success: true }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return { success: false, error: message }
      }
    }
  )

  /**
   * Resume a previous execution run
   */
  ipcMain.handle(
    BVS_IPC_CHANNELS.BVS_RESUME_EXECUTION_RUN,
    async (_event: IpcMainInvokeEvent, projectPath: string, projectId: string, runId: string) => {
      try {
        const sessionId = await orchestrator.resumeExecutionRun(projectPath, projectId, runId)
        return { success: true, sessionId }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return { success: false, error: message }
      }
    }
  )

  console.log('[BVS] IPC handlers registered')
}

/**
 * Unregister all BVS IPC handlers
 */
export function unregisterBvsHandlers(): void {
  const channels = Object.values(BVS_IPC_CHANNELS)
  for (const channel of channels) {
    ipcMain.removeHandler(channel)
  }
  console.log('[BVS] IPC handlers unregistered')
}

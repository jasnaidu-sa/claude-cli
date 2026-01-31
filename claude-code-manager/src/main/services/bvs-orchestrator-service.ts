/**
 * BVS (Bounded Verified Sections) Orchestrator Service
 *
 * Manages the BVS workflow for reliable autonomous code generation.
 * Coordinates:
 * - PRD parsing and planning
 * - Section execution with typecheck-after-edit
 * - Parallel worker management
 * - Code review via start-task agents
 * - E2E testing via Claude-in-Chrome
 * - Quality gates and learning system
 */

import { EventEmitter } from 'events'
import * as path from 'path'
import * as fs from 'fs/promises'
import { getMainWindow } from '../index'
import {
  BVS_IPC_CHANNELS,
  DEFAULT_BVS_CONFIG,
  DEFAULT_BVS_EXECUTION_CONFIG,
  BVS_PROJECT_FILES,
  BVS_GLOBAL_FILES,
  SessionLimitError,
  type BvsSession,
  type BvsPhase,
  type BvsStatus,
  type BvsExecutionPlan,
  type BvsSection,
  type BvsSectionStatus,
  type BvsWorkerState,
  type BvsWorkerId,
  type BvsWorkerInfo,
  type BvsConfig,
  type BvsCodebaseContext,
  type BvsEvent,
  type BvsQualityGateResult,
  type BvsCodeReviewResult,
  type BvsLearning,
  type BvsDependencyGraph,
  type BvsParallelGroup,
  type BvsProject,
  type BvsExecutionConfig,
  type BvsExecutionRun,
} from '@shared/bvs-types'

// Import new execution services
import {
  complexityAnalyzer,
  BVS_MODELS,
  type ComplexityAnalysis,
} from './bvs-complexity-analyzer-service'
import { getBvsLearningCaptureService } from './bvs-learning-capture-service'
// Using SDK service for real-time streaming (matches planning agent pattern)
import {
  BvsWorkerSdkService,
  type WorkerConfig,
  type WorkerResult,
  type ProjectContext,
} from './bvs-worker-sdk-service'
import {
  mergePointService,
  type MergePointConfig,
  type MergePointResult,
  BVS_MERGE_CHANNELS,
} from './bvs-merge-point-service'
import { ConfigStore } from './config-store'

// UltraQA-style services for quality assurance
import { goalReviewer, type GoalReviewResult } from './bvs-goal-reviewer-service'
import { fixLoop, type FixLoopConfig, type FixLoopResult } from './bvs-fix-loop-service'

// Directory structure constants
const BVS_DIR = '.bvs'
const CONFIG_FILE = 'config.json'
const CONVENTIONS_FILE = 'conventions.md'
const LEARNINGS_FILE = 'learnings.md'
const REVIEW_NOTES_FILE = 'review-notes.md'
const PLAN_FILE = 'plan.json'
const PROGRESS_FILE = 'progress.json'

/**
 * Generate unique session ID
 */
function generateSessionId(): string {
  return `bvs-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
}

/**
 * Generate unique section ID
 */
function generateSectionId(index: number): string {
  return `section-${String(index + 1).padStart(3, '0')}`
}

/**
 * BVS Orchestrator Service
 */
export class BvsOrchestratorService extends EventEmitter {
  private sessions: Map<string, BvsSession> = new Map()
  private workerProcesses: Map<string, unknown> = new Map() // Task agent references
  private config: BvsConfig = DEFAULT_BVS_CONFIG
  private executionConfig: BvsExecutionConfig = DEFAULT_BVS_EXECUTION_CONFIG // RALPH-010
  private configStore: ConfigStore

  // RALPH-010: Session-level cost tracking
  private sessionCosts: Map<string, {
    totalCost: number
    subtaskCount: number
    iterationCount: number
  }> = new Map()

  constructor(configStore: ConfigStore) {
    super()
    this.configStore = configStore
  }

  /**
   * RALPH-010: Check Session Limits
   *
   * Enforces limits to prevent runaway costs:
   * - Max iterations per subtask
   * - Max cost per subtask
   * - Max cost per section
   * - Max total cost for session
   */
  private checkSessionLimits(
    sessionId: string,
    sectionId: string,
    subtaskCost?: number,
    iterationCount?: number
  ): void {
    const limits = this.executionConfig.limits
    const sessionTracking = this.sessionCosts.get(sessionId) || {
      totalCost: 0,
      subtaskCount: 0,
      iterationCount: 0,
    }

    // Check subtask iteration limit
    if (iterationCount && iterationCount > limits.maxIterationsPerSubtask) {
      throw new SessionLimitError(
        'iterations',
        limits.maxIterationsPerSubtask,
        iterationCount,
        `Section ${sectionId} subtask exceeded max iterations`
      )
    }

    // Check subtask cost limit
    if (subtaskCost && subtaskCost > limits.maxCostPerSubtask) {
      throw new SessionLimitError(
        'cost',
        limits.maxCostPerSubtask,
        subtaskCost,
        `Section ${sectionId} subtask exceeded max cost`
      )
    }

    // Check total session cost limit
    const newTotal = sessionTracking.totalCost + (subtaskCost || 0)
    if (newTotal > limits.maxTotalCost) {
      throw new SessionLimitError(
        'cost',
        limits.maxTotalCost,
        newTotal,
        `Session ${sessionId} exceeded total cost budget`
      )
    }

    // Update tracking
    if (subtaskCost) {
      sessionTracking.totalCost += subtaskCost
      sessionTracking.subtaskCount++
    }
    if (iterationCount) {
      sessionTracking.iterationCount += iterationCount
    }
    this.sessionCosts.set(sessionId, sessionTracking)
  }

  /**
   * RALPH-010: Get current session cost
   */
  getSessionCost(sessionId: string): number {
    return this.sessionCosts.get(sessionId)?.totalCost || 0
  }

  /**
   * RALPH-012: Check if should pause for user approval
   *
   * Execution modes:
   * - ATTENDED_SINGLE: Pause after EACH subtask
   * - ATTENDED_LEVEL: Pause after each parallel LEVEL completes
   * - SEMI_ATTENDED: Pause only if issue detected
   * - UNATTENDED: No pauses, full automation
   */
  private async shouldPauseForApproval(
    sessionId: string,
    context: 'subtask' | 'level' | 'issue',
    details?: {
      sectionId?: string
      subtaskId?: string
      level?: number
      issue?: string
    }
  ): Promise<boolean> {
    const mode = this.executionConfig.mode

    // UNATTENDED: Never pause
    if (mode === 'UNATTENDED') {
      return false
    }

    // ATTENDED_SINGLE: Pause after every subtask
    if (mode === 'ATTENDED_SINGLE' && context === 'subtask') {
      console.log(`[BvsOrchestrator] Pausing for approval (ATTENDED_SINGLE)`)
      await this.pauseExecution(sessionId, `Awaiting approval after subtask ${details?.subtaskId}`)
      return true
    }

    // ATTENDED_LEVEL: Pause after each level
    if (mode === 'ATTENDED_LEVEL' && context === 'level') {
      console.log(`[BvsOrchestrator] Pausing for approval (ATTENDED_LEVEL) - Level ${details?.level} complete`)
      await this.pauseExecution(sessionId, `Awaiting approval after level ${details?.level}`)
      return true
    }

    // SEMI_ATTENDED: Pause only on issues
    if (mode === 'SEMI_ATTENDED' && context === 'issue') {
      console.log(`[BvsOrchestrator] Pausing for approval (SEMI_ATTENDED) - Issue: ${details?.issue}`)
      await this.pauseExecution(sessionId, `Awaiting approval due to issue: ${details?.issue}`)
      return true
    }

    return false
  }

  /**
   * RALPH-010: Calculate section cost from worker result
   */
  private calculateSectionCost(result: any): number {
    // If result has metrics with cost, use it
    if (result.metrics && typeof result.metrics.costUsd === 'number') {
      return result.metrics.costUsd
    }
    // Fallback: estimate based on turns (rough approximation)
    const avgCostPerTurn = 0.002 // ~$0.002 per turn (Sonnet)
    return result.turnsUsed * avgCostPerTurn
  }

  // ============================================================================
  // Event Helpers
  // ============================================================================

  /**
   * Send event to renderer process
   */
  private sendToRenderer(channel: string, data: unknown): void {
    const mainWindow = getMainWindow()
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, data)
    }
  }

  /**
   * Emit BVS event to both internal listeners and renderer
   */
  private emitBvsEvent(event: BvsEvent): void {
    this.emit('bvs-event', event)
    this.sendToRenderer(BVS_IPC_CHANNELS.BVS_EVENT, event)
  }

  // ============================================================================
  // Directory Management
  // ============================================================================

  /**
   * Get .bvs directory path
   */
  private getBvsDir(projectPath: string): string {
    return path.join(projectPath, BVS_DIR)
  }

  /**
   * Ensure .bvs directory structure exists
   */
  async ensureBvsDir(projectPath: string): Promise<string> {
    const bvsPath = this.getBvsDir(projectPath)

    // Create all necessary directories
    await fs.mkdir(path.join(bvsPath, 'prd'), { recursive: true })
    await fs.mkdir(path.join(bvsPath, 'sections'), { recursive: true })
    await fs.mkdir(path.join(bvsPath, 'screenshots'), { recursive: true })
    await fs.mkdir(path.join(bvsPath, 'logs'), { recursive: true })
    await fs.mkdir(path.join(bvsPath, 'worktrees'), { recursive: true })

    // Create default config if doesn't exist
    const configPath = path.join(bvsPath, CONFIG_FILE)
    try {
      await fs.access(configPath)
    } catch {
      await fs.writeFile(configPath, JSON.stringify(this.config, null, 2))
    }

    // Create default conventions file if doesn't exist
    const conventionsPath = path.join(bvsPath, CONVENTIONS_FILE)
    try {
      await fs.access(conventionsPath)
    } catch {
      await fs.writeFile(conventionsPath, DEFAULT_CONVENTIONS_CONTENT)
    }

    // Create empty learnings file if doesn't exist
    const learningsPath = path.join(bvsPath, LEARNINGS_FILE)
    try {
      await fs.access(learningsPath)
    } catch {
      await fs.writeFile(learningsPath, '# Learnings\n\n')
    }

    return bvsPath
  }

  // ============================================================================
  // Configuration
  // ============================================================================

  /**
   * Load BVS configuration from project
   */
  async loadConfig(projectPath: string): Promise<BvsConfig> {
    const configPath = path.join(this.getBvsDir(projectPath), CONFIG_FILE)
    try {
      const content = await fs.readFile(configPath, 'utf-8')
      this.config = { ...DEFAULT_BVS_CONFIG, ...JSON.parse(content) }
      return this.config
    } catch {
      return DEFAULT_BVS_CONFIG
    }
  }

  /**
   * Save BVS configuration
   */
  async saveConfig(projectPath: string, config: Partial<BvsConfig>): Promise<void> {
    this.config = { ...this.config, ...config }
    const configPath = path.join(this.getBvsDir(projectPath), CONFIG_FILE)
    await fs.writeFile(configPath, JSON.stringify(this.config, null, 2))
  }

  /**
   * Get current configuration
   */
  getConfig(): BvsConfig {
    return this.config
  }

  // ============================================================================
  // Session Management
  // ============================================================================

  /**
   * Create a new BVS session
   */
  async createSession(projectPath: string): Promise<BvsSession> {
    await this.ensureBvsDir(projectPath)
    await this.loadConfig(projectPath)

    const session: BvsSession = {
      id: generateSessionId(),
      projectPath,
      projectName: path.basename(projectPath),
      phase: 'input',
      status: 'idle',
      plan: null,
      workers: [],
      sectionsTotal: 0,
      sectionsCompleted: 0,
      sectionsFailed: 0,
      overallProgress: 0,
      currentSections: [],
      sessionLearnings: [],
      totalElapsedSeconds: 0,
      consecutiveFailures: 0,
    }

    this.sessions.set(session.id, session)
    return session
  }

  /**
   * Create a session from an existing plan (from project directory)
   */
  async createSessionFromPlan(
    projectPath: string,
    projectId: string,
    plan: BvsExecutionPlan
  ): Promise<string> {
    await this.ensureBvsDir(projectPath)
    await this.loadConfig(projectPath)

    const sessionId = generateSessionId()

    // Convert plan sections to BvsSection format if needed
    // IMPORTANT: Preserve existing section status (e.g., 'done' for completed sections)
    const sections: BvsSection[] = plan.sections.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description || '',
      files: s.files.map((f) => ({
        path: f.path,
        action: f.action,
        status: (f as any).status || 'pending' as const,
      })),
      dependencies: s.dependencies || [],
      dependents: [], // Will be computed
      // Preserve existing status from plan (e.g., 'done' from progress.json)
      status: (s as any).status || 'pending' as const,
      successCriteria: (s.successCriteria || []).map((c, i) => ({
        id: `${s.id}-criterion-${i}`,
        description: typeof c === 'string' ? c : c.description,
        passed: typeof c === 'object' ? (c as any).passed || false : false,
      })),
      // Preserve progress from plan
      progress: (s as any).progress || 0,
      retryCount: (s as any).retryCount || 0,
      maxRetries: 3,
      commits: [],
    }))

    // Compute dependents from dependencies
    for (const section of sections) {
      for (const depId of section.dependencies) {
        const dep = sections.find((s) => s.id === depId)
        if (dep) {
          dep.dependents.push(section.id)
        }
      }
    }

    // Always rebuild the dependency graph from sections to ensure correct format
    const dependencyGraph = this.buildDependencyGraph(sections)

    const session: BvsSession = {
      id: sessionId,
      projectPath,
      projectName: path.basename(projectPath),
      projectId,
      phase: 'executing',
      status: 'idle',
      plan: {
        ...plan,
        sections,
        dependencyGraph,
      },
      workers: [],
      sectionsTotal: sections.length,
      sectionsCompleted: 0,
      sectionsFailed: 0,
      overallProgress: 0,
      currentSections: [],
      sessionLearnings: [],
      totalElapsedSeconds: 0,
      consecutiveFailures: 0,
    }

    // Remove any old sessions for the same project to avoid stale data
    for (const [existingId, existingSession] of this.sessions.entries()) {
      if (existingSession.projectId === projectId && existingId !== sessionId) {
        console.log(`[BvsOrchestrator] Removing old session ${existingId} for project ${projectId} (status: ${existingSession.status})`)
        this.sessions.delete(existingId)
      }
    }

    this.sessions.set(sessionId, session)
    return sessionId
  }

  /**
   * Get session by ID
   */
  getSession(sessionId: string): BvsSession | undefined {
    return this.sessions.get(sessionId)
  }

  /**
   * List all sessions
   */
  listSessions(): BvsSession[] {
    return Array.from(this.sessions.values())
  }

  /**
   * Restore a session from project/progress files if the project was in_progress
   * This is used when the app restarts and in-memory sessions are lost
   */
  async restoreSessionFromProgress(
    projectPath: string,
    projectId: string
  ): Promise<BvsSession | null> {
    // First check if session already exists in memory
    const existingSession = Array.from(this.sessions.values()).find(
      s => s.projectId === projectId
    )
    if (existingSession) {
      console.log('[BvsOrchestrator] Session already in memory:', existingSession.id)
      return existingSession
    }

    // Load project.json to check if it was in progress
    const projectJsonPath = path.join(
      projectPath,
      BVS_DIR,
      BVS_GLOBAL_FILES.PROJECTS_DIR,
      projectId,
      BVS_PROJECT_FILES.PROJECT_JSON
    )

    try {
      const projectContent = await fs.readFile(projectJsonPath, 'utf-8')
      const projectData = JSON.parse(projectContent) as BvsProject

      // Load the plan to get full section data
      const plan = await this.loadPlan(projectPath, projectId)
      if (!plan) {
        console.log('[BvsOrchestrator] Cannot restore session - plan not found:', projectId)
        return null
      }

      // Try to load progress file for section status
      const progressPath = path.join(
        projectPath,
        BVS_DIR,
        BVS_GLOBAL_FILES.PROJECTS_DIR,
        projectId,
        BVS_PROJECT_FILES.PROGRESS_JSON
      )

      let progress: any = {}
      let sectionsCompleted = 0
      let sectionsFailed = 0
      let sectionsSkipped = 0
      try {
        const progressContent = await fs.readFile(progressPath, 'utf-8')
        progress = JSON.parse(progressContent)
        console.log('[BvsOrchestrator] Loaded progress from:', progressPath)

        // Merge progress status into plan sections if available
        if (progress.sections) {
          for (const progressSection of progress.sections) {
            const planSection = plan.sections.find(s => s.id === progressSection.id)
            if (planSection) {
              planSection.status = progressSection.status
              planSection.progress = progressSection.progress
              planSection.workerId = progressSection.workerId
              planSection.startedAt = progressSection.startedAt
              planSection.completedAt = progressSection.completedAt
              planSection.errorMessage = progressSection.errorMessage
              ;(planSection as any).workerOutput = progressSection.workerOutput

              // Count section statuses
              if (progressSection.status === 'done') sectionsCompleted++
              else if (progressSection.status === 'failed') sectionsFailed++
              else if (progressSection.status === 'skipped') sectionsSkipped++

              console.log(`[BvsOrchestrator] Restored section ${planSection.id}: ${planSection.status}`)
            }
          }
        }

        // Use progress file values if available
        if (progress.sectionsCompleted !== undefined) sectionsCompleted = progress.sectionsCompleted
        if (progress.sectionsFailed !== undefined) sectionsFailed = progress.sectionsFailed
        if (progress.sectionsSkipped !== undefined) sectionsSkipped = progress.sectionsSkipped
      } catch {
        // Progress file doesn't exist or is invalid, continue with plan data
        console.log('[BvsOrchestrator] No valid progress file, using plan data')
      }

      // Determine if there's actual progress to restore
      const hasProgress = sectionsCompleted > 0 || sectionsFailed > 0 || sectionsSkipped > 0 ||
        plan.sections.some(s => s.status !== 'pending')
      const isActiveProject = projectData.status === 'in_progress' || projectData.status === 'paused'

      // Only restore if there's progress OR project was explicitly in_progress/paused
      if (!hasProgress && !isActiveProject) {
        console.log('[BvsOrchestrator] No progress and project not in progress, not restoring:', projectId, 'status:', projectData.status)
        return null
      }

      console.log(`[BvsOrchestrator] Restoring session - hasProgress: ${hasProgress}, isActiveProject: ${isActiveProject}`)

      // Generate a new session ID for the restored session
      const sessionId = progress.sessionId || `bvs-restored-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`

      // Calculate overall progress from section counts
      const overallProgress = plan.sections.length > 0
        ? Math.round((sectionsCompleted / plan.sections.length) * 100)
        : 0

      // Create restored session - always restore as 'paused' so user can choose to resume
      const session: BvsSession = {
        id: sessionId,
        projectPath,
        projectId,
        config: this.config,
        status: 'paused', // Always restore as paused
        phase: 'executing',
        plan,
        sectionsTotal: plan.sections.length,
        sectionsCompleted,
        sectionsFailed,
        sectionsSkipped,
        overallProgress,
        startedAt: projectData.executionStartedAt || Date.now(),
        totalElapsedSeconds: progress.totalElapsedSeconds || 0,
        workers: [], // Array of BvsWorkerInfo
        currentSections: [], // Track current running sections
        eventHistory: [],
      }

      // Add to sessions map
      this.sessions.set(session.id, session)
      console.log('[BvsOrchestrator] Restored session from project:', session.id, 'status:', session.status)

      return session
    } catch (error) {
      // Project file doesn't exist or is invalid
      console.log('[BvsOrchestrator] Error restoring session for:', projectId, error)
      return null
    }
  }

  /**
   * Delete a session
   */
  async deleteSession(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId)
    if (!session) return false

    // Stop any running workers
    await this.stopAllWorkers(sessionId)

    this.sessions.delete(sessionId)
    return true
  }

  /**
   * Update session state
   */
  private updateSession(sessionId: string, updates: Partial<BvsSession>): BvsSession | undefined {
    const session = this.sessions.get(sessionId)
    if (!session) return undefined

    Object.assign(session, updates)
    return session
  }

  // ============================================================================
  // Plan Management
  // ============================================================================

  /**
   * Set execution plan for session
   */
  async setPlan(sessionId: string, plan: BvsExecutionPlan): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)

    session.plan = plan
    session.sectionsTotal = plan.sections.length
    session.phase = 'review'
    session.status = 'awaiting_approval'

    // Save plan to disk
    const planPath = path.join(this.getBvsDir(session.projectPath), PLAN_FILE)
    await fs.writeFile(planPath, JSON.stringify(plan, null, 2))
  }

  /**
   * Load existing plan from disk
   * @param projectPath - The codebase path
   * @param projectId - Optional project ID. If provided, loads from project directory.
   *                    If not provided, tries project directories first, then legacy location.
   */
  async loadPlan(projectPath: string, projectId?: string): Promise<BvsExecutionPlan | null> {
    let plan: BvsExecutionPlan | null = null
    let usedProjectId: string | null = projectId || null

    // If projectId provided, load from that specific project directory
    if (projectId) {
      const planPath = path.join(
        projectPath,
        BVS_DIR,
        BVS_GLOBAL_FILES.PROJECTS_DIR,
        projectId,
        BVS_PROJECT_FILES.PLAN_JSON
      )
      try {
        const content = await fs.readFile(planPath, 'utf-8')
        console.log('[BvsOrchestrator] Loaded plan from project:', projectId)
        plan = JSON.parse(content) as BvsExecutionPlan
      } catch {
        console.warn('[BvsOrchestrator] Plan not found for project:', projectId)
        return null
      }
    } else {
      // No projectId - try to find a 'ready' or 'in_progress' project first
      const projectsDir = path.join(projectPath, BVS_DIR, BVS_GLOBAL_FILES.PROJECTS_DIR)
      try {
        const projects = await fs.readdir(projectsDir)
        for (const pid of projects) {
          const projectJsonPath = path.join(projectsDir, pid, BVS_PROJECT_FILES.PROJECT_JSON)
          try {
            const projectJson = JSON.parse(await fs.readFile(projectJsonPath, 'utf-8')) as BvsProject
            if (projectJson.status === 'ready' || projectJson.status === 'in_progress' || projectJson.status === 'paused') {
              const planPath = path.join(projectsDir, pid, BVS_PROJECT_FILES.PLAN_JSON)
              const content = await fs.readFile(planPath, 'utf-8')
              console.log('[BvsOrchestrator] Found project:', pid, 'status:', projectJson.status)
              plan = JSON.parse(content) as BvsExecutionPlan
              usedProjectId = pid
              break
            }
          } catch {
            continue
          }
        }
      } catch {
        // Projects directory doesn't exist
      }

      // Fallback: legacy location
      if (!plan) {
        const legacyPlanPath = path.join(this.getBvsDir(projectPath), 'plan.json')
        try {
          const content = await fs.readFile(legacyPlanPath, 'utf-8')
          console.log('[BvsOrchestrator] Loaded plan from legacy location')
          plan = JSON.parse(content) as BvsExecutionPlan
        } catch {
          return null
        }
      }
    }

    // IMPORTANT: Merge progress data into plan sections
    // This ensures the UI shows the current status even after app restart
    if (plan && usedProjectId) {
      const progressPath = path.join(
        projectPath,
        BVS_DIR,
        BVS_GLOBAL_FILES.PROJECTS_DIR,
        usedProjectId,
        BVS_PROJECT_FILES.PROGRESS_JSON
      )
      try {
        const progressContent = await fs.readFile(progressPath, 'utf-8')
        const progress = JSON.parse(progressContent)
        console.log('[BvsOrchestrator] Merging progress data from:', progressPath)

        if (progress.sections && Array.isArray(progress.sections)) {
          for (const progressSection of progress.sections) {
            const planSection = plan.sections.find(s => s.id === progressSection.id)
            if (planSection) {
              // Merge all progress data into plan section
              planSection.status = progressSection.status || planSection.status
              planSection.progress = progressSection.progress ?? planSection.progress
              planSection.workerId = progressSection.workerId || planSection.workerId
              planSection.startedAt = progressSection.startedAt
              planSection.completedAt = progressSection.completedAt
              planSection.errorMessage = progressSection.errorMessage
              ;(planSection as any).workerOutput = progressSection.workerOutput
              ;(planSection as any).costUsd = progressSection.costUsd
              ;(planSection as any).tokensInput = progressSection.tokensInput
              ;(planSection as any).tokensOutput = progressSection.tokensOutput
              ;(planSection as any).turnsUsed = progressSection.turnsUsed

              console.log(`[BvsOrchestrator] Merged progress for ${planSection.id}: status=${planSection.status}, progress=${planSection.progress}%`)
            }
          }
        }
      } catch {
        console.log('[BvsOrchestrator] No progress file found, using plan defaults')
      }
    }

    return plan
  }

  /**
   * Get the project directory for a given project ID
   */
  getProjectDir(projectPath: string, projectId: string): string {
    return path.join(projectPath, BVS_DIR, BVS_GLOBAL_FILES.PROJECTS_DIR, projectId)
  }

  /**
   * Save progress to the project directory
   */
  async saveProgress(projectPath: string, projectId: string | undefined, progress: unknown): Promise<void> {
    const saveDir = projectId
      ? this.getProjectDir(projectPath, projectId)
      : this.getBvsDir(projectPath)

    const progressPath = path.join(saveDir, BVS_PROJECT_FILES.PROGRESS_JSON)
    await fs.mkdir(saveDir, { recursive: true })
    await fs.writeFile(progressPath, JSON.stringify(progress, null, 2), 'utf-8')
  }

  /**
   * Approve plan and prepare for execution
   */
  async approvePlan(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session || !session.plan) {
      throw new Error(`Session or plan not found: ${sessionId}`)
    }

    session.plan.approvedAt = Date.now()
    session.phase = 'executing'
    session.status = 'idle' // Ready to start

    // Save updated plan
    const planPath = path.join(this.getBvsDir(session.projectPath), PLAN_FILE)
    await fs.writeFile(planPath, JSON.stringify(session.plan, null, 2))
  }

  // ============================================================================
  // Execution Control
  // ============================================================================

  /**
   * Start execution of approved plan
   */
  async startExecution(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session || !session.plan) {
      throw new Error(`Session or plan not found: ${sessionId}`)
    }

    if (session.status === 'running') {
      throw new Error('Execution already in progress')
    }

    session.status = 'running'
    session.startedAt = Date.now()

    // Build dependency graph if not already done
    if (!session.plan.dependencyGraph || session.plan.dependencyGraph.nodes.length === 0) {
      session.plan.dependencyGraph = this.buildDependencyGraph(session.plan.sections)
      session.plan.parallelGroups = this.buildParallelGroups(session.plan.dependencyGraph)
    }

    // Start execution loop
    this.executeNextSections(sessionId)
  }

  /**
   * Pause execution
   */
  async pauseExecution(sessionId: string, reason?: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)

    session.status = 'paused'
    session.pausedAt = Date.now()

    // RALPH-012: Emit pause event with reason
    this.emitBvsEvent({
      type: 'session_paused',
      sessionId,
      reason: reason || 'User requested pause',
      timestamp: Date.now(),
    } as any)

    console.log(`[BvsOrchestrator] Session paused: ${reason || 'User requested'}`)

    // Pause all running workers
    // (Workers will check pause flag and stop at next checkpoint)
  }

  /**
   * Resume execution
   */
  async resumeExecution(sessionId: string): Promise<void> {
    console.log('[BvsOrchestrator] resumeExecution called for session:', sessionId)
    const session = this.sessions.get(sessionId)
    if (!session) {
      console.log('[BvsOrchestrator] Session not found:', sessionId)
      throw new Error(`Session not found: ${sessionId}`)
    }

    console.log('[BvsOrchestrator] Session status:', session.status)
    if (session.status !== 'paused') {
      throw new Error('Session is not paused')
    }

    // Initialize currentSections if not set (for restored sessions)
    if (!session.currentSections) {
      session.currentSections = []
    }

    // Ensure plan has parallelGroups (for restored sessions)
    if (session.plan && !session.plan.parallelGroups) {
      console.log('[BvsOrchestrator] Building parallelGroups for restored session')
      session.plan.dependencyGraph = this.buildDependencyGraph(session.plan.sections)
      session.plan.parallelGroups = this.buildParallelGroups(session.plan.dependencyGraph)
    }

    session.status = 'running'
    session.pausedAt = undefined

    console.log('[BvsOrchestrator] Session status set to running, calling executeNextSections')

    // Resume execution from current state
    this.executeNextSections(sessionId)
  }

  /**
   * Stop execution
   */
  async stopExecution(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)

    await this.stopAllWorkers(sessionId)

    session.status = 'idle'
    session.currentSections = []
  }

  /**
   * Execute only selected sections (phase selection support)
   *
   * IMPORTANT: We need to keep completed sections in the plan so that
   * dependency checking works correctly. For example, if S4 depends on S3
   * and S3 is completed, we need S3 in the sections list so that when
   * checking if S4 can run, we can verify S3.status === 'done'.
   */
  async executeSelectedSections(
    projectPath: string,
    sessionId: string,
    selectedSectionIds: string[],
    config: any
  ): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session || !session.plan) {
      throw new Error(`Session or plan not found: ${sessionId}`)
    }

    const allSections = session.plan.sections

    // Find sections that are already completed (dependencies that are satisfied)
    const completedSectionIds = new Set(
      allSections
        .filter(s => s.status === 'done')
        .map(s => s.id)
    )

    // The sections to actually execute are only the selected ones (not already done)
    const sectionsToExecute = allSections.filter(s =>
      selectedSectionIds.includes(s.id) && s.status !== 'done'
    )

    console.log(`[BvsOrchestrator] executeSelectedSections - selected: ${selectedSectionIds.length}, completed: ${completedSectionIds.size}, toExecute: ${sectionsToExecute.length}`)

    if (sectionsToExecute.length === 0) {
      throw new Error('No sections to execute (all selected sections are already completed)')
    }

    // IMPORTANT: Keep the FULL plan with ALL sections intact
    // This preserves the original plan structure so:
    // 1. Dependency checking works correctly (can find completed dependency sections)
    // 2. Resume button can show remaining pending sections
    // 3. Progress tracking shows correct total

    // Store which sections are selected for this execution run
    // This allows executeNextSections to know which pending sections to actually run
    session.selectedSectionIds = new Set(selectedSectionIds)

    // Update session counts - use FULL plan totals, not filtered
    session.sectionsTotal = allSections.length
    session.sectionsCompleted = completedSectionIds.size
    session.sectionsFailed = allSections.filter(s => s.status === 'failed').length

    // Apply execution config
    if (config) {
      session.plan.executionConfig = config
    }

    // Start execution - will only run sections in selectedSectionIds
    await this.startExecution(sessionId)
  }

  // ============================================================================
  // Dependency Graph
  // ============================================================================

  /**
   * Build dependency graph from sections
   */
  private buildDependencyGraph(sections: BvsSection[]): BvsDependencyGraph {
    const nodes: BvsDependencyGraph['nodes'] = []
    const sectionMap = new Map(sections.map(s => [s.id, s]))

    // Build nodes with levels
    const levels = new Map<string, number>()

    const calculateLevel = (sectionId: string, visited: Set<string> = new Set()): number => {
      if (visited.has(sectionId)) {
        throw new Error(`Circular dependency detected at section: ${sectionId}`)
      }

      if (levels.has(sectionId)) {
        return levels.get(sectionId)!
      }

      visited.add(sectionId)
      const section = sectionMap.get(sectionId)

      if (!section || section.dependencies.length === 0) {
        levels.set(sectionId, 0)
        return 0
      }

      const maxDepLevel = Math.max(
        ...section.dependencies.map(depId => calculateLevel(depId, new Set(visited)))
      )

      const level = maxDepLevel + 1
      levels.set(sectionId, level)
      return level
    }

    // Calculate all levels
    for (const section of sections) {
      calculateLevel(section.id)
    }

    // Build nodes
    for (const section of sections) {
      nodes.push({
        sectionId: section.id,
        level: levels.get(section.id) || 0,
        dependencies: section.dependencies,
        dependents: section.dependents,
      })
    }

    // Group by levels
    const maxLevel = Math.max(...nodes.map(n => n.level))
    const levelGroups: string[][] = []
    for (let i = 0; i <= maxLevel; i++) {
      levelGroups.push(nodes.filter(n => n.level === i).map(n => n.sectionId))
    }

    // Find critical path (longest chain)
    const criticalPath = this.findCriticalPath(sections, levels)

    return {
      nodes,
      levels: levelGroups,
      criticalPath,
    }
  }

  /**
   * Find the critical path through dependencies
   */
  private findCriticalPath(sections: BvsSection[], levels: Map<string, number>): string[] {
    // Find sections with highest level (end of chains)
    const maxLevel = Math.max(...levels.values())
    const endSections = sections.filter(s => levels.get(s.id) === maxLevel)

    // Trace back from end to find longest path
    let longestPath: string[] = []

    const tracePath = (sectionId: string, currentPath: string[]): void => {
      const section = sections.find(s => s.id === sectionId)
      if (!section) return

      const newPath = [sectionId, ...currentPath]

      if (section.dependencies.length === 0) {
        if (newPath.length > longestPath.length) {
          longestPath = newPath
        }
        return
      }

      for (const depId of section.dependencies) {
        tracePath(depId, newPath)
      }
    }

    for (const endSection of endSections) {
      tracePath(endSection.id, [])
    }

    return longestPath
  }

  /**
   * Build parallel groups from dependency graph
   */
  private buildParallelGroups(graph: BvsDependencyGraph): BvsParallelGroup[] {
    return graph.levels.map((sectionIds, index) => ({
      groupId: `group-${index + 1}`,
      level: index,
      sections: sectionIds,
      status: 'pending',
    }))
  }

  // ============================================================================
  // Section Execution
  // ============================================================================

  /**
   * Execute next available sections based on dependencies
   */
  private async executeNextSections(sessionId: string): Promise<void> {
    console.log('[BvsOrchestrator] executeNextSections called for:', sessionId)
    const session = this.sessions.get(sessionId)
    if (!session || !session.plan || session.status !== 'running') {
      console.log('[BvsOrchestrator] executeNextSections early return - session:', !!session, 'plan:', !!session?.plan, 'status:', session?.status)
      return
    }

    const { sections, parallelGroups } = session.plan
    const maxWorkers = this.config.parallel.maxWorkers

    console.log('[BvsOrchestrator] executeNextSections - sections:', sections.length, 'maxWorkers:', maxWorkers, 'currentSections:', session.currentSections?.length || 0)

    // Log all section statuses for debugging
    console.log('[BvsOrchestrator] Section statuses:')
    sections.forEach(s => {
      console.log(`  ${s.id}: status=${s.status}, deps=${JSON.stringify(s.dependencies)}`)
    })

    // Find sections that can run (dependencies met, not completed)
    // If selectedSectionIds is set, only run sections in that set
    const runnableSections = sections.filter(section => {
      if (section.status === 'done' || section.status === 'in_progress' || section.status === 'verifying') {
        console.log(`[BvsOrchestrator] Section ${section.id} not runnable: status=${section.status}`)
        return false
      }

      // If we have a selection filter, only run sections in the selection
      if (session.selectedSectionIds && session.selectedSectionIds.size > 0) {
        if (!session.selectedSectionIds.has(section.id)) {
          console.log(`[BvsOrchestrator] Section ${section.id} not runnable: not in selected sections`)
          return false
        }
      }

      // Check all dependencies are complete
      const depsCheck = section.dependencies.map(depId => {
        const dep = sections.find(s => s.id === depId)
        const satisfied = dep && dep.status === 'done'
        return { depId, found: !!dep, status: dep?.status, satisfied }
      })

      const allDepsSatisfied = depsCheck.every(d => d.satisfied)
      if (!allDepsSatisfied) {
        console.log(`[BvsOrchestrator] Section ${section.id} not runnable: deps not satisfied:`, depsCheck)
      }
      return allDepsSatisfied
    })

    console.log('[BvsOrchestrator] Runnable sections:', runnableSections.map(s => s.id))

    // Limit to max workers
    const sectionsToStart = runnableSections.slice(0, maxWorkers - (session.currentSections?.length || 0))

    console.log('[BvsOrchestrator] Starting sections:', sectionsToStart.map(s => s.id))

    // Start each section
    for (const section of sectionsToStart) {
      await this.startSection(sessionId, section.id)
    }

    // Check if all selected sections are complete
    // If selectedSectionIds is set, only check those; otherwise check all sections
    const sectionsToCheck = session.selectedSectionIds && session.selectedSectionIds.size > 0
      ? sections.filter(s => session.selectedSectionIds!.has(s.id))
      : sections

    if (sectionsToCheck.every(s => s.status === 'done')) {
      // If we only ran selected sections, pause instead of complete
      // so user can continue with remaining sections
      if (session.selectedSectionIds && session.selectedSectionIds.size > 0) {
        const pendingSections = sections.filter(s => s.status === 'pending' && !session.selectedSectionIds!.has(s.id))
        if (pendingSections.length > 0) {
          console.log(`[BvsOrchestrator] Selected sections complete. ${pendingSections.length} sections still pending.`)
          session.status = 'paused'
          session.selectedSectionIds = undefined  // Clear selection for next run
          await this.saveProgress(sessionId)
          this.emitSessionUpdate(sessionId)
          return
        }
      }
      await this.completeExecution(sessionId)
    }
  }

  /**
   * Start execution of a single section
   */
  private async startSection(sessionId: string, sectionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session || !session.plan) return

    const section = session.plan.sections.find(s => s.id === sectionId)
    if (!section) return

    // Assign worker
    const workerId = this.assignWorker(session)
    section.workerId = workerId
    section.status = 'in_progress'
    section.startedAt = Date.now()
    section.progress = 0

    session.currentSections.push(sectionId)

    // Update worker info
    const workerInfo: BvsWorkerInfo = {
      workerId,
      sectionId,
      worktreePath: null,
      state: 'running',
      progress: 0,
      currentStep: 'Starting section...',
      commits: [],
      startedAt: Date.now(),
    }
    session.workers.push(workerInfo)

    // Emit section update event
    this.emitBvsEvent({
      type: 'section_update',
      sectionId,
      status: 'in_progress',
      progress: 0,
      currentStep: 'Starting section...',
      workerId,
    })

    console.log(`[BVS] Starting section ${sectionId} with worker ${workerId}`)

    // Execute section with worker agent
    this.executeSectionWithWorker(sessionId, sectionId, workerId, workerInfo)
      .catch(error => {
        console.error(`[BVS] Error executing section ${sectionId}:`, error)
        this.completeSection(sessionId, sectionId, false, error.message)
      })
  }

  /**
   * Execute a section using worker agent
   */
  private async executeSectionWithWorker(
    sessionId: string,
    sectionId: string,
    workerId: BvsWorkerId,
    workerInfo: BvsWorkerInfo
  ): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session || !session.plan) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    const section = session.plan.sections.find(s => s.id === sectionId)
    if (!section) {
      throw new Error(`Section not found: ${sectionId}`)
    }

    // Create worker CLI service with streaming JSON format
    const workerService = new BvsWorkerSdkService(this.configStore)

    // Accumulate worker output for persistence
    let accumulatedOutput = ''

    // Forward worker progress events to UI
    workerService.on('progress', (data: any) => {
      section.progress = data.progress
      workerInfo.progress = data.progress
      workerInfo.currentStep = data.currentStep

      this.emitBvsEvent({
        type: 'section_update',
        sectionId: section.id,
        status: section.status,
        progress: data.progress,
        currentStep: data.currentStep,
        currentFile: data.currentFile,
        workerId,
      })
    })

    // Forward worker output for real-time streaming and accumulate for persistence
    workerService.on('output', (data: any) => {
      // Accumulate output for later storage on section
      accumulatedOutput += data.output

      this.emitBvsEvent({
        type: 'worker_output',
        sectionId: data.sectionId,
        workerId: data.workerId,
        output: data.output,
        timestamp: data.timestamp
      })
    })

    // Build project context
    const projectContext: ProjectContext = {
      projectPath: session.projectPath,
      projectName: session.projectName,
      framework: session.plan?.codebaseContext?.framework || 'Unknown',
      database: 'None',
      patterns: session.plan?.codebaseContext?.patterns || [],
      existingFiles: [],
      completedSections: [],
    }

    // Get complexity analysis (default to medium-high for real work)
    const complexity: ComplexityAnalysis = {
      sectionId: section.id,
      sectionName: section.name,
      score: 5,
      model: BVS_MODELS.SONNET,  // Full model name required by SDK
      maxTurns: 20,  // Increased from 5 to allow completing real tasks
      factors: {
        fileCount: section.files.length,
        createCount: section.files.filter(f => f.action === 'create').length,
        modifyCount: section.files.filter(f => f.action === 'modify').length,
        deleteCount: section.files.filter(f => f.action === 'delete').length,
        estimatedLOC: 0,
        hasTests: false,
        hasApiChanges: false,
        hasDatabaseChanges: false,
        hasSchemaChanges: false,
        dependencyCount: section.dependencies?.length || 0,
        dependentCount: section.dependents?.length || 0,
        isNewFeature: true,
        touchesSharedCode: false,
        successCriteriaCount: section.successCriteria?.length || 0,
      },
      reasoning: ['Standard complexity'],
      riskFlags: [],
    }

    const workerConfig: WorkerConfig = {
      workerId: workerId as string,
      sectionId: section.id,
      section,
      worktreePath: null, // Sequential execution doesn't use worktrees
      model: complexity.model,
      maxTurns: complexity.maxTurns,
      projectContext,
      complexity,
    }

    try {
      // Execute the section
      console.log(`[BVS] Worker ${workerId} executing section ${sectionId}`)

      const result = await workerService.executeSection(workerConfig)

      // Extract metrics from result
      const metrics = {
        costUsd: result.costUsd ?? 0,
        tokensInput: result.tokensInput ?? 0,
        tokensOutput: result.tokensOutput ?? 0,
        turnsUsed: result.turnsUsed ?? 0,
      }

      // Quality gate validation - check if work was actually completed
      if (result.status === 'failed' || !result.qualityGatesPassed) {
        console.error(`[BVS] Worker ${workerId} section ${sectionId} failed quality gates:`, result.errors)

        // UltraQA: Try Fix Loop before giving up
        const fixResult = await this.runFixLoopForSection(session, section, result.errors)

        if (fixResult && fixResult.success) {
          console.log(`[BVS] Fix Loop succeeded for section ${sectionId} after ${fixResult.totalCycles} cycles`)
          // Re-run verification after fix
        } else {
          await this.completeSection(sessionId, sectionId, false, result.errors.join('; '), accumulatedOutput, metrics)

          // Pause for user intervention in SEMI_ATTENDED or higher
          await this.shouldPauseForApproval(sessionId, 'issue', {
            sectionId,
            issue: `Section ${sectionId} failed quality gates: ${result.errors.join(', ')}`
          })

          return
        }
      }

      // UltraQA: Run Goal Reviewer BEFORE marking as complete
      // This verifies the implementation matches the original user intent
      const goalReviewResult = await this.runGoalReviewForSection(session, section, result.filesChanged || [])

      if (goalReviewResult && goalReviewResult.verdict === 'REJECTED') {
        console.warn(`[BVS] Goal review REJECTED for section ${sectionId}: ${goalReviewResult.reasoning}`)

        // Emit goal review event for UI
        this.emitBvsEvent({
          type: 'goal_review_result',
          sectionId,
          verdict: goalReviewResult.verdict,
          coveragePercent: goalReviewResult.coveragePercent,
          reasoning: goalReviewResult.reasoning,
          issuestoFix: goalReviewResult.issuestoFix,
        })

        await this.completeSection(sessionId, sectionId, false,
          `Goal alignment failed: ${goalReviewResult.issuestoFix.join(', ')}`,
          accumulatedOutput, metrics)

        await this.shouldPauseForApproval(sessionId, 'issue', {
          sectionId,
          issue: `Goal alignment check failed: ${goalReviewResult.reasoning}`
        })

        return
      }

      // Emit successful goal review
      if (goalReviewResult) {
        this.emitBvsEvent({
          type: 'goal_review_result',
          sectionId,
          verdict: goalReviewResult.verdict,
          coveragePercent: goalReviewResult.coveragePercent,
          reasoning: goalReviewResult.reasoning,
          issuestoFix: goalReviewResult.issuestoFix,
        })
      }

      // Mark as complete
      console.log(`[BVS] Worker ${workerId} completed section ${sectionId} ✓`)
      await this.completeSection(sessionId, sectionId, true, undefined, accumulatedOutput, metrics)

      // Checkpoint: Pause for approval after section completion
      await this.shouldPauseForApproval(sessionId, 'subtask', {
        sectionId,
        subtaskId: sectionId
      })
    } catch (error) {
      console.error(`[BVS] Worker ${workerId} failed section ${sectionId}:`, error)
      await this.completeSection(sessionId, sectionId, false, error instanceof Error ? error.message : 'Unknown error', accumulatedOutput, undefined)

      // Pause for user intervention on errors
      await this.shouldPauseForApproval(sessionId, 'issue', {
        sectionId,
        issue: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  }

  /**
   * Assign next available worker ID
   */
  private assignWorker(session: BvsSession): BvsWorkerId {
    const usedWorkers = new Set(session.workers.filter(w => w.state === 'running').map(w => w.workerId))
    const workerIds: BvsWorkerId[] = ['W1', 'W2', 'W3', 'W4', 'W5']

    for (const id of workerIds) {
      if (!usedWorkers.has(id)) {
        return id
      }
    }

    return 'SEQ'
  }

  /**
   * Mark section as complete
   */
  async completeSection(
    sessionId: string,
    sectionId: string,
    success: boolean,
    error?: string,
    workerOutput?: string,
    metrics?: { costUsd: number; tokensInput: number; tokensOutput: number; turnsUsed: number }
  ): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session || !session.plan) return

    const section = session.plan.sections.find(s => s.id === sectionId)
    if (!section) return

    section.status = success ? 'done' : 'failed'
    section.completedAt = Date.now()
    section.progress = success ? 100 : section.progress
    section.lastError = error
    section.errorMessage = error  // For frontend display
    if (workerOutput) {
      (section as any).workerOutput = workerOutput  // Store worker output for UI display
    }

    // Store metrics for UI display
    if (metrics) {
      (section as any).costUsd = metrics.costUsd
      ;(section as any).tokensInput = metrics.tokensInput
      ;(section as any).tokensOutput = metrics.tokensOutput
      ;(section as any).turnsUsed = metrics.turnsUsed
    }

    // Update worker info
    const worker = session.workers.find(w => w.sectionId === sectionId)
    if (worker) {
      worker.state = success ? 'completed' : 'failed'
      worker.completedAt = Date.now()
      worker.error = error
    }

    // Remove from current sections
    session.currentSections = session.currentSections.filter(id => id !== sectionId)

    // Update counters
    if (success) {
      session.sectionsCompleted++
      session.consecutiveFailures = 0
    } else {
      session.sectionsFailed++
      session.consecutiveFailures++
    }

    // Update overall progress
    session.overallProgress = Math.round((session.sectionsCompleted / session.sectionsTotal) * 100)

    // Emit event with metrics
    this.emitBvsEvent({
      type: 'section_update',
      sectionId,
      status: section.status,
      progress: section.progress,
      workerId: section.workerId,
      errorMessage: section.errorMessage,
      costUsd: (section as any).costUsd,
      tokensInput: (section as any).tokensInput,
      tokensOutput: (section as any).tokensOutput,
      turnsUsed: (section as any).turnsUsed,
    })

    // Save progress
    await this.saveSessionProgress(session)

    // Continue execution
    if (session.status === 'running') {
      this.executeNextSections(sessionId)
    }
  }

  /**
   * Retry a failed section
   */
  async retrySection(sessionId: string, sectionId: string): Promise<void> {
    console.log(`[BVS] retrySection called: sessionId=${sessionId}, sectionId=${sectionId}`)

    const session = this.sessions.get(sessionId)
    if (!session) {
      console.error(`[BVS] retrySection: Session not found: ${sessionId}`)
      console.log(`[BVS] Available sessions:`, Array.from(this.sessions.keys()))
      throw new Error(`Session not found: ${sessionId}`)
    }

    if (!session.plan) {
      console.error(`[BVS] retrySection: Session has no plan: ${sessionId}`)
      throw new Error(`Session has no plan: ${sessionId}`)
    }

    const section = session.plan.sections.find(s => s.id === sectionId)
    if (!section) {
      console.error(`[BVS] retrySection: Section not found: ${sectionId}`)
      console.log(`[BVS] Available sections:`, session.plan.sections.map(s => s.id))
      throw new Error(`Section not found: ${sectionId}`)
    }

    // Allow retry for failed, retrying, or even done sections (to force re-run)
    const retryableStatuses = ['failed', 'retrying', 'done', 'pending']
    if (!retryableStatuses.includes(section.status)) {
      console.error(`[BVS] retrySection: Section ${sectionId} has status '${section.status}' - cannot retry while in_progress or verifying`)
      throw new Error(`Cannot retry section in status '${section.status}'. Wait for it to complete or fail first.`)
    }

    // Check if already running
    if (section.status === 'in_progress' || section.status === 'verifying') {
      console.warn(`[BVS] retrySection: Section ${sectionId} is already running (${section.status})`)
      throw new Error(`Section is already running (${section.status})`)
    }

    if (section.retryCount >= (section.maxRetries || 3)) {
      console.warn(`[BVS] retrySection: Max retries exceeded for ${sectionId}`)
      throw new Error(`Max retries (${section.maxRetries || 3}) exceeded for section ${sectionId}`)
    }

    console.log(`[BVS] retrySection: Starting retry for ${sectionId}, attempt ${section.retryCount + 1}`)

    section.retryCount = (section.retryCount || 0) + 1
    section.status = 'retrying'
    section.lastError = undefined
    section.errorMessage = undefined
    section.progress = 0

    // Emit event so UI updates
    this.emitBvsEvent({
      type: 'section_update',
      sectionId,
      status: 'retrying',
      progress: 0,
      currentStep: `Retrying (attempt ${section.retryCount})...`,
      workerId: section.workerId,
    })

    // Start the section again
    await this.startSection(sessionId, sectionId)
    console.log(`[BVS] retrySection: Section ${sectionId} started`)
  }

  /**
   * Skip a failed section and continue with dependent sections
   */
  async skipSection(sessionId: string, sectionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session || !session.plan) return

    const section = session.plan.sections.find(s => s.id === sectionId)
    if (!section || section.status !== 'failed') return

    // Mark as skipped (keep error history for reference)
    section.status = 'done' // Mark as done so dependents can proceed
    section.progress = 0 // But with 0% progress to indicate it was skipped
    section.completedAt = Date.now()
    session.sectionsSkipped = (session.sectionsSkipped || 0) + 1

    // Emit event (keep errorMessage for history)
    this.emitBvsEvent({
      type: 'section_update',
      sectionId,
      status: section.status,
      progress: section.progress,
      workerId: section.workerId,
      errorMessage: section.errorMessage, // Keep error for reference
    })

    // Save progress
    await this.saveSessionProgress(session)

    // Resume session if it was paused, then continue execution
    if (session.status === 'paused') {
      session.status = 'running'
      session.pausedAt = undefined
    }

    // Continue execution with dependent sections
    this.executeNextSections(sessionId)
  }

  // ============================================================================
  // Worker Management
  // ============================================================================

  /**
   * Stop all workers for a session
   */
  private async stopAllWorkers(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) return

    for (const worker of session.workers) {
      if (worker.state === 'running') {
        worker.state = 'completed'
        // TODO: Actually kill the Task agent process
      }
    }
  }

  // ============================================================================
  // Progress Persistence
  // ============================================================================

  /**
   * Save session progress to disk
   * Saves to project-specific directory if projectId is set, otherwise to legacy location
   */
  private async saveSessionProgress(session: BvsSession): Promise<void> {
    // Determine save path - prefer project-specific directory
    let progressPath: string
    if (session.projectId) {
      const projectDir = this.getProjectDir(session.projectPath, session.projectId)
      await fs.mkdir(projectDir, { recursive: true })
      progressPath = path.join(projectDir, BVS_PROJECT_FILES.PROGRESS_JSON)
    } else {
      progressPath = path.join(this.getBvsDir(session.projectPath), PROGRESS_FILE)
    }

    const progress = {
      sessionId: session.id,
      projectId: session.projectId,
      status: session.status,
      phase: session.phase,
      sectionsTotal: session.sectionsTotal,
      sectionsCompleted: session.sectionsCompleted,
      sectionsFailed: session.sectionsFailed,
      sectionsSkipped: session.sectionsSkipped || 0,
      overallProgress: session.overallProgress,
      startedAt: session.startedAt,
      totalElapsedSeconds: session.totalElapsedSeconds,
      lastUpdatedAt: Date.now(),
      sections: session.plan?.sections.map(s => ({
        id: s.id,
        name: s.name,
        status: s.status,
        progress: s.progress,
        workerId: s.workerId,
        startedAt: s.startedAt,
        completedAt: s.completedAt,
        errorMessage: s.errorMessage,
        workerOutput: (s as any).workerOutput,
        // Include metrics for UI display
        costUsd: (s as any).costUsd,
        tokensInput: (s as any).tokensInput,
        tokensOutput: (s as any).tokensOutput,
        turnsUsed: (s as any).turnsUsed,
      })),
    }
    await fs.writeFile(progressPath, JSON.stringify(progress, null, 2))
    console.log(`[BvsOrchestrator] Saved progress to: ${progressPath}`)
  }

  // ============================================================================
  // Completion
  // ============================================================================

  /**
   * Complete execution and finalize
   */
  private async completeExecution(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) return

    session.status = 'completed'
    session.phase = 'completed'
    session.completedAt = Date.now()

    if (session.startedAt) {
      session.totalElapsedSeconds = Math.round((Date.now() - session.startedAt) / 1000)
    }

    await this.saveSessionProgress(session)

    this.sendToRenderer(BVS_IPC_CHANNELS.BVS_EVENT, {
      type: 'session_complete',
      sessionId,
      sectionsTotal: session.sectionsTotal,
      sectionsCompleted: session.sectionsCompleted,
      sectionsFailed: session.sectionsFailed,
      totalElapsedSeconds: session.totalElapsedSeconds,
    })
  }

  // ============================================================================
  // Parallel Execution with Merge Points
  // ============================================================================

  /**
   * Execute sections using parallel workers with merge points
   * This is the main execution method for Option B workflow
   */
  async executeWithMergePoints(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session || !session.plan) {
      throw new Error(`Session or plan not found: ${sessionId}`)
    }

    if (session.status === 'running') {
      throw new Error('Execution already in progress')
    }

    session.status = 'running'
    session.startedAt = Date.now()

    // Build dependency graph if not already done
    if (!session.plan.dependencyGraph || session.plan.dependencyGraph.nodes.length === 0) {
      session.plan.dependencyGraph = this.buildDependencyGraph(session.plan.sections)
      session.plan.parallelGroups = this.buildParallelGroups(session.plan.dependencyGraph)
    }

    const { sections, dependencyGraph, parallelGroups } = session.plan
    const maxWorkers = Math.min(this.config.parallel.maxWorkers, 5)

    // Analyze complexity for all sections
    const complexityMap = new Map<string, ComplexityAnalysis>()
    for (const section of sections) {
      const analysis = complexityAnalyzer.analyze(section)
      complexityMap.set(section.id, analysis)

      this.emitBvsEvent({
        type: 'complexity_analyzed',
        sectionId: section.id,
        analysis,
      })
    }

    // Execute level by level
    const levels = dependencyGraph.levels
    const targetBranch = 'main' // Could be configurable

    for (let levelIndex = 0; levelIndex < levels.length; levelIndex++) {
      const levelSections = levels[levelIndex]
      const isFinalLevel = levelIndex === levels.length - 1

      this.emitBvsEvent({
        type: 'level_started',
        level: levelIndex,
        sectionIds: levelSections,
        isFinalLevel,
      })

      // Execute workers for this level
      const workerResults = await this.executeWorkersForLevel(
        session,
        levelSections,
        complexityMap,
        maxWorkers
      )

      // Execute merge point
      const mergeConfig: MergePointConfig = {
        level: levelIndex,
        workerResults,
        projectPath: session.projectPath,
        targetBranch,
        isFinalLevel,
      }

      const mergeResult = await mergePointService.executeMergePoint(mergeConfig)

      // Emit merge result
      this.emitBvsEvent({
        type: 'merge_point_completed',
        level: levelIndex,
        result: mergeResult,
      })

      // Handle merge failures
      if (!mergeResult.success) {
        session.status = 'failed'
        session.completedAt = Date.now()

        this.emitBvsEvent({
          type: 'session_failed',
          sessionId,
          reason: `Merge point failed at level ${levelIndex}`,
          errors: mergeResult.errors,
        })

        await this.saveSessionProgress(session)
        return
      }

      // Update section statuses
      for (const workerId of mergeResult.mergedWorkers) {
        const workerResult = workerResults.find(r => r.workerId === workerId)
        if (workerResult) {
          const section = sections.find(s => s.id === workerResult.sectionId)
          if (section) {
            section.status = 'done'
            section.completedAt = Date.now()
            section.progress = 100
            session.sectionsCompleted++
          }
        }
      }

      // Update failed sections
      for (const workerId of mergeResult.failedWorkers) {
        const workerResult = workerResults.find(r => r.workerId === workerId)
        if (workerResult) {
          const section = sections.find(s => s.id === workerResult.sectionId)
          if (section) {
            section.status = 'failed'
            section.completedAt = Date.now()
            session.sectionsFailed++
          }
        }
      }

      // Update overall progress
      session.overallProgress = Math.round((session.sectionsCompleted / session.sectionsTotal) * 100)
      await this.saveSessionProgress(session)

      // Cleanup worktrees after successful merge
      if (mergeResult.success) {
        await mergePointService.cleanupWorktrees(
          session.projectPath,
          mergeResult.mergedWorkers
        )
      }

      // Checkpoint: Pause for approval after level completion
      await this.shouldPauseForApproval(sessionId, 'level', {
        level: levelIndex
      })
    }

    // All levels complete
    await this.completeExecution(sessionId)
  }

  /**
   * Execute workers for a single level with retry support
   */
  private async executeWorkersForLevel(
    session: BvsSession,
    sectionIds: string[],
    complexityMap: Map<string, ComplexityAnalysis>,
    maxWorkers: number
  ): Promise<WorkerResult[]> {
    const sections = session.plan!.sections.filter(s => sectionIds.includes(s.id))
    const results: WorkerResult[] = []

    // Process sections in batches of maxWorkers
    for (let i = 0; i < sections.length; i += maxWorkers) {
      const batch = sections.slice(i, i + maxWorkers)

      // Execute batch in parallel with retry
      const batchResults = await Promise.all(
        batch.map((section, batchIndex) =>
          this.executeWorkerWithRetry(
            session,
            section,
            complexityMap.get(section.id)!,
            `worker-${(i + batchIndex + 1) % 5 + 1}` as BvsWorkerId
          )
        )
      )

      results.push(...batchResults)
    }

    return results
  }

  /**
   * Execute a single worker with retry support
   */
  private async executeWorkerWithRetry(
    session: BvsSession,
    section: BvsSection,
    complexity: ComplexityAnalysis,
    workerId: BvsWorkerId
  ): Promise<WorkerResult> {
    const maxRetries = 3
    let lastResult: WorkerResult | null = null

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      // Update section status
      section.status = attempt === 0 ? 'in_progress' : 'retrying'
      section.workerId = workerId
      section.startedAt = Date.now()
      section.retryCount = attempt

      // Update worker info in session
      const workerInfo: BvsWorkerInfo = {
        workerId,
        sectionId: section.id,
        worktreePath: path.join(session.projectPath, '.bvs', 'worktrees', `worker-${workerId}`),
        state: 'running',
        progress: 0,
        currentStep: attempt === 0 ? 'Starting...' : `Retrying (attempt ${attempt + 1})...`,
        commits: [],
        startedAt: Date.now(),
      }

      // Remove old worker info and add new
      session.workers = session.workers.filter(w => w.sectionId !== section.id)
      session.workers.push(workerInfo)

      this.emitBvsEvent({
        type: 'worker_started',
        sectionId: section.id,
        workerId,
        attempt,
        maxTurns: complexity.maxTurns,
        model: complexity.model,
      })

      // Create and execute worker
      const workerService = new BvsWorkerSdkService(this.configStore)

      // Forward worker events
      workerService.on('progress', (data: any) => {
        section.progress = data.progress
        workerInfo.progress = data.progress
        workerInfo.currentStep = data.currentStep

        this.emitBvsEvent({
          type: 'section_update',
          sectionId: section.id,
          status: section.status,
          progress: data.progress,
          currentStep: data.currentStep,
          currentFile: data.currentFile,
          workerId,
        })
      })

      // Build project context with required fields
      const projectContext: ProjectContext = {
        projectPath: session.projectPath,
        projectName: session.projectName,
        framework: session.plan?.codebaseContext?.framework || 'Unknown',
        database: 'None',
        patterns: session.plan?.codebaseContext?.patterns || [],
        existingFiles: [], // Could be populated from plan
        completedSections: [], // Will be filled as sections complete
      }

      const workerConfig: WorkerConfig = {
        workerId: workerId as string,
        sectionId: section.id,
        section,
        worktreePath: workerInfo.worktreePath!,
        model: complexity.model,
        maxTurns: complexity.maxTurns,
        projectContext,
        complexity,
      }

      try {
        // RALPH-010: Check limits before execution
        try {
          this.checkSessionLimits(sessionId, section.id)
        } catch (error) {
          if (error instanceof SessionLimitError) {
            console.error(`[BvsOrchestrator] Session limit exceeded:`, error.message)

            // RALPH-015: Capture learning from limit violation
            const learningService = await getBvsLearningCaptureService()
            await learningService.captureLimitViolation(
              error,
              section,
              undefined, // No specific subtask yet (pre-execution)
              this.executionConfig
            )

            lastResult = {
              workerId: workerId as string,
              sectionId: section.id,
              status: 'failed',
              turnsUsed: 0,
              filesChanged: [],
              qualityGatesPassed: false,
              errors: [error.message],
              retryCount: attempt,
              startedAt: workerInfo.startedAt || Date.now(),
              completedAt: Date.now(),
              commits: [],
            }
            throw error // Re-throw to stop execution
          }
          throw error
        }

        lastResult = await workerService.executeSectionWithSubtasks(workerConfig) // Use new subtask method

        // RALPH-010: Track cost after execution
        const sectionCost = this.calculateSectionCost(lastResult)
        try {
          this.checkSessionLimits(sessionId, section.id, sectionCost)
        } catch (error) {
          if (error instanceof SessionLimitError) {
            // RALPH-015: Capture learning from post-execution limit violation
            const learningService = await getBvsLearningCaptureService()
            await learningService.captureLimitViolation(
              error,
              section,
              undefined, // Aggregate across all subtasks
              this.executionConfig
            )
            throw error
          }
          throw error
        }

        // Check if successful
        if (lastResult.status === 'completed' && lastResult.qualityGatesPassed) {
          // Success - no need to retry
          workerInfo.state = 'completed'
          workerInfo.completedAt = Date.now()

          this.emitBvsEvent({
            type: 'worker_completed',
            sectionId: section.id,
            workerId,
            result: {
              status: lastResult.status,
              turnsUsed: lastResult.turnsUsed,
              filesChanged: lastResult.filesChanged,
              qualityGatesPassed: lastResult.qualityGatesPassed,
              errors: lastResult.errors,
            },
          })

          return lastResult
        }

        // Failed but can retry
        workerInfo.state = 'failed'
        workerInfo.error = lastResult.errors.join(', ')

        this.emitBvsEvent({
          type: 'worker_failed',
          sectionId: section.id,
          workerId,
          attempt,
          errors: lastResult.errors,
          willRetry: attempt < maxRetries,
        })

      } catch (error) {
        console.error(`[BvsOrchestrator] Worker error:`, error)

        lastResult = {
          workerId: workerId as string,
          sectionId: section.id,
          status: 'failed',
          turnsUsed: 0,
          filesChanged: [],
          qualityGatesPassed: false,
          errors: [error instanceof Error ? error.message : String(error)],
          retryCount: attempt,
          startedAt: workerInfo.startedAt || Date.now(),
          completedAt: Date.now(),
          commits: [],
        }

        workerInfo.state = 'failed'
        workerInfo.error = lastResult.errors[0]
      }
    }

    // All retries exhausted
    return lastResult!
  }

  // ============================================================================
  // UltraQA: Goal Review and Fix Loop
  // ============================================================================

  /**
   * Run Goal Reviewer to verify implementation matches user intent
   *
   * This runs BEFORE code review to ensure we built the right thing.
   * A section that builds and passes tests but doesn't match user intent is a FAILURE.
   */
  private async runGoalReviewForSection(
    session: BvsSession,
    section: BvsSection,
    filesChanged: string[]
  ): Promise<GoalReviewResult | null> {
    if (!session.plan) return null

    try {
      console.log(`[BVS] Running Goal Review for section ${section.id}...`)

      this.emitBvsEvent({
        type: 'goal_review_started',
        sectionId: section.id,
        sectionName: section.name,
      })

      const result = await goalReviewer.reviewSection(
        section,
        session.plan,
        session.projectPath,
        filesChanged
      )

      console.log(`[BVS] Goal Review complete: ${result.verdict} (${result.coveragePercent}% coverage)`)

      return result
    } catch (error) {
      console.error(`[BVS] Goal Review failed for section ${section.id}:`, error)
      // Don't fail the section if goal review itself fails - just log and continue
      return null
    }
  }

  /**
   * Run Fix Loop to attempt automated fixes when quality gates fail
   *
   * UltraQA pattern: test → diagnose → fix → repeat (max cycles)
   * Exits early if same failure is detected 3 times (stuck in loop)
   */
  private async runFixLoopForSection(
    session: BvsSession,
    section: BvsSection,
    errors: string[]
  ): Promise<FixLoopResult | null> {
    // Only run fix loop for build/typecheck failures
    const isBuildError = errors.some(e =>
      e.toLowerCase().includes('build') ||
      e.toLowerCase().includes('typescript') ||
      e.toLowerCase().includes('type error') ||
      e.toLowerCase().includes('ts2')
    )

    if (!isBuildError) {
      console.log(`[BVS] Fix Loop skipped - not a build/typecheck error`)
      return null
    }

    try {
      console.log(`[BVS] Running Fix Loop for section ${section.id}...`)

      this.emitBvsEvent({
        type: 'fix_loop_started',
        sectionId: section.id,
        errors,
      })

      // Subscribe to fix loop events
      fixLoop.on('cycle-start', (data) => {
        this.emitBvsEvent({
          type: 'fix_loop_cycle',
          sectionId: section.id,
          cycle: data.cycle,
          maxCycles: data.maxCycles,
        })
      })

      fixLoop.on('diagnosing', (data) => {
        this.emitBvsEvent({
          type: 'fix_loop_diagnosing',
          sectionId: section.id,
          cycle: data.cycle,
        })
      })

      fixLoop.on('fixing', (data) => {
        this.emitBvsEvent({
          type: 'fix_loop_fixing',
          sectionId: section.id,
          cycle: data.cycle,
          diagnosis: data.diagnosis,
        })
      })

      const config: FixLoopConfig = {
        maxCycles: 3,  // Conservative - don't waste tokens on hopeless fixes
        sameFailureThreshold: 2,  // Exit if stuck on same error twice
        timeoutPerCycleMs: 60000,  // 1 minute per cycle
        projectPath: session.projectPath,
        goal: 'typecheck',  // Most common BVS failure mode
      }

      const result = await fixLoop.runFixLoop(config)

      console.log(`[BVS] Fix Loop complete: ${result.exitReason} after ${result.totalCycles} cycles`)

      this.emitBvsEvent({
        type: 'fix_loop_completed',
        sectionId: section.id,
        success: result.success,
        exitReason: result.exitReason,
        totalCycles: result.totalCycles,
      })

      // Clean up event listeners
      fixLoop.removeAllListeners('cycle-start')
      fixLoop.removeAllListeners('diagnosing')
      fixLoop.removeAllListeners('fixing')

      return result
    } catch (error) {
      console.error(`[BVS] Fix Loop failed for section ${section.id}:`, error)

      // Clean up event listeners
      fixLoop.removeAllListeners('cycle-start')
      fixLoop.removeAllListeners('diagnosing')
      fixLoop.removeAllListeners('fixing')

      return null
    }
  }

  // ============================================================================
  // Learning System
  // ============================================================================

  /**
   * Capture a learning from a fix
   */
  async captureLearning(projectPath: string, learning: BvsLearning): Promise<void> {
    const learningsPath = path.join(this.getBvsDir(projectPath), LEARNINGS_FILE)

    let content = ''
    try {
      content = await fs.readFile(learningsPath, 'utf-8')
    } catch {
      content = '# Learnings\n\n'
    }

    const entry = `## ${learning.id}: ${learning.problem.substring(0, 50)}...
**Date:** ${new Date().toISOString().split('T')[0]}
**Severity:** error

**Problem:**
\`\`\`
${learning.problem}
\`\`\`

**Solution:**
\`\`\`
${learning.solution}
\`\`\`

**Prevention Rule:**
${learning.preventionRule}

---

`

    content += entry
    await fs.writeFile(learningsPath, content)

    this.emitBvsEvent({
      type: 'learning_captured',
      learning,
    })
  }

  /**
   * Load learnings from disk
   */
  async loadLearnings(projectPath: string): Promise<string> {
    const learningsPath = path.join(this.getBvsDir(projectPath), LEARNINGS_FILE)
    try {
      return await fs.readFile(learningsPath, 'utf-8')
    } catch {
      return ''
    }
  }

  // ============================================================================
  // Execution Runs - Persistent storage for partial runs
  // ============================================================================

  /**
   * Get the runs directory for a project
   */
  private getRunsDir(projectPath: string, projectId: string): string {
    return path.join(
      projectPath,
      BVS_DIR,
      BVS_GLOBAL_FILES.PROJECTS_DIR,
      projectId,
      BVS_PROJECT_FILES.RUNS_DIR
    )
  }

  /**
   * List all execution runs for a project
   */
  async listExecutionRuns(projectPath: string, projectId: string): Promise<BvsExecutionRun[]> {
    const runsDir = this.getRunsDir(projectPath, projectId)

    try {
      await fs.access(runsDir)
    } catch {
      // Runs directory doesn't exist yet
      return []
    }

    const files = await fs.readdir(runsDir)
    const runs: BvsExecutionRun[] = []

    for (const file of files) {
      if (file.endsWith('.json')) {
        try {
          const content = await fs.readFile(path.join(runsDir, file), 'utf-8')
          const run = JSON.parse(content) as BvsExecutionRun
          runs.push(run)
        } catch (error) {
          console.warn(`[BvsOrchestrator] Failed to parse run file ${file}:`, error)
        }
      }
    }

    return runs
  }

  /**
   * Get a specific execution run
   */
  async getExecutionRun(
    projectPath: string,
    projectId: string,
    runId: string
  ): Promise<BvsExecutionRun | null> {
    const runPath = path.join(this.getRunsDir(projectPath, projectId), `${runId}.json`)

    try {
      const content = await fs.readFile(runPath, 'utf-8')
      return JSON.parse(content) as BvsExecutionRun
    } catch {
      return null
    }
  }

  /**
   * Create a new execution run
   */
  async createExecutionRun(
    projectPath: string,
    projectId: string,
    selectedPhases: number[],
    selectedSections: string[]
  ): Promise<BvsExecutionRun> {
    const runsDir = this.getRunsDir(projectPath, projectId)
    await fs.mkdir(runsDir, { recursive: true })

    const runId = `run-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`
    const run: BvsExecutionRun = {
      id: runId,
      projectId,
      startedAt: Date.now(),
      status: 'in_progress',
      selectedPhases,
      selectedSections,
      sectionsCompleted: [],
      sectionsFailed: [],
      sectionsInProgress: [],
      currentLevel: 0,
    }

    await this.saveExecutionRun(projectPath, projectId, run)
    return run
  }

  /**
   * Save an execution run to disk
   */
  async saveExecutionRun(
    projectPath: string,
    projectId: string,
    run: BvsExecutionRun
  ): Promise<void> {
    const runsDir = this.getRunsDir(projectPath, projectId)
    await fs.mkdir(runsDir, { recursive: true })

    const runPath = path.join(runsDir, `${run.id}.json`)
    await fs.writeFile(runPath, JSON.stringify(run, null, 2))
  }

  /**
   * Update an execution run
   */
  async updateExecutionRun(
    projectPath: string,
    projectId: string,
    runId: string,
    updates: Partial<BvsExecutionRun>
  ): Promise<BvsExecutionRun | null> {
    const run = await this.getExecutionRun(projectPath, projectId, runId)
    if (!run) return null

    const updatedRun = { ...run, ...updates }
    await this.saveExecutionRun(projectPath, projectId, updatedRun)
    return updatedRun
  }

  /**
   * Delete an execution run
   */
  async deleteExecutionRun(
    projectPath: string,
    projectId: string,
    runId: string
  ): Promise<void> {
    const runPath = path.join(this.getRunsDir(projectPath, projectId), `${runId}.json`)
    try {
      await fs.unlink(runPath)
    } catch {
      // File might not exist
    }
  }

  /**
   * Resume a previous execution run
   * Creates a new session from the saved run state
   */
  async resumeExecutionRun(
    projectPath: string,
    projectId: string,
    runId: string
  ): Promise<string> {
    const run = await this.getExecutionRun(projectPath, projectId, runId)
    if (!run) {
      throw new Error(`Execution run not found: ${runId}`)
    }

    // Load the plan
    const plan = await this.loadPlan(projectPath, projectId)
    if (!plan) {
      throw new Error('Plan not found for project')
    }

    // Filter sections to only those that haven't been completed
    const remainingSections = run.selectedSections.filter(
      sectionId => !run.sectionsCompleted.includes(sectionId)
    )

    if (remainingSections.length === 0) {
      throw new Error('All sections in this run are already completed')
    }

    // Create a new session with the remaining sections
    const sessionId = await this.startExecutionWithSelection(
      projectPath,
      projectId,
      remainingSections,
      DEFAULT_BVS_EXECUTION_CONFIG
    )

    // Update the run with the new session ID
    await this.updateExecutionRun(projectPath, projectId, runId, {
      sessionId,
      status: 'in_progress',
    })

    return sessionId
  }

  /**
   * Called when sections complete during execution - updates the current run
   */
  async updateRunProgress(
    projectPath: string,
    projectId: string,
    sectionId: string,
    status: 'completed' | 'failed'
  ): Promise<void> {
    // Find the active run for this project
    const runs = await this.listExecutionRuns(projectPath, projectId)
    const activeRun = runs.find(r => r.status === 'in_progress')

    if (!activeRun) return

    const updates: Partial<BvsExecutionRun> = {}

    if (status === 'completed') {
      if (!activeRun.sectionsCompleted.includes(sectionId)) {
        updates.sectionsCompleted = [...activeRun.sectionsCompleted, sectionId]
      }
    } else if (status === 'failed') {
      if (!activeRun.sectionsFailed.includes(sectionId)) {
        updates.sectionsFailed = [...activeRun.sectionsFailed, sectionId]
      }
    }

    // Remove from in-progress
    updates.sectionsInProgress = activeRun.sectionsInProgress.filter(id => id !== sectionId)

    // Check if all sections are done
    const totalDone = (updates.sectionsCompleted || activeRun.sectionsCompleted).length +
                      (updates.sectionsFailed || activeRun.sectionsFailed).length
    if (totalDone >= activeRun.selectedSections.length) {
      updates.status = 'completed'
      updates.completedAt = Date.now()
    }

    await this.updateExecutionRun(projectPath, projectId, activeRun.id, updates)
  }

  /**
   * Pause the current run when execution is paused
   */
  async pauseCurrentRun(projectPath: string, projectId: string): Promise<void> {
    const runs = await this.listExecutionRuns(projectPath, projectId)
    const activeRun = runs.find(r => r.status === 'in_progress')

    if (activeRun) {
      await this.updateExecutionRun(projectPath, projectId, activeRun.id, {
        status: 'paused',
        pausedAt: Date.now(),
      })
    }
  }
}

// Default conventions content
const DEFAULT_CONVENTIONS_CONTENT = `# Project Conventions

## File Structure
- Components in appropriate component directories
- Services in service directories
- Types in shared types files

## Naming
- Components: PascalCase
- Services: kebab-case
- Functions: camelCase
- Constants: SCREAMING_SNAKE_CASE

## TypeScript
- No \`any\` type - use \`unknown\` and narrow
- Explicit return types on exported functions
- Interface over type for object shapes

## React
- Functional components only
- Props interface named \`{Component}Props\`

## Error Handling
- Always wrap async operations in try/catch
- Log errors with context before re-throwing

## Imports
- Group: external, internal, relative, types
- Absolute imports for cross-directory
- Relative imports within same directory
`

// Singleton instance
let bvsOrchestratorService: BvsOrchestratorService | null = null

export function getBvsOrchestratorService(): BvsOrchestratorService {
  if (!bvsOrchestratorService) {
    const configStore = new ConfigStore()
    bvsOrchestratorService = new BvsOrchestratorService(configStore)
  }
  return bvsOrchestratorService
}

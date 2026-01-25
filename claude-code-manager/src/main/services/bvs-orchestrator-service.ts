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
} from '@shared/bvs-types'

// Import new execution services
import {
  complexityAnalyzer,
  type ComplexityAnalysis,
} from './bvs-complexity-analyzer-service'
import { getBvsLearningCaptureService } from './bvs-learning-capture-service'
import {
  BvsWorkerAgentService,
  type WorkerConfig,
  type WorkerResult,
  type ProjectContext,
} from './bvs-worker-agent-service'
import {
  mergePointService,
  type MergePointConfig,
  type MergePointResult,
  BVS_MERGE_CHANNELS,
} from './bvs-merge-point-service'

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

  // RALPH-010: Session-level cost tracking
  private sessionCosts: Map<string, {
    totalCost: number
    subtaskCount: number
    iterationCount: number
  }> = new Map()

  constructor() {
    super()
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
    const sections: BvsSection[] = plan.sections.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description || '',
      files: s.files.map((f) => ({
        path: f.path,
        action: f.action,
        status: 'pending' as const,
      })),
      dependencies: s.dependencies || [],
      dependents: [], // Will be computed
      status: 'pending' as const,
      successCriteria: (s.successCriteria || []).map((c, i) => ({
        id: `${s.id}-criterion-${i}`,
        description: typeof c === 'string' ? c : c.description,
        passed: false,
      })),
      progress: 0,
      retryCount: 0,
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
        return JSON.parse(content) as BvsExecutionPlan
      } catch {
        console.warn('[BvsOrchestrator] Plan not found for project:', projectId)
        return null
      }
    }

    // No projectId - try to find a 'ready' project first
    const projectsDir = path.join(projectPath, BVS_DIR, BVS_GLOBAL_FILES.PROJECTS_DIR)
    try {
      const projects = await fs.readdir(projectsDir)
      for (const pid of projects) {
        const projectJsonPath = path.join(projectsDir, pid, BVS_PROJECT_FILES.PROJECT_JSON)
        try {
          const projectJson = JSON.parse(await fs.readFile(projectJsonPath, 'utf-8')) as BvsProject
          if (projectJson.status === 'ready' || projectJson.status === 'in_progress') {
            const planPath = path.join(projectsDir, pid, BVS_PROJECT_FILES.PLAN_JSON)
            const content = await fs.readFile(planPath, 'utf-8')
            console.log('[BvsOrchestrator] Found ready project:', pid)
            return JSON.parse(content) as BvsExecutionPlan
          }
        } catch {
          continue
        }
      }
    } catch {
      // Projects directory doesn't exist
    }

    // Fallback: legacy location
    const legacyPlanPath = path.join(this.getBvsDir(projectPath), 'plan.json')
    try {
      const content = await fs.readFile(legacyPlanPath, 'utf-8')
      console.log('[BvsOrchestrator] Loaded plan from legacy location')
      return JSON.parse(content) as BvsExecutionPlan
    } catch {
      return null
    }
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
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)

    if (session.status !== 'paused') {
      throw new Error('Session is not paused')
    }

    session.status = 'running'
    session.pausedAt = undefined

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
    const session = this.sessions.get(sessionId)
    if (!session || !session.plan || session.status !== 'running') return

    const { sections, parallelGroups } = session.plan
    const maxWorkers = this.config.parallel.maxWorkers

    // Find sections that can run (dependencies met, not completed)
    const runnableSections = sections.filter(section => {
      if (section.status === 'done' || section.status === 'in_progress' || section.status === 'verifying') {
        return false
      }

      // Check all dependencies are complete
      return section.dependencies.every(depId => {
        const dep = sections.find(s => s.id === depId)
        return dep && dep.status === 'done'
      })
    })

    // Limit to max workers
    const sectionsToStart = runnableSections.slice(0, maxWorkers - session.currentSections.length)

    // Start each section
    for (const section of sectionsToStart) {
      await this.startSection(sessionId, section.id)
    }

    // Check if all sections are complete
    if (sections.every(s => s.status === 'done')) {
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

    // Note: Actual section execution would be handled by spawning a Task agent
    // This is a placeholder for the agent SDK integration
    console.log(`[BVS] Starting section ${sectionId} with worker ${workerId}`)
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
  async completeSection(sessionId: string, sectionId: string, success: boolean, error?: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session || !session.plan) return

    const section = session.plan.sections.find(s => s.id === sectionId)
    if (!section) return

    section.status = success ? 'done' : 'failed'
    section.completedAt = Date.now()
    section.progress = success ? 100 : section.progress
    section.lastError = error

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

    // Emit event
    this.emitBvsEvent({
      type: 'section_update',
      sectionId,
      status: section.status,
      progress: section.progress,
      workerId: section.workerId,
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
    const session = this.sessions.get(sessionId)
    if (!session || !session.plan) return

    const section = session.plan.sections.find(s => s.id === sectionId)
    if (!section || section.status !== 'failed') return

    if (section.retryCount >= section.maxRetries) {
      throw new Error(`Max retries (${section.maxRetries}) exceeded for section ${sectionId}`)
    }

    section.retryCount++
    section.status = 'retrying'
    section.lastError = undefined

    // Start the section again
    await this.startSection(sessionId, sectionId)
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
   */
  private async saveSessionProgress(session: BvsSession): Promise<void> {
    const progressPath = path.join(this.getBvsDir(session.projectPath), PROGRESS_FILE)
    const progress = {
      sessionId: session.id,
      status: session.status,
      phase: session.phase,
      sectionsTotal: session.sectionsTotal,
      sectionsCompleted: session.sectionsCompleted,
      sectionsFailed: session.sectionsFailed,
      overallProgress: session.overallProgress,
      startedAt: session.startedAt,
      totalElapsedSeconds: session.totalElapsedSeconds,
      sections: session.plan?.sections.map(s => ({
        id: s.id,
        name: s.name,
        status: s.status,
        progress: s.progress,
        workerId: s.workerId,
        startedAt: s.startedAt,
        completedAt: s.completedAt,
      })),
    }
    await fs.writeFile(progressPath, JSON.stringify(progress, null, 2))
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
      const workerService = new BvsWorkerAgentService()

      // Forward worker events
      workerService.on('progress', (data) => {
        section.progress = data.progress
        workerInfo.progress = data.progress
        workerInfo.currentStep = data.step

        this.emitBvsEvent({
          type: 'section_update',
          sectionId: section.id,
          status: section.status,
          progress: data.progress,
          currentStep: data.step,
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
    bvsOrchestratorService = new BvsOrchestratorService()
  }
  return bvsOrchestratorService
}

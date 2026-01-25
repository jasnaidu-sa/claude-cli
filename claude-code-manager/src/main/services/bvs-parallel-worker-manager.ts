/**
 * BVS Parallel Worker Manager Service
 *
 * Manages parallel execution of independent sections using worker agents.
 * Creates isolated git worktrees for each worker and handles safe merging.
 *
 * Features (from PRD Phase 0.5):
 * - F0.10: Dependency Graph Builder
 * - F0.11: Parallel Opportunity Analyzer
 * - F0.12: Worker Agent Spawner
 * - F0.13: Worktree Manager
 * - F0.14: Worker Monitor
 * - F0.15: Result Merger
 * - F0.16: Conflict Detector
 * - F0.17: Integration Verifier
 *
 * Worker Colors (per PRD):
 * - Worker 1: Blue (#3B82F6)
 * - Worker 2: Green (#22C55E)
 * - Worker 3: Yellow (#EAB308)
 * - Worker 4: Purple (#A855F7)
 * - Worker 5: Orange (#F97316)
 */

import { EventEmitter } from 'events'
import { spawn, ChildProcess } from 'child_process'
import * as path from 'path'
import * as fs from 'fs/promises'
import {
  type BvsSection,
  type BvsWorkerState,
  type BvsWorkerId,
  type BvsWorkerUpdateEvent,
  type BvsDependencyNode,
  BVS_IPC_CHANNELS,
  BVS_WORKER_COLORS,
} from '@shared/bvs-types'

/**
 * Extended dependency graph with Map for efficient lookup
 */
interface BvsDependencyGraph {
  nodes: Map<string, BvsDependencyNode & { level: number }>
  edges: Array<{ from: string; to: string }>
  levels: string[][]
}
import { getMainWindow } from '../index'

/**
 * Worker instance tracking
 */
interface WorkerInstance {
  id: BvsWorkerId
  sectionId: string
  state: BvsWorkerState
  worktreePath: string | null
  process: ChildProcess | null
  startedAt: number
  output: string[]
  error: string | null
  progress: number
}

/**
 * Merge result from combining worker outputs
 */
interface MergeResult {
  success: boolean
  conflicts: ConflictInfo[]
  mergedFiles: string[]
  error?: string
}

/**
 * Conflict information
 */
interface ConflictInfo {
  file: string
  worker1: BvsWorkerId
  worker2: BvsWorkerId
  conflictMarkers: string
}

/**
 * Parallel execution configuration
 */
export interface ParallelWorkerConfig {
  maxWorkers: number
  worktreeBaseDir: string
  timeoutMs: number
  mergeStrategy: 'sequential' | 'parallel'
  verifyAfterMerge: boolean
  cleanupWorktrees: boolean
}

const DEFAULT_PARALLEL_CONFIG: ParallelWorkerConfig = {
  maxWorkers: 3,
  worktreeBaseDir: '.bvs/worktrees',
  timeoutMs: 600000, // 10 minutes
  mergeStrategy: 'sequential',
  verifyAfterMerge: true,
  cleanupWorktrees: true,
}

/**
 * BVS Parallel Worker Manager Service
 */
export class BvsParallelWorkerManager extends EventEmitter {
  private config: ParallelWorkerConfig = DEFAULT_PARALLEL_CONFIG
  private workers: Map<BvsWorkerId, WorkerInstance> = new Map()
  private activeWorkerCount = 0
  private projectPath: string | null = null

  constructor() {
    super()
  }

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
   * Set configuration
   */
  setConfig(config: Partial<ParallelWorkerConfig>): void {
    this.config = { ...this.config, ...config }
  }

  /**
   * Initialize for a project
   */
  async initialize(projectPath: string): Promise<void> {
    this.projectPath = projectPath
    this.workers.clear()
    this.activeWorkerCount = 0

    // Create worktree base directory
    const worktreeDir = path.join(projectPath, this.config.worktreeBaseDir)
    await fs.mkdir(worktreeDir, { recursive: true })
  }

  /**
   * F0.10: Build dependency graph from sections
   *
   * Creates a DAG representing section dependencies for parallel analysis
   */
  buildDependencyGraph(sections: BvsSection[]): BvsDependencyGraph {
    const graph: BvsDependencyGraph = {
      nodes: new Map(),
      edges: [],
      levels: [],
    }

    // Add all sections as nodes
    for (const section of sections) {
      graph.nodes.set(section.id, {
        sectionId: section.id,
        dependencies: section.dependencies || [],
        dependents: [],
        level: -1,
      })
    }

    // Build edges and dependents
    for (const section of sections) {
      const node = graph.nodes.get(section.id)!
      for (const depId of section.dependencies || []) {
        graph.edges.push({ from: depId, to: section.id })
        const depNode = graph.nodes.get(depId)
        if (depNode) {
          depNode.dependents.push(section.id)
        }
      }
    }

    // Calculate levels using topological sort
    this.calculateLevels(graph)

    return graph
  }

  /**
   * Calculate execution levels using Kahn's algorithm
   */
  private calculateLevels(graph: BvsDependencyGraph): void {
    const inDegree = new Map<string, number>()
    const levels: string[][] = []

    // Initialize in-degrees
    for (const [id, node] of graph.nodes) {
      inDegree.set(id, node.dependencies.length)
    }

    // Process level by level
    let currentLevel: string[] = []

    // Find all nodes with no dependencies
    for (const [id, degree] of inDegree) {
      if (degree === 0) {
        currentLevel.push(id)
        const node = graph.nodes.get(id)!
        node.level = 0
      }
    }

    let level = 0
    while (currentLevel.length > 0) {
      levels.push([...currentLevel])
      const nextLevel: string[] = []

      for (const nodeId of currentLevel) {
        const node = graph.nodes.get(nodeId)!
        for (const dependent of node.dependents) {
          const degree = inDegree.get(dependent)! - 1
          inDegree.set(dependent, degree)

          if (degree === 0) {
            nextLevel.push(dependent)
            const depNode = graph.nodes.get(dependent)!
            depNode.level = level + 1
          }
        }
      }

      currentLevel = nextLevel
      level++
    }

    graph.levels = levels
  }

  /**
   * F0.11: Identify parallel execution opportunities
   *
   * Analyzes the dependency graph to find sections that can run simultaneously
   */
  findParallelGroups(graph: BvsDependencyGraph): string[][] {
    // Sections at the same level can run in parallel (no dependencies between them)
    return graph.levels.map(level =>
      // Limit by maxWorkers
      level.slice(0, this.config.maxWorkers)
    )
  }

  /**
   * F0.12: Spawn a worker agent for a section
   */
  async spawnWorker(
    section: BvsSection,
    workerId: BvsWorkerId
  ): Promise<WorkerInstance> {
    if (!this.projectPath) {
      throw new Error('Manager not initialized with project path')
    }

    if (this.activeWorkerCount >= this.config.maxWorkers) {
      throw new Error(`Max workers (${this.config.maxWorkers}) already active`)
    }

    // Create worktree for isolation
    const worktreePath = await this.createWorktree(workerId)

    const worker: WorkerInstance = {
      id: workerId,
      sectionId: section.id,
      state: 'idle',
      worktreePath,
      process: null,
      startedAt: Date.now(),
      output: [],
      error: null,
      progress: 0,
    }

    this.workers.set(workerId, worker)
    this.activeWorkerCount++

    // Emit worker created event
    this.emitWorkerUpdate(worker, 'created')

    return worker
  }

  /**
   * F0.13: Create isolated git worktree for worker
   */
  private async createWorktree(workerId: BvsWorkerId): Promise<string> {
    if (!this.projectPath) {
      throw new Error('Project path not set')
    }

    const worktreePath = path.join(
      this.projectPath,
      this.config.worktreeBaseDir,
      `worker-${workerId}`
    )

    // Create worktree from current HEAD
    const branchName = `bvs-worker-${workerId}-${Date.now()}`

    try {
      // Create new branch and worktree
      await this.execGit(['worktree', 'add', '-b', branchName, worktreePath])
      return worktreePath
    } catch (error) {
      // If worktree already exists, try to reuse it
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('already exists')) {
        return worktreePath
      }
      throw error
    }
  }

  /**
   * Execute git command
   */
  private execGit(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn('git', args, {
        cwd: this.projectPath!,
        shell: true,
      })

      let stdout = ''
      let stderr = ''

      proc.stdout?.on('data', data => {
        stdout += data.toString()
      })

      proc.stderr?.on('data', data => {
        stderr += data.toString()
      })

      proc.on('close', code => {
        if (code === 0) {
          resolve(stdout.trim())
        } else {
          reject(new Error(`Git command failed: ${stderr || stdout}`))
        }
      })

      proc.on('error', reject)
    })
  }

  /**
   * Start worker execution
   *
   * NOTE: This is a placeholder. In full implementation, this would
   * spawn a Task agent using the Agent SDK to execute the section.
   */
  async startWorker(workerId: BvsWorkerId, prompt: string): Promise<void> {
    const worker = this.workers.get(workerId)
    if (!worker) {
      throw new Error(`Worker ${workerId} not found`)
    }

    worker.state = 'running'
    worker.startedAt = Date.now()
    this.emitWorkerUpdate(worker, 'started')

    // NOTE: In full implementation:
    // const taskResult = await spawnTaskAgent({
    //   subagent_type: 'developer',
    //   prompt: prompt,
    //   cwd: worker.worktreePath,
    //   run_in_background: false,
    // })

    // For now, simulate completion
    setTimeout(() => {
      this.completeWorker(workerId, true)
    }, 1000)
  }

  /**
   * F0.14: Monitor worker status and handle failures
   */
  monitorWorker(workerId: BvsWorkerId): WorkerInstance | undefined {
    return this.workers.get(workerId)
  }

  /**
   * Get all active workers
   */
  getActiveWorkers(): WorkerInstance[] {
    return Array.from(this.workers.values()).filter(w => w.state === 'running')
  }

  /**
   * Get worker by section ID
   */
  getWorkerBySection(sectionId: string): WorkerInstance | undefined {
    return Array.from(this.workers.values()).find(w => w.sectionId === sectionId)
  }

  /**
   * Complete a worker
   */
  completeWorker(workerId: BvsWorkerId, success: boolean, error?: string): void {
    const worker = this.workers.get(workerId)
    if (!worker) return

    worker.state = success ? 'completed' : 'failed'
    worker.progress = success ? 100 : worker.progress
    if (error) worker.error = error

    this.activeWorkerCount = Math.max(0, this.activeWorkerCount - 1)
    this.emitWorkerUpdate(worker, success ? 'completed' : 'failed')

    this.emit('worker-complete', { workerId, success, error })
  }

  /**
   * Update worker progress
   */
  updateWorkerProgress(workerId: BvsWorkerId, progress: number, currentStep?: string): void {
    const worker = this.workers.get(workerId)
    if (!worker) return

    worker.progress = progress
    this.emitWorkerUpdate(worker, 'progress', currentStep)
  }

  /**
   * F0.15: Merge results from parallel workers
   */
  async mergeWorkerResults(workerIds: BvsWorkerId[]): Promise<MergeResult> {
    if (!this.projectPath) {
      throw new Error('Project path not set')
    }

    const result: MergeResult = {
      success: true,
      conflicts: [],
      mergedFiles: [],
    }

    // Get all completed workers
    const completedWorkers = workerIds
      .map(id => this.workers.get(id))
      .filter((w): w is WorkerInstance => w !== undefined && w.state === 'completed')

    if (completedWorkers.length === 0) {
      return result
    }

    // Merge each worker's changes back to main
    for (const worker of completedWorkers) {
      if (!worker.worktreePath) continue

      try {
        // Get the branch name for this worktree
        const branchName = await this.execGit(['rev-parse', '--abbrev-ref', 'HEAD'])
        const workerBranch = `bvs-worker-${worker.id}-*`

        // Check for conflicts by doing a dry-run merge
        const conflicts = await this.detectConflicts(worker)

        if (conflicts.length > 0) {
          result.conflicts.push(...conflicts)
          result.success = false
        } else {
          // Merge the worker branch
          await this.execGit(['merge', '--no-ff', '-m', `BVS: Merge section ${worker.sectionId}`, workerBranch])

          // Track merged files
          const changedFiles = await this.getChangedFiles(worker.worktreePath)
          result.mergedFiles.push(...changedFiles)
        }
      } catch (error) {
        result.success = false
        result.error = error instanceof Error ? error.message : String(error)
      }
    }

    return result
  }

  /**
   * F0.16: Detect merge conflicts between workers
   */
  private async detectConflicts(worker: WorkerInstance): Promise<ConflictInfo[]> {
    // NOTE: In full implementation, this would:
    // 1. Attempt a merge --no-commit to check for conflicts
    // 2. Parse the conflict markers
    // 3. Abort the merge if conflicts found
    // 4. Return conflict information

    // Placeholder - returns no conflicts
    return []
  }

  /**
   * Get list of changed files in worktree
   */
  private async getChangedFiles(worktreePath: string): Promise<string[]> {
    try {
      const output = await this.execGit(['diff', '--name-only', 'HEAD~1'])
      return output.split('\n').filter(Boolean)
    } catch {
      return []
    }
  }

  /**
   * F0.17: Run integration verification after merge
   */
  async verifyIntegration(): Promise<boolean> {
    // This would run full verification after merging parallel workers:
    // 1. Full TypeScript check
    // 2. All tests
    // 3. Lint
    // 4. Build

    // NOTE: In full implementation, this would call the orchestrator's
    // verification methods

    return true
  }

  /**
   * Cleanup worktree after worker completes
   */
  async cleanupWorktree(workerId: BvsWorkerId): Promise<void> {
    if (!this.config.cleanupWorktrees) return

    const worker = this.workers.get(workerId)
    if (!worker?.worktreePath) return

    try {
      // Remove worktree
      await this.execGit(['worktree', 'remove', '--force', worker.worktreePath])

      // Delete the branch
      const branchName = `bvs-worker-${workerId}-*`
      await this.execGit(['branch', '-D', branchName])
    } catch {
      // Ignore cleanup errors
    }
  }

  /**
   * Cleanup all worktrees
   */
  async cleanupAllWorktrees(): Promise<void> {
    for (const worker of this.workers.values()) {
      await this.cleanupWorktree(worker.id)
    }
    this.workers.clear()
    this.activeWorkerCount = 0
  }

  /**
   * Emit worker update event
   */
  private emitWorkerUpdate(
    worker: WorkerInstance,
    eventType: 'created' | 'started' | 'progress' | 'completed' | 'failed',
    currentStep?: string
  ): void {
    const event: BvsWorkerUpdateEvent = {
      type: 'worker_update',
      workerId: worker.id,
      sectionId: worker.sectionId,
      state: worker.state,
      progress: worker.progress,
      color: BVS_WORKER_COLORS[worker.id],
      currentStep,
      timestamp: Date.now(),
    }

    this.emit('worker-update', event)
    this.sendToRenderer(BVS_IPC_CHANNELS.BVS_EVENT, event)
  }

  /**
   * Get worker statistics
   */
  getWorkerStats(): {
    total: number
    active: number
    completed: number
    failed: number
  } {
    const workers = Array.from(this.workers.values())
    return {
      total: workers.length,
      active: workers.filter(w => w.state === 'running').length,
      completed: workers.filter(w => w.state === 'completed').length,
      failed: workers.filter(w => w.state === 'failed').length,
    }
  }

  /**
   * Check if any workers are active
   */
  hasActiveWorkers(): boolean {
    return this.activeWorkerCount > 0
  }

  /**
   * Get available worker ID
   */
  getAvailableWorkerId(): BvsWorkerId | null {
    const usedIds = new Set(this.workers.keys())
    const allIds: BvsWorkerId[] = ['W1', 'W2', 'W3', 'W4', 'W5']

    for (const id of allIds) {
      const worker = this.workers.get(id)
      if (!worker || worker.state === 'completed' || worker.state === 'failed') {
        return id
      }
    }

    return null
  }

  /**
   * Format worker status for display
   */
  formatWorkerStatus(workerId: BvsWorkerId): string {
    const worker = this.workers.get(workerId)
    if (!worker) return 'Not found'

    const color = BVS_WORKER_COLORS[workerId]
    const elapsed = Math.floor((Date.now() - worker.startedAt) / 1000)

    return `[${color}] Worker ${workerId}: ${worker.sectionId} - ${worker.state} (${worker.progress}%) - ${elapsed}s`
  }
}

// Singleton instance
let bvsParallelWorkerManager: BvsParallelWorkerManager | null = null

export function getBvsParallelWorkerManager(): BvsParallelWorkerManager {
  if (!bvsParallelWorkerManager) {
    bvsParallelWorkerManager = new BvsParallelWorkerManager()
  }
  return bvsParallelWorkerManager
}

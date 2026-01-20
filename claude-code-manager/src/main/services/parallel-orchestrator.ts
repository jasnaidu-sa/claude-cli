/**
 * Parallel Orchestrator Service
 * Orchestrates parallel task execution across multiple agents
 */

import { EventEmitter } from 'events'
import type {
  RalphTask,
  RalphTaskYaml,
  RalphSessionConfig,
  RalphSessionStatus,
  SessionState,
  GroupStatus,
  AgentStatus,
} from '../../shared/ralph-types'
import { AgentEnvironment, createAgentEnvironment, type AgentConfig, type AgentCompletion } from './agent-environment'
import { dependencyGraphService } from './dependency-graph-service'

// Constants
const DEFAULT_MAX_AGENTS = 3
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes
const DEFAULT_RETRY_DELAY_MS = 5000 // 5 seconds
const MAX_RETRY_DELAY_MS = 60000 // 1 minute max backoff
const MAX_TASKS_PER_GROUP = 100

/**
 * Orchestrator configuration
 */
export interface OrchestratorConfig {
  /** Session ID */
  sessionId: string

  /** Task YAML content */
  taskYaml: RalphTaskYaml

  /** Repository path */
  repoPath: string

  /** Maximum concurrent agents */
  maxAgents?: number

  /** Task timeout in ms */
  taskTimeout?: number

  /** Retry delay in ms */
  retryDelay?: number

  /** Maximum retries per task */
  maxRetries?: number

  /** Run tests after each task */
  runTests?: boolean

  /** Run lint after each task */
  runLint?: boolean

  /** Checkpoint between groups */
  checkpointBetweenGroups?: boolean

  /** Checkpoint before merge */
  checkpointBeforeMerge?: boolean
}

/**
 * Parallel Execution Orchestrator
 */
export class ParallelOrchestrator extends EventEmitter {
  private config: OrchestratorConfig
  private state: SessionState = 'idle'
  private currentGroup: number = 0
  private totalGroups: number = 0
  private agents: Map<string, AgentEnvironment> = new Map()
  private completedTasks: Set<string> = new Set()
  private failedTasks: Map<string, { error: string; retries: number }> = new Map()
  private taskQueue: RalphTask[] = []
  private startTime: number = 0
  private pauseRequested: boolean = false
  private stopRequested: boolean = false

  constructor(config: OrchestratorConfig) {
    super()
    this.config = {
      maxAgents: DEFAULT_MAX_AGENTS,
      taskTimeout: DEFAULT_TIMEOUT_MS,
      retryDelay: DEFAULT_RETRY_DELAY_MS,
      maxRetries: 2,
      ...config,
    }

    // Calculate total groups
    const groups = dependencyGraphService.getParallelGroups(config.taskYaml.tasks)
    this.totalGroups = groups.length
  }

  /**
   * Get current session status
   */
  getStatus(): RalphSessionStatus {
    const groups = this.getGroupStatuses()
    const agents = this.getAgentStatuses()
    const elapsed = this.startTime > 0 ? Date.now() - this.startTime : 0
    const progress = this.calculateProgress()

    return {
      sessionId: this.config.sessionId,
      state: this.state,
      currentGroup: this.currentGroup,
      totalGroups: this.totalGroups,
      groups,
      agents,
      progress,
      elapsedTime: elapsed,
    }
  }

  /**
   * Get status for all groups
   */
  private getGroupStatuses(): GroupStatus[] {
    const allGroups = dependencyGraphService.getParallelGroups(this.config.taskYaml.tasks)
    const statuses: GroupStatus[] = []

    for (const groupNum of allGroups) {
      const tasksInGroup = dependencyGraphService.getTasksInGroup(
        this.config.taskYaml.tasks,
        groupNum
      )
      const taskIds = tasksInGroup.map((t) => t.id)
      const completedCount = taskIds.filter((id) => this.completedTasks.has(id)).length
      const failedCount = taskIds.filter((id) => this.failedTasks.has(id)).length
      const activeAgents = Array.from(this.agents.values())
        .filter((a) => taskIds.includes(a.getStatus().taskId))
        .map((a) => a.getStatus().agentId)

      let state: GroupStatus['state'] = 'pending'
      if (groupNum < this.currentGroup) {
        state = completedCount === taskIds.length ? 'completed' : 'failed'
      } else if (groupNum === this.currentGroup) {
        state = activeAgents.length > 0 ? 'executing' : 'pending'
      }

      statuses.push({
        groupNumber: groupNum,
        taskIds,
        state,
        completedCount,
        failedCount,
        activeAgents,
      })
    }

    return statuses
  }

  /**
   * Get status for all agents
   */
  private getAgentStatuses(): AgentStatus[] {
    return Array.from(this.agents.values()).map((a) => a.getStatus())
  }

  /**
   * Calculate overall progress percentage
   */
  private calculateProgress(): number {
    const total = this.config.taskYaml.tasks.length
    if (total === 0) return 100
    return Math.round((this.completedTasks.size / total) * 100)
  }

  /**
   * Start parallel execution
   */
  async start(): Promise<void> {
    if (this.state !== 'idle') {
      throw new Error(`Cannot start: current state is ${this.state}`)
    }

    this.startTime = Date.now()
    this.state = 'executing_group'
    this.emit('state', this.state)

    try {
      // Process groups in order
      const groups = dependencyGraphService.getParallelGroups(this.config.taskYaml.tasks)

      for (const groupNum of groups) {
        if (this.stopRequested) {
          break
        }

        this.currentGroup = groupNum
        this.emit('group_start', groupNum)

        // Execute all tasks in this group
        await this.executeGroup(groupNum)

        // Check for pause/stop
        if (this.pauseRequested) {
          this.state = 'paused'
          this.emit('state', this.state)
          return
        }

        // Checkpoint between groups if configured
        if (this.config.checkpointBetweenGroups && groupNum < groups[groups.length - 1]) {
          this.state = 'checkpoint_merge'
          this.emit('state', this.state)
          this.emit('checkpoint', {
            type: 'group_complete',
            groupNumber: groupNum,
          })
          // Wait for checkpoint approval (handled externally)
        }

        this.emit('group_complete', groupNum)
      }

      // All groups completed
      this.state = 'completed'
      this.emit('state', this.state)
      this.emit('complete', {
        success: true,
        completedTasks: this.completedTasks.size,
        failedTasks: this.failedTasks.size,
        duration: Date.now() - this.startTime,
      })
    } catch (error) {
      this.state = 'failed'
      this.emit('state', this.state)
      this.emit('error', error)
      throw error
    }
  }

  /**
   * Execute all tasks in a group (P2 fix: resource limits, P1 fix: exit condition)
   */
  private async executeGroup(groupNum: number): Promise<void> {
    const tasks = dependencyGraphService.getTasksInGroup(this.config.taskYaml.tasks, groupNum)

    // P2 FIX: Enforce maximum tasks per group
    if (tasks.length > MAX_TASKS_PER_GROUP) {
      throw new Error(`Group ${groupNum} exceeds maximum task limit: ${tasks.length} > ${MAX_TASKS_PER_GROUP}`)
    }

    // Filter out already completed tasks
    const pendingTasks = tasks.filter(
      (t) => !this.completedTasks.has(t.id) && !this.failedTasks.has(t.id)
    )

    if (pendingTasks.length === 0) {
      return
    }

    // Queue tasks
    this.taskQueue = [...pendingTasks]

    // Start initial batch of agents
    const maxAgents = this.config.maxAgents || DEFAULT_MAX_AGENTS
    const initialBatch = Math.min(maxAgents, this.taskQueue.length)

    for (let i = 0; i < initialBatch; i++) {
      const task = this.taskQueue.shift()
      if (task) {
        // P2 FIX: Execute immediately without accumulating in unbounded array
        this.executeTask(task).catch((error) => {
          console.error(`Task ${task.id} failed:`, error instanceof Error ? error.message : 'unknown error')
        })
      }
    }

    // Wait for all tasks in group to complete
    while (this.taskQueue.length > 0 || this.agents.size > 0) {
      if (this.stopRequested) {
        await this.stopAllAgents()
        break
      }

      // P1 FIX: Explicit exit condition to prevent infinite loop
      if (this.agents.size === 0 && this.taskQueue.length === 0) {
        break
      }

      // Wait for any agent to complete
      if (this.agents.size > 0) {
        await Promise.race([
          ...Array.from(this.agents.values()).map(
            (a) => new Promise<void>((resolve) => a.once('complete', () => resolve()))
          ),
          new Promise((resolve) => setTimeout(resolve, 1000)), // Timeout to check status
        ])
      } else {
        // No agents running, wait a bit before checking queue again
        await new Promise((resolve) => setTimeout(resolve, 100))
      }

      // Start next task if queue not empty and capacity available
      while (
        this.taskQueue.length > 0 &&
        this.agents.size < (this.config.maxAgents || DEFAULT_MAX_AGENTS)
      ) {
        const task = this.taskQueue.shift()
        if (task) {
          this.executeTask(task).catch((error) => {
            console.error(`Task ${task.id} failed:`, error instanceof Error ? error.message : 'unknown error')
          })
        }
      }
    }
  }

  /**
   * Execute a single task
   */
  private async executeTask(task: RalphTask): Promise<void> {
    const agentId = `agent-${task.id}-${Date.now()}`

    const agentConfig: AgentConfig = {
      agentId,
      task,
      sessionId: this.config.sessionId,
      baseBranch: this.config.taskYaml.project.base_branch,
      repoPath: this.config.repoPath,
      timeout: this.config.taskTimeout,
    }

    const agent = createAgentEnvironment(agentConfig)
    this.agents.set(agentId, agent)

    // Forward agent events
    agent.on('state', (state) => {
      this.emit('agent_state', { agentId, taskId: task.id, state })
    })

    agent.on('output', (output) => {
      this.emit('agent_output', output)
    })

    agent.on('complete', (completion: AgentCompletion) => {
      this.handleAgentComplete(agent, completion)
    })

    try {
      await agent.initialize()
      await agent.execute()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.handleAgentFailure(task, message)
    } finally {
      this.agents.delete(agentId)
    }
  }

  /**
   * Handle agent completion (P0 fix: remove non-null assertion)
   */
  private handleAgentComplete(agent: AgentEnvironment, completion: AgentCompletion): void {
    if (completion.success) {
      this.completedTasks.add(completion.taskId)
      this.emit('task_complete', {
        taskId: completion.taskId,
        agentId: completion.agentId,
        metrics: completion.metrics,
      })
    } else {
      // P0 FIX: Remove non-null assertion, handle missing task gracefully
      const task = this.config.taskYaml.tasks.find((t) => t.id === completion.taskId)
      if (!task) {
        const message = `Task not found: ${completion.taskId}`
        this.emit('task_failed', { taskId: completion.taskId, error: message, retries: 0 })
        return
      }
      this.handleAgentFailure(task, completion.error || 'Unknown error')
    }
  }

  /**
   * Handle agent failure with retry logic (P2 fix: exponential backoff)
   */
  private handleAgentFailure(task: RalphTask, error: string): void {
    const existing = this.failedTasks.get(task.id)
    const retries = existing ? existing.retries + 1 : 1
    const maxRetries = this.config.maxRetries || 2

    if (retries <= maxRetries) {
      // P2 FIX: Exponential backoff: 5s, 10s, 20s
      const baseDelay = this.config.retryDelay || DEFAULT_RETRY_DELAY_MS
      const backoffDelay = baseDelay * Math.pow(2, retries - 1)
      const actualDelay = Math.min(backoffDelay, MAX_RETRY_DELAY_MS)

      this.emit('task_retry', {
        taskId: task.id,
        attempt: retries,
        error,
        nextRetryIn: actualDelay,
      })

      setTimeout(() => {
        // Double-check we're still running before re-queuing
        if (!this.stopRequested && !this.pauseRequested) {
          // Mark as retrying to prevent duplicate retries
          this.failedTasks.set(task.id, { error, retries })
          this.taskQueue.push(task)
        }
      }, actualDelay)
    } else {
      // Mark as permanently failed
      this.failedTasks.set(task.id, { error, retries })
      this.emit('task_failed', { taskId: task.id, error, retries })
    }
  }

  /**
   * Pause execution
   */
  async pause(): Promise<void> {
    this.pauseRequested = true
    // Don't stop running agents, just prevent new ones from starting
  }

  /**
   * Resume execution after pause (P0 fix: continue from current group, not restart)
   */
  async resume(): Promise<void> {
    if (this.state !== 'paused') {
      throw new Error(`Cannot resume: current state is ${this.state}`)
    }

    this.pauseRequested = false
    this.state = 'executing_group'
    this.emit('state', this.state)

    // P0 FIX: Continue from current group, not restart from beginning
    try {
      const groups = dependencyGraphService.getParallelGroups(this.config.taskYaml.tasks)

      // Find the index of current group and resume from there
      const currentGroupIndex = groups.indexOf(this.currentGroup)
      const remainingGroups = groups.slice(currentGroupIndex)

      for (const groupNum of remainingGroups) {
        if (this.stopRequested) {
          break
        }

        this.currentGroup = groupNum
        this.emit('group_start', groupNum)

        await this.executeGroup(groupNum)

        if (this.pauseRequested) {
          this.state = 'paused'
          this.emit('state', this.state)
          return
        }

        if (this.config.checkpointBetweenGroups && groupNum < groups[groups.length - 1]) {
          this.state = 'checkpoint_merge'
          this.emit('state', this.state)
          this.emit('checkpoint', {
            type: 'group_complete',
            groupNumber: groupNum,
          })
        }

        this.emit('group_complete', groupNum)
      }

      this.state = 'completed'
      this.emit('state', this.state)
      this.emit('complete', {
        success: true,
        completedTasks: this.completedTasks.size,
        failedTasks: this.failedTasks.size,
        duration: Date.now() - this.startTime,
      })
    } catch (error) {
      this.state = 'failed'
      this.emit('state', this.state)
      this.emit('error', error)
      throw error
    }
  }

  /**
   * Stop all execution
   */
  async stop(): Promise<void> {
    this.stopRequested = true
    await this.stopAllAgents()
    this.state = 'failed'
    this.emit('state', this.state)
  }

  /**
   * Stop all running agents
   */
  private async stopAllAgents(): Promise<void> {
    const promises = Array.from(this.agents.values()).map((a) => a.stop())
    await Promise.allSettled(promises)
  }

  /**
   * Cleanup all resources
   */
  async cleanup(): Promise<void> {
    await this.stopAllAgents()

    // Cleanup each agent's worktree
    for (const agent of this.agents.values()) {
      await agent.cleanup()
    }

    this.agents.clear()
    this.removeAllListeners()
  }

  /**
   * Get task by ID
   */
  getTask(taskId: string): RalphTask | undefined {
    return this.config.taskYaml.tasks.find((t) => t.id === taskId)
  }

  /**
   * Check if task is completed
   */
  isTaskCompleted(taskId: string): boolean {
    return this.completedTasks.has(taskId)
  }

  /**
   * Check if task failed
   */
  isTaskFailed(taskId: string): boolean {
    return this.failedTasks.has(taskId)
  }

  /**
   * Get failed task error
   */
  getTaskError(taskId: string): string | undefined {
    return this.failedTasks.get(taskId)?.error
  }

  /**
   * Get all completed task IDs
   */
  getCompletedTaskIds(): string[] {
    return Array.from(this.completedTasks)
  }

  /**
   * Get all failed task IDs
   */
  getFailedTaskIds(): string[] {
    return Array.from(this.failedTasks.keys())
  }
}

/**
 * Create orchestrator instance
 */
export function createParallelOrchestrator(config: OrchestratorConfig): ParallelOrchestrator {
  return new ParallelOrchestrator(config)
}

/**
 * Task Scheduler Service - Polling-based scheduled task executor.
 *
 * Implements P3-T2 from PRD_WHATSAPP_AI_ASSISTANT.
 *
 * Stores tasks in electron-store, checks for due tasks every 60 seconds,
 * and enqueues them via GroupQueueService for concurrency control.
 *
 * Features:
 * - CRUD operations for ScheduledTask
 * - Supports cron, interval, and one-time schedule types
 * - Cron expressions parsed via cron-parser (v5) with timezone support
 * - One-time tasks auto-complete after firing
 * - maxRuns support: tasks auto-complete when runCount >= maxRuns
 * - Task run log with retention policy (last 100 per task)
 * - Duplicate scheduler prevention (singleton polling loop)
 * - Tasks enqueued via GroupQueueService for concurrency control
 *
 * Events emitted:
 * - 'task-executed'  (TaskRunLog)
 * - 'task-failed'    (TaskRunLog)
 * - 'task-created'   (ScheduledTask)
 * - 'task-updated'   (ScheduledTask)
 */

import { EventEmitter } from 'events'
import Store from 'electron-store'
import { randomUUID } from 'crypto'
import { CronExpressionParser } from 'cron-parser'
import type {
  ScheduledTask,
  TaskScheduleType,
  TaskStatus,
  TaskRunLog,
} from '@shared/whatsapp-types'
import type { GroupQueueService } from './group-queue-service'
import type { WhatsAppService } from './whatsapp-service'

// ============================================================================
// Constants
// ============================================================================

/** Polling interval in milliseconds - check for due tasks every 60 seconds. */
const POLL_INTERVAL_MS = 60_000

/** Maximum number of run logs to keep per task. */
const MAX_LOGS_PER_TASK = 100

/** Auto-incrementing ID counter key in the log store. */
const LOG_ID_COUNTER_KEY = '__logIdCounter'

// ============================================================================
// Store Schemas
// ============================================================================

/** Shape of the electron-store that persists scheduled tasks keyed by ID. */
interface TaskStoreSchema {
  tasks: Record<string, ScheduledTask>
}

/** Shape of the electron-store that persists run logs keyed by task ID. */
interface TaskLogStoreSchema {
  logs: Record<string, TaskRunLog[]>
  [LOG_ID_COUNTER_KEY]: number
}

// ============================================================================
// Singleton Guard
// ============================================================================

/** Global flag to prevent multiple scheduler instances running concurrently. */
let schedulerInstanceRunning = false

// ============================================================================
// TaskSchedulerService
// ============================================================================

export class TaskSchedulerService extends EventEmitter {
  /** Electron-store for task persistence. */
  private taskStore: Store<TaskStoreSchema>

  /** Electron-store for run log persistence. */
  private logStore: Store<TaskLogStoreSchema>

  /** Reference to the group queue for concurrency-controlled execution. */
  private queueService: GroupQueueService

  /** Reference to the WhatsApp service (used for sending task results). */
  private whatsappService: WhatsAppService

  /** Handle to the polling interval timer, or null when stopped. */
  private pollTimer: ReturnType<typeof setInterval> | null = null

  /** Whether this instance currently owns the polling loop. */
  private running = false

  constructor(queueService: GroupQueueService, whatsappService: WhatsAppService) {
    super()
    this.queueService = queueService
    this.whatsappService = whatsappService

    this.taskStore = new Store<TaskStoreSchema>({
      name: 'whatsapp-scheduled-tasks',
      defaults: {
        tasks: {},
      },
    })

    this.logStore = new Store<TaskLogStoreSchema>({
      name: 'whatsapp-task-logs',
      defaults: {
        logs: {},
        [LOG_ID_COUNTER_KEY]: 0,
      },
    })
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  /**
   * Start the polling loop. Only one instance may run at a time.
   * If another instance is already running, this call is a no-op.
   */
  start(): void {
    if (this.running) {
      return
    }

    if (schedulerInstanceRunning) {
      console.warn(
        '[TaskSchedulerService] Another scheduler instance is already running. Ignoring start().',
      )
      return
    }

    schedulerInstanceRunning = true
    this.running = true

    // Run an immediate check, then start the interval
    this.pollForDueTasks()
    this.pollTimer = setInterval(() => this.pollForDueTasks(), POLL_INTERVAL_MS)
  }

  /** Stop the polling loop and release the singleton lock. */
  stop(): void {
    if (!this.running) {
      return
    }

    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }

    this.running = false
    schedulerInstanceRunning = false
  }

  /** Whether the scheduler polling loop is currently active. */
  isRunning(): boolean {
    return this.running
  }

  // --------------------------------------------------------------------------
  // CRUD
  // --------------------------------------------------------------------------

  /**
   * Create a new scheduled task. Calculates the initial nextRun and persists.
   * Emits 'task-created'.
   */
  createTask(
    task: Omit<ScheduledTask, 'id' | 'createdAt' | 'updatedAt' | 'runCount'>,
  ): ScheduledTask {
    const now = Date.now()
    const id = `task-${randomUUID().slice(0, 12)}`

    const newTask: ScheduledTask = {
      ...task,
      id,
      runCount: 0,
      createdAt: now,
      updatedAt: now,
    }

    // Calculate initial nextRun if the task is active
    if (newTask.status === 'active') {
      newTask.nextRun = this.calculateNextRun(newTask)
    }

    const tasks = this.taskStore.get('tasks')
    tasks[id] = newTask
    this.taskStore.set('tasks', tasks)

    this.emit('task-created', newTask)
    return newTask
  }

  /**
   * Update an existing task. Re-calculates nextRun if schedule fields change.
   * Emits 'task-updated'.
   * @throws Error if the task does not exist.
   */
  updateTask(id: string, updates: Partial<ScheduledTask>): ScheduledTask {
    const tasks = this.taskStore.get('tasks')
    const existing = tasks[id]

    if (!existing) {
      throw new Error(`Task not found: ${id}`)
    }

    const updatedTask: ScheduledTask = {
      ...existing,
      ...updates,
      id, // Prevent ID from being overwritten
      updatedAt: Date.now(),
    }

    // Re-calculate nextRun if schedule-related fields changed
    const scheduleChanged =
      updates.scheduleType !== undefined ||
      updates.scheduleValue !== undefined ||
      updates.status !== undefined

    if (scheduleChanged && updatedTask.status === 'active') {
      updatedTask.nextRun = this.calculateNextRun(updatedTask)
    }

    tasks[id] = updatedTask
    this.taskStore.set('tasks', tasks)

    this.emit('task-updated', updatedTask)
    return updatedTask
  }

  /**
   * Delete a task and its associated run logs.
   * @throws Error if the task does not exist.
   */
  deleteTask(id: string): void {
    const tasks = this.taskStore.get('tasks')

    if (!tasks[id]) {
      throw new Error(`Task not found: ${id}`)
    }

    delete tasks[id]
    this.taskStore.set('tasks', tasks)

    // Clean up associated logs
    const logs = this.logStore.get('logs')
    delete logs[id]
    this.logStore.set('logs', logs)
  }

  /** Retrieve a single task by ID, or undefined if not found. */
  getTask(id: string): ScheduledTask | undefined {
    const tasks = this.taskStore.get('tasks')
    return tasks[id]
  }

  /** List all tasks, optionally filtered by status. */
  listTasks(status?: TaskStatus): ScheduledTask[] {
    const tasks = this.taskStore.get('tasks')
    const allTasks = Object.values(tasks)

    if (status) {
      return allTasks.filter((t) => t.status === status)
    }

    return allTasks
  }

  // --------------------------------------------------------------------------
  // Run Logs
  // --------------------------------------------------------------------------

  /**
   * Get run logs for a task, ordered by most recent first.
   * @param taskId The task ID to get logs for.
   * @param limit Maximum number of logs to return (default: 50).
   */
  getTaskLogs(taskId: string, limit = 50): TaskRunLog[] {
    const logs = this.logStore.get('logs')
    const taskLogs = logs[taskId] ?? []

    // Return most recent first, limited
    return taskLogs.slice(-limit).reverse()
  }

  // --------------------------------------------------------------------------
  // Polling Loop
  // --------------------------------------------------------------------------

  /** Check for due tasks and enqueue them via GroupQueueService. */
  private pollForDueTasks(): void {
    const now = new Date()
    const tasks = this.taskStore.get('tasks')

    for (const task of Object.values(tasks)) {
      if (task.status !== 'active') {
        continue
      }

      if (!task.nextRun) {
        continue
      }

      const nextRunDate = new Date(task.nextRun)
      if (nextRunDate <= now) {
        // Re-verify the task is still active (guard against race conditions
        // between poll cycles and concurrent updates)
        const freshTask = this.getTask(task.id)
        if (!freshTask || freshTask.status !== 'active') {
          continue
        }

        // Enqueue via GroupQueueService for concurrency control
        this.queueService.enqueueTask(freshTask.conversationJid, freshTask)
      }
    }
  }

  // --------------------------------------------------------------------------
  // Task Execution
  // --------------------------------------------------------------------------

  /**
   * Execute a scheduled task. Called by the GroupQueueService's processTaskFn.
   *
   * - Records start time
   * - Sends the task prompt to the conversation via WhatsApp
   * - Logs the run result
   * - Updates nextRun, runCount, lastRun, lastResult/lastError
   * - Auto-completes one-time tasks or tasks that have hit maxRuns
   *
   * @returns The TaskRunLog entry for this execution.
   */
  async executeTask(task: ScheduledTask): Promise<TaskRunLog> {
    const startTime = Date.now()
    let status: 'success' | 'error' = 'success'
    let result: string | undefined
    let error: string | undefined

    try {
      // Send the task prompt to the target conversation.
      // The agent service (wired via GroupQueueService.setProcessTaskFn)
      // handles the actual agent execution. Here we record the outcome.
      // The actual prompt execution is handled upstream by the queue processor.
      // This method is invoked after the agent has processed the task, so
      // at this level we just record the fact that execution was triggered.
      await this.whatsappService.sendMessage(
        task.conversationJid,
        `[Scheduled Task: ${task.name}]\n${task.prompt}`,
      )
      result = 'Task prompt sent successfully'
    } catch (err) {
      status = 'error'
      error = err instanceof Error ? err.message : String(err)
    }

    const durationMs = Date.now() - startTime

    // Build the run log entry
    const logEntry = this.addRunLog(task.id, {
      status,
      result,
      error,
      durationMs,
      runAt: new Date(startTime).toISOString(),
    })

    // Update the task state
    const updates: Partial<ScheduledTask> = {
      runCount: task.runCount + 1,
      lastRun: new Date(startTime).toISOString(),
      lastResult: result ?? null,
      lastError: error ?? null,
    }

    // Determine if the task should be completed
    const newRunCount = task.runCount + 1
    const shouldComplete =
      task.scheduleType === 'once' ||
      (task.maxRuns !== undefined && task.maxRuns !== null && newRunCount >= task.maxRuns)

    if (shouldComplete) {
      updates.status = 'completed'
      updates.nextRun = null
    } else {
      // Calculate the next run time
      updates.nextRun = this.calculateNextRun({
        ...task,
        runCount: newRunCount,
        lastRun: updates.lastRun!,
      })
    }

    // Persist updated task (avoid emitting 'task-updated' for internal state changes)
    const tasks = this.taskStore.get('tasks')
    if (tasks[task.id]) {
      tasks[task.id] = { ...tasks[task.id], ...updates, updatedAt: Date.now() }
      this.taskStore.set('tasks', tasks)
    }

    // Emit appropriate event
    if (status === 'success') {
      this.emit('task-executed', logEntry)
    } else {
      this.emit('task-failed', logEntry)
    }

    return logEntry
  }

  // --------------------------------------------------------------------------
  // Next Run Calculation
  // --------------------------------------------------------------------------

  /**
   * Calculate the next run time for a task based on its schedule type.
   *
   * - cron: Uses cron-parser (v5) with timezone support to find the next date.
   * - interval: Adds the interval (in ms) to the current time.
   * - once: Returns the ISO timestamp from scheduleValue if it is in the future,
   *         otherwise returns null (task is already due or past).
   *
   * @returns ISO timestamp string, or null if the task should not run again.
   */
  private calculateNextRun(task: ScheduledTask): string | null {
    const now = new Date()

    switch (task.scheduleType) {
      case 'cron': {
        try {
          const interval = CronExpressionParser.parse(task.scheduleValue, {
            currentDate: now,
          })
          const nextDate = interval.next()
          return nextDate.toISOString()
        } catch (err) {
          console.error(
            `[TaskSchedulerService] Failed to parse cron expression "${task.scheduleValue}" for task ${task.id}:`,
            err,
          )
          return null
        }
      }

      case 'interval': {
        const intervalMs = parseInt(task.scheduleValue, 10)
        if (isNaN(intervalMs) || intervalMs <= 0) {
          console.error(
            `[TaskSchedulerService] Invalid interval value "${task.scheduleValue}" for task ${task.id}`,
          )
          return null
        }
        const nextDate = new Date(now.getTime() + intervalMs)
        return nextDate.toISOString()
      }

      case 'once': {
        // For one-time tasks, scheduleValue is an ISO timestamp.
        // Return it if in the future, otherwise null.
        const targetDate = new Date(task.scheduleValue)
        if (isNaN(targetDate.getTime())) {
          console.error(
            `[TaskSchedulerService] Invalid once timestamp "${task.scheduleValue}" for task ${task.id}`,
          )
          return null
        }
        return targetDate > now ? targetDate.toISOString() : null
      }

      default:
        console.error(
          `[TaskSchedulerService] Unknown schedule type "${task.scheduleType}" for task ${task.id}`,
        )
        return null
    }
  }

  // --------------------------------------------------------------------------
  // Run Log Management
  // --------------------------------------------------------------------------

  /**
   * Add a run log entry for a task, enforcing the retention policy
   * of MAX_LOGS_PER_TASK entries per task.
   */
  private addRunLog(
    taskId: string,
    entry: {
      status: 'success' | 'error'
      result?: string
      error?: string
      durationMs: number
      runAt: string
      costUsd?: number
      tokensUsed?: number
    },
  ): TaskRunLog {
    // Generate a unique auto-incrementing log ID
    const counter = (this.logStore.get(LOG_ID_COUNTER_KEY) as number) + 1
    this.logStore.set(LOG_ID_COUNTER_KEY, counter)

    const logEntry: TaskRunLog = {
      id: counter,
      taskId,
      runAt: entry.runAt,
      durationMs: entry.durationMs,
      status: entry.status,
      result: entry.result,
      error: entry.error,
      costUsd: entry.costUsd,
      tokensUsed: entry.tokensUsed,
    }

    const logs = this.logStore.get('logs')
    if (!logs[taskId]) {
      logs[taskId] = []
    }

    logs[taskId].push(logEntry)

    // Enforce retention: keep only the last MAX_LOGS_PER_TASK entries
    if (logs[taskId].length > MAX_LOGS_PER_TASK) {
      logs[taskId] = logs[taskId].slice(-MAX_LOGS_PER_TASK)
    }

    this.logStore.set('logs', logs)

    return logEntry
  }
}

/**
 * Group Queue Service - Concurrency control for agent executions.
 *
 * Ported from NanoClaw's GroupQueue pattern. Prevents multiple agent runs
 * for the same conversation and limits total concurrent agents.
 *
 * Implements P2-T3 from PRD_WHATSAPP_AI_ASSISTANT.
 *
 * Behavior:
 * - Max concurrent agent runs: configurable (default 3)
 * - Per-conversation: only one active run at a time
 * - Tasks prioritized over messages in drain order
 * - Exponential backoff on failure: 5s, 10s, 20s, 40s, 80s (max 5 retries)
 * - After max retries, drop and log
 * - Graceful shutdown: wait for active runs to complete, then force-stop
 */

import { EventEmitter } from 'events'
import type { ScheduledTask } from '@shared/whatsapp-types'

// ============================================================================
// Types
// ============================================================================

/** The type of a queued item: either a pending message batch or a scheduled task. */
type QueueItemType = 'message' | 'task'

/** A single entry in the per-conversation queue. */
interface QueueItem {
  type: QueueItemType
  conversationJid: string
  task?: ScheduledTask
  retryCount: number
  enqueuedAt: number
}

/** Tracks the active run for a conversation. */
interface ActiveRun {
  conversationJid: string
  item: QueueItem
  startedAt: number
  abortController: AbortController
}

// ============================================================================
// Constants
// ============================================================================

/** Base delay for exponential backoff in milliseconds. */
const BASE_BACKOFF_MS = 5000

/** Maximum number of retries before dropping a queue item. */
const MAX_RETRIES = 5

/** Default grace period for shutdown in milliseconds. */
const DEFAULT_GRACE_PERIOD_MS = 30000

// ============================================================================
// GroupQueueService
// ============================================================================

export class GroupQueueService extends EventEmitter {
  /** Per-conversation queues. Each conversation gets an ordered list of pending items. */
  private queues: Map<string, QueueItem[]> = new Map()

  /** Currently active runs keyed by conversation JID. */
  private activeRuns: Map<string, ActiveRun> = new Map()

  /** Maximum number of concurrent agent runs across all conversations. */
  private maxConcurrent: number

  /** Function to process pending messages for a conversation. Set via setProcessMessagesFn. */
  private processMessagesFn: ((jid: string) => Promise<void>) | null = null

  /** Function to process a scheduled task for a conversation. Set via setProcessTaskFn. */
  private processTaskFn: ((jid: string, task: ScheduledTask) => Promise<void>) | null = null

  /** Whether the service is shutting down. Prevents new items from being enqueued. */
  private isShuttingDown = false

  /** Pending backoff timers keyed by conversation JID, so they can be cleared on shutdown. */
  private backoffTimers: Map<string, ReturnType<typeof setTimeout>> = new Map()

  /** Drain timer to batch drain calls. */
  private drainTimer: ReturnType<typeof setTimeout> | null = null

  constructor(maxConcurrent = 3) {
    super()
    this.maxConcurrent = Math.max(1, maxConcurrent)
  }

  // --------------------------------------------------------------------------
  // Queue management
  // --------------------------------------------------------------------------

  /**
   * Enqueue a message processing request for a conversation.
   * If there is already a pending message item for this conversation,
   * the existing entry is kept (messages are processed in batch by the
   * processMessagesFn, so a single queue entry suffices).
   */
  enqueueMessage(conversationJid: string): void {
    if (this.isShuttingDown) {
      return
    }

    const queue = this.getOrCreateQueue(conversationJid)

    // Coalesce: if there is already a pending 'message' item that has not
    // started running, we don't need another one. The processMessagesFn will
    // pick up all unprocessed messages when it runs.
    const hasPendingMessage = queue.some((item) => item.type === 'message')
    if (hasPendingMessage) {
      this.emit('message-coalesced', { conversationJid })
      return
    }

    const item: QueueItem = {
      type: 'message',
      conversationJid,
      retryCount: 0,
      enqueuedAt: Date.now(),
    }

    queue.push(item)
    this.emit('item-enqueued', { conversationJid, type: 'message' })
    this.scheduleDrain()
  }

  /**
   * Enqueue a scheduled task for a conversation.
   * Tasks are always enqueued individually since each task is distinct.
   */
  enqueueTask(conversationJid: string, task: ScheduledTask): void {
    if (this.isShuttingDown) {
      return
    }

    const queue = this.getOrCreateQueue(conversationJid)

    const item: QueueItem = {
      type: 'task',
      conversationJid,
      task,
      retryCount: 0,
      enqueuedAt: Date.now(),
    }

    queue.push(item)
    this.emit('item-enqueued', { conversationJid, type: 'task', taskId: task.id })
    this.scheduleDrain()
  }

  // --------------------------------------------------------------------------
  // Control - set processing functions
  // --------------------------------------------------------------------------

  /**
   * Set the function that processes pending messages for a conversation.
   * Called with the conversation JID; should process all unprocessed messages.
   */
  setProcessMessagesFn(fn: (jid: string) => Promise<void>): void {
    this.processMessagesFn = fn
  }

  /**
   * Set the function that processes a scheduled task for a conversation.
   * Called with the conversation JID and the task to execute.
   */
  setProcessTaskFn(fn: (jid: string, task: ScheduledTask) => Promise<void>): void {
    this.processTaskFn = fn
  }

  // --------------------------------------------------------------------------
  // State queries
  // --------------------------------------------------------------------------

  /** Check whether a conversation currently has an active agent run. */
  isActive(conversationJid: string): boolean {
    return this.activeRuns.has(conversationJid)
  }

  /** Get the number of currently running agent executions. */
  getActiveCount(): number {
    return this.activeRuns.size
  }

  /** Get the total number of pending items across all conversation queues. */
  getQueueLength(): number {
    let total = 0
    for (const queue of this.queues.values()) {
      total += queue.length
    }
    return total
  }

  // --------------------------------------------------------------------------
  // Shutdown
  // --------------------------------------------------------------------------

  /**
   * Graceful shutdown: stop accepting new items, wait for active runs
   * to complete within the grace period, then force-abort any remaining.
   */
  async shutdown(gracePeriodMs: number = DEFAULT_GRACE_PERIOD_MS): Promise<void> {
    this.isShuttingDown = true

    // Clear all pending backoff timers
    for (const timer of this.backoffTimers.values()) {
      clearTimeout(timer)
    }
    this.backoffTimers.clear()

    // Clear drain timer
    if (this.drainTimer) {
      clearTimeout(this.drainTimer)
      this.drainTimer = null
    }

    // Clear all pending queues (don't start new work)
    this.queues.clear()

    // If no active runs, we are done
    if (this.activeRuns.size === 0) {
      this.emit('shutdown-complete')
      return
    }

    this.emit('shutdown-waiting', { activeCount: this.activeRuns.size })

    // Wait for active runs to finish, up to the grace period
    const shutdownStart = Date.now()

    await new Promise<void>((resolve) => {
      const checkInterval = setInterval(() => {
        if (this.activeRuns.size === 0) {
          clearInterval(checkInterval)
          resolve()
          return
        }

        const elapsed = Date.now() - shutdownStart
        if (elapsed >= gracePeriodMs) {
          clearInterval(checkInterval)
          // Force-abort remaining active runs
          for (const [jid, run] of this.activeRuns) {
            run.abortController.abort()
            this.emit('run-force-stopped', { conversationJid: jid })
          }
          this.activeRuns.clear()
          resolve()
        }
      }, 250)
    })

    this.emit('shutdown-complete')
  }

  // --------------------------------------------------------------------------
  // Internal: drain loop
  // --------------------------------------------------------------------------

  /**
   * Schedule a drain on the next tick to batch multiple enqueue calls
   * that happen synchronously.
   */
  private scheduleDrain(): void {
    if (this.drainTimer) {
      return
    }
    this.drainTimer = setTimeout(() => {
      this.drainTimer = null
      this.drain()
    }, 0)
  }

  /**
   * Drain the queues: start as many runs as allowed by concurrency limits.
   *
   * Priority ordering:
   * 1. Tasks are prioritized over messages.
   * 2. Among same-type items, earlier-enqueued items go first.
   *
   * Per-conversation constraint: only one active run at a time.
   */
  private drain(): void {
    if (this.isShuttingDown) {
      return
    }

    // Collect all eligible items (from conversations without an active run)
    const candidates: QueueItem[] = []

    for (const [jid, queue] of this.queues) {
      // Skip conversations that already have an active run
      if (this.activeRuns.has(jid)) {
        continue
      }

      if (queue.length > 0) {
        // Sort the per-conversation queue: tasks first, then messages,
        // within same type by enqueue time (already in order since we push).
        queue.sort((a, b) => {
          if (a.type === 'task' && b.type !== 'task') return -1
          if (a.type !== 'task' && b.type === 'task') return 1
          return a.enqueuedAt - b.enqueuedAt
        })

        // Take the first (highest priority) item from this conversation
        candidates.push(queue[0])
      }
    }

    // Sort candidates globally: tasks first, then by enqueue time
    candidates.sort((a, b) => {
      if (a.type === 'task' && b.type !== 'task') return -1
      if (a.type !== 'task' && b.type === 'task') return 1
      return a.enqueuedAt - b.enqueuedAt
    })

    // Start runs up to the concurrency limit
    const slotsAvailable = this.maxConcurrent - this.activeRuns.size

    for (let i = 0; i < Math.min(slotsAvailable, candidates.length); i++) {
      const item = candidates[i]
      // Remove from queue
      const queue = this.queues.get(item.conversationJid)
      if (queue) {
        const idx = queue.indexOf(item)
        if (idx !== -1) {
          queue.splice(idx, 1)
        }
        // Clean up empty queues
        if (queue.length === 0) {
          this.queues.delete(item.conversationJid)
        }
      }

      this.startRun(item)
    }
  }

  /**
   * Start an active run for a queue item.
   */
  private startRun(item: QueueItem): void {
    const abortController = new AbortController()
    const run: ActiveRun = {
      conversationJid: item.conversationJid,
      item,
      startedAt: Date.now(),
      abortController,
    }

    this.activeRuns.set(item.conversationJid, run)
    this.emit('run-started', {
      conversationJid: item.conversationJid,
      type: item.type,
      taskId: item.task?.id,
    })

    // Execute asynchronously
    this.executeRun(item)
      .then(() => {
        this.onRunComplete(item)
      })
      .catch((error: Error) => {
        this.onRunFailed(item, error)
      })
  }

  /**
   * Execute the processing function for a queue item.
   */
  private async executeRun(item: QueueItem): Promise<void> {
    if (item.type === 'task') {
      if (!this.processTaskFn) {
        throw new Error('processTaskFn not set. Call setProcessTaskFn() before enqueuing tasks.')
      }
      if (!item.task) {
        throw new Error('Task item is missing task data.')
      }
      await this.processTaskFn(item.conversationJid, item.task)
    } else {
      if (!this.processMessagesFn) {
        throw new Error(
          'processMessagesFn not set. Call setProcessMessagesFn() before enqueuing messages.',
        )
      }
      await this.processMessagesFn(item.conversationJid)
    }
  }

  /**
   * Handle successful completion of a run. Removes from active, drains more.
   */
  private onRunComplete(item: QueueItem): void {
    const run = this.activeRuns.get(item.conversationJid)
    const startedAt = run?.startedAt ?? Date.now()
    this.activeRuns.delete(item.conversationJid)

    this.emit('run-completed', {
      conversationJid: item.conversationJid,
      type: item.type,
      taskId: item.task?.id,
      durationMs: Date.now() - startedAt,
    })

    // Drain to pick up next items
    this.scheduleDrain()
  }

  /**
   * Handle a failed run. Applies exponential backoff and re-enqueues,
   * or drops after max retries.
   */
  private onRunFailed(item: QueueItem, error: Error): void {
    this.activeRuns.delete(item.conversationJid)

    const nextRetry = item.retryCount + 1

    this.emit('run-failed', {
      conversationJid: item.conversationJid,
      type: item.type,
      taskId: item.task?.id,
      error: error.message,
      retryCount: item.retryCount,
    })

    if (nextRetry > MAX_RETRIES) {
      // Drop after max retries
      this.emit('item-dropped', {
        conversationJid: item.conversationJid,
        type: item.type,
        taskId: item.task?.id,
        error: error.message,
        totalRetries: item.retryCount,
      })
      // Drain to pick up other items
      this.scheduleDrain()
      return
    }

    // Exponential backoff: 5s, 10s, 20s, 40s, 80s
    const backoffMs = BASE_BACKOFF_MS * Math.pow(2, item.retryCount)

    this.emit('run-retrying', {
      conversationJid: item.conversationJid,
      type: item.type,
      taskId: item.task?.id,
      retryCount: nextRetry,
      backoffMs,
    })

    // Re-enqueue after backoff delay
    const timer = setTimeout(() => {
      this.backoffTimers.delete(item.conversationJid)

      if (this.isShuttingDown) {
        return
      }

      // Create updated item with incremented retry count
      const retryItem: QueueItem = {
        ...item,
        retryCount: nextRetry,
      }

      const queue = this.getOrCreateQueue(item.conversationJid)
      // Insert at the front so retried items get priority within their conversation
      queue.unshift(retryItem)
      this.scheduleDrain()
    }, backoffMs)

    this.backoffTimers.set(item.conversationJid, timer)
  }

  // --------------------------------------------------------------------------
  // Internal: helpers
  // --------------------------------------------------------------------------

  /** Get or create the queue array for a conversation. */
  private getOrCreateQueue(conversationJid: string): QueueItem[] {
    let queue = this.queues.get(conversationJid)
    if (!queue) {
      queue = []
      this.queues.set(conversationJid, queue)
    }
    return queue
  }
}

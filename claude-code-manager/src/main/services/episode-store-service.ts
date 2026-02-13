/**
 * Episode Store Service
 *
 * Implements P1-T1 from the Unified Agent Architecture PRD.
 * Manages episodic memory with synchronous writes and asynchronous background
 * processing via Write-Ahead Log (WAL) pattern.
 *
 * Features:
 * - Synchronous episode writes for immediate consistency
 * - WAL queue for async operations (embeddings, consolidation, etc.)
 * - Background worker with exponential backoff (5s → 30s → 2m → 10m → 1h)
 * - Dead-letter queue after 5 retries
 * - Startup recovery: reprocesses pending/processing entries
 */

import { EventEmitter } from 'events'
import type Database from 'better-sqlite3'

// ============================================================================
// Constants
// ============================================================================

/** Polling interval for WAL processing in milliseconds */
const WAL_POLL_INTERVAL_MS = 5000 // 5 seconds

/** Exponential backoff schedule in milliseconds */
const RETRY_BACKOFF_SCHEDULE = [
  5000, // 5 seconds
  30000, // 30 seconds
  120000, // 2 minutes
  600000, // 10 minutes
  3600000, // 1 hour
]

/** Maximum number of retries before marking as dead */
const MAX_RETRIES = 5

// ============================================================================
// Types
// ============================================================================

export interface Episode {
  id?: number
  session_id: string
  channel: string
  source_id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  metadata_json?: string
  token_count?: number
  embedding?: Buffer
  indexed_at?: number
}

export interface WalEntry {
  id?: number
  episode_id?: number
  operation: WalOperation
  payload_json?: string
  retry_count?: number
  max_retries?: number
  next_retry_at?: number
  status?: WalStatus
  error?: string
  created_at: number
  completed_at?: number
}

export type WalOperation =
  | 'embed_episode'
  | 'index_fts'
  | 'consolidate_facts'
  | 'generate_summary'
  | 'custom'

export type WalStatus = 'pending' | 'processing' | 'completed' | 'dead'

export interface WalStats {
  pending: number
  processing: number
  completed: number
  dead: number
}

export interface EpisodeQueryOptions {
  session_id?: string
  channel?: string
  source_id?: string
  since?: number
  limit?: number
}

// ============================================================================
// EpisodeStoreService
// ============================================================================

export class EpisodeStoreService extends EventEmitter {
  private db: Database.Database
  private backgroundWorkerTimer: NodeJS.Timeout | null = null
  private isProcessing = false

  // Prepared statements cache
  private stmts: {
    insertEpisode?: Database.Statement
    insertWalEntry?: Database.Statement
    getEpisodeById?: Database.Statement
    getEpisodesBySession?: Database.Statement
    getEpisodesByChannel?: Database.Statement
    getWalPending?: Database.Statement
    updateWalStatus?: Database.Statement
    updateWalRetry?: Database.Statement
    updateWalCompleted?: Database.Statement
    updateWalDead?: Database.Statement
    countWalByStatus?: Database.Statement
    reprocessStuckEntries?: Database.Statement
  } = {}

  constructor(db: Database.Database) {
    super()
    this.db = db
    this.prepareStatements()
  }

  // ==========================================================================
  // Initialization
  // ==========================================================================

  /**
   * Prepare reusable SQL statements for performance.
   */
  private prepareStatements(): void {
    this.stmts.insertEpisode = this.db.prepare(`
      INSERT INTO episodes (
        session_id, channel, source_id, role, content, timestamp, metadata_json, token_count
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)

    this.stmts.insertWalEntry = this.db.prepare(`
      INSERT INTO memory_wal (
        episode_id, operation, payload_json, retry_count, max_retries, next_retry_at, status, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)

    this.stmts.getEpisodeById = this.db.prepare(`
      SELECT * FROM episodes WHERE id = ?
    `)

    this.stmts.getEpisodesBySession = this.db.prepare(`
      SELECT * FROM episodes
      WHERE session_id = ?
      ORDER BY timestamp ASC
      LIMIT ?
    `)

    this.stmts.getEpisodesByChannel = this.db.prepare(`
      SELECT * FROM episodes
      WHERE channel = ? AND source_id = ? AND timestamp >= ?
      ORDER BY timestamp ASC
      LIMIT ?
    `)

    this.stmts.getWalPending = this.db.prepare(`
      SELECT * FROM memory_wal
      WHERE status IN ('pending', 'processing')
        AND (next_retry_at IS NULL OR next_retry_at <= ?)
      ORDER BY created_at ASC
      LIMIT 10
    `)

    this.stmts.updateWalStatus = this.db.prepare(`
      UPDATE memory_wal
      SET status = ?, next_retry_at = ?
      WHERE id = ?
    `)

    this.stmts.updateWalRetry = this.db.prepare(`
      UPDATE memory_wal
      SET retry_count = ?, next_retry_at = ?, status = 'pending', error = ?
      WHERE id = ?
    `)

    this.stmts.updateWalCompleted = this.db.prepare(`
      UPDATE memory_wal
      SET status = 'completed', completed_at = ?
      WHERE id = ?
    `)

    this.stmts.updateWalDead = this.db.prepare(`
      UPDATE memory_wal
      SET status = 'dead', error = ?
      WHERE id = ?
    `)

    this.stmts.countWalByStatus = this.db.prepare(`
      SELECT status, COUNT(*) as count
      FROM memory_wal
      GROUP BY status
    `)

    this.stmts.reprocessStuckEntries = this.db.prepare(`
      UPDATE memory_wal
      SET status = 'pending', next_retry_at = ?
      WHERE status = 'processing'
    `)
  }

  /**
   * Start the background worker and recover any stuck entries from previous session.
   */
  startBackgroundWorker(): void {
    if (this.backgroundWorkerTimer) {
      throw new Error('Background worker already started')
    }

    // Recover stuck entries from previous session (anything left in 'processing' state)
    const now = Date.now()
    const info = this.stmts.reprocessStuckEntries!.run(now)
    const recoveredCount = info.changes

    if (recoveredCount > 0) {
      this.emit('wal-recovery', { count: recoveredCount })
    }

    // Start polling loop
    this.backgroundWorkerTimer = setInterval(() => {
      this.processWalEntries().catch((error) => {
        this.emit('wal-error', { error: String(error) })
      })
    }, WAL_POLL_INTERVAL_MS)

    this.emit('worker-started')
  }

  /**
   * Stop the background worker gracefully.
   */
  stopBackgroundWorker(): void {
    if (this.backgroundWorkerTimer) {
      clearInterval(this.backgroundWorkerTimer)
      this.backgroundWorkerTimer = null
    }

    this.emit('worker-stopped')
  }

  // ==========================================================================
  // Episode Operations (Synchronous)
  // ==========================================================================

  /**
   * Insert an episode synchronously. This is the main write path for all
   * messages and should complete in <1ms.
   *
   * @returns Episode ID
   */
  insertEpisode(
    session_id: string,
    channel: string,
    source_id: string,
    role: 'user' | 'assistant' | 'system',
    content: string,
    metadata?: Record<string, unknown>
  ): number {
    const timestamp = Date.now()
    const metadata_json = metadata ? JSON.stringify(metadata) : null
    const token_count = this.estimateTokenCount(content)

    const info = this.stmts.insertEpisode!.run(
      session_id,
      channel,
      source_id,
      role,
      content,
      timestamp,
      metadata_json,
      token_count
    )

    const episodeId = info.lastInsertRowid as number

    this.emit('episode-created', {
      episodeId,
      session_id,
      channel,
      source_id,
      role,
    })

    return episodeId
  }

  /**
   * Insert a WAL entry for asynchronous processing.
   * This queues work to be done by the background worker.
   *
   * @returns WAL entry ID
   */
  insertWalEntry(
    episode_id: number | null,
    operation: WalOperation,
    payload?: Record<string, unknown>
  ): number {
    const now = Date.now()
    const payload_json = payload ? JSON.stringify(payload) : null

    const info = this.stmts.insertWalEntry!.run(
      episode_id,
      operation,
      payload_json,
      0, // retry_count
      MAX_RETRIES, // max_retries
      now, // next_retry_at (process immediately)
      'pending', // status
      now // created_at
    )

    const walId = info.lastInsertRowid as number

    this.emit('wal-entry-created', { walId, operation, episode_id })

    return walId
  }

  // ==========================================================================
  // Episode Queries
  // ==========================================================================

  /**
   * Get a single episode by ID.
   */
  getEpisodeById(id: number): Episode | null {
    const row = this.stmts.getEpisodeById!.get(id) as Episode | undefined
    return row ?? null
  }

  /**
   * Get all episodes for a session, ordered by timestamp.
   */
  getEpisodesBySession(session_id: string, limit = 1000): Episode[] {
    const rows = this.stmts.getEpisodesBySession!.all(
      session_id,
      limit
    ) as Episode[]
    return rows
  }

  /**
   * Get episodes for a specific channel/source, optionally filtered by time.
   */
  getEpisodesByChannel(
    channel: string,
    source_id: string,
    since = 0,
    limit = 1000
  ): Episode[] {
    const rows = this.stmts.getEpisodesByChannel!.all(
      channel,
      source_id,
      since,
      limit
    ) as Episode[]
    return rows
  }

  // ==========================================================================
  // WAL Processing (Background Worker)
  // ==========================================================================

  /**
   * Process pending WAL entries. This runs in a loop every 5 seconds.
   * Implements exponential backoff and dead-letter queue.
   */
  async processWalEntries(): Promise<void> {
    if (this.isProcessing) {
      // Skip if already processing to avoid concurrent execution
      return
    }

    this.isProcessing = true

    try {
      const now = Date.now()
      const entries = this.stmts.getWalPending!.all(now) as WalEntry[]

      if (entries.length === 0) {
        return
      }

      this.emit('wal-processing-started', { count: entries.length })

      for (const entry of entries) {
        await this.processWalEntry(entry)
      }

      this.emit('wal-processing-completed', { count: entries.length })
    } catch (error) {
      this.emit('wal-processing-error', { error: String(error) })
    } finally {
      this.isProcessing = false
    }
  }

  /**
   * Process a single WAL entry with error handling and retry logic.
   */
  private async processWalEntry(entry: WalEntry): Promise<void> {
    const entryId = entry.id!

    try {
      // Mark as processing
      this.stmts.updateWalStatus!.run('processing', null, entryId)

      // Execute the operation
      await this.executeWalOperation(entry)

      // Mark as completed
      this.stmts.updateWalCompleted!.run(Date.now(), entryId)

      this.emit('wal-entry-completed', { walId: entryId, operation: entry.operation })
    } catch (error) {
      const errorMessage = String(error)
      const retryCount = (entry.retry_count ?? 0) + 1

      // Check if we should retry or move to dead-letter queue
      if (retryCount >= MAX_RETRIES) {
        this.stmts.updateWalDead!.run(errorMessage, entryId)
        this.emit('wal-entry-dead', {
          walId: entryId,
          operation: entry.operation,
          error: errorMessage,
        })
      } else {
        // Calculate next retry time using exponential backoff
        const backoffMs = RETRY_BACKOFF_SCHEDULE[retryCount - 1] ?? RETRY_BACKOFF_SCHEDULE[RETRY_BACKOFF_SCHEDULE.length - 1]
        const nextRetryAt = Date.now() + backoffMs

        this.stmts.updateWalRetry!.run(
          retryCount,
          nextRetryAt,
          errorMessage,
          entryId
        )

        this.emit('wal-entry-retry', {
          walId: entryId,
          operation: entry.operation,
          retryCount,
          nextRetryAt,
          error: errorMessage,
        })
      }
    }
  }

  /**
   * Execute a WAL operation. This is where the actual async work happens.
   * Override this method or listen to events to implement custom operations.
   */
  private async executeWalOperation(entry: WalEntry): Promise<void> {
    const payload = entry.payload_json ? JSON.parse(entry.payload_json) : {}

    // Emit event for external handlers to process
    // External services can listen to 'wal-operation' and handle specific operations
    this.emit('wal-operation', {
      walId: entry.id,
      operation: entry.operation,
      episodeId: entry.episode_id,
      payload,
    })

    // Built-in operations can be handled here
    switch (entry.operation) {
      case 'embed_episode':
        // Will be implemented by integration code
        break
      case 'index_fts':
        // Will be implemented by integration code
        break
      case 'consolidate_facts':
        // Will be implemented by integration code
        break
      case 'generate_summary':
        // Will be implemented by integration code
        break
      case 'custom':
        // Custom operations handled by event listeners
        break
      default:
        throw new Error(`Unknown WAL operation: ${entry.operation}`)
    }

    // For now, all operations are delegated to external handlers via events
    // The WAL entry will be marked completed after event handlers finish
  }

  // ==========================================================================
  // Statistics
  // ==========================================================================

  /**
   * Get WAL statistics (pending, processing, completed, dead).
   */
  getWalStats(): WalStats {
    const rows = this.stmts.countWalByStatus!.all() as Array<{
      status: WalStatus
      count: number
    }>

    const stats: WalStats = {
      pending: 0,
      processing: 0,
      completed: 0,
      dead: 0,
    }

    for (const row of rows) {
      stats[row.status] = row.count
    }

    return stats
  }

  // ==========================================================================
  // Utilities
  // ==========================================================================

  /**
   * Estimate token count using character approximation (4 chars ~ 1 token).
   */
  private estimateTokenCount(text: string): number {
    return Math.ceil(text.length / 4)
  }
}

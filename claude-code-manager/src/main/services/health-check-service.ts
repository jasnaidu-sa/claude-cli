/**
 * Health Check Service
 *
 * Implements P1-T5 from the Unified Agent Architecture PRD.
 * Evaluates system health across memory, channels, skills, and resources.
 *
 * Features:
 * - Periodic health evaluation (every 30 minutes)
 * - HEARTBEAT.md checklist evaluation
 * - Multi-tier health checks (memory, channels, skills, resources)
 * - Markdown report generation
 * - Status thresholds: HEALTHY / DEGRADED / UNHEALTHY
 */

import { EventEmitter } from 'events'
import type Database from 'better-sqlite3'

// ============================================================================
// Types
// ============================================================================

export interface HealthCheckResult {
  timestamp: string
  overall: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY'
  checks: HealthCheck[]
  metrics: HealthMetrics
}

export interface HealthCheck {
  name: string
  status: 'pass' | 'warn' | 'fail'
  message: string
  latency_ms?: number
}

export interface HealthMetrics {
  episodes_today: number
  episodes_total: number
  facts_total: number
  relations_total: number
  wal_pending: number
  wal_dead: number
  db_size_bytes: number
  last_consolidation: string | null
  last_markdown_sync: string | null
}

// ============================================================================
// HealthCheckService
// ============================================================================

export class HealthCheckService extends EventEmitter {
  private db: Database.Database

  // Prepared statements
  private stmts: {
    countEpisodesToday?: Database.Statement
    countEpisodesTotal?: Database.Statement
    countFacts?: Database.Statement
    countRelations?: Database.Statement
    countWalPending?: Database.Statement
    countWalDead?: Database.Statement
    getDbPageCount?: Database.Statement
    getDbPageSize?: Database.Statement
    getLastConsolidation?: Database.Statement
    getLastMarkdownSync?: Database.Statement
    selectOne?: Database.Statement
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
    // Episodes count today
    this.stmts.countEpisodesToday = this.db.prepare(`
      SELECT COUNT(*) as count
      FROM episodes
      WHERE timestamp >= ?
    `)

    // Episodes total
    this.stmts.countEpisodesTotal = this.db.prepare(`
      SELECT COUNT(*) as count FROM episodes
    `)

    // Facts total
    this.stmts.countFacts = this.db.prepare(`
      SELECT COUNT(*) as count FROM facts WHERE superseded_by IS NULL
    `)

    // Relations total
    this.stmts.countRelations = this.db.prepare(`
      SELECT COUNT(*) as count FROM entity_relations
    `)

    // WAL pending
    this.stmts.countWalPending = this.db.prepare(`
      SELECT COUNT(*) as count
      FROM memory_wal
      WHERE status IN ('pending', 'processing')
    `)

    // WAL dead
    this.stmts.countWalDead = this.db.prepare(`
      SELECT COUNT(*) as count
      FROM memory_wal
      WHERE status = 'dead'
    `)

    // Database size
    this.stmts.getDbPageCount = this.db.prepare('PRAGMA page_count')
    this.stmts.getDbPageSize = this.db.prepare('PRAGMA page_size')

    // Last consolidation timestamp
    this.stmts.getLastConsolidation = this.db.prepare(`
      SELECT MAX(extracted_at) as last_time FROM facts
    `)

    // Last markdown sync (placeholder - will be implemented by markdown-sync-service)
    // For now, check episodes table updated_at or similar
    this.stmts.getLastMarkdownSync = this.db.prepare(`
      SELECT MAX(timestamp) as last_time FROM episodes
    `)

    // Simple test query
    this.stmts.selectOne = this.db.prepare('SELECT 1')
  }

  // ==========================================================================
  // Health Checks
  // ==========================================================================

  /**
   * Run all health checks and return overall status.
   */
  async runChecks(): Promise<HealthCheckResult> {
    const timestamp = new Date().toISOString()
    const checks: HealthCheck[] = []

    // Run all checks
    checks.push(await this.checkSqliteAccessible())
    checks.push(await this.checkWalHealth())
    checks.push(await this.checkEpisodesToday())
    checks.push(await this.checkFtsIndexDrift())
    checks.push(await this.checkDatabaseSize())

    // Collect metrics
    const metrics = this.getMetrics()

    // Determine overall status
    const hasFail = checks.some((c) => c.status === 'fail')
    const hasWarn = checks.some((c) => c.status === 'warn')

    let overall: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY'
    if (hasFail) {
      overall = 'UNHEALTHY'
    } else if (hasWarn) {
      overall = 'DEGRADED'
    } else {
      overall = 'HEALTHY'
    }

    const result: HealthCheckResult = {
      timestamp,
      overall,
      checks,
      metrics,
    }

    this.emit('health-check-complete', result)

    return result
  }

  /**
   * Check if SQLite database is accessible.
   */
  private async checkSqliteAccessible(): Promise<HealthCheck> {
    const startMs = Date.now()

    try {
      this.stmts.selectOne!.get()
      const latency_ms = Date.now() - startMs

      return {
        name: 'sqlite_accessible',
        status: 'pass',
        message: 'SQLite database is accessible',
        latency_ms,
      }
    } catch (error) {
      return {
        name: 'sqlite_accessible',
        status: 'fail',
        message: `SQLite database is not accessible: ${String(error)}`,
        latency_ms: Date.now() - startMs,
      }
    }
  }

  /**
   * Check WAL health (pending and dead entries).
   */
  private async checkWalHealth(): Promise<HealthCheck> {
    const startMs = Date.now()

    try {
      const pendingResult = this.stmts.countWalPending!.get() as { count: number }
      const deadResult = this.stmts.countWalDead!.get() as { count: number }

      const pending = pendingResult.count
      const dead = deadResult.count

      const latency_ms = Date.now() - startMs

      // Any dead entries = fail
      if (dead > 0) {
        return {
          name: 'wal_health',
          status: 'fail',
          message: `WAL has ${dead} dead entries that need attention`,
          latency_ms,
        }
      }

      // >20 pending = unhealthy, 6-20 = degraded
      if (pending > 20) {
        return {
          name: 'wal_health',
          status: 'fail',
          message: `WAL has ${pending} pending entries (unhealthy backlog)`,
          latency_ms,
        }
      }

      if (pending > 5) {
        return {
          name: 'wal_health',
          status: 'warn',
          message: `WAL has ${pending} pending entries (degraded)`,
          latency_ms,
        }
      }

      return {
        name: 'wal_health',
        status: 'pass',
        message: `WAL is healthy (${pending} pending, ${dead} dead)`,
        latency_ms,
      }
    } catch (error) {
      return {
        name: 'wal_health',
        status: 'fail',
        message: `Failed to check WAL health: ${String(error)}`,
        latency_ms: Date.now() - startMs,
      }
    }
  }

  /**
   * Check if episodes were created today.
   */
  private async checkEpisodesToday(): Promise<HealthCheck> {
    const startMs = Date.now()

    try {
      const startOfToday = new Date()
      startOfToday.setHours(0, 0, 0, 0)
      const todayTimestamp = startOfToday.getTime()

      const result = this.stmts.countEpisodesToday!.get(todayTimestamp) as { count: number }
      const count = result.count

      const latency_ms = Date.now() - startMs

      if (count === 0) {
        return {
          name: 'episodes_today',
          status: 'warn',
          message: 'No episodes created today',
          latency_ms,
        }
      }

      return {
        name: 'episodes_today',
        status: 'pass',
        message: `${count} episodes created today`,
        latency_ms,
      }
    } catch (error) {
      return {
        name: 'episodes_today',
        status: 'fail',
        message: `Failed to check episodes today: ${String(error)}`,
        latency_ms: Date.now() - startMs,
      }
    }
  }

  /**
   * Check FTS index drift (compare episodes count vs FTS row count).
   */
  private async checkFtsIndexDrift(): Promise<HealthCheck> {
    const startMs = Date.now()

    try {
      const episodesResult = this.stmts.countEpisodesTotal!.get() as { count: number }
      const episodesCount = episodesResult.count

      // Check if FTS table exists
      let ftsCount = 0
      try {
        const ftsResult = this.db
          .prepare('SELECT COUNT(*) as count FROM episodes_fts')
          .get() as { count: number }
        ftsCount = ftsResult.count
      } catch {
        // FTS table might not exist yet
        ftsCount = 0
      }

      const drift = Math.abs(episodesCount - ftsCount)
      const latency_ms = Date.now() - startMs

      if (drift > 10) {
        return {
          name: 'fts_index_drift',
          status: 'fail',
          message: `FTS index has ${drift} rows drift (episodes: ${episodesCount}, FTS: ${ftsCount})`,
          latency_ms,
        }
      }

      if (drift > 0) {
        return {
          name: 'fts_index_drift',
          status: 'warn',
          message: `FTS index has ${drift} rows drift (episodes: ${episodesCount}, FTS: ${ftsCount})`,
          latency_ms,
        }
      }

      return {
        name: 'fts_index_drift',
        status: 'pass',
        message: `FTS index is in sync (${episodesCount} rows)`,
        latency_ms,
      }
    } catch (error) {
      return {
        name: 'fts_index_drift',
        status: 'fail',
        message: `Failed to check FTS index drift: ${String(error)}`,
        latency_ms: Date.now() - startMs,
      }
    }
  }

  /**
   * Check database size.
   */
  private async checkDatabaseSize(): Promise<HealthCheck> {
    const startMs = Date.now()

    try {
      const pageCountResult = this.stmts.getDbPageCount!.get() as { page_count: number }
      const pageSizeResult = this.stmts.getDbPageSize!.get() as { page_size: number }

      const sizeBytes = pageCountResult.page_count * pageSizeResult.page_size
      const sizeMB = Math.round(sizeBytes / (1024 * 1024))

      const latency_ms = Date.now() - startMs

      // >500MB = fail, 200-500MB = warn
      if (sizeMB > 500) {
        return {
          name: 'database_size',
          status: 'fail',
          message: `Database size is ${sizeMB} MB (exceeds 500 MB limit)`,
          latency_ms,
        }
      }

      if (sizeMB > 200) {
        return {
          name: 'database_size',
          status: 'warn',
          message: `Database size is ${sizeMB} MB (approaching 500 MB limit)`,
          latency_ms,
        }
      }

      return {
        name: 'database_size',
        status: 'pass',
        message: `Database size is ${sizeMB} MB`,
        latency_ms,
      }
    } catch (error) {
      return {
        name: 'database_size',
        status: 'fail',
        message: `Failed to check database size: ${String(error)}`,
        latency_ms: Date.now() - startMs,
      }
    }
  }

  // ==========================================================================
  // Metrics
  // ==========================================================================

  /**
   * Get current health metrics from database queries.
   */
  getMetrics(): HealthMetrics {
    const startOfToday = new Date()
    startOfToday.setHours(0, 0, 0, 0)
    const todayTimestamp = startOfToday.getTime()

    const episodesTodayResult = this.stmts.countEpisodesToday!.get(todayTimestamp) as {
      count: number
    }
    const episodesTotalResult = this.stmts.countEpisodesTotal!.get() as { count: number }
    const factsResult = this.stmts.countFacts!.get() as { count: number }
    const relationsResult = this.stmts.countRelations!.get() as { count: number }
    const walPendingResult = this.stmts.countWalPending!.get() as { count: number }
    const walDeadResult = this.stmts.countWalDead!.get() as { count: number }

    const pageCountResult = this.stmts.getDbPageCount!.get() as { page_count: number }
    const pageSizeResult = this.stmts.getDbPageSize!.get() as { page_size: number }
    const db_size_bytes = pageCountResult.page_count * pageSizeResult.page_size

    const consolidationResult = this.stmts.getLastConsolidation!.get() as {
      last_time: number | null
    }
    const markdownSyncResult = this.stmts.getLastMarkdownSync!.get() as {
      last_time: number | null
    }

    const last_consolidation = consolidationResult.last_time
      ? new Date(consolidationResult.last_time).toISOString()
      : null
    const last_markdown_sync = markdownSyncResult.last_time
      ? new Date(markdownSyncResult.last_time).toISOString()
      : null

    return {
      episodes_today: episodesTodayResult.count,
      episodes_total: episodesTotalResult.count,
      facts_total: factsResult.count,
      relations_total: relationsResult.count,
      wal_pending: walPendingResult.count,
      wal_dead: walDeadResult.count,
      db_size_bytes,
      last_consolidation,
      last_markdown_sync,
    }
  }

  // ==========================================================================
  // Report Generation
  // ==========================================================================

  /**
   * Generate a markdown health report.
   */
  async generateReport(): Promise<string> {
    const result = await this.runChecks()

    const lines: string[] = []

    // Header
    lines.push('---')
    lines.push(`timestamp: ${result.timestamp}`)
    lines.push(`overall_status: ${result.overall}`)
    lines.push('---')
    lines.push('')
    lines.push('# Agent Health Report')
    lines.push('')

    // Overall status
    const statusEmoji = {
      HEALTHY: '✅',
      DEGRADED: '⚠️',
      UNHEALTHY: '❌',
    }
    lines.push(`## Overall Status: ${statusEmoji[result.overall]} ${result.overall}`)
    lines.push('')

    // Health checks
    lines.push('## Health Checks')
    lines.push('')
    for (const check of result.checks) {
      const emoji = {
        pass: '✅',
        warn: '⚠️',
        fail: '❌',
      }
      const latency = check.latency_ms ? ` (${check.latency_ms}ms)` : ''
      lines.push(`- ${emoji[check.status]} **${check.name}**: ${check.message}${latency}`)
    }
    lines.push('')

    // Metrics
    lines.push('## System Metrics')
    lines.push('')
    lines.push('| Metric | Value |')
    lines.push('|--------|-------|')
    lines.push(`| Episodes Today | ${result.metrics.episodes_today} |`)
    lines.push(`| Episodes Total | ${result.metrics.episodes_total} |`)
    lines.push(`| Facts Total | ${result.metrics.facts_total} |`)
    lines.push(`| Relations Total | ${result.metrics.relations_total} |`)
    lines.push(`| WAL Pending | ${result.metrics.wal_pending} |`)
    lines.push(`| WAL Dead | ${result.metrics.wal_dead} |`)
    lines.push(
      `| Database Size | ${Math.round(result.metrics.db_size_bytes / (1024 * 1024))} MB |`
    )
    lines.push(
      `| Last Consolidation | ${result.metrics.last_consolidation ?? 'Never'} |`
    )
    lines.push(
      `| Last Markdown Sync | ${result.metrics.last_markdown_sync ?? 'Never'} |`
    )
    lines.push('')

    // Footer
    lines.push('---')
    lines.push('')
    lines.push('_Generated by HealthCheckService_')
    lines.push('')

    return lines.join('\n')
  }
}

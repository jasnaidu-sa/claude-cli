/**
 * BVS Database Migration Service
 *
 * Ensures database migrations are not just created as files but are actually
 * applied to the database using Supabase MCP tools.
 *
 * Key responsibilities:
 * - Detect when migrations are created
 * - Use Supabase MCP to apply migrations
 * - Verify migration applied successfully
 * - Rollback on migration failure (optional)
 * - Track migration status in task output
 *
 * Supports:
 * - Supabase migrations
 * - Prisma migrations
 * - Drizzle migrations
 * - Raw SQL migrations
 */

import { EventEmitter } from 'events'
import * as path from 'path'
import * as fs from 'fs/promises'
import { glob } from 'glob'
import type { BvsSection } from '@shared/bvs-types'
import { getBvsSubagentService } from './bvs-subagent-service'

// ============================================================================
// Types
// ============================================================================

export type MigrationProvider = 'supabase' | 'prisma' | 'drizzle' | 'raw_sql' | 'unknown'

export interface DetectedMigration {
  provider: MigrationProvider
  filePath: string
  fileName: string
  timestamp?: string       // Extracted timestamp from filename
  name?: string            // Migration name
  content?: string         // SQL content (for raw SQL)
  isNew: boolean           // Was this file just created in current session?
}

export interface MigrationApplicationResult {
  migration: DetectedMigration
  applied: boolean
  verified: boolean
  error?: string
  schemaChanges?: SchemaChange[]
  duration: number
}

export interface SchemaChange {
  type: 'table' | 'column' | 'index' | 'constraint' | 'function' | 'trigger'
  operation: 'add' | 'modify' | 'drop'
  name: string
  details?: string
}

export interface MigrationReport {
  sectionId: string
  sectionName: string
  timestamp: number
  provider: MigrationProvider
  detectedMigrations: DetectedMigration[]
  applicationResults: MigrationApplicationResult[]
  overallStatus: 'success' | 'partial' | 'failed' | 'skipped'
  summary: string
  totalDuration: number
}

export interface MigrationConfig {
  projectPath: string
  sectionId: string
  sectionName: string
  filesChanged: string[]
  autoApply: boolean           // Actually apply migrations, not just detect
  verifySchema: boolean        // Verify schema changes after apply
  rollbackOnFailure: boolean   // Rollback if migration fails
}

// ============================================================================
// Constants
// ============================================================================

// Migration file patterns by provider
const MIGRATION_PATTERNS = {
  supabase: [
    'supabase/migrations/*.sql',
    'supabase/migrations/**/*.sql',
  ],
  prisma: [
    'prisma/migrations/**/*.sql',
    'prisma/migrations/**/migration.sql',
  ],
  drizzle: [
    'drizzle/*.sql',
    'drizzle/migrations/*.sql',
    'migrations/*.sql',
  ],
} as const

// ============================================================================
// Service
// ============================================================================

export class BvsDatabaseMigrationService extends EventEmitter {
  constructor() {
    super()
  }

  /**
   * Process migrations for a section
   *
   * Called after section execution to detect and apply any new migrations
   */
  async processMigrations(config: MigrationConfig): Promise<MigrationReport> {
    const startTime = Date.now()
    console.log(`[DatabaseMigration] Processing migrations for section: ${config.sectionName}`)

    this.emit('migration-started', {
      sectionId: config.sectionId,
      sectionName: config.sectionName,
    })

    const report: MigrationReport = {
      sectionId: config.sectionId,
      sectionName: config.sectionName,
      timestamp: Date.now(),
      provider: 'unknown',
      detectedMigrations: [],
      applicationResults: [],
      overallStatus: 'skipped',
      summary: 'No migrations detected',
      totalDuration: 0,
    }

    try {
      // 1. Detect provider and migrations
      const { provider, migrations } = await this.detectMigrations(
        config.projectPath,
        config.filesChanged
      )

      report.provider = provider
      report.detectedMigrations = migrations

      if (migrations.length === 0) {
        report.summary = 'No new migrations detected in changed files'
        report.totalDuration = Date.now() - startTime
        return report
      }

      console.log(`[DatabaseMigration] Detected ${migrations.length} migration(s) using ${provider}`)

      // 2. Apply migrations if auto-apply is enabled
      if (config.autoApply) {
        for (const migration of migrations) {
          if (!migration.isNew) {
            console.log(`[DatabaseMigration] Skipping existing migration: ${migration.fileName}`)
            continue
          }

          const result = await this.applyMigration(
            migration,
            config.projectPath,
            config.verifySchema
          )
          report.applicationResults.push(result)

          this.emit('migration-applied', {
            sectionId: config.sectionId,
            migration: migration.fileName,
            applied: result.applied,
            verified: result.verified,
          })

          // Handle failure
          if (!result.applied && config.rollbackOnFailure) {
            console.warn(`[DatabaseMigration] Migration failed, attempting rollback: ${migration.fileName}`)
            // Rollback logic would go here (complex, requires transaction support)
          }
        }
      } else {
        console.log(`[DatabaseMigration] Auto-apply disabled, migrations detected but not applied`)
        report.summary = `Detected ${migrations.length} migration(s) but auto-apply is disabled`
      }

      // 3. Calculate overall status
      const applied = report.applicationResults.filter(r => r.applied).length
      const failed = report.applicationResults.filter(r => !r.applied).length

      if (applied > 0 && failed === 0) {
        report.overallStatus = 'success'
        report.summary = `Successfully applied ${applied} migration(s)`
      } else if (applied > 0 && failed > 0) {
        report.overallStatus = 'partial'
        report.summary = `Applied ${applied} migration(s), ${failed} failed`
      } else if (failed > 0) {
        report.overallStatus = 'failed'
        report.summary = `Failed to apply ${failed} migration(s)`
      }

    } catch (error) {
      console.error('[DatabaseMigration] Error processing migrations:', error)
      report.overallStatus = 'failed'
      report.summary = error instanceof Error ? error.message : 'Unknown error'
    }

    report.totalDuration = Date.now() - startTime

    this.emit('migration-completed', {
      sectionId: config.sectionId,
      status: report.overallStatus,
      migrationsApplied: report.applicationResults.filter(r => r.applied).length,
    })

    return report
  }

  /**
   * Quick check if a section created migration files
   */
  async sectionHasMigrations(
    projectPath: string,
    filesChanged: string[]
  ): Promise<boolean> {
    const allPatterns = [
      ...MIGRATION_PATTERNS.supabase,
      ...MIGRATION_PATTERNS.prisma,
      ...MIGRATION_PATTERNS.drizzle,
    ]

    for (const file of filesChanged) {
      const relativePath = path.relative(projectPath, file)
      for (const pattern of allPatterns) {
        // Simple pattern matching
        if (relativePath.includes('migrations') && relativePath.endsWith('.sql')) {
          return true
        }
      }
    }

    return false
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Detect migration provider and files
   */
  private async detectMigrations(
    projectPath: string,
    filesChanged: string[]
  ): Promise<{ provider: MigrationProvider; migrations: DetectedMigration[] }> {
    const migrations: DetectedMigration[] = []
    let provider: MigrationProvider = 'unknown'

    // Check for Supabase
    try {
      const supabaseFiles = await glob([...MIGRATION_PATTERNS.supabase], {
        cwd: projectPath,
        nodir: true,
      })

      if (supabaseFiles.length > 0) {
        provider = 'supabase'

        for (const file of supabaseFiles) {
          const fullPath = path.join(projectPath, file)
          const isNew = filesChanged.some(f =>
            f.endsWith(file) || path.normalize(f).endsWith(path.normalize(file))
          )

          migrations.push({
            provider: 'supabase',
            filePath: fullPath,
            fileName: path.basename(file),
            timestamp: this.extractTimestamp(path.basename(file)),
            isNew,
          })
        }
      }
    } catch {
      // No Supabase migrations
    }

    // Check for Prisma if no Supabase found
    if (provider === 'unknown') {
      try {
        const prismaFiles = await glob([...MIGRATION_PATTERNS.prisma], {
          cwd: projectPath,
          nodir: true,
        })

        if (prismaFiles.length > 0) {
          provider = 'prisma'

          for (const file of prismaFiles) {
            const fullPath = path.join(projectPath, file)
            const isNew = filesChanged.some(f =>
              f.endsWith(file) || path.normalize(f).endsWith(path.normalize(file))
            )

            migrations.push({
              provider: 'prisma',
              filePath: fullPath,
              fileName: path.basename(file),
              timestamp: this.extractTimestamp(path.dirname(file)),
              isNew,
            })
          }
        }
      } catch {
        // No Prisma migrations
      }
    }

    // Check for Drizzle if neither found
    if (provider === 'unknown') {
      try {
        const drizzleFiles = await glob([...MIGRATION_PATTERNS.drizzle], {
          cwd: projectPath,
          nodir: true,
        })

        if (drizzleFiles.length > 0) {
          provider = 'drizzle'

          for (const file of drizzleFiles) {
            const fullPath = path.join(projectPath, file)
            const isNew = filesChanged.some(f =>
              f.endsWith(file) || path.normalize(f).endsWith(path.normalize(file))
            )

            migrations.push({
              provider: 'drizzle',
              filePath: fullPath,
              fileName: path.basename(file),
              timestamp: this.extractTimestamp(path.basename(file)),
              isNew,
            })
          }
        }
      } catch {
        // No Drizzle migrations
      }
    }

    // Sort by timestamp (newest first)
    migrations.sort((a, b) => {
      if (!a.timestamp || !b.timestamp) return 0
      return a.timestamp.localeCompare(b.timestamp)
    })

    return { provider, migrations }
  }

  /**
   * Extract timestamp from migration filename
   */
  private extractTimestamp(filename: string): string | undefined {
    // Common patterns:
    // - 20240201123456_add_users.sql (Supabase)
    // - 20240201123456_add_users/migration.sql (Prisma)
    // - 0001_add_users.sql (numbered)
    const timestampMatch = filename.match(/(\d{14}|\d{8}_\d{6}|\d{4})/)
    return timestampMatch?.[1]
  }

  /**
   * Apply a single migration using Supabase MCP
   */
  private async applyMigration(
    migration: DetectedMigration,
    projectPath: string,
    verifySchema: boolean
  ): Promise<MigrationApplicationResult> {
    const startTime = Date.now()
    console.log(`[DatabaseMigration] Applying migration: ${migration.fileName}`)

    const result: MigrationApplicationResult = {
      migration,
      applied: false,
      verified: false,
      duration: 0,
    }

    try {
      const subagentService = getBvsSubagentService()

      // Read migration content
      const migrationContent = await fs.readFile(migration.filePath, 'utf-8')

      // Build prompt for subagent to apply migration via Supabase MCP
      const prompt = `Apply a database migration using Supabase MCP tools.

Migration File: ${migration.fileName}
Provider: ${migration.provider}

Migration SQL Content:
\`\`\`sql
${migrationContent}
\`\`\`

Instructions:
1. Use mcp__supabase__apply_migration if available
2. If apply_migration is not available, use mcp__supabase__execute_sql to run the SQL directly
3. After applying, verify the changes were made

${verifySchema ? `
Verification Steps:
1. Query information_schema to verify tables/columns exist
2. For each CREATE TABLE, verify the table exists
3. For each ADD COLUMN, verify the column exists

Example verification query:
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
ORDER BY table_name, ordinal_position;
` : ''}

Output JSON:
{
  "applied": boolean,
  "method": "apply_migration" | "execute_sql" | "failed",
  "verified": boolean,
  "schemaChanges": [
    { "type": "table", "operation": "add", "name": "table_name" }
  ],
  "error": string | null
}`

      const agentResult = await subagentService.spawn({
        type: 'fixer',
        prompt,
        projectPath,
        model: 'haiku',
        maxTurns: 5,
        timeout: 60000,
      })

      if (agentResult.status === 'completed') {
        // Parse the JSON output
        const jsonMatch = agentResult.output.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0])
          result.applied = parsed.applied ?? false
          result.verified = parsed.verified ?? false
          result.error = parsed.error
          result.schemaChanges = parsed.schemaChanges || []
        }
      } else {
        result.error = agentResult.error || 'Migration application failed'
      }

    } catch (error) {
      result.error = error instanceof Error ? error.message : 'Unknown error'
    }

    result.duration = Date.now() - startTime
    return result
  }

  /**
   * Verify schema changes using Supabase MCP
   */
  async verifySchema(
    projectPath: string,
    expectedTables: string[]
  ): Promise<{ verified: boolean; missing: string[]; found: string[] }> {
    const subagentService = getBvsSubagentService()

    const prompt = `Verify database schema using Supabase MCP.

Expected Tables: ${expectedTables.join(', ')}

Instructions:
1. Use mcp__supabase__list_tables to get current tables
2. Or use mcp__supabase__execute_sql to query information_schema
3. Compare with expected tables

Query:
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public';

Output JSON:
{
  "found": ["table1", "table2"],
  "missing": ["expected_but_missing"],
  "verified": boolean
}`

    try {
      const result = await subagentService.spawn({
        type: 'fixer',
        prompt,
        projectPath,
        model: 'haiku',
        maxTurns: 3,
        timeout: 30000,
      })

      if (result.status === 'completed') {
        const jsonMatch = result.output.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0])
          return {
            verified: parsed.verified ?? false,
            found: parsed.found || [],
            missing: parsed.missing || [],
          }
        }
      }
    } catch (error) {
      console.error('[DatabaseMigration] Schema verification failed:', error)
    }

    return {
      verified: false,
      found: [],
      missing: expectedTables,
    }
  }

  /**
   * Format migration report for display
   */
  formatReport(report: MigrationReport): string {
    const lines: string[] = []

    lines.push(`Database Migration Report`)
    lines.push(`${'═'.repeat(50)}`)
    lines.push(``)
    lines.push(`Provider: ${report.provider}`)
    lines.push(`Status: ${report.overallStatus.toUpperCase()}`)
    lines.push(``)

    if (report.detectedMigrations.length > 0) {
      lines.push(`Detected Migrations:`)
      for (const m of report.detectedMigrations) {
        const status = m.isNew ? 'NEW' : 'existing'
        lines.push(`  - ${m.fileName} (${status})`)
      }
      lines.push(``)
    }

    if (report.applicationResults.length > 0) {
      lines.push(`Application Results:`)
      for (const r of report.applicationResults) {
        const status = r.applied ? '✓' : '✗'
        const verified = r.verified ? ' (verified)' : ''
        lines.push(`  ${status} ${r.migration.fileName}${verified}`)
        if (r.error) {
          lines.push(`    Error: ${r.error}`)
        }
        if (r.schemaChanges && r.schemaChanges.length > 0) {
          for (const change of r.schemaChanges) {
            lines.push(`    - ${change.operation.toUpperCase()}: ${change.type} "${change.name}"`)
          }
        }
      }
      lines.push(``)
    }

    lines.push(`Summary: ${report.summary}`)
    lines.push(`Duration: ${report.totalDuration}ms`)

    return lines.join('\n')
  }
}

// ============================================================================
// Singleton
// ============================================================================

let databaseMigrationService: BvsDatabaseMigrationService | null = null

export function getBvsDatabaseMigrationService(): BvsDatabaseMigrationService {
  if (!databaseMigrationService) {
    databaseMigrationService = new BvsDatabaseMigrationService()
  }
  return databaseMigrationService
}

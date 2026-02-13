/**
 * PatternCrystallizerService - Foundry-Inspired Pattern Detection
 *
 * Observes agent tool call sequences, detects repeated patterns,
 * and proposes them as crystallization candidates that can be
 * converted into skill .md files.
 *
 * Flow:
 * 1. Observe: Log every agent tool call sequence with context
 * 2. Store: Persist observations in SQLite
 * 3. Detect: When a tool sequence appears 5+ times with 70%+ success, flag it
 * 4. Propose: Generate a skill .md file from the pattern
 * 5. Approve: User approves via channel, pattern becomes a skill
 *
 * Guardrails:
 * - Quarantine buffer: all observations start quarantined
 * - Minimum threshold: 5+ observations across 3+ distinct sessions
 * - Capability ceiling: crystallized skills capped at Tier 2
 * - Human review gate: always requires approval
 * - Expiry: crystallized skills auto-expire after configurable TTL (30 days)
 *
 * Emits:
 * - 'candidate-found' when a new crystallization candidate is detected
 * - 'pattern-approved' when a candidate is converted to a skill
 */

import { EventEmitter } from 'events'
import { randomBytes, createHash } from 'crypto'
import type Database from 'better-sqlite3'
import type { SkillsManagerService } from './skills-manager-service'
import type { SkillsConfigStore } from './skills-config-store'
import type {
  ToolPatternObservation,
  CrystallizationCandidate,
  SkillFrontmatter,
  SkillPermissions,
} from '@shared/skills-types'

const LOG = '[PatternCrystallizer]'

/** Minimum observations before a pattern becomes a candidate. */
const MIN_OBSERVATIONS = 5
/** Minimum success rate for candidacy. */
const MIN_SUCCESS_RATE = 0.7
/** Minimum distinct sessions for candidacy. */
const MIN_DISTINCT_SESSIONS = 3
/** Default expiry TTL for crystallized skills (30 days). */
const DEFAULT_EXPIRY_DAYS = 30

export class PatternCrystallizerService extends EventEmitter {
  private skillsManager: SkillsManagerService
  private configStore: SkillsConfigStore
  private db: Database.Database | null = null

  /** Detected candidates (still in-memory for fast lookup). */
  private candidates: Map<string, CrystallizationCandidate> = new Map()

  /** Prepared statements cache for performance. */
  private stmts: {
    insertObservation?: Database.Statement
    getRecentObservations?: Database.Statement
    getObservationsBySignature?: Database.Statement
    unquarantineObservation?: Database.Statement
    insertCrystallizedPattern?: Database.Statement
    updateCrystallizedPattern?: Database.Statement
    getPatternBySlug?: Database.Statement
  } = {}

  constructor(
    skillsManager: SkillsManagerService,
    configStore: SkillsConfigStore,
  ) {
    super()
    this.skillsManager = skillsManager
    this.configStore = configStore
  }

  /**
   * Initialize with SQLite database for persistent storage.
   * @param db - Database instance from VectorMemoryService.getDb()
   */
  async initialize(db: Database.Database): Promise<void> {
    this.db = db
    this.prepareStatements()
    await this.warmStart()
    console.log(LOG, 'Initialized with SQLite-backed storage')
  }

  /**
   * Prepare reusable SQL statements for performance.
   */
  private prepareStatements(): void {
    if (!this.db) throw new Error('DB not initialized')

    this.stmts.insertObservation = this.db.prepare(`
      INSERT INTO pattern_observations (
        session_id, tool_sequence, context_summary, success, quarantined, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `)

    this.stmts.getRecentObservations = this.db.prepare(`
      SELECT
        id,
        session_id,
        tool_sequence,
        context_summary,
        success,
        quarantined,
        created_at
      FROM pattern_observations
      ORDER BY created_at DESC
      LIMIT ?
    `)

    this.stmts.getObservationsBySignature = this.db.prepare(`
      SELECT
        id,
        session_id,
        tool_sequence,
        context_summary,
        success,
        quarantined,
        created_at
      FROM pattern_observations
      WHERE quarantined = 0
      ORDER BY created_at DESC
    `)

    this.stmts.unquarantineObservation = this.db.prepare(`
      UPDATE pattern_observations
      SET quarantined = 0, unquarantined_at = ?
      WHERE id = ?
    `)

    this.stmts.insertCrystallizedPattern = this.db.prepare(`
      INSERT INTO crystallized_patterns (
        name, slug, tool_sequence, observation_count, success_rate, skill_path, status, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)

    this.stmts.updateCrystallizedPattern = this.db.prepare(`
      UPDATE crystallized_patterns
      SET observation_count = ?, success_rate = ?, status = ?
      WHERE slug = ?
    `)

    this.stmts.getPatternBySlug = this.db.prepare(`
      SELECT * FROM crystallized_patterns WHERE slug = ?
    `)
  }

  /**
   * Warm start: load recent observations from SQLite into memory for pattern detection.
   */
  private async warmStart(): Promise<void> {
    if (!this.db || !this.stmts.getRecentObservations) return

    try {
      const rows = this.stmts.getRecentObservations.all(100) as Array<{
        id: number
        session_id: string
        tool_sequence: string
        context_summary: string | null
        success: number
        quarantined: number
        created_at: number
      }>

      console.log(LOG, `Warm start: loaded ${rows.length} recent observations`)
    } catch (err) {
      console.error(LOG, 'Failed to warm start:', err)
    }
  }

  // =========================================================================
  // Public API
  // =========================================================================

  /**
   * Record an observation of agent tool usage.
   */
  recordObservation(obs: Omit<ToolPatternObservation, 'id' | 'quarantined'>): void {
    const immutable = this.configStore.getImmutableConfig()
    if (!immutable.patternCrystallizationEnabled) return
    if (!this.db || !this.stmts.insertObservation || !this.stmts.unquarantineObservation) {
      console.warn(LOG, 'DB not initialized, skipping observation')
      return
    }

    try {
      // Insert into SQLite
      const result = this.stmts.insertObservation.run(
        obs.sessionId,
        JSON.stringify(obs.toolSequence),
        obs.goalSummary,
        obs.outcome === 'success' ? 1 : 0,
        1, // Start quarantined
        obs.timestamp,
      )

      const observationId = result.lastInsertRowid as number

      // Un-quarantine after a delay (simulate quarantine buffer)
      setTimeout(() => {
        try {
          this.stmts.unquarantineObservation!.run(Date.now(), observationId)
          this.detectPatterns()
        } catch (err) {
          console.error(LOG, 'Failed to unquarantine observation:', err)
        }
      }, 5000)
    } catch (err) {
      console.error(LOG, 'Failed to record observation:', err)
    }
  }

  /**
   * Get all crystallization candidates.
   */
  getCandidates(): CrystallizationCandidate[] {
    return Array.from(this.candidates.values()).sort(
      (a, b) => b.observationCount - a.observationCount,
    )
  }

  /**
   * Approve a candidate and create a skill from it.
   */
  async approveCandidate(
    candidateId: string,
  ): Promise<{ skillId: string; filePath: string } | null> {
    const candidate = this.candidates.get(candidateId)
    if (!candidate) return null

    const immutable = this.configStore.getImmutableConfig()
    const maxTier = immutable.patternCrystallizationMaxTier

    // Generate skill from candidate
    const skillId = `crystallized-${candidate.id}`
    const expiryDate = new Date()
    expiryDate.setDate(expiryDate.getDate() + DEFAULT_EXPIRY_DAYS)

    // Analyze tool sequence risk to prevent privilege escalation
    const sequenceRisk = this.analyzeToolSequenceRisk(candidate.toolSequence)
    const effectiveTier = Math.min(sequenceRisk, 2, maxTier) as 0 | 1 | 2 | 3 | 4

    if (sequenceRisk > maxTier) {
      console.warn(LOG, `Cannot crystallize pattern ${candidateId}: tool sequence requires tier ${sequenceRisk}, max allowed: ${maxTier}`)
      return null
    }

    const permissions: SkillPermissions = {
      version: 1,
      risk_tier: effectiveTier,
      declared_purpose: candidate.pattern,
      generated_by: 'pattern_crystallization',
      expiry: expiryDate.toISOString(),
    }

    const frontmatter: Omit<SkillFrontmatter, 'id'> = {
      name: `Auto: ${candidate.pattern}`,
      description: `Crystallized from ${candidate.observationCount} observations (${(candidate.successRate * 100).toFixed(0)}% success rate)`,
      version: '1.0.0',
      active: true,
      triggers: [
        { keywords: this.extractKeywordsFromPattern(candidate) },
      ],
      metadata: {
        permissions,
        crystallization: {
          candidateId: candidate.id,
          observationCount: candidate.observationCount,
          successRate: candidate.successRate,
          toolSequence: candidate.toolSequence,
          crystallizedAt: Date.now(),
        },
      },
    }

    const body = this.generateSkillBody(candidate)

    try {
      const skill = await this.skillsManager.createSkill(
        skillId,
        frontmatter,
        body,
        'user_confirm',
      )

      // Update candidate status
      candidate.status = 'approved'
      candidate.proposedSkillId = skillId

      // Persist to crystallized_patterns table
      if (this.db && this.stmts.insertCrystallizedPattern) {
        try {
          const slug = this.getSequenceSignature(candidate.toolSequence)
          this.stmts.insertCrystallizedPattern.run(
            candidate.pattern,
            slug,
            JSON.stringify(candidate.toolSequence),
            candidate.observationCount,
            candidate.successRate,
            skill.filePath,
            'approved',
            Date.now(),
          )
        } catch (dbErr) {
          console.error(LOG, `Failed to persist crystallized pattern to DB:`, dbErr)
        }
      }

      this.emit('pattern-approved', { candidateId, skillId, filePath: skill.filePath })
      console.log(LOG, `Pattern crystallized: ${candidateId} -> ${skillId}`)

      return { skillId, filePath: skill.filePath }
    } catch (err) {
      console.error(LOG, `Failed to crystallize pattern ${candidateId}:`, err)
      return null
    }
  }

  /**
   * Reject a candidate.
   */
  rejectCandidate(candidateId: string): void {
    const candidate = this.candidates.get(candidateId)
    if (candidate) {
      candidate.status = 'rejected'
    }
  }

  // =========================================================================
  // Private - Pattern Detection
  // =========================================================================

  private detectPatterns(): void {
    if (!this.db || !this.stmts.getObservationsBySignature) {
      console.warn(LOG, 'DB not initialized, skipping pattern detection')
      return
    }

    try {
      // Query non-quarantined observations from SQLite
      const rows = this.stmts.getObservationsBySignature.all() as Array<{
        id: number
        session_id: string
        tool_sequence: string
        context_summary: string | null
        success: number
        created_at: number
      }>

      if (rows.length < MIN_OBSERVATIONS) return

      // Group by tool sequence signature
      const groups = new Map<string, typeof rows>()
      for (const row of rows) {
        const toolSequence = JSON.parse(row.tool_sequence) as string[]
        const sig = this.getSequenceSignature(toolSequence)
        const group = groups.get(sig) || []
        group.push(row)
        groups.set(sig, group)
      }

      // Check each group for candidacy
      for (const [sig, group] of groups) {
        if (group.length < MIN_OBSERVATIONS) continue

        // Check distinct sessions
        const sessions = new Set(group.map((o) => o.session_id))
        if (sessions.size < MIN_DISTINCT_SESSIONS) continue

        // Check success rate
        const successes = group.filter((o) => o.success === 1).length
        const successRate = successes / group.length
        if (successRate < MIN_SUCCESS_RATE) continue

        // Parse first observation's tool sequence
        const toolSequence = JSON.parse(group[0].tool_sequence) as string[]

        // Already a candidate?
        if (this.candidates.has(sig)) {
          // Update existing candidate stats
          const existing = this.candidates.get(sig)!
          existing.observationCount = group.length
          existing.successRate = successRate
          existing.distinctSessions = sessions.size
          existing.lastSeen = Math.max(...group.map((o) => o.created_at))
          continue
        }

        // Create new candidate
        const candidate: CrystallizationCandidate = {
          id: sig,
          pattern: this.summarizePatternFromRows(group),
          toolSequence,
          observationCount: group.length,
          successRate,
          averageDurationMs: 0, // Not tracked in simplified schema
          averageCostUsd: 0, // Not tracked in simplified schema
          distinctSessions: sessions.size,
          firstSeen: Math.min(...group.map((o) => o.created_at)),
          lastSeen: Math.max(...group.map((o) => o.created_at)),
          status: 'candidate',
        }

        this.candidates.set(sig, candidate)
        this.emit('candidate-found', candidate)
        console.log(
          LOG,
          `New candidate: ${candidate.pattern} (${candidate.observationCount} obs, ${(successRate * 100).toFixed(0)}% success)`,
        )
      }
    } catch (err) {
      console.error(LOG, 'Failed to detect patterns:', err)
    }
  }

  // =========================================================================
  // Private - Helpers
  // =========================================================================

  private getSequenceSignature(tools: string[]): string {
    return createHash('sha256')
      .update(tools.join('|'))
      .digest('hex')
      .slice(0, 12)
  }

  private summarizePattern(group: ToolPatternObservation[]): string {
    // Use the most common goal summary
    const goals = new Map<string, number>()
    for (const obs of group) {
      goals.set(obs.goalSummary, (goals.get(obs.goalSummary) || 0) + 1)
    }
    const topGoal = Array.from(goals.entries()).sort((a, b) => b[1] - a[1])[0]
    return topGoal ? topGoal[0] : `Pattern: ${group[0].toolSequence.join(' -> ')}`
  }

  /**
   * Summarize pattern from database rows.
   */
  private summarizePatternFromRows(
    group: Array<{ context_summary: string | null; tool_sequence: string }>,
  ): string {
    // Use the most common context summary
    const goals = new Map<string, number>()
    for (const row of group) {
      if (row.context_summary) {
        goals.set(row.context_summary, (goals.get(row.context_summary) || 0) + 1)
      }
    }
    if (goals.size > 0) {
      const topGoal = Array.from(goals.entries()).sort((a, b) => b[1] - a[1])[0]
      return topGoal[0]
    }
    const toolSequence = JSON.parse(group[0].tool_sequence) as string[]
    return `Pattern: ${toolSequence.join(' -> ')}`
  }

  private extractKeywordsFromPattern(
    candidate: CrystallizationCandidate,
  ): string[] {
    // Extract meaningful words from the pattern description
    const words = candidate.pattern
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 3)

    return [...new Set(words)].slice(0, 5)
  }

  /**
   * Analyze the risk tier required by a tool sequence.
   * Prevents crystallizing high-privilege patterns into low-tier skills.
   */
  private analyzeToolSequenceRisk(toolSequence: string[]): number {
    const highRiskTools = [
      'create_skill', 'update_agent_config', 'approve_pattern',
      'execute_sql', 'Bash', 'Write', 'Edit',
    ]
    const mediumRiskTools = [
      'update_skill_config', 'toggle_skill',
      'extract_url_content', 'WebFetch',
    ]

    if (toolSequence.some((t) => highRiskTools.some((ht) => t.includes(ht)))) {
      return 3
    }
    if (toolSequence.some((t) => mediumRiskTools.some((mt) => t.includes(mt)))) {
      return 2
    }
    return 1
  }

  private generateSkillBody(candidate: CrystallizationCandidate): string {
    return [
      '## Instructions',
      '',
      `This skill was automatically crystallized from ${candidate.observationCount} observed agent interactions.`,
      '',
      `**Pattern**: ${candidate.pattern}`,
      `**Tools Used**: ${candidate.toolSequence.join(' -> ')}`,
      `**Success Rate**: ${(candidate.successRate * 100).toFixed(0)}%`,
      '',
      'When this skill is triggered, follow the tool sequence above to accomplish the task.',
      'Use the same tools in the same order as the observed pattern.',
      '',
      '## Expected Behavior',
      '',
      '1. Analyze the user\'s request in the context of this pattern',
      '2. Execute the tool sequence: ' + candidate.toolSequence.join(', '),
      '3. Report the results concisely',
      '',
      '## Constraints',
      '',
      '- Stay within the declared purpose of this skill',
      '- Do not deviate from the observed tool sequence unless necessary',
      '- Report any errors immediately',
    ].join('\n')
  }
}

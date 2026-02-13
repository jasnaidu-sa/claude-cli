/**
 * Semantic Memory Service
 *
 * Implements P1-T6 from the Unified Agent Architecture PRD.
 * Manages facts and entity relations for semantic/schematic memory tier.
 *
 * Features:
 * - Entity-attribute-value triple storage
 * - Entity relations for knowledge graph
 * - Conflict detection and superseding
 * - Prepared statements for performance
 * - Provenance tracking via source_episode_id
 * - Confidence scoring
 */

import { EventEmitter } from 'events'
import type Database from 'better-sqlite3'

// ============================================================================
// Types
// ============================================================================

export interface FactRecord {
  id: number
  entity: string
  attribute: string
  value: string
  confidence: number
  source_episode_id: number | null
  extracted_at: string
  last_confirmed_at: string | null
  superseded_by: number | null
}

export interface EntityRelation {
  id: number
  from_entity: string
  relation: string
  to_entity: string
  weight: number
  source_episode_id: number | null
  created_at: string
}

// ============================================================================
// SemanticMemoryService
// ============================================================================

export class SemanticMemoryService extends EventEmitter {
  private db: Database.Database

  // Prepared statements
  private stmts: {
    insertFact?: Database.Statement
    getFacts?: Database.Statement
    getFactsByEntity?: Database.Statement
    getFactsByAttribute?: Database.Statement
    getFactsByEntityAttribute?: Database.Statement
    insertRelation?: Database.Statement
    getRelationsFrom?: Database.Statement
    getRelationsTo?: Database.Statement
    getRelationsBoth?: Database.Statement
    findConflicts?: Database.Statement
    supersedeFact?: Database.Statement
    countFacts?: Database.Statement
    countRelations?: Database.Statement
  } = {}

  constructor(db: Database.Database) {
    super()
    this.db = db
  }

  // ==========================================================================
  // Initialization
  // ==========================================================================

  /**
   * Initialize and prepare SQL statements.
   */
  async initialize(): Promise<void> {
    this.prepareStatements()
    this.emit('initialized')
  }

  /**
   * Prepare reusable SQL statements for performance.
   */
  private prepareStatements(): void {
    // Insert fact
    this.stmts.insertFact = this.db.prepare(`
      INSERT INTO facts (
        entity, attribute, value, confidence, source_episode_id, extracted_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `)

    // Get all facts (with optional limit)
    this.stmts.getFacts = this.db.prepare(`
      SELECT * FROM facts
      WHERE superseded_by IS NULL
      ORDER BY extracted_at DESC
      LIMIT ?
    `)

    // Get facts by entity
    this.stmts.getFactsByEntity = this.db.prepare(`
      SELECT * FROM facts
      WHERE entity = ? AND superseded_by IS NULL
      ORDER BY extracted_at DESC
      LIMIT ?
    `)

    // Get facts by attribute
    this.stmts.getFactsByAttribute = this.db.prepare(`
      SELECT * FROM facts
      WHERE attribute = ? AND superseded_by IS NULL
      ORDER BY extracted_at DESC
      LIMIT ?
    `)

    // Get facts by entity and attribute
    this.stmts.getFactsByEntityAttribute = this.db.prepare(`
      SELECT * FROM facts
      WHERE entity = ? AND attribute = ? AND superseded_by IS NULL
      ORDER BY extracted_at DESC
      LIMIT ?
    `)

    // Insert relation
    this.stmts.insertRelation = this.db.prepare(`
      INSERT INTO entity_relations (
        from_entity, relation, to_entity, weight, source_episode_id, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `)

    // Get relations from entity
    this.stmts.getRelationsFrom = this.db.prepare(`
      SELECT * FROM entity_relations
      WHERE from_entity = ?
      ORDER BY created_at DESC
    `)

    // Get relations to entity
    this.stmts.getRelationsTo = this.db.prepare(`
      SELECT * FROM entity_relations
      WHERE to_entity = ?
      ORDER BY created_at DESC
    `)

    // Get relations both directions
    this.stmts.getRelationsBoth = this.db.prepare(`
      SELECT * FROM entity_relations
      WHERE from_entity = ? OR to_entity = ?
      ORDER BY created_at DESC
    `)

    // Find conflicts (same entity+attribute, different value, not superseded)
    this.stmts.findConflicts = this.db.prepare(`
      SELECT * FROM facts
      WHERE entity = ? AND attribute = ? AND value != ? AND superseded_by IS NULL
      ORDER BY extracted_at DESC
    `)

    // Supersede a fact
    this.stmts.supersedeFact = this.db.prepare(`
      UPDATE facts
      SET superseded_by = ?
      WHERE id = ?
    `)

    // Count facts
    this.stmts.countFacts = this.db.prepare(`
      SELECT COUNT(*) as count FROM facts WHERE superseded_by IS NULL
    `)

    // Count relations
    this.stmts.countRelations = this.db.prepare(`
      SELECT COUNT(*) as count FROM entity_relations
    `)
  }

  // ==========================================================================
  // Facts Operations
  // ==========================================================================

  /**
   * Insert a new fact into semantic memory.
   *
   * @param entity - Entity identifier (e.g., 'user', 'project:claude-cli')
   * @param attribute - Attribute name (e.g., 'preference', 'capability')
   * @param value - Attribute value
   * @param confidence - Confidence score (0.0 to 1.0, default 1.0)
   * @param sourceEpisodeId - Source episode ID for provenance tracking
   * @returns Fact ID
   */
  insertFact(
    entity: string,
    attribute: string,
    value: string,
    confidence?: number,
    sourceEpisodeId?: number
  ): number {
    const extracted_at = Date.now()
    const confidenceScore = confidence ?? 1.0

    const info = this.stmts.insertFact!.run(
      entity,
      attribute,
      value,
      confidenceScore,
      sourceEpisodeId ?? null,
      extracted_at
    )

    const factId = info.lastInsertRowid as number

    this.emit('fact-inserted', {
      factId,
      entity,
      attribute,
      value,
      confidence: confidenceScore,
    })

    return factId
  }

  /**
   * Get facts, optionally filtered by entity and/or attribute.
   *
   * @param entity - Filter by entity (optional)
   * @param attribute - Filter by attribute (optional)
   * @param limit - Maximum number of results (default 100)
   * @returns Array of fact records
   */
  getFacts(entity?: string, attribute?: string, limit?: number): FactRecord[] {
    const maxLimit = limit ?? 100

    let rows: unknown[]

    if (entity && attribute) {
      rows = this.stmts.getFactsByEntityAttribute!.all(entity, attribute, maxLimit)
    } else if (entity) {
      rows = this.stmts.getFactsByEntity!.all(entity, maxLimit)
    } else if (attribute) {
      rows = this.stmts.getFactsByAttribute!.all(attribute, maxLimit)
    } else {
      rows = this.stmts.getFacts!.all(maxLimit)
    }

    return rows as FactRecord[]
  }

  /**
   * Find conflicting facts (same entity+attribute, different value).
   *
   * @param entity - Entity identifier
   * @param attribute - Attribute name
   * @param value - Current value to check against
   * @returns Array of conflicting fact records
   */
  findConflicts(entity: string, attribute: string, value: string): FactRecord[] {
    const rows = this.stmts.findConflicts!.all(entity, attribute, value)
    return rows as FactRecord[]
  }

  /**
   * Supersede an old fact with a new one.
   * Sets the superseded_by field on the old fact.
   *
   * @param oldId - ID of the fact to supersede
   * @param newId - ID of the new fact that supersedes it
   */
  supersedeFact(oldId: number, newId: number): void {
    this.stmts.supersedeFact!.run(newId, oldId)

    this.emit('fact-superseded', {
      oldId,
      newId,
    })
  }

  /**
   * Get count of active facts (not superseded).
   */
  getFactCount(): number {
    const result = this.stmts.countFacts!.get() as { count: number }
    return result.count
  }

  // ==========================================================================
  // Relations Operations
  // ==========================================================================

  /**
   * Insert a new entity relation.
   *
   * @param fromEntity - Source entity
   * @param relation - Relation type (e.g., 'uses', 'prefers', 'depends_on')
   * @param toEntity - Target entity
   * @param weight - Relation weight (default 1.0)
   * @param sourceEpisodeId - Source episode ID for provenance tracking
   * @returns Relation ID
   */
  insertRelation(
    fromEntity: string,
    relation: string,
    toEntity: string,
    weight?: number,
    sourceEpisodeId?: number
  ): number {
    const created_at = Date.now()
    const relationWeight = weight ?? 1.0

    const info = this.stmts.insertRelation!.run(
      fromEntity,
      relation,
      toEntity,
      relationWeight,
      sourceEpisodeId ?? null,
      created_at
    )

    const relationId = info.lastInsertRowid as number

    this.emit('relation-inserted', {
      relationId,
      fromEntity,
      relation,
      toEntity,
      weight: relationWeight,
    })

    return relationId
  }

  /**
   * Get relations for an entity.
   *
   * @param entity - Entity identifier
   * @param direction - Direction of relations ('from', 'to', 'both')
   * @returns Array of entity relations
   */
  getRelations(entity: string, direction?: 'from' | 'to' | 'both'): EntityRelation[] {
    const dir = direction ?? 'both'

    let rows: unknown[]

    if (dir === 'from') {
      rows = this.stmts.getRelationsFrom!.all(entity)
    } else if (dir === 'to') {
      rows = this.stmts.getRelationsTo!.all(entity)
    } else {
      rows = this.stmts.getRelationsBoth!.all(entity, entity)
    }

    return rows as EntityRelation[]
  }

  /**
   * Get count of entity relations.
   */
  getRelationCount(): number {
    const result = this.stmts.countRelations!.get() as { count: number }
    return result.count
  }
}

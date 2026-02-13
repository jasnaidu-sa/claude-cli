/**
 * Vector Memory Service
 *
 * Implements P2-T2 from the WhatsApp AI Assistant PRD.
 * Manages a SQLite database with sqlite-vec for vector search and FTS5 for
 * keyword search, providing hybrid retrieval for long-term memory.
 *
 * Features:
 * - sqlite-vec virtual table for vector KNN search
 * - FTS5 virtual table for BM25 keyword search
 * - Hybrid scoring: finalScore = vectorWeight * vectorScore + textWeight * textScore
 * - Embedding providers: Voyage AI (primary), local @huggingface/transformers (fallback)
 * - Embedding cache by text hash to avoid re-computation
 * - Conversation chunking (3-4 messages with speaker attribution)
 * - Markdown chunking (heading boundaries)
 * - Code chunking (function boundaries)
 * - Deduplication: skip chunks with >0.95 cosine similarity to existing
 * - Conversation archival support
 */

import { EventEmitter } from 'events'
import { createHash } from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import Database from 'better-sqlite3'
import * as sqliteVec from 'sqlite-vec'
import type { ConfigStore } from './config-store'
import type {
  MemorySource,
  MemoryChunk,
  MemorySearchResult,
  MemorySearchOptions,
  VectorMemoryConfig,
  WhatsAppMessage,
} from '@shared/whatsapp-types'

// ============================================================================
// Constants
// ============================================================================

/** Default embedding dimension for MiniLM-L6-v2 / voyage-3.5-lite (384) */
const DEFAULT_EMBEDDING_DIM = 384

/** Maximum cosine similarity threshold for deduplication */
const DEDUP_SIMILARITY_THRESHOLD = 0.95

/** Number of candidate results to fetch before hybrid re-ranking */
const CANDIDATE_MULTIPLIER = 4

/** Approximate tokens per character ratio for chunking estimates */
const CHARS_PER_TOKEN = 4

// ============================================================================
// Types
// ============================================================================

interface EmbeddingCacheRow {
  text_hash: string
  embedding: Buffer
  model: string
  created_at: number
}

interface MemoryChunkRow {
  id: number
  source: string
  source_id: string
  content: string
  metadata: string | null
  embedding_model: string
  created_at: number
  updated_at: number
}

interface VecSearchRow {
  rowid: number
  distance: number
}

interface FtsSearchRow {
  rowid: number
  rank: number
}

interface ArchivedConversationInfo {
  jid: string
  chunkCount: number
  archivedAt: number
}

// ============================================================================
// VectorMemoryService
// ============================================================================

export class VectorMemoryService extends EventEmitter {
  private db: Database.Database | null = null
  private config: VectorMemoryConfig
  private configStore: ConfigStore
  private embeddingDim: number = DEFAULT_EMBEDDING_DIM
  private localPipeline: unknown | null = null
  private localPipelineLoading: Promise<unknown> | null = null

  // Prepared statements cache
  private stmts: {
    insertChunk?: Database.Statement
    insertVec?: Database.Statement
    insertFts?: Database.Statement
    insertCache?: Database.Statement
    getCache?: Database.Statement
    searchVec?: Database.Statement
    searchFts?: Database.Statement
    getChunkById?: Database.Statement
    deleteChunkById?: Database.Statement
    deleteVecById?: Database.Statement
    deleteFtsByRowid?: Database.Statement
    getChunksBySource?: Database.Statement
    countChunks?: Database.Statement
    countSources?: Database.Statement
    exactMatchChunk?: Database.Statement
  } = {}

  constructor(configStore: ConfigStore) {
    super()
    this.configStore = configStore
    this.config = configStore.getWhatsAppConfig().memory
  }

  // ==========================================================================
  // Initialization
  // ==========================================================================

  /**
   * Initialize the database, load sqlite-vec extension, create schema, and
   * prepare reusable statements.
   */
  async initialize(): Promise<void> {
    const dbPath = this.config.dbPath
    const dbDir = path.dirname(dbPath)

    // Ensure directory exists
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true })
    }

    // Open database
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')

    // Load sqlite-vec extension
    sqliteVec.load(this.db)

    // Create schema
    this.createSchema()

    // Prepare statements
    this.prepareStatements()

    this.emit('initialized')
  }

  /**
   * Create all required database tables and indexes.
   */
  private createSchema(): void {
    const db = this.getDb()

    db.exec(`
      -- Memory chunks with text content
      CREATE TABLE IF NOT EXISTS memory_chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        source_id TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata TEXT,
        embedding_model TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- Indexes on memory_chunks
      CREATE INDEX IF NOT EXISTS idx_chunks_source ON memory_chunks(source, source_id);
      CREATE INDEX IF NOT EXISTS idx_chunks_updated ON memory_chunks(updated_at);
    `)

    // sqlite-vec virtual table (must be separate exec - virtual tables don't
    // support IF NOT EXISTS in all versions, so we check manually)
    const vecTableExists = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='memory_vec'"
      )
      .get()

    if (!vecTableExists) {
      db.exec(
        `CREATE VIRTUAL TABLE memory_vec USING vec0(embedding float[${this.embeddingDim}]);`
      )
    }

    // FTS5 virtual table (content-sync with memory_chunks)
    const ftsTableExists = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='memory_fts'"
      )
      .get()

    if (!ftsTableExists) {
      db.exec(`
        CREATE VIRTUAL TABLE memory_fts USING fts5(
          content,
          source,
          source_id,
          content='memory_chunks',
          content_rowid='id'
        );
      `)
    }

    // Embedding cache table
    db.exec(`
      CREATE TABLE IF NOT EXISTS embedding_cache (
        text_hash TEXT PRIMARY KEY,
        embedding BLOB NOT NULL,
        model TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `)

    // ==================================================================
    // NEW UNIFIED AGENT ARCHITECTURE TABLES
    // ==================================================================

    // Episodes table - episodic memory (all messages, sync writes)
    db.exec(`
      CREATE TABLE IF NOT EXISTS episodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        source_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        metadata_json TEXT,
        token_count INTEGER,
        embedding BLOB,
        indexed_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_episodes_session ON episodes(session_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_episodes_channel ON episodes(channel, source_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_episodes_timestamp ON episodes(timestamp);
    `)

    // Episodes vector table for semantic search
    const episodesVecExists = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='episodes_vec'"
      )
      .get()

    if (!episodesVecExists) {
      db.exec(
        `CREATE VIRTUAL TABLE episodes_vec USING vec0(embedding float[${this.embeddingDim}]);`
      )
    }

    // Episodes FTS5 table for keyword search
    const episodesFtsExists = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='episodes_fts'"
      )
      .get()

    if (!episodesFtsExists) {
      db.exec(`
        CREATE VIRTUAL TABLE episodes_fts USING fts5(
          content,
          tokenize='porter'
        );
      `)
    }

    // Memory WAL table - async operations queue with retry logic
    db.exec(`
      CREATE TABLE IF NOT EXISTS memory_wal (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        episode_id INTEGER,
        operation TEXT NOT NULL,
        payload_json TEXT,
        retry_count INTEGER DEFAULT 0,
        max_retries INTEGER DEFAULT 5,
        next_retry_at INTEGER,
        status TEXT DEFAULT 'pending',
        error TEXT,
        created_at INTEGER NOT NULL,
        completed_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_wal_status ON memory_wal(status, next_retry_at);
      CREATE INDEX IF NOT EXISTS idx_wal_episode ON memory_wal(episode_id);
    `)

    // Facts table - semantic memory (extracted knowledge)
    db.exec(`
      CREATE TABLE IF NOT EXISTS facts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity TEXT NOT NULL,
        attribute TEXT NOT NULL,
        value TEXT NOT NULL,
        confidence REAL DEFAULT 1.0,
        source_episode_id INTEGER,
        extracted_at INTEGER NOT NULL,
        last_confirmed_at INTEGER,
        superseded_by INTEGER,
        embedding BLOB
      );

      CREATE INDEX IF NOT EXISTS idx_facts_entity ON facts(entity);
      CREATE INDEX IF NOT EXISTS idx_facts_superseded ON facts(superseded_by);
      CREATE INDEX IF NOT EXISTS idx_facts_source ON facts(source_episode_id);
    `)

    // Entity relations table - knowledge graph edges
    db.exec(`
      CREATE TABLE IF NOT EXISTS entity_relations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_entity TEXT NOT NULL,
        relation TEXT NOT NULL,
        to_entity TEXT NOT NULL,
        weight REAL DEFAULT 1.0,
        source_episode_id INTEGER,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_relations_from ON entity_relations(from_entity);
      CREATE INDEX IF NOT EXISTS idx_relations_to ON entity_relations(to_entity);
    `)

    // Pattern observations table - procedural memory (raw observations)
    db.exec(`
      CREATE TABLE IF NOT EXISTS pattern_observations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        tool_sequence TEXT NOT NULL,
        context_summary TEXT,
        success INTEGER NOT NULL,
        quarantined INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        unquarantined_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_observations_session ON pattern_observations(session_id);
      CREATE INDEX IF NOT EXISTS idx_observations_quarantine ON pattern_observations(quarantined);
      CREATE INDEX IF NOT EXISTS idx_observations_success ON pattern_observations(success);
    `)

    // Crystallized patterns table - procedural memory (learned skills)
    db.exec(`
      CREATE TABLE IF NOT EXISTS crystallized_patterns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        slug TEXT NOT NULL UNIQUE,
        tool_sequence TEXT NOT NULL,
        observation_count INTEGER DEFAULT 0,
        success_rate REAL DEFAULT 0.0,
        skill_path TEXT,
        status TEXT DEFAULT 'candidate',
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_patterns_status ON crystallized_patterns(status);
      CREATE INDEX IF NOT EXISTS idx_patterns_success_rate ON crystallized_patterns(success_rate);
    `)
  }

  /**
   * Prepare reusable SQL statements for performance.
   */
  private prepareStatements(): void {
    const db = this.getDb()

    this.stmts.insertChunk = db.prepare(`
      INSERT INTO memory_chunks (source, source_id, content, metadata, embedding_model, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)

    this.stmts.insertVec = db.prepare(`
      INSERT INTO memory_vec (rowid, embedding)
      VALUES (?, ?)
    `)

    this.stmts.insertFts = db.prepare(`
      INSERT INTO memory_fts (rowid, content, source, source_id)
      VALUES (?, ?, ?, ?)
    `)

    this.stmts.insertCache = db.prepare(`
      INSERT OR REPLACE INTO embedding_cache (text_hash, embedding, model, created_at)
      VALUES (?, ?, ?, ?)
    `)

    this.stmts.getCache = db.prepare(`
      SELECT embedding, model FROM embedding_cache WHERE text_hash = ?
    `)

    this.stmts.searchVec = db.prepare(`
      SELECT rowid, distance FROM memory_vec
      WHERE embedding MATCH ?
      ORDER BY distance
      LIMIT ?
    `)

    this.stmts.searchFts = db.prepare(`
      SELECT rowid, rank FROM memory_fts
      WHERE memory_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `)

    this.stmts.getChunkById = db.prepare(`
      SELECT * FROM memory_chunks WHERE id = ?
    `)

    this.stmts.deleteChunkById = db.prepare(`
      DELETE FROM memory_chunks WHERE id = ?
    `)

    this.stmts.deleteVecById = db.prepare(`
      DELETE FROM memory_vec WHERE rowid = ?
    `)

    this.stmts.deleteFtsByRowid = db.prepare(`
      INSERT INTO memory_fts (memory_fts, rowid, content, source, source_id)
      VALUES ('delete', ?, ?, ?, ?)
    `)

    this.stmts.getChunksBySource = db.prepare(`
      SELECT * FROM memory_chunks WHERE source = ? AND source_id = ?
    `)

    this.stmts.countChunks = db.prepare(`
      SELECT COUNT(*) as count FROM memory_chunks
    `)

    this.stmts.countSources = db.prepare(`
      SELECT COUNT(DISTINCT source_id) as count FROM memory_chunks
    `)

    this.stmts.exactMatchChunk = db.prepare(`
      SELECT id FROM memory_chunks WHERE source = ? AND source_id = ? AND content = ? LIMIT 1
    `)
  }

  /**
   * Get the active database instance, throwing if not initialized.
   */
  public getDb(): Database.Database {
    if (!this.db) {
      throw new Error('VectorMemoryService not initialized. Call initialize() first.')
    }
    return this.db
  }

  // ==========================================================================
  // Indexing
  // ==========================================================================

  /**
   * Index arbitrary text into memory. Chunks the text, generates embeddings,
   * and inserts into all three tables (chunks, vec, fts).
   *
   * @returns Number of chunks indexed
   */
  async indexText(
    source: MemorySource,
    sourceId: string,
    text: string,
    metadata?: Record<string, unknown>
  ): Promise<number> {
    if (!text || text.trim().length === 0) return 0

    const chunks = this.chunkText(text, this.config.chunkSize, this.config.chunkOverlap)
    let indexedCount = 0

    for (const chunk of chunks) {
      const isDuplicate = await this.isDuplicateChunk(chunk, source, sourceId)
      if (isDuplicate) continue

      const embedding = await this.embed(chunk)
      this.insertChunk(source, sourceId, chunk, metadata ?? {}, embedding)
      indexedCount++
    }

    this.emit('memory-indexed', { source, sourceId, chunkCount: indexedCount })
    return indexedCount
  }

  /**
   * Index a batch of WhatsApp messages from a conversation.
   * Groups messages into conversation chunks (3-4 messages each).
   *
   * @returns Number of chunks indexed
   */
  async indexConversation(
    jid: string,
    messages: WhatsAppMessage[]
  ): Promise<number> {
    if (messages.length === 0) return 0

    const chunks = this.chunkConversation(messages)
    let indexedCount = 0

    for (const chunk of chunks) {
      const isDuplicate = await this.isDuplicateChunk(chunk, 'conversation', jid)
      if (isDuplicate) continue

      const embedding = await this.embed(chunk)
      const metadata: Record<string, unknown> = {
        messageCount: messages.length,
        timeRange: {
          start: messages[0]?.timestamp,
          end: messages[messages.length - 1]?.timestamp,
        },
        conversationJid: jid,
      }
      this.insertChunk('conversation', jid, chunk, metadata, embedding)
      indexedCount++
    }

    this.emit('memory-indexed', {
      source: 'conversation',
      sourceId: jid,
      chunkCount: indexedCount,
    })
    return indexedCount
  }

  /**
   * Index a file's contents into memory. Detects file type for chunking strategy.
   *
   * @returns Number of chunks indexed
   */
  async indexFile(
    filePath: string,
    source: MemorySource = 'project'
  ): Promise<number> {
    if (!fs.existsSync(filePath)) return 0

    const content = fs.readFileSync(filePath, 'utf-8')
    if (!content || content.trim().length === 0) return 0

    const ext = path.extname(filePath).toLowerCase()
    let chunks: string[]

    if (ext === '.md' || ext === '.mdx') {
      chunks = this.chunkMarkdown(content)
    } else if (['.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.go', '.rs'].includes(ext)) {
      chunks = this.chunkCode(content)
    } else {
      chunks = this.chunkText(content, this.config.chunkSize, this.config.chunkOverlap)
    }

    let indexedCount = 0

    for (const chunk of chunks) {
      const isDuplicate = await this.isDuplicateChunk(chunk, source, filePath)
      if (isDuplicate) continue

      const embedding = await this.embed(chunk)
      const metadata: Record<string, unknown> = {
        filePath,
        fileExt: ext,
        indexedAt: Date.now(),
      }
      this.insertChunk(source, filePath, chunk, metadata, embedding)
      indexedCount++
    }

    this.emit('memory-indexed', {
      source,
      sourceId: filePath,
      chunkCount: indexedCount,
    })
    return indexedCount
  }

  /**
   * Re-index all existing chunks by re-generating embeddings.
   * Useful after changing embedding provider/model.
   */
  async reindexAll(): Promise<void> {
    const db = this.getDb()
    const allChunks = db
      .prepare('SELECT * FROM memory_chunks')
      .all() as MemoryChunkRow[]

    const currentModel = this.config.embeddingModel

    // Clear vec and fts tables
    db.exec('DELETE FROM memory_vec')
    db.exec("INSERT INTO memory_fts (memory_fts) VALUES ('delete-all')")

    for (const row of allChunks) {
      const embedding = await this.embed(row.content)

      // Update embedding model
      db.prepare(
        'UPDATE memory_chunks SET embedding_model = ?, updated_at = ? WHERE id = ?'
      ).run(currentModel, Date.now(), row.id)

      // Re-insert vec and fts
      this.stmts.insertVec!.run(row.id, embeddingToBuffer(embedding))
      this.stmts.insertFts!.run(row.id, row.content, row.source, row.source_id)
    }

    this.emit('reindex-complete', { chunkCount: allChunks.length })
  }

  // ==========================================================================
  // Search
  // ==========================================================================

  /**
   * Hybrid search combining vector similarity and FTS5 BM25 keyword matching.
   *
   * Algorithm:
   * 1. Embed query text
   * 2. Run sqlite-vec KNN search -> top limit*4 candidates
   * 3. Run FTS5 BM25 search -> top limit*4 candidates
   * 4. Union results with scoring:
   *    - vectorScore = 1 - distance (cosine similarity)
   *    - textScore = 1 / (1 + abs(rank))
   *    - finalScore = vectorWeight * vectorScore + textWeight * textScore
   * 5. Sort by finalScore, return top limit results above minScore
   */
  async search(options: MemorySearchOptions): Promise<MemorySearchResult[]> {
    const {
      query,
      limit = 5,
      minScore = 0.3,
      sources,
      sourceIds,
      vectorWeight = this.config.hybridSearchWeights.vector,
      textWeight = this.config.hybridSearchWeights.text,
    } = options

    if (!query || query.trim().length === 0) return []

    const candidateLimit = limit * CANDIDATE_MULTIPLIER

    // 1. Vector search
    const queryEmbedding = await this.embed(query)
    const vecResults = this.stmts.searchVec!.all(
      embeddingToBuffer(queryEmbedding),
      candidateLimit
    ) as VecSearchRow[]

    // 2. FTS5 search - escape special FTS5 characters
    const ftsQuery = this.sanitizeFtsQuery(query)
    let ftsResults: FtsSearchRow[] = []
    if (ftsQuery.length > 0) {
      try {
        ftsResults = this.stmts.searchFts!.all(
          ftsQuery,
          candidateLimit
        ) as FtsSearchRow[]
      } catch {
        // FTS query syntax error - fall back to vector-only
        ftsResults = []
      }
    }

    // 3. Build score map
    const scoreMap = new Map<
      number,
      { vectorScore: number; textScore: number }
    >()

    for (const row of vecResults) {
      // distance is cosine distance (0 = identical, 2 = opposite)
      const vectorScore = Math.max(0, 1 - row.distance)
      scoreMap.set(row.rowid, {
        vectorScore,
        textScore: 0,
      })
    }

    for (const row of ftsResults) {
      const textScore = 1 / (1 + Math.abs(row.rank))
      const existing = scoreMap.get(row.rowid)
      if (existing) {
        existing.textScore = textScore
      } else {
        scoreMap.set(row.rowid, {
          vectorScore: 0,
          textScore,
        })
      }
    }

    // 4. Compute final scores and filter
    const candidates: Array<{
      rowid: number
      score: number
      vectorScore: number
      textScore: number
    }> = []

    for (const [rowid, scores] of scoreMap) {
      const finalScore =
        vectorWeight * scores.vectorScore + textWeight * scores.textScore
      if (finalScore >= minScore) {
        candidates.push({
          rowid,
          score: finalScore,
          vectorScore: scores.vectorScore,
          textScore: scores.textScore,
        })
      }
    }

    // 5. Sort by final score descending
    candidates.sort((a, b) => b.score - a.score)

    // 6. Fetch chunk data and apply filters
    const results: MemorySearchResult[] = []

    for (const candidate of candidates) {
      if (results.length >= limit) break

      const row = this.stmts.getChunkById!.get(
        candidate.rowid
      ) as MemoryChunkRow | undefined
      if (!row) continue

      // Apply source filter
      if (sources && sources.length > 0 && !sources.includes(row.source as MemorySource)) {
        continue
      }

      // Apply sourceId filter
      if (sourceIds && sourceIds.length > 0 && !sourceIds.includes(row.source_id)) {
        continue
      }

      const chunk: MemoryChunk = {
        id: row.id,
        source: row.source as MemorySource,
        sourceId: row.source_id,
        content: row.content,
        metadata: row.metadata ? JSON.parse(row.metadata) : {},
        embeddingModel: row.embedding_model,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }

      results.push({
        chunk,
        score: candidate.score,
        vectorScore: candidate.vectorScore,
        textScore: candidate.textScore,
      })
    }

    return results
  }

  // ==========================================================================
  // Management
  // ==========================================================================

  /**
   * Delete all chunks for a given source type and source ID.
   *
   * @returns Number of chunks deleted
   */
  async deleteBySource(
    source: MemorySource,
    sourceId: string
  ): Promise<number> {
    const db = this.getDb()
    const chunks = this.stmts.getChunksBySource!.all(
      source,
      sourceId
    ) as MemoryChunkRow[]

    const deleteTransaction = db.transaction(() => {
      for (const chunk of chunks) {
        // Delete from FTS (content-sync delete)
        this.stmts.deleteFtsByRowid!.run(
          chunk.id,
          chunk.content,
          chunk.source,
          chunk.source_id
        )
        // Delete from vec
        this.stmts.deleteVecById!.run(chunk.id)
        // Delete from chunks
        this.stmts.deleteChunkById!.run(chunk.id)
      }
    })

    deleteTransaction()

    this.emit('memory-deleted', { source, sourceId, count: chunks.length })
    return chunks.length
  }

  /**
   * Get database statistics.
   */
  async getStats(): Promise<{
    totalChunks: number
    totalSources: number
    dbSizeBytes: number
  }> {
    const totalChunks = (
      this.stmts.countChunks!.get() as { count: number }
    ).count
    const totalSources = (
      this.stmts.countSources!.get() as { count: number }
    ).count

    let dbSizeBytes = 0
    try {
      const stat = fs.statSync(this.config.dbPath)
      dbSizeBytes = stat.size
    } catch {
      // DB file might not exist yet
    }

    return { totalChunks, totalSources, dbSizeBytes }
  }

  /**
   * Clear all memory data (chunks, vectors, FTS, cache).
   */
  async clear(): Promise<void> {
    const db = this.getDb()
    db.exec('DELETE FROM memory_chunks')
    db.exec('DELETE FROM memory_vec')
    db.exec("INSERT INTO memory_fts (memory_fts) VALUES ('delete-all')")
    db.exec('DELETE FROM embedding_cache')

    this.emit('memory-cleared')
  }

  // ==========================================================================
  // Conversation Archival
  // ==========================================================================

  /**
   * Archive a conversation's messages into long-term memory.
   * This indexes all messages as conversation chunks with archival metadata.
   *
   * @returns Number of chunks created
   */
  async archiveConversation(
    jid: string,
    messages: WhatsAppMessage[]
  ): Promise<number> {
    if (messages.length === 0) return 0

    const chunks = this.chunkConversation(messages)
    let indexedCount = 0

    for (const chunk of chunks) {
      const isDuplicate = await this.isDuplicateChunk(chunk, 'conversation', jid)
      if (isDuplicate) continue

      const embedding = await this.embed(chunk)
      const metadata: Record<string, unknown> = {
        archived: true,
        archivedAt: Date.now(),
        messageCount: messages.length,
        timeRange: {
          start: messages[0]?.timestamp,
          end: messages[messages.length - 1]?.timestamp,
        },
        conversationJid: jid,
      }
      this.insertChunk('conversation', jid, chunk, metadata, embedding)
      indexedCount++
    }

    this.emit('conversation-archived', { jid, chunkCount: indexedCount })
    return indexedCount
  }

  /**
   * Get a summary of all archived conversations.
   */
  async getArchivedConversations(): Promise<ArchivedConversationInfo[]> {
    const db = this.getDb()
    const rows = db
      .prepare(
        `SELECT source_id as jid, COUNT(*) as chunkCount, MAX(created_at) as archivedAt
         FROM memory_chunks
         WHERE source = 'conversation'
         AND metadata LIKE '%"archived":true%'
         GROUP BY source_id`
      )
      .all() as ArchivedConversationInfo[]

    return rows
  }

  // ==========================================================================
  // Embedding
  // ==========================================================================

  /**
   * Generate an embedding vector for the given text.
   * Checks cache first, then tries configured provider, falls back to local.
   */
  private async embed(text: string): Promise<Float32Array> {
    const textHash = hashText(text)

    // Check cache
    const cached = this.stmts.getCache!.get(textHash) as
      | Pick<EmbeddingCacheRow, 'embedding' | 'model'>
      | undefined
    if (cached) {
      return bufferToEmbedding(cached.embedding as unknown as Buffer)
    }

    // Generate embedding
    let embedding: Float32Array

    try {
      embedding = await this.embedWithProvider(text)
    } catch (providerError) {
      // Fall back to local model
      this.emit('embedding-fallback', {
        reason: String(providerError),
        provider: this.config.embeddingProvider,
      })
      embedding = await this.embedLocal(text)
    }

    // Cache the result
    this.stmts.insertCache!.run(
      textHash,
      embeddingToBuffer(embedding),
      this.config.embeddingModel,
      Date.now()
    )

    return embedding
  }

  /**
   * Generate embeddings for a batch of texts.
   */
  private async embedBatch(texts: string[]): Promise<Float32Array[]> {
    const results: Float32Array[] = []
    for (const text of texts) {
      results.push(await this.embed(text))
    }
    return results
  }

  /**
   * Generate embedding using the configured remote provider (Voyage AI or OpenAI).
   */
  private async embedWithProvider(text: string): Promise<Float32Array> {
    const provider = this.config.embeddingProvider

    if (provider === 'local') {
      return this.embedLocal(text)
    }

    if (provider === 'voyage') {
      return this.embedVoyage(text)
    }

    if (provider === 'openai') {
      return this.embedOpenAI(text)
    }

    throw new Error(`Unknown embedding provider: ${provider}`)
  }

  /**
   * Generate embedding using Voyage AI API.
   */
  private async embedVoyage(text: string): Promise<Float32Array> {
    const apiKey = this.config.embeddingApiKey
    if (!apiKey) {
      throw new Error('Voyage AI API key not configured')
    }

    const response = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.embeddingModel,
        input: [text],
        input_type: 'document',
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Voyage API error (${response.status}): ${errorText}`)
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[] }>
    }

    if (!data.data || data.data.length === 0 || !data.data[0].embedding) {
      throw new Error('Invalid Voyage API response: no embedding data')
    }

    return new Float32Array(data.data[0].embedding)
  }

  /**
   * Generate embedding using OpenAI API.
   */
  private async embedOpenAI(text: string): Promise<Float32Array> {
    const apiKey = this.config.embeddingApiKey
    if (!apiKey) {
      throw new Error('OpenAI API key not configured')
    }

    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.embeddingModel,
        input: text,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`OpenAI API error (${response.status}): ${errorText}`)
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[] }>
    }

    if (!data.data || data.data.length === 0 || !data.data[0].embedding) {
      throw new Error('Invalid OpenAI API response: no embedding data')
    }

    return new Float32Array(data.data[0].embedding)
  }

  /**
   * Generate embedding using local @huggingface/transformers model.
   * Uses 'Xenova/all-MiniLM-L6-v2' (384 dimensions).
   * Caches the pipeline instance for reuse.
   */
  private async embedLocal(text: string): Promise<Float32Array> {
    const pipeline = await this.getLocalPipeline()

    // The pipeline function returns an object with data property
    const result = await (pipeline as (
      text: string,
      options: { pooling: string; normalize: boolean }
    ) => Promise<{ data: Float32Array }>)(text, {
      pooling: 'mean',
      normalize: true,
    })

    return new Float32Array(result.data)
  }

  /**
   * Lazily load and cache the local HuggingFace transformers pipeline.
   */
  private async getLocalPipeline(): Promise<unknown> {
    if (this.localPipeline) {
      return this.localPipeline
    }

    if (this.localPipelineLoading) {
      return this.localPipelineLoading
    }

    this.localPipelineLoading = (async () => {
      const { pipeline } = await import('@huggingface/transformers')
      const pipe = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2')
      this.localPipeline = pipe
      return pipe
    })()

    return this.localPipelineLoading
  }

  // ==========================================================================
  // Chunking
  // ==========================================================================

  /**
   * Split text into chunks by token count with overlap.
   * Uses character-based approximation (4 chars ~ 1 token).
   */
  private chunkText(
    text: string,
    chunkSizeTokens: number,
    overlapTokens: number
  ): string[] {
    const chunkSizeChars = chunkSizeTokens * CHARS_PER_TOKEN
    const overlapChars = overlapTokens * CHARS_PER_TOKEN

    if (text.length <= chunkSizeChars) {
      return [text.trim()].filter((c) => c.length > 0)
    }

    const chunks: string[] = []
    let start = 0

    while (start < text.length) {
      let end = start + chunkSizeChars

      // Try to break at a sentence or paragraph boundary
      if (end < text.length) {
        const breakPoint = findBreakPoint(text, start, end)
        if (breakPoint > start) {
          end = breakPoint
        }
      } else {
        end = text.length
      }

      const chunk = text.slice(start, end).trim()
      if (chunk.length > 0) {
        chunks.push(chunk)
      }

      start = end - overlapChars
      if (start >= text.length) break
      // Ensure forward progress - don't let start go backwards
      if (start <= (end - chunkSizeChars)) {
        start = end
      }
    }

    return chunks
  }

  /**
   * Split markdown text at heading boundaries (H2/H3).
   * Falls back to token-based chunking if no headings found.
   */
  private chunkMarkdown(markdown: string): string[] {
    const headingPattern = /^#{2,3}\s+/m
    const sections = markdown.split(headingPattern)

    if (sections.length <= 1) {
      // No headings found, fall back to regular chunking
      return this.chunkText(
        markdown,
        this.config.chunkSize,
        this.config.chunkOverlap
      )
    }

    // Reconstruct sections with their headings
    const headings = markdown.match(/^#{2,3}\s+.*/gm) || []
    const chunks: string[] = []

    // First section (before any heading) if non-empty
    if (sections[0].trim().length > 0) {
      chunks.push(sections[0].trim())
    }

    for (let i = 1; i < sections.length; i++) {
      const heading = headings[i - 1] || ''
      const content = `${heading}\n${sections[i]}`.trim()

      // If a section is too large, sub-chunk it
      if (content.length > this.config.chunkSize * CHARS_PER_TOKEN) {
        const subChunks = this.chunkText(
          content,
          this.config.chunkSize,
          this.config.chunkOverlap
        )
        chunks.push(...subChunks)
      } else if (content.length > 0) {
        chunks.push(content)
      }
    }

    return chunks
  }

  /**
   * Split code files at function/class boundaries.
   * Falls back to token-based chunking if no boundaries found.
   */
  private chunkCode(code: string): string[] {
    // Pattern matches common function/class/method declarations
    const boundaryPattern =
      /^(?:export\s+)?(?:async\s+)?(?:function|class|const\s+\w+\s*=\s*(?:async\s+)?(?:\(|function))|^(?:export\s+)?(?:interface|type|enum)\s+|^\s*(?:public|private|protected)\s+(?:async\s+)?(?:static\s+)?\w+\s*\(/gm

    const boundaries: number[] = [0]
    let match: RegExpExecArray | null

    while ((match = boundaryPattern.exec(code)) !== null) {
      if (match.index > 0) {
        boundaries.push(match.index)
      }
    }

    if (boundaries.length <= 1) {
      // No function boundaries found, fall back to regular chunking
      return this.chunkText(code, this.config.chunkSize, this.config.chunkOverlap)
    }

    boundaries.push(code.length)

    const chunks: string[] = []
    for (let i = 0; i < boundaries.length - 1; i++) {
      const chunk = code.slice(boundaries[i], boundaries[i + 1]).trim()

      // If a section is too large, sub-chunk it
      if (chunk.length > this.config.chunkSize * CHARS_PER_TOKEN) {
        const subChunks = this.chunkText(
          chunk,
          this.config.chunkSize,
          this.config.chunkOverlap
        )
        chunks.push(...subChunks)
      } else if (chunk.length > 0) {
        chunks.push(chunk)
      }
    }

    return chunks
  }

  /**
   * Chunk a conversation into groups of 3-4 messages.
   * Each chunk includes speaker attribution and timestamps.
   */
  private chunkConversation(messages: WhatsAppMessage[]): string[] {
    const MESSAGES_PER_CHUNK = 4
    const chunks: string[] = []

    for (let i = 0; i < messages.length; i += MESSAGES_PER_CHUNK - 1) {
      // Overlap by 1 message for context continuity
      const start = Math.max(0, i)
      const end = Math.min(messages.length, i + MESSAGES_PER_CHUNK)
      const group = messages.slice(start, end)

      const lines = group.map((msg) => {
        const time = new Date(msg.timestamp).toISOString()
        const sender = msg.senderName || msg.senderJid
        const direction = msg.isFromMe ? '[Assistant]' : `[${sender}]`
        return `${direction} (${time}): ${msg.content}`
      })

      const chunk = lines.join('\n')
      if (chunk.trim().length > 0) {
        chunks.push(chunk)
      }
    }

    return chunks
  }

  // ==========================================================================
  // Deduplication
  // ==========================================================================

  /**
   * Check whether a chunk is a duplicate of an existing chunk by computing
   * cosine similarity against existing chunks for the same source.
   * Returns true if any existing chunk has >0.95 similarity.
   */
  private async isDuplicateChunk(
    content: string,
    source: MemorySource,
    sourceId: string
  ): Promise<boolean> {
    const db = this.getDb()

    // Quick check: exact content match (uses cached prepared statement)
    const exactMatch = this.stmts.exactMatchChunk!.get(source, sourceId, content)

    if (exactMatch) return true

    // Embedding-based similarity check
    const embedding = await this.embed(content)

    // Search for nearest neighbor
    try {
      const nearest = this.stmts.searchVec!.all(
        embeddingToBuffer(embedding),
        1
      ) as VecSearchRow[]

      if (nearest.length > 0) {
        const similarity = 1 - nearest[0].distance
        if (similarity > DEDUP_SIMILARITY_THRESHOLD) {
          // Verify it's from the same source
          const chunk = this.stmts.getChunkById!.get(
            nearest[0].rowid
          ) as MemoryChunkRow | undefined
          if (
            chunk &&
            chunk.source === source &&
            chunk.source_id === sourceId
          ) {
            return true
          }
        }
      }
    } catch {
      // Vec table might be empty, which can cause errors
      return false
    }

    return false
  }

  // ==========================================================================
  // Internal Helpers
  // ==========================================================================

  /**
   * Insert a chunk into all three tables (chunks, vec, fts) within a transaction.
   */
  private insertChunk(
    source: MemorySource,
    sourceId: string,
    content: string,
    metadata: Record<string, unknown>,
    embedding: Float32Array
  ): number {
    const db = this.getDb()
    const now = Date.now()
    const metadataJson = JSON.stringify(metadata)
    const embeddingModel = this.config.embeddingModel

    const result = db.transaction(() => {
      const info = this.stmts.insertChunk!.run(
        source,
        sourceId,
        content,
        metadataJson,
        embeddingModel,
        now,
        now
      )

      const rowid = info.lastInsertRowid as number

      this.stmts.insertVec!.run(rowid, embeddingToBuffer(embedding))
      this.stmts.insertFts!.run(rowid, content, source, sourceId)

      return rowid
    })()

    return result
  }

  /**
   * Sanitize a query string for FTS5 syntax.
   * Escapes special characters and converts to OR-joined tokens.
   */
  private sanitizeFtsQuery(query: string): string {
    // Remove FTS5 special characters, then join words with OR for broader matching
    const cleaned = query
      .replace(/[":*^~(){}[\]\\]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    if (cleaned.length === 0) return ''

    // Split into words and join with OR for broader matching
    const words = cleaned.split(' ').filter((w) => w.length > 1)
    if (words.length === 0) return ''

    // Quote each word to prevent FTS5 syntax errors
    return words.map((w) => `"${w}"`).join(' OR ')
  }

  /**
   * Close the database connection and clean up resources.
   */
  async close(): Promise<void> {
    if (this.db) {
      this.db.close()
      this.db = null
    }
    this.stmts = {}
    this.localPipeline = null
    this.localPipelineLoading = null
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Convert a Float32Array embedding to a Buffer for SQLite blob storage.
 */
function embeddingToBuffer(embedding: Float32Array): Buffer {
  return Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength)
}

/**
 * Convert a Buffer (from SQLite blob) back to a Float32Array embedding.
 */
function bufferToEmbedding(buffer: Buffer): Float32Array {
  const arrayBuffer = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  )
  return new Float32Array(arrayBuffer)
}

/**
 * Compute a SHA-256 hash of text for embedding cache keys.
 */
function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/**
 * Find a good break point (sentence or paragraph boundary) near the target position.
 * Looks backwards from `end` within a window to find the last sentence-ending character.
 */
function findBreakPoint(text: string, start: number, end: number): number {
  // Look back up to 200 chars for a good break point
  const lookback = Math.min(200, end - start)
  const searchStart = end - lookback

  // Prefer paragraph breaks
  const lastParagraph = text.lastIndexOf('\n\n', end)
  if (lastParagraph > searchStart && lastParagraph > start) {
    return lastParagraph + 2
  }

  // Then sentence breaks
  const sentenceEnders = ['. ', '! ', '? ', '.\n', '!\n', '?\n']
  let bestBreak = -1

  for (const ender of sentenceEnders) {
    const pos = text.lastIndexOf(ender, end)
    if (pos > searchStart && pos > start && pos > bestBreak) {
      bestBreak = pos + ender.length
    }
  }

  if (bestBreak > start) {
    return bestBreak
  }

  // Then line breaks
  const lastLine = text.lastIndexOf('\n', end)
  if (lastLine > searchStart && lastLine > start) {
    return lastLine + 1
  }

  // Then word breaks
  const lastSpace = text.lastIndexOf(' ', end)
  if (lastSpace > searchStart && lastSpace > start) {
    return lastSpace + 1
  }

  return end
}

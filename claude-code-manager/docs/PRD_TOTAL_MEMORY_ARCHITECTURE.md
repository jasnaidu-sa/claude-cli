# PRD: Total Memory Architecture — Persistent Conversations, Memory Tiers, and Health Monitoring

## Status: DRAFT — Living Document for Progressive Discussion
## Date: 2026-02-13

---

## 1. Problem Statement

The current Oh My Claude Code agent has memory, but it is **unreliable, incomplete, and unmonitored**:

| Gap | Current State | Impact |
|-----|--------------|--------|
| Conversation persistence | Fire-and-forget async indexing | Conversations silently lost |
| Memory tiers | Single flat vector store | No distinction between facts, episodes, skills |
| Context compaction | No strategy (WhatsApp unbounded) | Context overflow, silent truncation |
| Health monitoring | None | No way to know memory is broken |
| Pattern persistence | In-memory array (lost on restart) | Cannot learn long-term |
| Human visibility | Binary SQLite database | Cannot inspect what the agent "knows" |

**Goal**: Store ALL conversations ALL the time. Organize memory into schematic, episodic, and long-term tiers. Ensure everything works properly with continuous health monitoring.

---

## 2. Memory Tier Architecture

Based on research into OpenClaw, Mem0, Zep/Graphiti, MemGPT/Letta, and CrewAI, the industry has converged on a **three-tier + working memory** model:

```
┌─────────────────────────────────────────────────────────────────┐
│                     WORKING MEMORY                               │
│  (Context window: system prompt + recent messages + summaries)   │
│  Budget: ~50k tokens │ Lifespan: Current session                 │
└────────────────────────────┬────────────────────────────────────┘
                             │ overflow triggers compaction
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                     EPISODIC MEMORY                              │
│  What happened: conversations, events, decisions, outcomes       │
│  Format: Timestamped event records with full conversation turns  │
│  Storage: Append-only event log (SQLite) + daily markdown logs   │
│  Retention: Indefinite (all conversations stored always)         │
│  Retrieval: Temporal queries, vector similarity, recency         │
└────────────────────────────┬────────────────────────────────────┘
                             │ consolidation extracts facts
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                     SEMANTIC MEMORY (Schematic)                   │
│  What is known: facts, preferences, entities, relationships      │
│  Format: Structured facts with provenance + confidence scores    │
│  Storage: SQLite facts table + knowledge graph edges             │
│  Retention: Permanent (with conflict resolution on updates)      │
│  Retrieval: Entity lookup, semantic search, graph traversal      │
└────────────────────────────┬────────────────────────────────────┘
                             │ repeated patterns become procedures
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                     PROCEDURAL MEMORY (Long-Term Skills)          │
│  How to do things: tool sequences, workflows, learned behaviors  │
│  Format: Skill definitions (markdown + YAML frontmatter)         │
│  Storage: Skills directory + crystallized patterns DB             │
│  Retention: Permanent (with success rate tracking)               │
│  Retrieval: Pattern matching, context relevance scoring          │
└─────────────────────────────────────────────────────────────────┘
```

### 2.1 Working Memory (Context Window)

The model's active context. Managed by a sliding window with summarization.

| Component | Token Budget | Source |
|-----------|-------------|--------|
| System prompt + agent identity | 5,000 | SOUL.md, USER.md, HEARTBEAT.md |
| Memory context (retrieved) | 5,000 | Vector search results from all tiers |
| Summary checkpoint | 3,000 | Compressed older conversation history |
| Recent messages | 40,000 | Sliding window, FIFO eviction |
| Response buffer | 8,000 | Reserved for model output |

**Compaction trigger**: When recent messages exceed 35k tokens:
1. Summarize oldest 50% into ~500 tokens (fast model)
2. Index full messages to episodic memory via WAL
3. Extract facts to semantic memory
4. Replace messages with summary checkpoint

### 2.2 Episodic Memory (Conversations & Events)

**Every conversation turn is stored. No exceptions.**

```sql
-- Append-only event log (never deleted, never modified)
CREATE TABLE episodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,        -- links to a conversation session
  channel TEXT NOT NULL,           -- 'whatsapp', 'telegram', 'bvs', 'cli'
  source_id TEXT NOT NULL,         -- jid, chat_id, session_id
  role TEXT NOT NULL,              -- 'user', 'assistant', 'system'
  content TEXT NOT NULL,
  timestamp TEXT NOT NULL,         -- ISO 8601
  metadata_json TEXT,              -- arbitrary context (tool calls, attachments)
  token_count INTEGER,
  embedding BLOB,                  -- 384-dim vector (nullable, filled async)
  indexed_at TEXT                  -- when embedding was computed
);

CREATE INDEX idx_episodes_session ON episodes(session_id, timestamp);
CREATE INDEX idx_episodes_channel ON episodes(channel, source_id, timestamp);
CREATE INDEX idx_episodes_time ON episodes(timestamp);

-- Virtual tables for search
CREATE VIRTUAL TABLE episodes_vec USING vec0(embedding float[384]);
CREATE VIRTUAL TABLE episodes_fts USING fts5(content, tokenize='porter');
```

**Write guarantee**: Every message inserted synchronously BEFORE the agent response is sent back. Not fire-and-forget. Not async. The WAL pattern from PRD_AGENT_RESILIENCE ensures embedding computation is retried, but the raw text is always persisted immediately.

**Daily markdown logs** (OpenClaw pattern):
```
memory/
├── episodes/
│   ├── 2026-02-13.md    # Today's log (human-readable)
│   ├── 2026-02-12.md    # Yesterday's log
│   └── ...
```

Each daily log is auto-generated from the episodes table:
```markdown
---
date: 2026-02-13
channels: [whatsapp, telegram]
sessions: 3
total_messages: 47
---

## Session: whatsapp/919876543210 (10:32 - 11:15)

### User (10:32)
Can you check the BVS status?

### Assistant (10:32)
BVS is running phase 3 with 2 workers active...

[... full transcript ...]
```

### 2.3 Semantic Memory (Facts & Knowledge)

Extracted from episodic memory via consolidation. Stores durable facts about the user, their projects, preferences, and entities.

```sql
CREATE TABLE facts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity TEXT NOT NULL,            -- 'user', 'project:claude-cli', 'tool:supabase'
  attribute TEXT NOT NULL,         -- 'preference', 'capability', 'config'
  value TEXT NOT NULL,             -- the fact itself
  confidence REAL DEFAULT 1.0,    -- 0.0 to 1.0
  source_episode_id INTEGER,      -- which conversation this came from
  extracted_at TEXT NOT NULL,
  last_confirmed_at TEXT,          -- refreshed when fact is re-encountered
  superseded_by INTEGER,          -- points to newer fact if updated
  embedding BLOB                   -- for semantic search
);

CREATE TABLE entity_relations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_entity TEXT NOT NULL,
  relation TEXT NOT NULL,          -- 'uses', 'prefers', 'created', 'depends_on'
  to_entity TEXT NOT NULL,
  weight REAL DEFAULT 1.0,
  source_episode_id INTEGER,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_facts_entity ON facts(entity, attribute);
CREATE INDEX idx_facts_confidence ON facts(confidence);
CREATE INDEX idx_relations_from ON entity_relations(from_entity, relation);
CREATE INDEX idx_relations_to ON entity_relations(to_entity, relation);
```

**Consolidation process** (runs after each conversation or on schedule):
1. Take recent episodic entries not yet consolidated
2. LLM extracts facts: `{entity, attribute, value}` triples
3. Check for conflicts with existing facts (semantic similarity > 0.85)
4. If conflict: newer fact supersedes older, audit trail preserved
5. Extract entity relationships for graph queries
6. Write to markdown knowledge files:

```
memory/
├── knowledge/
│   ├── user-preferences.md
│   ├── project-claude-cli.md
│   ├── entities/
│   │   ├── supabase.md
│   │   └── whatsapp.md
│   └── relations.md
```

### 2.4 Procedural Memory (Skills & Patterns)

Already partially implemented via the skills system and pattern crystallizer. This tier becomes the persistence layer.

```sql
-- Replaces in-memory observation array
CREATE TABLE pattern_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  tool_sequence TEXT NOT NULL,       -- JSON array of tool names
  context_summary TEXT,
  success INTEGER DEFAULT 1,
  quarantined INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  unquarantined_at TEXT
);

-- Crystallized patterns that became skills
CREATE TABLE crystallized_patterns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  tool_sequence TEXT NOT NULL,
  observation_count INTEGER,
  success_rate REAL,
  skill_path TEXT,                   -- path to .md skill file
  status TEXT DEFAULT 'proposed',    -- proposed | accepted | rejected
  created_at TEXT DEFAULT (datetime('now'))
);
```

Maps to existing skills directory:
```
agent-skills/
├── daily-digest.md       # bundled skill
├── heartbeat-monitor.md  # bundled skill
├── idea-processor.md     # bundled skill
├── skill-creator.md      # bundled skill
└── learned/
    ├── restart-dev-server.md   # crystallized from pattern
    └── fix-typescript-errors.md
```

---

## 3. Storage Architecture: Dual-Layer (SQLite + Markdown)

Inspired by OpenClaw's "files are source of truth" philosophy, combined with our existing SQLite + sqlite-vec infrastructure:

```
┌─────────────────────────────────────────────────────────────┐
│  HOT LAYER: SQLite Database                                  │
│  Purpose: Fast queries, vector search, FTS5                  │
│                                                              │
│  Tables:                                                     │
│  ├── episodes          (append-only conversation log)        │
│  ├── episodes_vec      (vector search index)                 │
│  ├── episodes_fts      (full-text search index)              │
│  ├── facts             (extracted knowledge)                 │
│  ├── entity_relations  (knowledge graph edges)               │
│  ├── pattern_observations (tool usage patterns)              │
│  ├── crystallized_patterns (learned skills)                  │
│  ├── memory_wal        (write-ahead log for embeddings)      │
│  └── health_checks     (monitoring results)                  │
│                                                              │
│  Performance: <5ms reads, <1ms writes (WAL mode)             │
│  Rebuild: Can regenerate from markdown files                 │
└─────────────────────────────┬───────────────────────────────┘
                              │ sync (bidirectional)
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  COLD LAYER: Markdown Files (Obsidian-Compatible Vault)      │
│  Purpose: Human-readable, git-friendly, inspectable          │
│                                                              │
│  Structure:                                                  │
│  memory/                                                     │
│  ├── MEMORY.md              # Core long-term facts           │
│  ├── SOUL.md                # Agent identity (existing)      │
│  ├── USER.md                # User profile (existing)        │
│  ├── HEARTBEAT.md           # Health checklist (existing)    │
│  ├── episodes/                                               │
│  │   ├── 2026-02-13.md     # Daily conversation log         │
│  │   └── 2026-02-12.md                                      │
│  ├── knowledge/                                              │
│  │   ├── user-preferences.md                                 │
│  │   ├── project-claude-cli.md                               │
│  │   └── entities/                                           │
│  │       ├── supabase.md                                     │
│  │       └── whatsapp.md                                     │
│  ├── skills/                # Procedural memory              │
│  │   ├── daily-digest.md                                     │
│  │   └── learned/                                            │
│  └── health/                                                 │
│      ├── latest-report.md   # Most recent health check       │
│      └── history/                                            │
│                                                              │
│  Format: YAML frontmatter + markdown body + wikilinks        │
│  Rebuild: SQLite can be regenerated from these files          │
│  Obsidian: Open this directory as a vault for visualization  │
└─────────────────────────────────────────────────────────────┘
```

### 3.1 Sync Strategy

| Direction | Trigger | Action |
|-----------|---------|--------|
| SQLite → Markdown | After each conversation session ends | Generate daily log from episodes table |
| SQLite → Markdown | After fact consolidation | Update knowledge files |
| Markdown → SQLite | File watcher detects change | Re-index changed file (user edited in Obsidian) |
| Markdown → SQLite | On startup (if SQLite missing) | Full rebuild from markdown vault |

### 3.2 Obsidian Compatibility

The markdown vault is structured to be openable as an Obsidian vault:

- **Wikilinks**: Knowledge files link to each other `[[project-claude-cli]]`
- **Tags**: YAML frontmatter tags for filtering `tags: [memory, whatsapp, preference]`
- **Graph view**: Entity relations visible as a knowledge graph
- **No Obsidian required**: The app reads/writes files directly; Obsidian is optional for visualization

---

## 4. Write Path: Guaranteed Persistence

### 4.1 Conversation Write Flow

```
User sends message
        │
        ▼
┌───────────────────────┐
│ 1. INSERT to episodes │ ← Synchronous SQLite write (text only)
│    (raw text, no      │   This MUST succeed before anything else
│     embedding yet)    │
└───────────┬───────────┘
            │
            ▼
┌───────────────────────┐
│ 2. Agent generates    │ ← Normal agent pipeline
│    response           │
└───────────┬───────────┘
            │
            ▼
┌───────────────────────┐
│ 3. INSERT response    │ ← Synchronous SQLite write
│    to episodes        │
└───────────┬───────────┘
            │
            ▼
┌───────────────────────┐
│ 4. Send response to   │ ← Only after both writes confirmed
│    user               │
└───────────┬───────────┘
            │
            ▼ (async, non-blocking)
┌───────────────────────────────────────┐
│ 5. Background workers:                │
│    a. Compute embeddings → WAL queue  │
│    b. Update FTS5 index               │
│    c. Run fact consolidation          │
│    d. Update daily markdown log       │
│    e. Check pattern crystallization   │
└───────────────────────────────────────┘
```

**Key principle**: Raw text is ALWAYS persisted synchronously. Embeddings, indexing, consolidation, and markdown sync are async with retry guarantees via WAL.

### 4.2 Embedding WAL (Write-Ahead Log)

```sql
CREATE TABLE memory_wal (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  episode_id INTEGER NOT NULL,
  operation TEXT NOT NULL,          -- 'embed', 'consolidate', 'sync_markdown'
  payload_json TEXT,
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 5,
  next_retry_at TEXT,
  status TEXT DEFAULT 'pending',   -- pending | processing | completed | dead
  error TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE INDEX idx_wal_pending ON memory_wal(status, next_retry_at)
  WHERE status IN ('pending', 'processing');
```

Background worker:
- Polls every 5 seconds for pending WAL entries
- Processes in order (oldest first)
- On failure: exponential backoff (5s → 30s → 2m → 10m → 1h)
- After max retries: mark `dead`, emit health alert
- On startup: reprocess any pending/processing entries from previous session

---

## 5. Read Path: Tiered Retrieval

### 5.1 Memory Search Pipeline

When the agent needs context:

```
Query (from current conversation)
        │
        ▼
┌───────────────────────────────────┐
│ Stage 1: Working Memory           │
│ Check: Is this in current context?│
│ Latency: 0ms (already loaded)    │
└───────────┬───────────────────────┘
            │ not found
            ▼
┌───────────────────────────────────┐
│ Stage 2: Semantic Memory (Facts)  │
│ Search: Entity lookup + semantic  │
│ Latency: <5ms (SQLite indexed)   │
│ Return: Relevant facts + relations│
└───────────┬───────────────────────┘
            │ need more context
            ▼
┌───────────────────────────────────┐
│ Stage 3: Episodic Memory          │
│ Search: Hybrid (70% vec + 30% BM25)│
│ Latency: <50ms (vector + FTS5)   │
│ Return: Relevant past conversations│
└───────────┬───────────────────────┘
            │ check for applicable skills
            ▼
┌───────────────────────────────────┐
│ Stage 4: Procedural Memory        │
│ Search: Pattern match on context  │
│ Latency: <10ms                   │
│ Return: Applicable learned skills │
└───────────────────────────────────┘
            │
            ▼
┌───────────────────────────────────┐
│ Assemble memory context           │
│ Budget: 5,000 tokens max          │
│ Priority: facts > episodes > skills│
│ Inject into agent system prompt   │
└───────────────────────────────────┘
```

### 5.2 Hybrid Search (Existing Pattern, Enhanced)

```typescript
interface MemorySearchOptions {
  query: string
  tiers: ('episodic' | 'semantic' | 'procedural')[]  // which tiers to search
  limit: number                    // max results per tier
  minScore: number                 // minimum relevance threshold
  vectorWeight: number             // default 0.7
  textWeight: number               // default 0.3
  timeDecay?: boolean              // weight recent results higher
  channel?: string                 // filter by source channel
  entity?: string                  // filter by entity in semantic tier
}
```

---

## 6. Health Monitoring System

### 6.1 HEARTBEAT.md (OpenClaw-Inspired)

Evaluated every 30 minutes by a scheduled skill:

```markdown
---
schedule: "*/30 * * * *"
last_run: 2026-02-13T10:30:00Z
last_status: HEALTHY
---

# Agent Health Checklist

## Memory System
- [ ] SQLite database is accessible and not corrupted
- [ ] WAL queue has no dead-letter entries
- [ ] Embedding provider is responsive (<2s latency)
- [ ] Episodes table has entries from today
- [ ] FTS5 index row count matches episodes count
- [ ] Vector index row count matches episodes with embeddings
- [ ] Daily markdown log exists for today
- [ ] Fact consolidation ran in the last 24 hours

## Channel Connectivity
- [ ] WhatsApp connection is active (if configured)
- [ ] Telegram bot is polling (if configured)
- [ ] API server is listening on port 3847

## Skills System
- [ ] Cron scheduler is running
- [ ] No skill executions failed in the last hour
- [ ] Pattern crystallizer has observations

## Resource Usage
- [ ] SQLite database size < 500MB
- [ ] Memory vault size < 1GB
- [ ] Embedding cache hit rate > 80%
```

### 6.2 Health Check Service

```typescript
interface HealthCheckResult {
  timestamp: string
  overall: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY'
  checks: {
    name: string
    status: 'pass' | 'warn' | 'fail'
    message: string
    latency_ms?: number
    metadata?: Record<string, any>
  }[]
  metrics: {
    episodes_today: number
    episodes_total: number
    facts_total: number
    wal_pending: number
    wal_dead: number
    embedding_cache_hit_rate: number
    db_size_bytes: number
    vault_size_bytes: number
    last_consolidation: string
    last_markdown_sync: string
  }
}
```

### 6.3 Continuous Monitoring Metrics

| Metric | Healthy | Degraded | Unhealthy |
|--------|---------|----------|-----------|
| WAL pending entries | 0-5 | 6-20 | >20 or any dead |
| Embedding latency (p95) | <2s | 2-10s | >10s |
| Episode write success rate | 100% | >99% | <99% |
| Fact consolidation age | <24h | 24-48h | >48h |
| SQLite DB size | <200MB | 200-500MB | >500MB |
| FTS5/Vec index drift | 0 rows | 1-10 rows | >10 rows |
| Daily markdown sync | Current | 1 day behind | >1 day |

### 6.4 Alerting

Health alerts are routed through the channel router:

| Severity | Routing | Example |
|----------|---------|---------|
| Critical | Primary notification channel (immediate) | SQLite corruption, WAL all dead |
| Warning | Primary notification channel (batched hourly) | Embedding provider slow, consolidation overdue |
| Info | Daily digest only | DB size growing, cache hit rate low |

---

## 7. OpenClaw Comparison & Lessons

### What OpenClaw Does Well

| Feature | OpenClaw | Our System | Gap |
|---------|----------|------------|-----|
| **Files as source of truth** | Markdown first, SQLite is cache | SQLite first, no markdown | Need dual-layer |
| **Pre-compaction memory flush** | Silent agentic turn saves context | No compaction strategy | Need context manager |
| **Hybrid search** | 70/30 vec/BM25, union approach | 70/30 vec/BM25 (same) | Already aligned |
| **Daily episodic logs** | `memory/YYYY-MM-DD.md` | Nothing | Need daily logs |
| **Embedding fallback** | Local → remote with auto-download | Local → remote (same pattern) | Already aligned |
| **HEARTBEAT.md** | Proactive checklist every 30min | No health monitoring | Need health checks |
| **QMD alternative backend** | Pluggable search backend | Single SQLite backend | Consider later |
| **Memory plugin ecosystem** | Mem0, Graphiti, Supermemory, etc. | None | Consider Mem0 integration |

### What OpenClaw Gets Wrong (and We Should Avoid)

1. **Memory flush race condition** (GitHub #5457): Large incoming messages can jump from below-threshold to overflow in one turn, bypassing the flush. Our solution: flush is triggered by message count AND token estimate, not just one threshold.

2. **Stale session state**: OpenClaw agents are stateless between sessions. Our system already has persistent agent identity (SOUL.md, USER.md) which is better.

3. **No write guarantee**: OpenClaw memory writes are still tool calls (the agent decides when to write). Our approach: ALL conversations are persisted automatically, not dependent on agent decision.

4. **No fact consolidation**: OpenClaw stores raw notes but doesn't extract structured facts. Our semantic memory tier adds this capability.

---

## 8. Obsidian Evaluation

### Should We Use Obsidian?

**Not as a replacement. Yes as a compatible visualization layer.**

| Criterion | SQLite (Keep) | Obsidian Vault (Add) |
|-----------|--------------|---------------------|
| Query speed | <5ms (indexed) | ~100ms (file scan) |
| Vector search | Native (sqlite-vec) | Needs plugin (Smart Connections) |
| Concurrency | WAL mode (safe) | File locks needed |
| Human readable | No | Yes |
| Git friendly | No (binary) | Yes (line diffs) |
| Graph visualization | No | Yes (built-in) |
| User can edit | Via custom UI only | In Obsidian app |
| Disaster recovery | Needs backup | Rebuild SQLite from files |

### Recommended Approach

```
SQLite ←→ Obsidian-Compatible Markdown Vault
  │              │
  │              ├── Open in Obsidian for graph visualization
  │              ├── Open in VS Code for text editing
  │              ├── Commit to git for version history
  │              └── User can manually edit/annotate memories
  │
  ├── Fast queries (vector + FTS5 + entity lookup)
  ├── Write guarantees (WAL + transactions)
  └── Embedding cache
```

The vault does NOT require Obsidian installed. It's just markdown files with YAML frontmatter and wikilinks. Obsidian is one of many tools that can open this format.

---

## 9. Implementation Phases

### Phase 1: Guaranteed Episode Storage (P0)
- Add `episodes` table to SQLite
- Synchronous write for every conversation turn
- WAL queue for async embedding computation
- Background worker with retry logic
- **Effort**: ~400 lines

### Phase 2: Daily Markdown Sync (P0)
- Generate `memory/episodes/YYYY-MM-DD.md` from episodes table
- Run at end of each conversation session
- File watcher for external edits (re-index to SQLite)
- **Effort**: ~200 lines

### Phase 3: Context Manager (P0)
- Sliding window with token counting
- Summarization trigger at 35k tokens
- Index old messages before discarding
- Summary checkpoint assembly
- **Effort**: ~300 lines

### Phase 4: Health Monitoring (P1)
- Health check service with 30-minute schedule
- HEARTBEAT.md proactive checklist
- Metrics collection and alerting
- Health report markdown generation
- **Effort**: ~350 lines

### Phase 5: Semantic Memory & Consolidation (P1)
- Facts table with entity-attribute-value schema
- Entity relations table for knowledge graph
- LLM-powered fact extraction from episodes
- Conflict detection and resolution
- Knowledge markdown files with wikilinks
- **Effort**: ~500 lines

### Phase 6: Procedural Memory Persistence (P1)
- Migrate pattern observations to SQLite
- Crystallized patterns table
- Link to skills directory
- **Effort**: ~150 lines

### Phase 7: Obsidian Vault Polish (P2)
- Wikilinks between knowledge files
- Tag taxonomy for filtering
- Graph-friendly structure
- Optional: Obsidian MCP server for external access
- **Effort**: ~200 lines

---

## 10. Open Questions for Discussion

1. **Embedding model**: Keep current 384-dim or upgrade to larger model for better recall?
2. **Consolidation frequency**: After every conversation? Hourly batch? Daily?
3. **Fact conflict resolution**: Newer always wins? Or confidence-weighted?
4. **Markdown sync scope**: All episodes or only "interesting" ones?
5. **Obsidian integration depth**: Just compatible files, or active MCP server?
6. **Multi-agent memory sharing**: Should BVS agents access the same memory store?
7. **Privacy scoping**: Should some memories be channel-specific (not cross-searchable)?
8. **Retention policy**: Store everything forever, or decay/archive after N months?

---

## Appendix A: Research Sources

### OpenClaw Architecture
- Memory is file-first (markdown), SQLite is the index/cache
- Hybrid search: 70/30 vector/BM25 with union (not intersection)
- Pre-compaction flush: silent agentic turn saves context before compaction
- HEARTBEAT.md: proactive health checklist evaluated every 30 minutes
- Embedding fallback: local HuggingFace → remote OpenAI/Voyage
- Plugin ecosystem: Mem0, Supermemory, Graphiti, Cognee, Basic Memory

### Industry State of the Art (2025-2026)
- **Mem0**: 26% accuracy improvement, 91% lower latency, 90% token savings
- **Zep/Graphiti**: Temporal knowledge graphs, 18.5% accuracy improvement, sub-250ms p95
- **MemGPT/Letta**: Virtual context management, context repositories (Feb 2026)
- **CrewAI**: Four-tier memory (short/long/entity/contextual) with ChromaDB + SQLite
- **Dual-layer architecture**: Hot path (in-process) + cold path (external retrieval) is the 2026 standard
- **Event sourcing**: Append-only logs for full audit trail and time-travel debugging
- **CQRS**: Separate write models (validation) from read models (fast retrieval)

### Obsidian as Memory Layer
- Vault format: plain markdown + YAML frontmatter + wikilinks (no Obsidian required)
- Smart Connections plugin: 384-dim local embeddings (same as our system)
- Graph view provides entity relationship visualization
- MCP server available for programmatic access
- Best used as human-readable layer on top of SQLite, not as replacement

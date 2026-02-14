# PRD: Unified Agent Architecture — Memory, Routing, Hooks, and Health

## Status: DRAFT
## Date: 2026-02-13
## Supersedes: PRD_AGENT_RESILIENCE_AND_ROUTING.md, PRD_TOTAL_MEMORY_ARCHITECTURE.md

---

## 1. Executive Summary

The Oh My Claude Code agent has a working foundation but lacks production-grade memory, routing, lifecycle management, and monitoring. This unified PRD addresses all gaps in a single implementation roadmap.

### Current Gaps

| # | Gap | Current State | Impact |
|---|-----|--------------|--------|
| 1 | Conversation persistence | Fire-and-forget async indexing | Conversations silently lost |
| 2 | Memory tiers | Single flat vector store | No distinction between facts, episodes, skills |
| 3 | Context compaction | No strategy (WhatsApp unbounded) | Context overflow, silent truncation |
| 4 | Lifecycle hooks | EventEmitter with no guarantees | Side effects have no ordering or retry |
| 5 | Health monitoring | None | No way to know memory is broken |
| 6 | Pattern persistence | In-memory array (lost on restart) | Cannot learn long-term |
| 7 | Telegram routing | Rules declared but never evaluated | All messages go to one chat |
| 8 | Human visibility | Binary SQLite database | Cannot inspect what the agent "knows" |

### Goal

Store ALL conversations ALL the time. Organize memory into episodic, semantic, and procedural tiers. Enforce lifecycle ordering via hooks. Route messages to the right Telegram groups. Monitor everything continuously. Make it all human-readable via markdown files.

---

## 2. Memory Tier Architecture

Based on research into OpenClaw, Mem0, Zep/Graphiti, MemGPT/Letta, and CrewAI, the industry has converged on a **three-tier + working memory** model:

```
┌─────────────────────────────────────────────────────────────────┐
│                     WORKING MEMORY                               │
│  (Context window: system prompt + recent messages + summaries)   │
│  Budget: ~61k tokens │ Lifespan: Current session                 │
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
CREATE TABLE episodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
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

CREATE VIRTUAL TABLE episodes_vec USING vec0(embedding float[384]);
CREATE VIRTUAL TABLE episodes_fts USING fts5(content, tokenize='porter');
```

**Write guarantee**: Every message inserted synchronously BEFORE the agent response is sent back. Not fire-and-forget. Not async. Embedding computation is retried via WAL, but the raw text is always persisted immediately.

**Daily markdown logs** (OpenClaw pattern):
```
memory/episodes/
├── 2026-02-13.md
├── 2026-02-12.md
└── ...
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
```

### 2.3 Semantic Memory (Facts & Knowledge)

Extracted from episodic memory via consolidation.

```sql
CREATE TABLE facts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity TEXT NOT NULL,            -- 'user', 'project:claude-cli', 'tool:supabase'
  attribute TEXT NOT NULL,         -- 'preference', 'capability', 'config'
  value TEXT NOT NULL,
  confidence REAL DEFAULT 1.0,    -- 0.0 to 1.0
  source_episode_id INTEGER,
  extracted_at TEXT NOT NULL,
  last_confirmed_at TEXT,
  superseded_by INTEGER,          -- points to newer fact if updated
  embedding BLOB
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
6. Write to markdown knowledge files

### 2.4 Procedural Memory (Skills & Patterns)

Already partially implemented via skills system and pattern crystallizer. This tier adds persistence.

```sql
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

CREATE TABLE crystallized_patterns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  tool_sequence TEXT NOT NULL,
  observation_count INTEGER,
  success_rate REAL,
  skill_path TEXT,
  status TEXT DEFAULT 'proposed',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_obs_sequence ON pattern_observations(tool_sequence);
CREATE INDEX idx_obs_quarantine ON pattern_observations(quarantined);
```

---

## 3. Storage Architecture: Dual-Layer (SQLite + Markdown)

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
│  ├── memory_wal        (write-ahead log for async ops)       │
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
│  memory/                                                     │
│  ├── MEMORY.md              # Core long-term facts           │
│  ├── SOUL.md                # Agent identity (existing)      │
│  ├── USER.md                # User profile (existing)        │
│  ├── HEARTBEAT.md           # Health checklist (existing)    │
│  ├── episodes/              # Daily conversation logs        │
│  │   ├── 2026-02-13.md                                      │
│  │   └── 2026-02-12.md                                      │
│  ├── knowledge/             # Semantic memory                │
│  │   ├── user-preferences.md                                 │
│  │   ├── project-claude-cli.md                               │
│  │   └── entities/                                           │
│  │       ├── supabase.md                                     │
│  │       └── whatsapp.md                                     │
│  ├── skills/                # Procedural memory              │
│  │   ├── daily-digest.md                                     │
│  │   └── learned/                                            │
│  └── health/                # Health reports                 │
│      ├── latest-report.md                                    │
│      └── history/                                            │
│                                                              │
│  Format: YAML frontmatter + markdown body + wikilinks        │
│  No Obsidian required. Open in any editor or Obsidian.       │
│  SQLite can be fully rebuilt from these files.               │
└─────────────────────────────────────────────────────────────┘
```

### 3.1 Sync Strategy

| Direction | Trigger | Action |
|-----------|---------|--------|
| SQLite → Markdown | After each conversation session ends | Generate daily log from episodes table |
| SQLite → Markdown | After fact consolidation | Update knowledge files |
| Markdown → SQLite | File watcher detects change | Re-index changed file |
| Markdown → SQLite | On startup (if SQLite missing) | Full rebuild from markdown vault |

---

## 4. Write Path: Guaranteed Persistence

### 4.1 Conversation Write Flow

```
User sends message
        │
        ▼
┌───────────────────────┐
│ 1. INSERT to episodes │ ← Synchronous SQLite write (text only, no embedding)
└───────────┬───────────┘
            ▼
┌───────────────────────┐
│ 2. [pre:agent:respond │ ← Hook: inject memory context, validate
│     hooks run]        │
└───────────┬───────────┘
            ▼
┌───────────────────────┐
│ 3. Agent generates    │ ← Normal agent pipeline
│    response           │
└───────────┬───────────┘
            ▼
┌───────────────────────┐
│ 4. INSERT response    │ ← Synchronous SQLite write
│    to episodes        │
└───────────┬───────────┘
            ▼
┌───────────────────────┐
│ 5. [post:agent:respond│ ← Hook: trigger async workers
│     hooks run]        │
└───────────┬───────────┘
            ▼
┌───────────────────────┐
│ 6. Send response to   │ ← Only after hooks complete
│    user via channel    │
└───────────┬───────────┘
            ▼ (async, non-blocking)
┌───────────────────────────────────────┐
│ 7. Background workers (via WAL):      │
│    a. Compute embeddings              │
│    b. Update FTS5 index               │
│    c. Run fact consolidation          │
│    d. Update daily markdown log       │
│    e. Check pattern crystallization   │
└───────────────────────────────────────┘
```

**Key principle**: Raw text is ALWAYS persisted synchronously. Embeddings, indexing, consolidation, and markdown sync are async with retry guarantees via WAL.

### 4.2 Async Operations WAL (Write-Ahead Log)

```sql
CREATE TABLE memory_wal (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  episode_id INTEGER NOT NULL,
  operation TEXT NOT NULL,          -- 'embed', 'fts_index', 'consolidate', 'sync_markdown'
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

**Background worker behavior**:
- Polls every 5 seconds for pending entries
- Processes in order (oldest first)
- On failure: exponential backoff (5s → 30s → 2m → 10m → 1h)
- After max retries: mark `dead`, emit health alert via hooks
- On startup: reprocess any pending/processing entries from previous session
- On success: mark `completed`, delete after 1 hour

---

## 5. Read Path: Tiered Retrieval

```
Query (from current conversation)
        │
        ▼
┌───────────────────────────────────┐
│ Stage 1: Working Memory           │  Latency: 0ms
│ Check: Is this in current context?│
└───────────┬───────────────────────┘
            │ not found
            ▼
┌───────────────────────────────────┐
│ Stage 2: Semantic Memory (Facts)  │  Latency: <5ms
│ Search: Entity lookup + semantic  │
└───────────┬───────────────────────┘
            │ need more context
            ▼
┌───────────────────────────────────┐
│ Stage 3: Episodic Memory          │  Latency: <50ms
│ Search: Hybrid (70% vec + 30% BM25)│
└───────────┬───────────────────────┘
            │ check for applicable skills
            ▼
┌───────────────────────────────────┐
│ Stage 4: Procedural Memory        │  Latency: <10ms
│ Search: Pattern match on context  │
└───────────────────────────────────┘
            │
            ▼
┌───────────────────────────────────┐
│ Assemble memory context           │
│ Budget: 5,000 tokens max          │
│ Priority: facts > episodes > skills│
└───────────────────────────────────┘
```

### 5.1 Search Interface

```typescript
interface MemorySearchOptions {
  query: string
  tiers: ('episodic' | 'semantic' | 'procedural')[]
  limit: number
  minScore: number
  vectorWeight: number             // default 0.7
  textWeight: number               // default 0.3
  timeDecay?: boolean
  channel?: string
  entity?: string
}
```

---

## 6. Lifecycle Hooks System

Replace fire-and-forget EventEmitter with ordered, awaitable hooks.

### 6.1 Design

```typescript
type HookPhase = 'pre' | 'post'
type HookEvent =
  | 'agent:respond'      // before/after agent generates response
  | 'memory:index'       // before/after memory write
  | 'memory:search'      // before/after memory read
  | 'channel:send'       // before/after sending to channel
  | 'channel:receive'    // before/after receiving from channel
  | 'skill:execute'      // before/after skill runs
  | 'pattern:observe'    // before/after pattern recorded
  | 'context:compact'    // before/after context summarization
  | 'health:check'       // before/after health evaluation

interface Hook {
  id: string
  event: HookEvent
  phase: HookPhase
  priority: number        // lower = runs first
  handler: (ctx: HookContext) => Promise<HookResult>
  timeout: number         // max ms to wait
}

interface HookResult {
  continue: boolean       // false = abort the operation
  data?: any              // modified data to pass forward
}

class HooksService {
  private hooks: Map<string, Hook[]> = new Map()

  register(hook: Hook): () => void { /* returns unregister fn */ }

  async run(event: HookEvent, phase: HookPhase, ctx: HookContext): Promise<HookResult> {
    const hooks = this.getHooks(event, phase)
    for (const hook of hooks) {
      const result = await Promise.race([
        hook.handler(ctx),
        this.timeout(hook.timeout),
      ])
      if (!result.continue) return result
    }
    return { continue: true }
  }
}
```

### 6.2 Integration Points

| Event | Pre Hook | Post Hook |
|-------|----------|-----------|
| `agent:respond` | Inject memory context | Queue WAL entries for async processing |
| `memory:index` | Validate/enrich chunks | Update search cache |
| `channel:send` | Apply routing rules (Section 8) | Log delivery status |
| `channel:receive` | Spam filter, rate limit | Trigger agent pipeline |
| `skill:execute` | Permission check | Record execution metrics |
| `context:compact` | Backup pre-compact state | Verify summary quality |
| `health:check` | Load checklist | Route alerts by severity |

### 6.3 Migration from EventEmitter

Existing EventEmitter usage is preserved as a compatibility layer:
```typescript
this.emit('message:sent', data)                              // existing code unchanged
await this.hooks.run('channel:send', 'post', { data })       // new hook path
```

---

## 7. Health Monitoring System

### 7.1 HEARTBEAT.md (OpenClaw-Inspired)

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

### 7.2 Health Check Service

```typescript
interface HealthCheckResult {
  timestamp: string
  overall: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY'
  checks: {
    name: string
    status: 'pass' | 'warn' | 'fail'
    message: string
    latency_ms?: number
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

### 7.3 Monitoring Thresholds

| Metric | Healthy | Degraded | Unhealthy |
|--------|---------|----------|-----------|
| WAL pending entries | 0-5 | 6-20 | >20 or any dead |
| Embedding latency (p95) | <2s | 2-10s | >10s |
| Episode write success rate | 100% | >99% | <99% |
| Fact consolidation age | <24h | 24-48h | >48h |
| SQLite DB size | <200MB | 200-500MB | >500MB |
| FTS5/Vec index drift | 0 rows | 1-10 rows | >10 rows |
| Daily markdown sync | Current | 1 day behind | >1 day |

### 7.4 Alerting

Health alerts route through the channel router using output categories (Section 8):

| Severity | Category | Routing | Example |
|----------|----------|---------|---------|
| Critical | `system:alert` | Primary channel, immediate | SQLite corruption, WAL all dead |
| Warning | `system:alert` | Primary channel, batched hourly | Embedding slow, consolidation overdue |
| Info | `system:heartbeat` | Daily digest only | DB size growing, cache hit rate low |

---

## 8. Channel Routing System

### 8.1 Output Categories

```typescript
type OutputCategory =
  | 'bvs:notification'    // BVS phase completions, errors
  | 'bvs:approval'        // BVS approval requests
  | 'skill:output'        // Skill execution results
  | 'skill:digest'        // Daily digest output
  | 'agent:chat'          // General conversation
  | 'agent:error'         // Error notifications
  | 'system:heartbeat'    // Heartbeat/status pings
  | 'system:alert'        // Critical system alerts
```

### 8.2 Routing Rules Enforcement

Currently `ChannelRoutingRule[]` is declared but never evaluated. Fix:

```typescript
// channel-router-service.ts - modify sendToChannel
async sendToChannel(
  message: string,
  options?: { category?: OutputCategory; metadata?: Record<string, any> }
): Promise<void> {
  // Step 1: Evaluate rules (highest priority first)
  const matchedRule = this.evaluateRules(message, options?.category)

  // Step 2: Determine target channels
  const targetChannels = matchedRule
    ? matchedRule.channels
    : this.config.defaultChannels

  // Step 3: For Telegram, resolve category -> group
  for (const channel of targetChannels) {
    if (channel === 'telegram' && options?.category) {
      const chatId = await this.telegramService.ensureGroupForCategory(options.category)
      await this.telegramService.sendToChat(chatId, message)
    } else {
      await this.transports.get(channel)?.send(message)
    }
  }
}

private evaluateRules(message: string, category?: OutputCategory): ChannelRoutingRule | null {
  const sortedRules = [...this.config.rules].sort((a, b) => b.priority - a.priority)
  for (const rule of sortedRules) {
    if (rule.pattern && new RegExp(rule.pattern).test(message)) return rule
    if (rule.category && category && rule.category === category) return rule
  }
  return null
}
```

### 8.3 Telegram Multi-Group Routing

```typescript
interface TelegramRoutingRule {
  id: string
  category: OutputCategory | OutputCategory[]
  chatId: string
  chatName?: string
  enabled: boolean
  priority: number
}

// Extended TelegramConfig
interface TelegramConfig {
  // ... existing fields
  routingRules: TelegramRoutingRule[]
  autoCreateGroups: boolean
  fallbackChatId: string
}
```

**Auto-group creation** (when `autoCreateGroups` enabled):
1. Bot creates a new Telegram group named `OMC: {category}`
2. Bot adds the user (from `allowedUserIds`) to the group
3. Creates a routing rule mapping the category to the new group
4. Persists the rule to config
5. Rate limited: max 1 new group per hour, max 10 total

---

## 9. Implementation Roadmap

### Phase 1: Guaranteed Episode Storage
**Priority**: P0 — Critical | **Effort**: ~400 lines | **Dependencies**: None

- Add `episodes` table to SQLite
- Synchronous write for every conversation turn (user + assistant)
- `memory_wal` table for async operations (embed, fts_index, sync_markdown)
- Background worker with retry logic and exponential backoff
- Dead-letter handling with health alerts

**Files**: `vector-memory-service.ts` (extend), new `episode-store-service.ts`

### Phase 2: Daily Markdown Sync
**Priority**: P0 — Critical | **Effort**: ~200 lines | **Dependencies**: Phase 1

- Generate `memory/episodes/YYYY-MM-DD.md` from episodes table
- Run at end of each conversation session + on schedule
- File watcher (chokidar) for external edits → re-index to SQLite
- YAML frontmatter with date, channels, session count, message count

**Files**: New `markdown-sync-service.ts`

### Phase 3: Context Window Manager
**Priority**: P0 — Critical | **Effort**: ~300 lines | **Dependencies**: Phase 1

- Sliding window with token counting (tiktoken estimate)
- Summarization trigger at 35k tokens using fast model
- Pre-compaction flush: index full messages to episodes before discarding
- Summary checkpoint assembly and injection
- Dual threshold: message count AND token estimate (avoids OpenClaw race condition)

**Files**: New `context-manager-service.ts`, modify `whatsapp-agent-service.ts`

### Phase 4: Lifecycle Hooks
**Priority**: P1 — High | **Effort**: ~350 lines | **Dependencies**: None (parallel with 1-3)

- `HooksService` with ordered, awaitable, timeout-enforced hooks
- Register hooks for: `agent:respond`, `memory:index`, `channel:send`, `channel:receive`, `skill:execute`, `context:compact`, `health:check`
- EventEmitter compatibility layer (existing code unchanged)
- Hook execution logging for debugging

**Files**: New `hooks-service.ts`, modify `whatsapp-agent-service.ts`, `channel-router-service.ts`, `skill-executor-service.ts`

### Phase 5: Health Monitoring
**Priority**: P1 — High | **Effort**: ~350 lines | **Dependencies**: Phase 1, Phase 4

- `HealthCheckService` with 30-minute scheduled evaluation
- HEARTBEAT.md proactive checklist (memory, channels, skills, resources)
- Metrics collection (episodes today, WAL pending, embedding latency, DB size)
- Health report markdown generation at `memory/health/latest-report.md`
- Alert routing via channel router with severity levels
- `health:check` hook for extensibility

**Files**: New `health-check-service.ts`, modify `skill-executor-service.ts` (add cron)

### Phase 6: Semantic Memory & Consolidation
**Priority**: P1 — High | **Effort**: ~500 lines | **Dependencies**: Phase 1, Phase 2

- `facts` table with entity-attribute-value schema
- `entity_relations` table for knowledge graph edges
- LLM-powered fact extraction from recent episodes
- Conflict detection (semantic similarity > 0.85) with supersede chain
- Knowledge markdown files with wikilinks at `memory/knowledge/`
- Consolidation runs after each conversation session or hourly batch

**Files**: New `semantic-memory-service.ts`, new `consolidation-service.ts`

### Phase 7: Procedural Memory Persistence
**Priority**: P1 — High | **Effort**: ~150 lines | **Dependencies**: None (parallel)

- Migrate `pattern_observations` from in-memory array to SQLite
- Add `crystallized_patterns` table
- Remove 1000-observation cap (SQLite handles scale)
- Link crystallized patterns to skills directory
- On startup: load recent observations for pattern detection

**Files**: Modify `pattern-crystallizer-service.ts`

### Phase 8: Routing Rules Enforcement
**Priority**: P2 — Medium | **Effort**: ~100 lines | **Dependencies**: None

- Implement `evaluateRules()` in `channel-router-service.ts`
- Add `category` to `ChannelRoutingRule` type
- Evaluate rules on every `sendToChannel` call
- Fall back to `defaultChannels` when no rule matches

**Files**: Modify `channel-router-service.ts`, modify `channel-types.ts`

### Phase 9: Telegram Multi-Group Routing
**Priority**: P2 — Medium | **Effort**: ~300 lines | **Dependencies**: Phase 8

- `TelegramRoutingRule` type with category → chatId mapping
- `ensureGroupForCategory()` method in `telegram-service.ts`
- Auto-group creation (rate limited: 1/hour, max 10)
- Settings UI: routing table, auto-create toggle, test button

**Files**: Modify `telegram-service.ts`, modify Settings UI

### Phase 10: Obsidian Vault Polish
**Priority**: P2 — Medium | **Effort**: ~200 lines | **Dependencies**: Phase 2, Phase 6

- Wikilinks between knowledge files (`[[project-claude-cli]]`)
- Tag taxonomy in YAML frontmatter for filtering
- Graph-friendly structure (entities as separate files)
- Optional: Obsidian MCP server for external programmatic access

**Files**: Modify `markdown-sync-service.ts`

### Summary Table

| Phase | Name | Priority | Effort | Depends On |
|-------|------|----------|--------|-----------|
| 1 | Episode Storage | P0 | ~400 lines | — |
| 2 | Markdown Sync | P0 | ~200 lines | 1 |
| 3 | Context Manager | P0 | ~300 lines | 1 |
| 4 | Lifecycle Hooks | P1 | ~350 lines | — |
| 5 | Health Monitoring | P1 | ~350 lines | 1, 4 |
| 6 | Semantic Memory | P1 | ~500 lines | 1, 2 |
| 7 | Procedural Persistence | P1 | ~150 lines | — |
| 8 | Routing Enforcement | P2 | ~100 lines | — |
| 9 | Telegram Multi-Group | P2 | ~300 lines | 8 |
| 10 | Obsidian Polish | P2 | ~200 lines | 2, 6 |
| | **TOTAL** | | **~2,850 lines** | |

### Parallelization

```
                     ┌─── Phase 1 (Episode Storage) ───┬─── Phase 2 (Markdown) ───┐
                     │                                  │                           │
Start ───────────────┤                                  ├─── Phase 3 (Context) ─────┤
                     │                                  │                           │
                     ├─── Phase 4 (Hooks) ──────────────┼─── Phase 5 (Health) ──────┤
                     │                                  │                           │
                     ├─── Phase 7 (Patterns) ───────────┤                           ├── Phase 10 (Obsidian)
                     │                                  │                           │
                     └─── Phase 8 (Routing) ────────────┴─── Phase 9 (Telegram) ────┘
                                                        │
                                                        └─── Phase 6 (Semantic) ────┘
```

**Wave 1** (parallel): Phases 1, 4, 7, 8
**Wave 2** (after Wave 1): Phases 2, 3, 5, 6, 9
**Wave 3** (after Wave 2): Phase 10

---

## 10. Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Episode write success rate | Unknown | 100% (sync writes) |
| Embedding success rate | Unknown | 99.9% (WAL retries) |
| Conversations lost per day | Unknown | 0 |
| Pattern observations surviving restart | 0% | 100% |
| Context window overflow errors | Unbounded | 0 |
| Telegram routing rule evaluation | Never | Every message |
| Hook-guaranteed side effects | 0 | All memory + notification writes |
| Health check frequency | Never | Every 30 minutes |
| Fact consolidation lag | Never runs | <24 hours |
| Markdown sync lag | No sync | <1 session behind |

---

## 11. Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Synchronous episode write adds latency | Slower agent response | SQLite WAL mode is <1ms per insert |
| Summarization loses nuance | Agent "forgets" details | Index full messages before summarizing |
| Hooks add complexity | Harder to debug | Hook execution logging in health reports |
| Auto-group creation spam | Too many Telegram groups | Rate limit: 1/hour, max 10 total |
| Pattern DB grows large | Slow queries | Indexes on tool_sequence, prune monthly |
| Consolidation LLM cost | Expensive at scale | Batch consolidation, use Haiku for extraction |
| Markdown vault grows large | Slow file watcher | Only watch `memory/` directory, debounce changes |
| OpenClaw flush race condition | Bypass compaction flush | Dual threshold: message count AND token estimate |

---

## 12. Open Questions

1. **Embedding model**: Keep current 384-dim or upgrade for better recall?
2. **Consolidation frequency**: After every conversation? Hourly? Daily?
3. **Fact conflict resolution**: Newer always wins? Or confidence-weighted?
4. **Markdown sync scope**: All episodes or only sessions with >5 messages?
5. **Multi-agent memory sharing**: Should BVS agents access the same memory store?
6. **Privacy scoping**: Should some memories be channel-specific (not cross-searchable)?
7. **Retention policy**: Store everything forever, or archive after N months?
8. **Hooks configurability**: User-configurable via skills, or hardcoded pipelines?
9. **Telegram auto-group**: Require user approval via approval gate?

---

## Appendix A: OpenClaw Comparison

| Feature | OpenClaw | Our System (Current) | Our System (After This PRD) |
|---------|----------|---------------------|----------------------------|
| Files as source of truth | Markdown first | SQLite only | Dual-layer (SQLite + Markdown) |
| Pre-compaction flush | Silent agentic turn | None | Context manager with dual threshold |
| Hybrid search | 70/30 vec/BM25 union | 70/30 vec/BM25 | Same + tiered retrieval |
| Daily episodic logs | memory/YYYY-MM-DD.md | None | memory/episodes/YYYY-MM-DD.md |
| Write guarantee | Agent-initiated tool calls | Fire-and-forget | Synchronous + WAL |
| Fact extraction | None (raw notes) | None | LLM consolidation pipeline |
| Health monitoring | HEARTBEAT.md + CLI doctor | None | HEARTBEAT.md + health service |
| Memory tiers | Episodic + semantic (manual) | Flat vector store | Episodic + semantic + procedural |
| Lifecycle hooks | None (file-based) | EventEmitter | HooksService (ordered, awaitable) |
| Channel routing | N/A | Rules not evaluated | Category-based routing |

## Appendix B: Industry Research Sources

- **OpenClaw**: 188k+ stars, file-first memory, hybrid search, pre-compaction flush, HEARTBEAT.md
- **Mem0**: 26% accuracy improvement, 91% lower latency, 90% token savings, graph memory variant
- **Zep/Graphiti**: Temporal knowledge graphs, 18.5% accuracy improvement, sub-250ms p95
- **MemGPT/Letta**: Virtual context management, context repositories (Feb 2026)
- **CrewAI**: Four-tier memory (short/long/entity/contextual) with ChromaDB + SQLite
- **Dual-layer architecture**: Hot path (in-process) + cold path (retrieval) is the 2026 standard
- **Event sourcing**: Append-only logs for audit trail and time-travel debugging
- **CQRS**: Separate write models (validation) from read models (fast retrieval)

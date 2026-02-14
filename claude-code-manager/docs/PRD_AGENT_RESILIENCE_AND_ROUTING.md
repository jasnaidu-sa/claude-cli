# PRD: Agent Resilience, Memory Enforcement, and Multi-Channel Routing

## Status: DRAFT
## Author: Claude (Auto-generated from architecture review)
## Date: 2026-02-13

---

## 1. Executive Summary

The Oh My Claude Code agent system has a working foundation for skills, memory, channel routing, and pattern crystallization. However, several architectural gaps prevent production-grade reliability:

1. **Memory writes are fire-and-forget** - no guarantee conversations are indexed
2. **Context compaction has no strategy** - WhatsApp agent accumulates unbounded history
3. **Hooks are not implemented** - system uses EventEmitter with no lifecycle guarantees
4. **Pattern observations are in-memory only** - lost on every restart
5. **Telegram multi-group routing rules exist in the type system but are not enforced**
6. **Channel routing rules are declared but never evaluated**

This PRD proposes solutions for each gap, organized into 6 workstreams.

---

## 2. Problem Statements

### 2.1 Memory Write Reliability

**Current behavior** (`whatsapp-agent-service.ts:745-748`):
```typescript
this.memoryService
  .indexConversation(jid, messages)
  .catch((err) => console.warn(LOG_PREFIX, 'Memory indexing failed:', err))
```

This is fire-and-forget. If indexing fails (SQLite lock, embedding API timeout, disk full), the conversation is silently lost. There is no retry, no dead-letter queue, no write-ahead log. The agent has no way to know what it has forgotten.

**Current read** (`whatsapp-agent-service.ts:820-849`):
- Queries top 5 results with `minScore: 0.3`
- Truncates query to 500 chars
- Returns null on any error

**Impact**: The agent may reference memories that were never indexed, or fail to recall conversations it definitely had. Over time, memory becomes unreliable and the user loses trust.

### 2.2 Context Compaction

**Current behavior**:
- BVS agents: `maxTurns: 30` (`bvs-planning-agent-v2.ts:56`) - bounded, reasonable
- WhatsApp agent: **No turn limit, no history truncation** - unbounded growth
- No sliding window, no summarization, no checkpoint/resume

**Impact**: WhatsApp conversations eventually exceed the model's context window. When this happens, the SDK either truncates silently (losing early context) or errors. There is no graceful degradation.

### 2.3 Hooks System

**Current behavior**: The system uses `EventEmitter` throughout:
- `channel-router-service.ts` emits routing events
- `skill-executor-service.ts` emits execution events
- `pattern-crystallizer-service.ts` emits crystallization events

But there is **no hook system** that allows:
- Pre/post lifecycle interception (before agent responds, after memory write)
- Guaranteed side-effect completion (wait for memory index before responding)
- User-defined automation triggers

**Impact**: Side effects (memory writes, pattern recording, notifications) have no ordering guarantees and no retry semantics.

### 2.4 Pattern Crystallization Persistence

**Current behavior** (`pattern-crystallizer-service.ts:53-54`):
```typescript
/** In-memory observation store (would be SQLite in production). */
private observations: ToolPatternObservation[] = []
```

Observations are stored in a plain array, capped at 1000 entries, lost on restart. The comment itself acknowledges this is not production-ready.

**Impact**: The system can never learn long-term patterns because observations reset every time the app restarts.

### 2.5 Telegram Multi-Group Routing

**Current behavior**:
- `TelegramConfig` has `allowedChatIds: string[]` and `primaryChatId: string`
- `ChannelRouterConfig` has `rules: ChannelRoutingRule[]`
- Rules are **declared in the type system but never evaluated** in `channel-router-service.ts`
- Default config: `rules: []`

**Impact**: All Telegram messages go to one chat. Users cannot route BVS notifications to one group, skill outputs to another, and general chat to a third.

### 2.6 Routing Rules Enforcement

**Current behavior** (`channel-router-service.ts:25-30`):
```typescript
const DEFAULT_ROUTER_CONFIG: ChannelRouterConfig = {
  defaultChannels: ['whatsapp', 'telegram'],
  crossChannelForwarding: false,
  rules: [],
  primaryNotificationChannel: 'whatsapp',
}
```

The `rules` array is stored but never read. The `sendToChannel` method sends to whatever channels are in `defaultChannels` without consulting rules.

---

## 3. Proposed Solutions

### WS-1: Memory Write-Ahead Log (WAL)

**Goal**: Guarantee every conversation is indexed, with retry on failure.

#### Design

```
┌─────────────┐    ┌──────────────┐    ┌─────────────────┐
│ Agent Reply  │───>│  WAL Queue   │───>│ Memory Indexer   │
│              │    │ (SQLite tbl) │    │ (Background)     │
└─────────────┘    └──────────────┘    └─────────────────┘
                          │                     │
                          │  On failure:        │  On success:
                          │  increment retry    │  mark completed
                          │  backoff delay      │  delete from WAL
                          ▼                     ▼
                   ┌──────────────┐    ┌─────────────────┐
                   │ Dead Letter  │    │ Vector DB        │
                   │ (max 5 tries)│    │ (sqlite-vec)     │
                   └──────────────┘    └─────────────────┘
```

#### Schema

```sql
CREATE TABLE memory_wal (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  jid TEXT NOT NULL,
  messages_json TEXT NOT NULL,      -- serialized message array
  created_at TEXT DEFAULT (datetime('now')),
  retry_count INTEGER DEFAULT 0,
  next_retry_at TEXT,               -- exponential backoff
  status TEXT DEFAULT 'pending',    -- pending | processing | completed | dead
  error TEXT
);

CREATE INDEX idx_wal_status ON memory_wal(status, next_retry_at);
```

#### Behavior

1. **Before** agent response is sent, insert into WAL
2. Background worker polls WAL every 5 seconds
3. On success: mark `completed`, delete after 1 hour
4. On failure: increment `retry_count`, set `next_retry_at` with exponential backoff (5s, 30s, 2m, 10m, 1h)
5. After 5 failures: mark `dead`, emit event for monitoring
6. On startup: process any pending WAL entries from last session

#### API Changes

```typescript
// memory-service.ts - new method
async indexWithGuarantee(jid: string, messages: Message[]): Promise<void> {
  await this.walInsert(jid, messages)  // synchronous SQLite write
  this.processWalQueue()               // trigger async processing
}
```

**Effort**: ~200 lines new code in `vector-memory-service.ts`

---

### WS-2: Context Window Management

**Goal**: Prevent unbounded history growth with graceful degradation.

#### Strategy: Sliding Window + Summary Checkpoints

```
┌─────────────────────────────────────────────────┐
│ Context Window (200k tokens)                     │
│                                                  │
│ ┌──────────────┐ ┌────────────┐ ┌─────────────┐│
│ │ System Prompt │ │ Summary    │ │ Recent Msgs ││
│ │ + Identity   │ │ Checkpoint │ │ (last 50)   ││
│ │ (~5k tokens) │ │ (~2k)      │ │ (~variable) ││
│ └──────────────┘ └────────────┘ └─────────────┘│
└─────────────────────────────────────────────────┘
```

#### Rules

| Component | Token Budget | Behavior |
|-----------|-------------|----------|
| System prompt + identity | 5,000 | Fixed, always present |
| Memory context | 3,000 | Top 5 results from vector search |
| Summary checkpoint | 2,000 | Compressed history before window |
| Recent messages | 40,000 | Sliding window, FIFO eviction |
| Agent response buffer | 8,000 | Reserved for model output |

#### Summarization Trigger

When `recent_messages` token count exceeds 40,000:
1. Take oldest 50% of messages
2. Summarize into ~500 tokens using a fast model (Haiku)
3. Append summary to checkpoint
4. Drop summarized messages from context
5. Index summarized messages into vector memory (via WAL)

#### Implementation

```typescript
// New file: src/main/services/context-manager-service.ts

interface ContextWindow {
  systemPrompt: string        // fixed
  memoryContext: string | null // from vector search
  summaryCheckpoint: string   // accumulated summaries
  recentMessages: Message[]   // sliding window
}

class ContextManagerService {
  private readonly MAX_RECENT_TOKENS = 40_000
  private readonly SUMMARY_THRESHOLD = 35_000  // trigger before hitting max

  async buildContext(jid: string, messages: Message[]): Promise<ContextWindow> {
    const tokenCount = this.estimateTokens(messages)

    if (tokenCount > this.SUMMARY_THRESHOLD) {
      await this.compactOldMessages(jid, messages)
    }

    return {
      systemPrompt: this.buildSystemPrompt(),
      memoryContext: await this.searchMemory(messages),
      summaryCheckpoint: await this.getCheckpoint(jid),
      recentMessages: this.getRecentWindow(messages),
    }
  }
}
```

**Effort**: ~300 lines, new service + integration into WhatsApp agent

---

### WS-3: Lifecycle Hooks System

**Goal**: Replace fire-and-forget EventEmitter with ordered, awaitable hooks.

#### Design

```typescript
// New file: src/main/services/hooks-service.ts

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

#### Integration Points

| Event | Pre Hook Use | Post Hook Use |
|-------|-------------|---------------|
| `agent:respond` | Inject memory context | Index conversation to WAL |
| `memory:index` | Validate/enrich chunks | Update search cache |
| `channel:send` | Apply routing rules | Log delivery status |
| `channel:receive` | Spam filter, rate limit | Trigger agent pipeline |
| `skill:execute` | Permission check | Record execution metrics |
| `context:compact` | Backup pre-compact state | Verify summary quality |

#### Migration from EventEmitter

Existing EventEmitter usage is preserved as a compatibility layer:
```typescript
// Emit still works, but hooks get first priority
this.emit('message:sent', data)        // existing code unchanged
await this.hooks.run('channel:send', 'post', { data })  // new hook path
```

**Effort**: ~250 lines core + ~100 lines per integration point

---

### WS-4: Persistent Pattern Store

**Goal**: Survive restarts. Store observations in SQLite alongside vector memory.

#### Schema

```sql
CREATE TABLE pattern_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  tool_sequence TEXT NOT NULL,       -- JSON array of tool names
  context_hash TEXT NOT NULL,        -- hash of surrounding context
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
  proposed_skill_path TEXT,          -- path to generated .md file
  status TEXT DEFAULT 'proposed',    -- proposed | accepted | rejected
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_obs_sequence ON pattern_observations(tool_sequence);
CREATE INDEX idx_obs_quarantine ON pattern_observations(quarantined);
```

#### Migration Path

1. Add SQLite tables to the existing `vector-memory-service.ts` database
2. Replace in-memory array with SQLite queries
3. On startup, load recent observations for pattern detection
4. Remove the 1000-observation cap (SQLite handles scale)

**Effort**: ~150 lines refactor in `pattern-crystallizer-service.ts`

---

### WS-5: Telegram Multi-Group Routing

**Goal**: Route different output categories to different Telegram groups.

#### Concept: Output Categories

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

#### Routing Configuration

```typescript
interface TelegramRoutingRule {
  id: string
  category: OutputCategory | OutputCategory[]  // match one or many
  chatId: string                               // target Telegram group
  chatName?: string                            // display name
  enabled: boolean
  priority: number                             // higher = checked first
}

// Extended TelegramConfig
interface TelegramConfig {
  // ... existing fields
  routingRules: TelegramRoutingRule[]
  autoCreateGroups: boolean           // NEW: auto-create groups for new categories
  fallbackChatId: string              // where unmatched messages go
}
```

#### Auto-Group Creation

When `autoCreateGroups` is enabled and a new category has no matching rule:

1. Bot creates a new Telegram group named `OMC: {category}`
2. Bot adds the user (from `allowedUserIds`) to the group
3. Creates a routing rule mapping the category to the new group
4. Persists the rule to config

```typescript
// telegram-service.ts - new method
async ensureGroupForCategory(category: OutputCategory): Promise<string> {
  const existingRule = this.config.routingRules.find(r =>
    Array.isArray(r.category) ? r.category.includes(category) : r.category === category
  )
  if (existingRule) return existingRule.chatId

  if (!this.config.autoCreateGroups) return this.config.fallbackChatId

  // Create group via Telegram Bot API
  const groupName = `OMC: ${category.replace(':', ' - ')}`
  const chatId = await this.bot.createGroup(groupName, this.config.allowedUserIds)

  // Add routing rule
  this.config.routingRules.push({
    id: generateId(),
    category,
    chatId,
    chatName: groupName,
    enabled: true,
    priority: 10,
  })

  await this.persistConfig()
  return chatId
}
```

#### UI Changes (Settings > Channels)

Add a "Telegram Routing" section:
- Table: Category | Target Group | Enabled toggle
- "Auto-create groups" toggle
- "Test routing" button (sends test message to each category)

**Effort**: ~300 lines across telegram-service, channel-router-service, and settings UI

---

### WS-6: Routing Rules Enforcement

**Goal**: Make `ChannelRoutingRule[]` actually do something.

#### Current `ChannelRoutingRule` type (from `channel-types.ts`):

```typescript
interface ChannelRoutingRule {
  pattern: string          // regex or glob to match message content
  channels: string[]       // target channels
  priority: number
}
```

#### Enforcement Implementation

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

**Effort**: ~100 lines in channel-router-service.ts

---

## 4. Implementation Priority

| WS | Name | Priority | Effort | Dependencies |
|----|------|----------|--------|-------------|
| WS-1 | Memory WAL | **P0 - Critical** | Medium | None |
| WS-2 | Context Management | **P0 - Critical** | Medium | WS-1 |
| WS-3 | Lifecycle Hooks | **P1 - High** | Large | None |
| WS-4 | Pattern Persistence | **P1 - High** | Small | None |
| WS-5 | Telegram Multi-Group | **P2 - Medium** | Medium | WS-6 |
| WS-6 | Routing Enforcement | **P2 - Medium** | Small | None |

### Recommended Order

1. **WS-1 + WS-4** (parallel) - Fix data loss issues first
2. **WS-2** - Context management depends on reliable memory writes
3. **WS-3** - Hooks enable clean integration of WS-1 and WS-2
4. **WS-6 then WS-5** - Routing enforcement before multi-group

---

## 5. Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Memory write success rate | Unknown (no tracking) | 99.9% with WAL |
| Conversations lost per day | Unknown | 0 (dead-letter for manual recovery) |
| Pattern observations surviving restart | 0% | 100% |
| Context window overflow errors | Unbounded | 0 (managed by sliding window) |
| Telegram routing rule evaluation | Never | Every message |
| Hook-guaranteed side effects | 0 | All memory/notification writes |

---

## 6. Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| WAL adds write latency | Slower response time | SQLite WAL mode is <1ms per insert |
| Summarization loses nuance | Agent "forgets" details | Index full messages to vector DB before summarizing |
| Hooks add complexity | Harder to debug | Hook execution logging in observability |
| Auto-group creation spam | Too many Telegram groups | Rate limit to 1 new group per hour, max 10 total |
| Pattern DB grows large | Slow queries | Index on tool_sequence, prune old observations monthly |

---

## 7. Open Questions

1. Should the WAL share the same SQLite database as vector memory, or use a separate file?
2. What fast model should be used for context summarization? (Haiku recommended for cost)
3. Should hooks be configurable by the user via the Skills system, or hardcoded?
4. Should Telegram auto-group creation require user approval via the approval gate?
5. What is the maximum number of Telegram groups the bot should manage?

---

## Appendix A: Current Architecture Reference

### Memory Flow (Current)
```
User Message → WhatsApp Agent → Generate Response → Fire-and-Forget Index
                    ↑                                        ↓ (may fail silently)
                    └── buildMemoryContext() ←── Vector DB (sqlite-vec)
```

### Memory Flow (Proposed)
```
User Message → WhatsApp Agent → [pre:agent:respond hook] → Generate Response
                    ↑                                            ↓
                    │                                  [post:agent:respond hook]
                    │                                            ↓
                    └── buildMemoryContext() ←── WAL → Vector DB (sqlite-vec)
                                                  ↑
                                            Background Worker
                                            (retry on failure)
```

### Event System (Current)
```
EventEmitter.emit('event') → All listeners fire (no ordering, no await, no retry)
```

### Hook System (Proposed)
```
HooksService.run('event', 'pre')  → Ordered hooks (awaited, timeout, abort capability)
    ↓
  Operation executes
    ↓
HooksService.run('event', 'post') → Ordered hooks (guaranteed completion)
```

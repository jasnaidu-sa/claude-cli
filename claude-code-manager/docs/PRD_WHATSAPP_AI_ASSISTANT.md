# PRD: WhatsApp AI Assistant Integration

## Project Overview

Integrate a WhatsApp-based AI assistant into the existing Claude Code Manager Electron app, bringing the best capabilities from OpenClaw (proactive behavior, persistent memory, skills, scheduling) and NanoClaw (simplicity, security) into our existing orchestration infrastructure (BVS, Ideas, Agent SDK).

### Goals
- Converse with Claude via WhatsApp from phone for quick fixes, research, in-depth chat, and spawning BVS workflows
- Proactive heartbeat system that monitors projects and pushes alerts
- Full cron-based scheduled task execution
- Long-term vector memory with hybrid search (sqlite-vec + FTS5)
- Agent identity system via SOUL.md / USER.md / HEARTBEAT.md
- Full WhatsApp chat UI in the Electron desktop app
- BVS progress notifications pushed to WhatsApp
- Mode-switching (quick fix, research, chat, BVS spawn)

### Non-Goals
- Multi-user support (single user, personal assistant)
- Container-based sandboxing (Agent SDK in-process is sufficient)
- Plugin marketplace (no untrusted third-party skills)
- WhatsApp Cloud API (Baileys first, Cloud API migration later)

---

## Architecture

```
Electron Main Process
├── WhatsAppService (Baileys connection, message routing)
├── WhatsAppAgentService (Agent SDK, mode switching, streaming)
├── VectorMemoryService (sqlite-vec + FTS5, embeddings)
├── TaskSchedulerService (cron-parser, polling loop)
├── HeartbeatService (timer, HEARTBEAT.md evaluation)
├── AgentIdentityService (SOUL.md, USER.md loading)
├── GroupQueueService (concurrency control, backoff)
├── WhatsApp IPC Handlers (renderer bridge)
├── WhatsApp API Routes (API server extension)
└── Existing Services (BVS, Ideas, Sessions, Git, etc.)

Electron Renderer
├── WhatsAppView (main container)
├── ConversationList (sidebar)
├── ChatWindow (messages + input)
├── WhatsAppSettings (config panel)
├── QrCodeModal (pairing flow)
└── Existing Components (BVS, Ideas, Terminal, etc.)

Shared Types
├── whatsapp-types.ts
└── Updated types.ts (IPC_CHANNELS)
```

---

## Task Breakdown

### Legend
- **[Pn]** = Phase number (1-6)
- **[Tn]** = Task number within phase
- **Depends on** = Must complete before this task can start
- **Parallel with** = Can execute simultaneously
- **Agent** = Suggested agent assignment (W1-W6)

---

## Phase 0: Dependency Installation (Must Run First)

### [P0-T1] Install New Dependencies
**Agent: W1**
**Depends on:** Nothing
**Parallel with:** Nothing (must complete before any other phase)

**Specification:**

Install all required npm packages and rebuild native modules for Electron:

```bash
# Install runtime dependencies
npm install @whiskeysockets/baileys better-sqlite3 sqlite-vec cron-parser @huggingface/transformers qrcode

# Install dev dependencies (TypeScript types)
npm install -D @types/better-sqlite3 @types/qrcode

# Rebuild native modules for Electron
npx electron-rebuild
```

**Acceptance Criteria:**
- All packages installed without errors
- `npx electron-rebuild` completes successfully (especially `better-sqlite3` and `sqlite-vec`)
- `tsc --noEmit` still passes after install
- No peer dependency conflicts

**Troubleshooting:**
- If `electron-rebuild` fails for `better-sqlite3`, try: `npm install better-sqlite3 --build-from-source`
- If `sqlite-vec` fails on Windows, check that Visual Studio Build Tools (MSVC) are installed
- If `@whiskeysockets/baileys` has native dependency issues, ensure Rust toolchain is available (for whatsapp-rust-bridge)

---

## Phase 1: Foundation & Types (Depends on Phase 0)

All Phase 1 tasks can run in parallel. They establish types, interfaces, and configuration with zero coupling to each other.

### [P1-T1] Shared Types Definition
**Agent: W1**
**Depends on:** Nothing
**Parallel with:** P1-T2, P1-T3, P1-T4
**Files:**
- CREATE `src/shared/whatsapp-types.ts`

**Specification:**

```typescript
// src/shared/whatsapp-types.ts

// ============================================================
// Connection & Auth
// ============================================================

export type WhatsAppConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'qr_ready'
  | 'pairing'
  | 'connected'
  | 'reconnecting'
  | 'logged_out'

export interface WhatsAppConnectionState {
  status: WhatsAppConnectionStatus
  qrCode?: string          // base64 QR data when status === 'qr_ready'
  pairingCode?: string     // 8-char code for phone pairing
  phoneNumber?: string     // Connected phone number (E.164)
  lastConnectedAt?: number // epoch ms
  reconnectAttempt: number
  error?: string
}

// ============================================================
// Messages
// ============================================================

export type WhatsAppMessageType =
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'location'
  | 'contact'
  | 'poll'
  | 'reaction'
  | 'reply'

export type WhatsAppMessageDirection = 'inbound' | 'outbound'

export interface WhatsAppMessage {
  id: string
  conversationJid: string
  senderJid: string
  senderName: string
  direction: WhatsAppMessageDirection
  type: WhatsAppMessageType
  content: string              // text content or caption
  mediaUrl?: string            // local path for downloaded media
  mediaMimeType?: string
  quotedMessageId?: string     // if this is a reply
  mentionedJids?: string[]
  timestamp: number            // epoch ms
  isFromMe: boolean
  isProcessed: boolean         // has the agent responded to this
  agentSessionId?: string      // which agent session handled this
  metadata?: Record<string, unknown>
}

// ============================================================
// Conversations
// ============================================================

export type WhatsAppChatType = 'dm' | 'group' | 'self'

export interface WhatsAppConversation {
  jid: string
  name: string
  chatType: WhatsAppChatType
  lastMessageAt: number
  unreadCount: number
  isRegistered: boolean        // bot actively monitors this chat
  triggerPattern?: string      // regex for when bot should respond (groups)
  requiresTrigger: boolean     // false = respond to all messages
  projectPath?: string         // linked project directory
  agentMode: WhatsAppAgentMode // default mode for this conversation
  sessionId?: string           // current Agent SDK session
  lastAgentResponseAt?: number
  metadata?: Record<string, unknown>
}

// ============================================================
// Agent Modes
// ============================================================

export type WhatsAppAgentMode =
  | 'chat'       // conversational, memory tools, read-only file access
  | 'quick_fix'  // fast, minimal tools, Haiku model
  | 'research'   // web search, thorough, Sonnet model
  | 'bvs_spawn'  // full orchestration, can trigger BVS workflows
  | 'auto'       // detect mode from message content

export interface AgentModeConfig {
  mode: WhatsAppAgentMode
  model: string               // e.g. 'claude-haiku-4-5-20251001' (verify latest IDs at implementation time)
  maxTurns: number
  tools: string[]              // SDK tool names
  mcpServers: string[]         // additional MCP server names
  systemPromptAppend?: string  // mode-specific prompt additions
  maxBudgetUsd?: number        // per-query cost cap
}

// ============================================================
// Scheduled Tasks
// ============================================================

export type TaskScheduleType = 'cron' | 'interval' | 'once'
export type TaskStatus = 'active' | 'paused' | 'completed' | 'failed'
export type TaskContextMode = 'conversation' | 'isolated'

export interface ScheduledTask {
  id: string
  conversationJid: string
  name: string
  prompt: string
  scheduleType: TaskScheduleType
  scheduleValue: string        // cron expr, ms interval, or ISO timestamp
  contextMode: TaskContextMode
  status: TaskStatus
  nextRun: string | null       // ISO timestamp
  lastRun: string | null
  lastResult: string | null
  lastError: string | null
  runCount: number
  maxRuns?: number             // null = unlimited
  createdAt: number
  updatedAt: number
}

export interface TaskRunLog {
  id: number
  taskId: string
  runAt: string
  durationMs: number
  status: 'success' | 'error'
  result?: string
  error?: string
  costUsd?: number
  tokensUsed?: number
}

// ============================================================
// Heartbeat
// ============================================================

export interface HeartbeatConfig {
  enabled: boolean
  intervalMs: number           // default: 1800000 (30 min)
  targetConversationJid: string // where to send alerts
  heartbeatMdPath: string      // path to HEARTBEAT.md
  cheapChecksFirst: boolean    // run file checks before LLM
  maxBudgetPerBeatUsd: number  // cost cap per heartbeat
}

export interface HeartbeatResult {
  timestamp: number
  status: 'ok' | 'alert' | 'error'
  alerts: HeartbeatAlert[]
  costUsd: number
  durationMs: number
}

export interface HeartbeatAlert {
  type: 'project_health' | 'bvs_status' | 'ideas_update' | 'custom'
  title: string
  message: string
  severity: 'info' | 'warning' | 'critical'
  projectPath?: string
}

// ============================================================
// Vector Memory
// ============================================================

export type MemorySource = 'conversation' | 'project' | 'user_note' | 'agent_learning'

export interface MemoryChunk {
  id: number
  source: MemorySource
  sourceId: string             // conversationJid or filePath
  content: string
  metadata: Record<string, unknown> // timestamps, speakers, tags
  embeddingModel: string
  createdAt: number
  updatedAt: number
}

export interface MemorySearchResult {
  chunk: MemoryChunk
  score: number                // 0-1 combined hybrid score
  vectorScore: number
  textScore: number
}

export interface MemorySearchOptions {
  query: string
  limit?: number               // default: 5
  minScore?: number            // default: 0.3
  sources?: MemorySource[]     // filter by source type
  sourceIds?: string[]         // filter by specific source
  vectorWeight?: number        // default: 0.7
  textWeight?: number          // default: 0.3
}

// ============================================================
// Agent Identity
// ============================================================

export interface AgentIdentity {
  soulMd: string               // loaded SOUL.md content
  userMd: string               // loaded USER.md content
  heartbeatMd: string          // loaded HEARTBEAT.md content
  projectClaudeMd?: string     // project-specific CLAUDE.md
  customInstructions?: string  // additional instructions
}

// ============================================================
// Configuration
// ============================================================

export interface WhatsAppConfig {
  enabled: boolean
  autoConnect: boolean         // auto-connect on app launch (default: true)
  authDir: string              // path to Baileys auth state
  assistantName: string        // default: 'Claude'
  defaultTriggerPattern: string // default: '^@Claude\\b'
  defaultAgentMode: WhatsAppAgentMode
  debounceMs: number           // default: 2000
  maxConcurrentAgents: number  // default: 3
  messageChunkLimit: number    // default: 4000 (WhatsApp limit)
  ackReactionEmoji: string     // default: '⚡'
  selfChatMode: boolean        // respond in self-chat
  rateLimitPerMinute: number   // default: 10
  heartbeat: HeartbeatConfig
  memory: VectorMemoryConfig
  identity: AgentIdentityConfig
  modeConfigs: Record<WhatsAppAgentMode, AgentModeConfig>
}

export interface VectorMemoryConfig {
  enabled: boolean
  dbPath: string               // default: userData/whatsapp-memory.sqlite
  embeddingProvider: 'voyage' | 'openai' | 'local'
  embeddingModel: string       // default: 'voyage-3.5-lite' or 'all-MiniLM-L6-v2'
  embeddingApiKey?: string
  chunkSize: number            // default: 400 tokens
  chunkOverlap: number         // default: 80 tokens
  hybridSearchWeights: { vector: number; text: number }
  autoIndexConversations: boolean
  autoIndexProjectFiles: boolean
}

export interface AgentIdentityConfig {
  workspacePath: string        // default: userData/whatsapp-workspace/
  soulMdPath: string           // relative to workspace
  userMdPath: string
  heartbeatMdPath: string
}

// ============================================================
// Events (Main -> Renderer)
// ============================================================

export interface WhatsAppEvent {
  type: WhatsAppEventType
  timestamp: number
  data: unknown
}

export type WhatsAppEventType =
  | 'connection_update'
  | 'message_received'
  | 'message_sent'
  | 'agent_response_start'
  | 'agent_response_chunk'
  | 'agent_response_complete'
  | 'agent_response_error'
  | 'heartbeat_result'
  | 'task_executed'
  | 'task_scheduled'
  | 'memory_indexed'
  | 'bvs_progress_update'
  | 'mode_switched'

// ============================================================
// IPC Response Types
// ============================================================

export interface WhatsAppIpcResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}
```

**Acceptance Criteria:**
- All interfaces exported and importable from `@shared/whatsapp-types`
- No circular dependencies with existing types
- JSDoc comments on all public interfaces
- Compile-clean with `tsc --noEmit`

---

### [P1-T2] IPC Channel Registration
**Agent: W2**
**Depends on:** Nothing
**Parallel with:** P1-T1, P1-T3, P1-T4
**Files:**
- CREATE `src/shared/whatsapp-ipc-channels.ts` (separate IPC channels file, following BVS_IPC_CHANNELS pattern)
- EDIT `src/shared/types.ts` (import and re-export, add to AppConfig)

**Specification:**

Create a separate `WHATSAPP_IPC_CHANNELS` constant in `src/shared/whatsapp-ipc-channels.ts` (following the existing `BVS_IPC_CHANNELS` pattern in `src/shared/bvs-types.ts`). Then import and re-export from `types.ts`.

```typescript
// src/shared/whatsapp-ipc-channels.ts
export const WHATSAPP_IPC_CHANNELS = {
```

Add these entries:

```typescript
// WhatsApp - Connection
WHATSAPP_CONNECT: 'whatsapp:connect',
WHATSAPP_DISCONNECT: 'whatsapp:disconnect',
WHATSAPP_GET_STATUS: 'whatsapp:get-status',
WHATSAPP_CONNECTION_UPDATE: 'whatsapp:connection-update',
WHATSAPP_REQUEST_PAIRING_CODE: 'whatsapp:request-pairing-code',

// WhatsApp - Messages
WHATSAPP_SEND_MESSAGE: 'whatsapp:send-message',
WHATSAPP_GET_MESSAGES: 'whatsapp:get-messages',
WHATSAPP_MESSAGE_RECEIVED: 'whatsapp:message-received',
WHATSAPP_MESSAGE_SENT: 'whatsapp:message-sent',

// WhatsApp - Conversations
WHATSAPP_LIST_CONVERSATIONS: 'whatsapp:list-conversations',
WHATSAPP_GET_CONVERSATION: 'whatsapp:get-conversation',
WHATSAPP_REGISTER_CONVERSATION: 'whatsapp:register-conversation',
WHATSAPP_UPDATE_CONVERSATION: 'whatsapp:update-conversation',
WHATSAPP_UNREGISTER_CONVERSATION: 'whatsapp:unregister-conversation',

// WhatsApp - Agent
WHATSAPP_START_AGENT: 'whatsapp:start-agent',
WHATSAPP_STOP_AGENT: 'whatsapp:stop-agent',
WHATSAPP_AGENT_STREAM: 'whatsapp:agent-stream',
WHATSAPP_SET_MODE: 'whatsapp:set-mode',
WHATSAPP_GET_MODE: 'whatsapp:get-mode',

// WhatsApp - Memory
WHATSAPP_MEMORY_SEARCH: 'whatsapp:memory-search',
WHATSAPP_MEMORY_INDEX: 'whatsapp:memory-index',
WHATSAPP_MEMORY_STATS: 'whatsapp:memory-stats',
WHATSAPP_MEMORY_CLEAR: 'whatsapp:memory-clear',

// WhatsApp - Tasks
WHATSAPP_TASK_LIST: 'whatsapp:task-list',
WHATSAPP_TASK_CREATE: 'whatsapp:task-create',
WHATSAPP_TASK_UPDATE: 'whatsapp:task-update',
WHATSAPP_TASK_DELETE: 'whatsapp:task-delete',
WHATSAPP_TASK_EXECUTED: 'whatsapp:task-executed',

// WhatsApp - Heartbeat
WHATSAPP_HEARTBEAT_START: 'whatsapp:heartbeat-start',
WHATSAPP_HEARTBEAT_STOP: 'whatsapp:heartbeat-stop',
WHATSAPP_HEARTBEAT_STATUS: 'whatsapp:heartbeat-status',
WHATSAPP_HEARTBEAT_RESULT: 'whatsapp:heartbeat-result',
WHATSAPP_HEARTBEAT_TRIGGER: 'whatsapp:heartbeat-trigger',

// WhatsApp - Identity
WHATSAPP_IDENTITY_GET: 'whatsapp:identity-get',
WHATSAPP_IDENTITY_UPDATE: 'whatsapp:identity-update',

// WhatsApp - Config
WHATSAPP_CONFIG_GET: 'whatsapp:config-get',
WHATSAPP_CONFIG_SET: 'whatsapp:config-set',

// WhatsApp - BVS Integration
WHATSAPP_BVS_PROGRESS: 'whatsapp:bvs-progress',
```

Also add to `AppConfig` interface:

```typescript
whatsapp?: WhatsAppConfig  // import from whatsapp-types
```

Close the constant with `} as const;` and export the type:
```typescript
} as const;
export type WhatsAppIpcChannel = typeof WHATSAPP_IPC_CHANNELS[keyof typeof WHATSAPP_IPC_CHANNELS];
```

In `src/shared/types.ts`, import and add to AppConfig:
```typescript
import { WHATSAPP_IPC_CHANNELS } from './whatsapp-ipc-channels'
// Add to AppConfig interface:
whatsapp?: WhatsAppConfig  // import from whatsapp-types
```

**Acceptance Criteria:**
- All channels in separate `WHATSAPP_IPC_CHANNELS` constant (follows BVS_IPC_CHANNELS pattern)
- `WhatsAppConfig` added as optional field on `AppConfig`
- No conflicts with existing channel names
- Type-safe: `WhatsAppIpcChannel` union type for all WhatsApp channels

---

### [P1-T3] Agent Identity Files (SOUL.md, USER.md, HEARTBEAT.md)
**Agent: W3**
**Depends on:** Nothing
**Parallel with:** P1-T1, P1-T2, P1-T4
**Files:**
- CREATE `claude-code-manager/whatsapp-workspace/SOUL.md`
- CREATE `claude-code-manager/whatsapp-workspace/USER.md`
- CREATE `claude-code-manager/whatsapp-workspace/HEARTBEAT.md`

**Specification:**

**SOUL.md** - Agent personality and behavioral guidelines:
```markdown
# Agent Identity

You are a personal AI assistant communicating via WhatsApp. You are part of the Claude Code Manager system running on your user's Windows PC.

## Personality
- Concise and direct in responses (WhatsApp messages should be readable on a phone)
- Proactive when you notice issues but not chatty
- Technical and precise when discussing code
- Friendly but professional

## Communication Rules
- Keep messages under 2000 characters unless the user asks for detail
- Use bullet points for lists
- Use code blocks (triple backticks) for code snippets
- Send one message per response (don't split into multiple)
- If a task will take time, acknowledge immediately then follow up when done
- Use the ack reaction (emoji) when you receive a message to show you're processing

## Capabilities
You can:
- Read, edit, and create files in user's projects
- Search the web for research
- Run commands in project directories
- Create and manage BVS (Bounded Verified Sections) workflows for complex tasks
- Schedule recurring tasks (cron, interval, one-time)
- Search your long-term memory for context from past conversations
- Access project-specific CLAUDE.md files for conventions and context

## Mode Behavior
- **Chat mode**: Be conversational. Use memory for context. Don't modify files.
- **Quick fix mode**: Be fast. Make the edit. Confirm what changed. Use Haiku.
- **Research mode**: Be thorough. Search web. Cite sources. Summarize findings.
- **BVS mode**: Create a structured plan. Get user approval. Execute via BVS orchestrator. Report progress.

## Safety
- Never run destructive commands without explicit confirmation
- Always confirm before modifying files in production branches
- Report costs when they exceed $0.50 per query
- If unsure about intent, ask before acting
```

**USER.md** - User context (template, user will customize):
```markdown
# User Context

## About Me
<!-- Fill in your details so the assistant knows your context -->
- Name: [Your name]
- Role: [Your role/title]
- Timezone: [Your timezone]

## Preferences
- Coding style: [e.g., TypeScript, functional, minimal comments]
- Communication: [e.g., direct, no emojis, technical]
- Cost sensitivity: [e.g., prefer Haiku for simple tasks, Sonnet for complex]

## Projects
<!-- List your active projects so the assistant can reference them -->
- Project 1: [path] - [description]
- Project 2: [path] - [description]

## Common Tasks
<!-- Tasks you frequently ask about -->
- [e.g., "Check build status" means run npm run build in project X]
- [e.g., "Review PRs" means check GitHub for open PRs]

## Do Not
<!-- Things the assistant should never do -->
- Never push to main/master without asking
- Never modify .env files
- Never share code snippets from private repos
```

**HEARTBEAT.md** - Proactive monitoring instructions:
```markdown
# Heartbeat Instructions

When this file is checked (every 30 minutes by default), perform these checks:

## Cheap Checks (No LLM needed)
<!-- These run first - if all pass, no LLM is invoked (saves cost) -->
- [ ] Check if any BVS sections are waiting for approval
- [ ] Check if any scheduled tasks have failed since last heartbeat
- [ ] Check Ideas inbox for new unread items

## LLM Checks (Only if cheap checks find something)
<!-- Only runs if one of the cheap checks above found an issue -->
- Summarize any BVS progress since last heartbeat
- Summarize any new Ideas that need attention
- Check git status of active projects for uncommitted changes

## Scheduled Reports
<!-- Time-based reports -->
- Morning (8am): Daily briefing with project status, pending tasks, Ideas inbox count
- Evening (6pm): End-of-day summary of what was accomplished

## Alert Conditions
<!-- Immediate alerts regardless of schedule -->
- BVS section fails quality gate more than 3 times
- Scheduled task error rate exceeds 50%
- New critical/urgent idea arrives in inbox
```

**Acceptance Criteria:**
- Files are well-structured markdown
- SOUL.md provides clear behavioral guidelines
- USER.md is a template with clear placeholders
- HEARTBEAT.md has two-tier structure (cheap checks first)
- No hardcoded paths or user-specific info in SOUL.md

---

### [P1-T4] Configuration Defaults & Store Extension
**Agent: W4**
**Depends on:** Nothing (can use placeholder types, will integrate with P1-T1 types later)
**Parallel with:** P1-T1, P1-T2, P1-T3
**Files:**
- EDIT `src/main/services/config-store.ts` (add WhatsApp config section)

**Specification:**

Add WhatsApp configuration defaults to ConfigStore. Add a `getWhatsAppConfig()` method and `setWhatsAppConfig()` method following the existing pattern. Use electron-store with a separate store name `whatsapp-config` to avoid bloating the main config.

**IMPORTANT:** `app.getPath('userData')` is NOT available at module load time. Use lazy path resolution - compute paths inside a function or getter, not at the top level:

```typescript
function getDefaultWhatsAppConfig(): WhatsAppConfig {
  const userData = app.getPath('userData')
  return {
```

Default configuration values:
```typescript
// Called lazily, NOT at module scope
function getDefaultWhatsAppConfig(): WhatsAppConfig {
  const userData = app.getPath('userData')
  return {
  enabled: false,
  autoConnect: true,
  authDir: path.join(userData, 'whatsapp-auth'),
  assistantName: 'Claude',
  defaultTriggerPattern: '^@Claude\\b',
  defaultAgentMode: 'auto',
  debounceMs: 2000,
  maxConcurrentAgents: 3,
  messageChunkLimit: 4000,
  ackReactionEmoji: '\u26A1', // lightning bolt
  selfChatMode: true,
  rateLimitPerMinute: 10,
  heartbeat: {
    enabled: false,
    intervalMs: 1800000, // 30 minutes
    targetConversationJid: '',
    heartbeatMdPath: 'HEARTBEAT.md',
    cheapChecksFirst: true,
    maxBudgetPerBeatUsd: 0.25,
  },
  memory: {
    enabled: true,
    dbPath: path.join(userData, 'whatsapp-memory.sqlite'),
    embeddingProvider: 'voyage',
    embeddingModel: 'voyage-3.5-lite',
    chunkSize: 400,
    chunkOverlap: 80,
    hybridSearchWeights: { vector: 0.7, text: 0.3 },
    autoIndexConversations: true,
    autoIndexProjectFiles: true,
  },
  identity: {
    workspacePath: path.join(userData, 'whatsapp-workspace'),
    soulMdPath: 'SOUL.md',
    userMdPath: 'USER.md',
    heartbeatMdPath: 'HEARTBEAT.md',
  },
  modeConfigs: {
    chat: {
      mode: 'chat',
      model: 'claude-haiku-4-5-20251001',  // NOTE: verify latest model IDs at implementation time
      maxTurns: 15,
      tools: ['Read', 'Glob', 'Grep'],
      mcpServers: [],
      maxBudgetUsd: 0.10,
    },
    quick_fix: {
      mode: 'quick_fix',
      model: 'claude-haiku-4-5-20251001',  // NOTE: verify latest model IDs at implementation time
      maxTurns: 5,
      tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'],
      mcpServers: [],
      maxBudgetUsd: 0.15,
    },
    research: {
      mode: 'research',
      model: 'claude-sonnet-4-5-20250929',
      maxTurns: 10,
      tools: ['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch'],
      mcpServers: [],
      maxBudgetUsd: 0.50,
    },
    bvs_spawn: {
      mode: 'bvs_spawn',
      model: 'claude-sonnet-4-5-20250929',
      maxTurns: 30,
      tools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
      mcpServers: [],
      maxBudgetUsd: 2.00,
    },
    auto: {
      mode: 'auto',
      model: 'claude-haiku-4-5-20251001',  // NOTE: verify latest model IDs at implementation time
      maxTurns: 15,
      tools: ['Read', 'Glob', 'Grep'],
      mcpServers: [],
      maxBudgetUsd: 0.25,
    },
  },
} // end return
} // end getDefaultWhatsAppConfig
```

**Acceptance Criteria:**
- WhatsApp config stored in separate electron-store instance
- get/set methods follow existing ConfigStore pattern
- Defaults are sensible and cost-conscious
- Migration support for future config changes

---

## Phase 2: Core Services (Depends on Phase 1)

### [P2-T1] WhatsApp Connection Service (Baileys)
**Agent: W1**
**Depends on:** P1-T1 (types), P1-T2 (IPC channels), P1-T4 (config)
**Parallel with:** P2-T2, P2-T3, P2-T4
**Files:**
- CREATE `src/main/services/whatsapp-service.ts`

**Specification:**

Create `WhatsAppService` class extending `EventEmitter`. This service manages the Baileys WhatsApp connection lifecycle.

**Responsibilities:**
1. Initialize Baileys socket with `useMultiFileAuthState()` from config `authDir`
2. Handle QR code generation and pairing code requests
3. Manage connection lifecycle (connect, disconnect, reconnect with exponential backoff)
4. Receive messages via `messages.upsert` event
5. Store message metadata (all chats) and full content (registered conversations only)
6. Send messages with rate limiting and typing indicators
7. Manage conversation registry (which chats the bot monitors)
8. Debounce rapid messages before processing
9. Handle media messages (download to temp, store path)
10. Detect @mentions in group messages

**Key Methods:**
```typescript
class WhatsAppService extends EventEmitter {
  // Connection
  async connect(): Promise<void>
  async disconnect(): Promise<void>
  isConnected(): boolean              // convenience check (status === 'connected')
  getConnectionState(): WhatsAppConnectionState
  async requestPairingCode(phoneNumber: string): Promise<string>

  // Messages
  async sendMessage(jid: string, content: string): Promise<WhatsAppMessage>
  async sendReaction(jid: string, messageKey: any, emoji: string): Promise<void>
  async sendTypingIndicator(jid: string): Promise<void>
  getMessages(jid: string, since?: number, limit?: number): WhatsAppMessage[]

  // Conversations
  listConversations(): WhatsAppConversation[]
  getConversation(jid: string): WhatsAppConversation | undefined
  registerConversation(jid: string, config: Partial<WhatsAppConversation>): WhatsAppConversation
  unregisterConversation(jid: string): void
  updateConversation(jid: string, updates: Partial<WhatsAppConversation>): WhatsAppConversation

  // Events emitted:
  // 'connection-update' (WhatsAppConnectionState)
  // 'message-received' (WhatsAppMessage)
  // 'message-sent' (WhatsAppMessage)
  // 'qr-code' (string)
}
```

**Persistence:**
- Auth state: `useMultiFileAuthState()` in `config.authDir`
- Conversations: electron-store `whatsapp-conversations`
- Messages: electron-store `whatsapp-messages` (last 1000 per conversation)

**Reconnection Logic:**
- DisconnectReason.loggedOut → emit 'logged-out', clear auth, require re-scan
- DisconnectReason.connectionLost/timedOut → reconnect with backoff: 5s, 10s, 20s, 40s, 80s
- DisconnectReason.restartRequired → immediate reconnect
- Status 428 (rate limited) → wait 60s then reconnect
- Max reconnect attempts: 10, then emit 'reconnect-failed'

**Rate Limiting:**
- Track messages sent per minute
- Enforce `rateLimitPerMinute` from config (default: 10)
- Add random delay between 2-5 seconds for human-like behavior
- Send typing indicator before each message (composing → pause after send)

**Debouncing:**
- When a message arrives, wait `debounceMs` for additional messages
- If more messages arrive during the wait, reset the timer
- After the debounce window closes, emit all collected messages as a batch

**Acceptance Criteria:**
- Connects to WhatsApp via QR code or pairing code
- Reconnects automatically with exponential backoff
- Rate limits outbound messages
- Debounces rapid inbound messages
- Emits typed events for all state changes
- Stores auth state persistently across app restarts
- Handles group mentions correctly
- Downloads media to temp directory
- Works on Windows (path handling, native module rebuild)

---

### [P2-T2] Vector Memory Service
**Agent: W2**
**Depends on:** P1-T1 (types), P1-T4 (config)
**Parallel with:** P2-T1, P2-T3, P2-T4
**Files:**
- CREATE `src/main/services/vector-memory-service.ts`

**Required Dependencies** (installed in P0-T1):
- `better-sqlite3` (SQLite driver)
- `sqlite-vec` (vector search extension)
- `@anthropic-ai/sdk` already installed (for Voyage API if needed)
- `@huggingface/transformers` (local embedding fallback)

**Specification:**

Create `VectorMemoryService` class. Manages a SQLite database with sqlite-vec for vector search and FTS5 for keyword search, implementing hybrid retrieval.

**Database Schema (SQLite):**
```sql
-- Memory chunks with text content
CREATE TABLE IF NOT EXISTS memory_chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,           -- 'conversation' | 'project' | 'user_note' | 'agent_learning'
  source_id TEXT NOT NULL,        -- conversationJid or filePath
  content TEXT NOT NULL,
  metadata TEXT,                  -- JSON
  embedding_model TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Vector embeddings (sqlite-vec virtual table)
CREATE VIRTUAL TABLE IF NOT EXISTS memory_vec USING vec0(
  embedding float[384]           -- 384 dims for MiniLM, configurable
);

-- Full-text search index
CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
  content,
  source,
  source_id,
  content='memory_chunks',
  content_rowid='id'
);

-- Embedding cache (avoid re-embedding identical text)
CREATE TABLE IF NOT EXISTS embedding_cache (
  text_hash TEXT PRIMARY KEY,
  embedding BLOB NOT NULL,
  model TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_chunks_source ON memory_chunks(source, source_id);
CREATE INDEX IF NOT EXISTS idx_chunks_updated ON memory_chunks(updated_at);
```

**Key Methods:**
```typescript
class VectorMemoryService extends EventEmitter {
  // Initialization
  async initialize(): Promise<void>  // Create DB, load sqlite-vec

  // Indexing
  async indexText(source: MemorySource, sourceId: string, text: string, metadata?: Record<string, unknown>): Promise<number>
  async indexConversation(jid: string, messages: WhatsAppMessage[]): Promise<number> // returns chunk count
  async indexFile(filePath: string, source?: MemorySource): Promise<number>
  async reindexAll(): Promise<void>

  // Search
  async search(options: MemorySearchOptions): Promise<MemorySearchResult[]>

  // Management
  async deleteBySource(source: MemorySource, sourceId: string): Promise<number>
  async getStats(): Promise<{ totalChunks: number; totalSources: number; dbSizeBytes: number }>
  async clear(): Promise<void>

  // Conversation archival (index old conversations into memory, then trim message store)
  async archiveConversation(jid: string, messages: WhatsAppMessage[]): Promise<number>
  async getArchivedConversations(): Promise<{ jid: string; chunkCount: number; archivedAt: number }[]>

  // Embedding
  private async embed(text: string): Promise<Float32Array>
  private async embedBatch(texts: string[]): Promise<Float32Array[]>

  // Chunking
  private chunkText(text: string, chunkSize: number, overlap: number): string[]
  private chunkMarkdown(markdown: string): string[]
  private chunkConversation(messages: WhatsAppMessage[]): string[]
}
```

**Hybrid Search Algorithm:**
Following OpenClaw's proven formula:
1. Embed query text
2. Run sqlite-vec KNN search (cosine similarity) → top `limit * 4` candidates
3. Run FTS5 BM25 search → top `limit * 4` candidates
4. Union results with scoring:
   - `vectorScore = 1 - distance` (cosine similarity)
   - `textScore = 1 / (1 + rank)` (rank-based)
   - `finalScore = vectorWeight * vectorScore + textWeight * textScore`
5. Sort by finalScore, return top `limit` results above `minScore`

**Embedding Provider Strategy:**
1. Try configured provider (Voyage AI or OpenAI)
2. On failure, fall back to local Transformers.js (`all-MiniLM-L6-v2`)
3. Cache embeddings by text hash to avoid re-computation

**Chunking Strategy:**
- Conversations: Group by 3-4 messages, include speaker attribution and timestamps
- Markdown: Split at heading boundaries (H2/H3), fallback to 400-token chunks with 80-token overlap
- Code: Split at function/class boundaries where possible

**Acceptance Criteria:**
- SQLite database created and initialized with sqlite-vec + FTS5
- Hybrid search returns relevant results with combined scoring
- Embedding fallback from Voyage to local Transformers.js works
- Conversation chunking preserves speaker context
- Deduplication: skip chunks with >0.95 cosine similarity to existing
- Stats endpoint returns accurate DB metrics
- Works on Windows (better-sqlite3 + sqlite-vec rebuild with electron-rebuild)

---

### [P2-T3] Group Queue Service
**Agent: W3**
**Depends on:** P1-T1 (types)
**Parallel with:** P2-T1, P2-T2, P2-T4
**Files:**
- CREATE `src/main/services/group-queue-service.ts`

**Specification:**

Port NanoClaw's `GroupQueue` pattern for concurrency control over agent executions. Prevents multiple agent runs for the same conversation and limits total concurrent agents.

**Key Methods:**
```typescript
class GroupQueueService extends EventEmitter {
  constructor(maxConcurrent: number)  // default: 3

  // Queue management
  enqueueMessage(conversationJid: string): void
  enqueueTask(conversationJid: string, task: ScheduledTask): void

  // Control
  setProcessMessagesFn(fn: (jid: string) => Promise<void>): void
  setProcessTaskFn(fn: (jid: string, task: ScheduledTask) => Promise<void>): void

  // State
  isActive(conversationJid: string): boolean
  getActiveCount(): number
  getQueueLength(): number

  // Shutdown
  async shutdown(gracePeriodMs?: number): Promise<void>
}
```

**Behavior:**
- Max concurrent agent runs: configurable (default 3)
- Per-conversation: only one active run at a time
- Tasks prioritized over messages in drain order
- Exponential backoff on failure: 5s, 10s, 20s, 40s, 80s (max 5 retries)
- After max retries, drop and log (will retry on next incoming message)
- Graceful shutdown: wait for active runs to complete, then force-stop

**Acceptance Criteria:**
- Concurrent agent limit enforced
- Per-conversation serialization works
- Backoff/retry on failure
- Graceful shutdown completes within timeout

---

### [P2-T4] Agent Identity Service
**Agent: W4**
**Depends on:** P1-T1 (types), P1-T3 (identity files), P1-T4 (config)
**Parallel with:** P2-T1, P2-T2, P2-T3
**Files:**
- CREATE `src/main/services/agent-identity-service.ts`

**Specification:**

Manages loading, caching, and watching SOUL.md / USER.md / HEARTBEAT.md files. Provides the agent's identity context for system prompt assembly.

**Key Methods:**
```typescript
class AgentIdentityService extends EventEmitter {
  async initialize(): Promise<void>           // Load files, start watcher
  getIdentity(): AgentIdentity                // Returns cached identity
  async updateSoulMd(content: string): Promise<void>
  async updateUserMd(content: string): Promise<void>
  async updateHeartbeatMd(content: string): Promise<void>
  getProjectClaudeMd(projectPath: string): string | null
  buildSystemPromptContext(mode: WhatsAppAgentMode, projectPath?: string): string

  // Events: 'identity-updated'
}
```

**System Prompt Assembly** (`buildSystemPromptContext`):
1. Start with SOUL.md content
2. Append USER.md content
3. If a project is linked, append project's CLAUDE.md
4. Append mode-specific instructions from mode config
5. Append current date, OS info, timezone
6. Return combined string for system prompt injection

**File Watching:**
- Use `chokidar` (already a dependency) to watch workspace directory
- On file change, reload and emit `identity-updated` event
- Debounce file change events (500ms)

**Workspace Initialization:**
- On first run, copy template files (from P1-T3) to `identity.workspacePath`
- Never overwrite existing files

**Acceptance Criteria:**
- Loads identity files on initialization
- Watches for changes and reloads automatically
- Builds mode-aware system prompt context
- Template files created on first run without overwriting
- Project CLAUDE.md loading works with Windows paths

---

## Phase 3: Agent & Processing Services (Depends on Phase 2)

### [P3-T1] WhatsApp Agent Service
**Agent: W1**
**Depends on:** P2-T1 (WhatsApp service), P2-T2 (memory), P2-T3 (queue), P2-T4 (identity)
**Parallel with:** P3-T2, P3-T3
**Files:**
- CREATE `src/main/services/whatsapp-agent-service.ts`
- CREATE `src/main/services/whatsapp-mcp-servers.ts` (extract MCP server factories here if file gets too large)

**COMPLEXITY NOTE:** This is the largest single task. If implementation grows beyond ~500 lines, split MCP server creation into a separate file (`whatsapp-mcp-servers.ts`). The 4 MCP servers (WhatsApp, Memory, BVS, Task) can be factored out as factory functions.

**Specification:**

The central agent orchestrator. Receives messages from WhatsAppService, detects mode, builds context (identity + memory), executes Agent SDK query, streams response back to WhatsApp, and handles BVS spawning.

**Key Methods:**
```typescript
class WhatsAppAgentService extends EventEmitter {
  constructor(
    whatsappService: WhatsAppService,
    memoryService: VectorMemoryService,
    identityService: AgentIdentityService,
    queueService: GroupQueueService,
    configStore: ConfigStore
  )

  async initialize(): Promise<void>

  // Message processing (called by queue)
  async processMessages(conversationJid: string): Promise<void>

  // Mode management
  detectMode(message: string, conversation: WhatsAppConversation): WhatsAppAgentMode
  setConversationMode(jid: string, mode: WhatsAppAgentMode): void

  // Session management
  private sessions: Map<string, string>  // jid -> sessionId

  // Agent execution
  private async executeAgent(
    conversation: WhatsAppConversation,
    messages: WhatsAppMessage[],
    mode: WhatsAppAgentMode
  ): Promise<void>

  // MCP tools
  private createWhatsAppMcpServer(): McpServer
  private createBvsMcpServer(): McpServer
  private createMemoryMcpServer(): McpServer
  private createTaskMcpServer(): McpServer
}
```

**Message Processing Flow:**
1. Queue calls `processMessages(jid)`
2. Get unprocessed messages since last agent response
3. Check trigger pattern (groups) or always-respond (DMs)
4. Send ack reaction emoji on first message
5. Detect mode (auto-detect or conversation default)
6. Build context:
   a. Load identity (SOUL.md + USER.md)
   b. Search vector memory for relevant chunks (top 3-5)
   c. Load project CLAUDE.md if conversation is linked to a project
7. Format messages as XML (NanoClaw pattern):
   ```xml
   <new_messages conversation="ConversationName" jid="xxx@g.us">
   <msg sender="UserName" time="ISO">Message text</msg>
   </new_messages>
   ```
8. Build Agent SDK options with mode-specific config
9. Create MCP servers (WhatsApp tools, memory tools, BVS tools, task tools)
10. Execute `sdk.query()` with streaming
11. On each chunk: emit to IPC for UI update
12. On completion: send full response to WhatsApp, update memory, track cost

**Mode Detection Logic:**
```
/fix or /quickfix → quick_fix
/research or /search → research
/build or /implement or /bvs → bvs_spawn
/chat → chat
Otherwise → analyze message content:
  - Contains "fix", "change", "update" + file reference → quick_fix
  - Contains "research", "find out", "what is", "explain" → research
  - Contains "implement", "build", "create feature", "add" + complex description → bvs_spawn
  - Default → chat
```

**MCP Tools Provided to Agent:**

WhatsApp MCP Server:
- `send_whatsapp_message(jid, text)` - Send message to a conversation
- `react_to_message(jid, messageKey, emoji)` - React to a message
- `list_conversations()` - List registered conversations
- `get_conversation_history(jid, limit)` - Get recent messages

Memory MCP Server:
- `search_memory(query, limit, sources)` - Search long-term memory
- `save_memory(content, source, sourceId)` - Save a new memory
- `forget_memory(chunkId)` - Delete a memory chunk

BVS MCP Server:
- `list_projects()` - List known projects
- `get_project_status(projectPath)` - Get BVS/git status
- `create_bvs_plan(projectPath, description)` - Start BVS planning
- `get_bvs_progress(projectId)` - Get execution progress

Task MCP Server:
- `schedule_task(name, prompt, scheduleType, scheduleValue, contextMode)` - Create scheduled task
- `list_tasks(status)` - List tasks
- `cancel_task(taskId)` - Cancel a task
- `pause_task(taskId)` / `resume_task(taskId)` - Pause/resume

**Acceptance Criteria:**
- Mode detection works for explicit commands and natural language
- Agent SDK streaming works with chunked WhatsApp responses
- All 4 MCP servers created and functional
- Vector memory search injected into system prompt context
- BVS spawn mode actually triggers BVS orchestrator
- Session persistence works (resume conversation context)
- Cost tracking per conversation
- Error handling: on agent failure, send error message to WhatsApp

---

### [P3-T2] Task Scheduler Service
**Agent: W2**
**Depends on:** P2-T1 (WhatsApp for sending), P2-T3 (queue)
**Parallel with:** P3-T1, P3-T3
**Files:**
- CREATE `src/main/services/task-scheduler-service.ts`

**New Dependencies:** `cron-parser`

**Specification:**

Polling-based scheduled task executor. Stores tasks in electron-store, checks for due tasks every 60 seconds, enqueues them via GroupQueueService.

**Key Methods:**
```typescript
class TaskSchedulerService extends EventEmitter {
  constructor(queueService: GroupQueueService, whatsappService: WhatsAppService)

  // Lifecycle
  start(): void
  stop(): void
  isRunning(): boolean

  // CRUD
  createTask(task: Omit<ScheduledTask, 'id' | 'createdAt' | 'updatedAt' | 'runCount'>): ScheduledTask
  updateTask(id: string, updates: Partial<ScheduledTask>): ScheduledTask
  deleteTask(id: string): void
  getTask(id: string): ScheduledTask | undefined
  listTasks(status?: TaskStatus): ScheduledTask[]

  // Execution
  private async executeTask(task: ScheduledTask): Promise<TaskRunLog>
  private calculateNextRun(task: ScheduledTask): string | null

  // Events: 'task-executed', 'task-failed', 'task-created', 'task-updated'
}
```

**Polling Loop:**
- Every 60 seconds, query for tasks where `status === 'active'` and `nextRun <= now`
- Re-verify task is still active before execution (prevent race conditions)
- Enqueue via GroupQueueService for concurrency control
- After execution, calculate next run:
  - cron: use `cron-parser` with timezone support
  - interval: `Date.now() + parseInt(scheduleValue)`
  - once: set to null (marks as completed)
- Log run in task run history
- If `maxRuns` is set and `runCount >= maxRuns`, mark as completed

**Task Log Retention Policy:**
- Keep last 100 run logs per task (prevents unbounded growth)
- On each new log entry, prune logs older than 100 entries
- Provide `getTaskLogs(taskId: string, limit?: number): TaskRunLog[]` method

**Acceptance Criteria:**
- Cron expressions parsed correctly with timezone
- Interval tasks fire at correct intervals
- One-time tasks auto-complete after firing
- Run logs persisted with duration, status, cost
- Run logs bounded to 100 per task (auto-pruned)
- Failed tasks don't block the scheduler
- Duplicate scheduler instances prevented

---

### [P3-T3] Heartbeat Service
**Agent: W3**
**Depends on:** P2-T1 (WhatsApp for sending alerts), P2-T4 (identity for HEARTBEAT.md)
**Parallel with:** P3-T1, P3-T2
**Files:**
- CREATE `src/main/services/heartbeat-service.ts`

**Specification:**

Timer-based proactive monitoring. Reads HEARTBEAT.md, runs cheap deterministic checks first, only invokes LLM if something needs attention.

**Key Methods:**
```typescript
class HeartbeatService extends EventEmitter {
  constructor(
    whatsappService: WhatsAppService,
    identityService: AgentIdentityService,
    configStore: ConfigStore,
    ideasManager: IdeasManager,          // needed for Tier 1 cheap check: Ideas inbox count
    bvsOrchestrator: BvsOrchestrator     // needed for Tier 1 cheap check: BVS approval status
  )

  start(): void
  stop(): void
  isRunning(): boolean
  async triggerNow(): Promise<HeartbeatResult>  // Manual trigger
  getLastResult(): HeartbeatResult | null

  // Events: 'heartbeat-result', 'heartbeat-alert'
}
```

**Two-Tier Execution:**

Tier 1 - Cheap Checks (no LLM, no cost):
1. Check if any BVS sections are in 'waiting_approval' status (read JSON files)
2. Check if any scheduled tasks have `status === 'failed'` since last heartbeat
3. Check Ideas inbox count (call IdeasManager.list('inbox').length)
4. Check git status of linked projects (run `git status --porcelain`)

If all Tier 1 checks pass → log `HEARTBEAT_OK`, no message sent, cost = $0.

Tier 2 - LLM Analysis (only if Tier 1 found something):
1. Load HEARTBEAT.md content
2. Compile findings from Tier 1 into a context summary
3. Run Agent SDK query with minimal tools (Read, Glob only)
4. System prompt: "You are processing a heartbeat check. Summarize findings concisely for a WhatsApp message."
5. Send result to target conversation
6. Track cost

**Scheduled Reports** (from HEARTBEAT.md):
- Parse time-based sections (e.g., "Morning (8am)")
- Use current time to determine if a scheduled report is due
- Only fire if within 5 minutes of scheduled time and hasn't fired this period

**Acceptance Criteria:**
- Timer fires at configured interval (default 30 min)
- Tier 1 checks run without LLM (zero cost when nothing to report)
- Tier 2 only fires when Tier 1 finds something
- Alerts sent to configured WhatsApp conversation
- Heartbeat result logged with cost tracking
- Manual trigger works immediately
- Scheduled reports fire at correct times

---

## Phase 4: IPC & Preload (Depends on Phase 3)

### [P4-T1] IPC Handlers
**Agent: W1**
**Depends on:** P3-T1 (agent service), P3-T2 (scheduler), P3-T3 (heartbeat), all P2 services
**Parallel with:** P4-T2
**Files:**
- CREATE `src/main/ipc/whatsapp-handlers.ts`
- EDIT `src/main/ipc/index.ts` (register new handlers)

**Specification:**

Create `registerWhatsAppHandlers()` following the existing handler registration pattern. Each handler wraps a service method with try/catch and returns `{ success, data, error }`.

**Handler Groups:**

Connection handlers:
- `WHATSAPP_CONNECT` → `whatsappService.connect()`
- `WHATSAPP_DISCONNECT` → `whatsappService.disconnect()`
- `WHATSAPP_GET_STATUS` → `whatsappService.getConnectionState()`
- `WHATSAPP_REQUEST_PAIRING_CODE` → `whatsappService.requestPairingCode(phoneNumber)`

Message handlers:
- `WHATSAPP_SEND_MESSAGE` → `whatsappService.sendMessage(jid, content)`
- `WHATSAPP_GET_MESSAGES` → `whatsappService.getMessages(jid, since, limit)`

Conversation handlers:
- `WHATSAPP_LIST_CONVERSATIONS` → `whatsappService.listConversations()`
- `WHATSAPP_GET_CONVERSATION` → `whatsappService.getConversation(jid)`
- `WHATSAPP_REGISTER_CONVERSATION` → `whatsappService.registerConversation(jid, config)`
- `WHATSAPP_UPDATE_CONVERSATION` → `whatsappService.updateConversation(jid, updates)`
- `WHATSAPP_UNREGISTER_CONVERSATION` → `whatsappService.unregisterConversation(jid)`

Agent handlers:
- `WHATSAPP_SET_MODE` → `agentService.setConversationMode(jid, mode)`
- `WHATSAPP_GET_MODE` → `agentService.getConversationMode(jid)`

Memory handlers:
- `WHATSAPP_MEMORY_SEARCH` → `memoryService.search(options)`
- `WHATSAPP_MEMORY_INDEX` → `memoryService.indexText(source, sourceId, text)`
- `WHATSAPP_MEMORY_STATS` → `memoryService.getStats()`
- `WHATSAPP_MEMORY_CLEAR` → `memoryService.clear()`

Task handlers:
- `WHATSAPP_TASK_LIST` → `schedulerService.listTasks(status)`
- `WHATSAPP_TASK_CREATE` → `schedulerService.createTask(task)`
- `WHATSAPP_TASK_UPDATE` → `schedulerService.updateTask(id, updates)`
- `WHATSAPP_TASK_DELETE` → `schedulerService.deleteTask(id)`

Heartbeat handlers:
- `WHATSAPP_HEARTBEAT_START` → `heartbeatService.start()`
- `WHATSAPP_HEARTBEAT_STOP` → `heartbeatService.stop()`
- `WHATSAPP_HEARTBEAT_STATUS` → `{ running: heartbeatService.isRunning(), lastResult }`
- `WHATSAPP_HEARTBEAT_TRIGGER` → `heartbeatService.triggerNow()`

Identity handlers:
- `WHATSAPP_IDENTITY_GET` → `identityService.getIdentity()`
- `WHATSAPP_IDENTITY_UPDATE` → `identityService.update[Soul|User|Heartbeat]Md(content)`

Config handlers:
- `WHATSAPP_CONFIG_GET` → `configStore.getWhatsAppConfig()`
- `WHATSAPP_CONFIG_SET` → `configStore.setWhatsAppConfig(key, value)`

**Event forwarding (main → renderer):**

**IMPORTANT:** `sendToAllWindows` is currently defined locally in `ideas-handlers.ts` and NOT a shared utility. You MUST either:
1. Extract it to a shared utility (e.g., `src/main/ipc/utils.ts`) and import it, OR
2. Define a local version in `whatsapp-handlers.ts` using the same pattern:
```typescript
function sendToAllWindows(channel: string, data: unknown) {
  BrowserWindow.getAllWindows().forEach(win => {
    win.webContents.send(channel, data)
  })
}
```

Wire up service EventEmitter events to IPC broadcasts:
```typescript
whatsappService.on('connection-update', (state) => {
  sendToAllWindows(WHATSAPP_IPC_CHANNELS.WHATSAPP_CONNECTION_UPDATE, state)
})
whatsappService.on('message-received', (msg) => {
  sendToAllWindows(WHATSAPP_IPC_CHANNELS.WHATSAPP_MESSAGE_RECEIVED, msg)
})
agentService.on('stream-chunk', (data) => {
  sendToAllWindows(WHATSAPP_IPC_CHANNELS.WHATSAPP_AGENT_STREAM, data)
})
heartbeatService.on('heartbeat-result', (result) => {
  sendToAllWindows(WHATSAPP_IPC_CHANNELS.WHATSAPP_HEARTBEAT_RESULT, result)
})
schedulerService.on('task-executed', (log) => {
  sendToAllWindows(WHATSAPP_IPC_CHANNELS.WHATSAPP_TASK_EXECUTED, log)
})
```

**Registration in index.ts:**
Add `registerWhatsAppHandlers()` call in `registerIpcHandlers()`.

**Acceptance Criteria:**
- All handlers registered and callable from renderer
- Consistent `{ success, data, error }` response format
- Event forwarding from all services to renderer
- No unhandled promise rejections (all wrapped in try/catch)

---

### [P4-T2] Preload API Extension
**Agent: W2**
**Depends on:** P1-T2 (IPC channels), P1-T1 (types)
**Parallel with:** P4-T1
**Files:**
- EDIT `src/preload/index.ts` (add whatsapp namespace)

**Specification:**

Add `whatsapp` namespace to the preload API following the existing pattern. The preload exposes APIs as `window.electron` (NOT `window.electronAPI`), e.g. `window.electron.whatsapp.connect()`. Use `WHATSAPP_IPC_CHANNELS` from `whatsapp-ipc-channels.ts`.

```typescript
whatsapp: {
  // Connection
  connect: () => ipcRenderer.invoke(IPC_CHANNELS.WHATSAPP_CONNECT),
  disconnect: () => ipcRenderer.invoke(IPC_CHANNELS.WHATSAPP_DISCONNECT),
  getStatus: () => ipcRenderer.invoke(IPC_CHANNELS.WHATSAPP_GET_STATUS),
  requestPairingCode: (phone: string) => ipcRenderer.invoke(IPC_CHANNELS.WHATSAPP_REQUEST_PAIRING_CODE, phone),
  onConnectionUpdate: (cb: (state: WhatsAppConnectionState) => void) => {
    const handler = (_e: any, state: WhatsAppConnectionState) => cb(state)
    ipcRenderer.on(IPC_CHANNELS.WHATSAPP_CONNECTION_UPDATE, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.WHATSAPP_CONNECTION_UPDATE, handler)
  },

  // Messages
  sendMessage: (jid: string, content: string) => ipcRenderer.invoke(IPC_CHANNELS.WHATSAPP_SEND_MESSAGE, jid, content),
  getMessages: (jid: string, since?: number, limit?: number) => ipcRenderer.invoke(IPC_CHANNELS.WHATSAPP_GET_MESSAGES, jid, since, limit),
  onMessageReceived: (cb: (msg: WhatsAppMessage) => void) => { /* ... */ },
  onMessageSent: (cb: (msg: WhatsAppMessage) => void) => { /* ... */ },

  // Conversations
  listConversations: () => ipcRenderer.invoke(IPC_CHANNELS.WHATSAPP_LIST_CONVERSATIONS),
  getConversation: (jid: string) => ipcRenderer.invoke(IPC_CHANNELS.WHATSAPP_GET_CONVERSATION, jid),
  registerConversation: (jid: string, config: Partial<WhatsAppConversation>) => ipcRenderer.invoke(IPC_CHANNELS.WHATSAPP_REGISTER_CONVERSATION, jid, config),
  updateConversation: (jid: string, updates: Partial<WhatsAppConversation>) => ipcRenderer.invoke(IPC_CHANNELS.WHATSAPP_UPDATE_CONVERSATION, jid, updates),
  unregisterConversation: (jid: string) => ipcRenderer.invoke(IPC_CHANNELS.WHATSAPP_UNREGISTER_CONVERSATION, jid),

  // Agent
  setMode: (jid: string, mode: WhatsAppAgentMode) => ipcRenderer.invoke(IPC_CHANNELS.WHATSAPP_SET_MODE, jid, mode),
  getMode: (jid: string) => ipcRenderer.invoke(IPC_CHANNELS.WHATSAPP_GET_MODE, jid),
  onAgentStream: (cb: (data: any) => void) => { /* ... */ },

  // Memory
  memorySearch: (options: MemorySearchOptions) => ipcRenderer.invoke(IPC_CHANNELS.WHATSAPP_MEMORY_SEARCH, options),
  memoryIndex: (source: MemorySource, sourceId: string, text: string) => ipcRenderer.invoke(IPC_CHANNELS.WHATSAPP_MEMORY_INDEX, source, sourceId, text),
  memoryStats: () => ipcRenderer.invoke(IPC_CHANNELS.WHATSAPP_MEMORY_STATS),
  memoryClear: () => ipcRenderer.invoke(IPC_CHANNELS.WHATSAPP_MEMORY_CLEAR),

  // Tasks
  taskList: (status?: TaskStatus) => ipcRenderer.invoke(IPC_CHANNELS.WHATSAPP_TASK_LIST, status),
  taskCreate: (task: any) => ipcRenderer.invoke(IPC_CHANNELS.WHATSAPP_TASK_CREATE, task),
  taskUpdate: (id: string, updates: any) => ipcRenderer.invoke(IPC_CHANNELS.WHATSAPP_TASK_UPDATE, id, updates),
  taskDelete: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.WHATSAPP_TASK_DELETE, id),
  onTaskExecuted: (cb: (log: TaskRunLog) => void) => { /* ... */ },

  // Heartbeat
  heartbeatStart: () => ipcRenderer.invoke(IPC_CHANNELS.WHATSAPP_HEARTBEAT_START),
  heartbeatStop: () => ipcRenderer.invoke(IPC_CHANNELS.WHATSAPP_HEARTBEAT_STOP),
  heartbeatStatus: () => ipcRenderer.invoke(IPC_CHANNELS.WHATSAPP_HEARTBEAT_STATUS),
  heartbeatTrigger: () => ipcRenderer.invoke(IPC_CHANNELS.WHATSAPP_HEARTBEAT_TRIGGER),
  onHeartbeatResult: (cb: (result: HeartbeatResult) => void) => { /* ... */ },

  // Identity
  identityGet: () => ipcRenderer.invoke(IPC_CHANNELS.WHATSAPP_IDENTITY_GET),
  identityUpdate: (field: string, content: string) => ipcRenderer.invoke(IPC_CHANNELS.WHATSAPP_IDENTITY_UPDATE, field, content),

  // Config
  configGet: () => ipcRenderer.invoke(IPC_CHANNELS.WHATSAPP_CONFIG_GET),
  configSet: (key: string, value: any) => ipcRenderer.invoke(IPC_CHANNELS.WHATSAPP_CONFIG_SET, key, value),

  // BVS Progress
  onBvsProgress: (cb: (data: any) => void) => { /* ... */ },
}
```

**Acceptance Criteria:**
- All methods typed and callable from renderer
- Event listeners return unsubscribe functions
- No direct Node.js access exposed to renderer
- Import types from `@shared/whatsapp-types`

---

## Phase 5: Renderer UI (Depends on Phase 4)

### [P5-T1] Zustand Store
**Agent: W1**
**Depends on:** P4-T2 (preload API)
**Parallel with:** P5-T2, P5-T3, P5-T4, P5-T5
**Files:**
- CREATE `src/renderer/stores/whatsapp-store.ts`

**Specification:**

Create Zustand store for WhatsApp state management. Follow the existing store patterns (see `session-store.ts`, `ideas-store.ts`).

**IMPORTANT:** Existing stores use `persist` middleware with `partialize` for selective persistence. Follow the same pattern:
```typescript
export const useWhatsAppStore = create<WhatsAppStore>()(
  persist(
    (set, get) => ({
      // ... state and actions
    }),
    {
      name: 'whatsapp-store',
      partialize: (state) => ({
        // Only persist non-transient state
        activeConversationJid: state.activeConversationJid,
        // Do NOT persist: messages, streaming state, connection state
      }),
    }
  )
)
```

**Store Shape:**
```typescript
interface WhatsAppStore {
  // Connection
  connectionState: WhatsAppConnectionState
  setConnectionState: (state: WhatsAppConnectionState) => void

  // Conversations
  conversations: WhatsAppConversation[]
  activeConversationJid: string | null
  setConversations: (convos: WhatsAppConversation[]) => void
  setActiveConversation: (jid: string | null) => void
  updateConversation: (jid: string, updates: Partial<WhatsAppConversation>) => void

  // Messages
  messages: Record<string, WhatsAppMessage[]>  // jid -> messages
  setMessages: (jid: string, msgs: WhatsAppMessage[]) => void
  addMessage: (jid: string, msg: WhatsAppMessage) => void

  // Agent
  agentStreaming: Record<string, boolean>      // jid -> isStreaming
  agentStreamText: Record<string, string>      // jid -> current partial text
  setAgentStreaming: (jid: string, streaming: boolean) => void
  appendAgentStreamText: (jid: string, chunk: string) => void
  clearAgentStreamText: (jid: string) => void

  // Tasks
  tasks: ScheduledTask[]
  setTasks: (tasks: ScheduledTask[]) => void

  // Heartbeat
  heartbeatRunning: boolean
  lastHeartbeatResult: HeartbeatResult | null
  setHeartbeatRunning: (running: boolean) => void
  setLastHeartbeatResult: (result: HeartbeatResult) => void

  // Memory
  memoryStats: { totalChunks: number; totalSources: number; dbSizeBytes: number } | null
  setMemoryStats: (stats: any) => void

  // UI
  showQrModal: boolean
  showSettings: boolean
  setShowQrModal: (show: boolean) => void
  setShowSettings: (show: boolean) => void

  // Actions (call preload API + update store)
  connect: () => Promise<void>
  disconnect: () => Promise<void>
  sendMessage: (jid: string, text: string) => Promise<void>
  loadConversations: () => Promise<void>
  loadMessages: (jid: string) => Promise<void>
  registerConversation: (jid: string, config: Partial<WhatsAppConversation>) => Promise<void>
}
```

**Acceptance Criteria:**
- All state management for WhatsApp UI
- Actions call preload API and update store
- IPC event listeners wired up on store initialization
- Cleanup listeners on unmount

---

### [P5-T2] WhatsApp View (Main Container)
**Agent: W2**
**Depends on:** P5-T1 (store), P4-T2 (preload)
**Parallel with:** P5-T3, P5-T4, P5-T5
**Files:**
- CREATE `src/renderer/components/whatsapp/WhatsAppView.tsx`

**Specification:**

Main container component with 3-column layout:
1. Left sidebar: ConversationList (250px)
2. Center: ChatWindow (flex-grow)
3. Right panel: Details/Settings (300px, toggleable)

Top bar shows connection status with connect/disconnect button.
Renders QrCodeModal when `showQrModal` is true.

Follow existing component patterns (see `BvsView.tsx` for layout structure).

**IMPORTANT:** The app uses panel-based routing via `useUIStore.activePanel`, NOT React Router. Add `'whatsapp'` as a new panel value. The WhatsAppView renders when `activePanel === 'whatsapp'`. Update the main layout component to conditionally render `<WhatsAppView />` for this panel.

**Acceptance Criteria:**
- 3-column responsive layout
- Connection status indicator (green/yellow/red dot + status text)
- Connect/disconnect button in top bar
- Renders child components correctly
- Registered as `'whatsapp'` panel in `useUIStore` (follows existing panel pattern: files, browser, worktrees, autonomous, ideas, bvs, settings)

---

### [P5-T3] Conversation List
**Agent: W3**
**Depends on:** P5-T1 (store)
**Parallel with:** P5-T2, P5-T4, P5-T5
**Files:**
- CREATE `src/renderer/components/whatsapp/ConversationList.tsx`

**Specification:**

Scrollable list of conversations with:
- Search/filter input at top
- Each item shows: avatar placeholder (first letter), name, last message preview, timestamp, unread count badge
- Active conversation highlighted
- Registered conversations marked with a small indicator
- Sort by last message time (most recent first)
- Click to select conversation (sets activeConversationJid)
- Right-click context menu: Register/Unregister, Set Mode, Link Project

**Acceptance Criteria:**
- Conversations sorted by recency
- Unread count badges
- Search filtering by name
- Active conversation highlighted
- Context menu for conversation management

---

### [P5-T4] Chat Window
**Agent: W4**
**Depends on:** P5-T1 (store)
**Parallel with:** P5-T2, P5-T3, P5-T5
**Files:**
- CREATE `src/renderer/components/whatsapp/ChatWindow.tsx`

**Specification:**

Full chat interface with:
- Message list (scrollable, auto-scroll to bottom on new message)
- Message bubbles: left-aligned for inbound, right-aligned for outbound
- Timestamps on messages (relative: "2m ago", "1h ago", "Yesterday")
- Agent responses highlighted with different background color
- Streaming indicator: pulsing dots while agent is generating
- Partial streaming text shown in real-time
- Input area at bottom: text input + send button + mode selector dropdown
- Mode selector shows current mode (chat/quick_fix/research/bvs_spawn/auto)
- Support markdown rendering in messages (code blocks, bold, lists)
- Support quoted/reply messages display
- Empty state when no conversation selected

**Acceptance Criteria:**
- Messages rendered correctly with sender attribution
- Auto-scroll on new messages
- Streaming text visible in real-time
- Mode selector changes conversation mode
- Markdown rendered in message content
- Input submits on Enter (Shift+Enter for newline)
- Empty state shown when no conversation selected

---

### [P5-T5] QR Code Modal & Settings
**Agent: W5**
**Depends on:** P5-T1 (store)
**Parallel with:** P5-T2, P5-T3, P5-T4
**Files:**
- CREATE `src/renderer/components/whatsapp/QrCodeModal.tsx`
- CREATE `src/renderer/components/whatsapp/WhatsAppSettings.tsx`

**Specification:**

**QrCodeModal:**
- Modal overlay showing QR code image
- Alternative: pairing code input field (8-character code)
- Status text showing connection progress
- Close button
- Auto-close on successful connection
- Use `qrcode` npm package (or render from base64 data)

**WhatsAppSettings:**
- Tabbed settings panel:
  - **General**: Assistant name, trigger pattern, default mode, debounce ms, rate limit
  - **Heartbeat**: Enable/disable, interval, target conversation, max budget
  - **Memory**: Enable/disable, embedding provider, API key, auto-index toggles
  - **Identity**: Edit SOUL.md, USER.md, HEARTBEAT.md (embedded markdown editors)
  - **Tasks**: List of scheduled tasks with create/edit/delete
  - **Advanced**: Auth directory, self-chat mode, max concurrent agents

**Acceptance Criteria:**
- QR code displays correctly from base64 data
- Pairing code alternative works
- Settings save to config store
- SOUL.md/USER.md editors save to identity service
- Task CRUD from settings panel
- All settings use sensible defaults

---

## Phase 6: Integration & Polish (Depends on Phase 5)

### [P6-T1] Service Initialization & Wiring
**Agent: W1**
**Depends on:** All Phase 3 & 4 tasks
**Parallel with:** P6-T2, P6-T3
**Files:**
- EDIT `src/main/index.ts` (service initialization)

**Specification:**

Wire up all new services in the main process initialization.

**IMPORTANT:** The main process uses `app.whenReady().then(() => { ... })` pattern, NOT top-level async/await. Wrap async initialization in an async IIFE inside the `.then()` callback:

```typescript
// Inside app.whenReady().then(() => { ... })
// Use async IIFE for await calls:
;(async () => {
  const configStore = getConfigStore()
  const whatsappConfig = configStore.getWhatsAppConfig()

  if (whatsappConfig.enabled) {
    // Phase 2 services (no inter-dependencies)
    const identityService = new AgentIdentityService(configStore)
    const memoryService = new VectorMemoryService(configStore)
    const queueService = new GroupQueueService(whatsappConfig.maxConcurrentAgents)
    const whatsappService = new WhatsAppService(configStore)

    // Initialize async services
    await identityService.initialize()
    await memoryService.initialize()

    // Phase 3 services (depend on Phase 2)
    const agentService = new WhatsAppAgentService(
      whatsappService, memoryService, identityService, queueService, configStore
    )
    const schedulerService = new TaskSchedulerService(queueService, whatsappService)
    const heartbeatService = new HeartbeatService(
      whatsappService, identityService, configStore,
      ideasManager,      // pass reference to existing IdeasManager
      bvsOrchestrator    // pass reference to existing BVS orchestrator
    )

    // Wire queue processing functions
    queueService.setProcessMessagesFn((jid) => agentService.processMessages(jid))
    queueService.setProcessTaskFn((jid, task) => agentService.processTask(jid, task))

    // Auto-connect if configured
    if (whatsappConfig.autoConnect) {
      whatsappService.connect().catch(err => logger.error('WhatsApp auto-connect failed:', err))
    }

    // Start scheduler if tasks exist
    schedulerService.start()

    // Start heartbeat if enabled
    if (whatsappConfig.heartbeat.enabled) {
      heartbeatService.start()
    }
  }
})().catch(err => logger.error('WhatsApp initialization failed:', err))
```

**BVS Progress Forwarding:**
Subscribe to existing BVS orchestrator events and forward to WhatsApp:
```typescript
bvsOrchestrator.on('section-completed', (event) => {
  if (whatsappService?.isConnected()) {
    const targetJid = whatsappConfig.heartbeat.targetConversationJid
    if (targetJid) {
      whatsappService.sendMessage(targetJid,
        `BVS Update: Section "${event.sectionName}" completed (${event.status}).`
      )
    }
  }
})
```

**Acceptance Criteria:**
- All services initialized in correct dependency order
- Auto-connect works on app launch
- BVS progress forwarded to WhatsApp
- Services gracefully handle WhatsApp being disabled
- Clean shutdown on app quit (disconnect WhatsApp, stop scheduler, stop heartbeat)

---

### [P6-T2] Sidebar Navigation Integration
**Agent: W2**
**Depends on:** P5-T2 (WhatsApp view)
**Parallel with:** P6-T1, P6-T3
**Files:**
- EDIT `src/renderer/components/layout/Sidebar.tsx`

**Specification:**

Add WhatsApp icon to the sidebar navigation. Use a chat bubble or phone icon. Show connection status indicator (green dot when connected, grey when disconnected). Badge showing total unread count across all conversations.

**IMPORTANT:** Navigation uses `useUIStore()` with `setActivePanel('whatsapp')`, NOT React Router. Follow the existing sidebar pattern where each nav item calls `setActivePanel()`.

**Acceptance Criteria:**
- WhatsApp nav item in sidebar with `setActivePanel('whatsapp')` onClick
- Connection status dot (reads from `useWhatsAppStore().connectionState`)
- Unread count badge
- Clicking sets active panel to WhatsAppView

---

### [P6-T3] API Server Routes (SSH/Remote Access)
**Agent: W3**
**Depends on:** P4-T1 (IPC handlers), all P2/P3 services
**Parallel with:** P6-T1, P6-T2
**Files:**
- EDIT `src/main/api-server/index.ts` (add WhatsApp routes)

**Specification:**

Add REST endpoints and WebSocket channels for WhatsApp access from the SSH laptop.

REST endpoints:
- `GET /api/whatsapp/status` - Connection state
- `GET /api/whatsapp/conversations` - List conversations
- `GET /api/whatsapp/conversations/:jid/messages` - Get messages
- `POST /api/whatsapp/conversations/:jid/messages` - Send message
- `GET /api/whatsapp/tasks` - List scheduled tasks
- `POST /api/whatsapp/tasks` - Create task
- `GET /api/whatsapp/heartbeat` - Heartbeat status
- `POST /api/whatsapp/heartbeat/trigger` - Trigger heartbeat

WebSocket channels:
- `whatsapp:message` - New message events
- `whatsapp:agent-stream` - Agent response streaming
- `whatsapp:heartbeat` - Heartbeat results
- `whatsapp:bvs-progress` - BVS progress updates

**Acceptance Criteria:**
- All endpoints authenticated (Bearer token)
- WebSocket channels broadcast in real-time
- SSH laptop can send/receive WhatsApp messages via API
- Consistent response format with existing API endpoints

---

## Dependency Graph

```
Phase 0 (Dependencies) - SEQUENTIAL
└── P0-T1: Install Dependencies ─── No dependencies (must complete first)

Phase 1 (Foundation) - ALL PARALLEL
├── P1-T1: Shared Types        ─┐
├── P1-T2: IPC Channels        ─┤── Depends on P0-T1
├── P1-T3: Identity Files      ─┤
└── P1-T4: Config Store Ext    ─┘

Phase 2 (Core Services) - ALL PARALLEL (each depends on P1)
├── P2-T1: WhatsApp Service    ─── depends on P1-T1, P1-T2, P1-T4
├── P2-T2: Vector Memory       ─── depends on P1-T1, P1-T4
├── P2-T3: Group Queue         ─── depends on P1-T1
└── P2-T4: Agent Identity      ─── depends on P1-T1, P1-T3, P1-T4

Phase 3 (Agent & Processing) - ALL PARALLEL (each depends on P2)
├── P3-T1: Agent Service       ─── depends on P2-T1, P2-T2, P2-T3, P2-T4
├── P3-T2: Task Scheduler      ─── depends on P2-T1, P2-T3
└── P3-T3: Heartbeat Service   ─── depends on P2-T1, P2-T4

Phase 4 (IPC & Preload) - PARALLEL
├── P4-T1: IPC Handlers        ─── depends on P3-T1, P3-T2, P3-T3
└── P4-T2: Preload Extension   ─── depends on P1-T1, P1-T2

Phase 5 (UI) - ALL PARALLEL
├── P5-T1: Zustand Store       ─── depends on P4-T2
├── P5-T2: WhatsApp View       ─── depends on P5-T1
├── P5-T3: Conversation List   ─── depends on P5-T1
├── P5-T4: Chat Window         ─── depends on P5-T1
└── P5-T5: QR Modal + Settings ─── depends on P5-T1

Phase 6 (Integration) - ALL PARALLEL
├── P6-T1: Service Wiring      ─── depends on P3-*, P4-*
├── P6-T2: Sidebar Nav         ─── depends on P5-T2
└── P6-T3: API Server Routes   ─── depends on P4-T1
```

## Maximum Parallelism Plan

**Round 0** (1 agent): P0-T1 (dependency installation - must complete first)
**Round 1** (4 agents): P1-T1, P1-T2, P1-T3, P1-T4
**Round 2** (4 agents): P2-T1, P2-T2, P2-T3, P2-T4
**Round 3** (3 agents + 1): P3-T1, P3-T2, P3-T3, P4-T2
**Round 4** (1 agent): P4-T1
**Round 5** (5 agents): P5-T1, P5-T2, P5-T3, P5-T4, P5-T5
**Round 6** (3 agents): P6-T1, P6-T2, P6-T3

**Total: 7 rounds, 21 tasks, max 5 agents per round**

## New Dependencies to Install

```bash
npm install @whiskeysockets/baileys     # WhatsApp connection
npm install better-sqlite3              # SQLite driver (NOT currently in package.json)
npm install @types/better-sqlite3 -D    # TypeScript types for better-sqlite3
npm install sqlite-vec                  # Vector search extension for SQLite
npm install cron-parser                 # Cron expression parsing
npm install @huggingface/transformers   # Local embedding model (fallback) - NOTE: was renamed from @xenova/transformers
npm install qrcode                      # QR code rendering in UI
npm install @types/qrcode -D           # TypeScript types for qrcode
```

**IMPORTANT:** `better-sqlite3` is NOT currently in package.json - it MUST be installed. Run `npx electron-rebuild` after installing native modules (better-sqlite3, sqlite-vec).

## Testing Strategy

Each phase should include basic verification:
- **Phase 1**: `tsc --noEmit` compiles cleanly
- **Phase 2**: Unit tests for each service (connection mock for WhatsApp, in-memory SQLite for memory)
- **Phase 3**: Integration tests (agent service with mocked WhatsApp + real Agent SDK)
- **Phase 4**: IPC round-trip tests (invoke handler, verify response format)
- **Phase 5**: Component renders without errors (basic React render tests)
- **Phase 6**: End-to-end smoke test (connect WhatsApp, send message, get response)

## Cost Projections

| Usage Pattern | Estimated Monthly Cost |
|---|---|
| Casual (10 messages/day, chat mode, Haiku) | $5-10 |
| Active (30 messages/day, mixed modes) | $20-40 |
| Heavy (50+ messages/day, BVS spawns, research) | $50-100 |
| Heartbeat (30 min, cheap-checks-first) | $2-5 |
| Heartbeat (misconfigured, always LLM) | $50+ |
| Embeddings (Voyage, 10K chunks) | $0.20 |
| Embeddings (local Transformers.js) | $0 |

## Risk Mitigations

| Risk | Mitigation | Fallback |
|---|---|---|
| Baileys native modules fail on Windows | Try `electron-rebuild` with MSVC + Rust | Use Evolution API (Docker REST wrapper) |
| WhatsApp account ban | Dedicated number, rate limits, human-like delays | Switch to WhatsApp Cloud API |
| sqlite-vec Windows issues | Test with electron-rebuild | Use LanceDB instead |
| Context window exhaustion | Vector memory limits to 3-5 chunks | Archive old conversations |
| Cost runaway | maxBudgetUsd per query, daily caps, cheap heartbeat | Alert at threshold, auto-pause |
| Agent SDK Windows MCP issues | Use HTTP/SSE MCP servers | Skip external MCP, use in-process only |

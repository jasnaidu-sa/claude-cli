// src/shared/whatsapp-types.ts

// ============================================================
// Connection & Auth
// ============================================================

/** Possible states of the WhatsApp connection lifecycle. */
export type WhatsAppConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'qr_ready'
  | 'pairing'
  | 'connected'
  | 'reconnecting'
  | 'logged_out'

/** Represents the full connection state of the WhatsApp service, including QR/pairing data and error info. */
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

/** Supported WhatsApp message content types. */
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

/** Direction of a WhatsApp message relative to the assistant. */
export type WhatsAppMessageDirection = 'inbound' | 'outbound'

/** A single WhatsApp message with metadata for agent processing and conversation tracking. */
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

/** Type of WhatsApp chat: direct message, group, or self-chat. */
export type WhatsAppChatType = 'dm' | 'group' | 'self'

/** A WhatsApp conversation with registration state, trigger configuration, and linked project info. */
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

/** Available agent operational modes that control tool access, model selection, and behavior. */
export type WhatsAppAgentMode =
  | 'chat'       // conversational, memory tools, read-only file access
  | 'quick_fix'  // fast, minimal tools, Haiku model
  | 'research'   // web search, thorough, Sonnet model
  | 'bvs_spawn'  // full orchestration, can trigger BVS workflows
  | 'auto'       // detect mode from message content

/** Configuration for a specific agent mode, including model, tool access, and cost limits. */
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

/** How a scheduled task is triggered: cron expression, fixed interval, or one-time execution. */
export type TaskScheduleType = 'cron' | 'interval' | 'once'

/** Current lifecycle status of a scheduled task. */
export type TaskStatus = 'active' | 'paused' | 'completed' | 'failed'

/** Whether a task runs in the context of its conversation or in isolation. */
export type TaskContextMode = 'conversation' | 'isolated'

/** A scheduled task that runs agent prompts on a cron, interval, or one-time basis. */
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

/** Log entry for a single execution of a scheduled task, including duration, cost, and outcome. */
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

/** Configuration for the proactive heartbeat monitoring system. */
export interface HeartbeatConfig {
  enabled: boolean
  intervalMs: number           // default: 1800000 (30 min)
  targetConversationJid: string // where to send alerts
  heartbeatMdPath: string      // path to HEARTBEAT.md
  cheapChecksFirst: boolean    // run file checks before LLM
  maxBudgetPerBeatUsd: number  // cost cap per heartbeat
}

/** Result of a single heartbeat execution, including alerts raised and cost incurred. */
export interface HeartbeatResult {
  timestamp: number
  status: 'ok' | 'alert' | 'error'
  alerts: HeartbeatAlert[]
  costUsd: number
  durationMs: number
}

/** An individual alert raised during a heartbeat check. */
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

/** Source category for a memory chunk, indicating where the information originated. */
export type MemorySource = 'conversation' | 'project' | 'user_note' | 'agent_learning'

/** A chunk of text stored in vector memory with its source metadata and embedding model info. */
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

/** A memory search result combining a chunk with its hybrid search scores. */
export interface MemorySearchResult {
  chunk: MemoryChunk
  score: number                // 0-1 combined hybrid score
  vectorScore: number
  textScore: number
}

/** Options for searching vector memory, including query text, filters, and hybrid search weights. */
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

/** The assembled agent identity context loaded from SOUL.md, USER.md, HEARTBEAT.md, and project files. */
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

/** Top-level WhatsApp integration configuration including connection, agent, heartbeat, memory, and identity settings. */
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
  ackReactionEmoji: string     // default: '\u26A1'
  selfChatMode: boolean        // respond in self-chat
  rateLimitPerMinute: number   // default: 10
  heartbeat: HeartbeatConfig
  memory: VectorMemoryConfig
  identity: AgentIdentityConfig
  modeConfigs: Record<WhatsAppAgentMode, AgentModeConfig>
}

/** Configuration for the vector memory subsystem, including embedding provider and chunking parameters. */
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

/** Configuration for the agent identity file paths (SOUL.md, USER.md, HEARTBEAT.md). */
export interface AgentIdentityConfig {
  workspacePath: string        // default: userData/whatsapp-workspace/
  soulMdPath: string           // relative to workspace
  userMdPath: string
  heartbeatMdPath: string
}

// ============================================================
// Events (Main -> Renderer)
// ============================================================

/** An event emitted from the main process to the renderer for WhatsApp state updates. */
export interface WhatsAppEvent {
  type: WhatsAppEventType
  timestamp: number
  data: unknown
}

/** All possible WhatsApp event types emitted from main to renderer. */
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

/** Standard IPC response wrapper for all WhatsApp handler responses. */
export interface WhatsAppIpcResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

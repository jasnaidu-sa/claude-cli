// src/shared/skills-types.ts
// Types for the Skills-as-Markdown self-extension system

// ============================================================
// Skill Definition (parsed from SKILL.md YAML frontmatter)
// ============================================================

/** Trigger types that can activate a skill. */
export interface SkillTrigger {
  /** Cron expression (e.g., "0 8 * * *") */
  cron?: string
  /** Explicit command prefix (e.g., "/digest") */
  command?: string
  /** Natural language keyword patterns */
  keywords?: string[]
  /** Event name from the system */
  event?: string
}

/** Permission manifest for a skill, defining its allowed capabilities. */
export interface SkillPermissions {
  version: number
  risk_tier: 0 | 1 | 2 | 3 | 4
  declared_purpose: string
  generated_by: 'manual' | 'agent_request' | 'pattern_crystallization'
  filesystem?: {
    read?: string[]
    write?: string[]
  }
  network?: {
    allowed_domains?: string[]
    methods?: string[]
  }
  env_access?: string[]
  exec?: string[]
  expiry?: string
  checksum?: string
}

/** JSON schema entry for a single config field. */
export interface SkillConfigSchemaField {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object'
  default?: unknown
  description?: string
  items?: SkillConfigSchemaField
}

/** YAML frontmatter parsed from a SKILL.md file. */
export interface SkillFrontmatter {
  id: string
  name: string
  description: string
  version: string
  active: boolean
  triggers: SkillTrigger[]
  config_schema?: Record<string, SkillConfigSchemaField>
  requires?: string[]
  metadata?: {
    permissions?: SkillPermissions
    [key: string]: unknown
  }
}

/** A fully loaded skill definition with frontmatter + body. */
export interface SkillDefinition {
  /** Unique ID from frontmatter */
  id: string
  /** Parsed YAML frontmatter */
  frontmatter: SkillFrontmatter
  /** Markdown body (instructions for the agent) */
  body: string
  /** Absolute path to the SKILL.md file */
  filePath: string
  /** Source tier: bundled < managed < workspace */
  tier: SkillTier
  /** Whether the skill is currently enabled */
  active: boolean
  /** Last modification timestamp */
  lastModified: number
}

/** Three-tier skill hierarchy (highest to lowest precedence). */
export type SkillTier = 'workspace' | 'managed' | 'bundled'

// ============================================================
// Skill Config (runtime user config per skill)
// ============================================================

/** Runtime configuration for a skill instance. */
export interface SkillRuntimeConfig {
  skillId: string
  active: boolean
  config: Record<string, unknown>
  lastExecuted?: number
  executionCount: number
  totalCostUsd: number
  lastError?: string
}

// ============================================================
// Skill Execution
// ============================================================

export type SkillExecutionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

/** Result of executing a skill. */
export interface SkillExecutionResult {
  skillId: string
  status: SkillExecutionStatus
  startedAt: number
  completedAt?: number
  durationMs: number
  costUsd: number
  output?: string
  error?: string
  triggeredBy: 'cron' | 'command' | 'keyword' | 'event' | 'manual'
}

// ============================================================
// Pattern Crystallization (Foundry-inspired)
// ============================================================

/** A recorded observation of agent tool usage. */
export interface ToolPatternObservation {
  id: number
  sessionId: string
  goalSummary: string
  toolSequence: string[] // ordered tool names
  toolArgs: Record<string, unknown>[] // args per tool call
  outcome: 'success' | 'failure' | 'partial'
  durationMs: number
  costUsd: number
  timestamp: number
  source: 'whatsapp' | 'telegram' | 'system'
  quarantined: boolean
}

/** A candidate for crystallization - a pattern detected from observations. */
export interface CrystallizationCandidate {
  id: string
  pattern: string // human-readable pattern description
  toolSequence: string[]
  observationCount: number
  successRate: number
  averageDurationMs: number
  averageCostUsd: number
  distinctSessions: number
  firstSeen: number
  lastSeen: number
  status: 'candidate' | 'proposed' | 'approved' | 'rejected' | 'expired'
  proposedSkillId?: string
  proposedSkillBody?: string
}

// ============================================================
// Scheduled Skill Tasks
// ============================================================

/** A cron-scheduled skill execution entry. */
export interface ScheduledSkillTask {
  skillId: string
  cronExpression: string
  nextRun: number
  lastRun?: number
  active: boolean
}

// ============================================================
// Agent Config (the writable portion)
// ============================================================

/** Agent-writable config (non-security settings). */
export interface AgentWritableConfig {
  skills: Record<string, SkillRuntimeConfig>
  llmRouting: Record<string, LlmRoutingEntry>
  displayPrefs: Record<string, unknown>
  digestSources: DigestSource[]
  customKeywords: Record<string, string> // keyword -> skillId mapping
}

/** LLM routing entry for a specific task type. */
export interface LlmRoutingEntry {
  provider: 'openrouter' | 'agent_sdk'
  model: string
  maxBudgetUsd?: number
}

/** A source for the daily digest skill. */
export interface DigestSource {
  name: string
  url: string
  type: 'rss' | 'hackernews' | 'api' | 'custom'
  enabled: boolean
}

// ============================================================
// Audit Trail
// ============================================================

export type AuditEventType =
  | 'skill_create'
  | 'skill_update'
  | 'skill_delete'
  | 'skill_toggle'
  | 'skill_execute'
  | 'config_modify'
  | 'tool_register'
  | 'task_schedule'
  | 'pattern_crystallize'
  | 'pattern_approve'

/** Append-only audit log entry. */
export interface AuditLogEntry {
  id: number
  timestamp: number
  eventType: AuditEventType
  permissionTier: number
  approvalMethod: 'auto' | 'user_confirm' | 'system'
  beforeHash?: string
  afterHash?: string
  sessionId?: string
  details: string
}

// ============================================================
// IPC Channels for Skills System
// ============================================================

export const SKILLS_IPC_CHANNELS = {
  // Skills management
  SKILLS_LIST: 'skills:list',
  SKILLS_GET: 'skills:get',
  SKILLS_CREATE: 'skills:create',
  SKILLS_UPDATE: 'skills:update',
  SKILLS_DELETE: 'skills:delete',
  SKILLS_TOGGLE: 'skills:toggle',
  SKILLS_GET_CONFIG: 'skills:get-config',
  SKILLS_SET_CONFIG: 'skills:set-config',
  SKILLS_EXECUTE: 'skills:execute',

  // Pattern crystallization
  PATTERNS_LIST_CANDIDATES: 'patterns:list-candidates',
  PATTERNS_APPROVE: 'patterns:approve',
  PATTERNS_REJECT: 'patterns:reject',

  // Scheduled tasks
  SKILLS_LIST_SCHEDULED: 'skills:list-scheduled',

  // Agent config
  AGENT_CONFIG_GET: 'agent-config:get',
  AGENT_CONFIG_SET: 'agent-config:set',

  // Audit
  AUDIT_GET_LOG: 'audit:get-log',

  // Events (main -> renderer)
  SKILLS_UPDATED: 'skills:updated',
  SKILLS_EXECUTION_RESULT: 'skills:execution-result',
  PATTERN_CANDIDATE_FOUND: 'pattern:candidate-found',
} as const

export type SkillsIpcChannel = typeof SKILLS_IPC_CHANNELS[keyof typeof SKILLS_IPC_CHANNELS]

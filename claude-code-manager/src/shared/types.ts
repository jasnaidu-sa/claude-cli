// Session types
export interface Session {
  id: string
  projectPath: string
  projectName: string
  status: SessionStatus
  editedFiles: EditedFile[]
  createdAt: number
}

export type SessionStatus = 'idle' | 'running' | 'thinking' | 'editing' | 'error'

export interface EditedFile {
  path: string
  action: FileAction
  timestamp: number
  status: 'pending' | 'completed'
}

export type FileAction = 'read' | 'edit' | 'write' | 'create' | 'delete'

// File tree types
export interface FileNode {
  id: string
  name: string
  path: string
  isDirectory: boolean
  children?: FileNode[]
  isEdited?: boolean
}

// Terminal output types
export interface TerminalOutput {
  sessionId: string
  data: string
  timestamp: number
}

// Browser types
export interface BrowserTab {
  id: string
  sessionId: string | null  // Link to session, null for standalone tabs
  url: string
  title: string
  isActive: boolean
  devServerPort?: number    // Auto-detected dev server port
}

// Browser control types (for Claude integration)
export interface BrowserSnapshot {
  url: string
  title: string
  html?: string
  accessibilityTree?: string
  consoleMessages: ConsoleMessage[]
  networkRequests: NetworkRequest[]
}

export interface ConsoleMessage {
  type: 'log' | 'warn' | 'error' | 'info' | 'debug'
  text: string
  timestamp: number
}

export interface NetworkRequest {
  url: string
  method: string
  status: number
  type: string
  timestamp: number
}

// Dev server types
export interface DevServerInfo {
  port: number
  url: string
  script: string
  running: boolean
}

// Orchestrator types
export type OrchestratorPhase = 'validation' | 'generation' | 'implementation'
export type OrchestratorStatus = 'idle' | 'starting' | 'running' | 'paused' | 'stopping' | 'completed' | 'error'
export type OrchestratorOutputType = 'stdout' | 'stderr' | 'system' | 'progress'

export interface OrchestratorConfig {
  projectPath: string
  workflowId: string
  phase: OrchestratorPhase
  model?: string
  supabaseProjectId?: string
  specFile?: string
}

export interface OrchestratorSession {
  id: string
  config: OrchestratorConfig
  status: OrchestratorStatus
  phase: OrchestratorPhase
  startedAt: number
  endedAt?: number
  exitCode?: number
  error?: string
  testsTotal?: number
  testsPassing?: number
}

export interface OrchestratorOutput {
  sessionId: string
  type: OrchestratorOutputType
  data: string
  timestamp: number
}

export interface OrchestratorProgress {
  sessionId: string
  phase: OrchestratorPhase
  testsTotal?: number
  testsPassing?: number
  currentTest?: string
  message?: string
}

// Workflow types
export type WorkflowStatus = 'pending' | 'validating' | 'generating' | 'implementing' | 'paused' | 'completed' | 'error'

export interface WorkflowConfig {
  id: string
  name: string
  description?: string
  projectPath: string
  worktreePath?: string
  specFile: string
  model: string
  status: WorkflowStatus
  createdAt: number
  updatedAt: number
  startedAt?: number
  completedAt?: number
  progress?: WorkflowProgress
  schemaValidation?: SchemaValidationResult
  error?: string
}

export interface WorkflowProgress {
  phase: OrchestratorPhase
  testsTotal: number
  testsPassing: number
  currentTest?: string
  categories?: CategoryProgress[]
}

export interface CategoryProgress {
  name: string
  total: number
  passing: number
}

export interface SchemaValidationResult {
  valid: boolean
  discrepancies: SchemaDiscrepancy[]
  validatedAt: number
}

export interface SchemaDiscrepancy {
  type: 'missing' | 'outdated' | 'inconsistent'
  location: string
  message: string
  severity: 'warning' | 'error'
}


// Checkpoint types (Harness Framework - Reliability Solution)
export type CheckpointType =
  | 'category_complete'    // After completing all tests in a category
  | 'failure_threshold'    // When N consecutive failures occur
  | 'risk_boundary'        // Before risky operations (DB migrations, etc.)
  | 'feature_complete'     // After completing a major feature
  | 'manual'               // User-requested checkpoint

export type CheckpointStatus = 'pending' | 'approved' | 'rejected' | 'rolled_back' | 'skipped'

export interface Checkpoint {
  id: string
  workflowId: string
  sessionId: string
  type: CheckpointType
  status: CheckpointStatus
  createdAt: number
  resolvedAt?: number
  resolvedBy?: 'user' | 'auto'

  // Context at checkpoint creation
  context: CheckpointContext

  // User feedback if rejected
  feedback?: string

  // Rollback info if rolled back
  rollbackTarget?: string  // Git commit SHA or checkpoint ID to rollback to
}

export interface CheckpointContext {
  // Progress state
  testsTotal: number
  testsPassing: number
  testsFailing: number
  currentCategory?: string
  completedCategories: string[]

  // What triggered this checkpoint
  triggerReason: string

  // Recent activity
  recentTests: RecentTestResult[]

  // Git state for rollback
  gitCommit: string
  gitBranch: string
  modifiedFiles: string[]

  // Summary of changes since last checkpoint
  changesSummary: string
}

export interface RecentTestResult {
  name: string
  status: 'passed' | 'failed' | 'skipped'
  duration?: number
  error?: string
}

export interface CheckpointConfig {
  // Enable/disable checkpoint types
  enableCategoryCheckpoints: boolean
  enableFailureCheckpoints: boolean
  enableRiskCheckpoints: boolean

  // Thresholds
  failureThreshold: number           // Number of consecutive failures before checkpoint
  categoryCompletionThreshold: number // Min % completion to trigger category checkpoint

  // Risk keywords that trigger checkpoints
  riskKeywords: string[]             // e.g., ['migration', 'delete', 'drop', 'alter']

  // Auto-approve settings
  autoApproveIfAllPassing: boolean   // Auto-approve if no failing tests
  autoApproveCategories: string[]    // Categories that can be auto-approved

  // Rollback settings
  enableAutoRollback: boolean        // Auto-rollback on checkpoint rejection
  keepRollbackHistory: number        // Number of rollback points to keep
}

export const DEFAULT_CHECKPOINT_CONFIG: CheckpointConfig = {
  enableCategoryCheckpoints: true,
  enableFailureCheckpoints: true,
  enableRiskCheckpoints: true,
  failureThreshold: 3,
  categoryCompletionThreshold: 100,
  riskKeywords: ['migration', 'delete', 'drop', 'alter', 'truncate', 'schema'],
  autoApproveIfAllPassing: false,
  autoApproveCategories: [],
  enableAutoRollback: true,
  keepRollbackHistory: 10
}

// Progress Watcher types
export interface FeatureListEntry {
  id: string
  name: string
  category: string
  status: 'pending' | 'in_progress' | 'passed' | 'failed'
  testFile?: string
  error?: string
}

export interface ProgressSnapshot {
  workflowId: string
  timestamp: number
  total: number
  passing: number
  failing: number
  pending: number
  percentage: number
  categories: CategoryProgressDetail[]
  currentTest?: string
}

export interface CategoryProgressDetail {
  name: string
  total: number
  passing: number
  failing: number
  pending: number
  percentage: number
}

// Config types
export interface AppConfig {
  claudeCliPath: string
  defaultProjectsDir: string
  theme: 'dark' | 'light' | 'system'
  fontSize: number
  recentProjects: string[]
  // Autonomous coding configuration
  autonomous: AutonomousConfig
  // API Server configuration (for remote access / thin client mode)
  apiServer?: ApiServerConfig
}

// API Server configuration
export interface ApiServerConfig {
  enabled: boolean
  port: number
  authEnabled: boolean
}

export interface AutonomousConfig {
  // Model settings
  defaultModel: string
  availableModels: ModelConfig[]
  // Behavior settings
  autoStartOnCreate: boolean
  confirmBeforeStart: boolean
  autoWatchProgress: boolean
  // MCP server settings
  mcpServers: McpServerConfig[]
  // Security settings
  bashAllowlist: boolean
  maxConcurrentSessions: number
  sessionRateLimitPerHour: number
}

export interface ModelConfig {
  id: string
  name: string
  description?: string
  enabled: boolean
}

export interface McpServerConfig {
  name: string
  command: string
  args: string[]
  env?: Record<string, string>
  enabled: boolean
}

// IPC channel names
export const IPC_CHANNELS = {
  // Session management
  SESSION_CREATE: 'session:create',
  SESSION_DESTROY: 'session:destroy',
  SESSION_LIST: 'session:list',
  SESSION_INPUT: 'session:input',
  SESSION_OUTPUT: 'session:output',
  SESSION_RESIZE: 'session:resize',
  SESSION_STATUS: 'session:status',

  // File system
  FILES_READ_DIR: 'files:read-dir',
  FILES_READ_FILE: 'files:read-file',
  FILES_WRITE_FILE: 'files:write-file',
  FILES_WATCH: 'files:watch',
  FILES_UNWATCH: 'files:unwatch',
  FILES_CHANGE: 'files:change',

  // Browser control (for Claude integration)
  BROWSER_NAVIGATE: 'browser:navigate',
  BROWSER_BACK: 'browser:back',
  BROWSER_FORWARD: 'browser:forward',
  BROWSER_REFRESH: 'browser:refresh',
  BROWSER_SNAPSHOT: 'browser:snapshot',
  BROWSER_CLICK: 'browser:click',
  BROWSER_TYPE: 'browser:type',
  BROWSER_EVALUATE: 'browser:evaluate',
  BROWSER_CONSOLE: 'browser:console',
  BROWSER_NETWORK: 'browser:network',
  BROWSER_SCREENSHOT: 'browser:screenshot',

  // Browser tab management
  BROWSER_TAB_CREATE: 'browser:tab-create',
  BROWSER_TAB_CLOSE: 'browser:tab-close',
  BROWSER_TAB_SELECT: 'browser:tab-select',
  BROWSER_TAB_LIST: 'browser:tab-list',
  BROWSER_TAB_UPDATE: 'browser:tab-update',

  // Dev server
  DEVSERVER_DETECT: 'devserver:detect',
  DEVSERVER_START: 'devserver:start',
  DEVSERVER_STOP: 'devserver:stop',
  DEVSERVER_STATUS: 'devserver:status',

  // Config
  CONFIG_GET: 'config:get',
  CONFIG_SET: 'config:set',

  // Window
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE: 'window:maximize',
  WINDOW_CLOSE: 'window:close',

  // Dialog
  DIALOG_SELECT_FOLDER: 'dialog:select-folder',

  // Python Venv Management
  VENV_STATUS: 'venv:status',
  VENV_ENSURE: 'venv:ensure',
  VENV_UPGRADE: 'venv:upgrade',
  VENV_PROGRESS: 'venv:progress',

  // Python Orchestrator Runner
  ORCHESTRATOR_START: 'orchestrator:start',
  ORCHESTRATOR_STOP: 'orchestrator:stop',
  ORCHESTRATOR_PAUSE: 'orchestrator:pause',
  ORCHESTRATOR_GET_SESSION: 'orchestrator:get-session',
  ORCHESTRATOR_GET_ALL_SESSIONS: 'orchestrator:get-all-sessions',
  ORCHESTRATOR_GET_WORKFLOW_SESSIONS: 'orchestrator:get-workflow-sessions',
  ORCHESTRATOR_CLEANUP: 'orchestrator:cleanup',
  ORCHESTRATOR_OUTPUT: 'orchestrator:output',
  ORCHESTRATOR_PROGRESS: 'orchestrator:progress',
  ORCHESTRATOR_SESSION: 'orchestrator:session',
  ORCHESTRATOR_STREAM_CHUNK: 'orchestrator:stream-chunk',

  // Workflow Management
  WORKFLOW_CREATE: 'workflow:create',
  WORKFLOW_GET: 'workflow:get',
  WORKFLOW_UPDATE: 'workflow:update',
  WORKFLOW_DELETE: 'workflow:delete',
  WORKFLOW_LIST: 'workflow:list',
  WORKFLOW_LIST_FOR_PROJECT: 'workflow:list-for-project',
  WORKFLOW_UPDATE_STATUS: 'workflow:update-status',
  WORKFLOW_UPDATE_PROGRESS: 'workflow:update-progress',
  WORKFLOW_CHANGE: 'workflow:change',

  // Progress Watcher
  PROGRESS_WATCH: 'progress:watch',
  PROGRESS_UNWATCH: 'progress:unwatch',
  PROGRESS_GET: 'progress:get',
  PROGRESS_UPDATE: 'progress:update',

  // Schema Validator
  SCHEMA_VALIDATE: 'schema:validate',
  SCHEMA_GET_RESULT: 'schema:get-result',
  SCHEMA_CLEAR: 'schema:clear',
  SCHEMA_STATUS: 'schema:status',

  // Discovery Chat
  DISCOVERY_CREATE_SESSION: 'discovery:create-session',
  DISCOVERY_SEND_MESSAGE: 'discovery:send-message',
  DISCOVERY_GET_MESSAGES: 'discovery:get-messages',
  DISCOVERY_GET_SESSION: 'discovery:get-session',
  DISCOVERY_CANCEL_REQUEST: 'discovery:cancel-request',
  DISCOVERY_CLOSE_SESSION: 'discovery:close-session',
  DISCOVERY_UPDATE_AGENT_STATUS: 'discovery:update-agent-status',
  DISCOVERY_ANALYZE_COMPLEXITY: 'discovery:analyze-complexity',
  DISCOVERY_VALIDATE_SPEC: 'discovery:validate-spec',
  // Discovery Chat Events
  DISCOVERY_MESSAGE: 'discovery:message',
  DISCOVERY_RESPONSE: 'discovery:response',
  DISCOVERY_RESPONSE_CHUNK: 'discovery:response-chunk',
  DISCOVERY_RESPONSE_COMPLETE: 'discovery:response-complete',
  DISCOVERY_AGENT_STATUS: 'discovery:agent-status',
  DISCOVERY_ERROR: 'discovery:error',
  DISCOVERY_COMPLEXITY_RESULT: 'discovery:complexity-result',
  DISCOVERY_READINESS_RESULT: 'discovery:readiness-result',

  // Checkpoint Management (Harness Framework)
  CHECKPOINT_CREATE: 'checkpoint:create',
  CHECKPOINT_APPROVE: 'checkpoint:approve',
  CHECKPOINT_REJECT: 'checkpoint:reject',
  CHECKPOINT_ROLLBACK: 'checkpoint:rollback',
  CHECKPOINT_SKIP: 'checkpoint:skip',
  CHECKPOINT_GET: 'checkpoint:get',
  CHECKPOINT_LIST: 'checkpoint:list',
  CHECKPOINT_UPDATE: 'checkpoint:update',
  CHECKPOINT_CONFIG_GET: 'checkpoint:config-get',
  CHECKPOINT_CONFIG_SET: 'checkpoint:config-set',

  // Ideas Kanban Management
  IDEAS_LIST: 'ideas:list',
  IDEAS_GET: 'ideas:get',
  IDEAS_CREATE: 'ideas:create',
  IDEAS_UPDATE: 'ideas:update',
  IDEAS_DELETE: 'ideas:delete',
  IDEAS_MOVE_STAGE: 'ideas:move-stage',
  IDEAS_ADD_DISCUSSION: 'ideas:add-discussion',
  IDEAS_START_PROJECT: 'ideas:start-project',
  IDEAS_LINK_WORKFLOW: 'ideas:link-workflow',

  // Outlook/Email Integration
  OUTLOOK_CONFIGURE: 'outlook:configure',
  OUTLOOK_GET_CONFIG: 'outlook:get-config',
  OUTLOOK_AUTHENTICATE: 'outlook:authenticate',
  OUTLOOK_FETCH_EMAILS: 'outlook:fetch-emails',
  OUTLOOK_SYNC: 'outlook:sync',
  OUTLOOK_SYNC_STREAM: 'outlook:sync-stream',  // Progressive sync - emits ideas as they complete
  OUTLOOK_SYNC_PROGRESS: 'outlook:sync-progress',  // Progress updates from main to renderer
  OUTLOOK_STATUS: 'outlook:status',

  // Idea Discussion with Claude
  IDEAS_DISCUSS: 'ideas:discuss',  // Send message and get Claude response
  IDEAS_DISCUSS_STREAM: 'ideas:discuss-stream',  // Streaming response chunks

  // Ralph Loop Initiator (Requirements Gathering)
  INITIATOR_START: 'initiator:start',
  INITIATOR_GET_SESSION: 'initiator:get-session',
  INITIATOR_SEND_MESSAGE: 'initiator:send-message',
  INITIATOR_SUMMARIZE: 'initiator:summarize',
  INITIATOR_GENERATE_PROMPT: 'initiator:generate-prompt',
  INITIATOR_UPDATE_PROMPT: 'initiator:update-prompt',
  INITIATOR_APPROVE_PROMPT: 'initiator:approve-prompt',
  INITIATOR_CANCEL: 'initiator:cancel',
  // Initiator Events (main -> renderer)
  INITIATOR_RESPONSE_CHUNK: 'initiator:response-chunk',
  INITIATOR_RESPONSE_COMPLETE: 'initiator:response-complete',
  INITIATOR_REQUIREMENTS_READY: 'initiator:requirements-ready',
  INITIATOR_PROMPT_READY: 'initiator:prompt-ready',
  INITIATOR_ERROR: 'initiator:error',

  // Ralph Loop Orchestrator (Execution)
  RALPH_START: 'ralph:start',
  RALPH_STOP: 'ralph:stop',
  RALPH_PAUSE: 'ralph:pause',
  RALPH_RESUME: 'ralph:resume',
  RALPH_STATUS: 'ralph:status',
  RALPH_STREAM_CHUNK: 'ralph:stream-chunk',
  RALPH_PROGRESS: 'ralph:progress',
  RALPH_CHECKPOINT: 'ralph:checkpoint',
  RALPH_ERROR: 'ralph:error',
} as const

export type IpcChannel = typeof IPC_CHANNELS[keyof typeof IPC_CHANNELS]

// ============================================================================
// BMAD-Inspired Enhancements: Complexity, Readiness, and Step Conditions
// ============================================================================

// Task Complexity Analysis (BMAD Scale Adaptive System)
export type TaskComplexity = 'quick' | 'standard' | 'enterprise'

export interface ComplexityFactor {
  name: string
  weight: number
  detected: boolean
  details?: string
}

export interface ComplexityAnalysis {
  score: number                    // 0-100
  level: TaskComplexity
  factors: ComplexityFactor[]
  suggestedMode: 'quick-spec' | 'smart-spec' | 'enterprise-spec'
  confidence: number               // 0-1
  analyzedAt: number
}

// Implementation Readiness Gate (BMAD Implementation Readiness Check)
export interface ReadinessCheckItem {
  name: string
  description: string
  status: 'passed' | 'failed' | 'warning' | 'skipped'
  details?: string
  required: boolean
}

export interface ReadinessCheck {
  passed: boolean
  checks: ReadinessCheckItem[]
  blockers: string[]
  warnings: string[]
  score: number  // 0-100
  checkedAt: number
}

// Step-Level Pre/Post Conditions (BMAD Step-File Architecture)
export type ConditionType = 'test_status' | 'file_exists' | 'file_contains' | 'command_succeeds' | 'schema_fresh' | 'custom'

export interface ConditionCheck {
  type: ConditionType
  // For test_status
  category?: string
  minPassing?: number
  maxFailing?: number
  // For file_exists / file_contains
  filePath?: string
  contains?: string
  // For command_succeeds
  command?: string
  expectedExitCode?: number
  // For custom
  customExpression?: string
}

export interface Condition {
  id: string
  type: ConditionType
  description: string
  check: ConditionCheck
  required: boolean
}

export interface ConditionResult {
  condition: Condition
  passed: boolean
  error?: string
  checkedAt: number
}

export interface StepConditions {
  preconditions: Condition[]
  postconditions: Condition[]
}

// Enhanced Checkpoint with Step Conditions
export interface EnhancedCheckpoint extends Checkpoint {
  stepConditions?: StepConditions
  preconditionResults?: ConditionResult[]
  postconditionResults?: ConditionResult[]
}

// Complexity factor definitions for analysis
export const COMPLEXITY_FACTORS_CONFIG = [
  // High complexity indicators (weight: 15-25)
  { name: 'database_migration', weight: 25, keywords: ['migration', 'schema change', 'alter table', 'new table', 'add column'] },
  { name: 'authentication', weight: 20, keywords: ['auth', 'login', 'oauth', 'jwt', 'session', 'password', 'signup'] },
  { name: 'api_design', weight: 15, keywords: ['api', 'endpoint', 'rest', 'graphql', 'webhook'] },
  { name: 'multi_service', weight: 20, keywords: ['microservice', 'integration', 'external api', 'third party'] },
  { name: 'realtime', weight: 18, keywords: ['websocket', 'realtime', 'streaming', 'pubsub', 'subscription'] },

  // Medium complexity indicators (weight: 8-12)
  { name: 'state_management', weight: 10, keywords: ['state', 'store', 'redux', 'zustand', 'context'] },
  { name: 'data_model', weight: 12, keywords: ['model', 'entity', 'relationship', 'foreign key', 'schema'] },
  { name: 'testing_heavy', weight: 8, keywords: ['e2e', 'integration test', 'test coverage', 'playwright'] },
  { name: 'file_upload', weight: 10, keywords: ['upload', 'file', 'image', 'attachment', 's3', 'blob'] },
  { name: 'caching', weight: 8, keywords: ['cache', 'redis', 'memoize', 'invalidate'] },

  // Lower complexity indicators (weight: 3-7)
  { name: 'ui_component', weight: 5, keywords: ['component', 'button', 'form', 'modal', 'dialog'] },
  { name: 'styling', weight: 3, keywords: ['css', 'tailwind', 'style', 'theme', 'dark mode'] },
  { name: 'validation', weight: 5, keywords: ['validate', 'zod', 'yup', 'schema validation'] },
] as const

// Readiness check definitions
export const READINESS_CHECKS_CONFIG = [
  // Required checks (blockers if failed)
  { name: 'spec_structure', description: 'Spec has required sections (Overview, Requirements, Implementation)', required: true },
  { name: 'no_ambiguous_requirements', description: 'No TODO or TBD markers in spec', required: true },
  { name: 'test_categories_defined', description: 'Test categories or acceptance criteria are specified', required: true },

  // Recommended checks (warnings if failed)
  { name: 'file_paths_realistic', description: 'All file paths look realistic (no placeholders)', required: false },
  { name: 'schema_fresh', description: '.schema/ documentation is current (< 24 hours old)', required: false },
  { name: 'error_handling_defined', description: 'Error cases and edge cases are specified', required: false },
  { name: 'similar_patterns_referenced', description: 'References existing code patterns for consistency', required: false },
] as const

// ============================================================================
// Email Ideas Kanban System
// ============================================================================

// Idea stages in the Kanban workflow
export type IdeaStage =
  | 'inbox'       // Just fetched from email, not yet reviewed
  | 'review'      // In active discussion/review
  | 'approved'    // Discussed and approved, ready to start
  | 'in_progress' // Project started
  | 'completed'   // Project finished
  | 'declined'    // Reviewed but decided not to pursue

// Project type determination
export type ProjectType = 'greenfield' | 'brownfield' | 'undetermined'

// Source email metadata
export interface IdeaEmailSource {
  messageId: string
  from: string
  subject: string
  receivedAt: number
  body: string
  snippet?: string
}

// Extracted content from URLs found in email
export interface IdeaExtractedUrl {
  url: string
  title: string | null
  description: string | null
  siteName: string | null
  fetchedAt: number
  error?: string
  // Full article content (extracted from page)
  articleContent?: string
  // AI-generated summary of the article
  summary?: string
  // Whether summary generation was attempted
  summaryGenerated?: boolean
}

// Main Idea interface
export interface Idea {
  id: string
  title: string
  description: string
  stage: IdeaStage
  projectType: ProjectType

  // Email source
  emailSource: IdeaEmailSource

  // Extracted URLs from email content
  extractedUrls?: IdeaExtractedUrl[]

  // Project association (for brownfield - existing project)
  associatedProjectPath?: string
  associatedProjectName?: string

  // Project association (for greenfield - new project name)
  // Also used to group ideas by project
  projectName?: string

  // Review/discussion data
  reviewNotes?: string
  discussionMessages?: IdeaDiscussionMessage[]
  sessionId?: string // Agent SDK session ID for maintaining conversation context

  // Workflow tracking
  createdAt: number
  updatedAt: number
  movedToReviewAt?: number
  approvedAt?: number
  startedAt?: number
  completedAt?: number

  // Created workflow (when project starts)
  workflowId?: string

  // Tags/categories
  tags?: string[]
  priority?: 'low' | 'medium' | 'high' | 'urgent'
}

// Discussion message for review phase
export interface IdeaDiscussionMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

// Outlook/Email integration configuration
export interface OutlookConfig {
  clientId: string
  clientSecret?: string // Optional: for confidential client flow (avoids admin consent issues)
  tenantId: string
  redirectUri: string
  sourceEmailAddress: string // The specific email address to fetch ideas from
  lastSyncAt?: number
  accessToken?: string
  refreshToken?: string
  tokenExpiresAt?: number
}

// Discovery result for greenfield/brownfield determination
export interface ProjectDiscoveryResult {
  projectType: ProjectType
  suggestedProjects?: Array<{
    path: string
    name: string
    matchScore: number
    reason: string
  }>
  analysis: string
}

// ============================================================================
// Ralph Loop System (Autonomous Orchestrator)
// ============================================================================

// Initiator Phase Types
export type InitiatorPhase = 'gathering' | 'summarizing' | 'generating' | 'reviewing' | 'approved'

export type QuestionCategory =
  | 'objective'
  | 'scope'
  | 'success_criteria'
  | 'constraints'
  | 'project_context'
  | 'complexity'

/** Attachment types supported in initiator chat */
export type AttachmentType = 'text' | 'pdf' | 'image' | 'code' | 'markdown' | 'json' | 'unknown'

/** File attachment for context in initiator chat */
export interface InitiatorAttachment {
  id: string
  fileName: string
  filePath: string
  fileSize: number
  mimeType: string
  attachmentType: AttachmentType
  /** Extracted text content (for text-based files) */
  textContent?: string
  /** Base64 encoded data (for images/binary) */
  base64Data?: string
  /** Error if file couldn't be processed */
  error?: string
}

export interface InitiatorMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  category?: QuestionCategory
  /** Attachments included with this message */
  attachments?: InitiatorAttachment[]
}

export interface RequirementsDoc {
  objective: string
  scope: string[]
  successCriteria: string[]
  constraints: string[]
  outOfScope: string[]
  projectType: 'greenfield' | 'brownfield' | 'undetermined'
  complexity: 'quick' | 'standard' | 'enterprise'
  estimatedFeatures: number
  gatheredAt: number
}

export interface RalphPromptConfig {
  prompt: string
  completionPromise: string
  maxIterations: number
  checkpointThreshold: number
  successIndicators: string[]
  generatedAt: number
}

export interface InitiatorSession {
  id: string
  projectPath: string
  messages: InitiatorMessage[]
  phase: InitiatorPhase
  requirements: RequirementsDoc | null
  generatedPrompt: RalphPromptConfig | null
  createdAt: number
  updatedAt: number
  totalCostUsd: number
}

// Ralph Loop Execution Types
export type RalphPhase = 'validation' | 'generation' | 'implementation'
export type RalphStatus = 'idle' | 'starting' | 'running' | 'paused' | 'completed' | 'error'
export type RalphCheckpointType = 'soft' | 'hard'

export interface RalphFeature {
  id: string
  name: string
  description?: string
  category: string
  status: 'pending' | 'in_progress' | 'passed' | 'failed' | 'skipped'
  riskScore?: number
  error?: string
  startedAt?: number
  completedAt?: number
}

export interface RalphExecutionState {
  sessionId: string
  projectPath: string
  phase: RalphPhase
  status: RalphStatus
  features: RalphFeature[]
  iteration: number
  maxIterations: number
  testsTotal: number
  testsPassing: number
  currentFeature?: string
  startedAt: number
  pausedAt?: number
  completedAt?: number
  error?: string
}

export interface RalphCheckpoint {
  id: string
  type: RalphCheckpointType
  featureId: string
  featureName: string
  riskScore: number
  reason: string
  riskFactors: {
    category: string
    score: number
    details: string
  }[]
  affectedFiles: string[]
  blastRadius: number
  createdAt: number
  resolvedAt?: number
  resolution?: 'approved' | 'skipped' | 'rejected'
  feedback?: string
}

export interface RalphProgressEvent {
  type: 'progress'
  phase: RalphPhase
  iteration: number
  testsTotal: number
  testsPassing: number
  currentTest?: string
  message: string
  timestamp: number
}

export interface RalphCheckpointEvent {
  type: 'checkpoint'
  data: RalphCheckpoint
}

export interface RalphStatusEvent {
  type: 'status'
  status: RalphStatus
  phase: RalphPhase
  iteration: number
}

export interface RalphContext {
  runningSummary: string
  keyDecisions: Array<{
    id: string
    decision: string
    reasoning: string
    timestamp: number
  }>
  failureMemory: Array<{
    id: string
    feature: string
    error: string
    rootCause?: string
    resolution?: string
    timestamp: number
  }>
  activeConstraints: string[]
}

// Ralph Session History - for tracking past sessions
export type RalphSessionPhase = 'initiator' | 'requirements' | 'prompt_review' | 'executing' | 'completed'

export interface RalphSessionSummary {
  id: string
  projectPath: string
  projectName: string
  phase: RalphSessionPhase
  status: RalphStatus
  taskDescription: string  // Brief description of what was requested
  createdAt: number
  updatedAt: number
  completedAt?: number
  // Stats
  featuresTotal: number
  featuresPassed: number
  featuresFailed: number
  // Optional prompt config reference
  promptConfig?: RalphPromptConfig
}

export interface RalphPromptConfig {
  prompt: string
  completionPromise: string
  maxIterations: number
  checkpointThreshold: number
  successIndicators: string[]
}

export interface RalphSessionHistoryEntry extends RalphSessionSummary {
  // Extended data for full session details
  requirements?: {
    objective: string
    scope: string[]
    successCriteria: string[]
    constraints: string[]
    outOfScope: string[]
  }
  features?: RalphFeature[]
  checkpoints?: RalphCheckpoint[]
  context?: RalphContext
}

// Connection types
export interface ConnectionConfig {
  serverUrl: string
  authToken: string
  isConnected: boolean
}

// Ralph Loop types
export type RalphPhase = 'setup' | 'planning' | 'implementation' | 'testing' | 'review' | 'complete'
export type RalphSessionStatus = 'idle' | 'starting' | 'running' | 'paused' | 'completed' | 'error'

export interface RalphFeature {
  id: string
  name: string
  description: string
  category: string
  status: 'pending' | 'in_progress' | 'passed' | 'failed' | 'skipped'
  attempts: number
  completedAt: number | null
}

export interface RalphSession {
  id: string
  projectPath: string
  status: RalphSessionStatus
  phase: RalphPhase
  iteration: number
  features: RalphFeature[]
  currentFeatureId: string | null
  startedAt: number
  pausedAt: number | null
  completedAt: number | null
  error: string | null
  totalCostUsd: number
}

export interface RalphCheckpoint {
  id: string
  sessionId: string
  type: 'approval' | 'review' | 'decision'
  title: string
  description: string
  options?: string[]
  requiresResponse: boolean
  createdAt: number
}

export interface RalphProgressEvent {
  sessionId: string
  type: 'progress' | 'feature_update'
  phase?: RalphPhase
  iteration?: number
  testsTotal?: number
  testsPassing?: number
  currentTest?: string
  message?: string
  featureId?: string
  status?: string
  timestamp: number
}

// Ideas types
export type IdeaStage = 'inbox' | 'reviewing' | 'planning' | 'ready' | 'in_progress' | 'done' | 'archived'
export type IdeaPriority = 'low' | 'medium' | 'high' | 'urgent'

export interface IdeaEmailSource {
  messageId: string
  subject: string
  from: string
  receivedAt: number
  hasAttachments: boolean
  bodyPreview: string
  links: string[]
}

export interface Idea {
  id: string
  title: string
  description: string
  stage: IdeaStage
  priority: IdeaPriority
  emailSource: IdeaEmailSource
  tags: string[]
  projectType?: string
  associatedProjectPath?: string
  associatedWorkflowId?: string
  reviewNotes?: string
  discussionHistory: Array<{
    role: 'user' | 'assistant'
    content: string
    timestamp: number
  }>
  createdAt: number
  updatedAt: number
}

// API Response types
export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

// WebSocket event types
export interface WebSocketMessage {
  channel: string
  data: unknown
  timestamp: number
}

// ============================================================================
// Parallel Execution Agent Types
// ============================================================================

export type AgentState =
  | 'initializing'
  | 'cloning'
  | 'working'
  | 'testing'
  | 'committing'
  | 'pushing'
  | 'completed'
  | 'failed'
  | 'stopped'

export interface AgentStatus {
  agentId: string
  taskId: string
  state: AgentState
  worktreePath: string
  branchName: string
  startedAt: number
  completedAt?: number
  error?: string
  progress?: {
    currentStep: string
    stepsCompleted: number
    totalSteps: number
  }
  metrics?: {
    linesAdded: number
    linesRemoved: number
    filesChanged: number
    testsRun: number
    testsPassed: number
  }
}

export interface ParallelSessionStatus {
  sessionId: string
  state: 'idle' | 'executing_group' | 'checkpoint_merge' | 'paused' | 'completed' | 'failed'
  currentGroup: number
  totalGroups: number
  groups: GroupStatus[]
  agents: AgentStatus[]
  progress: number
  elapsedTime: number
}

export interface GroupStatus {
  groupNumber: number
  taskIds: string[]
  state: 'pending' | 'executing' | 'completed' | 'failed'
  completedCount: number
  failedCount: number
  activeAgents: string[]
}

// ============================================================================
// Merge Conflict Types
// ============================================================================

export type ConflictResolutionStrategy =
  | 'ours'
  | 'theirs'
  | 'ai_merged'
  | 'manual'

export interface ConflictMarker {
  startLine: number
  endLine: number
  ourContent: string
  theirContent: string
  ancestorContent?: string
}

export interface MergeConflict {
  id: string
  sessionId: string
  agentId: string
  filePath: string
  markers: ConflictMarker[]
  aiResolution?: {
    resolvedContent: string
    strategy: ConflictResolutionStrategy
    confidence: number
    explanation: string
  }
  status: 'pending' | 'ai_resolved' | 'user_approved' | 'user_rejected'
  createdAt: number
  resolvedAt?: number
}

export interface MergeConflictCheckpoint {
  id: string
  sessionId: string
  conflicts: MergeConflict[]
  sourceBranch: string
  targetBranch: string
  totalConflicts: number
  resolvedCount: number
  requiresUserApproval: boolean
  createdAt: number
}

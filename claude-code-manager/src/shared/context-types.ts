/**
 * Context Agent Type Definitions
 *
 * Schema for context storage in .autonomous/context/
 * Used by Context Agent to maintain compressed, relevant context
 * across the execution lifecycle.
 */

/**
 * Running summary of the project state
 * Compressed context that execution agents can use
 * Max 2000 tokens to prevent context bloat
 */
export interface RunningSummary {
  /** Summary text in markdown format */
  content: string
  /** Token count (approximate) */
  tokenCount: number
  /** Last updated timestamp */
  updatedAt: number
  /** Trigger that caused this update */
  trigger: 'feature_count' | 'category_complete' | 'manual'
  /** Number of features processed since last summary */
  featuresSinceLastUpdate: number
  /** Total features completed */
  totalFeaturesCompleted: number
}

/**
 * Key design decision made during implementation
 * Critical choices that affect future work
 */
export interface KeyDecision {
  /** Unique ID for this decision */
  id: string
  /** Feature ID where this decision was made */
  featureId: string
  /** Decision description */
  decision: string
  /** Rationale for the decision */
  rationale: string
  /** What this affects going forward */
  impact: string[]
  /** When this decision was made */
  timestamp: number
  /** Category (e.g., 'architecture', 'security', 'ux') */
  category: 'architecture' | 'security' | 'performance' | 'ux' | 'data' | 'integration' | 'other'
}

/**
 * Record of a failure with root cause analysis
 * Helps prevent repeating the same mistakes
 */
export interface FailureRecord {
  /** Unique ID for this failure */
  id: string
  /** Feature ID where failure occurred */
  featureId: string
  /** What failed */
  description: string
  /** Root cause analysis */
  rootCause: string
  /** How it was fixed */
  resolution: string
  /** Prevention strategy for future */
  prevention: string
  /** When this failure occurred */
  timestamp: number
  /** Severity level */
  severity: 'low' | 'medium' | 'high' | 'critical'
}

/**
 * Active constraint that limits implementation options
 * Technical limitations or requirements currently in effect
 */
export interface ActiveConstraint {
  /** Unique ID for this constraint */
  id: string
  /** Constraint description */
  description: string
  /** Why this constraint exists */
  reason: string
  /** What areas this affects */
  affectedAreas: string[]
  /** When this constraint was added */
  addedAt: number
  /** When this constraint expires (null = permanent) */
  expiresAt: number | null
  /** Type of constraint */
  type: 'technical' | 'business' | 'security' | 'performance' | 'compatibility' | 'other'
}

/**
 * Complete context data structure
 * All context information for a project
 */
export interface ContextData {
  /** Running summary */
  summary: RunningSummary
  /** Key decisions made */
  decisions: KeyDecision[]
  /** Failure history */
  failures: FailureRecord[]
  /** Active constraints */
  constraints: ActiveConstraint[]
  /** Last updated timestamp */
  lastUpdated: number
  /** Project path this context belongs to */
  projectPath: string
}

/**
 * Context summarization request
 * Input to context agent for summarization
 */
export interface ContextSummarizationRequest {
  /** Project path */
  projectPath: string
  /** What triggered this summarization */
  trigger: 'feature_count' | 'category_complete' | 'manual'
  /** Category ID (if trigger is category_complete) */
  categoryId?: string
  /** Completed feature IDs to summarize */
  completedFeatures: string[]
  /** Include failure analysis */
  includeFailures?: boolean
  /** Include decision extraction */
  includeDecisions?: boolean
}

/**
 * Context summarization result
 * Output from context agent
 */
export interface ContextSummarizationResult {
  /** Success flag */
  success: boolean
  /** Updated summary */
  summary?: RunningSummary
  /** Newly extracted decisions */
  newDecisions?: KeyDecision[]
  /** Newly recorded failures */
  newFailures?: FailureRecord[]
  /** Updated constraints */
  updatedConstraints?: ActiveConstraint[]
  /** Error message if failed */
  error?: string
  /** Duration in milliseconds */
  duration: number
}

/**
 * Context progress update
 * Emitted during summarization
 */
export interface ContextProgress {
  /** Phase of summarization */
  phase: 'loading' | 'analyzing' | 'summarizing' | 'extracting' | 'saving' | 'complete'
  /** Progress percentage (0-100) */
  progress: number
  /** Current message */
  message: string
  /** Timestamp */
  timestamp: number
}

/**
 * Context injection into feature spec
 * Relevant context to include in execution prompt
 */
export interface ContextInjection {
  /** Running summary (compressed) */
  summary: string
  /** Relevant decisions for this feature */
  relevantDecisions: KeyDecision[]
  /** Relevant failures to avoid */
  relevantFailures: FailureRecord[]
  /** Active constraints to respect */
  activeConstraints: ActiveConstraint[]
  /** Total token count of injected context */
  tokenCount: number
}

/**
 * Context storage paths
 * File locations in .autonomous/context/
 */
export interface ContextStoragePaths {
  /** Base directory */
  baseDir: string
  /** running-summary.json */
  summaryFile: string
  /** key-decisions.json */
  decisionsFile: string
  /** failure-memory.json */
  failuresFile: string
  /** active-constraints.json */
  constraintsFile: string
}

/**
 * Ralph Parallel Execution Types
 * Core types for YAML task structure, parallel execution, and AI merge resolution
 */

// =============================================================================
// Task & YAML Types
// =============================================================================

/**
 * Task complexity estimation
 */
export type TaskComplexity = 'low' | 'medium' | 'high';

/**
 * Task category for grouping
 */
export type TaskCategory =
  | 'backend'
  | 'frontend'
  | 'mobile'
  | 'testing'
  | 'types'
  | 'infrastructure'
  | 'documentation';

/**
 * Individual task definition
 */
export interface RalphTask {
  /** Unique task identifier (e.g., "auth-001") */
  id: string;

  /** Human-readable task title */
  title: string;

  /** Detailed description of what needs to be done */
  description: string;

  /** Task category for grouping */
  category: TaskCategory;

  /** Parallel group number - tasks in same group run concurrently */
  parallel_group: number;

  /** IDs of tasks this depends on (must complete first) */
  dependencies: string[];

  /** Estimated complexity */
  estimated_complexity: TaskComplexity;

  /** Files to create (optional) */
  files_to_create?: string[];

  /** Files to modify (optional) */
  files_to_modify?: string[];

  /** Acceptance criteria - checklist for completion */
  acceptance_criteria: string[];

  /** Whether task is completed */
  completed?: boolean;

  /** Completion timestamp */
  completed_at?: number;

  /** Agent that completed this task */
  completed_by?: string;
}

/**
 * Project settings in YAML
 */
export interface RalphProjectSettings {
  /** Maximum concurrent agents (1-10) */
  max_parallel_agents: number;

  /** Require checkpoint before merging parallel results */
  checkpoint_before_merge: boolean;

  /** Checkpoint between parallel groups */
  checkpoint_between_groups: boolean;

  /** Run tests after each task */
  run_tests_per_task: boolean;

  /** Run linter after each task */
  run_lint_per_task: boolean;

  /** Minimum confidence score for auto-merge (0.0-1.0) */
  min_confidence_for_auto_merge: number;

  /** Run review agents after each group */
  review_after_group?: boolean;
}

/**
 * Project info in YAML
 */
export interface RalphProject {
  /** Project name */
  name: string;

  /** Project description */
  description: string;

  /** Base git branch */
  base_branch: string;

  /** Repository name (optional) */
  repository?: string;
}

/**
 * Review configuration
 */
export interface RalphReviewConfig {
  /** Run review after each group completion */
  after_each_group: boolean;

  /** Review agent configurations */
  agents: Array<{
    type: string;
    focus: string[];
  }>;

  /** How to handle issues by priority */
  issue_handling: {
    P0: 'fix_immediately' | 'document_for_later';
    P1: 'fix_immediately' | 'document_for_later';
    P2: 'fix_immediately' | 'document_for_later';
    P3: 'fix_immediately' | 'document_for_later';
  };
}

/**
 * Complete YAML task file structure
 */
export interface RalphTaskYaml {
  /** Project information */
  project: RalphProject;

  /** Execution settings */
  settings: RalphProjectSettings;

  /** Task definitions */
  tasks: RalphTask[];

  /** Review configuration (optional) */
  review?: RalphReviewConfig;
}

// =============================================================================
// Dependency Graph Types
// =============================================================================

/**
 * Node in dependency graph
 */
export interface DependencyNode {
  /** Task ID */
  id: string;

  /** Tasks this depends on */
  dependencies: string[];

  /** Tasks that depend on this */
  dependents: string[];

  /** Calculated parallel group */
  parallel_group: number;

  /** Whether node has been visited (for cycle detection) */
  visited?: boolean;

  /** Whether node is in current path (for cycle detection) */
  inCurrentPath?: boolean;
}

/**
 * Dependency graph structure
 */
export interface DependencyGraph {
  /** All nodes by ID */
  nodes: Map<string, DependencyNode>;

  /** Parallel groups (group number -> task IDs) */
  groups: Map<number, string[]>;

  /** Whether graph has cycles */
  hasCycles: boolean;

  /** Cycle path if cycles detected */
  cyclePath?: string[];
}

// =============================================================================
// Worktree & Agent Types
// =============================================================================

/**
 * Git worktree configuration
 */
export interface WorktreeConfig {
  /** Unique agent ID */
  agentId: string;

  /** Task being executed */
  taskId: string;

  /** Session ID */
  sessionId: string;

  /** Base branch to create from */
  baseBranch: string;

  /** Path to worktree directory */
  worktreePath: string;

  /** Branch name for this worktree */
  branchName: string;

  /** Project root path */
  projectPath: string;
}

/**
 * Agent execution state
 */
export type AgentState =
  | 'initializing'
  | 'running'
  | 'testing'
  | 'committing'
  | 'completed'
  | 'failed'
  | 'waiting_checkpoint';

/**
 * Agent progress info
 */
export interface AgentProgress {
  /** Current step description */
  currentStep: string;

  /** Steps completed */
  stepsCompleted: number;

  /** Total estimated steps */
  totalSteps: number;

  /** Elapsed time in milliseconds */
  elapsedTime: number;

  /** Start timestamp */
  startedAt: number;
}

/**
 * Agent metrics
 */
export interface AgentMetrics {
  /** Tokens used */
  tokensUsed: number;

  /** Estimated cost in USD */
  estimatedCost: number;

  /** Files modified */
  filesModified: string[];

  /** Tests run */
  testsRun: number;

  /** Tests passed */
  testsPassed: number;
}

/**
 * Complete agent status
 */
export interface AgentStatus {
  /** Unique agent ID */
  agentId: string;

  /** Task being executed */
  taskId: string;

  /** Task title */
  taskTitle: string;

  /** Worktree path */
  worktreePath: string;

  /** Branch name */
  branchName: string;

  /** Current state */
  state: AgentState;

  /** Progress information */
  progress: AgentProgress;

  /** Output info */
  output: {
    /** Last N lines of output */
    lastLines: string[];

    /** Path to full log file */
    fullLogPath: string;
  };

  /** Execution metrics */
  metrics: AgentMetrics;

  /** Error message if failed */
  error?: string;
}

// =============================================================================
// Merge Types
// =============================================================================

/**
 * Merge conflict information
 */
export interface MergeConflict {
  /** File path */
  file: string;

  /** Our version (current branch) */
  oursContent: string;

  /** Their version (incoming branch) */
  theirsContent: string;

  /** Common ancestor version */
  baseContent: string;

  /** Raw conflict text with markers */
  conflictMarkers: string;

  /** Line count of conflict */
  lineCount: number;
}

/**
 * AI resolution result
 */
export interface MergeResolution {
  /** File path */
  file: string;

  /** Resolved content */
  resolvedContent: string;

  /** Confidence score (0.0-1.0) */
  confidence: number;

  /** Resolution explanation */
  explanation?: string;
}

/**
 * Confidence factors
 */
export interface ConfidenceFactors {
  /** Factor from conflict size (larger = lower confidence) */
  sizeFactor: number;

  /** Factor from file complexity */
  complexityFactor: number;

  /** Factor from similarity to originals */
  similarityFactor: number;

  /** Factor from file criticality */
  criticalityFactor: number;

  /** Combined score */
  combined: number;
}

/**
 * Merge checkpoint for human review
 */
export interface MergeCheckpoint {
  /** Checkpoint ID */
  id: string;

  /** Checkpoint type */
  type: 'merge_approval';

  /** Session ID */
  sessionId: string;

  /** Branches being merged */
  branches: {
    base: string;
    merging: string[];
  };

  /** Conflict summaries */
  conflicts: Array<{
    file: string;
    confidence: number;
    description: string;
  }>;

  /** Proposed resolutions */
  proposedResolutions: MergeResolution[];

  /** Overall confidence */
  confidence: number;

  /** Risk level */
  riskLevel: 'low' | 'medium' | 'high' | 'critical';

  /** Affected files count */
  affectedFilesCount: number;

  /** Created timestamp */
  createdAt: number;

  /** Available actions */
  actions: ('approve' | 'reject' | 'edit' | 'manual')[];
}

/**
 * Merge status
 */
export interface MergeStatus {
  /** Current merge state */
  state: 'pending' | 'in_progress' | 'awaiting_approval' | 'completed' | 'failed';

  /** Branches involved */
  branches: string[];

  /** Conflicts if any */
  conflicts?: MergeConflict[];

  /** Resolutions if any */
  resolutions?: MergeResolution[];

  /** Overall confidence */
  confidence?: number;

  /** Checkpoint if awaiting approval */
  checkpoint?: MergeCheckpoint;

  /** Error if failed */
  error?: string;
}

// =============================================================================
// Session Types
// =============================================================================

/**
 * Task source configuration
 */
export type TaskSource =
  | { type: 'yaml'; path: string }
  | { type: 'prd'; content: string }
  | { type: 'github'; repo: string; label?: string }
  | { type: 'initiator'; sessionId: string };

/**
 * Parallel execution configuration
 */
export interface ParallelConfig {
  /** Enable parallel execution */
  enabled: boolean;

  /** Maximum concurrent agents */
  maxAgents: number;
}

/**
 * Git configuration
 */
export interface GitConfig {
  /** Base branch */
  baseBranch: string;

  /** Create branch per task */
  branchPerTask: boolean;

  /** Create PR after completion */
  createPR: boolean;

  /** Create draft PR */
  draftPR: boolean;

  /** Auto-merge branches */
  autoMerge: boolean;
}

/**
 * Quality gate configuration
 */
export interface QualityConfig {
  /** Run tests */
  runTests: boolean;

  /** Run linter */
  runLint: boolean;

  /** Require tests to pass */
  requireTestPass: boolean;
}

/**
 * Checkpoint configuration
 */
export interface CheckpointConfig {
  /** Checkpoint before merge */
  beforeMerge: boolean;

  /** Checkpoint on conflict */
  onConflict: boolean;

  /** Checkpoint between groups */
  betweenGroups: boolean;

  /** Minimum confidence for auto-merge */
  minConfidenceForAutoMerge: number;
}

/**
 * Execution limits
 */
export interface ExecutionLimits {
  /** Maximum iterations (0 = unlimited) */
  maxIterations: number;

  /** Maximum retries per task */
  maxRetries: number;

  /** Delay between retries (seconds) */
  retryDelay: number;

  /** Timeout per task (minutes) */
  timeout: number;
}

/**
 * Complete Ralph session configuration
 */
export interface RalphSessionConfig {
  /** Task source */
  source: TaskSource;

  /** Parallel execution settings */
  parallel: ParallelConfig;

  /** Git settings */
  git: GitConfig;

  /** Quality gates */
  quality: QualityConfig;

  /** Checkpoint settings */
  checkpoints: CheckpointConfig;

  /** Execution limits */
  limits: ExecutionLimits;
}

/**
 * Session execution state
 */
export type SessionState =
  | 'idle'
  | 'parsing_prd'
  | 'awaiting_review'
  | 'executing_group'
  | 'merging'
  | 'ai_resolving'
  | 'checkpoint_merge'
  | 'group_merged'
  | 'completing'
  | 'completed'
  | 'failed'
  | 'paused';

/**
 * Group execution status
 */
export interface GroupStatus {
  /** Group number */
  groupNumber: number;

  /** Tasks in this group */
  taskIds: string[];

  /** Current state */
  state: 'pending' | 'executing' | 'merging' | 'completed' | 'failed';

  /** Completed task count */
  completedCount: number;

  /** Failed task count */
  failedCount: number;

  /** Active agents */
  activeAgents: string[];
}

/**
 * Complete session status
 */
export interface RalphSessionStatus {
  /** Session ID */
  sessionId: string;

  /** Current state */
  state: SessionState;

  /** Current group being executed */
  currentGroup: number;

  /** Total groups */
  totalGroups: number;

  /** Group statuses */
  groups: GroupStatus[];

  /** All agent statuses */
  agents: AgentStatus[];

  /** Merge status if merging */
  mergeStatus?: MergeStatus;

  /** Overall progress (0-100) */
  progress: number;

  /** Elapsed time */
  elapsedTime: number;

  /** Error if failed */
  error?: string;
}

// =============================================================================
// Review Types
// =============================================================================

/**
 * Issue priority
 */
export type IssuePriority = 'P0' | 'P1' | 'P2' | 'P3';

/**
 * Review issue
 */
export interface ReviewIssue {
  /** Unique ID */
  id: string;

  /** Priority */
  priority: IssuePriority;

  /** Issue title */
  title: string;

  /** Detailed description */
  description: string;

  /** File path */
  file: string;

  /** Line number */
  line?: number;

  /** Issue category */
  category: 'bug' | 'security' | 'performance' | 'type-safety' | 'convention' | 'other';

  /** Suggested fix */
  suggestedFix?: string;

  /** Whether fixed */
  fixed?: boolean;

  /** Fix commit if fixed */
  fixCommit?: string;
}

/**
 * Group review result
 */
export interface GroupReviewResult {
  /** Group number */
  groupNumber: number;

  /** All issues found */
  issues: ReviewIssue[];

  /** Issues by priority */
  byPriority: {
    P0: ReviewIssue[];
    P1: ReviewIssue[];
    P2: ReviewIssue[];
    P3: ReviewIssue[];
  };

  /** Fixed issues */
  fixed: ReviewIssue[];

  /** Documented for later */
  documented: ReviewIssue[];

  /** Review timestamp */
  timestamp: number;
}

// ============================================================================
// Bounded Verified Sections (BVS) Workflow Types
// ============================================================================

// Section Status Lifecycle
export type BvsSectionStatus =
  | 'pending'     // Waiting for dependencies
  | 'in_progress' // Being implemented by a worker
  | 'verifying'   // Running quality gate / E2E tests
  | 'done'        // Successfully completed
  | 'failed'      // Failed verification, needs retry
  | 'retrying'    // Retry in progress

// Worker identification (W1-W5 for parallel, SEQ for sequential)
export type BvsWorkerId = 'W1' | 'W2' | 'W3' | 'W4' | 'W5' | 'SEQ'

// ============================================================================
// Ralph Loop Integration: Subtask Execution
// ============================================================================

// Execution modes (increasing automation levels)
export type BvsExecutionMode =
  | 'ATTENDED_SINGLE'    // Pause after each subtask, await approval
  | 'ATTENDED_LEVEL'     // Pause after each parallel level completes
  | 'SEMI_ATTENDED'      // Auto-continue unless issue detected
  | 'UNATTENDED'         // Full automation, no pauses

// Subtask within a section (schema → types → implementation → tests)
export interface BvsSubtask {
  id: string              // e.g., "RALPH-002-subtask-1"
  sectionId: string       // Parent section ID
  name: string            // e.g., "Update types", "Implement core logic"
  description: string
  files: string[]         // Files to modify in this subtask
  status: 'pending' | 'in_progress' | 'done' | 'failed'

  // Agent SDK session
  agentSessionId?: string
  turnsUsed: number
  maxTurns: number        // Fresh context limit (typically 5)

  // Metrics
  metrics?: BvsSubtaskMetrics

  // Timing
  startedAt?: number
  completedAt?: number
  duration?: number

  // Git
  commitSha?: string      // Commit hash after subtask completes

  // Error tracking
  error?: string
  retryCount: number
}

// Metrics for a single subtask
export interface BvsSubtaskMetrics {
  turnsUsed: number
  tokensInput: number
  tokensOutput: number
  costUsd: number
  model: string           // 'haiku' | 'sonnet'
  filesChanged: number
  linesAdded: number
  linesRemoved: number
}

// Session limits and cost tracking
export interface BvsExecutionLimits {
  maxIterationsPerSubtask: number  // Default: 5
  maxCostPerSubtask: number        // USD, default: 0.50
  maxCostPerSection: number        // USD, default: 5.00
  maxTotalCost: number             // USD, default: 50.00
  stopOnLimitExceeded: boolean     // Default: true
}

// Execution configuration (extends existing BvsExecutionPlan)
export interface BvsExecutionConfig {
  mode: BvsExecutionMode
  limits: BvsExecutionLimits
  enableSubtaskSplitting: boolean  // Default: true
  enableBuildVerification: boolean // Default: true
  autoCommitSubtasks: boolean      // Default: true
}

// Worker color scheme (for UI)
export const BVS_WORKER_COLORS: Record<BvsWorkerId, { name: string; hex: string }> = {
  'W1': { name: 'Blue', hex: '#3B82F6' },
  'W2': { name: 'Green', hex: '#22C55E' },
  'W3': { name: 'Yellow', hex: '#EAB308' },
  'W4': { name: 'Purple', hex: '#A855F7' },
  'W5': { name: 'Orange', hex: '#F97316' },
  'SEQ': { name: 'Gray', hex: '#6B7280' },
}

// Additional UI colors
export const BVS_UI_COLORS = {
  verifying: '#06B6D4', // Cyan
  error: '#EF4444',     // Red
  success: '#22C55E',   // Green
}

// Worker state type (defined here for use in constants below)
export type BvsWorkerState = 'idle' | 'running' | 'completed' | 'failed'

// Centralized worker state icons (for consistent UI across components)
export const BVS_WORKER_STATE_ICONS: Record<BvsWorkerState, string> = {
  idle: '⏸️',
  running: '▶️',
  completed: '✅',
  failed: '❌',
}

// Centralized worker state colors (Tailwind classes)
export const BVS_WORKER_STATE_COLORS: Record<BvsWorkerState, string> = {
  idle: 'bg-gray-100 text-gray-600',
  running: 'bg-blue-100 text-blue-600',
  completed: 'bg-green-100 text-green-600',
  failed: 'bg-red-100 text-red-600',
}

// Section status icons
export const BVS_SECTION_STATUS_ICONS: Record<BvsSectionStatus, string> = {
  pending: '⏳',
  in_progress: '🔄',
  verifying: '🔍',
  done: '✅',
  failed: '❌',
  retrying: '🔁',
}

// Section status colors (Tailwind classes)
export const BVS_SECTION_STATUS_COLORS: Record<BvsSectionStatus, string> = {
  pending: 'bg-gray-100 text-gray-600',
  in_progress: 'bg-blue-100 text-blue-600',
  verifying: 'bg-cyan-100 text-cyan-600',
  done: 'bg-green-100 text-green-600',
  failed: 'bg-red-100 text-red-600',
  retrying: 'bg-yellow-100 text-yellow-600',
}

// ============================================================================
// Task Input Types (PRD Upload OR Interactive Planning)
// ============================================================================

export type BvsInputMode = 'prd_upload' | 'interactive_planning'

export interface BvsPrdSource {
  type: 'file' | 'paste'
  content: string
  fileName?: string
  parsedAt?: number
}

export interface BvsPlanningMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  category?: 'clarification' | 'proposal' | 'refinement' | 'finalization'
}

// ============================================================================
// Section Definition
// ============================================================================

export interface BvsFile {
  path: string
  action: 'create' | 'modify' | 'delete'
  status: 'pending' | 'active' | 'done'
  editsTotal?: number
  editsCompleted?: number
}

// Simplified file info for planning phase (before execution details are added)
export interface BvsFileInfo {
  path: string
  action?: 'create' | 'modify' | 'delete'
  reason?: string  // Why this file is included
}

export interface BvsSuccessCriteria {
  id: string
  description: string
  passed: boolean
  checkedAt?: number
}

export interface BvsSection {
  id: string
  name: string
  description?: string

  // Estimated complexity for planning phase
  estimatedComplexity?: 'low' | 'medium' | 'high'

  // Files in this section
  files: BvsFile[]

  // Ralph Loop: Subtask execution (fresh context per atomic unit)
  subtasks?: BvsSubtask[]  // Atomic units within section (schema, types, impl, tests)

  // Dependencies and status
  dependencies: string[]  // IDs of sections that must complete first
  dependents: string[]    // IDs of sections waiting for this one
  status: BvsSectionStatus

  // Success criteria
  successCriteria: BvsSuccessCriteria[]

  // E2E test mapping
  e2eTestUrls?: string[]  // URLs to navigate to for E2E verification

  // Worker assignment
  workerId?: BvsWorkerId
  worktreePath?: string   // Git worktree path if parallel

  // Progress tracking
  progress: number        // 0-100
  currentStep?: string    // Current step description
  currentFile?: string    // Current file being edited
  currentLine?: number    // Current line number

  // Timing
  elapsedSeconds?: number
  startedAt?: number
  completedAt?: number

  // Retry tracking
  retryCount: number
  maxRetries: number
  lastError?: string
  errorMessage?: string  // For frontend display (same as lastError)

  // Architect diagnosis (from smart retry)
  lastDiagnosis?: BvsArchitectDiagnosis

  // Worker output (accumulated for display)
  workerOutput?: string

  // Commits made in this section
  commits: string[]
}

/**
 * Architect diagnosis result from smart retry
 */
export interface BvsArchitectDiagnosis {
  rootCause: string
  failureType: 'approach' | 'implementation' | 'environment' | 'specification'
  diagnosis: string
  suggestedApproach: string
  filesToReadFirst: string[]
  warningsForWorker: string[]
}

// Type alias for UI components that work with section data
export type BvsSectionData = BvsSection

// ============================================================================
// Dependency Graph
// ============================================================================

export interface BvsDependencyNode {
  sectionId: string
  level: number           // 0 = no dependencies, 1 = depends on level 0, etc.
  dependencies: string[]
  dependents: string[]
}

export interface BvsDependencyGraph {
  nodes: BvsDependencyNode[]
  levels: string[][]      // Sections grouped by level for parallel execution
  criticalPath: string[]  // Longest dependency chain
}

// ============================================================================
// Parallel Orchestration
// ============================================================================

export interface BvsParallelGroup {
  groupId: string
  level: number
  sections: string[]
  status: 'pending' | 'running' | 'completed' | 'failed'
  startedAt?: number
  completedAt?: number
}

// BvsWorkerState is defined above near the constants

export interface BvsWorkerInfo {
  workerId: BvsWorkerId
  sectionId: string | null
  worktreePath: string | null
  state: BvsWorkerState
  progress: number
  currentStep: string | null
  commits: string[]
  startedAt?: number
  completedAt?: number
  error?: string

  // Worker output logs for display
  logs?: string[]

  // Ralph Loop: Aggregated metrics across subtasks
  metrics?: BvsWorkerMetrics
}

// Worker-level metrics (aggregated from subtasks)
export interface BvsWorkerMetrics {
  subtasks: BvsSubtaskMetrics[]  // Metrics per subtask
  totalTurns: number
  totalTokensInput: number
  totalTokensOutput: number
  totalCostUsd: number
  filesChanged: number
  linesAdded: number
  linesRemoved: number
}

export interface BvsParallelConfig {
  maxWorkers: number           // Default: 3
  enableWorktrees: boolean     // Use git worktrees for isolation
  mergeStrategy: 'sequential' | 'batch'
  conflictResolution: 'ai' | 'manual' | 'abort'
}

// ============================================================================
// Verification Results
// ============================================================================

export interface BvsTypeCheckResult {
  passed: boolean
  errors: BvsTypeError[]
  duration: number
  command: string
  output: string
}

export interface BvsTypeError {
  file: string
  line: number
  column: number
  code: string
  message: string
  severity: 'error' | 'warning'
}

export interface BvsLintResult {
  passed: boolean
  errors: BvsLintError[]
  warnings: number
  duration: number
  command: string
  output: string
}

export interface BvsLintError {
  file: string
  line: number
  column: number
  ruleId: string
  message: string
  severity: 'error' | 'warning'
  fixable: boolean
}

export interface BvsTestResult {
  passed: boolean
  testsTotal: number
  testsPassing: number
  testsFailing: number
  duration: number
  command: string
  output: string
  failedTests?: {
    name: string
    error: string
    file?: string
  }[]
}

export interface BvsBuildResult {
  passed: boolean
  duration: number
  command: string
  output: string
  errors: string[]  // Build errors extracted from output
}

export interface BvsE2EResult {
  passed: boolean
  url: string
  screenshots: {
    name: string
    path: string
    timestamp: number
  }[]
  consoleErrors: string[]
  networkErrors: string[]
  interactionResults?: {
    action: string
    passed: boolean
    error?: string
  }[]
  duration: number
}

export interface BvsQualityGateResult {
  passed: boolean
  typeCheck: BvsTypeCheckResult
  lint: BvsLintResult
  tests: BvsTestResult
  build?: BvsBuildResult  // Ralph Loop: Build verification
  e2e: BvsE2EResult[]
  totalDuration: number
  completedAt: number
}

// ============================================================================
// Code Review System (Start-Task Review Agents)
// ============================================================================

export type BvsReviewerType =
  | 'correctness'   // work-reviewer-correctness
  | 'typescript'    // work-reviewer-typescript
  | 'conventions'   // work-reviewer-conventions
  | 'simplicity'    // work-reviewer-simplicity
  | 'security'      // work-reviewer-security (optional)
  | 'performance'   // work-reviewer-performance (optional)

export type BvsReviewPriority = 'P0' | 'P1' | 'P2'

export interface BvsReviewIssue {
  id: string
  reviewer: BvsReviewerType
  priority: BvsReviewPriority
  file: string
  line?: number
  column?: number
  message: string
  suggestion?: string
  codeSnippet?: string
  fixApplied: boolean
  fixedAt?: number
}

export interface BvsReviewerResult {
  reviewer: BvsReviewerType
  status: 'pending' | 'running' | 'completed' | 'failed'
  issues: BvsReviewIssue[]
  duration: number
  error?: string
  completedAt?: number
  reviewData?: string  // Raw JSON output from reviewer agent
  cost?: number        // Cost in USD for this reviewer
}

export interface BvsCodeReviewResult {
  passed: boolean
  reviewers: BvsReviewerResult[]
  totalIssues: number
  issuesByPriority: {
    P0: number
    P1: number
    P2: number
  }
  fixAttempts: number
  maxFixAttempts: number
  duration: number
  completedAt: number
}

// ============================================================================
// Learning System
// ============================================================================

export interface BvsLearning {
  id: string
  problem: string
  solution: string
  preventionRule: string
  files?: string[]
  codePattern?: string
  createdAt: number
  appliedCount: number
  lastAppliedAt?: number
}

export interface BvsConvention {
  id: string
  name: string
  description: string
  rule: string
  examples?: {
    correct: string
    incorrect: string
  }
  filePatterns?: string[]  // Globs for which files this applies to
  enabled: boolean
}

// ============================================================================
// Execution Plan
// ============================================================================

export interface BvsCodebaseContext {
  framework: string | null
  language: string
  packageManager: 'npm' | 'yarn' | 'pnpm' | 'bun' | null
  hasTypeScript: boolean
  hasTests: boolean
  testFramework: string | null
  lintCommand: string | null
  buildCommand: string | null
  devCommand: string | null
  patterns: string[]        // Extracted coding patterns
  conventions: BvsConvention[]
}

export interface BvsExecutionPlan {
  id: string

  // Source
  inputMode: BvsInputMode
  prd?: BvsPrdSource
  planningMessages?: BvsPlanningMessage[]

  // Parsed content
  title: string
  description: string
  totalFeatures: number

  // Codebase analysis
  codebaseContext: BvsCodebaseContext

  // Sections
  sections: BvsSection[]
  dependencyGraph: BvsDependencyGraph
  parallelGroups: BvsParallelGroup[]

  // E2E mapping
  e2eMapping: Record<string, string[]>  // sectionId -> URLs to test

  // Configuration
  parallelConfig: BvsParallelConfig

  // Ralph Loop: Execution configuration
  executionConfig?: BvsExecutionConfig

  // Metadata
  createdAt: number
  approvedAt?: number
  estimatedDuration?: number
}

// ============================================================================
// Session State
// ============================================================================

export type BvsPhase =
  | 'input'       // PRD upload or planning chat
  | 'analysis'    // Analyzing PRD / codebase
  | 'review'      // User reviewing plan
  | 'executing'   // Running sections
  | 'completed'   // All done
  | 'error'       // Fatal error

export type BvsStatus =
  | 'idle'
  | 'analyzing'
  | 'awaiting_approval'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'error'

export interface BvsSession {
  id: string
  projectPath: string
  projectName: string
  projectId?: string  // Link to BvsProject for tracking

  // Current state
  phase: BvsPhase
  status: BvsStatus

  // Plan
  plan: BvsExecutionPlan | null

  // Workers
  workers: BvsWorkerInfo[]

  // Progress
  sectionsTotal: number
  sectionsCompleted: number
  sectionsFailed: number
  sectionsSkipped?: number
  overallProgress: number

  // Current activity
  currentSections: string[]  // Section IDs currently being worked on

  // Learnings from this session
  sessionLearnings: BvsLearning[]

  // Timing
  startedAt?: number
  pausedAt?: number
  completedAt?: number
  totalElapsedSeconds: number

  // Error handling
  lastError?: string
  consecutiveFailures: number

  // Partial execution - when user selects specific sections to run
  // If set, only these sections will be executed; others remain pending
  selectedSectionIds?: Set<string>
}

// ============================================================================
// Events (for real-time updates)
// ============================================================================

export interface BvsSectionUpdateEvent {
  type: 'section_update'
  sectionId: string
  status: BvsSectionStatus
  progress: number
  currentStep?: string
  currentFile?: string
  workerId?: BvsWorkerId
  // Metrics (optional, added when section completes)
  errorMessage?: string
  costUsd?: number
  tokensInput?: number
  tokensOutput?: number
  turnsUsed?: number
}

export interface BvsTypeCheckEvent {
  type: 'typecheck'
  sectionId: string
  result: BvsTypeCheckResult
}

export interface BvsE2EEvent {
  type: 'e2e'
  sectionId: string
  url: string
  result: BvsE2EResult
}

export interface BvsWorkerUpdateEvent {
  type: 'worker_update'
  workerId: BvsWorkerId
  sectionId: string
  state: BvsWorkerState
  progress: number
  color: { name: string; hex: string }
  currentStep?: string
  timestamp: number
}

export interface BvsQualityGateEvent {
  type: 'quality_gate'
  sectionId: string
  result: BvsQualityGateResult
}

export interface BvsCodeReviewEvent {
  type: 'code_review'
  sectionId: string
  result: BvsCodeReviewResult
}

export interface BvsReviewerUpdateEvent {
  type: 'reviewer_update'
  sectionId: string
  reviewer: BvsReviewerType
  status: BvsReviewerResult['status']
  issuesFound?: number
}

export interface BvsReviewIssueEvent {
  type: 'review_issue'
  sectionId: string
  issue: BvsReviewIssue
}

export interface BvsLearningCapturedEvent {
  type: 'learning_captured'
  learning: BvsLearning
}

export interface BvsMergeEvent {
  type: 'merge'
  fromWorktree: string
  success: boolean
  conflicts?: string[]
  resolvedBy?: 'ai' | 'manual'
}

// New event types for parallel execution
export interface BvsComplexityAnalyzedEvent {
  type: 'complexity_analyzed'
  sectionId: string
  analysis: {
    score: number
    model: string
    maxTurns: number
    reasoning: string[]
    riskFlags: string[]
  }
}

export interface BvsLevelStartedEvent {
  type: 'level_started'
  level: number
  sectionIds: string[]
  isFinalLevel: boolean
}

export interface BvsMergePointCompletedEvent {
  type: 'merge_point_completed'
  level: number
  result: {
    success: boolean
    mergedWorkers: string[]
    failedWorkers: string[]
    conflicts: Array<{ file: string; resolved: boolean }>
    autoResolved: number
    integrationPassed: boolean
    errors: string[]
  }
}

export interface BvsSessionFailedEvent {
  type: 'session_failed'
  sessionId: string
  reason: string
  errors: string[]
}

export interface BvsSessionPausedEvent {
  type: 'session_paused'
  sessionId: string
  reason: string
  timestamp?: number
}

export interface BvsWorkerStartedEvent {
  type: 'worker_started'
  sectionId: string
  workerId: BvsWorkerId
  attempt: number
  maxTurns: number
  model: string
  hasDiagnosis?: boolean
}

export interface BvsArchitectDiagnosisStartedEvent {
  type: 'architect_diagnosis_started'
  sectionId: string
  attempt: number
}

export interface BvsArchitectDiagnosisCompleteEvent {
  type: 'architect_diagnosis_complete'
  sectionId: string
  diagnosis: BvsArchitectDiagnosis
}

export interface BvsWorkerCompletedEvent {
  type: 'worker_completed'
  sectionId: string
  workerId: BvsWorkerId
  result: {
    status: string
    turnsUsed: number
    filesChanged: string[]
    qualityGatesPassed: boolean
    errors: string[]
    /** E2E test result if tests were run for this section */
    e2eResult?: BvsE2EResult
  }
}

export interface BvsWorkerFailedEvent {
  type: 'worker_failed'
  sectionId: string
  workerId: BvsWorkerId
  attempt: number
  errors: string[]
  willRetry: boolean
}

export interface BvsWorkerOutputEvent {
  type: 'worker_output'
  sectionId: string
  workerId: BvsWorkerId
  output: string
  timestamp: number
}

// ============================================================================
// UltraQA Events: Goal Review and Fix Loop
// ============================================================================

export interface BvsGoalReviewStartedEvent {
  type: 'goal_review_started'
  sectionId: string
  sectionName: string
}

export interface BvsGoalReviewResultEvent {
  type: 'goal_review_result'
  sectionId: string
  verdict: 'APPROVED' | 'REJECTED' | 'PARTIAL'
  coveragePercent: number
  reasoning: string
  issuestoFix: string[]
}

export interface BvsFixLoopStartedEvent {
  type: 'fix_loop_started'
  sectionId: string
  errors: string[]
}

export interface BvsFixLoopCycleEvent {
  type: 'fix_loop_cycle'
  sectionId: string
  cycle: number
  maxCycles: number
}

export interface BvsFixLoopDiagnosingEvent {
  type: 'fix_loop_diagnosing'
  sectionId: string
  cycle: number
}

export interface BvsFixLoopFixingEvent {
  type: 'fix_loop_fixing'
  sectionId: string
  cycle: number
  diagnosis: string
}

export interface BvsFixLoopCompletedEvent {
  type: 'fix_loop_completed'
  sectionId: string
  success: boolean
  exitReason: 'goal_met' | 'max_cycles' | 'same_failure' | 'error' | 'cancelled'
  totalCycles: number
}

export type BvsEvent =
  | BvsSectionUpdateEvent
  | BvsTypeCheckEvent
  | BvsE2EEvent
  | BvsWorkerUpdateEvent
  | BvsQualityGateEvent
  | BvsCodeReviewEvent
  | BvsReviewerUpdateEvent
  | BvsReviewIssueEvent
  | BvsLearningCapturedEvent
  | BvsMergeEvent
  | BvsComplexityAnalyzedEvent
  | BvsLevelStartedEvent
  | BvsMergePointCompletedEvent
  | BvsSessionFailedEvent
  | BvsSessionPausedEvent
  | BvsWorkerStartedEvent
  | BvsWorkerCompletedEvent
  | BvsWorkerFailedEvent
  | BvsWorkerOutputEvent
  // UltraQA Events
  | BvsGoalReviewStartedEvent
  | BvsGoalReviewResultEvent
  | BvsFixLoopStartedEvent
  | BvsFixLoopCycleEvent
  | BvsFixLoopDiagnosingEvent
  | BvsFixLoopFixingEvent
  | BvsFixLoopCompletedEvent
  // Architect Diagnosis Events
  | BvsArchitectDiagnosisStartedEvent
  | BvsArchitectDiagnosisCompleteEvent

// ============================================================================
// Configuration
// ============================================================================

export interface BvsConfig {
  // TypeScript verification
  typecheck: {
    enabled: boolean
    afterEveryEdit: boolean
    incrementalMode: boolean
    command: string  // Default: 'tsc --incremental --noEmit'
  }

  // E2E testing
  e2e: {
    enabled: boolean
    afterEachSection: boolean
    screenshotOnFailure: boolean
    timeout: number  // Default: 30000
  }

  // Quality gate
  qualityGate: {
    lint: boolean
    typecheck: boolean
    tests: boolean
    build: boolean          // Ralph Loop: Build verification
    e2eTests: boolean
    maxFixAttempts: number  // Default: 3
    allowSkip: boolean
  }

  // Code review (Start-Task Agents)
  codeReview: {
    enabled: boolean
    afterEachSection: boolean
    reviewers: BvsReviewerType[]
    maxFixAttempts: number  // Default: 2
    blockOnP0: boolean      // Block progress on P0 issues
    blockOnP1: boolean      // Block progress on P1 issues
    logP2ToFile: boolean    // Log P2 issues to review-notes.md
    parallelReviewers: boolean  // Run reviewers in parallel
  }

  // Parallel execution
  parallel: BvsParallelConfig

  // Learning
  learning: {
    enabled: boolean
    captureOnFix: boolean
    applyAutomatically: boolean
  }

  // Section limits
  sections: {
    maxFilesPerSection: number  // Default: 5
    maxEditsBeforeVerify: number
  }
}

export const DEFAULT_BVS_CONFIG: BvsConfig = {
  typecheck: {
    enabled: true,
    afterEveryEdit: true,
    incrementalMode: true,
    command: 'npx tsc --incremental --noEmit',
  },
  e2e: {
    enabled: true,
    afterEachSection: true,
    screenshotOnFailure: true,
    timeout: 30000,
  },
  qualityGate: {
    lint: true,
    typecheck: true,
    tests: true,
    build: true,       // Ralph Loop: Build verification enabled by default
    e2eTests: true,
    maxFixAttempts: 3,
    allowSkip: false,
  },
  codeReview: {
    enabled: true,
    afterEachSection: true,
    reviewers: ['correctness', 'typescript', 'conventions', 'simplicity'],
    maxFixAttempts: 2,
    blockOnP0: true,
    blockOnP1: true,
    logP2ToFile: true,
    parallelReviewers: true,
  },
  parallel: {
    maxWorkers: 3,
    enableWorktrees: true,
    mergeStrategy: 'sequential',
    conflictResolution: 'ai',
  },
  learning: {
    enabled: true,
    captureOnFix: true,
    applyAutomatically: true,
  },
  sections: {
    maxFilesPerSection: 5,
    maxEditsBeforeVerify: 10,
  },
}

// Default execution configuration (Ralph Loop integration)
export const DEFAULT_BVS_EXECUTION_CONFIG: BvsExecutionConfig = {
  mode: 'SEMI_ATTENDED',
  limits: {
    maxIterationsPerSubtask: 5,
    maxCostPerSubtask: 0.50,
    maxCostPerSection: 5.00,
    maxTotalCost: 50.00,
    stopOnLimitExceeded: true,
  },
  enableSubtaskSplitting: true,
  enableBuildVerification: true,
  autoCommitSubtasks: true,
}

// ============================================================================
// Ralph Loop: Error Types
// ============================================================================

export class SessionLimitError extends Error {
  constructor(
    public limitType: 'iterations' | 'cost' | 'time',
    public limit: number,
    public actual: number,
    public context: string
  ) {
    super(`Session limit exceeded: ${limitType} limit ${limit}, actual ${actual}. Context: ${context}`)
    this.name = 'SessionLimitError'
  }
}

// ============================================================================
// File Ownership Types (P0.1 - Ultrapilot Improvements)
// ============================================================================

/**
 * File ownership for a section - defines what files the section exclusively owns
 */
export interface FileOwnership {
  /** Files this section exclusively owns */
  exclusiveFiles: string[]
  /** Glob patterns this section owns (e.g., "src/api/**") */
  exclusiveGlobs: string[]
  /** Files this section reads but doesn't modify */
  readOnlyDependencies: string[]
  /** Cross-boundary imports (for tracking) */
  boundaryImports: string[]
}

/**
 * Extended section with file ownership (V2)
 */
export interface BvsSectionV2 extends BvsSection {
  /** File ownership for this section */
  ownership: FileOwnership
  /** Whether ownership has been validated */
  ownershipValidated: boolean
}

/**
 * Ownership map - tracks which sections own which files
 */
export interface OwnershipMap {
  /** Map of file path to owning section ID */
  fileToSection: Record<string, string>
  /** Map of glob pattern to owning section ID */
  globToSection: Record<string, string>
  /** Files classified as shared (no exclusive owner) */
  sharedFiles: string[]
  /** Validation timestamp */
  validatedAt: string
}

/**
 * Result of file classification across sections
 */
export interface ClassificationResult {
  /** Files with single owner */
  exclusiveFiles: Map<string, string>
  /** Files in multiple sections */
  sharedFiles: string[]
  /** Files matching shared patterns */
  patternMatchedShared: string[]
  /** Conflicts that need resolution */
  conflicts: FileConflict[]
}

/**
 * File conflict - when multiple sections claim the same file
 */
export interface FileConflict {
  file: string
  claimingSections: string[]
  resolution: 'first-wins' | 'shared' | 'manual'
}

// ============================================================================
// Decomposition Types (P1.1 - AI-Powered Decomposition)
// ============================================================================

/**
 * Result of AI-powered task decomposition
 */
export interface DecomposedPlan {
  /** Original user requirement */
  requirement: string
  /** Decomposed sections with ownership */
  sections: BvsSectionV2[]
  /** Parallel execution groups */
  parallelGroups: ParallelGroup[]
  /** Files classified as shared */
  sharedFiles: string[]
  /** Critical path (longest dependency chain) */
  criticalPath: CriticalPath
  /** Decomposition metadata */
  metadata: DecompositionMetadata
}

/**
 * Group of sections that can execute in parallel
 */
export interface ParallelGroup {
  /** Group index (execution order) */
  level: number
  /** Section IDs that can run in parallel */
  sectionIds: string[]
  /** Why these are grouped together */
  rationale: string
  /** Estimated duration for this group */
  estimatedDuration?: number
}

/**
 * Critical path analysis result
 */
export interface CriticalPath {
  /** Section IDs in critical path order */
  path: string[]
  /** Total estimated duration */
  totalDuration: number
  /** Bottleneck section (longest single section) */
  bottleneck: string
}

/**
 * Metadata about the decomposition process
 */
export interface DecompositionMetadata {
  /** Model used for decomposition */
  model: 'opus' | 'sonnet'
  /** Time taken to decompose */
  decompositionTimeMs: number
  /** Number of iterations to resolve conflicts */
  conflictResolutionIterations: number
  /** Parallelization efficiency score (0-1) */
  parallelizationScore: number
}

// ============================================================================
// Validation Gate Types (P1.2 - Mandatory Validation)
// ============================================================================

/**
 * Configuration for validation gates
 */
export interface ValidationGateConfig {
  /** Required validation checks */
  required: {
    typecheck: boolean
    lint: boolean
    tests: boolean
    build: boolean
  }
  /** Optional but recommended checks */
  recommended: {
    securityScan: boolean
    e2eTests: boolean
    coverageThreshold: number
  }
  /** Bypass settings */
  allowBypass: {
    enabled: boolean
    requiresReason: boolean
    auditLog: boolean
  }
}

/**
 * Validation bypass request
 */
export interface ValidationBypass {
  /** Who requested the bypass */
  user: string
  /** Why bypass is needed */
  reason: string
  /** Which checks are being bypassed */
  checks: string[]
  /** Timestamp of bypass request */
  timestamp: string
  /** Acknowledgment of risks */
  acknowledgedRisks: boolean
}

// ============================================================================
// Mode Registry Types (P2.1 - Conflict Prevention)
// ============================================================================

/**
 * BVS operational modes
 */
export type BvsMode =
  | 'idle'           // No active operation
  | 'planning'       // Planning agent active
  | 'decomposing'    // Task decomposition in progress
  | 'executing'      // Section execution in progress
  | 'validating'     // Validation gate running
  | 'integrating'    // Shared file integration

/**
 * Mode configuration
 */
export interface ModeConfig {
  name: string
  exclusive: boolean
  conflictsWith: BvsMode[]
  allowsSubMode: BvsMode[]
}

/**
 * Current mode state
 */
export interface ModeState {
  currentMode: BvsMode
  modeData?: Record<string, unknown>
  enteredAt: string
  projectId?: string
  sessionId?: string
  activeSubModes: BvsMode[]
}

// ============================================================================
// Worker Skills Types (P2.2 - Skill Injection)
// ============================================================================

/**
 * Worker skill definition
 */
export interface WorkerSkill {
  /** Skill identifier */
  id: string
  /** When to apply this skill */
  trigger: 'always' | 'on-error' | 'on-new-file' | 'on-test'
  /** Skill instructions */
  instructions: string
  /** Priority (higher = earlier in prompt) */
  priority: number
}

/**
 * Shared file change record (for integration phase)
 */
export interface SharedFileChange {
  file: string
  sectionId: string
  changeType: 'add-dependency' | 'add-script' | 'add-type' | 'modify'
  description: string
  packageChanges?: {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
    scripts?: Record<string, string>
  }
  typeChanges?: {
    exports?: string[]
    imports?: string[]
  }
  contentPatch?: string
}

// ============================================================================
// IPC Channels
// ============================================================================

export const BVS_IPC_CHANNELS = {
  // Session management
  BVS_CREATE_SESSION: 'bvs:create-session',
  BVS_GET_SESSION: 'bvs:get-session',
  BVS_LIST_SESSIONS: 'bvs:list-sessions',
  BVS_DELETE_SESSION: 'bvs:delete-session',
  BVS_RESTORE_SESSION: 'bvs:restore-session',

  // Task input
  BVS_UPLOAD_PRD: 'bvs:upload-prd',
  BVS_START_PLANNING: 'bvs:start-planning',
  BVS_SEND_PLANNING_MESSAGE: 'bvs:send-planning-message',
  BVS_CANCEL_PLANNING: 'bvs:cancel-planning',
  BVS_FINALIZE_PLAN: 'bvs:finalize-plan',

  // Plan management
  BVS_ANALYZE_CODEBASE: 'bvs:analyze-codebase',
  BVS_GENERATE_SECTIONS: 'bvs:generate-sections',
  BVS_APPROVE_PLAN: 'bvs:approve-plan',
  BVS_MODIFY_PLAN: 'bvs:modify-plan',

  // Execution control
  BVS_START_EXECUTION: 'bvs:start-execution',
  BVS_PAUSE_EXECUTION: 'bvs:pause-execution',
  BVS_RESUME_EXECUTION: 'bvs:resume-execution',
  BVS_STOP_EXECUTION: 'bvs:stop-execution',
  BVS_RETRY_SECTION: 'bvs:retry-section',
  BVS_SKIP_SECTION: 'bvs:skip-section',

  // Worker management
  BVS_SPAWN_WORKER: 'bvs:spawn-worker',
  BVS_STOP_WORKER: 'bvs:stop-worker',
  BVS_GET_WORKER_STATUS: 'bvs:get-worker-status',

  // Verification
  BVS_RUN_TYPECHECK: 'bvs:run-typecheck',
  BVS_RUN_LINT: 'bvs:run-lint',
  BVS_RUN_TESTS: 'bvs:run-tests',
  BVS_RUN_E2E: 'bvs:run-e2e',
  BVS_RUN_QUALITY_GATE: 'bvs:run-quality-gate',

  // Code Review (Start-Task Agents)
  BVS_RUN_CODE_REVIEW: 'bvs:run-code-review',
  BVS_SPAWN_REVIEWER: 'bvs:spawn-reviewer',
  BVS_GET_REVIEW_RESULTS: 'bvs:get-review-results',
  BVS_APPLY_REVIEW_FIX: 'bvs:apply-review-fix',
  BVS_DISMISS_REVIEW_ISSUE: 'bvs:dismiss-review-issue',

  // Learning
  BVS_CAPTURE_LEARNING: 'bvs:capture-learning',
  BVS_GET_LEARNINGS: 'bvs:get-learnings',
  BVS_DELETE_LEARNING: 'bvs:delete-learning',

  // Configuration
  BVS_GET_CONFIG: 'bvs:get-config',
  BVS_SET_CONFIG: 'bvs:set-config',

  // Events (main -> renderer)
  BVS_EVENT: 'bvs:event',
  BVS_SECTION_UPDATE: 'bvs:section-update',
  BVS_WORKER_UPDATE: 'bvs:worker-update',
  BVS_TYPECHECK_RESULT: 'bvs:typecheck-result',
  BVS_E2E_RESULT: 'bvs:e2e-result',
  BVS_QUALITY_GATE_RESULT: 'bvs:quality-gate-result',
  BVS_PLANNING_RESPONSE: 'bvs:planning-response',
  BVS_ERROR: 'bvs:error',
  // Project management
  BVS_LIST_PROJECTS: 'bvs:list-projects',
  BVS_GET_PROJECT: 'bvs:get-project',
  BVS_CREATE_PROJECT: 'bvs:create-project',
  BVS_UPDATE_PROJECT: 'bvs:update-project',
  BVS_DELETE_PROJECT: 'bvs:delete-project',
  BVS_ARCHIVE_PROJECT: 'bvs:archive-project',

  // Execution runs (persistent storage for partial runs)
  BVS_LIST_EXECUTION_RUNS: 'bvs:list-execution-runs',
  BVS_GET_EXECUTION_RUN: 'bvs:get-execution-run',
  BVS_CREATE_EXECUTION_RUN: 'bvs:create-execution-run',
  BVS_UPDATE_EXECUTION_RUN: 'bvs:update-execution-run',
  BVS_DELETE_EXECUTION_RUN: 'bvs:delete-execution-run',
  BVS_RESUME_EXECUTION_RUN: 'bvs:resume-execution-run',
} as const

export type BvsIpcChannel = typeof BVS_IPC_CHANNELS[keyof typeof BVS_IPC_CHANNELS]

// ============================================================================
// Project Management Types
// ============================================================================

/**
 * Project status lifecycle:
 * planning -> ready -> in_progress -> completed
 *                   -> paused -> in_progress
 *                   -> cancelled
 */
export type BvsProjectStatus =
  | 'planning'      // Still in planning chat
  | 'ready'         // Plan approved, waiting to start execution
  | 'in_progress'   // Execution running
  | 'paused'        // Execution paused by user
  | 'completed'     // All sections done
  | 'cancelled'     // User cancelled

/**
 * Project metadata stored in project.json
 */
export interface BvsProject {
  id: string                        // e.g., "budgeting-module-20260121-143052"
  name: string                      // AI-generated: "Budgeting Module"
  slug: string                      // kebab-case: "budgeting-module"
  description: string               // Brief summary from planning
  status: BvsProjectStatus

  // Timestamps
  createdAt: number
  updatedAt: number
  planApprovedAt?: number
  executionStartedAt?: number
  executionPausedAt?: number
  completedAt?: number

  // Progress summary (denormalized for quick listing)
  sectionsTotal: number
  sectionsCompleted: number
  sectionsFailed: number

  // Execution config
  selectedSections?: string[]       // If partial execution, which sections to run

  // Source info
  projectPath: string               // The codebase being modified (e.g., C:\Claude_Projects\ERP)
  bvsProjectDir: string             // Full path to this project's .bvs directory
}

/**
 * Project list item (lightweight for UI listing)
 */
export interface BvsProjectListItem {
  id: string
  name: string
  status: BvsProjectStatus
  sectionsTotal: number
  sectionsCompleted: number
  sectionsFailed: number
  createdAt: number
  updatedAt: number
  completedAt?: number
}

/**
 * Execution run - represents a single execution attempt
 * Stored in .bvs/projects/{projectId}/runs/{runId}.json
 */
export interface BvsExecutionRun {
  id: string                          // e.g., "run-20260127-143052"
  projectId: string
  startedAt: number
  pausedAt?: number
  completedAt?: number
  status: 'in_progress' | 'paused' | 'completed' | 'failed'

  // What was selected for this run
  selectedPhases: number[]
  selectedSections: string[]

  // Progress tracking
  sectionsCompleted: string[]
  sectionsFailed: string[]
  sectionsInProgress: string[]
  currentLevel: number

  // Metrics
  totalCostUsd?: number
  totalTokens?: number

  // Session ID for live execution (if running)
  sessionId?: string
}

/**
 * Project directory structure constants
 */
export const BVS_PROJECT_FILES = {
  PROJECT_JSON: 'project.json',
  PLANNING_SESSION: 'planning-session.json',
  PLAN_JSON: 'plan.json',
  PROGRESS_JSON: 'progress.json',
  LOGS_DIR: 'logs',
  CHECKPOINTS_DIR: 'checkpoints',
  RUNS_DIR: 'runs',
} as const

/**
 * Global BVS directory structure
 */
export const BVS_GLOBAL_FILES = {
  PROJECTS_DIR: 'projects',
  CONVENTIONS_MD: 'conventions.md',
  LEARNINGS_MD: 'learnings.md',
  CONFIG_JSON: 'config.json',
} as const

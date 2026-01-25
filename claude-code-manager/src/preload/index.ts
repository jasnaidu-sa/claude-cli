import { contextBridge, ipcRenderer, clipboard, webUtils } from 'electron'
import { IPC_CHANNELS } from '../shared/types'
import type { Session, FileNode, AppConfig, TerminalOutput, BrowserTab, BrowserSnapshot, ConsoleMessage, NetworkRequest, DevServerInfo, EditedFile, OrchestratorConfig, OrchestratorSession, OrchestratorOutput, OrchestratorProgress, WorkflowConfig, WorkflowStatus, WorkflowProgress, ProgressSnapshot, SchemaValidationResult, ComplexityAnalysis, ReadinessCheck, Idea, IdeaStage, IdeaEmailSource, OutlookConfig, ProjectType, InitiatorSession, RequirementsDoc, RalphPromptConfig, RalphPhase, RalphProgressEvent, RalphCheckpointEvent, RalphStatusEvent, RalphCheckpoint, RalphSessionSummary } from '../shared/types'
import type { Worktree, WorktreeStatus, Branch, MergePreview, MergeResult, RemoteStatus, CreateWorktreeOptions, MergeStrategy, ConflictResolutionResult, WorktreeLifecycle } from '../shared/types/git'
import type { ContextData, ContextSummarizationRequest, ContextSummarizationResult, ContextProgress, ContextInjection, ContextAgentTask } from '../shared/context-types'

// Venv types (matching venv-manager.ts)
export interface VenvStatus {
  exists: boolean
  pythonPath: string | null
  pythonVersion: string | null
  isValid: boolean
  installedPackages: string[]
  missingPackages: string[]
  error?: string
}

export interface VenvCreationProgress {
  stage: 'checking' | 'creating' | 'installing' | 'complete' | 'error'
  message: string
  progress?: number
}

// Store for captured file paths during drag-drop
let lastDroppedFilePaths: string[] = []

// Listen for drop events in the preload context (before context isolation)
document.addEventListener('drop', (e) => {
  if (e.dataTransfer?.files) {
    lastDroppedFilePaths = Array.from(e.dataTransfer.files).map(file => {
      // Use webUtils to get the actual file path in Electron
      try {
        return webUtils.getPathForFile(file)
      } catch {
        return file.name
      }
    })
  }
}, true) // Capture phase to get it before the renderer

// Type definitions for exposed API
export interface ElectronAPI {
  // Session management
  session: {
    create: (projectPath: string) => Promise<{ success: boolean; session?: Session; error?: string }>
    destroy: (sessionId: string) => Promise<{ success: boolean }>
    list: () => Promise<Session[]>
    input: (sessionId: string, data: string) => void
    resize: (sessionId: string, cols: number, rows: number) => void
    onOutput: (callback: (output: TerminalOutput) => void) => () => void
    onStatus: (callback: (status: { sessionId: string; status: string; editedFiles: any[] }) => void) => () => void
  }

  // File system
  files: {
    readDir: (dirPath: string, depth?: number) => Promise<{ success: boolean; files?: FileNode[]; error?: string }>
    readFile: (filePath: string) => Promise<{ success: boolean; content?: string; error?: string }>
    writeFile: (filePath: string, content: string) => Promise<{ success: boolean; error?: string }>
    watch: (dirPath: string) => void
    unwatch: (dirPath: string) => void
    onChange: (callback: (change: { event: string; path: string; dirPath: string }) => void) => () => void
  }

  // Config
  config: {
    get: (key?: keyof AppConfig) => Promise<AppConfig>
    set: <K extends keyof AppConfig>(key: K, value: AppConfig[K]) => Promise<{ success: boolean }>
  }

  // Window controls
  window: {
    minimize: () => void
    maximize: () => void
    close: () => void
  }

  // Dialogs
  dialog: {
    selectFolder: () => Promise<{ success: boolean; path?: string; canceled?: boolean }>
  }

  // Browser control (for Claude integration)
  browser: {
    // Tab management
    createTab: (sessionId?: string, url?: string) => Promise<BrowserTab>
    closeTab: (tabId: string) => Promise<boolean>
    selectTab: (tabId: string) => Promise<boolean>
    listTabs: () => Promise<BrowserTab[]>
    onTabsUpdate: (callback: (tabs: BrowserTab[]) => void) => () => void

    // Webview registration (called by Browser component)
    registerWebview: (tabId: string, webContentsId: number, sessionId: string | null) => void
    unregisterWebview: (tabId: string) => void

    // Browser control (for Claude)
    snapshot: (tabId: string) => Promise<BrowserSnapshot | null>
    click: (tabId: string, selector: string) => Promise<{ success: boolean; error?: string }>
    type: (tabId: string, selector: string, text: string) => Promise<{ success: boolean; error?: string }>
    evaluate: (tabId: string, script: string) => Promise<{ success: boolean; result?: any; error?: string }>
    navigate: (tabId: string, url: string) => Promise<{ success: boolean; error?: string }>
    getConsole: (tabId: string) => Promise<ConsoleMessage[]>
    getNetwork: (tabId: string) => Promise<NetworkRequest[]>
  }

  // Dev server management
  devServer: {
    detect: (projectPath: string) => Promise<DevServerInfo | null>
    start: (sessionId: string, projectPath: string, script?: string) => Promise<{ success: boolean; info?: DevServerInfo; error?: string }>
    stop: (sessionId: string) => Promise<{ success: boolean }>
    status: (sessionId: string) => Promise<DevServerInfo | null>
    onStatusChange: (callback: (data: { sessionId: string; running: boolean; exitCode?: number }) => void) => () => void
    onLog: (callback: (data: { sessionId: string; log: string }) => void) => () => void
  }

  // Clipboard operations (using Electron's native clipboard)
  clipboard: {
    readText: () => string
    writeText: (text: string) => void
  }

  // Shell operations
  shell: {
    // Register a callback for file drops - must be called during dragover/drop to get paths
    startFileDrop: () => void
    getDroppedFilePaths: () => string[]
  }

  // Git operations
  git: {
    listWorktrees: (repoPath: string) => Promise<Worktree[]>
    createWorktree: (options: CreateWorktreeOptions) => Promise<Worktree>
    removeWorktree: (worktreePath: string, force?: boolean) => Promise<void>
    getStatus: (worktreePath: string) => Promise<WorktreeStatus>
    listBranches: (repoPath: string) => Promise<Branch[]>
    getMergePreview: (worktreePath: string) => Promise<MergePreview>
    merge: (worktreePath: string, strategy: MergeStrategy) => Promise<MergeResult>
    abortMerge: (repoPath: string) => Promise<void>
    pull: (worktreePath: string) => Promise<{ success: boolean; error?: string }>
    push: (worktreePath: string, setUpstream?: boolean) => Promise<{ success: boolean; error?: string }>
    fetch: (repoPath: string) => Promise<void>
    getRemoteStatus: (worktreePath: string) => Promise<RemoteStatus>
    getStaleWorktrees: (repoPath: string, daysThreshold?: number) => Promise<Worktree[]>
    // AI conflict resolution
    mergeWithAI: (worktreePath: string, strategy: MergeStrategy, useAI?: boolean, confidenceThreshold?: number) => Promise<MergeResult & { resolutions?: ConflictResolutionResult[] }>
    isAIAvailable: () => Promise<boolean>
    // Lifecycle management
    initLifecycleTracking: (repoPath: string) => Promise<void>
    createManagedWorktree: (repoPath: string, branchName: string, baseBranch: string | undefined, workflowId: string) => Promise<Worktree>
    cleanupStaleWorktrees: (repoPath: string, dryRun?: boolean) => Promise<string[]>
    getLifecycle: (worktreePath: string) => Promise<WorktreeLifecycle | null>
    getAllLifecycles: () => Promise<WorktreeLifecycle[]>
    updateLifecycleStatus: (worktreePath: string, status: WorktreeLifecycle['status']) => Promise<void>
  }

  // Python venv management
  venv: {
    getStatus: () => Promise<VenvStatus>
    ensure: () => Promise<VenvStatus>
    upgrade: () => Promise<{ success: boolean; error?: string }>
    onProgress: (callback: (progress: VenvCreationProgress) => void) => () => void
  }

  // Python orchestrator runner
  orchestrator: {
    start: (config: OrchestratorConfig) => Promise<{ success: boolean; session?: OrchestratorSession; error?: string }>
    stop: (sessionId: string) => Promise<{ success: boolean; error?: string }>
    pause: (sessionId: string) => Promise<{ success: boolean; error?: string }>
    getSession: (sessionId: string) => Promise<OrchestratorSession | null>
    getAllSessions: () => Promise<OrchestratorSession[]>
    getWorkflowSessions: (workflowId: string) => Promise<OrchestratorSession[]>
    cleanup: () => Promise<{ success: boolean }>
    onOutput: (callback: (output: OrchestratorOutput) => void) => () => void
    onProgress: (callback: (progress: OrchestratorProgress) => void) => () => void
    onSession: (callback: (session: OrchestratorSession) => void) => () => void
  }

  // Workflow management
  workflow: {
    create: (options: CreateWorkflowOptions) => Promise<{ success: boolean; workflow?: WorkflowConfig; error?: string }>
    get: (projectPath: string, workflowId: string) => Promise<WorkflowConfig | null>
    update: (projectPath: string, workflowId: string, updates: UpdateWorkflowOptions) => Promise<{ success: boolean; workflow?: WorkflowConfig; error?: string }>
    delete: (projectPath: string, workflowId: string) => Promise<{ success: boolean; error?: string }>
    list: () => Promise<WorkflowConfig[]>
    listForProject: (projectPath: string) => Promise<WorkflowConfig[]>
    updateStatus: (projectPath: string, workflowId: string, status: WorkflowStatus, error?: string) => Promise<{ success: boolean; workflow?: WorkflowConfig; error?: string }>
    updateProgress: (projectPath: string, workflowId: string, progress: WorkflowProgress) => Promise<{ success: boolean; workflow?: WorkflowConfig; error?: string }>
    onChange: (callback: (change: { workflow: WorkflowConfig; action: 'created' | 'updated' | 'deleted' }) => void) => () => void
  }

  // Progress watcher
  progress: {
    watch: (workflowId: string, projectPath: string) => Promise<{ success: boolean; snapshot?: ProgressSnapshot | null; error?: string }>
    unwatch: (workflowId: string) => Promise<{ success: boolean; error?: string }>
    get: (workflowId: string) => Promise<ProgressSnapshot | null>
    onUpdate: (callback: (snapshot: ProgressSnapshot) => void) => () => void
  }

  // Schema validator
  schema: {
    validate: (projectPath: string, workflowId: string, model?: string) => Promise<{ success: boolean; sessionId?: string; error?: string }>
    getResult: (projectPath: string) => Promise<SchemaValidationResult | null>
    clear: (projectPath: string) => Promise<{ success: boolean; error?: string }>
    getStatus: (projectPath: string) => Promise<{ status: string; error?: string }>
    onStatus: (callback: (status: { projectPath: string; status: string; error?: string }) => void) => () => void
  }

  // Discovery Chat
  discovery: {
    checkExistingSession: (projectPath: string) => Promise<{ success: boolean; exists?: boolean; session?: ExistingSessionInfo; error?: string }>
    createSession: (projectPath: string, isNewProject: boolean) => Promise<{ success: boolean; session?: DiscoverySession; error?: string }>
    createFreshSession: (projectPath: string, isNewProject: boolean) => Promise<{ success: boolean; session?: DiscoverySession; error?: string }>
    sendMessage: (sessionId: string, content: string) => Promise<{ success: boolean; error?: string }>
    getMessages: (sessionId: string) => Promise<{ success: boolean; messages?: DiscoveryChatMessage[]; error?: string }>
    getSession: (sessionId: string) => Promise<{ success: boolean; session?: DiscoverySession | null; error?: string }>
    cancelRequest: () => Promise<{ success: boolean; error?: string }>
    closeSession: (sessionId: string) => Promise<{ success: boolean; error?: string }>
    updateAgentStatus: (sessionId: string, agentName: string, status: string, output?: string, error?: string) => Promise<{ success: boolean; error?: string }>
    // Draft management
    listDrafts: (projectPath: string) => Promise<{ success: boolean; drafts?: DraftMetadata[]; error?: string }>
    loadDraft: (projectPath: string, draftId: string) => Promise<{ success: boolean; session?: DiscoverySession; error?: string }>
    deleteDraft: (projectPath: string, draftId: string) => Promise<{ success: boolean; error?: string }>
    // Quick spec generation
    generateQuickSpec: (sessionId: string) => Promise<{ success: boolean; error?: string }>
    // BMAD-Inspired: Complexity analysis and spec validation
    analyzeComplexity: (sessionId: string) => Promise<{ success: boolean; analysis?: ComplexityAnalysis; error?: string }>
    validateSpec: (projectPath: string, specContent?: string) => Promise<{ success: boolean; readinessCheck?: ReadinessCheck; error?: string }>
    // Event listeners
    onResponseChunk: (callback: (data: { sessionId: string; messageId: string; chunk: string; timestamp: number }) => void) => () => void
    onResponseComplete: (callback: (data: { sessionId: string; message: DiscoveryChatMessage }) => void) => () => void
    onAgentStatus: (callback: (data: { sessionId: string; agent: DiscoveryAgentStatus }) => void) => () => void
    onError: (callback: (data: { sessionId: string; error: string }) => void) => () => void
    onSpecReady: (callback: (data: { sessionId: string; spec: string }) => void) => () => void
  }

  // Preflight checks
  preflight: {
    checkApiKey: () => Promise<{ hasKey: boolean; authMethod?: string; keyPreview?: string | null; error?: string }>
    checkClaudeCli: () => Promise<{ available: boolean; version?: string; error?: string }>
    checkGitStatus: (projectPath: string) => Promise<{ isRepo: boolean; clean: boolean; uncommitted: number; files?: string[]; error?: string }>
    checkPython: () => Promise<{ available: boolean; version?: string; command?: string; meetsMinimum?: boolean; error?: string }>
  }

  // Journey analysis (Phase 1 - codebase analysis for brownfield projects)
  journey: {
    startAnalysis: (projectPath: string) => Promise<{ success: boolean; taskId?: string; error?: string }>
    cancelAnalysis: (projectPath: string) => Promise<{ success: boolean; error?: string }>
    getStatus: (projectPath: string) => Promise<{ inProgress: boolean; status?: string }>
    onComplete: (callback: (data: { projectPath: string; success: boolean; analysis?: JourneyAnalysisResult; error?: string }) => void) => () => void
    onStatus: (callback: (data: { projectPath: string; status: string }) => void) => () => void
  }

  // Spec builder (Phase 3 - generate detailed specification)
  specBuilder: {
    buildSpec: (projectPath: string, conversationContext: string, journeyContext?: string) => Promise<{ success: boolean; taskId?: string; error?: string }>
    cancel: (projectPath: string) => Promise<{ success: boolean; error?: string }>
    getStatus: (projectPath: string) => Promise<{ inProgress: boolean; status?: string }>
    onComplete: (callback: (data: { projectPath: string; success: boolean; spec?: GeneratedSpecResult; error?: string }) => void) => () => void
    onStatus: (callback: (data: { projectPath: string; status: string }) => void) => () => void
  }

  // Context Agent (Phase 1 - maintain compressed context)
  context: {
    summarize: (request: ContextSummarizationRequest) => Promise<{ success: boolean; taskId?: string; error?: string }>
    load: (projectPath: string) => Promise<{ success: boolean; data?: ContextData; error?: string }>
    getInjection: (projectPath: string, featureId: string) => Promise<{ success: boolean; injection?: ContextInjection; error?: string }>
    cancel: (taskId: string) => Promise<{ success: boolean }>
    getTask: (taskId: string) => Promise<{ success: boolean; task?: ContextAgentTask; error?: string }>
    onProgress: (callback: (data: { taskId: string; progress: ContextProgress }) => void) => () => void
    onComplete: (callback: (data: { taskId: string; result: ContextSummarizationResult }) => void) => () => void
    onError: (callback: (data: { taskId: string; error: string }) => void) => () => void
  }

  // Ideas Kanban (Email-based project ideas)
  ideas: {
    list: (stage?: IdeaStage) => Promise<{ success: boolean; ideas?: Idea[]; error?: string }>
    get: (ideaId: string) => Promise<{ success: boolean; idea?: Idea; error?: string }>
    create: (options: CreateIdeaOptions) => Promise<{ success: boolean; idea?: Idea; error?: string }>
    update: (ideaId: string, options: UpdateIdeaOptions) => Promise<{ success: boolean; idea?: Idea; error?: string }>
    delete: (ideaId: string) => Promise<{ success: boolean; error?: string }>
    moveStage: (ideaId: string, newStage: IdeaStage) => Promise<{ success: boolean; idea?: Idea; error?: string }>
    addDiscussion: (ideaId: string, role: 'user' | 'assistant', content: string) => Promise<{ success: boolean; idea?: Idea; error?: string }>
    startProject: (ideaId: string, projectType: ProjectType, projectPath?: string, projectName?: string) => Promise<{ success: boolean; idea?: Idea; error?: string }>
    linkWorkflow: (ideaId: string, workflowId: string) => Promise<{ success: boolean; idea?: Idea; error?: string }>
    // Bulk operations
    clearAll: () => Promise<{ success: boolean; count?: number; error?: string }>
    reprocessAll: () => Promise<{ success: boolean; processed?: number; updated?: number; error?: string }>
    reprocess: (ideaId: string) => Promise<{ success: boolean; idea?: Idea; error?: string }>
    // AI Discussion with streaming
    // Mode: 'chat' (default), 'plan' (structured planning with file reading), or 'execute' (can write files)
    discuss: (ideaId: string, userMessage: string, mode?: 'chat' | 'plan' | 'execute') => Promise<{ success: boolean; error?: string }>
    onDiscussStream: (callback: (data: IdeaDiscussStreamData) => void) => () => void
    // Browser login for paywalled sites
    browserLogin: (url?: string) => Promise<{ success: boolean; error?: string }>
    hasSession: (domain: string) => Promise<{ success: boolean; hasSession?: boolean; error?: string }>
    clearCookies: () => Promise<{ success: boolean; error?: string }>
  }

  // Autocoder Autonomous Coding UI
  autocoder: {
    start: (projectPath: string) => Promise<{ success: boolean; message?: string; error?: string }>
    stop: () => Promise<{ success: boolean; message?: string; error?: string }>
    show: () => Promise<{ success: boolean; message?: string; error?: string }>
    hide: () => Promise<{ success: boolean; message?: string; error?: string }>
    status: () => Promise<{ success: boolean; isRunning: boolean; projectPath: string | null; error?: string }>
    setupPython: () => Promise<{ success: boolean; message?: string; pythonVersion?: string; error?: string }>
    updateDependencies: () => Promise<{ success: boolean; message?: string; error?: string }>
    onLog: (callback: (data: { type: 'stdout' | 'stderr'; message: string }) => void) => () => void
    onError: (callback: (data: { message: string }) => void) => () => void
    onStopped: (callback: (data: { code: number | null; signal: string | null }) => void) => () => void
  }

  // Ralph Loop Orchestrator (Execution)
  ralph: {
    start: (config: RalphOrchestratorConfig) => Promise<{ success: boolean; session?: RalphSession; error?: string }>
    stop: (sessionId: string) => Promise<{ success: boolean; error?: string }>
    pause: (sessionId: string) => Promise<{ success: boolean; error?: string }>
    resume: (sessionId: string) => Promise<{ success: boolean; error?: string }>
    getStatus: (sessionId: string) => Promise<{ success: boolean; session?: RalphSession; error?: string }>
    getAllSessions: () => Promise<{ success: boolean; sessions?: RalphSession[]; error?: string }>
    getProjectSessions: (projectPath: string) => Promise<{ success: boolean; sessions?: RalphSession[]; error?: string }>
    cleanup: () => Promise<{ success: boolean; error?: string }>
    // Checkpoint responses
    approveCheckpoint: (sessionId: string, checkpointId: string, comment?: string) => Promise<{ success: boolean; error?: string }>
    skipCheckpoint: (sessionId: string, checkpointId: string, comment?: string) => Promise<{ success: boolean; error?: string }>
    rejectCheckpoint: (sessionId: string, checkpointId: string, comment?: string) => Promise<{ success: boolean; error?: string }>
    // Event listeners
    onProgress: (callback: (data: RalphProgressData) => void) => () => void
    onCheckpoint: (callback: (data: RalphCheckpointData) => void) => () => void
    onStatus: (callback: (data: RalphStatusData) => void) => () => void
    onStreamChunk: (callback: (data: RalphStreamChunkData) => void) => () => void
    onError: (callback: (data: RalphErrorData) => void) => () => void
    // Session History
    listSessions: (projectPath?: string) => Promise<{ success: boolean; sessions?: RalphSessionSummary[]; error?: string }>
    saveSession: (session: RalphSessionSummary) => Promise<{ success: boolean; error?: string }>
    getSessionHistory: (sessionId: string) => Promise<{ success: boolean; session?: RalphSessionSummary; error?: string }>
    deleteSession: (sessionId: string) => Promise<{ success: boolean; error?: string }>
  }

  // Ralph Loop Initiator (Requirements Gathering)
  initiator: {
    start: (projectPath: string, options?: { forceNew?: boolean }) => Promise<{ success: boolean; data?: InitiatorSession; error?: string }>
    getSession: (sessionId: string) => Promise<{ success: boolean; data?: InitiatorSession | null; error?: string }>
    sendMessage: (sessionId: string, content: string, attachmentPaths?: string[]) => Promise<{ success: boolean; error?: string }>
    summarize: (sessionId: string) => Promise<{ success: boolean; data?: RequirementsDoc; error?: string }>
    generatePrompt: (sessionId: string) => Promise<{ success: boolean; data?: RalphPromptConfig; error?: string }>
    updatePrompt: (sessionId: string, updates: Partial<RalphPromptConfig>) => Promise<{ success: boolean; data?: RalphPromptConfig; error?: string }>
    approvePrompt: (sessionId: string) => Promise<{ success: boolean; data?: { session: InitiatorSession; promptPath: string }; error?: string }>
    cancel: (sessionId: string) => Promise<{ success: boolean; error?: string }>
    onResponseChunk: (callback: (data: InitiatorChunkData) => void) => () => void
    onResponseComplete: (callback: (data: InitiatorCompleteData) => void) => () => void
    onRequirementsReady: (callback: (data: InitiatorRequirementsData) => void) => () => void
    onPromptReady: (callback: (data: InitiatorPromptData) => void) => () => void
    onError: (callback: (data: InitiatorErrorData) => void) => () => void
  }

  // Outlook Email Integration
  outlook: {
    configure: (config: Partial<OutlookConfig>) => Promise<{ success: boolean; error?: string }>
    getConfig: () => Promise<{ success: boolean; config?: OutlookConfig | null; error?: string }>
    authenticate: () => Promise<{ success: boolean; error?: string }>
    fetchEmails: (options?: { maxResults?: number; sinceDate?: string; onlySinceLastSync?: boolean }) => Promise<{ success: boolean; count?: number; ideas?: Idea[]; error?: string }>
    sync: () => Promise<{ success: boolean; count?: number; ideas?: Idea[]; error?: string }>
    syncStream: (options?: { fullRefresh?: boolean }) => Promise<{ success: boolean; error?: string }>
    onSyncProgress: (callback: (data: SyncProgressData) => void) => () => void
    getStatus: () => Promise<{ success: boolean; status?: { configured: boolean; authenticated: boolean; sourceEmail: string | null; lastSyncAt: number | null }; error?: string }>
    // Reset sync timestamp when it gets out of sync
    resetSync: () => Promise<{ success: boolean; error?: string }>
  }

  // API Server (for remote access / thin client mode)
  apiServer: {
    start: (config: ApiServerConfig) => Promise<ApiServerStartResult>
    stop: () => Promise<{ success: boolean; error?: string }>
    status: () => Promise<ApiServerStatusResult>
  }

  // BVS (Bounded Verified Sections) Planning V2
  bvsPlanning: {
    // Session management
    startSession: (projectPath: string) => Promise<BvsPlanningStartResult>
    getSession: (sessionId: string) => Promise<{ success: boolean; session?: BvsPlanningSessionV2 }>
    clearSession: (projectPath: string) => Promise<{ success: boolean }>

    // Message handling
    sendMessage: (sessionId: string, message: string) => Promise<BvsPlanningMessageResult>

    // Discovery actions (question/option button clicks)
    answerQuestions: (sessionId: string, answers: Record<string, string>) => Promise<BvsPlanningMessageResult>
    selectOption: (sessionId: string, optionId: string) => Promise<BvsPlanningMessageResult>
    approvePlan: (sessionId: string) => Promise<BvsPlanningMessageResult>
    requestChanges: (sessionId: string, feedback: string) => Promise<BvsPlanningMessageResult>

    // Project management
    listProjects: (projectPath: string) => Promise<{ success: boolean; projects?: BvsProjectItem[]; error?: string }>
    getProject: (projectPath: string, projectId: string) => Promise<{ success: boolean; project?: BvsProjectItem; error?: string }>
    updateProject: (projectPath: string, projectId: string, updates: { status?: string; selectedSections?: string[] }) => Promise<{ success: boolean; project?: BvsProjectItem; error?: string }>
    deleteProject: (projectPath: string, projectId: string, archive?: boolean) => Promise<{ success: boolean; error?: string }>
    resumeProject: (projectPath: string, projectId: string) => Promise<{ success: boolean; session?: BvsPlanningSessionV2; error?: string }>
    loadPlan: (projectPath: string, projectId?: string) => Promise<{ success: boolean; plan?: BvsExecutionPlanItem; error?: string }>

    // Plan revision
    analyzePlan: (projectPath: string, projectId: string) => Promise<{ success: boolean; issues?: unknown[]; error?: string }>
    revisePlan: (request: {
      projectPath: string
      projectId: string
      message: string
      issues: unknown[]
      conversationHistory: Array<{ role: string; content: string }>
    }) => Promise<{ success: boolean; response?: unknown; error?: string }>
    applyPlanChanges: (projectPath: string, projectId: string, changes: unknown[]) => Promise<{ success: boolean; error?: string }>

    // Execution management
    startExecution: (projectPath: string, projectId: string) => Promise<{ success: boolean; sessionId?: string; error?: string }>
    pauseExecution: (sessionId: string) => Promise<{ success: boolean; error?: string }>
    resumeExecution: (sessionId: string) => Promise<{ success: boolean; error?: string }>
    getExecutionSession: (sessionId: string) => Promise<{ success: boolean; session?: BvsSessionData }>
    listExecutionSessions: () => Promise<{ success: boolean; sessions?: BvsSessionData[] }>

    // Parallel execution with merge points
    startParallelExecution: (sessionId: string) => Promise<{ success: boolean; error?: string }>
    startParallelExecutionFromProject: (projectPath: string, projectId: string) => Promise<{ success: boolean; sessionId?: string; error?: string }>
    analyzeComplexity: (projectPath: string, projectId: string) => Promise<{
      success: boolean
      analyses?: Array<{
        sectionId: string
        sectionName: string
        score: number
        model: string
        maxTurns: number
        reasoning: string[]
        riskFlags: string[]
      }>
      distribution?: { haiku: number; sonnet: number; totalTurns: number }
      error?: string
    }>

    // Ralph Loop - Cost tracking and subtask progress (RALPH-004, RALPH-006)
    getSessionCost: (sessionId: string) => Promise<{ success: boolean; cost?: number; error?: string }>
    getSubtaskProgress: (sessionId: string, sectionId: string) => Promise<{ success: boolean; subtasks?: unknown[]; error?: string }>
    approveContinue: (sessionId: string) => Promise<{ success: boolean; error?: string }>

    // Streaming event listeners
    onToolStart: (callback: (data: BvsToolStartData) => void) => () => void
    onToolResult: (callback: (data: BvsToolResultData) => void) => () => void
    onResponseChunk: (callback: (data: BvsResponseChunkData) => void) => () => void
    onResponseComplete: (callback: (data: BvsResponseCompleteData) => void) => () => void
    onQuestionsReady: (callback: (data: BvsQuestionsReadyData) => void) => () => void
    onOptionsReady: (callback: (data: BvsOptionsReadyData) => void) => () => void
    onSectionsReady: (callback: (data: BvsSectionsReadyData) => void) => () => void
    onPlanWritten: (callback: (data: BvsPlanWrittenData) => void) => () => void
    onError: (callback: (data: BvsErrorData) => void) => () => void
  }
}

// API Server types
export interface ApiServerConfig {
  port: number
  enableAuth?: boolean
}

export interface ApiServerStartResult {
  success: boolean
  data?: {
    port: number
    authToken: string
    status: { running: boolean; port: number; connectedClients: number }
  }
  error?: string
}

export interface ApiServerStatusResult {
  success: boolean
  data?: {
    running: boolean
    port?: number
    connectedClients?: number
    authToken?: string
  }
  error?: string
}

// BVS Planning V2 types

export interface BvsPlanningQuestionOption {
  id: string
  label: string
  description: string
}

export interface BvsPlanningQuestion {
  id: string
  category: string
  question: string
  options: BvsPlanningQuestionOption[]
}

export interface BvsPlanningOption {
  id: string
  name: string
  description: string
  recommended?: boolean
  sectionCount: number
  complexity: 'low' | 'medium' | 'high'
}

export interface BvsPlannedSection {
  id: string
  name: string
  description: string
  files: Array<{ path: string; action: 'create' | 'modify' | 'delete' }>
  dependencies: string[]
  successCriteria: string[]
}

export interface BvsPlanningMessageV2 {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  questions?: BvsPlanningQuestion[]
  options?: BvsPlanningOption[]
  sections?: BvsPlannedSection[]
  toolCalls?: Array<{
    name: string
    input: Record<string, unknown>
    result?: string
  }>
}

export interface BvsPlanningSessionV2 {
  id: string
  projectPath: string
  messages: BvsPlanningMessageV2[]
  phase: 'exploring' | 'options' | 'planning' | 'approval' | 'complete'
  selectedOption?: string
  proposedSections?: BvsPlannedSection[]
  sdkSessionId?: string
  createdAt: number
  updatedAt: number
  totalCostUsd?: number
}

export interface BvsPlanningStartResult {
  success: boolean
  session?: BvsPlanningSessionV2
  error?: string
}

export interface BvsPlanningMessageResult {
  success: boolean
  response?: BvsPlanningMessageV2
  session?: BvsPlanningSessionV2
  phase?: string
  error?: string
}

// BVS Project types
export type BvsProjectStatus =
  | 'planning'      // Still in planning chat
  | 'ready'         // Plan approved, waiting to start execution
  | 'in_progress'   // Execution running
  | 'paused'        // Execution paused by user
  | 'completed'     // All sections done
  | 'cancelled'     // User cancelled

export interface BvsProjectItem {
  id: string
  name: string
  slug: string
  description: string
  status: BvsProjectStatus
  createdAt: number
  updatedAt: number
  planApprovedAt?: number
  executionStartedAt?: number
  completedAt?: number
  sectionsTotal: number
  sectionsCompleted: number
  sectionsFailed: number
  selectedSections?: string[]
  projectPath: string
  bvsProjectDir: string
}

export interface BvsExecutionPlanItem {
  id: string
  projectPath: string
  createdAt: number
  approvedAt?: number
  sections: BvsPlannedSection[]
}

// BVS Session data (from orchestrator)
export interface BvsSessionData {
  id: string
  projectPath: string
  projectName: string
  projectId?: string
  phase: string
  status: string
  sectionsTotal: number
  sectionsCompleted: number
  sectionsFailed: number
  overallProgress: number
  startedAt?: number
  completedAt?: number
  plan?: {
    sections: Array<{
      id: string
      name: string
      status: string
      progress: number
      workerId?: string
      currentStep?: string
    }>
  }
}

// Streaming event data types
export interface BvsToolStartData {
  sessionId: string
  tool: string
  input: Record<string, unknown>
}

export interface BvsToolResultData {
  sessionId: string
  tool: string
  result: string
}

export interface BvsResponseChunkData {
  sessionId: string
  chunk: string
  fullContent: string
}

export interface BvsResponseCompleteData {
  sessionId: string
  message: BvsPlanningMessageV2
}

export interface BvsQuestionsReadyData {
  sessionId: string
  questions: BvsPlanningQuestion[]
}

export interface BvsOptionsReadyData {
  sessionId: string
  options: BvsPlanningOption[]
}

export interface BvsSectionsReadyData {
  sessionId: string
  sections: BvsPlannedSection[]
}

export interface BvsPlanWrittenData {
  sessionId: string
  planPath: string
}

export interface BvsErrorData {
  sessionId: string
  error: string
}

// Sync progress data types
export interface SyncProgressData {
  type: 'start' | 'idea' | 'complete' | 'error'
  idea?: Idea
  current?: number
  total?: number
  count?: number
  error?: string
}

// Ideas Discussion streaming data
export interface IdeaDiscussStreamData {
  type: 'chunk' | 'complete' | 'error'
  ideaId: string
  chunk?: string
  fullResponse?: string
  error?: string
}

// Initiator event data types
export interface InitiatorChunkData {
  sessionId: string
  messageId: string
  chunk: string
  fullContent: string
  eventType: 'text' | 'system'
  timestamp: number
}

export interface InitiatorCompleteData {
  sessionId: string
  messageId: string
  content: string
  isReadyToSummarize: boolean
  timestamp: number
}

export interface InitiatorRequirementsData {
  sessionId: string
  requirements: RequirementsDoc
  timestamp: number
}

export interface InitiatorPromptData {
  sessionId: string
  promptConfig: RalphPromptConfig
  timestamp: number
}

export interface InitiatorErrorData {
  sessionId: string
  error: string
  timestamp: number
}

// Alias for preload to avoid conflicts
export type InitiatorRalphPromptConfig = RalphPromptConfig

// Ralph Orchestrator types
export interface RalphOrchestratorConfig {
  projectPath: string
  promptConfig: RalphPromptConfig
  phase?: RalphPhase
  resumeFromCheckpoint?: string
}

export interface RalphSession {
  id: string
  projectPath: string
  config: RalphOrchestratorConfig
  status: 'idle' | 'starting' | 'running' | 'paused' | 'completed' | 'error'
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

export interface RalphFeature {
  id: string
  name: string
  description: string
  category: string
  status: 'pending' | 'in_progress' | 'passed' | 'failed' | 'skipped'
  attempts: number
  completedAt: number | null
}

export interface RalphProgressData {
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

export interface RalphCheckpointData {
  sessionId: string
  type: 'checkpoint'
  data: RalphCheckpoint
}

export interface RalphStatusData {
  sessionId: string
  type: 'status'
  status: 'idle' | 'starting' | 'running' | 'paused' | 'completed' | 'error'
  phase: RalphPhase
  iteration: number
  timestamp: number
}

export interface RalphStreamChunkData {
  sessionId: string
  type: 'stdout' | 'stderr' | 'event'
  data: string | Record<string, unknown>
  timestamp: number
}

export interface RalphErrorData {
  sessionId: string
  error: string
  timestamp: number
}

// Journey Analysis types
export interface JourneyAnalysisResult {
  completed: boolean
  userFlows: string[]
  entryPoints: string[]
  dataModels: string[]
  techStack: string[]
  patterns: string[]
  summary: string
}

// Generated Spec types
export interface GeneratedSpecResult {
  markdown: string
  appSpecTxt: string
  sections: SpecSectionResult[]
  featureCount: number
  readyForExecution: boolean
}

export interface SpecSectionResult {
  id: string
  title: string
  content: string
  editable: boolean
}

// Discovery Chat types
export interface DiscoveryChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
}

export interface DiscoveryAgentStatus {
  name: string
  status: 'idle' | 'running' | 'complete' | 'error'
  output?: string
  error?: string
}

export interface DiscoverySession {
  id: string
  projectPath: string
  isNewProject: boolean
  messages: DiscoveryChatMessage[]
  agentStatuses: DiscoveryAgentStatus[]
  createdAt: number
}

// Existing session info (for resume dialog)
export interface ExistingSessionInfo {
  id: string
  projectPath: string
  isNewProject: boolean
  messageCount: number
  userMessageCount: number
  assistantMessageCount: number
  createdAt: number
  discoveryReady?: boolean
}

// Draft metadata for timeline view
export interface DraftMetadata {
  id: string
  name: string
  description: string
  createdAt: number
  updatedAt: number
  messageCount: number
  userMessageCount: number
  assistantMessageCount: number
  discoveryReady: boolean
  isNewProject: boolean
  preview: string
}

// Workflow options types (matching workflow-manager.ts)
export interface CreateWorkflowOptions {
  projectPath: string
  name: string
  description?: string
  specContent: string
  model?: string
  useWorktree?: boolean
  worktreeBranch?: string
}

export interface UpdateWorkflowOptions {
  name?: string
  description?: string
  status?: WorkflowStatus
  progress?: WorkflowProgress
  error?: string
}

// Ideas options types (matching ideas-manager.ts)
export interface CreateIdeaOptions {
  title: string
  description: string
  emailSource: IdeaEmailSource
  tags?: string[]
  priority?: 'low' | 'medium' | 'high' | 'urgent'
}

export interface UpdateIdeaOptions {
  title?: string
  description?: string
  projectType?: ProjectType
  associatedProjectPath?: string
  associatedProjectName?: string
  reviewNotes?: string
  tags?: string[]
  priority?: 'low' | 'medium' | 'high' | 'urgent'
}

// Create the API object
const electronAPI: ElectronAPI = {
  session: {
    create: (projectPath) => ipcRenderer.invoke(IPC_CHANNELS.SESSION_CREATE, projectPath),
    destroy: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.SESSION_DESTROY, sessionId),
    list: () => ipcRenderer.invoke(IPC_CHANNELS.SESSION_LIST),
    input: (sessionId, data) => ipcRenderer.send(IPC_CHANNELS.SESSION_INPUT, { sessionId, data }),
    resize: (sessionId, cols, rows) => ipcRenderer.send(IPC_CHANNELS.SESSION_RESIZE, { sessionId, cols, rows }),
    onOutput: (callback) => {
      const handler = (_event: unknown, output: TerminalOutput) => callback(output)
      ipcRenderer.on(IPC_CHANNELS.SESSION_OUTPUT, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.SESSION_OUTPUT, handler)
    },
    onStatus: (callback) => {
      const handler = (_event: unknown, status: { sessionId: string; status: string; editedFiles: EditedFile[] }) => callback(status)
      ipcRenderer.on(IPC_CHANNELS.SESSION_STATUS, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.SESSION_STATUS, handler)
    }
  },

  files: {
    readDir: (dirPath, depth) => ipcRenderer.invoke(IPC_CHANNELS.FILES_READ_DIR, dirPath, depth),
    readFile: (filePath) => ipcRenderer.invoke(IPC_CHANNELS.FILES_READ_FILE, filePath),
    writeFile: (filePath, content) => ipcRenderer.invoke(IPC_CHANNELS.FILES_WRITE_FILE, filePath, content),
    watch: (dirPath) => ipcRenderer.send(IPC_CHANNELS.FILES_WATCH, dirPath),
    unwatch: (dirPath) => ipcRenderer.send(IPC_CHANNELS.FILES_UNWATCH, dirPath),
    onChange: (callback) => {
      const handler = (_event: unknown, change: { event: string; path: string; dirPath: string }) => callback(change)
      ipcRenderer.on(IPC_CHANNELS.FILES_CHANGE, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.FILES_CHANGE, handler)
    }
  },

  config: {
    get: (key?) => ipcRenderer.invoke(IPC_CHANNELS.CONFIG_GET, key),
    set: (key, value) => ipcRenderer.invoke(IPC_CHANNELS.CONFIG_SET, key, value)
  },

  window: {
    minimize: () => ipcRenderer.send(IPC_CHANNELS.WINDOW_MINIMIZE),
    maximize: () => ipcRenderer.send(IPC_CHANNELS.WINDOW_MAXIMIZE),
    close: () => ipcRenderer.send(IPC_CHANNELS.WINDOW_CLOSE)
  },

  dialog: {
    selectFolder: () => ipcRenderer.invoke(IPC_CHANNELS.DIALOG_SELECT_FOLDER)
  },

  browser: {
    createTab: (sessionId?: string, url?: string) => ipcRenderer.invoke(IPC_CHANNELS.BROWSER_TAB_CREATE, { sessionId, url }),
    closeTab: (tabId) => ipcRenderer.invoke(IPC_CHANNELS.BROWSER_TAB_CLOSE, tabId),
    selectTab: (tabId) => ipcRenderer.invoke(IPC_CHANNELS.BROWSER_TAB_SELECT, tabId),
    listTabs: () => ipcRenderer.invoke(IPC_CHANNELS.BROWSER_TAB_LIST),
    onTabsUpdate: (callback) => {
      const handler = (_event: unknown, tabs: BrowserTab[]) => callback(tabs)
      ipcRenderer.on(IPC_CHANNELS.BROWSER_TAB_UPDATE, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.BROWSER_TAB_UPDATE, handler)
    },

    registerWebview: (tabId, webContentsId, sessionId) => ipcRenderer.send('browser:register-webview', { tabId, webContentsId, sessionId }),
    unregisterWebview: (tabId) => ipcRenderer.send('browser:unregister-webview', tabId),

    snapshot: (tabId) => ipcRenderer.invoke(IPC_CHANNELS.BROWSER_SNAPSHOT, tabId),
    click: (tabId, selector) => ipcRenderer.invoke(IPC_CHANNELS.BROWSER_CLICK, { tabId, selector }),
    type: (tabId, selector, text) => ipcRenderer.invoke(IPC_CHANNELS.BROWSER_TYPE, { tabId, selector, text }),
    evaluate: (tabId, script) => ipcRenderer.invoke(IPC_CHANNELS.BROWSER_EVALUATE, { tabId, script }),
    navigate: (tabId, url) => ipcRenderer.invoke(IPC_CHANNELS.BROWSER_NAVIGATE, { tabId, url }),
    getConsole: (tabId) => ipcRenderer.invoke(IPC_CHANNELS.BROWSER_CONSOLE, tabId),
    getNetwork: (tabId) => ipcRenderer.invoke(IPC_CHANNELS.BROWSER_NETWORK, tabId)
  },

  devServer: {
    detect: (projectPath) => ipcRenderer.invoke(IPC_CHANNELS.DEVSERVER_DETECT, projectPath),
    start: (sessionId, projectPath, script) => ipcRenderer.invoke(IPC_CHANNELS.DEVSERVER_START, { sessionId, projectPath, script }),
    stop: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.DEVSERVER_STOP, sessionId),
    status: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.DEVSERVER_STATUS, sessionId),
    onStatusChange: (callback) => {
      const handler = (_event: unknown, data: { sessionId: string; running: boolean; exitCode?: number }) => callback(data)
      ipcRenderer.on('devserver:status-change', handler)
      return () => ipcRenderer.removeListener('devserver:status-change', handler)
    },
    onLog: (callback) => {
      const handler = (_event: unknown, data: { sessionId: string; log: string }) => callback(data)
      ipcRenderer.on('devserver:log', handler)
      return () => ipcRenderer.removeListener('devserver:log', handler)
    }
  },

  clipboard: {
    readText: () => clipboard.readText(),
    writeText: (text) => clipboard.writeText(text)
  },

  shell: {
    startFileDrop: () => {
      lastDroppedFilePaths = []
    },
    getDroppedFilePaths: () => {
      const paths = [...lastDroppedFilePaths]
      lastDroppedFilePaths = []
      return paths
    }
  },

  git: {
    listWorktrees: (repoPath) => ipcRenderer.invoke('git:list-worktrees', repoPath),
    createWorktree: (options) => ipcRenderer.invoke('git:create-worktree', options),
    removeWorktree: (worktreePath, force) => ipcRenderer.invoke('git:remove-worktree', worktreePath, force),
    getStatus: (worktreePath) => ipcRenderer.invoke('git:get-status', worktreePath),
    listBranches: (repoPath) => ipcRenderer.invoke('git:list-branches', repoPath),
    getMergePreview: (worktreePath) => ipcRenderer.invoke('git:merge-preview', worktreePath),
    merge: (worktreePath, strategy) => ipcRenderer.invoke('git:merge', worktreePath, strategy),
    abortMerge: (repoPath) => ipcRenderer.invoke('git:abort-merge', repoPath),
    pull: (worktreePath) => ipcRenderer.invoke('git:pull', worktreePath),
    push: (worktreePath, setUpstream) => ipcRenderer.invoke('git:push', worktreePath, setUpstream),
    fetch: (repoPath) => ipcRenderer.invoke('git:fetch', repoPath),
    getRemoteStatus: (worktreePath) => ipcRenderer.invoke('git:get-remote-status', worktreePath),
    getStaleWorktrees: (repoPath, daysThreshold) => ipcRenderer.invoke('git:get-stale-worktrees', repoPath, daysThreshold),
    // AI conflict resolution
    mergeWithAI: (worktreePath, strategy, useAI, confidenceThreshold) => ipcRenderer.invoke('git:merge-with-ai', worktreePath, strategy, useAI, confidenceThreshold),
    isAIAvailable: () => ipcRenderer.invoke('git:is-ai-available'),
    // Lifecycle management
    initLifecycleTracking: (repoPath) => ipcRenderer.invoke('git:init-lifecycle-tracking', repoPath),
    createManagedWorktree: (repoPath, branchName, baseBranch, workflowId) => ipcRenderer.invoke('git:create-managed-worktree', repoPath, branchName, baseBranch, workflowId),
    cleanupStaleWorktrees: (repoPath, dryRun) => ipcRenderer.invoke('git:cleanup-stale-worktrees', repoPath, dryRun),
    getLifecycle: (worktreePath) => ipcRenderer.invoke('git:get-lifecycle', worktreePath),
    getAllLifecycles: () => ipcRenderer.invoke('git:get-all-lifecycles'),
    updateLifecycleStatus: (worktreePath, status) => ipcRenderer.invoke('git:update-lifecycle-status', worktreePath, status)
  },

  venv: {
    getStatus: () => ipcRenderer.invoke(IPC_CHANNELS.VENV_STATUS),
    ensure: () => ipcRenderer.invoke(IPC_CHANNELS.VENV_ENSURE),
    upgrade: () => ipcRenderer.invoke(IPC_CHANNELS.VENV_UPGRADE),
    onProgress: (callback) => {
      const handler = (_event: unknown, progress: VenvCreationProgress) => callback(progress)
      ipcRenderer.on(IPC_CHANNELS.VENV_PROGRESS, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.VENV_PROGRESS, handler)
    }
  },

  orchestrator: {
    start: (config) => ipcRenderer.invoke(IPC_CHANNELS.ORCHESTRATOR_START, config),
    stop: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.ORCHESTRATOR_STOP, sessionId),
    pause: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.ORCHESTRATOR_PAUSE, sessionId),
    getSession: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.ORCHESTRATOR_GET_SESSION, sessionId),
    getAllSessions: () => ipcRenderer.invoke(IPC_CHANNELS.ORCHESTRATOR_GET_ALL_SESSIONS),
    getWorkflowSessions: (workflowId) => ipcRenderer.invoke(IPC_CHANNELS.ORCHESTRATOR_GET_WORKFLOW_SESSIONS, workflowId),
    cleanup: () => ipcRenderer.invoke(IPC_CHANNELS.ORCHESTRATOR_CLEANUP),
    onOutput: (callback) => {
      const handler = (_event: unknown, output: OrchestratorOutput) => callback(output)
      ipcRenderer.on(IPC_CHANNELS.ORCHESTRATOR_OUTPUT, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.ORCHESTRATOR_OUTPUT, handler)
    },
    onProgress: (callback) => {
      const handler = (_event: unknown, progress: OrchestratorProgress) => callback(progress)
      ipcRenderer.on(IPC_CHANNELS.ORCHESTRATOR_PROGRESS, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.ORCHESTRATOR_PROGRESS, handler)
    },
    onSession: (callback) => {
      const handler = (_event: unknown, session: OrchestratorSession) => callback(session)
      ipcRenderer.on(IPC_CHANNELS.ORCHESTRATOR_SESSION, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.ORCHESTRATOR_SESSION, handler)
    }
  },

  workflow: {
    create: (options) => ipcRenderer.invoke(IPC_CHANNELS.WORKFLOW_CREATE, options),
    get: (projectPath, workflowId) => ipcRenderer.invoke(IPC_CHANNELS.WORKFLOW_GET, projectPath, workflowId),
    update: (projectPath, workflowId, updates) => ipcRenderer.invoke(IPC_CHANNELS.WORKFLOW_UPDATE, projectPath, workflowId, updates),
    delete: (projectPath, workflowId) => ipcRenderer.invoke(IPC_CHANNELS.WORKFLOW_DELETE, projectPath, workflowId),
    list: () => ipcRenderer.invoke(IPC_CHANNELS.WORKFLOW_LIST),
    listForProject: (projectPath) => ipcRenderer.invoke(IPC_CHANNELS.WORKFLOW_LIST_FOR_PROJECT, projectPath),
    updateStatus: (projectPath, workflowId, status, error) => ipcRenderer.invoke(IPC_CHANNELS.WORKFLOW_UPDATE_STATUS, projectPath, workflowId, status, error),
    updateProgress: (projectPath, workflowId, progress) => ipcRenderer.invoke(IPC_CHANNELS.WORKFLOW_UPDATE_PROGRESS, projectPath, workflowId, progress),
    onChange: (callback) => {
      const handler = (_event: unknown, change: { workflow: WorkflowConfig; action: 'created' | 'updated' | 'deleted' }) => callback(change)
      ipcRenderer.on(IPC_CHANNELS.WORKFLOW_CHANGE, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.WORKFLOW_CHANGE, handler)
    }
  },

  progress: {
    watch: (workflowId, projectPath) => ipcRenderer.invoke(IPC_CHANNELS.PROGRESS_WATCH, workflowId, projectPath),
    unwatch: (workflowId) => ipcRenderer.invoke(IPC_CHANNELS.PROGRESS_UNWATCH, workflowId),
    get: (workflowId) => ipcRenderer.invoke(IPC_CHANNELS.PROGRESS_GET, workflowId),
    onUpdate: (callback) => {
      const handler = (_event: unknown, snapshot: ProgressSnapshot) => callback(snapshot)
      ipcRenderer.on(IPC_CHANNELS.PROGRESS_UPDATE, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.PROGRESS_UPDATE, handler)
    }
  },

  schema: {
    validate: (projectPath, workflowId, model) => ipcRenderer.invoke(IPC_CHANNELS.SCHEMA_VALIDATE, projectPath, workflowId, model),
    getResult: (projectPath) => ipcRenderer.invoke(IPC_CHANNELS.SCHEMA_GET_RESULT, projectPath),
    clear: (projectPath) => ipcRenderer.invoke(IPC_CHANNELS.SCHEMA_CLEAR, projectPath),
    getStatus: (projectPath) => ipcRenderer.invoke(IPC_CHANNELS.SCHEMA_STATUS, projectPath),
    onStatus: (callback) => {
      const handler = (_event: unknown, status: { projectPath: string; status: string; error?: string }) => callback(status)
      ipcRenderer.on(IPC_CHANNELS.SCHEMA_STATUS, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.SCHEMA_STATUS, handler)
    }
  },

  // Discovery Chat
  discovery: {
    checkExistingSession: (projectPath: string) =>
      ipcRenderer.invoke('discovery:check-existing-session', projectPath),
    createSession: (projectPath: string, isNewProject: boolean) =>
      ipcRenderer.invoke(IPC_CHANNELS.DISCOVERY_CREATE_SESSION, projectPath, isNewProject),
    createFreshSession: (projectPath: string, isNewProject: boolean) =>
      ipcRenderer.invoke('discovery:create-fresh-session', projectPath, isNewProject),
    sendMessage: (sessionId: string, content: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.DISCOVERY_SEND_MESSAGE, sessionId, content),
    getMessages: (sessionId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.DISCOVERY_GET_MESSAGES, sessionId),
    getSession: (sessionId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.DISCOVERY_GET_SESSION, sessionId),
    cancelRequest: () =>
      ipcRenderer.invoke(IPC_CHANNELS.DISCOVERY_CANCEL_REQUEST),
    closeSession: (sessionId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.DISCOVERY_CLOSE_SESSION, sessionId),
    updateAgentStatus: (sessionId: string, agentName: string, status: string, output?: string, error?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.DISCOVERY_UPDATE_AGENT_STATUS, sessionId, agentName, status, output, error),
    // Draft management
    listDrafts: (projectPath: string) =>
      ipcRenderer.invoke('discovery:list-drafts', projectPath),
    loadDraft: (projectPath: string, draftId: string) =>
      ipcRenderer.invoke('discovery:load-draft', projectPath, draftId),
    deleteDraft: (projectPath: string, draftId: string) =>
      ipcRenderer.invoke('discovery:delete-draft', projectPath, draftId),
    // STEP 4: Quick Spec generation
    generateQuickSpec: (sessionId: string) =>
      ipcRenderer.invoke('discovery:generate-quick-spec', sessionId),
    // BMAD-Inspired: Complexity analysis and spec validation
    analyzeComplexity: (sessionId: string) =>
      ipcRenderer.invoke('discovery:analyze-complexity', sessionId),
    validateSpec: (projectPath: string, specContent?: string) =>
      ipcRenderer.invoke('discovery:validate-spec', projectPath, specContent),
    // Event listeners
    onResponseChunk: (callback: (data: { sessionId: string; messageId: string; chunk: string; timestamp: number }) => void) => {
      const handler = (_event: unknown, data: { sessionId: string; messageId: string; chunk: string; timestamp: number }) => callback(data)
      ipcRenderer.on(IPC_CHANNELS.DISCOVERY_RESPONSE_CHUNK, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.DISCOVERY_RESPONSE_CHUNK, handler)
    },
    onResponseComplete: (callback: (data: { sessionId: string; message: DiscoveryChatMessage }) => void) => {
      const handler = (_event: unknown, data: { sessionId: string; message: DiscoveryChatMessage }) => callback(data)
      ipcRenderer.on(IPC_CHANNELS.DISCOVERY_RESPONSE_COMPLETE, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.DISCOVERY_RESPONSE_COMPLETE, handler)
    },
    onAgentStatus: (callback: (data: { sessionId: string; agent: DiscoveryAgentStatus }) => void) => {
      const handler = (_event: unknown, data: { sessionId: string; agent: DiscoveryAgentStatus }) => callback(data)
      ipcRenderer.on(IPC_CHANNELS.DISCOVERY_AGENT_STATUS, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.DISCOVERY_AGENT_STATUS, handler)
    },
    onError: (callback: (data: { sessionId: string; error: string }) => void) => {
      const handler = (_event: unknown, data: { sessionId: string; error: string }) => callback(data)
      ipcRenderer.on(IPC_CHANNELS.DISCOVERY_ERROR, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.DISCOVERY_ERROR, handler)
    },
    onSpecReady: (callback: (data: { sessionId: string; spec: string }) => void) => {
      const handler = (_event: unknown, data: { sessionId: string; spec: string }) => callback(data)
      ipcRenderer.on('discovery:spec-ready', handler)
      return () => ipcRenderer.removeListener('discovery:spec-ready', handler)
    }
  },

  // Preflight checks
  preflight: {
    checkApiKey: () => ipcRenderer.invoke('preflight:check-api-key'),
    checkClaudeCli: () => ipcRenderer.invoke('preflight:check-claude-cli'),
    checkGitStatus: (projectPath: string) => ipcRenderer.invoke('preflight:check-git-status', projectPath),
    checkPython: () => ipcRenderer.invoke('preflight:check-python')
  },

  // Journey analysis (Phase 1 - codebase analysis for brownfield projects)
  journey: {
    startAnalysis: (projectPath: string) => ipcRenderer.invoke('journey:start-analysis', projectPath),
    cancelAnalysis: (projectPath: string) => ipcRenderer.invoke('journey:cancel', projectPath),
    getStatus: (projectPath: string) => ipcRenderer.invoke('journey:get-status', projectPath),
    onComplete: (callback: (data: { projectPath: string; success: boolean; analysis?: JourneyAnalysisResult; error?: string }) => void) => {
      const handler = (_event: unknown, data: { projectPath: string; success: boolean; analysis?: JourneyAnalysisResult; error?: string }) => callback(data)
      ipcRenderer.on('journey:complete', handler)
      return () => ipcRenderer.removeListener('journey:complete', handler)
    },
    onStatus: (callback: (data: { projectPath: string; status: string }) => void) => {
      const handler = (_event: unknown, data: { projectPath: string; status: string }) => callback(data)
      ipcRenderer.on('journey:status', handler)
      return () => ipcRenderer.removeListener('journey:status', handler)
    }
  },

  // Spec builder (Phase 3 - generate detailed specification)
  specBuilder: {
    buildSpec: (projectPath: string, conversationContext: string, journeyContext?: string) =>
      ipcRenderer.invoke('spec-builder:build', projectPath, conversationContext, journeyContext),
    cancel: (projectPath: string) => ipcRenderer.invoke('spec-builder:cancel', projectPath),
    getStatus: (projectPath: string) => ipcRenderer.invoke('spec-builder:get-status', projectPath),
    onComplete: (callback: (data: { projectPath: string; success: boolean; spec?: GeneratedSpecResult; error?: string }) => void) => {
      const handler = (_event: unknown, data: { projectPath: string; success: boolean; spec?: GeneratedSpecResult; error?: string }) => callback(data)
      ipcRenderer.on('spec-builder:complete', handler)
      return () => ipcRenderer.removeListener('spec-builder:complete', handler)
    },
    onStatus: (callback: (data: { projectPath: string; status: string }) => void) => {
      const handler = (_event: unknown, data: { projectPath: string; status: string }) => callback(data)
      ipcRenderer.on('spec-builder:status', handler)
      return () => ipcRenderer.removeListener('spec-builder:status', handler)
    }
  },

  // Context Agent (Phase 1 - maintain compressed context)
  context: {
    summarize: (request: ContextSummarizationRequest) =>
      ipcRenderer.invoke('context:summarize', request),
    load: (projectPath: string) =>
      ipcRenderer.invoke('context:load', projectPath),
    getInjection: (projectPath: string, featureId: string) =>
      ipcRenderer.invoke('context:get-injection', projectPath, featureId),
    cancel: (taskId: string) =>
      ipcRenderer.invoke('context:cancel', taskId),
    getTask: (taskId: string) =>
      ipcRenderer.invoke('context:get-task', taskId),
    onProgress: (callback: (data: { taskId: string; progress: ContextProgress }) => void) => {
      const handler = (_event: unknown, data: { taskId: string; progress: ContextProgress }) => callback(data)
      ipcRenderer.on('context:progress', handler)
      return () => ipcRenderer.removeListener('context:progress', handler)
    },
    onComplete: (callback: (data: { taskId: string; result: ContextSummarizationResult }) => void) => {
      const handler = (_event: unknown, data: { taskId: string; result: ContextSummarizationResult }) => callback(data)
      ipcRenderer.on('context:complete', handler)
      return () => ipcRenderer.removeListener('context:complete', handler)
    },
    onError: (callback: (data: { taskId: string; error: string }) => void) => {
      const handler = (_event: unknown, data: { taskId: string; error: string }) => callback(data)
      ipcRenderer.on('context:error', handler)
      return () => ipcRenderer.removeListener('context:error', handler)
    }
  },

  // Ideas Kanban (Email-based project ideas)
  ideas: {
    list: (stage?: IdeaStage) =>
      ipcRenderer.invoke(IPC_CHANNELS.IDEAS_LIST, stage),
    get: (ideaId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.IDEAS_GET, ideaId),
    create: (options: CreateIdeaOptions) =>
      ipcRenderer.invoke(IPC_CHANNELS.IDEAS_CREATE, options),
    update: (ideaId: string, options: UpdateIdeaOptions) =>
      ipcRenderer.invoke(IPC_CHANNELS.IDEAS_UPDATE, ideaId, options),
    delete: (ideaId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.IDEAS_DELETE, ideaId),
    moveStage: (ideaId: string, newStage: IdeaStage) =>
      ipcRenderer.invoke(IPC_CHANNELS.IDEAS_MOVE_STAGE, ideaId, newStage),
    addDiscussion: (ideaId: string, role: 'user' | 'assistant', content: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.IDEAS_ADD_DISCUSSION, ideaId, role, content),
    startProject: (ideaId: string, projectType: ProjectType, projectPath?: string, projectName?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.IDEAS_START_PROJECT, ideaId, projectType, projectPath, projectName),
    linkWorkflow: (ideaId: string, workflowId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.IDEAS_LINK_WORKFLOW, ideaId, workflowId),
    // Bulk operations
    clearAll: () =>
      ipcRenderer.invoke('ideas:clear-all'),
    reprocessAll: () =>
      ipcRenderer.invoke('ideas:reprocess-all'),
    reprocess: (ideaId: string) =>
      ipcRenderer.invoke('ideas:reprocess', ideaId),
    // AI Discussion with streaming
    // Mode: 'chat' (default), 'plan' (structured planning mode), or 'execute' (can write files)
    discuss: (ideaId: string, userMessage: string, mode: 'chat' | 'plan' | 'execute' = 'chat') =>
      ipcRenderer.invoke(IPC_CHANNELS.IDEAS_DISCUSS, ideaId, userMessage, mode),
    onDiscussStream: (callback: (data: IdeaDiscussStreamData) => void) => {
      const handler = (_event: unknown, data: IdeaDiscussStreamData) => callback(data)
      ipcRenderer.on(IPC_CHANNELS.IDEAS_DISCUSS_STREAM, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.IDEAS_DISCUSS_STREAM, handler)
    },
    // Browser login for paywalled sites (Medium, Substack, etc.)
    browserLogin: (url?: string) =>
      ipcRenderer.invoke('ideas:browser-login', url),
    hasSession: (domain: string) =>
      ipcRenderer.invoke('ideas:has-session', domain),
    clearCookies: () =>
      ipcRenderer.invoke('ideas:clear-cookies')
  },

  // Autocoder Autonomous Coding UI
  autocoder: {
    start: (projectPath: string) =>
      ipcRenderer.invoke('autocoder:start', projectPath),
    stop: () =>
      ipcRenderer.invoke('autocoder:stop'),
    show: () =>
      ipcRenderer.invoke('autocoder:show'),
    hide: () =>
      ipcRenderer.invoke('autocoder:hide'),
    status: () =>
      ipcRenderer.invoke('autocoder:status'),
    setupPython: () =>
      ipcRenderer.invoke('autocoder:setup-python'),
    updateDependencies: () =>
      ipcRenderer.invoke('autocoder:update-dependencies'),
    onLog: (callback: (data: { type: 'stdout' | 'stderr'; message: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { type: 'stdout' | 'stderr'; message: string }) => callback(data)
      ipcRenderer.on('autocoder:log', handler)
      return () => ipcRenderer.removeListener('autocoder:log', handler)
    },
    onError: (callback: (data: { message: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { message: string }) => callback(data)
      ipcRenderer.on('autocoder:error', handler)
      return () => ipcRenderer.removeListener('autocoder:error', handler)
    },
    onStopped: (callback: (data: { code: number | null; signal: string | null }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { code: number | null; signal: string | null }) => callback(data)
      ipcRenderer.on('autocoder:stopped', handler)
      return () => ipcRenderer.removeListener('autocoder:stopped', handler)
    }
  },

  // Ralph Loop Orchestrator (Execution)
  ralph: {
    start: (config: RalphOrchestratorConfig) =>
      ipcRenderer.invoke(IPC_CHANNELS.RALPH_START, config),
    stop: (sessionId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.RALPH_STOP, sessionId),
    pause: (sessionId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.RALPH_PAUSE, sessionId),
    resume: (sessionId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.RALPH_RESUME, sessionId),
    getStatus: (sessionId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.RALPH_STATUS, sessionId),
    getAllSessions: () =>
      ipcRenderer.invoke('ralph:get-all-sessions'),
    getProjectSessions: (projectPath: string) =>
      ipcRenderer.invoke('ralph:get-project-sessions', projectPath),
    cleanup: () =>
      ipcRenderer.invoke('ralph:cleanup'),
    // Checkpoint responses
    approveCheckpoint: (sessionId: string, checkpointId: string, comment?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.CHECKPOINT_APPROVE, sessionId, checkpointId, comment),
    skipCheckpoint: (sessionId: string, checkpointId: string, comment?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.CHECKPOINT_SKIP, sessionId, checkpointId, comment),
    rejectCheckpoint: (sessionId: string, checkpointId: string, comment?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.CHECKPOINT_REJECT, sessionId, checkpointId, comment),
    // Event listeners
    onProgress: (callback: (data: RalphProgressData) => void) => {
      const handler = (_event: unknown, data: RalphProgressData) => callback(data)
      ipcRenderer.on(IPC_CHANNELS.RALPH_PROGRESS, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.RALPH_PROGRESS, handler)
    },
    onCheckpoint: (callback: (data: RalphCheckpointData) => void) => {
      const handler = (_event: unknown, data: RalphCheckpointData) => callback(data)
      ipcRenderer.on(IPC_CHANNELS.RALPH_CHECKPOINT, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.RALPH_CHECKPOINT, handler)
    },
    onStatus: (callback: (data: RalphStatusData) => void) => {
      const handler = (_event: unknown, data: RalphStatusData) => callback(data)
      ipcRenderer.on(IPC_CHANNELS.RALPH_STATUS, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.RALPH_STATUS, handler)
    },
    onStreamChunk: (callback: (data: RalphStreamChunkData) => void) => {
      const handler = (_event: unknown, data: RalphStreamChunkData) => callback(data)
      ipcRenderer.on(IPC_CHANNELS.RALPH_STREAM_CHUNK, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.RALPH_STREAM_CHUNK, handler)
    },
    onError: (callback: (data: RalphErrorData) => void) => {
      const handler = (_event: unknown, data: RalphErrorData) => callback(data)
      ipcRenderer.on(IPC_CHANNELS.RALPH_ERROR, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.RALPH_ERROR, handler)
    },
    // Session History
    listSessions: (projectPath?: string) =>
      ipcRenderer.invoke('ralph:list-sessions', projectPath),
    saveSession: (session: RalphSessionSummary) =>
      ipcRenderer.invoke('ralph:save-session', session),
    getSessionHistory: (sessionId: string) =>
      ipcRenderer.invoke('ralph:get-session-history', sessionId),
    deleteSession: (sessionId: string) =>
      ipcRenderer.invoke('ralph:delete-session', sessionId)
  },

  // Ralph Loop Initiator (Requirements Gathering)
  initiator: {
    start: (projectPath: string, options?: { forceNew?: boolean }) =>
      ipcRenderer.invoke(IPC_CHANNELS.INITIATOR_START, projectPath, options),
    getSession: (sessionId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.INITIATOR_GET_SESSION, sessionId),
    sendMessage: (sessionId: string, content: string, attachmentPaths?: string[]) =>
      ipcRenderer.invoke(IPC_CHANNELS.INITIATOR_SEND_MESSAGE, sessionId, content, attachmentPaths),
    summarize: (sessionId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.INITIATOR_SUMMARIZE, sessionId),
    generatePrompt: (sessionId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.INITIATOR_GENERATE_PROMPT, sessionId),
    updatePrompt: (sessionId: string, updates: Partial<InitiatorRalphPromptConfig>) =>
      ipcRenderer.invoke(IPC_CHANNELS.INITIATOR_UPDATE_PROMPT, sessionId, updates),
    approvePrompt: (sessionId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.INITIATOR_APPROVE_PROMPT, sessionId),
    cancel: (sessionId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.INITIATOR_CANCEL, sessionId),
    // Event listeners
    onResponseChunk: (callback: (data: InitiatorChunkData) => void) => {
      const handler = (_event: unknown, data: InitiatorChunkData) => callback(data)
      ipcRenderer.on(IPC_CHANNELS.INITIATOR_RESPONSE_CHUNK, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.INITIATOR_RESPONSE_CHUNK, handler)
    },
    onResponseComplete: (callback: (data: InitiatorCompleteData) => void) => {
      const handler = (_event: unknown, data: InitiatorCompleteData) => callback(data)
      ipcRenderer.on(IPC_CHANNELS.INITIATOR_RESPONSE_COMPLETE, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.INITIATOR_RESPONSE_COMPLETE, handler)
    },
    onRequirementsReady: (callback: (data: InitiatorRequirementsData) => void) => {
      const handler = (_event: unknown, data: InitiatorRequirementsData) => callback(data)
      ipcRenderer.on(IPC_CHANNELS.INITIATOR_REQUIREMENTS_READY, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.INITIATOR_REQUIREMENTS_READY, handler)
    },
    onPromptReady: (callback: (data: InitiatorPromptData) => void) => {
      const handler = (_event: unknown, data: InitiatorPromptData) => callback(data)
      ipcRenderer.on(IPC_CHANNELS.INITIATOR_PROMPT_READY, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.INITIATOR_PROMPT_READY, handler)
    },
    onError: (callback: (data: InitiatorErrorData) => void) => {
      const handler = (_event: unknown, data: InitiatorErrorData) => callback(data)
      ipcRenderer.on(IPC_CHANNELS.INITIATOR_ERROR, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.INITIATOR_ERROR, handler)
    }
  },

  // Outlook Email Integration
  outlook: {
    configure: (config: Partial<OutlookConfig>) =>
      ipcRenderer.invoke(IPC_CHANNELS.OUTLOOK_CONFIGURE, config),
    getConfig: () =>
      ipcRenderer.invoke(IPC_CHANNELS.OUTLOOK_GET_CONFIG),
    authenticate: () =>
      ipcRenderer.invoke(IPC_CHANNELS.OUTLOOK_AUTHENTICATE),
    fetchEmails: (options?: { maxResults?: number; sinceDate?: string; onlySinceLastSync?: boolean }) =>
      ipcRenderer.invoke(IPC_CHANNELS.OUTLOOK_FETCH_EMAILS, options),
    sync: () =>
      ipcRenderer.invoke(IPC_CHANNELS.OUTLOOK_SYNC),
    syncStream: (options?: { fullRefresh?: boolean }) =>
      ipcRenderer.invoke(IPC_CHANNELS.OUTLOOK_SYNC_STREAM, options),
    onSyncProgress: (callback: (data: SyncProgressData) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: SyncProgressData) => callback(data)
      ipcRenderer.on(IPC_CHANNELS.OUTLOOK_SYNC_PROGRESS, handler)
      // Return cleanup function
      return () => ipcRenderer.removeListener(IPC_CHANNELS.OUTLOOK_SYNC_PROGRESS, handler)
    },
    getStatus: () =>
      ipcRenderer.invoke(IPC_CHANNELS.OUTLOOK_STATUS),
    // Reset sync timestamp when it gets out of sync
    resetSync: () =>
      ipcRenderer.invoke('outlook:reset-sync')
  },

  // API Server (for remote access / thin client mode)
  apiServer: {
    start: (config: ApiServerConfig) =>
      ipcRenderer.invoke('api-server:start', config),
    stop: () =>
      ipcRenderer.invoke('api-server:stop'),
    status: () =>
      ipcRenderer.invoke('api-server:status')
  },

  // BVS (Bounded Verified Sections) Planning V2
  bvsPlanning: {
    // Session management
    startSession: (projectPath: string) =>
      ipcRenderer.invoke('bvs:start-planning', projectPath),
    getSession: (sessionId: string) =>
      ipcRenderer.invoke('bvs:get-planning-session', sessionId),
    clearSession: (projectPath: string) =>
      ipcRenderer.invoke('bvs:clear-planning-session', projectPath),

    // Message handling
    sendMessage: (sessionId: string, message: string) =>
      ipcRenderer.invoke('bvs:send-planning-message', sessionId, message),

    // Discovery actions (question/option button clicks)
    answerQuestions: (sessionId: string, answers: Record<string, string>) =>
      ipcRenderer.invoke('bvs:answer-questions', sessionId, answers),
    selectOption: (sessionId: string, optionId: string) =>
      ipcRenderer.invoke('bvs:select-option', sessionId, optionId),
    approvePlan: (sessionId: string) =>
      ipcRenderer.invoke('bvs:planning-approve', sessionId),
    requestChanges: (sessionId: string, feedback: string) =>
      ipcRenderer.invoke('bvs:request-changes', sessionId, feedback),

    // Project management
    listProjects: (projectPath: string) =>
      ipcRenderer.invoke('bvs:list-projects', projectPath),
    getProject: (projectPath: string, projectId: string) =>
      ipcRenderer.invoke('bvs:get-project', projectPath, projectId),
    updateProject: (projectPath: string, projectId: string, updates: { status?: string; selectedSections?: string[] }) =>
      ipcRenderer.invoke('bvs:update-project', projectPath, projectId, updates),
    deleteProject: (projectPath: string, projectId: string, archive?: boolean) =>
      ipcRenderer.invoke('bvs:delete-project', projectPath, projectId, archive),
    resumeProject: (projectPath: string, projectId: string) =>
      ipcRenderer.invoke('bvs:resume-project', projectPath, projectId),
    loadPlan: (projectPath: string, projectId?: string) =>
      ipcRenderer.invoke('bvs:load-plan', projectPath, projectId),

    // Plan revision
    analyzePlan: (projectPath: string, projectId: string) =>
      ipcRenderer.invoke('bvs:analyze-plan', projectPath, projectId),
    revisePlan: (request: {
      projectPath: string
      projectId: string
      message: string
      issues: any[]
      conversationHistory: Array<{ role: string; content: string }>
    }) => ipcRenderer.invoke('bvs:revise-plan', request),
    applyPlanChanges: (projectPath: string, projectId: string, changes: any[]) =>
      ipcRenderer.invoke('bvs:apply-plan-changes', projectPath, projectId, changes),

    // Execution management
    startExecution: (projectPath: string, projectId: string) =>
      ipcRenderer.invoke('bvs:start-execution-from-project', projectPath, projectId),
    pauseExecution: (sessionId: string) =>
      ipcRenderer.invoke('bvs:pause-execution', sessionId),
    resumeExecution: (sessionId: string) =>
      ipcRenderer.invoke('bvs:resume-execution', sessionId),
    getExecutionSession: (sessionId: string) =>
      ipcRenderer.invoke('bvs:get-session', sessionId),
    listExecutionSessions: () =>
      ipcRenderer.invoke('bvs:list-sessions'),

    // Parallel execution with merge points
    startParallelExecution: (sessionId: string) =>
      ipcRenderer.invoke('bvs:start-parallel-execution', sessionId),
    startParallelExecutionFromProject: (projectPath: string, projectId: string) =>
      ipcRenderer.invoke('bvs:start-parallel-execution-from-project', projectPath, projectId),
    analyzeComplexity: (projectPath: string, projectId: string) =>
      ipcRenderer.invoke('bvs:analyze-complexity', projectPath, projectId),

    // Ralph Loop - Cost tracking and subtask progress (RALPH-004, RALPH-006)
    getSessionCost: (sessionId: string) =>
      ipcRenderer.invoke('bvs:get-session-cost', sessionId),
    getSubtaskProgress: (sessionId: string, sectionId: string) =>
      ipcRenderer.invoke('bvs:get-subtask-progress', sessionId, sectionId),
    approveContinue: (sessionId: string) =>
      ipcRenderer.invoke('bvs:approve-continue', sessionId),

    // Streaming event listeners
    onToolStart: (callback: (data: BvsToolStartData) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: BvsToolStartData) => callback(data)
      ipcRenderer.on('bvs-planning:tool-start', handler)
      return () => ipcRenderer.removeListener('bvs-planning:tool-start', handler)
    },
    onToolResult: (callback: (data: BvsToolResultData) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: BvsToolResultData) => callback(data)
      ipcRenderer.on('bvs-planning:tool-result', handler)
      return () => ipcRenderer.removeListener('bvs-planning:tool-result', handler)
    },
    onResponseChunk: (callback: (data: BvsResponseChunkData) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: BvsResponseChunkData) => callback(data)
      ipcRenderer.on('bvs-planning:response-chunk', handler)
      return () => ipcRenderer.removeListener('bvs-planning:response-chunk', handler)
    },
    onResponseComplete: (callback: (data: BvsResponseCompleteData) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: BvsResponseCompleteData) => callback(data)
      ipcRenderer.on('bvs-planning:response-complete', handler)
      return () => ipcRenderer.removeListener('bvs-planning:response-complete', handler)
    },
    onQuestionsReady: (callback: (data: BvsQuestionsReadyData) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: BvsQuestionsReadyData) => callback(data)
      ipcRenderer.on('bvs-planning:questions-ready', handler)
      return () => ipcRenderer.removeListener('bvs-planning:questions-ready', handler)
    },
    onOptionsReady: (callback: (data: BvsOptionsReadyData) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: BvsOptionsReadyData) => callback(data)
      ipcRenderer.on('bvs-planning:options-ready', handler)
      return () => ipcRenderer.removeListener('bvs-planning:options-ready', handler)
    },
    onSectionsReady: (callback: (data: BvsSectionsReadyData) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: BvsSectionsReadyData) => callback(data)
      ipcRenderer.on('bvs-planning:sections-ready', handler)
      return () => ipcRenderer.removeListener('bvs-planning:sections-ready', handler)
    },
    onPlanWritten: (callback: (data: BvsPlanWrittenData) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: BvsPlanWrittenData) => callback(data)
      ipcRenderer.on('bvs-planning:plan-written', handler)
      return () => ipcRenderer.removeListener('bvs-planning:plan-written', handler)
    },
    onError: (callback: (data: BvsErrorData) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: BvsErrorData) => callback(data)
      ipcRenderer.on('bvs-planning:error', handler)
      return () => ipcRenderer.removeListener('bvs-planning:error', handler)
    }
  }
}

// Expose in the renderer process
contextBridge.exposeInMainWorld('electron', electronAPI)

// Type augmentation for window.electron
declare global {
  interface Window {
    electron: ElectronAPI
  }
}

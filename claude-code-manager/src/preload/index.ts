import { contextBridge, ipcRenderer, clipboard, webUtils } from 'electron'
import { IPC_CHANNELS } from '../shared/types'
import type { Session, FileNode, AppConfig, TerminalOutput, BrowserTab, BrowserSnapshot, ConsoleMessage, NetworkRequest, DevServerInfo, EditedFile, OrchestratorConfig, OrchestratorSession, OrchestratorOutput, OrchestratorProgress, WorkflowConfig, WorkflowStatus, WorkflowProgress, ProgressSnapshot } from '../shared/types'
import type { Worktree, WorktreeStatus, Branch, MergePreview, MergeResult, RemoteStatus, CreateWorktreeOptions, MergeStrategy } from '../shared/types/git'

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
    getStaleWorktrees: (repoPath, daysThreshold) => ipcRenderer.invoke('git:get-stale-worktrees', repoPath, daysThreshold)
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

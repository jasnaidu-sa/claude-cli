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

// Config types
export interface AppConfig {
  claudeCliPath: string
  defaultProjectsDir: string
  theme: 'dark' | 'light' | 'system'
  fontSize: number
  recentProjects: string[]
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
  VENV_PROGRESS: 'venv:progress'
} as const

export type IpcChannel = typeof IPC_CHANNELS[keyof typeof IPC_CHANNELS]

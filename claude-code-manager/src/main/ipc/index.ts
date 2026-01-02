import { ipcMain, dialog, BrowserWindow } from 'electron'
import { readFile, writeFile } from 'fs/promises'
import { IPC_CHANNELS } from '@shared/types'
import { sessionManager, configStore, getMainWindow, discoveryChatService, researchAgentRunner } from '../index'
import { fileWatcher } from '../services/file-watcher'
import { registerGitHandlers } from './git-handlers'
import { registerVenvHandlers } from './venv-handlers'
import { registerOrchestratorHandlers } from './orchestrator-handlers'
import { registerWorkflowHandlers } from './workflow-handlers'
import { registerProgressHandlers } from './progress-handlers'
import { registerSchemaHandlers } from './schema-handlers'
import { setupDiscoveryHandlers } from './discovery-handlers'
import { registerPreflightHandlers } from './preflight-handlers'
import { setupJourneyHandlers } from './journey-handlers'
import { setupSpecBuilderHandlers } from './spec-builder-handlers'
import { registerIdeasHandlers } from './ideas-handlers'

export function registerIpcHandlers(): void {
  // Session handlers
  registerSessionHandlers()

  // File system handlers
  registerFileHandlers()

  // Config handlers
  registerConfigHandlers()

  // Window handlers
  registerWindowHandlers()

  // Dialog handlers
  registerDialogHandlers()

  // Git worktree handlers
  registerGitHandlers()

  // Python venv handlers
  registerVenvHandlers()

  // Python orchestrator handlers
  registerOrchestratorHandlers()

  // Workflow management handlers
  registerWorkflowHandlers()

  // Progress watcher handlers
  registerProgressHandlers()

  // Schema validator handlers
  registerSchemaHandlers()

  // Discovery chat handlers
  setupDiscoveryHandlers(discoveryChatService)

  // Preflight check handlers
  registerPreflightHandlers()

  // Journey analysis handlers
  setupJourneyHandlers(researchAgentRunner)

  // Spec builder handlers
  setupSpecBuilderHandlers(researchAgentRunner)

  // Ideas Kanban handlers (email integration + ideas management)
  registerIdeasHandlers()
}

function registerSessionHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.SESSION_CREATE, async (_event, projectPath: string) => {
    try {
      console.log('[SessionHandler] Creating session for path:', projectPath)
      const session = sessionManager.create(projectPath)
      console.log('[SessionHandler] Session created:', session)
      configStore.addRecentProject(projectPath)
      return { success: true, session }
    } catch (error) {
      console.error('[SessionHandler] Error creating session:', error)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle(IPC_CHANNELS.SESSION_DESTROY, async (_event, sessionId: string) => {
    const success = sessionManager.destroy(sessionId)
    return { success }
  })

  ipcMain.handle(IPC_CHANNELS.SESSION_LIST, async () => {
    return sessionManager.getAllSessions()
  })

  ipcMain.on(IPC_CHANNELS.SESSION_INPUT, (_event, { sessionId, data }) => {
    sessionManager.write(sessionId, data)
  })

  ipcMain.on(IPC_CHANNELS.SESSION_RESIZE, (_event, { sessionId, cols, rows }) => {
    sessionManager.resize(sessionId, cols, rows)
  })
}

function registerFileHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.FILES_READ_DIR, async (_event, dirPath: string, depth?: number) => {
    try {
      const files = await fileWatcher.readDirectory(dirPath, depth)
      return { success: true, files }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle(IPC_CHANNELS.FILES_READ_FILE, async (_event, filePath: string) => {
    try {
      const content = await readFile(filePath, 'utf-8')
      return { success: true, content }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle(IPC_CHANNELS.FILES_WRITE_FILE, async (_event, filePath: string, content: string) => {
    try {
      await writeFile(filePath, content, 'utf-8')
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  ipcMain.on(IPC_CHANNELS.FILES_WATCH, (_event, dirPath: string) => {
    const mainWindow = getMainWindow()
    if (!mainWindow) return

    fileWatcher.watch(dirPath, (event, path) => {
      mainWindow.webContents.send(IPC_CHANNELS.FILES_CHANGE, { event, path, dirPath })
    })
  })

  ipcMain.on(IPC_CHANNELS.FILES_UNWATCH, (_event, dirPath: string) => {
    fileWatcher.unwatch(dirPath)
  })
}

function registerConfigHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.CONFIG_GET, async (_event, key?: string) => {
    if (key) {
      return configStore.get(key as any)
    }
    return configStore.getAll()
  })

  ipcMain.handle(IPC_CHANNELS.CONFIG_SET, async (_event, key: string, value: any) => {
    configStore.set(key as any, value)
    return { success: true }
  })
}

function registerWindowHandlers(): void {
  ipcMain.on(IPC_CHANNELS.WINDOW_MINIMIZE, () => {
    const win = BrowserWindow.getFocusedWindow()
    win?.minimize()
  })

  ipcMain.on(IPC_CHANNELS.WINDOW_MAXIMIZE, () => {
    const win = BrowserWindow.getFocusedWindow()
    if (win?.isMaximized()) {
      win.unmaximize()
    } else {
      win?.maximize()
    }
  })

  ipcMain.on(IPC_CHANNELS.WINDOW_CLOSE, () => {
    const win = BrowserWindow.getFocusedWindow()
    win?.close()
  })
}

function registerDialogHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.DIALOG_SELECT_FOLDER, async () => {
    const mainWindow = getMainWindow()
    if (!mainWindow) return { success: false }

    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Select Project Folder'
    })

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, canceled: true }
    }

    return { success: true, path: result.filePaths[0] }
  })
}

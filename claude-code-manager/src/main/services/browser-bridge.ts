import { BrowserWindow, ipcMain, webContents } from 'electron'
import type { WebContents } from 'electron'
import type { BrowserTab, BrowserSnapshot, ConsoleMessage, NetworkRequest } from '@shared/types'
import { IPC_CHANNELS } from '@shared/types'
import { getMainWindow } from '../index'

interface WebviewConnection {
  tabId: string
  sessionId: string | null
  webContentsId: number
  consoleMessages: ConsoleMessage[]
  networkRequests: NetworkRequest[]
}

export class BrowserBridge {
  private connections: Map<string, WebviewConnection> = new Map()
  private tabs: Map<string, BrowserTab> = new Map()

  constructor() {
    this.registerHandlers()
  }

  private registerHandlers(): void {
    // Tab management
    ipcMain.handle(IPC_CHANNELS.BROWSER_TAB_CREATE, async (_event, { sessionId, url }: { sessionId?: string; url?: string }) => {
      return this.createTab(sessionId || null, url || 'https://localhost:3000')
    })

    ipcMain.handle(IPC_CHANNELS.BROWSER_TAB_CLOSE, async (_event, tabId: string) => {
      return this.closeTab(tabId)
    })

    ipcMain.handle(IPC_CHANNELS.BROWSER_TAB_LIST, async () => {
      return Array.from(this.tabs.values())
    })

    ipcMain.handle(IPC_CHANNELS.BROWSER_TAB_SELECT, async (_event, tabId: string) => {
      return this.selectTab(tabId)
    })

    // Register webview from renderer
    ipcMain.on('browser:register-webview', (_event, { tabId, webContentsId, sessionId }) => {
      this.registerWebview(tabId, webContentsId, sessionId)
    })

    ipcMain.on('browser:unregister-webview', (_event, tabId: string) => {
      this.unregisterWebview(tabId)
    })

    // Browser control commands (for Claude)
    ipcMain.handle(IPC_CHANNELS.BROWSER_SNAPSHOT, async (_event, tabId: string) => {
      return this.getSnapshot(tabId)
    })

    ipcMain.handle(IPC_CHANNELS.BROWSER_CLICK, async (_event, { tabId, selector }: { tabId: string; selector: string }) => {
      return this.click(tabId, selector)
    })

    ipcMain.handle(IPC_CHANNELS.BROWSER_TYPE, async (_event, { tabId, selector, text }: { tabId: string; selector: string; text: string }) => {
      return this.type(tabId, selector, text)
    })

    ipcMain.handle(IPC_CHANNELS.BROWSER_EVALUATE, async (_event, { tabId, script }: { tabId: string; script: string }) => {
      return this.evaluate(tabId, script)
    })

    ipcMain.handle(IPC_CHANNELS.BROWSER_CONSOLE, async (_event, tabId: string) => {
      return this.getConsoleMessages(tabId)
    })

    ipcMain.handle(IPC_CHANNELS.BROWSER_NETWORK, async (_event, tabId: string) => {
      return this.getNetworkRequests(tabId)
    })

    ipcMain.handle(IPC_CHANNELS.BROWSER_NAVIGATE, async (_event, { tabId, url }: { tabId: string; url: string }) => {
      return this.navigate(tabId, url)
    })
  }

  createTab(sessionId: string | null, url: string): BrowserTab {
    const tabId = `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    const tab: BrowserTab = {
      id: tabId,
      sessionId,
      url,
      title: 'New Tab',
      isActive: false
    }
    this.tabs.set(tabId, tab)
    this.notifyTabsChanged()
    return tab
  }

  closeTab(tabId: string): boolean {
    const deleted = this.tabs.delete(tabId)
    this.connections.delete(tabId)
    if (deleted) this.notifyTabsChanged()
    return deleted
  }

  selectTab(tabId: string): boolean {
    const tab = this.tabs.get(tabId)
    if (!tab) return false

    // Deactivate all, activate selected
    this.tabs.forEach((t) => {
      t.isActive = t.id === tabId
    })
    this.notifyTabsChanged()
    return true
  }

  updateTab(tabId: string, updates: Partial<BrowserTab>): void {
    const tab = this.tabs.get(tabId)
    if (tab) {
      Object.assign(tab, updates)
      this.notifyTabsChanged()
    }
  }

  registerWebview(tabId: string, webContentsId: number, sessionId: string | null): void {
    const connection: WebviewConnection = {
      tabId,
      sessionId,
      webContentsId,
      consoleMessages: [],
      networkRequests: []
    }
    this.connections.set(tabId, connection)

    // Set up listeners for console and network
    const wc = webContents.fromId(webContentsId)
    if (wc) {
      this.setupWebContentsListeners(tabId, wc)
    }
  }

  unregisterWebview(tabId: string): void {
    this.connections.delete(tabId)
  }

  private setupWebContentsListeners(tabId: string, webContents: WebContents): void {
    const connection = this.connections.get(tabId)
    if (!connection) return

    // Listen for console messages
    webContents.on('console-message', (_event, level, message) => {
      const levelMap: Record<number, ConsoleMessage['type']> = {
        0: 'debug',
        1: 'log',
        2: 'warn',
        3: 'error'
      }
      connection.consoleMessages.push({
        type: levelMap[level] || 'log',
        text: message,
        timestamp: Date.now()
      })
      // Keep last 100 messages
      if (connection.consoleMessages.length > 100) {
        connection.consoleMessages = connection.consoleMessages.slice(-100)
      }
    })

    // NOTE: We intentionally do NOT update tab URL on did-navigate events
    // because there's only one webview shared across all tabs.
    // When switching tabs, navigation events from the previous tab's content
    // would incorrectly update the new tab's URL.
    // Each tab keeps its original/intended URL.

    webContents.on('page-title-updated', (_event, title) => {
      this.updateTab(tabId, { title })
    })
  }

  private getWebContents(tabId: string): WebContents | null {
    const connection = this.connections.get(tabId)
    if (!connection) return null
    return webContents.fromId(connection.webContentsId) || null
  }

  async getSnapshot(tabId: string): Promise<BrowserSnapshot | null> {
    const webContents = this.getWebContents(tabId)
    const connection = this.connections.get(tabId)
    if (!webContents || !connection) return null

    try {
      const [url, title, html] = await Promise.all([
        webContents.getURL(),
        webContents.getTitle(),
        webContents.executeJavaScript('document.documentElement.outerHTML')
      ])

      return {
        url,
        title,
        html,
        consoleMessages: connection.consoleMessages,
        networkRequests: connection.networkRequests
      }
    } catch (error) {
      console.error('Failed to get snapshot:', error)
      return null
    }
  }

  async click(tabId: string, selector: string): Promise<{ success: boolean; error?: string }> {
    const webContents = this.getWebContents(tabId)
    if (!webContents) return { success: false, error: 'Tab not found' }

    try {
      await webContents.executeJavaScript(`
        (function() {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (el) {
            el.click();
            return true;
          }
          throw new Error('Element not found: ${selector}');
        })()
      `)
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  async type(tabId: string, selector: string, text: string): Promise<{ success: boolean; error?: string }> {
    const webContents = this.getWebContents(tabId)
    if (!webContents) return { success: false, error: 'Tab not found' }

    try {
      await webContents.executeJavaScript(`
        (function() {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (el) {
            el.focus();
            el.value = ${JSON.stringify(text)};
            el.dispatchEvent(new Event('input', { bubbles: true }));
            return true;
          }
          throw new Error('Element not found: ${selector}');
        })()
      `)
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  async evaluate(tabId: string, script: string): Promise<{ success: boolean; result?: any; error?: string }> {
    const webContents = this.getWebContents(tabId)
    if (!webContents) return { success: false, error: 'Tab not found' }

    try {
      const result = await webContents.executeJavaScript(script)
      return { success: true, result }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  async navigate(tabId: string, url: string): Promise<{ success: boolean; error?: string }> {
    // Always update the tab URL - this persists for when webview loads
    const tab = this.tabs.get(tabId)
    if (!tab) {
      return { success: false, error: 'Tab not found' }
    }

    // Only update tab URL, don't try to navigate webContents from main process
    // The renderer's webview will handle actual navigation via src attribute
    this.updateTab(tabId, { url })

    return { success: true }
  }

  getConsoleMessages(tabId: string): ConsoleMessage[] {
    return this.connections.get(tabId)?.consoleMessages || []
  }

  getNetworkRequests(tabId: string): NetworkRequest[] {
    return this.connections.get(tabId)?.networkRequests || []
  }

  // Get tab for a specific session
  getTabForSession(sessionId: string): BrowserTab | undefined {
    return Array.from(this.tabs.values()).find(t => t.sessionId === sessionId)
  }

  // Get or create tab for session
  getOrCreateTabForSession(sessionId: string, projectName: string, devServerUrl?: string): BrowserTab {
    let tab = this.getTabForSession(sessionId)
    if (!tab) {
      tab = this.createTab(sessionId, devServerUrl || 'https://localhost:3000')
      tab.title = projectName
    }
    return tab
  }

  private notifyTabsChanged(): void {
    const mainWindow = getMainWindow()
    if (mainWindow) {
      mainWindow.webContents.send(IPC_CHANNELS.BROWSER_TAB_UPDATE, Array.from(this.tabs.values()))
    }
  }
}

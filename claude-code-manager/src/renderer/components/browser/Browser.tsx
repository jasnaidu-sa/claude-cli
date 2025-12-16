import React, { useRef, useState, useEffect, useCallback } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  RotateCw,
  Home,
  ExternalLink,
  X,
  Plus,
  Globe,
  PanelLeftClose,
  Play,
  Square,
  Terminal,
  Loader2
} from 'lucide-react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { useUIStore } from '@renderer/stores/ui-store'
import { useSessionStore } from '@renderer/stores/session-store'
import { cn } from '@renderer/lib/utils'
import type { BrowserTab, DevServerInfo } from '@shared/types'

interface BrowserProps {
  onClose?: () => void
}

// Debounce helper
function useDebouncedCallback<T extends (...args: any[]) => void>(
  callback: T,
  delay: number
): T {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)
  const callbackRef = useRef(callback)
  callbackRef.current = callback

  return useCallback((...args: Parameters<T>) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }
    timeoutRef.current = setTimeout(() => {
      callbackRef.current(...args)
    }, delay)
  }, [delay]) as T
}

export function Browser({ onClose }: BrowserProps) {
  const { browserUrl } = useUIStore()
  const { sessions } = useSessionStore()

  // Local state for tabs - synced with main process
  const [tabs, setTabs] = useState<BrowserTab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [inputUrl, setInputUrl] = useState(browserUrl)
  const [isLoading, setIsLoading] = useState(false)
  const [devServerStatus, setDevServerStatus] = useState<Map<string, DevServerInfo>>(new Map())

  // Track current webview URL to prevent duplicate navigations
  const currentUrlRef = useRef<string>('')
  const navigationInProgressRef = useRef(false)
  const webviewReadyRef = useRef(false)

  // Use a key to force webview recreation when needed
  const [webviewKey, setWebviewKey] = useState(0)
  const webviewRef = useRef<Electron.WebviewTag>(null)

  const activeTab = tabs.find((t) => t.id === activeTabId)

  // Debounced navigation to prevent rapid-fire URL changes
  const debouncedNavigate = useDebouncedCallback((url: string) => {
    const webview = webviewRef.current
    if (!webview || !url || url === 'about:blank') return

    // Skip if already at this URL
    if (currentUrlRef.current === url && !navigationInProgressRef.current) {
      console.log(`[Browser] Skipping navigation, already at: ${url}`)
      return
    }

    console.log(`[Browser] Debounced navigation to: ${url}`)
    currentUrlRef.current = url
    navigationInProgressRef.current = true

    // Use loadURL for better control (returns promise)
    try {
      webview.loadURL(url).catch((err: Error) => {
        // ERR_ABORTED is expected when navigation is interrupted - ignore it
        if (!err.message.includes('ERR_ABORTED')) {
          console.error(`[Browser] Navigation error:`, err.message)
        }
      }).finally(() => {
        navigationInProgressRef.current = false
      })
    } catch (e) {
      // Fallback to src if loadURL not available
      webview.src = url
      navigationInProgressRef.current = false
    }
  }, 50) // 50ms debounce - prevents rapid-fire errors while staying responsive

  // Load existing tabs on mount
  useEffect(() => {
    let hasInitialized = false

    const loadTabs = async () => {
      const mainTabs = await window.electron.browser.listTabs()
      setTabs(mainTabs)

      if (mainTabs.length > 0 && !activeTabId) {
        setActiveTabId(mainTabs[0].id)
        setInputUrl(mainTabs[0].url)
        hasInitialized = true
      }

      // Load dev server status for each session tab
      for (const tab of mainTabs) {
        if (tab.sessionId) {
          const status = await window.electron.devServer.status(tab.sessionId)
          if (status) {
            setDevServerStatus(prev => new Map(prev).set(tab.sessionId!, status))
          }
        }
      }
    }
    loadTabs()

    // Listen for tab updates
    const unsubscribe = window.electron.browser.onTabsUpdate((updatedTabs) => {
      setTabs(updatedTabs)

      if (updatedTabs.length > 0 && !hasInitialized) {
        console.log(`[Browser] Initial tab setup - selecting first tab`)
        setActiveTabId(updatedTabs[0].id)
        setInputUrl(updatedTabs[0].url)
        hasInitialized = true
      }
    })

    return unsubscribe
  }, [])

  // Listen for dev server status changes
  useEffect(() => {
    const unsubscribe = window.electron.devServer.onStatusChange(({ sessionId, running }) => {
      setDevServerStatus(prev => {
        const newMap = new Map(prev)
        const existing = newMap.get(sessionId)
        if (existing) {
          newMap.set(sessionId, { ...existing, running })
        }
        return newMap
      })
    })

    return unsubscribe
  }, [])

  // Set up webview event listeners
  useEffect(() => {
    const webview = webviewRef.current
    if (!webview) return

    const handleDomReady = () => {
      console.log('[Browser] Webview dom-ready')
      webviewReadyRef.current = true
      navigationInProgressRef.current = false

      // Register with main process
      if (activeTab) {
        const webContentsId = (webview as any).getWebContentsId?.()
        if (webContentsId) {
          window.electron.browser.registerWebview(activeTab.id, webContentsId, activeTab.sessionId)
        }
      }
    }

    const handleNavigate = (e: Event) => {
      const event = e as any
      if (event.url && event.url !== 'about:blank') {
        setInputUrl(event.url)
        currentUrlRef.current = event.url
      }
    }

    const handleStartLoading = () => {
      setIsLoading(true)
      navigationInProgressRef.current = true
    }

    const handleStopLoading = () => {
      setIsLoading(false)
      navigationInProgressRef.current = false
    }

    const handleFailLoad = (e: Event) => {
      const event = e as any
      // ERR_ABORTED (-3) is expected when navigation is interrupted
      if (event.errorCode !== -3) {
        console.error(`[Browser] Load failed: ${event.errorDescription} (${event.errorCode})`)
      }
      navigationInProgressRef.current = false
    }

    webview.addEventListener('dom-ready', handleDomReady)
    webview.addEventListener('did-navigate', handleNavigate)
    webview.addEventListener('did-navigate-in-page', handleNavigate)
    webview.addEventListener('did-start-loading', handleStartLoading)
    webview.addEventListener('did-stop-loading', handleStopLoading)
    webview.addEventListener('did-fail-load', handleFailLoad)

    return () => {
      if (activeTab) {
        window.electron.browser.unregisterWebview(activeTab.id)
      }
      webview.removeEventListener('dom-ready', handleDomReady)
      webview.removeEventListener('did-navigate', handleNavigate)
      webview.removeEventListener('did-navigate-in-page', handleNavigate)
      webview.removeEventListener('did-start-loading', handleStartLoading)
      webview.removeEventListener('did-stop-loading', handleStopLoading)
      webview.removeEventListener('did-fail-load', handleFailLoad)
    }
  }, [activeTab, webviewKey])

  // Navigate when active tab changes
  useEffect(() => {
    if (!activeTab) return

    const targetUrl = activeTab.url
    if (targetUrl && targetUrl !== 'about:blank') {
      console.log(`[Browser] Tab changed to ${activeTab.id}, requesting navigation to: ${targetUrl}`)
      debouncedNavigate(targetUrl)
    }
  }, [activeTab?.id, activeTab?.url, debouncedNavigate])

  const navigate = useCallback((url: string) => {
    let finalUrl = url
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      if (url.includes('.') && !url.includes(' ')) {
        finalUrl = `https://${url}`
      } else if (url.match(/^localhost:\d+/)) {
        finalUrl = `http://${url}`
      } else {
        finalUrl = `https://www.google.com/search?q=${encodeURIComponent(url)}`
      }
    }
    setInputUrl(finalUrl)

    // Navigate directly (not debounced for user-initiated navigation)
    const webview = webviewRef.current
    if (webview && webviewReadyRef.current) {
      console.log(`[Browser] User navigation to: ${finalUrl}`)
      currentUrlRef.current = finalUrl
      try {
        webview.loadURL(finalUrl).catch((err: Error) => {
          if (!err.message.includes('ERR_ABORTED')) {
            console.error(`[Browser] Navigation error:`, err.message)
          }
        })
      } catch (e) {
        webview.src = finalUrl
      }
    }

    // Update main process tab state
    if (activeTab) {
      window.electron.browser.navigate(activeTab.id, finalUrl)
    }
  }, [activeTab])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    navigate(inputUrl)
  }

  const goBack = () => webviewRef.current?.goBack()
  const goForward = () => webviewRef.current?.goForward()
  const refresh = () => webviewRef.current?.reload()
  const goHome = () => navigate('https://claude.ai')

  const addTab = async () => {
    const tab = await window.electron.browser.createTab(undefined, 'https://claude.ai')
    setActiveTabId(tab.id)
    setInputUrl(tab.url)
  }

  const closeTab = async (tabId: string) => {
    if (tabs.length === 1) return

    await window.electron.browser.closeTab(tabId)

    if (activeTabId === tabId) {
      const remaining = tabs.filter(t => t.id !== tabId)
      if (remaining.length > 0) {
        setActiveTabId(remaining[remaining.length - 1].id)
        setInputUrl(remaining[remaining.length - 1].url)
      }
    }
  }

  const selectTab = useCallback((tab: BrowserTab) => {
    // Skip if already selected
    if (tab.id === activeTabId) return

    console.log(`[Browser] Selecting tab ${tab.id} with URL: ${tab.url}`)

    // Reset navigation state for clean tab switch
    currentUrlRef.current = ''
    navigationInProgressRef.current = false

    // Update state
    setActiveTabId(tab.id)
    setInputUrl(tab.url)

    // Tell main process
    window.electron.browser.selectTab(tab.id)
  }, [activeTabId])

  // Dev server controls
  const startDevServer = async (sessionId: string) => {
    const session = sessions.find(s => s.id === sessionId)
    if (!session) return

    const result = await window.electron.devServer.start(sessionId, session.projectPath)
    if (result.success && result.info) {
      setDevServerStatus(prev => new Map(prev).set(sessionId, result.info!))
      const tab = tabs.find(t => t.sessionId === sessionId)
      if (tab) {
        navigate(result.info.url)
      }
    }
  }

  const stopDevServer = async (sessionId: string) => {
    await window.electron.devServer.stop(sessionId)
  }

  const getTabLabel = (tab: BrowserTab): string => {
    if (tab.sessionId) {
      const session = sessions.find(s => s.id === tab.sessionId)
      return session?.projectName || tab.title
    }
    return tab.title || 'New Tab'
  }

  const getDevServerForTab = (tab: BrowserTab): DevServerInfo | undefined => {
    if (tab.sessionId) {
      return devServerStatus.get(tab.sessionId)
    }
    return undefined
  }

  return (
    <div className="h-full flex flex-col bg-card rounded-lg border border-border overflow-hidden">
      {/* Tabs */}
      <div className="flex items-center gap-1 px-2 pt-2 bg-muted/50 border-b border-border overflow-x-auto">
        {tabs.map((tab) => {
          const devServer = getDevServerForTab(tab)
          return (
            <div
              key={tab.id}
              className={cn(
                'flex items-center gap-2 px-3 py-1.5 rounded-t-md text-sm max-w-[200px] cursor-pointer shrink-0',
                tab.id === activeTabId
                  ? 'bg-card border border-b-0 border-border'
                  : 'bg-transparent hover:bg-accent'
              )}
              onClick={() => selectTab(tab)}
            >
              {tab.sessionId ? (
                <Terminal className="h-3 w-3 shrink-0 text-primary" />
              ) : (
                <Globe className="h-3 w-3 shrink-0 text-muted-foreground" />
              )}
              <span className="truncate flex-1">{getTabLabel(tab)}</span>
              {devServer && (
                <span className={cn(
                  'w-2 h-2 rounded-full',
                  devServer.running ? 'bg-green-500' : 'bg-gray-500'
                )} />
              )}
              {tabs.length > 1 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    closeTab(tab.id)
                  }}
                  className="hover:bg-muted rounded p-0.5"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          )
        })}
        <Button variant="ghost" size="icon" onClick={addTab} className="h-7 w-7 shrink-0">
          <Plus className="h-3 w-3" />
        </Button>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 p-2 border-b border-border">
        <Button variant="ghost" size="icon" onClick={goBack} className="h-8 w-8">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" onClick={goForward} className="h-8 w-8">
          <ArrowRight className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" onClick={refresh} className="h-8 w-8">
          <RotateCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
        </Button>
        <Button variant="ghost" size="icon" onClick={goHome} className="h-8 w-8">
          <Home className="h-4 w-4" />
        </Button>

        {activeTab?.sessionId && (
          <>
            {getDevServerForTab(activeTab)?.running ? (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => stopDevServer(activeTab.sessionId!)}
                className="h-8 w-8 text-red-500 hover:text-red-600"
                title="Stop dev server"
              >
                <Square className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => startDevServer(activeTab.sessionId!)}
                className="h-8 w-8 text-green-500 hover:text-green-600"
                title="Start dev server"
              >
                <Play className="h-4 w-4" />
              </Button>
            )}
          </>
        )}

        <form onSubmit={handleSubmit} className="flex-1">
          <Input
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            placeholder="Enter URL or search..."
            className="h-8 text-sm"
          />
        </form>

        <Button
          variant="ghost"
          size="icon"
          onClick={() => window.open(activeTab?.url || browserUrl, '_blank')}
          className="h-8 w-8"
          title="Open in external browser"
        >
          <ExternalLink className="h-4 w-4" />
        </Button>

        {onClose && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-8 w-8 ml-2"
            title="Close browser"
          >
            <PanelLeftClose className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Webview */}
      <div className="flex-1 bg-white relative">
        {activeTab?.url === 'about:blank' && activeTab.sessionId && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-background/90">
            <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
            <p className="text-muted-foreground">Starting dev server...</p>
          </div>
        )}
        <webview
          key={webviewKey}
          ref={webviewRef}
          src="about:blank"
          className="w-full h-full"
          // @ts-ignore - webview attributes
          allowpopups="true"
          // Prevent webview from capturing all pointer events during resize
          style={{ pointerEvents: isLoading ? 'none' : 'auto' }}
        />
      </div>
    </div>
  )
}

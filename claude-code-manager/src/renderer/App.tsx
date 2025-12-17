import React, { useEffect, useState, useCallback } from 'react'
import { TitleBar } from './components/layout/TitleBar'
import { Sidebar } from './components/layout/Sidebar'
import { SessionGrid } from './components/session/SessionGrid'
import { Browser } from './components/browser/Browser'
import { Settings } from './components/settings/Settings'
import { FileViewer } from './components/file-explorer/FileViewer'
import { NewSessionModal } from './components/session/NewSessionModal'
import { ResizeHandle } from './components/ui/ResizeHandle'
import { WorktreePanel } from './components/worktree'
import { AutonomousView } from './components/autonomous'
import { useUIStore } from './stores/ui-store'
import { useSessionStore } from './stores/session-store'
import { useDevServerAutoStart } from './hooks/useDevServerAutoStart'

export default function App() {
  const { activePanel, setActivePanel, selectedFile, theme } = useUIStore()
  const { updateSessionStatus, setSessions } = useSessionStore()
  const [rightPanelWidth, setRightPanelWidth] = useState(700) // Default width in pixels

  // Auto-start dev servers when sessions are created (runs at app level)
  useDevServerAutoStart()

  // Apply theme on mount
  useEffect(() => {
    const root = document.documentElement
    if (theme === 'system') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      root.classList.toggle('dark', prefersDark)
    } else {
      root.classList.toggle('dark', theme === 'dark')
    }
  }, [theme])

  // Listen for session status updates from main process
  useEffect(() => {
    const unsubscribe = window.electron.session.onStatus((status) => {
      updateSessionStatus(status.sessionId, status.status as any, status.editedFiles)
    })

    return unsubscribe
  }, [updateSessionStatus])

  // Load existing sessions on startup
  useEffect(() => {
    const loadSessions = async () => {
      const sessions = await window.electron.session.list()
      if (sessions && sessions.length > 0) {
        console.log(`[App] Loading ${sessions.length} existing sessions`)
        setSessions(sessions)
      }
    }
    loadSessions()
  }, [setSessions])

  // Get sessions for layout decisions
  const { sessions } = useSessionStore()
  const hasActiveSessions = sessions.length > 0

  // Check if we should show a right panel
  const showRightPanel = activePanel === 'settings' || activePanel === 'browser' || activePanel === 'worktrees' || activePanel === 'autonomous' || (activePanel === 'files' && selectedFile)

  // Check if autonomous should take full width (no active sessions)
  const autonomousFullWidth = activePanel === 'autonomous' && !hasActiveSessions

  // Handle resize of right panel
  const handleRightPanelResize = useCallback((delta: number) => {
    setRightPanelWidth(prev => {
      const newWidth = prev - delta // Subtract because dragging right should shrink the left panel
      // Allow up to 80% of window width or 2000px, whichever is smaller
      const maxWidth = Math.min(window.innerWidth * 0.8, 2000)
      return Math.max(300, Math.min(maxWidth, newWidth))
    })
  }, [])

  // Render right panel content based on activePanel
  const renderRightPanel = () => {
    if (activePanel === 'settings') {
      return <Settings onClose={() => setActivePanel(null)} />
    }
    if (activePanel === 'browser') {
      return <Browser onClose={() => setActivePanel(null)} />
    }
    if (activePanel === 'worktrees') {
      return <WorktreePanel />
    }
    if (activePanel === 'autonomous') {
      return <AutonomousView onClose={() => setActivePanel(null)} />
    }
    if (activePanel === 'files' && selectedFile) {
      return <FileViewer />
    }
    return null
  }

  return (
    <div className="h-screen flex flex-col bg-background text-foreground overflow-hidden">
      {/* Title bar */}
      <TitleBar />

      {/* Main content */}
      <div className="flex-1 flex min-h-0">
        {/* Sidebar */}
        <Sidebar />

        {/* Main area - sessions visible unless autonomous takes full width */}
        <div className="flex-1 min-w-0 h-full flex">
          {/* Sessions area - hidden when autonomous takes full width */}
          {!autonomousFullWidth && (
            <div className={`h-full transition-all duration-200 ${showRightPanel ? 'flex-[6]' : 'flex-1'}`}>
              <SessionGrid />
            </div>
          )}

          {/* Right panel - slides in/out, or full width for autonomous mode */}
          {showRightPanel && (
            <>
              {!autonomousFullWidth && (
                <ResizeHandle
                  direction="horizontal"
                  onResize={handleRightPanelResize}
                  className="bg-border"
                />
              )}
              <div
                style={autonomousFullWidth ? { width: '100%' } : { width: rightPanelWidth }}
                className={`h-full overflow-auto shrink-0 ${autonomousFullWidth ? 'p-4' : 'p-4 pl-2'}`}
              >
                {renderRightPanel()}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Modals */}
      <NewSessionModal />
    </div>
  )
}

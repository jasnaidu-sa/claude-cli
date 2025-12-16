import { useEffect, useRef } from 'react'
import { useSessionStore } from '@renderer/stores/session-store'

// Track initialized sessions across renders (module-level to persist across component unmounts)
// Note: These reset on full page reload but persist through React re-renders
const initializedSessionsRef = new Set<string>()
const initializingSessionsRef = new Set<string>()

// Clear tracking on module load (handles hot reload in development)
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    initializedSessionsRef.clear()
    initializingSessionsRef.clear()
  })
}

/**
 * Hook that automatically detects and starts dev servers when new sessions are created.
 * Also creates browser tabs for each session.
 * This runs at the App level so it works regardless of browser panel visibility.
 */
export function useDevServerAutoStart() {
  const { sessions } = useSessionStore()
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    const initSession = async (session: typeof sessions[0]) => {
      // Double-check guards (atomic operation)
      if (initializedSessionsRef.has(session.id) || initializingSessionsRef.has(session.id)) {
        return
      }

      // Mark as initializing to prevent concurrent initialization
      initializingSessionsRef.add(session.id)

      try {
        // Check if tab already exists for this session (from main process)
        const existingTabs = await window.electron.browser.listTabs()
        console.log(`[DevServer] Existing tabs:`, existingTabs.map(t => ({ id: t.id, sessionId: t.sessionId, url: t.url })))

        const existingTab = existingTabs.find(t => t.sessionId === session.id)
        if (existingTab) {
          console.log(`[DevServer] Tab already exists for session ${session.id}, checking if dev server needs to start`)
          initializedSessionsRef.add(session.id)
          initializingSessionsRef.delete(session.id)

          // Even if tab exists, check if we need to start the dev server
          const devServerStatus = await window.electron.devServer.status(session.id)
          if (!devServerStatus?.running) {
            console.log(`[DevServer] Dev server not running for existing tab, starting it...`)
            const devServer = await window.electron.devServer.detect(session.projectPath)
            if (devServer) {
              const result = await window.electron.devServer.start(session.id, session.projectPath)
              if (result.success && result.info) {
                console.log(`[DevServer] Started for existing tab at ${result.info.url}`)
                await new Promise(resolve => setTimeout(resolve, 4000))
                await window.electron.browser.navigate(existingTab.id, result.info.url)
              }
            }
          }
          return
        }

        // Detect dev server first
        const devServer = await window.electron.devServer.detect(session.projectPath)
        console.log(`[DevServer] Detection result for ${session.projectPath}:`, devServer)

        // Create tab with a placeholder URL while dev server starts
        const placeholderUrl = 'about:blank'
        console.log(`[DevServer] Creating tab for session ${session.id}`)
        const tab = await window.electron.browser.createTab(session.id, placeholderUrl)
        console.log(`[DevServer] Tab created:`, tab)

        // Mark as initialized immediately after tab creation
        initializedSessionsRef.add(session.id)

        // Start dev server if detected
        if (devServer) {
          console.log(`[DevServer] Starting for session ${session.id}: npm run ${devServer.script} at port ${devServer.port}`)

          // Auto-start dev server
          const result = await window.electron.devServer.start(session.id, session.projectPath)

          if (result.success && result.info) {
            console.log(`[DevServer] Started successfully at ${result.info.url}`)
            // Navigate to the dev server URL after it's started
            // Wait longer for the server to be fully ready (dev servers can take time to compile)
            await new Promise(resolve => setTimeout(resolve, 4000))
            if (mountedRef.current) {
              console.log(`[DevServer] Navigating tab ${tab.id} to URL: ${result.info.url}`)
              await window.electron.browser.navigate(tab.id, result.info.url)
              console.log(`[DevServer] Navigation complete`)
            }
          } else {
            console.error(`[DevServer] Failed to start:`, result.error)
          }
        } else {
          console.log(`[DevServer] No dev server detected for ${session.projectPath}`)
        }
      } catch (error) {
        console.error(`[DevServer] Error initializing session ${session.id}:`, error)
      } finally {
        initializingSessionsRef.delete(session.id)
      }
    }

    // Initialize each session that hasn't been initialized
    console.log(`[DevServer] Hook running - ${sessions.length} sessions in store`)
    sessions.forEach(session => {
      const alreadyInitialized = initializedSessionsRef.has(session.id)
      const currentlyInitializing = initializingSessionsRef.has(session.id)
      console.log(`[DevServer] Session ${session.id} (${session.projectName}): initialized=${alreadyInitialized}, initializing=${currentlyInitializing}`)

      if (!alreadyInitialized && !currentlyInitializing) {
        console.log(`[DevServer] Initiating auto-start for session ${session.id}`)
        initSession(session)
      }
    })
  }, [sessions])

  // Return the tracking sets for debugging/status
  return {
    initializedSessions: initializedSessionsRef,
    initializingSessions: initializingSessionsRef
  }
}

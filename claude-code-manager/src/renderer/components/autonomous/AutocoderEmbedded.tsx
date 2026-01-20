/**
 * AutocoderEmbedded Component
 *
 * Simple launcher for the embedded autocoder UI.
 * Spawns FastAPI backend and displays embedded React UI via BrowserView.
 */

import React, { useEffect, useState } from 'react'
import { Play, Square, Loader2, AlertCircle, Eye, EyeOff } from 'lucide-react'
import { Button } from '../ui/button'
import { useSessionStore } from '@renderer/stores/session-store'
import { cn } from '@renderer/lib/utils'

export function AutocoderEmbedded() {
  const { sessions } = useSessionStore()
  const [isRunning, setIsRunning] = useState(false)
  const [isStarting, setIsStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [projectPath, setProjectPath] = useState<string | null>(null)
  const [logs, setLogs] = useState<Array<{ type: 'stdout' | 'stderr'; message: string }>>([])
  const [showLogs, setShowLogs] = useState(false)

  // Get project path from active session
  const activeSession = sessions.find(s => s.status === 'running')
  const defaultProjectPath = activeSession?.projectPath || sessions[0]?.projectPath

  // Check autocoder status on mount
  useEffect(() => {
    checkStatus()

    // Listen for logs
    const cleanupLog = window.electron.autocoder.onLog((data) => {
      setLogs((prev) => [...prev.slice(-100), data]) // Keep last 100 logs
    })

    const cleanupError = window.electron.autocoder.onError((data) => {
      setError(data.message)
    })

    const cleanupStopped = window.electron.autocoder.onStopped((data) => {
      setIsRunning(false)
      setProjectPath(null)
      if (data.code !== 0 && data.code !== null) {
        setError(`Backend exited with code ${data.code}`)
      }
    })

    return () => {
      cleanupLog()
      cleanupError()
      cleanupStopped()
    }
  }, [])

  const checkStatus = async () => {
    try {
      const result = await window.electron.autocoder.status()
      if (result.success) {
        setIsRunning(result.isRunning)
        setProjectPath(result.projectPath)
      }
    } catch (err) {
      console.error('Failed to check autocoder status:', err)
    }
  }

  const handleStart = async () => {
    // Use default project path if available, otherwise use a placeholder
    // Autocoder UI has its own project selector for creating/selecting projects
    const projectPath = defaultProjectPath || 'C:\\temp'

    setIsStarting(true)
    setError(null)

    try {
      const result = await window.electron.autocoder.start(projectPath)
      if (result.success) {
        setIsRunning(true)
        setProjectPath(projectPath)
        setError(null)
      } else {
        setError(result.error || 'Failed to start autocoder')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsStarting(false)
    }
  }

  const handleStop = async () => {
    try {
      const result = await window.electron.autocoder.stop()
      if (result.success) {
        setIsRunning(false)
        setProjectPath(null)
      } else {
        setError(result.error || 'Failed to stop autocoder')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleShow = async () => {
    try {
      await window.electron.autocoder.show()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleHide = async () => {
    try {
      await window.electron.autocoder.hide()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="h-full flex flex-col bg-card">
      {/* Control Panel */}
      <div className="p-6 border-b border-border">
        <div className="max-w-2xl mx-auto space-y-4">
          <div>
            <h2 className="text-2xl font-bold mb-2">Autocoder</h2>
            <p className="text-sm text-muted-foreground">
              Autonomous coding powered by Claude Agent SDK. Features SQLite-based feature management,
              MCP server integration, and two-agent architecture (Initializer + Coding).
            </p>
          </div>

          {/* Status */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  'h-3 w-3 rounded-full',
                  isRunning ? 'bg-green-500 animate-pulse' : 'bg-gray-500'
                )}
              />
              <span className="text-sm font-medium">
                {isRunning ? 'Running' : 'Stopped'}
              </span>
            </div>

            {projectPath && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>Project:</span>
                <code className="px-2 py-1 bg-secondary rounded text-xs">
                  {projectPath.split(/[\\/]/).pop()}
                </code>
              </div>
            )}
          </div>

          {/* Error Display */}
          {error && (
            <div className="flex items-start gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded text-sm">
              <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
              <span className="text-destructive">{error}</span>
            </div>
          )}

          {/* Controls */}
          <div className="flex items-center gap-2">
            {!isRunning ? (
              <Button onClick={handleStart} disabled={isStarting}>
                {isStarting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Starting...
                  </>
                ) : (
                  <>
                    <Play className="mr-2 h-4 w-4" />
                    Start Autocoder
                  </>
                )}
              </Button>
            ) : (
              <>
                <Button onClick={handleStop} variant="destructive">
                  <Square className="mr-2 h-4 w-4" />
                  Stop
                </Button>
                <Button onClick={handleShow} variant="secondary">
                  <Eye className="mr-2 h-4 w-4" />
                  Show
                </Button>
                <Button onClick={handleHide} variant="secondary">
                  <EyeOff className="mr-2 h-4 w-4" />
                  Hide
                </Button>
              </>
            )}

            {logs.length > 0 && (
              <Button
                onClick={() => setShowLogs(!showLogs)}
                variant="outline"
                size="sm"
              >
                {showLogs ? 'Hide Logs' : 'Show Logs'} ({logs.length})
              </Button>
            )}
          </div>

        </div>
      </div>

      {/* Logs Panel */}
      {showLogs && logs.length > 0 && (
        <div className="flex-1 min-h-0 overflow-auto p-4 bg-black/50 font-mono text-xs">
          {logs.map((log, i) => (
            <div
              key={i}
              className={cn(
                'py-1',
                log.type === 'stderr' ? 'text-red-400' : 'text-gray-300'
              )}
            >
              {log.message}
            </div>
          ))}
        </div>
      )}

      {/* Instructions */}
      {!isRunning && !showLogs && (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="max-w-2xl space-y-4 text-sm text-muted-foreground">
            <h3 className="text-lg font-semibold text-foreground">How it works</h3>
            <ol className="list-decimal list-inside space-y-2">
              <li>Click "Start Autocoder" to spawn the FastAPI backend and Vite dev server</li>
              <li>The autocoder UI will be embedded in this window (via BrowserView)</li>
              <li>Use the embedded UI to initialize features and run autonomous coding</li>
              <li>Features are stored in SQLite and managed via MCP server</li>
              <li>The Initializer agent breaks down your request into implementable features</li>
              <li>The Coding agent implements features one by one until all tests pass</li>
            </ol>

            <div className="pt-4 border-t border-border">
              <h4 className="font-semibold text-foreground mb-2">Requirements</h4>
              <ul className="list-disc list-inside space-y-1">
                <li>Python 3.9+ installed on your system</li>
                <li>Anthropic API key configured in Settings</li>
              </ul>
              <p className="text-sm mt-2 text-muted-foreground">
                Note: You can create or select projects using the autocoder UI's built-in project selector
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

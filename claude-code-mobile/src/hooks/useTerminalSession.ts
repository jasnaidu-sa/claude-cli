import { useState, useEffect, useRef, useCallback } from 'react'
import { apiClient, TerminalSession } from '../api/client'
import { useConnectionStore } from '../stores/connection-store'

interface TerminalMessage {
  type: 'input' | 'output' | 'resize' | 'error' | 'clear'
  data?: string
  cols?: number
  rows?: number
  timestamp: number
}

interface UseTerminalSessionOptions {
  projectPath?: string
  shell?: 'bash' | 'zsh' | 'powershell'
}

interface UseTerminalSessionReturn {
  session: TerminalSession | null
  output: TerminalMessage[]
  isConnected: boolean
  isConnecting: boolean
  error: string | null
  createSession: () => Promise<boolean>
  sendInput: (input: string) => void
  sendResize: (cols: number, rows: number) => void
  clearOutput: () => void
  closeSession: () => Promise<void>
}

export function useTerminalSession(
  options: UseTerminalSessionOptions = {}
): UseTerminalSessionReturn {
  const [session, setSession] = useState<TerminalSession | null>(null)
  const [output, setOutput] = useState<TerminalMessage[]>([])
  const [isConnected, setIsConnected] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectAttempts = useRef(0)
  const maxReconnectAttempts = 3

  const { isConnected: serverConnected, serverUrl } = useConnectionStore()

  const connectWebSocket = useCallback((sessionId: string) => {
    if (!serverUrl) return

    const ws = apiClient.terminal.connectTerminal(sessionId)
    if (!ws) {
      setError('Failed to create WebSocket connection')
      return
    }

    wsRef.current = ws

    ws.onopen = () => {
      setIsConnected(true)
      setIsConnecting(false)
      setError(null)
      reconnectAttempts.current = 0

      setOutput(prev => [...prev, {
        type: 'output',
        data: '--- Connected to terminal ---\r\n',
        timestamp: Date.now(),
      }])
    }

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data)

        if (message.type === 'output') {
          setOutput(prev => [...prev, {
            type: 'output',
            data: message.data,
            timestamp: Date.now(),
          }])
        } else if (message.type === 'error') {
          setError(message.data)
          setOutput(prev => [...prev, {
            type: 'error',
            data: `Error: ${message.data}\r\n`,
            timestamp: Date.now(),
          }])
        }
      } catch {
        // Raw text output
        setOutput(prev => [...prev, {
          type: 'output',
          data: event.data,
          timestamp: Date.now(),
        }])
      }
    }

    ws.onerror = () => {
      setError('WebSocket connection error')
      setIsConnected(false)
    }

    ws.onclose = () => {
      setIsConnected(false)

      // Attempt reconnection
      if (reconnectAttempts.current < maxReconnectAttempts && session) {
        reconnectAttempts.current++
        setOutput(prev => [...prev, {
          type: 'output',
          data: `--- Connection lost. Reconnecting (${reconnectAttempts.current}/${maxReconnectAttempts})... ---\r\n`,
          timestamp: Date.now(),
        }])

        setTimeout(() => {
          if (session) {
            connectWebSocket(session.id)
          }
        }, 1000 * reconnectAttempts.current)
      } else if (reconnectAttempts.current >= maxReconnectAttempts) {
        setOutput(prev => [...prev, {
          type: 'error',
          data: '--- Connection lost. Max reconnection attempts reached. ---\r\n',
          timestamp: Date.now(),
        }])
      }
    }
  }, [serverUrl, session])

  const createSession = useCallback(async (): Promise<boolean> => {
    if (!serverConnected) {
      setError('Not connected to server')
      return false
    }

    setIsConnecting(true)
    setError(null)

    try {
      const result = await apiClient.terminal.createSession({
        projectPath: options.projectPath,
        shell: options.shell,
      })

      if (result.success && result.data) {
        setSession(result.data)
        connectWebSocket(result.data.id)
        return true
      } else {
        setError(result.error || 'Failed to create terminal session')
        setIsConnecting(false)
        return false
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create terminal session')
      setIsConnecting(false)
      return false
    }
  }, [serverConnected, options.projectPath, options.shell, connectWebSocket])

  const sendInput = useCallback((input: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'input',
        data: input,
      }))

      // Echo input locally for immediate feedback
      setOutput(prev => [...prev, {
        type: 'input',
        data: input,
        timestamp: Date.now(),
      }])
    }
  }, [])

  const sendResize = useCallback((cols: number, rows: number) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'resize',
        cols,
        rows,
      }))
    }
  }, [])

  const clearOutput = useCallback(() => {
    setOutput([{
      type: 'clear',
      data: '--- Terminal cleared ---\r\n',
      timestamp: Date.now(),
    }])
  }, [])

  const closeSession = useCallback(async () => {
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }

    if (session) {
      try {
        await apiClient.terminal.closeSession(session.id)
      } catch {
        // Ignore close errors
      }
      setSession(null)
    }

    setIsConnected(false)
    setOutput(prev => [...prev, {
      type: 'output',
      data: '--- Session closed ---\r\n',
      timestamp: Date.now(),
    }])
  }, [session])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
    }
  }, [])

  // Reconnect when server connection is restored
  useEffect(() => {
    if (serverConnected && session && !isConnected && !isConnecting) {
      reconnectAttempts.current = 0
      connectWebSocket(session.id)
    }
  }, [serverConnected, session, isConnected, isConnecting, connectWebSocket])

  return {
    session,
    output,
    isConnected,
    isConnecting,
    error,
    createSession,
    sendInput,
    sendResize,
    clearOutput,
    closeSession,
  }
}

// Helper to convert ANSI codes to simple styles (basic implementation)
export function parseAnsiOutput(text: string): { text: string; style?: 'bold' | 'dim' | 'error' }[] {
  // Simple ANSI parsing - removes codes and returns plain text
  // A full implementation would convert ANSI to React Native styles
  const cleaned = text
    .replace(/\x1b\[[0-9;]*m/g, '') // Remove color codes
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '') // Remove other ANSI sequences

  return [{ text: cleaned }]
}

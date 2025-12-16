import React, { useEffect, useRef, useCallback } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'

interface TerminalProps {
  sessionId: string
  onReady?: () => void
}

export function Terminal({ sessionId, onReady }: TerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)

  // Handle paste from clipboard using Electron's native clipboard
  const handlePaste = useCallback(() => {
    try {
      const text = window.electron.clipboard.readText()
      if (text && xtermRef.current) {
        window.electron.session.input(sessionId, text)
      }
    } catch (err) {
      console.error('Failed to read clipboard:', err)
    }
  }, [sessionId])

  // Handle copy to clipboard using Electron's native clipboard
  const handleCopy = useCallback(() => {
    if (xtermRef.current) {
      const selection = xtermRef.current.getSelection()
      if (selection) {
        window.electron.clipboard.writeText(selection)
      }
    }
  }, [])

  // Handle file drop - insert file path into terminal
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()

    // Small delay to let preload capture the file paths
    setTimeout(() => {
      const filePaths = window.electron.shell.getDroppedFilePaths()
      if (filePaths.length > 0 && xtermRef.current) {
        // Insert file paths (quoted if they contain spaces)
        const paths = filePaths.map(p => {
          return p.includes(' ') ? `"${p}"` : p
        }).join(' ')

        window.electron.session.input(sessionId, paths)
      }
    }, 10)
  }, [sessionId])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  // Initialize terminal
  useEffect(() => {
    if (!terminalRef.current || xtermRef.current) return

    const xterm = new XTerm({
      theme: {
        background: '#0d1117',
        foreground: '#c9d1d9',
        cursor: '#58a6ff',
        cursorAccent: '#0d1117',
        selectionBackground: '#264f78',
        black: '#0d1117',
        red: '#ff7b72',
        green: '#7ee787',
        yellow: '#d29922',
        blue: '#58a6ff',
        magenta: '#bc8cff',
        cyan: '#76e3ea',
        white: '#c9d1d9',
        brightBlack: '#484f58',
        brightRed: '#ffa198',
        brightGreen: '#9be9a8',
        brightYellow: '#e3b341',
        brightBlue: '#79c0ff',
        brightMagenta: '#d2a8ff',
        brightCyan: '#a5d6ff',
        brightWhite: '#f0f6fc'
      },
      fontSize: 16,
      lineHeight: 1.25,
      fontFamily: 'Cascadia Code, Consolas, monospace',
      fontWeight: 400,
      letterSpacing: 0,
      cursorBlink: true,
      cursorStyle: 'bar',
      scrollback: 10000,
      allowProposedApi: true
    })

    const fitAddon = new FitAddon()
    const webLinksAddon = new WebLinksAddon()

    xterm.loadAddon(fitAddon)
    xterm.loadAddon(webLinksAddon)

    xterm.open(terminalRef.current)
    fitAddon.fit()

    xtermRef.current = xterm
    fitAddonRef.current = fitAddon

    // Handle user input
    xterm.onData((data) => {
      window.electron.session.input(sessionId, data)
    })

    // Handle resize
    xterm.onResize(({ cols, rows }) => {
      window.electron.session.resize(sessionId, cols, rows)
    })

    // Handle keyboard shortcuts for copy/paste using Electron's native clipboard
    xterm.attachCustomKeyEventHandler((e) => {
      // Only handle keydown events to prevent duplicate triggers
      if (e.type !== 'keydown') {
        return true
      }

      const isCtrlC = e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === 'c'
      const isCtrlV = e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === 'v'
      const isCtrlShiftC = e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === 'c'
      const isCtrlShiftV = e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === 'v'

      // Ctrl+C with selection = copy (otherwise send SIGINT)
      if (isCtrlC && xterm.hasSelection()) {
        e.preventDefault()
        const selection = xterm.getSelection()
        if (selection) {
          window.electron.clipboard.writeText(selection)
        }
        return false
      }

      // Ctrl+V = paste
      if (isCtrlV) {
        e.preventDefault()
        const text = window.electron.clipboard.readText()
        if (text) {
          window.electron.session.input(sessionId, text)
        }
        return false
      }

      // Ctrl+Shift+C = copy (alternative)
      if (isCtrlShiftC) {
        e.preventDefault()
        const selection = xterm.getSelection()
        if (selection) {
          window.electron.clipboard.writeText(selection)
        }
        return false
      }

      // Ctrl+Shift+V = paste (alternative)
      if (isCtrlShiftV) {
        e.preventDefault()
        const text = window.electron.clipboard.readText()
        if (text) {
          window.electron.session.input(sessionId, text)
        }
        return false
      }

      return true // Allow other keys
    })

    onReady?.()

    return () => {
      xterm.dispose()
      xtermRef.current = null
      fitAddonRef.current = null
    }
  }, [sessionId, onReady])

  // Listen for output from main process
  useEffect(() => {
    const unsubscribe = window.electron.session.onOutput((output) => {
      if (output.sessionId === sessionId && xtermRef.current) {
        xtermRef.current.write(output.data)
      }
    })

    return unsubscribe
  }, [sessionId])

  // Handle container resize
  useEffect(() => {
    const handleResize = () => {
      if (fitAddonRef.current) {
        fitAddonRef.current.fit()
      }
    }

    const resizeObserver = new ResizeObserver(handleResize)
    if (terminalRef.current) {
      resizeObserver.observe(terminalRef.current)
    }

    window.addEventListener('resize', handleResize)

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', handleResize)
    }
  }, [])

  // Handle right-click context menu
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    // If there's a selection, copy it; otherwise paste
    if (xtermRef.current?.hasSelection()) {
      handleCopy()
    } else {
      handlePaste()
    }
  }, [handleCopy, handlePaste])

  return (
    <div
      ref={terminalRef}
      className="h-full w-full bg-[#0d1117] rounded-md overflow-hidden p-1"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onContextMenu={handleContextMenu}
    />
  )
}

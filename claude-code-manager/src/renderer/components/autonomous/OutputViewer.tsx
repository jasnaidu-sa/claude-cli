/**
 * OutputViewer Component
 *
 * Scrolling log display for orchestrator output.
 * Supports timestamps, expand/collapse, and clear functionality.
 */

import React, { useRef, useEffect, useState } from 'react'
import {
  Terminal,
  ChevronDown,
  ChevronUp,
  Trash2,
  Download,
  Pause,
  Play
} from 'lucide-react'
import { Button } from '../ui/button'
import { cn } from '@renderer/lib/utils'
import { useAutonomousStore } from '@renderer/stores/autonomous-store'
import type { OrchestratorOutput } from '@shared/types'

interface OutputViewerProps {
  sessionId: string
  maxLines?: number
}

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

function getOutputColor(type: OrchestratorOutput['type']): string {
  switch (type) {
    case 'stdout':
      return 'text-foreground'
    case 'stderr':
      return 'text-red-400'
    case 'system':
      return 'text-blue-400'
    case 'progress':
      return 'text-green-400'
    default:
      return 'text-muted-foreground'
  }
}

export function OutputViewer({ sessionId, maxLines = 500 }: OutputViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [isExpanded, setIsExpanded] = useState(true)
  const [autoScroll, setAutoScroll] = useState(true)
  const [filter, setFilter] = useState<OrchestratorOutput['type'] | 'all'>('all')

  const { sessionOutput, clearSessionOutput } = useAutonomousStore()

  const outputs = sessionOutput[sessionId] || []

  // Filter outputs
  const filteredOutputs = filter === 'all'
    ? outputs
    : outputs.filter(o => o.type === filter)

  // Limit to maxLines
  const displayOutputs = filteredOutputs.slice(-maxLines)

  // Auto-scroll to bottom when new output arrives
  useEffect(() => {
    if (autoScroll && containerRef.current && isExpanded) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [outputs.length, autoScroll, isExpanded])

  // Detect manual scroll
  const handleScroll = () => {
    if (!containerRef.current) return

    const { scrollTop, scrollHeight, clientHeight } = containerRef.current
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50

    setAutoScroll(isAtBottom)
  }

  const handleClear = () => {
    if (confirm('Clear all output?')) {
      clearSessionOutput(sessionId)
    }
  }

  const handleExport = () => {
    const content = outputs
      .map(o => `[${formatTimestamp(o.timestamp)}] [${o.type.toUpperCase()}] ${o.data}`)
      .join('\n')

    const blob = new Blob([content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `output-${sessionId}.log`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const scrollToBottom = () => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
      setAutoScroll(true)
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-semibold text-sm">Output</h2>
          <span className="text-xs text-muted-foreground">
            ({outputs.length} lines)
          </span>
        </div>
        <div className="flex items-center gap-1">
          {/* Filter */}
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as any)}
            className="h-7 px-2 text-xs bg-secondary border border-border rounded"
          >
            <option value="all">All</option>
            <option value="stdout">stdout</option>
            <option value="stderr">stderr</option>
            <option value="system">system</option>
            <option value="progress">progress</option>
          </select>

          <div className="w-px h-4 bg-border mx-1" />

          {/* Auto-scroll toggle */}
          <Button
            variant={autoScroll ? 'default' : 'ghost'}
            size="icon"
            onClick={() => setAutoScroll(!autoScroll)}
            className="h-7 w-7"
            title={autoScroll ? 'Auto-scroll: ON' : 'Auto-scroll: OFF'}
          >
            {autoScroll ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
          </Button>

          <Button
            variant="ghost"
            size="icon"
            onClick={handleExport}
            disabled={outputs.length === 0}
            className="h-7 w-7"
            title="Export log"
          >
            <Download className="h-3 w-3" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            onClick={handleClear}
            disabled={outputs.length === 0}
            className="h-7 w-7 hover:text-destructive"
            title="Clear output"
          >
            <Trash2 className="h-3 w-3" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsExpanded(!isExpanded)}
            className="h-7 w-7"
            title={isExpanded ? 'Collapse' : 'Expand'}
          >
            {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </Button>
        </div>
      </div>

      {/* Output Content */}
      {isExpanded && (
        <div
          ref={containerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-auto bg-black/50 font-mono text-xs p-2"
        >
          {displayOutputs.length === 0 ? (
            <div className="h-full flex items-center justify-center text-muted-foreground">
              No output yet. Start the workflow to see logs.
            </div>
          ) : (
            <div className="space-y-0.5">
              {displayOutputs.map((output, index) => (
                <div
                  key={`${output.timestamp}-${index}`}
                  className={cn('flex', getOutputColor(output.type))}
                >
                  <span className="text-muted-foreground shrink-0 select-none mr-2">
                    [{formatTimestamp(output.timestamp)}]
                  </span>
                  <span className="text-muted-foreground shrink-0 select-none mr-2 w-16">
                    [{output.type.toUpperCase().padEnd(8)}]
                  </span>
                  <span className="whitespace-pre-wrap break-all">{output.data}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Footer with scroll-to-bottom button */}
      {isExpanded && !autoScroll && outputs.length > 0 && (
        <div className="absolute bottom-4 right-4">
          <Button
            variant="secondary"
            size="sm"
            onClick={scrollToBottom}
            className="shadow-lg"
          >
            <ChevronDown className="h-3 w-3 mr-1" />
            Jump to bottom
          </Button>
        </div>
      )}
    </div>
  )
}

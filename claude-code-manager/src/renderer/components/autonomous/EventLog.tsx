/**
 * EventLog Component
 *
 * Real-time streaming event display for orchestrator execution.
 * Inspired by Leon's autonomous-coding-with-ui.
 * Shows text chunks, tool usage, and heartbeats in real-time.
 */

import React, { useRef, useEffect } from 'react'
import { Settings, CheckCircle2, XCircle, Activity } from 'lucide-react'
import { cn } from '@renderer/lib/utils'

export interface StreamEvent {
  type: string
  chunk_type?: string
  data: any
  timestamp: number
  phase?: string
  iteration?: number
}

interface EventLogProps {
  events: StreamEvent[]
  className?: string
  maxEvents?: number
}

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

function getToolSummary(toolData: any): string {
  if (!toolData) return ''

  const { name, input } = toolData

  // Summarize common tools
  if (name === 'Read' && input?.file_path) {
    const fileName = input.file_path.split(/[\\/]/).pop()
    return `Reading ${fileName}`
  }

  if (name === 'Write' && input?.file_path) {
    const fileName = input.file_path.split(/[\\/]/).pop()
    return `Writing ${fileName}`
  }

  if (name === 'Edit' && input?.file_path) {
    const fileName = input.file_path.split(/[\\/]/).pop()
    return `Editing ${fileName}`
  }

  if (name === 'Bash' && input?.command) {
    const cmd = input.command.substring(0, 50)
    return `Running: ${cmd}${input.command.length > 50 ? '...' : ''}`
  }

  if (name === 'Glob' && input?.pattern) {
    return `Searching: ${input.pattern}`
  }

  if (name === 'Grep' && input?.pattern) {
    return `Searching code: ${input.pattern}`
  }

  if (name === 'Task' && input?.description) {
    return input.description
  }

  // Generic fallback
  if (input && typeof input === 'object') {
    const keys = Object.keys(input)
    if (keys.length > 0) {
      const firstKey = keys[0]
      const firstValue = input[firstKey]
      if (typeof firstValue === 'string' && firstValue.length < 50) {
        return `${firstKey}: ${firstValue}`
      }
    }
  }

  return ''
}

function EventEntry({ event }: { event: StreamEvent }) {
  // stream_chunk events
  if (event.type === 'stream_chunk') {
    // Text chunks - agent thinking/response (natural flow like Claude CLI)
    if (event.chunk_type === 'text') {
      return (
        <div className="text-foreground text-sm leading-relaxed whitespace-pre-wrap py-0.5">
          {event.data?.data || event.data}
        </div>
      )
    }

    // Tool start - inline badge style like [Reading file.tsx]
    if (event.chunk_type === 'tool_start') {
      const toolData = event.data?.data || event.data
      const summary = getToolSummary(toolData)

      return (
        <div className="text-sm py-0.5 flex items-center gap-2">
          <span className="text-blue-400 font-mono text-xs">
            [{toolData?.name || 'Tool'}{summary ? `: ${summary}` : ''}]
          </span>
        </div>
      )
    }

    // Tool result - minimal, only show if error
    if (event.chunk_type === 'tool_result') {
      const resultData = event.data?.data || event.data
      const isSuccess = resultData?.status === 'success' || !resultData?.status

      // Only show errors, success is implied
      if (!isSuccess) {
        return (
          <div className="text-red-400 text-xs py-0.5 flex items-center gap-1">
            <XCircle className="h-3 w-3" />
            <span>Tool error</span>
          </div>
        )
      }
      return null
    }

    // System messages - subtle
    if (event.chunk_type === 'system') {
      return (
        <div className="text-muted-foreground text-xs py-0.5 italic">
          {event.data?.data || event.data}
        </div>
      )
    }

    // Complete event - minimal separator
    if (event.chunk_type === 'complete') {
      return (
        <div className="border-t border-border/30 my-2" />
      )
    }
  }

  // Heartbeat events - very minimal, just a pulse indicator
  if (event.type === 'heartbeat') {
    return (
      <div className="text-xs text-muted-foreground/30 py-0.5 flex items-center gap-1">
        <div className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" />
        <span className="text-muted-foreground/50">thinking...</span>
      </div>
    )
  }

  // Progress events - highlighted
  if (event.type === 'progress') {
    return (
      <div className="text-green-400 text-sm py-1 font-medium">
        ✓ {event.data?.message || event.data}
      </div>
    )
  }

  // Status events
  if (event.type === 'status') {
    return (
      <div className="text-blue-400 text-sm py-1">
        {event.data?.status || event.data}
      </div>
    )
  }

  // Error events - prominent but clean
  if (event.type === 'error') {
    return (
      <div className="bg-red-500/10 border-l-2 border-red-500 pl-3 py-2 my-1">
        <div className="text-red-400 text-sm">
          {event.data?.message || event.data}
        </div>
      </div>
    )
  }

  // Fallback for unknown event types
  return null
}

export function EventLog({ events, className, maxEvents = 500 }: EventLogProps) {
  const logEndRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when new events arrive
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [events.length])

  // Limit events to maxEvents
  const displayEvents = events.slice(-maxEvents)

  return (
    <div className={cn('space-y-1 font-mono text-xs p-4', className)}>
      {displayEvents.length === 0 ? (
        <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
          Waiting for agent activity...
        </div>
      ) : (
        <>
          {displayEvents.map((event, idx) => (
            <EventEntry key={`${event.timestamp}-${idx}`} event={event} />
          ))}
          <div ref={logEndRef} />
        </>
      )}
    </div>
  )
}

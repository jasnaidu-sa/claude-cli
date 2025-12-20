/**
 * AgentTerminalGrid Component
 *
 * Displays multiple agent terminals in a responsive grid layout for
 * multi-agent orchestration view. Each terminal shows real-time streaming
 * output from a Claude Agent SDK session.
 *
 * Features:
 * - Responsive grid layout (1-4 columns based on agent count)
 * - Real-time streaming text with tool indicators
 * - Agent status badges (running, idle, complete, error)
 * - Minimizable terminals
 * - Auto-scroll with manual override
 */

import React, { useRef, useEffect, useState, useCallback } from 'react'
import {
  Terminal,
  Maximize2,
  Minimize2,
  ChevronDown,
  Circle,
  CheckCircle,
  AlertCircle,
  Loader2,
  Wrench,
  Code,
  FileText
} from 'lucide-react'
import { Button } from '../ui/button'
import { cn } from '@renderer/lib/utils'

// Agent status types
export type AgentStatus = 'idle' | 'running' | 'complete' | 'error' | 'waiting'

// Stream chunk from orchestrator
export interface StreamChunk {
  chunkType: 'text' | 'tool_start' | 'tool_result' | 'complete' | 'system' | 'error'
  data: unknown
  timestamp: number
}

// Agent terminal configuration
export interface AgentTerminal {
  id: string
  name: string
  role: string  // e.g., "Context Agent", "Checkpoint Agent", "Implementation"
  status: AgentStatus
  chunks: StreamChunk[]
  currentTool?: string
  startedAt?: number
  completedAt?: number
  error?: string
}

interface AgentTerminalGridProps {
  agents: AgentTerminal[]
  maxChunksPerAgent?: number
  onAgentClick?: (agentId: string) => void
  className?: string
}

// Status badge component
function StatusBadge({ status }: { status: AgentStatus }) {
  const statusConfig: Record<AgentStatus, {
    icon: React.ElementType
    color: string
    label: string
    animate?: boolean
  }> = {
    idle: { icon: Circle, color: 'text-muted-foreground', label: 'Idle' },
    running: { icon: Loader2, color: 'text-blue-400', label: 'Running', animate: true },
    complete: { icon: CheckCircle, color: 'text-green-400', label: 'Complete' },
    error: { icon: AlertCircle, color: 'text-red-400', label: 'Error' },
    waiting: { icon: Circle, color: 'text-amber-400', label: 'Waiting' }
  }

  const config = statusConfig[status]
  const Icon = config.icon

  return (
    <div className={cn('flex items-center gap-1.5 text-xs', config.color)}>
      <Icon className={cn('h-3 w-3', config.animate && 'animate-spin')} />
      <span>{config.label}</span>
    </div>
  )
}

// Tool indicator component
function ToolIndicator({ toolName }: { toolName: string }) {
  const toolIcons: Record<string, React.ElementType> = {
    Read: FileText,
    Write: FileText,
    Edit: Code,
    Bash: Terminal,
    Glob: FileText,
    Grep: FileText
  }

  const Icon = toolIcons[toolName] || Wrench

  return (
    <div className="flex items-center gap-1.5 px-2 py-0.5 bg-blue-500/20 text-blue-400 text-xs rounded">
      <Icon className="h-3 w-3" />
      <span>{toolName}</span>
    </div>
  )
}

// Single agent terminal component
function AgentTerminalPane({
  agent,
  isMaximized,
  onToggleMaximize,
  onClick
}: {
  agent: AgentTerminal
  isMaximized: boolean
  onToggleMaximize: () => void
  onClick?: () => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const [isMinimized, setIsMinimized] = useState(false)

  // Auto-scroll when new chunks arrive
  useEffect(() => {
    if (autoScroll && containerRef.current && !isMinimized) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [agent.chunks.length, autoScroll, isMinimized])

  // Detect manual scroll
  const handleScroll = useCallback(() => {
    if (!containerRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50
    setAutoScroll(isAtBottom)
  }, [])

  // Render chunk content
  const renderChunk = (chunk: StreamChunk, index: number) => {
    switch (chunk.chunkType) {
      case 'text':
        return (
          <span key={index} className="text-foreground whitespace-pre-wrap">
            {String(chunk.data)}
          </span>
        )
      case 'tool_start': {
        const toolData = chunk.data as { name?: string }
        return (
          <div key={index} className="flex items-center gap-2 py-1">
            <ToolIndicator toolName={toolData.name || 'Tool'} />
          </div>
        )
      }
      case 'tool_result': {
        const resultData = chunk.data as { is_error?: boolean }
        return (
          <div
            key={index}
            className={cn(
              'text-xs py-0.5',
              resultData.is_error ? 'text-red-400' : 'text-green-400'
            )}
          >
            {resultData.is_error ? '✗ Tool failed' : '✓ Tool completed'}
          </div>
        )
      }
      case 'system':
        return (
          <div key={index} className="text-amber-400 text-xs py-0.5">
            [System] {String(chunk.data)}
          </div>
        )
      case 'error':
        return (
          <div key={index} className="text-red-400 text-xs py-0.5">
            [Error] {String(chunk.data)}
          </div>
        )
      case 'complete':
        return (
          <div key={index} className="text-green-400 text-xs py-1 border-t border-border mt-2">
            ✓ Agent completed
          </div>
        )
      default:
        return null
    }
  }

  return (
    <div
      className={cn(
        'flex flex-col bg-card border border-border rounded-lg overflow-hidden',
        'transition-all duration-200',
        isMaximized && 'col-span-full row-span-full',
        agent.status === 'running' && 'ring-1 ring-blue-500/50',
        agent.status === 'error' && 'ring-1 ring-red-500/50'
      )}
      onClick={onClick}
    >
      {/* Header */}
      <div className="px-3 py-2 border-b border-border flex items-center justify-between bg-muted/30">
        <div className="flex items-center gap-2 min-w-0">
          <Terminal className="h-4 w-4 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <h3 className="font-medium text-sm truncate">{agent.name}</h3>
            <p className="text-xs text-muted-foreground truncate">{agent.role}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <StatusBadge status={agent.status} />
          {agent.currentTool && <ToolIndicator toolName={agent.currentTool} />}
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={(e) => {
                e.stopPropagation()
                setIsMinimized(!isMinimized)
              }}
            >
              {isMinimized ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <Minimize2 className="h-3 w-3" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={(e) => {
                e.stopPropagation()
                onToggleMaximize()
              }}
            >
              <Maximize2 className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </div>

      {/* Terminal content */}
      {!isMinimized && (
        <div
          ref={containerRef}
          onScroll={handleScroll}
          className={cn(
            'flex-1 overflow-auto bg-black/50 font-mono text-xs p-2',
            isMaximized ? 'min-h-[400px]' : 'min-h-[150px] max-h-[300px]'
          )}
        >
          {agent.chunks.length === 0 ? (
            <div className="h-full flex items-center justify-center text-muted-foreground">
              {agent.status === 'idle' ? 'Waiting to start...' : 'No output yet'}
            </div>
          ) : (
            <div className="space-y-0">
              {agent.chunks.map((chunk, index) => renderChunk(chunk, index))}
            </div>
          )}
        </div>
      )}

      {/* Jump to bottom button */}
      {!isMinimized && !autoScroll && agent.chunks.length > 0 && (
        <div className="absolute bottom-2 right-2">
          <Button
            variant="secondary"
            size="sm"
            className="h-6 text-xs shadow-lg"
            onClick={(e) => {
              e.stopPropagation()
              if (containerRef.current) {
                containerRef.current.scrollTop = containerRef.current.scrollHeight
                setAutoScroll(true)
              }
            }}
          >
            <ChevronDown className="h-3 w-3 mr-1" />
            Latest
          </Button>
        </div>
      )}
    </div>
  )
}

export function AgentTerminalGrid({
  agents,
  maxChunksPerAgent = 500,
  onAgentClick,
  className
}: AgentTerminalGridProps) {
  const [maximizedAgent, setMaximizedAgent] = useState<string | null>(null)

  // Calculate grid columns based on agent count
  const gridCols = agents.length <= 1
    ? 'grid-cols-1'
    : agents.length === 2
      ? 'grid-cols-2'
      : agents.length <= 4
        ? 'grid-cols-2 lg:grid-cols-2'
        : 'grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'

  // Limit chunks per agent to prevent memory issues
  const limitedAgents = agents.map(agent => ({
    ...agent,
    chunks: agent.chunks.slice(-maxChunksPerAgent)
  }))

  // If an agent is maximized, only show that one
  if (maximizedAgent) {
    const agent = limitedAgents.find(a => a.id === maximizedAgent)
    if (agent) {
      return (
        <div className={cn('h-full', className)}>
          <AgentTerminalPane
            agent={agent}
            isMaximized={true}
            onToggleMaximize={() => setMaximizedAgent(null)}
            onClick={() => onAgentClick?.(agent.id)}
          />
        </div>
      )
    }
  }

  return (
    <div className={cn('h-full overflow-auto', className)}>
      <div className={cn('grid gap-3 p-3', gridCols)}>
        {limitedAgents.map(agent => (
          <AgentTerminalPane
            key={agent.id}
            agent={agent}
            isMaximized={false}
            onToggleMaximize={() => setMaximizedAgent(agent.id)}
            onClick={() => onAgentClick?.(agent.id)}
          />
        ))}
      </div>

      {agents.length === 0 && (
        <div className="h-full flex items-center justify-center text-muted-foreground">
          <div className="text-center">
            <Terminal className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>No agents running</p>
            <p className="text-xs mt-1">Start a workflow to see agent terminals</p>
          </div>
        </div>
      )}
    </div>
  )
}

export default AgentTerminalGrid

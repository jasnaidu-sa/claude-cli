/**
 * BVS Kanban Card - Rich detail section card for the Kanban board
 *
 * Displays:
 * - Worker color indicator
 * - Section name and status icon
 * - File count + elapsed time
 * - Animated progress bar
 * - Current step or dependency info
 */

import React from 'react'
import {
  Clock,
  FileCode,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Search,
  RotateCcw
} from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { Button } from '../ui/button'

// Worker color scheme from PRD
const WORKER_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  'worker-1': { bg: 'bg-blue-500/10', border: 'border-blue-500', text: 'text-blue-500' },
  'worker-2': { bg: 'bg-green-500/10', border: 'border-green-500', text: 'text-green-500' },
  'worker-3': { bg: 'bg-yellow-500/10', border: 'border-yellow-500', text: 'text-yellow-500' },
  'worker-4': { bg: 'bg-purple-500/10', border: 'border-purple-500', text: 'text-purple-500' },
  'worker-5': { bg: 'bg-orange-500/10', border: 'border-orange-500', text: 'text-orange-500' },
  'sequential': { bg: 'bg-gray-500/10', border: 'border-gray-500', text: 'text-gray-500' },
  'verifying': { bg: 'bg-cyan-500/10', border: 'border-cyan-500', text: 'text-cyan-500' },
  'error': { bg: 'bg-red-500/10', border: 'border-red-500', text: 'text-red-500' },
}

export interface BvsSectionData {
  id: string
  name: string
  description?: string
  status: 'pending' | 'in_progress' | 'verifying' | 'done' | 'failed'
  progress: number
  workerId?: string
  currentStep?: string
  currentFile?: string
  currentLine?: number
  files?: Array<{ path: string; status: string }>
  dependencies?: string[]
  dependents?: string[]
  elapsedSeconds?: number
  errorMessage?: string
  successCriteria?: Array<{ description: string; passed: boolean }>
  // Ralph Loop subtasks (RALPH-004, RALPH-006)
  subtasks?: Array<{
    id: string
    sectionId: string
    name: string
    description: string
    files: string[]
    status: 'pending' | 'in_progress' | 'done' | 'failed'
    agentSessionId?: string
    turnsUsed: number
    maxTurns: number
    metrics?: {
      turnsUsed: number
      tokensInput: number
      tokensOutput: number
      costUsd: number
      model: string
      filesChanged: number
      linesAdded: number
      linesRemoved: number
    }
    startedAt?: number
    completedAt?: number
    duration?: number
    commitSha?: string
    error?: string
    retryCount: number
  }>
}

interface BvsKanbanCardProps {
  section: BvsSectionData
  onClick?: () => void
  onRetry?: () => void
  isSelected?: boolean
}

function formatElapsedTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

export function BvsKanbanCard({ section, onClick, onRetry, isSelected }: BvsKanbanCardProps) {
  const getWorkerColor = () => {
    if (section.status === 'failed') return WORKER_COLORS['error']
    if (section.status === 'verifying') return WORKER_COLORS['verifying']
    if (section.workerId && WORKER_COLORS[section.workerId]) {
      return WORKER_COLORS[section.workerId]
    }
    return WORKER_COLORS['sequential']
  }

  const colors = getWorkerColor()
  const fileCount = section.files?.length || 0

  const getStatusIcon = () => {
    switch (section.status) {
      case 'pending':
        return <Clock className="h-4 w-4 text-gray-400" />
      case 'in_progress':
        return <Loader2 className={cn('h-4 w-4 animate-spin', colors.text)} />
      case 'verifying':
        return <Search className="h-4 w-4 text-cyan-500 animate-pulse" />
      case 'done':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />
      case 'failed':
        return <XCircle className="h-4 w-4 text-red-500" />
      default:
        return <AlertCircle className="h-4 w-4 text-gray-400" />
    }
  }

  const getStatusText = () => {
    switch (section.status) {
      case 'pending':
        if (section.dependencies && section.dependencies.length > 0) {
          return `Waiting for: ${section.dependencies[0]}`
        }
        return 'Pending'
      case 'in_progress':
        if (section.currentStep) {
          return section.currentStep
        }
        if (section.currentFile) {
          const fileName = section.currentFile.split('/').pop()
          return `Working on: ${fileName}${section.currentLine ? `:${section.currentLine}` : ''}`
        }
        return 'In progress...'
      case 'verifying':
        return section.currentStep || 'Running verification...'
      case 'done':
        return 'All checks passed'
      case 'failed':
        return section.errorMessage || 'Failed'
      default:
        return ''
    }
  }

  const getProgressBarColor = () => {
    switch (section.status) {
      case 'done':
        return 'bg-green-500'
      case 'failed':
        return 'bg-red-500'
      case 'verifying':
        return 'bg-cyan-500'
      case 'in_progress':
        return colors.text.replace('text-', 'bg-')
      default:
        return 'bg-gray-300'
    }
  }

  return (
    <div
      onClick={onClick}
      className={cn(
        'rounded-lg border-2 bg-card p-3 cursor-pointer transition-all duration-200',
        'hover:shadow-md hover:scale-[1.02]',
        isSelected && 'ring-2 ring-primary ring-offset-2',
        section.status === 'pending' && 'opacity-70 border-gray-200 dark:border-gray-700',
        section.status === 'in_progress' && cn(colors.border, 'shadow-sm'),
        section.status === 'verifying' && 'border-cyan-500 animate-pulse',
        section.status === 'done' && 'border-green-500/50',
        section.status === 'failed' && 'border-red-500 bg-red-50/50 dark:bg-red-900/20'
      )}
    >
      {/* Header: Status Icon + Name */}
      <div className="flex items-center gap-2 mb-2">
        {getStatusIcon()}
        <span className="font-medium text-sm truncate flex-1">{section.name}</span>
        {section.status === 'failed' && onRetry && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={(e) => {
              e.stopPropagation()
              onRetry()
            }}
          >
            <RotateCcw className="h-3 w-3 mr-1" />
            Retry
          </Button>
        )}
      </div>

      {/* Meta: File count + Elapsed time */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground mb-2">
        <span className="flex items-center gap-1">
          <FileCode className="h-3 w-3" />
          {fileCount} file{fileCount !== 1 ? 's' : ''}
        </span>
        {section.elapsedSeconds !== undefined && section.elapsedSeconds > 0 && (
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {formatElapsedTime(section.elapsedSeconds)}
          </span>
        )}
      </div>

      {/* Progress Bar */}
      <div className="mb-2">
        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-300',
              getProgressBarColor(),
              section.status === 'verifying' && 'animate-pulse'
            )}
            style={{ width: `${section.progress}%` }}
          />
        </div>
        <div className="flex justify-between items-center mt-1">
          <span className="text-[10px] text-muted-foreground">
            {section.progress}%
          </span>
          {section.workerId && section.status === 'in_progress' && (
            <span className={cn('text-[10px] font-medium', colors.text)}>
              {section.workerId.replace('worker-', 'W')}
            </span>
          )}
        </div>
      </div>

      {/* Current Step / Status Text */}
      <div className="text-xs text-muted-foreground truncate">
        {section.status === 'in_progress' && (
          <span className="flex items-center gap-1">
            <span className={cn('inline-block w-1.5 h-1.5 rounded-full animate-pulse', colors.text.replace('text-', 'bg-'))} />
            {getStatusText()}
          </span>
        )}
        {section.status === 'verifying' && (
          <span className="flex items-center gap-1 text-cyan-600">
            <Search className="h-3 w-3" />
            {getStatusText()}
          </span>
        )}
        {section.status === 'pending' && (
          <span className="text-gray-400">{getStatusText()}</span>
        )}
        {section.status === 'done' && (
          <span className="text-green-600 flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3" />
            {getStatusText()}
          </span>
        )}
        {section.status === 'failed' && (
          <span className="text-red-600 truncate">{getStatusText()}</span>
        )}
      </div>
    </div>
  )
}

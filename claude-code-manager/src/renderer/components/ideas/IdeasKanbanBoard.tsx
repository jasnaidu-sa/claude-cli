/**
 * IdeasKanbanBoard Component
 *
 * Visual Kanban board for project ideas from email.
 * Shows ideas in 4 columns: Inbox, Review, Approved, In Progress
 * (Completed and Declined ideas are shown in a separate archive view)
 *
 * Features:
 * - Drag and drop between stages (with validation)
 * - Click to view/edit idea details
 * - Stage transition triggers review modal when moving to Review
 */

import React, { useMemo } from 'react'

/**
 * Format date as dd/mm/yyyy
 */
function formatDate(timestamp: number): string {
  const date = new Date(timestamp)
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const year = date.getFullYear()
  return `${day}/${month}/${year}`
}
import {
  Inbox,
  Clock,
  MessageSquare,
  CheckCircle2,
  PlayCircle,
  Archive,
  Mail,
  Tag,
  AlertCircle,
  Lightbulb,
  Building2,
  Sparkles,
  Trash2,
  RefreshCw,
  FolderOpen,
  X
} from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import type { Idea, IdeaStage } from '@shared/types'

interface IdeasKanbanBoardProps {
  ideas: Idea[]
  onIdeaClick: (idea: Idea) => void
  onMoveStage: (ideaId: string, newStage: IdeaStage) => void
  onDelete?: (ideaId: string) => void
  onRetry?: (ideaId: string) => void
  onError?: (message: string) => void
  className?: string
}

// Valid stage transitions (must match backend)
const VALID_TRANSITIONS: Record<IdeaStage, IdeaStage[]> = {
  inbox: ['review', 'declined'],
  review: ['approved', 'declined'],
  approved: ['in_progress', 'review'],
  in_progress: ['completed', 'approved'],
  completed: [],
  declined: ['inbox', 'review']
}

function isValidTransition(fromStage: IdeaStage, toStage: IdeaStage): boolean {
  return VALID_TRANSITIONS[fromStage]?.includes(toStage) ?? false
}

function getTransitionError(fromStage: IdeaStage, toStage: IdeaStage): string {
  const allowed = VALID_TRANSITIONS[fromStage]
  if (allowed.length === 0) {
    return `Items in "${STAGE_CONFIG[fromStage].title}" cannot be moved`
  }
  return `Cannot move from "${STAGE_CONFIG[fromStage].title}" to "${STAGE_CONFIG[toStage].title}". Allowed: ${allowed.map(s => STAGE_CONFIG[s].title).join(', ')}`
}

// Stage configuration
const STAGE_CONFIG: Record<IdeaStage, {
  title: string
  icon: React.ReactNode
  color: string
  bgColor: string
  description: string
}> = {
  inbox: {
    title: 'Inbox',
    icon: <Inbox className="h-4 w-4" />,
    color: 'text-gray-400',
    bgColor: 'bg-gray-500/10 border-gray-500/20',
    description: 'New ideas from email'
  },
  review: {
    title: 'Review',
    icon: <MessageSquare className="h-4 w-4" />,
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/10 border-blue-500/20',
    description: 'In active discussion'
  },
  approved: {
    title: 'Approved',
    icon: <CheckCircle2 className="h-4 w-4" />,
    color: 'text-green-400',
    bgColor: 'bg-green-500/10 border-green-500/20',
    description: 'Ready to start'
  },
  in_progress: {
    title: 'In Progress',
    icon: <PlayCircle className="h-4 w-4" />,
    color: 'text-purple-400',
    bgColor: 'bg-purple-500/10 border-purple-500/20',
    description: 'Project started'
  },
  completed: {
    title: 'Completed',
    icon: <Archive className="h-4 w-4" />,
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-500/10 border-emerald-500/20',
    description: 'Project finished'
  },
  declined: {
    title: 'Declined',
    icon: <X className="h-4 w-4" />,
    color: 'text-red-400',
    bgColor: 'bg-red-500/10 border-red-500/20',
    description: 'Not pursuing'
  }
}

// Visible columns (excluding completed which is in archive)
const VISIBLE_STAGES: IdeaStage[] = ['inbox', 'review', 'approved', 'in_progress', 'declined']

function getPriorityColor(priority?: 'low' | 'medium' | 'high' | 'urgent'): string {
  switch (priority) {
    case 'urgent':
      return 'bg-red-500/20 text-red-400 border-red-500/30'
    case 'high':
      return 'bg-orange-500/20 text-orange-400 border-orange-500/30'
    case 'medium':
      return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
    case 'low':
    default:
      return 'bg-gray-500/20 text-gray-400 border-gray-500/30'
  }
}

function getProjectTypeIcon(projectType: 'greenfield' | 'brownfield' | 'undetermined') {
  switch (projectType) {
    case 'greenfield':
      return <span title="Greenfield - New Project"><Sparkles className="h-3 w-3 text-green-400" /></span>
    case 'brownfield':
      return <span title="Brownfield - Existing Project"><Building2 className="h-3 w-3 text-amber-400" /></span>
    default:
      return <span title="Type not determined"><Lightbulb className="h-3 w-3 text-gray-400" /></span>
  }
}

function IdeaCard({
  idea,
  onClick,
  onDragStart,
  onDelete,
  onRetry
}: {
  idea: Idea
  onClick: () => void
  onDragStart: (e: React.DragEvent) => void
  onDelete?: () => void
  onRetry?: () => void
}) {
  const stageConfig = STAGE_CONFIG[idea.stage]
  const [isRetrying, setIsRetrying] = React.useState(false)

  // Check if this idea needs retry (untitled or no summaries)
  const needsRetry = idea.title === 'Untitled Idea' ||
    (idea.extractedUrls && idea.extractedUrls.length > 0 && !idea.extractedUrls.some(u => u.summary))

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation() // Prevent card click
    if (onDelete && window.confirm('Are you sure you want to delete this idea?')) {
      onDelete()
    }
  }

  const handleRetry = (e: React.MouseEvent) => {
    e.stopPropagation() // Prevent card click
    e.preventDefault()  // Prevent default behavior
    console.log('[IdeaCard] Retry clicked for idea:', idea.id)
    if (onRetry && !isRetrying) {
      setIsRetrying(true)
      onRetry()
      // Reset after a delay (the actual refresh will update the card)
      setTimeout(() => setIsRetrying(false), 10000)
    }
  }

  return (
    <div
      draggable={!isRetrying}
      onDragStart={onDragStart}
      onClick={isRetrying ? undefined : onClick}
      className={cn(
        'p-3 rounded-lg border bg-card transition-all hover:shadow-md cursor-pointer group relative',
        'hover:border-primary/30 active:scale-[0.98]',
        stageConfig.bgColor,
        needsRetry && 'border-amber-500/30',
        isRetrying && 'opacity-70 pointer-events-none'
      )}
    >
      {/* Loading overlay when retrying */}
      {isRetrying && (
        <div className="absolute inset-0 bg-background/50 rounded-lg flex items-center justify-center z-10">
          <div className="flex items-center gap-2 text-amber-400 text-xs font-medium">
            <RefreshCw className="h-4 w-4 animate-spin" />
            <span>Retrying...</span>
          </div>
        </div>
      )}
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <div className={cn(
            "font-semibold text-sm truncate",
            needsRetry && "text-amber-400"
          )} title={idea.title}>
            {idea.title}
          </div>
          <div className="flex items-center gap-2 mt-1">
            {/* Project type indicator */}
            {getProjectTypeIcon(idea.projectType)}

            {/* Project name badge (replaces priority) */}
            <span className={cn(
              'text-[10px] px-1.5 py-0.5 rounded border font-medium truncate max-w-[120px]',
              (idea.projectName || idea.associatedProjectName)
                ? 'bg-primary/20 text-primary border-primary/30'
                : 'bg-gray-500/20 text-gray-400 border-gray-500/30'
            )} title={idea.projectName || idea.associatedProjectName || 'No Project'}>
              {idea.projectName || idea.associatedProjectName || 'No Project'}
            </span>

            {/* Needs retry indicator */}
            {needsRetry && (
              <span className="text-[10px] px-1.5 py-0.5 rounded border font-medium bg-amber-500/20 text-amber-400 border-amber-500/30">
                RETRY
              </span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Retry button - visible for ideas that need retry */}
          {needsRetry && onRetry && (
            <button
              onClick={handleRetry}
              onMouseDown={(e) => e.stopPropagation()}
              disabled={isRetrying}
              className={cn(
                "p-1 rounded hover:bg-amber-500/20 hover:text-amber-400 transition-all",
                isRetrying ? "opacity-50 cursor-not-allowed" : ""
              )}
              title="Retry extracting title and summary"
            >
              <RefreshCw className={cn("h-3 w-3", isRetrying && "animate-spin")} />
            </button>
          )}
          {/* Delete button - visible on hover */}
          {onDelete && (
            <button
              onClick={handleDelete}
              className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-red-500/20 hover:text-red-500 transition-all"
              title="Delete idea"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
          {/* Email source indicator */}
          <span title={idea.emailSource.from}><Mail className="h-3 w-3 text-muted-foreground" /></span>
        </div>
      </div>

      {/* Description preview */}
      {idea.description && (
        <div className="text-xs text-muted-foreground line-clamp-2 mb-2">
          {idea.description.substring(0, 150)}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between">
        {/* Tags */}
        {idea.tags && idea.tags.length > 0 && (
          <div className="flex items-center gap-1">
            <Tag className="h-3 w-3 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">
              {idea.tags.slice(0, 2).join(', ')}
              {idea.tags.length > 2 && ` +${idea.tags.length - 2}`}
            </span>
          </div>
        )}

        {/* Discussion count with last amended date */}
        {idea.discussionMessages && idea.discussionMessages.length > 0 && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground" title={`Last message: ${new Date(Math.max(...idea.discussionMessages.map(m => m.timestamp))).toLocaleString()}`}>
            <MessageSquare className="h-3 w-3" />
            {idea.discussionMessages.length}
            <span className="text-[10px] opacity-70">
              ({formatDate(Math.max(...idea.discussionMessages.map(m => m.timestamp)))})
            </span>
          </div>
        )}

        {/* Date - show email received date if available, otherwise created date */}
        <span className="text-[10px] text-muted-foreground" title={`Received: ${new Date(idea.emailSource?.receivedAt || idea.createdAt).toLocaleString()}`}>
          {formatDate(idea.emailSource?.receivedAt || idea.createdAt)}
        </span>
      </div>
    </div>
  )
}

function KanbanColumn({
  stage,
  ideas,
  onIdeaClick,
  onDrop,
  onDelete,
  onRetry,
  onError
}: {
  stage: IdeaStage
  ideas: Idea[]
  onIdeaClick: (idea: Idea) => void
  onDrop: (ideaId: string, fromStage: IdeaStage) => void
  onDelete?: (ideaId: string) => void
  onRetry?: (ideaId: string) => void
  onError?: (message: string) => void
}) {
  const config = STAGE_CONFIG[stage]
  const [isDragOver, setIsDragOver] = React.useState(false)
  const [isInvalidDrop, setIsInvalidDrop] = React.useState(false)

  // Group ideas by project
  const ideasByProject = useMemo(() => {
    const grouped: Record<string, Idea[]> = {}

    for (const idea of ideas) {
      const projectName = idea.projectName || idea.associatedProjectName || 'No Project'
      if (!grouped[projectName]) {
        grouped[projectName] = []
      }
      grouped[projectName].push(idea)
    }

    // Sort ideas within each project by email received date descending (newest first)
    for (const projectName of Object.keys(grouped)) {
      grouped[projectName].sort((a, b) => {
        const dateA = a.emailSource?.receivedAt || a.createdAt
        const dateB = b.emailSource?.receivedAt || b.createdAt
        return dateB - dateA
      })
    }

    return grouped
  }, [ideas])

  // Get sorted project names (alphabetically, with "No Project" last)
  const sortedProjectNames = useMemo(() => {
    const names = Object.keys(ideasByProject)
    return names.sort((a, b) => {
      if (a === 'No Project') return 1
      if (b === 'No Project') return -1
      return a.localeCompare(b)
    })
  }, [ideasByProject])

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    const fromStage = e.dataTransfer.types.includes('fromstage')
      ? e.dataTransfer.getData('fromStage') as IdeaStage
      : null

    // Check if this would be a valid transition
    if (fromStage && fromStage !== stage && !isValidTransition(fromStage, stage)) {
      setIsInvalidDrop(true)
      setIsDragOver(false)
    } else {
      setIsInvalidDrop(false)
      setIsDragOver(true)
    }
  }

  const handleDragLeave = () => {
    setIsDragOver(false)
    setIsInvalidDrop(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    setIsInvalidDrop(false)

    const ideaId = e.dataTransfer.getData('ideaId')
    const fromStage = e.dataTransfer.getData('fromStage') as IdeaStage

    if (!ideaId || !fromStage) return

    // Same stage - no action needed
    if (fromStage === stage) return

    // Validate transition
    if (!isValidTransition(fromStage, stage)) {
      const errorMessage = getTransitionError(fromStage, stage)
      onError?.(errorMessage)
      return
    }

    onDrop(ideaId, fromStage)
  }

  return (
    <div
      className={cn(
        'flex flex-col h-full border rounded-lg overflow-hidden bg-card transition-all',
        isDragOver && 'ring-2 ring-primary/50 border-primary/30',
        isInvalidDrop && 'ring-2 ring-red-500/50 border-red-500/30 bg-red-500/5'
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Column Header */}
      <div className={cn(
        'px-3 py-2 border-b border-border bg-muted/30 flex items-center justify-between shrink-0',
        config.bgColor
      )}>
        <div className="flex items-center gap-2">
          <span className={config.color}>{config.icon}</span>
          <span className="font-semibold text-sm">{config.title}</span>
        </div>
        <span className="text-xs text-muted-foreground bg-background px-2 py-0.5 rounded-full">
          {ideas.length}
        </span>
      </div>

      {/* Column description */}
      <div className="px-3 py-1 text-xs text-muted-foreground border-b border-border/50 bg-muted/10">
        {config.description}
      </div>

      {/* Column Content - Grouped by Project */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {ideas.length === 0 ? (
          <div className="text-xs text-muted-foreground text-center py-8 opacity-50">
            Drop ideas here
          </div>
        ) : (
          sortedProjectNames.map((projectName) => (
            <div key={projectName} className="space-y-2">
              {/* Project Header */}
              <div className={cn(
                'flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium sticky top-0 z-10',
                projectName === 'No Project'
                  ? 'bg-gray-500/20 text-gray-400'
                  : 'bg-primary/20 text-primary'
              )}>
                <FolderOpen className="h-3 w-3" />
                <span className="truncate">{projectName}</span>
                <span className="ml-auto text-[10px] opacity-70">
                  {ideasByProject[projectName].length}
                </span>
              </div>

              {/* Ideas in this project */}
              <div className="space-y-2 pl-1">
                {ideasByProject[projectName].map((idea) => (
                  <IdeaCard
                    key={idea.id}
                    idea={idea}
                    onClick={() => onIdeaClick(idea)}
                    onDragStart={(e) => {
                      e.dataTransfer.setData('ideaId', idea.id)
                      e.dataTransfer.setData('fromStage', idea.stage)
                    }}
                    onDelete={onDelete ? () => onDelete(idea.id) : undefined}
                    onRetry={onRetry ? () => onRetry(idea.id) : undefined}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export function IdeasKanbanBoard({
  ideas,
  onIdeaClick,
  onMoveStage,
  onDelete,
  onRetry,
  onError,
  className
}: IdeasKanbanBoardProps) {
  // Organize ideas by stage
  const ideasByStage = useMemo(() => {
    const grouped: Record<IdeaStage, Idea[]> = {
      inbox: [],
      review: [],
      approved: [],
      in_progress: [],
      completed: [],
      declined: []
    }

    for (const idea of ideas) {
      grouped[idea.stage].push(idea)
    }

    return grouped
  }, [ideas])

  const handleDrop = (targetStage: IdeaStage) => (ideaId: string, _fromStage: IdeaStage) => {
    // Validation already done in KanbanColumn, just call the move
    onMoveStage(ideaId, targetStage)
  }

  return (
    <div className={cn('grid grid-cols-5 gap-3 h-full', className)}>
      {VISIBLE_STAGES.map((stage) => (
        <KanbanColumn
          key={stage}
          stage={stage}
          ideas={ideasByStage[stage]}
          onIdeaClick={onIdeaClick}
          onDrop={handleDrop(stage)}
          onDelete={onDelete}
          onRetry={onRetry}
          onError={onError}
        />
      ))}
    </div>
  )
}

/**
 * IdeasKanbanBoard Component
 *
 * Visual Kanban board for project ideas from email.
 * Shows ideas in 5 columns: Inbox, Pending, Review, Approved, In Progress
 * (Completed ideas are shown in a separate archive view)
 *
 * Features:
 * - Drag and drop between stages (with validation)
 * - Click to view/edit idea details
 * - Stage transition triggers review modal when moving to Review
 */

import React, { useMemo } from 'react'
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
  Sparkles
} from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import type { Idea, IdeaStage } from '@shared/types'

interface IdeasKanbanBoardProps {
  ideas: Idea[]
  onIdeaClick: (idea: Idea) => void
  onMoveStage: (ideaId: string, newStage: IdeaStage) => void
  className?: string
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
  pending: {
    title: 'Pending',
    icon: <Clock className="h-4 w-4" />,
    color: 'text-yellow-400',
    bgColor: 'bg-yellow-500/10 border-yellow-500/20',
    description: 'Waiting to be reviewed'
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
  }
}

// Visible columns (excluding completed which is in archive)
const VISIBLE_STAGES: IdeaStage[] = ['inbox', 'pending', 'review', 'approved', 'in_progress']

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
      return <Sparkles className="h-3 w-3 text-green-400" title="Greenfield - New Project" />
    case 'brownfield':
      return <Building2 className="h-3 w-3 text-amber-400" title="Brownfield - Existing Project" />
    default:
      return <Lightbulb className="h-3 w-3 text-gray-400" title="Type not determined" />
  }
}

function IdeaCard({
  idea,
  onClick,
  onDragStart
}: {
  idea: Idea
  onClick: () => void
  onDragStart: (e: React.DragEvent) => void
}) {
  const stageConfig = STAGE_CONFIG[idea.stage]

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      className={cn(
        'p-3 rounded-lg border bg-card transition-all hover:shadow-md cursor-pointer',
        'hover:border-primary/30 active:scale-[0.98]',
        stageConfig.bgColor
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm truncate" title={idea.title}>
            {idea.title}
          </div>
          <div className="flex items-center gap-2 mt-1">
            {/* Project type indicator */}
            {getProjectTypeIcon(idea.projectType)}

            {/* Priority badge */}
            {idea.priority && (
              <span className={cn(
                'text-[10px] px-1.5 py-0.5 rounded border font-medium uppercase',
                getPriorityColor(idea.priority)
              )}>
                {idea.priority}
              </span>
            )}
          </div>
        </div>

        {/* Email source indicator */}
        <Mail className="h-3 w-3 text-muted-foreground shrink-0" title={idea.emailSource.from} />
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

        {/* Discussion count */}
        {idea.discussionMessages && idea.discussionMessages.length > 0 && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <MessageSquare className="h-3 w-3" />
            {idea.discussionMessages.length}
          </div>
        )}

        {/* Date */}
        <span className="text-[10px] text-muted-foreground">
          {new Date(idea.createdAt).toLocaleDateString()}
        </span>
      </div>
    </div>
  )
}

function KanbanColumn({
  stage,
  ideas,
  onIdeaClick,
  onDrop
}: {
  stage: IdeaStage
  ideas: Idea[]
  onIdeaClick: (idea: Idea) => void
  onDrop: (ideaId: string) => void
}) {
  const config = STAGE_CONFIG[stage]
  const [isDragOver, setIsDragOver] = React.useState(false)

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }

  const handleDragLeave = () => {
    setIsDragOver(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    const ideaId = e.dataTransfer.getData('ideaId')
    if (ideaId) {
      onDrop(ideaId)
    }
  }

  return (
    <div
      className={cn(
        'flex flex-col h-full border rounded-lg overflow-hidden bg-card transition-all',
        isDragOver && 'ring-2 ring-primary/50 border-primary/30'
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

      {/* Column Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {ideas.length === 0 ? (
          <div className="text-xs text-muted-foreground text-center py-8 opacity-50">
            Drop ideas here
          </div>
        ) : (
          ideas.map((idea) => (
            <IdeaCard
              key={idea.id}
              idea={idea}
              onClick={() => onIdeaClick(idea)}
              onDragStart={(e) => {
                e.dataTransfer.setData('ideaId', idea.id)
                e.dataTransfer.setData('fromStage', idea.stage)
              }}
            />
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
  className
}: IdeasKanbanBoardProps) {
  // Organize ideas by stage
  const ideasByStage = useMemo(() => {
    const grouped: Record<IdeaStage, Idea[]> = {
      inbox: [],
      pending: [],
      review: [],
      approved: [],
      in_progress: [],
      completed: []
    }

    for (const idea of ideas) {
      grouped[idea.stage].push(idea)
    }

    // Sort each group by updatedAt descending
    for (const stage of Object.keys(grouped) as IdeaStage[]) {
      grouped[stage].sort((a, b) => b.updatedAt - a.updatedAt)
    }

    return grouped
  }, [ideas])

  const handleDrop = (targetStage: IdeaStage) => (ideaId: string) => {
    const idea = ideas.find((i) => i.id === ideaId)
    if (idea && idea.stage !== targetStage) {
      onMoveStage(ideaId, targetStage)
    }
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
        />
      ))}
    </div>
  )
}

/**
 * BVS Project List - Shows all projects for a selected codebase
 *
 * Displays:
 * - Project name, status, progress
 * - Quick actions based on status
 * - New project button
 */

import React, { useState, useEffect } from 'react'
import {
  FolderKanban,
  Play,
  Pause,
  CheckCircle2,
  XCircle,
  Clock,
  ChevronRight,
  Plus,
  Trash2,
  RefreshCw,
  MessageSquare,
  Loader2,
  AlertCircle
} from 'lucide-react'
import { Button } from '../ui/button'
import { cn } from '@renderer/lib/utils'
import type { BvsProjectItem, BvsProjectStatus } from '@preload/index'

interface BvsProjectListProps {
  projectPath: string
  onSelectProject: (project: BvsProjectItem) => void
  onNewProject: () => void
  onBack: () => void
}

// Status configuration for UI display
const STATUS_CONFIG: Record<BvsProjectStatus, {
  label: string
  icon: React.ComponentType<{ className?: string }>
  bgColor: string
  textColor: string
}> = {
  planning: {
    label: 'Planning',
    icon: MessageSquare,
    bgColor: 'bg-blue-500/10',
    textColor: 'text-blue-500'
  },
  ready: {
    label: 'Ready to Execute',
    icon: Play,
    bgColor: 'bg-green-500/10',
    textColor: 'text-green-500'
  },
  in_progress: {
    label: 'In Progress',
    icon: RefreshCw,
    bgColor: 'bg-yellow-500/10',
    textColor: 'text-yellow-500'
  },
  paused: {
    label: 'Paused',
    icon: Pause,
    bgColor: 'bg-orange-500/10',
    textColor: 'text-orange-500'
  },
  completed: {
    label: 'Completed',
    icon: CheckCircle2,
    bgColor: 'bg-emerald-500/10',
    textColor: 'text-emerald-500'
  },
  cancelled: {
    label: 'Cancelled',
    icon: XCircle,
    bgColor: 'bg-red-500/10',
    textColor: 'text-red-500'
  }
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) return `${days}d ago`
  if (hours > 0) return `${hours}h ago`
  if (minutes > 0) return `${minutes}m ago`
  return 'Just now'
}

export function BvsProjectList({
  projectPath,
  onSelectProject,
  onNewProject,
  onBack
}: BvsProjectListProps) {
  const [projects, setProjects] = useState<BvsProjectItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // Load projects on mount
  useEffect(() => {
    loadProjects()
  }, [projectPath])

  const loadProjects = async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.electron.bvsPlanning.listProjects(projectPath)
      if (result.success && result.projects) {
        // Sort by updatedAt desc
        const sorted = [...result.projects].sort((a, b) => b.updatedAt - a.updatedAt)
        setProjects(sorted)
      } else {
        setError(result.error || 'Failed to load projects')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (project: BvsProjectItem, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm(`Delete project "${project.name}"? This cannot be undone.`)) {
      return
    }

    setDeletingId(project.id)
    try {
      const result = await window.electron.bvsPlanning.deleteProject(projectPath, project.id, false)
      if (result.success) {
        setProjects(prev => prev.filter(p => p.id !== project.id))
      } else {
        alert(result.error || 'Failed to delete project')
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setDeletingId(null)
    }
  }

  // Group projects by status
  const activeProjects = projects.filter(p =>
    p.status === 'planning' || p.status === 'ready' || p.status === 'in_progress' || p.status === 'paused'
  )
  const completedProjects = projects.filter(p =>
    p.status === 'completed' || p.status === 'cancelled'
  )

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin mb-4" />
        <p>Loading projects...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
        <AlertCircle className="h-8 w-8 text-red-500 mb-4" />
        <p className="text-red-500 mb-4">{error}</p>
        <Button variant="outline" onClick={loadProjects}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Retry
        </Button>
      </div>
    )
  }

  const renderProjectCard = (project: BvsProjectItem) => {
    const config = STATUS_CONFIG[project.status]
    const StatusIcon = config.icon
    const progress = project.sectionsTotal > 0
      ? Math.round((project.sectionsCompleted / project.sectionsTotal) * 100)
      : 0
    const isDeleting = deletingId === project.id

    return (
      <button
        key={project.id}
        onClick={() => onSelectProject(project)}
        disabled={isDeleting}
        className={cn(
          'w-full flex items-center gap-4 p-4 rounded-lg border border-border',
          'hover:border-primary/50 hover:bg-accent/50 transition-colors text-left',
          'focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2',
          isDeleting && 'opacity-50 cursor-not-allowed'
        )}
      >
        {/* Status Icon */}
        <div className={cn('p-2 rounded-lg', config.bgColor)}>
          <StatusIcon className={cn('h-5 w-5', config.textColor)} />
        </div>

        {/* Project Info */}
        <div className="flex-1 min-w-0">
          <h3 className="font-medium truncate">{project.name}</h3>
          <p className="text-xs text-muted-foreground/70 truncate font-mono">
            {project.id}
          </p>
          <p className="text-sm text-muted-foreground truncate">
            {project.description || 'No description'}
          </p>
          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
            <span className={cn('px-1.5 py-0.5 rounded', config.bgColor, config.textColor)}>
              {config.label}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatRelativeTime(project.updatedAt)}
            </span>
          </div>
        </div>

        {/* Progress */}
        {project.sectionsTotal > 0 && (
          <div className="text-right">
            <div className="text-sm font-medium">
              {project.sectionsCompleted}/{project.sectionsTotal}
            </div>
            <div className="w-24 h-1.5 bg-muted rounded-full overflow-hidden mt-1">
              <div
                className={cn(
                  'h-full transition-all',
                  project.sectionsFailed > 0 ? 'bg-red-500' : 'bg-primary'
                )}
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {progress}% complete
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={(e) => handleDelete(project, e)}
            className="p-1.5 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-500 transition-colors"
            title="Delete project"
          >
            {isDeleting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
          </button>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </div>
      </button>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header with New Project button */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">BVS Projects</h2>
          <p className="text-sm text-muted-foreground">
            {projects.length} project{projects.length !== 1 ? 's' : ''} in this codebase
          </p>
        </div>
        <Button onClick={onNewProject}>
          <Plus className="h-4 w-4 mr-2" />
          New Project
        </Button>
      </div>

      {/* Active Projects */}
      {activeProjects.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Active Projects
          </h3>
          <div className="space-y-2">
            {activeProjects.map(renderProjectCard)}
          </div>
        </div>
      )}

      {/* Completed Projects */}
      {completedProjects.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Completed
          </h3>
          <div className="space-y-2">
            {completedProjects.map(renderProjectCard)}
          </div>
        </div>
      )}

      {/* Empty State */}
      {projects.length === 0 && (
        <div className="text-center py-12 border border-dashed border-border rounded-lg">
          <FolderKanban className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
          <h3 className="font-medium mb-2">No projects yet</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Create your first BVS project to get started
          </p>
          <Button onClick={onNewProject}>
            <Plus className="h-4 w-4 mr-2" />
            Create Project
          </Button>
        </div>
      )}
    </div>
  )
}

export default BvsProjectList

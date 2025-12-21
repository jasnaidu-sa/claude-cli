/**
 * WorkflowHistory Component
 *
 * Full-screen modal showing all historical workflows across all projects.
 * Features filtering, sorting, pagination, and archive functionality.
 */

import React, { useState, useMemo } from 'react'
import { X, Search, Filter, Archive as ArchiveIcon, ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '../ui/button'
import { WorkflowHistoryCard } from './WorkflowHistoryCard'
import { useAutonomousStore } from '@renderer/stores/autonomous-store'
import { cn } from '@renderer/lib/utils'
import type { WorkflowConfig, WorkflowStatus } from '@shared/types'

interface WorkflowHistoryProps {
  onClose: () => void
  onSelectWorkflow: (workflow: WorkflowConfig, viewMode: 'view' | 'resume') => void
}

type FilterStatus = 'all' | WorkflowStatus
type SortOption = 'recent' | 'created' | 'project' | 'status'

const ITEMS_PER_PAGE = 20

export function WorkflowHistory({ onClose, onSelectWorkflow }: WorkflowHistoryProps) {
  const { workflows } = useAutonomousStore()

  // State
  const [searchQuery, setSearchQuery] = useState('')
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all')
  const [sortBy, setSortBy] = useState<SortOption>('recent')
  const [showArchived, setShowArchived] = useState(false)
  const [archivedWorkflows, setArchivedWorkflows] = useState<Set<string>>(new Set())
  const [currentPage, setCurrentPage] = useState(1)

  // Filter and sort workflows
  const filteredWorkflows = useMemo(() => {
    let filtered = workflows.filter(w => {
      // Filter archived
      if (!showArchived && archivedWorkflows.has(w.id)) return false

      // Filter by status
      if (filterStatus !== 'all' && w.status !== filterStatus) return false

      // Filter by search query
      if (searchQuery) {
        const query = searchQuery.toLowerCase()
        const projectName = w.projectPath.split(/[/\\]/).pop()?.toLowerCase() || ''
        const workflowName = w.name.toLowerCase()
        if (!workflowName.includes(query) && !projectName.includes(query)) {
          return false
        }
      }

      return true
    })

    // Sort
    switch (sortBy) {
      case 'recent':
        filtered.sort((a, b) => {
          const aTime = a.completedAt || a.updatedAt || a.createdAt
          const bTime = b.completedAt || b.updatedAt || b.createdAt
          return bTime - aTime
        })
        break
      case 'created':
        filtered.sort((a, b) => b.createdAt - a.createdAt)
        break
      case 'project':
        filtered.sort((a, b) => {
          const aProject = a.projectPath.split(/[/\\]/).pop() || ''
          const bProject = b.projectPath.split(/[/\\]/).pop() || ''
          return aProject.localeCompare(bProject)
        })
        break
      case 'status':
        const statusOrder: Record<WorkflowStatus, number> = {
          implementing: 1,
          generating: 2,
          paused: 3,
          error: 4,
          completed: 5,
          validating: 6,
          pending: 7
        }
        filtered.sort((a, b) => statusOrder[a.status] - statusOrder[b.status])
        break
    }

    return filtered
  }, [workflows, searchQuery, filterStatus, sortBy, showArchived, archivedWorkflows])

  // Pagination
  const totalPages = Math.ceil(filteredWorkflows.length / ITEMS_PER_PAGE)
  const paginatedWorkflows = filteredWorkflows.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  )

  // Reset page when filters change
  React.useEffect(() => {
    setCurrentPage(1)
  }, [searchQuery, filterStatus, sortBy, showArchived])

  // Handlers
  const handleViewResults = (workflow: WorkflowConfig) => {
    onSelectWorkflow(workflow, 'view')
  }

  const handleResume = (workflow: WorkflowConfig) => {
    onSelectWorkflow(workflow, 'resume')
  }

  const handleArchive = (workflow: WorkflowConfig) => {
    setArchivedWorkflows(prev => {
      const next = new Set(prev)
      if (next.has(workflow.id)) {
        next.delete(workflow.id)
      } else {
        next.add(workflow.id)
      }
      return next
    })
  }

  // Get status counts
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {
      all: workflows.filter(w => !archivedWorkflows.has(w.id)).length,
      completed: 0,
      paused: 0,
      error: 0,
      implementing: 0,
      generating: 0
    }

    workflows.forEach(w => {
      if (archivedWorkflows.has(w.id)) return
      if (counts[w.status] !== undefined) {
        counts[w.status]++
      }
    })

    return counts
  }, [workflows, archivedWorkflows])

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-background border border-border rounded-lg shadow-lg w-full max-w-5xl h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-border flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-xl font-semibold">Workflow History</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              {filteredWorkflows.length} workflow{filteredWorkflows.length !== 1 ? 's' : ''}
              {searchQuery && ' matching search'}
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Filters */}
        <div className="px-6 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-3 flex-wrap">
            {/* Search */}
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search workflows or projects..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-sm bg-secondary border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            {/* Status Filter */}
            <select
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value as FilterStatus)}
              className="px-3 py-1.5 text-sm bg-secondary border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="all">All Status ({statusCounts.all})</option>
              <option value="completed">Completed ({statusCounts.completed})</option>
              <option value="implementing">In Progress ({statusCounts.implementing + statusCounts.generating})</option>
              <option value="paused">Paused ({statusCounts.paused})</option>
              <option value="error">Error ({statusCounts.error})</option>
            </select>

            {/* Sort */}
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value as SortOption)}
              className="px-3 py-1.5 text-sm bg-secondary border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="recent">Recent Activity</option>
              <option value="created">Created Date</option>
              <option value="project">Project Name</option>
              <option value="status">Status</option>
            </select>

            {/* Show Archived Toggle */}
            <Button
              variant={showArchived ? 'default' : 'outline'}
              size="sm"
              onClick={() => setShowArchived(!showArchived)}
              className="gap-1.5"
            >
              <ArchiveIcon className="h-3.5 w-3.5" />
              Archived ({archivedWorkflows.size})
            </Button>
          </div>
        </div>

        {/* Workflow List */}
        <div className="flex-1 overflow-y-auto p-6">
          {paginatedWorkflows.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <Filter className="h-12 w-12 text-muted-foreground/30 mb-3" />
              <h3 className="font-medium text-muted-foreground mb-1">No workflows found</h3>
              <p className="text-sm text-muted-foreground/70">
                {searchQuery
                  ? 'Try adjusting your search or filters'
                  : 'Start your first autonomous coding workflow to see it here'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {paginatedWorkflows.map(workflow => (
                <WorkflowHistoryCard
                  key={workflow.id}
                  workflow={workflow}
                  onViewResults={handleViewResults}
                  onResume={handleResume}
                  onArchive={handleArchive}
                />
              ))}
            </div>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-6 py-3 border-t border-border flex items-center justify-between shrink-0">
            <div className="text-sm text-muted-foreground">
              Page {currentPage} of {totalPages}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

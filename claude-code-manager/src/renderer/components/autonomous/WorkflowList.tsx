/**
 * WorkflowList Component
 *
 * Displays a list of autonomous coding workflows for a project.
 * Allows creating, selecting, and managing workflows.
 */

import React, { useState, useEffect } from 'react'
import { Plus, FolderOpen, RefreshCw } from 'lucide-react'
import { Button } from '../ui/button'
import { WorkflowCard } from './WorkflowCard'
import { WorkflowCreate, CreateWorkflowInput } from './WorkflowCreate'
import { useAutonomousStore } from '@renderer/stores/autonomous-store'
import { cn } from '@renderer/lib/utils'

interface WorkflowListProps {
  projectPath: string
}

export function WorkflowList({ projectPath }: WorkflowListProps) {
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)

  const {
    workflows,
    workflowsByProject,
    activeWorkflowId,
    isLoading,
    error,
    refreshWorkflows,
    createWorkflow,
    deleteWorkflow,
    setActiveWorkflow,
    startOrchestrator,
    stopOrchestrator,
    pauseOrchestrator,
    getWorkflow
  } = useAutonomousStore()

  // Get workflows for this project
  const projectWorkflows = workflowsByProject[projectPath] || []

  // Load workflows on mount and when project changes
  useEffect(() => {
    refreshWorkflows(projectPath)
  }, [projectPath, refreshWorkflows])

  const handleCreateWorkflow = async (input: CreateWorkflowInput) => {
    await createWorkflow({
      projectPath,
      name: input.name,
      description: input.description,
      specContent: input.specContent,
      model: input.model,
      useWorktree: input.useWorktree,
      worktreeBranch: input.worktreeBranch
    })
  }

  const handleStartWorkflow = async (workflowId: string) => {
    const workflow = await getWorkflow(projectPath, workflowId)
    if (!workflow) return

    await startOrchestrator({
      projectPath: workflow.worktreePath || workflow.projectPath,
      workflowId: workflow.id,
      phase: workflow.status === 'pending' ? 'validation' : 'implementation',
      model: workflow.model,
      specFile: workflow.specFile
    })
  }

  const handlePauseWorkflow = async (workflowId: string) => {
    // Find active session for this workflow
    const sessions = useAutonomousStore.getState().sessionsByWorkflow[workflowId] || []
    const activeSession = sessions.find(s => s.status === 'running')
    if (activeSession) {
      await pauseOrchestrator(activeSession.id)
    }
  }

  const handleStopWorkflow = async (workflowId: string) => {
    // Find active session for this workflow
    const sessions = useAutonomousStore.getState().sessionsByWorkflow[workflowId] || []
    const activeSession = sessions.find(s => ['running', 'paused'].includes(s.status))
    if (activeSession) {
      await stopOrchestrator(activeSession.id)
    }
  }

  const handleDeleteWorkflow = async (workflowId: string) => {
    if (confirm('Are you sure you want to delete this workflow? This cannot be undone.')) {
      await deleteWorkflow(projectPath, workflowId)
    }
  }

  const handleSelectWorkflow = (workflowId: string) => {
    setActiveWorkflow(workflowId)
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold text-sm">Workflows</h2>
          {isLoading && (
            <RefreshCw className="h-3 w-3 animate-spin text-muted-foreground" />
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => refreshWorkflows(projectPath)}
            disabled={isLoading}
            className="h-7 w-7"
          >
            <RefreshCw className={cn('h-3 w-3', isLoading && 'animate-spin')} />
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={() => setIsCreateModalOpen(true)}
            className="h-7"
          >
            <Plus className="h-3 w-3 mr-1" />
            New
          </Button>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="mx-4 mt-3 p-2 bg-red-500/10 border border-red-500/20 rounded text-xs text-red-500">
          {error}
        </div>
      )}

      {/* Workflow List */}
      <div className="flex-1 overflow-auto p-4">
        {projectWorkflows.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-4">
            <FolderOpen className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 className="font-medium mb-1">No Workflows</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Create a workflow to start autonomous coding.
            </p>
            <Button
              variant="default"
              size="sm"
              onClick={() => setIsCreateModalOpen(true)}
            >
              <Plus className="h-4 w-4 mr-1" />
              Create Workflow
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {projectWorkflows.map((workflow) => (
              <WorkflowCard
                key={workflow.id}
                workflow={workflow}
                isActive={workflow.id === activeWorkflowId}
                onSelect={handleSelectWorkflow}
                onStart={handleStartWorkflow}
                onPause={handlePauseWorkflow}
                onStop={handleStopWorkflow}
                onDelete={handleDeleteWorkflow}
              />
            ))}
          </div>
        )}
      </div>

      {/* Create Modal */}
      <WorkflowCreate
        projectPath={projectPath}
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onCreate={handleCreateWorkflow}
      />
    </div>
  )
}

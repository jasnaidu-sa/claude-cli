/**
 * AutonomousView Component
 *
 * Main view for autonomous coding mode with phase-based routing.
 * Routes between phases: project_select → discovery_chat → spec_review → executing → completed
 */

import React, { useEffect, useState } from 'react'
import { X, FolderOpen, ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react'
import { Button } from '../ui/button'
import { WorkflowList } from './WorkflowList'
import { ProgressPanel } from './ProgressPanel'
import { SpecEditor } from './SpecEditor'
import { OutputViewer } from './OutputViewer'
import { ControlPanel } from './ControlPanel'
import { ResizeHandle } from '../ui/ResizeHandle'
import { ProjectPicker } from './ProjectPicker'
import { DiscoveryChat } from './DiscoveryChat'
import { SpecReview } from './SpecReview'
import { ExecutionDashboard } from './ExecutionDashboard'
import { CompletionSummary } from './CompletionSummary'
import { useAutonomousStore, type AutonomousPhase } from '@renderer/stores/autonomous-store'
import { useSessionStore } from '@renderer/stores/session-store'
import { cn } from '@renderer/lib/utils'

// Phase metadata for display
const PHASE_INFO: Record<AutonomousPhase, { title: string; description: string }> = {
  project_select: { title: 'Select Project', description: 'Choose a new or existing project' },
  discovery_chat: { title: 'Discovery', description: 'Describe what you want to build' },
  spec_review: { title: 'Review Spec', description: 'Review and approve the generated specification' },
  executing: { title: 'Executing', description: 'Autonomous coding in progress' },
  completed: { title: 'Complete', description: 'All tests passing' }
}

interface AutonomousViewProps {
  onClose?: () => void
}

export function AutonomousView({ onClose }: AutonomousViewProps) {
  const { sessions } = useSessionStore()

  const {
    // Phase state
    currentPhase,
    selectedProject,
    canGoBack,
    canGoForward,
    goToPreviousPhase,
    resetPhaseState,
    getCurrentPhaseIndex,
    // Workflow state
    workflows,
    activeWorkflowId,
    sessionsByWorkflow,
    initSubscriptions,
    refreshWorkflows,
    checkVenv,
    ensureVenv,
    venvStatus,
    validateSchema,
    getActiveWorkflow
  } = useAutonomousStore()

  // Initialize subscriptions on mount
  useEffect(() => {
    const cleanup = initSubscriptions()

    // Check venv status and auto-setup if needed
    checkVenv().then((status) => {
      if (status && !status.isValid) {
        // Auto-setup venv in background
        ensureVenv()
      }
    })

    return cleanup
  }, [initSubscriptions, checkVenv, ensureVenv])

  // Refresh workflows when project is selected
  useEffect(() => {
    if (selectedProject?.path) {
      refreshWorkflows(selectedProject.path)
    }
  }, [selectedProject?.path, refreshWorkflows])

  // Get active workflow and session
  const activeWorkflow = getActiveWorkflow()
  const workflowSessions = activeWorkflowId ? sessionsByWorkflow[activeWorkflowId] || [] : []
  const activeSession = workflowSessions.find(s => ['starting', 'running', 'paused'].includes(s.status))

  // Phase info
  const phaseInfo = PHASE_INFO[currentPhase]
  const phaseIndex = getCurrentPhaseIndex()
  const totalPhases = Object.keys(PHASE_INFO).length

  // Render the appropriate phase component
  const renderPhaseContent = () => {
    switch (currentPhase) {
      case 'project_select':
        return <ProjectPicker />
      case 'discovery_chat':
        return <DiscoveryChat />
      case 'spec_review':
        return <SpecReview />
      case 'executing':
        return <ExecutionDashboard />
      case 'completed':
        return <CompletionSummary />
      default:
        return <ProjectPicker />
    }
  }

  // Get unique project paths from sessions (for backwards compat)
  const projectPaths = [...new Set(sessions.map(s => s.projectPath))]

  return (
    <div className="h-full flex flex-col bg-card rounded-lg border border-border overflow-hidden">
      {/* Header with Phase Navigation */}
      <div className="h-12 px-4 flex items-center justify-between border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-3">
          {/* Back button */}
          {canGoBack() && (
            <Button
              variant="ghost"
              size="icon"
              onClick={goToPreviousPhase}
              className="h-8 w-8"
              title="Go back"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
          )}

          {/* Phase title and progress */}
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm">{phaseInfo.title}</span>
              <span className="text-xs text-muted-foreground">
                Step {phaseIndex + 1} of {totalPhases}
              </span>
            </div>
            <span className="text-xs text-muted-foreground">{phaseInfo.description}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Project indicator */}
          {selectedProject && (
            <div className="flex items-center gap-2 px-2 py-1 bg-secondary rounded text-xs">
              <FolderOpen className="h-3 w-3" />
              <span>{selectedProject.name}</span>
              {selectedProject.isNew && (
                <span className="text-emerald-500">(New)</span>
              )}
            </div>
          )}

          {/* Venv status indicator - shown only when setting up */}
          {venvStatus && !venvStatus.isValid && (
            <span className="text-xs bg-yellow-500/20 text-yellow-500 px-2 py-1 rounded animate-pulse">
              Setting up environment...
            </span>
          )}

          {/* Reset button - only show if not on first phase */}
          {currentPhase !== 'project_select' && (
            <Button
              variant="ghost"
              size="icon"
              onClick={resetPhaseState}
              className="h-8 w-8"
              title="Start over"
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
          )}

          {/* Close button */}
          {onClose && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="h-8 w-8"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Phase Progress Indicator */}
      <div className="h-1 bg-secondary">
        <div
          className="h-full bg-primary transition-all duration-300"
          style={{ width: `${((phaseIndex + 1) / totalPhases) * 100}%` }}
        />
      </div>

      {/* Main Content - Phase Router */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {renderPhaseContent()}
      </div>
    </div>
  )
}

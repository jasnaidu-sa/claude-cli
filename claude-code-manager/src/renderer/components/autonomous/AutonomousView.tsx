/**
 * AutonomousView Component
 *
 * Main view for autonomous coding mode. Combines all autonomous
 * components into a single, coordinated interface.
 */

import React, { useEffect, useState } from 'react'
import { X, FolderOpen, ChevronLeft } from 'lucide-react'
import { Button } from '../ui/button'
import { WorkflowList } from './WorkflowList'
import { ProgressPanel } from './ProgressPanel'
import { SpecEditor } from './SpecEditor'
import { OutputViewer } from './OutputViewer'
import { ControlPanel } from './ControlPanel'
import { ResizeHandle } from '../ui/ResizeHandle'
import { useAutonomousStore } from '@renderer/stores/autonomous-store'
import { useSessionStore } from '@renderer/stores/session-store'
import { cn } from '@renderer/lib/utils'

interface AutonomousViewProps {
  onClose?: () => void
}

export function AutonomousView({ onClose }: AutonomousViewProps) {
  const { sessions } = useSessionStore()

  const {
    workflows,
    activeWorkflowId,
    sessionsByWorkflow,
    initSubscriptions,
    refreshWorkflows,
    checkVenv,
    venvStatus,
    validateSchema,
    getActiveWorkflow
  } = useAutonomousStore()

  // Selected project path (from sessions or manual selection)
  const [selectedProjectPath, setSelectedProjectPath] = useState<string | null>(null)
  const [leftPanelWidth, setLeftPanelWidth] = useState(280)
  const [bottomPanelHeight, setBottomPanelHeight] = useState(200)

  // Get active workflow
  const activeWorkflow = getActiveWorkflow()

  // Get active session for the workflow (if any)
  const workflowSessions = activeWorkflowId ? sessionsByWorkflow[activeWorkflowId] || [] : []
  const activeSession = workflowSessions.find(s => ['starting', 'running', 'paused'].includes(s.status))

  // Initialize subscriptions on mount
  useEffect(() => {
    const cleanup = initSubscriptions()

    // Check venv status
    checkVenv()

    return cleanup
  }, [initSubscriptions, checkVenv])

  // Auto-select project from sessions
  useEffect(() => {
    if (!selectedProjectPath && sessions.length > 0) {
      setSelectedProjectPath(sessions[0].projectPath)
    }
  }, [sessions, selectedProjectPath])

  // Refresh workflows when project changes
  useEffect(() => {
    if (selectedProjectPath) {
      refreshWorkflows(selectedProjectPath)
    }
  }, [selectedProjectPath, refreshWorkflows])

  const handleLeftPanelResize = (delta: number) => {
    setLeftPanelWidth(prev => Math.max(200, Math.min(500, prev + delta)))
  }

  const handleBottomPanelResize = (delta: number) => {
    setBottomPanelHeight(prev => Math.max(100, Math.min(400, prev - delta)))
  }

  const handleRevalidateSchema = async () => {
    if (activeWorkflow && selectedProjectPath) {
      await validateSchema(selectedProjectPath, activeWorkflow.id, activeWorkflow.model)
    }
  }

  // Get unique project paths from sessions
  const projectPaths = [...new Set(sessions.map(s => s.projectPath))]

  return (
    <div className="h-full flex flex-col bg-card rounded-lg border border-border overflow-hidden">
      {/* Header */}
      <div className="h-10 px-3 flex items-center justify-between border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">Autonomous Coding</span>
          {venvStatus && !venvStatus.isValid && (
            <span className="text-xs bg-yellow-500/20 text-yellow-500 px-1.5 py-0.5 rounded">
              Venv needs setup
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Project Selector */}
          {projectPaths.length > 0 && (
            <select
              value={selectedProjectPath || ''}
              onChange={(e) => setSelectedProjectPath(e.target.value || null)}
              className="h-7 px-2 text-xs bg-secondary border border-border rounded"
            >
              <option value="">Select project...</option>
              {projectPaths.map((path) => (
                <option key={path} value={path}>
                  {path.split(/[/\\]/).pop()}
                </option>
              ))}
            </select>
          )}

          {onClose && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="h-7 w-7"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Main Content */}
      {!selectedProjectPath ? (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
          <FolderOpen className="h-16 w-16 text-muted-foreground/30 mb-4" />
          <h3 className="text-lg font-medium mb-2">No Project Selected</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Create a session in the Sessions panel or select a project to start autonomous coding.
          </p>
        </div>
      ) : (
        <div className="flex-1 flex min-h-0">
          {/* Left Panel - Workflow List */}
          <div
            style={{ width: leftPanelWidth }}
            className="h-full border-r border-border shrink-0"
          >
            <WorkflowList projectPath={selectedProjectPath} />
          </div>

          <ResizeHandle
            direction="horizontal"
            onResize={handleLeftPanelResize}
            className="bg-border"
          />

          {/* Main Panel */}
          <div className="flex-1 min-w-0 h-full flex flex-col">
            {activeWorkflow ? (
              <>
                {/* Top Area - Progress, Spec, Controls */}
                <div className="flex-1 min-h-0 flex">
                  {/* Progress Panel */}
                  <div className="flex-1 min-w-0 border-r border-border">
                    <ProgressPanel workflow={activeWorkflow} />
                  </div>

                  {/* Spec Editor */}
                  <div className="flex-1 min-w-0 border-r border-border">
                    <SpecEditor workflow={activeWorkflow} />
                  </div>

                  {/* Control Panel */}
                  <div className="w-72 shrink-0">
                    <ControlPanel
                      workflow={activeWorkflow}
                      onRevalidateSchema={handleRevalidateSchema}
                    />
                  </div>
                </div>

                {/* Bottom Area - Output Viewer */}
                <ResizeHandle
                  direction="vertical"
                  onResize={handleBottomPanelResize}
                  className="bg-border"
                />

                <div
                  style={{ height: bottomPanelHeight }}
                  className="shrink-0 relative"
                >
                  {activeSession ? (
                    <OutputViewer sessionId={activeSession.id} />
                  ) : (
                    <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                      No active session. Start the workflow to see output.
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="h-full flex flex-col items-center justify-center p-8 text-center">
                <ChevronLeft className="h-12 w-12 text-muted-foreground/30 mb-4" />
                <h3 className="font-medium mb-2">Select a Workflow</h3>
                <p className="text-sm text-muted-foreground">
                  Select a workflow from the list or create a new one to get started.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

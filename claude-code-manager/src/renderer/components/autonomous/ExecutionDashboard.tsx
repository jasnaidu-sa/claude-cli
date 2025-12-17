/**
 * ExecutionDashboard Component
 *
 * Phase 4: Execution dashboard - shows real-time progress of the autonomous
 * coding process with streaming output. This wraps existing components
 * and will be enhanced in FEAT-026.
 */

import React, { useState, useEffect } from 'react'
import { Play, Pause, Square, RefreshCw, Terminal, BarChart3 } from 'lucide-react'
import { Button } from '../ui/button'
import { ProgressPanel } from './ProgressPanel'
import { OutputViewer } from './OutputViewer'
import { ResizeHandle } from '../ui/ResizeHandle'
import { useAutonomousStore } from '@renderer/stores/autonomous-store'
import { cn } from '@renderer/lib/utils'

export function ExecutionDashboard() {
  const {
    selectedProject,
    activeWorkflowId,
    getActiveWorkflow,
    getActiveSession,
    sessionsByWorkflow,
    startOrchestrator,
    stopOrchestrator,
    pauseOrchestrator,
    goToNextPhase,
    progressByWorkflow
  } = useAutonomousStore()

  const [bottomPanelHeight, setBottomPanelHeight] = useState(250)

  const activeWorkflow = getActiveWorkflow()
  const workflowSessions = activeWorkflowId ? sessionsByWorkflow[activeWorkflowId] || [] : []
  const activeSession = workflowSessions.find(s => ['starting', 'running', 'paused'].includes(s.status))
  const progress = activeWorkflowId ? progressByWorkflow[activeWorkflowId] : null

  // Check if all tests pass to auto-advance to completion
  useEffect(() => {
    if (progress && progress.total > 0 && progress.passing === progress.total) {
      // All tests pass, advance to completion phase
      goToNextPhase()
    }
  }, [progress, goToNextPhase])

  const handleBottomPanelResize = (delta: number) => {
    setBottomPanelHeight(prev => Math.max(100, Math.min(500, prev - delta)))
  }

  const handleStart = async () => {
    if (!activeWorkflow || !selectedProject) return

    await startOrchestrator({
      projectPath: selectedProject.path,
      workflowId: activeWorkflow.id,
      phase: 'implementation',
      model: activeWorkflow.model
    })
  }

  const handlePause = async () => {
    if (activeSession) {
      await pauseOrchestrator(activeSession.id)
    }
  }

  const handleStop = async () => {
    if (activeSession) {
      await stopOrchestrator(activeSession.id)
    }
  }

  // Placeholder for when no workflow exists yet
  if (!activeWorkflow) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8 text-center">
        <RefreshCw className="h-12 w-12 text-muted-foreground/30 mb-4" />
        <h3 className="font-medium text-lg mb-2">Preparing Execution</h3>
        <p className="text-sm text-muted-foreground mb-4">
          The workflow is being created from your specification...
        </p>
        <p className="text-xs text-muted-foreground">
          (Workflow creation will be automated in FEAT-026)
        </p>

        {/* Dev-only: proceed button */}
        <Button
          variant="outline"
          className="mt-6"
          onClick={goToNextPhase}
        >
          Skip to Completion (Dev Only)
        </Button>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Control Bar */}
      <div className="h-12 px-4 flex items-center justify-between border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          {/* Status indicator */}
          <div className={cn(
            'h-3 w-3 rounded-full',
            activeSession?.status === 'running' && 'bg-emerald-500 animate-pulse',
            activeSession?.status === 'paused' && 'bg-yellow-500',
            activeSession?.status === 'starting' && 'bg-blue-500 animate-pulse',
            !activeSession && 'bg-secondary'
          )} />
          <span className="font-medium text-sm">
            {activeSession?.status === 'running' && 'Executing...'}
            {activeSession?.status === 'paused' && 'Paused'}
            {activeSession?.status === 'starting' && 'Starting...'}
            {!activeSession && 'Ready to Start'}
          </span>

          {/* Progress summary */}
          {progress && (
            <span className="text-sm text-muted-foreground">
              {progress.passing}/{progress.total} tests passing ({progress.percentage}%)
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {!activeSession ? (
            <Button size="sm" onClick={handleStart}>
              <Play className="h-4 w-4 mr-1" />
              Start
            </Button>
          ) : activeSession.status === 'running' ? (
            <>
              <Button variant="outline" size="sm" onClick={handlePause}>
                <Pause className="h-4 w-4 mr-1" />
                Pause
              </Button>
              <Button variant="destructive" size="sm" onClick={handleStop}>
                <Square className="h-4 w-4 mr-1" />
                Stop
              </Button>
            </>
          ) : activeSession.status === 'paused' ? (
            <>
              <Button size="sm" onClick={handleStart}>
                <Play className="h-4 w-4 mr-1" />
                Resume
              </Button>
              <Button variant="destructive" size="sm" onClick={handleStop}>
                <Square className="h-4 w-4 mr-1" />
                Stop
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 min-h-0 flex flex-col">
        {/* Progress Panel */}
        <div className="flex-1 min-h-0 overflow-hidden">
          <ProgressPanel workflow={activeWorkflow} />
        </div>

        {/* Resize Handle */}
        <ResizeHandle
          direction="vertical"
          onResize={handleBottomPanelResize}
          className="bg-border"
        />

        {/* Output Viewer */}
        <div
          style={{ height: bottomPanelHeight }}
          className="shrink-0 border-t border-border"
        >
          {activeSession ? (
            <OutputViewer sessionId={activeSession.id} />
          ) : (
            <div className="h-full flex items-center justify-center text-muted-foreground">
              <Terminal className="h-5 w-5 mr-2 opacity-50" />
              <span className="text-sm">Output will appear here when execution starts</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

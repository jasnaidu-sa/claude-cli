/**
 * AutonomousView Component
 *
 * Main view for autonomous coding mode with phase-based routing.
 * Routes between phases: project_select → discovery_chat → spec_review → executing → completed
 */

import React, { useEffect } from 'react'
import { X, FolderOpen, ChevronLeft, RotateCcw, History, RefreshCw } from 'lucide-react'
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
import { PreflightCheck } from './PreflightCheck'
import { JourneyAnalysis } from './JourneyAnalysis'
import { SpecGenerating } from './SpecGenerating'
import { AutocoderEmbedded } from './AutocoderEmbedded'
import { InitiatorChat } from './InitiatorChat'
import { RequirementsSummary } from './RequirementsSummary'
import { PromptReview } from './PromptReview'
import { RalphExecutionDashboard } from './RalphExecutionDashboard'
import { RalphSessionHistory } from './RalphSessionHistory'
import { useAutonomousStore, type AutonomousPhase } from '@renderer/stores/autonomous-store'
import { useSessionStore } from '@renderer/stores/session-store'
import { cn } from '@renderer/lib/utils'

// Phase metadata for display
const PHASE_INFO: Record<AutonomousPhase, { title: string; description: string }> = {
  project_select: { title: 'Select Project', description: 'Choose a new or existing project' },
  preflight: { title: 'Pre-flight Check', description: 'Validating environment and setup' },
  journey_analysis: { title: 'Analyzing Codebase', description: 'Understanding existing patterns and user flows' },
  discovery_chat: { title: 'Discovery', description: 'Describe what you want to build' },
  spec_generating: { title: 'Generating Spec', description: 'Building detailed specification' },
  spec_review: { title: 'Review Spec', description: 'Review and approve the generated specification' },
  executing: { title: 'Executing', description: 'Autonomous coding in progress' },
  completed: { title: 'Complete', description: 'All tests passing' }
}

interface AutonomousViewProps {
  onClose?: () => void
}

// Mode type for autonomous view
type AutonomousMode = 'autocoder' | 'ralph' | 'legacy'

// Ralph phase type
type RalphPhase = 'initiator' | 'requirements' | 'prompt_review' | 'executing' | 'completed'

export function AutonomousView({ onClose }: AutonomousViewProps) {
  const { sessions } = useSessionStore()
  const [mode, setMode] = React.useState<AutonomousMode>('autocoder') // Default to autocoder
  const [ralphPhase, setRalphPhase] = React.useState<RalphPhase>('initiator')

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
    getActiveWorkflow,
    // Ralph state
    ralphSession,
    ralphInitiatorSession,
    ralphRequirements,
    ralphPromptConfig,
    setRalphRequirements,
    setRalphPromptConfig,
    resetRalphState,
    // Ralph session history
    ralphSessionHistory,
    currentRalphSessionId,
    showSessionHistory,
    loadSessionHistory,
    resumeSession,
    deleteSession,
    setShowSessionHistory
  } = useAutonomousStore()

  // Initialize subscriptions on mount
  useEffect(() => {
    const cleanup = initSubscriptions()
    return cleanup
  }, [initSubscriptions])

  // Check and setup venv only when entering executing phase
  useEffect(() => {
    if (currentPhase === 'executing') {
      checkVenv().then((status) => {
        if (status && !status.isValid) {
          // Auto-setup venv in background
          ensureVenv()
        }
      })
    }
  }, [currentPhase, checkVenv, ensureVenv])

  // Refresh workflows when project is selected
  useEffect(() => {
    if (selectedProject?.path) {
      refreshWorkflows(selectedProject.path)
    }
  }, [selectedProject?.path, refreshWorkflows])

  // Load Ralph session history when entering Ralph mode
  useEffect(() => {
    if (mode === 'ralph') {
      loadSessionHistory(selectedProject?.path)
    }
  }, [mode, selectedProject?.path, loadSessionHistory])

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
      case 'preflight':
        return <PreflightCheck />
      case 'journey_analysis':
        return <JourneyAnalysis />
      case 'discovery_chat':
        return <DiscoveryChat />
      case 'spec_generating':
        return <SpecGenerating />
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

  // Render Ralph phase content
  const renderRalphContent = () => {
    switch (ralphPhase) {
      case 'initiator':
        return (
          <InitiatorChat
            projectPath={selectedProject?.path || ''}
            onRequirementsReady={(requirements) => {
              setRalphRequirements(requirements)
              setRalphPhase('requirements')
            }}
          />
        )
      case 'requirements':
        return ralphRequirements ? (
          <div className="flex flex-col h-full">
            <RequirementsSummary
              requirements={ralphRequirements}
              onEdit={(field, value) => setRalphRequirements({ ...ralphRequirements, [field]: value })}
              editable={true}
            />
            <div className="flex justify-end gap-2 p-4 border-t">
              <Button variant="outline" onClick={() => setRalphPhase('initiator')}>
                Back to Chat
              </Button>
              <Button onClick={() => setRalphPhase('prompt_review')}>
                Generate Prompt
              </Button>
            </div>
          </div>
        ) : null
      case 'prompt_review':
        return ralphPromptConfig ? (
          <div className="flex flex-col h-full">
            <PromptReview
              promptConfig={ralphPromptConfig}
              onUpdate={(updates) => setRalphPromptConfig({ ...ralphPromptConfig, ...updates })}
              onApprove={() => setRalphPhase('executing')}
              onRegenerate={() => setRalphPhase('initiator')}
            />
          </div>
        ) : null
      case 'executing':
        return ralphPromptConfig && selectedProject ? (
          <RalphExecutionDashboard
            projectPath={selectedProject.path}
            promptConfig={ralphPromptConfig}
            onBack={() => setRalphPhase('prompt_review')}
            onComplete={() => setRalphPhase('completed')}
          />
        ) : null
      case 'completed':
        return <CompletionSummary />
      default:
        return null
    }
  }

  // Ralph phase labels for display
  const RALPH_PHASE_INFO: Record<RalphPhase, { title: string; step: number }> = {
    initiator: { title: 'Describe Task', step: 1 },
    requirements: { title: 'Review Requirements', step: 2 },
    prompt_review: { title: 'Review Prompt', step: 3 },
    executing: { title: 'Executing', step: 4 },
    completed: { title: 'Complete', step: 5 }
  }

  // Handle changing project in Ralph mode
  const handleChangeProject = () => {
    resetRalphState()
    resetPhaseState() // This resets selectedProject to null
    setRalphPhase('initiator')
  }

  // Handle starting new Ralph session (keep same project)
  const handleNewRalphSession = () => {
    resetRalphState()
    setRalphPhase('initiator')
  }

  // Render mode selector header
  const renderModeHeader = () => (
    <div className="h-12 px-4 flex items-center justify-between border-b border-border bg-card shrink-0">
      <div className="flex items-center gap-3">
        <span className="font-medium text-sm">Autonomous Coding</span>
        <div className="flex items-center gap-1 bg-muted rounded-md p-0.5">
          <Button
            variant={mode === 'autocoder' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setMode('autocoder')}
            className="text-xs h-7"
          >
            Autocoder
          </Button>
          <Button
            variant={mode === 'ralph' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => {
              setMode('ralph')
              resetRalphState()
              setRalphPhase('initiator')
            }}
            className="text-xs h-7"
          >
            Ralph Loop
          </Button>
          <Button
            variant={mode === 'legacy' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setMode('legacy')}
            className="text-xs h-7"
          >
            Legacy
          </Button>
        </div>
      </div>

      {/* Right side - project info and controls for Ralph mode */}
      <div className="flex items-center gap-2">
        {mode === 'ralph' && selectedProject && (
          <>
            {/* Phase indicator */}
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <span>Step {RALPH_PHASE_INFO[ralphPhase].step}/5:</span>
              <span className="text-foreground font-medium">{RALPH_PHASE_INFO[ralphPhase].title}</span>
            </div>

            <div className="w-px h-4 bg-border" />

            {/* Project indicator */}
            <div className="flex items-center gap-2 px-2 py-1 bg-secondary rounded text-xs">
              <FolderOpen className="h-3 w-3" />
              <span className="max-w-[150px] truncate" title={selectedProject.path}>
                {selectedProject.name}
              </span>
            </div>

            {/* Change project button */}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleChangeProject}
              className="h-7 text-xs gap-1"
              title="Change project"
            >
              <RefreshCw className="h-3 w-3" />
              Change
            </Button>

            {/* New session button (only if past initiator phase) */}
            {ralphPhase !== 'initiator' && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleNewRalphSession}
                className="h-7 text-xs gap-1"
                title="Start new task in same project"
              >
                <RotateCcw className="h-3 w-3" />
                New Task
              </Button>
            )}

            {/* History button */}
            <Button
              variant={showSessionHistory ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setShowSessionHistory(!showSessionHistory)}
              className="h-7 text-xs gap-1"
              title="View session history"
            >
              <History className="h-3 w-3" />
              {ralphSessionHistory.length > 0 && (
                <span className="text-muted-foreground">({ralphSessionHistory.length})</span>
              )}
            </Button>
          </>
        )}

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
  )

  // Autocoder mode
  if (mode === 'autocoder') {
    return (
      <div className="h-full flex flex-col bg-card rounded-lg border border-border overflow-hidden">
        {renderModeHeader()}
        <div className="flex-1 min-h-0 overflow-hidden">
          <AutocoderEmbedded />
        </div>
      </div>
    )
  }

  // Ralph Loop mode
  if (mode === 'ralph') {
    return (
      <div className="h-full flex flex-col bg-card rounded-lg border border-border overflow-hidden">
        {renderModeHeader()}
        <div className="flex-1 min-h-0 overflow-hidden flex">
          {/* Main content */}
          <div className={cn(
            'flex-1 min-w-0 overflow-hidden',
            showSessionHistory && 'border-r'
          )}>
            {selectedProject ? (
              renderRalphContent()
            ) : (
              <ProjectPicker />
            )}
          </div>

          {/* Session history panel (slide-in from right) */}
          {showSessionHistory && (
            <div className="w-80 shrink-0 bg-background overflow-hidden">
              <RalphSessionHistory
                sessions={ralphSessionHistory}
                currentSessionId={currentRalphSessionId}
                onResume={async (sessionId) => {
                  const success = await resumeSession(sessionId)
                  if (success) {
                    // Session restored, update phase based on session state
                    const session = ralphSessionHistory.find(s => s.id === sessionId)
                    if (session) {
                      setRalphPhase(session.phase)
                    }
                  }
                }}
                onDelete={deleteSession}
                onClose={() => setShowSessionHistory(false)}
              />
            </div>
          )}
        </div>
      </div>
    )
  }

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
                <span className="text-primary">(New)</span>
              )}
            </div>
          )}

          {/* Venv status indicator - only shown during executing phase when setting up */}
          {currentPhase === 'executing' && venvStatus && !venvStatus.isValid && (
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

          {/* Switch to embedded autocoder */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setMode('autocoder')}
            className="text-xs"
          >
            Use Autocoder UI
          </Button>

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

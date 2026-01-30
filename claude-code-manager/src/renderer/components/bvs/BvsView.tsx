/**
 * BVS View - Main entry point for Bounded Verified Sections workflow
 *
 * Provides access to:
 * - Planning Chat (interactive task definition)
 * - PRD Upload (file-based planning)
 * - Active BVS sessions with Kanban dashboard
 * - Learning browser and convention editor
 */

import React, { useState, useEffect } from 'react'
import {
  Layers,
  MessageSquare,
  Upload,
  Play,
  Settings2,
  BookOpen,
  FolderOpen,
  FolderPlus,
  ChevronRight,
  Plus,
  X,
  Clock,
  Loader2,
  FolderKanban
} from 'lucide-react'
import { Button } from '../ui/button'
import { BvsDashboard } from './BvsDashboard'
import { BvsPlanningChatV2 } from './BvsPlanningChatV2'
import { BvsPlanReview } from './BvsPlanReview'
import { BvsLearningBrowser } from './BvsLearningBrowser'
import { BvsConventionEditor } from './BvsConventionEditor'
import { BvsProjectList } from './BvsProjectList'
import { BvsExecutionDashboard } from './BvsExecutionDashboard'
import { cn } from '@renderer/lib/utils'
import { type BvsSession } from '@shared/bvs-types'
import type { BvsProjectItem } from '@preload/index'
import { useSessionStore } from '@renderer/stores/session-store'

type BvsMode = 'home' | 'project-select' | 'project-list' | 'planning' | 'prd-upload' | 'executing' | 'completed-chat' | 'learnings' | 'conventions'

// Simplified session info for the list view (legacy - keeping for backwards compatibility)
interface BvsSessionInfo {
  id: string
  projectPath: string
  projectName: string
  status: 'planning' | 'executing' | 'verifying' | 'completed' | 'failed'
  progress: number
  sectionsTotal: number
  sectionsCompleted: number
  createdAt: number
}

// Current selected project context
interface SelectedProjectContext {
  project: BvsProjectItem
  projectPath: string
}

interface BvsViewProps {
  onClose?: () => void
}

// What action to take after selecting a project
type PendingAction = 'planning' | 'prd-upload' | 'learnings' | 'conventions' | null

export function BvsView({ onClose }: BvsViewProps) {
  const [mode, setMode] = useState<BvsMode>('home')
  const [sessionInfos, setSessionInfos] = useState<BvsSessionInfo[]>([])
  const [selectedSession, setSelectedSession] = useState<BvsSession | null>(null)
  const [selectedProject, setSelectedProject] = useState<string | null>(null)
  const [selectedProjectName, setSelectedProjectName] = useState<string | null>(null)
  const [selectedBvsProject, setSelectedBvsProject] = useState<BvsProjectItem | null>(null)
  const [isGreenfield, setIsGreenfield] = useState(false)
  const [forceNewSession, setForceNewSession] = useState(false)  // Force new session, don't resume existing
  const [isPrdUpload, setIsPrdUpload] = useState(false)  // Track if we're in PRD upload mode
  const [pendingAction, setPendingAction] = useState<PendingAction>(null)
  const [showProjectPicker, setShowProjectPicker] = useState(false)
  const [isSelectingFolder, setIsSelectingFolder] = useState(false)
  const [recentProjects, setRecentProjects] = useState<string[]>([])

  // Get available projects from session store
  const { sessions } = useSessionStore()

  // Load recent projects from config on mount
  useEffect(() => {
    const loadRecentProjects = async () => {
      try {
        const config = await window.electron.config.get('recentProjects')
        if (Array.isArray(config)) {
          setRecentProjects(config)
        }
      } catch (error) {
        console.error('Failed to load recent projects:', error)
      }
    }
    loadRecentProjects()
  }, [])

  // Combine recent projects with session projects, deduplicated
  const sessionPaths = sessions.map(s => s.projectPath)
  const allProjectPaths = [...new Set([...recentProjects, ...sessionPaths])]

  // Save project to recent list
  const saveToRecent = async (path: string) => {
    try {
      const filtered = recentProjects.filter(p => p !== path)
      const updated = [path, ...filtered].slice(0, 10)
      await window.electron.config.set('recentProjects', updated)
      setRecentProjects(updated)
    } catch (error) {
      console.error('Failed to save recent project:', error)
    }
  }

  // Load active BVS sessions
  useEffect(() => {
    // TODO: Load from IPC
    // For now, show empty state
  }, [])

  // Handle project path selection (from existing sessions list or recent projects)
  const handleSelectProjectPath = async (projectPath: string, greenfield: boolean = false) => {
    const name = projectPath.split(/[/\\]/).pop() || 'Unknown'
    setSelectedProject(projectPath)
    setSelectedProjectName(name)
    setIsGreenfield(greenfield)
    setShowProjectPicker(false)
    // Keep pendingAction to know if this was a PRD upload flow
    await saveToRecent(projectPath)

    // Show project list for this path
    setMode('project-list')
    // Note: Don't reset pendingAction here - handleNewProject needs it
  }

  // Handle BVS project selection from project list
  const handleSelectBvsProject = (project: BvsProjectItem) => {
    setSelectedBvsProject(project)
    setForceNewSession(false)  // Don't force new, allow resume of selected project

    // Route based on project status
    switch (project.status) {
      case 'planning':
        // Resume planning chat
        setMode('planning')
        break
      case 'ready':
      case 'in_progress':
      case 'paused':
        // Go to execution/kanban view
        setMode('executing')
        break
      case 'completed':
        // Go to completed project chat
        setMode('completed-chat')
        break
      case 'cancelled':
        // Go to project details (read-only)
        setMode('completed-chat')
        break
      default:
        setMode('executing')
    }
  }

  // Start new project from project list
  const handleNewProject = () => {
    setSelectedBvsProject(null)
    setForceNewSession(true)  // Force new session, don't resume existing
    // Check if we came from PRD upload action
    setIsPrdUpload(pendingAction === 'prd-upload')
    setPendingAction(null)  // Reset after using
    setMode('planning')
  }

  // Browse filesystem for existing project
  const handleBrowseExisting = async () => {
    setIsSelectingFolder(true)
    try {
      const result = await window.electron.dialog.selectFolder()
      if (result.success && result.path) {
        await handleSelectProjectPath(result.path, false)
      }
    } finally {
      setIsSelectingFolder(false)
    }
  }

  // Browse filesystem for greenfield project
  const handleBrowseGreenfield = async () => {
    setIsSelectingFolder(true)
    try {
      const result = await window.electron.dialog.selectFolder()
      if (result.success && result.path) {
        await handleSelectProjectPath(result.path, true)
      }
    } finally {
      setIsSelectingFolder(false)
    }
  }

  // Start an action that requires project selection
  const startAction = (action: PendingAction) => {
    // Always show project picker - allow browsing for new folders
    setPendingAction(action)
    setShowProjectPicker(true)
  }

  // Render based on mode

  // Project list mode - show all BVS projects for selected codebase
  if (mode === 'project-list' && selectedProject) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center gap-2 p-4 border-b border-border">
          <Button variant="ghost" size="sm" onClick={() => setMode('home')}>
            <ChevronRight className="h-4 w-4 rotate-180" />
            Back
          </Button>
          <div className="flex items-center gap-2">
            <FolderKanban className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">
              {selectedProjectName || selectedProject.split(/[/\\]/).pop()}
            </h2>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-6">
          <BvsProjectList
            projectPath={selectedProject}
            onSelectProject={handleSelectBvsProject}
            onNewProject={handleNewProject}
            onBack={() => setMode('home')}
          />
        </div>
      </div>
    )
  }

  // Planning mode - interactive planning chat
  if (mode === 'planning' && selectedProject) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center gap-2 p-4 border-b border-border">
          <Button variant="ghost" size="sm" onClick={() => {
            setForceNewSession(false)
            setIsPrdUpload(false)
            setMode('project-list')
          }}>
            <ChevronRight className="h-4 w-4 rotate-180" />
            Back
          </Button>
          <h2 className="text-lg font-semibold">
            {selectedBvsProject ? selectedBvsProject.name : 'New Project'}
          </h2>
          <span className="text-sm text-muted-foreground ml-2">
            Planning
          </span>
        </div>
        <div className="flex-1 overflow-hidden p-4">
          <BvsPlanningChatV2
            projectPath={selectedProject}
            bvsProjectId={selectedBvsProject?.id}
            forceNew={forceNewSession}
            isPrdUpload={isPrdUpload}
            onPlanReady={(planPath) => {
              console.log('[BvsView] Plan created at:', planPath)
              // Reset flags and refresh project list
              setForceNewSession(false)
              setIsPrdUpload(false)
              setMode('project-list')
            }}
          />
        </div>
      </div>
    )
  }

  // Executing mode - Kanban/dashboard view for all project statuses
  // The BvsExecutionDashboard handles all cases: ready, in_progress, paused
  // - For 'ready': Shows the kanban with Start button (phase selector)
  // - For 'in_progress'/'paused': Shows action modal to continue/reset/view
  if (mode === 'executing' && selectedBvsProject && selectedProject) {
    return (
      <BvsExecutionDashboard
        project={selectedBvsProject}
        projectPath={selectedProject}
        onBack={() => setMode('project-list')}
        onProjectUpdate={setSelectedBvsProject}
      />
    )
  }

  // Completed chat mode - Q&A for completed projects
  if (mode === 'completed-chat' && selectedBvsProject && selectedProject) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center gap-2 p-4 border-b border-border">
          <Button variant="ghost" size="sm" onClick={() => setMode('project-list')}>
            <ChevronRight className="h-4 w-4 rotate-180" />
            Back
          </Button>
          <h2 className="text-lg font-semibold">{selectedBvsProject.name}</h2>
          <span className="text-sm text-muted-foreground ml-2">
            {selectedBvsProject.status === 'completed' ? 'Completed' : 'Cancelled'}
          </span>
        </div>
        <div className="flex-1 overflow-hidden p-4">
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
            <MessageSquare className="h-12 w-12 mb-4 opacity-50" />
            <h3 className="text-lg font-medium mb-2">Project Q&A</h3>
            <p className="text-sm text-center max-w-md">
              Ask questions about this completed project.
              <br />
              Project: {selectedBvsProject.name}
              <br />
              Sections: {selectedBvsProject.sectionsCompleted}/{selectedBvsProject.sectionsTotal}
            </p>
          </div>
        </div>
      </div>
    )
  }

  // Legacy executing mode with BvsSession (keep for backwards compatibility)
  if (mode === 'executing' && selectedSession) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center gap-2 p-4 border-b border-border">
          <Button variant="ghost" size="sm" onClick={() => setMode('home')}>
            <ChevronRight className="h-4 w-4 rotate-180" />
            Back
          </Button>
          <h2 className="text-lg font-semibold">BVS Execution</h2>
        </div>
        <div className="flex-1 overflow-hidden">
          <BvsDashboard session={selectedSession} />
        </div>
      </div>
    )
  }

  if (mode === 'learnings') {
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center gap-2 p-4 border-b border-border">
          <Button variant="ghost" size="sm" onClick={() => setMode('home')}>
            <ChevronRight className="h-4 w-4 rotate-180" />
            Back
          </Button>
          <h2 className="text-lg font-semibold">Learnings Browser</h2>
        </div>
        <div className="flex-1 overflow-auto p-4">
          <BvsLearningBrowser projectPath={selectedProject || ''} />
        </div>
      </div>
    )
  }

  if (mode === 'conventions') {
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center gap-2 p-4 border-b border-border">
          <Button variant="ghost" size="sm" onClick={() => setMode('home')}>
            <ChevronRight className="h-4 w-4 rotate-180" />
            Back
          </Button>
          <h2 className="text-lg font-semibold">Convention Editor</h2>
        </div>
        <div className="flex-1 overflow-auto p-4">
          <BvsConventionEditor projectPath={selectedProject || ''} />
        </div>
      </div>
    )
  }

  // Home view
  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <Layers className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">BVS Workflow</h1>
            <p className="text-sm text-muted-foreground">
              Bounded Verified Sections - Incremental development with quality gates
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {/* Start New Section */}
        <div className="mb-8">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-4">
            Start New Workflow
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Interactive Planning */}
            <button
              onClick={() => startAction('planning')}
              className="flex items-start gap-4 p-4 rounded-lg border border-border hover:border-primary/50 hover:bg-accent/50 transition-colors text-left"
            >
              <div className="p-2 rounded-lg bg-blue-500/10">
                <MessageSquare className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <h3 className="font-medium">Interactive Planning</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Chat with AI to define your task, explore the codebase, and generate a plan
                </p>
              </div>
            </button>

            {/* PRD Upload */}
            <button
              onClick={() => startAction('prd-upload')}
              className="flex items-start gap-4 p-4 rounded-lg border border-border hover:border-primary/50 hover:bg-accent/50 transition-colors text-left"
            >
              <div className="p-2 rounded-lg bg-green-500/10">
                <Upload className="h-5 w-5 text-green-500" />
              </div>
              <div>
                <h3 className="font-medium">Upload PRD</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Upload a PRD document to automatically generate sections and dependencies
                </p>
              </div>
            </button>
          </div>
        </div>

        {/* Active Sessions */}
        <div className="mb-8">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-4">
            Active Sessions
          </h2>
          {sessionInfos.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground border border-dashed border-border rounded-lg">
              <Layers className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No active BVS sessions</p>
              <p className="text-sm">Start a new workflow above to begin</p>
            </div>
          ) : (
            <div className="space-y-2">
              {sessionInfos.map((sessionInfo) => (
                <button
                  key={sessionInfo.id}
                  onClick={() => {
                    // TODO: Load full session from IPC
                    // setSelectedSession(fullSession)
                    // setMode('executing')
                  }}
                  className="w-full flex items-center gap-4 p-4 rounded-lg border border-border hover:border-primary/50 hover:bg-accent/50 transition-colors text-left"
                >
                  <div className={cn(
                    'p-2 rounded-lg',
                    sessionInfo.status === 'executing' && 'bg-blue-500/10',
                    sessionInfo.status === 'verifying' && 'bg-yellow-500/10',
                    sessionInfo.status === 'completed' && 'bg-green-500/10',
                    sessionInfo.status === 'failed' && 'bg-red-500/10'
                  )}>
                    <Play className={cn(
                      'h-5 w-5',
                      sessionInfo.status === 'executing' && 'text-blue-500',
                      sessionInfo.status === 'verifying' && 'text-yellow-500',
                      sessionInfo.status === 'completed' && 'text-green-500',
                      sessionInfo.status === 'failed' && 'text-red-500'
                    )} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium truncate">{sessionInfo.projectName}</h3>
                    <p className="text-sm text-muted-foreground">
                      {sessionInfo.sectionsCompleted}/{sessionInfo.sectionsTotal} sections
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-medium">{sessionInfo.progress}%</div>
                    <div className="w-24 h-1.5 bg-muted rounded-full overflow-hidden mt-1">
                      <div
                        className="h-full bg-primary transition-all"
                        style={{ width: `${sessionInfo.progress}%` }}
                      />
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Tools */}
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-4">
            Tools
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <button
              onClick={() => startAction('learnings')}
              className="flex items-center gap-3 p-3 rounded-lg border border-border hover:border-primary/50 hover:bg-accent/50 transition-colors text-left"
            >
              <BookOpen className="h-5 w-5 text-muted-foreground" />
              <div>
                <h3 className="font-medium text-sm">Learnings Browser</h3>
                <p className="text-xs text-muted-foreground">View and edit accumulated learnings</p>
              </div>
            </button>

            <button
              onClick={() => startAction('conventions')}
              className="flex items-center gap-3 p-3 rounded-lg border border-border hover:border-primary/50 hover:bg-accent/50 transition-colors text-left"
            >
              <Settings2 className="h-5 w-5 text-muted-foreground" />
              <div>
                <h3 className="font-medium text-sm">Convention Editor</h3>
                <p className="text-xs text-muted-foreground">Configure project conventions</p>
              </div>
            </button>
          </div>
        </div>

        {/* Project Picker Modal */}
        {showProjectPicker && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-background rounded-lg shadow-xl max-w-2xl w-full mx-4">
              <div className="flex items-center justify-between p-4 border-b border-border">
                <h3 className="font-semibold">Select Project</h3>
                <button
                  onClick={() => {
                    setShowProjectPicker(false)
                    setPendingAction(null)
                  }}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Browse Options */}
              <div className="p-4 border-b border-border">
                <div className="grid grid-cols-2 gap-4">
                  {/* New Project (Greenfield) */}
                  <button
                    onClick={handleBrowseGreenfield}
                    disabled={isSelectingFolder}
                    className={cn(
                      'flex flex-col items-center p-6 rounded-lg border-2 border-dashed',
                      'hover:border-primary hover:bg-primary/5 transition-colors',
                      'focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2',
                      isSelectingFolder && 'opacity-50 cursor-not-allowed'
                    )}
                  >
                    <div className="h-12 w-12 rounded-full bg-green-500/10 flex items-center justify-center mb-3">
                      {isSelectingFolder ? (
                        <Loader2 className="h-6 w-6 text-green-500 animate-spin" />
                      ) : (
                        <FolderPlus className="h-6 w-6 text-green-500" />
                      )}
                    </div>
                    <h4 className="font-medium mb-1">New Project</h4>
                    <p className="text-xs text-muted-foreground text-center">
                      Start fresh with a greenfield project
                    </p>
                  </button>

                  {/* Existing Project */}
                  <button
                    onClick={handleBrowseExisting}
                    disabled={isSelectingFolder}
                    className={cn(
                      'flex flex-col items-center p-6 rounded-lg border-2 border-dashed',
                      'hover:border-primary hover:bg-primary/5 transition-colors',
                      'focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2',
                      isSelectingFolder && 'opacity-50 cursor-not-allowed'
                    )}
                  >
                    <div className="h-12 w-12 rounded-full bg-blue-500/10 flex items-center justify-center mb-3">
                      {isSelectingFolder ? (
                        <Loader2 className="h-6 w-6 text-blue-500 animate-spin" />
                      ) : (
                        <FolderOpen className="h-6 w-6 text-blue-500" />
                      )}
                    </div>
                    <h4 className="font-medium mb-1">Browse Folder</h4>
                    <p className="text-xs text-muted-foreground text-center">
                      Select an existing codebase
                    </p>
                  </button>
                </div>
              </div>

              {/* Recent Projects */}
              <div className="p-4 max-h-[40vh] overflow-auto">
                {allProjectPaths.length > 0 && (
                  <div className="space-y-3">
                    <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                      <Clock className="h-4 w-4" />
                      Recent Projects
                    </h4>
                    <div className="space-y-2">
                      {allProjectPaths.slice(0, 8).map((path) => (
                        <button
                          key={path}
                          onClick={() => handleSelectProjectPath(path, false)}
                          disabled={isSelectingFolder}
                          className={cn(
                            'w-full flex items-center gap-3 p-3 rounded-lg',
                            'bg-secondary/50 hover:bg-secondary transition-colors',
                            'focus:outline-none focus:ring-2 focus:ring-primary',
                            isSelectingFolder && 'opacity-50 cursor-not-allowed'
                          )}
                        >
                          <FolderOpen className="h-4 w-4 text-muted-foreground" />
                          <div className="flex-1 min-w-0 text-left">
                            <div className="font-medium text-sm truncate">
                              {path.split(/[/\\]/).pop()}
                            </div>
                            <div className="text-xs text-muted-foreground truncate">
                              {path}
                            </div>
                          </div>
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {allProjectPaths.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground">
                    <FolderOpen className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No recent projects</p>
                    <p className="text-xs">Use the buttons above to browse for a folder</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default BvsView

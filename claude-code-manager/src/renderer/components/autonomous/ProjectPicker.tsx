/**
 * ProjectPicker Component
 *
 * Phase 1: Project selection - allows user to select an existing project
 * or create a new greenfield project for autonomous coding.
 *
 * Features:
 * - Two main options: New Project (greenfield) or Existing Project
 * - Recent projects list from config store and current sessions
 * - Auto-saves selected projects to recent list
 * - Detects incomplete sessions and shows all drafts with timeline
 * - Allows resume/restart of any draft
 */

import React, { useState, useEffect } from 'react'
import { FolderOpen, FolderPlus, ChevronRight, Clock, Loader2, RefreshCw, Play, AlertCircle, Trash2, FileText, CheckCircle } from 'lucide-react'
import { Button } from '../ui/button'
import { useAutonomousStore } from '@renderer/stores/autonomous-store'
import { useSessionStore } from '@renderer/stores/session-store'
import { cn } from '@renderer/lib/utils'
import type { ExistingSessionInfo, DraftMetadata } from '../../../preload/index'

// Drafts dialog state
interface DraftsDialogState {
  isOpen: boolean
  projectPath: string
  projectName: string
  isNew: boolean
  drafts: DraftMetadata[]
  isLoading: boolean
}

export function ProjectPicker() {
  const { sessions } = useSessionStore()
  const { setSelectedProject, goToNextPhase, ensureVenv, venvStatus } = useAutonomousStore()
  const [isSelectingFolder, setIsSelectingFolder] = useState(false)
  const [recentProjects, setRecentProjects] = useState<string[]>([])
  const [isVenvReady, setIsVenvReady] = useState(false)
  const [draftsDialog, setDraftsDialog] = useState<DraftsDialogState>({
    isOpen: false,
    projectPath: '',
    projectName: '',
    isNew: false,
    drafts: [],
    isLoading: false
  })
  const [isCheckingSession, setIsCheckingSession] = useState(false)

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

  // Check venv status on mount
  useEffect(() => {
    if (venvStatus?.isValid) {
      setIsVenvReady(true)
    }
  }, [venvStatus])

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

  // Check for existing drafts and show dialog if found
  const checkAndSelectProject = async (path: string, isNew: boolean) => {
    const name = path.split(/[/\\]/).pop() || 'Unknown'
    setIsCheckingSession(true)

    try {
      // Load all drafts for this project
      const result = await window.electron.discovery.listDrafts(path)

      if (result.success && result.drafts && result.drafts.length > 0) {
        // Found existing drafts - show dialog with all of them
        setDraftsDialog({
          isOpen: true,
          projectPath: path,
          projectName: name,
          isNew,
          drafts: result.drafts,
          isLoading: false
        })
      } else {
        // No existing drafts - proceed directly
        await saveToRecent(path)
        setSelectedProject({ path, name, isNew })
        goToNextPhase()
      }
    } catch (error) {
      console.error('Failed to check existing drafts:', error)
      // On error, proceed anyway
      await saveToRecent(path)
      setSelectedProject({ path, name, isNew })
      goToNextPhase()
    } finally {
      setIsCheckingSession(false)
    }
  }

  // Handle selecting and resuming a draft
  const handleSelectDraft = async (draftId: string) => {
    const { projectPath, projectName, isNew } = draftsDialog

    try {
      // Load the selected draft into the current session
      const result = await window.electron.discovery.loadDraft(projectPath, draftId)
      if (!result.success) {
        console.error('Failed to load draft:', result.error)
      }
    } catch (error) {
      console.error('Failed to load draft:', error)
    }

    await saveToRecent(projectPath)
    setSelectedProject({ path: projectPath, name: projectName, isNew })
    setDraftsDialog(prev => ({ ...prev, isOpen: false }))
    goToNextPhase()
  }

  // Handle starting fresh (clear existing session)
  const handleStartFresh = async () => {
    const { projectPath, projectName, isNew } = draftsDialog

    try {
      // Create fresh session (archives current and clears)
      await window.electron.discovery.createFreshSession(projectPath, isNew)
    } catch (error) {
      console.error('Failed to clear session:', error)
    }

    await saveToRecent(projectPath)
    setSelectedProject({ path: projectPath, name: projectName, isNew })
    setDraftsDialog(prev => ({ ...prev, isOpen: false }))
    goToNextPhase()
  }

  // Handle deleting a draft
  const handleDeleteDraft = async (draftId: string, e: React.MouseEvent) => {
    e.stopPropagation() // Prevent selecting the draft
    const { projectPath } = draftsDialog

    try {
      const result = await window.electron.discovery.deleteDraft(projectPath, draftId)
      if (result.success) {
        // Remove from drafts list
        setDraftsDialog(prev => ({
          ...prev,
          drafts: prev.drafts.filter(d => d.id !== draftId)
        }))
      }
    } catch (error) {
      console.error('Failed to delete draft:', error)
    }
  }

  // Close dialog without action
  const handleCancelDialog = () => {
    setDraftsDialog(prev => ({ ...prev, isOpen: false }))
  }

  const handleSelectExisting = async (path: string) => {
    await checkAndSelectProject(path, false)
  }

  const handleBrowseFolder = async () => {
    setIsSelectingFolder(true)
    try {
      const result = await window.electron.dialog.selectFolder()
      if (result.success && result.path) {
        await checkAndSelectProject(result.path, false)
      }
    } finally {
      setIsSelectingFolder(false)
    }
  }

  const handleCreateNew = async () => {
    setIsSelectingFolder(true)
    try {
      const result = await window.electron.dialog.selectFolder()
      if (result.success && result.path) {
        await checkAndSelectProject(result.path, true)
      }
    } finally {
      setIsSelectingFolder(false)
    }
  }

  // Format date for display
  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp)
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  const isDisabled = isSelectingFolder || isCheckingSession

  return (
    <>
      <div className="h-full flex items-center justify-center p-8">
        <div className="max-w-2xl w-full space-y-8">
          {/* Header */}
          <div className="text-center">
            <h2 className="text-2xl font-semibold mb-2">Start Autonomous Coding</h2>
            <p className="text-muted-foreground">
              Choose an existing project to enhance or create a new project from scratch
            </p>
          </div>

          {/* Loading overlay for session check */}
          {isCheckingSession && (
            <div className="flex items-center justify-center gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
              <Loader2 className="h-4 w-4 text-amber-500 animate-spin" />
              <span className="text-sm text-amber-500">
                Checking for existing session...
              </span>
            </div>
          )}

          {/* Options */}
          <div className="grid grid-cols-2 gap-6">
            {/* New Project */}
            <button
              onClick={handleCreateNew}
              disabled={isDisabled}
              className={cn(
                'flex flex-col items-center p-8 rounded-lg border-2 border-dashed',
                'hover:border-amber-500 hover:bg-amber-500/5 transition-colors',
                'focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2',
                isDisabled && 'opacity-50 cursor-not-allowed'
              )}
            >
              <div className="h-16 w-16 rounded-full bg-emerald-500/10 flex items-center justify-center mb-4">
                <FolderPlus className="h-8 w-8 text-emerald-500" />
              </div>
              <h3 className="font-medium text-lg mb-1">New Project</h3>
              <p className="text-sm text-muted-foreground text-center">
                Start fresh with a greenfield project
              </p>
            </button>

            {/* Existing Project */}
            <button
              onClick={handleBrowseFolder}
              disabled={isDisabled}
              className={cn(
                'flex flex-col items-center p-8 rounded-lg border-2 border-dashed',
                'hover:border-amber-500 hover:bg-amber-500/5 transition-colors',
                'focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2',
                isDisabled && 'opacity-50 cursor-not-allowed'
              )}
            >
              <div className="h-16 w-16 rounded-full bg-amber-500/10 flex items-center justify-center mb-4">
                <FolderOpen className="h-8 w-8 text-amber-500" />
              </div>
              <h3 className="font-medium text-lg mb-1">Existing Project</h3>
              <p className="text-sm text-muted-foreground text-center">
                Add features to an existing codebase
              </p>
            </button>
          </div>

          {/* Recent Projects */}
          {allProjectPaths.length > 0 && (
            <div className="space-y-3">
              <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Recent Projects
              </h4>
              <div className="space-y-2">
                {allProjectPaths.slice(0, 5).map((path) => (
                  <button
                    key={path}
                    onClick={() => handleSelectExisting(path)}
                    disabled={isDisabled}
                    className={cn(
                      'w-full flex items-center justify-between p-3 rounded-lg',
                      'bg-secondary/50 hover:bg-secondary transition-colors',
                      'focus:outline-none focus:ring-2 focus:ring-amber-500',
                      isDisabled && 'opacity-50 cursor-not-allowed'
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <FolderOpen className="h-4 w-4 text-muted-foreground" />
                      <div className="text-left">
                        <div className="font-medium text-sm">
                          {path.split(/[/\\]/).pop()}
                        </div>
                        <div className="text-xs text-muted-foreground truncate max-w-md">
                          {path}
                        </div>
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Drafts Timeline Dialog */}
      {draftsDialog.isOpen && draftsDialog.drafts.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={handleCancelDialog}
          />

          {/* Dialog */}
          <div className="relative bg-card border border-border rounded-lg shadow-xl max-w-2xl w-full mx-4 p-6 animate-slide-up max-h-[80vh] flex flex-col">
            {/* Header */}
            <div className="flex items-start gap-4 mb-4">
              <div className="h-10 w-10 rounded-full bg-amber-500/10 flex items-center justify-center flex-shrink-0">
                <FileText className="h-5 w-5 text-amber-500" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold">Previous Drafts Found</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  {draftsDialog.projectName} has {draftsDialog.drafts.length} draft{draftsDialog.drafts.length !== 1 ? 's' : ''}
                </p>
              </div>
            </div>

            {/* Drafts Timeline */}
            <div className="flex-1 overflow-y-auto space-y-3 mb-4 pr-2">
              {draftsDialog.drafts.map((draft, index) => (
                <button
                  key={draft.id}
                  onClick={() => handleSelectDraft(draft.id)}
                  className={cn(
                    'w-full text-left p-4 rounded-lg border transition-all',
                    'hover:border-amber-500 hover:bg-amber-500/5',
                    'focus:outline-none focus:ring-2 focus:ring-amber-500',
                    index === 0 && 'border-amber-500/50 bg-amber-500/5'
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    {/* Left: Timeline marker + Content */}
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      {/* Timeline dot */}
                      <div className="flex flex-col items-center pt-1">
                        <div className={cn(
                          'h-3 w-3 rounded-full',
                          draft.discoveryReady ? 'bg-emerald-500' : 'bg-amber-500',
                          index === 0 && 'ring-2 ring-amber-500/30'
                        )} />
                        {index < draftsDialog.drafts.length - 1 && (
                          <div className="w-0.5 h-8 bg-border mt-1" />
                        )}
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-sm truncate">{draft.name}</span>
                          {index === 0 && (
                            <span className="text-xs bg-amber-500/20 text-amber-500 px-1.5 py-0.5 rounded">
                              Current
                            </span>
                          )}
                          {draft.discoveryReady && (
                            <CheckCircle className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0" />
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mb-2">{draft.description}</p>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {formatDate(draft.updatedAt)}
                          </span>
                          <span>
                            {draft.userMessageCount} msg{draft.userMessageCount !== 1 ? 's' : ''} from you
                          </span>
                        </div>
                        {draft.preview && (
                          <p className="text-xs text-muted-foreground mt-2 italic truncate">
                            "{draft.preview.substring(0, 100)}..."
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Right: Delete button */}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-red-500 hover:bg-red-500/10 flex-shrink-0"
                      onClick={(e) => handleDeleteDraft(draft.id, e)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </button>
              ))}
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-4 border-t border-border">
              <Button
                variant="outline"
                className="flex-1"
                onClick={handleCancelDialog}
              >
                Cancel
              </Button>
              <Button
                variant="outline"
                className="flex-1"
                onClick={handleStartFresh}
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Start Fresh
              </Button>
              <Button
                className="flex-1 bg-amber-500 hover:bg-amber-600 text-white"
                onClick={() => handleSelectDraft(draftsDialog.drafts[0]?.id || 'current')}
              >
                <Play className="h-4 w-4 mr-2" />
                Continue Latest
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

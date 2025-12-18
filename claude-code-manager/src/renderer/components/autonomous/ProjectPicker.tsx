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
 */

import React, { useState, useEffect } from 'react'
import { FolderOpen, FolderPlus, ChevronRight, Clock, Loader2 } from 'lucide-react'
import { Button } from '../ui/button'
import { useAutonomousStore } from '@renderer/stores/autonomous-store'
import { useSessionStore } from '@renderer/stores/session-store'
import { cn } from '@renderer/lib/utils'

export function ProjectPicker() {
  const { sessions } = useSessionStore()
  const { setSelectedProject, goToNextPhase, ensureVenv, venvStatus } = useAutonomousStore()
  const [isSelectingFolder, setIsSelectingFolder] = useState(false)
  const [recentProjects, setRecentProjects] = useState<string[]>([])
  const [isVenvReady, setIsVenvReady] = useState(false)

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

  const handleSelectExisting = async (path: string) => {
    const name = path.split(/[/\\]/).pop() || 'Unknown'
    await saveToRecent(path)
    setSelectedProject({ path, name, isNew: false })
    goToNextPhase()
  }

  const handleBrowseFolder = async () => {
    setIsSelectingFolder(true)
    try {
      const result = await window.electron.dialog.selectFolder()
      if (result.success && result.path) {
        const name = result.path.split(/[/\\]/).pop() || 'Unknown'
        await saveToRecent(result.path)
        setSelectedProject({ path: result.path, name, isNew: false })
        goToNextPhase()
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
        const name = result.path.split(/[/\\]/).pop() || 'New Project'
        await saveToRecent(result.path)
        setSelectedProject({ path: result.path, name, isNew: true })
        goToNextPhase()
      }
    } finally {
      setIsSelectingFolder(false)
    }
  }

  return (
    <div className="h-full flex items-center justify-center p-8">
      <div className="max-w-2xl w-full space-y-8">
        {/* Header */}
        <div className="text-center">
          <h2 className="text-2xl font-semibold mb-2">Start Autonomous Coding</h2>
          <p className="text-muted-foreground">
            Choose an existing project to enhance or create a new project from scratch
          </p>
        </div>

        {/* Options */}
        <div className="grid grid-cols-2 gap-6">
          {/* New Project */}
          <button
            onClick={handleCreateNew}
            disabled={isSelectingFolder}
            className={cn(
              'flex flex-col items-center p-8 rounded-lg border-2 border-dashed',
              'hover:border-primary hover:bg-primary/5 transition-colors',
              'focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2',
              isSelectingFolder && 'opacity-50 cursor-not-allowed'
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
            disabled={isSelectingFolder}
            className={cn(
              'flex flex-col items-center p-8 rounded-lg border-2 border-dashed',
              'hover:border-primary hover:bg-primary/5 transition-colors',
              'focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2',
              isSelectingFolder && 'opacity-50 cursor-not-allowed'
            )}
          >
            <div className="h-16 w-16 rounded-full bg-blue-500/10 flex items-center justify-center mb-4">
              <FolderOpen className="h-8 w-8 text-blue-500" />
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
                  disabled={isSelectingFolder}
                  className={cn(
                    'w-full flex items-center justify-between p-3 rounded-lg',
                    'bg-secondary/50 hover:bg-secondary transition-colors',
                    'focus:outline-none focus:ring-2 focus:ring-primary',
                    isSelectingFolder && 'opacity-50 cursor-not-allowed'
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

        {/* Venv Status Notice - Python venv not required for discovery phase (uses Claude CLI) */}
        {/* Keeping this commented out in case we need Python orchestrator later
        {!isVenvReady && (
          <div className="flex items-center justify-center gap-2 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
            <Loader2 className="h-4 w-4 text-yellow-500 animate-spin" />
            <span className="text-sm text-yellow-500">
              Setting up Python environment...
            </span>
          </div>
        )}
        */}
      </div>
    </div>
  )
}

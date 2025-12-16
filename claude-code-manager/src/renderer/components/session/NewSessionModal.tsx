import React, { useEffect, useState } from 'react'
import { X, FolderOpen, Clock, Trash2 } from 'lucide-react'
import { Button } from '../ui/button'
import { useUIStore } from '@renderer/stores/ui-store'
import { useSessionStore } from '@renderer/stores/session-store'
import { cn } from '@renderer/lib/utils'

export function NewSessionModal() {
  const { showNewSessionModal, setShowNewSessionModal } = useUIStore()
  const { addSession, setLoading } = useSessionStore()
  const [recentProjects, setRecentProjects] = useState<string[]>([])
  const [isCreating, setIsCreating] = useState(false)

  useEffect(() => {
    if (showNewSessionModal) {
      loadRecentProjects()
    }
  }, [showNewSessionModal])

  const loadRecentProjects = async () => {
    const config = await window.electron.config.get()
    setRecentProjects(config.recentProjects || [])
  }

  const handleSelectFolder = async () => {
    const result = await window.electron.dialog.selectFolder()
    if (result.success && result.path) {
      await createSession(result.path)
    }
  }

  const createSession = async (projectPath: string) => {
    setIsCreating(true)
    setLoading(true)

    try {
      console.log(`[NewSession] Creating session for path: ${projectPath}`)
      const result = await window.electron.session.create(projectPath)
      console.log(`[NewSession] Result:`, result)
      if (result.success && result.session) {
        console.log(`[NewSession] Adding session to store:`, result.session)
        addSession(result.session)
        setShowNewSessionModal(false)
      } else {
        console.error('[NewSession] Failed to create session:', result.error)
      }
    } catch (error) {
      console.error('[NewSession] Error creating session:', error)
    }

    setIsCreating(false)
    setLoading(false)
  }

  const removeRecentProject = async (path: string) => {
    const config = await window.electron.config.get()
    const updated = config.recentProjects.filter((p: string) => p !== path)
    await window.electron.config.set('recentProjects', updated)
    setRecentProjects(updated)
  }

  if (!showNewSessionModal) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={() => setShowNewSessionModal(false)}
      />

      {/* Modal */}
      <div className="relative bg-card border border-border rounded-lg shadow-xl w-full max-w-lg mx-4 animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-semibold">New Session</h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShowNewSessionModal(false)}
            className="h-8 w-8"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Content */}
        <div className="p-4">
          {/* Select folder button */}
          <Button
            onClick={handleSelectFolder}
            disabled={isCreating}
            className="w-full h-24 flex flex-col items-center justify-center gap-2 border-2 border-dashed border-border bg-transparent hover:bg-accent"
            variant="ghost"
          >
            <FolderOpen className="h-8 w-8 text-muted-foreground" />
            <span className="text-muted-foreground">
              {isCreating ? 'Creating session...' : 'Select Project Folder'}
            </span>
          </Button>

          {/* Recent projects */}
          {recentProjects.length > 0 && (
            <div className="mt-6">
              <div className="flex items-center gap-2 mb-3">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium text-muted-foreground">
                  Recent Projects
                </span>
              </div>

              <div className="space-y-1 max-h-[200px] overflow-auto">
                {recentProjects.map((path) => (
                  <div
                    key={path}
                    className="group flex items-center gap-2 p-2 rounded-md hover:bg-accent cursor-pointer"
                    onClick={() => createSession(path)}
                  >
                    <FolderOpen className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-sm truncate flex-1">{path}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 opacity-0 group-hover:opacity-100"
                      onClick={(e) => {
                        e.stopPropagation()
                        removeRecentProject(path)
                      }}
                    >
                      <Trash2 className="h-3 w-3 text-muted-foreground" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 p-4 border-t border-border">
          <Button variant="ghost" onClick={() => setShowNewSessionModal(false)}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  )
}

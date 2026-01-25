import React from 'react'
import { FolderOpen, Globe, Settings, ChevronDown, Circle, GitBranch, Bot, Lightbulb, Layers } from 'lucide-react'
import { Button } from '../ui/button'
import { useUIStore } from '@renderer/stores/ui-store'
import { useSessionStore } from '@renderer/stores/session-store'
import { cn, getStatusColor } from '@renderer/lib/utils'

export function Sidebar() {
  const { sidebarOpen, activePanel, setActivePanel } = useUIStore()
  const { sessions, activeSessionId, setActiveSession } = useSessionStore()

  if (!sidebarOpen) return null

  return (
    <div className="w-56 bg-card border-r border-border flex flex-col h-full">
      {/* Sessions section */}
      <div className="flex-1 overflow-auto">
        <div className="p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Sessions
            </span>
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          </div>

          <div className="space-y-1">
            {sessions.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2 px-2">
                No active sessions
              </p>
            ) : (
              sessions.map((session) => (
                <button
                  key={session.id}
                  onClick={() => setActiveSession(session.id)}
                  className={cn(
                    'w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors text-left',
                    session.id === activeSessionId
                      ? 'bg-primary/10 text-foreground'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                  )}
                >
                  <Circle
                    className={cn('h-2 w-2 fill-current', getStatusColor(session.status))}
                  />
                  <span className="truncate flex-1">{session.projectName}</span>
                  {session.editedFiles.length > 0 && (
                    <span className="text-xs bg-yellow-500/20 text-yellow-500 px-1.5 py-0.5 rounded">
                      {session.editedFiles.length}
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>

        <div className="h-px bg-border mx-3" />

        {/* Panels section */}
        <div className="p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Panels
            </span>
          </div>

          <div className="space-y-1">
            <button
              onClick={() => setActivePanel(activePanel === 'files' ? null : 'files')}
              className={cn(
                'w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors',
                activePanel === 'files'
                  ? 'bg-primary/10 text-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              )}
            >
              <FolderOpen className="h-4 w-4" />
              Files
            </button>

            <button
              onClick={() => setActivePanel(activePanel === 'browser' ? null : 'browser')}
              className={cn(
                'w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors',
                activePanel === 'browser'
                  ? 'bg-primary/10 text-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              )}
            >
              <Globe className="h-4 w-4" />
              Browser
            </button>

            <button
              onClick={() => setActivePanel(activePanel === 'worktrees' ? null : 'worktrees')}
              className={cn(
                'w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors',
                activePanel === 'worktrees'
                  ? 'bg-primary/10 text-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              )}
            >
              <GitBranch className="h-4 w-4" />
              Worktrees
            </button>

            <button
              onClick={() => setActivePanel(activePanel === 'autonomous' ? null : 'autonomous')}
              className={cn(
                'w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors',
                activePanel === 'autonomous'
                  ? 'bg-primary/10 text-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              )}
            >
              <Bot className="h-4 w-4" />
              Autonomous
            </button>

            <button
              onClick={() => setActivePanel(activePanel === 'ideas' ? null : 'ideas')}
              className={cn(
                'w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors',
                activePanel === 'ideas'
                  ? 'bg-primary/10 text-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              )}
            >
              <Lightbulb className="h-4 w-4" />
              Ideas
            </button>

            <button
              onClick={() => setActivePanel(activePanel === 'bvs' ? null : 'bvs')}
              className={cn(
                'w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors',
                activePanel === 'bvs'
                  ? 'bg-primary/10 text-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              )}
            >
              <Layers className="h-4 w-4" />
              BVS Workflow
            </button>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-border">
        <button
          onClick={() => {
            console.log('Settings clicked! Current activePanel:', activePanel)
            const newPanel = activePanel === 'settings' ? null : 'settings'
            console.log('Setting activePanel to:', newPanel)
            setActivePanel(newPanel)
          }}
          className={cn(
            'w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors',
            activePanel === 'settings'
              ? 'bg-primary/10 text-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground'
          )}
        >
          <Settings className="h-4 w-4" />
          Settings
        </button>
      </div>
    </div>
  )
}

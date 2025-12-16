import React from 'react'
import { Minus, Square, X, PanelLeft, Plus, Settings, Grid3X3, Maximize2 } from 'lucide-react'
import { Button } from '../ui/button'
import { useUIStore } from '@renderer/stores/ui-store'
import { cn } from '@renderer/lib/utils'

export function TitleBar() {
  const { toggleSidebar, viewMode, setViewMode, setShowNewSessionModal, activePanel, setActivePanel } = useUIStore()

  const handleMinimize = () => window.electron.window.minimize()
  const handleMaximize = () => window.electron.window.maximize()
  const handleClose = () => window.electron.window.close()

  return (
    <div className="h-12 bg-card border-b border-border flex items-center justify-between px-4 drag-region">
      {/* Left section - Window controls (macOS style) + Logo */}
      <div className="flex items-center gap-4 no-drag">
        {/* macOS traffic lights area - hidden on Windows/Linux */}
        <div className="w-16 hidden darwin:block" />

        <Button variant="ghost" size="icon" onClick={toggleSidebar} className="h-8 w-8">
          <PanelLeft className="h-4 w-4" />
        </Button>

        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded bg-primary flex items-center justify-center">
            <span className="text-primary-foreground text-xs font-bold">CC</span>
          </div>
          <span className="font-semibold text-sm">Claude Code Manager</span>
        </div>
      </div>

      {/* Center section - Actions */}
      <div className="flex items-center gap-2 no-drag">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowNewSessionModal(true)}
          className="gap-2"
        >
          <Plus className="h-4 w-4" />
          New Session
        </Button>

        <div className="h-6 w-px bg-border mx-2" />

        <Button
          variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
          size="icon"
          onClick={() => setViewMode('grid')}
          className="h-8 w-8"
        >
          <Grid3X3 className="h-4 w-4" />
        </Button>
        <Button
          variant={viewMode === 'single' ? 'secondary' : 'ghost'}
          size="icon"
          onClick={() => setViewMode('single')}
          className="h-8 w-8"
        >
          <Maximize2 className="h-4 w-4" />
        </Button>
      </div>

      {/* Right section - Window controls (Windows/Linux) */}
      <div className="flex items-center gap-1 no-drag">
        <Button
          variant={activePanel === 'settings' ? 'secondary' : 'ghost'}
          size="icon"
          className="h-8 w-8"
          onClick={() => setActivePanel(activePanel === 'settings' ? null : 'settings')}
        >
          <Settings className="h-4 w-4" />
        </Button>

        <div className="h-6 w-px bg-border mx-2" />

        {/* Windows-style controls */}
        <Button
          variant="ghost"
          size="icon"
          onClick={handleMinimize}
          className="h-8 w-8 rounded-none hover:bg-accent"
        >
          <Minus className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleMaximize}
          className="h-8 w-8 rounded-none hover:bg-accent"
        >
          <Square className="h-3 w-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleClose}
          className="h-8 w-8 rounded-none hover:bg-destructive hover:text-destructive-foreground"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

import React from 'react'
import { X, Grid2X2, Grid3X3, Square, Columns2, Moon, Sun, Monitor } from 'lucide-react'
import { Button } from '../ui/button'
import { useUIStore } from '@renderer/stores/ui-store'
import { cn } from '@renderer/lib/utils'

interface SettingsProps {
  onClose: () => void
}

export function Settings({ onClose }: SettingsProps) {
  const { gridColumns, setGridColumns, theme, setTheme } = useUIStore()

  const layoutOptions = [
    { value: 1, label: 'Single', icon: Square },
    { value: 2, label: '2 Columns', icon: Columns2 },
    { value: 3, label: '3 Columns', icon: Grid2X2 },
    { value: 4, label: '4 Columns', icon: Grid3X3 },
  ]

  const themeOptions = [
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon },
    { value: 'system', label: 'System', icon: Monitor },
  ]

  return (
    <div className="h-full flex flex-col bg-card rounded-lg border border-border overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h2 className="text-lg font-semibold">Settings</h2>
        <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4 space-y-6">
        {/* Layout Section */}
        <div>
          <h3 className="text-sm font-medium mb-3">Session Layout</h3>
          <p className="text-xs text-muted-foreground mb-3">
            Choose how many sessions to display side by side
          </p>
          <div className="grid grid-cols-4 gap-2">
            {layoutOptions.map((option) => (
              <button
                key={option.value}
                onClick={() => setGridColumns(option.value)}
                className={cn(
                  'flex flex-col items-center gap-2 p-3 rounded-lg border transition-colors',
                  gridColumns === option.value
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border hover:bg-accent'
                )}
              >
                <option.icon className="h-6 w-6" />
                <span className="text-xs">{option.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Theme Section */}
        <div>
          <h3 className="text-sm font-medium mb-3">Theme</h3>
          <p className="text-xs text-muted-foreground mb-3">
            Choose your preferred color scheme
          </p>
          <div className="grid grid-cols-3 gap-2">
            {themeOptions.map((option) => (
              <button
                key={option.value}
                onClick={() => setTheme(option.value as 'light' | 'dark' | 'system')}
                className={cn(
                  'flex flex-col items-center gap-2 p-3 rounded-lg border transition-colors',
                  theme === option.value
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border hover:bg-accent'
                )}
              >
                <option.icon className="h-6 w-6" />
                <span className="text-xs">{option.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Auto-launch Section */}
        <div>
          <h3 className="text-sm font-medium mb-3">Session Behavior</h3>
          <div className="space-y-3">
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                defaultChecked
                className="h-4 w-4 rounded border-border"
              />
              <div>
                <span className="text-sm">Auto-launch Claude on new session</span>
                <p className="text-xs text-muted-foreground">
                  Automatically run Claude CLI when creating a new session
                </p>
              </div>
            </label>
          </div>
        </div>

        {/* Keyboard Shortcuts */}
        <div>
          <h3 className="text-sm font-medium mb-3">Keyboard Shortcuts</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">New Session</span>
              <kbd className="px-2 py-0.5 bg-muted rounded text-xs">Ctrl+N</kbd>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Toggle Sidebar</span>
              <kbd className="px-2 py-0.5 bg-muted rounded text-xs">Ctrl+B</kbd>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Close Session</span>
              <kbd className="px-2 py-0.5 bg-muted rounded text-xs">Ctrl+W</kbd>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Switch Session</span>
              <kbd className="px-2 py-0.5 bg-muted rounded text-xs">Ctrl+Tab</kbd>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

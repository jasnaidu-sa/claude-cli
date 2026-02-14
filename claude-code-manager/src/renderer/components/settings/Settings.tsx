import React, { useState, useEffect } from 'react'
import { X, Grid2X2, Grid3X3, Square, Columns2, Moon, Sun, Monitor } from 'lucide-react'
import { Button } from '../ui/button'
import { useUIStore } from '@renderer/stores/ui-store'
import { cn } from '@renderer/lib/utils'
import { ConnectionSettings } from './ConnectionSettings'
import { OpenRouterSettings } from './OpenRouterSettings'
import { SkillsSettings } from './SkillsSettings'
import { useSettingsStore } from '@renderer/stores/settings-store'
import { useWhatsAppStore } from '@renderer/stores/whatsapp-store'
import { useTelegramStore } from '@renderer/stores/telegram-store'

type SettingsTab = 'general' | 'channels' | 'ai-llm' | 'skills'

interface SettingsProps {
  onClose: () => void
}

export function Settings({ onClose }: SettingsProps) {
  const { gridColumns, setGridColumns, theme, setTheme } = useUIStore()
  const [activeTab, setActiveTab] = useState<SettingsTab>('general')

  const {
    channelRouterConfig,
    loadChannelRouterConfig,
    updateChannelRouterConfig,
  } = useSettingsStore()

  const whatsappConnection = useWhatsAppStore((s) => s.connectionState)
  const telegramConnection = useTelegramStore((s) => s.connectionState)

  useEffect(() => {
    if (activeTab === 'channels') {
      loadChannelRouterConfig()
    }
  }, [activeTab, loadChannelRouterConfig])

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

  const tabs: Array<{ key: SettingsTab; label: string }> = [
    { key: 'general', label: 'General' },
    { key: 'channels', label: 'Channels' },
    { key: 'ai-llm', label: 'AI / LLM' },
    { key: 'skills', label: 'Skills' },
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

      {/* Tabs */}
      <div className="flex border-b border-border px-4">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'px-4 py-2 text-sm font-medium border-b-2 transition-colors',
              activeTab === tab.key
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4 space-y-6">
        {/* General Tab */}
        {activeTab === 'general' && (
          <>
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

            {/* Connection Settings (Remote Access) */}
            <div className="border-t border-border pt-6">
              <ConnectionSettings />
            </div>
          </>
        )}

        {/* Channels Tab */}
        {activeTab === 'channels' && (
          <>
            {/* Channel Status */}
            <div>
              <h3 className="text-sm font-medium mb-3">Channel Status</h3>
              <div className="space-y-2">
                <div className="flex items-center justify-between p-3 rounded-lg border border-border">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'h-2 w-2 rounded-full',
                        whatsappConnection.status === 'connected' ? 'bg-green-500' : 'bg-zinc-500',
                      )}
                    />
                    <span className="text-sm">WhatsApp</span>
                  </div>
                  <span className="text-xs text-muted-foreground capitalize">
                    {whatsappConnection.status}
                  </span>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg border border-border">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'h-2 w-2 rounded-full',
                        telegramConnection.status === 'connected' ? 'bg-green-500' : 'bg-zinc-500',
                      )}
                    />
                    <span className="text-sm">Telegram</span>
                  </div>
                  <span className="text-xs text-muted-foreground capitalize">
                    {telegramConnection.status}
                  </span>
                </div>
              </div>
            </div>

            {/* Channel Router Config */}
            {channelRouterConfig && (
              <>
                <div>
                  <h3 className="text-sm font-medium mb-3">Default Channels</h3>
                  <p className="text-xs text-muted-foreground mb-2">
                    Which channels receive messages by default
                  </p>
                  <div className="space-y-2">
                    {(['whatsapp', 'telegram'] as const).map((ch) => (
                      <label key={ch} className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={channelRouterConfig.defaultChannels.includes(ch)}
                          onChange={(e) => {
                            const channels = e.target.checked
                              ? [...channelRouterConfig.defaultChannels, ch]
                              : channelRouterConfig.defaultChannels.filter((c) => c !== ch)
                            updateChannelRouterConfig({ defaultChannels: channels })
                          }}
                          className="h-4 w-4 rounded border-border"
                        />
                        <span className="text-sm capitalize">{ch}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={channelRouterConfig.crossChannelForwarding}
                      onChange={(e) =>
                        updateChannelRouterConfig({ crossChannelForwarding: e.target.checked })
                      }
                      className="h-4 w-4 rounded border-border"
                    />
                    <div>
                      <span className="text-sm">Cross-Channel Forwarding</span>
                      <p className="text-xs text-muted-foreground">
                        Forward messages between WhatsApp and Telegram
                      </p>
                    </div>
                  </label>
                </div>

                <div>
                  <h3 className="text-sm font-medium mb-2">Primary Notification Channel</h3>
                  <select
                    value={channelRouterConfig.primaryNotificationChannel}
                    onChange={(e) =>
                      updateChannelRouterConfig({
                        primaryNotificationChannel: e.target.value as 'whatsapp' | 'telegram',
                      })
                    }
                    className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  >
                    <option value="whatsapp">WhatsApp</option>
                    <option value="telegram">Telegram</option>
                  </select>
                  <p className="text-xs text-muted-foreground mt-1">
                    Where automated notifications and digests are sent
                  </p>
                </div>
              </>
            )}

            {!channelRouterConfig && (
              <p className="text-xs text-muted-foreground">
                Channel router not initialized. Start the app with at least one channel configured.
              </p>
            )}
          </>
        )}

        {/* AI / LLM Tab */}
        {activeTab === 'ai-llm' && <OpenRouterSettings />}

        {/* Skills Tab */}
        {activeTab === 'skills' && <SkillsSettings />}
      </div>
    </div>
  )
}

/**
 * WhatsApp Settings Panel
 *
 * Tabbed settings: General, Heartbeat, Memory, Identity, Tasks, Advanced.
 */

import React, { useState, useEffect } from 'react'
import {
  X,
  Settings2,
  Heart,
  Brain,
  User,
  Clock,
  Wrench,
  Save,
  Loader2,
} from 'lucide-react'
import { Button } from '../ui/button'
import { useWhatsAppStore } from '@renderer/stores/whatsapp-store'
import { cn } from '@renderer/lib/utils'
import type { WhatsAppConfig } from '@shared/whatsapp-types'

type SettingsTab = 'general' | 'heartbeat' | 'memory' | 'identity' | 'tasks' | 'advanced'

const TABS: { value: SettingsTab; label: string; icon: React.ElementType }[] = [
  { value: 'general', label: 'General', icon: Settings2 },
  { value: 'heartbeat', label: 'Heartbeat', icon: Heart },
  { value: 'memory', label: 'Memory', icon: Brain },
  { value: 'identity', label: 'Identity', icon: User },
  { value: 'tasks', label: 'Tasks', icon: Clock },
  { value: 'advanced', label: 'Advanced', icon: Wrench },
]

interface WhatsAppSettingsProps {
  onClose: () => void
}

export function WhatsAppSettings({ onClose }: WhatsAppSettingsProps) {
  const { memoryStats, tasks, heartbeatRunning, loadTasks } = useWhatsAppStore()
  const [activeTab, setActiveTab] = useState<SettingsTab>('general')
  const [config, setConfig] = useState<Partial<WhatsAppConfig> | null>(null)
  const [saving, setSaving] = useState(false)
  const [identityContent, setIdentityContent] = useState<{
    soul: string
    user: string
    heartbeat: string
  }>({ soul: '', user: '', heartbeat: '' })

  // Load config on mount
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const result = await window.electron.whatsapp.configGet()
        if (result.success && result.data) {
          setConfig(result.data)
        }
      } catch (err) {
        console.error('[WhatsAppSettings] Load config error:', err)
      }
    }
    loadConfig()
  }, [])

  // Load identity on mount
  useEffect(() => {
    const loadIdentity = async () => {
      try {
        const result = await window.electron.whatsapp.identityGet()
        if (result.success && result.data) {
          setIdentityContent({
            soul: result.data.soulMd || '',
            user: result.data.userMd || '',
            heartbeat: result.data.heartbeatMd || '',
          })
        }
      } catch (err) {
        console.error('[WhatsAppSettings] Load identity error:', err)
      }
    }
    loadIdentity()
  }, [])

  // Load tasks on mount
  useEffect(() => {
    loadTasks()
  }, [loadTasks])

  const saveConfigField = async (key: string, value: unknown) => {
    setSaving(true)
    try {
      await window.electron.whatsapp.configSet(key, value)
      setConfig((prev) => (prev ? { ...prev, [key]: value } : prev))
    } catch (err) {
      console.error('[WhatsAppSettings] Save config error:', err)
    } finally {
      setSaving(false)
    }
  }

  const saveIdentity = async (field: 'soul' | 'user' | 'heartbeat') => {
    setSaving(true)
    try {
      await window.electron.whatsapp.identityUpdate(field, identityContent[field])
    } catch (err) {
      console.error('[WhatsAppSettings] Save identity error:', err)
    } finally {
      setSaving(false)
    }
  }

  const renderTabContent = () => {
    if (!config) {
      return (
        <div className="flex items-center justify-center h-32">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )
    }

    switch (activeTab) {
      case 'general':
        return (
          <div className="space-y-4">
            <SettingsField label="Assistant Name">
              <input
                type="text"
                value={config.assistantName || 'Claude'}
                onChange={(e) => saveConfigField('assistantName', e.target.value)}
                className="settings-input"
              />
            </SettingsField>
            <SettingsField label="Trigger Pattern (Groups)">
              <input
                type="text"
                value={config.defaultTriggerPattern || '^@Claude\\b'}
                onChange={(e) => saveConfigField('defaultTriggerPattern', e.target.value)}
                className="settings-input"
              />
            </SettingsField>
            <SettingsField label="Default Mode">
              <select
                value={config.defaultAgentMode || 'auto'}
                onChange={(e) => saveConfigField('defaultAgentMode', e.target.value)}
                className="settings-input"
              >
                <option value="auto">Auto</option>
                <option value="chat">Chat</option>
                <option value="quick_fix">Quick Fix</option>
                <option value="research">Research</option>
                <option value="bvs_spawn">BVS Spawn</option>
              </select>
            </SettingsField>
            <SettingsField label="Debounce (ms)">
              <input
                type="number"
                value={config.debounceMs || 2000}
                onChange={(e) => saveConfigField('debounceMs', parseInt(e.target.value))}
                className="settings-input"
              />
            </SettingsField>
            <SettingsField label="Rate Limit (per minute)">
              <input
                type="number"
                value={config.rateLimitPerMinute || 10}
                onChange={(e) => saveConfigField('rateLimitPerMinute', parseInt(e.target.value))}
                className="settings-input"
              />
            </SettingsField>
          </div>
        )

      case 'heartbeat':
        return (
          <div className="space-y-4">
            <SettingsField label="Heartbeat Enabled">
              <ToggleSwitch
                checked={config.heartbeat?.enabled ?? false}
                onChange={(v) => saveConfigField('heartbeat', { ...config.heartbeat, enabled: v })}
              />
            </SettingsField>
            <SettingsField label="Interval (minutes)">
              <input
                type="number"
                value={(config.heartbeat?.intervalMs ?? 1800000) / 60000}
                onChange={(e) =>
                  saveConfigField('heartbeat', {
                    ...config.heartbeat,
                    intervalMs: parseInt(e.target.value) * 60000,
                  })
                }
                className="settings-input"
              />
            </SettingsField>
            <SettingsField label="Target Conversation JID">
              <input
                type="text"
                value={config.heartbeat?.targetConversationJid || ''}
                onChange={(e) =>
                  saveConfigField('heartbeat', {
                    ...config.heartbeat,
                    targetConversationJid: e.target.value,
                  })
                }
                className="settings-input"
                placeholder="self@s.whatsapp.net"
              />
            </SettingsField>
            <SettingsField label="Max Budget per Beat (USD)">
              <input
                type="number"
                step="0.01"
                value={config.heartbeat?.maxBudgetPerBeatUsd ?? 0.10}
                onChange={(e) =>
                  saveConfigField('heartbeat', {
                    ...config.heartbeat,
                    maxBudgetPerBeatUsd: parseFloat(e.target.value),
                  })
                }
                className="settings-input"
              />
            </SettingsField>
            <div className="text-xs text-muted-foreground">
              Status: {heartbeatRunning ? 'Running' : 'Stopped'}
            </div>
          </div>
        )

      case 'memory':
        return (
          <div className="space-y-4">
            <SettingsField label="Memory Enabled">
              <ToggleSwitch
                checked={config.memory?.enabled ?? true}
                onChange={(v) => saveConfigField('memory', { ...config.memory, enabled: v })}
              />
            </SettingsField>
            <SettingsField label="Embedding Provider">
              <select
                value={config.memory?.embeddingProvider || 'local'}
                onChange={(e) =>
                  saveConfigField('memory', { ...config.memory, embeddingProvider: e.target.value })
                }
                className="settings-input"
              >
                <option value="local">Local (all-MiniLM-L6-v2)</option>
                <option value="voyage">Voyage AI</option>
                <option value="openai">OpenAI</option>
              </select>
            </SettingsField>
            <SettingsField label="Auto-Index Conversations">
              <ToggleSwitch
                checked={config.memory?.autoIndexConversations ?? true}
                onChange={(v) =>
                  saveConfigField('memory', { ...config.memory, autoIndexConversations: v })
                }
              />
            </SettingsField>
            {memoryStats && (
              <div className="bg-muted rounded-md p-3 text-sm space-y-1">
                <div>Chunks: {memoryStats.totalChunks}</div>
                <div>Sources: {memoryStats.totalSources}</div>
                <div>DB Size: {(memoryStats.dbSizeBytes / 1024 / 1024).toFixed(2)} MB</div>
              </div>
            )}
          </div>
        )

      case 'identity':
        return (
          <div className="space-y-4">
            {(['soul', 'user', 'heartbeat'] as const).map((field) => (
              <div key={field}>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-sm font-medium capitalize">{field}.md</label>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => saveIdentity(field)}
                    disabled={saving}
                  >
                    <Save className="h-3 w-3 mr-1" />
                    Save
                  </Button>
                </div>
                <textarea
                  value={identityContent[field]}
                  onChange={(e) =>
                    setIdentityContent((prev) => ({ ...prev, [field]: e.target.value }))
                  }
                  rows={6}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary resize-y"
                />
              </div>
            ))}
          </div>
        )

      case 'tasks':
        return (
          <div className="space-y-3">
            {tasks.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No scheduled tasks
              </p>
            ) : (
              tasks.map((task) => (
                <div key={task.id} className="bg-muted rounded-md p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{task.name}</span>
                    <span
                      className={cn(
                        'text-[10px] px-1.5 py-0.5 rounded',
                        task.status === 'active' && 'bg-green-500/20 text-green-500',
                        task.status === 'paused' && 'bg-yellow-500/20 text-yellow-500',
                        task.status === 'completed' && 'bg-blue-500/20 text-blue-500',
                        task.status === 'failed' && 'bg-red-500/20 text-red-500'
                      )}
                    >
                      {task.status}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {task.scheduleType}: {task.scheduleValue} · Runs: {task.runCount}
                  </div>
                </div>
              ))
            )}
          </div>
        )

      case 'advanced':
        return (
          <div className="space-y-4">
            <SettingsField label="Auto-Connect on Launch">
              <ToggleSwitch
                checked={config.autoConnect ?? true}
                onChange={(v) => saveConfigField('autoConnect', v)}
              />
            </SettingsField>
            <SettingsField label="Self-Chat Mode">
              <ToggleSwitch
                checked={config.selfChatMode ?? false}
                onChange={(v) => saveConfigField('selfChatMode', v)}
              />
            </SettingsField>
            <SettingsField label="Max Concurrent Agents">
              <input
                type="number"
                value={config.maxConcurrentAgents || 3}
                onChange={(e) => saveConfigField('maxConcurrentAgents', parseInt(e.target.value))}
                className="settings-input"
                min={1}
                max={10}
              />
            </SettingsField>
            <SettingsField label="Message Chunk Limit">
              <input
                type="number"
                value={config.messageChunkLimit || 4000}
                onChange={(e) => saveConfigField('messageChunkLimit', parseInt(e.target.value))}
                className="settings-input"
              />
            </SettingsField>
            <SettingsField label="Ack Reaction Emoji">
              <input
                type="text"
                value={config.ackReactionEmoji || '\u26A1'}
                onChange={(e) => saveConfigField('ackReactionEmoji', e.target.value)}
                className="settings-input"
              />
            </SettingsField>
          </div>
        )
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-border">
        <h3 className="text-sm font-semibold">Settings</h3>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 p-2 border-b border-border">
        {TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setActiveTab(tab.value)}
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors',
              activeTab === tab.value
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-accent'
            )}
          >
            <tab.icon className="h-3 w-3" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-3">{renderTabContent()}</div>

      <style>{`
        .settings-input {
          width: 100%;
          padding: 0.375rem 0.75rem;
          font-size: 0.8125rem;
          border-radius: 0.375rem;
          border: 1px solid hsl(var(--border));
          background: hsl(var(--background));
        }
        .settings-input:focus {
          outline: none;
          box-shadow: 0 0 0 1px hsl(var(--primary));
        }
      `}</style>
    </div>
  )
}

// Helper components

function SettingsField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground block mb-1">{label}</label>
      {children}
    </div>
  )
}

function ToggleSwitch({
  checked,
  onChange,
}: {
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
        checked ? 'bg-primary' : 'bg-muted-foreground/30'
      )}
    >
      <span
        className={cn(
          'inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform',
          checked ? 'translate-x-[18px]' : 'translate-x-[3px]'
        )}
      />
    </button>
  )
}

export default WhatsAppSettings

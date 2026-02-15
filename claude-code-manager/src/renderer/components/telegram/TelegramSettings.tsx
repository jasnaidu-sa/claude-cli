/**
 * TelegramSettings - Tabbed settings panel for Telegram bot configuration.
 *
 * General tab: Bot token, allowed user IDs, polling interval
 * Channel tab: Primary chat ID, notification preferences
 * Routing tab: Multi-group routing rules by output category
 */

import React, { useEffect, useState, useCallback } from 'react'
import { ArrowLeft, Plus, Trash2, Save, ToggleLeft, ToggleRight } from 'lucide-react'
import { Button } from '../ui/button'
import { useTelegramStore } from '@renderer/stores/telegram-store'
import { cn } from '@renderer/lib/utils'
import type { TelegramConfig, TelegramRoutingRule, OutputCategory } from '@shared/channel-types'

type SettingsTab = 'general' | 'channel' | 'routing'

const OUTPUT_CATEGORIES: { value: OutputCategory; label: string }[] = [
  { value: 'bvs:notification', label: 'BVS Notification' },
  { value: 'bvs:approval', label: 'BVS Approval' },
  { value: 'skill:output', label: 'Skill Output' },
  { value: 'skill:digest', label: 'Skill Digest' },
  { value: 'agent:chat', label: 'Agent Chat' },
  { value: 'agent:error', label: 'Agent Error' },
  { value: 'system:heartbeat', label: 'System Heartbeat' },
  { value: 'system:alert', label: 'System Alert' },
]

interface TelegramSettingsProps {
  onClose: () => void
}

export function TelegramSettings({ onClose }: TelegramSettingsProps) {
  const { config, setConfig } = useTelegramStore()
  const [activeTab, setActiveTab] = useState<SettingsTab>('general')
  const [localConfig, setLocalConfig] = useState<TelegramConfig>({
    enabled: true,
    botToken: '',
    allowedUserIds: [],
    allowedChatIds: [],
    primaryChatId: null,
    useWebhook: false,
    triggerPattern: '',
    routingRules: [],
    autoCreateGroups: false,
    fallbackChatId: null,
  })
  const [newUserId, setNewUserId] = useState('')
  const [newChatId, setNewChatId] = useState('')
  const [saving, setSaving] = useState(false)

  // Routing rules state
  const [routingRules, setRoutingRules] = useState<TelegramRoutingRule[]>([])
  const [newRuleCategory, setNewRuleCategory] = useState<OutputCategory>('skill:digest')
  const [newRuleChatId, setNewRuleChatId] = useState('')
  const [newRuleChatName, setNewRuleChatName] = useState('')
  const [newRulePriority, setNewRulePriority] = useState(0)
  const [newRuleEnabled, setNewRuleEnabled] = useState(true)
  const [routingSaving, setRoutingSaving] = useState(false)

  useEffect(() => {
    if (config) {
      setLocalConfig(config)
    } else if (window.electron.telegram) {
      window.electron.telegram.configGet().then((result) => {
        if (result.success && result.data) {
          setLocalConfig(result.data)
          setConfig(result.data)
        }
      })
    }
  }, [config, setConfig])

  const loadRoutingRules = useCallback(async () => {
    if (!window.electron.telegram) return
    const result = await window.electron.telegram.routingRulesGet()
    if (result.success && result.data) {
      setRoutingRules(result.data)
    }
  }, [])

  useEffect(() => {
    if (activeTab === 'routing') {
      loadRoutingRules()
    }
  }, [activeTab, loadRoutingRules])

  const handleSave = async () => {
    if (!window.electron.telegram) return
    setSaving(true)
    try {
      await window.electron.telegram.configSet(localConfig)
      setConfig(localConfig)
    } catch (err) {
      console.error('[TelegramSettings] Save error:', err)
    }
    setSaving(false)
  }

  const addUserId = () => {
    const id = parseInt(newUserId, 10)
    if (!isNaN(id) && !localConfig.allowedUserIds.includes(id)) {
      setLocalConfig({
        ...localConfig,
        allowedUserIds: [...localConfig.allowedUserIds, id],
      })
      setNewUserId('')
    }
  }

  const removeUserId = (id: number) => {
    setLocalConfig({
      ...localConfig,
      allowedUserIds: localConfig.allowedUserIds.filter((uid) => uid !== id),
    })
  }

  const addChatId = () => {
    const id = parseInt(newChatId, 10)
    if (!isNaN(id) && !localConfig.allowedChatIds.includes(id)) {
      setLocalConfig({
        ...localConfig,
        allowedChatIds: [...localConfig.allowedChatIds, id],
      })
      setNewChatId('')
    }
  }

  const removeChatId = (id: number) => {
    setLocalConfig({
      ...localConfig,
      allowedChatIds: localConfig.allowedChatIds.filter((cid) => cid !== id),
    })
  }

  // Routing rule CRUD
  const addRoutingRule = async () => {
    if (!newRuleChatId.trim()) return
    setRoutingSaving(true)
    const rule: TelegramRoutingRule = {
      id: `rule-${Date.now()}`,
      category: newRuleCategory,
      chatId: newRuleChatId.trim(),
      chatName: newRuleChatName.trim() || undefined,
      enabled: newRuleEnabled,
      priority: newRulePriority,
    }
    const result = await window.electron.telegram.routingRulesUpsert(rule)
    if (result.success) {
      await loadRoutingRules()
      setNewRuleChatId('')
      setNewRuleChatName('')
      setNewRulePriority(0)
      setNewRuleEnabled(true)
    }
    setRoutingSaving(false)
  }

  const toggleRuleEnabled = async (rule: TelegramRoutingRule) => {
    const updated = { ...rule, enabled: !rule.enabled }
    await window.electron.telegram.routingRulesUpsert(updated)
    await loadRoutingRules()
  }

  const deleteRoutingRule = async (ruleId: string) => {
    await window.electron.telegram.routingRulesDelete(ruleId)
    await loadRoutingRules()
  }

  const getCategoryLabel = (cat: OutputCategory | OutputCategory[]): string => {
    if (Array.isArray(cat)) {
      return cat.map((c) => OUTPUT_CATEGORIES.find((o) => o.value === c)?.label ?? c).join(', ')
    }
    return OUTPUT_CATEGORIES.find((o) => o.value === cat)?.label ?? cat
  }

  const getCategoryColor = (cat: OutputCategory | OutputCategory[]): string => {
    const first = Array.isArray(cat) ? cat[0] : cat
    if (first.startsWith('bvs:')) return 'bg-purple-500/20 text-purple-300'
    if (first.startsWith('skill:')) return 'bg-blue-500/20 text-blue-300'
    if (first.startsWith('agent:')) return 'bg-green-500/20 text-green-300'
    if (first.startsWith('system:')) return 'bg-orange-500/20 text-orange-300'
    return 'bg-muted text-muted-foreground'
  }

  const tabs: Array<{ key: SettingsTab; label: string }> = [
    { key: 'general', label: 'General' },
    { key: 'channel', label: 'Channel' },
    { key: 'routing', label: 'Routing' },
  ]

  return (
    <div className="h-full flex flex-col bg-card rounded-lg border border-border overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h2 className="text-lg font-semibold">Telegram Settings</h2>
        </div>
        <Button size="sm" onClick={handleSave} disabled={saving}>
          <Save className="h-4 w-4 mr-1" />
          {saving ? 'Saving...' : 'Save'}
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
        {activeTab === 'general' && (
          <>
            {/* Bot Token */}
            <div>
              <label className="text-sm font-medium mb-1 block">Bot Token</label>
              <input
                type="password"
                value={localConfig.botToken}
                onChange={(e) =>
                  setLocalConfig({ ...localConfig, botToken: e.target.value })
                }
                placeholder="Enter your Telegram bot token..."
                className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Get a token from @BotFather on Telegram
              </p>
            </div>

            {/* Enabled */}
            <div>
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={localConfig.enabled}
                  onChange={(e) =>
                    setLocalConfig({ ...localConfig, enabled: e.target.checked })
                  }
                  className="h-4 w-4 rounded border-border"
                />
                <div>
                  <span className="text-sm">Enable Telegram Bot</span>
                  <p className="text-xs text-muted-foreground">
                    Auto-connect on app startup
                  </p>
                </div>
              </label>
            </div>

            {/* Allowed User IDs */}
            <div>
              <label className="text-sm font-medium mb-2 block">
                Allowed User IDs
              </label>
              <p className="text-xs text-muted-foreground mb-2">
                Leave empty to allow all users. Add IDs to restrict access.
              </p>
              <div className="flex gap-2 mb-2">
                <input
                  type="number"
                  value={newUserId}
                  onChange={(e) => setNewUserId(e.target.value)}
                  placeholder="User ID"
                  className="flex-1 px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  onKeyDown={(e) => e.key === 'Enter' && addUserId()}
                />
                <Button variant="outline" size="sm" onClick={addUserId}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex flex-wrap gap-1">
                {localConfig.allowedUserIds.map((id) => (
                  <span
                    key={id}
                    className="flex items-center gap-1 text-xs bg-muted px-2 py-1 rounded-md"
                  >
                    {id}
                    <button
                      onClick={() => removeUserId(id)}
                      className="text-muted-foreground hover:text-red-500"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            </div>

            {/* Trigger Pattern */}
            <div>
              <label className="text-sm font-medium mb-1 block">
                Group Trigger Pattern
              </label>
              <input
                type="text"
                value={localConfig.triggerPattern}
                onChange={(e) =>
                  setLocalConfig({ ...localConfig, triggerPattern: e.target.value })
                }
                placeholder="e.g. /ask or @botname"
                className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Pattern to trigger the bot in group chats
              </p>
            </div>
          </>
        )}

        {activeTab === 'channel' && (
          <>
            {/* Primary Chat ID */}
            <div>
              <label className="text-sm font-medium mb-1 block">
                Primary Chat ID
              </label>
              <input
                type="number"
                value={localConfig.primaryChatId ?? ''}
                onChange={(e) =>
                  setLocalConfig({
                    ...localConfig,
                    primaryChatId: e.target.value ? parseInt(e.target.value, 10) : null,
                  })
                }
                placeholder="Chat ID for notifications"
                className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Where to send automated notifications and digests
              </p>
            </div>

            {/* Allowed Chat IDs */}
            <div>
              <label className="text-sm font-medium mb-2 block">
                Allowed Chat IDs
              </label>
              <p className="text-xs text-muted-foreground mb-2">
                Restrict which chats can interact with the bot.
              </p>
              <div className="flex gap-2 mb-2">
                <input
                  type="number"
                  value={newChatId}
                  onChange={(e) => setNewChatId(e.target.value)}
                  placeholder="Chat ID"
                  className="flex-1 px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  onKeyDown={(e) => e.key === 'Enter' && addChatId()}
                />
                <Button variant="outline" size="sm" onClick={addChatId}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex flex-wrap gap-1">
                {localConfig.allowedChatIds.map((id) => (
                  <span
                    key={id}
                    className="flex items-center gap-1 text-xs bg-muted px-2 py-1 rounded-md"
                  >
                    {id}
                    <button
                      onClick={() => removeChatId(id)}
                      className="text-muted-foreground hover:text-red-500"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            </div>

            {/* Webhook Mode */}
            <div>
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={localConfig.useWebhook}
                  onChange={(e) =>
                    setLocalConfig({ ...localConfig, useWebhook: e.target.checked })
                  }
                  className="h-4 w-4 rounded border-border"
                />
                <div>
                  <span className="text-sm">Use Webhook Mode</span>
                  <p className="text-xs text-muted-foreground">
                    Use webhooks instead of polling (requires public URL)
                  </p>
                </div>
              </label>
            </div>

            {localConfig.useWebhook && (
              <div>
                <label className="text-sm font-medium mb-1 block">
                  Webhook URL
                </label>
                <input
                  type="text"
                  value={localConfig.webhookUrl || ''}
                  onChange={(e) =>
                    setLocalConfig({ ...localConfig, webhookUrl: e.target.value })
                  }
                  placeholder="https://your-domain.com/webhook"
                  className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
            )}
          </>
        )}

        {activeTab === 'routing' && (
          <>
            <p className="text-xs text-muted-foreground">
              Route bot output to different Telegram groups by category. Each rule maps an output category to a specific chat/group.
            </p>

            {/* Add Rule Form */}
            <div className="border border-border rounded-lg p-4 space-y-3">
              <h3 className="text-sm font-medium">Add Routing Rule</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Category</label>
                  <select
                    value={newRuleCategory}
                    onChange={(e) => setNewRuleCategory(e.target.value as OutputCategory)}
                    className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  >
                    {OUTPUT_CATEGORIES.map((cat) => (
                      <option key={cat.value} value={cat.value}>
                        {cat.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Chat ID</label>
                  <input
                    type="text"
                    value={newRuleChatId}
                    onChange={(e) => setNewRuleChatId(e.target.value)}
                    placeholder="-1001234567890"
                    className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Chat Name (optional)</label>
                  <input
                    type="text"
                    value={newRuleChatName}
                    onChange={(e) => setNewRuleChatName(e.target.value)}
                    placeholder="e.g. Digest Group"
                    className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
                <div className="flex gap-3 items-end">
                  <div className="flex-1">
                    <label className="text-xs text-muted-foreground mb-1 block">Priority</label>
                    <input
                      type="number"
                      value={newRulePriority}
                      onChange={(e) => setNewRulePriority(parseInt(e.target.value, 10) || 0)}
                      className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                  </div>
                  <label className="flex items-center gap-2 pb-2">
                    <input
                      type="checkbox"
                      checked={newRuleEnabled}
                      onChange={(e) => setNewRuleEnabled(e.target.checked)}
                      className="h-4 w-4 rounded border-border"
                    />
                    <span className="text-xs">Enabled</span>
                  </label>
                </div>
              </div>
              <Button
                size="sm"
                onClick={addRoutingRule}
                disabled={routingSaving || !newRuleChatId.trim()}
              >
                <Plus className="h-4 w-4 mr-1" />
                {routingSaving ? 'Adding...' : 'Add Rule'}
              </Button>
            </div>

            {/* Existing Rules */}
            <div className="space-y-2">
              <h3 className="text-sm font-medium">
                Active Rules ({routingRules.length})
              </h3>
              {routingRules.length === 0 && (
                <p className="text-xs text-muted-foreground py-4 text-center">
                  No routing rules configured. Add one above to route output to specific groups.
                </p>
              )}
              {routingRules
                .sort((a, b) => b.priority - a.priority)
                .map((rule) => (
                  <div
                    key={rule.id}
                    className={cn(
                      'flex items-center gap-3 p-3 rounded-lg border border-border',
                      !rule.enabled && 'opacity-50',
                    )}
                  >
                    <span
                      className={cn(
                        'text-xs px-2 py-0.5 rounded-full font-medium',
                        getCategoryColor(rule.category),
                      )}
                    >
                      {getCategoryLabel(rule.category)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-mono truncate">{rule.chatId}</div>
                      {rule.chatName && (
                        <div className="text-xs text-muted-foreground">{rule.chatName}</div>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">P{rule.priority}</span>
                    <button
                      onClick={() => toggleRuleEnabled(rule)}
                      className="text-muted-foreground hover:text-foreground"
                      title={rule.enabled ? 'Disable' : 'Enable'}
                    >
                      {rule.enabled ? (
                        <ToggleRight className="h-5 w-5 text-green-400" />
                      ) : (
                        <ToggleLeft className="h-5 w-5" />
                      )}
                    </button>
                    <button
                      onClick={() => deleteRoutingRule(rule.id)}
                      className="text-muted-foreground hover:text-red-500"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
            </div>

            {/* Fallback Chat ID */}
            <div>
              <label className="text-sm font-medium mb-1 block">
                Fallback Chat ID
              </label>
              <input
                type="text"
                value={localConfig.fallbackChatId ?? ''}
                onChange={(e) =>
                  setLocalConfig({
                    ...localConfig,
                    fallbackChatId: e.target.value || null,
                  })
                }
                placeholder="Chat ID for unmatched categories"
                className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Messages that don't match any routing rule are sent here
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/**
 * OpenRouterSettings - Config panel for OpenRouter API + LLM Routing.
 *
 * - API key input with test button
 * - Default model dropdown
 * - LLM routing table (task -> provider -> model)
 * - Usage stats display
 */

import React, { useEffect, useState } from 'react'
import { Key, TestTube2, RotateCcw, Plus, Trash2, Save } from 'lucide-react'
import { Button } from '../ui/button'
import { useSettingsStore } from '@renderer/stores/settings-store'
import { cn } from '@renderer/lib/utils'
import type { LlmRoutingEntry } from '@shared/skills-types'

const KNOWN_MODELS = [
  'deepseek/deepseek-chat-v3-0324',
  'anthropic/claude-sonnet-4-20250514',
  'anthropic/claude-haiku-4-20250414',
  'google/gemini-2.5-flash-preview',
  'openai/gpt-4o',
  'openai/gpt-4o-mini',
  'meta-llama/llama-3.3-70b-instruct',
]

const DEFAULT_TASKS = [
  'digest',
  'skill_execution',
  'keyword_response',
  'summarization',
  'code_review',
]

export function OpenRouterSettings() {
  const {
    openRouterConfig,
    openRouterStats,
    llmRouting,
    loadOpenRouterConfig,
    loadOpenRouterStats,
    loadLlmRouting,
    updateOpenRouterConfig,
    resetOpenRouterStats,
    testOpenRouter,
    setLlmRoute,
  } = useSettingsStore()

  const [apiKey, setApiKey] = useState('')
  const [defaultModel, setDefaultModel] = useState('')
  const [testResult, setTestResult] = useState<string | null>(null)
  const [newTask, setNewTask] = useState('')

  useEffect(() => {
    loadOpenRouterConfig()
    loadOpenRouterStats()
    loadLlmRouting()
  }, [loadOpenRouterConfig, loadOpenRouterStats, loadLlmRouting])

  useEffect(() => {
    if (openRouterConfig) {
      setDefaultModel(openRouterConfig.defaultModel || '')
    }
  }, [openRouterConfig])

  const handleSaveApiKey = async () => {
    await updateOpenRouterConfig({ apiKey })
    setApiKey('')
    setTestResult(null)
  }

  const handleTest = async () => {
    const result = await testOpenRouter()
    if (result) {
      setTestResult(result.hasApiKey ? 'API key configured' : 'No API key set')
    } else {
      setTestResult('Test failed - OpenRouter not available')
    }
  }

  const handleModelChange = async (model: string) => {
    setDefaultModel(model)
    await updateOpenRouterConfig({ defaultModel: model })
  }

  const handleRouteChange = async (
    task: string,
    field: keyof LlmRoutingEntry,
    value: string,
  ) => {
    const existing = llmRouting[task] || { provider: 'openrouter', model: '' }
    const updated = { ...existing, [field]: value }
    await setLlmRoute(task, updated as LlmRoutingEntry)
  }

  const handleAddRoute = async () => {
    if (!newTask) return
    await setLlmRoute(newTask, { provider: 'openrouter', model: defaultModel || KNOWN_MODELS[0] })
    setNewTask('')
  }

  const routingEntries = Object.entries(llmRouting)

  return (
    <div className="space-y-6">
      {/* API Key */}
      <div>
        <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
          <Key className="h-4 w-4" />
          OpenRouter API Key
        </h3>
        <div className="flex gap-2">
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={openRouterConfig?.hasApiKey ? '****** (configured)' : 'Enter API key...'}
            className="flex-1 px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
          <Button variant="outline" size="sm" onClick={handleSaveApiKey} disabled={!apiKey}>
            <Save className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={handleTest}>
            <TestTube2 className="h-4 w-4" />
          </Button>
        </div>
        {testResult && (
          <p className={cn('text-xs mt-1', testResult.includes('configured') ? 'text-green-500' : 'text-yellow-500')}>
            {testResult}
          </p>
        )}
      </div>

      {/* Default Model */}
      <div>
        <h3 className="text-sm font-medium mb-2">Default Model</h3>
        <select
          value={defaultModel}
          onChange={(e) => handleModelChange(e.target.value)}
          className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
        >
          <option value="">Select model...</option>
          {KNOWN_MODELS.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </div>

      {/* LLM Routing Table */}
      <div>
        <h3 className="text-sm font-medium mb-2">LLM Routing Rules</h3>
        <p className="text-xs text-muted-foreground mb-3">
          Map task types to specific providers and models
        </p>
        <div className="space-y-2">
          {routingEntries.map(([task, entry]) => (
            <div key={task} className="flex items-center gap-2 p-2 rounded-lg bg-muted/50">
              <span className="text-xs font-mono w-32 truncate" title={task}>
                {task}
              </span>
              <select
                value={entry.provider}
                onChange={(e) => handleRouteChange(task, 'provider', e.target.value)}
                className="px-2 py-1 rounded border border-border bg-background text-xs"
              >
                <option value="openrouter">OpenRouter</option>
                <option value="agent_sdk">Agent SDK</option>
              </select>
              <select
                value={entry.model}
                onChange={(e) => handleRouteChange(task, 'model', e.target.value)}
                className="flex-1 px-2 py-1 rounded border border-border bg-background text-xs"
              >
                {KNOWN_MODELS.map((m) => (
                  <option key={m} value={m}>{m.split('/').pop()}</option>
                ))}
              </select>
            </div>
          ))}

          {/* Add new route */}
          <div className="flex items-center gap-2 pt-2">
            <select
              value={newTask}
              onChange={(e) => setNewTask(e.target.value)}
              className="flex-1 px-2 py-1 rounded border border-border bg-background text-xs"
            >
              <option value="">Add task...</option>
              {DEFAULT_TASKS.filter((t) => !llmRouting[t]).map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <Button variant="outline" size="sm" onClick={handleAddRoute} disabled={!newTask}>
              <Plus className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </div>

      {/* Usage Stats */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium">Usage Statistics</h3>
          <Button variant="ghost" size="sm" onClick={resetOpenRouterStats}>
            <RotateCcw className="h-3 w-3 mr-1" />
            Reset
          </Button>
        </div>
        {openRouterStats ? (
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-lg bg-muted/50">
              <p className="text-xs text-muted-foreground">Total Requests</p>
              <p className="text-lg font-semibold">{openRouterStats.totalRequests}</p>
            </div>
            <div className="p-3 rounded-lg bg-muted/50">
              <p className="text-xs text-muted-foreground">Total Cost</p>
              <p className="text-lg font-semibold">${openRouterStats.totalCostUsd.toFixed(4)}</p>
            </div>
            <div className="p-3 rounded-lg bg-muted/50">
              <p className="text-xs text-muted-foreground">Tokens In</p>
              <p className="text-lg font-semibold">
                {(openRouterStats.totalTokensIn / 1000).toFixed(1)}k
              </p>
            </div>
            <div className="p-3 rounded-lg bg-muted/50">
              <p className="text-xs text-muted-foreground">Tokens Out</p>
              <p className="text-lg font-semibold">
                {(openRouterStats.totalTokensOut / 1000).toFixed(1)}k
              </p>
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No stats available</p>
        )}
      </div>
    </div>
  )
}

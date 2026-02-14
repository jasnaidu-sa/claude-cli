/**
 * Zustand store for Settings panels: OpenRouter, LLM Routing, Skills, Channel Router.
 * Always loads fresh from backend (no persistence).
 */

import { create } from 'zustand'
import type { ChannelRouterConfig } from '@shared/channel-types'
import type { SkillDefinition, LlmRoutingEntry, SkillRuntimeConfig } from '@shared/skills-types'

interface OpenRouterStats {
  totalRequests: number
  totalTokensIn: number
  totalTokensOut: number
  totalCostUsd: number
  byModel: Record<string, { requests: number; tokensIn: number; tokensOut: number; costUsd: number }>
}

interface OpenRouterConfig {
  defaultModel: string
  hasApiKey: boolean
  maxRetries?: number
  timeoutMs?: number
}

interface ScheduledJob {
  skillId: string
  cronExpression: string
  nextRun: number
}

interface AuditEntry {
  skillId: string
  executionCount: number
  totalCostUsd: number
  lastExecuted?: number
  lastError?: string
}

interface SettingsStore {
  // OpenRouter
  openRouterConfig: OpenRouterConfig | null
  openRouterStats: OpenRouterStats | null
  loadOpenRouterConfig: () => Promise<void>
  loadOpenRouterStats: () => Promise<void>
  updateOpenRouterConfig: (config: Record<string, unknown>) => Promise<void>
  resetOpenRouterStats: () => Promise<void>
  testOpenRouter: () => Promise<{ hasApiKey: boolean } | null>

  // LLM Routing
  llmRouting: Record<string, LlmRoutingEntry>
  loadLlmRouting: () => Promise<void>
  setLlmRoute: (task: string, entry: LlmRoutingEntry) => Promise<void>

  // Skills
  skills: SkillDefinition[]
  scheduledJobs: ScheduledJob[]
  auditLog: AuditEntry[]
  loadSkills: () => Promise<void>
  loadScheduledJobs: () => Promise<void>
  loadAuditLog: () => Promise<void>
  toggleSkill: (id: string, active: boolean) => Promise<void>
  executeSkill: (id: string) => Promise<void>

  // Channel Router
  channelRouterConfig: ChannelRouterConfig | null
  loadChannelRouterConfig: () => Promise<void>
  updateChannelRouterConfig: (config: Partial<ChannelRouterConfig>) => Promise<void>

  // Loading states
  loading: Record<string, boolean>
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  // Initial state
  openRouterConfig: null,
  openRouterStats: null,
  llmRouting: {},
  skills: [],
  scheduledJobs: [],
  auditLog: [],
  channelRouterConfig: null,
  loading: {},

  // OpenRouter
  loadOpenRouterConfig: async () => {
    set({ loading: { ...get().loading, openRouterConfig: true } })
    try {
      const result = await window.electron.settings.openRouterConfigGet()
      if (result.success) set({ openRouterConfig: result.data })
    } catch (err) {
      console.error('[SettingsStore] Failed to load OpenRouter config:', err)
    }
    set({ loading: { ...get().loading, openRouterConfig: false } })
  },

  loadOpenRouterStats: async () => {
    try {
      const result = await window.electron.settings.openRouterStatsGet()
      if (result.success) set({ openRouterStats: result.data })
    } catch (err) {
      console.error('[SettingsStore] Failed to load OpenRouter stats:', err)
    }
  },

  updateOpenRouterConfig: async (config) => {
    try {
      const result = await window.electron.settings.openRouterConfigSet(config)
      if (result.success) await get().loadOpenRouterConfig()
    } catch (err) {
      console.error('[SettingsStore] Failed to update OpenRouter config:', err)
    }
  },

  resetOpenRouterStats: async () => {
    try {
      const result = await window.electron.settings.openRouterStatsReset()
      if (result.success) set({ openRouterStats: null })
    } catch (err) {
      console.error('[SettingsStore] Failed to reset stats:', err)
    }
  },

  testOpenRouter: async () => {
    try {
      const result = await window.electron.settings.openRouterTest()
      return result.success ? result.data : null
    } catch (err) {
      return null
    }
  },

  // LLM Routing
  loadLlmRouting: async () => {
    try {
      const result = await window.electron.settings.llmRoutingGet()
      if (result.success) set({ llmRouting: result.data || {} })
    } catch (err) {
      console.error('[SettingsStore] Failed to load LLM routing:', err)
    }
  },

  setLlmRoute: async (task, entry) => {
    try {
      const result = await window.electron.settings.llmRoutingSet(task, entry)
      if (result.success) {
        set({ llmRouting: { ...get().llmRouting, [task]: entry } })
      }
    } catch (err) {
      console.error('[SettingsStore] Failed to set LLM route:', err)
    }
  },

  // Skills
  loadSkills: async () => {
    set({ loading: { ...get().loading, skills: true } })
    try {
      const result = await window.electron.settings.skillsList()
      if (result.success) set({ skills: result.data || [] })
    } catch (err) {
      console.error('[SettingsStore] Failed to load skills:', err)
    }
    set({ loading: { ...get().loading, skills: false } })
  },

  loadScheduledJobs: async () => {
    try {
      const result = await window.electron.settings.skillsScheduledJobs()
      if (result.success) set({ scheduledJobs: result.data || [] })
    } catch (err) {
      console.error('[SettingsStore] Failed to load scheduled jobs:', err)
    }
  },

  loadAuditLog: async () => {
    try {
      const result = await window.electron.settings.skillsAuditLog()
      if (result.success) set({ auditLog: result.data || [] })
    } catch (err) {
      console.error('[SettingsStore] Failed to load audit log:', err)
    }
  },

  toggleSkill: async (id, active) => {
    try {
      const result = await window.electron.settings.skillsToggle(id, active)
      if (result.success) await get().loadSkills()
    } catch (err) {
      console.error('[SettingsStore] Failed to toggle skill:', err)
    }
  },

  executeSkill: async (id) => {
    try {
      await window.electron.settings.skillsExecute(id)
    } catch (err) {
      console.error('[SettingsStore] Failed to execute skill:', err)
    }
  },

  // Channel Router
  loadChannelRouterConfig: async () => {
    try {
      const result = await window.electron.settings.channelRouterConfigGet()
      if (result.success) set({ channelRouterConfig: result.data })
    } catch (err) {
      console.error('[SettingsStore] Failed to load channel router config:', err)
    }
  },

  updateChannelRouterConfig: async (config) => {
    try {
      const result = await window.electron.settings.channelRouterConfigSet(config)
      if (result.success) await get().loadChannelRouterConfig()
    } catch (err) {
      console.error('[SettingsStore] Failed to update channel router config:', err)
    }
  },
}))

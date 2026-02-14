/**
 * SkillsConfigStore - Per-Skill Config in electron-store
 *
 * Manages runtime configuration for each skill instance, including
 * user-modified settings, execution stats, and the agent-writable config.
 * Implements the two-file config architecture:
 * - Immutable config: read-only security boundaries (loaded from disk, never agent-writable)
 * - Agent config: skill configs, display prefs, LLM routing (agent can modify)
 */

import Store from 'electron-store'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { app } from 'electron'
import type {
  SkillRuntimeConfig,
  AgentWritableConfig,
  LlmRoutingEntry,
  DigestSource,
} from '@shared/skills-types'

const LOG = '[SkillsConfigStore]'

/** Immutable security config that the agent cannot modify. */
export interface ImmutableConfig {
  maxPermissionTier: number
  allowedNetworkDomains: string[]
  blockedToolPatterns: string[]
  sandboxEnabled: boolean
  auditEnabled: boolean
  maxSkillExecutionMs: number
  maxCostPerExecutionUsd: number
  skillAutoApproveBelow: number // auto-approve skills below this tier
  patternCrystallizationEnabled: boolean
  patternCrystallizationMaxTier: number
}

const DEFAULT_IMMUTABLE: ImmutableConfig = {
  maxPermissionTier: 3,
  allowedNetworkDomains: ['*'],
  blockedToolPatterns: [],
  sandboxEnabled: false,
  auditEnabled: true,
  maxSkillExecutionMs: 120_000,
  maxCostPerExecutionUsd: 1.0,
  skillAutoApproveBelow: 2,
  patternCrystallizationEnabled: true,
  patternCrystallizationMaxTier: 2,
}

const DEFAULT_AGENT_CONFIG: AgentWritableConfig = {
  skills: {},
  llmRouting: {
    heartbeat_analysis: { provider: 'openrouter', model: 'deepseek/deepseek-chat-v3-0324' },
    digest_generation: { provider: 'openrouter', model: 'deepseek/deepseek-chat-v3-0324' },
    triage: { provider: 'openrouter', model: 'deepseek/deepseek-chat-v3-0324' },
    summarize: { provider: 'openrouter', model: 'google/gemini-2.5-flash-preview' },
    agent_execution: { provider: 'agent_sdk', model: 'claude-haiku-4-5-20251001' },
    bvs_spawn: { provider: 'agent_sdk', model: 'claude-sonnet-4-5-20250929' },
  },
  displayPrefs: {},
  digestSources: [
    { name: 'Hacker News', url: 'https://hacker-news.firebaseio.com/v0', type: 'hackernews', enabled: true },
  ],
  customKeywords: {},
}

export class SkillsConfigStore {
  private agentStore: Store<AgentWritableConfig>
  private immutableConfig: ImmutableConfig

  constructor() {
    this.agentStore = new Store<AgentWritableConfig>({
      name: 'agent-config',
      defaults: DEFAULT_AGENT_CONFIG,
    })

    // Load immutable config from disk (or use defaults)
    this.immutableConfig = { ...DEFAULT_IMMUTABLE }
  }

  /**
   * Load the immutable config from the userData directory.
   * This file is OS-level protected (not agent-writable).
   */
  async loadImmutableConfig(): Promise<void> {
    const configPath = join(app.getPath('userData'), 'config.immutable.json')
    try {
      const raw = await readFile(configPath, 'utf-8')
      const loaded = JSON.parse(raw) as Partial<ImmutableConfig>
      this.immutableConfig = { ...DEFAULT_IMMUTABLE, ...loaded }
      console.log(LOG, 'Loaded immutable config from', configPath)
    } catch {
      console.log(LOG, 'No immutable config found, using defaults')
    }
  }

  // =========================================================================
  // Immutable Config (read-only)
  // =========================================================================

  getImmutableConfig(): Readonly<ImmutableConfig> {
    return { ...this.immutableConfig }
  }

  // =========================================================================
  // Agent-Writable Config
  // =========================================================================

  getAgentConfig(): AgentWritableConfig {
    return this.agentStore.store
  }

  // --- Skill Runtime Config ---

  getSkillConfig(skillId: string): SkillRuntimeConfig | undefined {
    const skills = this.agentStore.get('skills')
    return skills[skillId]
  }

  setSkillConfig(skillId: string, config: Partial<SkillRuntimeConfig>): SkillRuntimeConfig {
    const skills = this.agentStore.get('skills')
    const existing = skills[skillId] ?? {
      skillId,
      active: true,
      config: {},
      executionCount: 0,
      totalCostUsd: 0,
    }

    const updated: SkillRuntimeConfig = { ...existing, ...config, skillId }
    skills[skillId] = updated
    this.agentStore.set('skills', skills)
    return updated
  }

  updateSkillConfigField(skillId: string, key: string, value: unknown): void {
    const skills = this.agentStore.get('skills')
    const existing = skills[skillId]
    if (!existing) {
      skills[skillId] = {
        skillId,
        active: true,
        config: { [key]: value },
        executionCount: 0,
        totalCostUsd: 0,
      }
    } else {
      existing.config = { ...existing.config, [key]: value }
      skills[skillId] = existing
    }
    this.agentStore.set('skills', skills)
  }

  recordSkillExecution(skillId: string, costUsd: number, error?: string): void {
    const skills = this.agentStore.get('skills')
    const existing = skills[skillId] ?? {
      skillId,
      active: true,
      config: {},
      executionCount: 0,
      totalCostUsd: 0,
    }

    existing.executionCount += 1
    existing.totalCostUsd += costUsd
    existing.lastExecuted = Date.now()
    if (error) existing.lastError = error

    skills[skillId] = existing
    this.agentStore.set('skills', skills)
  }

  // --- LLM Routing ---

  getLlmRouting(): Record<string, LlmRoutingEntry> {
    return this.agentStore.get('llmRouting')
  }

  setLlmRouting(task: string, entry: LlmRoutingEntry): void {
    const routing = this.agentStore.get('llmRouting')
    routing[task] = entry
    this.agentStore.set('llmRouting', routing)
  }

  getLlmRoutingForTask(task: string): LlmRoutingEntry | undefined {
    const routing = this.agentStore.get('llmRouting')
    return routing[task]
  }

  // --- Digest Sources ---

  getDigestSources(): DigestSource[] {
    return this.agentStore.get('digestSources')
  }

  addDigestSource(source: DigestSource): void {
    const sources = this.agentStore.get('digestSources')
    sources.push(source)
    this.agentStore.set('digestSources', sources)
  }

  removeDigestSource(name: string): void {
    const sources = this.agentStore.get('digestSources')
    this.agentStore.set(
      'digestSources',
      sources.filter((s) => s.name !== name),
    )
  }

  updateDigestSource(name: string, updates: Partial<DigestSource>): void {
    const sources = this.agentStore.get('digestSources')
    const idx = sources.findIndex((s) => s.name === name)
    if (idx >= 0) {
      sources[idx] = { ...sources[idx], ...updates }
      this.agentStore.set('digestSources', sources)
    }
  }

  // --- Custom Keywords ---

  getCustomKeywords(): Record<string, string> {
    return this.agentStore.get('customKeywords')
  }

  setCustomKeyword(keyword: string, skillId: string): void {
    const kw = this.agentStore.get('customKeywords')
    kw[keyword] = skillId
    this.agentStore.set('customKeywords', kw)
  }

  removeCustomKeyword(keyword: string): void {
    const kw = this.agentStore.get('customKeywords')
    delete kw[keyword]
    this.agentStore.set('customKeywords', kw)
  }

  // --- Display Prefs ---

  getDisplayPrefs(): Record<string, unknown> {
    return this.agentStore.get('displayPrefs')
  }

  setDisplayPref(key: string, value: unknown): void {
    const prefs = this.agentStore.get('displayPrefs')
    prefs[key] = value
    this.agentStore.set('displayPrefs', prefs)
  }
}

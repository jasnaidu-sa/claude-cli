import Store from 'electron-store'
import { app } from 'electron'
import type { AppConfig, AutonomousConfig } from '@shared/types'
import type { WhatsAppConfig } from '@shared/whatsapp-types'
import { homedir } from 'os'
import { join } from 'path'

/**
 * Returns the default WhatsApp configuration with lazily resolved paths.
 * IMPORTANT: Must be called inside a function (not at module scope) because
 * app.getPath('userData') is not available until after app 'ready' event.
 */
function getDefaultWhatsAppConfig(): WhatsAppConfig {
  const userData = app.getPath('userData')
  return {
    enabled: false,
    autoConnect: true,
    authDir: join(userData, 'whatsapp-auth'),
    assistantName: 'Claude',
    defaultTriggerPattern: '^@Claude\\b',
    defaultAgentMode: 'auto',
    debounceMs: 2000,
    maxConcurrentAgents: 3,
    messageChunkLimit: 4000,
    ackReactionEmoji: '\u26A1',
    selfChatMode: true,
    rateLimitPerMinute: 10,
    heartbeat: {
      enabled: false,
      intervalMs: 1800000,
      targetConversationJid: '',
      heartbeatMdPath: 'HEARTBEAT.md',
      cheapChecksFirst: true,
      maxBudgetPerBeatUsd: 0.25,
    },
    memory: {
      enabled: true,
      dbPath: join(userData, 'whatsapp-memory.sqlite'),
      embeddingProvider: 'voyage',
      embeddingModel: 'voyage-3.5-lite',
      chunkSize: 400,
      chunkOverlap: 80,
      hybridSearchWeights: { vector: 0.7, text: 0.3 },
      autoIndexConversations: true,
      autoIndexProjectFiles: true,
    },
    identity: {
      workspacePath: join(userData, 'whatsapp-workspace'),
      soulMdPath: 'SOUL.md',
      userMdPath: 'USER.md',
      heartbeatMdPath: 'HEARTBEAT.md',
    },
    modeConfigs: {
      chat: {
        mode: 'chat',
        model: 'claude-haiku-4-5-20251001',
        maxTurns: 15,
        tools: ['Read', 'Glob', 'Grep'],
        mcpServers: [],
        maxBudgetUsd: 0.10,
      },
      quick_fix: {
        mode: 'quick_fix',
        model: 'claude-haiku-4-5-20251001',
        maxTurns: 5,
        tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'],
        mcpServers: [],
        maxBudgetUsd: 0.15,
      },
      research: {
        mode: 'research',
        model: 'claude-sonnet-4-5-20250929',
        maxTurns: 10,
        tools: ['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch'],
        mcpServers: [],
        maxBudgetUsd: 0.50,
      },
      bvs_spawn: {
        mode: 'bvs_spawn',
        model: 'claude-sonnet-4-5-20250929',
        maxTurns: 30,
        tools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
        mcpServers: [],
        maxBudgetUsd: 2.00,
      },
      auto: {
        mode: 'auto',
        model: 'claude-haiku-4-5-20251001',
        maxTurns: 15,
        tools: ['Read', 'Glob', 'Grep'],
        mcpServers: [],
        maxBudgetUsd: 0.25,
      },
    },
  }
}

const defaultAutonomousConfig: AutonomousConfig = {
  // Model settings
  defaultModel: 'claude-sonnet-4-20250514',
  availableModels: [
    { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', description: 'Balanced performance', enabled: true },
    { id: 'claude-opus-4-20250514', name: 'Claude Opus 4', description: 'Most capable', enabled: true },
    { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', description: 'Fast & capable', enabled: true }
  ],
  // Behavior settings
  autoStartOnCreate: false,
  confirmBeforeStart: true,
  autoWatchProgress: true,
  // MCP server settings
  mcpServers: [
    {
      name: 'playwright',
      command: 'npx',
      args: ['@anthropic/mcp-server-playwright'],
      enabled: true
    },
    {
      name: 'supabase',
      command: 'npx',
      args: ['@anthropic/mcp-server-supabase'],
      env: { SUPABASE_ACCESS_TOKEN: '' },
      enabled: false
    }
  ],
  // Security settings
  bashAllowlist: true,
  maxConcurrentSessions: 5,
  sessionRateLimitPerHour: 50
}

const defaultConfig: AppConfig = {
  claudeCliPath: 'claude', // Assumes claude is in PATH
  defaultProjectsDir: join(homedir(), 'Projects'),
  theme: 'dark',
  fontSize: 14,
  recentProjects: [],
  autonomous: defaultAutonomousConfig
}

export class ConfigStore {
  private store: Store<AppConfig>
  private whatsappStore: Store<WhatsAppConfig> | null = null

  constructor() {
    this.store = new Store<AppConfig>({
      name: 'config',
      defaults: defaultConfig
    })

    // Migrate existing configs to include autonomous settings
    this.migrateConfig()
  }

  /**
   * Lazily initialize the WhatsApp config store.
   * Uses a separate electron-store instance (store name: 'whatsapp-config')
   * to avoid bloating the main config. Initialization is deferred because
   * app.getPath('userData') is not available at module load time.
   */
  private getWhatsAppStore(): Store<WhatsAppConfig> {
    if (!this.whatsappStore) {
      this.whatsappStore = new Store<WhatsAppConfig>({
        name: 'whatsapp-config',
        defaults: getDefaultWhatsAppConfig()
      })
    }
    return this.whatsappStore
  }

  /**
   * Migrate config to add new settings while preserving existing values
   */
  private migrateConfig(): void {
    // Add autonomous config if missing
    if (!this.store.has('autonomous')) {
      this.store.set('autonomous', defaultAutonomousConfig)
    } else {
      // Ensure all autonomous sub-settings exist
      const currentAutonomous = this.store.get('autonomous')

      // Merge with defaults, preserving existing values
      const mergedAutonomous: AutonomousConfig = {
        ...defaultAutonomousConfig,
        ...currentAutonomous
      }

      this.store.set('autonomous', mergedAutonomous)
    }
  }

  /**
   * Get the default autonomous config (useful for reset)
   */
  getDefaultAutonomousConfig(): AutonomousConfig {
    return { ...defaultAutonomousConfig }
  }

  get<K extends keyof AppConfig>(key: K): AppConfig[K] {
    return this.store.get(key)
  }

  set<K extends keyof AppConfig>(key: K, value: AppConfig[K]): void {
    this.store.set(key, value)
  }

  getAll(): AppConfig {
    return this.store.store
  }

  addRecentProject(path: string): void {
    const recent = this.get('recentProjects')
    const filtered = recent.filter(p => p !== path)
    const updated = [path, ...filtered].slice(0, 10)
    this.set('recentProjects', updated)
  }

  removeRecentProject(path: string): void {
    const recent = this.get('recentProjects')
    const updated = recent.filter(p => p !== path)
    this.set('recentProjects', updated)
  }

  /**
   * Get the full WhatsApp configuration, merging stored values with defaults.
   * Uses a separate electron-store instance to keep WhatsApp config isolated.
   */
  getWhatsAppConfig(): WhatsAppConfig {
    const store = this.getWhatsAppStore()
    const defaults = getDefaultWhatsAppConfig()
    const stored = store.store

    // Deep merge: preserve stored values, fill in missing keys from defaults
    return {
      ...defaults,
      ...stored,
      heartbeat: { ...defaults.heartbeat, ...stored.heartbeat },
      memory: { ...defaults.memory, ...stored.memory },
      identity: { ...defaults.identity, ...stored.identity },
      modeConfigs: {
        chat: { ...defaults.modeConfigs.chat, ...stored.modeConfigs?.chat },
        quick_fix: { ...defaults.modeConfigs.quick_fix, ...stored.modeConfigs?.quick_fix },
        research: { ...defaults.modeConfigs.research, ...stored.modeConfigs?.research },
        bvs_spawn: { ...defaults.modeConfigs.bvs_spawn, ...stored.modeConfigs?.bvs_spawn },
        auto: { ...defaults.modeConfigs.auto, ...stored.modeConfigs?.auto },
      },
    }
  }

  /**
   * Update WhatsApp configuration. Accepts a partial config that will be
   * merged with the current stored values.
   */
  setWhatsAppConfig(config: Partial<WhatsAppConfig>): void {
    const store = this.getWhatsAppStore()
    const current = store.store

    // Shallow-merge top-level, deep-merge known nested objects
    const merged: WhatsAppConfig = {
      ...current,
      ...config,
      heartbeat: { ...current.heartbeat, ...(config.heartbeat ?? {}) },
      memory: { ...current.memory, ...(config.memory ?? {}) },
      identity: { ...current.identity, ...(config.identity ?? {}) },
      modeConfigs: {
        chat: { ...current.modeConfigs.chat, ...(config.modeConfigs?.chat ?? {}) },
        quick_fix: { ...current.modeConfigs.quick_fix, ...(config.modeConfigs?.quick_fix ?? {}) },
        research: { ...current.modeConfigs.research, ...(config.modeConfigs?.research ?? {}) },
        bvs_spawn: { ...current.modeConfigs.bvs_spawn, ...(config.modeConfigs?.bvs_spawn ?? {}) },
        auto: { ...current.modeConfigs.auto, ...(config.modeConfigs?.auto ?? {}) },
      },
    }

    store.store = merged
  }

  /**
   * Get the default WhatsApp config (useful for reset).
   */
  getDefaultWhatsAppConfig(): WhatsAppConfig {
    return getDefaultWhatsAppConfig()
  }

  reset(): void {
    this.store.clear()
  }
}

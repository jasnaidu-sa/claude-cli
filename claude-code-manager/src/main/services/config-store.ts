import Store from 'electron-store'
import type { AppConfig, AutonomousConfig } from '@shared/types'
import { homedir } from 'os'
import { join } from 'path'

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

  constructor() {
    this.store = new Store<AppConfig>({
      name: 'config',
      defaults: defaultConfig
    })

    // Migrate existing configs to include autonomous settings
    this.migrateConfig()
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

  reset(): void {
    this.store.clear()
  }
}

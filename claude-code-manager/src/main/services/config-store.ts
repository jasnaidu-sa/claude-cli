import Store from 'electron-store'
import type { AppConfig } from '@shared/types'
import { homedir } from 'os'
import { join } from 'path'

const defaultConfig: AppConfig = {
  claudeCliPath: 'claude', // Assumes claude is in PATH
  defaultProjectsDir: join(homedir(), 'Projects'),
  theme: 'dark',
  fontSize: 14,
  recentProjects: []
}

export class ConfigStore {
  private store: Store<AppConfig>

  constructor() {
    this.store = new Store<AppConfig>({
      name: 'config',
      defaults: defaultConfig
    })
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

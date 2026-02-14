import { EventEmitter } from 'events'
import { watch, FSWatcher } from 'chokidar'
import { readFile, writeFile, mkdir, copyFile, access } from 'fs/promises'
import { join, resolve } from 'path'
import { platform, type as osType, release as osRelease } from 'os'
import type {
  AgentIdentity,
  AgentIdentityConfig,
  WhatsAppAgentMode,
  AgentModeConfig
} from '@shared/whatsapp-types'
import type { ConfigStore } from './config-store'

/** Path to the bundled template workspace files shipped with the application. */
const TEMPLATE_DIR = join(__dirname, '..', '..', 'whatsapp-workspace')

/**
 * AgentIdentityService manages loading, caching, and watching the agent
 * identity files (SOUL.md, USER.md, HEARTBEAT.md). It provides the assembled
 * identity context used for system prompt construction across all agent modes.
 *
 * Emits:
 * - 'identity-updated' when any identity file changes on disk
 */
export class AgentIdentityService extends EventEmitter {
  private configStore: ConfigStore
  private identityConfig: AgentIdentityConfig
  private cachedIdentity: AgentIdentity
  private watcher: FSWatcher | null = null
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private initialized = false

  /** Debounce interval in ms for file-change events. */
  private static readonly DEBOUNCE_MS = 500

  constructor(configStore: ConfigStore) {
    super()
    this.configStore = configStore
    this.identityConfig = configStore.getWhatsAppConfig().identity

    // Initialize with empty identity; real content is loaded in initialize()
    this.cachedIdentity = {
      soulMd: '',
      userMd: '',
      heartbeatMd: ''
    }
  }

  // -------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------

  /**
   * Load all identity files from the workspace directory, copy template
   * files on first run if they do not exist, and start the file watcher.
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return
    }

    // Ensure workspace directory exists
    await this.ensureWorkspace()

    // Copy template files if they are missing (first-run behaviour).
    // Never overwrite existing user files.
    await this.copyTemplatesIfMissing()

    // Load identity file contents into cache
    await this.reloadAllFiles()

    // Start watching workspace for changes
    this.startWatcher()

    this.initialized = true
    console.log('[AgentIdentityService] Initialized. Workspace:', this.identityConfig.workspacePath)
  }

  /**
   * Returns the currently cached agent identity. The cache is updated
   * automatically when files change on disk.
   */
  getIdentity(): AgentIdentity {
    return { ...this.cachedIdentity }
  }

  /**
   * Overwrite SOUL.md with new content and update the cache.
   */
  async updateSoulMd(content: string): Promise<void> {
    const filePath = this.resolvePath(this.identityConfig.soulMdPath)
    await writeFile(filePath, content, 'utf-8')
    this.cachedIdentity.soulMd = content
    this.emit('identity-updated')
  }

  /**
   * Overwrite USER.md with new content and update the cache.
   */
  async updateUserMd(content: string): Promise<void> {
    const filePath = this.resolvePath(this.identityConfig.userMdPath)
    await writeFile(filePath, content, 'utf-8')
    this.cachedIdentity.userMd = content
    this.emit('identity-updated')
  }

  /**
   * Overwrite HEARTBEAT.md with new content and update the cache.
   */
  async updateHeartbeatMd(content: string): Promise<void> {
    const filePath = this.resolvePath(this.identityConfig.heartbeatMdPath)
    await writeFile(filePath, content, 'utf-8')
    this.cachedIdentity.heartbeatMd = content
    this.emit('identity-updated')
  }

  /**
   * Attempt to read a project-level CLAUDE.md file. Returns the file
   * content as a string, or null if the file does not exist.
   */
  getProjectClaudeMd(projectPath: string): string | null {
    try {
      const claudeMdPath = resolve(projectPath, 'CLAUDE.md')
      // Use synchronous read since this is called in a hot path
      // (system prompt assembly) and should be fast for a single file.
      const fs = require('fs') as typeof import('fs')
      return fs.readFileSync(claudeMdPath, 'utf-8')
    } catch {
      return null
    }
  }

  /**
   * Assemble the full system prompt context for a given agent mode,
   * optionally including project-specific CLAUDE.md content.
   *
   * Assembly order:
   * 1. SOUL.md content
   * 2. USER.md content
   * 3. Project CLAUDE.md (if projectPath provided and file exists)
   * 4. Mode-specific instructions from config
   * 5. Runtime environment info (date, OS, timezone)
   */
  buildSystemPromptContext(mode: WhatsAppAgentMode, projectPath?: string): string {
    const parts: string[] = []

    // 1. SOUL.md - core agent identity
    if (this.cachedIdentity.soulMd) {
      parts.push(this.cachedIdentity.soulMd)
    }

    // 2. USER.md - user-specific context
    if (this.cachedIdentity.userMd) {
      parts.push(this.cachedIdentity.userMd)
    }

    // 3. Project CLAUDE.md
    if (projectPath) {
      const claudeMd = this.getProjectClaudeMd(projectPath)
      if (claudeMd) {
        parts.push(`# Project Context (CLAUDE.md)\n\n${claudeMd}`)
      }
    }

    // 4. Mode-specific instructions
    const modeConfig = this.getModeConfig(mode)
    if (modeConfig?.systemPromptAppend) {
      parts.push(`# Mode Instructions (${mode})\n\n${modeConfig.systemPromptAppend}`)
    }

    // 5. Runtime environment info
    parts.push(this.buildEnvironmentSection())

    return parts.join('\n\n---\n\n')
  }

  /**
   * Stop the file watcher and clean up resources.
   */
  async destroy(): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
    if (this.watcher) {
      await this.watcher.close()
      this.watcher = null
    }
    this.initialized = false
  }

  // -------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------

  /**
   * Ensure the workspace directory exists, creating it recursively if needed.
   */
  private async ensureWorkspace(): Promise<void> {
    await mkdir(this.identityConfig.workspacePath, { recursive: true })
  }

  /**
   * Copy template identity files into the workspace directory. Only copies
   * files that do not already exist -- never overwrites user customisations.
   */
  private async copyTemplatesIfMissing(): Promise<void> {
    const filesToCopy = [
      { template: 'SOUL.md', target: this.identityConfig.soulMdPath },
      { template: 'USER.md', target: this.identityConfig.userMdPath },
      { template: 'HEARTBEAT.md', target: this.identityConfig.heartbeatMdPath }
    ]

    for (const { template, target } of filesToCopy) {
      const targetPath = this.resolvePath(target)
      const templatePath = join(TEMPLATE_DIR, template)

      if (await this.fileExists(targetPath)) {
        continue
      }

      try {
        // Verify template source exists before attempting copy
        if (await this.fileExists(templatePath)) {
          await copyFile(templatePath, targetPath)
          console.log(`[AgentIdentityService] Copied template ${template} to workspace`)
        } else {
          console.warn(`[AgentIdentityService] Template not found: ${templatePath}`)
        }
      } catch (err) {
        console.error(`[AgentIdentityService] Failed to copy template ${template}:`, err)
      }
    }
  }

  /**
   * Reload all identity files from disk into the cache.
   */
  private async reloadAllFiles(): Promise<void> {
    const [soulMd, userMd, heartbeatMd] = await Promise.all([
      this.readFileSafe(this.resolvePath(this.identityConfig.soulMdPath)),
      this.readFileSafe(this.resolvePath(this.identityConfig.userMdPath)),
      this.readFileSafe(this.resolvePath(this.identityConfig.heartbeatMdPath))
    ])

    this.cachedIdentity = {
      soulMd,
      userMd,
      heartbeatMd
    }
  }

  /**
   * Start a chokidar file watcher on the workspace directory. File change
   * events are debounced by 500ms to avoid rapid reloads during edits.
   */
  private startWatcher(): void {
    if (this.watcher) {
      return
    }

    this.watcher = watch(this.identityConfig.workspacePath, {
      persistent: true,
      ignoreInitial: true,
      depth: 0, // Only watch top-level files in the workspace
      awaitWriteFinish: {
        stabilityThreshold: 300,
        pollInterval: 100
      }
    })

    const handleChange = (_event: string, _filePath: string): void => {
      // Debounce rapid change events (e.g., editor save + format)
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer)
      }

      this.debounceTimer = setTimeout(async () => {
        try {
          await this.reloadAllFiles()
          this.emit('identity-updated')
          console.log('[AgentIdentityService] Identity files reloaded after change')
        } catch (err) {
          console.error('[AgentIdentityService] Error reloading identity files:', err)
        }
      }, AgentIdentityService.DEBOUNCE_MS)
    }

    this.watcher
      .on('change', (path) => handleChange('change', path))
      .on('add', (path) => handleChange('add', path))
      .on('unlink', (path) => handleChange('unlink', path))
  }

  /**
   * Resolve a potentially relative file path against the workspace directory.
   */
  private resolvePath(relativePath: string): string {
    return resolve(this.identityConfig.workspacePath, relativePath)
  }

  /**
   * Read a file's contents as UTF-8 text. Returns an empty string if the
   * file does not exist or cannot be read.
   */
  private async readFileSafe(filePath: string): Promise<string> {
    try {
      return await readFile(filePath, 'utf-8')
    } catch {
      return ''
    }
  }

  /**
   * Check whether a file exists on disk.
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await access(filePath)
      return true
    } catch {
      return false
    }
  }

  /**
   * Retrieve the mode configuration for a given agent mode from the config store.
   */
  private getModeConfig(mode: WhatsAppAgentMode): AgentModeConfig | undefined {
    const config = this.configStore.getWhatsAppConfig()
    return config.modeConfigs[mode]
  }

  /**
   * Build a short environment information block to append to the system prompt.
   * Includes current date, OS, and timezone.
   */
  private buildEnvironmentSection(): string {
    const now = new Date()
    const dateStr = now.toISOString().split('T')[0]
    const timeStr = now.toLocaleTimeString()
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    const osName = platform()
    const osVer = osRelease()
    const osTypeStr = osType()

    return [
      '# Environment',
      '',
      `- Date: ${dateStr}`,
      `- Time: ${timeStr}`,
      `- Timezone: ${tz}`,
      `- OS: ${osTypeStr} ${osVer} (${osName})`
    ].join('\n')
  }
}

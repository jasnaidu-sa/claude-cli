/**
 * SkillsManagerService - Skill Directory Scanning, YAML Parsing, File Watching, CRUD
 *
 * Implements the Skills-as-Markdown system following the OpenClaw/nanobot SKILL.md standard.
 * Skills are .md files with YAML frontmatter that define agent capabilities.
 *
 * Three-tier loading hierarchy (highest to lowest precedence):
 * 1. Workspace skills: <workspace>/skills/ (per-project)
 * 2. Managed skills: userData/agent-skills/ (user-global)
 * 3. Bundled skills: shipped with installation
 *
 * Emits:
 * - 'skills-updated' when any skill file changes
 * - 'skill-created' when a new skill is created
 * - 'skill-deleted' when a skill is removed
 */

import { EventEmitter } from 'events'
import { watch, type FSWatcher } from 'chokidar'
import { readFile, writeFile, mkdir, readdir, unlink, access, stat } from 'fs/promises'
import { join, resolve, basename, extname } from 'path'
import { app } from 'electron'
import { createHash } from 'crypto'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import type {
  SkillDefinition,
  SkillFrontmatter,
  SkillTier,
  SkillPermissions,
  AuditLogEntry,
  AuditEventType,
} from '@shared/skills-types'

const LOG = '[SkillsManager]'

/** Path to bundled default skill templates shipped with the app. */
const BUNDLED_SKILLS_DIR = join(__dirname, '..', '..', 'default-skills')

export class SkillsManagerService extends EventEmitter {
  /** All loaded skills indexed by ID. Later tiers override earlier ones. */
  private skills: Map<string, SkillDefinition> = new Map()

  /** File watchers for each skill directory. */
  private watchers: FSWatcher[] = []

  /** Managed skills directory (userData/agent-skills/) */
  private managedDir: string

  /** Workspace skills directory (per-project, optional) */
  private workspaceDir: string | null = null

  /** Audit log (append-only, in-memory, flushed to disk periodically) */
  private auditLog: AuditLogEntry[] = []
  private auditLogPath: string
  private auditFlushTimer: ReturnType<typeof setInterval> | null = null

  private initialized = false
  private debounceTimer: ReturnType<typeof setTimeout> | null = null

  constructor() {
    super()
    const userData = app.getPath('userData')
    this.managedDir = join(userData, 'agent-skills')
    this.auditLogPath = join(userData, 'agent-audit.json')
  }

  // =========================================================================
  // Public API
  // =========================================================================

  /**
   * Initialize: ensure directories exist, copy bundled defaults, scan all
   * skill directories, start file watchers.
   */
  async initialize(workspaceDir?: string): Promise<void> {
    if (this.initialized) return

    this.workspaceDir = workspaceDir || null

    // Ensure managed skills directory
    await mkdir(this.managedDir, { recursive: true })

    // Copy bundled skills to managed dir if missing
    await this.copyBundledSkills()

    // Load audit log from disk
    await this.loadAuditLog()

    // Scan all tiers
    await this.scanAllSkills()

    // Start file watchers
    this.startWatchers()

    // Flush audit log every 60s
    this.auditFlushTimer = setInterval(() => this.flushAuditLog(), 60_000)

    this.initialized = true
    console.log(LOG, `Initialized. ${this.skills.size} skills loaded from managed dir: ${this.managedDir}`)
  }

  /** Get all loaded skills. */
  listSkills(): SkillDefinition[] {
    return Array.from(this.skills.values()).sort((a, b) => a.id.localeCompare(b.id))
  }

  /** Get a single skill by ID. */
  getSkill(id: string): SkillDefinition | undefined {
    return this.skills.get(id)
  }

  /** Get skills that match a given command trigger. */
  getSkillByCommand(command: string): SkillDefinition | undefined {
    const cmd = command.startsWith('/') ? command : `/${command}`
    for (const skill of this.skills.values()) {
      if (!skill.active) continue
      for (const trigger of skill.frontmatter.triggers) {
        if (trigger.command === cmd) return skill
      }
    }
    return undefined
  }

  /** Get skills that match keyword patterns against a message. */
  getSkillsByKeyword(message: string): SkillDefinition[] {
    const matches: SkillDefinition[] = []
    for (const skill of this.skills.values()) {
      if (!skill.active) continue
      for (const trigger of skill.frontmatter.triggers) {
        if (trigger.keywords) {
          for (const kw of trigger.keywords) {
            // ReDoS protection: reject dangerous regex patterns
            if (this.isDangerousRegex(kw)) {
              console.warn('[SkillsMgr] Skipping unsafe keyword regex:', kw)
              continue
            }
            try {
              if (new RegExp(kw, 'i').test(message)) {
                matches.push(skill)
                break
              }
            } catch {
              console.warn('[SkillsMgr] Invalid keyword regex:', kw)
            }
          }
        }
      }
    }
    return matches
  }

  /** Check for common ReDoS-vulnerable regex patterns. */
  private isDangerousRegex(pattern: string): boolean {
    const dangerousPatterns = [
      /\([^)]*\+[^)]*\)\+/,   // (a+)+
      /\([^)]*\*[^)]*\)\*/,   // (a*)*
      /\([^)]*\+[^)]*\)\*/,   // (a+)*
      /\([^)]*\*[^)]*\)\+/,   // (a*)+
    ]
    return pattern.length > 100 || dangerousPatterns.some((p) => p.test(pattern))
  }

  /** Get all skills with cron triggers. */
  getScheduledSkills(): SkillDefinition[] {
    return this.listSkills().filter(
      (s) => s.active && s.frontmatter.triggers.some((t) => t.cron),
    )
  }

  /**
   * Create a new skill from content. Writes to the managed skills directory.
   * Returns the created skill definition.
   */
  async createSkill(
    id: string,
    frontmatter: Omit<SkillFrontmatter, 'id'>,
    body: string,
    approvalMethod: 'auto' | 'user_confirm' | 'system' = 'user_confirm',
  ): Promise<SkillDefinition> {
    const fm: SkillFrontmatter = { id, ...frontmatter }

    // Validate permission tier
    const tier = fm.metadata?.permissions?.risk_tier ?? 1
    if (tier >= 3 && approvalMethod !== 'user_confirm') {
      throw new Error(`Skill ${id} requires explicit user approval (tier ${tier})`)
    }

    const content = this.serializeSkill(fm, body)
    const filePath = join(this.managedDir, `${id}.md`)

    // Check for existing
    if (await this.fileExists(filePath)) {
      throw new Error(`Skill ${id} already exists at ${filePath}`)
    }

    await writeFile(filePath, content, 'utf-8')

    const skill: SkillDefinition = {
      id,
      frontmatter: fm,
      body,
      filePath,
      tier: 'managed',
      active: fm.active,
      lastModified: Date.now(),
    }

    this.skills.set(id, skill)
    this.appendAudit('skill_create', tier, approvalMethod, `Created skill: ${id}`)
    this.emit('skill-created', skill)
    this.emit('skills-updated')

    return skill
  }

  /**
   * Update an existing skill's frontmatter and/or body.
   */
  async updateSkill(
    id: string,
    updates: { frontmatter?: Partial<SkillFrontmatter>; body?: string },
  ): Promise<SkillDefinition> {
    const existing = this.skills.get(id)
    if (!existing) throw new Error(`Skill not found: ${id}`)

    const newFm = { ...existing.frontmatter, ...updates.frontmatter, id }
    const newBody = updates.body ?? existing.body
    const content = this.serializeSkill(newFm, newBody)

    await writeFile(existing.filePath, content, 'utf-8')

    const updated: SkillDefinition = {
      ...existing,
      frontmatter: newFm,
      body: newBody,
      active: newFm.active,
      lastModified: Date.now(),
    }

    this.skills.set(id, updated)
    this.appendAudit('skill_update', 1, 'auto', `Updated skill: ${id}`)
    this.emit('skills-updated')

    return updated
  }

  /**
   * Toggle a skill's active status.
   */
  async toggleSkill(id: string, active: boolean): Promise<SkillDefinition> {
    return this.updateSkill(id, { frontmatter: { active } })
  }

  /**
   * Delete a skill file (only managed tier can be deleted).
   */
  async deleteSkill(id: string): Promise<void> {
    const skill = this.skills.get(id)
    if (!skill) throw new Error(`Skill not found: ${id}`)
    if (skill.tier === 'bundled') throw new Error('Cannot delete bundled skills')

    await unlink(skill.filePath)
    this.skills.delete(id)
    this.appendAudit('skill_delete', 2, 'user_confirm', `Deleted skill: ${id}`)
    this.emit('skill-deleted', id)
    this.emit('skills-updated')
  }

  /** Get the audit log entries (most recent first). */
  getAuditLog(limit = 100): AuditLogEntry[] {
    return this.auditLog.slice(-limit).reverse()
  }

  /** Clean up watchers and timers. */
  async destroy(): Promise<void> {
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    if (this.auditFlushTimer) clearInterval(this.auditFlushTimer)
    for (const w of this.watchers) {
      await w.close()
    }
    this.watchers = []
    await this.flushAuditLog()
    this.initialized = false
  }

  // =========================================================================
  // Private - Scanning & Loading
  // =========================================================================

  private async scanAllSkills(): Promise<void> {
    this.skills.clear()

    // Load in order: bundled (lowest precedence) -> managed -> workspace (highest)
    await this.scanDirectory(BUNDLED_SKILLS_DIR, 'bundled')
    await this.scanDirectory(this.managedDir, 'managed')
    if (this.workspaceDir) {
      const wsSkillsDir = join(this.workspaceDir, 'skills')
      if (await this.fileExists(wsSkillsDir)) {
        await this.scanDirectory(wsSkillsDir, 'workspace')
      }
    }
  }

  private async scanDirectory(dir: string, tier: SkillTier): Promise<void> {
    try {
      const entries = await readdir(dir)
      for (const entry of entries) {
        if (!entry.endsWith('.md')) continue
        const filePath = join(dir, entry)
        try {
          const skill = await this.loadSkillFile(filePath, tier)
          if (skill) {
            this.skills.set(skill.id, skill)
          }
        } catch (err) {
          console.warn(LOG, `Failed to load skill ${entry}:`, err)
        }
      }
    } catch {
      // Directory may not exist (e.g., bundled dir in dev)
    }
  }

  private async loadSkillFile(
    filePath: string,
    tier: SkillTier,
  ): Promise<SkillDefinition | null> {
    const raw = await readFile(filePath, 'utf-8')
    const parsed = this.parseSkillMarkdown(raw)
    if (!parsed) return null

    const fileStat = await stat(filePath)

    return {
      id: parsed.frontmatter.id,
      frontmatter: parsed.frontmatter,
      body: parsed.body,
      filePath,
      tier,
      active: parsed.frontmatter.active,
      lastModified: fileStat.mtimeMs,
    }
  }

  // =========================================================================
  // Private - Parsing & Serialization
  // =========================================================================

  /**
   * Parse a SKILL.md file: extract YAML frontmatter between --- delimiters
   * and the markdown body below.
   */
  private parseSkillMarkdown(
    raw: string,
  ): { frontmatter: SkillFrontmatter; body: string } | null {
    const fmRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/
    const match = raw.match(fmRegex)
    if (!match) {
      console.warn(LOG, 'No frontmatter found in skill file')
      return null
    }

    try {
      const fm = parseYaml(match[1]) as SkillFrontmatter
      if (!fm.id || !fm.name) {
        console.warn(LOG, 'Skill missing required fields (id, name)')
        return null
      }

      // Normalize triggers to array
      if (!Array.isArray(fm.triggers)) {
        fm.triggers = fm.triggers ? [fm.triggers] : []
      }

      // Default active to true
      if (fm.active === undefined) fm.active = true

      return { frontmatter: fm, body: match[2].trim() }
    } catch (err) {
      console.warn(LOG, 'Failed to parse YAML frontmatter:', err)
      return null
    }
  }

  /**
   * Serialize a skill back to YAML frontmatter + markdown body.
   */
  private serializeSkill(fm: SkillFrontmatter, body: string): string {
    const yamlStr = stringifyYaml(fm, { lineWidth: 120 })
    return `---\n${yamlStr}---\n\n${body}\n`
  }

  // =========================================================================
  // Private - File Watching
  // =========================================================================

  private startWatchers(): void {
    // Watch managed directory
    this.watchDirectory(this.managedDir)

    // Watch workspace skills if set
    if (this.workspaceDir) {
      const wsSkillsDir = join(this.workspaceDir, 'skills')
      this.watchDirectory(wsSkillsDir)
    }
  }

  private watchDirectory(dir: string): void {
    try {
      const watcher = watch(dir, {
        persistent: true,
        ignoreInitial: true,
        depth: 0,
        awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
      })

      const handleChange = (): void => {
        if (this.debounceTimer) clearTimeout(this.debounceTimer)
        this.debounceTimer = setTimeout(async () => {
          try {
            await this.scanAllSkills()
            this.emit('skills-updated')
            console.log(LOG, 'Skills reloaded after file change')
          } catch (err) {
            console.error(LOG, 'Error reloading skills:', err)
          }
        }, 500)
      }

      watcher
        .on('change', handleChange)
        .on('add', handleChange)
        .on('unlink', handleChange)

      this.watchers.push(watcher)
    } catch {
      // Directory may not exist yet
    }
  }

  // =========================================================================
  // Private - Bundled Skills
  // =========================================================================

  private async copyBundledSkills(): Promise<void> {
    try {
      const bundledFiles = await readdir(BUNDLED_SKILLS_DIR)
      for (const file of bundledFiles) {
        if (!file.endsWith('.md')) continue
        const targetPath = join(this.managedDir, file)
        if (await this.fileExists(targetPath)) continue

        try {
          const content = await readFile(join(BUNDLED_SKILLS_DIR, file), 'utf-8')
          await writeFile(targetPath, content, 'utf-8')
          console.log(LOG, `Copied bundled skill: ${file}`)
        } catch (err) {
          console.warn(LOG, `Failed to copy bundled skill ${file}:`, err)
        }
      }
    } catch {
      // Bundled dir may not exist in dev
      console.log(LOG, 'No bundled skills directory found, skipping copy')
    }
  }

  // =========================================================================
  // Private - Audit Log
  // =========================================================================

  private appendAudit(
    eventType: AuditEventType,
    permissionTier: number,
    approvalMethod: 'auto' | 'user_confirm' | 'system',
    details: string,
    beforeHash?: string,
    afterHash?: string,
  ): void {
    const entry: AuditLogEntry = {
      id: this.auditLog.length + 1,
      timestamp: Date.now(),
      eventType,
      permissionTier,
      approvalMethod,
      beforeHash,
      afterHash,
      details,
    }
    this.auditLog.push(entry)
  }

  private async loadAuditLog(): Promise<void> {
    try {
      const raw = await readFile(this.auditLogPath, 'utf-8')
      this.auditLog = JSON.parse(raw)
    } catch {
      this.auditLog = []
    }
  }

  private async flushAuditLog(): Promise<void> {
    try {
      await writeFile(this.auditLogPath, JSON.stringify(this.auditLog, null, 2), 'utf-8')
    } catch (err) {
      console.warn(LOG, 'Failed to flush audit log:', err)
    }
  }

  // =========================================================================
  // Private - Helpers
  // =========================================================================

  private async fileExists(path: string): Promise<boolean> {
    try {
      await access(path)
      return true
    } catch {
      return false
    }
  }
}

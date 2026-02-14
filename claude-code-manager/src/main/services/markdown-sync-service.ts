/**
 * Markdown Sync Service
 *
 * Implements P1-T2 from the Unified Agent Architecture PRD.
 * Generates daily markdown logs from episodic memory and watches the memory/
 * directory for external edits.
 *
 * Features:
 * - Daily log generation from episodes table (YYYY-MM-DD.md)
 * - File watcher using chokidar for external edits
 * - Automatic directory structure creation
 * - Bi-directional sync: SQLite → Markdown (write), Markdown → SQLite (watch)
 * - Obsidian-compatible wikilinks, tags, and entity files
 */

import { EventEmitter } from 'events'
import { watch, FSWatcher } from 'chokidar'
import { writeFile, readFile, mkdir, access } from 'fs/promises'
import { join } from 'path'
import type { EpisodeStoreService, Episode } from './episode-store-service'

// ============================================================================
// Types
// ============================================================================

interface DailyLogMetadata {
  date: string
  channels: string[]
  sessions: number
  totalMessages: number
}

interface SessionGroup {
  sessionId: string
  channel: string
  sourceId: string
  episodes: Episode[]
  startTime: number
  endTime: number
}

interface ExtractedEntity {
  name: string
  type: 'person' | 'project' | 'technology' | 'concept'
  mentions: number
  normalizedName: string
}

// ============================================================================
// MarkdownSyncService
// ============================================================================

export class MarkdownSyncService extends EventEmitter {
  private episodeStore: EpisodeStoreService
  private workspacePath: string
  private watcher: FSWatcher | null = null
  private debounceTimer: NodeJS.Timeout | null = null
  private initialized = false

  /** Debounce interval in ms for file-change events. */
  private static readonly DEBOUNCE_MS = 500

  /** Known technology keywords for entity extraction. */
  private static readonly TECH_KEYWORDS = new Set([
    'react', 'typescript', 'javascript', 'node', 'electron', 'vite', 'python',
    'rust', 'docker', 'kubernetes', 'redis', 'postgres', 'sqlite', 'supabase',
    'nextjs', 'tailwind', 'prisma', 'graphql', 'webpack', 'eslint', 'jest',
    'vitest', 'anthropic', 'openai', 'langchain', 'chromadb', 'pinecone',
  ])

  constructor(episodeStore: EpisodeStoreService, workspacePath: string) {
    super()
    this.episodeStore = episodeStore
    this.workspacePath = workspacePath
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Initialize the service: ensure directory structure exists and start the file watcher.
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return
    }

    await this.ensureDirectoryStructure()
    this.startFileWatcher()
    this.initialized = true

    console.log('[MarkdownSyncService] Initialized. Workspace:', this.workspacePath)
  }

  /**
   * Ensure all required directories exist in the memory vault structure.
   * Creates: memory/, memory/episodes/, memory/knowledge/, memory/knowledge/entities/, memory/skills/, memory/health/
   */
  async ensureDirectoryStructure(): Promise<void> {
    const dirs = [
      join(this.workspacePath, 'memory'),
      join(this.workspacePath, 'memory', 'episodes'),
      join(this.workspacePath, 'memory', 'knowledge'),
      join(this.workspacePath, 'memory', 'knowledge', 'entities'),
      join(this.workspacePath, 'memory', 'skills'),
      join(this.workspacePath, 'memory', 'health'),
    ]

    for (const dir of dirs) {
      await mkdir(dir, { recursive: true })
    }

    console.log('[MarkdownSyncService] Directory structure ensured')
  }

  /**
   * Generate a daily log markdown file for a specific date.
   * Queries episodes from the episodeStore and formats them into markdown.
   *
   * @param date - ISO date string (YYYY-MM-DD)
   * @returns Generated markdown content
   */
  async generateDailyLog(date: string): Promise<string> {
    // Parse date to get timestamp range (start of day to end of day)
    const startOfDay = new Date(date + 'T00:00:00.000Z').getTime()
    const endOfDay = new Date(date + 'T23:59:59.999Z').getTime()

    // Query episodes for this date across all channels
    const allEpisodes = await this.getEpisodesForDateRange(startOfDay, endOfDay)

    if (allEpisodes.length === 0) {
      return this.generateEmptyDailyLog(date)
    }

    // Group episodes by session
    const sessions = this.groupEpisodesBySession(allEpisodes)

    // Calculate metadata
    const metadata = this.calculateMetadata(date, sessions, allEpisodes)

    // Extract tags from sessions for frontmatter
    const tags = this.extractTags(sessions)

    // Extract entities from all content
    const allContent = allEpisodes.map((ep) => ep.content).join('\n')
    const entities = this.extractEntities(allContent)

    // Generate markdown with tags
    let markdown = this.formatDailyLogMarkdown(metadata, sessions, tags)

    // Add wikilinks for entities with 2+ mentions
    markdown = this.addWikilinks(markdown, entities)

    // Fire-and-forget entity file generation
    for (const entity of entities) {
      this.generateEntityFile(entity, date).catch((err) =>
        console.warn('[MarkdownSyncService] Entity file generation failed:', err),
      )
    }

    return markdown
  }

  /**
   * Sync today's episodes to markdown.
   * Generates the daily log for today and writes it to memory/episodes/YYYY-MM-DD.md
   */
  async syncToMarkdown(): Promise<void> {
    const today = new Date().toISOString().split('T')[0]
    const markdown = await this.generateDailyLog(today)

    const filePath = join(
      this.workspacePath,
      'memory',
      'episodes',
      `${today}.md`
    )

    await writeFile(filePath, markdown, 'utf-8')

    this.emit('daily-log-generated', { date: today, filePath })
    console.log(`[MarkdownSyncService] Daily log generated: ${filePath}`)
  }

  /**
   * Start watching the memory/ directory for external edits using chokidar.
   * Emits 'file-watcher-change' events when files are modified.
   */
  startFileWatcher(): void {
    if (this.watcher) {
      return
    }

    const memoryDir = join(this.workspacePath, 'memory')

    this.watcher = watch(memoryDir, {
      persistent: true,
      ignoreInitial: true,
      depth: 3, // Watch memory/ and subdirectories (increased for entities/)
      awaitWriteFinish: {
        stabilityThreshold: 300,
        pollInterval: 100,
      },
    })

    const handleChange = (event: string, filePath: string): void => {
      // Debounce rapid change events (e.g., editor save + format)
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer)
      }

      this.debounceTimer = setTimeout(() => {
        this.emit('file-watcher-change', { event, filePath })
        console.log(`[MarkdownSyncService] File ${event}: ${filePath}`)
      }, MarkdownSyncService.DEBOUNCE_MS)
    }

    this.watcher
      .on('change', (path) => handleChange('change', path))
      .on('add', (path) => handleChange('add', path))
      .on('unlink', (path) => handleChange('unlink', path))

    console.log('[MarkdownSyncService] File watcher started')
  }

  /**
   * Stop the file watcher and clean up resources.
   */
  stopFileWatcher(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }

    if (this.watcher) {
      this.watcher.close()
      this.watcher = null
      console.log('[MarkdownSyncService] File watcher stopped')
    }
  }

  /**
   * Clean up resources and stop the service.
   */
  async destroy(): Promise<void> {
    this.stopFileWatcher()
    this.initialized = false
  }

  // ==========================================================================
  // Entity Extraction & Wikilinks
  // ==========================================================================

  /**
   * Extract entities from content using regex-based detection.
   * Finds technology keywords and capitalized proper nouns.
   */
  extractEntities(content: string): ExtractedEntity[] {
    const entityCounts = new Map<string, { type: ExtractedEntity['type']; count: number }>()

    // Match technology keywords (case-insensitive)
    const lowerContent = content.toLowerCase()
    for (const tech of MarkdownSyncService.TECH_KEYWORDS) {
      // Use word boundary matching
      const regex = new RegExp(`\\b${tech}\\b`, 'gi')
      const matches = content.match(regex)
      if (matches && matches.length > 0) {
        const normalized = tech.toLowerCase()
        entityCounts.set(normalized, {
          type: 'technology',
          count: matches.length,
        })
      }
    }

    // Match capitalized proper nouns (2+ letter words starting with uppercase,
    // not at the start of a sentence, excluding common words)
    const commonWords = new Set([
      'the', 'this', 'that', 'with', 'from', 'have', 'will', 'been', 'were',
      'they', 'their', 'what', 'when', 'where', 'which', 'would', 'could',
      'should', 'about', 'after', 'before', 'between', 'through', 'during',
      'session', 'message', 'user', 'assistant', 'system', 'error', 'note',
      'todo', 'fix', 'bug', 'feature', 'update', 'added', 'removed',
    ])

    const properNounRegex = /(?<=[a-z.,;:!?\s])\b([A-Z][a-zA-Z]{2,})\b/g
    let match: RegExpExecArray | null
    while ((match = properNounRegex.exec(content)) !== null) {
      const word = match[1]
      const lower = word.toLowerCase()
      if (commonWords.has(lower)) continue
      // Skip if already found as technology
      if (entityCounts.has(lower)) continue

      const existing = entityCounts.get(lower)
      if (existing) {
        existing.count++
      } else {
        entityCounts.set(lower, { type: 'concept', count: 1 })
      }
    }

    // Convert to ExtractedEntity array, only include entities with 2+ mentions
    const entities: ExtractedEntity[] = []
    for (const [normalized, { type, count }] of entityCounts) {
      if (count >= 2) {
        // Reconstruct display name
        const name = type === 'technology'
          ? normalized
          : normalized.charAt(0).toUpperCase() + normalized.slice(1)

        entities.push({ name, type, mentions: count, normalizedName: normalized })
      }
    }

    return entities.sort((a, b) => b.mentions - a.mentions)
  }

  /**
   * Add Obsidian wikilinks for entities with 2+ mentions.
   * Replaces only the first occurrence in the content.
   */
  addWikilinks(content: string, entities: ExtractedEntity[]): string {
    let result = content
    for (const entity of entities) {
      if (entity.mentions < 2) continue
      const displayName = entity.name.charAt(0).toUpperCase() + entity.name.slice(1)
      const linkTarget = `knowledge/entities/${entity.normalizedName}`
      const wikilink = `[[${linkTarget}|${displayName}]]`

      // Replace first occurrence (case-insensitive), but only outside of
      // YAML frontmatter (skip lines between --- markers) and headings
      const regex = new RegExp(`\\b${this.escapeRegex(entity.name)}\\b`, 'i')
      // Find the first match that's not in frontmatter or heading
      const lines = result.split('\n')
      let inFrontmatter = false
      let replaced = false
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim() === '---') {
          inFrontmatter = !inFrontmatter
          continue
        }
        if (inFrontmatter) continue
        if (lines[i].startsWith('#')) continue
        if (replaced) continue

        if (regex.test(lines[i])) {
          lines[i] = lines[i].replace(regex, wikilink)
          replaced = true
        }
      }
      if (replaced) {
        result = lines.join('\n')
      }
    }
    return result
  }

  /**
   * Extract tags from session content for YAML frontmatter.
   */
  extractTags(sessions: SessionGroup[]): string[] {
    const tags = new Set<string>()

    for (const session of sessions) {
      // Channel-based tags
      tags.add(session.channel)

      const allContent = session.episodes.map((ep) => ep.content).join(' ').toLowerCase()

      // Content-based tags
      if (/\b(?:learn|learned|til|today i learned|discovery)\b/i.test(allContent)) {
        tags.add('learning')
      }
      if (/\b(?:debug|debugg|stack trace|error|exception|fix|bug)\b/i.test(allContent)) {
        tags.add('debugging')
      }
      if (/\b(?:bvs|bounded verified|planning|plan|phase)\b/i.test(allContent)) {
        tags.add('bvs')
      }
      if (/\b(?:planning|architecture|design|prd|spec)\b/i.test(allContent)) {
        tags.add('planning')
      }

      // Technology mention tags
      for (const tech of MarkdownSyncService.TECH_KEYWORDS) {
        if (allContent.includes(tech)) {
          tags.add(tech)
        }
      }
    }

    return Array.from(tags).sort()
  }

  /**
   * Generate or update an entity file in memory/knowledge/entities/.
   * Creates a markdown file with YAML frontmatter and backlinks.
   */
  async generateEntityFile(entity: ExtractedEntity, date: string): Promise<void> {
    const fileName = `${entity.normalizedName}.md`
    const filePath = join(this.workspacePath, 'memory', 'knowledge', 'entities', fileName)

    // Check if file already exists to merge backlinks
    let existingBacklinks: string[] = []
    try {
      const existing = await readFile(filePath, 'utf-8')
      // Extract existing backlinks
      const backlinkSection = existing.match(/## Backlinks\n([\s\S]*?)(?=\n##|$)/)
      if (backlinkSection) {
        existingBacklinks = backlinkSection[1]
          .split('\n')
          .filter((line) => line.startsWith('- '))
          .map((line) => line.trim())
      }
    } catch {
      // File doesn't exist yet, that's fine
    }

    // Add today's date as a backlink if not present
    const todayLink = `- [[episodes/${date}|${date}]]`
    if (!existingBacklinks.includes(todayLink)) {
      existingBacklinks.push(todayLink)
    }

    const content = [
      '---',
      `name: ${entity.name}`,
      `type: ${entity.type}`,
      `last_seen: ${date}`,
      `total_mentions: ${entity.mentions}`,
      '---',
      '',
      `# ${entity.name.charAt(0).toUpperCase() + entity.name.slice(1)}`,
      '',
      `Type: ${entity.type}`,
      '',
      '## Backlinks',
      ...existingBacklinks,
      '',
    ].join('\n')

    await writeFile(filePath, content, 'utf-8')
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  /**
   * Query episodes from the episode store for a specific date range.
   */
  private async getEpisodesForDateRange(
    startTimestamp: number,
    endTimestamp: number
  ): Promise<Episode[]> {
    // Query all episodes within the timestamp range
    // Since EpisodeStoreService doesn't have a direct timestamp range query,
    // we'll use a workaround by querying with a high limit and filtering
    const allChannels = ['whatsapp', 'telegram', 'bvs', 'cli']
    const episodes: Episode[] = []

    // Get episodes from all channels for the date range
    for (const channel of allChannels) {
      // Get episodes for this channel starting from the date
      const channelEpisodes = this.episodeStore
        .getEpisodesByChannel(channel, '', startTimestamp, 10000)
        .filter((ep) => ep.timestamp >= startTimestamp && ep.timestamp <= endTimestamp)

      episodes.push(...channelEpisodes)
    }

    // Sort by timestamp
    episodes.sort((a, b) => a.timestamp - b.timestamp)

    return episodes
  }

  /**
   * Group episodes by session ID.
   */
  private groupEpisodesBySession(episodes: Episode[]): SessionGroup[] {
    const sessionMap = new Map<string, SessionGroup>()

    for (const episode of episodes) {
      if (!sessionMap.has(episode.session_id)) {
        sessionMap.set(episode.session_id, {
          sessionId: episode.session_id,
          channel: episode.channel,
          sourceId: episode.source_id,
          episodes: [],
          startTime: episode.timestamp,
          endTime: episode.timestamp,
        })
      }

      const session = sessionMap.get(episode.session_id)!
      session.episodes.push(episode)
      session.endTime = Math.max(session.endTime, episode.timestamp)
    }

    return Array.from(sessionMap.values()).sort((a, b) => a.startTime - b.startTime)
  }

  /**
   * Calculate metadata for the daily log.
   */
  private calculateMetadata(
    date: string,
    sessions: SessionGroup[],
    allEpisodes: Episode[]
  ): DailyLogMetadata {
    const channels = Array.from(new Set(sessions.map((s) => s.channel)))

    return {
      date,
      channels,
      sessions: sessions.length,
      totalMessages: allEpisodes.length,
    }
  }

  /**
   * Format episodes into markdown with YAML frontmatter.
   */
  private formatDailyLogMarkdown(
    metadata: DailyLogMetadata,
    sessions: SessionGroup[],
    tags: string[] = []
  ): string {
    const lines: string[] = []

    // YAML frontmatter
    lines.push('---')
    lines.push(`date: ${metadata.date}`)
    lines.push(`channels: [${metadata.channels.join(', ')}]`)
    lines.push(`sessions: ${metadata.sessions}`)
    lines.push(`total_messages: ${metadata.totalMessages}`)
    if (tags.length > 0) {
      lines.push(`tags: [${tags.join(', ')}]`)
    }
    lines.push('---')
    lines.push('')

    // Sessions
    for (const session of sessions) {
      const startTime = this.formatTime(session.startTime)
      const endTime = this.formatTime(session.endTime)

      lines.push(
        `## Session: ${session.channel}/${session.sourceId} (${startTime} - ${endTime})`
      )
      lines.push('')

      // Episodes in this session
      for (const episode of session.episodes) {
        const time = this.formatTime(episode.timestamp)
        const role = episode.role.charAt(0).toUpperCase() + episode.role.slice(1)

        lines.push(`### ${role} (${time})`)
        lines.push(episode.content)
        lines.push('')
      }
    }

    return lines.join('\n')
  }

  /**
   * Generate an empty daily log when no episodes exist for the date.
   */
  private generateEmptyDailyLog(date: string): string {
    return [
      '---',
      `date: ${date}`,
      'channels: []',
      'sessions: 0',
      'total_messages: 0',
      '---',
      '',
      '## No Activity',
      '',
      'No conversations recorded for this date.',
      '',
    ].join('\n')
  }

  /**
   * Format timestamp as HH:MM time string.
   */
  private formatTime(timestamp: number): string {
    const date = new Date(timestamp)
    const hours = date.getHours().toString().padStart(2, '0')
    const minutes = date.getMinutes().toString().padStart(2, '0')
    return `${hours}:${minutes}`
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
   * Escape special regex characters in a string.
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
}

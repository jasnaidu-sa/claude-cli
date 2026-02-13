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
 */

import { EventEmitter } from 'events'
import { watch, FSWatcher } from 'chokidar'
import { writeFile, mkdir, access } from 'fs/promises'
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
   * Creates: memory/, memory/episodes/, memory/knowledge/, memory/skills/, memory/health/
   */
  async ensureDirectoryStructure(): Promise<void> {
    const dirs = [
      join(this.workspacePath, 'memory'),
      join(this.workspacePath, 'memory', 'episodes'),
      join(this.workspacePath, 'memory', 'knowledge'),
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

    // Generate markdown
    const markdown = this.formatDailyLogMarkdown(metadata, sessions)

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
      depth: 2, // Watch memory/ and subdirectories
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
    sessions: SessionGroup[]
  ): string {
    const lines: string[] = []

    // YAML frontmatter
    lines.push('---')
    lines.push(`date: ${metadata.date}`)
    lines.push(`channels: [${metadata.channels.join(', ')}]`)
    lines.push(`sessions: ${metadata.sessions}`)
    lines.push(`total_messages: ${metadata.totalMessages}`)
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
}

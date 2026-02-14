/**
 * Digest Utilities - HN API + RSS Parsing + Project Status
 *
 * Provides data-fetching utilities for the daily-digest skill.
 * These functions are called by the skill executor's MCP tools
 * to gather information from configured sources.
 *
 * Supports:
 * - Hacker News top stories via Firebase API
 * - RSS/Atom feed parsing via fast-xml-parser
 * - Git project status summaries
 * - Keyword-based content filtering
 */

import type { DigestSource } from '@shared/skills-types'

const LOG = '[DigestUtils]'

// ============================================================================
// Types
// ============================================================================

export interface HNStory {
  id: number
  title: string
  url?: string
  score: number
  by: string
  time: number
  descendants: number // comment count
}

export interface RSSItem {
  title: string
  link: string
  description: string
  pubDate?: string
  source: string
}

export interface ProjectStatus {
  path: string
  name: string
  branch: string
  uncommittedChanges: number
  recentCommits: string[]
  lastActivity?: string
}

export interface DigestData {
  date: string
  hnStories: HNStory[]
  rssItems: RSSItem[]
  projectStatuses: ProjectStatus[]
  errors: string[]
}

// ============================================================================
// Hacker News
// ============================================================================

const HN_API_BASE = 'https://hacker-news.firebaseio.com/v0'

/**
 * Fetch top stories from Hacker News.
 */
export async function fetchHNTopStories(
  maxItems: number = 10,
  keywords?: string[],
): Promise<{ stories: HNStory[]; errors: string[] }> {
  const errors: string[] = []

  try {
    const resp = await fetch(`${HN_API_BASE}/topstories.json`)
    if (!resp.ok) throw new Error(`HN API returned ${resp.status}`)

    const storyIds: number[] = await resp.json()
    const topIds = storyIds.slice(0, maxItems * 3) // fetch extra for filtering

    // Fetch story details in parallel (batched to avoid overwhelming)
    const stories: HNStory[] = []
    const batchSize = 10

    for (let i = 0; i < topIds.length && stories.length < maxItems; i += batchSize) {
      const batch = topIds.slice(i, i + batchSize)
      const batchResults = await Promise.allSettled(
        batch.map(async (id) => {
          const itemResp = await fetch(`${HN_API_BASE}/item/${id}.json`)
          if (!itemResp.ok) return null
          return (await itemResp.json()) as HNStory
        }),
      )

      for (const result of batchResults) {
        if (result.status !== 'fulfilled' || !result.value) continue
        const story = result.value

        // Apply keyword filter
        if (keywords && keywords.length > 0) {
          const matchesKeyword = keywords.some((kw) =>
            story.title.toLowerCase().includes(kw.toLowerCase()),
          )
          if (!matchesKeyword) continue
        }

        stories.push(story)
        if (stories.length >= maxItems) break
      }
    }

    // Sort by score descending
    stories.sort((a, b) => b.score - a.score)

    return { stories: stories.slice(0, maxItems), errors }
  } catch (err) {
    const msg = `HN fetch failed: ${err instanceof Error ? err.message : String(err)}`
    console.warn(LOG, msg)
    errors.push(msg)
    return { stories: [], errors }
  }
}

// ============================================================================
// RSS Feed Parsing
// ============================================================================

/**
 * Fetch and parse an RSS/Atom feed.
 */
export async function fetchRSSFeed(
  source: DigestSource,
  maxItems: number = 5,
  keywords?: string[],
): Promise<{ items: RSSItem[]; errors: string[] }> {
  const errors: string[] = []

  try {
    const resp = await fetch(source.url, {
      headers: { 'User-Agent': 'ClaudeCodeManager/1.0 DigestBot' },
      signal: AbortSignal.timeout(15_000),
    })

    if (!resp.ok) throw new Error(`RSS fetch returned ${resp.status}`)

    const xml = await resp.text()
    const items = parseRSSXml(xml, source.name, maxItems, keywords)

    return { items, errors }
  } catch (err) {
    const msg = `RSS "${source.name}" failed: ${err instanceof Error ? err.message : String(err)}`
    console.warn(LOG, msg)
    errors.push(msg)
    return { items: [], errors }
  }
}

/**
 * Parse RSS/Atom XML into RSSItem[].
 * Uses a lightweight regex-based parser to avoid heavy XML dependencies.
 */
function parseRSSXml(
  xml: string,
  sourceName: string,
  maxItems: number,
  keywords?: string[],
): RSSItem[] {
  const items: RSSItem[] = []

  // Try fast-xml-parser if available
  try {
    const { XMLParser } = require('fast-xml-parser')
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
    })
    const parsed = parser.parse(xml)

    // Handle RSS 2.0
    const rssItems =
      parsed?.rss?.channel?.item ??
      parsed?.feed?.entry ?? // Atom
      []

    const itemArray = Array.isArray(rssItems) ? rssItems : [rssItems]

    for (const item of itemArray) {
      if (items.length >= maxItems) break

      const title = item.title ?? item['media:title'] ?? ''
      const link = item.link?.['@_href'] ?? item.link ?? item.guid ?? ''
      const description = stripHtml(
        item.description ?? item.summary ?? item.content ?? '',
      ).slice(0, 200)
      const pubDate = item.pubDate ?? item.published ?? item.updated ?? ''

      // Keyword filter
      if (keywords && keywords.length > 0) {
        const text = `${title} ${description}`.toLowerCase()
        if (!keywords.some((kw) => text.includes(kw.toLowerCase()))) continue
      }

      items.push({
        title: typeof title === 'string' ? title : String(title),
        link: typeof link === 'string' ? link : String(link),
        description,
        pubDate: typeof pubDate === 'string' ? pubDate : undefined,
        source: sourceName,
      })
    }

    return items
  } catch {
    // fast-xml-parser not available, use regex fallback
    return parseRSSWithRegex(xml, sourceName, maxItems, keywords)
  }
}

/**
 * Lightweight regex-based RSS parser (fallback if fast-xml-parser not installed).
 */
function parseRSSWithRegex(
  xml: string,
  sourceName: string,
  maxItems: number,
  keywords?: string[],
): RSSItem[] {
  const items: RSSItem[] = []
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi
  let match: RegExpExecArray | null

  while ((match = itemRegex.exec(xml)) !== null) {
    if (items.length >= maxItems) break

    const itemXml = match[1]
    const title = extractXmlTag(itemXml, 'title')
    const link = extractXmlTag(itemXml, 'link')
    const description = stripHtml(extractXmlTag(itemXml, 'description')).slice(0, 200)
    const pubDate = extractXmlTag(itemXml, 'pubDate')

    if (!title) continue

    if (keywords && keywords.length > 0) {
      const text = `${title} ${description}`.toLowerCase()
      if (!keywords.some((kw) => text.includes(kw.toLowerCase()))) continue
    }

    items.push({ title, link, description, pubDate, source: sourceName })
  }

  // Also try Atom <entry> format
  if (items.length === 0) {
    const entryRegex = /<entry>([\s\S]*?)<\/entry>/gi
    while ((match = entryRegex.exec(xml)) !== null) {
      if (items.length >= maxItems) break

      const entryXml = match[1]
      const title = extractXmlTag(entryXml, 'title')
      const linkMatch = entryXml.match(/<link[^>]*href="([^"]*)"/)
      const link = linkMatch?.[1] ?? ''
      const description = stripHtml(
        extractXmlTag(entryXml, 'summary') || extractXmlTag(entryXml, 'content'),
      ).slice(0, 200)

      if (!title) continue

      if (keywords && keywords.length > 0) {
        const text = `${title} ${description}`.toLowerCase()
        if (!keywords.some((kw) => text.includes(kw.toLowerCase()))) continue
      }

      items.push({ title, link, description, source: sourceName })
    }
  }

  return items
}

function extractXmlTag(xml: string, tag: string): string {
  // Handle CDATA sections
  const cdataRegex = new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`, 'i')
  const cdataMatch = xml.match(cdataRegex)
  if (cdataMatch) return cdataMatch[1].trim()

  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i')
  const match = xml.match(regex)
  return match ? match[1].trim() : ''
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// ============================================================================
// Project Status
// ============================================================================

/**
 * Get git status for a list of project paths.
 */
export async function getProjectStatuses(
  projectPaths: string[],
): Promise<{ statuses: ProjectStatus[]; errors: string[] }> {
  const statuses: ProjectStatus[] = []
  const errors: string[] = []
  const { execFile } = require('child_process')
  const { promisify } = require('util')
  const path = require('path')
  const fs = require('fs')
  const exec = promisify(execFile)

  for (const projectPath of projectPaths) {
    try {
      // Security: Validate path is a real directory (prevents path traversal / symlink attacks)
      const resolved = path.resolve(projectPath)
      const stat = await fs.promises.lstat(resolved)
      if (!stat.isDirectory()) {
        errors.push(`Not a directory: "${projectPath}"`)
        continue
      }
      // Reject symlinks to prevent symlink-based traversal
      if (stat.isSymbolicLink()) {
        errors.push(`Symlink not allowed: "${projectPath}"`)
        continue
      }

      const name = path.basename(resolved)

      // Get current branch (using validated resolved path)
      const { stdout: branch } = await exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd: resolved,
        timeout: 5000,
      })

      // Get status (short format)
      const { stdout: statusOutput } = await exec('git', ['status', '--short'], {
        cwd: resolved,
        timeout: 5000,
      })

      // Get recent commits
      const { stdout: logOutput } = await exec('git', ['log', '--oneline', '-3'], {
        cwd: resolved,
        timeout: 5000,
      })

      const uncommittedChanges = statusOutput.trim()
        ? statusOutput.trim().split('\n').length
        : 0

      const recentCommits = logOutput.trim()
        ? logOutput.trim().split('\n').slice(0, 3)
        : []

      statuses.push({
        path: projectPath,
        name,
        branch: branch.trim(),
        uncommittedChanges,
        recentCommits,
        lastActivity: recentCommits[0] || undefined,
      })
    } catch (err) {
      const msg = `Git status for "${projectPath}": ${err instanceof Error ? err.message : String(err)}`
      errors.push(msg)
    }
  }

  return { statuses, errors }
}

// ============================================================================
// Digest Composition
// ============================================================================

/**
 * Fetch all digest data from configured sources.
 */
export async function gatherDigestData(
  sources: DigestSource[],
  maxItemsPerSource: number,
  keywords?: string[],
  projectPaths?: string[],
): Promise<DigestData> {
  const errors: string[] = []

  // Fetch HN stories
  const hnSource = sources.find((s) => s.type === 'hackernews' && s.enabled)
  let hnStories: HNStory[] = []
  if (hnSource) {
    const hn = await fetchHNTopStories(maxItemsPerSource, keywords)
    hnStories = hn.stories
    errors.push(...hn.errors)
  }

  // Fetch RSS feeds in parallel
  const rssSources = sources.filter((s) => s.type === 'rss' && s.enabled)
  const rssResults = await Promise.allSettled(
    rssSources.map((s) => fetchRSSFeed(s, maxItemsPerSource, keywords)),
  )

  const rssItems: RSSItem[] = []
  for (const result of rssResults) {
    if (result.status === 'fulfilled') {
      rssItems.push(...result.value.items)
      errors.push(...result.value.errors)
    }
  }

  // Get project statuses
  let projectStatuses: ProjectStatus[] = []
  if (projectPaths && projectPaths.length > 0) {
    const ps = await getProjectStatuses(projectPaths)
    projectStatuses = ps.statuses
    errors.push(...ps.errors)
  }

  return {
    date: new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }),
    hnStories,
    rssItems,
    projectStatuses,
    errors,
  }
}

/**
 * Format digest data into a readable message.
 * Keeps under 2000 chars for WhatsApp compatibility.
 */
export function formatDigestMessage(data: DigestData): string {
  const parts: string[] = []
  const MAX_LENGTH = 1900 // leave room for footer

  parts.push(`Good morning! Here's your digest for ${data.date}:`)

  // Tech News (HN)
  if (data.hnStories.length > 0) {
    parts.push('')
    parts.push('*Tech News*')
    for (const story of data.hnStories.slice(0, 5)) {
      const line = `- ${story.title} (${story.score}pts, ${story.descendants}c)`
      parts.push(line)
    }
  }

  // RSS Items
  if (data.rssItems.length > 0) {
    parts.push('')
    parts.push('*RSS Feeds*')
    for (const item of data.rssItems.slice(0, 5)) {
      const line = `- [${item.source}] ${item.title}`
      parts.push(line)
    }
  }

  // Project Status
  if (data.projectStatuses.length > 0) {
    parts.push('')
    parts.push('*Projects*')
    for (const project of data.projectStatuses) {
      const changes = project.uncommittedChanges > 0
        ? `${project.uncommittedChanges} changes`
        : 'clean'
      parts.push(`- ${project.name} (${project.branch}): ${changes}`)
    }
  }

  // Errors
  if (data.errors.length > 0) {
    parts.push('')
    parts.push(`_${data.errors.length} source(s) had issues_`)
  }

  let message = parts.join('\n')

  // Truncate if too long
  if (message.length > MAX_LENGTH) {
    message = message.slice(0, MAX_LENGTH - 20) + '\n\n_[truncated]_'
  }

  return message
}

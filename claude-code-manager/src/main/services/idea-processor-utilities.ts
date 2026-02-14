/**
 * Idea Processor Utilities - Content Extraction + Project Matching
 *
 * Provides utilities for the idea-processor skill to extract content
 * from URLs, categorize ideas, and match them to existing projects.
 *
 * Supports:
 * - URL content extraction (HTML → plain text)
 * - Article metadata extraction (title, description, OG tags)
 * - Project directory discovery and matching
 * - Idea categorization
 */

const LOG = '[IdeaUtils]'

// ============================================================================
// Types
// ============================================================================

export interface ExtractedContent {
  url: string
  title: string
  description: string
  content: string
  siteName?: string
  author?: string
  publishedDate?: string
  imageUrl?: string
  wordCount: number
}

export interface IdeaCategory {
  type: 'new_project' | 'enhancement' | 'learning' | 'tool' | 'general'
  confidence: number
  tags: string[]
  suggestedTitle: string
}

export interface ProjectMatch {
  name: string
  path: string
  relevance: number
  reason: string
  matchedKeywords: string[]
}

export interface ProcessedIdea {
  content: ExtractedContent | null
  category: IdeaCategory
  projectMatches: ProjectMatch[]
  summary: string
  timestamp: number
}

// ============================================================================
// Security: URL Validation (SSRF Prevention)
// ============================================================================

/** Blocked IP ranges for SSRF protection. */
const BLOCKED_IP_PATTERNS = [
  /^127\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./,
  /^169\.254\./, /^0\./, /^::1$/, /^fc00:/, /^fe80:/, /^fd/,
  /^localhost$/i,
]

/** Allowed URL protocols. */
const ALLOWED_PROTOCOLS = ['http:', 'https:']

/**
 * Validate a URL before fetching to prevent SSRF attacks.
 * Blocks internal IPs, metadata endpoints, non-HTTP protocols.
 */
function validateFetchUrl(urlStr: string): void {
  let parsed: URL
  try {
    parsed = new URL(urlStr)
  } catch {
    throw new Error(`Invalid URL: ${urlStr}`)
  }

  // Only allow http/https
  if (!ALLOWED_PROTOCOLS.includes(parsed.protocol)) {
    throw new Error(`Blocked protocol: ${parsed.protocol}`)
  }

  // Block cloud metadata endpoints
  const hostname = parsed.hostname.toLowerCase()
  if (hostname === '169.254.169.254' || hostname === 'metadata.google.internal') {
    throw new Error('Blocked: cloud metadata endpoint')
  }

  // Block internal/private IP ranges
  for (const pattern of BLOCKED_IP_PATTERNS) {
    if (pattern.test(hostname)) {
      throw new Error(`Blocked: internal/private address ${hostname}`)
    }
  }

  // Block empty or overly long hostnames
  if (!hostname || hostname.length > 253) {
    throw new Error('Invalid hostname')
  }
}

// ============================================================================
// Content Extraction
// ============================================================================

/**
 * Extract content from a URL. Fetches the page and extracts
 * title, description, and main body text.
 */
export async function extractUrlContent(url: string): Promise<ExtractedContent> {
  try {
    // Security: Validate URL to prevent SSRF attacks
    validateFetchUrl(url)

    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ClaudeCodeManager/1.0; +https://github.com)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(15_000),
      redirect: 'manual', // Prevent redirect-based SSRF bypass
    })

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}: ${resp.statusText}`)
    }

    const html = await resp.text()
    return parseHtmlContent(url, html)
  } catch (err) {
    console.warn(LOG, `Content extraction failed for ${url}:`, err)
    return {
      url,
      title: url,
      description: '',
      content: `Failed to extract content: ${err instanceof Error ? err.message : String(err)}`,
      wordCount: 0,
    }
  }
}

/**
 * Parse HTML and extract structured content.
 */
function parseHtmlContent(url: string, html: string): ExtractedContent {
  // Extract <title>
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
  let title = titleMatch ? decodeHtmlEntities(titleMatch[1].trim()) : ''

  // Extract meta tags
  const ogTitle = extractMetaContent(html, 'og:title')
  const ogDescription = extractMetaContent(html, 'og:description')
  const ogSiteName = extractMetaContent(html, 'og:site_name')
  const ogImage = extractMetaContent(html, 'og:image')
  const metaDescription = extractMetaContent(html, 'description')
  const author = extractMetaContent(html, 'author') || extractMetaContent(html, 'article:author')
  const publishedDate = extractMetaContent(html, 'article:published_time')

  // Use OG title if available and better
  if (ogTitle && ogTitle.length > title.length) {
    title = ogTitle
  }

  const description = ogDescription || metaDescription || ''

  // Extract main body text
  const content = extractBodyText(html)
  const wordCount = content.split(/\s+/).filter(Boolean).length

  return {
    url,
    title,
    description,
    content: content.slice(0, 5000), // Limit content length
    siteName: ogSiteName || undefined,
    author: author || undefined,
    publishedDate: publishedDate || undefined,
    imageUrl: ogImage || undefined,
    wordCount,
  }
}

function extractMetaContent(html: string, property: string): string {
  // Try property attribute (OG tags)
  const propMatch = html.match(
    new RegExp(`<meta[^>]*property=["']${escapeRegex(property)}["'][^>]*content=["']([^"']*)["']`, 'i'),
  )
  if (propMatch) return decodeHtmlEntities(propMatch[1])

  // Try name attribute
  const nameMatch = html.match(
    new RegExp(`<meta[^>]*name=["']${escapeRegex(property)}["'][^>]*content=["']([^"']*)["']`, 'i'),
  )
  if (nameMatch) return decodeHtmlEntities(nameMatch[1])

  // Try reversed attribute order
  const reversedMatch = html.match(
    new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*(?:property|name)=["']${escapeRegex(property)}["']`, 'i'),
  )
  if (reversedMatch) return decodeHtmlEntities(reversedMatch[1])

  return ''
}

function extractBodyText(html: string): string {
  // Remove script, style, nav, footer, header, and aside elements
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<aside[\s\S]*?<\/aside>/gi, '')

  // Try to find article or main content
  const articleMatch = text.match(/<article[^>]*>([\s\S]*?)<\/article>/i)
  const mainMatch = text.match(/<main[^>]*>([\s\S]*?)<\/main>/i)
  const contentMatch = text.match(/<div[^>]*class="[^"]*(?:content|article|post|entry)[^"]*"[^>]*>([\s\S]*?)<\/div>/i)

  if (articleMatch) text = articleMatch[1]
  else if (mainMatch) text = mainMatch[1]
  else if (contentMatch) text = contentMatch[1]

  // Strip remaining HTML tags
  text = text
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return text
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ============================================================================
// Idea Categorization
// ============================================================================

/** Keywords associated with each idea category. */
const CATEGORY_KEYWORDS: Record<IdeaCategory['type'], string[]> = {
  new_project: [
    'build', 'create', 'new project', 'startup', 'app idea', 'saas',
    'product', 'mvp', 'prototype', 'launch',
  ],
  enhancement: [
    'improve', 'add feature', 'enhance', 'upgrade', 'optimize',
    'refactor', 'fix', 'update', 'integrate', 'extend',
  ],
  learning: [
    'tutorial', 'learn', 'course', 'guide', 'documentation', 'how to',
    'best practices', 'patterns', 'architecture', 'design',
  ],
  tool: [
    'tool', 'library', 'framework', 'package', 'sdk', 'api',
    'cli', 'plugin', 'extension', 'service',
  ],
  general: [
    'interesting', 'cool', 'fun', 'bookmark', 'reference', 'save',
  ],
}

/**
 * Categorize an idea based on its content and context.
 */
export function categorizeIdea(
  title: string,
  description: string,
  userMessage?: string,
): IdeaCategory {
  const text = `${title} ${description} ${userMessage ?? ''}`.toLowerCase()

  // Score each category
  const scores: Record<string, { score: number; matched: string[] }> = {}

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    const matched: string[] = []
    let score = 0

    for (const keyword of keywords) {
      if (text.includes(keyword.toLowerCase())) {
        score += 1
        matched.push(keyword)
      }
    }

    scores[category] = { score, matched }
  }

  // Find highest scoring category
  let bestCategory: IdeaCategory['type'] = 'general'
  let bestScore = 0
  let bestMatched: string[] = []

  for (const [category, { score, matched }] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score
      bestCategory = category as IdeaCategory['type']
      bestMatched = matched
    }
  }

  // Generate tags from matched keywords + extracted keywords
  const tags = new Set<string>(bestMatched)
  // Add tech keywords found in text
  const techKeywords = [
    'typescript', 'javascript', 'python', 'rust', 'react', 'node',
    'ai', 'ml', 'llm', 'api', 'database', 'web', 'mobile', 'cloud',
    'docker', 'kubernetes', 'aws', 'gcp', 'azure', 'supabase',
  ]
  for (const kw of techKeywords) {
    if (text.includes(kw)) tags.add(kw)
  }

  // Confidence based on score relative to total keywords checked
  const confidence = Math.min(bestScore / 3, 1.0)

  return {
    type: bestCategory,
    confidence,
    tags: Array.from(tags).slice(0, 10),
    suggestedTitle: title || (userMessage?.slice(0, 60) ?? 'Untitled Idea'),
  }
}

// ============================================================================
// Project Matching
// ============================================================================

/**
 * Find and score project matches based on idea content.
 * Scans known project directories for relevance.
 */
export async function matchProjectsByContent(
  ideaText: string,
  projectPaths: string[],
): Promise<ProjectMatch[]> {
  const matches: ProjectMatch[] = []
  const fs = require('fs')
  const path = require('path')

  const ideaWords = new Set(
    ideaText.toLowerCase().split(/\s+/).filter((w: string) => w.length > 3),
  )

  for (const projectPath of projectPaths) {
    try {
      const name = path.basename(projectPath)
      const matchedKeywords: string[] = []
      let relevanceScore = 0

      // Check if project name appears in idea text
      if (ideaText.toLowerCase().includes(name.toLowerCase())) {
        relevanceScore += 0.5
        matchedKeywords.push(name)
      }

      // Read package.json or similar for keywords
      const packagePath = path.join(projectPath, 'package.json')
      if (fs.existsSync(packagePath)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf-8'))
          const pkgKeywords = [
            ...(pkg.keywords ?? []),
            pkg.description?.split(/\s+/) ?? [],
          ].flat()

          for (const kw of pkgKeywords) {
            if (ideaWords.has(kw.toLowerCase())) {
              relevanceScore += 0.2
              matchedKeywords.push(kw)
            }
          }
        } catch {
          // Ignore parse errors
        }
      }

      // Read CLAUDE.md for context
      const claudeMdPath = path.join(projectPath, 'CLAUDE.md')
      if (fs.existsSync(claudeMdPath)) {
        try {
          const claudeMd = fs.readFileSync(claudeMdPath, 'utf-8').toLowerCase()
          const claudeWords = new Set(claudeMd.split(/\s+/).filter((w: string) => w.length > 4))

          let overlapCount = 0
          for (const word of ideaWords) {
            if (claudeWords.has(word)) overlapCount++
          }

          if (overlapCount > 0) {
            relevanceScore += Math.min(overlapCount * 0.1, 0.3)
          }
        } catch {
          // Ignore read errors
        }
      }

      // Check README.md
      const readmePath = path.join(projectPath, 'README.md')
      if (fs.existsSync(readmePath)) {
        try {
          const readme = fs.readFileSync(readmePath, 'utf-8').toLowerCase()
          const firstLine = readme.split('\n')[0]?.replace(/^#+\s*/, '') ?? ''

          if (ideaText.toLowerCase().includes(firstLine.slice(0, 30).toLowerCase()) && firstLine.length > 5) {
            relevanceScore += 0.2
            matchedKeywords.push(firstLine.slice(0, 30))
          }
        } catch {
          // Ignore
        }
      }

      // Only include projects with some relevance
      if (relevanceScore > 0.1) {
        const reason = matchedKeywords.length > 0
          ? `Matched keywords: ${matchedKeywords.slice(0, 5).join(', ')}`
          : 'General topic overlap'

        matches.push({
          name,
          path: projectPath,
          relevance: Math.min(relevanceScore, 1.0),
          reason,
          matchedKeywords: matchedKeywords.slice(0, 5),
        })
      }
    } catch (err) {
      console.warn(LOG, `Project scan failed for ${projectPath}:`, err)
    }
  }

  // Sort by relevance descending
  matches.sort((a, b) => b.relevance - a.relevance)
  return matches.slice(0, 5)
}

// ============================================================================
// URL Detection
// ============================================================================

/**
 * Extract URLs from a message text.
 */
export function extractUrls(text: string): string[] {
  const urlRegex = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi
  const matches = text.match(urlRegex) || []
  // Deduplicate
  return [...new Set(matches)]
}

/**
 * Check if a string appears to be primarily a URL share.
 */
export function isUrlMessage(text: string): boolean {
  const urls = extractUrls(text)
  if (urls.length === 0) return false

  // If the URL takes up most of the message
  const totalUrlLength = urls.reduce((sum, url) => sum + url.length, 0)
  return totalUrlLength > text.length * 0.4
}

// ============================================================================
// Idea Formatting
// ============================================================================

/**
 * Format a processed idea into a structured proposal message.
 */
export function formatIdeaProposal(idea: ProcessedIdea): string {
  const parts: string[] = []

  parts.push(`*New Idea: ${idea.category.suggestedTitle}*`)
  parts.push('')

  if (idea.summary) {
    parts.push(`*Summary*: ${idea.summary}`)
    parts.push('')
  }

  parts.push(`*Category*: ${idea.category.type}`)
  if (idea.category.tags.length > 0) {
    parts.push(`*Tags*: ${idea.category.tags.join(', ')}`)
  }

  if (idea.content) {
    parts.push(`*Source*: ${idea.content.siteName || idea.content.url}`)
    if (idea.content.wordCount > 0) {
      parts.push(`*Length*: ~${idea.content.wordCount} words`)
    }
  }

  if (idea.projectMatches.length > 0) {
    parts.push('')
    parts.push('*Related Projects*')
    for (const match of idea.projectMatches) {
      const pct = Math.round(match.relevance * 100)
      parts.push(`- ${match.name} (${pct}%) - ${match.reason}`)
    }
  }

  parts.push('')
  parts.push('*Suggested Actions*')
  parts.push('1. Save for reference')
  if (idea.projectMatches.length > 0) {
    parts.push(`2. Add to ${idea.projectMatches[0].name} backlog`)
  }
  if (idea.category.type === 'new_project') {
    parts.push('3. Create a new project')
  }
  parts.push('')
  parts.push('Reply with a number to proceed, or provide feedback.')

  return parts.join('\n')
}

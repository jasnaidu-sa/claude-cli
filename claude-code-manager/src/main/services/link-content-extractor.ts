/**
 * LinkContentExtractor - Extract and fetch content from URLs in emails
 *
 * Extracts URLs from email body content, fetches the page content,
 * and generates meaningful titles from article content.
 *
 * Features:
 * - URL extraction from plain text and HTML
 * - Content fetching with authentication support
 * - Title extraction from page content (og:title, <title>, h1)
 * - Summary generation from article content
 */

import { net } from 'electron'
import { getBrowserContentFetcher, requiresBrowserFetch } from './browser-content-fetcher'

/**
 * Extracted content from a URL
 */
export interface ExtractedContent {
  url: string
  title: string | null
  description: string | null
  siteName: string | null
  fetchedAt: number
  error?: string
  // Full article content (extracted from page)
  articleContent?: string
  // AI-generated summary
  summary?: string
  // Whether summary was generated
  summaryGenerated?: boolean
}

/**
 * Authentication credentials for paid sites
 */
export interface SiteCredentials {
  domain: string
  username: string
  password: string
}

/**
 * Common email signatures/footers to strip from text before URL extraction
 */
const EMAIL_SIGNATURE_PATTERNS = [
  /Get Outlook for iOS.*$/gis,
  /Get Outlook for Android.*$/gis,
  /Sent from my iPhone.*$/gis,
  /Sent from my iPad.*$/gis,
  /Sent from Mail for Windows.*$/gis,
  /Sent from Samsung.*$/gis,
  /Get the Outlook app.*$/gis,
  /________________________________.*$/gis, // Common email separator
]

/**
 * Extract URLs from text content
 */
export function extractUrls(text: string): string[] {
  // First, strip common email signatures/footers that contain unwanted links
  let cleanedText = text
  for (const pattern of EMAIL_SIGNATURE_PATTERNS) {
    cleanedText = cleanedText.replace(pattern, '')
  }

  // Match HTTP/HTTPS URLs
  const urlRegex = /https?:\/\/[^\s<>"')\]]+/gi
  const matches = cleanedText.match(urlRegex) || []

  // Clean up URLs (remove trailing punctuation that might be part of sentence)
  const cleanedUrls = matches.map(url => {
    // Remove trailing punctuation that's likely not part of the URL
    return url.replace(/[.,;:!?)]+$/, '')
  })

  // Filter out common email/app store URLs
  const filteredUrls = cleanedUrls.filter(url => {
    const lowerUrl = url.toLowerCase()
    // Skip app store links, Microsoft/Apple/Google common footer links
    if (lowerUrl.includes('aka.ms/') && lowerUrl.includes('outlook')) return false
    if (lowerUrl.includes('apps.apple.com') && lowerUrl.includes('outlook')) return false
    if (lowerUrl.includes('play.google.com') && lowerUrl.includes('outlook')) return false
    if (lowerUrl.includes('itunes.apple.com')) return false
    return true
  })

  // Deduplicate
  return [...new Set(filteredUrls)]
}

/**
 * Extract the main content/article text from HTML
 */
function extractArticleText(html: string): string {
  // Remove script and style tags completely
  let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
  text = text.replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
  text = text.replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
  text = text.replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')

  // Try to find article content specifically
  const articleMatch = text.match(/<article[^>]*>([\s\S]*?)<\/article>/i)
  if (articleMatch) {
    text = articleMatch[1]
  } else {
    // Try main content
    const mainMatch = text.match(/<main[^>]*>([\s\S]*?)<\/main>/i)
    if (mainMatch) {
      text = mainMatch[1]
    }
  }

  // Remove remaining HTML tags
  text = text.replace(/<[^>]+>/g, ' ')

  // Decode HTML entities
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')

  // Clean up whitespace
  text = text.replace(/\s+/g, ' ').trim()

  return text
}

// Generic site names that shouldn't be used as titles
const GENERIC_TITLES = [
  'medium', 'twitter', 'facebook', 'linkedin', 'youtube', 'github',
  'reddit', 'hacker news', 'hn', 'home', 'index', 'welcome',
  'the decoder', 'substack', 'notion'
]

/**
 * Check if a title is too generic to be useful
 */
function isGenericTitle(title: string): boolean {
  const normalized = title.toLowerCase().trim()
  return GENERIC_TITLES.some(generic =>
    normalized === generic ||
    normalized === `${generic}.com` ||
    normalized === `www.${generic}.com`
  )
}

/**
 * Extract title from URL slug (useful for Medium and similar sites)
 */
function extractTitleFromUrl(url: string): string | null {
  try {
    const urlObj = new URL(url)
    const pathname = urlObj.pathname

    // Medium URLs often have format: /username/title-slug-hexid or /@username/title-slug-hexid
    // Also handles: /p/title-slug
    const mediumMatch = pathname.match(/\/(?:@[\w-]+\/|p\/)?([a-z0-9][\w-]*[a-z0-9])-[a-f0-9]{8,}$/i)
    if (mediumMatch) {
      // Convert slug to title: "my-article-title" -> "My Article Title"
      const slug = mediumMatch[1]
      return slug
        .split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ')
    }

    // Generic slug extraction for other sites
    // Look for the last meaningful path segment
    const segments = pathname.split('/').filter(s => s.length > 0)
    if (segments.length > 0) {
      const lastSegment = segments[segments.length - 1]
      // Skip if it looks like an ID or file
      if (!/^\d+$/.test(lastSegment) && !lastSegment.includes('.')) {
        // Remove common suffixes and convert to title
        const cleaned = lastSegment
          .replace(/[-_]/g, ' ')
          .replace(/\b\w/g, c => c.toUpperCase())
        if (cleaned.length > 5 && cleaned.split(' ').length > 1) {
          return cleaned
        }
      }
    }

    return null
  } catch {
    return null
  }
}

/**
 * Extract title from HTML content
 * Priority: og:title > twitter:title > <title> > first <h1> > URL slug
 */
function extractTitle(html: string, url?: string): string | null {
  let bestTitle: string | null = null

  // Try og:title
  const ogTitleMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:title["']/i)
  if (ogTitleMatch) {
    const title = decodeHtmlEntities(ogTitleMatch[1])
    if (!isGenericTitle(title)) {
      return title
    }
    bestTitle = title
  }

  // Try twitter:title
  const twitterTitleMatch = html.match(/<meta[^>]*name=["']twitter:title["'][^>]*content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']twitter:title["']/i)
  if (twitterTitleMatch) {
    const title = decodeHtmlEntities(twitterTitleMatch[1])
    if (!isGenericTitle(title)) {
      return title
    }
    if (!bestTitle) bestTitle = title
  }

  // Try <title>
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
  if (titleMatch) {
    const title = decodeHtmlEntities(titleMatch[1].trim())
    // Clean up common suffixes like "| Site Name" or "- Site Name"
    const cleanedTitle = title.replace(/\s*[\|\-–—]\s*[^|\-–—]+$/, '').trim()
    if (!isGenericTitle(cleanedTitle)) {
      return cleanedTitle
    }
    if (!bestTitle) bestTitle = cleanedTitle
  }

  // Try first <h1>
  const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i)
  if (h1Match) {
    const title = decodeHtmlEntities(h1Match[1].trim())
    if (!isGenericTitle(title)) {
      return title
    }
    if (!bestTitle) bestTitle = title
  }

  // Try extracting from URL slug (useful for Medium, Substack, etc.)
  if (url) {
    const urlTitle = extractTitleFromUrl(url)
    if (urlTitle && !isGenericTitle(urlTitle)) {
      return urlTitle
    }
  }

  // Return whatever we have, even if generic
  return bestTitle
}

/**
 * Extract description from HTML content
 */
function extractDescription(html: string): string | null {
  // Try og:description
  const ogDescMatch = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:description["']/i)
  if (ogDescMatch) {
    return decodeHtmlEntities(ogDescMatch[1])
  }

  // Try meta description
  const metaDescMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["']/i)
  if (metaDescMatch) {
    return decodeHtmlEntities(metaDescMatch[1])
  }

  // Fall back to first paragraph or article text
  const articleText = extractArticleText(html)
  if (articleText.length > 100) {
    return articleText.substring(0, 300) + '...'
  }

  return null
}

/**
 * Extract site name from HTML
 */
function extractSiteName(html: string, url: string): string | null {
  // Try og:site_name
  const siteNameMatch = html.match(/<meta[^>]*property=["']og:site_name["'][^>]*content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:site_name["']/i)
  if (siteNameMatch) {
    return decodeHtmlEntities(siteNameMatch[1])
  }

  // Fall back to domain
  try {
    const urlObj = new URL(url)
    return urlObj.hostname.replace('www.', '')
  } catch {
    return null
  }
}

/**
 * Decode HTML entities
 */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
}

/**
 * User agents to try for paywalled/bot-blocked sites
 * Social media crawlers often get full content for preview generation
 */
const CRAWLER_USER_AGENTS = [
  // Facebook crawler (gets content for link previews)
  'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
  // Twitter card fetcher
  'Twitterbot/1.0',
  // LinkedIn bot
  'LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)',
  // Slack bot
  'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
  // Google bot (may be blocked by some sites)
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
]

/**
 * Fetch content from a URL with retry using different user agents
 */
async function fetchUrlContent(url: string, credentials?: SiteCredentials): Promise<string> {
  const urlLower = url.toLowerCase()
  const isPaywalled = urlLower.includes('medium.com') ||
    urlLower.includes('towardsdatascience.com') ||
    urlLower.includes('substack.com')

  // For paywalled sites, try multiple user agents
  const userAgentsToTry = isPaywalled
    ? CRAWLER_USER_AGENTS
    : ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36']

  let lastError: Error | null = null

  for (const userAgent of userAgentsToTry) {
    try {
      console.log(`[LinkExtractor] Trying fetch with UA: ${userAgent.substring(0, 30)}...`)
      const result = await fetchWithUserAgent(url, userAgent, credentials)
      console.log(`[LinkExtractor] Success with UA: ${userAgent.substring(0, 30)}...`)
      return result
    } catch (error) {
      lastError = error as Error
      console.log(`[LinkExtractor] Failed with UA ${userAgent.substring(0, 30)}...: ${lastError.message}`)
      // Continue to try next user agent
    }
  }

  throw lastError || new Error('All fetch attempts failed')
}

/**
 * Fetch with specific user agent
 */
function fetchWithUserAgent(url: string, userAgent: string, credentials?: SiteCredentials): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = net.request({
      url,
      method: 'GET',
      redirect: 'follow'
    })

    // Set headers
    request.setHeader('User-Agent', userAgent)
    request.setHeader('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8')
    request.setHeader('Accept-Language', 'en-US,en;q=0.9')
    request.setHeader('Accept-Encoding', 'identity') // Don't request compressed content
    request.setHeader('Cache-Control', 'no-cache')
    request.setHeader('Pragma', 'no-cache')

    // Set referer based on user agent
    if (userAgent.includes('Googlebot')) {
      request.setHeader('Referer', 'https://www.google.com/')
    } else if (userAgent.includes('facebook')) {
      request.setHeader('Referer', 'https://www.facebook.com/')
    } else if (userAgent.includes('Twitter')) {
      request.setHeader('Referer', 'https://twitter.com/')
    }

    // If credentials provided, add basic auth header (note: won't work for OAuth sites like Medium)
    if (credentials) {
      const authHeader = Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')
      request.setHeader('Authorization', `Basic ${authHeader}`)
    }

    let responseData = ''

    request.on('response', (response) => {
      if (response.statusCode && response.statusCode >= 400) {
        reject(new Error(`HTTP ${response.statusCode}`))
        return
      }

      response.on('data', (chunk) => {
        responseData += chunk.toString()
      })

      response.on('end', () => {
        resolve(responseData)
      })

      response.on('error', (error) => {
        reject(error)
      })
    })

    request.on('error', (error) => {
      reject(error)
    })

    // Set timeout
    setTimeout(() => {
      request.abort()
      reject(new Error('Request timeout'))
    }, 15000)

    request.end()
  })
}

/**
 * LinkContentExtractor Service
 */
export class LinkContentExtractor {
  private credentials: Map<string, SiteCredentials> = new Map()
  private cache: Map<string, ExtractedContent> = new Map()
  private cacheTTL = 1000 * 60 * 60 // 1 hour

  /**
   * Add credentials for a domain
   */
  addCredentials(domain: string, username: string, password: string): void {
    this.credentials.set(domain.toLowerCase(), { domain, username, password })
  }

  /**
   * Get credentials for a URL
   */
  private getCredentialsForUrl(url: string): SiteCredentials | undefined {
    try {
      const urlObj = new URL(url)
      const domain = urlObj.hostname.toLowerCase()

      // Check exact match
      if (this.credentials.has(domain)) {
        return this.credentials.get(domain)
      }

      // Check without www
      const domainNoWww = domain.replace('www.', '')
      if (this.credentials.has(domainNoWww)) {
        return this.credentials.get(domainNoWww)
      }

      // Check parent domain
      for (const [credDomain, creds] of this.credentials) {
        if (domain.endsWith('.' + credDomain) || domain === credDomain) {
          return creds
        }
      }

      return undefined
    } catch {
      return undefined
    }
  }

  /**
   * Extract URLs from email content
   */
  extractUrlsFromEmail(emailBody: string): string[] {
    return extractUrls(emailBody)
  }

  /**
   * Fetch and extract content from a single URL
   * Now includes full article text for AI summarization
   * Uses browser fallback for paywalled sites
   */
  async fetchContent(url: string): Promise<ExtractedContent> {
    console.log(`[LinkExtractor] fetchContent called for: ${url}`)

    // Check cache
    const cached = this.cache.get(url)
    if (cached && Date.now() - cached.fetchedAt < this.cacheTTL) {
      console.log(`[LinkExtractor] Returning cached result for ${url} (articleContent: ${cached.articleContent?.length || 0} chars)`)
      return cached
    }
    console.log(`[LinkExtractor] No cache hit, fetching fresh content for ${url}`)

    // Check if this URL likely requires browser-based fetching
    const needsBrowser = requiresBrowserFetch(url)

    try {
      // Try HTTP fetch first (faster)
      const credentials = this.getCredentialsForUrl(url)
      const html = await fetchUrlContent(url, credentials)

      // Extract full article text for AI summarization
      const articleContent = extractArticleText(html)
      console.log(`[LinkExtractor] Extracted article content for ${url}: ${articleContent.length} chars`)

      // Truncate article content if too long (keep first 10000 chars for summarization)
      const truncatedContent = articleContent.length > 10000
        ? articleContent.substring(0, 10000) + '...'
        : articleContent

      const title = extractTitle(html, url)
      console.log(`[LinkExtractor] Extracted title: "${title}"`)

      const content: ExtractedContent = {
        url,
        title,
        description: extractDescription(html),
        siteName: extractSiteName(html, url),
        articleContent: truncatedContent.length > 100 ? truncatedContent : undefined,
        fetchedAt: Date.now()
      }
      console.log(`[LinkExtractor] Final articleContent included: ${!!content.articleContent}`)

      // Cache the result
      this.cache.set(url, content)

      return content
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.log(`[LinkExtractor] HTTP fetch failed for ${url}: ${errorMessage}`)

      // If HTTP failed and this is a paywalled site, try browser fallback
      if (needsBrowser && (errorMessage.includes('403') || errorMessage.includes('401') || errorMessage.includes('429'))) {
        console.log(`[LinkExtractor] Trying browser fallback for paywalled site: ${url}`)
        return this.fetchContentWithBrowser(url)
      }

      const content: ExtractedContent = {
        url,
        title: null,
        description: null,
        siteName: null,
        fetchedAt: Date.now(),
        error: errorMessage
      }
      return content
    }
  }

  /**
   * Fetch content using browser (for paywalled sites)
   */
  private async fetchContentWithBrowser(url: string): Promise<ExtractedContent> {
    try {
      const browserFetcher = getBrowserContentFetcher()
      const result = await browserFetcher.fetchContent(url)

      if (result.error) {
        console.log(`[LinkExtractor] Browser fetch error: ${result.error}`)
        return {
          url,
          title: result.title,
          description: null,
          siteName: null,
          fetchedAt: Date.now(),
          error: result.error
        }
      }

      const content: ExtractedContent = {
        url,
        title: result.title,
        description: null, // Browser doesn't extract meta description
        siteName: null,
        articleContent: result.articleContent || undefined,
        fetchedAt: Date.now()
      }

      console.log(`[LinkExtractor] Browser fetch success: title="${result.title}", content=${result.articleContent?.length || 0} chars`)

      // Cache the result
      this.cache.set(url, content)

      return content
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error(`[LinkExtractor] Browser fetch failed for ${url}:`, errorMessage)

      return {
        url,
        title: null,
        description: null,
        siteName: null,
        fetchedAt: Date.now(),
        error: `Browser fetch failed: ${errorMessage}`
      }
    }
  }

  /**
   * Fetch content from all URLs in email body
   */
  async fetchAllUrlContents(emailBody: string): Promise<ExtractedContent[]> {
    const urls = this.extractUrlsFromEmail(emailBody)
    console.log(`[LinkExtractor] fetchAllUrlContents found ${urls.length} URLs in email body`)
    console.log(`[LinkExtractor] Email body preview: ${emailBody.substring(0, 300)}...`)

    if (urls.length === 0) {
      console.log(`[LinkExtractor] No URLs found in email body`)
    } else {
      urls.forEach((url, i) => console.log(`[LinkExtractor] URL ${i + 1}: ${url}`))
    }

    // Limit to first 5 URLs to avoid too many requests
    const urlsToFetch = urls.slice(0, 5)

    // Fetch in parallel with a delay between requests
    const results: ExtractedContent[] = []
    for (const url of urlsToFetch) {
      try {
        const content = await this.fetchContent(url)
        results.push(content)
      } catch (error) {
        console.error(`[LinkExtractor] Failed to fetch ${url}:`, error)
      }
      // Small delay between requests
      await new Promise(resolve => setTimeout(resolve, 500))
    }

    return results
  }

  /**
   * Generate a title from email content and extracted URLs
   * Returns the best title found: first from URLs, then from email subject
   */
  async generateTitle(emailSubject: string, emailBody: string): Promise<{ title: string; source: 'url' | 'email' }> {
    // If subject already has meaningful content (not just a link), use it
    const subjectHasContent = emailSubject &&
      emailSubject.length > 10 &&
      !emailSubject.match(/^https?:\/\//i) &&
      !emailSubject.match(/^(fwd|fw|re):/i)

    if (subjectHasContent) {
      return { title: emailSubject, source: 'email' }
    }

    // Try to extract title from first URL
    const urls = this.extractUrlsFromEmail(emailBody)
    if (urls.length > 0) {
      const content = await this.fetchContent(urls[0])
      if (content.title) {
        return { title: content.title, source: 'url' }
      }
    }

    // Fall back to email subject or a default
    return {
      title: emailSubject || 'Untitled Idea',
      source: 'email'
    }
  }

  /**
   * Clear the cache
   */
  clearCache(): void {
    this.cache.clear()
  }
}

// Note: OAuth-based sites like Medium, Substack require browser session cookies
// Basic Auth credentials would only work for sites that support HTTP Basic Authentication
// We rely on social media crawler user-agents to access paywalled content instead

// Singleton instance
let linkExtractor: LinkContentExtractor | null = null

export function getLinkContentExtractor(): LinkContentExtractor {
  if (!linkExtractor) {
    linkExtractor = new LinkContentExtractor()
  }
  return linkExtractor
}

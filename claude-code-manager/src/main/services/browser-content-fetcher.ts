/**
 * BrowserContentFetcher - Fetch content from paywalled sites using Playwright
 *
 * Uses a persistent browser session with saved cookies to access
 * sites that require login (Medium, Substack, etc.)
 *
 * Features:
 * - Persistent browser context with saved cookies
 * - Manual login support through visible browser window
 * - Cookie persistence across sessions
 * - Fallback for HTTP 403 errors
 */

import { chromium, Browser, BrowserContext, Page } from 'playwright'
import { app } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import { EventEmitter } from 'events'

/**
 * Content fetched from a page
 */
export interface BrowserFetchedContent {
  url: string
  title: string | null
  articleContent: string | null
  error?: string
}

/**
 * BrowserContentFetcher Service
 */
export class BrowserContentFetcher extends EventEmitter {
  private browser: Browser | null = null
  private context: BrowserContext | null = null
  private cookiesPath: string
  private isInitialized = false
  private initPromise: Promise<void> | null = null

  constructor() {
    super()
    // Store cookies in app data directory
    this.cookiesPath = path.join(app.getPath('userData'), 'browser-cookies.json')
    console.log(`[BrowserFetcher] Cookies will be stored at: ${this.cookiesPath}`)
  }

  /**
   * Initialize the browser (lazy initialization)
   */
  private async initialize(): Promise<void> {
    if (this.isInitialized) return

    // Prevent multiple simultaneous initializations
    if (this.initPromise) {
      return this.initPromise
    }

    this.initPromise = this._doInitialize()
    await this.initPromise
    this.initPromise = null
  }

  private async _doInitialize(): Promise<void> {
    try {
      console.log('[BrowserFetcher] Launching headless browser...')

      // Launch browser in headless mode for content fetching
      this.browser = await chromium.launch({
        headless: true,
        args: [
          '--disable-blink-features=AutomationControlled',
          '--no-sandbox'
        ]
      })

      // Create context with saved cookies if available
      const contextOptions: any = {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 },
        deviceScaleFactor: 1,
        isMobile: false,
        hasTouch: false,
        javaScriptEnabled: true,
        ignoreHTTPSErrors: true
      }

      this.context = await this.browser.newContext(contextOptions)

      // Load saved cookies if they exist
      await this.loadCookies()

      this.isInitialized = true
      console.log('[BrowserFetcher] Browser initialized successfully')
    } catch (error) {
      console.error('[BrowserFetcher] Failed to initialize browser:', error)
      throw error
    }
  }

  /**
   * Load saved cookies into the context
   */
  private async loadCookies(): Promise<void> {
    try {
      if (fs.existsSync(this.cookiesPath)) {
        const cookiesData = fs.readFileSync(this.cookiesPath, 'utf-8')
        const cookies = JSON.parse(cookiesData)
        if (cookies && Array.isArray(cookies) && cookies.length > 0) {
          await this.context!.addCookies(cookies)
          console.log(`[BrowserFetcher] Loaded ${cookies.length} saved cookies`)
        }
      }
    } catch (error) {
      console.warn('[BrowserFetcher] Could not load cookies:', error)
    }
  }

  /**
   * Save current cookies to disk
   */
  async saveCookies(): Promise<void> {
    if (!this.context) return

    try {
      const cookies = await this.context.cookies()
      fs.writeFileSync(this.cookiesPath, JSON.stringify(cookies, null, 2))
      console.log(`[BrowserFetcher] Saved ${cookies.length} cookies`)
    } catch (error) {
      console.error('[BrowserFetcher] Failed to save cookies:', error)
    }
  }

  /**
   * Open a visible browser window for manual login
   * User can log into sites like Medium, then cookies are saved
   */
  async openLoginWindow(url: string = 'https://medium.com/m/signin'): Promise<void> {
    console.log(`[BrowserFetcher] Opening login window for: ${url}`)

    // Launch a VISIBLE browser for login
    const loginBrowser = await chromium.launch({
      headless: false,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox'
      ]
    })

    // Create context with existing cookies if available
    const contextOptions: any = {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      viewport: { width: 1200, height: 800 }
    }

    const loginContext = await loginBrowser.newContext(contextOptions)

    // Load existing cookies
    try {
      if (fs.existsSync(this.cookiesPath)) {
        const cookiesData = fs.readFileSync(this.cookiesPath, 'utf-8')
        const cookies = JSON.parse(cookiesData)
        if (cookies && Array.isArray(cookies) && cookies.length > 0) {
          await loginContext.addCookies(cookies)
        }
      }
    } catch (error) {
      console.warn('[BrowserFetcher] Could not load existing cookies for login:', error)
    }

    const page = await loginContext.newPage()
    await page.goto(url, { waitUntil: 'domcontentloaded' })

    this.emit('login-window-opened', url)

    // Wait for the browser to be closed by the user
    await new Promise<void>((resolve) => {
      loginBrowser.on('disconnected', async () => {
        console.log('[BrowserFetcher] Login browser closed')

        // Save cookies from the login session
        try {
          const cookies = await loginContext.cookies()
          fs.writeFileSync(this.cookiesPath, JSON.stringify(cookies, null, 2))
          console.log(`[BrowserFetcher] Saved ${cookies.length} cookies from login session`)

          // Reload cookies into the headless context
          if (this.context) {
            await this.context.addCookies(cookies)
          }
        } catch (error) {
          console.error('[BrowserFetcher] Failed to save login cookies:', error)
        }

        this.emit('login-complete')
        resolve()
      })
    })
  }

  /**
   * Fetch content from a URL using the browser
   */
  async fetchContent(url: string): Promise<BrowserFetchedContent> {
    console.log(`[BrowserFetcher] Fetching content from: ${url}`)

    await this.initialize()

    if (!this.context) {
      return {
        url,
        title: null,
        articleContent: null,
        error: 'Browser not initialized'
      }
    }

    let page: Page | null = null

    try {
      page = await this.context.newPage()

      // Navigate to the URL
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      })

      // Wait a bit for dynamic content
      await page.waitForTimeout(2000)

      // Check if we're on a login/paywall page
      const pageUrl = page.url()
      if (pageUrl.includes('/signin') || pageUrl.includes('/login') || pageUrl.includes('/subscribe')) {
        console.log('[BrowserFetcher] Hit paywall/login page, needs manual login')
        return {
          url,
          title: null,
          articleContent: null,
          error: 'Login required - use openLoginWindow() first'
        }
      }

      // Extract title
      const title = await page.title()

      // Extract article content
      const articleContent = await page.evaluate(() => {
        // Try to find article content in common locations
        const selectors = [
          'article',
          '[role="article"]',
          '.article-content',
          '.post-content',
          '.entry-content',
          'main article',
          '.story-body',
          '#article-body'
        ]

        for (const selector of selectors) {
          const element = document.querySelector(selector)
          if (element && element.textContent && element.textContent.length > 200) {
            return element.textContent
              .replace(/\s+/g, ' ')
              .trim()
              .substring(0, 10000) // Limit to 10k chars
          }
        }

        // Fallback to main content or body
        const main = document.querySelector('main') || document.body
        return main.textContent
          ?.replace(/\s+/g, ' ')
          .trim()
          .substring(0, 10000) || null
      })

      // Save cookies after successful fetch (may have updated session)
      await this.saveCookies()

      console.log(`[BrowserFetcher] Fetched content: title="${title}", content=${articleContent?.length || 0} chars`)

      return {
        url,
        title: title || null,
        articleContent: articleContent || null
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error(`[BrowserFetcher] Error fetching ${url}:`, errorMessage)

      return {
        url,
        title: null,
        articleContent: null,
        error: errorMessage
      }
    } finally {
      if (page) {
        await page.close().catch(() => {})
      }
    }
  }

  /**
   * Check if we have valid session cookies for a domain
   */
  async hasSessionFor(domain: string): Promise<boolean> {
    if (!this.context) {
      try {
        if (fs.existsSync(this.cookiesPath)) {
          const cookiesData = fs.readFileSync(this.cookiesPath, 'utf-8')
          const cookies = JSON.parse(cookiesData)
          return cookies.some((c: any) =>
            c.domain.includes(domain) &&
            (c.name.includes('session') || c.name.includes('token') || c.name.includes('uid'))
          )
        }
      } catch {
        return false
      }
    }

    try {
      if (!this.context) {
        return false
      }
      const cookies = await this.context.cookies()
      return cookies.some(c =>
        c.domain.includes(domain) &&
        (c.name.includes('session') || c.name.includes('token') || c.name.includes('uid'))
      )
    } catch {
      return false
    }
  }

  /**
   * Close the browser
   */
  async close(): Promise<void> {
    if (this.context) {
      await this.saveCookies()
      await this.context.close().catch(() => {})
      this.context = null
    }

    if (this.browser) {
      await this.browser.close().catch(() => {})
      this.browser = null
    }

    this.isInitialized = false
    console.log('[BrowserFetcher] Browser closed')
  }

  /**
   * Clear all saved cookies
   */
  clearCookies(): void {
    try {
      if (fs.existsSync(this.cookiesPath)) {
        fs.unlinkSync(this.cookiesPath)
        console.log('[BrowserFetcher] Cookies cleared')
      }
    } catch (error) {
      console.error('[BrowserFetcher] Failed to clear cookies:', error)
    }
  }
}

// Singleton instance
let browserFetcher: BrowserContentFetcher | null = null

export function getBrowserContentFetcher(): BrowserContentFetcher {
  if (!browserFetcher) {
    browserFetcher = new BrowserContentFetcher()
  }
  return browserFetcher
}

/**
 * Check if a URL likely requires browser-based fetching
 */
export function requiresBrowserFetch(url: string): boolean {
  const urlLower = url.toLowerCase()
  return urlLower.includes('medium.com') ||
    urlLower.includes('towardsdatascience.com') ||
    urlLower.includes('substack.com') ||
    urlLower.includes('nytimes.com') ||
    urlLower.includes('wsj.com') ||
    urlLower.includes('bloomberg.com')
}

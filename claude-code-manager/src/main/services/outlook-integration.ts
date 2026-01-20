/**
 * OutlookIntegrationService - Microsoft Outlook Email Integration
 *
 * Fetches emails from a specific sender address to import as project ideas.
 * Uses Microsoft Graph API for email access.
 *
 * Features:
 * - OAuth2 authentication with Microsoft
 * - Fetch emails from specific sender
 * - Parse email content for idea extraction
 * - Token refresh handling
 *
 * Security:
 * - Secure token storage
 * - Only accesses emails from configured sender
 */

import { EventEmitter } from 'events'
import Store from 'electron-store'
import { BrowserWindow, shell } from 'electron'
import type { OutlookConfig, IdeaEmailSource } from '@shared/types'

// Microsoft Graph API endpoints
const GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0'
const AUTH_ENDPOINT = 'https://login.microsoftonline.com'

// Secure store for Outlook config
const outlookStore = new Store<{ outlookConfig?: OutlookConfig }>({
  name: 'outlook-config',
  encryptionKey: 'ideas-kanban-outlook-secure'
})

/**
 * OutlookIntegrationService
 */
export class OutlookIntegrationService extends EventEmitter {
  private config: OutlookConfig | null = null
  private authWindow: BrowserWindow | null = null

  constructor() {
    super()
    this.loadConfig()
  }

  /**
   * Load config from secure store
   */
  private loadConfig(): void {
    const stored = outlookStore.get('outlookConfig')
    if (stored) {
      this.config = stored
    }
  }

  /**
   * Save config to secure store
   */
  private saveConfig(): void {
    if (this.config) {
      outlookStore.set('outlookConfig', this.config)
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): OutlookConfig | null {
    return this.config
  }

  /**
   * Configure Outlook integration
   */
  configure(config: Partial<OutlookConfig>): void {
    this.config = {
      clientId: config.clientId || '',
      tenantId: config.tenantId || 'common',
      redirectUri: config.redirectUri || 'http://localhost:3847/callback',
      sourceEmailAddress: config.sourceEmailAddress || '',
      ...config
    }
    this.saveConfig()
    this.emit('configured', this.config)
  }

  /**
   * Check if service is configured and authenticated
   */
  getStatus(): {
    configured: boolean
    authenticated: boolean
    sourceEmail: string | null
    lastSyncAt: number | null
  } {
    return {
      configured: !!this.config?.clientId && !!this.config?.sourceEmailAddress,
      authenticated: !!this.config?.accessToken && (!this.config.tokenExpiresAt || this.config.tokenExpiresAt > Date.now()),
      sourceEmail: this.config?.sourceEmailAddress || null,
      lastSyncAt: this.config?.lastSyncAt || null
    }
  }

  /**
   * Start OAuth2 authentication flow
   */
  async authenticate(): Promise<boolean> {
    if (!this.config?.clientId) {
      throw new Error('Outlook not configured. Please configure clientId first.')
    }

    const authUrl = this.buildAuthUrl()

    return new Promise((resolve, reject) => {
      // Create auth window
      this.authWindow = new BrowserWindow({
        width: 600,
        height: 800,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true
        }
      })

      this.authWindow.loadURL(authUrl)

      // Handle redirect with auth code
      this.authWindow.webContents.on('will-redirect', async (event, url) => {
        if (url.startsWith(this.config!.redirectUri)) {
          event.preventDefault()
          const code = new URL(url).searchParams.get('code')

          if (code) {
            try {
              await this.exchangeCodeForToken(code)
              this.authWindow?.close()
              resolve(true)
            } catch (err) {
              this.authWindow?.close()
              reject(err)
            }
          } else {
            const error = new URL(url).searchParams.get('error_description')
            this.authWindow?.close()
            reject(new Error(error || 'Authentication failed'))
          }
        }
      })

      this.authWindow.on('closed', () => {
        this.authWindow = null
      })
    })
  }

  /**
   * Build OAuth2 authorization URL
   */
  private buildAuthUrl(): string {
    const params = new URLSearchParams({
      client_id: this.config!.clientId,
      response_type: 'code',
      redirect_uri: this.config!.redirectUri,
      scope: 'https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Calendars.Read https://graph.microsoft.com/Calendars.ReadWrite https://graph.microsoft.com/Contacts.Read https://graph.microsoft.com/User.Read offline_access',
      response_mode: 'query'
    })

    return `${AUTH_ENDPOINT}/${this.config!.tenantId}/oauth2/v2.0/authorize?${params.toString()}`
  }

  /**
   * Exchange auth code for access token
   */
  private async exchangeCodeForToken(code: string): Promise<void> {
    const params: Record<string, string> = {
      client_id: this.config!.clientId,
      scope: 'https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Calendars.Read https://graph.microsoft.com/Calendars.ReadWrite https://graph.microsoft.com/Contacts.Read https://graph.microsoft.com/User.Read offline_access',
      code,
      redirect_uri: this.config!.redirectUri,
      grant_type: 'authorization_code'
    }

    // Add client secret if configured (for confidential client flow)
    if (this.config!.clientSecret) {
      params.client_secret = this.config!.clientSecret
      console.log('[OutlookAuth] Using confidential client flow with client secret')
    } else {
      console.log('[OutlookAuth] Using public client flow (no client secret)')
    }

    console.log('[OutlookAuth] Token exchange params:', {
      client_id: params.client_id,
      has_secret: !!params.client_secret,
      redirect_uri: params.redirect_uri,
      tenant: this.config!.tenantId
    })

    const response = await fetch(
      `${AUTH_ENDPOINT}/${this.config!.tenantId}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams(params)
      }
    )

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Token exchange failed: ${error}`)
    }

    const data = await response.json()
    this.config!.accessToken = data.access_token
    this.config!.refreshToken = data.refresh_token
    this.config!.tokenExpiresAt = Date.now() + (data.expires_in * 1000)
    this.saveConfig()
    this.emit('authenticated')
  }

  /**
   * Refresh access token using refresh token
   */
  private async refreshAccessToken(): Promise<void> {
    if (!this.config?.refreshToken) {
      throw new Error('No refresh token available. Please re-authenticate.')
    }

    const params: Record<string, string> = {
      client_id: this.config.clientId,
      scope: 'https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Calendars.Read https://graph.microsoft.com/Calendars.ReadWrite https://graph.microsoft.com/Contacts.Read https://graph.microsoft.com/User.Read offline_access',
      refresh_token: this.config.refreshToken,
      grant_type: 'refresh_token'
    }

    // Add client secret if configured (for confidential client flow)
    if (this.config.clientSecret) {
      params.client_secret = this.config.clientSecret
    }

    const response = await fetch(
      `${AUTH_ENDPOINT}/${this.config.tenantId}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams(params)
      }
    )

    if (!response.ok) {
      throw new Error('Token refresh failed. Please re-authenticate.')
    }

    const data = await response.json()
    this.config.accessToken = data.access_token
    this.config.refreshToken = data.refresh_token || this.config.refreshToken
    this.config.tokenExpiresAt = Date.now() + (data.expires_in * 1000)
    this.saveConfig()
  }

  /**
   * Ensure we have a valid access token
   */
  private async ensureValidToken(): Promise<void> {
    if (!this.config?.accessToken) {
      throw new Error('Not authenticated. Please authenticate first.')
    }

    // Refresh if token expires in less than 5 minutes
    if (this.config.tokenExpiresAt && this.config.tokenExpiresAt < Date.now() + 300000) {
      await this.refreshAccessToken()
    }
  }

  /**
   * Fetch emails from the configured source address
   * @param options.updateLastSync - Set to false to skip updating lastSyncAt (for full refresh)
   */
  async fetchEmails(options?: {
    maxResults?: number
    sinceDate?: Date
    onlySinceLastSync?: boolean
    updateLastSync?: boolean
  }): Promise<IdeaEmailSource[]> {
    await this.ensureValidToken()

    if (!this.config?.sourceEmailAddress) {
      throw new Error('Source email address not configured')
    }

    // maxResults is the desired number of FILTERED emails (after matching source)
    // We fetch more from mailbox since only a portion will match the source filter
    // Fetch 4x the requested amount to ensure we get enough matching emails
    const desiredResults = options?.maxResults || 50
    const fetchLimit = Math.min(desiredResults * 4, 500) // Cap at 500 to avoid excessive fetches

    // Simplified query - just get recent messages and filter client-side
    // Microsoft Graph doesn't support complex filters with orderby on receivedDateTime
    const params = new URLSearchParams({
      '$orderby': 'receivedDateTime desc',
      '$top': fetchLimit.toString(),
      '$select': 'id,subject,from,receivedDateTime,bodyPreview,body'
    })

    // Store the filter criteria for client-side filtering
    // Support multiple source emails separated by comma
    const sourceEmails = this.config.sourceEmailAddress
      .split(',')
      .map(email => email.trim().toLowerCase())

    let sinceTimestamp: number | undefined
    if (options?.sinceDate) {
      sinceTimestamp = options.sinceDate.getTime()
    } else if (options?.onlySinceLastSync && this.config.lastSyncAt) {
      sinceTimestamp = this.config.lastSyncAt
    }

    const response = await fetch(
      `${GRAPH_API_BASE}/me/messages?${params.toString()}`,
      {
        headers: {
          'Authorization': `Bearer ${this.config.accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    )

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Failed to fetch emails: ${error}`)
    }

    const data = await response.json()

    console.log(`[OutlookSync] Fetched ${data.value.length} emails from mailbox`)
    console.log(`[OutlookSync] Filtering for emails from: ${sourceEmails.join(', ')}`)

    // Update last sync time (skip for full refresh to preserve sync point)
    const shouldUpdateSync = options?.updateLastSync !== false
    if (shouldUpdateSync) {
      this.config.lastSyncAt = Date.now()
      this.saveConfig()
      console.log(`[OutlookSync] Updated lastSyncAt to: ${new Date(this.config.lastSyncAt).toISOString()}`)
    } else {
      console.log(`[OutlookSync] Skipping lastSyncAt update (full refresh mode)`)
    }

    // Filter and transform to IdeaEmailSource format
    const emails: IdeaEmailSource[] = data.value
      .filter((email: {
        from?: { emailAddress?: { address?: string } }
        receivedDateTime: string
      }) => {
        // Skip emails without a from field (drafts, sent items, system messages)
        if (!email.from?.emailAddress?.address) {
          console.log(`[OutlookSync] Skipping - no from address`)
          return false
        }

        // Filter by source email address (check if from any of the allowed addresses)
        const fromEmail = email.from.emailAddress.address.toLowerCase()

        console.log(`[OutlookSync] Checking email from: ${fromEmail}`)

        if (!sourceEmails.includes(fromEmail)) {
          console.log(`[OutlookSync] Skipping - not from allowed addresses`)
          return false
        }

        console.log(`[OutlookSync] Including - matches allowed address`)

        // Filter by date if specified
        if (sinceTimestamp) {
          const emailTimestamp = new Date(email.receivedDateTime).getTime()
          console.log(`[OutlookSync] Date check: email=${new Date(emailTimestamp).toISOString()} vs lastSync=${new Date(sinceTimestamp).toISOString()}`)
          if (emailTimestamp < sinceTimestamp) {
            console.log(`[OutlookSync] Skipping - email is older than last sync`)
            return false
          }
        }

        console.log(`[OutlookSync] ✓ Email passed all filters`)
        return true
      })
      .map((email: {
        id: string
        subject: string
        from: { emailAddress: { address: string } }
        receivedDateTime: string
        body: { content: string }
        bodyPreview: string
      }) => ({
        messageId: email.id,
        from: email.from.emailAddress.address,
        subject: email.subject,
        receivedAt: new Date(email.receivedDateTime).getTime(),
        body: this.stripHtml(email.body.content),
        snippet: email.bodyPreview
      }))

    // Cap at desired results
    const cappedEmails = emails.slice(0, desiredResults)
    console.log(`[OutlookSync] Filtered to ${emails.length} emails, returning ${cappedEmails.length} (max ${desiredResults})`)

    this.emit('emails-fetched', cappedEmails)
    return cappedEmails
  }

  /**
   * Strip HTML tags from email body
   */
  private stripHtml(html: string): string {
    return html
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, ' ')
      .trim()
  }

  /**
   * Clear stored credentials
   */
  clearCredentials(): void {
    if (this.config) {
      delete this.config.accessToken
      delete this.config.refreshToken
      delete this.config.tokenExpiresAt
      this.saveConfig()
    }
    this.emit('credentials-cleared')
  }

  /**
   * Reset lastSyncAt timestamp to 24 hours ago
   * Use this when the sync timestamp gets out of sync with actual email dates
   * Sets to 24 hours ago instead of clearing completely to avoid fetching all historical emails
   */
  resetLastSyncAt(): void {
    if (this.config) {
      // Set to 24 hours ago instead of clearing - this fetches recent emails without getting ALL history
      const twentyFourHoursAgo = Date.now() - (24 * 60 * 60 * 1000)
      this.config.lastSyncAt = twentyFourHoursAgo
      this.saveConfig()
      console.log(`[OutlookSync] Reset lastSyncAt to 24 hours ago: ${new Date(twentyFourHoursAgo).toISOString()}`)
    }
    this.emit('sync-reset')
  }
}

// Singleton instance
let outlookService: OutlookIntegrationService | null = null

export function getOutlookService(): OutlookIntegrationService {
  if (!outlookService) {
    outlookService = new OutlookIntegrationService()
  }
  return outlookService
}

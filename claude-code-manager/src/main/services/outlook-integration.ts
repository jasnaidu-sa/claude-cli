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
      scope: 'Mail.Read Mail.ReadBasic offline_access',
      response_mode: 'query'
    })

    return `${AUTH_ENDPOINT}/${this.config!.tenantId}/oauth2/v2.0/authorize?${params.toString()}`
  }

  /**
   * Exchange auth code for access token
   */
  private async exchangeCodeForToken(code: string): Promise<void> {
    const response = await fetch(
      `${AUTH_ENDPOINT}/${this.config!.tenantId}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          client_id: this.config!.clientId,
          scope: 'Mail.Read Mail.ReadBasic offline_access',
          code,
          redirect_uri: this.config!.redirectUri,
          grant_type: 'authorization_code'
        })
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

    const response = await fetch(
      `${AUTH_ENDPOINT}/${this.config.tenantId}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          client_id: this.config.clientId,
          scope: 'Mail.Read Mail.ReadBasic offline_access',
          refresh_token: this.config.refreshToken,
          grant_type: 'refresh_token'
        })
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
   */
  async fetchEmails(options?: {
    maxResults?: number
    sinceDate?: Date
    onlySinceLastSync?: boolean
  }): Promise<IdeaEmailSource[]> {
    await this.ensureValidToken()

    if (!this.config?.sourceEmailAddress) {
      throw new Error('Source email address not configured')
    }

    const maxResults = options?.maxResults || 50
    let filter = `from/emailAddress/address eq '${this.config.sourceEmailAddress}'`

    // Add date filter
    if (options?.sinceDate) {
      filter += ` and receivedDateTime ge ${options.sinceDate.toISOString()}`
    } else if (options?.onlySinceLastSync && this.config.lastSyncAt) {
      filter += ` and receivedDateTime ge ${new Date(this.config.lastSyncAt).toISOString()}`
    }

    const params = new URLSearchParams({
      '$filter': filter,
      '$orderby': 'receivedDateTime desc',
      '$top': maxResults.toString(),
      '$select': 'id,subject,from,receivedDateTime,bodyPreview,body'
    })

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

    // Update last sync time
    this.config.lastSyncAt = Date.now()
    this.saveConfig()

    // Transform to IdeaEmailSource format
    const emails: IdeaEmailSource[] = data.value.map((email: {
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

    this.emit('emails-fetched', emails)
    return emails
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
}

// Singleton instance
let outlookService: OutlookIntegrationService | null = null

export function getOutlookService(): OutlookIntegrationService {
  if (!outlookService) {
    outlookService = new OutlookIntegrationService()
  }
  return outlookService
}

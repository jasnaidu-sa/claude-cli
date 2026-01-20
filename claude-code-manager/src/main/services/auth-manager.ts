import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Centralized authentication manager for Claude services
 *
 * Provides unified access to Claude authentication across all services:
 * - Reads OAuth tokens from Claude CLI credentials
 * - Falls back to API keys from environment
 * - Handles token expiration checking
 *
 * This ensures all services (orchestrator, conflict resolution, etc.)
 * use the same authentication source.
 */

interface ClaudeCredentials {
  claudeAiOauth?: {
    accessToken: string;
    expiresAt: number;
  };
}

class AuthManager {
  private cachedToken: string | null = null;
  private cacheExpiry: number = 0;
  private cachedApiKey: string | null = null;
  private isOAuthToken: boolean = false;

  /**
   * Get authentication token from any available source
   *
   * Priority:
   * 1. OAuth token from Claude CLI credentials file
   * 2. ANTHROPIC_API_KEY environment variable
   * 3. CLAUDE_API_KEY environment variable
   * 4. ANTHROPIC_SESSION_KEY environment variable (manual override)
   */
  async getAuthToken(): Promise<string | null> {
    // Return cached token if still valid
    if (this.cachedToken && Date.now() < this.cacheExpiry) {
      return this.cachedToken;
    }

    // Try OAuth token from Claude CLI first
    const oauthToken = await this.getClaudeOAuthToken();
    if (oauthToken) {
      // Cache for 4 minutes (token valid for 5+ minutes)
      this.cachedToken = oauthToken;
      this.cacheExpiry = Date.now() + 4 * 60 * 1000;
      this.isOAuthToken = true;
      return oauthToken;
    }

    // Fall back to environment variables
    const apiKey =
      process.env.ANTHROPIC_API_KEY ||
      process.env.CLAUDE_API_KEY ||
      process.env.ANTHROPIC_SESSION_KEY ||
      null;

    if (apiKey) {
      // Cache API keys for 1 hour (they don't expire)
      this.cachedToken = apiKey;
      this.cacheExpiry = Date.now() + 60 * 60 * 1000;
      this.isOAuthToken = false;
    }

    return apiKey;
  }

  /**
   * Get API key specifically for direct Claude Messages API calls
   *
   * IMPORTANT: OAuth tokens from Claude CLI are NOT compatible with the
   * direct Messages API (api.anthropic.com). They only work with Claude's
   * OAuth-based services. For the Messages API, we need an actual API key.
   *
   * Priority:
   * 1. ANTHROPIC_API_KEY environment variable
   * 2. CLAUDE_API_KEY environment variable
   *
   * @returns API key if available, null otherwise
   */
  getApiKeyForMessagesApi(): string | null {
    if (this.cachedApiKey) {
      return this.cachedApiKey;
    }

    const apiKey =
      process.env.ANTHROPIC_API_KEY ||
      process.env.CLAUDE_API_KEY ||
      null;

    if (apiKey) {
      this.cachedApiKey = apiKey;
      console.log('[AuthManager] Found API key for Messages API');
    }

    return apiKey;
  }

  /**
   * Read OAuth token from Claude CLI credentials file
   *
   * Returns the access token if available and not expired,
   * undefined otherwise.
   */
  private async getClaudeOAuthToken(): Promise<string | undefined> {
    try {
      const credentialsPath = path.join(os.homedir(), '.claude', '.credentials.json');
      const content = await fs.readFile(credentialsPath, 'utf-8');
      const credentials: ClaudeCredentials = JSON.parse(content);

      // Check if token exists and is not expired
      const oauth = credentials?.claudeAiOauth;
      if (oauth?.accessToken) {
        const expiresAt = oauth.expiresAt || 0;
        const now = Date.now();

        // Token is valid if it expires more than 5 minutes from now
        if (expiresAt > now + 5 * 60 * 1000) {
          console.log('[AuthManager] Found valid OAuth token from Claude CLI credentials');
          return oauth.accessToken;
        } else {
          console.warn('[AuthManager] OAuth token is expired or expiring soon');
        }
      }
    } catch (error) {
      // File doesn't exist or is invalid - not an error, just means no OAuth setup
      if (error instanceof Error && 'code' in error && error.code !== 'ENOENT') {
        console.log('[AuthManager] Could not read Claude CLI credentials:', error.message);
      }
    }
    return undefined;
  }

  /**
   * Check if any authentication method is configured
   */
  async isAuthAvailable(): Promise<boolean> {
    const token = await this.getAuthToken();
    return token !== null;
  }

  /**
   * Check if an API key (not OAuth) is available for Messages API
   */
  hasApiKeyForMessagesApi(): boolean {
    return this.getApiKeyForMessagesApi() !== null;
  }

  /**
   * Check if the current cached token is an OAuth token
   * Must call getAuthToken() first to populate the cache
   */
  isCurrentTokenOAuth(): boolean {
    return this.isOAuthToken;
  }

  /**
   * Clear cached authentication (force refresh)
   */
  clearCache(): void {
    this.cachedToken = null;
    this.cacheExpiry = 0;
    this.cachedApiKey = null;
    this.isOAuthToken = false;
  }
}

// Export singleton instance
export const authManager = new AuthManager();
export default authManager;

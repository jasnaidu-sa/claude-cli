import type { ConflictRegion, ConflictResolutionResult } from '@shared/types/git';

/**
 * Claude API Service
 *
 * Handles communication with the Claude API for AI-assisted conflict resolution.
 * Uses the Messages API with minimal context for efficient processing.
 *
 * Security:
 * - API key validation before requests
 * - Rate limiting to prevent abuse
 * - Timeout enforcement
 * - Response validation
 */

// Constants
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
const MAX_TOKENS = 4096;
const REQUEST_TIMEOUT_MS = 30000; // 30 seconds
const RATE_LIMIT_REQUESTS_PER_MINUTE = 10;

/**
 * Type guard for Error objects
 */
function isErrorObject(error: unknown): error is Error {
  return error instanceof Error;
}

/**
 * API request options
 */
interface ClaudeAPIRequest {
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

/**
 * API response structure
 */
interface ClaudeAPIResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: Array<{
    type: 'text';
    text: string;
  }>;
  model: string;
  stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence';
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

/**
 * Rate limiter for API requests
 */
class RateLimiter {
  private timestamps: number[] = [];
  private readonly limit: number;
  private readonly windowMs: number;

  constructor(requestsPerMinute: number) {
    this.limit = requestsPerMinute;
    this.windowMs = 60000; // 1 minute
  }

  /**
   * Check if request is allowed, throw if rate limit exceeded
   */
  checkLimit(): void {
    const now = Date.now();

    // Remove timestamps outside the current window
    this.timestamps = this.timestamps.filter(ts => now - ts < this.windowMs);

    if (this.timestamps.length >= this.limit) {
      throw new Error(`Rate limit exceeded: maximum ${this.limit} requests per minute`);
    }

    this.timestamps.push(now);
  }

  /**
   * Get current usage stats
   */
  getStats(): { current: number; limit: number; resetInMs: number } {
    const now = Date.now();
    this.timestamps = this.timestamps.filter(ts => now - ts < this.windowMs);

    const oldestTimestamp = this.timestamps[0] || now;
    const resetInMs = Math.max(0, this.windowMs - (now - oldestTimestamp));

    return {
      current: this.timestamps.length,
      limit: this.limit,
      resetInMs
    };
  }
}

class ClaudeAPIService {
  private apiKey: string | null = null;
  private rateLimiter: RateLimiter;

  constructor() {
    this.rateLimiter = new RateLimiter(RATE_LIMIT_REQUESTS_PER_MINUTE);
    this.loadApiKey();
  }

  /**
   * Load API key/token from environment
   */
  private loadApiKey(): void {
    // Check multiple sources:
    // 1. ANTHROPIC_API_KEY - Direct API key (sk-ant-...)
    // 2. CLAUDE_API_KEY - Alternative API key
    // 3. ANTHROPIC_SESSION_KEY - OAuth token (Max plan)
    this.apiKey =
      process.env.ANTHROPIC_API_KEY ||
      process.env.CLAUDE_API_KEY ||
      process.env.ANTHROPIC_SESSION_KEY ||
      null;
  }

  /**
   * Validate API key/token is available
   */
  private validateApiKey(): void {
    if (!this.apiKey) {
      throw new Error(
        'Claude authentication not found. Set ANTHROPIC_API_KEY (API key) or ANTHROPIC_SESSION_KEY (OAuth/Max plan) environment variable.'
      );
    }

    // Support both API keys (sk-ant-...) and OAuth tokens (sessionKey format)
    // OAuth tokens don't have a consistent prefix, so we skip format validation for non-API-keys
    const isApiKey = this.apiKey.startsWith('sk-ant-');
    const isSessionKey = this.apiKey.length > 20 && !this.apiKey.startsWith('sk-ant-');

    if (!isApiKey && !isSessionKey) {
      throw new Error(
        'Invalid authentication format. Expected API key (sk-ant-...) or OAuth session token.'
      );
    }
  }

  /**
   * Make a request to the Claude API with timeout
   */
  private async makeRequest(
    systemPrompt: string,
    userPrompt: string,
    options: ClaudeAPIRequest = {}
  ): Promise<ClaudeAPIResponse> {
    this.validateApiKey();
    this.rateLimiter.checkLimit();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(ANTHROPIC_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey!,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: options.model || DEFAULT_MODEL,
          max_tokens: options.maxTokens || MAX_TOKENS,
          temperature: options.temperature ?? 0.0, // Deterministic for code
          system: systemPrompt,
          messages: [
            {
              role: 'user',
              content: userPrompt
            }
          ]
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Claude API error (${response.status}): ${errorBody}`);
      }

      const data = await response.json() as ClaudeAPIResponse;
      return data;
    } catch (error) {
      if (isErrorObject(error) && error.name === 'AbortError') {
        throw new Error(`Request timeout after ${REQUEST_TIMEOUT_MS}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Resolve a single conflict region using AI (Tier 2: conflict-only)
   *
   * Provides minimal context to the AI:
   * - The conflicting code sections (ours vs theirs)
   * - 5 lines of context before and after
   * - File path and language
   *
   * @param conflict - The conflict region to resolve
   * @param options - API request options
   * @returns Resolution result with resolved content
   */
  async resolveConflict(
    conflict: ConflictRegion,
    options: ClaudeAPIRequest = {}
  ): Promise<ConflictResolutionResult> {
    const fileExtension = conflict.filePath.split('.').pop() || '';
    const language = this.detectLanguage(fileExtension);

    const systemPrompt = `You are an expert code merge conflict resolver. Your task is to intelligently merge conflicting code changes.

Rules:
1. Analyze both versions carefully to understand the intent
2. Preserve functionality from both sides when possible
3. Maintain code style consistency
4. Ensure syntax correctness
5. Return ONLY the resolved code, no explanations or markdown
6. Do not include conflict markers (<<<<<<, =======, >>>>>>>)
7. If you cannot confidently resolve the conflict, return the error format below

Output format:
- On success: Return only the resolved code
- On failure: Return exactly "ERROR: [reason]" where [reason] explains why you cannot resolve it`;

    const userPrompt = `Resolve this merge conflict in a ${language} file:

File: ${conflict.filePath}
Lines: ${conflict.startLine}-${conflict.endLine}

Context before conflict:
\`\`\`${language}
${conflict.contextBefore}
\`\`\`

Our changes (current branch):
\`\`\`${language}
${conflict.oursContent}
\`\`\`

Their changes (incoming branch):
\`\`\`${language}
${conflict.theirsContent}
\`\`\`

Context after conflict:
\`\`\`${language}
${conflict.contextAfter}
\`\`\`

Provide the resolved code:`;

    try {
      const response = await this.makeRequest(systemPrompt, userPrompt, options);

      // Extract text from response
      const textContent = response.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('\n');

      // Check for error response
      if (textContent.startsWith('ERROR:')) {
        const errorMessage = textContent.substring(6).trim();
        return {
          filePath: conflict.filePath,
          resolvedContent: '',
          strategy: 'ai-conflict-only',
          confidence: 0,
          syntaxValid: false,
          error: errorMessage
        };
      }

      // Return successful resolution
      return {
        filePath: conflict.filePath,
        resolvedContent: textContent,
        strategy: 'ai-conflict-only',
        confidence: this.calculateConfidence(response),
        syntaxValid: true // Will be validated by syntax-validator
      };
    } catch (error) {
      const message = isErrorObject(error) ? error.message : String(error);
      return {
        filePath: conflict.filePath,
        resolvedContent: '',
        strategy: 'ai-conflict-only',
        confidence: 0,
        syntaxValid: false,
        error: `AI resolution failed: ${message}`
      };
    }
  }

  /**
   * Resolve a file with conflicts using full-file context (Tier 3: fallback)
   *
   * Provides complete file context to the AI when conflict-only resolution fails.
   * This is more expensive but has higher success rate for complex conflicts.
   *
   * @param filePath - Path to file with conflicts
   * @param fileContent - Complete file content including conflict markers
   * @param conflicts - Array of conflict regions in the file
   * @param options - API request options
   * @returns Resolution result
   */
  async resolveFileWithFullContext(
    filePath: string,
    fileContent: string,
    conflicts: ConflictRegion[],
    options: ClaudeAPIRequest = {}
  ): Promise<ConflictResolutionResult> {
    const fileExtension = filePath.split('.').pop() || '';
    const language = this.detectLanguage(fileExtension);

    const systemPrompt = `You are an expert code merge conflict resolver with access to the full file context.

Your task is to resolve ALL merge conflicts in the file while maintaining:
1. Code functionality and correctness
2. Consistent code style throughout the file
3. Proper syntax
4. Logical coherence between all parts of the file

Rules:
1. You have the complete file with conflict markers (<<<<<<, =======, >>>>>>>)
2. Resolve all conflicts by choosing the best approach for each
3. Return the COMPLETE file with all conflicts resolved
4. Do NOT include any conflict markers in your response
5. Maintain all non-conflicted code exactly as-is
6. If you cannot resolve, return "ERROR: [reason]"

Output format:
- Success: Return the complete resolved file content
- Failure: Return exactly "ERROR: [reason]"`;

    const conflictSummary = conflicts
      .map(
        (c, i) =>
          `Conflict ${i + 1}: Lines ${c.startLine}-${c.endLine} (${c.endLine - c.startLine + 1} lines)`
      )
      .join('\n');

    const userPrompt = `Resolve all merge conflicts in this ${language} file:

File: ${filePath}
Total conflicts: ${conflicts.length}

Conflict locations:
${conflictSummary}

Complete file content with conflict markers:
\`\`\`${language}
${fileContent}
\`\`\`

Provide the complete resolved file:`;

    try {
      const response = await this.makeRequest(systemPrompt, userPrompt, {
        ...options,
        maxTokens: options.maxTokens || 8192 // Larger context for full files
      });

      // Extract text from response
      const textContent = response.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('\n');

      // Check for error response
      if (textContent.startsWith('ERROR:')) {
        const errorMessage = textContent.substring(6).trim();
        return {
          filePath,
          resolvedContent: '',
          strategy: 'ai-full-file',
          confidence: 0,
          syntaxValid: false,
          error: errorMessage
        };
      }

      // Return successful resolution
      return {
        filePath,
        resolvedContent: textContent,
        strategy: 'ai-full-file',
        confidence: this.calculateConfidence(response),
        syntaxValid: true // Will be validated by syntax-validator
      };
    } catch (error) {
      const message = isErrorObject(error) ? error.message : String(error);
      return {
        filePath,
        resolvedContent: '',
        strategy: 'ai-full-file',
        confidence: 0,
        syntaxValid: false,
        error: `Full-file AI resolution failed: ${message}`
      };
    }
  }

  /**
   * Detect programming language from file extension
   */
  private detectLanguage(extension: string): string {
    const languageMap: Record<string, string> = {
      ts: 'typescript',
      tsx: 'typescript',
      js: 'javascript',
      jsx: 'javascript',
      py: 'python',
      json: 'json',
      md: 'markdown',
      css: 'css',
      scss: 'scss',
      html: 'html',
      go: 'go',
      rs: 'rust',
      java: 'java',
      cpp: 'cpp',
      c: 'c',
      sh: 'bash'
    };

    return languageMap[extension.toLowerCase()] || 'text';
  }

  /**
   * Calculate confidence score based on response characteristics
   *
   * Higher confidence when:
   * - Response completed normally (not truncated)
   * - Response is not too short (likely incomplete)
   * - Model used sufficient tokens
   */
  private calculateConfidence(response: ClaudeAPIResponse): number {
    let confidence = 100;

    // Penalize if response was truncated
    if (response.stop_reason === 'max_tokens') {
      confidence -= 30;
    }

    // Penalize very short responses (likely errors or incomplete)
    if (response.usage.output_tokens < 10) {
      confidence -= 40;
    }

    // Penalize if too many tokens used (might be overcomplicating)
    if (response.usage.output_tokens > MAX_TOKENS * 0.9) {
      confidence -= 20;
    }

    return Math.max(0, Math.min(100, confidence));
  }

  /**
   * Get rate limiter stats
   */
  getRateLimitStats(): { current: number; limit: number; resetInMs: number } {
    return this.rateLimiter.getStats();
  }

  /**
   * Check if API is properly configured
   */
  isConfigured(): boolean {
    try {
      this.validateApiKey();
      return true;
    } catch {
      return false;
    }
  }
}

export const claudeAPIService = new ClaudeAPIService();
export default claudeAPIService;

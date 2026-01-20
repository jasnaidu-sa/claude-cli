import type { ConflictRegion, ConflictResolutionResult } from '@shared/types/git';
import { authManager } from './auth-manager';
import { spawn } from 'child_process';
import { platform } from 'os';
import { ConfigStore } from './config-store';

/**
 * Article summary result
 */
export interface ArticleSummaryResult {
  summary: string;
  keyPoints?: string[];
  error?: string;
}

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
const HAIKU_MODEL = 'claude-haiku-4-5'; // Claude Haiku 4.5 - fastest, most cost-efficient model
const CLI_HAIKU_MODEL = 'claude-haiku-4-5'; // Full model ID for CLI
const MAX_TOKENS = 16384; // 16K tokens for batch summarization of multiple articles
const REQUEST_TIMEOUT_MS = 30000; // 30 seconds
const SUMMARIZE_TIMEOUT_MS = 45000; // 45 seconds for summarization (shorter articles)
const RATE_LIMIT_REQUESTS_PER_MINUTE = 30; // Higher limit for batch summarization
const CLI_TIMEOUT_MS = 180000; // 180 seconds (3 min) for CLI summarization

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
  timeoutMs?: number; // Custom timeout for specific operations
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
 * Get spawn options for cross-platform CLI execution
 * On Windows, .cmd files require shell interpretation
 */
function getSpawnConfig(cliPath: string): { command: string; shellOption: boolean } {
  if (platform() === 'win32') {
    return { command: cliPath, shellOption: true };
  }
  return { command: cliPath, shellOption: false };
}

/**
 * Create minimal safe environment for child processes
 * Includes paths needed for OAuth credential access
 */
function createSafeEnv(): NodeJS.ProcessEnv {
  const allowedVars = [
    'PATH', 'HOME', 'USERPROFILE', 'TEMP', 'TMP',
    'APPDATA', 'LOCALAPPDATA',
    'XDG_CONFIG_HOME', 'XDG_DATA_HOME',
    'LANG', 'LC_ALL', 'SHELL',
    'ANTHROPIC_API_KEY', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX',
    'NODE_ENV', 'npm_config_prefix',
    'SystemRoot', 'COMSPEC',
    'TERM', 'COLORTERM'
  ];
  const safeEnv: NodeJS.ProcessEnv = {};
  for (const key of allowedVars) {
    if (process.env[key]) {
      safeEnv[key] = process.env[key];
    }
  }
  return safeEnv;
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
  private rateLimiter: RateLimiter;
  private configStore: ConfigStore;

  constructor() {
    this.rateLimiter = new RateLimiter(RATE_LIMIT_REQUESTS_PER_MINUTE);
    this.configStore = new ConfigStore();
  }

  /**
   * Get API key for Claude Messages API
   *
   * NOTE: The Anthropic Messages API does NOT support OAuth tokens.
   * Only API keys work with api.anthropic.com.
   *
   * Uses:
   * 1. ANTHROPIC_API_KEY environment variable
   * 2. CLAUDE_API_KEY environment variable
   */
  private getAuthToken(): string {
    const apiKey = authManager.getApiKeyForMessagesApi();

    if (!apiKey) {
      throw new Error(
        'Claude API key not found.\n' +
        'The Anthropic Messages API requires an API key (OAuth is not supported).\n' +
        'Set ANTHROPIC_API_KEY environment variable to enable AI summaries.\n' +
        'Get your API key from: https://console.anthropic.com/settings/keys'
      );
    }

    return apiKey;
  }

  /**
   * Make a request to the Claude API with timeout
   */
  private async makeRequest(
    systemPrompt: string,
    userPrompt: string,
    options: ClaudeAPIRequest = {}
  ): Promise<ClaudeAPIResponse> {
    const authToken = this.getAuthToken();
    this.rateLimiter.checkLimit();

    const timeout = options.timeoutMs || REQUEST_TIMEOUT_MS;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(ANTHROPIC_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': authToken,
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
        throw new Error(`Request timeout after ${timeout}ms`);
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
   * Check if summarization is available
   *
   * Returns true if either:
   * 1. Claude CLI is configured (for OAuth-based summarization)
   * 2. API key is available (for direct API calls)
   */
  isConfigured(): boolean {
    const claudePath = this.configStore.get('claudeCliPath');
    const hasCliPath = !!claudePath && typeof claudePath === 'string';
    const hasApiKey = authManager.hasApiKeyForMessagesApi();
    return hasCliPath || hasApiKey;
  }

  /**
   * Summarize an article for idea discussion
   *
   * Uses direct API calls with Haiku model for fast, cheap summarization.
   * Falls back to Claude CLI only if no API key is available.
   *
   * @param articleContent - The full text content of the article
   * @param articleTitle - Optional title of the article
   * @param options - API request options
   * @returns Summary result with key points
   */
  async summarizeArticle(
    articleContent: string,
    articleTitle?: string,
    options: ClaudeAPIRequest = {}
  ): Promise<ArticleSummaryResult> {
    // Truncate content if too long (keep first 8000 chars)
    const truncatedContent = articleContent.length > 8000
      ? articleContent.substring(0, 8000) + '... [truncated]'
      : articleContent;

    const titlePart = articleTitle ? `Title: "${articleTitle}"\n\n` : '';

    const systemPrompt = `You are an expert at summarizing articles and extracting key insights. Your task is to:
1. Create a concise but comprehensive summary (2-4 paragraphs)
2. Extract 3-5 key points or takeaways
3. Identify any actionable insights or ideas

IMPORTANT: Summarize ONLY the content provided. Do NOT ask for more content or URLs. If the content appears truncated or incomplete, summarize what is available. Never refuse to summarize.

Format your response as:
SUMMARY:
[Your summary here]

KEY POINTS:
• [Point 1]
• [Point 2]
• [Point 3]
(etc.)

Keep the summary informative enough that someone can understand the article's main thesis and arguments without reading it, but also brief enough to be quickly scanned.`;

    const userPrompt = `${titlePart}Please summarize this article:

${truncatedContent}`;

    // Try direct API first (much faster - no CLI spawn overhead)
    if (authManager.hasApiKeyForMessagesApi()) {
      try {
        console.log('[ClaudeAPIService] Using direct API for fast summarization (Haiku model)');

        const response = await this.makeRequest(systemPrompt, userPrompt, {
          model: HAIKU_MODEL, // Use Haiku for speed and cost
          maxTokens: 1024, // Summaries don't need many tokens
          temperature: 0.3, // Slightly creative for natural summaries
          timeoutMs: SUMMARIZE_TIMEOUT_MS,
          ...options
        });

        // Extract text from response
        const result = response.content
          .filter(block => block.type === 'text')
          .map(block => block.text)
          .join('\n');

        // Parse the response
        const { summary, keyPoints } = this.parseSummaryResponse(result);

        console.log('[ClaudeAPIService] Direct API summarization complete, summary length:', summary.length);

        return { summary, keyPoints };
      } catch (error) {
        const message = isErrorObject(error) ? error.message : String(error);
        console.warn('[ClaudeAPIService] Direct API failed, falling back to CLI:', message);
        // Fall through to CLI
      }
    }

    // Fallback to CLI if no API key or API failed
    return this.summarizeArticleViaCLI(systemPrompt + '\n\n' + userPrompt);
  }

  /**
   * Parse summary response into structured format
   */
  private parseSummaryResponse(result: string): { summary: string; keyPoints?: string[] } {
    const summaryMatch = result.match(/SUMMARY:\s*([\s\S]*?)(?=KEY POINTS:|$)/i);
    const keyPointsMatch = result.match(/KEY POINTS:\s*([\s\S]*?)$/i);

    const summary = summaryMatch
      ? summaryMatch[1].trim()
      : result.trim();

    const keyPoints = keyPointsMatch
      ? keyPointsMatch[1]
          .split(/[•\-\*]\s*/)
          .map(p => p.trim())
          .filter(p => p.length > 0)
      : undefined;

    return { summary, keyPoints };
  }

  /**
   * Fallback summarization via Claude CLI (slower but works with OAuth)
   * Uses Haiku model for speed
   */
  private async summarizeArticleViaCLI(prompt: string): Promise<ArticleSummaryResult> {
    try {
      // Get Claude CLI path
      const claudePath = this.configStore.get('claudeCliPath');
      if (!claudePath || typeof claudePath !== 'string') {
        throw new Error('Claude CLI path not configured and no API key available');
      }

      const { command, shellOption } = getSpawnConfig(claudePath);
      const args = [
        '--print',
        '--model', CLI_HAIKU_MODEL, // Use Haiku for speed
        '--output-format', 'text',
        '--no-session-persistence', // Don't persist sessions for faster execution
        '-'  // Read from stdin
      ];

      console.log('[ClaudeAPIService] Spawning Claude CLI for summarization (Haiku model)');
      console.log('[ClaudeAPIService] CLI command:', command, args.join(' '));

      const result = await new Promise<string>((resolve, reject) => {
        let stdout = '';
        let stderr = '';

        const proc = spawn(command, args, {
          shell: shellOption,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: createSafeEnv()
        });

        console.log('[ClaudeAPIService] CLI process spawned, PID:', proc.pid);

        // Set timeout - but capture partial output if we have it
        const timeout = setTimeout(() => {
          console.log('[ClaudeAPIService] CLI timeout reached, killing process. stderr so far:', stderr.substring(0, 500));
          proc.kill('SIGTERM');
          // If we have partial output, use it instead of failing completely
          if (stdout.trim().length > 50) {
            console.log('[ClaudeAPIService] Timeout but have partial output, using it:', stdout.substring(0, 200));
            resolve(stdout);
          } else {
            reject(new Error(`CLI timeout after ${CLI_TIMEOUT_MS}ms`));
          }
        }, CLI_TIMEOUT_MS);

        proc.stdout?.on('data', (data: Buffer) => {
          const chunk = data.toString();
          stdout += chunk;
          console.log('[ClaudeAPIService] CLI stdout chunk:', chunk.substring(0, 100));
        });

        proc.stderr?.on('data', (data: Buffer) => {
          const chunk = data.toString();
          stderr += chunk;
          console.log('[ClaudeAPIService] CLI stderr:', chunk.substring(0, 200));
        });

        proc.on('error', (error: Error) => {
          clearTimeout(timeout);
          reject(new Error(`CLI spawn error: ${error.message}`));
        });

        proc.on('close', (code: number | null) => {
          clearTimeout(timeout);
          if (code === 0) {
            resolve(stdout);
          } else {
            reject(new Error(`CLI exited with code ${code}: ${stderr}`));
          }
        });

        // Write prompt to stdin
        if (proc.stdin) {
          proc.stdin.write(prompt);
          proc.stdin.end();
        } else {
          clearTimeout(timeout);
          reject(new Error('Failed to write to CLI stdin'));
        }
      });

      const { summary, keyPoints } = this.parseSummaryResponse(result);

      console.log('[ClaudeAPIService] CLI summarization complete, summary length:', summary.length);

      return { summary, keyPoints };
    } catch (error) {
      const message = isErrorObject(error) ? error.message : String(error);
      console.error('[ClaudeAPIService] CLI summarization failed:', message);
      return {
        summary: '',
        error: `Failed to summarize article: ${message}`
      };
    }
  }

  /**
   * Batch summarize multiple articles in a SINGLE CLI call
   * Much more efficient than individual calls - one CLI spawn for all articles
   *
   * @param articles - Array of {url, title, content} to summarize
   * @returns Map of URL to summary result
   */
  async summarizeArticlesBatch(
    articles: Array<{ url: string; title?: string; content: string }>
  ): Promise<Map<string, ArticleSummaryResult>> {
    const results = new Map<string, ArticleSummaryResult>();

    if (articles.length === 0) {
      return results;
    }

    // If only one article, use single summarization
    if (articles.length === 1) {
      const article = articles[0];
      const result = await this.summarizeArticle(article.content, article.title);
      results.set(article.url, result);
      return results;
    }

    // Build batch prompt with all articles
    const articlePrompts = articles.map((article, index) => {
      const truncatedContent = article.content.length > 6000
        ? article.content.substring(0, 6000) + '... [truncated]'
        : article.content;
      const titlePart = article.title ? `Title: "${article.title}"\n` : '';
      return `=== ARTICLE ${index + 1} ===
URL: ${article.url}
${titlePart}
${truncatedContent}`;
    }).join('\n\n');

    const batchPrompt = `You are summarizing multiple articles. For EACH article, provide a concise summary (2-3 paragraphs) and 3-5 key points.

IMPORTANT: Return your response in this EXACT format for each article:

--- ARTICLE 1 ---
URL: [the url]
SUMMARY:
[summary here]

KEY POINTS:
• [point 1]
• [point 2]
• [point 3]

--- ARTICLE 2 ---
URL: [the url]
SUMMARY:
[summary here]

KEY POINTS:
• [point 1]
• [point 2]

(continue for all articles)

Here are the ${articles.length} articles to summarize:

${articlePrompts}`;

    try {
      // Get Claude CLI path
      const claudePath = this.configStore.get('claudeCliPath');
      if (!claudePath || typeof claudePath !== 'string') {
        throw new Error('Claude CLI path not configured');
      }

      const { command, shellOption } = getSpawnConfig(claudePath);
      const args = [
        '--print',
        '--model', CLI_HAIKU_MODEL,
        '--output-format', 'text',
        '--no-session-persistence',
        '-'
      ];

      // Longer timeout for batch (5 minutes max)
      const batchTimeout = Math.min(CLI_TIMEOUT_MS * 2, 300000); // Max 5 minutes

      console.log(`[ClaudeAPIService] Batch summarizing ${articles.length} articles in ONE CLI call (Haiku)`);

      const result = await new Promise<string>((resolve, reject) => {
        let stdout = '';
        let stderr = '';

        const proc = spawn(command, args, {
          shell: shellOption,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: createSafeEnv()
        });

        const timeout = setTimeout(() => {
          proc.kill('SIGTERM');
          reject(new Error(`Batch CLI timeout after ${batchTimeout}ms`));
        }, batchTimeout);

        proc.stdout?.on('data', (data: Buffer) => {
          stdout += data.toString();
        });

        proc.stderr?.on('data', (data: Buffer) => {
          stderr += data.toString();
        });

        proc.on('error', (error: Error) => {
          clearTimeout(timeout);
          reject(new Error(`CLI spawn error: ${error.message}`));
        });

        proc.on('close', (code: number | null) => {
          clearTimeout(timeout);
          if (code === 0) {
            resolve(stdout);
          } else {
            reject(new Error(`CLI exited with code ${code}: ${stderr}`));
          }
        });

        if (proc.stdin) {
          proc.stdin.write(batchPrompt);
          proc.stdin.end();
        } else {
          clearTimeout(timeout);
          reject(new Error('Failed to write to CLI stdin'));
        }
      });

      // Parse batch response - split by article markers
      const articleSections = result.split(/---\s*ARTICLE\s+\d+\s*---/i).filter(s => s.trim());

      for (const section of articleSections) {
        // Extract URL from section
        const urlMatch = section.match(/URL:\s*(\S+)/i);
        if (!urlMatch) continue;

        const url = urlMatch[1];
        const { summary, keyPoints } = this.parseSummaryResponse(section);

        if (summary) {
          results.set(url, { summary, keyPoints });
        }
      }

      console.log(`[ClaudeAPIService] Batch summarization complete: ${results.size}/${articles.length} successful`);

      // For any articles not in results, mark as failed
      for (const article of articles) {
        if (!results.has(article.url)) {
          results.set(article.url, {
            summary: '',
            error: 'Failed to parse summary from batch response'
          });
        }
      }

      return results;
    } catch (error) {
      const message = isErrorObject(error) ? error.message : String(error);
      console.error('[ClaudeAPIService] Batch summarization failed:', message);

      // Mark all as failed
      for (const article of articles) {
        results.set(article.url, {
          summary: '',
          error: `Batch summarization failed: ${message}`
        });
      }

      return results;
    }
  }
}

export const claudeAPIService = new ClaudeAPIService();
export default claudeAPIService;

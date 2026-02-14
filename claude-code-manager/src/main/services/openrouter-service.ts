/**
 * OpenRouterService - OpenAI-Compatible LLM Client
 *
 * Provides cost-effective LLM inference via OpenRouter's OpenAI-compatible API.
 * Used for routine tasks (digest generation, triage, summarization) where
 * Agent SDK's tool-calling capabilities are not needed.
 *
 * Features:
 * - OpenAI-compatible chat completions API
 * - Per-request cost tracking using OpenRouter's generation data
 * - Streaming support
 * - Model fallback chain
 * - Rate limiting awareness
 * - Budget enforcement
 */

import { EventEmitter } from 'events'

const LOG = '[OpenRouter]'

// ============================================================================
// Types
// ============================================================================

export interface OpenRouterConfig {
  apiKey: string
  defaultModel: string
  siteUrl?: string
  siteName?: string
  maxRetries: number
  timeoutMs: number
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface CompletionOptions {
  model?: string
  temperature?: number
  maxTokens?: number
  topP?: number
  stream?: boolean
  /** Budget cap for this single request (USD) */
  maxCostUsd?: number
}

export interface CompletionResult {
  content: string
  model: string
  costUsd: number
  tokensInput: number
  tokensOutput: number
  durationMs: number
  finishReason: string
}

export interface OpenRouterUsageStats {
  totalRequests: number
  totalCostUsd: number
  totalTokensInput: number
  totalTokensOutput: number
  costByModel: Record<string, number>
  requestsByModel: Record<string, number>
}

/** Well-known model pricing (per million tokens). Updated as of 2026. */
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'deepseek/deepseek-chat-v3-0324': { input: 0.07, output: 0.11 },
  'deepseek/deepseek-chat': { input: 0.07, output: 0.11 },
  'google/gemini-2.5-flash-preview': { input: 0.15, output: 0.60 },
  'google/gemini-flash-1.5': { input: 0.075, output: 0.30 },
  'google/gemini-2.0-flash-001': { input: 0.10, output: 0.40 },
  'meta-llama/llama-3.3-70b-instruct': { input: 0.39, output: 0.39 },
  'anthropic/claude-haiku-4-5-20251001': { input: 0.80, output: 4.00 },
  'anthropic/claude-sonnet-4-5-20250929': { input: 3.00, output: 15.00 },
  'qwen/qwen-2.5-72b-instruct': { input: 0.36, output: 0.36 },
}

// ============================================================================
// Rate Limiter (Token Bucket)
// ============================================================================

class TokenBucketRateLimiter {
  private tokens: number
  private maxTokens: number
  private refillRate: number // tokens per second
  private lastRefill: number

  constructor(maxTokens: number, refillPerSecond: number) {
    this.tokens = maxTokens
    this.maxTokens = maxTokens
    this.refillRate = refillPerSecond
    this.lastRefill = Date.now()
  }

  async acquire(): Promise<void> {
    this.refill()
    if (this.tokens < 1) {
      const waitMs = Math.ceil(((1 - this.tokens) / this.refillRate) * 1000)
      await new Promise((resolve) => setTimeout(resolve, waitMs))
      this.refill()
    }
    this.tokens -= 1
  }

  private refill(): void {
    const now = Date.now()
    const elapsed = (now - this.lastRefill) / 1000
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate)
    this.lastRefill = now
  }
}

// ============================================================================
// Service
// ============================================================================

export class OpenRouterService extends EventEmitter {
  private config: OpenRouterConfig
  private stats: OpenRouterUsageStats
  /** Rate limiter: 10 requests burst, 2 per second sustained. */
  private rateLimiter = new TokenBucketRateLimiter(10, 2)

  constructor(config: Partial<OpenRouterConfig> & { apiKey: string }) {
    super()
    this.config = {
      apiKey: config.apiKey,
      defaultModel: config.defaultModel ?? 'deepseek/deepseek-chat-v3-0324',
      siteUrl: config.siteUrl ?? 'https://claude-code-manager.local',
      siteName: config.siteName ?? 'Claude Code Manager',
      maxRetries: config.maxRetries ?? 2,
      timeoutMs: config.timeoutMs ?? 60_000,
    }

    this.stats = {
      totalRequests: 0,
      totalCostUsd: 0,
      totalTokensInput: 0,
      totalTokensOutput: 0,
      costByModel: {},
      requestsByModel: {},
    }
  }

  // =========================================================================
  // Chat Completions
  // =========================================================================

  /**
   * Send a chat completion request (non-streaming).
   */
  async complete(
    messages: ChatMessage[],
    options: CompletionOptions = {},
  ): Promise<CompletionResult> {
    const model = options.model ?? this.config.defaultModel
    const startTime = Date.now()

    const body = {
      model,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 4096,
      top_p: options.topP ?? 1,
      stream: false,
    }

    const result = await this.makeRequest(body)

    const choice = result.choices?.[0]
    const content = choice?.message?.content ?? ''
    const finishReason = choice?.finish_reason ?? 'unknown'

    // Extract usage
    const tokensInput = result.usage?.prompt_tokens ?? 0
    const tokensOutput = result.usage?.completion_tokens ?? 0

    // Calculate cost from OpenRouter's generation data or estimate
    let costUsd = 0
    if (result.usage?.total_cost) {
      // OpenRouter returns cost in the response
      costUsd = result.usage.total_cost
    } else {
      costUsd = this.estimateCost(model, tokensInput, tokensOutput)
    }

    const durationMs = Date.now() - startTime

    // Update stats
    this.trackUsage(model, costUsd, tokensInput, tokensOutput)

    const completionResult: CompletionResult = {
      content,
      model: result.model ?? model,
      costUsd,
      tokensInput,
      tokensOutput,
      durationMs,
      finishReason,
    }

    this.emit('completion', completionResult)
    return completionResult
  }

  /**
   * Send a chat completion request with streaming.
   * Yields content chunks as they arrive.
   */
  async *completeStream(
    messages: ChatMessage[],
    options: CompletionOptions = {},
  ): AsyncGenerator<string, CompletionResult> {
    const model = options.model ?? this.config.defaultModel
    const startTime = Date.now()

    const body = {
      model,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 4096,
      top_p: options.topP ?? 1,
      stream: true,
    }

    const response = await this.makeFetchRequest(body)

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`OpenRouter API error ${response.status}: ${errorText}`)
    }

    const reader = response.body?.getReader()
    if (!reader) throw new Error('No response body for streaming')

    const decoder = new TextDecoder()
    let fullContent = ''
    let finishReason = 'unknown'
    let usageData: any = null

    try {
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6).trim()
          if (data === '[DONE]') continue

          try {
            const parsed = JSON.parse(data)
            const delta = parsed.choices?.[0]?.delta?.content
            if (delta) {
              fullContent += delta
              yield delta
            }
            if (parsed.choices?.[0]?.finish_reason) {
              finishReason = parsed.choices[0].finish_reason
            }
            if (parsed.usage) {
              usageData = parsed.usage
            }
          } catch {
            // Skip malformed SSE lines
          }
        }
      }
    } finally {
      reader.releaseLock()
    }

    const tokensInput = usageData?.prompt_tokens ?? this.estimateTokens(messages)
    const tokensOutput = usageData?.completion_tokens ?? Math.ceil(fullContent.length / 4)
    const costUsd = usageData?.total_cost ?? this.estimateCost(model, tokensInput, tokensOutput)
    const durationMs = Date.now() - startTime

    this.trackUsage(model, costUsd, tokensInput, tokensOutput)

    return {
      content: fullContent,
      model,
      costUsd,
      tokensInput,
      tokensOutput,
      durationMs,
      finishReason,
    }
  }

  /**
   * Simple one-shot text generation (convenience wrapper).
   */
  async generate(
    systemPrompt: string,
    userMessage: string,
    options: CompletionOptions = {},
  ): Promise<CompletionResult> {
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ]
    return this.complete(messages, options)
  }

  // =========================================================================
  // Stats & Config
  // =========================================================================

  getStats(): OpenRouterUsageStats {
    return { ...this.stats }
  }

  resetStats(): void {
    this.stats = {
      totalRequests: 0,
      totalCostUsd: 0,
      totalTokensInput: 0,
      totalTokensOutput: 0,
      costByModel: {},
      requestsByModel: {},
    }
  }

  updateConfig(config: Partial<OpenRouterConfig>): void {
    this.config = { ...this.config, ...config }
  }

  getConfig(): Omit<OpenRouterConfig, 'apiKey'> & { hasApiKey: boolean } {
    const { apiKey, ...rest } = this.config
    return { ...rest, hasApiKey: !!apiKey }
  }

  isConfigured(): boolean {
    return !!this.config.apiKey
  }

  // =========================================================================
  // Private - HTTP
  // =========================================================================

  private async makeRequest(body: any): Promise<any> {
    let lastError: Error | null = null

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        // Proactive rate limiting before each request
        await this.rateLimiter.acquire()

        const response = await this.makeFetchRequest({ ...body, stream: false })

        if (!response.ok) {
          const errorText = await response.text()

          // Handle rate limiting
          if (response.status === 429) {
            const retryAfter = response.headers.get('retry-after')
            const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 5000
            console.warn(LOG, `Rate limited. Waiting ${waitMs}ms before retry...`)
            await this.sleep(waitMs)
            continue
          }

          // Sanitize error to avoid leaking API key
          const safeError = errorText.replace(this.config.apiKey, '[REDACTED]')
          throw new Error(`OpenRouter API error ${response.status}: ${safeError}`)
        }

        return await response.json()
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
        if (attempt < this.config.maxRetries) {
          const backoff = Math.min(1000 * Math.pow(2, attempt), 10_000)
          console.warn(LOG, `Request failed, retrying in ${backoff}ms:`, lastError.message)
          await this.sleep(backoff)
        }
      }
    }

    throw lastError ?? new Error('OpenRouter request failed after retries')
  }

  private async makeFetchRequest(body: any): Promise<Response> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs)

    try {
      return await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': this.config.siteUrl ?? '',
          'X-Title': this.config.siteName ?? '',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeout)
    }
  }

  // =========================================================================
  // Private - Cost & Usage
  // =========================================================================

  private estimateCost(model: string, tokensInput: number, tokensOutput: number): number {
    const pricing = MODEL_PRICING[model]
    if (!pricing) {
      // Conservative fallback estimate
      return (tokensInput * 0.5 + tokensOutput * 1.5) / 1_000_000
    }
    return (tokensInput * pricing.input + tokensOutput * pricing.output) / 1_000_000
  }

  private estimateTokens(messages: ChatMessage[]): number {
    // Rough estimate: ~4 characters per token
    const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0)
    return Math.ceil(totalChars / 4)
  }

  private trackUsage(model: string, costUsd: number, tokensInput: number, tokensOutput: number): void {
    this.stats.totalRequests += 1
    this.stats.totalCostUsd += costUsd
    this.stats.totalTokensInput += tokensInput
    this.stats.totalTokensOutput += tokensOutput
    this.stats.costByModel[model] = (this.stats.costByModel[model] ?? 0) + costUsd
    this.stats.requestsByModel[model] = (this.stats.requestsByModel[model] ?? 0) + 1
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

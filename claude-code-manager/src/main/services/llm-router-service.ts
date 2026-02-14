/**
 * LlmRouterService - Config-Driven LLM Routing
 *
 * Routes LLM requests to either OpenRouter (for cheap tasks) or
 * Agent SDK (for tool-heavy work) based on the skills config routing table.
 *
 * Routing decision flow:
 * 1. Look up task type in the routing table (SkillsConfigStore.llmRouting)
 * 2. If provider == 'openrouter' AND OpenRouter is configured → use OpenRouter
 * 3. Otherwise → fall back to Agent SDK (always available)
 *
 * The routing table is agent-modifiable via the update_agent_config meta-tool:
 *   "Use Gemini Flash for digest" → update_agent_config('set_llm_route', ...)
 *
 * Emits:
 * - 'route-decision' with { task, provider, model }
 * - 'cost-tracked' with { task, costUsd, provider }
 */

import { EventEmitter } from 'events'
import type { OpenRouterService, CompletionResult, CompletionOptions, ChatMessage } from './openrouter-service'
import type { SkillsConfigStore } from './skills-config-store'
import type { LlmRoutingEntry } from '@shared/skills-types'

const LOG = '[LlmRouter]'

// ============================================================================
// Types
// ============================================================================

export interface RouteDecision {
  task: string
  provider: 'openrouter' | 'agent_sdk'
  model: string
  reason: string
}

export interface LlmRouterResult {
  content: string
  model: string
  provider: 'openrouter' | 'agent_sdk'
  costUsd: number
  tokensInput: number
  tokensOutput: number
  durationMs: number
}

export interface LlmRouterStats {
  routeDecisions: Record<string, { openrouter: number; agent_sdk: number }>
  totalCostByProvider: Record<string, number>
  fallbackCount: number
}

// ============================================================================
// Service
// ============================================================================

export class LlmRouterService extends EventEmitter {
  private openRouter: OpenRouterService | null
  private configStore: SkillsConfigStore
  private stats: LlmRouterStats

  constructor(
    configStore: SkillsConfigStore,
    openRouter?: OpenRouterService | null,
  ) {
    super()
    this.configStore = configStore
    this.openRouter = openRouter ?? null
    this.stats = {
      routeDecisions: {},
      totalCostByProvider: { openrouter: 0, agent_sdk: 0 },
      fallbackCount: 0,
    }
  }

  /**
   * Set or replace the OpenRouter service instance.
   * Called when the user configures an API key.
   */
  setOpenRouter(service: OpenRouterService | null): void {
    this.openRouter = service
    console.log(LOG, service ? 'OpenRouter configured' : 'OpenRouter removed')
  }

  // =========================================================================
  // Routing Decision
  // =========================================================================

  /**
   * Determine which provider and model to use for a given task type.
   */
  getRoute(task: string): RouteDecision {
    const routing = this.configStore.getLlmRoutingForTask(task)

    if (!routing) {
      // No routing config for this task - use Agent SDK default
      return {
        task,
        provider: 'agent_sdk',
        model: 'claude-haiku-4-5-20251001',
        reason: 'No routing config found, using default',
      }
    }

    // Check if OpenRouter is requested and available
    if (routing.provider === 'openrouter') {
      if (this.openRouter?.isConfigured()) {
        return {
          task,
          provider: 'openrouter',
          model: routing.model,
          reason: 'Configured in routing table',
        }
      }

      // Fallback: OpenRouter configured in routing but not available
      this.stats.fallbackCount++
      console.warn(LOG, `OpenRouter not available for task "${task}", falling back to Agent SDK`)
      return {
        task,
        provider: 'agent_sdk',
        model: 'claude-haiku-4-5-20251001',
        reason: 'OpenRouter not configured, falling back to Agent SDK',
      }
    }

    // Agent SDK route
    return {
      task,
      provider: 'agent_sdk',
      model: routing.model,
      reason: 'Configured in routing table',
    }
  }

  // =========================================================================
  // Execution
  // =========================================================================

  /**
   * Route and execute a simple text generation request.
   * For tasks that don't need tool calling (digest, triage, summarize, etc.)
   *
   * If routed to OpenRouter: uses OpenRouter chat completions.
   * If routed to Agent SDK: caller must handle SDK execution separately.
   * Returns null for agent_sdk routes (caller handles).
   */
  async generateText(
    task: string,
    systemPrompt: string,
    userMessage: string,
    options: CompletionOptions = {},
  ): Promise<LlmRouterResult | null> {
    const route = this.getRoute(task)
    this.trackRoute(task, route.provider)
    this.emit('route-decision', route)

    console.log(LOG, `Routing "${task}" → ${route.provider} (${route.model})`)

    if (route.provider === 'openrouter' && this.openRouter) {
      try {
        const result = await this.openRouter.generate(
          systemPrompt,
          userMessage,
          { ...options, model: route.model },
        )

        const routerResult: LlmRouterResult = {
          content: result.content,
          model: result.model,
          provider: 'openrouter',
          costUsd: result.costUsd,
          tokensInput: result.tokensInput,
          tokensOutput: result.tokensOutput,
          durationMs: result.durationMs,
        }

        this.trackCost('openrouter', result.costUsd)
        this.emit('cost-tracked', { task, costUsd: result.costUsd, provider: 'openrouter' })

        return routerResult
      } catch (err) {
        console.error(LOG, `OpenRouter failed for "${task}":`, err)
        // Fall through to return null so caller can use Agent SDK as fallback
        this.stats.fallbackCount++
      }
    }

    // Agent SDK routes return null - caller uses SDK directly
    return null
  }

  /**
   * Route and execute a chat completion with full message history.
   * Only works for OpenRouter routes. Returns null for agent_sdk.
   */
  async chatComplete(
    task: string,
    messages: ChatMessage[],
    options: CompletionOptions = {},
  ): Promise<LlmRouterResult | null> {
    const route = this.getRoute(task)
    this.trackRoute(task, route.provider)

    if (route.provider === 'openrouter' && this.openRouter) {
      try {
        const result = await this.openRouter.complete(
          messages,
          { ...options, model: route.model },
        )

        const routerResult: LlmRouterResult = {
          content: result.content,
          model: result.model,
          provider: 'openrouter',
          costUsd: result.costUsd,
          tokensInput: result.tokensInput,
          tokensOutput: result.tokensOutput,
          durationMs: result.durationMs,
        }

        this.trackCost('openrouter', result.costUsd)
        return routerResult
      } catch (err) {
        console.error(LOG, `OpenRouter chat failed for "${task}":`, err)
        this.stats.fallbackCount++
      }
    }

    return null
  }

  /**
   * Streaming text generation via OpenRouter.
   * Returns null for agent_sdk routes.
   */
  async *generateStream(
    task: string,
    systemPrompt: string,
    userMessage: string,
    options: CompletionOptions = {},
  ): AsyncGenerator<string, LlmRouterResult | null> {
    const route = this.getRoute(task)
    this.trackRoute(task, route.provider)

    if (route.provider !== 'openrouter' || !this.openRouter) {
      return null
    }

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ]

    try {
      const stream = this.openRouter.completeStream(
        messages,
        { ...options, model: route.model },
      )

      let completionResult: CompletionResult | undefined

      while (true) {
        const { value, done } = await stream.next()
        if (done) {
          completionResult = value as CompletionResult
          break
        }
        yield value as string
      }

      if (completionResult) {
        this.trackCost('openrouter', completionResult.costUsd)
        return {
          content: completionResult.content,
          model: completionResult.model,
          provider: 'openrouter',
          costUsd: completionResult.costUsd,
          tokensInput: completionResult.tokensInput,
          tokensOutput: completionResult.tokensOutput,
          durationMs: completionResult.durationMs,
        }
      }
    } catch (err) {
      console.error(LOG, `OpenRouter stream failed for "${task}":`, err)
      this.stats.fallbackCount++
    }

    return null
  }

  // =========================================================================
  // Stats
  // =========================================================================

  getStats(): LlmRouterStats {
    return {
      routeDecisions: { ...this.stats.routeDecisions },
      totalCostByProvider: { ...this.stats.totalCostByProvider },
      fallbackCount: this.stats.fallbackCount,
    }
  }

  /**
   * Get a summary of routing and cost information for display.
   */
  getRoutingSummary(): Array<{
    task: string
    provider: string
    model: string
    openRouterAvailable: boolean
  }> {
    const routing = this.configStore.getLlmRouting()
    const openRouterAvailable = this.openRouter?.isConfigured() ?? false

    return Object.entries(routing).map(([task, entry]) => ({
      task,
      provider: entry.provider,
      model: entry.model,
      openRouterAvailable: entry.provider === 'openrouter' ? openRouterAvailable : true,
    }))
  }

  // =========================================================================
  // Private
  // =========================================================================

  private trackRoute(task: string, provider: 'openrouter' | 'agent_sdk'): void {
    if (!this.stats.routeDecisions[task]) {
      this.stats.routeDecisions[task] = { openrouter: 0, agent_sdk: 0 }
    }
    this.stats.routeDecisions[task][provider]++
  }

  private trackCost(provider: string, costUsd: number): void {
    this.stats.totalCostByProvider[provider] =
      (this.stats.totalCostByProvider[provider] ?? 0) + costUsd
  }
}

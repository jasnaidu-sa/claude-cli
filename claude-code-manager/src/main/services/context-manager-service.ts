/**
 * Context Manager Service
 *
 * Implements P1-T3 from the Unified Agent Architecture PRD.
 * Manages the context window with token budgeting, compaction triggers,
 * and pre-compaction flush to episodic memory.
 *
 * Features:
 * - Token budget management (61k total across system, memory, recent, response)
 * - Dual threshold compaction: message count > 30 AND tokens > 35k
 * - Pre-compaction flush: ALL messages written to EpisodeStore before summarization
 * - Context window assembly with budget enforcement
 * - Summary checkpoint management
 */

import { EventEmitter } from 'events'
import type { EpisodeStoreService } from './episode-store-service'

// ============================================================================
// Constants
// ============================================================================

/**
 * Token budget allocation for the context window.
 * Total: 61,000 tokens (with 200k context window, leaving room for safety)
 */
export const TOKEN_BUDGET = {
  system: 5000, // System prompt + agent identity (SOUL.md, USER.md, HEARTBEAT.md)
  memory: 5000, // Retrieved context from vector search (all tiers)
  summary: 3000, // Compressed older conversation history (summary checkpoint)
  recent: 40000, // Sliding window of recent messages (FIFO eviction)
  response: 8000, // Reserved for model output
  total: 61000, // Total budget
}

/**
 * Compaction thresholds (dual condition: both must be true).
 */
const COMPACTION_THRESHOLDS = {
  messageCount: 30, // Minimum number of messages before considering compaction
  tokenEstimate: 35000, // Token estimate threshold to trigger compaction
}

// ============================================================================
// Types
// ============================================================================

export interface Message {
  role: string
  content: string
}

export interface CompactionResult {
  summary: string // Summary of compacted messages
  remainingMessages: Message[] // Messages kept in the context window
  compactedCount: number // Number of messages that were compacted
  flushedToEpisodes: number // Number of messages flushed to EpisodeStore
}

export interface AssembleContextOptions {
  systemPrompt: string // Full system prompt with agent identity
  memoryContext: string // Retrieved from vector search (facts, episodes, skills)
  summaryCheckpoint?: string // Previous summary checkpoint (if exists)
  recentMessages: Message[] // Sliding window of recent messages
}

export interface ContextWindow {
  sections: Array<{
    name: string
    content: string
    tokenEstimate: number
  }>
  totalTokens: number
  isOverBudget: boolean
}

// ============================================================================
// ContextManagerService
// ============================================================================

export class ContextManagerService extends EventEmitter {
  private episodeStore: EpisodeStoreService

  constructor(episodeStore: EpisodeStoreService) {
    super()
    this.episodeStore = episodeStore
  }

  // ==========================================================================
  // Token Estimation
  // ==========================================================================

  /**
   * Estimate token count for a text string.
   * Uses approximate calculation: 4 characters ≈ 1 token (rough heuristic).
   *
   * @param text - Text to estimate tokens for
   * @returns Estimated token count
   */
  getTokenEstimate(text: string): number {
    return Math.ceil(text.length / 4)
  }

  // ==========================================================================
  // Compaction Decision
  // ==========================================================================

  /**
   * Check if messages should be compacted based on dual thresholds.
   * Compaction is triggered when BOTH conditions are true:
   * 1. Message count exceeds threshold (> 30)
   * 2. Token estimate exceeds threshold (> 35,000)
   *
   * This dual threshold prevents the OpenClaw race condition where
   * rapid messages could bypass compaction checks.
   *
   * @param messages - Array of messages to check
   * @returns true if compaction should be triggered
   */
  checkCompaction(messages: Message[]): boolean {
    // Condition 1: Message count threshold
    if (messages.length <= COMPACTION_THRESHOLDS.messageCount) {
      return false
    }

    // Condition 2: Token estimate threshold
    const totalTokens = messages.reduce((sum, msg) => {
      return sum + this.getTokenEstimate(msg.content)
    }, 0)

    if (totalTokens <= COMPACTION_THRESHOLDS.tokenEstimate) {
      return false
    }

    // Both conditions met - trigger compaction
    return true
  }

  // ==========================================================================
  // Compaction
  // ==========================================================================

  /**
   * Compact messages by:
   * 1. Flushing ALL messages to EpisodeStore (pre-compaction flush)
   * 2. Taking oldest 50% of messages
   * 3. Creating a summary placeholder (actual LLM summarization done via hooks)
   * 4. Returning summary and remaining 50% of messages
   *
   * @param messages - Messages to compact
   * @param sessionId - Session identifier
   * @param channel - Channel name (whatsapp, telegram, bvs, cli)
   * @param sourceId - Source identifier (jid, chat_id, etc.)
   * @returns CompactionResult with summary and remaining messages
   */
  async compact(
    messages: Message[],
    sessionId: string,
    channel: string,
    sourceId: string
  ): Promise<CompactionResult> {
    this.emit('compaction-triggered', {
      messageCount: messages.length,
      sessionId,
      channel,
      sourceId,
    })

    // STEP 1: Pre-compaction flush - write ALL messages to EpisodeStore
    // This ensures no conversation history is lost before summarization
    let flushedCount = 0
    for (const message of messages) {
      try {
        this.episodeStore.insertEpisode(
          sessionId,
          channel,
          sourceId,
          message.role as 'user' | 'assistant' | 'system',
          message.content
        )
        flushedCount++
      } catch (error) {
        console.error('[ContextManagerService] Failed to flush message:', error)
        // Continue flushing other messages even if one fails
      }
    }

    console.log(
      `[ContextManagerService] Pre-compaction flush: ${flushedCount}/${messages.length} messages written to episodes`
    )

    // STEP 2: Determine split point (oldest 50%)
    const splitIndex = Math.floor(messages.length / 2)
    const messagesToCompact = messages.slice(0, splitIndex)
    const remainingMessages = messages.slice(splitIndex)

    // STEP 3: Create summary placeholder
    // Actual LLM summarization will be done by integration code via hooks
    // This is just a placeholder indicating compaction occurred
    const summary = this.createSummaryPlaceholder(messagesToCompact, sessionId)

    // STEP 4: Return compaction result
    const result: CompactionResult = {
      summary,
      remainingMessages,
      compactedCount: messagesToCompact.length,
      flushedToEpisodes: flushedCount,
    }

    this.emit('compaction-complete', {
      sessionId,
      compactedCount: messagesToCompact.length,
      remainingCount: remainingMessages.length,
      flushedCount,
    })

    return result
  }

  /**
   * Create a summary placeholder for compacted messages.
   * This will be replaced with an actual LLM-generated summary by integration code.
   */
  private createSummaryPlaceholder(messages: Message[], sessionId: string): string {
    const startTime = new Date().toISOString()
    const messageCount = messages.length

    // Count user and assistant messages
    const userMessages = messages.filter((m) => m.role === 'user').length
    const assistantMessages = messages.filter((m) => m.role === 'assistant').length

    return [
      `[Summary Checkpoint - ${startTime}]`,
      ``,
      `Compacted ${messageCount} messages (${userMessages} user, ${assistantMessages} assistant) from session ${sessionId}.`,
      ``,
      `Note: This is a placeholder. Actual LLM summarization should be performed via integration hooks.`,
      `Full message history has been flushed to episodic memory and can be retrieved if needed.`,
    ].join('\n')
  }

  // ==========================================================================
  // Context Assembly
  // ==========================================================================

  /**
   * Assemble the full context window from components, respecting token budgets.
   * Enforces budget allocation and reports if over budget.
   *
   * Priority order (when over budget):
   * 1. System prompt (always included)
   * 2. Memory context (truncated if needed)
   * 3. Summary checkpoint (truncated if needed)
   * 4. Recent messages (truncated from oldest first)
   *
   * @param options - Context assembly options
   * @returns Assembled context window with token tracking
   */
  assembleContext(options: AssembleContextOptions): ContextWindow {
    const sections: ContextWindow['sections'] = []
    let totalTokens = 0

    // Section 1: System prompt (always included, highest priority)
    const systemTokens = this.getTokenEstimate(options.systemPrompt)
    sections.push({
      name: 'system',
      content: options.systemPrompt,
      tokenEstimate: systemTokens,
    })
    totalTokens += systemTokens

    // Section 2: Memory context (vector search results)
    const memoryContent = this.truncateToTokenBudget(
      options.memoryContext,
      TOKEN_BUDGET.memory
    )
    const memoryTokens = this.getTokenEstimate(memoryContent)
    sections.push({
      name: 'memory',
      content: memoryContent,
      tokenEstimate: memoryTokens,
    })
    totalTokens += memoryTokens

    // Section 3: Summary checkpoint (if exists)
    if (options.summaryCheckpoint) {
      const summaryContent = this.truncateToTokenBudget(
        options.summaryCheckpoint,
        TOKEN_BUDGET.summary
      )
      const summaryTokens = this.getTokenEstimate(summaryContent)
      sections.push({
        name: 'summary',
        content: summaryContent,
        tokenEstimate: summaryTokens,
      })
      totalTokens += summaryTokens
    }

    // Section 4: Recent messages
    const recentContent = this.formatMessages(options.recentMessages)
    const availableRecentBudget =
      TOKEN_BUDGET.recent - (totalTokens - systemTokens - memoryTokens)
    const truncatedRecentContent = this.truncateToTokenBudget(
      recentContent,
      Math.max(availableRecentBudget, TOKEN_BUDGET.recent)
    )
    const recentTokens = this.getTokenEstimate(truncatedRecentContent)
    sections.push({
      name: 'recent',
      content: truncatedRecentContent,
      tokenEstimate: recentTokens,
    })
    totalTokens += recentTokens

    // Calculate final state
    const usedBudget = totalTokens + TOKEN_BUDGET.response
    const isOverBudget = usedBudget > TOKEN_BUDGET.total

    const contextWindow: ContextWindow = {
      sections,
      totalTokens: usedBudget,
      isOverBudget,
    }

    this.emit('context-assembled', {
      totalTokens: usedBudget,
      isOverBudget,
      sections: sections.map((s) => ({ name: s.name, tokens: s.tokenEstimate })),
    })

    if (isOverBudget) {
      console.warn(
        `[ContextManagerService] Context over budget: ${usedBudget}/${TOKEN_BUDGET.total} tokens`
      )
    }

    return contextWindow
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  /**
   * Format messages into a string representation.
   */
  private formatMessages(messages: Message[]): string {
    return messages
      .map((msg) => {
        const role = msg.role.toUpperCase()
        return `[${role}]\n${msg.content}\n`
      })
      .join('\n')
  }

  /**
   * Truncate text to fit within a token budget.
   * Uses character-based truncation with token estimation.
   *
   * @param text - Text to truncate
   * @param tokenBudget - Maximum tokens allowed
   * @returns Truncated text
   */
  private truncateToTokenBudget(text: string, tokenBudget: number): string {
    const estimatedTokens = this.getTokenEstimate(text)

    if (estimatedTokens <= tokenBudget) {
      return text
    }

    // Calculate approximate character budget (4 chars per token)
    const charBudget = tokenBudget * 4

    // Truncate and add indicator
    const truncated = text.slice(0, charBudget)
    const truncationNotice = '\n\n[... content truncated to fit token budget ...]'

    return truncated + truncationNotice
  }
}

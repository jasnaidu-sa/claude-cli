/**
 * HooksService - Lifecycle Event Hooks System
 *
 * Provides ordered, awaitable lifecycle hooks for critical operations.
 * Runs alongside EventEmitter (does not replace it).
 *
 * Key features:
 * - Priority-ordered execution (lower number = runs first)
 * - Per-hook timeout enforcement
 * - Hook execution logging with duration tracking
 * - Data cascading between hooks
 * - Graceful error handling (timeouts/errors don't block the chain)
 *
 * Emits:
 * - 'hook-registered' with { id, event, phase }
 * - 'hook-executed' with { id, event, phase, durationMs, result }
 * - 'hook-timeout' with { id, event, phase, timeoutMs }
 * - 'hook-error' with { id, event, phase, error }
 */

import { EventEmitter } from 'events'

const LOG = '[HooksService]'

// ============================================================================
// Types
// ============================================================================

export type HookPhase = 'pre' | 'post'

export type HookEvent =
  | 'agent:respond'      // before/after agent generates response
  | 'memory:index'       // before/after memory write
  | 'memory:search'      // before/after memory read
  | 'channel:send'       // before/after sending to channel
  | 'channel:receive'    // before/after receiving from channel
  | 'skill:execute'      // before/after skill runs
  | 'pattern:observe'    // before/after pattern recorded
  | 'context:compact'    // before/after context summarization
  | 'health:check'       // before/after health evaluation

export interface HookContext {
  event: HookEvent
  phase: HookPhase
  data: Record<string, any>
  timestamp: string
  metadata?: Record<string, any>
}

export interface HookResult {
  continue: boolean       // false = abort the operation
  data?: any              // modified data to pass forward
}

export interface Hook {
  id: string
  event: HookEvent
  phase: HookPhase
  priority: number        // lower = runs first
  handler: (ctx: HookContext) => Promise<HookResult>
  timeout: number         // max ms to wait (default 5000)
}

// ============================================================================
// Service
// ============================================================================

export class HooksService extends EventEmitter {
  private hooks: Map<string, Hook[]> = new Map()

  constructor() {
    super()
  }

  /**
   * Register a new hook. Returns an unregister function.
   * Auto-generates ID if not provided.
   */
  register(
    hook: Omit<Hook, 'id'> & { id?: string }
  ): () => void {
    const id = hook.id ?? this.generateHookId(hook.event, hook.phase)
    const fullHook: Hook = {
      ...hook,
      id,
      timeout: hook.timeout ?? 5000,
    }

    const key = this.getHookKey(hook.event, hook.phase)
    const existing = this.hooks.get(key) ?? []
    existing.push(fullHook)

    // Sort by priority (lower = runs first)
    existing.sort((a, b) => a.priority - b.priority)

    this.hooks.set(key, existing)

    this.emit('hook-registered', {
      id: fullHook.id,
      event: fullHook.event,
      phase: fullHook.phase,
    })

    console.log(LOG, `Registered hook: ${id} for ${hook.event}:${hook.phase} (priority: ${hook.priority})`)

    // Return unregister function
    return () => this.unregister(fullHook.id, hook.event, hook.phase)
  }

  /**
   * Unregister a hook by ID.
   */
  private unregister(id: string, event: HookEvent, phase: HookPhase): void {
    const key = this.getHookKey(event, phase)
    const existing = this.hooks.get(key) ?? []
    const filtered = existing.filter(h => h.id !== id)

    if (filtered.length === 0) {
      this.hooks.delete(key)
    } else {
      this.hooks.set(key, filtered)
    }

    console.log(LOG, `Unregistered hook: ${id}`)
  }

  /**
   * Run all hooks for a given event and phase in priority order.
   * Returns the final HookResult.
   */
  async run(
    event: HookEvent,
    phase: HookPhase,
    ctx: HookContext
  ): Promise<HookResult> {
    const key = this.getHookKey(event, phase)
    const hooksToRun = this.hooks.get(key) ?? []

    if (hooksToRun.length === 0) {
      // No hooks registered for this event/phase
      return { continue: true }
    }

    console.log(LOG, `Running ${hooksToRun.length} hook(s) for ${event}:${phase}`)

    // Start with the initial context data
    let cascadedData = { ...ctx.data }

    // Run hooks in priority order
    for (const hook of hooksToRun) {
      const startTime = Date.now()

      // Update context with cascaded data from previous hooks
      const currentContext: HookContext = {
        ...ctx,
        data: cascadedData,
      }

      try {
        const result = await this.executeHookWithTimeout(hook, currentContext)
        const durationMs = Date.now() - startTime

        this.emit('hook-executed', {
          id: hook.id,
          event,
          phase,
          durationMs,
          result,
        })

        console.log(
          LOG,
          `Hook ${hook.id} completed in ${durationMs}ms (continue: ${result.continue})`
        )

        // If hook returns data, merge it into cascaded data
        if (result.data !== undefined) {
          cascadedData = {
            ...cascadedData,
            ...result.data,
          }
        }

        // If hook returns continue: false, stop execution
        if (!result.continue) {
          console.log(LOG, `Hook ${hook.id} returned continue:false, stopping chain`)
          return { continue: false, data: cascadedData }
        }

      } catch (err) {
        const durationMs = Date.now() - startTime

        if (err instanceof HookTimeoutError) {
          // Timeout - log warning and continue
          this.emit('hook-timeout', {
            id: hook.id,
            event,
            phase,
            timeoutMs: hook.timeout,
          })
          console.warn(
            LOG,
            `Hook ${hook.id} timed out after ${hook.timeout}ms, continuing chain`
          )
        } else {
          // Error - log and continue
          this.emit('hook-error', {
            id: hook.id,
            event,
            phase,
            error: err instanceof Error ? err.message : String(err),
          })
          console.error(
            LOG,
            `Hook ${hook.id} threw error after ${durationMs}ms:`,
            err instanceof Error ? err.message : err
          )
        }

        // Continue to next hook (treat as { continue: true })
      }
    }

    // All hooks completed successfully
    return { continue: true, data: cascadedData }
  }

  /**
   * Get all registered hooks for inspection/debugging.
   */
  getRegisteredHooks(): Hook[] {
    const allHooks: Hook[] = []
    for (const hooks of this.hooks.values()) {
      allHooks.push(...hooks)
    }
    return allHooks
  }

  /**
   * Get the total number of registered hooks.
   */
  getHookCount(): number {
    let count = 0
    for (const hooks of this.hooks.values()) {
      count += hooks.length
    }
    return count
  }

  /**
   * Remove all hooks (cleanup).
   */
  removeAllHooks(): void {
    const count = this.getHookCount()
    this.hooks.clear()
    console.log(LOG, `Removed all hooks (${count} total)`)
  }

  // =========================================================================
  // Private Helpers
  // =========================================================================

  private getHookKey(event: HookEvent, phase: HookPhase): string {
    return `${event}:${phase}`
  }

  private generateHookId(event: HookEvent, phase: HookPhase): string {
    const timestamp = Date.now()
    const random = Math.random().toString(36).substring(2, 9)
    return `hook:${event}:${phase}:${timestamp}:${random}`
  }

  /**
   * Execute a hook with timeout enforcement using Promise.race.
   * Throws HookTimeoutError if the hook exceeds its timeout.
   */
  private async executeHookWithTimeout(
    hook: Hook,
    ctx: HookContext
  ): Promise<HookResult> {
    const timeoutPromise = new Promise<HookResult>((_, reject) => {
      setTimeout(() => {
        reject(new HookTimeoutError(hook.id, hook.timeout))
      }, hook.timeout)
    })

    const executionPromise = hook.handler(ctx)

    return Promise.race([executionPromise, timeoutPromise])
  }
}

// ============================================================================
// Error Classes
// ============================================================================

class HookTimeoutError extends Error {
  constructor(hookId: string, timeoutMs: number) {
    super(`Hook ${hookId} timed out after ${timeoutMs}ms`)
    this.name = 'HookTimeoutError'
  }
}

// ============================================================================
// Notes
// ============================================================================

/**
 * EventEmitter Compatibility Note:
 *
 * Existing EventEmitter `.emit()` calls do NOT need to change.
 * Hooks run alongside EventEmitter, not replacing it.
 *
 * This is a NEW parallel path for ordered, awaitable side effects.
 *
 * Example integration:
 *
 * ```typescript
 * // Old code (still works):
 * this.emit('message-sent', { chatId, content })
 *
 * // New code (add hooks):
 * await this.hooks.run('channel:send', 'pre', {
 *   event: 'channel:send',
 *   phase: 'pre',
 *   data: { chatId, content },
 *   timestamp: new Date().toISOString(),
 * })
 *
 * // ... actual send logic ...
 *
 * await this.hooks.run('channel:send', 'post', {
 *   event: 'channel:send',
 *   phase: 'post',
 *   data: { chatId, content, messageId },
 *   timestamp: new Date().toISOString(),
 * })
 *
 * // EventEmitter still works:
 * this.emit('message-sent', { chatId, content })
 * ```
 */

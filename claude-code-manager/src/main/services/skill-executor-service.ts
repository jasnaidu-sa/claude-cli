/**
 * SkillExecutorService - Cron Scheduling, Command Routing, SDK Execution
 *
 * Executes skills by injecting their markdown body as system prompt context
 * into an Agent SDK query. Manages cron-based scheduling for proactive skills.
 *
 * Anti-recursion: Skills cannot create other skills or register tools.
 * Maximum capability chain depth: 1 (agent -> skill, never agent -> skill -> skill).
 *
 * Emits:
 * - 'skill-executed' with SkillExecutionResult
 * - 'skill-error' with { skillId, error }
 */

import { EventEmitter } from 'events'
import type { SkillsManagerService } from './skills-manager-service'
import type { SkillsConfigStore } from './skills-config-store'
import type { LlmRouterService } from './llm-router-service'
import type { SkillDefinition, SkillExecutionResult } from '@shared/skills-types'
import { createSkillToolsMcpServer } from './skill-tools-mcp'

const LOG = '[SkillExecutor]'

interface CronJob {
  skillId: string
  cronExpression: string
  timer: ReturnType<typeof setTimeout> | null
  nextRun: number
}

/**
 * Parse a simple cron expression and return the next run time.
 * Supports: minute hour day-of-month month day-of-week
 */
function getNextCronRun(cronExpr: string): number {
  // Use cron-parser from dependencies
  try {
    const { parseExpression } = require('cron-parser')
    const interval = parseExpression(cronExpr)
    return interval.next().getTime()
  } catch {
    // Fallback: run in 1 hour
    return Date.now() + 3600_000
  }
}

export class SkillExecutorService extends EventEmitter {
  private skillsManager: SkillsManagerService
  private configStore: SkillsConfigStore
  private cronJobs: Map<string, CronJob> = new Map()
  private running = false

  /** Prevent re-entrant skill execution (anti-recursion). */
  private executingSkills: Set<string> = new Set()

  /** Channel for sending skill output (set by the channel router). */
  private sendToChannel: ((message: string, channel?: string) => Promise<void>) | null = null

  /** LLM router for cost-optimized execution (optional). */
  private llmRouter: LlmRouterService | null = null

  constructor(
    skillsManager: SkillsManagerService,
    configStore: SkillsConfigStore,
  ) {
    super()
    this.skillsManager = skillsManager
    this.configStore = configStore
  }

  /**
   * Set the LLM router for cost-optimized skill execution.
   * Skills routed to OpenRouter will bypass Agent SDK entirely.
   */
  setLlmRouter(router: LlmRouterService): void {
    this.llmRouter = router
  }

  /**
   * Set the function used to send skill output to messaging channels.
   */
  setSendToChannel(fn: (message: string, channel?: string) => Promise<void>): void {
    this.sendToChannel = fn
  }

  /**
   * Start the cron scheduler. Scans all skills with cron triggers and
   * sets up timers for their next execution.
   */
  start(): void {
    if (this.running) return
    this.running = true

    this.refreshCronJobs()

    // Re-sync cron jobs when skills change
    this.skillsManager.on('skills-updated', () => {
      if (this.running) this.refreshCronJobs()
    })

    console.log(LOG, 'Started')
  }

  /**
   * Stop all cron jobs and clean up.
   */
  stop(): void {
    this.running = false
    for (const [, job] of this.cronJobs) {
      if (job.timer) clearTimeout(job.timer)
    }
    this.cronJobs.clear()
    console.log(LOG, 'Stopped')
  }

  /**
   * Execute a skill by ID. Called by cron, command routing, or manual trigger.
   */
  async executeSkill(
    skillId: string,
    triggeredBy: SkillExecutionResult['triggeredBy'],
    userMessage?: string,
  ): Promise<SkillExecutionResult> {
    const skill = this.skillsManager.getSkill(skillId)
    if (!skill) {
      throw new Error(`Skill not found: ${skillId}`)
    }

    if (!skill.active) {
      throw new Error(`Skill is disabled: ${skillId}`)
    }

    // Anti-recursion check
    if (this.executingSkills.has(skillId)) {
      throw new Error(`Skill ${skillId} is already executing (anti-recursion)`)
    }

    // Check cost limits
    const immutable = this.configStore.getImmutableConfig()
    const runtimeConfig = this.configStore.getSkillConfig(skillId)

    const startedAt = Date.now()
    this.executingSkills.add(skillId)

    const result: SkillExecutionResult = {
      skillId,
      status: 'running',
      startedAt,
      durationMs: 0,
      costUsd: 0,
      triggeredBy,
    }

    try {
      // Build the skill execution prompt
      const prompt = this.buildSkillPrompt(skill, userMessage)

      // Try LLM router first (cheaper for non-tool tasks)
      const execResult = await this.executeWithRouter(skill, prompt, userMessage, immutable.maxSkillExecutionMs)

      result.status = 'completed'
      result.output = execResult.output
      result.costUsd = execResult.costUsd
      result.completedAt = Date.now()
      result.durationMs = result.completedAt - startedAt

      // Record execution stats
      this.configStore.recordSkillExecution(skillId, result.costUsd)

      // Send output to channel if configured
      if (result.output && this.sendToChannel) {
        try {
          await this.sendToChannel(`[${skill.frontmatter.name}]\n\n${result.output}`)
        } catch (err) {
          console.warn(LOG, 'Failed to send skill output to channel:', err)
        }
      }

      console.log(LOG, `Skill ${skillId} completed in ${result.durationMs}ms, cost=$${result.costUsd.toFixed(4)}`)
    } catch (err) {
      result.status = 'failed'
      result.error = err instanceof Error ? err.message : String(err)
      result.completedAt = Date.now()
      result.durationMs = result.completedAt - startedAt

      this.configStore.recordSkillExecution(skillId, 0, result.error)
      console.error(LOG, `Skill ${skillId} failed:`, result.error)
    } finally {
      this.executingSkills.delete(skillId)
    }

    this.emit('skill-executed', result)
    return result
  }

  /**
   * Execute a skill triggered by a command (e.g., "/digest").
   */
  async executeCommand(command: string, userMessage?: string): Promise<SkillExecutionResult | null> {
    const skill = this.skillsManager.getSkillByCommand(command)
    if (!skill) return null
    return this.executeSkill(skill.id, 'command', userMessage)
  }

  /**
   * Check if a message matches any skill keyword triggers and execute them.
   */
  async executeKeywordMatch(message: string): Promise<SkillExecutionResult[]> {
    const skills = this.skillsManager.getSkillsByKeyword(message)
    const results: SkillExecutionResult[] = []
    for (const skill of skills) {
      try {
        const result = await this.executeSkill(skill.id, 'keyword', message)
        results.push(result)
      } catch (err) {
        console.warn(LOG, `Keyword-triggered skill ${skill.id} failed:`, err)
      }
    }
    return results
  }

  /** Get the list of active cron jobs. */
  getScheduledJobs(): Array<{ skillId: string; cronExpression: string; nextRun: number }> {
    return Array.from(this.cronJobs.values()).map((j) => ({
      skillId: j.skillId,
      cronExpression: j.cronExpression,
      nextRun: j.nextRun,
    }))
  }

  // =========================================================================
  // Private - Cron Scheduling
  // =========================================================================

  private refreshCronJobs(): void {
    // Cancel existing jobs
    for (const [, job] of this.cronJobs) {
      if (job.timer) clearTimeout(job.timer)
    }
    this.cronJobs.clear()

    // Set up new jobs from active skills
    const scheduled = this.skillsManager.getScheduledSkills()
    for (const skill of scheduled) {
      for (const trigger of skill.frontmatter.triggers) {
        if (trigger.cron) {
          this.scheduleCronJob(skill.id, trigger.cron)
        }
      }
    }

    console.log(LOG, `Scheduled ${this.cronJobs.size} cron jobs`)
  }

  private scheduleCronJob(skillId: string, cronExpression: string): void {
    const nextRun = getNextCronRun(cronExpression)
    const delayMs = Math.max(0, nextRun - Date.now())

    const job: CronJob = {
      skillId,
      cronExpression,
      nextRun,
      timer: null,
    }

    job.timer = setTimeout(async () => {
      if (!this.running) return

      try {
        await this.executeSkill(skillId, 'cron')
      } catch (err) {
        console.error(LOG, `Cron execution failed for ${skillId}:`, err)
      }

      // Reschedule for next run
      if (this.running) {
        this.scheduleCronJob(skillId, cronExpression)
      }
    }, delayMs)

    this.cronJobs.set(skillId, job)
  }

  // =========================================================================
  // Private - SDK Execution
  // =========================================================================

  private buildSkillPrompt(skill: SkillDefinition, userMessage?: string): string {
    const parts: string[] = []

    parts.push('# Skill Execution Context')
    parts.push('')
    parts.push(`You are executing the "${skill.frontmatter.name}" skill.`)
    parts.push(`Description: ${skill.frontmatter.description}`)
    parts.push('')
    parts.push('## Skill Instructions')
    parts.push('')
    parts.push(skill.body)

    // Inject runtime config
    const rc = this.configStore.getSkillConfig(skill.id)
    if (rc && Object.keys(rc.config).length > 0) {
      parts.push('')
      parts.push('## Runtime Configuration')
      parts.push('```json')
      parts.push(JSON.stringify(rc.config, null, 2))
      parts.push('```')
    }

    if (userMessage) {
      parts.push('')
      parts.push('## User Message')
      parts.push(userMessage)
    }

    parts.push('')
    parts.push('## Important Constraints')
    parts.push('- You CANNOT create new skills from within a skill execution')
    parts.push('- You CANNOT register new tools from within a skill execution')
    parts.push('- You CANNOT modify the permission system')
    parts.push('- Stay focused on the skill\'s declared purpose')

    return parts.join('\n')
  }

  /**
   * Execute using LLM router if the skill is routed to OpenRouter,
   * otherwise fall back to Agent SDK.
   */
  private async executeWithRouter(
    skill: SkillDefinition,
    prompt: string,
    userMessage: string | undefined,
    timeoutMs: number,
  ): Promise<{ output: string; costUsd: number }> {
    // Check if LLM router is available and routes this skill to OpenRouter
    if (this.llmRouter) {
      const route = this.llmRouter.getRoute(skill.id)
      if (route.provider === 'openrouter') {
        console.log(LOG, `Routing skill ${skill.id} via OpenRouter (${route.model})`)
        const result = await this.llmRouter.generateText(
          skill.id,
          prompt,
          userMessage ?? 'Execute this skill now.',
        )
        if (result) {
          return { output: result.content, costUsd: result.costUsd }
        }
        // If OpenRouter failed, fall through to Agent SDK
        console.warn(LOG, `OpenRouter failed for ${skill.id}, falling back to Agent SDK`)
      }
    }

    // Default: execute via Agent SDK
    return this.executeSdkQuery(skill, prompt, timeoutMs)
  }

  private async executeSdkQuery(
    skill: SkillDefinition,
    prompt: string,
    timeoutMs: number,
  ): Promise<{ output: string; costUsd: number }> {
    const sdk = await import('@anthropic-ai/claude-agent-sdk')

    // Determine model from LLM routing config
    const routing = this.configStore.getLlmRoutingForTask(skill.id)
    const model = routing?.model ?? 'claude-haiku-4-5-20251001'

    const cliPath = this.getClaudeCodeCliPath()
    const abortController = new AbortController()

    // Set up timeout
    const timeoutHandle = setTimeout(() => abortController.abort(), timeoutMs)

    // Build MCP servers for skill-specific tools (no self-tools = anti-recursion)
    const mcpServers: Record<string, any> = {}
    const requires = skill.frontmatter.requires ?? []
    if (requires.includes('digest-utils') || requires.includes('idea-utils') || requires.includes('channel-router')) {
      try {
        const digestSources = this.configStore.getDigestSources()
        const skillToolsServer = createSkillToolsMcpServer(sdk, digestSources, [])
        mcpServers['skill-tools'] = skillToolsServer
      } catch (err) {
        console.warn(LOG, 'Failed to create skill tools MCP server:', err)
      }
    }

    // Build allowed tools based on skill permissions + sandbox config
    const immutableConfig = this.configStore.getImmutableConfig()
    const skillPerms = skill.frontmatter.metadata?.permissions
    let skillAllowedTools = ['Read', 'Glob', 'Grep']

    // Add network tools only if skill declares network access or no permission manifest
    if (!skillPerms || skillPerms.risk_tier === undefined || (skillPerms as any).network) {
      skillAllowedTools.push('WebFetch', 'WebSearch')
    }

    // Add write tools only if skill declares filesystem write access
    if (skillPerms && (skillPerms as any).filesystem?.write) {
      skillAllowedTools.push('Write', 'Edit')
    }

    // Enforce sandbox: strip write tools when sandbox is enabled
    if (immutableConfig.sandboxEnabled) {
      skillAllowedTools = skillAllowedTools.filter(
        (t) => !['Write', 'Edit', 'Bash'].includes(t),
      )
    }

    const options: import('@anthropic-ai/claude-agent-sdk').Options = {
      model,
      maxTurns: 10,
      maxBudgetUsd: immutableConfig.maxCostPerExecutionUsd,
      systemPrompt: prompt,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      abortController,
      allowedTools: skillAllowedTools,
      ...(Object.keys(mcpServers).length > 0 ? { mcpServers } : {}),
      ...(cliPath ? { pathToClaudeCodeExecutable: cliPath } : {}),
    }

    async function* generateMessages() {
      yield {
        type: 'user' as const,
        message: { role: 'user' as const, content: 'Execute this skill now.' },
        parent_tool_use_id: null,
        session_id: '',
      }
    }

    let responseText = ''
    let costUsd = 0

    try {
      const queryResult = sdk.query({ prompt: generateMessages(), options })

      for await (const message of queryResult) {
        if (message.type === 'assistant') {
          const content = (message as any).message?.content
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === 'text' && block.text) {
                if (block.text.length > responseText.length) {
                  responseText = block.text
                }
              }
            }
          }
        }

        if (message.type === 'result') {
          costUsd = (message as any).total_cost_usd || 0
          if ((message as any).result && typeof (message as any).result === 'string') {
            responseText = (message as any).result
          }
        }
      }
    } finally {
      clearTimeout(timeoutHandle)
    }

    return { output: responseText, costUsd }
  }

  private getClaudeCodeCliPath(): string | undefined {
    try {
      const path = require('path')
      const sdkPath = require.resolve('@anthropic-ai/claude-agent-sdk')
      const sdkDir = path.dirname(sdkPath)
      let cliPath = path.join(sdkDir, 'cli.js')
      if (cliPath.includes('app.asar') && !cliPath.includes('app.asar.unpacked')) {
        cliPath = cliPath.replace('app.asar', 'app.asar.unpacked')
      }
      return cliPath
    } catch {
      return undefined
    }
  }
}

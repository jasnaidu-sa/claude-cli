/**
 * HeartbeatService - Timer-based proactive monitoring
 *
 * Implements a two-tier heartbeat system:
 *   Tier 1 (Cheap checks, no LLM, $0 cost):
 *     - Check BVS approval status
 *     - Check for failed scheduled tasks
 *     - Check Ideas inbox count
 *     - Check git status of linked projects
 *
 *   Tier 2 (LLM analysis, only runs if Tier 1 found something):
 *     - Summarize findings using the Anthropic Messages API
 *     - Send concise alert to the configured WhatsApp conversation
 *
 * Also supports time-based scheduled reports parsed from HEARTBEAT.md
 * (e.g., "Morning (8am)", "Evening (6pm)").
 *
 * Emits:
 *   - 'heartbeat-result'  (HeartbeatResult)
 *   - 'heartbeat-alert'   (HeartbeatAlert)
 */

import { EventEmitter } from 'events'
import { execSync } from 'child_process'
import Anthropic from '@anthropic-ai/sdk'
import type {
  HeartbeatConfig,
  HeartbeatResult,
  HeartbeatAlert,
} from '@shared/whatsapp-types'
import type { WhatsAppService } from './whatsapp-service'
import type { AgentIdentityService } from './agent-identity-service'
import type { ConfigStore } from './config-store'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default heartbeat interval: 30 minutes */
const DEFAULT_INTERVAL_MS = 1_800_000

/** Window (in ms) around a scheduled report time during which we consider it "due". */
const SCHEDULED_REPORT_WINDOW_MS = 5 * 60 * 1_000 // 5 minutes

/** Haiku model used for Tier 2 LLM analysis (cheap & fast). */
const TIER2_MODEL = 'claude-haiku-4-5-20251001'

/** Max tokens for the Tier 2 summary response. */
const TIER2_MAX_TOKENS = 1024

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface ScheduledReport {
  label: string
  hour: number
  description: string
}

/**
 * Parse HEARTBEAT.md "## Scheduled Reports" section to extract time-based entries.
 * Expected format:  `- Morning (8am): Daily briefing with ...`
 */
function parseScheduledReports(heartbeatMd: string): ScheduledReport[] {
  const reports: ScheduledReport[] = []

  // Find the "## Scheduled Reports" section
  const sectionRegex = /## Scheduled Reports[\s\S]*?(?=\n## |\n$|$)/i
  const sectionMatch = heartbeatMd.match(sectionRegex)
  if (!sectionMatch) return reports

  const section = sectionMatch[0]

  // Match lines like:  `- Morning (8am): Daily briefing ...`
  // or `- Evening (6pm): End-of-day summary ...`
  const lineRegex = /^-\s+(.+?)\s*\((\d{1,2})\s*(am|pm)\)\s*:\s*(.+)$/gim
  let match: RegExpExecArray | null

  while ((match = lineRegex.exec(section)) !== null) {
    const label = match[1].trim()
    let hour = parseInt(match[2], 10)
    const amPm = match[3].toLowerCase()

    // Convert to 24-hour
    if (amPm === 'pm' && hour !== 12) hour += 12
    if (amPm === 'am' && hour === 12) hour = 0

    reports.push({
      label,
      hour,
      description: match[4].trim(),
    })
  }

  return reports
}

/**
 * Safely run git status --porcelain in a project directory.
 * Returns the raw output string or null if the command fails.
 */
function getGitStatus(projectPath: string): string | null {
  try {
    const output = execSync('git status --porcelain', {
      cwd: projectPath,
      timeout: 10_000,
      encoding: 'utf-8',
      windowsHide: true,
    })
    return output.trim()
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// HeartbeatService
// ---------------------------------------------------------------------------

export class HeartbeatService extends EventEmitter {
  private whatsappService: WhatsAppService
  private identityService: AgentIdentityService
  private configStore: ConfigStore

  // Typed as `any` because IdeasManager and BvsOrchestrator interfaces are not
  // exposed in our shared types -- they are existing runtime services whose
  // shape may change independently.
  private ideasManager: any
  private bvsOrchestrator: any

  private intervalHandle: ReturnType<typeof setInterval> | null = null
  private lastResult: HeartbeatResult | null = null
  private running = false

  /**
   * Tracks which scheduled-report hours have already fired today so we do
   * not send the same report twice within the same calendar day.
   */
  private firedReportsToday: Set<number> = new Set()

  /** The calendar day (getDate()) for which `firedReportsToday` is valid. */
  private firedReportsDay = -1

  constructor(
    whatsappService: WhatsAppService,
    identityService: AgentIdentityService,
    configStore: ConfigStore,
    ideasManager: any,
    bvsOrchestrator: any,
  ) {
    super()
    this.whatsappService = whatsappService
    this.identityService = identityService
    this.configStore = configStore
    this.ideasManager = ideasManager
    this.bvsOrchestrator = bvsOrchestrator
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /** Start the periodic heartbeat timer. */
  start(): void {
    if (this.running) return

    const config = this.getConfig()
    const intervalMs = config.intervalMs || DEFAULT_INTERVAL_MS

    this.running = true
    this.intervalHandle = setInterval(() => {
      this.tick().catch((err) => {
        console.error('[HeartbeatService] tick error:', err)
      })
    }, intervalMs)

    console.log(
      `[HeartbeatService] Started with interval ${intervalMs}ms (${(intervalMs / 60_000).toFixed(1)} min)`,
    )
  }

  /** Stop the periodic heartbeat timer. */
  stop(): void {
    if (!this.running) return

    if (this.intervalHandle) {
      clearInterval(this.intervalHandle)
      this.intervalHandle = null
    }
    this.running = false
    console.log('[HeartbeatService] Stopped')
  }

  /** Returns whether the heartbeat timer is currently running. */
  isRunning(): boolean {
    return this.running
  }

  /** Manually trigger a heartbeat execution and return its result. */
  async triggerNow(): Promise<HeartbeatResult> {
    return this.executeHeartbeat()
  }

  /** Get the result of the last heartbeat execution (or null if none yet). */
  getLastResult(): HeartbeatResult | null {
    return this.lastResult
  }

  // -----------------------------------------------------------------------
  // Private: timer tick
  // -----------------------------------------------------------------------

  private async tick(): Promise<void> {
    const result = await this.executeHeartbeat()

    // Also check for time-based scheduled reports
    await this.checkScheduledReports(result)
  }

  // -----------------------------------------------------------------------
  // Private: core heartbeat execution
  // -----------------------------------------------------------------------

  private async executeHeartbeat(): Promise<HeartbeatResult> {
    const startTime = Date.now()
    const config = this.getConfig()

    try {
      // ----- Tier 1: Cheap checks -----
      const alerts = this.runTier1Checks()

      // If no alerts, we are done -- zero cost.
      if (alerts.length === 0) {
        const result: HeartbeatResult = {
          timestamp: Date.now(),
          status: 'ok',
          alerts: [],
          costUsd: 0,
          durationMs: Date.now() - startTime,
        }

        this.lastResult = result
        this.emit('heartbeat-result', result)
        console.log('[HeartbeatService] Tier 1: all OK, no alerts')
        return result
      }

      // ----- Tier 2: LLM analysis (only if Tier 1 found something) -----
      if (config.cheapChecksFirst) {
        const tier2Result = await this.runTier2Analysis(alerts, config)
        const result: HeartbeatResult = {
          timestamp: Date.now(),
          status: 'alert',
          alerts: tier2Result.alerts,
          costUsd: tier2Result.costUsd,
          durationMs: Date.now() - startTime,
        }

        this.lastResult = result
        this.emit('heartbeat-result', result)

        // Send alert message to WhatsApp
        await this.sendAlertToWhatsApp(result, config)

        return result
      }

      // cheapChecksFirst disabled -- just emit raw Tier 1 alerts
      const result: HeartbeatResult = {
        timestamp: Date.now(),
        status: 'alert',
        alerts,
        costUsd: 0,
        durationMs: Date.now() - startTime,
      }

      this.lastResult = result
      this.emit('heartbeat-result', result)
      await this.sendAlertToWhatsApp(result, config)
      return result
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      console.error('[HeartbeatService] Heartbeat error:', errMsg)

      const result: HeartbeatResult = {
        timestamp: Date.now(),
        status: 'error',
        alerts: [
          {
            type: 'custom',
            title: 'Heartbeat Error',
            message: `Heartbeat execution failed: ${errMsg}`,
            severity: 'warning',
          },
        ],
        costUsd: 0,
        durationMs: Date.now() - startTime,
      }

      this.lastResult = result
      this.emit('heartbeat-result', result)
      return result
    }
  }

  // -----------------------------------------------------------------------
  // Tier 1: Cheap deterministic checks (no LLM, $0 cost)
  // -----------------------------------------------------------------------

  private runTier1Checks(): HeartbeatAlert[] {
    const alerts: HeartbeatAlert[] = []

    // 1. Check BVS approval status
    this.checkBvsApprovalStatus(alerts)

    // 2. Check for failed scheduled tasks
    this.checkFailedTasks(alerts)

    // 3. Check Ideas inbox count
    this.checkIdeasInbox(alerts)

    // 4. Check git status of linked projects
    this.checkLinkedProjectsGitStatus(alerts)

    return alerts
  }

  /**
   * Check if any BVS sections are in 'waiting_approval' status.
   */
  private checkBvsApprovalStatus(alerts: HeartbeatAlert[]): void {
    try {
      if (!this.bvsOrchestrator) return

      // Try to get current plan/status from the orchestrator.
      // The method names vary by implementation; try common patterns.
      let waitingCount = 0

      if (typeof this.bvsOrchestrator.getCurrentPlan === 'function') {
        const plan = this.bvsOrchestrator.getCurrentPlan()
        if (plan?.sections) {
          for (const section of plan.sections) {
            if (
              section.status === 'waiting_approval' ||
              section.status === 'pending_approval'
            ) {
              waitingCount++
            }
          }
        }
      } else if (typeof this.bvsOrchestrator.getStatus === 'function') {
        const status = this.bvsOrchestrator.getStatus()
        if (status?.pendingApprovals) {
          waitingCount = status.pendingApprovals
        }
      }

      if (waitingCount > 0) {
        alerts.push({
          type: 'bvs_status',
          title: 'BVS Sections Awaiting Approval',
          message: `${waitingCount} BVS section(s) are waiting for your approval.`,
          severity: 'warning',
        })
      }
    } catch (err) {
      // Silently skip -- BVS orchestrator may not be initialized
      console.debug('[HeartbeatService] BVS check skipped:', err)
    }
  }

  /**
   * Check if any scheduled tasks have failed since the last heartbeat.
   */
  private checkFailedTasks(alerts: HeartbeatAlert[]): void {
    try {
      // Read task data from the electron-store used by TaskSchedulerService
      const Store = require('electron-store')
      const taskStore = new Store({ name: 'whatsapp-tasks' })
      const tasks: Record<string, any> = taskStore.get('tasks', {})

      let failedCount = 0
      const failedNames: string[] = []

      for (const [, task] of Object.entries(tasks)) {
        if (task && task.status === 'failed') {
          failedCount++
          if (task.name) failedNames.push(task.name)
        }
      }

      if (failedCount > 0) {
        const namesList =
          failedNames.length > 0
            ? ` (${failedNames.slice(0, 3).join(', ')}${failedNames.length > 3 ? '...' : ''})`
            : ''
        alerts.push({
          type: 'custom',
          title: 'Failed Scheduled Tasks',
          message: `${failedCount} scheduled task(s) have failed${namesList}.`,
          severity: 'warning',
        })
      }
    } catch (err) {
      console.debug('[HeartbeatService] Task check skipped:', err)
    }
  }

  /**
   * Check the Ideas inbox for unread / new items.
   */
  private checkIdeasInbox(alerts: HeartbeatAlert[]): void {
    try {
      if (!this.ideasManager) return

      if (typeof this.ideasManager.list === 'function') {
        // IdeasManager.list(stage?) returns Idea[]
        const inboxIdeas = this.ideasManager.list('inbox')
        if (Array.isArray(inboxIdeas) && inboxIdeas.length > 0) {
          alerts.push({
            type: 'ideas_update',
            title: 'Ideas Inbox',
            message: `You have ${inboxIdeas.length} idea(s) in your inbox that need attention.`,
            severity: inboxIdeas.length >= 5 ? 'warning' : 'info',
          })
        }
      }
    } catch (err) {
      console.debug('[HeartbeatService] Ideas check skipped:', err)
    }
  }

  /**
   * Check git status of projects linked to registered WhatsApp conversations.
   */
  private checkLinkedProjectsGitStatus(alerts: HeartbeatAlert[]): void {
    try {
      const conversations = this.whatsappService.listConversations()
      const checkedPaths = new Set<string>()

      for (const convo of conversations) {
        const projectPath = convo.projectPath
        if (!projectPath || checkedPaths.has(projectPath)) continue
        checkedPaths.add(projectPath)

        const gitOutput = getGitStatus(projectPath)
        if (gitOutput === null) continue // not a git repo or error

        if (gitOutput.length > 0) {
          // Count modified / untracked files
          const lines = gitOutput.split('\n').filter(Boolean)
          alerts.push({
            type: 'project_health',
            title: 'Uncommitted Changes',
            message: `Project at ${projectPath} has ${lines.length} uncommitted change(s).`,
            severity: 'info',
            projectPath,
          })
        }
      }
    } catch (err) {
      console.debug('[HeartbeatService] Git status check skipped:', err)
    }
  }

  // -----------------------------------------------------------------------
  // Tier 2: LLM analysis
  // -----------------------------------------------------------------------

  private async runTier2Analysis(
    tier1Alerts: HeartbeatAlert[],
    config: HeartbeatConfig,
  ): Promise<{ alerts: HeartbeatAlert[]; costUsd: number }> {
    try {
      const apiKey = process.env.ANTHROPIC_API_KEY
      if (!apiKey) {
        console.warn(
          '[HeartbeatService] No ANTHROPIC_API_KEY found, skipping Tier 2 LLM analysis',
        )
        return { alerts: tier1Alerts, costUsd: 0 }
      }

      const client = new Anthropic({ apiKey })

      // Build context from Tier 1 findings
      const heartbeatMd = this.identityService.getIdentity().heartbeatMd
      const findingsSummary = tier1Alerts
        .map(
          (a, i) =>
            `${i + 1}. [${a.severity.toUpperCase()}] ${a.title}: ${a.message}`,
        )
        .join('\n')

      const systemPrompt = [
        'You are processing a heartbeat check for a personal AI assistant system.',
        'Your job is to take the raw findings from automated checks and produce a concise,',
        'actionable WhatsApp message (under 2000 characters) for the user.',
        '',
        'Guidelines:',
        '- Be concise and direct (this is a WhatsApp message read on a phone)',
        '- Prioritize critical items first',
        '- Use bullet points for multiple items',
        '- Suggest specific actions the user can take',
        '- If nothing is urgent, keep it very brief',
      ].join('\n')

      const userPrompt = [
        'Here are the heartbeat instructions from HEARTBEAT.md:',
        '---',
        heartbeatMd,
        '---',
        '',
        'Here are the findings from automated checks:',
        findingsSummary,
        '',
        'Please produce a concise heartbeat summary message.',
      ].join('\n')

      const response = await client.messages.create({
        model: TIER2_MODEL,
        max_tokens: TIER2_MAX_TOKENS,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      })

      // Extract text from the response
      const responseText = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('\n')

      // Estimate cost (Haiku pricing: ~$0.25/1M input, ~$1.25/1M output)
      const inputTokens = response.usage?.input_tokens ?? 0
      const outputTokens = response.usage?.output_tokens ?? 0
      const costUsd =
        (inputTokens / 1_000_000) * 0.25 + (outputTokens / 1_000_000) * 1.25

      // Check budget cap
      if (costUsd > config.maxBudgetPerBeatUsd) {
        console.warn(
          `[HeartbeatService] Tier 2 cost ($${costUsd.toFixed(4)}) exceeded budget ($${config.maxBudgetPerBeatUsd})`,
        )
      }

      // Create an enriched alert with the LLM summary
      const enrichedAlerts: HeartbeatAlert[] = [
        ...tier1Alerts,
        {
          type: 'custom',
          title: 'Heartbeat Summary',
          message: responseText,
          severity: tier1Alerts.some((a) => a.severity === 'critical')
            ? 'critical'
            : tier1Alerts.some((a) => a.severity === 'warning')
              ? 'warning'
              : 'info',
        },
      ]

      return { alerts: enrichedAlerts, costUsd }
    } catch (err) {
      console.error('[HeartbeatService] Tier 2 LLM analysis failed:', err)
      // Fall back to raw Tier 1 alerts
      return { alerts: tier1Alerts, costUsd: 0 }
    }
  }

  // -----------------------------------------------------------------------
  // Scheduled Reports
  // -----------------------------------------------------------------------

  /**
   * Check whether any time-based scheduled reports from HEARTBEAT.md are due.
   * If a report is due and has not yet been fired today, trigger an LLM-based
   * report and send it to WhatsApp.
   */
  private async checkScheduledReports(
    _lastResult: HeartbeatResult,
  ): Promise<void> {
    try {
      const now = new Date()
      const currentDay = now.getDate()

      // Reset the fired-reports tracker when the day changes
      if (currentDay !== this.firedReportsDay) {
        this.firedReportsToday.clear()
        this.firedReportsDay = currentDay
      }

      const heartbeatMd = this.identityService.getIdentity().heartbeatMd
      const reports = parseScheduledReports(heartbeatMd)

      for (const report of reports) {
        // Already fired this report today?
        if (this.firedReportsToday.has(report.hour)) continue

        // Check if current time is within the window for this report
        const reportTimeMs = this.getReportTimeTodayMs(report.hour)
        const diff = Math.abs(now.getTime() - reportTimeMs)
        if (diff > SCHEDULED_REPORT_WINDOW_MS) continue

        // Fire the scheduled report
        console.log(
          `[HeartbeatService] Firing scheduled report: ${report.label} (${report.hour}:00)`,
        )
        this.firedReportsToday.add(report.hour)
        await this.fireScheduledReport(report)
      }
    } catch (err) {
      console.debug('[HeartbeatService] Scheduled report check error:', err)
    }
  }

  /**
   * Get the epoch-ms timestamp for a given hour today in the local timezone.
   */
  private getReportTimeTodayMs(hour: number): number {
    const now = new Date()
    const target = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      hour,
      0,
      0,
      0,
    )
    return target.getTime()
  }

  /**
   * Generate and send a scheduled report using the LLM.
   */
  private async fireScheduledReport(report: ScheduledReport): Promise<void> {
    const config = this.getConfig()

    try {
      const apiKey = process.env.ANTHROPIC_API_KEY
      if (!apiKey) {
        console.warn(
          '[HeartbeatService] No ANTHROPIC_API_KEY, skipping scheduled report',
        )
        return
      }

      const client = new Anthropic({ apiKey })

      // Gather context for the report
      const tier1Alerts = this.runTier1Checks()

      const contextParts: string[] = [
        `Scheduled Report: ${report.label}`,
        `Description: ${report.description}`,
        '',
      ]

      if (tier1Alerts.length > 0) {
        contextParts.push('Current system status:')
        for (const alert of tier1Alerts) {
          contextParts.push(
            `- [${alert.severity.toUpperCase()}] ${alert.title}: ${alert.message}`,
          )
        }
      } else {
        contextParts.push('All systems are healthy. No alerts to report.')
      }

      const response = await client.messages.create({
        model: TIER2_MODEL,
        max_tokens: TIER2_MAX_TOKENS,
        system: [
          'You are generating a scheduled report for a personal AI assistant.',
          'Keep the report concise (under 2000 chars) and suitable for WhatsApp.',
          'Use bullet points. Focus on actionable information.',
        ].join('\n'),
        messages: [{ role: 'user', content: contextParts.join('\n') }],
      })

      const responseText = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('\n')

      // Send to WhatsApp
      if (config.targetConversationJid && this.whatsappService.isConnected()) {
        const header = `*${report.label} Report*\n\n`
        await this.whatsappService.sendMessage(
          config.targetConversationJid,
          header + responseText,
        )
      }

      // Emit as a heartbeat alert
      this.emit('heartbeat-alert', {
        type: 'custom',
        title: `Scheduled: ${report.label}`,
        message: responseText,
        severity: 'info',
      } satisfies HeartbeatAlert)
    } catch (err) {
      console.error(
        `[HeartbeatService] Failed to fire scheduled report "${report.label}":`,
        err,
      )
    }
  }

  // -----------------------------------------------------------------------
  // WhatsApp alert delivery
  // -----------------------------------------------------------------------

  private async sendAlertToWhatsApp(
    result: HeartbeatResult,
    config: HeartbeatConfig,
  ): Promise<void> {
    try {
      if (!config.targetConversationJid) return
      if (!this.whatsappService.isConnected()) return

      // If Tier 2 produced a summary, use it. Otherwise format raw alerts.
      const summaryAlert = result.alerts.find(
        (a) => a.title === 'Heartbeat Summary',
      )

      let message: string
      if (summaryAlert) {
        message = summaryAlert.message
      } else {
        // Format raw alerts
        const lines = result.alerts.map(
          (a) => `${this.severityIcon(a.severity)} *${a.title}*\n${a.message}`,
        )
        message = `*Heartbeat Alert*\n\n${lines.join('\n\n')}`
      }

      await this.whatsappService.sendMessage(
        config.targetConversationJid,
        message,
      )
    } catch (err) {
      console.error(
        '[HeartbeatService] Failed to send alert to WhatsApp:',
        err,
      )
    }
  }

  private severityIcon(severity: HeartbeatAlert['severity']): string {
    switch (severity) {
      case 'critical':
        return '[!!!]'
      case 'warning':
        return '[!]'
      case 'info':
        return '[i]'
      default:
        return '[-]'
    }
  }

  // -----------------------------------------------------------------------
  // Config helper
  // -----------------------------------------------------------------------

  private getConfig(): HeartbeatConfig {
    return this.configStore.getWhatsAppConfig().heartbeat
  }
}

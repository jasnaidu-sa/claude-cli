/**
 * ChannelUxService - Enhanced Channel UX
 *
 * Provides rich UX primitives across WhatsApp and Telegram:
 * - Approval gates with inline keyboards (Telegram) / numbered options (WhatsApp)
 * - Progress bars for long-running operations (BVS, skill execution)
 * - Cross-channel message forwarding
 * - Notification formatting with channel-specific optimizations
 *
 * Emits:
 * - 'approval-response' with { requestId, approved, data, channel }
 * - 'progress-update' with { operationId, progress, channel }
 */

import { EventEmitter } from 'events'
import type { ChannelRouterService } from './channel-router-service'
import type { TelegramService } from './telegram-service'
import type {
  ChannelType,
  ChannelMessage,
  InlineKeyboardButton,
} from '@shared/channel-types'

const LOG = '[ChannelUX]'

// ============================================================================
// Types
// ============================================================================

export interface ApprovalRequest {
  id: string
  title: string
  description: string
  options: ApprovalOption[]
  channel: ChannelType
  chatId: string
  messageId?: string
  createdAt: number
  expiresAt: number
  status: 'pending' | 'approved' | 'rejected' | 'expired'
  response?: string
}

export interface ApprovalOption {
  label: string
  data: string
  emoji?: string
}

export interface ProgressBar {
  id: string
  title: string
  channel: ChannelType
  chatId: string
  messageId?: number
  current: number
  total: number
  status: 'running' | 'completed' | 'failed'
  startedAt: number
  lastUpdatedAt: number
  phases?: string[]
  currentPhase?: string
}

export interface CrossForwardConfig {
  enabled: boolean
  /** Forward WhatsApp messages to Telegram */
  whatsappToTelegram: boolean
  /** Forward Telegram messages to WhatsApp */
  telegramToWhatsapp: boolean
  /** Only forward messages matching these patterns */
  filterPatterns?: string[]
  /** Prefix format for forwarded messages */
  prefixFormat: 'channel' | 'channel_sender' | 'none'
}

// ============================================================================
// Service
// ============================================================================

export class ChannelUxService extends EventEmitter {
  private channelRouter: ChannelRouterService
  private telegramService: TelegramService | null
  private approvalRequests: Map<string, ApprovalRequest> = new Map()
  private progressBars: Map<string, ProgressBar> = new Map()
  private forwardConfig: CrossForwardConfig

  constructor(
    channelRouter: ChannelRouterService,
    telegramService: TelegramService | null,
    forwardConfig?: Partial<CrossForwardConfig>,
  ) {
    super()
    this.channelRouter = channelRouter
    this.telegramService = telegramService
    this.forwardConfig = {
      enabled: false,
      whatsappToTelegram: true,
      telegramToWhatsapp: false,
      prefixFormat: 'channel_sender',
      ...forwardConfig,
    }

    // Listen for Telegram callback queries to resolve approval gates
    if (telegramService) {
      telegramService.on('callback-query', (query: any) => {
        this.handleCallbackQuery(query)
      })
    }

    // Periodically expire old approval requests
    setInterval(() => this.expireOldRequests(), 60_000)
  }

  // =========================================================================
  // Approval Gates
  // =========================================================================

  /**
   * Send an approval request to a channel.
   * - Telegram: Uses inline keyboard buttons
   * - WhatsApp: Uses numbered text options
   *
   * Returns the request ID for tracking the response.
   */
  async sendApprovalRequest(
    channel: ChannelType,
    chatId: string,
    title: string,
    description: string,
    options: ApprovalOption[],
    timeoutMs: number = 300_000, // 5 minutes default
  ): Promise<string> {
    const requestId = `apr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

    const request: ApprovalRequest = {
      id: requestId,
      title,
      description,
      options,
      channel,
      chatId,
      createdAt: Date.now(),
      expiresAt: Date.now() + timeoutMs,
      status: 'pending',
    }

    this.approvalRequests.set(requestId, request)

    // Format and send the message
    if (channel === 'telegram' && this.telegramService) {
      await this.sendTelegramApproval(request)
    } else {
      await this.sendWhatsAppApproval(request)
    }

    console.log(LOG, `Approval request ${requestId} sent to ${channel}:${chatId}`)
    return requestId
  }

  /**
   * Get the status of an approval request.
   */
  getApprovalStatus(requestId: string): ApprovalRequest | undefined {
    return this.approvalRequests.get(requestId)
  }

  /**
   * Wait for an approval response (blocking with timeout).
   */
  async waitForApproval(
    requestId: string,
    timeoutMs: number = 300_000,
  ): Promise<{ approved: boolean; response?: string }> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.removeListener('approval-response', handler)
        resolve({ approved: false, response: 'timeout' })
      }, timeoutMs)

      const handler = (event: any) => {
        if (event.requestId === requestId) {
          clearTimeout(timeout)
          this.removeListener('approval-response', handler)
          resolve({ approved: event.approved, response: event.data })
        }
      }

      this.on('approval-response', handler)

      // Check if already resolved
      const request = this.approvalRequests.get(requestId)
      if (request && request.status !== 'pending') {
        clearTimeout(timeout)
        this.removeListener('approval-response', handler)
        resolve({
          approved: request.status === 'approved',
          response: request.response,
        })
      }
    })
  }

  /**
   * Resolve an approval request from a WhatsApp text response.
   * Call this when a numbered reply is received.
   */
  resolveWhatsAppApproval(chatId: string, text: string): boolean {
    // Find pending approval for this chat
    for (const [, request] of this.approvalRequests) {
      if (request.channel !== 'whatsapp') continue
      if (request.chatId !== chatId) continue
      if (request.status !== 'pending') continue

      const num = parseInt(text.trim(), 10)
      if (isNaN(num) || num < 1 || num > request.options.length) continue

      const selectedOption = request.options[num - 1]
      request.status = selectedOption.data.startsWith('reject') ? 'rejected' : 'approved'
      request.response = selectedOption.data

      this.emit('approval-response', {
        requestId: request.id,
        approved: request.status === 'approved',
        data: selectedOption.data,
        channel: 'whatsapp',
      })

      console.log(LOG, `Approval ${request.id} resolved: ${request.status} (${selectedOption.label})`)
      return true
    }

    return false
  }

  // =========================================================================
  // Progress Bars
  // =========================================================================

  /**
   * Create a progress bar for a long-running operation.
   * Returns the progress bar ID.
   */
  async createProgressBar(
    channel: ChannelType,
    chatId: string,
    title: string,
    total: number,
    phases?: string[],
  ): Promise<string> {
    const id = `prog_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

    const bar: ProgressBar = {
      id,
      title,
      channel,
      chatId,
      current: 0,
      total,
      status: 'running',
      startedAt: Date.now(),
      lastUpdatedAt: Date.now(),
      phases,
      currentPhase: phases?.[0],
    }

    // Send initial progress message
    const text = this.formatProgressBar(bar)

    if (channel === 'telegram' && this.telegramService) {
      try {
        const msg = await this.telegramService.sendMessage(chatId, text, { parseMode: 'HTML' })
        bar.messageId = parseInt(msg.id, 10)
      } catch {
        const msg = await this.telegramService.sendMessage(chatId, text)
        bar.messageId = parseInt(msg.id, 10)
      }
    } else {
      await this.channelRouter.sendToChannel(channel, chatId, text)
    }

    this.progressBars.set(id, bar)
    return id
  }

  /**
   * Update a progress bar's current value.
   */
  async updateProgress(
    id: string,
    current: number,
    currentPhase?: string,
  ): Promise<void> {
    const bar = this.progressBars.get(id)
    if (!bar) return

    bar.current = Math.min(current, bar.total)
    bar.lastUpdatedAt = Date.now()
    if (currentPhase) bar.currentPhase = currentPhase

    // Throttle updates to every 3 seconds minimum
    const timeSinceLastUpdate = Date.now() - bar.lastUpdatedAt
    if (timeSinceLastUpdate < 3000 && bar.current < bar.total) return

    const text = this.formatProgressBar(bar)

    // Edit existing message on Telegram for live updates
    if (bar.channel === 'telegram' && this.telegramService && bar.messageId) {
      try {
        await this.telegramService.editMessage(bar.chatId, bar.messageId, text, 'HTML')
      } catch {
        // If edit fails (e.g., message too old), send new message
        const msg = await this.telegramService.sendMessage(bar.chatId, text)
        bar.messageId = parseInt(msg.id, 10)
      }
    }
    // WhatsApp: send new message (can't edit)
    // Only send at milestones to avoid spam
    else if (bar.current === bar.total || bar.current % Math.ceil(bar.total / 4) === 0) {
      await this.channelRouter.sendToChannel(bar.channel, bar.chatId, text)
    }

    this.emit('progress-update', { operationId: id, progress: bar.current / bar.total, channel: bar.channel })
  }

  /**
   * Mark a progress bar as completed or failed.
   */
  async completeProgress(id: string, status: 'completed' | 'failed'): Promise<void> {
    const bar = this.progressBars.get(id)
    if (!bar) return

    bar.status = status
    bar.current = status === 'completed' ? bar.total : bar.current
    bar.lastUpdatedAt = Date.now()

    const text = this.formatProgressBar(bar)

    if (bar.channel === 'telegram' && this.telegramService && bar.messageId) {
      try {
        await this.telegramService.editMessage(bar.chatId, bar.messageId, text, 'HTML')
      } catch {
        await this.channelRouter.sendToChannel(bar.channel, bar.chatId, text)
      }
    } else {
      await this.channelRouter.sendToChannel(bar.channel, bar.chatId, text)
    }

    // Clean up after a delay
    setTimeout(() => this.progressBars.delete(id), 60_000)
  }

  // =========================================================================
  // Cross-Channel Forwarding
  // =========================================================================

  /**
   * Forward a message from one channel to others.
   * Respects the configured forwarding rules.
   */
  async forwardMessage(message: ChannelMessage): Promise<void> {
    if (!this.forwardConfig.enabled) return

    // Check direction
    if (message.channel === 'whatsapp' && !this.forwardConfig.whatsappToTelegram) return
    if (message.channel === 'telegram' && !this.forwardConfig.telegramToWhatsapp) return

    // Check filter patterns
    if (this.forwardConfig.filterPatterns?.length) {
      const matches = this.forwardConfig.filterPatterns.some((pattern) =>
        message.content.toLowerCase().includes(pattern.toLowerCase()),
      )
      if (!matches) return
    }

    // Format the forwarded message
    const prefix = this.formatForwardPrefix(message)
    const forwardedContent = prefix ? `${prefix}\n${message.content}` : message.content

    // Forward to all other connected channels
    await this.channelRouter.forwardMessage({
      ...message,
      content: forwardedContent,
    })
  }

  /**
   * Update cross-channel forwarding configuration.
   */
  updateForwardConfig(config: Partial<CrossForwardConfig>): void {
    this.forwardConfig = { ...this.forwardConfig, ...config }
    console.log(LOG, 'Forward config updated:', JSON.stringify(this.forwardConfig))
  }

  getForwardConfig(): CrossForwardConfig {
    return { ...this.forwardConfig }
  }

  // =========================================================================
  // Rich Notifications
  // =========================================================================

  /**
   * Send a formatted notification optimized for each channel.
   */
  async sendNotification(
    title: string,
    body: string,
    urgency: 'low' | 'medium' | 'high' = 'medium',
  ): Promise<void> {
    const emoji = urgency === 'high' ? '🔴' : urgency === 'medium' ? '🟡' : '🔵'

    // Telegram: use HTML formatting
    if (this.telegramService?.isConnected()) {
      const chatId = this.telegramService.getPrimaryNotificationChatId()
      if (chatId) {
        const htmlText = `${emoji} <b>${escapeHtml(title)}</b>\n\n${escapeHtml(body)}`
        try {
          await this.telegramService.sendMessage(chatId, htmlText, { parseMode: 'HTML' })
        } catch {
          // Fallback to plain text
          await this.telegramService.sendMessage(chatId, `${emoji} ${title}\n\n${body}`)
        }
      }
    }

    // WhatsApp: use WhatsApp formatting
    const whatsapp = this.channelRouter.getChannel('whatsapp')
    if (whatsapp?.isConnected()) {
      const chatId = whatsapp.getPrimaryNotificationChatId()
      if (chatId) {
        const waText = `${emoji} *${title}*\n\n${body}`
        await whatsapp.sendMessage(chatId, waText)
      }
    }
  }

  /**
   * Send a BVS execution status update with progress.
   */
  async sendBvsStatusUpdate(
    channel: ChannelType,
    chatId: string,
    taskName: string,
    phase: string,
    progress: number, // 0-1
    details?: string,
  ): Promise<void> {
    const progressBar = this.renderProgressText(progress)
    const pct = Math.round(progress * 100)

    const parts = [
      `*BVS: ${taskName}*`,
      `Phase: ${phase}`,
      `${progressBar} ${pct}%`,
    ]

    if (details) parts.push('', details)

    const text = parts.join('\n')

    if (channel === 'telegram' && this.telegramService) {
      try {
        const htmlText = `<b>BVS: ${escapeHtml(taskName)}</b>\nPhase: ${escapeHtml(phase)}\n<code>${progressBar}</code> ${pct}%${details ? '\n\n' + escapeHtml(details) : ''}`
        await this.telegramService.sendMessage(chatId, htmlText, { parseMode: 'HTML' })
        return
      } catch {
        // Fall through to plain text
      }
    }

    await this.channelRouter.sendToChannel(channel, chatId, text)
  }

  // =========================================================================
  // Private - Telegram Approval
  // =========================================================================

  private async sendTelegramApproval(request: ApprovalRequest): Promise<void> {
    if (!this.telegramService) return

    const text = `*${request.title}*\n\n${request.description}`

    const keyboard: InlineKeyboardButton[][] = [
      request.options.map((opt) => ({
        text: opt.emoji ? `${opt.emoji} ${opt.label}` : opt.label,
        callbackData: `apr:${request.id}:${opt.data}`,
      })),
    ]

    try {
      const msg = await this.telegramService.sendWithKeyboard(
        request.chatId,
        text,
        keyboard,
        'Markdown',
      )
      request.messageId = msg.id
    } catch {
      // Fallback to plain text with keyboard
      const msg = await this.telegramService.sendMessage(request.chatId, text, {
        inlineKeyboard: keyboard,
      })
      request.messageId = msg.id
    }
  }

  private async sendWhatsAppApproval(request: ApprovalRequest): Promise<void> {
    const parts = [`*${request.title}*`, '', request.description, '']

    request.options.forEach((opt, i) => {
      const emoji = opt.emoji ?? ''
      parts.push(`${i + 1}. ${emoji} ${opt.label}`)
    })

    parts.push('', 'Reply with a number to choose.')

    await this.channelRouter.sendToChannel(request.channel, request.chatId, parts.join('\n'))
  }

  // =========================================================================
  // Private - Callback Query Handling
  // =========================================================================

  private async handleCallbackQuery(query: any): Promise<void> {
    const data = query.data as string
    if (!data?.startsWith('apr:')) return

    const parts = data.split(':')
    if (parts.length < 3) return

    const requestId = parts[1]
    const responseData = parts.slice(2).join(':')

    const request = this.approvalRequests.get(requestId)
    if (!request || request.status !== 'pending') {
      // Answer the callback to dismiss the loading state
      if (this.telegramService) {
        await this.telegramService.answerCallbackQuery(query.id, 'This request has expired.')
      }
      return
    }

    // Update request status
    request.status = responseData.startsWith('reject') ? 'rejected' : 'approved'
    request.response = responseData

    // Acknowledge the button press
    if (this.telegramService) {
      await this.telegramService.answerCallbackQuery(
        query.id,
        request.status === 'approved' ? 'Approved!' : 'Rejected',
      )

      // Update the original message to show the result
      if (request.messageId) {
        const resultEmoji = request.status === 'approved' ? '✅' : '❌'
        const selectedOption = request.options.find((o) => o.data === responseData)
        const resultText = `${resultEmoji} *${request.title}*\n\nSelected: ${selectedOption?.label ?? responseData}`

        try {
          await this.telegramService.editMessage(
            request.chatId,
            parseInt(request.messageId, 10),
            resultText,
            'Markdown',
          )
        } catch {
          // Ignore edit failures
        }
      }
    }

    // Emit the response
    this.emit('approval-response', {
      requestId: request.id,
      approved: request.status === 'approved',
      data: responseData,
      channel: request.channel,
    })

    console.log(LOG, `Approval ${requestId} resolved: ${request.status} via Telegram callback`)
  }

  // =========================================================================
  // Private - Formatting
  // =========================================================================

  private formatProgressBar(bar: ProgressBar): string {
    const progress = bar.total > 0 ? bar.current / bar.total : 0
    const pct = Math.round(progress * 100)
    const progressText = this.renderProgressText(progress)

    const elapsed = Math.round((Date.now() - bar.startedAt) / 1000)
    const elapsedStr = elapsed > 60 ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s` : `${elapsed}s`

    const statusEmoji = bar.status === 'completed' ? '✅'
      : bar.status === 'failed' ? '❌'
      : '⏳'

    if (bar.channel === 'telegram') {
      const parts = [
        `${statusEmoji} <b>${escapeHtml(bar.title)}</b>`,
        `<code>${progressText}</code> ${pct}%`,
        `${bar.current}/${bar.total} • ${elapsedStr}`,
      ]
      if (bar.currentPhase) parts.push(`Phase: ${escapeHtml(bar.currentPhase)}`)
      return parts.join('\n')
    }

    // WhatsApp format
    const parts = [
      `${statusEmoji} *${bar.title}*`,
      `${progressText} ${pct}%`,
      `${bar.current}/${bar.total} • ${elapsedStr}`,
    ]
    if (bar.currentPhase) parts.push(`Phase: ${bar.currentPhase}`)
    return parts.join('\n')
  }

  private renderProgressText(progress: number): string {
    const total = 20
    const filled = Math.round(progress * total)
    const empty = total - filled
    return '[' + '█'.repeat(filled) + '░'.repeat(empty) + ']'
  }

  private formatForwardPrefix(message: ChannelMessage): string {
    switch (this.forwardConfig.prefixFormat) {
      case 'channel':
        return message.channel === 'whatsapp' ? '[WA]' : '[TG]'
      case 'channel_sender':
        const prefix = message.channel === 'whatsapp' ? '[WA]' : '[TG]'
        return `${prefix} ${message.senderName}:`
      case 'none':
        return ''
      default:
        return ''
    }
  }

  private expireOldRequests(): void {
    const now = Date.now()
    for (const [id, request] of this.approvalRequests) {
      if (request.status === 'pending' && now > request.expiresAt) {
        request.status = 'expired'
        this.emit('approval-response', {
          requestId: id,
          approved: false,
          data: 'expired',
          channel: request.channel,
        })
      }
      // Clean up old resolved requests
      if (request.status !== 'pending' && now - request.createdAt > 3600_000) {
        this.approvalRequests.delete(id)
      }
    }
  }
}

// ============================================================================
// Helpers
// ============================================================================

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}

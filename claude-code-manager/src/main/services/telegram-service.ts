/**
 * TelegramService - Telegraf Bot implementing IChannelTransport
 *
 * Manages the Telegram bot connection lifecycle using the Telegraf library.
 * Implements the IChannelTransport interface for unified channel routing.
 *
 * Features:
 * - Bot token authentication
 * - Long polling (default) or webhook mode
 * - Inline keyboard support for approval gates
 * - User/chat allowlisting
 * - Message routing to WhatsAppAgentService via channel router
 *
 * Emits:
 * - 'connection-update' with TelegramConnectionState
 * - 'message-received' with ChannelMessage
 * - 'message-sent' with ChannelMessage
 * - 'callback-query' with TelegramCallbackQuery
 */

import { EventEmitter } from 'events'
import { randomBytes } from 'crypto'
import type {
  IChannelTransport,
  ChannelMessage,
  ChannelSendOptions,
  ChannelType,
  TelegramConnectionState,
  TelegramConfig,
  TelegramCallbackQuery,
  TelegramRoutingRule,
  InlineKeyboardButton,
  OutputCategory,
} from '@shared/channel-types'

const LOG = '[TelegramService]'

export class TelegramService extends EventEmitter implements IChannelTransport {
  readonly channelType: ChannelType = 'telegram'

  private config: TelegramConfig
  private bot: any = null // Telegraf instance (lazy imported)
  private connectionState: TelegramConnectionState = {
    status: 'disconnected',
  }
  private started = false
  private groupCreationTimestamps: number[] = []
  private autoCreatedGroupCount = 0

  constructor(config: TelegramConfig) {
    super()
    this.config = config
  }

  // =========================================================================
  // IChannelTransport Implementation
  // =========================================================================

  isConnected(): boolean {
    return this.connectionState.status === 'connected'
  }

  async sendMessage(
    chatId: string,
    content: string,
    options?: ChannelSendOptions,
  ): Promise<ChannelMessage> {
    if (!this.bot) throw new Error('Telegram bot not connected')

    const numericChatId = Number(chatId)
    const sendOptions: any = {}

    // Parse mode
    if (options?.parseMode) {
      sendOptions.parse_mode = options.parseMode
    }

    // Disable preview
    if (options?.disablePreview) {
      sendOptions.disable_web_page_preview = true
    }

    // Reply
    if (options?.replyToId) {
      sendOptions.reply_to_message_id = Number(options.replyToId)
    }

    // Inline keyboard
    if (options?.inlineKeyboard) {
      sendOptions.reply_markup = {
        inline_keyboard: options.inlineKeyboard.map((row) =>
          row.map((btn) => ({
            text: btn.text,
            ...(btn.callbackData ? { callback_data: btn.callbackData } : {}),
            ...(btn.url ? { url: btn.url } : {}),
          })),
        ),
      }
    }

    const result = await this.bot.telegram.sendMessage(numericChatId, content, sendOptions)

    const msg: ChannelMessage = {
      id: String(result.message_id),
      channel: 'telegram',
      chatId,
      senderId: String(result.from?.id ?? 'bot'),
      senderName: result.from?.username ?? 'Bot',
      content,
      timestamp: Date.now(),
      isFromMe: true,
      metadata: { telegramMessageId: result.message_id },
    }

    this.emit('message-sent', msg)
    return msg
  }

  async sendTypingIndicator(chatId: string): Promise<void> {
    if (!this.bot) return
    try {
      await this.bot.telegram.sendChatAction(Number(chatId), 'typing')
    } catch {
      // Non-critical
    }
  }

  getPrimaryNotificationChatId(): string | null {
    return this.config.primaryChatId ? String(this.config.primaryChatId) : null
  }

  // =========================================================================
  // Connection Lifecycle
  // =========================================================================

  async connect(): Promise<void> {
    if (this.started) return
    if (!this.config.botToken) {
      throw new Error('Telegram bot token not configured')
    }

    this.updateState({ status: 'connecting' })

    try {
      // Lazy import Telegraf
      const { Telegraf } = await import('telegraf')
      this.bot = new Telegraf(this.config.botToken)

      // Wire up message handlers
      this.wireHandlers()

      // Start polling
      if (this.config.useWebhook && this.config.webhookUrl) {
        await this.bot.telegram.setWebhook(this.config.webhookUrl)
        console.log(LOG, 'Webhook set:', this.config.webhookUrl)
      } else {
        // Use launch() for long polling
        this.bot.launch({
          dropPendingUpdates: true,
        })
      }

      // Get bot info
      const botInfo = await this.bot.telegram.getMe()
      this.updateState({
        status: 'connected',
        botUsername: botInfo.username,
        botId: botInfo.id,
        lastConnectedAt: Date.now(),
        error: undefined,
      })

      this.started = true
      console.log(LOG, `Connected as @${botInfo.username}`)
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      this.updateState({ status: 'error', error })
      console.error(LOG, 'Connection failed:', error)
      throw err
    }
  }

  async disconnect(): Promise<void> {
    if (this.bot) {
      try {
        this.bot.stop('disconnect')
      } catch {
        // Ignore cleanup errors
      }
      this.bot = null
    }
    this.started = false
    this.updateState({ status: 'disconnected' })
    console.log(LOG, 'Disconnected')
  }

  getConnectionState(): TelegramConnectionState {
    return { ...this.connectionState }
  }

  updateConfig(config: Partial<TelegramConfig>): void {
    this.config = { ...this.config, ...config }
  }

  getConfig(): TelegramConfig {
    return { ...this.config }
  }

  // =========================================================================
  // Inline Keyboard Helpers
  // =========================================================================

  /**
   * Send a message with an inline keyboard for approval gates.
   */
  async sendWithKeyboard(
    chatId: string,
    text: string,
    buttons: InlineKeyboardButton[][],
    parseMode?: 'Markdown' | 'HTML',
  ): Promise<ChannelMessage> {
    return this.sendMessage(chatId, text, {
      inlineKeyboard: buttons,
      parseMode,
    })
  }

  /**
   * Answer a callback query (acknowledge button press).
   */
  async answerCallbackQuery(queryId: string, text?: string): Promise<void> {
    if (!this.bot) return
    await this.bot.telegram.answerCbQuery(queryId, text)
  }

  /**
   * Edit the text of an existing message (e.g., after button press).
   */
  async editMessage(
    chatId: string,
    messageId: number,
    text: string,
    parseMode?: 'Markdown' | 'HTML',
  ): Promise<void> {
    if (!this.bot) return
    await this.bot.telegram.editMessageText(
      Number(chatId),
      messageId,
      undefined,
      text,
      parseMode ? { parse_mode: parseMode } : undefined,
    )
  }

  // =========================================================================
  // Multi-Group Routing
  // =========================================================================

  /**
   * Route a message to the appropriate group based on its category.
   * Finds the matching routing rule, resolves the target chat, and sends.
   */
  async routeByCategory(
    category: OutputCategory,
    content: string,
    options?: ChannelSendOptions,
  ): Promise<ChannelMessage | null> {
    const chatId = await this.ensureGroupForCategory(category)
    if (!chatId) {
      console.warn(LOG, `No chat found for category ${category}, message dropped`)
      return null
    }
    return this.sendMessage(chatId, content, options)
  }

  /**
   * Find or create the chat ID for a given output category.
   * Returns the fallback chat if no rule matches.
   */
  async ensureGroupForCategory(category: OutputCategory): Promise<string | null> {
    const rule = this.findRoutingRule(category)
    if (rule) {
      return rule.chatId
    }

    // Try auto-create if enabled
    if (this.config.autoCreateGroups) {
      const created = await this.autoCreateGroupForCategory(category)
      if (created) return created
    }

    // Fall back
    return this.config.fallbackChatId ?? this.getPrimaryNotificationChatId()
  }

  /**
   * Find the highest-priority enabled routing rule for a category.
   */
  private findRoutingRule(category: OutputCategory): TelegramRoutingRule | null {
    const rules = this.config.routingRules ?? []
    const matches = rules
      .filter((r) => {
        if (!r.enabled) return false
        const cats = Array.isArray(r.category) ? r.category : [r.category]
        return cats.includes(category)
      })
      .sort((a, b) => b.priority - a.priority)

    return matches[0] ?? null
  }

  /**
   * Attempt to auto-create a group for a category.
   * Telegram Bot API cannot create groups, so this emits a request event
   * and returns null. Rate-limited to 1 per hour, 10 total.
   */
  private async autoCreateGroupForCategory(category: OutputCategory): Promise<string | null> {
    const now = Date.now()
    const oneHourAgo = now - 3600_000

    // Rate limit: at most 1 creation per hour
    const recentCreations = this.groupCreationTimestamps.filter((t) => t > oneHourAgo)
    if (recentCreations.length >= 1) {
      console.warn(LOG, `Group creation rate limited (1/hr). Cannot create for ${category}`)
      return null
    }

    // Max total auto-created groups
    if (this.autoCreatedGroupCount >= 10) {
      console.warn(LOG, `Max auto-created groups (10) reached. Cannot create for ${category}`)
      return null
    }

    console.warn(
      LOG,
      `Telegram Bot API cannot create groups directly. Emitting 'group-creation-requested' for category: ${category}`,
    )
    this.groupCreationTimestamps.push(now)
    this.autoCreatedGroupCount++

    this.emit('group-creation-requested', { category, requestedAt: now })
    return null
  }

  /**
   * Get a copy of the current routing rules.
   */
  getRoutingRules(): TelegramRoutingRule[] {
    return [...(this.config.routingRules ?? [])]
  }

  /**
   * Add or update a routing rule. If a rule with the same ID exists, it is replaced.
   */
  upsertRoutingRule(rule: TelegramRoutingRule): void {
    const rules = this.config.routingRules ?? []
    const idx = rules.findIndex((r) => r.id === rule.id)
    if (idx >= 0) {
      rules[idx] = rule
    } else {
      rules.push(rule)
    }
    this.config.routingRules = rules
  }

  /**
   * Remove a routing rule by ID.
   */
  removeRoutingRule(ruleId: string): boolean {
    const rules = this.config.routingRules ?? []
    const idx = rules.findIndex((r) => r.id === ruleId)
    if (idx >= 0) {
      rules.splice(idx, 1)
      this.config.routingRules = rules
      return true
    }
    return false
  }

  // =========================================================================
  // Private - Handler Wiring
  // =========================================================================

  private wireHandlers(): void {
    if (!this.bot) return

    // Text messages
    this.bot.on('text', (ctx: any) => {
      const msg = ctx.message
      if (!msg) return

      // Check allowlists
      if (!this.isAllowed(msg.from?.id, msg.chat?.id)) {
        console.log(LOG, `Blocked message from user ${msg.from?.id} in chat ${msg.chat?.id}`)
        return
      }

      const channelMessage: ChannelMessage = {
        id: String(msg.message_id),
        channel: 'telegram',
        chatId: String(msg.chat.id),
        senderId: String(msg.from?.id ?? 'unknown'),
        senderName: msg.from?.first_name
          ? `${msg.from.first_name}${msg.from.last_name ? ' ' + msg.from.last_name : ''}`
          : msg.from?.username ?? 'Unknown',
        content: msg.text ?? '',
        timestamp: msg.date * 1000,
        isFromMe: false,
        replyToId: msg.reply_to_message
          ? String(msg.reply_to_message.message_id)
          : undefined,
        metadata: {
          chatType: msg.chat.type,
          chatTitle: msg.chat.title,
          telegramMessageId: msg.message_id,
          telegramUserId: msg.from?.id,
          telegramUsername: msg.from?.username,
        },
      }

      this.emit('message-received', channelMessage)
    })

    // Callback queries (inline keyboard button presses)
    this.bot.on('callback_query', (ctx: any) => {
      const query = ctx.callbackQuery
      if (!query?.data) return

      const cbQuery: TelegramCallbackQuery = {
        id: query.id,
        chatId: query.message?.chat?.id ?? 0,
        messageId: query.message?.message_id ?? 0,
        data: query.data,
        fromId: query.from?.id ?? 0,
        fromUsername: query.from?.username,
      }

      this.emit('callback-query', cbQuery)
    })

    // Error handling
    this.bot.catch((err: any) => {
      console.error(LOG, 'Bot error:', err)
    })
  }

  // =========================================================================
  // Private - Authorization
  // =========================================================================

  private isAllowed(userId?: number, chatId?: number): boolean {
    // If no allowlists configured, allow all
    if (
      this.config.allowedUserIds.length === 0 &&
      this.config.allowedChatIds.length === 0
    ) {
      return true
    }

    // Check user allowlist
    if (userId && this.config.allowedUserIds.length > 0) {
      if (this.config.allowedUserIds.includes(userId)) return true
    }

    // Check chat allowlist
    if (chatId && this.config.allowedChatIds.length > 0) {
      if (this.config.allowedChatIds.includes(chatId)) return true
    }

    // If only one list is configured, check just that one
    if (this.config.allowedUserIds.length === 0 && chatId) {
      return this.config.allowedChatIds.includes(chatId)
    }
    if (this.config.allowedChatIds.length === 0 && userId) {
      return this.config.allowedUserIds.includes(userId)
    }

    return false
  }

  // =========================================================================
  // Private - State Management
  // =========================================================================

  private updateState(partial: Partial<TelegramConnectionState>): void {
    this.connectionState = { ...this.connectionState, ...partial }
    this.emit('connection-update', this.getConnectionState())
  }
}

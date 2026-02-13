/**
 * ChannelRouterService - Unified Message Routing
 *
 * Routes messages between WhatsApp and Telegram channels.
 * Implements unified sendToAll(), cross-channel forwarding,
 * and skill-based routing rules.
 *
 * Emits:
 * - 'message-routed' when a message is sent to a channel
 * - 'cross-forward' when a message is forwarded between channels
 */

import { EventEmitter } from 'events'
import type {
  IChannelTransport,
  ChannelType,
  ChannelMessage,
  ChannelSendOptions,
  ChannelRouterConfig,
  InlineKeyboardButton,
  ChannelRoutingRule,
  OutputCategory,
} from '@shared/channel-types'

const LOG = '[ChannelRouter]'

const DEFAULT_ROUTER_CONFIG: ChannelRouterConfig = {
  defaultChannels: ['whatsapp', 'telegram'],
  crossChannelForwarding: false,
  rules: [],
  primaryNotificationChannel: 'whatsapp',
}

export class ChannelRouterService extends EventEmitter {
  private channels: Map<ChannelType, IChannelTransport> = new Map()
  private config: ChannelRouterConfig

  constructor(config?: Partial<ChannelRouterConfig>) {
    super()
    this.config = { ...DEFAULT_ROUTER_CONFIG, ...config }
  }

  // =========================================================================
  // Channel Registration
  // =========================================================================

  /**
   * Register a channel transport. Channels can be registered at any time.
   */
  registerChannel(transport: IChannelTransport): void {
    this.channels.set(transport.channelType, transport)
    console.log(LOG, `Registered channel: ${transport.channelType}`)
  }

  /**
   * Unregister a channel transport.
   */
  unregisterChannel(type: ChannelType): void {
    this.channels.delete(type)
    console.log(LOG, `Unregistered channel: ${type}`)
  }

  /**
   * Get a registered channel transport.
   */
  getChannel(type: ChannelType): IChannelTransport | undefined {
    return this.channels.get(type)
  }

  /**
   * Get all connected channels.
   */
  getConnectedChannels(): IChannelTransport[] {
    return Array.from(this.channels.values()).filter((c) => c.isConnected())
  }

  // =========================================================================
  // Message Sending
  // =========================================================================

  /**
   * Send a message to a specific channel and chat.
   */
  async sendToChannel(
    channelType: ChannelType,
    chatId: string,
    content: string,
    options?: ChannelSendOptions & { category?: OutputCategory; metadata?: Record<string, any> },
  ): Promise<ChannelMessage | null> {
    const channel = this.channels.get(channelType)
    if (!channel?.isConnected()) {
      console.warn(LOG, `Channel ${channelType} not connected, skipping`)
      return null
    }

    try {
      const msg = await channel.sendMessage(chatId, content, options)
      this.emit('message-routed', msg)
      return msg
    } catch (err) {
      console.error(LOG, `Failed to send to ${channelType}:`, err)
      return null
    }
  }

  /**
   * Send a message to all connected channels (broadcast).
   * Uses each channel's primary notification chat ID.
   * Supports routing rules via category.
   */
  async sendToAll(
    content: string,
    options?: ChannelSendOptions & { category?: OutputCategory; metadata?: Record<string, any> },
  ): Promise<ChannelMessage[]> {
    const results: ChannelMessage[] = []

    // Evaluate routing rules first
    const matchedRule = this.evaluateRules(content, options?.category)
    const targetChannels = matchedRule
      ? matchedRule.channels
      : this.config.defaultChannels

    for (const type of targetChannels) {
      const channel = this.channels.get(type)
      if (!channel?.isConnected()) continue

      const chatId = channel.getPrimaryNotificationChatId()
      if (!chatId) {
        console.warn(LOG, `No primary chat ID for ${type}, skipping`)
        continue
      }

      try {
        const msg = await channel.sendMessage(chatId, content, options)
        results.push(msg)
      } catch (err) {
        console.error(LOG, `Failed to broadcast to ${type}:`, err)
      }
    }

    return results
  }

  /**
   * Send a message to the primary notification channel.
   * Supports routing rules via category.
   */
  async sendNotification(
    content: string,
    options?: ChannelSendOptions & { category?: OutputCategory; metadata?: Record<string, any> },
  ): Promise<ChannelMessage | null> {
    // Evaluate routing rules first
    const matchedRule = this.evaluateRules(content, options?.category)

    // If rule matched, use its first channel; otherwise use primary notification channel
    const primaryType = matchedRule
      ? matchedRule.channels[0]
      : this.config.primaryNotificationChannel
    const channel = this.channels.get(primaryType)

    if (!channel?.isConnected()) {
      // Fallback to any connected channel
      for (const [, ch] of this.channels) {
        if (ch.isConnected()) {
          const chatId = ch.getPrimaryNotificationChatId()
          if (chatId) {
            return ch.sendMessage(chatId, content, options)
          }
        }
      }
      return null
    }

    const chatId = channel.getPrimaryNotificationChatId()
    if (!chatId) return null

    return channel.sendMessage(chatId, content, options)
  }

  /**
   * Send a message with inline approval buttons (Telegram-optimized,
   * falls back to text options for WhatsApp).
   */
  async sendApprovalRequest(
    channelType: ChannelType,
    chatId: string,
    text: string,
    options: Array<{ label: string; data: string }>,
  ): Promise<ChannelMessage | null> {
    const channel = this.channels.get(channelType)
    if (!channel?.isConnected()) return null

    if (channelType === 'telegram') {
      // Use inline keyboard for Telegram
      const keyboard: InlineKeyboardButton[][] = [
        options.map((opt) => ({
          text: opt.label,
          callbackData: opt.data,
        })),
      ]
      return channel.sendMessage(chatId, text, { inlineKeyboard: keyboard })
    } else {
      // For WhatsApp, append text-based options
      const optionsText = options
        .map((opt, i) => `${i + 1}. ${opt.label}`)
        .join('\n')
      return channel.sendMessage(chatId, `${text}\n\n${optionsText}\n\nReply with a number to choose.`)
    }
  }

  // =========================================================================
  // Cross-Channel Forwarding
  // =========================================================================

  /**
   * Forward a message from one channel to all other connected channels.
   */
  async forwardMessage(
    sourceMessage: ChannelMessage,
  ): Promise<ChannelMessage[]> {
    if (!this.config.crossChannelForwarding) return []

    const results: ChannelMessage[] = []
    const sourceChannel = sourceMessage.channel

    for (const [type, channel] of this.channels) {
      if (type === sourceChannel) continue
      if (!channel.isConnected()) continue

      const chatId = channel.getPrimaryNotificationChatId()
      if (!chatId) continue

      try {
        const prefix = sourceChannel === 'whatsapp' ? '[WA]' : '[TG]'
        const forwarded = await channel.sendMessage(
          chatId,
          `${prefix} ${sourceMessage.senderName}: ${sourceMessage.content}`,
        )
        results.push(forwarded)
        this.emit('cross-forward', {
          source: sourceChannel,
          target: type,
          messageId: sourceMessage.id,
        })
      } catch (err) {
        console.error(LOG, `Failed to forward to ${type}:`, err)
      }
    }

    return results
  }

  // =========================================================================
  // Status
  // =========================================================================

  /**
   * Get the status of all registered channels.
   */
  getStatus(): Record<
    ChannelType,
    { registered: boolean; connected: boolean; primaryChatId: string | null }
  > {
    const status: any = {}
    for (const type of ['whatsapp', 'telegram'] as ChannelType[]) {
      const channel = this.channels.get(type)
      status[type] = {
        registered: !!channel,
        connected: channel?.isConnected() ?? false,
        primaryChatId: channel?.getPrimaryNotificationChatId() ?? null,
      }
    }
    return status
  }

  updateConfig(config: Partial<ChannelRouterConfig>): void {
    this.config = { ...this.config, ...config }
  }

  getConfig(): ChannelRouterConfig {
    return { ...this.config }
  }

  // =========================================================================
  // Rule Evaluation (Private)
  // =========================================================================

  /**
   * Evaluate routing rules against a message and category.
   * Returns the first matching rule (sorted by priority, highest first).
   * Returns null if no rule matches.
   */
  private evaluateRules(message: string, category?: OutputCategory): ChannelRoutingRule | null {
    // Sort rules by priority (highest first)
    const sortedRules = [...this.config.rules].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))

    for (const rule of sortedRules) {
      // Match by category if provided
      if (rule.category && category && rule.category === category) {
        console.log(LOG, `Matched rule by category: ${category}`)
        return rule
      }

      // Match by pattern if provided (validate pattern to prevent ReDoS)
      if (rule.pattern) {
        try {
          if (rule.pattern.length <= 200 && new RegExp(rule.pattern).test(message)) {
            console.log(LOG, `Matched rule by pattern: ${rule.pattern}`)
            return rule
          }
        } catch {
          console.warn(LOG, `Invalid routing rule pattern: ${rule.pattern}`)
        }
      }
    }

    return null
  }
}

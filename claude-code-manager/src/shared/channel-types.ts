// src/shared/channel-types.ts
// Unified channel transport interfaces for WhatsApp + Telegram + future channels

// ============================================================
// Channel Transport Interface
// ============================================================

/** Supported messaging channels. */
export type ChannelType = 'whatsapp' | 'telegram'

/** Message output category for routing rules. */
export type OutputCategory =
  | 'bvs:notification'    // BVS phase completions, errors
  | 'bvs:approval'        // BVS approval requests
  | 'skill:output'        // Skill execution results
  | 'skill:digest'        // Daily digest output
  | 'agent:chat'          // General conversation
  | 'agent:error'         // Error notifications
  | 'system:heartbeat'    // Heartbeat/status pings
  | 'system:alert'        // Critical system alerts

/** A unified message across all channels. */
export interface ChannelMessage {
  id: string
  channel: ChannelType
  chatId: string // WhatsApp JID or Telegram chat ID
  senderId: string
  senderName: string
  content: string
  timestamp: number
  isFromMe: boolean
  /** Original channel-specific message data. */
  metadata?: Record<string, unknown>
  /** For replies - the message being replied to. */
  replyToId?: string
  /** Media attachments. */
  mediaUrl?: string
  mediaMimeType?: string
}

/** Options for sending a message through a channel. */
export interface ChannelSendOptions {
  /** Reply to a specific message. */
  replyToId?: string
  /** Inline keyboard buttons (Telegram only). */
  inlineKeyboard?: InlineKeyboardButton[][]
  /** Parse mode for formatting (Telegram: 'Markdown' | 'HTML'). */
  parseMode?: 'Markdown' | 'HTML'
  /** Disable link previews. */
  disablePreview?: boolean
}

/** Inline keyboard button for Telegram. */
export interface InlineKeyboardButton {
  text: string
  callbackData?: string
  url?: string
}

/**
 * IChannelTransport - Unified interface for messaging channels.
 * Both WhatsApp and Telegram services implement this interface.
 */
export interface IChannelTransport {
  /** Channel type identifier. */
  readonly channelType: ChannelType

  /** Whether the channel is currently connected. */
  isConnected(): boolean

  /** Send a text message to a chat. */
  sendMessage(chatId: string, content: string, options?: ChannelSendOptions): Promise<ChannelMessage>

  /** Send a typing indicator to a chat. */
  sendTypingIndicator(chatId: string): Promise<void>

  /** Get the primary notification chat ID (where alerts/digests go). */
  getPrimaryNotificationChatId(): string | null
}

// ============================================================
// Channel Router Types
// ============================================================

/** Routing rule for directing messages to channels. */
export interface ChannelRoutingRule {
  /** Pattern to match against message content or source. */
  pattern?: string
  /** Source skill ID. */
  skillId?: string
  /** Send to these channels. */
  channels: ChannelType[]
  /** If true, send to all connected channels. */
  broadcast?: boolean
  /** Message category to match. */
  category?: OutputCategory
  /** Priority for rule evaluation (higher = matches first). */
  priority?: number
}

/** Channel router configuration. */
export interface ChannelRouterConfig {
  /** Default channels for outbound messages. */
  defaultChannels: ChannelType[]
  /** Whether to forward messages between channels. */
  crossChannelForwarding: boolean
  /** Routing rules for specific message types. */
  rules: ChannelRoutingRule[]
  /** Primary notification channel. */
  primaryNotificationChannel: ChannelType
}

// ============================================================
// Telegram-Specific Types
// ============================================================

/** Telegram connection state. */
export type TelegramConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error'

export interface TelegramConnectionState {
  status: TelegramConnectionStatus
  botUsername?: string
  botId?: number
  error?: string
  lastConnectedAt?: number
}

/** Telegram bot configuration. */
export interface TelegramConfig {
  enabled: boolean
  botToken: string
  /** Allowed user IDs (empty = allow all). */
  allowedUserIds: number[]
  /** Allowed chat IDs (empty = allow all). */
  allowedChatIds: number[]
  /** Primary chat ID for notifications. */
  primaryChatId: number | null
  /** Whether to use webhook mode (vs polling). */
  useWebhook: boolean
  webhookUrl?: string
  /** Trigger pattern for group chats. */
  triggerPattern: string
  /** Routing rules for multi-group message routing. */
  routingRules: TelegramRoutingRule[]
  /** Whether to auto-create groups for unmatched categories. */
  autoCreateGroups: boolean
  /** Fallback chat ID when no routing rule matches. */
  fallbackChatId: string | null
}

/** Callback query from inline keyboard. */
export interface TelegramCallbackQuery {
  id: string
  chatId: number
  messageId: number
  data: string
  fromId: number
  fromUsername?: string
}

/** Telegram-specific routing rule for multi-group routing. */
export interface TelegramRoutingRule {
  id: string
  category: OutputCategory | OutputCategory[]
  chatId: string
  chatName?: string
  enabled: boolean
  priority: number
}

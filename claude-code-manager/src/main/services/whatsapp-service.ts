/**
 * WhatsAppService - Baileys WhatsApp Connection Service
 *
 * Manages the WhatsApp connection lifecycle using @whiskeysockets/baileys v7.
 * Responsibilities:
 * - Initialize Baileys socket with useMultiFileAuthState()
 * - Handle QR code generation and pairing code requests
 * - Manage connection lifecycle (connect, disconnect, reconnect with exponential backoff)
 * - Receive and route messages via messages.upsert event
 * - Store message metadata and conversation state via electron-store
 * - Send messages with rate limiting, typing indicators, and human-like delays
 * - Manage conversation registry (which chats the bot monitors)
 * - Debounce rapid inbound messages before emitting
 * - Handle media messages (download to temp, store path)
 * - Detect @mentions in group messages
 */

import { EventEmitter } from 'events'
import Store from 'electron-store'
import { app } from 'electron'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomBytes } from 'crypto'
import { mkdir, writeFile } from 'fs/promises'
import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  Browsers,
  downloadMediaMessage,
  type WASocket,
  type WAMessage,
  type WAMessageKey,
  type ConnectionState,
  type BaileysEventMap,
} from '@whiskeysockets/baileys'
import QRCode from 'qrcode'
import type { Boom } from '@hapi/boom'
import type {
  WhatsAppConnectionState,
  WhatsAppConnectionStatus,
  WhatsAppMessage,
  WhatsAppMessageType,
  WhatsAppConversation,
  WhatsAppChatType,
  WhatsAppConfig,
} from '@shared/whatsapp-types'
import type { ConfigStore } from './config-store'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum reconnection attempts before giving up. */
const MAX_RECONNECT_ATTEMPTS = 10

/** Base backoff intervals in ms: 5s, 10s, 20s, 40s, 80s. */
const BACKOFF_INTERVALS = [5000, 10000, 20000, 40000, 80000]

/** Rate limit cooldown when WhatsApp returns status 428 (connection closed / rate limited). */
const RATE_LIMIT_WAIT_MS = 60_000

/** Maximum messages stored per conversation. */
const MAX_MESSAGES_PER_CONVERSATION = 1000

/** Log prefix for all service messages. */
const LOG_PREFIX = '[WhatsAppService]'

// ---------------------------------------------------------------------------
// Persistence Stores
// ---------------------------------------------------------------------------

interface ConversationStoreSchema {
  conversations: Record<string, WhatsAppConversation>
}

interface MessageStoreSchema {
  messages: Record<string, WhatsAppMessage[]>
}

// ---------------------------------------------------------------------------
// WhatsAppService
// ---------------------------------------------------------------------------

export class WhatsAppService extends EventEmitter {
  private socket: WASocket | null = null
  private configStore: ConfigStore
  private conversationStore: Store<ConversationStoreSchema>
  private messageStore: Store<MessageStoreSchema>

  private connectionState: WhatsAppConnectionState = {
    status: 'disconnected',
    reconnectAttempt: 0,
  }

  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempts = 0

  // Rate limiting state
  private sentTimestamps: number[] = []

  // Debounce state: jid -> { timer, messages }
  private debounceMap: Map<
    string,
    { timer: ReturnType<typeof setTimeout>; messages: WhatsAppMessage[] }
  > = new Map()

  // Track saveCreds callback from useMultiFileAuthState
  private saveCreds: (() => Promise<void>) | null = null

  constructor(configStore: ConfigStore) {
    super()
    this.configStore = configStore

    this.conversationStore = new Store<ConversationStoreSchema>({
      name: 'whatsapp-conversations',
      defaults: { conversations: {} },
    })

    this.messageStore = new Store<MessageStoreSchema>({
      name: 'whatsapp-messages',
      defaults: { messages: {} },
    })
  }

  // =========================================================================
  // Connection Lifecycle
  // =========================================================================

  /**
   * Connect to WhatsApp via Baileys. Initialises auth state,
   * creates the socket, and wires up all event handlers.
   */
  async connect(): Promise<void> {
    if (this.socket) {
      console.log(LOG_PREFIX, 'Already connected or connecting, ignoring connect() call')
      return
    }

    const config = this.configStore.getWhatsAppConfig()
    this.updateConnectionState({ status: 'connecting', reconnectAttempt: this.reconnectAttempts })

    try {
      // Ensure auth directory exists
      await mkdir(config.authDir, { recursive: true })

      const { state, saveCreds } = await useMultiFileAuthState(config.authDir)
      this.saveCreds = saveCreds

      const { version } = await fetchLatestBaileysVersion()
      console.log(LOG_PREFIX, `Using Baileys version ${version.join('.')}`)

      this.socket = makeWASocket({
        auth: state,
        version,
        browser: Browsers.windows('Chrome'),
        printQRInTerminal: false,
        generateHighQualityLinkPreview: false,
        syncFullHistory: false,
      })

      this.wireSocketEvents()
      console.log(LOG_PREFIX, 'Socket created, waiting for connection...')
    } catch (err) {
      console.error(LOG_PREFIX, 'Failed to create socket:', err)
      this.updateConnectionState({
        status: 'disconnected',
        error: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  }

  /**
   * Gracefully disconnect from WhatsApp.
   */
  async disconnect(): Promise<void> {
    this.clearReconnectTimer()
    this.reconnectAttempts = 0

    if (this.socket) {
      try {
        this.socket.end(undefined)
      } catch {
        // Ignore errors during cleanup
      }
      this.socket = null
    }

    this.updateConnectionState({ status: 'disconnected', reconnectAttempt: 0 })
    console.log(LOG_PREFIX, 'Disconnected')
  }

  /**
   * Convenience method: returns true if the connection status is 'connected'.
   */
  isConnected(): boolean {
    return this.connectionState.status === 'connected'
  }

  /**
   * Returns the current connection state.
   */
  getConnectionState(): WhatsAppConnectionState {
    return { ...this.connectionState }
  }

  /**
   * Request a pairing code for a phone number instead of scanning a QR code.
   * The phone number should be in E.164 format without the + prefix (e.g. "1234567890").
   */
  async requestPairingCode(phoneNumber: string): Promise<string> {
    if (!this.socket) {
      throw new Error('Socket not initialised. Call connect() first.')
    }

    this.updateConnectionState({ status: 'pairing' })

    // Strip any leading + or whitespace
    const cleanNumber = phoneNumber.replace(/[+\s-]/g, '')
    const code = await this.socket.requestPairingCode(cleanNumber)
    this.updateConnectionState({ pairingCode: code })
    return code
  }

  // =========================================================================
  // Outbound Messages
  // =========================================================================

  /**
   * Send a text message to a conversation. Applies rate limiting, typing
   * indicator, and a random human-like delay (2-5 seconds).
   */
  async sendMessage(jid: string, content: string): Promise<WhatsAppMessage> {
    if (!this.socket) {
      throw new Error('Not connected to WhatsApp')
    }

    await this.enforceRateLimit()

    // Typing indicator
    await this.sendTypingIndicator(jid)

    // Human-like delay: 2000-5000ms
    const delay = 2000 + Math.floor(Math.random() * 3000)
    await this.sleep(delay)

    const config = this.configStore.getWhatsAppConfig()

    // Chunk message if it exceeds WhatsApp limit
    const chunks = this.chunkText(content, config.messageChunkLimit)
    let lastSentMsg: WAMessage | undefined

    for (const chunk of chunks) {
      lastSentMsg = await this.socket.sendMessage(jid, { text: chunk })
      if (chunks.length > 1) {
        // Small delay between chunks
        await this.sleep(500 + Math.floor(Math.random() * 1000))
      }
    }

    // Stop typing
    try {
      await this.socket.sendPresenceUpdate('paused', jid)
    } catch {
      // Non-critical
    }

    // Record in rate limit tracker
    this.sentTimestamps.push(Date.now())

    // Build WhatsAppMessage for storage and event
    const waMessage = this.buildOutboundMessage(jid, content, lastSentMsg)
    this.storeMessage(waMessage)
    this.emit('message-sent', waMessage)

    return waMessage
  }

  /**
   * Send a reaction emoji on a specific message.
   */
  async sendReaction(jid: string, messageKey: WAMessageKey, emoji: string): Promise<void> {
    if (!this.socket) {
      throw new Error('Not connected to WhatsApp')
    }

    await this.socket.sendMessage(jid, {
      react: { text: emoji, key: messageKey },
    })
  }

  /**
   * Send a "composing" typing indicator to a chat.
   */
  async sendTypingIndicator(jid: string): Promise<void> {
    if (!this.socket) return

    try {
      await this.socket.sendPresenceUpdate('composing', jid)
    } catch {
      // Non-critical — some chats may not support presence
    }
  }

  // =========================================================================
  // Message Retrieval
  // =========================================================================

  /**
   * Get stored messages for a conversation, optionally filtered by timestamp
   * and limited in count.
   */
  getMessages(jid: string, since?: number, limit?: number): WhatsAppMessage[] {
    const allMessages = this.messageStore.get('messages', {})
    let messages = allMessages[jid] ?? []

    if (since !== undefined) {
      messages = messages.filter((m) => m.timestamp >= since)
    }

    if (limit !== undefined && limit > 0) {
      messages = messages.slice(-limit)
    }

    return messages
  }

  // =========================================================================
  // Conversation Registry
  // =========================================================================

  /**
   * List all known conversations (both registered and unregistered).
   */
  listConversations(): WhatsAppConversation[] {
    const convos = this.conversationStore.get('conversations', {})
    return Object.values(convos).sort((a, b) => b.lastMessageAt - a.lastMessageAt)
  }

  /**
   * Get a single conversation by JID.
   */
  getConversation(jid: string): WhatsAppConversation | undefined {
    const convos = this.conversationStore.get('conversations', {})
    return convos[jid]
  }

  /**
   * Register a conversation so the bot actively monitors it. Merges provided
   * config with defaults.
   */
  registerConversation(
    jid: string,
    config: Partial<WhatsAppConversation>,
  ): WhatsAppConversation {
    const waConfig = this.configStore.getWhatsAppConfig()
    const existing = this.getConversation(jid)

    const conversation: WhatsAppConversation = {
      jid,
      name: config.name ?? existing?.name ?? jid,
      chatType: config.chatType ?? existing?.chatType ?? this.inferChatType(jid),
      lastMessageAt: config.lastMessageAt ?? existing?.lastMessageAt ?? Date.now(),
      unreadCount: config.unreadCount ?? existing?.unreadCount ?? 0,
      isRegistered: true,
      triggerPattern: config.triggerPattern ?? waConfig.defaultTriggerPattern,
      requiresTrigger: config.requiresTrigger ?? (this.inferChatType(jid) === 'group'),
      projectPath: config.projectPath ?? existing?.projectPath,
      agentMode: config.agentMode ?? waConfig.defaultAgentMode,
      sessionId: config.sessionId ?? existing?.sessionId,
      lastAgentResponseAt: config.lastAgentResponseAt ?? existing?.lastAgentResponseAt,
      metadata: config.metadata ?? existing?.metadata,
    }

    this.saveConversation(conversation)
    return conversation
  }

  /**
   * Unregister a conversation — the bot stops monitoring it.
   */
  unregisterConversation(jid: string): void {
    const convos = this.conversationStore.get('conversations', {})
    if (convos[jid]) {
      convos[jid] = { ...convos[jid], isRegistered: false }
      this.conversationStore.set('conversations', convos)
    }
  }

  /**
   * Update fields on an existing conversation.
   */
  updateConversation(
    jid: string,
    updates: Partial<WhatsAppConversation>,
  ): WhatsAppConversation {
    const convos = this.conversationStore.get('conversations', {})
    const existing = convos[jid]
    if (!existing) {
      throw new Error(`Conversation ${jid} not found`)
    }

    const updated: WhatsAppConversation = { ...existing, ...updates, jid }
    this.saveConversation(updated)
    return updated
  }

  // =========================================================================
  // Private — Socket Event Wiring
  // =========================================================================

  private wireSocketEvents(): void {
    if (!this.socket) return
    const sock = this.socket

    // --- Connection updates ---
    sock.ev.on('connection.update', (update: Partial<ConnectionState>) => {
      this.handleConnectionUpdate(update)
    })

    // --- Credential updates ---
    sock.ev.on('creds.update', async () => {
      if (this.saveCreds) {
        await this.saveCreds()
      }
    })

    // --- Use Baileys v7 process() for bufferable events ---
    sock.ev.process(async (events) => {
      const eventKeys = Object.keys(events)
      console.log(LOG_PREFIX, `[ev.process] Events received: ${eventKeys.join(', ')}`)

      // --- Incoming messages ---
      if (events['messages.upsert']) {
        const upsert = events['messages.upsert']
        console.log(LOG_PREFIX, `messages.upsert: type=${upsert.type}, count=${upsert.messages.length}`)
        for (const m of upsert.messages) {
          console.log(LOG_PREFIX, `  msg: from=${m.key.remoteJid}, fromMe=${m.key.fromMe}, id=${m.key.id}, hasMessage=${!!m.message}`)
        }
        this.handleMessagesUpsert(upsert)
      }

      // --- Chat updates ---
      if (events['chats.upsert']) {
        for (const chat of events['chats.upsert']) {
          if (chat.id) {
            this.ensureConversation(chat.id, chat.name || undefined)
          }
        }
      }

      // --- Contact updates ---
      if (events['contacts.upsert']) {
        for (const contact of events['contacts.upsert']) {
          if (contact.id) {
            this.ensureConversation(contact.id, contact.name ?? contact.notify ?? undefined)
          }
        }
      }
    })
  }

  // =========================================================================
  // Private — Connection Handling
  // =========================================================================

  private handleConnectionUpdate(update: Partial<ConnectionState>): void {
    const { connection, lastDisconnect, qr } = update
    console.log(LOG_PREFIX, 'Connection update:', JSON.stringify({ connection, hasQr: !!qr, qrLen: qr?.length, keys: Object.keys(update) }))

    if (qr) {
      console.log(LOG_PREFIX, 'QR code received, length:', qr.length)
      // Baileys emits raw QR text data - convert to a data URL for the renderer
      QRCode.toDataURL(qr, { width: 280, margin: 2 })
        .then((dataUrl: string) => {
          console.log(LOG_PREFIX, 'QR code converted to data URL, length:', dataUrl.length)
          this.updateConnectionState({ status: 'qr_ready', qrCode: dataUrl })
          this.emit('connection-update', this.connectionState)
          this.emit('qr-code', dataUrl)
        })
        .catch((err: Error) => {
          console.error(LOG_PREFIX, 'Failed to convert QR code:', err)
          // Fall back to raw string
          this.updateConnectionState({ status: 'qr_ready', qrCode: qr })
          this.emit('connection-update', this.connectionState)
          this.emit('qr-code', qr)
        })
    }

    if (connection === 'open') {
      this.reconnectAttempts = 0
      const phoneNumber = this.socket?.user?.id
      this.updateConnectionState({
        status: 'connected',
        phoneNumber: phoneNumber ?? undefined,
        lastConnectedAt: Date.now(),
        reconnectAttempt: 0,
        error: undefined,
        qrCode: undefined,
        pairingCode: undefined,
      })
      console.log(LOG_PREFIX, 'Connected successfully as', phoneNumber ?? 'unknown')
    }

    if (connection === 'close') {
      const boom = lastDisconnect?.error as Boom | undefined
      const statusCode = boom?.output?.statusCode ?? 0
      const reason = boom?.message ?? 'unknown'

      console.log(LOG_PREFIX, `Connection closed: status=${statusCode}, reason=${reason}`)
      this.socket = null

      this.handleDisconnect(statusCode, reason)
    }
  }

  private handleDisconnect(statusCode: number, reason: string): void {
    // Logged out — clear auth and require fresh scan
    if (statusCode === DisconnectReason.loggedOut) {
      console.log(LOG_PREFIX, 'Logged out — clearing auth state')
      this.updateConnectionState({
        status: 'logged_out',
        error: 'Logged out from WhatsApp. Please re-scan.',
        reconnectAttempt: 0,
      })
      this.emit('logged-out')
      return
    }

    // Restart required — immediate reconnect
    if (statusCode === DisconnectReason.restartRequired) {
      console.log(LOG_PREFIX, 'Restart required — reconnecting immediately')
      this.scheduleReconnect(0)
      return
    }

    // Rate limited (428 / connectionClosed) — wait 60s
    if (statusCode === DisconnectReason.connectionClosed) {
      console.log(LOG_PREFIX, `Rate limited (428) — waiting ${RATE_LIMIT_WAIT_MS / 1000}s`)
      this.scheduleReconnect(RATE_LIMIT_WAIT_MS)
      return
    }

    // Connection lost / timed out — exponential backoff
    if (
      statusCode === DisconnectReason.connectionLost ||
      statusCode === DisconnectReason.timedOut ||
      statusCode === DisconnectReason.badSession ||
      statusCode === DisconnectReason.unavailableService
    ) {
      if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        console.error(LOG_PREFIX, `Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached`)
        this.updateConnectionState({
          status: 'disconnected',
          error: `Reconnection failed after ${MAX_RECONNECT_ATTEMPTS} attempts: ${reason}`,
          reconnectAttempt: this.reconnectAttempts,
        })
        this.emit('reconnect-failed')
        return
      }

      const backoffIndex = Math.min(this.reconnectAttempts, BACKOFF_INTERVALS.length - 1)
      const backoffMs = BACKOFF_INTERVALS[backoffIndex]
      this.scheduleReconnect(backoffMs)
      return
    }

    // Forbidden or other unrecoverable errors
    console.error(LOG_PREFIX, `Unrecoverable disconnect: status=${statusCode}, reason=${reason}`)
    this.updateConnectionState({
      status: 'disconnected',
      error: `Disconnected (${statusCode}): ${reason}`,
    })
  }

  private scheduleReconnect(delayMs: number): void {
    this.clearReconnectTimer()
    this.reconnectAttempts++
    this.updateConnectionState({
      status: 'reconnecting',
      reconnectAttempt: this.reconnectAttempts,
      error: undefined,
    })

    console.log(
      LOG_PREFIX,
      `Scheduling reconnect attempt ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} in ${delayMs}ms`,
    )

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.connect()
      } catch (err) {
        console.error(LOG_PREFIX, 'Reconnect attempt failed:', err)
      }
    }, delayMs)
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  // =========================================================================
  // Private — Message Handling
  // =========================================================================

  private handleMessagesUpsert(upsert: BaileysEventMap['messages.upsert']): void {
    const { messages, type } = upsert
    if (type !== 'notify') return // Only process real-time notifications

    for (const raw of messages) {
      // Skip protocol messages (status updates, reactions handled elsewhere)
      if (!raw.message) continue
      if (raw.key.remoteJid === 'status@broadcast') continue

      const waMessage = this.convertInboundMessage(raw)
      if (!waMessage) continue

      // Store the message
      this.storeMessage(waMessage)

      // Update conversation metadata
      this.ensureConversation(waMessage.conversationJid, waMessage.senderName)

      const convos = this.conversationStore.get('conversations', {})
      const convo = convos[waMessage.conversationJid]
      if (convo) {
        convo.lastMessageAt = waMessage.timestamp
        if (!waMessage.isFromMe) {
          convo.unreadCount = (convo.unreadCount || 0) + 1
        }
        this.saveConversation(convo)
      }

      // Handle media download if applicable
      if (this.isMediaMessage(raw) && convo?.isRegistered) {
        this.downloadAndStoreMedia(raw, waMessage).catch((err) => {
          console.error(LOG_PREFIX, 'Media download failed:', err)
        })
      }

      // Debounce inbound messages for registered conversations
      // For self-chat: treat fromMe messages as inbound (user talking to themselves)
      const isSelfChat = convo?.chatType === 'self'
      const shouldDebounce = convo?.isRegistered && (!waMessage.isFromMe || isSelfChat)
      console.log(LOG_PREFIX, `[MSG-ROUTE] jid=${waMessage.conversationJid}, isFromMe=${waMessage.isFromMe}, isSelfChat=${isSelfChat}, isRegistered=${convo?.isRegistered}, shouldDebounce=${shouldDebounce}, content="${waMessage.content.substring(0, 50)}"`)
      if (shouldDebounce) {
        this.debounceMessage(waMessage)
      } else {
        console.log(LOG_PREFIX, `[MSG-ROUTE] Emitting message-received directly`)
        this.emit('message-received', waMessage)
      }
    }
  }

  /**
   * Convert a Baileys WAMessage into our WhatsAppMessage type.
   */
  private convertInboundMessage(raw: WAMessage): WhatsAppMessage | null {
    const jid = raw.key.remoteJid
    if (!jid) return null

    const msg = raw.message
    if (!msg) return null

    const isFromMe = raw.key.fromMe ?? false
    const senderJid = isFromMe
      ? (this.socket?.user?.id ?? 'me')
      : (raw.key.participant ?? jid)

    const { type, content } = this.extractMessageContent(msg)
    const mentionedJids = this.extractMentions(msg)

    return {
      id: raw.key.id ?? randomBytes(8).toString('hex'),
      conversationJid: jid,
      senderJid,
      senderName: raw.pushName ?? senderJid,
      direction: isFromMe ? 'outbound' : 'inbound',
      type,
      content,
      quotedMessageId: this.extractQuotedMessageId(msg),
      mentionedJids: mentionedJids.length > 0 ? mentionedJids : undefined,
      timestamp: (raw.messageTimestamp as number) ? (raw.messageTimestamp as number) * 1000 : Date.now(),
      isFromMe,
      isProcessed: false,
      metadata: {
        baileysMessageKey: raw.key,
      },
    }
  }

  /**
   * Extract text content and message type from a Baileys proto.IMessage.
   */
  private extractMessageContent(
    msg: NonNullable<WAMessage['message']>,
  ): { type: WhatsAppMessageType; content: string } {
    // Text message
    if (msg.conversation) {
      return { type: 'text', content: msg.conversation }
    }

    // Extended text message (rich text, links, replies)
    if (msg.extendedTextMessage) {
      return { type: 'text', content: msg.extendedTextMessage.text ?? '' }
    }

    // Image
    if (msg.imageMessage) {
      return { type: 'image', content: msg.imageMessage.caption ?? '[Image]' }
    }

    // Video
    if (msg.videoMessage) {
      return { type: 'video', content: msg.videoMessage.caption ?? '[Video]' }
    }

    // Audio / voice note
    if (msg.audioMessage) {
      return { type: 'audio', content: '[Audio message]' }
    }

    // Document
    if (msg.documentMessage) {
      return {
        type: 'document',
        content: msg.documentMessage.fileName ?? '[Document]',
      }
    }

    // Location
    if (msg.locationMessage) {
      const lat = msg.locationMessage.degreesLatitude ?? 0
      const lon = msg.locationMessage.degreesLongitude ?? 0
      return { type: 'location', content: `Location: ${lat}, ${lon}` }
    }

    // Contact
    if (msg.contactMessage) {
      return {
        type: 'contact',
        content: msg.contactMessage.displayName ?? '[Contact]',
      }
    }

    // Poll
    if (msg.pollCreationMessage) {
      return {
        type: 'poll',
        content: msg.pollCreationMessage.name ?? '[Poll]',
      }
    }

    // Reaction
    if (msg.reactionMessage) {
      return {
        type: 'reaction',
        content: msg.reactionMessage.text ?? '',
      }
    }

    // Fallback
    return { type: 'text', content: '[Unsupported message type]' }
  }

  /**
   * Extract @mentioned JIDs from a message. Works for both extended text
   * messages (contextInfo.mentionedJid) and plain conversation messages.
   */
  private extractMentions(msg: NonNullable<WAMessage['message']>): string[] {
    const contextInfo =
      msg.extendedTextMessage?.contextInfo ??
      msg.imageMessage?.contextInfo ??
      msg.videoMessage?.contextInfo ??
      msg.documentMessage?.contextInfo

    return (contextInfo?.mentionedJid ?? []) as string[]
  }

  /**
   * Extract the quoted message ID if this is a reply.
   */
  private extractQuotedMessageId(msg: NonNullable<WAMessage['message']>): string | undefined {
    const contextInfo =
      msg.extendedTextMessage?.contextInfo ??
      msg.imageMessage?.contextInfo ??
      msg.videoMessage?.contextInfo

    return contextInfo?.stanzaId ?? undefined
  }

  /**
   * Detect whether a Baileys message contains downloadable media.
   */
  private isMediaMessage(raw: WAMessage): boolean {
    const msg = raw.message
    if (!msg) return false
    return !!(
      msg.imageMessage ||
      msg.videoMessage ||
      msg.audioMessage ||
      msg.documentMessage
    )
  }

  /**
   * Download media from a Baileys message and save to a temp directory.
   * Updates the stored WhatsAppMessage with the local file path.
   */
  private async downloadAndStoreMedia(
    raw: WAMessage,
    waMessage: WhatsAppMessage,
  ): Promise<void> {
    try {
      const buffer = await downloadMediaMessage(raw, 'buffer', {})

      const mediaDir = join(tmpdir(), 'whatsapp-media')
      await mkdir(mediaDir, { recursive: true })

      const ext = this.getMediaExtension(raw)
      const filename = `${waMessage.id}${ext}`
      const filePath = join(mediaDir, filename)

      await writeFile(filePath, buffer as Buffer)

      // Update the stored message with the local media path
      waMessage.mediaUrl = filePath
      waMessage.mediaMimeType = this.getMediaMimeType(raw)

      // Re-store updated message
      this.storeMessage(waMessage)
      console.log(LOG_PREFIX, `Media saved: ${filePath}`)
    } catch (err) {
      console.error(LOG_PREFIX, 'Failed to download media:', err)
    }
  }

  private getMediaExtension(raw: WAMessage): string {
    const msg = raw.message
    if (!msg) return ''
    if (msg.imageMessage) return '.jpg'
    if (msg.videoMessage) return '.mp4'
    if (msg.audioMessage) return msg.audioMessage.ptt ? '.ogg' : '.mp3'
    if (msg.documentMessage) {
      const fname = msg.documentMessage.fileName ?? ''
      const dotIndex = fname.lastIndexOf('.')
      return dotIndex >= 0 ? fname.slice(dotIndex) : ''
    }
    return ''
  }

  private getMediaMimeType(raw: WAMessage): string | undefined {
    const msg = raw.message
    if (!msg) return undefined
    if (msg.imageMessage) return msg.imageMessage.mimetype ?? 'image/jpeg'
    if (msg.videoMessage) return msg.videoMessage.mimetype ?? 'video/mp4'
    if (msg.audioMessage) return msg.audioMessage.mimetype ?? 'audio/ogg'
    if (msg.documentMessage) return msg.documentMessage.mimetype ?? 'application/octet-stream'
    return undefined
  }

  // =========================================================================
  // Private — Debouncing
  // =========================================================================

  /**
   * Debounce inbound messages: accumulate messages from the same conversation,
   * wait for `debounceMs` of silence, then emit the batch.
   */
  private debounceMessage(message: WhatsAppMessage): void {
    const config = this.configStore.getWhatsAppConfig()
    const jid = message.conversationJid
    const existing = this.debounceMap.get(jid)

    if (existing) {
      clearTimeout(existing.timer)
      existing.messages.push(message)
    } else {
      this.debounceMap.set(jid, { timer: null as unknown as ReturnType<typeof setTimeout>, messages: [message] })
    }

    const entry = this.debounceMap.get(jid)!
    entry.timer = setTimeout(() => {
      const batch = entry.messages
      this.debounceMap.delete(jid)

      // Emit all accumulated messages as individual events
      for (const msg of batch) {
        this.emit('message-received', msg)
      }

      // Also emit a batch event for agent processing
      this.emit('messages-batch', jid, batch)
    }, config.debounceMs)
  }

  // =========================================================================
  // Private — Rate Limiting
  // =========================================================================

  /**
   * Enforce outbound rate limiting. Waits if the per-minute limit has been
   * reached, then returns.
   */
  private async enforceRateLimit(): Promise<void> {
    const config = this.configStore.getWhatsAppConfig()
    const limit = config.rateLimitPerMinute
    const now = Date.now()
    const oneMinuteAgo = now - 60_000

    // Prune old timestamps
    this.sentTimestamps = this.sentTimestamps.filter((t) => t > oneMinuteAgo)

    if (this.sentTimestamps.length >= limit) {
      // Calculate how long to wait until the oldest relevant timestamp expires
      const oldestRelevant = this.sentTimestamps[0]
      const waitMs = oldestRelevant + 60_000 - now + 100 // +100ms buffer
      console.log(LOG_PREFIX, `Rate limit reached (${limit}/min), waiting ${waitMs}ms`)
      await this.sleep(waitMs)

      // Prune again after waiting
      this.sentTimestamps = this.sentTimestamps.filter((t) => t > Date.now() - 60_000)
    }
  }

  // =========================================================================
  // Private — Conversation Persistence
  // =========================================================================

  /**
   * Ensure a conversation entry exists. Creates one with defaults if missing.
   */
  private ensureConversation(jid: string, name?: string): void {
    const convos = this.conversationStore.get('conversations', {})
    if (!convos[jid]) {
      const chatType = this.inferChatType(jid)
      const config = this.configStore.getWhatsAppConfig()

      convos[jid] = {
        jid,
        name: name ?? jid,
        chatType,
        lastMessageAt: Date.now(),
        unreadCount: 0,
        isRegistered: false,
        triggerPattern: config.defaultTriggerPattern,
        requiresTrigger: chatType === 'group',
        agentMode: config.defaultAgentMode,
      }
      this.conversationStore.set('conversations', convos)
    } else if (name && convos[jid].name !== name) {
      convos[jid].name = name
      this.conversationStore.set('conversations', convos)
    }
  }

  private saveConversation(conversation: WhatsAppConversation): void {
    const convos = this.conversationStore.get('conversations', {})
    convos[conversation.jid] = conversation
    this.conversationStore.set('conversations', convos)
  }

  /**
   * Infer chat type from JID format:
   * - *@g.us → group
   * - *@s.whatsapp.net with user's own ID → self
   * - *@s.whatsapp.net → dm
   */
  private inferChatType(jid: string): WhatsAppChatType {
    if (jid.endsWith('@g.us')) return 'group'

    // Check if this is a self-chat
    const myJid = this.socket?.user?.id
    if (myJid && jid === myJid) return 'self'
    // Also handle normalized JIDs
    if (myJid) {
      const myNumber = myJid.split('@')[0].split(':')[0]
      const jidNumber = jid.split('@')[0].split(':')[0]
      if (myNumber === jidNumber) return 'self'
    }

    return 'dm'
  }

  // =========================================================================
  // Private — Message Persistence
  // =========================================================================

  /**
   * Store a message, maintaining a per-conversation ring buffer of MAX_MESSAGES_PER_CONVERSATION.
   */
  private storeMessage(message: WhatsAppMessage): void {
    const allMessages = this.messageStore.get('messages', {})
    const jid = message.conversationJid

    if (!allMessages[jid]) {
      allMessages[jid] = []
    }

    // Check if this message already exists (update it)
    const existingIdx = allMessages[jid].findIndex((m) => m.id === message.id)
    if (existingIdx >= 0) {
      allMessages[jid][existingIdx] = message
    } else {
      allMessages[jid].push(message)
    }

    // Trim to max
    if (allMessages[jid].length > MAX_MESSAGES_PER_CONVERSATION) {
      allMessages[jid] = allMessages[jid].slice(-MAX_MESSAGES_PER_CONVERSATION)
    }

    this.messageStore.set('messages', allMessages)
  }

  // =========================================================================
  // Private — Outbound Message Building
  // =========================================================================

  private buildOutboundMessage(
    jid: string,
    content: string,
    raw?: WAMessage,
  ): WhatsAppMessage {
    return {
      id: raw?.key.id ?? randomBytes(8).toString('hex'),
      conversationJid: jid,
      senderJid: this.socket?.user?.id ?? 'me',
      senderName: 'Assistant',
      direction: 'outbound',
      type: 'text',
      content,
      timestamp: Date.now(),
      isFromMe: true,
      isProcessed: true,
    }
  }

  // =========================================================================
  // Private — Helpers
  // =========================================================================

  private updateConnectionState(
    partial: Partial<WhatsAppConnectionState>,
  ): void {
    this.connectionState = { ...this.connectionState, ...partial }
    this.emit('connection-update', this.getConnectionState())
  }

  /**
   * Split text into chunks respecting a maximum character limit. Tries to
   * break at newlines, then sentence boundaries, then word boundaries.
   */
  private chunkText(text: string, maxLength: number): string[] {
    if (text.length <= maxLength) return [text]

    const chunks: string[] = []
    let remaining = text

    while (remaining.length > 0) {
      if (remaining.length <= maxLength) {
        chunks.push(remaining)
        break
      }

      // Try to find a good break point
      let breakPoint = remaining.lastIndexOf('\n', maxLength)
      if (breakPoint <= maxLength * 0.5) {
        breakPoint = remaining.lastIndexOf('. ', maxLength)
      }
      if (breakPoint <= maxLength * 0.5) {
        breakPoint = remaining.lastIndexOf(' ', maxLength)
      }
      if (breakPoint <= 0) {
        breakPoint = maxLength
      }

      chunks.push(remaining.slice(0, breakPoint))
      remaining = remaining.slice(breakPoint).trimStart()
    }

    return chunks
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

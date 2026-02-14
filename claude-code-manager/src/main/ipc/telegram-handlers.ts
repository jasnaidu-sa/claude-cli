/**
 * IPC Handlers for Telegram Bot and Channel Router
 *
 * Bridges renderer <-> main process for Telegram connection,
 * messaging, config, and channel routing.
 */

import { ipcMain, BrowserWindow } from 'electron'
import { TELEGRAM_IPC_CHANNELS } from '@shared/telegram-ipc-channels'
import type { TelegramService } from '../services/telegram-service'
import type { ChannelRouterService } from '../services/channel-router-service'
import type { ChannelUxService } from '../services/channel-ux-service'
import type { ConfigStore } from '../services/config-store'
import type { TelegramConfig, ChannelType } from '@shared/channel-types'

const LOG = '[Telegram-IPC]'

function sendToAllWindows(channel: string, data: unknown): void {
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, data)
    }
  })
}

export function registerTelegramHandlers(
  telegramService: TelegramService,
  channelRouter: ChannelRouterService,
  configStore: ConfigStore,
  channelUxService?: ChannelUxService | null,
): void {
  // Remove any fallback handlers registered before Telegram was configured
  for (const channel of Object.values(TELEGRAM_IPC_CHANNELS)) {
    try { ipcMain.removeHandler(channel) } catch { /* not registered */ }
  }

  // ========================================================================
  // Connection
  // ========================================================================

  ipcMain.handle(TELEGRAM_IPC_CHANNELS.TELEGRAM_CONNECT, async () => {
    try {
      console.log(LOG, 'Connecting...')
      await telegramService.connect()
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(LOG, 'Connect failed:', message)
      return { success: false, error: message }
    }
  })

  ipcMain.handle(TELEGRAM_IPC_CHANNELS.TELEGRAM_DISCONNECT, async () => {
    try {
      console.log(LOG, 'Disconnecting...')
      await telegramService.disconnect()
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { success: false, error: message }
    }
  })

  ipcMain.handle(TELEGRAM_IPC_CHANNELS.TELEGRAM_GET_STATUS, async () => {
    try {
      const state = telegramService.getConnectionState()
      return { success: true, data: state }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { success: false, error: message }
    }
  })

  // ========================================================================
  // Messages
  // ========================================================================

  ipcMain.handle(
    TELEGRAM_IPC_CHANNELS.TELEGRAM_SEND_MESSAGE,
    async (_event, chatId: string, content: string) => {
      try {
        const msg = await telegramService.sendMessage(chatId, content)
        return { success: true, data: msg }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { success: false, error: message }
      }
    },
  )

  // ========================================================================
  // Config
  // ========================================================================

  ipcMain.handle(TELEGRAM_IPC_CHANNELS.TELEGRAM_CONFIG_GET, async () => {
    try {
      const config = telegramService.getConfig()
      return { success: true, data: config }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { success: false, error: message }
    }
  })

  ipcMain.handle(
    TELEGRAM_IPC_CHANNELS.TELEGRAM_CONFIG_SET,
    async (_event, config: Partial<TelegramConfig>) => {
      try {
        telegramService.updateConfig(config)
        return { success: true }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { success: false, error: message }
      }
    },
  )

  // ========================================================================
  // Callback Queries (Inline Keyboards)
  // ========================================================================

  ipcMain.handle(
    TELEGRAM_IPC_CHANNELS.TELEGRAM_ANSWER_CALLBACK,
    async (_event, queryId: string, text?: string) => {
      try {
        await telegramService.answerCallbackQuery(queryId, text)
        return { success: true }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { success: false, error: message }
      }
    },
  )

  // ========================================================================
  // Channel Router
  // ========================================================================

  ipcMain.handle(TELEGRAM_IPC_CHANNELS.CHANNEL_ROUTER_STATUS, async () => {
    try {
      const status = channelRouter.getStatus()
      return { success: true, data: status }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { success: false, error: message }
    }
  })

  ipcMain.handle(
    TELEGRAM_IPC_CHANNELS.CHANNEL_ROUTER_SEND,
    async (_event, channelType: string, chatId: string, content: string) => {
      try {
        const msg = await channelRouter.sendToChannel(
          channelType as any,
          chatId,
          content,
        )
        return { success: true, data: msg }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { success: false, error: message }
      }
    },
  )

  ipcMain.handle(
    TELEGRAM_IPC_CHANNELS.CHANNEL_ROUTER_SEND_ALL,
    async (_event, content: string) => {
      try {
        const msgs = await channelRouter.sendToAll(content)
        return { success: true, data: msgs }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { success: false, error: message }
      }
    },
  )

  // ========================================================================
  // Event Forwarding (main -> renderer)
  // ========================================================================

  telegramService.on('connection-update', (state) => {
    sendToAllWindows(TELEGRAM_IPC_CHANNELS.TELEGRAM_CONNECTION_UPDATE, state)
  })

  telegramService.on('message-received', (msg) => {
    sendToAllWindows(TELEGRAM_IPC_CHANNELS.TELEGRAM_MESSAGE_RECEIVED, msg)
  })

  telegramService.on('message-sent', (msg) => {
    sendToAllWindows(TELEGRAM_IPC_CHANNELS.TELEGRAM_MESSAGE_SENT, msg)
  })

  telegramService.on('callback-query', (query) => {
    sendToAllWindows(TELEGRAM_IPC_CHANNELS.TELEGRAM_CALLBACK_QUERY, query)
  })

  console.log(LOG, 'All Telegram IPC handlers registered')
}

/**
 * Register IPC handlers for the Enhanced Channel UX service.
 * Called separately because ChannelUxService is initialized after Telegram handlers.
 */
export function registerChannelUxHandlers(
  channelUxService: ChannelUxService,
): void {
  ipcMain.handle(
    TELEGRAM_IPC_CHANNELS.CHANNEL_UX_SEND_APPROVAL,
    async (_event, channel: ChannelType, chatId: string, title: string, description: string, options: any[]) => {
      try {
        const requestId = await channelUxService.sendApprovalRequest(channel, chatId, title, description, options)
        return { success: true, data: { requestId } }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { success: false, error: message }
      }
    },
  )

  ipcMain.handle(
    TELEGRAM_IPC_CHANNELS.CHANNEL_UX_GET_APPROVAL_STATUS,
    async (_event, requestId: string) => {
      try {
        const status = channelUxService.getApprovalStatus(requestId)
        return { success: true, data: status }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { success: false, error: message }
      }
    },
  )

  ipcMain.handle(
    TELEGRAM_IPC_CHANNELS.CHANNEL_UX_CREATE_PROGRESS,
    async (_event, channel: ChannelType, chatId: string, title: string, total: number, phases?: string[]) => {
      try {
        const progressId = await channelUxService.createProgressBar(channel, chatId, title, total, phases)
        return { success: true, data: { progressId } }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { success: false, error: message }
      }
    },
  )

  ipcMain.handle(
    TELEGRAM_IPC_CHANNELS.CHANNEL_UX_UPDATE_PROGRESS,
    async (_event, progressId: string, current: number, currentPhase?: string) => {
      try {
        await channelUxService.updateProgress(progressId, current, currentPhase)
        return { success: true }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { success: false, error: message }
      }
    },
  )

  ipcMain.handle(
    TELEGRAM_IPC_CHANNELS.CHANNEL_UX_COMPLETE_PROGRESS,
    async (_event, progressId: string, status: 'completed' | 'failed') => {
      try {
        await channelUxService.completeProgress(progressId, status)
        return { success: true }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { success: false, error: message }
      }
    },
  )

  ipcMain.handle(
    TELEGRAM_IPC_CHANNELS.CHANNEL_UX_SEND_NOTIFICATION,
    async (_event, title: string, body: string, urgency: 'low' | 'medium' | 'high') => {
      try {
        await channelUxService.sendNotification(title, body, urgency)
        return { success: true }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { success: false, error: message }
      }
    },
  )

  ipcMain.handle(TELEGRAM_IPC_CHANNELS.CHANNEL_UX_FORWARD_CONFIG_GET, async () => {
    try {
      return { success: true, data: channelUxService.getForwardConfig() }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { success: false, error: message }
    }
  })

  ipcMain.handle(
    TELEGRAM_IPC_CHANNELS.CHANNEL_UX_FORWARD_CONFIG_SET,
    async (_event, config: any) => {
      try {
        channelUxService.updateForwardConfig(config)
        return { success: true }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { success: false, error: message }
      }
    },
  )

  // Forward channel UX events to renderer
  channelUxService.on('approval-response', (data) => {
    sendToAllWindows(TELEGRAM_IPC_CHANNELS.CHANNEL_UX_APPROVAL_RESPONSE, data)
  })

  channelUxService.on('progress-update', (data) => {
    sendToAllWindows(TELEGRAM_IPC_CHANNELS.CHANNEL_UX_PROGRESS_UPDATE, data)
  })

  console.log(LOG, 'Channel UX IPC handlers registered')
}

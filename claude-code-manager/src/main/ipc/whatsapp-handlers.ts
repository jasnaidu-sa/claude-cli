/**
 * IPC Handlers for WhatsApp AI Assistant
 *
 * Bridges renderer <-> main process for WhatsApp connection, messaging,
 * agent control, memory search, task scheduling, heartbeat, and identity.
 */

import { ipcMain, BrowserWindow } from 'electron'
import { WHATSAPP_IPC_CHANNELS } from '@shared/whatsapp-ipc-channels'
import type { WhatsAppService } from '../services/whatsapp-service'
import type { WhatsAppAgentService } from '../services/whatsapp-agent-service'
import type { VectorMemoryService } from '../services/vector-memory-service'
import type { TaskSchedulerService } from '../services/task-scheduler-service'
import type { HeartbeatService } from '../services/heartbeat-service'
import type { AgentIdentityService } from '../services/agent-identity-service'
import type { ConfigStore } from '../services/config-store'
import type {
  WhatsAppConversation,
  WhatsAppAgentMode,
  MemorySearchOptions,
  MemorySource,
  TaskStatus,
  ScheduledTask,
} from '@shared/whatsapp-types'

const LOG = '[WhatsApp-IPC]'

function sendToAllWindows(channel: string, data: unknown): void {
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, data)
    }
  })
}

export function registerWhatsAppHandlers(
  whatsappService: WhatsAppService,
  agentService: WhatsAppAgentService,
  memoryService: VectorMemoryService,
  schedulerService: TaskSchedulerService,
  heartbeatService: HeartbeatService,
  identityService: AgentIdentityService,
  configStoreRef: ConfigStore
): void {
  // ========================================================================
  // Connection
  // ========================================================================

  ipcMain.handle(WHATSAPP_IPC_CHANNELS.WHATSAPP_CONNECT, async () => {
    try {
      console.log(LOG, 'Connecting...')
      await whatsappService.connect()
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(LOG, 'Connect failed:', message)
      return { success: false, error: message }
    }
  })

  ipcMain.handle(WHATSAPP_IPC_CHANNELS.WHATSAPP_DISCONNECT, async () => {
    try {
      console.log(LOG, 'Disconnecting...')
      await whatsappService.disconnect()
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(LOG, 'Disconnect failed:', message)
      return { success: false, error: message }
    }
  })

  ipcMain.handle(WHATSAPP_IPC_CHANNELS.WHATSAPP_GET_STATUS, async () => {
    try {
      const state = whatsappService.getConnectionState()
      return { success: true, data: state }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { success: false, error: message }
    }
  })

  ipcMain.handle(
    WHATSAPP_IPC_CHANNELS.WHATSAPP_REQUEST_PAIRING_CODE,
    async (_event, phoneNumber: string) => {
      try {
        console.log(LOG, 'Requesting pairing code for:', phoneNumber)
        const code = await whatsappService.requestPairingCode(phoneNumber)
        return { success: true, data: code }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(LOG, 'Pairing code request failed:', message)
        return { success: false, error: message }
      }
    }
  )

  // ========================================================================
  // Messages
  // ========================================================================

  ipcMain.handle(
    WHATSAPP_IPC_CHANNELS.WHATSAPP_SEND_MESSAGE,
    async (_event, jid: string, content: string) => {
      try {
        const msg = await whatsappService.sendMessage(jid, content)
        return { success: true, data: msg }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(LOG, 'Send message failed:', message)
        return { success: false, error: message }
      }
    }
  )

  ipcMain.handle(
    WHATSAPP_IPC_CHANNELS.WHATSAPP_GET_MESSAGES,
    async (_event, jid: string, since?: number, limit?: number) => {
      try {
        const messages = whatsappService.getMessages(jid, since, limit)
        return { success: true, data: messages }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { success: false, error: message }
      }
    }
  )

  // ========================================================================
  // Conversations
  // ========================================================================

  ipcMain.handle(WHATSAPP_IPC_CHANNELS.WHATSAPP_LIST_CONVERSATIONS, async () => {
    try {
      const conversations = whatsappService.listConversations()
      return { success: true, data: conversations }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { success: false, error: message }
    }
  })

  ipcMain.handle(
    WHATSAPP_IPC_CHANNELS.WHATSAPP_GET_CONVERSATION,
    async (_event, jid: string) => {
      try {
        const conversation = whatsappService.getConversation(jid)
        return { success: true, data: conversation ?? null }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { success: false, error: message }
      }
    }
  )

  ipcMain.handle(
    WHATSAPP_IPC_CHANNELS.WHATSAPP_REGISTER_CONVERSATION,
    async (_event, jid: string, config: Partial<WhatsAppConversation>) => {
      try {
        const conversation = whatsappService.registerConversation(jid, config)
        return { success: true, data: conversation }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(LOG, 'Register conversation failed:', message)
        return { success: false, error: message }
      }
    }
  )

  ipcMain.handle(
    WHATSAPP_IPC_CHANNELS.WHATSAPP_UPDATE_CONVERSATION,
    async (_event, jid: string, updates: Partial<WhatsAppConversation>) => {
      try {
        const conversation = whatsappService.updateConversation(jid, updates)
        return { success: true, data: conversation }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { success: false, error: message }
      }
    }
  )

  ipcMain.handle(
    WHATSAPP_IPC_CHANNELS.WHATSAPP_UNREGISTER_CONVERSATION,
    async (_event, jid: string) => {
      try {
        whatsappService.unregisterConversation(jid)
        return { success: true }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { success: false, error: message }
      }
    }
  )

  // ========================================================================
  // Agent
  // ========================================================================

  ipcMain.handle(
    WHATSAPP_IPC_CHANNELS.WHATSAPP_SET_MODE,
    async (_event, jid: string, mode: WhatsAppAgentMode) => {
      try {
        agentService.setConversationMode(jid, mode)
        return { success: true }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { success: false, error: message }
      }
    }
  )

  ipcMain.handle(
    WHATSAPP_IPC_CHANNELS.WHATSAPP_GET_MODE,
    async (_event, jid: string) => {
      try {
        const mode = agentService.getConversationMode(jid)
        return { success: true, data: mode }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { success: false, error: message }
      }
    }
  )

  // ========================================================================
  // Memory
  // ========================================================================

  ipcMain.handle(
    WHATSAPP_IPC_CHANNELS.WHATSAPP_MEMORY_SEARCH,
    async (_event, options: MemorySearchOptions) => {
      try {
        const results = await memoryService.search(options)
        return { success: true, data: results }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { success: false, error: message }
      }
    }
  )

  ipcMain.handle(
    WHATSAPP_IPC_CHANNELS.WHATSAPP_MEMORY_INDEX,
    async (_event, source: MemorySource, sourceId: string, text: string) => {
      try {
        const chunkCount = await memoryService.indexText(source, sourceId, text)
        return { success: true, data: chunkCount }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { success: false, error: message }
      }
    }
  )

  ipcMain.handle(WHATSAPP_IPC_CHANNELS.WHATSAPP_MEMORY_STATS, async () => {
    try {
      const stats = await memoryService.getStats()
      return { success: true, data: stats }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { success: false, error: message }
    }
  })

  ipcMain.handle(WHATSAPP_IPC_CHANNELS.WHATSAPP_MEMORY_CLEAR, async () => {
    try {
      await memoryService.clear()
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { success: false, error: message }
    }
  })

  // ========================================================================
  // Tasks
  // ========================================================================

  ipcMain.handle(
    WHATSAPP_IPC_CHANNELS.WHATSAPP_TASK_LIST,
    async (_event, status?: TaskStatus) => {
      try {
        const tasks = schedulerService.listTasks(status)
        return { success: true, data: tasks }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { success: false, error: message }
      }
    }
  )

  ipcMain.handle(
    WHATSAPP_IPC_CHANNELS.WHATSAPP_TASK_CREATE,
    async (_event, task: Omit<ScheduledTask, 'id' | 'createdAt' | 'updatedAt' | 'runCount'>) => {
      try {
        const created = schedulerService.createTask(task)
        return { success: true, data: created }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(LOG, 'Task create failed:', message)
        return { success: false, error: message }
      }
    }
  )

  ipcMain.handle(
    WHATSAPP_IPC_CHANNELS.WHATSAPP_TASK_UPDATE,
    async (_event, id: string, updates: Partial<ScheduledTask>) => {
      try {
        const updated = schedulerService.updateTask(id, updates)
        return { success: true, data: updated }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { success: false, error: message }
      }
    }
  )

  ipcMain.handle(
    WHATSAPP_IPC_CHANNELS.WHATSAPP_TASK_DELETE,
    async (_event, id: string) => {
      try {
        schedulerService.deleteTask(id)
        return { success: true }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { success: false, error: message }
      }
    }
  )

  // ========================================================================
  // Heartbeat
  // ========================================================================

  ipcMain.handle(WHATSAPP_IPC_CHANNELS.WHATSAPP_HEARTBEAT_START, async () => {
    try {
      heartbeatService.start()
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { success: false, error: message }
    }
  })

  ipcMain.handle(WHATSAPP_IPC_CHANNELS.WHATSAPP_HEARTBEAT_STOP, async () => {
    try {
      heartbeatService.stop()
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { success: false, error: message }
    }
  })

  ipcMain.handle(WHATSAPP_IPC_CHANNELS.WHATSAPP_HEARTBEAT_STATUS, async () => {
    try {
      return {
        success: true,
        data: {
          running: heartbeatService.isRunning(),
          lastResult: heartbeatService.getLastResult(),
        },
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { success: false, error: message }
    }
  })

  ipcMain.handle(WHATSAPP_IPC_CHANNELS.WHATSAPP_HEARTBEAT_TRIGGER, async () => {
    try {
      const result = await heartbeatService.triggerNow()
      return { success: true, data: result }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(LOG, 'Heartbeat trigger failed:', message)
      return { success: false, error: message }
    }
  })

  // ========================================================================
  // Identity
  // ========================================================================

  ipcMain.handle(WHATSAPP_IPC_CHANNELS.WHATSAPP_IDENTITY_GET, async () => {
    try {
      const identity = identityService.getIdentity()
      return { success: true, data: identity }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { success: false, error: message }
    }
  })

  ipcMain.handle(
    WHATSAPP_IPC_CHANNELS.WHATSAPP_IDENTITY_UPDATE,
    async (_event, field: string, content: string) => {
      try {
        switch (field) {
          case 'soul':
            await identityService.updateSoulMd(content)
            break
          case 'user':
            await identityService.updateUserMd(content)
            break
          case 'heartbeat':
            await identityService.updateHeartbeatMd(content)
            break
          default:
            return { success: false, error: `Unknown identity field: ${field}` }
        }
        return { success: true }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { success: false, error: message }
      }
    }
  )

  // ========================================================================
  // Config
  // ========================================================================

  ipcMain.handle(WHATSAPP_IPC_CHANNELS.WHATSAPP_CONFIG_GET, async () => {
    try {
      const config = configStoreRef.getWhatsAppConfig()
      return { success: true, data: config }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { success: false, error: message }
    }
  })

  ipcMain.handle(
    WHATSAPP_IPC_CHANNELS.WHATSAPP_CONFIG_SET,
    async (_event, key: string, value: unknown) => {
      try {
        configStoreRef.setWhatsAppConfig({ [key]: value })
        return { success: true }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { success: false, error: message }
      }
    }
  )

  // ========================================================================
  // Event Forwarding (main -> renderer)
  // ========================================================================

  whatsappService.on('connection-update', (state) => {
    sendToAllWindows(WHATSAPP_IPC_CHANNELS.WHATSAPP_CONNECTION_UPDATE, state)
  })

  whatsappService.on('message-received', (msg) => {
    sendToAllWindows(WHATSAPP_IPC_CHANNELS.WHATSAPP_MESSAGE_RECEIVED, msg)
  })

  whatsappService.on('message-sent', (msg) => {
    sendToAllWindows(WHATSAPP_IPC_CHANNELS.WHATSAPP_MESSAGE_SENT, msg)
  })

  agentService.on('stream-chunk', (data) => {
    sendToAllWindows(WHATSAPP_IPC_CHANNELS.WHATSAPP_AGENT_STREAM, data)
  })

  heartbeatService.on('heartbeat-result', (result) => {
    sendToAllWindows(WHATSAPP_IPC_CHANNELS.WHATSAPP_HEARTBEAT_RESULT, result)
  })

  schedulerService.on('task-executed', (log) => {
    sendToAllWindows(WHATSAPP_IPC_CHANNELS.WHATSAPP_TASK_EXECUTED, log)
  })

  console.log(LOG, 'All WhatsApp IPC handlers registered')
}

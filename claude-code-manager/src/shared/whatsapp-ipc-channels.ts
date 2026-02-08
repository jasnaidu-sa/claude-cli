// ============================================================================
// WhatsApp IPC Channels
// ============================================================================

export const WHATSAPP_IPC_CHANNELS = {
  // WhatsApp - Connection
  WHATSAPP_CONNECT: 'whatsapp:connect',
  WHATSAPP_DISCONNECT: 'whatsapp:disconnect',
  WHATSAPP_GET_STATUS: 'whatsapp:get-status',
  WHATSAPP_CONNECTION_UPDATE: 'whatsapp:connection-update',
  WHATSAPP_REQUEST_PAIRING_CODE: 'whatsapp:request-pairing-code',

  // WhatsApp - Messages
  WHATSAPP_SEND_MESSAGE: 'whatsapp:send-message',
  WHATSAPP_GET_MESSAGES: 'whatsapp:get-messages',
  WHATSAPP_MESSAGE_RECEIVED: 'whatsapp:message-received',
  WHATSAPP_MESSAGE_SENT: 'whatsapp:message-sent',

  // WhatsApp - Conversations
  WHATSAPP_LIST_CONVERSATIONS: 'whatsapp:list-conversations',
  WHATSAPP_GET_CONVERSATION: 'whatsapp:get-conversation',
  WHATSAPP_REGISTER_CONVERSATION: 'whatsapp:register-conversation',
  WHATSAPP_UPDATE_CONVERSATION: 'whatsapp:update-conversation',
  WHATSAPP_UNREGISTER_CONVERSATION: 'whatsapp:unregister-conversation',

  // WhatsApp - Agent
  WHATSAPP_START_AGENT: 'whatsapp:start-agent',
  WHATSAPP_STOP_AGENT: 'whatsapp:stop-agent',
  WHATSAPP_AGENT_STREAM: 'whatsapp:agent-stream',
  WHATSAPP_SET_MODE: 'whatsapp:set-mode',
  WHATSAPP_GET_MODE: 'whatsapp:get-mode',

  // WhatsApp - Memory
  WHATSAPP_MEMORY_SEARCH: 'whatsapp:memory-search',
  WHATSAPP_MEMORY_INDEX: 'whatsapp:memory-index',
  WHATSAPP_MEMORY_STATS: 'whatsapp:memory-stats',
  WHATSAPP_MEMORY_CLEAR: 'whatsapp:memory-clear',

  // WhatsApp - Tasks
  WHATSAPP_TASK_LIST: 'whatsapp:task-list',
  WHATSAPP_TASK_CREATE: 'whatsapp:task-create',
  WHATSAPP_TASK_UPDATE: 'whatsapp:task-update',
  WHATSAPP_TASK_DELETE: 'whatsapp:task-delete',
  WHATSAPP_TASK_EXECUTED: 'whatsapp:task-executed',

  // WhatsApp - Heartbeat
  WHATSAPP_HEARTBEAT_START: 'whatsapp:heartbeat-start',
  WHATSAPP_HEARTBEAT_STOP: 'whatsapp:heartbeat-stop',
  WHATSAPP_HEARTBEAT_STATUS: 'whatsapp:heartbeat-status',
  WHATSAPP_HEARTBEAT_RESULT: 'whatsapp:heartbeat-result',
  WHATSAPP_HEARTBEAT_TRIGGER: 'whatsapp:heartbeat-trigger',

  // WhatsApp - Identity
  WHATSAPP_IDENTITY_GET: 'whatsapp:identity-get',
  WHATSAPP_IDENTITY_UPDATE: 'whatsapp:identity-update',

  // WhatsApp - Config
  WHATSAPP_CONFIG_GET: 'whatsapp:config-get',
  WHATSAPP_CONFIG_SET: 'whatsapp:config-set',

  // WhatsApp - BVS Integration
  WHATSAPP_BVS_PROGRESS: 'whatsapp:bvs-progress',
} as const

export type WhatsAppIpcChannel = typeof WHATSAPP_IPC_CHANNELS[keyof typeof WHATSAPP_IPC_CHANNELS]

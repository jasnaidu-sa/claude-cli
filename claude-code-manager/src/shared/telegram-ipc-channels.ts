// src/shared/telegram-ipc-channels.ts

export const TELEGRAM_IPC_CHANNELS = {
  // Connection
  TELEGRAM_CONNECT: 'telegram:connect',
  TELEGRAM_DISCONNECT: 'telegram:disconnect',
  TELEGRAM_GET_STATUS: 'telegram:get-status',
  TELEGRAM_CONNECTION_UPDATE: 'telegram:connection-update',

  // Messages
  TELEGRAM_SEND_MESSAGE: 'telegram:send-message',
  TELEGRAM_MESSAGE_RECEIVED: 'telegram:message-received',
  TELEGRAM_MESSAGE_SENT: 'telegram:message-sent',
  TELEGRAM_GET_MESSAGES: 'telegram:get-messages',

  // Config
  TELEGRAM_CONFIG_GET: 'telegram:config-get',
  TELEGRAM_CONFIG_SET: 'telegram:config-set',

  // Callback queries (inline keyboards)
  TELEGRAM_CALLBACK_QUERY: 'telegram:callback-query',
  TELEGRAM_ANSWER_CALLBACK: 'telegram:answer-callback',

  // Channel router
  CHANNEL_ROUTER_STATUS: 'channel-router:status',
  CHANNEL_ROUTER_SEND: 'channel-router:send',
  CHANNEL_ROUTER_SEND_ALL: 'channel-router:send-all',

  // Enhanced Channel UX
  CHANNEL_UX_SEND_APPROVAL: 'channel-ux:send-approval',
  CHANNEL_UX_GET_APPROVAL_STATUS: 'channel-ux:get-approval-status',
  CHANNEL_UX_CREATE_PROGRESS: 'channel-ux:create-progress',
  CHANNEL_UX_UPDATE_PROGRESS: 'channel-ux:update-progress',
  CHANNEL_UX_COMPLETE_PROGRESS: 'channel-ux:complete-progress',
  CHANNEL_UX_SEND_NOTIFICATION: 'channel-ux:send-notification',
  CHANNEL_UX_FORWARD_CONFIG_GET: 'channel-ux:forward-config-get',
  CHANNEL_UX_FORWARD_CONFIG_SET: 'channel-ux:forward-config-set',

  // Routing Rules
  TELEGRAM_ROUTING_RULES_GET: 'telegram:routing-rules-get',
  TELEGRAM_ROUTING_RULES_UPSERT: 'telegram:routing-rules-upsert',
  TELEGRAM_ROUTING_RULES_DELETE: 'telegram:routing-rules-delete',

  // Events (main -> renderer)
  CHANNEL_UX_APPROVAL_RESPONSE: 'channel-ux:approval-response',
  CHANNEL_UX_PROGRESS_UPDATE: 'channel-ux:progress-update',
} as const

export type TelegramIpcChannel = typeof TELEGRAM_IPC_CHANNELS[keyof typeof TELEGRAM_IPC_CHANNELS]

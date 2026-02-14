// src/shared/openrouter-ipc-channels.ts
// IPC channels for OpenRouter, LLM Router, and Channel Router settings

export const SETTINGS_IPC_CHANNELS = {
  // OpenRouter
  OPENROUTER_CONFIG_GET: 'openrouter:config-get',
  OPENROUTER_CONFIG_SET: 'openrouter:config-set',
  OPENROUTER_STATS_GET: 'openrouter:stats-get',
  OPENROUTER_STATS_RESET: 'openrouter:stats-reset',
  OPENROUTER_TEST: 'openrouter:test',

  // LLM Routing
  LLM_ROUTING_GET: 'llm-routing:get',
  LLM_ROUTING_SET: 'llm-routing:set',

  // Skills (augments SKILLS_IPC_CHANNELS from skills-types.ts)
  SKILLS_SCHEDULED_JOBS: 'skills:scheduled-jobs',
  SKILLS_EXECUTE_MANUAL: 'skills:execute-manual',
  SKILLS_AUDIT_LOG: 'skills:audit-log',

  // Channel Router Config
  CHANNEL_ROUTER_CONFIG_GET: 'channel-router:config-get',
  CHANNEL_ROUTER_CONFIG_SET: 'channel-router:config-set',
} as const

export type SettingsIpcChannel = typeof SETTINGS_IPC_CHANNELS[keyof typeof SETTINGS_IPC_CHANNELS]

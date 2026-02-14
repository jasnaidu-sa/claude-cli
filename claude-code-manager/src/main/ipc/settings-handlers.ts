/**
 * IPC Handlers for Settings: OpenRouter, LLM Router, Skills, Channel Router.
 *
 * Bridges renderer <-> main process for configuration panels.
 */

import { ipcMain } from 'electron'
import { SETTINGS_IPC_CHANNELS } from '@shared/openrouter-ipc-channels'
import { SKILLS_IPC_CHANNELS } from '@shared/skills-types'
import type { OpenRouterService } from '../services/openrouter-service'
import type { LlmRouterService } from '../services/llm-router-service'
import type { SkillsManagerService } from '../services/skills-manager-service'
import type { SkillsConfigStore } from '../services/skills-config-store'
import type { ChannelRouterService } from '../services/channel-router-service'
import type { SkillExecutorService } from '../services/skill-executor-service'
import type { ChannelRouterConfig } from '@shared/channel-types'
import type { LlmRoutingEntry } from '@shared/skills-types'

const LOG = '[Settings-IPC]'

export function registerSettingsHandlers(deps: {
  openRouterService: OpenRouterService | null
  llmRouterService: LlmRouterService | null
  skillsManager: SkillsManagerService | null
  skillsConfigStore: SkillsConfigStore | null
  channelRouter: ChannelRouterService | null
  skillExecutor: SkillExecutorService | null
}): void {
  const {
    openRouterService,
    llmRouterService,
    skillsManager,
    skillsConfigStore,
    channelRouter,
    skillExecutor,
  } = deps

  // ========================================================================
  // OpenRouter Config
  // ========================================================================

  ipcMain.handle(SETTINGS_IPC_CHANNELS.OPENROUTER_CONFIG_GET, async () => {
    try {
      if (!openRouterService) return { success: true, data: null }
      const config = openRouterService.getConfig()
      return { success: true, data: config }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(LOG, 'OpenRouter config get failed:', message)
      return { success: false, error: message }
    }
  })

  ipcMain.handle(
    SETTINGS_IPC_CHANNELS.OPENROUTER_CONFIG_SET,
    async (_event, config: Record<string, unknown>) => {
      try {
        if (!openRouterService) return { success: false, error: 'OpenRouter not initialized' }
        openRouterService.updateConfig(config)
        return { success: true }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(LOG, 'OpenRouter config set failed:', message)
        return { success: false, error: message }
      }
    },
  )

  ipcMain.handle(SETTINGS_IPC_CHANNELS.OPENROUTER_STATS_GET, async () => {
    try {
      if (!openRouterService) return { success: true, data: null }
      const stats = openRouterService.getStats()
      return { success: true, data: stats }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { success: false, error: message }
    }
  })

  ipcMain.handle(SETTINGS_IPC_CHANNELS.OPENROUTER_STATS_RESET, async () => {
    try {
      if (!openRouterService) return { success: false, error: 'OpenRouter not initialized' }
      openRouterService.resetStats()
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { success: false, error: message }
    }
  })

  ipcMain.handle(SETTINGS_IPC_CHANNELS.OPENROUTER_TEST, async () => {
    try {
      if (!openRouterService) return { success: false, error: 'OpenRouter not initialized' }
      // Simple test: check if config has API key
      const config = openRouterService.getConfig()
      return { success: true, data: { hasApiKey: config.hasApiKey } }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { success: false, error: message }
    }
  })

  // ========================================================================
  // LLM Routing
  // ========================================================================

  ipcMain.handle(SETTINGS_IPC_CHANNELS.LLM_ROUTING_GET, async () => {
    try {
      if (!skillsConfigStore) return { success: true, data: {} }
      const routing = skillsConfigStore.getLlmRouting()
      return { success: true, data: routing }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { success: false, error: message }
    }
  })

  ipcMain.handle(
    SETTINGS_IPC_CHANNELS.LLM_ROUTING_SET,
    async (_event, task: string, entry: LlmRoutingEntry) => {
      try {
        if (!skillsConfigStore) return { success: false, error: 'Config store not initialized' }
        skillsConfigStore.setLlmRouting(task, entry)
        return { success: true }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { success: false, error: message }
      }
    },
  )

  // ========================================================================
  // Skills Management
  // ========================================================================

  ipcMain.handle(SKILLS_IPC_CHANNELS.SKILLS_LIST, async () => {
    try {
      if (!skillsManager) return { success: true, data: [] }
      const skills = skillsManager.listSkills()
      return { success: true, data: skills }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { success: false, error: message }
    }
  })

  ipcMain.handle(SKILLS_IPC_CHANNELS.SKILLS_GET, async (_event, id: string) => {
    try {
      if (!skillsManager) return { success: false, error: 'Skills manager not initialized' }
      const skill = skillsManager.getSkill(id)
      if (!skill) return { success: false, error: `Skill not found: ${id}` }
      return { success: true, data: skill }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { success: false, error: message }
    }
  })

  ipcMain.handle(
    SKILLS_IPC_CHANNELS.SKILLS_TOGGLE,
    async (_event, id: string, active: boolean) => {
      try {
        if (!skillsManager) return { success: false, error: 'Skills manager not initialized' }
        const skill = await skillsManager.toggleSkill(id, active)
        return { success: true, data: skill }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { success: false, error: message }
      }
    },
  )

  ipcMain.handle(
    SKILLS_IPC_CHANNELS.SKILLS_CREATE,
    async (_event, id: string, frontmatter: any, body: string) => {
      try {
        if (!skillsManager) return { success: false, error: 'Skills manager not initialized' }
        const skill = await skillsManager.createSkill(id, frontmatter, body)
        return { success: true, data: skill }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { success: false, error: message }
      }
    },
  )

  ipcMain.handle(SKILLS_IPC_CHANNELS.SKILLS_DELETE, async (_event, id: string) => {
    try {
      if (!skillsManager) return { success: false, error: 'Skills manager not initialized' }
      await skillsManager.deleteSkill(id)
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { success: false, error: message }
    }
  })

  ipcMain.handle(SKILLS_IPC_CHANNELS.SKILLS_GET_CONFIG, async (_event, skillId: string) => {
    try {
      if (!skillsConfigStore) return { success: true, data: null }
      const config = skillsConfigStore.getAgentConfig()
      const skillConfig = config.skills[skillId] || null
      return { success: true, data: skillConfig }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { success: false, error: message }
    }
  })

  ipcMain.handle(
    SKILLS_IPC_CHANNELS.SKILLS_SET_CONFIG,
    async (_event, skillId: string, config: Record<string, unknown>) => {
      try {
        if (!skillsConfigStore) return { success: false, error: 'Config store not initialized' }
        const agentConfig = skillsConfigStore.getAgentConfig()
        agentConfig.skills[skillId] = {
          ...agentConfig.skills[skillId],
          skillId,
          active: true,
          config,
          executionCount: agentConfig.skills[skillId]?.executionCount ?? 0,
          totalCostUsd: agentConfig.skills[skillId]?.totalCostUsd ?? 0,
        }
        return { success: true }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { success: false, error: message }
      }
    },
  )

  // ========================================================================
  // Skills Execution & Scheduling
  // ========================================================================

  ipcMain.handle(SETTINGS_IPC_CHANNELS.SKILLS_SCHEDULED_JOBS, async () => {
    try {
      if (!skillExecutor) return { success: true, data: [] }
      const jobs = skillExecutor.getScheduledJobs()
      return { success: true, data: jobs }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { success: false, error: message }
    }
  })

  ipcMain.handle(
    SETTINGS_IPC_CHANNELS.SKILLS_EXECUTE_MANUAL,
    async (_event, skillId: string) => {
      try {
        if (!skillExecutor) return { success: false, error: 'Skill executor not initialized' }
        const result = await skillExecutor.executeSkill(skillId, 'manual')
        return { success: true, data: result }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { success: false, error: message }
      }
    },
  )

  ipcMain.handle(SETTINGS_IPC_CHANNELS.SKILLS_AUDIT_LOG, async () => {
    try {
      if (!skillsConfigStore) return { success: true, data: [] }
      // Audit log is stored in the config store
      const config = skillsConfigStore.getAgentConfig()
      // Return skill execution stats as a basic audit
      const auditEntries = Object.values(config.skills).map((s) => ({
        skillId: s.skillId,
        executionCount: s.executionCount,
        totalCostUsd: s.totalCostUsd,
        lastExecuted: s.lastExecuted,
        lastError: s.lastError,
      }))
      return { success: true, data: auditEntries }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { success: false, error: message }
    }
  })

  // ========================================================================
  // Channel Router Config
  // ========================================================================

  ipcMain.handle(SETTINGS_IPC_CHANNELS.CHANNEL_ROUTER_CONFIG_GET, async () => {
    try {
      if (!channelRouter) return { success: true, data: null }
      const config = channelRouter.getConfig()
      return { success: true, data: config }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { success: false, error: message }
    }
  })

  ipcMain.handle(
    SETTINGS_IPC_CHANNELS.CHANNEL_ROUTER_CONFIG_SET,
    async (_event, config: Partial<ChannelRouterConfig>) => {
      try {
        if (!channelRouter) return { success: false, error: 'Channel router not initialized' }
        channelRouter.updateConfig(config)
        return { success: true }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { success: false, error: message }
      }
    },
  )

  console.log(LOG, 'All settings IPC handlers registered')
}

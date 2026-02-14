/**
 * AgentSelfToolsMcp - MCP Server with 10 Meta-Tools for Self-Management
 *
 * Provides the agent with tools to manage its own skills, config, and
 * pattern crystallization. These tools are injected into every SDK query
 * session, allowing the agent to extend itself through conversation.
 *
 * Tools:
 * 1. list_skills - Show all skills with status
 * 2. get_skill - Read skill markdown + config
 * 3. toggle_skill - Enable/disable a skill
 * 4. update_skill_config - Modify skill settings
 * 5. create_skill - Write new skill .md file
 * 6. get_agent_config - Read agent config
 * 7. update_agent_config - Modify agent config
 * 8. list_scheduled_tasks - Show cron schedule
 * 9. get_pattern_candidates - Show crystallization candidates
 * 10. approve_pattern - Convert a pattern into a skill
 */

import { z } from 'zod'
import type { SkillsManagerService } from './skills-manager-service'
import type { SkillsConfigStore } from './skills-config-store'
import type { PatternCrystallizerService } from './pattern-crystallizer-service'
import type { SkillFrontmatter, SkillPermissions } from '@shared/skills-types'

const LOG = '[AgentSelfTools]'

type SDK = typeof import('@anthropic-ai/claude-agent-sdk')

const toolResult = (text: string) => ({
  content: [{ type: 'text' as const, text }],
})

/**
 * Create the agent self-management MCP server with 10 meta-tools.
 */
export function createAgentSelfToolsMcpServer(
  sdk: SDK,
  skillsManager: SkillsManagerService,
  configStore: SkillsConfigStore,
  patternCrystallizer: PatternCrystallizerService | null,
): ReturnType<typeof sdk.createSdkMcpServer> {
  return sdk.createSdkMcpServer({
    name: 'agent-self-tools',
    tools: [
      // ================================================================
      // 1. list_skills
      // ================================================================
      sdk.tool(
        'list_skills',
        'List all agent skills with their status, triggers, and execution stats',
        {
          active_only: z.boolean().optional().describe('Only show active skills'),
        },
        async (input) => {
          try {
            let skills = skillsManager.listSkills()
            if (input.active_only) {
              skills = skills.filter((s) => s.active)
            }

            if (skills.length === 0) {
              return toolResult('No skills found.')
            }

            const lines = skills.map((s) => {
              const triggers = s.frontmatter.triggers
                .map((t) => {
                  if (t.command) return `cmd:${t.command}`
                  if (t.cron) return `cron:${t.cron}`
                  if (t.keywords?.length) return `kw:[${t.keywords.join(',')}]`
                  if (t.event) return `event:${t.event}`
                  return 'none'
                })
                .join(', ')

              const rc = configStore.getSkillConfig(s.id)
              const execCount = rc?.executionCount ?? 0
              const cost = rc?.totalCostUsd?.toFixed(4) ?? '0.0000'

              return `- ${s.id} [${s.active ? 'ON' : 'OFF'}] (${s.tier}) triggers=[${triggers}] execs=${execCount} cost=$${cost}\n  ${s.frontmatter.description}`
            })

            return toolResult(`Skills (${skills.length}):\n${lines.join('\n')}`)
          } catch (e: any) {
            return toolResult(`Error listing skills: ${e.message}`)
          }
        },
      ),

      // ================================================================
      // 2. get_skill
      // ================================================================
      sdk.tool(
        'get_skill',
        'Get full details of a skill including its markdown body and runtime config',
        {
          skill_id: z.string().describe('The skill ID to retrieve'),
        },
        async (input) => {
          try {
            const skill = skillsManager.getSkill(input.skill_id)
            if (!skill) return toolResult(`Skill not found: ${input.skill_id}`)

            const rc = configStore.getSkillConfig(input.skill_id)
            const configJson = rc ? JSON.stringify(rc.config, null, 2) : '{}'

            return toolResult(
              [
                `# Skill: ${skill.frontmatter.name} (${skill.id})`,
                `Status: ${skill.active ? 'Active' : 'Inactive'}`,
                `Tier: ${skill.tier}`,
                `Version: ${skill.frontmatter.version}`,
                `Description: ${skill.frontmatter.description}`,
                `Triggers: ${JSON.stringify(skill.frontmatter.triggers)}`,
                `Requires: ${skill.frontmatter.requires?.join(', ') || 'none'}`,
                '',
                '## Runtime Config',
                configJson,
                '',
                '## Instructions',
                skill.body,
              ].join('\n'),
            )
          } catch (e: any) {
            return toolResult(`Error getting skill: ${e.message}`)
          }
        },
      ),

      // ================================================================
      // 3. toggle_skill
      // ================================================================
      sdk.tool(
        'toggle_skill',
        'Enable or disable a skill',
        {
          skill_id: z.string().describe('The skill ID to toggle'),
          active: z.boolean().describe('Whether to enable (true) or disable (false) the skill'),
        },
        async (input) => {
          try {
            const skill = await skillsManager.toggleSkill(input.skill_id, input.active)
            configStore.setSkillConfig(input.skill_id, { active: input.active })
            return toolResult(
              `Skill ${input.skill_id} is now ${input.active ? 'ENABLED' : 'DISABLED'}`,
            )
          } catch (e: any) {
            return toolResult(`Error toggling skill: ${e.message}`)
          }
        },
      ),

      // ================================================================
      // 4. update_skill_config
      // ================================================================
      sdk.tool(
        'update_skill_config',
        'Update runtime configuration for a skill (e.g., schedule, sources, keywords)',
        {
          skill_id: z.string().describe('The skill ID'),
          config_key: z.string().describe('The config key to update'),
          config_value: z.string().describe('The new value (JSON-encoded for complex types)'),
        },
        async (input) => {
          try {
            let value: unknown
            try {
              value = JSON.parse(input.config_value)
            } catch {
              value = input.config_value
            }

            configStore.updateSkillConfigField(input.skill_id, input.config_key, value)
            return toolResult(
              `Updated ${input.skill_id} config: ${input.config_key} = ${JSON.stringify(value)}`,
            )
          } catch (e: any) {
            return toolResult(`Error updating skill config: ${e.message}`)
          }
        },
      ),

      // ================================================================
      // 5. create_skill
      // ================================================================
      sdk.tool(
        'create_skill',
        'Create a new skill by writing a SKILL.md file. The skill will be auto-discovered.',
        {
          id: z.string().describe('Unique skill ID (lowercase, hyphens)'),
          name: z.string().describe('Human-readable name'),
          description: z.string().describe('What the skill does'),
          triggers: z.string().describe('JSON array of trigger objects, e.g., [{"command":"/digest"},{"cron":"0 8 * * *"}]'),
          body: z.string().describe('Markdown instructions for the agent when this skill is active'),
          risk_tier: z.number().optional().describe('Permission tier 0-3 (default: 1)'),
        },
        async (input) => {
          try {
            // Validate trigger schema to prevent malformed/malicious triggers
            const TriggerSchema = z.object({
              command: z.string().regex(/^\/[a-z0-9-]{1,30}$/).optional(),
              cron: z.string().regex(/^[0-9*,\-/\s]{1,100}$/).optional(),
              keywords: z.array(z.string().max(50)).max(10).optional(),
              event: z.enum(['startup', 'shutdown', 'message']).optional(),
            })
            const TriggersArraySchema = z.array(TriggerSchema).min(1).max(10)

            let parsedTriggers: unknown
            try {
              parsedTriggers = JSON.parse(input.triggers)
            } catch {
              return toolResult('Invalid JSON in triggers field')
            }
            const triggers = TriggersArraySchema.parse(parsedTriggers)
            const tier = input.risk_tier ?? 1

            // Check immutable config for tier limits
            const immutable = configStore.getImmutableConfig()
            if (tier > immutable.maxPermissionTier) {
              return toolResult(
                `Cannot create skill with tier ${tier}. Max allowed: ${immutable.maxPermissionTier}`,
              )
            }

            const permissions: SkillPermissions = {
              version: 1,
              risk_tier: tier as 0 | 1 | 2 | 3 | 4,
              declared_purpose: input.description,
              generated_by: 'agent_request',
            }

            // Validate skill body: size limit + prompt injection detection
            if (input.body.length > 50_000) {
              return toolResult('Skill body too large (max 50KB)')
            }
            const injectionPatterns = [
              /ignore (previous|all) instructions/i,
              /you are now/i,
              /forget everything/i,
              /new system prompt/i,
            ]
            if (injectionPatterns.some((p) => p.test(input.body))) {
              return toolResult('Skill body rejected: potential prompt injection detected')
            }

            const frontmatter: Omit<SkillFrontmatter, 'id'> = {
              name: input.name,
              description: input.description,
              version: '1.0.0',
              active: true,
              triggers,
              metadata: { permissions },
            }

            const approvalMethod = tier < immutable.skillAutoApproveBelow
              ? 'auto'
              : 'user_confirm'

            const skill = await skillsManager.createSkill(
              input.id,
              frontmatter,
              input.body,
              approvalMethod,
            )

            return toolResult(
              `Created skill: ${skill.id} (tier ${tier}, ${approvalMethod} approval)\nFile: ${skill.filePath}`,
            )
          } catch (e: any) {
            return toolResult(`Error creating skill: ${e.message}`)
          }
        },
      ),

      // ================================================================
      // 6. get_agent_config
      // ================================================================
      sdk.tool(
        'get_agent_config',
        'Read agent configuration including LLM routing, digest sources, and custom keywords',
        {
          section: z
            .enum(['all', 'llm_routing', 'digest_sources', 'custom_keywords', 'display_prefs'])
            .optional()
            .describe('Which config section to read (default: all)'),
        },
        async (input) => {
          try {
            const section = input.section ?? 'all'
            const config = configStore.getAgentConfig()

            if (section === 'llm_routing') {
              return toolResult(
                `LLM Routing:\n${JSON.stringify(config.llmRouting, null, 2)}`,
              )
            }
            if (section === 'digest_sources') {
              return toolResult(
                `Digest Sources:\n${JSON.stringify(config.digestSources, null, 2)}`,
              )
            }
            if (section === 'custom_keywords') {
              return toolResult(
                `Custom Keywords:\n${JSON.stringify(config.customKeywords, null, 2)}`,
              )
            }
            if (section === 'display_prefs') {
              return toolResult(
                `Display Prefs:\n${JSON.stringify(config.displayPrefs, null, 2)}`,
              )
            }

            // Return all (summary view)
            return toolResult(
              [
                '# Agent Configuration',
                '',
                `## LLM Routing (${Object.keys(config.llmRouting).length} entries)`,
                ...Object.entries(config.llmRouting).map(
                  ([k, v]) => `- ${k}: ${v.provider}/${v.model}`,
                ),
                '',
                `## Digest Sources (${config.digestSources.length})`,
                ...config.digestSources.map(
                  (s) => `- ${s.name} [${s.enabled ? 'ON' : 'OFF'}] (${s.type}): ${s.url}`,
                ),
                '',
                `## Custom Keywords (${Object.keys(config.customKeywords).length})`,
                ...Object.entries(config.customKeywords).map(
                  ([k, v]) => `- "${k}" -> ${v}`,
                ),
              ].join('\n'),
            )
          } catch (e: any) {
            return toolResult(`Error getting config: ${e.message}`)
          }
        },
      ),

      // ================================================================
      // 7. update_agent_config
      // ================================================================
      sdk.tool(
        'update_agent_config',
        'Modify agent configuration (LLM routing, digest sources, keywords)',
        {
          action: z.enum([
            'set_llm_route',
            'add_digest_source',
            'remove_digest_source',
            'set_keyword',
            'remove_keyword',
            'set_display_pref',
          ]).describe('The config action to perform'),
          key: z.string().describe('The key/name for the config entry'),
          value: z.string().optional().describe('JSON-encoded value for the config entry'),
        },
        async (input) => {
          try {
            switch (input.action) {
              case 'set_llm_route': {
                const route = JSON.parse(input.value ?? '{}')
                configStore.setLlmRouting(input.key, route)
                return toolResult(`Set LLM route for "${input.key}": ${JSON.stringify(route)}`)
              }
              case 'add_digest_source': {
                const source = JSON.parse(input.value ?? '{}')
                configStore.addDigestSource({ name: input.key, ...source })
                return toolResult(`Added digest source: ${input.key}`)
              }
              case 'remove_digest_source': {
                configStore.removeDigestSource(input.key)
                return toolResult(`Removed digest source: ${input.key}`)
              }
              case 'set_keyword': {
                configStore.setCustomKeyword(input.key, input.value ?? '')
                return toolResult(`Set keyword "${input.key}" -> ${input.value}`)
              }
              case 'remove_keyword': {
                configStore.removeCustomKeyword(input.key)
                return toolResult(`Removed keyword: ${input.key}`)
              }
              case 'set_display_pref': {
                let val: unknown
                try { val = JSON.parse(input.value ?? '""') } catch { val = input.value }
                configStore.setDisplayPref(input.key, val)
                return toolResult(`Set display pref "${input.key}" = ${JSON.stringify(val)}`)
              }
              default:
                return toolResult(`Unknown action: ${input.action}`)
            }
          } catch (e: any) {
            return toolResult(`Error updating config: ${e.message}`)
          }
        },
      ),

      // ================================================================
      // 8. list_scheduled_tasks
      // ================================================================
      sdk.tool(
        'list_scheduled_tasks',
        'Show all skills with cron schedules and their next run times',
        {},
        async () => {
          try {
            const scheduled = skillsManager.getScheduledSkills()
            if (scheduled.length === 0) {
              return toolResult('No scheduled skills found.')
            }

            const lines = scheduled.map((s) => {
              const crons = s.frontmatter.triggers
                .filter((t) => t.cron)
                .map((t) => t.cron)
                .join(', ')
              const rc = configStore.getSkillConfig(s.id)
              const lastExec = rc?.lastExecuted
                ? new Date(rc.lastExecuted).toISOString()
                : 'never'
              return `- ${s.id}: cron="${crons}" last_run=${lastExec}`
            })

            return toolResult(
              `Scheduled Skills (${scheduled.length}):\n${lines.join('\n')}`,
            )
          } catch (e: any) {
            return toolResult(`Error listing scheduled tasks: ${e.message}`)
          }
        },
      ),

      // ================================================================
      // 9. get_pattern_candidates
      // ================================================================
      sdk.tool(
        'get_pattern_candidates',
        'Show workflow patterns detected from agent tool usage that are candidates for crystallization into skills',
        {},
        async () => {
          try {
            if (!patternCrystallizer) {
              return toolResult('Pattern crystallizer is not enabled.')
            }

            const candidates = patternCrystallizer.getCandidates()
            if (candidates.length === 0) {
              return toolResult('No crystallization candidates found yet. More observations needed.')
            }

            const lines = candidates.map((c) => {
              return [
                `## ${c.pattern}`,
                `ID: ${c.id}`,
                `Status: ${c.status}`,
                `Tools: ${c.toolSequence.join(' -> ')}`,
                `Observations: ${c.observationCount} (${(c.successRate * 100).toFixed(0)}% success)`,
                `Sessions: ${c.distinctSessions}`,
                `Avg cost: $${c.averageCostUsd.toFixed(4)}`,
                `First seen: ${new Date(c.firstSeen).toISOString()}`,
              ].join('\n')
            })

            return toolResult(
              `Crystallization Candidates (${candidates.length}):\n\n${lines.join('\n\n')}`,
            )
          } catch (e: any) {
            return toolResult(`Error getting candidates: ${e.message}`)
          }
        },
      ),

      // ================================================================
      // 10. approve_pattern
      // ================================================================
      sdk.tool(
        'approve_pattern',
        'Convert a detected pattern into a skill. Requires user confirmation for tier 2+.',
        {
          candidate_id: z.string().describe('The crystallization candidate ID to approve'),
        },
        async (input) => {
          try {
            if (!patternCrystallizer) {
              return toolResult('Pattern crystallizer is not enabled.')
            }

            const result = await patternCrystallizer.approveCandidate(input.candidate_id)
            if (!result) {
              return toolResult(`Candidate not found: ${input.candidate_id}`)
            }

            return toolResult(
              `Pattern crystallized into skill: ${result.skillId}\n` +
              `File: ${result.filePath}\n` +
              `The skill is now active and will be triggered according to its configuration.`,
            )
          } catch (e: any) {
            return toolResult(`Error approving pattern: ${e.message}`)
          }
        },
      ),
    ],
  })
}

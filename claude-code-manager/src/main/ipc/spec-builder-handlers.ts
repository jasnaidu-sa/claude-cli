/**
 * Spec Builder IPC Handlers
 *
 * Phase 3: Spec generation using the spec-builder research agent.
 * Takes conversation context from discovery chat and builds a detailed specification.
 */

import { ipcMain } from 'electron'
import { ResearchAgentRunner, type AgentResult } from '../services/research-agent-runner'
import { getMainWindow } from '../index'
import type { GeneratedSpec, SpecSection } from '../../renderer/stores/autonomous-store'

// IPC channel names for spec builder
export const SPEC_BUILDER_IPC_CHANNELS = {
  BUILD_SPEC: 'spec-builder:build',
  CANCEL: 'spec-builder:cancel',
  GET_STATUS: 'spec-builder:get-status'
} as const

// Track active spec building tasks
const activeSpecTasks: Map<string, { taskId: string; projectPath: string }> = new Map()

export function setupSpecBuilderHandlers(researchAgentRunner: ResearchAgentRunner): void {
  // Build spec from conversation context
  ipcMain.handle(SPEC_BUILDER_IPC_CHANNELS.BUILD_SPEC, async (_event, projectPath: string, conversationContext: string, journeyContext?: string) => {
    try {
      // Check if spec building is already in progress
      if (activeSpecTasks.has(projectPath)) {
        return {
          success: false,
          error: 'Spec building already in progress for this project'
        }
      }

      console.log('[SpecBuilderHandler] Starting spec build for:', projectPath)

      // Create a unique session ID for this task
      const sessionId = `spec-builder-${Date.now()}`

      // Combine journey analysis context with conversation context
      let fullContext = conversationContext
      if (journeyContext) {
        fullContext = `## Existing Codebase Analysis\n${journeyContext}\n\n## Discovery Conversation\n${conversationContext}`
      }

      // Run the spec-builder agent
      const task = await researchAgentRunner.runAgent(
        'spec-builder',
        sessionId,
        projectPath,
        fullContext
      )

      activeSpecTasks.set(projectPath, { taskId: task.id, projectPath })

      // Listen for completion
      const handleComplete = ({ taskId, result }: { taskId: string; result: AgentResult }) => {
        if (taskId !== task.id) return

        const mainWindow = getMainWindow()
        if (!mainWindow) return

        // Parse the spec output
        let spec: GeneratedSpec | null = null
        if (result.status === 'complete' && result.output) {
          spec = parseSpecOutput(result.output)
        }

        // Send result to renderer
        mainWindow.webContents.send('spec-builder:complete', {
          projectPath,
          success: result.status === 'complete',
          spec,
          error: result.error
        })

        // Cleanup
        activeSpecTasks.delete(projectPath)
        researchAgentRunner.removeListener('complete', handleComplete)
      }

      researchAgentRunner.on('complete', handleComplete)

      // Forward status updates
      const handleStatus = (data: { sessionId: string; agentName: string; status: string }) => {
        if (data.sessionId !== sessionId) return

        const mainWindow = getMainWindow()
        if (mainWindow) {
          mainWindow.webContents.send('spec-builder:status', {
            projectPath,
            status: data.status
          })
        }
      }

      researchAgentRunner.on('status', handleStatus)

      return {
        success: true,
        taskId: task.id
      }
    } catch (error) {
      console.error('[SpecBuilderHandler] Error building spec:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  })

  // Cancel spec building
  ipcMain.handle(SPEC_BUILDER_IPC_CHANNELS.CANCEL, async (_event, projectPath: string) => {
    const task = activeSpecTasks.get(projectPath)
    if (task) {
      researchAgentRunner.cancelTask(task.taskId)
      activeSpecTasks.delete(projectPath)
      return { success: true }
    }
    return { success: false, error: 'No spec building in progress' }
  })

  // Get status
  ipcMain.handle(SPEC_BUILDER_IPC_CHANNELS.GET_STATUS, async (_event, projectPath: string) => {
    const task = activeSpecTasks.get(projectPath)
    if (task) {
      const taskData = researchAgentRunner.getTask(task.taskId)
      return {
        inProgress: true,
        status: taskData?.result?.status || 'running'
      }
    }
    return { inProgress: false }
  })

  console.log('[SpecBuilderHandler] Registered spec builder handlers')
}

/**
 * Parse the raw spec output from the agent into a structured GeneratedSpec
 */
function parseSpecOutput(output: string): GeneratedSpec {
  // Try to extract sections from markdown headers
  const sections: SpecSection[] = []
  const lines = output.split('\n')
  let currentSection: { title: string; content: string[] } | null = null

  for (const line of lines) {
    // Match markdown headers (## or ###)
    const headerMatch = line.match(/^##\s+(.+)$/)
    if (headerMatch) {
      // Save previous section
      if (currentSection) {
        sections.push({
          id: `section-${sections.length}`,
          title: currentSection.title,
          content: currentSection.content.join('\n').trim(),
          editable: true
        })
      }
      // Start new section
      currentSection = { title: headerMatch[1], content: [] }
    } else if (currentSection) {
      currentSection.content.push(line)
    }
  }

  // Save last section
  if (currentSection) {
    sections.push({
      id: `section-${sections.length}`,
      title: currentSection.title,
      content: currentSection.content.join('\n').trim(),
      editable: true
    })
  }

  // Count features (look for numbered lists or feature headers)
  let featureCount = 0
  const featurePatterns = [
    /^\d+\.\s/gm,           // Numbered lists
    /^-\s+\*\*[^*]+\*\*/gm, // Bold bullet points
    /^###\s+Feature/gmi     // Feature headers
  ]
  for (const pattern of featurePatterns) {
    const matches = output.match(pattern)
    if (matches) {
      featureCount = Math.max(featureCount, matches.length)
    }
  }

  // Create app_spec.txt format (plain text version)
  const appSpecTxt = output
    .replace(/^#+\s+/gm, '') // Remove markdown headers
    .replace(/\*\*/g, '')    // Remove bold markers
    .replace(/```[\s\S]*?```/g, '[CODE BLOCK]') // Simplify code blocks
    .trim()

  return {
    markdown: output,
    appSpecTxt,
    sections,
    featureCount: featureCount || sections.length,
    readyForExecution: true
  }
}

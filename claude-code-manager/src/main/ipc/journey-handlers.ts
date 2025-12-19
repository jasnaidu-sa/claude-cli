/**
 * Journey Analysis IPC Handlers
 *
 * Phase 1: Automatic user journey analysis for brownfield (existing) projects.
 * Analyzes the codebase to understand patterns, tech stack, and user flows
 * before the discovery chat begins.
 */

import { ipcMain } from 'electron'
import { ResearchAgentRunner, type AgentResult } from '../services/research-agent-runner'
import { getMainWindow } from '../index'
import type { JourneyAnalysis } from '../../renderer/stores/autonomous-store'

// IPC channel names for journey analysis
export const JOURNEY_IPC_CHANNELS = {
  START_ANALYSIS: 'journey:start-analysis',
  CANCEL_ANALYSIS: 'journey:cancel',
  GET_STATUS: 'journey:get-status'
} as const

// Track active analysis tasks
const activeAnalysisTasks: Map<string, { taskId: string; projectPath: string }> = new Map()

export function setupJourneyHandlers(researchAgentRunner: ResearchAgentRunner): void {
  // Start journey analysis for a project
  ipcMain.handle(JOURNEY_IPC_CHANNELS.START_ANALYSIS, async (_event, projectPath: string) => {
    try {
      // Check if analysis is already running for this project
      if (activeAnalysisTasks.has(projectPath)) {
        return {
          success: false,
          error: 'Analysis already in progress for this project'
        }
      }

      console.log('[JourneyHandler] Starting analysis for:', projectPath)

      // Create a unique session ID for this analysis
      const sessionId = `journey-${Date.now()}`

      console.log('[JourneyHandler] Running user-journey agent with sessionId:', sessionId)

      // Run the user-journey agent
      const task = await researchAgentRunner.runAgent(
        'user-journey',
        sessionId,
        projectPath,
        '' // No user input needed - just analyze the project
      )

      console.log('[JourneyHandler] Agent task created:', task.id)

      activeAnalysisTasks.set(projectPath, { taskId: task.id, projectPath })

      // Listen for completion
      const handleComplete = ({ taskId, result }: { taskId: string; result: AgentResult }) => {
        console.log('[JourneyHandler] handleComplete called for taskId:', taskId, 'expected:', task.id)
        if (taskId !== task.id) return

        console.log('[JourneyHandler] Task completed with status:', result.status)

        const mainWindow = getMainWindow()
        if (!mainWindow) {
          console.log('[JourneyHandler] No main window available')
          return
        }

        // Parse the JSON output from the agent
        let analysis: JourneyAnalysis | null = null
        if (result.status === 'complete' && result.output) {
          try {
            // Try to extract JSON from the output
            const jsonMatch = result.output.match(/\{[\s\S]*\}/)
            if (jsonMatch) {
              const parsed = JSON.parse(jsonMatch[0])
              analysis = {
                completed: true,
                userFlows: parsed.userFlows || [],
                entryPoints: parsed.entryPoints || [],
                dataModels: parsed.dataModels || [],
                techStack: parsed.techStack || [],
                patterns: parsed.patterns || [],
                summary: parsed.summary || 'Analysis complete'
              }
            }
          } catch (parseError) {
            console.error('[JourneyHandler] Failed to parse agent output:', parseError)
            // Create a fallback analysis with the raw output
            analysis = {
              completed: true,
              userFlows: [],
              entryPoints: [],
              dataModels: [],
              techStack: [],
              patterns: [],
              summary: result.output.substring(0, 500)
            }
          }
        }

        // Send result to renderer
        mainWindow.webContents.send('journey:complete', {
          projectPath,
          success: result.status === 'complete',
          analysis,
          error: result.error
        })

        // Cleanup
        activeAnalysisTasks.delete(projectPath)
        researchAgentRunner.removeListener('complete', handleComplete)
      }

      researchAgentRunner.on('complete', handleComplete)

      // Also forward status updates
      const handleStatus = (data: { sessionId: string; agentName: string; status: string }) => {
        if (data.sessionId !== sessionId) return

        const mainWindow = getMainWindow()
        if (mainWindow) {
          mainWindow.webContents.send('journey:status', {
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
      console.error('[JourneyHandler] Error starting analysis:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  })

  // Cancel analysis
  ipcMain.handle(JOURNEY_IPC_CHANNELS.CANCEL_ANALYSIS, async (_event, projectPath: string) => {
    const task = activeAnalysisTasks.get(projectPath)
    if (task) {
      researchAgentRunner.cancelTask(task.taskId)
      activeAnalysisTasks.delete(projectPath)
      return { success: true }
    }
    return { success: false, error: 'No analysis in progress' }
  })

  // Get analysis status
  ipcMain.handle(JOURNEY_IPC_CHANNELS.GET_STATUS, async (_event, projectPath: string) => {
    const task = activeAnalysisTasks.get(projectPath)
    if (task) {
      const taskData = researchAgentRunner.getTask(task.taskId)
      return {
        inProgress: true,
        status: taskData?.result?.status || 'running'
      }
    }
    return { inProgress: false }
  })

  console.log('[JourneyHandler] Registered journey analysis handlers')
}

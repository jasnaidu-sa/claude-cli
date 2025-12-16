/**
 * Autonomous Coding Store (Zustand)
 *
 * Manages state for the autonomous coding system including:
 * - Workflows (WorkflowConfig)
 * - Orchestrator sessions (OrchestratorSession)
 * - Progress tracking (ProgressSnapshot)
 * - Schema validation (SchemaValidationResult)
 * - Python venv status (VenvStatus)
 */

import { create } from 'zustand'
import type {
  WorkflowConfig,
  WorkflowStatus,
  WorkflowProgress,
  OrchestratorSession,
  OrchestratorConfig,
  OrchestratorOutput,
  OrchestratorProgress,
  ProgressSnapshot,
  SchemaValidationResult
} from '@shared/types'
import type { VenvStatus, VenvCreationProgress, CreateWorkflowOptions, UpdateWorkflowOptions } from '../../preload/index'

// Schema validation status type
type SchemaStatus = 'idle' | 'validating' | 'complete' | 'error'

interface AutonomousState {
  // Workflows
  workflows: WorkflowConfig[]
  workflowsByProject: Record<string, WorkflowConfig[]>
  activeWorkflowId: string | null

  // Orchestrator sessions
  sessions: OrchestratorSession[]
  sessionsByWorkflow: Record<string, OrchestratorSession[]>
  activeSessionId: string | null
  sessionOutput: Record<string, OrchestratorOutput[]>

  // Progress tracking
  progressByWorkflow: Record<string, ProgressSnapshot>

  // Schema validation
  schemaResults: Record<string, SchemaValidationResult>
  schemaStatus: Record<string, SchemaStatus>

  // Venv
  venvStatus: VenvStatus | null
  venvProgress: VenvCreationProgress | null

  // UI State
  isLoading: boolean
  error: string | null

  // Workflow Actions
  refreshWorkflows: (projectPath?: string) => Promise<void>
  createWorkflow: (options: CreateWorkflowOptions) => Promise<WorkflowConfig | null>
  updateWorkflow: (projectPath: string, workflowId: string, updates: UpdateWorkflowOptions) => Promise<WorkflowConfig | null>
  deleteWorkflow: (projectPath: string, workflowId: string) => Promise<boolean>
  setActiveWorkflow: (workflowId: string | null) => void
  getWorkflow: (projectPath: string, workflowId: string) => Promise<WorkflowConfig | null>

  // Orchestrator Actions
  startOrchestrator: (config: OrchestratorConfig) => Promise<OrchestratorSession | null>
  stopOrchestrator: (sessionId: string) => Promise<boolean>
  pauseOrchestrator: (sessionId: string) => Promise<boolean>
  refreshSessions: (workflowId?: string) => Promise<void>
  setActiveSession: (sessionId: string | null) => void
  appendSessionOutput: (output: OrchestratorOutput) => void
  clearSessionOutput: (sessionId: string) => void

  // Progress Actions
  watchProgress: (workflowId: string, projectPath: string) => Promise<void>
  unwatchProgress: (workflowId: string) => Promise<void>
  updateProgress: (snapshot: ProgressSnapshot) => void

  // Schema Validation Actions
  validateSchema: (projectPath: string, workflowId: string, model?: string) => Promise<boolean>
  getSchemaResult: (projectPath: string) => Promise<SchemaValidationResult | null>
  clearSchemaResult: (projectPath: string) => Promise<void>
  updateSchemaStatus: (projectPath: string, status: SchemaStatus, error?: string) => void

  // Venv Actions
  checkVenv: () => Promise<VenvStatus | null>
  ensureVenv: () => Promise<VenvStatus | null>
  upgradeVenv: () => Promise<boolean>
  setVenvProgress: (progress: VenvCreationProgress | null) => void

  // Helpers
  getActiveWorkflow: () => WorkflowConfig | undefined
  getActiveSession: () => OrchestratorSession | undefined
  getWorkflowsForProject: (projectPath: string) => WorkflowConfig[]
  getSessionsForWorkflow: (workflowId: string) => OrchestratorSession[]
  getProgressForWorkflow: (workflowId: string) => ProgressSnapshot | null
  setError: (error: string | null) => void
  setLoading: (loading: boolean) => void

  // Subscription management
  initSubscriptions: () => () => void
}

export const useAutonomousStore = create<AutonomousState>((set, get) => ({
  // Initial state
  workflows: [],
  workflowsByProject: {},
  activeWorkflowId: null,

  sessions: [],
  sessionsByWorkflow: {},
  activeSessionId: null,
  sessionOutput: {},

  progressByWorkflow: {},

  schemaResults: {},
  schemaStatus: {},

  venvStatus: null,
  venvProgress: null,

  isLoading: false,
  error: null,

  // Workflow Actions
  refreshWorkflows: async (projectPath?: string) => {
    set({ isLoading: true, error: null })
    try {
      let workflows: WorkflowConfig[]

      if (projectPath) {
        workflows = await window.electron.workflow.listForProject(projectPath)
      } else {
        workflows = await window.electron.workflow.list()
      }

      // Group by project
      const workflowsByProject: Record<string, WorkflowConfig[]> = {}
      for (const workflow of workflows) {
        if (!workflowsByProject[workflow.projectPath]) {
          workflowsByProject[workflow.projectPath] = []
        }
        workflowsByProject[workflow.projectPath].push(workflow)
      }

      set({
        workflows,
        workflowsByProject,
        isLoading: false
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to refresh workflows'
      set({ error: message, isLoading: false })
    }
  },

  createWorkflow: async (options: CreateWorkflowOptions) => {
    set({ isLoading: true, error: null })
    try {
      const result = await window.electron.workflow.create(options)

      if (!result.success || !result.workflow) {
        set({ error: result.error || 'Failed to create workflow', isLoading: false })
        return null
      }

      const workflow = result.workflow

      set((state) => {
        const workflows = [...state.workflows, workflow]
        const workflowsByProject = { ...state.workflowsByProject }

        if (!workflowsByProject[workflow.projectPath]) {
          workflowsByProject[workflow.projectPath] = []
        }
        workflowsByProject[workflow.projectPath] = [...workflowsByProject[workflow.projectPath], workflow]

        return {
          workflows,
          workflowsByProject,
          activeWorkflowId: workflow.id,
          isLoading: false
        }
      })

      return workflow
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create workflow'
      set({ error: message, isLoading: false })
      return null
    }
  },

  updateWorkflow: async (projectPath: string, workflowId: string, updates: UpdateWorkflowOptions) => {
    set({ error: null })
    try {
      const result = await window.electron.workflow.update(projectPath, workflowId, updates)

      if (!result.success || !result.workflow) {
        set({ error: result.error || 'Failed to update workflow' })
        return null
      }

      const updatedWorkflow = result.workflow

      set((state) => {
        const workflows = state.workflows.map(w =>
          w.id === workflowId ? updatedWorkflow : w
        )

        const workflowsByProject = { ...state.workflowsByProject }
        if (workflowsByProject[projectPath]) {
          workflowsByProject[projectPath] = workflowsByProject[projectPath].map(w =>
            w.id === workflowId ? updatedWorkflow : w
          )
        }

        return { workflows, workflowsByProject }
      })

      return updatedWorkflow
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update workflow'
      set({ error: message })
      return null
    }
  },

  deleteWorkflow: async (projectPath: string, workflowId: string) => {
    set({ isLoading: true, error: null })
    try {
      const result = await window.electron.workflow.delete(projectPath, workflowId)

      if (!result.success) {
        set({ error: result.error || 'Failed to delete workflow', isLoading: false })
        return false
      }

      set((state) => {
        const workflows = state.workflows.filter(w => w.id !== workflowId)
        const workflowsByProject = { ...state.workflowsByProject }

        if (workflowsByProject[projectPath]) {
          workflowsByProject[projectPath] = workflowsByProject[projectPath].filter(w => w.id !== workflowId)
        }

        const newActiveId = state.activeWorkflowId === workflowId
          ? workflows[0]?.id || null
          : state.activeWorkflowId

        return {
          workflows,
          workflowsByProject,
          activeWorkflowId: newActiveId,
          isLoading: false
        }
      })

      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete workflow'
      set({ error: message, isLoading: false })
      return false
    }
  },

  setActiveWorkflow: (workflowId: string | null) => {
    set({ activeWorkflowId: workflowId })
  },

  getWorkflow: async (projectPath: string, workflowId: string) => {
    try {
      return await window.electron.workflow.get(projectPath, workflowId)
    } catch (error) {
      console.error('Failed to get workflow:', error)
      return null
    }
  },

  // Orchestrator Actions
  startOrchestrator: async (config: OrchestratorConfig) => {
    set({ isLoading: true, error: null })
    try {
      const result = await window.electron.orchestrator.start(config)

      if (!result.success || !result.session) {
        set({ error: result.error || 'Failed to start orchestrator', isLoading: false })
        return null
      }

      const session = result.session

      set((state) => {
        const sessions = [...state.sessions, session]
        const sessionsByWorkflow = { ...state.sessionsByWorkflow }

        if (!sessionsByWorkflow[config.workflowId]) {
          sessionsByWorkflow[config.workflowId] = []
        }
        sessionsByWorkflow[config.workflowId] = [...sessionsByWorkflow[config.workflowId], session]

        return {
          sessions,
          sessionsByWorkflow,
          activeSessionId: session.id,
          isLoading: false
        }
      })

      return session
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start orchestrator'
      set({ error: message, isLoading: false })
      return null
    }
  },

  stopOrchestrator: async (sessionId: string) => {
    set({ error: null })
    try {
      const result = await window.electron.orchestrator.stop(sessionId)

      if (!result.success) {
        set({ error: result.error || 'Failed to stop orchestrator' })
        return false
      }

      // Session update will come through the onSession callback
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to stop orchestrator'
      set({ error: message })
      return false
    }
  },

  pauseOrchestrator: async (sessionId: string) => {
    set({ error: null })
    try {
      const result = await window.electron.orchestrator.pause(sessionId)

      if (!result.success) {
        set({ error: result.error || 'Failed to pause orchestrator' })
        return false
      }

      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to pause orchestrator'
      set({ error: message })
      return false
    }
  },

  refreshSessions: async (workflowId?: string) => {
    set({ error: null })
    try {
      let sessions: OrchestratorSession[]

      if (workflowId) {
        sessions = await window.electron.orchestrator.getWorkflowSessions(workflowId)
      } else {
        sessions = await window.electron.orchestrator.getAllSessions()
      }

      // Group by workflow
      const sessionsByWorkflow: Record<string, OrchestratorSession[]> = {}
      for (const session of sessions) {
        const wfId = session.config.workflowId
        if (!sessionsByWorkflow[wfId]) {
          sessionsByWorkflow[wfId] = []
        }
        sessionsByWorkflow[wfId].push(session)
      }

      set({ sessions, sessionsByWorkflow })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to refresh sessions'
      set({ error: message })
    }
  },

  setActiveSession: (sessionId: string | null) => {
    set({ activeSessionId: sessionId })
  },

  appendSessionOutput: (output: OrchestratorOutput) => {
    set((state) => {
      const sessionOutput = { ...state.sessionOutput }
      if (!sessionOutput[output.sessionId]) {
        sessionOutput[output.sessionId] = []
      }
      sessionOutput[output.sessionId] = [...sessionOutput[output.sessionId], output]

      // Limit output history to prevent memory issues
      if (sessionOutput[output.sessionId].length > 1000) {
        sessionOutput[output.sessionId] = sessionOutput[output.sessionId].slice(-500)
      }

      return { sessionOutput }
    })
  },

  clearSessionOutput: (sessionId: string) => {
    set((state) => {
      const sessionOutput = { ...state.sessionOutput }
      delete sessionOutput[sessionId]
      return { sessionOutput }
    })
  },

  // Progress Actions
  watchProgress: async (workflowId: string, projectPath: string) => {
    set({ error: null })
    try {
      const result = await window.electron.progress.watch(workflowId, projectPath)

      if (result.success && result.snapshot) {
        set((state) => ({
          progressByWorkflow: {
            ...state.progressByWorkflow,
            [workflowId]: result.snapshot!
          }
        }))
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to watch progress'
      set({ error: message })
    }
  },

  unwatchProgress: async (workflowId: string) => {
    try {
      await window.electron.progress.unwatch(workflowId)
    } catch (error) {
      console.error('Failed to unwatch progress:', error)
    }
  },

  updateProgress: (snapshot: ProgressSnapshot) => {
    set((state) => ({
      progressByWorkflow: {
        ...state.progressByWorkflow,
        [snapshot.workflowId]: snapshot
      }
    }))
  },

  // Schema Validation Actions
  validateSchema: async (projectPath: string, workflowId: string, model?: string) => {
    set((state) => ({
      schemaStatus: { ...state.schemaStatus, [projectPath]: 'validating' },
      error: null
    }))

    try {
      const result = await window.electron.schema.validate(projectPath, workflowId, model)

      if (!result.success) {
        set((state) => ({
          schemaStatus: { ...state.schemaStatus, [projectPath]: 'error' },
          error: result.error || 'Schema validation failed'
        }))
        return false
      }

      // Result will be fetched and updated through getSchemaResult
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Schema validation failed'
      set((state) => ({
        schemaStatus: { ...state.schemaStatus, [projectPath]: 'error' },
        error: message
      }))
      return false
    }
  },

  getSchemaResult: async (projectPath: string) => {
    try {
      const result = await window.electron.schema.getResult(projectPath)

      if (result) {
        set((state) => ({
          schemaResults: { ...state.schemaResults, [projectPath]: result },
          schemaStatus: { ...state.schemaStatus, [projectPath]: 'complete' }
        }))
      }

      return result
    } catch (error) {
      console.error('Failed to get schema result:', error)
      return null
    }
  },

  clearSchemaResult: async (projectPath: string) => {
    try {
      await window.electron.schema.clear(projectPath)

      set((state) => {
        const schemaResults = { ...state.schemaResults }
        const schemaStatus = { ...state.schemaStatus }
        delete schemaResults[projectPath]
        delete schemaStatus[projectPath]
        return { schemaResults, schemaStatus }
      })
    } catch (error) {
      console.error('Failed to clear schema result:', error)
    }
  },

  updateSchemaStatus: (projectPath: string, status: SchemaStatus, _error?: string) => {
    set((state) => ({
      schemaStatus: { ...state.schemaStatus, [projectPath]: status }
    }))
  },

  // Venv Actions
  checkVenv: async () => {
    try {
      const status = await window.electron.venv.getStatus()
      set({ venvStatus: status })
      return status
    } catch (error) {
      console.error('Failed to check venv:', error)
      return null
    }
  },

  ensureVenv: async () => {
    set({ isLoading: true, error: null })
    try {
      const status = await window.electron.venv.ensure()
      set({ venvStatus: status, isLoading: false })
      return status
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to ensure venv'
      set({ error: message, isLoading: false })
      return null
    }
  },

  upgradeVenv: async () => {
    set({ isLoading: true, error: null })
    try {
      const result = await window.electron.venv.upgrade()
      set({ isLoading: false })

      if (!result.success) {
        set({ error: result.error || 'Failed to upgrade venv' })
        return false
      }

      // Refresh venv status
      await get().checkVenv()
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to upgrade venv'
      set({ error: message, isLoading: false })
      return false
    }
  },

  setVenvProgress: (progress: VenvCreationProgress | null) => {
    set({ venvProgress: progress })
  },

  // Helpers
  getActiveWorkflow: () => {
    const state = get()
    return state.workflows.find(w => w.id === state.activeWorkflowId)
  },

  getActiveSession: () => {
    const state = get()
    return state.sessions.find(s => s.id === state.activeSessionId)
  },

  getWorkflowsForProject: (projectPath: string) => {
    return get().workflowsByProject[projectPath] || []
  },

  getSessionsForWorkflow: (workflowId: string) => {
    return get().sessionsByWorkflow[workflowId] || []
  },

  getProgressForWorkflow: (workflowId: string) => {
    return get().progressByWorkflow[workflowId] || null
  },

  setError: (error: string | null) => set({ error }),

  setLoading: (isLoading: boolean) => set({ isLoading }),

  // Subscription management - call once in app initialization
  initSubscriptions: () => {
    const unsubscribers: (() => void)[] = []

    // Workflow changes
    unsubscribers.push(
      window.electron.workflow.onChange((change) => {
        const { workflow, action } = change

        set((state) => {
          let workflows = [...state.workflows]
          const workflowsByProject = { ...state.workflowsByProject }

          switch (action) {
            case 'created':
              workflows.push(workflow)
              if (!workflowsByProject[workflow.projectPath]) {
                workflowsByProject[workflow.projectPath] = []
              }
              workflowsByProject[workflow.projectPath].push(workflow)
              break

            case 'updated':
              workflows = workflows.map(w => w.id === workflow.id ? workflow : w)
              if (workflowsByProject[workflow.projectPath]) {
                workflowsByProject[workflow.projectPath] = workflowsByProject[workflow.projectPath].map(w =>
                  w.id === workflow.id ? workflow : w
                )
              }
              break

            case 'deleted':
              workflows = workflows.filter(w => w.id !== workflow.id)
              if (workflowsByProject[workflow.projectPath]) {
                workflowsByProject[workflow.projectPath] = workflowsByProject[workflow.projectPath].filter(w =>
                  w.id !== workflow.id
                )
              }
              break
          }

          return { workflows, workflowsByProject }
        })
      })
    )

    // Orchestrator output
    unsubscribers.push(
      window.electron.orchestrator.onOutput((output) => {
        get().appendSessionOutput(output)
      })
    )

    // Orchestrator progress
    unsubscribers.push(
      window.electron.orchestrator.onProgress((progress) => {
        // Update the workflow progress as well
        const session = get().sessions.find(s => s.id === progress.sessionId)
        if (session) {
          set((state) => ({
            progressByWorkflow: {
              ...state.progressByWorkflow,
              [session.config.workflowId]: {
                workflowId: session.config.workflowId,
                timestamp: Date.now(),
                total: progress.testsTotal || 0,
                passing: progress.testsPassing || 0,
                failing: 0,
                pending: (progress.testsTotal || 0) - (progress.testsPassing || 0),
                percentage: progress.testsTotal ? Math.round((progress.testsPassing || 0) / progress.testsTotal * 100) : 0,
                categories: [],
                currentTest: progress.currentTest
              }
            }
          }))
        }
      })
    )

    // Orchestrator session updates
    unsubscribers.push(
      window.electron.orchestrator.onSession((session) => {
        set((state) => {
          const sessions = state.sessions.map(s => s.id === session.id ? session : s)
          const sessionsByWorkflow = { ...state.sessionsByWorkflow }

          const workflowId = session.config.workflowId
          if (sessionsByWorkflow[workflowId]) {
            sessionsByWorkflow[workflowId] = sessionsByWorkflow[workflowId].map(s =>
              s.id === session.id ? session : s
            )
          }

          return { sessions, sessionsByWorkflow }
        })
      })
    )

    // Progress updates
    unsubscribers.push(
      window.electron.progress.onUpdate((snapshot) => {
        get().updateProgress(snapshot)
      })
    )

    // Venv progress
    unsubscribers.push(
      window.electron.venv.onProgress((progress) => {
        get().setVenvProgress(progress)
      })
    )

    // Return cleanup function
    return () => {
      unsubscribers.forEach(unsub => unsub())
    }
  }
}))

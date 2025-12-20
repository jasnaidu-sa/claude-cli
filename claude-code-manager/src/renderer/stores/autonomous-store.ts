/**
 * Autonomous Coding Store (Zustand)
 *
 * Manages state for the autonomous coding system including:
 * - Phase management (project_select → discovery_chat → spec_review → executing → completed)
 * - Workflows (WorkflowConfig)
 * - Orchestrator sessions (OrchestratorSession)
 * - Progress tracking (ProgressSnapshot)
 * - Schema validation (SchemaValidationResult)
 * - Python venv status (VenvStatus)
 * - Discovery chat state
 * - Generated spec state
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

// Phase types for the autonomous workflow (Option C: Full Architecture)
export type AutonomousPhase =
  | 'project_select'      // Phase 0a: User selects new or existing project
  | 'preflight'           // Phase 0b: Environment validation (venv, schema, etc.)
  | 'journey_analysis'    // Phase 1: Automatic user journey analysis (brownfield only)
  | 'discovery_chat'      // Phase 2: User describes what they want (conversation only)
  | 'spec_generating'     // Phase 3: Background spec generation
  | 'spec_review'         // Phase 4: User reviews and approves generated spec
  | 'executing'           // Phase 5: Python orchestrator running
  | 'completed'           // Phase 6: All tests pass, ready for commit

// Pre-flight check status
export interface PreflightStatus {
  venvReady: boolean
  schemaFresh: boolean
  mcpConfigured: boolean
  gitClean: boolean
  errors: string[]
  warnings: string[]
}

// User journey analysis result
export interface JourneyAnalysis {
  completed: boolean
  userFlows: string[]
  entryPoints: string[]
  dataModels: string[]
  techStack: string[]
  patterns: string[]
  summary: string
}

// Chat message for discovery chat
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
}

// Agent status for visibility in UI
export interface AgentStatus {
  name: string
  status: 'idle' | 'running' | 'complete' | 'error'
  output?: string
  error?: string
}

// Generated spec structure
export interface GeneratedSpec {
  markdown: string          // Human-readable markdown
  appSpecTxt: string        // Plain text for Python (app_spec.txt)
  sections: SpecSection[]   // Parsed sections for editing
  featureCount: number      // Number of features extracted
  readyForExecution: boolean
}

export interface SpecSection {
  id: string
  title: string
  content: string
  editable: boolean
}

// Schema validation status type
type SchemaStatus = 'idle' | 'validating' | 'complete' | 'error'

// Selected project for autonomous workflow
export interface SelectedProject {
  path: string
  name: string
  isNew: boolean
}

interface AutonomousState {
  // Phase Management (Option C flow)
  currentPhase: AutonomousPhase
  selectedProject: SelectedProject | null
  preflightStatus: PreflightStatus | null
  journeyAnalysis: JourneyAnalysis | null
  
  // Discovery Chat State
  chatMessages: ChatMessage[]
  agentStatuses: AgentStatus[]
  
  // Spec Generation State
  generatedSpec: GeneratedSpec | null

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

  // Phase Management Actions
  setPhase: (phase: AutonomousPhase) => void
  goToNextPhase: () => void
  goToPreviousPhase: () => void
  setSelectedProject: (project: SelectedProject | null) => void
  setPreflightStatus: (status: PreflightStatus | null) => void
  setJourneyAnalysis: (analysis: JourneyAnalysis | null) => void
  addChatMessage: (message: Omit<ChatMessage, 'id' | 'timestamp'>) => void
  clearChatMessages: () => void
  updateAgentStatus: (name: string, status: AgentStatus['status'], output?: string, error?: string) => void
  clearAgentStatuses: () => void
  setGeneratedSpec: (spec: GeneratedSpec | null) => void
  resetPhaseState: () => void
  canGoBack: () => boolean
  canGoForward: () => boolean
  getCurrentPhaseIndex: () => number

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

// Phase order for navigation
const PHASE_ORDER: AutonomousPhase[] = [
  'project_select',
  'preflight',
  'journey_analysis',
  'discovery_chat',
  'spec_generating',
  'spec_review',
  'executing',
  'completed'
]

const MIN_DISCOVERY_MESSAGES = 4

export const useAutonomousStore = create<AutonomousState>((set, get) => ({
  // Initial state - Phase Management (Option C flow)
  currentPhase: 'project_select',
  selectedProject: null,
  preflightStatus: null,
  journeyAnalysis: null,
  
  // Discovery Chat
  chatMessages: [],
  agentStatuses: [],
  
  // Spec Generation
  generatedSpec: null,

  // Workflows
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

  // Phase Management Actions
  setPhase: (phase: AutonomousPhase) => {
    set({ currentPhase: phase })
  },

  goToNextPhase: () => {
    const state = get()
    const currentIndex = PHASE_ORDER.indexOf(state.currentPhase)
    if (currentIndex < PHASE_ORDER.length - 1) {
      const nextPhase = PHASE_ORDER[currentIndex + 1]
      // Skip journey_analysis - codebase analysis happens during spec generation
      // after user conversation and complexity determination
      if (nextPhase === 'journey_analysis') {
        set({ currentPhase: 'discovery_chat' })
      } else {
        set({ currentPhase: nextPhase })
      }
    }
  },

  goToPreviousPhase: () => {
    const state = get()
    const currentIndex = PHASE_ORDER.indexOf(state.currentPhase)
    if (currentIndex > 0) {
      const prevPhase = PHASE_ORDER[currentIndex - 1]
      // Skip journey_analysis when going back
      if (prevPhase === 'journey_analysis') {
        set({ currentPhase: 'preflight' })
      } else {
        set({ currentPhase: prevPhase })
      }
    }
  },

  setSelectedProject: (project: SelectedProject | null) => {
    // Clear all phase state when changing projects
    set({
      selectedProject: project,
      preflightStatus: null,
      journeyAnalysis: null,
      chatMessages: [],
      agentStatuses: [],
      generatedSpec: null
    })
  },
  
  setPreflightStatus: (status: PreflightStatus | null) => {
    set({ preflightStatus: status })
  },
  
  setJourneyAnalysis: (analysis: JourneyAnalysis | null) => {
    set({ journeyAnalysis: analysis })
  },

  addChatMessage: (message: Omit<ChatMessage, 'id' | 'timestamp'>) => {
    const newMessage: ChatMessage = {
      ...message,
      id: crypto.randomUUID(),
      timestamp: Date.now()
    }
    set((state) => ({
      chatMessages: [...state.chatMessages, newMessage]
    }))
  },

  clearChatMessages: () => {
    set({ chatMessages: [] })
  },

  updateAgentStatus: (name: string, status: AgentStatus['status'], output?: string, error?: string) => {
    set((state) => {
      const existingIndex = state.agentStatuses.findIndex(a => a.name === name)
      const newStatus: AgentStatus = { name, status, output, error }

      if (existingIndex >= 0) {
        const agentStatuses = [...state.agentStatuses]
        agentStatuses[existingIndex] = newStatus
        return { agentStatuses }
      } else {
        return { agentStatuses: [...state.agentStatuses, newStatus] }
      }
    })
  },

  clearAgentStatuses: () => {
    set({ agentStatuses: [] })
  },

  setGeneratedSpec: (spec: GeneratedSpec | null) => {
    set({ generatedSpec: spec })
  },

  resetPhaseState: () => {
    set({
      currentPhase: 'project_select',
      selectedProject: null,
      preflightStatus: null,
      journeyAnalysis: null,
      chatMessages: [],
      agentStatuses: [],
      generatedSpec: null,
      activeWorkflowId: null
    })
  },

  canGoBack: () => {
    const state = get()
    const currentIndex = PHASE_ORDER.indexOf(state.currentPhase)
    // Can go back from most phases except executing and completed
    return currentIndex > 0 && currentIndex < 6
  },

  canGoForward: () => {
    const state = get()
    
    switch (state.currentPhase) {
      case 'project_select':
        return state.selectedProject !== null
      case 'preflight':
        return state.preflightStatus !== null && state.preflightStatus.errors.length === 0
      case 'journey_analysis':
        // Journey analysis is now skipped - always return true
        return true
      case 'discovery_chat':
        // Require minimum messages before advancing
        const userMessages = state.chatMessages.filter(m => m.role === 'user').length
        return userMessages >= MIN_DISCOVERY_MESSAGES
      case 'spec_generating':
        return state.generatedSpec !== null
      case 'spec_review':
        return state.generatedSpec !== null
      default:
        return false
    }
  },

  getCurrentPhaseIndex: () => {
    return PHASE_ORDER.indexOf(get().currentPhase)
  },

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

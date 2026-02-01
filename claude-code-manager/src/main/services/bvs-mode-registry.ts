/**
 * BVS Mode Registry Service
 *
 * Manages BVS mode transitions with conflict detection and state persistence.
 * Ensures only one mode is active at a time and validates transitions.
 */

import * as fs from 'fs/promises'
import * as path from 'path'

// Types
export type BvsMode = 'idle' | 'planning' | 'decomposing' | 'executing' | 'validating' | 'integrating'

export interface ModeConfig {
  name: string
  exclusive: boolean
  allowedTransitionsFrom: BvsMode[]
  allowsSubMode: BvsMode[]
}

export interface ModeState {
  currentMode: BvsMode
  modeData?: Record<string, unknown>
  enteredAt: string
  projectId?: string
  sessionId?: string
  activeSubModes: BvsMode[]
}

export interface ModeContext {
  projectId?: string
  sessionId?: string
}

export interface ModeTransitionResult {
  allowed: boolean
  reason?: string
  conflictingMode?: BvsMode
  suggestion?: string
}

// Mode configurations
export const MODE_CONFIGS: Record<BvsMode, ModeConfig> = {
  idle: {
    name: 'Idle',
    exclusive: false,
    allowedTransitionsFrom: ['idle', 'planning', 'decomposing', 'executing', 'validating', 'integrating'],
    allowsSubMode: [],
  },
  planning: {
    name: 'Planning',
    exclusive: true,
    allowedTransitionsFrom: ['idle', 'planning'],
    allowsSubMode: [],
  },
  decomposing: {
    name: 'Decomposing',
    exclusive: true,
    allowedTransitionsFrom: ['planning', 'decomposing'],
    allowsSubMode: [],
  },
  executing: {
    name: 'Executing',
    exclusive: true,
    allowedTransitionsFrom: ['decomposing', 'executing', 'integrating'],
    allowsSubMode: ['validating'],
  },
  validating: {
    name: 'Validating',
    exclusive: false,
    allowedTransitionsFrom: ['executing'],
    allowsSubMode: [],
  },
  integrating: {
    name: 'Integrating',
    exclusive: true,
    allowedTransitionsFrom: ['executing', 'integrating'],
    allowsSubMode: [],
  },
}

// Custom error for mode conflicts
export class ModeConflictError extends Error {
  constructor(message: string, public conflictingMode?: BvsMode) {
    super(message)
    this.name = 'ModeConflictError'
  }
}

/**
 * BVS Mode Registry
 *
 * Manages mode transitions for the BVS system. Enforces:
 * - Valid mode transitions (e.g., planning → decomposing → executing)
 * - Exclusive mode access (only one project/session at a time)
 * - Context continuity (project/session IDs must match across workflow)
 * - Sub-mode support (validating can run within executing)
 *
 * State is persisted to `.bvs/mode-state.json` in the workspace.
 *
 * @example
 * ```typescript
 * const registry = new BvsModeRegistry('/path/to/workspace')
 *
 * // Check if transition is allowed
 * const result = registry.canEnterMode('planning', { projectId: 'proj-1' })
 * if (result.allowed) {
 *   await registry.enterMode('planning', { projectId: 'proj-1' })
 * }
 *
 * // Subscribe to changes
 * const unsubscribe = registry.onModeChange((state) => {
 *   console.log('Mode changed:', state.currentMode)
 * })
 * ```
 */
export class BvsModeRegistry {
  private state: ModeState
  private workspaceDir: string
  private stateFilePath: string
  private listeners: Array<(state: ModeState) => void> = []
  private stateChangeMutex: Promise<void> = Promise.resolve()
  private initialized = false

  /**
   * Create a new mode registry
   * @param workspaceDir - Path to workspace directory (will store state in .bvs/mode-state.json)
   */
  constructor(workspaceDir: string) {
    // Validate and sanitize workspace path to prevent path traversal
    const normalizedPath = path.normalize(workspaceDir)
    if (normalizedPath.includes('..') || !path.isAbsolute(normalizedPath)) {
      throw new Error('Workspace path must be an absolute path without traversal')
    }

    this.workspaceDir = normalizedPath
    this.stateFilePath = path.join(normalizedPath, '.bvs', 'mode-state.json')
    // Initialize with default state - actual load happens async
    this.state = this.getDefaultState()
  }

  /**
   * Factory method for async initialization (recommended)
   */
  static async create(workspaceDir: string): Promise<BvsModeRegistry> {
    const registry = new BvsModeRegistry(workspaceDir)
    await registry.initialize()
    return registry
  }

  /**
   * Initialize by loading state from disk (async)
   */
  async initialize(): Promise<void> {
    if (this.initialized) return
    this.state = await this.loadStateAsync()
    this.initialized = true
  }

  /**
   * Get default state
   */
  private getDefaultState(): ModeState {
    return {
      currentMode: 'idle',
      enteredAt: new Date().toISOString(),
      activeSubModes: [],
    }
  }

  /**
   * Get current mode state (returns a deep copy to prevent mutation)
   * @returns Current mode state
   */
  getState(): ModeState {
    return {
      ...this.state,
      activeSubModes: [...this.state.activeSubModes]
    }
  }

  /**
   * Check if a mode can be entered without actually entering it
   * @param mode - Mode to check
   * @param context - Optional context (projectId, sessionId)
   * @returns Result indicating if transition is allowed and reason if not
   */
  canEnterMode(mode: BvsMode, context?: ModeContext): ModeTransitionResult {
    const config = MODE_CONFIGS[mode]

    // Idle can always be entered
    if (mode === 'idle') {
      return { allowed: true }
    }

    // Check if mode is a sub-mode
    const isSubMode = mode === 'validating'
    if (isSubMode) {
      // Find parent modes that allow this sub-mode
      const validParents = Object.entries(MODE_CONFIGS)
        .filter(([_, cfg]) => cfg.allowsSubMode.includes(mode))
        .map(([parentMode]) => parentMode)

      if (validParents.length === 0) {
        return {
          allowed: false,
          reason: `${config.name} mode cannot be entered independently`,
        }
      }

      // Check if current mode is a valid parent
      if (!validParents.includes(this.state.currentMode)) {
        return {
          allowed: false,
          reason: `${config.name} can only be entered as sub-mode of: ${validParents.join(', ')}`,
          suggestion: `First enter one of: ${validParents.join(', ')}`,
        }
      }

      // Validate context matches parent mode context
      if (context) {
        if (context.projectId && this.state.projectId !== context.projectId) {
          return {
            allowed: false,
            reason: 'Sub-mode project context must match parent mode',
          }
        }
        if (context.sessionId && this.state.sessionId !== context.sessionId) {
          return {
            allowed: false,
            reason: 'Sub-mode session context must match parent mode',
          }
        }
      }

      // Sub-mode can be entered
      return { allowed: true }
    }

    // For non-sub-modes, check if transition is allowed from current mode
    if (!config.allowedTransitionsFrom.includes(this.state.currentMode)) {
      return {
        allowed: false,
        reason: `Cannot enter ${config.name} mode from ${MODE_CONFIGS[this.state.currentMode].name} mode`,
        conflictingMode: this.state.currentMode,
        suggestion: `${config.name} can only be entered from: ${config.allowedTransitionsFrom.map(m => MODE_CONFIGS[m].name).join(', ')}`,
      }
    }

    // Check if trying to re-enter same exclusive mode with different context
    if (config.exclusive && this.state.currentMode === mode) {
      // Check context match
      if (context?.projectId && this.state.projectId !== context.projectId) {
        return {
          allowed: false,
          reason: `Cannot enter ${config.name} mode: already in ${config.name} mode with different project context`,
          conflictingMode: this.state.currentMode,
          suggestion: 'Exit current mode first or use force reset',
        }
      }
      if (context?.sessionId && this.state.sessionId !== context.sessionId) {
        return {
          allowed: false,
          reason: `Cannot enter ${config.name} mode: already in ${config.name} mode with different session context`,
          conflictingMode: this.state.currentMode,
          suggestion: 'Exit current mode first or use force reset',
        }
      }
      // Same context or no context provided, allow re-entry
      return { allowed: true }
    }

    // Validate context requirements
    if (mode === 'executing' && !context?.sessionId) {
      return {
        allowed: false,
        reason: 'Executing mode requires sessionId in context',
      }
    }

    // Check project context continuity for workflow modes
    if (
      (mode === 'decomposing' || mode === 'executing' || mode === 'integrating') &&
      this.state.currentMode !== 'idle' &&
      this.state.projectId &&
      context?.projectId &&
      this.state.projectId !== context.projectId
    ) {
      return {
        allowed: false,
        reason: `Cannot enter ${config.name} mode: project context mismatch (current: ${this.state.projectId}, requested: ${context.projectId})`,
        suggestion: 'Complete current project workflow or reset to idle',
      }
    }

    return { allowed: true }
  }

  /**
   * Enter a mode (or sub-mode)
   * @param mode - Mode to enter
   * @param context - Context (projectId, sessionId) for the mode
   * @throws ModeConflictError if transition is not allowed
   */
  async enterMode(mode: BvsMode, context?: ModeContext): Promise<void> {
    // Use mutex to prevent race conditions
    await this.stateChangeMutex
    this.stateChangeMutex = this.enterModeInternal(mode, context)
    await this.stateChangeMutex
  }

  private async enterModeInternal(mode: BvsMode, context?: ModeContext): Promise<void> {
    const result = this.canEnterMode(mode, context)
    if (!result.allowed) {
      throw new ModeConflictError(result.reason || 'Mode transition not allowed', result.conflictingMode)
    }

    const isSubMode = mode === 'validating'

    if (isSubMode) {
      // Add to sub-modes
      if (!this.state.activeSubModes.includes(mode)) {
        this.state.activeSubModes = [...this.state.activeSubModes, mode]
      }
    } else {
      // Change primary mode
      this.state.currentMode = mode
      this.state.enteredAt = new Date().toISOString()
      this.state.activeSubModes = []

      // Update context
      if (mode === 'idle') {
        this.state.projectId = undefined
        this.state.sessionId = undefined
        this.state.modeData = undefined
      } else {
        if (context?.projectId) {
          this.state.projectId = context.projectId
        }
        if (context?.sessionId) {
          this.state.sessionId = context.sessionId
        }
      }
    }

    await this.saveState()
    this.notifyListeners()
  }

  /**
   * Exit current mode or sub-mode
   * - If in a sub-mode, exits the sub-mode and returns to parent mode
   * - Otherwise, exits to idle mode
   */
  async exitMode(): Promise<void> {
    // Use mutex to prevent race conditions
    await this.stateChangeMutex
    this.stateChangeMutex = this.exitModeInternal()
    await this.stateChangeMutex
  }

  private async exitModeInternal(): Promise<void> {
    if (this.state.activeSubModes.length > 0) {
      // Exit sub-mode
      this.state.activeSubModes = []
    } else if (this.state.currentMode !== 'idle') {
      // Exit to idle
      this.state.currentMode = 'idle'
      this.state.enteredAt = new Date().toISOString()
      this.state.projectId = undefined
      this.state.sessionId = undefined
      this.state.modeData = undefined
    }

    await this.saveState()
    this.notifyListeners()
  }

  /**
   * Force reset to idle mode (bypasses all transition checks)
   * Use this for error recovery or system reset scenarios
   */
  async forceReset(): Promise<void> {
    // Use mutex to prevent race conditions
    await this.stateChangeMutex
    this.stateChangeMutex = this.forceResetInternal()
    await this.stateChangeMutex
  }

  private async forceResetInternal(): Promise<void> {
    this.state.currentMode = 'idle'
    this.state.enteredAt = new Date().toISOString()
    this.state.projectId = undefined
    this.state.sessionId = undefined
    this.state.modeData = undefined
    this.state.activeSubModes = []

    await this.saveState()
    this.notifyListeners()
  }

  /**
   * Subscribe to mode change events
   * @param callback - Function called whenever mode changes
   * @returns Unsubscribe function
   */
  onModeChange(callback: (state: ModeState) => void): () => void {
    this.listeners.push(callback)
    return () => {
      this.listeners = this.listeners.filter(l => l !== callback)
    }
  }

  /**
   * Load state from file (async - preferred)
   */
  private async loadStateAsync(): Promise<ModeState> {
    try {
      const fileContent = await fs.readFile(this.stateFilePath, 'utf-8')
      const loadedState = JSON.parse(fileContent)
      return {
        currentMode: loadedState.currentMode || 'idle',
        modeData: loadedState.modeData,
        enteredAt: loadedState.enteredAt || new Date().toISOString(),
        projectId: loadedState.projectId,
        sessionId: loadedState.sessionId,
        activeSubModes: loadedState.activeSubModes || [],
      }
    } catch (error) {
      // File doesn't exist or is corrupted, return default state
      return this.getDefaultState()
    }
  }

  /**
   * Save state to file
   */
  private async saveState(): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.stateFilePath), { recursive: true })
      await fs.writeFile(this.stateFilePath, JSON.stringify(this.state, null, 2))
    } catch (error) {
      console.error('Failed to save mode state:', error)
    }
  }

  /**
   * Notify all listeners
   */
  private notifyListeners(): void {
    const stateCopy = { ...this.state }
    this.listeners.forEach(listener => {
      try {
        listener(stateCopy)
      } catch (error) {
        console.error('Error in mode change listener:', error)
      }
    })
  }
}

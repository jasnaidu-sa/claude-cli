/**
 * SchemaValidator - Schema Validation Integration Service
 *
 * Integrates with the OrchestratorRunner to trigger schema validation
 * and parse the results from .autonomous/schema_validation.json.
 *
 * Features:
 * - Triggers validation phase via orchestrator
 * - Parses and caches validation results
 * - Provides status updates during validation
 * - Stores validation history
 *
 * Validation Flow:
 * 1. Trigger orchestrator with phase='validation'
 * 2. Wait for orchestrator to complete
 * 3. Parse .autonomous/schema_validation.json
 * 4. Cache and return results
 */

import { EventEmitter } from 'events'
import * as fs from 'fs/promises'
import * as path from 'path'
import { getMainWindow } from '../index'
import { IPC_CHANNELS } from '@shared/types'
import { orchestratorRunner } from './orchestrator-runner'
import type {
  SchemaValidationResult,
  SchemaDiscrepancy,
  OrchestratorSession
} from '@shared/types'

// Directory and file names
const AUTONOMOUS_DIR = '.autonomous'
const VALIDATION_FILE = 'schema_validation.json'

/**
 * Validation status
 */
export type ValidationStatus = 'idle' | 'running' | 'completed' | 'error'

/**
 * Validation state for a project
 */
interface ValidationState {
  projectPath: string
  status: ValidationStatus
  sessionId?: string
  result?: SchemaValidationResult
  error?: string
  startedAt?: number
  completedAt?: number
}

/**
 * Extract error message safely from unknown error type
 */
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return String(error)
}

/**
 * Validate path to prevent directory traversal attacks
 */
function validatePath(basePath: string, targetPath: string): boolean {
  const resolvedBase = path.resolve(basePath)
  const resolvedTarget = path.resolve(targetPath)
  return resolvedTarget.startsWith(resolvedBase + path.sep) || resolvedTarget === resolvedBase
}

/**
 * SchemaValidator Service Class
 */
export class SchemaValidator extends EventEmitter {
  private validationStates: Map<string, ValidationState> = new Map()

  constructor() {
    super()

    // Listen for orchestrator session updates
    orchestratorRunner.on('session', (session: OrchestratorSession) => {
      this.handleOrchestratorSession(session)
    })
  }

  /**
   * Get or create validation state for a project
   */
  private getState(projectPath: string): ValidationState {
    if (!this.validationStates.has(projectPath)) {
      this.validationStates.set(projectPath, {
        projectPath,
        status: 'idle'
      })
    }
    return this.validationStates.get(projectPath)!
  }

  /**
   * Trigger schema validation for a project
   */
  async validate(
    projectPath: string,
    workflowId: string,
    model?: string
  ): Promise<{ success: boolean; sessionId?: string; error?: string }> {
    const state = this.getState(projectPath)

    // Check if already running
    if (state.status === 'running') {
      return { success: false, error: 'Validation already in progress' }
    }

    try {
      // Start orchestrator with validation phase
      const session = await orchestratorRunner.start({
        projectPath,
        workflowId,
        phase: 'validation',
        model
      })

      // Update state
      state.status = 'running'
      state.sessionId = session.id
      state.startedAt = Date.now()
      state.result = undefined
      state.error = undefined

      // Emit status update
      this.emitStatus(projectPath, 'running')

      return { success: true, sessionId: session.id }
    } catch (error) {
      state.status = 'error'
      state.error = getErrorMessage(error)
      this.emitStatus(projectPath, 'error', state.error)
      return { success: false, error: state.error }
    }
  }

  /**
   * Handle orchestrator session updates
   */
  private async handleOrchestratorSession(session: OrchestratorSession): Promise<void> {
    // Find matching validation state
    for (const [projectPath, state] of this.validationStates) {
      if (state.sessionId === session.id) {
        if (session.status === 'completed') {
          // Validation completed - parse results
          await this.parseValidationResult(projectPath)
        } else if (session.status === 'error') {
          state.status = 'error'
          state.error = session.error || 'Validation failed'
          state.completedAt = Date.now()
          this.emitStatus(projectPath, 'error', state.error)
        }
        break
      }
    }
  }

  /**
   * Parse validation result from file
   */
  private async parseValidationResult(projectPath: string): Promise<void> {
    const state = this.getState(projectPath)
    const validationFile = path.join(projectPath, AUTONOMOUS_DIR, VALIDATION_FILE)

    // Validate path
    if (!validatePath(projectPath, validationFile)) {
      state.status = 'error'
      state.error = 'Invalid validation file path'
      this.emitStatus(projectPath, 'error', state.error)
      return
    }

    try {
      const content = await fs.readFile(validationFile, 'utf-8')
      const result = JSON.parse(content) as SchemaValidationResult

      // Validate result structure
      if (typeof result.valid !== 'boolean' || !Array.isArray(result.discrepancies)) {
        throw new Error('Invalid validation result format')
      }

      state.status = 'completed'
      state.result = result
      state.completedAt = Date.now()

      this.emitStatus(projectPath, 'completed')
      this.emit('validated', { projectPath, result })
    } catch (error) {
      state.status = 'error'
      state.error = `Failed to parse validation result: ${getErrorMessage(error)}`
      state.completedAt = Date.now()
      this.emitStatus(projectPath, 'error', state.error)
    }
  }

  /**
   * Get validation result for a project
   */
  async getResult(projectPath: string): Promise<SchemaValidationResult | null> {
    const state = this.getState(projectPath)

    // Return cached result if available
    if (state.result) {
      return state.result
    }

    // Try to load from file
    const validationFile = path.join(projectPath, AUTONOMOUS_DIR, VALIDATION_FILE)
    if (!validatePath(projectPath, validationFile)) {
      return null
    }

    try {
      const content = await fs.readFile(validationFile, 'utf-8')
      const result = JSON.parse(content) as SchemaValidationResult
      state.result = result
      return result
    } catch {
      return null
    }
  }

  /**
   * Get validation status for a project
   */
  getStatus(projectPath: string): ValidationState {
    return this.getState(projectPath)
  }

  /**
   * Clear validation result for a project
   */
  async clear(projectPath: string): Promise<void> {
    const state = this.getState(projectPath)
    state.status = 'idle'
    state.result = undefined
    state.error = undefined
    state.sessionId = undefined

    // Delete validation file
    const validationFile = path.join(projectPath, AUTONOMOUS_DIR, VALIDATION_FILE)
    if (validatePath(projectPath, validationFile)) {
      try {
        await fs.unlink(validationFile)
      } catch {
        // Ignore if file doesn't exist
      }
    }

    this.emitStatus(projectPath, 'idle')
  }

  /**
   * Emit status update to renderer
   */
  private emitStatus(projectPath: string, status: ValidationStatus, error?: string): void {
    const mainWindow = getMainWindow()
    if (mainWindow) {
      mainWindow.webContents.send(IPC_CHANNELS.SCHEMA_STATUS, {
        projectPath,
        status,
        error,
        timestamp: Date.now()
      })
    }
  }

  /**
   * Get summary statistics for validation result
   */
  getResultSummary(result: SchemaValidationResult): {
    total: number
    errors: number
    warnings: number
    byType: Record<string, number>
  } {
    const summary = {
      total: result.discrepancies.length,
      errors: 0,
      warnings: 0,
      byType: {} as Record<string, number>
    }

    for (const discrepancy of result.discrepancies) {
      if (discrepancy.severity === 'error') {
        summary.errors++
      } else {
        summary.warnings++
      }

      summary.byType[discrepancy.type] = (summary.byType[discrepancy.type] || 0) + 1
    }

    return summary
  }
}

// Export singleton instance
export const schemaValidator = new SchemaValidator()

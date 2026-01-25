/**
 * BVS TypeScript Verification Service
 *
 * Provides TypeScript type checking capabilities for the BVS workflow.
 * Supports both incremental (after each edit) and full (quality gate) modes.
 *
 * Key features:
 * - Incremental compilation using .tsbuildinfo
 * - Error parsing with file:line:column references
 * - Integration with BVS orchestrator for immediate feedback
 */

import { EventEmitter } from 'events'
import { spawn } from 'child_process'
import * as path from 'path'
import * as fs from 'fs/promises'
import {
  type BvsTypeCheckResult,
  type BvsTypeError,
  BVS_IPC_CHANNELS,
} from '@shared/bvs-types'
import { getMainWindow } from '../index'

// TypeScript error pattern: src/file.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.
const TS_ERROR_PATTERN = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.+)$/

/**
 * BVS TypeScript Verification Service
 */
export class BvsTypeCheckService extends EventEmitter {
  private lastCheckTime: Map<string, number> = new Map()
  private checkInProgress: Map<string, boolean> = new Map()

  constructor() {
    super()
  }

  /**
   * Send event to renderer process
   */
  private sendToRenderer(channel: string, data: unknown): void {
    const mainWindow = getMainWindow()
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, data)
    }
  }

  /**
   * Run incremental TypeScript check
   *
   * Uses tsc --incremental --noEmit for fast checking after edits.
   * Typical time: 500ms - 2s depending on project size.
   */
  async runIncrementalCheck(
    projectPath: string,
    command?: string
  ): Promise<BvsTypeCheckResult> {
    const cmd = command || 'npx tsc --incremental --noEmit'
    return this.runTypeCheck(projectPath, cmd, 'incremental')
  }

  /**
   * Run full TypeScript check
   *
   * Uses tsc --noEmit for complete type checking.
   * Used at quality gates and after parallel merges.
   */
  async runFullCheck(
    projectPath: string,
    command?: string
  ): Promise<BvsTypeCheckResult> {
    const cmd = command || 'npx tsc --noEmit'
    return this.runTypeCheck(projectPath, cmd, 'full')
  }

  /**
   * Run TypeScript check with specified command
   */
  private async runTypeCheck(
    projectPath: string,
    command: string,
    mode: 'incremental' | 'full'
  ): Promise<BvsTypeCheckResult> {
    // Prevent concurrent checks on same project
    if (this.checkInProgress.get(projectPath)) {
      throw new Error('TypeCheck already in progress for this project')
    }

    this.checkInProgress.set(projectPath, true)
    const startTime = Date.now()

    try {
      const result = await this.executeTypeCheck(projectPath, command)
      const duration = Date.now() - startTime

      this.lastCheckTime.set(projectPath, Date.now())

      const checkResult: BvsTypeCheckResult = {
        passed: result.exitCode === 0,
        errors: result.errors,
        duration,
        command,
        output: result.output,
      }

      // Emit result
      this.emit('typecheck-complete', { projectPath, mode, result: checkResult })

      return checkResult
    } finally {
      this.checkInProgress.set(projectPath, false)
    }
  }

  /**
   * Execute TypeScript check command
   */
  private executeTypeCheck(
    projectPath: string,
    command: string
  ): Promise<{ exitCode: number; errors: BvsTypeError[]; output: string }> {
    return new Promise((resolve) => {
      const [cmd, ...args] = command.split(' ')
      let stdout = ''
      let stderr = ''

      const proc = spawn(cmd, args, {
        cwd: projectPath,
        shell: true,
        env: {
          ...process.env,
          FORCE_COLOR: '0', // Disable colors for easier parsing
        },
      })

      proc.stdout?.on('data', (data) => {
        stdout += data.toString()
      })

      proc.stderr?.on('data', (data) => {
        stderr += data.toString()
      })

      proc.on('close', (code) => {
        const output = stdout + stderr
        const errors = this.parseTypeScriptErrors(output, projectPath)

        resolve({
          exitCode: code || 0,
          errors,
          output: output.trim(),
        })
      })

      proc.on('error', (error) => {
        resolve({
          exitCode: 1,
          errors: [{
            file: 'unknown',
            line: 0,
            column: 0,
            code: 'EXEC_ERROR',
            message: error.message,
            severity: 'error',
          }],
          output: error.message,
        })
      })
    })
  }

  /**
   * Parse TypeScript errors from output
   */
  private parseTypeScriptErrors(output: string, projectPath: string): BvsTypeError[] {
    const errors: BvsTypeError[] = []
    const lines = output.split('\n')

    for (const line of lines) {
      const match = line.match(TS_ERROR_PATTERN)
      if (match) {
        const [, file, lineStr, colStr, severityStr, code, message] = match

        // Normalize file path
        const normalizedFile = path.isAbsolute(file)
          ? path.relative(projectPath, file)
          : file

        errors.push({
          file: normalizedFile,
          line: parseInt(lineStr, 10),
          column: parseInt(colStr, 10),
          code,
          message: message.trim(),
          severity: severityStr === 'error' ? 'error' : 'warning',
        })
      }
    }

    return errors
  }

  /**
   * Check if tsconfig.json exists in project
   */
  async hasTsConfig(projectPath: string): Promise<boolean> {
    try {
      await fs.access(path.join(projectPath, 'tsconfig.json'))
      return true
    } catch {
      return false
    }
  }

  /**
   * Get time since last check
   */
  getTimeSinceLastCheck(projectPath: string): number | null {
    const lastTime = this.lastCheckTime.get(projectPath)
    if (!lastTime) return null
    return Date.now() - lastTime
  }

  /**
   * Check if check is currently in progress
   */
  isCheckInProgress(projectPath: string): boolean {
    return this.checkInProgress.get(projectPath) || false
  }

  /**
   * Format errors for display
   */
  formatErrorsForDisplay(errors: BvsTypeError[]): string {
    if (errors.length === 0) {
      return '✓ No type errors'
    }

    return errors
      .map(e => `${e.file}:${e.line}:${e.column} - ${e.severity} ${e.code}: ${e.message}`)
      .join('\n')
  }

  /**
   * Group errors by file
   */
  groupErrorsByFile(errors: BvsTypeError[]): Map<string, BvsTypeError[]> {
    const grouped = new Map<string, BvsTypeError[]>()

    for (const error of errors) {
      const existing = grouped.get(error.file) || []
      existing.push(error)
      grouped.set(error.file, existing)
    }

    return grouped
  }

  /**
   * Get error count by severity
   */
  getErrorCounts(errors: BvsTypeError[]): { errors: number; warnings: number } {
    let errorCount = 0
    let warningCount = 0

    for (const error of errors) {
      if (error.severity === 'error') {
        errorCount++
      } else {
        warningCount++
      }
    }

    return { errors: errorCount, warnings: warningCount }
  }
}

// Singleton instance
let bvsTypeCheckService: BvsTypeCheckService | null = null

export function getBvsTypeCheckService(): BvsTypeCheckService {
  if (!bvsTypeCheckService) {
    bvsTypeCheckService = new BvsTypeCheckService()
  }
  return bvsTypeCheckService
}

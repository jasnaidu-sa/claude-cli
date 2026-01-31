/**
 * BVS Fix Loop Service
 *
 * Implements the UltraQA-style cycling workflow:
 * test → diagnose → fix → repeat (max cycles)
 *
 * Key features:
 * - Cycles up to maxCycles times to fix issues
 * - Same-failure detection (exits early if stuck on same error 3x)
 * - Architect diagnosis before fix attempts
 * - Progress tracking and state persistence
 *
 * Based on OMC's UltraQA pattern.
 */

import { EventEmitter } from 'events'
import * as path from 'path'
import * as fs from 'fs/promises'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

// ============================================================================
// Types
// ============================================================================

export type FixGoalType = 'build' | 'typecheck' | 'lint' | 'tests' | 'custom'

export interface FixLoopConfig {
  maxCycles: number
  sameFailureThreshold: number  // Exit if same failure N times
  timeoutPerCycleMs: number
  projectPath: string
  goal: FixGoalType
  customPattern?: string  // For custom goal type
}

export interface FixLoopState {
  active: boolean
  goalType: FixGoalType
  goalPattern: string | null
  cycle: number
  maxCycles: number
  failures: FailureRecord[]
  startedAt: string
  sessionId: string
  lastOutput?: string
}

export interface FailureRecord {
  cycle: number
  errorSignature: string  // Normalized error for comparison
  fullError: string
  timestamp: number
}

export interface CycleResult {
  cycle: number
  passed: boolean
  output: string
  errorSignature?: string
  diagnosis?: string
  fixApplied?: string
  durationMs: number
}

export interface FixLoopResult {
  success: boolean
  goalType: FixGoalType
  totalCycles: number
  finalOutput: string
  exitReason: 'goal_met' | 'max_cycles' | 'same_failure' | 'error' | 'cancelled'
  cycles: CycleResult[]
  totalDurationMs: number
}

const DEFAULT_CONFIG: Partial<FixLoopConfig> = {
  maxCycles: 5,
  sameFailureThreshold: 3,
  timeoutPerCycleMs: 120000,
}

// ============================================================================
// Fix Loop Service
// ============================================================================

export class BvsFixLoopService extends EventEmitter {
  private state: FixLoopState | null = null
  private cancelled = false

  constructor() {
    super()
  }

  /**
   * Run a fix loop until goal is met or max cycles reached
   */
  async runFixLoop(config: FixLoopConfig): Promise<FixLoopResult> {
    const fullConfig = { ...DEFAULT_CONFIG, ...config } as FixLoopConfig
    const startTime = Date.now()
    const cycles: CycleResult[] = []

    // Initialize state
    this.state = {
      active: true,
      goalType: fullConfig.goal,
      goalPattern: fullConfig.customPattern || null,
      cycle: 0,
      maxCycles: fullConfig.maxCycles,
      failures: [],
      startedAt: new Date().toISOString(),
      sessionId: `fix-${Date.now()}`,
    }
    this.cancelled = false

    console.log(`[FixLoop] Starting fix loop for: ${fullConfig.goal}`)
    console.log(`[FixLoop] Max cycles: ${fullConfig.maxCycles}`)

    // Save initial state
    await this.saveState(fullConfig.projectPath)

    try {
      for (let cycle = 1; cycle <= fullConfig.maxCycles; cycle++) {
        if (this.cancelled) {
          return this.createResult('cancelled', cycles, startTime)
        }

        this.state.cycle = cycle
        this.emit('cycle-start', { cycle, maxCycles: fullConfig.maxCycles })
        console.log(`[FixLoop] Cycle ${cycle}/${fullConfig.maxCycles} - Running ${fullConfig.goal}...`)

        const cycleStart = Date.now()

        // Step 1: Run verification
        const { passed, output, errorSignature } = await this.runVerification(fullConfig)

        if (passed) {
          console.log(`[FixLoop] ✓ Goal met after ${cycle} cycle(s)`)
          cycles.push({
            cycle,
            passed: true,
            output,
            durationMs: Date.now() - cycleStart,
          })
          this.state.active = false
          await this.saveState(fullConfig.projectPath)
          return this.createResult('goal_met', cycles, startTime)
        }

        // Step 2: Check for same failure pattern
        const sameFailureCount = this.countSameFailures(errorSignature!)
        if (sameFailureCount >= fullConfig.sameFailureThreshold) {
          console.log(`[FixLoop] ✗ Same failure detected ${sameFailureCount} times - stopping`)
          cycles.push({
            cycle,
            passed: false,
            output,
            errorSignature,
            durationMs: Date.now() - cycleStart,
          })
          return this.createResult('same_failure', cycles, startTime)
        }

        // Record failure
        this.state.failures.push({
          cycle,
          errorSignature: errorSignature!,
          fullError: output,
          timestamp: Date.now(),
        })
        this.state.lastOutput = output

        console.log(`[FixLoop] Cycle ${cycle} FAILED - ${this.summarizeError(output)}`)

        // Step 3: Diagnose the failure
        this.emit('diagnosing', { cycle, error: output })
        console.log(`[FixLoop] Diagnosing failure...`)
        const diagnosis = await this.diagnoseFailure(fullConfig, output)

        // Step 4: Attempt fix
        this.emit('fixing', { cycle, diagnosis })
        console.log(`[FixLoop] Applying fix...`)
        const fixApplied = await this.applyFix(fullConfig, diagnosis, output)

        cycles.push({
          cycle,
          passed: false,
          output,
          errorSignature,
          diagnosis,
          fixApplied,
          durationMs: Date.now() - cycleStart,
        })

        await this.saveState(fullConfig.projectPath)
        this.emit('cycle-complete', { cycle, passed: false })
      }

      // Max cycles reached
      console.log(`[FixLoop] ✗ Max cycles (${fullConfig.maxCycles}) reached`)
      return this.createResult('max_cycles', cycles, startTime)

    } catch (error: any) {
      console.error(`[FixLoop] Error:`, error)
      return this.createResult('error', cycles, startTime, error.message)
    } finally {
      this.state = null
      await this.clearState(fullConfig.projectPath)
    }
  }

  /**
   * Cancel the current fix loop
   */
  cancel(): void {
    this.cancelled = true
    console.log('[FixLoop] Cancellation requested')
  }

  /**
   * Run verification based on goal type
   */
  private async runVerification(
    config: FixLoopConfig
  ): Promise<{ passed: boolean; output: string; errorSignature?: string }> {
    const commands: Record<FixGoalType, string> = {
      build: 'npm run build',
      typecheck: 'npx tsc --noEmit',
      lint: 'npm run lint',
      tests: 'npm test',
      custom: config.customPattern || 'echo "No custom command"',
    }

    const command = commands[config.goal]

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: config.projectPath,
        timeout: config.timeoutPerCycleMs,
        maxBuffer: 5 * 1024 * 1024,
      })

      const output = stdout + stderr
      return { passed: true, output }
    } catch (error: any) {
      const output = (error.stdout || '') + (error.stderr || '') + (error.message || '')
      const errorSignature = this.createErrorSignature(output)
      return { passed: false, output, errorSignature }
    }
  }

  /**
   * Create a normalized error signature for comparison
   */
  private createErrorSignature(output: string): string {
    // Extract key error patterns, normalizing line numbers and paths
    const lines = output.split('\n')
    const errorLines = lines
      .filter(line =>
        line.includes('error') ||
        line.includes('Error') ||
        line.includes('FAIL') ||
        line.includes('✗')
      )
      .map(line =>
        // Normalize file paths and line numbers
        line
          .replace(/:\d+:\d+/g, ':X:X')  // Normalize line:col
          .replace(/\\/g, '/')  // Normalize path separators
          .replace(/\/[^/]+\//g, '/X/')  // Normalize directory names
          .trim()
      )
      .slice(0, 5)  // Take first 5 unique errors

    return errorLines.join('|')
  }

  /**
   * Count how many times we've seen the same failure
   */
  private countSameFailures(signature: string): number {
    if (!this.state) return 0
    return this.state.failures.filter(f => f.errorSignature === signature).length + 1
  }

  /**
   * Summarize error for logging
   */
  private summarizeError(output: string): string {
    const lines = output.split('\n')
    const errorLine = lines.find(l =>
      l.includes('error') || l.includes('Error') || l.includes('FAIL')
    )
    if (errorLine) {
      return errorLine.substring(0, 100) + (errorLine.length > 100 ? '...' : '')
    }
    return 'Unknown error'
  }

  /**
   * Diagnose the failure to understand root cause
   * In production, this would use an AI agent (architect)
   */
  private async diagnoseFailure(config: FixLoopConfig, output: string): Promise<string> {
    // Extract the most relevant error information
    const lines = output.split('\n')

    // Find error lines with file paths
    const errorWithFile = lines.filter(line =>
      (line.includes('error') || line.includes('Error')) &&
      (line.includes('.ts') || line.includes('.tsx') || line.includes('.js'))
    )

    if (errorWithFile.length > 0) {
      // Parse TypeScript-style errors: file(line,col): error TS1234: message
      const parsed = errorWithFile.map(line => {
        const match = line.match(/([^(]+)\((\d+),(\d+)\):\s*error\s+(\w+):\s*(.+)/)
        if (match) {
          return {
            file: match[1].trim(),
            line: parseInt(match[2]),
            col: parseInt(match[3]),
            code: match[4],
            message: match[5],
          }
        }
        return { raw: line }
      })

      return JSON.stringify(parsed, null, 2)
    }

    // Fallback to raw error lines
    const rawErrors = lines
      .filter(l => l.includes('error') || l.includes('Error'))
      .slice(0, 10)

    return rawErrors.join('\n') || 'Could not extract specific error details'
  }

  /**
   * Apply a fix based on diagnosis
   * In production, this would use an AI agent (build-fixer or executor)
   */
  private async applyFix(
    config: FixLoopConfig,
    diagnosis: string,
    _originalOutput: string
  ): Promise<string> {
    // For now, we just log what we would fix
    // In production, this would:
    // 1. Parse the diagnosis
    // 2. Spawn a build-fixer agent
    // 3. Apply minimal changes
    // 4. Return description of what was fixed

    console.log(`[FixLoop] Diagnosis:`, diagnosis.substring(0, 200))

    // Placeholder - actual fix would be applied by agent
    return 'Fix would be applied by build-fixer agent'
  }

  /**
   * Create the final result
   */
  private createResult(
    exitReason: FixLoopResult['exitReason'],
    cycles: CycleResult[],
    startTime: number,
    errorMessage?: string
  ): FixLoopResult {
    return {
      success: exitReason === 'goal_met',
      goalType: this.state?.goalType || 'build',
      totalCycles: cycles.length,
      finalOutput: cycles.length > 0
        ? cycles[cycles.length - 1].output
        : errorMessage || 'No output',
      exitReason,
      cycles,
      totalDurationMs: Date.now() - startTime,
    }
  }

  /**
   * Save state to file for recovery
   */
  private async saveState(projectPath: string): Promise<void> {
    if (!this.state) return

    const statePath = path.join(projectPath, '.bvs', 'fix-loop-state.json')
    try {
      await fs.mkdir(path.dirname(statePath), { recursive: true })
      await fs.writeFile(statePath, JSON.stringify(this.state, null, 2))
    } catch (e) {
      console.warn('[FixLoop] Failed to save state:', e)
    }
  }

  /**
   * Clear state file
   */
  private async clearState(projectPath: string): Promise<void> {
    const statePath = path.join(projectPath, '.bvs', 'fix-loop-state.json')
    try {
      await fs.unlink(statePath)
    } catch {
      // File might not exist
    }
  }

  /**
   * Load state from file (for recovery)
   */
  async loadState(projectPath: string): Promise<FixLoopState | null> {
    const statePath = path.join(projectPath, '.bvs', 'fix-loop-state.json')
    try {
      const content = await fs.readFile(statePath, 'utf-8')
      return JSON.parse(content)
    } catch {
      return null
    }
  }

  /**
   * Get current state
   */
  getState(): FixLoopState | null {
    return this.state
  }
}

// Export singleton
export const fixLoop = new BvsFixLoopService()

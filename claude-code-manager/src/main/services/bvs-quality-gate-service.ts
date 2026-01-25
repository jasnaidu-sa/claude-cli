/**
 * BVS Quality Gate Service
 *
 * Implements the quality gate system that runs verification after each section:
 * - F4.1 - Lint Runner (npm run lint with parsing)
 * - F4.2 - TypeCheck Runner (full tsc --noEmit)
 * - F4.3 - Test Runner (npm test with result parsing)
 * - F4.4 - Gate Orchestrator (run all, report aggregate)
 * - F4.5 - Fix Attempt Tracker (count attempts, escalate)
 * - F4.6 - Skip with Approval (user override option)
 *
 * Also includes:
 * - F2.4 - Immediate Fix Loop (block until type error fixed)
 * - F4.13 - Auto-Fix Applier (apply fixes for P0/P1 issues)
 * - F4.15 - Re-Review Loop (re-run affected reviewers after fixes)
 */

import { EventEmitter } from 'events'
import { execFile } from 'child_process'
import { promisify } from 'util'
import * as path from 'path'
import {
  type BvsTypeCheckResult,
  type BvsLintResult,
  type BvsTestResult,
  type BvsBuildResult,
  type BvsQualityGateResult,
  type BvsTypeError,
  type BvsLintError,
  BVS_IPC_CHANNELS,
} from '@shared/bvs-types'
import { getMainWindow } from '../index'

const execFileAsync = promisify(execFile)

// ============================================================================
// Types
// ============================================================================

export interface QualityGateConfig {
  lint: {
    enabled: boolean
    command: string
    args: string[]
    autoFix: boolean
  }
  typecheck: {
    enabled: boolean
    command: string
    args: string[]
    incremental: boolean
  }
  tests: {
    enabled: boolean
    command: string
    args: string[]
    coverageThreshold?: number
  }
  build: {
    enabled: boolean
    command: string
    args: string[]
  }
  maxFixAttempts: number
  allowSkip: boolean
  runInParallel: boolean
}

export interface FixAttempt {
  sectionId: string
  attempt: number
  gateType: 'lint' | 'typecheck' | 'tests'
  errors: Array<{ file: string; message: string }>
  timestamp: number
}

const DEFAULT_CONFIG: QualityGateConfig = {
  lint: {
    enabled: true,
    command: 'npm',
    args: ['run', 'lint'],
    autoFix: true,
  },
  typecheck: {
    enabled: true,
    command: 'npx',
    args: ['tsc', '--noEmit'],
    incremental: true,
  },
  tests: {
    enabled: true,
    command: 'npm',
    args: ['test'],
    coverageThreshold: undefined,
  },
  build: {
    enabled: true,
    command: 'npm',
    args: ['run', 'build'],
  },
  maxFixAttempts: 3,
  allowSkip: false,
  runInParallel: false,
}

// ============================================================================
// Quality Gate Service
// ============================================================================

export class BvsQualityGateService extends EventEmitter {
  private config: QualityGateConfig = DEFAULT_CONFIG
  private fixAttempts: Map<string, FixAttempt[]> = new Map()
  private skippedGates: Set<string> = new Set()

  constructor() {
    super()
  }

  /**
   * Send event to renderer
   */
  private sendToRenderer(channel: string, data: unknown): void {
    const mainWindow = getMainWindow()
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, data)
    }
  }

  /**
   * Set configuration
   */
  setConfig(config: Partial<QualityGateConfig>): void {
    this.config = { ...this.config, ...config }
  }

  /**
   * F4.4 - Run all quality gates for a section
   */
  async runQualityGate(
    projectPath: string,
    sectionId: string
  ): Promise<BvsQualityGateResult> {
    const startTime = Date.now()
    const results: BvsQualityGateResult = {
      passed: true,
      typeCheck: { passed: true, errors: [], duration: 0, command: '', output: '' },
      lint: { passed: true, errors: [], warnings: 0, duration: 0, command: '', output: '' },
      tests: { passed: true, testsTotal: 0, testsPassing: 0, testsFailing: 0, duration: 0, command: '', output: '' },
      build: { passed: true, duration: 0, command: '', output: '', errors: [] },
      e2e: [],
      totalDuration: 0,
      completedAt: 0,
    }

    this.sendToRenderer(BVS_IPC_CHANNELS.BVS_EVENT, {
      type: 'quality_gate_started',
      sectionId,
    })

    try {
      if (this.config.runInParallel) {
        // Run in parallel
        const [typeCheck, lint, tests, build] = await Promise.all([
          this.config.typecheck.enabled ? this.runTypeCheck(projectPath) : Promise.resolve(results.typeCheck),
          this.config.lint.enabled ? this.runLint(projectPath) : Promise.resolve(results.lint),
          this.config.tests.enabled ? this.runTests(projectPath) : Promise.resolve(results.tests),
          this.config.build.enabled ? this.runBuild(projectPath) : Promise.resolve(results.build!),
        ])
        results.typeCheck = typeCheck
        results.lint = lint
        results.tests = tests
        results.build = build
      } else {
        // Run sequentially
        if (this.config.typecheck.enabled) {
          results.typeCheck = await this.runTypeCheck(projectPath)
        }
        if (this.config.lint.enabled) {
          results.lint = await this.runLint(projectPath)
        }
        if (this.config.build.enabled) {
          results.build = await this.runBuild(projectPath)
        }
        if (this.config.tests.enabled) {
          results.tests = await this.runTests(projectPath)
        }
      }

      // Determine overall pass/fail
      results.passed = results.typeCheck.passed && results.lint.passed && results.tests.passed && (results.build?.passed ?? true)
      results.totalDuration = Date.now() - startTime
      results.completedAt = Date.now()

      // Track fix attempts if failed
      if (!results.passed) {
        this.trackFixAttempt(sectionId, results)
      }

      // Emit result
      this.sendToRenderer(BVS_IPC_CHANNELS.BVS_QUALITY_GATE_RESULT, {
        sectionId,
        result: results,
      })

      return results
    } catch (error) {
      results.passed = false
      results.totalDuration = Date.now() - startTime
      results.completedAt = Date.now()
      return results
    }
  }

  /**
   * F4.2 - Run TypeScript check
   */
  async runTypeCheck(projectPath: string): Promise<BvsTypeCheckResult> {
    const args = this.config.typecheck.incremental
      ? ['tsc', '--incremental', '--noEmit']
      : this.config.typecheck.args

    const command = `${this.config.typecheck.command} ${args.join(' ')}`

    return this.executeCommand<BvsTypeCheckResult>(
      projectPath,
      this.config.typecheck.command,
      args,
      (output, exitCode) => ({
        passed: exitCode === 0,
        errors: this.parseTypeScriptErrors(output, projectPath),
        duration: 0, // Set by caller
        command,
        output,
      })
    )
  }

  /**
   * F4.1 - Run lint
   */
  async runLint(projectPath: string): Promise<BvsLintResult> {
    const args = this.config.lint.autoFix
      ? [...this.config.lint.args, '--', '--fix']
      : this.config.lint.args

    const command = `${this.config.lint.command} ${args.join(' ')}`

    return this.executeCommand<BvsLintResult>(
      projectPath,
      this.config.lint.command,
      args,
      (output, exitCode) => {
        const errors = this.parseLintErrors(output)
        return {
          passed: exitCode === 0,
          errors,
          warnings: errors.filter(e => e.severity === 'warning').length,
          duration: 0,
          command,
          output,
        }
      }
    )
  }

  /**
   * F4.3 - Run tests
   */
  async runTests(projectPath: string): Promise<BvsTestResult> {
    const command = `${this.config.tests.command} ${this.config.tests.args.join(' ')}`

    return this.executeCommand<BvsTestResult>(
      projectPath,
      this.config.tests.command,
      this.config.tests.args,
      (output, exitCode) => {
        const testStats = this.parseTestOutput(output)
        return {
          passed: exitCode === 0,
          testsTotal: testStats.total,
          testsPassing: testStats.passing,
          testsFailing: testStats.failing,
          failedTests: testStats.failedTests,
          duration: 0,
          command,
          output,
        }
      }
    )
  }

  /**
   * Ralph Loop: Build Verification
   * Runs the project build to catch compilation errors
   */
  async runBuild(projectPath: string): Promise<BvsBuildResult> {
    const command = `${this.config.build.command} ${this.config.build.args.join(' ')}`

    return this.executeCommand<BvsBuildResult>(
      projectPath,
      this.config.build.command,
      this.config.build.args,
      (output, exitCode) => {
        const errors = this.parseBuildErrors(output)
        return {
          passed: exitCode === 0 && errors.length === 0,
          errors,
          duration: 0,
          command,
          output,
        }
      }
    )
  }

  /**
   * F2.4 - Immediate fix loop
   * Blocks until type errors are fixed (with max attempts)
   */
  async immediateFixLoop(
    projectPath: string,
    sectionId: string,
    onError: (errors: BvsTypeError[]) => Promise<boolean> // Returns true if fixed
  ): Promise<boolean> {
    let attempt = 0

    while (attempt < this.config.maxFixAttempts) {
      const result = await this.runTypeCheck(projectPath)

      if (result.passed) {
        return true
      }

      attempt++

      // Emit error for handling
      this.sendToRenderer(BVS_IPC_CHANNELS.BVS_TYPECHECK_RESULT, {
        sectionId,
        result,
        attempt,
        maxAttempts: this.config.maxFixAttempts,
      })

      // Try to fix
      const fixed = await onError(result.errors)
      if (!fixed) {
        break
      }
    }

    return false
  }

  /**
   * F4.5 - Track fix attempts
   */
  private trackFixAttempt(sectionId: string, result: BvsQualityGateResult): void {
    const attempts = this.fixAttempts.get(sectionId) || []

    // Collect all errors
    const errors: Array<{ file: string; message: string }> = []

    if (!result.typeCheck.passed) {
      errors.push(...result.typeCheck.errors.map(e => ({
        file: e.file,
        message: e.message,
      })))
    }

    if (!result.lint.passed) {
      errors.push(...result.lint.errors.map(e => ({
        file: e.file,
        message: e.message,
      })))
    }

    if (result.build && !result.build.passed) {
      errors.push(...result.build.errors.map(e => ({
        file: 'build',
        message: e,
      })))
    }

    if (!result.tests.passed && result.tests.failedTests) {
      errors.push(...result.tests.failedTests.map(t => ({
        file: t.file || 'unknown',
        message: t.error,
      })))
    }

    attempts.push({
      sectionId,
      attempt: attempts.length + 1,
      gateType: !result.typeCheck.passed ? 'typecheck' :
                !result.lint.passed ? 'lint' :
                (result.build && !result.build.passed) ? 'typecheck' : // Build errors treated as typecheck
                'tests',
      errors,
      timestamp: Date.now(),
    })

    this.fixAttempts.set(sectionId, attempts)
  }

  /**
   * Get fix attempt count for a section
   */
  getFixAttemptCount(sectionId: string): number {
    return this.fixAttempts.get(sectionId)?.length || 0
  }

  /**
   * Check if max attempts exceeded
   */
  isMaxAttemptsExceeded(sectionId: string): boolean {
    return this.getFixAttemptCount(sectionId) >= this.config.maxFixAttempts
  }

  /**
   * F4.6 - Skip gate with approval
   */
  skipGate(sectionId: string): boolean {
    if (!this.config.allowSkip) {
      return false
    }
    this.skippedGates.add(sectionId)
    return true
  }

  /**
   * Check if gate was skipped
   */
  wasGateSkipped(sectionId: string): boolean {
    return this.skippedGates.has(sectionId)
  }

  /**
   * Execute a command using execFile (safe from command injection)
   */
  private async executeCommand<T>(
    projectPath: string,
    command: string,
    args: string[],
    parseOutput: (output: string, exitCode: number) => Omit<T, 'duration'>
  ): Promise<T> {
    const startTime = Date.now()

    try {
      const { stdout, stderr } = await execFileAsync(command, args, {
        cwd: projectPath,
        env: {
          ...process.env,
          FORCE_COLOR: '0',
          CI: 'true',
        },
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      })

      const output = stdout + stderr
      const result = parseOutput(output, 0)
      return {
        ...result,
        duration: Date.now() - startTime,
      } as T
    } catch (error: unknown) {
      // Type-safe error handling
      let stdout = ''
      let stderr = ''
      let exitCode = 1

      if (error !== null && typeof error === 'object') {
        const err = error as Record<string, unknown>
        if (typeof err.stdout === 'string') stdout = err.stdout
        if (typeof err.stderr === 'string') stderr = err.stderr
        if (typeof err.code === 'number') exitCode = err.code
      }

      const output = stdout + stderr
      const result = parseOutput(output, exitCode)
      return {
        ...result,
        duration: Date.now() - startTime,
      } as T
    }
  }

  /**
   * Parse TypeScript errors from output
   */
  private parseTypeScriptErrors(output: string, projectPath: string): BvsTypeError[] {
    const errors: BvsTypeError[] = []
    // Create new regex each time to avoid state issues with global flag
    const pattern = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.+)$/gm

    let match
    while ((match = pattern.exec(output)) !== null) {
      const [, file, line, col, severity, code, message] = match
      const lineNum = parseInt(line, 10)
      const colNum = parseInt(col, 10)

      // Validate parsed integers
      if (isNaN(lineNum) || isNaN(colNum)) continue

      errors.push({
        file: path.isAbsolute(file) ? path.relative(projectPath, file) : file,
        line: lineNum,
        column: colNum,
        code,
        message: message.trim(),
        severity: severity === 'error' ? 'error' : 'warning',
      })
    }

    return errors
  }

  /**
   * Parse lint errors from output
   */
  private parseLintErrors(output: string): BvsLintError[] {
    const errors: BvsLintError[] = []

    // ESLint format: /path/file.ts:10:5: error rule-name - Message
    // Create new regex each time to avoid state issues with global flag
    const eslintPattern = /^(.+?):(\d+):(\d+):\s+(error|warning)\s+(.+?)\s+-\s+(.+)$/gm

    let match
    while ((match = eslintPattern.exec(output)) !== null) {
      const [, file, line, col, severity, ruleId, message] = match
      const lineNum = parseInt(line, 10)
      const colNum = parseInt(col, 10)

      // Validate parsed integers
      if (isNaN(lineNum) || isNaN(colNum)) continue

      errors.push({
        file,
        line: lineNum,
        column: colNum,
        ruleId,
        message: message.trim(),
        severity: severity === 'error' ? 'error' : 'warning',
        fixable: false,
      })
    }

    // Also try JSON format if available
    try {
      const jsonMatch = output.match(/\[[\s\S]*\]/m)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        // Validate parsed is an array
        if (!Array.isArray(parsed)) return errors

        for (const fileResult of parsed) {
          if (!fileResult || typeof fileResult.filePath !== 'string') continue
          const messages = Array.isArray(fileResult.messages) ? fileResult.messages : []

          for (const msg of messages) {
            if (!msg || typeof msg.message !== 'string') continue
            errors.push({
              file: fileResult.filePath,
              line: typeof msg.line === 'number' ? msg.line : 0,
              column: typeof msg.column === 'number' ? msg.column : 0,
              ruleId: typeof msg.ruleId === 'string' ? msg.ruleId : 'unknown',
              message: msg.message,
              severity: msg.severity === 2 ? 'error' : 'warning',
              fixable: msg.fix !== undefined,
            })
          }
        }
      }
    } catch {
      // Not JSON format or invalid JSON
    }

    return errors
  }

  /**
   * Parse test output
   */
  private parseTestOutput(output: string): {
    total: number
    passing: number
    failing: number
    failedTests: Array<{ name: string; error: string; file?: string }>
  } {
    const result = {
      total: 0,
      passing: 0,
      failing: 0,
      failedTests: [] as Array<{ name: string; error: string; file?: string }>,
    }

    // Vitest format: Tests: 5 passed, 2 failed, 7 total
    const vitestMatch = output.match(/Tests:\s*(?:(\d+)\s*passed,?\s*)?(?:(\d+)\s*failed,?\s*)?(\d+)\s*total/i)
    if (vitestMatch) {
      result.passing = parseInt(vitestMatch[1] || '0', 10)
      result.failing = parseInt(vitestMatch[2] || '0', 10)
      result.total = parseInt(vitestMatch[3] || '0', 10)
    }

    // Jest format: Tests: 5 passed, 2 failed, 7 total
    const jestMatch = output.match(/Tests:\s*(\d+)\s*passed,\s*(\d+)\s*failed,\s*(\d+)\s*total/i)
    if (jestMatch) {
      result.passing = parseInt(jestMatch[1], 10)
      result.failing = parseInt(jestMatch[2], 10)
      result.total = parseInt(jestMatch[3], 10)
    }

    // Extract failed test names
    const failedPattern = /FAIL\s+(.+?)\s*\n.*?(✕|×|✗)\s+(.+?)(?:\s+\(|$)/gm
    let failMatch
    while ((failMatch = failedPattern.exec(output)) !== null) {
      result.failedTests.push({
        file: failMatch[1].trim(),
        name: failMatch[3].trim(),
        error: 'Test failed',
      })
    }

    return result
  }

  /**
   * Parse build errors from output
   */
  private parseBuildErrors(output: string): string[] {
    const errors: string[] = []

    // Vite build errors: [plugin] Error: ...
    const vitePattern = /\[plugin.*?\]\s*Error:\s*(.+)/gi
    let viteMatch
    while ((viteMatch = vitePattern.exec(output)) !== null) {
      errors.push(viteMatch[1].trim())
    }

    // Webpack/general errors: ERROR in ...
    const webpackPattern = /ERROR\s+in\s+(.+)/gi
    let webpackMatch
    while ((webpackMatch = webpackPattern.exec(output)) !== null) {
      errors.push(webpackMatch[1].trim())
    }

    // Generic "Error: " lines
    const genericPattern = /^Error:\s+(.+)$/gm
    let genericMatch
    while ((genericMatch = genericPattern.exec(output)) !== null) {
      errors.push(genericMatch[1].trim())
    }

    // TypeScript compilation errors (tsc build)
    const tscPattern = /^(.+?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.+)$/gm
    let tscMatch
    while ((tscMatch = tscPattern.exec(output)) !== null) {
      const [, file, line, col, code, message] = tscMatch
      errors.push(`${file}:${line}:${col} ${code} ${message}`)
    }

    return errors
  }

  /**
   * F4.13 - Apply auto-fixes
   */
  async applyAutoFix(
    projectPath: string,
    fixType: 'lint' | 'format'
  ): Promise<boolean> {
    try {
      if (fixType === 'lint') {
        await execFileAsync('npm', ['run', 'lint', '--', '--fix'], {
          cwd: projectPath,
        })
      } else if (fixType === 'format') {
        await execFileAsync('npm', ['run', 'format'], {
          cwd: projectPath,
        })
      }
      return true
    } catch {
      return false
    }
  }

  /**
   * F4.15 - Re-Review Loop
   * After fixes are applied, re-run only the reviewers that found issues
   */
  async reReviewLoop(
    projectPath: string,
    sectionId: string,
    previousResult: BvsQualityGateResult,
    maxIterations: number = 3
  ): Promise<{
    success: boolean
    iterations: number
    finalResult: BvsQualityGateResult
  }> {
    let currentResult = previousResult
    let iterations = 0

    while (iterations < maxIterations) {
      iterations++

      // Determine which gates need re-running
      const gatesToRun = {
        typecheck: !currentResult.typeCheck.passed,
        lint: !currentResult.lint.passed,
        tests: !currentResult.tests.passed,
        build: currentResult.build ? !currentResult.build.passed : false,
      }

      // If all passed, we're done
      if (!gatesToRun.typecheck && !gatesToRun.lint && !gatesToRun.tests && !gatesToRun.build) {
        return {
          success: true,
          iterations,
          finalResult: currentResult,
        }
      }

      // Emit re-review event
      this.sendToRenderer(BVS_IPC_CHANNELS.BVS_EVENT, {
        type: 're_review_started',
        sectionId,
        iteration: iterations,
        gatesToRun,
      })

      // Re-run only failed gates
      const newResult: BvsQualityGateResult = {
        ...currentResult,
        totalDuration: 0,
        completedAt: 0,
      }

      const startTime = Date.now()

      if (gatesToRun.typecheck) {
        newResult.typeCheck = await this.runTypeCheck(projectPath)
      }

      if (gatesToRun.lint) {
        newResult.lint = await this.runLint(projectPath)
      }

      if (gatesToRun.build) {
        newResult.build = await this.runBuild(projectPath)
      }

      if (gatesToRun.tests) {
        newResult.tests = await this.runTests(projectPath)
      }

      newResult.passed = newResult.typeCheck.passed && newResult.lint.passed && newResult.tests.passed && (newResult.build?.passed ?? true)
      newResult.totalDuration = Date.now() - startTime
      newResult.completedAt = Date.now()

      // Emit iteration result
      this.sendToRenderer(BVS_IPC_CHANNELS.BVS_EVENT, {
        type: 're_review_iteration',
        sectionId,
        iteration: iterations,
        result: newResult,
      })

      // Check if we made progress
      const previousFailures = this.countFailures(currentResult)
      const currentFailures = this.countFailures(newResult)

      if (currentFailures === 0) {
        return {
          success: true,
          iterations,
          finalResult: newResult,
        }
      }

      // If no progress made, break early
      if (currentFailures >= previousFailures) {
        this.sendToRenderer(BVS_IPC_CHANNELS.BVS_EVENT, {
          type: 're_review_no_progress',
          sectionId,
          iteration: iterations,
        })
        return {
          success: false,
          iterations,
          finalResult: newResult,
        }
      }

      currentResult = newResult
    }

    return {
      success: currentResult.passed,
      iterations,
      finalResult: currentResult,
    }
  }

  /**
   * Count total failures across all gates
   */
  private countFailures(result: BvsQualityGateResult): number {
    let count = 0
    if (!result.typeCheck.passed) count += result.typeCheck.errors.length
    if (!result.lint.passed) count += result.lint.errors.length
    if (result.build && !result.build.passed) count += result.build.errors.length
    if (!result.tests.passed) count += result.tests.testsFailing
    return count
  }

  /**
   * Reset fix attempts for a section
   */
  resetFixAttempts(sectionId: string): void {
    this.fixAttempts.delete(sectionId)
    this.skippedGates.delete(sectionId)
  }

  /**
   * Get summary of all fix attempts
   */
  getFixAttemptSummary(): Map<string, number> {
    const summary = new Map<string, number>()
    for (const [sectionId, attempts] of this.fixAttempts) {
      summary.set(sectionId, attempts.length)
    }
    return summary
  }
}

// Singleton instance
let bvsQualityGateService: BvsQualityGateService | null = null

export function getBvsQualityGateService(): BvsQualityGateService {
  if (!bvsQualityGateService) {
    bvsQualityGateService = new BvsQualityGateService()
  }
  return bvsQualityGateService
}

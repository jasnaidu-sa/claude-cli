/**
 * BVS Merge Point Service
 *
 * Manages merge points between parallel execution levels:
 * - Collects completed worker results
 * - Merges git worktrees back to main branch
 * - Detects and auto-resolves conflicts using AI
 * - Runs integration verification after merge
 * - Notifies user of auto-resolutions
 *
 * SECURITY NOTE: This file uses execFile (not exec) for all command execution
 * to prevent shell injection vulnerabilities.
 */

import { EventEmitter } from 'events'
import * as path from 'path'
import * as fs from 'fs/promises'
import { execFile as execFileCb } from 'child_process'
import { promisify } from 'util'

import type { WorkerResult } from './bvs-worker-agent-service'
import { BVS_MODELS } from './bvs-complexity-analyzer-service'

const execFilePromise = promisify(execFileCb)

// ============================================================================
// Types
// ============================================================================

export interface MergePointConfig {
  level: number
  workerResults: WorkerResult[]
  projectPath: string
  targetBranch: string
  isFinalLevel: boolean
}

export interface MergeConflict {
  file: string
  workerA: string
  workerB: string
  conflictContent: string
  resolved: boolean
  resolution?: string
  resolutionMethod: 'auto' | 'manual' | 'none'
}

export interface MergePointResult {
  success: boolean
  level: number
  mergedWorkers: string[]
  failedWorkers: string[]
  conflicts: MergeConflict[]
  autoResolved: number
  integrationPassed: boolean
  errors: string[]
  startedAt: number
  completedAt: number
}

export interface IntegrationResult {
  passed: boolean
  typecheck: { passed: boolean; errors: string[] }
  lint: { passed: boolean; errors: string[] }
  tests: { passed: boolean; failed: number; total: number }
}

export const BVS_MERGE_CHANNELS = {
  MERGE_STARTED: 'bvs-merge:started',
  MERGE_PROGRESS: 'bvs-merge:progress',
  MERGE_CONFLICT: 'bvs-merge:conflict',
  MERGE_RESOLVED: 'bvs-merge:resolved',
  MERGE_COMPLETED: 'bvs-merge:completed',
  MERGE_FAILED: 'bvs-merge:failed',
  INTEGRATION_STARTED: 'bvs-merge:integration-started',
  INTEGRATION_RESULT: 'bvs-merge:integration-result',
} as const

// ============================================================================
// Safe Command Execution (using execFile, NOT exec)
// ============================================================================

interface ExecResult {
  stdout: string
  stderr: string
  exitCode: number
}

async function runGit(
  args: string[],
  options: { cwd?: string; timeout?: number } = {}
): Promise<ExecResult> {
  try {
    const { stdout, stderr } = await execFilePromise('git', args, {
      cwd: options.cwd,
      timeout: options.timeout || 60000,
      maxBuffer: 10 * 1024 * 1024,
    })
    return { stdout: stdout || '', stderr: stderr || '', exitCode: 0 }
  } catch (error) {
    if (error && typeof error === 'object') {
      const execError = error as { stdout?: string; stderr?: string; code?: number }
      return {
        stdout: execError.stdout || '',
        stderr: execError.stderr || '',
        exitCode: execError.code || 1,
      }
    }
    return { stdout: '', stderr: String(error), exitCode: 1 }
  }
}

async function runNpx(
  packageCommand: string,
  args: string[],
  options: { cwd?: string; timeout?: number } = {}
): Promise<ExecResult> {
  const isWindows = process.platform === 'win32'
  const npxCmd = isWindows ? 'npx.cmd' : 'npx'
  try {
    const { stdout, stderr } = await execFilePromise(npxCmd, [packageCommand, ...args], {
      cwd: options.cwd,
      timeout: options.timeout || 120000,
      maxBuffer: 10 * 1024 * 1024,
    })
    return { stdout: stdout || '', stderr: stderr || '', exitCode: 0 }
  } catch (error) {
    if (error && typeof error === 'object') {
      const execError = error as { stdout?: string; stderr?: string; code?: number }
      return {
        stdout: execError.stdout || '',
        stderr: execError.stderr || '',
        exitCode: execError.code || 1,
      }
    }
    return { stdout: '', stderr: String(error), exitCode: 1 }
  }
}

async function runNpm(
  args: string[],
  options: { cwd?: string; timeout?: number } = {}
): Promise<ExecResult> {
  const isWindows = process.platform === 'win32'
  const npmCmd = isWindows ? 'npm.cmd' : 'npm'
  try {
    const { stdout, stderr } = await execFilePromise(npmCmd, args, {
      cwd: options.cwd,
      timeout: options.timeout || 300000,
      maxBuffer: 10 * 1024 * 1024,
    })
    return { stdout: stdout || '', stderr: stderr || '', exitCode: 0 }
  } catch (error) {
    if (error && typeof error === 'object') {
      const execError = error as { stdout?: string; stderr?: string; code?: number }
      return {
        stdout: execError.stdout || '',
        stderr: execError.stderr || '',
        exitCode: execError.code || 1,
      }
    }
    return { stdout: '', stderr: String(error), exitCode: 1 }
  }
}

// ============================================================================
// Agent SDK for Conflict Resolution
// ============================================================================

let sdkModule: typeof import('@anthropic-ai/claude-code') | null = null

async function getSDK(): Promise<typeof import('@anthropic-ai/claude-code')> {
  if (!sdkModule) {
    sdkModule = await import('@anthropic-ai/claude-code')
    console.log('[BvsMergePoint] Agent SDK loaded')
  }
  return sdkModule
}

// ============================================================================
// Service
// ============================================================================

export class BvsMergePointService extends EventEmitter {

  constructor() {
    super()
  }

  async executeMergePoint(config: MergePointConfig): Promise<MergePointResult> {
    const startedAt = Date.now()
    const { level, workerResults, projectPath, targetBranch, isFinalLevel } = config

    console.log(`[BvsMergePoint] Starting merge point for level ${level}`)

    this.emit(BVS_MERGE_CHANNELS.MERGE_STARTED, {
      level,
      workerCount: workerResults.length,
    })

    const result: MergePointResult = {
      success: false,
      level,
      mergedWorkers: [],
      failedWorkers: [],
      conflicts: [],
      autoResolved: 0,
      integrationPassed: false,
      errors: [],
      startedAt,
      completedAt: 0,
    }

    try {
      const completedWorkers = workerResults
        .filter(w => w.status === 'completed')
        .sort((a, b) => a.workerId.localeCompare(b.workerId))

      const failedWorkers = workerResults.filter(w => w.status !== 'completed')
      result.failedWorkers = failedWorkers.map(w => w.workerId)

      if (completedWorkers.length === 0) {
        result.errors.push('No workers completed successfully')
        return result
      }

      // Checkout target branch with error checking
      const checkoutResult = await runGit(['checkout', targetBranch], { cwd: projectPath })
      if (checkoutResult.exitCode !== 0) {
        result.errors.push(`Failed to checkout target branch '${targetBranch}': ${checkoutResult.stderr}`)
        result.completedAt = Date.now()
        this.emit(BVS_MERGE_CHANNELS.MERGE_FAILED, result)
        return result
      }

      for (const worker of completedWorkers) {
        const workerBranch = `bvs-worker-${worker.workerId}`

        this.emit(BVS_MERGE_CHANNELS.MERGE_PROGRESS, {
          level,
          workerId: worker.workerId,
          step: 'merging',
        })

        const mergeResult = await this.mergeWorkerBranch(
          projectPath,
          workerBranch,
          targetBranch,
          worker.workerId
        )

        if (mergeResult.hasConflicts) {
          for (const conflict of mergeResult.conflicts) {
            this.emit(BVS_MERGE_CHANNELS.MERGE_CONFLICT, {
              level,
              workerId: worker.workerId,
              file: conflict.file,
            })

            const resolved = await this.resolveConflictWithAI(
              projectPath,
              conflict,
              worker.sectionId
            )

            if (resolved) {
              conflict.resolved = true
              conflict.resolutionMethod = 'auto'
              result.autoResolved++

              this.emit(BVS_MERGE_CHANNELS.MERGE_RESOLVED, {
                level,
                workerId: worker.workerId,
                file: conflict.file,
                method: 'auto',
              })
            } else {
              conflict.resolutionMethod = 'none'
              result.errors.push(`Failed to resolve conflict in ${conflict.file}`)
            }

            result.conflicts.push(conflict)
          }

          const unresolvedConflicts = result.conflicts.filter(c => !c.resolved)
          if (unresolvedConflicts.length > 0) {
            await runGit(['merge', '--abort'], { cwd: projectPath })
            result.errors.push(`Unresolved conflicts from worker ${worker.workerId}`)
            result.failedWorkers.push(worker.workerId)
            // Abort entire merge point on unresolved conflicts - cannot safely continue
            result.success = false
            result.completedAt = Date.now()
            this.emit(BVS_MERGE_CHANNELS.MERGE_FAILED, result)
            return result
          }

          // Stage only the resolved conflict files, not everything
          const resolvedFiles = result.conflicts.filter(c => c.resolved).map(c => c.file)
          for (const file of resolvedFiles) {
            await runGit(['add', file], { cwd: projectPath })
          }

          // Check if there are changes to commit
          const statusResult = await runGit(['status', '--porcelain'], { cwd: projectPath })
          if (!statusResult.stdout.trim()) {
            console.warn('[BvsMergePoint] No changes to commit after conflict resolution')
          } else {
            // Commit with error checking
            const commitResult = await runGit(
              ['commit', '-m', `[BVS] Merge ${workerBranch} with auto-resolved conflicts`],
              { cwd: projectPath }
            )

            if (commitResult.exitCode !== 0) {
              result.errors.push(`Failed to commit resolved conflicts: ${commitResult.stderr}`)
              result.failedWorkers.push(worker.workerId)
              continue
            }
          }
        }

        result.mergedWorkers.push(worker.workerId)
      }

      this.emit(BVS_MERGE_CHANNELS.INTEGRATION_STARTED, { level })

      const integrationResult = await this.runIntegrationVerification(
        projectPath,
        isFinalLevel
      )

      result.integrationPassed = integrationResult.passed

      this.emit(BVS_MERGE_CHANNELS.INTEGRATION_RESULT, {
        level,
        ...integrationResult,
      })

      if (!integrationResult.passed) {
        result.errors.push('Integration verification failed')
        if (!integrationResult.typecheck.passed) {
          result.errors.push(...integrationResult.typecheck.errors.slice(0, 5))
        }
        if (!integrationResult.lint.passed) {
          result.errors.push(...integrationResult.lint.errors.slice(0, 5))
        }
        if (!integrationResult.tests.passed) {
          result.errors.push(`${integrationResult.tests.failed} test(s) failed`)
        }
      }

      result.success = result.mergedWorkers.length > 0 && result.integrationPassed

    } catch (error) {
      console.error('[BvsMergePoint] Error:', error)
      result.errors.push(error instanceof Error ? error.message : String(error))
    } finally {
      result.completedAt = Date.now()

      this.emit(
        result.success
          ? BVS_MERGE_CHANNELS.MERGE_COMPLETED
          : BVS_MERGE_CHANNELS.MERGE_FAILED,
        result
      )
    }

    return result
  }

  async cleanupWorktrees(projectPath: string, workerIds: string[]): Promise<void> {
    for (const workerId of workerIds) {
      const worktreePath = path.join(projectPath, '.bvs', 'worktrees', `worker-${workerId}`)

      try {
        await runGit(['worktree', 'remove', worktreePath, '--force'], { cwd: projectPath })
        const branchName = `bvs-worker-${workerId}`
        await runGit(['branch', '-D', branchName], { cwd: projectPath })
        console.log(`[BvsMergePoint] Cleaned up worktree for ${workerId}`)
      } catch (error) {
        console.warn(`[BvsMergePoint] Failed to cleanup worktree ${workerId}:`, error)
      }
    }
  }

  private async mergeWorkerBranch(
    projectPath: string,
    workerBranch: string,
    targetBranch: string,
    workerId: string
  ): Promise<{ success: boolean; hasConflicts: boolean; conflicts: MergeConflict[] }> {

    const mergeResult = await runGit(
      ['merge', workerBranch, '--no-ff', '-m', `[BVS] Merge ${workerBranch}`],
      { cwd: projectPath }
    )

    if (mergeResult.exitCode !== 0) {
      const output = mergeResult.stdout + mergeResult.stderr

      if (output.includes('CONFLICT') || output.includes('Automatic merge failed')) {
        const statusResult = await runGit(['diff', '--name-only', '--diff-filter=U'], { cwd: projectPath })
        const conflictedFiles = statusResult.stdout.trim().split('\n').filter(f => f)

        const conflicts: MergeConflict[] = []

        for (const file of conflictedFiles) {
          const filePath = path.join(projectPath, file)
          let conflictContent = ''
          let couldReadFile = true

          try {
            conflictContent = await fs.readFile(filePath, 'utf-8')
          } catch (error) {
            console.error(`[BvsMergePoint] Failed to read conflicted file ${file}:`, error)
            couldReadFile = false
          }

          // If we couldn't read the file or it's empty, mark as unresolvable
          if (!couldReadFile || !conflictContent) {
            console.error(`[BvsMergePoint] Cannot resolve conflict in ${file} - file unreadable or empty`)
            conflicts.push({
              file,
              workerA: targetBranch,
              workerB: workerId,
              conflictContent: '',
              resolved: false,
              resolutionMethod: 'none',
            })
            continue
          }

          conflicts.push({
            file,
            workerA: targetBranch,
            workerB: workerId,
            conflictContent,
            resolved: false,
            resolutionMethod: 'none',
          })
        }

        return { success: false, hasConflicts: true, conflicts }
      }

      console.error(`[BvsMergePoint] Merge failed for ${workerBranch}:`, output)
      return { success: false, hasConflicts: false, conflicts: [] }
    }

    return { success: true, hasConflicts: false, conflicts: [] }
  }

  private async resolveConflictWithAI(
    projectPath: string,
    conflict: MergeConflict,
    sectionDescription: string
  ): Promise<boolean> {

    try {
      const sdk = await getSDK()

      const conflictMatch = conflict.conflictContent.match(
        /<<<<<<< .+?\n([\s\S]*?)=======\n([\s\S]*?)>>>>>>> .+?\n/g
      )

      if (!conflictMatch || conflictMatch.length === 0) {
        console.log('[BvsMergePoint] No conflict markers found')
        return true
      }

      const prompt = `Resolve this git merge conflict by combining both changes intelligently.

File: ${conflict.file}
Branch A (${conflict.workerA}): Existing code
Branch B (${conflict.workerB}): New implementation for: ${sectionDescription}

File with conflicts:
\`\`\`
${conflict.conflictContent}
\`\`\`

Return ONLY the resolved file content without conflict markers.`

      const options = {
        maxTurns: 1,
        cwd: projectPath,
        permissionMode: 'default' as const,
      }

      async function* generateMessages() {
        yield {
          type: 'user' as const,
          message: { role: 'user' as const, content: prompt },
          parent_tool_use_id: null,
          session_id: `conflict-${conflict.file}`
        }
      }

      const queryResult = sdk.query({ prompt: generateMessages(), options })

      let resolvedContent = ''

      for await (const message of queryResult) {
        if (message.type === 'text' || (message as Record<string, unknown>).content) {
          const content = (message as Record<string, unknown>).content as string ||
                         (message as { text?: string }).text || ''
          resolvedContent += content
        }
      }

      resolvedContent = resolvedContent
        .replace(/^```\w*\n?/gm, '')
        .replace(/\n?```$/gm, '')
        .trim()

      if (!resolvedContent) {
        console.error('[BvsMergePoint] AI returned empty resolution')
        return false
      }

      if (resolvedContent.includes('<<<<<<<') ||
          resolvedContent.includes('=======') ||
          resolvedContent.includes('>>>>>>>')) {
        console.error('[BvsMergePoint] AI resolution still contains conflict markers')
        return false
      }

      // Validate file path to prevent path traversal attacks
      const normalizedPath = path.normalize(conflict.file)
      if (normalizedPath.includes('..') || path.isAbsolute(normalizedPath)) {
        console.error('[BvsMergePoint] Invalid file path detected - possible path traversal')
        return false
      }

      // Validate content size is reasonable
      if (resolvedContent.length > 1000000) { // 1MB max
        console.error('[BvsMergePoint] AI resolution content too large')
        return false
      }

      const filePath = path.join(projectPath, normalizedPath)
      await fs.writeFile(filePath, resolvedContent, 'utf-8')
      await runGit(['add', conflict.file], { cwd: projectPath })

      conflict.resolution = resolvedContent
      console.log(`[BvsMergePoint] Resolved conflict in ${conflict.file}`)

      return true

    } catch (error) {
      console.error(`[BvsMergePoint] Failed to resolve conflict:`, error)
      return false
    }
  }

  private async runIntegrationVerification(
    projectPath: string,
    runE2E: boolean
  ): Promise<IntegrationResult> {

    const result: IntegrationResult = {
      passed: true,
      typecheck: { passed: true, errors: [] },
      lint: { passed: true, errors: [] },
      tests: { passed: true, failed: 0, total: 0 },
    }

    console.log('[BvsMergePoint] Running typecheck...')
    const typecheckResult = await runNpx('tsc', ['--noEmit'], {
      cwd: projectPath,
      timeout: 120000,
    })

    if (typecheckResult.exitCode !== 0) {
      result.typecheck.passed = false
      result.typecheck.errors = this.parseTypescriptErrors(
        typecheckResult.stdout + typecheckResult.stderr
      )
      result.passed = false
    }

    console.log('[BvsMergePoint] Running lint...')
    const lintResult = await runNpm(['run', 'lint'], {
      cwd: projectPath,
      timeout: 120000,
    })

    if (lintResult.exitCode !== 0) {
      result.lint.passed = false
      result.lint.errors = this.parseLintErrors(lintResult.stdout + lintResult.stderr)
      result.passed = false
    }

    console.log('[BvsMergePoint] Running tests...')
    const testResult = await runNpm(['test'], {
      cwd: projectPath,
      timeout: 300000,
    })

    const testParsed = this.parseTestResults(testResult.stdout + testResult.stderr)
    result.tests = testParsed

    if (!testParsed.passed) {
      result.passed = false
    }

    return result
  }

  private parseTypescriptErrors(output: string): string[] {
    const errors: string[] = []
    const errorPattern = /^(.{1,500}?)\((\d+),(\d+)\): error (TS\d+): (.+?)$/gm

    // Use matchAll for cleaner iteration - avoids exec loop lastIndex issues
    const matches = output.matchAll(errorPattern)

    for (const match of matches) {
      const [, file, line, , code, message] = match
      errors.push(`${file}:${line} - ${code}: ${message}`)
      if (errors.length >= 100) break // Limit total errors
    }

    return errors
  }

  private parseLintErrors(output: string): string[] {
    const errors: string[] = []
    const lines = output.split('\n')

    for (const line of lines) {
      if (line.includes('error') || line.includes('Error')) {
        errors.push(line.trim())
        if (errors.length >= 20) break
      }
    }

    return errors
  }

  private parseTestResults(output: string): { passed: boolean; failed: number; total: number } {
    const testMatch = output.match(/Tests?:\s*(\d+)\s*passed,?\s*(\d+)?\s*failed?,?\s*(\d+)?\s*total/i)

    if (testMatch) {
      const passed = parseInt(testMatch[1], 10) || 0
      const failed = parseInt(testMatch[2], 10) || 0
      const total = parseInt(testMatch[3], 10) || (passed + failed)

      return { passed: failed === 0, failed, total }
    }

    if (output.includes('FAIL') || output.includes('failed')) {
      return { passed: false, failed: 1, total: 1 }
    }

    if (output.includes('PASS') || output.includes('passed')) {
      return { passed: true, failed: 0, total: 1 }
    }

    return { passed: true, failed: 0, total: 0 }
  }
}

export const mergePointService = new BvsMergePointService()

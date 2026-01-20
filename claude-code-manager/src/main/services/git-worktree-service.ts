/**
 * Git Worktree Service
 * Manages git worktree operations for parallel agent execution
 */

import { promises as fs } from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
import * as path from 'path'

const execFileAsync = promisify(execFile)

// Security limits
const MAX_WORKTREES = 20
const MAX_PATH_LENGTH = 500
const MAX_BRANCH_NAME_LENGTH = 255

/**
 * Worktree information
 */
export interface WorktreeInfo {
  /** Path to worktree */
  path: string

  /** Branch name */
  branch: string

  /** Current HEAD commit */
  head: string

  /** Whether worktree has uncommitted changes */
  dirty: boolean

  /** Whether worktree is locked */
  locked: boolean

  /** Session ID if applicable */
  sessionId?: string

  /** Task ID if applicable */
  taskId?: string
}

/**
 * Worktree creation options
 */
export interface CreateWorktreeOptions {
  /** Base branch to create from */
  baseBranch?: string

  /** Whether to create new branch */
  createBranch?: boolean

  /** Session ID for tracking */
  sessionId?: string

  /** Task ID for tracking */
  taskId?: string
}

/**
 * Git Worktree Service
 */
export class GitWorktreeService {
  private repoPath: string | null = null

  /**
   * Initialize service with repository path
   */
  initialize(repoPath: string): void {
    if (repoPath.length > MAX_PATH_LENGTH) {
      throw new Error(`Repository path too long: ${repoPath.length} (max: ${MAX_PATH_LENGTH})`)
    }
    this.repoPath = path.normalize(path.resolve(repoPath))
  }

  /**
   * Get repository path
   */
  getRepoPath(): string {
    if (!this.repoPath) {
      throw new Error('GitWorktreeService not initialized. Call initialize() first.')
    }
    return this.repoPath
  }

  /**
   * Get dedicated worktree base directory (P1 fix: restrict paths)
   */
  private getWorktreeBasePath(): string {
    if (!this.repoPath) {
      throw new Error('Service not initialized')
    }
    return path.join(path.dirname(this.repoPath), '.ralph-worktrees')
  }

  /**
   * Validate path is safe (no traversal) - P1 fix: stricter path validation
   */
  private validatePath(inputPath: string): string {
    if (inputPath.length > MAX_PATH_LENGTH) {
      throw new Error(`Path too long: ${inputPath.length} (max: ${MAX_PATH_LENGTH})`)
    }

    // P1 FIX: Reject path traversal sequences early
    if (inputPath.includes('..') || inputPath.includes('~')) {
      throw new Error('Path traversal detected')
    }

    const normalized = path.normalize(path.resolve(inputPath))

    if (!this.repoPath) {
      throw new Error('Service not initialized')
    }

    // P1 FIX: Only allow paths within repo or dedicated worktree directory
    const worktreeBase = this.getWorktreeBasePath()
    if (
      !normalized.startsWith(this.repoPath) &&
      !normalized.startsWith(worktreeBase)
    ) {
      throw new Error(`Path must be within repo or worktree directory`)
    }

    return normalized
  }

  /**
   * Validate branch name format (P1 fix: branch name injection)
   */
  private validateBranchName(branchName: string): string {
    if (!branchName || branchName.length > MAX_BRANCH_NAME_LENGTH) {
      throw new Error('Invalid branch name length')
    }

    // Only allow safe characters: alphanumeric, dash, underscore, slash
    if (!/^[a-zA-Z0-9/_-]+$/.test(branchName)) {
      throw new Error('Branch name contains invalid characters')
    }

    // Prevent special git references
    if (
      branchName.startsWith('-') ||
      branchName.includes('..') ||
      branchName.includes('//') ||
      branchName.endsWith('.lock')
    ) {
      throw new Error('Branch name uses reserved patterns')
    }

    return branchName
  }

  /**
   * Create a new worktree (P1 fix: branch validation, P1 fix: proper error type check)
   */
  async createWorktree(
    worktreePath: string,
    branchName: string,
    options: CreateWorktreeOptions = {}
  ): Promise<WorktreeInfo> {
    const repoPath = this.getRepoPath()
    const safePath = this.validatePath(worktreePath)
    const safeBranch = this.validateBranchName(branchName)

    // Check worktree limit
    const existing = await this.listWorktrees()
    if (existing.length >= MAX_WORKTREES) {
      throw new Error(`Too many worktrees: ${existing.length} (max: ${MAX_WORKTREES})`)
    }

    // Check if path already exists (P1 fix: proper error type checking)
    try {
      await fs.access(safePath)
      throw new Error(`Worktree path already exists`)
    } catch (error) {
      // P1 FIX: Proper type narrowing for error
      if (
        error instanceof Error &&
        'code' in error &&
        (error as NodeJS.ErrnoException).code === 'ENOENT'
      ) {
        // Path doesn't exist, which is expected - continue
      } else if (error instanceof Error && error.message.includes('already exists')) {
        throw error
      } else {
        throw error
      }
    }

    // Build git worktree add command
    const args = ['worktree', 'add']

    if (options.createBranch !== false) {
      args.push('-b', safeBranch)
    }

    args.push(safePath)

    if (options.baseBranch) {
      // P1 FIX: Validate base branch too
      const safeBaseBranch = this.validateBranchName(options.baseBranch)
      args.push(safeBaseBranch)
    } else if (!options.createBranch) {
      args.push(safeBranch)
    }

    try {
      await execFileAsync('git', args, { cwd: repoPath })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to create worktree: ${message}`)
    }

    // Get worktree info
    const info = await this.getWorktreeStatus(safePath)

    // Add session/task tracking
    if (options.sessionId || options.taskId) {
      info.sessionId = options.sessionId
      info.taskId = options.taskId
    }

    return info
  }

  /**
   * Remove a worktree
   */
  async removeWorktree(worktreePath: string, force: boolean = false): Promise<void> {
    const repoPath = this.getRepoPath()
    const safePath = this.validatePath(worktreePath)

    const args = ['worktree', 'remove', safePath]
    if (force) {
      args.push('--force')
    }

    try {
      await execFileAsync('git', args, { cwd: repoPath })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to remove worktree: ${message}`)
    }
  }

  /**
   * List all worktrees
   */
  async listWorktrees(): Promise<WorktreeInfo[]> {
    const repoPath = this.getRepoPath()

    try {
      const { stdout } = await execFileAsync(
        'git',
        ['worktree', 'list', '--porcelain'],
        { cwd: repoPath }
      )

      const worktrees: WorktreeInfo[] = []
      let current: Partial<WorktreeInfo> = {}

      for (const line of stdout.split('\n')) {
        if (line.startsWith('worktree ')) {
          if (current.path) {
            worktrees.push(this.completeWorktreeInfo(current))
          }
          current = { path: line.substring(9), dirty: false, locked: false }
        } else if (line.startsWith('HEAD ')) {
          current.head = line.substring(5)
        } else if (line.startsWith('branch ')) {
          current.branch = line.substring(7).replace('refs/heads/', '')
        } else if (line === 'detached') {
          current.branch = 'DETACHED'
        } else if (line === 'locked') {
          current.locked = true
        } else if (line === '') {
          // Blank line indicates end of worktree entry
          if (current.path) {
            worktrees.push(this.completeWorktreeInfo(current))
            current = {}
          }
        }
      }

      // Handle last entry
      if (current.path) {
        worktrees.push(this.completeWorktreeInfo(current))
      }

      return worktrees
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to list worktrees: ${message}`)
    }
  }

  /**
   * Get status of a specific worktree
   */
  async getWorktreeStatus(worktreePath: string): Promise<WorktreeInfo> {
    const safePath = this.validatePath(worktreePath)

    // Get branch name
    let branch: string
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['rev-parse', '--abbrev-ref', 'HEAD'],
        { cwd: safePath }
      )
      branch = stdout.trim()
    } catch {
      branch = 'unknown'
    }

    // Get HEAD commit
    let head: string
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['rev-parse', 'HEAD'],
        { cwd: safePath }
      )
      head = stdout.trim()
    } catch {
      head = 'unknown'
    }

    // Check if dirty
    let dirty = false
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['status', '--porcelain'],
        { cwd: safePath }
      )
      dirty = stdout.trim().length > 0
    } catch {
      dirty = false
    }

    return {
      path: safePath,
      branch,
      head,
      dirty,
      locked: false,
    }
  }

  /**
   * Check if worktree has uncommitted changes
   */
  async isDirty(worktreePath: string): Promise<boolean> {
    const info = await this.getWorktreeStatus(worktreePath)
    return info.dirty
  }

  /**
   * Lock a worktree to prevent accidental removal
   */
  async lockWorktree(worktreePath: string, reason?: string): Promise<void> {
    const repoPath = this.getRepoPath()
    const safePath = this.validatePath(worktreePath)

    const args = ['worktree', 'lock', safePath]
    if (reason) {
      args.push('--reason', reason)
    }

    try {
      await execFileAsync('git', args, { cwd: repoPath })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to lock worktree: ${message}`)
    }
  }

  /**
   * Unlock a worktree
   */
  async unlockWorktree(worktreePath: string): Promise<void> {
    const repoPath = this.getRepoPath()
    const safePath = this.validatePath(worktreePath)

    try {
      await execFileAsync('git', ['worktree', 'unlock', safePath], { cwd: repoPath })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to unlock worktree: ${message}`)
    }
  }

  /**
   * Prune stale worktree information
   */
  async pruneWorktrees(): Promise<void> {
    const repoPath = this.getRepoPath()

    try {
      await execFileAsync('git', ['worktree', 'prune'], { cwd: repoPath })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to prune worktrees: ${message}`)
    }
  }

  /**
   * Cleanup all session worktrees (P3 fix: stronger session ID matching)
   */
  async cleanupSessionWorktrees(sessionId: string): Promise<string[]> {
    // Validate session ID format
    if (!/^[a-zA-Z0-9_-]+$/.test(sessionId) || sessionId.length > 100) {
      throw new Error('Invalid session ID format')
    }

    const worktrees = await this.listWorktrees()
    const cleaned: string[] = []

    for (const wt of worktrees) {
      // Skip main worktree (repo itself)
      if (wt.path === this.repoPath) {
        continue
      }

      // P3 FIX: Use exact match with path separators to prevent substring issues
      // Check if path matches pattern: {base}/{sessionId}-{taskId}
      const sessionPattern = new RegExp(`[/\\\\]${sessionId}[/\\\\-]`)
      if (sessionPattern.test(wt.path) || wt.sessionId === sessionId) {
        try {
          await this.removeWorktree(wt.path, true)
          cleaned.push(wt.path)
        } catch (error) {
          // Log but don't expose full error details
          console.error(`Failed to cleanup worktree:`, error instanceof Error ? error.message : 'unknown error')
        }
      }
    }

    return cleaned
  }

  /**
   * Complete partial worktree info with defaults (P0 fix: require path)
   */
  private completeWorktreeInfo(partial: Partial<WorktreeInfo>): WorktreeInfo {
    // P0 FIX: Throw error if path is missing instead of defaulting to empty string
    if (!partial.path) {
      throw new Error('Worktree path is required')
    }

    return {
      path: partial.path,
      branch: partial.branch || 'unknown',
      head: partial.head || 'unknown',
      dirty: partial.dirty ?? false,
      locked: partial.locked ?? false,
      sessionId: partial.sessionId,
      taskId: partial.taskId,
    }
  }
}

// Export singleton instance
export const gitWorktreeService = new GitWorktreeService()

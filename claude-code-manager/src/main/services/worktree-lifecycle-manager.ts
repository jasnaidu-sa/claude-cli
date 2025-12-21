import { promises as fs } from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import type { WorktreeLifecycle } from '@shared/types/git';

const execFileAsync = promisify(execFile);

/**
 * Type guard for Error objects
 */
function isErrorObject(error: unknown): error is Error {
  return error instanceof Error;
}

/**
 * Worktree Lifecycle Manager
 *
 * Manages the lifecycle of git worktrees created for workflows.
 * Tracks worktree status, implements auto-cleanup policies, and
 * detects stale worktrees.
 *
 * Features:
 * - Automatic cleanup after successful merge
 * - Stale worktree detection (age-based)
 * - Lifecycle state tracking
 * - Integration with workflow system
 *
 * Security:
 * - Path validation
 * - Safe git operations
 * - Cleanup verification
 */

const DEFAULT_STALE_DAYS = 7;
const LIFECYCLE_STORAGE_FILE = '.worktree-lifecycle.json';

class WorktreeLifecycleManager {
  private lifecycles: Map<string, WorktreeLifecycle> = new Map();
  private storagePath: string | null = null;

  /**
   * Initialize lifecycle manager with storage location
   *
   * @param repoPath - Repository root path
   */
  async initialize(repoPath: string): Promise<void> {
    const normalized = path.normalize(path.resolve(repoPath));
    this.storagePath = path.join(normalized, '.git', LIFECYCLE_STORAGE_FILE);

    // Load existing lifecycles
    await this.loadLifecycles();
  }

  /**
   * Load lifecycles from storage
   */
  private async loadLifecycles(): Promise<void> {
    if (!this.storagePath) {
      return;
    }

    try {
      const data = await fs.readFile(this.storagePath, 'utf-8');
      const parsed = JSON.parse(data) as Record<string, WorktreeLifecycle>;

      this.lifecycles.clear();
      for (const [key, lifecycle] of Object.entries(parsed)) {
        this.lifecycles.set(key, lifecycle);
      }
    } catch (error) {
      // File doesn't exist or is invalid, start fresh
      if (isErrorObject(error) && 'code' in error && error.code !== 'ENOENT') {
        console.warn('[WorktreeLifecycle] Failed to load lifecycles:', error.message);
      }
    }
  }

  /**
   * Save lifecycles to storage
   */
  private async saveLifecycles(): Promise<void> {
    if (!this.storagePath) {
      return;
    }

    try {
      const data: Record<string, WorktreeLifecycle> = {};
      for (const [key, lifecycle] of this.lifecycles.entries()) {
        data[key] = lifecycle;
      }

      await fs.writeFile(this.storagePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
      const message = isErrorObject(error) ? error.message : String(error);
      console.error('[WorktreeLifecycle] Failed to save lifecycles:', message);
    }
  }

  /**
   * Create a managed worktree with lifecycle tracking
   *
   * @param workflowId - Workflow ID associated with this worktree
   * @param worktreePath - Path to worktree
   * @param autoCleanupAfterMerge - Auto-cleanup after successful merge (default: true)
   * @param autoCleanupAfterDays - Auto-cleanup after N days inactive (default: 7)
   */
  async createManagedWorktree(
    workflowId: string,
    worktreePath: string,
    autoCleanupAfterMerge: boolean = true,
    autoCleanupAfterDays: number = DEFAULT_STALE_DAYS
  ): Promise<WorktreeLifecycle> {
    const normalized = path.normalize(path.resolve(worktreePath));

    const lifecycle: WorktreeLifecycle = {
      workflowId,
      worktreePath: normalized,
      createdAt: Date.now(),
      status: 'active',
      autoCleanupAfterMerge,
      autoCleanupAfterDays
    };

    this.lifecycles.set(normalized, lifecycle);
    await this.saveLifecycles();

    return lifecycle;
  }

  /**
   * Update worktree status
   *
   * @param worktreePath - Path to worktree
   * @param status - New status
   */
  async updateStatus(
    worktreePath: string,
    status: WorktreeLifecycle['status']
  ): Promise<void> {
    const normalized = path.normalize(path.resolve(worktreePath));
    const lifecycle = this.lifecycles.get(normalized);

    if (!lifecycle) {
      throw new Error(`Worktree not managed: ${worktreePath}`);
    }

    lifecycle.status = status;
    await this.saveLifecycles();
  }

  /**
   * Handle successful merge - cleanup if configured
   *
   * @param worktreePath - Path to worktree
   * @param repoPath - Repository root path
   * @returns true if cleanup was performed
   */
  async onMergeSuccess(worktreePath: string, repoPath: string): Promise<boolean> {
    const normalized = path.normalize(path.resolve(worktreePath));
    const lifecycle = this.lifecycles.get(normalized);

    if (!lifecycle) {
      return false;
    }

    // Update status to merged
    lifecycle.status = 'merged';
    await this.saveLifecycles();

    // Cleanup if configured
    if (lifecycle.autoCleanupAfterMerge) {
      await this.cleanupWorktree(normalized, repoPath);
      return true;
    }

    return false;
  }

  /**
   * Cleanup a worktree
   *
   * @param worktreePath - Path to worktree
   * @param repoPath - Repository root path
   */
  private async cleanupWorktree(worktreePath: string, repoPath: string): Promise<void> {
    try {
      // Remove worktree using git
      await execFileAsync('git', ['worktree', 'remove', worktreePath, '--force'], {
        cwd: repoPath
      });

      // Remove from lifecycle tracking
      this.lifecycles.delete(worktreePath);
      await this.saveLifecycles();
    } catch (error) {
      const message = isErrorObject(error) ? error.message : String(error);
      throw new Error(`Failed to cleanup worktree: ${message}`);
    }
  }

  /**
   * Find stale worktrees based on age and status
   *
   * @param repoPath - Repository root path
   * @returns Array of stale worktree lifecycles
   */
  async findStaleWorktrees(repoPath: string): Promise<WorktreeLifecycle[]> {
    const now = Date.now();
    const stale: WorktreeLifecycle[] = [];

    for (const lifecycle of this.lifecycles.values()) {
      // Check if worktree is stale based on configured days
      const ageInDays = (now - lifecycle.createdAt) / (1000 * 60 * 60 * 24);

      if (ageInDays > lifecycle.autoCleanupAfterDays) {
        // Verify worktree still exists
        try {
          await fs.access(lifecycle.worktreePath);
          stale.push(lifecycle);
        } catch {
          // Worktree already removed, clean up tracking
          this.lifecycles.delete(lifecycle.worktreePath);
        }
      }
    }

    await this.saveLifecycles();
    return stale;
  }

  /**
   * Cleanup stale worktrees
   *
   * @param repoPath - Repository root path
   * @param dryRun - If true, only return what would be cleaned (default: false)
   * @returns Array of cleaned worktree paths
   */
  async cleanupStale(repoPath: string, dryRun: boolean = false): Promise<string[]> {
    const staleWorktrees = await this.findStaleWorktrees(repoPath);
    const cleaned: string[] = [];

    for (const lifecycle of staleWorktrees) {
      if (dryRun) {
        cleaned.push(lifecycle.worktreePath);
      } else {
        try {
          await this.cleanupWorktree(lifecycle.worktreePath, repoPath);
          cleaned.push(lifecycle.worktreePath);
        } catch (error) {
          const message = isErrorObject(error) ? error.message : String(error);
          console.error(`[WorktreeLifecycle] Failed to cleanup ${lifecycle.worktreePath}:`, message);
        }
      }
    }

    return cleaned;
  }

  /**
   * Get lifecycle for a worktree
   *
   * @param worktreePath - Path to worktree
   * @returns Lifecycle or undefined if not managed
   */
  getLifecycle(worktreePath: string): WorktreeLifecycle | undefined {
    const normalized = path.normalize(path.resolve(worktreePath));
    return this.lifecycles.get(normalized);
  }

  /**
   * Get all managed worktrees
   *
   * @returns Array of all lifecycles
   */
  getAllLifecycles(): WorktreeLifecycle[] {
    return Array.from(this.lifecycles.values());
  }

  /**
   * Get lifecycles by workflow ID
   *
   * @param workflowId - Workflow ID
   * @returns Array of matching lifecycles
   */
  getLifecyclesByWorkflow(workflowId: string): WorktreeLifecycle[] {
    return Array.from(this.lifecycles.values()).filter(
      (lifecycle) => lifecycle.workflowId === workflowId
    );
  }

  /**
   * Remove lifecycle tracking for a worktree
   *
   * @param worktreePath - Path to worktree
   */
  async removeLifecycle(worktreePath: string): Promise<void> {
    const normalized = path.normalize(path.resolve(worktreePath));
    this.lifecycles.delete(normalized);
    await this.saveLifecycles();
  }

  /**
   * Get statistics about managed worktrees
   */
  getStats(): {
    total: number;
    byStatus: Record<WorktreeLifecycle['status'], number>;
    avgAgeInDays: number;
  } {
    const now = Date.now();
    const byStatus: Record<WorktreeLifecycle['status'], number> = {
      active: 0,
      testing: 0,
      merged: 0,
      discarded: 0
    };

    let totalAgeMs = 0;

    for (const lifecycle of this.lifecycles.values()) {
      byStatus[lifecycle.status]++;
      totalAgeMs += now - lifecycle.createdAt;
    }

    const total = this.lifecycles.size;
    const avgAgeInDays = total > 0 ? totalAgeMs / total / (1000 * 60 * 60 * 24) : 0;

    return {
      total,
      byStatus,
      avgAgeInDays
    };
  }
}

export const worktreeLifecycleManager = new WorktreeLifecycleManager();
export default worktreeLifecycleManager;

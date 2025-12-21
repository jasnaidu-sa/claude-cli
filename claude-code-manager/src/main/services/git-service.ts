import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs/promises';
import type {
  Worktree,
  Branch,
  WorktreeStatus,
  MergePreview,
  MergeResult,
  RemoteStatus,
  MergeStrategy,
  ConflictResolutionResult
} from '@shared/types/git';
import { conflictResolver } from './conflict-resolver';
import { worktreeLifecycleManager } from './worktree-lifecycle-manager';

const execAsync = promisify(exec);

class GitService {
  /**
   * List all worktrees for a repository
   */
  async listWorktrees(repoPath: string): Promise<Worktree[]> {
    try {
      const { stdout } = await execAsync('git worktree list --porcelain', {
        cwd: repoPath,
      });

      const worktrees: Worktree[] = [];
      const lines = stdout.trim().split('\n');
      let currentPath = '';
      let currentBranch = '';
      let isBare = false;
      let isFirst = true;

      for (const line of lines) {
        if (line.startsWith('worktree ')) {
          // Save previous worktree if exists
          if (currentPath && !isBare) {
            worktrees.push({
              id: this.generateId(),
              path: currentPath,
              branch: currentBranch || 'HEAD',
              parentRepo: repoPath,
              parentBranch: 'main', // Will be determined from branch tracking
              createdAt: Date.now(),
              lastAccessedAt: Date.now(),
              isMain: isFirst
            });
          }
          currentPath = line.substring(9);
          currentBranch = '';
          isBare = false;
          isFirst = false;
        } else if (line.startsWith('branch ')) {
          currentBranch = line.substring(7).replace('refs/heads/', '');
        } else if (line === 'bare') {
          isBare = true;
        }
      }

      // Add final worktree
      if (currentPath && !isBare) {
        worktrees.push({
          id: this.generateId(),
          path: currentPath,
          branch: currentBranch || 'HEAD',
          parentRepo: repoPath,
          parentBranch: 'main',
          createdAt: Date.now(),
          lastAccessedAt: Date.now(),
          isMain: worktrees.length === 0
        });
      }

      return worktrees;
    } catch (error) {
      throw new Error(`Failed to list worktrees: ${(error as Error).message}`);
    }
  }

  /**
   * Create a new worktree for a branch
   */
  async createWorktree(
    repoPath: string,
    branchName: string,
    baseBranch?: string
  ): Promise<Worktree> {
    try {
      // Determine actual base branch
      const actualBaseBranch = baseBranch || await this.getDefaultBranch(repoPath);

      // Sanitize branch name to be git-safe (no spaces, special chars)
      const sanitizedBranch = this.sanitizeBranchName(branchName);
      const worktreesRoot = `${repoPath}-worktrees`;
      const worktreePath = path.join(worktreesRoot, sanitizedBranch);

      await fs.mkdir(worktreesRoot, { recursive: true });

      // Use sanitized branch name for git command
      await execAsync(
        `git worktree add -b "${sanitizedBranch}" "${worktreePath}" "${actualBaseBranch}"`,
        { cwd: repoPath }
      );

      // Setup node_modules symlink if possible
      await this.setupNodeModulesSymlink(worktreePath, repoPath).catch(() => {});

      return {
        id: this.generateId(),
        path: worktreePath,
        branch: sanitizedBranch,
        parentRepo: repoPath,
        parentBranch: actualBaseBranch,
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
        isMain: false
      };
    } catch (error) {
      throw new Error(`Failed to create worktree: ${(error as Error).message}`);
    }
  }

  /**
   * Remove a worktree
   */
  async removeWorktree(worktreePath: string, force: boolean = false): Promise<void> {
    try {
      const mainRepoPath = await this.getMainRepoPath(worktreePath);
      const forceFlag = force ? '--force' : '';

      await execAsync(`git worktree remove ${forceFlag} "${worktreePath}"`, {
        cwd: mainRepoPath,
      });
    } catch (error) {
      throw new Error(`Failed to remove worktree: ${(error as Error).message}`);
    }
  }

  /**
   * List all local and remote branches
   */
  async listBranches(repoPath: string): Promise<Branch[]> {
    try {
      // Use simple git branch command that works on Windows
      const { stdout } = await execAsync('git branch -a', {
        cwd: repoPath,
      });

      const branches: Branch[] = [];
      const lines = stdout.trim().split('\n');

      for (const line of lines) {
        if (!line) continue;

        const isCurrent = line.startsWith('*');
        let name = line.replace(/^\*?\s+/, '').trim();

        // Skip HEAD pointer lines
        if (name.includes('->')) continue;

        const isRemote = name.startsWith('remotes/');
        if (isRemote) {
          name = name.replace('remotes/', '');
        }

        branches.push({
          name,
          isRemote,
          isCurrent,
        });
      }

      return branches;
    } catch (error) {
      throw new Error(`Failed to list branches: ${(error as Error).message}`);
    }
  }

  /**
   * Delete a branch
   */
  async deleteBranch(repoPath: string, branch: string, force: boolean = false): Promise<void> {
    try {
      const flag = force ? '-D' : '-d';
      await execAsync(`git branch ${flag} "${branch}"`, { cwd: repoPath });
    } catch (error) {
      throw new Error(`Failed to delete branch: ${(error as Error).message}`);
    }
  }

  /**
   * Get the current branch name
   */
  async getCurrentBranch(repoPath: string): Promise<string> {
    try {
      const { stdout } = await execAsync('git rev-parse --abbrev-ref HEAD', {
        cwd: repoPath,
      });
      return stdout.trim();
    } catch (error) {
      throw new Error(`Failed to get current branch: ${(error as Error).message}`);
    }
  }

  /**
   * Get the default branch name (main or master)
   */
  async getDefaultBranch(repoPath: string): Promise<string> {
    try {
      const branches = await this.listBranches(repoPath);
      const localBranches = branches.filter(b => !b.isRemote);

      // Check for common default branch names
      const main = localBranches.find(b => b.name === 'main');
      if (main) return 'main';

      const master = localBranches.find(b => b.name === 'master');
      if (master) return 'master';

      // Fall back to current branch
      const current = localBranches.find(b => b.isCurrent);
      if (current) return current.name;

      // Last resort: first branch
      return localBranches[0]?.name || 'main';
    } catch {
      return 'main';
    }
  }

  /**
   * Get git status for a worktree
   */
  async getStatus(worktreePath: string): Promise<WorktreeStatus> {
    try {
      const [statusOutput, aheadBehind, conflictFiles] = await Promise.all([
        execAsync('git status --porcelain', { cwd: worktreePath }),
        this.getRemoteStatus(worktreePath),
        this.getConflictedFiles(worktreePath).catch(() => []),
      ]);

      const lines = statusOutput.stdout.trim().split('\n').filter(l => l);
      let staged = 0;
      let unstaged = 0;
      let untracked = 0;

      for (const line of lines) {
        const x = line[0];
        const y = line[1];

        if (x !== ' ' && x !== '?') staged++;
        if (y !== ' ' && y !== '?') unstaged++;
        if (x === '?' && y === '?') untracked++;
      }

      const isDirty = staged > 0 || unstaged > 0 || untracked > 0;

      return {
        worktreeId: '', // Will be set by caller if needed
        isDirty,
        hasConflicts: conflictFiles.length > 0,
        staged,
        unstaged,
        untracked,
        ahead: aheadBehind.ahead,
        behind: aheadBehind.behind,
      };
    } catch (error) {
      throw new Error(`Failed to get status: ${(error as Error).message}`);
    }
  }

  /**
   * Get list of conflicted files
   */
  async getConflictedFiles(repoPath: string): Promise<string[]> {
    try {
      const { stdout } = await execAsync('git diff --name-only --diff-filter=U', {
        cwd: repoPath,
      });

      return stdout.trim().split('\n').filter(f => f);
    } catch (error) {
      throw new Error(`Failed to get conflicted files: ${(error as Error).message}`);
    }
  }

  /**
   * Preview merge to parent branch
   */
  async getMergePreview(worktreePath: string): Promise<MergePreview> {
    try {
      const currentBranch = await this.getCurrentBranch(worktreePath);

      // Get the main repo path and determine the actual parent branch
      const mainRepoPath = await this.getMainRepoPath(worktreePath);
      const parentBranch = await this.getDefaultBranch(mainRepoPath);

      // Fetch latest to ensure we have up-to-date refs
      await execAsync('git fetch origin', { cwd: worktreePath }).catch(() => {});

      const { stdout: numstatOutput } = await execAsync(
        `git diff --numstat "${parentBranch}...HEAD"`,
        { cwd: worktreePath }
      );

      let totalAdditions = 0;
      let totalDeletions = 0;
      const files: MergePreview['files'] = [];

      for (const line of numstatOutput.trim().split('\n')) {
        if (!line) continue;
        const [add, del, filePath] = line.split('\t');
        const additions = parseInt(add) || 0;
        const deletions = parseInt(del) || 0;
        totalAdditions += additions;
        totalDeletions += deletions;

        files.push({
          path: filePath,
          additions,
          deletions,
          status: additions > 0 && deletions === 0 ? 'added' :
                  deletions > 0 && additions === 0 ? 'deleted' : 'modified'
        });
      }

      const conflictFiles = await this.checkMergeConflicts(worktreePath, parentBranch);
      const canFastForward = conflictFiles.length === 0;

      return {
        sourceBranch: currentBranch,
        targetBranch: parentBranch,
        filesChanged: files.length,
        additions: totalAdditions,
        deletions: totalDeletions,
        files,
        canFastForward,
        hasConflicts: conflictFiles.length > 0,
        conflictFiles: conflictFiles.length > 0 ? conflictFiles : undefined
      };
    } catch (error) {
      throw new Error(`Failed to get merge preview: ${(error as Error).message}`);
    }
  }

  /**
   * Check for potential merge conflicts
   */
  private async checkMergeConflicts(
    worktreePath: string,
    targetBranch: string
  ): Promise<string[]> {
    try {
      await execAsync(`git merge --no-commit --no-ff ${targetBranch}`, {
        cwd: worktreePath,
      });

      await execAsync('git merge --abort', { cwd: worktreePath });
      return [];
    } catch (error) {
      const conflicts = await this.getConflictedFiles(worktreePath);

      try {
        await execAsync('git merge --abort', { cwd: worktreePath });
      } catch {}

      return conflicts;
    }
  }

  /**
   * Execute merge back to parent branch
   * Merges the worktree's branch into the parent branch in the main repo
   */
  async merge(
    worktreePath: string,
    strategy: MergeStrategy
  ): Promise<MergeResult> {
    try {
      // Get the worktree's branch name
      const worktreeBranch = await this.getCurrentBranch(worktreePath);

      // Get the main repo path from the worktree
      const mainRepoPath = await this.getMainRepoPath(worktreePath);

      // Get the parent branch (target for merge)
      const parentBranch = await this.getDefaultBranch(mainRepoPath);

      console.log(`[GitService] Merging ${worktreeBranch} into ${parentBranch} in ${mainRepoPath}`);

      // Save current branch in main repo to restore later
      const originalBranch = await this.getCurrentBranch(mainRepoPath);

      // Checkout the parent branch in the main repo
      await execAsync(`git checkout "${parentBranch}"`, { cwd: mainRepoPath });

      let commitHash = '';

      try {
        switch (strategy) {
          case 'merge':
            await execAsync(`git merge --no-ff "${worktreeBranch}" -m "Merge branch '${worktreeBranch}' into ${parentBranch}"`, { cwd: mainRepoPath });
            break;
          case 'squash':
            await execAsync(`git merge --squash "${worktreeBranch}"`, { cwd: mainRepoPath });
            await execAsync(`git commit -m "Squash merge branch '${worktreeBranch}'"`, { cwd: mainRepoPath });
            break;
          case 'rebase':
            // For rebase strategy, we rebase the feature branch onto parent, then fast-forward
            await execAsync(`git checkout "${worktreeBranch}"`, { cwd: mainRepoPath });
            await execAsync(`git rebase "${parentBranch}"`, { cwd: mainRepoPath });
            await execAsync(`git checkout "${parentBranch}"`, { cwd: mainRepoPath });
            await execAsync(`git merge --ff-only "${worktreeBranch}"`, { cwd: mainRepoPath });
            break;
          default:
            throw new Error(`Unknown merge strategy: ${strategy}`);
        }

        // Get the new commit hash
        const { stdout } = await execAsync('git rev-parse HEAD', { cwd: mainRepoPath });
        commitHash = stdout.trim();

        return {
          success: true,
          commitHash
        };
      } catch (mergeError) {
        // Check if there are conflicts
        const conflicts = await this.getConflictedFiles(mainRepoPath).catch(() => []);
        if (conflicts.length > 0) {
          return {
            success: false,
            conflicts,
            error: 'Merge conflicts detected. Resolve them in the main repo.'
          };
        }
        throw mergeError;
      }
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Abort an in-progress merge
   */
  async abortMerge(repoPath: string): Promise<void> {
    try {
      await execAsync('git merge --abort', { cwd: repoPath });
    } catch (error) {
      throw new Error(`Failed to abort merge: ${(error as Error).message}`);
    }
  }

  /**
   * Fetch all remotes
   */
  async fetch(repoPath: string): Promise<void> {
    try {
      await execAsync('git fetch --all --prune', { cwd: repoPath });
    } catch (error) {
      throw new Error(`Failed to fetch: ${(error as Error).message}`);
    }
  }

  /**
   * Pull current branch
   */
  async pull(worktreePath: string): Promise<{ success: boolean; error?: string }> {
    try {
      await execAsync('git pull', { cwd: worktreePath });
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Push current branch
   */
  async push(worktreePath: string, setUpstream: boolean = false): Promise<{ success: boolean; error?: string }> {
    try {
      if (setUpstream) {
        const branch = await this.getCurrentBranch(worktreePath);
        await execAsync(`git push --set-upstream origin ${branch}`, {
          cwd: worktreePath,
        });
      } else {
        await execAsync('git push', { cwd: worktreePath });
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Get ahead/behind status relative to remote
   */
  async getRemoteStatus(worktreePath: string): Promise<RemoteStatus> {
    try {
      const { stdout } = await execAsync(
        'git rev-list --left-right --count @{upstream}...HEAD',
        { cwd: worktreePath }
      );

      const [behind, ahead] = stdout.trim().split('\t').map(Number);

      return {
        hasRemote: true,
        remoteName: 'origin',
        canPush: true,
        canPull: true,
        ahead: ahead || 0,
        behind: behind || 0,
      };
    } catch (error) {
      return {
        hasRemote: false,
        remoteName: '',
        canPush: false,
        canPull: false,
        ahead: 0,
        behind: 0,
      };
    }
  }

  /**
   * Setup node_modules symlink if package.json matches
   */
  async setupNodeModulesSymlink(
    worktreePath: string,
    mainRepoPath: string
  ): Promise<boolean> {
    try {
      const worktreePkg = path.join(worktreePath, 'package.json');
      const mainPkg = path.join(mainRepoPath, 'package.json');
      const mainNodeModules = path.join(mainRepoPath, 'node_modules');

      const [worktreePkgContent, mainPkgContent] = await Promise.all([
        fs.readFile(worktreePkg, 'utf-8'),
        fs.readFile(mainPkg, 'utf-8'),
      ]);

      const worktreePkgJson = JSON.parse(worktreePkgContent);
      const mainPkgJson = JSON.parse(mainPkgContent);

      const depsMatch =
        JSON.stringify(worktreePkgJson.dependencies) ===
          JSON.stringify(mainPkgJson.dependencies) &&
        JSON.stringify(worktreePkgJson.devDependencies) ===
          JSON.stringify(mainPkgJson.devDependencies);

      if (!depsMatch) {
        return false;
      }

      const worktreeNodeModules = path.join(worktreePath, 'node_modules');

      try {
        await fs.access(mainNodeModules);
      } catch {
        return false;
      }

      try {
        await fs.unlink(worktreeNodeModules);
      } catch {
        // Ignore if doesn't exist
      }

      await fs.symlink(mainNodeModules, worktreeNodeModules, 'junction');
      return true;
    } catch (error) {
      throw new Error(`Failed to setup node_modules symlink: ${(error as Error).message}`);
    }
  }

  /**
   * Find worktrees not accessed in X days
   */
  async getStaleWorktrees(
    repoPath: string,
    daysThreshold: number = 30
  ): Promise<Worktree[]> {
    try {
      const worktrees = await this.listWorktrees(repoPath);
      const stale: Worktree[] = [];
      const thresholdMs = daysThreshold * 24 * 60 * 60 * 1000;
      const now = Date.now();

      for (const worktree of worktrees) {
        if (worktree.isMain) continue;

        try {
          const gitDir = path.join(worktree.path, '.git');
          const stats = await fs.stat(gitDir);
          const lastAccessed = stats.atimeMs;

          if (now - lastAccessed > thresholdMs) {
            stale.push(worktree);
          }
        } catch {
          // Ignore stat errors
        }
      }

      return stale;
    } catch (error) {
      throw new Error(`Failed to get stale worktrees: ${(error as Error).message}`);
    }
  }

  /**
   * Sanitize branch name for use as directory name
   */
  sanitizeBranchName(branch: string): string {
    return branch
      .replace(/[^a-zA-Z0-9-_]/g, '-')
      .replace(/--+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase();
  }

  /**
   * Get the main repo path for a worktree
   */
  async getMainRepoPath(worktreePath: string): Promise<string> {
    try {
      const { stdout } = await execAsync('git rev-parse --git-common-dir', {
        cwd: worktreePath,
      });

      const commonDir = stdout.trim();

      if (path.isAbsolute(commonDir)) {
        return path.dirname(commonDir);
      }

      return path.resolve(worktreePath, commonDir, '..');
    } catch (error) {
      throw new Error(`Failed to get main repo path: ${(error as Error).message}`);
    }
  }

  /**
   * Generate a unique ID
   */
  generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Merge with AI-powered conflict resolution
   *
   * Attempts to merge using the specified strategy. If conflicts occur,
   * uses AI to automatically resolve them.
   *
   * @param worktreePath - Path to worktree
   * @param strategy - Merge strategy
   * @param useAI - Enable AI conflict resolution (default: true)
   * @param confidenceThreshold - Min confidence for Tier 2 (default: 60)
   * @returns Merge result with conflict resolution details
   */
  async mergeWithConflictResolution(
    worktreePath: string,
    strategy: MergeStrategy,
    useAI: boolean = true,
    confidenceThreshold: number = 60
  ): Promise<MergeResult & { resolutions?: ConflictResolutionResult[] }> {
    // First, try normal merge
    const mergeResult = await this.merge(worktreePath, strategy);

    // If merge succeeded without conflicts, return immediately
    if (mergeResult.success) {
      return mergeResult;
    }

    // If AI is disabled or no conflicts, return the result as-is
    if (!useAI || !mergeResult.conflicts || mergeResult.conflicts.length === 0) {
      return mergeResult;
    }

    console.log(`[GitService] Merge conflicts detected, attempting AI resolution...`);

    try {
      // Get main repo path
      const mainRepoPath = await this.getMainRepoPath(worktreePath);

      // Register repository with conflict resolver
      conflictResolver.registerRepository(mainRepoPath);

      // Resolve conflicts across all files
      const resolutionMap = await conflictResolver.resolveAndApplyAllInRepo(
        mainRepoPath,
        5, // contextLines
        confidenceThreshold,
        3  // maxConcurrency
      );

      // Convert Map to array for response
      const resolutions: ConflictResolutionResult[] = [];
      for (const [filePath, fileResolutions] of resolutionMap.entries()) {
        resolutions.push(...fileResolutions);
      }

      // Check if all resolutions succeeded
      const failedResolutions = resolutions.filter(r => r.error || !r.syntaxValid);

      if (failedResolutions.length > 0) {
        console.error(`[GitService] ${failedResolutions.length} conflicts could not be resolved`);
        return {
          success: false,
          conflicts: mergeResult.conflicts,
          error: `AI resolution failed for ${failedResolutions.length} conflicts`,
          resolutions
        };
      }

      // All conflicts resolved, complete the merge
      console.log(`[GitService] All conflicts resolved by AI, completing merge...`);

      // Stage the resolved files
      for (const conflict of mergeResult.conflicts) {
        await execAsync(`git add "${conflict}"`, { cwd: mainRepoPath });
      }

      // Commit the merge
      const { stdout: commitHash } = await execAsync(
        `git commit --no-edit`,
        { cwd: mainRepoPath }
      );

      console.log(`[GitService] Merge completed successfully with AI conflict resolution`);

      // Update worktree lifecycle if managed
      const lifecycle = worktreeLifecycleManager.getLifecycle(worktreePath);
      if (lifecycle) {
        await worktreeLifecycleManager.onMergeSuccess(worktreePath, mainRepoPath);
      }

      return {
        success: true,
        commitHash: commitHash.trim(),
        resolutions
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[GitService] AI conflict resolution failed:`, message);

      return {
        success: false,
        conflicts: mergeResult.conflicts,
        error: `AI conflict resolution failed: ${message}`
      };
    }
  }

  /**
   * Check if repository has AI conflict resolution available
   *
   * @returns true if ANTHROPIC_API_KEY is set
   */
  isAIResolutionAvailable(): boolean {
    return !!(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY);
  }

  /**
   * Initialize worktree lifecycle tracking for a repository
   *
   * @param repoPath - Repository path
   */
  async initializeLifecycleTracking(repoPath: string): Promise<void> {
    await worktreeLifecycleManager.initialize(repoPath);
  }

  /**
   * Create a managed worktree with lifecycle tracking
   *
   * @param repoPath - Repository path
   * @param branchName - Branch name for the worktree
   * @param baseBranch - Base branch (optional)
   * @param workflowId - Workflow ID for tracking
   * @param createBranch - Create new branch (default: true)
   * @returns Created worktree
   */
  async createManagedWorktree(
    repoPath: string,
    branchName: string,
    baseBranch: string | undefined,
    workflowId: string
  ): Promise<Worktree> {
    // Create the worktree using existing method
    const worktree = await this.createWorktree(repoPath, branchName, baseBranch);

    // Register with lifecycle manager
    await worktreeLifecycleManager.createManagedWorktree(
      workflowId,
      worktree.path,
      true,  // autoCleanupAfterMerge
      7      // autoCleanupAfterDays
    );

    return worktree;
  }

  /**
   * Cleanup stale worktrees
   *
   * @param repoPath - Repository path
   * @param dryRun - Preview only (default: false)
   * @returns Array of cleaned worktree paths
   */
  async cleanupStaleWorktrees(repoPath: string, dryRun: boolean = false): Promise<string[]> {
    return worktreeLifecycleManager.cleanupStale(repoPath, dryRun);
  }
}

export const gitService = new GitService();
export default gitService;

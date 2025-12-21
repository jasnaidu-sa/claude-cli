import { promises as fs } from 'fs';
import type { ConflictRegion, ConflictResolutionResult } from '@shared/types/git';

/**
 * ConflictResolver Service
 *
 * Implements 3-tier merge conflict resolution:
 * - Tier 1: Git auto-merge (handled by git itself)
 * - Tier 2: AI conflict-only resolution (minimal context)
 * - Tier 3: Full-file AI resolution (fallback)
 */
class ConflictResolver {
  /**
   * Extract conflict regions from a file with merge conflicts
   *
   * Parses git conflict markers:
   * <<<<<<< HEAD
   * our changes
   * =======
   * their changes
   * >>>>>>> branch-name
   *
   * @param filePath - Absolute path to file with conflicts
   * @param contextLines - Number of lines to include before/after conflict (default: 5)
   * @returns Array of conflict regions with context
   */
  async extractConflictRegions(
    filePath: string,
    contextLines: number = 5
  ): Promise<ConflictRegion[]> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n');
      const conflicts: ConflictRegion[] = [];

      let i = 0;
      while (i < lines.length) {
        const line = lines[i];

        // Look for conflict start marker
        if (line.startsWith('<<<<<<<')) {
          const conflictStartLine = i;
          const branchName = line.substring(8).trim(); // Extract branch name after <<<<<<<

          // Find separator (=======)
          let separatorLine = -1;
          for (let j = i + 1; j < lines.length; j++) {
            if (lines[j].startsWith('=======')) {
              separatorLine = j;
              break;
            }
          }

          if (separatorLine === -1) {
            throw new Error(`Malformed conflict in ${filePath} at line ${i + 1}: no separator found`);
          }

          // Find conflict end marker (>>>>>>>)
          let conflictEndLine = -1;
          let theirBranchName = '';
          for (let j = separatorLine + 1; j < lines.length; j++) {
            if (lines[j].startsWith('>>>>>>>')) {
              conflictEndLine = j;
              theirBranchName = lines[j].substring(8).trim();
              break;
            }
          }

          if (conflictEndLine === -1) {
            throw new Error(`Malformed conflict in ${filePath} at line ${i + 1}: no end marker found`);
          }

          // Extract content from each side
          const oursContent = lines.slice(conflictStartLine + 1, separatorLine).join('\n');
          const theirsContent = lines.slice(separatorLine + 1, conflictEndLine).join('\n');

          // Extract context before conflict
          const contextBeforeStartLine = Math.max(0, conflictStartLine - contextLines);
          const contextBefore = lines.slice(contextBeforeStartLine, conflictStartLine).join('\n');

          // Extract context after conflict
          const contextAfterEndLine = Math.min(lines.length, conflictEndLine + 1 + contextLines);
          const contextAfter = lines.slice(conflictEndLine + 1, contextAfterEndLine).join('\n');

          // Create conflict region
          conflicts.push({
            filePath,
            startLine: conflictStartLine + 1, // 1-indexed for user display
            endLine: conflictEndLine + 1,
            oursContent,
            theirsContent,
            contextBefore,
            contextAfter,
            // baseContent would require 3-way merge info from git, skipping for now
          });

          // Move past this conflict
          i = conflictEndLine + 1;
        } else {
          i++;
        }
      }

      return conflicts;
    } catch (error) {
      throw new Error(
        `Failed to extract conflict regions from ${filePath}: ${(error as Error).message}`
      );
    }
  }

  /**
   * Get all files with merge conflicts in a repository
   *
   * @param repoPath - Path to git repository
   * @returns Array of file paths with unmerged conflicts
   */
  async getConflictedFiles(repoPath: string): Promise<string[]> {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

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
   * Extract all conflict regions from all conflicted files in a repository
   *
   * @param repoPath - Path to git repository
   * @param contextLines - Number of context lines (default: 5)
   * @returns Array of all conflict regions across all files
   */
  async extractAllConflicts(
    repoPath: string,
    contextLines: number = 5
  ): Promise<ConflictRegion[]> {
    const path = await import('path');
    const conflictedFiles = await this.getConflictedFiles(repoPath);

    const allConflicts: ConflictRegion[] = [];

    for (const file of conflictedFiles) {
      const absolutePath = path.resolve(repoPath, file);
      const conflicts = await this.extractConflictRegions(absolutePath, contextLines);
      allConflicts.push(...conflicts);
    }

    return allConflicts;
  }
}

export const conflictResolver = new ConflictResolver();
export default conflictResolver;

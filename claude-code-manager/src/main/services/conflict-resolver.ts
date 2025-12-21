import * as path from 'path';
import { promises as fs } from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { ConflictRegion, ConflictResolutionResult } from '@shared/types/git';
import { claudeAPIService } from './claude-api-service';
import { syntaxValidator } from './syntax-validator';

const execFileAsync = promisify(execFile);

// Constants for security hardening
const MAX_CONTEXT_LINES = 100;
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

/**
 * Type guard for Error objects
 */
function isErrorObject(error: unknown): error is Error {
  return error instanceof Error;
}

/**
 * ConflictResolver Service
 *
 * Implements 3-tier merge conflict resolution:
 * - Tier 1: Git auto-merge (handled by git itself)
 * - Tier 2: AI conflict-only resolution (minimal context)
 * - Tier 3: Full-file AI resolution (fallback)
 *
 * Security features:
 * - Path validation to prevent traversal attacks
 * - Repository allowlist for file access control
 * - Bounds checking for resource limits
 * - Error message sanitization
 */
class ConflictResolver {
  private allowedRepositories: Set<string> = new Set();

  /**
   * Register a repository path as allowed for conflict resolution
   * Must be called before processing conflicts in a repository
   *
   * @param repoPath - Absolute path to git repository
   */
  registerRepository(repoPath: string): void {
    const normalized = path.normalize(path.resolve(repoPath));
    this.allowedRepositories.add(normalized);
  }

  /**
   * Validate and normalize a repository path
   *
   * @param repoPath - Path to validate
   * @returns Normalized path if valid
   * @throws Error if path is invalid or not a git repository
   */
  private async validateRepoPath(repoPath: string): Promise<string> {
    // Normalize and resolve to absolute path
    const normalizedPath = path.normalize(path.resolve(repoPath));

    // Prevent path traversal
    if (repoPath.includes('..') || normalizedPath.includes('..')) {
      throw new Error('Invalid repository path: path traversal not allowed');
    }

    // Verify directory exists
    try {
      const stats = await fs.stat(normalizedPath);
      if (!stats.isDirectory()) {
        throw new Error('Repository path must be a directory');
      }
    } catch (error) {
      const message = isErrorObject(error) ? error.message : String(error);
      throw new Error(`Invalid repository path: ${message}`);
    }

    // Verify it's a git repository
    try {
      await fs.access(path.join(normalizedPath, '.git'));
    } catch {
      throw new Error('Path is not a git repository');
    }

    return normalizedPath;
  }

  /**
   * Validate a file path is within an allowed repository
   *
   * @param filePath - Path to validate
   * @returns Normalized path if valid
   * @throws Error if path is invalid or outside allowed repositories
   */
  private async validateFilePath(filePath: string): Promise<string> {
    // Resolve to absolute path
    const absolutePath = path.resolve(filePath);
    const normalizedPath = path.normalize(absolutePath);

    // Prevent path traversal sequences
    if (filePath.includes('..') || normalizedPath.includes('..')) {
      throw new Error('Invalid file path: path traversal not allowed');
    }

    // Verify file is within an allowed repository
    let isAllowed = false;
    for (const basePath of this.allowedRepositories) {
      if (normalizedPath.startsWith(basePath + path.sep) || normalizedPath === basePath) {
        isAllowed = true;
        break;
      }
    }

    if (!isAllowed) {
      throw new Error('File path is not within a registered repository');
    }

    // Verify file exists and is a regular file
    try {
      const stats = await fs.stat(normalizedPath);
      if (!stats.isFile()) {
        throw new Error('Path must be a regular file');
      }

      // Check file size to prevent memory exhaustion
      if (stats.size > MAX_FILE_SIZE_BYTES) {
        throw new Error(`File too large: maximum size is ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB`);
      }
    } catch (error) {
      const message = isErrorObject(error) ? error.message : String(error);
      throw new Error(`Invalid file path: ${message}`);
    }

    return normalizedPath;
  }

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
   * @param contextLines - Number of lines to include before/after conflict (default: 5, max: 100)
   * @returns Array of conflict regions with context
   */
  async extractConflictRegions(
    filePath: string,
    contextLines: number = 5
  ): Promise<ConflictRegion[]> {
    // Validate contextLines parameter (P0-3: bounds checking)
    if (!Number.isInteger(contextLines) || contextLines < 0) {
      throw new Error('contextLines must be a non-negative integer');
    }

    if (contextLines > MAX_CONTEXT_LINES) {
      throw new Error(`contextLines cannot exceed ${MAX_CONTEXT_LINES}`);
    }

    // Validate file path (P0-2: prevent arbitrary file read)
    const validatedPath = await this.validateFilePath(filePath);

    try {
      const content = await fs.readFile(validatedPath, 'utf-8');
      const lines = content.split('\n');
      const conflicts: ConflictRegion[] = [];

      let i = 0;
      while (i < lines.length) {
        const line = lines[i];

        // Look for conflict start marker
        if (line.startsWith('<<<<<<<')) {
          const conflictStartLine = i;

          // Find separator (=======)
          let separatorLine = -1;
          for (let j = i + 1; j < lines.length; j++) {
            if (lines[j].startsWith('=======')) {
              separatorLine = j;
              break;
            }
          }

          if (separatorLine === -1) {
            // P1-3: Sanitize error messages - don't expose file paths
            throw new Error(`Malformed conflict at line ${i + 1}: no separator found`);
          }

          // Find conflict end marker (>>>>>>>)
          let conflictEndLine = -1;
          for (let j = separatorLine + 1; j < lines.length; j++) {
            if (lines[j].startsWith('>>>>>>>')) {
              conflictEndLine = j;
              break;
            }
          }

          if (conflictEndLine === -1) {
            // P1-3: Sanitize error messages
            throw new Error(`Malformed conflict at line ${i + 1}: no end marker found`);
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
            filePath: validatedPath,
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
      // P1-1: Fix unsafe error type assertion
      const message = isErrorObject(error) ? error.message : String(error);
      // P1-3: Don't expose file paths in error messages
      throw new Error(`Failed to extract conflict regions: ${message}`);
    }
  }

  /**
   * Get all files with merge conflicts in a repository
   *
   * @param repoPath - Path to git repository
   * @returns Array of file paths with unmerged conflicts
   */
  async getConflictedFiles(repoPath: string): Promise<string[]> {
    // P0-1: Validate repo path to prevent command injection
    const validatedPath = await this.validateRepoPath(repoPath);

    try {
      // P0-1 & P1-2: Use execFile instead of exec to prevent shell injection
      const { stdout } = await execFileAsync('git', ['diff', '--name-only', '--diff-filter=U'], {
        cwd: validatedPath,
      });

      return stdout.trim().split('\n').filter((f): f is string => f.length > 0);
    } catch (error) {
      // P1-1: Fix unsafe error type assertion
      const message = isErrorObject(error) ? error.message : String(error);
      throw new Error(`Failed to get conflicted files: ${message}`);
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
    // Validate and normalize repo path
    const normalizedRepoPath = await this.validateRepoPath(repoPath);
    const conflictedFiles = await this.getConflictedFiles(normalizedRepoPath);

    const allConflicts: ConflictRegion[] = [];

    for (const file of conflictedFiles) {
      // P1-4: Validate file paths from git output
      // Prevent path traversal via malicious git state
      if (file.includes('..') || path.isAbsolute(file)) {
        // Skip suspicious file paths (log warning in production)
        continue;
      }

      const absolutePath = path.join(normalizedRepoPath, file);

      // Verify resolved path is still within repo (P1-4)
      const normalizedAbsPath = path.normalize(absolutePath);
      if (!normalizedAbsPath.startsWith(normalizedRepoPath + path.sep) &&
          normalizedAbsPath !== normalizedRepoPath) {
        // Skip files outside repository
        continue;
      }

      const conflicts = await this.extractConflictRegions(normalizedAbsPath, contextLines);
      allConflicts.push(...conflicts);
    }

    return allConflicts;
  }

  /**
   * Resolve a conflict using AI (Tier 2: conflict-only resolution)
   *
   * @param conflict - Conflict region to resolve
   * @returns Resolution result with syntax validation
   */
  async resolveConflictWithAI(conflict: ConflictRegion): Promise<ConflictResolutionResult> {
    // Validate the conflict region is from an allowed repository
    await this.validateFilePath(conflict.filePath);

    // Delegate to Claude API service
    const result = await claudeAPIService.resolveConflict(conflict);

    // If resolution failed, return as-is
    if (result.error || !result.resolvedContent) {
      return result;
    }

    // Validate syntax of resolved content
    const language = syntaxValidator.detectLanguage(conflict.filePath);
    const validation = await syntaxValidator.validateContent(result.resolvedContent, language);

    // Update result with validation status
    return {
      ...result,
      syntaxValid: validation.valid,
      error: validation.valid ? undefined : `Syntax validation failed: ${validation.errors?.map(e => e.message).join('; ')}`
    };
  }

  /**
   * Resolve all conflicts in a file using AI
   *
   * @param filePath - Path to file with conflicts
   * @param contextLines - Context lines (default: 5)
   * @returns Array of resolution results
   */
  async resolveFileConflicts(
    filePath: string,
    contextLines: number = 5
  ): Promise<ConflictResolutionResult[]> {
    const validatedPath = await this.validateFilePath(filePath);
    const conflicts = await this.extractConflictRegions(validatedPath, contextLines);

    // Resolve conflicts sequentially to avoid rate limits
    const results: ConflictResolutionResult[] = [];

    for (const conflict of conflicts) {
      const result = await this.resolveConflictWithAI(conflict);
      results.push(result);
    }

    return results;
  }

  /**
   * Apply resolved content to a file
   *
   * Takes conflict regions and their resolutions, then applies them to the file
   * by replacing the conflict markers with the resolved content.
   *
   * @param filePath - Path to file
   * @param conflicts - Original conflict regions
   * @param resolutions - Resolution results
   */
  async applyResolutions(
    filePath: string,
    conflicts: ConflictRegion[],
    resolutions: ConflictResolutionResult[]
  ): Promise<void> {
    const validatedPath = await this.validateFilePath(filePath);

    if (conflicts.length !== resolutions.length) {
      throw new Error('Mismatch between conflicts and resolutions count');
    }

    // Verify all resolutions succeeded
    const failedResolutions = resolutions.filter(r => r.error || !r.syntaxValid);
    if (failedResolutions.length > 0) {
      const errors = failedResolutions.map(r => r.error || 'Syntax invalid').join('; ');
      throw new Error(`Cannot apply resolutions: ${errors}`);
    }

    try {
      // Read the file
      const content = await fs.readFile(validatedPath, 'utf-8');
      const lines = content.split('\n');

      // Apply resolutions in reverse order (bottom to top) to maintain line numbers
      const sortedPairs = conflicts
        .map((conflict, index) => ({ conflict, resolution: resolutions[index] }))
        .sort((a, b) => b.conflict.startLine - a.conflict.startLine);

      for (const { conflict, resolution } of sortedPairs) {
        // Find conflict markers
        const startLine = conflict.startLine - 1; // Convert to 0-indexed
        const endLine = conflict.endLine - 1;

        // Verify markers still exist at expected locations
        if (!lines[startLine]?.startsWith('<<<<<<<') || !lines[endLine]?.startsWith('>>>>>>>')) {
          throw new Error(
            `Conflict markers not found at expected location (lines ${conflict.startLine}-${conflict.endLine})`
          );
        }

        // Replace conflict markers and content with resolution
        const resolvedLines = resolution.resolvedContent.split('\n');
        lines.splice(startLine, endLine - startLine + 1, ...resolvedLines);
      }

      // Write back to file
      await fs.writeFile(validatedPath, lines.join('\n'), 'utf-8');
    } catch (error) {
      const message = isErrorObject(error) ? error.message : String(error);
      throw new Error(`Failed to apply resolutions: ${message}`);
    }
  }

  /**
   * Full workflow: Extract conflicts, resolve with AI, and apply
   *
   * @param filePath - Path to file with conflicts
   * @param contextLines - Context lines (default: 5)
   * @returns Resolution results
   */
  async resolveAndApply(
    filePath: string,
    contextLines: number = 5
  ): Promise<ConflictResolutionResult[]> {
    const validatedPath = await this.validateFilePath(filePath);

    // Extract conflicts
    const conflicts = await this.extractConflictRegions(validatedPath, contextLines);

    if (conflicts.length === 0) {
      return [];
    }

    // Resolve with AI
    const resolutions = await this.resolveFileConflicts(validatedPath, contextLines);

    // Apply resolutions
    await this.applyResolutions(validatedPath, conflicts, resolutions);

    return resolutions;
  }
}

export const conflictResolver = new ConflictResolver();
export default conflictResolver;

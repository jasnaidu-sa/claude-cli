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
const DEFAULT_MAX_CONCURRENCY = 3; // Max parallel API calls

/**
 * Type guard for Error objects
 */
function isErrorObject(error: unknown): error is Error {
  return error instanceof Error;
}

/**
 * Process items in parallel with concurrency limit
 * P0 FIX: Use Set to track executing promises and proper cleanup via finally
 *
 * @param items - Array of items to process
 * @param processor - Async function to process each item
 * @param maxConcurrency - Maximum number of concurrent operations
 * @returns Array of results in original order
 */
async function parallelProcess<T, R>(
  items: T[],
  processor: (item: T, index: number) => Promise<R>,
  maxConcurrency: number
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  const executing = new Set<Promise<void>>();

  for (let i = 0; i < items.length; i++) {
    const promise = processor(items[i], i)
      .then((result) => {
        results[i] = result;
      })
      .finally(() => {
        // P0 FIX: Remove completed promise in finally to ensure proper cleanup
        executing.delete(promise);
      });

    executing.add(promise);

    if (executing.size >= maxConcurrency) {
      // Wait for any promise to complete
      await Promise.race(executing);
    }
  }

  // Wait for all remaining promises
  await Promise.all(executing);
  return results;
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
   * P0 FIX: Check raw input BEFORE normalization to prevent bypass
   *
   * @param repoPath - Path to validate
   * @returns Normalized path if valid
   * @throws Error if path is invalid or not a git repository
   */
  private async validateRepoPath(repoPath: string): Promise<string> {
    // P0 FIX: Check raw input FIRST before any normalization
    if (repoPath.includes('..') || repoPath.includes('%2e') || repoPath.includes('\0')) {
      throw new Error('Invalid repository path: path traversal not allowed');
    }

    // Normalize and resolve to absolute path
    const normalizedPath = path.normalize(path.resolve(repoPath));

    // Double-check after normalization (defense in depth)
    if (normalizedPath.includes('..')) {
      throw new Error('Invalid repository path: path traversal not allowed');
    }

    // Verify directory exists and is not a symlink (P1 FIX: TOCTOU mitigation)
    try {
      const stats = await fs.lstat(normalizedPath);
      if (stats.isSymbolicLink()) {
        throw new Error('Repository path cannot be a symlink');
      }
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
   * P0 FIX: Check raw input before normalization, P1 FIX: Require allowlist
   *
   * @param filePath - Path to validate
   * @returns Normalized path if valid
   * @throws Error if path is invalid or outside allowed repositories
   */
  private async validateFilePath(filePath: string): Promise<string> {
    // P1 FIX: Require allowlist to be populated
    if (this.allowedRepositories.size === 0) {
      throw new Error('No repositories registered. Call registerRepository() first.');
    }

    // P0 FIX: Check raw input FIRST before any normalization
    if (filePath.includes('..') || filePath.includes('%2e') || filePath.includes('\0')) {
      throw new Error('Invalid file path: path traversal not allowed');
    }

    // Resolve to absolute path
    const absolutePath = path.resolve(filePath);
    const normalizedPath = path.normalize(absolutePath);

    // Double-check after normalization (defense in depth)
    if (normalizedPath.includes('..')) {
      throw new Error('Invalid file path: path traversal not allowed');
    }

    // Verify file is within an allowed repository
    // Use Array.from for compatibility with older TypeScript targets
    let isAllowed = false;
    for (const basePath of Array.from(this.allowedRepositories)) {
      if (normalizedPath.startsWith(basePath + path.sep) || normalizedPath === basePath) {
        isAllowed = true;
        break;
      }
    }

    if (!isAllowed) {
      throw new Error('File path is not within a registered repository');
    }

    // P1 FIX: Use lstat to detect symlinks (TOCTOU mitigation)
    try {
      const stats = await fs.lstat(normalizedPath);
      if (stats.isSymbolicLink()) {
        throw new Error('Symlinks are not allowed');
      }
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
   * P1 FIX: Use -z flag for null-terminated output, validate filenames
   *
   * @param repoPath - Path to git repository
   * @returns Array of file paths with unmerged conflicts
   */
  async getConflictedFiles(repoPath: string): Promise<string[]> {
    // P0-1: Validate repo path to prevent command injection
    const validatedPath = await this.validateRepoPath(repoPath);

    try {
      // P1 FIX: Use -z flag for null-terminated output (handles newlines in filenames)
      const { stdout } = await execFileAsync('git', ['diff', '--name-only', '--diff-filter=U', '-z'], {
        cwd: validatedPath,
      });

      // P0 FIX: Handle empty output explicitly
      const trimmed = stdout.trim();
      if (!trimmed) {
        return [];
      }

      // P1 FIX: Split on null bytes, validate each filename
      const files = trimmed.split('\0').filter(f => f.length > 0);
      const validatedFiles: string[] = [];

      for (const file of files) {
        // P1 FIX: Validate filenames from git output
        if (
          file.includes('\0') ||
          file.includes('\n') ||
          file.includes('\r') ||
          file.includes('..') ||
          path.isAbsolute(file) ||
          file.startsWith('-') || // Prevent flag injection
          /[\x00-\x1F\x7F]/.test(file) // Control characters
        ) {
          // Skip suspicious filenames
          continue;
        }
        validatedFiles.push(file);
      }

      return validatedFiles;
    } catch (error) {
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
   * P1 FIX: Ensure all required properties are present in returned object
   *
   * @param conflict - Conflict region to resolve
   * @returns Resolution result with syntax validation
   */
  async resolveConflictWithAI(conflict: ConflictRegion): Promise<ConflictResolutionResult> {
    // Validate the conflict region is from an allowed repository
    await this.validateFilePath(conflict.filePath);

    // Delegate to Claude API service
    const result = await claudeAPIService.resolveConflict(conflict);

    // P1 FIX: If resolution failed, ensure all required properties are present
    if (result.error || !result.resolvedContent) {
      return {
        ...result,
        syntaxValid: result.syntaxValid ?? false,
        confidence: result.confidence ?? 0
      };
    }

    // Validate syntax of resolved content
    const language = syntaxValidator.detectLanguage(conflict.filePath);
    const validation = await syntaxValidator.validateContent(result.resolvedContent, language);

    // P1 FIX: Use nullish coalescing for validation.errors to prevent "undefined" string
    return {
      ...result,
      syntaxValid: validation.valid,
      error: validation.valid
        ? undefined
        : `Syntax validation failed: ${validation.errors?.map(e => e.message).join('; ') ?? 'Unknown error'}`
    };
  }

  /**
   * Resolve all conflicts in a file using AI with automatic Tier 3 fallback
   *
   * Strategy:
   * - Tier 2: Try conflict-only resolution for each conflict (parallel processing)
   * - Tier 3: If any resolution has low confidence or fails validation, use full-file resolution
   *
   * @param filePath - Path to file with conflicts
   * @param contextLines - Context lines (default: 5)
   * @param confidenceThreshold - Minimum confidence to accept Tier 2 (default: 60)
   * @param maxConcurrency - Max parallel API calls (default: 3)
   * @returns Array of resolution results
   */
  async resolveFileConflicts(
    filePath: string,
    contextLines: number = 5,
    confidenceThreshold: number = 60,
    maxConcurrency: number = DEFAULT_MAX_CONCURRENCY
  ): Promise<ConflictResolutionResult[]> {
    const validatedPath = await this.validateFilePath(filePath);
    const conflicts = await this.extractConflictRegions(validatedPath, contextLines);

    if (conflicts.length === 0) {
      return [];
    }

    // Tier 2: Try conflict-only resolution for each conflict (parallel)
    const tier2Results = await parallelProcess(
      conflicts,
      async (conflict) => this.resolveConflictWithAI(conflict),
      maxConcurrency
    );

    // P1 FIX: Use nullish coalescing for confidence to handle undefined values
    const needsFallback = tier2Results.some(
      (result) =>
        result.error !== undefined ||
        !result.syntaxValid ||
        (result.confidence ?? 0) < confidenceThreshold
    );

    if (needsFallback) {
      // Tier 3: Use full-file resolution
      const fileContent = await fs.readFile(validatedPath, 'utf-8');
      const fullFileResult = await claudeAPIService.resolveFileWithFullContext(
        validatedPath,
        fileContent,
        conflicts
      );

      // Validate the full-file resolution
      const language = syntaxValidator.detectLanguage(validatedPath);
      const validation = await syntaxValidator.validateContent(
        fullFileResult.resolvedContent,
        language
      );

      // P1 FIX: Update validation status with nullish coalescing for errors
      fullFileResult.syntaxValid = validation.valid;
      if (!validation.valid) {
        fullFileResult.error = `Syntax validation failed: ${validation.errors?.map(e => e.message).join('; ') ?? 'Unknown error'}`;
      }

      // Return a single result for the entire file
      return [fullFileResult];
    }

    // Return Tier 2 results if all passed
    return tier2Results;
  }

  /**
   * Apply resolved content to a file
   *
   * Handles both Tier 2 (conflict-only) and Tier 3 (full-file) resolutions:
   * - Tier 2: Replaces individual conflict markers with resolved content
   * - Tier 3: Replaces entire file content
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

    // Verify all resolutions succeeded
    const failedResolutions = resolutions.filter(r => r.error || !r.syntaxValid);
    if (failedResolutions.length > 0) {
      const errors = failedResolutions.map(r => r.error || 'Syntax invalid').join('; ');
      throw new Error(`Cannot apply resolutions: ${errors}`);
    }

    try {
      // Check if this is a Tier 3 full-file resolution
      if (resolutions.length === 1 && resolutions[0].strategy === 'ai-full-file') {
        // Full-file resolution: replace entire file
        await fs.writeFile(validatedPath, resolutions[0].resolvedContent, 'utf-8');
        return;
      }

      // Tier 2 conflict-only resolution: replace individual conflicts
      if (conflicts.length !== resolutions.length) {
        throw new Error('Mismatch between conflicts and resolutions count');
      }

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
   * @param confidenceThreshold - Minimum confidence for Tier 2 (default: 60)
   * @param maxConcurrency - Max parallel API calls (default: 3)
   * @returns Resolution results
   */
  async resolveAndApply(
    filePath: string,
    contextLines: number = 5,
    confidenceThreshold: number = 60,
    maxConcurrency: number = DEFAULT_MAX_CONCURRENCY
  ): Promise<ConflictResolutionResult[]> {
    const validatedPath = await this.validateFilePath(filePath);

    // Extract conflicts
    const conflicts = await this.extractConflictRegions(validatedPath, contextLines);

    if (conflicts.length === 0) {
      return [];
    }

    // Resolve with AI (with parallel processing and automatic fallback)
    const resolutions = await this.resolveFileConflicts(
      validatedPath,
      contextLines,
      confidenceThreshold,
      maxConcurrency
    );

    // Apply resolutions
    await this.applyResolutions(validatedPath, conflicts, resolutions);

    return resolutions;
  }

  /**
   * Resolve conflicts across multiple files in parallel
   *
   * Processes multiple conflicted files concurrently with concurrency control.
   * Each file is independently resolved using the 3-tier strategy.
   *
   * @param repoPath - Repository path
   * @param contextLines - Context lines (default: 5)
   * @param confidenceThreshold - Minimum confidence for Tier 2 (default: 60)
   * @param maxConcurrency - Max parallel file operations (default: 3)
   * @returns Map of file paths to resolution results
   */
  async resolveAllConflictsInRepo(
    repoPath: string,
    contextLines: number = 5,
    confidenceThreshold: number = 60,
    maxConcurrency: number = DEFAULT_MAX_CONCURRENCY
  ): Promise<Map<string, ConflictResolutionResult[]>> {
    const normalizedRepoPath = await this.validateRepoPath(repoPath);
    const conflictedFiles = await this.getConflictedFiles(normalizedRepoPath);

    const results = new Map<string, ConflictResolutionResult[]>();

    // Process files in parallel with concurrency limit
    await parallelProcess(
      conflictedFiles,
      async (file) => {
        const absolutePath = path.join(normalizedRepoPath, file);

        // Validate and resolve
        const resolutions = await this.resolveFileConflicts(
          absolutePath,
          contextLines,
          confidenceThreshold,
          maxConcurrency
        );

        results.set(file, resolutions);
      },
      maxConcurrency
    );

    return results;
  }

  /**
   * Resolve and apply conflicts across entire repository
   *
   * @param repoPath - Repository path
   * @param contextLines - Context lines (default: 5)
   * @param confidenceThreshold - Minimum confidence for Tier 2 (default: 60)
   * @param maxConcurrency - Max parallel file operations (default: 3)
   * @returns Map of file paths to resolution results
   */
  async resolveAndApplyAllInRepo(
    repoPath: string,
    contextLines: number = 5,
    confidenceThreshold: number = 60,
    maxConcurrency: number = DEFAULT_MAX_CONCURRENCY
  ): Promise<Map<string, ConflictResolutionResult[]>> {
    const normalizedRepoPath = await this.validateRepoPath(repoPath);
    const conflictedFiles = await this.getConflictedFiles(normalizedRepoPath);

    const results = new Map<string, ConflictResolutionResult[]>();

    // Process files in parallel with concurrency limit
    await parallelProcess(
      conflictedFiles,
      async (file) => {
        const absolutePath = path.join(normalizedRepoPath, file);

        // Resolve and apply
        const resolutions = await this.resolveAndApply(
          absolutePath,
          contextLines,
          confidenceThreshold,
          maxConcurrency
        );

        results.set(file, resolutions);
      },
      maxConcurrency
    );

    return results;
  }
}

export const conflictResolver = new ConflictResolver();
export default conflictResolver;

/**
 * BVS Worker Enforcement Service
 *
 * Enforces file ownership rules for parallel BVS workers to prevent conflicts.
 *
 * Ownership Rules:
 * - Each section owns specific files exclusively (cannot be modified by others)
 * - Shared files (package.json, tsconfig.json, shared types) can be modified by all
 * - Shared file changes are recorded and merged at merge points
 * - Workers receive ownership information in their prompts
 *
 * Architecture:
 * - checkWritePermission: Validates before Write tool execution
 * - checkEditPermission: Validates before Edit tool execution
 * - recordSharedFileChange: Records changes to shared files
 * - applySharedFileChanges: Merges shared file changes at merge points
 * - buildWorkerPromptWithOwnership: Generates prompts with ownership context
 */

import * as path from 'path'
import * as fs from 'fs/promises'

// ============================================================================
// Types
// ============================================================================

/**
 * File ownership entry in the ownership map
 */
export interface FileOwnership {
  sectionId: string
  exclusive: boolean // If true, only this section can modify the file
}

/**
 * Ownership map: file path -> ownership info
 */
export type OwnershipMap = Record<string, FileOwnership>

/**
 * Shared file change record
 */
export interface SharedFileChange {
  file: string
  sectionId: string
  changeType: 'add-dependency' | 'add-script' | 'add-type' | 'modify'
  description: string
  packageChanges?: {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
    scripts?: Record<string, string>
  }
  typeChanges?: {
    exports?: string[]
    imports?: string[]
  }
  contentPatch?: string
}

/**
 * Context for enforcement checks
 */
export interface EnforcementContext {
  sectionId: string
  ownershipMap: OwnershipMap
  sharedFileChanges: SharedFileChange[]
}

/**
 * Result of an enforcement check
 */
export interface EnforcementResult {
  allowed: boolean
  error?: string
  isSharedFile?: boolean
}

// ============================================================================
// BvsWorkerEnforcement Class
// ============================================================================

export class BvsWorkerEnforcement {
  /**
   * Check if a write operation is allowed
   */
  checkWritePermission(filePath: string, context: EnforcementContext): EnforcementResult {
    const normalizedPath = this.normalizePath(filePath)
    const ownership = context.ownershipMap[normalizedPath]

    // File not in ownership map - allowed (new file)
    if (!ownership) {
      return { allowed: true }
    }

    // File owned by current section - allowed
    if (ownership.sectionId === context.sectionId) {
      return { allowed: true }
    }

    // Shared file - allowed but mark as shared
    if (!ownership.exclusive) {
      return { allowed: true, isSharedFile: true }
    }

    // Exclusively owned by another section - rejected
    return {
      allowed: false,
      error: formatEnforcementError(
        filePath,
        'exclusively owned',
        ownership.sectionId
      ),
    }
  }

  /**
   * Check if an edit operation is allowed
   */
  checkEditPermission(filePath: string, context: EnforcementContext): EnforcementResult {
    // Edit permission same as write permission
    return this.checkWritePermission(filePath, context)
  }

  /**
   * Record a change to a shared file (with duplicate detection)
   */
  recordSharedFileChange(change: SharedFileChange, context: EnforcementContext): void {
    // Check for duplicates before adding
    const isDuplicate = context.sharedFileChanges.some(c =>
      c.file === change.file &&
      c.sectionId === change.sectionId &&
      c.changeType === change.changeType &&
      JSON.stringify(c.packageChanges) === JSON.stringify(change.packageChanges) &&
      c.contentPatch === change.contentPatch
    )

    if (!isDuplicate) {
      context.sharedFileChanges.push(change)
    }
  }

  /**
   * Get all shared file changes for this context
   */
  getSharedFileChanges(context: EnforcementContext): SharedFileChange[] {
    return context.sharedFileChanges
  }

  /**
   * Apply accumulated shared file changes to the project
   */
  async applySharedFileChanges(
    changes: SharedFileChange[],
    projectPath: string
  ): Promise<void> {
    // Group changes by file
    const changesByFile = new Map<string, SharedFileChange[]>()
    for (const change of changes) {
      const existing = changesByFile.get(change.file) || []
      existing.push(change)
      changesByFile.set(change.file, existing)
    }

    // Apply changes per file
    for (const [file, fileChanges] of Array.from(changesByFile.entries())) {
      await this.applyChangesToFile(file, fileChanges, projectPath)
    }
  }

  /**
   * Apply changes to a single file
   */
  private async applyChangesToFile(
    file: string,
    changes: SharedFileChange[],
    projectPath: string
  ): Promise<void> {
    // Validate and sanitize path to prevent path traversal
    const normalizedFile = path.normalize(file)
    if (normalizedFile.includes('..') || path.isAbsolute(normalizedFile)) {
      throw new Error(`Invalid file path: ${file} - must be relative without traversal`)
    }

    const filePath = path.join(projectPath, normalizedFile)

    // Ensure the resolved path is within the project directory
    const resolvedPath = path.resolve(filePath)
    const resolvedProjectPath = path.resolve(projectPath)
    if (!resolvedPath.startsWith(resolvedProjectPath)) {
      throw new Error(`Path traversal detected: ${file}`)
    }

    try {
      // Special handling for package.json
      if (normalizedFile === 'package.json') {
        await this.applyPackageJsonChanges(filePath, changes)
        return
      }

      // For other files, apply patches in order with duplicate detection
      for (const change of changes) {
        if (change.contentPatch) {
          const content = await fs.readFile(filePath, 'utf-8')
          // Check if patch already applied (prevent duplicates)
          if (!content.includes(change.contentPatch)) {
            const updatedContent = content + '\n' + change.contentPatch
            await fs.writeFile(filePath, updatedContent)
          }
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to apply changes to ${file}: ${errorMessage}`)
    }
  }

  /**
   * Apply changes to package.json
   */
  private async applyPackageJsonChanges(
    filePath: string,
    changes: SharedFileChange[]
  ): Promise<void> {
    try {
      const content = await fs.readFile(filePath, 'utf-8')
      let pkg: Record<string, unknown>

      try {
        pkg = JSON.parse(content)
      } catch (parseError) {
        throw new Error(`Invalid JSON in ${filePath}`)
      }

      const merged = mergePackageJsonChanges(pkg, changes)
      await fs.writeFile(filePath, JSON.stringify(merged, null, 2) + '\n')
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to apply package.json changes: ${errorMessage}`)
    }
  }

  /**
   * Normalize file path for consistent comparison
   */
  private normalizePath(filePath: string): string {
    // Convert backslashes to forward slashes and remove leading ./
    return filePath.replace(/\\/g, '/').replace(/^\.\//, '')
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Merge package.json changes from multiple sections
 */
export function mergePackageJsonChanges(
  existing: Record<string, unknown>,
  changes: SharedFileChange[]
): Record<string, unknown> {
  const result = { ...existing }

  for (const change of changes) {
    if (!change.packageChanges) continue

    // Merge dependencies
    if (change.packageChanges.dependencies) {
      result.dependencies = {
        ...(result.dependencies as Record<string, string> || {}),
        ...change.packageChanges.dependencies,
      }
    }

    // Merge devDependencies
    if (change.packageChanges.devDependencies) {
      result.devDependencies = {
        ...(result.devDependencies as Record<string, string> || {}),
        ...change.packageChanges.devDependencies,
      }
    }

    // Merge scripts
    if (change.packageChanges.scripts) {
      result.scripts = {
        ...(result.scripts as Record<string, string> || {}),
        ...change.packageChanges.scripts,
      }
    }
  }

  return result
}

/**
 * Format an enforcement error message
 */
export function formatEnforcementError(
  filePath: string,
  reason: string,
  owner?: string
): string {
  if (owner) {
    return `File "${filePath}" is ${reason} by section ${owner}. Cannot modify.`
  }
  return `File "${filePath}": ${reason}.`
}

/**
 * Build worker prompt with ownership information
 */
export function buildWorkerPromptWithOwnership(
  sectionId: string,
  ownershipMap: OwnershipMap,
  taskDescription: string
): string {
  const exclusiveFiles: string[] = []
  const sharedFiles: string[] = []

  // Categorize files by ownership
  for (const [file, ownership] of Object.entries(ownershipMap)) {
    if (ownership.sectionId === sectionId) {
      // Files owned by this section
      exclusiveFiles.push(file)
    } else if (!ownership.exclusive) {
      // Shared files
      sharedFiles.push(file)
    }
  }

  let prompt = `# TASK: ${taskDescription}\n\n`

  // Add file ownership section
  if (exclusiveFiles.length > 0 || sharedFiles.length > 0) {
    prompt += `## FILE OWNERSHIP\n\n`

    if (exclusiveFiles.length > 0) {
      prompt += `### Your Exclusive Files\n`
      prompt += `You have exclusive ownership of these files:\n`
      for (const file of exclusiveFiles) {
        prompt += `- ${file}\n`
      }
      prompt += `\n`
    }

    if (sharedFiles.length > 0) {
      prompt += `### SHARED FILES\n`
      prompt += `These files can be modified by multiple sections:\n`
      for (const file of sharedFiles) {
        prompt += `- ${file}\n`
      }
      prompt += `\n`
      prompt += `When modifying shared files:\n`
      prompt += `1. Record your changes using the provided tool\n`
      prompt += `2. Keep changes minimal and well-documented\n`
      prompt += `3. Avoid conflicting changes (e.g., same dependency version)\n`
      prompt += `\n`
    }

    // List files owned by other sections
    const otherFiles: Array<{ file: string; owner: string }> = []
    for (const [file, ownership] of Object.entries(ownershipMap)) {
      if (ownership.sectionId !== sectionId && ownership.exclusive) {
        otherFiles.push({ file, owner: ownership.sectionId })
      }
    }

    if (otherFiles.length > 0) {
      prompt += `### Files Owned by Other Sections (DO NOT MODIFY)\n`
      for (const { file, owner } of otherFiles) {
        prompt += `- ${file} (owned by ${owner})\n`
      }
      prompt += `\n`
    }
  }

  return prompt
}

// ============================================================================
// Singleton
// ============================================================================

let instance: BvsWorkerEnforcement | null = null

export function getBvsWorkerEnforcement(): BvsWorkerEnforcement {
  if (!instance) {
    instance = new BvsWorkerEnforcement()
  }
  return instance
}

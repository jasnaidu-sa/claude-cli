import type { BvsSection } from '../../shared/bvs-types'

// ============================================================================
// Types (will be moved to bvs-types.ts during integration)
// ============================================================================

export interface FileOwnership {
  exclusiveFiles: string[]
  exclusiveGlobs: string[]
  readOnlyDependencies: string[]
  boundaryImports: string[]
}

export interface BvsSectionV2 extends BvsSection {
  ownership: FileOwnership
  ownershipValidated: boolean
}

export interface OwnershipMap {
  fileToSection: Record<string, string>
  globToSection: Record<string, string>
  sharedFiles: string[]
  validatedAt: string
}

export interface ClassificationResult {
  exclusiveFiles: Map<string, string>
  sharedFiles: string[]
  patternMatchedShared: string[]
  conflicts: FileConflict[]
}

export interface FileConflict {
  file: string
  claimingSections: string[]
  resolution: 'first-wins' | 'shared' | 'manual'
}

export interface OwnershipValidationResult {
  isValid: boolean
  errors: string[]
  warnings: string[]
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Default shared file patterns from PRD
 * These files are read-only to all sections by default
 */
export const DEFAULT_SHARED_PATTERNS = [
  // Type definitions
  '**/*types.ts',
  '**/*-types.ts',
  '**/types/**',

  // Shared utilities
  '**/shared/**',
  '**/common/**',
  '**/utils/**',

  // Configuration files
  '**/package.json',
  '**/tsconfig.json',
  '**/vite.config.ts',
  '**/vitest.config.ts',
  '**/.eslintrc*',
  '**/.prettierrc*',

  // Root config
  'package.json',
  'tsconfig.json',
  'vite.config.ts',
  'vitest.config.ts',
  '.eslintrc.js',
  '.prettierrc.js',

  // Documentation
  '**/*.md',
  '**/README.md',
  '**/LICENSE',

  // Environment
  '**/.env',
  '**/.env.*',
]

// ============================================================================
// BvsOwnershipService
// ============================================================================

export class BvsOwnershipService {
  /**
   * Build ownership map from sections
   * First-wins resolution for conflicts
   */
  buildOwnershipMap(sections: BvsSectionV2[]): OwnershipMap {
    const fileToSection: Record<string, string> = {}
    const globToSection: Record<string, string> = {}
    const sharedFiles: string[] = []
    const conflictTracker = new Map<string, string[]>()

    // Process each section
    for (const section of sections) {
      // Process exclusive files
      for (const file of section.ownership.exclusiveFiles) {
        if (fileToSection[file]) {
          // Conflict detected - use safer array access
          const existing = conflictTracker.get(file) || [fileToSection[file]]
          if (!conflictTracker.has(file)) {
            conflictTracker.set(file, existing)
          }
          existing.push(section.id)

          // Mark as shared due to conflict
          if (!sharedFiles.includes(file)) {
            sharedFiles.push(file)
          }
        } else {
          // First-wins: assign to this section
          fileToSection[file] = section.id
        }
      }

      // Process exclusive globs
      for (const glob of section.ownership.exclusiveGlobs) {
        if (globToSection[glob]) {
          // Glob conflict - multiple sections claim same pattern
          // This is more serious than file conflict
          const existing = globToSection[glob]
          console.warn(`Glob conflict: ${glob} claimed by ${existing} and ${section.id}`)
        } else {
          globToSection[glob] = section.id
        }
      }
    }

    return {
      fileToSection,
      globToSection,
      sharedFiles,
      validatedAt: new Date().toISOString()
    }
  }

  /**
   * Check if a file is owned by a specific section
   * Returns false for shared files (no exclusive ownership)
   */
  isFileOwnedBy(file: string, sectionId: string, map: OwnershipMap): boolean {
    // Shared files have no exclusive owner
    if (map.sharedFiles.includes(file)) {
      return false
    }

    // Check exact file match
    if (map.fileToSection[file] === sectionId) {
      return true
    }

    // Check glob patterns
    for (const [glob, ownerId] of Object.entries(map.globToSection)) {
      if (ownerId === sectionId && this.matchesGlob(file, glob)) {
        return true
      }
    }

    return false
  }

  /**
   * Check if a file is shared (read-only to all)
   */
  isSharedFile(file: string, map: OwnershipMap): boolean {
    // Check explicit shared files (from conflicts)
    if (map.sharedFiles.includes(file)) {
      return true
    }

    // Check pattern-matched shared files
    return this.isPatternMatchedShared(file)
  }

  /**
   * Validate ownership map for conflicts and issues
   */
  validateOwnership(map: OwnershipMap): OwnershipValidationResult {
    const errors: string[] = []
    const warnings: string[] = []

    // Check for glob conflicts
    const globCounts = new Map<string, number>()
    for (const glob of Object.keys(map.globToSection)) {
      const count = Object.values(map.globToSection).filter(g => g === map.globToSection[glob]).length
      if (count > 1) {
        errors.push(`Glob pattern conflict: ${glob} claimed by multiple sections`)
      }
    }

    // Check for duplicate globs
    const globSections: Record<string, string[]> = {}
    for (const [glob, sectionId] of Object.entries(map.globToSection)) {
      if (!globSections[glob]) {
        globSections[glob] = []
      }
      globSections[glob].push(sectionId)
    }

    for (const [glob, sections] of Object.entries(globSections)) {
      if (sections.length > 1) {
        errors.push(`Glob pattern ${glob} claimed by sections: ${sections.join(', ')}`)
      }
    }

    // Warn about shared files (conflicts)
    if (map.sharedFiles.length > 0) {
      for (const file of map.sharedFiles) {
        warnings.push(`File ${file} claimed by multiple sections, marked as shared`)
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    }
  }

  /**
   * Get list of files a section can modify
   * Excludes shared files
   */
  getModifiableFiles(sectionId: string, map: OwnershipMap): string[] {
    const modifiable: string[] = []

    // Add exclusive files (excluding shared)
    for (const [file, ownerId] of Object.entries(map.fileToSection)) {
      if (ownerId === sectionId && !map.sharedFiles.includes(file)) {
        modifiable.push(file)
      }
    }

    // Add globs (they represent patterns, not specific files)
    for (const [glob, ownerId] of Object.entries(map.globToSection)) {
      if (ownerId === sectionId) {
        modifiable.push(glob)
      }
    }

    return modifiable
  }

  /**
   * Classify all files across sections
   * Detect conflicts and shared files
   */
  classifyFiles(
    sections: BvsSectionV2[],
    customPatterns?: string[]
  ): ClassificationResult {
    const exclusiveFiles = new Map<string, string>()
    const sharedFiles: string[] = []
    const conflicts: FileConflict[] = []
    const fileToSections: Record<string, string[]> = {}

    // Collect all file claims
    for (const section of sections) {
      for (const file of section.ownership.exclusiveFiles) {
        if (!fileToSections[file]) {
          fileToSections[file] = []
        }
        fileToSections[file].push(section.id)
      }
    }

    // Classify files
    for (const [file, claimingSections] of Object.entries(fileToSections)) {
      if (claimingSections.length === 1) {
        // Single owner - exclusive
        exclusiveFiles.set(file, claimingSections[0])
      } else {
        // Multiple owners - conflict
        conflicts.push({
          file,
          claimingSections,
          resolution: 'first-wins'
        })
        sharedFiles.push(file)
      }
    }

    // Get pattern-matched shared files
    const patterns = customPatterns || DEFAULT_SHARED_PATTERNS

    return {
      exclusiveFiles,
      sharedFiles,
      patternMatchedShared: patterns,
      conflicts
    }
  }

  // ============================================================================
  // Helper Functions
  // ============================================================================

  /**
   * Check if a file matches a glob pattern
   * Simple implementation without external dependencies
   */
  private matchesGlob(file: string, pattern: string): boolean {
    // Normalize paths to forward slashes
    const normalizedFile = file.replace(/\\/g, '/')
    const normalizedPattern = pattern.replace(/\\/g, '/')

    // Convert glob pattern to regex
    let regexPattern = normalizedPattern
      // **/ matches zero or more directories (including the trailing slash)
      .replace(/\*\*\//g, '§DOUBLESTAR_SLASH§')
      // /** at the end matches any depth
      .replace(/\/\*\*/g, '§SLASH_DOUBLESTAR§')
      // ** in the middle (after replacements above)
      .replace(/\*\*/g, '§DOUBLESTAR§')
      // * matches anything except /
      .replace(/\*/g, '§STAR§')
      // ? matches single character except /
      .replace(/\?/g, '§QUESTION§')
      // Now escape special regex characters
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      // Restore globs to regex patterns
      .replace(/§DOUBLESTAR_SLASH§/g, '(?:.*/)?')
      .replace(/§SLASH_DOUBLESTAR§/g, '(?:/.*)?')
      .replace(/§DOUBLESTAR§/g, '.*')
      .replace(/§STAR§/g, '[^/]*')
      .replace(/§QUESTION§/g, '[^/]')

    // Anchor the pattern
    const regex = new RegExp(`^${regexPattern}$`)
    return regex.test(normalizedFile)
  }

  /**
   * Check if file matches default shared patterns
   */
  private isPatternMatchedShared(file: string): boolean {
    for (const pattern of DEFAULT_SHARED_PATTERNS) {
      if (this.matchesGlob(file, pattern)) {
        return true
      }
    }
    return false
  }
}

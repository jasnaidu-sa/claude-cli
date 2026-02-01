import { describe, it, expect } from 'vitest'
import { BvsOwnershipService } from '../bvs-ownership-service'
import type {
  BvsSectionV2,
  FileOwnership,
  OwnershipMap,
  ClassificationResult,
  FileConflict,
  OwnershipValidationResult
} from '../bvs-ownership-service'
import type { BvsSection } from '../../../shared/bvs-types'

// Helper to create a BvsSection base
const createBaseSection = (id: string): BvsSection => ({
  id,
  name: `Section ${id}`,
  description: '',
  files: [],
  dependencies: [],
  dependents: [],
  status: 'pending',
  successCriteria: [],
  progress: 0,
  retryCount: 0,
  maxRetries: 3,
  commits: []
})

// Helper to create a BvsSectionV2
const createSection = (
  id: string,
  ownership: FileOwnership
): BvsSectionV2 => ({
  ...createBaseSection(id),
  ownership,
  ownershipValidated: false
})

describe('BvsOwnershipService', () => {
  const service = new BvsOwnershipService()

  describe('buildOwnershipMap', () => {
    it('should build map with exclusive files from multiple sections', () => {
      const sections: BvsSectionV2[] = [
        createSection('S1', {
          exclusiveFiles: ['src/auth/login.ts', 'src/auth/logout.ts'],
          exclusiveGlobs: [],
          readOnlyDependencies: [],
          boundaryImports: []
        }),
        createSection('S2', {
          exclusiveFiles: ['src/profile/settings.ts'],
          exclusiveGlobs: [],
          readOnlyDependencies: [],
          boundaryImports: []
        })
      ]

      const map = service.buildOwnershipMap(sections)

      expect(map.fileToSection['src/auth/login.ts']).toBe('S1')
      expect(map.fileToSection['src/auth/logout.ts']).toBe('S1')
      expect(map.fileToSection['src/profile/settings.ts']).toBe('S2')
      expect(map.sharedFiles).toHaveLength(0)
    })

    it('should build map with globs', () => {
      const sections: BvsSectionV2[] = [
        createSection('S1', {
          exclusiveFiles: [],
          exclusiveGlobs: ['src/auth/**/*.ts'],
          readOnlyDependencies: [],
          boundaryImports: []
        })
      ]

      const map = service.buildOwnershipMap(sections)

      expect(map.globToSection['src/auth/**/*.ts']).toBe('S1')
    })

    it('should mark conflicting files as shared (first-wins resolution)', () => {
      const sections: BvsSectionV2[] = [
        createSection('S1', {
          exclusiveFiles: ['src/shared/utils.ts'],
          exclusiveGlobs: [],
          readOnlyDependencies: [],
          boundaryImports: []
        }),
        createSection('S2', {
          exclusiveFiles: ['src/shared/utils.ts'],
          exclusiveGlobs: [],
          readOnlyDependencies: [],
          boundaryImports: []
        })
      ]

      const map = service.buildOwnershipMap(sections)

      // First-wins: S1 owns it
      expect(map.fileToSection['src/shared/utils.ts']).toBe('S1')
      // Marked as shared due to conflict
      expect(map.sharedFiles).toContain('src/shared/utils.ts')
    })

    it('should include validatedAt timestamp', () => {
      const sections: BvsSectionV2[] = [
        createSection('S1', {
          exclusiveFiles: ['src/test.ts'],
          exclusiveGlobs: [],
          readOnlyDependencies: [],
          boundaryImports: []
        })
      ]

      const map = service.buildOwnershipMap(sections)

      expect(map.validatedAt).toBeDefined()
      expect(new Date(map.validatedAt).getTime()).toBeGreaterThan(0)
    })
  })

  describe('isFileOwnedBy', () => {
    it('should return true for exact file match', () => {
      const sections: BvsSectionV2[] = [
        createSection('S1', {
          exclusiveFiles: ['src/auth/login.ts'],
          exclusiveGlobs: [],
          readOnlyDependencies: [],
          boundaryImports: []
        })
      ]

      const map = service.buildOwnershipMap(sections)

      expect(service.isFileOwnedBy('src/auth/login.ts', 'S1', map)).toBe(true)
      expect(service.isFileOwnedBy('src/auth/login.ts', 'S2', map)).toBe(false)
    })

    it('should return true for glob pattern match', () => {
      const sections: BvsSectionV2[] = [
        createSection('S1', {
          exclusiveFiles: [],
          exclusiveGlobs: ['src/auth/**/*.ts'],
          readOnlyDependencies: [],
          boundaryImports: []
        })
      ]

      const map = service.buildOwnershipMap(sections)

      expect(service.isFileOwnedBy('src/auth/login.ts', 'S1', map)).toBe(true)
      expect(service.isFileOwnedBy('src/auth/handlers/oauth.ts', 'S1', map)).toBe(true)
      expect(service.isFileOwnedBy('src/profile/settings.ts', 'S1', map)).toBe(false)
    })

    it('should return false for shared files', () => {
      const sections: BvsSectionV2[] = [
        createSection('S1', {
          exclusiveFiles: ['src/types.ts'],
          exclusiveGlobs: [],
          readOnlyDependencies: [],
          boundaryImports: []
        }),
        createSection('S2', {
          exclusiveFiles: ['src/types.ts'],
          exclusiveGlobs: [],
          readOnlyDependencies: [],
          boundaryImports: []
        })
      ]

      const map = service.buildOwnershipMap(sections)

      // File is shared, so no section exclusively owns it
      expect(service.isFileOwnedBy('src/types.ts', 'S1', map)).toBe(false)
      expect(service.isFileOwnedBy('src/types.ts', 'S2', map)).toBe(false)
    })
  })

  describe('isSharedFile', () => {
    it('should return true for files in sharedFiles array', () => {
      const sections: BvsSectionV2[] = [
        createSection('S1', {
          exclusiveFiles: ['src/config.ts'],
          exclusiveGlobs: [],
          readOnlyDependencies: [],
          boundaryImports: []
        }),
        createSection('S2', {
          exclusiveFiles: ['src/config.ts'],
          exclusiveGlobs: [],
          readOnlyDependencies: [],
          boundaryImports: []
        })
      ]

      const map = service.buildOwnershipMap(sections)

      expect(service.isSharedFile('src/config.ts', map)).toBe(true)
    })

    it('should return true for pattern-matched shared files', () => {
      const map = service.buildOwnershipMap([])

      expect(service.isSharedFile('src/types.ts', map)).toBe(true)
      expect(service.isSharedFile('src/shared/utils.ts', map)).toBe(true)
      expect(service.isSharedFile('package.json', map)).toBe(true)
      expect(service.isSharedFile('tsconfig.json', map)).toBe(true)
    })

    it('should return false for non-shared files', () => {
      const sections: BvsSectionV2[] = [
        createSection('S1', {
          exclusiveFiles: ['src/auth/login.ts'],
          exclusiveGlobs: [],
          readOnlyDependencies: [],
          boundaryImports: []
        })
      ]

      const map = service.buildOwnershipMap(sections)

      expect(service.isSharedFile('src/auth/login.ts', map)).toBe(false)
    })
  })

  describe('validateOwnership', () => {
    it('should validate clean ownership map', () => {
      const sections: BvsSectionV2[] = [
        createSection('S1', {
          exclusiveFiles: ['src/auth/login.ts'],
          exclusiveGlobs: [],
          readOnlyDependencies: [],
          boundaryImports: []
        }),
        createSection('S2', {
          exclusiveFiles: ['src/profile/settings.ts'],
          exclusiveGlobs: [],
          readOnlyDependencies: [],
          boundaryImports: []
        })
      ]

      const map = service.buildOwnershipMap(sections)
      const result = service.validateOwnership(map)

      expect(result.isValid).toBe(true)
      expect(result.errors).toHaveLength(0)
      expect(result.warnings).toHaveLength(0)
    })

    it('should warn about shared files', () => {
      const sections: BvsSectionV2[] = [
        createSection('S1', {
          exclusiveFiles: ['src/utils.ts'],
          exclusiveGlobs: [],
          readOnlyDependencies: [],
          boundaryImports: []
        }),
        createSection('S2', {
          exclusiveFiles: ['src/utils.ts'],
          exclusiveGlobs: [],
          readOnlyDependencies: [],
          boundaryImports: []
        })
      ]

      const map = service.buildOwnershipMap(sections)
      const result = service.validateOwnership(map)

      expect(result.isValid).toBe(true)
      expect(result.warnings.length).toBeGreaterThan(0)
      expect(result.warnings[0]).toContain('src/utils.ts')
    })

    it('should error on glob conflicts', () => {
      const sections: BvsSectionV2[] = [
        createSection('S1', {
          exclusiveFiles: [],
          exclusiveGlobs: ['src/auth/**/*.ts'],
          readOnlyDependencies: [],
          boundaryImports: []
        }),
        createSection('S2', {
          exclusiveFiles: [],
          exclusiveGlobs: ['src/auth/**/*.ts'],
          readOnlyDependencies: [],
          boundaryImports: []
        })
      ]

      const map = service.buildOwnershipMap(sections)
      const result = service.validateOwnership(map)

      expect(result.isValid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.errors[0]).toContain('src/auth/**/*.ts')
    })
  })

  describe('getModifiableFiles', () => {
    it('should return exclusive files for section', () => {
      const sections: BvsSectionV2[] = [
        createSection('S1', {
          exclusiveFiles: ['src/auth/login.ts', 'src/auth/logout.ts'],
          exclusiveGlobs: [],
          readOnlyDependencies: [],
          boundaryImports: []
        })
      ]

      const map = service.buildOwnershipMap(sections)
      const modifiable = service.getModifiableFiles('S1', map)

      expect(modifiable).toContain('src/auth/login.ts')
      expect(modifiable).toContain('src/auth/logout.ts')
      expect(modifiable).toHaveLength(2)
    })

    it('should include files matched by globs', () => {
      const sections: BvsSectionV2[] = [
        createSection('S1', {
          exclusiveFiles: ['src/auth/login.ts'],
          exclusiveGlobs: ['src/auth/handlers/**/*.ts'],
          readOnlyDependencies: [],
          boundaryImports: []
        })
      ]

      const map = service.buildOwnershipMap(sections)
      const modifiable = service.getModifiableFiles('S1', map)

      expect(modifiable).toContain('src/auth/login.ts')
      expect(modifiable).toContain('src/auth/handlers/**/*.ts')
    })

    it('should NOT include shared files', () => {
      const sections: BvsSectionV2[] = [
        createSection('S1', {
          exclusiveFiles: ['src/config.ts', 'src/auth/login.ts'],
          exclusiveGlobs: [],
          readOnlyDependencies: [],
          boundaryImports: []
        }),
        createSection('S2', {
          exclusiveFiles: ['src/config.ts'],
          exclusiveGlobs: [],
          readOnlyDependencies: [],
          boundaryImports: []
        })
      ]

      const map = service.buildOwnershipMap(sections)
      const modifiable = service.getModifiableFiles('S1', map)

      expect(modifiable).not.toContain('src/config.ts')
      expect(modifiable).toContain('src/auth/login.ts')
    })
  })

  describe('classifyFiles', () => {
    it('should classify exclusive files correctly', () => {
      const sections: BvsSectionV2[] = [
        createSection('S1', {
          exclusiveFiles: ['src/auth/login.ts'],
          exclusiveGlobs: [],
          readOnlyDependencies: [],
          boundaryImports: []
        }),
        createSection('S2', {
          exclusiveFiles: ['src/profile/settings.ts'],
          exclusiveGlobs: [],
          readOnlyDependencies: [],
          boundaryImports: []
        })
      ]

      const result = service.classifyFiles(sections)

      expect(result.exclusiveFiles.get('src/auth/login.ts')).toBe('S1')
      expect(result.exclusiveFiles.get('src/profile/settings.ts')).toBe('S2')
      expect(result.sharedFiles).toHaveLength(0)
      expect(result.conflicts).toHaveLength(0)
    })

    it('should detect conflicts between sections', () => {
      const sections: BvsSectionV2[] = [
        createSection('S1', {
          exclusiveFiles: ['src/utils.ts'],
          exclusiveGlobs: [],
          readOnlyDependencies: [],
          boundaryImports: []
        }),
        createSection('S2', {
          exclusiveFiles: ['src/utils.ts'],
          exclusiveGlobs: [],
          readOnlyDependencies: [],
          boundaryImports: []
        })
      ]

      const result = service.classifyFiles(sections)

      expect(result.conflicts).toHaveLength(1)
      expect(result.conflicts[0].file).toBe('src/utils.ts')
      expect(result.conflicts[0].claimingSections).toEqual(['S1', 'S2'])
      expect(result.conflicts[0].resolution).toBe('first-wins')
    })

    it('should identify pattern-matched shared files', () => {
      const sections: BvsSectionV2[] = [
        createSection('S1', {
          exclusiveFiles: ['src/auth/login.ts'],
          exclusiveGlobs: [],
          readOnlyDependencies: [],
          boundaryImports: []
        })
      ]

      const result = service.classifyFiles(sections)

      // Check that default patterns are recognized
      expect(result.patternMatchedShared).toContain('**/*types.ts')
      expect(result.patternMatchedShared).toContain('**/package.json')
    })

    it('should support custom shared patterns', () => {
      const sections: BvsSectionV2[] = [
        createSection('S1', {
          exclusiveFiles: ['src/auth/login.ts'],
          exclusiveGlobs: [],
          readOnlyDependencies: [],
          boundaryImports: []
        })
      ]

      const customPatterns = ['**/custom-shared.ts', '**/config/**']
      const result = service.classifyFiles(sections, customPatterns)

      expect(result.patternMatchedShared).toContain('**/custom-shared.ts')
      expect(result.patternMatchedShared).toContain('**/config/**')
    })
  })

  describe('helper functions', () => {
    it('matchesGlob should match file paths correctly', () => {
      expect(service['matchesGlob']('src/auth/login.ts', 'src/auth/**/*.ts')).toBe(true)
      expect(service['matchesGlob']('src/auth/handlers/oauth.ts', 'src/auth/**/*.ts')).toBe(true)
      expect(service['matchesGlob']('src/profile/settings.ts', 'src/auth/**/*.ts')).toBe(false)
      expect(service['matchesGlob']('package.json', '**/package.json')).toBe(true)
    })

    it('isPatternMatchedShared should match default patterns', () => {
      expect(service['isPatternMatchedShared']('src/types.ts')).toBe(true)
      expect(service['isPatternMatchedShared']('src/shared/utils.ts')).toBe(true)
      expect(service['isPatternMatchedShared']('package.json')).toBe(true)
      expect(service['isPatternMatchedShared']('tsconfig.json')).toBe(true)
      expect(service['isPatternMatchedShared']('src/auth/login.ts')).toBe(false)
    })
  })
})

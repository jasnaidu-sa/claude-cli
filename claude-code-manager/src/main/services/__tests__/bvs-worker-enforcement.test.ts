/**
 * BVS Worker Enforcement - Unit Tests
 *
 * Tests ownership enforcement for parallel worker file access.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  BvsWorkerEnforcement,
  mergePackageJsonChanges,
  formatEnforcementError,
  buildWorkerPromptWithOwnership,
  type SharedFileChange,
  type EnforcementContext,
  type OwnershipMap,
} from '../bvs-worker-enforcement'

describe('BvsWorkerEnforcement', () => {
  let enforcement: BvsWorkerEnforcement
  let ownershipMap: OwnershipMap
  let context: EnforcementContext

  beforeEach(() => {
    enforcement = new BvsWorkerEnforcement()

    // Sample ownership map
    ownershipMap = {
      'src/auth/login.tsx': { sectionId: 'S1', exclusive: true },
      'src/auth/register.tsx': { sectionId: 'S1', exclusive: true },
      'src/shared/types.ts': { sectionId: 'shared', exclusive: false },
      'package.json': { sectionId: 'shared', exclusive: false },
      'tsconfig.json': { sectionId: 'shared', exclusive: false },
    }

    context = {
      sectionId: 'S2',
      ownershipMap,
      sharedFileChanges: [],
    }
  })

  describe('checkWritePermission', () => {
    it('should allow write to unowned files', () => {
      const result = enforcement.checkWritePermission('src/dashboard/index.tsx', context)
      expect(result.allowed).toBe(true)
      expect(result.error).toBeUndefined()
    })

    it('should allow write to files owned by current section', () => {
      context.sectionId = 'S1'
      const result = enforcement.checkWritePermission('src/auth/login.tsx', context)
      expect(result.allowed).toBe(true)
    })

    it('should reject write to exclusively owned files', () => {
      const result = enforcement.checkWritePermission('src/auth/login.tsx', context)
      expect(result.allowed).toBe(false)
      expect(result.error).toContain('exclusively owned by section S1')
    })

    it('should allow write to shared files and mark as shared', () => {
      const result = enforcement.checkWritePermission('package.json', context)
      expect(result.allowed).toBe(true)
      expect(result.isSharedFile).toBe(true)
    })

    it('should allow write to shared types files', () => {
      const result = enforcement.checkWritePermission('src/shared/types.ts', context)
      expect(result.allowed).toBe(true)
      expect(result.isSharedFile).toBe(true)
    })
  })

  describe('checkEditPermission', () => {
    it('should allow edit to unowned files', () => {
      const result = enforcement.checkEditPermission('src/dashboard/index.tsx', context)
      expect(result.allowed).toBe(true)
    })

    it('should reject edit to exclusively owned files', () => {
      const result = enforcement.checkEditPermission('src/auth/login.tsx', context)
      expect(result.allowed).toBe(false)
      expect(result.error).toContain('exclusively owned by section S1')
    })

    it('should allow edit to shared files', () => {
      const result = enforcement.checkEditPermission('package.json', context)
      expect(result.allowed).toBe(true)
      expect(result.isSharedFile).toBe(true)
    })
  })

  describe('recordSharedFileChange', () => {
    it('should record package.json dependency changes', () => {
      const change: SharedFileChange = {
        file: 'package.json',
        sectionId: 'S2',
        changeType: 'add-dependency',
        description: 'Add axios for API calls',
        packageChanges: {
          dependencies: { axios: '^1.6.0' },
        },
      }

      enforcement.recordSharedFileChange(change, context)
      expect(context.sharedFileChanges).toHaveLength(1)
      expect(context.sharedFileChanges[0]).toEqual(change)
    })

    it('should record type exports', () => {
      const change: SharedFileChange = {
        file: 'src/shared/types.ts',
        sectionId: 'S2',
        changeType: 'add-type',
        description: 'Add DashboardStats interface',
        typeChanges: {
          exports: ['DashboardStats'],
          imports: [],
        },
      }

      enforcement.recordSharedFileChange(change, context)
      expect(context.sharedFileChanges).toHaveLength(1)
      expect(context.sharedFileChanges[0].typeChanges?.exports).toContain('DashboardStats')
    })

    it('should accumulate multiple changes', () => {
      const change1: SharedFileChange = {
        file: 'package.json',
        sectionId: 'S2',
        changeType: 'add-dependency',
        description: 'Add react-query',
        packageChanges: { dependencies: { 'react-query': '^3.0.0' } },
      }

      const change2: SharedFileChange = {
        file: 'package.json',
        sectionId: 'S2',
        changeType: 'add-script',
        description: 'Add test script',
        packageChanges: { scripts: { test: 'vitest' } },
      }

      enforcement.recordSharedFileChange(change1, context)
      enforcement.recordSharedFileChange(change2, context)
      expect(context.sharedFileChanges).toHaveLength(2)
    })
  })

  describe('getSharedFileChanges', () => {
    it('should return all recorded changes', () => {
      const change1: SharedFileChange = {
        file: 'package.json',
        sectionId: 'S2',
        changeType: 'add-dependency',
        description: 'Add dependency',
        packageChanges: { dependencies: { axios: '^1.6.0' } },
      }

      enforcement.recordSharedFileChange(change1, context)
      const changes = enforcement.getSharedFileChanges(context)
      expect(changes).toHaveLength(1)
      expect(changes[0]).toEqual(change1)
    })

    it('should return empty array if no changes', () => {
      const changes = enforcement.getSharedFileChanges(context)
      expect(changes).toEqual([])
    })
  })
})

describe('mergePackageJsonChanges', () => {
  it('should merge dependencies correctly', () => {
    const existing = {
      name: 'test-project',
      dependencies: { react: '^18.0.0' },
      devDependencies: { vitest: '^1.0.0' },
    }

    const changes: SharedFileChange[] = [
      {
        file: 'package.json',
        sectionId: 'S1',
        changeType: 'add-dependency',
        description: 'Add axios',
        packageChanges: { dependencies: { axios: '^1.6.0' } },
      },
      {
        file: 'package.json',
        sectionId: 'S2',
        changeType: 'add-dependency',
        description: 'Add react-query',
        packageChanges: { dependencies: { 'react-query': '^3.0.0' } },
      },
    ]

    const result = mergePackageJsonChanges(existing, changes)
    expect(result).toEqual({
      name: 'test-project',
      dependencies: {
        react: '^18.0.0',
        axios: '^1.6.0',
        'react-query': '^3.0.0',
      },
      devDependencies: { vitest: '^1.0.0' },
    })
  })

  it('should merge devDependencies correctly', () => {
    const existing = {
      name: 'test-project',
      devDependencies: { vitest: '^1.0.0' },
    }

    const changes: SharedFileChange[] = [
      {
        file: 'package.json',
        sectionId: 'S1',
        changeType: 'add-dependency',
        description: 'Add eslint',
        packageChanges: { devDependencies: { eslint: '^8.0.0' } },
      },
    ]

    const result = mergePackageJsonChanges(existing, changes)
    expect(result).toEqual({
      name: 'test-project',
      devDependencies: {
        vitest: '^1.0.0',
        eslint: '^8.0.0',
      },
    })
  })

  it('should merge scripts correctly', () => {
    const existing = {
      name: 'test-project',
      scripts: { dev: 'vite' },
    }

    const changes: SharedFileChange[] = [
      {
        file: 'package.json',
        sectionId: 'S1',
        changeType: 'add-script',
        description: 'Add test script',
        packageChanges: { scripts: { test: 'vitest' } },
      },
    ]

    const result = mergePackageJsonChanges(existing, changes)
    expect(result).toEqual({
      name: 'test-project',
      scripts: {
        dev: 'vite',
        test: 'vitest',
      },
    })
  })

  it('should handle version conflicts by preferring later changes', () => {
    const existing = {
      name: 'test-project',
      dependencies: { axios: '^1.0.0' },
    }

    const changes: SharedFileChange[] = [
      {
        file: 'package.json',
        sectionId: 'S1',
        changeType: 'add-dependency',
        description: 'Update axios',
        packageChanges: { dependencies: { axios: '^1.6.0' } },
      },
    ]

    const result = mergePackageJsonChanges(existing, changes)
    expect((result.dependencies as Record<string, string>).axios).toBe('^1.6.0')
  })
})

describe('formatEnforcementError', () => {
  it('should format error with owner', () => {
    const error = formatEnforcementError('src/auth/login.tsx', 'exclusive access', 'S1')
    expect(error).toContain('src/auth/login.tsx')
    expect(error).toContain('exclusive access')
    expect(error).toContain('S1')
  })

  it('should format error without owner', () => {
    const error = formatEnforcementError('package.json', 'shared file conflict')
    expect(error).toContain('package.json')
    expect(error).toContain('shared file conflict')
  })
})

describe('buildWorkerPromptWithOwnership', () => {
  it('should include ownership information', () => {
    const ownershipMap: OwnershipMap = {
      'src/auth/login.tsx': { sectionId: 'S1', exclusive: true },
      'package.json': { sectionId: 'shared', exclusive: false },
    }

    const prompt = buildWorkerPromptWithOwnership('S2', ownershipMap, 'Implement dashboard')
    expect(prompt).toContain('FILE OWNERSHIP')
    expect(prompt).toContain('src/auth/login.tsx')
    expect(prompt).toContain('S1')
    expect(prompt).toContain('owned by')
    expect(prompt).toContain('Implement dashboard')
  })

  it('should list shared files separately', () => {
    const ownershipMap: OwnershipMap = {
      'src/auth/login.tsx': { sectionId: 'S1', exclusive: true },
      'package.json': { sectionId: 'shared', exclusive: false },
      'src/shared/types.ts': { sectionId: 'shared', exclusive: false },
    }

    const prompt = buildWorkerPromptWithOwnership('S2', ownershipMap, 'Implement dashboard')
    expect(prompt).toContain('SHARED FILES')
    expect(prompt).toContain('package.json')
    expect(prompt).toContain('src/shared/types.ts')
  })

  it('should include task description', () => {
    const ownershipMap: OwnershipMap = {}
    const prompt = buildWorkerPromptWithOwnership('S1', ownershipMap, 'Create login form')
    expect(prompt).toContain('Create login form')
  })
})

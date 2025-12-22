/**
 * Basic smoke tests for ConflictResolver
 *
 * These tests verify that the ConflictResolver service can be instantiated
 * and has the expected public API. Full integration tests would require
 * git repository setup and mocked Claude API responses.
 */

import { conflictResolver } from '../conflict-resolver'

describe('ConflictResolver', () => {
  describe('API Surface', () => {
    it('should have registerRepository method', () => {
      expect(typeof conflictResolver.registerRepository).toBe('function')
    })

    it('should have extractConflictRegions method', () => {
      expect(typeof conflictResolver.extractConflictRegions).toBe('function')
    })

    it('should have resolveConflictWithAI method', () => {
      expect(typeof conflictResolver.resolveConflictWithAI).toBe('function')
    })

    it('should have resolveFileConflicts method', () => {
      expect(typeof conflictResolver.resolveFileConflicts).toBe('function')
    })

    it('should have applyResolutions method', () => {
      expect(typeof conflictResolver.applyResolutions).toBe('function')
    })

    it('should have resolveAndApply method', () => {
      expect(typeof conflictResolver.resolveAndApply).toBe('function')
    })

    it('should have resolveAndApplyAllInRepo method', () => {
      expect(typeof conflictResolver.resolveAndApplyAllInRepo).toBe('function')
    })
  })

  describe('Repository Registration', () => {
    it('should allow registering repository paths', () => {
      // Should not throw
      expect(() => {
        conflictResolver.registerRepository('/test/repo/path')
      }).not.toThrow()
    })
  })

  describe('Error Handling', () => {
    it('should reject invalid file paths', async () => {
      await expect(
        conflictResolver.extractConflictRegions('/nonexistent/file.ts')
      ).rejects.toThrow()
    })

    it('should reject unregistered repository paths', async () => {
      await expect(
        conflictResolver.resolveFileConflicts('/unregistered/repo/file.ts')
      ).rejects.toThrow()
    })
  })
})

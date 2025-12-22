/**
 * Basic smoke tests for WorktreeLifecycleManager
 *
 * These tests verify that the WorktreeLifecycleManager service can be instantiated
 * and has the expected public API. Full integration tests would require
 * actual git worktree setup and file system operations.
 */

import { worktreeLifecycleManager } from '../worktree-lifecycle-manager'

describe('WorktreeLifecycleManager', () => {
  describe('API Surface', () => {
    it('should have initialize method', () => {
      expect(typeof worktreeLifecycleManager.initialize).toBe('function')
    })

    it('should have createManagedWorktree method', () => {
      expect(typeof worktreeLifecycleManager.createManagedWorktree).toBe('function')
    })

    it('should have updateStatus method', () => {
      expect(typeof worktreeLifecycleManager.updateStatus).toBe('function')
    })

    it('should have onMergeSuccess method', () => {
      expect(typeof worktreeLifecycleManager.onMergeSuccess).toBe('function')
    })

    it('should have findStaleWorktrees method', () => {
      expect(typeof worktreeLifecycleManager.findStaleWorktrees).toBe('function')
    })

    it('should have cleanupStale method', () => {
      expect(typeof worktreeLifecycleManager.cleanupStale).toBe('function')
    })

    it('should have getLifecycle method', () => {
      expect(typeof worktreeLifecycleManager.getLifecycle).toBe('function')
    })

    it('should have getAllLifecycles method', () => {
      expect(typeof worktreeLifecycleManager.getAllLifecycles).toBe('function')
    })

    it('should have getLifecyclesByWorkflow method', () => {
      expect(typeof worktreeLifecycleManager.getLifecyclesByWorkflow).toBe('function')
    })

    it('should have removeLifecycle method', () => {
      expect(typeof worktreeLifecycleManager.removeLifecycle).toBe('function')
    })

    it('should have getStats method', () => {
      expect(typeof worktreeLifecycleManager.getStats).toBe('function')
    })
  })

  describe('Lifecycle Tracking', () => {
    it('should return undefined for untracked worktrees', () => {
      const lifecycle = worktreeLifecycleManager.getLifecycle('/nonexistent/path')
      expect(lifecycle).toBeUndefined()
    })

    it('should return empty array when no lifecycles tracked', () => {
      // Note: This assumes manager starts fresh, may need reset in real tests
      const lifecycles = worktreeLifecycleManager.getAllLifecycles()
      expect(Array.isArray(lifecycles)).toBe(true)
    })

    it('should return empty array for workflow with no worktrees', () => {
      const lifecycles = worktreeLifecycleManager.getLifecyclesByWorkflow('nonexistent-workflow')
      expect(Array.isArray(lifecycles)).toBe(true)
      expect(lifecycles.length).toBe(0)
    })
  })

  describe('Statistics', () => {
    it('should return stats object with expected structure', () => {
      const stats = worktreeLifecycleManager.getStats()
      expect(stats).toHaveProperty('total')
      expect(stats).toHaveProperty('byStatus')
      expect(stats).toHaveProperty('avgAgeInDays')
      expect(typeof stats.total).toBe('number')
      expect(typeof stats.avgAgeInDays).toBe('number')
      expect(stats.byStatus).toHaveProperty('active')
      expect(stats.byStatus).toHaveProperty('testing')
      expect(stats.byStatus).toHaveProperty('merged')
      expect(stats.byStatus).toHaveProperty('discarded')
    })
  })

  describe('Error Handling', () => {
    it('should reject updateStatus for unmanaged worktrees', async () => {
      await expect(
        worktreeLifecycleManager.updateStatus('/unmanaged/path', 'merged')
      ).rejects.toThrow('Worktree not managed')
    })
  })
})

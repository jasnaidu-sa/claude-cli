/**
 * BVS Mode Registry Service - Unit Tests
 *
 * Tests for mode transition logic, state persistence, and conflict detection.
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import { BvsModeRegistry, ModeConflictError } from '../bvs-mode-registry'

describe('BvsModeRegistry', () => {
  let registry: BvsModeRegistry
  let testWorkspaceDir: string
  let stateFilePath: string

  beforeEach(async () => {
    // Create temp workspace for testing
    testWorkspaceDir = path.join(__dirname, '.test-workspace', `test-${Date.now()}`)
    stateFilePath = path.join(testWorkspaceDir, '.bvs', 'mode-state.json')
    await fs.mkdir(testWorkspaceDir, { recursive: true })
    registry = new BvsModeRegistry(testWorkspaceDir)
  })

  afterEach(async () => {
    // Cleanup test workspace
    try {
      await fs.rm(testWorkspaceDir, { recursive: true, force: true })
    } catch (error) {
      // Ignore cleanup errors
    }
  })

  describe('Initial State', () => {
    test('should start in idle mode', () => {
      const state = registry.getState()
      expect(state.currentMode).toBe('idle')
      expect(state.activeSubModes).toEqual([])
      expect(state.modeData).toBeUndefined()
    })

    test('should have enteredAt timestamp', () => {
      const state = registry.getState()
      expect(state.enteredAt).toBeDefined()
      expect(new Date(state.enteredAt).getTime()).toBeLessThanOrEqual(Date.now())
    })
  })

  describe('Mode Transitions - Basic', () => {
    test('should allow transition from idle to planning', async () => {
      const result = registry.canEnterMode('planning')
      expect(result.allowed).toBe(true)

      await registry.enterMode('planning', { projectId: 'test-project-1' })
      const state = registry.getState()
      expect(state.currentMode).toBe('planning')
      expect(state.projectId).toBe('test-project-1')
    })

    test('should allow transition from planning to decomposing', async () => {
      await registry.enterMode('planning', { projectId: 'test-project-1' })

      const result = registry.canEnterMode('decomposing', { projectId: 'test-project-1' })
      expect(result.allowed).toBe(true)

      await registry.enterMode('decomposing', { projectId: 'test-project-1' })
      expect(registry.getState().currentMode).toBe('decomposing')
    })

    test('should allow transition from decomposing to executing', async () => {
      await registry.enterMode('planning', { projectId: 'test-project-1' })
      await registry.enterMode('decomposing', { projectId: 'test-project-1' })

      const result = registry.canEnterMode('executing', { projectId: 'test-project-1', sessionId: 'session-1' })
      expect(result.allowed).toBe(true)

      await registry.enterMode('executing', { projectId: 'test-project-1', sessionId: 'session-1' })
      const state = registry.getState()
      expect(state.currentMode).toBe('executing')
      expect(state.sessionId).toBe('session-1')
    })

    test('should allow transition from executing to integrating', async () => {
      await registry.enterMode('planning', { projectId: 'test-project-1' })
      await registry.enterMode('decomposing', { projectId: 'test-project-1' })
      await registry.enterMode('executing', { projectId: 'test-project-1', sessionId: 'session-1' })

      const result = registry.canEnterMode('integrating', { projectId: 'test-project-1' })
      expect(result.allowed).toBe(true)

      await registry.enterMode('integrating', { projectId: 'test-project-1' })
      expect(registry.getState().currentMode).toBe('integrating')
    })

    test('should allow transition back to idle', async () => {
      await registry.enterMode('planning', { projectId: 'test-project-1' })

      const result = registry.canEnterMode('idle')
      expect(result.allowed).toBe(true)

      await registry.enterMode('idle')
      const state = registry.getState()
      expect(state.currentMode).toBe('idle')
      expect(state.projectId).toBeUndefined()
      expect(state.sessionId).toBeUndefined()
    })
  })

  describe('Mode Conflicts - Exclusive Modes', () => {
    test('should prevent planning if already planning different project', async () => {
      await registry.enterMode('planning', { projectId: 'project-1' })

      const result = registry.canEnterMode('planning', { projectId: 'project-2' })
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('different project context')
      expect(result.conflictingMode).toBe('planning')
    })

    test('should allow planning same project (re-entry)', async () => {
      await registry.enterMode('planning', { projectId: 'project-1' })

      const result = registry.canEnterMode('planning', { projectId: 'project-1' })
      expect(result.allowed).toBe(true)
    })

    test('should prevent decomposing different project while decomposing', async () => {
      await registry.enterMode('planning', { projectId: 'project-1' })
      await registry.enterMode('decomposing', { projectId: 'project-1' })

      const result = registry.canEnterMode('decomposing', { projectId: 'project-2' })
      expect(result.allowed).toBe(false)
      expect(result.conflictingMode).toBe('decomposing')
    })

    test('should prevent executing different session while executing', async () => {
      await registry.enterMode('planning', { projectId: 'project-1' })
      await registry.enterMode('decomposing', { projectId: 'project-1' })
      await registry.enterMode('executing', { projectId: 'project-1', sessionId: 'session-1' })

      const result = registry.canEnterMode('executing', { projectId: 'project-1', sessionId: 'session-2' })
      expect(result.allowed).toBe(false)
      expect(result.conflictingMode).toBe('executing')
    })

    test('should prevent integrating different project', async () => {
      await registry.enterMode('planning', { projectId: 'project-1' })
      await registry.enterMode('decomposing', { projectId: 'project-1' })
      await registry.enterMode('executing', { projectId: 'project-1', sessionId: 'session-1' })
      await registry.enterMode('integrating', { projectId: 'project-1' })

      const result = registry.canEnterMode('integrating', { projectId: 'project-2' })
      expect(result.allowed).toBe(false)
      expect(result.conflictingMode).toBe('integrating')
    })

    test('should prevent invalid transitions', async () => {
      await registry.enterMode('planning', { projectId: 'project-1' })

      // Cannot go directly from planning to executing
      const result = registry.canEnterMode('executing', { projectId: 'project-1', sessionId: 'session-1' })
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('Cannot enter')
    })
  })

  describe('Sub-Mode Support', () => {
    test('should allow validating as sub-mode of executing', async () => {
      await registry.enterMode('planning', { projectId: 'project-1' })
      await registry.enterMode('decomposing', { projectId: 'project-1' })
      await registry.enterMode('executing', { projectId: 'project-1', sessionId: 'session-1' })

      const result = registry.canEnterMode('validating', { projectId: 'project-1', sessionId: 'session-1' })
      expect(result.allowed).toBe(true)

      await registry.enterMode('validating', { projectId: 'project-1', sessionId: 'session-1' })
      const state = registry.getState()
      expect(state.currentMode).toBe('executing')
      expect(state.activeSubModes).toContain('validating')
    })

    test('should prevent validating outside of executing', async () => {
      await registry.enterMode('planning', { projectId: 'project-1' })

      const result = registry.canEnterMode('validating', { projectId: 'project-1' })
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('can only be entered as sub-mode of')
      expect(result.suggestion).toContain('executing')
    })

    test('should remove sub-mode when exiting', async () => {
      await registry.enterMode('planning', { projectId: 'project-1' })
      await registry.enterMode('decomposing', { projectId: 'project-1' })
      await registry.enterMode('executing', { projectId: 'project-1', sessionId: 'session-1' })
      await registry.enterMode('validating', { projectId: 'project-1', sessionId: 'session-1' })

      await registry.exitMode()
      const state = registry.getState()
      expect(state.currentMode).toBe('executing')
      expect(state.activeSubModes).toEqual([])
    })

    test('should clear sub-modes when exiting parent mode', async () => {
      await registry.enterMode('planning', { projectId: 'project-1' })
      await registry.enterMode('decomposing', { projectId: 'project-1' })
      await registry.enterMode('executing', { projectId: 'project-1', sessionId: 'session-1' })
      await registry.enterMode('validating', { projectId: 'project-1', sessionId: 'session-1' })

      // Exit executing (parent mode)
      await registry.enterMode('idle')
      const state = registry.getState()
      expect(state.currentMode).toBe('idle')
      expect(state.activeSubModes).toEqual([])
    })
  })

  describe('State Persistence', () => {
    test('should persist state to .bvs/mode-state.json', async () => {
      await registry.enterMode('planning', { projectId: 'project-1' })

      // Check file exists
      const fileExists = await fs.access(stateFilePath).then(() => true).catch(() => false)
      expect(fileExists).toBe(true)

      // Check file contents
      const fileContents = await fs.readFile(stateFilePath, 'utf-8')
      const state = JSON.parse(fileContents)
      expect(state.currentMode).toBe('planning')
      expect(state.projectId).toBe('project-1')
    })

    test('should restore state from file on initialization', async () => {
      // Setup: Create state file
      await fs.mkdir(path.dirname(stateFilePath), { recursive: true })
      const savedState = {
        currentMode: 'executing',
        projectId: 'project-1',
        sessionId: 'session-1',
        enteredAt: new Date().toISOString(),
        activeSubModes: [],
      }
      await fs.writeFile(stateFilePath, JSON.stringify(savedState, null, 2))

      // Create new registry instance
      const newRegistry = new BvsModeRegistry(testWorkspaceDir)
      const state = newRegistry.getState()
      expect(state.currentMode).toBe('executing')
      expect(state.projectId).toBe('project-1')
      expect(state.sessionId).toBe('session-1')
    })

    test('should handle missing state file gracefully', async () => {
      // State file doesn't exist initially
      const state = registry.getState()
      expect(state.currentMode).toBe('idle')
    })

    test('should handle corrupted state file', async () => {
      // Setup: Create corrupted state file
      await fs.mkdir(path.dirname(stateFilePath), { recursive: true })
      await fs.writeFile(stateFilePath, 'not valid json {{{')

      // Should fallback to idle
      const newRegistry = new BvsModeRegistry(testWorkspaceDir)
      const state = newRegistry.getState()
      expect(state.currentMode).toBe('idle')
    })

    test('should persist sub-mode state', async () => {
      await registry.enterMode('planning', { projectId: 'project-1' })
      await registry.enterMode('decomposing', { projectId: 'project-1' })
      await registry.enterMode('executing', { projectId: 'project-1', sessionId: 'session-1' })
      await registry.enterMode('validating', { projectId: 'project-1', sessionId: 'session-1' })

      // Verify persisted state
      const fileContents = await fs.readFile(stateFilePath, 'utf-8')
      const state = JSON.parse(fileContents)
      expect(state.currentMode).toBe('executing')
      expect(state.activeSubModes).toContain('validating')
    })
  })

  describe('Event Notifications', () => {
    test('should notify listeners on mode change', async () => {
      const listener = jest.fn()
      registry.onModeChange(listener)

      await registry.enterMode('planning', { projectId: 'project-1' })

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          currentMode: 'planning',
          projectId: 'project-1',
        })
      )
    })

    test('should support multiple listeners', async () => {
      const listener1 = jest.fn()
      const listener2 = jest.fn()
      registry.onModeChange(listener1)
      registry.onModeChange(listener2)

      await registry.enterMode('planning', { projectId: 'project-1' })

      expect(listener1).toHaveBeenCalled()
      expect(listener2).toHaveBeenCalled()
    })

    test('should allow unsubscribing', async () => {
      const listener = jest.fn()
      const unsubscribe = registry.onModeChange(listener)

      unsubscribe()
      await registry.enterMode('planning', { projectId: 'project-1' })

      expect(listener).not.toHaveBeenCalled()
    })

    test('should notify on sub-mode entry', async () => {
      const listener = jest.fn()
      await registry.enterMode('planning', { projectId: 'project-1' })
      await registry.enterMode('decomposing', { projectId: 'project-1' })
      await registry.enterMode('executing', { projectId: 'project-1', sessionId: 'session-1' })

      listener.mockClear()
      registry.onModeChange(listener)

      await registry.enterMode('validating', { projectId: 'project-1', sessionId: 'session-1' })

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          currentMode: 'executing',
          activeSubModes: ['validating'],
        })
      )
    })
  })

  describe('Force Reset', () => {
    test('should force reset to idle regardless of current mode', async () => {
      await registry.enterMode('planning', { projectId: 'project-1' })
      await registry.enterMode('decomposing', { projectId: 'project-1' })
      await registry.enterMode('executing', { projectId: 'project-1', sessionId: 'session-1' })

      await registry.forceReset()

      const state = registry.getState()
      expect(state.currentMode).toBe('idle')
      expect(state.projectId).toBeUndefined()
      expect(state.sessionId).toBeUndefined()
      expect(state.activeSubModes).toEqual([])
    })

    test('should notify listeners on force reset', async () => {
      const listener = jest.fn()
      await registry.enterMode('planning', { projectId: 'project-1' })

      listener.mockClear()
      registry.onModeChange(listener)

      await registry.forceReset()

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          currentMode: 'idle',
        })
      )
    })

    test('should persist reset state', async () => {
      await registry.enterMode('planning', { projectId: 'project-1' })
      await registry.forceReset()

      const fileContents = await fs.readFile(stateFilePath, 'utf-8')
      const state = JSON.parse(fileContents)
      expect(state.currentMode).toBe('idle')
    })
  })

  describe('Exit Mode', () => {
    test('should exit to idle when in top-level mode', async () => {
      await registry.enterMode('planning', { projectId: 'project-1' })
      await registry.exitMode()

      expect(registry.getState().currentMode).toBe('idle')
    })

    test('should exit sub-mode without changing parent mode', async () => {
      await registry.enterMode('planning', { projectId: 'project-1' })
      await registry.enterMode('decomposing', { projectId: 'project-1' })
      await registry.enterMode('executing', { projectId: 'project-1', sessionId: 'session-1' })
      await registry.enterMode('validating', { projectId: 'project-1', sessionId: 'session-1' })

      await registry.exitMode()

      const state = registry.getState()
      expect(state.currentMode).toBe('executing')
      expect(state.activeSubModes).toEqual([])
    })

    test('should be idempotent when already in idle', async () => {
      expect(registry.getState().currentMode).toBe('idle')

      await registry.exitMode()

      expect(registry.getState().currentMode).toBe('idle')
    })
  })

  describe('ModeConflictError', () => {
    test('should throw ModeConflictError on invalid transition', async () => {
      await registry.enterMode('planning', { projectId: 'project-1' })

      await expect(
        registry.enterMode('planning', { projectId: 'project-2' })
      ).rejects.toThrow(ModeConflictError)
    })

    test('should include helpful error message', async () => {
      await registry.enterMode('planning', { projectId: 'project-1' })

      try {
        await registry.enterMode('planning', { projectId: 'project-2' })
        fail('Should have thrown ModeConflictError')
      } catch (error) {
        expect(error).toBeInstanceOf(ModeConflictError)
        expect((error as Error).message).toContain('already in planning mode')
      }
    })
  })

  describe('Mode Data', () => {
    test('should preserve modeData across transitions', async () => {
      await registry.enterMode('planning', { projectId: 'project-1' })

      // Simulate storing data
      const state = registry.getState()
      state.modeData = { planId: 'plan-123', version: 1 }

      await registry.enterMode('decomposing', { projectId: 'project-1' })

      const newState = registry.getState()
      expect(newState.modeData).toEqual({ planId: 'plan-123', version: 1 })
    })

    test('should clear modeData when returning to idle', async () => {
      await registry.enterMode('planning', { projectId: 'project-1' })
      const state = registry.getState()
      state.modeData = { planId: 'plan-123' }

      await registry.enterMode('idle')

      const newState = registry.getState()
      expect(newState.modeData).toBeUndefined()
    })
  })

  describe('Edge Cases', () => {
    test('should handle rapid mode transitions', async () => {
      await registry.enterMode('planning', { projectId: 'project-1' })
      await registry.enterMode('decomposing', { projectId: 'project-1' })
      await registry.enterMode('executing', { projectId: 'project-1', sessionId: 'session-1' })
      await registry.enterMode('integrating', { projectId: 'project-1' })
      await registry.enterMode('idle')

      expect(registry.getState().currentMode).toBe('idle')
    })

    test('should handle missing context gracefully', async () => {
      const result = registry.canEnterMode('executing')
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('requires sessionId')
    })

    test('should prevent planning from executing', async () => {
      await registry.enterMode('planning', { projectId: 'project-1' })
      await registry.enterMode('decomposing', { projectId: 'project-1' })
      await registry.enterMode('executing', { projectId: 'project-1', sessionId: 'session-1' })

      // Cannot go back to planning from executing
      const result = registry.canEnterMode('planning', { projectId: 'project-1' })
      expect(result.allowed).toBe(false)
    })
  })
})

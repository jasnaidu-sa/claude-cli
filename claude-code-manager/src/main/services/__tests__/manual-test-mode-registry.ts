/**
 * Manual test runner for BvsModeRegistry
 * Run with: npx tsx src/main/services/__tests__/manual-test-mode-registry.ts
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import { BvsModeRegistry, ModeConflictError, MODE_CONFIGS } from '../bvs-mode-registry'

const testWorkspaceDir = path.join(__dirname, '.test-workspace-manual')

async function cleanup() {
  try {
    await fs.rm(testWorkspaceDir, { recursive: true, force: true })
  } catch (error) {
    // Ignore
  }
}

async function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error(`❌ FAILED: ${message}`)
    console.error(`  Expected: ${JSON.stringify(expected)}`)
    console.error(`  Actual: ${JSON.stringify(actual)}`)
    process.exit(1)
  }
  console.log(`✅ PASSED: ${message}`)
}

async function assertTrue(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`)
    process.exit(1)
  }
  console.log(`✅ PASSED: ${message}`)
}

async function assertThrows(fn: () => Promise<void>, message: string) {
  try {
    await fn()
    console.error(`❌ FAILED: ${message} (expected to throw)`)
    process.exit(1)
  } catch (error) {
    console.log(`✅ PASSED: ${message}`)
  }
}

async function runTests() {
  console.log('🧪 Running BvsModeRegistry Manual Tests\n')

  // Clean up before tests
  await cleanup()
  await fs.mkdir(testWorkspaceDir, { recursive: true })

  // Test 1: Initial state
  console.log('--- Test 1: Initial State ---')
  let registry = new BvsModeRegistry(testWorkspaceDir)
  await assertEqual(registry.getState().currentMode, 'idle', 'Should start in idle mode')
  await assertEqual(registry.getState().activeSubModes, [], 'Should have no sub-modes initially')

  // Test 2: Basic mode transition
  console.log('\n--- Test 2: Basic Mode Transition ---')
  const result = registry.canEnterMode('planning')
  await assertTrue(result.allowed, 'Should allow transition to planning')
  await registry.enterMode('planning', { projectId: 'test-project-1' })
  await assertEqual(registry.getState().currentMode, 'planning', 'Should be in planning mode')
  await assertEqual(registry.getState().projectId, 'test-project-1', 'Should have project ID')

  // Test 3: Sequential workflow
  console.log('\n--- Test 3: Sequential Workflow ---')
  await registry.enterMode('decomposing', { projectId: 'test-project-1' })
  await assertEqual(registry.getState().currentMode, 'decomposing', 'Should be in decomposing mode')

  await registry.enterMode('executing', { projectId: 'test-project-1', sessionId: 'session-1' })
  await assertEqual(registry.getState().currentMode, 'executing', 'Should be in executing mode')
  await assertEqual(registry.getState().sessionId, 'session-1', 'Should have session ID')

  // Test 4: Sub-mode support
  console.log('\n--- Test 4: Sub-Mode Support ---')
  const validatingResult = registry.canEnterMode('validating', { projectId: 'test-project-1', sessionId: 'session-1' })
  await assertTrue(validatingResult.allowed, 'Should allow validating as sub-mode')

  await registry.enterMode('validating', { projectId: 'test-project-1', sessionId: 'session-1' })
  await assertEqual(registry.getState().currentMode, 'executing', 'Parent mode should remain executing')
  await assertTrue(
    registry.getState().activeSubModes.includes('validating'),
    'Should have validating sub-mode'
  )

  // Test 5: Exit sub-mode
  console.log('\n--- Test 5: Exit Sub-Mode ---')
  await registry.exitMode()
  await assertEqual(registry.getState().currentMode, 'executing', 'Should still be in executing mode')
  await assertEqual(registry.getState().activeSubModes, [], 'Should have no sub-modes after exit')

  // Test 6: Conflict detection
  console.log('\n--- Test 6: Conflict Detection ---')
  await assertThrows(
    async () => await registry.enterMode('executing', { projectId: 'test-project-1', sessionId: 'session-2' }),
    'Should prevent entering different session while executing'
  )

  // Test 7: State persistence
  console.log('\n--- Test 7: State Persistence ---')
  const stateFilePath = path.join(testWorkspaceDir, '.bvs', 'mode-state.json')
  const fileExists = await fs.access(stateFilePath).then(() => true).catch(() => false)
  await assertTrue(fileExists, 'State file should exist')

  const fileContents = await fs.readFile(stateFilePath, 'utf-8')
  const state = JSON.parse(fileContents)
  await assertEqual(state.currentMode, 'executing', 'Persisted state should match current mode')

  // Test 8: State restoration
  console.log('\n--- Test 8: State Restoration ---')
  const newRegistry = new BvsModeRegistry(testWorkspaceDir)
  await assertEqual(newRegistry.getState().currentMode, 'executing', 'Should restore mode from file')
  await assertEqual(newRegistry.getState().projectId, 'test-project-1', 'Should restore project ID')
  await assertEqual(newRegistry.getState().sessionId, 'session-1', 'Should restore session ID')

  // Test 9: Force reset
  console.log('\n--- Test 9: Force Reset ---')
  await newRegistry.forceReset()
  await assertEqual(newRegistry.getState().currentMode, 'idle', 'Should reset to idle')
  await assertEqual(newRegistry.getState().projectId, undefined, 'Should clear project ID')
  await assertEqual(newRegistry.getState().sessionId, undefined, 'Should clear session ID')
  await assertEqual(newRegistry.getState().activeSubModes, [], 'Should clear sub-modes')

  // Test 10: Event notifications
  console.log('\n--- Test 10: Event Notifications ---')
  let notificationReceived = false
  const unsubscribe = newRegistry.onModeChange((state) => {
    if (state.currentMode === 'planning') {
      notificationReceived = true
    }
  })
  await newRegistry.enterMode('planning', { projectId: 'test-project-2' })
  await assertTrue(notificationReceived, 'Should notify listeners on mode change')
  unsubscribe()

  // Test 11: Unsubscribe works
  console.log('\n--- Test 11: Unsubscribe Works ---')
  let shouldNotReceive = false
  const unsub = newRegistry.onModeChange(() => {
    shouldNotReceive = true
  })
  unsub()
  await newRegistry.enterMode('idle')
  await assertTrue(!shouldNotReceive, 'Should not notify after unsubscribe')

  // Test 12: MODE_CONFIGS structure
  console.log('\n--- Test 12: MODE_CONFIGS Structure ---')
  await assertTrue(MODE_CONFIGS.idle !== undefined, 'Should have idle config')
  await assertTrue(MODE_CONFIGS.planning !== undefined, 'Should have planning config')
  await assertTrue(MODE_CONFIGS.decomposing !== undefined, 'Should have decomposing config')
  await assertTrue(MODE_CONFIGS.executing !== undefined, 'Should have executing config')
  await assertTrue(MODE_CONFIGS.validating !== undefined, 'Should have validating config')
  await assertTrue(MODE_CONFIGS.integrating !== undefined, 'Should have integrating config')
  await assertTrue(MODE_CONFIGS.executing.allowsSubMode.includes('validating'), 'Executing should allow validating sub-mode')

  // Test 13: Context mismatch detection
  console.log('\n--- Test 13: Context Mismatch Detection ---')
  await newRegistry.enterMode('planning', { projectId: 'project-1' })
  await newRegistry.enterMode('decomposing', { projectId: 'project-1' })
  const mismatchResult = newRegistry.canEnterMode('executing', { projectId: 'project-2', sessionId: 'session-1' })
  await assertTrue(!mismatchResult.allowed, 'Should detect project context mismatch')
  await assertTrue(mismatchResult.reason?.includes('project context mismatch') ?? false, 'Should have context mismatch reason')

  // Clean up after tests
  await cleanup()

  console.log('\n✅ All tests passed!')
}

runTests().catch(error => {
  console.error('\n❌ Test suite failed:', error)
  cleanup().finally(() => process.exit(1))
})

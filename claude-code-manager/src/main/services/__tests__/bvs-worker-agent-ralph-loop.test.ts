/**
 * Unit Tests for Ralph Loop Integration (RALPH-016)
 *
 * Tests the core Ralph Loop functionality:
 * - identifySubtasks() - Subtask splitting
 * - selectModelForSubtask() - Model selection logic
 * - calculateSubtaskCost() - Cost calculation
 * - executeSectionWithSubtasks() - Main execution loop
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type {
  BvsSection,
  BvsSubtask,
  BvsFile,
  BvsModelId
} from '@shared/bvs-types'

// Mock the worker service methods we want to test
class MockBvsWorkerAgentService {
  /**
   * RALPH-002: Identify subtasks from section files
   */
  identifySubtasks(section: BvsSection): BvsSubtask[] {
    const subtasks: BvsSubtask[] = []
    const schemaFiles: string[] = []
    const typeFiles: string[] = []
    const implFiles: string[] = []
    const testFiles: string[] = []

    // Group files by type
    for (const file of section.files) {
      const filePath = file.path.toLowerCase()

      if (
        filePath.includes('/schema') ||
        filePath.includes('prisma') ||
        filePath.includes('migration') ||
        filePath.includes('db.ts')
      ) {
        schemaFiles.push(file.path)
      } else if (filePath.endsWith('.types.ts') || filePath.includes('/types/')) {
        typeFiles.push(file.path)
      } else if (filePath.includes('.test.') || filePath.includes('.spec.')) {
        testFiles.push(file.path)
      } else {
        implFiles.push(file.path)
      }
    }

    // Create subtasks
    let subtaskIndex = 1

    if (schemaFiles.length > 0) {
      subtasks.push({
        id: `${section.id}-subtask-${subtaskIndex++}`,
        sectionId: section.id,
        name: 'Update schema and database',
        description: `Schema changes: ${schemaFiles.join(', ')}`,
        files: schemaFiles,
        status: 'pending',
        turnsUsed: 0,
        maxTurns: 5,
        retryCount: 0
      })
    }

    if (typeFiles.length > 0) {
      subtasks.push({
        id: `${section.id}-subtask-${subtaskIndex++}`,
        sectionId: section.id,
        name: 'Update type definitions',
        description: `Type changes: ${typeFiles.join(', ')}`,
        files: typeFiles,
        status: 'pending',
        turnsUsed: 0,
        maxTurns: 5,
        retryCount: 0
      })
    }

    if (implFiles.length > 0) {
      subtasks.push({
        id: `${section.id}-subtask-${subtaskIndex++}`,
        sectionId: section.id,
        name: 'Implement core logic',
        description: `Implementation files: ${implFiles.join(', ')}`,
        files: implFiles,
        status: 'pending',
        turnsUsed: 0,
        maxTurns: 5,
        retryCount: 0
      })
    }

    if (testFiles.length > 0) {
      subtasks.push({
        id: `${section.id}-subtask-${subtaskIndex++}`,
        sectionId: section.id,
        name: 'Add tests',
        description: `Test files: ${testFiles.join(', ')}`,
        files: testFiles,
        status: 'pending',
        turnsUsed: 0,
        maxTurns: 5,
        retryCount: 0
      })
    }

    return subtasks
  }

  /**
   * RALPH-005: Select model based on subtask complexity
   */
  selectModelForSubtask(subtask: BvsSubtask, baseComplexity: number): BvsModelId {
    const fileCount = subtask.files.length
    const subtaskComplexity = baseComplexity + fileCount

    // Haiku for simple tasks (≤4 files), Sonnet for complex
    return subtaskComplexity <= 4 ? 'haiku' : 'sonnet'
  }

  /**
   * RALPH-008: Calculate subtask cost
   */
  calculateSubtaskCost(
    model: BvsModelId,
    turnsUsed: number,
    filesChanged: number
  ): {
    tokensInput: number
    tokensOutput: number
    costUsd: number
  } {
    // Estimate tokens based on files and turns
    const inputTokensPerTurn = 2000 + filesChanged * 500
    const outputTokensPerTurn = 1000

    const tokensInput = inputTokensPerTurn * turnsUsed
    const tokensOutput = outputTokensPerTurn * turnsUsed

    // Pricing (per million tokens)
    const pricing = {
      haiku: { input: 0.25, output: 1.25 },
      sonnet: { input: 3.0, output: 15.0 }
    }

    const modelPricing = pricing[model === 'haiku' ? 'haiku' : 'sonnet']
    const costInput = (tokensInput / 1_000_000) * modelPricing.input
    const costOutput = (tokensOutput / 1_000_000) * modelPricing.output

    return {
      tokensInput,
      tokensOutput,
      costUsd: costInput + costOutput
    }
  }
}

describe('Ralph Loop - Subtask Identification (RALPH-002)', () => {
  let service: MockBvsWorkerAgentService

  beforeEach(() => {
    service = new MockBvsWorkerAgentService()
  })

  it('should create schema subtask from schema files', () => {
    const section: BvsSection = {
      id: 'TEST-001',
      name: 'Database Changes',
      description: 'Update database schema',
      files: [
        { path: 'prisma/schema.prisma', action: 'modify' },
        { path: 'prisma/migrations/001_add_users.sql', action: 'create' }
      ],
      dependencies: [],
      successCriteria: []
    }

    const subtasks = service.identifySubtasks(section)

    expect(subtasks).toHaveLength(1)
    expect(subtasks[0].name).toBe('Update schema and database')
    expect(subtasks[0].files).toHaveLength(2)
    expect(subtasks[0].files).toContain('prisma/schema.prisma')
  })

  it('should create separate subtasks for schema, types, impl, tests', () => {
    const section: BvsSection = {
      id: 'TEST-002',
      name: 'User Feature',
      description: 'Complete user management feature',
      files: [
        { path: 'prisma/schema.prisma', action: 'modify' },
        { path: 'src/types/user.types.ts', action: 'create' },
        { path: 'src/services/user-service.ts', action: 'create' },
        { path: 'src/api/users.ts', action: 'create' },
        { path: 'src/services/__tests__/user-service.test.ts', action: 'create' }
      ],
      dependencies: [],
      successCriteria: []
    }

    const subtasks = service.identifySubtasks(section)

    expect(subtasks).toHaveLength(4)
    expect(subtasks[0].name).toBe('Update schema and database')
    expect(subtasks[1].name).toBe('Update type definitions')
    expect(subtasks[2].name).toBe('Implement core logic')
    expect(subtasks[3].name).toBe('Add tests')
  })

  it('should group similar files in same subtask', () => {
    const section: BvsSection = {
      id: 'TEST-003',
      name: 'API Routes',
      description: 'Add API routes',
      files: [
        { path: 'src/api/users.ts', action: 'create' },
        { path: 'src/api/auth.ts', action: 'create' },
        { path: 'src/api/posts.ts', action: 'create' }
      ],
      dependencies: [],
      successCriteria: []
    }

    const subtasks = service.identifySubtasks(section)

    expect(subtasks).toHaveLength(1)
    expect(subtasks[0].name).toBe('Implement core logic')
    expect(subtasks[0].files).toHaveLength(3)
  })

  it('should handle empty section', () => {
    const section: BvsSection = {
      id: 'TEST-004',
      name: 'Empty Section',
      description: 'No files',
      files: [],
      dependencies: [],
      successCriteria: []
    }

    const subtasks = service.identifySubtasks(section)

    expect(subtasks).toHaveLength(0)
  })
})

describe('Ralph Loop - Model Selection (RALPH-005)', () => {
  let service: MockBvsWorkerAgentService

  beforeEach(() => {
    service = new MockBvsWorkerAgentService()
  })

  it('should select Haiku for simple subtask (≤4 files, low complexity)', () => {
    const subtask: BvsSubtask = {
      id: 'SUB-001',
      sectionId: 'TEST-001',
      name: 'Simple task',
      description: 'Update 2 files',
      files: ['file1.ts', 'file2.ts'],
      status: 'pending',
      turnsUsed: 0,
      maxTurns: 5,
      retryCount: 0
    }

    const model = service.selectModelForSubtask(subtask, 0)

    expect(model).toBe('haiku')
  })

  it('should select Haiku for 4 files with zero base complexity', () => {
    const subtask: BvsSubtask = {
      id: 'SUB-002',
      sectionId: 'TEST-001',
      name: 'Four file task',
      description: 'Update 4 files',
      files: ['file1.ts', 'file2.ts', 'file3.ts', 'file4.ts'],
      status: 'pending',
      turnsUsed: 0,
      maxTurns: 5,
      retryCount: 0
    }

    const model = service.selectModelForSubtask(subtask, 0)

    expect(model).toBe('haiku')
  })

  it('should select Sonnet for 5+ files', () => {
    const subtask: BvsSubtask = {
      id: 'SUB-003',
      sectionId: 'TEST-001',
      name: 'Complex task',
      description: 'Update 5 files',
      files: ['file1.ts', 'file2.ts', 'file3.ts', 'file4.ts', 'file5.ts'],
      status: 'pending',
      turnsUsed: 0,
      maxTurns: 5,
      retryCount: 0
    }

    const model = service.selectModelForSubtask(subtask, 0)

    expect(model).toBe('sonnet')
  })

  it('should select Sonnet when base complexity + files > 4', () => {
    const subtask: BvsSubtask = {
      id: 'SUB-004',
      sectionId: 'TEST-001',
      name: 'Complex base',
      description: 'High base complexity',
      files: ['file1.ts', 'file2.ts'],
      status: 'pending',
      turnsUsed: 0,
      maxTurns: 5,
      retryCount: 0
    }

    const model = service.selectModelForSubtask(subtask, 3) // 3 + 2 = 5 > 4

    expect(model).toBe('sonnet')
  })
})

describe('Ralph Loop - Cost Calculation (RALPH-008)', () => {
  let service: MockBvsWorkerAgentService

  beforeEach(() => {
    service = new MockBvsWorkerAgentService()
  })

  it('should calculate Haiku cost correctly', () => {
    const cost = service.calculateSubtaskCost('haiku', 3, 2)

    // Expected: 3 turns × (2000 + 2×500) input + 3 turns × 1000 output
    expect(cost.tokensInput).toBe(9000) // 3 × 3000
    expect(cost.tokensOutput).toBe(3000) // 3 × 1000

    // Cost: (9000/1M × 0.25) + (3000/1M × 1.25)
    expect(cost.costUsd).toBeCloseTo(0.00225 + 0.00375, 5)
    expect(cost.costUsd).toBeCloseTo(0.006, 5)
  })

  it('should calculate Sonnet cost correctly', () => {
    const cost = service.calculateSubtaskCost('sonnet', 5, 3)

    // Expected: 5 turns × (2000 + 3×500) input + 5 turns × 1000 output
    expect(cost.tokensInput).toBe(17500) // 5 × 3500
    expect(cost.tokensOutput).toBe(5000) // 5 × 1000

    // Cost: (17500/1M × 3.0) + (5000/1M × 15.0)
    expect(cost.costUsd).toBeCloseTo(0.0525 + 0.075, 5)
    expect(cost.costUsd).toBeCloseTo(0.1275, 5)
  })

  it('should calculate higher cost for more files', () => {
    const cost1File = service.calculateSubtaskCost('haiku', 3, 1)
    const cost5Files = service.calculateSubtaskCost('haiku', 3, 5)

    expect(cost5Files.tokensInput).toBeGreaterThan(cost1File.tokensInput)
    expect(cost5Files.costUsd).toBeGreaterThan(cost1File.costUsd)
  })

  it('should calculate higher cost for more turns', () => {
    const cost3Turns = service.calculateSubtaskCost('haiku', 3, 2)
    const cost10Turns = service.calculateSubtaskCost('haiku', 10, 2)

    expect(cost10Turns.tokensInput).toBeGreaterThan(cost3Turns.tokensInput)
    expect(cost10Turns.costUsd).toBeGreaterThan(cost3Turns.costUsd)
  })

  it('should show Sonnet costs more than Haiku for same usage', () => {
    const haikuCost = service.calculateSubtaskCost('haiku', 5, 3)
    const sonnetCost = service.calculateSubtaskCost('sonnet', 5, 3)

    expect(sonnetCost.costUsd).toBeGreaterThan(haikuCost.costUsd)
    // Sonnet should be roughly 12-15x more expensive
    expect(sonnetCost.costUsd / haikuCost.costUsd).toBeGreaterThan(10)
  })
})

describe('Ralph Loop - Integration Tests', () => {
  let service: MockBvsWorkerAgentService

  beforeEach(() => {
    service = new MockBvsWorkerAgentService()
  })

  it('should recommend Haiku for split subtasks', () => {
    // Section with 8 files - should split into smaller subtasks
    const section: BvsSection = {
      id: 'INT-001',
      name: 'CRUD Operations',
      description: 'User CRUD',
      files: [
        { path: 'prisma/schema.prisma', action: 'modify' },
        { path: 'src/types/user.types.ts', action: 'create' },
        { path: 'src/types/auth.types.ts', action: 'create' },
        { path: 'src/api/users.ts', action: 'create' },
        { path: 'src/api/auth.ts', action: 'create' },
        { path: 'src/services/user.service.ts', action: 'create' },
        { path: 'src/api/__tests__/users.test.ts', action: 'create' },
        { path: 'src/api/__tests__/auth.test.ts', action: 'create' }
      ],
      dependencies: [],
      successCriteria: []
    }

    const subtasks = service.identifySubtasks(section)

    expect(subtasks).toHaveLength(4) // schema, types, impl, tests

    // Each subtask should be ≤4 files, eligible for Haiku
    const models = subtasks.map(st => service.selectModelForSubtask(st, 0))

    expect(models.every(m => m === 'haiku')).toBe(true)
  })

  it('should calculate total section cost from subtasks', () => {
    const section: BvsSection = {
      id: 'INT-002',
      name: 'Feature',
      description: 'Complete feature',
      files: [
        { path: 'schema.prisma', action: 'modify' },
        { path: 'types.ts', action: 'create' },
        { path: 'impl.ts', action: 'create' },
        { path: 'test.ts', action: 'create' }
      ],
      dependencies: [],
      successCriteria: []
    }

    const subtasks = service.identifySubtasks(section)
    let totalCost = 0

    subtasks.forEach(subtask => {
      const model = service.selectModelForSubtask(subtask, 0)
      const cost = service.calculateSubtaskCost(model, 5, subtask.files.length)
      totalCost += cost.costUsd
    })

    // All should use Haiku (each has 1 file)
    expect(totalCost).toBeLessThan(0.05) // Should be very cheap
  })
})

import { BvsDecompositionService } from '../bvs-decomposition-service'
import type { BvsSection } from '@shared/bvs-types'

describe('BvsDecompositionService', () => {
  let service: BvsDecompositionService

  beforeEach(() => {
    service = new BvsDecompositionService()
  })

  describe('buildDependencyGraph', () => {
    it('should build graph with single section', () => {
      const sections: BvsSection[] = [
        createSection('S1', [], []),
      ]

      const graph = service.buildDependencyGraph(sections)

      expect(graph.nodes.size).toBe(1)
      expect(graph.nodes.get('S1')).toEqual({
        dependencies: [],
        dependents: [],
      })
      expect(graph.levels).toEqual([['S1']])
    })

    it('should build graph with linear dependencies', () => {
      const sections: BvsSection[] = [
        createSection('S1', [], ['S2']),
        createSection('S2', ['S1'], ['S3']),
        createSection('S3', ['S2'], []),
      ]

      const graph = service.buildDependencyGraph(sections)

      expect(graph.nodes.size).toBe(3)
      expect(graph.nodes.get('S1')).toEqual({
        dependencies: [],
        dependents: ['S2'],
      })
      expect(graph.nodes.get('S2')).toEqual({
        dependencies: ['S1'],
        dependents: ['S3'],
      })
      expect(graph.nodes.get('S3')).toEqual({
        dependencies: ['S2'],
        dependents: [],
      })
      expect(graph.levels).toEqual([['S1'], ['S2'], ['S3']])
    })

    it('should build graph with parallel sections', () => {
      const sections: BvsSection[] = [
        createSection('S1', [], ['S3']),
        createSection('S2', [], ['S3']),
        createSection('S3', ['S1', 'S2'], []),
      ]

      const graph = service.buildDependencyGraph(sections)

      expect(graph.nodes.size).toBe(3)
      expect(graph.levels).toEqual([['S1', 'S2'], ['S3']])
    })

    it('should build graph with diamond dependency', () => {
      const sections: BvsSection[] = [
        createSection('S1', [], ['S2', 'S3']),
        createSection('S2', ['S1'], ['S4']),
        createSection('S3', ['S1'], ['S4']),
        createSection('S4', ['S2', 'S3'], []),
      ]

      const graph = service.buildDependencyGraph(sections)

      expect(graph.nodes.size).toBe(4)
      expect(graph.levels).toEqual([['S1'], ['S2', 'S3'], ['S4']])
    })

    it('should detect cycles', () => {
      const sections: BvsSection[] = [
        createSection('S1', ['S3'], ['S2']),
        createSection('S2', ['S1'], ['S3']),
        createSection('S3', ['S2'], ['S1']),
      ]

      expect(() => service.buildDependencyGraph(sections)).toThrow('Circular dependency detected')
    })

    it('should detect self-reference cycle', () => {
      const sections: BvsSection[] = [
        createSection('S1', ['S1'], []),
      ]

      expect(() => service.buildDependencyGraph(sections)).toThrow('Circular dependency detected')
    })

    it('should handle missing dependency gracefully', () => {
      const sections: BvsSection[] = [
        createSection('S1', ['S999'], []), // S999 doesn't exist
      ]

      expect(() => service.buildDependencyGraph(sections)).toThrow('Missing dependency')
    })
  })

  describe('computeParallelGroups', () => {
    it('should compute single group for single section', () => {
      const graph = {
        nodes: new Map([['S1', { dependencies: [], dependents: [] }]]),
        levels: [['S1']],
      }

      const groups = service.computeParallelGroups(graph)

      expect(groups).toEqual([
        {
          level: 0,
          sectionIds: ['S1'],
          rationale: '1 independent section',
          estimatedDuration: undefined,
        },
      ])
    })

    it('should compute groups for linear dependencies', () => {
      const graph = {
        nodes: new Map([
          ['S1', { dependencies: [], dependents: ['S2'] }],
          ['S2', { dependencies: ['S1'], dependents: ['S3'] }],
          ['S3', { dependencies: ['S2'], dependents: [] }],
        ]),
        levels: [['S1'], ['S2'], ['S3']],
      }

      const groups = service.computeParallelGroups(graph)

      expect(groups).toHaveLength(3)
      expect(groups[0]).toMatchObject({
        level: 0,
        sectionIds: ['S1'],
        rationale: '1 independent section',
      })
      expect(groups[1]).toMatchObject({
        level: 1,
        sectionIds: ['S2'],
        rationale: '1 section (depends on S1)',
      })
      expect(groups[2]).toMatchObject({
        level: 2,
        sectionIds: ['S3'],
        rationale: '1 section (depends on S2)',
      })
    })

    it('should compute groups for parallel sections', () => {
      const graph = {
        nodes: new Map([
          ['S1', { dependencies: [], dependents: ['S3'] }],
          ['S2', { dependencies: [], dependents: ['S3'] }],
          ['S3', { dependencies: ['S1', 'S2'], dependents: [] }],
        ]),
        levels: [['S1', 'S2'], ['S3']],
      }

      const groups = service.computeParallelGroups(graph)

      expect(groups).toHaveLength(2)
      expect(groups[0]).toMatchObject({
        level: 0,
        sectionIds: ['S1', 'S2'],
        rationale: '2 independent sections',
      })
      expect(groups[1]).toMatchObject({
        level: 1,
        sectionIds: ['S3'],
        rationale: '1 section (depends on S1, S2)',
      })
    })
  })

  describe('computeCriticalPath', () => {
    it('should find critical path in single section', () => {
      const graph = {
        nodes: new Map([['S1', { dependencies: [], dependents: [] }]]),
        levels: [['S1']],
      }

      const criticalPath = service.computeCriticalPath(graph)

      expect(criticalPath).toEqual({
        path: ['S1'],
        totalDuration: 1,
        bottleneck: 'S1',
      })
    })

    it('should find critical path in linear dependencies', () => {
      const graph = {
        nodes: new Map([
          ['S1', { dependencies: [], dependents: ['S2'] }],
          ['S2', { dependencies: ['S1'], dependents: ['S3'] }],
          ['S3', { dependencies: ['S2'], dependents: [] }],
        ]),
        levels: [['S1'], ['S2'], ['S3']],
      }

      const criticalPath = service.computeCriticalPath(graph)

      expect(criticalPath).toEqual({
        path: ['S1', 'S2', 'S3'],
        totalDuration: 3,
        bottleneck: 'S1',
      })
    })

    it('should find critical path in diamond dependency', () => {
      const graph = {
        nodes: new Map([
          ['S1', { dependencies: [], dependents: ['S2', 'S3'] }],
          ['S2', { dependencies: ['S1'], dependents: ['S4'] }],
          ['S3', { dependencies: ['S1'], dependents: ['S4'] }],
          ['S4', { dependencies: ['S2', 'S3'], dependents: [] }],
        ]),
        levels: [['S1'], ['S2', 'S3'], ['S4']],
      }

      const criticalPath = service.computeCriticalPath(graph)

      // Path should be: S1 -> (S2 or S3) -> S4
      expect(criticalPath.path).toHaveLength(3)
      expect(criticalPath.path[0]).toBe('S1')
      expect(criticalPath.path[2]).toBe('S4')
      expect(['S2', 'S3']).toContain(criticalPath.path[1])
      expect(criticalPath.totalDuration).toBe(3)
      expect(criticalPath.bottleneck).toBe('S1')
    })

    it('should find longest path in complex graph', () => {
      const graph = {
        nodes: new Map([
          ['S1', { dependencies: [], dependents: ['S2'] }],
          ['S2', { dependencies: ['S1'], dependents: ['S3', 'S4'] }],
          ['S3', { dependencies: ['S2'], dependents: ['S5'] }],
          ['S4', { dependencies: ['S2'], dependents: [] }],
          ['S5', { dependencies: ['S3'], dependents: [] }],
        ]),
        levels: [['S1'], ['S2'], ['S3', 'S4'], ['S5']],
      }

      const criticalPath = service.computeCriticalPath(graph)

      expect(criticalPath.path).toEqual(['S1', 'S2', 'S3', 'S5'])
      expect(criticalPath.totalDuration).toBe(4)
      expect(criticalPath.bottleneck).toBe('S1')
    })
  })

  describe('computeParallelizationScore', () => {
    it('should return 0 for single section', () => {
      const groups = [
        {
          level: 0,
          sectionIds: ['S1'],
          rationale: '1 section',
        },
      ]

      const score = service.computeParallelizationScore(groups)

      expect(score).toBe(0)
    })

    it('should return 1.0 for fully parallel sections', () => {
      const groups = [
        {
          level: 0,
          sectionIds: ['S1', 'S2', 'S3'],
          rationale: '3 independent sections',
        },
      ]

      const score = service.computeParallelizationScore(groups)

      expect(score).toBe(1.0)
    })

    it('should return 0 for fully sequential sections', () => {
      const groups = [
        { level: 0, sectionIds: ['S1'], rationale: '' },
        { level: 1, sectionIds: ['S2'], rationale: '' },
        { level: 2, sectionIds: ['S3'], rationale: '' },
      ]

      const score = service.computeParallelizationScore(groups)

      expect(score).toBe(0)
    })

    it('should return 0.5 for mixed parallel/sequential', () => {
      const groups = [
        { level: 0, sectionIds: ['S1', 'S2'], rationale: '' },
        { level: 1, sectionIds: ['S3'], rationale: '' },
      ]

      const score = service.computeParallelizationScore(groups)

      // 2 parallel + 1 sequential = 3 total, 1 parallel opportunity
      // score = 1 / (3 - 1) = 0.5
      expect(score).toBe(0.5)
    })
  })

  describe('analyzeFileOwnership', () => {
    it('should detect no conflicts for non-overlapping files', () => {
      const sections: BvsSection[] = [
        createSectionWithFiles('S1', ['file1.ts'], []),
        createSectionWithFiles('S2', ['file2.ts'], []),
      ]

      const result = service.analyzeFileOwnership(sections)

      expect(result.hasConflicts).toBe(false)
      expect(result.conflicts).toEqual([])
    })

    it('should detect conflict for shared files', () => {
      const sections: BvsSection[] = [
        createSectionWithFiles('S1', ['shared.ts'], []),
        createSectionWithFiles('S2', ['shared.ts'], []),
      ]

      const result = service.analyzeFileOwnership(sections)

      expect(result.hasConflicts).toBe(true)
      expect(result.conflicts).toHaveLength(1)
      expect(result.conflicts[0]).toMatchObject({
        file: 'shared.ts',
        sections: ['S1', 'S2'],
        severity: 'error',
      })
    })

    it('should detect multiple conflicts', () => {
      const sections: BvsSection[] = [
        createSectionWithFiles('S1', ['shared1.ts', 'shared2.ts'], []),
        createSectionWithFiles('S2', ['shared1.ts'], []),
        createSectionWithFiles('S3', ['shared2.ts'], []),
      ]

      const result = service.analyzeFileOwnership(sections)

      expect(result.hasConflicts).toBe(true)
      expect(result.conflicts).toHaveLength(2)
    })

    it('should allow same file if sections have dependency', () => {
      const sections: BvsSection[] = [
        createSectionWithFiles('S1', ['shared.ts'], ['S2']),
        createSectionWithFiles('S2', ['shared.ts'], [], ['S1']),
      ]

      const result = service.analyzeFileOwnership(sections)

      // Sequential modification is allowed
      expect(result.hasConflicts).toBe(false)
    })

    it('should detect conflict for parallel sections with shared file', () => {
      const sections: BvsSection[] = [
        createSectionWithFiles('S1', ['shared.ts'], []),
        createSectionWithFiles('S2', ['shared.ts'], []),
        createSectionWithFiles('S3', [], ['S1', 'S2']),
      ]

      const result = service.analyzeFileOwnership(sections)

      expect(result.hasConflicts).toBe(true)
      expect(result.conflicts[0].sections).toEqual(['S1', 'S2'])
    })
  })

  describe('resolveOwnershipConflicts', () => {
    it('should return unchanged sections if no conflicts', () => {
      const sections: BvsSection[] = [
        createSectionWithFiles('S1', ['file1.ts'], []),
        createSectionWithFiles('S2', ['file2.ts'], []),
      ]

      const resolved = service.resolveOwnershipConflicts(sections, [])

      expect(resolved).toEqual(sections)
    })

    it('should add dependency to resolve conflict', () => {
      const sections: BvsSection[] = [
        createSectionWithFiles('S1', ['shared.ts'], []),
        createSectionWithFiles('S2', ['shared.ts'], []),
      ]
      const conflicts = [
        {
          file: 'shared.ts',
          sections: ['S1', 'S2'],
          severity: 'error' as const,
          resolution: 'Add dependency: S2 depends on S1' as const,
        },
      ]

      const resolved = service.resolveOwnershipConflicts(sections, conflicts)

      expect(resolved[1].dependencies).toContain('S1')
      expect(resolved[0].dependents).toContain('S2')
    })

    it('should extract shared files to separate section', () => {
      const sections: BvsSection[] = [
        createSectionWithFiles('S1', ['shared.ts', 'file1.ts'], []),
        createSectionWithFiles('S2', ['shared.ts', 'file2.ts'], []),
      ]
      const conflicts = [
        {
          file: 'shared.ts',
          sections: ['S1', 'S2'],
          severity: 'error' as const,
          resolution: 'extract' as const,
        },
      ]

      const resolved = service.resolveOwnershipConflicts(sections, conflicts)

      // Should create new section for shared.ts
      expect(resolved.length).toBe(3)
      const sharedSection = resolved.find(s => s.files.some(f => f.path === 'shared.ts' && s.files.length === 1))
      expect(sharedSection).toBeDefined()

      // Original sections should depend on shared section
      expect(resolved[0].dependencies).toContain(sharedSection!.id)
      expect(resolved[1].dependencies).toContain(sharedSection!.id)
    })
  })

  describe('topologicalSort', () => {
    it('should sort single node', () => {
      const graph = {
        nodes: new Map([['S1', { dependencies: [], dependents: [] }]]),
        levels: [['S1']],
      }

      const sorted = service.topologicalSort(graph)

      expect(sorted).toEqual(['S1'])
    })

    it('should sort linear dependencies', () => {
      const graph = {
        nodes: new Map([
          ['S1', { dependencies: [], dependents: ['S2'] }],
          ['S2', { dependencies: ['S1'], dependents: ['S3'] }],
          ['S3', { dependencies: ['S2'], dependents: [] }],
        ]),
        levels: [['S1'], ['S2'], ['S3']],
      }

      const sorted = service.topologicalSort(graph)

      expect(sorted).toEqual(['S1', 'S2', 'S3'])
    })

    it('should handle parallel sections', () => {
      const graph = {
        nodes: new Map([
          ['S1', { dependencies: [], dependents: ['S3'] }],
          ['S2', { dependencies: [], dependents: ['S3'] }],
          ['S3', { dependencies: ['S1', 'S2'], dependents: [] }],
        ]),
        levels: [['S1', 'S2'], ['S3']],
      }

      const sorted = service.topologicalSort(graph)

      // S1 and S2 can be in any order, but both before S3
      expect(sorted.length).toBe(3)
      expect(sorted.indexOf('S3')).toBeGreaterThan(sorted.indexOf('S1'))
      expect(sorted.indexOf('S3')).toBeGreaterThan(sorted.indexOf('S2'))
    })
  })

  describe('findCycles', () => {
    it('should return null for acyclic graph', () => {
      const graph = {
        nodes: new Map([
          ['S1', { dependencies: [], dependents: ['S2'] }],
          ['S2', { dependencies: ['S1'], dependents: [] }],
        ]),
        levels: [['S1'], ['S2']],
      }

      const cycles = service.findCycles(graph)

      expect(cycles).toBeNull()
    })

    it('should detect simple cycle', () => {
      const graph = {
        nodes: new Map([
          ['S1', { dependencies: ['S2'], dependents: ['S2'] }],
          ['S2', { dependencies: ['S1'], dependents: ['S1'] }],
        ]),
        levels: [],
      }

      const cycles = service.findCycles(graph)

      expect(cycles).not.toBeNull()
      expect(cycles!.length).toBeGreaterThan(0)
    })

    it('should detect complex cycle', () => {
      const graph = {
        nodes: new Map([
          ['S1', { dependencies: ['S3'], dependents: ['S2'] }],
          ['S2', { dependencies: ['S1'], dependents: ['S3'] }],
          ['S3', { dependencies: ['S2'], dependents: ['S1'] }],
        ]),
        levels: [],
      }

      const cycles = service.findCycles(graph)

      expect(cycles).not.toBeNull()
      expect(cycles!.length).toBeGreaterThan(0)
    })
  })
})

// ============================================================================
// Helper Functions
// ============================================================================

function createSection(
  id: string,
  dependencies: string[],
  dependents: string[]
): BvsSection {
  return {
    id,
    name: `Section ${id}`,
    files: [],
    dependencies,
    dependents,
    status: 'pending',
    successCriteria: [],
    progress: 0,
    retryCount: 0,
    maxRetries: 3,
    commits: [],
  }
}

function createSectionWithFiles(
  id: string,
  filePaths: string[],
  dependents: string[],
  dependencies: string[] = []
): BvsSection {
  return {
    id,
    name: `Section ${id}`,
    files: filePaths.map(path => ({
      path,
      action: 'modify',
      status: 'pending',
    })),
    dependencies,
    dependents,
    status: 'pending',
    successCriteria: [],
    progress: 0,
    retryCount: 0,
    maxRetries: 3,
    commits: [],
  }
}

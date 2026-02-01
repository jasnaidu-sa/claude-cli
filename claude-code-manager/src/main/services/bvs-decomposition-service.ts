import type { BvsSection } from '@shared/bvs-types'

// ============================================================================
// Types
// ============================================================================

export interface DecomposedPlan {
  requirement: string
  sections: BvsSectionV2[]
  parallelGroups: ParallelGroup[]
  sharedFiles: string[]
  criticalPath: CriticalPath
  metadata: DecompositionMetadata
}

export interface BvsSectionV2 extends Omit<BvsSection, 'status' | 'progress'> {
  estimatedDuration?: number
  complexity?: 'low' | 'medium' | 'high'
}

export interface ParallelGroup {
  level: number
  sectionIds: string[]
  rationale: string
  estimatedDuration?: number
}

export interface CriticalPath {
  path: string[]
  totalDuration: number
  bottleneck: string
}

export interface DecompositionMetadata {
  model: 'opus' | 'sonnet'
  decompositionTimeMs: number
  conflictResolutionIterations: number
  parallelizationScore: number
}

export interface DependencyGraph {
  nodes: Map<string, { dependencies: string[]; dependents: string[] }>
  levels: string[][]
}

export interface CodebaseContext {
  framework: string | null
  language: string
  hasTypeScript: boolean
  patterns: string[]
}

export interface FileConflict {
  file: string
  sections: string[]
  severity: 'error' | 'warning'
  resolution: 'dependency' | 'extract' | 'manual' | string
}

// ============================================================================
// DECOMPOSITION_PROMPT
// ============================================================================

export const DECOMPOSITION_PROMPT = `You are a software architect AI tasked with decomposing a development requirement into bounded, verifiable sections.

## Objective
Break down the requirement into 3-8 atomic sections that:
1. Have clear file ownership (minimal file overlap)
2. Can be verified independently (tests, type checks, builds)
3. Have explicit dependencies between them
4. Enable maximum parallelization where possible

## Output Format
Return a JSON object with:
\`\`\`json
{
  "sections": [
    {
      "id": "SECT-001",
      "name": "Short descriptive name",
      "description": "What this section accomplishes",
      "files": [
        { "path": "src/...", "action": "create" | "modify" | "delete" }
      ],
      "dependencies": ["SECT-002"], // IDs of sections that must complete first
      "successCriteria": [
        { "id": "crit-1", "description": "Type checks pass", "passed": false }
      ],
      "estimatedDuration": 30, // minutes
      "complexity": "low" | "medium" | "high"
    }
  ],
  "rationale": "Why this decomposition enables parallelization and clear verification"
}
\`\`\`

## Rules
1. **File Ownership**: Minimize file overlap. If two sections modify the same file, they MUST have a dependency relationship (sequential).
2. **Atomic Units**: Each section should be completable in 15-60 minutes.
3. **Verification**: Each section must have clear success criteria (tests, builds, type checks).
4. **Dependencies**: Use dependencies to enforce execution order where needed (e.g., schema before API, API before UI).
5. **Parallelization**: Sections with no dependencies can run in parallel (maximize this).

## Codebase Context
{{CODEBASE_CONTEXT}}

## Requirement
{{REQUIREMENT}}

Analyze the requirement and return the decomposed plan.`

// ============================================================================
// BvsDecompositionService
// ============================================================================

export class BvsDecompositionService {
  /**
   * Decompose a requirement into bounded sections using AI
   */
  async decomposeTask(
    requirement: string,
    context: CodebaseContext
  ): Promise<DecomposedPlan> {
    const startTime = Date.now()

    // TODO: Call Claude API with DECOMPOSITION_PROMPT
    // For now, throw to indicate this needs implementation
    throw new Error('AI decomposition not yet implemented. Use manual section definition.')

    // Mock structure for type checking:
    // const sections: BvsSectionV2[] = aiResponse.sections
    // const graph = this.buildDependencyGraph(sections)
    // const conflicts = this.analyzeFileOwnership(sections)
    //
    // let resolvedSections = sections
    // let iterations = 0
    // if (conflicts.hasConflicts) {
    //   resolvedSections = this.resolveOwnershipConflicts(sections, conflicts.conflicts)
    //   iterations++
    // }
    //
    // const finalGraph = this.buildDependencyGraph(resolvedSections)
    // const parallelGroups = this.computeParallelGroups(finalGraph)
    // const criticalPath = this.computeCriticalPath(finalGraph)
    // const sharedFiles = this.extractSharedFiles(resolvedSections)
    //
    // return {
    //   requirement,
    //   sections: resolvedSections,
    //   parallelGroups,
    //   sharedFiles,
    //   criticalPath,
    //   metadata: {
    //     model: 'opus',
    //     decompositionTimeMs: Date.now() - startTime,
    //     conflictResolutionIterations: iterations,
    //     parallelizationScore: this.computeParallelizationScore(parallelGroups)
    //   }
    // }
  }

  /**
   * Analyze file ownership across sections
   */
  analyzeFileOwnership(sections: BvsSection[]): {
    hasConflicts: boolean
    conflicts: FileConflict[]
  } {
    const fileToSections = new Map<string, string[]>()

    // Build file ownership map
    for (const section of sections) {
      for (const file of section.files) {
        if (!fileToSections.has(file.path)) {
          fileToSections.set(file.path, [])
        }
        fileToSections.get(file.path)!.push(section.id)
      }
    }

    // Find conflicts (files modified by multiple sections)
    const conflicts: FileConflict[] = []

    for (const [file, sectionIds] of fileToSections.entries()) {
      if (sectionIds.length > 1) {
        // Check if sections have dependency relationship
        const hasSequentialRelation = this.haveSequentialRelationship(
          sectionIds,
          sections
        )

        if (!hasSequentialRelation) {
          // Parallel modification conflict
          conflicts.push({
            file,
            sections: sectionIds,
            severity: 'error',
            resolution: `Add dependency: ${sectionIds.slice(1).join(', ')} depends on ${sectionIds[0]}`,
          })
        }
      }
    }

    return {
      hasConflicts: conflicts.length > 0,
      conflicts,
    }
  }

  /**
   * Check if sections have a sequential dependency relationship
   */
  private haveSequentialRelationship(
    sectionIds: string[],
    sections: BvsSection[]
  ): boolean {
    // Build dependency map
    const graph = this.buildDependencyGraph(sections)

    // Check if there's a path from first section to all others
    const firstId = sectionIds[0]
    const remainingIds = sectionIds.slice(1)

    for (const otherId of remainingIds) {
      if (!this.hasPath(graph, firstId, otherId) && !this.hasPath(graph, otherId, firstId)) {
        return false
      }
    }

    return true
  }

  /**
   * Check if there's a path from start to end in the graph
   */
  private hasPath(graph: DependencyGraph, start: string, end: string): boolean {
    const visited = new Set<string>()
    const queue = [start]

    while (queue.length > 0) {
      const current = queue.shift()!
      if (current === end) return true
      if (visited.has(current)) continue

      visited.add(current)
      const node = graph.nodes.get(current)
      if (node) {
        queue.push(...node.dependents)
      }
    }

    return false
  }

  /**
   * Resolve file ownership conflicts
   */
  resolveOwnershipConflicts(
    sections: BvsSection[],
    conflicts: FileConflict[]
  ): BvsSection[] {
    if (conflicts.length === 0) {
      return sections
    }

    const resolved = [...sections]

    for (const conflict of conflicts) {
      if (conflict.resolution === 'extract') {
        // Extract shared file to separate section
        this.extractSharedFileToSection(resolved, conflict)
      } else if (conflict.resolution.startsWith('Add dependency:')) {
        // Add dependency between sections
        this.addDependencyBetweenSections(resolved, conflict)
      }
    }

    return resolved
  }

  /**
   * Extract shared file to a separate section
   */
  private extractSharedFileToSection(
    sections: BvsSection[],
    conflict: FileConflict
  ): void {
    // Create new section for shared file
    const sharedSectionId = `SHARED-${conflict.file.replace(/[^a-zA-Z0-9]/g, '-')}`
    const sharedSection: BvsSection = {
      id: sharedSectionId,
      name: `Shared: ${conflict.file}`,
      files: [
        {
          path: conflict.file,
          action: 'modify',
          status: 'pending',
        },
      ],
      dependencies: [],
      dependents: conflict.sections,
      status: 'pending',
      successCriteria: [],
      progress: 0,
      retryCount: 0,
      maxRetries: 3,
      commits: [],
    }

    // Add shared section to list
    sections.push(sharedSection)

    // Update conflicting sections to depend on shared section
    for (const sectionId of conflict.sections) {
      const section = sections.find(s => s.id === sectionId)
      if (section) {
        // Remove shared file from section
        section.files = section.files.filter(f => f.path !== conflict.file)
        // Add dependency
        if (!section.dependencies.includes(sharedSectionId)) {
          section.dependencies.push(sharedSectionId)
        }
      }
    }
  }

  /**
   * Add dependency between sections to resolve conflict
   */
  private addDependencyBetweenSections(
    sections: BvsSection[],
    conflict: FileConflict
  ): void {
    // Parse resolution string: "Add dependency: S2 depends on S1"
    // For simplicity, make all sections depend on the first one
    const [firstId, ...restIds] = conflict.sections

    for (const sectionId of restIds) {
      const section = sections.find(s => s.id === sectionId)
      const firstSection = sections.find(s => s.id === firstId)

      if (section && firstSection) {
        if (!section.dependencies.includes(firstId)) {
          section.dependencies.push(firstId)
        }
        if (!firstSection.dependents.includes(sectionId)) {
          firstSection.dependents.push(sectionId)
        }
      }
    }
  }

  /**
   * Build dependency graph from sections
   */
  buildDependencyGraph(sections: BvsSection[]): DependencyGraph {
    const nodes = new Map<string, { dependencies: string[]; dependents: string[] }>()

    // Initialize nodes
    for (const section of sections) {
      nodes.set(section.id, {
        dependencies: [...section.dependencies],
        dependents: [...section.dependents],
      })
    }

    // Validate dependencies exist
    for (const section of sections) {
      for (const depId of section.dependencies) {
        if (!nodes.has(depId)) {
          throw new Error(`Missing dependency: ${section.id} depends on ${depId} which doesn't exist`)
        }
      }
    }

    // Detect cycles
    const cycles = this.findCycles({ nodes, levels: [] })
    if (cycles) {
      throw new Error(`Circular dependency detected: ${cycles.map(c => c.join(' -> ')).join(', ')}`)
    }

    // Compute levels (topological ordering)
    const levels = this.computeLevels(nodes)

    return { nodes, levels }
  }

  /**
   * Compute dependency levels for parallel execution
   */
  private computeLevels(
    nodes: Map<string, { dependencies: string[]; dependents: string[] }>
  ): string[][] {
    const levels: string[][] = []
    const processed = new Set<string>()
    const inDegree = new Map<string, number>()

    // Initialize in-degree
    for (const [id, node] of nodes) {
      inDegree.set(id, node.dependencies.length)
    }

    // Process levels
    while (processed.size < nodes.size) {
      const currentLevel: string[] = []

      // Find all nodes with in-degree 0
      for (const [id, degree] of inDegree) {
        if (degree === 0 && !processed.has(id)) {
          currentLevel.push(id)
        }
      }

      if (currentLevel.length === 0) {
        throw new Error('Circular dependency detected in level computation')
      }

      levels.push(currentLevel)

      // Mark as processed and reduce in-degree of dependents
      for (const id of currentLevel) {
        processed.add(id)
        const node = nodes.get(id)!

        for (const dependentId of node.dependents) {
          const currentDegree = inDegree.get(dependentId)!
          inDegree.set(dependentId, currentDegree - 1)
        }
      }
    }

    return levels
  }

  /**
   * Compute parallel execution groups
   */
  computeParallelGroups(graph: DependencyGraph): ParallelGroup[] {
    return graph.levels.map((sectionIds, level) => {
      let rationale: string
      if (level === 0) {
        rationale = `${sectionIds.length} independent section${sectionIds.length > 1 ? 's' : ''}`
      } else {
        const depIds = this.getDependenciesForLevel(graph, sectionIds)
        const depStr = depIds.slice(0, 3).join(', ') + (depIds.length > 3 ? ', ...' : '')
        rationale = `${sectionIds.length} section${sectionIds.length > 1 ? 's' : ''} (depends on ${depStr})`
      }

      return {
        level,
        sectionIds,
        rationale,
        estimatedDuration: undefined,
      }
    })
  }

  /**
   * Get all dependencies for sections in a level
   */
  private getDependenciesForLevel(
    graph: DependencyGraph,
    sectionIds: string[]
  ): string[] {
    const deps = new Set<string>()

    for (const id of sectionIds) {
      const node = graph.nodes.get(id)
      if (node) {
        for (const depId of node.dependencies) {
          deps.add(depId)
        }
      }
    }

    return Array.from(deps)
  }

  /**
   * Compute critical path (longest dependency chain)
   */
  computeCriticalPath(graph: DependencyGraph): CriticalPath {
    const memo = new Map<string, { path: string[]; length: number }>()

    // Find longest path from each node using DFS + memoization
    const findLongestPath = (nodeId: string): { path: string[]; length: number } => {
      if (memo.has(nodeId)) {
        return memo.get(nodeId)!
      }

      const node = graph.nodes.get(nodeId)!
      if (node.dependents.length === 0) {
        const result = { path: [nodeId], length: 1 }
        memo.set(nodeId, result)
        return result
      }

      let longestPath: string[] = []
      let maxLength = 0

      for (const dependentId of node.dependents) {
        const { path, length } = findLongestPath(dependentId)
        if (length > maxLength) {
          maxLength = length
          longestPath = path
        }
      }

      const result = {
        path: [nodeId, ...longestPath],
        length: maxLength + 1,
      }
      memo.set(nodeId, result)
      return result
    }

    // Find longest path starting from any node with no dependencies
    let criticalPath: string[] = []
    let maxDuration = 0

    for (const [nodeId, node] of graph.nodes) {
      if (node.dependencies.length === 0) {
        const { path, length } = findLongestPath(nodeId)
        if (length > maxDuration) {
          maxDuration = length
          criticalPath = path
        }
      }
    }

    return {
      path: criticalPath,
      totalDuration: maxDuration,
      bottleneck: criticalPath[0] || '',
    }
  }

  /**
   * Compute parallelization score (0 = fully sequential, 1 = fully parallel)
   */
  computeParallelizationScore(groups: ParallelGroup[]): number {
    const totalSections = groups.reduce((sum, g) => sum + g.sectionIds.length, 0)

    if (totalSections <= 1) {
      return 0
    }

    // Count parallel opportunities (groups with >1 section)
    let parallelOpportunities = 0
    for (const group of groups) {
      if (group.sectionIds.length > 1) {
        parallelOpportunities++
      }
    }

    // Score = parallel opportunities / (total sections - 1)
    // -1 because in a fully sequential chain, no parallelization is possible
    return parallelOpportunities / (totalSections - 1)
  }

  /**
   * Topological sort of dependency graph
   */
  topologicalSort(graph: DependencyGraph): string[] {
    return graph.levels.flat()
  }

  /**
   * Find cycles in dependency graph (returns null if acyclic)
   */
  findCycles(graph: DependencyGraph): string[][] | null {
    const visited = new Set<string>()
    const recursionStack = new Set<string>()
    const cycles: string[][] = []

    const dfs = (nodeId: string, path: string[]): void => {
      visited.add(nodeId)
      recursionStack.add(nodeId)
      path.push(nodeId)

      const node = graph.nodes.get(nodeId)
      if (node) {
        for (const dependentId of node.dependents) {
          if (!visited.has(dependentId)) {
            dfs(dependentId, [...path])
          } else if (recursionStack.has(dependentId)) {
            // Found a cycle
            const cycleStart = path.indexOf(dependentId)
            cycles.push([...path.slice(cycleStart), dependentId])
          }
        }
      }

      recursionStack.delete(nodeId)
    }

    for (const nodeId of graph.nodes.keys()) {
      if (!visited.has(nodeId)) {
        dfs(nodeId, [])
      }
    }

    return cycles.length > 0 ? cycles : null
  }

  /**
   * Extract shared files across sections
   */
  private extractSharedFiles(sections: BvsSection[]): string[] {
    const fileToSections = new Map<string, string[]>()

    for (const section of sections) {
      for (const file of section.files) {
        if (!fileToSections.has(file.path)) {
          fileToSections.set(file.path, [])
        }
        fileToSections.get(file.path)!.push(section.id)
      }
    }

    return Array.from(fileToSections.entries())
      .filter(([_, sections]) => sections.length > 1)
      .map(([file, _]) => file)
  }
}

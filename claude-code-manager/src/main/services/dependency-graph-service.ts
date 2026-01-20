/**
 * Dependency Graph Service
 * Builds and analyzes task dependency graphs, assigns parallel groups
 */

import type { RalphTask, DependencyGraph, DependencyNode } from '../../shared/ralph-types'

// Security limits
const MAX_TASKS = 1000
const MAX_DEPENDENCIES_PER_TASK = 50
const MAX_TOTAL_DEPENDENCIES = 5000

/**
 * Cycle detection result
 */
export interface CycleDetectionResult {
  /** Whether cycles were found */
  hasCycles: boolean

  /** Path of task IDs forming the cycle */
  cyclePath: string[]
}

/**
 * Parallel group assignment result
 */
export interface ParallelGroupResult {
  /** Tasks with assigned parallel groups */
  tasks: RalphTask[]

  /** Group count */
  groupCount: number

  /** Tasks per group */
  groupSizes: Map<number, number>

  /** Any issues found */
  issues: string[]
}

/**
 * Dependency Graph Service
 */
export class DependencyGraphService {
  /**
   * Build dependency graph from tasks
   */
  buildGraph(tasks: RalphTask[]): DependencyGraph {
    // Validate input limits
    if (tasks.length > MAX_TASKS) {
      throw new Error(`Too many tasks: ${tasks.length} (max: ${MAX_TASKS})`)
    }

    let totalDeps = 0
    for (const task of tasks) {
      if (task.dependencies.length > MAX_DEPENDENCIES_PER_TASK) {
        throw new Error(
          `Task ${task.id} has too many dependencies: ${task.dependencies.length} (max: ${MAX_DEPENDENCIES_PER_TASK})`
        )
      }
      totalDeps += task.dependencies.length
    }

    if (totalDeps > MAX_TOTAL_DEPENDENCIES) {
      throw new Error(`Too many total dependencies: ${totalDeps} (max: ${MAX_TOTAL_DEPENDENCIES})`)
    }

    const nodes = new Map<string, DependencyNode>()
    const groups = new Map<number, string[]>()

    // Create nodes for all tasks
    for (const task of tasks) {
      nodes.set(task.id, {
        id: task.id,
        dependencies: [...task.dependencies],
        dependents: [],
        parallel_group: 0,
      })
    }

    // Build reverse dependencies (dependents)
    for (const task of tasks) {
      for (const depId of task.dependencies) {
        const depNode = nodes.get(depId)
        if (depNode) {
          depNode.dependents.push(task.id)
        }
      }
    }

    // Check for cycles
    const cycleResult = this.detectCycles(nodes)

    // If no cycles, assign parallel groups
    if (!cycleResult.hasCycles) {
      this.assignParallelGroups(nodes)

      // Build groups map
      for (const node of nodes.values()) {
        const groupTasks = groups.get(node.parallel_group) || []
        groupTasks.push(node.id)
        groups.set(node.parallel_group, groupTasks)
      }
    }

    return {
      nodes,
      groups,
      hasCycles: cycleResult.hasCycles,
      cyclePath: cycleResult.cyclePath.length > 0 ? cycleResult.cyclePath : undefined,
    }
  }

  /**
   * Detect cycles in the dependency graph using DFS
   */
  detectCycles(nodes: Map<string, DependencyNode>): CycleDetectionResult {
    // Reset visited flags
    for (const node of nodes.values()) {
      node.visited = false
      node.inCurrentPath = false
    }

    const cyclePath: string[] = []

    const dfs = (nodeId: string, path: string[]): boolean => {
      const node = nodes.get(nodeId)
      if (!node) return false

      if (node.inCurrentPath) {
        // Found cycle - extract the cycle path
        const cycleStart = path.indexOf(nodeId)
        cyclePath.push(...path.slice(cycleStart), nodeId)
        return true
      }

      if (node.visited) return false

      node.visited = true
      node.inCurrentPath = true
      path.push(nodeId)

      for (const depId of node.dependencies) {
        if (dfs(depId, path)) {
          return true
        }
      }

      node.inCurrentPath = false
      path.pop()
      return false
    }

    // Check all nodes (handles disconnected components)
    for (const nodeId of nodes.keys()) {
      const node = nodes.get(nodeId)
      // Defensive: explicit check instead of non-null assertion
      if (node && !node.visited) {
        if (dfs(nodeId, [])) {
          return { hasCycles: true, cyclePath }
        }
      }
    }

    return { hasCycles: false, cyclePath: [] }
  }

  /**
   * Assign parallel groups using topological sort
   * Tasks with no dependencies get group 0
   * Tasks depending on group N get group N+1
   */
  assignParallelGroups(nodes: Map<string, DependencyNode>): void {
    // Reset parallel groups
    for (const node of nodes.values()) {
      node.parallel_group = 0
    }

    // Calculate parallel group for each node
    // Group = max(dependency groups) + 1, or 0 if no dependencies
    let changed = true
    let iterations = 0
    const maxIterations = nodes.size + 1

    while (changed && iterations < maxIterations) {
      changed = false
      iterations++

      for (const node of nodes.values()) {
        if (node.dependencies.length === 0) {
          continue // Already group 0
        }

        let maxDepGroup = -1
        for (const depId of node.dependencies) {
          const depNode = nodes.get(depId)
          if (depNode) {
            maxDepGroup = Math.max(maxDepGroup, depNode.parallel_group)
          }
        }

        const newGroup = maxDepGroup + 1
        if (newGroup !== node.parallel_group) {
          node.parallel_group = newGroup
          changed = true
        }
      }
    }
  }

  /**
   * Assign parallel groups to tasks based on dependency graph
   */
  assignGroupsToTasks(tasks: RalphTask[]): ParallelGroupResult {
    const issues: string[] = []

    // Validate all dependencies exist
    const taskIds = new Set(tasks.map((t) => t.id))
    for (const task of tasks) {
      for (const depId of task.dependencies) {
        if (!taskIds.has(depId)) {
          issues.push(`Task "${task.id}" depends on unknown task "${depId}"`)
        }
      }
    }

    // Build graph
    const graph = this.buildGraph(tasks)

    if (graph.hasCycles) {
      issues.push(`Circular dependency detected: ${graph.cyclePath?.join(' -> ')}`)
      return {
        tasks,
        groupCount: 0,
        groupSizes: new Map(),
        issues,
      }
    }

    // Update tasks with assigned groups
    const updatedTasks = tasks.map((task) => {
      const node = graph.nodes.get(task.id)
      return {
        ...task,
        parallel_group: node?.parallel_group ?? 0,
      }
    })

    // Calculate group sizes
    const groupSizes = new Map<number, number>()
    for (const [group, taskIds] of graph.groups) {
      groupSizes.set(group, taskIds.length)
    }

    return {
      tasks: updatedTasks,
      groupCount: graph.groups.size,
      groupSizes,
      issues,
    }
  }

  /**
   * Get tasks that can run immediately (no pending dependencies)
   */
  getReadyTasks(tasks: RalphTask[], completedTaskIds: Set<string>): RalphTask[] {
    return tasks.filter((task) => {
      // Already completed
      if (completedTaskIds.has(task.id) || task.completed) {
        return false
      }

      // All dependencies completed
      return task.dependencies.every((depId) => completedTaskIds.has(depId))
    })
  }

  /**
   * Get tasks in a specific parallel group
   */
  getTasksInGroup(tasks: RalphTask[], groupNumber: number): RalphTask[] {
    return tasks.filter((t) => t.parallel_group === groupNumber)
  }

  /**
   * Get all unique parallel groups
   */
  getParallelGroups(tasks: RalphTask[]): number[] {
    const groups = new Set(tasks.map((t) => t.parallel_group))
    return Array.from(groups).sort((a, b) => a - b)
  }

  /**
   * Validate dependencies are satisfiable
   */
  validateDependencies(tasks: RalphTask[]): string[] {
    const errors: string[] = []
    const taskIds = new Set(tasks.map((t) => t.id))

    for (const task of tasks) {
      for (const depId of task.dependencies) {
        if (!taskIds.has(depId)) {
          errors.push(`Task "${task.id}" depends on non-existent task "${depId}"`)
        }

        // Check for self-dependency
        if (depId === task.id) {
          errors.push(`Task "${task.id}" depends on itself`)
        }
      }
    }

    // Check for cycles
    const graph = this.buildGraph(tasks)
    if (graph.hasCycles) {
      errors.push(`Circular dependency: ${graph.cyclePath?.join(' -> ')}`)
    }

    return errors
  }

  /**
   * Optimize parallel groups to minimize total execution time
   * Tries to balance work across groups while respecting dependencies
   */
  optimizeGroups(tasks: RalphTask[], maxParallelAgents: number): RalphTask[] {
    // First, assign basic groups
    const result = this.assignGroupsToTasks(tasks)
    if (result.issues.length > 0) {
      return result.tasks // Return without optimization if issues
    }

    // Now optimize: if a group has more tasks than maxParallelAgents,
    // we can't do better. But if a group has few tasks and the next group
    // has tasks whose only dependency is in the current group, we might
    // be able to merge them (not implemented yet - complex optimization)

    return result.tasks
  }

  /**
   * Generate Mermaid diagram of dependency graph
   */
  generateMermaidDiagram(tasks: RalphTask[]): string {
    const lines: string[] = ['graph TD']

    // Add nodes with styling by group
    const groups = this.getParallelGroups(tasks)
    const groupColors = ['#e8f5e9', '#e3f2fd', '#fff3e0', '#fce4ec', '#f3e5f5', '#e0f7fa']

    for (const task of tasks) {
      const label = task.title.length > 30 ? task.title.substring(0, 27) + '...' : task.title
      lines.push(`  ${task.id}["${label}"]`)
    }

    // Add subgraphs for groups
    for (const group of groups) {
      const groupTasks = this.getTasksInGroup(tasks, group)
      const color = groupColors[group % groupColors.length]
      lines.push(`  subgraph Group${group}["Group ${group}"]`)
      lines.push(`    style Group${group} fill:${color}`)
      for (const task of groupTasks) {
        lines.push(`    ${task.id}`)
      }
      lines.push('  end')
    }

    // Add dependency edges
    for (const task of tasks) {
      for (const depId of task.dependencies) {
        lines.push(`  ${depId} --> ${task.id}`)
      }
    }

    return lines.join('\n')
  }
}

// Export singleton instance
export const dependencyGraphService = new DependencyGraphService()

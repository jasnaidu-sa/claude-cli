/**
 * YAML Task Service
 * Generates and validates YAML task files from PRD or other sources
 */

import * as fs from 'fs'
import * as path from 'path'
import * as yaml from 'yaml'
import type {
  RalphTask,
  RalphTaskYaml,
  RalphProject,
  RalphProjectSettings,
  RalphReviewConfig,
  TaskCategory,
  TaskComplexity,
} from '../../shared/ralph-types'
import { prdParserService } from './prd-parser-service'
import { aiTaskExtractorService } from './ai-task-extractor'
import { dependencyGraphService } from './dependency-graph-service'

// =============================================================================
// Constants
// =============================================================================

/** Valid task categories */
const VALID_CATEGORIES: readonly TaskCategory[] = [
  'backend',
  'frontend',
  'mobile',
  'testing',
  'types',
  'infrastructure',
  'documentation',
] as const

/** Valid complexity levels */
const VALID_COMPLEXITIES: readonly TaskComplexity[] = ['low', 'medium', 'high'] as const

/** Maximum content sizes for security */
const MAX_CONTENT_SIZE = 1024 * 1024 // 1MB
const MAX_TASKS = 1000
const MAX_PATH_LENGTH = 500

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Type guard for valid task category
 */
function isValidCategory(value: unknown): value is TaskCategory {
  return typeof value === 'string' && VALID_CATEGORIES.includes(value as TaskCategory)
}

/**
 * Type guard for valid complexity
 */
function isValidComplexity(value: unknown): value is TaskComplexity {
  return typeof value === 'string' && VALID_COMPLEXITIES.includes(value as TaskComplexity)
}

// =============================================================================
// Security Utilities
// =============================================================================

/**
 * Sanitize file path to prevent path traversal
 */
function sanitizeFilePath(inputPath: string, baseDir?: string): string | null {
  // Check path length
  if (inputPath.length > MAX_PATH_LENGTH) {
    return null
  }

  const resolved = baseDir ? path.resolve(baseDir, inputPath) : path.resolve(inputPath)
  const normalized = path.normalize(resolved)

  // If baseDir provided, ensure path is within it
  if (baseDir) {
    const normalizedBase = path.normalize(path.resolve(baseDir))
    if (!normalized.startsWith(normalizedBase)) {
      return null // Path traversal attempt
    }
  }

  // Check for dangerous patterns
  if (normalized.includes('..') && !baseDir) {
    return null
  }

  return normalized
}

/**
 * Validate file paths from task data
 */
function validateFilePaths(paths: string[] | undefined): string[] | undefined {
  if (!paths) return undefined

  const validated: string[] = []
  for (const filePath of paths) {
    // Reject absolute paths
    if (path.isAbsolute(filePath)) {
      continue // Skip instead of throwing to be lenient with AI output
    }

    // Reject path traversal
    const normalized = path.normalize(filePath)
    if (normalized.includes('..') || normalized.startsWith('/') || normalized.startsWith('\\')) {
      continue
    }

    // Limit path length
    if (filePath.length > MAX_PATH_LENGTH) {
      continue
    }

    validated.push(normalized)
  }

  return validated.length > 0 ? validated : undefined
}

/**
 * YAML generation options
 */
export interface YamlGenerationOptions {
  /** Project name override */
  projectName?: string

  /** Base git branch */
  baseBranch?: string

  /** Maximum parallel agents */
  maxParallelAgents?: number

  /** Run tests per task */
  runTests?: boolean

  /** Run lint per task */
  runLint?: boolean

  /** Checkpoint before merge */
  checkpointBeforeMerge?: boolean

  /** Review after each group */
  reviewAfterGroup?: boolean

  /** Use AI for task extraction and dependency inference */
  useAi?: boolean
}

/**
 * YAML validation result
 */
export interface YamlValidationResult {
  /** Whether YAML is valid */
  valid: boolean

  /** Validation errors */
  errors: string[]

  /** Validation warnings */
  warnings: string[]

  /** Parsed YAML if valid */
  parsed?: RalphTaskYaml
}

/**
 * YAML Task Service
 */
export class YamlTaskService {
  private readonly defaultSettings: RalphProjectSettings = {
    max_parallel_agents: 3,
    checkpoint_before_merge: true,
    checkpoint_between_groups: true,
    run_tests_per_task: true,
    run_lint_per_task: true,
    min_confidence_for_auto_merge: 0.85,
    review_after_group: true,
  }

  private readonly defaultReviewConfig: RalphReviewConfig = {
    after_each_group: true,
    agents: [
      { type: 'work-reviewer-correctness', focus: ['bugs', 'logic-errors', 'edge-cases'] },
      { type: 'work-reviewer-security', focus: ['injection', 'auth', 'data-exposure'] },
      { type: 'work-reviewer-typescript', focus: ['type-safety', 'generics', 'null-safety'] },
    ],
    issue_handling: {
      P0: 'fix_immediately',
      P1: 'fix_immediately',
      P2: 'fix_immediately',
      P3: 'document_for_later',
    },
  }

  /**
   * Generate YAML task file from PRD content
   */
  async generateFromPrd(
    prdContent: string,
    outputPath: string,
    options: YamlGenerationOptions = {}
  ): Promise<{ success: boolean; yamlPath: string; taskCount: number; errors: string[] }> {
    const errors: string[] = []

    try {
      // Parse PRD to extract basic structure
      const parsedResult = prdParserService.parse(prdContent)

      let tasks: RalphTask[]
      let projectName = options.projectName || parsedResult.title || 'Unnamed Project'
      let projectDescription = parsedResult.description || ''

      if (options.useAi && aiTaskExtractorService.isInitialized()) {
        // Use AI for enhanced extraction
        const aiResult = await aiTaskExtractorService.extractTasks(prdContent, parsedResult)
        tasks = aiResult.tasks
        projectName = options.projectName || aiResult.projectName
        projectDescription = aiResult.projectDescription

        // Add any AI warnings to errors
        errors.push(...aiResult.warnings)
      } else {
        // Manual extraction from parsed result
        tasks = this.convertExtractedTasks(parsedResult.tasks)
      }

      // Assign parallel groups based on dependencies
      const groupResult = dependencyGraphService.assignGroupsToTasks(tasks)
      tasks = groupResult.tasks
      errors.push(...groupResult.issues)

      // Build YAML structure
      const yamlContent = this.buildYamlContent(tasks, {
        name: projectName,
        description: projectDescription,
        baseBranch: options.baseBranch || 'main',
        maxParallelAgents: options.maxParallelAgents,
        runTests: options.runTests,
        runLint: options.runLint,
        checkpointBeforeMerge: options.checkpointBeforeMerge,
        reviewAfterGroup: options.reviewAfterGroup,
      })

      // Write YAML file with atomic operation
      const yamlPath = this.ensureYamlPath(outputPath)
      if (!yamlPath) {
        errors.push('Invalid output path')
        return { success: false, yamlPath: '', taskCount: 0, errors }
      }
      const tempPath = `${yamlPath}.tmp`
      fs.writeFileSync(tempPath, yamlContent, 'utf-8')
      fs.renameSync(tempPath, yamlPath) // Atomic on most file systems

      return {
        success: true,
        yamlPath,
        taskCount: tasks.length,
        errors,
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
      return {
        success: false,
        yamlPath: '',
        taskCount: 0,
        errors,
      }
    }
  }

  /**
   * Generate YAML from existing tasks
   */
  generateFromTasks(
    tasks: RalphTask[],
    projectInfo: { name: string; description: string; baseBranch?: string },
    options: YamlGenerationOptions = {}
  ): string {
    // Assign parallel groups if not already assigned
    const groupResult = dependencyGraphService.assignGroupsToTasks(tasks)

    return this.buildYamlContent(groupResult.tasks, {
      name: projectInfo.name,
      description: projectInfo.description,
      baseBranch: options.baseBranch || projectInfo.baseBranch || 'main',
      maxParallelAgents: options.maxParallelAgents,
      runTests: options.runTests,
      runLint: options.runLint,
      checkpointBeforeMerge: options.checkpointBeforeMerge,
      reviewAfterGroup: options.reviewAfterGroup,
    })
  }

  /**
   * Validate YAML task file
   */
  validateYaml(content: string): YamlValidationResult {
    const errors: string[] = []
    const warnings: string[] = []

    try {
      const parsed = yaml.parse(content) as RalphTaskYaml

      // Validate project
      if (!parsed.project) {
        errors.push('Missing required "project" section')
      } else {
        if (!parsed.project.name) errors.push('Project name is required')
        if (!parsed.project.base_branch) warnings.push('No base branch specified, will default to "main"')
      }

      // Validate settings
      if (!parsed.settings) {
        warnings.push('No settings specified, will use defaults')
      } else {
        if (
          parsed.settings.max_parallel_agents &&
          (parsed.settings.max_parallel_agents < 1 || parsed.settings.max_parallel_agents > 10)
        ) {
          errors.push('max_parallel_agents must be between 1 and 10')
        }
        if (
          parsed.settings.min_confidence_for_auto_merge &&
          (parsed.settings.min_confidence_for_auto_merge < 0 ||
            parsed.settings.min_confidence_for_auto_merge > 1)
        ) {
          errors.push('min_confidence_for_auto_merge must be between 0 and 1')
        }
      }

      // Validate tasks
      if (!parsed.tasks || !Array.isArray(parsed.tasks)) {
        errors.push('Missing required "tasks" array')
      } else if (parsed.tasks.length === 0) {
        errors.push('Tasks array is empty')
      } else if (parsed.tasks.length > MAX_TASKS) {
        errors.push(`Too many tasks: ${parsed.tasks.length} (max: ${MAX_TASKS})`)
      } else {
        // First pass: collect all task IDs
        const allTaskIds = new Set<string>()
        for (const task of parsed.tasks) {
          if (task.id) {
            allTaskIds.add(task.id)
          }
        }

        // Second pass: validate each task
        const seenTaskIds = new Set<string>()
        for (const task of parsed.tasks) {
          // Check required fields
          if (!task.id) {
            errors.push('Task missing required "id" field')
            continue // Skip further validation for this task
          }
          if (!task.title) {
            errors.push(`Task ${task.id} missing required "title" field`)
          }

          // Check for duplicate IDs
          if (seenTaskIds.has(task.id)) {
            errors.push(`Duplicate task ID: ${task.id}`)
          }
          seenTaskIds.add(task.id)

          // Validate category using type guard
          if (task.category && !isValidCategory(task.category)) {
            warnings.push(`Task ${task.id}: Invalid category "${task.category}"`)
          }

          // Validate dependencies exist (check against all task IDs, not just seen)
          const dependencies = task.dependencies ?? []
          for (const depId of dependencies) {
            if (!allTaskIds.has(depId)) {
              errors.push(`Task ${task.id}: Dependency "${depId}" not found`)
            }
            // Check for self-dependency
            if (depId === task.id) {
              errors.push(`Task ${task.id}: Cannot depend on itself`)
            }
          }
        }

        // Check for cycles
        const graph = dependencyGraphService.buildGraph(parsed.tasks)
        if (graph.hasCycles) {
          errors.push(`Circular dependency detected: ${graph.cyclePath?.join(' -> ')}`)
        }
      }

      return {
        valid: errors.length === 0,
        errors,
        warnings,
        parsed: errors.length === 0 ? parsed : undefined,
      }
    } catch (error) {
      errors.push(`YAML parse error: ${error instanceof Error ? error.message : String(error)}`)
      return { valid: false, errors, warnings }
    }
  }

  /**
   * Load and validate YAML file
   */
  loadYamlFile(filePath: string): YamlValidationResult {
    try {
      if (!fs.existsSync(filePath)) {
        return { valid: false, errors: [`File not found: ${filePath}`], warnings: [] }
      }

      const content = fs.readFileSync(filePath, 'utf-8')
      return this.validateYaml(content)
    } catch (error) {
      return {
        valid: false,
        errors: [error instanceof Error ? error.message : String(error)],
        warnings: [],
      }
    }
  }

  /**
   * Update task in YAML file
   */
  updateTask(filePath: string, taskId: string, updates: Partial<RalphTask>): boolean {
    try {
      const result = this.loadYamlFile(filePath)
      if (!result.valid || !result.parsed) {
        return false
      }

      const taskIndex = result.parsed.tasks.findIndex((t) => t.id === taskId)
      if (taskIndex === -1) {
        return false
      }

      // Apply updates
      result.parsed.tasks[taskIndex] = {
        ...result.parsed.tasks[taskIndex],
        ...updates,
      }

      // Write back
      const yamlContent = yaml.stringify(result.parsed, {
        indent: 2,
        lineWidth: 120,
      })
      fs.writeFileSync(filePath, yamlContent, 'utf-8')

      return true
    } catch {
      return false
    }
  }

  /**
   * Mark task as completed in YAML file
   */
  markTaskCompleted(
    filePath: string,
    taskId: string,
    completedBy?: string
  ): boolean {
    return this.updateTask(filePath, taskId, {
      completed: true,
      completed_at: Date.now(),
      completed_by: completedBy,
    })
  }

  /**
   * Get tasks by parallel group
   */
  getTasksByGroup(yamlContent: RalphTaskYaml): Map<number, RalphTask[]> {
    const groups = new Map<number, RalphTask[]>()

    for (const task of yamlContent.tasks) {
      const group = task.parallel_group || 0
      const groupTasks = groups.get(group) || []
      groupTasks.push(task)
      groups.set(group, groupTasks)
    }

    return groups
  }

  /**
   * Get next executable tasks (dependencies satisfied)
   */
  getNextTasks(yamlContent: RalphTaskYaml): RalphTask[] {
    const completedIds = new Set(
      yamlContent.tasks.filter((t) => t.completed).map((t) => t.id)
    )

    return dependencyGraphService.getReadyTasks(yamlContent.tasks, completedIds)
  }

  /**
   * Build YAML content string
   */
  private buildYamlContent(
    tasks: RalphTask[],
    options: {
      name: string
      description: string
      baseBranch: string
      maxParallelAgents?: number
      runTests?: boolean
      runLint?: boolean
      checkpointBeforeMerge?: boolean
      reviewAfterGroup?: boolean
    }
  ): string {
    const project: RalphProject = {
      name: options.name,
      description: options.description,
      base_branch: options.baseBranch,
    }

    const settings: RalphProjectSettings = {
      ...this.defaultSettings,
      max_parallel_agents: options.maxParallelAgents ?? this.defaultSettings.max_parallel_agents,
      run_tests_per_task: options.runTests ?? this.defaultSettings.run_tests_per_task,
      run_lint_per_task: options.runLint ?? this.defaultSettings.run_lint_per_task,
      checkpoint_before_merge:
        options.checkpointBeforeMerge ?? this.defaultSettings.checkpoint_before_merge,
      review_after_group: options.reviewAfterGroup ?? this.defaultSettings.review_after_group,
    }

    const yamlContent: RalphTaskYaml = {
      project,
      settings,
      tasks,
      review: this.defaultReviewConfig,
    }

    return yaml.stringify(yamlContent, {
      indent: 2,
      lineWidth: 120,
    })
  }

  /**
   * Convert extracted tasks to RalphTask format
   */
  private convertExtractedTasks(
    extractedTasks: Array<{
      title: string
      description: string
      category?: string
      completed: boolean
      lineNumber: number
      section?: string
    }>
  ): RalphTask[] {
    return extractedTasks.map((task, index) => ({
      id: `task-${String(index + 1).padStart(4, '0')}`, // Use 4 digits for up to 9999 tasks
      title: task.title,
      description: task.description,
      category: isValidCategory(task.category) ? task.category : 'backend', // Use type guard
      parallel_group: 0, // Will be assigned by dependency graph service
      dependencies: [],
      estimated_complexity: prdParserService.estimateComplexity(task),
      acceptance_criteria: ['Task completed successfully'],
      completed: task.completed,
    }))
  }

  /**
   * Ensure YAML path has proper extension and directory
   * Returns null if path is invalid
   */
  private ensureYamlPath(outputPath: string): string | null {
    // Sanitize path
    const safePath = sanitizeFilePath(outputPath)
    if (!safePath) {
      return null
    }

    // Ensure .ralph/tasks directory exists
    const dir = path.dirname(safePath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    // Ensure .yaml extension
    if (!safePath.endsWith('.yaml') && !safePath.endsWith('.yml')) {
      return safePath + '.yaml'
    }

    return safePath
  }
}

// Export singleton instance
export const yamlTaskService = new YamlTaskService()

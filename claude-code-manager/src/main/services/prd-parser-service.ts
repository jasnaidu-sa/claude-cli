/**
 * PRD Parser Service
 * Parses PRD documents (markdown, plain text) and extracts task information
 */

import type { TaskCategory, TaskComplexity } from '../../shared/ralph-types'

// Security limits
const MAX_CONTENT_SIZE = 1024 * 1024 // 1MB
const MAX_LINES = 50000

/**
 * Raw extracted task before AI enhancement
 */
export interface ExtractedTask {
  /** Task title */
  title: string

  /** Task description */
  description: string

  /** Category from heading context */
  category?: string

  /** Whether task is marked complete */
  completed: boolean

  /** Original line number in PRD */
  lineNumber: number

  /** Section heading this task was under */
  section?: string
}

/**
 * PRD parse result
 */
export interface PrdParseResult {
  /** Extracted tasks */
  tasks: ExtractedTask[]

  /** PRD title if found */
  title?: string

  /** PRD description/overview if found */
  description?: string

  /** Sections found */
  sections: string[]

  /** Total line count */
  lineCount: number

  /** Parse warnings */
  warnings: string[]
}

/**
 * Parse options
 */
export interface PrdParseOptions {
  /** Include completed tasks */
  includeCompleted?: boolean

  /** Minimum task title length */
  minTitleLength?: number
}

/**
 * PRD Parser Service
 */
export class PrdParserService {
  private readonly defaultOptions: Required<PrdParseOptions> = {
    includeCompleted: false,
    minTitleLength: 5,
  }

  /**
   * Parse a PRD document and extract tasks
   */
  parse(content: string, options?: PrdParseOptions): PrdParseResult {
    // Validate content size
    if (content.length > MAX_CONTENT_SIZE) {
      throw new Error(`PRD content too large: ${content.length} bytes (max: ${MAX_CONTENT_SIZE})`)
    }

    const opts = { ...this.defaultOptions, ...options }
    const lines = content.split('\n')

    // Validate line count
    if (lines.length > MAX_LINES) {
      throw new Error(`PRD has too many lines: ${lines.length} (max: ${MAX_LINES})`)
    }

    const result: PrdParseResult = {
      tasks: [],
      sections: [],
      lineCount: lines.length,
      warnings: [],
    }

    let currentSection: string | undefined
    let currentCategory: string | undefined
    let descriptionBuffer: string[] = []
    let lastTaskIndex = -1

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const trimmedLine = line.trim()

      // Skip empty lines
      if (!trimmedLine) {
        continue
      }

      // Check for title (# heading at start)
      if (i < 10 && !result.title && trimmedLine.match(/^#\s+[^#]/)) {
        result.title = trimmedLine.replace(/^#\s+/, '').trim()
        continue
      }

      // Check for section headings
      const headingMatch = trimmedLine.match(/^(#{1,3})\s+(.+)$/)
      if (headingMatch) {
        const level = headingMatch[1].length
        const heading = headingMatch[2].trim()

        if (level <= 2) {
          currentSection = heading
          result.sections.push(heading)

          // Try to infer category from heading
          currentCategory = this.inferCategoryFromHeading(heading)
        }

        // Check if this is an overview/description section
        if (heading.toLowerCase().includes('overview') || heading.toLowerCase().includes('description')) {
          // Next non-empty, non-heading lines are description
          for (let j = i + 1; j < lines.length && j < i + 10; j++) {
            const descLine = lines[j].trim()
            if (!descLine) continue
            if (descLine.startsWith('#')) break
            if (descLine.match(/^[-*\d]/)) break
            descriptionBuffer.push(descLine)
          }
          if (descriptionBuffer.length > 0) {
            result.description = descriptionBuffer.join(' ')
            descriptionBuffer = []
          }
        }
        continue
      }

      // Check for task checkboxes: - [ ] or - [x] or * [ ] or * [x]
      const checkboxMatch = trimmedLine.match(/^[-*]\s+\[([ xX])\]\s+(.+)$/)
      if (checkboxMatch) {
        const isCompleted = checkboxMatch[1].toLowerCase() === 'x'
        const taskTitle = checkboxMatch[2].trim()

        // Skip if completed and not including completed
        if (isCompleted && !opts.includeCompleted) {
          continue
        }

        // Skip if title too short
        if (taskTitle.length < opts.minTitleLength) {
          result.warnings.push(`Line ${i + 1}: Task title too short: "${taskTitle}"`)
          continue
        }

        const task: ExtractedTask = {
          title: taskTitle,
          description: '',
          category: currentCategory,
          completed: isCompleted,
          lineNumber: i + 1,
          section: currentSection,
        }

        result.tasks.push(task)
        lastTaskIndex = result.tasks.length - 1
        continue
      }

      // Check for numbered tasks: 1. Task or 1) Task
      const numberedMatch = trimmedLine.match(/^\d+[.)]\s+(.+)$/)
      if (numberedMatch) {
        const taskTitle = numberedMatch[1].trim()

        // Skip if title too short
        if (taskTitle.length < opts.minTitleLength) {
          continue
        }

        // Skip if looks like a sub-item or description
        if (taskTitle.startsWith('-') || taskTitle.startsWith('*')) {
          continue
        }

        const task: ExtractedTask = {
          title: taskTitle,
          description: '',
          category: currentCategory,
          completed: false,
          lineNumber: i + 1,
          section: currentSection,
        }

        result.tasks.push(task)
        lastTaskIndex = result.tasks.length - 1
        continue
      }

      // Check for bullet points that might be tasks (under task sections)
      const bulletMatch = trimmedLine.match(/^[-*]\s+(.+)$/)
      if (bulletMatch && currentSection && this.isSectionLikelyTasks(currentSection)) {
        const taskTitle = bulletMatch[1].trim()

        // Skip if title too short
        if (taskTitle.length < opts.minTitleLength) {
          continue
        }

        // Skip if looks like a sub-description
        if (taskTitle.toLowerCase().startsWith('e.g.') || taskTitle.toLowerCase().startsWith('note:')) {
          // This might be description for previous task
          if (lastTaskIndex >= 0) {
            const prevDesc = result.tasks[lastTaskIndex].description
            result.tasks[lastTaskIndex].description = prevDesc
              ? `${prevDesc} ${taskTitle}`
              : taskTitle
          }
          continue
        }

        const task: ExtractedTask = {
          title: taskTitle,
          description: '',
          category: currentCategory,
          completed: false,
          lineNumber: i + 1,
          section: currentSection,
        }

        result.tasks.push(task)
        lastTaskIndex = result.tasks.length - 1
        continue
      }

      // If we have a recent task, subsequent indented lines might be description
      if (lastTaskIndex >= 0 && lastTaskIndex < result.tasks.length &&
          line.startsWith('  ') && !result.tasks[lastTaskIndex].description) {
        const descText = trimmedLine
        if (!descText.match(/^[-*\d]/) && descText.length > 10) {
          result.tasks[lastTaskIndex].description = descText
        }
      }
    }

    // Add warnings for potential issues
    if (result.tasks.length === 0) {
      result.warnings.push('No tasks found. Ensure tasks use checkbox format: - [ ] Task title')
    }

    if (!result.title) {
      result.warnings.push('No document title found. Consider adding a # Title heading.')
    }

    return result
  }

  /**
   * Infer task category from section heading
   */
  private inferCategoryFromHeading(heading: string): TaskCategory | undefined {
    const lower = heading.toLowerCase()

    if (lower.includes('backend') || lower.includes('api') || lower.includes('server') || lower.includes('database')) {
      return 'backend'
    }
    if (lower.includes('frontend') || lower.includes('ui') || lower.includes('component') || lower.includes('client')) {
      return 'frontend'
    }
    if (lower.includes('mobile') || lower.includes('ios') || lower.includes('android') || lower.includes('app')) {
      return 'mobile'
    }
    if (lower.includes('test') || lower.includes('spec') || lower.includes('e2e') || lower.includes('unit')) {
      return 'testing'
    }
    if (lower.includes('type') || lower.includes('interface') || lower.includes('schema')) {
      return 'types'
    }
    if (lower.includes('infra') || lower.includes('deploy') || lower.includes('ci') || lower.includes('config')) {
      return 'infrastructure'
    }
    if (lower.includes('doc') || lower.includes('readme') || lower.includes('guide')) {
      return 'documentation'
    }

    return undefined
  }

  /**
   * Check if section heading suggests it contains tasks
   */
  private isSectionLikelyTasks(section: string): boolean {
    const lower = section.toLowerCase()
    const taskKeywords = [
      'task',
      'requirement',
      'feature',
      'todo',
      'work',
      'implement',
      'create',
      'build',
      'add',
      'backend',
      'frontend',
      'mobile',
      'testing',
    ]
    return taskKeywords.some((kw) => lower.includes(kw))
  }

  /**
   * Estimate task complexity from title and description
   */
  estimateComplexity(task: ExtractedTask): TaskComplexity {
    const text = `${task.title} ${task.description}`.toLowerCase()

    // High complexity indicators
    const highIndicators = [
      'implement',
      'create service',
      'build system',
      'integration',
      'authentication',
      'authorization',
      'real-time',
      'websocket',
      'database migration',
      'complex',
      'architecture',
    ]

    // Low complexity indicators
    const lowIndicators = [
      'add comment',
      'rename',
      'update text',
      'fix typo',
      'simple',
      'basic',
      'minor',
      'small',
      'trivial',
    ]

    const hasHighIndicator = highIndicators.some((ind) => text.includes(ind))
    const hasLowIndicator = lowIndicators.some((ind) => text.includes(ind))

    if (hasHighIndicator && !hasLowIndicator) {
      return 'high'
    }
    if (hasLowIndicator && !hasHighIndicator) {
      return 'low'
    }

    // Default to medium
    return 'medium'
  }

  /**
   * Parse GitHub issue as task
   */
  parseGitHubIssue(issue: {
    number: number
    title: string
    body: string | null
    labels: Array<{ name: string }>
  }): ExtractedTask {
    // Try to infer category from labels
    let category: string | undefined
    for (const label of issue.labels) {
      const inferredCategory = this.inferCategoryFromHeading(label.name)
      if (inferredCategory) {
        category = inferredCategory
        break
      }
    }

    return {
      title: issue.title,
      description: issue.body || '',
      category,
      completed: false,
      lineNumber: issue.number, // Use issue number
      section: 'GitHub Issues',
    }
  }
}

// Export singleton instance
export const prdParserService = new PrdParserService()

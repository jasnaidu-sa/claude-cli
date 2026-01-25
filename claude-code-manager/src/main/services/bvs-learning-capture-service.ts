/**
 * BVS Learning Capture Service (RALPH-015)
 *
 * Captures learnings when session limits are hit to improve future planning.
 * Stores patterns that led to limit violations and provides recommendations.
 *
 * Learning Categories:
 * - Cost Overruns: Subtask/section/session exceeded budget
 * - Iteration Overruns: Subtask exceeded max iterations
 * - Model Selection: Incorrect model choice for complexity
 * - File Grouping: Poor subtask file grouping
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import type {
  BvsSubtask,
  BvsSection,
  SessionLimitError,
  BvsExecutionConfig
} from '@shared/bvs-types'

export interface LearningEntry {
  id: string
  timestamp: number
  category: 'cost_overrun' | 'iteration_overrun' | 'model_selection' | 'file_grouping'
  severity: 'low' | 'medium' | 'high'
  context: {
    sectionId: string
    sectionName: string
    subtaskId?: string
    subtaskName?: string
    limitType?: 'iterations' | 'cost' | 'time'
    limitValue?: number
    actualValue?: number
  }
  analysis: {
    rootCause: string
    patterns: string[]
    complexity: number
    fileCount: number
    modelUsed?: string
  }
  recommendations: string[]
}

export interface LearningReport {
  totalLearnings: number
  bySeverity: Record<'low' | 'medium' | 'high', number>
  byCategory: Record<string, number>
  topPatterns: Array<{ pattern: string; count: number }>
  recommendations: string[]
}

export class BvsLearningCaptureService {
  private learningsDir: string
  private learnings: LearningEntry[] = []

  constructor() {
    // Store learnings in user's home directory
    const homeDir = process.env.HOME || process.env.USERPROFILE || '/tmp'
    this.learningsDir = path.join(homeDir, '.bvs', 'learnings')
  }

  /**
   * Initialize learning storage
   */
  async initialize(): Promise<void> {
    try {
      await fs.mkdir(this.learningsDir, { recursive: true })
      await this.loadLearnings()
    } catch (error) {
      console.error('[BvsLearningCapture] Failed to initialize:', error)
    }
  }

  /**
   * Capture learning when session limit is exceeded
   */
  async captureLimitViolation(
    error: SessionLimitError,
    section: BvsSection,
    subtask?: BvsSubtask,
    config?: BvsExecutionConfig
  ): Promise<LearningEntry> {
    const learning: LearningEntry = {
      id: `learning-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      category: this.categorizeLimitViolation(error, subtask),
      severity: this.calculateSeverity(error),
      context: {
        sectionId: section.id,
        sectionName: section.name,
        subtaskId: subtask?.id,
        subtaskName: subtask?.name,
        limitType: error.limitType,
        limitValue: error.limit,
        actualValue: error.actual
      },
      analysis: {
        rootCause: this.analyzeRootCause(error, section, subtask),
        patterns: this.identifyPatterns(section, subtask),
        complexity: this.calculateComplexity(section, subtask),
        fileCount: subtask ? subtask.files.length : section.files.length,
        modelUsed: subtask?.metrics?.model
      },
      recommendations: this.generateRecommendations(error, section, subtask, config)
    }

    this.learnings.push(learning)
    await this.saveLearnings()

    return learning
  }

  /**
   * Get learning report for a project
   */
  async getReport(sectionNameFilter?: string): Promise<LearningReport> {
    const filtered = sectionNameFilter
      ? this.learnings.filter(l => l.context.sectionName.includes(sectionNameFilter))
      : this.learnings

    const bySeverity = {
      low: filtered.filter(l => l.severity === 'low').length,
      medium: filtered.filter(l => l.severity === 'medium').length,
      high: filtered.filter(l => l.severity === 'high').length
    }

    const byCategory: Record<string, number> = {}
    filtered.forEach(l => {
      byCategory[l.category] = (byCategory[l.category] || 0) + 1
    })

    // Aggregate patterns
    const patternCounts: Record<string, number> = {}
    filtered.forEach(l => {
      l.analysis.patterns.forEach(p => {
        patternCounts[p] = (patternCounts[p] || 0) + 1
      })
    })

    const topPatterns = Object.entries(patternCounts)
      .map(([pattern, count]) => ({ pattern, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)

    // Aggregate recommendations
    const recCounts: Record<string, number> = {}
    filtered.forEach(l => {
      l.recommendations.forEach(r => {
        recCounts[r] = (recCounts[r] || 0) + 1
      })
    })

    const recommendations = Object.entries(recCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([rec]) => rec)

    return {
      totalLearnings: filtered.length,
      bySeverity,
      byCategory,
      topPatterns,
      recommendations
    }
  }

  /**
   * Clear old learnings (keep last 90 days)
   */
  async cleanup(daysToKeep = 90): Promise<number> {
    const cutoffTime = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000)
    const before = this.learnings.length
    this.learnings = this.learnings.filter(l => l.timestamp > cutoffTime)
    const removed = before - this.learnings.length

    if (removed > 0) {
      await this.saveLearnings()
    }

    return removed
  }

  // Private methods

  private categorizeLimitViolation(
    error: SessionLimitError,
    subtask?: BvsSubtask
  ): LearningEntry['category'] {
    if (error.limitType === 'cost') {
      return 'cost_overrun'
    } else if (error.limitType === 'iterations') {
      return 'iteration_overrun'
    } else if (subtask && subtask.metrics) {
      // Analyze if wrong model was selected
      const shouldBeHaiku = subtask.files.length <= 4
      const usedSonnet = subtask.metrics.model === 'sonnet'
      if (shouldBeHaiku && usedSonnet) {
        return 'model_selection'
      }
    }
    return 'file_grouping'
  }

  private calculateSeverity(error: SessionLimitError): 'low' | 'medium' | 'high' {
    const percentOver = ((error.actual - error.limit) / error.limit) * 100

    if (percentOver > 50) return 'high'
    if (percentOver > 20) return 'medium'
    return 'low'
  }

  private analyzeRootCause(
    error: SessionLimitError,
    section: BvsSection,
    subtask?: BvsSubtask
  ): string {
    if (error.limitType === 'cost') {
      if (subtask) {
        return `Subtask "${subtask.name}" exceeded cost limit of $${error.limit} (actual: $${error.actual})`
      }
      return `Section "${section.name}" exceeded cost limit of $${error.limit} (actual: $${error.actual})`
    }

    if (error.limitType === 'iterations') {
      return `Subtask exceeded max iterations (${error.limit}), likely due to complex requirements or quality gate failures`
    }

    return `Time limit exceeded for ${error.context}`
  }

  private identifyPatterns(section: BvsSection, subtask?: BvsSubtask): string[] {
    const patterns: string[] = []

    // Analyze file count
    const fileCount = subtask ? subtask.files.length : section.files.length
    if (fileCount > 5) {
      patterns.push(`Large file count (${fileCount} files) - consider splitting into smaller subtasks`)
    }

    // Analyze file types
    if (subtask) {
      const hasSchemaFiles = subtask.files.some(f =>
        f.includes('schema') || f.includes('migration') || f.includes('prisma')
      )
      const hasTypeFiles = subtask.files.some(f => f.includes('.types.ts'))
      const hasImplFiles = subtask.files.some(f =>
        !f.includes('.types.ts') && !f.includes('.test.') && !f.includes('schema')
      )

      if (hasSchemaFiles && (hasTypeFiles || hasImplFiles)) {
        patterns.push('Mixed file types in subtask - schema changes should be isolated')
      }
    }

    // Check for complexity indicators
    const hasApiRoutes = (subtask?.files || section.files).some(f =>
      f.path.includes('/api/') || f.path.includes('/routes/')
    )
    const hasDatabase = (subtask?.files || section.files).some(f =>
      f.path.includes('database') || f.path.includes('db.')
    )

    if (hasApiRoutes && hasDatabase) {
      patterns.push('API and database changes combined - high complexity')
    }

    return patterns
  }

  private calculateComplexity(section: BvsSection, subtask?: BvsSubtask): number {
    const fileCount = subtask ? subtask.files.length : section.files.length
    let score = fileCount

    // Add complexity for specific file types
    const files = subtask ? subtask.files : section.files.map(f => f.path)
    files.forEach(file => {
      if (file.includes('schema') || file.includes('migration')) score += 2
      if (file.includes('/api/')) score += 1
      if (file.includes('service')) score += 1
    })

    return score
  }

  private generateRecommendations(
    error: SessionLimitError,
    section: BvsSection,
    subtask?: BvsSubtask,
    config?: BvsExecutionConfig
  ): string[] {
    const recommendations: string[] = []

    if (error.limitType === 'cost') {
      if (subtask) {
        const fileCount = subtask.files.length
        if (fileCount > 4) {
          recommendations.push(`Split subtask into smaller units (currently ${fileCount} files, target: ≤4)`)
        }

        if (subtask.metrics?.model === 'sonnet' && fileCount <= 4) {
          recommendations.push('Consider using Haiku for subtasks with ≤4 files to reduce cost')
        }
      }

      if (error.actual > error.limit * 2) {
        recommendations.push('Significantly over budget - review section complexity analysis')
      }

      const avgCostPerFile = error.actual / (subtask?.files.length || section.files.length)
      if (avgCostPerFile > 0.15) {
        recommendations.push(`High cost per file ($${avgCostPerFile.toFixed(3)}) - files may be too complex`)
      }
    }

    if (error.limitType === 'iterations') {
      recommendations.push('Review quality gate settings - may be too strict')
      recommendations.push('Consider adding acceptance criteria to subtask description')

      if (subtask && subtask.retryCount > 0) {
        recommendations.push('Multiple retries detected - provide more specific requirements')
      }
    }

    // Check if section should be split further
    if (section.files.length > 10) {
      recommendations.push(`Large section (${section.files.length} files) - split into multiple sections`)
    }

    return recommendations
  }

  private async loadLearnings(): Promise<void> {
    try {
      const learningsFile = path.join(this.learningsDir, 'learnings.json')
      const data = await fs.readFile(learningsFile, 'utf-8')
      this.learnings = JSON.parse(data)
    } catch (error) {
      // File doesn't exist yet, start with empty array
      this.learnings = []
    }
  }

  private async saveLearnings(): Promise<void> {
    try {
      const learningsFile = path.join(this.learningsDir, 'learnings.json')
      await fs.writeFile(learningsFile, JSON.stringify(this.learnings, null, 2))
    } catch (error) {
      console.error('[BvsLearningCapture] Failed to save learnings:', error)
    }
  }
}

// Singleton instance
let bvsLearningCaptureService: BvsLearningCaptureService | null = null

export function getBvsLearningCaptureService(): BvsLearningCaptureService {
  if (!bvsLearningCaptureService) {
    bvsLearningCaptureService = new BvsLearningCaptureService()
    bvsLearningCaptureService.initialize()
  }
  return bvsLearningCaptureService
}

/**
 * BVS Learning Service
 *
 * Implements the learning system for capturing and reusing patterns:
 * - F5.1 - Learning Capture (extract from fix sessions)
 * - F5.2 - Learning Storage (append to learnings.md)
 * - F5.3 - Learning Loader (read at session start)
 * - F5.4 - Learning Application (pre-check before similar code)
 * - F5.5 - Learning Editor (view/edit/delete learnings)
 */

import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'
import * as path from 'path'
import * as fs from 'fs/promises'
import {
  type BvsLearning,
  type BvsTypeError,
  type BvsReviewIssue,
  BVS_IPC_CHANNELS,
} from '@shared/bvs-types'
import { getMainWindow } from '../index'

// ============================================================================
// Types
// ============================================================================

export interface LearningConfig {
  enabled: boolean
  captureOnFix: boolean
  applyAutomatically: boolean
  maxLearningsPerProject: number
  similarityThreshold: number
}

export interface LearningContext {
  errorType: string
  errorMessage: string
  file: string
  codeSnippet?: string
  fixApplied: string
}

export interface LearningMatch {
  learning: BvsLearning
  confidence: number
  matchReason: string
}

const DEFAULT_CONFIG: LearningConfig = {
  enabled: true,
  captureOnFix: true,
  applyAutomatically: true,
  maxLearningsPerProject: 100,
  similarityThreshold: 0.7,
}

// ============================================================================
// Learning Service
// ============================================================================

export class BvsLearningService extends EventEmitter {
  private config: LearningConfig = DEFAULT_CONFIG
  private learnings: Map<string, BvsLearning[]> = new Map() // projectPath -> learnings
  private projectPath: string | null = null

  constructor() {
    super()
  }

  /**
   * Send event to renderer
   */
  private sendToRenderer(channel: string, data: unknown): void {
    const mainWindow = getMainWindow()
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, data)
    }
  }

  /**
   * Initialize for a project
   */
  async initialize(projectPath: string): Promise<void> {
    this.projectPath = projectPath

    // Load existing learnings
    await this.loadLearnings(projectPath)
  }

  /**
   * Set configuration
   */
  setConfig(config: Partial<LearningConfig>): void {
    this.config = { ...this.config, ...config }
  }

  /**
   * Type guard to validate a BvsLearning object
   */
  private isValidLearning(obj: unknown): obj is BvsLearning {
    if (typeof obj !== 'object' || obj === null) return false
    const learning = obj as Record<string, unknown>
    return (
      typeof learning.id === 'string' &&
      typeof learning.problem === 'string' &&
      typeof learning.solution === 'string' &&
      typeof learning.createdAt === 'number' &&
      typeof learning.appliedCount === 'number'
    )
  }

  /**
   * F5.3 - Load learnings from file
   */
  async loadLearnings(projectPath: string): Promise<BvsLearning[]> {
    const learningsPath = path.join(projectPath, '.bvs', 'learnings.json')

    try {
      const content = await fs.readFile(learningsPath, 'utf-8')
      const parsed = JSON.parse(content)

      // Validate that parsed content is an array of valid learnings
      if (!Array.isArray(parsed)) {
        console.warn('[BvsLearning] Invalid learnings file format: expected array')
        this.learnings.set(projectPath, [])
        return []
      }

      // Filter out invalid entries
      const learnings = parsed.filter((item): item is BvsLearning => {
        const isValid = this.isValidLearning(item)
        if (!isValid) {
          console.warn('[BvsLearning] Skipping invalid learning entry:', item)
        }
        return isValid
      })

      this.learnings.set(projectPath, learnings)
      return learnings
    } catch {
      // No learnings file yet or parse error
      this.learnings.set(projectPath, [])
      return []
    }
  }

  /**
   * F5.2 - Save learnings to file
   */
  async saveLearnings(projectPath: string): Promise<void> {
    const learnings = this.learnings.get(projectPath) || []
    const bvsDir = path.join(projectPath, '.bvs')
    await fs.mkdir(bvsDir, { recursive: true })

    // Save JSON
    const learningsPath = path.join(bvsDir, 'learnings.json')
    await fs.writeFile(learningsPath, JSON.stringify(learnings, null, 2))

    // Also save human-readable markdown
    const markdownPath = path.join(bvsDir, 'learnings.md')
    await fs.writeFile(markdownPath, this.formatLearningsAsMarkdown(learnings))
  }

  /**
   * F5.1 - Capture learning from a fix
   */
  async captureLearning(
    context: LearningContext,
    userProvidedSolution?: string
  ): Promise<BvsLearning> {
    if (!this.projectPath) {
      throw new Error('Project path not set')
    }

    const learning: BvsLearning = {
      id: `L-${randomUUID().slice(0, 8)}`,
      problem: `${context.errorType}: ${context.errorMessage}`,
      solution: userProvidedSolution || context.fixApplied,
      preventionRule: this.generatePreventionRule(context),
      files: [context.file],
      codePattern: context.codeSnippet,
      createdAt: Date.now(),
      appliedCount: 0,
    }

    // Add to collection
    const projectLearnings = this.learnings.get(this.projectPath) || []
    projectLearnings.push(learning)

    // Trim if over limit
    if (projectLearnings.length > this.config.maxLearningsPerProject) {
      // Remove oldest, least-used learnings
      projectLearnings.sort((a, b) => {
        const scoreA = a.appliedCount * 1000 + a.createdAt
        const scoreB = b.appliedCount * 1000 + b.createdAt
        return scoreB - scoreA
      })
      projectLearnings.length = this.config.maxLearningsPerProject
    }

    this.learnings.set(this.projectPath, projectLearnings)

    // Save
    await this.saveLearnings(this.projectPath)

    // Emit event
    this.emit('learning-captured', learning)
    this.sendToRenderer(BVS_IPC_CHANNELS.BVS_EVENT, {
      type: 'learning_captured',
      learning,
    })

    return learning
  }

  /**
   * F5.1 - Capture learning from type error fix
   */
  async captureFromTypeError(
    error: BvsTypeError,
    fix: string
  ): Promise<BvsLearning> {
    return this.captureLearning({
      errorType: `TypeScript ${error.code}`,
      errorMessage: error.message,
      file: error.file,
      fixApplied: fix,
    })
  }

  /**
   * F5.1 - Capture learning from review issue fix
   */
  async captureFromReviewIssue(
    issue: BvsReviewIssue,
    fix: string
  ): Promise<BvsLearning> {
    return this.captureLearning({
      errorType: `${issue.reviewer} - ${issue.priority}`,
      errorMessage: issue.message,
      file: issue.file,
      codeSnippet: issue.codeSnippet,
      fixApplied: fix,
    })
  }

  /**
   * F5.4 - Find applicable learnings for a context
   */
  findApplicableLearnings(
    errorMessage: string,
    file?: string
  ): LearningMatch[] {
    if (!this.projectPath) return []

    const projectLearnings = this.learnings.get(this.projectPath) || []
    const matches: LearningMatch[] = []

    for (const learning of projectLearnings) {
      const confidence = this.calculateSimilarity(learning, errorMessage, file)

      if (confidence >= this.config.similarityThreshold) {
        matches.push({
          learning,
          confidence,
          matchReason: this.explainMatch(learning, errorMessage, file),
        })
      }
    }

    // Sort by confidence
    matches.sort((a, b) => b.confidence - a.confidence)

    return matches
  }

  /**
   * F5.4 - Apply learning (increment usage count)
   */
  async applyLearning(learningId: string): Promise<boolean> {
    if (!this.projectPath) return false

    const projectLearnings = this.learnings.get(this.projectPath) || []
    const learning = projectLearnings.find(l => l.id === learningId)

    if (learning) {
      learning.appliedCount++
      learning.lastAppliedAt = Date.now()
      await this.saveLearnings(this.projectPath)
      return true
    }

    return false
  }

  /**
   * F5.5 - Get all learnings for a project
   */
  getLearnings(projectPath?: string): BvsLearning[] {
    const path = projectPath || this.projectPath
    if (!path) return []
    return this.learnings.get(path) || []
  }

  /**
   * F5.5 - Get a specific learning
   */
  getLearning(learningId: string): BvsLearning | undefined {
    if (!this.projectPath) return undefined
    const projectLearnings = this.learnings.get(this.projectPath) || []
    return projectLearnings.find(l => l.id === learningId)
  }

  /**
   * F5.5 - Update a learning
   */
  async updateLearning(
    learningId: string,
    updates: Partial<Omit<BvsLearning, 'id' | 'createdAt'>>
  ): Promise<boolean> {
    if (!this.projectPath) return false

    const projectLearnings = this.learnings.get(this.projectPath) || []
    const index = projectLearnings.findIndex(l => l.id === learningId)

    if (index !== -1) {
      projectLearnings[index] = {
        ...projectLearnings[index],
        ...updates,
      }
      await this.saveLearnings(this.projectPath)
      return true
    }

    return false
  }

  /**
   * F5.5 - Delete a learning
   */
  async deleteLearning(learningId: string): Promise<boolean> {
    if (!this.projectPath) return false

    const projectLearnings = this.learnings.get(this.projectPath) || []
    const index = projectLearnings.findIndex(l => l.id === learningId)

    if (index !== -1) {
      projectLearnings.splice(index, 1)
      this.learnings.set(this.projectPath, projectLearnings)
      await this.saveLearnings(this.projectPath)
      return true
    }

    return false
  }

  /**
   * Generate prevention rule from context
   */
  private generatePreventionRule(context: LearningContext): string {
    const rules: string[] = []

    // Pattern-based rules
    if (context.errorType.includes('TS2322')) {
      rules.push('Ensure type compatibility when assigning values')
    } else if (context.errorType.includes('TS2339')) {
      rules.push('Verify property exists on type before accessing')
    } else if (context.errorType.includes('TS2345')) {
      rules.push('Check function parameter types match expected types')
    } else if (context.errorType.includes('correctness')) {
      rules.push('Review logic for edge cases and error handling')
    } else if (context.errorType.includes('conventions')) {
      rules.push('Follow project naming and structure conventions')
    }

    // File-based rules
    if (context.file.includes('service')) {
      rules.push('Services should handle errors gracefully')
    } else if (context.file.includes('component')) {
      rules.push('Components should validate props')
    }

    return rules.length > 0
      ? rules.join('. ')
      : 'Review similar patterns in the codebase before implementing'
  }

  /**
   * Calculate similarity between learning and current context
   * Uses weighted scoring with proper normalization
   */
  private calculateSimilarity(
    learning: BvsLearning,
    errorMessage: string,
    file?: string
  ): number {
    // Define weights that sum to 1.0
    const WEIGHTS = {
      message: 0.6,   // Error message similarity is most important
      directory: 0.2, // Same directory suggests similar context
      extension: 0.1, // Same file type is mildly relevant
      pattern: 0.1,   // Having a code pattern is a small bonus
    }

    let totalScore = 0

    // Error message similarity (most important)
    const messageSimilarity = this.textSimilarity(
      learning.problem.toLowerCase(),
      errorMessage.toLowerCase()
    )
    totalScore += messageSimilarity * WEIGHTS.message

    // File pattern match
    if (file && learning.files && learning.files.length > 0) {
      let dirMatch = false
      let extMatch = false

      for (const learningFile of learning.files) {
        // Check if files are in same directory
        const learningDir = path.dirname(learningFile)
        const currentDir = path.dirname(file)
        if (learningDir === currentDir) {
          dirMatch = true
        }
        // Check if files have same extension
        if (path.extname(learningFile) === path.extname(file)) {
          extMatch = true
        }
      }

      if (dirMatch) totalScore += WEIGHTS.directory
      if (extMatch) totalScore += WEIGHTS.extension
    }

    // Code pattern bonus (presence indicates more specific learning)
    if (learning.codePattern && learning.codePattern.trim().length > 0) {
      totalScore += WEIGHTS.pattern
    }

    // Score is already normalized to 0-1 range due to weights summing to 1
    return Math.min(1, totalScore)
  }

  /**
   * Simple text similarity (Jaccard similarity)
   */
  private textSimilarity(text1: string, text2: string): number {
    const words1 = new Set(text1.split(/\W+/).filter(w => w.length > 2))
    const words2 = new Set(text2.split(/\W+/).filter(w => w.length > 2))

    const intersection = new Set([...words1].filter(w => words2.has(w)))
    const union = new Set([...words1, ...words2])

    return union.size > 0 ? intersection.size / union.size : 0
  }

  /**
   * Explain why a learning matched
   */
  private explainMatch(
    learning: BvsLearning,
    errorMessage: string,
    file?: string
  ): string {
    const reasons: string[] = []

    // Check error type match
    const errorWords = errorMessage.toLowerCase().split(/\W+/)
    const problemWords = learning.problem.toLowerCase().split(/\W+/)
    const commonWords = errorWords.filter(w => problemWords.includes(w) && w.length > 3)

    if (commonWords.length > 0) {
      reasons.push(`Similar error: "${commonWords.slice(0, 3).join(', ')}"`)
    }

    // Check file pattern
    if (file && learning.files) {
      for (const learningFile of learning.files) {
        if (path.dirname(file) === path.dirname(learningFile)) {
          reasons.push(`Same directory as previous fix`)
        }
      }
    }

    // Applied count
    if (learning.appliedCount > 0) {
      reasons.push(`Successfully applied ${learning.appliedCount} time(s)`)
    }

    return reasons.join('; ') || 'Pattern match'
  }

  /**
   * Format learnings as markdown
   */
  private formatLearningsAsMarkdown(learnings: BvsLearning[]): string {
    const lines = ['# BVS Learnings\n']
    lines.push('Patterns and solutions captured during BVS sessions.\n')
    lines.push('---\n')

    for (const learning of learnings) {
      lines.push(`## ${learning.id}\n`)
      lines.push(`**Created:** ${new Date(learning.createdAt).toISOString()}\n`)
      lines.push(`**Applied:** ${learning.appliedCount} times\n`)
      if (learning.files && learning.files.length > 0) {
        lines.push(`**Files:** ${learning.files.join(', ')}\n`)
      }
      lines.push('\n### Problem\n')
      lines.push(`${learning.problem}\n`)
      lines.push('\n### Solution\n')
      lines.push(`${learning.solution}\n`)
      lines.push('\n### Prevention Rule\n')
      lines.push(`${learning.preventionRule}\n`)
      if (learning.codePattern) {
        lines.push('\n### Code Pattern\n')
        lines.push('```\n')
        lines.push(learning.codePattern)
        lines.push('\n```\n')
      }
      lines.push('\n---\n')
    }

    return lines.join('\n')
  }

  /**
   * Get learning statistics
   */
  getStats(): {
    total: number
    recentlyApplied: number
    mostUsed: BvsLearning | null
    averageApplications: number
  } {
    if (!this.projectPath) {
      return { total: 0, recentlyApplied: 0, mostUsed: null, averageApplications: 0 }
    }

    const learnings = this.learnings.get(this.projectPath) || []
    const now = Date.now()
    const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000

    const recentlyApplied = learnings.filter(
      l => l.lastAppliedAt && l.lastAppliedAt > oneWeekAgo
    ).length

    const mostUsed = learnings.length > 0
      ? learnings.reduce((a, b) => a.appliedCount > b.appliedCount ? a : b)
      : null

    const totalApplications = learnings.reduce((sum, l) => sum + l.appliedCount, 0)
    const averageApplications = learnings.length > 0
      ? totalApplications / learnings.length
      : 0

    return {
      total: learnings.length,
      recentlyApplied,
      mostUsed,
      averageApplications,
    }
  }
}

// Singleton instance
let bvsLearningService: BvsLearningService | null = null

export function getBvsLearningService(): BvsLearningService {
  if (!bvsLearningService) {
    bvsLearningService = new BvsLearningService()
  }
  return bvsLearningService
}

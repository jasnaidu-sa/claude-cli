/**
 * BVS Code Review Service
 *
 * Manages code review using start-task review agents.
 * Spawns parallel reviewers and aggregates findings by priority.
 *
 * Review agents:
 * - work-reviewer-correctness: Bugs, logic errors, edge cases, security
 * - work-reviewer-typescript: Type safety, generics, null safety
 * - work-reviewer-conventions: Naming, file structure, patterns
 * - work-reviewer-simplicity: DRY, elegance, readability
 *
 * Priority levels:
 * - P0 (Critical): Fix immediately, blocks progress
 * - P1 (Major): Fix before section complete
 * - P2 (Minor): Fix or acknowledge, continue
 */

import { EventEmitter } from 'events'
import * as path from 'path'
import * as fs from 'fs/promises'
import {
  type BvsCodeReviewResult,
  type BvsReviewerResult,
  type BvsReviewIssue,
  type BvsReviewerType,
  type BvsReviewPriority,
  BVS_IPC_CHANNELS,
} from '@shared/bvs-types'
import { getMainWindow } from '../index'
import {
  parseReviewJSON,
  formatReviewAsMarkdown,
  saveReviewReport,
  createReviewIndex,
  type ReviewResult
} from './bvs-review-formatter'

/**
 * Mapping of reviewer types to agent SDK subagent types
 */
const REVIEWER_AGENT_MAP: Record<BvsReviewerType, string> = {
  correctness: 'work-reviewer-correctness',
  typescript: 'work-reviewer-typescript',
  conventions: 'work-reviewer-conventions',
  simplicity: 'work-reviewer-simplicity',
  security: 'work-reviewer-security',
  performance: 'work-reviewer-performance',
}

/**
 * Review configuration
 */
export interface CodeReviewConfig {
  reviewers: BvsReviewerType[]
  maxFixAttempts: number
  blockOnP0: boolean
  blockOnP1: boolean
  logP2ToFile: boolean
  parallelReviewers: boolean
  reviewNotesPath?: string
  saveMarkdownReports: boolean
  reviewsDir?: string
}

const DEFAULT_REVIEW_CONFIG: CodeReviewConfig = {
  // Security reviewer now enabled by default - OWASP Top 10, secrets detection
  reviewers: ['correctness', 'typescript', 'conventions', 'simplicity', 'security'],
  maxFixAttempts: 2,
  blockOnP0: true,
  blockOnP1: true,
  logP2ToFile: true,
  parallelReviewers: true,
  saveMarkdownReports: true,
}

/**
 * BVS Code Review Service
 */
export class BvsCodeReviewService extends EventEmitter {
  private config: CodeReviewConfig = DEFAULT_REVIEW_CONFIG
  private reviewInProgress: Map<string, boolean> = new Map()

  constructor() {
    super()
  }

  /**
   * Send event to renderer process
   */
  private sendToRenderer(channel: string, data: unknown): void {
    const mainWindow = getMainWindow()
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, data)
    }
  }

  /**
   * Set review configuration
   */
  setConfig(config: Partial<CodeReviewConfig>): void {
    this.config = { ...this.config, ...config }
  }

  /**
   * Run code review on specified files
   *
   * @param projectPath - Project root path
   * @param files - Files to review (relative paths)
   * @param sectionId - Section identifier for tracking
   */
  async runCodeReview(
    projectPath: string,
    files: string[],
    sectionId: string
  ): Promise<BvsCodeReviewResult> {
    // Prevent concurrent reviews on same section
    const reviewKey = `${projectPath}:${sectionId}`
    if (this.reviewInProgress.get(reviewKey)) {
      throw new Error('Code review already in progress for this section')
    }

    this.reviewInProgress.set(reviewKey, true)
    const startTime = Date.now()

    try {
      const reviewerResults: BvsReviewerResult[] = []

      if (this.config.parallelReviewers) {
        // Run reviewers in parallel
        const promises = this.config.reviewers.map(reviewer =>
          this.runSingleReviewer(projectPath, files, reviewer, sectionId)
        )
        const results = await Promise.all(promises)
        reviewerResults.push(...results)
      } else {
        // Run reviewers sequentially
        for (const reviewer of this.config.reviewers) {
          const result = await this.runSingleReviewer(projectPath, files, reviewer, sectionId)
          reviewerResults.push(result)
        }
      }

      // Aggregate results
      const allIssues = reviewerResults.flatMap(r => r.issues)
      const issuesByPriority = this.countIssuesByPriority(allIssues)
      const duration = Date.now() - startTime

      // Determine if review passed (no P0/P1 issues if blocking is enabled)
      let passed = true
      if (this.config.blockOnP0 && issuesByPriority.P0 > 0) {
        passed = false
      }
      if (this.config.blockOnP1 && issuesByPriority.P1 > 0) {
        passed = false
      }

      const result: BvsCodeReviewResult = {
        passed,
        reviewers: reviewerResults,
        totalIssues: allIssues.length,
        issuesByPriority,
        fixAttempts: 0,
        maxFixAttempts: this.config.maxFixAttempts,
        duration,
        completedAt: Date.now(),
      }

      // Save markdown reports if configured
      if (this.config.saveMarkdownReports) {
        await this.saveMarkdownReports(projectPath, sectionId, reviewerResults, files)
      }

      // Log P2 issues to file if configured
      if (this.config.logP2ToFile) {
        const p2Issues = allIssues.filter(i => i.priority === 'P2')
        if (p2Issues.length > 0) {
          await this.logP2Issues(projectPath, sectionId, p2Issues)
        }
      }

      // Emit result event
      this.emit('review-complete', { projectPath, sectionId, result })
      this.sendToRenderer(BVS_IPC_CHANNELS.BVS_EVENT, {
        type: 'code_review',
        sectionId,
        result,
      })

      return result
    } finally {
      this.reviewInProgress.set(reviewKey, false)
    }
  }

  /**
   * Run a single reviewer agent
   *
   * NOTE: This is a placeholder implementation.
   * In the full implementation, this would spawn a Task agent using the Agent SDK.
   */
  private async runSingleReviewer(
    projectPath: string,
    files: string[],
    reviewerType: BvsReviewerType,
    sectionId: string
  ): Promise<BvsReviewerResult> {
    const startTime = Date.now()
    const agentType = REVIEWER_AGENT_MAP[reviewerType]

    // Emit reviewer started event
    this.sendToRenderer(BVS_IPC_CHANNELS.BVS_EVENT, {
      type: 'reviewer_update',
      sectionId,
      reviewer: reviewerType,
      status: 'running',
    })

    try {
      // NOTE: This is where we would spawn the actual Task agent
      // For now, we return a mock result
      //
      // Full implementation would be:
      // const taskResult = await spawnTaskAgent({
      //   subagent_type: agentType,
      //   prompt: buildReviewPrompt(projectPath, files, reviewerType),
      //   run_in_background: false,
      // })
      // const issues = parseReviewerOutput(taskResult.output)

      // Mock implementation - returns empty issues
      const issues: BvsReviewIssue[] = []

      const duration = Date.now() - startTime

      const result: BvsReviewerResult = {
        reviewer: reviewerType,
        status: 'completed',
        issues,
        duration,
        completedAt: Date.now(),
      }

      // Emit reviewer completed event
      this.sendToRenderer(BVS_IPC_CHANNELS.BVS_EVENT, {
        type: 'reviewer_update',
        sectionId,
        reviewer: reviewerType,
        status: 'completed',
        issuesFound: issues.length,
      })

      return result
    } catch (error) {
      const duration = Date.now() - startTime
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'

      // Emit reviewer failed event
      this.sendToRenderer(BVS_IPC_CHANNELS.BVS_EVENT, {
        type: 'reviewer_update',
        sectionId,
        reviewer: reviewerType,
        status: 'failed',
      })

      return {
        reviewer: reviewerType,
        status: 'failed',
        issues: [],
        duration,
        error: errorMessage,
        completedAt: Date.now(),
      }
    }
  }

  /**
   * Build review prompt for agent
   */
  private buildReviewPrompt(
    projectPath: string,
    files: string[],
    reviewerType: BvsReviewerType
  ): string {
    const fileList = files.map(f => `- ${f}`).join('\n')

    const prompts: Record<BvsReviewerType, string> = {
      correctness: `Review the following files for bugs, logic errors, edge cases, and security vulnerabilities.
Focus on:
- Bugs and logic errors
- Unhandled edge cases
- Security vulnerabilities (OWASP Top 10)
- Race conditions and async issues

Files to review:
${fileList}

Report issues with priority (P0=critical, P1=major, P2=minor) and specific line numbers.`,

      typescript: `Review the following files for TypeScript best practices and type safety.
Focus on:
- Type safety issues
- Proper generics usage
- Type narrowing
- Null/undefined safety
- Avoidance of 'any' type

Files to review:
${fileList}

Report issues with priority (P0=critical, P1=major, P2=minor) and specific line numbers.`,

      conventions: `Review the following files for adherence to project conventions.
Focus on:
- Naming conventions
- File structure patterns
- Import order and organization
- Component patterns
- Code organization

Files to review:
${fileList}

Report issues with priority (P0=critical, P1=major, P2=minor) and specific line numbers.`,

      simplicity: `Review the following files for simplicity and code quality.
Focus on:
- DRY principle violations
- Unnecessary complexity
- Readability issues
- Over-engineering
- Missing abstractions or over-abstraction

Files to review:
${fileList}

Report issues with priority (P0=critical, P1=major, P2=minor) and specific line numbers.`,

      security: `Review the following files for security vulnerabilities.
Focus on:
- Injection vulnerabilities (SQL, XSS, command)
- Authentication/authorization issues
- Data exposure risks
- Input validation
- Cryptography issues

Files to review:
${fileList}

Report issues with priority (P0=critical, P1=major, P2=minor) and specific line numbers.`,

      performance: `Review the following files for performance issues.
Focus on:
- N+1 queries
- Unnecessary re-renders
- Memory leaks
- Inefficient algorithms
- Bundle size impact

Files to review:
${fileList}

Report issues with priority (P0=critical, P1=major, P2=minor) and specific line numbers.`,
    }

    return prompts[reviewerType]
  }

  /**
   * Count issues by priority
   */
  private countIssuesByPriority(issues: BvsReviewIssue[]): BvsCodeReviewResult['issuesByPriority'] {
    const counts = { P0: 0, P1: 0, P2: 0 }

    for (const issue of issues) {
      counts[issue.priority]++
    }

    return counts
  }

  /**
   * Log P2 issues to review notes file
   */
  private async logP2Issues(
    projectPath: string,
    sectionId: string,
    issues: BvsReviewIssue[]
  ): Promise<void> {
    const reviewNotesPath = this.config.reviewNotesPath ||
      path.join(projectPath, '.bvs', 'review-notes.md')

    let content = ''
    try {
      content = await fs.readFile(reviewNotesPath, 'utf-8')
    } catch {
      content = '# Code Review Notes\n\nMinor issues noted for future attention.\n\n'
    }

    const timestamp = new Date().toISOString()
    const entry = `## Section: ${sectionId} (${timestamp})

${issues.map(i => `- **${i.reviewer}** [${i.file}:${i.line || '?'}]: ${i.message}`).join('\n')}

---

`

    content += entry
    await fs.writeFile(reviewNotesPath, content)
  }

  /**
   * Save markdown reports for all reviewers
   */
  private async saveMarkdownReports(
    projectPath: string,
    sectionId: string,
    reviewerResults: BvsReviewerResult[],
    files: string[]
  ): Promise<void> {
    const timestamp = Date.now()
    const savedReports: Array<{ reviewer: string; filepath: string; issueCount: number }> = []

    for (const result of reviewerResults) {
      // Only save if we have review data (not a mock/empty result)
      if (!result.reviewData) continue

      try {
        // Parse the review JSON output
        const reviewResult = parseReviewJSON(result.reviewData)
        if (!reviewResult) {
          console.warn(`[BvsCodeReview] Could not parse review data for ${result.reviewer}`)
          continue
        }

        // Format as markdown
        const markdown = formatReviewAsMarkdown(
          result.reviewer,
          reviewResult,
          files,
          {
            sessionId: sectionId,
            sectionId,
            timestamp
          }
        )

        // Save to file
        const filepath = await saveReviewReport(
          projectPath,
          result.reviewer,
          markdown,
          {
            sessionId: sectionId,
            sectionId,
            timestamp
          }
        )

        savedReports.push({
          reviewer: result.reviewer,
          filepath,
          issueCount: reviewResult.issues.length
        })

        console.log(`[BvsCodeReview] Saved ${result.reviewer} review to: ${filepath}`)
      } catch (error) {
        console.error(`[BvsCodeReview] Failed to save markdown for ${result.reviewer}:`, error)
      }
    }

    // Create index file if we saved any reports
    if (savedReports.length > 0) {
      try {
        await createReviewIndex(projectPath, sectionId, savedReports)
        console.log(`[BvsCodeReview] Created review index for session ${sectionId}`)
      } catch (error) {
        console.error('[BvsCodeReview] Failed to create review index:', error)
      }
    }
  }

  /**
   * Parse review output from agent
   *
   * NOTE: This would parse the actual agent output in the full implementation
   */
  private parseReviewerOutput(
    output: string,
    reviewerType: BvsReviewerType
  ): BvsReviewIssue[] {
    const issues: BvsReviewIssue[] = []

    // Parse structured output format
    // Expected format:
    // ISSUE: P0 | file.ts:42 | Message here
    // SUGGESTION: Optional fix suggestion

    const lines = output.split('\n')
    let currentIssue: Partial<BvsReviewIssue> | null = null

    for (const line of lines) {
      if (line.startsWith('ISSUE:')) {
        // Save previous issue
        if (currentIssue && currentIssue.message) {
          issues.push({
            id: `${reviewerType}-${issues.length + 1}`,
            reviewer: reviewerType,
            priority: (currentIssue.priority as BvsReviewPriority) || 'P2',
            file: currentIssue.file || 'unknown',
            line: currentIssue.line,
            message: currentIssue.message,
            suggestion: currentIssue.suggestion,
            fixApplied: false,
          })
        }

        // Parse new issue
        const match = line.match(/^ISSUE:\s*(P[012])\s*\|\s*([^:]+)(?::(\d+))?\s*\|\s*(.+)$/)
        if (match) {
          currentIssue = {
            priority: match[1] as BvsReviewPriority,
            file: match[2].trim(),
            line: match[3] ? parseInt(match[3], 10) : undefined,
            message: match[4].trim(),
          }
        }
      } else if (line.startsWith('SUGGESTION:') && currentIssue) {
        currentIssue.suggestion = line.replace('SUGGESTION:', '').trim()
      }
    }

    // Save last issue
    if (currentIssue && currentIssue.message) {
      issues.push({
        id: `${reviewerType}-${issues.length + 1}`,
        reviewer: reviewerType,
        priority: (currentIssue.priority as BvsReviewPriority) || 'P2',
        file: currentIssue.file || 'unknown',
        line: currentIssue.line,
        message: currentIssue.message,
        suggestion: currentIssue.suggestion,
        fixApplied: false,
      })
    }

    return issues
  }

  /**
   * Check if review is in progress for a section
   */
  isReviewInProgress(projectPath: string, sectionId: string): boolean {
    const reviewKey = `${projectPath}:${sectionId}`
    return this.reviewInProgress.get(reviewKey) || false
  }

  /**
   * Format issues for display
   */
  formatIssuesForDisplay(issues: BvsReviewIssue[]): string {
    if (issues.length === 0) {
      return '✓ No issues found'
    }

    const grouped = new Map<BvsReviewPriority, BvsReviewIssue[]>()
    for (const issue of issues) {
      const existing = grouped.get(issue.priority) || []
      existing.push(issue)
      grouped.set(issue.priority, existing)
    }

    const sections: string[] = []

    for (const priority of ['P0', 'P1', 'P2'] as BvsReviewPriority[]) {
      const priorityIssues = grouped.get(priority)
      if (priorityIssues && priorityIssues.length > 0) {
        sections.push(`\n${priority} Issues (${priorityIssues.length}):`)
        for (const issue of priorityIssues) {
          sections.push(`  [${issue.reviewer}] ${issue.file}:${issue.line || '?'}: ${issue.message}`)
          if (issue.suggestion) {
            sections.push(`    → ${issue.suggestion}`)
          }
        }
      }
    }

    return sections.join('\n')
  }
}

// Singleton instance
let bvsCodeReviewService: BvsCodeReviewService | null = null

export function getBvsCodeReviewService(): BvsCodeReviewService {
  if (!bvsCodeReviewService) {
    bvsCodeReviewService = new BvsCodeReviewService()
  }
  return bvsCodeReviewService
}

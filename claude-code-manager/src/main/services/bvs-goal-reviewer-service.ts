/**
 * BVS Goal Reviewer Service
 *
 * Verifies that implementation matches the ORIGINAL USER INTENT, not just technical correctness.
 * This is different from code review - it checks goal alignment before code quality.
 *
 * Key principle: A feature that builds, passes tests, and has clean code but doesn't
 * do what the user asked for is a FAILURE.
 *
 * Based on OMC's goal-reviewer agent pattern.
 */

import { EventEmitter } from 'events'
import * as path from 'path'
import * as fs from 'fs/promises'
import type { BvsSection, BvsExecutionPlan } from '@shared/bvs-types'

// ============================================================================
// Types
// ============================================================================

export interface GoalReviewResult {
  sectionId: string
  sectionName: string

  // Original requirements
  originalGoal: string
  coreIntent: string

  // Requirements coverage
  requirements: RequirementStatus[]
  coveragePercent: number

  // Scope analysis
  scopeCreep: ScopeIssue[]  // Features added but not requested
  scopeReduction: ScopeIssue[]  // Features requested but missing

  // Technical verification (brief)
  buildPasses: boolean
  testsPassing: boolean

  // Final verdict
  verdict: 'APPROVED' | 'REJECTED' | 'PARTIAL'
  reasoning: string
  issuestoFix: string[]

  // Metadata
  reviewedAt: number
  reviewDurationMs: number
}

export interface RequirementStatus {
  id: string
  description: string
  priority: 'must' | 'should' | 'could'
  status: 'implemented' | 'missing' | 'partial'
  location?: string  // file:line if found
  testLocation?: string  // test file:line if tested
  evidence?: string  // How we verified
}

export interface ScopeIssue {
  description: string
  location?: string
  severity: 'critical' | 'important' | 'minor'
  impact: string
}

export interface GoalReviewConfig {
  requireAllMust: boolean  // All MUST requirements must be implemented
  shouldThreshold: number  // Percent of SHOULD requirements (default 80%)
  runBuildCheck: boolean
  runTestCheck: boolean
  maxReviewTimeMs: number
}

const DEFAULT_CONFIG: GoalReviewConfig = {
  requireAllMust: true,
  shouldThreshold: 80,
  runBuildCheck: true,
  runTestCheck: true,
  maxReviewTimeMs: 60000,
}

// ============================================================================
// Goal Reviewer Service
// ============================================================================

export class BvsGoalReviewerService extends EventEmitter {
  private config: GoalReviewConfig = DEFAULT_CONFIG

  constructor() {
    super()
  }

  /**
   * Set configuration
   */
  setConfig(config: Partial<GoalReviewConfig>): void {
    this.config = { ...this.config, ...config }
  }

  /**
   * Review a section's implementation against its stated goals
   *
   * This should run BEFORE code review to ensure we're building the right thing.
   */
  async reviewSection(
    section: BvsSection,
    plan: BvsExecutionPlan,
    projectPath: string,
    filesChanged: string[]
  ): Promise<GoalReviewResult> {
    const startTime = Date.now()
    console.log(`[GoalReviewer] Reviewing section: ${section.name}`)

    // Extract original goal from section description
    const originalGoal = section.description || section.name
    const coreIntent = this.extractCoreIntent(section)

    // Extract requirements from success criteria
    const requirements = this.extractRequirements(section)

    // Check each requirement against implementation
    const checkedRequirements = await this.checkRequirements(
      requirements,
      projectPath,
      filesChanged
    )

    // Calculate coverage
    const implemented = checkedRequirements.filter(r => r.status === 'implemented').length
    const coveragePercent = Math.round((implemented / checkedRequirements.length) * 100)

    // Detect scope issues
    const scopeCreep = await this.detectScopeCreep(section, projectPath, filesChanged)
    const scopeReduction = this.detectScopeReduction(checkedRequirements)

    // Run technical verification
    let buildPasses = true
    let testsPassing = true

    if (this.config.runBuildCheck) {
      buildPasses = await this.checkBuild(projectPath)
    }
    if (this.config.runTestCheck) {
      testsPassing = await this.checkTests(projectPath)
    }

    // Determine verdict
    const { verdict, reasoning, issuestoFix } = this.determineVerdict(
      checkedRequirements,
      scopeReduction,
      buildPasses,
      testsPassing
    )

    const result: GoalReviewResult = {
      sectionId: section.id,
      sectionName: section.name,
      originalGoal,
      coreIntent,
      requirements: checkedRequirements,
      coveragePercent,
      scopeCreep,
      scopeReduction,
      buildPasses,
      testsPassing,
      verdict,
      reasoning,
      issuestoFix,
      reviewedAt: Date.now(),
      reviewDurationMs: Date.now() - startTime,
    }

    console.log(`[GoalReviewer] Verdict: ${verdict} (${coveragePercent}% coverage)`)
    if (issuestoFix.length > 0) {
      console.log(`[GoalReviewer] Issues to fix:`, issuestoFix)
    }

    this.emit('goal-review-complete', result)
    return result
  }

  /**
   * Extract the core intent from a section
   */
  private extractCoreIntent(section: BvsSection): string {
    // Try to summarize what the section is actually trying to achieve
    const desc = section.description || ''
    const name = section.name || ''

    // Extract key action verbs and objects
    const combined = `${name}. ${desc}`

    // Simple summarization - in production you'd use AI for this
    if (combined.length > 200) {
      return combined.substring(0, 200) + '...'
    }
    return combined
  }

  /**
   * Extract requirements from section success criteria
   */
  private extractRequirements(section: BvsSection): RequirementStatus[] {
    const requirements: RequirementStatus[] = []

    // Convert success criteria to requirements
    for (let i = 0; i < section.successCriteria.length; i++) {
      const criterion = section.successCriteria[i]
      const desc = typeof criterion === 'string' ? criterion : criterion.description

      // Determine priority based on keywords
      let priority: 'must' | 'should' | 'could' = 'must'
      const lowerDesc = desc.toLowerCase()
      if (lowerDesc.includes('should') || lowerDesc.includes('recommend')) {
        priority = 'should'
      } else if (lowerDesc.includes('could') || lowerDesc.includes('optional') || lowerDesc.includes('nice to have')) {
        priority = 'could'
      }

      requirements.push({
        id: `R${i + 1}`,
        description: desc,
        priority,
        status: 'missing',  // Will be updated by checkRequirements
      })
    }

    // Also add file requirements
    for (const file of section.files) {
      requirements.push({
        id: `F${requirements.length + 1}`,
        description: `${file.action}: ${file.path}`,
        priority: 'must',
        status: 'missing',
      })
    }

    return requirements
  }

  /**
   * Check requirements against actual implementation
   */
  private async checkRequirements(
    requirements: RequirementStatus[],
    projectPath: string,
    filesChanged: string[]
  ): Promise<RequirementStatus[]> {
    const checked = [...requirements]

    for (const req of checked) {
      // Check file requirements
      if (req.id.startsWith('F')) {
        const filePath = req.description.split(': ')[1]
        if (filePath) {
          const fullPath = path.join(projectPath, filePath)
          try {
            await fs.access(fullPath)
            req.status = 'implemented'
            req.location = filePath
            req.evidence = 'File exists'
          } catch {
            req.status = 'missing'
            req.evidence = 'File not found'
          }
        }
      } else {
        // For criteria requirements, check if related files were changed
        // This is a simplified check - in production you'd use AI to verify
        const hasRelatedChanges = filesChanged.length > 0
        if (hasRelatedChanges) {
          req.status = 'implemented'
          req.location = filesChanged[0]
          req.evidence = 'Related files were modified'
        }
      }
    }

    return checked
  }

  /**
   * Detect scope creep - features added but not requested
   */
  private async detectScopeCreep(
    section: BvsSection,
    projectPath: string,
    filesChanged: string[]
  ): Promise<ScopeIssue[]> {
    const issues: ScopeIssue[] = []

    // Check if files were changed that weren't in the plan
    const plannedFiles = section.files.map(f => f.path)

    for (const file of filesChanged) {
      const normalizedFile = file.replace(/\\/g, '/')
      const isPlanned = plannedFiles.some(pf =>
        normalizedFile.includes(pf) || pf.includes(normalizedFile)
      )

      if (!isPlanned) {
        // Check if it's a related file (test, type, etc.)
        const isRelated =
          normalizedFile.includes('.test.') ||
          normalizedFile.includes('.spec.') ||
          normalizedFile.includes('types')

        if (!isRelated) {
          issues.push({
            description: `Unplanned file modified: ${file}`,
            location: file,
            severity: 'minor',
            impact: 'File was changed but not in section plan',
          })
        }
      }
    }

    return issues
  }

  /**
   * Detect scope reduction - features requested but missing
   */
  private detectScopeReduction(requirements: RequirementStatus[]): ScopeIssue[] {
    const issues: ScopeIssue[] = []

    for (const req of requirements) {
      if (req.status === 'missing') {
        issues.push({
          description: `Missing requirement: ${req.description}`,
          severity: req.priority === 'must' ? 'critical' : 'important',
          impact: `Requirement ${req.id} not implemented`,
        })
      } else if (req.status === 'partial') {
        issues.push({
          description: `Partial implementation: ${req.description}`,
          location: req.location,
          severity: req.priority === 'must' ? 'important' : 'minor',
          impact: `Requirement ${req.id} only partially implemented`,
        })
      }
    }

    return issues
  }

  /**
   * Check if build passes
   */
  private async checkBuild(projectPath: string): Promise<boolean> {
    try {
      const { exec } = await import('child_process')
      const { promisify } = await import('util')
      const execAsync = promisify(exec)

      await execAsync('npm run build', {
        cwd: projectPath,
        timeout: 60000,
      })
      return true
    } catch {
      return false
    }
  }

  /**
   * Check if tests pass
   */
  private async checkTests(projectPath: string): Promise<boolean> {
    try {
      const { exec } = await import('child_process')
      const { promisify } = await import('util')
      const execAsync = promisify(exec)

      await execAsync('npm test', {
        cwd: projectPath,
        timeout: 120000,
      })
      return true
    } catch {
      return false
    }
  }

  /**
   * Determine final verdict
   */
  private determineVerdict(
    requirements: RequirementStatus[],
    scopeReduction: ScopeIssue[],
    buildPasses: boolean,
    testsPassing: boolean
  ): { verdict: 'APPROVED' | 'REJECTED' | 'PARTIAL'; reasoning: string; issuestoFix: string[] } {
    const issuestoFix: string[] = []

    // Check MUST requirements
    const mustRequirements = requirements.filter(r => r.priority === 'must')
    const mustImplemented = mustRequirements.filter(r => r.status === 'implemented')
    const mustMissing = mustRequirements.filter(r => r.status === 'missing')

    // Check SHOULD requirements
    const shouldRequirements = requirements.filter(r => r.priority === 'should')
    const shouldImplemented = shouldRequirements.filter(r => r.status === 'implemented')
    const shouldPercent = shouldRequirements.length > 0
      ? (shouldImplemented.length / shouldRequirements.length) * 100
      : 100

    // Critical issues
    const criticalScopeIssues = scopeReduction.filter(s => s.severity === 'critical')

    // Build issues list
    for (const req of mustMissing) {
      issuestoFix.push(`MUST: ${req.description}`)
    }
    for (const issue of criticalScopeIssues) {
      issuestoFix.push(`CRITICAL: ${issue.description}`)
    }
    if (!buildPasses) {
      issuestoFix.push('Build is failing')
    }
    if (!testsPassing) {
      issuestoFix.push('Tests are failing')
    }

    // Determine verdict
    if (mustMissing.length > 0 || criticalScopeIssues.length > 0) {
      return {
        verdict: 'REJECTED',
        reasoning: `${mustMissing.length} MUST requirements missing, ${criticalScopeIssues.length} critical scope issues`,
        issuestoFix,
      }
    }

    if (shouldPercent < this.config.shouldThreshold) {
      return {
        verdict: 'PARTIAL',
        reasoning: `Only ${Math.round(shouldPercent)}% of SHOULD requirements implemented (need ${this.config.shouldThreshold}%)`,
        issuestoFix,
      }
    }

    if (!buildPasses || !testsPassing) {
      return {
        verdict: 'PARTIAL',
        reasoning: `Technical verification failed: build=${buildPasses}, tests=${testsPassing}`,
        issuestoFix,
      }
    }

    return {
      verdict: 'APPROVED',
      reasoning: `All MUST requirements implemented, ${Math.round(shouldPercent)}% of SHOULD requirements met`,
      issuestoFix: [],
    }
  }

  /**
   * Format review result as markdown
   */
  formatAsMarkdown(result: GoalReviewResult): string {
    const lines: string[] = [
      '# Goal Alignment Review',
      '',
      `## Section: ${result.sectionName}`,
      '',
      '## Original Goal',
      `"${result.originalGoal}"`,
      '',
      `**Core Intent:** ${result.coreIntent}`,
      '',
      '## Requirements Coverage',
      '',
      '| ID | Requirement | Priority | Status | Location |',
      '|----|-------------|----------|--------|----------|',
    ]

    for (const req of result.requirements) {
      const statusIcon = req.status === 'implemented' ? '✅' : req.status === 'partial' ? '⚠️' : '❌'
      lines.push(`| ${req.id} | ${req.description.substring(0, 50)} | ${req.priority} | ${statusIcon} | ${req.location || '-'} |`)
    }

    lines.push('')
    lines.push(`**Coverage:** ${result.coveragePercent}%`)
    lines.push('')

    if (result.scopeCreep.length > 0) {
      lines.push('## Scope Creep (unauthorized additions)')
      for (const issue of result.scopeCreep) {
        lines.push(`- ${issue.description}`)
      }
      lines.push('')
    }

    if (result.scopeReduction.length > 0) {
      lines.push('## Scope Reduction (missing requirements)')
      for (const issue of result.scopeReduction) {
        lines.push(`- [${issue.severity.toUpperCase()}] ${issue.description}`)
      }
      lines.push('')
    }

    lines.push('## Technical Status')
    lines.push(`- Build: ${result.buildPasses ? '✅' : '❌'}`)
    lines.push(`- Tests: ${result.testsPassing ? '✅' : '❌'}`)
    lines.push('')

    lines.push('## Goal Alignment Verdict')
    lines.push('')
    lines.push(`**${result.verdict}**`)
    lines.push('')
    lines.push(`**Reasoning:** ${result.reasoning}`)
    lines.push('')

    if (result.issuestoFix.length > 0) {
      lines.push('**Issues to fix:**')
      for (let i = 0; i < result.issuestoFix.length; i++) {
        lines.push(`${i + 1}. ${result.issuestoFix[i]}`)
      }
    }

    return lines.join('\n')
  }
}

// Export singleton
export const goalReviewer = new BvsGoalReviewerService()

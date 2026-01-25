/**
 * BVS Complexity & Risk Assessment Service
 *
 * Implements:
 * - F0.8 - Complexity Estimator (estimate time/effort per section)
 * - F0.9 - Risk Assessment (identify high-risk sections)
 */

import { EventEmitter } from 'events'
import * as path from 'path'
import * as fs from 'fs/promises'
import {
  type BvsSection,
  type BvsFileInfo,
  type BvsExecutionPlan,
} from '@shared/bvs-types'

// ============================================================================
// Types
// ============================================================================

export interface ComplexityFactors {
  linesOfCode: number
  fileCount: number
  dependencyCount: number
  cyclomaticComplexity: number
  hasTests: boolean
  hasTypes: boolean
  isNewFile: boolean
  touchesApi: boolean
  touchesDb: boolean
  touchesAuth: boolean
}

export interface ComplexityEstimate {
  sectionId: string
  level: 'low' | 'medium' | 'high'
  score: number // 0-100
  factors: ComplexityFactors
  estimatedMinutes: number
  confidence: number // 0-1
  breakdown: {
    factor: string
    contribution: number
    reason: string
  }[]
}

export interface RiskFactor {
  category: 'security' | 'data' | 'integration' | 'breaking' | 'performance' | 'complexity'
  severity: 'low' | 'medium' | 'high' | 'critical'
  description: string
  affectedFiles: string[]
  mitigation: string
}

export interface RiskAssessment {
  sectionId: string
  overallRisk: 'low' | 'medium' | 'high' | 'critical'
  riskScore: number // 0-100
  factors: RiskFactor[]
  requiresReview: boolean
  reviewReasons: string[]
  recommendations: string[]
}

export interface PlanRiskSummary {
  totalSections: number
  criticalRiskSections: number
  highRiskSections: number
  mediumRiskSections: number
  lowRiskSections: number
  topRisks: RiskFactor[]
  recommendations: string[]
}

// ============================================================================
// Complexity Estimator
// ============================================================================

export class BvsComplexityEstimator {
  // Weights for complexity factors
  private readonly weights = {
    linesOfCode: 0.15,
    fileCount: 0.10,
    dependencyCount: 0.10,
    cyclomaticComplexity: 0.15,
    hasTests: -0.05, // Reduces complexity (good)
    hasTypes: -0.05, // Reduces complexity (good)
    isNewFile: 0.10,
    touchesApi: 0.15,
    touchesDb: 0.15,
    touchesAuth: 0.10,
  }

  // Base time estimates per complexity level (minutes)
  private readonly baseMinutes = {
    low: 15,
    medium: 45,
    high: 120,
  }

  /**
   * F0.8 - Estimate complexity for a section
   */
  async estimateSection(
    section: BvsSection,
    projectPath: string
  ): Promise<ComplexityEstimate> {
    const factors = await this.analyzeFactors(section, projectPath)
    const score = this.calculateScore(factors)
    const level = this.scoreToLevel(score)
    const breakdown = this.generateBreakdown(factors)

    // Estimate minutes based on complexity and file count
    const baseTime = this.baseMinutes[level]
    const fileMultiplier = Math.max(1, Math.log2(section.files.length + 1))
    const estimatedMinutes = Math.round(baseTime * fileMultiplier)

    return {
      sectionId: section.id,
      level,
      score,
      factors,
      estimatedMinutes,
      confidence: this.calculateConfidence(factors),
      breakdown,
    }
  }

  /**
   * Estimate complexity for entire plan
   */
  async estimatePlan(
    plan: BvsExecutionPlan,
    projectPath: string
  ): Promise<{
    estimates: ComplexityEstimate[]
    totalMinutes: number
    parallelMinutes: number
    averageComplexity: number
  }> {
    const estimates = await Promise.all(
      plan.sections.map(s => this.estimateSection(s, projectPath))
    )

    const totalMinutes = estimates.reduce((sum, e) => sum + e.estimatedMinutes, 0)
    // Guard against division by zero when estimates array is empty
    const averageComplexity = estimates.length > 0
      ? estimates.reduce((sum, e) => sum + e.score, 0) / estimates.length
      : 0

    // Calculate parallel time (assumes max 5 workers)
    const parallelMinutes = this.calculateParallelTime(estimates, plan.sections, 5)

    return {
      estimates,
      totalMinutes,
      parallelMinutes,
      averageComplexity,
    }
  }

  /**
   * Analyze complexity factors for a section
   */
  private async analyzeFactors(
    section: BvsSection,
    projectPath: string
  ): Promise<ComplexityFactors> {
    let totalLines = 0
    let hasTests = false
    let hasTypes = false
    let isNewFile = false
    let touchesApi = false
    let touchesDb = false
    let touchesAuth = false
    let totalComplexity = 0

    for (const file of section.files) {
      const fullPath = path.join(projectPath, file.path)

      try {
        const content = await fs.readFile(fullPath, 'utf-8')
        const lines = content.split('\n').length
        totalLines += lines

        // Check for types
        if (file.path.endsWith('.ts') || file.path.endsWith('.tsx')) {
          hasTypes = true
        }

        // Check for tests
        if (file.path.includes('.test.') || file.path.includes('.spec.') || file.path.includes('__tests__')) {
          hasTests = true
        }

        // Check for API touches
        if (content.includes('fetch(') || content.includes('axios') ||
            file.path.includes('/api/') || content.includes('API_URL')) {
          touchesApi = true
        }

        // Check for DB touches
        if (content.includes('prisma') || content.includes('database') ||
            content.includes('supabase') || content.includes('.query(') ||
            content.includes('SELECT') || content.includes('INSERT')) {
          touchesDb = true
        }

        // Check for auth touches
        if (content.includes('auth') || content.includes('session') ||
            content.includes('token') || content.includes('password') ||
            content.includes('login') || content.includes('jwt')) {
          touchesAuth = true
        }

        // Simple cyclomatic complexity estimate
        totalComplexity += this.estimateCyclomaticComplexity(content)
      } catch {
        // File doesn't exist = new file
        isNewFile = true
      }
    }

    return {
      linesOfCode: totalLines,
      fileCount: section.files.length,
      dependencyCount: section.dependencies.length,
      cyclomaticComplexity: totalComplexity,
      hasTests,
      hasTypes,
      isNewFile,
      touchesApi,
      touchesDb,
      touchesAuth,
    }
  }

  /**
   * Estimate cyclomatic complexity from code content
   */
  private estimateCyclomaticComplexity(content: string): number {
    let complexity = 1 // Base complexity

    // Count decision points
    const patterns = [
      /\bif\s*\(/g,
      /\belse\s+if\s*\(/g,
      /\bfor\s*\(/g,
      /\bwhile\s*\(/g,
      /\bswitch\s*\(/g,
      /\bcase\s+/g,
      /\bcatch\s*\(/g,
      /\?\?/g, // Nullish coalescing
      /\?(?!\?)/g, // Ternary (exclude ??)
      /&&/g,
      /\|\|/g,
    ]

    for (const pattern of patterns) {
      const matches = content.match(pattern)
      if (matches) {
        complexity += matches.length
      }
    }

    return complexity
  }

  /**
   * Calculate complexity score from factors
   */
  private calculateScore(factors: ComplexityFactors): number {
    let score = 0

    // Lines of code (normalize to 0-20)
    score += Math.min(20, factors.linesOfCode / 100) * this.weights.linesOfCode * 100

    // File count (normalize to 0-15)
    score += Math.min(15, factors.fileCount * 3) * this.weights.fileCount * 100

    // Dependencies
    score += Math.min(10, factors.dependencyCount * 2) * this.weights.dependencyCount * 100

    // Cyclomatic complexity (normalize to 0-30)
    score += Math.min(30, factors.cyclomaticComplexity / 10) * this.weights.cyclomaticComplexity * 100

    // Boolean factors
    if (factors.hasTests) score -= 5
    if (factors.hasTypes) score -= 5
    if (factors.isNewFile) score += 10
    if (factors.touchesApi) score += 15
    if (factors.touchesDb) score += 15
    if (factors.touchesAuth) score += 10

    return Math.max(0, Math.min(100, score))
  }

  /**
   * Convert score to level
   */
  private scoreToLevel(score: number): 'low' | 'medium' | 'high' {
    if (score < 33) return 'low'
    if (score < 66) return 'medium'
    return 'high'
  }

  /**
   * Generate breakdown of contributing factors
   */
  private generateBreakdown(factors: ComplexityFactors): ComplexityEstimate['breakdown'] {
    const breakdown: ComplexityEstimate['breakdown'] = []

    if (factors.linesOfCode > 200) {
      breakdown.push({
        factor: 'Lines of Code',
        contribution: Math.min(20, factors.linesOfCode / 100),
        reason: `${factors.linesOfCode} lines to review/modify`,
      })
    }

    if (factors.fileCount > 3) {
      breakdown.push({
        factor: 'File Count',
        contribution: factors.fileCount * 3,
        reason: `${factors.fileCount} files need coordination`,
      })
    }

    if (factors.cyclomaticComplexity > 20) {
      breakdown.push({
        factor: 'Code Complexity',
        contribution: factors.cyclomaticComplexity / 10,
        reason: `High cyclomatic complexity (${factors.cyclomaticComplexity})`,
      })
    }

    if (factors.touchesApi) {
      breakdown.push({
        factor: 'API Integration',
        contribution: 15,
        reason: 'Involves API calls that need testing',
      })
    }

    if (factors.touchesDb) {
      breakdown.push({
        factor: 'Database Operations',
        contribution: 15,
        reason: 'Database changes require careful handling',
      })
    }

    if (factors.touchesAuth) {
      breakdown.push({
        factor: 'Authentication',
        contribution: 10,
        reason: 'Auth changes are security-sensitive',
      })
    }

    if (factors.isNewFile) {
      breakdown.push({
        factor: 'New Files',
        contribution: 10,
        reason: 'Creating new files from scratch',
      })
    }

    return breakdown
  }

  /**
   * Calculate confidence based on available data
   */
  private calculateConfidence(factors: ComplexityFactors): number {
    let confidence = 0.5 // Base confidence

    if (factors.hasTypes) confidence += 0.15
    if (factors.hasTests) confidence += 0.15
    if (factors.linesOfCode > 0) confidence += 0.1
    if (!factors.isNewFile) confidence += 0.1

    return Math.min(1, confidence)
  }

  /**
   * Calculate parallel execution time
   */
  private calculateParallelTime(
    estimates: ComplexityEstimate[],
    sections: BvsSection[],
    maxWorkers: number
  ): number {
    // Simple simulation - could be more sophisticated
    const sectionMap = new Map<string, BvsSection>()
    const estimateMap = new Map<string, ComplexityEstimate>()

    for (const section of sections) {
      sectionMap.set(section.id, section)
    }
    for (const estimate of estimates) {
      estimateMap.set(estimate.sectionId, estimate)
    }

    // Group by dependency level
    const levels: string[][] = []
    const assigned = new Set<string>()

    while (assigned.size < sections.length) {
      const currentLevel: string[] = []

      for (const section of sections) {
        if (assigned.has(section.id)) continue

        const depsResolved = section.dependencies.every(d => assigned.has(d))
        if (depsResolved) {
          currentLevel.push(section.id)
        }
      }

      if (currentLevel.length === 0) break // Circular dependency

      levels.push(currentLevel)
      currentLevel.forEach(id => assigned.add(id))
    }

    // Calculate time per level (max of parallel tasks, limited by workers)
    let totalTime = 0

    for (const level of levels) {
      const levelEstimates = level.map(id => estimateMap.get(id)?.estimatedMinutes || 30)

      // Sort descending and sum the top N (where N = maxWorkers)
      levelEstimates.sort((a, b) => b - a)

      // Time for this level is max of parallel batches
      let levelTime = 0
      for (let i = 0; i < levelEstimates.length; i += maxWorkers) {
        const batch = levelEstimates.slice(i, i + maxWorkers)
        levelTime += Math.max(...batch)
      }

      totalTime += levelTime
    }

    return totalTime
  }
}

// ============================================================================
// Risk Assessment
// ============================================================================

export class BvsRiskAssessor {
  /**
   * F0.9 - Assess risk for a section
   */
  async assessSection(
    section: BvsSection,
    projectPath: string
  ): Promise<RiskAssessment> {
    const factors: RiskFactor[] = []
    const reviewReasons: string[] = []

    // Analyze each file for risks
    for (const file of section.files) {
      const fileRisks = await this.analyzeFileRisks(file, projectPath)
      factors.push(...fileRisks)
    }

    // Check for section-level risks
    if (section.dependencies.length > 3) {
      factors.push({
        category: 'complexity',
        severity: 'medium',
        description: 'High number of dependencies increases integration risk',
        affectedFiles: section.files.map(f => f.path),
        mitigation: 'Test integration points thoroughly',
      })
    }

    // Calculate overall risk
    const riskScore = this.calculateRiskScore(factors)
    const overallRisk = this.scoreToRiskLevel(riskScore)

    // Determine if review is required
    const requiresReview = overallRisk === 'high' || overallRisk === 'critical' ||
      factors.some(f => f.severity === 'critical' || f.category === 'security')

    if (requiresReview) {
      if (factors.some(f => f.category === 'security')) {
        reviewReasons.push('Contains security-sensitive code')
      }
      if (factors.some(f => f.category === 'data')) {
        reviewReasons.push('Involves data operations')
      }
      if (overallRisk === 'critical') {
        reviewReasons.push('Critical risk level')
      }
    }

    return {
      sectionId: section.id,
      overallRisk,
      riskScore,
      factors,
      requiresReview,
      reviewReasons,
      recommendations: this.generateRecommendations(factors),
    }
  }

  /**
   * Assess risk for entire plan
   */
  async assessPlan(
    plan: BvsExecutionPlan,
    projectPath: string
  ): Promise<{
    assessments: RiskAssessment[]
    summary: PlanRiskSummary
  }> {
    const assessments = await Promise.all(
      plan.sections.map(s => this.assessSection(s, projectPath))
    )

    const summary: PlanRiskSummary = {
      totalSections: plan.sections.length,
      criticalRiskSections: assessments.filter(a => a.overallRisk === 'critical').length,
      highRiskSections: assessments.filter(a => a.overallRisk === 'high').length,
      mediumRiskSections: assessments.filter(a => a.overallRisk === 'medium').length,
      lowRiskSections: assessments.filter(a => a.overallRisk === 'low').length,
      topRisks: this.getTopRisks(assessments),
      recommendations: this.getPlanRecommendations(assessments),
    }

    return { assessments, summary }
  }

  /**
   * Analyze risks for a single file
   */
  private async analyzeFileRisks(
    file: BvsFileInfo,
    projectPath: string
  ): Promise<RiskFactor[]> {
    const risks: RiskFactor[] = []
    const fullPath = path.join(projectPath, file.path)

    try {
      const content = await fs.readFile(fullPath, 'utf-8')

      // Security risks
      if (this.detectSecurityPatterns(content)) {
        risks.push({
          category: 'security',
          severity: 'high',
          description: 'Contains security-sensitive patterns (auth, tokens, passwords)',
          affectedFiles: [file.path],
          mitigation: 'Ensure proper input validation and secure handling',
        })
      }

      // SQL injection risk
      if (this.detectSqlInjectionRisk(content)) {
        risks.push({
          category: 'security',
          severity: 'critical',
          description: 'Potential SQL injection vulnerability (string concatenation in queries)',
          affectedFiles: [file.path],
          mitigation: 'Use parameterized queries',
        })
      }

      // Data integrity risks
      if (this.detectDataRisks(content)) {
        risks.push({
          category: 'data',
          severity: 'high',
          description: 'Database operations that could affect data integrity',
          affectedFiles: [file.path],
          mitigation: 'Add transactions and proper error handling',
        })
      }

      // Breaking change risks
      if (this.detectBreakingChanges(content, file.path)) {
        risks.push({
          category: 'breaking',
          severity: 'medium',
          description: 'Changes to exported APIs or shared interfaces',
          affectedFiles: [file.path],
          mitigation: 'Check for dependent code and update accordingly',
        })
      }

      // Performance risks
      if (this.detectPerformanceRisks(content)) {
        risks.push({
          category: 'performance',
          severity: 'medium',
          description: 'Potential performance issues (loops, large data operations)',
          affectedFiles: [file.path],
          mitigation: 'Consider pagination, caching, or optimization',
        })
      }
    } catch {
      // New file - lower risk
      risks.push({
        category: 'integration',
        severity: 'low',
        description: 'New file creation requires proper integration',
        affectedFiles: [file.path],
        mitigation: 'Ensure proper exports and imports',
      })
    }

    return risks
  }

  /**
   * Detect security-sensitive patterns
   */
  private detectSecurityPatterns(content: string): boolean {
    const patterns = [
      /password/i,
      /secret/i,
      /api[_-]?key/i,
      /private[_-]?key/i,
      /token/i,
      /auth/i,
      /credential/i,
      /\bsession\b/i,
    ]
    return patterns.some(p => p.test(content))
  }

  /**
   * Detect SQL injection risks
   */
  private detectSqlInjectionRisk(content: string): boolean {
    // Look for string concatenation in SQL-like strings
    const patterns = [
      /["'`]\s*SELECT.*\+/i,
      /["'`]\s*INSERT.*\+/i,
      /["'`]\s*UPDATE.*\+/i,
      /["'`]\s*DELETE.*\+/i,
      /\$\{.*\}.*(?:SELECT|INSERT|UPDATE|DELETE)/i,
    ]
    return patterns.some(p => p.test(content))
  }

  /**
   * Detect data integrity risks
   */
  private detectDataRisks(content: string): boolean {
    const patterns = [
      /\.delete\(/i,
      /\.update\(/i,
      /\.destroy\(/i,
      /DELETE\s+FROM/i,
      /DROP\s+TABLE/i,
      /TRUNCATE/i,
    ]
    return patterns.some(p => p.test(content))
  }

  /**
   * Detect breaking change risks
   */
  private detectBreakingChanges(content: string, filePath: string): boolean {
    // Check if file is likely exported/shared
    const isSharedFile = filePath.includes('shared') ||
      filePath.includes('types') ||
      filePath.includes('api') ||
      filePath.includes('lib')

    // Check for export patterns
    const hasExports = /export\s+(const|function|class|interface|type)/i.test(content)

    return isSharedFile && hasExports
  }

  /**
   * Detect performance risks
   */
  private detectPerformanceRisks(content: string): boolean {
    const patterns = [
      /for\s*\([^)]*\)\s*\{[^}]*for\s*\(/i, // Nested loops
      /\.forEach\([^)]*\.forEach/i, // Nested forEach
      /\.map\([^)]*\.map/i, // Nested map
      /while\s*\(true\)/i, // Infinite loop pattern
      /new\s+Array\s*\(\s*\d{6,}\s*\)/i, // Large array allocation
    ]
    return patterns.some(p => p.test(content))
  }

  /**
   * Calculate risk score from factors
   */
  private calculateRiskScore(factors: RiskFactor[]): number {
    if (factors.length === 0) return 0

    const severityScores = {
      low: 10,
      medium: 30,
      high: 60,
      critical: 100,
    }

    const categoryWeights = {
      security: 1.5,
      data: 1.3,
      integration: 1.0,
      breaking: 1.2,
      performance: 0.8,
      complexity: 0.7,
    }

    let totalScore = 0
    for (const factor of factors) {
      const baseScore = severityScores[factor.severity]
      const weight = categoryWeights[factor.category]
      totalScore += baseScore * weight
    }

    // Normalize to 0-100
    return Math.min(100, totalScore / factors.length)
  }

  /**
   * Convert score to risk level
   */
  private scoreToRiskLevel(score: number): 'low' | 'medium' | 'high' | 'critical' {
    if (score < 20) return 'low'
    if (score < 45) return 'medium'
    if (score < 70) return 'high'
    return 'critical'
  }

  /**
   * Generate recommendations based on risks
   */
  private generateRecommendations(factors: RiskFactor[]): string[] {
    const recommendations: string[] = []

    const hasSecurityRisk = factors.some(f => f.category === 'security')
    const hasDataRisk = factors.some(f => f.category === 'data')
    const hasPerformanceRisk = factors.some(f => f.category === 'performance')
    const hasBreakingRisk = factors.some(f => f.category === 'breaking')

    if (hasSecurityRisk) {
      recommendations.push('Run security-focused code review (work-reviewer-security)')
      recommendations.push('Add input validation tests')
    }

    if (hasDataRisk) {
      recommendations.push('Add database transaction handling')
      recommendations.push('Create backup before running migrations')
    }

    if (hasPerformanceRisk) {
      recommendations.push('Add performance benchmarks')
      recommendations.push('Consider lazy loading or pagination')
    }

    if (hasBreakingRisk) {
      recommendations.push('Check for dependent code')
      recommendations.push('Consider versioning or deprecation notices')
    }

    return recommendations
  }

  /**
   * Get top risks across all assessments
   */
  private getTopRisks(assessments: RiskAssessment[]): RiskFactor[] {
    const allFactors = assessments.flatMap(a => a.factors)

    // Sort by severity and return top 5
    return allFactors
      .sort((a, b) => {
        const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 }
        return severityOrder[a.severity] - severityOrder[b.severity]
      })
      .slice(0, 5)
  }

  /**
   * Generate plan-level recommendations
   */
  private getPlanRecommendations(assessments: RiskAssessment[]): string[] {
    const recommendations: string[] = []

    const criticalCount = assessments.filter(a => a.overallRisk === 'critical').length
    const highCount = assessments.filter(a => a.overallRisk === 'high').length
    const reviewRequired = assessments.filter(a => a.requiresReview).length

    if (criticalCount > 0) {
      recommendations.push(`${criticalCount} sections have critical risk - consider breaking into smaller pieces`)
    }

    if (highCount > 2) {
      recommendations.push('Multiple high-risk sections - run sequentially instead of parallel')
    }

    if (reviewRequired > assessments.length / 2) {
      recommendations.push('Many sections require review - schedule additional review time')
    }

    return recommendations
  }
}

// ============================================================================
// Singleton instances
// ============================================================================

let complexityEstimator: BvsComplexityEstimator | null = null
let riskAssessor: BvsRiskAssessor | null = null

export function getBvsComplexityEstimator(): BvsComplexityEstimator {
  if (!complexityEstimator) {
    complexityEstimator = new BvsComplexityEstimator()
  }
  return complexityEstimator
}

export function getBvsRiskAssessor(): BvsRiskAssessor {
  if (!riskAssessor) {
    riskAssessor = new BvsRiskAssessor()
  }
  return riskAssessor
}

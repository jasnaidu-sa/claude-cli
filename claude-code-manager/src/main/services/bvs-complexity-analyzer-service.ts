/**
 * BVS Complexity Analyzer Service
 *
 * Analyzes section complexity to determine:
 * - Which model to use (Haiku for simple, Sonnet for complex)
 * - How many turns to allow for execution
 * - Risk factors that may require additional attention
 */

import type { BvsSection } from '../../shared/bvs-types'
import { getBvsLearningCaptureService } from './bvs-learning-capture-service'

// ============================================================================
// Constants
// ============================================================================

export const BVS_MODELS = {
  HAIKU: 'claude-haiku-4-20250514',
  SONNET: 'claude-sonnet-4-20250514',
} as const

export type BvsModelId = typeof BVS_MODELS[keyof typeof BVS_MODELS]

// Complexity thresholds
const HAIKU_MAX_SCORE = 4       // Score <= 4 uses Haiku
const SONNET_MIN_SCORE = 4.1   // Score > 4 uses Sonnet

// Turn limits
const TURN_BASE_HAIKU = 6
const TURN_BASE_SONNET = 14
const TURN_CAP_HAIKU = 15
const TURN_CAP_SONNET = 35

// File patterns that indicate complexity
const API_FILE_PATTERNS = [
  /\/api\//i,
  /\.api\./i,
  /routes?\./i,
  /controller/i,
  /handler/i,
  /endpoint/i,
]

const DATABASE_FILE_PATTERNS = [
  /schema/i,
  /migration/i,
  /prisma/i,
  /supabase/i,
  /drizzle/i,
  /\.sql$/i,
  /model/i,
  /entity/i,
]

const TEST_FILE_PATTERNS = [
  /\.test\./i,
  /\.spec\./i,
  /\/__tests__\//i,
  /\.e2e\./i,
]

const SHARED_CODE_PATTERNS = [
  /\/shared\//i,
  /\/common\//i,
  /\/utils\//i,
  /\/lib\//i,
  /\/types\//i,
  /\/hooks\//i,
]

// ============================================================================
// Types
// ============================================================================

export interface ComplexityFactors {
  fileCount: number
  createCount: number
  modifyCount: number
  deleteCount: number
  estimatedLOC: number
  hasTests: boolean
  hasApiChanges: boolean
  hasDatabaseChanges: boolean
  hasSchemaChanges: boolean
  dependencyCount: number
  dependentCount: number
  isNewFeature: boolean
  touchesSharedCode: boolean
  successCriteriaCount: number
}

export interface ComplexityAnalysis {
  sectionId: string
  sectionName: string
  score: number                    // 1-10
  model: BvsModelId
  maxTurns: number
  factors: ComplexityFactors
  reasoning: string[]              // List of reasons for the decision
  riskFlags: string[]              // Warnings about potential issues
}

export interface AnalyzerConfig {
  // Weight multipliers for scoring
  fileCountWeight: number
  testWeight: number
  apiWeight: number
  databaseWeight: number
  dependencyWeight: number
  sharedCodeWeight: number

  // Override thresholds
  forceHaikuMaxFiles: number       // Always use Haiku if <= this many files
  forceSonnetMinFiles: number      // Always use Sonnet if >= this many files
}

const DEFAULT_CONFIG: AnalyzerConfig = {
  fileCountWeight: 1.0,
  testWeight: 1.5,
  apiWeight: 2.0,
  databaseWeight: 2.5,
  dependencyWeight: 0.5,
  sharedCodeWeight: 1.0,
  forceHaikuMaxFiles: 1,
  forceSonnetMinFiles: 6,
}

// ============================================================================
// Service
// ============================================================================

export class BvsComplexityAnalyzerService {
  private config: AnalyzerConfig

  constructor(config: Partial<AnalyzerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Analyze a single section's complexity
   */
  analyze(section: BvsSection): ComplexityAnalysis {
    const factors = this.extractFactors(section)
    const score = this.calculateScore(factors)
    const model = this.selectModel(score, factors)
    const maxTurns = this.calculateTurns(model, factors)
    const reasoning = this.buildReasoning(factors, score, model)
    const riskFlags = this.identifyRisks(factors)

    return {
      sectionId: section.id,
      sectionName: section.name,
      score: Math.round(score * 10) / 10, // Round to 1 decimal
      model,
      maxTurns,
      factors,
      reasoning,
      riskFlags,
    }
  }

  /**
   * Analyze a section with learning-based adjustments
   *
   * Uses historical data from the learning capture service to adjust
   * complexity estimates based on past performance.
   */
  async analyzeWithLearnings(section: BvsSection): Promise<ComplexityAnalysis> {
    // Get base analysis
    const analysis = this.analyze(section)

    try {
      const learningService = await getBvsLearningCaptureService()

      // Get complexity history for similar file patterns
      const filePatterns = section.files.map(f => {
        // Extract pattern from file path (e.g., "api", "migration", "component")
        const parts = f.path.split('/')
        return parts.filter(p => !p.includes('.')).slice(-2).join('/')
      })

      const history = await learningService.getComplexityHistory({
        filePatterns,
        limit: 5
      })

      // Adjust estimates if we have historical data
      if (history.samples >= 2) {
        // If historical actual turns exceed our estimate by 50%+, increase estimate
        if (history.avgActualTurns > analysis.maxTurns * 1.5) {
          const adjustedTurns = Math.ceil(history.avgActualTurns * 1.1)
          analysis.maxTurns = Math.min(adjustedTurns, TURN_CAP_SONNET)
          analysis.reasoning.push(`Adjusted turns based on historical data (${history.samples} samples)`)
          analysis.riskFlags.push(`Historical sections of this type averaged ${Math.round(history.avgActualTurns)} turns`)
        }

        // If historical costs were high, consider upgrading model
        if (history.avgCost > 0.50 && analysis.model === BVS_MODELS.HAIKU) {
          analysis.model = BVS_MODELS.SONNET
          analysis.reasoning.push(`Upgraded to Sonnet based on historical cost data`)
        }
      }
    } catch (error) {
      console.warn('[ComplexityAnalyzer] Failed to apply learnings:', error)
      // Continue with base analysis
    }

    return analysis
  }

  /**
   * Analyze multiple sections and return sorted by complexity
   */
  analyzeAll(sections: BvsSection[]): ComplexityAnalysis[] {
    return sections
      .map(s => this.analyze(s))
      .sort((a, b) => b.score - a.score) // Highest complexity first
  }

  /**
   * Analyze multiple sections with learning-based adjustments
   */
  async analyzeAllWithLearnings(sections: BvsSection[]): Promise<ComplexityAnalysis[]> {
    const analyses = await Promise.all(sections.map(s => this.analyzeWithLearnings(s)))
    return analyses.sort((a, b) => b.score - a.score)
  }

  /**
   * Get a summary of model distribution for a set of sections
   */
  getModelDistribution(sections: BvsSection[]): { haiku: number; sonnet: number; totalTurns: number } {
    const analyses = this.analyzeAll(sections)
    return {
      haiku: analyses.filter(a => a.model === BVS_MODELS.HAIKU).length,
      sonnet: analyses.filter(a => a.model === BVS_MODELS.SONNET).length,
      totalTurns: analyses.reduce((sum, a) => sum + a.maxTurns, 0),
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private extractFactors(section: BvsSection): ComplexityFactors {
    const files = section.files || []
    const filePaths = files.map(f => f.path)

    return {
      fileCount: files.length,
      createCount: files.filter(f => f.action === 'create').length,
      modifyCount: files.filter(f => f.action === 'modify').length,
      deleteCount: files.filter(f => f.action === 'delete').length,
      estimatedLOC: this.estimateLOC(files),
      hasTests: filePaths.some(p => TEST_FILE_PATTERNS.some(pattern => pattern.test(p))),
      hasApiChanges: filePaths.some(p => API_FILE_PATTERNS.some(pattern => pattern.test(p))),
      hasDatabaseChanges: filePaths.some(p => DATABASE_FILE_PATTERNS.some(pattern => pattern.test(p))),
      hasSchemaChanges: filePaths.some(p => /schema/i.test(p)),
      dependencyCount: section.dependencies?.length || 0,
      dependentCount: section.dependents?.length || 0,
      isNewFeature: files.every(f => f.action === 'create'),
      touchesSharedCode: filePaths.some(p => SHARED_CODE_PATTERNS.some(pattern => pattern.test(p))),
      successCriteriaCount: section.successCriteria?.length || 0,
    }
  }

  private estimateLOC(files: BvsSection['files']): number {
    // Rough estimation based on file action
    // Create: ~100 LOC, Modify: ~50 LOC, Delete: ~0 LOC
    return files.reduce((total, file) => {
      switch (file.action) {
        case 'create': return total + 100
        case 'modify': return total + 50
        case 'delete': return total
        default: return total + 50
      }
    }, 0)
  }

  private calculateScore(factors: ComplexityFactors): number {
    let score = 0
    const {
      fileCountWeight,
      testWeight,
      apiWeight,
      databaseWeight,
      dependencyWeight,
      sharedCodeWeight,
    } = this.config

    // File count contribution (0-3 points)
    // 1 file = 1pt, 2 files = 1.5pt, 3 files = 2pt, 4+ files = 3pt
    if (factors.fileCount === 1) score += 1 * fileCountWeight
    else if (factors.fileCount === 2) score += 1.5 * fileCountWeight
    else if (factors.fileCount === 3) score += 2 * fileCountWeight
    else score += Math.min(3, factors.fileCount * 0.5) * fileCountWeight

    // Test files add complexity
    if (factors.hasTests) score += 1.5 * testWeight

    // API changes are significant
    if (factors.hasApiChanges) score += 2 * apiWeight

    // Database/Schema changes are most complex
    if (factors.hasDatabaseChanges) score += 2 * databaseWeight
    if (factors.hasSchemaChanges) score += 0.5 * databaseWeight // Additional if schema

    // Dependencies add coordination complexity
    score += Math.min(factors.dependencyCount * 0.5, 1.5) * dependencyWeight

    // Shared code is risky
    if (factors.touchesSharedCode) score += 1 * sharedCodeWeight

    // Cap at 10
    return Math.min(score, 10)
  }

  private selectModel(score: number, factors: ComplexityFactors): BvsModelId {
    // Force Haiku for very simple sections
    if (factors.fileCount <= this.config.forceHaikuMaxFiles &&
        !factors.hasApiChanges &&
        !factors.hasDatabaseChanges) {
      return BVS_MODELS.HAIKU
    }

    // Force Sonnet for large sections
    if (factors.fileCount >= this.config.forceSonnetMinFiles) {
      return BVS_MODELS.SONNET
    }

    // Score-based selection
    return score <= HAIKU_MAX_SCORE ? BVS_MODELS.HAIKU : BVS_MODELS.SONNET
  }

  private calculateTurns(model: BvsModelId, factors: ComplexityFactors): number {
    const isHaiku = model === BVS_MODELS.HAIKU
    const baseTurns = isHaiku ? TURN_BASE_HAIKU : TURN_BASE_SONNET
    const turnCap = isHaiku ? TURN_CAP_HAIKU : TURN_CAP_SONNET

    // Calculate multiplier based on factors
    let multiplier = 1.0

    // More files = more turns
    multiplier += factors.fileCount * 0.2

    // Tests require additional turns
    if (factors.hasTests) multiplier += 0.4

    // API/DB changes need verification
    if (factors.hasApiChanges) multiplier += 0.3
    if (factors.hasDatabaseChanges) multiplier += 0.4

    // Dependencies may need coordination
    multiplier += factors.dependencyCount * 0.1

    // Success criteria need verification
    multiplier += factors.successCriteriaCount * 0.1

    const calculatedTurns = Math.ceil(baseTurns * multiplier)
    return Math.min(calculatedTurns, turnCap)
  }

  private buildReasoning(factors: ComplexityFactors, score: number, model: BvsModelId): string[] {
    const reasons: string[] = []

    // Model selection reason
    if (model === BVS_MODELS.HAIKU) {
      reasons.push(`Using Haiku (score: ${score.toFixed(1)} <= ${HAIKU_MAX_SCORE})`)
    } else {
      reasons.push(`Using Sonnet (score: ${score.toFixed(1)} > ${HAIKU_MAX_SCORE})`)
    }

    // File count
    reasons.push(`${factors.fileCount} file(s): ${factors.createCount} create, ${factors.modifyCount} modify, ${factors.deleteCount} delete`)

    // Key factors
    if (factors.hasTests) reasons.push('Includes test files (+1.5)')
    if (factors.hasApiChanges) reasons.push('Modifies API endpoints (+2.0)')
    if (factors.hasDatabaseChanges) reasons.push('Modifies database/models (+2.5)')
    if (factors.touchesSharedCode) reasons.push('Touches shared code (+1.0)')
    if (factors.dependencyCount > 0) reasons.push(`Has ${factors.dependencyCount} dependencies`)
    if (factors.isNewFeature) reasons.push('New feature (all creates)')

    return reasons
  }

  private identifyRisks(factors: ComplexityFactors): string[] {
    const risks: string[] = []

    // High-risk patterns
    if (factors.hasDatabaseChanges && factors.hasApiChanges) {
      risks.push('RISK: Both DB and API changes - verify data flow')
    }

    if (factors.touchesSharedCode && factors.dependentCount > 2) {
      risks.push('RISK: Shared code with many dependents - test thoroughly')
    }

    if (factors.fileCount > 5 && !factors.hasTests) {
      risks.push('RISK: Large section without tests')
    }

    if (factors.deleteCount > 0) {
      risks.push('CAUTION: Contains file deletions - verify no orphaned imports')
    }

    if (factors.dependencyCount > 3) {
      risks.push('CAUTION: High dependency count - may have ordering issues')
    }

    return risks
  }
}

// Singleton export
export const complexityAnalyzer = new BvsComplexityAnalyzerService()

/**
 * Complexity Analyzer Service
 *
 * BMAD-Inspired: Scale Adaptive System
 *
 * Analyzes conversation content to determine task complexity and suggest
 * the appropriate spec generation mode (Quick/Smart/Enterprise).
 *
 * This replaces manual mode selection with automatic detection based on:
 * - Keywords indicating complex features (auth, migrations, etc.)
 * - Number of distinct features mentioned
 * - Presence of integration requirements
 */

import {
  ComplexityAnalysis,
  ComplexityFactor,
  TaskComplexity,
  COMPLEXITY_FACTORS_CONFIG
} from '../../shared/types'

// Feature detection patterns
const FEATURE_PATTERNS = [
  /(?:add|create|build|implement|develop)\s+(?:a\s+)?(\w+(?:\s+\w+)?)\s+(?:feature|functionality|system|module)/gi,
  /(?:need|want|require)\s+(?:a\s+)?(\w+(?:\s+\w+)?)\s+(?:feature|functionality|page|screen)/gi,
  /(?:should|must|will)\s+(?:have|include|support)\s+(\w+(?:\s+\w+)?)/gi,
]

/**
 * Count distinct features mentioned in the conversation
 */
function countFeatures(content: string): number {
  const features = new Set<string>()

  for (const pattern of FEATURE_PATTERNS) {
    let match
    while ((match = pattern.exec(content)) !== null) {
      const feature = match[1].toLowerCase().trim()
      if (feature.length > 2 && feature.length < 30) {
        features.add(feature)
      }
    }
  }

  // Also count bullet points and numbered lists as potential features
  const bulletPoints = content.match(/^[\s]*[-*•]\s+.+$/gm) || []
  const numberedItems = content.match(/^[\s]*\d+\.\s+.+$/gm) || []

  // Add unique bullet/numbered items (heuristic: each could be a feature)
  const listItems = [...bulletPoints, ...numberedItems]
  for (const item of listItems) {
    const cleaned = item.replace(/^[\s]*[-*•\d.]+\s+/, '').toLowerCase().trim()
    if (cleaned.length > 5 && cleaned.length < 100) {
      features.add(cleaned.substring(0, 30))
    }
  }

  return features.size
}

/**
 * Analyze complexity of a task based on conversation content
 */
export function analyzeComplexity(messages: Array<{ role: string; content: string }>): ComplexityAnalysis {
  // Combine all user messages for analysis
  const userContent = messages
    .filter(m => m.role === 'user')
    .map(m => m.content.toLowerCase())
    .join(' ')

  let totalScore = 0
  const detectedFactors: ComplexityFactor[] = []

  // Check each complexity factor
  for (const factorConfig of COMPLEXITY_FACTORS_CONFIG) {
    const keywords = factorConfig.keywords as readonly string[]
    const matchedKeywords: string[] = []

    for (const keyword of keywords) {
      if (userContent.includes(keyword.toLowerCase())) {
        matchedKeywords.push(keyword)
      }
    }

    if (matchedKeywords.length > 0) {
      totalScore += factorConfig.weight
      detectedFactors.push({
        name: factorConfig.name,
        weight: factorConfig.weight,
        detected: true,
        details: `Matched: ${matchedKeywords.join(', ')}`
      })
    }
  }

  // Add feature count multiplier (5 points per feature, max 25 extra points)
  const featureCount = countFeatures(userContent)
  const featureScore = Math.min(25, featureCount * 5)
  if (featureCount > 0) {
    totalScore += featureScore
    detectedFactors.push({
      name: 'feature_count',
      weight: featureScore,
      detected: true,
      details: `${featureCount} distinct features detected`
    })
  }

  // Normalize score to 0-100
  const normalizedScore = Math.min(100, totalScore)

  // Determine complexity level based on score
  let level: TaskComplexity
  let suggestedMode: ComplexityAnalysis['suggestedMode']

  if (normalizedScore < 25) {
    level = 'quick'
    suggestedMode = 'quick-spec'
  } else if (normalizedScore < 60) {
    level = 'standard'
    suggestedMode = 'smart-spec'
  } else {
    level = 'enterprise'
    suggestedMode = 'enterprise-spec'
  }

  // Calculate confidence based on number of factors detected
  // More factors = higher confidence in the assessment
  const confidence = Math.min(0.95, 0.3 + (detectedFactors.length * 0.1))

  return {
    score: normalizedScore,
    level,
    factors: detectedFactors,
    suggestedMode,
    confidence,
    analyzedAt: Date.now()
  }
}

/**
 * Get human-readable description of complexity level
 */
export function getComplexityDescription(level: TaskComplexity): string {
  switch (level) {
    case 'quick':
      return 'Simple task - Quick Spec (30 seconds) recommended. Suitable for single-feature changes, UI tweaks, or straightforward additions.'
    case 'standard':
      return 'Moderate complexity - Smart Spec (5-10 minutes) recommended. Involves multiple components, some data modeling, or API work.'
    case 'enterprise':
      return 'High complexity - Enterprise Spec recommended. Involves authentication, migrations, multi-service integration, or significant architectural changes.'
  }
}

/**
 * Get recommended agent configuration based on complexity
 */
export function getRecommendedAgents(level: TaskComplexity): string[] {
  switch (level) {
    case 'quick':
      // Minimal agents - just spec builder
      return ['spec-builder']
    case 'standard':
      // Standard set - include codebase analysis
      return ['user-journey', 'codebase', 'spec-builder']
    case 'enterprise':
      // Full set with all agents
      return ['user-journey', 'process', 'codebase', 'spec-builder']
  }
}

export class ComplexityAnalyzer {
  /**
   * Analyze messages and return complexity assessment
   */
  analyze(messages: Array<{ role: string; content: string }>): ComplexityAnalysis {
    return analyzeComplexity(messages)
  }

  /**
   * Check if complexity warrants automatic agent triggering
   */
  shouldAutoTriggerAgents(analysis: ComplexityAnalysis): boolean {
    // Auto-trigger agents for standard+ complexity with high confidence
    return analysis.level !== 'quick' && analysis.confidence >= 0.6
  }

  /**
   * Get description for UI display
   */
  getDescription(level: TaskComplexity): string {
    return getComplexityDescription(level)
  }

  /**
   * Get recommended agents for this complexity level
   */
  getAgents(level: TaskComplexity): string[] {
    return getRecommendedAgents(level)
  }
}

export default ComplexityAnalyzer

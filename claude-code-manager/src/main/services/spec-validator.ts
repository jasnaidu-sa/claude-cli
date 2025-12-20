/**
 * Spec Validator Service
 *
 * BMAD-Inspired: Implementation Readiness Check
 *
 * Validates that a specification is complete and ready for execution.
 * Prevents wasted implementation cycles on incomplete or ambiguous specs.
 *
 * Checks include:
 * - Spec structure (required sections present)
 * - No ambiguous markers (TODO, TBD)
 * - Test categories defined
 * - File paths realistic
 * - Schema documentation fresh
 * - Error handling specified
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import {
  ReadinessCheck,
  ReadinessCheckItem,
  READINESS_CHECKS_CONFIG
} from '../../shared/types'

/**
 * Check if spec has required sections
 */
function checkSpecStructure(specContent: string): ReadinessCheckItem {
  const hasOverview = /^##?\s*(overview|summary|introduction)/mi.test(specContent)
  const hasRequirements = /^##?\s*(requirements|features|functionality)/mi.test(specContent)
  const hasImplementation = /^##?\s*(implementation|steps|approach|technical)/mi.test(specContent)

  const passed = hasOverview && hasRequirements && hasImplementation

  const missing: string[] = []
  if (!hasOverview) missing.push('Overview')
  if (!hasRequirements) missing.push('Requirements')
  if (!hasImplementation) missing.push('Implementation')

  return {
    name: 'spec_structure',
    description: 'Spec has required sections (Overview, Requirements, Implementation)',
    status: passed ? 'passed' : 'failed',
    details: passed ? 'All required sections found' : `Missing: ${missing.join(', ')}`,
    required: true
  }
}

/**
 * Check for ambiguous markers (TODO, TBD, placeholders)
 */
function checkNoAmbiguousMarkers(specContent: string): ReadinessCheckItem {
  const todoMatches = specContent.match(/\bTODO\b/gi) || []
  const tbdMatches = specContent.match(/\bTBD\b/gi) || []
  const placeholderMatches = specContent.match(/\[(?:TODO|TBD|PLACEHOLDER|FILL IN|ADD HERE)\]/gi) || []
  const questionMarks = specContent.match(/\?\?\?/g) || []

  const totalIssues = todoMatches.length + tbdMatches.length + placeholderMatches.length + questionMarks.length
  const passed = totalIssues === 0

  return {
    name: 'no_ambiguous_requirements',
    description: 'No TODO or TBD markers in spec',
    status: passed ? 'passed' : 'failed',
    details: passed
      ? 'No ambiguous markers found'
      : `Found ${todoMatches.length} TODOs, ${tbdMatches.length} TBDs, ${placeholderMatches.length + questionMarks.length} placeholders`,
    required: true
  }
}

/**
 * Check if test categories or acceptance criteria are defined
 */
function checkTestCategories(specContent: string): ReadinessCheckItem {
  // Look for test section
  const hasTestSection = /^##?\s*(test|testing|acceptance|criteria)/mi.test(specContent)

  // Look for test case patterns
  const hasTestCases = /TEST-\d{3}/i.test(specContent) ||
    /\d+\.\s*(test|verify|check|ensure|confirm)/mi.test(specContent) ||
    /should\s+(return|display|show|render|create|update|delete)/mi.test(specContent)

  // Look for acceptance criteria patterns
  const hasAcceptanceCriteria = /acceptance\s+criteria/i.test(specContent) ||
    /given\s+.+\s+when\s+.+\s+then/mi.test(specContent) ||
    /\[\s*[x ]\s*\]/g.test(specContent)  // Checkbox-style criteria

  const passed = hasTestSection || hasTestCases || hasAcceptanceCriteria

  return {
    name: 'test_categories_defined',
    description: 'Test categories or acceptance criteria are specified',
    status: passed ? 'passed' : 'warning',
    details: passed
      ? hasTestSection ? 'Test section found' : 'Test cases or acceptance criteria found'
      : 'No testing or acceptance criteria section found',
    required: true
  }
}

/**
 * Check if file paths look realistic (not placeholders)
 */
function checkFilePathsRealistic(specContent: string): ReadinessCheckItem {
  // Extract file paths from markdown code blocks and inline code
  const filePathPattern = /`([^`]+\.(ts|tsx|js|jsx|py|sql|md|json|yaml|yml))`/g
  const paths: string[] = []
  let match

  while ((match = filePathPattern.exec(specContent)) !== null) {
    paths.push(match[1])
  }

  // Check for suspicious placeholder patterns
  const suspiciousPaths = paths.filter(p =>
    p.toLowerCase().includes('example') ||
    p.toLowerCase().includes('placeholder') ||
    p.toLowerCase().includes('todo') ||
    p.toLowerCase().includes('xxx') ||
    p.toLowerCase().includes('your-') ||
    p.includes('...') ||
    /\[.+\]/.test(p)  // Brackets like [filename]
  )

  const passed = suspiciousPaths.length === 0

  return {
    name: 'file_paths_realistic',
    description: 'All file paths look realistic (no placeholders)',
    status: passed ? 'passed' : 'warning',
    details: passed
      ? `${paths.length} file paths checked, all look valid`
      : `Suspicious paths: ${suspiciousPaths.slice(0, 3).join(', ')}${suspiciousPaths.length > 3 ? '...' : ''}`,
    required: false
  }
}

/**
 * Check if schema documentation exists and is fresh
 */
async function checkSchemaFresh(projectPath: string): Promise<ReadinessCheckItem> {
  const schemaIndexPath = path.join(projectPath, '.schema', '_index.md')

  try {
    const stat = await fs.stat(schemaIndexPath)
    const ageHours = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60)

    if (ageHours < 24) {
      return {
        name: 'schema_fresh',
        description: '.schema/ documentation is current (< 24 hours old)',
        status: 'passed',
        details: `Schema updated ${ageHours.toFixed(1)} hours ago`,
        required: false
      }
    } else {
      return {
        name: 'schema_fresh',
        description: '.schema/ documentation is current (< 24 hours old)',
        status: 'warning',
        details: `Schema is ${ageHours.toFixed(0)} hours old, consider refreshing`,
        required: false
      }
    }
  } catch {
    return {
      name: 'schema_fresh',
      description: '.schema/ documentation is current (< 24 hours old)',
      status: 'warning',
      details: 'No .schema/ directory found',
      required: false
    }
  }
}

/**
 * Check if error handling is defined
 */
function checkErrorHandling(specContent: string): ReadinessCheckItem {
  const errorPatterns = [
    /error\s+handling/i,
    /edge\s+case/i,
    /exception/i,
    /fail(?:ure|s|ed)?/i,
    /invalid\s+input/i,
    /what\s+(?:if|happens\s+when)/i,
    /handle\s+(?:errors?|exceptions?|failures?)/i
  ]

  const matchCount = errorPatterns.filter(p => p.test(specContent)).length
  const passed = matchCount >= 2

  return {
    name: 'error_handling_defined',
    description: 'Error cases and edge cases are specified',
    status: passed ? 'passed' : 'warning',
    details: passed
      ? `Error handling mentioned ${matchCount} times`
      : 'Limited error handling specification found',
    required: false
  }
}

/**
 * Check if spec references existing patterns
 */
function checkPatternsReferenced(specContent: string): ReadinessCheckItem {
  const patternIndicators = [
    /similar\s+to/i,
    /like\s+(?:the|existing)/i,
    /follow(?:s|ing)?\s+(?:the\s+)?pattern/i,
    /based\s+on/i,
    /reference\s+(?:implementation|file)/i,
    /existing\s+(?:component|service|module)/i,
    /use\s+(?:the\s+)?same\s+(?:pattern|approach)/i
  ]

  const matchCount = patternIndicators.filter(p => p.test(specContent)).length
  const passed = matchCount >= 1

  return {
    name: 'similar_patterns_referenced',
    description: 'References existing code patterns for consistency',
    status: passed ? 'passed' : 'warning',
    details: passed
      ? 'Spec references existing patterns'
      : 'No references to existing patterns found',
    required: false
  }
}

export class SpecValidator {
  /**
   * Validate spec readiness for implementation
   */
  async validateReadiness(projectPath: string, specContent: string): Promise<ReadinessCheck> {
    const checks: ReadinessCheckItem[] = []
    const blockers: string[] = []
    const warnings: string[] = []

    // Run all checks
    const structureCheck = checkSpecStructure(specContent)
    checks.push(structureCheck)
    if (structureCheck.status === 'failed' && structureCheck.required) {
      blockers.push(structureCheck.details || structureCheck.description)
    }

    const ambiguousCheck = checkNoAmbiguousMarkers(specContent)
    checks.push(ambiguousCheck)
    if (ambiguousCheck.status === 'failed' && ambiguousCheck.required) {
      blockers.push(ambiguousCheck.details || ambiguousCheck.description)
    }

    const testCheck = checkTestCategories(specContent)
    checks.push(testCheck)
    if (testCheck.status === 'failed' && testCheck.required) {
      blockers.push(testCheck.details || testCheck.description)
    } else if (testCheck.status === 'warning') {
      warnings.push(testCheck.details || testCheck.description)
    }

    const pathsCheck = checkFilePathsRealistic(specContent)
    checks.push(pathsCheck)
    if (pathsCheck.status === 'warning') {
      warnings.push(pathsCheck.details || pathsCheck.description)
    }

    const schemaCheck = await checkSchemaFresh(projectPath)
    checks.push(schemaCheck)
    if (schemaCheck.status === 'warning') {
      warnings.push(schemaCheck.details || schemaCheck.description)
    }

    const errorCheck = checkErrorHandling(specContent)
    checks.push(errorCheck)
    if (errorCheck.status === 'warning') {
      warnings.push(errorCheck.details || errorCheck.description)
    }

    const patternsCheck = checkPatternsReferenced(specContent)
    checks.push(patternsCheck)
    if (patternsCheck.status === 'warning') {
      warnings.push(patternsCheck.details || patternsCheck.description)
    }

    // Calculate score
    const requiredChecks = checks.filter(c => c.required)
    const optionalChecks = checks.filter(c => !c.required)

    const requiredPassed = requiredChecks.filter(c => c.status === 'passed').length
    const optionalPassed = optionalChecks.filter(c => c.status === 'passed').length

    const requiredScore = requiredChecks.length > 0
      ? (requiredPassed / requiredChecks.length) * 70
      : 70
    const optionalScore = optionalChecks.length > 0
      ? (optionalPassed / optionalChecks.length) * 30
      : 30

    const score = Math.round(requiredScore + optionalScore)

    return {
      passed: blockers.length === 0,
      checks,
      blockers,
      warnings,
      score,
      checkedAt: Date.now()
    }
  }

  /**
   * Quick check - just blockers, no detailed analysis
   */
  quickCheck(specContent: string): { passed: boolean; blockers: string[] } {
    const blockers: string[] = []

    // Check structure
    const hasOverview = /^##?\s*(overview|summary)/mi.test(specContent)
    const hasRequirements = /^##?\s*(requirements|features)/mi.test(specContent)
    const hasImplementation = /^##?\s*(implementation|steps)/mi.test(specContent)

    if (!hasOverview || !hasRequirements || !hasImplementation) {
      blockers.push('Missing required sections')
    }

    // Check for TODOs
    const todoCount = (specContent.match(/\bTODO\b/gi) || []).length
    const tbdCount = (specContent.match(/\bTBD\b/gi) || []).length

    if (todoCount > 0 || tbdCount > 0) {
      blockers.push(`Unresolved markers: ${todoCount} TODOs, ${tbdCount} TBDs`)
    }

    return {
      passed: blockers.length === 0,
      blockers
    }
  }
}

export default SpecValidator

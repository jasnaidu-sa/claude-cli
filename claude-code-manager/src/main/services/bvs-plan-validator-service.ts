/**
 * BVS Plan Validator Service (RALPH-013)
 *
 * Validates execution plans before running to catch issues early.
 * Provides errors (blocking) and warnings (informational).
 *
 * Validation Rules:
 * - ERRORS (must fix):
 *   - Section has 0 files
 *   - Dependency cycles detected
 *   - Missing dependency references
 *   - Invalid file paths
 *   - Duplicate section IDs
 *
 * - WARNINGS (can proceed):
 *   - Section has >5 files (Ralph Loop recommends 3-5)
 *   - Success criteria not binary/testable
 *   - No tests in section
 */

import * as path from 'path'
import * as fs from 'fs'
import type { BvsExecutionPlan, BvsSection } from '@shared/bvs-types'

export interface PlanValidationError {
  type: 'error'
  sectionId: string
  message: string
  details?: string
}

export interface PlanValidationWarning {
  type: 'warning'
  sectionId: string
  message: string
  suggestion?: string
}

export type PlanValidationIssue = PlanValidationError | PlanValidationWarning

export interface PlanValidationResult {
  valid: boolean
  errors: PlanValidationError[]
  warnings: PlanValidationWarning[]
  summary: {
    totalSections: number
    totalFiles: number
    totalDependencies: number
    criticalPathLength: number
    estimatedDuration?: number
  }
}

export class BvsPlanValidatorService {
  /**
   * Validate an execution plan
   */
  async validatePlan(
    plan: BvsExecutionPlan,
    projectPath: string
  ): Promise<PlanValidationResult> {
    const errors: PlanValidationError[] = []
    const warnings: PlanValidationWarning[] = []

    // Rule 1: Check for duplicate section IDs
    const sectionIds = new Set<string>()
    for (const section of plan.sections) {
      if (sectionIds.has(section.id)) {
        errors.push({
          type: 'error',
          sectionId: section.id,
          message: 'Duplicate section ID',
          details: `Section ID "${section.id}" appears multiple times`,
        })
      }
      sectionIds.add(section.id)
    }

    // Rule 2: Check each section
    for (const section of plan.sections) {
      // Rule 2a: Section must have files
      if (section.files.length === 0) {
        errors.push({
          type: 'error',
          sectionId: section.id,
          message: 'Section has no files',
          details: `Section "${section.name}" must specify at least one file to create/modify/delete`,
        })
      }

      // Rule 2b: Warn if section has >5 files (Ralph Loop best practice)
      if (section.files.length > 5) {
        warnings.push({
          type: 'warning',
          sectionId: section.id,
          message: `Section has ${section.files.length} files (recommended: 3-5)`,
          suggestion: 'Consider splitting this section into smaller atomic units for better context management',
        })
      }

      // Rule 2c: Check file paths are valid
      for (const file of section.files) {
        if (!file.path || file.path.trim() === '') {
          errors.push({
            type: 'error',
            sectionId: section.id,
            message: 'Invalid file path',
            details: `File path cannot be empty in section "${section.name}"`,
          })
          continue
        }

        // Check for absolute paths (should be relative)
        if (path.isAbsolute(file.path)) {
          warnings.push({
            type: 'warning',
            sectionId: section.id,
            message: `File path is absolute: ${file.path}`,
            suggestion: 'Use relative paths for portability',
          })
        }

        // For 'modify' actions, check file exists
        if (file.action === 'modify') {
          const fullPath = path.join(projectPath, file.path)
          if (!fs.existsSync(fullPath)) {
            errors.push({
              type: 'error',
              sectionId: section.id,
              message: `File to modify does not exist: ${file.path}`,
              details: `Cannot modify non-existent file. Use action: 'create' instead.`,
            })
          }
        }

        // For 'delete' actions, check file exists
        if (file.action === 'delete') {
          const fullPath = path.join(projectPath, file.path)
          if (!fs.existsSync(fullPath)) {
            warnings.push({
              type: 'warning',
              sectionId: section.id,
              message: `File to delete does not exist: ${file.path}`,
              suggestion: 'File may have already been deleted',
            })
          }
        }
      }

      // Rule 2d: Check dependencies reference valid sections
      for (const depId of section.dependencies) {
        if (!sectionIds.has(depId)) {
          errors.push({
            type: 'error',
            sectionId: section.id,
            message: `Invalid dependency reference: ${depId}`,
            details: `Section "${section.name}" depends on non-existent section "${depId}"`,
          })
        }
      }

      // Rule 2e: Warn if success criteria not binary
      for (const criteria of section.successCriteria) {
        const desc = criteria.description.toLowerCase()
        const hasTestableKeywords =
          desc.includes('pass') ||
          desc.includes('return') ||
          desc.includes('compile') ||
          desc.includes('build') ||
          desc.includes('no error')

        if (!hasTestableKeywords) {
          warnings.push({
            type: 'warning',
            sectionId: section.id,
            message: `Success criteria may not be binary: "${criteria.description}"`,
            suggestion: 'Use testable criteria like "Tests pass", "Compiles without errors", etc.',
          })
        }
      }

      // Rule 2f: Warn if no test files
      const hasTestFiles = section.files.some(f =>
        f.path.includes('.test.') ||
        f.path.includes('.spec.') ||
        f.path.includes('__tests__')
      )

      if (!hasTestFiles && section.files.length > 2) {
        warnings.push({
          type: 'warning',
          sectionId: section.id,
          message: 'Section has no test files',
          suggestion: 'Consider adding tests for better quality assurance',
        })
      }
    }

    // Rule 3: Check for dependency cycles
    const cycles = this.detectCycles(plan.sections)
    for (const cycle of cycles) {
      errors.push({
        type: 'error',
        sectionId: cycle[0],
        message: 'Dependency cycle detected',
        details: `Circular dependency: ${cycle.join(' → ')} → ${cycle[0]}`,
      })
    }

    // Rule 4: Validate dependency graph consistency
    const graphErrors = this.validateDependencyGraph(plan)
    errors.push(...graphErrors)

    // Compute summary statistics
    const summary = {
      totalSections: plan.sections.length,
      totalFiles: plan.sections.reduce((sum, s) => sum + s.files.length, 0),
      totalDependencies: plan.sections.reduce((sum, s) => sum + s.dependencies.length, 0),
      criticalPathLength: plan.dependencyGraph.criticalPath.length,
      estimatedDuration: plan.estimatedDuration,
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      summary,
    }
  }

  /**
   * Detect dependency cycles using depth-first search
   */
  private detectCycles(sections: BvsSection[]): string[][] {
    const cycles: string[][] = []
    const visited = new Set<string>()
    const recursionStack = new Set<string>()
    const sectionMap = new Map(sections.map(s => [s.id, s]))

    const dfs = (sectionId: string, path: string[]): void => {
      visited.add(sectionId)
      recursionStack.add(sectionId)
      path.push(sectionId)

      const section = sectionMap.get(sectionId)
      if (!section) return

      for (const depId of section.dependencies) {
        if (!visited.has(depId)) {
          dfs(depId, [...path])
        } else if (recursionStack.has(depId)) {
          // Found a cycle
          const cycleStart = path.indexOf(depId)
          if (cycleStart !== -1) {
            cycles.push(path.slice(cycleStart))
          }
        }
      }

      recursionStack.delete(sectionId)
    }

    for (const section of sections) {
      if (!visited.has(section.id)) {
        dfs(section.id, [])
      }
    }

    return cycles
  }

  /**
   * Validate dependency graph consistency
   */
  private validateDependencyGraph(plan: BvsExecutionPlan): PlanValidationError[] {
    const errors: PlanValidationError[] = []

    // Check that dependencyGraph.nodes matches sections
    const sectionIds = new Set(plan.sections.map(s => s.id))
    const nodeIds = new Set(plan.dependencyGraph.nodes.map(n => n.sectionId))

    for (const sectionId of sectionIds) {
      if (!nodeIds.has(sectionId)) {
        errors.push({
          type: 'error',
          sectionId,
          message: 'Section missing from dependency graph',
          details: `Section "${sectionId}" exists in plan but not in dependency graph`,
        })
      }
    }

    for (const nodeId of nodeIds) {
      if (!sectionIds.has(nodeId)) {
        errors.push({
          type: 'error',
          sectionId: nodeId,
          message: 'Dependency graph node has no corresponding section',
          details: `Node "${nodeId}" in graph but section not found`,
        })
      }
    }

    // Check that levels array contains all sections
    const levelsFlat = plan.dependencyGraph.levels.flat()
    const levelsSet = new Set(levelsFlat)

    for (const sectionId of sectionIds) {
      if (!levelsSet.has(sectionId)) {
        errors.push({
          type: 'error',
          sectionId,
          message: 'Section not assigned to any level',
          details: `Section "${sectionId}" missing from dependency graph levels`,
        })
      }
    }

    // Check for duplicate assignments in levels
    if (levelsFlat.length !== levelsSet.size) {
      errors.push({
        type: 'error',
        sectionId: 'graph',
        message: 'Duplicate section assignments in levels',
        details: 'Some sections appear in multiple levels',
      })
    }

    return errors
  }

  /**
   * Quick validation check (errors only)
   */
  async validateQuick(
    plan: BvsExecutionPlan,
    projectPath: string
  ): Promise<{ valid: boolean; errors: PlanValidationError[] }> {
    const result = await this.validatePlan(plan, projectPath)
    return {
      valid: result.valid,
      errors: result.errors,
    }
  }

  /**
   * Get validation summary as formatted string
   */
  formatValidationResult(result: PlanValidationResult): string {
    const lines: string[] = []

    lines.push('='.repeat(60))
    lines.push('BVS PLAN VALIDATION REPORT')
    lines.push('='.repeat(60))
    lines.push('')

    // Summary
    lines.push('SUMMARY:')
    lines.push(`  Total Sections: ${result.summary.totalSections}`)
    lines.push(`  Total Files: ${result.summary.totalFiles}`)
    lines.push(`  Total Dependencies: ${result.summary.totalDependencies}`)
    lines.push(`  Critical Path Length: ${result.summary.criticalPathLength} levels`)
    if (result.summary.estimatedDuration) {
      lines.push(`  Estimated Duration: ${Math.round(result.summary.estimatedDuration / 60)} minutes`)
    }
    lines.push('')

    // Errors
    if (result.errors.length > 0) {
      lines.push(`ERRORS (${result.errors.length}):`)
      for (const error of result.errors) {
        lines.push(`  [${error.sectionId}] ${error.message}`)
        if (error.details) {
          lines.push(`    ${error.details}`)
        }
      }
      lines.push('')
    }

    // Warnings
    if (result.warnings.length > 0) {
      lines.push(`WARNINGS (${result.warnings.length}):`)
      for (const warning of result.warnings) {
        lines.push(`  [${warning.sectionId}] ${warning.message}`)
        if (warning.suggestion) {
          lines.push(`    Suggestion: ${warning.suggestion}`)
        }
      }
      lines.push('')
    }

    // Overall status
    lines.push('-'.repeat(60))
    if (result.valid) {
      lines.push('✓ VALIDATION PASSED - Plan is ready for execution')
    } else {
      lines.push('✗ VALIDATION FAILED - Fix errors before proceeding')
    }
    lines.push('='.repeat(60))

    return lines.join('\n')
  }
}

// Singleton instance
let bvsPlanValidatorService: BvsPlanValidatorService | null = null

export function getBvsPlanValidatorService(): BvsPlanValidatorService {
  if (!bvsPlanValidatorService) {
    bvsPlanValidatorService = new BvsPlanValidatorService()
  }
  return bvsPlanValidatorService
}

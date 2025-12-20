/**
 * Checkpoint Conditions Evaluator
 *
 * BMAD-Inspired: Step-File Architecture with Pre/Post Conditions
 *
 * Evaluates preconditions before starting a checkpoint step and
 * postconditions after completing it. This ensures reliable execution
 * by validating state at each step boundary.
 *
 * Condition Types:
 * - test_status: Check test pass/fail counts
 * - file_exists: Verify file presence
 * - file_contains: Check file content
 * - command_succeeds: Run shell command
 * - schema_fresh: Verify .schema/ is current
 * - custom: Custom expression evaluation
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'
import {
  Condition,
  ConditionResult,
  StepConditions,
  CheckpointContext,
  CategoryProgressDetail
} from '../../shared/types'

const execAsync = promisify(exec)

/**
 * Evaluate a single condition
 */
async function evaluateCondition(
  condition: Condition,
  context: CheckpointContext,
  projectPath: string
): Promise<ConditionResult> {
  const startTime = Date.now()

  try {
    let passed = false
    let error: string | undefined

    switch (condition.type) {
      case 'test_status': {
        const { category, minPassing, maxFailing } = condition.check

        if (category) {
          // Check specific category
          // Note: context.categories might be CategoryProgress[] from workflow
          // We need to handle both types
          const categoryData = (context as unknown as { categories?: CategoryProgressDetail[] })
            .categories?.find(c => c.name === category)

          if (categoryData) {
            const passingCheck = minPassing === undefined || categoryData.passing >= minPassing
            const failingCheck = maxFailing === undefined ||
              (categoryData.total - categoryData.passing) <= maxFailing
            passed = passingCheck && failingCheck

            if (!passed) {
              error = `Category "${category}": ${categoryData.passing}/${categoryData.total} passing`
              if (minPassing !== undefined && categoryData.passing < minPassing) {
                error += `, need at least ${minPassing}`
              }
            }
          } else {
            passed = false
            error = `Category "${category}" not found in test results`
          }
        } else {
          // Check overall test status
          const passingCheck = minPassing === undefined || context.testsPassing >= minPassing
          const failingCheck = maxFailing === undefined || context.testsFailing <= maxFailing
          passed = passingCheck && failingCheck

          if (!passed) {
            error = `Tests: ${context.testsPassing}/${context.testsTotal} passing, ${context.testsFailing} failing`
          }
        }
        break
      }

      case 'file_exists': {
        const filePath = path.join(projectPath, condition.check.filePath || '')
        try {
          await fs.access(filePath)
          passed = true
        } catch {
          passed = false
          error = `File not found: ${condition.check.filePath}`
        }
        break
      }

      case 'file_contains': {
        const filePath = path.join(projectPath, condition.check.filePath || '')
        const searchString = condition.check.contains || ''

        try {
          const content = await fs.readFile(filePath, 'utf-8')
          passed = content.includes(searchString)

          if (!passed) {
            error = `File "${condition.check.filePath}" does not contain expected content`
          }
        } catch (e) {
          passed = false
          error = `Could not read file: ${condition.check.filePath}`
        }
        break
      }

      case 'command_succeeds': {
        const command = condition.check.command || ''
        const expectedCode = condition.check.expectedExitCode ?? 0

        try {
          const result = await execAsync(command, {
            cwd: projectPath,
            timeout: 30000 // 30 second timeout
          })
          passed = true
        } catch (e: unknown) {
          const execError = e as { code?: number; message?: string }
          if (execError.code !== undefined && execError.code === expectedCode) {
            passed = true
          } else {
            passed = false
            error = `Command failed: ${execError.message || 'Unknown error'}`
          }
        }
        break
      }

      case 'schema_fresh': {
        const schemaIndexPath = path.join(projectPath, '.schema', '_index.md')
        const maxAgeHours = 24 // Consider fresh if < 24 hours old

        try {
          const stat = await fs.stat(schemaIndexPath)
          const ageHours = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60)
          passed = ageHours < maxAgeHours

          if (!passed) {
            error = `.schema/ is ${Math.round(ageHours)} hours old (max: ${maxAgeHours})`
          }
        } catch {
          passed = false
          error = '.schema/ directory not found or inaccessible'
        }
        break
      }

      case 'custom': {
        // Custom expressions are evaluated as simple boolean checks
        // Format: "context.testsPassing > 10" or "context.testsFailing === 0"
        const expression = condition.check.customExpression || ''

        try {
          // SECURITY: Only allow safe expressions against context
          // This is a simplified evaluator - in production, use a proper sandbox
          const safeContext = {
            testsPassing: context.testsPassing,
            testsFailing: context.testsFailing,
            testsTotal: context.testsTotal,
            completedCategories: context.completedCategories?.length || 0
          }

          // Very basic expression evaluation for common patterns
          if (expression.includes('testsPassing')) {
            const match = expression.match(/testsPassing\s*(>=|>|<=|<|===|==)\s*(\d+)/)
            if (match) {
              const operator = match[1]
              const value = parseInt(match[2], 10)
              switch (operator) {
                case '>=': passed = safeContext.testsPassing >= value; break
                case '>': passed = safeContext.testsPassing > value; break
                case '<=': passed = safeContext.testsPassing <= value; break
                case '<': passed = safeContext.testsPassing < value; break
                case '===':
                case '==': passed = safeContext.testsPassing === value; break
              }
            }
          } else if (expression.includes('testsFailing')) {
            const match = expression.match(/testsFailing\s*(>=|>|<=|<|===|==)\s*(\d+)/)
            if (match) {
              const operator = match[1]
              const value = parseInt(match[2], 10)
              switch (operator) {
                case '>=': passed = safeContext.testsFailing >= value; break
                case '>': passed = safeContext.testsFailing > value; break
                case '<=': passed = safeContext.testsFailing <= value; break
                case '<': passed = safeContext.testsFailing < value; break
                case '===':
                case '==': passed = safeContext.testsFailing === value; break
              }
            }
          } else {
            passed = false
            error = `Unsupported custom expression: ${expression}`
          }
        } catch (e) {
          passed = false
          error = `Expression evaluation error: ${e instanceof Error ? e.message : String(e)}`
        }
        break
      }

      default:
        passed = false
        error = `Unknown condition type: ${condition.type}`
    }

    return {
      condition,
      passed,
      error,
      checkedAt: Date.now()
    }
  } catch (e) {
    return {
      condition,
      passed: false,
      error: `Condition check failed: ${e instanceof Error ? e.message : String(e)}`,
      checkedAt: Date.now()
    }
  }
}

/**
 * Evaluate all conditions in a set
 */
export async function evaluateConditions(
  conditions: Condition[],
  context: CheckpointContext,
  projectPath: string
): Promise<ConditionResult[]> {
  const results: ConditionResult[] = []

  for (const condition of conditions) {
    const result = await evaluateCondition(condition, context, projectPath)
    results.push(result)
  }

  return results
}

/**
 * Check if all required preconditions pass
 */
export async function checkPreconditions(
  stepConditions: StepConditions,
  context: CheckpointContext,
  projectPath: string
): Promise<{ passed: boolean; results: ConditionResult[]; blockers: string[] }> {
  const results = await evaluateConditions(stepConditions.preconditions, context, projectPath)

  const blockers: string[] = []
  for (const result of results) {
    if (result.condition.required && !result.passed) {
      blockers.push(result.error || result.condition.description)
    }
  }

  return {
    passed: blockers.length === 0,
    results,
    blockers
  }
}

/**
 * Check if all required postconditions pass
 */
export async function checkPostconditions(
  stepConditions: StepConditions,
  context: CheckpointContext,
  projectPath: string
): Promise<{ passed: boolean; results: ConditionResult[]; failures: string[] }> {
  const results = await evaluateConditions(stepConditions.postconditions, context, projectPath)

  const failures: string[] = []
  for (const result of results) {
    if (result.condition.required && !result.passed) {
      failures.push(result.error || result.condition.description)
    }
  }

  return {
    passed: failures.length === 0,
    results,
    failures
  }
}

/**
 * Create common preconditions for different checkpoint types
 */
export function createStandardPreconditions(checkpointType: string): Condition[] {
  const conditions: Condition[] = []

  switch (checkpointType) {
    case 'category_complete':
      // Before marking a category complete, ensure no failing tests in that category
      conditions.push({
        id: 'pre-category-no-failures',
        type: 'test_status',
        description: 'No failing tests in category',
        check: {
          type: 'test_status',
          maxFailing: 0
        },
        required: true
      })
      break

    case 'risk_boundary':
      // Before risky operations, ensure schema is fresh and tests pass
      conditions.push({
        id: 'pre-risk-schema-fresh',
        type: 'schema_fresh',
        description: 'Schema documentation is current',
        check: { type: 'schema_fresh' },
        required: false // Warning only
      })
      conditions.push({
        id: 'pre-risk-tests-pass',
        type: 'test_status',
        description: 'All tests passing before risky operation',
        check: {
          type: 'test_status',
          maxFailing: 0
        },
        required: true
      })
      break

    case 'feature_complete':
      // Before marking feature complete, all tests should pass
      conditions.push({
        id: 'pre-feature-all-pass',
        type: 'test_status',
        description: 'All feature tests passing',
        check: {
          type: 'test_status',
          maxFailing: 0
        },
        required: true
      })
      break
  }

  return conditions
}

/**
 * Create common postconditions for different checkpoint types
 */
export function createStandardPostconditions(checkpointType: string): Condition[] {
  const conditions: Condition[] = []

  switch (checkpointType) {
    case 'category_complete':
      // After category complete, verify the category is fully passing
      conditions.push({
        id: 'post-category-verified',
        type: 'test_status',
        description: 'Category tests verified passing',
        check: {
          type: 'test_status',
          maxFailing: 0
        },
        required: true
      })
      break

    case 'risk_boundary':
      // After risky operation, run quick sanity check
      conditions.push({
        id: 'post-risk-sanity',
        type: 'command_succeeds',
        description: 'Sanity check after risky operation',
        check: {
          type: 'command_succeeds',
          command: 'npm run typecheck || npx tsc --noEmit',
          expectedExitCode: 0
        },
        required: false // Warning only - some projects may not have typecheck
      })
      break

    case 'feature_complete':
      // After feature complete, run full test suite
      conditions.push({
        id: 'post-feature-tests',
        type: 'command_succeeds',
        description: 'Full test suite passes',
        check: {
          type: 'command_succeeds',
          command: 'npm test',
          expectedExitCode: 0
        },
        required: true
      })
      break
  }

  return conditions
}

export class CheckpointConditionsEvaluator {
  /**
   * Evaluate preconditions for a checkpoint
   */
  async evaluatePreconditions(
    stepConditions: StepConditions,
    context: CheckpointContext,
    projectPath: string
  ): Promise<{ passed: boolean; results: ConditionResult[]; blockers: string[] }> {
    return checkPreconditions(stepConditions, context, projectPath)
  }

  /**
   * Evaluate postconditions for a checkpoint
   */
  async evaluatePostconditions(
    stepConditions: StepConditions,
    context: CheckpointContext,
    projectPath: string
  ): Promise<{ passed: boolean; results: ConditionResult[]; failures: string[] }> {
    return checkPostconditions(stepConditions, context, projectPath)
  }

  /**
   * Create standard conditions for a checkpoint type
   */
  createStandardConditions(checkpointType: string): StepConditions {
    return {
      preconditions: createStandardPreconditions(checkpointType),
      postconditions: createStandardPostconditions(checkpointType)
    }
  }
}

export default CheckpointConditionsEvaluator

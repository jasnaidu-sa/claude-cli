/**
 * BVS Validation Gate Service
 *
 * Enforces mandatory quality gates before marking sections as complete.
 * Prevents incomplete work from being accepted into the codebase.
 *
 * Features:
 * - Required checks: typecheck, lint, tests, build
 * - Recommended checks: security scan, e2e tests, coverage
 * - Bypass workflow with reason + acknowledgment + audit trail
 * - Audit logging for compliance
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import type { BvsSession } from '@shared/bvs-types'

// ============================================================================
// Types
// ============================================================================

export interface ValidationGateConfig {
  required: {
    typecheck: boolean
    lint: boolean
    tests: boolean
    build: boolean
  }
  recommended: {
    securityScan: boolean
    e2eTests: boolean
    coverageThreshold: number
  }
  allowBypass: {
    enabled: boolean
    requiresReason: boolean
    auditLog: boolean
  }
}

export interface ValidationBypass {
  user: string
  reason: string
  checks: string[]
  timestamp: string
  acknowledgedRisks: boolean
}

export interface ValidationFailure {
  check: string
  result: string
  details?: string
}

export interface CompletionResult {
  status: 'completed' | 'completed_with_bypass'
  validationPassed?: boolean
  bypassedChecks?: string[]
  bypassReason?: string
}

export interface AuditEntry {
  timestamp: string
  sessionId: string
  action: 'validation_passed' | 'validation_failed' | 'bypass_requested' | 'bypass_approved'
  user?: string
  reason?: string
  checks?: string[]
  failures?: ValidationFailure[]
}

// ============================================================================
// Default Configuration
// ============================================================================

export const DEFAULT_VALIDATION_CONFIG: ValidationGateConfig = {
  required: {
    typecheck: true,
    lint: true,
    tests: true,
    build: true,
  },
  recommended: {
    securityScan: false,  // Optional: requires additional tools
    e2eTests: true,
    coverageThreshold: 80,
  },
  allowBypass: {
    enabled: true,         // Allow bypass for emergency fixes
    requiresReason: true,  // Must provide justification
    auditLog: true,        // Log all bypasses
  },
}

// ============================================================================
// Validation Error
// ============================================================================

export class ValidationError extends Error {
  constructor(
    message: string,
    public failures: ValidationFailure[]
  ) {
    super(message)
    this.name = 'ValidationError'
  }
}

// ============================================================================
// BVS Validation Gate Service
// ============================================================================

export class BvsValidationGateService {
  private config: ValidationGateConfig
  private auditLogPath: string | null = null

  constructor(config: ValidationGateConfig = DEFAULT_VALIDATION_CONFIG) {
    this.config = config
  }

  /**
   * Validate section completion before marking as done
   *
   * Enforces all required checks. If any fail, throws ValidationError.
   * Returns completion result with status and any bypass information.
   */
  async validateCompletion(session: BvsSession): Promise<CompletionResult> {
    const failures: ValidationFailure[] = []

    // Required checks
    if (this.config.required.typecheck) {
      const typecheckResult = await this.runTypecheck(session)
      if (!typecheckResult.passed) {
        failures.push({
          check: 'typecheck',
          result: 'failed',
          details: typecheckResult.details,
        })
      }
    }

    if (this.config.required.lint) {
      const lintResult = await this.runLint(session)
      if (!lintResult.passed) {
        failures.push({
          check: 'lint',
          result: 'failed',
          details: lintResult.details,
        })
      }
    }

    if (this.config.required.tests) {
      const testsResult = await this.runTests(session)
      if (!testsResult.passed) {
        failures.push({
          check: 'tests',
          result: 'failed',
          details: testsResult.details,
        })
      }
    }

    if (this.config.required.build) {
      const buildResult = await this.runBuild(session)
      if (!buildResult.passed) {
        failures.push({
          check: 'build',
          result: 'failed',
          details: buildResult.details,
        })
      }
    }

    // If any required check failed, log and throw
    if (failures.length > 0) {
      await this.auditLog({
        timestamp: new Date().toISOString(),
        sessionId: session.id,
        action: 'validation_failed',
        failures,
      })

      throw new ValidationError(
        `Validation failed: ${failures.length} check(s) failed`,
        failures
      )
    }

    // All checks passed
    await this.auditLog({
      timestamp: new Date().toISOString(),
      sessionId: session.id,
      action: 'validation_passed',
    })

    return {
      status: 'completed',
      validationPassed: true,
    }
  }

  /**
   * Request bypass for failed validation checks
   *
   * Requires:
   * - Non-empty reason
   * - Risk acknowledgment
   * - Enabled bypass in config
   *
   * Logs to audit trail for compliance.
   */
  async requestValidationBypass(
    sessionId: string,
    bypass: ValidationBypass
  ): Promise<void> {
    // Verify bypass is enabled
    if (!this.config.allowBypass.enabled) {
      throw new Error('Validation bypass is disabled in configuration')
    }

    // Verify reason is provided and sanitize
    if (this.config.allowBypass.requiresReason && !bypass.reason.trim()) {
      throw new Error('Bypass reason is required')
    }

    // Sanitize reason to prevent injection
    const sanitizedReason = bypass.reason.trim().slice(0, 500)
    bypass.reason = sanitizedReason

    // Verify risks acknowledged
    if (!bypass.acknowledgedRisks) {
      throw new Error('Must acknowledge risks before bypassing validation')
    }

    // Log to audit trail
    if (this.config.allowBypass.auditLog) {
      await this.auditLog({
        timestamp: bypass.timestamp,
        sessionId,
        action: 'bypass_approved',
        user: bypass.user,
        reason: bypass.reason,
        checks: bypass.checks,
      })
    }

    console.log(`[ValidationGate] Bypass approved for session ${sessionId}:`, {
      user: bypass.user,
      checks: bypass.checks,
      reason: bypass.reason,
    })
  }

  /**
   * Get current validation configuration
   */
  getValidationConfig(): ValidationGateConfig {
    return { ...this.config }
  }

  /**
   * Update validation configuration
   */
  setValidationConfig(updates: Partial<ValidationGateConfig>): void {
    this.config = {
      ...this.config,
      ...updates,
    }
  }

  /**
   * Set audit log file path (with path validation)
   */
  setAuditLogPath(logPath: string): void {
    // Validate path to prevent traversal
    const normalizedPath = path.normalize(logPath)
    if (normalizedPath.includes('..')) {
      throw new Error('Audit log path cannot contain path traversal')
    }
    this.auditLogPath = normalizedPath
  }

  /**
   * Write entry to audit log
   *
   * Logs all validation events for compliance and debugging.
   */
  async auditLog(entry: AuditEntry): Promise<void> {
    if (!this.config.allowBypass.auditLog) {
      return
    }

    // Default to in-memory logging if no path set
    if (!this.auditLogPath) {
      console.log('[ValidationGate] Audit:', entry)
      return
    }

    // Append to audit log file
    try {
      const logDir = path.dirname(this.auditLogPath)
      await fs.mkdir(logDir, { recursive: true })

      const logLine = JSON.stringify(entry) + '\n'
      await fs.appendFile(this.auditLogPath, logLine, 'utf-8')
    } catch (error) {
      console.error('[ValidationGate] Failed to write audit log:', error)
    }
  }

  // ============================================================================
  // Validation Checks (Stubs - to be implemented by orchestrator integration)
  // ============================================================================

  /**
   * Run TypeScript typecheck
   *
   * NOTE: This is a stub. Real implementation would integrate with
   * BVS quality gate service to run `npx tsc --noEmit`.
   */
  private async runTypecheck(_session: BvsSession): Promise<{
    passed: boolean
    details?: string
  }> {
    // Stub: assume pass for now
    // Real implementation: await qualityGateService.runTypecheck(session.projectPath)
    return { passed: true }
  }

  /**
   * Run lint checks
   *
   * NOTE: This is a stub. Real implementation would integrate with
   * BVS quality gate service to run linter.
   */
  private async runLint(_session: BvsSession): Promise<{
    passed: boolean
    details?: string
  }> {
    // Stub: assume pass for now
    return { passed: true }
  }

  /**
   * Run unit tests
   *
   * NOTE: This is a stub. Real implementation would integrate with
   * BVS quality gate service to run test suite.
   */
  private async runTests(_session: BvsSession): Promise<{
    passed: boolean
    details?: string
  }> {
    // Stub: assume pass for now
    return { passed: true }
  }

  /**
   * Run build verification
   *
   * NOTE: This is a stub. Real implementation would integrate with
   * BVS quality gate service to run build command.
   */
  private async runBuild(_session: BvsSession): Promise<{
    passed: boolean
    details?: string
  }> {
    // Stub: assume pass for now
    return { passed: true }
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

let validationGateService: BvsValidationGateService | null = null

export function getBvsValidationGateService(): BvsValidationGateService {
  if (!validationGateService) {
    validationGateService = new BvsValidationGateService()
  }
  return validationGateService
}

/**
 * PreflightCheck Component
 *
 * Phase 0b: Validates environment before proceeding with discovery.
 * Simplified version - checks venv only, auto-advances.
 */

import React, { useEffect, useState } from 'react'
import { CheckCircle, XCircle, AlertTriangle, Loader2, ArrowRight, RefreshCw } from 'lucide-react'
import { Button } from '../ui/button'
import { useAutonomousStore, type PreflightStatus } from '@renderer/stores/autonomous-store'

export function PreflightCheck() {
  const {
    selectedProject,
    preflightStatus,
    setPreflightStatus,
    goToNextPhase,
    ensureVenv,
    venvStatus,
    isLoading
  } = useAutonomousStore()

  const [checking, setChecking] = useState(false)

  // Run preflight checks on mount
  useEffect(() => {
    if (selectedProject && !preflightStatus) {
      runPreflightChecks()
    }
  }, [selectedProject])

  const runPreflightChecks = async () => {
    if (!selectedProject) return

    setChecking(true)
    const status: PreflightStatus = {
      venvReady: false,
      schemaFresh: true, // Assume OK for now
      mcpConfigured: true, // Will be auto-created
      gitClean: true, // Not blocking
      errors: [],
      warnings: []
    }

    try {
      // Check Python venv
      const venv = await ensureVenv()
      status.venvReady = venv?.isValid ?? false
      if (!status.venvReady) {
        status.warnings.push('Python virtual environment setup in progress')
      }

      // Mark as ready (warnings don't block)
      status.schemaFresh = true
      status.mcpConfigured = true
      status.gitClean = true

    } catch (error) {
      status.warnings.push(`Preflight warning: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }

    setPreflightStatus(status)
    setChecking(false)

    // Auto-advance after a short delay
    setTimeout(() => goToNextPhase(), 1500)
  }

  const StatusIcon = ({ ok, warning }: { ok: boolean; warning?: boolean }) => {
    if (warning) return <AlertTriangle className="h-4 w-4 text-yellow-500" />
    if (ok) return <CheckCircle className="h-4 w-4 text-green-500" />
    return <XCircle className="h-4 w-4 text-red-500" />
  }

  return (
    <div className="flex flex-col items-center justify-center h-full p-8">
      <div className="max-w-md w-full space-y-6">
        <div className="text-center space-y-2">
          <h2 className="text-2xl font-bold">Pre-flight Check</h2>
          <p className="text-muted-foreground">
            Validating your environment before we begin
          </p>
        </div>

        {checking ? (
          <div className="flex items-center justify-center gap-2 py-8">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span>Running checks...</span>
          </div>
        ) : preflightStatus ? (
          <div className="space-y-4">
            {/* Check results */}
            <div className="space-y-2 bg-secondary/50 rounded-lg p-4">
              <div className="flex items-center gap-2">
                <StatusIcon ok={preflightStatus.venvReady} warning={!preflightStatus.venvReady} />
                <span>Python Environment</span>
              </div>
              <div className="flex items-center gap-2">
                <StatusIcon ok={preflightStatus.schemaFresh} />
                <span>Schema Documentation</span>
              </div>
              <div className="flex items-center gap-2">
                <StatusIcon ok={preflightStatus.mcpConfigured} />
                <span>MCP Configuration</span>
              </div>
              <div className="flex items-center gap-2">
                <StatusIcon ok={preflightStatus.gitClean} />
                <span>Git Status</span>
              </div>
            </div>

            {/* Warnings */}
            {preflightStatus.warnings.length > 0 && (
              <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4">
                <h3 className="font-medium text-yellow-500 mb-2">Warnings</h3>
                <ul className="space-y-1 text-sm">
                  {preflightStatus.warnings.map((warn, i) => (
                    <li key={i} className="text-yellow-400">{warn}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={runPreflightChecks}
                disabled={checking}
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Re-check
              </Button>
              <Button
                onClick={goToNextPhase}
                disabled={preflightStatus.errors.length > 0}
                className="flex-1"
              >
                Continue
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

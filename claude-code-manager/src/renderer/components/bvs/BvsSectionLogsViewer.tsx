/**
 * BVS Section Logs Viewer
 *
 * F6.7 - Section Logs Viewer
 * Displays TypeCheck/Lint/Test output for a section:
 * - Tab-based navigation between log types
 * - Syntax highlighting for errors
 * - Collapsible error groups
 * - Copy to clipboard functionality
 */

import React, { useMemo, useState } from 'react'
import {
  type BvsSection,
  type BvsQualityGateResult,
  type BvsTypeError,
  type BvsLintError,
} from '@shared/bvs-types'
import {
  TabButton,
  EmptyState,
  SuccessState,
  FileErrorGroup,
  RawOutputViewer,
} from './BvsSharedComponents'

// ============================================================================
// Types
// ============================================================================

interface BvsSectionLogsViewerProps {
  section: BvsSection
  qualityResult?: BvsQualityGateResult
  onClose?: () => void
  className?: string
}

type LogTab = 'typecheck' | 'lint' | 'tests' | 'output'

// ============================================================================
// Main Component
// ============================================================================

export function BvsSectionLogsViewer({
  section,
  qualityResult,
  onClose,
  className = '',
}: BvsSectionLogsViewerProps) {
  const [activeTab, setActiveTab] = useState<LogTab>('typecheck')
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set())

  // Toggle file expansion
  const toggleFile = (file: string) => {
    setExpandedFiles(prev => {
      const next = new Set(prev)
      if (next.has(file)) {
        next.delete(file)
      } else {
        next.add(file)
      }
      return next
    })
  }

  // Get tab counts
  const counts = useMemo(() => ({
    typecheck: qualityResult?.typeCheck.errors.length || 0,
    lint: qualityResult?.lint.errors.length || 0,
    tests: qualityResult?.tests.testsFailing || 0,
  }), [qualityResult])

  return (
    <div className={`bg-white dark:bg-gray-800 rounded-lg shadow-lg overflow-hidden ${className}`}>
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Logs: {section.name}
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Section {section.id}
          </p>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl"
          >
            ×
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 dark:border-gray-700">
        <div className="flex">
          <TabButton
            active={activeTab === 'typecheck'}
            onClick={() => setActiveTab('typecheck')}
            label="TypeCheck"
            count={counts.typecheck}
            passed={qualityResult?.typeCheck.passed}
          />
          <TabButton
            active={activeTab === 'lint'}
            onClick={() => setActiveTab('lint')}
            label="Lint"
            count={counts.lint}
            passed={qualityResult?.lint.passed}
          />
          <TabButton
            active={activeTab === 'tests'}
            onClick={() => setActiveTab('tests')}
            label="Tests"
            count={counts.tests}
            passed={qualityResult?.tests.passed}
          />
          <TabButton
            active={activeTab === 'output'}
            onClick={() => setActiveTab('output')}
            label="Raw Output"
          />
        </div>
      </div>

      {/* Content */}
      <div className="p-4 max-h-[60vh] overflow-y-auto">
        {activeTab === 'typecheck' && (
          <TypeCheckLogs
            result={qualityResult?.typeCheck}
            expandedFiles={expandedFiles}
            onToggleFile={toggleFile}
          />
        )}
        {activeTab === 'lint' && (
          <LintLogs
            result={qualityResult?.lint}
            expandedFiles={expandedFiles}
            onToggleFile={toggleFile}
          />
        )}
        {activeTab === 'tests' && (
          <TestLogs result={qualityResult?.tests} />
        )}
        {activeTab === 'output' && (
          <RawOutput result={qualityResult} />
        )}
      </div>

      {/* Footer with duration */}
      {qualityResult && (
        <div className="px-6 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-750 text-sm text-gray-500">
          Total duration: {Math.round(qualityResult.totalDuration / 1000)}s
        </div>
      )}
    </div>
  )
}

// ============================================================================
// TypeCheck Logs
// ============================================================================

function TypeCheckLogs({
  result,
  expandedFiles,
  onToggleFile,
}: {
  result?: BvsQualityGateResult['typeCheck']
  expandedFiles: Set<string>
  onToggleFile: (file: string) => void
}) {
  if (!result) {
    return <EmptyState message="No TypeCheck results available" />
  }

  if (result.passed && result.errors.length === 0) {
    return <SuccessState message="TypeCheck passed with no errors!" />
  }

  // Group errors by file
  const errorsByFile = result.errors.reduce((acc, error) => {
    if (!acc[error.file]) {
      acc[error.file] = []
    }
    acc[error.file].push(error)
    return acc
  }, {} as Record<string, BvsTypeError[]>)

  return (
    <div className="space-y-3">
      {Object.entries(errorsByFile).map(([file, errors]) => (
        <FileErrorGroup
          key={file}
          file={file}
          errors={errors}
          expanded={expandedFiles.has(file)}
          onToggle={() => onToggleFile(file)}
          renderError={(error) => (
            <div className="flex items-start gap-2 text-sm">
              <span className="text-red-500 font-mono">{error.code}</span>
              <span className="text-gray-400">L{error.line}:{error.column}</span>
              <span className="text-gray-700 dark:text-gray-300">{error.message}</span>
            </div>
          )}
        />
      ))}
    </div>
  )
}

// ============================================================================
// Lint Logs
// ============================================================================

function LintLogs({
  result,
  expandedFiles,
  onToggleFile,
}: {
  result?: BvsQualityGateResult['lint']
  expandedFiles: Set<string>
  onToggleFile: (file: string) => void
}) {
  if (!result) {
    return <EmptyState message="No Lint results available" />
  }

  if (result.passed && result.errors.length === 0) {
    return <SuccessState message="Lint passed with no issues!" />
  }

  // Group errors by file
  const errorsByFile = result.errors.reduce((acc, error) => {
    if (!acc[error.file]) {
      acc[error.file] = []
    }
    acc[error.file].push(error)
    return acc
  }, {} as Record<string, BvsLintError[]>)

  return (
    <div className="space-y-3">
      {Object.entries(errorsByFile).map(([file, errors]) => (
        <FileErrorGroup
          key={file}
          file={file}
          errors={errors}
          expanded={expandedFiles.has(file)}
          onToggle={() => onToggleFile(file)}
          renderError={(error) => (
            <div className="flex items-start gap-2 text-sm">
              <span className={`font-mono ${error.severity === 'error' ? 'text-red-500' : 'text-yellow-500'}`}>
                {error.ruleId}
              </span>
              <span className="text-gray-400">L{error.line}:{error.column}</span>
              <span className="text-gray-700 dark:text-gray-300">{error.message}</span>
              {error.fixable && (
                <span className="px-1 bg-green-100 text-green-700 text-xs rounded">fixable</span>
              )}
            </div>
          )}
        />
      ))}
    </div>
  )
}

// ============================================================================
// Test Logs
// ============================================================================

function TestLogs({
  result,
}: {
  result?: BvsQualityGateResult['tests']
}) {
  if (!result) {
    return <EmptyState message="No Test results available" />
  }

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="flex items-center gap-4 p-4 bg-gray-50 dark:bg-gray-750 rounded-lg">
        <div className="text-center">
          <div className="text-2xl font-bold text-gray-900 dark:text-white">
            {result.testsTotal}
          </div>
          <div className="text-xs text-gray-500">Total</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-green-600">
            {result.testsPassing}
          </div>
          <div className="text-xs text-gray-500">Passing</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-red-600">
            {result.testsFailing}
          </div>
          <div className="text-xs text-gray-500">Failing</div>
        </div>
      </div>

      {/* Failed Tests */}
      {result.failedTests && result.failedTests.length > 0 && (
        <div className="space-y-2">
          <h4 className="font-medium text-gray-900 dark:text-white">Failed Tests</h4>
          {result.failedTests.map((test, index) => (
            <div
              key={index}
              className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg"
            >
              <div className="flex items-center gap-2">
                <span className="text-red-500">✕</span>
                <span className="font-medium text-gray-900 dark:text-white">
                  {test.name}
                </span>
              </div>
              {test.file && (
                <div className="mt-1 text-sm text-gray-500 font-mono">
                  {test.file}
                </div>
              )}
              <div className="mt-2 text-sm text-red-700 dark:text-red-400 font-mono whitespace-pre-wrap">
                {test.error}
              </div>
            </div>
          ))}
        </div>
      )}

      {result.passed && (
        <SuccessState message="All tests passed!" />
      )}
    </div>
  )
}

// ============================================================================
// Raw Output
// ============================================================================

function RawOutput({
  result,
}: {
  result?: BvsQualityGateResult
}) {
  const output = useMemo(() => {
    if (!result) return ''
    return [
      '=== TypeCheck Output ===',
      result.typeCheck.output || '(no output)',
      '',
      '=== Lint Output ===',
      result.lint.output || '(no output)',
      '',
      '=== Test Output ===',
      result.tests.output || '(no output)',
    ].join('\n')
  }, [result])

  return <RawOutputViewer output={output} emptyMessage="No output available" />
}

export default BvsSectionLogsViewer

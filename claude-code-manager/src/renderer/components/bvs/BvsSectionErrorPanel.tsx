/**
 * BVS Section Error Panel
 *
 * Comprehensive error display with:
 * - Error categorization and context
 * - Retry controls
 * - Diagnostic information
 * - Suggested actions
 */

import React from 'react'
import {
  AlertTriangle,
  RotateCcw,
  SkipForward,
  Edit,
  StopCircle,
  Clock,
  FileText,
  Wrench,
  Info
} from 'lucide-react'
import type { BvsSectionData } from '../../../shared/bvs-types'

interface BvsSectionErrorPanelProps {
  section: BvsSectionData
  onRetry: () => void
  onSkip: () => void
  onEditPrompt: () => void
  onStop: () => void
}

export function BvsSectionErrorPanel({
  section,
  onRetry,
  onSkip,
  onEditPrompt,
  onStop
}: BvsSectionErrorPanelProps) {
  const errorType = categorizeError(section.errorMessage || '')
  const isRetryable = errorType !== 'NON_RETRYABLE'

  return (
    <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg p-4 space-y-4">
      {/* Error Header */}
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-6 w-6 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-red-900 dark:text-red-100">
            Section Failed: {section.name}
          </h3>
          <p className="text-sm text-red-700 dark:text-red-300 mt-1">
            {section.errorMessage || 'An unknown error occurred'}
          </p>
        </div>
      </div>

      {/* Validation Errors */}
      {section.successCriteria && section.successCriteria.some(c => !c.passed) && (
        <div className="border-t border-red-200 dark:border-red-800 pt-3">
          <h4 className="text-sm font-medium text-red-900 dark:text-red-100 mb-2 flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Validation Failures
          </h4>
          <div className="space-y-1">
            {section.successCriteria.filter(c => !c.passed).map((criterion, i) => (
              <div
                key={i}
                className="text-sm text-red-700 dark:text-red-300 flex items-start gap-2 pl-6"
              >
                <span className="text-red-500">✗</span>
                <span>{criterion.description}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Execution Context */}
      <div className="border-t border-red-200 dark:border-red-800 pt-3">
        <h4 className="text-sm font-medium text-red-900 dark:text-red-100 mb-2 flex items-center gap-2">
          <Info className="h-4 w-4" />
          Execution Context
        </h4>
        <div className="grid grid-cols-2 gap-2 text-sm">
          {section.elapsedSeconds !== undefined && (
            <div className="flex items-center gap-2 text-red-700 dark:text-red-300">
              <Clock className="h-3 w-3" />
              <span>Time: {Math.floor(section.elapsedSeconds / 60)}m {section.elapsedSeconds % 60}s</span>
            </div>
          )}
          {section.currentStep && (
            <div className="flex items-center gap-2 text-red-700 dark:text-red-300">
              <Wrench className="h-3 w-3" />
              <span>Last: {section.currentStep}</span>
            </div>
          )}
          {section.currentFile && (
            <div className="flex items-center gap-2 text-red-700 dark:text-red-300 col-span-2">
              <FileText className="h-3 w-3" />
              <span className="truncate">File: {section.currentFile}</span>
            </div>
          )}
          {section.files && section.files.length > 0 && (
            <div className="flex items-center gap-2 text-red-700 dark:text-red-300 col-span-2">
              <FileText className="h-3 w-3" />
              <span>Expected Files: {section.files.map(f => f.path).join(', ')}</span>
            </div>
          )}
        </div>
      </div>

      {/* Suggested Action */}
      <div className="border-t border-red-200 dark:border-red-800 pt-3">
        <h4 className="text-sm font-medium text-red-900 dark:text-red-100 mb-2">
          💡 Suggested Action
        </h4>
        <p className="text-sm text-red-700 dark:text-red-300">
          {getSuggestedAction(errorType, section.errorMessage || '')}
        </p>
      </div>

      {/* Retry History (if any) */}
      {section.subtasks && section.subtasks.length > 0 && (
        <div className="border-t border-red-200 dark:border-red-800 pt-3">
          <h4 className="text-sm font-medium text-red-900 dark:text-red-100 mb-2">
            Retry History
          </h4>
          <div className="space-y-1">
            {section.subtasks.map((subtask, i) => (
              <div
                key={i}
                className="text-sm flex items-center gap-2 text-red-700 dark:text-red-300"
              >
                <span className={subtask.status === 'completed' ? 'text-green-600' : 'text-red-600'}>
                  {subtask.status === 'completed' ? '✓' : '✗'}
                </span>
                <span>Attempt {i + 1}: {subtask.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="border-t border-red-200 dark:border-red-800 pt-3 flex flex-wrap gap-2">
        {isRetryable && (
          <button
            onClick={onRetry}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm font-medium flex items-center gap-2 transition-colors"
          >
            <RotateCcw className="h-4 w-4" />
            Retry Section
          </button>
        )}

        <button
          onClick={onSkip}
          className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-md text-sm font-medium flex items-center gap-2 transition-colors"
        >
          <SkipForward className="h-4 w-4" />
          Skip Section
        </button>

        <button
          onClick={onEditPrompt}
          className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-md text-sm font-medium flex items-center gap-2 transition-colors"
        >
          <Edit className="h-4 w-4" />
          Edit Prompt
        </button>

        <button
          onClick={onStop}
          className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-md text-sm font-medium flex items-center gap-2 transition-colors"
        >
          <StopCircle className="h-4 w-4" />
          Stop Execution
        </button>
      </div>

      {/* Help Text */}
      <div className="text-xs text-red-600 dark:text-red-400 italic">
        <strong>Tip:</strong> Retry will attempt the section again with the error context added to the prompt.
        Most validation failures can be automatically fixed by retrying.
      </div>
    </div>
  )
}

// Helper Functions

type ErrorType = 'VALIDATION' | 'TIMEOUT' | 'TOOL_ERROR' | 'QUALITY_GATE' | 'NON_RETRYABLE' | 'UNKNOWN'

function categorizeError(errorMessage: string): ErrorType {
  const msg = errorMessage.toLowerCase()

  // Non-retryable errors
  if (msg.includes('permission denied') ||
      msg.includes('access denied') ||
      msg.includes('user confirmation') ||
      msg.includes('manual intervention')) {
    return 'NON_RETRYABLE'
  }

  // Validation errors (retryable)
  if (msg.includes('validation failed') ||
      msg.includes('missing required file') ||
      msg.includes('rls enabled but no policies') ||
      msg.includes('file is empty')) {
    return 'VALIDATION'
  }

  // Quality gate errors (retryable)
  if (msg.includes('did not call mark_complete') ||
      msg.includes('quality gate')) {
    return 'QUALITY_GATE'
  }

  // Tool errors (maybe retryable)
  if (msg.includes('tool failed') ||
      msg.includes('file not found') ||
      msg.includes('syntax error')) {
    return 'TOOL_ERROR'
  }

  // Timeout errors (retryable)
  if (msg.includes('timeout') ||
      msg.includes('exceeded max turns') ||
      msg.includes('too long')) {
    return 'TIMEOUT'
  }

  return 'UNKNOWN'
}

function getSuggestedAction(errorType: ErrorType, errorMessage: string): string {
  switch (errorType) {
    case 'VALIDATION':
      return 'Validation errors detected. Click "Retry Section" - most validation issues can be automatically fixed by retrying with the error context.'

    case 'QUALITY_GATE':
      return 'The worker completed work but didn\'t signal completion properly. Click "Retry Section" - the worker will be reminded to call mark_complete.'

    case 'TOOL_ERROR':
      if (errorMessage.includes('file not found')) {
        return 'A file was not found. Check the file paths in plan.json and ensure they match your project structure. Edit the plan if needed, then retry.'
      }
      return 'A tool operation failed. Review the error details above, fix any file path issues, then retry.'

    case 'TIMEOUT':
      return 'The section took too long to complete. Consider simplifying the task or increasing the max turns limit. You can also retry - it might succeed on a second attempt.'

    case 'NON_RETRYABLE':
      return 'This error requires manual intervention. Review the error message, fix the underlying issue (permissions, missing dependencies, etc.), then retry.'

    case 'UNKNOWN':
      return 'An unexpected error occurred. Check the logs in the "Ralph Loop" tab for more details. Try retry first - if it fails again, consider skipping this section.'

    default:
      return 'Review the error details above and decide whether to retry, skip, or stop execution.'
  }
}

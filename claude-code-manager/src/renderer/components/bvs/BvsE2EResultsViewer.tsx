/**
 * BVS E2E Results Viewer
 *
 * F6.8 - E2E Results Viewer
 * Displays E2E testing results:
 * - Screenshot gallery with lightbox
 * - Console error logs
 * - Network error logs
 * - Interactive test results
 * - Visual diff comparisons
 */

import React, { useState } from 'react'
import {
  type BvsSection,
  type BvsE2EResult,
} from '@shared/bvs-types'
import {
  TabButton,
  ErrorListViewer,
  EmptyState,
} from './BvsSharedComponents'

// ============================================================================
// Types
// ============================================================================

interface BvsE2EResultsViewerProps {
  section: BvsSection
  results: BvsE2EResult[]
  onClose?: () => void
  className?: string
}

interface Screenshot {
  name: string
  path: string
  timestamp: number
}

type ResultTab = 'overview' | 'screenshots' | 'console' | 'network'

// ============================================================================
// Main Component
// ============================================================================

export function BvsE2EResultsViewer({
  section,
  results,
  onClose,
  className = '',
}: BvsE2EResultsViewerProps) {
  const [activeTab, setActiveTab] = useState<ResultTab>('overview')
  const [selectedScreenshot, setSelectedScreenshot] = useState<Screenshot | null>(null)

  // Aggregate all results
  const allScreenshots = results.flatMap(r => r.screenshots)
  const allConsoleErrors = results.flatMap(r => r.consoleErrors)
  const allNetworkErrors = results.flatMap(r => r.networkErrors)
  const allPassed = results.every(r => r.passed)
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0)

  return (
    <div className={`bg-white dark:bg-gray-800 rounded-lg shadow-lg overflow-hidden ${className}`}>
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className={`text-2xl ${allPassed ? '' : ''}`}>
            {allPassed ? '✅' : '❌'}
          </span>
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              E2E Results: {section.name}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {results.length} URL(s) tested • {Math.round(totalDuration / 1000)}s
            </p>
          </div>
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
            active={activeTab === 'overview'}
            onClick={() => setActiveTab('overview')}
            label="Overview"
          />
          <TabButton
            active={activeTab === 'screenshots'}
            onClick={() => setActiveTab('screenshots')}
            label="Screenshots"
            count={allScreenshots.length}
          />
          <TabButton
            active={activeTab === 'console'}
            onClick={() => setActiveTab('console')}
            label="Console"
            count={allConsoleErrors.length}
            hasErrors={allConsoleErrors.length > 0}
          />
          <TabButton
            active={activeTab === 'network'}
            onClick={() => setActiveTab('network')}
            label="Network"
            count={allNetworkErrors.length}
            hasErrors={allNetworkErrors.length > 0}
          />
        </div>
      </div>

      {/* Content */}
      <div className="p-4 max-h-[60vh] overflow-y-auto">
        {activeTab === 'overview' && (
          <OverviewTab results={results} />
        )}
        {activeTab === 'screenshots' && (
          <ScreenshotsTab
            screenshots={allScreenshots}
            onSelectScreenshot={setSelectedScreenshot}
          />
        )}
        {activeTab === 'console' && (
          <ConsoleTab errors={allConsoleErrors} />
        )}
        {activeTab === 'network' && (
          <NetworkTab errors={allNetworkErrors} />
        )}
      </div>

      {/* Screenshot Lightbox */}
      {selectedScreenshot && (
        <ScreenshotLightbox
          screenshot={selectedScreenshot}
          onClose={() => setSelectedScreenshot(null)}
        />
      )}
    </div>
  )
}

// ============================================================================
// Overview Tab
// ============================================================================

function OverviewTab({ results }: { results: BvsE2EResult[] }) {
  return (
    <div className="space-y-4">
      {results.map((result, index) => (
        <div
          key={index}
          className={`p-4 rounded-lg border ${
            result.passed
              ? 'border-green-200 bg-green-50 dark:bg-green-900/20'
              : 'border-red-200 bg-red-50 dark:bg-red-900/20'
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span>{result.passed ? '✅' : '❌'}</span>
              <span className="font-mono text-sm">{result.url}</span>
            </div>
            <span className="text-sm text-gray-500">
              {Math.round(result.duration / 1000)}s
            </span>
          </div>

          {/* Summary stats */}
          <div className="flex items-center gap-4 text-sm">
            <span>📸 {result.screenshots.length} screenshots</span>
            {result.consoleErrors.length > 0 && (
              <span className="text-red-600">
                ⚠️ {result.consoleErrors.length} console errors
              </span>
            )}
            {result.networkErrors.length > 0 && (
              <span className="text-red-600">
                🌐 {result.networkErrors.length} network errors
              </span>
            )}
          </div>

          {/* Interaction results */}
          {result.interactionResults && result.interactionResults.length > 0 && (
            <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
              <div className="text-xs text-gray-500 uppercase tracking-wide mb-2">
                Interactive Tests
              </div>
              <div className="space-y-1">
                {result.interactionResults.map((ir, i) => (
                  <div
                    key={i}
                    className={`flex items-center gap-2 text-sm ${
                      ir.passed ? 'text-green-600' : 'text-red-600'
                    }`}
                  >
                    <span>{ir.passed ? '✓' : '✕'}</span>
                    <span>{ir.description || `Step ${i + 1}`}</span>
                    {ir.error && (
                      <span className="text-red-500 font-mono text-xs">
                        ({ir.error})
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ============================================================================
// Screenshots Tab
// ============================================================================

function ScreenshotsTab({
  screenshots,
  onSelectScreenshot,
}: {
  screenshots: Screenshot[]
  onSelectScreenshot: (screenshot: Screenshot) => void
}) {
  if (screenshots.length === 0) {
    return <EmptyState icon="📷" message="No screenshots captured" />
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
      {screenshots.map((screenshot, index) => (
        <div
          key={index}
          className="cursor-pointer group"
          onClick={() => onSelectScreenshot(screenshot)}
        >
          <div className="aspect-video bg-gray-100 dark:bg-gray-700 rounded-lg overflow-hidden border-2 border-transparent group-hover:border-blue-500 transition-colors">
            {/* Placeholder for actual screenshot */}
            <div className="w-full h-full flex items-center justify-center text-gray-400">
              <div className="text-center">
                <div className="text-3xl">🖼️</div>
                <div className="text-xs mt-1">Click to view</div>
              </div>
            </div>
          </div>
          <div className="mt-2">
            <div className="text-sm font-medium text-gray-900 dark:text-white truncate">
              {screenshot.name}
            </div>
            <div className="text-xs text-gray-500">
              {new Date(screenshot.timestamp).toLocaleTimeString()}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ============================================================================
// Console Tab - Uses shared ErrorListViewer
// ============================================================================

function ConsoleTab({ errors }: { errors: string[] }) {
  return (
    <ErrorListViewer
      errors={errors}
      emptyIcon="✅"
      emptyMessage="No console errors detected"
      errorIcon="⚠️"
      colorScheme="red"
    />
  )
}

// ============================================================================
// Network Tab - Uses shared ErrorListViewer
// ============================================================================

function NetworkTab({ errors }: { errors: string[] }) {
  return (
    <ErrorListViewer
      errors={errors}
      emptyIcon="✅"
      emptyMessage="No network errors detected"
      errorIcon="🌐"
      colorScheme="yellow"
    />
  )
}

// ============================================================================
// Screenshot Lightbox
// ============================================================================

function ScreenshotLightbox({
  screenshot,
  onClose,
}: {
  screenshot: Screenshot
  onClose: () => void
}) {
  return (
    <div
      className="fixed inset-0 bg-black/80 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="max-w-4xl max-h-[90vh] p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-white dark:bg-gray-800 rounded-lg overflow-hidden shadow-xl">
          {/* Header */}
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <div>
              <div className="font-medium text-gray-900 dark:text-white">
                {screenshot.name}
              </div>
              <div className="text-sm text-gray-500">
                {new Date(screenshot.timestamp).toLocaleString()}
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 text-xl"
            >
              ×
            </button>
          </div>

          {/* Image */}
          <div className="p-4 bg-gray-100 dark:bg-gray-900">
            <div className="aspect-video bg-gray-200 dark:bg-gray-700 rounded flex items-center justify-center">
              {/* In production, this would be an actual image */}
              <div className="text-center text-gray-400">
                <div className="text-4xl">🖼️</div>
                <div className="mt-2 font-mono text-sm">{screenshot.path}</div>
              </div>
            </div>
          </div>

          {/* Footer with actions */}
          <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
            <button
              className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded"
              onClick={() => {
                // In production, copy path to clipboard
                navigator.clipboard.writeText(screenshot.path)
              }}
            >
              📋 Copy Path
            </button>
            <button
              className="px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 rounded"
              onClick={() => {
                // In production, open in system viewer
              }}
            >
              🔗 Open in Viewer
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default BvsE2EResultsViewer

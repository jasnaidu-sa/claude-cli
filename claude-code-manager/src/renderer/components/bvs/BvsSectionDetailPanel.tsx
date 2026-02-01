/**
 * BVS Section Detail Panel - Slide-out panel with tabs for section details
 *
 * Tabs:
 * - Overview: Status, progress, files, success criteria, dependencies
 * - Logs: TypeCheck, Lint, Test output
 * - E2E: Screenshots, console output, interactions tested
 * - Errors: Full error context and fix suggestions
 */

import React, { useState } from 'react'
import {
  X,
  FileCode,
  Clock,
  CheckCircle2,
  Circle,
  Loader2,
  XCircle,
  ChevronRight,
  Terminal,
  Image,
  AlertTriangle,
  DollarSign,
  Zap
} from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { Button } from '../ui/button'
import type { BvsSectionData } from './BvsKanbanCard'
import { BvsSectionErrorPanel } from './BvsSectionErrorPanel'

interface BvsSectionDetailPanelProps {
  section: BvsSectionData | null
  sessionId: string | null
  onClose: () => void
  logs?: {
    typecheck?: string
    lint?: string
    test?: string
  }
  e2eResults?: {
    url?: string
    screenshot?: string
    consoleOutput?: string
    interactions?: Array<{ action: string; passed: boolean }>
  }
}

type TabId = 'overview' | 'ralph' | 'logs' | 'e2e' | 'errors'

const WORKER_COLORS: Record<string, string> = {
  'worker-1': 'text-blue-500',
  'worker-2': 'text-green-500',
  'worker-3': 'text-yellow-500',
  'worker-4': 'text-purple-500',
  'worker-5': 'text-orange-500',
}

function formatElapsedTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

export function BvsSectionDetailPanel({
  section,
  sessionId,
  onClose,
  logs,
  e2eResults
}: BvsSectionDetailPanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>('overview')
  const [streamingOutput, setStreamingOutput] = useState<string>('')
  const [userHasScrolled, setUserHasScrolled] = useState(false)
  const outputContainerRef = React.useRef<HTMLDivElement>(null)
  const outputEndRef = React.useRef<HTMLDivElement>(null)

  // Listen for worker output events - accumulate output for current section
  React.useEffect(() => {
    if (!section) return

    console.log('[BvsSectionDetailPanel] Setting up listener for section:', section.id)

    // Initialize with any existing output from the section (accumulated by dashboard)
    const existingOutput = (section as any).workerOutput || ''
    if (existingOutput && existingOutput !== streamingOutput) {
      setStreamingOutput(existingOutput)
    }

    const handleBvsEvent = (eventData: any) => {
      if (eventData.type === 'worker_output' && eventData.sectionId === section.id) {
        setStreamingOutput(prev => prev + eventData.output)

        // Only auto-scroll if user hasn't manually scrolled up
        if (!userHasScrolled) {
          setTimeout(() => {
            outputEndRef.current?.scrollIntoView({ behavior: 'smooth' })
          }, 50)
        }
      }
    }

    const unsubscribe = window.electron.bvsPlanning.onBvsEvent(handleBvsEvent)
    return () => {
      unsubscribe()
    }
  }, [section?.id, userHasScrolled])

  // Detect when user scrolls up in the output container
  const handleOutputScroll = React.useCallback(() => {
    const container = outputContainerRef.current
    if (!container) return

    // Check if user has scrolled up from the bottom
    const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 50
    setUserHasScrolled(!isAtBottom)
  }, [])

  // When section changes, load existing output from section data
  React.useEffect(() => {
    const existingOutput = (section as any)?.workerOutput || ''
    setStreamingOutput(existingOutput)
    setUserHasScrolled(false)
  }, [section?.id])

  // Action handlers for error panel
  const handleRetry = async () => {
    console.log(`[BvsSectionDetailPanel] handleRetry called - sessionId: ${sessionId}, sectionId: ${section?.id}, status: ${section?.status}`)

    if (!section) {
      console.error('[BvsSectionDetailPanel] Cannot retry: no section selected')
      alert('Cannot retry: no section selected')
      return
    }

    if (!sessionId) {
      console.error('[BvsSectionDetailPanel] Cannot retry: no session ID available')
      alert('Cannot retry: no active session. The execution session may have expired. Try restarting the execution.')
      return
    }

    try {
      console.log(`[BvsSectionDetailPanel] Calling retrySection(${sessionId}, ${section.id})`)
      const result = await window.electron.bvsPlanning.retrySection(sessionId, section.id)
      console.log(`[BvsSectionDetailPanel] retrySection result:`, result)

      if (result.success) {
        console.log(`[BvsSectionDetailPanel] Successfully retried section ${section.id}`)
      } else {
        console.error(`[BvsSectionDetailPanel] Failed to retry section:`, result.error)
        alert(`Failed to retry section: ${result.error}`)
      }
    } catch (error) {
      console.error('[BvsSectionDetailPanel] Exception during retry:', error)
      alert(`Failed to retry section: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  const handleSkip = async () => {
    if (!section || !sessionId) return
    if (confirm(`Skip section "${section.name}"?\n\nExecution will continue to dependent sections. The section will be marked as complete with 0% progress.`)) {
      try {
        const result = await window.electron.bvsPlanning.skipSection(sessionId, section.id)
        if (result.success) {
          console.log(`[BvsSectionDetailPanel] Successfully skipped section ${section.id}`)
          onClose() // Close the panel after skipping
        } else {
          console.error(`[BvsSectionDetailPanel] Failed to skip section:`, result.error)
          alert(`Failed to skip section: ${result.error}`)
        }
      } catch (error) {
        console.error('Failed to skip section:', error)
        alert(`Failed to skip section: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }
    }
  }

  const handleEditPrompt = () => {
    // TODO: Implement edit prompt modal
    alert('Edit prompt functionality coming soon. This will allow modifying the section description before retrying.')
  }

  const handleStop = async () => {
    if (!sessionId) return
    if (confirm('Stop execution?\n\nAll in-progress work will be terminated. This cannot be undone.')) {
      try {
        const result = await window.electron.bvsPlanning.pauseExecution(sessionId)
        if (result.success) {
          console.log(`[BvsSectionDetailPanel] Successfully stopped execution`)
          onClose()
        } else {
          console.error(`[BvsSectionDetailPanel] Failed to stop execution:`, result.error)
          alert(`Failed to stop execution: ${result.error}`)
        }
      } catch (error) {
        console.error('Failed to stop execution:', error)
        alert(`Failed to stop execution: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }
    }
  }

  if (!section) return null

  const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: 'overview', label: 'Overview', icon: <FileCode className="h-4 w-4" /> },
    { id: 'ralph', label: 'Ralph Loop', icon: <Zap className="h-4 w-4" /> },
    { id: 'logs', label: 'Logs', icon: <Terminal className="h-4 w-4" /> },
    { id: 'e2e', label: 'E2E', icon: <Image className="h-4 w-4" /> },
    { id: 'errors', label: 'Errors', icon: <AlertTriangle className="h-4 w-4" /> },
  ]

  const getStatusDisplay = () => {
    const workerColor = section.workerId ? WORKER_COLORS[section.workerId] : 'text-gray-500'
    switch (section.status) {
      case 'pending':
        return <span className="text-gray-500">Pending</span>
      case 'in_progress':
        return (
          <span className={cn('flex items-center gap-2', workerColor)}>
            <Loader2 className="h-4 w-4 animate-spin" />
            In Progress {section.workerId && `(${section.workerId.replace('worker-', 'Worker ')})`}
          </span>
        )
      case 'verifying':
        return (
          <span className="text-cyan-500 flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Verifying
          </span>
        )
      case 'done':
        return (
          <span className="text-green-500 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" />
            Completed
          </span>
        )
      case 'failed':
        return (
          <span className="text-red-500 flex items-center gap-2">
            <XCircle className="h-4 w-4" />
            Failed
          </span>
        )
      default:
        return <span>{section.status}</span>
    }
  }

  const renderOverviewTab = () => (
    <div className="space-y-6">
      {/* Status Section */}
      <div>
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
          Status
        </h4>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm">Status:</span>
            {getStatusDisplay()}
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm">Progress:</span>
            <span className="text-sm font-medium">{section.progress}%</span>
          </div>
          {section.elapsedSeconds !== undefined && section.elapsedSeconds > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-sm">Elapsed:</span>
              <span className="text-sm font-medium flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {formatElapsedTime(section.elapsedSeconds)}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Description */}
      {section.description && (
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Description
          </h4>
          <p className="text-sm text-muted-foreground">{section.description}</p>
        </div>
      )}

      {/* Files Section */}
      {section.files && section.files.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Files ({section.files.length})
          </h4>
          <div className="space-y-1">
            {section.files.map((file, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                {file.status === 'done' && <CheckCircle2 className="h-3 w-3 text-green-500" />}
                {file.status === 'active' && <Loader2 className="h-3 w-3 text-blue-500 animate-spin" />}
                {file.status === 'pending' && <Circle className="h-3 w-3 text-gray-300" />}
                <span className={cn(
                  'truncate',
                  file.status === 'done' && 'text-muted-foreground',
                  file.status === 'active' && 'text-blue-600 font-medium'
                )}>
                  {file.path}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Current Step */}
      {section.currentStep && (
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Current Step
          </h4>
          <div className="bg-muted/50 rounded-lg p-3">
            <p className="text-sm">{section.currentStep}</p>
            {section.currentFile && (
              <p className="text-xs text-muted-foreground mt-1">
                {section.currentFile}{section.currentLine && `:${section.currentLine}`}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Success Criteria */}
      {section.successCriteria && section.successCriteria.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Success Criteria
          </h4>
          <div className="space-y-1">
            {section.successCriteria.map((criteria, i) => (
              <div key={i} className="flex items-start gap-2 text-sm">
                {criteria.passed ? (
                  <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                ) : (
                  <Circle className="h-4 w-4 text-gray-300 mt-0.5 flex-shrink-0" />
                )}
                <span className={cn(criteria.passed && 'text-muted-foreground')}>
                  {criteria.description}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Dependencies */}
      {section.dependencies && section.dependencies.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Dependencies
          </h4>
          <div className="flex flex-wrap gap-2">
            {section.dependencies.map((dep, i) => (
              <span key={i} className="px-2 py-1 bg-muted rounded text-xs">
                {dep}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Dependents */}
      {section.dependents && section.dependents.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Blocked Until Complete
          </h4>
          <div className="flex flex-wrap gap-2">
            {section.dependents.map((dep, i) => (
              <span key={i} className="px-2 py-1 bg-orange-100 text-orange-700 rounded text-xs">
                {dep}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )

  const renderLogsTab = () => {
    const displayOutput = streamingOutput || (section as any).workerOutput || ''

    // Parse worker output to extract quality gate results
    const parseQualityGates = (output: string) => {
      const results = {
        typecheck: '',
        lint: '',
        test: '',
        validation: ''
      }

      // Look for common patterns in output
      if (output.includes('tsc') || output.includes('TypeScript')) {
        const tscMatch = output.match(/tsc[^\n]*(?:\n(?:.*error.*|.*warning.*|.*passed.*))+/gi)
        if (tscMatch) results.typecheck = tscMatch.join('\n')
      }
      if (output.includes('eslint') || output.includes('lint')) {
        const lintMatch = output.match(/eslint[^\n]*(?:\n(?:.*error.*|.*warning.*|.*passed.*))+/gi)
        if (lintMatch) results.lint = lintMatch.join('\n')
      }
      if (output.includes('test') || output.includes('jest') || output.includes('vitest')) {
        const testMatch = output.match(/(?:test|jest|vitest)[^\n]*(?:\n(?:.*pass.*|.*fail.*|.*error.*))+/gi)
        if (testMatch) results.test = testMatch.join('\n')
      }
      if (output.includes('BVS Validation') || output.includes('✓') || output.includes('✗')) {
        const validMatch = output.match(/\[BVS Validation\][^\n]*/gi)
        if (validMatch) results.validation = validMatch.join('\n')
      }

      return results
    }

    const qualityGates = parseQualityGates(displayOutput)
    const hasAnyOutput = displayOutput || logs?.typecheck || logs?.lint || logs?.test

    return (
      <div className="space-y-4">
        {/* Validation Output */}
        {(qualityGates.validation || section.errorMessage) && (
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              Validation Results
            </h4>
            <div className="bg-gray-900 rounded-lg p-3 font-mono text-xs text-gray-300 max-h-40 overflow-auto">
              {qualityGates.validation || section.errorMessage || 'No validation output'}
            </div>
          </div>
        )}

        {/* TypeCheck Output */}
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            TypeCheck Output
          </h4>
          <div className="bg-gray-900 rounded-lg p-3 font-mono text-xs text-gray-300 max-h-40 overflow-auto">
            {logs?.typecheck || qualityGates.typecheck || (
              <span className="text-gray-500">No typecheck output captured</span>
            )}
          </div>
        </div>

        {/* Lint Output */}
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Lint Output
          </h4>
          <div className="bg-gray-900 rounded-lg p-3 font-mono text-xs text-gray-300 max-h-40 overflow-auto">
            {logs?.lint || qualityGates.lint || (
              <span className="text-gray-500">No lint output captured</span>
            )}
          </div>
        </div>

        {/* Test Output */}
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Test Output
          </h4>
          <div className="bg-gray-900 rounded-lg p-3 font-mono text-xs text-gray-300 max-h-40 overflow-auto">
            {logs?.test || qualityGates.test || (
              <span className="text-gray-500">No test output captured</span>
            )}
          </div>
        </div>

        {/* Raw Worker Output */}
        {displayOutput && (
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              Full Worker Output
            </h4>
            <div className="bg-gray-900 rounded-lg p-3 font-mono text-xs text-gray-300 max-h-60 overflow-auto">
              <pre className="whitespace-pre-wrap">{displayOutput}</pre>
            </div>
          </div>
        )}

        {!hasAnyOutput && (
          <div className="text-center py-8 text-muted-foreground">
            <Terminal className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No logs captured yet</p>
            <p className="text-xs mt-1">Logs will appear when section execution completes</p>
          </div>
        )}
      </div>
    )
  }

  const renderE2ETab = () => (
    <div className="space-y-4">
      {e2eResults?.url && (
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            E2E Test: {e2eResults.url}
          </h4>
        </div>
      )}

      {/* Screenshot */}
      <div>
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
          Screenshot
        </h4>
        {e2eResults?.screenshot ? (
          <div className="border border-border rounded-lg overflow-hidden">
            <img src={e2eResults.screenshot} alt="E2E Screenshot" className="w-full" />
          </div>
        ) : (
          <div className="border border-dashed border-border rounded-lg p-8 text-center text-muted-foreground">
            <Image className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No screenshot captured yet</p>
          </div>
        )}
      </div>

      {/* Console Output */}
      <div>
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
          Console Output
        </h4>
        <div className="bg-gray-900 rounded-lg p-3 font-mono text-xs text-gray-300 max-h-32 overflow-auto">
          {e2eResults?.consoleOutput || (
            <span className="text-green-400">✓ No console errors detected</span>
          )}
        </div>
      </div>

      {/* Interactions Tested */}
      {e2eResults?.interactions && e2eResults.interactions.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Interactions Tested
          </h4>
          <div className="space-y-1">
            {e2eResults.interactions.map((interaction, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                {interaction.passed ? (
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                ) : (
                  <XCircle className="h-4 w-4 text-red-500" />
                )}
                <span>{interaction.action}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )

  const renderRalphLoopTab = () => {
    // Use streaming output if available, otherwise fall back to stored workerOutput
    const displayOutput = streamingOutput || (section as any).workerOutput || ''

    // Extract metrics from section data
    const sectionData = section as any
    const costUsd = sectionData.costUsd ?? sectionData.cost ?? 0
    const tokensInput = sectionData.tokensInput ?? 0
    const tokensOutput = sectionData.tokensOutput ?? 0
    const turnsUsed = sectionData.turnsUsed ?? 0
    const maxTurns = sectionData.maxTurns ?? 5

    return (
      <div className="space-y-4 h-full flex flex-col">
        {/* Metrics Cards - Compact row at top */}
        <div className="grid grid-cols-4 gap-2 flex-shrink-0">
          {/* Cost */}
          <div className="bg-muted/50 rounded-lg p-2 text-center">
            <div className="flex items-center justify-center gap-1 mb-1">
              <DollarSign className="h-3 w-3 text-green-500" />
            </div>
            <div className="text-sm font-mono font-semibold">
              ${costUsd.toFixed(4)}
            </div>
            <div className="text-[10px] text-muted-foreground">Cost</div>
          </div>

          {/* Tokens */}
          <div className="bg-muted/50 rounded-lg p-2 text-center">
            <div className="flex items-center justify-center gap-1 mb-1">
              <Zap className="h-3 w-3 text-yellow-500" />
            </div>
            <div className="text-sm font-mono font-semibold">
              {((tokensInput + tokensOutput) / 1000).toFixed(1)}k
            </div>
            <div className="text-[10px] text-muted-foreground">Tokens</div>
          </div>

          {/* Turns */}
          <div className="bg-muted/50 rounded-lg p-2 text-center">
            <div className="flex items-center justify-center gap-1 mb-1">
              <Clock className="h-3 w-3 text-blue-500" />
            </div>
            <div className="text-sm font-mono font-semibold">
              {turnsUsed}/{maxTurns}
            </div>
            <div className="text-[10px] text-muted-foreground">Turns</div>
          </div>

          {/* Elapsed Time */}
          <div className="bg-muted/50 rounded-lg p-2 text-center">
            <div className="flex items-center justify-center gap-1 mb-1">
              <Clock className="h-3 w-3 text-purple-500" />
            </div>
            <div className="text-sm font-mono font-semibold">
              {section.elapsedSeconds ? formatElapsedTime(section.elapsedSeconds) : '0:00'}
            </div>
            <div className="text-[10px] text-muted-foreground">Time</div>
          </div>
        </div>

        {/* Worker Output - Main content area, takes remaining space */}
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
              <Terminal className="h-3 w-3" />
              Worker Output {section.status === 'in_progress' && '(Live)'}
              {section.status === 'in_progress' && displayOutput && (
                <span className="inline-block w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              )}
            </h4>
            {userHasScrolled && section.status === 'in_progress' && (
              <button
                onClick={() => {
                  setUserHasScrolled(false)
                  outputEndRef.current?.scrollIntoView({ behavior: 'smooth' })
                }}
                className="text-xs text-blue-500 hover:text-blue-600 flex items-center gap-1"
              >
                <ChevronRight className="h-3 w-3 rotate-90" />
                Jump to bottom
              </button>
            )}
          </div>

          {section.status === 'pending' ? (
            <div className="flex-1 flex items-center justify-center text-muted-foreground bg-muted/30 rounded-lg">
              <div className="text-center">
                <Terminal className="h-12 w-12 mx-auto mb-2 opacity-50" />
                <p className="text-sm">Section has not started yet</p>
                <p className="text-xs mt-1">Output will appear here when execution begins</p>
              </div>
            </div>
          ) : (
            <div
              ref={outputContainerRef}
              onScroll={handleOutputScroll}
              className="flex-1 bg-gray-900 dark:bg-gray-950 rounded-lg p-3 font-mono text-xs overflow-auto border border-gray-700"
              style={{ minHeight: '300px', maxHeight: 'calc(100vh - 400px)' }}
            >
              {displayOutput ? (
                <>
                  <pre className="whitespace-pre-wrap text-gray-300">{displayOutput}</pre>
                  <div ref={outputEndRef} />
                </>
              ) : (
                <div className="text-gray-500 italic flex items-center gap-2">
                  {section.status === 'in_progress' ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Waiting for worker output...
                    </>
                  ) : (
                    'No output captured'
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  const renderErrorsTab = () => {
    // Show errors for failed sections OR sections with error messages (even if status changed)
    const hasErrors = section.status === 'failed' || section.errorMessage || (section as any).lastError

    return (
      <div className="space-y-4">
        {hasErrors ? (
          <BvsSectionErrorPanel
            section={{
              ...section,
              // Ensure errorMessage is set from any source
              errorMessage: section.errorMessage || (section as any).lastError || 'Section failed - check logs for details'
            }}
            onRetry={handleRetry}
            onSkip={handleSkip}
            onEditPrompt={handleEditPrompt}
            onStop={handleStop}
          />
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <CheckCircle2 className="h-12 w-12 mx-auto mb-2 text-green-500 opacity-50" />
            <p className="text-sm">No errors in this section</p>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="w-96 h-full border-l border-border bg-background flex flex-col animate-in slide-in-from-right duration-200">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border">
        <h3 className="font-semibold truncate flex-1">{section.name}</h3>
        <Button variant="ghost" size="sm" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'flex-1 px-3 py-2 text-xs font-medium transition-colors',
              'hover:bg-muted/50',
              activeTab === tab.id
                ? 'border-b-2 border-primary text-primary'
                : 'text-muted-foreground'
            )}
          >
            <span className="flex items-center justify-center gap-1">
              {tab.icon}
              {tab.label}
            </span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {activeTab === 'overview' && renderOverviewTab()}
        {activeTab === 'ralph' && renderRalphLoopTab()}
        {activeTab === 'logs' && renderLogsTab()}
        {activeTab === 'e2e' && renderE2ETab()}
        {activeTab === 'errors' && renderErrorsTab()}
      </div>
    </div>
  )
}

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
import { BvsSubtaskMetrics } from './BvsSubtaskMetrics'
import { BvsSubtaskProgress } from './BvsSubtaskProgress'

interface BvsSectionDetailPanelProps {
  section: BvsSectionData | null
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
  onClose,
  logs,
  e2eResults
}: BvsSectionDetailPanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>('overview')

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

  const renderLogsTab = () => (
    <div className="space-y-4">
      {/* TypeCheck Output */}
      <div>
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
          TypeCheck Output
        </h4>
        <div className="bg-gray-900 rounded-lg p-3 font-mono text-xs text-gray-300 max-h-40 overflow-auto">
          {logs?.typecheck || (
            <span className="text-gray-500">$ tsc --incremental --noEmit{'\n\n'}No output yet</span>
          )}
        </div>
      </div>

      {/* Lint Output */}
      <div>
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
          Lint Output
        </h4>
        <div className="bg-gray-900 rounded-lg p-3 font-mono text-xs text-gray-300 max-h-40 overflow-auto">
          {logs?.lint || (
            <span className="text-gray-500">$ npm run lint{'\n\n'}No output yet</span>
          )}
        </div>
      </div>

      {/* Test Output */}
      <div>
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
          Test Output
        </h4>
        <div className="bg-gray-900 rounded-lg p-3 font-mono text-xs text-gray-300 max-h-40 overflow-auto">
          {logs?.test || (
            <span className="text-gray-500">$ npm test{'\n\n'}No output yet</span>
          )}
        </div>
      </div>
    </div>
  )

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

  const renderRalphLoopTab = () => (
    <div className="space-y-4">
      {/* Subtask Progress */}
      <BvsSubtaskProgress
        sessionId={section.id} // Using section ID as session context
        sectionId={section.id}
        subtasks={section.subtasks}
      />

      {/* Cost Metrics */}
      <BvsSubtaskMetrics
        sessionId={section.id}
        sectionId={section.id}
        subtasks={section.subtasks}
      />
    </div>
  )

  const renderErrorsTab = () => (
    <div className="space-y-4">
      {section.status === 'failed' && section.errorMessage ? (
        <>
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              Error Details
            </h4>
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
              <div className="flex items-start gap-2">
                <XCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm text-red-800 dark:text-red-200 font-medium">Section Failed</p>
                  <p className="text-sm text-red-700 dark:text-red-300 mt-1">{section.errorMessage}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Fix Suggestions */}
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              Suggested Fix
            </h4>
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
              <p className="text-sm text-amber-800 dark:text-amber-200">
                Review the error message above and check the Logs tab for detailed output.
                You can retry the section after fixing the underlying issue.
              </p>
            </div>
          </div>
        </>
      ) : (
        <div className="text-center py-8 text-muted-foreground">
          <CheckCircle2 className="h-12 w-12 mx-auto mb-2 text-green-500 opacity-50" />
          <p className="text-sm">No errors in this section</p>
        </div>
      )}
    </div>
  )

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

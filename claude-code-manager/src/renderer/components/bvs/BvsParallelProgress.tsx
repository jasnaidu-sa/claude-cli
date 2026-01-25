/**
 * BVS Parallel Progress UI
 *
 * F0.18 - Parallel Progress UI
 * Shows real-time progress of parallel worker execution:
 * - Worker status badges with colors
 * - Per-worker progress bars
 * - Merge status indicators
 * - Conflict resolution prompts
 */

import React, { useState, useEffect } from 'react'
import {
  type BvsWorkerId,
  type BvsWorkerInfo,
  type BvsWorkerState,
  BVS_WORKER_COLORS,
  BVS_WORKER_STATE_ICONS,
  BVS_WORKER_STATE_COLORS,
} from '@shared/bvs-types'

// ============================================================================
// Types
// ============================================================================

interface BvsParallelProgressProps {
  workers: BvsWorkerInfo[]
  mergeStatus?: MergeStatus
  onPauseWorker?: (workerId: BvsWorkerId) => void
  onResumeWorker?: (workerId: BvsWorkerId) => void
  onCancelWorker?: (workerId: BvsWorkerId) => void
  onResolveConflict?: (workerId: BvsWorkerId, resolution: 'ours' | 'theirs' | 'manual') => void
  className?: string
}

interface MergeStatus {
  inProgress: boolean
  workersReady: BvsWorkerId[]
  workersMerging: BvsWorkerId[]
  workersMerged: BvsWorkerId[]
  conflicts: MergeConflict[]
}

interface MergeConflict {
  workerId: BvsWorkerId
  file: string
  conflictType: 'content' | 'delete' | 'rename'
  description: string
}

// ============================================================================
// Main Component
// ============================================================================

export function BvsParallelProgress({
  workers,
  mergeStatus,
  onPauseWorker,
  onResumeWorker,
  onCancelWorker,
  onResolveConflict,
  className = '',
}: BvsParallelProgressProps) {
  const [selectedWorker, setSelectedWorker] = useState<BvsWorkerId | null>(null)

  // Calculate overall progress
  const activeWorkers = workers.filter(w => w.state === 'running')
  const completedWorkers = workers.filter(w => w.state === 'completed')
  const failedWorkers = workers.filter(w => w.state === 'failed')
  const overallProgress = workers.length > 0
    ? workers.reduce((sum, w) => sum + w.progress, 0) / workers.length
    : 0

  return (
    <div className={`bg-white dark:bg-gray-800 rounded-lg shadow-lg ${className}`}>
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Parallel Execution
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {activeWorkers.length} active / {completedWorkers.length} completed / {failedWorkers.length} failed
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="text-2xl font-bold text-blue-600">
              {Math.round(overallProgress)}%
            </div>
          </div>
        </div>

        {/* Overall Progress Bar */}
        <div className="mt-3">
          <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-blue-500 to-green-500 transition-all duration-300"
              style={{ width: `${overallProgress}%` }}
            />
          </div>
        </div>
      </div>

      {/* Workers Grid */}
      <div className="p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {workers.map(worker => (
            <WorkerCard
              key={worker.workerId}
              worker={worker}
              isSelected={selectedWorker === worker.workerId}
              onSelect={() => setSelectedWorker(
                selectedWorker === worker.workerId ? null : worker.workerId
              )}
              onPause={() => onPauseWorker?.(worker.workerId)}
              onResume={() => onResumeWorker?.(worker.workerId)}
              onCancel={() => onCancelWorker?.(worker.workerId)}
            />
          ))}
        </div>
      </div>

      {/* Merge Status */}
      {mergeStatus && mergeStatus.inProgress && (
        <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-750">
          <MergeStatusPanel
            status={mergeStatus}
            onResolveConflict={onResolveConflict}
          />
        </div>
      )}

      {/* Conflicts Panel */}
      {mergeStatus?.conflicts && mergeStatus.conflicts.length > 0 && (
        <div className="px-6 py-4 border-t border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20">
          <ConflictsPanel
            conflicts={mergeStatus.conflicts}
            onResolve={onResolveConflict}
          />
        </div>
      )}

      {/* Selected Worker Details */}
      {selectedWorker && (
        <WorkerDetailsPanel
          worker={workers.find(w => w.workerId === selectedWorker)!}
          onClose={() => setSelectedWorker(null)}
        />
      )}
    </div>
  )
}

// ============================================================================
// Worker Card
// ============================================================================

interface WorkerCardProps {
  worker: BvsWorkerInfo
  isSelected: boolean
  onSelect: () => void
  onPause?: () => void
  onResume?: () => void
  onCancel?: () => void
}

function WorkerCard({
  worker,
  isSelected,
  onSelect,
  onPause,
  onResume,
  onCancel,
}: WorkerCardProps) {
  const color = BVS_WORKER_COLORS[worker.workerId]

  // Use centralized state icons and colors
  const stateIcon = BVS_WORKER_STATE_ICONS[worker.state]
  const stateColorClass = BVS_WORKER_STATE_COLORS[worker.state]

  return (
    <div
      className={`border rounded-lg p-4 cursor-pointer transition-all ${
        isSelected
          ? 'border-2 shadow-md'
          : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
      }`}
      style={{ borderColor: isSelected ? color.hex : undefined }}
      onClick={onSelect}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-sm"
            style={{ backgroundColor: color.hex }}
          >
            {worker.workerId}
          </div>
          <div>
            <div className="font-medium text-gray-900 dark:text-white text-sm">
              {worker.sectionId}
            </div>
            <div className="text-xs text-gray-500">
              {worker.currentStep || 'Waiting...'}
            </div>
          </div>
        </div>
        <span className={`px-2 py-0.5 rounded text-xs font-medium ${stateColorClass}`}>
          {stateIcon} {worker.state}
        </span>
      </div>

      {/* Progress Bar */}
      <div className="mb-2">
        <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
          <span>Progress</span>
          <span>{worker.progress}%</span>
        </div>
        <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
          <div
            className="h-full transition-all duration-300 rounded-full"
            style={{
              width: `${worker.progress}%`,
              backgroundColor: color.hex,
            }}
          />
        </div>
      </div>

      {/* Actions */}
      {worker.state === 'running' && (
        <div className="flex items-center gap-2 mt-3" onClick={e => e.stopPropagation()}>
          <button
            onClick={onPause}
            className="px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 rounded"
          >
            ⏸ Pause
          </button>
          <button
            onClick={onCancel}
            className="px-2 py-1 text-xs text-red-600 hover:bg-red-50 rounded"
          >
            ✕ Cancel
          </button>
        </div>
      )}
      {worker.state === 'idle' && (
        <div className="flex items-center gap-2 mt-3" onClick={e => e.stopPropagation()}>
          <button
            onClick={onResume}
            className="px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded"
          >
            ▶ Resume
          </button>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Merge Status Panel
// ============================================================================

interface MergeStatusPanelProps {
  status: MergeStatus
  onResolveConflict?: (workerId: BvsWorkerId, resolution: 'ours' | 'theirs' | 'manual') => void
}

function MergeStatusPanel({ status, onResolveConflict }: MergeStatusPanelProps) {
  return (
    <div>
      <h3 className="font-medium text-gray-900 dark:text-white mb-3">
        🔀 Merge Progress
      </h3>

      <div className="flex items-center gap-4">
        {/* Ready to merge */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">Ready:</span>
          <div className="flex gap-1">
            {status.workersReady.map(id => (
              <span
                key={id}
                className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs"
                style={{ backgroundColor: BVS_WORKER_COLORS[id].hex }}
              >
                {id}
              </span>
            ))}
          </div>
        </div>

        {/* Currently merging */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">Merging:</span>
          <div className="flex gap-1">
            {status.workersMerging.map(id => (
              <span
                key={id}
                className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs animate-pulse"
                style={{ backgroundColor: BVS_WORKER_COLORS[id].hex }}
              >
                {id}
              </span>
            ))}
          </div>
        </div>

        {/* Merged */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">Done:</span>
          <div className="flex gap-1">
            {status.workersMerged.map(id => (
              <span
                key={id}
                className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs opacity-50"
                style={{ backgroundColor: BVS_WORKER_COLORS[id].hex }}
              >
                ✓
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Conflicts Panel
// ============================================================================

interface ConflictsPanelProps {
  conflicts: MergeConflict[]
  onResolve?: (workerId: BvsWorkerId, resolution: 'ours' | 'theirs' | 'manual') => void
}

function ConflictsPanel({ conflicts, onResolve }: ConflictsPanelProps) {
  return (
    <div>
      <h3 className="font-medium text-red-700 dark:text-red-400 mb-3">
        ⚠️ Merge Conflicts ({conflicts.length})
      </h3>

      <div className="space-y-2">
        {conflicts.map((conflict, index) => (
          <div
            key={index}
            className="flex items-center justify-between bg-white dark:bg-gray-800 rounded-lg p-3"
          >
            <div className="flex items-center gap-3">
              <span
                className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs"
                style={{ backgroundColor: BVS_WORKER_COLORS[conflict.workerId].hex }}
              >
                {conflict.workerId}
              </span>
              <div>
                <div className="font-mono text-sm text-gray-900 dark:text-white">
                  {conflict.file}
                </div>
                <div className="text-xs text-gray-500">
                  {conflict.description}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => onResolve?.(conflict.workerId, 'ours')}
                className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
              >
                Keep Ours
              </button>
              <button
                onClick={() => onResolve?.(conflict.workerId, 'theirs')}
                className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200"
              >
                Keep Theirs
              </button>
              <button
                onClick={() => onResolve?.(conflict.workerId, 'manual')}
                className="px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
              >
                Manual
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ============================================================================
// Worker Details Panel
// ============================================================================

interface WorkerDetailsPanelProps {
  worker: BvsWorkerInfo
  onClose: () => void
}

function WorkerDetailsPanel({ worker, onClose }: WorkerDetailsPanelProps) {
  const color = BVS_WORKER_COLORS[worker.workerId]

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-hidden">
        {/* Header */}
        <div
          className="px-6 py-4 flex items-center justify-between"
          style={{ backgroundColor: color.hex }}
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center text-white font-bold">
              {worker.workerId}
            </div>
            <div className="text-white">
              <div className="font-semibold">{worker.sectionId}</div>
              <div className="text-sm opacity-80">{worker.state}</div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-white/80 hover:text-white text-2xl"
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 overflow-y-auto max-h-[60vh]">
          {/* Progress */}
          <div>
            <label className="text-xs text-gray-500 uppercase tracking-wide">Progress</label>
            <div className="mt-2">
              <div className="flex items-center justify-between text-sm mb-1">
                <span>{worker.currentStep || 'Processing...'}</span>
                <span className="font-medium">{worker.progress}%</span>
              </div>
              <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full transition-all duration-300 rounded-full"
                  style={{
                    width: `${worker.progress}%`,
                    backgroundColor: color.hex,
                  }}
                />
              </div>
            </div>
          </div>

          {/* Worktree Path */}
          {worker.worktreePath && (
            <div>
              <label className="text-xs text-gray-500 uppercase tracking-wide">Worktree</label>
              <div className="mt-1 font-mono text-sm text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-750 px-3 py-2 rounded">
                {worker.worktreePath}
              </div>
            </div>
          )}

          {/* Logs */}
          {worker.logs && worker.logs.length > 0 && (
            <div>
              <label className="text-xs text-gray-500 uppercase tracking-wide">Recent Logs</label>
              <div className="mt-1 bg-gray-900 text-green-400 font-mono text-xs p-3 rounded max-h-48 overflow-y-auto">
                {worker.logs.slice(-20).map((log, i) => (
                  <div key={i} className="whitespace-pre-wrap">{log}</div>
                ))}
              </div>
            </div>
          )}

          {/* Errors */}
          {worker.error && (
            <div>
              <label className="text-xs text-red-500 uppercase tracking-wide">Error</label>
              <div className="mt-1 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 font-mono text-xs p-3 rounded">
                {worker.error}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default BvsParallelProgress

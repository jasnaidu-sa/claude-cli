/**
 * CheckpointModal Component
 *
 * Modal for handling Ralph checkpoints with approve/skip/reject actions.
 * Displays:
 * - Risk score with visual indicator
 * - Risk factors breakdown
 * - Affected files and blast radius
 * - Comment input for feedback
 */

import React, { useState } from 'react'
import {
  AlertTriangle,
  CheckCircle,
  XCircle,
  SkipForward,
  FileCode,
  Shield,
  Zap,
  Info,
  ChevronDown,
  ChevronUp
} from 'lucide-react'
import { Button } from '../ui/button'
import { cn } from '@renderer/lib/utils'
import type { RalphCheckpoint } from '@shared/types'

interface CheckpointModalProps {
  checkpoint: RalphCheckpoint
  onApprove: (comment?: string) => void
  onSkip: (comment?: string) => void
  onReject: (comment?: string) => void
}

/** Get color based on risk score */
function getRiskColor(score: number): string {
  if (score < 30) return 'text-green-400'
  if (score < 60) return 'text-yellow-400'
  if (score < 80) return 'text-orange-400'
  return 'text-red-400'
}

/** Get background color based on risk score */
function getRiskBgColor(score: number): string {
  if (score < 30) return 'bg-green-500'
  if (score < 60) return 'bg-yellow-500'
  if (score < 80) return 'bg-orange-500'
  return 'bg-red-500'
}

/** Get risk level label */
function getRiskLevel(score: number): string {
  if (score < 30) return 'Low Risk'
  if (score < 60) return 'Medium Risk'
  if (score < 80) return 'High Risk'
  return 'Critical Risk'
}

export function CheckpointModal({
  checkpoint,
  onApprove,
  onSkip,
  onReject
}: CheckpointModalProps): React.ReactElement {
  const [comment, setComment] = useState('')
  const [showDetails, setShowDetails] = useState(false)

  const riskScore = checkpoint.riskScore
  const isHardCheckpoint = checkpoint.type === 'hard'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-gray-900 border border-gray-700 rounded-lg shadow-2xl w-full max-w-lg mx-4">
        {/* Header */}
        <div className="flex items-center gap-3 p-4 border-b border-gray-800">
          <div
            className={cn(
              'w-10 h-10 rounded-full flex items-center justify-center',
              isHardCheckpoint ? 'bg-red-900/50' : 'bg-yellow-900/50'
            )}
          >
            {isHardCheckpoint ? (
              <AlertTriangle className="w-5 h-5 text-red-400" />
            ) : (
              <Shield className="w-5 h-5 text-yellow-400" />
            )}
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-white">
              {isHardCheckpoint ? 'Hard Checkpoint' : 'Soft Checkpoint'}
            </h2>
            <p className="text-sm text-gray-400">
              {isHardCheckpoint
                ? 'Review required before proceeding'
                : 'Recommended review point'}
            </p>
          </div>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Feature info */}
          <div className="bg-gray-800 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-2">
              <FileCode className="w-4 h-4 text-gray-400" />
              <span className="text-sm text-gray-400">Feature</span>
            </div>
            <h3 className="font-medium text-white">{checkpoint.featureName}</h3>
            {checkpoint.featureId && (
              <p className="text-xs text-gray-500 mt-1 font-mono">{checkpoint.featureId}</p>
            )}
          </div>

          {/* Risk score gauge */}
          <div className="bg-gray-800 rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Zap className={cn('w-4 h-4', getRiskColor(riskScore))} />
                <span className="text-sm text-gray-400">Risk Assessment</span>
              </div>
              <span className={cn('text-sm font-medium', getRiskColor(riskScore))}>
                {getRiskLevel(riskScore)}
              </span>
            </div>

            {/* Risk bar */}
            <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
              <div
                className={cn('h-full transition-all duration-300', getRiskBgColor(riskScore))}
                style={{ width: `${riskScore}%` }}
              />
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-xs text-gray-500">0</span>
              <span className={cn('text-sm font-bold', getRiskColor(riskScore))}>
                {riskScore}
              </span>
              <span className="text-xs text-gray-500">100</span>
            </div>
          </div>

          {/* Reason */}
          <div className="bg-gray-800 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-2">
              <Info className="w-4 h-4 text-gray-400" />
              <span className="text-sm text-gray-400">Reason</span>
            </div>
            <p className="text-sm text-white">{checkpoint.reason}</p>
          </div>

          {/* Expandable details */}
          {checkpoint.riskFactors && checkpoint.riskFactors.length > 0 && (
            <div className="bg-gray-800 rounded-lg overflow-hidden">
              <button
                onClick={() => setShowDetails(!showDetails)}
                className="w-full flex items-center justify-between p-3 text-left hover:bg-gray-750 transition-colors"
              >
                <span className="text-sm text-gray-400">Risk Factors</span>
                {showDetails ? (
                  <ChevronUp className="w-4 h-4 text-gray-400" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-gray-400" />
                )}
              </button>
              {showDetails && (
                <div className="px-3 pb-3 space-y-2">
                  {checkpoint.riskFactors.map((factor, index) => (
                    <div key={index} className="flex items-center justify-between text-sm">
                      <span className="text-gray-400 capitalize">{factor.category}</span>
                      <span className="text-white font-mono">
                        {factor.score.toFixed(1)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Comment input */}
          <div>
            <label className="block text-sm text-gray-400 mb-2">
              Feedback (optional)
            </label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Add a comment or instructions..."
              className="w-full bg-gray-800 border border-gray-700 rounded-lg p-3 text-sm text-white placeholder-gray-500 resize-none focus:outline-none focus:border-blue-500"
              rows={2}
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 p-4 border-t border-gray-800">
          <Button
            onClick={() => onReject(comment || undefined)}
            variant="outline"
            className="flex-1 border-red-600 text-red-400 hover:bg-red-900/30"
          >
            <XCircle className="w-4 h-4 mr-2" />
            Reject
          </Button>
          <Button
            onClick={() => onSkip(comment || undefined)}
            variant="outline"
            className="flex-1 border-yellow-600 text-yellow-400 hover:bg-yellow-900/30"
          >
            <SkipForward className="w-4 h-4 mr-2" />
            Skip
          </Button>
          <Button
            onClick={() => onApprove(comment || undefined)}
            className="flex-1 bg-green-600 hover:bg-green-700 text-white"
          >
            <CheckCircle className="w-4 h-4 mr-2" />
            Approve
          </Button>
        </div>
      </div>
    </div>
  )
}

export default CheckpointModal

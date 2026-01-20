/**
 * PromptReview Component
 *
 * Displays the generated Ralph Loop execution prompt for review and editing.
 * Allows users to adjust parameters (maxIterations, checkpointThreshold) and
 * edit the prompt text before approval.
 */

import React, { useState, useCallback } from 'react'
import {
  FileText,
  Sparkles,
  Settings,
  CheckCircle,
  Edit3,
  Save,
  X,
  ArrowRight,
  RefreshCw,
  AlertTriangle,
  Target
} from 'lucide-react'
import { Button } from '../ui/button'
import { cn } from '@renderer/lib/utils'
import type { RalphPromptConfig } from '../../../shared/types'

interface PromptReviewProps {
  promptConfig: RalphPromptConfig
  onUpdate?: (updates: Partial<RalphPromptConfig>) => void
  onApprove?: () => void
  onRegenerate?: () => void
  isProcessing?: boolean
}

export function PromptReview({
  promptConfig,
  onUpdate,
  onApprove,
  onRegenerate,
  isProcessing = false
}: PromptReviewProps) {
  const [isEditingPrompt, setIsEditingPrompt] = useState(false)
  const [editedPrompt, setEditedPrompt] = useState(promptConfig.prompt)
  const [maxIterations, setMaxIterations] = useState(promptConfig.maxIterations)
  const [checkpointThreshold, setCheckpointThreshold] = useState(promptConfig.checkpointThreshold)

  const handleSavePrompt = useCallback(() => {
    onUpdate?.({ prompt: editedPrompt })
    setIsEditingPrompt(false)
  }, [editedPrompt, onUpdate])

  const handleCancelEdit = useCallback(() => {
    setEditedPrompt(promptConfig.prompt)
    setIsEditingPrompt(false)
  }, [promptConfig.prompt])

  const handleMaxIterationsChange = useCallback((value: number) => {
    setMaxIterations(value)
    onUpdate?.({ maxIterations: value })
  }, [onUpdate])

  const handleCheckpointThresholdChange = useCallback((value: number) => {
    setCheckpointThreshold(value)
    onUpdate?.({ checkpointThreshold: value })
  }, [onUpdate])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-emerald-500/10 flex items-center justify-center">
            <Sparkles className="h-5 w-5 text-emerald-500" />
          </div>
          <div>
            <h3 className="font-semibold">Generated Ralph Loop Prompt</h3>
            <p className="text-xs text-muted-foreground">
              Review and customize before starting execution
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {onRegenerate && (
            <Button
              variant="outline"
              size="sm"
              onClick={onRegenerate}
              disabled={isProcessing}
              className="gap-2"
            >
              <RefreshCw className="h-4 w-4" />
              Regenerate
            </Button>
          )}
        </div>
      </div>

      {/* Prompt Display/Editor */}
      <div className="rounded-lg border border-border bg-secondary/30 overflow-hidden">
        {/* Prompt Header */}
        <div className="px-4 py-2 bg-secondary/50 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Execution Prompt</span>
          </div>
          {!isEditingPrompt && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsEditingPrompt(true)}
              className="h-7 gap-1"
            >
              <Edit3 className="h-3 w-3" />
              Edit
            </Button>
          )}
        </div>

        {/* Prompt Content */}
        <div className="p-4">
          {isEditingPrompt ? (
            <div className="space-y-3">
              <textarea
                value={editedPrompt}
                onChange={(e) => setEditedPrompt(e.target.value)}
                className={cn(
                  'w-full min-h-[300px] p-3 rounded-lg',
                  'bg-background border border-border',
                  'font-mono text-sm resize-y',
                  'focus:outline-none focus:ring-2 focus:ring-primary'
                )}
              />
              <div className="flex gap-2 justify-end">
                <Button variant="ghost" size="sm" onClick={handleCancelEdit}>
                  <X className="h-3 w-3 mr-1" />
                  Cancel
                </Button>
                <Button size="sm" onClick={handleSavePrompt}>
                  <Save className="h-3 w-3 mr-1" />
                  Save Changes
                </Button>
              </div>
            </div>
          ) : (
            <pre className="whitespace-pre-wrap text-sm font-mono text-muted-foreground max-h-[400px] overflow-y-auto">
              {promptConfig.prompt}
            </pre>
          )}
        </div>
      </div>

      {/* Configuration Panel */}
      <div className="grid grid-cols-2 gap-4">
        {/* Max Iterations */}
        <div className="p-4 rounded-lg border border-border bg-secondary/30">
          <div className="flex items-center gap-2 mb-3">
            <Settings className="h-4 w-4 text-muted-foreground" />
            <h4 className="font-medium text-sm">Max Iterations</h4>
          </div>
          <div className="space-y-2">
            <input
              type="range"
              min="10"
              max="200"
              step="10"
              value={maxIterations}
              onChange={(e) => handleMaxIterationsChange(parseInt(e.target.value))}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>10</span>
              <span className="font-medium text-foreground">{maxIterations}</span>
              <span>200</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {maxIterations <= 30 && 'Quick task - will stop early if successful'}
              {maxIterations > 30 && maxIterations <= 70 && 'Standard feature - balanced execution'}
              {maxIterations > 70 && 'Enterprise project - extended execution time'}
            </p>
          </div>
        </div>

        {/* Checkpoint Threshold */}
        <div className="p-4 rounded-lg border border-border bg-secondary/30">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
            <h4 className="font-medium text-sm">Checkpoint Threshold</h4>
          </div>
          <div className="space-y-2">
            <input
              type="range"
              min="0"
              max="100"
              step="5"
              value={checkpointThreshold}
              onChange={(e) => handleCheckpointThresholdChange(parseInt(e.target.value))}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>0</span>
              <span className="font-medium text-foreground">{checkpointThreshold}</span>
              <span>100</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {checkpointThreshold <= 30 && 'Low - fewer checkpoints, faster execution'}
              {checkpointThreshold > 30 && checkpointThreshold <= 70 && 'Medium - balanced review points'}
              {checkpointThreshold > 70 && 'High - more checkpoints for risky operations'}
            </p>
          </div>
        </div>
      </div>

      {/* Completion Promise */}
      <div className="p-4 rounded-lg border border-emerald-500/20 bg-emerald-500/5">
        <div className="flex items-center gap-2 mb-2">
          <Target className="h-4 w-4 text-emerald-500" />
          <h4 className="font-medium text-sm text-emerald-500">Completion Promise</h4>
        </div>
        <p className="text-sm">
          When all success criteria are met, Claude will output:
        </p>
        <code className="block mt-2 p-2 rounded bg-secondary font-mono text-sm">
          &lt;promise&gt;{promptConfig.completionPromise}&lt;/promise&gt;
        </code>
      </div>

      {/* Success Indicators */}
      <div className="p-4 rounded-lg border border-border bg-secondary/30">
        <div className="flex items-center gap-2 mb-3">
          <CheckCircle className="h-4 w-4 text-emerald-500" />
          <h4 className="font-medium text-sm">Success Indicators</h4>
        </div>
        <ul className="space-y-1">
          {promptConfig.successIndicators.map((indicator, i) => (
            <li key={i} className="text-sm flex items-start gap-2">
              <span className="text-emerald-500 mt-0.5">✓</span>
              {indicator}
            </li>
          ))}
        </ul>
      </div>

      {/* Approval Button */}
      {onApprove && (
        <div className="flex justify-end pt-4 border-t border-border">
          <Button
            onClick={onApprove}
            disabled={isProcessing}
            size="lg"
            className="gap-2"
          >
            {isProcessing ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <ArrowRight className="h-4 w-4" />
                Approve & Start Execution
              </>
            )}
          </Button>
        </div>
      )}

      {/* Timestamp */}
      <p className="text-xs text-muted-foreground text-right">
        Generated at {new Date(promptConfig.generatedAt).toLocaleString()}
      </p>
    </div>
  )
}

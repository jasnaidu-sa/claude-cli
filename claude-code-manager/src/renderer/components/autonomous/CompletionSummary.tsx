/**
 * CompletionSummary Component
 *
 * Phase 5: Completion summary - shows final results, commit options,
 * and allows user to complete the workflow. Placeholder for FEAT-027.
 */

import React, { useState } from 'react'
import {
  CheckCircle2,
  GitBranch,
  GitMerge,
  FileText,
  Folder,
  RotateCcw,
  ExternalLink
} from 'lucide-react'
import { Button } from '../ui/button'
import { useAutonomousStore } from '@renderer/stores/autonomous-store'
import { cn } from '@renderer/lib/utils'

type CommitOption = 'squash-single' | 'squash-category' | 'keep-all'

export function CompletionSummary() {
  const {
    selectedProject,
    getActiveWorkflow,
    progressByWorkflow,
    activeWorkflowId,
    resetPhaseState
  } = useAutonomousStore()

  const [selectedCommitOption, setSelectedCommitOption] = useState<CommitOption>('squash-single')
  const [isCommitting, setIsCommitting] = useState(false)

  const activeWorkflow = getActiveWorkflow()
  const progress = activeWorkflowId ? progressByWorkflow[activeWorkflowId] : null

  const handleCommit = async () => {
    setIsCommitting(true)
    // TODO: FEAT-027 - Implement commit logic based on selected option
    setTimeout(() => {
      setIsCommitting(false)
      alert('Commit functionality will be implemented in FEAT-027')
    }, 1000)
  }

  const handleStartNew = () => {
    resetPhaseState()
  }

  return (
    <div className="h-full flex items-center justify-center p-8">
      <div className="max-w-2xl w-full space-y-8">
        {/* Success Header */}
        <div className="text-center">
          <div className="inline-flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500/10 mb-4">
            <CheckCircle2 className="h-10 w-10 text-emerald-500" />
          </div>
          <h2 className="text-2xl font-semibold mb-2">All Tests Passing!</h2>
          <p className="text-muted-foreground">
            Your {selectedProject?.isNew ? 'new project' : 'feature'} has been successfully implemented
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          <div className="p-4 bg-secondary/50 rounded-lg text-center">
            <div className="text-3xl font-bold text-emerald-500">
              {progress?.passing || 0}
            </div>
            <div className="text-sm text-muted-foreground">Tests Passing</div>
          </div>
          <div className="p-4 bg-secondary/50 rounded-lg text-center">
            <div className="text-3xl font-bold">
              {progress?.categories?.length || 0}
            </div>
            <div className="text-sm text-muted-foreground">Categories</div>
          </div>
          <div className="p-4 bg-secondary/50 rounded-lg text-center">
            <div className="text-3xl font-bold">
              {activeWorkflow?.worktreePath ? 'Yes' : 'No'}
            </div>
            <div className="text-sm text-muted-foreground">Worktree</div>
          </div>
        </div>

        {/* Commit Options */}
        <div className="space-y-4">
          <h3 className="font-medium">Commit Strategy</h3>
          <div className="space-y-2">
            <label
              className={cn(
                'flex items-start gap-3 p-4 rounded-lg border cursor-pointer',
                'hover:bg-secondary/50 transition-colors',
                selectedCommitOption === 'squash-single'
                  ? 'border-primary bg-primary/5'
                  : 'border-border'
              )}
            >
              <input
                type="radio"
                name="commit-option"
                value="squash-single"
                checked={selectedCommitOption === 'squash-single'}
                onChange={(e) => setSelectedCommitOption(e.target.value as CommitOption)}
                className="mt-1"
              />
              <div>
                <div className="flex items-center gap-2 font-medium">
                  <GitMerge className="h-4 w-4" />
                  Squash into single commit
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  All changes combined into one clean commit message
                </p>
              </div>
            </label>

            <label
              className={cn(
                'flex items-start gap-3 p-4 rounded-lg border cursor-pointer',
                'hover:bg-secondary/50 transition-colors',
                selectedCommitOption === 'squash-category'
                  ? 'border-primary bg-primary/5'
                  : 'border-border'
              )}
            >
              <input
                type="radio"
                name="commit-option"
                value="squash-category"
                checked={selectedCommitOption === 'squash-category'}
                onChange={(e) => setSelectedCommitOption(e.target.value as CommitOption)}
                className="mt-1"
              />
              <div>
                <div className="flex items-center gap-2 font-medium">
                  <Folder className="h-4 w-4" />
                  Squash by category
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  One commit per feature category for better history
                </p>
              </div>
            </label>

            <label
              className={cn(
                'flex items-start gap-3 p-4 rounded-lg border cursor-pointer',
                'hover:bg-secondary/50 transition-colors',
                selectedCommitOption === 'keep-all'
                  ? 'border-primary bg-primary/5'
                  : 'border-border'
              )}
            >
              <input
                type="radio"
                name="commit-option"
                value="keep-all"
                checked={selectedCommitOption === 'keep-all'}
                onChange={(e) => setSelectedCommitOption(e.target.value as CommitOption)}
                className="mt-1"
              />
              <div>
                <div className="flex items-center gap-2 font-medium">
                  <GitBranch className="h-4 w-4" />
                  Keep all commits
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  Preserve individual checkpoint commits as-is
                </p>
              </div>
            </label>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between pt-4 border-t border-border">
          <Button variant="outline" onClick={handleStartNew}>
            <RotateCcw className="h-4 w-4 mr-2" />
            Start New Project
          </Button>

          <div className="flex items-center gap-2">
            <Button variant="ghost">
              <FileText className="h-4 w-4 mr-2" />
              View Full Report
            </Button>
            <Button
              onClick={handleCommit}
              disabled={isCommitting}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              {isCommitting ? (
                'Committing...'
              ) : (
                <>
                  <GitMerge className="h-4 w-4 mr-2" />
                  Complete & Commit
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Placeholder notice */}
        <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded text-center">
          <p className="text-xs text-yellow-500">
            Commit functionality and full report will be implemented in FEAT-027
          </p>
        </div>
      </div>
    </div>
  )
}

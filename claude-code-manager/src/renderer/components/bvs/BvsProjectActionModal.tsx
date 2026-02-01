/**
 * BVS Project Action Modal
 *
 * Shows when clicking on an in_progress or paused project.
 * Allows user to:
 * - Continue execution (opens phase selector)
 * - Cancel/reset the project
 * - View current progress
 */

import React from 'react'
import {
  Play,
  XCircle,
  Eye,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2
} from 'lucide-react'
import { Button } from '../ui/button'
import { cn } from '@renderer/lib/utils'
import type { BvsProjectItem } from '@preload/index'

interface BvsProjectActionModalProps {
  project: BvsProjectItem
  onContinue: () => void  // Opens phase selector
  onCancel: () => void    // Resets project to ready
  onViewOnly: () => void  // View progress without resuming
  onClose: () => void     // Close modal
  isResetting?: boolean
}

export function BvsProjectActionModal({
  project,
  onContinue,
  onCancel,
  onViewOnly,
  onClose,
  isResetting = false
}: BvsProjectActionModalProps) {
  const progressPercent = project.sectionsTotal > 0
    ? Math.round((project.sectionsCompleted / project.sectionsTotal) * 100)
    : 0

  const getStatusInfo = () => {
    switch (project.status) {
      case 'in_progress':
        return {
          icon: <Loader2 className="h-6 w-6 text-blue-500 animate-spin" />,
          label: 'In Progress',
          description: 'Execution was interrupted. You can continue from where it left off or reset.',
          color: 'text-blue-500'
        }
      case 'paused':
        return {
          icon: <Clock className="h-6 w-6 text-yellow-500" />,
          label: 'Paused',
          description: 'Execution is paused. Continue to resume or reset to start fresh.',
          color: 'text-yellow-500'
        }
      default:
        return {
          icon: <CheckCircle2 className="h-6 w-6 text-green-500" />,
          label: project.status,
          description: '',
          color: 'text-green-500'
        }
    }
  }

  const statusInfo = getStatusInfo()

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-background rounded-lg shadow-xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="p-6 border-b border-border">
          <h2 className="text-xl font-semibold">{project.name}</h2>
          <div className="flex items-center gap-2 mt-2">
            {statusInfo.icon}
            <span className={cn('font-medium', statusInfo.color)}>
              {statusInfo.label}
            </span>
          </div>
        </div>

        {/* Progress Summary */}
        <div className="p-6 space-y-4">
          <p className="text-sm text-muted-foreground">
            {statusInfo.description}
          </p>

          {/* Progress Bar */}
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Progress</span>
              <span>{project.sectionsCompleted} / {project.sectionsTotal} sections ({progressPercent}%)</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-4 pt-2">
            <div className="text-center p-3 bg-muted/50 rounded-lg">
              <div className="text-2xl font-bold text-green-500">{project.sectionsCompleted}</div>
              <div className="text-xs text-muted-foreground">Completed</div>
            </div>
            <div className="text-center p-3 bg-muted/50 rounded-lg">
              <div className="text-2xl font-bold text-red-500">{project.sectionsFailed || 0}</div>
              <div className="text-xs text-muted-foreground">Failed</div>
            </div>
            <div className="text-center p-3 bg-muted/50 rounded-lg">
              <div className="text-2xl font-bold text-gray-500">
                {project.sectionsTotal - project.sectionsCompleted - (project.sectionsFailed || 0)}
              </div>
              <div className="text-xs text-muted-foreground">Remaining</div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="p-6 border-t border-border space-y-3">
          {/* Primary Action: Continue */}
          <Button
            className="w-full"
            size="lg"
            onClick={onContinue}
          >
            <Play className="h-4 w-4 mr-2" />
            Continue Execution
          </Button>

          {/* Secondary Actions */}
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={onViewOnly}
            >
              <Eye className="h-4 w-4 mr-2" />
              View Progress
            </Button>
            <Button
              variant="outline"
              className="flex-1 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
              onClick={onCancel}
              disabled={isResetting}
            >
              {isResetting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <XCircle className="h-4 w-4 mr-2" />
              )}
              Reset Project
            </Button>
          </div>

          {/* Cancel button */}
          <Button
            variant="ghost"
            className="w-full"
            onClick={onClose}
          >
            Close
          </Button>
        </div>

        {/* Warning for reset */}
        <div className="px-6 pb-4">
          <div className="flex items-start gap-2 text-xs text-muted-foreground bg-yellow-500/10 p-3 rounded-lg">
            <AlertTriangle className="h-4 w-4 text-yellow-500 flex-shrink-0 mt-0.5" />
            <span>
              <strong>Reset Project</strong> will clear all progress and return the project to 'ready' status.
              This cannot be undone.
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * SpecFileDetectionModal Component
 *
 * Shown when user uploads a file that looks like a specification document.
 * Offers 3 options:
 * 1. Use as Specification - Skip discovery, go straight to spec review (with AI enhancement)
 * 2. Continue Chatting - Keep file in context, AI can reference it during conversation
 * 3. Cancel - Remove file from context
 */

import React from 'react'
import { FileText, Sparkles, MessageSquare, X } from 'lucide-react'
import { Button } from '../ui/button'
import { cn } from '@renderer/lib/utils'

interface SpecFileDetectionModalProps {
  open: boolean
  fileName: string
  onUseAsSpec: () => void
  onContinueChat: () => void
  onCancel: () => void
}

export function SpecFileDetectionModal({
  open,
  fileName,
  onUseAsSpec,
  onContinueChat,
  onCancel
}: SpecFileDetectionModalProps) {
  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="spec-detection-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onCancel}
        aria-hidden="true"
      />

      {/* Modal */}
      <div className="relative bg-background border border-border rounded-lg shadow-xl max-w-2xl w-full mx-4 p-6">
        <button
          onClick={onCancel}
          className="absolute top-4 right-4 text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Close dialog"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Header */}
        <div className="flex items-start gap-3 mb-4">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <FileText className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 id="spec-detection-title" className="text-lg font-semibold">
              Specification Document Detected
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              <span className="font-mono text-xs bg-secondary px-1.5 py-0.5 rounded">{fileName}</span> looks like a specification document.
            </p>
          </div>
        </div>

        {/* Description */}
        <p className="text-sm text-muted-foreground mb-6">
          How would you like to proceed with this document?
        </p>

        {/* Options */}
        <div className="space-y-3">
          {/* Option 1: Use as Spec */}
          <button
            onClick={onUseAsSpec}
            className={cn(
              'w-full p-4 rounded-lg border-2 transition-all text-left',
              'border-primary/20 hover:border-primary/40 hover:bg-primary/5',
              'focus:outline-none focus:ring-2 focus:ring-primary'
            )}
          >
            <div className="flex items-start gap-3">
              <div className="h-8 w-8 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
                <Sparkles className="h-4 w-4 text-emerald-500" />
              </div>
              <div className="flex-1">
                <div className="font-medium mb-1">Use as Specification (Recommended)</div>
                <p className="text-sm text-muted-foreground">
                  AI will enhance your spec with codebase-specific details, validate completeness,
                  auto-generate missing sections, then proceed to review phase.
                </p>
                <p className="text-xs text-primary mt-2">
                  ⚡ Best for detailed specs - combines your requirements with AI codebase research
                </p>
              </div>
            </div>
          </button>

          {/* Option 2: Continue Chatting */}
          <button
            onClick={onContinueChat}
            className={cn(
              'w-full p-4 rounded-lg border-2 transition-all text-left',
              'border-border hover:border-primary/40 hover:bg-secondary',
              'focus:outline-none focus:ring-2 focus:ring-primary'
            )}
          >
            <div className="flex items-start gap-3">
              <div className="h-8 w-8 rounded-lg bg-blue-500/10 flex items-center justify-center shrink-0">
                <MessageSquare className="h-4 w-4 text-blue-500" />
              </div>
              <div className="flex-1">
                <div className="font-medium mb-1">Continue Chatting</div>
                <p className="text-sm text-muted-foreground">
                  Keep the file in context for reference. You can discuss it with AI,
                  add more details through conversation, then generate spec later.
                </p>
                <p className="text-xs text-muted-foreground mt-2">
                  💬 Best when you want to refine requirements before generating final spec
                </p>
              </div>
            </div>
          </button>
        </div>

        {/* Cancel */}
        <div className="mt-6 pt-4 border-t border-border flex justify-end">
          <Button variant="ghost" onClick={onCancel}>
            Remove File
          </Button>
        </div>
      </div>
    </div>
  )
}

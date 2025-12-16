/**
 * WorkflowCreate Component
 *
 * Modal for creating new autonomous coding workflows.
 * Allows spec input, model selection, and worktree options.
 */

import React, { useState } from 'react'
import { X, Upload, GitBranch } from 'lucide-react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { cn } from '@renderer/lib/utils'

interface WorkflowCreateProps {
  projectPath: string
  isOpen: boolean
  onClose: () => void
  onCreate: (options: CreateWorkflowInput) => Promise<void>
}

export interface CreateWorkflowInput {
  name: string
  description?: string
  specContent: string
  model: string
  useWorktree: boolean
  worktreeBranch?: string
}

const AVAILABLE_MODELS = [
  { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', description: 'Balanced performance' },
  { id: 'claude-opus-4-20250514', name: 'Claude Opus 4', description: 'Most capable' },
  { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', description: 'Fast & capable' }
]

export function WorkflowCreate({
  projectPath,
  isOpen,
  onClose,
  onCreate
}: WorkflowCreateProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [specContent, setSpecContent] = useState('')
  const [model, setModel] = useState(AVAILABLE_MODELS[0].id)
  const [useWorktree, setUseWorktree] = useState(true)
  const [worktreeBranch, setWorktreeBranch] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleImportSpec = async () => {
    try {
      // Use file dialog to select a spec file
      const result = await window.electron.dialog.selectFolder()
      // Note: We'd need a file picker here, not folder. For now, use folder picker path
      if (result.success && result.path) {
        // Read the file
        const content = await window.electron.files.readFile(result.path)
        if (content.success && content.content) {
          setSpecContent(content.content)
        }
      }
    } catch (err) {
      setError('Failed to import spec file')
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!name.trim()) {
      setError('Workflow name is required')
      return
    }

    if (!specContent.trim()) {
      setError('Spec content is required')
      return
    }

    setIsSubmitting(true)

    try {
      await onCreate({
        name: name.trim(),
        description: description.trim() || undefined,
        specContent: specContent.trim(),
        model,
        useWorktree,
        worktreeBranch: worktreeBranch.trim() || undefined
      })
      // Reset form
      setName('')
      setDescription('')
      setSpecContent('')
      setModel(AVAILABLE_MODELS[0].id)
      setUseWorktree(true)
      setWorktreeBranch('')
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create workflow')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-2xl max-h-[90vh] overflow-auto bg-background border border-border rounded-lg shadow-xl">
        {/* Header */}
        <div className="sticky top-0 flex items-center justify-between p-4 border-b border-border bg-background">
          <h2 className="text-lg font-semibold">Create New Workflow</h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-8 w-8"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* Error Display */}
          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded text-sm text-red-500">
              {error}
            </div>
          )}

          {/* Project Path (read-only) */}
          <div>
            <label className="block text-sm font-medium mb-1.5">
              Project
            </label>
            <Input
              value={projectPath}
              disabled
              className="bg-secondary/50"
            />
          </div>

          {/* Workflow Name */}
          <div>
            <label className="block text-sm font-medium mb-1.5">
              Workflow Name *
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., User Authentication Feature"
              required
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium mb-1.5">
              Description
            </label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description of the workflow"
            />
          </div>

          {/* Spec Content */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-sm font-medium">
                App Spec *
              </label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleImportSpec}
                className="h-7"
              >
                <Upload className="h-3 w-3 mr-1" />
                Import File
              </Button>
            </div>
            <textarea
              value={specContent}
              onChange={(e) => setSpecContent(e.target.value)}
              placeholder="Paste your app specification here..."
              className={cn(
                'w-full h-48 px-3 py-2 text-sm rounded-md border border-input bg-background',
                'placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring',
                'resize-none font-mono'
              )}
              required
            />
            <p className="text-xs text-muted-foreground mt-1">
              Describe the features you want to implement. Be specific about requirements.
            </p>
          </div>

          {/* Model Selection */}
          <div>
            <label className="block text-sm font-medium mb-1.5">
              Model
            </label>
            <div className="grid grid-cols-3 gap-2">
              {AVAILABLE_MODELS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setModel(m.id)}
                  className={cn(
                    'p-3 rounded-md border text-left transition-colors',
                    model === m.id
                      ? 'border-primary bg-primary/10'
                      : 'border-border hover:border-primary/50'
                  )}
                >
                  <div className="text-sm font-medium">{m.name}</div>
                  <div className="text-xs text-muted-foreground">{m.description}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Worktree Options */}
          <div className="p-3 bg-secondary/30 rounded-lg">
            <div className="flex items-center gap-3 mb-2">
              <input
                type="checkbox"
                id="useWorktree"
                checked={useWorktree}
                onChange={(e) => setUseWorktree(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300"
              />
              <label htmlFor="useWorktree" className="text-sm font-medium flex items-center gap-2">
                <GitBranch className="h-4 w-4" />
                Use Git Worktree
              </label>
            </div>
            <p className="text-xs text-muted-foreground mb-3 ml-7">
              Create an isolated branch for this workflow. Recommended for safety.
            </p>

            {useWorktree && (
              <div className="ml-7">
                <label className="block text-xs font-medium mb-1">
                  Branch Name (optional)
                </label>
                <Input
                  value={worktreeBranch}
                  onChange={(e) => setWorktreeBranch(e.target.value)}
                  placeholder="auto-generated if empty"
                  className="text-sm"
                />
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-4 border-t border-border">
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || !name.trim() || !specContent.trim()}
            >
              {isSubmitting ? 'Creating...' : 'Create Workflow'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

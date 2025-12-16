/**
 * SpecEditor Component
 *
 * Multi-line text editor for viewing and editing app specifications.
 * Supports file import and save functionality.
 */

import React, { useState, useEffect } from 'react'
import {
  FileText,
  Upload,
  Download,
  Edit3,
  Eye,
  Save,
  RotateCcw
} from 'lucide-react'
import { Button } from '../ui/button'
import { cn } from '@renderer/lib/utils'
import type { WorkflowConfig } from '@shared/types'

interface SpecEditorProps {
  workflow: WorkflowConfig
  onSave?: (content: string) => Promise<void>
}

export function SpecEditor({ workflow, onSave }: SpecEditorProps) {
  const [content, setContent] = useState('')
  const [originalContent, setOriginalContent] = useState('')
  const [isEditing, setIsEditing] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasChanges, setHasChanges] = useState(false)

  // Load spec content on mount or workflow change
  useEffect(() => {
    loadSpec()
  }, [workflow.id, workflow.specFile])

  const loadSpec = async () => {
    setIsLoading(true)
    setError(null)

    try {
      const projectPath = workflow.worktreePath || workflow.projectPath
      const specPath = `${projectPath}/${workflow.specFile}`

      const result = await window.electron.files.readFile(specPath)

      if (result.success && result.content) {
        setContent(result.content)
        setOriginalContent(result.content)
        setHasChanges(false)
      } else {
        setError(result.error || 'Failed to load spec file')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load spec')
    } finally {
      setIsLoading(false)
    }
  }

  const handleSave = async () => {
    if (!hasChanges) return

    setIsSaving(true)
    setError(null)

    try {
      if (onSave) {
        await onSave(content)
      } else {
        // Default: save to file
        const projectPath = workflow.worktreePath || workflow.projectPath
        const specPath = `${projectPath}/${workflow.specFile}`

        const result = await window.electron.files.writeFile(specPath, content)

        if (!result.success) {
          throw new Error(result.error || 'Failed to save spec file')
        }
      }

      setOriginalContent(content)
      setHasChanges(false)
      setIsEditing(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save spec')
    } finally {
      setIsSaving(false)
    }
  }

  const handleRevert = () => {
    setContent(originalContent)
    setHasChanges(false)
  }

  const handleContentChange = (newContent: string) => {
    setContent(newContent)
    setHasChanges(newContent !== originalContent)
  }

  const handleImport = async () => {
    // Note: This would ideally use a file picker dialog
    // For now, we'll prompt for a path
    const path = prompt('Enter the path to the spec file:')
    if (!path) return

    setIsLoading(true)
    setError(null)

    try {
      const result = await window.electron.files.readFile(path)

      if (result.success && result.content) {
        handleContentChange(result.content)
        setIsEditing(true)
      } else {
        setError(result.error || 'Failed to import file')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import file')
    } finally {
      setIsLoading(false)
    }
  }

  const handleExport = () => {
    // Create a blob and download link
    const blob = new Blob([content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `spec-${workflow.id}.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // Word count for stats
  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0
  const lineCount = content.split('\n').length

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-semibold text-sm">App Spec</h2>
          {hasChanges && (
            <span className="text-xs bg-yellow-500/20 text-yellow-500 px-1.5 py-0.5 rounded">
              Modified
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleImport}
            disabled={isLoading}
            className="h-7 w-7"
            title="Import from file"
          >
            <Upload className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleExport}
            disabled={isLoading || !content}
            className="h-7 w-7"
            title="Export to file"
          >
            <Download className="h-3 w-3" />
          </Button>
          <div className="w-px h-4 bg-border mx-1" />
          <Button
            variant={isEditing ? 'default' : 'ghost'}
            size="icon"
            onClick={() => setIsEditing(!isEditing)}
            className="h-7 w-7"
            title={isEditing ? 'View mode' : 'Edit mode'}
          >
            {isEditing ? <Eye className="h-3 w-3" /> : <Edit3 className="h-3 w-3" />}
          </Button>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="mx-4 mt-3 p-2 bg-red-500/10 border border-red-500/20 rounded text-xs text-red-500">
          {error}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {isLoading ? (
          <div className="h-full flex items-center justify-center text-muted-foreground">
            Loading spec...
          </div>
        ) : isEditing ? (
          <textarea
            value={content}
            onChange={(e) => handleContentChange(e.target.value)}
            className={cn(
              'w-full h-full p-4 text-sm font-mono resize-none',
              'bg-background border-0 focus:outline-none focus:ring-0',
              'placeholder:text-muted-foreground'
            )}
            placeholder="Enter your app specification here..."
            spellCheck={false}
          />
        ) : (
          <div className="h-full overflow-auto p-4">
            <pre className="text-sm font-mono whitespace-pre-wrap break-words">
              {content || (
                <span className="text-muted-foreground italic">
                  No spec content. Click edit to add specifications.
                </span>
              )}
            </pre>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-border flex items-center justify-between shrink-0 bg-secondary/30">
        <div className="text-xs text-muted-foreground">
          {lineCount} lines, {wordCount} words
        </div>
        <div className="flex items-center gap-2">
          {hasChanges && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRevert}
                disabled={isSaving}
                className="h-7"
              >
                <RotateCcw className="h-3 w-3 mr-1" />
                Revert
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={handleSave}
                disabled={isSaving}
                className="h-7"
              >
                <Save className="h-3 w-3 mr-1" />
                {isSaving ? 'Saving...' : 'Save'}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

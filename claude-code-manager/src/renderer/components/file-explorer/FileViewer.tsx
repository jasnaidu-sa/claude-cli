import React, { useEffect, useState } from 'react'
import { X, Save, FileCode, Copy, Check } from 'lucide-react'
import { Button } from '../ui/button'
import { useUIStore } from '@renderer/stores/ui-store'
import { cn } from '@renderer/lib/utils'

export function FileViewer() {
  const { selectedFile, setSelectedFile } = useUIStore()
  const [content, setContent] = useState('')
  const [isEditing, setIsEditing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (selectedFile) {
      setContent(selectedFile.content)
      setIsEditing(false)
    }
  }, [selectedFile])

  if (!selectedFile) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        <div className="text-center">
          <FileCode className="h-12 w-12 mx-auto mb-2 opacity-30" />
          <p className="text-sm">Select a file to view</p>
        </div>
      </div>
    )
  }

  const fileName = selectedFile.path.split(/[/\\]/).pop() || 'file'
  const ext = fileName.split('.').pop()?.toLowerCase() || ''

  const handleSave = async () => {
    setIsSaving(true)
    try {
      await window.electron.files.writeFile(selectedFile.path, content)
      setSelectedFile({ ...selectedFile, content })
      setIsEditing(false)
    } catch (error) {
      console.error('Failed to save file:', error)
    }
    setIsSaving(false)
  }

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const getLanguage = (extension: string): string => {
    const map: Record<string, string> = {
      ts: 'typescript',
      tsx: 'typescript',
      js: 'javascript',
      jsx: 'javascript',
      py: 'python',
      json: 'json',
      md: 'markdown',
      css: 'css',
      html: 'html',
      yml: 'yaml',
      yaml: 'yaml'
    }
    return map[extension] || 'text'
  }

  return (
    <div className="h-full flex flex-col bg-card rounded-lg border border-border overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2 min-w-0">
          <FileCode className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-sm font-medium truncate">{fileName}</span>
          <span className="text-xs text-muted-foreground px-1.5 py-0.5 bg-muted rounded">
            {getLanguage(ext)}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleCopy}
            className="h-7 w-7"
            title="Copy content"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
          </Button>
          {isEditing && (
            <Button
              variant="ghost"
              size="icon"
              onClick={handleSave}
              disabled={isSaving}
              className="h-7 w-7"
              title="Save"
            >
              <Save className={cn('h-3.5 w-3.5', isSaving && 'animate-pulse')} />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSelectedFile(null)}
            className="h-7 w-7"
            title="Close"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        <textarea
          value={content}
          onChange={(e) => {
            setContent(e.target.value)
            setIsEditing(true)
          }}
          className={cn(
            'w-full h-full p-4 bg-transparent resize-none outline-none',
            'font-mono text-sm leading-relaxed',
            'selection:bg-primary/30'
          )}
          spellCheck={false}
        />
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-3 py-1.5 border-t border-border text-xs text-muted-foreground bg-muted/30">
        <span>{content.split('\n').length} lines</span>
        <span>{content.length} characters</span>
      </div>
    </div>
  )
}

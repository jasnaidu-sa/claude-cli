import React from 'react'
import { FileEdit, Eye, FilePlus, Trash2, Check } from 'lucide-react'
import { cn, formatTime, truncatePath } from '@renderer/lib/utils'
import type { EditedFile } from '@shared/types'

interface EditTrackerProps {
  files: EditedFile[]
  compact?: boolean
}

export function EditTracker({ files, compact = false }: EditTrackerProps) {
  if (files.length === 0) {
    return null
  }

  const getIcon = (action: EditedFile['action']) => {
    switch (action) {
      case 'read':
        return Eye
      case 'edit':
        return FileEdit
      case 'write':
      case 'create':
        return FilePlus
      case 'delete':
        return Trash2
      default:
        return FileEdit
    }
  }

  const getActionColor = (action: EditedFile['action']) => {
    switch (action) {
      case 'read':
        return 'text-blue-400'
      case 'edit':
        return 'text-yellow-400'
      case 'write':
      case 'create':
        return 'text-green-400'
      case 'delete':
        return 'text-red-400'
      default:
        return 'text-muted-foreground'
    }
  }

  // Sort by most recent first
  const sortedFiles = [...files].sort((a, b) => b.timestamp - a.timestamp)

  if (compact) {
    return (
      <div className="p-2">
        <div className="text-xs text-muted-foreground mb-1">Recent Edits</div>
        <div className="space-y-1">
          {sortedFiles.slice(0, 3).map((file, idx) => {
            const Icon = getIcon(file.action)
            const fileName = file.path.split('/').pop() || file.path
            return (
              <div
                key={`${file.path}-${idx}`}
                className="flex items-center gap-2 text-xs"
              >
                <Icon className={cn('h-3 w-3', getActionColor(file.action))} />
                <span className="truncate flex-1">{fileName}</span>
                {file.status === 'completed' && (
                  <Check className="h-3 w-3 text-green-500" />
                )}
              </div>
            )
          })}
          {sortedFiles.length > 3 && (
            <div className="text-xs text-muted-foreground">
              +{sortedFiles.length - 3} more
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="p-3">
      <div className="flex items-center gap-2 mb-2">
        <FileEdit className="h-4 w-4 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Recent Edits
        </span>
        <span className="text-xs bg-muted px-1.5 py-0.5 rounded">
          {files.length}
        </span>
      </div>

      <div className="space-y-1 max-h-[150px] overflow-auto">
        {sortedFiles.map((file, idx) => {
          const Icon = getIcon(file.action)
          return (
            <div
              key={`${file.path}-${idx}`}
              className="flex items-center gap-2 py-1 px-2 rounded hover:bg-accent text-sm group"
            >
              <Icon className={cn('h-4 w-4 shrink-0', getActionColor(file.action))} />
              <span className="truncate flex-1" title={file.path}>
                {truncatePath(file.path, 30)}
              </span>
              <span className="text-xs text-muted-foreground shrink-0">
                {formatTime(file.timestamp)}
              </span>
              {file.status === 'completed' ? (
                <Check className="h-3 w-3 text-green-500 shrink-0" />
              ) : (
                <div className="h-3 w-3 rounded-full bg-yellow-500 animate-pulse shrink-0" />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

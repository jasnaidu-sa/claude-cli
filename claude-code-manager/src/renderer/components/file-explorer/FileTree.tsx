import React, { useEffect, useState, useCallback } from 'react'
import {
  ChevronRight,
  ChevronDown,
  File,
  Folder,
  FolderOpen,
  FileCode,
  FileJson,
  FileText,
  FileType
} from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'
import type { FileNode, EditedFile } from '@shared/types'

interface FileTreeProps {
  projectPath: string
  editedFiles?: EditedFile[]
}

export function FileTree({ projectPath, editedFiles = [] }: FileTreeProps) {
  const [nodes, setNodes] = useState<FileNode[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const { setSelectedFile, selectedFile } = useUIStore()

  // Load directory contents
  const loadDirectory = useCallback(async () => {
    setLoading(true)
    try {
      const result = await window.electron.files.readDir(projectPath, 4)
      if (result.success && result.files) {
        setNodes(result.files)
        // Auto-expand first level
        const firstLevel = result.files
          .filter((n) => n.isDirectory)
          .map((n) => n.id)
        setExpanded(new Set(firstLevel))
      }
    } catch (error) {
      console.error('Failed to load directory:', error)
    }
    setLoading(false)
  }, [projectPath])

  useEffect(() => {
    loadDirectory()
  }, [loadDirectory])

  // Watch for file changes
  useEffect(() => {
    window.electron.files.watch(projectPath)

    const unsubscribe = window.electron.files.onChange((change) => {
      if (change.dirPath === projectPath) {
        // Reload on changes
        loadDirectory()
      }
    })

    return () => {
      window.electron.files.unwatch(projectPath)
      unsubscribe()
    }
  }, [projectPath, loadDirectory])

  const toggleExpand = (nodeId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(nodeId)) {
        next.delete(nodeId)
      } else {
        next.add(nodeId)
      }
      return next
    })
  }

  const editedPaths = new Set(editedFiles.map((f) => f.path))

  const handleFileClick = async (node: FileNode) => {
    if (node.isDirectory) {
      toggleExpand(node.id)
    } else {
      // Load file content
      try {
        const result = await window.electron.files.readFile(node.path)
        if (result.success && result.content !== undefined) {
          setSelectedFile({ path: node.path, content: result.content })
        }
      } catch (error) {
        console.error('Failed to read file:', error)
      }
    }
  }

  const renderNode = (node: FileNode, depth: number = 0): React.ReactNode => {
    const isExpanded = expanded.has(node.id)
    const isEdited = editedPaths.has(node.path)
    const isSelected = selectedFile?.path === node.path
    const Icon = getFileIcon(node)

    return (
      <div key={node.id}>
        <button
          className={cn(
            'w-full flex items-center gap-1 px-2 py-1 text-sm rounded-sm transition-colors',
            'hover:bg-accent text-left',
            isEdited && 'bg-yellow-500/10',
            isSelected && 'bg-primary/20 text-primary'
          )}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
          onClick={() => handleFileClick(node)}
        >
          {node.isDirectory ? (
            <>
              {isExpanded ? (
                <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
              ) : (
                <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
              )}
              {isExpanded ? (
                <FolderOpen className="h-4 w-4 text-blue-400 shrink-0" />
              ) : (
                <Folder className="h-4 w-4 text-blue-400 shrink-0" />
              )}
            </>
          ) : (
            <>
              <span className="w-3" />
              <Icon className={cn('h-4 w-4 shrink-0', getIconColor(node.name))} />
            </>
          )}
          <span className={cn('truncate', isEdited && 'text-yellow-500')}>
            {node.name}
          </span>
          {isEdited && (
            <span className="ml-auto text-xs text-yellow-500">editing</span>
          )}
        </button>

        {node.isDirectory && isExpanded && node.children && (
          <div>
            {node.children.map((child) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  if (loading) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        Loading files...
      </div>
    )
  }

  return (
    <div className="py-2 overflow-auto h-full">
      {nodes.map((node) => renderNode(node, 0))}
    </div>
  )
}

function getFileIcon(node: FileNode): React.ComponentType<{ className?: string }> {
  if (node.isDirectory) return Folder

  const ext = node.name.split('.').pop()?.toLowerCase()

  switch (ext) {
    case 'ts':
    case 'tsx':
    case 'js':
    case 'jsx':
    case 'py':
    case 'rs':
    case 'go':
    case 'java':
    case 'rb':
    case 'php':
      return FileCode
    case 'json':
      return FileJson
    case 'md':
    case 'txt':
    case 'mdx':
      return FileText
    default:
      return File
  }
}

function getIconColor(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase()

  const colors: Record<string, string> = {
    ts: 'text-blue-400',
    tsx: 'text-blue-400',
    js: 'text-yellow-400',
    jsx: 'text-yellow-400',
    json: 'text-yellow-500',
    md: 'text-gray-400',
    py: 'text-green-400',
    rs: 'text-orange-400',
    go: 'text-cyan-400',
    css: 'text-pink-400',
    scss: 'text-pink-400',
    html: 'text-orange-500'
  }

  return colors[ext || ''] || 'text-muted-foreground'
}

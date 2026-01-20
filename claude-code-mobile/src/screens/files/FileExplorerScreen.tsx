import React, { useEffect, useState, useCallback } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { apiClient } from '../../api/client'
import type { FileTreeNode } from '../../api/client'

interface FileExplorerScreenProps {
  projectPath: string
  onBack: () => void
  onFileSelect: (filePath: string, fileName: string) => void
}

export function FileExplorerScreen({
  projectPath,
  onBack,
  onFileSelect,
}: FileExplorerScreenProps) {
  const insets = useSafeAreaInsets()
  const [tree, setTree] = useState<FileTreeNode[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())

  const loadTree = useCallback(async () => {
    try {
      setError(null)
      const result = await apiClient.files.getTree(projectPath, 3)

      if (result.success && result.data) {
        setTree(result.data)
      } else {
        setError(result.error || 'Failed to load file tree')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load file tree')
    } finally {
      setIsLoading(false)
      setRefreshing(false)
    }
  }, [projectPath])

  useEffect(() => {
    loadTree()
  }, [loadTree])

  const onRefresh = useCallback(() => {
    setRefreshing(true)
    loadTree()
  }, [loadTree])

  const toggleExpand = (path: string) => {
    setExpandedPaths(prev => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }

  const handleFilePress = (node: FileTreeNode) => {
    if (node.type === 'directory') {
      toggleExpand(node.path)
    } else {
      onFileSelect(node.path, node.name)
    }
  }

  const getProjectName = () => {
    const parts = projectPath.split(/[/\\]/)
    return parts[parts.length - 1] || projectPath
  }

  if (isLoading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color="#3b82f6" />
        <Text style={styles.loadingText}>Loading files...</Text>
      </View>
    )
  }

  if (error) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onBack} style={styles.backButton}>
            <Text style={styles.backButtonText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Files</Text>
          <View style={styles.headerRight} />
        </View>
        <View style={styles.errorContainer}>
          <Text style={styles.errorIcon}>⚠</Text>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={loadTree}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <View style={styles.titleContainer}>
          <Text style={styles.title}>{getProjectName()}</Text>
          <Text style={styles.subtitle}>Read-only</Text>
        </View>
        <View style={styles.headerRight} />
      </View>

      {/* Project Path */}
      <View style={styles.pathBar}>
        <Text style={styles.pathText} numberOfLines={1}>
          {projectPath}
        </Text>
      </View>

      {/* File Tree */}
      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#3b82f6"
          />
        }
      >
        {tree.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>📁</Text>
            <Text style={styles.emptyText}>No files found</Text>
          </View>
        ) : (
          tree.map(node => (
            <FileTreeItem
              key={node.path}
              node={node}
              depth={0}
              expandedPaths={expandedPaths}
              onPress={handleFilePress}
            />
          ))
        )}
      </ScrollView>

      {/* Footer hint */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 8 }]}>
        <Text style={styles.footerText}>
          Tap folder to expand • Tap file to view
        </Text>
      </View>
    </View>
  )
}

interface FileTreeItemProps {
  node: FileTreeNode
  depth: number
  expandedPaths: Set<string>
  onPress: (node: FileTreeNode) => void
}

function FileTreeItem({ node, depth, expandedPaths, onPress }: FileTreeItemProps) {
  const isExpanded = expandedPaths.has(node.path)
  const isDirectory = node.type === 'directory'
  const hasChildren = node.children && node.children.length > 0

  const getFileIcon = (name: string, type: 'file' | 'directory') => {
    if (type === 'directory') {
      return isExpanded ? '📂' : '📁'
    }

    const ext = name.split('.').pop()?.toLowerCase()
    switch (ext) {
      case 'ts':
      case 'tsx':
        return '🔷'
      case 'js':
      case 'jsx':
        return '🟨'
      case 'json':
        return '📋'
      case 'md':
        return '📝'
      case 'css':
      case 'scss':
        return '🎨'
      case 'html':
        return '🌐'
      case 'png':
      case 'jpg':
      case 'jpeg':
      case 'gif':
      case 'svg':
        return '🖼'
      case 'py':
        return '🐍'
      case 'sh':
      case 'bash':
        return '⚡'
      case 'yml':
      case 'yaml':
        return '⚙️'
      default:
        return '📄'
    }
  }

  return (
    <View>
      <TouchableOpacity
        style={[styles.treeItem, { paddingLeft: 16 + depth * 20 }]}
        onPress={() => onPress(node)}
        activeOpacity={0.7}
      >
        <Text style={styles.itemIcon}>{getFileIcon(node.name, node.type)}</Text>
        <Text
          style={[
            styles.itemName,
            isDirectory && styles.directoryName,
          ]}
          numberOfLines={1}
        >
          {node.name}
        </Text>
        {isDirectory && hasChildren && (
          <Text style={styles.chevron}>{isExpanded ? '▼' : '▶'}</Text>
        )}
        {!isDirectory && node.size !== undefined && (
          <Text style={styles.fileSize}>{formatFileSize(node.size)}</Text>
        )}
      </TouchableOpacity>

      {isExpanded && node.children && (
        <View>
          {node.children.map(child => (
            <FileTreeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              expandedPaths={expandedPaths}
              onPress={onPress}
            />
          ))}
        </View>
      )}
    </View>
  )
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#888',
    marginTop: 12,
    fontSize: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  backButton: {
    marginRight: 12,
  },
  backButtonText: {
    color: '#3b82f6',
    fontSize: 16,
  },
  titleContainer: {
    flex: 1,
    alignItems: 'center',
  },
  title: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
  },
  subtitle: {
    color: '#666',
    fontSize: 11,
    marginTop: 2,
  },
  headerRight: {
    width: 60,
  },
  pathBar: {
    backgroundColor: '#1a1a1a',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  pathText: {
    color: '#666',
    fontSize: 12,
    fontFamily: 'monospace',
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    paddingVertical: 8,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 48,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 12,
    opacity: 0.5,
  },
  emptyText: {
    color: '#666',
    fontSize: 14,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  errorIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  errorText: {
    color: '#ef4444',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 16,
  },
  retryButton: {
    backgroundColor: '#3b82f6',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  treeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingRight: 16,
  },
  itemIcon: {
    fontSize: 16,
    marginRight: 10,
  },
  itemName: {
    flex: 1,
    color: '#ccc',
    fontSize: 14,
  },
  directoryName: {
    color: '#fff',
    fontWeight: '500',
  },
  chevron: {
    color: '#666',
    fontSize: 10,
    marginLeft: 8,
  },
  fileSize: {
    color: '#666',
    fontSize: 11,
    marginLeft: 8,
  },
  footer: {
    alignItems: 'center',
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#222',
  },
  footerText: {
    color: '#444',
    fontSize: 11,
  },
})

import { watch, FSWatcher } from 'chokidar'
import { readdir, stat } from 'fs/promises'
import { join, basename } from 'path'
import { EventEmitter } from 'events'
import type { FileNode } from '@shared/types'

export class FileWatcher extends EventEmitter {
  private watchers: Map<string, FSWatcher> = new Map()

  constructor() {
    super()
  }

  async readDirectory(dirPath: string, depth: number = 3): Promise<FileNode[]> {
    return this.readDirRecursive(dirPath, depth)
  }

  private async readDirRecursive(dirPath: string, depth: number): Promise<FileNode[]> {
    if (depth <= 0) return []

    try {
      const entries = await readdir(dirPath, { withFileTypes: true })
      const nodes: FileNode[] = []

      // Sort: directories first, then files, alphabetically
      const sorted = entries.sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1
        if (!a.isDirectory() && b.isDirectory()) return 1
        return a.name.localeCompare(b.name)
      })

      for (const entry of sorted) {
        // Skip hidden files and common ignore patterns
        if (this.shouldIgnore(entry.name)) continue

        const fullPath = join(dirPath, entry.name)
        const isDirectory = entry.isDirectory()

        const node: FileNode = {
          id: fullPath,
          name: entry.name,
          path: fullPath,
          isDirectory
        }

        if (isDirectory) {
          node.children = await this.readDirRecursive(fullPath, depth - 1)
        }

        nodes.push(node)
      }

      return nodes
    } catch (error) {
      console.error(`Error reading directory ${dirPath}:`, error)
      return []
    }
  }

  private shouldIgnore(name: string): boolean {
    const ignorePatterns = [
      'node_modules',
      '.git',
      '.next',
      '.cache',
      'dist',
      'build',
      '.DS_Store',
      'coverage',
      '.turbo',
      '.vercel',
      '__pycache__',
      '.pytest_cache',
      'venv',
      '.env.local'
    ]

    if (name.startsWith('.') && name !== '.github' && name !== '.env.example') {
      return true
    }

    return ignorePatterns.includes(name)
  }

  watch(dirPath: string, callback: (event: string, path: string) => void): void {
    if (this.watchers.has(dirPath)) {
      return
    }

    const watcher = watch(dirPath, {
      ignored: /(^|[\/\\])\.|node_modules|\.git/,
      persistent: true,
      ignoreInitial: true,
      depth: 5
    })

    watcher
      .on('add', (path) => callback('add', path))
      .on('change', (path) => callback('change', path))
      .on('unlink', (path) => callback('unlink', path))
      .on('addDir', (path) => callback('addDir', path))
      .on('unlinkDir', (path) => callback('unlinkDir', path))

    this.watchers.set(dirPath, watcher)
  }

  unwatch(dirPath: string): void {
    const watcher = this.watchers.get(dirPath)
    if (watcher) {
      watcher.close()
      this.watchers.delete(dirPath)
    }
  }

  unwatchAll(): void {
    for (const [path, watcher] of this.watchers) {
      watcher.close()
    }
    this.watchers.clear()
  }
}

// Singleton instance
export const fileWatcher = new FileWatcher()

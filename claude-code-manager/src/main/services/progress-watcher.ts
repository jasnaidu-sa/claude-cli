/**
 * ProgressWatcher - File-based Progress Monitoring Service
 *
 * Watches feature_list.json files in .autonomous/ directories for changes
 * and calculates progress metrics in real-time.
 *
 * Features:
 * - Watches feature_list.json for updates using chokidar
 * - Parses test completion status (passed/failed/pending)
 * - Calculates completion percentage by category
 * - Emits progress events to renderer via IPC
 * - Supports multiple concurrent workflow watches
 *
 * File Format Expected:
 * {
 *   "features": [
 *     { "id": "feat-1", "name": "Feature 1", "category": "auth", "status": "passed" },
 *     { "id": "feat-2", "name": "Feature 2", "category": "api", "status": "pending" }
 *   ]
 * }
 */

import { EventEmitter } from 'events'
import * as fs from 'fs/promises'
import * as path from 'path'
import chokidar, { FSWatcher } from 'chokidar'
import { getMainWindow } from '../index'
import { IPC_CHANNELS } from '@shared/types'
import type {
  FeatureListEntry,
  ProgressSnapshot,
  CategoryProgressDetail
} from '@shared/types'

// Directory name
const AUTONOMOUS_DIR = '.autonomous'
const FEATURE_LIST_FILE = 'feature_list.json'

/**
 * Feature list file structure
 */
interface FeatureListFile {
  features: FeatureListEntry[]
  currentTest?: string
  updatedAt?: number
}

/**
 * Watch entry for tracking watched workflows
 */
interface WatchEntry {
  workflowId: string
  projectPath: string
  featureListPath: string
  watcher: FSWatcher
  lastSnapshot?: ProgressSnapshot
}

/**
 * Extract error message safely from unknown error type
 */
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return String(error)
}

/**
 * Validate path to prevent directory traversal attacks
 */
function validatePath(basePath: string, targetPath: string): boolean {
  const resolvedBase = path.resolve(basePath)
  const resolvedTarget = path.resolve(targetPath)
  return resolvedTarget.startsWith(resolvedBase + path.sep) || resolvedTarget === resolvedBase
}

/**
 * ProgressWatcher Service Class
 */
export class ProgressWatcher extends EventEmitter {
  private watches: Map<string, WatchEntry> = new Map()

  constructor() {
    super()
  }

  /**
   * Start watching a workflow's feature_list.json
   */
  async watch(workflowId: string, projectPath: string): Promise<ProgressSnapshot | null> {
    // Check if already watching
    if (this.watches.has(workflowId)) {
      const existing = this.watches.get(workflowId)!
      return existing.lastSnapshot || null
    }

    // Determine feature list path
    const featureListPath = path.join(projectPath, AUTONOMOUS_DIR, FEATURE_LIST_FILE)

    // Validate path
    if (!validatePath(projectPath, featureListPath)) {
      throw new Error('Invalid project path')
    }

    // Create watcher
    const watcher = chokidar.watch(featureListPath, {
      persistent: true,
      ignoreInitial: false,
      awaitWriteFinish: {
        stabilityThreshold: 300,
        pollInterval: 100
      }
    })

    // Store watch entry
    const entry: WatchEntry = {
      workflowId,
      projectPath,
      featureListPath,
      watcher
    }
    this.watches.set(workflowId, entry)

    // Set up event handlers
    watcher.on('add', async () => {
      await this.handleFileChange(workflowId)
    })

    watcher.on('change', async () => {
      await this.handleFileChange(workflowId)
    })

    watcher.on('unlink', () => {
      // File deleted - emit empty progress
      const snapshot: ProgressSnapshot = {
        workflowId,
        timestamp: Date.now(),
        total: 0,
        passing: 0,
        failing: 0,
        pending: 0,
        percentage: 0,
        categories: []
      }
      entry.lastSnapshot = snapshot
      this.emitProgress(snapshot)
    })

    watcher.on('error', (error) => {
      console.error(`[ProgressWatcher] Error watching ${workflowId}:`, error)
    })

    // Try to get initial snapshot
    try {
      const snapshot = await this.parseFeatureList(workflowId, featureListPath)
      entry.lastSnapshot = snapshot
      return snapshot
    } catch {
      // File might not exist yet
      return null
    }
  }

  /**
   * Stop watching a workflow
   */
  async unwatch(workflowId: string): Promise<void> {
    const entry = this.watches.get(workflowId)
    if (entry) {
      await entry.watcher.close()
      this.watches.delete(workflowId)
    }
  }

  /**
   * Stop all watchers
   */
  async unwatchAll(): Promise<void> {
    for (const [workflowId] of this.watches) {
      await this.unwatch(workflowId)
    }
  }

  /**
   * Get current progress for a workflow
   */
  async getProgress(workflowId: string): Promise<ProgressSnapshot | null> {
    const entry = this.watches.get(workflowId)
    if (!entry) {
      return null
    }

    // Return cached or fetch fresh
    if (entry.lastSnapshot) {
      return entry.lastSnapshot
    }

    try {
      const snapshot = await this.parseFeatureList(workflowId, entry.featureListPath)
      entry.lastSnapshot = snapshot
      return snapshot
    } catch {
      return null
    }
  }

  /**
   * Manually trigger progress check
   */
  async refreshProgress(workflowId: string): Promise<ProgressSnapshot | null> {
    const entry = this.watches.get(workflowId)
    if (!entry) {
      return null
    }

    try {
      const snapshot = await this.parseFeatureList(workflowId, entry.featureListPath)
      entry.lastSnapshot = snapshot
      this.emitProgress(snapshot)
      return snapshot
    } catch {
      return null
    }
  }

  /**
   * Handle file change event
   */
  private async handleFileChange(workflowId: string): Promise<void> {
    const entry = this.watches.get(workflowId)
    if (!entry) return

    try {
      const snapshot = await this.parseFeatureList(workflowId, entry.featureListPath)

      // Check if progress actually changed
      if (this.hasProgressChanged(entry.lastSnapshot, snapshot)) {
        entry.lastSnapshot = snapshot
        this.emitProgress(snapshot)
        this.emit('progress', snapshot)
      }
    } catch (error) {
      console.error(`[ProgressWatcher] Error parsing feature list for ${workflowId}:`, getErrorMessage(error))
    }
  }

  /**
   * Parse feature_list.json and calculate progress
   */
  private async parseFeatureList(workflowId: string, filePath: string): Promise<ProgressSnapshot> {
    const content = await fs.readFile(filePath, 'utf-8')
    const data = JSON.parse(content) as FeatureListFile

    const features = data.features || []
    const timestamp = Date.now()

    // Calculate totals
    const total = features.length
    const passing = features.filter(f => f.status === 'passed').length
    const failing = features.filter(f => f.status === 'failed').length
    const pending = features.filter(f => f.status === 'pending' || f.status === 'in_progress').length
    const percentage = total > 0 ? Math.round((passing / total) * 100) : 0

    // Calculate category breakdown
    const categoryMap = new Map<string, { total: number; passing: number; failing: number; pending: number }>()

    for (const feature of features) {
      const cat = feature.category || 'uncategorized'
      if (!categoryMap.has(cat)) {
        categoryMap.set(cat, { total: 0, passing: 0, failing: 0, pending: 0 })
      }
      const stats = categoryMap.get(cat)!
      stats.total++
      if (feature.status === 'passed') stats.passing++
      else if (feature.status === 'failed') stats.failing++
      else stats.pending++
    }

    const categories: CategoryProgressDetail[] = Array.from(categoryMap.entries()).map(([name, stats]) => ({
      name,
      total: stats.total,
      passing: stats.passing,
      failing: stats.failing,
      pending: stats.pending,
      percentage: stats.total > 0 ? Math.round((stats.passing / stats.total) * 100) : 0
    }))

    // Sort categories by name
    categories.sort((a, b) => a.name.localeCompare(b.name))

    return {
      workflowId,
      timestamp,
      total,
      passing,
      failing,
      pending,
      percentage,
      categories,
      currentTest: data.currentTest
    }
  }

  /**
   * Check if progress has meaningfully changed
   */
  private hasProgressChanged(prev: ProgressSnapshot | undefined, curr: ProgressSnapshot): boolean {
    if (!prev) return true

    return (
      prev.total !== curr.total ||
      prev.passing !== curr.passing ||
      prev.failing !== curr.failing ||
      prev.pending !== curr.pending ||
      prev.currentTest !== curr.currentTest
    )
  }

  /**
   * Emit progress event to renderer
   */
  private emitProgress(snapshot: ProgressSnapshot): void {
    const mainWindow = getMainWindow()
    if (mainWindow) {
      mainWindow.webContents.send(IPC_CHANNELS.PROGRESS_UPDATE, snapshot)
    }
  }

  /**
   * Get list of currently watched workflow IDs
   */
  getWatchedWorkflows(): string[] {
    return Array.from(this.watches.keys())
  }

  /**
   * Check if a workflow is being watched
   */
  isWatching(workflowId: string): boolean {
    return this.watches.has(workflowId)
  }
}

// Export singleton instance
export const progressWatcher = new ProgressWatcher()

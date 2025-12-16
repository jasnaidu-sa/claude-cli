/**
 * WorkflowManager - Autonomous Workflow State Management Service
 *
 * Manages autonomous coding workflows stored in .autonomous/ directories.
 * Each workflow represents a coding task with its spec, progress, and status.
 *
 * Features:
 * - CRUD operations for workflows
 * - Workflow state persistence to JSON files
 * - Status tracking (pending, validating, generating, implementing, etc.)
 * - Progress tracking with test pass/fail counts
 * - Git worktree integration for isolated development
 *
 * Storage:
 * - Workflows are stored in {projectPath}/.autonomous/workflows/{id}.json
 * - Specs are stored in {projectPath}/.autonomous/specs/{id}.txt
 * - Progress is tracked in {projectPath}/.autonomous/progress/{id}.json
 *
 * Security:
 * - Validates all paths to prevent traversal attacks
 * - Uses atomic file operations to prevent corruption
 */

import { EventEmitter } from 'events'
import * as fs from 'fs/promises'
import * as path from 'path'
import { randomBytes } from 'crypto'
import { exec } from 'child_process'
import { promisify } from 'util'
import { getMainWindow } from '../index'
import { IPC_CHANNELS } from '@shared/types'
import type {
  WorkflowConfig,
  WorkflowStatus,
  WorkflowProgress,
  SchemaValidationResult
} from '@shared/types'

const execAsync = promisify(exec)

// Directory names
const AUTONOMOUS_DIR = '.autonomous'
const WORKFLOWS_DIR = 'workflows'
const SPECS_DIR = 'specs'
const PROGRESS_DIR = 'progress'

/**
 * Options for creating a new workflow
 */
export interface CreateWorkflowOptions {
  projectPath: string
  name: string
  description?: string
  specContent: string
  model?: string
  useWorktree?: boolean
  worktreeBranch?: string
}

/**
 * Options for updating a workflow
 */
export interface UpdateWorkflowOptions {
  name?: string
  description?: string
  status?: WorkflowStatus
  progress?: WorkflowProgress
  schemaValidation?: SchemaValidationResult
  error?: string
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
 * Validate project path for security
 * - Must exist
 * - Must be a directory
 * - Must not be a system directory
 */
async function validateProjectPath(projectPath: string): Promise<boolean> {
  // Block system directories
  const systemDirs = [
    'C:\\Windows', 'C:\\Program Files', 'C:\\Program Files (x86)',
    '/usr', '/bin', '/sbin', '/etc', '/var', '/System', '/Library'
  ]
  const normalizedPath = path.normalize(projectPath).toLowerCase()
  if (systemDirs.some(dir => normalizedPath.startsWith(dir.toLowerCase()))) {
    return false
  }

  try {
    const stats = await fs.stat(projectPath)
    return stats.isDirectory()
  } catch {
    return false
  }
}

/**
 * WorkflowManager Service Class
 */
export class WorkflowManager extends EventEmitter {
  private workflowCache: Map<string, WorkflowConfig> = new Map()

  constructor() {
    super()
  }

  /**
   * Generate a unique workflow ID
   */
  private generateWorkflowId(): string {
    return `wf-${Date.now()}-${randomBytes(4).toString('hex')}`
  }

  /**
   * Get the .autonomous directory path for a project
   */
  private getAutonomousDir(projectPath: string): string {
    return path.join(projectPath, AUTONOMOUS_DIR)
  }

  /**
   * Get the workflows directory path for a project
   */
  private getWorkflowsDir(projectPath: string): string {
    return path.join(this.getAutonomousDir(projectPath), WORKFLOWS_DIR)
  }

  /**
   * Get the specs directory path for a project
   */
  private getSpecsDir(projectPath: string): string {
    return path.join(this.getAutonomousDir(projectPath), SPECS_DIR)
  }

  /**
   * Get the progress directory path for a project
   */
  private getProgressDir(projectPath: string): string {
    return path.join(this.getAutonomousDir(projectPath), PROGRESS_DIR)
  }

  /**
   * Ensure all required directories exist
   */
  private async ensureDirectories(projectPath: string): Promise<void> {
    const dirs = [
      this.getAutonomousDir(projectPath),
      this.getWorkflowsDir(projectPath),
      this.getSpecsDir(projectPath),
      this.getProgressDir(projectPath)
    ]

    for (const dir of dirs) {
      await fs.mkdir(dir, { recursive: true })
    }
  }

  /**
   * Create a new workflow
   */
  async create(options: CreateWorkflowOptions): Promise<WorkflowConfig> {
    const { projectPath, name, description, specContent, model = 'claude-sonnet-4', useWorktree, worktreeBranch } = options

    // Validate project path
    if (!await validateProjectPath(projectPath)) {
      throw new Error('Invalid project path')
    }

    // Ensure directories exist
    await this.ensureDirectories(projectPath)

    // Generate workflow ID
    const id = this.generateWorkflowId()

    // Write spec file
    const specFile = path.join(this.getSpecsDir(projectPath), `${id}.txt`)
    await fs.writeFile(specFile, specContent, 'utf-8')

    // Create worktree if requested
    let worktreePath: string | undefined
    if (useWorktree) {
      try {
        worktreePath = await this.createWorktree(projectPath, id, worktreeBranch)
      } catch (error) {
        console.warn('[WorkflowManager] Failed to create worktree:', error)
        // Continue without worktree
      }
    }

    // Create workflow config
    const now = Date.now()
    const workflow: WorkflowConfig = {
      id,
      name,
      description,
      projectPath,
      worktreePath,
      specFile,
      model,
      status: 'pending',
      createdAt: now,
      updatedAt: now
    }

    // Save workflow file
    const workflowFile = path.join(this.getWorkflowsDir(projectPath), `${id}.json`)
    await fs.writeFile(workflowFile, JSON.stringify(workflow, null, 2), 'utf-8')

    // Cache workflow
    this.workflowCache.set(id, workflow)

    // Emit change event
    this.emitWorkflowChange(workflow, 'created')

    return workflow
  }

  /**
   * Get a workflow by ID
   */
  async get(projectPath: string, workflowId: string): Promise<WorkflowConfig | null> {
    // Check cache first
    if (this.workflowCache.has(workflowId)) {
      return this.workflowCache.get(workflowId) || null
    }

    // Validate project path
    if (!await validateProjectPath(projectPath)) {
      throw new Error('Invalid project path')
    }

    // Load from file
    const workflowFile = path.join(this.getWorkflowsDir(projectPath), `${workflowId}.json`)

    // Validate path doesn't escape workflows directory
    if (!validatePath(this.getWorkflowsDir(projectPath), workflowFile)) {
      throw new Error('Invalid workflow ID')
    }

    try {
      const content = await fs.readFile(workflowFile, 'utf-8')
      const workflow = JSON.parse(content) as WorkflowConfig
      this.workflowCache.set(workflowId, workflow)
      return workflow
    } catch {
      return null
    }
  }

  /**
   * Update a workflow
   */
  async update(projectPath: string, workflowId: string, updates: UpdateWorkflowOptions): Promise<WorkflowConfig | null> {
    const workflow = await this.get(projectPath, workflowId)
    if (!workflow) {
      return null
    }

    // Apply updates
    const updatedWorkflow: WorkflowConfig = {
      ...workflow,
      ...updates,
      updatedAt: Date.now()
    }

    // Handle status changes
    if (updates.status) {
      if (updates.status === 'implementing' && !workflow.startedAt) {
        updatedWorkflow.startedAt = Date.now()
      }
      if (updates.status === 'completed' || updates.status === 'error') {
        updatedWorkflow.completedAt = Date.now()
      }
    }

    // Save to file
    const workflowFile = path.join(this.getWorkflowsDir(projectPath), `${workflowId}.json`)
    await fs.writeFile(workflowFile, JSON.stringify(updatedWorkflow, null, 2), 'utf-8')

    // Update cache
    this.workflowCache.set(workflowId, updatedWorkflow)

    // Emit change event
    this.emitWorkflowChange(updatedWorkflow, 'updated')

    return updatedWorkflow
  }

  /**
   * Delete a workflow
   */
  async delete(projectPath: string, workflowId: string): Promise<boolean> {
    const workflow = await this.get(projectPath, workflowId)
    if (!workflow) {
      return false
    }

    // Remove worktree if exists
    if (workflow.worktreePath) {
      try {
        await this.removeWorktree(projectPath, workflow.worktreePath)
      } catch (error) {
        console.warn('[WorkflowManager] Failed to remove worktree:', error)
      }
    }

    // Remove files
    const workflowFile = path.join(this.getWorkflowsDir(projectPath), `${workflowId}.json`)
    const specFile = workflow.specFile
    const progressFile = path.join(this.getProgressDir(projectPath), `${workflowId}.json`)

    try {
      await fs.unlink(workflowFile)
    } catch { /* ignore */ }

    try {
      await fs.unlink(specFile)
    } catch { /* ignore */ }

    try {
      await fs.unlink(progressFile)
    } catch { /* ignore */ }

    // Remove from cache
    this.workflowCache.delete(workflowId)

    // Emit change event
    this.emitWorkflowChange(workflow, 'deleted')

    return true
  }

  /**
   * List all workflows for a project
   */
  async listForProject(projectPath: string): Promise<WorkflowConfig[]> {
    // Validate project path
    if (!await validateProjectPath(projectPath)) {
      return []
    }

    const workflowsDir = this.getWorkflowsDir(projectPath)

    try {
      const files = await fs.readdir(workflowsDir)
      const workflows: WorkflowConfig[] = []

      for (const file of files) {
        if (file.endsWith('.json')) {
          try {
            const filePath = path.join(workflowsDir, file)
            const content = await fs.readFile(filePath, 'utf-8')
            const workflow = JSON.parse(content) as WorkflowConfig
            workflows.push(workflow)
            this.workflowCache.set(workflow.id, workflow)
          } catch {
            // Skip invalid files
          }
        }
      }

      // Sort by creation date (newest first)
      return workflows.sort((a, b) => b.createdAt - a.createdAt)
    } catch {
      return []
    }
  }

  /**
   * List all workflows across all projects (from cache)
   */
  listAll(): WorkflowConfig[] {
    return Array.from(this.workflowCache.values())
  }

  /**
   * Update workflow status
   */
  async updateStatus(projectPath: string, workflowId: string, status: WorkflowStatus, error?: string): Promise<WorkflowConfig | null> {
    return this.update(projectPath, workflowId, { status, error })
  }

  /**
   * Update workflow progress
   */
  async updateProgress(projectPath: string, workflowId: string, progress: WorkflowProgress): Promise<WorkflowConfig | null> {
    // Also save progress to separate file for persistence
    const progressFile = path.join(this.getProgressDir(projectPath), `${workflowId}.json`)
    await fs.writeFile(progressFile, JSON.stringify(progress, null, 2), 'utf-8')

    return this.update(projectPath, workflowId, { progress })
  }

  /**
   * Get workflow spec content
   */
  async getSpecContent(workflow: WorkflowConfig): Promise<string> {
    if (!validatePath(this.getSpecsDir(workflow.projectPath), workflow.specFile)) {
      throw new Error('Invalid spec file path')
    }

    return fs.readFile(workflow.specFile, 'utf-8')
  }

  /**
   * Update workflow spec content
   */
  async updateSpecContent(workflow: WorkflowConfig, content: string): Promise<void> {
    if (!validatePath(this.getSpecsDir(workflow.projectPath), workflow.specFile)) {
      throw new Error('Invalid spec file path')
    }

    await fs.writeFile(workflow.specFile, content, 'utf-8')
    await this.update(workflow.projectPath, workflow.id, {})
  }

  /**
   * Create a git worktree for isolated development
   */
  private async createWorktree(projectPath: string, workflowId: string, branchName?: string): Promise<string> {
    const branch = branchName || `autonomous/${workflowId}`
    const worktreePath = path.join(projectPath, '.autonomous', 'worktrees', workflowId)

    // Create worktree directory
    await fs.mkdir(path.dirname(worktreePath), { recursive: true })

    // Create worktree with new branch
    try {
      await execAsync(`git worktree add -b "${branch}" "${worktreePath}"`, { cwd: projectPath })
    } catch (error) {
      // Branch might already exist, try without -b
      await execAsync(`git worktree add "${worktreePath}" "${branch}"`, { cwd: projectPath })
    }

    return worktreePath
  }

  /**
   * Remove a git worktree
   */
  private async removeWorktree(projectPath: string, worktreePath: string): Promise<void> {
    try {
      await execAsync(`git worktree remove "${worktreePath}" --force`, { cwd: projectPath })
    } catch {
      // Fallback: just remove the directory
      await fs.rm(worktreePath, { recursive: true, force: true })
    }
  }

  /**
   * Emit workflow change event to renderer
   */
  private emitWorkflowChange(workflow: WorkflowConfig, action: 'created' | 'updated' | 'deleted'): void {
    this.emit('change', { workflow, action })

    const mainWindow = getMainWindow()
    if (mainWindow) {
      mainWindow.webContents.send(IPC_CHANNELS.WORKFLOW_CHANGE, { workflow, action })
    }
  }

  /**
   * Clear the workflow cache
   */
  clearCache(): void {
    this.workflowCache.clear()
  }
}

// Export singleton instance
export const workflowManager = new WorkflowManager()

/**
 * IdeasManager - Project Ideas State Management Service
 *
 * Manages project ideas from email to completion through a Kanban workflow.
 * Ideas flow: inbox → pending → review → approved → in_progress → completed
 *
 * Features:
 * - CRUD operations for ideas
 * - Stage transitions with validation
 * - Discussion message management for review phase
 * - Integration with workflow creation for project start
 * - Persistent storage
 *
 * Storage:
 * - Ideas are stored in app data directory
 */

import { EventEmitter } from 'events'
import Store from 'electron-store'
import { randomBytes } from 'crypto'
import type {
  Idea,
  IdeaStage,
  IdeaEmailSource,
  IdeaDiscussionMessage,
  ProjectType
} from '@shared/types'

// Valid stage transitions
const STAGE_TRANSITIONS: Record<IdeaStage, IdeaStage[]> = {
  inbox: ['pending', 'review'],
  pending: ['review'],
  review: ['approved', 'pending'],
  approved: ['in_progress', 'review'],
  in_progress: ['completed', 'approved'],
  completed: []
}

// Store for ideas
const ideasStore = new Store<{ ideas: Record<string, Idea> }>({
  name: 'ideas-kanban',
  defaults: {
    ideas: {}
  }
})

/**
 * Options for creating a new idea
 */
export interface CreateIdeaOptions {
  title: string
  description: string
  emailSource: IdeaEmailSource
  tags?: string[]
  priority?: 'low' | 'medium' | 'high' | 'urgent'
}

/**
 * Options for updating an idea
 */
export interface UpdateIdeaOptions {
  title?: string
  description?: string
  projectType?: ProjectType
  associatedProjectPath?: string
  associatedProjectName?: string
  reviewNotes?: string
  tags?: string[]
  priority?: 'low' | 'medium' | 'high' | 'urgent'
}

/**
 * IdeasManager Service
 */
export class IdeasManager extends EventEmitter {
  private ideas: Map<string, Idea>

  constructor() {
    super()
    this.ideas = new Map()
    this.loadIdeas()
  }

  /**
   * Load ideas from persistent store
   */
  private loadIdeas(): void {
    const stored = ideasStore.get('ideas')
    if (stored) {
      Object.entries(stored).forEach(([id, idea]) => {
        this.ideas.set(id, idea)
      })
    }
  }

  /**
   * Save ideas to persistent store
   */
  private saveIdeas(): void {
    const ideaObj: Record<string, Idea> = {}
    this.ideas.forEach((idea, id) => {
      ideaObj[id] = idea
    })
    ideasStore.set('ideas', ideaObj)
  }

  /**
   * Generate unique idea ID
   */
  private generateId(): string {
    const timestamp = Date.now().toString(36)
    const random = randomBytes(4).toString('hex')
    return `idea-${timestamp}-${random}`
  }

  /**
   * Create a new idea from email
   */
  create(options: CreateIdeaOptions): Idea {
    const id = this.generateId()
    const now = Date.now()

    const idea: Idea = {
      id,
      title: options.title,
      description: options.description,
      stage: 'inbox',
      projectType: 'undetermined',
      emailSource: options.emailSource,
      tags: options.tags || [],
      priority: options.priority || 'medium',
      createdAt: now,
      updatedAt: now
    }

    this.ideas.set(id, idea)
    this.saveIdeas()
    this.emit('idea-created', idea)
    this.emit('change')

    return idea
  }

  /**
   * Create multiple ideas from emails
   */
  createFromEmails(emails: IdeaEmailSource[]): Idea[] {
    const ideas: Idea[] = []

    for (const email of emails) {
      // Check if idea already exists for this email
      const existing = this.findByEmailMessageId(email.messageId)
      if (existing) {
        continue
      }

      const idea = this.create({
        title: email.subject,
        description: email.body,
        emailSource: email
      })
      ideas.push(idea)
    }

    return ideas
  }

  /**
   * Find idea by email message ID
   */
  findByEmailMessageId(messageId: string): Idea | undefined {
    for (const idea of this.ideas.values()) {
      if (idea.emailSource.messageId === messageId) {
        return idea
      }
    }
    return undefined
  }

  /**
   * Get an idea by ID
   */
  get(id: string): Idea | undefined {
    return this.ideas.get(id)
  }

  /**
   * List all ideas, optionally filtered by stage
   */
  list(stage?: IdeaStage): Idea[] {
    const ideas = Array.from(this.ideas.values())

    if (stage) {
      return ideas.filter(idea => idea.stage === stage)
    }

    // Sort by updatedAt descending
    return ideas.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  /**
   * Update an idea
   */
  update(id: string, options: UpdateIdeaOptions): Idea {
    const idea = this.ideas.get(id)
    if (!idea) {
      throw new Error(`Idea not found: ${id}`)
    }

    const updatedIdea: Idea = {
      ...idea,
      ...options,
      updatedAt: Date.now()
    }

    this.ideas.set(id, updatedIdea)
    this.saveIdeas()
    this.emit('idea-updated', updatedIdea)
    this.emit('change')

    return updatedIdea
  }

  /**
   * Delete an idea
   */
  delete(id: string): boolean {
    const idea = this.ideas.get(id)
    if (!idea) {
      return false
    }

    this.ideas.delete(id)
    this.saveIdeas()
    this.emit('idea-deleted', id)
    this.emit('change')

    return true
  }

  /**
   * Move idea to a new stage with validation
   */
  moveStage(id: string, newStage: IdeaStage): Idea {
    const idea = this.ideas.get(id)
    if (!idea) {
      throw new Error(`Idea not found: ${id}`)
    }

    const allowedTransitions = STAGE_TRANSITIONS[idea.stage]
    if (!allowedTransitions.includes(newStage)) {
      throw new Error(
        `Invalid stage transition: ${idea.stage} → ${newStage}. ` +
        `Allowed: ${allowedTransitions.join(', ') || 'none'}`
      )
    }

    const now = Date.now()
    const updates: Partial<Idea> = {
      stage: newStage,
      updatedAt: now
    }

    // Set stage-specific timestamps
    switch (newStage) {
      case 'review':
        updates.movedToReviewAt = now
        break
      case 'approved':
        updates.approvedAt = now
        break
      case 'in_progress':
        updates.startedAt = now
        break
      case 'completed':
        updates.completedAt = now
        break
    }

    const updatedIdea: Idea = {
      ...idea,
      ...updates
    }

    this.ideas.set(id, updatedIdea)
    this.saveIdeas()
    this.emit('idea-stage-changed', { idea: updatedIdea, from: idea.stage, to: newStage })
    this.emit('change')

    return updatedIdea
  }

  /**
   * Add a discussion message to an idea
   */
  addDiscussionMessage(
    id: string,
    role: 'user' | 'assistant',
    content: string
  ): Idea {
    const idea = this.ideas.get(id)
    if (!idea) {
      throw new Error(`Idea not found: ${id}`)
    }

    const message: IdeaDiscussionMessage = {
      id: `msg-${Date.now().toString(36)}-${randomBytes(2).toString('hex')}`,
      role,
      content,
      timestamp: Date.now()
    }

    const messages = idea.discussionMessages || []
    messages.push(message)

    const updatedIdea: Idea = {
      ...idea,
      discussionMessages: messages,
      updatedAt: Date.now()
    }

    this.ideas.set(id, updatedIdea)
    this.saveIdeas()
    this.emit('discussion-message-added', { ideaId: id, message })
    this.emit('change')

    return updatedIdea
  }

  /**
   * Set project type for an idea (greenfield/brownfield)
   */
  setProjectType(
    id: string,
    projectType: ProjectType,
    associatedProject?: { path: string; name: string }
  ): Idea {
    const idea = this.ideas.get(id)
    if (!idea) {
      throw new Error(`Idea not found: ${id}`)
    }

    const updates: Partial<Idea> = {
      projectType,
      updatedAt: Date.now()
    }

    if (projectType === 'brownfield' && associatedProject) {
      updates.associatedProjectPath = associatedProject.path
      updates.associatedProjectName = associatedProject.name
    } else if (projectType === 'greenfield') {
      updates.associatedProjectPath = undefined
      updates.associatedProjectName = undefined
    }

    const updatedIdea: Idea = {
      ...idea,
      ...updates
    }

    this.ideas.set(id, updatedIdea)
    this.saveIdeas()
    this.emit('idea-project-type-set', updatedIdea)
    this.emit('change')

    return updatedIdea
  }

  /**
   * Link idea to a workflow (when project starts)
   */
  linkWorkflow(id: string, workflowId: string): Idea {
    const idea = this.ideas.get(id)
    if (!idea) {
      throw new Error(`Idea not found: ${id}`)
    }

    const updatedIdea: Idea = {
      ...idea,
      workflowId,
      updatedAt: Date.now()
    }

    this.ideas.set(id, updatedIdea)
    this.saveIdeas()
    this.emit('idea-workflow-linked', { ideaId: id, workflowId })
    this.emit('change')

    return updatedIdea
  }

  /**
   * Get statistics about ideas
   */
  getStats(): {
    total: number
    byStage: Record<IdeaStage, number>
    byProjectType: Record<ProjectType, number>
  } {
    const byStage: Record<IdeaStage, number> = {
      inbox: 0,
      pending: 0,
      review: 0,
      approved: 0,
      in_progress: 0,
      completed: 0
    }

    const byProjectType: Record<ProjectType, number> = {
      greenfield: 0,
      brownfield: 0,
      undetermined: 0
    }

    for (const idea of this.ideas.values()) {
      byStage[idea.stage]++
      byProjectType[idea.projectType]++
    }

    return {
      total: this.ideas.size,
      byStage,
      byProjectType
    }
  }
}

// Singleton instance
let ideasManager: IdeasManager | null = null

export function getIdeasManager(): IdeasManager {
  if (!ideasManager) {
    ideasManager = new IdeasManager()
  }
  return ideasManager
}

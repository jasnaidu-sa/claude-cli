/**
 * IdeasManager - Project Ideas State Management Service
 *
 * Manages project ideas from email to completion through a Kanban workflow.
 * Ideas flow: inbox → review → approved → in_progress → completed (or declined)
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
  IdeaExtractedUrl,
  ProjectType
} from '@shared/types'
import { getLinkContentExtractor } from './link-content-extractor'
import { claudeAPIService } from './claude-api-service'

// Valid stage transitions
const STAGE_TRANSITIONS: Record<IdeaStage, IdeaStage[]> = {
  inbox: ['review', 'declined'],
  review: ['approved', 'declined'],
  approved: ['in_progress', 'review'],
  in_progress: ['completed', 'approved'],
  completed: [],
  declined: ['inbox', 'review'] // Allow moving declined ideas back to inbox or review
}

// Store for ideas
const ideasStore = new Store<{ ideas: Record<string, Idea> }>({
  name: 'ideas-kanban',
  defaults: {
    ideas: {}
  }
})

// Migration: Convert old 'pending' stage to 'review'
function migrateIdeasData(): void {
  const ideas = ideasStore.get('ideas', {})
  let migrated = false

  for (const [id, idea] of Object.entries(ideas)) {
    // @ts-expect-error - pending stage no longer exists in type but may exist in old data
    if (idea.stage === 'pending') {
      console.log(`[IdeasManager] Migrating idea ${id} from 'pending' to 'review'`)
      ideas[id] = { ...idea, stage: 'review' }
      migrated = true
    }
  }

  if (migrated) {
    ideasStore.set('ideas', ideas)
    console.log('[IdeasManager] Migration complete: pending → review')
  }
}

// Run migration on load
migrateIdeasData()

/**
 * Options for creating a new idea
 */
export interface CreateIdeaOptions {
  title: string
  description: string
  emailSource: IdeaEmailSource
  tags?: string[]
  priority?: 'low' | 'medium' | 'high' | 'urgent'
  extractedUrls?: IdeaExtractedUrl[]
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
      extractedUrls: options.extractedUrls,
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
   * Extracts URLs from email content, fetches article content, generates AI summaries
   */
  async createFromEmails(emails: IdeaEmailSource[]): Promise<Idea[]> {
    const ideas: Idea[] = []

    for await (const idea of this.createFromEmailsStream(emails)) {
      ideas.push(idea)
    }

    return ideas
  }

  /**
   * Create ideas from emails with streaming - yields each idea as it completes
   * This allows progressive display in the UI instead of waiting for all emails
   */
  async *createFromEmailsStream(emails: IdeaEmailSource[]): AsyncGenerator<Idea, void, unknown> {
    const linkExtractor = getLinkContentExtractor()
    const totalEmails = emails.length
    let processedCount = 0

    for (const email of emails) {
      processedCount++

      // Check if idea already exists for this email
      const existing = this.findByEmailMessageId(email.messageId)
      if (existing) {
        this.emit('sync-progress', { current: processedCount, total: totalEmails, skipped: true })
        continue
      }

      // Extract URLs and fetch content
      let extractedUrls: IdeaExtractedUrl[] = []
      let title = email.subject

      try {
        // Check if subject is empty or just contains a URL
        const subjectIsEmpty = !email.subject || email.subject.trim().length === 0
        const subjectIsUrl = email.subject && /^https?:\/\//i.test(email.subject.trim())

        if (subjectIsEmpty || subjectIsUrl) {
          // Try to get title from URLs in body
          console.log(`[IdeasManager] Email has empty/URL subject, extracting from URLs...`)
          console.log(`[IdeasManager] Email body preview (first 200 chars): ${email.body.substring(0, 200)}`)
          const rawExtracted = await linkExtractor.fetchAllUrlContents(email.body)
          console.log(`[IdeasManager] Extracted ${rawExtracted.length} URLs from email body`)

          // Generate summaries for articles with content
          extractedUrls = await this.generateSummariesForUrls(rawExtracted)

          // Find first successful URL with a title
          const urlWithTitle = extractedUrls.find(u => u.title && !u.error)
          if (urlWithTitle?.title) {
            title = urlWithTitle.title
            console.log(`[IdeasManager] Generated title from URL: "${title}"`)
          } else if (subjectIsUrl) {
            // If subject is a URL, try to fetch its content
            const subjectContent = await linkExtractor.fetchContent(email.subject.trim())
            // Generate summary for subject URL
            const summarized = await this.generateSummaryForUrl(subjectContent)
            if (summarized.title) {
              title = summarized.title
              extractedUrls = [summarized, ...extractedUrls]
              console.log(`[IdeasManager] Generated title from subject URL: "${title}"`)
            }
          }
        } else {
          // Subject has content, just extract URLs for reference
          const rawExtracted = await linkExtractor.fetchAllUrlContents(email.body)
          extractedUrls = await this.generateSummariesForUrls(rawExtracted)
        }
      } catch (error) {
        console.error(`[IdeasManager] Error extracting URLs:`, error)
      }

      const idea = this.create({
        title: title || 'Untitled Idea',
        description: email.body,
        emailSource: email,
        extractedUrls: extractedUrls.length > 0 ? extractedUrls : undefined
      })

      // Emit progress event
      this.emit('sync-progress', { current: processedCount, total: totalEmails, idea })

      // Yield the idea immediately so UI can display it
      yield idea
    }

    // Emit completion event
    this.emit('sync-complete', { total: totalEmails })
  }

  /**
   * Generate AI summary for a single URL's content
   */
  private async generateSummaryForUrl(extracted: IdeaExtractedUrl): Promise<IdeaExtractedUrl> {
    console.log(`[IdeasManager] generateSummaryForUrl called for: ${extracted.url}`)
    console.log(`[IdeasManager] - articleContent length: ${extracted.articleContent?.length || 0}`)
    console.log(`[IdeasManager] - summaryGenerated: ${extracted.summaryGenerated}`)

    // Skip if no article content or already has summary
    if (!extracted.articleContent || extracted.summaryGenerated) {
      console.log(`[IdeasManager] Skipping - no content or already generated`)
      return extracted
    }

    // Skip if Claude CLI is not configured
    const isConfigured = claudeAPIService.isConfigured()
    console.log(`[IdeasManager] Claude CLI configured: ${isConfigured}`)
    if (!isConfigured) {
      console.log(`[IdeasManager] Skipping summary - Claude CLI not configured`)
      return extracted // Don't mark as attempted, can retry later
    }

    try {
      console.log(`[IdeasManager] Generating summary for: ${extracted.url}`)
      const result = await claudeAPIService.summarizeArticle(
        extracted.articleContent,
        extracted.title || undefined
      )

      if (result.summary && !result.error) {
        return {
          ...extracted,
          summary: result.summary,
          summaryGenerated: true
        }
      } else if (result.error) {
        console.warn(`[IdeasManager] Summary error for ${extracted.url}: ${result.error}`)
      }
    } catch (error) {
      console.error(`[IdeasManager] Failed to generate summary for ${extracted.url}:`, error)
    }

    return {
      ...extracted,
      summaryGenerated: true // Mark as attempted even if failed
    }
  }

  /**
   * Generate AI summaries for multiple URLs using BATCH processing
   * Uses a single CLI call for all articles - much faster than individual calls
   */
  private async generateSummariesForUrls(extracted: IdeaExtractedUrl[]): Promise<IdeaExtractedUrl[]> {
    // Debug: log what we received
    console.log(`[IdeasManager] generateSummariesForUrls received ${extracted.length} URLs`)
    for (const u of extracted) {
      console.log(`[IdeasManager] - URL: ${u.url}`)
      console.log(`[IdeasManager]   title: ${u.title || 'none'}`)
      console.log(`[IdeasManager]   articleContent: ${u.articleContent ? `${u.articleContent.length} chars` : 'none'}`)
      console.log(`[IdeasManager]   summaryGenerated: ${u.summaryGenerated}`)
    }

    // Separate URLs that need summarization from those that don't
    const needsSummary = extracted.filter(u => u.articleContent && !u.summaryGenerated)

    if (needsSummary.length === 0) {
      console.log(`[IdeasManager] No URLs need summarization (no articleContent or already generated)`)
      return extracted
    }

    // Skip if Claude CLI is not configured
    if (!claudeAPIService.isConfigured()) {
      console.log(`[IdeasManager] Skipping summaries - Claude CLI not configured`)
      return extracted
    }

    console.log(`[IdeasManager] Batch summarizing ${needsSummary.length} articles in ONE CLI call`)

    // Prepare articles for batch processing
    const articles = needsSummary.map(u => ({
      url: u.url,
      title: u.title || undefined,
      content: u.articleContent!
    }))

    try {
      // Use batch summarization - ONE CLI call for all articles
      const summaryResults = await claudeAPIService.summarizeArticlesBatch(articles)

      // Apply summaries to extracted URLs
      return extracted.map(original => {
        if (!original.articleContent || original.summaryGenerated) {
          return original
        }

        const result = summaryResults.get(original.url)
        if (result && result.summary && !result.error) {
          return {
            ...original,
            summary: result.summary,
            summaryGenerated: true
          }
        }

        // Mark as attempted even if failed
        return {
          ...original,
          summaryGenerated: true
        }
      })
    } catch (error) {
      console.error(`[IdeasManager] Batch summarization failed:`, error)
      // Mark all as attempted
      return extracted.map(u => ({
        ...u,
        summaryGenerated: u.articleContent ? true : u.summaryGenerated
      }))
    }
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
   * Re-process an existing idea to extract URLs, update title, and generate summaries
   * This is used for retry when initial processing failed
   */
  async reprocessIdea(id: string): Promise<Idea> {
    const idea = this.ideas.get(id)
    if (!idea) {
      throw new Error(`Idea not found: ${id}`)
    }

    console.log(`[IdeasManager] Reprocessing idea: ${id} (current title: "${idea.title}")`)
    console.log(`[IdeasManager] Email body length: ${idea.emailSource.body.length}`)

    const linkExtractor = getLinkContentExtractor()

    // Clear cache to force fresh fetch
    linkExtractor.clearCache()
    console.log(`[IdeasManager] Cleared link extractor cache`)

    try {
      // Extract URLs from email body - fetch fresh content
      const rawExtracted = await linkExtractor.fetchAllUrlContents(idea.emailSource.body)
      console.log(`[IdeasManager] Reprocess extracted ${rawExtracted.length} URLs`)

      // Debug: show what was extracted
      for (const u of rawExtracted) {
        console.log(`[IdeasManager] Raw URL: ${u.url}`)
        console.log(`[IdeasManager]   title: ${u.title || 'none'}`)
        console.log(`[IdeasManager]   articleContent: ${u.articleContent ? `${u.articleContent.length} chars` : 'MISSING'}`)
        console.log(`[IdeasManager]   error: ${u.error || 'none'}`)
      }

      // Reset summaryGenerated flag to force re-summarization
      const resetExtracted = rawExtracted.map(u => ({
        ...u,
        summaryGenerated: false  // Force regeneration of summaries
      }))

      // Generate summaries for articles with content
      const extractedUrls = await this.generateSummariesForUrls(resetExtracted)
      console.log(`[IdeasManager] Reprocess generated ${extractedUrls.filter(u => u.summary).length} summaries`)

      // Check if title needs updating (empty, URL-only, or generic)
      const titleNeedsUpdate = !idea.title ||
        idea.title === 'Untitled Idea' ||
        /^https?:\/\//i.test(idea.title.trim()) ||
        idea.title === idea.emailSource.subject

      let newTitle = idea.title
      if (titleNeedsUpdate || !idea.title) {
        // Try to get title from extracted URLs
        const urlWithTitle = extractedUrls.find(u => u.title && !u.error)
        if (urlWithTitle?.title) {
          newTitle = urlWithTitle.title
          console.log(`[IdeasManager] Reprocessed idea ${id}: new title "${newTitle}"`)
        }
      }

      const updatedIdea: Idea = {
        ...idea,
        title: newTitle || idea.title || 'Untitled Idea',
        extractedUrls: extractedUrls.length > 0 ? extractedUrls : idea.extractedUrls,
        updatedAt: Date.now()
      }

      this.ideas.set(id, updatedIdea)
      this.saveIdeas()
      this.emit('idea-updated', updatedIdea)
      this.emit('change')

      return updatedIdea
    } catch (error) {
      console.error(`[IdeasManager] Error reprocessing idea ${id}:`, error)
      return idea
    }
  }

  /**
   * Re-process all existing ideas to extract URLs and update titles
   */
  async reprocessAllIdeas(): Promise<{ processed: number; updated: number }> {
    const ideas = Array.from(this.ideas.values())
    let processed = 0
    let updated = 0

    console.log(`[IdeasManager] Reprocessing ${ideas.length} ideas...`)

    for (const idea of ideas) {
      try {
        const originalTitle = idea.title
        const reprocessed = await this.reprocessIdea(idea.id)
        processed++

        if (reprocessed.title !== originalTitle || reprocessed.extractedUrls?.length) {
          updated++
        }

        // Small delay between processing to avoid overwhelming the network
        await new Promise(resolve => setTimeout(resolve, 300))
      } catch (error) {
        console.error(`[IdeasManager] Failed to reprocess idea ${idea.id}:`, error)
      }
    }

    console.log(`[IdeasManager] Reprocessing complete: ${processed} processed, ${updated} updated`)
    return { processed, updated }
  }

  /**
   * Clear all ideas (for re-import)
   */
  clearAll(): number {
    const count = this.ideas.size
    this.ideas.clear()
    this.saveIdeas()
    this.emit('all-cleared')
    this.emit('change')
    console.log(`[IdeasManager] Cleared ${count} ideas`)
    return count
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
   * Update Agent SDK session ID for conversation continuity
   */
  updateSessionId(id: string, sessionId: string | undefined): Idea {
    const idea = this.ideas.get(id)
    if (!idea) {
      throw new Error(`Idea not found: ${id}`)
    }

    const updatedIdea: Idea = {
      ...idea,
      sessionId,
      updatedAt: Date.now()
    }

    this.ideas.set(id, updatedIdea)
    this.saveIdeas()
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
      review: 0,
      approved: 0,
      in_progress: 0,
      completed: 0,
      declined: 0
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

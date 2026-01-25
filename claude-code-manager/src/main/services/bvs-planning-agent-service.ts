/**
 * BVS Planning Agent Service
 *
 * Implements the interactive planning agent that:
 * - F0.2c: Asks clarifying questions, explores codebase
 * - F0.2d: Proposes sections iteratively, allows user refinement
 * - F0.2e: Converts chat findings to plan.json
 *
 * The planning agent guides users through defining their task
 * by asking structured questions and analyzing the codebase.
 */

import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'
import * as path from 'path'
import * as fs from 'fs/promises'
import {
  type BvsPlanningMessage,
  type BvsSection,
  type BvsExecutionPlan,
  type BvsCodebaseContext,
  type BvsFile,
  type BvsSuccessCriteria,
  BVS_IPC_CHANNELS,
} from '@shared/bvs-types'
import { getMainWindow } from '../index'

// ============================================================================
// Types
// ============================================================================

export interface PlanningSession {
  id: string
  projectPath: string
  messages: BvsPlanningMessage[]
  proposedSections: Partial<BvsSection>[]
  codebaseContext: BvsCodebaseContext | null
  phase: 'gathering' | 'proposing' | 'refining' | 'finalizing'
  createdAt: number
  updatedAt: number
}

export interface PlanningQuestion {
  id: string
  category: 'scope' | 'files' | 'dependencies' | 'criteria' | 'risks'
  question: string
  followUp?: string[]
  required: boolean
}

// ============================================================================
// Predefined Questions
// ============================================================================

const PLANNING_QUESTIONS: PlanningQuestion[] = [
  {
    id: 'q1',
    category: 'scope',
    question: 'What is the main goal of this task? Please describe the feature or change you want to implement.',
    required: true,
  },
  {
    id: 'q2',
    category: 'scope',
    question: 'Is this a new feature, an enhancement to existing functionality, or a bug fix?',
    followUp: ['If enhancement, what existing code will be modified?'],
    required: true,
  },
  {
    id: 'q3',
    category: 'files',
    question: 'Do you know which files or directories will be affected? If yes, please list them.',
    required: false,
  },
  {
    id: 'q4',
    category: 'dependencies',
    question: 'Does this task depend on any external APIs, libraries, or other parts of the codebase?',
    required: false,
  },
  {
    id: 'q5',
    category: 'criteria',
    question: 'What does "done" look like? How will we know when this task is complete?',
    followUp: ['Are there specific tests that should pass?', 'Are there UI elements that should work?'],
    required: true,
  },
  {
    id: 'q6',
    category: 'risks',
    question: 'Are there any risks or concerns with this task? Areas where we should be extra careful?',
    required: false,
  },
]

// ============================================================================
// Planning Agent Service
// ============================================================================

export class BvsPlanningAgentService extends EventEmitter {
  private sessions: Map<string, PlanningSession> = new Map()

  constructor() {
    super()
  }

  /**
   * Send event to renderer
   */
  private sendToRenderer(channel: string, data: unknown): void {
    const mainWindow = getMainWindow()
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, data)
    }
  }

  /**
   * Create a new planning session
   */
  async createSession(projectPath: string): Promise<PlanningSession> {
    const sessionId = `plan-${randomUUID().slice(0, 12)}`

    const session: PlanningSession = {
      id: sessionId,
      projectPath,
      messages: [],
      proposedSections: [],
      codebaseContext: null,
      phase: 'gathering',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    // Add initial greeting message
    const greeting: BvsPlanningMessage = {
      id: this.generateMessageId(),
      role: 'assistant',
      content: this.getGreetingMessage(),
      timestamp: Date.now(),
      category: 'clarification',
    }
    session.messages.push(greeting)

    this.sessions.set(sessionId, session)
    return session
  }

  /**
   * Get session by ID
   */
  getSession(sessionId: string): PlanningSession | undefined {
    return this.sessions.get(sessionId)
  }

  /**
   * Process user message and generate response
   */
  async processMessage(
    sessionId: string,
    userMessage: string
  ): Promise<BvsPlanningMessage> {
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new Error(`Session ${sessionId} not found`)
    }

    // Add user message
    const userMsg: BvsPlanningMessage = {
      id: this.generateMessageId(),
      role: 'user',
      content: userMessage,
      timestamp: Date.now(),
    }
    session.messages.push(userMsg)
    session.updatedAt = Date.now()

    // Generate response based on phase
    let response: BvsPlanningMessage

    switch (session.phase) {
      case 'gathering':
        response = await this.handleGatheringPhase(session, userMessage)
        break
      case 'proposing':
        response = await this.handleProposingPhase(session, userMessage)
        break
      case 'refining':
        response = await this.handleRefiningPhase(session, userMessage)
        break
      case 'finalizing':
        response = await this.handleFinalizingPhase(session, userMessage)
        break
      default:
        response = this.createResponse('I\'m not sure how to proceed. Let\'s start over.', 'clarification')
    }

    session.messages.push(response)
    session.updatedAt = Date.now()

    // Emit update
    this.emit('session-update', { sessionId, session })
    this.sendToRenderer(BVS_IPC_CHANNELS.BVS_PLANNING_RESPONSE, {
      sessionId,
      message: response,
    })

    return response
  }

  /**
   * Handle gathering phase - asking initial questions
   */
  private async handleGatheringPhase(
    session: PlanningSession,
    userMessage: string
  ): Promise<BvsPlanningMessage> {
    const userMessageCount = session.messages.filter(m => m.role === 'user').length

    // After enough information, move to proposing
    if (userMessageCount >= 3) {
      session.phase = 'proposing'

      // Analyze codebase if not done yet
      if (!session.codebaseContext) {
        session.codebaseContext = await this.analyzeCodebase(session.projectPath)
      }

      // Generate initial section proposals
      session.proposedSections = await this.generateInitialSections(session)

      return this.createResponse(
        this.formatSectionProposal(session.proposedSections),
        'proposal'
      )
    }

    // Ask next question
    const nextQuestion = PLANNING_QUESTIONS[userMessageCount] || PLANNING_QUESTIONS[0]
    return this.createResponse(
      `Thanks for that information.\n\n${nextQuestion.question}`,
      'clarification'
    )
  }

  /**
   * Handle proposing phase - presenting section proposals
   */
  private async handleProposingPhase(
    session: PlanningSession,
    userMessage: string
  ): Promise<BvsPlanningMessage> {
    const lower = userMessage.toLowerCase()

    // Check for approval
    if (lower.includes('looks good') || lower.includes('approve') || lower.includes('yes')) {
      session.phase = 'finalizing'
      return this.createResponse(
        'Great! I\'ll finalize the plan. Would you like to:\n\n' +
        '1. **Start execution** immediately\n' +
        '2. **Review the full plan** first\n' +
        '3. **Make adjustments** to specific sections',
        'finalization'
      )
    }

    // Check for refinement requests
    if (lower.includes('change') || lower.includes('modify') || lower.includes('adjust')) {
      session.phase = 'refining'
      return this.createResponse(
        'Sure, let\'s refine the sections. Which section would you like to modify? ' +
        'You can:\n\n' +
        '- **Split** a section into smaller parts\n' +
        '- **Merge** sections together\n' +
        '- **Add** or **remove** files from a section\n' +
        '- **Change** dependencies',
        'refinement'
      )
    }

    // Default: re-show proposal and ask for feedback
    return this.createResponse(
      'Would you like to approve this plan or make any adjustments?\n\n' +
      this.formatSectionProposal(session.proposedSections),
      'proposal'
    )
  }

  /**
   * Handle refining phase - adjusting sections
   */
  private async handleRefiningPhase(
    session: PlanningSession,
    userMessage: string
  ): Promise<BvsPlanningMessage> {
    const lower = userMessage.toLowerCase()

    // Apply refinement based on user input
    if (lower.includes('split')) {
      // Parse which section to split
      const sectionMatch = userMessage.match(/section\s*(\d+)/i)
      if (sectionMatch) {
        const sectionIndex = parseInt(sectionMatch[1], 10) - 1
        if (session.proposedSections[sectionIndex]) {
          // Split the section in half
          const original = session.proposedSections[sectionIndex]
          const files = original.files || []
          const midpoint = Math.ceil(files.length / 2)

          const section1 = { ...original, files: files.slice(0, midpoint) }
          const section2 = {
            ...original,
            id: `${original.id}-b`,
            name: `${original.name} (Part 2)`,
            files: files.slice(midpoint),
          }

          session.proposedSections.splice(sectionIndex, 1, section1, section2)

          return this.createResponse(
            `I've split section ${sectionIndex + 1} into two parts:\n\n` +
            this.formatSectionProposal(session.proposedSections),
            'proposal'
          )
        }
      }
    }

    if (lower.includes('merge')) {
      // Parse which sections to merge
      const mergeMatch = userMessage.match(/(\d+)\s*(?:and|&|,)\s*(\d+)/i)
      if (mergeMatch) {
        const idx1 = parseInt(mergeMatch[1], 10) - 1
        const idx2 = parseInt(mergeMatch[2], 10) - 1

        if (session.proposedSections[idx1] && session.proposedSections[idx2]) {
          const merged = {
            ...session.proposedSections[idx1],
            name: `${session.proposedSections[idx1].name} + ${session.proposedSections[idx2].name}`,
            files: [
              ...(session.proposedSections[idx1].files || []),
              ...(session.proposedSections[idx2].files || []),
            ],
          }

          // Remove old sections and add merged
          session.proposedSections = session.proposedSections.filter(
            (_, i) => i !== idx1 && i !== idx2
          )
          session.proposedSections.splice(Math.min(idx1, idx2), 0, merged)

          return this.createResponse(
            `I've merged those sections:\n\n` +
            this.formatSectionProposal(session.proposedSections),
            'proposal'
          )
        }
      }
    }

    // Check for done with refinements
    if (lower.includes('done') || lower.includes('good') || lower.includes('approve')) {
      session.phase = 'proposing'
      return this.createResponse(
        'Great! Here\'s the updated plan:\n\n' +
        this.formatSectionProposal(session.proposedSections) +
        '\n\nWould you like to approve this plan?',
        'proposal'
      )
    }

    return this.createResponse(
      'I can help you:\n' +
      '- **Split section N** - divide a section in half\n' +
      '- **Merge sections N and M** - combine two sections\n' +
      '- Say **done** when finished refining',
      'refinement'
    )
  }

  /**
   * Handle finalizing phase - converting to plan
   */
  private async handleFinalizingPhase(
    session: PlanningSession,
    userMessage: string
  ): Promise<BvsPlanningMessage> {
    const lower = userMessage.toLowerCase()

    if (lower.includes('start') || lower.includes('execute') || lower.includes('1')) {
      // Generate and save the plan
      const plan = await this.convertToPlan(session)
      await this.savePlan(session.projectPath, plan)

      return this.createResponse(
        '✓ Plan saved to `.bvs/plan.json`\n\n' +
        'The BVS execution can now begin. Go to the Execution view to start.',
        'finalization'
      )
    }

    if (lower.includes('review') || lower.includes('2')) {
      const plan = await this.convertToPlan(session)
      return this.createResponse(
        '**Full Plan Review**\n\n' +
        `**Title:** ${plan.title}\n` +
        `**Total Sections:** ${plan.sections.length}\n` +
        `**Estimated Files:** ${plan.sections.reduce((sum, s) => sum + s.files.length, 0)}\n\n` +
        '**Sections:**\n' +
        plan.sections.map((s, i) => (
          `${i + 1}. **${s.name}** (${s.files.length} files)\n` +
          `   Dependencies: ${s.dependencies.length > 0 ? s.dependencies.join(', ') : 'None'}`
        )).join('\n') +
        '\n\nSay **start** to begin execution or **adjust** to make changes.',
        'finalization'
      )
    }

    if (lower.includes('adjust') || lower.includes('3')) {
      session.phase = 'refining'
      return this.createResponse(
        'Which section would you like to adjust?',
        'refinement'
      )
    }

    return this.createResponse(
      'Would you like to:\n' +
      '1. **Start execution** immediately\n' +
      '2. **Review the full plan** first\n' +
      '3. **Make adjustments** to specific sections',
      'finalization'
    )
  }

  /**
   * Analyze codebase to understand project structure
   * (F0.3 - Codebase Analyzer)
   */
  async analyzeCodebase(projectPath: string): Promise<BvsCodebaseContext> {
    const context: BvsCodebaseContext = {
      framework: null,
      language: 'typescript',
      packageManager: null,
      hasTypeScript: false,
      hasTests: false,
      testFramework: null,
      lintCommand: null,
      buildCommand: null,
      devCommand: null,
      patterns: [],
      conventions: [],
    }

    try {
      // Check for package.json
      const packageJsonPath = path.join(projectPath, 'package.json')
      try {
        const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'))

        // Detect package manager
        if (await this.fileExists(path.join(projectPath, 'pnpm-lock.yaml'))) {
          context.packageManager = 'pnpm'
        } else if (await this.fileExists(path.join(projectPath, 'yarn.lock'))) {
          context.packageManager = 'yarn'
        } else if (await this.fileExists(path.join(projectPath, 'bun.lockb'))) {
          context.packageManager = 'bun'
        } else {
          context.packageManager = 'npm'
        }

        // Detect framework from dependencies
        const deps = { ...packageJson.dependencies, ...packageJson.devDependencies }
        if (deps.next) context.framework = 'Next.js'
        else if (deps.react) context.framework = 'React'
        else if (deps.vue) context.framework = 'Vue'
        else if (deps.angular) context.framework = 'Angular'
        else if (deps.electron) context.framework = 'Electron'
        else if (deps.express) context.framework = 'Express'

        // Detect TypeScript
        context.hasTypeScript = !!deps.typescript

        // Detect test framework
        if (deps.vitest) {
          context.hasTests = true
          context.testFramework = 'vitest'
        } else if (deps.jest) {
          context.hasTests = true
          context.testFramework = 'jest'
        } else if (deps.mocha) {
          context.hasTests = true
          context.testFramework = 'mocha'
        }

        // Extract scripts
        const scripts = packageJson.scripts || {}
        context.lintCommand = scripts.lint ? `${context.packageManager} run lint` : null
        context.buildCommand = scripts.build ? `${context.packageManager} run build` : null
        context.devCommand = scripts.dev ? `${context.packageManager} run dev` : scripts.start ? `${context.packageManager} run start` : null
      } catch {
        // No package.json
      }

      // Detect language
      if (await this.fileExists(path.join(projectPath, 'tsconfig.json'))) {
        context.hasTypeScript = true
        context.language = 'typescript'
      } else if (await this.fileExists(path.join(projectPath, 'Cargo.toml'))) {
        context.language = 'rust'
      } else if (await this.fileExists(path.join(projectPath, 'go.mod'))) {
        context.language = 'go'
      } else if (await this.fileExists(path.join(projectPath, 'requirements.txt'))) {
        context.language = 'python'
      }

      // Extract patterns (simplified - would be more sophisticated in production)
      context.patterns = await this.extractPatterns(projectPath)

    } catch (error) {
      console.error('[BvsPlanningAgent] Error analyzing codebase:', error)
    }

    return context
  }

  /**
   * Extract coding patterns from codebase
   */
  private async extractPatterns(projectPath: string): Promise<string[]> {
    const patterns: string[] = []

    try {
      // Check for common patterns
      if (await this.fileExists(path.join(projectPath, 'src', 'components'))) {
        patterns.push('Component-based architecture')
      }
      if (await this.fileExists(path.join(projectPath, 'src', 'services'))) {
        patterns.push('Service layer pattern')
      }
      if (await this.fileExists(path.join(projectPath, 'src', 'stores'))) {
        patterns.push('Store-based state management')
      }
      if (await this.fileExists(path.join(projectPath, 'src', 'hooks'))) {
        patterns.push('Custom React hooks')
      }
      if (await this.fileExists(path.join(projectPath, 'src', 'utils'))) {
        patterns.push('Utility functions')
      }
      if (await this.fileExists(path.join(projectPath, 'src', 'types'))) {
        patterns.push('Centralized type definitions')
      }
    } catch {
      // Ignore errors
    }

    return patterns
  }

  /**
   * Generate initial section proposals based on gathered info
   */
  private async generateInitialSections(
    session: PlanningSession
  ): Promise<Partial<BvsSection>[]> {
    const sections: Partial<BvsSection>[] = []

    // Extract key information from messages
    const userMessages = session.messages
      .filter(m => m.role === 'user')
      .map(m => m.content)
      .join('\n')

    // Generate sections based on typical patterns
    // In production, this would use AI to analyze the conversation

    // Section 1: Types and interfaces
    sections.push({
      id: 'S1',
      name: 'Types and Interfaces',
      description: 'Define data types and interfaces for the feature',
      files: [
        { path: 'src/types/feature.ts', action: 'create', status: 'pending' },
      ],
      dependencies: [],
      status: 'pending',
    })

    // Section 2: Core logic/service
    sections.push({
      id: 'S2',
      name: 'Core Service',
      description: 'Implement the main business logic',
      files: [
        { path: 'src/services/feature-service.ts', action: 'create', status: 'pending' },
      ],
      dependencies: ['S1'],
      status: 'pending',
    })

    // Section 3: UI components (if applicable)
    if (session.codebaseContext?.framework) {
      sections.push({
        id: 'S3',
        name: 'UI Components',
        description: 'Create user interface components',
        files: [
          { path: 'src/components/Feature.tsx', action: 'create', status: 'pending' },
        ],
        dependencies: ['S1', 'S2'],
        status: 'pending',
      })
    }

    // Section 4: Tests
    if (session.codebaseContext?.hasTests) {
      sections.push({
        id: 'S4',
        name: 'Tests',
        description: 'Add unit and integration tests',
        files: [
          { path: 'src/__tests__/feature.test.ts', action: 'create', status: 'pending' },
        ],
        dependencies: ['S2'],
        status: 'pending',
      })
    }

    return sections
  }

  /**
   * Convert planning session to execution plan
   * (F0.2e - Chat-to-Plan Converter)
   */
  async convertToPlan(session: PlanningSession): Promise<BvsExecutionPlan> {
    // Build full sections from proposals
    const sections: BvsSection[] = session.proposedSections.map((proposal, idx) => ({
      id: proposal.id || `S${idx + 1}`,
      name: proposal.name || `Section ${idx + 1}`,
      description: proposal.description || '',
      files: (proposal.files || []) as BvsFile[],
      dependencies: proposal.dependencies || [],
      dependents: [],
      status: 'pending',
      successCriteria: this.generateSuccessCriteria(proposal),
      progress: 0,
      retryCount: 0,
      maxRetries: 3,
      commits: [],
    }))

    // Calculate dependents
    for (const section of sections) {
      for (const depId of section.dependencies) {
        const dep = sections.find(s => s.id === depId)
        if (dep && !dep.dependents.includes(section.id)) {
          dep.dependents.push(section.id)
        }
      }
    }

    const plan: BvsExecutionPlan = {
      id: `plan-${Date.now()}`,
      inputMode: 'interactive_planning',
      planningMessages: session.messages,
      title: this.extractTitleFromMessages(session.messages),
      description: 'Generated from interactive planning session',
      totalFeatures: sections.length,
      codebaseContext: session.codebaseContext || {
        framework: null,
        language: 'typescript',
        packageManager: null,
        hasTypeScript: true,
        hasTests: false,
        testFramework: null,
        lintCommand: null,
        buildCommand: null,
        devCommand: null,
        patterns: [],
        conventions: [],
      },
      sections,
      dependencyGraph: {
        nodes: sections.map(s => ({
          sectionId: s.id,
          level: this.calculateLevel(s, sections),
          dependencies: s.dependencies,
          dependents: s.dependents,
        })),
        levels: this.groupByLevel(sections),
        criticalPath: this.findCriticalPath(sections),
      },
      parallelGroups: [],
      e2eMapping: {},
      parallelConfig: {
        maxWorkers: 3,
        enableWorktrees: true,
        mergeStrategy: 'sequential',
        conflictResolution: 'ai',
      },
      createdAt: Date.now(),
    }

    return plan
  }

  /**
   * Save plan to .bvs/plan.json
   */
  private async savePlan(projectPath: string, plan: BvsExecutionPlan): Promise<void> {
    const bvsDir = path.join(projectPath, '.bvs')
    await fs.mkdir(bvsDir, { recursive: true })

    const planPath = path.join(bvsDir, 'plan.json')
    await fs.writeFile(planPath, JSON.stringify(plan, null, 2))
  }

  /**
   * Generate success criteria for a section
   */
  private generateSuccessCriteria(proposal: Partial<BvsSection>): BvsSuccessCriteria[] {
    const criteria: BvsSuccessCriteria[] = []

    criteria.push({
      id: 'SC1',
      description: 'All files created/modified successfully',
      passed: false,
    })

    criteria.push({
      id: 'SC2',
      description: 'TypeScript compiles without errors',
      passed: false,
    })

    criteria.push({
      id: 'SC3',
      description: 'Lint passes without errors',
      passed: false,
    })

    return criteria
  }

  /**
   * Extract title from conversation
   */
  private extractTitleFromMessages(messages: BvsPlanningMessage[]): string {
    const firstUserMessage = messages.find(m => m.role === 'user')
    if (firstUserMessage) {
      // Take first 50 chars of first user message as title
      return firstUserMessage.content.substring(0, 50) + (firstUserMessage.content.length > 50 ? '...' : '')
    }
    return 'Untitled Plan'
  }

  /**
   * Calculate dependency level for a section
   * Uses visited set to prevent infinite recursion from circular dependencies
   */
  private calculateLevel(
    section: BvsSection,
    allSections: BvsSection[],
    visited: Set<string> = new Set()
  ): number {
    if (section.dependencies.length === 0) return 0

    // Cycle detection - if we've seen this section, return 0 to break the cycle
    if (visited.has(section.id)) {
      console.warn(`[BvsPlanningAgent] Circular dependency detected at section: ${section.id}`)
      return 0
    }

    visited.add(section.id)

    let maxDepLevel = 0
    for (const depId of section.dependencies) {
      const dep = allSections.find(s => s.id === depId)
      if (dep) {
        const depLevel = this.calculateLevel(dep, allSections, visited)
        maxDepLevel = Math.max(maxDepLevel, depLevel)
      }
    }
    return maxDepLevel + 1
  }

  /**
   * Group sections by level
   */
  private groupByLevel(sections: BvsSection[]): string[][] {
    const levels = new Map<number, string[]>()

    for (const section of sections) {
      const level = this.calculateLevel(section, sections)
      const existing = levels.get(level) || []
      existing.push(section.id)
      levels.set(level, existing)
    }

    const result: string[][] = []
    const maxLevel = Math.max(...levels.keys())
    for (let i = 0; i <= maxLevel; i++) {
      result.push(levels.get(i) || [])
    }
    return result
  }

  /**
   * Find critical path through sections
   */
  private findCriticalPath(sections: BvsSection[]): string[] {
    // Simple implementation: find longest dependency chain
    let longestPath: string[] = []

    for (const section of sections) {
      const path = this.findPathFrom(section, sections)
      if (path.length > longestPath.length) {
        longestPath = path
      }
    }

    return longestPath
  }

  private findPathFrom(
    section: BvsSection,
    allSections: BvsSection[],
    visited: Set<string> = new Set()
  ): string[] {
    if (section.dependents.length === 0) {
      return [section.id]
    }

    // Cycle detection
    if (visited.has(section.id)) {
      return [section.id]
    }

    visited.add(section.id)

    let longestPath: string[] = []
    for (const depId of section.dependents) {
      const dep = allSections.find(s => s.id === depId)
      if (dep) {
        const path = this.findPathFrom(dep, allSections, visited)
        if (path.length > longestPath.length) {
          longestPath = path
        }
      }
    }

    return [section.id, ...longestPath]
  }

  /**
   * Format section proposal for display
   */
  private formatSectionProposal(sections: Partial<BvsSection>[]): string {
    if (sections.length === 0) {
      return 'No sections proposed yet.'
    }

    return sections.map((s, i) => (
      `**Section ${i + 1}: ${s.name || 'Unnamed'}**\n` +
      `${s.description || 'No description'}\n` +
      `Files: ${s.files?.map(f => f.path).join(', ') || 'TBD'}\n` +
      `Dependencies: ${s.dependencies?.length ? s.dependencies.join(', ') : 'None'}`
    )).join('\n\n')
  }

  /**
   * Create a response message
   */
  private createResponse(
    content: string,
    category: BvsPlanningMessage['category']
  ): BvsPlanningMessage {
    return {
      id: this.generateMessageId(),
      role: 'assistant',
      content,
      timestamp: Date.now(),
      category,
    }
  }

  /**
   * Get greeting message
   */
  private getGreetingMessage(): string {
    return (
      "Hello! I'm the BVS Planning Agent. I'll help you break down your task into bounded, verifiable sections.\n\n" +
      "Each section will be small enough to verify (3-5 files) with clear success criteria.\n\n" +
      "**Let's start:** What would you like to build or change in this project?"
    )
  }

  /**
   * Generate unique message ID using crypto for better collision resistance
   */
  private generateMessageId(): string {
    return `msg-${randomUUID().slice(0, 12)}`
  }

  /**
   * Check if file exists
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath)
      return true
    } catch {
      return false
    }
  }
}

// Singleton instance
let bvsPlanningAgentService: BvsPlanningAgentService | null = null

export function getBvsPlanningAgentService(): BvsPlanningAgentService {
  if (!bvsPlanningAgentService) {
    bvsPlanningAgentService = new BvsPlanningAgentService()
  }
  return bvsPlanningAgentService
}

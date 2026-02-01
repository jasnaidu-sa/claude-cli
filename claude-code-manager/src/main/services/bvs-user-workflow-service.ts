/**
 * BVS User Workflow Service
 *
 * Analyzes codebase structure to understand user workflows and ensure
 * new features integrate properly into the application's user experience.
 *
 * Key responsibilities:
 * - Identify entry points (how users access features)
 * - Map user journeys (screens, actions, components)
 * - Identify exit points (where users go after)
 * - Detect workflow gaps (missing navigation, orphaned features)
 * - Suggest routing/navigation changes
 *
 * Runs during:
 * 1. Planning phase - to inform the plan
 * 2. After planning - to validate the plan covers UX
 */

import { EventEmitter } from 'events'
import * as path from 'path'
import * as fs from 'fs/promises'
import { glob } from 'glob'
import type { BvsSection, BvsExecutionPlan } from '@shared/bvs-types'
import { getBvsSubagentService } from './bvs-subagent-service'

// ============================================================================
// Types
// ============================================================================

export interface UserWorkflowEntryPoint {
  location: string           // e.g., "Dashboard sidebar", "Header navigation"
  triggerType: 'button' | 'link' | 'menu_item' | 'route' | 'keyboard_shortcut'
  existingComponent: string  // Component that needs modification
  proposedChange: string     // What to add/modify
  file: string              // File path
  priority: 'required' | 'recommended' | 'optional'
}

export interface UserJourneyStep {
  step: number
  action: string             // What user does
  screen: string             // What they see
  component: string          // Component involved
  file?: string              // File path if known
  needsCreation: boolean     // Does this component exist?
  notes?: string
}

export interface UserWorkflowExitPoint {
  location: string           // Where user ends up
  action: string             // What triggers exit
  destination: string        // Where they go (route or state)
  type: 'navigation' | 'modal_close' | 'form_submit' | 'action_complete'
}

export interface WorkflowGap {
  description: string
  severity: 'critical' | 'major' | 'minor'
  recommendation: string
  affectedFiles?: string[]
}

export interface RoutingChange {
  type: 'add' | 'modify' | 'remove'
  path: string
  component: string
  file: string
  guards?: string[]
  reason: string
}

export interface UserWorkflowAnalysis {
  featureName: string
  featureDescription: string

  // Entry points - how users discover/access the feature
  entryPoints: UserWorkflowEntryPoint[]

  // User journey - step by step flow
  userJourney: UserJourneyStep[]

  // Exit points - where users go after
  exitPoints: UserWorkflowExitPoint[]

  // Gaps detected
  workflowGaps: WorkflowGap[]

  // Routing changes needed
  routingChanges: RoutingChange[]

  // Summary
  summary: string

  // Is the workflow complete?
  isComplete: boolean

  // Confidence score (0-100)
  confidence: number

  // Analysis metadata
  analyzedFiles: string[]
  analysisTimestamp: number
}

export interface WorkflowAnalysisConfig {
  projectPath: string
  featureName: string
  featureDescription: string
  plannedFiles?: string[]       // Files the plan will create/modify
  plannedSections?: BvsSection[]
  existingPlan?: BvsExecutionPlan
  mode: 'planning' | 'validation'
}

// ============================================================================
// Constants
// ============================================================================

// File patterns to analyze for routing
const ROUTING_PATTERNS = [
  '**/app/**/page.tsx',
  '**/app/**/page.ts',
  '**/app/**/layout.tsx',
  '**/pages/**/*.tsx',
  '**/pages/**/*.ts',
  '**/src/routes/**/*.tsx',
  '**/src/router/**/*.ts',
  '**/routes.ts',
  '**/router.ts',
  '**/App.tsx',
]

// File patterns for navigation components
const NAVIGATION_PATTERNS = [
  '**/components/**/[Nn]av*.tsx',
  '**/components/**/[Ss]idebar*.tsx',
  '**/components/**/[Hh]eader*.tsx',
  '**/components/**/[Mm]enu*.tsx',
  '**/components/**/[Tt]abs*.tsx',
  '**/layouts/**/*.tsx',
]

// File patterns for shared UI components
const UI_COMPONENT_PATTERNS = [
  '**/components/**/*.tsx',
  '**/ui/**/*.tsx',
]

// ============================================================================
// System Prompts
// ============================================================================

const USER_WORKFLOW_ANALYSIS_PROMPT = `You are a User Workflow Agent. Your job is to analyze how a new feature will fit into the user experience of an application.

TASK: Analyze user workflow for the feature described below.

FEATURE:
{feature_name}: {feature_description}

PLANNED FILES (if available):
{planned_files}

EXISTING CODEBASE CONTEXT:
{codebase_context}

ROUTING FILES:
{routing_files}

NAVIGATION COMPONENTS:
{navigation_files}

INSTRUCTIONS:

1. IDENTIFY ENTRY POINTS:
   - How will users discover this feature?
   - What existing UI elements need modification?
   - Are there multiple ways to access it?

2. MAP USER JOURNEY:
   - What screens/modals are involved?
   - What actions can users take at each step?
   - What components are needed for each step?

3. IDENTIFY EXIT POINTS:
   - Where do users go when they're done?
   - What happens on success/failure/cancel?

4. DETECT WORKFLOW GAPS:
   - Missing navigation elements?
   - Missing routes?
   - Orphaned features (no way to access)?
   - Missing error/loading states?

5. SUGGEST ROUTING CHANGES:
   - New routes needed?
   - Existing routes to modify?
   - Route guards/protection?

OUTPUT FORMAT (JSON):
{
  "entryPoints": [
    {
      "location": "Header navigation",
      "triggerType": "button",
      "existingComponent": "Header",
      "proposedChange": "Add 'Feature' button next to Settings",
      "file": "src/components/Header.tsx",
      "priority": "required"
    }
  ],
  "userJourney": [
    {
      "step": 1,
      "action": "User clicks Feature button",
      "screen": "Feature modal opens",
      "component": "FeatureModal",
      "needsCreation": true
    }
  ],
  "exitPoints": [
    {
      "location": "Feature modal",
      "action": "Click Save",
      "destination": "Close modal, show success toast",
      "type": "form_submit"
    }
  ],
  "workflowGaps": [
    {
      "description": "No entry point exists in navigation",
      "severity": "critical",
      "recommendation": "Add button to Header component"
    }
  ],
  "routingChanges": [
    {
      "type": "add",
      "path": "/feature",
      "component": "FeaturePage",
      "file": "src/app/feature/page.tsx",
      "reason": "Direct URL access to feature"
    }
  ],
  "summary": "Brief summary of the workflow analysis",
  "isComplete": false,
  "confidence": 75
}

CRITICAL RULES:
- A feature without an entry point is INCOMPLETE
- Every feature MUST be accessible from the UI
- Consider both happy path and error states
- Be specific about file paths and component names`

const WORKFLOW_VALIDATION_PROMPT = `You are a User Workflow Validator. Your job is to verify that a planned implementation will result in a complete, accessible user experience.

FEATURE:
{feature_name}: {feature_description}

PLANNED SECTIONS:
{planned_sections}

PREVIOUS WORKFLOW ANALYSIS:
{previous_analysis}

VALIDATE:
1. Does the plan include all required entry points?
2. Are all user journey steps covered by planned files?
3. Are exit points properly handled?
4. Are workflow gaps addressed in the plan?
5. Are routing changes included?

OUTPUT FORMAT (JSON):
{
  "isValid": true/false,
  "missingElements": [
    {
      "type": "entry_point" | "journey_step" | "exit_point" | "routing",
      "description": "What's missing",
      "recommendation": "How to fix"
    }
  ],
  "planAdjustments": [
    {
      "sectionId": "section-id or NEW",
      "adjustment": "What to add/change",
      "reason": "Why this is needed for UX"
    }
  ],
  "summary": "Validation summary",
  "confidence": 85
}`

// ============================================================================
// Service
// ============================================================================

export class BvsUserWorkflowService extends EventEmitter {
  constructor() {
    super()
  }

  /**
   * Analyze user workflow for a feature
   *
   * Called during planning phase to understand UX requirements
   */
  async analyzeWorkflow(config: WorkflowAnalysisConfig): Promise<UserWorkflowAnalysis> {
    console.log(`[UserWorkflow] Analyzing workflow for: ${config.featureName}`)
    const startTime = Date.now()

    this.emit('analysis-started', {
      featureName: config.featureName,
      mode: config.mode,
    })

    try {
      // 1. Gather codebase context
      const context = await this.gatherCodebaseContext(config.projectPath)

      // 2. Read routing files
      const routingFiles = await this.readRoutingFiles(config.projectPath)

      // 3. Read navigation components
      const navigationFiles = await this.readNavigationFiles(config.projectPath)

      // 4. Build prompt
      const prompt = this.buildAnalysisPrompt(config, context, routingFiles, navigationFiles)

      // 5. Run LLM analysis
      const analysis = await this.runLLMAnalysis(prompt, config)

      // 6. Emit completion
      this.emit('analysis-completed', {
        featureName: config.featureName,
        duration: Date.now() - startTime,
        gapsFound: analysis.workflowGaps.length,
        isComplete: analysis.isComplete,
      })

      return analysis

    } catch (error) {
      console.error(`[UserWorkflow] Analysis failed:`, error)
      this.emit('analysis-failed', {
        featureName: config.featureName,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  /**
   * Validate that a plan covers the workflow requirements
   *
   * Called after planning to ensure UX is covered
   */
  async validatePlanWorkflow(
    config: WorkflowAnalysisConfig,
    previousAnalysis: UserWorkflowAnalysis
  ): Promise<{
    isValid: boolean
    missingElements: Array<{
      type: 'entry_point' | 'journey_step' | 'exit_point' | 'routing'
      description: string
      recommendation: string
    }>
    planAdjustments: Array<{
      sectionId: string
      adjustment: string
      reason: string
    }>
    summary: string
    confidence: number
  }> {
    console.log(`[UserWorkflow] Validating plan workflow for: ${config.featureName}`)

    this.emit('validation-started', {
      featureName: config.featureName,
    })

    try {
      const prompt = this.buildValidationPrompt(config, previousAnalysis)
      const result = await this.runValidationAnalysis(prompt)

      this.emit('validation-completed', {
        featureName: config.featureName,
        isValid: result.isValid,
        missingCount: result.missingElements.length,
      })

      return result

    } catch (error) {
      console.error(`[UserWorkflow] Validation failed:`, error)
      throw error
    }
  }

  /**
   * Quick check if a section creates an orphaned feature
   */
  async checkForOrphanedFeature(
    projectPath: string,
    section: BvsSection
  ): Promise<{
    isOrphaned: boolean
    reason?: string
    suggestedEntryPoint?: string
  }> {
    // Check if section creates UI components but no navigation changes
    const createsUI = section.files.some(f =>
      f.action === 'create' &&
      (f.path.includes('/components/') || f.path.includes('/pages/') || f.path.includes('/app/'))
    )

    const modifiesNavigation = section.files.some(f =>
      f.action === 'modify' &&
      (f.path.toLowerCase().includes('nav') ||
       f.path.toLowerCase().includes('sidebar') ||
       f.path.toLowerCase().includes('header') ||
       f.path.toLowerCase().includes('menu') ||
       f.path.toLowerCase().includes('router') ||
       f.path.toLowerCase().includes('routes'))
    )

    if (createsUI && !modifiesNavigation) {
      return {
        isOrphaned: true,
        reason: 'Creates UI components but no navigation changes to access them',
        suggestedEntryPoint: 'Add entry point in navigation or sidebar',
      }
    }

    return { isOrphaned: false }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private async gatherCodebaseContext(projectPath: string): Promise<string> {
    const context: string[] = []

    // Check for common frameworks
    try {
      const packageJsonPath = path.join(projectPath, 'package.json')
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'))

      const deps = { ...packageJson.dependencies, ...packageJson.devDependencies }

      if (deps['next']) context.push('Framework: Next.js')
      if (deps['react-router'] || deps['react-router-dom']) context.push('Router: React Router')
      if (deps['@tanstack/react-router']) context.push('Router: TanStack Router')
      if (deps['vue-router']) context.push('Router: Vue Router')
      if (deps['@supabase/supabase-js']) context.push('Backend: Supabase')
      if (deps['@radix-ui/react-dialog']) context.push('UI: Radix UI (has modal/dialog support)')
      if (deps['@shadcn/ui'] || deps['shadcn-ui']) context.push('UI: shadcn/ui')

    } catch {
      context.push('Could not read package.json')
    }

    // Check directory structure
    try {
      const srcPath = path.join(projectPath, 'src')
      const srcExists = await fs.stat(srcPath).then(() => true).catch(() => false)

      if (srcExists) {
        const srcContents = await fs.readdir(srcPath)
        context.push(`src/ contains: ${srcContents.slice(0, 10).join(', ')}`)
      }

      // Check for app directory (Next.js App Router)
      const appPath = path.join(projectPath, 'src', 'app')
      const appExists = await fs.stat(appPath).then(() => true).catch(() => false)
      if (appExists) {
        context.push('Uses Next.js App Router (src/app/)')
      }

      // Check for pages directory
      const pagesPath = path.join(projectPath, 'src', 'pages')
      const pagesExists = await fs.stat(pagesPath).then(() => true).catch(() => false)
      if (pagesExists) {
        context.push('Uses pages directory (src/pages/)')
      }

    } catch {
      // Ignore
    }

    return context.join('\n')
  }

  private async readRoutingFiles(projectPath: string): Promise<string> {
    const files: string[] = []

    for (const pattern of ROUTING_PATTERNS) {
      try {
        const matches = await glob(pattern, {
          cwd: projectPath,
          nodir: true,
          ignore: ['**/node_modules/**', '**/.next/**', '**/dist/**'],
        })

        for (const match of matches.slice(0, 5)) {  // Limit to 5 per pattern
          try {
            const content = await fs.readFile(path.join(projectPath, match), 'utf-8')
            // Truncate large files
            const truncated = content.length > 2000 ? content.slice(0, 2000) + '\n... (truncated)' : content
            files.push(`=== ${match} ===\n${truncated}`)
          } catch {
            // Skip unreadable files
          }
        }
      } catch {
        // Pattern didn't match
      }
    }

    return files.length > 0 ? files.join('\n\n') : 'No routing files found'
  }

  private async readNavigationFiles(projectPath: string): Promise<string> {
    const files: string[] = []

    for (const pattern of NAVIGATION_PATTERNS) {
      try {
        const matches = await glob(pattern, {
          cwd: projectPath,
          nodir: true,
          ignore: ['**/node_modules/**', '**/.next/**', '**/dist/**'],
        })

        for (const match of matches.slice(0, 3)) {  // Limit to 3 per pattern
          try {
            const content = await fs.readFile(path.join(projectPath, match), 'utf-8')
            const truncated = content.length > 1500 ? content.slice(0, 1500) + '\n... (truncated)' : content
            files.push(`=== ${match} ===\n${truncated}`)
          } catch {
            // Skip unreadable files
          }
        }
      } catch {
        // Pattern didn't match
      }
    }

    return files.length > 0 ? files.join('\n\n') : 'No navigation components found'
  }

  private buildAnalysisPrompt(
    config: WorkflowAnalysisConfig,
    context: string,
    routingFiles: string,
    navigationFiles: string
  ): string {
    const plannedFiles = config.plannedFiles?.join('\n') || 'Not yet determined'

    return USER_WORKFLOW_ANALYSIS_PROMPT
      .replace('{feature_name}', config.featureName)
      .replace('{feature_description}', config.featureDescription)
      .replace('{planned_files}', plannedFiles)
      .replace('{codebase_context}', context)
      .replace('{routing_files}', routingFiles)
      .replace('{navigation_files}', navigationFiles)
  }

  private buildValidationPrompt(
    config: WorkflowAnalysisConfig,
    previousAnalysis: UserWorkflowAnalysis
  ): string {
    const plannedSections = config.plannedSections?.map(s => ({
      name: s.name,
      description: s.description,
      files: s.files.map(f => `${f.action}: ${f.path}`),
    })) || []

    return WORKFLOW_VALIDATION_PROMPT
      .replace('{feature_name}', config.featureName)
      .replace('{feature_description}', config.featureDescription)
      .replace('{planned_sections}', JSON.stringify(plannedSections, null, 2))
      .replace('{previous_analysis}', JSON.stringify(previousAnalysis, null, 2))
  }

  private async runLLMAnalysis(prompt: string, config: WorkflowAnalysisConfig): Promise<UserWorkflowAnalysis> {
    const subagentService = getBvsSubagentService()

    const result = await subagentService.spawn({
      type: 'architect',  // Use architect type for analysis
      prompt,
      projectPath: config.projectPath,
      model: 'sonnet',
      maxTurns: 1,
      timeout: 60000,
    })

    if (result.status !== 'completed') {
      throw new Error(`Workflow analysis failed: ${result.error}`)
    }

    // Parse the JSON output
    const jsonMatch = result.output.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error('Could not parse workflow analysis output')
    }

    try {
      const parsed = JSON.parse(jsonMatch[0])

      return {
        featureName: config.featureName,
        featureDescription: config.featureDescription,
        entryPoints: parsed.entryPoints || [],
        userJourney: parsed.userJourney || [],
        exitPoints: parsed.exitPoints || [],
        workflowGaps: parsed.workflowGaps || [],
        routingChanges: parsed.routingChanges || [],
        summary: parsed.summary || '',
        isComplete: parsed.isComplete ?? false,
        confidence: parsed.confidence ?? 50,
        analyzedFiles: [],
        analysisTimestamp: Date.now(),
      }
    } catch (e) {
      throw new Error(`Failed to parse workflow analysis: ${e}`)
    }
  }

  private async runValidationAnalysis(prompt: string): Promise<{
    isValid: boolean
    missingElements: Array<{
      type: 'entry_point' | 'journey_step' | 'exit_point' | 'routing'
      description: string
      recommendation: string
    }>
    planAdjustments: Array<{
      sectionId: string
      adjustment: string
      reason: string
    }>
    summary: string
    confidence: number
  }> {
    const subagentService = getBvsSubagentService()

    const result = await subagentService.spawn({
      type: 'architect',
      prompt,
      projectPath: process.cwd(),
      model: 'haiku',  // Validation can use faster model
      maxTurns: 1,
      timeout: 30000,
    })

    if (result.status !== 'completed') {
      throw new Error(`Workflow validation failed: ${result.error}`)
    }

    const jsonMatch = result.output.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error('Could not parse validation output')
    }

    try {
      const parsed = JSON.parse(jsonMatch[0])
      return {
        isValid: parsed.isValid ?? false,
        missingElements: parsed.missingElements || [],
        planAdjustments: parsed.planAdjustments || [],
        summary: parsed.summary || '',
        confidence: parsed.confidence ?? 50,
      }
    } catch (e) {
      throw new Error(`Failed to parse validation result: ${e}`)
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

let bvsUserWorkflowService: BvsUserWorkflowService | null = null

export function getBvsUserWorkflowService(): BvsUserWorkflowService {
  if (!bvsUserWorkflowService) {
    bvsUserWorkflowService = new BvsUserWorkflowService()
  }
  return bvsUserWorkflowService
}

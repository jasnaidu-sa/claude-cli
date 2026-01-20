/**
 * AI Task Extractor Service
 * Uses Claude API to analyze PRD and extract structured tasks with dependencies
 */

import Anthropic from '@anthropic-ai/sdk'
import * as path from 'path'
import type { RalphTask, TaskCategory, TaskComplexity } from '../../shared/ralph-types'
import type { ExtractedTask, PrdParseResult } from './prd-parser-service'

// =============================================================================
// Constants
// =============================================================================

const MAX_CONTENT_SIZE = 100 * 1024 // 100KB max PRD size
const MAX_PATH_LENGTH = 500
const MAX_TITLE_LENGTH = 500
const MAX_DESCRIPTION_LENGTH = 5000

/** Valid task categories */
const VALID_CATEGORIES: readonly TaskCategory[] = [
  'backend',
  'frontend',
  'mobile',
  'testing',
  'types',
  'infrastructure',
  'documentation',
] as const

/** Valid complexity levels */
const VALID_COMPLEXITIES: readonly TaskComplexity[] = ['low', 'medium', 'high'] as const

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Type guard for valid task category
 */
function isValidCategory(value: unknown): value is TaskCategory {
  return typeof value === 'string' && VALID_CATEGORIES.includes(value as TaskCategory)
}

/**
 * Type guard for valid complexity
 */
function isValidComplexity(value: unknown): value is TaskComplexity {
  return typeof value === 'string' && VALID_COMPLEXITIES.includes(value as TaskComplexity)
}

// =============================================================================
// Validation Utilities
// =============================================================================

/**
 * Validate and sanitize task title
 */
function validateTaskTitle(title: string | undefined, index: number): string {
  if (!title) {
    return `Task ${index + 1}`
  }
  // Remove control characters
  const cleaned = title.replace(/[\x00-\x1F\x7F-\x9F]/g, '').trim()
  if (cleaned.length === 0) {
    return `Task ${index + 1}`
  }
  return cleaned.substring(0, MAX_TITLE_LENGTH)
}

/**
 * Validate and sanitize task description
 */
function validateTaskDescription(description: string | undefined): string {
  if (!description) return ''
  // Remove control characters
  const cleaned = description.replace(/[\x00-\x1F\x7F-\x9F]/g, '').trim()
  return cleaned.substring(0, MAX_DESCRIPTION_LENGTH)
}

/**
 * Validate file paths from AI response
 */
function validateFilePaths(paths: string[] | undefined): string[] | undefined {
  if (!paths || !Array.isArray(paths)) return undefined

  const validated: string[] = []
  for (const filePath of paths) {
    if (typeof filePath !== 'string') continue
    // Reject absolute paths
    if (path.isAbsolute(filePath)) continue
    // Reject path traversal
    const normalized = path.normalize(filePath)
    if (normalized.includes('..') || normalized.startsWith('/') || normalized.startsWith('\\')) continue
    // Limit path length
    if (filePath.length > MAX_PATH_LENGTH) continue
    validated.push(normalized)
  }

  return validated.length > 0 ? validated : undefined
}

/**
 * AI extraction result
 */
export interface AiExtractionResult {
  /** Extracted tasks with AI enhancements */
  tasks: RalphTask[]

  /** Project name inferred from PRD */
  projectName: string

  /** Project description */
  projectDescription: string

  /** Suggested settings */
  suggestedSettings: {
    maxParallelAgents: number
    runTests: boolean
    runLint: boolean
  }

  /** Warnings or suggestions */
  warnings: string[]
}

/**
 * AI Task Extractor Service
 */
export class AiTaskExtractorService {
  private client: Anthropic | null = null

  /**
   * Initialize with API key
   */
  initialize(apiKey: string): void {
    this.client = new Anthropic({ apiKey })
  }

  /**
   * Check if service is initialized
   */
  isInitialized(): boolean {
    return this.client !== null
  }

  /**
   * Extract and enhance tasks from PRD using AI
   */
  async extractTasks(
    prdContent: string,
    parsedResult: PrdParseResult
  ): Promise<AiExtractionResult> {
    if (!this.client) {
      throw new Error('AI Task Extractor not initialized. Call initialize() first.')
    }

    // Validate input size
    if (prdContent.length > MAX_CONTENT_SIZE) {
      throw new Error(`PRD content too large: ${prdContent.length} bytes (max: ${MAX_CONTENT_SIZE})`)
    }

    const prompt = this.buildExtractionPrompt(prdContent, parsedResult)

    const response = await this.client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000, // Reduced from 8000 for cost control
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    })

    // Validate response structure
    if (!response || !response.content || response.content.length === 0) {
      throw new Error('Empty or invalid response from AI')
    }

    // Extract text content from response
    const textContent = response.content.find((c: { type: string }) => c.type === 'text')
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No text response from AI')
    }

    // Parse the JSON response
    return this.parseAiResponse(textContent.text, parsedResult)
  }

  /**
   * Build the extraction prompt
   */
  private buildExtractionPrompt(prdContent: string, parsedResult: PrdParseResult): string {
    const preExtractedInfo = parsedResult.tasks.length > 0
      ? `
## Pre-extracted Tasks (from markdown parsing)
${parsedResult.tasks.map((t, i) => `${i + 1}. ${t.title}${t.category ? ` [${t.category}]` : ''}`).join('\n')}
`
      : ''

    return `You are a software architect analyzing a PRD (Product Requirements Document) to extract structured tasks.

## PRD Content
\`\`\`
${prdContent}
\`\`\`

${preExtractedInfo}

## Your Task
Analyze this PRD and extract ALL tasks/requirements into a structured format. For each task:

1. **Identify Dependencies**: Determine which tasks must complete before others can start
   - Database models before API endpoints
   - API endpoints before frontend components
   - Core utilities before features that use them
   - Setup/config before implementation

2. **Assign Categories**: backend, frontend, mobile, testing, types, infrastructure, documentation

3. **Estimate Complexity**: low, medium, high based on:
   - low: Simple changes, config updates, minor UI tweaks
   - medium: Standard features, CRUD operations, typical components
   - high: Complex logic, integrations, architectural changes

4. **Generate Acceptance Criteria**: 2-4 specific, testable criteria per task

5. **Identify Files**: Suggest files to create or modify

## Response Format
Return ONLY a valid JSON object (no markdown code blocks) with this structure:

{
  "projectName": "string",
  "projectDescription": "string",
  "tasks": [
    {
      "id": "task-001",
      "title": "string",
      "description": "detailed description",
      "category": "backend|frontend|mobile|testing|types|infrastructure|documentation",
      "estimated_complexity": "low|medium|high",
      "dependencies": ["task-id-1", "task-id-2"],
      "acceptance_criteria": ["criterion 1", "criterion 2"],
      "files_to_create": ["path/to/file.ts"],
      "files_to_modify": ["path/to/existing.ts"]
    }
  ],
  "suggestedSettings": {
    "maxParallelAgents": 3,
    "runTests": true,
    "runLint": true
  },
  "warnings": ["any concerns or suggestions"]
}

Important:
- Use sequential IDs: task-001, task-002, etc.
- Dependencies reference task IDs that MUST complete first
- Group related tasks that can run in parallel (no dependencies between them)
- Be thorough - extract ALL tasks from the PRD
- Generate meaningful acceptance criteria that can be verified`
  }

  /**
   * Parse the AI response into structured result
   */
  private parseAiResponse(responseText: string, parsedResult: PrdParseResult): AiExtractionResult {
    // Try to extract JSON from response
    let jsonStr = responseText.trim()

    // Remove markdown code blocks if present
    if (jsonStr.startsWith('```')) {
      const lines = jsonStr.split('\n')
      // Remove first line (```json or ```)
      lines.shift()
      // Remove last line (```)
      if (lines[lines.length - 1]?.trim() === '```') {
        lines.pop()
      }
      jsonStr = lines.join('\n')
    }

    let parsed: {
      projectName?: string
      projectDescription?: string
      tasks?: Array<{
        id: string
        title: string
        description?: string
        category?: string
        estimated_complexity?: string
        dependencies?: string[]
        acceptance_criteria?: string[]
        files_to_create?: string[]
        files_to_modify?: string[]
      }>
      suggestedSettings?: {
        maxParallelAgents?: number
        runTests?: boolean
        runLint?: boolean
      }
      warnings?: string[]
    }

    try {
      parsed = JSON.parse(jsonStr)
    } catch (error) {
      // Try to find JSON object in the response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        try {
          parsed = JSON.parse(jsonMatch[0])
        } catch {
          throw new Error(`Failed to parse AI response as JSON: ${error}`)
        }
      } else {
        throw new Error(`Failed to parse AI response as JSON: ${error}`)
      }
    }

    // Validate and transform tasks with proper type guards
    const tasks: RalphTask[] = (parsed.tasks || []).map((t, index) => ({
      id: t.id || `task-${String(index + 1).padStart(4, '0')}`,
      title: validateTaskTitle(t.title, index),
      description: validateTaskDescription(t.description),
      category: isValidCategory(t.category) ? t.category : 'backend',
      parallel_group: 0, // Will be calculated by dependency graph service
      dependencies: Array.isArray(t.dependencies) ? t.dependencies.filter(d => typeof d === 'string') : [],
      estimated_complexity: isValidComplexity(t.estimated_complexity) ? t.estimated_complexity : 'medium',
      acceptance_criteria: Array.isArray(t.acceptance_criteria)
        ? t.acceptance_criteria.filter(c => typeof c === 'string').slice(0, 10)
        : ['Task completed successfully'],
      files_to_create: validateFilePaths(t.files_to_create),
      files_to_modify: validateFilePaths(t.files_to_modify),
      completed: false,
    }))

    return {
      tasks,
      projectName: parsed.projectName || parsedResult.title || 'Unnamed Project',
      projectDescription: parsed.projectDescription || parsedResult.description || '',
      suggestedSettings: {
        maxParallelAgents: parsed.suggestedSettings?.maxParallelAgents || 3,
        runTests: parsed.suggestedSettings?.runTests ?? true,
        runLint: parsed.suggestedSettings?.runLint ?? true,
      },
      warnings: parsed.warnings || [],
    }
  }


  /**
   * Generate acceptance criteria for a task using AI
   */
  async generateAcceptanceCriteria(task: ExtractedTask): Promise<string[]> {
    if (!this.client) {
      throw new Error('AI Task Extractor not initialized')
    }

    const response = await this.client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      messages: [
        {
          role: 'user',
          content: `Generate 2-4 specific, testable acceptance criteria for this task:

Title: ${task.title}
Description: ${task.description || 'No description provided'}
Category: ${task.category || 'Unknown'}

Return ONLY a JSON array of strings, e.g.: ["criterion 1", "criterion 2"]`,
        },
      ],
    })

    const textContent = response.content.find((c: { type: string }) => c.type === 'text')
    if (!textContent || textContent.type !== 'text') {
      return ['Task completed successfully']
    }

    try {
      const criteria = JSON.parse(textContent.text)
      if (Array.isArray(criteria)) {
        return criteria
      }
    } catch {
      // Try to extract array from response
      const match = textContent.text.match(/\[[\s\S]*\]/)
      if (match) {
        try {
          const criteria = JSON.parse(match[0])
          if (Array.isArray(criteria)) {
            return criteria
          }
        } catch {
          // Fall through to default
        }
      }
    }

    return ['Task completed successfully']
  }

  /**
   * Suggest dependencies between tasks using AI
   */
  async suggestDependencies(tasks: RalphTask[]): Promise<Map<string, string[]>> {
    if (!this.client) {
      throw new Error('AI Task Extractor not initialized')
    }

    const taskList = tasks.map((t) => `${t.id}: ${t.title} [${t.category}]`).join('\n')

    const response = await this.client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [
        {
          role: 'user',
          content: `Analyze these tasks and identify dependencies (which tasks must complete before others):

${taskList}

Rules:
- Database/model tasks before API tasks
- API tasks before frontend tasks that call them
- Core/shared code before features using it
- Only include DIRECT dependencies

Return ONLY a JSON object mapping task IDs to arrays of dependency IDs:
{"task-002": ["task-001"], "task-003": ["task-001", "task-002"]}`,
        },
      ],
    })

    const textContent = response.content.find((c: { type: string }) => c.type === 'text')
    if (!textContent || textContent.type !== 'text') {
      return new Map()
    }

    try {
      const deps = JSON.parse(textContent.text)
      return new Map(Object.entries(deps))
    } catch {
      return new Map()
    }
  }
}

// Export singleton instance
export const aiTaskExtractorService = new AiTaskExtractorService()

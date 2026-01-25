/**
 * BVS Planning Agent V2
 *
 * Uses Claude Agent SDK with tools to create intelligent, context-aware
 * implementation plans. Follows Claude Plan Mode UX pattern:
 *
 * 1. Silent exploration (tools gather context)
 * 2. Present options (user selects approach)
 * 3. Generate sections (detailed breakdown)
 * 4. Approve & write plan.md
 */

import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'
import * as path from 'path'
import * as fs from 'fs/promises'
import { glob } from 'glob'
import { getMainWindow } from '../index'

// Types for Agent SDK (dynamic import)
import type { Query, SDKMessage, SDKUserMessage, Options } from '@anthropic-ai/claude-agent-sdk'

// Import BVS types for execution plan and project management
import type {
  BvsExecutionPlan,
  BvsSection,
  BvsDependencyGraph,
  BvsParallelGroup,
  BvsCodebaseContext,
  BvsParallelConfig,
  BvsProject,
  BvsProjectStatus,
} from '../../shared/bvs-types'
import {
  BVS_PROJECT_FILES,
  BVS_GLOBAL_FILES,
} from '../../shared/bvs-types'

// ============================================================================
// Constants
// ============================================================================

const SONNET_MODEL = 'claude-sonnet-4-20250514'
const HAIKU_MODEL = 'claude-haiku-4-20250514' // For quick tasks like name generation
const MAX_TURNS = 8 // 5 base + 3 buffer for clarifications
const BVS_DIR = '.bvs'

// IPC Channels for streaming
export const BVS_PLANNING_CHANNELS = {
  TOOL_START: 'bvs-planning:tool-start',
  TOOL_RESULT: 'bvs-planning:tool-result',
  RESPONSE_CHUNK: 'bvs-planning:response-chunk',
  RESPONSE_COMPLETE: 'bvs-planning:response-complete',
  QUESTIONS_READY: 'bvs-planning:questions-ready',
  OPTIONS_READY: 'bvs-planning:options-ready',
  SECTIONS_READY: 'bvs-planning:sections-ready',
  PLAN_WRITTEN: 'bvs-planning:plan-written',
  ERROR: 'bvs-planning:error',
} as const

// ============================================================================
// Types
// ============================================================================

export interface PlanningQuestionOption {
  id: string
  label: string
  description: string
}

export interface PlanningQuestion {
  id: string
  category: string
  question: string
  options: PlanningQuestionOption[]
}

export interface PlanningOption {
  id: string
  name: string
  description: string
  recommended?: boolean
  sectionCount: number
  complexity: 'low' | 'medium' | 'high'
}

export interface PlannedSection {
  id: string
  name: string
  description: string
  files: Array<{
    path: string
    action: 'create' | 'modify' | 'delete'
  }>
  dependencies: string[]
  successCriteria: string[]
}

export interface PlanningMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  questions?: PlanningQuestion[]
  options?: PlanningOption[]
  sections?: PlannedSection[]
  toolCalls?: Array<{
    name: string
    input: Record<string, unknown>
    result?: string
  }>
}

export interface PlanningSessionV2 {
  id: string
  projectPath: string
  messages: PlanningMessage[]
  phase: 'exploring' | 'options' | 'planning' | 'approval' | 'complete'
  selectedOption?: string
  proposedSections?: PlannedSection[]
  sdkSessionId?: string
  createdAt: number
  updatedAt: number
  totalCostUsd?: number

  // Project management
  projectId?: string              // e.g., "budgeting-module-20260121-143052"
  projectName?: string            // AI-generated: "Budgeting Module"
  projectSlug?: string            // kebab-case: "budgeting-module"
  projectDir?: string             // Full path to project directory
}

// ============================================================================
// Agent SDK Dynamic Import
// ============================================================================

let sdkModule: typeof import('@anthropic-ai/claude-agent-sdk') | null = null

async function getSDK(): Promise<typeof import('@anthropic-ai/claude-agent-sdk')> {
  if (!sdkModule) {
    sdkModule = await import('@anthropic-ai/claude-agent-sdk')
    console.log('[BvsPlanningV2] Agent SDK loaded')
  }
  return sdkModule
}

// ============================================================================
// Project Management Utilities
// ============================================================================

/**
 * Generate a project name from the user's first message using AI
 */
async function generateProjectName(userMessage: string): Promise<{ name: string; slug: string; description: string }> {
  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const client = new Anthropic()

    const response = await client.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: `Based on this project request, generate a concise project name (2-4 words), a kebab-case slug, and a one-sentence description.

Request: "${userMessage.slice(0, 500)}"

Respond ONLY with JSON in this exact format:
{"name": "Project Name", "slug": "project-name", "description": "Brief description of what the project does."}`
      }]
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    const parsed = JSON.parse(text)

    return {
      name: parsed.name || 'Unnamed Project',
      slug: (parsed.slug || 'unnamed-project').toLowerCase().replace(/[^a-z0-9-]/g, '-'),
      description: parsed.description || 'No description provided'
    }
  } catch (error) {
    console.error('[BvsPlanningV2] Error generating project name:', error)
    // Fallback: extract first few words
    const words = userMessage.slice(0, 50).split(/\s+/).slice(0, 3).join(' ')
    const slug = words.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    return {
      name: words || 'Unnamed Project',
      slug: slug || 'unnamed-project',
      description: 'Project created from planning session'
    }
  }
}

/**
 * Generate a unique project ID with timestamp
 */
function generateProjectId(slug: string): string {
  const timestamp = new Date().toISOString()
    .replace(/[-:]/g, '')
    .replace('T', '-')
    .slice(0, 15) // YYYYMMDD-HHMMSS
  return `${slug}-${timestamp}`
}

/**
 * Create project directory structure
 */
async function createProjectDirectory(
  projectPath: string,
  projectId: string
): Promise<string> {
  const projectDir = path.join(projectPath, BVS_DIR, BVS_GLOBAL_FILES.PROJECTS_DIR, projectId)

  // Create directories
  await fs.mkdir(projectDir, { recursive: true })
  await fs.mkdir(path.join(projectDir, BVS_PROJECT_FILES.LOGS_DIR), { recursive: true })
  await fs.mkdir(path.join(projectDir, BVS_PROJECT_FILES.CHECKPOINTS_DIR), { recursive: true })

  console.log('[BvsPlanningV2] Created project directory:', projectDir)
  return projectDir
}

/**
 * Create and save project metadata
 */
async function createProjectMetadata(
  projectDir: string,
  projectPath: string,
  projectId: string,
  name: string,
  slug: string,
  description: string
): Promise<BvsProject> {
  const project: BvsProject = {
    id: projectId,
    name,
    slug,
    description,
    status: 'planning',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    sectionsTotal: 0,
    sectionsCompleted: 0,
    sectionsFailed: 0,
    projectPath,
    bvsProjectDir: projectDir,
  }

  const projectJsonPath = path.join(projectDir, BVS_PROJECT_FILES.PROJECT_JSON)
  await fs.writeFile(projectJsonPath, JSON.stringify(project, null, 2), 'utf-8')

  console.log('[BvsPlanningV2] Created project metadata:', projectJsonPath)
  return project
}

/**
 * Update project metadata
 */
async function updateProjectMetadata(
  projectDir: string,
  updates: Partial<BvsProject>
): Promise<BvsProject> {
  const projectJsonPath = path.join(projectDir, BVS_PROJECT_FILES.PROJECT_JSON)

  try {
    const existing = JSON.parse(await fs.readFile(projectJsonPath, 'utf-8')) as BvsProject
    const updated: BvsProject = {
      ...existing,
      ...updates,
      updatedAt: Date.now(),
    }
    await fs.writeFile(projectJsonPath, JSON.stringify(updated, null, 2), 'utf-8')
    return updated
  } catch (error) {
    console.error('[BvsPlanningV2] Error updating project metadata:', error)
    throw error
  }
}

/**
 * Get the project directory path for a session
 */
function getProjectDir(session: PlanningSessionV2): string {
  if (session.projectDir) {
    return session.projectDir
  }
  // Fallback to legacy location (for existing sessions)
  return path.join(session.projectPath, BVS_DIR)
}

// ============================================================================
// Tool Definitions
// ============================================================================

const PLANNING_TOOLS = [
  {
    name: 'read_file',
    description: 'Read the contents of a file. Use this to examine source code, configuration files, or any text file.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'Absolute path to the file to read'
        }
      },
      required: ['path']
    }
  },
  {
    name: 'list_files',
    description: 'List files matching a glob pattern. Use this to discover project structure and find relevant files.',
    input_schema: {
      type: 'object' as const,
      properties: {
        pattern: {
          type: 'string',
          description: 'Glob pattern (e.g., "**/*.ts", "src/components/**/*.tsx")'
        },
        cwd: {
          type: 'string',
          description: 'Directory to search from (absolute path)'
        }
      },
      required: ['pattern', 'cwd']
    }
  },
  {
    name: 'search_code',
    description: 'Search for text patterns in files. Use this to find specific code patterns, imports, or usages.',
    input_schema: {
      type: 'object' as const,
      properties: {
        pattern: {
          type: 'string',
          description: 'Text or regex pattern to search for'
        },
        path: {
          type: 'string',
          description: 'Directory to search in (absolute path)'
        },
        filePattern: {
          type: 'string',
          description: 'Optional glob pattern to filter files (e.g., "*.ts")'
        }
      },
      required: ['pattern', 'path']
    }
  },
  {
    name: 'web_search',
    description: 'Search the web for information about best practices, libraries, or implementation approaches.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Search query'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'write_plan',
    description: 'Write the final plan to .bvs/plan.md. Only call this after user approves the plan.',
    input_schema: {
      type: 'object' as const,
      properties: {
        content: {
          type: 'string',
          description: 'Full markdown content for plan.md'
        }
      },
      required: ['content']
    }
  }
]

// ============================================================================
// Tool Implementations
// ============================================================================

async function executeReadFile(filePath: string): Promise<string> {
  try {
    const content = await fs.readFile(filePath, 'utf-8')
    const lines = content.split('\n')
    const lineCount = lines.length
    const charCount = content.length

    // For very large files, truncate more aggressively
    let truncatedContent = content
    if (charCount > 30000) {
      truncatedContent = content.substring(0, 30000) + '\n\n[... truncated, showing first 30k chars of ' + charCount + ' total ...]'
    } else if (charCount > 15000) {
      truncatedContent = content.substring(0, 15000) + '\n\n[... truncated, showing first 15k chars of ' + charCount + ' total ...]'
    }

    // Add metadata header for agent context
    const header = `[FILE: ${path.basename(filePath)} | ${lineCount} lines | ${charCount} chars]\n`

    return header + truncatedContent
  } catch (error) {
    return `Error reading file: ${error instanceof Error ? error.message : 'Unknown error'}`
  }
}

async function executeListFiles(pattern: string, cwd: string): Promise<string> {
  try {
    const files = await glob(pattern, {
      cwd,
      nodir: true,
      ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**']
    })
    if (files.length === 0) {
      return 'No files found matching pattern'
    }
    if (files.length > 100) {
      return files.slice(0, 100).join('\n') + `\n\n[... and ${files.length - 100} more files]`
    }
    return files.join('\n')
  } catch (error) {
    return `Error listing files: ${error instanceof Error ? error.message : 'Unknown error'}`
  }
}

async function executeSearchCode(pattern: string, searchPath: string, filePattern?: string): Promise<string> {
  try {
    // Simple implementation - in production would use ripgrep
    const globPattern = filePattern || '**/*'
    const files = await glob(globPattern, {
      cwd: searchPath,
      nodir: true,
      ignore: ['**/node_modules/**', '**/.git/**']
    })

    const results: string[] = []
    const regex = new RegExp(pattern, 'gi')

    for (const file of files.slice(0, 50)) { // Limit files searched
      try {
        const fullPath = path.join(searchPath, file)
        const content = await fs.readFile(fullPath, 'utf-8')
        const lines = content.split('\n')

        lines.forEach((line, idx) => {
          if (regex.test(line)) {
            results.push(`${file}:${idx + 1}: ${line.trim()}`)
          }
        })
      } catch {
        // Skip files that can't be read
      }
    }

    if (results.length === 0) {
      return 'No matches found'
    }
    if (results.length > 50) {
      return results.slice(0, 50).join('\n') + `\n\n[... and ${results.length - 50} more matches]`
    }
    return results.join('\n')
  } catch (error) {
    return `Error searching: ${error instanceof Error ? error.message : 'Unknown error'}`
  }
}

async function executeWebSearch(query: string): Promise<string> {
  // TODO: Integrate with actual web search API
  // For now, return a placeholder
  return `Web search for "${query}" - Integration pending. Please describe what you're looking for and I'll help based on my training knowledge.`
}

async function executeWritePlan(projectPath: string, content: string): Promise<string> {
  try {
    const bvsDir = path.join(projectPath, BVS_DIR)
    await fs.mkdir(bvsDir, { recursive: true })

    const planPath = path.join(bvsDir, PLAN_FILE)
    await fs.writeFile(planPath, content, 'utf-8')

    return `Plan written successfully to ${planPath}`
  } catch (error) {
    return `Error writing plan: ${error instanceof Error ? error.message : 'Unknown error'}`
  }
}

/**
 * Convert PlannedSection[] from planning agent to BvsExecutionPlan for orchestrator
 */
function convertToExecutionPlan(
  session: PlanningSessionV2,
  plannedSections: PlannedSection[]
): BvsExecutionPlan {
  // Convert PlannedSection to BvsSection
  const sections: BvsSection[] = plannedSections.map(ps => ({
    id: ps.id,
    name: ps.name,
    description: ps.description,
    files: ps.files.map(f => ({
      path: f.path,
      action: f.action,
      status: 'pending' as const,
    })),
    dependencies: ps.dependencies,
    dependents: [], // Will be computed below
    status: 'pending' as const,
    successCriteria: ps.successCriteria.map((sc, idx) => ({
      id: `${ps.id}_sc${idx + 1}`,
      description: sc,
      passed: false,
    })),
    progress: 0,
    retryCount: 0,
    maxRetries: 3,
    commits: [],
  }))

  // Compute dependents (inverse of dependencies)
  for (const section of sections) {
    for (const depId of section.dependencies) {
      const depSection = sections.find(s => s.id === depId)
      if (depSection && !depSection.dependents.includes(section.id)) {
        depSection.dependents.push(section.id)
      }
    }
  }

  // Build dependency graph
  const dependencyGraph: BvsDependencyGraph = buildDependencyGraph(sections)

  // Build parallel groups based on dependency levels
  const parallelGroups: BvsParallelGroup[] = dependencyGraph.levels.map((sectionIds, idx) => ({
    groupId: `group_${idx + 1}`,
    level: idx,
    sections: sectionIds,
    status: 'pending' as const,
  }))

  // Default codebase context (can be enhanced with actual analysis)
  const codebaseContext: BvsCodebaseContext = {
    framework: null,
    language: 'typescript',
    packageManager: 'npm',
    hasTypeScript: true,
    hasTests: false,
    testFramework: null,
    lintCommand: 'npm run lint',
    buildCommand: 'npm run build',
    devCommand: 'npm run dev',
    patterns: [],
    conventions: [],
  }

  // Default parallel config
  const parallelConfig: BvsParallelConfig = {
    maxWorkers: 3,
    enableWorktrees: false,
    mergeStrategy: 'sequential',
    conflictResolution: 'manual',
  }

  // Extract title from first user message or use default
  const firstUserMsg = session.messages.find(m => m.role === 'user')
  const title = firstUserMsg?.content.slice(0, 100) || 'Implementation Plan'

  return {
    id: `plan_${session.id}`,
    inputMode: 'interactive_planning',
    planningMessages: session.messages.map(m => ({
      id: m.id,
      role: m.role,
      content: m.content,
      timestamp: m.timestamp,
    })),
    title,
    description: `Generated from BVS Planning session ${session.id}`,
    totalFeatures: sections.length,
    codebaseContext,
    sections,
    dependencyGraph,
    parallelGroups,
    e2eMapping: {}, // Can be populated if sections specify test URLs
    parallelConfig,
    createdAt: Date.now(),
  }
}

/**
 * Build dependency graph from sections
 */
function buildDependencyGraph(sections: BvsSection[]): BvsDependencyGraph {
  const nodes = sections.map(s => ({
    sectionId: s.id,
    dependencies: s.dependencies,
    dependents: s.dependents,
    level: 0,
  }))

  // Compute levels using topological sort
  const levels: string[][] = []
  const assigned = new Set<string>()

  // Find sections with no dependencies (level 0)
  let currentLevel = sections
    .filter(s => s.dependencies.length === 0)
    .map(s => s.id)

  while (currentLevel.length > 0) {
    levels.push(currentLevel)
    currentLevel.forEach(id => assigned.add(id))

    // Update node levels
    for (const id of currentLevel) {
      const node = nodes.find(n => n.sectionId === id)
      if (node) node.level = levels.length - 1
    }

    // Find next level (sections whose dependencies are all assigned)
    currentLevel = sections
      .filter(s => !assigned.has(s.id))
      .filter(s => s.dependencies.every(d => assigned.has(d)))
      .map(s => s.id)
  }

  // Handle any remaining sections (circular dependencies - shouldn't happen)
  const remaining = sections.filter(s => !assigned.has(s.id)).map(s => s.id)
  if (remaining.length > 0) {
    levels.push(remaining)
  }

  // Compute critical path (longest chain)
  const criticalPath = computeCriticalPath(sections)

  return {
    nodes,
    levels,
    criticalPath,
  }
}

/**
 * Compute critical path (longest dependency chain)
 */
function computeCriticalPath(sections: BvsSection[]): string[] {
  const sectionMap = new Map(sections.map(s => [s.id, s]))
  let longestPath: string[] = []

  function dfs(sectionId: string, path: string[]): void {
    const section = sectionMap.get(sectionId)
    if (!section) return

    const newPath = [...path, sectionId]
    if (newPath.length > longestPath.length) {
      longestPath = newPath
    }

    for (const depId of section.dependents) {
      dfs(depId, newPath)
    }
  }

  // Start from sections with no dependencies
  for (const section of sections) {
    if (section.dependencies.length === 0) {
      dfs(section.id, [])
    }
  }

  return longestPath
}

/**
 * Write execution plan to disk as JSON
 */
async function writeExecutionPlan(projectPath: string, plan: BvsExecutionPlan): Promise<string> {
  try {
    const bvsDir = path.join(projectPath, BVS_DIR)
    await fs.mkdir(bvsDir, { recursive: true })

    const planPath = path.join(bvsDir, PLAN_FILE)
    await fs.writeFile(planPath, JSON.stringify(plan, null, 2), 'utf-8')

    console.log('[BvsPlanningV2] Execution plan written to:', planPath)
    return planPath
  } catch (error) {
    console.error('[BvsPlanningV2] Error writing execution plan:', error)
    throw error
  }
}

// ============================================================================
// System Prompt
// ============================================================================

const PLANNING_SYSTEM_PROMPT = `You are a BVS (Bounded Verified Sections) Planning Agent. Your job is to thoroughly understand what the user wants to build through deep conversation, then create actionable implementation plans.

## CRITICAL: Output Formatting Rules

**YOU MUST NEVER OUTPUT FILE CONTENTS TO THE CHAT.**

When you use tools (read_file, list_files, search_code):
- Process the results INTERNALLY in your thinking
- DO NOT echo or quote the file contents in your response
- DO NOT show code snippets from files you read
- Instead, provide CONCISE SUMMARIES like:
  - "Analyzed prisma/schema.prisma - found 23 models including User, Account, Transaction"
  - "Examined src/services/auth.ts - uses JWT-based authentication with refresh tokens"
  - "Found 15 API routes in src/app/api/ following RESTful patterns"

**Bad (NEVER DO THIS):**
"I read the file and here's what I found:
\`\`\`typescript
export interface User {
  id: string;
  name: string;
  ...50 more lines...
}
\`\`\`"

**Good (ALWAYS DO THIS):**
"Analyzed src/types/user.ts - defines User interface with 12 fields including id, name, email, role, and organization relationships."

This saves tokens and keeps the conversation clean. You have the full file contents in your context for reference - you don't need to repeat them to the user.

## CRITICAL: Deep Discovery Before Planning

You are a thoughtful planning partner, NOT a task executor. For complex projects, you need to understand:
- The full scope and vision
- Technical requirements and constraints
- Integration points and dependencies
- User preferences and priorities
- Edge cases and potential issues

## Your Discovery Process

### Step 1: DEEP Codebase Exploration FIRST (CRITICAL - DO NOT SKIP)
When the user first describes their task:
- Acknowledge what they want at a high level
- IMMEDIATELY do a COMPREHENSIVE exploration using tools:

**For the TARGET project (where code will be added):**

## PRIORITY 1: Check for .schema folder (READ FIRST IF EXISTS!)

Many projects have a \`.schema/\` folder with comprehensive documentation. CHECK FOR THIS FIRST:

\`\`\`
list_files pattern=".schema/**/*"
\`\`\`

If \`.schema/\` exists, read these files IN ORDER:
1. \`read_file .schema/_index.md\` - Architecture overview, tech stack, file structure
2. \`read_file .schema/database/README.md\` - Complete database schema with all tables
3. \`read_file .schema/api/README.md\` - All API endpoints with types
4. \`read_file .schema/flows/README.md\` - Data flows and system diagrams
5. \`read_file .schema/pages/README.md\` - Application pages and features

The .schema folder is a GOLDMINE - it contains everything you need to understand the project!

## PRIORITY 2: If no .schema folder, read these files:

1. **Project Structure & Tech Stack (MANDATORY):**
   - list_files with "**/*" to see full structure
   - read_file on package.json - identify ALL dependencies (React, Next.js, Supabase, Prisma, etc.)
   - read_file on tsconfig.json, next.config.js/ts, vite.config.ts (framework config)
   - read_file on .env.example or .env.local (if exists) - identify services used

2. **Database & Schema Files (MANDATORY):**
   - read_file on prisma/schema.prisma (if Prisma project)
   - read_file on supabase/migrations/*.sql or any SQL migration files
   - read_file on src/lib/supabase.ts or similar DB client setup
   - read_file on any types/database.ts or generated types
   - search_code for "createClient" to find Supabase usage
   - search_code for "PrismaClient" to find Prisma usage

3. **API & Backend Patterns:**
   - read_file on src/app/api/**/route.ts (Next.js API routes)
   - read_file on src/lib/*.ts (utility/service files)
   - search_code for authentication patterns (auth, session, jwt)

4. **Frontend Patterns:**
   - read_file on 2-3 key page components
   - read_file on shared components/hooks
   - Identify state management (zustand, redux, context)

**If user mentions ANOTHER project to integrate/port from:**
- ALSO check for .schema/ folder in that project FIRST
- If no .schema/, explore using the checklist above
- Identify what patterns/code can be reused vs needs adaptation

**After exploring, your summary MUST include:**
- **Database:** Supabase/Prisma/PostgreSQL/SQLite - which one? How many tables/models?
- **Framework:** Next.js 14 App Router? Pages Router? React + Vite?
- **Auth:** Supabase Auth? NextAuth? Clerk? Custom JWT?
- **Key Services:** What external services are used (Supabase, Stripe, Clerk, etc.)?
- **Data Models:** List the main entities/tables with key relationships
- **Relevant Existing Code:** Files that will need modification or can be reused

### Step 2: Ask INFORMED Questions Based on ACTUAL CODE
Only after deep exploration, present questions that:
- Reference SPECIFIC files and patterns you found
- Ask about integration decisions based on real code differences
- Example: "Your ERP uses Prisma with SQLite while the planning project uses X. Should we migrate the planning logic to Prisma or..."
- Questions should be IMPOSSIBLE to ask without having read the code

### Step 3: Progressive Refinement (if needed)
After user answers:
- If you need more code context, explore MORE before asking more questions
- Each question round should be informed by actual code analysis
- Continue until you understand BOTH codebases thoroughly

### Step 4: Present Implementation Options
Only when you have COMPLETE understanding of both codebases, present OPTIONS

### Step 5: Generate Sections & Write Plan
After option selection, generate detailed sections with ACTUAL code patterns

## QUESTION CARDS FORMAT

When you need user input, present questions with selectable options:

---QUESTIONS_START---
[
  {
    "id": "q1",
    "category": "Scope",
    "question": "What level of budget tracking do you need?",
    "options": [
      {"id": "q1_a", "label": "Basic", "description": "Simple income/expense tracking with categories"},
      {"id": "q1_b", "label": "Standard", "description": "Budget periods, variance tracking, basic forecasting"},
      {"id": "q1_c", "label": "Enterprise", "description": "Multiple versions, GL integration, approval workflows, advanced forecasting"}
    ]
  },
  {
    "id": "q2",
    "category": "Data Model",
    "question": "How should budgets relate to your chart of accounts?",
    "options": [
      {"id": "q2_a", "label": "Separate", "description": "Budget categories independent of GL accounts"},
      {"id": "q2_b", "label": "Mapped", "description": "Budget items map to GL accounts for reporting"},
      {"id": "q2_c", "label": "Integrated", "description": "Budgets ARE GL account-based, full double-entry"}
    ]
  }
]
---QUESTIONS_END---

After presenting questions, say something like: "Let me know your preferences on these, and I'll dig deeper into the specific areas."

## DISCOVERY AREAS TO EXPLORE

For complex projects, you should ask about:

**Functional Scope**
- Core features vs nice-to-haves
- User roles and permissions
- Workflow requirements

**Technical Architecture**
- Data model decisions
- Integration patterns
- State management approach

**Business Logic**
- Validation rules
- Calculation methods
- Reporting requirements

**User Experience**
- Navigation structure
- Key user journeys
- Mobile/responsive needs

**Operations**
- Data migration needs
- Rollback/versioning
- Audit requirements

## OPTIONS FORMAT (only after discovery complete)

---OPTIONS_START---
[
  {
    "id": "option_a",
    "name": "Full Enterprise Implementation",
    "description": "Complete budget system with GL integration, versions, approvals",
    "recommended": true,
    "sectionCount": 12,
    "complexity": "high"
  }
]
---OPTIONS_END---

## SECTIONS FORMAT (after option selected)

Each section MUST include DETAILED implementation specifications, not just file names.

---SECTIONS_START---
[
  {
    "id": "S1",
    "name": "Database Schema",
    "description": "Create budget tables with GL account relationships",
    "files": [{"path": "migrations/001_budgets.sql", "action": "create"}],
    "dependencies": [],
    "successCriteria": ["Migration runs successfully", "Foreign keys valid"],
    "implementation": {
      "details": "Detailed implementation notes go here",
      "codePatterns": "Reference existing patterns from the codebase",
      "schema": "For DB sections: include actual DDL or Prisma schema",
      "apiSpec": "For API sections: endpoints, methods, request/response shapes",
      "componentSpec": "For UI sections: props, state, key interactions"
    }
  }
]
---SECTIONS_END---

## CRITICAL: Plan Detail Requirements

Your sections MUST include:
1. **Database sections**: Actual SQL DDL or Prisma schema with column definitions, types, constraints
2. **API sections**: Endpoint paths, HTTP methods, request/response TypeScript interfaces
3. **UI sections**: Component props interface, state shape, key event handlers
4. **Logic sections**: Function signatures, algorithm descriptions, edge cases
5. **Integration sections**: How it connects to existing code, what patterns to follow

Do NOT write generic descriptions like "Create budget tables". Instead write:
- Actual column definitions
- Specific types and constraints
- References to existing patterns in the codebase
- Code examples showing the expected implementation style

## Important Rules

1. ALWAYS explore the codebase FIRST before asking questions
2. Questions should be INFORMED by what you found in the code
3. NEVER jump to OPTIONS without thorough discovery (minimum 2-3 rounds of questions)
4. Present QUESTIONS_START blocks to gather structured input
5. Each answer should unlock more specific questions
6. Only present OPTIONS when you can confidently describe each approach
7. Reference actual files and patterns when discussing options

## Current Project Path
{PROJECT_PATH}
`

// ============================================================================
// Planning Agent Service
// ============================================================================

export class BvsPlanningAgentV2 extends EventEmitter {
  private sessions: Map<string, PlanningSessionV2> = new Map()

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
   * Ensure .bvs directory exists
   */
  private async ensureBvsDir(projectPath: string): Promise<string> {
    const bvsDir = path.join(projectPath, BVS_DIR)
    await fs.mkdir(bvsDir, { recursive: true })
    return bvsDir
  }

  /**
   * Save session to disk (in project directory if available, else legacy location)
   */
  private async saveSession(session: PlanningSessionV2): Promise<void> {
    try {
      const saveDir = session.projectDir || path.join(session.projectPath, BVS_DIR)
      await fs.mkdir(saveDir, { recursive: true })

      const sessionPath = path.join(saveDir, BVS_PROJECT_FILES.PLANNING_SESSION)
      const content = JSON.stringify(session, null, 2)
      console.log('[BvsPlanningV2] Saving to:', sessionPath, 'content length:', content.length)
      await fs.writeFile(sessionPath, content)
      console.log('[BvsPlanningV2] Session saved successfully')
    } catch (error) {
      console.error('[BvsPlanningV2] Failed to save session:', error)
      throw error
    }
  }

  /**
   * Load session from disk - checks project directories first, then legacy location
   */
  private async loadSession(projectPath: string): Promise<PlanningSessionV2 | null> {
    // First, try to find an in-progress project in the projects directory
    const projectsDir = path.join(projectPath, BVS_DIR, BVS_GLOBAL_FILES.PROJECTS_DIR)
    try {
      const projects = await fs.readdir(projectsDir)
      for (const projectId of projects) {
        const projectDir = path.join(projectsDir, projectId)
        const projectJsonPath = path.join(projectDir, BVS_PROJECT_FILES.PROJECT_JSON)
        const sessionPath = path.join(projectDir, BVS_PROJECT_FILES.PLANNING_SESSION)

        try {
          // Check if project is still in planning
          const projectJson = JSON.parse(await fs.readFile(projectJsonPath, 'utf-8')) as BvsProject
          if (projectJson.status === 'planning') {
            // Load and return this session
            const content = await fs.readFile(sessionPath, 'utf-8')
            const session = JSON.parse(content) as PlanningSessionV2
            console.log('[BvsPlanningV2] Resuming project session:', projectId)
            return session
          }
        } catch {
          // Project doesn't have valid files, skip
          continue
        }
      }
    } catch {
      // Projects directory doesn't exist yet
    }

    // Fallback: try legacy location
    try {
      const legacySessionPath = path.join(projectPath, BVS_DIR, 'planning-session.json')
      const content = await fs.readFile(legacySessionPath, 'utf-8')
      return JSON.parse(content) as PlanningSessionV2
    } catch {
      return null
    }
  }

  /**
   * Create or resume a planning session
   */
  async createSession(projectPath: string): Promise<PlanningSessionV2> {
    // Try to load existing session
    const existing = await this.loadSession(projectPath)
    if (existing && existing.phase !== 'complete') {
      console.log('[BvsPlanningV2] Resuming existing session:', existing.id)
      this.sessions.set(existing.id, existing)
      return existing
    }

    // Create new session
    const session: PlanningSessionV2 = {
      id: `bvs-plan-${randomUUID().slice(0, 8)}`,
      projectPath,
      messages: [],
      phase: 'exploring',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    this.sessions.set(session.id, session)
    await this.saveSession(session)

    console.log('[BvsPlanningV2] Created new session:', session.id)
    return session
  }

  /**
   * Get session by ID
   */
  getSession(sessionId: string): PlanningSessionV2 | undefined {
    return this.sessions.get(sessionId)
  }

  /**
   * Process user message through the planning agent
   */
  async processMessage(sessionId: string, userMessage: string): Promise<PlanningMessage> {
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new Error(`Session ${sessionId} not found`)
    }

    console.log('[BvsPlanningV2] Processing message for session:', sessionId, 'current messages:', session.messages.length)

    // On first message, generate project name and create directory
    if (session.messages.length === 0 && !session.projectId) {
      console.log('[BvsPlanningV2] First message - generating project name...')

      const { name, slug, description } = await generateProjectName(userMessage)
      const projectId = generateProjectId(slug)
      const projectDir = await createProjectDirectory(session.projectPath, projectId)

      // Create project metadata
      await createProjectMetadata(
        projectDir,
        session.projectPath,
        projectId,
        name,
        slug,
        description
      )

      // Update session with project info
      session.projectId = projectId
      session.projectName = name
      session.projectSlug = slug
      session.projectDir = projectDir

      console.log('[BvsPlanningV2] Project created:', { projectId, name, projectDir })
    }

    // Add user message
    const userMsg: PlanningMessage = {
      id: `msg-${randomUUID().slice(0, 8)}`,
      role: 'user',
      content: userMessage,
      timestamp: Date.now(),
    }
    session.messages.push(userMsg)
    session.updatedAt = Date.now()

    // Get SDK
    const sdk = await getSDK()

    // Build conversation history for context
    const conversationContext = session.messages
      .map(m => `${m.role}: ${m.content}`)
      .join('\n\n')

    // Build system prompt with project path
    const systemPrompt = PLANNING_SYSTEM_PROMPT.replace('{PROJECT_PATH}', session.projectPath)

    // Build full prompt
    const fullPrompt = `${systemPrompt}

## Conversation So Far
${conversationContext}

## Instructions
${this.getPhaseInstructions(session)}

Respond appropriately for the current phase.`

    // Configure SDK options
    const options: Options = {
      model: SONNET_MODEL,
      maxTurns: MAX_TURNS,
      cwd: session.projectPath,
      includePartialMessages: true,
      permissionMode: 'default',
      tools: PLANNING_TOOLS,
      ...(session.sdkSessionId ? { resume: session.sdkSessionId } : {})
    }

    // Create message generator
    async function* generateMessages(): AsyncGenerator<SDKUserMessage> {
      yield {
        type: 'user' as const,
        message: {
          role: 'user' as const,
          content: fullPrompt
        },
        parent_tool_use_id: null,
        session_id: sessionId
      }
    }

    // Execute query
    const queryResult = sdk.query({
      prompt: generateMessages(),
      options
    })

    // Process streaming response
    let responseContent = ''
    let toolCalls: PlanningMessage['toolCalls'] = []
    let parsedQuestions: PlanningQuestion[] | undefined
    let parsedOptions: PlanningOption[] | undefined
    let parsedSections: PlannedSection[] | undefined

    try {
      for await (const message of queryResult) {
        // Capture SDK session ID
        if (message.type === 'system' && message.subtype === 'init') {
          session.sdkSessionId = message.session_id
        }

        // Handle tool calls
        if (message.type === 'tool_use') {
          const toolName = (message as any).name || 'unknown'
          const toolInput = (message as any).input || {}

          this.sendToRenderer(BVS_PLANNING_CHANNELS.TOOL_START, {
            sessionId,
            tool: toolName,
            input: toolInput
          })

          // Execute tool
          let result: string
          switch (toolName) {
            case 'read_file':
              result = await executeReadFile(toolInput.path)
              break
            case 'list_files':
              result = await executeListFiles(toolInput.pattern, toolInput.cwd)
              break
            case 'search_code':
              result = await executeSearchCode(toolInput.pattern, toolInput.path, toolInput.filePattern)
              break
            case 'web_search':
              result = await executeWebSearch(toolInput.query)
              break
            case 'write_plan':
              result = await executeWritePlan(session.projectPath, toolInput.content)
              session.phase = 'complete'
              this.sendToRenderer(BVS_PLANNING_CHANNELS.PLAN_WRITTEN, {
                sessionId,
                planPath: path.join(session.projectPath, BVS_DIR, PLAN_FILE)
              })
              break
            default:
              result = `Unknown tool: ${toolName}`
          }

          toolCalls.push({ name: toolName, input: toolInput, result })

          this.sendToRenderer(BVS_PLANNING_CHANNELS.TOOL_RESULT, {
            sessionId,
            tool: toolName,
            result: result.substring(0, 500) // Truncate for UI
          })
        }

        // Handle streaming text
        if (message.type === 'stream_event' && (message as any).event) {
          const event = (message as any).event as { type: string; delta?: { text?: string } }

          if (event.type === 'content_block_delta' && event.delta?.text) {
            responseContent += event.delta.text

            this.sendToRenderer(BVS_PLANNING_CHANNELS.RESPONSE_CHUNK, {
              sessionId,
              chunk: event.delta.text,
              fullContent: responseContent
            })
          }
        }

        // Handle final result
        if (message.type === 'result') {
          session.totalCostUsd = (session.totalCostUsd || 0) + ((message as any).total_cost_usd || 0)
        }
      }

      // Parse structured data from response
      parsedQuestions = this.parseQuestions(responseContent)
      parsedOptions = this.parseOptions(responseContent)
      parsedSections = this.parseSections(responseContent)

      // Update phase based on content
      if (parsedQuestions && parsedQuestions.length > 0) {
        // Still in discovery phase - questions presented
        this.sendToRenderer(BVS_PLANNING_CHANNELS.QUESTIONS_READY, {
          sessionId,
          questions: parsedQuestions
        })
      } else if (parsedOptions && parsedOptions.length > 0) {
        session.phase = 'options'
        this.sendToRenderer(BVS_PLANNING_CHANNELS.OPTIONS_READY, {
          sessionId,
          options: parsedOptions
        })
      } else if (parsedSections && parsedSections.length > 0) {
        session.phase = 'approval'
        session.proposedSections = parsedSections
        this.sendToRenderer(BVS_PLANNING_CHANNELS.SECTIONS_READY, {
          sessionId,
          sections: parsedSections
        })
      }

    } catch (error) {
      console.error('[BvsPlanningV2] Error processing message:', error)
      this.sendToRenderer(BVS_PLANNING_CHANNELS.ERROR, {
        sessionId,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      throw error
    }

    // Create response message
    const response: PlanningMessage = {
      id: `msg-${randomUUID().slice(0, 8)}`,
      role: 'assistant',
      content: responseContent,
      timestamp: Date.now(),
      questions: parsedQuestions,
      options: parsedOptions,
      sections: parsedSections,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    }

    session.messages.push(response)
    session.updatedAt = Date.now()
    console.log('[BvsPlanningV2] Saving session with', session.messages.length, 'messages')
    await this.saveSession(session)
    console.log('[BvsPlanningV2] Session saved successfully')

    // Debug: Log what we're sending
    console.log('[BvsPlanningV2] Sending RESPONSE_COMPLETE:', {
      sessionId,
      hasQuestions: !!response.questions,
      questionsCount: response.questions?.length || 0,
      hasOptions: !!response.options,
      hasSections: !!response.sections
    })

    this.sendToRenderer(BVS_PLANNING_CHANNELS.RESPONSE_COMPLETE, {
      sessionId,
      message: response
    })

    return response
  }

  /**
   * Get phase-specific instructions
   */
  private getPhaseInstructions(session: PlanningSessionV2): string {
    const userMessages = session.messages.filter(m => m.role === 'user')
    const messageCount = userMessages.length
    const assistantMessages = session.messages.filter(m => m.role === 'assistant')

    // Check if we've presented questions before
    const hasAskedQuestions = assistantMessages.some(m =>
      m.content.includes('QUESTIONS_START') || m.content.includes('OPTIONS_START')
    )

    // Check if user explicitly asked for options/plan
    const lastUserMsg = userMessages[userMessages.length - 1]?.content.toLowerCase() || ''
    const userWantsToProgress = lastUserMsg.includes('ready') ||
                                lastUserMsg.includes('proceed') ||
                                lastUserMsg.includes('let\'s go') ||
                                lastUserMsg.includes('create the plan') ||
                                lastUserMsg.includes('show me options')

    switch (session.phase) {
      case 'exploring':
        if (messageCount <= 1) {
          // First message - DEEP CODEBASE EXPLORATION REQUIRED
          return `CRITICAL: This is the user's FIRST message. You MUST do DEEP exploration before asking questions.

## STEP 1 - CHECK FOR .schema FOLDER FIRST (PRIORITY!)

FIRST, check if the project has a .schema/ documentation folder:
\`\`\`
list_files pattern=".schema/**/*"
\`\`\`

**IF .schema/ EXISTS - READ THESE FILES (they contain EVERYTHING you need!):**
1. read_file .schema/_index.md - Architecture overview, tech stack, modules
2. read_file .schema/database/README.md - Complete database schema with ALL tables
3. read_file .schema/api/README.md - All API endpoints with request/response types
4. read_file .schema/flows/README.md - Data flows and system diagrams
5. read_file .schema/pages/README.md - All application pages

The .schema folder is a GOLDMINE - read it FIRST before exploring other files!

## STEP 2 - IF NO .schema, READ THESE FILES:

1. **Tech Stack Discovery:**
   - read_file package.json - identify framework, database client
   - read_file tsconfig.json or next.config.js/ts

2. **Database Schema:**
   - read_file prisma/schema.prisma (if Prisma)
   - list_files "supabase/migrations/*.sql" then read migrations
   - search_code "createClient" or "PrismaClient"

3. **API & Services:**
   - list_files "src/app/api/**/*.ts"
   - read_file key API route files

**If user mentions ANOTHER project to integrate from:**
- ALSO check for .schema/ in that project FIRST
- If no .schema/, use the checklist above

## STEP 3 - PROVIDE STRUCTURED SUMMARY (NO CODE OUTPUT!)

**Your summary MUST include:**
- **Tech Stack:** Framework + Database + Auth provider
- **Database:** Provider (Supabase/Prisma) + table count + key tables
- **Auth:** Clerk? Supabase Auth? NextAuth?
- **Key Modules:** Main features/areas of the application
- **Relevant for task:** Which existing code relates to the user's request

## STEP 4 - ASK CODE-INFORMED QUESTIONS

Present QUESTIONS_START with questions that reference what you actually found:
- "Your ERP uses Supabase with Clerk auth and RLS policies. Should the new feature..."
- "I see the workflow_definitions table stores canvas_layout for React Flow. Should we..."

DO NOT ask generic questions - they must be based on actual code/schema analysis.`
        } else if (messageCount <= 3 && !userWantsToProgress) {
          // Early discovery - may need more exploration
          return `The user has answered questions. Now:

1. If you haven't fully explored ALL relevant codebases, USE TOOLS NOW to read more files
2. Acknowledge their choices with SPECIFIC implications for the code
3. If there are more code-informed decisions needed, present another QUESTIONS_START
4. Reference actual files and patterns in your questions

DO NOT present OPTIONS_START yet unless you have COMPLETE understanding.

Example follow-up approach:
- "Based on your choice of X, I looked at [specific file] and found [pattern]. This means..."
- If they mentioned integrations, ask about specific integration patterns
- If they mentioned data, ask about data model preferences`
        } else if (messageCount <= 5 && !userWantsToProgress) {
          // Mid discovery - MUST explore code now
          return `The user has answered your questions. NOW YOU MUST EXPLORE THE CODEBASE.

CRITICAL: Use tools NOW to explore:
1. Use list_files to see project structure
2. Use read_file to examine relevant files
3. Use search_code to find existing patterns related to their request

After exploring, either:
- Present MORE questions (QUESTIONS_START) if you found complexity that needs clarification
- Or present OPTIONS_START if you have full clarity

DO NOT just acknowledge - YOU MUST USE TOOLS to explore the code.`
        } else {
          // Ready to present options (or user explicitly asked)
          return `You have gathered requirements. NOW:

1. If you haven't explored the codebase yet, USE TOOLS NOW:
   - list_files to see structure
   - read_file to examine key files
   - search_code to find relevant patterns

2. After exploring (or if already done), present OPTIONS_START with 2-3 approaches.

Each option should reflect what you learned from both the user's answers AND the codebase.`
        }
      case 'options':
        return `The user is reviewing options. If they selected one, generate DETAILED sections using SECTIONS_START/END.

CRITICAL: Each section MUST include:
- Actual database DDL or Prisma schema (not just "create tables")
- Specific API endpoints with request/response interfaces
- Component specifications with props and state
- References to existing code patterns to follow

If they ask questions, answer conversationally. If they want to go back and discuss more, present additional QUESTIONS_START.`
      case 'planning':
        return `Generate DETAILED sections based on the selected approach.

Each section MUST contain:
1. Specific file contents or code patterns (not generic descriptions)
2. For DB: actual column definitions, types, constraints, foreign keys
3. For API: endpoint paths, HTTP methods, TypeScript interfaces for req/res
4. For UI: component props interface, state shape, key interactions
5. References to existing code patterns from the project

Use the SECTIONS_START/END format. Each section should be 3-5 files max with clear success criteria.`
      case 'approval':
        return `The user is reviewing the proposed sections.

If they approve (say yes, approve, looks good):
1. Use the write_plan tool to create the plan file
2. The plan MUST include all the detailed specifications from the sections
3. Format it as proper markdown with code blocks for schemas, interfaces, etc.

If they want changes:
- Ask what specifically needs to change
- Regenerate affected sections with the requested modifications
- Show them the updated sections for re-approval`
      default:
        return 'Continue the planning conversation naturally. If unclear what to do, ask a clarifying question.'
    }
  }

  /**
   * Parse options from response content
   */
  private parseOptions(content: string): PlanningOption[] | undefined {
    const match = content.match(/---OPTIONS_START---\s*([\s\S]*?)\s*---OPTIONS_END---/)
    if (match) {
      try {
        return JSON.parse(match[1])
      } catch {
        console.warn('[BvsPlanningV2] Failed to parse options JSON')
      }
    }
    return undefined
  }

  /**
   * Parse questions from response content
   */
  private parseQuestions(content: string): PlanningQuestion[] | undefined {
    const match = content.match(/---QUESTIONS_START---\s*([\s\S]*?)\s*---QUESTIONS_END---/)
    if (match) {
      try {
        const jsonStr = match[1].trim()
        console.log('[BvsPlanningV2] Found questions block, parsing...')
        const parsed = JSON.parse(jsonStr)
        console.log('[BvsPlanningV2] Parsed questions:', parsed.length, 'questions')
        return parsed
      } catch (err) {
        console.warn('[BvsPlanningV2] Failed to parse questions JSON:', err)
        console.warn('[BvsPlanningV2] JSON content:', match[1].substring(0, 200))
      }
    } else {
      // Check if there's a questions block that didn't match
      if (content.includes('QUESTIONS_START')) {
        console.warn('[BvsPlanningV2] Found QUESTIONS_START but regex did not match')
      }
    }
    return undefined
  }

  /**
   * Parse sections from response content
   */
  private parseSections(content: string): PlannedSection[] | undefined {
    const match = content.match(/---SECTIONS_START---\s*([\s\S]*?)\s*---SECTIONS_END---/)
    if (match) {
      try {
        return JSON.parse(match[1])
      } catch {
        console.warn('[BvsPlanningV2] Failed to parse sections JSON')
      }
    }
    return undefined
  }

  /**
   * Select an option (user clicked a button)
   */
  async selectOption(sessionId: string, optionId: string): Promise<PlanningMessage> {
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new Error(`Session ${sessionId} not found`)
    }

    session.selectedOption = optionId
    session.phase = 'planning'

    // Find the option name
    const lastMessage = session.messages[session.messages.length - 1]
    const option = lastMessage?.options?.find(o => o.id === optionId)
    const optionName = option?.name || optionId

    return this.processMessage(sessionId, `I'll go with ${optionName}`)
  }

  /**
   * Answer questions (user selected options from question cards)
   */
  async answerQuestions(sessionId: string, answers: Record<string, string>): Promise<PlanningMessage> {
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new Error(`Session ${sessionId} not found`)
    }

    // Find the last message with questions
    const lastMessage = session.messages[session.messages.length - 1]
    const questions = lastMessage?.questions || []

    // Build a natural language response from the selected options
    const answerParts: string[] = []
    for (const question of questions) {
      const selectedAnswer = answers[question.id]
      if (selectedAnswer) {
        // Check if it's a custom answer (format: "custom:user text")
        if (selectedAnswer.startsWith('custom:')) {
          const customText = selectedAnswer.substring(7) // Remove "custom:" prefix
          answerParts.push(`For "${question.category}": ${customText}`)
        } else {
          // Standard option selection
          const selectedOption = question.options.find(o => o.id === selectedAnswer)
          if (selectedOption) {
            answerParts.push(`For "${question.category}": ${selectedOption.label} - ${selectedOption.description}`)
          }
        }
      }
    }

    const answerText = answerParts.length > 0
      ? `Here are my choices:\n${answerParts.join('\n')}`
      : 'I\'ve reviewed the options.'

    return this.processMessage(sessionId, answerText)
  }

  /**
   * Approve the plan (user clicked approve button)
   * Directly writes the plan.json file instead of relying on LLM to call write_plan tool
   */
  async approvePlan(sessionId: string): Promise<PlanningMessage> {
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new Error(`Session ${sessionId} not found`)
    }

    // Get the proposed sections from the session or last message
    let sections = session.proposedSections
    if (!sections || sections.length === 0) {
      // Try to find sections from messages
      for (let i = session.messages.length - 1; i >= 0; i--) {
        if (session.messages[i].sections && session.messages[i].sections!.length > 0) {
          sections = session.messages[i].sections
          break
        }
      }
    }

    if (!sections || sections.length === 0) {
      throw new Error('No sections found to create plan from. Please generate sections first.')
    }

    // Determine the save directory (project directory or legacy)
    const saveDir = session.projectDir || path.join(session.projectPath, BVS_DIR)

    // Convert to BvsExecutionPlan format
    const executionPlan = convertToExecutionPlan(session, sections)
    executionPlan.approvedAt = Date.now()

    // Write the plan to the project directory
    const planPath = path.join(saveDir, BVS_PROJECT_FILES.PLAN_JSON)
    await fs.mkdir(saveDir, { recursive: true })
    await fs.writeFile(planPath, JSON.stringify(executionPlan, null, 2), 'utf-8')
    console.log('[BvsPlanningV2] Execution plan written to:', planPath)

    // Update project metadata if we have a project directory
    if (session.projectDir) {
      await updateProjectMetadata(session.projectDir, {
        status: 'ready',
        planApprovedAt: Date.now(),
        sectionsTotal: sections.length,
      })
      console.log('[BvsPlanningV2] Project status updated to: ready')
    }

    // Update session state
    session.phase = 'complete'
    await this.saveSession(session)

    // Emit plan written event
    this.sendToRenderer(BVS_PLANNING_CHANNELS.PLAN_WRITTEN, {
      sessionId,
      planPath,
      plan: executionPlan,
      projectId: session.projectId,
      projectName: session.projectName,
    })

    // Create confirmation message
    const projectInfo = session.projectName ? `**Project:** ${session.projectName}\n` : ''
    const confirmationMessage: PlanningMessage = {
      id: `msg-${randomUUID().slice(0, 8)}`,
      role: 'assistant',
      content: `✅ **Plan Approved and Saved**

${projectInfo}The execution plan has been written to \`${planPath}\`

**Plan Summary:**
- **Sections:** ${sections.length}
- **Total Files:** ${sections.reduce((sum, s) => sum + s.files.length, 0)}
- **Dependencies:** ${sections.filter(s => s.dependencies.length > 0).length} sections have dependencies

The plan is now ready for execution. You can start the BVS execution process from the Execution view.`,
      timestamp: Date.now(),
    }

    session.messages.push(confirmationMessage)
    await this.saveSession(session)

    return confirmationMessage
  }

  /**
   * Request changes to the plan
   */
  async requestChanges(sessionId: string, feedback: string): Promise<PlanningMessage> {
    return this.processMessage(sessionId, feedback)
  }

  /**
   * Clear session from disk to allow fresh start
   */
  async clearSession(projectPath: string): Promise<void> {
    try {
      const sessionPath = path.join(projectPath, BVS_DIR, 'planning-session.json')
      await fs.unlink(sessionPath)
      console.log('[BvsPlanningV2] Cleared session for:', projectPath)
    } catch (error) {
      // File may not exist, which is fine
      console.log('[BvsPlanningV2] No session file to clear for:', projectPath)
    }
  }

  /**
   * List all BVS projects for a given codebase
   */
  async listProjects(projectPath: string): Promise<BvsProject[]> {
    const projects: BvsProject[] = []
    const projectsDir = path.join(projectPath, BVS_DIR, BVS_GLOBAL_FILES.PROJECTS_DIR)

    try {
      const entries = await fs.readdir(projectsDir, { withFileTypes: true })

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const projectJsonPath = path.join(projectsDir, entry.name, BVS_PROJECT_FILES.PROJECT_JSON)
          try {
            const content = await fs.readFile(projectJsonPath, 'utf-8')
            const project = JSON.parse(content) as BvsProject
            projects.push(project)
          } catch {
            // Invalid project directory, skip
            console.warn('[BvsPlanningV2] Skipping invalid project:', entry.name)
          }
        }
      }

      // Sort by updatedAt descending (most recent first)
      projects.sort((a, b) => b.updatedAt - a.updatedAt)

    } catch {
      // Projects directory doesn't exist yet
      console.log('[BvsPlanningV2] No projects directory found for:', projectPath)
    }

    return projects
  }

  /**
   * Get a specific project by ID
   */
  async getProject(projectPath: string, projectId: string): Promise<BvsProject | null> {
    const projectJsonPath = path.join(
      projectPath,
      BVS_DIR,
      BVS_GLOBAL_FILES.PROJECTS_DIR,
      projectId,
      BVS_PROJECT_FILES.PROJECT_JSON
    )

    try {
      const content = await fs.readFile(projectJsonPath, 'utf-8')
      return JSON.parse(content) as BvsProject
    } catch {
      return null
    }
  }

  /**
   * Update a project's status
   */
  async updateProjectStatus(
    projectPath: string,
    projectId: string,
    status: BvsProjectStatus,
    additionalUpdates?: Partial<BvsProject>
  ): Promise<BvsProject | null> {
    const projectDir = path.join(projectPath, BVS_DIR, BVS_GLOBAL_FILES.PROJECTS_DIR, projectId)

    try {
      return await updateProjectMetadata(projectDir, {
        status,
        ...additionalUpdates,
        ...(status === 'completed' ? { completedAt: Date.now() } : {}),
        ...(status === 'in_progress' && !additionalUpdates?.executionStartedAt
          ? { executionStartedAt: Date.now() }
          : {}),
        ...(status === 'paused' ? { executionPausedAt: Date.now() } : {}),
      })
    } catch (error) {
      console.error('[BvsPlanningV2] Failed to update project status:', error)
      return null
    }
  }

  /**
   * Delete/archive a project
   */
  async deleteProject(projectPath: string, projectId: string, archive = true): Promise<boolean> {
    const projectDir = path.join(projectPath, BVS_DIR, BVS_GLOBAL_FILES.PROJECTS_DIR, projectId)

    try {
      if (archive) {
        // Mark as cancelled rather than deleting
        await updateProjectMetadata(projectDir, { status: 'cancelled' })
      } else {
        // Actually delete
        await fs.rm(projectDir, { recursive: true })
      }
      return true
    } catch (error) {
      console.error('[BvsPlanningV2] Failed to delete project:', error)
      return false
    }
  }

  /**
   * Resume a project by loading its session
   */
  async resumeProject(projectPath: string, projectId: string): Promise<PlanningSessionV2 | null> {
    const projectDir = path.join(projectPath, BVS_DIR, BVS_GLOBAL_FILES.PROJECTS_DIR, projectId)
    const sessionPath = path.join(projectDir, BVS_PROJECT_FILES.PLANNING_SESSION)

    try {
      const content = await fs.readFile(sessionPath, 'utf-8')
      const session = JSON.parse(content) as PlanningSessionV2
      this.sessions.set(session.id, session)
      console.log('[BvsPlanningV2] Resumed project:', projectId, 'session:', session.id)
      return session
    } catch (error) {
      console.error('[BvsPlanningV2] Failed to resume project:', error)
      return null
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

let planningAgentV2: BvsPlanningAgentV2 | null = null

export function getBvsPlanningAgentV2(): BvsPlanningAgentV2 {
  if (!planningAgentV2) {
    planningAgentV2 = new BvsPlanningAgentV2()
  }
  return planningAgentV2
}

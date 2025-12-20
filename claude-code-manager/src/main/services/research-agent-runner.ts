/**
 * Research Agent Runner
 *
 * FEAT-020: Process Agent Integration
 *
 * Manages background research agents that run during discovery chat.
 * These agents analyze user requirements and codebase to help build specifications.
 *
 * Agent Types:
 * - process: Extracts requirements, constraints, and key features from user input
 * - codebase: Analyzes existing codebase patterns, tech stack, conventions
 * - spec-builder: Builds structured specification from conversation
 *
 * Security:
 * - Uses shell: false to prevent command injection
 * - Validates all paths and inputs
 * - Sanitizes output to prevent credential leakage
 */

import { spawn, ChildProcess } from 'child_process'
import { randomBytes } from 'crypto'
import { EventEmitter } from 'events'
import * as fs from 'fs/promises'
import * as path from 'path'
import { platform } from 'os'
import { ConfigStore } from './config-store'

/**
 * MCP servers required for autonomous mode research agents
 * Uses npx for cross-platform compatibility
 */
const AUTONOMOUS_MCP_CONFIG = {
  mcpServers: {
    // Playwright for web research
    playwright: {
      command: 'npx',
      args: ['-y', '@playwright/mcp@latest']
    }
  }
}

/**
 * Ensure project has a clean MCP config for autonomous mode
 * Creates .mcp.json in project root with ONLY the servers needed
 * This overrides user-level MCP config to avoid tool name conflicts
 */
async function ensureProjectMcpConfig(projectPath: string): Promise<string> {
  const mcpConfigPath = path.join(projectPath, '.mcp.json')
  console.log(`[ensureProjectMcpConfig] Checking MCP config at: ${mcpConfigPath}`)

  try {
    const existingContent = await fs.readFile(mcpConfigPath, 'utf-8')
    const existing = JSON.parse(existingContent)
    console.log(`[ensureProjectMcpConfig] Found existing config:`, Object.keys(existing.mcpServers || {}))

    const hasPlaywright = existing.mcpServers?.playwright

    if (hasPlaywright) {
      console.log(`[ensureProjectMcpConfig] Config already has required servers`)
      return mcpConfigPath // Already configured
    }

    const merged = {
      mcpServers: {
        ...existing.mcpServers,
        ...AUTONOMOUS_MCP_CONFIG.mcpServers
      }
    }
    await fs.writeFile(mcpConfigPath, JSON.stringify(merged, null, 2))
    console.log(`[ensureProjectMcpConfig] Merged and wrote config`)
    return mcpConfigPath
  } catch (err) {
    console.log(`[ensureProjectMcpConfig] No existing config, creating new one`)
    await fs.writeFile(mcpConfigPath, JSON.stringify(AUTONOMOUS_MCP_CONFIG, null, 2))
    return mcpConfigPath
  }
}

/**
 * Get spawn options for cross-platform CLI execution
 * On Windows, .cmd files require shell interpretation
 */
function getSpawnConfig(cliPath: string): { command: string; shellOption: boolean } {
  if (platform() === 'win32') {
    // On Windows, use shell: true for .cmd files (npm scripts)
    // This is safe because we pass input via stdin, not command line args
    return { command: cliPath, shellOption: true }
  }
  return { command: cliPath, shellOption: false }
}

/**
 * Validate project path is safe to use
 * Security: Prevents path traversal, validates directory exists
 */
async function validateProjectPath(projectPath: string): Promise<boolean> {
  try {
    // Security: Prevent path traversal attempts
    if (projectPath.includes('..') || projectPath.includes('\0')) {
      return false
    }

    // Security: Prevent shell metacharacters in path
    if (/[;&|`$<>]/.test(projectPath)) {
      return false
    }

    const resolvedPath = path.resolve(projectPath)

    // Security: Get real path to resolve symlinks
    let realPath: string
    try {
      realPath = await fs.realpath(resolvedPath)
    } catch {
      return false
    }

    const stats = await fs.stat(realPath)
    if (!stats.isDirectory()) {
      return false
    }

    // Security: Prevent access to sensitive system directories
    const systemDirs = [
      '/bin', '/sbin', '/usr/bin', '/usr/sbin', '/etc', '/sys', '/proc',
      'C:\\Windows', 'C:\\System32', 'C:\\Program Files'
    ]
    const normalizedPath = realPath.toLowerCase().replace(/\\/g, '/')
    if (systemDirs.some(dir => normalizedPath.startsWith(dir.toLowerCase().replace(/\\/g, '/')))) {
      return false
    }

    return true
  } catch {
    return false
  }
}

/**
 * Create minimal safe environment for child processes
 * Security: Only passes essential variables, not credentials
 */
function createSafeEnv(): NodeJS.ProcessEnv {
  const allowedVars = [
    // System paths
    'PATH', 'HOME', 'USERPROFILE', 'TEMP', 'TMP',
    // Windows app data paths (needed for Claude CLI to find OAuth credentials)
    'APPDATA', 'LOCALAPPDATA',
    // XDG paths (Linux/Mac OAuth credential storage)
    'XDG_CONFIG_HOME', 'XDG_DATA_HOME',
    // Locale
    'LANG', 'LC_ALL', 'SHELL',
    // Claude CLI authentication (API key or OAuth)
    'ANTHROPIC_API_KEY', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX',
    // Node.js
    'NODE_ENV', 'npm_config_prefix',
    // System
    'SystemRoot', 'COMSPEC',
    // Terminal (some CLIs need this)
    'TERM', 'COLORTERM'
  ]
  // NOTE: Not setting CI=true as it may interfere with OAuth auth flow
  const safeEnv: NodeJS.ProcessEnv = {}
  for (const key of allowedVars) {
    if (process.env[key]) {
      safeEnv[key] = process.env[key]
    }
  }
  return safeEnv
}

// Research agent types
export type ResearchAgentType = 'process' | 'codebase' | 'spec-builder' | 'user-journey'

// Agent status
export type AgentStatus = 'idle' | 'running' | 'complete' | 'error'

// Agent result
export interface AgentResult {
  agentType: ResearchAgentType
  status: AgentStatus
  output?: string
  error?: string
  startedAt: number
  completedAt?: number
}

// Agent task configuration
export interface AgentTask {
  id: string
  type: ResearchAgentType
  sessionId: string
  projectPath: string
  input: string
  result?: AgentResult
}

// Heavy Spec Architecture Prompts
// Philosophy: ALL intelligence in planning phase. Execution agents just follow the spec.
// The spec must be so detailed that no decision-making is required during implementation.
// BMAD-Inspired: Document-Project workflow for thorough brownfield analysis.
const AGENT_PROMPTS: Record<ResearchAgentType, string> = {
  'user-journey': `You are a comprehensive codebase analyst performing THOROUGH brownfield analysis.

IMPORTANT: Take up to 2 minutes for complete analysis. This context is CRITICAL for implementation.
Implementation agents are "dumb workers" - they CANNOT make decisions. Everything must be documented NOW.

## PHASE 1: Project Overview (30 seconds)
1. Read package.json/pyproject.toml/Cargo.toml for dependencies and exact versions
2. Identify primary framework: Next.js, Express, Django, FastAPI, etc.
3. Identify database: PostgreSQL, SQLite, MongoDB, Supabase, etc.
4. Identify state management: Redux, Zustand, Context, MobX, etc.
5. Identify styling: Tailwind, styled-components, CSS Modules, etc.

## PHASE 2: Architecture Analysis (45 seconds)
1. Map complete directory structure with purpose of each folder
2. Identify routing pattern (file-based like Next.js, or config-based)
3. Find API layer location (routes/, api/, endpoints/, services/)
4. Locate data layer (models/, schemas/, prisma/, drizzle/, types/)
5. Find component organization (atomic design, feature-based, etc.)

## PHASE 3: Pattern Extraction (45 seconds)
1. Find 3-5 existing features MOST SIMILAR to typical new features
2. Document exact file naming conventions (kebab-case, camelCase, PascalCase)
3. Document function/variable naming patterns
4. Extract error handling patterns (try-catch, Result types, error boundaries)
5. Identify testing patterns (file naming, describe/it structure, mocking)
6. Find import organization patterns (absolute vs relative, grouping)

## OUTPUT FORMAT (JSON)
{
  "overview": {
    "framework": "e.g., Next.js 14.0.4",
    "language": "e.g., TypeScript 5.3",
    "database": "e.g., PostgreSQL via Prisma 5.7",
    "stateManagement": "e.g., Zustand 4.4",
    "styling": "e.g., Tailwind CSS 3.4",
    "runtime": "e.g., Node.js 20 LTS"
  },
  "architecture": {
    "sourceRoot": "e.g., src/",
    "routingPattern": "e.g., app/ directory (Next.js App Router)",
    "apiPattern": "e.g., src/app/api/[route]/route.ts with typed handlers",
    "dataLayer": "e.g., src/lib/db/ with Prisma client singleton",
    "componentStructure": "e.g., src/components/ with ui/, shared/, features/ subdirs",
    "storeLocation": "e.g., src/stores/ with one file per domain"
  },
  "patterns": {
    "componentPattern": "e.g., Functional components with Props interface, no default exports",
    "hookPattern": "e.g., Custom hooks in src/hooks/, use- prefix, return tuples",
    "apiPattern": "e.g., REST with Zod validation, typed req/res, error middleware",
    "errorPattern": "e.g., Custom AppError class, error boundaries for UI, try-catch in API",
    "testPattern": "e.g., Vitest for unit (*.test.ts), Playwright for e2e (tests/e2e/)",
    "importPattern": "e.g., Absolute imports via @/ alias, group: react > external > internal > relative"
  },
  "conventions": {
    "fileNaming": "e.g., kebab-case for files, PascalCase for component files",
    "functionNaming": "e.g., camelCase, verb-first for actions (handleClick, fetchUser)",
    "typeNaming": "e.g., PascalCase, Props suffix for component props, I prefix for interfaces",
    "constantNaming": "e.g., UPPER_SNAKE_CASE for constants",
    "directoryNaming": "e.g., lowercase with hyphens"
  },
  "similarFeatures": [
    {
      "name": "e.g., User Authentication",
      "files": ["src/app/api/auth/route.ts", "src/stores/auth-store.ts", "src/components/auth/LoginForm.tsx"],
      "relevance": "e.g., Shows complete flow: API route -> store -> UI component",
      "copyablePatterns": ["API validation pattern", "Store structure", "Form handling"]
    },
    {
      "name": "e.g., CRUD for Products",
      "files": ["src/app/api/products/route.ts", "src/components/products/ProductList.tsx"],
      "relevance": "e.g., Shows data fetching, list rendering, pagination",
      "copyablePatterns": ["List component pattern", "Pagination hook", "Loading states"]
    }
  ],
  "referenceFiles": {
    "componentTemplate": "e.g., src/components/ui/button.tsx",
    "apiTemplate": "e.g., src/app/api/users/route.ts",
    "storeTemplate": "e.g., src/stores/user-store.ts",
    "hookTemplate": "e.g., src/hooks/use-fetch.ts",
    "testTemplate": "e.g., src/components/__tests__/Button.test.tsx"
  },
  "buildAndDeploy": {
    "devCommand": "e.g., npm run dev",
    "buildCommand": "e.g., npm run build",
    "testCommand": "e.g., npm run test",
    "lintCommand": "e.g., npm run lint",
    "envFiles": ["e.g., .env.local", ".env.development"]
  },
  "summary": "2-3 sentence summary of what this project does and its primary purpose"
}

Be THOROUGH. Implementation agents will blindly follow these patterns.
If you cannot determine something, state "UNKNOWN - needs clarification" rather than guessing.
Output ONLY valid JSON, no markdown or explanation.`,

  process: `You are a HEAVY SPEC requirements analyst. Your job is to extract EXHAUSTIVE requirements.

IMPORTANT: The execution phase will use "dumb worker" agents that cannot make decisions.
Every requirement, constraint, and edge case MUST be captured NOW.

Extract and structure:
1. CORE FEATURES - Break each feature into atomic, testable units
2. TECHNICAL CONSTRAINTS - Language, framework, version requirements
3. INTEGRATION POINTS - Every external system, API, service
4. UX REQUIREMENTS - Every user interaction, error message, state
5. EDGE CASES - What happens when things go wrong?
6. NON-FUNCTIONAL - Performance targets, security requirements, scalability
7. ACCEPTANCE CRITERIA - How do we know each feature is complete?

Output a structured summary in JSON format:
{
  "features": [
    {
      "name": "feature name",
      "description": "detailed description",
      "acceptance_criteria": ["list of criteria"],
      "edge_cases": ["what can go wrong"]
    }
  ],
  "constraints": ["technical constraints with specific versions"],
  "integrations": ["detailed integration requirements"],
  "ux_requirements": ["every user-facing behavior"],
  "non_functional": ["specific, measurable requirements"],
  "dependencies": ["what must exist before implementation"]
}`,

  codebase: `You are a HEAVY SPEC codebase analyst. Your job is to capture EVERYTHING about the existing codebase.

IMPORTANT: The implementation agents are "dumb workers" that MUST match existing patterns exactly.
Every convention, pattern, and style choice MUST be documented NOW.

Analyze and document:
1. PROJECT STRUCTURE - Exact directory layout, file naming conventions
2. TECH STACK - Every framework, library, and tool with versions
3. CODE PATTERNS - How similar features are implemented
4. NAMING CONVENTIONS - Variables, functions, classes, files
5. ERROR HANDLING - How errors are caught, logged, displayed
6. TESTING PATTERNS - How tests are structured, named, organized
7. BUILD/DEPLOY - Build commands, environment variables, configs
8. SIMILAR FEATURES - Find 2-3 existing features most like the new one

Output a structured analysis in JSON format:
{
  "tech_stack": {
    "frontend": ["framework@version", ...],
    "backend": ["framework@version", ...],
    "database": ["type", "orm/driver"],
    "tools": ["build tools", "test runners", "linters"]
  },
  "patterns": {
    "component_structure": "how components are organized",
    "state_management": "how state is handled",
    "api_pattern": "how APIs are structured",
    "error_handling": "how errors are managed"
  },
  "conventions": {
    "naming": {"files": "", "functions": "", "classes": "", "variables": ""},
    "structure": "directory organization rules",
    "imports": "how imports are organized"
  },
  "similar_features": [
    {
      "name": "feature name",
      "files": ["list of relevant files"],
      "why_similar": "explanation"
    }
  ],
  "reference_implementations": ["paths to files that should be used as templates"]
}`,

  'spec-builder': `You are a HEAVY SPEC specification builder. Create an EXHAUSTIVELY DETAILED specification.

CRITICAL: The execution agents are "dumb workers" with NO decision-making ability.
Your spec must answer EVERY question they might have. If it's not in the spec, it won't happen.

The specification MUST include:

## 1. OVERVIEW
- Feature name and purpose
- User story format: "As a [user], I want [action], so that [benefit]"
- Success metrics

## 2. TECHNICAL APPROACH
- Architecture decisions and WHY
- Technology choices with justification
- File structure (exact paths and names)

## 3. IMPLEMENTATION DETAILS
For EACH component/file:
- Exact file path
- Purpose and responsibility
- Dependencies and imports
- Public interface (functions, props, methods)
- Internal implementation notes
- Error handling approach

## 4. DATA MODELS
- Database schema changes (exact SQL/migration)
- TypeScript types (complete definitions)
- API request/response shapes

## 5. API DESIGN
- Endpoints (method, path, params, body, response)
- Authentication/authorization requirements
- Error response format

## 6. USER INTERFACE
- Component hierarchy
- State management approach
- User interactions and feedback
- Loading/error/empty states

## 7. TEST CASES (MINIMUM 200)
List EVERY test case in format:
- TEST-001: [Category] Description of what to test
- Expected behavior
- Edge cases to cover

Categories: Unit, Integration, E2E, Error Handling, Edge Cases, Performance

## 8. IMPLEMENTATION ORDER
Numbered list of exact steps to implement, with dependencies between steps.

Output in markdown format. Be EXHAUSTIVE. Leave NOTHING to interpretation.`
}

/**
 * Sanitize output to prevent credential leakage
 */
function sanitizeOutput(data: string): string {
  let sanitized = data

  const sensitiveKeys = [
    'ANTHROPIC_API_KEY',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'SUPABASE_ACCESS_TOKEN'
  ]

  for (const key of sensitiveKeys) {
    const value = process.env[key]
    if (value && value.length > 8) {
      const escapedValue = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const pattern = new RegExp(escapedValue, 'g')
      sanitized = sanitized.replace(pattern, `${value.substring(0, 4)}...REDACTED`)
    }
  }

  // Redact patterns that look like API keys
  sanitized = sanitized.replace(/sk-ant-[a-zA-Z0-9-]{20,}/g, 'sk-ant-...REDACTED')
  sanitized = sanitized.replace(/sb_[a-zA-Z0-9]{20,}/g, 'sb_...REDACTED')

  return sanitized
}

export class ResearchAgentRunner extends EventEmitter {
  private tasks: Map<string, { task: AgentTask; process: ChildProcess | null }> = new Map()
  private configStore: ConfigStore

  constructor(configStore: ConfigStore) {
    super()
    this.configStore = configStore
  }

  /**
   * Run a research agent
   */
  async runAgent(
    type: ResearchAgentType,
    sessionId: string,
    projectPath: string,
    context: string
  ): Promise<AgentTask> {
    const taskId = this.generateId()

    const task: AgentTask = {
      id: taskId,
      type,
      sessionId,
      projectPath,
      input: context,
      result: {
        agentType: type,
        status: 'running',
        startedAt: Date.now()
      }
    }

    this.tasks.set(taskId, { task, process: null })
    this.emit('status', { sessionId, agentName: type, status: 'running' })

    try {
      // SECURITY: Validate project path to prevent path traversal
      const isValidPath = await validateProjectPath(projectPath)
      if (!isValidPath) {
        throw new Error('Invalid project path')
      }

      // Build the prompt for this agent
      const prompt = this.buildPrompt(type, context, projectPath)

      // Get Claude CLI path and validate
      const claudePath = this.configStore.get('claudeCliPath')
      if (!claudePath || typeof claudePath !== 'string') {
        throw new Error('Claude CLI path not configured')
      }

      // SECURITY: Create minimal safe environment (no credentials)
      const safeEnv = createSafeEnv()

      // For user-journey agent, create a minimal MCP config file
      // For other agents, ensure project has required servers
      let mcpConfigPath: string
      if (type === 'user-journey') {
        // User-journey only needs file system access, no MCP servers
        // Create a temporary minimal config file to avoid shell escaping issues
        const minimalConfig = { mcpServers: {} }
        const tempConfigPath = path.join(projectPath, '.mcp-minimal.json')
        await fs.writeFile(tempConfigPath, JSON.stringify(minimalConfig, null, 2))
        mcpConfigPath = tempConfigPath
        console.log(`[ResearchAgent] Created minimal MCP config at: ${mcpConfigPath}`)
      } else {
        // Other agents may need playwright for web research
        await ensureProjectMcpConfig(projectPath)
        mcpConfigPath = path.join(projectPath, '.mcp.json')
        console.log(`[ResearchAgent] Using project MCP config: ${mcpConfigPath}`)
      }

      // Spawn Claude CLI
      // Using --strict-mcp-config to ONLY use the specified MCP config, ignoring user's MCP servers
      // This fixes "tools: Tool names must be unique" error from tool conflicts
      // SECURITY: Input passed via stdin to prevent command injection
      const { command, shellOption } = getSpawnConfig(claudePath)
      console.log(`[ResearchAgent] Spawning ${type} agent for ${projectPath}`)
      console.log(`[ResearchAgent] Command: ${command} --print --mcp-config=${mcpConfigPath}`)
      console.log(`[ResearchAgent] Shell option: ${shellOption}, CWD: ${projectPath}`)
      console.log(`[ResearchAgent] Prompt being sent:`, prompt.substring(0, 200), '...')
      const proc = spawn(command, [
        '--print',
        `--mcp-config=${mcpConfigPath}`,
        '--strict-mcp-config',
        '-'
      ], {
        cwd: projectPath,
        shell: shellOption,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: safeEnv
      })

      const taskEntry = this.tasks.get(taskId)
      if (taskEntry) {
        taskEntry.process = proc
      }

      // Write prompt to stdin
      if (proc.stdin) {
        proc.stdin.on('error', (err) => {
          console.error(`[ResearchAgent:${type}] stdin error:`, err)
        })
        proc.stdin.write(prompt)
        proc.stdin.end()
        console.log(`[ResearchAgent:${type}] Prompt written to stdin, length:`, prompt.length)
      } else {
        console.error(`[ResearchAgent:${type}] No stdin available on process`)
      }

      let output = ''

      // Handle stdout
      proc.stdout?.on('data', (data: Buffer) => {
        output += data.toString()
      })

      // Handle stderr
      proc.stderr?.on('data', (data: Buffer) => {
        console.error(`[ResearchAgent:${type}] stderr:`, data.toString())
      })

      // Debug: Log when process spawns
      console.log(`[ResearchAgent:${type}] Process spawned with PID:`, proc.pid)

      // Handle completion
      proc.on('close', (code) => {
        console.log(`[ResearchAgent:${type}] Process closed with code:`, code)
        console.log(`[ResearchAgent:${type}] Output length:`, output.length)
        const currentTask = this.tasks.get(taskId)
        if (currentTask?.task.result) {
          const sanitizedOutput = sanitizeOutput(output.trim())

          if (code === 0 && sanitizedOutput) {
            currentTask.task.result.status = 'complete'
            currentTask.task.result.output = sanitizedOutput
          } else {
            currentTask.task.result.status = 'error'
            currentTask.task.result.error = `Agent exited with code ${code}`
          }
          currentTask.task.result.completedAt = Date.now()

          console.log(`[ResearchAgent:${type}] Emitting status: ${currentTask.task.result.status}`)
          this.emit('status', {
            sessionId,
            agentName: type,
            status: currentTask.task.result.status,
            output: currentTask.task.result.output,
            error: currentTask.task.result.error
          })
          console.log(`[ResearchAgent:${type}] Emitting complete event for taskId: ${taskId}`)
          this.emit('complete', { taskId, result: currentTask.task.result })
        }
      })

      // Handle error
      proc.on('error', (error) => {
        console.error(`[ResearchAgent:${type}] Process error:`, error)
        const currentTask = this.tasks.get(taskId)
        if (currentTask?.task.result) {
          currentTask.task.result.status = 'error'
          currentTask.task.result.error = error.message
          currentTask.task.result.completedAt = Date.now()

          this.emit('status', {
            sessionId,
            agentName: type,
            status: 'error',
            error: error.message
          })
        }
      })

      return task
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      task.result = {
        agentType: type,
        status: 'error',
        error: errorMessage,
        startedAt: task.result?.startedAt || Date.now(),
        completedAt: Date.now()
      }

      this.emit('status', {
        sessionId,
        agentName: type,
        status: 'error',
        error: errorMessage
      })

      return task
    }
  }

  /**
   * Cancel a running agent task
   */
  cancelTask(taskId: string): boolean {
    const entry = this.tasks.get(taskId)
    if (entry?.process) {
      entry.process.kill('SIGTERM')
      return true
    }
    return false
  }

  /**
   * Cancel all tasks for a session
   */
  cancelSessionTasks(sessionId: string): void {
    for (const [taskId, entry] of this.tasks) {
      if (entry.task.sessionId === sessionId && entry.process) {
        entry.process.kill('SIGTERM')
      }
    }
  }

  /**
   * Get task result
   */
  getTask(taskId: string): AgentTask | undefined {
    return this.tasks.get(taskId)?.task
  }

  /**
   * Get all tasks for a session
   */
  getSessionTasks(sessionId: string): AgentTask[] {
    const results: AgentTask[] = []
    for (const entry of this.tasks.values()) {
      if (entry.task.sessionId === sessionId) {
        results.push(entry.task)
      }
    }
    return results
  }

  /**
   * Clean up completed tasks
   */
  cleanup(): void {
    for (const [taskId, entry] of this.tasks) {
      if (entry.task.result?.status === 'complete' || entry.task.result?.status === 'error') {
        this.tasks.delete(taskId)
      }
    }
  }

  /**
   * Build prompt for agent
   */
  private buildPrompt(type: ResearchAgentType, context: string, projectPath: string): string {
    const systemPrompt = AGENT_PROMPTS[type]

    switch (type) {
      case 'user-journey':
        return `${systemPrompt}

Project to analyze: ${projectPath}

Quickly analyze this project and output JSON with user flows, entry points, data models, tech stack, patterns, and a brief summary.`

      case 'process':
        return `${systemPrompt}

User's description:
${context}

Analyze the above description and extract structured requirements.`

      case 'codebase':
        return `${systemPrompt}

Project path: ${projectPath}

Analyze the project structure and provide a structured summary of the codebase.`

      case 'spec-builder':
        return `${systemPrompt}

Context from conversation and analysis:
${context}

Build a comprehensive technical specification for the requested feature.`

      default:
        return `${systemPrompt}\n\n${context}`
    }
  }

  /**
   * Generate unique task ID
   */
  private generateId(): string {
    return `agent-${Date.now()}-${randomBytes(4).toString('hex')}`
  }
}

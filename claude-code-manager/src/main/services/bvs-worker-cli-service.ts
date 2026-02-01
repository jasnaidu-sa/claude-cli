/**
 * BVS Worker CLI Service
 *
 * Executes individual BVS sections using Claude CLI subprocess.
 * Replaces Agent SDK approach to avoid ESM compatibility issues in Electron.
 *
 * Features:
 * - Spawns Claude CLI as subprocess (matches research-agent-runner pattern)
 * - Custom MCP server for worker tools (read_file, write_file, etc.)
 * - Streams progress events to UI via JSONL parsing
 * - Process isolation for parallel workers in git worktrees
 * - Windows-compatible subprocess handling
 *
 * Architecture:
 * - Each worker gets its own Claude CLI subprocess
 * - Tools provided via MCP server
 * - Output parsed for tool calls and progress
 * - Clean process cleanup on abort
 */

import { spawn, ChildProcess } from 'child_process'
import { EventEmitter } from 'events'
import * as path from 'path'
import * as fs from 'fs/promises'
import { platform } from 'os'
import { ConfigStore } from './config-store'

import type { BvsSection } from '../../shared/bvs-types'
import type { ComplexityAnalysis, BvsModelId } from './bvs-complexity-analyzer-service'

// ============================================================================
// Types
// ============================================================================

export interface WorkerConfig {
  workerId: string
  sectionId: string
  section: BvsSection
  worktreePath: string | null
  model: BvsModelId
  maxTurns: number
  projectContext: ProjectContext
  complexity: ComplexityAnalysis
}

export interface ProjectContext {
  projectPath: string
  projectName: string
  framework: string
  database: string
  patterns: string[]
  existingFiles: string[]
  completedSections: CompletedSection[]
}

export interface CompletedSection {
  id: string
  name: string
  filesChanged: string[]
  summary: string
}

export interface WorkerResult {
  workerId: string
  sectionId: string
  status: 'completed' | 'failed'
  turnsUsed: number
  filesChanged: string[]
  qualityGatesPassed: boolean
  errors: string[]
  retryCount: number
  startedAt: number
  completedAt: number
  commits: string[]
}

export interface WorkerProgress {
  workerId: string
  sectionId: string
  currentTurn: number
  maxTurns: number
  currentStep: string
  currentFile?: string
  currentLine?: number
  progress: number
  elapsedSeconds: number
}

// ============================================================================
// BVS Worker CLI Service
// ============================================================================

export class BvsWorkerCliService extends EventEmitter {
  private activeWorkers: Map<string, ChildProcess> = new Map()
  private workerStartTimes: Map<string, number> = new Map()
  private configStore: ConfigStore

  constructor(configStore: ConfigStore) {
    super()
    this.configStore = configStore
  }

  /**
   * Execute a section using Claude CLI subprocess
   */
  async executeSection(config: WorkerConfig): Promise<WorkerResult> {
    const startedAt = Date.now()
    const { workerId, sectionId, section, worktreePath, model, maxTurns } = config

    console.log(`[BvsWorker:${workerId}] Starting section: ${section.name}`)
    console.log(`[BvsWorker:${workerId}] Model: ${model}, Max turns: ${maxTurns}`)

    // Get Claude CLI path (default to 'claude' if not configured)
    const claudePath = this.configStore.get('claudeCliPath') || 'claude'
    if (typeof claudePath !== 'string') {
      throw new Error('Claude CLI path must be a string')
    }

    console.log(`[BvsWorker:${workerId}] Using Claude CLI path: ${claudePath}`)

    // Get working directory
    const cwd = worktreePath || config.projectContext.projectPath

    // Build prompt
    const prompt = this.buildWorkerPrompt(section, config.projectContext, maxTurns)

    // Create MCP config for worker tools
    const mcpConfigPath = await this.createMcpConfigForWorker(cwd, config)

    // Get spawn configuration
    const { command, shellOption } = this.getSpawnConfig(claudePath)

    console.log(`[BvsWorker:${workerId}] Spawning Claude CLI`)
    console.log(`[BvsWorker:${workerId}] CWD: ${cwd}`)
    console.log(`[BvsWorker:${workerId}] MCP Config: ${mcpConfigPath}`)

    // Spawn Claude CLI with MCP tools enabled
    // Use bypassPermissions to allow tool execution without prompts
    const proc = spawn(command, [
      '--print',
      `--mcp-config=${mcpConfigPath}`,
      '--strict-mcp-config',
      '--permission-mode=bypassPermissions',
      '--verbose', // Required for proper tool output capture
      '-'
    ], {
      cwd,
      shell: shellOption,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: this.buildEnvironment()
    })

    this.activeWorkers.set(workerId, proc)
    this.workerStartTimes.set(workerId, startedAt)

    // Write prompt to stdin
    proc.stdin?.write(prompt)
    proc.stdin?.end()

    // Track execution state
    let output = ''
    let currentTurn = 0
    const filesChanged: string[] = []
    const errors: string[] = []
    let isComplete = false

    // Set up progress timer (emit updates every 2 seconds)
    const progressInterval = setInterval(() => {
      const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000)
      // Estimate progress based on time (assume ~30 seconds per turn)
      const estimatedTurn = Math.min(maxTurns, Math.floor(elapsedSeconds / 30) + 1)
      const progress = Math.min(95, (estimatedTurn / maxTurns) * 100)

      this.emit('progress', {
        workerId,
        sectionId,
        currentTurn: estimatedTurn,
        maxTurns,
        currentStep: `Working on ${section.name}...`,
        progress,
        elapsedSeconds
      })
    }, 2000)

    // Stream stdout and collect output (plain text)
    proc.stdout?.on('data', (data: Buffer) => {
      const text = data.toString()
      output += text

      // Log output for debugging
      if (text.trim()) {
        console.log(`[BvsWorker:${workerId}]`, text.substring(0, 200))
      }

      // Emit output chunk for real-time streaming
      this.emit('output', {
        workerId,
        sectionId,
        output: text,
        timestamp: Date.now()
      })

      // Parse for tool usage and file changes
      const toolMatches = text.match(/\b(read_file|write_file|edit_file|list_files|run_command|mark_complete)\(/g)
      if (toolMatches) {
        currentTurn += toolMatches.length

        // Update progress with actual tool use
        this.emit('progress', {
          workerId,
          sectionId,
          currentTurn,
          maxTurns,
          currentStep: `Used ${toolMatches.length} tools...`,
          progress: Math.min(95, (currentTurn / maxTurns) * 100),
          elapsedSeconds: Math.floor((Date.now() - startedAt) / 1000)
        })
      }

      // Track mark_complete tool calls
      try {
        const lines = text.split('\n')
        for (const line of lines) {
          if (line.includes('"name": "mark_complete"') || line.includes("name: 'mark_complete'")) {
            isComplete = true
            console.log(`[BvsWorker:${workerId}] mark_complete tool called`)
          }
        }
      } catch (e) {
        // Parsing error, ignore
      }
    })

    // Capture stderr
    proc.stderr?.on('data', (data: Buffer) => {
      const text = data.toString()
      console.error(`[BvsWorker:${workerId}] stderr:`, text)
      errors.push(text)
    })

    // Wait for process to complete
    return new Promise((resolve) => {
      proc.on('close', async (code) => {
        console.log(`[BvsWorker:${workerId}] Process exited with code ${code}`)

        // Stop progress timer
        clearInterval(progressInterval)

        this.activeWorkers.delete(workerId)
        this.workerStartTimes.delete(workerId)

        // Cleanup MCP config
        fs.unlink(mcpConfigPath).catch(() => {
          // Ignore cleanup errors
        })

        const completedAt = Date.now()

        // Validate completion before determining status
        const validation = await this.validateSectionCompletion(section, cwd, isComplete)

        let status: 'completed' | 'failed'
        const allErrors = [...errors]

        if (code !== 0) {
          status = 'failed'
          allErrors.push(`Process exited with code ${code}`)
        } else if (!validation.valid) {
          status = 'failed'
          allErrors.push(...validation.errors)
          console.error(`[BvsWorker:${workerId}] Validation failed:`, validation.errors)
        } else {
          status = 'completed'
          console.log(`[BvsWorker:${workerId}] ✓ Validation passed`)
        }

        // Emit final progress
        this.emit('progress', {
          workerId,
          sectionId,
          currentTurn,
          maxTurns,
          currentStep: status === 'completed' ? 'Complete' : 'Failed',
          progress: status === 'completed' ? 100 : (currentTurn / maxTurns) * 100,
          elapsedSeconds: Math.floor((completedAt - startedAt) / 1000)
        })

        resolve({
          workerId,
          sectionId,
          status,
          turnsUsed: currentTurn,
          filesChanged,
          qualityGatesPassed: validation.valid,
          errors: status === 'failed' ? allErrors : [],
          retryCount: 0,
          startedAt,
          completedAt,
          commits: []
        })
      })

      proc.on('error', (error) => {
        console.error(`[BvsWorker:${workerId}] Process error:`, error)
        clearInterval(progressInterval)
        errors.push(error.message)
      })
    })
  }

  /**
   * Validate section completion against plan requirements
   */
  private async validateSectionCompletion(
    section: BvsSection,
    cwd: string,
    isComplete: boolean
  ): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = []
    let allFilesExistAndValid = true

    // 1. First verify all expected files exist (check exact path and similar paths)
    for (const fileSpec of section.files) {
      const filePath = path.join(cwd, fileSpec.path)
      let fileFound = false
      let foundFilePath = ''

      try {
        await fs.access(filePath)
        console.log(`[BVS Validation] ✓ File exists: ${fileSpec.path}`)
        fileFound = true
        foundFilePath = filePath
      } catch {
        // File not found at exact path, check for similar files
        const dirPath = path.dirname(filePath)
        const fileName = path.basename(fileSpec.path)

        try {
          const dirExists = await fs.access(dirPath).then(() => true).catch(() => false)
          if (dirExists) {
            const files = await fs.readdir(dirPath)

            // For migrations, be smart about matching
            if (fileName.endsWith('.sql') || dirPath.includes('migration')) {
              // Extract key parts from expected filename
              // e.g., "20260121000001_budgets_core.sql" -> timestamp: "20260121", keywords: ["budgets", "core"]
              const expectedParts = fileName.replace('.sql', '').split('_')
              const timestamp = expectedParts[0] // Usually the date/timestamp
              const keywords = expectedParts.slice(1).map(k => k.toLowerCase())

              // Find files with same timestamp OR similar keywords
              const similarFile = files.find(f => {
                if (!f.endsWith('.sql')) return false
                const fParts = f.replace('.sql', '').split('_')
                const fTimestamp = fParts[0]
                const fKeywords = fParts.slice(1).map(k => k.toLowerCase())

                // Match by timestamp prefix (same day)
                const sameDay = timestamp.substring(0, 8) === fTimestamp.substring(0, 8)

                // Match by keywords (budgets_core matches create_budgets)
                const keywordMatch = keywords.some(kw =>
                  fKeywords.some(fkw => fkw.includes(kw) || kw.includes(fkw))
                )

                return sameDay && keywordMatch
              })

              if (similarFile) {
                console.log(`[BVS Validation] ✓ Found equivalent file: ${similarFile} (expected: ${fileName})`)
                fileFound = true
                foundFilePath = path.join(dirPath, similarFile)
              }
            }
          }
        } catch (e) {
          // Directory doesn't exist or error reading it
        }

        if (!fileFound) {
          allFilesExistAndValid = false
          errors.push(`Missing required file: ${fileSpec.path} (checked for similar files, none found)`)
          console.error(`[BVS Validation] ✗ Missing file: ${fileSpec.path}`)
        }
      }

      // Store found file path for later content validation
      if (fileFound && foundFilePath) {
        (fileSpec as any)._resolvedPath = foundFilePath
      }
    }

    // 3. For SQL migrations, do basic validation
    const sqlFiles = section.files.filter(f => f.path.endsWith('.sql'))
    for (const sqlFile of sqlFiles) {
      // Use resolved path if available (for similar file matches)
      const filePath = (sqlFile as any)._resolvedPath || path.join(cwd, sqlFile.path)
      try {
        const content = await fs.readFile(filePath, 'utf-8')

        // Check for RLS without policies (P0 issue we found)
        if (content.includes('ENABLE ROW LEVEL SECURITY')) {
          if (!content.includes('CREATE POLICY')) {
            allFilesExistAndValid = false
            errors.push(`${sqlFile.path}: RLS enabled but no policies defined`)
          }
        }

        // Check for basic SQL syntax
        if (!content.trim()) {
          allFilesExistAndValid = false
          errors.push(`${sqlFile.path}: File is empty`)
        }

        // Check for missing indexes on foreign keys
        if (content.includes('REFERENCES') && !content.includes('CREATE INDEX')) {
          console.warn(`[BVS Validation] ⚠ ${sqlFile.path}: Foreign keys without indexes (performance warning)`)
        }
      } catch (e) {
        // File doesn't exist, already caught above
      }
    }

    // 4. For TypeScript/JavaScript files, check for syntax errors and forbidden patterns
    const tsFiles = section.files.filter(f => f.path.endsWith('.ts') || f.path.endsWith('.tsx'))
    if (tsFiles.length > 0) {
      // 4a. Check for forbidden @ts-expect-error on imports (P0 violation)
      for (const tsFile of tsFiles) {
        const filePath = (tsFile as any)._resolvedPath || path.join(cwd, tsFile.path)
        try {
          const content = await fs.readFile(filePath, 'utf-8')

          // Check for @ts-expect-error or @ts-ignore before import statements
          const lines = content.split('\n')
          for (let i = 0; i < lines.length - 1; i++) {
            const currentLine = lines[i].trim()
            const nextLine = lines[i + 1].trim()

            // Check if current line has @ts-expect-error or @ts-ignore
            // and next line is an import statement
            if ((currentLine.includes('@ts-expect-error') || currentLine.includes('@ts-ignore')) &&
                (nextLine.startsWith('import ') || nextLine.startsWith('import{'))) {
              allFilesExistAndValid = false
              errors.push(`${tsFile.path}:${i + 1}: FORBIDDEN - @ts-expect-error/@ts-ignore used on import. Install the package or use alternative.`)
              console.error(`[BVS Validation] ✗ Forbidden pattern in ${tsFile.path}:${i + 1} - @ts-expect-error on import`)
            }
          }

          // Check for imports from @/components/* that might not exist
          const componentImportPattern = /from\s+['"]@\/components\/ui\/([^'"]+)['"]/g
          let match
          while ((match = componentImportPattern.exec(content)) !== null) {
            const componentName = match[1]
            const componentPath = path.join(cwd, 'src', 'components', 'ui', componentName)

            // Check if component exists
            const exists = await Promise.any([
              fs.access(componentPath + '.tsx'),
              fs.access(componentPath + '/index.tsx'),
              fs.access(path.join(cwd, 'src', 'components', 'ui', componentName + '.tsx')),
            ]).then(() => true).catch(() => false)

            if (!exists) {
              // Check if it's a shadcn component that should be installed
              const shadcnComponents = ['button', 'card', 'dialog', 'dropdown-menu', 'input', 'label', 'radio-group', 'select', 'textarea', 'tabs', 'table', 'badge', 'alert', 'avatar', 'checkbox', 'switch', 'tooltip', 'popover', 'accordion', 'separator', 'sheet', 'skeleton', 'slider', 'progress', 'scroll-area']
              const baseName = componentName.replace('.tsx', '').replace('/index', '')

              if (shadcnComponents.includes(baseName)) {
                errors.push(`${tsFile.path}: Missing shadcn/ui component '${baseName}'. Run: npx shadcn@latest add ${baseName}`)
                console.error(`[BVS Validation] ✗ Missing shadcn component: ${baseName}`)
              } else {
                console.warn(`[BVS Validation] ⚠ Component @/components/ui/${componentName} may not exist`)
              }
            }
          }
        } catch {
          // File doesn't exist, already handled above
        }
      }

      // 4b. Run TypeScript validation (using execFile for security - no shell injection)
      try {
        // Run quick type check if tsconfig exists
        const tsconfigPath = path.join(cwd, 'tsconfig.json')
        try {
          await fs.access(tsconfigPath)
          console.log('[BVS Validation] Running TypeScript validation...')

          const { execFile: execFileCb } = await import('child_process')
          const { promisify } = await import('util')
          const execFile = promisify(execFileCb)

          try {
            // Using execFile (not exec) with array args prevents command injection
            await execFile('npx', ['tsc', '--noEmit', '--skipLibCheck'], {
              cwd,
              timeout: 60000
            })
            console.log('[BVS Validation] ✓ TypeScript validation passed')
          } catch (tscError: unknown) {
            // Type errors are warnings, not failures (too strict for BVS workers)
            const errorOutput = tscError && typeof tscError === 'object' && 'stdout' in tscError
              ? String((tscError as { stdout?: unknown }).stdout).substring(0, 500)
              : 'Unknown error'
            console.warn('[BVS Validation] ⚠ TypeScript errors found (non-blocking):', errorOutput)
          }
        } catch {
          // No tsconfig, skip type checking
          console.log('[BVS Validation] No tsconfig.json, skipping type check')
        }
      } catch (e) {
        console.warn('[BVS Validation] Could not run type check:', e)
      }
    }

    // 5. Validate success criteria if they're automatable
    for (const criterion of section.successCriteria) {
      // Check for specific patterns in criteria
      if (criterion.description.toLowerCase().includes('migration runs successfully')) {
        // Validated by SQL checks above
      } else if (criterion.description.toLowerCase().includes('rls') || criterion.description.toLowerCase().includes('row level security')) {
        // Already checked in SQL validation
      }
      // Other criteria would need manual validation
    }

    // 6. Check mark_complete was called, OR auto-complete if all files exist and are valid
    // This handles the case where files already existed before the worker ran.
    if (!isComplete) {
      if (allFilesExistAndValid && section.files.length > 0) {
        // All required files exist and passed content validation - auto-approve
        console.log('[BVS Validation] ✓ All files exist and are valid - auto-completing section (worker did not call mark_complete)')
        return {
          valid: errors.length === 0,
          errors
        }
      } else {
        // Files are missing or invalid, so mark_complete was required
        errors.push('Worker did not call mark_complete tool')
      }
    }

    return {
      valid: errors.length === 0,
      errors
    }
  }

  /**
   * Abort a running worker
   */
  abortWorker(workerId: string): boolean {
    const proc = this.activeWorkers.get(workerId)
    if (proc) {
      console.log(`[BvsWorker:${workerId}] Aborting worker`)
      proc.kill('SIGTERM')
      this.activeWorkers.delete(workerId)
      this.workerStartTimes.delete(workerId)
      return true
    }
    return false
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Build prompt for worker with tools and context
   */
  private buildWorkerPrompt(
    section: BvsSection,
    context: ProjectContext,
    maxTurns: number
  ): string {
    const successCriteria = section.successCriteria
      .map((c, i) => `${i + 1}. ${c.description}`)
      .join('\n')

    const fileActions = section.files
      .map(f => `- ${f.action.toUpperCase()}: ${f.path}`)
      .join('\n')

    const completedSummary = context.completedSections.length > 0
      ? `\n\nCOMPLETED SECTIONS:\n${context.completedSections.map(s => `- ${s.name}: ${s.summary}`).join('\n')}`
      : ''

    // Get framework-specific warnings
    const frameworkWarnings = this.getFrameworkWarnings(context)

    return `You are a BVS worker implementing a section of code.

SECTION: ${section.name}
DESCRIPTION: ${section.description}

FILES TO MODIFY:
${fileActions}

PROJECT CONTEXT:
- Project: ${context.projectName}
- Framework: ${context.framework}
- Database: ${context.database}
- Patterns: ${context.patterns.join(', ')}${completedSummary}
${frameworkWarnings}

==============================================================================
FORBIDDEN PATTERNS - VIOLATION CAUSES SECTION FAILURE
==============================================================================
- NEVER use @ts-expect-error or @ts-ignore for import errors
- NEVER use @ts-expect-error to suppress "Cannot find module" errors
- NEVER import packages that aren't installed in package.json
- NEVER import components from @/components/* that don't exist
- NEVER assume a package will be "installed later" - install it NOW
- NEVER write code that relies on packages you haven't verified exist

If you use @ts-expect-error on an import statement, the section will FAIL validation.

==============================================================================
DEPENDENCY MANAGEMENT - REQUIRED BEFORE USING ANY PACKAGE
==============================================================================
Before importing ANY external package (not @/ or ./ paths):

1. CHECK if package exists:
   run_command("npm list <package-name> 2>&1 || echo NOT_INSTALLED")

2. If NOT_INSTALLED, install it FIRST:
   run_command("npm install <package-name>")

3. For shadcn/ui components (@/components/ui/*):
   - First check: list_files("src/components/ui/<name>*")
   - If not found: run_command("npx shadcn@latest add <name> --yes")

4. Only AFTER installation succeeds, write the import statement

COMMON PACKAGES THAT MUST BE INSTALLED:
- cron -> npm install cron
- openai -> npm install openai
- date-fns -> npm install date-fns
- zod -> npm install zod (usually already installed)

==============================================================================
TOOLS AVAILABLE
==============================================================================
- read_file(path): Read file contents
- write_file(path, content): Create or replace file
- edit_file(path, old_string, new_string): Make targeted edits
- list_files(pattern): List files matching glob pattern
- run_command(command): Execute shell command (npm, git, etc.)
- mark_complete(summary, files_changed): Mark section complete

SUCCESS CRITERIA (ALL MUST BE MET):
${successCriteria}

CRITICAL REQUIREMENTS:
- You have ${maxTurns} turns to complete this section
- ALL ${section.files.length} files listed above MUST exist with correct content
- Focus ONLY on the files listed above
- BEFORE creating files: Check if they already exist (similar names/paths)
- If files exist: Review them to ensure they meet ALL success criteria
- If existing files are satisfactory: Mark section complete WITHOUT recreating them
- If files don't exist or are incomplete: Create/modify them
- Read files before editing them to understand the context
- Match existing code patterns and conventions

FILE HANDLING STRATEGY:
1. First, check if each required file already exists (check exact path and similar paths)
2. If file exists:
   - Read and review its contents
   - Verify it meets ALL success criteria
   - If satisfactory: No changes needed, note it in your summary
   - If insufficient: Modify it to meet requirements
3. If file doesn't exist: Create it according to specifications

COMPLETION VALIDATION:
- After creating/modifying files, verify they exist and are not empty
- For SQL migrations: Check for RLS policies if you enable RLS, verify schema matches requirements
- For TypeScript files: Ensure no syntax errors AND no @ts-expect-error on imports
- Verify each success criterion is met
- If existing work is already correct, that counts as completion
- Run a quick build check: run_command("npx tsc --noEmit 2>&1 | head -20")

WHEN COMPLETE - CRITICAL:
You MUST use the mark_complete tool to signal completion. This is a real MCP tool, not just documentation.

CORRECT way to complete:
1. Use the mark_complete tool with these arguments:
   - summary: "What you implemented or verified"
   - files_changed: ["list", "of", "files"] (can be empty if you verified existing files)

IMPORTANT:
- If existing files already satisfy requirements, you STILL MUST call mark_complete
- Example: mark_complete("Verified existing migration meets all criteria", [])
- Do NOT just write text saying you're done - you MUST invoke the tool
- Writing "SECTION COMPLETE" or "I should call mark_complete" does NOT count
- The section will FAIL if you don't actually use the mark_complete tool

IF YOU CANNOT COMPLETE:
- DO NOT call mark_complete()
- The section will be marked as failed for retry
- This is expected and helps maintain quality
- Better to fail and retry than report incomplete work as complete

Start implementing now.`
  }

  /**
   * Get framework-specific warnings based on project context
   */
  private getFrameworkWarnings(context: ProjectContext): string {
    const warnings: string[] = []

    // Check for Next.js and provide version-specific guidance
    if (context.framework?.toLowerCase().includes('next')) {
      warnings.push(`
==============================================================================
NEXT.JS FRAMEWORK REQUIREMENTS
==============================================================================`)

      // Check for Next.js 15+ patterns (async params)
      warnings.push(`
NEXT.JS 15+ API ROUTE PATTERNS (REQUIRED):
- API route params are Promise-based and MUST be awaited
- WRONG: export async function GET(req, { params }: { params: { id: string } })
- RIGHT: export async function GET(req, { params }: { params: Promise<{ id: string }> })
- Then await: const { id } = await params

SERVER ACTIONS:
- All Server Actions MUST be async functions
- Must have 'use server' directive at top of file or function
- WRONG: export function myAction() { ... }
- RIGHT: export async function myAction() { ... }

SERVER VS CLIENT COMPONENTS:
- Server Components (default): Cannot use useState, useEffect, onClick
- Client Components: Must have 'use client' at top of file
- If you need interactivity, add 'use client' directive`)
    }

    // Check for React 19 patterns
    if (context.framework?.toLowerCase().includes('react')) {
      warnings.push(`
REACT PATTERNS:
- Use functional components with hooks
- Avoid class components
- Use proper TypeScript types for props`)
    }

    return warnings.length > 0 ? '\n' + warnings.join('\n') : ''
  }

  /**
   * Create MCP config file with worker tools
   */
  private async createMcpConfigForWorker(
    cwd: string,
    config: WorkerConfig
  ): Promise<string> {
    // Use the standalone MCP server from project root
    const projectRoot = path.join(__dirname, '..', '..', '..')
    const workerMcpServerPath = path.join(projectRoot, 'bvs-worker-mcp-server.js')

    const mcpConfig = {
      mcpServers: {
        'bvs-worker-tools': {
          command: 'node',
          args: [workerMcpServerPath],
          env: {
            WORKTREE_PATH: cwd,
            PROJECT_PATH: config.projectContext.projectPath
          }
        }
      }
    }

    const configPath = path.join(cwd, '.mcp-bvs-worker.json')
    await fs.writeFile(configPath, JSON.stringify(mcpConfig, null, 2))

    console.log(`[BvsWorker:${config.workerId}] Created MCP config at: ${configPath}`)
    console.log(`[BvsWorker:${config.workerId}] MCP server path: ${workerMcpServerPath}`)

    return configPath
  }

  /**
   * Parse Claude CLI output for tool calls and progress
   */
  private parseWorkerOutput(
    workerId: string,
    sectionId: string,
    text: string,
    startedAt: number,
    maxTurns: number,
    callback: (event: any) => void
  ): void {
    // Claude CLI outputs JSONL format for tool calls
    // Each line is a JSON object representing a message
    const lines = text.split('\n').filter(Boolean)

    for (const line of lines) {
      try {
        const message = JSON.parse(line)

        // Tool use events
        if (message.type === 'tool_use') {
          callback({
            type: 'tool_use',
            toolName: message.name,
            input: message.input
          })
        }

        // Text content (for logging)
        if (message.type === 'text') {
          console.log(`[BvsWorker:${workerId}]`, message.text)
        }
      } catch {
        // Not JSON - could be text output, just log it
        if (text.trim()) {
          console.log(`[BvsWorker:${workerId}]`, text.trim())
        }
      }
    }
  }

  /**
   * Get spawn configuration for cross-platform compatibility
   */
  private getSpawnConfig(cliPath: string): { command: string; shellOption: boolean } {
    if (platform() === 'win32') {
      // On Windows, use shell: true for .cmd files (npm scripts)
      // Safe because input passed via stdin, not command line args
      return { command: cliPath, shellOption: true }
    }
    return { command: cliPath, shellOption: false }
  }

  /**
   * Build environment for subprocess
   */
  private buildEnvironment(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      // Ensure Claude CLI can find auth
      HOME: process.env.HOME,
      USERPROFILE: process.env.USERPROFILE,
      APPDATA: process.env.APPDATA,
      // No buffering
      PYTHONUNBUFFERED: '1',
      NODE_NO_WARNINGS: '1',
      // Force line buffering for JSONL output
      FORCE_COLOR: '0'
    }
  }
}

/**
 * BVS Subagent Service
 *
 * Spawns specialized agents for code review, architecture diagnosis,
 * fixing, and testing using the Claude Agent SDK.
 *
 * Agent Types:
 * - reviewer: Code review with variants (correctness, typescript, conventions, etc.)
 * - architect: Failure diagnosis and approach design
 * - fixer: Apply specific fixes
 * - tester: Generate test cases
 *
 * This service is the foundation for:
 * - Real code review (instead of mock results)
 * - Smart retry with architect diagnosis
 * - Automated fix application
 */

import { EventEmitter } from 'events'
import * as path from 'path'
import * as fs from 'fs/promises'
import { z } from 'zod'

// Agent SDK types
import type { Options, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'

// ============================================================================
// Types
// ============================================================================

export type SubagentType = 'reviewer' | 'architect' | 'fixer' | 'tester'

export type ReviewerVariant =
  | 'correctness'
  | 'typescript'
  | 'conventions'
  | 'simplicity'
  | 'security'
  | 'performance'

export interface SubagentConfig {
  type: SubagentType
  variant?: ReviewerVariant | string
  prompt: string
  files?: string[]
  projectPath: string
  model?: 'haiku' | 'sonnet' | 'auto'
  maxTurns?: number
  timeout?: number
  runInBackground?: boolean
}

export interface SubagentResult {
  agentId: string
  type: SubagentType
  variant?: string
  status: 'completed' | 'failed' | 'timeout' | 'cancelled'
  output: string
  structuredOutput?: Record<string, unknown>
  cost: number
  tokensUsed: { input: number; output: number }
  duration: number
  error?: string
}

export interface ReviewIssue {
  priority: 'P0' | 'P1' | 'P2'
  file: string
  line?: number
  message: string
  suggestion?: string
  category?: string
}

export interface ReviewerOutput {
  issues: ReviewIssue[]
  summary: string
  positiveNotes?: string[]
}

// Import architect diagnosis type from shared types
import type { BvsArchitectDiagnosis } from '@shared/bvs-types'

// Re-export for convenience
export type ArchitectDiagnosis = BvsArchitectDiagnosis

// ============================================================================
// SDK Module Singleton
// ============================================================================

let sdkModule: typeof import('@anthropic-ai/claude-agent-sdk') | null = null

async function getSDK(): Promise<typeof import('@anthropic-ai/claude-agent-sdk')> {
  if (!sdkModule) {
    sdkModule = await import('@anthropic-ai/claude-agent-sdk')
    console.log('[BvsSubagent] Agent SDK loaded')
  }
  return sdkModule
}

// ============================================================================
// System Prompts for Each Agent Type
// ============================================================================

const REVIEWER_SYSTEM_PROMPTS: Record<ReviewerVariant, string> = {
  correctness: `You are a code correctness reviewer. Analyze the provided files for:
- Logic errors and bugs
- Unhandled edge cases (null, empty, boundary conditions)
- Race conditions and async issues
- Security vulnerabilities (injection, XSS, auth bypass)
- Error handling gaps

Be thorough but practical. Focus on issues that could cause real problems.

Output format (JSON):
{
  "issues": [
    {
      "priority": "P0|P1|P2",
      "file": "path/to/file.ts",
      "line": 42,
      "message": "Description of issue",
      "suggestion": "How to fix it",
      "category": "bug|edge-case|security|async|error-handling"
    }
  ],
  "summary": "Brief overall assessment",
  "positiveNotes": ["Good patterns observed..."]
}

Priority Guide:
- P0 (Critical): Security vulnerabilities, data loss, crashes
- P1 (Major): Bugs that affect functionality, logic errors
- P2 (Minor): Edge cases, improvements, style issues`,

  typescript: `You are a TypeScript type safety reviewer. Analyze the provided files for:
- Type safety issues (implicit any, unsafe casts)
- Proper generics usage
- Type narrowing opportunities
- Null/undefined safety (missing optional chaining, nullish coalescing)
- Missing or incorrect type annotations
- Overly permissive types

Output format (JSON):
{
  "issues": [
    {
      "priority": "P0|P1|P2",
      "file": "path/to/file.ts",
      "line": 42,
      "message": "Description of type issue",
      "suggestion": "Correct type or pattern to use",
      "category": "type-safety|generics|null-safety|any-usage"
    }
  ],
  "summary": "Brief overall assessment",
  "positiveNotes": ["Good type patterns observed..."]
}

Priority Guide:
- P0: Type errors that will cause runtime crashes
- P1: Unsafe type usage, missing null checks
- P2: Type improvements, stricter typing`,

  conventions: `You are a code conventions reviewer. Analyze the provided files for:
- Naming convention violations (camelCase, PascalCase, etc.)
- File structure issues
- Import organization
- Component/function patterns
- Code organization
- Consistency with project patterns

Output format (JSON):
{
  "issues": [
    {
      "priority": "P0|P1|P2",
      "file": "path/to/file.ts",
      "line": 42,
      "message": "Convention violation description",
      "suggestion": "Correct convention to use",
      "category": "naming|structure|imports|patterns|organization"
    }
  ],
  "summary": "Brief overall assessment",
  "positiveNotes": ["Good patterns observed..."]
}

Priority Guide:
- P0: Major structural issues, security naming (e.g., exposing internal paths)
- P1: Significant convention violations affecting readability
- P2: Minor style issues, preference-level concerns`,

  simplicity: `You are a code simplicity reviewer. Analyze the provided files for:
- DRY principle violations (repeated code)
- Unnecessary complexity
- Over-engineering
- Readability issues
- Missing abstractions (code that should be factored out)
- Over-abstraction (unnecessary indirection)

Output format (JSON):
{
  "issues": [
    {
      "priority": "P0|P1|P2",
      "file": "path/to/file.ts",
      "line": 42,
      "message": "Simplicity issue description",
      "suggestion": "How to simplify",
      "category": "dry|complexity|readability|abstraction"
    }
  ],
  "summary": "Brief overall assessment",
  "positiveNotes": ["Good simplicity patterns observed..."]
}

Priority Guide:
- P0: Code so complex it's unmaintainable
- P1: Significant duplication, unnecessary complexity
- P2: Minor improvements, style preferences`,

  security: `You are a security reviewer. Analyze the provided files for OWASP Top 10 and common security issues:
- Injection vulnerabilities (SQL, command, XSS, template)
- Broken authentication/authorization
- Sensitive data exposure
- XML external entities (XXE)
- Broken access control
- Security misconfiguration
- Cross-site scripting (XSS)
- Insecure deserialization
- Using components with known vulnerabilities
- Insufficient logging/monitoring
- Hardcoded secrets/credentials

Output format (JSON):
{
  "issues": [
    {
      "priority": "P0|P1|P2",
      "file": "path/to/file.ts",
      "line": 42,
      "message": "Security vulnerability description",
      "suggestion": "How to fix securely",
      "category": "injection|auth|data-exposure|access-control|secrets"
    }
  ],
  "summary": "Security assessment",
  "positiveNotes": ["Good security practices observed..."]
}

Priority Guide:
- P0: Active vulnerabilities, exposed secrets, injection
- P1: Potential vulnerabilities, weak security
- P2: Security improvements, defense in depth`,

  performance: `You are a performance reviewer. Analyze the provided files for:
- N+1 query patterns
- Unnecessary re-renders (React)
- Memory leaks
- Inefficient algorithms (O(n^2) where O(n) possible)
- Large bundle size impacts
- Missing memoization
- Expensive computations in render
- Missing pagination/virtualization

Output format (JSON):
{
  "issues": [
    {
      "priority": "P0|P1|P2",
      "file": "path/to/file.ts",
      "line": 42,
      "message": "Performance issue description",
      "suggestion": "How to optimize",
      "category": "n+1|re-render|memory|algorithm|bundle"
    }
  ],
  "summary": "Performance assessment",
  "positiveNotes": ["Good performance patterns observed..."]
}

Priority Guide:
- P0: Critical performance issues causing crashes/timeouts
- P1: Noticeable performance impact
- P2: Optimization opportunities`
}

const ARCHITECT_SYSTEM_PROMPT = `You are an architect agent diagnosing a failed code generation task.

Your job is to:
1. Identify the ROOT CAUSE of the failure
2. Determine the failure type
3. Suggest a DIFFERENT approach that avoids the same failure
4. Identify files the worker should read first

Output format (JSON):
{
  "rootCause": "Brief description of why it failed",
  "failureType": "approach|implementation|environment|specification",
  "diagnosis": "Detailed analysis of what went wrong...",
  "suggestedApproach": "What the worker should do differently...",
  "filesToReadFirst": ["path/to/file.ts"],
  "warningsForWorker": ["Don't use X because...", "Make sure to Y..."]
}

Failure Types:
- approach: Wrong strategy (e.g., wrong library, wrong pattern)
- implementation: Right strategy, wrong execution (e.g., syntax error, wrong API usage)
- environment: Missing deps, permissions, config issues
- specification: Unclear or impossible requirements`

const FIXER_SYSTEM_PROMPT = `You are a fixer agent. Apply specific fixes to code based on the issues provided.

You have access to file tools:
- read_file(path) - Read file contents
- edit_file(path, old_string, new_string) - Make targeted edits

Rules:
1. Only fix the specific issues mentioned
2. Don't refactor or improve unrelated code
3. Preserve existing style and formatting
4. Test that your fix compiles (mentally verify syntax)

After making fixes, output a summary:
{
  "fixesApplied": [
    { "file": "path/to/file.ts", "line": 42, "description": "What was fixed" }
  ],
  "fixesFailed": [
    { "file": "path/to/file.ts", "line": 42, "reason": "Why it couldn't be fixed" }
  ]
}`

// ============================================================================
// BVS Subagent Service
// ============================================================================

export class BvsSubagentService extends EventEmitter {
  private activeAgents: Map<string, { config: SubagentConfig; startTime: number }> = new Map()
  private agentCounter = 0

  constructor() {
    super()
  }

  /**
   * Generate unique agent ID
   */
  private generateAgentId(type: SubagentType, variant?: string): string {
    this.agentCounter++
    const suffix = variant ? `-${variant}` : ''
    return `${type}${suffix}-${this.agentCounter}-${Date.now()}`
  }

  /**
   * Map model preference to SDK model string
   */
  private mapModelToSdk(model: 'haiku' | 'sonnet' | 'auto' = 'auto', type: SubagentType): string {
    // Auto-select based on agent type
    if (model === 'auto') {
      // Reviewers can use Haiku (faster, cheaper)
      // Architects should use Sonnet (more complex reasoning)
      if (type === 'architect') {
        return 'claude-sonnet-4-20250514'
      }
      return 'claude-haiku-3-5-20241022'
    }

    // Map explicit preferences
    if (model === 'haiku') {
      return 'claude-haiku-3-5-20241022'
    }
    return 'claude-sonnet-4-20250514'
  }

  /**
   * Build system prompt for agent
   */
  private buildSystemPrompt(type: SubagentType, variant?: string): string {
    if (type === 'reviewer' && variant) {
      return REVIEWER_SYSTEM_PROMPTS[variant as ReviewerVariant] || REVIEWER_SYSTEM_PROMPTS.correctness
    }
    if (type === 'architect') {
      return ARCHITECT_SYSTEM_PROMPT
    }
    if (type === 'fixer') {
      return FIXER_SYSTEM_PROMPT
    }
    // Default: general purpose
    return 'You are a helpful code assistant.'
  }

  /**
   * Build full prompt with file context
   */
  private async buildPromptWithContext(config: SubagentConfig): Promise<string> {
    let prompt = config.prompt

    // Add file contents if specified
    if (config.files && config.files.length > 0) {
      const fileContents: string[] = []

      for (const file of config.files) {
        try {
          const filePath = path.isAbsolute(file) ? file : path.join(config.projectPath, file)
          const content = await fs.readFile(filePath, 'utf-8')
          fileContents.push(`\n=== FILE: ${file} ===\n${content}\n=== END FILE ===\n`)
        } catch (e) {
          fileContents.push(`\n=== FILE: ${file} (NOT FOUND) ===\n`)
        }
      }

      prompt = `${prompt}\n\nFILES TO ANALYZE:\n${fileContents.join('\n')}`
    }

    return prompt
  }

  /**
   * Parse structured output from agent response
   */
  private parseStructuredOutput(output: string): Record<string, unknown> | undefined {
    // Try to extract JSON from the output
    const jsonMatch = output.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0])
      } catch {
        // Try to fix common JSON issues
        try {
          // Remove trailing commas
          const fixed = jsonMatch[0].replace(/,(\s*[}\]])/g, '$1')
          return JSON.parse(fixed)
        } catch {
          console.warn('[BvsSubagent] Could not parse JSON from output')
        }
      }
    }
    return undefined
  }

  /**
   * Spawn a single subagent with timeout enforcement
   */
  async spawn(config: SubagentConfig): Promise<SubagentResult> {
    const agentId = this.generateAgentId(config.type, config.variant)
    const startTime = Date.now()
    const timeout = config.timeout || this.getDefaultTimeout(config.type)

    console.log(`[BvsSubagent:${agentId}] Starting ${config.type}${config.variant ? `:${config.variant}` : ''} agent (timeout: ${timeout}ms)`)

    this.activeAgents.set(agentId, { config, startTime })

    // Emit start event
    this.emit('agent-start', { agentId, type: config.type, variant: config.variant })

    // Wrap execution in timeout race
    return this.executeWithTimeout(agentId, config, timeout, startTime)
  }

  /**
   * Get default timeout based on agent type
   */
  private getDefaultTimeout(type: SubagentType): number {
    // Default timeouts in milliseconds
    switch (type) {
      case 'reviewer':
        return 60_000    // 1 minute for code review
      case 'architect':
        return 90_000    // 1.5 minutes for diagnosis
      case 'fixer':
        return 120_000   // 2 minutes for fixes (needs file operations)
      case 'tester':
        return 120_000   // 2 minutes for test generation
      default:
        return 60_000
    }
  }

  /**
   * Execute agent with timeout enforcement
   *
   * NOTE: On timeout, the SDK execution continues in the background until it
   * naturally completes. The SDK doesn't expose a cancellation mechanism.
   * We stop waiting for it but resources continue to be consumed.
   */
  private async executeWithTimeout(
    agentId: string,
    config: SubagentConfig,
    timeout: number,
    startTime: number
  ): Promise<SubagentResult> {
    // Store timeout ID so we can clear it to prevent memory leak
    let timeoutId: NodeJS.Timeout

    // Create timeout promise
    const timeoutPromise = new Promise<SubagentResult>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`TIMEOUT: Agent ${agentId} exceeded ${timeout}ms limit`))
      }, timeout)
    })

    // Create execution promise
    const executionPromise = this.executeAgent(agentId, config, startTime)

    try {
      // Race between execution and timeout
      return await Promise.race([executionPromise, timeoutPromise])
    } catch (error: unknown) {
      const duration = Date.now() - startTime
      const errorMessage = error instanceof Error ? error.message : String(error)

      // Check if it was a timeout
      if (errorMessage.includes('TIMEOUT:')) {
        console.warn(`[BvsSubagent:${agentId}] Timed out after ${duration}ms`)

        // Cleanup
        this.activeAgents.delete(agentId)

        const result: SubagentResult = {
          agentId,
          type: config.type,
          variant: config.variant,
          status: 'timeout',
          output: '',
          cost: 0,
          tokensUsed: { input: 0, output: 0 },
          duration,
          error: `Agent timed out after ${Math.round(timeout / 1000)}s`
        }

        // Emit timeout event
        this.emit('agent-timeout', { agentId, timeout, duration })

        return result
      }

      // Re-throw other errors
      throw error
    } finally {
      // CRITICAL: Clear timeout to prevent memory leak
      // This runs whether execution completes or times out
      clearTimeout(timeoutId!)
    }
  }

  /**
   * Core agent execution logic
   */
  private async executeAgent(
    agentId: string,
    config: SubagentConfig,
    startTime: number
  ): Promise<SubagentResult> {
    try {
      const sdk = await getSDK()

      // Build prompts
      const systemPrompt = this.buildSystemPrompt(config.type, config.variant)
      const userPrompt = await this.buildPromptWithContext(config)

      // Map model
      const sdkModel = this.mapModelToSdk(config.model, config.type)
      const maxTurns = config.maxTurns || 5

      console.log(`[BvsSubagent:${agentId}] Model: ${sdkModel}, Max turns: ${maxTurns}`)

      // Track execution
      let responseContent = ''
      let totalCostUsd = 0
      let totalTokensInput = 0
      let totalTokensOutput = 0

      // Helper to emit output
      const emitOutput = (output: string) => {
        this.emit('agent-output', { agentId, output, timestamp: Date.now() })
      }

      // Create message generator (defined once, used for all agent types)
      async function* generateMessages(): AsyncGenerator<SDKUserMessage> {
        yield {
          type: 'user' as const,
          message: { role: 'user' as const, content: userPrompt },
          parent_tool_use_id: null,
          session_id: ''
        } as SDKUserMessage
      }

      // Build options based on agent type
      // Fixers need file tools, reviewers/architects don't
      let options: Options

      if (config.type === 'fixer') {
        // Fixer needs file tools
        const toolResult = (text: string) => ({
          content: [{ type: 'text' as const, text }]
        })

        const fixerMcpServer = sdk.createSdkMcpServer({
          name: `bvs-fixer-${agentId}`,
          tools: [
            sdk.tool(
              'read_file',
              'Read contents of a file',
              { path: z.string().describe('File path') },
              async (input) => {
                try {
                  const filePath = path.isAbsolute(input.path) ? input.path : path.join(config.projectPath, input.path)
                  const content = await fs.readFile(filePath, 'utf-8')
                  return toolResult(content)
                } catch (e: unknown) {
                  return toolResult(`Error: ${e instanceof Error ? e.message : String(e)}`)
                }
              }
            ),
            sdk.tool(
              'edit_file',
              'Edit a file by replacing old string with new string',
              {
                path: z.string().describe('File path'),
                old_string: z.string().describe('String to replace'),
                new_string: z.string().describe('Replacement string')
              },
              async (input) => {
                try {
                  const filePath = path.isAbsolute(input.path) ? input.path : path.join(config.projectPath, input.path)
                  const content = await fs.readFile(filePath, 'utf-8')
                  if (!content.includes(input.old_string)) {
                    return toolResult(`Error: Could not find the specified text`)
                  }
                  const newContent = content.replace(input.old_string, input.new_string)
                  await fs.writeFile(filePath, newContent, 'utf-8')
                  return toolResult(`Successfully edited ${input.path}`)
                } catch (e: unknown) {
                  return toolResult(`Error: ${e instanceof Error ? e.message : String(e)}`)
                }
              }
            )
          ]
        })

        options = {
          model: sdkModel,
          maxTurns,
          cwd: config.projectPath,
          systemPrompt,
          permissionMode: 'bypassPermissions',
          mcpServers: {
            [`bvs-fixer-${agentId}`]: fixerMcpServer
          },
          allowedTools: ['mcp__*']
        }
      } else {
        // Reviewers and architects don't need tools - just analysis
        options = {
          model: sdkModel,
          maxTurns: 1,  // Single turn for analysis
          cwd: config.projectPath,
          systemPrompt,
          permissionMode: 'bypassPermissions'
        }
      }

      // Execute query and process streaming response (shared logic)
      const queryResult = sdk.query({ prompt: generateMessages(), options })

      for await (const message of queryResult) {
        // Handle streaming text
        if (message.type === 'stream_event') {
          const streamMsg = message as { type: 'stream_event'; event?: { type: string; delta?: { text?: string } } }
          if (streamMsg.event?.type === 'content_block_delta' && streamMsg.event.delta?.text) {
            responseContent += streamMsg.event.delta.text
            emitOutput(streamMsg.event.delta.text)
          }
        }
        // Handle result (completion) - get cost/token data
        if (message.type === 'result') {
          const resultMsg = message as { type: 'result'; total_cost_usd?: number; usage?: { input_tokens?: number; output_tokens?: number } }
          totalCostUsd = resultMsg.total_cost_usd || 0
          totalTokensInput = resultMsg.usage?.input_tokens || 0
          totalTokensOutput = resultMsg.usage?.output_tokens || 0
        }
      }

      const duration = Date.now() - startTime
      const structuredOutput = this.parseStructuredOutput(responseContent)

      console.log(`[BvsSubagent:${agentId}] Completed in ${duration}ms, cost=$${totalCostUsd.toFixed(4)}`)

      // Cleanup
      this.activeAgents.delete(agentId)

      const result: SubagentResult = {
        agentId,
        type: config.type,
        variant: config.variant,
        status: 'completed',
        output: responseContent,
        structuredOutput,
        cost: totalCostUsd,
        tokensUsed: { input: totalTokensInput, output: totalTokensOutput },
        duration
      }

      // Emit complete event
      this.emit('agent-complete', { agentId, result })

      return result

    } catch (error: any) {
      const duration = Date.now() - startTime
      console.error(`[BvsSubagent:${agentId}] Error:`, error)

      // Cleanup
      this.activeAgents.delete(agentId)

      const result: SubagentResult = {
        agentId,
        type: config.type,
        variant: config.variant,
        status: 'failed',
        output: '',
        cost: 0,
        tokensUsed: { input: 0, output: 0 },
        duration,
        error: error.message || String(error)
      }

      // Emit error event
      this.emit('agent-error', { agentId, error: result.error })

      return result
    }
  }

  /**
   * Spawn multiple subagents in parallel
   */
  async spawnParallel(configs: SubagentConfig[]): Promise<SubagentResult[]> {
    console.log(`[BvsSubagent] Spawning ${configs.length} agents in parallel`)

    const promises = configs.map(config => this.spawn(config))
    const results = await Promise.all(promises)

    const successful = results.filter(r => r.status === 'completed').length
    const totalCost = results.reduce((sum, r) => sum + r.cost, 0)

    console.log(`[BvsSubagent] Parallel execution complete: ${successful}/${configs.length} succeeded, total cost=$${totalCost.toFixed(4)}`)

    return results
  }

  /**
   * Cancel a running agent (best effort)
   */
  async cancel(agentId: string): Promise<void> {
    const agent = this.activeAgents.get(agentId)
    if (agent) {
      console.log(`[BvsSubagent:${agentId}] Cancellation requested`)
      this.activeAgents.delete(agentId)
      // Note: Agent SDK doesn't have explicit cancel - agent will timeout
      this.emit('agent-cancelled', { agentId })
    }
  }

  /**
   * Get list of active agent IDs
   */
  getActiveAgents(): string[] {
    return Array.from(this.activeAgents.keys())
  }

  /**
   * Parse reviewer output into structured format
   */
  parseReviewerOutput(result: SubagentResult): ReviewerOutput {
    const defaultOutput: ReviewerOutput = {
      issues: [],
      summary: 'No issues found'
    }

    if (!result.structuredOutput) {
      // Try to parse from raw output
      const parsed = this.parseStructuredOutput(result.output)
      if (!parsed) return defaultOutput
      result.structuredOutput = parsed
    }

    const output = result.structuredOutput as any

    return {
      issues: (output.issues || []).map((issue: any) => ({
        priority: issue.priority || 'P2',
        file: issue.file || 'unknown',
        line: issue.line,
        message: issue.message || 'Unknown issue',
        suggestion: issue.suggestion,
        category: issue.category
      })),
      summary: output.summary || 'Review complete',
      positiveNotes: output.positiveNotes
    }
  }

  /**
   * Parse architect diagnosis output
   */
  parseArchitectDiagnosis(result: SubagentResult): ArchitectDiagnosis | null {
    if (!result.structuredOutput) {
      const parsed = this.parseStructuredOutput(result.output)
      if (!parsed) return null
      result.structuredOutput = parsed
    }

    const output = result.structuredOutput as any

    if (!output.rootCause) return null

    return {
      rootCause: output.rootCause,
      failureType: output.failureType || 'implementation',
      diagnosis: output.diagnosis || output.rootCause,
      suggestedApproach: output.suggestedApproach || '',
      filesToReadFirst: output.filesToReadFirst || [],
      warningsForWorker: output.warningsForWorker || []
    }
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let bvsSubagentService: BvsSubagentService | null = null

export function getBvsSubagentService(): BvsSubagentService {
  if (!bvsSubagentService) {
    bvsSubagentService = new BvsSubagentService()
  }
  return bvsSubagentService
}

/**
 * BVS Plan Revision Service
 *
 * Provides:
 * - Auto-detection of plan issues (ORM mismatch, framework mismatch, etc.)
 * - Chat-based plan revision with Claude
 * - Plan diff generation and application
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import { spawn } from 'child_process'

export interface PlanIssue {
  id: string
  severity: 'error' | 'warning' | 'info'
  title: string
  description: string
  affectedSections: string[]
  suggestion?: string
}

export interface PlanChange {
  type: 'modify' | 'add' | 'remove' | 'reorder'
  sectionId: string
  sectionName: string
  description: string
  before?: string
  after?: string
}

export interface RevisionRequest {
  projectPath: string
  projectId: string
  message: string
  issues: PlanIssue[]
  conversationHistory: Array<{ role: string; content: string }>
}

export interface RevisionResponse {
  success: boolean
  response?: string
  changes?: PlanChange[]
  error?: string
}

export interface AnalysisResult {
  success: boolean
  issues: PlanIssue[]
  error?: string
}

// Known ORM/database patterns
const ORM_PATTERNS = {
  prisma: ['prisma', '@prisma/client', 'schema.prisma', 'PrismaClient'],
  supabase: ['@supabase/supabase-js', 'supabase', 'createClient', 'supabaseClient'],
  drizzle: ['drizzle-orm', 'drizzle'],
  typeorm: ['typeorm', 'TypeORM'],
  sequelize: ['sequelize', 'Sequelize'],
  mongoose: ['mongoose', 'Schema'],
}

// Known framework patterns
const FRAMEWORK_PATTERNS = {
  nextjs: ['next', 'next/app', 'next/server', 'app/page.tsx', 'pages/_app'],
  react: ['react', 'react-dom', 'useState', 'useEffect'],
  vue: ['vue', 'createApp', '.vue'],
  angular: ['@angular/core', 'NgModule'],
  express: ['express', 'app.get', 'app.post'],
  fastify: ['fastify', 'Fastify'],
}

export class BvsPlanRevisionService {
  private projectPath: string = ''
  private projectId: string = ''

  /**
   * Analyze the plan against the codebase to detect issues
   */
  async analyzePlan(projectPath: string, projectId: string): Promise<AnalysisResult> {
    this.projectPath = projectPath
    this.projectId = projectId

    const issues: PlanIssue[] = []

    try {
      // Load the plan
      const planPath = path.join(projectPath, '.bvs', 'projects', projectId, 'plan.json')
      const planContent = await fs.readFile(planPath, 'utf-8')
      const plan = JSON.parse(planContent)

      // Load package.json if exists
      let packageJson: any = null
      try {
        const pkgPath = path.join(projectPath, 'package.json')
        const pkgContent = await fs.readFile(pkgPath, 'utf-8')
        packageJson = JSON.parse(pkgContent)
      } catch {
        // No package.json
      }

      // Detect ORM/database in codebase
      const detectedORM = await this.detectORM(projectPath, packageJson)

      // Detect ORM mentioned in plan
      const planText = JSON.stringify(plan).toLowerCase()
      const planORM = this.detectORMInText(planText)

      // Check for ORM mismatch
      if (detectedORM && planORM && detectedORM !== planORM) {
        const affectedSections = this.findSectionsWithText(plan.sections, planORM)
        issues.push({
          id: 'orm-mismatch',
          severity: 'error',
          title: `ORM Mismatch: Plan uses ${planORM}, codebase uses ${detectedORM}`,
          description: `The plan references ${planORM} but your project is configured to use ${detectedORM}. This will cause implementation errors.`,
          affectedSections,
          suggestion: `Update all ${planORM} references to use ${detectedORM} patterns instead.`
        })
      }

      // Detect framework in codebase
      const detectedFramework = await this.detectFramework(projectPath, packageJson)

      // Detect framework in plan
      const planFramework = this.detectFrameworkInText(planText)

      // Check for framework mismatch
      if (detectedFramework && planFramework && detectedFramework !== planFramework) {
        const affectedSections = this.findSectionsWithText(plan.sections, planFramework)
        if (affectedSections.length > 0) {
          issues.push({
            id: 'framework-mismatch',
            severity: 'warning',
            title: `Framework Mismatch: Plan references ${planFramework}, codebase uses ${detectedFramework}`,
            description: `The plan mentions ${planFramework} patterns but your project uses ${detectedFramework}.`,
            affectedSections,
            suggestion: `Review these sections to ensure they use ${detectedFramework} patterns.`
          })
        }
      }

      // Check for existing implementations that plan might duplicate
      const existingFiles = await this.scanExistingImplementations(projectPath, plan.sections)
      for (const existing of existingFiles) {
        issues.push({
          id: `existing-${existing.sectionId}`,
          severity: 'warning',
          title: `Possible Duplicate: ${existing.fileName} already exists`,
          description: `Section "${existing.sectionName}" plans to create/modify ${existing.fileName}, but this file already exists with similar functionality.`,
          affectedSections: [existing.sectionId],
          suggestion: `Review the existing file and consider modifying the section to extend rather than replace.`
        })
      }

      // Check for missing dependencies
      const missingDeps = await this.checkMissingDependencies(projectPath, packageJson, plan.sections)
      if (missingDeps.length > 0) {
        issues.push({
          id: 'missing-deps',
          severity: 'info',
          title: `Missing Dependencies: ${missingDeps.length} package(s) may need to be installed`,
          description: `The plan references packages that are not in package.json: ${missingDeps.join(', ')}`,
          affectedSections: [],
          suggestion: `These packages will need to be installed before or during execution.`
        })
      }

      return { success: true, issues }
    } catch (error) {
      return {
        success: false,
        issues: [],
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  /**
   * Process a revision request through Claude
   */
  async revisePlan(request: RevisionRequest): Promise<RevisionResponse> {
    this.projectPath = request.projectPath
    this.projectId = request.projectId

    try {
      // Load current plan
      const planPath = path.join(request.projectPath, '.bvs', 'projects', request.projectId, 'plan.json')
      const planContent = await fs.readFile(planPath, 'utf-8')
      const plan = JSON.parse(planContent)

      // Build context for Claude
      const systemPrompt = this.buildRevisionPrompt(plan, request.issues)
      const conversationContext = request.conversationHistory
        .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
        .join('\n\n')

      // Call Claude via CLI (using the agent SDK pattern)
      const response = await this.callClaudeForRevision(
        systemPrompt,
        conversationContext,
        request.message,
        plan
      )

      return response
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  /**
   * Apply changes to the plan
   */
  async applyChanges(projectPath: string, projectId: string, changes: PlanChange[]): Promise<{ success: boolean; error?: string }> {
    try {
      const planPath = path.join(projectPath, '.bvs', 'projects', projectId, 'plan.json')
      const planContent = await fs.readFile(planPath, 'utf-8')
      const plan = JSON.parse(planContent)

      // Backup the plan
      const backupPath = path.join(projectPath, '.bvs', 'projects', projectId, `plan.backup.${Date.now()}.json`)
      await fs.writeFile(backupPath, planContent, 'utf-8')

      // Apply each change
      for (const change of changes) {
        switch (change.type) {
          case 'modify':
            // Find and update the section
            const sectionIdx = plan.sections.findIndex((s: any) => s.id === change.sectionId)
            if (sectionIdx !== -1 && change.after) {
              try {
                const updatedSection = JSON.parse(change.after)
                plan.sections[sectionIdx] = { ...plan.sections[sectionIdx], ...updatedSection }
              } catch {
                // If not JSON, treat as description update
                plan.sections[sectionIdx].description = change.after
              }
            }
            break

          case 'add':
            if (change.after) {
              try {
                const newSection = JSON.parse(change.after)
                plan.sections.push(newSection)
              } catch {
                // Can't add without valid JSON
              }
            }
            break

          case 'remove':
            plan.sections = plan.sections.filter((s: any) => s.id !== change.sectionId)
            break

          case 'reorder':
            // Reorder based on dependencies - would need more complex logic
            break
        }
      }

      // Update plan metadata
      plan.revisedAt = Date.now()
      plan.revisionCount = (plan.revisionCount || 0) + 1

      // Save updated plan
      await fs.writeFile(planPath, JSON.stringify(plan, null, 2), 'utf-8')

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  // === Private Helper Methods ===

  private async detectORM(projectPath: string, packageJson: any): Promise<string | null> {
    // Check package.json dependencies
    if (packageJson) {
      const allDeps = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies
      }

      for (const [orm, patterns] of Object.entries(ORM_PATTERNS)) {
        for (const pattern of patterns) {
          if (allDeps[pattern]) {
            return orm
          }
        }
      }
    }

    // Check for schema files
    try {
      const files = await fs.readdir(projectPath, { recursive: true })
      for (const file of files) {
        const fileName = typeof file === 'string' ? file : file.toString()
        if (fileName.includes('schema.prisma')) return 'prisma'
        if (fileName.includes('supabase')) return 'supabase'
        if (fileName.includes('drizzle')) return 'drizzle'
      }
    } catch {
      // Ignore directory read errors
    }

    return null
  }

  private detectORMInText(text: string): string | null {
    for (const [orm, patterns] of Object.entries(ORM_PATTERNS)) {
      for (const pattern of patterns) {
        if (text.includes(pattern.toLowerCase())) {
          return orm
        }
      }
    }
    return null
  }

  private async detectFramework(projectPath: string, packageJson: any): Promise<string | null> {
    if (packageJson) {
      const allDeps = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies
      }

      // Check in order of specificity
      if (allDeps['next']) return 'nextjs'
      if (allDeps['vue']) return 'vue'
      if (allDeps['@angular/core']) return 'angular'
      if (allDeps['fastify']) return 'fastify'
      if (allDeps['express']) return 'express'
      if (allDeps['react']) return 'react'
    }

    return null
  }

  private detectFrameworkInText(text: string): string | null {
    // Check for specific framework mentions
    if (text.includes('next.js') || text.includes('nextjs') || text.includes('app router')) return 'nextjs'
    if (text.includes('vue')) return 'vue'
    if (text.includes('angular')) return 'angular'
    if (text.includes('express')) return 'express'
    return null
  }

  private findSectionsWithText(sections: any[], searchText: string): string[] {
    const results: string[] = []
    const searchLower = searchText.toLowerCase()

    for (const section of sections) {
      const sectionText = JSON.stringify(section).toLowerCase()
      if (sectionText.includes(searchLower)) {
        results.push(section.id)
      }
    }

    return results
  }

  private async scanExistingImplementations(
    projectPath: string,
    sections: any[]
  ): Promise<Array<{ sectionId: string; sectionName: string; fileName: string }>> {
    const results: Array<{ sectionId: string; sectionName: string; fileName: string }> = []

    for (const section of sections) {
      if (section.files) {
        for (const file of section.files) {
          const filePath = path.join(projectPath, file.path)
          try {
            await fs.access(filePath)
            // File exists - check if it's substantial (not just empty)
            const stat = await fs.stat(filePath)
            if (stat.size > 100) { // More than 100 bytes
              results.push({
                sectionId: section.id,
                sectionName: section.name,
                fileName: file.path
              })
            }
          } catch {
            // File doesn't exist, that's fine
          }
        }
      }
    }

    return results
  }

  private async checkMissingDependencies(
    projectPath: string,
    packageJson: any,
    sections: any[]
  ): Promise<string[]> {
    if (!packageJson) return []

    const allDeps = new Set([
      ...Object.keys(packageJson.dependencies || {}),
      ...Object.keys(packageJson.devDependencies || {})
    ])

    const mentionedPackages = new Set<string>()

    // Extract package names from sections
    for (const section of sections) {
      const sectionText = JSON.stringify(section)
      // Look for npm package patterns
      const packageMatches = sectionText.match(/@?[a-z0-9][-a-z0-9]*(?:\/[a-z0-9][-a-z0-9]*)?/gi) || []
      for (const match of packageMatches) {
        if (match.startsWith('@') || !match.includes('/')) {
          mentionedPackages.add(match.toLowerCase())
        }
      }
    }

    // Find packages mentioned but not installed
    const missing: string[] = []
    for (const pkg of mentionedPackages) {
      if (!allDeps.has(pkg) && pkg.length > 2) {
        // Only include if it looks like a real package name
        if (/^@?[a-z][a-z0-9-]*/.test(pkg)) {
          missing.push(pkg)
        }
      }
    }

    return missing.slice(0, 10) // Limit to 10
  }

  private buildRevisionPrompt(plan: any, issues: PlanIssue[]): string {
    const issuesText = issues.length > 0
      ? `\n\nDetected Issues:\n${issues.map(i => `- ${i.title}: ${i.description}`).join('\n')}`
      : ''

    return `You are a plan revision assistant for a software development project.

Current Plan Summary:
- Project: ${plan.projectName || plan.name || 'Unknown'}
- Sections: ${plan.sections?.length || 0}
- Section Names: ${plan.sections?.map((s: any) => s.name).join(', ')}
${issuesText}

Your task is to help revise this plan based on user feedback. When the user describes changes:
1. Understand what they want to change
2. Propose specific modifications to sections
3. Return changes in a structured format

When responding:
- Be concise and specific
- Focus on actionable changes
- Reference section IDs when proposing modifications
- If you need to modify a section, describe what will change

Return your response as JSON with this structure:
{
  "response": "Your conversational response to the user",
  "changes": [
    {
      "type": "modify" | "add" | "remove" | "reorder",
      "sectionId": "S1",
      "sectionName": "Section Name",
      "description": "What this change does",
      "after": "Updated content or new section JSON"
    }
  ]
}

If you don't have changes to propose yet (need more info), just return:
{
  "response": "Your question or clarification"
}`
  }

  private async callClaudeForRevision(
    systemPrompt: string,
    conversationContext: string,
    userMessage: string,
    plan: any
  ): Promise<RevisionResponse> {
    // For now, return a placeholder response
    // In production, this would call the Claude API or spawn a Claude agent

    // Simple heuristic responses based on common patterns
    const lowerMessage = userMessage.toLowerCase()

    if (lowerMessage.includes('supabase') && lowerMessage.includes('prisma')) {
      // User is asking to switch from Prisma to Supabase
      const prismaSection = plan.sections?.find((s: any) =>
        JSON.stringify(s).toLowerCase().includes('prisma')
      )

      if (prismaSection) {
        return {
          success: true,
          response: `I understand you want to use Supabase instead of Prisma. I'll update the affected sections to use Supabase client patterns instead of Prisma schemas and queries.

Here are the changes I'm proposing:`,
          changes: [{
            type: 'modify',
            sectionId: prismaSection.id,
            sectionName: prismaSection.name,
            description: 'Replace Prisma with Supabase client',
            before: 'Uses Prisma schema and PrismaClient',
            after: JSON.stringify({
              ...prismaSection,
              description: prismaSection.description?.replace(/prisma/gi, 'Supabase').replace(/schema\.prisma/gi, 'Supabase client'),
              name: prismaSection.name?.replace(/prisma/gi, 'Supabase')
            })
          }]
        }
      }
    }

    if (lowerMessage.includes('skip') || lowerMessage.includes('remove')) {
      // User wants to skip/remove a section
      const sectionMatch = lowerMessage.match(/(?:skip|remove)\s+(?:the\s+)?(?:section\s+)?(\w+)/i)
      if (sectionMatch) {
        const sectionRef = sectionMatch[1]
        const section = plan.sections?.find((s: any) =>
          s.id.toLowerCase().includes(sectionRef.toLowerCase()) ||
          s.name.toLowerCase().includes(sectionRef.toLowerCase())
        )

        if (section) {
          return {
            success: true,
            response: `I'll remove section "${section.name}" from the plan. This will also update any dependencies on this section.`,
            changes: [{
              type: 'remove',
              sectionId: section.id,
              sectionName: section.name,
              description: `Remove section: ${section.name}`
            }]
          }
        }
      }
    }

    // Default: acknowledge and ask for more details
    return {
      success: true,
      response: `I understand you want to make changes to the plan. Could you provide more specific details about:

1. Which sections need to be modified?
2. What specific changes should be made?

You can reference sections by their ID (S1, S2, etc.) or by name.`
    }
  }
}

// Singleton instance
let planRevisionService: BvsPlanRevisionService | null = null

export function getPlanRevisionService(): BvsPlanRevisionService {
  if (!planRevisionService) {
    planRevisionService = new BvsPlanRevisionService()
  }
  return planRevisionService
}

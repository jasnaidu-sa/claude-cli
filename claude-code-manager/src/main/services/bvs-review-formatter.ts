/**
 * BVS Review Formatter
 *
 * Formats code review results from work-reviewer agents into markdown reports.
 * Saves reports to .bvs/reviews/ directory for easy viewing and tracking.
 */

import * as fs from 'fs/promises'
import * as path from 'path'

export interface ReviewIssue {
  severity: string
  file: string
  line?: number
  type: string
  description: string
  current_code?: string
  issue_detail?: string
  recommendation?: string
  confidence?: number
  security_impact?: string
}

export interface ReviewResult {
  category: string
  overall_assessment: string
  summary: string
  issues: ReviewIssue[]
  positive_notes?: string[]
}

/**
 * Format review result as markdown
 */
export function formatReviewAsMarkdown(
  reviewerName: string,
  result: ReviewResult,
  files: string[],
  metadata?: {
    sessionId?: string
    sectionId?: string
    timestamp?: number
  }
): string {
  const timestamp = metadata?.timestamp ? new Date(metadata.timestamp).toISOString() : new Date().toISOString()

  let md = `# ${reviewerName} Review Report

**Generated**: ${timestamp}
**Category**: ${result.category}
**Assessment**: ${result.overall_assessment}

## Summary

${result.summary}

## Files Reviewed

${files.map(f => `- ${f}`).join('\n')}

---

`

  // Group issues by severity
  const p0Issues = result.issues.filter(i => i.severity === 'P0')
  const p1Issues = result.issues.filter(i => i.severity === 'P1')
  const p2Issues = result.issues.filter(i => i.severity === 'P2')

  // P0 Issues (Critical)
  if (p0Issues.length > 0) {
    md += `## 🚨 P0 Issues (Critical) - ${p0Issues.length}\n\n`
    md += 'These issues MUST be fixed immediately as they block progress.\n\n'

    for (let i = 0; i < p0Issues.length; i++) {
      md += formatIssue(p0Issues[i], i + 1)
    }
  }

  // P1 Issues (Major)
  if (p1Issues.length > 0) {
    md += `## ⚠️ P1 Issues (Major) - ${p1Issues.length}\n\n`
    md += 'These issues should be fixed before section completion.\n\n'

    for (let i = 0; i < p1Issues.length; i++) {
      md += formatIssue(p1Issues[i], i + 1)
    }
  }

  // P2 Issues (Minor)
  if (p2Issues.length > 0) {
    md += `## ℹ️ P2 Issues (Minor) - ${p2Issues.length}\n\n`
    md += 'These issues can be addressed later or acknowledged.\n\n'

    for (let i = 0; i < p2Issues.length; i++) {
      md += formatIssue(p2Issues[i], i + 1)
    }
  }

  // No issues found
  if (result.issues.length === 0) {
    md += `## ✅ No Issues Found\n\n`
    md += `The reviewer found no ${result.category} issues in the reviewed files.\n\n`
  }

  // Positive notes
  if (result.positive_notes && result.positive_notes.length > 0) {
    md += `## ✨ Positive Notes\n\n`
    for (const note of result.positive_notes) {
      md += `- ${note}\n`
    }
    md += '\n'
  }

  // Summary statistics
  md += `---

## Statistics

- **Total Issues**: ${result.issues.length}
- **P0 (Critical)**: ${p0Issues.length}
- **P1 (Major)**: ${p1Issues.length}
- **P2 (Minor)**: ${p2Issues.length}
- **Average Confidence**: ${calculateAvgConfidence(result.issues)}%

`

  // Metadata footer
  if (metadata?.sessionId || metadata?.sectionId) {
    md += `## Metadata

`
    if (metadata.sessionId) md += `- **Session ID**: ${metadata.sessionId}\n`
    if (metadata.sectionId) md += `- **Section ID**: ${metadata.sectionId}\n`
    md += `- **Timestamp**: ${timestamp}\n`
  }

  return md
}

/**
 * Format a single issue
 */
function formatIssue(issue: ReviewIssue, index: number): string {
  let md = `### ${index}. ${issue.type.replace(/_/g, ' ').toUpperCase()}\n\n`

  // Location
  md += `**File**: \`${issue.file}\``
  if (issue.line) {
    md += `:${issue.line}`
  }
  md += '\n\n'

  // Description
  md += `**Description**: ${issue.description}\n\n`

  // Current code
  if (issue.current_code) {
    md += `**Current Code**:\n\`\`\`typescript\n${issue.current_code}\n\`\`\`\n\n`
  }

  // Issue detail
  if (issue.issue_detail) {
    md += `**Issue Detail**: ${issue.issue_detail}\n\n`
  }

  // Recommendation
  if (issue.recommendation) {
    md += `**Recommendation**:\n\n${issue.recommendation}\n\n`
  }

  // Confidence and security impact
  const meta: string[] = []
  if (issue.confidence) meta.push(`Confidence: ${issue.confidence}%`)
  if (issue.security_impact && issue.security_impact !== 'n/a') {
    meta.push(`Security Impact: ${issue.security_impact}`)
  }

  if (meta.length > 0) {
    md += `*${meta.join(' | ')}*\n\n`
  }

  md += `---\n\n`

  return md
}

/**
 * Calculate average confidence across all issues
 */
function calculateAvgConfidence(issues: ReviewIssue[]): number {
  if (issues.length === 0) return 0

  const confidences = issues
    .map(i => i.confidence)
    .filter((c): c is number => typeof c === 'number')

  if (confidences.length === 0) return 0

  const sum = confidences.reduce((a, b) => a + b, 0)
  return Math.round(sum / confidences.length)
}

/**
 * Save review markdown to file
 */
export async function saveReviewReport(
  projectPath: string,
  reviewerName: string,
  markdown: string,
  options?: {
    sessionId?: string
    sectionId?: string
    timestamp?: number
  }
): Promise<string> {
  // Create reviews directory structure
  const reviewsDir = path.join(projectPath, '.bvs', 'reviews')
  const timestamp = options?.timestamp || Date.now()
  const dateStr = new Date(timestamp).toISOString().split('T')[0]
  const timeStr = new Date(timestamp).toISOString().split('T')[1].split('.')[0].replace(/:/g, '-')

  // Create session-specific directory
  const sessionDir = options?.sessionId
    ? path.join(reviewsDir, options.sessionId)
    : path.join(reviewsDir, `${dateStr}_${timeStr}`)

  await fs.mkdir(sessionDir, { recursive: true })

  // Determine filename
  const sectionPrefix = options?.sectionId ? `${options.sectionId}_` : ''
  const filename = `${sectionPrefix}${reviewerName}.md`
  const filepath = path.join(sessionDir, filename)

  // Write file
  await fs.writeFile(filepath, markdown, 'utf-8')

  return filepath
}

/**
 * Create index file listing all reviews in a session
 */
export async function createReviewIndex(
  projectPath: string,
  sessionId: string,
  reviewFiles: Array<{ reviewer: string; filepath: string; issueCount: number }>
): Promise<void> {
  const reviewsDir = path.join(projectPath, '.bvs', 'reviews', sessionId)
  const indexPath = path.join(reviewsDir, 'README.md')

  let md = `# Code Review Session: ${sessionId}

**Generated**: ${new Date().toISOString()}

## Review Summary

| Reviewer | Issues Found | Report File |
|----------|-------------|-------------|
`

  for (const review of reviewFiles) {
    const filename = path.basename(review.filepath)
    md += `| ${review.reviewer} | ${review.issueCount} | [${filename}](./${filename}) |\n`
  }

  md += `
## Quick Links

`

  for (const review of reviewFiles) {
    const filename = path.basename(review.filepath)
    md += `- [${review.reviewer} Review](./${filename})\n`
  }

  await fs.writeFile(indexPath, md, 'utf-8')
}

/**
 * Parse JSON review result from agent output
 */
export function parseReviewJSON(output: string): ReviewResult | null {
  try {
    // Try to find JSON block in output
    const jsonMatch = output.match(/```json\s*([\s\S]*?)\s*```/)
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1])
    }

    // Try parsing the whole output as JSON
    return JSON.parse(output)
  } catch (error) {
    console.error('[ReviewFormatter] Failed to parse review JSON:', error)
    return null
  }
}

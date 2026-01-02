/**
 * Spec Validation Utilities
 *
 * Validates specification documents for completeness and required sections.
 */

// Required sections for a valid spec (flexible pattern matching)
const SECTION_PATTERNS: Record<string, RegExp> = {
  'Overview': /overview|introduction|summary|description/i,
  'Features/Requirements': /features?|requirements?|functional|capabilities/i,
  'Technical': /technical|architecture|implementation|design|approach/i,
  'Testing': /test(s|ing)?|verification|quality|qa/i
}

export interface SpecValidationResult {
  isValid: boolean
  score: number // 0-100
  sections: {
    name: string
    pattern: string
    present: boolean
    matchedHeader?: string
  }[]
  featureCount: number
  missingCritical: string[]
  suggestions: string[]
  estimatedComplexity: 'simple' | 'standard' | 'complex'
}

/**
 * Validate a specification document
 */
export function validateSpecDocument(markdown: string): SpecValidationResult {
  // Extract all headers (H1-H3) from the markdown
  const headers: { level: number; text: string }[] = []
  const headerMatches = markdown.matchAll(/^(#{1,3})\s+(.+)$/gim)
  for (const match of headerMatches) {
    headers.push({
      level: match[1].length,
      text: match[2].trim()
    })
  }

  // Check each required section pattern against headers
  const sections = Object.entries(SECTION_PATTERNS).map(([name, pattern]) => {
    const matchedHeader = headers.find(h => pattern.test(h.text))
    return {
      name,
      pattern: pattern.source,
      present: !!matchedHeader,
      matchedHeader: matchedHeader?.text
    }
  })

  // Count features/requirements mentioned
  let featureCount = 0

  // Look for numbered lists (implementation steps, features, etc.)
  const numberedMatches = markdown.match(/^\d+\./gm)
  featureCount += numberedMatches?.length || 0

  // Look for bullet lists
  const bulletMatches = markdown.match(/^[\s]*[-*]\s+/gm)
  featureCount += bulletMatches?.length || 0

  // Identify missing critical sections
  const missingCritical = sections
    .filter(s => !s.present)
    .map(s => s.name)

  // Generate suggestions
  const suggestions: string[] = []

  if (missingCritical.length > 0) {
    suggestions.push(`Add missing sections: ${missingCritical.join(', ')}`)
  }

  if (featureCount < 3) {
    suggestions.push('Spec should list at least 3 features or implementation steps')
  }

  // Check for code examples
  const codeBlockCount = (markdown.match(/```/g) || []).length / 2
  if (codeBlockCount === 0) {
    suggestions.push('Consider adding code examples or file structure diagrams')
  }

  // Check Testing section depth
  const testSection = markdown.match(/##\s+(Test(s|ing)?|Verification|QA)[\s\S]*?(?=##|$)/i)
  if (testSection && testSection[0].length < 100) {
    suggestions.push('Testing section seems incomplete - add specific test cases')
  }

  // Calculate validation score
  let score = 0

  // Sections present (40 points max)
  const sectionsPresent = sections.filter(s => s.present).length
  score += (sectionsPresent / sections.length) * 40

  // Feature count (20 points max)
  score += Math.min(featureCount / 10, 1) * 20

  // Content depth (20 points max)
  const wordCount = markdown.split(/\s+/).length
  score += Math.min(wordCount / 500, 1) * 20

  // Code examples (10 points max)
  score += Math.min(codeBlockCount / 3, 1) * 10

  // Headers structure (10 points max)
  const hasH1 = headers.some(h => h.level === 1)
  const hasH2 = headers.some(h => h.level === 2)
  score += (hasH1 ? 5 : 0) + (hasH2 ? 5 : 0)

  score = Math.round(score)

  // Estimate complexity based on content
  let estimatedComplexity: 'simple' | 'standard' | 'complex' = 'standard'
  if (wordCount < 300 || featureCount < 5) {
    estimatedComplexity = 'simple'
  } else if (wordCount > 1000 || featureCount > 15) {
    estimatedComplexity = 'complex'
  }

  return {
    isValid: missingCritical.length === 0 && featureCount >= 1,
    score,
    sections,
    featureCount,
    missingCritical,
    suggestions,
    estimatedComplexity
  }
}

/**
 * Generate missing sections for a spec document
 */
export function generateMissingSections(
  existingSpec: string,
  validation: SpecValidationResult
): string {
  if (validation.missingCritical.length === 0) {
    return existingSpec
  }

  let enhanced = existingSpec

  // Add missing sections at the end
  const missingSectionTemplates: Record<string, string> = {
    'Overview': `

## Overview

[TODO: Add project overview and goals]

**Purpose**: Describe what this feature/project aims to accomplish.

**Scope**: Define what is included and what is out of scope.
`,
    'Features/Requirements': `

## Requirements

### Functional Requirements
1. [TODO: Add functional requirement]
2. [TODO: Add functional requirement]
3. [TODO: Add functional requirement]

### Non-Functional Requirements
- Performance: [TODO: Define performance criteria]
- Security: [TODO: Define security requirements]
- Scalability: [TODO: Define scalability needs]
`,
    'Technical': `

## Technical Architecture

### Components
- [TODO: List key components to create/modify]

### Technology Stack
- [TODO: List technologies and frameworks]

### Integration Points
- [TODO: Describe how this integrates with existing systems]
`,
    'Testing': `

## Testing Strategy

### Unit Tests
- [TODO: Define unit test coverage]
- Test critical business logic
- Aim for >80% code coverage

### Integration Tests
- [TODO: Define integration test scenarios]
- Test API endpoints end-to-end
- Validate data flow between components

### Manual Testing
- [TODO: Create test checklist]
- Verify UI/UX flows
- Test edge cases and error handling
`
  }

  for (const missing of validation.missingCritical) {
    const template = missingSectionTemplates[missing]
    if (template) {
      enhanced += template
    }
  }

  return enhanced
}

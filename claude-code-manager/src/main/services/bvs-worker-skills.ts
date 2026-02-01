/**
 * BVS Worker Skills System
 *
 * Injects mandatory skills into worker prompts to ensure consistent best practices.
 * Skills are context-aware and triggered based on conditions (always, on-error, on-new-file, etc.).
 *
 * Features:
 * - TDD (always): Write tests first
 * - Typecheck (always): Run `npx tsc --noEmit` after changes
 * - Systematic Debug (on-error): Structured debugging for retry attempts
 * - Verification (always): Verify work before claiming completion
 */

import type { BvsSection } from '@shared/bvs-types'

// ============================================================================
// Types
// ============================================================================

export interface WorkerSkill {
  id: string
  trigger: 'always' | 'on-error' | 'on-new-file' | 'on-test'
  instructions: string
  priority: number  // Higher = more important, shown first
}

export interface WorkerContext {
  previousAttemptFailed: boolean
  filesExist: Record<string, boolean>
}

export interface OwnershipMap {
  [sectionId: string]: string[]
}

export interface WorkerConfig {
  model: 'haiku' | 'sonnet'
  maxTurns: number
}

// ============================================================================
// Mandatory Skills (Priority-Sorted)
// ============================================================================

export const MANDATORY_SKILLS: WorkerSkill[] = [
  // Priority 100: Verification (most critical - prevents false completions)
  {
    id: 'verification',
    trigger: 'always',
    priority: 100,
    instructions: `
## VERIFICATION DISCIPLINE

Before claiming completion:
1. **Run verification commands**:
   - npx tsc --noEmit (typecheck)
   - npm run lint (if configured)
   - npm test (run tests)
   - npm run build (verify build passes)

2. **Check fresh output**:
   - Read actual command output
   - Verify no errors present
   - Do NOT assume success

3. **Evidence required**:
   - Show verification command output
   - Confirm all checks passed
   - List files changed

NEVER say "done" without fresh verification evidence.
`.trim(),
  },

  // Priority 90: TDD (write tests first)
  {
    id: 'tdd',
    trigger: 'always',
    priority: 90,
    instructions: `
## TDD DISCIPLINE

Test-Driven Development workflow:
1. **Write test FIRST** (before implementation):
   - Create test file if needed
   - Write failing test for new feature
   - Run test to confirm it fails

2. **Implement** (make test pass):
   - Write minimal code to pass test
   - Run test to confirm it passes
   - Refactor if needed

3. **Verify** (run full suite):
   - npm test -- all tests pass
   - npx tsc --noEmit -- no type errors

NEVER write implementation before tests exist.
`.trim(),
  },

  // Priority 80: Typecheck (always verify types)
  {
    id: 'typecheck',
    trigger: 'always',
    priority: 80,
    instructions: `
## TYPECHECK DISCIPLINE

After EVERY file change:
1. **Run typecheck**: npx tsc --noEmit
2. **Read output**: Check for type errors
3. **Fix immediately**: Do not proceed with type errors

TypeScript rules:
- NO 'any' type (use 'unknown' and narrow)
- Explicit return types on exported functions
- Proper null/undefined handling
- Import types from shared files

Run typecheck, read output, fix errors, repeat until clean.
`.trim(),
  },

  // Priority 70: Systematic Debug (on-error only)
  {
    id: 'systematic-debug',
    trigger: 'on-error',
    priority: 70,
    instructions: `
## SYSTEMATIC DEBUGGING (Retry Attempt)

Previous attempt failed. Debug systematically:

1. **Analyze error**:
   - Read full error message
   - Identify root cause
   - Check stack trace

2. **Hypothesis**:
   - Form theory about cause
   - Identify specific fix needed
   - Plan verification approach

3. **Fix + Verify**:
   - Apply targeted fix
   - Run verification (npx tsc, npm test)
   - Confirm error resolved

4. **Root cause prevention**:
   - Document what went wrong
   - Add test to prevent regression

DO NOT retry blindly. Understand the error first.
`.trim(),
  },
]

// ============================================================================
// Skill Selection
// ============================================================================

/**
 * Get skills applicable to current worker context
 *
 * Filters skills based on trigger conditions and context.
 */
export function getApplicableSkills(context: WorkerContext): WorkerSkill[] {
  return MANDATORY_SKILLS.filter(skill => {
    switch (skill.trigger) {
      case 'always':
        return true

      case 'on-error':
        return context.previousAttemptFailed

      case 'on-new-file':
        // Trigger if any files need to be created
        return Object.values(context.filesExist).some(exists => !exists)

      case 'on-test':
        // Trigger if test files are involved
        return Object.keys(context.filesExist).some(file =>
          file.includes('.test.') || file.includes('.spec.')
        )

      default:
        return false
    }
  })
}

// ============================================================================
// Prompt Building
// ============================================================================

/**
 * Build worker prompt with injected skills
 *
 * Combines section details, ownership map, and applicable skills
 * into a comprehensive prompt for the worker agent.
 */
export function buildWorkerPromptWithSkills(
  section: BvsSection,
  ownershipMap: OwnershipMap,
  config: WorkerConfig,
  context: WorkerContext
): string {
  const skills = getApplicableSkills(context)
  const ownedFiles = ownershipMap[section.id] || []

  return `
# TASK: ${section.name}

${section.description || ''}

## FILES YOU OWN (File Ownership - DO NOT MODIFY OTHER FILES)

${ownedFiles.length > 0 ? ownedFiles.map(f => `- ${f}`).join('\n') : 'No files assigned'}

You MUST ONLY modify these files. Do NOT touch files owned by other sections.

## SUCCESS CRITERIA

${section.successCriteria.map((c, i) => `${i + 1}. ${typeof c === 'string' ? c : c.description}`).join('\n')}

## MANDATORY SKILLS

${skills.map(skill => `### ${skill.id.toUpperCase()}\n\n${skill.instructions}`).join('\n\n')}

## CONFIGURATION

- Model: ${config.model}
- Max turns: ${config.maxTurns}
- Retry attempt: ${context.previousAttemptFailed ? 'YES (previous attempt failed)' : 'NO (first attempt)'}

## WORKFLOW

1. Read files you need to modify
2. Write tests FIRST (TDD)
3. Implement changes
4. Run typecheck: npx tsc --noEmit
5. Run tests: npm test
6. Verify all checks pass
7. Signal completion with evidence

REMEMBER: Verification evidence required before claiming "done".
`.trim()
}

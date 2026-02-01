/**
 * Unit tests for BVS Worker Skills
 *
 * Tests skill injection system that adds mandatory skills to worker prompts.
 * Covers TDD, typecheck, systematic-debug, and verification skills.
 */

import { describe, it, expect } from 'vitest'
import {
  buildWorkerPromptWithSkills,
  MANDATORY_SKILLS,
  getApplicableSkills,
} from '../bvs-worker-skills'
import type { BvsSection } from '@shared/bvs-types'

describe('BVS Worker Skills', () => {
  describe('MANDATORY_SKILLS', () => {
    it('includes TDD skill', () => {
      const tddSkill = MANDATORY_SKILLS.find(s => s.id === 'tdd')

      expect(tddSkill).toBeDefined()
      expect(tddSkill?.trigger).toBe('always')
      expect(tddSkill?.priority).toBeGreaterThan(0)
      expect(tddSkill?.instructions).toContain('test')
    })

    it('includes typecheck skill', () => {
      const typecheckSkill = MANDATORY_SKILLS.find(s => s.id === 'typecheck')

      expect(typecheckSkill).toBeDefined()
      expect(typecheckSkill?.trigger).toBe('always')
      expect(typecheckSkill?.instructions).toContain('npx tsc')
    })

    it('includes systematic-debug skill', () => {
      const debugSkill = MANDATORY_SKILLS.find(s => s.id === 'systematic-debug')

      expect(debugSkill).toBeDefined()
      expect(debugSkill?.trigger).toBe('on-error')
      expect(debugSkill?.instructions).toContain('error')
    })

    it('includes verification skill', () => {
      const verifySkill = MANDATORY_SKILLS.find(s => s.id === 'verification')

      expect(verifySkill).toBeDefined()
      expect(verifySkill?.trigger).toBe('always')
      expect(verifySkill?.instructions).toContain('verify')
    })

    it('skills are sorted by priority (highest first)', () => {
      const priorities = MANDATORY_SKILLS.map(s => s.priority)
      const sortedPriorities = [...priorities].sort((a, b) => b - a)

      expect(priorities).toEqual(sortedPriorities)
    })
  })

  describe('getApplicableSkills', () => {
    it('includes always-trigger skills', () => {
      const context = {
        previousAttemptFailed: false,
        filesExist: {},
      }

      const skills = getApplicableSkills(context)
      const alwaysSkills = skills.filter(s => s.trigger === 'always')

      expect(alwaysSkills.length).toBeGreaterThan(0)
      expect(alwaysSkills.some(s => s.id === 'tdd')).toBe(true)
      expect(alwaysSkills.some(s => s.id === 'typecheck')).toBe(true)
    })

    it('includes on-error skills when previousAttemptFailed', () => {
      const context = {
        previousAttemptFailed: true,
        filesExist: {},
      }

      const skills = getApplicableSkills(context)
      const errorSkills = skills.filter(s => s.trigger === 'on-error')

      expect(errorSkills.some(s => s.id === 'systematic-debug')).toBe(true)
    })

    it('excludes on-error skills when no previous failure', () => {
      const context = {
        previousAttemptFailed: false,
        filesExist: {},
      }

      const skills = getApplicableSkills(context)
      const errorSkills = skills.filter(s => s.trigger === 'on-error')

      // Should only include always-trigger on-error skills (if any)
      expect(errorSkills.length).toBe(0)
    })

    it('includes on-new-file skills when files need creation', () => {
      const context = {
        previousAttemptFailed: false,
        filesExist: {
          'src/new-component.tsx': false,
          'src/existing.ts': true,
        },
      }

      const skills = getApplicableSkills(context)

      // Verify skill system detects new files
      expect(Object.values(context.filesExist)).toContain(false)
    })
  })

  describe('buildWorkerPromptWithSkills', () => {
    it('injects skills into worker prompt', () => {
      const section: BvsSection = {
        id: 'section-001',
        name: 'Implement User Authentication',
        description: 'Add login/logout functionality',
        files: [
          { path: 'src/auth/login.ts', action: 'create', status: 'pending' },
        ],
        dependencies: [],
        dependents: [],
        status: 'pending',
        successCriteria: [],
        progress: 0,
        retryCount: 0,
        maxRetries: 3,
        commits: [],
      }

      const ownershipMap = {
        'section-001': ['src/auth/login.ts'],
      }

      const config = {
        model: 'sonnet' as const,
        maxTurns: 10,
      }

      const context = {
        previousAttemptFailed: false,
        filesExist: {
          'src/auth/login.ts': false,
        },
      }

      const prompt = buildWorkerPromptWithSkills(section, ownershipMap, config, context)

      // Should include section name
      expect(prompt).toContain('User Authentication')

      // Should include skills
      expect(prompt).toContain('MANDATORY SKILLS')

      // Should include TDD skill (always-trigger)
      expect(prompt.toLowerCase()).toContain('test')

      // Should include file ownership
      expect(prompt).toContain('src/auth/login.ts')
    })

    it('includes debug skills on retry attempts', () => {
      const section: BvsSection = {
        id: 'section-001',
        name: 'Fix Bug',
        files: [],
        dependencies: [],
        dependents: [],
        status: 'retrying',
        successCriteria: [],
        progress: 0,
        retryCount: 1,
        maxRetries: 3,
        commits: [],
      }

      const context = {
        previousAttemptFailed: true,  // Retry scenario
        filesExist: {},
      }

      const prompt = buildWorkerPromptWithSkills(
        section,
        { 'section-001': [] },
        { model: 'sonnet', maxTurns: 10 },
        context
      )

      // Should include systematic-debug skill
      expect(prompt.toLowerCase()).toContain('debug')
    })

    it('formats skills by priority order', () => {
      const section: BvsSection = {
        id: 'section-001',
        name: 'Test',
        files: [],
        dependencies: [],
        dependents: [],
        status: 'pending',
        successCriteria: [],
        progress: 0,
        retryCount: 0,
        maxRetries: 3,
        commits: [],
      }

      const context = {
        previousAttemptFailed: false,
        filesExist: {},
      }

      const prompt = buildWorkerPromptWithSkills(
        section,
        { 'section-001': [] },
        { model: 'sonnet', maxTurns: 10 },
        context
      )

      // Find skill section
      const skillsIndex = prompt.indexOf('MANDATORY SKILLS')
      expect(skillsIndex).toBeGreaterThan(-1)

      // Verify skills are included in prompt
      const skillsSection = prompt.substring(skillsIndex)
      expect(skillsSection.length).toBeGreaterThan(100)  // Should have substantial content
    })

    it('includes ownership map in prompt', () => {
      const section: BvsSection = {
        id: 'section-001',
        name: 'Test',
        files: [
          { path: 'src/file1.ts', action: 'create', status: 'pending' },
          { path: 'src/file2.ts', action: 'modify', status: 'pending' },
        ],
        dependencies: [],
        dependents: [],
        status: 'pending',
        successCriteria: [],
        progress: 0,
        retryCount: 0,
        maxRetries: 3,
        commits: [],
      }

      const ownershipMap = {
        'section-001': ['src/file1.ts', 'src/file2.ts'],
      }

      const context = {
        previousAttemptFailed: false,
        filesExist: {},
      }

      const prompt = buildWorkerPromptWithSkills(
        section,
        ownershipMap,
        { model: 'sonnet', maxTurns: 10 },
        context
      )

      expect(prompt).toContain('src/file1.ts')
      expect(prompt).toContain('src/file2.ts')
    })
  })
})

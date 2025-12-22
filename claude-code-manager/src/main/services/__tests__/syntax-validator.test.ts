/**
 * Basic smoke tests for SyntaxValidator
 *
 * These tests verify that the SyntaxValidator service can be instantiated
 * and has the expected public API. Full validation tests would require
 * actual language parsers and test fixtures.
 */

import { syntaxValidator } from '../syntax-validator'

describe('SyntaxValidator', () => {
  describe('API Surface', () => {
    it('should have detectLanguage method', () => {
      expect(typeof syntaxValidator.detectLanguage).toBe('function')
    })

    it('should have validateContent method', () => {
      expect(typeof syntaxValidator.validateContent).toBe('function')
    })
  })

  describe('Language Detection', () => {
    it('should detect TypeScript files', () => {
      expect(syntaxValidator.detectLanguage('file.ts')).toBe('typescript')
      expect(syntaxValidator.detectLanguage('file.tsx')).toBe('typescript')
    })

    it('should detect JavaScript files', () => {
      expect(syntaxValidator.detectLanguage('file.js')).toBe('javascript')
      expect(syntaxValidator.detectLanguage('file.jsx')).toBe('javascript')
    })

    it('should detect JSON files', () => {
      expect(syntaxValidator.detectLanguage('file.json')).toBe('json')
    })

    it('should detect Python files', () => {
      expect(syntaxValidator.detectLanguage('file.py')).toBe('python')
    })

    it('should return unknown for unsupported files', () => {
      expect(syntaxValidator.detectLanguage('file.xyz')).toBe('unknown')
    })
  })

  describe('JSON Validation', () => {
    it('should validate valid JSON', async () => {
      const result = await syntaxValidator.validateContent('{"key": "value"}', 'json')
      expect(result.valid).toBe(true)
      expect(result.errors).toBeUndefined()
    })

    it('should reject invalid JSON', async () => {
      const result = await syntaxValidator.validateContent('{"key": invalid}', 'json')
      expect(result.valid).toBe(false)
      expect(result.errors).toBeDefined()
      expect(result.errors!.length).toBeGreaterThan(0)
    })

    it('should provide error details for invalid JSON', async () => {
      const result = await syntaxValidator.validateContent('{invalid', 'json')
      expect(result.valid).toBe(false)
      expect(result.errors![0].message).toBeDefined()
    })
  })

  describe('Unknown Language', () => {
    it('should return valid for unknown languages', async () => {
      const result = await syntaxValidator.validateContent('any content', 'unknown')
      expect(result.valid).toBe(true)
    })
  })
})

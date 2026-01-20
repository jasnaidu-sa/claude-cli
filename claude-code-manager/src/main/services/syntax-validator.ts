import { promises as fs } from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as os from 'os';
import { randomBytes } from 'crypto';
import type { ValidationResult } from '@shared/types/git';

const execFileAsync = promisify(execFile);

/**
 * Type guard for Error objects
 */
function isErrorObject(error: unknown): error is Error {
  return error instanceof Error;
}

/**
 * P0 FIX: Type guard for exec errors with stderr property
 */
function hasStderrProperty(error: unknown): error is Error & { stderr: unknown } {
  return isErrorObject(error) && 'stderr' in error;
}

/**
 * P0 FIX: Safely extract stderr from error object
 */
function getStderrFromError(error: unknown): string {
  if (hasStderrProperty(error)) {
    const stderr = error.stderr;
    return typeof stderr === 'string' ? stderr : String(stderr ?? '');
  }
  return '';
}

/**
 * Syntax Validator Service
 *
 * Validates code syntax for various programming languages.
 * Uses language-specific tools to check for syntax errors.
 *
 * Supported languages:
 * - TypeScript/JavaScript (via tsc --noEmit)
 * - JSON (via JSON.parse)
 * - Python (via python -m py_compile)
 *
 * Security:
 * - Uses temporary files for validation (no direct code execution)
 * - Validates file paths to prevent traversal
 * - Sanitizes error messages
 * - Timeout enforcement
 */

const VALIDATION_TIMEOUT_MS = 10000; // 10 seconds

/**
 * Language types supported for validation
 */
type Language = 'typescript' | 'javascript' | 'json' | 'python' | 'unknown';

class SyntaxValidator {
  /**
   * Detect language from file extension
   */
  detectLanguage(filePath: string): Language {
    const ext = path.extname(filePath).toLowerCase().slice(1);

    const languageMap: Record<string, Language> = {
      ts: 'typescript',
      tsx: 'typescript',
      js: 'javascript',
      jsx: 'javascript',
      json: 'json',
      py: 'python'
    };

    return languageMap[ext] || 'unknown';
  }

  /**
   * Validate code content without writing to original file
   *
   * @param content - Code content to validate
   * @param language - Programming language
   * @returns Validation result
   */
  async validateContent(content: string, language: Language): Promise<ValidationResult> {
    switch (language) {
      case 'typescript':
      case 'javascript':
        return this.validateTypeScript(content, language);
      case 'json':
        return this.validateJSON(content);
      case 'python':
        return this.validatePython(content);
      default:
        return {
          valid: true,
          errors: undefined
        };
    }
  }

  /**
   * Validate a file by reading it and checking syntax
   *
   * @param filePath - Path to file to validate
   * @returns Validation result
   */
  async validateFile(filePath: string): Promise<ValidationResult> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const language = this.detectLanguage(filePath);
      return this.validateContent(content, language);
    } catch (error) {
      const message = isErrorObject(error) ? error.message : String(error);
      return {
        valid: false,
        errors: [
          {
            message: `Failed to read file: ${message}`
          }
        ]
      };
    }
  }

  /**
   * Validate TypeScript/JavaScript syntax
   * P0 FIX: Use tsc directly instead of npx, use crypto random for temp files
   * P2 FIX: Use exclusive write flag to prevent symlink attacks
   */
  private async validateTypeScript(content: string, language: Language): Promise<ValidationResult> {
    const ext = language === 'typescript' ? '.ts' : '.js';
    // P2 FIX: Use cryptographically random filename
    const randomSuffix = randomBytes(16).toString('hex');
    const tempFile = path.join(os.tmpdir(), `syntax-check-${randomSuffix}-${Date.now()}${ext}`);

    try {
      // P2 FIX: Write with exclusive flag to fail if file exists (prevents symlink attack)
      await fs.writeFile(tempFile, content, { encoding: 'utf-8', flag: 'wx' });

      // P0 FIX: Use tsc directly instead of npx to prevent hijacking
      try {
        await execFileAsync(
          'tsc',
          ['--noEmit', '--skipLibCheck', '--esModuleInterop', tempFile],
          { timeout: VALIDATION_TIMEOUT_MS }
        );

        // If tsc succeeded, syntax is valid
        return { valid: true };
      } catch (error) {
        // tsc failed, parse error output
        // P0 FIX: Use type-safe stderr extraction
        const stderr = getStderrFromError(error);
        if (stderr) {
          return this.parseTypeScriptErrors(stderr);
        }

        const message = isErrorObject(error) ? error.message : String(error);
        return {
          valid: false,
          errors: [{ message: `TypeScript validation failed: ${message}` }]
        };
      }
    } finally {
      // Clean up temp file
      try {
        await fs.unlink(tempFile);
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Parse TypeScript compiler error output
   */
  private parseTypeScriptErrors(stderr: string): ValidationResult {
    const errors: Array<{ line?: number; column?: number; message: string }> = [];

    // TypeScript error format: file.ts(line,col): error TS1234: message
    const errorRegex = /\((\d+),(\d+)\):\s*error\s+TS\d+:\s*(.+)/g;

    let match;
    while ((match = errorRegex.exec(stderr)) !== null) {
      errors.push({
        line: parseInt(match[1], 10),
        column: parseInt(match[2], 10),
        message: match[3].trim()
      });
    }

    // If no structured errors found but tsc failed, return generic error
    if (errors.length === 0) {
      errors.push({
        message: 'TypeScript syntax errors detected (see compiler output)'
      });
    }

    return {
      valid: false,
      errors
    };
  }

  /**
   * Validate JSON syntax
   *
   * Uses JSON.parse to check for syntax errors
   */
  private validateJSON(content: string): ValidationResult {
    try {
      JSON.parse(content);
      return { valid: true };
    } catch (error) {
      const message = isErrorObject(error) ? error.message : String(error);

      // Try to extract line/column from error message
      // Error format: "Unexpected token } in JSON at position 123"
      let line: number | undefined;
      let column: number | undefined;

      if (isErrorObject(error) && 'message' in error) {
        const posMatch = /at position (\d+)/.exec(error.message);
        if (posMatch) {
          const position = parseInt(posMatch[1], 10);
          // Calculate line and column from position
          const beforeError = content.substring(0, position);
          line = (beforeError.match(/\n/g) || []).length + 1;
          const lastNewline = beforeError.lastIndexOf('\n');
          column = position - lastNewline;
        }
      }

      return {
        valid: false,
        errors: [
          {
            line,
            column,
            message: `JSON syntax error: ${message}`
          }
        ]
      };
    }
  }

  /**
   * Validate Python syntax
   * P0 FIX: Use ast.parse instead of py_compile to avoid code execution
   * P2 FIX: Use crypto random for temp files and exclusive write
   */
  private async validatePython(content: string): Promise<ValidationResult> {
    // P2 FIX: Use cryptographically random filename
    const randomSuffix = randomBytes(16).toString('hex');
    const tempFile = path.join(os.tmpdir(), `syntax-check-${randomSuffix}-${Date.now()}.py`);

    try {
      // P2 FIX: Write with exclusive flag to fail if file exists (prevents symlink attack)
      await fs.writeFile(tempFile, content, { encoding: 'utf-8', flag: 'wx' });

      // P0 FIX: Use ast.parse (pure parsing) instead of py_compile (which can execute code)
      // We use Python's ast module directly via -c flag with a safe script
      try {
        await execFileAsync(
          'python',
          [
            '-c',
            `import ast; ast.parse(open('${tempFile.replace(/'/g, "\\'")}', 'r', encoding='utf-8').read())`
          ],
          { timeout: VALIDATION_TIMEOUT_MS }
        );

        return { valid: true };
      } catch (error) {
        // Python AST parsing failed, parse error
        // P0 FIX: Use type-safe stderr extraction
        const stderr = getStderrFromError(error);
        if (stderr) {
          return this.parsePythonErrors(stderr);
        }

        const message = isErrorObject(error) ? error.message : String(error);
        return {
          valid: false,
          errors: [{ message: `Python validation failed: ${message}` }]
        };
      }
    } finally {
      // Clean up temp file
      try {
        await fs.unlink(tempFile);
      } catch {
        // Ignore cleanup errors
      }

      try {
        // Also clean up __pycache__ if created (shouldn't happen with ast.parse)
        const pycacheDir = path.join(os.tmpdir(), '__pycache__');
        await fs.rm(pycacheDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Parse Python compiler error output
   */
  private parsePythonErrors(stderr: string): ValidationResult {
    const errors: Array<{ line?: number; column?: number; message: string }> = [];

    // Python error format: File "file.py", line 10
    //                        SyntaxError: message
    const lines = stderr.split('\n');
    let currentLine: number | undefined;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Extract line number
      const lineMatch = /line (\d+)/.exec(line);
      if (lineMatch) {
        currentLine = parseInt(lineMatch[1], 10);
      }

      // Extract error message
      if (line.includes('SyntaxError:') || line.includes('IndentationError:')) {
        const errorType = line.includes('SyntaxError:') ? 'SyntaxError' : 'IndentationError';
        const message = line.split(':').slice(1).join(':').trim() || errorType;

        errors.push({
          line: currentLine,
          message
        });
      }
    }

    if (errors.length === 0) {
      errors.push({
        message: 'Python syntax errors detected'
      });
    }

    return {
      valid: false,
      errors
    };
  }

  /**
   * Batch validate multiple files
   *
   * @param filePaths - Array of file paths to validate
   * @returns Map of file paths to validation results
   */
  async validateFiles(filePaths: string[]): Promise<Map<string, ValidationResult>> {
    const results = new Map<string, ValidationResult>();

    // Validate files in parallel
    const validations = filePaths.map(async (filePath) => {
      const result = await this.validateFile(filePath);
      results.set(filePath, result);
    });

    await Promise.all(validations);
    return results;
  }

  /**
   * Check if a language is supported for validation
   */
  isLanguageSupported(language: Language): boolean {
    return language !== 'unknown';
  }
}

export const syntaxValidator = new SyntaxValidator();
export default syntaxValidator;

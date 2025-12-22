# syntax-validator.ts

**Last Updated**: 2025-12-22

## Overview

Service for validating syntax of resolved merge conflict code before applying changes. Supports multiple programming languages with language-specific validation tools.

## Purpose

Prevents applying syntactically invalid code from AI resolutions, reducing the risk of breaking builds after automatic conflict resolution.

## Supported Languages

### TypeScript / JavaScript
**Detection**: `.ts`, `.tsx`, `.js`, `.jsx` extensions
**Validator**: TypeScript compiler (`tsc`)
**Method**: Compile check without emitting files

### JSON
**Detection**: `.json` extension
**Validator**: Native `JSON.parse()`
**Method**: Parse and validate structure

### Python
**Detection**: `.py` extension
**Validator**: Python compiler (`python -m py_compile`)
**Method**: Compile to bytecode without execution

### Unknown
**Detection**: Any other extension
**Validator**: None
**Method**: Returns valid (pass-through)

## Key Components

### SyntaxValidator Class

Singleton service providing language detection and validation.

#### `detectLanguage(filePath: string): Language`

Maps file extensions to supported language types.

**Implementation**:
```typescript
detectLanguage(filePath: string): Language {
  const ext = path.extname(filePath).toLowerCase()

  switch (ext) {
    case '.ts':
    case '.tsx':
      return 'typescript'

    case '.js':
    case '.jsx':
      return 'javascript'

    case '.json':
      return 'json'

    case '.py':
      return 'python'

    default:
      return 'unknown'
  }
}
```

**Edge Cases**:
- No extension → 'unknown'
- Case insensitive (`.TS` → typescript)
- React extensions (`.tsx`, `.jsx`) detected

#### `validateContent(content: string, language: Language): Promise<ValidationResult>`

Validates code syntax using language-specific validator.

**Return Type**:
```typescript
interface ValidationResult {
  valid: boolean
  errors?: Array<{
    line?: number
    column?: number
    message: string
  }>
}
```

**Example Results**:
```typescript
// Valid code
{ valid: true }

// Invalid code
{
  valid: false,
  errors: [
    {
      line: 15,
      column: 23,
      message: "Unexpected token '}'"
    }
  ]
}
```

## Validation Methods

### TypeScript/JavaScript Validation

**Function**: `validateTypeScript(content: string, language: Language): Promise<ValidationResult>`

**Process**:
1. Write content to temporary file
2. Run `tsc --noEmit <tempFile>`
3. Parse stderr for errors
4. Extract line/column numbers
5. Clean up temp file

**Temp File Handling**:
```typescript
const tempFile = path.join(os.tmpdir(), `validate-${Date.now()}${ext}`)
await fs.writeFile(tempFile, content, 'utf-8')

try {
  const { stderr } = await execAsync(
    `npx tsc --noEmit --skipLibCheck "${tempFile}"`,
    { timeout: 10000 }
  )
  // Parse errors from stderr
} finally {
  await fs.unlink(tempFile)  // Always cleanup
}
```

**Error Parsing**:
```
Input: "temp.ts(15,23): error TS1005: '}' expected."
Output: { line: 15, column: 23, message: "'}' expected." }
```

**Regex Pattern**:
```typescript
const errorRegex = /\((\d+),(\d+)\):\s*error\s*TS\d+:\s*(.+)/
```

**Flags**:
- `--noEmit`: Don't generate output files
- `--skipLibCheck`: Skip type checking of declaration files (faster)

**Timeout**: 10 seconds (prevents hanging on complex files)

### JSON Validation

**Function**: `validateJSON(content: string): ValidationResult`

**Process**:
1. Attempt `JSON.parse(content)`
2. Return success or parse error

**Implementation**:
```typescript
validateJSON(content: string): ValidationResult {
  try {
    JSON.parse(content)
    return { valid: true }
  } catch (error) {
    return {
      valid: false,
      errors: [{
        line: this.calculateLineNumber(content, error.message),
        message: error.message
      }]
    }
  }
}
```

**Line Number Calculation**:
```typescript
private calculateLineNumber(content: string, errorMessage: string): number | undefined {
  // Extract position from "Unexpected token } at position 123"
  const match = errorMessage.match(/position\s+(\d+)/)
  if (match) {
    const position = parseInt(match[1])
    return content.substring(0, position).split('\n').length
  }
  return undefined
}
```

**Synchronous**: No temp files or external processes needed

### Python Validation

**Function**: `validatePython(content: string): Promise<ValidationResult>`

**Process**:
1. Write content to temporary `.py` file
2. Run `python -m py_compile <tempFile>`
3. Parse stderr for syntax errors
4. Extract line numbers
5. Clean up temp file

**Command**:
```typescript
await execAsync(`python -m py_compile "${tempFile}"`, {
  timeout: 10000
})
```

**Error Parsing**:
```
Input: "  File "temp.py", line 15
            ^
        SyntaxError: invalid syntax"

Output: { line: 15, message: "invalid syntax" }
```

**Requirements**:
- Python must be installed and in PATH
- Falls back to "unknown" if Python not available

### Unknown Language Validation

**Function**: Returns `{ valid: true }`

**Rationale**:
- No validator available for language
- Better to apply and let tests catch issues
- Alternative: Block resolution (too conservative)

**Behavior**:
```typescript
case 'unknown':
  return { valid: true }
```

## Error Handling

### Validator Not Found
```typescript
// TypeScript/JavaScript
try {
  await execAsync('npx tsc --version')
} catch {
  // tsc not installed
  return { valid: false, errors: [{ message: 'TypeScript compiler not found' }] }
}
```

### Timeout
```typescript
const { stderr } = await execAsync(command, {
  timeout: 10000  // 10 seconds max
})

// If exceeded: throws TimeoutError
```

### Temp File Cleanup
```typescript
finally {
  try {
    await fs.unlink(tempFile)
  } catch {
    // Ignore cleanup errors (file might not exist)
  }
}
```

### Parse Errors
```typescript
catch (error) {
  return {
    valid: false,
    errors: [{
      message: isErrorObject(error) ? error.message : 'Validation failed'
    }]
  }
}
```

## Integration Points

### Used By
- `conflict-resolver.ts` - Validates resolved code before applying
- Post-AI-resolution validation step

### Usage Pattern
```typescript
const language = syntaxValidator.detectLanguage(filePath)
const validation = await syntaxValidator.validateContent(resolvedCode, language)

if (!validation.valid) {
  // Show warnings in UI
  console.warn(`Syntax validation failed: ${validation.errors}`)
  // Still apply (let user fix) or abort (conservative)
}
```

## Performance Characteristics

### TypeScript/JavaScript
- **Time**: 1-3 seconds (depends on file size)
- **Overhead**: External process spawn, temp file I/O
- **Blocking**: Yes (uses await)

### JSON
- **Time**: < 10ms
- **Overhead**: None (native parser)
- **Blocking**: Yes but negligible

### Python
- **Time**: 0.5-2 seconds
- **Overhead**: External process spawn, temp file I/O
- **Blocking**: Yes

### Unknown
- **Time**: < 1ms
- **Overhead**: None
- **Blocking**: No

## Limitations

### TypeScript/JavaScript
- Requires `tsc` installed (usually available via `npx`)
- May show type errors that don't affect runtime
- Can't validate against project's `tsconfig.json`

### JSON
- Only validates structure, not schema
- Can't check required fields or types

### Python
- Requires Python installed on system
- Only checks syntax, not runtime errors
- Can't validate against type hints

### General
- Can't validate logic correctness
- Can't check against project conventions
- No semantic analysis

## Testing

**Test File**: `__tests__/syntax-validator.test.ts`

**Coverage**:
- Language detection for all supported types
- Valid JSON validation
- Invalid JSON validation
- Error message extraction
- Unknown language pass-through

**Manual Testing**:
```typescript
// Valid TypeScript
await syntaxValidator.validateContent('const x = 1', 'typescript')
// → { valid: true }

// Invalid TypeScript
await syntaxValidator.validateContent('const x = ', 'typescript')
// → { valid: false, errors: [...] }

// Valid JSON
await syntaxValidator.validateContent('{"key": "value"}', 'json')
// → { valid: true }

// Invalid JSON
await syntaxValidator.validateContent('{invalid}', 'json')
// → { valid: false, errors: [...] }
```

## Security Considerations

### Command Injection Prevention
- Uses `execAsync` with array of arguments (not shell string)
- Temp file paths are sanitized
- No user input in commands

### Temp File Security
- Created in OS temp directory (`os.tmpdir()`)
- Unique timestamps prevent collisions
- Cleaned up in finally block
- Errors during cleanup are ignored

### Resource Limits
- 10-second timeout prevents hanging
- Temp files are small (< 10MB from conflict-resolver)
- No recursive validation

## Future Enhancements

- [ ] Support more languages (Go, Rust, Java, C#)
- [ ] Schema validation for JSON/YAML
- [ ] ESLint integration for JavaScript
- [ ] Black/flake8 for Python
- [ ] Configurable validation rules
- [ ] Cache validation results
- [ ] Parallel validation for multiple files

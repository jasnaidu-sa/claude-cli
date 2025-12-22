# claude-api-service.ts

**Last Updated**: 2025-12-22

## Overview

Service for communicating with the Claude API to provide AI-assisted merge conflict resolution. Implements a 3-tier conflict resolution strategy with rate limiting and timeout enforcement.

## Purpose

Enables intelligent automatic resolution of git merge conflicts using Claude's code understanding capabilities, reducing manual conflict resolution time and improving merge accuracy.

## Architecture

### 3-Tier Resolution Strategy

**Tier 1: Git Auto-Merge** (handled by git itself)
- Standard git merge algorithm
- No AI involved
- Fast, deterministic

**Tier 2: AI Conflict-Only Resolution** (this service)
- Extracts only conflict regions with minimal context (5 lines before/after)
- Sends to Claude API with focused prompt
- Returns resolved code with confidence score
- Falls back to Tier 3 if confidence < threshold (default: 60%)

**Tier 3: Full-File Resolution** (this service)
- Sends entire file with all context
- Claude sees full structure and relationships
- Higher token usage but better accuracy
- Used when Tier 2 confidence is low

## Key Components

### ClaudeAPIService Class

Main service class handling all Claude API communication.

#### Rate Limiter

**Purpose**: Prevent API abuse and quota exhaustion

**Configuration**:
- Limit: 10 requests per minute
- Window: 60 seconds sliding
- Behavior: Throws error if limit exceeded

**Implementation**:
```typescript
class RateLimiter {
  private timestamps: number[] = []
  private readonly limit: number = 10
  private readonly windowMs: number = 60000

  checkLimit(): void {
    // Remove timestamps outside window
    // Check if at limit
    // Add new timestamp
  }
}
```

### Core Methods

#### `resolveConflict(conflict: ConflictRegion): Promise<ConflictResolutionResult>`

**Tier 2**: Resolves a single conflict region with minimal context.

**Input**:
```typescript
interface ConflictRegion {
  filePath: string
  startLine: number
  endLine: number
  oursContent: string      // Current branch changes
  theirsContent: string    // Incoming branch changes
  baseContent?: string     // Common ancestor (if available)
  contextBefore: string    // 5 lines before conflict
  contextAfter: string     // 5 lines after conflict
}
```

**Output**:
```typescript
interface ConflictResolutionResult {
  filePath: string
  resolvedContent: string
  strategy: 'ai-conflict-only'  // Tier 2
  confidence: number            // 0-100
  syntaxValid: boolean         // From syntax-validator
  error?: string
}
```

**Prompt Strategy**:
- System: Expert code merge conflict resolver
- User: Provides conflict context, our changes, their changes
- Instructions: Preserve functionality, integrate both changes, return only resolved code
- Temperature: 0.0 (deterministic)

#### `resolveFileWithFullContext(): Promise<ConflictResolutionResult>`

**Tier 3**: Resolves entire file when Tier 2 confidence is insufficient.

**Key Differences from Tier 2**:
- Sends full file content (not just conflict regions)
- Uses 8192 max tokens (vs 4096 for Tier 2)
- Includes all conflicts with line numbers
- Higher API cost but better accuracy

**Confidence Threshold**: Configurable (default: 60%)
- Below threshold → Escalate to Tier 3
- Above threshold → Apply Tier 2 resolution

### Authentication

**Integrated with auth-manager.ts**:
```typescript
private async getAuthToken(): Promise<string> {
  const token = await authManager.getAuthToken()
  if (!token) {
    throw new Error('Claude authentication not found...')
  }
  return token
}
```

**Token Usage**:
- OAuth token from `~/.claude/.credentials.json` (Max plan)
- Falls back to ANTHROPIC_API_KEY
- Sent as `x-api-key` header (Anthropic standard)

## API Request Flow

1. **Get Authentication**
   ```typescript
   const authToken = await this.getAuthToken()
   ```

2. **Rate Limit Check**
   ```typescript
   this.rateLimiter.checkLimit()  // Throws if exceeded
   ```

3. **Build Request**
   ```typescript
   fetch(ANTHROPIC_API_URL, {
     method: 'POST',
     headers: {
       'Content-Type': 'application/json',
       'x-api-key': authToken,
       'anthropic-version': '2023-06-01'
     },
     body: JSON.stringify({
       model: 'claude-sonnet-4-20250514',
       max_tokens: 4096,  // or 8192 for Tier 3
       temperature: 0.0,
       system: systemPrompt,
       messages: [{ role: 'user', content: userPrompt }]
     })
   })
   ```

4. **Timeout Enforcement**
   ```typescript
   const controller = new AbortController()
   setTimeout(() => controller.abort(), 30000)  // 30s timeout
   ```

5. **Response Validation**
   ```typescript
   if (!response.ok) {
     throw new Error(`Claude API error (${response.status})`)
   }
   ```

## Language Detection

Automatically detects file language from extension:
- `.ts` / `.tsx` → TypeScript
- `.js` / `.jsx` → JavaScript
- `.json` → JSON
- `.py` → Python

Used for:
- Code fence syntax in prompts
- Syntax validation after resolution

## Error Handling

### API Errors
- **401 Unauthorized**: Invalid or expired token
- **429 Too Many Requests**: Rate limit exceeded (should never happen with our limiter)
- **500 Server Error**: Claude API issue
- **Timeout**: Request > 30 seconds

### Resolution Errors
- **Low Confidence**: Returned in result, triggers Tier 3 fallback
- **Syntax Invalid**: Returned in result, triggers warning in UI
- **Parse Error**: Unable to extract resolved code from response

### Recovery Strategies
1. Rate limit error → Wait and retry (handled by caller)
2. Timeout → Reduce context size or skip file
3. Syntax error → Return with warning, let human review
4. Low confidence → Automatic Tier 3 escalation

## Performance Characteristics

### Tier 2 (Conflict-Only)
- **Context Size**: ~100-500 tokens
- **Response Time**: 2-5 seconds
- **Cost**: Low (minimal tokens)
- **Success Rate**: ~80% for simple conflicts

### Tier 3 (Full-File)
- **Context Size**: 500-4000 tokens
- **Response Time**: 5-15 seconds
- **Cost**: Medium (full file tokens)
- **Success Rate**: ~95% for complex conflicts

### Rate Limits
- **Configured**: 10 requests/minute
- **Typical Usage**: 3-5 files with conflicts = 3-15 requests
- **Parallel Processing**: 3 concurrent (handled by conflict-resolver)

## Integration

### Used By
- `conflict-resolver.ts` - Calls for each conflict region
- `git-service.ts` - Provides merge-with-AI functionality
- `git-handlers.ts` - Exposes to frontend via IPC

### Dependencies
- `auth-manager.ts` - Authentication
- `syntax-validator.ts` - Post-resolution validation
- Native `fetch` API - HTTP requests

## Configuration

### Constants
```typescript
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
const DEFAULT_MODEL = 'claude-sonnet-4-20250514'
const MAX_TOKENS = 4096  // Tier 2
const MAX_TOKENS_TIER_3 = 8192  // Tier 3
const REQUEST_TIMEOUT_MS = 30000
const RATE_LIMIT_REQUESTS_PER_MINUTE = 10
```

### Model Selection
- **Sonnet 4**: Balance of speed and accuracy
- **Future**: Could support model override via config

## Security Considerations

- **API Key Protection**: Never logged or exposed
- **Input Validation**: File paths validated by conflict-resolver
- **Rate Limiting**: Prevents abuse
- **Timeout Enforcement**: Prevents hung requests
- **Error Sanitization**: Removes sensitive data from error messages

## Testing

**Test Coverage**: Basic smoke tests in `__tests__/` directory

**Manual Testing**:
1. Create merge conflict in test repository
2. Run merge with AI enabled
3. Verify resolution quality
4. Check syntax validation results

## Future Enhancements

- [ ] Configurable models (Opus for complex conflicts)
- [ ] Confidence score tuning based on file type
- [ ] Batch conflict resolution optimization
- [ ] Telemetry for resolution success rates
- [ ] User feedback loop for AI improvements

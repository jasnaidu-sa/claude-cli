# Comprehensive BVS Fix Plan - Addressing All Issues

## Problems Identified

### 1. JSON Error Popup
- **Symptom**: App crashes with JSON error popup
- **Likely Cause**: Frontend trying to parse malformed JSON from backend
- **Location**: Probably in BVS event handlers or API responses

### 2. No Automatic Retry Logic
- **Symptom**: Worker fails once and stops permanently
- **Problem**: No retry loop with exponential backoff
- **Expected**: Should retry 3-5 times before giving up

### 3. No Retry UI
- **Symptom**: Section fails, no button to retry
- **Problem**: Missing UI components for manual retry
- **Needed**: [Retry] [Skip] [Stop] buttons in detail panel

### 4. No Error Context
- **Symptom**: "Something went wrong" with no details
- **Problem**: Validation errors not displayed
- **Needed**: Show exactly what failed and why

### 5. No Diagnostic Information
- **Symptom**: Can't tell if retry will help
- **Problem**: Don't know if it's a prompt issue, file issue, or network issue
- **Needed**: Error categorization and suggested actions

## Comprehensive Solution

### Phase 1: Fix JSON Error (CRITICAL - P0)

**Task**: Find and fix JSON parsing error causing crash

**Steps**:
1. Add try-catch around all JSON.parse() calls
2. Log malformed JSON before parsing
3. Validate JSON structure before sending to frontend
4. Add error boundaries in React components

**Files to Check**:
- `src/main/ipc/bvs-handlers.ts` - IPC handlers
- `src/renderer/components/bvs/*.tsx` - React components
- `src/main/services/bvs-orchestrator-service.ts` - Event emission

### Phase 2: Automatic Retry Logic (P0)

**Task**: Add intelligent retry with exponential backoff

**Implementation**:
```typescript
// In bvs-orchestrator-service.ts
async executeWithRetry(config: WorkerConfig, maxRetries = 3) {
  let lastError: string | null = null

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[BVS] Attempt ${attempt}/${maxRetries}`)

      const result = await workerService.executeSection(config)

      if (result.status === 'completed' && result.qualityGatesPassed) {
        return result // Success!
      }

      // Analyze failure
      const errorType = categorizeError(result.errors)

      if (errorType === 'NON_RETRYABLE') {
        console.log('[BVS] Non-retryable error, stopping')
        return result
      }

      if (attempt < maxRetries) {
        const backoff = Math.pow(2, attempt) * 1000 // 2s, 4s, 8s
        console.log(`[BVS] Retrying in ${backoff}ms...`)

        // Modify prompt based on previous error
        config.section.description += `\n\nPREVIOUS ATTEMPT FAILED:\n${result.errors.join('\n')}\n\nPlease fix these issues.`

        await new Promise(resolve => setTimeout(resolve, backoff))
      }

      lastError = result.errors.join('; ')
    } catch (error) {
      lastError = String(error)
    }
  }

  return {
    status: 'failed',
    errors: [`All ${maxRetries} retry attempts failed. Last error: ${lastError}`]
  }
}

function categorizeError(errors: string[]): 'RETRYABLE' | 'NON_RETRYABLE' {
  const errorText = errors.join(' ').toLowerCase()

  // Non-retryable: User input needed
  if (errorText.includes('user confirmation') ||
      errorText.includes('manual intervention')) {
    return 'NON_RETRYABLE'
  }

  // Non-retryable: Permission denied
  if (errorText.includes('permission denied') ||
      errorText.includes('access denied')) {
    return 'NON_RETRYABLE'
  }

  // Retryable: Transient errors
  if (errorText.includes('timeout') ||
      errorText.includes('network') ||
      errorText.includes('rate limit')) {
    return 'RETRYABLE'
  }

  // Retryable: Logic errors (Claude can fix these)
  if (errorText.includes('missing file') ||
      errorText.includes('syntax error') ||
      errorText.includes('validation failed')) {
    return 'RETRYABLE'
  }

  // Default: Retryable
  return 'RETRYABLE'
}
```

### Phase 3: Retry UI (P0)

**Task**: Add retry controls to detail panel

**Location**: `BvsSectionDetailPanel.tsx`

**Components Needed**:
```typescript
// Error/Pause banner at top
<div className="error-banner">
  <AlertTriangle className="h-5 w-5" />
  <div>
    <h4>Section Failed</h4>
    <p>{section.errorMessage}</p>
    <div className="error-details">
      {section.validationErrors?.map(err => (
        <div key={err} className="error-item">❌ {err}</div>
      ))}
    </div>
  </div>
  <div className="actions">
    <Button onClick={handleRetry} variant="primary">
      <RotateCcw className="h-4 w-4" />
      Retry Section
    </Button>
    <Button onClick={handleSkip} variant="outline">
      Skip Section
    </Button>
    <Button onClick={handleEditPrompt} variant="outline">
      <Edit className="h-4 w-4" />
      Edit Prompt
    </Button>
    <Button onClick={handleStop} variant="destructive">
      <StopCircle className="h-4 w-4" />
      Stop Execution
    </Button>
  </div>
</div>

// Retry history
<div className="retry-history">
  <h5>Retry History</h5>
  {section.retryHistory?.map((attempt, i) => (
    <div key={i} className="retry-attempt">
      <span>Attempt {i + 1}</span>
      <span className={attempt.success ? 'success' : 'failed'}>
        {attempt.success ? '✓' : '✗'}
      </span>
      <span>{attempt.error}</span>
      <Button size="sm" onClick={() => viewAttemptLogs(i)}>
        View Logs
      </Button>
    </div>
  ))}
</div>
```

### Phase 4: Error Context Display (P0)

**Task**: Show comprehensive error information

**Data Structure**:
```typescript
interface BvsSectionError {
  type: 'VALIDATION' | 'TIMEOUT' | 'TOOL_ERROR' | 'QUALITY_GATE' | 'UNKNOWN'
  message: string
  details: string[]
  suggestedAction: string
  retryable: boolean
  context: {
    turnsUsed: number
    maxTurns: number
    filesAttempted: string[]
    toolsUsed: string[]
    lastOutput: string // Last 500 chars
  }
}
```

**Display**:
```typescript
<ErrorContext error={section.error}>
  <div className="error-type">
    <Icon type={error.type} />
    <h4>{getErrorTitle(error.type)}</h4>
  </div>

  <div className="error-message">{error.message}</div>

  <div className="error-details">
    <h5>What Went Wrong:</h5>
    <ul>
      {error.details.map(d => <li key={d}>{d}</li>)}
    </ul>
  </div>

  <div className="error-context">
    <h5>Execution Context:</h5>
    <div>Turns Used: {error.context.turnsUsed} / {error.context.maxTurns}</div>
    <div>Tools Used: {error.context.toolsUsed.join(', ')}</div>
    <div>Files Attempted: {error.context.filesAttempted.join(', ')}</div>
  </div>

  <div className="suggested-action">
    <h5>💡 Suggested Action:</h5>
    <p>{error.suggestedAction}</p>
  </div>

  <div className="last-output">
    <h5>Last Output:</h5>
    <pre>{error.context.lastOutput}</pre>
  </div>
</ErrorContext>
```

### Phase 5: Diagnostic Information (P1)

**Task**: Provide actionable diagnostics

**Error Categories with Actions**:

1. **VALIDATION_FAILED**
   - Suggested Action: "Review the validation errors above. Most can be auto-fixed by retrying."
   - Retryable: Yes
   - Auto-retry: Yes

2. **TOOL_ERROR**
   - Suggested Action: "A tool failed (file not found, permission denied). Check file paths in plan.json."
   - Retryable: Maybe
   - Auto-retry: No (needs investigation)

3. **TIMEOUT**
   - Suggested Action: "Section took too long. Try increasing maxTurns or simplifying the task."
   - Retryable: Yes
   - Auto-retry: Yes

4. **QUALITY_GATE**
   - Suggested Action: "Worker completed but didn't call mark_complete or files missing. Will retry with reminder."
   - Retryable: Yes
   - Auto-retry: Yes

5. **UNKNOWN**
   - Suggested Action: "Unexpected error. Check logs and try retry. If persists, skip section."
   - Retryable: Maybe
   - Auto-retry: No

### Phase 6: Session Resume After Crash (P1)

**Task**: Allow resuming after app restart

**Implementation**:
- Save section state to disk after each update
- On app startup, check for incomplete sessions
- Show "Resume" banner for paused/failed sessions
- Allow manual intervention before resuming

## Implementation Priority

**IMMEDIATE (Do now)**:
1. Find and fix JSON error (App unusable)
2. Add retry button to failed sections (No way to continue)
3. Display error messages properly (No feedback)

**HIGH (Next)**:
4. Automatic retry with backoff (Improves success rate)
5. Error categorization and suggestions (Helps debugging)

**MEDIUM (Soon)**:
6. Retry history and logs (Helps understand patterns)
7. Session resume after crash (Prevents data loss)

**LOW (Later)**:
8. Edit prompt before retry (Advanced use case)
9. Checkpoint system overhaul (Large refactor)

## Next Steps

1. **Find JSON error source** - Add logging to all JSON operations
2. **Add retry button** - Quick UI fix to unblock testing
3. **Implement auto-retry** - Core logic improvement
4. **Test full flow** - Verify all improvements work together

---

**Status**: Ready to implement
**Estimated Time**:
- JSON fix: 30 min
- Retry button: 30 min
- Auto-retry logic: 1 hour
- Error context: 1 hour
- **Total**: 3 hours

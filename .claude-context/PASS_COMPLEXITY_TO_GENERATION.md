# Pass Complexity to Generation Agent - Simple Solution

**Date**: 2025-12-20
**Problem**: Discovery phase calculates complexity ('quick'/'standard'/'enterprise') but generation agent doesn't receive it
**Solution**: Save complexity analysis to disk, read it in Python generation agent

---

## Current State

### ✅ Complexity IS Already Calculated

**File**: `claude-code-manager/src/main/services/complexity-analyzer.ts`

The `ComplexityAnalyzer` class analyzes messages and returns:

```typescript
interface ComplexityAnalysis {
  score: number                    // 0-100
  level: TaskComplexity            // 'quick' | 'standard' | 'enterprise'
  factors: ComplexityFactor[]
  suggestedMode: 'quick-spec' | 'smart-spec' | 'enterprise-spec'
  confidence: number               // 0-1
  analyzedAt: number
}
```

**Thresholds**:
- **quick** (score < 25): Simple single-feature tasks → 2-5 features
- **standard** (score 25-60): Moderate complexity → 5-10 features
- **enterprise** (score ≥ 60): High complexity → 15+ granular features

### ❌ Complexity Is NOT Saved to Disk

**Current flow**:
```
Discovery Chat → session.json (has messages)
                      ↓
                 ComplexityAnalyzer.analyze(messages)
                      ↓
                 Returns analysis to UI (DiscoveryChat.tsx)
                      ↓
                 [ANALYSIS LOST - NOT SAVED]
                      ↓
                 Spec Generated → spec.md saved
                      ↓
                 Generation Agent reads spec.md
                      ↓
                 NO COMPLEXITY METADATA AVAILABLE
```

---

## Simple Solution - Save Complexity After Spec Generation

### Step 1: Save Complexity Analysis to Disk (TypeScript)

**File**: `claude-code-manager/src/main/services/discovery-chat-service.ts`

**Location**: After line 1628 (`await saveSpecToDisk(session.projectPath, specContent)`)

**Add this function** at line 325 (after `saveSpecToDisk`):

```typescript
/**
 * Save complexity analysis to disk
 * Saves to: project/.autonomous/complexity.json
 */
async function saveComplexityToDisk(
  projectPath: string,
  analysis: ComplexityAnalysis
): Promise<string> {
  const autonomousPath = await ensureAutonomousDir(projectPath)
  const complexityPath = path.join(autonomousPath, 'complexity.json')

  await fs.writeFile(complexityPath, JSON.stringify(analysis, null, 2))
  console.log('[DiscoveryChat] Complexity analysis saved:', complexityPath)
  return complexityPath
}
```

**Import ComplexityAnalysis type** at line 20:

```typescript
import type { ComplexityAnalysis } from '../../shared/types'
```

**Call it in generateQuickSpec** at line 1629 (right after saveSpecToDisk):

```typescript
// Save spec to disk
await saveSpecToDisk(session.projectPath, specContent)

// NEW: Save complexity analysis to disk
const messages = session.messages.map(m => ({
  role: m.role,
  content: m.content
}))
const complexityAnalysis = analyzeComplexity(messages)
await saveComplexityToDisk(session.projectPath, complexityAnalysis)
```

**Import analyzeComplexity** at line 23:

```typescript
import { analyzeComplexity } from './complexity-analyzer'
```

### Step 2: Read Complexity in Python Generation Agent

**File**: `autonomous-orchestrator/agent.py`

**Add method** at line 200:

```python
def _load_complexity_level(self) -> str:
    """
    Load project complexity from complexity.json.

    Returns:
        'quick', 'standard', or 'enterprise'
    """
    complexity_path = self.output_dir / "complexity.json"

    if complexity_path.exists():
        try:
            import json
            with open(complexity_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
                level = data.get('level', 'standard')
                self.emit_output("stdout", f"Detected complexity: {level} (score: {data.get('score', 0)})")
                return level
        except Exception as e:
            self.emit_output("stderr", f"Warning: Could not load complexity: {e}")

    self.emit_output("stdout", "No complexity.json found, defaulting to 'standard'")
    return 'standard'
```

**Update run_generation_phase** at line 210:

```python
async def run_generation_phase(self):
    """Run the generation phase with complexity-aware prompting."""
    self.state.phase = "generation"
    self.emit_status("running")
    self.emit_progress("Starting test generation")

    spec = self.load_spec()
    if not spec:
        self.emit_output("stderr", "No specification file found")
        return

    # Load complexity level from discovery phase
    complexity = self._load_complexity_level()

    prompt = self.load_system_prompt()

    # Build complexity-aware message
    if complexity == 'quick':
        message = f"""Based on this specification, generate a FOCUSED feature list.

{spec}

IMPORTANT - This is a SIMPLE project (complexity: quick):
- Create 2-5 features maximum
- Group related functionality together (e.g., "Counter component with all operations" as ONE feature)
- Only separate features if they have clear dependencies or test in different ways
- Include basic unit tests per feature
- Avoid creating separate features for infrastructure, styling, exports unless truly necessary

Create a feature_list.json file at .autonomous/feature_list.json."""

    elif complexity == 'enterprise':
        message = f"""Based on this specification, generate a COMPREHENSIVE feature list.

{spec}

IMPORTANT - This is a COMPLEX project (complexity: enterprise):
- Break down into granular features (1-2 hours of work each)
- Create separate features for infrastructure (testing setup, migrations, etc.)
- Include detailed integration tests
- Track dependencies carefully between features
- Consider security, performance, and scalability implications

Create a feature_list.json file at .autonomous/feature_list.json with all features
categorized and ready for implementation."""

    else:  # standard
        message = f"""Based on this specification, generate a BALANCED feature list.

{spec}

This is a MODERATE complexity project (complexity: standard):
- Create 5-10 features with clear boundaries
- Group simple operations together, separate complex integrations
- Include appropriate test coverage
- Balance between granularity and implementation efficiency

Create a feature_list.json file at .autonomous/feature_list.json with all features
categorized and ready for implementation."""

    # Streaming happens via _handle_stream_event callback
    response = await self.client.send_message(message, prompt)
    self.emit_progress("Test generation complete")
```

---

## Expected Results

### For Test-Project Counter (Quick)

**complexity.json** (created by discovery):
```json
{
  "score": 15,
  "level": "quick",
  "factors": [
    {
      "name": "feature_count",
      "weight": 5,
      "detected": true,
      "details": "1 distinct features detected"
    }
  ],
  "suggestedMode": "quick-spec",
  "confidence": 0.4,
  "analyzedAt": 1766227860620
}
```

**feature_list.json** (generated by agent):
- **2-3 features** instead of 10:
  1. **Counter Component with State Management** - Create Counter.tsx with useState, increment/decrement/reset handlers, inline styles
  2. **Unit Test Suite** - React Testing Library tests covering initial render, all button operations, edge cases
  3. **Export Configuration** - Update index.ts with named export pattern

**Estimated effort**: 45-90 minutes (vs current 3.5-4.5 hours)

### For Complex Auth System (Enterprise)

**complexity.json**:
```json
{
  "score": 75,
  "level": "enterprise",
  "factors": [
    {"name": "authentication", "weight": 20, "detected": true},
    {"name": "database_operations", "weight": 15, "detected": true},
    {"name": "api_design", "weight": 15, "detected": true},
    {"name": "security", "weight": 10, "detected": true},
    {"name": "feature_count", "weight": 15, "detected": true, "details": "8 features"}
  ],
  "suggestedMode": "enterprise-spec",
  "confidence": 0.8
}
```

**feature_list.json**: 15-20 granular features (UNCHANGED from current behavior)

---

## Implementation Checklist

- [ ] **Step 1**: Add `saveComplexityToDisk()` function in `discovery-chat-service.ts` (line 325)
- [ ] **Step 2**: Import `ComplexityAnalysis` type (line 20)
- [ ] **Step 3**: Import `analyzeComplexity` function (line 23)
- [ ] **Step 4**: Call `saveComplexityToDisk()` in `generateQuickSpec()` (line 1629)
- [ ] **Step 5**: Add `_load_complexity_level()` method in `agent.py` (line 200)
- [ ] **Step 6**: Update `run_generation_phase()` in `agent.py` (line 210)
- [ ] **Step 7**: Test with test-project counter (should create complexity.json with level='quick')
- [ ] **Step 8**: Delete existing test-project/.autonomous/feature_list.json
- [ ] **Step 9**: Run generation phase (should create 2-3 features instead of 10)
- [ ] **Step 10**: Verify complex projects still get granular breakdown

---

## Benefits

✅ **No heuristics** - Uses existing, proven complexity analyzer
✅ **Already calculated** - Discovery phase already does this work
✅ **Simple pass-through** - Just save to disk and read in Python
✅ **Backwards compatible** - Defaults to 'standard' if file missing
✅ **Preserves complex behavior** - Enterprise projects unchanged
✅ **Fixes simple projects** - Counter gets 2-3 features not 10

---

## Files to Modify

1. `claude-code-manager/src/main/services/discovery-chat-service.ts` (4 changes)
2. `autonomous-orchestrator/agent.py` (2 changes)

That's it. No new heuristics, just pass the existing complexity analysis.

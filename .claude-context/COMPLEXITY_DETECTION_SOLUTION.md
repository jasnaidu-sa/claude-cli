# Complexity Detection Solution - Connecting Discovery to Generation

**Date**: 2025-12-20
**Issue**: Feature generation creates 10 features (21KB) for simple counter component
**Root Cause**: Discovery phase collects enough context to determine complexity, but this is NOT passed to the generation agent

---

## Current State Analysis

### ✅ What We HAVE: Discovery Phase Complexity Detection

The discovery chat (`session.json`) contains rich context that indicates project complexity:

**For simple projects** (test-project counter):
- 4 user messages (simple requirement)
- 4 assistant messages (quick clarification)
- Conversation length: ~3.5KB
- Requirements: Single component, no dependencies, minimal testing
- Discovery completed in **4 exchanges**

**For complex projects** (hypothetical auth system):
- 10+ user messages (complex requirements)
- 10+ assistant messages (deep clarification)
- Conversation length: >20KB
- Requirements: Multiple features, integrations, security, migrations
- Discovery takes **8-15 exchanges**

### ❌ What We DON'T HAVE: Passing Complexity to Generation Agent

**Current flow**:
```
Discovery Phase (discovery-chat-service.ts)
  ↓
  session.json saved with conversation history
  ↓
Generate Spec (generateQuickSpec)
  ↓
  Builds prompt from conversation BUT doesn't assess complexity
  ↓
  Spec saved to .autonomous/spec.md
  ↓
Generation Agent (agent.py run_generation_phase)
  ↓
  Reads spec.md BUT has NO complexity metadata
  ↓
  Uses SAME prompt for ALL projects: "generate a comprehensive feature list"
  ↓
  Result: Over-engineering for simple projects
```

---

## Discovery Session Evidence - Simple vs Complex

### Simple Project Indicators (Counter Component)

From `test-project/.autonomous/session.json`:

```json
{
  "messages": 8,  // 4 user + 4 assistant = 4 exchanges
  "conversationLength": "~3.5KB",
  "discoveryReady": true,
  "exchangeCount": 4,
  "requirements": {
    "features": 1,  // Single Counter component
    "dependencies": 0,  // "no external dependencies"
    "files": 3,  // Counter.tsx, Counter.test.tsx, index.ts
    "integrations": 0,
    "testComplexity": "basic"  // "verify initial render, increment, decrement, reset"
  },
  "finalSummary": "complete, unambiguous spec. implementation requires no judgment calls"
}
```

**Heuristics for SIMPLE**:
- ≤ 5 exchanges to reach `[DISCOVERY_READY]`
- No mention of "database", "API", "authentication", "migration"
- Phrases like "simple", "minimal", "no dependencies"
- Single component or feature described
- "No judgment calls" mentioned by assistant

### Complex Project Indicators (Hypothetical)

```json
{
  "messages": 24,  // 12 user + 12 assistant = 12 exchanges
  "conversationLength": "~25KB",
  "discoveryReady": true,
  "exchangeCount": 12,
  "requirements": {
    "features": 8,  // OAuth, sessions, RBAC, middleware, DB, etc.
    "dependencies": 5,  // Passport, JWT, bcrypt, Redis, DB driver
    "files": 25,  // Routes, controllers, models, middleware, migrations, tests
    "integrations": 3,  // OAuth providers, email service, Redis
    "testComplexity": "extensive"  // Integration tests, security tests, load tests
  },
  "finalSummary": "complex requirements with security considerations, migrations needed"
}
```

**Heuristics for COMPLEX**:
- ≥ 8 exchanges to reach `[DISCOVERY_READY]`
- Keywords: "database", "migration", "authentication", "API endpoints", "permissions"
- Multiple features/components mentioned
- Security/performance considerations discussed
- Third-party integrations required

---

## Solution Architecture

### Option 1: Metadata File (Recommended) ⭐

**Add `.autonomous/metadata.json` after spec generation:**

```typescript
// In discovery-chat-service.ts after saveSpecToDisk()
async function saveProjectMetadata(projectPath: string, session: DiscoverySession): Promise<void> {
  const metadata = {
    complexity: estimateComplexity(session),
    discoveryExchanges: Math.floor(session.messages.filter(m => m.role === 'user').length),
    conversationLength: JSON.stringify(session.messages).length,
    timestamp: Date.now(),
    indicators: extractComplexityIndicators(session)
  }

  const metadataPath = path.join(projectPath, '.autonomous', 'metadata.json')
  await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2))
}

function estimateComplexity(session: DiscoverySession): 'simple' | 'moderate' | 'complex' {
  const userMessages = session.messages.filter(m => m.role === 'user').length
  const conversationText = session.messages.map(m => m.content).join(' ').toLowerCase()

  // Simple: ≤5 exchanges, no complex keywords
  const simpleIndicators = [
    userMessages <= 5,
    !conversationText.includes('database'),
    !conversationText.includes('authentication'),
    !conversationText.includes('migration'),
    conversationText.includes('simple') || conversationText.includes('minimal')
  ]

  // Complex: ≥8 exchanges OR complex keywords
  const complexIndicators = [
    userMessages >= 8,
    conversationText.includes('database') || conversationText.includes('authentication'),
    conversationText.includes('security'),
    conversationText.includes('migration'),
    conversationText.includes('integration')
  ]

  const simpleScore = simpleIndicators.filter(Boolean).length
  const complexScore = complexIndicators.filter(Boolean).length

  if (simpleScore >= 3) return 'simple'
  if (complexScore >= 2) return 'complex'
  return 'moderate'
}

function extractComplexityIndicators(session: DiscoverySession): ComplexityIndicators {
  const conversationText = session.messages.map(m => m.content).join(' ').toLowerCase()

  return {
    hasDatabase: conversationText.includes('database') || conversationText.includes('db'),
    hasAuth: conversationText.includes('auth') || conversationText.includes('login'),
    hasAPI: conversationText.includes('api') || conversationText.includes('endpoint'),
    hasMigration: conversationText.includes('migration') || conversationText.includes('schema'),
    hasIntegration: conversationText.includes('integration') || conversationText.includes('third-party'),
    featureCount: estimateFeatureCount(session),
    fileCount: estimateFileCount(session)
  }
}
```

**Then in `agent.py run_generation_phase()`, read metadata:**

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

    # NEW: Load complexity metadata
    complexity = self._load_complexity_metadata()

    prompt = self.load_system_prompt()
    message = self._build_generation_message(spec, complexity)

    response = await self.client.send_message(message, prompt)
    self.emit_progress("Test generation complete")

def _load_complexity_metadata(self) -> str:
    """Load project complexity from metadata.json."""
    metadata_path = self.output_dir / "metadata.json"
    if metadata_path.exists():
        try:
            import json
            with open(metadata_path, 'r', encoding='utf-8') as f:
                metadata = json.load(f)
                return metadata.get('complexity', 'moderate')
        except Exception as e:
            self.emit_output("stderr", f"Warning: Could not load metadata: {e}")
    return 'moderate'  # Default to moderate if no metadata

def _build_generation_message(self, spec: str, complexity: str) -> str:
    """Build complexity-aware generation message."""
    if complexity == 'simple':
        return f"""Based on this specification, generate a focused feature list.

{spec}

IMPORTANT - This is a SIMPLE project:
- Create 2-5 features maximum
- Group related functionality together (e.g., "Counter component with increment/decrement/reset" as ONE feature)
- Only separate features if they have clear dependencies or different categories
- Include basic unit tests per feature, not separate testing infrastructure features
- Focus on implementation efficiency over granular tracking

Create a feature_list.json file at .autonomous/feature_list.json."""

    elif complexity == 'complex':
        return f"""Based on this specification, generate a comprehensive feature list.

{spec}

IMPORTANT - This is a COMPLEX project:
- Break down into granular features (1-2 hours of work each)
- Create separate features for infrastructure (testing, migrations, etc.)
- Include detailed integration tests
- Track dependencies carefully
- Consider security and performance implications

Create a feature_list.json file at .autonomous/feature_list.json with all features
categorized and ready for implementation."""

    else:  # moderate
        return f"""Based on this specification, generate a balanced feature list.

{spec}

Create 5-10 features with clear boundaries. Group simple operations together,
separate complex integrations. Include appropriate test coverage.

Create a feature_list.json file at .autonomous/feature_list.json."""
```

---

## Expected Results

### Simple Project (Counter)

**Before** (current):
- 10 features
- 21KB feature_list.json
- Estimated 3.5-4.5 hours

**After** (with complexity detection):
- 2-3 features:
  1. **Counter Component Implementation** - Create Counter.tsx with useState, increment/decrement/reset handlers, inline styles
  2. **Unit Test Suite** - React Testing Library tests for all operations
  3. **Export Configuration** - Update index.ts with named export
- ~5KB feature_list.json
- Estimated 45-90 minutes

### Complex Project (Auth System)

**Before and After** (same):
- 15-20 features
- Granular breakdown
- Detailed testing
- Full checkpoint coverage

---

## Implementation Steps

### Step 1: Add Metadata Generation (TypeScript)

**File**: `claude-code-manager/src/main/services/discovery-chat-service.ts`

1. Add `saveProjectMetadata()` function after `saveSpecToDisk()` (line 323)
2. Add `estimateComplexity()` helper (line 350)
3. Add `extractComplexityIndicators()` helper (line 375)
4. Call `saveProjectMetadata()` in `generateQuickSpec()` after spec is saved (line 1628)

### Step 2: Read Metadata in Python (Python)

**File**: `autonomous-orchestrator/agent.py`

1. Add `_load_complexity_metadata()` method (line 200)
2. Add `_build_generation_message()` method (line 220)
3. Update `run_generation_phase()` to use complexity-aware messaging (line 210)

### Step 3: Test with Test-Project

1. Delete existing `test-project/.autonomous/feature_list.json`
2. Delete existing `test-project/.autonomous/metadata.json` (if exists)
3. Restart discovery for counter component
4. Generate spec → should create metadata.json with `complexity: 'simple'`
5. Run generation phase → should create 2-3 features instead of 10

### Step 4: Verify Complex Project Handling

Create a mock complex project spec:
- Multiple features (auth, RBAC, migrations)
- Database integration
- Security requirements
- Should generate `complexity: 'complex'` and maintain 15+ granular features

---

## Files to Modify

1. **`claude-code-manager/src/main/services/discovery-chat-service.ts`**
   - Add metadata generation after spec save
   - Add complexity estimation logic

2. **`autonomous-orchestrator/agent.py`**
   - Add metadata reading in run_generation_phase()
   - Add complexity-aware message generation

3. **Test with**:
   - `test-project` (simple counter)
   - Create new test with complex spec (auth system)

---

## Benefits

✅ **Preserves comprehensive approach for complex projects** - 200 tests, granular features, full checkpoint coverage

✅ **Fixes over-engineering for simple projects** - Counter gets 2-3 features instead of 10

✅ **No manual configuration needed** - Automatically detects complexity from discovery conversation

✅ **Transparent heuristics** - User can see `metadata.json` and understand why their project was classified

✅ **Backwards compatible** - Defaults to 'moderate' if metadata.json missing

✅ **Works with existing architecture** - No changes to checkpoint agents, impact agents, or multi-phase orchestration

---

## Alternative: Spec Header Metadata

Instead of separate `metadata.json`, embed in spec header:

```markdown
# Project Specification

> Generated: 2025-12-20T18:15:02.963Z
> Project: C:\Claude_Projects\Claude-cli\test-project
> Complexity: simple
> Discovery Exchanges: 4
> Estimated Features: 2-3

---
```

Then Python agent parses complexity from spec header. **Simpler but less structured.**

---

## Next Steps

1. **Confirm approach** - Metadata file vs spec header?
2. **Implement metadata generation** in discovery-chat-service.ts
3. **Implement metadata reading** in agent.py
4. **Test with test-project** - Should generate 2-3 features
5. **Document heuristics** - What makes a project simple/moderate/complex?

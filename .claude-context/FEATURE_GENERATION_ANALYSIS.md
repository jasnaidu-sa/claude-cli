# Feature Generation Over-Engineering Analysis

**Date**: 2025-12-20
**Issue**: Simple counter component generated 21KB feature_list.json with 10 features

---

## Root Cause Analysis

### The Prompt Instructions

The brownfield initializer prompt (`autonomous-orchestrator/prompts/initializer_prompt_brownfield.md`) contains these directives:

1. **Line 136**: "Keep features small and focused (1-2 hours of work max)"
2. **Line 130**: "Include at least one integration test per feature"
3. **Line 218 in agent.py**: Message says "generate a **comprehensive** feature list"

### The Spec Content

The test-project spec (`test-project/.autonomous/spec.md`) is 125 lines and includes:
- Detailed testing requirements (Jest + RTL)
- Multiple test case specifications (4 test scenarios)
- Component architecture breakdown
- Integration points documentation

### The Result

**Generated Features**:
1. Testing Infrastructure Setup
2. Counter Component State Management
3. Increment Functionality
4. Decrement Functionality
5. Reset Functionality
6. Counter UI Layout and Styling
7. Component Export Configuration
8. Comprehensive Unit Test Suite
9. TypeScript Type Safety
10. Integration Validation

**Estimated Effort**: 3.5-4.5 hours total (per line 373 in feature_list.json)
**Actual Complexity**: Could be built in ~30 minutes

---

## Why This Happened

The agent is following instructions correctly:

✅ Each feature is "small and focused"
✅ Each feature has test cases
✅ Dependencies are properly tracked
✅ Integration points identified
✅ Brownfield considerations followed

**The problem**: Instructions don't account for project complexity. The same granularity is applied to:
- A simple 3-button counter component (this case)
- A complex multi-page authentication system (future case)

---

## Impact

**Positive**:
- Thorough test coverage planning
- Clear dependency tracking
- Checkpoint agents can review each micro-feature
- Granular progress tracking

**Negative**:
- Over-engineering for simple projects
- More checkpoint reviews needed (10 vs 2-3)
- Longer execution time
- Confusing UX for trivial features

---

## Solutions

### Option 1: Project Complexity Detection (Recommended)

Add heuristics to detect project complexity:

```python
def estimate_complexity(spec: str, existing_files: int) -> str:
    """Return 'simple', 'moderate', or 'complex'"""
    spec_lines = len(spec.split('\n'))

    if spec_lines < 100 and existing_files < 10:
        return 'simple'
    elif spec_lines > 300 or existing_files > 50:
        return 'complex'
    return 'moderate'

# In run_generation_phase():
complexity = estimate_complexity(spec, file_count)

if complexity == 'simple':
    message = f"""Generate a focused feature list grouping related functionality.
    For this simple project, create 2-5 features max."""
elif complexity == 'complex':
    message = f"""Generate a comprehensive feature list with granular breakdown.
    Keep features small (1-2 hours) with detailed test coverage."""
```

### Option 2: User-Configurable Granularity

Add UI option in DiscoveryChat or ProjectPicker:

```typescript
interface WorkflowConfig {
  featureGranularity: 'fine' | 'balanced' | 'coarse'
}

// Fine: Current behavior (10 features for counter)
// Balanced: Group related operations (3-5 features for counter)
// Coarse: High-level features only (1-2 features for counter)
```

### Option 3: Modify Prompt Wording

Change line 218 in agent.py:

```python
# Before:
message = f"""Based on this specification, generate a comprehensive feature list

# After:
message = f"""Based on this specification, generate an appropriately-scoped feature list.
For simple projects, group related functionality into 2-5 logical features.
For complex projects, break down into granular features (1-2 hours each)."""
```

### Option 4: Post-Generation Consolidation

Add a consolidation step after generation:

```python
async def consolidate_features(features: List[Dict]) -> List[Dict]:
    """Use Claude to review and consolidate over-granular features."""
    if len(features) > 8:
        # Ask Claude to merge related features
        pass
```

---

## Recommendation

**Implement Option 1 + Option 3 together**:

1. Add complexity detection heuristic
2. Modify generation message to be complexity-aware
3. Test with both simple (counter) and complex (auth system) specs

This preserves the comprehensive approach for complex projects while avoiding over-engineering for simple ones.

---

## Testing Plan

1. **Test Simple Project** (counter component):
   - Target: 2-3 features max
   - Expected: Core functionality, tests, validation

2. **Test Moderate Project** (form with validation):
   - Target: 5-7 features
   - Expected: Balanced granularity

3. **Test Complex Project** (auth system):
   - Target: 10-15 features
   - Expected: Current granular approach

---

## Files to Modify

1. `autonomous-orchestrator/agent.py` (line 218-224)
2. `autonomous-orchestrator/prompts/initializer_prompt_brownfield.md` (add complexity guidance)
3. Optional: `claude-code-manager/src/main/services/orchestrator-runner.ts` (add granularity config)

---

## Next Steps

1. **Confirm approach with user** - Which solution(s) to implement?
2. **Implement chosen solution**
3. **Test with test-project** - Regenerate feature_list.json
4. **Compare results** - Should produce 2-3 features instead of 10
5. **Test implementation phase** - Verify checkpoint agents still work correctly

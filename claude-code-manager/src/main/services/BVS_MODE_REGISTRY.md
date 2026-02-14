# BVS Mode Registry Service

## Overview

The BVS Mode Registry is a state machine that manages mode transitions in the BVS (Bounded Verified Sections) system. It ensures:

- **Valid transitions**: Only allowed mode transitions (e.g., planning → decomposing → executing)
- **Exclusive access**: Only one project/session can be active at a time
- **Context continuity**: Project and session IDs must be consistent across workflow
- **Sub-mode support**: Validating can run as a sub-mode within executing
- **State persistence**: Mode state persists to `.bvs/mode-state.json`

## Modes

| Mode | Description | Can Transition From | Allows Sub-Modes |
|------|-------------|---------------------|------------------|
| **idle** | No active BVS operation | Any mode | None |
| **planning** | PRD analysis and planning | idle, planning | None |
| **decomposing** | Breaking plan into sections | planning, decomposing | None |
| **executing** | Running worker to execute sections | decomposing, executing, integrating | validating |
| **validating** | Quality gates and validation (sub-mode only) | executing | None |
| **integrating** | Merging completed sections | executing, integrating | None |

## Workflow

```
idle → planning → decomposing → executing → integrating → idle
                                    ↓
                                validating (sub-mode)
```

## Usage

### Basic Workflow

```typescript
import { BvsModeRegistry } from './bvs-mode-registry'

const registry = new BvsModeRegistry('/path/to/workspace')

// Start planning
await registry.enterMode('planning', { projectId: 'project-1' })

// Decompose plan
await registry.enterMode('decomposing', { projectId: 'project-1' })

// Execute sections
await registry.enterMode('executing', {
  projectId: 'project-1',
  sessionId: 'session-1'
})

// Validate (as sub-mode)
await registry.enterMode('validating', {
  projectId: 'project-1',
  sessionId: 'session-1'
})

// Exit validation
await registry.exitMode() // Returns to executing

// Integrate
await registry.enterMode('integrating', { projectId: 'project-1' })

// Done
await registry.enterMode('idle')
```

### Checking Before Transitions

```typescript
const result = registry.canEnterMode('executing', {
  projectId: 'project-1',
  sessionId: 'session-1'
})

if (result.allowed) {
  await registry.enterMode('executing', {
    projectId: 'project-1',
    sessionId: 'session-1'
  })
} else {
  console.error(`Cannot enter executing: ${result.reason}`)
  console.error(`Suggestion: ${result.suggestion}`)
}
```

### Subscribing to Changes

```typescript
const unsubscribe = registry.onModeChange((state) => {
  console.log('Mode changed:', state.currentMode)
  console.log('Project:', state.projectId)
  console.log('Session:', state.sessionId)
  console.log('Sub-modes:', state.activeSubModes)
})

// Later, when done
unsubscribe()
```

### Force Reset (Error Recovery)

```typescript
// If system gets into bad state, force reset
await registry.forceReset()
// Now in idle mode, all context cleared
```

## Conflict Detection

The registry prevents invalid transitions:

```typescript
// Start planning for project-1
await registry.enterMode('planning', { projectId: 'project-1' })

// Try to plan different project
await registry.enterMode('planning', { projectId: 'project-2' })
// ❌ Throws ModeConflictError: already in planning mode with different project context
```

```typescript
// In executing mode
await registry.enterMode('executing', {
  projectId: 'project-1',
  sessionId: 'session-1'
})

// Try to jump back to planning
await registry.enterMode('planning', { projectId: 'project-1' })
// ❌ Throws ModeConflictError: Planning can only be entered from: Idle, Planning
```

## State Persistence

Mode state is automatically saved to `.bvs/mode-state.json`:

```json
{
  "currentMode": "executing",
  "enteredAt": "2026-01-29T19:45:00.000Z",
  "projectId": "project-1",
  "sessionId": "session-1",
  "activeSubModes": [],
  "modeData": {
    "customKey": "customValue"
  }
}
```

State is automatically restored on registry initialization.

## Error Handling

```typescript
import { ModeConflictError } from './bvs-mode-registry'

try {
  await registry.enterMode('executing', {
    projectId: 'project-2',
    sessionId: 'session-1'
  })
} catch (error) {
  if (error instanceof ModeConflictError) {
    console.error('Mode conflict:', error.message)
    console.error('Conflicting mode:', error.conflictingMode)
  }
}
```

## Custom Mode Data

You can attach custom data to the mode state:

```typescript
await registry.enterMode('planning', { projectId: 'project-1' })

const state = registry.getState()
state.modeData = {
  planId: 'plan-123',
  version: 1,
  customField: 'value'
}

// Data persists across transitions until returning to idle
await registry.enterMode('decomposing', { projectId: 'project-1' })
console.log(registry.getState().modeData) // Still has planId, version, customField
```

## Testing

Run the comprehensive test suite:

```bash
npx tsx src/main/services/__tests__/manual-test-mode-registry.ts
```

Or with Jest (if configured):

```bash
npm test -- bvs-mode-registry.test.ts
```

## Integration with BVS Orchestrator

The BVS Orchestrator should use the mode registry to:

1. **Enter planning mode** when starting PRD analysis
2. **Enter decomposing mode** when breaking down plan
3. **Enter executing mode** when launching workers
4. **Enter validating sub-mode** when running quality gates
5. **Enter integrating mode** when merging branches
6. **Return to idle** when workflow completes

Example:

```typescript
class BvsOrchestratorService {
  private modeRegistry: BvsModeRegistry

  async startPlanning(projectId: string) {
    // Check if we can enter planning
    const result = this.modeRegistry.canEnterMode('planning', { projectId })
    if (!result.allowed) {
      throw new Error(`Cannot start planning: ${result.reason}`)
    }

    // Enter planning mode
    await this.modeRegistry.enterMode('planning', { projectId })

    // Subscribe to mode changes for UI updates
    this.modeRegistry.onModeChange((state) => {
      this.emitEvent('mode-changed', state)
    })

    // Start planning...
  }
}
```

# context-types.ts

TypeScript type definitions for Context Agent data structures.

## Purpose

Defines TypeScript interfaces matching the Python dataclasses in `context_agent.py`. Useful for:
- Type safety in Electron/TypeScript code
- Future UI features showing context state
- IPC communication (if needed later)

## Key Types

### `RunningSummary`
- **Purpose**: Compressed summary of project state
- **Fields**:
  - `content: string` - Markdown summary text
  - `tokenCount: number` - Estimated token count
  - `updatedAt: number` - Timestamp (ms)
  - `trigger: 'feature_count' | 'category_complete' | 'manual'`
  - `featuresSinceLastUpdate: number`
  - `totalFeaturesCompleted: number`
- **Constraints**: tokenCount < 2000

### `KeyDecision`
- **Purpose**: Critical design decision
- **Fields**:
  - `id: string`
  - `featureId: string`
  - `decision: string`
  - `rationale: string`
  - `impact: string[]`
  - `timestamp: number`
  - `category: 'architecture' | 'security' | 'performance' | 'ux' | 'data' | 'integration' | 'other'`

### `FailureRecord`
- **Purpose**: Failure with root cause
- **Fields**:
  - `id: string`
  - `featureId: string`
  - `description: string`
  - `rootCause: string`
  - `resolution: string`
  - `prevention: string` - How to avoid in future
  - `timestamp: number`
  - `severity: 'low' | 'medium' | 'high' | 'critical'`

### `ActiveConstraint`
- **Purpose**: Active constraint limiting implementation
- **Fields**:
  - `id: string`
  - `description: string`
  - `reason: string`
  - `affectedAreas: string[]`
  - `addedAt: number`
  - `expiresAt?: number` - Optional expiration
  - `type: 'technical' | 'business' | 'security' | 'performance' | 'compatibility' | 'other'`

### `ContextData`
- **Purpose**: Complete context state
- **Fields**:
  - `summary: RunningSummary`
  - `decisions: KeyDecision[]`
  - `failures: FailureRecord[]`
  - `constraints: ActiveConstraint[]`
  - `lastUpdated: number`
  - `projectPath: string`

### `ContextInjection`
- **Purpose**: Context injected into feature prompt
- **Fields**:
  - `summary: string` - Summary text
  - `decisions: KeyDecision[]` - Top 3 relevant
  - `failures: FailureRecord[]` - Top 2 relevant
  - `constraints: ActiveConstraint[]` - All active
  - `tokenCount: number` - Total tokens

## Usage

These types are defined for type safety but Context Agent runs in Python, not TypeScript/Electron.

## Mapping

TypeScript (camelCase) ↔ Python (snake_case):
- `tokenCount` ↔ `token_count`
- `updatedAt` ↔ `updated_at`
- `featuresSinceLastUpdate` ↔ `features_since_last_update`
- etc.

## Related Files

- `autonomous-orchestrator/context_agent.py` - Python implementation
- `context-handlers.ts` - IPC handlers (obsolete)
- `context-agent-runner.ts` - Subprocess runner (obsolete)

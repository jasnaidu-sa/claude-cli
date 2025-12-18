# SpecGenerating.tsx

## Purpose
Phase 3 component for background specification generation. Takes the discovery conversation and generates a detailed spec for execution agents using the Heavy Spec philosophy.

## Interactions

### Store Integration
- Uses `useAutonomousStore` for:
  - `selectedProject` - Current project
  - `chatMessages` - Discovery conversation history
  - `generatedSpec` - Generated specification
  - `setGeneratedSpec` - Update generated spec
  - `goToNextPhase` - Navigate to review phase
  - `updateAgentStatus` - Track spec-builder agent progress

## Data Flow
1. Component mounts and triggers generateSpec()
2. Builds conversation context from chatMessages
3. Generates spec (currently simulated, will use spec-builder agent)
4. Updates generatedSpec in store
5. Auto-advances to spec_review after 1 second

## GeneratedSpec Interface
```typescript
interface GeneratedSpec {
  markdown: string           // Full spec in markdown
  appSpecTxt: string         // app_spec.txt format for orchestrator
  sections: SpecSection[]    // Parsed sections
  featureCount: number       // Number of features
  readyForExecution: boolean // Can proceed to execution
}
```

## UI Elements
- Loading spinner during generation
- Error state with retry button
- Success state showing section/feature counts
- Review Specification button

## Future Integration
Will implement 10 sequential LLM calls per section for detailed spec generation (Heavy Spec philosophy).

## Change History
- 2025-12-18: Created as part of Option C architecture

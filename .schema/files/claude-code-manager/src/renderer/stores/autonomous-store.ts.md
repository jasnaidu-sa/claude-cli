# autonomous-store.ts

## Purpose
Zustand store managing the autonomous workflow state. Central state management for the 8-phase autonomous coding flow including phase navigation, project selection, discovery chat, spec generation, and execution tracking.

## Interactions

### Phase Types (8-Phase Flow)
1. `project_select` - User selects new or existing project
2. `preflight` - Environment validation (venv, schema, MCP)
3. `journey_analysis` - Automatic user journey analysis (brownfield only)
4. `discovery_chat` - User describes requirements (conversation only)
5. `spec_generating` - Background spec generation
6. `spec_review` - User reviews and approves spec
7. `executing` - Python orchestrator running
8. `completed` - All tests pass, ready for commit

### Key Interfaces
- `PreflightStatus` - Environment check results (venvReady, schemaFresh, etc.)
- `JourneyAnalysis` - Brownfield codebase analysis results
- `ConversationSummary` - Running summary for context management
- `DiscoveryReadiness` - Tracks readiness to generate spec
- `SpecGenerationProgress` - Tracks spec generation progress
- `GeneratedSpec` - The generated specification document

### State Slices
- Phase state (currentPhase, selectedProject)
- Discovery state (chatMessages, journeyAnalysis, conversationSummary)
- Spec state (generatedSpec, specGenerationProgress)
- Execution state (workflows, sessionsByWorkflow)
- Agent state (agentStatuses)

### IPC Integration
- Subscribes to workflow and session events from main process
- Calls venv management APIs
- Calls schema validation APIs

## Data Flow
1. User actions trigger phase transitions via goToNextPhase/goToPreviousPhase
2. Phase components read/write state through store actions
3. IPC subscriptions update state from main process events
4. Phase-specific conditions control navigation (canGoBack, canGoForward)

## Change History
- 2025-12-18: Added 8-phase architecture (Option C)
- 2025-12-18: Added PreflightStatus, JourneyAnalysis interfaces
- 2025-12-18: Added MIN_DISCOVERY_MESSAGES = 4
- 2025-12-18: Added phase skipping logic for greenfield projects

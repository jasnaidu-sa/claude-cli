<!-- COMPACTION at 2025-12-18 - Claude MUST resume from this state -->

---
task_id: TASK-20251216-autonomous-coding-system
description: Implement Autonomous Coding System - Electron app for managing Python-based autonomous coding workflows
status: in_progress
priority: P1
created: 2025-12-16T21:30:00Z
updated: 2025-12-18T14:00:00Z

config:
  plan_depth: standard
  scope: full_feature
  testing: comprehensive
  review: full

research:
  context_findings: Found existing Electron app with PTY sessions, git/worktree management, Zustand stores
  schema_findings: Full project documentation exists in .schema/_index.md with IPC channels and architecture
  best_practices: Electron IPC security (context isolation), Python 3.10-3.12 required, MCP stdio mode
  git_history: claude-code-manager has active development, native module fixes applied
  patterns_applied:
    - electron-native-module-pattern
    - IPC security patterns (sender validation)
    - Stream-based log output
---

# Task: Implement Autonomous Coding System

Build an Electron application that manages Python-based autonomous coding workflows for brownfield projects.

## Current Phase: Option C Architecture Implementation

### Architecture Decisions Made

**Option C: Full Architecture Overhaul** was selected with an 8-phase flow:
1. `project_select` - User selects new or existing project
2. `preflight` - Environment validation (venv, schema, MCP)
3. `journey_analysis` - Automatic user journey analysis (brownfield only, skipped for greenfield)
4. `discovery_chat` - User describes what they want (conversation only, NO MCP tools)
5. `spec_generating` - Background spec generation (10 sequential calls per section)
6. `spec_review` - User reviews and approves generated spec
7. `executing` - Python orchestrator running (auto-triggered after approval)
8. `completed` - All tests pass, ready for commit

### Key Design Decisions

1. **Sectioned Spec Generation**: 10 sequential LLM calls per section (Heavy Spec philosophy)
2. **Frontend Agent**: Keyword-triggered (activates on UI/frontend mentions)
3. **Minimum Messages**: 4 user messages before spec generation enabled
4. **Multi-pass Feature Generation**: Yes, for specs > 10 features
5. **Context Management**: Running summary + last 6 messages
6. **Auto-end Detection**: Simple flag with confidence score
7. **Workflow Storage**: Nested folders by date/project

### Files Modified

**autonomous-store.ts** - Core state management:
- Added new phase types: `preflight`, `journey_analysis`, `spec_generating`
- Added interfaces: `PreflightStatus`, `JourneyAnalysis`, `ConversationSummary`, `DiscoveryReadiness`, `SpecGenerationProgress`
- Added `MIN_DISCOVERY_MESSAGES = 4`
- Updated `goToNextPhase`/`goToPreviousPhase` to skip `journey_analysis` for new projects
- Updated `canGoForward` with phase-specific conditions

**AutonomousView.tsx** - Phase router:
- Added PHASE_INFO for all 8 phases
- Added imports for new components
- Updated renderPhaseContent switch statement

**discovery-handlers.ts**:
- Fixed duplicate CREATE_SESSION key issue

**SpecReview.tsx**:
- Added `featureCount` and `readyForExecution` properties to GeneratedSpec objects

### Files Created

1. **PreflightCheck.tsx** - Phase 0b component:
   - Validates venv, schema, MCP, git status
   - Auto-advances after checks pass
   - Shows warnings but doesn't block on them

2. **JourneyAnalysis.tsx** - Phase 1 component:
   - Automatic codebase analysis for brownfield projects
   - Extracts user flows, entry points, data models, patterns
   - Auto-advances after analysis completes

3. **SpecGenerating.tsx** - Phase 3 component:
   - Background spec generation from conversation
   - Shows progress during generation
   - Auto-advances to review when complete

### Build Status

- TypeScript: ✅ Passes (no errors)
- Build: ✅ Succeeds
- Lint: ⚠️ ESLint config needs migration to v9

## Next Steps

1. [ ] Test the complete 8-phase flow in the app
2. [ ] Connect JourneyAnalysis to real research agent (currently simulated)
3. [ ] Connect SpecGenerating to spec-builder agent (currently simulated)
4. [ ] Update DiscoveryChat to remove MCP tool usage (conversation-only)
5. [ ] Add preload APIs: runResearchAgent, saveSpec
6. [ ] Connect SpecReview to Python orchestrator auto-trigger
7. [ ] Implement context management (running summary + last 6 messages)

## Commits Made (This Session)

[Pending commit for Option C architecture]

## Parking Lot

- ESLint needs migration from .eslintrc to eslint.config.js (v9 format)

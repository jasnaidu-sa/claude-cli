<!-- COMPACTION at 2025-12-19 - Claude MUST resume from this state -->

---
task_id: TASK-20251216-autonomous-coding-system
description: Implement Autonomous Coding System - Electron app for managing Python-based autonomous coding workflows
status: in_progress
priority: P1
created: 2025-12-16T21:30:00Z
updated: 2025-12-19T09:30:00Z

config:
  plan_depth: standard
  scope: full_feature
  testing: comprehensive
  review: full
---

# Task: Implement Autonomous Coding System

Build an Electron application that manages Python-based autonomous coding workflows for brownfield projects.

## Current Phase: Option C Architecture - PHASE STRUCTURE COMPLETE

### Recent Commits
- `b903dd6` - docs(schema): update preload/index.ts
- `09c0c6c` - docs(schema): update ProjectPicker.tsx
- `b844a94` - docs(schema): update discovery-handlers.ts
- `66b729a` - docs(schema): update discovery-chat-service.ts + multi-draft feature
- `f5b8a2c` - fix: Journey analysis agent MCP config for Windows shell compatibility
- `b664959` - feat: Implement Option C 8-phase architecture for autonomous workflow

### Architecture Implemented

**Option C: Full Architecture Overhaul** with 8-phase flow:
1. `project_select` - User selects new or existing project ✅
2. `preflight` - Environment validation (venv, schema, MCP) ✅
3. `journey_analysis` - Automatic user journey analysis (brownfield only) ✅
4. `discovery_chat` - User describes what they want ✅
5. `spec_generating` - Background spec generation ✅
6. `spec_review` - User reviews and approves spec ✅
7. `executing` - Python orchestrator running ✅
8. `completed` - All tests pass, ready for commit ✅

### Build Status
- TypeScript: ✅ Passes
- Build: ✅ Succeeds
- Dev Server: ✅ Runs

### Recently Completed Features

#### Multi-Draft Session Support (2025-12-19)
- Draft storage in `.autonomous/drafts/{draft-id}/`
- `DraftMetadata` interface with auto-generated name/description
- Timeline UI in ProjectPicker showing all drafts
- Actions: Continue Latest, Start Fresh, Delete individual drafts
- Archive-on-clear pattern (old sessions saved before clearing)

#### Journey Analysis Fix (2025-12-19)
- Fixed Windows shell escaping with `.mcp-minimal.json` file
- Added `--strict-mcp-config` flag to Claude CLI
- User-journey agent now works for brownfield projects

### Files Created/Modified

**New Components:**
- PreflightCheck.tsx - Environment validation
- JourneyAnalysis.tsx - Brownfield codebase analysis
- SpecGenerating.tsx - Background spec generation

**Modified (Multi-Draft Feature):**
- discovery-chat-service.ts - Draft storage functions (saveDraftToDisk, listDrafts, loadDraft, deleteDraft)
- discovery-handlers.ts - IPC handlers for draft management
- preload/index.ts - DraftMetadata type and API methods
- ProjectPicker.tsx - Timeline dialog UI for draft selection

**Schema Documentation:**
- Created schema docs for 12+ source files

## Next Steps (Integration Work)

1. [x] Connect JourneyAnalysis to real research agent
2. [ ] Connect SpecGenerating to spec-builder agent (currently simulated)
3. [ ] Update DiscoveryChat to fully remove MCP tool usage
4. [ ] Add preload APIs: runResearchAgent, saveSpec
5. [ ] Connect SpecReview to Python orchestrator auto-trigger
6. [ ] Implement context management (running summary + last 6 messages)
7. [ ] Test complete flow end-to-end

## Parking Lot

- ESLint needs migration from .eslintrc to eslint.config.js (v9 format)

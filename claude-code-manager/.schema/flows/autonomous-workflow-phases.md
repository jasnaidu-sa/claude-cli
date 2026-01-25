# Autonomous Workflow Phases

## Overview
BVS execution flow from planning through completion.

## Phases

### 1. Input Phase
- PRD upload OR interactive planning chat
- User provides requirements

### 2. Analysis Phase
- Codebase exploration
- Pattern detection
- Complexity analysis

### 3. Review Phase
- User reviews generated plan
- Approve/modify sections
- Configure execution mode

### 4. Execution Phase
- Parallel worker spawning
- Section implementation with quality gates
- Merge point verification

### 5. Completion Phase
- Final integration tests
- Learning capture
- Session summary

## Key Files
- `src/main/services/bvs-orchestrator-service.ts` - Phase orchestration
- `src/shared/bvs-types.ts` - BvsPhase type

## Updated
2026-01-25

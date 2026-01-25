# PRD: Ralph-Loop Autonomous Execution System

**Project:** Claude Code Manager - Autonomous Section Migration
**Status:** Planning
**Last Updated:** 2025-01-13
**Version:** 1.0

---

## Executive Summary

Migrate the Autonomous section of Claude Code Manager from the current Autocoder system (FastAPI + BrowserView) to a Ralph-Loop based architecture using the Autonomous-Orchestrator. This provides crash-resistant execution, state persistence, human checkpoints, and an intelligent initiator phase.

---

## Problem Statement

### Current State (Autocoder)
- No state persistence - all progress lost on crash
- No resume capability - must restart from beginning
- Limited human intervention - fire-and-forget model
- BrowserView embedding is fragile and hard to customize
- No context management - prone to "lost in the middle" issues
- No intelligent task preparation - user must craft prompts manually

### Desired State (Ralph-Loop)
- Full state persistence in `.autonomous/` directory
- Resume from any checkpoint after crash/restart
- Human checkpoints with risk assessment before risky changes
- Native Electron UI with rich progress visualization
- Compressed context management (2K token limit)
- Initiator phase that converts natural language to optimized prompts

---

## Goals & Success Metrics

### Primary Goals
1. **Crash Resistance** - Zero progress loss on unexpected termination
2. **Human Oversight** - Checkpoints before high-risk operations
3. **Intelligent Preparation** - Convert vague requests to structured prompts
4. **Rich Observability** - Real-time progress with context visibility

### Success Metrics
| Metric | Target | Measurement |
|--------|--------|-------------|
| Resume Success Rate | 100% | Can resume any interrupted session |
| Checkpoint Coverage | >80% high-risk ops | Checkpoints triggered for risk >60 |
| User Satisfaction | 4.5/5 | Survey after feature completion |
| Time to First Result | <5 min | From task description to first feature |

---

## User Stories

### US-1: Initiator Phase
**As a** user with a vague idea
**I want** to describe my task in natural language
**So that** Claude can ask clarifying questions and generate an effective execution plan

**Acceptance Criteria:**
- [ ] User can type free-form task description
- [ ] Claude asks relevant clarifying questions (scope, constraints, success criteria)
- [ ] Requirements are summarized for user approval
- [ ] Optimized ralph-loop prompt is generated with completion promise
- [ ] User can edit prompt before starting execution

### US-2: State Persistence
**As a** user running long tasks
**I want** my progress saved continuously
**So that** I can resume if my computer crashes or I need to stop

**Acceptance Criteria:**
- [ ] Feature status persisted after each completion
- [ ] Context/decisions/failures recorded to files
- [ ] Resume option shown on app restart if interrupted
- [ ] Can resume from specific checkpoint

### US-3: Human Checkpoints
**As a** user concerned about autonomous changes
**I want** to review high-risk operations before they execute
**So that** I can prevent potentially harmful changes

**Acceptance Criteria:**
- [ ] Risk score calculated for each feature (0-100)
- [ ] Soft checkpoint shown for medium risk (40-70)
- [ ] Hard checkpoint (blocks execution) for high risk (>70)
- [ ] User can approve, skip, or reject with feedback
- [ ] Checkpoint decisions logged for audit

### US-4: Progress Visualization
**As a** user monitoring execution
**I want** to see real-time progress with rich detail
**So that** I understand what's happening and estimate completion

**Acceptance Criteria:**
- [ ] Feature list with status indicators
- [ ] Category-based progress bars
- [ ] Current feature name and description shown
- [ ] Stream output visible in real-time
- [ ] Heartbeat indicator shows agent is alive

### US-5: Context Awareness
**As a** developer building complex features
**I want** the agent to remember key decisions and failures
**So that** it doesn't repeat mistakes or contradict itself

**Acceptance Criteria:**
- [ ] Running summary maintained under 2K tokens
- [ ] Key architectural decisions recorded
- [ ] Past failures with root causes tracked
- [ ] Active constraints visible to agent
- [ ] Context injected into each feature prompt

---

## Feature Breakdown

### Phase 0: Initiator System

| Feature | Priority | Status | Notes |
|---------|----------|--------|-------|
| F0.1 - Initiator Chat UI | P0 | Not Started | Chat interface for requirements gathering |
| F0.2 - Question Generation | P0 | Not Started | Claude generates contextual questions |
| F0.3 - Requirements Summary | P0 | Not Started | Structured display of gathered info |
| F0.4 - Prompt Generation | P0 | Not Started | Convert requirements to ralph prompt |
| F0.5 - Complexity Estimation | P1 | Not Started | Auto-set maxIterations based on scope |
| F0.6 - Prompt Editor | P1 | Not Started | Allow manual edits before execution |

### Phase 1: Core Infrastructure

| Feature | Priority | Status | Notes |
|---------|----------|--------|-------|
| F1.1 - Ralph Orchestrator Service | P0 | Not Started | Process spawning and JSON parsing |
| F1.2 - IPC Handlers | P0 | Not Started | start/stop/pause/resume/status |
| F1.3 - Preload API | P0 | Not Started | window.electron.ralph.* methods |
| F1.4 - TypeScript Types | P0 | Not Started | Stream event interfaces |
| F1.5 - Stdin Communication | P1 | Not Started | Checkpoint responses |

### Phase 2: UI Components

| Feature | Priority | Status | Notes |
|---------|----------|--------|-------|
| F2.1 - Execution Dashboard | P0 | Not Started | Main execution UI |
| F2.2 - Progress Panel | P0 | Not Started | Feature list with status |
| F2.3 - Checkpoint Modal | P0 | Not Started | Approve/skip/reject UI |
| F2.4 - Stream Output Viewer | P1 | Not Started | Real-time logs |
| F2.5 - Impact Assessment Panel | P1 | Not Started | Conflict visualization |
| F2.6 - Context Summary Panel | P2 | Not Started | Decisions/failures display |

### Phase 3: State Integration

| Feature | Priority | Status | Notes |
|---------|----------|--------|-------|
| F3.1 - Store Updates | P0 | Not Started | Ralph state slice in Zustand |
| F3.2 - File Watchers | P1 | Not Started | Monitor .autonomous/ changes |
| F3.3 - Resume Logic | P0 | Not Started | Detect and offer resume |
| F3.4 - Feature Flag | P1 | Not Started | Toggle autocoder/ralph |

### Phase 4: Cleanup

| Feature | Priority | Status | Notes |
|---------|----------|--------|-------|
| F4.1 - Remove Autocoder UI Service | P2 | Not Started | After validation |
| F4.2 - Remove Autocoder Handlers | P2 | Not Started | After validation |
| F4.3 - Remove AutocoderEmbedded | P2 | Not Started | After validation |
| F4.4 - Update Documentation | P1 | Not Started | README, guides |

---

## Technical Architecture

### System Flow
```
User Input → Initiator Chat → Requirements Doc → Ralph Prompt
                                                      ↓
                                              Python Orchestrator
                                                      ↓
                                    JSON Stream → Electron Main Process
                                                      ↓
                                              IPC → Renderer UI
```

### Data Flow
```
.autonomous/
├── feature_list.json      ← Updated after each feature
├── state/
│   └── execution-state.json  ← Blackboard for coordination
├── context/
│   ├── running-summary.json  ← Compressed context
│   ├── key-decisions.json
│   └── failure-memory.json
├── checkpoints/
│   └── checkpoint-{id}.json  ← Risk assessments
└── logs/
    └── {feature-id}.json     ← Completion logs
```

### IPC Channels
```typescript
// Initiator
INITIATOR_START, INITIATOR_SEND_MESSAGE, INITIATOR_SUMMARIZE,
INITIATOR_GENERATE_PROMPT, INITIATOR_APPROVE_PROMPT

// Execution
RALPH_START, RALPH_STOP, RALPH_PAUSE, RALPH_RESUME, RALPH_STATUS

// Checkpoints
CHECKPOINT_APPROVE, CHECKPOINT_SKIP, CHECKPOINT_REJECT

// State
STATE_LOAD, STATE_RESUME_FROM
```

---

## Dependencies

### External
- Python 3.10+ (autonomous-orchestrator)
- Claude Agent SDK (initiator chat, orchestrator)
- Node.js (Electron main process)

### Internal
- `autonomous-orchestrator/agent.py` - Core orchestrator
- `autonomous-orchestrator/checkpoint_agent.py` - Risk scoring
- `autonomous-orchestrator/context_agent.py` - Context compression

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Python process crashes | Medium | High | State persistence + auto-resume |
| JSON parsing errors | Low | Medium | Graceful fallback to raw logs |
| Checkpoint timeout | Medium | Low | Auto-skip after 30 min |
| Context token overflow | Low | Medium | Hard limit at 2K tokens |
| Incomplete migration | Medium | High | Feature flag for gradual rollout |

---

## Timeline

| Phase | Scope | Status |
|-------|-------|--------|
| Phase 0 - Initiator | Initiator chat + prompt generation | Not Started |
| Phase 1 - Foundation | Core service + IPC handlers | Not Started |
| Phase 2 - UI | Dashboard + checkpoint modal | Not Started |
| Phase 3 - Integration | Store + resume logic | Not Started |
| Phase 4 - Cleanup | Remove old code | Not Started |

---

## Open Questions

1. Should we support multiple concurrent ralph-loop sessions?
2. How long should checkpoint timeouts be? (Currently 30 min)
3. Should we expose risk threshold as user-configurable?
4. Do we need webhook notifications for progress (like autocoder)?

---

## Changelog

| Date | Version | Changes |
|------|---------|---------|
| 2025-01-13 | 1.0 | Initial PRD created |


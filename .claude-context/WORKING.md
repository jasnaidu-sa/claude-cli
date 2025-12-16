---
task_id: TASK-20251216-autonomous-coding-system
description: Implement Autonomous Coding System - Electron app for managing Python-based autonomous coding workflows
status: in_progress
priority: P1
created: 2025-12-16T21:30:00Z
updated: 2025-12-16T21:30:00Z

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

## Existing Infrastructure (DO NOT REBUILD)

The `claude-code-manager/` already provides:
- Main/Preload/Renderer architecture
- SessionManager with PTY sessions (node-pty)
- GitService with full worktree management
- ConfigStore for settings
- FileWatcher for FS monitoring
- DevServerManager for dev servers
- BrowserBridge for browser integration
- Terminal component (xterm.js)
- WorktreeStore with Zustand
- IPC handlers established

## Plan

### Technical Approach

Extend the existing `claude-code-manager` Electron app with:
1. Python venv management service
2. Python orchestrator integration (spawn autonomous sessions)
3. Workflow management (track `.autonomous/` state)
4. Progress watching (parse `feature_list.json`)
5. Schema validation integration
6. MCP server configuration (Playwright, Supabase)
7. New UI components for autonomous workflow management

## Features (Review Units)

### FEAT-001: Python Venv Management Service
**Type**: backend
**Files**:
  - claude-code-manager/src/main/services/venv-manager.ts (create)
  - claude-code-manager/src/preload/index.ts (modify)
  - claude-code-manager/src/main/ipc/index.ts (modify)
**Subtasks**:
  1. [ ] Create VenvManager class with create/check/install methods
  2. [ ] Implement venv location at ~/.autonomous-coding/venv/
  3. [ ] Add dependency installation (claude-code-sdk, python-dotenv)
  4. [ ] Register IPC handlers for venv operations
  5. [ ] Add preload API for renderer access
**Verification**:
  - [ ] Can create venv if not exists
  - [ ] Can install Python packages
  - [ ] Returns correct Python executable path
**Review Focus**: security, correctness

### FEAT-002: Python Orchestrator Runner Service
**Type**: backend
**Files**:
  - claude-code-manager/src/main/services/orchestrator-runner.ts (create)
  - claude-code-manager/src/shared/types/autonomous.ts (create)
**Subtasks**:
  1. [ ] Create OrchestratorRunner class extending EventEmitter
  2. [ ] Implement spawn method using venv Python
  3. [ ] Add output streaming to renderer via IPC
  4. [ ] Add session lifecycle management (start, pause, stop)
  5. [ ] Parse output for progress events
**Verification**:
  - [ ] Can spawn Python process with correct env vars
  - [ ] Output streams to renderer in real-time
  - [ ] Graceful shutdown on stop
**Review Focus**: security, correctness, performance

### FEAT-003: Workflow Manager Service
**Type**: backend
**Files**:
  - claude-code-manager/src/main/services/workflow-manager.ts (create)
  - claude-code-manager/src/shared/types/autonomous.ts (modify)
**Subtasks**:
  1. [ ] Create WorkflowManager for tracking .autonomous/ state
  2. [ ] Implement workflow CRUD (create, read, update, list)
  3. [ ] Add workflow config parsing (.autonomous/workflows/*.yaml)
  4. [ ] Track workflow status (pending, in_progress, paused, completed)
  5. [ ] Integrate with worktree creation
**Verification**:
  - [ ] Can create new workflow with worktree
  - [ ] Persists workflow state to YAML files
  - [ ] Lists all workflows for a project
**Review Focus**: data-integrity, correctness

### FEAT-004: Progress Watcher Service
**Type**: backend
**Files**:
  - claude-code-manager/src/main/services/progress-watcher.ts (create)
**Subtasks**:
  1. [ ] Create ProgressWatcher using chokidar
  2. [ ] Watch feature_list.json for changes
  3. [ ] Parse test completion (passes: true/false)
  4. [ ] Calculate completion percentage by category
  5. [ ] Emit progress events to renderer
**Verification**:
  - [ ] Detects feature_list.json changes
  - [ ] Correctly calculates pass/fail counts
  - [ ] Updates UI in real-time
**Review Focus**: correctness, performance

### FEAT-005: Python Orchestrator Code
**Type**: backend
**Files**:
  - autonomous-orchestrator/autonomous_agent_demo.py (create)
  - autonomous-orchestrator/agent.py (create)
  - autonomous-orchestrator/client.py (create)
  - autonomous-orchestrator/security.py (create)
  - autonomous-orchestrator/config.py (create)
**Subtasks**:
  1. [ ] Create entry point (autonomous_agent_demo.py)
  2. [ ] Implement session loop (agent.py)
  3. [ ] Create Claude SDK client with MCP config (client.py)
  4. [ ] Add bash security allowlist (security.py)
  5. [ ] Implement configuration loading (config.py)
**Verification**:
  - [ ] Can run autonomously with test spec
  - [ ] MCP servers (Playwright, Supabase) connect
  - [ ] Respects bash security rules
**Review Focus**: security, correctness, architecture

### FEAT-006: Brownfield Prompt Templates
**Type**: config
**Files**:
  - autonomous-orchestrator/prompts/schema_validation_prompt.md (create)
  - autonomous-orchestrator/prompts/initializer_prompt_brownfield.md (create)
  - autonomous-orchestrator/prompts/coding_prompt_brownfield.md (create)
**Subtasks**:
  1. [ ] Create schema validation prompt (Phase 0)
  2. [ ] Create test generation prompt (Phase 1)
  3. [ ] Create implementation prompt (Phase 2+)
  4. [ ] Add existing pattern references
**Verification**:
  - [ ] Prompts follow spec requirements
  - [ ] All brownfield-specific instructions included
**Review Focus**: conventions, correctness

### FEAT-007: Schema Validator Integration
**Type**: integration
**Files**:
  - claude-code-manager/src/main/services/schema-validator.ts (create)
**Subtasks**:
  1. [ ] Create SchemaValidator service
  2. [ ] Implement validation trigger (runs orchestrator with validation prompt)
  3. [ ] Parse validation results from .autonomous/schema_validation.json
  4. [ ] Add IPC handlers for validation status
**Verification**:
  - [ ] Triggers schema validation phase
  - [ ] Reports discrepancies correctly
  - [ ] Stores results for UI display
**Review Focus**: correctness, data-integrity

### FEAT-008: Autonomous Store (Zustand)
**Type**: ui
**Files**:
  - claude-code-manager/src/renderer/stores/autonomous-store.ts (create)
**Subtasks**:
  1. [ ] Create Zustand store for autonomous workflow state
  2. [ ] Add workflow list management
  3. [ ] Add progress tracking state
  4. [ ] Add orchestrator output state
  5. [ ] Add schema validation status
**Verification**:
  - [ ] State updates trigger UI re-renders
  - [ ] Persists relevant state across sessions
**Review Focus**: conventions, simplicity

### FEAT-009: Workflow List Component
**Type**: ui
**Files**:
  - claude-code-manager/src/renderer/components/autonomous/WorkflowList.tsx (create)
  - claude-code-manager/src/renderer/components/autonomous/WorkflowCard.tsx (create)
  - claude-code-manager/src/renderer/components/autonomous/WorkflowCreate.tsx (create)
**Subtasks**:
  1. [ ] Create WorkflowList component showing all workflows
  2. [ ] Create WorkflowCard with status/progress indicators
  3. [ ] Create WorkflowCreate modal for new workflows
  4. [ ] Add workflow selection handling
**Verification**:
  - [ ] Shows all workflows for selected project
  - [ ] Displays correct progress percentages
  - [ ] Can create new workflow
**Review Focus**: conventions, simplicity, typescript

### FEAT-010: Progress Panel Component
**Type**: ui
**Files**:
  - claude-code-manager/src/renderer/components/autonomous/ProgressPanel.tsx (create)
  - claude-code-manager/src/renderer/components/autonomous/CategoryProgress.tsx (create)
**Subtasks**:
  1. [ ] Create ProgressPanel with overall progress bar
  2. [ ] Create CategoryProgress table showing per-category stats
  3. [ ] Add current test indicator
  4. [ ] Add session info display
**Verification**:
  - [ ] Updates in real-time as tests pass
  - [ ] Shows correct category breakdown
**Review Focus**: conventions, simplicity

### FEAT-011: Spec Editor Component
**Type**: ui
**Files**:
  - claude-code-manager/src/renderer/components/autonomous/SpecEditor.tsx (create)
**Subtasks**:
  1. [ ] Create multi-line text area for spec input
  2. [ ] Add file import button (load from .md)
  3. [ ] Add save to .autonomous/app_spec.txt
  4. [ ] Add edit mode toggle
**Verification**:
  - [ ] Can input spec manually
  - [ ] Can import from file
  - [ ] Saves correctly
**Review Focus**: conventions, simplicity

### FEAT-012: Output Viewer Component
**Type**: ui
**Files**:
  - claude-code-manager/src/renderer/components/autonomous/OutputViewer.tsx (create)
**Subtasks**:
  1. [ ] Create scrolling log display
  2. [ ] Add timestamp formatting
  3. [ ] Add expand/collapse functionality
  4. [ ] Add clear button
**Verification**:
  - [ ] Shows orchestrator output in real-time
  - [ ] Handles large output efficiently
**Review Focus**: performance, simplicity

### FEAT-013: Control Panel Component
**Type**: ui
**Files**:
  - claude-code-manager/src/renderer/components/autonomous/ControlPanel.tsx (create)
**Subtasks**:
  1. [ ] Create Start/Pause/Stop buttons
  2. [ ] Add model selector dropdown
  3. [ ] Add schema revalidate button
  4. [ ] Show session stats (duration, cost estimate)
**Verification**:
  - [ ] Buttons trigger correct orchestrator actions
  - [ ] Shows accurate session info
**Review Focus**: conventions, simplicity

### FEAT-014: Main UI Integration
**Type**: ui
**Files**:
  - claude-code-manager/src/renderer/App.tsx (modify)
  - claude-code-manager/src/renderer/components/layout/Sidebar.tsx (modify)
**Subtasks**:
  1. [ ] Add Autonomous mode to sidebar navigation
  2. [ ] Create AutonomousView combining all autonomous components
  3. [ ] Wire up IPC listeners for progress/output updates
  4. [ ] Add project selection for autonomous mode
**Verification**:
  - [ ] Can switch to Autonomous mode from sidebar
  - [ ] All components render correctly
  - [ ] IPC events update UI
**Review Focus**: architecture, conventions

### FEAT-015: Global Configuration
**Type**: config
**Files**:
  - autonomous-orchestrator/config/global_config.yaml (create)
  - claude-code-manager/src/main/services/config-store.ts (modify)
**Subtasks**:
  1. [ ] Define global config schema (models, behavior, MCP)
  2. [ ] Add config migration for new settings
  3. [ ] Expose config through IPC
**Verification**:
  - [ ] Config loads on app start
  - [ ] Settings persist correctly
**Review Focus**: correctness, conventions

### FEAT-016: E2E Testing Setup
**Type**: testing
**Files**:
  - claude-code-manager/tests/e2e/autonomous-workflow.spec.ts (create)
  - claude-code-manager/tests/e2e/venv-management.spec.ts (create)
**Subtasks**:
  1. [ ] Set up Playwright for Electron testing
  2. [ ] Write E2E tests for workflow creation
  3. [ ] Write E2E tests for venv management
  4. [ ] Write E2E tests for progress tracking
**Verification**:
  - [ ] All E2E tests pass
  - [ ] Coverage meets requirements
**Review Focus**: correctness

## Success Criteria
- [ ] All features implemented and reviewed
- [ ] All tests pass
- [ ] E2E verification complete
- [ ] No regressions in existing functionality

## Risks
- Python 3.13 incompatibility: Mitigated by enforcing 3.10-3.12
- MCP server startup latency: May need connection pooling
- Large output handling: Use streaming with backpressure

## Current Feature
Index: 0
ID: FEAT-001
Name: Python Venv Management Service
Phase: pending

## Discoveries (Parking Lot)
[None yet]

## Work Log
- 2025-12-16T21:30:00Z Task created
- 2025-12-16T21:30:00Z Research completed (4 agents)
- 2025-12-16T21:30:00Z Plan created with 16 features

## Commits
[None yet]

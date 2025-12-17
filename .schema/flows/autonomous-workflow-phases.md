# Autonomous Coding Workflow Phases

## Overview

The Autonomous Coding system follows a 5-phase workflow that guides users from project selection through completion. All intelligence and planning happens in the early phases, while execution is handled by "dumb worker" agents that simply follow the detailed specification.

## Phase Flow

```
project_select → discovery_chat → spec_review → executing → completed
```

## Phase Details

### Phase 1: Project Selection (`project_select`)

**Purpose**: User chooses between creating a new project or enhancing an existing one.

**UI Component**: `ProjectPicker.tsx`

**Actions**:
- Select existing project from recent list
- Browse for existing project folder
- Create new greenfield project

**Exit Condition**: Project selected and `selectedProject` state populated

### Phase 2: Discovery Chat (`discovery_chat`)

**Purpose**: User describes what they want to build through conversational interface. Research agents analyze requirements and codebase.

**UI Component**: `DiscoveryChat.tsx`

**Research Agents** (run in background):
1. **Process Agent**: Works through user journey, asks clarifying questions
2. **Codebase Analyzer**: Extracts patterns, conventions, file structure
3. **Best Practices Researcher**: Fetches current industry standards
4. **Spec Builder**: Assembles findings into comprehensive spec

**Exit Condition**: Spec generated and ready for review

### Phase 3: Spec Review (`spec_review`)

**Purpose**: User reviews, edits, and approves the generated specification before execution begins.

**UI Component**: `SpecReview.tsx`

**Features**:
- Markdown viewer/editor for human-readable spec
- Validation status panel
- Edit capability for refinements
- Approve & Start button

**Exit Condition**: User approves spec

### Phase 4: Executing (`executing`)

**Purpose**: Python orchestrator runs with Initializer Agent + Coding Agent following the approved spec.

**UI Component**: `ExecutionDashboard.tsx`

**Process**:
1. Spec converted to `app_spec.txt` format
2. Git worktree created for isolation
3. Initializer Agent creates `feature_list.json` (200+ tests)
4. Coding Agent implements tests one-by-one
5. Commits at checkpoints

**Exit Condition**: All tests pass (100% completion)

### Phase 5: Completed (`completed`)

**Purpose**: Show final results and offer commit strategy options.

**UI Component**: `CompletionSummary.tsx`

**Commit Options**:
- Squash into single commit
- Squash by category
- Keep all checkpoint commits

**Actions**:
- View full report
- Complete & commit
- Start new project

## State Management

State is managed in `autonomous-store.ts` using Zustand:

```typescript
// Phase state
currentPhase: AutonomousPhase
selectedProject: SelectedProject | null
chatMessages: ChatMessage[]
agentStatuses: AgentStatus[]
generatedSpec: GeneratedSpec | null

// Phase actions
setPhase(phase)
goToNextPhase()
goToPreviousPhase()
resetPhaseState()
canGoBack()
canGoForward()
```

## Navigation Rules

- **Back navigation**: Only allowed from `discovery_chat` and `spec_review`
- **Forward navigation**: Controlled by phase completion logic
- **Reset**: Available from any phase except `project_select`

## Heavy Spec Architecture

The key insight is that all intelligence is front-loaded into the planning phases:

1. **Planning Phase (UI)**: Contains all research, pattern extraction, and spec building
2. **Execution Phase (Python)**: "Dumb workers" that follow the detailed spec exactly

The spec includes:
- Complete file paths and structure
- Exact code patterns to follow
- All conventions and standards
- Verification steps for each feature
- Dependencies and integrations

This architecture ensures the Python agents don't need to make decisions - they just implement what's specified.

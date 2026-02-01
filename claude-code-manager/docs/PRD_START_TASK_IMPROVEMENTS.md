# PRD: Start-Task Autonomous Agent Improvements

**Version:** 1.1
**Date:** 2026-02-01
**Author:** Claude Code Manager Team
**Status:** Draft

**Changelog:**
- v1.1: Added User Workflow Agent (3.8), Operational Verification (3.9), Database Migration Integration (3.10)

---

## 1. Executive Summary

This PRD outlines improvements to the start-task (Task tool) autonomous agent system, drawing insights from the BVS (Bounded Verified Sections) implementation. The goal is to enhance the Task tool's reliability, quality assurance, and autonomous capabilities while maintaining its simplicity and flexibility.

### Vision
Transform start-task from a "fire and forget" agent spawner into an **intelligent autonomous execution system** that plans before acting, verifies its work, learns from failures, and adapts its approach.

### Goals
- Add optional structured planning before execution
- Integrate quality gates for verification
- Implement goal review to verify intent (not just compilation)
- Add complexity-aware model selection
- Enable multi-agent collaboration patterns
- Provide execution observability and control

### Success Metrics
- 40% reduction in task failures requiring manual intervention
- 30% reduction in token usage through smarter model selection
- 90%+ goal achievement rate (implementation matches intent)
- 50% reduction in "works but wrong" outcomes

---

## 2. Problem Statement

### Current Limitations

| Issue | Description | Impact |
|-------|-------------|--------|
| **No planning phase** | Tasks jump straight to execution | Wrong approach, wasted tokens |
| **No verification** | Success = no errors thrown | Bugs slip through |
| **No goal review** | Technical success ≠ user success | "Works but wrong" outcomes |
| **Fixed model** | Same model for all tasks | Overspend on simple tasks |
| **No learning** | Each task starts fresh | Same mistakes repeated |
| **Limited observability** | Output only, no structure | Hard to debug failures |

### User Pain Points

1. **"It compiled but doesn't do what I asked"** - No intent verification
2. **"It used 50 turns on a simple task"** - No complexity awareness
3. **"It made the same mistake three times"** - No learning from failures
4. **"I can't tell what it's doing"** - Limited progress visibility
5. **"It went off on a tangent"** - No scope boundaries

---

## 3. Requirements

### 3.1 Structured Planning Mode

**Priority:** P0 - Critical
**Effort:** Medium

#### Description
Add an optional planning phase that analyzes the task, explores the codebase, and creates a structured execution plan before taking action.

#### Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| PLN-001 | Optional `plan: true` parameter to enable planning | Must |
| PLN-002 | Silent codebase exploration before execution | Must |
| PLN-003 | Generate structured sections/steps | Must |
| PLN-004 | User approval checkpoint before execution | Should |
| PLN-005 | Skip planning for simple tasks (<3 files) | Should |
| PLN-006 | Plan caching for repeated similar tasks | Could |

#### API Enhancement

```typescript
// Current API
await Task({
  subagent_type: 'general-purpose',
  prompt: 'Add user authentication'
})

// Enhanced API with planning
await Task({
  subagent_type: 'general-purpose',
  prompt: 'Add user authentication',
  plan: true,  // NEW: Enable planning mode
  plan_options: {
    approve_before_execute: true,  // Pause for user approval
    max_sections: 10,              // Limit plan complexity
    exploration_depth: 'medium'    // quick | medium | thorough
  }
})
```

#### Planning Output Structure

```typescript
interface TaskPlan {
  id: string
  summary: string
  sections: Array<{
    id: string
    name: string
    description: string
    files: string[]
    estimatedTurns: number
    dependencies: string[]
  }>
  totalEstimatedTurns: number
  estimatedCost: number
  risks: string[]
  alternatives?: Array<{
    name: string
    description: string
    tradeoffs: string
  }>
}
```

#### Planning System Prompt

```
You are a planning agent. Before executing the user's request, you must:

1. EXPLORE the codebase silently (use tools, don't output results)
2. UNDERSTAND existing patterns, conventions, and architecture
3. IDENTIFY files that will need to be created or modified
4. DECOMPOSE the task into atomic steps
5. ESTIMATE effort for each step
6. IDENTIFY risks and alternatives

Output a structured plan in JSON format:
{
  "summary": "Brief description of approach",
  "sections": [...],
  "risks": [...],
  "alternatives": [...]
}

Do NOT start implementing until the plan is approved.
```

#### User Interaction

```
User: Add user authentication

Agent: I'll analyze the codebase and create a plan...

[Planning Phase - 30 seconds]

EXECUTION PLAN:
━━━━━━━━━━━━━━━
Summary: Implement JWT-based authentication with Supabase

Sections:
1. Database Schema (2 turns) - Create auth tables
2. API Routes (4 turns) - Login, logout, refresh endpoints
3. Middleware (3 turns) - Auth middleware for protected routes
4. Frontend Integration (5 turns) - Login form, auth context

Estimated: 14 turns, ~$0.35
Risks: Existing session handling may need migration

[Approve] [Modify] [Cancel]
```

#### Acceptance Criteria
- [ ] Planning completes in <60 seconds
- [ ] Plan accurately identifies files to modify
- [ ] User can approve/modify/cancel plan
- [ ] Simple tasks auto-skip planning
- [ ] Plan shown in structured UI format

---

### 3.2 Quality Gates Integration

**Priority:** P0 - Critical
**Effort:** Medium

#### Description
Add configurable quality gates that run after task completion to verify the work before reporting success.

#### Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| QG-001 | Optional quality gates parameter | Must |
| QG-002 | Support: typecheck, lint, tests, build | Must |
| QG-003 | Auto-fix for lint issues | Must |
| QG-004 | Fail task if gates fail (configurable) | Must |
| QG-005 | Show gate results in output | Must |
| QG-006 | Custom gate commands | Should |
| QG-007 | Gate-specific retry attempts | Should |

#### API Enhancement

```typescript
await Task({
  subagent_type: 'general-purpose',
  prompt: 'Add user authentication',
  quality_gates: {
    typecheck: true,        // Run tsc --noEmit
    lint: true,             // Run eslint (with auto-fix)
    tests: true,            // Run npm test
    build: false,           // Skip build verification
    custom: [               // Custom gates
      { name: 'e2e', command: 'npm run test:e2e' }
    ],
    fail_on_gate_error: true,  // Fail task if gates fail
    max_fix_attempts: 3        // Retry fix attempts
  }
})
```

#### Gate Execution Flow

```
Task Execution
     ↓
[TypeCheck Gate] ──fail──→ [Auto-Fix Attempt] ──→ [Re-check]
     │                                                  │
     pass                                          fail (max attempts)
     ↓                                                  ↓
[Lint Gate] ──fail──→ [Auto-Fix (eslint --fix)] ──→ [Re-check]
     │                                                  │
     pass                                          fail
     ↓                                                  ↓
[Test Gate] ──fail──→ [Report Failure]            [Report Failure]
     │
     pass
     ↓
[SUCCESS]
```

#### Output Enhancement

```
Task completed with quality verification:

Quality Gates:
✓ TypeCheck   Passed (0 errors)
✓ Lint        Passed (3 auto-fixed)
✗ Tests       Failed (2 failing)
  └─ AuthService.test.ts:45 - Expected token to be defined
  └─ AuthService.test.ts:72 - Login should return user

[Retry with fixes] [Mark complete anyway] [View details]
```

#### Acceptance Criteria
- [ ] All 4 built-in gates functional
- [ ] Auto-fix resolves 80%+ of lint issues
- [ ] Custom gates execute correctly
- [ ] Gate failures clearly reported
- [ ] Fix attempts don't exceed limit

---

### 3.3 Goal Review (Intent Verification)

**Priority:** P0 - Critical
**Effort:** Medium

#### Description
After task completion, verify that the implementation actually achieves what the user requested - not just that it compiles.

#### Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| GR-001 | Optional goal review after completion | Must |
| GR-002 | Extract requirements from original prompt | Must |
| GR-003 | Verify each requirement is addressed | Must |
| GR-004 | Detect scope creep (extras not requested) | Should |
| GR-005 | Detect scope reduction (missing features) | Should |
| GR-006 | Provide verdict: APPROVED/PARTIAL/REJECTED | Must |
| GR-007 | Auto-retry on REJECTED (configurable) | Should |

#### API Enhancement

```typescript
await Task({
  subagent_type: 'general-purpose',
  prompt: 'Add user authentication with email/password login',
  goal_review: {
    enabled: true,
    requirements: [  // Optional explicit requirements
      'Users can register with email and password',
      'Users can log in with email and password',
      'Passwords are hashed before storage',
      'JWT tokens are used for session management'
    ],
    auto_retry_on_reject: true,
    max_review_attempts: 2
  }
})
```

#### Goal Review System Prompt

```
You are a goal reviewer. Your job is to verify that the implementation
matches the ORIGINAL USER INTENT.

ORIGINAL REQUEST:
{original_prompt}

EXPLICIT REQUIREMENTS:
{requirements}

FILES CHANGED:
{files_changed}

TASK:
1. For each requirement, determine if it was:
   - IMPLEMENTED: Fully addressed in the code
   - PARTIAL: Partially addressed
   - MISSING: Not addressed at all

2. Check for SCOPE CREEP:
   - Features added that were NOT requested
   - Over-engineering beyond requirements

3. Check for SCOPE REDUCTION:
   - Features that WERE requested but not implemented

4. Provide a VERDICT:
   - APPROVED: All requirements met
   - PARTIAL: Some requirements missing
   - REJECTED: Critical requirements missing

Output JSON:
{
  "verdict": "APPROVED|PARTIAL|REJECTED",
  "requirements_status": [
    { "requirement": "...", "status": "IMPLEMENTED|PARTIAL|MISSING", "evidence": "..." }
  ],
  "scope_creep": ["..."],
  "scope_reduction": ["..."],
  "summary": "..."
}
```

#### Output Enhancement

```
Goal Review:
━━━━━━━━━━━━

Verdict: PARTIAL

Requirements:
✓ Users can register with email/password
✓ Users can log in with email/password
✓ Passwords are hashed (using bcrypt)
✗ JWT tokens for session management
  └─ Implementation uses session cookies instead

Scope Creep:
⚠ Added "Remember Me" feature (not requested)

Recommendation: Implement JWT tokens or confirm session cookies are acceptable.

[Accept as-is] [Retry with feedback] [View implementation]
```

#### Acceptance Criteria
- [ ] Requirements extracted from prompt accurately
- [ ] Each requirement verified against code
- [ ] Scope creep/reduction detected
- [ ] Verdict reflects actual implementation state
- [ ] Auto-retry improves outcome

---

### 3.4 Complexity-Aware Model Selection

**Priority:** P1 - High
**Effort:** Small

#### Description
Automatically select the appropriate model (Haiku vs Sonnet) based on task complexity, reducing cost for simple tasks.

#### Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| MOD-001 | Analyze task complexity before execution | Must |
| MOD-002 | Select Haiku for simple tasks (score ≤4) | Must |
| MOD-003 | Select Sonnet for complex tasks (score >4) | Must |
| MOD-004 | Allow manual model override | Must |
| MOD-005 | Show model selection reasoning | Should |
| MOD-006 | Learn from model selection outcomes | Could |

#### Complexity Factors

| Factor | Weight | Description |
|--------|--------|-------------|
| File count | 0.5/file | More files = more complexity |
| File types | Variable | Tests +0.5, API +1.0, DB +1.5 |
| Keywords | Variable | "refactor" +1.0, "integrate" +1.5 |
| Codebase size | 0-2 | Large codebases need more context |
| Dependencies | 0.3/dep | Cross-module work harder |

#### Scoring Algorithm

```typescript
function calculateComplexity(prompt: string, codebaseInfo: CodebaseInfo): number {
  let score = 1.0  // Base score

  // Keyword analysis
  const keywords = {
    simple: ['fix typo', 'add comment', 'rename', 'update text'],      // -1.0
    moderate: ['add function', 'create component', 'add test'],        // +1.0
    complex: ['refactor', 'integrate', 'migrate', 'redesign'],         // +2.0
    very_complex: ['architecture', 'rewrite', 'multi-service']         // +3.0
  }

  // File estimation from prompt
  const estimatedFiles = estimateFileCount(prompt)
  score += estimatedFiles * 0.5

  // Keyword matching
  for (const [level, words] of Object.entries(keywords)) {
    if (words.some(w => prompt.toLowerCase().includes(w))) {
      score += { simple: -1, moderate: 1, complex: 2, very_complex: 3 }[level]
    }
  }

  // Codebase factor
  if (codebaseInfo.totalFiles > 500) score += 1.0
  if (codebaseInfo.hasDatabase) score += 0.5
  if (codebaseInfo.hasTests) score += 0.5

  return Math.max(1, Math.min(10, score))
}
```

#### API Enhancement

```typescript
await Task({
  subagent_type: 'general-purpose',
  prompt: 'Fix typo in README',
  model: 'auto'  // NEW: Auto-select based on complexity
})

// Result: Uses Haiku (complexity score: 1.5)

await Task({
  subagent_type: 'general-purpose',
  prompt: 'Refactor authentication to use OAuth2',
  model: 'auto'
})

// Result: Uses Sonnet (complexity score: 7.2)
```

#### Output Enhancement

```
Model Selection:
━━━━━━━━━━━━━━━━
Complexity Score: 2.3 (Simple)
Selected Model: Haiku

Factors:
- Estimated files: 1 (+0.5)
- Keywords: "fix typo" (-1.0)
- Codebase size: small (+0)

Estimated cost: $0.02-0.05
```

#### Acceptance Criteria
- [ ] Complexity scoring accurate within 20%
- [ ] Haiku used for 60%+ of simple tasks
- [ ] Cost reduction of 30%+ for simple tasks
- [ ] No quality degradation for simple tasks
- [ ] Manual override available

---

### 3.5 Multi-Agent Collaboration

**Priority:** P1 - High
**Effort:** Large

#### Description
Enable multiple specialized agents to work together on complex tasks, with defined roles and communication patterns.

#### Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| MAC-001 | Define agent collaboration patterns | Must |
| MAC-002 | Planner → Executor → Reviewer pipeline | Must |
| MAC-003 | Parallel specialist agents | Should |
| MAC-004 | Agent result aggregation | Must |
| MAC-005 | Inter-agent context passing | Should |
| MAC-006 | Collaboration visualization | Could |

#### Collaboration Patterns

**Pattern 1: Sequential Pipeline**
```
[Planner] → [Executor] → [Reviewer] → [Fixer] → [Reviewer] → Done
```

**Pattern 2: Parallel Specialists**
```
                    ┌→ [Security Reviewer] ─┐
[Executor] ────────→├→ [Type Reviewer]     ─┼→ [Aggregator] → Done
                    └→ [Style Reviewer]    ─┘
```

**Pattern 3: Architect-Worker**
```
[Architect] → creates plan
     ↓
[Worker 1] ──┬── parallel execution
[Worker 2] ──┤
[Worker 3] ──┘
     ↓
[Integrator] → merges results
```

#### API Enhancement

```typescript
await Task({
  subagent_type: 'general-purpose',
  prompt: 'Add user authentication',
  collaboration: {
    pattern: 'pipeline',  // pipeline | parallel | architect-worker
    agents: [
      { role: 'planner', model: 'haiku' },
      { role: 'executor', model: 'sonnet' },
      { role: 'reviewer', model: 'haiku', parallel: true,
        variants: ['security', 'types', 'style'] }
    ]
  }
})
```

#### Context Passing

```typescript
interface AgentContext {
  previousAgent: string
  previousOutput: string
  sharedState: Record<string, unknown>
  filesModified: string[]
  issuesFound: Issue[]
}

// Each agent receives context from previous agents
const executorPrompt = `
Previous agent (Planner) output:
${context.previousOutput}

Your task: Execute the plan above.
`
```

#### Acceptance Criteria
- [ ] Pipeline pattern working end-to-end
- [ ] Parallel reviewers aggregate correctly
- [ ] Context passes between agents
- [ ] Total cost tracked across all agents
- [ ] Visualization shows agent flow

---

### 3.6 Execution Observability

**Priority:** P1 - High
**Effort:** Medium

#### Description
Provide detailed visibility into task execution for debugging and monitoring.

#### Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| OBS-001 | Structured execution log | Must |
| OBS-002 | Tool call visibility | Must |
| OBS-003 | Token usage per phase | Must |
| OBS-004 | Time tracking per step | Must |
| OBS-005 | Execution replay capability | Should |
| OBS-006 | Export execution report | Should |

#### Execution Log Structure

```typescript
interface ExecutionLog {
  taskId: string
  startTime: number
  endTime: number
  phases: Array<{
    name: string
    agent: string
    model: string
    startTime: number
    endTime: number
    tokensUsed: { input: number; output: number }
    cost: number
    toolCalls: Array<{
      tool: string
      input: Record<string, unknown>
      output: string
      duration: number
    }>
    output: string
  }>
  totalCost: number
  totalTokens: { input: number; output: number }
  result: 'success' | 'failure' | 'partial'
  filesChanged: string[]
  qualityGates?: QualityGateResult[]
  goalReview?: GoalReviewResult
}
```

#### UI Enhancement

```
Task Execution Log
━━━━━━━━━━━━━━━━━━

Task: Add user authentication
Status: Completed (partial success)
Duration: 2m 34s
Cost: $0.47

Timeline:
├─ [0:00] Planning (Haiku)
│  ├─ list_files("src/**/*.ts") → 47 files
│  ├─ read_file("src/auth/index.ts") → 234 lines
│  └─ Output: 5-section plan
│  └─ Tokens: 1,247 in / 892 out ($0.03)
│
├─ [0:28] Execution (Sonnet)
│  ├─ write_file("src/auth/jwt.ts")
│  ├─ edit_file("src/auth/index.ts")
│  ├─ write_file("src/auth/middleware.ts")
│  └─ Tokens: 8,432 in / 3,211 out ($0.38)
│
├─ [1:45] Quality Gates
│  ├─ ✓ TypeCheck (0 errors)
│  ├─ ✓ Lint (2 auto-fixed)
│  └─ ✗ Tests (1 failing)
│
└─ [2:15] Goal Review
   ├─ ✓ JWT authentication
   ├─ ✓ Login endpoint
   └─ ✗ Refresh token (missing)

[Export Report] [Replay Execution] [View Raw Log]
```

#### Acceptance Criteria
- [ ] All tool calls logged with timing
- [ ] Token usage accurate per phase
- [ ] Execution can be replayed
- [ ] Report exportable as JSON/Markdown
- [ ] Real-time log streaming

---

### 3.7 Learning from Failures

**Priority:** P2 - Medium
**Effort:** Medium

#### Description
Learn from task failures to improve future executions, building a knowledge base of patterns and solutions.

#### Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| LRN-001 | Capture failure patterns | Must |
| LRN-002 | Store successful recovery strategies | Must |
| LRN-003 | Apply learnings to similar tasks | Must |
| LRN-004 | Learning decay over time | Should |
| LRN-005 | Cross-project learning | Should |
| LRN-006 | Learning management UI | Could |

#### Learning Entry Structure

```typescript
interface LearningEntry {
  id: string
  timestamp: number
  taskPattern: string  // e.g., "add-authentication"
  failureType: string  // e.g., "import-error", "type-mismatch"
  rootCause: string
  recoveryStrategy: string
  successRate: number  // How often this strategy works
  applicability: {
    frameworks: string[]  // e.g., ["nextjs", "react"]
    patterns: string[]    // e.g., ["auth", "api"]
  }
}
```

#### Application Flow

```
New Task
    ↓
[Query Learnings]
    ↓
Found 3 relevant learnings:
1. "auth tasks often fail due to missing env vars" (85% success)
2. "JWT implementation needs refresh token handling" (72% success)
3. "Supabase auth requires specific import pattern" (90% success)
    ↓
[Inject into Task Prompt]
    ↓
"When implementing authentication:
 - Check for AUTH_SECRET env var first
 - Include refresh token logic
 - Use 'import { createClient } from @supabase/supabase-js'"
```

#### Acceptance Criteria
- [ ] Failures captured with root cause
- [ ] Successful strategies recorded
- [ ] Relevant learnings surfaced for new tasks
- [ ] Learning improves success rate over time
- [ ] Old learnings decay appropriately

---

### 3.8 User Workflow Agent (Planning Phase)

**Priority:** P0 - Critical
**Effort:** Medium

#### Description
During the planning phase, a specialized User Workflow Agent maps out the complete user journey to ensure the planned functionality integrates properly into the application's existing workflow. This prevents building features that technically work but don't fit into how users actually interact with the application.

#### Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| UWA-001 | Analyze existing user workflows in the application | Must |
| UWA-002 | Map new functionality to user journey touchpoints | Must |
| UWA-003 | Identify entry points (how users access new feature) | Must |
| UWA-004 | Identify exit points (where users go after using feature) | Must |
| UWA-005 | Detect workflow gaps (missing navigation, UI elements) | Must |
| UWA-006 | Generate workflow diagram/documentation | Should |
| UWA-007 | Validate workflow against UX best practices | Should |
| UWA-008 | Suggest navigation/routing changes needed | Must |

#### Workflow Analysis Output

```typescript
interface UserWorkflowAnalysis {
  featureName: string
  entryPoints: Array<{
    location: string           // e.g., "Dashboard sidebar"
    triggerType: string        // e.g., "button click", "menu item", "route navigation"
    existingComponent: string  // Component that needs modification
    proposedChange: string     // What to add/modify
  }>
  userJourney: Array<{
    step: number
    action: string             // What user does
    screen: string             // What they see
    component: string          // Component involved
    needsCreation: boolean     // Does this component exist?
  }>
  exitPoints: Array<{
    location: string           // Where user ends up
    action: string             // What triggers exit
    destination: string        // Where they go
  }>
  workflowGaps: Array<{
    description: string
    severity: 'critical' | 'major' | 'minor'
    recommendation: string
  }>
  routingChanges: Array<{
    type: 'add' | 'modify'
    path: string
    component: string
    guards?: string[]
  }>
}
```

#### User Workflow Agent System Prompt

```
You are a User Workflow Agent. Before implementation begins, you must analyze
how the new functionality will fit into the user's experience.

TASK: Analyze user workflow for "{feature_description}"

1. EXPLORE the existing application:
   - Identify main navigation patterns
   - Map existing user flows
   - Find similar features and how they're accessed

2. PLAN the user journey for the new feature:
   - How does the user discover this feature?
   - What screens/modals are involved?
   - What actions can users take at each step?
   - Where do users go when they're done?

3. IDENTIFY gaps:
   - Missing navigation elements
   - Missing routes
   - Missing UI components for access
   - Orphaned features (no way to access)

4. OUTPUT a structured workflow analysis as JSON.

CRITICAL: A feature that exists but cannot be accessed by users is NOT complete.
Every feature MUST have a clear entry point in the UI.
```

#### Integration with Planning Phase

```
User Request: "Add user authentication"
    ↓
[Standard Planning Agent]
    ↓
Creates technical plan for auth
    ↓
[User Workflow Agent]
    ↓
Analyzes:
- Entry point: Login button needed in header
- User journey: Landing → Login Modal → Dashboard
- Exit point: Logout returns to landing page
- Gaps: No header login button exists, no route protection

Workflow Plan Addition:
1. Add LoginButton to Header component
2. Create LoginModal component (entry point)
3. Add route guards to /dashboard/*
4. Add logout handler that redirects to /

    ↓
[Combined Plan Presented to User]
```

#### Output Enhancement

```
User Workflow Analysis:
━━━━━━━━━━━━━━━━━━━━━━━

Feature: User Authentication

Entry Points:
├─ Header → [Add Login Button] → Opens LoginModal
└─ /login route → Direct URL access → LoginPage

User Journey:
1. User sees Login button in header
2. Clicks button → LoginModal opens
3. Enters credentials → Submits form
4. Success → Redirect to /dashboard
5. Failure → Show error, stay on modal

Exit Points:
├─ Success login → /dashboard
├─ Cancel → Close modal, stay on current page
└─ Logout → Return to / (landing)

⚠ Workflow Gaps Detected:
├─ CRITICAL: Header component has no auth UI
├─ MAJOR: /dashboard has no route protection
└─ MINOR: No "forgot password" flow

Routing Changes Required:
├─ ADD: /login → LoginPage
├─ ADD: /auth/callback → OAuthCallback
└─ MODIFY: /dashboard/* → Add AuthGuard

[Include in Plan] [Modify] [Skip Workflow Analysis]
```

#### Acceptance Criteria
- [ ] Workflow agent identifies all entry points
- [ ] User journey is mapped step-by-step
- [ ] Workflow gaps are detected before implementation
- [ ] Routing changes are included in implementation plan
- [ ] No orphaned features (features without UI access)
- [ ] Workflow analysis completes in <30 seconds

---

### 3.9 Operational Verification

**Priority:** P0 - Critical
**Effort:** Medium

#### Description
Ensure that planned functionality is not just technically correct but is actually operational within the running application. This goes beyond code compilation to verify that features are accessible, functional, and integrated into the live application.

#### Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| OPV-001 | Verify feature is accessible in running app | Must |
| OPV-002 | Test feature via UI interaction (if applicable) | Must |
| OPV-003 | Verify API endpoints respond correctly | Must |
| OPV-004 | Check navigation/routing works | Must |
| OPV-005 | Verify state management integration | Should |
| OPV-006 | Generate operational verification report | Must |
| OPV-007 | Auto-detect and report operational failures | Must |

#### Operational Verification Flow

```
Code Implementation Complete
    ↓
[Quality Gates Pass]
    ↓
[Goal Review Passes]
    ↓
[Operational Verification] ← NEW
    ↓
Start development server (if not running)
    ↓
For each new feature:
├─ Navigate to entry point
├─ Verify UI element exists
├─ Interact with feature
├─ Verify expected behavior
├─ Check for console errors
└─ Verify data persistence (if applicable)
    ↓
[Generate Operational Report]
    ↓
PASS: Feature is operational
 OR
FAIL: Feature exists but not operational
```

#### Verification Types

```typescript
interface OperationalVerification {
  featureId: string
  featureName: string
  verifications: Array<{
    type: 'ui_element' | 'navigation' | 'api_call' | 'state_change' | 'data_persistence'
    target: string           // What to verify
    expectedBehavior: string // What should happen
    actualResult: 'pass' | 'fail' | 'skip'
    evidence?: string        // Screenshot, response, etc.
    errorMessage?: string    // If failed
  }>
  overallStatus: 'operational' | 'partially_operational' | 'not_operational'
  blockers: string[]         // What prevents full operation
}
```

#### Integration with Execution Flow

```typescript
await Task({
  subagent_type: 'general-purpose',
  prompt: 'Add user dashboard with profile settings',
  operational_verification: {
    enabled: true,
    dev_server_command: 'npm run dev',
    base_url: 'http://localhost:3000',
    verifications: [
      {
        type: 'navigation',
        path: '/dashboard',
        expectation: 'Page loads without error'
      },
      {
        type: 'ui_element',
        selector: '[data-testid="profile-settings"]',
        expectation: 'Settings button visible'
      },
      {
        type: 'api_call',
        endpoint: '/api/user/profile',
        method: 'GET',
        expectation: 'Returns 200 with user data'
      }
    ],
    fail_task_if_not_operational: true
  }
})
```

#### Operational Verification System Prompt

```
You are an Operational Verification Agent. Your job is to verify that
implemented features are actually working in the running application.

IMPLEMENTATION SUMMARY:
{implementation_summary}

VERIFICATION TASKS:
{verifications}

INSTRUCTIONS:
1. Ensure the development server is running
2. For each verification:
   - Navigate to the appropriate location
   - Perform the verification action
   - Record the result (pass/fail)
   - Capture evidence (screenshot, response)
   - If failed, identify the root cause

3. Generate a verification report

CRITICAL: Code that compiles but isn't accessible or functional is NOT complete.
The feature must be operational for real users.
```

#### Output Enhancement

```
Operational Verification:
━━━━━━━━━━━━━━━━━━━━━━━━

Feature: User Dashboard with Profile Settings

Server Status: Running (http://localhost:3000)

Verifications:
✓ Navigation: /dashboard loads successfully
✓ UI Element: Dashboard header renders
✓ UI Element: Profile settings button visible
✓ Click Action: Settings modal opens
✗ API Call: /api/user/profile returns 404
  └─ Root cause: API route not registered in router
✓ State: User data loads in context

Overall Status: PARTIALLY OPERATIONAL

Blockers:
1. API route /api/user/profile not found
   - File exists: src/api/user/profile.ts ✓
   - Route registration: MISSING
   - Fix: Add route to src/api/router.ts

Recommendation: Register the API route and re-verify.

[Auto-Fix Blockers] [Mark Complete Anyway] [View Details]
```

#### Acceptance Criteria
- [ ] Development server auto-starts for verification
- [ ] UI elements verified via DOM inspection
- [ ] API endpoints tested with actual requests
- [ ] Navigation paths verified
- [ ] Operational failures clearly reported
- [ ] Root cause analysis for failures
- [ ] Verification completes in <60 seconds

---

### 3.10 Database Migration Integration (Supabase MCP)

**Priority:** P0 - Critical
**Effort:** Small

#### Description
Ensure database migrations are not just created as files but are actually applied to the database using Supabase MCP tools. Many tasks fail silently because migration files exist but were never executed.

#### Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| DBM-001 | Detect when migrations are created | Must |
| DBM-002 | Use Supabase MCP to apply migrations | Must |
| DBM-003 | Verify migration applied successfully | Must |
| DBM-004 | Rollback on migration failure | Should |
| DBM-005 | Track migration status in task output | Must |
| DBM-006 | Support multiple database providers | Should |

#### Migration Detection and Application

```typescript
interface MigrationConfig {
  provider: 'supabase' | 'prisma' | 'drizzle' | 'raw_sql'
  auto_apply: boolean
  verify_after_apply: boolean
  rollback_on_failure: boolean
}
```

#### Integration Flow

```
Task creates migration file
    ↓
[Detect Migration Files]
├─ supabase/migrations/*.sql
├─ prisma/migrations/*.sql
└─ drizzle/*.sql
    ↓
[Apply Migration via Supabase MCP]
    ↓
mcp__supabase__apply_migration({
  project_id: "...",
  migration_file: "20240201_add_users_table.sql"
})
    ↓
[Verify Migration Applied]
    ↓
mcp__supabase__execute_sql({
  query: "SELECT * FROM information_schema.tables WHERE table_name = 'users'"
})
    ↓
Verification: Table exists ✓
```

#### API Enhancement

```typescript
await Task({
  subagent_type: 'general-purpose',
  prompt: 'Add user profile table with name and avatar columns',
  database: {
    provider: 'supabase',
    project_id: 'your-project-id',
    auto_apply_migrations: true,  // Actually run migrations, don't just create files
    verify_schema: true,          // Verify table/columns exist after migration
    mcp_tools: [
      'mcp__supabase__apply_migration',
      'mcp__supabase__execute_sql',
      'mcp__supabase__list_migrations'
    ]
  }
})
```

#### Migration Workflow System Prompt

```
You are implementing a database change. You have access to Supabase MCP tools.

CRITICAL RULES FOR DATABASE CHANGES:
1. ALWAYS use mcp__supabase__apply_migration to apply migrations
2. NEVER just create migration files without applying them
3. ALWAYS verify the schema change took effect
4. If migration fails, report the error clearly

WORKFLOW:
1. Create migration file (if needed)
2. Apply migration using: mcp__supabase__apply_migration
3. Verify using: mcp__supabase__execute_sql with introspection query
4. Report success/failure

Example verification query:
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'your_table'
```

#### Output Enhancement

```
Database Migration:
━━━━━━━━━━━━━━━━━━

Migration: 20240201_add_user_profiles.sql

Actions:
✓ Migration file created: supabase/migrations/20240201_add_user_profiles.sql
✓ Migration applied via Supabase MCP
✓ Schema verification passed

Schema Changes:
┌─────────────────┬──────────────┬──────────────┐
│ Table           │ Column       │ Type         │
├─────────────────┼──────────────┼──────────────┤
│ user_profiles   │ id           │ uuid (PK)    │
│ user_profiles   │ user_id      │ uuid (FK)    │
│ user_profiles   │ display_name │ varchar(255) │
│ user_profiles   │ avatar_url   │ text         │
│ user_profiles   │ created_at   │ timestamptz  │
└─────────────────┴──────────────┴──────────────┘

Migration Status: APPLIED ✓
```

#### Error Handling

```
Database Migration:
━━━━━━━━━━━━━━━━━━

Migration: 20240201_add_user_profiles.sql

Actions:
✓ Migration file created
✗ Migration failed to apply

Error:
  relation "users" does not exist

Root Cause: Migration references 'users' table that doesn't exist yet.

Recommendation:
1. Ensure users table migration runs first
2. Or modify migration to create users table

[Create Missing Table] [Reorder Migrations] [Skip Migration]
```

#### Available Supabase MCP Tools

| Tool | Purpose |
|------|---------|
| `mcp__supabase__apply_migration` | Apply a migration to the database |
| `mcp__supabase__execute_sql` | Run SQL queries for verification |
| `mcp__supabase__list_migrations` | List applied/pending migrations |
| `mcp__supabase__list_tables` | View current database schema |
| `mcp__supabase__get_project` | Get project configuration |

#### Acceptance Criteria
- [ ] Migrations detected automatically
- [ ] Supabase MCP used to apply (not just create) migrations
- [ ] Schema verified after migration
- [ ] Clear error messages on failure
- [ ] Migration status included in task output
- [ ] Rollback capability on failure

---

## 4. Non-Functional Requirements

### 4.1 Performance

| Metric | Target |
|--------|--------|
| Planning phase | <60 seconds |
| Model selection | <1 second |
| Quality gates (all) | <120 seconds |
| Goal review | <30 seconds |

### 4.2 Reliability

| Metric | Target |
|--------|--------|
| Task completion rate | >90% |
| Goal achievement rate | >85% |
| Quality gate accuracy | >95% |

### 4.3 Cost Efficiency

| Metric | Target |
|--------|--------|
| Cost reduction (model selection) | 30% |
| Overhead from quality features | <20% |
| Failed task cost recovery | 50% (via learning) |

---

## 5. Implementation Plan

### Phase 1: Quality Foundation (Week 1-2)
- [ ] Implement quality gates parameter
- [ ] Add TypeCheck, Lint, Tests, Build gates
- [ ] Implement auto-fix for lint
- [ ] Add gate results to output

### Phase 2: Goal Verification (Week 3-4)
- [ ] Implement goal review agent
- [ ] Requirements extraction from prompt
- [ ] Verdict system (APPROVED/PARTIAL/REJECTED)
- [ ] Auto-retry on rejection

### Phase 3: Smart Planning with User Workflow (Week 5-6)
- [ ] Implement planning mode
- [ ] Codebase exploration phase
- [ ] **User Workflow Agent integration**
- [ ] **Entry/exit point detection**
- [ ] **Workflow gap analysis**
- [ ] Structured plan output
- [ ] User approval checkpoint

### Phase 4: Database & Operational Verification (Week 7-8)
- [ ] **Supabase MCP integration for migrations**
- [ ] **Auto-apply migrations (not just create files)**
- [ ] **Migration verification queries**
- [ ] **Operational verification framework**
- [ ] **UI element verification**
- [ ] **API endpoint testing**
- [ ] **Navigation path verification**

### Phase 5: Intelligence (Week 9-10)
- [ ] Complexity-aware model selection
- [ ] Learning capture system
- [ ] Learning application
- [ ] Execution observability

### Phase 6: Collaboration (Week 11-12)
- [ ] Multi-agent pipeline pattern
- [ ] Parallel specialist agents
- [ ] Context passing
- [ ] Collaboration visualization

---

## 6. API Summary

### Complete Enhanced API

```typescript
interface EnhancedTaskOptions {
  // Existing
  subagent_type: string
  prompt: string
  run_in_background?: boolean
  max_turns?: number

  // NEW: Planning
  plan?: boolean
  plan_options?: {
    approve_before_execute?: boolean
    max_sections?: number
    exploration_depth?: 'quick' | 'medium' | 'thorough'
  }

  // NEW: Quality Gates
  quality_gates?: {
    typecheck?: boolean
    lint?: boolean
    tests?: boolean
    build?: boolean
    custom?: Array<{ name: string; command: string }>
    fail_on_gate_error?: boolean
    max_fix_attempts?: number
  }

  // NEW: Goal Review
  goal_review?: {
    enabled?: boolean
    requirements?: string[]
    auto_retry_on_reject?: boolean
    max_review_attempts?: number
  }

  // NEW: Model Selection
  model?: 'haiku' | 'sonnet' | 'opus' | 'auto'

  // NEW: Collaboration
  collaboration?: {
    pattern?: 'pipeline' | 'parallel' | 'architect-worker'
    agents?: Array<{
      role: string
      model?: string
      parallel?: boolean
      variants?: string[]
    }>
  }

  // NEW: Observability
  observability?: {
    detailed_logging?: boolean
    export_report?: boolean
    replay_enabled?: boolean
  }

  // NEW: Learning
  learning?: {
    apply_learnings?: boolean
    capture_failures?: boolean
    learning_scope?: 'project' | 'global'
  }

  // NEW: User Workflow Analysis (Section 3.8)
  user_workflow?: {
    enabled?: boolean
    analyze_entry_points?: boolean
    detect_workflow_gaps?: boolean
    include_routing_changes?: boolean
  }

  // NEW: Operational Verification (Section 3.9)
  operational_verification?: {
    enabled?: boolean
    dev_server_command?: string
    base_url?: string
    verifications?: Array<{
      type: 'ui_element' | 'navigation' | 'api_call' | 'state_change'
      target: string
      expectation: string
    }>
    fail_task_if_not_operational?: boolean
  }

  // NEW: Database Migration (Section 3.10)
  database?: {
    provider?: 'supabase' | 'prisma' | 'drizzle' | 'raw_sql'
    project_id?: string
    auto_apply_migrations?: boolean  // Use MCP to apply, not just create files
    verify_schema?: boolean
    rollback_on_failure?: boolean
  }
}
```

---

## 7. Risks and Mitigations

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Planning overhead too slow | Medium | Medium | Skip for simple tasks, cache plans |
| Quality gates too strict | Medium | Low | Configurable strictness, easy bypass |
| Goal review false positives | High | Medium | User override, tuning threshold |
| Model selection wrong | Medium | Medium | Learning feedback, manual override |
| Multi-agent complexity | High | Medium | Start with simple patterns |
| Learning creates bias | Medium | Low | Decay old learnings, diversity |
| **Workflow analysis misses entry points** | High | Medium | Multiple detection strategies, user validation |
| **Operational verification flaky** | Medium | Medium | Retry logic, headless browser stability |
| **Migration auto-apply causes data loss** | Critical | Low | Always backup, dry-run first, explicit confirmation |
| **Supabase MCP unavailable** | Medium | Low | Fallback to manual migration reminder |

---

## 8. Success Criteria

### MVP (Phase 1-2)
- [ ] Quality gates functional with auto-fix
- [ ] Goal review provides accurate verdicts
- [ ] 20% improvement in task success rate

### Full Release (Phase 3-6)
- [ ] Planning mode reduces failures by 40%
- [ ] **User Workflow Agent identifies all entry points and gaps**
- [ ] **100% of migrations are applied (not just created as files)**
- [ ] **Operational verification catches non-functional features**
- [ ] Model selection reduces costs by 30%
- [ ] Multi-agent collaboration working
- [ ] Learning improves outcomes over time
- [ ] **Zero orphaned features (features without UI access)**

---

## 9. Appendix

### A. Quality Gate Commands

| Gate | Default Command | Auto-Fix |
|------|-----------------|----------|
| TypeCheck | `npx tsc --noEmit` | No |
| Lint | `npm run lint` | `npm run lint -- --fix` |
| Tests | `npm test` | No |
| Build | `npm run build` | No |

### B. Complexity Scoring Examples

| Task | Score | Model |
|------|-------|-------|
| "Fix typo in README" | 1.5 | Haiku |
| "Add console.log for debugging" | 2.0 | Haiku |
| "Create new React component" | 4.0 | Haiku |
| "Add API endpoint with tests" | 5.5 | Sonnet |
| "Refactor auth to use OAuth2" | 7.2 | Sonnet |
| "Migrate database schema" | 8.5 | Sonnet |

### C. Goal Review Prompt Templates

See `docs/GOAL_REVIEW_PROMPTS.md` (to be created)

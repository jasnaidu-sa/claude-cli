# oh-my-claudecode vs BVS: Workflow Architecture Deep Dive

## Executive Summary

**User Question**: "Do magic keywords only make sense if we implement more of the actual workflow in OMC such as swarm, etc along with the agents?"

**Answer**: **YES** - Magic keywords are **prompt transformers** that only work because they trigger underlying orchestration mechanisms (skill composition, agent delegation, parallel task pools). Adopting keywords without the workflow would be superficial and ineffective.

**Revised Recommendation**: **EVALUATE FULL WORKFLOW INTEGRATION** - The question isn't "should we add magic keywords?" but rather "should we adopt OMC's entire orchestration architecture?"

---

## Critical Distinction: Keywords vs. Orchestration

### What Magic Keywords Actually Are

**OMC's Magic Keywords Are NOT Standalone Features**

They're **pattern-matching triggers** that inject behavioral instructions into prompts, which then activate underlying orchestration systems:

```typescript
// From OMC's magic-keywords.ts (conceptual)
const keywords = {
  ultrawork: {
    pattern: /\bultrawork\b/i,
    action: (prompt) => {
      // Prepends orchestration directives
      return `
        LEVERAGE ALL AVAILABLE AGENTS FOR MAXIMUM PARALLELISM
        - Decompose task into independent components
        - Assign each component to specialized agent
        - Execute in parallel using Task tool
        - Coordinate results through coordinator

        ${prompt}
      `
    }
  },

  eco: {
    pattern: /\b(eco|ecomode)\b/i,
    action: (prompt) => {
      // Injects model routing logic
      return `
        OPTIMIZE FOR TOKEN EFFICIENCY
        - Use Haiku for simple operations
        - Use Sonnet only when complexity score >5
        - Never use Opus unless architectural decisions needed
        - Target 30-50% cost reduction

        ${prompt}
      `
    }
  }
}
```

**Key Insight**: Keywords are **syntactic sugar** for orchestration patterns. Without the underlying systems (task decomposer, coordinator, agent swarm), they're meaningless.

---

## OMC's Actual Workflow Architecture

Based on documentation analysis, here's how OMC's workflow actually operates:

### 1. Skill Composition Model (Core Architecture)

**Formula**: `[Execution Layer] + [0-N Enhancement Layers] + [Optional Guarantee Layer]`

```
User Input: "ultrawork build a fullstack app"
             ↓
   Pattern Matching: Detect "ultrawork" keyword
             ↓
   Skill Composition: [build] + [ultrawork] + [ralph]
             ↓
   Execution: build (primary) → enhanced by ultrawork (parallel) → guaranteed by ralph (verify)
```

**Execution Layer** (primary skill):
- `default/build` - Standard implementation
- `orchestrate/coordinate` - Multi-component coordination
- `planner/plan` - Architecture-first approach

**Enhancement Layer** (0-N capabilities):
- `ultrawork` - Parallel execution across agents
- `git-master` - Atomic commits with verification
- `frontend-ui-ux` - Visual design focus
- `eco` - Cost-optimized model selection

**Guarantee Layer** (optional):
- `ralph` - Evidence-based completion verification

### 2. Task Decomposition Strategy

**OMC's decomposition is task-type aware** with different strategies:

#### Fullstack Application Decomposition
```
1. Analysis Phase
   - Parse requirements
   - Identify system components (frontend, backend, database)
   - Detect cross-cutting concerns (auth, API contracts)

2. Component Identification
   - Frontend component (React/UI)
   - Backend component (API/business logic)
   - Database component (schema/migrations)
   - Integration component (API contracts)

3. Shared Files Detection
   - Type definitions (shared between frontend/backend)
   - API schemas (OpenAPI/GraphQL)
   - Configuration files

4. Subtask Generation
   - Subtask 1: Database schema (dependencies: none)
   - Subtask 2: Backend API (dependencies: database)
   - Subtask 3: Frontend UI (dependencies: backend API)
   - Subtask 4: Integration tests (dependencies: all)

5. File Ownership Assignment
   - Database: migrations/, schema/
   - Backend: src/api/, src/services/
   - Frontend: src/components/, src/pages/
   - Integration: tests/e2e/

6. Dependency Ordering
   - Level 0: Database (no deps)
   - Level 1: Backend (depends on database)
   - Level 2: Frontend (depends on backend)
   - Level 3: Integration (depends on all)

7. Validation
   - No overlapping file ownership
   - All dependencies can be satisfied
   - Parallelism opportunities identified
```

**Critical Pattern**: File ownership prevents merge conflicts during parallel execution

### 3. Agent Delegation Mechanism (Coordinator Pattern)

**OMC uses skill-based routing, not agent swapping**:

```typescript
// Conceptual coordinator flow
async function coordinateTask(userInput: string) {
  // 1. Analyze task complexity
  const complexity = analyzeComplexity(userInput)

  // 2. Select execution strategy
  const strategy = selectStrategy(complexity)
  // Returns: 'sequential' | 'parallel' | 'pipeline'

  // 3. Decompose if parallel/pipeline
  if (strategy !== 'sequential') {
    const subtasks = decomposeTask(userInput, strategy)

    // 4. Delegate to specialized agents
    const results = await Promise.all(
      subtasks.map(subtask => {
        const agentType = selectAgent(subtask.type)
        const modelTier = selectModel(subtask.complexity)

        return Task({
          subagent_type: `oh-my-claudecode:${agentType}`,
          model: modelTier, // 'haiku' | 'sonnet' | 'opus'
          prompt: formatPrompt(subtask)
        })
      })
    )

    // 5. Verify and merge results
    return verifyAndMerge(results)
  }
}
```

**Agent Selection Logic** (from documentation):

| Task Type | Agent | Model Tier | Why |
|-----------|-------|------------|-----|
| Visual/UI work | Designer | Sonnet | Creativity + implementation |
| Architecture decisions | Architect → Critic | Opus → Sonnet | Strategic thinking → validation |
| Simple lookups | Explorer | Haiku | Speed over sophistication |
| Code implementation | Executor | Sonnet | Balance of capability/cost |
| Quality assurance | UltraQA | Sonnet | Build/lint/test cycles |

### 4. Execution Modes (How They Actually Work)

#### Ultrapilot Mode (3-5x Faster)

**How it works**:
```
1. Task decomposition creates N independent subtasks
2. Spawn 3-5 parallel worker agents via Task tool
3. Each worker claims unassigned subtask from pool
4. Workers execute concurrently with 5-minute timeout
5. Coordinator monitors completion, handles failures
6. Results merged when all workers finish
```

**Key Pattern**: Task pool with agent claiming (not pre-assigned work)

#### Swarm Mode (Coordinated Parallel)

**How it works**:
```
1. Break project into self-contained components
2. Ensure no file ownership overlap
3. Spawn specialized agent for each component
4. Agents work independently (no coordination needed)
5. Coordinator monitors health, collects results
6. Final integration phase merges all outputs
```

**Key Pattern**: Independent work units with guaranteed non-interference

#### Pipeline Mode (Sequential Stages)

**How it works**:
```
Stage 1 (Review):     Architect analyzes requirements
                      Critic validates plan
                      Output: Technical specification
                      ↓
Stage 2 (Implement):  Executor builds features from spec
                      Output: Code files
                      ↓
Stage 3 (Debug):      Executor fixes compilation/test errors
                      Output: Passing tests
                      ↓
Stage 4 (Refactor):   Executor improves code quality
                      Output: Clean, maintainable code
```

**Key Pattern**: Each stage's output becomes next stage's input

#### Ecomode (Cost Optimization)

**How it works**:
```
For each subtask:
  complexity_score = calculateComplexity(subtask)

  if complexity_score < 3:
    model = 'haiku'   // Simple operations (lookups, formatting)
  elif complexity_score < 7:
    model = 'sonnet'  // Standard implementation
  else:
    model = 'opus'    // Architecture, complex reasoning
```

**Complexity Scoring** (heuristic):
- Lines of code to modify: +1 per 100 lines
- New files to create: +2 per file
- External integrations: +3 per integration
- Architectural decisions: +5
- Schema changes: +4

**Claimed Result**: 30-50% cost reduction vs. always using Sonnet

### 5. Verification Protocol (Ralph Guarantee)

**Evidence-Based Completion** - not just "I'm done":

```typescript
// Required evidence types
const evidenceRequirements = {
  BUILD: {
    description: "Compilation succeeds",
    command: "npm run build",
    maxAge: 300 // 5 minutes
  },
  TEST: {
    description: "All tests pass",
    command: "npm test",
    maxAge: 300
  },
  LINT: {
    description: "Code quality checks pass",
    command: "npm run lint",
    maxAge: 300
  },
  FUNCTIONALITY: {
    description: "Feature works as specified",
    verification: "manual" // Human approval or E2E test
  },
  ARCHITECT: {
    description: "Opus-tier architectural review",
    agent: "architect",
    model: "opus"
  }
}

// Verification flow
async function verifyCompletion(subtask) {
  const required = getRequiredEvidence(subtask.type)

  for (const evidence of required) {
    const result = await collectEvidence(evidence)

    if (!result.success) {
      throw new Error(`Verification failed: ${evidence.description}`)
    }

    if (result.age > evidence.maxAge) {
      throw new Error(`Evidence too old: ${evidence.description}`)
    }
  }

  return { verified: true, evidence: results }
}
```

**Key Insight**: Ralph keyword enforces this verification protocol, preventing premature completion claims

---

## BVS vs OMC: Workflow Architecture Comparison

### Execution Philosophy

| Aspect | OMC | BVS |
|--------|-----|-----|
| **Decomposition Unit** | Task (dynamic, file-based) | Section (planned, feature-based) |
| **Parallelism Model** | Task pool with claiming | Dependency DAG with worker spawning |
| **Coordination** | Coordinator delegates to specialists | Orchestrator spawns generic workers |
| **Verification** | Optional (ralph keyword) | Mandatory (typecheck, E2E, conventions) |
| **State Management** | Task completion tracking | Section state + checkpoint persistence |
| **Planning** | Zero-config auto-decomposition | Human-approved PRD with section definitions |

### Critical Architectural Differences

#### 1. **Task-Based vs. Section-Based**

**OMC (Task-Based)**:
```
User: "Build authentication system"
  ↓
Auto-decomposition:
  - Task 1: Database schema (User, Session tables)
  - Task 2: Backend API (login, logout, refresh endpoints)
  - Task 3: Frontend UI (LoginForm, SignupForm components)
  - Task 4: Integration tests

File ownership:
  - Task 1: migrations/, models/
  - Task 2: api/auth/, services/auth/
  - Task 3: components/auth/, pages/login/
  - Task 4: tests/auth/

Execution: Parallel (Task 1, 2, 3) → Sequential (Task 4 after 1, 2, 3)
```

**BVS (Section-Based)**:
```
PRD defines sections:
  - Section 1: Authentication Database Schema
  - Section 2: Auth Service Implementation
  - Section 3: Auth API Endpoints
  - Section 4: Login UI Components
  - Section 5: Integration Tests

Dependencies:
  - Section 2 depends on Section 1
  - Section 3 depends on Section 2
  - Section 4 depends on Section 3
  - Section 5 depends on all

Execution: DAG-based scheduling with parallel where possible
```

**Key Difference**: OMC auto-decomposes, BVS requires human planning

#### 2. **Agent Specialization**

**OMC**:
- 32+ specialized agents organized by complexity tier
- Coordinator selects agent based on task type
- Model selection (Haiku/Sonnet/Opus) based on complexity scoring
- Each agent has defined role (Architect, Critic, Executor, etc.)

**BVS**:
- Generic worker agents spawned as needed
- All workers use same agent type (work-developer-backend, work-developer-frontend)
- Model selection via Ralph Loop (Haiku ≤4 files, Sonnet >4)
- Specialization via file grouping, not agent type

**Key Difference**: OMC has agent diversity, BVS has execution diversity (Ralph Loop patterns)

#### 3. **Verification Approach**

**OMC**:
- **Optional** verification via `ralph` keyword
- Evidence-based completion (BUILD, TEST, LINT, FUNCTIONALITY)
- No type checking mentioned
- No E2E testing mentioned
- No convention checking mentioned

**BVS**:
- **Mandatory** verification gates after every code change
- TypeScript type checking (instant feedback)
- E2E visual testing via Claude-in-Chrome
- Convention compliance via work-reviewer-conventions
- Code review via work-reviewer-correctness, work-reviewer-typescript

**Key Difference**: BVS prioritizes quality gates, OMC prioritizes speed/cost

#### 4. **State Persistence**

**OMC**:
- Task completion tracking in `.omc/state/`
- Notepad system for plan-scoped knowledge
- Ralph keyword provides retry persistence
- No checkpoint approval mentioned

**BVS**:
- Full checkpoint system with risk assessment
- Human approval gates before destructive operations
- Resume after crash via checkpoint.json
- Section state with full history

**Key Difference**: BVS has richer state model with human oversight

---

## Should BVS Adopt OMC's Workflow?

### Option 1: Full Integration (Adopt OMC's Architecture)

**What This Means**:
- Replace BVS section-based model with OMC task-based model
- Implement 32+ specialized agents with skill-based routing
- Add auto-decomposition system (eliminate manual PRD planning)
- Implement task pool with agent claiming
- Add magic keywords as prompt transformers
- Integrate verification protocol (BUILD, TEST, LINT evidence)

**Pros**:
- ✅ Zero-config workflow (user just describes goal)
- ✅ Proven parallel execution patterns
- ✅ Model routing reduces costs (30-50% claimed)
- ✅ Agent specialization improves quality
- ✅ Task pool enables dynamic load balancing

**Cons**:
- ❌ Lose BVS's mandatory verification gates (typecheck, E2E, conventions)
- ❌ Lose human approval checkpoints (risk assessment)
- ❌ Lose Ralph Loop fresh context pattern (proven 40-42% savings)
- ❌ Lose rich Electron UI (Kanban visualization, drag-drop)
- ❌ Massive rewrite (4-6 weeks development)
- ❌ CLI-focused architecture doesn't leverage Electron

**Verdict**: **DON'T DO THIS** - Throws away BVS's core advantages

---

### Option 2: Hybrid Integration (Extract Specific Patterns)

**What This Means**:
- Keep BVS section-based model
- Add optional auto-decomposition for sections
- Implement agent specialization (work-reviewer-*, work-developer-*, work-architect-*)
- Add magic keywords for power users
- Integrate model routing logic (complexity scoring → Haiku/Sonnet/Opus)
- Keep all BVS verification gates

**Implementation Strategy**:

#### 2.1: Agent Specialization (HIGH VALUE)

**Already Partially Implemented**:
```typescript
// BVS already has specialized agents
work-reviewer-correctness    // Similar to OMC's Critic
work-reviewer-typescript     // Type safety specialist
work-reviewer-conventions    // Code quality specialist
work-developer-backend       // Backend implementation
work-developer-frontend      // Frontend implementation
work-architect-*             // Architecture planning
```

**Gap**: BVS agents aren't organized by complexity tier

**Enhancement**:
```typescript
// Add complexity-aware agent selection
interface AgentSelection {
  analyzeComplexity(section: BvsSection): number
  selectAgent(section: BvsSection, complexity: number): AgentType
  selectModel(complexity: number): 'haiku' | 'sonnet' | 'opus'
}

// Example
function selectImplementationAgent(section: BvsSection): { agent: string, model: string } {
  const complexity = calculateComplexity(section)

  if (section.files.some(f => f.path.includes('schema/'))) {
    // Database work = high complexity
    return { agent: 'work-architect-clean', model: 'opus' }
  }

  if (complexity < 3) {
    // Simple work
    return { agent: 'work-developer-backend', model: 'haiku' }
  }

  if (complexity < 7) {
    // Standard work
    return { agent: 'work-developer-backend', model: 'sonnet' }
  }

  // Complex work
  return { agent: 'work-architect-pragmatic', model: 'opus' }
}
```

**Benefit**: Optimize cost without losing quality

#### 2.2: Task Decomposition (MEDIUM VALUE)

**Current BVS**: Human writes PRD with sections defined

**Enhancement**: Auto-decompose large sections into subtasks

```typescript
// Add to BVS Planning Agent V2
interface SectionDecomposer {
  shouldDecompose(section: BvsSection): boolean
  decompose(section: BvsSection): BvsSubtask[]
  assignFileOwnership(subtasks: BvsSubtask[]): void
}

// Example
async function decomposeSection(section: BvsSection): Promise<BvsSubtask[]> {
  // If section affects >10 files, auto-decompose
  if (section.files.length <= 10) {
    return [{ id: '1', name: section.name, files: section.files }]
  }

  // Use OMC's decomposition strategy
  const subtasks: BvsSubtask[] = []

  // Group by file type
  const schemaFiles = section.files.filter(f => f.path.includes('schema/'))
  const typeFiles = section.files.filter(f => f.path.includes('types/'))
  const implFiles = section.files.filter(f => f.path.includes('services/'))
  const testFiles = section.files.filter(f => f.path.includes('tests/'))

  // Create subtasks with non-overlapping ownership
  if (schemaFiles.length > 0) {
    subtasks.push({ id: '1', name: 'Database Schema', files: schemaFiles })
  }
  if (typeFiles.length > 0) {
    subtasks.push({ id: '2', name: 'Type Definitions', files: typeFiles })
  }
  if (implFiles.length > 0) {
    subtasks.push({ id: '3', name: 'Implementation', files: implFiles })
  }
  if (testFiles.length > 0) {
    subtasks.push({ id: '4', name: 'Tests', files: testFiles })
  }

  return subtasks
}
```

**Benefit**: Automatic parallel execution opportunities

#### 2.3: Magic Keywords (LOW VALUE - ONLY IF WORKFLOW SUPPORTS IT)

**Current BVS**: No keyword support

**Enhancement**: Add as UI shortcuts

```typescript
// Keyword definitions
const keywords = {
  'ralph': {
    description: 'Retry until verified',
    config: { maxRetries: Infinity, requireEvidence: true }
  },
  'eco': {
    description: 'Cost-optimized execution',
    config: { preferHaiku: true, budgetMultiplier: 0.7 }
  },
  'parallel': {
    description: 'Maximum parallelism',
    config: { maxWorkers: 5, aggressiveParallel: true }
  }
}

// UI integration
<SectionCard section={section}>
  <KeywordSelector
    selected={section.keywords}
    available={keywords}
    onChange={updateSectionKeywords}
  />
</SectionCard>
```

**Benefit**: Power user shortcuts (but UI is already discoverable)

#### 2.4: Evidence-Based Verification (HIGH VALUE)

**Current BVS**: TypeScript check, E2E tests, code review

**Enhancement**: Add BUILD/TEST evidence requirements

```typescript
// Extend BVS verification
interface VerificationEvidence {
  type: 'BUILD' | 'TEST' | 'LINT' | 'TYPE_CHECK' | 'E2E'
  command: string
  output: string
  timestamp: number
  success: boolean
}

async function verifySection(section: BvsSection): Promise<VerificationResult> {
  const evidence: VerificationEvidence[] = []

  // 1. Type check (existing)
  const typeCheck = await runTypeCheck(section.files)
  evidence.push({
    type: 'TYPE_CHECK',
    command: 'npm run typecheck',
    output: typeCheck.output,
    timestamp: Date.now(),
    success: typeCheck.success
  })

  // 2. Build (NEW - from OMC)
  const build = await runBuild()
  evidence.push({
    type: 'BUILD',
    command: 'npm run build',
    output: build.output,
    timestamp: Date.now(),
    success: build.success
  })

  // 3. Tests (NEW - from OMC)
  const tests = await runTests(section.files)
  evidence.push({
    type: 'TEST',
    command: 'npm test',
    output: tests.output,
    timestamp: Date.now(),
    success: tests.success
  })

  // 4. E2E (existing)
  const e2e = await runE2ETests(section)
  evidence.push({
    type: 'E2E',
    command: 'npm run test:e2e',
    output: e2e.output,
    timestamp: Date.now(),
    success: e2e.success
  })

  // All must pass
  const allPassed = evidence.every(e => e.success)

  return {
    passed: allPassed,
    evidence,
    timestamp: Date.now()
  }
}
```

**Benefit**: Stronger quality guarantees

---

### Option 3: No Integration (Keep BVS As-Is)

**Rationale**: BVS already has superior architecture for verified code generation

**BVS Advantages Over OMC**:
1. **Mandatory verification gates** - OMC has optional ralph, BVS enforces quality
2. **Rich UI** - Kanban board, drag-drop, visual feedback vs. CLI-only
3. **Human checkpoints** - Risk assessment, approval gates
4. **Ralph Loop pattern** - Fresh context per subtask (proven savings)
5. **Structured learning** - RALPH-015 categorizes failures with recommendations
6. **Specialized for PRD → Code** - Optimized workflow, not generic orchestration

**OMC Advantages BVS Lacks**:
1. **Zero-config auto-decomposition** - But BVS targets structured PRD workflow
2. **32+ specialized agents** - But BVS has work-reviewer-*, work-developer-* agents
3. **Magic keywords** - Nice-to-have, not critical (UI already discoverable)
4. **Task pool model** - But DAG scheduling is more sophisticated for dependencies

**Verdict**: **THIS IS VALID** - BVS's architecture is already more advanced for its use case

---

## Final Recommendation

### Summary of Analysis

**Key Insight**: You were correct - magic keywords don't make sense without the underlying workflow. The question is whether BVS should adopt OMC's task-based orchestration model.

**Answer**: **NO - But Extract Specific Patterns**

### Recommended Integration Strategy

**Phase 1: High-Value Patterns Only** (2-3 weeks)

✅ **Do This**:
1. **Complexity-Aware Model Selection** - Adopt OMC's complexity scoring → Haiku/Sonnet/Opus routing
2. **Evidence-Based Verification** - Add BUILD/TEST evidence requirements to BVS verification gates
3. **Auto-Decomposition for Large Sections** - Split sections with >10 files into subtasks automatically
4. **Agent Tier Organization** - Organize existing BVS agents by complexity tier

❌ **Don't Do This**:
1. **Magic Keywords** - Not needed with UI (add later if users request)
2. **Task Pool Model** - BVS DAG is better for dependency management
3. **32+ Specialized Agents** - BVS already has sufficient specialization
4. **Zero-Config Philosophy** - Conflicts with PRD-driven workflow

### Why This Approach?

**1. BVS Has Architectural Advantages OMC Lacks**:
- Mandatory verification gates (quality over speed)
- Human approval checkpoints (safety)
- Rich Electron UI (better UX than CLI)
- Ralph Loop fresh context (proven 40-42% savings)
- Structured PRD workflow (better for enterprise use)

**2. OMC Has Tactical Advantages BVS Can Adopt**:
- Complexity scoring for model selection (cost optimization)
- Evidence-based completion (stronger verification)
- Auto-decomposition (reduce planning burden)
- Agent tier organization (clarity)

**3. Full Integration Would Be Counterproductive**:
- Lose BVS's mandatory quality gates
- Lose human oversight and checkpoints
- Lose rich UI in favor of CLI
- Massive rewrite effort (4-6 weeks)
- Architectural mismatch (task pool vs. DAG)

**4. Selective Integration Gets Best of Both**:
- Keep BVS's verification rigor
- Add OMC's cost optimization patterns
- Keep BVS's UI superiority
- Minimize development effort

---

## Implementation Plan

### Phase 1: Complexity-Aware Agent Selection (Week 1)

**Files to Modify**:
- `src/main/services/bvs-orchestrator-service.ts`
- `src/shared/bvs-types.ts`

**Implementation**:
```typescript
// Add complexity scoring
interface ComplexityMetrics {
  fileCount: number
  lineCount: number
  hasSchemaChanges: boolean
  hasAPIChanges: boolean
  hasDatabaseMigrations: boolean
  crossCuttingConcerns: number
}

function calculateComplexity(section: BvsSection): number {
  let score = 0

  // File count
  score += section.files.length * 0.5

  // Line count (estimate)
  score += (section.description.length / 100) * 0.3

  // Schema changes (high risk)
  if (section.files.some(f => f.path.includes('schema/'))) {
    score += 5
  }

  // Database migrations (high risk)
  if (section.files.some(f => f.path.includes('migrations/'))) {
    score += 4
  }

  // API changes (medium risk)
  if (section.files.some(f => f.path.includes('api/'))) {
    score += 3
  }

  // Cross-cutting concerns (architectural)
  if (section.dependencies.length > 3) {
    score += 2
  }

  return score
}

function selectAgent(section: BvsSection): { agent: string, model: string } {
  const complexity = calculateComplexity(section)

  // Simple work (0-3)
  if (complexity < 3) {
    return {
      agent: section.type === 'frontend' ? 'work-developer-frontend' : 'work-developer-backend',
      model: 'haiku'
    }
  }

  // Standard work (3-7)
  if (complexity < 7) {
    return {
      agent: section.type === 'frontend' ? 'work-developer-frontend' : 'work-developer-backend',
      model: 'sonnet'
    }
  }

  // Complex work (7-10)
  if (complexity < 10) {
    return {
      agent: 'work-architect-pragmatic',
      model: 'sonnet'
    }
  }

  // Very complex work (10+)
  return {
    agent: 'work-architect-clean',
    model: 'opus'
  }
}
```

**Expected Benefit**: 20-30% cost reduction through smarter model selection

### Phase 2: Evidence-Based Verification (Week 2)

**Files to Modify**:
- `src/main/services/bvs-typecheck-service.ts` (extend)
- `src/shared/bvs-types.ts`

**Implementation**:
```typescript
// Add evidence tracking
interface VerificationEvidence {
  type: 'BUILD' | 'TEST' | 'LINT' | 'TYPE_CHECK' | 'E2E'
  command: string
  output: string
  timestamp: number
  duration: number
  success: boolean
}

interface VerificationResult {
  passed: boolean
  evidence: VerificationEvidence[]
  timestamp: number
  errors?: string[]
}

// Extend typecheck service
class BvsVerificationService {
  async verifySection(section: BvsSection): Promise<VerificationResult> {
    const evidence: VerificationEvidence[] = []

    // Run all verification types in parallel
    const [build, test, lint, typecheck, e2e] = await Promise.all([
      this.runBuild(),
      this.runTests(section.files),
      this.runLint(section.files),
      this.runTypeCheck(section.files),
      this.runE2E(section)
    ])

    evidence.push(...[build, test, lint, typecheck, e2e])

    const allPassed = evidence.every(e => e.success)
    const errors = evidence.filter(e => !e.success).map(e => e.output)

    return {
      passed: allPassed,
      evidence,
      timestamp: Date.now(),
      errors: allPassed ? undefined : errors
    }
  }

  private async runBuild(): Promise<VerificationEvidence> {
    const start = Date.now()
    try {
      const result = await execAsync('npm run build')
      return {
        type: 'BUILD',
        command: 'npm run build',
        output: result.stdout,
        timestamp: Date.now(),
        duration: Date.now() - start,
        success: true
      }
    } catch (error: any) {
      return {
        type: 'BUILD',
        command: 'npm run build',
        output: error.stdout + error.stderr,
        timestamp: Date.now(),
        duration: Date.now() - start,
        success: false
      }
    }
  }

  private async runTests(files: BvsFile[]): Promise<VerificationEvidence> {
    // Run tests only for affected files
    const testFiles = files
      .map(f => f.path.replace(/\.ts$/, '.test.ts'))
      .join(' ')

    const start = Date.now()
    try {
      const result = await execAsync(`npm test -- ${testFiles}`)
      return {
        type: 'TEST',
        command: `npm test -- ${testFiles}`,
        output: result.stdout,
        timestamp: Date.now(),
        duration: Date.now() - start,
        success: true
      }
    } catch (error: any) {
      return {
        type: 'TEST',
        command: `npm test -- ${testFiles}`,
        output: error.stdout + error.stderr,
        timestamp: Date.now(),
        duration: Date.now() - start,
        success: false
      }
    }
  }
}
```

**Expected Benefit**: Catch more bugs before deployment

### Phase 3: Auto-Decomposition (Week 3)

**Files to Create**:
- `src/main/services/bvs-section-decomposer.ts`

**Implementation**:
```typescript
class BvsSectionDecomposer {
  async decompose(section: BvsSection): Promise<BvsSubtask[]> {
    // Don't decompose small sections
    if (section.files.length <= 10) {
      return [{
        id: `${section.id}-1`,
        name: section.name,
        files: section.files.map(f => f.path),
        dependencies: []
      }]
    }

    // Group files by type
    const groups = this.groupFilesByType(section.files)

    // Create subtasks with dependencies
    const subtasks: BvsSubtask[] = []

    // Schema first (no dependencies)
    if (groups.schema.length > 0) {
      subtasks.push({
        id: `${section.id}-schema`,
        name: `${section.name} - Database Schema`,
        files: groups.schema,
        dependencies: []
      })
    }

    // Types second (depends on schema)
    if (groups.types.length > 0) {
      subtasks.push({
        id: `${section.id}-types`,
        name: `${section.name} - Type Definitions`,
        files: groups.types,
        dependencies: groups.schema.length > 0 ? [`${section.id}-schema`] : []
      })
    }

    // Implementation third (depends on types)
    if (groups.implementation.length > 0) {
      subtasks.push({
        id: `${section.id}-impl`,
        name: `${section.name} - Implementation`,
        files: groups.implementation,
        dependencies: groups.types.length > 0 ? [`${section.id}-types`] : []
      })
    }

    // Tests last (depends on implementation)
    if (groups.tests.length > 0) {
      subtasks.push({
        id: `${section.id}-tests`,
        name: `${section.name} - Tests`,
        files: groups.tests,
        dependencies: groups.implementation.length > 0 ? [`${section.id}-impl`] : []
      })
    }

    return subtasks
  }

  private groupFilesByType(files: BvsFile[]): FileGroups {
    return {
      schema: files.filter(f => f.path.includes('schema/')).map(f => f.path),
      types: files.filter(f => f.path.includes('types/')).map(f => f.path),
      implementation: files.filter(f =>
        !f.path.includes('schema/') &&
        !f.path.includes('types/') &&
        !f.path.includes('test')
      ).map(f => f.path),
      tests: files.filter(f => f.path.includes('test')).map(f => f.path)
    }
  }
}
```

**Expected Benefit**: Automatic parallelization of large sections

---

## Metrics to Track

After implementing Phase 1-3, measure:

**Cost Optimization**:
- Average cost per section (before vs. after)
- Model distribution (% Haiku, % Sonnet, % Opus)
- Target: 20-30% cost reduction through smarter model selection

**Quality Improvement**:
- Bugs caught by BUILD verification
- Bugs caught by TEST verification
- Test coverage increase
- Target: 50% reduction in bugs reaching production

**Parallelization Efficiency**:
- Sections auto-decomposed (%)
- Average subtasks per section
- Parallel execution speedup
- Target: 2x faster execution for large sections

**User Satisfaction**:
- Planning time reduced (manual PRD writing)
- User-reported quality improvements
- Target: 4.5/5 satisfaction

---

## Conclusion

### Should We Adopt OMC's Workflow?

**NO - Full adoption would be counterproductive**

Reasons:
1. BVS already has superior architecture for verified code generation
2. Mandatory quality gates are BVS's core value proposition
3. Rich Electron UI is better than CLI for enterprise users
4. Ralph Loop fresh context pattern has proven results
5. Full integration would require 4-6 weeks of rewrite effort

### Should We Extract Patterns from OMC?

**YES - But only high-value patterns**

What to extract:
1. ✅ **Complexity-aware model selection** - 20-30% cost savings
2. ✅ **Evidence-based verification** - Stronger quality guarantees
3. ✅ **Auto-decomposition for large sections** - Reduce planning burden

What to skip:
1. ❌ **Magic keywords** - UI already discoverable
2. ❌ **Task pool model** - DAG is better for dependencies
3. ❌ **32+ specialized agents** - Sufficient specialization already exists
4. ❌ **Zero-config philosophy** - Conflicts with PRD workflow

### Final Answer to Original Question

**"Do magic keywords only make sense if we implement the full OMC workflow?"**

**YES** - Magic keywords are **syntactic sugar** for orchestration patterns (task decomposition, agent delegation, parallel execution, evidence verification). Implementing keywords without the underlying workflow would be superficial.

**However**: BVS doesn't need magic keywords OR the full OMC workflow. BVS should **selectively extract proven patterns** (complexity scoring, evidence verification, auto-decomposition) while keeping its superior architecture (mandatory quality gates, human checkpoints, rich UI, Ralph Loop).

**Implementation Priority**:
- Phase 1: Complexity-aware model selection (Week 1) - **DO THIS**
- Phase 2: Evidence-based verification (Week 2) - **DO THIS**
- Phase 3: Auto-decomposition (Week 3) - **DO THIS**
- Magic keywords: **SKIP** (not needed with UI)
- Task pool model: **SKIP** (DAG is better)
- Full OMC integration: **SKIP** (counterproductive)

---

## Appendix: BVS vs. OMC Score (Updated)

| Feature | OMC | BVS | Winner | Rationale |
|---------|-----|-----|--------|-----------|
| **Parallel Execution** | ✅ Task pool | ✅ DAG-based | **BVS** | DAG handles dependencies better |
| **Cost Optimization** | ✅ 30-50% (claimed) | ✅ 40-42% (proven) | **BVS** | Proven data + can adopt OMC patterns |
| **Verification Gates** | ⚠️ Optional (ralph) | ✅ Mandatory | **BVS** | Quality guarantee |
| **Dependency Management** | ⚠️ File ownership | ✅ Explicit DAG | **BVS** | More sophisticated |
| **State Persistence** | ✅ Task tracking | ✅ Checkpoints + approval | **BVS** | Human oversight |
| **Learning System** | ✅ Skill extraction | ✅ RALPH-015 | **Tie** | Different approaches |
| **User Interface** | ❌ CLI only | ✅ Electron UI | **BVS** | Visual superiority |
| **Auto-Decomposition** | ✅ Zero-config | ⚠️ Manual PRD | **OMC** | Less planning effort |
| **Agent Specialization** | ✅ 32+ agents | ✅ work-* agents | **Tie** | Sufficient in both |
| **Model Selection** | ✅ Complexity scoring | ⚠️ Fixed (Haiku ≤4, Sonnet >4) | **OMC** | More sophisticated |
| **Fresh Context** | ❌ Not mentioned | ✅ Ralph Loop | **BVS** | Quality benefit |
| **Evidence Verification** | ✅ BUILD/TEST/LINT | ⚠️ Type/E2E only | **OMC** | More comprehensive |

**Updated Score**: BVS 8, OMC 3, Tie 2

**Verdict**: BVS is the superior system for verified code generation. Adopt OMC's model selection and evidence verification patterns, but keep BVS's architecture intact.

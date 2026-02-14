# Agent System Comparison: OMC vs BVS

## Executive Summary

**Current State**: BVS has 6 specialized agents focused on code review and implementation quality gates.

**OMC State**: OMC has 12 specialized agents organized across analysis, execution, and support tiers.

**Recommendation**: **ENHANCE BVS AGENT SYSTEM** - Add missing agent types (Analyst, Researcher, Explorer) and improve specialization while keeping quality-focused architecture.

---

## Complete Agent Inventory

### OMC Agents (12 Total)

#### Analysis Tier (Opus Model - Complex Reasoning)

| Agent | Model | Primary Role | When Used |
|-------|-------|-------------|-----------|
| **Architect** | Opus | Deep analysis, debugging complex issues | Root cause analysis, system design |
| **Critic** | Opus | Critical plan evaluation | Validates architectural plans before execution |
| **Analyst** | Opus | Pre-planning requirement discovery | Requirement gathering, scope analysis |
| **Planner** | Opus | Strategic planning via structured interviews | Creates execution plans from requirements |

#### Execution Tier (Sonnet Model - Implementation)

| Agent | Model | Primary Role | When Used |
|-------|-------|-------------|-----------|
| **Executor** | Sonnet | Direct task implementation | Code generation, feature building |
| **Designer** | Sonnet | UI/UX component work and styling | Frontend components, visual design |
| **Orchestrator** | Sonnet | Todo delegation and coordination | Delegates to other agents, never implements directly |
| **QA-Tester** | Sonnet | CLI/service testing with tmux automation | Integration testing, service validation |

#### Support Tier (Mixed Models - Specialized Tasks)

| Agent | Model | Primary Role | When Used |
|-------|-------|-------------|-----------|
| **Researcher** | Sonnet | Documentation lookup, multi-repo investigation | Finding patterns, researching APIs |
| **Explore** | Haiku | Rapid codebase pattern matching | Quick file discovery, pattern search |
| **Writer** | Haiku | Technical documentation creation | README, docs, comments |
| **Vision** | Sonnet | Visual analysis of screenshots/diagrams | UI review, design verification |

---

### BVS Agents (6 Current + Implicit)

#### Review Tier (Code Quality Verification)

| Agent | Model | Primary Role | When Used |
|-------|-------|-------------|-----------|
| **work-reviewer-correctness** | Sonnet | Bug detection, logic errors, edge cases | After section completion |
| **work-reviewer-typescript** | Sonnet | Type safety, proper generics, null safety | After section completion |
| **work-reviewer-conventions** | Sonnet | Naming, imports, file structure | After section completion |
| **work-reviewer-simplicity** | Sonnet | DRY principles, elegance, readability | After section completion |
| **work-reviewer-security** | Sonnet | Injection vulnerabilities, OWASP Top 10 | After section completion (optional) |
| **work-reviewer-architecture** | Sonnet | Design patterns, separation of concerns | After section completion (optional) |
| **work-reviewer-data-integrity** | Sonnet | Database constraints, transaction handling | After section completion (optional) |
| **work-reviewer-performance** | Sonnet | N+1 queries, memory leaks, inefficient algorithms | After section completion (optional) |

#### Implementation Tier (Code Generation)

| Agent | Model | Primary Role | When Used |
|-------|-------|-------------|-----------|
| **work-developer-frontend** | Sonnet | Frontend React/TypeScript implementation | UI components, pages, hooks |
| **work-developer-backend** | Sonnet | Backend API/service implementation | API routes, services, database |

#### Architecture Tier (Planning & Design)

| Agent | Model | Primary Role | When Used |
|-------|-------|-------------|-----------|
| **work-architect-minimal** | Sonnet | Minimal changes, fastest implementation | Quick fixes, simple features |
| **work-architect-clean** | Opus | SOLID principles, proper abstractions | Complex features, refactoring |
| **work-architect-pragmatic** | Sonnet | Balanced production-ready approach | Standard features |

#### Quality Tier (Testing & Verification)

| Agent | Model | Primary Role | When Used |
|-------|-------|-------------|-----------|
| **work-quality-checker** | Sonnet | Lint, typecheck, tests | After every code change |
| **work-tester** | Sonnet | Browser testing with Chrome DevTools | E2E visual verification |

#### Investigation Tier (Analysis & Research)

| Agent | Model | Primary Role | When Used |
|-------|-------|-------------|-----------|
| **work-investigator** | Sonnet | Codebase investigation with web research | Bug investigation, feature analysis |
| **work-planner** | Sonnet | Create detailed execution plan | Planning phase |

---

## Gap Analysis: What BVS Is Missing

### ❌ Missing: Analyst Agent (OMC Has, BVS Lacks)

**OMC's Analyst**:
- **Role**: Pre-planning requirement discovery
- **Model**: Opus (complex reasoning)
- **When**: Before creating execution plan
- **Why**: Expands vague ideas into structured requirements

**BVS Gap**: BVS Planning Agent V2 does exploration + question asking, but doesn't have dedicated requirement analysis phase

**Impact**: Medium - Planning agent partially covers this, but not as focused

**Recommendation**: ✅ **Add** - Create dedicated `work-analyst` agent for requirement discovery

---

### ❌ Missing: Researcher Agent (OMC Has, BVS Lacks)

**OMC's Researcher**:
- **Role**: Documentation lookup, multi-repo investigation
- **Model**: Sonnet
- **When**: During implementation when patterns/APIs need research
- **Why**: Finds existing solutions, researches best practices

**BVS Gap**: No dedicated agent for research tasks

**Impact**: High - Currently relies on work-investigator which combines too many responsibilities

**Recommendation**: ✅ **Add** - Create dedicated `work-researcher` agent

---

### ❌ Missing: Explorer Agent (OMC Has, BVS Lacks)

**OMC's Explorer**:
- **Role**: Rapid codebase pattern matching
- **Model**: Haiku (fast, cheap)
- **When**: Quick file discovery, pattern searches
- **Why**: Speed over sophistication for simple searches

**BVS Gap**: No lightweight search agent

**Impact**: Medium - Could speed up codebase exploration

**Recommendation**: ✅ **Add** - Create `work-explorer` agent with Haiku model

---

### ❌ Missing: Designer Agent (OMC Has, BVS Lacks)

**OMC's Designer**:
- **Role**: UI/UX component work and styling
- **Model**: Sonnet
- **When**: Frontend work requiring design decisions
- **Why**: Specialized for visual/aesthetic work

**BVS Gap**: `work-developer-frontend` combines implementation + design

**Impact**: Medium - Frontend agent is overloaded

**Recommendation**: ⚠️ **Consider** - Split frontend into developer + designer, or enhance frontend agent

---

### ❌ Missing: Writer Agent (OMC Has, BVS Lacks)

**OMC's Writer**:
- **Role**: Technical documentation creation
- **Model**: Haiku (fast, cheap)
- **When**: README, docs, comments
- **Why**: Lightweight agent for documentation work

**BVS Gap**: No dedicated documentation agent

**Impact**: Low - Documentation is not core BVS workflow

**Recommendation**: ⏭️ **Skip** - Not critical for verified code generation

---

### ❌ Missing: Vision Agent (OMC Has, BVS Lacks)

**OMC's Vision**:
- **Role**: Visual analysis of screenshots/diagrams
- **Model**: Sonnet
- **When**: UI review, design verification from images
- **Why**: Analyzes visual artifacts

**BVS Gap**: `work-tester` captures screenshots but doesn't analyze them with vision model

**Impact**: Medium - Could enhance E2E testing

**Recommendation**: ✅ **Add** - Enhance `work-tester` with vision capabilities

---

### ❌ Missing: Orchestrator Agent (OMC Has, BVS Lacks)

**OMC's Orchestrator**:
- **Role**: Todo delegation and coordination
- **Model**: Sonnet
- **When**: Multi-component tasks requiring coordination
- **Why**: Delegates to specialists, never implements directly

**BVS Gap**: BVS orchestrator service is not an agent, it's a service

**Impact**: Low - Service-based orchestration works well

**Recommendation**: ⏭️ **Skip** - Current architecture is sufficient

---

### ✅ BVS Has, OMC Lacks: Specialized Review Agents

**BVS Review Agents** (8 total):
- correctness, typescript, conventions, simplicity, security, architecture, data-integrity, performance

**OMC Gap**: OMC only has Critic (plan evaluation), no code review agents

**Impact**: **Critical BVS Advantage** - Multi-gate verification is core differentiator

**Verdict**: **Keep all BVS review agents** - This is BVS's strength

---

## Proposed BVS Agent System Enhancement

### New Agent Definitions

#### 1. work-analyst (NEW)

```typescript
{
  name: 'work-analyst',
  description: 'Requirement discovery and scope analysis',
  model: 'opus',
  role: 'analysis',
  use_cases: [
    'Expand vague requirements into structured specifications',
    'Identify scope boundaries and edge cases',
    'Discover hidden requirements through codebase analysis',
    'Generate user stories from feature descriptions'
  ],
  prompt_template: `You are a requirements analyst.

Your task is to expand the user's requirement into a detailed specification:
1. Analyze the requirement and identify ambiguities
2. Explore the codebase to understand existing patterns
3. Identify edge cases and potential conflicts
4. Generate structured user stories with acceptance criteria
5. Define scope boundaries (in-scope vs out-of-scope)

Output a structured requirement document with:
- Clear problem statement
- User stories with acceptance criteria
- Technical constraints
- Dependencies on existing features
- Risk assessment
`
}
```

**When to Use**:
- User provides vague feature request
- Before planning phase
- When requirements are unclear

**Expected Benefit**: Better planning through thorough requirement analysis

---

#### 2. work-researcher (NEW)

```typescript
{
  name: 'work-researcher',
  description: 'Documentation lookup and best practices research',
  model: 'sonnet',
  role: 'support',
  use_cases: [
    'Research framework documentation',
    'Find existing patterns in codebase',
    'Discover best practices for specific problems',
    'Investigate multi-repo dependencies'
  ],
  prompt_template: `You are a research specialist.

Your task is to research the topic and provide actionable findings:
1. Use WebSearch to find current best practices (2026 documentation)
2. Use Grep/Glob to find existing patterns in codebase
3. Analyze similar implementations in project
4. Summarize findings with concrete recommendations

Research focus: {{RESEARCH_TOPIC}}

Output structured findings:
- Best practices (with sources)
- Existing codebase patterns
- Recommended approach with rationale
- Potential pitfalls to avoid
`
}
```

**When to Use**:
- Implementation requires external API research
- Need to understand framework patterns
- Looking for existing solutions before writing new code

**Expected Benefit**: Better implementation decisions through research

---

#### 3. work-explorer (NEW)

```typescript
{
  name: 'work-explorer',
  description: 'Fast codebase pattern matching',
  model: 'haiku',
  role: 'support',
  use_cases: [
    'Rapid file discovery by pattern',
    'Quick grep for specific code patterns',
    'Find similar implementations',
    'Codebase structure exploration'
  ],
  prompt_template: `You are a codebase explorer optimized for speed.

Your task is to quickly find files/patterns matching the query:
1. Use Glob for file path patterns
2. Use Grep for code content search
3. Return results with minimal commentary
4. Prioritize speed over deep analysis

Query: {{SEARCH_QUERY}}

Output format:
- List of matching files (paths only)
- Relevant code snippets (if content search)
- Brief pattern summary (1-2 sentences max)
`
}
```

**When to Use**:
- Quick file location tasks
- Pattern discovery before implementation
- Codebase structure understanding

**Expected Benefit**: Faster codebase navigation, reduced cost

---

#### 4. work-designer (NEW - Optional)

```typescript
{
  name: 'work-designer',
  description: 'UI/UX component design and styling',
  model: 'sonnet',
  role: 'implementation',
  use_cases: [
    'Design React component structure',
    'Create Tailwind styling',
    'Implement responsive layouts',
    'Visual hierarchy and accessibility'
  ],
  prompt_template: `You are a UI/UX designer specializing in React components.

Your task is to create visually polished, accessible components:
1. Analyze design requirements and user flows
2. Create component structure with proper composition
3. Implement Tailwind styling with design system consistency
4. Ensure accessibility (ARIA labels, keyboard nav, screen readers)
5. Optimize for responsive design

Component specification: {{COMPONENT_SPEC}}

Output:
- Component code with JSX/TSX
- Tailwind classes following project conventions
- Accessibility notes
- Responsive breakpoint handling
`
}
```

**When to Use**:
- Frontend sections requiring design decisions
- UI components needing visual polish
- Accessibility-critical features

**Expected Benefit**: Higher quality frontend implementation

---

#### 5. work-tester-vision (ENHANCEMENT)

**Current**: `work-tester` captures screenshots but doesn't analyze them

**Enhancement**: Add vision model analysis to E2E testing

```typescript
{
  name: 'work-tester',
  description: 'Browser testing with visual analysis',
  model: 'sonnet', // Vision-enabled model
  role: 'quality',
  enhancements: [
    'Analyze screenshots for visual regressions',
    'Verify UI layout matches design',
    'Detect rendering issues (overlapping elements, cutoff text)',
    'Compare before/after screenshots'
  ],
  prompt_template: `You are a QA tester with visual analysis capabilities.

Your task is to verify the feature works correctly:
1. Use Claude-in-Chrome to interact with the feature
2. Capture screenshots at key interaction points
3. ANALYZE screenshots for visual correctness:
   - Layout matches expected design
   - No overlapping or cutoff elements
   - Proper spacing and alignment
   - Accessible contrast ratios
4. Test interactive elements (clicks, inputs, navigation)
5. Check browser console for errors

Feature to test: {{FEATURE_DESCRIPTION}}

Output test results:
- Pass/fail status with evidence
- Screenshot analysis findings
- Console error summary
- Interaction test results
`
}
```

**Expected Benefit**: Catch visual bugs automatically

---

## Updated BVS Agent System (Total: 21 Agents)

### Analysis Tier (Opus - Complex Reasoning)
1. **work-analyst** (NEW) - Requirement discovery
2. **work-architect-clean** (EXISTING) - SOLID architecture

### Implementation Tier (Sonnet - Code Generation)
3. **work-developer-backend** (EXISTING) - Backend implementation
4. **work-developer-frontend** (EXISTING) - Frontend implementation
5. **work-designer** (NEW - OPTIONAL) - UI/UX design
6. **work-architect-minimal** (EXISTING) - Minimal changes
7. **work-architect-pragmatic** (EXISTING) - Balanced approach

### Review Tier (Sonnet - Quality Gates)
8. **work-reviewer-correctness** (EXISTING) - Logic/bugs
9. **work-reviewer-typescript** (EXISTING) - Type safety
10. **work-reviewer-conventions** (EXISTING) - Code standards
11. **work-reviewer-simplicity** (EXISTING) - DRY/readability
12. **work-reviewer-security** (EXISTING) - Security vulnerabilities
13. **work-reviewer-architecture** (EXISTING) - Design patterns
14. **work-reviewer-data-integrity** (EXISTING) - Database safety
15. **work-reviewer-performance** (EXISTING) - Performance issues

### Quality Tier (Sonnet - Testing)
16. **work-quality-checker** (EXISTING) - Lint/typecheck
17. **work-tester** (ENHANCED) - E2E + vision analysis

### Support Tier (Mixed Models - Specialized)
18. **work-researcher** (NEW - Sonnet) - Documentation/best practices
19. **work-explorer** (NEW - Haiku) - Fast pattern search
20. **work-investigator** (EXISTING - Sonnet) - Bug investigation
21. **work-planner** (EXISTING - Sonnet) - Execution planning

---

## Agent Organization by Complexity Tier

### HIGH Complexity (Opus Model)
**Use for**: Architecture decisions, complex debugging, requirement analysis
- work-analyst (NEW)
- work-architect-clean

**Cost**: ~$15/1M input tokens, ~$75/1M output tokens

---

### MEDIUM Complexity (Sonnet Model)
**Use for**: Standard implementation, code review, testing
- work-developer-backend
- work-developer-frontend
- work-designer (NEW - OPTIONAL)
- work-architect-minimal
- work-architect-pragmatic
- work-reviewer-* (8 agents)
- work-quality-checker
- work-tester (ENHANCED)
- work-researcher (NEW)
- work-investigator
- work-planner

**Cost**: ~$3/1M input tokens, ~$15/1M output tokens

---

### LOW Complexity (Haiku Model)
**Use for**: Quick searches, pattern discovery
- work-explorer (NEW)

**Cost**: ~$0.25/1M input tokens, ~$1.25/1M output tokens

---

## Coordination Patterns

### OMC Coordination (Orchestrator Pattern)

```
User Request
    ↓
Orchestrator analyzes task
    ↓
Delegates to specialists:
    - Architect → creates plan
    - Critic → validates plan
    - Executor → implements
    - QA-Tester → verifies
    ↓
Orchestrator verifies results
    ↓
Returns to user
```

**Key**: Orchestrator **never implements**, only delegates

---

### BVS Coordination (Service-Based Pattern)

```
User uploads PRD/starts planning
    ↓
BVS Orchestrator Service analyzes sections
    ↓
Creates dependency DAG
    ↓
Spawns worker agents in parallel:
    - work-developer-backend (W1)
    - work-developer-frontend (W2)
    - work-developer-backend (W3)
    ↓
After section completes:
    - work-quality-checker verifies
    - work-reviewer-* agents review (parallel)
    - work-tester runs E2E tests
    ↓
Merges results, moves to next level
```

**Key**: Service orchestrates, workers implement, reviewers verify

---

## Proposed Coordination Enhancement

### Add Research Phase (Before Implementation)

**Current Flow**:
```
Planning → Implementation → Review → Testing
```

**Enhanced Flow**:
```
Planning → Research → Implementation → Review → Testing
          ↑
    work-researcher + work-explorer
```

**Research Phase**:
1. **work-explorer** (Haiku) - Quick file discovery
2. **work-researcher** (Sonnet) - Best practices lookup
3. **work-analyst** (Opus) - Requirement refinement (if needed)

**When to Insert Research Phase**:
- Section involves new framework/library
- Section modifies unfamiliar codebase area
- Section requires external API integration
- Section has vague requirements

**Expected Benefit**: Better implementation decisions, fewer rework cycles

---

## Implementation Priority

### Phase 1: High-Value Additions (Week 1)

✅ **Implement**:
1. **work-researcher** agent - High value for implementation quality
2. **work-explorer** agent - Low cost, high utility for searches
3. **work-analyst** agent - Improves planning phase

**Files to Create**:
- `src/main/services/agent-definitions.ts` - Central agent registry
- `src/main/services/work-researcher-service.ts`
- `src/main/services/work-explorer-service.ts`
- `src/main/services/work-analyst-service.ts`

**Files to Modify**:
- `src/shared/bvs-types.ts` - Add agent type definitions
- `src/main/services/bvs-orchestrator-service.ts` - Integrate new agents

---

### Phase 2: Enhancement (Week 2)

⚠️ **Consider**:
1. **work-tester vision enhancement** - Add screenshot analysis
2. **work-designer** agent - Split from frontend developer (optional)

**Files to Modify**:
- `src/main/services/bvs-e2e-testing-service.ts` - Add vision analysis

---

### Phase 3: Complexity-Aware Routing (Week 3)

✅ **Implement** (from previous analysis):
1. Complexity scoring for sections
2. Automatic model selection (Haiku/Sonnet/Opus)
3. Agent selection based on task type

**Implementation**:
```typescript
// Agent selection logic
function selectAgent(section: BvsSection): { agent: string, model: string } {
  const complexity = calculateComplexity(section)

  // Research phase
  if (section.requiresResearch) {
    return { agent: 'work-researcher', model: 'sonnet' }
  }

  // Analysis phase
  if (complexity >= 10 && section.requiresArchitecture) {
    return { agent: 'work-analyst', model: 'opus' }
  }

  // Implementation phase
  if (section.type === 'frontend') {
    if (section.hasDesignRequirements) {
      return { agent: 'work-designer', model: 'sonnet' }
    }
    return {
      agent: 'work-developer-frontend',
      model: complexity < 5 ? 'haiku' : 'sonnet'
    }
  }

  if (section.type === 'backend') {
    return {
      agent: 'work-developer-backend',
      model: complexity < 5 ? 'haiku' : 'sonnet'
    }
  }

  // Default
  return { agent: 'work-developer-backend', model: 'sonnet' }
}
```

---

## Comparison Summary

### OMC Agent Strengths
✅ **Analyst** - Dedicated requirement discovery
✅ **Researcher** - Documentation/best practices lookup
✅ **Explorer** - Fast Haiku-based search
✅ **Designer** - UI/UX specialization
✅ **Vision** - Screenshot analysis
✅ **Orchestrator** - Clean delegation pattern

### BVS Agent Strengths
✅ **8 Review Agents** - Multi-gate quality verification (OMC has none)
✅ **Architecture Tiers** - minimal/pragmatic/clean variants
✅ **Quality Checker** - Integrated lint/typecheck/test
✅ **Browser Tester** - Claude-in-Chrome E2E testing
✅ **Data Integrity Review** - Database safety specialist
✅ **Performance Review** - Performance optimization specialist

### Verdict

**BVS has superior verification architecture** (8 review agents vs. OMC's 1 critic)

**OMC has better support infrastructure** (researcher, explorer, analyst)

**Solution**: Add OMC's support agents to BVS while keeping BVS's verification rigor

---

## Implementation Recommendations

### ✅ MUST ADD (High Priority)
1. **work-researcher** (Sonnet) - Research best practices/docs
2. **work-explorer** (Haiku) - Fast pattern search
3. **work-analyst** (Opus) - Requirement discovery

**Rationale**: Fills critical gaps, improves implementation quality

---

### ⚠️ SHOULD CONSIDER (Medium Priority)
4. **work-tester vision enhancement** - Analyze screenshots automatically
5. **Complexity-aware routing** - Auto-select Haiku/Sonnet/Opus based on task

**Rationale**: Quality improvement, cost optimization

---

### ⏭️ SKIP (Low Priority)
6. **work-designer** separate agent - Frontend agent is sufficient for now
7. **work-orchestrator** agent - Service-based orchestration works well
8. **work-writer** documentation agent - Not core to verified code workflow

**Rationale**: Marginal benefit, adds complexity

---

## Expected Benefits After Enhancement

### Cost Optimization
- **work-explorer** (Haiku) for searches: 80% cost reduction vs. Sonnet
- Complexity-aware routing: 20-30% overall cost reduction

### Quality Improvement
- **work-researcher**: Better implementation decisions (fewer rework cycles)
- **work-analyst**: Clearer requirements (fewer misunderstandings)
- Vision-enhanced testing: Catch visual bugs automatically

### Speed Improvement
- **work-explorer**: 3-5x faster pattern searches
- Better research: Fewer trial-and-error cycles

### Metrics to Track
- Research phase adoption rate (% of sections using researcher)
- Rework reduction (before vs. after research phase)
- Average cost per section (with Haiku explorer vs. Sonnet)
- Visual bug detection rate (vision-enhanced tester)

---

## Conclusion

### Should We Adopt OMC's Agent System?

**NO - Full adoption**, but **YES - Selective enhancement**

**Add These 3 Critical Agents**:
1. ✅ work-researcher (Sonnet) - Documentation/best practices
2. ✅ work-explorer (Haiku) - Fast search
3. ✅ work-analyst (Opus) - Requirement analysis

**Keep All BVS Review Agents**:
- This is BVS's core differentiator (8 specialized review agents)
- OMC has no equivalent verification system

**Enhance Existing**:
- Add vision analysis to work-tester
- Add complexity-aware model selection

**Skip These**:
- Orchestrator agent (service-based works better)
- Designer agent (frontend developer is sufficient)
- Writer agent (not core workflow)

**Final BVS Agent Count**: 21 agents (up from 16)
- Analysis: 2 (analyst, architect-clean)
- Implementation: 5 (backend, frontend, 3 architect variants)
- Review: 8 (correctness, typescript, conventions, simplicity, security, architecture, data-integrity, performance)
- Quality: 2 (quality-checker, tester)
- Support: 4 (researcher, explorer, investigator, planner)

**Architecture**: BVS keeps service-based orchestration with enhanced agent specialization

**Result**: Best of both worlds - OMC's research/exploration capabilities + BVS's verification rigor

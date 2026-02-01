# PRD: BVS Parallel Execution Improvements

## Document Information

| Field | Value |
|-------|-------|
| **Document ID** | PRD-BVS-2026-001 |
| **Version** | 1.0 |
| **Status** | Draft |
| **Author** | Claude |
| **Created** | 2026-01-29 |
| **Last Updated** | 2026-01-29 |

---

## Executive Summary

This PRD outlines improvements to the BVS (Bounded Verified Sections) parallel execution system, inspired by the Ultrapilot architecture in oh-my-claudecode. The primary goal is to shift from **reactive conflict resolution** to **proactive conflict prevention** through exclusive file ownership, intelligent task decomposition, and mandatory validation gates.

### Key Outcomes
- **Eliminate merge conflicts** through exclusive file ownership
- **Improve parallel efficiency** with AI-powered decomposition
- **Guarantee quality** with mandatory validation gates
- **Prevent runtime conflicts** with mode registry

### Success Metrics
| Metric | Current | Target |
|--------|---------|--------|
| Merge conflicts per execution | ~2-5 | 0 |
| Parallel efficiency | ~60% | >90% |
| Validation skip rate | ~15% | 0% |
| Execution time (5 sections) | ~15 min | ~8 min |

---

## Problem Statement

### Current State

BVS currently uses a **reactive conflict resolution** approach:

1. **Planning Phase**: Sections are created with file lists, but no ownership analysis
2. **Execution Phase**: Workers execute in parallel, potentially modifying same files
3. **Merge Phase**: Post-hoc conflict detection and AI-powered resolution
4. **Validation Phase**: Quality gates run but can be bypassed

### Pain Points

| Issue | Impact | Frequency |
|-------|--------|-----------|
| Merge conflicts in shared files | Worker retry, increased cost | High |
| Config file races (package.json) | Build failures | Medium |
| Suboptimal parallelization | Longer execution time | High |
| Skipped validation | Quality issues in output | Medium |
| Conflicting executions | State corruption | Low |

### Root Causes

1. **No file ownership model** - Workers don't know what files they exclusively own
2. **No shared file classification** - Config files treated same as domain files
3. **Manual dependency analysis** - Planning agent doesn't optimize for parallelism
4. **Optional validation** - Quality gates not enforced as completion prerequisite

---

## Proposed Solution

### Solution Overview

Adopt Ultrapilot's **proactive conflict prevention** model:

```
┌─────────────────────────────────────────────────────────────────┐
│                    CURRENT BVS FLOW                             │
├─────────────────────────────────────────────────────────────────┤
│  Plan → Execute Parallel → Merge (resolve conflicts) → Validate │
│                              ↑                                  │
│                        CONFLICTS HERE                           │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    PROPOSED BVS FLOW                            │
├─────────────────────────────────────────────────────────────────┤
│  Plan → Decompose → Validate Ownership → Execute → Validate     │
│            ↓              ↓                                     │
│     Assign exclusive   Reject if                                │
│     file ownership     conflicts                                │
│            ↓                                                    │
│     Classify shared                                             │
│     files (deferred)                                            │
└─────────────────────────────────────────────────────────────────┘
```

---

## Feature Specifications

## P0: Exclusive File Ownership System

### P0.1: File Ownership Data Model

**Priority**: P0 (Critical)
**Effort**: Medium
**Dependencies**: None

#### Overview

Introduce an exclusive file ownership model where each section owns specific files that no other section can modify during parallel execution.

#### Data Structures

```typescript
// New types in bvs-types.ts

interface FileOwnership {
  /** Files this section exclusively owns */
  exclusiveFiles: string[];

  /** Glob patterns this section owns (e.g., "src/api/**") */
  exclusiveGlobs: string[];

  /** Files this section reads but doesn't modify */
  readOnlyDependencies: string[];

  /** Cross-boundary imports (for tracking) */
  boundaryImports: string[];
}

interface BvsSectionV2 extends BvsSection {
  /** File ownership for this section */
  ownership: FileOwnership;

  /** Whether ownership has been validated */
  ownershipValidated: boolean;
}

interface OwnershipMap {
  /** Map of file path to owning section ID */
  fileToSection: Record<string, string>;

  /** Map of glob pattern to owning section ID */
  globToSection: Record<string, string>;

  /** Files classified as shared (no exclusive owner) */
  sharedFiles: string[];

  /** Validation timestamp */
  validatedAt: string;
}
```

#### Ownership Rules

1. **Exclusivity**: Each file can have at most ONE exclusive owner
2. **Glob Precedence**: More specific paths override less specific globs
3. **Inheritance**: Subdirectories inherit parent directory ownership unless overridden
4. **Shared Classification**: Files in multiple sections auto-classified as shared

#### API

```typescript
// New service: bvs-ownership-service.ts

interface BvsOwnershipService {
  /**
   * Build ownership map from sections
   * Throws if conflicts detected
   */
  buildOwnershipMap(sections: BvsSectionV2[]): OwnershipMap;

  /**
   * Check if a file is owned by a specific section
   */
  isFileOwnedBy(file: string, sectionId: string, map: OwnershipMap): boolean;

  /**
   * Check if a file is shared (no exclusive owner)
   */
  isSharedFile(file: string, map: OwnershipMap): boolean;

  /**
   * Validate that no ownership conflicts exist
   */
  validateOwnership(map: OwnershipMap): ValidationResult;

  /**
   * Get all files a section can modify
   */
  getModifiableFiles(sectionId: string, map: OwnershipMap): string[];
}
```

#### Acceptance Criteria

- [ ] `FileOwnership` type added to `bvs-types.ts`
- [ ] `BvsSectionV2` extends section with ownership
- [ ] `BvsOwnershipService` implemented with all methods
- [ ] Ownership map persisted in `progress.json`
- [ ] Unit tests for all ownership scenarios
- [ ] Conflicts throw descriptive errors

---

### P0.2: Shared File Classification

**Priority**: P0 (Critical)
**Effort**: Medium
**Dependencies**: P0.1

#### Overview

Automatically classify files that appear in multiple sections as "shared" and handle them separately from exclusive files.

#### Shared File Patterns

```typescript
// Default shared file patterns (auto-detected)
const DEFAULT_SHARED_PATTERNS = [
  // Package management
  'package.json',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',

  // TypeScript/JavaScript config
  'tsconfig.json',
  'tsconfig.*.json',
  'jsconfig.json',
  '*.config.js',
  '*.config.ts',
  '*.config.mjs',

  // Linting/Formatting
  '.eslintrc.*',
  '.prettierrc.*',
  '.stylelintrc.*',
  'biome.json',

  // Build tools
  'vite.config.*',
  'webpack.config.*',
  'rollup.config.*',
  'next.config.*',
  'tailwind.config.*',
  'postcss.config.*',

  // Documentation
  'README.md',
  'CHANGELOG.md',
  'CONTRIBUTING.md',

  // Docker/CI
  'Dockerfile',
  'docker-compose.yml',
  '.github/**',
  '.gitlab-ci.yml',

  // Environment
  '.env.example',
  '.env.local.example',

  // Prisma/Database
  'prisma/schema.prisma',

  // Type definitions
  'src/types/index.ts',
  'src/types.ts',
  'types/*.d.ts'
];
```

#### Classification Algorithm

```typescript
interface ClassificationResult {
  /** Files with single owner */
  exclusiveFiles: Map<string, string>; // file -> sectionId

  /** Files in multiple sections */
  sharedFiles: string[];

  /** Files matching shared patterns */
  patternMatchedShared: string[];

  /** Conflicts that need resolution */
  conflicts: FileConflict[];
}

interface FileConflict {
  file: string;
  claimingSections: string[];
  resolution: 'first-wins' | 'shared' | 'manual';
}

function classifyFiles(
  sections: BvsSectionV2[],
  customPatterns?: string[]
): ClassificationResult {
  // 1. Build file -> sections map
  // 2. Apply shared patterns
  // 3. Detect multi-section files
  // 4. Generate classification
}
```

#### Shared File Handling Strategy

```
Shared files are NOT modified during parallel execution.
They are handled in a dedicated INTEGRATION phase:

┌──────────────────────────────────────────────────┐
│              PARALLEL EXECUTION                  │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐            │
│  │ Worker1 │ │ Worker2 │ │ Worker3 │            │
│  │ api/*   │ │ ui/*    │ │ db/*    │            │
│  └────┬────┘ └────┬────┘ └────┬────┘            │
│       │           │           │                  │
│       ▼           ▼           ▼                  │
│  ┌─────────────────────────────────────┐        │
│  │      INTEGRATION PHASE              │        │
│  │  - Collect shared file changes      │        │
│  │  - Apply sequentially               │        │
│  │  - Resolve any conflicts            │        │
│  │  - Update: package.json, types, etc │        │
│  └─────────────────────────────────────┘        │
└──────────────────────────────────────────────────┘
```

#### Acceptance Criteria

- [ ] `DEFAULT_SHARED_PATTERNS` constant defined
- [ ] `classifyFiles()` function implemented
- [ ] Custom patterns supported via config
- [ ] Integration phase handles shared files sequentially
- [ ] Shared file changes collected from all workers
- [ ] Sequential application prevents conflicts
- [ ] Unit tests for pattern matching
- [ ] Integration tests for shared file handling

---

### P0.3: Ownership Enforcement in Workers

**Priority**: P0 (Critical)
**Effort**: Medium
**Dependencies**: P0.1, P0.2

#### Overview

Enforce file ownership in worker execution - workers can only modify files they own.

#### Worker Prompt Enhancement

```typescript
function buildWorkerPromptWithOwnership(
  section: BvsSectionV2,
  ownershipMap: OwnershipMap,
  config: WorkerConfig
): string {
  const ownedFiles = getModifiableFiles(section.id, ownershipMap);
  const readOnlyFiles = section.ownership.readOnlyDependencies;

  return `
## BVS WORKER [${config.workerId}] - SECTION: ${section.name}

### FILE OWNERSHIP (ENFORCED)

**You EXCLUSIVELY own these files (can create/modify/delete):**
${ownedFiles.map(f => `- ${f}`).join('\n')}

**You can READ but NOT MODIFY these files:**
${readOnlyFiles.map(f => `- ${f}`).join('\n')}

**SHARED FILES (handled separately - DO NOT MODIFY):**
${ownershipMap.sharedFiles.map(f => `- ${f}`).join('\n')}

### BOUNDARY RULES

1. ✅ CREATE new files within your owned directories
2. ✅ MODIFY files you exclusively own
3. ✅ READ any file in the codebase
4. ❌ DO NOT modify shared files (package.json, tsconfig.json, etc.)
5. ❌ DO NOT modify files owned by other sections
6. ❌ DO NOT create files outside your owned directories

### TASK

${section.task}

### SUCCESS CRITERIA

${section.successCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

### WHEN COMPLETE

Report files created/modified. The orchestrator will handle shared file updates.
`;
}
```

#### Tool-Level Enforcement

```typescript
// In MCP server tool definitions

const writeFileTool = {
  name: 'write_file',
  description: 'Write content to a file (ownership enforced)',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      content: { type: 'string' }
    }
  },
  handler: async (params, context) => {
    const { path, content } = params;
    const { sectionId, ownershipMap } = context;

    // ENFORCEMENT: Check ownership before writing
    if (!isFileOwnedBy(path, sectionId, ownershipMap)) {
      if (isSharedFile(path, ownershipMap)) {
        return {
          error: `Cannot modify shared file '${path}'. ` +
                 `Add to sharedFileChanges instead.`
        };
      }
      const owner = ownershipMap.fileToSection[path];
      return {
        error: `Cannot modify '${path}' - owned by section '${owner}'. ` +
               `Only modify files within your ownership.`
      };
    }

    // Proceed with write
    await fs.writeFile(path, content);
    return { success: true, path };
  }
};
```

#### Shared File Change Collection

```typescript
interface SharedFileChange {
  file: string;
  sectionId: string;
  changeType: 'add-dependency' | 'add-script' | 'add-type' | 'modify';
  description: string;

  // For package.json changes
  packageChanges?: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    scripts?: Record<string, string>;
  };

  // For type file changes
  typeChanges?: {
    exports?: string[];
    imports?: string[];
  };

  // For raw content changes (last resort)
  contentPatch?: string;
}

// Workers report shared file needs instead of modifying directly
const reportSharedFileNeedTool = {
  name: 'report_shared_file_need',
  description: 'Report a needed change to a shared file',
  inputSchema: {
    type: 'object',
    properties: {
      file: { type: 'string' },
      changeType: { type: 'string' },
      description: { type: 'string' },
      packageChanges: { type: 'object' },
      typeChanges: { type: 'object' }
    }
  },
  handler: async (params, context) => {
    const change: SharedFileChange = {
      ...params,
      sectionId: context.sectionId
    };
    context.sharedFileChanges.push(change);
    return {
      success: true,
      message: `Shared file change recorded. Will be applied in integration phase.`
    };
  }
};
```

#### Acceptance Criteria

- [ ] Worker prompts include ownership information
- [ ] `write_file` tool enforces ownership
- [ ] `edit_file` tool enforces ownership
- [ ] Shared file modifications rejected with helpful error
- [ ] `report_shared_file_need` tool implemented
- [ ] Shared file changes collected per worker
- [ ] Integration phase applies collected changes
- [ ] Enforcement tests (attempt to violate ownership)

---

## P1: AI-Powered Task Decomposition

### P1.1: Decomposition Engine

**Priority**: P1 (High)
**Effort**: High
**Dependencies**: P0.1, P0.2

#### Overview

Enhance the planning agent to perform intelligent task decomposition with parallelization analysis, dependency detection, and file ownership assignment.

#### Decomposition Output

```typescript
interface DecomposedPlan {
  /** Original user requirement */
  requirement: string;

  /** Decomposed sections with ownership */
  sections: BvsSectionV2[];

  /** Parallel execution groups */
  parallelGroups: ParallelGroup[];

  /** Files classified as shared */
  sharedFiles: string[];

  /** Critical path (longest dependency chain) */
  criticalPath: CriticalPath;

  /** Decomposition metadata */
  metadata: DecompositionMetadata;
}

interface ParallelGroup {
  /** Group index (execution order) */
  level: number;

  /** Section IDs that can run in parallel */
  sectionIds: string[];

  /** Why these are grouped together */
  rationale: string;

  /** Estimated duration for this group */
  estimatedDuration?: number;
}

interface CriticalPath {
  /** Section IDs in critical path order */
  path: string[];

  /** Total estimated duration */
  totalDuration: number;

  /** Bottleneck section (longest single section) */
  bottleneck: string;
}

interface DecompositionMetadata {
  /** Model used for decomposition */
  model: 'opus' | 'sonnet';

  /** Time taken to decompose */
  decompositionTimeMs: number;

  /** Number of iterations to resolve conflicts */
  conflictResolutionIterations: number;

  /** Parallelization efficiency score */
  parallelizationScore: number; // 0-1
}
```

#### Decomposition Algorithm

```typescript
async function decomposeTask(
  requirement: string,
  codebaseContext: CodebaseContext
): Promise<DecomposedPlan> {

  // Phase 1: Initial decomposition
  const initialSections = await architectAgent.decompose(requirement, codebaseContext);

  // Phase 2: File ownership analysis
  const ownershipAnalysis = analyzeFileOwnership(initialSections);

  // Phase 3: Conflict resolution
  let sections = initialSections;
  let iterations = 0;
  while (ownershipAnalysis.hasConflicts && iterations < 3) {
    sections = await resolveOwnershipConflicts(sections, ownershipAnalysis.conflicts);
    ownershipAnalysis = analyzeFileOwnership(sections);
    iterations++;
  }

  // Phase 4: Dependency graph construction
  const dependencyGraph = buildDependencyGraph(sections);

  // Phase 5: Parallel grouping
  const parallelGroups = computeParallelGroups(dependencyGraph);

  // Phase 6: Critical path analysis
  const criticalPath = computeCriticalPath(dependencyGraph);

  // Phase 7: Shared file classification
  const sharedFiles = classifySharedFiles(sections);

  return {
    requirement,
    sections,
    parallelGroups,
    sharedFiles,
    criticalPath,
    metadata: {
      model: 'opus',
      decompositionTimeMs: Date.now() - startTime,
      conflictResolutionIterations: iterations,
      parallelizationScore: computeParallelizationScore(parallelGroups)
    }
  };
}
```

#### Architect Agent Prompt

```typescript
const DECOMPOSITION_PROMPT = `
You are a software architect decomposing a task into parallelizable sections.

## TASK
{requirement}

## CODEBASE CONTEXT
{codebaseContext}

## INSTRUCTIONS

Decompose this task into sections that can be executed by parallel workers.

### RULES

1. **Independence**: Each section should be as independent as possible
2. **File Ownership**: Assign exclusive file ownership to each section
3. **No Overlaps**: Files should not appear in multiple sections
4. **Shared Files**: Identify files that must be shared (config, types)
5. **Dependencies**: Explicitly state what each section depends on
6. **Granularity**: Aim for 3-7 sections (more = better parallelism, but more overhead)

### OUTPUT FORMAT

Return a JSON object with this structure:

{
  "sections": [
    {
      "id": "s1",
      "name": "API Routes",
      "task": "Create REST API endpoints for user management",
      "files": ["src/api/users.ts", "src/api/users.test.ts"],
      "exclusiveGlobs": ["src/api/users*"],
      "dependencies": [],
      "successCriteria": ["GET /users returns user list", "POST /users creates user"]
    },
    {
      "id": "s2",
      "name": "Database Models",
      "task": "Create Prisma models for user data",
      "files": ["prisma/schema.prisma"],
      "exclusiveGlobs": [],
      "dependencies": [],
      "successCriteria": ["User model with id, email, name fields"]
    },
    {
      "id": "s3",
      "name": "UI Components",
      "task": "Create React components for user management",
      "files": ["src/components/UserList.tsx", "src/components/UserForm.tsx"],
      "exclusiveGlobs": ["src/components/User*"],
      "dependencies": ["s1"],
      "successCriteria": ["UserList displays users", "UserForm submits to API"]
    }
  ],
  "sharedFiles": ["package.json", "tsconfig.json", "src/types/index.ts"],
  "parallelGroups": [
    { "level": 0, "sectionIds": ["s1", "s2"], "rationale": "No dependencies" },
    { "level": 1, "sectionIds": ["s3"], "rationale": "Depends on s1" }
  ]
}

### IMPORTANT

- If two sections need the same file, either:
  a. Merge the sections, OR
  b. Move the file to sharedFiles
- Dependencies should reference section IDs
- Each section should have clear, testable success criteria
`;
```

#### Acceptance Criteria

- [ ] `DecomposedPlan` type defined
- [ ] `decomposeTask()` function implemented
- [ ] Architect agent prompt created
- [ ] Ownership conflict detection works
- [ ] Automatic conflict resolution (up to 3 iterations)
- [ ] Parallel groups computed from dependencies
- [ ] Critical path calculated
- [ ] Parallelization score computed
- [ ] Integration with planning agent
- [ ] Unit tests for decomposition logic
- [ ] Integration tests with real tasks

---

### P1.2: Mandatory Validation Gate

**Priority**: P1 (High)
**Effort**: Low
**Dependencies**: None

#### Overview

Enforce validation as a mandatory pre-completion step. Execution cannot be marked complete without passing all validation gates.

#### Validation Requirements

```typescript
interface ValidationGateConfig {
  /** Required validation checks */
  required: {
    typecheck: boolean;  // TypeScript compilation
    lint: boolean;       // ESLint/Biome
    tests: boolean;      // Jest/Vitest
    build: boolean;      // Production build
  };

  /** Optional but recommended */
  recommended: {
    securityScan: boolean;
    e2eTests: boolean;
    coverageThreshold: number; // 0-100
  };

  /** Bypass settings (requires explicit user action) */
  allowBypass: {
    enabled: boolean;
    requiresReason: boolean;
    auditLog: boolean;
  };
}

const DEFAULT_VALIDATION_CONFIG: ValidationGateConfig = {
  required: {
    typecheck: true,
    lint: true,
    tests: true,
    build: false  // Optional for speed
  },
  recommended: {
    securityScan: false,
    e2eTests: false,
    coverageThreshold: 0
  },
  allowBypass: {
    enabled: true,  // Can bypass but logged
    requiresReason: true,
    auditLog: true
  }
};
```

#### Validation State Machine

```
                    ┌─────────────┐
                    │   PENDING   │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │  EXECUTING  │
                    └──────┬──────┘
                           │
              ┌────────────┴────────────┐
              │                         │
       ┌──────▼──────┐          ┌──────▼──────┐
       │   SUCCESS   │          │   FAILED    │
       └──────┬──────┘          └──────┬──────┘
              │                        │
       ┌──────▼──────┐          ┌──────▼──────┐
       │  VALIDATING │◄─────────│   FIXING    │
       └──────┬──────┘          └─────────────┘
              │
    ┌─────────┴─────────┐
    │                   │
┌───▼────┐        ┌─────▼─────┐
│ PASSED │        │  FAILED   │──┐
└───┬────┘        └───────────┘  │
    │                            │
    │         ┌──────────────────┘
    │         │
┌───▼─────────▼───┐
│  AWAITING_USER  │  (bypass decision)
└───────┬─────────┘
        │
   ┌────┴────┐
   │         │
┌──▼──┐  ┌───▼───┐
│DONE │  │BYPASS │
└─────┘  └───────┘
```

#### Enforcement Logic

```typescript
async function completeExecution(sessionId: string): Promise<CompletionResult> {
  const session = getSession(sessionId);

  // Check all sections completed
  const incompleteSections = session.sections.filter(
    s => s.status !== 'done' && s.status !== 'skipped'
  );
  if (incompleteSections.length > 0) {
    throw new ExecutionError(
      `Cannot complete: ${incompleteSections.length} sections still pending`,
      { sections: incompleteSections.map(s => s.id) }
    );
  }

  // MANDATORY: Validation must have been run
  if (!session.validationRun) {
    throw new ValidationError(
      'Cannot complete without running validation gate. ' +
      'Run validation first or explicitly bypass with reason.'
    );
  }

  // Check validation results
  const validationResult = session.validationResult;
  const config = session.validationConfig || DEFAULT_VALIDATION_CONFIG;

  const failures: ValidationFailure[] = [];

  if (config.required.typecheck && validationResult.typecheck !== 'pass') {
    failures.push({ check: 'typecheck', result: validationResult.typecheck });
  }
  if (config.required.lint && validationResult.lint !== 'pass') {
    failures.push({ check: 'lint', result: validationResult.lint });
  }
  if (config.required.tests && validationResult.tests !== 'pass') {
    failures.push({ check: 'tests', result: validationResult.tests });
  }
  if (config.required.build && validationResult.build !== 'pass') {
    failures.push({ check: 'build', result: validationResult.build });
  }

  if (failures.length > 0) {
    // Check for bypass
    if (session.validationBypass) {
      // Log bypass for audit
      await auditLog({
        event: 'validation_bypass',
        sessionId,
        failures,
        reason: session.validationBypass.reason,
        user: session.validationBypass.user,
        timestamp: new Date().toISOString()
      });

      return {
        status: 'completed_with_bypass',
        bypassedChecks: failures.map(f => f.check),
        bypassReason: session.validationBypass.reason
      };
    }

    throw new ValidationError(
      `Validation failed: ${failures.map(f => f.check).join(', ')}. ` +
      `Fix issues or bypass with explicit reason.`,
      { failures }
    );
  }

  return { status: 'completed', validationPassed: true };
}
```

#### Bypass Workflow

```typescript
interface ValidationBypass {
  /** Who requested the bypass */
  user: string;

  /** Why bypass is needed */
  reason: string;

  /** Which checks are being bypassed */
  checks: string[];

  /** Timestamp of bypass request */
  timestamp: string;

  /** Acknowledgment of risks */
  acknowledgedRisks: boolean;
}

async function requestValidationBypass(
  sessionId: string,
  bypass: Omit<ValidationBypass, 'timestamp'>
): Promise<void> {
  if (!bypass.reason || bypass.reason.length < 20) {
    throw new Error('Bypass reason must be at least 20 characters');
  }

  if (!bypass.acknowledgedRisks) {
    throw new Error('Must acknowledge risks before bypassing validation');
  }

  const session = getSession(sessionId);
  session.validationBypass = {
    ...bypass,
    timestamp: new Date().toISOString()
  };

  await saveSession(session);
}
```

#### UI Integration

```typescript
// Validation gate status in UI
interface ValidationGateUI {
  /** Show validation status prominently */
  showStatus: boolean;

  /** Block "Complete" button until validation passes/bypassed */
  blockCompletion: boolean;

  /** Show bypass option (with warning) */
  showBypassOption: boolean;

  /** Require confirmation dialog for bypass */
  requireBypassConfirmation: boolean;
}
```

#### Acceptance Criteria

- [ ] `ValidationGateConfig` type defined
- [ ] Validation state machine implemented
- [ ] `completeExecution()` enforces validation
- [ ] Bypass workflow with reason requirement
- [ ] Audit logging for bypasses
- [ ] UI blocks completion until validated
- [ ] Bypass confirmation dialog
- [ ] Unit tests for enforcement logic
- [ ] Integration tests for full flow

---

## P2: Mode Registry & Conflict Prevention

### P2.1: BVS Mode Registry

**Priority**: P2 (Medium)
**Effort**: Medium
**Dependencies**: None

#### Overview

Implement a mode registry to prevent conflicting BVS operations and provide clear status visibility.

#### Mode Definitions

```typescript
type BvsMode =
  | 'idle'           // No active operation
  | 'planning'       // Planning agent active
  | 'decomposing'    // Task decomposition in progress
  | 'executing'      // Section execution in progress
  | 'validating'     // Validation gate running
  | 'integrating';   // Shared file integration

interface ModeConfig {
  name: string;
  exclusive: boolean;      // Only one instance allowed
  conflictsWith: BvsMode[]; // Modes that can't run simultaneously
  allowsSubMode: BvsMode[]; // Modes that can run within this mode
}

const MODE_CONFIGS: Record<BvsMode, ModeConfig> = {
  idle: {
    name: 'Idle',
    exclusive: false,
    conflictsWith: [],
    allowsSubMode: ['planning', 'executing']
  },
  planning: {
    name: 'Planning',
    exclusive: true,
    conflictsWith: ['executing', 'decomposing'],
    allowsSubMode: []
  },
  decomposing: {
    name: 'Decomposing',
    exclusive: true,
    conflictsWith: ['planning', 'executing'],
    allowsSubMode: []
  },
  executing: {
    name: 'Executing',
    exclusive: true,
    conflictsWith: ['planning', 'decomposing'],
    allowsSubMode: ['validating', 'integrating']
  },
  validating: {
    name: 'Validating',
    exclusive: false,
    conflictsWith: [],
    allowsSubMode: []
  },
  integrating: {
    name: 'Integrating',
    exclusive: true,
    conflictsWith: ['validating'],
    allowsSubMode: []
  }
};
```

#### Mode Registry Service

```typescript
// bvs-mode-registry.ts

interface ModeState {
  /** Current active mode */
  currentMode: BvsMode;

  /** Mode-specific data */
  modeData?: Record<string, unknown>;

  /** When mode was entered */
  enteredAt: string;

  /** Project/session this mode is for */
  projectId?: string;
  sessionId?: string;

  /** Sub-modes currently active */
  activeSubModes: BvsMode[];
}

interface ModeRegistry {
  /** Get current mode state */
  getState(): ModeState;

  /** Check if mode transition is allowed */
  canEnterMode(mode: BvsMode, context?: ModeContext): ModeTransitionResult;

  /** Enter a new mode */
  enterMode(mode: BvsMode, context?: ModeContext): Promise<void>;

  /** Exit current mode */
  exitMode(): Promise<void>;

  /** Force reset (for recovery) */
  forceReset(): Promise<void>;

  /** Subscribe to mode changes */
  onModeChange(callback: (state: ModeState) => void): () => void;
}

interface ModeTransitionResult {
  allowed: boolean;
  reason?: string;
  conflictingMode?: BvsMode;
  suggestion?: string;
}

class BvsModeRegistry implements ModeRegistry {
  private state: ModeState = {
    currentMode: 'idle',
    enteredAt: new Date().toISOString(),
    activeSubModes: []
  };

  private listeners: Set<(state: ModeState) => void> = new Set();
  private stateFile: string;

  constructor(workspaceDir: string) {
    this.stateFile = path.join(workspaceDir, '.bvs', 'mode-state.json');
    this.loadState();
  }

  canEnterMode(mode: BvsMode, context?: ModeContext): ModeTransitionResult {
    const config = MODE_CONFIGS[mode];
    const currentConfig = MODE_CONFIGS[this.state.currentMode];

    // Check if current mode allows this as sub-mode
    if (currentConfig.allowsSubMode.includes(mode)) {
      return { allowed: true };
    }

    // Check for conflicts
    if (config.conflictsWith.includes(this.state.currentMode)) {
      return {
        allowed: false,
        reason: `Cannot enter '${mode}' while '${this.state.currentMode}' is active`,
        conflictingMode: this.state.currentMode,
        suggestion: `Wait for ${this.state.currentMode} to complete or cancel it first`
      };
    }

    // Check exclusivity
    if (config.exclusive && this.state.currentMode !== 'idle') {
      return {
        allowed: false,
        reason: `'${mode}' requires exclusive access`,
        conflictingMode: this.state.currentMode,
        suggestion: `Exit ${this.state.currentMode} mode first`
      };
    }

    return { allowed: true };
  }

  async enterMode(mode: BvsMode, context?: ModeContext): Promise<void> {
    const result = this.canEnterMode(mode, context);
    if (!result.allowed) {
      throw new ModeConflictError(result.reason!, result.conflictingMode);
    }

    // Check if this is a sub-mode
    const currentConfig = MODE_CONFIGS[this.state.currentMode];
    if (currentConfig.allowsSubMode.includes(mode)) {
      this.state.activeSubModes.push(mode);
    } else {
      this.state = {
        currentMode: mode,
        enteredAt: new Date().toISOString(),
        projectId: context?.projectId,
        sessionId: context?.sessionId,
        activeSubModes: []
      };
    }

    await this.saveState();
    this.notifyListeners();
  }

  async exitMode(): Promise<void> {
    // Exit sub-mode if any active
    if (this.state.activeSubModes.length > 0) {
      this.state.activeSubModes.pop();
    } else {
      this.state = {
        currentMode: 'idle',
        enteredAt: new Date().toISOString(),
        activeSubModes: []
      };
    }

    await this.saveState();
    this.notifyListeners();
  }

  async forceReset(): Promise<void> {
    this.state = {
      currentMode: 'idle',
      enteredAt: new Date().toISOString(),
      activeSubModes: []
    };
    await this.saveState();
    this.notifyListeners();
  }

  // ... other methods
}
```

#### Integration with Orchestrator

```typescript
// In bvs-orchestrator-service.ts

class BvsOrchestratorService {
  private modeRegistry: BvsModeRegistry;

  async startExecution(sessionId: string): Promise<void> {
    // Check mode before starting
    const canExecute = this.modeRegistry.canEnterMode('executing', {
      sessionId,
      projectId: this.getProjectId(sessionId)
    });

    if (!canExecute.allowed) {
      throw new Error(canExecute.reason);
    }

    // Enter execution mode
    await this.modeRegistry.enterMode('executing', {
      sessionId,
      projectId: this.getProjectId(sessionId)
    });

    try {
      // ... execution logic
    } finally {
      await this.modeRegistry.exitMode();
    }
  }
}
```

#### Acceptance Criteria

- [ ] `BvsMode` type and configs defined
- [ ] `ModeRegistry` interface implemented
- [ ] Mode state persisted to `.bvs/mode-state.json`
- [ ] Conflict detection works correctly
- [ ] Sub-mode support (validating within executing)
- [ ] Force reset for recovery scenarios
- [ ] Event subscription for UI updates
- [ ] Integration with orchestrator
- [ ] UI status indicator for current mode
- [ ] Unit tests for mode transitions
- [ ] Integration tests with orchestrator

---

### P2.2: Worker Skill Injection

**Priority**: P2 (Medium)
**Effort**: Low
**Dependencies**: P0.3

#### Overview

Inject mandatory best practices into worker prompts to ensure consistent quality across all workers.

#### Skill Definitions

```typescript
interface WorkerSkill {
  /** Skill identifier */
  id: string;

  /** When to apply this skill */
  trigger: 'always' | 'on-error' | 'on-new-file' | 'on-test';

  /** Skill instructions */
  instructions: string;

  /** Priority (higher = earlier in prompt) */
  priority: number;
}

const MANDATORY_SKILLS: WorkerSkill[] = [
  {
    id: 'tdd',
    trigger: 'on-new-file',
    priority: 100,
    instructions: `
## TEST-DRIVEN DEVELOPMENT (MANDATORY)

When creating new functionality:
1. Write the test FIRST
2. Run the test (it should fail)
3. Write the implementation
4. Run the test (it should pass)
5. Refactor if needed

DO NOT skip tests. Every new function needs a corresponding test.
`
  },
  {
    id: 'typecheck',
    trigger: 'always',
    priority: 90,
    instructions: `
## TYPE SAFETY (MANDATORY)

After modifying any TypeScript file:
1. Run \`npx tsc --noEmit\` to check types
2. Fix any type errors before proceeding
3. Do not use \`any\` type - use proper types or \`unknown\`

Type errors MUST be fixed before reporting completion.
`
  },
  {
    id: 'systematic-debug',
    trigger: 'on-error',
    priority: 80,
    instructions: `
## SYSTEMATIC DEBUGGING (ON ERROR)

When you encounter an error:
1. READ the full error message
2. IDENTIFY the root cause (not symptoms)
3. HYPOTHESIZE what's wrong
4. TEST your hypothesis with minimal change
5. VERIFY the fix resolves the issue

DO NOT make random changes hoping something works.
`
  },
  {
    id: 'verification',
    trigger: 'always',
    priority: 70,
    instructions: `
## VERIFICATION (MANDATORY BEFORE COMPLETION)

Before reporting task complete:
1. Re-read the success criteria
2. Verify EACH criterion is met
3. Run relevant tests
4. Check for regressions

Only report completion when ALL criteria verified.
`
  }
];
```

#### Skill Injection Logic

```typescript
function buildWorkerPromptWithSkills(
  section: BvsSectionV2,
  ownershipMap: OwnershipMap,
  config: WorkerConfig,
  context: WorkerContext
): string {
  // Determine which skills apply
  const applicableSkills = MANDATORY_SKILLS.filter(skill => {
    switch (skill.trigger) {
      case 'always':
        return true;
      case 'on-new-file':
        return section.files.some(f => !fs.existsSync(f));
      case 'on-error':
        return context.previousAttemptFailed;
      case 'on-test':
        return section.files.some(f => f.includes('.test.') || f.includes('.spec.'));
      default:
        return false;
    }
  });

  // Sort by priority (highest first)
  applicableSkills.sort((a, b) => b.priority - a.priority);

  // Build prompt with skills
  const skillSection = applicableSkills.length > 0
    ? `
## MANDATORY PRACTICES

${applicableSkills.map(s => s.instructions).join('\n\n')}
`
    : '';

  return `
## BVS WORKER [${config.workerId}] - SECTION: ${section.name}

${skillSection}

### FILE OWNERSHIP
${buildOwnershipSection(section, ownershipMap)}

### TASK
${section.task}

### SUCCESS CRITERIA
${section.successCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}
`;
}
```

#### Custom Skill Configuration

```typescript
// In .bvs/config.json

interface BvsConfig {
  /** Custom skills to inject */
  customSkills?: WorkerSkill[];

  /** Skills to disable */
  disabledSkills?: string[];

  /** Skill priority overrides */
  skillPriorities?: Record<string, number>;
}

// Example config
{
  "customSkills": [
    {
      "id": "prisma-patterns",
      "trigger": "always",
      "priority": 60,
      "instructions": "Use Prisma client for all database operations. Never write raw SQL."
    }
  ],
  "disabledSkills": [],
  "skillPriorities": {
    "tdd": 100,
    "typecheck": 95
  }
}
```

#### Acceptance Criteria

- [ ] `WorkerSkill` type defined
- [ ] `MANDATORY_SKILLS` array populated
- [ ] Skill injection in worker prompt builder
- [ ] Trigger-based skill filtering
- [ ] Priority-based ordering
- [ ] Custom skills via config
- [ ] Skill disable option
- [ ] Unit tests for skill injection
- [ ] Integration tests with workers

---

## Implementation Plan

### Phase 1: Foundation (P0) - Week 1-2

| Day | Task | Owner |
|-----|------|-------|
| 1-2 | P0.1: File ownership data model | Backend |
| 3-4 | P0.1: Ownership service implementation | Backend |
| 5-6 | P0.2: Shared file classification | Backend |
| 7-8 | P0.2: Integration phase for shared files | Backend |
| 9-10 | P0.3: Worker enforcement | Backend |
| 11-12 | P0.3: Shared file change collection | Backend |
| 13-14 | Testing & bug fixes | Full team |

### Phase 2: Intelligence (P1) - Week 3-4

| Day | Task | Owner |
|-----|------|-------|
| 1-3 | P1.1: Decomposition engine | Backend |
| 4-5 | P1.1: Architect agent prompt | Backend |
| 6-7 | P1.1: Parallel group computation | Backend |
| 8-9 | P1.2: Validation gate enforcement | Backend |
| 10-11 | P1.2: Bypass workflow | Backend |
| 12 | P1.2: UI integration | Frontend |
| 13-14 | Testing & bug fixes | Full team |

### Phase 3: Polish (P2) - Week 5

| Day | Task | Owner |
|-----|------|-------|
| 1-2 | P2.1: Mode registry service | Backend |
| 3 | P2.1: Orchestrator integration | Backend |
| 4 | P2.1: UI status indicator | Frontend |
| 5-6 | P2.2: Worker skill injection | Backend |
| 7 | P2.2: Custom skill config | Backend |
| 8-10 | End-to-end testing | Full team |

---

## Success Metrics

### P0 Metrics

| Metric | Baseline | Target | Measurement |
|--------|----------|--------|-------------|
| Merge conflicts per execution | ~2-5 | 0 | Count conflicts in integration phase |
| Worker boundary violations | Unknown | 0 | Count enforcement rejections |
| Config file race conditions | ~1-2 | 0 | Count package.json conflicts |

### P1 Metrics

| Metric | Baseline | Target | Measurement |
|--------|----------|--------|-------------|
| Parallelization efficiency | ~60% | >90% | (parallel sections / total sections) |
| Validation skip rate | ~15% | 0% | Count bypasses / total completions |
| Critical path accuracy | N/A | >80% | Predicted vs actual duration |

### P2 Metrics

| Metric | Baseline | Target | Measurement |
|--------|----------|--------|-------------|
| Conflicting operation attempts | Unknown | 0 | Mode registry rejections |
| Worker quality consistency | Variable | >90% | Sections passing first attempt |

---

## Risks & Mitigations

### Risk 1: Ownership Too Restrictive

**Risk**: Exclusive ownership prevents legitimate cross-section modifications
**Probability**: Medium
**Impact**: High
**Mitigation**:
- Allow read-only dependencies
- Shared file change collection system
- Easy ownership adjustment in planning

### Risk 2: Decomposition Quality

**Risk**: AI decomposition creates suboptimal parallel groups
**Probability**: Medium
**Impact**: Medium
**Mitigation**:
- Human review of decomposition before execution
- Ability to manually adjust groups
- Iterative refinement with conflict detection

### Risk 3: Validation Bypass Abuse

**Risk**: Users bypass validation too frequently
**Probability**: Low
**Impact**: High
**Mitigation**:
- Require detailed reason for bypass
- Audit logging for all bypasses
- Manager review option for bypasses

### Risk 4: Performance Overhead

**Risk**: Ownership checking adds latency
**Probability**: Low
**Impact**: Medium
**Mitigation**:
- Cache ownership map in memory
- Batch file checks
- Profile and optimize hot paths

---

## Appendix

### A. Glossary

| Term | Definition |
|------|------------|
| **Exclusive Ownership** | A file that only one section can modify |
| **Shared File** | A file that multiple sections need to modify |
| **Parallel Group** | Set of sections that can execute simultaneously |
| **Critical Path** | Longest dependency chain determining minimum execution time |
| **Integration Phase** | Sequential handling of shared file modifications |
| **Mode** | Current operational state of BVS |

### B. Related Documents

- [BVS Architecture Overview](./BVS_ARCHITECTURE.md)
- [Ultrapilot Reference](~/.claude/plugins/cache/omc/oh-my-claudecode/)
- [Ralph Loop Integration](./RALPH_LOOP_INTEGRATION.md)

### C. Change Log

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-01-29 | Claude | Initial draft |

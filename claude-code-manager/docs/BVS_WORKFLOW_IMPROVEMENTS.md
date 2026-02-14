# BVS Workflow Improvements: Preventing Build Errors

## Problem Analysis

The BVS workflow completed all 15 sections but the generated code had several build errors:

1. **Missing `cron` package** - Agent wrote code using `cron` package without installing it
2. **Missing `openai` package** - Agent wrote OpenAI integration without installing the package
3. **Missing UI component** - Agent imported `@/components/ui/radio-group` that doesn't exist
4. **Non-async Server Actions** - Code written for Next.js 14 pattern but project uses Next.js 15
5. **Next.js 15 API route params** - Used `{ params: { id: string } }` instead of `Promise<{ id: string }>`

### Root Causes

| Error | Root Cause | Why BVS Missed It |
|-------|------------|-------------------|
| Missing npm packages | Agent assumed packages would be installed later | No dependency installation step |
| `@ts-expect-error` bypass | Agent added suppression comments to pass TypeScript | TypeScript validation accepts `@ts-expect-error` |
| Missing UI components | Agent assumed component existed in codebase | No component existence validation |
| Wrong Next.js patterns | Agent knowledge from Next.js 14, project uses 15 | No framework version context in prompts |
| No build verification | Quality gates run but build not required to pass | Build gate disabled or not blocking |

---

## Proposed Improvements

### 1. Add Dependency Installation Section

**When:** After any section that adds new imports
**What:** Detect new package imports and install them

```typescript
// New section type in plan
{
  id: 'install-deps',
  name: 'Install Dependencies',
  type: 'infrastructure', // New type
  description: 'Install npm packages for new imports',
  files: [],
  successCriteria: [
    { description: 'All imports resolve to installed packages' }
  ]
}
```

**Implementation in worker prompt:**
```
DEPENDENCY CHECK:
Before marking complete, verify all imports:
1. List all import statements in created/modified files
2. For each external package (not @/ or ./ paths):
   - Check if package exists in package.json
   - If not, run: npm install <package>
3. Report installed packages in summary
```

### 2. Prohibit `@ts-expect-error` for Missing Modules

**Current:** Agent adds `@ts-expect-error` to bypass TypeScript errors
**Proposed:** Add explicit rule in worker prompt

```
FORBIDDEN PATTERNS:
- NEVER use @ts-expect-error for missing modules or packages
- NEVER use @ts-ignore for import errors
- If a package doesn't exist, install it with npm install
- If a component doesn't exist, create it or use an alternative
- Using @ts-expect-error for imports will cause section FAILURE
```

### 3. Component Existence Validation

**When:** Before using any `@/components/*` imports
**What:** Verify component exists or create it

Add to worker prompt:
```
COMPONENT IMPORTS:
Before importing from @/components/:
1. Use list_files("src/components/**/*.tsx") to see available components
2. If component doesn't exist:
   - Option A: Create a minimal implementation
   - Option B: Use an alternative that exists
   - Option C: Install from shadcn/ui (npx shadcn@latest add <component>)
3. NEVER import non-existent components
```

### 4. Framework Version Context in Prompts

**Current:** No framework version information provided
**Proposed:** Add to project context

```typescript
// In ProjectContext type
interface ProjectContext {
  // ... existing fields
  frameworkVersions: {
    next?: string      // e.g., "15.1.0"
    react?: string     // e.g., "19.0.0"
    typescript?: string
  }
}
```

**In worker prompt:**
```
FRAMEWORK VERSIONS:
- Next.js: ${context.frameworkVersions.next}
- React: ${context.frameworkVersions.react}

NEXT.JS 15 BREAKING CHANGES (if version >= 15):
- API route params are now Promise: { params: Promise<{ id: string }> }
- Must await params before use: const { id } = await params
- Server Actions MUST be async functions
- Use 'use server' directive for Server Actions
```

### 5. Mandatory Build Verification Section

**When:** After ALL code sections complete, before session ends
**What:** Full build verification that MUST pass

```typescript
// Auto-added final section
{
  id: 'final-build-verification',
  name: 'Build Verification',
  type: 'verification',
  phase: 'implementation', // Runs at end of implementation
  dependencies: ['*'], // Depends on ALL other sections
  description: 'Verify project builds without errors',
  successCriteria: [
    { description: 'npm run build completes with exit code 0' },
    { description: 'No TypeScript errors' },
    { description: 'No missing imports' }
  ]
}
```

**Worker prompt for this section:**
```
VERIFICATION SECTION
You must verify the entire project builds:

1. Run: npm run build
2. If build fails:
   - Analyze error messages
   - Fix each error
   - Re-run build
3. Continue until build passes or report blockers

COMMON FIXES:
- Missing package: npm install <package>
- Missing component: Create stub or use alternative
- Type error: Fix the TypeScript issue
- Server Action not async: Add async keyword

DO NOT mark_complete until build passes.
```

### 6. Quality Gate Configuration Updates

**Current:** Build gate exists but may not be enforced
**Proposed:** Make build gate mandatory and blocking

```typescript
// In BvsConfig
const STRICT_QUALITY_CONFIG: QualityGateConfig = {
  lint: {
    enabled: true,
    command: 'npm',
    args: ['run', 'lint'],
    autoFix: true,
  },
  typecheck: {
    enabled: true,
    command: 'npx',
    args: ['tsc', '--noEmit'],
    incremental: false, // Full check, not incremental
  },
  build: {
    enabled: true,        // ALWAYS enabled
    command: 'npm',
    args: ['run', 'build'],
    blocking: true,       // NEW: Must pass to continue
  },
  tests: {
    enabled: true,
    command: 'npm',
    args: ['test', '--', '--passWithNoTests'],
  },
  maxFixAttempts: 3,
  allowSkip: false,       // NO skipping for final verification
  runInParallel: false,   // Sequential for debugging
}
```

---

## Implementation Priority

| Priority | Improvement | Effort | Impact |
|----------|-------------|--------|--------|
| **P0** | Prohibit @ts-expect-error for imports | Low | High |
| **P0** | Mandatory build verification section | Medium | High |
| **P1** | Framework version context in prompts | Low | Medium |
| **P1** | Dependency installation step | Medium | High |
| **P2** | Component existence validation | Medium | Medium |
| **P2** | Quality gate configuration updates | Low | Medium |

---

## Code Changes Required

### 1. Update Worker Prompt (bvs-worker-cli-service.ts)

Add to `buildWorkerPrompt()`:

```typescript
private buildWorkerPrompt(
  section: BvsSection,
  context: ProjectContext,
  maxTurns: number
): string {
  // ... existing code ...

  // Add framework version awareness
  const frameworkWarnings = this.getFrameworkWarnings(context);

  return `You are a BVS worker implementing a section of code.

${frameworkWarnings}

FORBIDDEN PATTERNS:
- NEVER use @ts-expect-error or @ts-ignore for import errors
- NEVER import packages that aren't installed
- NEVER import components that don't exist
- If something is missing, install it or create it

DEPENDENCY MANAGEMENT:
- Before using any external package, verify it's in package.json
- If not installed, use run_command("npm install <package>")
- For shadcn/ui components: run_command("npx shadcn@latest add <name>")

// ... rest of existing prompt ...
`;
}

private getFrameworkWarnings(context: ProjectContext): string {
  const warnings: string[] = [];

  // Detect Next.js version from package.json
  if (context.framework?.includes('Next.js')) {
    const nextVersion = context.frameworkVersions?.next;
    if (nextVersion && parseInt(nextVersion.split('.')[0]) >= 15) {
      warnings.push(`
NEXT.JS 15 REQUIREMENTS:
- API route params MUST be Promise: { params: Promise<{ id: string }> }
- MUST await params: const { id } = await params
- Server Actions MUST be async functions
- Server Components cannot use useState/useEffect
`);
    }
  }

  return warnings.join('\n');
}
```

### 2. Add Build Verification Section (bvs-planning-agent-v2.ts)

Add automatic final verification section:

```typescript
private addVerificationSection(plan: BvsExecutionPlan): void {
  const allSectionIds = plan.sections.map(s => s.id);

  plan.sections.push({
    id: 'final-build-verification',
    name: 'Build Verification',
    description: 'Verify project builds without errors after all changes',
    phase: 'implementation',
    complexity: 'low',
    dependencies: allSectionIds, // Depends on all sections
    files: [],
    successCriteria: [
      {
        id: 'build-passes',
        description: 'npm run build completes successfully',
        automated: true,
        automationCommand: 'npm run build'
      },
      {
        id: 'no-ts-errors',
        description: 'No TypeScript compilation errors',
        automated: true,
        automationCommand: 'npx tsc --noEmit'
      }
    ],
    estimatedTurns: 5,
    order: plan.sections.length + 1
  });
}
```

### 3. Update Validation (bvs-worker-cli-service.ts)

Add import validation:

```typescript
private async validateImports(
  section: BvsSection,
  cwd: string
): Promise<{ valid: boolean; missingPackages: string[]; missingComponents: string[] }> {
  const missingPackages: string[] = [];
  const missingComponents: string[] = [];

  for (const fileSpec of section.files) {
    const filePath = path.join(cwd, fileSpec.path);
    try {
      const content = await fs.readFile(filePath, 'utf-8');

      // Check for @ts-expect-error on imports (forbidden)
      if (content.match(/@ts-expect-error.*\n.*import/g)) {
        // Extract the package name and add to missing
        const matches = content.matchAll(/@ts-expect-error.*\n.*import.*from\s+['"]([^'"]+)['"]/g);
        for (const match of matches) {
          missingPackages.push(match[1]);
        }
      }

      // Check for missing @/components imports
      const componentImports = content.matchAll(/from\s+['"]@\/components\/([^'"]+)['"]/g);
      for (const match of componentImports) {
        const componentPath = path.join(cwd, 'src', 'components', match[1]);
        try {
          await fs.access(componentPath + '.tsx');
        } catch {
          try {
            await fs.access(componentPath + '/index.tsx');
          } catch {
            missingComponents.push(match[1]);
          }
        }
      }
    } catch {
      // File doesn't exist, handled elsewhere
    }
  }

  return {
    valid: missingPackages.length === 0 && missingComponents.length === 0,
    missingPackages,
    missingComponents
  };
}
```

---

## Testing the Improvements

1. **Unit Tests:** Add tests for import validation
2. **Integration Test:** Run BVS on a test project, verify build passes
3. **Regression Test:** Re-run the ERP budget workflow with fixes

---

## Summary

These improvements address the root causes of build errors:

1. **Dependency Management:** Workers must install packages they use
2. **No Escape Hatches:** Prohibit @ts-expect-error for imports
3. **Component Validation:** Check components exist before importing
4. **Framework Awareness:** Provide version-specific guidance
5. **Mandatory Build:** Final verification section ensures project compiles

Implementing these changes will significantly reduce post-BVS cleanup work.

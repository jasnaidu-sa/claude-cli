# Review Agent Markdown Output - Implementation Guide

## Overview

The BVS code review system now automatically saves review results from `work-reviewer-*` agents as formatted markdown files in `.bvs/reviews/` directory.

## What Was Changed

### 1. New Service: `bvs-review-formatter.ts`

Created a comprehensive formatter service that:

- **Parses JSON review results** from work-reviewer agents
- **Formats as readable markdown** with sections for each priority level
- **Saves to structured directories** in `.bvs/reviews/<session-id>/`
- **Creates index files** linking to all reviews in a session

**Location**: `src/main/services/bvs-review-formatter.ts`

**Key Functions**:
- `formatReviewAsMarkdown()` - Converts ReviewResult to markdown
- `saveReviewReport()` - Saves markdown to file
- `createReviewIndex()` - Creates README.md index
- `parseReviewJSON()` - Extracts JSON from agent output

### 2. Updated: `bvs-code-review-service.ts`

Added automatic markdown report generation:

**New Config Options**:
```typescript
{
  saveMarkdownReports: boolean  // Enable/disable markdown output (default: true)
  reviewsDir?: string           // Custom reviews directory (optional)
}
```

**New Method**:
- `saveMarkdownReports()` - Saves all reviewer results as markdown

**Integration Point**:
After review completes, before emitting events:
```typescript
// Save markdown reports if configured
if (this.config.saveMarkdownReports) {
  await this.saveMarkdownReports(projectPath, sectionId, reviewerResults, files)
}
```

### 3. Updated Type: `BvsReviewerResult`

Added `reviewData` field to store raw JSON output:

```typescript
export interface BvsReviewerResult {
  reviewer: BvsReviewerType
  status: 'pending' | 'running' | 'completed' | 'failed'
  issues: BvsReviewIssue[]
  duration: number
  error?: string
  completedAt?: number
  reviewData?: string  // Raw JSON output from reviewer agent
}
```

## Markdown Report Format

Each review generates a markdown file with:

### Header Section
- **Generated timestamp**
- **Review category** (correctness, typescript, conventions, etc.)
- **Overall assessment** (No Issues / Issues Found)
- **Summary** of findings

### Files Reviewed
- List of all files that were reviewed

### Issues by Priority

**P0 Issues (Critical)** 🚨
- Must be fixed immediately
- Block progress

**P1 Issues (Major)** ⚠️
- Should be fixed before section completion
- Significant problems

**P2 Issues (Minor)** ℹ️
- Can be addressed later
- Nice-to-have improvements

### Each Issue Includes:
1. **Type** (e.g., NULL_ACCESS, LOGIC_ERROR, RACE_CONDITION)
2. **File and Line Number**
3. **Description**
4. **Current Code** (code block showing the problematic code)
5. **Issue Detail** (explanation of why it's a problem)
6. **Recommendation** (specific fix with code examples)
7. **Confidence Level** (percentage)
8. **Security Impact** (if applicable)

### Positive Notes
- Things the code does well
- Good patterns to maintain

### Statistics
- Total issues count
- Breakdown by priority (P0/P1/P2)
- Average confidence level

### Metadata
- Session ID
- Section ID
- Timestamp

## Directory Structure

```
.bvs/
└── reviews/
    └── <session-id>/
        ├── README.md                           # Index of all reviews
        ├── work-reviewer-correctness.md        # Correctness review
        ├── work-reviewer-typescript.md         # TypeScript review
        ├── work-reviewer-conventions.md        # Conventions review
        └── work-reviewer-simplicity.md         # Simplicity review
```

## Example: Ralph Loop Review Session

**Session ID**: `ralph-loop-review-2025-01-25`

**Location**: `.bvs/reviews/ralph-loop-review-2025-01-25/`

**Files Generated**:
1. `README.md` - Index showing all 3 reviews with issue counts
2. `work-reviewer-correctness.md` - All correctness findings

**Total Issues Found**: 13
- **P0**: 3 (2 in learning service, 1 in progress UI)
- **P1**: 9 (across all 3 files)
- **P2**: 1 (ID generation in learning service)

## Usage in BVS Workflow

### Automatic (Default)
When code review runs through BVS orchestrator, markdown reports are automatically saved:

```typescript
const reviewResult = await codeReviewService.runCodeReview(
  projectPath,
  files,
  sectionId
)
// Markdown files are now saved in .bvs/reviews/<sectionId>/
```

### Manual (Standalone Script)
To save existing review results:

```bash
cd claude-code-manager
npx tsx scripts/save-review-results.ts
```

**The script**:
- Hardcodes review results from previous session
- Formats and saves as markdown
- Creates index file
- Useful for one-time migration or testing

### Programmatic
```typescript
import {
  formatReviewAsMarkdown,
  saveReviewReport,
  createReviewIndex
} from './bvs-review-formatter'

// Format a single review
const markdown = formatReviewAsMarkdown(
  'work-reviewer-correctness',
  reviewResult,
  files,
  { sessionId, timestamp }
)

// Save to file
const filepath = await saveReviewReport(
  projectPath,
  'work-reviewer-correctness',
  markdown,
  { sessionId, timestamp }
)

// Create index for all reviews
await createReviewIndex(projectPath, sessionId, [
  { reviewer: 'correctness', filepath, issueCount: 5 },
  { reviewer: 'typescript', filepath, issueCount: 2 }
])
```

## Benefits

### 1. **Easy Review**
- Open markdown files in any editor
- Better formatting than JSON
- Searchable and linkable

### 2. **Historical Record**
- All reviews saved to disk
- Track issues over time
- Compare between sessions

### 3. **Shareable**
- Email markdown files
- Include in PRs
- Add to documentation

### 4. **Indexable**
- README.md provides quick overview
- See all issues at a glance
- Jump to specific reviews

## Configuration

### Enable/Disable Markdown Output

```typescript
const codeReviewService = getBvsCodeReviewService()

codeReviewService.setConfig({
  saveMarkdownReports: true  // or false to disable
})
```

### Custom Reviews Directory

```typescript
codeReviewService.setConfig({
  reviewsDir: '/custom/path/to/reviews'
})
```

Default: `<projectPath>/.bvs/reviews`

## Future Enhancements

Potential improvements:

1. **Diff Generation**
   - Show before/after code diffs
   - Highlight specific changes

2. **Fix Tracking**
   - Mark issues as fixed/ignored
   - Link to commits that address issues

3. **Trend Analysis**
   - Track issue counts over time
   - Identify recurring patterns

4. **Export Formats**
   - HTML with styling
   - PDF for formal reports
   - CSV for spreadsheet analysis

5. **Integration with UI**
   - Display markdown in BVS dashboard
   - Click to jump to file:line
   - One-click apply recommendations

## Why Markdown?

**Chosen over JSON/HTML/PDF because**:

✅ **Human-readable** - Easy to read in text editor, VS Code, GitHub
✅ **Version control friendly** - Clean diffs, works with git
✅ **Universal** - Works everywhere (CLI, web, IDE, documentation)
✅ **Linkable** - Can link between files, to code, to external resources
✅ **Searchable** - Grep, ripgrep, IDE search all work
✅ **Convertible** - Can convert to HTML/PDF/DOCX if needed
✅ **No dependencies** - Just text files, no special viewers needed

## Testing

To test the markdown generation:

```bash
# Run the standalone script
cd claude-code-manager
npx tsx scripts/save-review-results.ts

# Check output
ls .bvs/reviews/ralph-loop-review-2025-01-25/

# View a report
cat .bvs/reviews/ralph-loop-review-2025-01-25/work-reviewer-correctness.md
```

## Conclusion

The review agent markdown output system provides a **persistent, human-readable record** of all code reviews. It transforms ephemeral JSON output from AI agents into **permanent, shareable documentation** that improves code quality visibility and enables better tracking of technical debt.

**Status**: ✅ **Implemented and tested** with Ralph Loop review session
**Files Changed**: 3 (formatter + service + types)
**Files Created**: 2 (formatter service + standalone script)
**Review Reports Generated**: 3 markdown files + 1 index file

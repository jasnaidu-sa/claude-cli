# spec-parser.ts

## Purpose
Utility for parsing app_spec.txt files to extract meaningful metadata for workflow naming and description.

## Exports

### SpecMetadata Interface
```typescript
interface SpecMetadata {
  title: string        // Extracted feature/project title
  description: string  // Extracted overview/description
}
```

### parseSpecMetadata(specContent: string): SpecMetadata
Parses spec content to extract title and description.

**Title Extraction:**
- Searches for "FEATURE SPECIFICATION: X" line
- Converts from "COUNTER COMPONENT" to "Counter Component" (title case)
- Defaults to "Auto-generated workflow" if not found

**Description Extraction:**
- Extracts content from OVERVIEW section
- Captures all lines until next section header
- Truncates at 200 characters with "..." if too long
- Returns empty string if no OVERVIEW section found

**Example:**
```typescript
const spec = `
FEATURE SPECIFICATION: COUNTER COMPONENT
========================================

OVERVIEW
--------
A minimal, self-contained React counter component built with TypeScript...
`

const metadata = parseSpecMetadata(spec)
// Returns:
// {
//   title: "Counter Component",
//   description: "A minimal, self-contained React counter component built with TypeScript..."
// }
```

### parseSpecFile(specFilePath: string): Promise<SpecMetadata | null>
Reads and parses a spec file from disk using IPC.

**Returns:**
- `SpecMetadata` if successful
- `null` if file read fails or parsing errors

**Usage:**
```typescript
const metadata = await parseSpecFile('/path/to/spec.txt')
if (metadata) {
  console.log(metadata.title, metadata.description)
}
```

## Integration Points

### ExecutionDashboard
Called when creating workflows to populate name and description fields:
```typescript
const specMetadata = parseSpecMetadata(generatedSpec.appSpecTxt)
const workflow = await createWorkflow({
  name: specMetadata.title,
  description: specMetadata.description,
  // ... other fields
})
```

## Spec File Format

Expected format for parsing:
```
APP SPECIFICATION
================
Project: test-project
Generated: 2025-12-20T19:43:48.639Z

FEATURE SPECIFICATION: COUNTER COMPONENT
========================================

OVERVIEW
--------
A minimal, self-contained React counter component...

REQUIREMENTS
------------
...
```

## Error Handling
- Returns default title "Auto-generated workflow" if header not found
- Returns empty description if OVERVIEW section missing
- Returns null from parseSpecFile() on IPC errors
- Logs errors to console but doesn't throw

## Change History
- 2025-12-21: Created spec parser for extracting workflow metadata from spec files

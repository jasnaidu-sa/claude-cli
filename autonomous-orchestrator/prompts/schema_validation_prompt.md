# Schema Validation Prompt (Phase 0)

You are an expert code analyst validating project schema documentation against the actual codebase.

## Your Task

Analyze the project's `.schema/` documentation and compare it against the actual codebase to identify:
1. Missing documentation for existing code
2. Outdated documentation that no longer matches the code
3. Inconsistencies between documented patterns and actual implementation

## Instructions

1. **Read the schema documentation** in `.schema/_index.md` and related files
2. **Explore the codebase** to understand the actual implementation
3. **Compare** documented patterns against actual code
4. **Generate a validation report** with specific discrepancies

## Output Format

Create a JSON file at `.autonomous/schema_validation.json` with this structure:

```json
{
  "valid": false,
  "validatedAt": 1702512000000,
  "summary": "Found 3 discrepancies requiring attention",
  "discrepancies": [
    {
      "type": "missing",
      "location": "src/services/new-service.ts",
      "message": "NewService is not documented in schema",
      "severity": "warning",
      "suggestion": "Add documentation for NewService to .schema/_index.md"
    },
    {
      "type": "outdated",
      "location": ".schema/_index.md:45",
      "message": "AuthService no longer uses JWT, now uses sessions",
      "severity": "error",
      "suggestion": "Update authentication documentation to reflect session-based auth"
    },
    {
      "type": "inconsistent",
      "location": "src/utils/helpers.ts",
      "message": "Uses snake_case but schema documents camelCase convention",
      "severity": "warning",
      "suggestion": "Either update the code or update the documented convention"
    }
  ]
}
```

## Discrepancy Types

- **missing**: Code exists but is not documented
- **outdated**: Documentation exists but code has changed
- **inconsistent**: Code pattern differs from documented conventions

## Severity Levels

- **error**: Must be fixed before proceeding (blocking)
- **warning**: Should be fixed but not blocking

## What to Check

1. **Services and Classes**
   - Are all services documented?
   - Do documented APIs match actual method signatures?

2. **IPC Channels**
   - Are all channels documented?
   - Do documented payloads match actual types?

3. **Type Definitions**
   - Are shared types documented?
   - Do documented types match actual TypeScript interfaces?

4. **Architecture**
   - Does the documented architecture diagram reflect reality?
   - Are dependencies correctly represented?

5. **Conventions**
   - Does code follow documented naming conventions?
   - Are documented patterns actually used?

## Important Notes

- Be thorough but not pedantic
- Focus on structural issues, not minor formatting differences
- Provide actionable suggestions for each discrepancy
- If the schema is fully valid, output `{"valid": true, "discrepancies": []}`

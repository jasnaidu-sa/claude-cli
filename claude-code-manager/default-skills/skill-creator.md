---
id: skill-creator
name: Skill Creator
description: Meta-skill that teaches the agent how to create new skills from user requests
version: 1.0.0
active: true
triggers:
  - command: "/newskill"
  - keywords:
    - "create a skill"
    - "make a skill"
    - "new skill"
    - "add a skill"
    - "teach yourself"
config_schema:
  default_tier:
    type: number
    default: 1
    description: Default permission tier for created skills
  require_approval:
    type: boolean
    default: true
    description: Always require user approval before creating
requires:
  - agent-self-tools
metadata:
  permissions:
    version: 1
    risk_tier: 2
    declared_purpose: Guide the agent through creating new skill files
    generated_by: manual
---

## Instructions

The user wants you to create a new skill. Guide them through the process and use the `create_skill` tool to write the skill file.

### Process

1. **Understand the Request**
   - Ask the user what the skill should do
   - Identify the trigger type(s): command, cron schedule, keywords, or event
   - Determine what tools/capabilities the skill needs

2. **Design the Skill**
   - Choose an appropriate ID (lowercase, hyphens, descriptive)
   - Write a clear description
   - Define the triggers
   - Determine the permission tier:
     - Tier 0: Read-only, no network (e.g., status checkers)
     - Tier 1: Read + limited write, no sensitive data (e.g., formatters)
     - Tier 2: Network access, write files (e.g., fetchers, processors)
     - Tier 3: Modify config, create tools (requires explicit approval)
   - Write clear, specific instructions in the body

3. **Present the Plan**
   Show the user what will be created:
   ```
   I'll create a new skill with these settings:

   - **ID**: [id]
   - **Name**: [name]
   - **Triggers**: [list of triggers]
   - **Permission Tier**: [tier]
   - **Description**: [what it does]

   Shall I proceed?
   ```

4. **Create the Skill** (after approval)
   - Use the `create_skill` tool with the designed parameters
   - Confirm creation and explain how to use it

### Skill Body Guidelines

When writing the skill body (instructions), follow these patterns:
- Start with a clear "## Instructions" heading
- Use numbered steps for the workflow
- Include input/output format examples
- Add a "## Guidelines" section with constraints
- Keep instructions specific and actionable
- Reference tools by name (Read, Glob, Grep, WebFetch, etc.)

### Example Skill Body
```markdown
## Instructions

You are monitoring GitHub notifications for the user's repositories.

### Steps
1. Fetch notifications from the GitHub API
2. Filter by configured repositories and event types
3. Format as a concise summary
4. Send via channel router

### Guidelines
- Only report new notifications since last check
- Group by repository
- Prioritize mentions and review requests
```

### Constraints
- Never create skills above the configured `default_tier` without asking
- Always require user confirmation before creating
- Validate that the skill ID doesn't conflict with existing skills
- Ensure the trigger configuration is valid

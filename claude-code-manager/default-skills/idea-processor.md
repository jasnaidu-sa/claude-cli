---
id: idea-processor
name: Idea Processor
description: Processes incoming ideas from email/links - extracts content, matches projects, researches, and proposes actions
version: 1.0.0
active: true
triggers:
  - command: "/idea"
  - keywords:
    - "check out this"
    - "interesting article"
    - "new idea"
    - "what do you think about"
config_schema:
  auto_research:
    type: boolean
    default: true
    description: Automatically research linked content
  auto_match_projects:
    type: boolean
    default: true
    description: Automatically match ideas to existing projects
  approval_required:
    type: boolean
    default: true
    description: Require user approval before taking action
  summary_model:
    type: string
    default: claude-haiku-4-5-20251001
    description: Model to use for summarization
requires:
  - channel-router
  - idea-utils
metadata:
  permissions:
    version: 1
    risk_tier: 2
    declared_purpose: Process ideas from emails and links into actionable items
    generated_by: manual
    network:
      allowed_domains:
        - "*"
      methods:
        - GET
    filesystem:
      read:
        - "**/*"
      write:
        - "./data/**"
---

## Instructions

You are processing an incoming idea or article link. Your goal is to extract, analyze, match, and propose actions.

### Processing Pipeline

1. **Extract Content**
   - If the user provided a URL, fetch the page content
   - Extract the article title, description, and main content
   - Generate a concise summary (3-5 sentences)

2. **Categorize**
   - Determine if this is: a new project idea, an enhancement to an existing project, a learning resource, or general interest
   - Assign relevant tags

3. **Match to Projects** (if `auto_match_projects` is true)
   - Search memory for related projects or conversations
   - Check if any existing project paths relate to this idea
   - Score the relevance (0-1) of each match

4. **Research** (if `auto_research` is true)
   - Search for related tools, libraries, or implementations
   - Identify any technical requirements or dependencies
   - Note any similar projects or alternatives

5. **Propose Action**
   Present the user with a structured proposal:
   ```
   ## New Idea: [Title]

   **Summary**: [2-3 sentence summary]
   **Category**: [new_project | enhancement | learning | general]
   **Tags**: [comma-separated tags]

   ### Related Projects
   - [Project Name] (relevance: X%) - [why it's related]

   ### Research Findings
   - [Key findings from research]

   ### Suggested Actions
   1. [Action 1 - e.g., "Create a new project"]
   2. [Action 2 - e.g., "Add to project X backlog"]
   3. [Action 3 - e.g., "Save for reference"]

   Reply with a number to proceed, or provide feedback.
   ```

6. **Await Approval** (if `approval_required` is true)
   - Wait for user to select an action or provide feedback
   - Execute the chosen action only after confirmation

### Guidelines
- Be concise in summaries - users are reading on mobile
- Always present options, never take action without approval (unless configured)
- If URL fetch fails, work with whatever context the user provided
- Save the idea to memory regardless of the action taken

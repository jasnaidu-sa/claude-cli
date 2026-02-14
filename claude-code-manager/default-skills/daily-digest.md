---
id: daily-digest
name: Daily Digest
description: Sends daily tech news + project status briefing to configured channels
version: 1.0.0
active: true
triggers:
  - cron: "0 8 * * *"
  - command: "/digest"
config_schema:
  schedule:
    type: string
    default: "0 8 * * *"
    description: Cron expression for digest schedule
  sources:
    type: array
    description: News and RSS sources to include
  max_items_per_source:
    type: number
    default: 5
    description: Maximum items to fetch per source
  keywords:
    type: array
    description: Filter keywords for relevance
  include_project_status:
    type: boolean
    default: true
    description: Include git status of known projects
requires:
  - channel-router
  - llm-router
  - digest-utils
metadata:
  permissions:
    version: 1
    risk_tier: 1
    declared_purpose: Generate daily news digest from configured sources
    generated_by: manual
    network:
      allowed_domains:
        - hacker-news.firebaseio.com
        - "*"
      methods:
        - GET
    filesystem:
      read:
        - "**/*"
    env_access: []
    exec: []
---

## Instructions

You are generating a daily digest briefing. Gather information from the configured sources and compose a concise, well-structured summary.

### Steps

1. **Fetch Hacker News Top Stories**
   - Use the HN API: `https://hacker-news.firebaseio.com/v0/topstories.json`
   - Fetch details for the top N stories (configured via `max_items_per_source`)
   - Filter by configured keywords if any are set

2. **Fetch RSS Sources**
   - For each configured RSS source, fetch and parse the feed
   - Extract title, link, and summary for each item
   - Respect the `max_items_per_source` limit

3. **Project Status** (if `include_project_status` is true)
   - For each known project, run `git status --short` and `git log --oneline -3`
   - Summarize any uncommitted changes or recent activity

4. **Compose the Digest**
   Format the digest as:
   ```
   Good morning! Here's your daily digest for [DATE]:

   ## Tech News
   [HN stories with titles, scores, and links]

   ## RSS Feeds
   [Items from each configured source]

   ## Project Status
   [Brief status of each project]

   Have a productive day!
   ```

5. **Send the digest** via the channel router to all configured channels.

### Guidelines
- Keep it concise - each item should be 1-2 lines max
- Prioritize items matching configured keywords
- If a source fails, skip it and note the failure briefly
- Total digest should be under 2000 characters for WhatsApp compatibility

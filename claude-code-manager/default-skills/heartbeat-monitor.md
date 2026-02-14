---
id: heartbeat-monitor
name: Heartbeat Monitor
description: Proactive health monitoring for projects and system status
version: 1.0.0
active: true
triggers:
  - cron: "*/30 * * * *"
  - command: "/heartbeat"
  - command: "/health"
config_schema:
  check_projects:
    type: boolean
    default: true
    description: Check git status of known projects
  check_processes:
    type: boolean
    default: false
    description: Check if configured processes are running
  alert_on_uncommitted:
    type: boolean
    default: true
    description: Alert if projects have uncommitted changes for >24h
  alert_threshold_hours:
    type: number
    default: 24
    description: Hours of uncommitted changes before alerting
  quiet_hours_start:
    type: number
    default: 22
    description: Start of quiet hours (no alerts)
  quiet_hours_end:
    type: number
    default: 7
    description: End of quiet hours
requires:
  - channel-router
metadata:
  permissions:
    version: 1
    risk_tier: 1
    declared_purpose: Monitor project health and system status
    generated_by: manual
    filesystem:
      read:
        - "**/*"
    exec: []
---

## Instructions

You are performing a proactive health check. Run through the configured checks and report any issues.

### Tier 1: Cheap Checks (no LLM cost)

1. **Project Git Status**
   - For each known project, check `git status --short`
   - Note any uncommitted changes
   - Check the timestamp of the last commit
   - Flag projects with changes older than `alert_threshold_hours`

2. **Disk Space** (if applicable)
   - Check available disk space
   - Alert if below 10%

### Tier 2: Analysis (only if Tier 1 found issues)

3. **Analyze Issues**
   - For any flagged projects, determine severity
   - Check if uncommitted changes look like work-in-progress or forgotten changes
   - Suggest actions (commit, stash, review)

### Quiet Hours
- During quiet hours (configurable), suppress non-critical alerts
- Always send critical alerts regardless of quiet hours

### Output Format

If no issues found:
```
Heartbeat OK - All projects healthy
```

If issues found:
```
## Heartbeat Alert

### [Project Name]
Status: [warning|critical]
Issue: [description]
Suggestion: [action]

---
[Additional projects...]
```

### Guidelines
- Always run Tier 1 first (zero cost)
- Only invoke LLM analysis for Tier 2 if Tier 1 found issues
- Respect quiet hours for non-critical alerts
- Keep alerts concise - mobile-friendly format

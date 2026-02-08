# Heartbeat Instructions

When this file is checked (every 30 minutes by default), perform these checks:

## Cheap Checks (No LLM needed)
<!-- These run first - if all pass, no LLM is invoked (saves cost) -->
- [ ] Check if any BVS sections are waiting for approval
- [ ] Check if any scheduled tasks have failed since last heartbeat
- [ ] Check Ideas inbox for new unread items

## LLM Checks (Only if cheap checks find something)
<!-- Only runs if one of the cheap checks above found an issue -->
- Summarize any BVS progress since last heartbeat
- Summarize any new Ideas that need attention
- Check git status of active projects for uncommitted changes

## Scheduled Reports
<!-- Time-based reports -->
- Morning (8am): Daily briefing with project status, pending tasks, Ideas inbox count
- Evening (6pm): End-of-day summary of what was accomplished

## Alert Conditions
<!-- Immediate alerts regardless of schedule -->
- BVS section fails quality gate more than 3 times
- Scheduled task error rate exceeds 50%
- New critical/urgent idea arrives in inbox

#!/usr/bin/env node
/**
 * Universal Session Start Hook - Compaction Recovery
 * Auto-installed by global hook system
 */

const fs = require('fs');
const path = require('path');

function findContextDir(startDir = process.cwd(), maxDepth = 5) {
  let currentDir = startDir;
  for (let i = 0; i < maxDepth; i++) {
    const contextDir = path.join(currentDir, '.claude-context');
    if (fs.existsSync(contextDir)) return contextDir;
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) break;
    currentDir = parentDir;
  }
  return null;
}

function safeRead(filePath, maxLines = 1000) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    return lines.length > maxLines ? lines.slice(0, maxLines).join('\n') : content;
  } catch {
    return null;
  }
}

function checkActiveStartTask(contextDir) {
  const workingFile = path.join(contextDir, 'WORKING.md');
  const content = safeRead(workingFile);
  if (!content) return null;

  const inProgressMatch = content.match(/- \[~\] \*\*([^*]+)\*\*/);
  if (!inProgressMatch) return null;

  const quickResumeMatch = content.match(/## Quick Resume[^\n]*\n([\s\S]*?)\n---/);
  let taskInfo = '';

  if (quickResumeMatch) {
    taskInfo = quickResumeMatch[1].trim();
  } else {
    const taskMatch = content.match(/\*\*Task\*\*: ([^\n]+)/);
    const phaseMatch = content.match(/\*\*Phase\*\*: ([^\n]+)/);
    const currentMatch = content.match(/\*\*Current\*\*: ([^\n]+)/);
    const actionMatch = content.match(/\*\*Action\*\*: ([^\n]+)/);

    const parts = [];
    if (taskMatch) parts.push(`**Task**: ${taskMatch[1]}`);
    if (currentMatch) parts.push(`**Current**: ${currentMatch[1]}`);
    if (phaseMatch) parts.push(`**Phase**: ${phaseMatch[1]}`);
    if (actionMatch) parts.push(`**Action**: ${actionMatch[1]}`);
    taskInfo = parts.join('\n');
  }

  return {
    hasActiveTask: true,
    taskInfo,
    feature: inProgressMatch[1],
    workingFile: path.relative(process.cwd(), workingFile),
    workflowFile: path.relative(process.cwd(), path.join(contextDir, 'workflow.md'))
  };
}

function main() {
  const contextDir = findContextDir();

  if (!contextDir) {
    console.log(JSON.stringify({
      additionalContext: '# Session Context\n\nNo .claude-context directory found.'
    }));
    return;
  }

  const activeTask = checkActiveStartTask(contextDir);

  if (activeTask) {
    const output = {
      continue: false,
      stopReason: `ACTIVE /start-task DETECTED - Resume immediately.
Task: ${activeTask.feature}
Read ${activeTask.workingFile} and ${activeTask.workflowFile} to continue.`,
      additionalContext: `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️  COMPACTION RECOVERY - IMMEDIATE ACTION REQUIRED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CRITICAL INSTRUCTION: You are resuming from a compacted session with an active /start-task workflow.

DO NOT WAIT FOR USER INPUT. DO NOT ASK "what should I do?".
The state files contain ALL the information you need to resume immediately.

MANDATORY FIRST ACTIONS (do these NOW before any user interaction):

1. Read \`${activeTask.workingFile}\` (entire file)
2. Read \`${activeTask.workflowFile}\` (entire file)
3. Locate the feature marked [~] in WORKING.md
4. Check the Phase and Current Feature Detail sections
5. Resume execution from that exact point

═══════════════════════════════════════════════════════

ACTIVE TASK STATE (Quick Resume):

${activeTask.taskInfo}

═══════════════════════════════════════════════════════

YOUR NEXT IMMEDIATE ACTION: Read both files above, then execute the current subtask.
DO NOT greet the user. DO NOT ask questions. Just resume work immediately.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`
    };
    console.log(JSON.stringify(output));
    return;
  }

  console.log(JSON.stringify({
    additionalContext: `# Session Context\n\nProject context directory found at: ${contextDir}\n\nNo active /start-task workflow detected.`
  }));
}

main();

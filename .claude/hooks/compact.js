#!/usr/bin/env node
/**
 * Universal PreCompact Hook - State Preservation
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

function safeRead(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function extractWorkingState(contextDir) {
  const workingFile = path.join(contextDir, 'WORKING.md');
  const content = safeRead(workingFile);
  if (!content) return null;

  const state = {
    hasActiveTask: false,
    taskId: null,
    currentFeature: null,
    phase: null,
    action: null
  };

  const taskIdMatch = content.match(/\*\*ID\*\*: ([^\n]+)/);
  if (taskIdMatch) state.taskId = taskIdMatch[1].trim();

  const inProgressMatch = content.match(/- \[~\] \*\*([^*]+)\*\*/);
  if (inProgressMatch) {
    state.hasActiveTask = true;
    state.currentFeature = inProgressMatch[1].trim();
  }

  const phaseMatch = content.match(/\*\*Phase\*\*: ([^\n]+)/);
  if (phaseMatch) state.phase = phaseMatch[1].trim();

  const actionMatch = content.match(/\*\*Action\*\*: ([^\n]+)/);
  if (actionMatch) state.action = actionMatch[1].trim();

  return state;
}

function getGitStatus(projectRoot) {
  const { execSync } = require('child_process');
  try {
    execSync('git rev-parse --git-dir', { cwd: projectRoot, stdio: 'pipe' });
    const status = execSync('git status --porcelain', { cwd: projectRoot, encoding: 'utf-8' });
    const uncommitted = status.split('\n').filter(line => line.trim()).map(line => line.substring(3).trim());
    return { isGitRepo: true, uncommittedFiles: uncommitted, uncommittedCount: uncommitted.length };
  } catch {
    return { isGitRepo: false, uncommittedFiles: [], uncommittedCount: 0 };
  }
}

function main() {
  const contextDir = findContextDir();
  if (!contextDir) {
    console.log(JSON.stringify({ success: false, reason: 'No context directory' }));
    return;
  }

  const projectRoot = path.dirname(contextDir);
  const workingState = extractWorkingState(contextDir);
  const gitStatus = getGitStatus(projectRoot);

  const checkpoint = {
    compactedAt: new Date().toISOString(),
    projectRoot: projectRoot,
    contextDir: contextDir,
    hasActiveTask: workingState?.hasActiveTask || false,
    taskId: workingState?.taskId || null,
    currentFeature: workingState?.currentFeature || null,
    phase: workingState?.phase || null,
    action: workingState?.action || null,
    git: gitStatus
  };

  const checkpointFile = path.join(contextDir, 'checkpoint.json');
  try {
    fs.writeFileSync(checkpointFile, JSON.stringify(checkpoint, null, 2));
  } catch (err) {
    console.log(JSON.stringify({ success: false, reason: err.message }));
    return;
  }

  const compactionLog = path.join(contextDir, 'compaction.log');
  const logEntry = `[${checkpoint.compactedAt}] Compaction occurred. Task: ${checkpoint.taskId || 'none'}, Feature: ${checkpoint.currentFeature || 'none'}, Phase: ${checkpoint.phase || 'none'}\n`;
  try {
    fs.appendFileSync(compactionLog, logEntry);
  } catch {}

  const output = {
    success: true,
    checkpoint: checkpoint,
    additionalContext: checkpoint.hasActiveTask
      ? `Checkpoint saved. Active task: ${checkpoint.currentFeature} (${checkpoint.phase})`
      : 'Checkpoint saved. No active task.'
  };

  console.log(JSON.stringify(output));
}

main();

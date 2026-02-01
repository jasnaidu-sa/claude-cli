# Claude Code Manager - Development Guide

## Quick Start / Restart App

**IMPORTANT: When using bash shell in Claude Code, use `cmd /c` to run Windows commands.**

### RELIABLE RESTART PROCEDURE (USE THIS):

**Step 1: Stop any running background task first**
```bash
# Use TaskStop tool to stop any running dev server task
# Example: TaskStop with task_id from previous npm run dev
```

**Step 2: Kill port 3847 (separate command)**
```bash
cmd /c "for /f \"tokens=5\" %a in ('netstat -ano ^| findstr :3847 ^| findstr LISTENING') do taskkill /F /PID %a"
```

**Step 3: Wait 10 seconds (CRITICAL - allows port to fully release)**
```bash
sleep 10
```

**Step 4: Start dev server in background**
```bash
cd "C:\claude_projects\claude-cli\claude-code-manager" && npm run dev
# Run this with run_in_background: true
```

**Step 5: Wait and verify server started (check for "HTTP server listening")**
```bash
sleep 30 && grep "HTTP server\|API server started" "<output_file>"
```

### TROUBLESHOOTING:

**If "port 3847 in use" error persists:**
1. The previous electron app may still be running
2. Wait 30 seconds and try again
3. Check for orphan processes: `cmd /c "tasklist | findstr electron"`

**If API server shows "Starting server on port 3847..." but never "HTTP server listening":**
- This is a timing issue with Windows socket release
- Wait 60 seconds and restart completely
- Kill ALL vite ports (6100-6110) as well:
```bash
cmd /c "for /f \"tokens=5\" %a in ('netstat -ano ^| findstr :610 ^| findstr LISTENING') do taskkill /F /PID %a"
```

### What NOT to do:
- `taskkill //F //IM electron.exe` - Kills ALL Electron apps including Claude Code itself
- `taskkill //F //IM node.exe` - Kills ALL Node processes
- Don't chain kill + start in one command - use separate commands with sleep

## Safe Server Restart Procedure

**IMPORTANT: Never use `taskkill //F //IM electron.exe` as it kills ALL Electron processes including Claude Code itself!**

### Ports Used:
- **3847** - API Server (WebSocket) - MUST be free before starting
- **6100-6102** - Vite dev server (auto-increments if in use)

### What NOT to do:
- `taskkill //F //IM electron.exe` - Kills ALL Electron apps including Claude Code
- `taskkill //F //IM node.exe` - Kills ALL Node processes

### Background Tasks:
When running dev server in background:
- Use `TaskStop` tool with the specific task ID to stop it
- Check task output files in: `C:\Users\JNaidu\AppData\Local\Temp\claude\`

## Project Structure

- `src/main/` - Electron main process
- `src/renderer/` - React frontend
- `src/preload/` - Preload scripts for IPC
- `src/shared/` - Shared types

## BVS Planning Agent

The BVS Planning Agent V2 is located at:
`src/main/services/bvs-planning-agent-v2.ts`

Key features:
- Explores codebase FIRST before asking questions
- Presents question cards with selectable options
- Supports custom/manual answers
- Progressive discovery flow

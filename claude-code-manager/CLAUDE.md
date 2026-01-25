# Claude Code Manager - Development Guide

## Safe Server Restart Procedure

**IMPORTANT: Never use `taskkill //F //IM electron.exe` as it kills ALL Electron processes including Claude Code itself!**

### Safe Restart Steps:

1. **Find the specific dev server process:**
   ```bash
   # Find the node process running electron-vite (NOT electron.exe)
   netstat -ano | findstr ":3847"
   # or
   netstat -ano | findstr ":6100"
   ```

2. **Kill only the specific PID:**
   ```bash
   taskkill //F //PID <specific_pid>
   ```

3. **Or use the background task ID:**
   ```bash
   # If you have a running background task, use KillShell with the task ID
   # This safely terminates only that specific process
   ```

4. **Wait for cleanup:**
   ```bash
   sleep 2
   ```

5. **Start the dev server:**
   ```bash
   cd "C:\claude_projects\claude-cli\claude-code-manager" && npm run dev
   ```

### Ports Used:
- **3847** - API Server (WebSocket)
- **6100-6102** - Vite dev server (increments if port in use)

### What NOT to do:
- `taskkill //F //IM electron.exe` - Kills ALL Electron apps including Claude Code
- `taskkill //F //IM node.exe` - Kills ALL Node processes

### Background Tasks:
When running dev server in background:
- Use `KillShell` tool with the specific task ID
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

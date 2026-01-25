# Autocoder Integration

Complete integration of the [leonvanzyl/autocoder](https://github.com/leonvanzyl/autocoder) autonomous coding system into Claude Code Manager.

## Overview

This integration embeds autocoder's production-ready SQLite + MCP server architecture into the Electron app, providing:

- **Two-Agent Architecture**: Initializer agent (generates features) + Coding agent (implements features)
- **SQLite Feature Management**: Handles 100+ features efficiently via database instead of JSON
- **MCP Server Integration**: 8 tools for Claude to manage feature lifecycle
- **Embedded React UI**: Autocoder's web UI displayed via Electron BrowserView
- **Theme Consistency**: Custom CSS injection to match Claude Code Manager's theme

## Architecture

### Backend Components

**1. Python Virtual Environment Manager** (`src/main/services/python-venv-manager.ts`)
- Creates isolated Python environment in `app.getPath('userData')/python-autocoder-venv`
- Installs dependencies from `python/autocoder/requirements.txt`
- Provides Python/pip paths for spawning processes

**2. Autocoder UI Service** (`src/main/services/autocoder-ui-service.ts`)
- Spawns FastAPI backend (port 8000) and Vite dev server (port 5173)
- Creates Electron BrowserView to embed autocoder UI
- Injects custom theme CSS for visual consistency
- Manages process lifecycle (start/stop/show/hide)

**3. IPC Handlers** (`src/main/ipc/autocoder-handlers.ts`)
- Exposes autocoder service to renderer process
- Handles: start, stop, show, hide, status, setup-python, update-dependencies
- Event channels: log, error, stopped

### Frontend Components

**1. AutocoderEmbedded Component** (`src/renderer/components/autonomous/AutocoderEmbedded.tsx`)
- Simple launcher UI with start/stop controls
- Live logs display (stdout/stderr)
- Status indicators and error handling
- Instructions and requirements display

**2. AutonomousView Integration** (`src/renderer/components/autonomous/AutonomousView.tsx`)
- Toggles between embedded autocoder and legacy phased workflow
- Defaults to embedded autocoder
- Button to switch between modes

### Preload API

**Interface Definition** (`src/preload/index.ts`)
```typescript
autocoder: {
  start: (projectPath: string) => Promise<{ success: boolean; message?: string; error?: string }>
  stop: () => Promise<{ success: boolean; message?: string; error?: string }>
  show: () => Promise<{ success: boolean; message?: string; error?: string }>
  hide: () => Promise<{ success: boolean; message?: string; error?: string }>
  status: () => Promise<{ success: boolean; isRunning: boolean; projectPath: string | null; error?: string }>
  setupPython: () => Promise<{ success: boolean; message?: string; pythonVersion?: string; error?: string }>
  updateDependencies: () => Promise<{ success: boolean; message?: string; error?: string }>
  onLog: (callback: (data: { type: 'stdout' | 'stderr'; message: string }) => void) => () => void
  onError: (callback: (data: { message: string }) => void) => () => void
  onStopped: (callback: (data: { code: number | null; signal: string | null }) => void) => () => void
}
```

## Files Modified/Created

### Created
- `python/autocoder/` - Complete autocoder codebase (cloned from GitHub)
- `src/main/services/python-venv-manager.ts` - Python environment management
- `src/main/services/autocoder-ui-service.ts` - Backend spawning and UI embedding
- `src/main/ipc/autocoder-handlers.ts` - IPC communication layer
- `src/renderer/components/autonomous/AutocoderEmbedded.tsx` - Launcher UI

### Modified
- `src/main/ipc/index.ts` - Register autocoder handlers
- `src/preload/index.ts` - Expose autocoder API
- `src/renderer/components/autonomous/AutonomousView.tsx` - Toggle between workflows
- `src/renderer/components/autonomous/index.ts` - Export AutocoderEmbedded
- `package.json` - Include python/ in build, unpack autocoder from asar

## How It Works

### Startup Flow

1. User clicks "Start Autocoder" in Autonomous tab
2. `AutocoderEmbedded` component calls `window.electron.autocoder.start(projectPath)`
3. IPC handler invokes `AutocoderUIService.start()`
4. Service ensures Python venv is ready (creates if missing, installs deps)
5. Spawns `python/autocoder/start_ui.py` as child process with env vars:
   - `PROJECT_DIR`: Project path
   - `ANTHROPIC_API_KEY`: API key from auth manager
   - `PYTHONPATH`: Autocoder source path
6. Waits for FastAPI (localhost:8000/health) and Vite (localhost:5173) to be ready
7. Creates BrowserView and loads `http://localhost:5173`
8. Injects custom theme CSS via `insertCSS()`
9. Sets BrowserView bounds to fit Electron window (leaving 64px for header)
10. Autocoder UI is now embedded and functional

### Autocoder Features

**MCP Server Tools** (exposed to Claude):
- `feature_get_stats` - Progress statistics
- `feature_get_next` - Get highest-priority pending feature
- `feature_mark_passing` - Mark feature complete
- `feature_skip` - Move to end of queue
- `feature_mark_in_progress` - Lock feature
- `feature_create_bulk` - Initialize features (used by initializer)

**Database Schema** (SQLite):
```python
class Feature(Base):
    id: int (primary key)
    priority: int (default 999, indexed)
    category: str (max 100)
    passes: bool (default False, indexed)
    in_progress: bool (default False, indexed)
```

**Workflow**:
1. User describes what they want to build
2. Initializer agent breaks it into 10-100+ implementable features
3. Features stored in SQLite with priorities
4. Coding agent pulls next feature via MCP `feature_get_next`
5. Agent implements feature, runs tests
6. If passes: marks `feature_mark_passing`, gets next feature
7. If fails: analyzes errors, fixes, retries
8. Continues until all features pass tests

## Theme Customization

Theme CSS injected via `AutocoderUIService.injectTheme()`:

```css
:root {
  --background: 222.2 84% 4.9%;
  --foreground: 210 40% 98%;
  --card: 222.2 84% 4.9%;
  --primary: 210 40% 98%;
  --secondary: 217.2 32.6% 17.5%;
  /* ... matches Claude Code Manager theme */
}
```

Override classes:
- `.bg-white, .bg-gray-50` → card background
- `.border-gray-200` → border color
- `.bg-blue-600` → primary button
- `.text-gray-900` → foreground text
- Custom scrollbar styles

## Requirements

### System
- Python 3.9+ installed and in PATH
- Node.js (for Electron app)
- Anthropic API key configured in Settings

### Python Dependencies (from `python/autocoder/requirements.txt`)
- `fastapi` - Backend web server
- `uvicorn` - ASGI server
- `anthropic` - Claude API client
- `sqlalchemy` - Database ORM
- `mcp` (FastMCP) - MCP server framework
- Additional deps for autocoder functionality

### Environment Variables (set by service)
- `PROJECT_DIR` - Project to work on
- `ANTHROPIC_API_KEY` - Claude API access
- `PYTHONPATH` - Autocoder source location

## Testing

### Manual Testing Steps

1. **Start the app**:
   ```bash
   npm run dev
   ```

2. **Open Autonomous tab** from sidebar

3. **Click "Start Autocoder"**:
   - Should see "Starting..." spinner
   - Check logs for Python venv creation (first run only)
   - Wait for backend startup (30-45 seconds first time)
   - BrowserView should show autocoder UI

4. **Verify UI**:
   - Check theme matches Claude Code Manager
   - Test autocoder features (initialize, start coding)
   - Verify MCP tools work via Claude

5. **Test controls**:
   - Click "Hide" - BrowserView disappears, backend keeps running
   - Click "Show" - BrowserView reappears
   - Click "Stop" - Backend process terminates

6. **Check logs**:
   - Click "Show Logs" to see stdout/stderr
   - Verify no errors during startup
   - Check FastAPI and Vite server logs

### Build Testing

```bash
npm run build
npm run package  # or package:win, package:mac, package:linux
```

Verify:
- `python/autocoder/` is included in build
- Python files are unpacked from asar (not archived)
- App can find and execute Python scripts after packaging

## Troubleshooting

### "Python not found"
- Install Python 3.9+ from https://python.org
- Ensure `python --version` or `python3 --version` works in terminal
- Restart Electron app after installing Python

### "Failed to start autocoder"
- Check Settings → API key is configured
- Look at logs (click "Show Logs") for error details
- Verify project path is valid
- Check Python venv was created: `%APPDATA%/claude-code-manager/python-autocoder-venv`

### "Server did not start within timeout"
- First start takes 30-45 seconds (installing dependencies)
- Subsequent starts are faster (5-10 seconds)
- Check logs for pip installation errors
- Ensure no firewall blocking localhost:8000 or localhost:5173

### "Backend exited unexpectedly"
- Check logs for Python errors
- Verify all dependencies installed successfully
- Try "Stop" then "Start" again
- Clear venv and reinstall: delete `%APPDATA%/claude-code-manager/python-autocoder-venv`

### Theme not applied
- Refresh the BrowserView (stop/start autocoder)
- Check browser console for CSS injection errors
- Verify BrowserView loaded successfully

## Benefits vs Legacy Workflow

### Why Embedded Autocoder?

**Zero Migration Risk**:
- No code translation errors
- Proven production system
- Get upstream updates automatically

**Better Architecture**:
- SQLite handles 100+ features efficiently
- MCP server for structured Claude communication
- Two-agent pattern (initialize → code)

**Faster Development**:
- 2-3 days integration vs 2-3 weeks rewrite
- Focus on UX, not reimplementation
- Easy theme customization via CSS

**Upstream Benefits**:
- Pull updates from leonvanzyl/autocoder
- Community improvements
- Bug fixes from maintainer

## Future Enhancements

- [ ] Add Python version checker before start
- [ ] Better dependency update UI (progress bar)
- [ ] Save/restore autocoder state between app restarts
- [ ] Multiple project support (switch projects without restart)
- [ ] Autocoder settings panel (MCP config, agent params)
- [ ] Integration with Claude Code Manager's workflow system
- [ ] Export autocoder features to legacy workflow format
- [ ] Live feature count/progress in sidebar
- [ ] Desktop notifications for feature completion
- [ ] Git integration (auto-commit passing features)

## License & Attribution

- **Autocoder**: [leonvanzyl/autocoder](https://github.com/leonvanzyl/autocoder) - MIT License
- **Integration**: Part of Claude Code Manager

## References

- [Autocoder GitHub](https://github.com/leonvanzyl/autocoder)
- [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk)
- [FastMCP](https://github.com/jlowin/fastmcp)
- [Model Context Protocol](https://modelcontextprotocol.io)

# Claude Code Manager

A multi-project frontend for Claude Code CLI that allows you to manage multiple sessions simultaneously.

## Features

- **Multi-Session Management**: Run multiple Claude Code CLI sessions at once
- **Grid View**: See all sessions on one screen in a responsive grid layout
- **File Explorer**: Browse project files with real-time edit highlighting
- **Edit Tracking**: See which files Claude is reading and editing in real-time
- **Built-in Browser**: Embedded browser for previewing apps and documentation
- **Dark Theme**: Modern dark UI optimized for development

## Screenshots

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ ☰  Claude Code Manager                    [+ New Session]  [⚙]  [─][□][×]  │
├─────────┬───────────────────────────────────────────────────────────────────┤
│         │  ┌─ Project A ─────────────────┐ ┌─ Project B ─────────────────┐ │
│ Sessions│  │ ● Working                   │ │ ○ Idle                      │ │
│  ● Proj A  │ ┌──────┬──────────────────┐ │ │ ┌──────┬──────────────────┐ │ │
│  ○ Proj B  │ │ 📁   │ $ claude         │ │ │ │ 📁   │ $ claude         │ │ │
│         │  │ │ src/ │ > Working on...  │ │ │ │ lib/ │ > Ready          │ │ │
│ ───────── │ │ └──────┴──────────────────┘ │ │ └──────┴──────────────────┘ │ │
│ 🌐 Browser│  │ EDITS: src/app/page.tsx   │ │                             │ │
│         │  └─────────────────────────────┘ └─────────────────────────────┘ │
└─────────┴───────────────────────────────────────────────────────────────────┘
```

## Tech Stack

- **Electron** - Cross-platform desktop framework
- **React 18** - UI framework
- **TypeScript** - Type safety
- **Tailwind CSS** - Styling
- **xterm.js** - Terminal emulation
- **node-pty** - PTY for spawning Claude CLI
- **chokidar** - File system watching
- **Zustand** - State management

## Requirements

- Node.js 18+
- npm or yarn
- Claude Code CLI installed and in PATH

## Installation

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Package for distribution
npm run package
```

## Development

```bash
# Run in development mode with hot reload
npm run dev

# Type check
npm run typecheck

# Lint
npm run lint
```

## Building

```bash
# Build for current platform
npm run package

# Build for specific platforms
npm run package:mac
npm run package:win
npm run package:linux
```

## Project Structure

```
src/
├── main/                    # Electron main process
│   ├── index.ts             # Entry point
│   ├── ipc/                 # IPC handlers
│   └── services/            # Backend services
│       ├── session-manager.ts   # PTY session management
│       ├── file-watcher.ts      # File system watching
│       └── config-store.ts      # Settings persistence
├── preload/                 # Preload scripts
│   └── index.ts             # Context bridge
├── renderer/                # React application
│   ├── App.tsx              # Main app component
│   ├── components/          # UI components
│   │   ├── layout/          # Layout components
│   │   ├── session/         # Session management
│   │   ├── terminal/        # xterm.js terminal
│   │   ├── file-explorer/   # File tree
│   │   ├── browser/         # Built-in browser
│   │   └── edit-tracker/    # Edit tracking
│   ├── stores/              # Zustand stores
│   ├── hooks/               # Custom hooks
│   └── styles/              # CSS styles
└── shared/                  # Shared types
    └── types.ts
```

## Usage

1. Launch the application
2. Click "New Session" to create a new Claude Code session
3. Select a project folder
4. The session will automatically launch Claude Code CLI
5. Use the grid view to see multiple sessions at once
6. Toggle the file explorer to see project files
7. Edit tracking shows files being modified in real-time

## Keyboard Shortcuts

- `Ctrl/Cmd + N` - New session
- `Ctrl/Cmd + W` - Close current session
- `Ctrl/Cmd + Tab` - Switch between sessions
- `Ctrl/Cmd + 1-9` - Jump to session by number

## License

MIT - Personal use only

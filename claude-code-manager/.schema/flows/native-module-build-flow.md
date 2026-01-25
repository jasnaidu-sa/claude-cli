# Native Module Build Flow

## Overview
Electron native module compilation and rebuild process, particularly for node-pty.

## Build Steps

1. **Initial Build** - `npm install` triggers electron-rebuild
2. **Verify Native Modules** - Check node-pty.node exists in bindings
3. **Rebuild on Failure** - `npm run rebuild` if missing
4. **Platform-Specific** - Different paths for Windows vs Unix

## Common Issues

### node-pty Not Found
- Symptom: "Cannot find module 'node-pty'"
- Fix: Run `npm run rebuild` in claude-code-manager

### Wrong Electron Version
- Symptom: "The module was compiled against a different Node.js version"
- Fix: `npm rebuild node-pty --runtime=electron --target=XX.X.X`

## Key Files
- `package.json` - rebuild script configuration
- `electron.vite.config.ts` - externalizeDepsPlugin for node-pty
- `src/main/services/terminal-service.ts` - node-pty usage

## Updated
2026-01-25

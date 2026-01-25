# Troubleshooting node-pty

## Common Issues

### 1. Module Not Found
**Symptom:** `Cannot find module 'node-pty'`

**Cause:** Native binary not built for current Electron version

**Fix:**
```bash
cd claude-code-manager
npm run rebuild
```

### 2. Wrong Node.js Version
**Symptom:** `The module was compiled against a different Node.js version`

**Cause:** Electron version mismatch after upgrade

**Fix:**
```bash
npm rebuild node-pty --runtime=electron --target=$(node -p "require('electron/package.json').version")
```

### 3. Python Not Found (Windows)
**Symptom:** `gyp ERR! find Python - Python is not set from command line or npm configuration`

**Cause:** node-gyp requires Python for native compilation

**Fix:**
- Install Python 3.x
- Set npm config: `npm config set python python3`

### 4. Missing Build Tools (Windows)
**Symptom:** `error MSB8036: The Windows SDK version X was not found`

**Cause:** Missing Visual Studio Build Tools

**Fix:**
- Install Visual Studio 2022 Build Tools
- Include "Desktop development with C++" workload

## Verification

Check if node-pty built correctly:
```bash
ls -la node_modules/node-pty/build/Release/
# Should see: pty.node or conpty.node (Windows)
```

## Key Files
- `package.json` - rebuild script
- `src/main/services/terminal-service.ts` - node-pty consumer

## Updated
2026-01-25

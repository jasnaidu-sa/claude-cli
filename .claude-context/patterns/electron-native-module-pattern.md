# PATTERN: Electron Native Module Integration

## Pattern Name

Electron Native Module Integration Pattern

## When to Use

Apply this pattern when:

- Building an Electron application that requires native Node.js modules
- Using modules like `node-pty`, `better-sqlite3`, `sharp`, `serialport`, or similar
- Experiencing ABI version mismatch errors during development or packaging
- Targeting Windows as a deployment platform
- Setting up CI/CD for cross-platform Electron builds

## Problem Statement

Electron applications using native Node.js modules face significant build challenges:

1. **ABI Version Mismatch**: Electron bundles its own version of Node.js, which differs from the system Node.js. Native modules compiled for system Node.js will fail with errors like:
   ```
   Error: The module was compiled against a different Node.js version
   ```

2. **Platform-Specific Compilation**: Native modules require platform-specific compilers:
   - Windows: Visual Studio Build Tools + Python
   - macOS: Xcode Command Line Tools
   - Linux: build-essential, python3

3. **Electron Version Compatibility**: Not all native module versions have prebuilds for all Electron ABI versions

## Solution

### Step 1: Choose Electron Version Strategically

Before starting development, check prebuild availability for your required native modules:

```bash
# Check available prebuilds for a package
npm show @cdktf/node-pty-prebuilt-multiarch prebuild
```

Match your Electron version to available ABI prebuilds. This saves hours of compilation troubleshooting.

### Step 2: Use Prebuilt Package Variants

Always prefer prebuilt package variants over original packages:

| Original Package | Prebuilt Alternative | Notes |
|------------------|---------------------|-------|
| `node-pty` | `@cdktf/node-pty-prebuilt-multiarch` | Maintained by HashiCorp |
| `better-sqlite3` | `better-sqlite3-multiple-ciphers` | Includes prebuilds |
| `sharp` | `sharp` (has built-in prebuilds) | Usually works out of box |
| `serialport` | `@serialport/bindings-cpp` | Check version compatibility |

### Step 3: Configure package.json

```json
{
  "name": "your-electron-app",
  "main": "dist/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "postinstall": "electron-builder install-app-deps",
    "rebuild": "electron-rebuild -f -w @cdktf/node-pty-prebuilt-multiarch",
    "rebuild:all": "electron-rebuild -f"
  },
  "devDependencies": {
    "@electron/rebuild": "^3.6.0",
    "electron": "^31.0.0",
    "electron-builder": "^24.0.0",
    "electron-vite": "^2.0.0"
  },
  "dependencies": {
    "@cdktf/node-pty-prebuilt-multiarch": "^0.10.1-pre.11"
  }
}
```

### Step 4: Configure electron-vite (if using)

```typescript
// electron.vite.config.ts
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: ['@cdktf/node-pty-prebuilt-multiarch']
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    // renderer config
  }
})
```

### Step 5: Configure electron-builder

```yaml
# electron-builder.yml
appId: com.your.app
productName: YourApp
directories:
  buildResources: build
files:
  - '!**/.vscode/*'
  - '!src/*'
  - '!electron.vite.config.*'
  - '!{.eslintrc,.prettierrc}'
asarUnpack:
  - 'node_modules/@cdktf/node-pty-prebuilt-multiarch/**/*'
  - 'node_modules/**/*.node'
win:
  executableName: your-app
  target:
    - target: nsis
      arch:
        - x64
nsis:
  artifactName: ${name}-${version}-setup.${ext}
  shortcutName: ${productName}
  uninstallDisplayName: ${productName}
```

## ABI Version Reference

| Electron | Node.js | ABI | Status |
|----------|---------|-----|--------|
| 28.x     | 18.18   | 118 | Maintenance |
| 29.x     | 20.9    | 120 | Maintenance |
| 30.x     | 20.11   | 121 | Maintenance |
| 31.x     | 20.14   | 125 | Current |
| 32.x     | 20.16   | 128 | Beta |
| 33.x     | 20.18   | 131 | Alpha |

**How to check your Electron's ABI:**
```javascript
// In Electron main process
console.log(process.versions.modules) // Outputs ABI version
```

## Platform-Specific Setup

### Windows Checklist

- [ ] **Python**: Version 3.10, 3.11, or 3.12 (NOT 3.13 - has breaking changes)
  ```powershell
  python --version  # Verify version
  ```
- [ ] **Visual Studio Build Tools**: With "Desktop development with C++" workload
  ```powershell
  # Install via chocolatey
  choco install visualstudio2022buildtools --package-parameters "--add Microsoft.VisualStudio.Workload.VCTools"
  ```
- [ ] **node-gyp**: Version 10.0.0 or higher
  ```powershell
  npm install -g node-gyp@latest
  ```
- [ ] **Windows SDK**: Usually installed with VS Build Tools

### macOS Checklist

- [ ] Xcode Command Line Tools
  ```bash
  xcode-select --install
  ```
- [ ] Python 3 (usually pre-installed)

### Linux Checklist

- [ ] Build essentials
  ```bash
  sudo apt-get install build-essential python3
  ```

## Troubleshooting Quick Reference

### Error: "The module was compiled against a different Node.js version"

**Cause**: ABI mismatch between native module and Electron

**Solution**:
```bash
# Clean and rebuild
rm -rf node_modules
npm install
npm run rebuild
```

### Error: "Could not find any Python installation to use"

**Cause**: Python not found or wrong version

**Solution** (Windows):
```powershell
# Set Python path explicitly
npm config set python "C:\Python311\python.exe"
```

### Error: "gyp ERR! find VS"

**Cause**: Visual Studio Build Tools not found

**Solution**:
```powershell
npm config set msvs_version 2022
```

### Error: "Cannot find module '*.node'"

**Cause**: Native binary not extracted from asar

**Solution**: Add to `electron-builder.yml`:
```yaml
asarUnpack:
  - 'node_modules/**/*.node'
```

## Variations

### Variation 1: Development Only (No Production Build)

For quick prototyping where you don't need production builds:

```json
{
  "scripts": {
    "postinstall": "electron-rebuild -f"
  }
}
```

### Variation 2: CI/CD Cross-Platform Build

For building on CI for multiple platforms:

```yaml
# GitHub Actions example
jobs:
  build:
    strategy:
      matrix:
        os: [windows-latest, macos-latest, ubuntu-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: Install dependencies
        run: npm ci
      - name: Rebuild native modules
        run: npm run rebuild
      - name: Build
        run: npm run build
```

### Variation 3: Multiple Native Modules

When using multiple native modules:

```json
{
  "scripts": {
    "rebuild": "electron-rebuild -f -w @cdktf/node-pty-prebuilt-multiarch -w better-sqlite3"
  }
}
```

## Caveats and Gotchas

1. **Electron Updates**: When updating Electron major versions, always rebuild native modules. ABI changes between major versions.

2. **Prebuild Lag**: Prebuilt packages may lag behind Electron releases by weeks or months. Plan accordingly.

3. **asar Extraction**: Native modules with `.node` binaries must be unpacked from asar archive for production builds.

4. **Python 3.13**: As of late 2024, Python 3.13 has breaking changes that affect node-gyp. Stick with 3.10-3.12.

5. **ARM64 on Windows**: Limited prebuild support. May need to compile from source.

6. **Code Signing**: On macOS, native modules must be code-signed for notarization to succeed.

7. **Antivirus Interference**: Windows antivirus may quarantine `.node` files. Add exceptions for your project directory.

## Related Documentation

- [Electron Native Modules Documentation](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules)
- [electron-rebuild GitHub](https://github.com/electron/rebuild)
- [node-gyp Installation](https://github.com/nodejs/node-gyp#installation)

## Example Implementations

For a complete working example of this pattern, see:
- Issue documentation: `../../.schema/issues/node-pty-windows-fix.md` (if available)
- Troubleshooting flow: `../../.schema/flows/troubleshooting-node-pty.md` (if available)

## Search Keywords

`electron` `native-modules` `node-pty` `better-sqlite3` `electron-rebuild` `ABI` `prebuild` `node-gyp` `windows` `visual-studio` `build-tools` `pattern` `best-practices`

---

**Document Metadata**
- Created: 2025-12-10
- Pattern Type: Integration Pattern
- Complexity: Medium-High
- Platform Focus: Cross-platform with Windows emphasis

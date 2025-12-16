# node-pty Windows Build Failure with Python 3.13 and Electron 32

## Issue Metadata

| Field | Value |
|-------|-------|
| **Issue ID** | NODE-PTY-WIN-001 |
| **Title** | node-pty Windows Build Failure with Python 3.13 and Electron 32 |
| **Severity** | Blocker |
| **Status** | Resolved |
| **Date Reported** | 2024-12-10 |
| **Date Resolved** | 2024-12-10 |
| **Affected Component** | claude-code-manager (Electron app) |
| **Platform** | Windows |

---

## Environment

| Component | Version |
|-----------|---------|
| Operating System | Windows 11 |
| Node.js | Latest (LTS) |
| Python | 3.13 |
| Electron (Original) | 32.2.0 |
| Electron (Fixed) | 29.4.6 |
| node-pty (Original) | 1.0.0 |
| node-pty (Fixed) | @cdktf/node-pty-prebuilt-multiarch 0.10.2 |

---

## Symptoms

### Error 1: GetCommitHash.bat Not Recognized

```
error MSB3073: The command "...\node_modules\node-pty\deps\winpty\src\vs-build\GetCommitHash.bat" exited with code 9009.
```

**Explanation**: The official node-pty npm package is missing the winpty submodule. The git submodule was not properly included in the npm tarball, causing the build script to fail when it could not locate the batch file.

### Error 2: NODE_MODULE_VERSION Mismatch

```
Error: The module '\\?\C:\...\node_modules\node-pty\build\Release\pty.node'
was compiled against a different Node.js version using
NODE_MODULE_VERSION 127. This version of Node.js requires
NODE_MODULE_VERSION 128.
```

**Explanation**: Electron 32 uses ABI version 128, but prebuild-install could only find prebuilt binaries up to ABI 120. The native module binary was incompatible with the Electron runtime.

### Error 3: Python distutils Module Not Found

```
ModuleNotFoundError: No module named 'distutils'
```

**Explanation**: Python 3.13 removed the distutils module per PEP 632. node-gyp relies on distutils for building native modules, making source compilation fail on systems with Python 3.13.

---

## Root Cause Analysis

### Primary Causes

1. **Python 3.13 Deprecation (PEP 632)**
   - The `distutils` module was deprecated in Python 3.10 and removed in Python 3.12
   - node-gyp's build process depends on distutils
   - Python 3.13 systems cannot compile native Node.js modules without installing `setuptools`

2. **Missing winpty Submodule**
   - The official `node-pty` npm package (1.0.0) does not include the winpty git submodule
   - Windows builds require winpty for PTY functionality
   - The npm tarball excludes `.git` directories and submodules by design

3. **Electron ABI Version Gap**
   - Electron 32.2.0 requires NODE_MODULE_VERSION 128
   - Prebuilt binaries on prebuild.io only go up to ABI 120 (Electron 29.x)
   - No prebuilt binaries available for ABI 121-128 range
   - Source compilation is the only fallback, which fails due to issues 1 and 2

### Dependency Chain

```
Electron 32.2.0 (ABI 128)
    |
    v
node-pty 1.0.0
    |
    +-- prebuild-install (looks for ABI 128 prebuilt) --> NOT FOUND
    |
    +-- falls back to node-gyp build
            |
            +-- requires Python distutils --> MISSING in Python 3.13
            |
            +-- requires winpty submodule --> MISSING in npm package
```

---

## Research Links

| Topic | URL |
|-------|-----|
| electron-rebuild issues | https://github.com/electron/rebuild/issues |
| prebuild-install | https://github.com/prebuild/prebuild-install |
| PEP 632 (distutils deprecation) | https://peps.python.org/pep-0632/ |
| node-pty winpty issue | https://github.com/microsoft/node-pty/issues |
| Electron ABI versions | https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules |
| cdktf prebuilt fork | https://www.npmjs.com/package/@cdktf/node-pty-prebuilt-multiarch |

---

## Solution Applied

### Step 1: Switch to Prebuilt Package

Replaced `node-pty` with `@cdktf/node-pty-prebuilt-multiarch`, a fork maintained by HashiCorp's CDKTF team that:
- Includes prebuilt binaries for multiple platforms
- Does not require winpty submodule compilation
- Has binaries for ABI versions up to 120

### Step 2: Downgrade Electron Version

Downgraded Electron from 32.2.0 to 29.4.6 to match available prebuilt binary ABI:

| Electron Version | NODE_MODULE_VERSION (ABI) |
|------------------|---------------------------|
| 32.2.0 | 128 |
| 31.x | 127 |
| 30.x | 125 |
| 29.4.6 | 120 |

Electron 29.4.6 uses ABI 120, which has prebuilt binaries available.

### Step 3: Fix npm Configuration

The `.npmrc` file had an incorrect `os` setting:

```ini
# Before (incorrect)
os=linux

# After (removed or corrected)
# os setting removed to allow native platform detection
```

### Step 4: Reinstall Electron

Manually ran the Electron install script to ensure proper binary download:

```powershell
node node_modules/electron/install.js
```

### Step 5: Verify Prebuilt Binary Installation

Confirmed that the prebuilt binary was correctly placed:

```
node_modules/@cdktf/node-pty-prebuilt-multiarch/build/Release/pty.node
```

---

## Files Modified

### package.json

**Before:**
```json
{
  "devDependencies": {
    "electron": "^32.2.0",
    "node-pty": "^1.0.0"
  }
}
```

**After:**
```json
{
  "devDependencies": {
    "electron": "^29.4.6",
    "@electron/rebuild": "^3.6.0",
    "@cdktf/node-pty-prebuilt-multiarch": "^0.10.2"
  },
  "scripts": {
    "rebuild": "electron-rebuild -f -w @cdktf/node-pty-prebuilt-multiarch"
  }
}
```

### session-manager.ts

**Before:**
```typescript
import { spawn, IPty } from 'node-pty'
```

**After:**
```typescript
import { spawn, IPty } from '@cdktf/node-pty-prebuilt-multiarch'
```

**File Location:** `C:\claude_projects\claude-cli\claude-code-manager\src\main\services\session-manager.ts`

---

## Verification

### Build Verification

```powershell
# Clean install
rm -rf node_modules
npm install

# Verify Electron binary
node node_modules/electron/install.js

# Run development server
npm run dev
```

**Result:** Application starts successfully without native module errors.

### Runtime Verification

1. PTY sessions spawn correctly
2. Shell commands execute in terminal
3. Claude CLI launches within PTY
4. Terminal resize works
5. Session cleanup on close works

---

## Prevention Strategies

### For This Project

1. **Pin Electron Version**
   - Always use Electron versions with available prebuilt node-pty binaries
   - Check prebuild availability before upgrading Electron
   - Document supported Electron version range

2. **Use Prebuilt Packages**
   - Prefer `@cdktf/node-pty-prebuilt-multiarch` over `node-pty` on Windows
   - Avoid packages requiring native compilation when prebuilts exist

3. **CI/CD Considerations**
   - Test Windows builds in CI pipeline
   - Include Python version in build matrix
   - Cache node_modules with platform-specific keys

### General Best Practices

1. **Check ABI Compatibility**
   ```javascript
   // Check current Electron ABI
   console.log(process.versions.modules) // Should match prebuilt ABI
   ```

2. **Verify Native Module Installation**
   ```powershell
   # List native modules
   npm ls | findstr "node-pty"

   # Check binary exists
   dir node_modules\@cdktf\node-pty-prebuilt-multiarch\build\Release\
   ```

3. **Alternative Solutions Considered**
   - Install Python 3.11 (has distutils) - Rejected: System dependency
   - Use node-pty git source with submodules - Rejected: Complex build setup
   - Use WSL for development - Rejected: Performance overhead

---

## Related Documentation

- Electron native modules guide: https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules
- node-pty documentation: https://github.com/microsoft/node-pty
- prebuild ecosystem: https://github.com/prebuild

---

## Search Keywords

`node-pty` `Windows` `Electron` `ABI` `NODE_MODULE_VERSION` `prebuild` `distutils` `Python 3.13` `PEP 632` `winpty` `GetCommitHash.bat` `native module` `electron-rebuild` `@cdktf/node-pty-prebuilt-multiarch`

---

## Appendix: ABI Version Reference Table

| Electron | Chromium | Node.js | ABI |
|----------|----------|---------|-----|
| 29.x | 122 | 20.9 | 120 |
| 30.x | 124 | 20.11 | 125 |
| 31.x | 126 | 20.14 | 127 |
| 32.x | 128 | 20.16 | 128 |

---

## Changelog

| Date | Author | Change |
|------|--------|--------|
| 2024-12-10 | - | Initial documentation of issue and fix |

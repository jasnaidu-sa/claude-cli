# BUG-20241210 Native Module Fix: node-pty on Windows with Electron

## Summary

Claude Code Manager Electron application failed to build and run due to node-pty native module incompatibilities on Windows. The issue stemmed from multiple compounding factors: Python 3.13 removing distutils, missing winpty submodule in official node-pty package, and ABI version mismatches between Electron 32 and available prebuilts.

## Problem Statement

The Electron app could not load the node-pty native module, which is essential for terminal emulation functionality. Build attempts failed with various errors depending on the approach taken.

### Symptoms

- `GetCommitHash.bat` not found errors during npm install
- node-gyp build failures related to distutils
- ABI version mismatch errors at runtime (`was compiled against ABI 120, running on ABI 128`)
- Module not found errors for node-pty bindings

## Investigation Steps

### Step 1: Initial Build Attempt with Official node-pty 1.0.0

```
npm install node-pty
```

**Result:** Failed with `GetCommitHash.bat` error. The official npm package does not include the winpty submodule required for Windows source builds.

### Step 2: Research GitHub Issues

Searched node-pty repository issues for Windows-related problems. Found multiple reports of:
- Build failures on Windows
- Python 3.12+ compatibility issues
- Missing batch files and submodules

### Step 3: Python 3.13 Distutils Investigation

Discovered that Python 3.13 completely removed the `distutils` module (deprecated since 3.10). node-gyp historically relied on distutils for native builds.

**Attempted fix:** Install setuptools (provides distutils compatibility layer)
```
pip install setuptools
```
**Result:** Did not resolve the winpty submodule issue.

### Step 4: ABI Version Analysis

Examined prebuild compatibility:
- Electron 32.x uses ABI version 128
- Available node-pty prebuilts only exist up to ABI version 120
- ABI 120 corresponds to Electron 29.x

### Step 5: Alternative Package Discovery

Found `@cdktf/node-pty-prebuilt-multiarch` - a fork maintained by HashiCorp's CDK for Terraform team that includes prebuilt binaries for multiple platforms.

## Root Cause

Multiple compounding issues created a perfect storm:

| Issue | Impact |
|-------|--------|
| Python 3.13 distutils removal | Breaks node-gyp source builds |
| Missing winpty submodule | Cannot build node-pty from source on Windows |
| Prebuild ABI gap | No prebuilts for Electron 30-32 (ABI 121-128) |
| Electron version choice | Initial Electron 32 required unavailable ABI 128 |

## Solution

### Final Working Configuration

1. **Switch to prebuilt package:**
   ```
   npm uninstall node-pty
   npm install @cdktf/node-pty-prebuilt-multiarch
   ```

2. **Downgrade Electron to match available prebuilts:**
   ```json
   // package.json
   {
     "devDependencies": {
       "electron": "29.4.6"
     }
   }
   ```
   Electron 29.4.6 uses ABI 120, which matches the latest available prebuilts.

3. **Update imports in application code:**
   ```typescript
   // session-manager.ts (before)
   import * as pty from 'node-pty';

   // session-manager.ts (after)
   import * as pty from '@cdktf/node-pty-prebuilt-multiarch';
   ```

4. **Manual prebuild copy (if needed):**
   If binaries are not automatically placed, copy from:
   ```
   node_modules/@cdktf/node-pty-prebuilt-multiarch/prebuilds/win32-x64/
   ```
   To the appropriate location in your build output.

### Verification

```bash
npm run build
npm start
```

The terminal functionality should now work correctly.

## Failed Attempts

### Attempt 1: setuptools Installation
```
pip install setuptools
```
**Why it failed:** While this provides distutils compatibility, it does not solve the missing winpty submodule issue in the official node-pty package.

### Attempt 2: @electron/rebuild
```
npx @electron/rebuild -f -w node-pty
```
**Why it failed:** There are no prebuilts for ABI 128, and source build fails due to missing winpty.

### Attempt 3: Building from Source
```
npm install node-pty --build-from-source
```
**Why it failed:** The npm package lacks the GetCommitHash.bat and other batch files needed for Windows builds. These files exist in the git repository but are not included in the npm package.

### Attempt 4: Git Clone and Build
```
git clone --recurse-submodules https://github.com/microsoft/node-pty
cd node-pty
npm install
```
**Why it failed (partially):** While this approach can work, it requires:
- Python 3.12 or earlier (not 3.13)
- Visual Studio Build Tools
- Proper environment configuration
- Still results in ABI mismatch with Electron 32

## Key Learnings

### 1. Check Prebuild ABI Compatibility First
Before choosing an Electron version, verify that native module prebuilts exist for that ABI version:
- Check the `prebuilds` folder in node_modules
- Use `process.versions.modules` to see current ABI
- Reference: https://github.com/nicolo-ribaudo/node-abi

### 2. Prefer Prebuilt Packages on Windows
Windows native module compilation is fragile. When available, prebuilt packages avoid:
- Visual Studio Build Tools requirements
- Python version compatibility issues
- Missing source files in npm packages

### 3. node-gyp Version Requirements
- node-gyp v10+ is required for Python 3.12+
- Even with compatible node-gyp, Python 3.13 has additional issues
- Consider using Python 3.11 or 3.12 for native module builds

### 4. ABI Version Reference

| Electron Version | ABI Version |
|------------------|-------------|
| 28.x             | 119         |
| 29.x             | 120         |
| 30.x             | 121         |
| 31.x             | 125         |
| 32.x             | 128         |

## Code Changes

### Files Modified

- `package.json` - Changed electron version to 29.4.6, replaced node-pty with @cdktf/node-pty-prebuilt-multiarch
- `src/main/session-manager.ts` - Updated import statement for node-pty alternative package

### package.json Changes

```diff
 {
   "dependencies": {
-    "node-pty": "^1.0.0"
+    "@cdktf/node-pty-prebuilt-multiarch": "^0.11.0-pre.11"
   },
   "devDependencies": {
-    "electron": "^32.0.0"
+    "electron": "29.4.6"
   }
 }
```

## Related Patterns

- [Electron Native Module Pattern](../patterns/electron-native-module-pattern.md)

## Environment Details

- OS: Windows 10/11
- Python: 3.13 (problematic) / 3.11-3.12 (recommended)
- Node.js: 18.x / 20.x
- Electron: 29.4.6 (solution)
- node-pty alternative: @cdktf/node-pty-prebuilt-multiarch

## References

- [node-pty GitHub Issues](https://github.com/microsoft/node-pty/issues)
- [Python 3.13 Release Notes - distutils removal](https://docs.python.org/3.13/whatsnew/3.13.html)
- [@cdktf/node-pty-prebuilt-multiarch](https://www.npmjs.com/package/@cdktf/node-pty-prebuilt-multiarch)
- [Electron ABI Versions](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules)

## Search Keywords

`node-pty` `electron` `native-modules` `windows` `python` `node-gyp` `distutils` `ABI` `prebuild` `GetCommitHash.bat` `winpty` `@cdktf/node-pty-prebuilt-multiarch` `electron-29` `ABI-120` `ABI-128`

---

*Document created: 2024-12-10*
*Last updated: 2024-12-10*

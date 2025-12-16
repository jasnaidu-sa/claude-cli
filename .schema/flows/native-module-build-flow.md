# Native Module Build Flow for Electron Applications

## Overview

### Purpose

This document provides a comprehensive reference for understanding how native Node.js modules (specifically `.node` binary addons) are built, resolved, and integrated within Electron applications. It covers the complete lifecycle from `npm install` through to the final usable binary.

### When This Flow Applies

This documentation is relevant when:

- Installing native modules like `node-pty`, `better-sqlite3`, `sharp`, or other C++ addons
- Building an Electron application that requires native bindings
- Troubleshooting build failures related to Python, C++ compilers, or ABI mismatches
- Understanding why `electron-rebuild` is necessary
- Debugging "MODULE_NOT_FOUND" or "Invalid ELF header" errors
- Working with prebuilt binaries vs source compilation

### Key Dependencies in This Project

From `package.json`:
```json
{
  "devDependencies": {
    "@cdktf/node-pty-prebuilt-multiarch": "^0.10.2",
    "@electron/rebuild": "^3.6.0",
    "node-gyp": "^12.1.0",
    "electron": "^29.4.6"
  },
  "scripts": {
    "rebuild": "electron-rebuild -f -w @cdktf/node-pty-prebuilt-multiarch"
  }
}
```

---

## Complete Build Flow Diagram

This diagram shows the entire journey from `npm install` to a working native module in Electron.

```mermaid
flowchart TB
    subgraph Install["npm install Phase"]
        A[npm install] --> B{Package has<br/>native addon?}
        B -->|No| C[Standard JS install]
        B -->|Yes| D[Check for install scripts]
    end

    subgraph Prebuild["Prebuild Resolution Phase"]
        D --> E{Has prebuild-install<br/>or prebuilt binaries?}
        E -->|Yes| F[prebuild-install runs]
        F --> G{Prebuilt binary<br/>available?}
        G -->|Yes| H[Download prebuilt .node]
        G -->|No| I[Fallback to compilation]
        E -->|No| I
    end

    subgraph Compile["Source Compilation Phase"]
        I --> J{node-gyp available?}
        J -->|No| K[ERROR: Install node-gyp]
        J -->|Yes| L{Python found?}
        L -->|No| M[ERROR: Python required]
        L -->|Yes| N{C++ compiler found?}
        N -->|No| O[ERROR: Build tools required]
        N -->|Yes| P[node-gyp configure]
        P --> Q[node-gyp build]
        Q --> R[.node binary created]
    end

    subgraph ElectronRebuild["Electron Rebuild Phase"]
        H --> S{Running in Electron?}
        R --> S
        S -->|No| T[Node.js: Ready to use]
        S -->|Yes| U[electron-rebuild required]
        U --> V[Download Electron headers]
        V --> W[Recompile against Electron ABI]
        W --> X[Copy to node_modules]
        X --> Y[Electron: Ready to use]
    end

    subgraph Output["Final Output"]
        T --> Z1[node_modules/.../build/Release/*.node]
        Y --> Z2[node_modules/.../build/Release/*.node<br/>Compiled for Electron ABI]
    end

    style A fill:#4a9eff,color:#fff
    style K fill:#ff4a4a,color:#fff
    style M fill:#ff4a4a,color:#fff
    style O fill:#ff4a4a,color:#fff
    style T fill:#4aff4a,color:#000
    style Y fill:#4aff4a,color:#000
```

### Flow Description

1. **npm install Phase**: Package manager detects if the package contains native code (indicated by `binding.gyp` or install scripts)

2. **Prebuild Resolution Phase**: Modern packages often ship with prebuilt binaries for common platforms, avoiding compilation

3. **Source Compilation Phase**: Falls back to building from source using node-gyp, requiring:
   - Python (3.x recommended)
   - C++ compiler (MSVC on Windows, GCC/Clang on Unix)
   - node-gyp toolchain

4. **Electron Rebuild Phase**: Even with successful compilation, Electron requires recompilation against its specific V8/Node ABI

---

## Prebuild Resolution Flow

This diagram details how `prebuild-install` resolves the correct prebuilt binary.

```mermaid
flowchart TB
    subgraph Detection["Platform Detection"]
        A[prebuild-install starts] --> B[Detect OS]
        B --> C[Detect CPU Architecture]
        C --> D[Detect Node/Electron ABI version]
    end

    subgraph LocalCheck["Local Prebuild Check"]
        D --> E{Check prebuilds/<br/>platform-arch/}
        E -->|Found| F{ABI version<br/>matches?}
        F -->|Yes| G[Use local prebuild]
        F -->|No| H{N-API version<br/>compatible?}
        H -->|Yes| I[Use N-API prebuild]
        H -->|No| J[Continue to remote]
        E -->|Not Found| J
    end

    subgraph RemoteCheck["Remote Prebuild Check"]
        J --> K[Check GitHub releases]
        K --> L{Platform-specific<br/>prebuild exists?}
        L -->|Yes| M[Download prebuild]
        M --> N{Verify checksum}
        N -->|Valid| O[Extract to build/Release]
        N -->|Invalid| P[Fallback to compile]
        L -->|No| P
    end

    subgraph Fallback["Fallback to Source"]
        P --> Q[node-gyp rebuild]
        Q --> R{Build successful?}
        R -->|Yes| S[.node binary ready]
        R -->|No| T[ERROR: Build failed]
    end

    subgraph Success["Success"]
        G --> U[Module loaded successfully]
        I --> U
        O --> U
        S --> U
    end

    style A fill:#4a9eff,color:#fff
    style T fill:#ff4a4a,color:#fff
    style U fill:#4aff4a,color:#000
```

### Prebuild Naming Convention

Prebuilt binaries follow a specific naming pattern:
```
{package}-v{version}-{runtime}-v{abi}-{platform}-{arch}.tar.gz
```

Example:
```
node-pty-v0.10.2-electron-v116-win32-x64.tar.gz
node-pty-v0.10.2-napi-v6-darwin-arm64.tar.gz
```

### ABI Version Matrix

| Runtime    | Version | ABI  |
|------------|---------|------|
| Node.js 18 | 18.x    | 108  |
| Node.js 20 | 20.x    | 115  |
| Node.js 22 | 22.x    | 127  |
| Electron 29| 29.x    | 116  |
| N-API      | v6+     | napi |

### N-API Advantage

N-API (Node-API) provides ABI stability across Node.js versions:
- One binary works across multiple Node versions
- Marked as `napi` instead of specific ABI number
- Preferred for modern native modules

---

## Electron Rebuild Flow

This diagram shows exactly what `@electron/rebuild` does.

```mermaid
flowchart TB
    subgraph Trigger["Rebuild Trigger"]
        A[npm run rebuild] --> B[electron-rebuild starts]
        B --> C{-w flag specified?}
        C -->|Yes| D[Rebuild specific module:<br/>@cdktf/node-pty-prebuilt-multiarch]
        C -->|No| E[Scan all node_modules<br/>for native addons]
    end

    subgraph ElectronDetect["Electron Detection"]
        D --> F[Detect Electron version]
        E --> F
        F --> G[Read electron/package.json]
        G --> H[Extract version: 29.4.6]
        H --> I[Calculate ABI: 116]
    end

    subgraph HeaderFetch["Electron Headers"]
        I --> J{Headers cached?}
        J -->|Yes| K[Use cached headers]
        J -->|No| L[Download from GitHub]
        L --> M[electron-v29.4.6-headers.tar.gz]
        M --> N[Extract to ~/.electron-gyp/]
        N --> K
    end

    subgraph Compilation["Recompilation"]
        K --> O[Set environment variables]
        O --> P["npm_config_runtime=electron<br/>npm_config_target=29.4.6<br/>npm_config_disturl=..."]
        P --> Q[Run node-gyp rebuild]
        Q --> R[Compile against Electron headers]
        R --> S{Compilation<br/>successful?}
    end

    subgraph Output["Output Handling"]
        S -->|Yes| T[.node binary created]
        S -->|No| U[ERROR: Rebuild failed]
        T --> V[Verify binary loads]
        V --> W[Module ready for Electron]
    end

    style A fill:#4a9eff,color:#fff
    style U fill:#ff4a4a,color:#fff
    style W fill:#4aff4a,color:#000
```

### Why Electron Rebuild is Necessary

```
Standard Node.js:
  your-app -> node.exe -> V8 (Node's version) -> native-module.node

Electron:
  your-app -> electron.exe -> V8 (Chromium's version) -> native-module.node
                                     ^
                                     |
                          Different ABI! Must recompile.
```

The V8 JavaScript engine bundled with Electron comes from Chromium and has a different ABI (Application Binary Interface) than the V8 in standard Node.js, even for the same Node.js version number.

### Environment Variables Set by electron-rebuild

```bash
npm_config_runtime=electron
npm_config_target=29.4.6
npm_config_arch=x64
npm_config_disturl=https://electronjs.org/headers
npm_config_build_from_source=true
```

---

## Package.json Scripts Explained

### Script Reference

```json
{
  "scripts": {
    "rebuild": "electron-rebuild -f -w @cdktf/node-pty-prebuilt-multiarch"
  }
}
```

### Command Breakdown

| Script | Command | Purpose |
|--------|---------|---------|
| `rebuild` | `electron-rebuild -f -w @cdktf/node-pty-prebuilt-multiarch` | Force rebuild node-pty for Electron |

### Flag Explanation

| Flag | Meaning |
|------|---------|
| `-f` | Force rebuild even if binaries exist |
| `-w <module>` | Only rebuild the specified module (whitelist) |

### When to Use Each Script

```mermaid
flowchart TD
    A[Which script do I need?] --> B{Fresh install?}
    B -->|Yes| C[npm install]
    C --> D{Electron app?}
    D -->|Yes| E[npm run rebuild]
    D -->|No| F[Ready to go]

    B -->|No| G{Changed Electron<br/>version?}
    G -->|Yes| E
    G -->|No| H{Module errors?}
    H -->|Yes| I{ABI mismatch?}
    I -->|Yes| E
    I -->|No| J[Check other issues]
    H -->|No| F

    style E fill:#ff9f4a,color:#000
    style F fill:#4aff4a,color:#000
```

### Common Scenarios

#### Scenario 1: Fresh Clone
```bash
git clone <repo>
cd claude-code-manager
npm install
npm run rebuild    # Required for Electron!
npm run dev
```

#### Scenario 2: Updated Electron Version
```bash
npm update electron
npm run rebuild    # ABI changed, must rebuild natives
```

#### Scenario 3: CI/CD Pipeline
```yaml
- npm ci
- npm run rebuild
- npm run build
- npm run package
```

#### Scenario 4: Switching Node Versions (with nvm)
```bash
nvm use 20
npm run rebuild    # Different Node = different electron-rebuild behavior
```

### postinstall Hook Pattern

Some projects automate rebuilding:

```json
{
  "scripts": {
    "postinstall": "electron-rebuild"
  }
}
```

**Note**: This project does NOT use postinstall to give developers control over when rebuilding occurs (it can be slow).

---

## Troubleshooting Quick Reference

### Common Errors and Solutions

| Error | Cause | Solution |
|-------|-------|----------|
| `MODULE_NOT_FOUND` | Binary not built | Run `npm run rebuild` |
| `Invalid ELF header` | Wrong ABI | Run `npm run rebuild` |
| `was compiled against a different Node.js version` | ABI mismatch | Run `npm run rebuild` |
| `gyp ERR! find Python` | Python not found | Install Python 3.x |
| `gyp ERR! find VS` | No C++ compiler | Install Visual Studio Build Tools |

### Verification Commands

```bash
# Check if native module loads
node -e "require('@cdktf/node-pty-prebuilt-multiarch')"

# Check Electron version
npx electron --version

# Check rebuild targets
npx electron-rebuild --version
```

---

## Related Documentation

- [Electron Native Modules Architecture](../architecture/electron-native-modules.md)
- [Troubleshooting node-pty Issues](../troubleshooting/troubleshooting-node-pty.md)

---

## Search Keywords

`native-module` `electron-rebuild` `node-gyp` `prebuild` `node-pty` `ABI` `binding.gyp` `.node` `binary` `compilation` `headers` `V8` `N-API`

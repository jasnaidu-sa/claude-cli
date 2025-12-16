/**
 * Copy node-pty prebuilt binaries from build/Release to build/Debug
 * The windowsPtyAgent.js code looks for them in build/Debug/
 * but the compiled binaries are placed in build/Release/
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

// Only needed on Windows
if (os.platform() !== 'win32') {
  console.log('[copy-pty-binaries] Skipping - not Windows');
  process.exit(0);
}

const nodePtyPath = path.join(__dirname, '..', 'node_modules', '@homebridge', 'node-pty-prebuilt-multiarch');

// Check if the module exists
if (!fs.existsSync(nodePtyPath)) {
  console.log('[copy-pty-binaries] @homebridge/node-pty-prebuilt-multiarch not found, skipping');
  process.exit(0);
}

const sourceDir = path.join(nodePtyPath, 'build', 'Release');
const targetDir = path.join(nodePtyPath, 'build', 'Debug');

// Check if Release directory exists with binaries
if (!fs.existsSync(sourceDir)) {
  console.log(`[copy-pty-binaries] Source not found: ${sourceDir}`);
  console.log('[copy-pty-binaries] The package may not have compiled yet. Run npm install again.');
  process.exit(0);
}

// Create Debug directory
fs.mkdirSync(targetDir, { recursive: true });

// Copy all files from Release to Debug
const files = fs.readdirSync(sourceDir);
files.forEach(file => {
  const src = path.join(sourceDir, file);
  const dest = path.join(targetDir, file);
  fs.copyFileSync(src, dest);
  console.log(`[copy-pty-binaries] Copied ${file} -> build/Debug/`);
});

console.log(`[copy-pty-binaries] Done - copied ${files.length} files from build/Release to build/Debug`);

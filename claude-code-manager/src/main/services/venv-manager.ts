/**
 * VenvManager - Python Virtual Environment Management Service
 *
 * Manages the shared Python virtual environment at ~/.autonomous-coding/venv/
 * for running the autonomous coding orchestrator.
 *
 * Features:
 * - Creates venv if not exists
 * - Installs required dependencies (claude-code-sdk, python-dotenv)
 * - Provides path to venv Python executable
 * - Checks venv health and reinstalls if needed
 *
 * Security:
 * - Path traversal protection via resolved path validation
 * - Command injection protection via structured command arguments
 * - Package name validation before pip install
 * - Subprocess timeout protection
 */

import { spawn, execFile } from 'child_process'
import { promisify } from 'util'
import { EventEmitter } from 'events'
import * as fs from 'fs/promises'
import * as path from 'path'
import { homedir, platform } from 'os'

const execFileAsync = promisify(execFile)

// Required Python packages for the autonomous orchestrator
const REQUIRED_PACKAGES = [
  'claude-agent-sdk>=0.1.17',
  'anthropic>=0.40.0',
  'python-dotenv>=1.0.0',
  'pyyaml>=6.0'
]

// Python version constraint - minimum only, no max (future versions should work)
const MIN_PYTHON_VERSION = [3, 10]

// Timeout configuration (5 minutes for pip operations)
const PIP_TIMEOUT = 300000
// Timeout for venv creation (5 minutes)
const VENV_CREATION_TIMEOUT = 300000

// Structured Python command type (prevents command injection via string concatenation)
interface PythonCommand {
  cmd: string
  args: string[]
}

export interface VenvStatus {
  exists: boolean
  pythonPath: string | null
  pythonVersion: string | null
  isValid: boolean
  installedPackages: string[]
  missingPackages: string[]
  error?: string
}

export interface VenvCreationProgress {
  stage: 'checking' | 'creating' | 'installing' | 'complete' | 'error'
  message: string
  progress?: number // 0-100
}

/**
 * Extract error message safely from unknown error type
 * Fixes P1 issue: unsafe type assertions with `as Error`
 */
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return String(error)
}

/**
 * Sanitize error message to prevent information disclosure
 * Removes absolute paths and usernames from error messages
 */
function sanitizeErrorMessage(message: string): string {
  const homeDir = homedir()
  let sanitized = message

  // Remove absolute home paths
  if (homeDir) {
    sanitized = sanitized.replace(new RegExp(homeDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '~')
  }

  // Remove common environment usernames
  const username = process.env.USER || process.env.USERNAME
  if (username && username.length > 1) {
    sanitized = sanitized.replace(new RegExp(username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '<user>')
  }

  return sanitized
}

/**
 * Validate package name follows PyPI naming conventions
 * Prevents command injection through package names
 */
function validatePackageName(packageSpec: string): boolean {
  // Extract base package name (before version specifier)
  const packageName = packageSpec.split(/[>=<\[]/)[0].trim()

  // Package names must follow PEP 508 naming
  // Only allow: letters, numbers, hyphens, underscores, dots
  const validPackagePattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/

  if (!validPackagePattern.test(packageName)) {
    return false
  }

  // Prevent path traversal attempts
  if (packageName.includes('..') || packageName.includes('/') || packageName.includes('\\')) {
    return false
  }

  // Prevent shell metacharacters
  if (/[;&|`$(){}]/.test(packageSpec)) {
    return false
  }

  return true
}

/**
 * Parse and validate Python version string
 * Returns null if version format is invalid
 */
function parseVersionString(versionStr: string): { major: number; minor: number } | null {
  // Match versions like "3.10.5", "3.11.0", "3.12.1"
  // Also handles versions like "3.10" without patch
  const versionPattern = /^(\d+)\.(\d+)(?:\.\d+)?(?:rc\d+|a\d+|b\d+)?$/
  const match = versionStr.match(versionPattern)

  if (!match) {
    return null
  }

  const major = parseInt(match[1], 10)
  const minor = parseInt(match[2], 10)

  // Sanity bounds check
  if (isNaN(major) || isNaN(minor) || major < 0 || major > 99 || minor < 0 || minor > 99) {
    return null
  }

  return { major, minor }
}

export class VenvManager extends EventEmitter {
  private readonly venvRoot: string
  private readonly venvPath: string
  private readonly homeDirectory: string

  // Mutex flag to prevent concurrent venv operations (P1 race condition fix)
  private operationInProgress = false

  constructor() {
    super()

    // Get and validate home directory
    this.homeDirectory = homedir()

    // Security: Validate homedir is not empty or suspicious (P0 path traversal fix)
    if (!this.homeDirectory || this.homeDirectory.length < 2) {
      throw new Error('Invalid home directory detected')
    }

    // Use path.resolve to normalize paths
    this.venvRoot = path.resolve(path.join(this.homeDirectory, '.autonomous-coding'))
    this.venvPath = path.resolve(path.join(this.venvRoot, 'venv'))

    // Security: Ensure paths are within home directory (prevent traversal)
    if (!this.venvRoot.startsWith(this.homeDirectory)) {
      throw new Error('Security: venvRoot path traversal detected')
    }
    if (!this.venvPath.startsWith(this.venvRoot)) {
      throw new Error('Security: venvPath path traversal detected')
    }
  }

  /**
   * Get the path to the Python executable in the venv
   */
  getPythonPath(): string {
    if (platform() === 'win32') {
      return path.join(this.venvPath, 'Scripts', 'python.exe')
    }
    return path.join(this.venvPath, 'bin', 'python')
  }

  /**
   * Get the path to pip in the venv
   */
  private getPipPath(): string {
    if (platform() === 'win32') {
      return path.join(this.venvPath, 'Scripts', 'pip.exe')
    }
    return path.join(this.venvPath, 'bin', 'pip')
  }

  /**
   * Check if venv exists and is valid
   */
  async getStatus(): Promise<VenvStatus> {
    const pythonPath = this.getPythonPath()

    try {
      // Check if venv directory exists
      await fs.access(this.venvPath)
    } catch {
      return {
        exists: false,
        pythonPath: null,
        pythonVersion: null,
        isValid: false,
        installedPackages: [],
        missingPackages: REQUIRED_PACKAGES.map(p => p.split('>=')[0])
      }
    }

    try {
      // Check if Python executable exists and works
      await fs.access(pythonPath)

      // Get Python version
      const { stdout: versionOutput } = await execFileAsync(pythonPath, ['--version'])
      const pythonVersion = versionOutput.trim().replace('Python ', '')

      // Parse and validate version format (P1/P2 fix: version parsing edge cases)
      const parsedVersion = parseVersionString(pythonVersion)
      if (!parsedVersion) {
        return {
          exists: true,
          pythonPath,
          pythonVersion,
          isValid: false,
          installedPackages: [],
          missingPackages: REQUIRED_PACKAGES.map(p => p.split('>=')[0]),
          error: `Invalid Python version format: ${pythonVersion}`
        }
      }

      const { major, minor } = parsedVersion

      // Check if version meets minimum requirement (3.10+)
      const versionValid =
        major > MIN_PYTHON_VERSION[0] ||
        (major === MIN_PYTHON_VERSION[0] && minor >= MIN_PYTHON_VERSION[1])

      if (!versionValid) {
        return {
          exists: true,
          pythonPath,
          pythonVersion,
          isValid: false,
          installedPackages: [],
          missingPackages: REQUIRED_PACKAGES.map(p => p.split('>=')[0]),
          error: `Python ${pythonVersion} not supported. Requires Python ${MIN_PYTHON_VERSION[0]}.${MIN_PYTHON_VERSION[1]}+.`
        }
      }

      // Get installed packages using python -m pip (more reliable on Windows)
      const { stdout: pipList } = await execFileAsync(pythonPath, ['-m', 'pip', 'list', '--format=freeze'])
      const installedPackages = pipList.trim().split('\n')
        .filter(line => line.length > 0)
        .map(line => line.split('==')[0].toLowerCase())

      // Check for missing packages
      const requiredNames = REQUIRED_PACKAGES.map(p => p.split('>=')[0].toLowerCase())
      const missingPackages = requiredNames.filter(pkg => !installedPackages.includes(pkg))

      return {
        exists: true,
        pythonPath,
        pythonVersion,
        isValid: missingPackages.length === 0,
        installedPackages,
        missingPackages
      }
    } catch (error) {
      return {
        exists: true,
        pythonPath,
        pythonVersion: null,
        isValid: false,
        installedPackages: [],
        missingPackages: REQUIRED_PACKAGES.map(p => p.split('>=')[0]),
        error: `Failed to verify venv: ${sanitizeErrorMessage(getErrorMessage(error))}`
      }
    }
  }

  /**
   * Find a suitable system Python installation
   * Returns structured command to prevent injection (P0 command injection fix)
   */
  async findSystemPython(): Promise<PythonCommand | null> {
    // Use structured command definitions instead of string concatenation
    const pythonCommands: PythonCommand[] = platform() === 'win32'
      ? [
          { cmd: 'python', args: [] },
          { cmd: 'python3', args: [] },
          { cmd: 'py', args: ['-3.12'] },
          { cmd: 'py', args: ['-3.11'] },
          { cmd: 'py', args: ['-3.10'] }
        ]
      : [
          { cmd: 'python3.12', args: [] },
          { cmd: 'python3.11', args: [] },
          { cmd: 'python3.10', args: [] },
          { cmd: 'python3', args: [] },
          { cmd: 'python', args: [] }
        ]

    for (const pythonCmd of pythonCommands) {
      try {
        const { stdout } = await execFileAsync(pythonCmd.cmd, [...pythonCmd.args, '--version'])
        const version = stdout.trim().replace('Python ', '')

        // Parse and validate version
        const parsedVersion = parseVersionString(version)
        if (!parsedVersion) {
          continue
        }

        const { major, minor } = parsedVersion

        // Check version meets minimum requirement (3.10+)
        if (major > MIN_PYTHON_VERSION[0] || (major === MIN_PYTHON_VERSION[0] && minor >= MIN_PYTHON_VERSION[1])) {
          console.log(`[VenvManager] Found suitable Python: ${pythonCmd.cmd} ${pythonCmd.args.join(' ')} (${version})`)
          return pythonCmd
        }
      } catch {
        // Continue to next command
      }
    }

    return null
  }

  /**
   * Create the virtual environment and install dependencies
   */
  async ensureVenv(): Promise<VenvStatus> {
    // Mutex: prevent concurrent operations (P1 race condition fix)
    if (this.operationInProgress) {
      throw new Error('Venv operation already in progress')
    }

    this.operationInProgress = true

    try {
      this.emitProgress('checking', 'Checking existing venv...', 0)

      const status = await this.getStatus()

      // If venv exists and is valid, we're done
      if (status.exists && status.isValid) {
        this.emitProgress('complete', 'Venv ready', 100)
        return status
      }

      // If venv exists but just missing packages, install them
      if (status.exists && status.pythonVersion && status.missingPackages.length > 0) {
        this.emitProgress('installing', 'Installing missing packages...', 50)
        await this.installPackages(status.missingPackages)
        this.emitProgress('complete', 'Packages installed', 100)
        return this.getStatus()
      }

      // Need to create new venv
      this.emitProgress('creating', 'Finding system Python...', 10)

      const systemPython = await this.findSystemPython()
      if (!systemPython) {
        const error = `No suitable Python found. Install Python ${MIN_PYTHON_VERSION[0]}.${MIN_PYTHON_VERSION[1]}+.`
        this.emitProgress('error', error, 0)
        throw new Error(error)
      }

      // Create venv root directory
      this.emitProgress('creating', 'Creating venv directory...', 20)
      await fs.mkdir(this.venvRoot, { recursive: true })

      // Remove old venv if exists but invalid (with TOCTOU protection)
      if (status.exists) {
        this.emitProgress('creating', 'Removing invalid venv...', 25)
        await this.safeRemoveVenv()
      }

      // Create new venv with timeout protection (P1 fix: no timeout on spawn)
      this.emitProgress('creating', 'Creating virtual environment...', 30)
      await this.createVenvWithTimeout(systemPython)

      // Upgrade pip using python -m pip (required on Windows)
      this.emitProgress('installing', 'Upgrading pip...', 50)
      try {
        await execFileAsync(this.getPythonPath(), ['-m', 'pip', 'install', '--upgrade', 'pip'], {
          timeout: PIP_TIMEOUT
        })
      } catch {
        // Pip upgrade is non-critical, continue even if it fails
        console.log('[VenvManager] Pip upgrade failed, continuing...')
      }

      // Install required packages
      this.emitProgress('installing', 'Installing required packages...', 60)
      await this.installPackages(REQUIRED_PACKAGES)

      this.emitProgress('complete', 'Venv setup complete', 100)
      return this.getStatus()
    } finally {
      this.operationInProgress = false
    }
  }

  /**
   * Safely remove venv directory with TOCTOU protection (P2 race condition fix)
   */
  private async safeRemoveVenv(): Promise<void> {
    try {
      // Resolve actual path to check for symlinks
      const resolvedPath = await fs.realpath(this.venvPath).catch(() => this.venvPath)

      // Security: Verify resolved path is within venvRoot
      if (!resolvedPath.startsWith(this.venvRoot)) {
        throw new Error('Security: venv path points outside venv root')
      }

      // Verify it's a directory, not a symlink to something else
      const stats = await fs.lstat(this.venvPath)
      if (!stats.isDirectory()) {
        throw new Error('Security: venv path is not a directory')
      }

      await fs.rm(this.venvPath, { recursive: true, force: true })
    } catch (error) {
      console.error('[VenvManager] Safe remove failed:', sanitizeErrorMessage(getErrorMessage(error)))
      throw error
    }
  }

  /**
   * Create venv with timeout protection (P1 fix: uncontrolled resource consumption)
   */
  private async createVenvWithTimeout(pythonCmd: PythonCommand): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      // Use structured command arguments (P0 command injection fix)
      const proc = spawn(pythonCmd.cmd, [...pythonCmd.args, '-m', 'venv', this.venvPath], {
        stdio: 'ignore' // P2 fix: buffer overflow - ignore stdio instead of piping without consumption
      })

      // Set timeout for venv creation (P1 fix)
      const timeout = setTimeout(() => {
        proc.kill('SIGTERM')
        reject(new Error('Venv creation timed out after 5 minutes'))
      }, VENV_CREATION_TIMEOUT)

      proc.on('close', (code) => {
        clearTimeout(timeout)
        if (code === 0) {
          resolve()
        } else {
          reject(new Error(`Failed to create venv (exit code ${code})`))
        }
      })

      proc.on('error', (err) => {
        clearTimeout(timeout)
        reject(err)
      })
    })
  }

  /**
   * Install packages in the venv with validation
   */
  private async installPackages(packages: string[]): Promise<void> {
    // Validate all package names before installation (P1 fix: package name validation)
    for (const pkg of packages) {
      if (!validatePackageName(pkg)) {
        throw new Error(`Invalid package specification: ${pkg}`)
      }
    }

    await this.runPip(['install', ...packages])
  }

  /**
   * Run pip command in the venv using python -m pip (more reliable on Windows)
   */
  private async runPip(args: string[]): Promise<string> {
    const pythonPath = this.getPythonPath()

    try {
      const { stdout, stderr } = await execFileAsync(pythonPath, ['-m', 'pip', ...args], {
        timeout: PIP_TIMEOUT // P2 fix: increased from 2 min to 5 min
      })

      // P1 fix: Expanded pip error detection patterns
      if (stderr && (
        stderr.toLowerCase().includes('error') ||
        stderr.toLowerCase().includes('failed') ||
        stderr.toLowerCase().includes('could not find') ||
        stderr.toLowerCase().includes('no matching distribution')
      )) {
        throw new Error(`pip error: ${sanitizeErrorMessage(stderr)}`)
      }

      return stdout
    } catch (error) {
      // Re-throw with sanitized message
      throw new Error(`pip command failed: ${sanitizeErrorMessage(getErrorMessage(error))}`)
    }
  }

  /**
   * Upgrade all packages to latest versions
   */
  async upgradePackages(): Promise<void> {
    // Mutex protection
    if (this.operationInProgress) {
      throw new Error('Venv operation already in progress')
    }

    this.operationInProgress = true

    try {
      this.emitProgress('installing', 'Upgrading packages...', 0)

      const status = await this.getStatus()
      if (!status.exists || !status.isValid) {
        throw new Error('Venv does not exist or is invalid')
      }

      await this.runPip(['install', '--upgrade', ...REQUIRED_PACKAGES])

      this.emitProgress('complete', 'Packages upgraded', 100)
    } finally {
      this.operationInProgress = false
    }
  }

  /**
   * Get the path to the orchestrator scripts directory
   */
  getOrchestratorPath(): string {
    return path.join(this.venvRoot, 'orchestrator')
  }

  /**
   * Emit progress event
   */
  private emitProgress(stage: VenvCreationProgress['stage'], message: string, progress?: number): void {
    const event: VenvCreationProgress = { stage, message, progress }
    this.emit('progress', event)
    console.log(`[VenvManager] ${stage}: ${message}${progress !== undefined ? ` (${progress}%)` : ''}`)
  }
}

// Singleton instance
export const venvManager = new VenvManager()
export default venvManager

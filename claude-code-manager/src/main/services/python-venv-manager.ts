/**
 * Python Virtual Environment Manager
 *
 * Manages Python virtual environment for autocoder integration.
 * Creates venv, installs dependencies, and provides Python/pip paths.
 */

import { app } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import { promisify } from 'util'
import { exec } from 'child_process'

const execAsync = promisify(exec)

export class PythonVenvManager {
  private venvPath: string
  private pythonPath: string
  private pipPath: string
  private autocoderPath: string

  constructor() {
    // Store venv in app data directory
    this.venvPath = path.join(app.getPath('userData'), 'python-autocoder-venv')

    // Set platform-specific paths
    const isWindows = process.platform === 'win32'
    this.pythonPath = path.join(
      this.venvPath,
      isWindows ? 'Scripts/python.exe' : 'bin/python'
    )
    this.pipPath = path.join(
      this.venvPath,
      isWindows ? 'Scripts/pip.exe' : 'bin/pip'
    )

    // Autocoder source path
    this.autocoderPath = path.join(
      app.getAppPath(),
      app.isPackaged ? '../app.asar.unpacked/python/autocoder' : 'python/autocoder'
    )
  }

  /**
   * Check if venv exists and is valid
   */
  async venvExists(): Promise<boolean> {
    try {
      if (!fs.existsSync(this.venvPath)) {
        return false
      }

      // Verify python executable exists
      if (!fs.existsSync(this.pythonPath)) {
        return false
      }

      // Quick health check
      await execAsync(`"${this.pythonPath}" --version`)
      return true
    } catch {
      return false
    }
  }

  /**
   * Create virtual environment
   */
  async createVenv(): Promise<void> {
    console.log('[PythonVenv] Creating virtual environment...')
    console.log('[PythonVenv] Location:', this.venvPath)

    // Remove existing venv if corrupted
    if (fs.existsSync(this.venvPath)) {
      console.log('[PythonVenv] Removing existing venv...')
      fs.rmSync(this.venvPath, { recursive: true, force: true })
    }

    // Create new venv
    try {
      await execAsync(`python -m venv "${this.venvPath}"`)
      console.log('[PythonVenv] Virtual environment created successfully')
    } catch (error) {
      console.error('[PythonVenv] Failed to create venv:', error)
      throw new Error(`Failed to create Python virtual environment: ${error}`)
    }
  }

  /**
   * Install autocoder dependencies
   */
  async installDependencies(): Promise<void> {
    console.log('[PythonVenv] Installing autocoder dependencies...')

    const requirementsPath = path.join(this.autocoderPath, 'requirements.txt')

    if (!fs.existsSync(requirementsPath)) {
      throw new Error(`Requirements file not found: ${requirementsPath}`)
    }

    try {
      // Try to upgrade pip, but don't fail if it errors (pip might be locked)
      console.log('[PythonVenv] Upgrading pip...')
      try {
        await execAsync(`"${this.pythonPath}" -m pip install --upgrade pip`)
      } catch (pipError) {
        console.warn('[PythonVenv] Pip upgrade failed (non-fatal):', pipError)
        // Continue anyway - existing pip version should work
      }

      // Install requirements with streaming output
      console.log('[PythonVenv] Installing from requirements.txt (this may take a minute)...')
      const { stdout, stderr } = await execAsync(
        `"${this.pipPath}" install -r "${requirementsPath}"`,
        { maxBuffer: 10 * 1024 * 1024 } // 10MB buffer for large outputs
      )

      // Log each line of output
      stdout.split('\n').forEach((line) => {
        if (line.trim()) console.log('[PythonVenv]', line.trim())
      })

      if (stderr) {
        stderr.split('\n').forEach((line) => {
          if (line.trim()) console.warn('[PythonVenv]', line.trim())
        })
      }

      console.log('[PythonVenv] Dependencies installed successfully')
    } catch (error) {
      console.error('[PythonVenv] Failed to install dependencies:', error)
      throw new Error(`Failed to install dependencies: ${error}`)
    }
  }

  /**
   * Ensure venv is ready (create if needed, install deps)
   */
  async ensureReady(): Promise<void> {
    console.log('[PythonVenv] Checking virtual environment status...')

    const exists = await this.venvExists()

    if (!exists) {
      console.log('[PythonVenv] Virtual environment not found, creating...')
      await this.createVenv()
      await this.installDependencies()
    } else {
      console.log('[PythonVenv] Virtual environment exists, verifying dependencies...')
      // Verify uvicorn is installed (key dependency for autocoder)
      try {
        await execAsync(`"${this.pythonPath}" -m uvicorn --version`)
        console.log('[PythonVenv] Dependencies verified')
      } catch (error) {
        console.log('[PythonVenv] Dependencies missing, installing...')
        await this.installDependencies()
      }
    }

    console.log('[PythonVenv] Virtual environment ready')
  }

  /**
   * Update dependencies
   */
  async updateDependencies(): Promise<void> {
    console.log('[PythonVenv] Updating dependencies...')
    await this.installDependencies()
  }

  /**
   * Get Python executable path
   */
  getPythonPath(): string {
    return this.pythonPath
  }

  /**
   * Get pip executable path
   */
  getPipPath(): string {
    return this.pipPath
  }

  /**
   * Get autocoder source path
   */
  getAutocoderPath(): string {
    return this.autocoderPath
  }

  /**
   * Get venv root path
   */
  getVenvPath(): string {
    return this.venvPath
  }

  /**
   * Check if Python is available on system
   */
  static async checkPythonAvailable(): Promise<{ available: boolean; version?: string }> {
    try {
      const { stdout } = await execAsync('python --version')
      const version = stdout.trim()
      console.log('[PythonVenv] System Python:', version)
      return { available: true, version }
    } catch {
      try {
        const { stdout } = await execAsync('python3 --version')
        const version = stdout.trim()
        console.log('[PythonVenv] System Python3:', version)
        return { available: true, version }
      } catch {
        console.error('[PythonVenv] Python not found on system')
        return { available: false }
      }
    }
  }
}

// Singleton instance
let instance: PythonVenvManager | null = null

export function getPythonVenvManager(): PythonVenvManager {
  if (!instance) {
    instance = new PythonVenvManager()
  }
  return instance
}

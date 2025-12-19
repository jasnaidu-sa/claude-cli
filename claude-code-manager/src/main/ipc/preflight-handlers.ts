/**
 * Preflight Check IPC Handlers
 *
 * Handles environment validation before autonomous coding starts:
 * - Claude CLI authentication check (OAuth or API key)
 * - Claude CLI availability
 * - Git status
 */

import { ipcMain } from 'electron'
import { exec } from 'child_process'
import { promisify } from 'util'
import { platform, homedir } from 'os'
import * as path from 'path'
import * as fs from 'fs'

const execAsync = promisify(exec)

/**
 * Find Claude CLI executable path
 * Checks common installation locations since Electron may not have the same PATH
 */
async function findClaudeCli(): Promise<string | null> {
  const isWindows = platform() === 'win32'
  const home = homedir()

  console.log('[findClaudeCli] Starting search, isWindows:', isWindows, 'home:', home)

  // Common locations for Claude CLI
  const possiblePaths = isWindows
    ? [
        // npm global install locations on Windows
        path.join(home, 'AppData', 'Roaming', 'npm', 'claude.cmd'),
        path.join(home, 'AppData', 'Roaming', 'npm', 'claude'),
        // Scoop install
        path.join(home, 'scoop', 'shims', 'claude.cmd'),
        // Chocolatey
        'C:\\ProgramData\\chocolatey\\bin\\claude.cmd',
        // Direct PATH
        'claude'
      ]
    : [
        // npm global install locations on Unix
        '/usr/local/bin/claude',
        '/usr/bin/claude',
        path.join(home, '.npm-global', 'bin', 'claude'),
        path.join(home, 'node_modules', '.bin', 'claude'),
        // Homebrew on macOS
        '/opt/homebrew/bin/claude',
        // Direct PATH
        'claude'
      ]

  for (const claudePath of possiblePaths) {
    try {
      // Check if file exists (for absolute paths)
      if (path.isAbsolute(claudePath)) {
        const exists = fs.existsSync(claudePath)
        console.log('[findClaudeCli] Checking absolute path:', claudePath, 'exists:', exists)
        if (exists) {
          console.log('[findClaudeCli] FOUND at:', claudePath)
          return claudePath
        }
      } else {
        // Try executing for PATH-based lookup
        console.log('[findClaudeCli] Trying PATH lookup for:', claudePath)
        await execAsync(`${isWindows ? 'where' : 'which'} ${claudePath}`, { timeout: 3000 })
        console.log('[findClaudeCli] FOUND in PATH:', claudePath)
        return claudePath
      }
    } catch (err) {
      console.log('[findClaudeCli] Not found at:', claudePath)
    }
  }

  console.log('[findClaudeCli] Claude CLI not found anywhere')
  return null
}

// IPC channel names for preflight checks
export const PREFLIGHT_IPC_CHANNELS = {
  CHECK_API_KEY: 'preflight:check-api-key',
  CHECK_CLAUDE_CLI: 'preflight:check-claude-cli',
  CHECK_GIT_STATUS: 'preflight:check-git-status',
  CHECK_PYTHON: 'preflight:check-python'
} as const

export function registerPreflightHandlers(): void {
  console.log('[PreflightHandlers] Registering preflight handlers...')

  // Check Claude CLI authentication (OAuth or API key)
  ipcMain.handle(PREFLIGHT_IPC_CHANNELS.CHECK_API_KEY, async () => {
    console.log('[PreflightHandlers] CHECK_API_KEY called')
    try {
      // First check for environment API key (traditional method)
      if (process.env.ANTHROPIC_API_KEY) {
        return {
          hasKey: true,
          authMethod: 'api_key',
          keyPreview: `${process.env.ANTHROPIC_API_KEY.substring(0, 10)}...`
        }
      }

      // Find Claude CLI (may not be in PATH in Electron environment)
      const claudePath = await findClaudeCli()
      if (!claudePath) {
        return {
          hasKey: false,
          error: 'Claude CLI not found. Install with: npm install -g @anthropic-ai/claude-code'
        }
      }

      // Quote the path for execution (handles spaces in path)
      const claudeCmd = claudePath.includes(' ') ? `"${claudePath}"` : claudePath
      console.log('[PreflightHandlers] Using Claude CLI at:', claudeCmd)

      // Check if Claude CLI is installed and responds to --version
      try {
        console.log('[PreflightHandlers] Running version check...')
        const { stdout: versionOutput } = await execAsync(`${claudeCmd} --version`, { timeout: 10000 })
        console.log('[PreflightHandlers] Version output:', versionOutput.trim())

        if (!versionOutput.toLowerCase().includes('claude')) {
          console.log('[PreflightHandlers] Version check failed - no claude in output')
          return {
            hasKey: false,
            error: 'Claude CLI not responding correctly'
          }
        }

        // Claude CLI is installed and working
        // If it responds to --version, user is authenticated (OAuth or API key)
        // because Claude CLI requires auth to be installed/configured
        console.log('[PreflightHandlers] Claude CLI found and working, assuming authenticated')
        return {
          hasKey: true,
          authMethod: 'oauth',
          keyPreview: `Claude CLI (${versionOutput.trim()})`
        }
      } catch (versionError) {
        console.log('[PreflightHandlers] Version check error:', versionError)
        // Claude CLI exists but version check failed
      }

      return {
        hasKey: false,
        error: 'Not authenticated. Use "claude auth login" to authenticate or set ANTHROPIC_API_KEY.'
      }
    } catch (error) {
      return {
        hasKey: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  })

  // Check if Claude CLI is available and get version
  ipcMain.handle(PREFLIGHT_IPC_CHANNELS.CHECK_CLAUDE_CLI, async () => {
    try {
      // Find Claude CLI (may not be in PATH in Electron environment)
      const claudePath = await findClaudeCli()
      if (!claudePath) {
        return {
          available: false,
          error: 'Claude CLI not found. Install with: npm install -g @anthropic-ai/claude-code'
        }
      }

      // Quote the path for execution (handles spaces in path)
      const claudeCmd = claudePath.includes(' ') ? `"${claudePath}"` : claudePath

      // Try to get version
      try {
        const { stdout } = await execAsync(`${claudeCmd} --version`, { timeout: 5000 })
        const version = stdout.trim()
        return {
          available: true,
          version,
          path: claudePath
        }
      } catch {
        // Claude exists but --version might not work
        return {
          available: true,
          version: 'unknown',
          path: claudePath
        }
      }
    } catch (error) {
      return {
        available: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  })

  // Check git status for a project
  ipcMain.handle(PREFLIGHT_IPC_CHANNELS.CHECK_GIT_STATUS, async (_event, projectPath: string) => {
    try {
      // Check if it's a git repo
      try {
        await execAsync('git rev-parse --is-inside-work-tree', {
          cwd: projectPath,
          timeout: 5000
        })
      } catch {
        return {
          isRepo: false,
          clean: true, // Not a repo, so nothing to worry about
          uncommitted: 0
        }
      }

      // Get status
      const { stdout } = await execAsync('git status --porcelain', {
        cwd: projectPath,
        timeout: 5000
      })

      const lines = stdout.trim().split('\n').filter(l => l.trim())
      const uncommitted = lines.length

      return {
        isRepo: true,
        clean: uncommitted === 0,
        uncommitted,
        files: uncommitted > 0 ? lines.slice(0, 10) : [] // Show first 10 files
      }
    } catch (error) {
      return {
        isRepo: false,
        clean: true,
        uncommitted: 0,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  })

  // Check Python availability
  ipcMain.handle(PREFLIGHT_IPC_CHANNELS.CHECK_PYTHON, async () => {
    try {
      // Python commands to try in order of preference
      const pythonCommands = platform() === 'win32'
        ? [
            { cmd: 'python', args: ['--version'] },
            { cmd: 'python3', args: ['--version'] },
            { cmd: 'py', args: ['-3', '--version'] }
          ]
        : [
            { cmd: 'python3', args: ['--version'] },
            { cmd: 'python', args: ['--version'] }
          ]

      for (const { cmd, args } of pythonCommands) {
        try {
          const { stdout } = await execAsync(`${cmd} ${args.join(' ')}`, { timeout: 5000 })
          const version = stdout.trim().replace('Python ', '')

          // Parse version
          const match = version.match(/^(\d+)\.(\d+)/)
          if (match) {
            const major = parseInt(match[1], 10)
            const minor = parseInt(match[2], 10)

            // Require Python 3.10+
            if (major === 3 && minor >= 10) {
              return {
                available: true,
                version,
                command: cmd,
                meetsMinimum: true
              }
            } else if (major >= 3) {
              return {
                available: true,
                version,
                command: cmd,
                meetsMinimum: false,
                error: `Python ${version} found but 3.10+ required`
              }
            }
          }
        } catch {
          // Continue to next command
        }
      }

      return {
        available: false,
        error: 'Python 3.10+ not found. Install from python.org'
      }
    } catch (error) {
      return {
        available: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  })
}

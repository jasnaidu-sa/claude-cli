/**
 * BVS Worker MCP Server
 *
 * Provides tools for BVS workers to interact with files and run commands.
 * This is spawned as a separate MCP server process for each worker.
 *
 * Tools:
 * - read_file: Read file contents
 * - write_file: Create or replace file
 * - edit_file: Make targeted edits
 * - list_files: List files matching glob pattern
 * - run_command: Execute shell command
 * - mark_complete: Mark section as complete
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolRequest,
  type ListToolsRequest
} from '@modelcontextprotocol/sdk/types.js'
import * as fs from 'fs/promises'
import * as path from 'path'
import { glob } from 'glob'
import { execFile as execFileCb } from 'child_process'
import { promisify } from 'util'

const execFile = promisify(execFileCb)

// Get worktree path from environment
const worktreePath = process.env.WORKTREE_PATH || process.cwd()
const projectPath = process.env.PROJECT_PATH || worktreePath

console.error(`[BvsWorkerMCP] Starting server for worktree: ${worktreePath}`)

// ============================================================================
// Tool Definitions
// ============================================================================

const WORKER_TOOLS = [
  {
    name: 'read_file',
    description: 'Read the contents of a file. Use this to understand existing code before modifications.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path relative to worktree root'
        }
      },
      required: ['path']
    }
  },
  {
    name: 'write_file',
    description: 'Create or replace a file with new content. Creates parent directories if needed.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path relative to worktree root'
        },
        content: {
          type: 'string',
          description: 'Full content to write to file'
        }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'edit_file',
    description: 'Make targeted edits to a file by replacing a unique string. The old_string must appear exactly once in the file.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path relative to worktree root'
        },
        old_string: {
          type: 'string',
          description: 'Exact string to find (must be unique in file)'
        },
        new_string: {
          type: 'string',
          description: 'String to replace it with'
        }
      },
      required: ['path', 'old_string', 'new_string']
    }
  },
  {
    name: 'list_files',
    description: 'List files matching a glob pattern (e.g., "**/*.ts", "src/components/**").',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Glob pattern to match files'
        }
      },
      required: ['pattern']
    }
  },
  {
    name: 'run_command',
    description: 'Execute a shell command (npm, git, etc.). Returns stdout/stderr. Use for build, test, lint commands.',
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'Command to execute (e.g., "npm run build")'
        },
        timeout: {
          type: 'number',
          description: 'Timeout in milliseconds (default: 30000)'
        }
      },
      required: ['command']
    }
  },
  {
    name: 'mark_complete',
    description: 'Mark the section as complete with a summary of changes made.',
    inputSchema: {
      type: 'object',
      properties: {
        summary: {
          type: 'string',
          description: 'Summary of what was implemented'
        },
        files_changed: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of files that were modified'
        }
      },
      required: ['summary', 'files_changed']
    }
  }
]

// ============================================================================
// Tool Handlers
// ============================================================================

async function handleReadFile(args: any): Promise<string> {
  const { path: filePath } = args
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('path is required')
  }

  const fullPath = path.join(worktreePath, filePath)

  try {
    const content = await fs.readFile(fullPath, 'utf-8')

    // Truncate very large files
    if (content.length > 100000) {
      return content.substring(0, 100000) + '\n\n[File truncated - too large]'
    }

    return content
  } catch (error: any) {
    throw new Error(`Failed to read file: ${error.message}`)
  }
}

async function handleWriteFile(args: any): Promise<string> {
  const { path: filePath, content } = args
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('path is required')
  }
  if (typeof content !== 'string') {
    throw new Error('content must be a string')
  }

  const fullPath = path.join(worktreePath, filePath)

  try {
    // Create parent directories
    await fs.mkdir(path.dirname(fullPath), { recursive: true })

    // Write file
    await fs.writeFile(fullPath, content, 'utf-8')

    return `File written successfully: ${filePath} (${content.length} bytes)`
  } catch (error: any) {
    throw new Error(`Failed to write file: ${error.message}`)
  }
}

async function handleEditFile(args: any): Promise<string> {
  const { path: filePath, old_string, new_string } = args
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('path is required')
  }
  if (typeof old_string !== 'string') {
    throw new Error('old_string must be a string')
  }
  if (typeof new_string !== 'string') {
    throw new Error('new_string must be a string')
  }

  const fullPath = path.join(worktreePath, filePath)

  try {
    let content = await fs.readFile(fullPath, 'utf-8')

    // Check if old_string exists
    if (!content.includes(old_string)) {
      throw new Error('old_string not found in file')
    }

    // Check if old_string is unique
    const occurrences = content.split(old_string).length - 1
    if (occurrences > 1) {
      throw new Error(`old_string appears ${occurrences} times in file - must be unique`)
    }

    // Replace
    content = content.replace(old_string, new_string)

    // Write back
    await fs.writeFile(fullPath, content, 'utf-8')

    return `File edited successfully: ${filePath}`
  } catch (error: any) {
    throw new Error(`Failed to edit file: ${error.message}`)
  }
}

async function handleListFiles(args: any): Promise<string> {
  const { pattern } = args
  if (!pattern || typeof pattern !== 'string') {
    throw new Error('pattern is required')
  }

  try {
    const files = await glob(pattern, {
      cwd: worktreePath,
      nodir: true,
      ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**']
    })

    if (files.length === 0) {
      return 'No files found matching pattern'
    }

    if (files.length > 200) {
      return files.slice(0, 200).join('\n') + `\n\n[... and ${files.length - 200} more files]`
    }

    return files.join('\n')
  } catch (error: any) {
    throw new Error(`Failed to list files: ${error.message}`)
  }
}

async function handleRunCommand(args: any): Promise<string> {
  const { command, timeout = 30000 } = args
  if (!command || typeof command !== 'string') {
    throw new Error('command is required')
  }

  // Parse command safely - split by spaces but respect quotes
  const parts = command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || []
  if (parts.length === 0) {
    throw new Error('empty command')
  }

  const cmd = parts[0]!.replace(/^["']|["']$/g, '')
  const cmdArgs = parts.slice(1).map(a => a.replace(/^["']|["']$/g, ''))

  // Block dangerous commands
  const dangerousCommands = ['rm', 'del', 'rmdir', 'format', 'dd', 'mkfs']
  if (dangerousCommands.includes(cmd.toLowerCase())) {
    throw new Error(`Command '${cmd}' is not allowed for safety`)
  }

  try {
    const result = await execFile(cmd, cmdArgs, {
      cwd: worktreePath,
      timeout,
      maxBuffer: 1024 * 1024 // 1MB
    })

    const output = (result.stdout + result.stderr).trim()
    return output || '(no output)'
  } catch (error: any) {
    if (error.killed) {
      throw new Error(`Command timed out after ${timeout}ms`)
    }
    const output = (error.stdout || '' + error.stderr || '').trim()
    throw new Error(`Command failed (exit code ${error.code}):\n${output}`)
  }
}

async function handleMarkComplete(args: any): Promise<string> {
  const { summary, files_changed } = args
  if (!summary || typeof summary !== 'string') {
    throw new Error('summary is required')
  }
  if (!Array.isArray(files_changed)) {
    throw new Error('files_changed must be an array')
  }

  return `Section marked as complete.\nSummary: ${summary}\nFiles changed: ${files_changed.join(', ')}`
}

// ============================================================================
// MCP Server Setup
// ============================================================================

const server = new Server(
  {
    name: 'bvs-worker-tools',
    version: '1.0.0'
  },
  {
    capabilities: {
      tools: {}
    }
  }
)

// List tools handler
server.setRequestHandler(ListToolsRequestSchema, async (request: ListToolsRequest) => {
  return {
    tools: WORKER_TOOLS
  }
})

// Call tool handler
server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
  const { name, arguments: args } = request.params

  try {
    let result: string

    switch (name) {
      case 'read_file':
        result = await handleReadFile(args)
        break
      case 'write_file':
        result = await handleWriteFile(args)
        break
      case 'edit_file':
        result = await handleEditFile(args)
        break
      case 'list_files':
        result = await handleListFiles(args)
        break
      case 'run_command':
        result = await handleRunCommand(args)
        break
      case 'mark_complete':
        result = await handleMarkComplete(args)
        break
      default:
        throw new Error(`Unknown tool: ${name}`)
    }

    return {
      content: [
        {
          type: 'text',
          text: result
        }
      ]
    }
  } catch (error: any) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error.message}`
        }
      ],
      isError: true
    }
  }
})

// Start server
async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('[BvsWorkerMCP] Server started and ready')
}

main().catch((error) => {
  console.error('[BvsWorkerMCP] Fatal error:', error)
  process.exit(1)
})

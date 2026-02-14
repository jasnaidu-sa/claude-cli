#!/usr/bin/env node

/**
 * BVS Worker MCP Server (Standalone)
 *
 * Provides tools for BVS workers to interact with files and run commands.
 * This is a standalone Node.js script that can be spawned as an MCP server.
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js')
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js')
const {
  CallToolRequestSchema,
  ListToolsRequestSchema
} = require('@modelcontextprotocol/sdk/types.js')
const fs = require('fs/promises')
const path = require('path')
const { glob } = require('glob')
const { execFile: execFileCb } = require('child_process')
const { promisify } = require('util')

const execFile = promisify(execFileCb)

// Get worktree path from environment
const worktreePath = process.env.WORKTREE_PATH || process.cwd()
const projectPath = process.env.PROJECT_PATH || worktreePath

console.error(`[BvsWorkerMCP] Starting server for worktree: ${worktreePath}`)

// Tool definitions
const WORKER_TOOLS = [
  {
    name: 'read_file',
    description: 'Read the contents of a file',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' }
      },
      required: ['path']
    }
  },
  {
    name: 'write_file',
    description: 'Create or replace a file',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'edit_file',
    description: 'Make targeted edits to a file',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        old_string: { type: 'string' },
        new_string: { type: 'string' }
      },
      required: ['path', 'old_string', 'new_string']
    }
  },
  {
    name: 'list_files',
    description: 'List files matching glob pattern',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string' }
      },
      required: ['pattern']
    }
  },
  {
    name: 'run_command',
    description: 'Execute a shell command',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        timeout: { type: 'number' }
      },
      required: ['command']
    }
  },
  {
    name: 'mark_complete',
    description: 'Mark section as complete',
    inputSchema: {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        files_changed: { type: 'array', items: { type: 'string' } }
      },
      required: ['summary', 'files_changed']
    }
  }
]

// Tool handlers
async function handleReadFile(args) {
  const { path: filePath } = args
  const fullPath = path.join(worktreePath, filePath)
  const content = await fs.readFile(fullPath, 'utf-8')
  return content.length > 100000
    ? content.substring(0, 100000) + '\n[File truncated]'
    : content
}

async function handleWriteFile(args) {
  const { path: filePath, content } = args
  const fullPath = path.join(worktreePath, filePath)
  await fs.mkdir(path.dirname(fullPath), { recursive: true })
  await fs.writeFile(fullPath, content, 'utf-8')
  return `File written: ${filePath}`
}

async function handleEditFile(args) {
  const { path: filePath, old_string, new_string } = args
  const fullPath = path.join(worktreePath, filePath)
  let content = await fs.readFile(fullPath, 'utf-8')

  if (!content.includes(old_string)) {
    throw new Error('old_string not found in file')
  }

  const occurrences = content.split(old_string).length - 1
  if (occurrences > 1) {
    throw new Error(`old_string appears ${occurrences} times - must be unique`)
  }

  content = content.replace(old_string, new_string)
  await fs.writeFile(fullPath, content, 'utf-8')
  return `File edited: ${filePath}`
}

async function handleListFiles(args) {
  const { pattern } = args
  const files = await glob(pattern, {
    cwd: worktreePath,
    nodir: true,
    ignore: ['**/node_modules/**', '**/.git/**']
  })
  return files.length > 200
    ? files.slice(0, 200).join('\n') + `\n[... ${files.length - 200} more]`
    : files.join('\n')
}

async function handleRunCommand(args) {
  const { command, timeout = 30000 } = args
  const parts = command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || []
  const cmd = parts[0].replace(/^["']|["']$/g, '')
  const cmdArgs = parts.slice(1).map(a => a.replace(/^["']|["']$/g, ''))

  const dangerous = ['rm', 'del', 'rmdir', 'format']
  if (dangerous.includes(cmd.toLowerCase())) {
    throw new Error(`Command '${cmd}' not allowed`)
  }

  const result = await execFile(cmd, cmdArgs, { cwd: worktreePath, timeout, maxBuffer: 1024 * 1024 })
  return (result.stdout + result.stderr).trim() || '(no output)'
}

async function handleMarkComplete(args) {
  const { summary, files_changed } = args
  return `Complete: ${summary}\nFiles: ${files_changed.join(', ')}`
}

// Create MCP server
const server = new Server(
  { name: 'bvs-worker-tools', version: '1.0.0' },
  { capabilities: { tools: {} } }
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: WORKER_TOOLS
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  try {
    let result
    switch (name) {
      case 'read_file': result = await handleReadFile(args); break
      case 'write_file': result = await handleWriteFile(args); break
      case 'edit_file': result = await handleEditFile(args); break
      case 'list_files': result = await handleListFiles(args); break
      case 'run_command': result = await handleRunCommand(args); break
      case 'mark_complete': result = await handleMarkComplete(args); break
      default: throw new Error(`Unknown tool: ${name}`)
    }

    return { content: [{ type: 'text', text: result }] }
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      isError: true
    }
  }
})

// Start server
async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('[BvsWorkerMCP] Server ready')
}

main().catch(error => {
  console.error('[BvsWorkerMCP] Fatal error:', error)
  process.exit(1)
})

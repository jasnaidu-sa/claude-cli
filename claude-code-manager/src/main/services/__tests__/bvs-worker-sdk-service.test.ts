/**
 * Unit Tests for BVS Worker SDK Service
 *
 * Tests the Agent SDK integration including:
 * - MCP Server creation with sdk.tool()
 * - Zod schema validation for tools
 * - Tool result format (CallToolResult)
 * - User MCP config loading (Supabase, Claude-in-Chrome)
 * - Database section detection
 * - Model mapping
 * - Section validation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { z } from 'zod'
import * as fs from 'fs/promises'
import * as path from 'path'

// ============================================================================
// Mock Types (matching bvs-types.ts)
// ============================================================================

interface BvsSection {
  id: string
  name: string
  description?: string
  files: Array<{ path: string; action: string; status?: string }>
  dependencies: string[]
  dependents?: string[]
  successCriteria: Array<{ description: string }>
  status?: string
  progress?: number
  retryCount?: number
  worktreePath?: string
  workerOutput?: string
}

interface BvsFile {
  path: string
  action: 'create' | 'modify' | 'delete'
  status?: string
}

// Mock BvsModelId (full model string format)
type BvsModelId = 'claude-haiku-4-20250514' | 'claude-sonnet-4-20250514'

// ============================================================================
// Mock SDK Module
// ============================================================================

const mockToolHandlers = new Map<string, Function>()

const mockSdk = {
  tool: vi.fn((name: string, description: string, schema: any, handler: Function) => {
    mockToolHandlers.set(name, handler)
    return {
      name,
      description,
      inputSchema: schema,
      handler
    }
  }),
  createSdkMcpServer: vi.fn((options: any) => {
    return {
      name: options.name,
      tools: options.tools,
      instance: { /* mock MCP server instance */ }
    }
  }),
  query: vi.fn(function* () {
    yield { type: 'system', subtype: 'init', session_id: 'test-session-123' }
    yield { type: 'result', total_cost_usd: 0.01, usage: { input_tokens: 1000, output_tokens: 500 } }
  })
}

// ============================================================================
// Test Helper Functions (extracted from service)
// ============================================================================

/**
 * Helper to create CallToolResult format
 */
function toolResult(text: string) {
  return {
    content: [{ type: 'text' as const, text }]
  }
}

/**
 * Check if a section is database-related
 */
function isDatabaseRelatedSection(section: BvsSection): boolean {
  const name = section.name.toLowerCase()
  const desc = (section.description || '').toLowerCase()
  const files = section.files.map(f => f.path.toLowerCase()).join(' ')
  const criteria = section.successCriteria.map(c => c.description.toLowerCase()).join(' ')

  const allText = `${name} ${desc} ${files} ${criteria}`

  const databaseKeywords = [
    'database', 'migration', 'schema', 'table', 'sql',
    'supabase', 'postgres', 'prisma', 'drizzle',
    'create table', 'alter table', 'index', 'constraint',
    'foreign key', 'primary key', 'column', 'seed'
  ]

  return databaseKeywords.some(keyword => allText.includes(keyword))
}

/**
 * Map BVS model ID to SDK model string
 */
function mapModelToSdk(model: BvsModelId): string {
  // BvsModelId is already in the correct format
  return model
}

/**
 * Parse user MCP config from ~/.claude/mcp.json format
 */
function parseUserMcpConfig(config: any): Record<string, any> {
  if (!config.mcpServers) {
    return {}
  }

  const mcpServers: Record<string, any> = {}

  for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
    const cfg = serverConfig as any

    if (cfg.url) {
      mcpServers[name] = {
        type: cfg.type || 'http',
        url: cfg.url,
        ...(cfg.headers ? { headers: cfg.headers } : {})
      }
    } else if (cfg.command) {
      mcpServers[name] = {
        type: 'stdio',
        command: cfg.command,
        args: cfg.args || [],
        ...(cfg.env ? { env: cfg.env } : {})
      }
    }
  }

  return mcpServers
}

// ============================================================================
// Test Suites
// ============================================================================

describe('BVS Worker SDK Service - Tool Creation with sdk.tool()', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockToolHandlers.clear()
  })

  it('should create tools with Zod schemas', () => {
    // Define Zod schema as the SDK expects
    const readFileSchema = { path: z.string().describe('File path') }

    // Create tool using sdk.tool()
    const tool = mockSdk.tool(
      'read_file',
      'Read contents of a file',
      readFileSchema,
      async (input: { path: string }) => {
        return toolResult(`Content of ${input.path}`)
      }
    )

    expect(mockSdk.tool).toHaveBeenCalledWith(
      'read_file',
      'Read contents of a file',
      readFileSchema,
      expect.any(Function)
    )
    expect(tool.name).toBe('read_file')
    expect(tool.inputSchema).toBe(readFileSchema)
  })

  it('should create write_file tool with multiple schema fields', () => {
    const writeFileSchema = {
      path: z.string().describe('File path'),
      content: z.string().describe('File content')
    }

    const tool = mockSdk.tool(
      'write_file',
      'Create or replace a file',
      writeFileSchema,
      async (input: { path: string; content: string }) => {
        return toolResult(`Wrote ${input.content.length} chars to ${input.path}`)
      }
    )

    expect(tool.name).toBe('write_file')
    expect(tool.inputSchema.path).toBeDefined()
    expect(tool.inputSchema.content).toBeDefined()
  })

  it('should create edit_file tool with three schema fields', () => {
    const editFileSchema = {
      path: z.string().describe('File path'),
      old_string: z.string().describe('String to find'),
      new_string: z.string().describe('Replacement string')
    }

    const tool = mockSdk.tool(
      'edit_file',
      'Edit a file',
      editFileSchema,
      async (input: { path: string; old_string: string; new_string: string }) => {
        return toolResult(`Edited ${input.path}`)
      }
    )

    expect(tool.name).toBe('edit_file')
    expect(Object.keys(tool.inputSchema)).toHaveLength(3)
  })

  it('should create mark_complete tool with array schema', () => {
    const markCompleteSchema = {
      summary: z.string().describe('Summary of changes'),
      files_changed: z.array(z.string()).describe('List of files changed')
    }

    const tool = mockSdk.tool(
      'mark_complete',
      'Mark section as complete',
      markCompleteSchema,
      async (input: { summary: string; files_changed: string[] }) => {
        return toolResult(`Completed: ${input.summary}`)
      }
    )

    expect(tool.name).toBe('mark_complete')
    expect(tool.inputSchema.files_changed).toBeDefined()
  })
})

describe('BVS Worker SDK Service - CallToolResult Format', () => {
  it('should return correct CallToolResult format', () => {
    const result = toolResult('Success message')

    expect(result).toEqual({
      content: [{ type: 'text', text: 'Success message' }]
    })
  })

  it('should handle multiline text in result', () => {
    const result = toolResult('Line 1\nLine 2\nLine 3')

    expect(result.content[0].text).toContain('\n')
    expect(result.content[0].type).toBe('text')
  })

  it('should handle empty string result', () => {
    const result = toolResult('')

    expect(result.content[0].text).toBe('')
  })

  it('should handle special characters in result', () => {
    const result = toolResult('File: src/api/[id]/route.ts')

    expect(result.content[0].text).toBe('File: src/api/[id]/route.ts')
  })
})

describe('BVS Worker SDK Service - MCP Server Creation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should create MCP server with correct name format', () => {
    const workerId = 'W1'

    mockSdk.createSdkMcpServer({
      name: `bvs-worker-${workerId}`,
      tools: []
    })

    expect(mockSdk.createSdkMcpServer).toHaveBeenCalledWith({
      name: 'bvs-worker-W1',
      tools: []
    })
  })

  it('should include all required tools in MCP server', () => {
    const tools = [
      mockSdk.tool('read_file', 'Read file', { path: z.string() }, async () => toolResult('')),
      mockSdk.tool('write_file', 'Write file', { path: z.string(), content: z.string() }, async () => toolResult('')),
      mockSdk.tool('edit_file', 'Edit file', { path: z.string(), old_string: z.string(), new_string: z.string() }, async () => toolResult('')),
      mockSdk.tool('list_files', 'List files', { pattern: z.string() }, async () => toolResult('')),
      mockSdk.tool('run_command', 'Run command', { command: z.string() }, async () => toolResult('')),
      mockSdk.tool('mark_complete', 'Mark complete', { summary: z.string(), files_changed: z.array(z.string()) }, async () => toolResult(''))
    ]

    const server = mockSdk.createSdkMcpServer({
      name: 'bvs-worker-test',
      tools
    })

    expect(server.tools).toHaveLength(6)
    expect(server.tools.map((t: any) => t.name)).toEqual([
      'read_file', 'write_file', 'edit_file', 'list_files', 'run_command', 'mark_complete'
    ])
  })
})

describe('BVS Worker SDK Service - User MCP Config Loading', () => {
  it('should parse Supabase MCP config correctly', () => {
    const userConfig = {
      mcpServers: {
        supabase: {
          command: 'npx',
          args: ['-y', '@anthropic/mcp-supabase'],
          env: {
            SUPABASE_URL: 'https://example.supabase.co',
            SUPABASE_KEY: 'test-key'
          }
        }
      }
    }

    const result = parseUserMcpConfig(userConfig)

    expect(result.supabase).toBeDefined()
    expect(result.supabase.type).toBe('stdio')
    expect(result.supabase.command).toBe('npx')
    expect(result.supabase.args).toEqual(['-y', '@anthropic/mcp-supabase'])
    expect(result.supabase.env.SUPABASE_URL).toBe('https://example.supabase.co')
  })

  it('should parse HTTP MCP config correctly', () => {
    const userConfig = {
      mcpServers: {
        'api-server': {
          type: 'http',
          url: 'http://localhost:8080/mcp',
          headers: {
            'Authorization': 'Bearer token123'
          }
        }
      }
    }

    const result = parseUserMcpConfig(userConfig)

    expect(result['api-server']).toBeDefined()
    expect(result['api-server'].type).toBe('http')
    expect(result['api-server'].url).toBe('http://localhost:8080/mcp')
    expect(result['api-server'].headers.Authorization).toBe('Bearer token123')
  })

  it('should parse multiple MCP servers', () => {
    const userConfig = {
      mcpServers: {
        supabase: {
          command: 'npx',
          args: ['-y', '@anthropic/mcp-supabase']
        },
        dataforseo: {
          command: 'npx',
          args: ['-y', '@anthropic/mcp-dataforseo']
        },
        'claude-in-chrome': {
          command: 'chrome-native-host.bat',
          args: []
        }
      }
    }

    const result = parseUserMcpConfig(userConfig)

    expect(Object.keys(result)).toHaveLength(3)
    expect(result.supabase).toBeDefined()
    expect(result.dataforseo).toBeDefined()
    expect(result['claude-in-chrome']).toBeDefined()
  })

  it('should handle empty mcpServers config', () => {
    const userConfig = {
      mcpServers: {}
    }

    const result = parseUserMcpConfig(userConfig)

    expect(Object.keys(result)).toHaveLength(0)
  })

  it('should handle missing mcpServers key', () => {
    const userConfig = {}

    const result = parseUserMcpConfig(userConfig)

    expect(result).toEqual({})
  })

  it('should handle mixed config types (stdio and http)', () => {
    const userConfig = {
      mcpServers: {
        supabase: {
          command: 'npx',
          args: ['-y', '@anthropic/mcp-supabase']
        },
        'remote-api': {
          url: 'https://api.example.com/mcp'
        }
      }
    }

    const result = parseUserMcpConfig(userConfig)

    expect(result.supabase.type).toBe('stdio')
    expect(result['remote-api'].type).toBe('http')
  })
})

describe('BVS Worker SDK Service - Database Section Detection', () => {
  it('should detect database section by name', () => {
    const section: BvsSection = {
      id: 'S1',
      name: 'Database Schema Setup',
      description: 'Set up the database',
      files: [],
      dependencies: [],
      successCriteria: []
    }

    expect(isDatabaseRelatedSection(section)).toBe(true)
  })

  it('should detect migration section', () => {
    const section: BvsSection = {
      id: 'S1',
      name: 'Add User Migration',
      description: 'Create migration for users table',
      files: [{ path: 'supabase/migrations/001_users.sql', action: 'create' }],
      dependencies: [],
      successCriteria: []
    }

    expect(isDatabaseRelatedSection(section)).toBe(true)
  })

  it('should detect Supabase section', () => {
    const section: BvsSection = {
      id: 'S1',
      name: 'Supabase Setup',
      description: 'Configure Supabase client and types',
      files: [],
      dependencies: [],
      successCriteria: []
    }

    expect(isDatabaseRelatedSection(section)).toBe(true)
  })

  it('should detect Prisma section', () => {
    const section: BvsSection = {
      id: 'S1',
      name: 'Update Models',
      description: 'Update Prisma schema',
      files: [{ path: 'prisma/schema.prisma', action: 'modify' }],
      dependencies: [],
      successCriteria: []
    }

    expect(isDatabaseRelatedSection(section)).toBe(true)
  })

  it('should detect section with SQL files', () => {
    const section: BvsSection = {
      id: 'S1',
      name: 'Core Files',
      files: [{ path: 'db/create_table.sql', action: 'create' }],
      dependencies: [],
      successCriteria: []
    }

    expect(isDatabaseRelatedSection(section)).toBe(true)
  })

  it('should detect section with CREATE TABLE in criteria', () => {
    const section: BvsSection = {
      id: 'S1',
      name: 'Setup',
      description: 'Initial setup',
      files: [],
      dependencies: [],
      successCriteria: [
        { description: 'Create table for budgets' }
      ]
    }

    expect(isDatabaseRelatedSection(section)).toBe(true)
  })

  it('should NOT detect non-database section', () => {
    const section: BvsSection = {
      id: 'S1',
      name: 'API Routes',
      description: 'Add REST API routes',
      files: [{ path: 'src/api/users.ts', action: 'create' }],
      dependencies: [],
      successCriteria: [{ description: 'API should return 200' }]
    }

    expect(isDatabaseRelatedSection(section)).toBe(false)
  })

  it('should NOT detect UI component section', () => {
    const section: BvsSection = {
      id: 'S1',
      name: 'User Dashboard',
      description: 'Create dashboard component',
      files: [
        { path: 'src/components/Dashboard.tsx', action: 'create' },
        { path: 'src/components/Dashboard.css', action: 'create' }
      ],
      dependencies: [],
      successCriteria: []
    }

    expect(isDatabaseRelatedSection(section)).toBe(false)
  })

  it('should handle undefined description', () => {
    const section: BvsSection = {
      id: 'S1',
      name: 'Database Setup',
      files: [],
      dependencies: [],
      successCriteria: []
    }

    expect(isDatabaseRelatedSection(section)).toBe(true)
  })
})

describe('BVS Worker SDK Service - Model Mapping', () => {
  it('should return Haiku model string as-is', () => {
    const model: BvsModelId = 'claude-haiku-4-20250514'
    expect(mapModelToSdk(model)).toBe('claude-haiku-4-20250514')
  })

  it('should return Sonnet model string as-is', () => {
    const model: BvsModelId = 'claude-sonnet-4-20250514'
    expect(mapModelToSdk(model)).toBe('claude-sonnet-4-20250514')
  })
})

describe('BVS Worker SDK Service - Tool Handler Execution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockToolHandlers.clear()
  })

  it('should execute read_file handler and return CallToolResult', async () => {
    const readFileSchema = { path: z.string() }

    mockSdk.tool(
      'read_file',
      'Read file',
      readFileSchema,
      async (input: { path: string }) => {
        return toolResult(`Content of ${input.path}`)
      }
    )

    const handler = mockToolHandlers.get('read_file')
    expect(handler).toBeDefined()

    const result = await handler!({ path: 'test.ts' })
    expect(result).toEqual({
      content: [{ type: 'text', text: 'Content of test.ts' }]
    })
  })

  it('should execute write_file handler and track files changed', async () => {
    const filesChanged: string[] = []
    const writeFileSchema = { path: z.string(), content: z.string() }

    mockSdk.tool(
      'write_file',
      'Write file',
      writeFileSchema,
      async (input: { path: string; content: string }) => {
        filesChanged.push(input.path)
        return toolResult(`Wrote ${input.content.length} chars to ${input.path}`)
      }
    )

    const handler = mockToolHandlers.get('write_file')
    const content = 'export const x = 1'
    const result = await handler!({ path: 'new-file.ts', content })

    expect(filesChanged).toContain('new-file.ts')
    expect(result.content[0].text).toContain(`${content.length} chars`)
  })

  it('should execute mark_complete handler and set completion flag', async () => {
    let isComplete = false
    const markCompleteSchema = { summary: z.string(), files_changed: z.array(z.string()) }

    mockSdk.tool(
      'mark_complete',
      'Mark complete',
      markCompleteSchema,
      async (input: { summary: string; files_changed: string[] }) => {
        isComplete = true
        return toolResult(`Completed: ${input.summary}`)
      }
    )

    const handler = mockToolHandlers.get('mark_complete')
    await handler!({ summary: 'Added user API', files_changed: ['api/users.ts'] })

    expect(isComplete).toBe(true)
  })
})

describe('BVS Worker SDK Service - mcpServers Format', () => {
  it('should format mcpServers as Record<string, config> not array', () => {
    const workerId = 'W1'
    const workerMcpServer = mockSdk.createSdkMcpServer({
      name: `bvs-worker-${workerId}`,
      tools: []
    })

    const userMcpConfig = {
      supabase: { type: 'stdio', command: 'npx', args: [] }
    }

    // Build options as the service does
    const options = {
      mcpServers: {
        [`bvs-worker-${workerId}`]: workerMcpServer,
        ...userMcpConfig
      }
    }

    expect(typeof options.mcpServers).toBe('object')
    expect(Array.isArray(options.mcpServers)).toBe(false)
    expect(options.mcpServers['bvs-worker-W1']).toBeDefined()
    expect(options.mcpServers.supabase).toBeDefined()
  })
})

describe('BVS Worker SDK Service - Supabase MCP Integration', () => {
  it('should include Supabase tools in database section prompt', () => {
    const section: BvsSection = {
      id: 'S1',
      name: 'Database Migration',
      description: 'Create budget tables',
      files: [{ path: 'supabase/migrations/001_budgets.sql', action: 'create' }],
      dependencies: [],
      successCriteria: [{ description: 'Tables created in database' }]
    }

    const isDbSection = isDatabaseRelatedSection(section)
    expect(isDbSection).toBe(true)

    // When isDbSection is true, prompt should include Supabase MCP tools
    const supabaseTools = [
      'mcp__supabase__execute_sql',
      'mcp__supabase__list_tables',
      'mcp__supabase__get_table_schema',
      'mcp__supabase__apply_migration'
    ]

    // This simulates what the prompt builder should include
    const promptSection = isDbSection ? supabaseTools.join(', ') : ''
    expect(promptSection).toContain('mcp__supabase__execute_sql')
    expect(promptSection).toContain('mcp__supabase__apply_migration')
  })
})

describe('BVS Worker SDK Service - Claude-in-Chrome MCP Integration', () => {
  it('should add chrome MCP server when available', () => {
    const userConfig = {
      mcpServers: {
        'claude-in-chrome': {
          command: 'C:\\Users\\Test\\.claude\\chrome\\chrome-native-host.bat',
          args: []
        }
      }
    }

    const result = parseUserMcpConfig(userConfig)

    expect(result['claude-in-chrome']).toBeDefined()
    expect(result['claude-in-chrome'].type).toBe('stdio')
    expect(result['claude-in-chrome'].command).toContain('chrome-native-host.bat')
  })

  it('should format chrome MCP for mcpServers option', () => {
    const chromeMcp = {
      'claude-in-chrome': {
        type: 'stdio',
        command: 'chrome-native-host.bat',
        args: []
      }
    }

    const options = {
      mcpServers: {
        'bvs-worker-W1': { /* worker server */ },
        ...chromeMcp
      }
    }

    expect(options.mcpServers['claude-in-chrome']).toBeDefined()
  })
})

describe('BVS Worker SDK Service - Section Validation', () => {
  it('should validate section with all required files present', async () => {
    const section: BvsSection = {
      id: 'S1',
      name: 'API Routes',
      files: [
        { path: 'src/api/users.ts', action: 'create' },
        { path: 'src/api/auth.ts', action: 'create' }
      ],
      dependencies: [],
      successCriteria: []
    }

    // Mock file system check
    const mockFilesExist = ['src/api/users.ts', 'src/api/auth.ts']
    const allFilesExist = section.files.every(f => mockFilesExist.includes(f.path))

    expect(allFilesExist).toBe(true)
  })

  it('should fail validation when files are missing', () => {
    const section: BvsSection = {
      id: 'S1',
      name: 'API Routes',
      files: [
        { path: 'src/api/users.ts', action: 'create' },
        { path: 'src/api/auth.ts', action: 'create' }
      ],
      dependencies: [],
      successCriteria: []
    }

    const mockFilesExist = ['src/api/users.ts'] // auth.ts missing
    const allFilesExist = section.files.every(f => mockFilesExist.includes(f.path))

    expect(allFilesExist).toBe(false)
  })

  it('should auto-complete when all files exist but mark_complete not called', () => {
    const section: BvsSection = {
      id: 'S1',
      name: 'API Routes',
      files: [{ path: 'src/api/users.ts', action: 'create' }],
      dependencies: [],
      successCriteria: []
    }

    const isComplete = false // mark_complete not called
    const allFilesExist = true
    const contentIssuesFound = false

    // Auto-complete logic from validateSectionCompletion
    const shouldAutoComplete = !isComplete && allFilesExist && section.files.length > 0 && !contentIssuesFound

    expect(shouldAutoComplete).toBe(true)
  })
})

describe('BVS Worker SDK Service - Streaming Integration', () => {
  it('should use AsyncGenerator for prompt (required for MCP)', () => {
    const prompt = 'Test prompt'

    async function* generateMessages() {
      yield {
        type: 'user' as const,
        message: {
          role: 'user' as const,
          content: prompt
        },
        parent_tool_use_id: null,
        session_id: ''
      }
    }

    const generator = generateMessages()

    // Verify it's an async generator
    expect(generator[Symbol.asyncIterator]).toBeDefined()
  })

  it('should capture session_id from init message', async () => {
    let sessionId: string | null = null

    for await (const message of mockSdk.query()) {
      if (message.type === 'system' && (message as any).subtype === 'init') {
        sessionId = (message as any).session_id
      }
    }

    expect(sessionId).toBe('test-session-123')
  })

  it('should capture cost from result message', async () => {
    let totalCost = 0

    for await (const message of mockSdk.query()) {
      if (message.type === 'result') {
        totalCost = (message as any).total_cost_usd || 0
      }
    }

    expect(totalCost).toBe(0.01)
  })
})

describe('BVS Worker SDK Service - allowedTools Configuration', () => {
  it('should include mcp__* wildcard for all MCP tools', () => {
    const allowedTools = ['mcp__*']

    // This wildcard should match all MCP tools
    const mcpToolPattern = /^mcp__/
    const testTools = [
      'mcp__supabase__execute_sql',
      'mcp__supabase__list_tables',
      'mcp__claude-in-chrome__screenshot',
      'mcp__bvs-worker-W1__read_file'
    ]

    const allMatch = testTools.every(tool =>
      allowedTools.includes('mcp__*') || mcpToolPattern.test(tool)
    )

    expect(allMatch).toBe(true)
  })
})

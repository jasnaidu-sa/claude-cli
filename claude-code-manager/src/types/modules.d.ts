// Type declarations for modules without TypeScript definitions

declare module 'glob' {
  export interface GlobOptions {
    cwd?: string
    nodir?: boolean
    ignore?: string | string[]
    absolute?: boolean
    dot?: boolean
    maxDepth?: number
  }

  export function glob(
    pattern: string | string[],
    options?: GlobOptions
  ): Promise<string[]>
}

// Claude Code SDK - types not yet published
declare module '@anthropic-ai/claude-code' {
  export interface ClaudeCodeOptions {
    apiKey?: string
    model?: string
    maxTokens?: number
    systemPrompt?: string
  }

  export interface ClaudeCodeMessage {
    role: 'user' | 'assistant' | 'system'
    content: string | MessageContent[]
    type?: string
  }

  export interface MessageContent {
    type: string
    text?: string
    name?: string
    input?: Record<string, unknown>
  }

  export interface ClaudeCodeResult {
    messages: ClaudeCodeMessage[]
    usage: {
      inputTokens: number
      outputTokens: number
    }
  }

  export interface QueryOptions {
    prompt: string | ClaudeCodeMessage[]
    options?: {
      model?: string
      maxTurns?: number
      systemPrompt?: string
      tools?: Tool[]
      allowedTools?: string[]
      disallowedTools?: string[]
      mcpServers?: Record<string, unknown>
      permissionMode?: string
      abortController?: AbortController
      cwd?: string
      parent_tool_use_id?: string | null
      session_id?: string
    }
  }

  export interface Tool {
    name: string
    description: string
    input_schema: Record<string, unknown>
  }

  export interface QueryMessage {
    type: 'system' | 'user' | 'assistant' | 'result' | 'stream_event' | 'tool_progress' | 'auth_status' | 'tool_use'
    content?: string | MessageContent[]
    name?: string
    input?: Record<string, unknown>
  }

  // Main query function - returns async iterable of messages
  export function query(options: QueryOptions): AsyncIterable<QueryMessage>

  export class ClaudeCode {
    constructor(options?: ClaudeCodeOptions)
    chat(messages: ClaudeCodeMessage[]): Promise<ClaudeCodeResult>
    stream(messages: ClaudeCodeMessage[]): AsyncGenerator<string>
  }

  export type MessageRole = 'user' | 'assistant' | 'system'
}

// Model Context Protocol SDK - types not yet published
declare module '@modelcontextprotocol/sdk/server/index.js' {
  export class Server {
    constructor(serverInfo: ServerInfo, options?: ServerOptions)
    setRequestHandler<T>(schema: unknown, handler: (request: T) => Promise<unknown>): void
    connect(transport: Transport): Promise<void>
  }

  export interface ServerInfo {
    name: string
    version: string
  }

  export interface ServerOptions {
    capabilities?: {
      tools?: Record<string, unknown>
      resources?: Record<string, unknown>
    }
  }

  export interface Transport {
    // Transport interface methods
  }
}

declare module '@modelcontextprotocol/sdk/server/stdio.js' {
  import type { Transport } from '@modelcontextprotocol/sdk/server/index.js'

  export class StdioServerTransport implements Transport {
    constructor()
  }
}

declare module '@modelcontextprotocol/sdk/types.js' {
  export const ListToolsRequestSchema: unknown
  export const CallToolRequestSchema: unknown
  export const ListResourcesRequestSchema: unknown
  export const ReadResourceRequestSchema: unknown

  export interface Tool {
    name: string
    description: string
    inputSchema: Record<string, unknown>
  }

  export interface Resource {
    uri: string
    name: string
    mimeType?: string
  }

  export interface CallToolRequest {
    params: {
      name: string
      arguments?: Record<string, unknown>
    }
  }

  export interface ListToolsRequest {
    params?: Record<string, unknown>
  }
}

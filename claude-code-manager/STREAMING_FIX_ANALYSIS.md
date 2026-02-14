# BVS Worker Streaming Output Fix - Analysis

## Problem Summary

BVS worker execution does not show real-time streaming output. The detail modal shows "Waiting for worker output..." until the entire task completes, then all output appears at once.

## Root Cause

The worker service uses `spawn()` to run Claude CLI as a subprocess with `--print` mode:

```typescript
const proc = spawn(command, ['--print', '--mcp-config=...', '-'], {
  stdio: ['pipe', 'pipe', 'pipe']
})
```

**Issue**: Claude CLI's `--print` mode buffers all output and only writes to stdout when the session completes. This is fundamentally different from real-time streaming.

## Current Architecture

```
BVS Worker (CLI Subprocess)
├── spawn() Claude CLI process
├── stdio: piped (buffered)
├── Output events emitted in 'data' handler
└── BUT: Claude CLI only writes on completion
```

## Proven Working Architecture (BVS Planning Chat)

```
BVS Planning Chat (Agent SDK)
├── query() with AsyncGenerator
├── for await (const message of queryResult)
├── Real-time stream events
└── Immediate output emission
```

**Key Code** (`bvs-planning-agent-v2.ts:1156-1248`):
```typescript
async function* generateMessages(): AsyncGenerator<SDKUserMessage> {
  yield {
    type: 'user' as const,
    message: { role: 'user' as const, content: fullPrompt }
  }
}

const queryResult = sdk.query({
  prompt: generateMessages(),
  options
})

for await (const message of queryResult) {
  if (message.type === 'stream_event' && event.delta?.text) {
    // Emit chunk IMMEDIATELY
    this.sendToRenderer(BVS_PLANNING_CHANNELS.RESPONSE_CHUNK, {
      chunk: event.delta.text,
      fullContent: responseContent
    })
  }
}
```

## Solutions

### Option 1: Quick Fix (Attempted) ❌

Add environment variables to force unbuffered output:
- `NODE_NO_READLINE=1`
- `FORCE_INTERACTIVE=1`

**Status**: Won't work - the buffering happens in Claude CLI itself, not Node.js

### Option 2: Convert Workers to Agent SDK ✅ RECOMMENDED

Implement the same streaming pattern as BVS planning chat:

**Benefits**:
- True real-time streaming
- Consistent with planning chat
- Native tool support
- Better error handling
- Session resumption capability

**Implementation Steps**:
1. Create new `BvsWorkerSdkService` class
2. Import Agent SDK: `import { query } from '@anthropic-ai/agent-sdk'`
3. Convert MCP tools to SDK format
4. Implement AsyncGenerator message pattern
5. Add streaming event handlers
6. Replace CLI service in orchestrator

**Files to Modify**:
- Create: `src/main/services/bvs-worker-sdk-service.ts` (new file)
- Modify: `src/main/services/bvs-orchestrator-service.ts` (swap services)
- Keep: `bvs-worker-cli-service.ts` (as fallback/reference)

**Estimated Effort**: 2-3 hours

### Option 3: Hybrid Approach

Keep CLI for backward compatibility, add SDK for new sessions:
- Add config flag: `useAgentSdk: boolean`
- Both services available
- User can choose per-project

## Recommended Path Forward

**Implement Option 2** (Agent SDK conversion) because:

1. **Proven Pattern**: BVS planning chat already works this way
2. **Feature Parity**: Matches desktop experience
3. **User Request**: "look how we implemented streaming in the chat mode for bvs as this is working"
4. **Future-Proof**: Agent SDK is the primary Claude API approach
5. **Clean Architecture**: No subprocess management complexity

## Implementation Plan

### Phase 1: SDK Worker Service (Task #1)
```typescript
// bvs-worker-sdk-service.ts structure
export class BvsWorkerSdkService extends EventEmitter {
  async executeSection(config: WorkerConfig): Promise<WorkerResult> {
    // Generate messages
    async function* generateMessages() {
      yield { type: 'user', message: { role: 'user', content: prompt } }
    }

    // Query with streaming
    const queryResult = query({
      prompt: generateMessages(),
      options: { model, tools: customTools }
    })

    // Stream events
    for await (const message of queryResult) {
      if (message.type === 'stream_event' && message.event.delta?.text) {
        this.emit('output', {
          workerId,
          sectionId,
          output: message.event.delta.text,
          timestamp: Date.now()
        })
      }

      if (message.type === 'tool_use') {
        // Execute tool and emit progress
      }

      if (message.type === 'result') {
        // Complete section
      }
    }
  }
}
```

### Phase 2: Orchestrator Integration
Replace CLI service instance with SDK service in orchestrator

### Phase 3: Testing
1. Run existing failed section (S1) with new service
2. Verify real-time output in modal
3. Confirm mark_complete detection works
4. Validate quality gates

## Current Status

- ✅ Error display fixed (section.errorMessage)
- ✅ Prisma → Supabase paths fixed in plan.json
- 🔄 Real-time streaming (Task #1 - In Progress)
- ⏳ Checkpoint approval modal (Task #2 - Pending)

## Next Action

Begin implementing `bvs-worker-sdk-service.ts` following the BVS planning chat pattern.

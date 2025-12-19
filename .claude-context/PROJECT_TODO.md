# Harness Framework Enhancement - Phase 1: Context Agent

## Overview

Implement the Context Agent to solve the "lost in the middle" problem in autonomous coding workflows. This agent maintains compressed, relevant context across the entire execution lifecycle.

## Architecture Decision

Following established patterns from `research-agent-runner.ts`:
- **Electron Side**: TypeScript service class extending EventEmitter
- **Agent Side**: Python script using Claude CLI via subprocess
- **Communication**: JSON-based streaming via stdout/stderr
- **Security**: Shell injection prevention, path validation, credential sanitization
- **MCP Config**: Project-scoped `.mcp.json` for tool isolation

## Phase 1 Tasks

### 1. Context Storage Schema Design
**File**: `.autonomous/context/` directory structure

Create JSON schemas for:
- `running-summary.md` - Compressed context (max 2000 tokens)
- `key-decisions.json` - Critical design decisions
- `failure-memory.json` - Failures with root causes
- `active-constraints.json` - Current constraints

**Acceptance Criteria**:
- Schema files documented with TypeScript interfaces
- Sample JSON for each file type
- Validation logic for each schema

---

### 2. Python Context Agent Script
**File**: `autonomous-orchestrator/context_agent.py`

Following patterns from `agent.py`:
- Class: `ContextAgent`
- Uses: `@dataclass` for state
- Emits: JSON progress via `print(json.dumps(...))`
- Security: `sanitize_output()` for credential redaction

**Capabilities**:
- Read feature completion logs from `.autonomous/logs/`
- Summarize after every 5 features OR at category boundaries
- Maintain running summary (compress old context)
- Extract key decisions from feature specs
- Track failures with root causes
- Update active constraints

**Input** (via stdin):
```json
{
  "action": "summarize",
  "projectPath": "/path/to/project",
  "trigger": "category_complete",
  "categoryId": "cat-001",
  "completedFeatures": ["feat-001", "feat-002"]
}
```

**Output** (via stdout):
```json
{
  "type": "progress",
  "phase": "summarizing",
  "message": "Analyzing 5 completed features..."
}
{
  "type": "complete",
  "summary": {
    "running_summary": "...",
    "key_decisions": [...],
    "failure_memory": [...],
    "active_constraints": [...]
  }
}
```

**Acceptance Criteria**:
- Follows `AutonomousAgent` pattern from `agent.py`
- Uses Haiku model for speed/cost
- Outputs structured JSON
- Handles errors gracefully
- Max execution time: 30 seconds per summarization

---

### 3. TypeScript Context Service
**File**: `claude-code-manager/src/main/services/context-agent-runner.ts`

Following patterns from `research-agent-runner.ts`:
- Class: `ContextAgentRunner extends EventEmitter`
- Security: `validateProjectPath()`, `createSafeEnv()`, `sanitizeOutput()`
- Spawning: Uses `getSpawnConfig()` for Windows compatibility
- Events: `status`, `complete`, `error`

**Methods**:
```typescript
class ContextAgentRunner extends EventEmitter {
  async summarizeContext(
    projectPath: string,
    trigger: 'feature_count' | 'category_complete',
    completedFeatures: string[]
  ): Promise<ContextSummary>

  async loadContext(projectPath: string): Promise<ContextData>

  cancelSummarization(taskId: string): boolean
}
```

**Events**:
- `status` - Progress updates
- `complete` - Summarization finished
- `error` - Failure

**Acceptance Criteria**:
- Follows EventEmitter pattern
- Validates all paths
- Sanitizes credentials from output
- Windows-compatible spawn logic
- Timeout after 60 seconds

---

### 4. Electron IPC Handlers
**File**: `claude-code-manager/src/main/ipc/context-handlers.ts`

Following patterns from `discovery-handlers.ts`:
- Register handlers in `ipcMain.handle()`
- Use service classes for logic
- Return structured responses
- Error handling with try/catch

**Handlers**:
```typescript
ipcMain.handle('context:summarize', async (_, projectPath, trigger, features) => {
  // Trigger context summarization
})

ipcMain.handle('context:load', async (_, projectPath) => {
  // Load existing context
})

ipcMain.handle('context:get-decision', async (_, projectPath, featureId) => {
  // Get specific decision for a feature
})
```

**Acceptance Criteria**:
- All handlers registered in main process
- Error responses include `success: false, error: string`
- Success responses include context data
- Handlers validate inputs

---

### 5. Preload API Surface
**File**: `claude-code-manager/src/preload/index.ts`

Add to existing `electronAPI`:
```typescript
context: {
  summarize: (projectPath: string, trigger: string, features: string[]) => Promise<ContextSummary>,
  load: (projectPath: string) => Promise<ContextData>,
  getDecision: (projectPath: string, featureId: string) => Promise<Decision | null>,
  onProgress: (callback: (progress: ContextProgress) => void) => UnsubscribeFn
}
```

**Acceptance Criteria**:
- TypeScript types exported
- Event listeners properly typed
- Cleanup functions for listeners

---

### 6. Integration with Orchestrator
**File**: `claude-code-manager/src/main/services/orchestrator-runner.ts`

Add context summarization triggers:
- **After every 5 features**: Call `contextAgent.summarize()`
- **After each category**: Call `contextAgent.summarize()` with category context
- **Include context in feature execution**: Load current summary and inject into feature spec

**Changes**:
```typescript
// In feature completion handler
if (completedCount % 5 === 0) {
  await this.contextAgent.summarize(projectPath, 'feature_count', lastFiveFeatures)
}

// In category completion handler
await this.contextAgent.summarize(projectPath, 'category_complete', categoryFeatures)

// Before feature execution
const context = await this.contextAgent.loadContext(projectPath)
const enrichedSpec = this.injectContext(featureSpec, context)
```

**Acceptance Criteria**:
- Context summarization triggered automatically
- Current context loaded before each feature
- Context injected into execution prompts
- No performance degradation (summarization is async)

---

### 7. Schema Documentation
**Files**: `.schema/files/autonomous-orchestrator/context_agent.py.md`, etc.

Document:
- `context_agent.py` - Agent implementation
- `context-agent-runner.ts` - TypeScript service
- `context-handlers.ts` - IPC handlers
- Context storage schemas

**Acceptance Criteria**:
- All new files have schema docs
- Schema docs follow existing format
- Include interaction diagrams
- Document data flows

---

### 8. Testing & Validation
**Tests**:
- Unit test: Context summarization logic
- Integration test: End-to-end summarization
- Security test: Credential sanitization
- Performance test: Summarization under 30 seconds

**Manual Validation**:
- Run full workflow with context agent enabled
- Verify context files created in `.autonomous/context/`
- Check context is injected into feature execution
- Verify summarization happens at correct triggers

**Acceptance Criteria**:
- All tests passing
- Manual validation checklist complete
- No performance regression
- Context improves execution quality (measured by reduced errors)

---

## Success Metrics

- **Context Compression**: 200K tokens → 2K token summaries
- **Execution Time**: Summarization completes in <30 seconds
- **Quality**: Execution agents have 90%+ of needed context
- **Reliability**: Context agent runs without failures

---

## Dependencies

- Existing `research-agent-runner.ts` pattern
- Existing `orchestrator-runner.ts` integration points
- Claude CLI with Haiku model access
- Project has `.autonomous/` directory

---

## Risk Mitigation

- **Risk**: Context summarization slows down workflow
  - **Mitigation**: Run in background, don't block execution

- **Risk**: Summaries lose critical information
  - **Mitigation**: Extensive testing with real workflows

- **Risk**: Security issues with context storage
  - **Mitigation**: Sanitize all outputs, validate paths

---

## Next Phases

- **Phase 2**: Checkpoint Agent (strategic human intervention)
- **Phase 3**: Impact Assessment Agent (forward-looking analysis)

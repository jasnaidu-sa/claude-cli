# Leon's Streaming Architecture - Analysis & Comparison

**Date**: 2025-12-20
**Issue**: No real-time streaming feedback in our UI during orchestrator execution
**Leon's Repo**: https://github.com/leonvanzyl/autonomous-coding-with-ui

---

## Leon's Architecture (Server-Sent Events)

### Backend (FastAPI)

**File**: `api.py`

```python
# Global state with event queues
class AppState:
    events: List[Dict] = []
    queues: List[asyncio.Queue] = []
    running: bool = False

# Event callback function passed to agent
async def event_callback(event_type: str, data: Any):
    event = {"type": event_type, "data": data, "timestamp": time()}
    state.events.append(event)  # Store for replay

    # Broadcast to ALL connected clients
    for queue in state.queues:
        await queue.put(event)

# SSE endpoint
@app.get("/api/events")
async def subscribe(request: Request):
    queue = asyncio.Queue()
    state.queues.append(queue)  # Add this client

    # Send existing events first (replay)
    for event in state.events:
        await queue.put(event)

    async def event_generator():
        try:
            while True:
                if await request.is_disconnected():
                    break
                event = await queue.get()
                yield {
                    "event": "message",
                    "id": str(event["timestamp"]),
                    "data": json.dumps(event)
                }
        finally:
            state.queues.remove(queue)  # Cleanup

    return EventSourceResponse(event_generator())
```

### Agent Emits Events

**File**: `agent.py`

```python
async def run_agent_session(
    client: ClaudeSDKClient,
    message: str,
    project_dir: Path,
    event_callback: Optional[EventCallback] = None
):
    # Emit thought events (real-time text streaming)
    async for msg in client.receive_response():
        if isinstance(msg, AssistantMessage):
            for block in msg.content:
                if hasattr(block, "text"):
                    # REAL-TIME TEXT STREAMING
                    await event_callback("thought", {"text": block.text})
                elif hasattr(block, "name"):
                    # Tool use start
                    await event_callback("tool_use", {
                        "name": block.name,
                        "input": block.input
                    })

        elif isinstance(msg, UserMessage):
            for block in msg.content:
                # Tool results
                await event_callback("tool_result", {
                    "tool_use_id": block.tool_use_id,
                    "status": "success|error|blocked"
                })

    # Session complete
    await event_callback("progress", {"passing": X, "total": Y})
```

### Frontend (React + EventSource)

**File**: `frontend/src/App.tsx`

```tsx
const [events, setEvents] = useState<AgentEvent[]>([])
const eventSourceRef = useRef<EventSource | null>(null)

const connectSSE = () => {
    const es = new EventSource('/api/events')
    eventSourceRef.current = es

    es.onmessage = (e) => {
        const event: AgentEvent = JSON.parse(e.data)
        setEvents(prev => [...prev, event].slice(-500))  // Keep last 500

        if (event.type === 'progress') {
            fetchFeatures()  // Update feature list
        } else if (event.type === 'status') {
            setRunning(event.data.running)
        } else if (event.type === 'session_start') {
            setCurrentAgentType(event.data.type)
            setCurrentIteration(event.data.iteration)
        }
    }

    es.onerror = () => {
        es.close()
        setTimeout(connectSSE, 3000)  // Reconnect
    }
}

useEffect(() => {
    if (running) {
        connectSSE()
        // Poll for features every 5s (backup)
        const pollInterval = setInterval(fetchFeatures, 5000)
        return () => clearInterval(pollInterval)
    }
}, [running])
```

### Event Types Emitted

Leon's agent emits these events:

| Event Type | Data | Purpose |
|------------|------|---------|
| `thought` | `{text: string}` | Real-time text streaming from Claude |
| `tool_use` | `{name, input}` | Tool call started |
| `tool_result` | `{tool_use_id, status}` | Tool call completed |
| `session_start` | `{iteration, type}` | New agent session (INITIALIZER or CODING) |
| `progress` | `{passing, total}` | Feature progress update |
| `info` | `{message}` | General status messages |
| `error` | `{message}` | Error messages |
| `complete` | `{project_dir}` | All sessions complete |

---

## Our Architecture (Electron IPC + Stdio)

### Backend (Electron Main Process)

**File**: `orchestrator-runner.ts`

```typescript
private async spawnOrchestrator(config: OrchestratorConfig): Promise<void> {
    const process = spawn(pythonPath, args, {
        cwd: config.projectPath,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: buildEnvironment()
    })

    // Collect stdout and parse JSON
    process.stdout?.on('data', (data: Buffer) => {
        const chunk = data.toString()
        jsonBuffer += chunk
        const lines = jsonBuffer.split('\n')
        jsonBuffer = lines.pop() || ''

        for (const line of lines) {
            if (!line.trim()) continue
            try {
                const parsed = JSON.parse(line)
                // Send to renderer via IPC
                getMainWindow()?.webContents.send(
                    'orchestrator:output',
                    parsed
                )
            } catch (error) {
                // Not JSON, ignore
            }
        }
    })
}
```

### Python Agent Emits JSON to Stdout

**File**: `autonomous-orchestrator/agent.py`

```python
def emit_output(self, output_type: str, data: str):
    """Emit structured output event."""
    event = {
        "type": output_type,
        "data": data,
        "timestamp": time.time()
    }
    print(json.dumps(event), flush=True)

def _handle_stream_event(self, event):
    """Handle streaming events from Claude SDK."""
    if event.type == "text":
        self.emit_output("stream_chunk", {
            "chunk_type": "text",
            "data": event.text
        })
    elif event.type == "tool_use":
        self.emit_output("stream_chunk", {
            "chunk_type": "tool_start",
            "data": {"name": event.name, "input": event.input}
        })
```

### Frontend (React)

**File**: `ExecutionDashboard.tsx`

```tsx
useEffect(() => {
    const handleOutput = (_event: any, output: OrchestratorOutput) => {
        // Store output
        setOrchestratorOutputs(prev => [...prev, output])

        // Update UI based on type
        if (output.type === 'status') {
            setOrchestratorStatus(output.status)
        } else if (output.type === 'progress') {
            // Update progress
        }
    }

    window.electron.orchestrator.onOutput(handleOutput)

    return () => {
        // No cleanup - IPC listeners persist
    }
}, [])
```

---

## Key Differences

### 1. Event Transport

| Leon (SSE) | Ours (Electron IPC) |
|------------|---------------------|
| HTTP SSE connection | IPC channel |
| Browser EventSource API | Electron webContents.send() |
| Reconnects automatically | No reconnection needed |
| Works across network | Local only |
| Standard web API | Electron-specific |

### 2. Event Broadcasting

| Leon | Ours |
|------|------|
| **Pub/Sub pattern** | **Direct send** |
| Multiple clients supported | Single renderer window |
| Queue per client | No queuing |
| Event replay on connect | No replay |
| Clients can connect mid-session | No mid-session joining |

### 3. Event Flow

**Leon**:
```
Agent → event_callback() → state.queues → SSE stream → EventSource → React state
```

**Ours**:
```
Agent → stdout (JSON) → spawn listener → IPC send → IPC handler → React state
```

### 4. Real-Time Streaming

**Leon**:
- ✅ Every text chunk emitted immediately
- ✅ Tool use shown in real-time
- ✅ Tool results streamed
- ✅ Progress updates broadcast

**Ours**:
- ❌ No text chunk streaming (agent uses SDK's internal streaming)
- ❌ Tool use/results not emitted to stdout in real-time
- ✅ Progress updates work
- ❌ Long silences during codebase exploration

---

## Why Our UI Shows No Streaming

### Problem 1: Agent Doesn't Emit Events During Exploration

**Leon's agent.py** (lines 89-140):
```python
async for msg in client.receive_response():
    if isinstance(msg, AssistantMessage):
        for block in msg.content:
            if hasattr(block, "text"):
                # EMITS IMMEDIATELY
                await event_callback("thought", {"text": block.text})
```

**Our agent.py** (line 291):
```python
# Streaming happens via _handle_stream_event callback
response = await self.client.send_message(message, prompt)
# Emit completion marker (streaming already sent the content)
self.emit_progress("Test generation complete")
```

**Issue**: Our `_handle_stream_event` callback exists but doesn't call `emit_output()` for text chunks. The streaming happens internally in the SDK but never gets sent to stdout/UI.

### Problem 2: Two Parallel Processes

As we saw, TWO orchestrator processes spawned (PID 50792 and 54892). The first one completed quickly, but the second one took 3+ minutes exploring the codebase with NO output to stdout.

**Why no output?**
- Task tool (Explore agent) is a **subprocess**
- Subprocess output doesn't go to our stdout
- We only emit when the Task returns, not during its execution

### Problem 3: No Progress During Tool Use

**Leon's approach**:
```python
# Every tool use is emitted
await event_callback("tool_use", {"name": "Read", "input": "file.tsx"})
# ... tool executes ...
await event_callback("tool_result", {"status": "success"})
```

**Our approach**:
```python
# Tool use starts (no emission)
# ... tool executes silently ...
# Tool completes (no emission)
# Only emit when entire iteration completes
```

---

## Solutions

### Option 1: Add Real-Time Event Emission (Recommended)

**Modify `agent.py` to emit during streaming:**

```python
def _handle_stream_event(self, event):
    """Handle streaming events from Claude SDK."""
    if hasattr(event, 'type'):
        if event.type == "text" or (hasattr(event, 'delta') and hasattr(event.delta, 'text')):
            # Extract text
            text = getattr(event, 'text', '') or getattr(event.delta, 'text', '')
            if text:
                # EMIT IMMEDIATELY TO STDOUT
                self.emit_output("stream_chunk", {
                    "chunk_type": "text",
                    "data": text,
                    "phase": self.state.phase,
                    "iteration": self.state.iteration,
                    "timestamp": time.time()
                })

        elif event.type == "tool_use_start":
            self.emit_output("stream_chunk", {
                "chunk_type": "tool_start",
                "data": {
                    "name": event.name,
                    "id": event.id,
                    "input": event.input
                },
                "phase": self.state.phase,
                "iteration": self.state.iteration,
                "timestamp": time.time()
            })

        elif event.type == "tool_use_complete":
            self.emit_output("stream_chunk", {
                "chunk_type": "tool_result",
                "data": {
                    "tool_use_id": event.id,
                    "status": "success" if not event.is_error else "error"
                },
                "phase": self.state.phase,
                "iteration": self.state.iteration,
                "timestamp": time.time()
            })
```

### Option 2: Add Heartbeat/Keepalive

```python
# In agent.py
async def run_generation_phase(self):
    # Start heartbeat task
    heartbeat_task = asyncio.create_task(self._emit_heartbeat())

    try:
        # ... existing code ...
        response = await self.client.send_message(message, prompt)
    finally:
        heartbeat_task.cancel()

async def _emit_heartbeat(self):
    """Emit heartbeat every 5 seconds to show agent is alive."""
    while True:
        await asyncio.sleep(5)
        self.emit_output("heartbeat", {
            "phase": self.state.phase,
            "iteration": self.state.iteration,
            "timestamp": time.time()
        })
```

### Option 3: Fix Parallel Process Issue

**In `ExecutionDashboard.tsx`**, prevent double-start:

```typescript
const [isStarting, setIsStarting] = useState(false)

const handleStart = async () => {
    if (isStarting) {
        console.warn('[ExecutionDashboard] Already starting, ignoring duplicate request')
        return
    }

    setIsStarting(true)
    try {
        await startOrchestrator({...})
    } finally {
        setIsStarting(false)
    }
}
```

### Option 4: Add Progress Indicator for Subprocess

When Task tool is called:

```python
# Before spawning subprocess
self.emit_output("subprocess_start", {
    "subagent_type": "Explore",
    "description": "Exploring codebase structure",
    "timestamp": time.time()
})

# After subprocess completes
self.emit_output("subprocess_complete", {
    "subagent_type": "Explore",
    "duration": end_time - start_time,
    "timestamp": time.time()
})
```

---

## UI Improvements Needed

### 1. Event Log Component (Like Leon's)

```tsx
const EventLog = ({ events }: { events: OrchestratorOutput[] }) => {
    return (
        <div className="space-y-1 font-mono text-xs">
            {events.map((event, idx) => (
                <div key={idx} className={cn(
                    event.type === 'stream_chunk' && event.chunk_type === 'text' && 'text-gray-300',
                    event.type === 'stream_chunk' && event.chunk_type === 'tool_start' && 'text-blue-400',
                    event.type === 'stream_chunk' && event.chunk_type === 'tool_result' && 'text-green-400',
                    event.type === 'error' && 'text-red-400'
                )}>
                    {renderEvent(event)}
                </div>
            ))}
        </div>
    )
}
```

### 2. Current Agent Type Indicator

```tsx
<div className="flex items-center gap-2">
    <Cpu className="w-4 h-4" />
    <span>
        {currentPhase === 'generation' ? 'Initializer Agent' : 'Coding Agent'}
    </span>
    <span className="text-xs text-gray-400">
        (Iteration {currentIteration})
    </span>
</div>
```

### 3. Streaming Text Display

```tsx
const [streamingText, setStreamingText] = useState('')

useEffect(() => {
    const handleOutput = (output: OrchestratorOutput) => {
        if (output.type === 'stream_chunk' && output.chunk_type === 'text') {
            setStreamingText(prev => prev + output.data)
        }
    }
    // ...
}, [])

// Show in UI
<div className="whitespace-pre-wrap">{streamingText}</div>
```

---

## Recommendation

**Immediate Fix** (for visibility):
1. Add `_handle_stream_event` emissions in agent.py (Option 1)
2. Fix double-spawn issue in ExecutionDashboard (Option 3)
3. Add heartbeat for long-running operations (Option 2)

**Long-term Enhancement**:
1. Build event log component similar to Leon's
2. Show current agent type and iteration
3. Display streaming text in real-time
4. Add subprocess progress indicators

This will give users real-time feedback instead of the current "spinning forever with no updates" experience.

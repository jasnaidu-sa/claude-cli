# PRD: Project Assistant Performance & UX Refactor

## Problem Statement

The Project Assistant feature successfully initializes but has suboptimal user experience due to long initialization time (18-20 seconds) and lack of feedback during startup. Users see only a loading spinner with no indication of progress or estimated wait time.

## Current State

### What Works
- ✅ Initialization completes successfully using SDK's bundled Claude CLI
- ✅ Read-only tool restrictions properly enforced
- ✅ Project-specific CLAUDE_HOME prevents lock file conflicts
- ✅ Authentication via copied session-env
- ✅ Conversation persistence to SQLite
- ✅ Real-time message streaming over WebSocket

### Pain Points
- ⏱️ 18-20 second initialization with no progress indicator
- 🔄 Cold start on every UI open (subprocess not reused)
- ❓ No feedback during bundled CLI startup
- 🐢 User doesn't know if system is working or hung

## Goals

### Primary Goals
1. **Reduce perceived wait time** through better UX feedback
2. **Optimize actual initialization time** where possible
3. **Improve reliability** with better error handling

### Non-Goals
- Rewriting the Claude Agent SDK integration (keep current architecture)
- Real-time collaboration features
- Voice/audio integration

## Success Metrics

| Metric | Current | Target | Measurement |
|--------|---------|--------|-------------|
| Initialization time | 18-20s | 12-15s | Backend logs |
| Perceived wait (UX) | Poor | Good | User feedback |
| Error recovery | Manual | Automatic | Error rate |
| Session reuse rate | 0% | 50%+ | Analytics |

## Proposed Solution

### Phase 1: UX Improvements (Quick Win)

#### 1.1 Progressive Loading States
**Current**: Single "Loading..." spinner
**Proposed**: Multi-stage progress indicator

```typescript
type AssistantLoadingState =
  | { stage: 'connecting', message: 'Connecting to assistant...' }
  | { stage: 'authenticating', message: 'Authenticating with Claude API...' }
  | { stage: 'initializing', message: 'Starting conversation engine...' }
  | { stage: 'ready', message: 'Assistant ready!' };
```

**Implementation**:
- Backend emits stage updates via WebSocket
- UI displays current stage + estimated time remaining
- Progress bar shows completion (0-100%)

**Effort**: 4-6 hours
**Impact**: High (greatly improves perceived performance)

#### 1.2 Time Estimation Display
Show estimated wait time based on historical data:
```
"Setting up assistant... (usually takes ~15 seconds)"
```

**Effort**: 1-2 hours
**Impact**: Medium (sets user expectations)

### Phase 2: Performance Optimizations (Medium Term)

#### 2.1 Session Pre-warming
**Problem**: Cold start on every UI open
**Solution**: Start initialization when project is selected

```typescript
// When user selects project in dropdown
onProjectSelect(projectName) {
  // Pre-warm in background (don't block UI)
  api.assistant.prewarm(projectName);
}

// When user clicks "Project Assistant"
onAssistantOpen() {
  // Session already warm or nearly ready
  const session = api.assistant.connect(projectName);
}
```

**Benefits**:
- Reduces perceived wait from 18s → 2-5s
- Better UX (instant or near-instant)

**Effort**: 8-12 hours
**Impact**: Very High

#### 2.2 Session Reuse
**Problem**: Subprocess dies when UI closes
**Solution**: Keep subprocess alive for N minutes

```python
# Keep session alive for 5 minutes after UI closes
SESSION_IDLE_TIMEOUT = 300  # seconds

class AssistantChatSession:
    last_activity: datetime

    async def on_websocket_close(self):
        # Don't immediately kill subprocess
        self.last_activity = datetime.now()
        asyncio.create_task(self._idle_cleanup())

    async def _idle_cleanup(self):
        await asyncio.sleep(SESSION_IDLE_TIMEOUT)
        if datetime.now() - self.last_activity > SESSION_IDLE_TIMEOUT:
            await self.close()
```

**Benefits**:
- Reopen assistant = instant (subprocess already running)
- Reduces cold starts by ~50%

**Effort**: 6-8 hours
**Impact**: High

#### 2.3 Parallel MCP Initialization
**Problem**: MCP server starts sequentially with Claude CLI
**Solution**: Start MCP in parallel if possible

**Current**:
```
1. Start Claude CLI (12s)
2. Start MCP server (3s)
3. Complete handshake (3s)
Total: 18s
```

**Proposed**:
```
1. Start Claude CLI + MCP in parallel (max(12s, 3s) = 12s)
2. Complete handshake (3s)
Total: 15s (saves 3s)
```

**Effort**: 4-6 hours (need to verify SDK supports this)
**Impact**: Medium (3s improvement)

### Phase 3: Advanced Optimizations (Future)

#### 3.1 Shared Subprocess Pool
Run one Claude CLI subprocess shared across multiple projects:
- Faster project switching
- Lower memory overhead
- Requires SDK support for context isolation

**Effort**: 16-20 hours
**Impact**: Very High (but requires SDK changes)

#### 3.2 Response Caching
Cache common queries:
- "What features are pending?"
- "Show me project stats"
- "What's the current status?"

**Effort**: 8-12 hours
**Impact**: Medium (only helps repeated queries)

## Technical Implementation

### Phase 1: UX (Week 1)

#### Backend Changes
```python
# assistant_chat_session.py

async def start(self) -> AsyncGenerator[dict, None]:
    # Emit progress updates
    yield {"type": "progress", "stage": "connecting", "percent": 0}

    # Create client
    yield {"type": "progress", "stage": "authenticating", "percent": 30}

    # Initialize
    yield {"type": "progress", "stage": "initializing", "percent": 60}
    await asyncio.wait_for(self.client.__aenter__(), timeout=30.0)

    yield {"type": "progress", "stage": "ready", "percent": 100}
    yield {"type": "conversation_created", "conversation_id": self.conversation_id}
```

#### Frontend Changes
```typescript
// AutonomousView.tsx

const [loadingState, setLoadingState] = useState<AssistantLoadingState | null>(null);

useEffect(() => {
  if (message.type === 'progress') {
    setLoadingState({
      stage: message.stage,
      percent: message.percent,
      message: STAGE_MESSAGES[message.stage]
    });
  }
}, [message]);

// ProgressIndicator.tsx
const ProgressIndicator = ({ state }: { state: AssistantLoadingState }) => (
  <div className="flex flex-col items-center gap-4">
    <div className="w-full max-w-md">
      <ProgressBar value={state.percent} />
    </div>
    <p className="text-sm text-muted-foreground">
      {state.message}
    </p>
    <p className="text-xs text-muted-foreground">
      Usually takes ~15 seconds
    </p>
  </div>
);
```

### Phase 2: Performance (Week 2-3)

#### Session Pre-warming
```typescript
// ideas-store.ts
export const ideasStore = create<IdeasStore>((set, get) => ({
  // ...
  setActiveProject: async (projectName: string) => {
    set({ activeProject: projectName });

    // Pre-warm assistant in background
    api.assistant.prewarm(projectName).catch(err => {
      console.warn('Assistant pre-warm failed:', err);
    });
  }
}));
```

#### Session Reuse
```python
# assistant_chat_session.py

class AssistantChatSession:
    _idle_timeout = 300  # 5 minutes
    _cleanup_task: asyncio.Task | None = None

    async def on_disconnect(self):
        """Called when WebSocket closes"""
        self.last_activity = datetime.now()

        # Schedule cleanup
        if self._cleanup_task:
            self._cleanup_task.cancel()
        self._cleanup_task = asyncio.create_task(self._idle_cleanup())

    async def on_reconnect(self):
        """Called when WebSocket reconnects"""
        # Cancel cleanup if session still alive
        if self._cleanup_task:
            self._cleanup_task.cancel()
            self._cleanup_task = None
```

## Testing Plan

### Unit Tests
```python
async def test_progress_updates():
    session = AssistantChatSession("test", Path("/test"))
    messages = [msg async for msg in session.start()]

    # Verify progress messages
    progress_msgs = [m for m in messages if m['type'] == 'progress']
    assert len(progress_msgs) >= 3
    assert progress_msgs[0]['stage'] == 'connecting'
    assert progress_msgs[-1]['stage'] == 'ready'

async def test_session_reuse():
    session = AssistantChatSession("test", Path("/test"))
    await session.start()
    await session.on_disconnect()

    # Session should still be alive
    assert session.client is not None

    # After timeout, should be cleaned up
    await asyncio.sleep(SESSION_IDLE_TIMEOUT + 1)
    assert session.client is None
```

### Integration Tests
- Open assistant, verify 4 progress stages
- Close and reopen within 5 minutes → instant load
- Switch projects → pre-warmed session ready
- Network interruption → graceful reconnect

### Manual Testing
- [ ] Loading states show correct messages
- [ ] Progress bar animates smoothly
- [ ] Time estimate is accurate
- [ ] Reopen assistant = fast (session reuse)
- [ ] Switch projects = fast (pre-warming)

## Rollout Plan

### Week 1: UX Improvements
- Day 1-2: Backend progress updates
- Day 3-4: Frontend progress UI
- Day 5: Testing + bug fixes

### Week 2: Session Pre-warming
- Day 1-2: Implement pre-warm API
- Day 3-4: Frontend integration
- Day 5: Testing + monitoring

### Week 3: Session Reuse
- Day 1-2: Idle timeout mechanism
- Day 3: Reconnection logic
- Day 4-5: Testing + edge cases

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Session reuse breaks isolation | High | Thorough testing, fallback to cold start |
| Pre-warming wastes resources | Medium | Only pre-warm on explicit project selection |
| Progress estimates inaccurate | Low | Update based on telemetry |
| SDK doesn't support parallel init | Medium | Verify early, skip if not supported |

## Monitoring & Metrics

Track in analytics:
```typescript
analytics.track('assistant_initialized', {
  duration_ms: elapsed,
  was_prewarmed: boolean,
  session_reused: boolean,
  cold_start: boolean
});
```

Dashboard metrics:
- P50/P95 initialization time
- Session reuse rate
- Pre-warm success rate
- Error rate by stage

## Future Considerations

### Voice Integration
If adding voice input/output:
- Stream audio to assistant
- TTS for responses
- Wake word detection

### Collaboration
Multiple users chatting with same project assistant:
- Shared conversation history
- User attribution for messages
- Concurrent query handling

### Context Awareness
Assistant knows what user is viewing:
- Current file
- Selected code
- Active feature

## Success Criteria

**Phase 1 (UX)**:
- ✅ All 4 loading stages visible
- ✅ Time estimate shown
- ✅ Users report improved experience

**Phase 2 (Performance)**:
- ✅ 50%+ session reuse rate
- ✅ Pre-warming reduces wait by 70%
- ✅ P95 initialization < 15s

**Phase 3 (Advanced)**:
- ✅ Shared subprocess working
- ✅ Memory usage reduced 40%
- ✅ Cache hit rate >30%

## Resources Required

- **Backend Engineer**: 2-3 weeks
- **Frontend Engineer**: 1-2 weeks
- **QA Testing**: 1 week
- **Total**: 4-6 weeks

## Open Questions

1. Does Claude Agent SDK support parallel MCP initialization?
2. What's the safe idle timeout for session reuse?
3. Should we pre-warm on app startup or project selection?
4. Do we need feature flag for gradual rollout?

## Appendix: Current Timing Breakdown

Based on terminal logs:

```
Line 100: "Waiting for Claude CLI subprocess to initialize"
Line 101: "Using bundled Claude Code CLI: ..."
Lines 102-109: Status checks (2s intervals)
Line 110: "Claude client successfully initialized!"

Estimated breakdown:
- Bundled CLI startup: 10-12s
- API authentication: 2-3s
- MCP server init: 2-3s
- JSON handshake: 1-2s
Total: 18-20s
```

## Related Documents

- `.schema/assistant-chat-integration.md` - Architecture
- `.claude-context/solutions/windows-claude-sdk-subprocess-timeout.md` - Current fix
- `.schema/patterns/windows-subprocess-stdio.md` - Technical background

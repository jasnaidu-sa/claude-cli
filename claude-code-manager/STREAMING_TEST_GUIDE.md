# BVS Worker Streaming - Test Guide

## Current Status
✅ Dev server restarted with new SDK-based worker service
✅ Build successful (850.68 kB main bundle)
✅ API server running on port 3847
✅ App running at http://localhost:6104/

## What Changed

### Before (CLI Subprocess - Buffered)
- Output only appeared after task completion
- Detail modal showed "Waiting for worker output..." until done
- Then all output appeared at once

### After (Agent SDK - Real-time Streaming)
- Output streams character-by-character as Claude thinks
- Detail modal shows live progress immediately
- Matches BVS planning chat UX

## Test Steps

### 1. Navigate to BVS Dashboard
1. Open the Claude Code Manager app
2. Click on "BVS" in the sidebar
3. You should see the paused session: `erp-budgeting-module-20260121-143052`

### 2. Open Section Detail
1. Click on section **S1: Database Schema - Budget Core Models**
2. The detail panel should open on the right
3. Click the "Ralph Loop" tab

### 3. Expected Current State
- Status: **failed** or **paused**
- Error message should now be visible in Error tab: "Worker did not call mark_complete tool"
- Files have wrong paths (Prisma instead of Supabase) - **FIXED in plan.json**

### 4. Retry Section to Test Streaming
**Option A - Retry Button (if available)**:
- Click [Retry] button in the detail panel
- Immediately switch to "Ralph Loop" tab
- You should see output streaming in real-time

**Option B - Resume Session (if paused)**:
- If there's a checkpoint approval modal, approve it
- Watch the streaming output appear

**Option C - Start New Section**:
- If S1 is stuck, try executing S2 or S3
- Any new section will use the SDK service

### 5. What to Look For

#### ✅ Success Indicators:
1. **Immediate Output**: Text appears within seconds of starting, not minutes
2. **Progressive Display**: You see Claude's thinking process unfold line by line
3. **Live Scrolling**: The output auto-scrolls as new text arrives
4. **Tool Calls Visible**: You see tool calls (read_file, write_file, etc.) as they happen
5. **Progress Updates**: Progress bar and current step update in real-time

#### ❌ Failure Indicators:
1. "Waiting for worker output..." persists for >10 seconds
2. Output only appears after section completes
3. Console errors about missing SDK or import failures

### 6. Console Logging

Check the terminal/console for these log messages:

**SDK Initialization**:
```
[BvsWorkerSDK] Agent SDK loaded
```

**Session Start**:
```
[BvsWorker:W1] Starting section: Database Schema - Budget Core Models
[BvsWorker:W1] Model: sonnet, Max turns: 15
[BvsWorker:W1] Session ID: <uuid>
[BvsWorker:W1] Streaming output...
```

**Real-time Output**:
```
[BvsWorker:W1] Output: Let me start by...
[BvsWorker:W1] Tool used: read_file (turn 1/15)
[BvsWorker:W1] Output: I'll create the...
```

**Completion**:
```
[BvsWorker:W1] mark_complete called
[BVS Validation] ✓ File exists: supabase/migrations/20260121000001_budgets_core.sql
[BvsWorker:W1] Query completed
[BvsWorker:W1] Completed with status: completed
```

## Known Issues Fixed

### Issue #1: Prisma vs Supabase Paths ✅ FIXED
- **Before**: plan.json referenced `prisma/migrations/` and `prisma/schema.prisma`
- **After**: Fixed to `supabase/migrations/20260121000001_budgets_core.sql`
- **Location**: `C:\Claude_Projects\ERP\.bvs\projects\erp-budgeting-module-20260121-143052\plan.json`

### Issue #2: Error Display Not Showing ✅ FIXED
- **Before**: `section.lastError` set but UI expects `section.errorMessage`
- **After**: Both fields now set in `bvs-orchestrator-service.ts:1117`
- **Result**: Errors now visible in Error tab

### Issue #3: No Real-time Streaming ✅ FIXED
- **Before**: CLI subprocess with buffered stdout
- **After**: Agent SDK with `for await` streaming
- **Files**: New `bvs-worker-sdk-service.ts`, updated `bvs-orchestrator-service.ts`

## Troubleshooting

### If Streaming Still Not Working

**Check 1: Verify SDK service is loaded**
```bash
# In console, look for this line:
grep "BvsWorkerSDK" <output-file>
```

**Check 2: Verify import succeeded**
```bash
# Check for import errors in build output
cat C:\Users\JNaidu\AppData\Local\Temp\claude\C--claude-projects-claude-cli\tasks\b094683.output | grep -i "error"
```

**Check 3: Hard reload**
- Close the Electron app completely
- Stop the dev server (Ctrl+C)
- Clear build cache: `rm -rf dist/`
- Restart: `npm run dev`

**Check 4: Verify Agent SDK package**
```bash
cd C:\claude_projects\claude-cli\claude-code-manager
npm ls @anthropic-ai/claude-agent-sdk
```

### If Worker Fails Again

**Check Validation Errors**:
1. Open Error tab in detail panel
2. Error should now be visible (Fix #2 completed)
3. Common errors:
   - "Worker did not call mark_complete tool" → Prompt clarity issue
   - "Missing required file: X" → File path incorrect
   - "RLS enabled but no policies defined" → SQL validation

**Check File Paths**:
1. Verify plan.json was updated (Fix #1 completed)
2. Section S1 should have: `supabase/migrations/20260121000001_budgets_core.sql`
3. Section S2 should have: `supabase/migrations/20260121000002_budget_templates_variance.sql`

## Next Steps After Streaming Test

Once streaming is confirmed working:

### Task #2: Checkpoint Approval Modal
- Create UI modal for paused sessions
- Add action buttons: [Approve & Continue] [Skip] [Retry] [Stop]
- Display pause reason and validation errors
- Allow section editing before retry

### Additional Improvements
- Add session resumption support
- Implement cost tracking per section
- Add manual intervention mode for stuck sections
- Create checkpoint preview feature

## Files Modified in This Fix

1. **Created**: `src/main/services/bvs-worker-sdk-service.ts` (565 lines)
   - Agent SDK implementation
   - Real-time streaming via AsyncGenerator
   - Custom tool handlers

2. **Modified**: `src/main/services/bvs-orchestrator-service.ts`
   - Line 51-57: Import changed from CLI to SDK service
   - Line 984: Service instantiation updated

3. **Created**: `STREAMING_FIX_ANALYSIS.md`
   - Problem analysis
   - Solution architecture
   - Implementation guide

4. **Fixed**: `C:\Claude_Projects\ERP\.bvs\projects\erp-budgeting-module-20260121-143052\plan.json`
   - Lines 24-27: S1 paths fixed (Prisma → Supabase)
   - Lines 45-48: S2 paths fixed (Prisma → Supabase)

5. **Modified**: `src/main/services/bvs-orchestrator-service.ts`
   - Line 1117: Added `section.errorMessage = error` for UI display

## Success Criteria

The streaming fix is successful if:
- ✅ Output appears within 5 seconds of starting execution
- ✅ Text streams progressively (not all at once)
- ✅ Ralph Loop tab shows live output
- ✅ Console logs show real-time tool calls
- ✅ User can watch Claude's thinking process
- ✅ Experience matches BVS planning chat

---

**Test Date**: 2026-01-26
**Dev Server**: Running on port 6104
**API Server**: Running on port 3847
**Build Status**: ✅ Successful (850.68 kB)

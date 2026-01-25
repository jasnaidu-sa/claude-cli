# AI-Assisted Merge Conflict Resolution Flow

## Overview
Automated merge conflict resolution using Claude AI for BVS parallel worker merges.

## Implementation Status
Implemented in `src/main/services/bvs-merge-point-service.ts`

## Flow Steps

1. **Detect Conflicts** - Git merge attempt fails with conflicts
2. **Parse Conflict Markers** - Extract conflicting sections from files
3. **AI Analysis** - Send context to Claude for resolution
4. **Apply Resolution** - Write resolved content back to files
5. **Verify** - Run quality gates on merged result

## Key Files
- `src/main/services/bvs-merge-point-service.ts` - Main merge orchestration
- `src/shared/bvs-types.ts` - BvsMergeEvent type

## Updated
2026-01-25

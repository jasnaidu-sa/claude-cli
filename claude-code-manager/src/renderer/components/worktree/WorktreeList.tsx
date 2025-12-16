import React from 'react'
import { WorktreeItem } from './WorktreeItem'
import type { Worktree } from '@shared/types/git'

interface WorktreeListProps {
  worktrees: Worktree[]
}

export function WorktreeList({ worktrees }: WorktreeListProps) {
  return (
    <div className="pl-4">
      {worktrees.map(worktree => (
        <WorktreeItem key={worktree.id} worktree={worktree} />
      ))}
    </div>
  )
}

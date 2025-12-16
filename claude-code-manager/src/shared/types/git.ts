// Git Worktree Types

export interface Worktree {
  id: string
  path: string
  branch: string
  parentRepo: string
  parentBranch: string        // branch this was created from (merge target)
  createdAt: number
  lastAccessedAt: number
  isMain: boolean             // true if this is the primary repo, not a worktree
}

export interface WorktreeStatus {
  worktreeId: string
  isDirty: boolean
  hasConflicts: boolean
  ahead: number
  behind: number
  staged: number
  unstaged: number
  untracked: number
}

export interface MergePreview {
  sourceBranch: string
  targetBranch: string
  filesChanged: number
  additions: number
  deletions: number
  files: Array<{
    path: string
    additions: number
    deletions: number
    status: 'added' | 'modified' | 'deleted' | 'renamed'
  }>
  canFastForward: boolean
  hasConflicts: boolean
  conflictFiles?: string[]
}

export type MergeStrategy = 'merge' | 'squash' | 'rebase'

export interface MergeResult {
  success: boolean
  conflicts?: string[]
  commitHash?: string
  error?: string
}

export interface RemoteStatus {
  hasRemote: boolean
  remoteName: string
  canPush: boolean
  canPull: boolean
  ahead: number
  behind: number
}

export interface Branch {
  name: string
  isRemote: boolean
  isCurrent: boolean
  lastCommit?: string
  lastCommitDate?: number
}

export interface CreateWorktreeOptions {
  repoPath: string
  branchName: string
  baseBranch?: string
  createBranch?: boolean  // true to create new branch, false to use existing
}

export interface WorktreeStore {
  worktrees: Record<string, Worktree>
  statusByWorktree: Record<string, WorktreeStatus>
  staleWorktrees: Worktree[]
  isLoading: boolean
  error: string | null
}

// IPC Channel types
export interface GitIpcChannels {
  'git:list-worktrees': (repoPath: string) => Promise<Worktree[]>
  'git:create-worktree': (options: CreateWorktreeOptions) => Promise<Worktree>
  'git:remove-worktree': (worktreePath: string, force?: boolean) => Promise<void>
  'git:get-status': (worktreePath: string) => Promise<WorktreeStatus>
  'git:list-branches': (repoPath: string) => Promise<Branch[]>
  'git:merge-preview': (worktreePath: string) => Promise<MergePreview>
  'git:merge': (worktreePath: string, strategy: MergeStrategy) => Promise<MergeResult>
  'git:abort-merge': (repoPath: string) => Promise<void>
  'git:pull': (worktreePath: string) => Promise<{ success: boolean; error?: string }>
  'git:push': (worktreePath: string, setUpstream?: boolean) => Promise<{ success: boolean; error?: string }>
  'git:fetch': (repoPath: string) => Promise<void>
  'git:get-remote-status': (worktreePath: string) => Promise<RemoteStatus>
  'git:get-stale-worktrees': (repoPath: string, daysThreshold?: number) => Promise<Worktree[]>
}

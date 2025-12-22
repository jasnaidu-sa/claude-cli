import React, { useEffect, useState } from 'react'
import { Clock, CheckCircle, TestTube, XCircle } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { useWorktreeStore } from '@renderer/stores/worktree-store'
import type { WorktreeLifecycle } from '@shared/types/git'

interface LifecycleStatusBadgeProps {
  worktreePath: string
  className?: string
  showLabel?: boolean
}

export function LifecycleStatusBadge({
  worktreePath,
  className,
  showLabel = true
}: LifecycleStatusBadgeProps) {
  const { getLifecycle } = useWorktreeStore()
  const [lifecycle, setLifecycle] = useState<WorktreeLifecycle | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    loadLifecycle()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worktreePath])

  const loadLifecycle = async () => {
    setIsLoading(true)
    try {
      const data = await getLifecycle(worktreePath)
      setLifecycle(data)
    } finally {
      setIsLoading(false)
    }
  }

  if (isLoading || !lifecycle) {
    return null
  }

  const getStatusConfig = (status: WorktreeLifecycle['status']) => {
    switch (status) {
      case 'active':
        return {
          icon: Clock,
          label: 'Active',
          className: 'bg-blue-500/10 text-blue-600 border-blue-500/20'
        }
      case 'testing':
        return {
          icon: TestTube,
          label: 'Testing',
          className: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20'
        }
      case 'merged':
        return {
          icon: CheckCircle,
          label: 'Merged',
          className: 'bg-green-500/10 text-green-600 border-green-500/20'
        }
      case 'discarded':
        return {
          icon: XCircle,
          label: 'Discarded',
          className: 'bg-gray-500/10 text-gray-600 border-gray-500/20'
        }
    }
  }

  const config = getStatusConfig(lifecycle.status)
  const Icon = config.icon

  // Calculate age
  const ageInDays = Math.floor((Date.now() - lifecycle.createdAt) / (1000 * 60 * 60 * 24))
  const ageText = ageInDays === 0 ? 'Today' : ageInDays === 1 ? '1 day' : `${ageInDays} days`

  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs font-medium',
        config.className,
        className
      )}
      title={`Status: ${config.label}\nAge: ${ageText}\nAuto-cleanup: ${lifecycle.autoCleanupAfterMerge ? 'After merge' : `After ${lifecycle.autoCleanupAfterDays} days`}`}
    >
      <Icon className="h-3 w-3" />
      {showLabel && (
        <>
          <span>{config.label}</span>
          <span className="text-muted-foreground">·</span>
          <span className="text-muted-foreground">{ageText}</span>
        </>
      )}
    </div>
  )
}

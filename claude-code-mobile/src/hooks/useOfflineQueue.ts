import { useCallback, useEffect } from 'react'
import { useConnectionStore } from '../stores/connection-store'

/**
 * Hook for managing offline actions with automatic queue processing
 *
 * Usage:
 * ```tsx
 * const { queueAction, processQueue, clearQueue, queueLength } = useOfflineQueue()
 *
 * // Queue an action when offline
 * queueAction('checkpoint:approve', { sessionId, checkpointId, comment })
 *
 * // Actions are automatically processed when connection is restored
 * ```
 */
export function useOfflineQueue() {
  const {
    isConnected,
    offlineQueue,
    queueAction: storeQueueAction,
    removeFromQueue,
    processQueue,
    clearQueue,
  } = useConnectionStore()

  // Auto-process queue when connection is restored
  useEffect(() => {
    if (isConnected && offlineQueue.length > 0) {
      processQueue()
    }
  }, [isConnected, offlineQueue.length, processQueue])

  /**
   * Queue an action to be processed when online
   */
  const queueAction = useCallback((
    type: string,
    payload: Record<string, unknown>
  ): string => {
    return storeQueueAction(type, payload)
  }, [storeQueueAction])

  /**
   * Execute an action immediately if online, otherwise queue it
   */
  const executeOrQueue = useCallback(async <T>(
    type: string,
    payload: Record<string, unknown>,
    executor: () => Promise<T>
  ): Promise<{ queued: boolean; result?: T; queueId?: string }> => {
    if (isConnected) {
      try {
        const result = await executor()
        return { queued: false, result }
      } catch (error) {
        // If execution fails, queue for retry
        const queueId = storeQueueAction(type, payload)
        return { queued: true, queueId }
      }
    } else {
      const queueId = storeQueueAction(type, payload)
      return { queued: true, queueId }
    }
  }, [isConnected, storeQueueAction])

  return {
    isConnected,
    queueLength: offlineQueue.length,
    queue: offlineQueue,
    queueAction,
    executeOrQueue,
    removeFromQueue,
    processQueue,
    clearQueue,
  }
}

/**
 * Predefined action types for the offline queue
 */
export const QueueActionTypes = {
  // Checkpoint actions
  CHECKPOINT_APPROVE: 'checkpoint:approve',
  CHECKPOINT_SKIP: 'checkpoint:skip',
  CHECKPOINT_REJECT: 'checkpoint:reject',

  // Session actions
  SESSION_PAUSE: 'session:pause',
  SESSION_RESUME: 'session:resume',
  SESSION_STOP: 'session:stop',

  // Idea actions
  IDEA_MOVE: 'idea:move',
  IDEA_ADD_DISCUSSION: 'idea:discussion',
} as const

export type QueueActionType = typeof QueueActionTypes[keyof typeof QueueActionTypes]

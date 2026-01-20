/**
 * Agent Status Tracker Service
 * Real-time tracking and WebSocket events for parallel agent execution
 */

import { EventEmitter } from 'events'
import type {
  AgentStatus,
  AgentState,
  AgentMetrics,
  RalphSessionStatus,
  GroupStatus,
} from '../../shared/ralph-types'

// Constants
const MAX_AGENTS = 50
const MAX_HISTORY_SIZE = 1000
const STATUS_RETENTION_MS = 24 * 60 * 60 * 1000 // 24 hours

/**
 * Agent status change event
 */
export interface AgentStatusChange {
  agentId: string
  taskId: string
  previousState: AgentState
  currentState: AgentState
  timestamp: number
}

/**
 * Session progress event
 */
export interface SessionProgressEvent {
  sessionId: string
  progress: number
  completedTasks: number
  totalTasks: number
  activeAgents: number
  currentGroup: number
  totalGroups: number
}

/**
 * Agent metrics update event
 */
export interface AgentMetricsUpdate {
  agentId: string
  taskId: string
  metrics: AgentMetrics
  timestamp: number
}

/**
 * Status history entry
 */
interface StatusHistoryEntry {
  agentId: string
  taskId: string
  state: AgentState
  timestamp: number
  duration?: number
}

/**
 * Agent Status Tracker
 * Tracks agent status changes and emits real-time events
 */
export class AgentStatusTracker extends EventEmitter {
  private agentStatuses: Map<string, AgentStatus> = new Map()
  private sessionStatuses: Map<string, RalphSessionStatus> = new Map()
  private statusHistory: StatusHistoryEntry[] = []
  private lastCleanup: number = Date.now()

  constructor() {
    super()
  }

  /**
   * Register a new agent
   */
  registerAgent(status: AgentStatus): void {
    // Enforce agent limit
    if (this.agentStatuses.size >= MAX_AGENTS) {
      throw new Error(`Maximum agent limit reached: ${MAX_AGENTS}`)
    }

    // Validate agent ID
    if (!this.isValidAgentId(status.agentId)) {
      throw new Error(`Invalid agent ID: ${status.agentId}`)
    }

    this.agentStatuses.set(status.agentId, { ...status })
    this.emit('agent_registered', { agentId: status.agentId, status })
  }

  /**
   * Update agent status
   */
  updateAgentStatus(agentId: string, updates: Partial<AgentStatus>): void {
    const existing = this.agentStatuses.get(agentId)
    if (!existing) {
      return // Silently ignore updates for unknown agents
    }

    const previousState = existing.state
    const updatedStatus: AgentStatus = {
      ...existing,
      ...updates,
    }

    this.agentStatuses.set(agentId, updatedStatus)

    // Record state change in history
    if (updates.state && updates.state !== previousState) {
      this.recordStateChange(agentId, existing.taskId, previousState, updates.state)

      const change: AgentStatusChange = {
        agentId,
        taskId: existing.taskId,
        previousState,
        currentState: updates.state,
        timestamp: Date.now(),
      }
      this.emit('agent_state_changed', change)
    }

    this.emit('agent_status_updated', { agentId, status: updatedStatus })
  }

  /**
   * Update agent metrics
   */
  updateAgentMetrics(agentId: string, metrics: Partial<AgentMetrics>): void {
    const existing = this.agentStatuses.get(agentId)
    if (!existing) {
      return
    }

    const updatedMetrics: AgentMetrics = {
      ...existing.metrics,
      ...metrics,
    }

    this.agentStatuses.set(agentId, {
      ...existing,
      metrics: updatedMetrics,
    })

    const update: AgentMetricsUpdate = {
      agentId,
      taskId: existing.taskId,
      metrics: updatedMetrics,
      timestamp: Date.now(),
    }
    this.emit('agent_metrics_updated', update)
  }

  /**
   * Unregister an agent
   */
  unregisterAgent(agentId: string): void {
    const status = this.agentStatuses.get(agentId)
    if (status) {
      this.agentStatuses.delete(agentId)
      this.emit('agent_unregistered', { agentId, finalStatus: status })
    }
  }

  /**
   * Get agent status
   */
  getAgentStatus(agentId: string): AgentStatus | undefined {
    const status = this.agentStatuses.get(agentId)
    return status ? { ...status } : undefined
  }

  /**
   * Get all agent statuses
   */
  getAllAgentStatuses(): AgentStatus[] {
    return Array.from(this.agentStatuses.values()).map((s) => ({ ...s }))
  }

  /**
   * Get agents for a session
   */
  getSessionAgents(sessionId: string): AgentStatus[] {
    return Array.from(this.agentStatuses.values())
      .filter((s) => s.agentId.includes(sessionId))
      .map((s) => ({ ...s }))
  }

  /**
   * Update session status
   */
  updateSessionStatus(status: RalphSessionStatus): void {
    // Validate session ID
    if (!this.isValidSessionId(status.sessionId)) {
      throw new Error(`Invalid session ID: ${status.sessionId}`)
    }

    this.sessionStatuses.set(status.sessionId, { ...status })

    const progressEvent: SessionProgressEvent = {
      sessionId: status.sessionId,
      progress: status.progress,
      completedTasks: this.countCompletedTasks(status),
      totalTasks: this.countTotalTasks(status),
      activeAgents: status.agents.length,
      currentGroup: status.currentGroup,
      totalGroups: status.totalGroups,
    }

    this.emit('session_progress', progressEvent)
  }

  /**
   * Get session status
   */
  getSessionStatus(sessionId: string): RalphSessionStatus | undefined {
    const status = this.sessionStatuses.get(sessionId)
    return status ? { ...status } : undefined
  }

  /**
   * Get all session statuses
   */
  getAllSessionStatuses(): RalphSessionStatus[] {
    return Array.from(this.sessionStatuses.values()).map((s) => ({ ...s }))
  }

  /**
   * Remove session
   */
  removeSession(sessionId: string): void {
    this.sessionStatuses.delete(sessionId)

    // Also remove all agents for this session
    for (const [agentId, status] of this.agentStatuses) {
      if (agentId.includes(sessionId)) {
        this.agentStatuses.delete(agentId)
      }
    }

    this.emit('session_removed', { sessionId })
  }

  /**
   * Get status history for an agent
   */
  getAgentHistory(agentId: string): StatusHistoryEntry[] {
    return this.statusHistory
      .filter((h) => h.agentId === agentId)
      .map((h) => ({ ...h }))
  }

  /**
   * Get status history for a task
   */
  getTaskHistory(taskId: string): StatusHistoryEntry[] {
    return this.statusHistory
      .filter((h) => h.taskId === taskId)
      .map((h) => ({ ...h }))
  }

  /**
   * Get aggregate metrics for a session
   */
  getSessionMetrics(sessionId: string): {
    totalTokens: number
    totalCost: number
    totalFilesModified: number
    totalTestsRun: number
    totalTestsPassed: number
  } {
    const agents = this.getSessionAgents(sessionId)

    return agents.reduce(
      (acc, agent) => ({
        totalTokens: acc.totalTokens + (agent.metrics.tokensUsed || 0),
        totalCost: acc.totalCost + (agent.metrics.estimatedCost || 0),
        totalFilesModified: acc.totalFilesModified + (agent.metrics.filesModified?.length || 0),
        totalTestsRun: acc.totalTestsRun + (agent.metrics.testsRun || 0),
        totalTestsPassed: acc.totalTestsPassed + (agent.metrics.testsPassed || 0),
      }),
      {
        totalTokens: 0,
        totalCost: 0,
        totalFilesModified: 0,
        totalTestsRun: 0,
        totalTestsPassed: 0,
      }
    )
  }

  /**
   * Get group progress
   */
  getGroupProgress(sessionId: string, groupNumber: number): GroupStatus | undefined {
    const session = this.sessionStatuses.get(sessionId)
    if (!session) return undefined

    return session.groups.find((g) => g.groupNumber === groupNumber)
  }

  /**
   * Cleanup old data
   */
  cleanup(): void {
    const now = Date.now()
    const cutoff = now - STATUS_RETENTION_MS

    // Remove old history entries
    this.statusHistory = this.statusHistory.filter((h) => h.timestamp > cutoff)

    // Trim history if too large
    if (this.statusHistory.length > MAX_HISTORY_SIZE) {
      this.statusHistory = this.statusHistory.slice(-MAX_HISTORY_SIZE)
    }

    this.lastCleanup = now
  }

  /**
   * Record state change in history
   */
  private recordStateChange(
    agentId: string,
    taskId: string,
    previousState: AgentState,
    currentState: AgentState
  ): void {
    // Calculate duration of previous state
    const previousEntry = this.statusHistory
      .filter((h) => h.agentId === agentId)
      .pop()

    if (previousEntry && !previousEntry.duration) {
      previousEntry.duration = Date.now() - previousEntry.timestamp
    }

    // Add new entry
    this.statusHistory.push({
      agentId,
      taskId,
      state: currentState,
      timestamp: Date.now(),
    })

    // Run cleanup periodically
    if (Date.now() - this.lastCleanup > 60000) {
      this.cleanup()
    }
  }

  /**
   * Validate agent ID format
   */
  private isValidAgentId(agentId: string): boolean {
    return (
      typeof agentId === 'string' &&
      agentId.length > 0 &&
      agentId.length <= 200 &&
      /^[a-zA-Z0-9_-]+$/.test(agentId)
    )
  }

  /**
   * Validate session ID format
   */
  private isValidSessionId(sessionId: string): boolean {
    return (
      typeof sessionId === 'string' &&
      sessionId.length > 0 &&
      sessionId.length <= 100 &&
      /^[a-zA-Z0-9_-]+$/.test(sessionId)
    )
  }

  /**
   * Count completed tasks in session
   */
  private countCompletedTasks(status: RalphSessionStatus): number {
    return status.groups.reduce((sum, g) => sum + g.completedCount, 0)
  }

  /**
   * Count total tasks in session
   */
  private countTotalTasks(status: RalphSessionStatus): number {
    return status.groups.reduce((sum, g) => sum + g.taskIds.length, 0)
  }

  /**
   * Clear all data (for testing)
   */
  clear(): void {
    this.agentStatuses.clear()
    this.sessionStatuses.clear()
    this.statusHistory = []
    this.removeAllListeners()
  }
}

// Export singleton instance
export const agentStatusTracker = new AgentStatusTracker()

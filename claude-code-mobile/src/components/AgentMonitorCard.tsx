import React from 'react'
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native'
import type { AgentStatus, AgentState } from '../types'

interface AgentMonitorCardProps {
  agent: AgentStatus
  onPress?: () => void
}

/**
 * Get color for agent state
 */
function getStateColor(state: AgentState): string {
  switch (state) {
    case 'completed':
      return '#22c55e' // green
    case 'failed':
    case 'stopped':
      return '#ef4444' // red
    case 'working':
    case 'testing':
      return '#3b82f6' // blue
    case 'initializing':
    case 'cloning':
      return '#f59e0b' // amber
    case 'committing':
    case 'pushing':
      return '#8b5cf6' // purple
    default:
      return '#666'
  }
}

/**
 * Get icon for agent state
 */
function getStateIcon(state: AgentState): string {
  switch (state) {
    case 'completed':
      return '✓'
    case 'failed':
    case 'stopped':
      return '✗'
    case 'working':
      return '⚙'
    case 'testing':
      return '🧪'
    case 'initializing':
    case 'cloning':
      return '⏳'
    case 'committing':
      return '📝'
    case 'pushing':
      return '↑'
    default:
      return '○'
  }
}

/**
 * Format elapsed time
 */
function formatElapsedTime(startedAt: number, completedAt?: number): string {
  const endTime = completedAt || Date.now()
  const elapsed = Math.floor((endTime - startedAt) / 1000)

  if (elapsed < 60) {
    return `${elapsed}s`
  } else if (elapsed < 3600) {
    const mins = Math.floor(elapsed / 60)
    const secs = elapsed % 60
    return `${mins}m ${secs}s`
  } else {
    const hours = Math.floor(elapsed / 3600)
    const mins = Math.floor((elapsed % 3600) / 60)
    return `${hours}h ${mins}m`
  }
}

export function AgentMonitorCard({ agent, onPress }: AgentMonitorCardProps) {
  const stateColor = getStateColor(agent.state)
  const stateIcon = getStateIcon(agent.state)
  const elapsedTime = formatElapsedTime(agent.startedAt, agent.completedAt)

  const progressPercent = agent.progress
    ? Math.round((agent.progress.stepsCompleted / agent.progress.totalSteps) * 100)
    : 0

  return (
    <TouchableOpacity
      style={styles.container}
      onPress={onPress}
      activeOpacity={onPress ? 0.7 : 1}
    >
      {/* Header Row */}
      <View style={styles.header}>
        <View style={[styles.stateIndicator, { backgroundColor: stateColor }]}>
          <Text style={styles.stateIcon}>{stateIcon}</Text>
        </View>
        <View style={styles.headerText}>
          <Text style={styles.taskId} numberOfLines={1}>
            {agent.taskId}
          </Text>
          <Text style={styles.branchName} numberOfLines={1}>
            {agent.branchName}
          </Text>
        </View>
        <View style={styles.timeContainer}>
          <Text style={styles.elapsedTime}>{elapsedTime}</Text>
        </View>
      </View>

      {/* Progress Bar (if in progress) */}
      {agent.progress && agent.state !== 'completed' && agent.state !== 'failed' && (
        <View style={styles.progressSection}>
          <View style={styles.progressBar}>
            <View
              style={[
                styles.progressFill,
                { width: `${progressPercent}%`, backgroundColor: stateColor },
              ]}
            />
          </View>
          <Text style={styles.progressText}>
            {agent.progress.currentStep} ({progressPercent}%)
          </Text>
        </View>
      )}

      {/* Metrics (if available) */}
      {agent.metrics && (agent.state === 'completed' || agent.state === 'failed') && (
        <View style={styles.metricsRow}>
          <View style={styles.metric}>
            <Text style={styles.metricValue}>+{agent.metrics.linesAdded}</Text>
            <Text style={styles.metricLabel}>added</Text>
          </View>
          <View style={styles.metric}>
            <Text style={[styles.metricValue, { color: '#ef4444' }]}>
              -{agent.metrics.linesRemoved}
            </Text>
            <Text style={styles.metricLabel}>removed</Text>
          </View>
          <View style={styles.metric}>
            <Text style={styles.metricValue}>{agent.metrics.filesChanged}</Text>
            <Text style={styles.metricLabel}>files</Text>
          </View>
          {agent.metrics.testsRun > 0 && (
            <View style={styles.metric}>
              <Text
                style={[
                  styles.metricValue,
                  {
                    color:
                      agent.metrics.testsPassed === agent.metrics.testsRun
                        ? '#22c55e'
                        : '#f59e0b',
                  },
                ]}
              >
                {agent.metrics.testsPassed}/{agent.metrics.testsRun}
              </Text>
              <Text style={styles.metricLabel}>tests</Text>
            </View>
          )}
        </View>
      )}

      {/* Error Message (if failed) */}
      {agent.error && (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText} numberOfLines={2}>
            {agent.error}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stateIndicator: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  stateIcon: {
    fontSize: 14,
    color: '#fff',
  },
  headerText: {
    flex: 1,
  },
  taskId: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  branchName: {
    color: '#666',
    fontSize: 12,
    marginTop: 2,
  },
  timeContainer: {
    alignItems: 'flex-end',
  },
  elapsedTime: {
    color: '#888',
    fontSize: 12,
    fontFamily: 'monospace',
  },
  progressSection: {
    marginTop: 12,
  },
  progressBar: {
    height: 6,
    backgroundColor: '#333',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  progressText: {
    color: '#888',
    fontSize: 11,
    marginTop: 4,
  },
  metricsRow: {
    flexDirection: 'row',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#333',
  },
  metric: {
    flex: 1,
    alignItems: 'center',
  },
  metricValue: {
    color: '#22c55e',
    fontSize: 14,
    fontWeight: '600',
    fontFamily: 'monospace',
  },
  metricLabel: {
    color: '#666',
    fontSize: 10,
    marginTop: 2,
  },
  errorContainer: {
    marginTop: 12,
    padding: 8,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  errorText: {
    color: '#ef4444',
    fontSize: 12,
  },
})

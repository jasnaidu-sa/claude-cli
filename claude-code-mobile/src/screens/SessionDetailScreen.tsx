import React, { useEffect, useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  RefreshControl,
} from 'react-native'
import { useRalphStore } from '../stores/ralph-store'
import { apiClient } from '../api/client'
import { AgentMonitorCard } from '../components/AgentMonitorCard'
import { MergeConflictCard } from '../components/MergeConflictCard'
import type {
  RalphCheckpoint,
  RalphFeature,
  AgentStatus,
  MergeConflict,
  ParallelSessionStatus,
  ConflictResolutionStrategy,
} from '../types'

interface SessionDetailScreenProps {
  sessionId: string
  onBack: () => void
}

export function SessionDetailScreen({ sessionId, onBack }: SessionDetailScreenProps) {
  const {
    sessions,
    pendingCheckpoints,
    selectSession,
    activeSession,
    pauseSession,
    resumeSession,
    stopSession,
    approveCheckpoint,
    skipCheckpoint,
    rejectCheckpoint,
    loadSessions,
  } = useRalphStore()

  const [refreshing, setRefreshing] = useState(false)
  const [checkpointComment, setCheckpointComment] = useState('')
  const [activeTab, setActiveTab] = useState<'overview' | 'agents' | 'conflicts'>('overview')
  const [agents, setAgents] = useState<AgentStatus[]>([])
  const [conflicts, setConflicts] = useState<MergeConflict[]>([])
  const [parallelStatus, setParallelStatus] = useState<ParallelSessionStatus | null>(null)

  useEffect(() => {
    selectSession(sessionId)
    loadAgentsAndConflicts()
  }, [sessionId])

  // Subscribe to real-time agent and conflict updates
  useEffect(() => {
    const unsubAgentState = apiClient.agents.onAgentStateChange((data) => {
      if (data.sessionId === sessionId) {
        setAgents((prev) => {
          const existing = prev.findIndex((a) => a.agentId === data.agent.agentId)
          if (existing >= 0) {
            const updated = [...prev]
            updated[existing] = data.agent
            return updated
          }
          return [...prev, data.agent]
        })
      }
    })

    const unsubAgentComplete = apiClient.agents.onAgentComplete((data) => {
      if (data.sessionId === sessionId) {
        setAgents((prev) => {
          const existing = prev.findIndex((a) => a.agentId === data.agent.agentId)
          if (existing >= 0) {
            const updated = [...prev]
            updated[existing] = data.agent
            return updated
          }
          return prev
        })
      }
    })

    const unsubConflict = apiClient.conflicts.onConflictDetected((data) => {
      if (data.sessionId === sessionId) {
        setConflicts((prev) => [...prev, data.conflict])
      }
    })

    const unsubConflictResolved = apiClient.conflicts.onConflictResolved((data) => {
      if (data.sessionId === sessionId) {
        setConflicts((prev) => {
          const existing = prev.findIndex((c) => c.id === data.conflict.id)
          if (existing >= 0) {
            const updated = [...prev]
            updated[existing] = data.conflict
            return updated
          }
          return prev
        })
      }
    })

    return () => {
      unsubAgentState()
      unsubAgentComplete()
      unsubConflict()
      unsubConflictResolved()
    }
  }, [sessionId])

  const loadAgentsAndConflicts = async () => {
    try {
      const [agentsResult, conflictsResult, parallelResult] = await Promise.all([
        apiClient.agents.listAgents(sessionId),
        apiClient.conflicts.listConflicts(sessionId),
        apiClient.agents.getParallelStatus(sessionId),
      ])

      if (agentsResult.success && agentsResult.data) {
        setAgents(agentsResult.data)
      }
      if (conflictsResult.success && conflictsResult.data) {
        setConflicts(conflictsResult.data)
      }
      if (parallelResult.success && parallelResult.data) {
        setParallelStatus(parallelResult.data)
      }
    } catch (error) {
      console.error('Failed to load agents/conflicts:', error)
    }
  }

  const session = activeSession || sessions.find(s => s.id === sessionId)
  const sessionCheckpoints = pendingCheckpoints.filter(c => c.sessionId === sessionId)

  const onRefresh = async () => {
    setRefreshing(true)
    await Promise.all([loadSessions(), loadAgentsAndConflicts()])
    setRefreshing(false)
  }

  const handleApproveConflict = async (
    conflictId: string,
    strategy?: ConflictResolutionStrategy
  ): Promise<void> => {
    try {
      const result = await apiClient.conflicts.approveResolution(sessionId, conflictId, strategy)
      if (!result.success) {
        Alert.alert('Error', result.error || 'Failed to approve resolution')
        return
      }
      await loadAgentsAndConflicts()
    } catch (error) {
      Alert.alert('Error', 'Failed to approve conflict resolution')
      console.error('Failed to approve conflict:', error)
    }
  }

  const handleRejectConflict = async (conflictId: string, reason?: string): Promise<void> => {
    try {
      const result = await apiClient.conflicts.rejectResolution(sessionId, conflictId, reason)
      if (!result.success) {
        Alert.alert('Error', result.error || 'Failed to reject resolution')
        return
      }
      await loadAgentsAndConflicts()
    } catch (error) {
      Alert.alert('Error', 'Failed to reject conflict resolution')
      console.error('Failed to reject conflict:', error)
    }
  }

  const handleApproveAllConflicts = async () => {
    Alert.alert(
      'Approve All Resolutions',
      'Are you sure you want to approve all AI-generated conflict resolutions?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve All',
          onPress: async () => {
            await apiClient.conflicts.approveAllResolutions(sessionId)
            await loadAgentsAndConflicts()
          },
        },
      ]
    )
  }

  // Count active agents and pending conflicts
  const activeAgents = agents.filter(
    (a) => a.state !== 'completed' && a.state !== 'failed' && a.state !== 'stopped'
  )
  const pendingConflicts = conflicts.filter((c) => c.status === 'ai_resolved')

  const handlePause = () => {
    Alert.alert('Pause Session', 'Are you sure you want to pause this session?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Pause', onPress: () => pauseSession(sessionId) },
    ])
  }

  const handleResume = () => {
    resumeSession(sessionId)
  }

  const handleStop = () => {
    Alert.alert('Stop Session', 'Are you sure you want to stop this session? This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Stop', style: 'destructive', onPress: () => stopSession(sessionId) },
    ])
  }

  const handleApproveCheckpoint = async (checkpoint: RalphCheckpoint) => {
    await approveCheckpoint(sessionId, checkpoint.id, checkpointComment || undefined)
    setCheckpointComment('')
  }

  const handleSkipCheckpoint = async (checkpoint: RalphCheckpoint) => {
    await skipCheckpoint(sessionId, checkpoint.id, checkpointComment || undefined)
    setCheckpointComment('')
  }

  const handleRejectCheckpoint = async (checkpoint: RalphCheckpoint) => {
    Alert.alert('Reject Checkpoint', 'Are you sure you want to reject this checkpoint?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reject',
        style: 'destructive',
        onPress: async () => {
          await rejectCheckpoint(sessionId, checkpoint.id, checkpointComment || undefined)
          setCheckpointComment('')
        },
      },
    ])
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running': return '#22c55e'
      case 'paused': return '#f59e0b'
      case 'completed': return '#3b82f6'
      case 'error': return '#ef4444'
      case 'passed': return '#22c55e'
      case 'failed': return '#ef4444'
      case 'in_progress': return '#3b82f6'
      default: return '#666'
    }
  }

  const getFeatureIcon = (status: RalphFeature['status']) => {
    switch (status) {
      case 'passed': return '✓'
      case 'failed': return '✗'
      case 'in_progress': return '●'
      case 'skipped': return '○'
      default: return '○'
    }
  }

  if (!session) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onBack} style={styles.backButton}>
            <Text style={styles.backButtonText}>← Back</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.emptyState}>
          <Text style={styles.emptyStateText}>Session not found</Text>
        </View>
      </View>
    )
  }

  const passedFeatures = session.features.filter(f => f.status === 'passed').length
  const totalFeatures = session.features.length
  const progressPercent = totalFeatures > 0 ? (passedFeatures / totalFeatures) * 100 : 0

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {session.projectPath.split(/[\\/]/).pop()}
        </Text>
      </View>

      {/* Tab Navigation */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'overview' && styles.activeTab]}
          onPress={() => setActiveTab('overview')}
        >
          <Text style={[styles.tabText, activeTab === 'overview' && styles.activeTabText]}>
            Overview
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'agents' && styles.activeTab]}
          onPress={() => setActiveTab('agents')}
        >
          <Text style={[styles.tabText, activeTab === 'agents' && styles.activeTabText]}>
            Agents {activeAgents.length > 0 && `(${activeAgents.length})`}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'conflicts' && styles.activeTab]}
          onPress={() => setActiveTab('conflicts')}
        >
          <Text style={[styles.tabText, activeTab === 'conflicts' && styles.activeTabText]}>
            Conflicts {pendingConflicts.length > 0 && `(${pendingConflicts.length})`}
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#3b82f6" />
        }
      >
        {/* OVERVIEW TAB */}
        {activeTab === 'overview' && (
          <>
        {/* Status Card */}
        <View style={styles.statusCard}>
          <View style={styles.statusRow}>
            <View style={[styles.statusBadge, { backgroundColor: getStatusColor(session.status) }]}>
              <Text style={styles.statusBadgeText}>{session.status}</Text>
            </View>
            <Text style={styles.phaseText}>{session.phase}</Text>
          </View>

          <View style={styles.statsRow}>
            <View style={styles.stat}>
              <Text style={styles.statValue}>{session.iteration}</Text>
              <Text style={styles.statLabel}>Iteration</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statValue}>{passedFeatures}/{totalFeatures}</Text>
              <Text style={styles.statLabel}>Features</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statValue}>${session.totalCostUsd.toFixed(2)}</Text>
              <Text style={styles.statLabel}>Cost</Text>
            </View>
          </View>

          {totalFeatures > 0 && (
            <View style={styles.progressContainer}>
              <View style={styles.progressBar}>
                <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
              </View>
              <Text style={styles.progressText}>{Math.round(progressPercent)}% complete</Text>
            </View>
          )}

          {/* Control Buttons */}
          {session.status !== 'completed' && session.status !== 'error' && (
            <View style={styles.controlButtons}>
              {session.status === 'running' ? (
                <TouchableOpacity style={styles.controlButton} onPress={handlePause}>
                  <Text style={styles.controlButtonText}>⏸ Pause</Text>
                </TouchableOpacity>
              ) : session.status === 'paused' ? (
                <TouchableOpacity
                  style={[styles.controlButton, styles.controlButtonPrimary]}
                  onPress={handleResume}
                >
                  <Text style={styles.controlButtonTextPrimary}>▶ Resume</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                style={[styles.controlButton, styles.controlButtonDanger]}
                onPress={handleStop}
              >
                <Text style={styles.controlButtonTextDanger}>⏹ Stop</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Pending Checkpoints */}
        {sessionCheckpoints.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Pending Checkpoints</Text>
            {sessionCheckpoints.map((checkpoint) => (
              <View key={checkpoint.id} style={styles.checkpointCard}>
                <View style={styles.checkpointHeader}>
                  <Text style={styles.checkpointType}>{checkpoint.type}</Text>
                </View>
                <Text style={styles.checkpointTitle}>{checkpoint.title}</Text>
                <Text style={styles.checkpointDescription}>{checkpoint.description}</Text>

                <TextInput
                  style={styles.commentInput}
                  placeholder="Add a comment (optional)"
                  placeholderTextColor="#666"
                  value={checkpointComment}
                  onChangeText={setCheckpointComment}
                  multiline
                />

                <View style={styles.checkpointActions}>
                  <TouchableOpacity
                    style={[styles.checkpointButton, styles.approveButton]}
                    onPress={() => handleApproveCheckpoint(checkpoint)}
                  >
                    <Text style={styles.approveButtonText}>✓ Approve</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.checkpointButton, styles.skipButton]}
                    onPress={() => handleSkipCheckpoint(checkpoint)}
                  >
                    <Text style={styles.skipButtonText}>Skip</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.checkpointButton, styles.rejectButton]}
                    onPress={() => handleRejectCheckpoint(checkpoint)}
                  >
                    <Text style={styles.rejectButtonText}>✗ Reject</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Features */}
        {session.features.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Features</Text>
            {session.features.map((feature) => (
              <View key={feature.id} style={styles.featureCard}>
                <View style={styles.featureHeader}>
                  <Text style={[styles.featureIcon, { color: getStatusColor(feature.status) }]}>
                    {getFeatureIcon(feature.status)}
                  </Text>
                  <View style={styles.featureContent}>
                    <Text style={styles.featureName}>{feature.name}</Text>
                    <Text style={styles.featureCategory}>{feature.category}</Text>
                  </View>
                  {feature.attempts > 1 && (
                    <Text style={styles.featureAttempts}>{feature.attempts} attempts</Text>
                  )}
                </View>
                {feature.description && (
                  <Text style={styles.featureDescription}>{feature.description}</Text>
                )}
              </View>
            ))}
          </View>
        )}

        {/* Session Info */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Session Info</Text>
          <View style={styles.infoCard}>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Started</Text>
              <Text style={styles.infoValue}>
                {new Date(session.startedAt).toLocaleString()}
              </Text>
            </View>
            {session.completedAt && (
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Completed</Text>
                <Text style={styles.infoValue}>
                  {new Date(session.completedAt).toLocaleString()}
                </Text>
              </View>
            )}
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Project Path</Text>
              <Text style={styles.infoValue} numberOfLines={2}>
                {session.projectPath}
              </Text>
            </View>
          </View>
        </View>

        {/* Error Display */}
        {session.error && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Error</Text>
            <View style={styles.errorCard}>
              <Text style={styles.errorText}>{session.error}</Text>
            </View>
          </View>
        )}
          </>
        )}

        {/* AGENTS TAB */}
        {activeTab === 'agents' && (
          <View style={styles.section}>
            {/* Parallel Status Summary */}
            {parallelStatus && (
              <View style={styles.parallelStatusCard}>
                <View style={styles.parallelHeader}>
                  <Text style={styles.parallelTitle}>Parallel Execution</Text>
                  <View style={[styles.parallelStateBadge, { backgroundColor: getParallelStateColor(parallelStatus.state) }]}>
                    <Text style={styles.parallelStateText}>{parallelStatus.state.replace('_', ' ')}</Text>
                  </View>
                </View>
                <View style={styles.parallelStats}>
                  <View style={styles.parallelStat}>
                    <Text style={styles.parallelStatValue}>
                      {parallelStatus.currentGroup}/{parallelStatus.totalGroups}
                    </Text>
                    <Text style={styles.parallelStatLabel}>Groups</Text>
                  </View>
                  <View style={styles.parallelStat}>
                    <Text style={styles.parallelStatValue}>{parallelStatus.agents.length}</Text>
                    <Text style={styles.parallelStatLabel}>Agents</Text>
                  </View>
                  <View style={styles.parallelStat}>
                    <Text style={styles.parallelStatValue}>{parallelStatus.progress}%</Text>
                    <Text style={styles.parallelStatLabel}>Progress</Text>
                  </View>
                </View>
              </View>
            )}

            {/* Agent List */}
            <Text style={styles.sectionTitle}>Active Agents</Text>
            {agents.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyStateText}>No agents running</Text>
              </View>
            ) : (
              agents.map((agent) => (
                <AgentMonitorCard key={agent.agentId} agent={agent} />
              ))
            )}
          </View>
        )}

        {/* CONFLICTS TAB */}
        {activeTab === 'conflicts' && (
          <View style={styles.section}>
            {/* Bulk Actions */}
            {pendingConflicts.length > 1 && (
              <TouchableOpacity style={styles.bulkApproveButton} onPress={handleApproveAllConflicts}>
                <Text style={styles.bulkApproveText}>✓ Approve All ({pendingConflicts.length} resolutions)</Text>
              </TouchableOpacity>
            )}

            {/* Conflict List */}
            <Text style={styles.sectionTitle}>
              Merge Conflicts {conflicts.length > 0 && `(${conflicts.length})`}
            </Text>
            {conflicts.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyStateText}>No merge conflicts</Text>
              </View>
            ) : (
              conflicts.map((conflict) => (
                <MergeConflictCard
                  key={conflict.id}
                  conflict={conflict}
                  onApprove={handleApproveConflict}
                  onReject={handleRejectConflict}
                  expanded={conflicts.length === 1}
                />
              ))
            )}
          </View>
        )}
      </ScrollView>
    </View>
  )
}

/**
 * Get color for parallel execution state
 */
function getParallelStateColor(state: ParallelSessionStatus['state']): string {
  switch (state) {
    case 'completed':
      return '#22c55e'
    case 'failed':
      return '#ef4444'
    case 'executing_group':
      return '#3b82f6'
    case 'checkpoint_merge':
      return '#f59e0b'
    case 'paused':
      return '#8b5cf6'
    case 'idle':
    default:
      return '#666'
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    paddingTop: 60,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  backButton: {
    marginRight: 12,
  },
  backButtonText: {
    color: '#3b82f6',
    fontSize: 16,
  },
  headerTitle: {
    flex: 1,
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  content: {
    flex: 1,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyStateText: {
    color: '#666',
    fontSize: 16,
  },
  statusCard: {
    backgroundColor: '#1a1a1a',
    margin: 16,
    padding: 16,
    borderRadius: 12,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginRight: 12,
  },
  statusBadgeText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  phaseText: {
    color: '#888',
    fontSize: 14,
    textTransform: 'capitalize',
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 16,
  },
  stat: {
    alignItems: 'center',
  },
  statValue: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  statLabel: {
    color: '#666',
    fontSize: 12,
    marginTop: 4,
  },
  progressContainer: {
    marginBottom: 16,
  },
  progressBar: {
    height: 8,
    backgroundColor: '#333',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#22c55e',
    borderRadius: 4,
  },
  progressText: {
    color: '#888',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 8,
  },
  controlButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  controlButton: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#333',
  },
  controlButtonPrimary: {
    backgroundColor: '#3b82f6',
    borderColor: '#3b82f6',
  },
  controlButtonDanger: {
    borderColor: '#ef4444',
  },
  controlButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  controlButtonTextPrimary: {
    color: '#fff',
    fontWeight: '600',
  },
  controlButtonTextDanger: {
    color: '#ef4444',
    fontWeight: '600',
  },
  section: {
    padding: 16,
    paddingTop: 0,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#888',
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  checkpointCard: {
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  checkpointHeader: {
    marginBottom: 8,
  },
  checkpointType: {
    color: '#f59e0b',
    fontSize: 12,
    textTransform: 'uppercase',
    fontWeight: '600',
  },
  checkpointTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  checkpointDescription: {
    color: '#888',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 12,
  },
  commentInput: {
    backgroundColor: '#0a0a0a',
    borderRadius: 8,
    padding: 12,
    color: '#fff',
    fontSize: 14,
    marginBottom: 12,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  checkpointActions: {
    flexDirection: 'row',
    gap: 8,
  },
  checkpointButton: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  approveButton: {
    backgroundColor: '#22c55e',
  },
  approveButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  skipButton: {
    backgroundColor: '#333',
  },
  skipButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  rejectButton: {
    backgroundColor: '#ef4444',
  },
  rejectButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  featureCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
  },
  featureHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  featureIcon: {
    fontSize: 16,
    marginRight: 12,
    fontWeight: 'bold',
  },
  featureContent: {
    flex: 1,
  },
  featureName: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
  featureCategory: {
    color: '#666',
    fontSize: 12,
    marginTop: 2,
  },
  featureAttempts: {
    color: '#f59e0b',
    fontSize: 11,
  },
  featureDescription: {
    color: '#888',
    fontSize: 13,
    marginTop: 8,
    marginLeft: 28,
  },
  infoCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  infoLabel: {
    color: '#666',
    fontSize: 14,
  },
  infoValue: {
    color: '#fff',
    fontSize: 14,
    flex: 1,
    textAlign: 'right',
    marginLeft: 16,
  },
  errorCard: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
    borderRadius: 12,
    padding: 16,
  },
  errorText: {
    color: '#ef4444',
    fontSize: 14,
  },
  // Tab Navigation
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#1a1a1a',
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
  },
  activeTab: {
    borderBottomWidth: 2,
    borderBottomColor: '#3b82f6',
  },
  tabText: {
    color: '#888',
    fontSize: 14,
    fontWeight: '500',
  },
  activeTabText: {
    color: '#3b82f6',
  },
  // Parallel Status
  parallelStatusCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  parallelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  parallelTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  parallelStateBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 4,
  },
  parallelStateText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  parallelStats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  parallelStat: {
    alignItems: 'center',
  },
  parallelStatValue: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  parallelStatLabel: {
    color: '#666',
    fontSize: 11,
    marginTop: 2,
  },
  // Bulk Actions
  bulkApproveButton: {
    backgroundColor: '#22c55e',
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
    marginBottom: 16,
  },
  bulkApproveText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
})

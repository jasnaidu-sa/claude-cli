import React, { useEffect, useState, useCallback } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRalphStore } from '../stores/ralph-store'
import { useConnectionStore } from '../stores/connection-store'
import { ConnectionBanner } from '../components/ConnectionBanner'
import type { RalphSession, Idea } from '../types'
import { apiClient } from '../api/client'

interface DashboardScreenProps {
  onNavigateToSession: (sessionId: string) => void
  onNavigateToIdeas: () => void
  onNavigateToSettings: () => void
  onStartNewSession: () => void
}

export function DashboardScreen({
  onNavigateToSession,
  onNavigateToIdeas,
  onNavigateToSettings,
  onStartNewSession,
}: DashboardScreenProps) {
  const insets = useSafeAreaInsets()
  const { sessions, pendingCheckpoints, loadSessions, subscribeToEvents } = useRalphStore()
  const { serverUrl, isConnected, connectionQuality, offlineQueue } = useConnectionStore()
  const [refreshing, setRefreshing] = useState(false)
  const [recentIdeas, setRecentIdeas] = useState<Idea[]>([])

  useEffect(() => {
    loadSessions()
    loadRecentIdeas()
    const unsubscribe = subscribeToEvents()
    return unsubscribe
  }, [])

  const loadRecentIdeas = async () => {
    try {
      const result = await apiClient.ideas.list('inbox')
      if (result.success && result.data) {
        setRecentIdeas(result.data.slice(0, 3))
      }
    } catch (error) {
      console.error('Failed to load ideas:', error)
    }
  }

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await Promise.all([loadSessions(), loadRecentIdeas()])
    setRefreshing(false)
  }, [])

  const getStatusColor = (status: RalphSession['status']) => {
    switch (status) {
      case 'running': return '#22c55e'
      case 'paused': return '#f59e0b'
      case 'completed': return '#3b82f6'
      case 'error': return '#ef4444'
      default: return '#666'
    }
  }

  const getPhaseLabel = (phase: RalphSession['phase']) => {
    const labels: Record<string, string> = {
      setup: 'Setup',
      planning: 'Planning',
      implementation: 'Implementation',
      testing: 'Testing',
      review: 'Review',
      complete: 'Complete',
    }
    return labels[phase] || phase
  }

  const runningSessions = sessions.filter(s => s.status === 'running' || s.status === 'paused')

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <View>
          <Text style={styles.title}>Claude Code</Text>
          <Text style={styles.serverUrl}>{serverUrl || 'Not connected'}</Text>
        </View>
        <TouchableOpacity onPress={onNavigateToSettings} style={styles.settingsButton}>
          <Text style={styles.settingsIcon}>⚙</Text>
        </TouchableOpacity>
      </View>

      {/* Connection Banner */}
      <ConnectionBanner />

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#3b82f6"
          />
        }
      >
        {/* Offline Queue Indicator */}
        {offlineQueue.length > 0 && (
          <View style={styles.offlineQueueBanner}>
            <Text style={styles.offlineQueueIcon}>📤</Text>
            <Text style={styles.offlineQueueText}>
              {offlineQueue.length} action{offlineQueue.length > 1 ? 's' : ''} queued
            </Text>
            {isConnected && (
              <Text style={styles.offlineQueueSync}>Syncing...</Text>
            )}
          </View>
        )}

        {/* Pending Checkpoints Alert */}
        {pendingCheckpoints.length > 0 && (
          <TouchableOpacity
            style={styles.checkpointAlert}
            onPress={() => {
              const checkpoint = pendingCheckpoints[0]
              onNavigateToSession(checkpoint.sessionId)
            }}
          >
            <View style={styles.checkpointBadge}>
              <Text style={styles.checkpointBadgeText}>{pendingCheckpoints.length}</Text>
            </View>
            <View style={styles.checkpointContent}>
              <Text style={styles.checkpointTitle}>Checkpoint Pending</Text>
              <Text style={styles.checkpointSubtitle} numberOfLines={1}>
                {pendingCheckpoints[0].title}
              </Text>
            </View>
            <Text style={styles.checkpointArrow}>→</Text>
          </TouchableOpacity>
        )}

        {/* Quick Actions */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Quick Actions</Text>
          <View style={styles.quickActions}>
            <TouchableOpacity style={styles.quickActionPrimary} onPress={onStartNewSession}>
              <Text style={styles.quickActionPrimaryIcon}>+</Text>
              <Text style={styles.quickActionPrimaryLabel}>New Session</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.quickAction} onPress={onNavigateToIdeas}>
              <Text style={styles.quickActionIcon}>💡</Text>
              <Text style={styles.quickActionLabel}>Ideas</Text>
              {recentIdeas.length > 0 && (
                <View style={styles.quickActionBadge}>
                  <Text style={styles.quickActionBadgeText}>{recentIdeas.length}</Text>
                </View>
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* Active Sessions */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Active Sessions</Text>
            {runningSessions.length > 0 && (
              <View style={styles.liveIndicator}>
                <View style={styles.liveDot} />
                <Text style={styles.liveText}>Live</Text>
              </View>
            )}
          </View>
          {runningSessions.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateIcon}>▷</Text>
              <Text style={styles.emptyStateText}>No active sessions</Text>
              <Text style={styles.emptyStateSubtext}>
                Start a new Ralph Loop session to begin
              </Text>
            </View>
          ) : (
            runningSessions.map((session) => (
              <TouchableOpacity
                key={session.id}
                style={styles.sessionCard}
                onPress={() => onNavigateToSession(session.id)}
              >
                <View style={styles.sessionHeader}>
                  <View style={[styles.statusDot, { backgroundColor: getStatusColor(session.status) }]} />
                  <Text style={styles.sessionStatus}>{session.status}</Text>
                  <View style={styles.sessionCost}>
                    <Text style={styles.sessionCostText}>${session.totalCostUsd.toFixed(2)}</Text>
                  </View>
                </View>
                <Text style={styles.sessionProject} numberOfLines={1}>
                  {session.projectPath.split(/[\\/]/).pop()}
                </Text>
                <View style={styles.sessionMeta}>
                  <Text style={styles.sessionPhase}>{getPhaseLabel(session.phase)}</Text>
                  <Text style={styles.sessionDivider}>•</Text>
                  <Text style={styles.sessionIteration}>Iteration {session.iteration}</Text>
                </View>
                {session.features.length > 0 && (
                  <View style={styles.progressContainer}>
                    <View style={styles.progressBar}>
                      <View
                        style={[
                          styles.progressFill,
                          {
                            width: `${(session.features.filter(f => f.status === 'passed').length / session.features.length) * 100}%`,
                          },
                        ]}
                      />
                    </View>
                    <Text style={styles.progressText}>
                      {session.features.filter(f => f.status === 'passed').length}/{session.features.length} features
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            ))
          )}
        </View>

        {/* Ideas Inbox Preview */}
        {recentIdeas.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Ideas Inbox</Text>
              <TouchableOpacity onPress={onNavigateToIdeas}>
                <Text style={styles.seeAllLink}>See all →</Text>
              </TouchableOpacity>
            </View>
            {recentIdeas.map((idea) => (
              <TouchableOpacity
                key={idea.id}
                style={styles.ideaPreview}
                onPress={onNavigateToIdeas}
              >
                <View style={[styles.priorityIndicator, { backgroundColor: getPriorityColor(idea.priority) }]} />
                <View style={styles.ideaContent}>
                  <Text style={styles.ideaTitle} numberOfLines={1}>{idea.title}</Text>
                  <Text style={styles.ideaSource} numberOfLines={1}>
                    From: {idea.emailSource.from}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Connection Status Card */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Connection</Text>
          <View style={styles.connectionCard}>
            <View style={styles.connectionRow}>
              <Text style={styles.connectionLabel}>Status</Text>
              <View style={styles.connectionValue}>
                <View style={[
                  styles.connectionDot,
                  { backgroundColor: isConnected ? '#22c55e' : '#ef4444' }
                ]} />
                <Text style={styles.connectionText}>
                  {isConnected ? 'Connected' : 'Disconnected'}
                </Text>
              </View>
            </View>
            {isConnected && (
              <View style={styles.connectionRow}>
                <Text style={styles.connectionLabel}>Quality</Text>
                <Text style={[
                  styles.connectionQuality,
                  { color: getQualityColor(connectionQuality) }
                ]}>
                  {connectionQuality.charAt(0).toUpperCase() + connectionQuality.slice(1)}
                </Text>
              </View>
            )}
          </View>
        </View>
      </ScrollView>
    </View>
  )
}

function getPriorityColor(priority: string): string {
  switch (priority) {
    case 'urgent': return '#ef4444'
    case 'high': return '#f59e0b'
    case 'medium': return '#3b82f6'
    default: return '#666'
  }
}

function getQualityColor(quality: string): string {
  switch (quality) {
    case 'excellent': return '#22c55e'
    case 'good': return '#3b82f6'
    case 'poor': return '#f59e0b'
    default: return '#ef4444'
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
  },
  serverUrl: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  settingsButton: {
    padding: 8,
  },
  settingsIcon: {
    fontSize: 24,
    color: '#888',
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    paddingBottom: 24,
  },
  offlineQueueBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(59, 130, 246, 0.2)',
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  offlineQueueIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  offlineQueueText: {
    color: '#3b82f6',
    fontSize: 13,
    flex: 1,
  },
  offlineQueueSync: {
    color: '#666',
    fontSize: 12,
  },
  checkpointAlert: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
    margin: 16,
    marginBottom: 0,
    padding: 16,
    borderRadius: 12,
  },
  checkpointBadge: {
    backgroundColor: '#f59e0b',
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  checkpointBadgeText: {
    color: '#000',
    fontWeight: 'bold',
    fontSize: 14,
  },
  checkpointContent: {
    flex: 1,
  },
  checkpointTitle: {
    color: '#f59e0b',
    fontWeight: '600',
    fontSize: 14,
  },
  checkpointSubtitle: {
    color: '#888',
    fontSize: 12,
    marginTop: 2,
  },
  checkpointArrow: {
    color: '#f59e0b',
    fontSize: 18,
  },
  section: {
    padding: 16,
    paddingBottom: 0,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  liveIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#22c55e',
    marginRight: 4,
  },
  liveText: {
    color: '#22c55e',
    fontSize: 12,
    fontWeight: '500',
  },
  seeAllLink: {
    color: '#3b82f6',
    fontSize: 13,
  },
  quickActions: {
    flexDirection: 'row',
    gap: 12,
  },
  quickActionPrimary: {
    flex: 1,
    backgroundColor: '#3b82f6',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  quickActionPrimaryIcon: {
    fontSize: 24,
    color: '#fff',
    marginBottom: 4,
  },
  quickActionPrimaryLabel: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  quickAction: {
    flex: 1,
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    position: 'relative',
  },
  quickActionIcon: {
    fontSize: 24,
    marginBottom: 4,
  },
  quickActionLabel: {
    color: '#fff',
    fontSize: 13,
  },
  quickActionBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: '#ef4444',
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  quickActionBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: 'bold',
  },
  emptyState: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 32,
    alignItems: 'center',
  },
  emptyStateIcon: {
    fontSize: 32,
    color: '#444',
    marginBottom: 12,
  },
  emptyStateText: {
    color: '#888',
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 4,
  },
  emptyStateSubtext: {
    color: '#666',
    fontSize: 13,
    textAlign: 'center',
  },
  sessionCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  sessionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  sessionStatus: {
    color: '#888',
    fontSize: 12,
    textTransform: 'capitalize',
    flex: 1,
  },
  sessionCost: {
    backgroundColor: '#222',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  sessionCostText: {
    color: '#888',
    fontSize: 11,
  },
  sessionProject: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  sessionMeta: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sessionPhase: {
    color: '#3b82f6',
    fontSize: 13,
  },
  sessionDivider: {
    color: '#444',
    marginHorizontal: 8,
  },
  sessionIteration: {
    color: '#666',
    fontSize: 13,
  },
  progressContainer: {
    marginTop: 12,
  },
  progressBar: {
    height: 4,
    backgroundColor: '#333',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#22c55e',
    borderRadius: 2,
  },
  progressText: {
    color: '#666',
    fontSize: 11,
    marginTop: 4,
    textAlign: 'right',
  },
  ideaPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  priorityIndicator: {
    width: 4,
    height: 32,
    borderRadius: 2,
    marginRight: 12,
  },
  ideaContent: {
    flex: 1,
  },
  ideaTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 2,
  },
  ideaSource: {
    color: '#666',
    fontSize: 12,
  },
  connectionCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
  },
  connectionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  connectionLabel: {
    color: '#666',
    fontSize: 14,
  },
  connectionValue: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  connectionDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  connectionText: {
    color: '#fff',
    fontSize: 14,
  },
  connectionQuality: {
    fontSize: 14,
    fontWeight: '500',
  },
})

import React, { useEffect, useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
} from 'react-native'
import { useRalphStore } from '../stores/ralph-store'
import { useConnectionStore } from '../stores/connection-store'
import type { RalphSession } from '../types'

interface HomeScreenProps {
  onNavigateToSession: (sessionId: string) => void
  onNavigateToIdeas: () => void
  onDisconnect: () => void
}

export function HomeScreen({ onNavigateToSession, onNavigateToIdeas, onDisconnect }: HomeScreenProps) {
  const { sessions, pendingCheckpoints, loadSessions, subscribeToEvents } = useRalphStore()
  const { serverUrl, disconnect } = useConnectionStore()
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    loadSessions()
    const unsubscribe = subscribeToEvents()
    return unsubscribe
  }, [])

  const onRefresh = async () => {
    setRefreshing(true)
    await loadSessions()
    setRefreshing(false)
  }

  const handleDisconnect = () => {
    disconnect()
    onDisconnect()
  }

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
  const completedSessions = sessions.filter(s => s.status === 'completed')

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Claude Code</Text>
          <Text style={styles.serverUrl}>{serverUrl}</Text>
        </View>
        <TouchableOpacity onPress={handleDisconnect} style={styles.disconnectButton}>
          <Text style={styles.disconnectText}>Disconnect</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#3b82f6"
          />
        }
      >
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
              <Text style={styles.checkpointTitle}>Checkpoints Pending</Text>
              <Text style={styles.checkpointSubtitle}>
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
            <TouchableOpacity style={styles.quickAction} onPress={onNavigateToIdeas}>
              <Text style={styles.quickActionIcon}>💡</Text>
              <Text style={styles.quickActionLabel}>Ideas</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.quickAction}>
              <Text style={styles.quickActionIcon}>📊</Text>
              <Text style={styles.quickActionLabel}>Projects</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.quickAction}>
              <Text style={styles.quickActionIcon}>⚙️</Text>
              <Text style={styles.quickActionLabel}>Settings</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Active Sessions */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Active Sessions</Text>
          {runningSessions.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateText}>No active Ralph Loop sessions</Text>
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
                )}
              </TouchableOpacity>
            ))
          )}
        </View>

        {/* Completed Sessions */}
        {completedSessions.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Recently Completed</Text>
            {completedSessions.slice(0, 3).map((session) => (
              <TouchableOpacity
                key={session.id}
                style={styles.sessionCardCompact}
                onPress={() => onNavigateToSession(session.id)}
              >
                <Text style={styles.sessionProject} numberOfLines={1}>
                  {session.projectPath.split(/[\\/]/).pop()}
                </Text>
                <Text style={styles.completedDate}>
                  {new Date(session.completedAt!).toLocaleDateString()}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  )
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
    padding: 16,
    paddingTop: 60,
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
  disconnectButton: {
    padding: 8,
  },
  disconnectText: {
    color: '#ef4444',
    fontSize: 14,
  },
  content: {
    flex: 1,
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
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#888',
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  quickActions: {
    flexDirection: 'row',
    gap: 12,
  },
  quickAction: {
    flex: 1,
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  quickActionIcon: {
    fontSize: 24,
    marginBottom: 8,
  },
  quickActionLabel: {
    color: '#fff',
    fontSize: 13,
  },
  emptyState: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
  },
  emptyStateText: {
    color: '#666',
    fontSize: 14,
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
  progressBar: {
    height: 4,
    backgroundColor: '#333',
    borderRadius: 2,
    marginTop: 12,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#22c55e',
    borderRadius: 2,
  },
  sessionCardCompact: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
  },
  completedDate: {
    color: '#666',
    fontSize: 13,
  },
})

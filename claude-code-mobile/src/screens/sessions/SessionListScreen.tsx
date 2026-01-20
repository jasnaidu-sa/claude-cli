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
import { useRalphStore } from '../../stores/ralph-store'
import type { RalphSession } from '../../types'

interface SessionListScreenProps {
  onNavigateToSession: (sessionId: string) => void
  onStartNewSession: () => void
}

type FilterType = 'all' | 'running' | 'paused' | 'completed' | 'error'

export function SessionListScreen({
  onNavigateToSession,
  onStartNewSession,
}: SessionListScreenProps) {
  const insets = useSafeAreaInsets()
  const { sessions, pendingCheckpoints, loadSessions, subscribeToEvents } = useRalphStore()
  const [refreshing, setRefreshing] = useState(false)
  const [filter, setFilter] = useState<FilterType>('all')

  useEffect(() => {
    loadSessions()
    const unsubscribe = subscribeToEvents()
    return unsubscribe
  }, [])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await loadSessions()
    setRefreshing(false)
  }, [])

  const filteredSessions = sessions.filter(session => {
    if (filter === 'all') return true
    if (filter === 'running') return session.status === 'running' || session.status === 'paused'
    return session.status === filter
  })

  const groupedSessions = groupSessionsByProject(filteredSessions)

  const getFilterCount = (f: FilterType) => {
    if (f === 'all') return sessions.length
    if (f === 'running') return sessions.filter(s => s.status === 'running' || s.status === 'paused').length
    return sessions.filter(s => s.status === f).length
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Text style={styles.title}>Sessions</Text>
        <TouchableOpacity style={styles.newButton} onPress={onStartNewSession}>
          <Text style={styles.newButtonText}>+ New</Text>
        </TouchableOpacity>
      </View>

      {/* Pending Checkpoints Banner */}
      {pendingCheckpoints.length > 0 && (
        <TouchableOpacity
          style={styles.checkpointBanner}
          onPress={() => {
            const cp = pendingCheckpoints[0]
            onNavigateToSession(cp.sessionId)
          }}
        >
          <View style={styles.checkpointBadge}>
            <Text style={styles.checkpointBadgeText}>{pendingCheckpoints.length}</Text>
          </View>
          <Text style={styles.checkpointText}>
            {pendingCheckpoints.length} checkpoint{pendingCheckpoints.length > 1 ? 's' : ''} pending
          </Text>
          <Text style={styles.checkpointArrow}>→</Text>
        </TouchableOpacity>
      )}

      {/* Filter Tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterContainer}
        contentContainerStyle={styles.filterContent}
      >
        {(['all', 'running', 'completed', 'error'] as FilterType[]).map(f => (
          <TouchableOpacity
            key={f}
            style={[styles.filterTab, filter === f && styles.filterTabActive]}
            onPress={() => setFilter(f)}
          >
            <Text style={[styles.filterTabText, filter === f && styles.filterTabTextActive]}>
              {f.charAt(0).toUpperCase() + f.slice(1)} ({getFilterCount(f)})
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Sessions List */}
      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#3b82f6" />
        }
      >
        {filteredSessions.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>▷</Text>
            <Text style={styles.emptyTitle}>No sessions</Text>
            <Text style={styles.emptySubtitle}>
              {filter === 'all'
                ? 'Start a new Ralph Loop session to begin'
                : `No ${filter} sessions found`}
            </Text>
            {filter === 'all' && (
              <TouchableOpacity style={styles.startButton} onPress={onStartNewSession}>
                <Text style={styles.startButtonText}>Start New Session</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          Object.entries(groupedSessions).map(([project, projectSessions]) => (
            <View key={project} style={styles.projectGroup}>
              <View style={styles.projectHeader}>
                <Text style={styles.projectName}>{project}</Text>
                <Text style={styles.projectCount}>{projectSessions.length}</Text>
              </View>
              {projectSessions.map(session => (
                <SessionCard
                  key={session.id}
                  session={session}
                  hasCheckpoint={pendingCheckpoints.some(cp => cp.sessionId === session.id)}
                  onPress={() => onNavigateToSession(session.id)}
                />
              ))}
            </View>
          ))
        )}
      </ScrollView>
    </View>
  )
}

interface SessionCardProps {
  session: RalphSession
  hasCheckpoint: boolean
  onPress: () => void
}

function SessionCard({ session, hasCheckpoint, onPress }: SessionCardProps) {
  const passedFeatures = session.features.filter(f => f.status === 'passed').length
  const totalFeatures = session.features.length
  const progressPercent = totalFeatures > 0 ? (passedFeatures / totalFeatures) * 100 : 0

  return (
    <TouchableOpacity style={styles.sessionCard} onPress={onPress}>
      <View style={styles.sessionHeader}>
        <View style={[styles.statusDot, { backgroundColor: getStatusColor(session.status) }]} />
        <Text style={styles.sessionStatus}>{session.status}</Text>
        {hasCheckpoint && (
          <View style={styles.checkpointIndicator}>
            <Text style={styles.checkpointIndicatorText}>!</Text>
          </View>
        )}
        <Text style={styles.sessionCost}>${session.totalCostUsd.toFixed(2)}</Text>
      </View>

      <View style={styles.sessionMeta}>
        <Text style={styles.sessionPhase}>{getPhaseLabel(session.phase)}</Text>
        <Text style={styles.sessionDivider}>•</Text>
        <Text style={styles.sessionIteration}>Iteration {session.iteration}</Text>
        <Text style={styles.sessionDivider}>•</Text>
        <Text style={styles.sessionTime}>{formatTime(session.startedAt)}</Text>
      </View>

      {totalFeatures > 0 && (
        <View style={styles.progressContainer}>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
          </View>
          <Text style={styles.progressText}>
            {passedFeatures}/{totalFeatures} features
          </Text>
        </View>
      )}

      {session.currentFeatureId && (
        <View style={styles.currentFeature}>
          <Text style={styles.currentFeatureLabel}>Current:</Text>
          <Text style={styles.currentFeatureName} numberOfLines={1}>
            {session.features.find(f => f.id === session.currentFeatureId)?.name || 'Unknown'}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  )
}

function groupSessionsByProject(sessions: RalphSession[]): Record<string, RalphSession[]> {
  return sessions.reduce((acc, session) => {
    const project = session.projectPath.split(/[\\/]/).pop() || 'Unknown'
    if (!acc[project]) acc[project] = []
    acc[project].push(session)
    return acc
  }, {} as Record<string, RalphSession[]>)
}

function getStatusColor(status: RalphSession['status']): string {
  switch (status) {
    case 'running': return '#22c55e'
    case 'paused': return '#f59e0b'
    case 'completed': return '#3b82f6'
    case 'error': return '#ef4444'
    default: return '#666'
  }
}

function getPhaseLabel(phase: RalphSession['phase']): string {
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

function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const diff = now.getTime() - date.getTime()

  if (diff < 60000) return 'Just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  return date.toLocaleDateString()
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
  newButton: {
    backgroundColor: '#3b82f6',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  newButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  checkpointBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(245, 158, 11, 0.2)',
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  checkpointBadge: {
    backgroundColor: '#f59e0b',
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  checkpointBadgeText: {
    color: '#000',
    fontWeight: 'bold',
    fontSize: 12,
  },
  checkpointText: {
    color: '#f59e0b',
    flex: 1,
    fontSize: 14,
  },
  checkpointArrow: {
    color: '#f59e0b',
    fontSize: 16,
  },
  filterContainer: {
    maxHeight: 52,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  filterContent: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  filterTab: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#1a1a1a',
    marginRight: 8,
  },
  filterTabActive: {
    backgroundColor: '#3b82f6',
  },
  filterTabText: {
    color: '#888',
    fontSize: 13,
    fontWeight: '500',
  },
  filterTabTextActive: {
    color: '#fff',
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 32,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 48,
  },
  emptyIcon: {
    fontSize: 48,
    color: '#333',
    marginBottom: 16,
  },
  emptyTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
  },
  emptySubtitle: {
    color: '#666',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 24,
  },
  startButton: {
    backgroundColor: '#3b82f6',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  startButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  projectGroup: {
    marginBottom: 24,
  },
  projectHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  projectName: {
    color: '#888',
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  projectCount: {
    color: '#666',
    fontSize: 12,
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
  checkpointIndicator: {
    backgroundColor: '#f59e0b',
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  checkpointIndicatorText: {
    color: '#000',
    fontWeight: 'bold',
    fontSize: 10,
  },
  sessionCost: {
    color: '#666',
    fontSize: 12,
  },
  sessionMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
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
  sessionTime: {
    color: '#666',
    fontSize: 13,
  },
  progressContainer: {
    marginBottom: 8,
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
  currentFeature: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0a0a0a',
    borderRadius: 8,
    padding: 8,
    marginTop: 4,
  },
  currentFeatureLabel: {
    color: '#666',
    fontSize: 11,
    marginRight: 6,
  },
  currentFeatureName: {
    color: '#888',
    fontSize: 11,
    flex: 1,
  },
})

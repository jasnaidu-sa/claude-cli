import React, { useEffect, useState, useCallback } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
} from 'react-native'
import { apiClient } from '../api/client'
import type { Idea, IdeaStage } from '../types'

interface IdeasScreenProps {
  onBack: () => void
}

const STAGES: { key: IdeaStage; label: string; color: string }[] = [
  { key: 'inbox', label: 'Inbox', color: '#6b7280' },
  { key: 'reviewing', label: 'Reviewing', color: '#3b82f6' },
  { key: 'planning', label: 'Planning', color: '#8b5cf6' },
  { key: 'ready', label: 'Ready', color: '#22c55e' },
  { key: 'in_progress', label: 'In Progress', color: '#f59e0b' },
  { key: 'done', label: 'Done', color: '#10b981' },
]

export function IdeasScreen({ onBack }: IdeasScreenProps) {
  const [ideas, setIdeas] = useState<Idea[]>([])
  const [selectedStage, setSelectedStage] = useState<IdeaStage | 'all'>('all')
  const [isLoading, setIsLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const loadIdeas = useCallback(async () => {
    try {
      const stage = selectedStage === 'all' ? undefined : selectedStage
      const result = await apiClient.ideas.list(stage)
      if (result.success && result.data) {
        setIdeas(result.data)
      }
    } catch (error) {
      console.error('Failed to load ideas:', error)
    } finally {
      setIsLoading(false)
    }
  }, [selectedStage])

  useEffect(() => {
    loadIdeas()
  }, [loadIdeas])

  const onRefresh = async () => {
    setRefreshing(true)
    await loadIdeas()
    setRefreshing(false)
  }

  const handleMoveStage = async (ideaId: string, newStage: IdeaStage) => {
    const result = await apiClient.ideas.moveStage(ideaId, newStage)
    if (result.success) {
      await loadIdeas()
    }
  }

  const getPriorityColor = (priority: Idea['priority']) => {
    switch (priority) {
      case 'urgent': return '#ef4444'
      case 'high': return '#f59e0b'
      case 'medium': return '#3b82f6'
      default: return '#666'
    }
  }

  const getStageInfo = (stage: IdeaStage) => {
    return STAGES.find(s => s.key === stage) || { label: stage, color: '#666' }
  }

  const filteredIdeas = selectedStage === 'all'
    ? ideas
    : ideas.filter(i => i.stage === selectedStage)

  const groupedIdeas = STAGES.reduce((acc, stage) => {
    acc[stage.key] = filteredIdeas.filter(i => i.stage === stage.key)
    return acc
  }, {} as Record<IdeaStage, Idea[]>)

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Ideas</Text>
      </View>

      {/* Stage Filter */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterContainer}
        contentContainerStyle={styles.filterContent}
      >
        <TouchableOpacity
          style={[styles.filterChip, selectedStage === 'all' && styles.filterChipActive]}
          onPress={() => setSelectedStage('all')}
        >
          <Text style={[styles.filterChipText, selectedStage === 'all' && styles.filterChipTextActive]}>
            All ({ideas.length})
          </Text>
        </TouchableOpacity>
        {STAGES.map((stage) => {
          const count = ideas.filter(i => i.stage === stage.key).length
          return (
            <TouchableOpacity
              key={stage.key}
              style={[
                styles.filterChip,
                selectedStage === stage.key && styles.filterChipActive,
                selectedStage === stage.key && { borderColor: stage.color },
              ]}
              onPress={() => setSelectedStage(stage.key)}
            >
              <View style={[styles.filterDot, { backgroundColor: stage.color }]} />
              <Text style={[
                styles.filterChipText,
                selectedStage === stage.key && styles.filterChipTextActive,
              ]}>
                {stage.label} ({count})
              </Text>
            </TouchableOpacity>
          )
        })}
      </ScrollView>

      {/* Ideas List */}
      <ScrollView
        style={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#3b82f6" />
        }
      >
        {isLoading ? (
          <View style={styles.loadingState}>
            <Text style={styles.loadingText}>Loading ideas...</Text>
          </View>
        ) : filteredIdeas.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyStateIcon}>💡</Text>
            <Text style={styles.emptyStateText}>No ideas yet</Text>
            <Text style={styles.emptyStateSubtext}>
              Ideas from your email will appear here
            </Text>
          </View>
        ) : selectedStage === 'all' ? (
          // Show grouped by stage when "All" is selected
          STAGES.map((stage) => {
            const stageIdeas = groupedIdeas[stage.key]
            if (stageIdeas.length === 0) return null
            return (
              <View key={stage.key} style={styles.stageSection}>
                <View style={styles.stageSectionHeader}>
                  <View style={[styles.stageDot, { backgroundColor: stage.color }]} />
                  <Text style={styles.stageSectionTitle}>{stage.label}</Text>
                  <Text style={styles.stageSectionCount}>{stageIdeas.length}</Text>
                </View>
                {stageIdeas.map((idea) => (
                  <IdeaCard
                    key={idea.id}
                    idea={idea}
                    onMoveStage={handleMoveStage}
                    getPriorityColor={getPriorityColor}
                    getStageInfo={getStageInfo}
                  />
                ))}
              </View>
            )
          })
        ) : (
          // Show flat list when specific stage is selected
          filteredIdeas.map((idea) => (
            <IdeaCard
              key={idea.id}
              idea={idea}
              onMoveStage={handleMoveStage}
              getPriorityColor={getPriorityColor}
              getStageInfo={getStageInfo}
            />
          ))
        )}
      </ScrollView>
    </View>
  )
}

interface IdeaCardProps {
  idea: Idea
  onMoveStage: (ideaId: string, newStage: IdeaStage) => void
  getPriorityColor: (priority: Idea['priority']) => string
  getStageInfo: (stage: IdeaStage) => { label: string; color: string }
}

function IdeaCard({ idea, onMoveStage, getPriorityColor, getStageInfo }: IdeaCardProps) {
  const [showActions, setShowActions] = useState(false)
  const stageInfo = getStageInfo(idea.stage)

  return (
    <TouchableOpacity
      style={styles.ideaCard}
      onPress={() => setShowActions(!showActions)}
    >
      <View style={styles.ideaHeader}>
        <View style={[styles.priorityIndicator, { backgroundColor: getPriorityColor(idea.priority) }]} />
        <Text style={styles.ideaTitle} numberOfLines={2}>{idea.title}</Text>
      </View>

      <Text style={styles.ideaDescription} numberOfLines={3}>
        {idea.description}
      </Text>

      <View style={styles.ideaMeta}>
        <View style={[styles.stageChip, { borderColor: stageInfo.color }]}>
          <Text style={[styles.stageChipText, { color: stageInfo.color }]}>{stageInfo.label}</Text>
        </View>
        {idea.tags.length > 0 && (
          <Text style={styles.tagText}>
            {idea.tags.slice(0, 2).join(', ')}
            {idea.tags.length > 2 && ` +${idea.tags.length - 2}`}
          </Text>
        )}
      </View>

      <View style={styles.ideaSource}>
        <Text style={styles.sourceText}>From: {idea.emailSource.from}</Text>
        <Text style={styles.sourceDate}>
          {new Date(idea.emailSource.receivedAt).toLocaleDateString()}
        </Text>
      </View>

      {/* Quick Actions */}
      {showActions && (
        <View style={styles.actionsContainer}>
          <Text style={styles.actionsTitle}>Move to:</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {STAGES.filter(s => s.key !== idea.stage).map((stage) => (
              <TouchableOpacity
                key={stage.key}
                style={[styles.actionButton, { borderColor: stage.color }]}
                onPress={() => {
                  onMoveStage(idea.id, stage.key)
                  setShowActions(false)
                }}
              >
                <Text style={[styles.actionButtonText, { color: stage.color }]}>
                  {stage.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}
    </TouchableOpacity>
  )
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
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  filterContainer: {
    maxHeight: 56,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  filterContent: {
    padding: 12,
    gap: 8,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#333',
    marginRight: 8,
  },
  filterChipActive: {
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    borderColor: '#3b82f6',
  },
  filterChipText: {
    color: '#888',
    fontSize: 13,
  },
  filterChipTextActive: {
    color: '#fff',
  },
  filterDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  loadingState: {
    alignItems: 'center',
    padding: 32,
  },
  loadingText: {
    color: '#666',
    fontSize: 14,
  },
  emptyState: {
    alignItems: 'center',
    padding: 48,
  },
  emptyStateIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyStateText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
  },
  emptyStateSubtext: {
    color: '#666',
    fontSize: 14,
    textAlign: 'center',
  },
  stageSection: {
    marginBottom: 24,
  },
  stageSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  stageDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  stageSectionTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
  stageSectionCount: {
    color: '#666',
    fontSize: 13,
  },
  ideaCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  ideaHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  priorityIndicator: {
    width: 4,
    height: 20,
    borderRadius: 2,
    marginRight: 12,
  },
  ideaTitle: {
    flex: 1,
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 20,
  },
  ideaDescription: {
    color: '#888',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
    marginLeft: 16,
  },
  ideaMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    marginLeft: 16,
  },
  stageChip: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginRight: 8,
  },
  stageChipText: {
    fontSize: 11,
    fontWeight: '500',
  },
  tagText: {
    color: '#666',
    fontSize: 12,
  },
  ideaSource: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginLeft: 16,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#222',
  },
  sourceText: {
    color: '#666',
    fontSize: 11,
  },
  sourceDate: {
    color: '#666',
    fontSize: 11,
  },
  actionsContainer: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#222',
  },
  actionsTitle: {
    color: '#888',
    fontSize: 12,
    marginBottom: 8,
  },
  actionButton: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 8,
  },
  actionButtonText: {
    fontSize: 12,
    fontWeight: '500',
  },
})

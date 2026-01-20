import React, { useEffect, useState, useCallback, useRef } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Dimensions,
  Animated,
  PanResponder,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useIdeasStore, groupIdeasByStage, getStageInfo } from '../../stores/ideas-store'
import type { Idea, IdeaStage } from '../../types'

const { width: SCREEN_WIDTH } = Dimensions.get('window')
const COLUMN_WIDTH = SCREEN_WIDTH * 0.8

interface IdeasKanbanScreenProps {
  onBack: () => void
  onIdeaPress: (idea: Idea) => void
}

const STAGES: IdeaStage[] = ['inbox', 'reviewing', 'planning', 'ready', 'in_progress', 'done']

export function IdeasKanbanScreen({ onBack, onIdeaPress }: IdeasKanbanScreenProps) {
  const insets = useSafeAreaInsets()
  const scrollViewRef = useRef<ScrollView>(null)
  const { ideas, isLoading, loadIdeas, moveIdea, syncIdeas } = useIdeasStore()
  const [refreshing, setRefreshing] = useState(false)
  const [currentColumnIndex, setCurrentColumnIndex] = useState(0)

  useEffect(() => {
    loadIdeas()
  }, [])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await syncIdeas()
    setRefreshing(false)
  }, [])

  const groupedIdeas = groupIdeasByStage(ideas)

  const handleScroll = (event: any) => {
    const x = event.nativeEvent.contentOffset.x
    const index = Math.round(x / COLUMN_WIDTH)
    setCurrentColumnIndex(Math.min(Math.max(index, 0), STAGES.length - 1))
  }

  const scrollToColumn = (index: number) => {
    scrollViewRef.current?.scrollTo({
      x: index * COLUMN_WIDTH,
      animated: true,
    })
  }

  const handleSwipeMove = async (idea: Idea, direction: 'left' | 'right') => {
    const currentIndex = STAGES.indexOf(idea.stage)
    const newIndex = direction === 'right' ? currentIndex + 1 : currentIndex - 1

    if (newIndex >= 0 && newIndex < STAGES.length) {
      const newStage = STAGES[newIndex]
      await moveIdea(idea.id, newStage)
    }
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Ideas</Text>
        <View style={styles.headerRight}>
          <Text style={styles.ideaCount}>{ideas.length}</Text>
        </View>
      </View>

      {/* Column Indicators */}
      <View style={styles.columnIndicators}>
        {STAGES.map((stage, index) => {
          const stageInfo = getStageInfo(stage)
          const count = groupedIdeas[stage]?.length || 0
          const isActive = index === currentColumnIndex

          return (
            <TouchableOpacity
              key={stage}
              style={[
                styles.columnIndicator,
                isActive && styles.columnIndicatorActive,
              ]}
              onPress={() => scrollToColumn(index)}
            >
              <View style={[styles.indicatorDot, { backgroundColor: stageInfo.color }]} />
              <Text style={[
                styles.indicatorLabel,
                isActive && styles.indicatorLabelActive,
              ]}>
                {stageInfo.label}
              </Text>
              {count > 0 && (
                <View style={[styles.indicatorBadge, isActive && { backgroundColor: stageInfo.color }]}>
                  <Text style={styles.indicatorBadgeText}>{count}</Text>
                </View>
              )}
            </TouchableOpacity>
          )
        })}
      </View>

      {/* Kanban Columns */}
      <ScrollView
        ref={scrollViewRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        snapToInterval={COLUMN_WIDTH}
        decelerationRate="fast"
        contentContainerStyle={styles.kanbanContainer}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#3b82f6" />
        }
      >
        {STAGES.map((stage) => {
          const stageInfo = getStageInfo(stage)
          const stageIdeas = groupedIdeas[stage] || []

          return (
            <View key={stage} style={styles.column}>
              <View style={styles.columnHeader}>
                <View style={[styles.columnDot, { backgroundColor: stageInfo.color }]} />
                <Text style={styles.columnTitle}>{stageInfo.label}</Text>
                <Text style={styles.columnCount}>{stageIdeas.length}</Text>
              </View>

              <ScrollView
                style={styles.columnContent}
                contentContainerStyle={styles.columnContentContainer}
                showsVerticalScrollIndicator={false}
              >
                {stageIdeas.length === 0 ? (
                  <View style={styles.emptyColumn}>
                    <Text style={styles.emptyIcon}>○</Text>
                    <Text style={styles.emptyText}>No ideas</Text>
                  </View>
                ) : (
                  stageIdeas.map((idea) => (
                    <SwipeableIdeaCard
                      key={idea.id}
                      idea={idea}
                      onPress={() => onIdeaPress(idea)}
                      onSwipeLeft={() => handleSwipeMove(idea, 'left')}
                      onSwipeRight={() => handleSwipeMove(idea, 'right')}
                      canSwipeLeft={STAGES.indexOf(idea.stage) > 0}
                      canSwipeRight={STAGES.indexOf(idea.stage) < STAGES.length - 1}
                    />
                  ))
                )}
              </ScrollView>
            </View>
          )
        })}
      </ScrollView>

      {/* Swipe Hint */}
      <View style={[styles.swipeHint, { paddingBottom: insets.bottom + 8 }]}>
        <Text style={styles.swipeHintText}>
          ← Swipe cards to move stages →
        </Text>
      </View>
    </View>
  )
}

interface SwipeableIdeaCardProps {
  idea: Idea
  onPress: () => void
  onSwipeLeft: () => void
  onSwipeRight: () => void
  canSwipeLeft: boolean
  canSwipeRight: boolean
}

function SwipeableIdeaCard({
  idea,
  onPress,
  onSwipeLeft,
  onSwipeRight,
  canSwipeLeft,
  canSwipeRight,
}: SwipeableIdeaCardProps) {
  const pan = useRef(new Animated.ValueXY()).current
  const SWIPE_THRESHOLD = 80

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return Math.abs(gestureState.dx) > 10 && Math.abs(gestureState.dy) < 30
      },
      onPanResponderMove: (_, gestureState) => {
        // Limit movement based on available directions
        let dx = gestureState.dx
        if (dx > 0 && !canSwipeRight) dx = 0
        if (dx < 0 && !canSwipeLeft) dx = 0

        pan.setValue({ x: dx * 0.5, y: 0 })
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dx > SWIPE_THRESHOLD && canSwipeRight) {
          onSwipeRight()
        } else if (gestureState.dx < -SWIPE_THRESHOLD && canSwipeLeft) {
          onSwipeLeft()
        }

        Animated.spring(pan, {
          toValue: { x: 0, y: 0 },
          useNativeDriver: false,
        }).start()
      },
    })
  ).current

  const getPriorityColor = (priority: Idea['priority']) => {
    switch (priority) {
      case 'urgent': return '#ef4444'
      case 'high': return '#f59e0b'
      case 'medium': return '#3b82f6'
      default: return '#666'
    }
  }

  return (
    <Animated.View
      style={[
        styles.cardWrapper,
        { transform: [{ translateX: pan.x }] },
      ]}
      {...panResponder.panHandlers}
    >
      <TouchableOpacity
        style={styles.ideaCard}
        onPress={onPress}
        activeOpacity={0.9}
      >
        <View style={styles.ideaHeader}>
          <View style={[styles.priorityBar, { backgroundColor: getPriorityColor(idea.priority) }]} />
          <Text style={styles.ideaTitle} numberOfLines={2}>
            {idea.title}
          </Text>
        </View>

        {idea.description && (
          <Text style={styles.ideaDescription} numberOfLines={2}>
            {idea.description}
          </Text>
        )}

        <View style={styles.ideaMeta}>
          {idea.tags.slice(0, 2).map((tag, index) => (
            <View key={index} style={styles.tag}>
              <Text style={styles.tagText}>{tag}</Text>
            </View>
          ))}
          {idea.tags.length > 2 && (
            <Text style={styles.moreTags}>+{idea.tags.length - 2}</Text>
          )}
        </View>

        <View style={styles.ideaFooter}>
          <Text style={styles.sourceText}>
            {idea.emailSource.from.split('@')[0]}
          </Text>
          <Text style={styles.dateText}>
            {formatDate(idea.createdAt)}
          </Text>
        </View>

        {idea.discussionHistory.length > 0 && (
          <View style={styles.discussionIndicator}>
            <Text style={styles.discussionIcon}>💬</Text>
            <Text style={styles.discussionCount}>{idea.discussionHistory.length}</Text>
          </View>
        )}
      </TouchableOpacity>
    </Animated.View>
  )
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const diff = now.getTime() - date.getTime()

  if (diff < 86400000) return 'Today'
  if (diff < 172800000) return 'Yesterday'
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 16,
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
  title: {
    flex: 1,
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  headerRight: {
    backgroundColor: '#1a1a1a',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  ideaCount: {
    color: '#888',
    fontSize: 13,
    fontWeight: '600',
  },
  columnIndicators: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  columnIndicator: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
    opacity: 0.5,
  },
  columnIndicatorActive: {
    opacity: 1,
  },
  indicatorDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 4,
  },
  indicatorLabel: {
    color: '#666',
    fontSize: 10,
    fontWeight: '500',
  },
  indicatorLabelActive: {
    color: '#fff',
  },
  indicatorBadge: {
    backgroundColor: '#333',
    paddingHorizontal: 4,
    borderRadius: 6,
    marginLeft: 4,
  },
  indicatorBadgeText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: 'bold',
  },
  kanbanContainer: {
    paddingHorizontal: (SCREEN_WIDTH - COLUMN_WIDTH) / 2,
  },
  column: {
    width: COLUMN_WIDTH,
    paddingHorizontal: 8,
  },
  columnHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  columnDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  columnTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
    flex: 1,
  },
  columnCount: {
    color: '#666',
    fontSize: 13,
  },
  columnContent: {
    flex: 1,
  },
  columnContentContainer: {
    paddingBottom: 16,
  },
  emptyColumn: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 32,
    alignItems: 'center',
    opacity: 0.5,
  },
  emptyIcon: {
    color: '#444',
    fontSize: 24,
    marginBottom: 8,
  },
  emptyText: {
    color: '#666',
    fontSize: 13,
  },
  cardWrapper: {
    marginBottom: 10,
  },
  ideaCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 14,
    position: 'relative',
  },
  ideaHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  priorityBar: {
    width: 3,
    height: 16,
    borderRadius: 2,
    marginRight: 10,
    marginTop: 2,
  },
  ideaTitle: {
    flex: 1,
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 18,
  },
  ideaDescription: {
    color: '#888',
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 10,
    marginLeft: 13,
  },
  ideaMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    marginLeft: 13,
  },
  tag: {
    backgroundColor: '#0a0a0a',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    marginRight: 6,
  },
  tagText: {
    color: '#666',
    fontSize: 10,
  },
  moreTags: {
    color: '#666',
    fontSize: 10,
  },
  ideaFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginLeft: 13,
  },
  sourceText: {
    color: '#666',
    fontSize: 11,
  },
  dateText: {
    color: '#666',
    fontSize: 11,
  },
  discussionIndicator: {
    position: 'absolute',
    top: 10,
    right: 10,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  discussionIcon: {
    fontSize: 10,
    marginRight: 3,
  },
  discussionCount: {
    color: '#3b82f6',
    fontSize: 10,
    fontWeight: '600',
  },
  swipeHint: {
    alignItems: 'center',
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#222',
  },
  swipeHintText: {
    color: '#444',
    fontSize: 11,
  },
})

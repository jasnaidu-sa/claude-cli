import React, { useRef } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Dimensions,
} from 'react-native'
import type { RalphFeature } from '../types'

interface FeatureKanbanProps {
  features: RalphFeature[]
  currentFeatureId: string | null
  onFeaturePress?: (feature: RalphFeature) => void
}

type FeatureStatus = RalphFeature['status']

const COLUMNS: { status: FeatureStatus; label: string; color: string }[] = [
  { status: 'pending', label: 'Pending', color: '#666' },
  { status: 'in_progress', label: 'In Progress', color: '#3b82f6' },
  { status: 'passed', label: 'Passed', color: '#22c55e' },
  { status: 'failed', label: 'Failed', color: '#ef4444' },
  { status: 'skipped', label: 'Skipped', color: '#888' },
]

const COLUMN_WIDTH = Dimensions.get('window').width * 0.75

export function FeatureKanban({
  features,
  currentFeatureId,
  onFeaturePress,
}: FeatureKanbanProps) {
  const scrollViewRef = useRef<ScrollView>(null)

  // Group features by status
  const groupedFeatures = COLUMNS.reduce((acc, column) => {
    acc[column.status] = features.filter(f => f.status === column.status)
    return acc
  }, {} as Record<FeatureStatus, RalphFeature[]>)

  // Auto-scroll to the column with current feature
  React.useEffect(() => {
    if (currentFeatureId) {
      const feature = features.find(f => f.id === currentFeatureId)
      if (feature) {
        const columnIndex = COLUMNS.findIndex(c => c.status === feature.status)
        if (columnIndex > 0) {
          scrollViewRef.current?.scrollTo({
            x: columnIndex * COLUMN_WIDTH,
            animated: true,
          })
        }
      }
    }
  }, [currentFeatureId])

  return (
    <ScrollView
      ref={scrollViewRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      pagingEnabled
      snapToInterval={COLUMN_WIDTH}
      decelerationRate="fast"
      contentContainerStyle={styles.container}
    >
      {COLUMNS.map(column => {
        const columnFeatures = groupedFeatures[column.status]
        if (columnFeatures.length === 0 && column.status === 'skipped') {
          return null // Don't show empty skipped column
        }

        return (
          <View key={column.status} style={styles.column}>
            {/* Column Header */}
            <View style={styles.columnHeader}>
              <View style={[styles.columnDot, { backgroundColor: column.color }]} />
              <Text style={styles.columnTitle}>{column.label}</Text>
              <View style={[styles.countBadge, { backgroundColor: column.color }]}>
                <Text style={styles.countText}>{columnFeatures.length}</Text>
              </View>
            </View>

            {/* Features */}
            <ScrollView
              style={styles.columnContent}
              showsVerticalScrollIndicator={false}
            >
              {columnFeatures.length === 0 ? (
                <View style={styles.emptyColumn}>
                  <Text style={styles.emptyText}>No features</Text>
                </View>
              ) : (
                columnFeatures.map(feature => (
                  <FeatureCard
                    key={feature.id}
                    feature={feature}
                    isActive={feature.id === currentFeatureId}
                    statusColor={column.color}
                    onPress={() => onFeaturePress?.(feature)}
                  />
                ))
              )}
            </ScrollView>
          </View>
        )
      })}
    </ScrollView>
  )
}

interface FeatureCardProps {
  feature: RalphFeature
  isActive: boolean
  statusColor: string
  onPress: () => void
}

function FeatureCard({ feature, isActive, statusColor, onPress }: FeatureCardProps) {
  return (
    <TouchableOpacity
      style={[
        styles.featureCard,
        isActive && styles.featureCardActive,
        isActive && { borderColor: statusColor },
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.featureHeader}>
        <Text style={styles.featureName} numberOfLines={2}>
          {feature.name}
        </Text>
        {isActive && (
          <View style={[styles.activeBadge, { backgroundColor: statusColor }]}>
            <Text style={styles.activeBadgeText}>Active</Text>
          </View>
        )}
      </View>

      {feature.description && (
        <Text style={styles.featureDescription} numberOfLines={2}>
          {feature.description}
        </Text>
      )}

      <View style={styles.featureMeta}>
        <Text style={styles.featureCategory}>{feature.category}</Text>
        {feature.attempts > 1 && (
          <Text style={styles.featureAttempts}>
            {feature.attempts} attempt{feature.attempts > 1 ? 's' : ''}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 8,
    paddingVertical: 16,
  },
  column: {
    width: COLUMN_WIDTH,
    marginHorizontal: 8,
  },
  columnHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
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
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
  countBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  countText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: 'bold',
  },
  columnContent: {
    flex: 1,
  },
  emptyColumn: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    opacity: 0.5,
  },
  emptyText: {
    color: '#666',
    fontSize: 13,
  },
  featureCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  featureCardActive: {
    borderWidth: 2,
  },
  featureHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  featureName: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
    lineHeight: 18,
  },
  activeBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    marginLeft: 8,
  },
  activeBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: 'bold',
  },
  featureDescription: {
    color: '#888',
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 8,
  },
  featureMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  featureCategory: {
    color: '#666',
    fontSize: 11,
    backgroundColor: '#0a0a0a',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  featureAttempts: {
    color: '#f59e0b',
    fontSize: 10,
  },
})

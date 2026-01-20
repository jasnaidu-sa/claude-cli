import React, { useState, useRef, useEffect } from 'react'
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
} from 'react-native'
import type { MergeConflict, ConflictResolutionStrategy } from '../types'

interface MergeConflictCardProps {
  conflict: MergeConflict
  onApprove: (conflictId: string, strategy?: ConflictResolutionStrategy) => Promise<void>
  onReject: (conflictId: string, reason?: string) => Promise<void>
  expanded?: boolean
}

/**
 * Get color for confidence level
 */
function getConfidenceColor(confidence: number): string {
  if (confidence >= 0.9) return '#22c55e' // high confidence - green
  if (confidence >= 0.7) return '#f59e0b' // medium confidence - amber
  return '#ef4444' // low confidence - red
}

/**
 * Get label for confidence level
 */
function getConfidenceLabel(confidence: number): string {
  if (confidence >= 0.9) return 'High'
  if (confidence >= 0.7) return 'Medium'
  return 'Low'
}

/**
 * Get color for status
 */
function getStatusColor(status: MergeConflict['status']): string {
  switch (status) {
    case 'ai_resolved':
      return '#3b82f6' // blue
    case 'user_approved':
      return '#22c55e' // green
    case 'user_rejected':
      return '#ef4444' // red
    case 'pending':
    default:
      return '#f59e0b' // amber
  }
}

export function MergeConflictCard({
  conflict,
  onApprove,
  onReject,
  expanded: initialExpanded = false,
}: MergeConflictCardProps) {
  const [expanded, setExpanded] = useState(initialExpanded)
  const [isLoading, setIsLoading] = useState(false)

  // P1 FIX: Use ref to prevent double-execution from rapid taps
  const isLoadingRef = useRef(false)
  // P1 FIX: Track mount state to prevent state updates after unmount
  const isMountedRef = useRef(true)

  useEffect(() => {
    return () => {
      isMountedRef.current = false
    }
  }, [])

  const fileName = conflict.filePath.split(/[\\/]/).pop() || conflict.filePath
  const statusColor = getStatusColor(conflict.status)
  // P0 FIX: Use nullish check with explicit variable
  const aiResolution = conflict.aiResolution
  const hasAiResolution = aiResolution !== undefined

  const handleApprove = async () => {
    // P1 FIX: Synchronous check with ref to prevent race condition
    if (isLoadingRef.current) return
    isLoadingRef.current = true
    setIsLoading(true)
    try {
      await onApprove(conflict.id, aiResolution?.strategy)
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false)
      }
      isLoadingRef.current = false
    }
  }

  const handleReject = () => {
    Alert.prompt(
      'Reject Resolution',
      'Optionally provide a reason for rejection:',
      async (reason?: string) => {
        // P1 FIX: Check both ref and mount state
        if (isLoadingRef.current || !isMountedRef.current) return
        isLoadingRef.current = true
        setIsLoading(true)
        try {
          await onReject(conflict.id, reason)
        } finally {
          if (isMountedRef.current) {
            setIsLoading(false)
          }
          isLoadingRef.current = false
        }
      },
      'plain-text',
      '',
      'default'
    )
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <TouchableOpacity
        style={styles.header}
        onPress={() => setExpanded(!expanded)}
        activeOpacity={0.7}
      >
        <View style={styles.headerLeft}>
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          <View style={styles.fileInfo}>
            <Text style={styles.fileName} numberOfLines={1}>
              {fileName}
            </Text>
            <Text style={styles.filePath} numberOfLines={1}>
              {conflict.filePath}
            </Text>
          </View>
        </View>
        <View style={styles.headerRight}>
          {hasAiResolution && aiResolution && (
            <View
              style={[
                styles.confidenceBadge,
                { backgroundColor: getConfidenceColor(aiResolution.confidence) },
              ]}
            >
              <Text style={styles.confidenceText}>
                {getConfidenceLabel(aiResolution.confidence)}
              </Text>
            </View>
          )}
          <Text style={styles.expandIcon}>{expanded ? '▼' : '▶'}</Text>
        </View>
      </TouchableOpacity>

      {/* Expanded Content */}
      {expanded && (
        <View style={styles.content}>
          {/* Conflict Markers Summary */}
          <View style={styles.markersSummary}>
            <Text style={styles.markersLabel}>
              {conflict.markers.length} conflict{conflict.markers.length !== 1 ? 's' : ''} in file
            </Text>
          </View>

          {/* AI Resolution Explanation */}
          {hasAiResolution && aiResolution && (
            <View style={styles.resolutionSection}>
              <Text style={styles.sectionTitle}>AI Resolution</Text>
              <View style={styles.strategyBadge}>
                <Text style={styles.strategyText}>
                  Strategy: {aiResolution.strategy.replace('_', ' ')}
                </Text>
              </View>
              <Text style={styles.explanation}>{aiResolution.explanation}</Text>

              {/* Confidence Details */}
              <View style={styles.confidenceDetails}>
                <Text style={styles.confidenceDetailLabel}>Confidence:</Text>
                <View style={styles.confidenceBar}>
                  <View
                    style={[
                      styles.confidenceFill,
                      {
                        width: `${aiResolution.confidence * 100}%`,
                        backgroundColor: getConfidenceColor(aiResolution.confidence),
                      },
                    ]}
                  />
                </View>
                <Text style={styles.confidencePercent}>
                  {Math.round(aiResolution.confidence * 100)}%
                </Text>
              </View>
            </View>
          )}

          {/* Conflict Details - First marker preview */}
          {conflict.markers.length > 0 && (
            <View style={styles.diffSection}>
              <Text style={styles.sectionTitle}>Conflict Preview</Text>
              <View style={styles.diffContainer}>
                <View style={styles.diffSide}>
                  <Text style={styles.diffLabel}>Ours (current)</Text>
                  <ScrollView
                    style={styles.diffContent}
                    horizontal
                    showsHorizontalScrollIndicator={false}
                  >
                    <Text style={styles.diffCode}>
                      {conflict.markers[0].ourContent.slice(0, 200)}
                      {conflict.markers[0].ourContent.length > 200 ? '...' : ''}
                    </Text>
                  </ScrollView>
                </View>
                <View style={styles.diffDivider} />
                <View style={styles.diffSide}>
                  <Text style={[styles.diffLabel, { color: '#ef4444' }]}>Theirs (incoming)</Text>
                  <ScrollView
                    style={styles.diffContent}
                    horizontal
                    showsHorizontalScrollIndicator={false}
                  >
                    <Text style={styles.diffCode}>
                      {conflict.markers[0].theirContent.slice(0, 200)}
                      {conflict.markers[0].theirContent.length > 200 ? '...' : ''}
                    </Text>
                  </ScrollView>
                </View>
              </View>
            </View>
          )}

          {/* Action Buttons */}
          {conflict.status === 'ai_resolved' && (
            <View style={styles.actions}>
              <TouchableOpacity
                style={[styles.actionButton, styles.approveButton]}
                onPress={handleApprove}
                disabled={isLoading}
              >
                <Text style={styles.approveButtonText}>
                  {isLoading ? 'Processing...' : '✓ Approve Resolution'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionButton, styles.rejectButton]}
                onPress={handleReject}
                disabled={isLoading}
              >
                <Text style={styles.rejectButtonText}>✗ Reject</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Status Badge for resolved conflicts */}
          {conflict.status === 'user_approved' && (
            <View style={styles.statusBanner}>
              <Text style={styles.statusBannerText}>✓ Resolution Approved</Text>
            </View>
          )}
          {conflict.status === 'user_rejected' && (
            <View style={[styles.statusBanner, { backgroundColor: 'rgba(239, 68, 68, 0.1)' }]}>
              <Text style={[styles.statusBannerText, { color: '#ef4444' }]}>
                ✗ Resolution Rejected
              </Text>
            </View>
          )}
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    marginBottom: 12,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 12,
  },
  fileInfo: {
    flex: 1,
  },
  fileName: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  filePath: {
    color: '#666',
    fontSize: 11,
    marginTop: 2,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  confidenceBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    marginRight: 8,
  },
  confidenceText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
  expandIcon: {
    color: '#666',
    fontSize: 12,
  },
  content: {
    padding: 16,
    paddingTop: 0,
  },
  markersSummary: {
    marginBottom: 12,
  },
  markersLabel: {
    color: '#888',
    fontSize: 12,
  },
  resolutionSection: {
    backgroundColor: '#0a0a0a',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  sectionTitle: {
    color: '#888',
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  strategyBadge: {
    backgroundColor: '#333',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignSelf: 'flex-start',
    marginBottom: 8,
  },
  strategyText: {
    color: '#fff',
    fontSize: 12,
    textTransform: 'capitalize',
  },
  explanation: {
    color: '#ccc',
    fontSize: 13,
    lineHeight: 18,
  },
  confidenceDetails: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
  },
  confidenceDetailLabel: {
    color: '#888',
    fontSize: 12,
    marginRight: 8,
  },
  confidenceBar: {
    flex: 1,
    height: 6,
    backgroundColor: '#333',
    borderRadius: 3,
    overflow: 'hidden',
  },
  confidenceFill: {
    height: '100%',
    borderRadius: 3,
  },
  confidencePercent: {
    color: '#888',
    fontSize: 12,
    marginLeft: 8,
    width: 40,
    textAlign: 'right',
  },
  diffSection: {
    marginBottom: 12,
  },
  diffContainer: {
    backgroundColor: '#0a0a0a',
    borderRadius: 8,
    overflow: 'hidden',
  },
  diffSide: {
    padding: 8,
  },
  diffLabel: {
    color: '#22c55e',
    fontSize: 10,
    fontWeight: '600',
    marginBottom: 4,
  },
  diffContent: {
    maxHeight: 80,
  },
  diffCode: {
    color: '#ccc',
    fontSize: 11,
    fontFamily: 'monospace',
  },
  diffDivider: {
    height: 1,
    backgroundColor: '#333',
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionButton: {
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
    fontSize: 14,
  },
  rejectButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#ef4444',
  },
  rejectButtonText: {
    color: '#ef4444',
    fontWeight: '600',
    fontSize: 14,
  },
  statusBanner: {
    backgroundColor: 'rgba(34, 197, 94, 0.1)',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
  },
  statusBannerText: {
    color: '#22c55e',
    fontWeight: '600',
    fontSize: 14,
  },
})

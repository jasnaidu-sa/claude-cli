import React, { useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { RalphCheckpoint } from '../types'

interface CheckpointModalProps {
  visible: boolean
  checkpoint: RalphCheckpoint | null
  onApprove: (comment?: string) => Promise<void>
  onSkip: (comment?: string) => Promise<void>
  onReject: (comment?: string) => Promise<void>
  onClose: () => void
}

export function CheckpointModal({
  visible,
  checkpoint,
  onApprove,
  onSkip,
  onReject,
  onClose,
}: CheckpointModalProps) {
  const insets = useSafeAreaInsets()
  const [comment, setComment] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [loadingAction, setLoadingAction] = useState<'approve' | 'skip' | 'reject' | null>(null)

  const handleAction = async (action: 'approve' | 'skip' | 'reject') => {
    setIsLoading(true)
    setLoadingAction(action)

    try {
      switch (action) {
        case 'approve':
          await onApprove(comment || undefined)
          break
        case 'skip':
          await onSkip(comment || undefined)
          break
        case 'reject':
          await onReject(comment || undefined)
          break
      }
      setComment('')
      onClose()
    } finally {
      setIsLoading(false)
      setLoadingAction(null)
    }
  }

  if (!checkpoint) return null

  const getTypeColor = (type: RalphCheckpoint['type']) => {
    switch (type) {
      case 'approval': return '#f59e0b'
      case 'review': return '#3b82f6'
      case 'decision': return '#8b5cf6'
      default: return '#666'
    }
  }

  const getTypeLabel = (type: RalphCheckpoint['type']) => {
    switch (type) {
      case 'approval': return 'Approval Required'
      case 'review': return 'Review Requested'
      case 'decision': return 'Decision Needed'
      default: return type
    }
  }

  const typeColor = getTypeColor(checkpoint.type)

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {/* Header */}
        <View style={styles.header}>
          <View style={[styles.typeIndicator, { backgroundColor: typeColor }]} />
          <View style={styles.headerContent}>
            <Text style={styles.typeLabel}>{getTypeLabel(checkpoint.type)}</Text>
            <Text style={styles.timestamp}>
              {formatTime(checkpoint.createdAt)}
            </Text>
          </View>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Text style={styles.closeButtonText}>×</Text>
          </TouchableOpacity>
        </View>

        {/* Content */}
        <ScrollView
          style={styles.content}
          contentContainerStyle={styles.contentContainer}
        >
          {/* Title */}
          <Text style={styles.title}>{checkpoint.title}</Text>

          {/* Description */}
          <View style={styles.descriptionCard}>
            <Text style={styles.description}>{checkpoint.description}</Text>
          </View>

          {/* Options (if any) */}
          {checkpoint.options && checkpoint.options.length > 0 && (
            <View style={styles.optionsSection}>
              <Text style={styles.sectionLabel}>Options</Text>
              {checkpoint.options.map((option, index) => (
                <View key={index} style={styles.optionItem}>
                  <View style={styles.optionNumber}>
                    <Text style={styles.optionNumberText}>{index + 1}</Text>
                  </View>
                  <Text style={styles.optionText}>{option}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Comment Input */}
          <View style={styles.commentSection}>
            <Text style={styles.sectionLabel}>Add a comment (optional)</Text>
            <TextInput
              style={styles.commentInput}
              value={comment}
              onChangeText={setComment}
              placeholder="Your feedback or notes..."
              placeholderTextColor="#666"
              multiline
              maxLength={500}
              editable={!isLoading}
            />
          </View>

          {/* Risk Warning for approval type */}
          {checkpoint.type === 'approval' && (
            <View style={styles.warningCard}>
              <Text style={styles.warningTitle}>Review carefully</Text>
              <Text style={styles.warningText}>
                This checkpoint requires your explicit approval before the session can continue.
              </Text>
            </View>
          )}
        </ScrollView>

        {/* Actions */}
        <View style={[styles.actions, { paddingBottom: insets.bottom + 16 }]}>
          {checkpoint.requiresResponse && (
            <>
              <TouchableOpacity
                style={[styles.actionButton, styles.rejectButton]}
                onPress={() => handleAction('reject')}
                disabled={isLoading}
              >
                {loadingAction === 'reject' ? (
                  <ActivityIndicator size="small" color="#ef4444" />
                ) : (
                  <Text style={styles.rejectButtonText}>Reject</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.actionButton, styles.skipButton]}
                onPress={() => handleAction('skip')}
                disabled={isLoading}
              >
                {loadingAction === 'skip' ? (
                  <ActivityIndicator size="small" color="#888" />
                ) : (
                  <Text style={styles.skipButtonText}>Skip</Text>
                )}
              </TouchableOpacity>
            </>
          )}

          <TouchableOpacity
            style={[
              styles.actionButton,
              styles.approveButton,
              !checkpoint.requiresResponse && styles.approveButtonFull,
            ]}
            onPress={() => handleAction('approve')}
            disabled={isLoading}
          >
            {loadingAction === 'approve' ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.approveButtonText}>
                {checkpoint.requiresResponse ? 'Approve' : 'Acknowledge'}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  )
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
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
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  typeIndicator: {
    width: 4,
    height: 40,
    borderRadius: 2,
    marginRight: 12,
  },
  headerContent: {
    flex: 1,
  },
  typeLabel: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  timestamp: {
    color: '#666',
    fontSize: 12,
    marginTop: 2,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#1a1a1a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButtonText: {
    color: '#888',
    fontSize: 24,
    lineHeight: 28,
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
  },
  title: {
    color: '#fff',
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 16,
    lineHeight: 28,
  },
  descriptionCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
  },
  description: {
    color: '#ccc',
    fontSize: 15,
    lineHeight: 22,
  },
  optionsSection: {
    marginBottom: 24,
  },
  sectionLabel: {
    color: '#888',
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  optionItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#1a1a1a',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  optionNumber: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#333',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  optionNumberText: {
    color: '#888',
    fontSize: 12,
    fontWeight: 'bold',
  },
  optionText: {
    flex: 1,
    color: '#ccc',
    fontSize: 14,
    lineHeight: 20,
  },
  commentSection: {
    marginBottom: 24,
  },
  commentInput: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
    color: '#fff',
    fontSize: 14,
    minHeight: 100,
    textAlignVertical: 'top',
  },
  warningCard: {
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.2)',
    borderRadius: 12,
    padding: 16,
  },
  warningTitle: {
    color: '#f59e0b',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
  },
  warningText: {
    color: '#888',
    fontSize: 13,
    lineHeight: 18,
  },
  actions: {
    flexDirection: 'row',
    padding: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#222',
    gap: 10,
  },
  actionButton: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rejectButton: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  rejectButtonText: {
    color: '#ef4444',
    fontSize: 14,
    fontWeight: '600',
  },
  skipButton: {
    backgroundColor: '#1a1a1a',
  },
  skipButtonText: {
    color: '#888',
    fontSize: 14,
    fontWeight: '600',
  },
  approveButton: {
    backgroundColor: '#22c55e',
  },
  approveButtonFull: {
    flex: 3,
  },
  approveButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
})

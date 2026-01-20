import React from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useInitiatorStore } from '../../stores/initiator-store'

interface RequirementsSummaryScreenProps {
  onBack: () => void
  onContinue: () => void
  onEditRequirements: () => void
}

export function RequirementsSummaryScreen({
  onBack,
  onContinue,
  onEditRequirements,
}: RequirementsSummaryScreenProps) {
  const insets = useSafeAreaInsets()
  const { session, requirements } = useInitiatorStore()

  const projectName = session?.projectPath.split(/[\\/]/).pop() || 'Unknown Project'

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <View style={styles.headerContent}>
          <Text style={styles.headerTitle}>Requirements</Text>
          <Text style={styles.headerSubtitle}>{projectName}</Text>
        </View>
        <TouchableOpacity onPress={onEditRequirements} style={styles.editButton}>
          <Text style={styles.editButtonText}>Edit</Text>
        </TouchableOpacity>
      </View>

      {/* Content */}
      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
      >
        {/* Summary Stats */}
        <View style={styles.statsCard}>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{requirements.length}</Text>
            <Text style={styles.statLabel}>Requirements</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.stat}>
            <Text style={styles.statValue}>{session?.messages.length || 0}</Text>
            <Text style={styles.statLabel}>Messages</Text>
          </View>
        </View>

        {/* Requirements List */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Gathered Requirements</Text>
          {requirements.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>
                No requirements gathered yet. Continue the conversation to define what you want to build.
              </Text>
            </View>
          ) : (
            requirements.map((requirement, index) => (
              <View key={index} style={styles.requirementItem}>
                <View style={styles.requirementNumber}>
                  <Text style={styles.requirementNumberText}>{index + 1}</Text>
                </View>
                <Text style={styles.requirementText}>{requirement}</Text>
              </View>
            ))
          )}
        </View>

        {/* Messages Summary */}
        {session && session.messages.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Conversation Summary</Text>
            <View style={styles.conversationPreview}>
              {session.messages.slice(-3).map((msg, index) => (
                <View key={index} style={styles.previewMessage}>
                  <Text style={styles.previewRole}>
                    {msg.role === 'user' ? 'You' : 'Assistant'}:
                  </Text>
                  <Text style={styles.previewContent} numberOfLines={2}>
                    {msg.content}
                  </Text>
                </View>
              ))}
              {session.messages.length > 3 && (
                <Text style={styles.moreMessages}>
                  +{session.messages.length - 3} more messages
                </Text>
              )}
            </View>
          </View>
        )}
      </ScrollView>

      {/* Footer Actions */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <TouchableOpacity style={styles.addMoreButton} onPress={onBack}>
          <Text style={styles.addMoreButtonText}>Add More Details</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.continueButton,
            requirements.length === 0 && styles.continueButtonDisabled,
          ]}
          onPress={onContinue}
          disabled={requirements.length === 0}
        >
          <Text style={styles.continueButtonText}>Review Prompt →</Text>
        </TouchableOpacity>
      </View>
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
  headerContent: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  headerSubtitle: {
    color: '#666',
    fontSize: 12,
    marginTop: 2,
  },
  editButton: {
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  editButtonText: {
    color: '#3b82f6',
    fontSize: 14,
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
  },
  statsCard: {
    flexDirection: 'row',
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 20,
    marginBottom: 24,
  },
  stat: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    color: '#fff',
    fontSize: 32,
    fontWeight: 'bold',
  },
  statLabel: {
    color: '#666',
    fontSize: 12,
    marginTop: 4,
  },
  statDivider: {
    width: 1,
    backgroundColor: '#333',
    marginHorizontal: 20,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    color: '#888',
    fontSize: 14,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  emptyState: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
  },
  emptyText: {
    color: '#666',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  requirementItem: {
    flexDirection: 'row',
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
  },
  requirementNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#3b82f6',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  requirementNumberText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  requirementText: {
    flex: 1,
    color: '#ddd',
    fontSize: 14,
    lineHeight: 20,
  },
  conversationPreview: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
  },
  previewMessage: {
    marginBottom: 12,
  },
  previewRole: {
    color: '#666',
    fontSize: 11,
    marginBottom: 2,
  },
  previewContent: {
    color: '#aaa',
    fontSize: 13,
    lineHeight: 18,
  },
  moreMessages: {
    color: '#666',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 8,
  },
  footer: {
    flexDirection: 'row',
    padding: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#222',
    gap: 12,
  },
  addMoreButton: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#333',
    alignItems: 'center',
  },
  addMoreButtonText: {
    color: '#888',
    fontSize: 14,
    fontWeight: '600',
  },
  continueButton: {
    flex: 2,
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#3b82f6',
    alignItems: 'center',
  },
  continueButtonDisabled: {
    backgroundColor: '#1e3a5f',
    opacity: 0.5,
  },
  continueButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
})

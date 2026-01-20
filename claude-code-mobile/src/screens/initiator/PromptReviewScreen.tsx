import React, { useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useInitiatorStore } from '../../stores/initiator-store'

interface PromptReviewScreenProps {
  onBack: () => void
  onSessionStarted: (sessionId: string) => void
}

export function PromptReviewScreen({
  onBack,
  onSessionStarted,
}: PromptReviewScreenProps) {
  const insets = useSafeAreaInsets()
  const {
    session,
    generatedPrompt,
    requirements,
    isLoading,
    error,
    approveAndStart,
  } = useInitiatorStore()

  const [editedPrompt, setEditedPrompt] = useState(generatedPrompt || '')
  const [isEditing, setIsEditing] = useState(false)

  const projectName = session?.projectPath.split(/[\\/]/).pop() || 'Unknown Project'

  const handleApprove = async () => {
    Alert.alert(
      'Start Ralph Loop',
      'This will start the automated development session. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Start',
          onPress: async () => {
            const sessionId = await approveAndStart(editedPrompt)
            if (sessionId) {
              onSessionStarted(sessionId)
            }
          },
        },
      ]
    )
  }

  const handleReset = () => {
    setEditedPrompt(generatedPrompt || '')
    setIsEditing(false)
  }

  const hasChanges = editedPrompt !== generatedPrompt

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <View style={styles.headerContent}>
          <Text style={styles.headerTitle}>Review Prompt</Text>
          <Text style={styles.headerSubtitle}>{projectName}</Text>
        </View>
        {hasChanges && (
          <TouchableOpacity onPress={handleReset} style={styles.resetButton}>
            <Text style={styles.resetButtonText}>Reset</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Content */}
      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
        keyboardShouldPersistTaps="handled"
      >
        {/* Requirements Summary */}
        <View style={styles.requirementsSummary}>
          <Text style={styles.summaryLabel}>Based on {requirements.length} requirements</Text>
          <TouchableOpacity onPress={onBack}>
            <Text style={styles.viewAllLink}>View all</Text>
          </TouchableOpacity>
        </View>

        {/* Prompt Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Generated Prompt</Text>
            <TouchableOpacity onPress={() => setIsEditing(!isEditing)}>
              <Text style={styles.editLink}>
                {isEditing ? 'Done' : 'Edit'}
              </Text>
            </TouchableOpacity>
          </View>

          {isEditing ? (
            <TextInput
              style={styles.promptEditor}
              value={editedPrompt}
              onChangeText={setEditedPrompt}
              multiline
              autoFocus
              placeholder="Enter the prompt for Ralph Loop..."
              placeholderTextColor="#666"
            />
          ) : (
            <View style={styles.promptPreview}>
              <Text style={styles.promptText}>{editedPrompt}</Text>
            </View>
          )}

          {hasChanges && (
            <View style={styles.changesIndicator}>
              <Text style={styles.changesText}>Modified from original</Text>
            </View>
          )}
        </View>

        {/* Configuration Preview */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Configuration</Text>
          <View style={styles.configCard}>
            <View style={styles.configRow}>
              <Text style={styles.configLabel}>Project</Text>
              <Text style={styles.configValue}>{projectName}</Text>
            </View>
            <View style={styles.configRow}>
              <Text style={styles.configLabel}>Mode</Text>
              <Text style={styles.configValue}>Ralph Loop</Text>
            </View>
            <View style={styles.configRow}>
              <Text style={styles.configLabel}>Checkpoints</Text>
              <Text style={styles.configValue}>Enabled</Text>
            </View>
          </View>
        </View>

        {/* Warning */}
        <View style={styles.warningCard}>
          <Text style={styles.warningTitle}>Before you start</Text>
          <Text style={styles.warningText}>
            • Ensure the project is in a clean git state{'\n'}
            • The session will run on your desktop{'\n'}
            • You can pause/stop from this app anytime{'\n'}
            • Checkpoints will require your approval
          </Text>
        </View>

        {/* Error Display */}
        {error && (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}
      </ScrollView>

      {/* Footer Actions */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <TouchableOpacity style={styles.backToEditButton} onPress={onBack}>
          <Text style={styles.backToEditButtonText}>← Requirements</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.approveButton, isLoading && styles.approveButtonDisabled]}
          onPress={handleApprove}
          disabled={isLoading || !editedPrompt.trim()}
        >
          {isLoading ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.approveButtonText}>Approve & Start ▶</Text>
          )}
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
  resetButton: {
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  resetButtonText: {
    color: '#f59e0b',
    fontSize: 14,
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
  },
  requirementsSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  summaryLabel: {
    color: '#888',
    fontSize: 13,
  },
  viewAllLink: {
    color: '#3b82f6',
    fontSize: 13,
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    color: '#888',
    fontSize: 14,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  editLink: {
    color: '#3b82f6',
    fontSize: 14,
  },
  promptEditor: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
    color: '#fff',
    fontSize: 14,
    lineHeight: 22,
    minHeight: 200,
    textAlignVertical: 'top',
    borderWidth: 1,
    borderColor: '#3b82f6',
  },
  promptPreview: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
  },
  promptText: {
    color: '#ddd',
    fontSize: 14,
    lineHeight: 22,
  },
  changesIndicator: {
    marginTop: 8,
    paddingHorizontal: 8,
  },
  changesText: {
    color: '#f59e0b',
    fontSize: 12,
    fontStyle: 'italic',
  },
  configCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
  },
  configRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  configLabel: {
    color: '#666',
    fontSize: 14,
  },
  configValue: {
    color: '#fff',
    fontSize: 14,
  },
  warningCard: {
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.2)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  warningTitle: {
    color: '#f59e0b',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  warningText: {
    color: '#888',
    fontSize: 13,
    lineHeight: 20,
  },
  errorCard: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.2)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  errorText: {
    color: '#ef4444',
    fontSize: 14,
  },
  footer: {
    flexDirection: 'row',
    padding: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#222',
    gap: 12,
  },
  backToEditButton: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#333',
    alignItems: 'center',
  },
  backToEditButtonText: {
    color: '#888',
    fontSize: 14,
    fontWeight: '600',
  },
  approveButton: {
    flex: 2,
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#22c55e',
    alignItems: 'center',
  },
  approveButtonDisabled: {
    backgroundColor: '#166534',
    opacity: 0.5,
  },
  approveButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
})

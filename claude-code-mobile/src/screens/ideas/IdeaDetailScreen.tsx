import React, { useEffect, useState, useRef } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useIdeasStore, getStageInfo } from '../../stores/ideas-store'
import type { Idea, IdeaStage } from '../../types'

interface IdeaDetailScreenProps {
  idea: Idea
  onBack: () => void
  onStartWorkflow: (idea: Idea) => void
}

const STAGES: IdeaStage[] = ['inbox', 'reviewing', 'planning', 'ready', 'in_progress', 'done']

export function IdeaDetailScreen({
  idea: initialIdea,
  onBack,
  onStartWorkflow,
}: IdeaDetailScreenProps) {
  const insets = useSafeAreaInsets()
  const scrollViewRef = useRef<ScrollView>(null)
  const { selectedIdea, getIdea, moveIdea, addDiscussion } = useIdeasStore()
  const [inputText, setInputText] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [isMoving, setIsMoving] = useState(false)

  const idea = selectedIdea || initialIdea

  useEffect(() => {
    getIdea(initialIdea.id)
  }, [initialIdea.id])

  useEffect(() => {
    // Scroll to bottom when discussion changes
    scrollViewRef.current?.scrollToEnd({ animated: true })
  }, [idea?.discussionHistory.length])

  const handleSend = async () => {
    if (!inputText.trim() || isSending) return

    const message = inputText.trim()
    setInputText('')
    setIsSending(true)

    await addDiscussion(idea.id, message)
    setIsSending(false)
  }

  const handleMoveStage = async (newStage: IdeaStage) => {
    setIsMoving(true)
    await moveIdea(idea.id, newStage)
    setIsMoving(false)
  }

  const handleStartWorkflow = () => {
    if (idea.stage !== 'ready') {
      Alert.alert(
        'Move to Ready?',
        'This idea needs to be in the Ready stage before starting a workflow. Move it now?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Move & Start',
            onPress: async () => {
              await moveIdea(idea.id, 'ready')
              onStartWorkflow(idea)
            },
          },
        ]
      )
    } else {
      onStartWorkflow(idea)
    }
  }

  const stageInfo = getStageInfo(idea.stage)
  const currentStageIndex = STAGES.indexOf(idea.stage)

  const getPriorityColor = (priority: Idea['priority']) => {
    switch (priority) {
      case 'urgent': return '#ef4444'
      case 'high': return '#f59e0b'
      case 'medium': return '#3b82f6'
      default: return '#666'
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <View style={styles.headerContent}>
          <View style={[styles.stageBadge, { borderColor: stageInfo.color }]}>
            <Text style={[styles.stageBadgeText, { color: stageInfo.color }]}>
              {stageInfo.label}
            </Text>
          </View>
        </View>
        <TouchableOpacity
          style={styles.startButton}
          onPress={handleStartWorkflow}
        >
          <Text style={styles.startButtonText}>Start</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        ref={scrollViewRef}
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
        keyboardShouldPersistTaps="handled"
      >
        {/* Title & Priority */}
        <View style={styles.titleSection}>
          <View style={[styles.priorityDot, { backgroundColor: getPriorityColor(idea.priority) }]} />
          <Text style={styles.title}>{idea.title}</Text>
        </View>

        {/* Description */}
        {idea.description && (
          <View style={styles.descriptionCard}>
            <Text style={styles.description}>{idea.description}</Text>
          </View>
        )}

        {/* Stage Navigation */}
        <View style={styles.stageNav}>
          <Text style={styles.sectionTitle}>Stage</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {STAGES.map((stage, index) => {
              const info = getStageInfo(stage)
              const isActive = stage === idea.stage
              const isPast = index < currentStageIndex

              return (
                <TouchableOpacity
                  key={stage}
                  style={[
                    styles.stageButton,
                    isActive && styles.stageButtonActive,
                    isActive && { borderColor: info.color, backgroundColor: `${info.color}15` },
                  ]}
                  onPress={() => !isMoving && handleMoveStage(stage)}
                  disabled={isMoving}
                >
                  {isPast && <Text style={styles.stageCheckmark}>✓</Text>}
                  <Text style={[
                    styles.stageButtonText,
                    isActive && { color: info.color },
                  ]}>
                    {info.label}
                  </Text>
                </TouchableOpacity>
              )
            })}
          </ScrollView>
        </View>

        {/* Email Source */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Source Email</Text>
          <View style={styles.emailCard}>
            <View style={styles.emailHeader}>
              <Text style={styles.emailSubject}>{idea.emailSource.subject}</Text>
            </View>
            <Text style={styles.emailFrom}>From: {idea.emailSource.from}</Text>
            <Text style={styles.emailDate}>
              {new Date(idea.emailSource.receivedAt).toLocaleString()}
            </Text>
            {idea.emailSource.bodyPreview && (
              <Text style={styles.emailPreview}>{idea.emailSource.bodyPreview}</Text>
            )}
            {idea.emailSource.links.length > 0 && (
              <View style={styles.linksSection}>
                <Text style={styles.linksLabel}>
                  {idea.emailSource.links.length} link{idea.emailSource.links.length > 1 ? 's' : ''}
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* Tags */}
        {idea.tags.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Tags</Text>
            <View style={styles.tagsContainer}>
              {idea.tags.map((tag, index) => (
                <View key={index} style={styles.tag}>
                  <Text style={styles.tagText}>{tag}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* AI Discussion */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>AI Discussion</Text>
          <View style={styles.discussionContainer}>
            {idea.discussionHistory.length === 0 ? (
              <View style={styles.emptyDiscussion}>
                <Text style={styles.emptyDiscussionIcon}>💬</Text>
                <Text style={styles.emptyDiscussionText}>
                  Start a discussion to refine this idea
                </Text>
              </View>
            ) : (
              idea.discussionHistory.map((message, index) => (
                <View
                  key={index}
                  style={[
                    styles.messageBubble,
                    message.role === 'user' ? styles.userBubble : styles.assistantBubble,
                  ]}
                >
                  <Text style={[
                    styles.messageText,
                    message.role === 'user' && styles.userMessageText,
                  ]}>
                    {message.content}
                  </Text>
                  <Text style={styles.messageTime}>
                    {new Date(message.timestamp).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </Text>
                </View>
              ))
            )}
          </View>
        </View>
      </ScrollView>

      {/* Input */}
      <View style={[styles.inputContainer, { paddingBottom: insets.bottom + 8 }]}>
        <TextInput
          style={styles.input}
          value={inputText}
          onChangeText={setInputText}
          placeholder="Ask about this idea..."
          placeholderTextColor="#666"
          multiline
          maxLength={1000}
          editable={!isSending}
        />
        <TouchableOpacity
          style={[styles.sendButton, (!inputText.trim() || isSending) && styles.sendButtonDisabled]}
          onPress={handleSend}
          disabled={!inputText.trim() || isSending}
        >
          {isSending ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.sendButtonText}>↑</Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
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
  stageBadge: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  stageBadgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  startButton: {
    backgroundColor: '#22c55e',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  startButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 13,
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
  },
  titleSection: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  priorityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 8,
    marginRight: 12,
  },
  title: {
    flex: 1,
    color: '#fff',
    fontSize: 22,
    fontWeight: 'bold',
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
  stageNav: {
    marginBottom: 24,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    color: '#888',
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  stageButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#333',
    marginRight: 8,
  },
  stageButtonActive: {
    borderWidth: 2,
  },
  stageCheckmark: {
    color: '#22c55e',
    fontSize: 12,
    marginRight: 4,
  },
  stageButtonText: {
    color: '#888',
    fontSize: 13,
    fontWeight: '500',
  },
  emailCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
  },
  emailHeader: {
    marginBottom: 8,
  },
  emailSubject: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '500',
    lineHeight: 20,
  },
  emailFrom: {
    color: '#888',
    fontSize: 13,
    marginBottom: 4,
  },
  emailDate: {
    color: '#666',
    fontSize: 12,
    marginBottom: 12,
  },
  emailPreview: {
    color: '#aaa',
    fontSize: 13,
    lineHeight: 18,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#222',
  },
  linksSection: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#222',
  },
  linksLabel: {
    color: '#3b82f6',
    fontSize: 12,
  },
  tagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tag: {
    backgroundColor: '#1a1a1a',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  tagText: {
    color: '#888',
    fontSize: 13,
  },
  discussionContainer: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
    minHeight: 120,
  },
  emptyDiscussion: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  emptyDiscussionIcon: {
    fontSize: 32,
    marginBottom: 8,
    opacity: 0.5,
  },
  emptyDiscussionText: {
    color: '#666',
    fontSize: 13,
  },
  messageBubble: {
    maxWidth: '85%',
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
  },
  userBubble: {
    backgroundColor: '#3b82f6',
    alignSelf: 'flex-end',
    borderBottomRightRadius: 4,
  },
  assistantBubble: {
    backgroundColor: '#252525',
    alignSelf: 'flex-start',
    borderBottomLeftRadius: 4,
  },
  messageText: {
    color: '#ddd',
    fontSize: 14,
    lineHeight: 20,
  },
  userMessageText: {
    color: '#fff',
  },
  messageTime: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: 10,
    marginTop: 4,
    alignSelf: 'flex-end',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 16,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#222',
    gap: 8,
  },
  input: {
    flex: 1,
    backgroundColor: '#1a1a1a',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    color: '#fff',
    fontSize: 14,
    maxHeight: 100,
    minHeight: 40,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#3b82f6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: '#1e3a5f',
    opacity: 0.5,
  },
  sendButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
})

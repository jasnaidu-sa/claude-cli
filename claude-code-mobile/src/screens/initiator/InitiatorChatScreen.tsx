import React, { useEffect, useState, useRef } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useInitiatorStore } from '../../stores/initiator-store'
import type { InitiatorMessage } from '../../api/client'

interface InitiatorChatScreenProps {
  projectPath: string
  onBack: () => void
  onComplete: () => void
}

export function InitiatorChatScreen({
  projectPath,
  onBack,
  onComplete,
}: InitiatorChatScreenProps) {
  const insets = useSafeAreaInsets()
  const scrollViewRef = useRef<ScrollView>(null)
  const {
    session,
    isLoading,
    isSending,
    error,
    requirements,
    startSession,
    sendMessage,
    generatePrompt,
    subscribeToEvents,
  } = useInitiatorStore()

  const [inputText, setInputText] = useState('')

  useEffect(() => {
    startSession(projectPath)
    const unsubscribe = subscribeToEvents()
    return unsubscribe
  }, [projectPath])

  useEffect(() => {
    // Auto-scroll to bottom when messages change
    scrollViewRef.current?.scrollToEnd({ animated: true })
  }, [session?.messages])

  const handleSend = async () => {
    if (!inputText.trim() || isSending) return

    const message = inputText.trim()
    setInputText('')
    await sendMessage(message)
  }

  const handleGeneratePrompt = async () => {
    const success = await generatePrompt()
    if (success) {
      onComplete()
    }
  }

  const projectName = projectPath.split(/[\\/]/).pop() || 'Unknown Project'

  if (isLoading && !session) {
    return (
      <View style={[styles.container, styles.loadingContainer]}>
        <ActivityIndicator size="large" color="#3b82f6" />
        <Text style={styles.loadingText}>Starting requirements gathering...</Text>
      </View>
    )
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <View style={styles.headerContent}>
          <Text style={styles.headerTitle}>New Session</Text>
          <Text style={styles.headerSubtitle}>{projectName}</Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      {/* Requirements Summary */}
      {requirements.length > 0 && (
        <View style={styles.requirementsBanner}>
          <Text style={styles.requirementsTitle}>
            {requirements.length} requirement{requirements.length > 1 ? 's' : ''} gathered
          </Text>
          <TouchableOpacity onPress={handleGeneratePrompt} disabled={isLoading}>
            {isLoading ? (
              <ActivityIndicator size="small" color="#22c55e" />
            ) : (
              <Text style={styles.generateButton}>Generate →</Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      {/* Messages */}
      <ScrollView
        ref={scrollViewRef}
        style={styles.messagesContainer}
        contentContainerStyle={styles.messagesContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Welcome message */}
        <View style={styles.systemMessage}>
          <Text style={styles.systemMessageText}>
            I'll help you define the requirements for your Ralph Loop session.
            What would you like to build or fix?
          </Text>
        </View>

        {/* Chat messages */}
        {session?.messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}

        {/* Sending indicator */}
        {isSending && (
          <View style={styles.typingIndicator}>
            <View style={styles.typingDot} />
            <View style={[styles.typingDot, styles.typingDotDelayed]} />
            <View style={[styles.typingDot, styles.typingDotDelayed2]} />
          </View>
        )}

        {/* Error message */}
        {error && (
          <View style={styles.errorMessage}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}
      </ScrollView>

      {/* Input */}
      <View style={[styles.inputContainer, { paddingBottom: insets.bottom + 8 }]}>
        <TextInput
          style={styles.input}
          value={inputText}
          onChangeText={setInputText}
          placeholder="Describe what you want to build..."
          placeholderTextColor="#666"
          multiline
          maxLength={2000}
          editable={!isSending}
        />
        <TouchableOpacity
          style={[styles.sendButton, (!inputText.trim() || isSending) && styles.sendButtonDisabled]}
          onPress={handleSend}
          disabled={!inputText.trim() || isSending}
        >
          <Text style={styles.sendButtonText}>↑</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  )
}

interface MessageBubbleProps {
  message: InitiatorMessage
}

function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user'

  return (
    <View style={[styles.messageBubble, isUser ? styles.userBubble : styles.assistantBubble]}>
      <Text style={[styles.messageText, isUser && styles.userMessageText]}>
        {message.content}
      </Text>
      <Text style={styles.messageTime}>
        {formatTime(message.timestamp)}
      </Text>
    </View>
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
  loadingContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#888',
    fontSize: 14,
    marginTop: 16,
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
  headerSpacer: {
    width: 60,
  },
  requirementsBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(34, 197, 94, 0.1)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(34, 197, 94, 0.2)',
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  requirementsTitle: {
    color: '#22c55e',
    fontSize: 13,
    fontWeight: '500',
  },
  generateButton: {
    color: '#22c55e',
    fontSize: 14,
    fontWeight: '600',
  },
  messagesContainer: {
    flex: 1,
  },
  messagesContent: {
    padding: 16,
  },
  systemMessage: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderLeftWidth: 3,
    borderLeftColor: '#3b82f6',
  },
  systemMessageText: {
    color: '#888',
    fontSize: 14,
    lineHeight: 20,
  },
  messageBubble: {
    maxWidth: '80%',
    borderRadius: 16,
    padding: 12,
    marginBottom: 12,
  },
  userBubble: {
    backgroundColor: '#3b82f6',
    alignSelf: 'flex-end',
    borderBottomRightRadius: 4,
  },
  assistantBubble: {
    backgroundColor: '#1a1a1a',
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
  typingIndicator: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    padding: 12,
    gap: 4,
  },
  typingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#666',
  },
  typingDotDelayed: {
    opacity: 0.7,
  },
  typingDotDelayed2: {
    opacity: 0.4,
  },
  errorMessage: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: 8,
    padding: 12,
    marginTop: 8,
  },
  errorText: {
    color: '#ef4444',
    fontSize: 13,
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
    paddingRight: 48,
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

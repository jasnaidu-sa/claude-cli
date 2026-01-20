import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Dimensions,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTerminalSession } from '../../hooks/useTerminalSession'
import { TerminalOutput } from '../../components/TerminalOutput'
import { TerminalInput } from '../../components/TerminalInput'
import { useConnectionStore } from '../../stores/connection-store'

interface TerminalScreenProps {
  projectPath?: string
  onBack: () => void
}

const { height: SCREEN_HEIGHT } = Dimensions.get('window')

export function TerminalScreen({ projectPath, onBack }: TerminalScreenProps) {
  const insets = useSafeAreaInsets()
  const { isConnected: serverConnected } = useConnectionStore()
  const [commandHistory, setCommandHistory] = useState<string[]>([])
  const [fontSize, setFontSize] = useState(12)

  const {
    session,
    output,
    isConnected,
    isConnecting,
    error,
    createSession,
    sendInput,
    sendResize,
    clearOutput,
    closeSession,
  } = useTerminalSession({ projectPath })

  useEffect(() => {
    if (serverConnected && !session && !isConnecting) {
      createSession()
    }
  }, [serverConnected, session, isConnecting, createSession])

  const handleCommand = useCallback((command: string) => {
    sendInput(command)

    // Add to history (excluding empty/newline only)
    const trimmed = command.trim()
    if (trimmed && trimmed !== commandHistory[commandHistory.length - 1]) {
      setCommandHistory(prev => [...prev, trimmed])
    }
  }, [sendInput, commandHistory])

  const handleSpecialKey = useCallback((key: 'ctrl+c' | 'ctrl+d' | 'ctrl+z' | 'tab' | 'up' | 'down') => {
    switch (key) {
      case 'ctrl+c':
        sendInput('\x03') // ETX - End of Text (Ctrl+C)
        break
      case 'ctrl+d':
        sendInput('\x04') // EOT - End of Transmission (Ctrl+D)
        break
      case 'ctrl+z':
        sendInput('\x1a') // SUB - Substitute (Ctrl+Z)
        break
      case 'tab':
        sendInput('\t')
        break
      // up/down handled in TerminalInput for history
    }
  }, [sendInput])

  const handleClear = useCallback(() => {
    clearOutput()
    sendInput('clear\n')
  }, [clearOutput, sendInput])

  const handleClose = useCallback(() => {
    Alert.alert(
      'Close Terminal',
      'Are you sure you want to close this terminal session?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Close',
          style: 'destructive',
          onPress: async () => {
            await closeSession()
            onBack()
          },
        },
      ]
    )
  }, [closeSession, onBack])

  const getProjectName = () => {
    if (!projectPath) return 'Terminal'
    const parts = projectPath.split(/[/\\]/)
    return parts[parts.length - 1] || 'Terminal'
  }

  // Render connection states
  if (!serverConnected) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onBack} style={styles.backButton}>
            <Text style={styles.backButtonText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Terminal</Text>
          <View style={styles.headerRight} />
        </View>
        <View style={styles.centered}>
          <Text style={styles.disconnectedIcon}>⚡</Text>
          <Text style={styles.disconnectedTitle}>Not Connected</Text>
          <Text style={styles.disconnectedText}>
            Connect to a server to use the terminal
          </Text>
        </View>
      </View>
    )
  }

  if (isConnecting) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onBack} style={styles.backButton}>
            <Text style={styles.backButtonText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Terminal</Text>
          <View style={styles.headerRight} />
        </View>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#3b82f6" />
          <Text style={styles.connectingText}>Starting terminal session...</Text>
        </View>
      </View>
    )
  }

  if (error && !session) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onBack} style={styles.backButton}>
            <Text style={styles.backButtonText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Terminal</Text>
          <View style={styles.headerRight} />
        </View>
        <View style={styles.centered}>
          <Text style={styles.errorIcon}>⚠</Text>
          <Text style={styles.errorTitle}>Connection Error</Text>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={createSession}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </View>
    )
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
        <View style={styles.headerCenter}>
          <Text style={styles.title}>{getProjectName()}</Text>
          <View style={styles.statusRow}>
            <View style={[
              styles.statusDot,
              { backgroundColor: isConnected ? '#22c55e' : '#f59e0b' }
            ]} />
            <Text style={styles.statusText}>
              {isConnected ? 'Connected' : 'Reconnecting...'}
            </Text>
          </View>
        </View>
        <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
          <Text style={styles.closeButtonText}>×</Text>
        </TouchableOpacity>
      </View>

      {/* Toolbar */}
      <View style={styles.toolbar}>
        <TouchableOpacity style={styles.toolbarButton} onPress={handleClear}>
          <Text style={styles.toolbarButtonText}>Clear</Text>
        </TouchableOpacity>

        <View style={styles.toolbarSeparator} />

        <TouchableOpacity
          style={styles.toolbarButton}
          onPress={() => setFontSize(prev => Math.max(prev - 2, 8))}
        >
          <Text style={styles.toolbarButtonText}>A-</Text>
        </TouchableOpacity>
        <Text style={styles.fontSizeText}>{fontSize}px</Text>
        <TouchableOpacity
          style={styles.toolbarButton}
          onPress={() => setFontSize(prev => Math.min(prev + 2, 24))}
        >
          <Text style={styles.toolbarButtonText}>A+</Text>
        </TouchableOpacity>

        {session && (
          <>
            <View style={styles.toolbarSeparator} />
            <Text style={styles.sessionId}>
              Session: {session.id.slice(0, 8)}
            </Text>
          </>
        )}
      </View>

      {/* Terminal output */}
      <View style={styles.outputContainer}>
        <TerminalOutput output={output} fontSize={fontSize} />
      </View>

      {/* Terminal input */}
      <View style={{ paddingBottom: insets.bottom }}>
        <TerminalInput
          onSubmit={handleCommand}
          onSpecialKey={handleSpecialKey}
          disabled={!isConnected}
          history={commandHistory}
        />
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
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
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  title: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  statusText: {
    color: '#888',
    fontSize: 11,
  },
  headerRight: {
    width: 40,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1a1a1a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButtonText: {
    color: '#888',
    fontSize: 22,
    lineHeight: 26,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
    backgroundColor: '#111',
  },
  toolbarButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#1a1a1a',
  },
  toolbarButtonText: {
    color: '#888',
    fontSize: 12,
    fontWeight: '600',
  },
  toolbarSeparator: {
    width: 1,
    height: 20,
    backgroundColor: '#333',
    marginHorizontal: 12,
  },
  fontSizeText: {
    color: '#666',
    fontSize: 11,
    marginHorizontal: 8,
  },
  sessionId: {
    color: '#444',
    fontSize: 10,
    fontFamily: 'monospace',
  },
  outputContainer: {
    flex: 1,
  },
  disconnectedIcon: {
    fontSize: 48,
    marginBottom: 16,
    opacity: 0.5,
  },
  disconnectedTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
  },
  disconnectedText: {
    color: '#666',
    fontSize: 14,
    textAlign: 'center',
  },
  connectingText: {
    color: '#888',
    marginTop: 16,
    fontSize: 14,
  },
  errorIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  errorTitle: {
    color: '#ef4444',
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
  },
  errorText: {
    color: '#888',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 24,
  },
  retryButton: {
    backgroundColor: '#3b82f6',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
})

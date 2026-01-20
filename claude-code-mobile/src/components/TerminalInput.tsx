import React, { useState, useRef, useCallback } from 'react'
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Keyboard,
} from 'react-native'

interface TerminalInputProps {
  onSubmit: (command: string) => void
  onSpecialKey: (key: 'ctrl+c' | 'ctrl+d' | 'ctrl+z' | 'tab' | 'up' | 'down') => void
  disabled?: boolean
  history?: string[]
}

export function TerminalInput({
  onSubmit,
  onSpecialKey,
  disabled = false,
  history = [],
}: TerminalInputProps) {
  const [input, setInput] = useState('')
  const [historyIndex, setHistoryIndex] = useState(-1)
  const inputRef = useRef<TextInput>(null)

  const handleSubmit = useCallback(() => {
    if (input.trim()) {
      onSubmit(input + '\n')
      setInput('')
      setHistoryIndex(-1)
    } else {
      // Empty enter - still send newline
      onSubmit('\n')
    }
  }, [input, onSubmit])

  const handleHistoryUp = useCallback(() => {
    if (history.length === 0) return

    const newIndex = historyIndex + 1
    if (newIndex < history.length) {
      setHistoryIndex(newIndex)
      setInput(history[history.length - 1 - newIndex])
    }
    onSpecialKey('up')
  }, [history, historyIndex, onSpecialKey])

  const handleHistoryDown = useCallback(() => {
    if (historyIndex <= 0) {
      setHistoryIndex(-1)
      setInput('')
    } else {
      const newIndex = historyIndex - 1
      setHistoryIndex(newIndex)
      setInput(history[history.length - 1 - newIndex])
    }
    onSpecialKey('down')
  }, [history, historyIndex, onSpecialKey])

  const handleCtrlC = useCallback(() => {
    onSpecialKey('ctrl+c')
    setInput('')
  }, [onSpecialKey])

  const handleCtrlD = useCallback(() => {
    onSpecialKey('ctrl+d')
  }, [onSpecialKey])

  const handleTab = useCallback(() => {
    onSpecialKey('tab')
  }, [onSpecialKey])

  const quickKeys = [
    { label: 'Ctrl+C', onPress: handleCtrlC, color: '#ef4444' },
    { label: 'Tab', onPress: handleTab, color: '#666' },
    { label: '↑', onPress: handleHistoryUp, color: '#666' },
    { label: '↓', onPress: handleHistoryDown, color: '#666' },
    { label: 'Ctrl+D', onPress: handleCtrlD, color: '#f59e0b' },
  ]

  return (
    <View style={styles.container}>
      {/* Quick access keys */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.quickKeys}
        contentContainerStyle={styles.quickKeysContent}
        keyboardShouldPersistTaps="always"
      >
        {quickKeys.map((key, index) => (
          <TouchableOpacity
            key={index}
            style={[styles.quickKey, { borderColor: key.color }]}
            onPress={key.onPress}
            disabled={disabled}
          >
            <Text style={[styles.quickKeyText, { color: key.color }]}>
              {key.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Input row */}
      <View style={styles.inputRow}>
        <Text style={styles.prompt}>$</Text>
        <TextInput
          ref={inputRef}
          style={styles.input}
          value={input}
          onChangeText={setInput}
          onSubmitEditing={handleSubmit}
          placeholder="Enter command..."
          placeholderTextColor="#444"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          spellCheck={false}
          editable={!disabled}
          returnKeyType="send"
          blurOnSubmit={false}
        />
        <TouchableOpacity
          style={[styles.sendButton, !input.trim() && styles.sendButtonDisabled]}
          onPress={handleSubmit}
          disabled={disabled}
        >
          <Text style={styles.sendButtonText}>↵</Text>
        </TouchableOpacity>
      </View>

      {/* Common commands */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.commonCommands}
        contentContainerStyle={styles.commonCommandsContent}
        keyboardShouldPersistTaps="always"
      >
        {['ls', 'cd', 'pwd', 'git status', 'npm run', 'clear'].map((cmd, index) => (
          <TouchableOpacity
            key={index}
            style={styles.commandChip}
            onPress={() => setInput(input + cmd + ' ')}
            disabled={disabled}
          >
            <Text style={styles.commandChipText}>{cmd}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#111',
    borderTopWidth: 1,
    borderTopColor: '#222',
  },
  quickKeys: {
    maxHeight: 44,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  quickKeysContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  quickKey: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    backgroundColor: '#1a1a1a',
  },
  quickKeyText: {
    fontSize: 12,
    fontWeight: '600',
    fontFamily: 'monospace',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  prompt: {
    color: '#22c55e',
    fontSize: 16,
    fontWeight: 'bold',
    fontFamily: 'monospace',
    marginRight: 8,
  },
  input: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#fff',
    fontSize: 14,
    fontFamily: 'monospace',
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: '#3b82f6',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  sendButtonDisabled: {
    backgroundColor: '#1e3a5f',
    opacity: 0.5,
  },
  sendButtonText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  commonCommands: {
    maxHeight: 40,
    borderTopWidth: 1,
    borderTopColor: '#1a1a1a',
  },
  commonCommandsContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 8,
  },
  commandChip: {
    backgroundColor: '#1a1a1a',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  commandChipText: {
    color: '#666',
    fontSize: 11,
    fontFamily: 'monospace',
  },
})

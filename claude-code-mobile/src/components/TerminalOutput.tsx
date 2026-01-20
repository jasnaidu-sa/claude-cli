import React, { useRef, useEffect } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
} from 'react-native'

interface TerminalMessage {
  type: 'input' | 'output' | 'resize' | 'error' | 'clear'
  data?: string
  timestamp: number
}

interface TerminalOutputProps {
  output: TerminalMessage[]
  fontSize?: number
}

export function TerminalOutput({ output, fontSize = 12 }: TerminalOutputProps) {
  const scrollViewRef = useRef<ScrollView>(null)

  useEffect(() => {
    // Auto-scroll to bottom on new output
    scrollViewRef.current?.scrollToEnd({ animated: true })
  }, [output.length])

  const renderLine = (message: TerminalMessage, index: number) => {
    const isError = message.type === 'error'
    const isInput = message.type === 'input'
    const isClear = message.type === 'clear'

    // Parse ANSI codes (basic implementation)
    const text = parseAnsi(message.data || '')

    return (
      <View key={`${index}-${message.timestamp}`} style={styles.line}>
        {text.map((segment, segIndex) => (
          <Text
            key={segIndex}
            style={[
              styles.text,
              { fontSize },
              isError && styles.errorText,
              isInput && styles.inputText,
              isClear && styles.systemText,
              segment.bold && styles.boldText,
              segment.dim && styles.dimText,
              segment.color && { color: segment.color },
            ]}
          >
            {segment.text}
          </Text>
        ))}
      </View>
    )
  }

  return (
    <ScrollView
      ref={scrollViewRef}
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={true}
    >
      {output.map((message, index) => renderLine(message, index))}
    </ScrollView>
  )
}

interface TextSegment {
  text: string
  bold?: boolean
  dim?: boolean
  color?: string
}

// Basic ANSI color code parser
function parseAnsi(text: string): TextSegment[] {
  const segments: TextSegment[] = []
  const ansiRegex = /\x1b\[([0-9;]*)m/g

  let lastIndex = 0
  let match: RegExpExecArray | null
  let currentBold = false
  let currentDim = false
  let currentColor: string | undefined

  const colorMap: Record<string, string> = {
    '30': '#000',
    '31': '#ef4444', // red
    '32': '#22c55e', // green
    '33': '#eab308', // yellow
    '34': '#3b82f6', // blue
    '35': '#a855f7', // magenta
    '36': '#06b6d4', // cyan
    '37': '#e5e5e5', // white
    '90': '#666',     // bright black (gray)
    '91': '#f87171', // bright red
    '92': '#4ade80', // bright green
    '93': '#facc15', // bright yellow
    '94': '#60a5fa', // bright blue
    '95': '#c084fc', // bright magenta
    '96': '#22d3ee', // bright cyan
    '97': '#fff',     // bright white
  }

  while ((match = ansiRegex.exec(text)) !== null) {
    // Add text before this ANSI code
    if (match.index > lastIndex) {
      segments.push({
        text: text.slice(lastIndex, match.index),
        bold: currentBold,
        dim: currentDim,
        color: currentColor,
      })
    }

    // Parse ANSI codes
    const codes = match[1].split(';')
    for (const code of codes) {
      if (code === '0') {
        // Reset
        currentBold = false
        currentDim = false
        currentColor = undefined
      } else if (code === '1') {
        currentBold = true
      } else if (code === '2') {
        currentDim = true
      } else if (colorMap[code]) {
        currentColor = colorMap[code]
      }
    }

    lastIndex = ansiRegex.lastIndex
  }

  // Add remaining text
  if (lastIndex < text.length) {
    segments.push({
      text: text.slice(lastIndex),
      bold: currentBold,
      dim: currentDim,
      color: currentColor,
    })
  }

  // If no segments, return original text
  if (segments.length === 0) {
    return [{ text }]
  }

  return segments
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0d0d0d',
  },
  content: {
    padding: 12,
    paddingBottom: 24,
  },
  line: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    minHeight: 16,
  },
  text: {
    color: '#d4d4d4',
    fontFamily: 'monospace',
    lineHeight: 18,
  },
  errorText: {
    color: '#ef4444',
  },
  inputText: {
    color: '#22c55e',
  },
  systemText: {
    color: '#666',
    fontStyle: 'italic',
  },
  boldText: {
    fontWeight: 'bold',
  },
  dimText: {
    opacity: 0.6,
  },
})

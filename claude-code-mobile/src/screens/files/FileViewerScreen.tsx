import React, { useEffect, useState, useCallback, useRef } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Share,
  Dimensions,
  Alert,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { apiClient } from '../../api/client'

interface FileViewerScreenProps {
  filePath: string
  fileName: string
  onBack: () => void
}

const { width: SCREEN_WIDTH } = Dimensions.get('window')

export function FileViewerScreen({
  filePath,
  fileName,
  onBack,
}: FileViewerScreenProps) {
  const insets = useSafeAreaInsets()
  const scrollViewRef = useRef<ScrollView>(null)
  const [content, setContent] = useState<string>('')
  const [language, setLanguage] = useState<string>('')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showLineNumbers, setShowLineNumbers] = useState(true)
  const [fontSize, setFontSize] = useState(12)
  const [copied, setCopied] = useState(false)

  const loadFile = useCallback(async () => {
    try {
      setError(null)
      setIsLoading(true)
      const result = await apiClient.files.getContent(filePath)

      if (result.success && result.data) {
        setContent(result.data.content)
        setLanguage(result.data.language)
      } else {
        setError(result.error || 'Failed to load file')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load file')
    } finally {
      setIsLoading(false)
    }
  }, [filePath])

  useEffect(() => {
    loadFile()
  }, [loadFile])

  const handleCopy = async () => {
    // Use Share as a workaround since expo-clipboard isn't installed
    // This allows user to copy the content via share sheet
    try {
      await Share.share({ message: content, title: fileName })
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      Alert.alert('Copy Failed', 'Unable to copy content')
    }
  }

  const handleShare = async () => {
    try {
      await Share.share({
        message: content,
        title: fileName,
      })
    } catch (err) {
      console.error('Share failed:', err)
    }
  }

  const increaseFontSize = () => {
    setFontSize(prev => Math.min(prev + 2, 24))
  }

  const decreaseFontSize = () => {
    setFontSize(prev => Math.max(prev - 2, 8))
  }

  const lines = content.split('\n')
  const lineNumberWidth = String(lines.length).length * 10 + 16

  const getLanguageColor = (lang: string): string => {
    const colors: Record<string, string> = {
      typescript: '#3178c6',
      javascript: '#f7df1e',
      python: '#3776ab',
      json: '#292929',
      markdown: '#083fa1',
      css: '#264de4',
      html: '#e34c26',
      yaml: '#cb171e',
      shell: '#89e051',
    }
    return colors[lang.toLowerCase()] || '#666'
  }

  if (isLoading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color="#3b82f6" />
        <Text style={styles.loadingText}>Loading file...</Text>
      </View>
    )
  }

  if (error) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onBack} style={styles.backButton}>
            <Text style={styles.backButtonText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.title} numberOfLines={1}>{fileName}</Text>
          <View style={styles.headerRight} />
        </View>
        <View style={styles.errorContainer}>
          <Text style={styles.errorIcon}>⚠</Text>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={loadFile}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <View style={styles.titleContainer}>
          <Text style={styles.title} numberOfLines={1}>{fileName}</Text>
          {language && (
            <View style={[styles.languageBadge, { backgroundColor: getLanguageColor(language) }]}>
              <Text style={styles.languageText}>{language}</Text>
            </View>
          )}
        </View>
        <TouchableOpacity onPress={handleShare} style={styles.shareButton}>
          <Text style={styles.shareButtonText}>↗</Text>
        </TouchableOpacity>
      </View>

      {/* Toolbar */}
      <View style={styles.toolbar}>
        <TouchableOpacity
          style={[styles.toolbarButton, showLineNumbers && styles.toolbarButtonActive]}
          onPress={() => setShowLineNumbers(!showLineNumbers)}
        >
          <Text style={[styles.toolbarButtonText, showLineNumbers && styles.toolbarButtonTextActive]}>
            #
          </Text>
        </TouchableOpacity>

        <View style={styles.toolbarSeparator} />

        <TouchableOpacity style={styles.toolbarButton} onPress={decreaseFontSize}>
          <Text style={styles.toolbarButtonText}>A-</Text>
        </TouchableOpacity>
        <Text style={styles.fontSizeText}>{fontSize}px</Text>
        <TouchableOpacity style={styles.toolbarButton} onPress={increaseFontSize}>
          <Text style={styles.toolbarButtonText}>A+</Text>
        </TouchableOpacity>

        <View style={styles.toolbarSeparator} />

        <TouchableOpacity
          style={[styles.toolbarButton, copied && styles.copyButtonSuccess]}
          onPress={handleCopy}
        >
          <Text style={[styles.toolbarButtonText, copied && styles.copyButtonSuccessText]}>
            {copied ? '✓ Copied' : 'Copy'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* File info */}
      <View style={styles.fileInfo}>
        <Text style={styles.fileInfoText} numberOfLines={1}>
          {filePath}
        </Text>
        <Text style={styles.lineCount}>
          {lines.length} line{lines.length !== 1 ? 's' : ''}
        </Text>
      </View>

      {/* Code content */}
      <ScrollView
        ref={scrollViewRef}
        style={styles.codeContainer}
        horizontal
        showsHorizontalScrollIndicator={true}
      >
        <ScrollView
          showsVerticalScrollIndicator={true}
          contentContainerStyle={styles.codeContent}
        >
          {lines.map((line, index) => (
            <View key={index} style={styles.codeLine}>
              {showLineNumbers && (
                <Text
                  style={[
                    styles.lineNumber,
                    { width: lineNumberWidth, fontSize },
                  ]}
                >
                  {index + 1}
                </Text>
              )}
              <Text
                style={[
                  styles.lineContent,
                  { fontSize, minWidth: SCREEN_WIDTH - (showLineNumbers ? lineNumberWidth : 0) - 32 },
                ]}
              >
                {line || ' '}
              </Text>
            </View>
          ))}
        </ScrollView>
      </ScrollView>

      {/* Footer */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 8 }]}>
        <Text style={styles.footerText}>
          Read-only view • Pinch to zoom text
        </Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#888',
    marginTop: 12,
    fontSize: 14,
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
  titleContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    maxWidth: '70%',
  },
  languageBadge: {
    marginLeft: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  languageText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: 'bold',
    textTransform: 'uppercase',
  },
  headerRight: {
    width: 40,
  },
  shareButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1a1a1a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shareButtonText: {
    color: '#888',
    fontSize: 18,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  toolbarButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#1a1a1a',
  },
  toolbarButtonActive: {
    backgroundColor: '#3b82f6',
  },
  toolbarButtonText: {
    color: '#888',
    fontSize: 12,
    fontWeight: '600',
  },
  toolbarButtonTextActive: {
    color: '#fff',
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
  copyButtonSuccess: {
    backgroundColor: '#22c55e',
  },
  copyButtonSuccessText: {
    color: '#fff',
  },
  fileInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#111',
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  fileInfoText: {
    color: '#666',
    fontSize: 11,
    fontFamily: 'monospace',
    flex: 1,
    marginRight: 8,
  },
  lineCount: {
    color: '#666',
    fontSize: 11,
  },
  codeContainer: {
    flex: 1,
    backgroundColor: '#0d0d0d',
  },
  codeContent: {
    padding: 12,
  },
  codeLine: {
    flexDirection: 'row',
    minHeight: 20,
  },
  lineNumber: {
    color: '#444',
    fontFamily: 'monospace',
    textAlign: 'right',
    paddingRight: 16,
    marginRight: 8,
    borderRightWidth: 1,
    borderRightColor: '#222',
  },
  lineContent: {
    color: '#d4d4d4',
    fontFamily: 'monospace',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  errorIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  errorText: {
    color: '#ef4444',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 16,
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
  footer: {
    alignItems: 'center',
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#222',
  },
  footerText: {
    color: '#444',
    fontSize: 11,
  },
})

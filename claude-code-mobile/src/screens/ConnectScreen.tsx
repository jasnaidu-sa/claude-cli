import React, { useState, useEffect } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native'
import { useConnectionStore } from '../stores/connection-store'

interface ConnectScreenProps {
  onConnected: () => void
}

export function ConnectScreen({ onConnected }: ConnectScreenProps) {
  const {
    serverUrl,
    authToken,
    isConnecting,
    error,
    setServerUrl,
    setAuthToken,
    connect,
    loadSavedConnection,
  } = useConnectionStore()

  const [localUrl, setLocalUrl] = useState(serverUrl)
  const [localToken, setLocalToken] = useState(authToken)

  useEffect(() => {
    // Try to load saved connection on mount
    loadSavedConnection().then(() => {
      const { isConnected } = useConnectionStore.getState()
      if (isConnected) {
        onConnected()
      }
    })
  }, [])

  useEffect(() => {
    setLocalUrl(serverUrl)
    setLocalToken(authToken)
  }, [serverUrl, authToken])

  const handleConnect = async () => {
    setServerUrl(localUrl)
    setAuthToken(localToken)

    // Small delay to ensure state is updated
    await new Promise(resolve => setTimeout(resolve, 50))

    const success = await connect()
    if (success) {
      onConnected()
    }
  }

  const handleScanQR = () => {
    Alert.alert(
      'QR Code Scanner',
      'QR code scanning will be implemented in a future update. For now, please enter the server URL and token manually.',
      [{ text: 'OK' }]
    )
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>Claude Code</Text>
          <Text style={styles.subtitle}>Connect to your desktop</Text>
        </View>

        <View style={styles.form}>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Server URL</Text>
            <TextInput
              style={styles.input}
              placeholder="http://192.168.1.100:3847"
              placeholderTextColor="#666"
              value={localUrl}
              onChangeText={setLocalUrl}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Auth Token</Text>
            <TextInput
              style={styles.input}
              placeholder="Paste token from desktop app"
              placeholderTextColor="#666"
              value={localToken}
              onChangeText={setLocalToken}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
            />
          </View>

          {error && (
            <View style={styles.errorContainer}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <TouchableOpacity
            style={[styles.connectButton, (!localUrl || !localToken) && styles.connectButtonDisabled]}
            onPress={handleConnect}
            disabled={!localUrl || !localToken || isConnecting}
          >
            {isConnecting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.connectButtonText}>Connect</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={styles.scanButton} onPress={handleScanQR}>
            <Text style={styles.scanButtonText}>Scan QR Code</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.instructions}>
          <Text style={styles.instructionsTitle}>How to connect:</Text>
          <Text style={styles.instructionsText}>
            1. Open Claude Code Manager on your desktop{'\n'}
            2. Go to Settings → Connection Mode{'\n'}
            3. Select "Server" and start the server{'\n'}
            4. Copy the auth token and enter it above
          </Text>
        </View>
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  content: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: 48,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#888',
  },
  form: {
    marginBottom: 32,
  },
  inputGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    color: '#888',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: '#fff',
  },
  errorContainer: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.2)',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  errorText: {
    color: '#ef4444',
    fontSize: 14,
  },
  connectButton: {
    backgroundColor: '#3b82f6',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginBottom: 12,
  },
  connectButtonDisabled: {
    backgroundColor: '#1e3a5f',
    opacity: 0.6,
  },
  connectButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  scanButton: {
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  scanButtonText: {
    color: '#888',
    fontSize: 16,
  },
  instructions: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
  },
  instructionsTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#888',
    marginBottom: 8,
  },
  instructionsText: {
    fontSize: 13,
    color: '#666',
    lineHeight: 20,
  },
})

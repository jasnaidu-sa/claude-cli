import React, { useState, useEffect } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  Alert,
  TextInput,
  ActivityIndicator,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Notifications from 'expo-notifications'
import * as Device from 'expo-device'
import { useConnectionStore } from '../stores/connection-store'
import { apiClient } from '../api/client'

interface SettingsScreenProps {
  onBack: () => void
  onDisconnect: () => void
}

export function SettingsScreen({ onBack, onDisconnect }: SettingsScreenProps) {
  const insets = useSafeAreaInsets()
  const {
    serverUrl,
    authToken,
    isConnected,
    connectionQuality,
    lastPingTime,
    offlineQueue,
    setServerUrl,
    setAuthToken,
    connect,
    disconnect,
    clearConnection,
    clearQueue,
    ping,
  } = useConnectionStore()

  const [editingConnection, setEditingConnection] = useState(false)
  const [localUrl, setLocalUrl] = useState(serverUrl)
  const [localToken, setLocalToken] = useState(authToken)
  const [isConnecting, setIsConnecting] = useState(false)
  const [isPinging, setIsPinging] = useState(false)

  // Notification settings
  const [notificationsEnabled, setNotificationsEnabled] = useState(true)
  const [hardCheckpointNotifications, setHardCheckpointNotifications] = useState(true)
  const [sessionCompleteNotifications, setSessionCompleteNotifications] = useState(true)
  const [ideaNotifications, setIdeaNotifications] = useState(true)

  useEffect(() => {
    setLocalUrl(serverUrl)
    setLocalToken(authToken)
  }, [serverUrl, authToken])

  useEffect(() => {
    checkNotificationPermissions()
  }, [])

  const checkNotificationPermissions = async () => {
    const { status } = await Notifications.getPermissionsAsync()
    setNotificationsEnabled(status === 'granted')
  }

  const handleToggleNotifications = async (value: boolean) => {
    if (value) {
      const { status } = await Notifications.requestPermissionsAsync()
      setNotificationsEnabled(status === 'granted')
    } else {
      setNotificationsEnabled(false)
    }
  }

  const handleSaveConnection = async () => {
    setIsConnecting(true)
    setServerUrl(localUrl)
    setAuthToken(localToken)

    await new Promise(resolve => setTimeout(resolve, 50))

    const success = await connect()
    setIsConnecting(false)

    if (success) {
      setEditingConnection(false)
      Alert.alert('Connected', 'Successfully connected to the server.')
    } else {
      Alert.alert('Connection Failed', 'Could not connect to the server. Please check the URL and token.')
    }
  }

  const handleDisconnect = () => {
    Alert.alert(
      'Disconnect',
      'Are you sure you want to disconnect from the server?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: () => {
            disconnect()
            onDisconnect()
          },
        },
      ]
    )
  }

  const handleClearConnection = () => {
    Alert.alert(
      'Clear Connection',
      'This will remove all saved connection data. You will need to reconnect.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            await clearConnection()
            setEditingConnection(false)
            onDisconnect()
          },
        },
      ]
    )
  }

  const handleTestConnection = async () => {
    setIsPinging(true)
    const time = await ping()
    setIsPinging(false)

    if (time !== null) {
      Alert.alert('Connection Test', `Server responded in ${time}ms`)
    } else {
      Alert.alert('Connection Test', 'Failed to reach the server')
    }
  }

  const handleClearQueue = () => {
    if (offlineQueue.length === 0) return

    Alert.alert(
      'Clear Offline Queue',
      `This will discard ${offlineQueue.length} pending action${offlineQueue.length > 1 ? 's' : ''}. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: clearQueue,
        },
      ]
    )
  }

  const getQualityColor = (quality: string) => {
    switch (quality) {
      case 'excellent': return '#22c55e'
      case 'good': return '#3b82f6'
      case 'poor': return '#f59e0b'
      default: return '#ef4444'
    }
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        {/* Connection Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Connection</Text>
          <View style={styles.card}>
            {editingConnection ? (
              <>
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Server URL</Text>
                  <TextInput
                    style={styles.input}
                    value={localUrl}
                    onChangeText={setLocalUrl}
                    placeholder="http://192.168.1.100:3847"
                    placeholderTextColor="#666"
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                  />
                </View>
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Auth Token</Text>
                  <TextInput
                    style={styles.input}
                    value={localToken}
                    onChangeText={setLocalToken}
                    placeholder="Paste token from desktop app"
                    placeholderTextColor="#666"
                    autoCapitalize="none"
                    autoCorrect={false}
                    secureTextEntry
                  />
                </View>
                <View style={styles.buttonRow}>
                  <TouchableOpacity
                    style={styles.cancelButton}
                    onPress={() => {
                      setEditingConnection(false)
                      setLocalUrl(serverUrl)
                      setLocalToken(authToken)
                    }}
                  >
                    <Text style={styles.cancelButtonText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.saveButton, (!localUrl || !localToken) && styles.disabledButton]}
                    onPress={handleSaveConnection}
                    disabled={!localUrl || !localToken || isConnecting}
                  >
                    {isConnecting ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={styles.saveButtonText}>Save & Connect</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <>
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Status</Text>
                  <View style={styles.statusValue}>
                    <View style={[
                      styles.statusDot,
                      { backgroundColor: isConnected ? '#22c55e' : '#ef4444' }
                    ]} />
                    <Text style={styles.infoValue}>
                      {isConnected ? 'Connected' : 'Disconnected'}
                    </Text>
                  </View>
                </View>
                {isConnected && (
                  <>
                    <View style={styles.infoRow}>
                      <Text style={styles.infoLabel}>Quality</Text>
                      <Text style={[styles.infoValue, { color: getQualityColor(connectionQuality) }]}>
                        {connectionQuality.charAt(0).toUpperCase() + connectionQuality.slice(1)}
                        {lastPingTime && ` (${lastPingTime}ms)`}
                      </Text>
                    </View>
                    <View style={styles.infoRow}>
                      <Text style={styles.infoLabel}>Server</Text>
                      <Text style={styles.infoValue} numberOfLines={1}>{serverUrl}</Text>
                    </View>
                  </>
                )}
                <View style={styles.buttonRow}>
                  {isConnected ? (
                    <>
                      <TouchableOpacity
                        style={styles.testButton}
                        onPress={handleTestConnection}
                        disabled={isPinging}
                      >
                        {isPinging ? (
                          <ActivityIndicator size="small" color="#3b82f6" />
                        ) : (
                          <Text style={styles.testButtonText}>Test</Text>
                        )}
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.editButton}
                        onPress={() => setEditingConnection(true)}
                      >
                        <Text style={styles.editButtonText}>Edit</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.disconnectButton}
                        onPress={handleDisconnect}
                      >
                        <Text style={styles.disconnectButtonText}>Disconnect</Text>
                      </TouchableOpacity>
                    </>
                  ) : (
                    <TouchableOpacity
                      style={styles.connectButton}
                      onPress={() => setEditingConnection(true)}
                    >
                      <Text style={styles.connectButtonText}>Configure Connection</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </>
            )}
          </View>
        </View>

        {/* Offline Queue Section */}
        {offlineQueue.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Offline Queue</Text>
            <View style={styles.card}>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Pending Actions</Text>
                <Text style={styles.infoValue}>{offlineQueue.length}</Text>
              </View>
              <TouchableOpacity
                style={styles.clearQueueButton}
                onPress={handleClearQueue}
              >
                <Text style={styles.clearQueueButtonText}>Clear Queue</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Notifications Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Notifications</Text>
          <View style={styles.card}>
            <View style={styles.settingRow}>
              <View style={styles.settingContent}>
                <Text style={styles.settingLabel}>Push Notifications</Text>
                <Text style={styles.settingDescription}>Receive alerts on your device</Text>
              </View>
              <Switch
                value={notificationsEnabled}
                onValueChange={handleToggleNotifications}
                trackColor={{ false: '#333', true: '#3b82f6' }}
                thumbColor="#fff"
              />
            </View>
            {notificationsEnabled && (
              <>
                <View style={styles.settingRow}>
                  <View style={styles.settingContent}>
                    <Text style={styles.settingLabel}>Hard Checkpoints</Text>
                    <Text style={styles.settingDescription}>Critical checkpoints requiring approval</Text>
                  </View>
                  <Switch
                    value={hardCheckpointNotifications}
                    onValueChange={setHardCheckpointNotifications}
                    trackColor={{ false: '#333', true: '#3b82f6' }}
                    thumbColor="#fff"
                  />
                </View>
                <View style={styles.settingRow}>
                  <View style={styles.settingContent}>
                    <Text style={styles.settingLabel}>Session Complete</Text>
                    <Text style={styles.settingDescription}>When a Ralph session finishes</Text>
                  </View>
                  <Switch
                    value={sessionCompleteNotifications}
                    onValueChange={setSessionCompleteNotifications}
                    trackColor={{ false: '#333', true: '#3b82f6' }}
                    thumbColor="#fff"
                  />
                </View>
                <View style={styles.settingRow}>
                  <View style={styles.settingContent}>
                    <Text style={styles.settingLabel}>New Ideas</Text>
                    <Text style={styles.settingDescription}>When ideas sync from email</Text>
                  </View>
                  <Switch
                    value={ideaNotifications}
                    onValueChange={setIdeaNotifications}
                    trackColor={{ false: '#333', true: '#3b82f6' }}
                    thumbColor="#fff"
                  />
                </View>
              </>
            )}
          </View>
        </View>

        {/* About Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>About</Text>
          <View style={styles.card}>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>App Version</Text>
              <Text style={styles.infoValue}>1.0.0</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Device</Text>
              <Text style={styles.infoValue}>
                {Device.modelName || 'Unknown'}
              </Text>
            </View>
          </View>
        </View>

        {/* Danger Zone */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, styles.dangerTitle]}>Danger Zone</Text>
          <View style={styles.card}>
            <TouchableOpacity
              style={styles.dangerButton}
              onPress={handleClearConnection}
            >
              <Text style={styles.dangerButtonText}>Clear All Connection Data</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
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
  headerTitle: {
    flex: 1,
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  headerSpacer: {
    width: 60,
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    paddingBottom: 48,
  },
  section: {
    padding: 16,
    paddingBottom: 0,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#888',
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  dangerTitle: {
    color: '#ef4444',
  },
  card: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
  },
  inputGroup: {
    marginBottom: 16,
  },
  inputLabel: {
    color: '#888',
    fontSize: 13,
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#0a0a0a',
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 8,
    padding: 12,
    color: '#fff',
    fontSize: 14,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  cancelButton: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333',
    alignItems: 'center',
  },
  cancelButtonText: {
    color: '#888',
    fontWeight: '600',
  },
  saveButton: {
    flex: 2,
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#3b82f6',
    alignItems: 'center',
  },
  saveButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  disabledButton: {
    backgroundColor: '#1e3a5f',
    opacity: 0.6,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  infoLabel: {
    color: '#666',
    fontSize: 14,
  },
  infoValue: {
    color: '#fff',
    fontSize: 14,
    flex: 1,
    textAlign: 'right',
  },
  statusValue: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  testButton: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#3b82f6',
    alignItems: 'center',
  },
  testButtonText: {
    color: '#3b82f6',
    fontWeight: '600',
  },
  editButton: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333',
    alignItems: 'center',
  },
  editButtonText: {
    color: '#888',
    fontWeight: '600',
  },
  disconnectButton: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ef4444',
    alignItems: 'center',
  },
  disconnectButtonText: {
    color: '#ef4444',
    fontWeight: '600',
  },
  connectButton: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#3b82f6',
    alignItems: 'center',
  },
  connectButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  clearQueueButton: {
    marginTop: 12,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#f59e0b',
    alignItems: 'center',
  },
  clearQueueButtonText: {
    color: '#f59e0b',
    fontWeight: '600',
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  settingContent: {
    flex: 1,
    marginRight: 16,
  },
  settingLabel: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
  settingDescription: {
    color: '#666',
    fontSize: 12,
    marginTop: 2,
  },
  dangerButton: {
    padding: 12,
    borderRadius: 8,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
    alignItems: 'center',
  },
  dangerButtonText: {
    color: '#ef4444',
    fontWeight: '600',
  },
})

import React, { useEffect, useState, useCallback } from 'react'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { View, StyleSheet } from 'react-native'
import * as Notifications from 'expo-notifications'
import * as Device from 'expo-device'
import { Platform } from 'react-native'

import { ConnectScreen } from './src/screens/ConnectScreen'
import { DashboardScreen } from './src/screens/DashboardScreen'
import { HomeScreen } from './src/screens/HomeScreen'
import { SessionDetailScreen } from './src/screens/SessionDetailScreen'
import { IdeasScreen } from './src/screens/IdeasScreen'
import { SettingsScreen } from './src/screens/SettingsScreen'
import { TabNavigator, type TabRoute } from './src/navigation/TabNavigator'
import { useConnectionStore, loadOfflineQueue } from './src/stores/connection-store'
import { useRalphStore } from './src/stores/ralph-store'
import { apiClient } from './src/api/client'

// Configure notifications
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
})

type Screen =
  | { type: 'connect' }
  | { type: 'main'; tab: TabRoute }
  | { type: 'session'; sessionId: string }
  | { type: 'settings' }
  | { type: 'initiator'; projectPath?: string }

export default function App() {
  const { isConnected, loadSavedConnection, ping } = useConnectionStore()
  const { pendingCheckpoints, subscribeToEvents } = useRalphStore()
  const [currentScreen, setCurrentScreen] = useState<Screen>({ type: 'connect' })
  const [isInitialized, setIsInitialized] = useState(false)

  useEffect(() => {
    let subscription: Notifications.Subscription | undefined
    let responseSubscription: Notifications.Subscription | undefined
    let mounted = true

    // Initialize app
    const init = async () => {
      // Load offline queue from storage
      await loadOfflineQueue()

      // Try to load saved connection
      await loadSavedConnection()

      // Register for push notifications
      await registerForPushNotificationsAsync()

      // Set up notification listeners
      subscription = Notifications.addNotificationReceivedListener(notification => {
        console.log('Notification received:', notification)
      })

      responseSubscription = Notifications.addNotificationResponseReceivedListener(response => {
        const data = response.notification.request.content.data
        if (data?.sessionId && mounted) {
          setCurrentScreen({ type: 'session', sessionId: data.sessionId as string })
        }
      })

      if (mounted) {
        setIsInitialized(true)
      }
    }

    init()

    // Cleanup function returned directly from useEffect
    return () => {
      mounted = false
      subscription?.remove()
      responseSubscription?.remove()
    }
  }, [])

  // Subscribe to real-time events when connected
  useEffect(() => {
    if (!isConnected) return

    const unsubscribe = subscribeToEvents()
    return unsubscribe
  }, [isConnected])

  // Navigate to main screen when connected
  useEffect(() => {
    if (isInitialized) {
      if (isConnected && currentScreen.type === 'connect') {
        setCurrentScreen({ type: 'main', tab: 'dashboard' })
      }
    }
  }, [isConnected, isInitialized])

  // Subscribe to checkpoint events for notifications
  useEffect(() => {
    if (!isConnected) return

    const unsubscribe = apiClient.ralph.onCheckpoint(async (data) => {
      const checkpoint = data.data
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Checkpoint Pending',
          body: checkpoint.title,
          data: { sessionId: data.sessionId, checkpointId: checkpoint.id },
        },
        trigger: null, // Show immediately
      })
    })

    return unsubscribe
  }, [isConnected])

  // Ping server periodically to check connection quality
  useEffect(() => {
    if (!isConnected) return

    const interval = setInterval(() => {
      ping()
    }, 30000) // Every 30 seconds

    return () => clearInterval(interval)
  }, [isConnected])

  const handleConnected = useCallback(() => {
    setCurrentScreen({ type: 'main', tab: 'dashboard' })
  }, [])

  const handleDisconnect = useCallback(() => {
    setCurrentScreen({ type: 'connect' })
  }, [])

  const handleNavigateToSession = useCallback((sessionId: string) => {
    setCurrentScreen({ type: 'session', sessionId })
  }, [])

  const handleNavigateToSettings = useCallback(() => {
    setCurrentScreen({ type: 'settings' })
  }, [])

  const handleStartNewSession = useCallback(() => {
    setCurrentScreen({ type: 'initiator' })
  }, [])

  const handleBack = useCallback(() => {
    if (currentScreen.type === 'session' || currentScreen.type === 'settings' || currentScreen.type === 'initiator') {
      setCurrentScreen({ type: 'main', tab: 'dashboard' })
    }
  }, [currentScreen])

  const handleTabChange = useCallback((tab: TabRoute) => {
    setCurrentScreen({ type: 'main', tab })
  }, [])

  // Calculate badges for tabs
  const tabBadges: Partial<Record<TabRoute, number>> = {
    sessions: pendingCheckpoints.length,
  }

  const renderScreen = () => {
    switch (currentScreen.type) {
      case 'connect':
        return <ConnectScreen onConnected={handleConnected} />

      case 'main':
        return (
          <View style={styles.mainContainer}>
            {currentScreen.tab === 'dashboard' && (
              <DashboardScreen
                onNavigateToSession={handleNavigateToSession}
                onNavigateToIdeas={() => handleTabChange('ideas')}
                onNavigateToSettings={handleNavigateToSettings}
                onStartNewSession={handleStartNewSession}
              />
            )}
            {currentScreen.tab === 'sessions' && (
              <HomeScreen
                onNavigateToSession={handleNavigateToSession}
                onNavigateToIdeas={() => handleTabChange('ideas')}
                onDisconnect={handleDisconnect}
              />
            )}
            {currentScreen.tab === 'ideas' && (
              <IdeasScreen onBack={() => handleTabChange('dashboard')} />
            )}
            {currentScreen.tab === 'files' && (
              // Placeholder for files screen
              <View style={styles.placeholder}>
                {/* FileExplorerScreen will go here */}
              </View>
            )}
            {currentScreen.tab === 'settings' && (
              <SettingsScreen
                onBack={() => handleTabChange('dashboard')}
                onDisconnect={handleDisconnect}
              />
            )}
            <TabNavigator
              currentTab={currentScreen.tab}
              onTabChange={handleTabChange}
              badges={tabBadges}
            />
          </View>
        )

      case 'session':
        return (
          <SessionDetailScreen
            sessionId={currentScreen.sessionId}
            onBack={handleBack}
          />
        )

      case 'settings':
        return (
          <SettingsScreen
            onBack={handleBack}
            onDisconnect={handleDisconnect}
          />
        )

      case 'initiator':
        // Placeholder for initiator flow
        return (
          <View style={styles.placeholder}>
            {/* InitiatorChatScreen will go here */}
          </View>
        )

      default:
        return null
    }
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {renderScreen()}
    </SafeAreaProvider>
  )
}

async function registerForPushNotificationsAsync() {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#3b82f6',
    })

    // High priority channel for hard checkpoints
    await Notifications.setNotificationChannelAsync('checkpoints', {
      name: 'Checkpoints',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 500, 250, 500],
      lightColor: '#f59e0b',
      bypassDnd: true,
    })
  }

  if (Device.isDevice) {
    const { status: existingStatus } = await Notifications.getPermissionsAsync()
    let finalStatus = existingStatus

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync()
      finalStatus = status
    }

    if (finalStatus !== 'granted') {
      console.log('Failed to get push token for push notification!')
      return
    }
  } else {
    console.log('Must use physical device for Push Notifications')
  }
}

const styles = StyleSheet.create({
  mainContainer: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  placeholder: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
})

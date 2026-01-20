import * as Notifications from 'expo-notifications'
import * as Device from 'expo-device'
import { Platform } from 'react-native'
import { apiClient } from '../api/client'

// Notification categories for different event types
export type NotificationCategory =
  | 'checkpoint_hard'
  | 'checkpoint_soft'
  | 'session_error'
  | 'session_complete'
  | 'idea_synced'
  | 'merge_conflict'
  | 'agent_failed'
  | 'agent_complete'

export interface NotificationData {
  type: NotificationCategory
  sessionId?: string
  checkpointId?: string
  ideaId?: string
  projectPath?: string
  title: string
  body: string
  // Merge conflict specific
  conflictId?: string
  conflictCount?: number
  aiResolved?: boolean
  confidence?: number
  // Agent specific
  agentId?: string
  taskId?: string
}

/**
 * P0 FIX: Type guard for NotificationData validation
 */
function isNotificationData(data: unknown): data is NotificationData {
  if (typeof data !== 'object' || data === null) return false
  const obj = data as Record<string, unknown>
  return (
    typeof obj.type === 'string' &&
    typeof obj.title === 'string' &&
    typeof obj.body === 'string' &&
    (obj.sessionId === undefined || typeof obj.sessionId === 'string') &&
    (obj.checkpointId === undefined || typeof obj.checkpointId === 'string')
  )
}

// Configure how notifications behave when app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    // P0 FIX: Use type guard instead of unsafe cast
    const rawData = notification.request.content.data
    const data = isNotificationData(rawData) ? rawData : undefined
    const isCritical =
      data?.type === 'checkpoint_hard' ||
      data?.type === 'session_error' ||
      data?.type === 'merge_conflict' ||
      data?.type === 'agent_failed'

    return {
      shouldShowAlert: true,
      shouldPlaySound: isCritical,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }
  },
})

class NotificationServiceClass {
  private pushToken: string | null = null
  private notificationListener: Notifications.Subscription | null = null
  private responseListener: Notifications.Subscription | null = null
  private onNotificationReceived: ((data: NotificationData) => void) | null = null
  private onNotificationResponse: ((data: NotificationData, actionId?: string) => void) | null = null

  async initialize(): Promise<boolean> {
    if (!Device.isDevice) {
      console.log('Push notifications require a physical device')
      return false
    }

    try {
      // Request permissions
      const { status: existingStatus } = await Notifications.getPermissionsAsync()
      let finalStatus = existingStatus

      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync()
        finalStatus = status
      }

      if (finalStatus !== 'granted') {
        console.log('Permission not granted for push notifications')
        return false
      }

      // Get push token
      const tokenData = await Notifications.getExpoPushTokenAsync({
        projectId: 'claude-code-mobile', // Replace with actual Expo project ID
      })
      this.pushToken = tokenData.data

      // Configure Android channel
      if (Platform.OS === 'android') {
        await this.setupAndroidChannels()
      }

      // Set up notification categories with actions
      await this.setupNotificationCategories()

      return true
    } catch (error) {
      console.error('Failed to initialize notifications:', error)
      return false
    }
  }

  private async setupAndroidChannels(): Promise<void> {
    // Critical channel for hard checkpoints and errors
    await Notifications.setNotificationChannelAsync('critical', {
      name: 'Critical Alerts',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#ef4444',
      sound: 'default',
      bypassDnd: true,
    })

    // High priority channel for session events
    await Notifications.setNotificationChannelAsync('sessions', {
      name: 'Session Updates',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
    })

    // Normal channel for soft checkpoints
    await Notifications.setNotificationChannelAsync('checkpoints', {
      name: 'Checkpoints',
      importance: Notifications.AndroidImportance.DEFAULT,
    })

    // Low priority channel for ideas
    await Notifications.setNotificationChannelAsync('ideas', {
      name: 'Ideas',
      importance: Notifications.AndroidImportance.LOW,
    })
  }

  private async setupNotificationCategories(): Promise<void> {
    // Hard checkpoint category with actions
    await Notifications.setNotificationCategoryAsync('checkpoint_hard', [
      {
        identifier: 'approve',
        buttonTitle: 'Approve',
        options: {
          isDestructive: false,
          isAuthenticationRequired: false,
        },
      },
      {
        identifier: 'view',
        buttonTitle: 'View Details',
        options: {
          opensAppToForeground: true,
        },
      },
    ])

    // Session error category
    await Notifications.setNotificationCategoryAsync('session_error', [
      {
        identifier: 'view',
        buttonTitle: 'View',
        options: {
          opensAppToForeground: true,
        },
      },
      {
        identifier: 'retry',
        buttonTitle: 'Retry',
        options: {
          isDestructive: false,
        },
      },
    ])

    // Session complete category
    await Notifications.setNotificationCategoryAsync('session_complete', [
      {
        identifier: 'view_summary',
        buttonTitle: 'View Summary',
        options: {
          opensAppToForeground: true,
        },
      },
    ])

    // Merge conflict category - requires user approval
    await Notifications.setNotificationCategoryAsync('merge_conflict', [
      {
        identifier: 'approve_all',
        buttonTitle: 'Approve All',
        options: {
          isDestructive: false,
          isAuthenticationRequired: false,
        },
      },
      {
        identifier: 'view_conflicts',
        buttonTitle: 'Review',
        options: {
          opensAppToForeground: true,
        },
      },
    ])

    // Agent failed category
    await Notifications.setNotificationCategoryAsync('agent_failed', [
      {
        identifier: 'view_agent',
        buttonTitle: 'View Details',
        options: {
          opensAppToForeground: true,
        },
      },
      {
        identifier: 'retry_task',
        buttonTitle: 'Retry',
        options: {
          isDestructive: false,
        },
      },
    ])
  }

  async registerWithServer(): Promise<boolean> {
    if (!this.pushToken) {
      console.log('No push token available')
      return false
    }

    try {
      const result = await apiClient.notifications.register(
        this.pushToken,
        Platform.OS as 'ios' | 'android'
      )
      return result.success
    } catch (error) {
      console.error('Failed to register push token with server:', error)
      return false
    }
  }

  async unregisterFromServer(): Promise<boolean> {
    if (!this.pushToken) return true

    try {
      const result = await apiClient.notifications.unregister(this.pushToken)
      return result.success
    } catch (error) {
      console.error('Failed to unregister push token:', error)
      return false
    }
  }

  startListening(
    onReceived: (data: NotificationData) => void,
    onResponse: (data: NotificationData, actionId?: string) => void
  ): void {
    // P0 FIX: Clean up any existing listeners first to prevent memory leaks
    this.stopListening()

    this.onNotificationReceived = onReceived
    this.onNotificationResponse = onResponse

    // Notification received while app is in foreground
    this.notificationListener = Notifications.addNotificationReceivedListener(
      (notification) => {
        // P0 FIX: Use type guard instead of unsafe cast
        const rawData = notification.request.content.data
        if (isNotificationData(rawData) && this.onNotificationReceived) {
          this.onNotificationReceived(rawData)
        }
      }
    )

    // User tapped on notification or action button
    this.responseListener = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        // P0 FIX: Use type guard instead of unsafe cast
        const rawData = response.notification.request.content.data
        const actionId = response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER
          ? response.actionIdentifier
          : undefined

        if (isNotificationData(rawData) && this.onNotificationResponse) {
          this.onNotificationResponse(rawData, actionId)
        }
      }
    )
  }

  stopListening(): void {
    if (this.notificationListener) {
      this.notificationListener.remove()
      this.notificationListener = null
    }
    if (this.responseListener) {
      this.responseListener.remove()
      this.responseListener = null
    }
    this.onNotificationReceived = null
    this.onNotificationResponse = null
  }

  // Schedule a local notification (for testing or local events)
  async scheduleLocalNotification(
    data: NotificationData,
    trigger?: Notifications.NotificationTriggerInput
  ): Promise<string> {
    const channelId = this.getChannelForType(data.type)
    const categoryId = this.getCategoryForType(data.type)

    const notificationId = await Notifications.scheduleNotificationAsync({
      content: {
        title: data.title,
        body: data.body,
        data: data as unknown as Record<string, unknown>,
        categoryIdentifier: categoryId,
        ...(Platform.OS === 'android' && { channelId }),
      },
      trigger: trigger || null,
    })

    return notificationId
  }

  private getChannelForType(type: NotificationCategory): string {
    switch (type) {
      case 'checkpoint_hard':
      case 'session_error':
      case 'merge_conflict':
      case 'agent_failed':
        return 'critical'
      case 'session_complete':
      case 'agent_complete':
        return 'sessions'
      case 'checkpoint_soft':
        return 'checkpoints'
      case 'idea_synced':
        return 'ideas'
      default:
        return 'default'
    }
  }

  private getCategoryForType(type: NotificationCategory): string {
    switch (type) {
      case 'checkpoint_hard':
        return 'checkpoint_hard'
      case 'session_error':
        return 'session_error'
      case 'session_complete':
        return 'session_complete'
      case 'merge_conflict':
        return 'merge_conflict'
      case 'agent_failed':
        return 'agent_failed'
      default:
        return ''
    }
  }

  async getBadgeCount(): Promise<number> {
    return await Notifications.getBadgeCountAsync()
  }

  async setBadgeCount(count: number): Promise<void> {
    await Notifications.setBadgeCountAsync(count)
  }

  async clearBadge(): Promise<void> {
    await Notifications.setBadgeCountAsync(0)
  }

  async dismissAll(): Promise<void> {
    await Notifications.dismissAllNotificationsAsync()
  }

  getPushToken(): string | null {
    return this.pushToken
  }
}

export const NotificationService = new NotificationServiceClass()

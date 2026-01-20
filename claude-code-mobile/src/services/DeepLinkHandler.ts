import { Linking } from 'react-native'
import { NotificationData } from './NotificationService'

// Deep link URL scheme: claudecode://
// Examples:
//   claudecode://session/abc123
//   claudecode://checkpoint/abc123/xyz456
//   claudecode://idea/abc123
//   claudecode://terminal
//   claudecode://settings

export type DeepLinkRoute =
  | { type: 'dashboard' }
  | { type: 'session'; sessionId: string }
  | { type: 'checkpoint'; sessionId: string; checkpointId: string }
  | { type: 'idea'; ideaId: string }
  | { type: 'terminal'; projectPath?: string }
  | { type: 'file'; filePath: string }
  | { type: 'settings' }

export type DeepLinkCallback = (route: DeepLinkRoute) => void

interface LinkingEvent {
  url: string
}

class DeepLinkHandlerClass {
  private callback: DeepLinkCallback | null = null
  private pendingLink: DeepLinkRoute | null = null
  private linkingSubscription: { remove: () => void } | null = null

  initialize(): void {
    // Handle deep links when app is opened from a link
    this.linkingSubscription = Linking.addEventListener('url', (event: LinkingEvent) => {
      this.handleUrl(event.url)
    })
  }

  cleanup(): void {
    if (this.linkingSubscription) {
      this.linkingSubscription.remove()
      this.linkingSubscription = null
    }
    this.callback = null
    this.pendingLink = null
  }

  setCallback(callback: DeepLinkCallback): void {
    this.callback = callback

    // Process any pending link
    if (this.pendingLink) {
      callback(this.pendingLink)
      this.pendingLink = null
    }
  }

  clearCallback(): void {
    this.callback = null
  }

  // Check for initial URL when app cold starts
  async checkInitialUrl(): Promise<void> {
    const url = await Linking.getInitialURL()
    if (url) {
      this.handleUrl(url)
    }
  }

  private handleUrl(url: string): void {
    const route = this.parseUrl(url)
    if (route) {
      if (this.callback) {
        this.callback(route)
      } else {
        // Store for later when callback is set
        this.pendingLink = route
      }
    }
  }

  private parseUrl(url: string): DeepLinkRoute | null {
    try {
      // Parse URL manually
      const urlObj = new URL(url)
      const path = urlObj.pathname.replace(/^\//, '')
      const searchParams = urlObj.searchParams

      // Handle different URL patterns
      if (path === '' || path === 'dashboard') {
        return { type: 'dashboard' }
      }

      if (path.startsWith('session/')) {
        const sessionId = path.replace('session/', '')
        return { type: 'session', sessionId }
      }

      if (path.startsWith('checkpoint/')) {
        const parts = path.replace('checkpoint/', '').split('/')
        if (parts.length >= 2) {
          return {
            type: 'checkpoint',
            sessionId: parts[0],
            checkpointId: parts[1],
          }
        }
      }

      if (path.startsWith('idea/')) {
        const ideaId = path.replace('idea/', '')
        return { type: 'idea', ideaId }
      }

      if (path === 'terminal' || path.startsWith('terminal')) {
        const projectPath = searchParams.get('project') || undefined
        return { type: 'terminal', projectPath }
      }

      if (path.startsWith('file/')) {
        const filePath = decodeURIComponent(path.replace('file/', ''))
        return { type: 'file', filePath }
      }

      if (path === 'settings') {
        return { type: 'settings' }
      }

      // Unknown path, go to dashboard
      return { type: 'dashboard' }
    } catch (error) {
      console.error('Failed to parse deep link URL:', error)
      return null
    }
  }

  // Handle notification response and convert to deep link route
  handleNotificationResponse(
    data: NotificationData,
    _actionId?: string
  ): DeepLinkRoute | null {
    switch (data.type) {
      case 'checkpoint_hard':
      case 'checkpoint_soft':
        if (data.sessionId && data.checkpointId) {
          return {
            type: 'checkpoint',
            sessionId: data.sessionId,
            checkpointId: data.checkpointId,
          }
        }
        if (data.sessionId) {
          return { type: 'session', sessionId: data.sessionId }
        }
        break

      case 'session_error':
      case 'session_complete':
        if (data.sessionId) {
          return { type: 'session', sessionId: data.sessionId }
        }
        break

      case 'idea_synced':
        if (data.ideaId) {
          return { type: 'idea', ideaId: data.ideaId }
        }
        break
    }

    return { type: 'dashboard' }
  }

  // Generate deep link URLs
  createUrl(route: DeepLinkRoute): string {
    const base = 'claudecode://'

    switch (route.type) {
      case 'dashboard':
        return base
      case 'session':
        return `${base}session/${route.sessionId}`
      case 'checkpoint':
        return `${base}checkpoint/${route.sessionId}/${route.checkpointId}`
      case 'idea':
        return `${base}idea/${route.ideaId}`
      case 'terminal':
        return route.projectPath
          ? `${base}terminal?project=${encodeURIComponent(route.projectPath)}`
          : `${base}terminal`
      case 'file':
        return `${base}file/${encodeURIComponent(route.filePath)}`
      case 'settings':
        return `${base}settings`
    }
  }

  // Open external URL
  async openExternalUrl(url: string): Promise<boolean> {
    const canOpen = await Linking.canOpenURL(url)
    if (canOpen) {
      await Linking.openURL(url)
      return true
    }
    return false
  }

  // Open app settings
  async openAppSettings(): Promise<void> {
    await Linking.openSettings()
  }
}

export const DeepLinkHandler = new DeepLinkHandlerClass()

/**
 * WhatsApp View - Main Container
 *
 * 3-column layout: ConversationList | ChatWindow | Settings panel (toggleable)
 * Top bar shows connection status with connect/disconnect button.
 * Renders QrCodeModal when showQrModal is true.
 */

import React, { useEffect } from 'react'
import {
  MessageCircle,
  Wifi,
  WifiOff,
  Loader2,
  Settings2,
  X,
} from 'lucide-react'
import { Button } from '../ui/button'
import { ConversationList } from './ConversationList'
import { ChatWindow } from './ChatWindow'
import { QrCodeModal } from './QrCodeModal'
import { WhatsAppSettings } from './WhatsAppSettings'
import { useWhatsAppStore } from '@renderer/stores/whatsapp-store'
import { cn } from '@renderer/lib/utils'

interface WhatsAppViewProps {
  onClose?: () => void
}

export function WhatsAppView({ onClose }: WhatsAppViewProps) {
  const {
    connectionState,
    showQrModal,
    showSettings,
    setShowSettings,
    connect,
    disconnect,
    loadConversations,
    loadTasks,
    loadHeartbeatStatus,
    loadMemoryStats,
    initListeners,
  } = useWhatsAppStore()

  // Initialize IPC listeners on mount
  useEffect(() => {
    const cleanup = initListeners()
    return cleanup
  }, [initListeners])

  // Load initial data when connected
  useEffect(() => {
    if (connectionState.status === 'connected') {
      loadConversations()
      loadTasks()
      loadHeartbeatStatus()
      loadMemoryStats()
    }
  }, [connectionState.status, loadConversations, loadTasks, loadHeartbeatStatus, loadMemoryStats])

  const isConnected = connectionState.status === 'connected'
  const isConnecting =
    connectionState.status === 'connecting' ||
    connectionState.status === 'qr_ready' ||
    connectionState.status === 'pairing' ||
    connectionState.status === 'reconnecting'

  const statusColor = isConnected
    ? 'bg-green-500'
    : isConnecting
      ? 'bg-yellow-500'
      : 'bg-zinc-500'

  const statusText = {
    disconnected: 'Disconnected',
    connecting: 'Connecting...',
    qr_ready: 'Scan QR Code',
    pairing: 'Pairing...',
    connected: 'Connected',
    reconnecting: `Reconnecting (${connectionState.reconnectAttempt})...`,
    logged_out: 'Logged Out',
  }[connectionState.status]

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="p-1.5 rounded-lg bg-green-500/10">
            <MessageCircle className="h-5 w-5 text-green-500" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">WhatsApp Assistant</h1>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className={cn('h-2 w-2 rounded-full', statusColor)} />
              {statusText}
              {connectionState.phoneNumber && (
                <span className="ml-1">({connectionState.phoneNumber})</span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isConnected ? (
            <Button variant="outline" size="sm" onClick={disconnect}>
              <WifiOff className="h-4 w-4 mr-1" />
              Disconnect
            </Button>
          ) : (
            <Button
              variant="default"
              size="sm"
              onClick={connect}
              disabled={isConnecting}
            >
              {isConnecting ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Wifi className="h-4 w-4 mr-1" />
              )}
              Connect
            </Button>
          )}

          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowSettings(!showSettings)}
            className={cn(showSettings && 'bg-accent')}
          >
            <Settings2 className="h-4 w-4" />
          </Button>

          {onClose && (
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Main content - 3-column layout */}
      <div className="flex-1 flex min-h-0">
        {/* Left: Conversation list */}
        <div className="w-[250px] border-r border-border shrink-0">
          <ConversationList />
        </div>

        {/* Center: Chat window */}
        <div className="flex-1 min-w-0">
          <ChatWindow />
        </div>

        {/* Right: Settings panel (toggleable) */}
        {showSettings && (
          <div className="w-[300px] border-l border-border shrink-0 overflow-auto">
            <WhatsAppSettings onClose={() => setShowSettings(false)} />
          </div>
        )}
      </div>

      {/* QR Code Modal */}
      {showQrModal && <QrCodeModal />}
    </div>
  )
}

export default WhatsAppView

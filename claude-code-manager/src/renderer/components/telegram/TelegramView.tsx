/**
 * TelegramView - Sidebar panel for Telegram bot management.
 *
 * Top bar: connection status + Connect/Disconnect + Settings gear
 * Content: Bot token input (disconnected), message log (connected), settings toggle
 */

import React, { useEffect, useState } from 'react'
import { Send, Wifi, WifiOff, Loader2, Settings2, X, Bot } from 'lucide-react'
import { Button } from '../ui/button'
import { TelegramSettings } from './TelegramSettings'
import { useTelegramStore } from '@renderer/stores/telegram-store'
import { cn } from '@renderer/lib/utils'

interface TelegramViewProps {
  onClose?: () => void
}

export function TelegramView({ onClose }: TelegramViewProps) {
  const {
    connectionState,
    messages,
    config,
    setConnectionState,
    addMessage,
    setConfig,
  } = useTelegramStore()

  const [showSettings, setShowSettings] = useState(false)
  const [botToken, setBotToken] = useState('')
  const [connecting, setConnecting] = useState(false)

  // Initialize IPC listeners on mount
  useEffect(() => {
    const unsubs: Array<() => void> = []

    if (window.electron.telegram) {
      unsubs.push(
        window.electron.telegram.onConnectionUpdate((state) => {
          setConnectionState(state)
        }),
      )

      unsubs.push(
        window.electron.telegram.onMessageReceived((msg) => {
          addMessage(msg)
        }),
      )

      // Load initial status
      window.electron.telegram.getStatus().then((result) => {
        if (result.success && result.data) {
          setConnectionState(result.data)
        }
      })

      // Load config
      window.electron.telegram.configGet().then((result) => {
        if (result.success && result.data) {
          setConfig(result.data)
          if (result.data.botToken) setBotToken(result.data.botToken)
        }
      })
    }

    return () => unsubs.forEach((u) => u())
  }, [setConnectionState, addMessage, setConfig])

  const handleConnect = async () => {
    if (!window.electron.telegram) return
    setConnecting(true)
    try {
      // Save token first
      if (botToken) {
        await window.electron.telegram.configSet({ botToken, enabled: true })
      }
      await window.electron.telegram.connect()
    } catch (err) {
      console.error('[TelegramView] Connect error:', err)
    }
    setConnecting(false)
  }

  const handleDisconnect = async () => {
    if (!window.electron.telegram) return
    try {
      await window.electron.telegram.disconnect()
    } catch (err) {
      console.error('[TelegramView] Disconnect error:', err)
    }
  }

  const isConnected = connectionState.status === 'connected'
  const isConnecting = connectionState.status === 'connecting' || connecting

  const statusColor = isConnected
    ? 'text-green-500'
    : isConnecting
      ? 'text-yellow-500'
      : 'text-zinc-500'

  const StatusIcon = isConnected ? Wifi : isConnecting ? Loader2 : WifiOff

  if (showSettings) {
    return <TelegramSettings onClose={() => setShowSettings(false)} />
  }

  return (
    <div className="h-full flex flex-col bg-card rounded-lg border border-border overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Send className="h-4 w-4 text-blue-500" />
          <h2 className="text-lg font-semibold">Telegram</h2>
          <StatusIcon
            className={cn('h-4 w-4', statusColor, isConnecting && 'animate-spin')}
          />
          {isConnected && connectionState.botUsername && (
            <span className="text-xs text-muted-foreground">
              @{connectionState.botUsername}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShowSettings(true)}
            className="h-8 w-8"
          >
            <Settings2 className="h-4 w-4" />
          </Button>
          {onClose && (
            <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {/* Connection Section */}
        {!isConnected && (
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium mb-1 block">Bot Token</label>
              <input
                type="password"
                value={botToken}
                onChange={(e) => setBotToken(e.target.value)}
                placeholder="Enter your Telegram bot token..."
                className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Get a token from @BotFather on Telegram
              </p>
            </div>
            <Button
              onClick={handleConnect}
              disabled={!botToken || isConnecting}
              className="w-full"
            >
              {isConnecting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Connecting...
                </>
              ) : (
                <>
                  <Wifi className="h-4 w-4 mr-2" />
                  Connect Bot
                </>
              )}
            </Button>
            {connectionState.error && (
              <p className="text-xs text-red-500">{connectionState.error}</p>
            )}
          </div>
        )}

        {/* Connected State */}
        {isConnected && (
          <div className="space-y-4">
            {/* Bot Info */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-green-500/10 border border-green-500/20">
              <div className="flex items-center gap-2">
                <Bot className="h-5 w-5 text-green-500" />
                <div>
                  <p className="text-sm font-medium">Bot Connected</p>
                  {connectionState.botUsername && (
                    <p className="text-xs text-muted-foreground">
                      @{connectionState.botUsername}
                    </p>
                  )}
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={handleDisconnect}>
                Disconnect
              </Button>
            </div>

            {/* Allowed Users */}
            {config?.allowedUserIds && config.allowedUserIds.length > 0 && (
              <div>
                <h3 className="text-sm font-medium mb-2">Allowed Users</h3>
                <div className="flex flex-wrap gap-1">
                  {config.allowedUserIds.map((id) => (
                    <span
                      key={id}
                      className="text-xs bg-muted px-2 py-1 rounded-md"
                    >
                      {id}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Message Log */}
            <div>
              <h3 className="text-sm font-medium mb-2">
                Recent Messages ({messages.length})
              </h3>
              <div className="space-y-2 max-h-[400px] overflow-auto">
                {messages.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-4 text-center">
                    No messages yet. Send a message to your bot on Telegram.
                  </p>
                ) : (
                  messages.slice(-20).reverse().map((msg) => (
                    <div
                      key={msg.id}
                      className={cn(
                        'p-2 rounded-lg text-sm',
                        msg.isFromMe
                          ? 'bg-primary/10 ml-4'
                          : 'bg-muted mr-4',
                      )}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium">
                          {msg.isFromMe ? 'Bot' : msg.senderName || msg.senderId}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {new Date(msg.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                      <p className="text-xs whitespace-pre-wrap break-words">
                        {msg.content}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

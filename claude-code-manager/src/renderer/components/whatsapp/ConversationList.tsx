/**
 * Conversation List - Left sidebar
 *
 * Scrollable list of conversations with search, unread badges,
 * active highlighting, and context menu for management.
 */

import React, { useState, useMemo, useRef, useEffect } from 'react'
import { Search, Circle, MessageCircle, Bot } from 'lucide-react'
import { useWhatsAppStore } from '@renderer/stores/whatsapp-store'
import { cn } from '@renderer/lib/utils'
import type { WhatsAppConversation } from '@shared/whatsapp-types'

function formatRelativeTime(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  if (hours < 24) return `${hours}h`
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days}d`
  return new Date(timestamp).toLocaleDateString()
}

function getAvatarLetter(name: string): string {
  return (name || '?').charAt(0).toUpperCase()
}

function getAvatarColor(jid: string): string {
  const colors = [
    'bg-blue-500',
    'bg-green-500',
    'bg-purple-500',
    'bg-orange-500',
    'bg-pink-500',
    'bg-cyan-500',
    'bg-indigo-500',
    'bg-rose-500',
  ]
  let hash = 0
  for (const ch of jid) hash = ((hash << 5) - hash + ch.charCodeAt(0)) | 0
  return colors[Math.abs(hash) % colors.length]
}

interface ContextMenuState {
  visible: boolean
  x: number
  y: number
  jid: string
}

export function ConversationList() {
  const {
    conversations,
    activeConversationJid,
    setActiveConversation,
    loadMessages,
    messages,
  } = useWhatsAppStore()

  const [searchQuery, setSearchQuery] = useState('')
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    jid: '',
  })
  const contextMenuRef = useRef<HTMLDivElement>(null)

  // Close context menu on outside click
  useEffect(() => {
    const handleClick = () => setContextMenu((prev) => ({ ...prev, visible: false }))
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [])

  // Filter and sort conversations
  const filtered = useMemo(() => {
    let list = [...conversations]

    // Filter by search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      list = list.filter((c) => c.name.toLowerCase().includes(q))
    }

    // Sort by last message time (most recent first)
    list.sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0))

    return list
  }, [conversations, searchQuery])

  const handleSelect = (jid: string) => {
    setActiveConversation(jid)
    // Load messages if not already loaded
    if (!messages[jid]) {
      loadMessages(jid)
    }
  }

  const handleContextMenu = (e: React.MouseEvent, jid: string) => {
    e.preventDefault()
    setContextMenu({ visible: true, x: e.clientX, y: e.clientY, jid })
  }

  const handleSetMode = async (jid: string, mode: string) => {
    try {
      await window.electron.whatsapp.setMode(jid, mode as any)
    } catch (err) {
      console.error('[ConversationList] Set mode error:', err)
    }
    setContextMenu((prev) => ({ ...prev, visible: false }))
  }

  const handleRegister = async (jid: string) => {
    try {
      await window.electron.whatsapp.registerConversation(jid, { isRegistered: true })
    } catch (err) {
      console.error('[ConversationList] Register error:', err)
    }
    setContextMenu((prev) => ({ ...prev, visible: false }))
  }

  const handleUnregister = async (jid: string) => {
    try {
      await window.electron.whatsapp.unregisterConversation(jid)
    } catch (err) {
      console.error('[ConversationList] Unregister error:', err)
    }
    setContextMenu((prev) => ({ ...prev, visible: false }))
  }

  const contextConversation = conversations.find((c) => c.jid === contextMenu.jid)

  return (
    <div className="h-full flex flex-col">
      {/* Search */}
      <div className="p-3 border-b border-border">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search conversations..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-4">
            <MessageCircle className="h-8 w-8 mb-2 opacity-50" />
            <p className="text-sm text-center">
              {searchQuery ? 'No matching conversations' : 'No conversations yet'}
            </p>
          </div>
        ) : (
          <div className="py-1">
            {filtered.map((convo) => (
              <button
                key={convo.jid}
                onClick={() => handleSelect(convo.jid)}
                onContextMenu={(e) => handleContextMenu(e, convo.jid)}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors',
                  convo.jid === activeConversationJid
                    ? 'bg-primary/10'
                    : 'hover:bg-accent/50'
                )}
              >
                {/* Avatar */}
                <div
                  className={cn(
                    'h-9 w-9 rounded-full flex items-center justify-center text-white text-sm font-medium shrink-0',
                    getAvatarColor(convo.jid)
                  )}
                >
                  {getAvatarLetter(convo.name)}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1">
                    <span className="text-sm font-medium truncate flex-1">
                      {convo.name}
                    </span>
                    {convo.lastMessageAt > 0 && (
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {formatRelativeTime(convo.lastMessageAt)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    {convo.isRegistered && (
                      <Bot className="h-3 w-3 text-primary shrink-0" />
                    )}
                    <span className="text-xs text-muted-foreground truncate">
                      {convo.chatType === 'group' ? 'Group' : convo.chatType === 'self' ? 'Self' : 'DM'}
                      {convo.agentMode !== 'auto' && ` · ${convo.agentMode}`}
                    </span>
                  </div>
                </div>

                {/* Unread badge */}
                {convo.unreadCount > 0 && (
                  <span className="bg-primary text-primary-foreground text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center shrink-0">
                    {convo.unreadCount > 99 ? '99+' : convo.unreadCount}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Context menu */}
      {contextMenu.visible && (
        <div
          ref={contextMenuRef}
          className="fixed z-50 bg-popover border border-border rounded-md shadow-lg py-1 min-w-[160px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextConversation?.isRegistered ? (
            <button
              onClick={() => handleUnregister(contextMenu.jid)}
              className="w-full px-3 py-1.5 text-sm text-left hover:bg-accent"
            >
              Unregister
            </button>
          ) : (
            <button
              onClick={() => handleRegister(contextMenu.jid)}
              className="w-full px-3 py-1.5 text-sm text-left hover:bg-accent"
            >
              Register (Enable Bot)
            </button>
          )}
          <div className="h-px bg-border my-1" />
          <div className="px-3 py-1 text-[10px] text-muted-foreground uppercase tracking-wide">
            Mode
          </div>
          {(['auto', 'chat', 'quick_fix', 'research', 'bvs_spawn'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => handleSetMode(contextMenu.jid, mode)}
              className={cn(
                'w-full px-3 py-1.5 text-sm text-left hover:bg-accent',
                contextConversation?.agentMode === mode && 'text-primary font-medium'
              )}
            >
              {mode}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default ConversationList

/**
 * Chat Window - Center panel
 *
 * Full chat interface with message list, streaming indicator,
 * markdown rendering, and input area with mode selector.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react'
import {
  Send,
  ChevronDown,
  Bot,
  User,
  Loader2,
  MessageCircle,
} from 'lucide-react'
import { Button } from '../ui/button'
import { useWhatsAppStore } from '@renderer/stores/whatsapp-store'
import { cn } from '@renderer/lib/utils'
import type { WhatsAppMessage, WhatsAppAgentMode } from '@shared/whatsapp-types'

const MODES: { value: WhatsAppAgentMode; label: string; description: string }[] = [
  { value: 'auto', label: 'Auto', description: 'Detect mode from message' },
  { value: 'chat', label: 'Chat', description: 'Conversational with memory' },
  { value: 'quick_fix', label: 'Quick Fix', description: 'Fast, minimal tools' },
  { value: 'research', label: 'Research', description: 'Web search, thorough' },
  { value: 'bvs_spawn', label: 'BVS Spawn', description: 'Full orchestration' },
]

function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const isToday =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear()

  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (isToday) return time

  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  const isYesterday =
    date.getDate() === yesterday.getDate() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getFullYear() === yesterday.getFullYear()

  if (isYesterday) return `Yesterday ${time}`
  return `${date.toLocaleDateString()} ${time}`
}

function renderMessageContent(content: string): React.ReactNode {
  // Simple markdown-like rendering: code blocks, bold, lists
  const lines = content.split('\n')
  const elements: React.ReactNode[] = []
  let inCodeBlock = false
  let codeContent: string[] = []
  let codeLang = ''

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (line.startsWith('```')) {
      if (inCodeBlock) {
        elements.push(
          <pre
            key={`code-${i}`}
            className="bg-zinc-900 text-zinc-100 rounded-md p-3 my-1 text-xs overflow-x-auto"
          >
            <code>{codeContent.join('\n')}</code>
          </pre>
        )
        codeContent = []
        codeLang = ''
        inCodeBlock = false
      } else {
        inCodeBlock = true
        codeLang = line.slice(3).trim()
      }
      continue
    }

    if (inCodeBlock) {
      codeContent.push(line)
      continue
    }

    // Bold: **text**
    let formatted = line.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    // Inline code: `text`
    formatted = formatted.replace(/`(.+?)`/g, '<code class="bg-muted px-1 rounded text-xs">$1</code>')
    // Bullet lists
    if (formatted.match(/^[-*]\s/)) {
      formatted = `<span class="text-muted-foreground mr-1">\u2022</span>${formatted.slice(2)}`
    }

    elements.push(
      <div
        key={`line-${i}`}
        className={cn(line === '' && 'h-2')}
        dangerouslySetInnerHTML={{ __html: formatted || '&nbsp;' }}
      />
    )
  }

  // Close any unclosed code block
  if (inCodeBlock && codeContent.length > 0) {
    elements.push(
      <pre
        key="code-final"
        className="bg-zinc-900 text-zinc-100 rounded-md p-3 my-1 text-xs overflow-x-auto"
      >
        <code>{codeContent.join('\n')}</code>
      </pre>
    )
  }

  return <>{elements}</>
}

function MessageBubble({ msg }: { msg: WhatsAppMessage }) {
  const isOutbound = msg.direction === 'outbound'
  const isAgent = msg.isFromMe && msg.agentSessionId

  return (
    <div className={cn('flex mb-2', isOutbound ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[70%] rounded-lg px-3 py-2 text-sm',
          isOutbound
            ? isAgent
              ? 'bg-purple-500/20 text-foreground'
              : 'bg-primary text-primary-foreground'
            : 'bg-muted text-foreground'
        )}
      >
        {/* Sender name for groups */}
        {!isOutbound && msg.senderName && (
          <div className="text-xs font-medium text-primary mb-0.5">
            {msg.senderName}
          </div>
        )}

        {/* Quoted message */}
        {msg.quotedMessageId && (
          <div className="border-l-2 border-primary/50 pl-2 mb-1 text-xs text-muted-foreground italic">
            Reply
          </div>
        )}

        {/* Content */}
        <div className="whitespace-pre-wrap break-words">
          {renderMessageContent(msg.content)}
        </div>

        {/* Timestamp and agent badge */}
        <div className="flex items-center gap-1 mt-1 justify-end">
          {isAgent && <Bot className="h-3 w-3 text-purple-400" />}
          <span className="text-[10px] opacity-60">{formatTime(msg.timestamp)}</span>
        </div>
      </div>
    </div>
  )
}

export function ChatWindow() {
  const {
    activeConversationJid,
    messages,
    conversations,
    agentStreaming,
    agentStreamText,
    sendMessage,
  } = useWhatsAppStore()

  const [inputText, setInputText] = useState('')
  const [showModeSelector, setShowModeSelector] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const currentMessages = activeConversationJid ? messages[activeConversationJid] || [] : []
  const currentConversation = conversations.find((c) => c.jid === activeConversationJid)
  const isStreaming = activeConversationJid ? agentStreaming[activeConversationJid] : false
  const streamText = activeConversationJid ? agentStreamText[activeConversationJid] : ''

  // Auto-scroll to bottom on new messages
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [currentMessages.length, streamText, scrollToBottom])

  // Handle send
  const handleSend = async () => {
    if (!inputText.trim() || !activeConversationJid) return
    const text = inputText.trim()
    setInputText('')
    await sendMessage(activeConversationJid, text)
    inputRef.current?.focus()
  }

  // Handle key press
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // Handle mode change
  const handleModeChange = async (mode: WhatsAppAgentMode) => {
    if (!activeConversationJid) return
    try {
      await window.electron.whatsapp.setMode(activeConversationJid, mode)
    } catch (err) {
      console.error('[ChatWindow] Set mode error:', err)
    }
    setShowModeSelector(false)
  }

  // Empty state
  if (!activeConversationJid) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
        <MessageCircle className="h-12 w-12 mb-4 opacity-50" />
        <h3 className="text-lg font-medium mb-1">No conversation selected</h3>
        <p className="text-sm">Select a conversation from the sidebar to start chatting</p>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Chat header */}
      <div className="px-4 py-2.5 border-b border-border flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-medium truncate">
            {currentConversation?.name || activeConversationJid}
          </h2>
          <span className="text-xs text-muted-foreground">
            {currentConversation?.chatType === 'group' ? 'Group' : 'Direct'}
            {currentConversation?.isRegistered && ' · Bot active'}
          </span>
        </div>
        <div className="relative">
          <Button
            variant="outline"
            size="sm"
            className="text-xs"
            onClick={() => setShowModeSelector(!showModeSelector)}
          >
            {currentConversation?.agentMode || 'auto'}
            <ChevronDown className="h-3 w-3 ml-1" />
          </Button>
          {showModeSelector && (
            <div className="absolute right-0 top-full mt-1 z-50 bg-popover border border-border rounded-md shadow-lg py-1 min-w-[180px]">
              {MODES.map((m) => (
                <button
                  key={m.value}
                  onClick={() => handleModeChange(m.value)}
                  className={cn(
                    'w-full px-3 py-2 text-left hover:bg-accent text-sm',
                    currentConversation?.agentMode === m.value && 'text-primary font-medium'
                  )}
                >
                  <div>{m.label}</div>
                  <div className="text-[10px] text-muted-foreground">{m.description}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-auto p-4">
        {currentMessages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} />
        ))}

        {/* Streaming indicator */}
        {isStreaming && (
          <div className="flex justify-start mb-2">
            <div className="max-w-[70%] rounded-lg px-3 py-2 text-sm bg-purple-500/20 text-foreground">
              {streamText ? (
                <div className="whitespace-pre-wrap break-words">
                  {renderMessageContent(streamText)}
                  <span className="inline-block w-1.5 h-4 bg-purple-400 animate-pulse ml-0.5 align-middle" />
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-purple-400" />
                  <span className="text-xs text-muted-foreground">Agent is thinking...</span>
                </div>
              )}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="px-4 py-3 border-t border-border">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message... (Shift+Enter for new line)"
            rows={1}
            className="flex-1 resize-none rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary max-h-32"
            style={{ minHeight: '38px' }}
          />
          <Button
            size="sm"
            onClick={handleSend}
            disabled={!inputText.trim()}
            className="shrink-0"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}

export default ChatWindow

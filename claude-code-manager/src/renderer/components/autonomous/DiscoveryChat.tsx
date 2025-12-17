/**
 * DiscoveryChat Component
 *
 * Phase 2: Discovery chat - user describes what they want to build,
 * research agents analyze the codebase and gather best practices.
 *
 * FEAT-019: Integrated with Discovery Chat Service backend.
 * - Creates discovery session on mount
 * - Subscribes to streaming response events
 * - Shows real-time agent status updates
 * - Displays streaming response as it arrives
 */

import React, { useState, useRef, useEffect, useCallback } from 'react'
import { Send, Bot, User, Loader2, Cpu, FileText, XCircle, AlertCircle, StopCircle } from 'lucide-react'
import { Button } from '../ui/button'
import { useAutonomousStore } from '@renderer/stores/autonomous-store'
import { cn } from '@renderer/lib/utils'
import type { DiscoveryChatMessage, DiscoveryAgentStatus, DiscoverySession } from '../../../preload/index'

// Minimum number of user messages before showing "Generate Spec" button
const MIN_MESSAGES_FOR_SPEC = 2

export function DiscoveryChat() {
  const {
    chatMessages,
    agentStatuses,
    addChatMessage,
    updateAgentStatus,
    clearAgentStatuses,
    goToNextPhase,
    selectedProject
  } = useAutonomousStore()

  const [input, setInput] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [streamingContent, setStreamingContent] = useState('')
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const cleanupRef = useRef<(() => void)[]>([])
  const hasInitializedRef = useRef(false)

  // Count user messages for "Generate Spec" button visibility
  const userMessageCount = chatMessages.filter(m => m.role === 'user').length

  // Auto-scroll to bottom when messages change or streaming content updates
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages, streamingContent])

  // Create discovery session when component mounts
  useEffect(() => {
    if (!selectedProject) return

    const initSession = async () => {
      try {
        setError(null)
        const result = await window.electron.discovery.createSession(
          selectedProject.path,
          selectedProject.isNew
        )

        if (result.success && result.session) {
          setSessionId(result.session.id)

          // Add initial messages only once (use ref to prevent duplicates from React StrictMode)
          if (!hasInitializedRef.current) {
            hasInitializedRef.current = true
            addChatMessage({
              role: 'system',
              content: `Starting discovery for ${selectedProject.isNew ? 'new' : 'existing'} project: ${selectedProject.name}`
            })
            addChatMessage({
              role: 'assistant',
              content: `Welcome! I'll help you plan your ${selectedProject.isNew ? 'new project' : 'feature'}.\n\nPlease describe what you want to build. Be as detailed as possible about:\n- The main features and functionality\n- Any specific technologies or patterns you want to use\n- Integration requirements\n- User experience expectations`
            })
          }
        } else {
          setError(result.error || 'Failed to create discovery session')
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to initialize session'
        setError(message)
      }
    }

    initSession()

    // Cleanup on unmount
    return () => {
      if (sessionId) {
        window.electron.discovery.closeSession(sessionId).catch(console.error)
      }
    }
  }, [selectedProject]) // eslint-disable-line react-hooks/exhaustive-deps

  // Subscribe to discovery events
  useEffect(() => {
    if (!sessionId) return

    // Response chunk handler - accumulate streaming content
    const unsubChunk = window.electron.discovery.onResponseChunk((data) => {
      if (data.sessionId !== sessionId) return

      setStreamingMessageId(data.messageId)
      setStreamingContent(prev => prev + data.chunk)
    })
    cleanupRef.current.push(unsubChunk)

    // Response complete handler
    const unsubComplete = window.electron.discovery.onResponseComplete((data) => {
      if (data.sessionId !== sessionId || !data.message) return

      // Add the complete message to the store
      addChatMessage({
        role: data.message.role,
        content: data.message.content
      })

      // Clear streaming state
      setStreamingContent('')
      setStreamingMessageId(null)
      setIsProcessing(false)
    })
    cleanupRef.current.push(unsubComplete)

    // Agent status handler
    const unsubAgent = window.electron.discovery.onAgentStatus((data) => {
      if (data.sessionId !== sessionId) return

      updateAgentStatus(
        data.agent.name,
        data.agent.status,
        data.agent.output,
        data.agent.error
      )
    })
    cleanupRef.current.push(unsubAgent)

    // Error handler
    const unsubError = window.electron.discovery.onError((data) => {
      if (data.sessionId !== sessionId) return

      setError(data.error)
      setIsProcessing(false)
      setStreamingContent('')
      setStreamingMessageId(null)
    })
    cleanupRef.current.push(unsubError)

    // Cleanup function
    return () => {
      cleanupRef.current.forEach(unsub => unsub())
      cleanupRef.current = []
    }
  }, [sessionId, addChatMessage, updateAgentStatus])

  const handleSend = useCallback(async () => {
    if (!input.trim() || isProcessing || !sessionId) return

    const userMessage = input.trim()
    setInput('')
    setIsProcessing(true)
    setError(null)

    // Add user message to store
    addChatMessage({ role: 'user', content: userMessage })

    try {
      // Send message to backend service
      const result = await window.electron.discovery.sendMessage(sessionId, userMessage)

      if (!result.success) {
        setError(result.error || 'Failed to send message')
        setIsProcessing(false)
      }
      // Response will come through the streaming events
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to send message'
      setError(message)
      setIsProcessing(false)
    }
  }, [input, isProcessing, sessionId, addChatMessage])

  const handleKeyPress = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])

  const handleCancel = useCallback(async () => {
    try {
      await window.electron.discovery.cancelRequest()
      setIsProcessing(false)
      setStreamingContent('')
      setStreamingMessageId(null)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('Failed to cancel request:', message)
    }
  }, [])

  // Proceed to spec review phase
  const handleProceedToSpec = () => {
    goToNextPhase()
  }

  const clearError = () => setError(null)

  // Get agent status color with exhaustive type checking
  const getAgentStatusColor = (status: DiscoveryAgentStatus['status']): string => {
    switch (status) {
      case 'running':
        return 'bg-blue-500/20 text-blue-500'
      case 'complete':
        return 'bg-emerald-500/20 text-emerald-500'
      case 'error':
        return 'bg-red-500/20 text-red-500'
      case 'idle':
        return 'bg-secondary text-muted-foreground'
      default: {
        // Exhaustive check - TypeScript will error if new statuses are added
        const _exhaustive: never = status
        return _exhaustive
      }
    }
  }

  return (
    <div className="h-full flex">
      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Error Display */}
        {error && (
          <div className="mx-4 mt-3 p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
            <div className="flex-1 text-sm text-red-500">{error}</div>
            <Button
              variant="ghost"
              size="icon"
              onClick={clearError}
              className="h-6 w-6 shrink-0 hover:bg-red-500/20"
            >
              <XCircle className="h-4 w-4 text-red-500" />
            </Button>
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {chatMessages.map((message) => (
            <div
              key={message.id}
              className={cn(
                'flex gap-3',
                message.role === 'user' ? 'justify-end' : 'justify-start'
              )}
            >
              {message.role !== 'user' && (
                <div className={cn(
                  'h-8 w-8 rounded-full flex items-center justify-center shrink-0',
                  message.role === 'assistant' ? 'bg-primary/10' : 'bg-secondary'
                )}>
                  <Bot className="h-4 w-4" />
                </div>
              )}
              <div
                className={cn(
                  'max-w-[80%] rounded-lg px-4 py-2',
                  message.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : message.role === 'system'
                    ? 'bg-secondary/50 text-muted-foreground text-sm italic'
                    : 'bg-secondary'
                )}
              >
                <p className="whitespace-pre-wrap">{message.content}</p>
                <span className="text-xs opacity-50 mt-1 block">
                  {new Date(message.timestamp).toLocaleTimeString()}
                </span>
              </div>
              {message.role === 'user' && (
                <div className="h-8 w-8 rounded-full bg-secondary flex items-center justify-center shrink-0">
                  <User className="h-4 w-4" />
                </div>
              )}
            </div>
          ))}

          {/* Streaming response display */}
          {streamingContent && (
            <div className="flex gap-3 justify-start">
              <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <Bot className="h-4 w-4" />
              </div>
              <div className="max-w-[80%] rounded-lg px-4 py-2 bg-secondary">
                <p className="whitespace-pre-wrap">{streamingContent}</p>
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground mt-1">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Streaming...
                </span>
              </div>
            </div>
          )}

          {/* Processing indicator (before streaming starts) */}
          {isProcessing && !streamingContent && (
            <div className="flex gap-3 justify-start">
              <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <Bot className="h-4 w-4" />
              </div>
              <div className="rounded-lg px-4 py-2 bg-secondary">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Thinking...</span>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="border-t border-border p-4">
          <div className="flex gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder={sessionId ? "Describe what you want to build..." : "Initializing session..."}
              className={cn(
                'flex-1 min-h-[60px] max-h-[200px] p-3 rounded-lg',
                'bg-secondary border border-border resize-none',
                'focus:outline-none focus:ring-2 focus:ring-primary',
                'disabled:opacity-50 disabled:cursor-not-allowed'
              )}
              disabled={isProcessing || !sessionId}
              aria-label="Chat message input"
            />
            <div className="flex flex-col gap-2">
              {isProcessing ? (
                <Button
                  onClick={handleCancel}
                  variant="destructive"
                  className="h-[60px] px-4"
                  aria-label="Cancel request"
                >
                  <StopCircle className="h-4 w-4" />
                </Button>
              ) : (
                <Button
                  onClick={handleSend}
                  disabled={!input.trim() || !sessionId}
                  className="h-[60px] px-4"
                  aria-label="Send message"
                >
                  <Send className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>

          {/* Generate Spec button - shown after sufficient conversation */}
          <div className="mt-4 flex justify-end gap-2">
            {userMessageCount >= MIN_MESSAGES_FOR_SPEC && !isProcessing && (
              <Button onClick={handleProceedToSpec} variant="default" className="gap-2">
                <FileText className="h-4 w-4" />
                Generate Spec
              </Button>
            )}
            {userMessageCount < MIN_MESSAGES_FOR_SPEC && (
              <p className="text-xs text-muted-foreground">
                Continue the conversation to generate a specification.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Agent Status Sidebar */}
      <div className="w-64 border-l border-border p-4 shrink-0">
        <h3 className="font-medium text-sm mb-3 flex items-center gap-2">
          <Cpu className="h-4 w-4" />
          Research Agents
        </h3>
        <div className="space-y-3">
          {agentStatuses.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Agents will be activated when you describe your requirements.
            </p>
          ) : (
            agentStatuses.map((agent) => (
              <div
                key={agent.name}
                className="p-2 bg-secondary/50 rounded text-sm"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{agent.name}</span>
                  <span className={cn(
                    'text-xs px-1.5 py-0.5 rounded',
                    getAgentStatusColor(agent.status)
                  )}>
                    {agent.status}
                  </span>
                </div>
                {agent.output && (
                  <p className="text-xs text-muted-foreground mt-1 truncate" title={agent.output}>
                    {agent.output}
                  </p>
                )}
                {agent.error && (
                  <p className="text-xs text-red-500 mt-1 truncate" title={agent.error}>
                    {agent.error}
                  </p>
                )}
              </div>
            ))
          )}

          {/* Placeholder agents - future features */}
          <div className="space-y-2 opacity-50">
            <div className="p-2 bg-secondary/30 rounded text-xs">
              <span className="font-medium">Process Agent</span>
              <span className="text-muted-foreground ml-2">(FEAT-020)</span>
            </div>
            <div className="p-2 bg-secondary/30 rounded text-xs">
              <span className="font-medium">Codebase Analyzer</span>
              <span className="text-muted-foreground ml-2">(FEAT-021)</span>
            </div>
            <div className="p-2 bg-secondary/30 rounded text-xs">
              <span className="font-medium">Spec Builder</span>
              <span className="text-muted-foreground ml-2">(FEAT-022)</span>
            </div>
          </div>
        </div>

        {/* Session Info */}
        {sessionId && (
          <div className="mt-6 pt-4 border-t border-border">
            <h4 className="text-xs font-medium text-muted-foreground mb-2">Session</h4>
            <p className="text-xs font-mono text-muted-foreground truncate" title={sessionId}>
              {sessionId}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

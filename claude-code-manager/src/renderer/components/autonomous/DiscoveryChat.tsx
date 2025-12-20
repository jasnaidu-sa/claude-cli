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
import { Send, Bot, User, Loader2, Cpu, FileText, XCircle, AlertCircle, StopCircle, Gauge, TrendingUp, Zap, Building2 } from 'lucide-react'
import { Button } from '../ui/button'
import { useAutonomousStore } from '@renderer/stores/autonomous-store'
import { cn } from '@renderer/lib/utils'
import type { DiscoveryChatMessage, DiscoveryAgentStatus, DiscoverySession } from '../../../preload/index'
import type { ComplexityAnalysis } from '../../../shared/types'

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
    setPhase,
    selectedProject
  } = useAutonomousStore()

  const [input, setInput] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [streamingContent, setStreamingContent] = useState('')
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Track tool activity for "thinking" display
  const [activeTools, setActiveTools] = useState<Array<{ name: string; status: 'running' | 'complete'; timestamp: number }>>([])
  const [thinkingEvents, setThinkingEvents] = useState<Array<{ type: string; content: string; timestamp: number }>>([])
  // BMAD-Inspired: Complexity analysis for adaptive spec mode
  const [complexityAnalysis, setComplexityAnalysis] = useState<ComplexityAnalysis | null>(null)
  const [isAnalyzingComplexity, setIsAnalyzingComplexity] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const cleanupRef = useRef<(() => void)[]>([])
  const hasInitializedRef = useRef(false)
  const lastProjectPathRef = useRef<string | null>(null)

  // Count user messages for "Generate Spec" button visibility
  const userMessageCount = chatMessages.filter(m => m.role === 'user').length

  // BMAD-Inspired: Analyze complexity when conversation progresses
  const analyzeComplexity = useCallback(async () => {
    if (!sessionId || isAnalyzingComplexity) return

    setIsAnalyzingComplexity(true)
    try {
      const result = await window.electron.discovery.analyzeComplexity(sessionId)
      if (result.success && result.analysis) {
        setComplexityAnalysis(result.analysis)
      }
    } catch (err) {
      console.error('Failed to analyze complexity:', err)
    } finally {
      setIsAnalyzingComplexity(false)
    }
  }, [sessionId, isAnalyzingComplexity])

  // Trigger complexity analysis after user sends messages
  useEffect(() => {
    if (userMessageCount >= MIN_MESSAGES_FOR_SPEC && sessionId && !isProcessing && !complexityAnalysis) {
      analyzeComplexity()
    }
  }, [userMessageCount, sessionId, isProcessing, complexityAnalysis, analyzeComplexity])

  // Auto-scroll to bottom when messages change or streaming content updates
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages, streamingContent])

  // Create discovery session when component mounts
  useEffect(() => {
    if (!selectedProject) return

    // Reset initialization flag if project changed
    if (lastProjectPathRef.current !== selectedProject.path) {
      console.log('[DiscoveryChat] Project changed, resetting initialization')
      hasInitializedRef.current = false
      lastProjectPathRef.current = selectedProject.path
      // Also reset local state
      setStreamingContent('')
      setStreamingMessageId(null)
      setActiveTools([])
      setThinkingEvents([])
      setError(null)
      // CRITICAL: Clear old agent statuses from previous sessions
      clearAgentStatuses()
    }

    const initSession = async () => {
      try {
        setError(null)
        // Clear any old agent statuses before creating new session
        clearAgentStatuses()

        const result = await window.electron.discovery.createSession(
          selectedProject.path,
          selectedProject.isNew
        )

        if (result.success && result.session) {
          setSessionId(result.session.id)

          // Check if session was loaded from disk with existing messages
          const loadedMessages = result.session.messages || []
          const hasExistingMessages = loadedMessages.length > 1 // More than just system message

          // Add initial messages only once (use ref to prevent duplicates from React StrictMode)
          if (!hasInitializedRef.current) {
            hasInitializedRef.current = true

            if (hasExistingMessages) {
              // Restore messages from loaded session
              console.log('[DiscoveryChat] Restoring', loadedMessages.length, 'messages from saved session')
              for (const msg of loadedMessages) {
                // Only add if not already in the store (check by content to avoid duplicates)
                const exists = chatMessages.some(m => m.content === msg.content && m.role === msg.role)
                if (!exists) {
                  addChatMessage({
                    role: msg.role,
                    content: msg.content
                  })
                }
              }
            } else {
              // New session - add welcome messages
              addChatMessage({
                role: 'system',
                content: `Starting discovery for ${selectedProject.isNew ? 'new' : 'existing'} project: ${selectedProject.name}`
              })
              addChatMessage({
                role: 'assistant',
                content: `Welcome! I'll help you plan your ${selectedProject.isNew ? 'new project' : 'feature'}.\n\nPlease describe what you want to build. Be as detailed as possible about:\n- The main features and functionality\n- Any specific technologies or patterns you want to use\n- Integration requirements\n- User experience expectations`
              })
            }
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

    // Response chunk handler - accumulate streaming content and track tool activity
    const unsubChunk = window.electron.discovery.onResponseChunk((data) => {
      if (data.sessionId !== sessionId) return

      setStreamingMessageId(data.messageId)

      // Handle different event types for "thinking" display
      const eventType = (data as { eventType?: string }).eventType
      const toolName = (data as { toolName?: string }).toolName

      switch (eventType) {
        case 'tool_start':
          // Tool starting - add to active tools
          if (toolName) {
            setActiveTools(prev => [...prev, { name: toolName, status: 'running', timestamp: Date.now() }])
            setThinkingEvents(prev => [...prev, {
              type: 'tool_start',
              content: `🔧 Using ${toolName}...`,
              timestamp: Date.now()
            }])
          }
          break

        case 'tool_complete':
          // Tool finished - update status
          if (toolName) {
            setActiveTools(prev =>
              prev.map(t => t.name === toolName ? { ...t, status: 'complete' as const } : t)
            )
            setThinkingEvents(prev => [...prev, {
              type: 'tool_complete',
              content: `✓ ${toolName} complete`,
              timestamp: Date.now()
            }])
          }
          break

        case 'tool_result':
          // Tool result - show preview
          if (data.chunk) {
            setThinkingEvents(prev => [...prev, {
              type: 'tool_result',
              content: data.chunk,
              timestamp: Date.now()
            }])
          }
          break

        case 'thinking_start':
          setThinkingEvents(prev => [...prev, {
            type: 'thinking',
            content: '💭 Thinking...',
            timestamp: Date.now()
          }])
          break

        case 'thinking':
          // Extended thinking content - could display if needed
          break

        case 'stderr':
          // Stderr output from Claude CLI - show as warning
          if (data.chunk) {
            setThinkingEvents(prev => [...prev, {
              type: 'stderr',
              content: data.chunk,
              timestamp: Date.now()
            }])
          }
          break

        case 'system':
          // System initialization event - show progress
          // STEP 1: System messages now accumulate into streaming content for visibility
          if (data.chunk) {
            setStreamingContent(prev => prev + data.chunk)
          }
          if (toolName) {
            setThinkingEvents(prev => [...prev, {
              type: 'system',
              content: `⚙️ ${toolName}`,
              timestamp: Date.now()
            }])
          }
          break

        case 'content':
          // Streaming content from spec generation or other operations
          if (data.chunk) {
            setStreamingContent(prev => prev + data.chunk)
          }
          break

        case 'text':
        default:
          // Normal text streaming - accumulate content
          if (data.chunk) {
            setStreamingContent(prev => prev + data.chunk)
          }
          break
      }
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

      // Clear streaming state and thinking events
      setStreamingContent('')
      setStreamingMessageId(null)
      setIsProcessing(false)
      setActiveTools([])
      setThinkingEvents([])
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

    // Spec ready handler - spec generation completed successfully
    const unsubSpecReady = window.electron.discovery.onSpecReady((data) => {
      if (data.sessionId !== sessionId) return

      console.log('[DiscoveryChat] Spec ready, transitioning to spec review')
      setIsProcessing(false)
      setStreamingContent('')
      setStreamingMessageId(null)
      setActiveTools([])
      setThinkingEvents([])
      // Quick Spec skips spec_generating phase - go directly to spec_review
      // Using setPhase to skip intermediate phases that would trigger additional agents
      setPhase('spec_review')
    })
    cleanupRef.current.push(unsubSpecReady)

    // Cleanup function
    return () => {
      cleanupRef.current.forEach(unsub => unsub())
      cleanupRef.current = []
    }
  }, [sessionId, addChatMessage, updateAgentStatus, goToNextPhase, setPhase])

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

  // STEP 4: Quick Spec handler
  const handleQuickSpec = useCallback(async () => {
    if (!sessionId || isProcessing) return

    setIsProcessing(true)
    setError(null)

    try {
      const result = await window.electron.discovery.generateQuickSpec(sessionId)

      if (!result.success) {
        setError(result.error || 'Failed to generate quick spec')
        setIsProcessing(false)
      }
      // Spec generation events will come through streaming
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to generate quick spec'
      setError(message)
      setIsProcessing(false)
    }
  }, [sessionId, isProcessing])

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
        return 'bg-primary/20 text-primary'
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
                    ? 'bg-primary text-white'
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

          {/* Tool activity moved to right sidebar - just show a simple indicator here */}

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

          {/* Processing indicator (before any activity) */}
          {isProcessing && !streamingContent && thinkingEvents.length === 0 && (
            <div className="flex gap-3 justify-start">
              <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <Bot className="h-4 w-4" />
              </div>
              <div className="rounded-lg px-4 py-2 bg-secondary">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Starting...</span>
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

          {/* Generate Spec buttons - shown after sufficient conversation */}
          <div className="mt-4 flex justify-between items-center gap-2">
            <p className="text-xs text-muted-foreground">
              {userMessageCount < MIN_MESSAGES_FOR_SPEC
                ? 'Continue the conversation to generate a specification.'
                : complexityAnalysis
                  ? `Recommended: ${complexityAnalysis.suggestedMode.replace('-', ' ')}`
                  : 'Ready to generate spec'}
            </p>
            {userMessageCount >= MIN_MESSAGES_FOR_SPEC && !isProcessing && (
              <div className="flex gap-2">
                <Button
                  onClick={handleQuickSpec}
                  variant={complexityAnalysis?.suggestedMode === 'quick-spec' ? 'default' : 'outline'}
                  className="gap-2"
                >
                  <Zap className="h-4 w-4" />
                  Quick Spec (30s)
                  {complexityAnalysis?.suggestedMode === 'quick-spec' && (
                    <span className="ml-1 text-xs opacity-75">★</span>
                  )}
                </Button>
                <Button
                  onClick={handleProceedToSpec}
                  variant={complexityAnalysis?.suggestedMode === 'smart-spec' ? 'default' : 'outline'}
                  className="gap-2"
                >
                  <FileText className="h-4 w-4" />
                  Smart Spec (5-10min)
                  {complexityAnalysis?.suggestedMode === 'smart-spec' && (
                    <span className="ml-1 text-xs opacity-75">★</span>
                  )}
                </Button>
                {complexityAnalysis?.suggestedMode === 'enterprise-spec' && (
                  <Button onClick={handleProceedToSpec} variant="default" className="gap-2">
                    <Building2 className="h-4 w-4" />
                    Enterprise Spec ★
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Agent Status Sidebar */}
      <div className="w-72 border-l border-border p-4 shrink-0 flex flex-col">
        {/* Claude Activity Panel - Fixed height container */}
        <div className="mb-4">
          <h3 className="font-medium text-sm mb-2 flex items-center gap-2">
            {isProcessing ? (
              <Loader2 className="h-4 w-4 text-primary animate-spin" />
            ) : (
              <Cpu className="h-4 w-4 text-muted-foreground" />
            )}
            <span className={isProcessing ? 'text-primary' : ''}>
              {isProcessing ? 'Claude is working...' : 'Claude Activity'}
            </span>
          </h3>
          <div className="h-48 bg-secondary/30 rounded-lg border border-border overflow-hidden">
            {thinkingEvents.length > 0 ? (
              <div className="h-full overflow-y-auto p-2 space-y-1 font-mono text-xs">
                {thinkingEvents.map((event, idx) => (
                  <div
                    key={`${event.timestamp}-${idx}`}
                    className={cn(
                      'break-words',
                      event.type === 'system' && 'text-primary',
                      event.type === 'tool_start' && 'text-orange-400',
                      event.type === 'tool_complete' && 'text-emerald-400',
                      event.type === 'tool_result' && 'text-muted-foreground',
                      event.type === 'thinking' && 'text-primary/80',
                      event.type === 'stderr' && 'text-yellow-500'
                    )}
                  >
                    {event.content.length > 200
                      ? event.content.substring(0, 200) + '...'
                      : event.content}
                  </div>
                ))}
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                Activity will appear here
              </div>
            )}
          </div>
          {/* Active tools badges */}
          {activeTools.filter(t => t.status === 'running').length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {activeTools.filter(t => t.status === 'running').map(tool => (
                <span
                  key={tool.name}
                  className="inline-flex items-center gap-1 text-xs bg-primary/20 text-primary px-2 py-0.5 rounded"
                >
                  <Loader2 className="h-2 w-2 animate-spin" />
                  {tool.name}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* BMAD-Inspired: Complexity Analysis Indicator */}
        {(complexityAnalysis || isAnalyzingComplexity) && (
          <div className="mb-4 p-3 bg-secondary/30 rounded-lg border border-border">
            <h3 className="font-medium text-sm mb-2 flex items-center gap-2">
              <Gauge className="h-4 w-4" />
              Complexity Analysis
            </h3>
            {isAnalyzingComplexity ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Analyzing conversation...
              </div>
            ) : complexityAnalysis && (
              <div className="space-y-2">
                {/* Complexity Level Badge */}
                <div className="flex items-center gap-2">
                  {complexityAnalysis.level === 'quick' && (
                    <span className="inline-flex items-center gap-1 text-xs bg-emerald-500/20 text-emerald-400 px-2 py-1 rounded">
                      <Zap className="h-3 w-3" />
                      Quick Task
                    </span>
                  )}
                  {complexityAnalysis.level === 'standard' && (
                    <span className="inline-flex items-center gap-1 text-xs bg-primary/20 text-primary px-2 py-1 rounded">
                      <TrendingUp className="h-3 w-3" />
                      Standard Feature
                    </span>
                  )}
                  {complexityAnalysis.level === 'enterprise' && (
                    <span className="inline-flex items-center gap-1 text-xs bg-orange-500/20 text-orange-400 px-2 py-1 rounded">
                      <Building2 className="h-3 w-3" />
                      Enterprise Project
                    </span>
                  )}
                </div>

                {/* Complexity Score Bar */}
                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Complexity Score</span>
                    <span>{complexityAnalysis.score}/100</span>
                  </div>
                  <div className="h-2 bg-secondary rounded-full overflow-hidden">
                    <div
                      className={cn(
                        'h-full rounded-full transition-all duration-300',
                        complexityAnalysis.score < 30 && 'bg-emerald-500',
                        complexityAnalysis.score >= 30 && complexityAnalysis.score < 60 && 'bg-primary',
                        complexityAnalysis.score >= 60 && 'bg-orange-500'
                      )}
                      style={{ width: `${complexityAnalysis.score}%` }}
                    />
                  </div>
                </div>

                {/* Key Factors */}
                {complexityAnalysis.factors.length > 0 && (
                  <div className="pt-1">
                    <p className="text-xs text-muted-foreground mb-1">Detected Factors:</p>
                    <div className="flex flex-wrap gap-1">
                      {complexityAnalysis.factors.filter(f => f.detected).slice(0, 4).map((factor, idx) => (
                        <span
                          key={idx}
                          className="text-xs bg-secondary px-1.5 py-0.5 rounded"
                          title={factor.details || factor.name}
                        >
                          {factor.name}
                        </span>
                      ))}
                      {complexityAnalysis.factors.filter(f => f.detected).length > 4 && (
                        <span className="text-xs text-muted-foreground">
                          +{complexityAnalysis.factors.filter(f => f.detected).length - 4} more
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {/* Suggested Mode */}
                <p className="text-xs text-muted-foreground pt-1">
                  Suggested: <span className="text-foreground font-medium">{complexityAnalysis.suggestedMode.replace('-', ' ')}</span>
                </p>
              </div>
            )}
          </div>
        )}

        {/* Research Agents Section */}
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

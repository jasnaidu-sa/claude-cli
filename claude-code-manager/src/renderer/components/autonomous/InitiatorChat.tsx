/**
 * InitiatorChat Component
 *
 * Phase 0: Requirements gathering chat - user describes their task,
 * Claude asks clarifying questions to build a structured requirements document,
 * then generates an optimized Ralph Loop execution prompt.
 *
 * Flow:
 * 1. User describes task in natural language
 * 2. Claude asks clarifying questions (scope, constraints, success criteria)
 * 3. User clicks "Summarize" when ready
 * 4. Requirements doc is displayed for review
 * 5. User clicks "Generate Prompt" to create Ralph Loop prompt
 * 6. User can edit and approve prompt to start execution
 */

import React, { useState, useRef, useEffect, useCallback } from 'react'
import {
  Send,
  Bot,
  User,
  Loader2,
  XCircle,
  AlertCircle,
  StopCircle,
  FileText,
  CheckCircle,
  Sparkles,
  ArrowRight,
  Paperclip,
  X,
  File,
  FileCode,
  FileImage,
  FileJson,
  RotateCcw
} from 'lucide-react'
import { Button } from '../ui/button'
import { cn } from '@renderer/lib/utils'
import type {
  InitiatorChunkData,
  InitiatorCompleteData,
  InitiatorRequirementsData,
  InitiatorPromptData,
  InitiatorErrorData
} from '../../../preload/index'
import type { InitiatorSession, RequirementsDoc, RalphPromptConfig, InitiatorPhase, InitiatorAttachment, AttachmentType } from '../../../shared/types'

interface InitiatorChatProps {
  projectPath: string
  onSessionCreated?: (session: InitiatorSession) => void
  onRequirementsReady?: (requirements: RequirementsDoc) => void
  onPromptReady?: (promptConfig: RalphPromptConfig) => void
  onPromptApproved?: (session: InitiatorSession, promptPath: string) => void
}

// Minimum exchanges before allowing summarization
// Set to 1 - if user provides a PRD, one exchange is enough
const MIN_EXCHANGES_FOR_SUMMARY = 1

export function InitiatorChat({
  projectPath,
  onSessionCreated,
  onRequirementsReady,
  onPromptReady,
  onPromptApproved
}: InitiatorChatProps) {
  // Session state
  const [session, setSession] = useState<InitiatorSession | null>(null)
  const [isInitializing, setIsInitializing] = useState(true)

  // Chat state
  const [input, setInput] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null)
  const [isReadyToSummarize, setIsReadyToSummarize] = useState(false)

  // Attachment state
  const [pendingAttachments, setPendingAttachments] = useState<string[]>([])
  const [isDraggingOver, setIsDraggingOver] = useState(false)

  // Error state
  const [error, setError] = useState<string | null>(null)

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const cleanupRef = useRef<(() => void)[]>([])
  const hasInitializedRef = useRef(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dropZoneRef = useRef<HTMLDivElement>(null)
  const dragCounterRef = useRef(0)

  // Calculate user message count
  const userMessageCount = session?.messages.filter(m => m.role === 'user').length ?? 0

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [session?.messages, streamingContent])

  // Initialize session
  useEffect(() => {
    if (!projectPath || hasInitializedRef.current) return

    const initSession = async () => {
      try {
        setError(null)
        setIsInitializing(true)

        const result = await window.electron.initiator.start(projectPath)

        if (result.success && result.data) {
          hasInitializedRef.current = true
          setSession(result.data)
          onSessionCreated?.(result.data)

          // If resuming a session with requirements, notify parent
          if (result.data.requirements) {
            onRequirementsReady?.(result.data.requirements)
          }
          if (result.data.generatedPrompt) {
            onPromptReady?.(result.data.generatedPrompt)
          }
        } else {
          setError(result.error || 'Failed to create initiator session')
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to initialize session')
      } finally {
        setIsInitializing(false)
      }
    }

    initSession()
  }, [projectPath, onSessionCreated, onRequirementsReady, onPromptReady])

  // Subscribe to initiator events
  useEffect(() => {
    if (!session?.id) return

    // Response chunk handler
    const unsubChunk = window.electron.initiator.onResponseChunk((data: InitiatorChunkData) => {
      if (data.sessionId !== session.id) return

      setStreamingMessageId(data.messageId)
      if (data.eventType === 'text') {
        setStreamingContent(data.fullContent)
      }
    })
    cleanupRef.current.push(unsubChunk)

    // Response complete handler
    const unsubComplete = window.electron.initiator.onResponseComplete((data: InitiatorCompleteData) => {
      if (data.sessionId !== session.id) return

      // Update session with new message
      setSession(prev => {
        if (!prev) return prev
        return {
          ...prev,
          messages: [...prev.messages, {
            id: data.messageId,
            role: 'assistant' as const,
            content: data.content,
            timestamp: data.timestamp
          }]
        }
      })

      setStreamingContent('')
      setStreamingMessageId(null)
      setIsProcessing(false)
      setIsReadyToSummarize(data.isReadyToSummarize)
    })
    cleanupRef.current.push(unsubComplete)

    // Requirements ready handler
    const unsubRequirements = window.electron.initiator.onRequirementsReady((data: InitiatorRequirementsData) => {
      if (data.sessionId !== session.id) return

      setSession(prev => {
        if (!prev) return prev
        return { ...prev, requirements: data.requirements, phase: 'summarizing' }
      })
      onRequirementsReady?.(data.requirements)
      setIsProcessing(false)
    })
    cleanupRef.current.push(unsubRequirements)

    // Prompt ready handler
    const unsubPrompt = window.electron.initiator.onPromptReady((data: InitiatorPromptData) => {
      if (data.sessionId !== session.id) return

      setSession(prev => {
        if (!prev) return prev
        return { ...prev, generatedPrompt: data.promptConfig, phase: 'reviewing' }
      })
      onPromptReady?.(data.promptConfig)
      setIsProcessing(false)
    })
    cleanupRef.current.push(unsubPrompt)

    // Error handler
    const unsubError = window.electron.initiator.onError((data: InitiatorErrorData) => {
      if (data.sessionId !== session.id) return

      setError(data.error)
      setIsProcessing(false)
      setStreamingContent('')
      setStreamingMessageId(null)
    })
    cleanupRef.current.push(unsubError)

    return () => {
      cleanupRef.current.forEach(unsub => unsub())
      cleanupRef.current = []
    }
  }, [session?.id, onRequirementsReady, onPromptReady])

  // Handle file selection
  const handleFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files
    if (!files) return

    const newPaths: string[] = []
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      // In Electron, we can get the full path via the path property
      const filePath = (file as unknown as { path: string }).path
      if (filePath && !pendingAttachments.includes(filePath)) {
        newPaths.push(filePath)
      }
    }

    if (newPaths.length > 0) {
      setPendingAttachments(prev => [...prev, ...newPaths])
    }

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }, [pendingAttachments])

  // Remove a pending attachment
  const removeAttachment = useCallback((filePath: string) => {
    setPendingAttachments(prev => prev.filter(p => p !== filePath))
  }, [])

  // Drag and drop handlers
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current++
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDraggingOver(true)
      // Clear any previous dropped file paths
      window.electron.shell.startFileDrop()
    }
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current--
    if (dragCounterRef.current === 0) {
      setIsDraggingOver(false)
    }
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDraggingOver(false)
    dragCounterRef.current = 0

    const files = e.dataTransfer.files
    if (!files || files.length === 0) {
      console.log('[InitiatorChat] No files in drop event')
      return
    }

    console.log('[InitiatorChat] Dropped files:', files.length)

    // Use the preload shell API to get file paths
    // The preload captures paths via webUtils.getPathForFile() in its own drop handler
    // We need to wait a small tick for the preload drop handler to process first
    setTimeout(() => {
      const capturedPaths = window.electron.shell.getDroppedFilePaths()
      console.log('[InitiatorChat] Captured paths from preload:', capturedPaths)

      if (capturedPaths.length > 0) {
        const newPaths = capturedPaths.filter(p => !pendingAttachments.includes(p))
        if (newPaths.length > 0) {
          console.log('[InitiatorChat] Adding new paths:', newPaths)
          setPendingAttachments(prev => [...prev, ...newPaths])
        }
      } else {
        // Fallback: try direct file.path access (works when contextIsolation is false or file picker)
        const fallbackPaths: string[] = []
        for (let i = 0; i < files.length; i++) {
          const file = files[i] as File & { path?: string }
          if (file.path && !pendingAttachments.includes(file.path)) {
            fallbackPaths.push(file.path)
          }
        }
        if (fallbackPaths.length > 0) {
          console.log('[InitiatorChat] Using fallback paths:', fallbackPaths)
          setPendingAttachments(prev => [...prev, ...fallbackPaths])
        } else {
          console.log('[InitiatorChat] Could not get file paths - contextIsolation may be blocking access')
        }
      }
    }, 0)
  }, [pendingAttachments])

  // Get file name from path
  const getFileName = (filePath: string) => {
    return filePath.split(/[\\/]/).pop() || filePath
  }

  // Get icon for attachment type based on extension
  const getAttachmentIcon = (filePath: string) => {
    const ext = filePath.split('.').pop()?.toLowerCase() || ''
    const codeExts = ['ts', 'tsx', 'js', 'jsx', 'py', 'go', 'rs', 'java', 'c', 'cpp', 'cs', 'rb', 'php']
    const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']

    if (codeExts.includes(ext)) return FileCode
    if (imageExts.includes(ext)) return FileImage
    if (ext === 'json') return FileJson
    if (ext === 'md' || ext === 'mdx') return FileText
    return File
  }

  // Send message handler
  const handleSend = useCallback(async () => {
    if ((!input.trim() && pendingAttachments.length === 0) || isProcessing || !session?.id) return

    // Build a helpful message when files are attached
    let userMessage = input.trim()
    if (!userMessage && pendingAttachments.length > 0) {
      // If only files attached with no message, prompt Claude to analyze them
      const fileNames = pendingAttachments.map(p => getFileName(p)).join(', ')
      userMessage = `I'm attaching the following document(s) for context: ${fileNames}. Please analyze them and help me understand what needs to be implemented.`
    }
    const attachmentsToSend = [...pendingAttachments]

    setInput('')
    setPendingAttachments([])
    setIsProcessing(true)
    setError(null)

    // Optimistically add user message (without processed attachments yet)
    setSession(prev => {
      if (!prev) return prev
      return {
        ...prev,
        messages: [...prev.messages, {
          id: `${Date.now()}-user`,
          role: 'user' as const,
          content: userMessage,
          timestamp: Date.now()
        }]
      }
    })

    try {
      const result = await window.electron.initiator.sendMessage(
        session.id,
        userMessage,
        attachmentsToSend.length > 0 ? attachmentsToSend : undefined
      )

      if (!result.success) {
        setError(result.error || 'Failed to send message')
        setIsProcessing(false)
      }
      // Response will come through streaming events
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message')
      setIsProcessing(false)
    }
  }, [input, pendingAttachments, isProcessing, session?.id])

  // Key press handler
  const handleKeyPress = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])

  // Summarize requirements
  const handleSummarize = useCallback(async () => {
    if (!session?.id || isProcessing) return

    setIsProcessing(true)
    setError(null)

    try {
      const result = await window.electron.initiator.summarize(session.id)

      if (!result.success) {
        setError(result.error || 'Failed to summarize requirements')
        setIsProcessing(false)
      }
      // Requirements will come through event
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to summarize')
      setIsProcessing(false)
    }
  }, [session?.id, isProcessing])

  // Generate Ralph prompt
  const handleGeneratePrompt = useCallback(async () => {
    if (!session?.id || isProcessing) return

    setIsProcessing(true)
    setError(null)

    try {
      const result = await window.electron.initiator.generatePrompt(session.id)

      if (!result.success) {
        setError(result.error || 'Failed to generate prompt')
        setIsProcessing(false)
      }
      // Prompt will come through event
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate prompt')
      setIsProcessing(false)
    }
  }, [session?.id, isProcessing])

  // Approve prompt and start execution
  const handleApprovePrompt = useCallback(async () => {
    if (!session?.id || isProcessing) return

    setIsProcessing(true)
    setError(null)

    try {
      const result = await window.electron.initiator.approvePrompt(session.id)

      if (result.success && result.data) {
        setSession(prev => prev ? { ...prev, phase: 'approved' } : prev)
        onPromptApproved?.(result.data.session, result.data.promptPath)
      } else {
        setError(result.error || 'Failed to approve prompt')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve')
    } finally {
      setIsProcessing(false)
    }
  }, [session?.id, isProcessing, onPromptApproved])

  // Cancel current operation
  const handleCancel = useCallback(async () => {
    if (!session?.id) return

    try {
      await window.electron.initiator.cancel(session.id)
      setIsProcessing(false)
      setStreamingContent('')
      setStreamingMessageId(null)
    } catch (err) {
      console.error('Failed to cancel:', err)
    }
  }, [session?.id])

  // Start a fresh session
  const handleNewSession = useCallback(async () => {
    if (!projectPath || isProcessing) return

    try {
      setError(null)
      setIsInitializing(true)
      setSession(null)
      setStreamingContent('')
      setStreamingMessageId(null)
      setPendingAttachments([])
      setInput('')
      setIsReadyToSummarize(false)

      // Force create a new session
      const result = await window.electron.initiator.start(projectPath, { forceNew: true })

      if (result.success && result.data) {
        setSession(result.data)
        onSessionCreated?.(result.data)
      } else {
        setError(result.error || 'Failed to create new session')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start new session')
    } finally {
      setIsInitializing(false)
    }
  }, [projectPath, isProcessing, onSessionCreated])

  // Clear error
  const clearError = () => setError(null)

  // Get phase badge
  const getPhaseBadge = (phase: InitiatorPhase) => {
    switch (phase) {
      case 'gathering':
        return <span className="px-2 py-1 rounded text-xs bg-primary/20 text-primary">Gathering Requirements</span>
      case 'summarizing':
        return <span className="px-2 py-1 rounded text-xs bg-orange-500/20 text-orange-500">Summarizing</span>
      case 'generating':
        return <span className="px-2 py-1 rounded text-xs bg-purple-500/20 text-purple-500">Generating Prompt</span>
      case 'reviewing':
        return <span className="px-2 py-1 rounded text-xs bg-emerald-500/20 text-emerald-500">Ready to Execute</span>
      case 'approved':
        return <span className="px-2 py-1 rounded text-xs bg-emerald-500/20 text-emerald-500">Approved</span>
    }
  }

  // Loading state
  if (isInitializing) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Initializing session...</p>
        </div>
      </div>
    )
  }

  return (
    <div
      ref={dropZoneRef}
      className={cn(
        'h-full flex flex-col relative',
        isDraggingOver && 'ring-2 ring-primary ring-inset'
      )}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {isDraggingOver && (
        <div className="absolute inset-0 bg-primary/10 z-50 flex items-center justify-center pointer-events-none">
          <div className="bg-background border-2 border-dashed border-primary rounded-lg p-8 text-center">
            <Paperclip className="h-12 w-12 text-primary mx-auto mb-3" />
            <p className="text-lg font-medium">Drop files here</p>
            <p className="text-sm text-muted-foreground">Files will be added as context for your task</p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="border-b border-border p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
            <Sparkles className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="font-semibold">Ralph Loop Initiator</h2>
            <p className="text-xs text-muted-foreground">
              Attach your PRD or describe your task
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {session && getPhaseBadge(session.phase)}
          <Button
            variant="outline"
            size="sm"
            onClick={handleNewSession}
            disabled={isProcessing || isInitializing}
            title="Start a new session"
            className="gap-1.5"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            New
          </Button>
        </div>
      </div>

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
        {/* Welcome message if no messages yet */}
        {(!session?.messages || session.messages.length <= 1) && (
          <div className="flex gap-3 justify-start">
            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <Bot className="h-4 w-4" />
            </div>
            <div className="max-w-[80%] rounded-lg px-4 py-2 bg-secondary">
              <p className="whitespace-pre-wrap">
                Ready to help! You can:
                {'\n\n'}
                1. **Attach a PRD/spec** using the paperclip button or drag & drop
                {'\n'}2. **Describe your task** in the message box
                {'\n\n'}
                I'll extract the tasks and success criteria, then you can approve and start execution.
              </p>
            </div>
          </div>
        )}

        {/* Chat messages */}
        {session?.messages.filter(m => m.role !== 'system').map((message) => (
          <div
            key={message.id}
            className={cn(
              'flex gap-3',
              message.role === 'user' ? 'justify-end' : 'justify-start'
            )}
          >
            {message.role !== 'user' && (
              <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <Bot className="h-4 w-4" />
              </div>
            )}
            <div
              className={cn(
                'max-w-[80%] rounded-lg px-4 py-2',
                message.role === 'user'
                  ? 'bg-primary text-white'
                  : 'bg-secondary'
              )}
            >
              <p className="whitespace-pre-wrap">{message.content}</p>

              {/* Show attachments if present */}
              {message.attachments && message.attachments.length > 0 && (
                <div className="mt-2 pt-2 border-t border-current/10">
                  <div className="flex flex-wrap gap-1.5">
                    {message.attachments.map((att) => {
                      const Icon = getAttachmentIcon(att.filePath)
                      return (
                        <div
                          key={att.id}
                          className={cn(
                            'flex items-center gap-1 px-1.5 py-0.5 rounded text-xs',
                            message.role === 'user'
                              ? 'bg-white/20'
                              : 'bg-muted'
                          )}
                          title={att.error || att.filePath}
                        >
                          <Icon className="h-3 w-3" />
                          <span className="max-w-[100px] truncate">{att.fileName}</span>
                          {att.error && <AlertCircle className="h-3 w-3 text-red-400" />}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

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

        {/* Streaming response */}
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

        {/* Processing indicator */}
        {isProcessing && !streamingContent && (
          <div className="flex gap-3 justify-start">
            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <Bot className="h-4 w-4" />
            </div>
            <div className="rounded-lg px-4 py-2 bg-secondary">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>
                  {session?.phase === 'summarizing' && 'Summarizing requirements...'}
                  {session?.phase === 'generating' && 'Generating Ralph prompt...'}
                  {session?.phase === 'gathering' && 'Thinking...'}
                </span>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="border-t border-border p-4">
        {/* Chat input (only during gathering phase) */}
        {session?.phase === 'gathering' && (
          <div className="mb-4">
            {/* Pending attachments display */}
            {pendingAttachments.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {pendingAttachments.map((filePath) => {
                  const Icon = getAttachmentIcon(filePath)
                  return (
                    <div
                      key={filePath}
                      className="flex items-center gap-1.5 px-2 py-1 bg-secondary rounded-md text-xs group"
                    >
                      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="max-w-[150px] truncate" title={filePath}>
                        {getFileName(filePath)}
                      </span>
                      <button
                        onClick={() => removeAttachment(filePath)}
                        className="opacity-60 hover:opacity-100 transition-opacity"
                        title="Remove attachment"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Input row with attachment button */}
            <div className="flex gap-2">
              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                onChange={handleFileSelect}
                className="hidden"
                accept=".txt,.md,.mdx,.json,.js,.jsx,.ts,.tsx,.py,.go,.rs,.java,.c,.cpp,.h,.cs,.rb,.php,.yaml,.yml,.xml,.html,.css,.csv,.log,.pdf,.png,.jpg,.jpeg,.gif,.webp,.svg"
              />

              {/* Attachment button */}
              <Button
                variant="outline"
                size="icon"
                onClick={() => fileInputRef.current?.click()}
                disabled={isProcessing}
                title="Attach files for context"
                className="h-[60px] w-[44px] shrink-0"
              >
                <Paperclip className="h-4 w-4" />
              </Button>

              {/* Text input */}
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Describe your task... (attach docs for context)"
                className={cn(
                  'flex-1 min-h-[60px] max-h-[200px] p-3 rounded-lg',
                  'bg-secondary border border-border resize-none',
                  'focus:outline-none focus:ring-2 focus:ring-primary',
                  'disabled:opacity-50 disabled:cursor-not-allowed'
                )}
                disabled={isProcessing || !session}
              />

              {/* Send/Cancel button */}
              <div className="flex flex-col gap-2">
                {isProcessing ? (
                  <Button
                    onClick={handleCancel}
                    variant="destructive"
                    className="h-[60px] px-4"
                  >
                    <StopCircle className="h-4 w-4" />
                  </Button>
                ) : (
                  <Button
                    onClick={handleSend}
                    disabled={(!input.trim() && pendingAttachments.length === 0) || !session}
                    className="h-[60px] px-4"
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Action buttons based on phase */}
        <div className="flex justify-between items-center">
          <p className="text-xs text-muted-foreground">
            {session?.phase === 'gathering' && userMessageCount < MIN_EXCHANGES_FOR_SUMMARY && (
              <>Continue the conversation ({MIN_EXCHANGES_FOR_SUMMARY - userMessageCount} more messages needed)</>
            )}
            {session?.phase === 'gathering' && userMessageCount >= MIN_EXCHANGES_FOR_SUMMARY && (
              <>Ready to summarize when you're done describing your task</>
            )}
            {session?.phase === 'summarizing' && 'Review your requirements below'}
            {session?.phase === 'reviewing' && 'Review and approve the generated prompt'}
            {session?.phase === 'approved' && 'Prompt approved - ready for execution!'}
          </p>

          <div className="flex gap-2">
            {/* Summarize button (gathering phase) */}
            {session?.phase === 'gathering' && !isProcessing && (
              <Button
                onClick={handleSummarize}
                disabled={userMessageCount < MIN_EXCHANGES_FOR_SUMMARY}
                variant={isReadyToSummarize ? 'default' : 'outline'}
                className="gap-2"
              >
                <FileText className="h-4 w-4" />
                Summarize Requirements
                {isReadyToSummarize && <CheckCircle className="h-4 w-4 text-emerald-500" />}
              </Button>
            )}

            {/* Generate Prompt button (after summarizing) */}
            {session?.phase === 'summarizing' && session.requirements && !isProcessing && (
              <Button onClick={handleGeneratePrompt} className="gap-2">
                <Sparkles className="h-4 w-4" />
                Generate Ralph Prompt
              </Button>
            )}

            {/* Approve button (reviewing phase) */}
            {session?.phase === 'reviewing' && session.generatedPrompt && !isProcessing && (
              <Button onClick={handleApprovePrompt} className="gap-2">
                <ArrowRight className="h-4 w-4" />
                Approve & Start Execution
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

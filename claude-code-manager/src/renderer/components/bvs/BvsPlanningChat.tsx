/**
 * BVS Planning Chat Component
 *
 * Phase 0: Interactive planning chat for BVS workflow.
 * User can either upload a PRD or chat with an agent to define sections.
 *
 * Based on PRD Phase 0 (F0.2b-F0.2e):
 * - F0.2b - Planning Chat UI
 * - F0.2c - Planning Agent
 * - F0.2d - Iterative Proposal
 * - F0.2e - Chat-to-Plan Converter
 */

import React, { useState, useRef, useEffect, useCallback } from 'react'
import {
  Send,
  Bot,
  User,
  Loader2,
  XCircle,
  AlertCircle,
  FileText,
  CheckCircle,
  Sparkles,
  ArrowRight,
  Upload,
  FileUp,
  Clipboard,
  MessageSquare,
} from 'lucide-react'
import { Button } from '../ui/button'
import { cn } from '@renderer/lib/utils'
import type {
  BvsPlanningMessage,
  BvsSection,
  BvsExecutionPlan,
  BvsInputMode,
} from '@shared/bvs-types'

// ============================================================================
// Props & Types
// ============================================================================

interface BvsPlanningChatProps {
  projectPath: string
  onPlanReady?: (plan: BvsExecutionPlan) => void
  onModeSwitch?: (mode: BvsInputMode) => void
  className?: string
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  category?: 'clarification' | 'proposal' | 'refinement' | 'finalization'
}

// ============================================================================
// Helper Functions
// ============================================================================

function generateMessageId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

// ============================================================================
// Message Component
// ============================================================================

interface MessageBubbleProps {
  message: ChatMessage
  isStreaming?: boolean
}

function MessageBubble({ message, isStreaming }: MessageBubbleProps) {
  const isUser = message.role === 'user'
  const isSystem = message.role === 'system'

  return (
    <div
      className={cn(
        'flex gap-3 p-3 rounded-lg',
        isUser ? 'bg-blue-500/10 ml-8' : 'bg-muted/30 mr-8',
        isSystem && 'bg-amber-500/10 border border-amber-500/20'
      )}
    >
      {/* Avatar */}
      <div
        className={cn(
          'w-8 h-8 rounded-full flex items-center justify-center shrink-0',
          isUser ? 'bg-blue-500/20 text-blue-400' : 'bg-purple-500/20 text-purple-400',
          isSystem && 'bg-amber-500/20 text-amber-400'
        )}
      >
        {isUser ? (
          <User className="h-4 w-4" />
        ) : isSystem ? (
          <AlertCircle className="h-4 w-4" />
        ) : (
          <Bot className="h-4 w-4" />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-medium">
            {isUser ? 'You' : isSystem ? 'System' : 'Planning Agent'}
          </span>
          {message.category && (
            <span
              className={cn(
                'text-xs px-1.5 py-0.5 rounded',
                message.category === 'clarification' && 'bg-blue-500/20 text-blue-400',
                message.category === 'proposal' && 'bg-green-500/20 text-green-400',
                message.category === 'refinement' && 'bg-amber-500/20 text-amber-400',
                message.category === 'finalization' && 'bg-purple-500/20 text-purple-400'
              )}
            >
              {message.category}
            </span>
          )}
          {isStreaming && (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          )}
        </div>
        <div className="text-sm whitespace-pre-wrap">{message.content}</div>
      </div>
    </div>
  )
}

// ============================================================================
// Section Preview Component
// ============================================================================

interface SectionPreviewProps {
  sections: Partial<BvsSection>[]
}

function SectionPreview({ sections }: SectionPreviewProps) {
  if (sections.length === 0) return null

  return (
    <div className="bg-muted/20 border border-border rounded-lg p-3 space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Sparkles className="h-4 w-4 text-purple-400" />
        <span>Proposed Sections ({sections.length})</span>
      </div>
      <div className="space-y-1">
        {sections.map((section, idx) => (
          <div
            key={section.id || idx}
            className="text-sm bg-card p-2 rounded border border-border flex items-center justify-between"
          >
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">#{idx + 1}</span>
              <span className="font-medium">{section.name || 'Unnamed Section'}</span>
            </div>
            <span className="text-xs text-muted-foreground">
              {section.files?.length || 0} files
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ============================================================================
// Input Mode Selector
// ============================================================================

interface InputModeSelectorProps {
  onSelectMode: (mode: BvsInputMode) => void
}

function InputModeSelector({ onSelectMode }: InputModeSelectorProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full p-8">
      <h2 className="text-xl font-semibold mb-2">How would you like to define your task?</h2>
      <p className="text-sm text-muted-foreground mb-8 text-center max-w-md">
        You can either upload an existing PRD document or chat with the planning agent
        to define your sections interactively.
      </p>

      <div className="grid grid-cols-2 gap-4 w-full max-w-lg">
        {/* PRD Upload Option */}
        <button
          onClick={() => onSelectMode('prd_upload')}
          className="flex flex-col items-center gap-3 p-6 rounded-lg border border-border bg-card hover:bg-muted/30 hover:border-blue-500/50 transition-all group"
        >
          <div className="w-12 h-12 rounded-full bg-blue-500/20 flex items-center justify-center group-hover:bg-blue-500/30 transition-colors">
            <FileUp className="h-6 w-6 text-blue-400" />
          </div>
          <div className="text-center">
            <div className="font-medium">Upload PRD</div>
            <div className="text-xs text-muted-foreground mt-1">
              Upload an existing document
            </div>
          </div>
        </button>

        {/* Interactive Planning Option */}
        <button
          onClick={() => onSelectMode('interactive_planning')}
          className="flex flex-col items-center gap-3 p-6 rounded-lg border border-border bg-card hover:bg-muted/30 hover:border-purple-500/50 transition-all group"
        >
          <div className="w-12 h-12 rounded-full bg-purple-500/20 flex items-center justify-center group-hover:bg-purple-500/30 transition-colors">
            <MessageSquare className="h-6 w-6 text-purple-400" />
          </div>
          <div className="text-center">
            <div className="font-medium">Interactive Planning</div>
            <div className="text-xs text-muted-foreground mt-1">
              Chat to define sections
            </div>
          </div>
        </button>
      </div>
    </div>
  )
}

// ============================================================================
// PRD Upload Interface
// ============================================================================

interface PrdUploadProps {
  onUpload: (content: string, fileName?: string) => void
  onSwitchToChat: () => void
}

function PrdUpload({ onUpload, onSwitchToChat }: PrdUploadProps) {
  const [pasteContent, setPasteContent] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const content = await file.text()
    onUpload(content, file.name)
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)

    const file = e.dataTransfer.files?.[0]
    if (!file) return

    const content = await file.text()
    onUpload(content, file.name)
  }

  const handlePaste = () => {
    if (pasteContent.trim()) {
      onUpload(pasteContent.trim())
    }
  }

  return (
    <div className="flex flex-col h-full p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold">Upload PRD</h2>
        <Button variant="ghost" size="sm" onClick={onSwitchToChat}>
          <MessageSquare className="h-4 w-4 mr-2" />
          Switch to Chat
        </Button>
      </div>

      {/* Drop Zone */}
      <div
        className={cn(
          'flex-1 border-2 border-dashed rounded-lg flex flex-col items-center justify-center transition-colors',
          isDragging ? 'border-blue-500 bg-blue-500/10' : 'border-border'
        )}
        onDragOver={(e) => {
          e.preventDefault()
          setIsDragging(true)
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
      >
        <Upload className="h-12 w-12 text-muted-foreground mb-4" />
        <p className="text-sm text-muted-foreground mb-2">
          Drag and drop your PRD file here
        </p>
        <p className="text-xs text-muted-foreground mb-4">
          Supports .md, .txt, .pdf
        </p>
        <Button
          variant="outline"
          onClick={() => fileInputRef.current?.click()}
        >
          <FileText className="h-4 w-4 mr-2" />
          Browse Files
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".md,.txt,.pdf"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>

      {/* Or Paste */}
      <div className="mt-6">
        <div className="flex items-center gap-4 mb-2">
          <div className="flex-1 h-px bg-border" />
          <span className="text-xs text-muted-foreground">OR</span>
          <div className="flex-1 h-px bg-border" />
        </div>

        <div className="relative">
          <textarea
            value={pasteContent}
            onChange={(e) => setPasteContent(e.target.value)}
            placeholder="Paste your PRD content here..."
            className="w-full h-32 p-3 text-sm bg-card border border-border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/50"
          />
          {pasteContent.trim() && (
            <Button
              size="sm"
              className="absolute bottom-2 right-2"
              onClick={handlePaste}
            >
              <Clipboard className="h-4 w-4 mr-2" />
              Use Content
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Main Component
// ============================================================================

export function BvsPlanningChat({
  projectPath,
  onPlanReady,
  onModeSwitch,
  className,
}: BvsPlanningChatProps) {
  // State
  const [mode, setMode] = useState<BvsInputMode | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [proposedSections, setProposedSections] = useState<Partial<BvsSection>[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isReadyToFinalize, setIsReadyToFinalize] = useState(false)
  const [planningSessionId, setPlanningSessionId] = useState<string | null>(null)
  const [planningPhase, setPlanningPhase] = useState<string>('gathering')

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent])

  // Handle mode selection
  const handleModeSelect = async (selectedMode: BvsInputMode) => {
    setMode(selectedMode)
    onModeSwitch?.(selectedMode)

    if (selectedMode === 'interactive_planning') {
      setIsProcessing(true)
      setError(null)

      try {
        // Start a new planning session via IPC
        const result = await window.electron.bvsPlanning.startSession(projectPath)

        if (result.success && result.session) {
          setPlanningSessionId(result.session.id)
          setPlanningPhase(result.session.phase)

          // Convert session messages to ChatMessages
          const chatMessages: ChatMessage[] = result.session.messages.map((msg) => ({
            id: msg.id,
            role: msg.role,
            content: msg.content,
            timestamp: msg.timestamp,
            category: msg.category,
          }))
          setMessages(chatMessages)
        } else {
          setError(result.error || 'Failed to start planning session')
          // Fallback to local greeting if IPC fails
          setMessages([
            {
              id: generateMessageId(),
              role: 'assistant',
              content:
                "Hello! I'm the BVS Planning Agent. I'll help you define bounded sections for your coding task.\n\n" +
                "Please describe what you want to build. I'll ask clarifying questions to understand:\n" +
                "- The scope of your feature\n" +
                "- Files that will be affected\n" +
                "- Dependencies between components\n" +
                "- Success criteria for each section\n\n" +
                "What would you like to work on?",
              timestamp: Date.now(),
              category: 'clarification',
            },
          ])
        }
      } catch (err) {
        console.error('[BvsPlanningChat] Failed to start session:', err)
        setError('Failed to connect to planning service')
      } finally {
        setIsProcessing(false)
      }
    }
  }

  // Handle PRD upload
  const handlePrdUpload = async (content: string, fileName?: string) => {
    setMessages([
      {
        id: generateMessageId(),
        role: 'system',
        content: `PRD uploaded${fileName ? `: ${fileName}` : ''}`,
        timestamp: Date.now(),
      },
    ])

    setIsProcessing(true)

    // NOTE: This would call the PRD parser service
    // For now, simulate processing
    setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        {
          id: generateMessageId(),
          role: 'assistant',
          content:
            'I\'ve analyzed your PRD. Let me break it down into bounded sections...\n\n' +
            '(PRD parsing would extract features and generate sections here)',
          timestamp: Date.now(),
          category: 'proposal',
        },
      ])
      setIsProcessing(false)
      setIsReadyToFinalize(true)
    }, 2000)
  }

  // Handle sending a message
  const handleSend = async () => {
    if (!input.trim() || isProcessing) return

    const userMessage: ChatMessage = {
      id: generateMessageId(),
      role: 'user',
      content: input.trim(),
      timestamp: Date.now(),
    }

    setMessages((prev) => [...prev, userMessage])
    const messageContent = input.trim()
    setInput('')
    setIsProcessing(true)
    setStreamingContent('')
    setError(null)

    try {
      if (planningSessionId) {
        // Call the planning agent via IPC
        const result = await window.electron.bvsPlanning.sendMessage(
          planningSessionId,
          messageContent
        )

        if (result.success && result.response) {
          const response: ChatMessage = {
            id: result.response.id,
            role: result.response.role,
            content: result.response.content,
            timestamp: result.response.timestamp,
            category: result.response.category,
          }
          setMessages((prev) => [...prev, response])

          // Update phase and sections
          if (result.phase) {
            setPlanningPhase(result.phase)
          }
          if (result.proposedSections && result.proposedSections.length > 0) {
            setProposedSections(result.proposedSections as Partial<BvsSection>[])
          }

          // Enable finalization when in finalizing phase or after enough exchanges
          if (result.phase === 'finalizing' || result.phase === 'proposing') {
            setIsReadyToFinalize(true)
          }
        } else {
          setError(result.error || 'Failed to get response from planning agent')
        }
      } else {
        setError('No active planning session')
      }
    } catch (err) {
      console.error('[BvsPlanningChat] Failed to send message:', err)
      setError('Failed to communicate with planning service')
    } finally {
      setIsProcessing(false)
    }
  }

  // Handle finalizing the plan
  const handleFinalize = async () => {
    if (!planningSessionId) {
      setError('No active planning session')
      return
    }

    setIsProcessing(true)
    setError(null)

    try {
      const result = await window.electron.bvsPlanning.finalizePlan(planningSessionId)

      if (result.success && result.plan) {
        setMessages((prev) => [
          ...prev,
          {
            id: generateMessageId(),
            role: 'assistant',
            content:
              `✓ Plan finalized! Created ${result.plan.sections?.length || 0} bounded sections.\n\n` +
              'Review the sections in the plan view and click "Approve" to start execution.',
            timestamp: Date.now(),
            category: 'finalization',
          },
        ])

        // Call onPlanReady with the generated plan
        if (onPlanReady) {
          onPlanReady(result.plan as BvsExecutionPlan)
        }
      } else {
        setError(result.error || 'Failed to finalize plan')
      }
    } catch (err) {
      console.error('[BvsPlanningChat] Failed to finalize plan:', err)
      setError('Failed to finalize plan')
    } finally {
      setIsProcessing(false)
    }
  }

  // Handle key press
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // No mode selected - show mode selector
  if (!mode) {
    return (
      <div className={cn('flex flex-col h-full bg-card border border-border rounded-lg', className)}>
        <InputModeSelector onSelectMode={handleModeSelect} />
      </div>
    )
  }

  // PRD Upload mode
  if (mode === 'prd_upload' && messages.length === 0) {
    return (
      <div className={cn('flex flex-col h-full bg-card border border-border rounded-lg', className)}>
        <PrdUpload
          onUpload={handlePrdUpload}
          onSwitchToChat={() => handleModeSelect('interactive_planning')}
        />
      </div>
    )
  }

  // Interactive chat mode or PRD uploaded
  return (
    <div className={cn('flex flex-col h-full bg-card border border-border rounded-lg', className)}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-purple-400" />
          <span className="font-medium">BVS Planning Agent</span>
        </div>
        {isReadyToFinalize && (
          <Button size="sm" onClick={handleFinalize} disabled={isProcessing}>
            <CheckCircle className="h-4 w-4 mr-2" />
            Finalize Plan
          </Button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}

        {/* Streaming indicator */}
        {streamingContent && (
          <MessageBubble
            message={{
              id: 'streaming',
              role: 'assistant',
              content: streamingContent,
              timestamp: Date.now(),
            }}
            isStreaming
          />
        )}

        {/* Processing indicator */}
        {isProcessing && !streamingContent && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground p-3">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Thinking...</span>
          </div>
        )}

        {/* Section preview */}
        {proposedSections.length > 0 && (
          <SectionPreview sections={proposedSections} />
        )}

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 text-sm text-red-400 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
            <XCircle className="h-4 w-4" />
            <span>{error}</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t border-border">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe what you want to build..."
            className="flex-1 min-h-[80px] max-h-[200px] p-3 text-sm bg-muted/30 border border-border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-purple-500/50"
            disabled={isProcessing}
          />
          <Button
            size="icon"
            onClick={handleSend}
            disabled={!input.trim() || isProcessing}
            className="h-10 w-10"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}

export default BvsPlanningChat

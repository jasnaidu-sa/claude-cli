/**
 * BVS Plan Revision Chat - Chat panel for revising execution plans
 *
 * Features:
 * - Chat interface to discuss plan changes
 * - Auto-detection warnings displayed
 * - Plan diff preview before applying
 * - Context-aware agent that can read plan and codebase
 */

import React, { useState, useRef, useEffect } from 'react'
import {
  X,
  Send,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  FileCode,
  GitCompare,
  RefreshCw,
  ChevronDown,
  ChevronRight
} from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { Button } from '../ui/button'

export interface PlanIssue {
  id: string
  severity: 'error' | 'warning' | 'info'
  title: string
  description: string
  affectedSections: string[]
  suggestion?: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  isStreaming?: boolean
}

export interface PlanChange {
  type: 'modify' | 'add' | 'remove' | 'reorder'
  sectionId: string
  sectionName: string
  description: string
  before?: string
  after?: string
}

interface BvsPlanRevisionChatProps {
  projectPath: string
  projectId: string
  issues: PlanIssue[]
  onClose: () => void
  onApplyChanges: (changes: PlanChange[]) => Promise<void>
  onRefreshIssues: () => void
  isAnalyzing?: boolean
}

export function BvsPlanRevisionChat({
  projectPath,
  projectId,
  issues,
  onClose,
  onApplyChanges,
  onRefreshIssues,
  isAnalyzing = false
}: BvsPlanRevisionChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inputValue, setInputValue] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [pendingChanges, setPendingChanges] = useState<PlanChange[]>([])
  const [showIssues, setShowIssues] = useState(true)
  const [showChanges, setShowChanges] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Add initial system message if there are issues
  useEffect(() => {
    if (issues.length > 0 && messages.length === 0) {
      const issuesSummary = issues
        .map(i => `- ${i.title}`)
        .join('\n')

      setMessages([{
        id: 'system-1',
        role: 'assistant',
        content: `I've analyzed the plan against your codebase and found ${issues.length} potential issue${issues.length > 1 ? 's' : ''}:\n\n${issuesSummary}\n\nWould you like me to address these issues? You can also describe any other changes you'd like to make to the plan.`,
        timestamp: Date.now()
      }])
    }
  }, [issues])

  const handleSendMessage = async () => {
    if (!inputValue.trim() || isLoading) return

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: inputValue.trim(),
      timestamp: Date.now()
    }

    setMessages(prev => [...prev, userMessage])
    setInputValue('')
    setIsLoading(true)

    try {
      // Call the plan revision agent
      const result = await window.electron.bvsPlanning.revisePlan({
        projectPath,
        projectId,
        message: userMessage.content,
        issues,
        conversationHistory: messages.map(m => ({
          role: m.role,
          content: m.content
        }))
      })

      if (result.success) {
        // Add assistant response
        const assistantMessage: ChatMessage = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: result.response || 'I understand. Let me work on that.',
          timestamp: Date.now()
        }
        setMessages(prev => [...prev, assistantMessage])

        // If there are proposed changes, show them
        if (result.changes && result.changes.length > 0) {
          setPendingChanges(result.changes)
          setShowChanges(true)
        }
      } else {
        // Add error message
        const errorMessage: ChatMessage = {
          id: `error-${Date.now()}`,
          role: 'assistant',
          content: `Sorry, I encountered an error: ${result.error || 'Unknown error'}. Please try again.`,
          timestamp: Date.now()
        }
        setMessages(prev => [...prev, errorMessage])
      }
    } catch (error) {
      const errorMessage: ChatMessage = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: `Sorry, I encountered an error: ${error instanceof Error ? error.message : 'Unknown error'}. Please try again.`,
        timestamp: Date.now()
      }
      setMessages(prev => [...prev, errorMessage])
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  const handleApplyChanges = async () => {
    if (pendingChanges.length === 0) return

    setIsLoading(true)
    try {
      await onApplyChanges(pendingChanges)

      // Add confirmation message
      const confirmMessage: ChatMessage = {
        id: `system-${Date.now()}`,
        role: 'assistant',
        content: `Changes applied successfully. ${pendingChanges.length} section(s) have been updated. You can now resume execution.`,
        timestamp: Date.now()
      }
      setMessages(prev => [...prev, confirmMessage])
      setPendingChanges([])
      setShowChanges(false)
    } catch (error) {
      const errorMessage: ChatMessage = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: `Failed to apply changes: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: Date.now()
      }
      setMessages(prev => [...prev, errorMessage])
    } finally {
      setIsLoading(false)
    }
  }

  const getIssueSeverityIcon = (severity: PlanIssue['severity']) => {
    switch (severity) {
      case 'error':
        return <AlertTriangle className="h-4 w-4 text-red-500" />
      case 'warning':
        return <AlertTriangle className="h-4 w-4 text-yellow-500" />
      case 'info':
        return <CheckCircle2 className="h-4 w-4 text-blue-500" />
    }
  }

  const getChangeTypeColor = (type: PlanChange['type']) => {
    switch (type) {
      case 'add':
        return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
      case 'remove':
        return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
      case 'modify':
        return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400'
      case 'reorder':
        return 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
    }
  }

  return (
    <div className="w-[420px] h-full border-l border-border bg-background flex flex-col animate-in slide-in-from-right duration-200">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-2">
          <GitCompare className="h-5 w-5 text-primary" />
          <h3 className="font-semibold">Revise Plan</h3>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Issues Section (Collapsible) */}
      {issues.length > 0 && (
        <div className="border-b border-border">
          <button
            onClick={() => setShowIssues(!showIssues)}
            className="w-full flex items-center justify-between p-3 hover:bg-muted/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-yellow-500" />
              <span className="text-sm font-medium">
                {issues.length} Issue{issues.length > 1 ? 's' : ''} Detected
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2"
                onClick={(e) => {
                  e.stopPropagation()
                  onRefreshIssues()
                }}
                disabled={isAnalyzing}
              >
                <RefreshCw className={cn('h-3 w-3', isAnalyzing && 'animate-spin')} />
              </Button>
              {showIssues ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </div>
          </button>

          {showIssues && (
            <div className="px-3 pb-3 space-y-2 max-h-48 overflow-y-auto">
              {issues.map((issue) => (
                <div
                  key={issue.id}
                  className={cn(
                    'p-2 rounded-lg text-xs',
                    issue.severity === 'error' && 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800',
                    issue.severity === 'warning' && 'bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800',
                    issue.severity === 'info' && 'bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800'
                  )}
                >
                  <div className="flex items-start gap-2">
                    {getIssueSeverityIcon(issue.severity)}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium">{issue.title}</p>
                      <p className="text-muted-foreground mt-0.5">{issue.description}</p>
                      {issue.affectedSections.length > 0 && (
                        <p className="text-muted-foreground mt-1">
                          Affects: {issue.affectedSections.join(', ')}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Pending Changes Section (Collapsible) */}
      {pendingChanges.length > 0 && (
        <div className="border-b border-border">
          <button
            onClick={() => setShowChanges(!showChanges)}
            className="w-full flex items-center justify-between p-3 hover:bg-muted/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <FileCode className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">
                {pendingChanges.length} Pending Change{pendingChanges.length > 1 ? 's' : ''}
              </span>
            </div>
            {showChanges ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>

          {showChanges && (
            <div className="px-3 pb-3 space-y-2 max-h-48 overflow-y-auto">
              {pendingChanges.map((change, i) => (
                <div key={i} className="p-2 rounded-lg bg-muted/50 text-xs">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-medium uppercase', getChangeTypeColor(change.type))}>
                      {change.type}
                    </span>
                    <span className="font-medium">{change.sectionName}</span>
                  </div>
                  <p className="text-muted-foreground">{change.description}</p>
                </div>
              ))}

              <Button
                className="w-full mt-2"
                size="sm"
                onClick={handleApplyChanges}
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Applying...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    Apply {pendingChanges.length} Change{pendingChanges.length > 1 ? 's' : ''}
                  </>
                )}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Chat Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && issues.length === 0 && (
          <div className="text-center text-muted-foreground py-8">
            <GitCompare className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p className="text-sm">Describe the changes you'd like to make to the plan.</p>
            <p className="text-xs mt-1">For example: "Use Supabase instead of Prisma" or "Skip the auth section"</p>
          </div>
        )}

        {messages.map((message) => (
          <div
            key={message.id}
            className={cn(
              'flex',
              message.role === 'user' ? 'justify-end' : 'justify-start'
            )}
          >
            <div
              className={cn(
                'max-w-[85%] rounded-lg px-3 py-2 text-sm',
                message.role === 'user'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted'
              )}
            >
              <p className="whitespace-pre-wrap">{message.content}</p>
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-muted rounded-lg px-3 py-2">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="p-4 border-t border-border">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe changes to the plan..."
            className={cn(
              'flex-1 min-h-[80px] max-h-[160px] p-3 rounded-lg resize-none',
              'bg-muted/50 border border-border',
              'focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent',
              'text-sm placeholder:text-muted-foreground'
            )}
            disabled={isLoading}
          />
        </div>
        <div className="flex justify-end mt-2">
          <Button
            onClick={handleSendMessage}
            disabled={!inputValue.trim() || isLoading}
            size="sm"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Send className="h-4 w-4 mr-1" />
                Send
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}

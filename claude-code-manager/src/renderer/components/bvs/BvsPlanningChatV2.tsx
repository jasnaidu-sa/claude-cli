/**
 * BVS Planning Chat V2 Component
 *
 * Interactive planning chat with Claude Plan Mode UX:
 * - Tool activity indicators during exploration
 * - Clickable option cards for approach selection
 * - Section preview cards with approve/modify buttons
 * - Streaming response display
 */

import React, { useState, useRef, useEffect, useCallback } from 'react'
import {
  Send,
  Bot,
  User,
  Loader2,
  XCircle,
  CheckCircle,
  Sparkles,
  FileSearch,
  Globe,
  FileText,
  FolderSearch,
  Search,
  PenTool,
  ChevronRight,
  Star,
  AlertCircle,
  Edit3,
  RefreshCw,
} from 'lucide-react'
import { Button } from '../ui/button'
import { cn } from '@renderer/lib/utils'
import type {
  BvsPlanningOption,
  BvsPlanningQuestion,
  BvsPlannedSection,
  BvsPlanningMessageV2,
  BvsPlanningSessionV2,
} from '@preload/index'

// ============================================================================
// Props & Types
// ============================================================================

interface BvsPlanningChatV2Props {
  projectPath: string
  onPlanReady?: (planPath: string) => void
  className?: string
}

interface ToolActivity {
  tool: string
  input: Record<string, unknown>
  result?: string
  status: 'running' | 'complete'
}

// ============================================================================
// Tool Icon Mapping
// ============================================================================

function getToolIcon(toolName: string) {
  switch (toolName) {
    case 'read_file':
      return <FileText className="h-4 w-4" />
    case 'list_files':
      return <FolderSearch className="h-4 w-4" />
    case 'search_code':
      return <Search className="h-4 w-4" />
    case 'web_search':
      return <Globe className="h-4 w-4" />
    case 'write_plan':
      return <PenTool className="h-4 w-4" />
    default:
      return <FileSearch className="h-4 w-4" />
  }
}

function getToolLabel(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case 'read_file':
      return `Reading ${(input.path as string)?.split(/[/\\]/).pop() || 'file'}`
    case 'list_files':
      return `Searching ${input.pattern || 'files'}`
    case 'search_code':
      return `Searching for "${input.pattern}"`
    case 'web_search':
      return `Searching web: ${input.query}`
    case 'write_plan':
      return 'Writing plan.md'
    default:
      return toolName
  }
}

// ============================================================================
// Tool Activity Indicator
// ============================================================================

interface ToolActivityIndicatorProps {
  activities: ToolActivity[]
}

function ToolActivityIndicator({ activities }: ToolActivityIndicatorProps) {
  if (activities.length === 0) return null

  const activeTools = activities.filter(a => a.status === 'running')
  const completedCount = activities.filter(a => a.status === 'complete').length

  // Determine what phase we're in based on tool types
  const hasFileOps = activities.some(a => ['read_file', 'list_files', 'search_code'].includes(a.tool))
  const isWritingPlan = activities.some(a => a.tool === 'write_plan' && a.status === 'running')

  const statusMessage = isWritingPlan
    ? 'Writing implementation plan...'
    : hasFileOps
      ? 'Analyzing codebase...'
      : 'Processing...'

  return (
    <div className="bg-muted/30 border border-border rounded-lg p-4">
      <div className="flex items-center gap-3">
        <Loader2 className="h-5 w-5 animate-spin text-purple-400" />
        <div>
          <div className="text-base font-medium">{statusMessage}</div>
          <div className="text-sm text-muted-foreground">
            {completedCount > 0 && `${completedCount} file${completedCount > 1 ? 's' : ''} analyzed`}
            {activeTools.length > 0 && completedCount > 0 && ' • '}
            {activeTools.length > 0 && `${activeTools.length} in progress`}
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Question Card Component
// ============================================================================

interface QuestionCardProps {
  question: BvsPlanningQuestion
  selectedOptionId?: string
  onSelectOption: (questionId: string, optionId: string) => void
  disabled?: boolean
}

function QuestionCard({ question, selectedOptionId, onSelectOption, disabled }: QuestionCardProps) {
  return (
    <div className="border border-border rounded-lg p-4 bg-card">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm font-medium bg-purple-500/20 text-purple-400 px-2 py-1 rounded">
          {question.category}
        </span>
      </div>
      <h4 className="text-base font-medium mb-3">{question.question}</h4>
      <div className="space-y-2">
        {question.options.map((option) => (
          <button
            key={option.id}
            onClick={() => onSelectOption(question.id, option.id)}
            disabled={disabled}
            className={cn(
              'w-full p-3 rounded-lg border text-left transition-all',
              'hover:border-primary hover:bg-primary/5',
              'focus:outline-none focus:ring-2 focus:ring-primary',
              selectedOptionId === option.id
                ? 'border-primary bg-primary/10'
                : 'border-border',
              disabled && 'opacity-50 cursor-not-allowed'
            )}
          >
            <div className="flex items-start gap-3">
              <div
                className={cn(
                  'w-5 h-5 rounded-full border-2 mt-0.5 shrink-0 flex items-center justify-center',
                  selectedOptionId === option.id
                    ? 'border-primary bg-primary'
                    : 'border-muted-foreground'
                )}
              >
                {selectedOptionId === option.id && (
                  <div className="w-2.5 h-2.5 rounded-full bg-white" />
                )}
              </div>
              <div>
                <div className="text-base font-medium">{option.label}</div>
                <div className="text-base text-muted-foreground">{option.description}</div>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

// ============================================================================
// Questions Panel Component (all questions at once)
// ============================================================================

interface QuestionsPanelProps {
  questions: BvsPlanningQuestion[]
  onSubmitAnswers: (answers: Record<string, string>) => void
  disabled?: boolean
}

function QuestionsPanel({ questions, onSubmitAnswers, disabled }: QuestionsPanelProps) {
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [customInputs, setCustomInputs] = useState<Record<string, string>>({})
  const [showCustom, setShowCustom] = useState<Record<string, boolean>>({})

  const handleSelectOption = (questionId: string, optionId: string) => {
    setAnswers((prev) => ({ ...prev, [questionId]: optionId }))
    // Clear custom input if selecting a preset option
    if (optionId !== 'custom') {
      setShowCustom((prev) => ({ ...prev, [questionId]: false }))
    }
  }

  const handleCustomClick = (questionId: string) => {
    setShowCustom((prev) => ({ ...prev, [questionId]: true }))
    setAnswers((prev) => ({ ...prev, [questionId]: 'custom' }))
  }

  const handleCustomInput = (questionId: string, value: string) => {
    setCustomInputs((prev) => ({ ...prev, [questionId]: value }))
    // Also ensure answers is set to 'custom' when typing
    setAnswers((prev) => ({ ...prev, [questionId]: 'custom' }))
  }

  // Check if all questions have valid answers (either preset or custom with text)
  const allAnswered = questions.every((q) => {
    const answer = answers[q.id]
    if (!answer) return false
    if (answer === 'custom') return (customInputs[q.id]?.trim().length || 0) > 0
    return true
  })

  // Build final answers including custom text
  const buildFinalAnswers = () => {
    const final: Record<string, string> = {}
    for (const q of questions) {
      const answer = answers[q.id]
      if (answer === 'custom') {
        final[q.id] = `custom:${customInputs[q.id]}`
      } else {
        final[q.id] = answer
      }
    }
    return final
  }

  return (
    <div className="space-y-4 mt-4">
      {questions.map((question) => (
        <div key={question.id}>
          <QuestionCard
            question={question}
            selectedOptionId={answers[question.id] === 'custom' ? undefined : answers[question.id]}
            onSelectOption={handleSelectOption}
            disabled={disabled}
          />
          {/* Custom/Other option */}
          <div className="mt-3 ml-4">
            {!showCustom[question.id] ? (
              <button
                onClick={() => handleCustomClick(question.id)}
                disabled={disabled}
                className="text-base text-muted-foreground hover:text-foreground underline"
              >
                Other (type your own answer)
              </button>
            ) : (
              <div className="space-y-2 p-3 border border-primary/50 rounded-lg bg-primary/5">
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded-full border-2 border-primary bg-primary flex items-center justify-center">
                    <div className="w-2.5 h-2.5 rounded-full bg-white" />
                  </div>
                  <span className="text-base font-medium">Custom answer:</span>
                </div>
                <textarea
                  value={customInputs[question.id] || ''}
                  onChange={(e) => handleCustomInput(question.id, e.target.value)}
                  placeholder="Type your specific requirements..."
                  disabled={disabled}
                  className="w-full p-3 text-base border border-border rounded-lg bg-background resize-none"
                  rows={3}
                />
              </div>
            )}
          </div>
        </div>
      ))}
      <div className="flex justify-end pt-2">
        <Button
          onClick={() => onSubmitAnswers(buildFinalAnswers())}
          disabled={disabled || !allAnswered}
          className="gap-2"
        >
          <CheckCircle className="h-4 w-4" />
          Submit Answers
        </Button>
      </div>
    </div>
  )
}

// ============================================================================
// Option Card Component
// ============================================================================

interface OptionCardProps {
  option: BvsPlanningOption
  onSelect: () => void
  disabled?: boolean
}

function OptionCard({ option, onSelect, disabled }: OptionCardProps) {
  const complexityColors = {
    low: 'text-green-400 bg-green-500/10',
    medium: 'text-yellow-400 bg-yellow-500/10',
    high: 'text-red-400 bg-red-500/10',
  }

  return (
    <button
      onClick={onSelect}
      disabled={disabled}
      className={cn(
        'w-full p-4 rounded-lg border-2 text-left transition-all',
        'hover:border-primary hover:bg-primary/5',
        'focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2',
        option.recommended ? 'border-primary/50 bg-primary/5' : 'border-border',
        disabled && 'opacity-50 cursor-not-allowed'
      )}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          {option.recommended && (
            <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
          )}
          <h4 className="font-semibold">{option.name}</h4>
        </div>
        {option.recommended && (
          <span className="text-xs bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded">
            Recommended
          </span>
        )}
      </div>

      <p className="text-base text-muted-foreground mb-3">{option.description}</p>

      <div className="flex items-center gap-4 text-xs">
        <span className="text-muted-foreground">
          {option.sectionCount} sections
        </span>
        <span className={cn('px-2 py-0.5 rounded capitalize', complexityColors[option.complexity])}>
          {option.complexity} complexity
        </span>
      </div>

      <div className="mt-3 flex justify-end">
        <span className="text-sm text-primary flex items-center gap-1">
          Select <ChevronRight className="h-4 w-4" />
        </span>
      </div>
    </button>
  )
}

// ============================================================================
// Section Preview Card
// ============================================================================

interface SectionPreviewCardProps {
  section: BvsPlannedSection
  index: number
}

function SectionPreviewCard({ section, index }: SectionPreviewCardProps) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-3 flex items-center justify-between bg-muted/20 hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono bg-primary/20 text-primary px-2 py-0.5 rounded">
            {section.id}
          </span>
          <span className="font-medium">{section.name}</span>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>{section.files.length} files</span>
          <ChevronRight className={cn('h-4 w-4 transition-transform', expanded && 'rotate-90')} />
        </div>
      </button>

      {expanded && (
        <div className="p-3 space-y-3 border-t border-border">
          <p className="text-base text-muted-foreground">{section.description}</p>

          <div>
            <h5 className="text-xs font-semibold text-muted-foreground uppercase mb-1">Files</h5>
            <div className="space-y-1">
              {section.files.map((file, idx) => (
                <div key={idx} className="flex items-center gap-2 text-sm">
                  <span className={cn(
                    'text-xs px-1.5 py-0.5 rounded',
                    file.action === 'create' && 'bg-green-500/20 text-green-400',
                    file.action === 'modify' && 'bg-yellow-500/20 text-yellow-400',
                    file.action === 'delete' && 'bg-red-500/20 text-red-400'
                  )}>
                    {file.action}
                  </span>
                  <code className="text-xs">{file.path}</code>
                </div>
              ))}
            </div>
          </div>

          {section.dependencies.length > 0 && (
            <div>
              <h5 className="text-xs font-semibold text-muted-foreground uppercase mb-1">Dependencies</h5>
              <div className="flex gap-1">
                {section.dependencies.map((dep, idx) => (
                  <span key={idx} className="text-xs bg-muted px-2 py-0.5 rounded">
                    {dep}
                  </span>
                ))}
              </div>
            </div>
          )}

          {section.successCriteria.length > 0 && (
            <div>
              <h5 className="text-xs font-semibold text-muted-foreground uppercase mb-1">Success Criteria</h5>
              <ul className="space-y-1">
                {section.successCriteria.map((criterion, idx) => (
                  <li key={idx} className="flex items-center gap-2 text-sm text-muted-foreground">
                    <CheckCircle className="h-3 w-3" />
                    {criterion}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Sections Preview Component
// ============================================================================

interface SectionsPreviewProps {
  sections: BvsPlannedSection[]
  onApprove: () => void
  onRequestChanges: () => void
  disabled?: boolean
}

function SectionsPreview({ sections, onApprove, onRequestChanges, disabled }: SectionsPreviewProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Sparkles className="h-5 w-5 text-purple-400" />
        <h3 className="font-semibold">Proposed Plan ({sections.length} sections)</h3>
      </div>

      <div className="space-y-2">
        {sections.map((section, idx) => (
          <SectionPreviewCard key={section.id} section={section} index={idx} />
        ))}
      </div>

      <div className="flex gap-3 pt-2">
        <Button
          onClick={onApprove}
          disabled={disabled}
          className="flex-1"
        >
          <CheckCircle className="h-4 w-4 mr-2" />
          Approve & Create Plan
        </Button>
        <Button
          variant="outline"
          onClick={onRequestChanges}
          disabled={disabled}
        >
          <Edit3 className="h-4 w-4 mr-2" />
          Request Changes
        </Button>
      </div>
    </div>
  )
}

// ============================================================================
// Message Bubble Component
// ============================================================================

interface MessageBubbleProps {
  message: BvsPlanningMessageV2
  onAnswerQuestions?: (answers: Record<string, string>) => void
  onSelectOption?: (optionId: string) => void
  onApprove?: () => void
  onRequestChanges?: () => void
  isProcessing?: boolean
}

function MessageBubble({
  message,
  onAnswerQuestions,
  onSelectOption,
  onApprove,
  onRequestChanges,
  isProcessing
}: MessageBubbleProps) {
  const isUser = message.role === 'user'

  // Debug: Log message structure
  if (message.role === 'assistant') {
    console.log('[MessageBubble] Rendering assistant message:', {
      id: message.id,
      hasQuestions: !!message.questions,
      questionsCount: message.questions?.length || 0,
      hasOptions: !!message.options,
      hasSections: !!message.sections,
      onAnswerQuestions: !!onAnswerQuestions
    })
  }

  // Clean content - remove JSON blocks and tool calls for display
  const displayContent = message.content
    .replace(/---QUESTIONS_START---[\s\S]*?---QUESTIONS_END---/g, '')
    .replace(/---OPTIONS_START---[\s\S]*?---OPTIONS_END---/g, '')
    .replace(/---SECTIONS_START---[\s\S]*?---SECTIONS_END---/g, '')
    // Remove tool_use blocks (XML-style)
    .replace(/<tool_use>[\s\S]*?<\/tool_use>/g, '')
    .replace(/<tool_result>[\s\S]*?<\/tool_result>/g, '')
    // Remove tool calls (alternate format)
    .replace(/<[a-z_]+>\s*<[a-z_]+>[^<]*<\/[a-z_]+>\s*<\/[a-z_]+>/g, '')
    // Remove read_file, list_files, search_code tool blocks
    .replace(/<read_file>[\s\S]*?<\/read_file>/g, '')
    .replace(/<list_files>[\s\S]*?<\/list_files>/g, '')
    .replace(/<search_code>[\s\S]*?<\/search_code>/g, '')
    .replace(/<write_plan>[\s\S]*?<\/write_plan>/g, '')
    // Clean up multiple newlines
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return (
    <div className={cn('flex gap-3', isUser && 'flex-row-reverse')}>
      {/* Avatar */}
      <div
        className={cn(
          'w-8 h-8 rounded-full flex items-center justify-center shrink-0',
          isUser ? 'bg-blue-500/20 text-blue-400' : 'bg-purple-500/20 text-purple-400'
        )}
      >
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>

      {/* Content */}
      <div className={cn('flex-1 space-y-3', isUser && 'text-right')}>
        <div
          className={cn(
            'inline-block p-3 rounded-lg max-w-[90%]',
            isUser ? 'bg-blue-500/10 text-left' : 'bg-muted/30'
          )}
        >
          {displayContent && (
            <div className="text-base whitespace-pre-wrap leading-relaxed">{displayContent}</div>
          )}
        </div>

        {/* Questions (Discovery Phase) */}
        {message.questions && message.questions.length > 0 && onAnswerQuestions && (
          <QuestionsPanel
            questions={message.questions}
            onSubmitAnswers={onAnswerQuestions}
            disabled={isProcessing}
          />
        )}

        {/* Options */}
        {message.options && message.options.length > 0 && onSelectOption && (
          <div className="space-y-2 mt-3">
            {message.options.map((option) => (
              <OptionCard
                key={option.id}
                option={option}
                onSelect={() => onSelectOption(option.id)}
                disabled={isProcessing}
              />
            ))}
          </div>
        )}

        {/* Sections */}
        {message.sections && message.sections.length > 0 && onApprove && onRequestChanges && (
          <div className="mt-3">
            <SectionsPreview
              sections={message.sections}
              onApprove={onApprove}
              onRequestChanges={onRequestChanges}
              disabled={isProcessing}
            />
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// Main Component
// ============================================================================

export function BvsPlanningChatV2({
  projectPath,
  onPlanReady,
  className,
}: BvsPlanningChatV2Props) {
  // State
  const [session, setSession] = useState<BvsPlanningSessionV2 | null>(null)
  const [messages, setMessages] = useState<BvsPlanningMessageV2[]>([])
  const [input, setInput] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [toolActivities, setToolActivities] = useState<ToolActivity[]>([])
  const [error, setError] = useState<string | null>(null)
  const [showChangesInput, setShowChangesInput] = useState(false)
  const [changesInput, setChangesInput] = useState('')

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent, toolActivities])

  // Debug: Log whenever messages array changes
  useEffect(() => {
    console.log('[BvsPlanningChat] Messages updated, count:', messages.length)
    messages.forEach((m, i) => {
      if (m.role === 'assistant') {
        console.log(`[BvsPlanningChat] Message ${i}:`, {
          id: m.id,
          hasQuestions: !!m.questions,
          questionsCount: m.questions?.length || 0,
          contentSnippet: m.content.substring(0, 50)
        })
      }
    })
  }, [messages])

  // Setup streaming listeners
  useEffect(() => {
    const unsubscribers: Array<() => void> = []

    // Tool start
    unsubscribers.push(
      window.electron.bvsPlanning.onToolStart((data) => {
        if (data.sessionId === session?.id) {
          setToolActivities((prev) => [
            ...prev,
            { tool: data.tool, input: data.input, status: 'running' }
          ])
        }
      })
    )

    // Tool result
    unsubscribers.push(
      window.electron.bvsPlanning.onToolResult((data) => {
        if (data.sessionId === session?.id) {
          setToolActivities((prev) =>
            prev.map((a) =>
              a.tool === data.tool && a.status === 'running'
                ? { ...a, result: data.result, status: 'complete' }
                : a
            )
          )
        }
      })
    )

    // Response chunk
    unsubscribers.push(
      window.electron.bvsPlanning.onResponseChunk((data) => {
        if (data.sessionId === session?.id) {
          setStreamingContent(data.fullContent)
        }
      })
    )

    // Response complete
    unsubscribers.push(
      window.electron.bvsPlanning.onResponseComplete((data) => {
        if (data.sessionId === session?.id) {
          console.log('[BvsPlanningChat] Response complete received:', {
            messageId: data.message.id,
            hasQuestions: !!data.message.questions,
            questionsCount: data.message.questions?.length || 0,
            hasOptions: !!data.message.options,
            hasSections: !!data.message.sections,
            contentPreview: data.message.content.substring(0, 100)
          })
          setMessages((prev) => [...prev, data.message])
          setStreamingContent('')
          setToolActivities([])
          setIsProcessing(false)
        }
      })
    )

    // Plan written
    unsubscribers.push(
      window.electron.bvsPlanning.onPlanWritten((data) => {
        if (data.sessionId === session?.id) {
          onPlanReady?.(data.planPath)
        }
      })
    )

    // Error
    unsubscribers.push(
      window.electron.bvsPlanning.onError((data) => {
        if (data.sessionId === session?.id) {
          setError(data.error)
          setIsProcessing(false)
        }
      })
    )

    return () => {
      unsubscribers.forEach((unsub) => unsub())
    }
  }, [session?.id, onPlanReady])

  // Initialize session
  useEffect(() => {
    const initSession = async () => {
      try {
        const result = await window.electron.bvsPlanning.startSession(projectPath)
        if (result.success && result.session) {
          setSession(result.session)
          setMessages(result.session.messages)
          // Reset processing state when session loads
          setIsProcessing(false)
          setStreamingContent('')
          setToolActivities([])
        } else {
          setError(result.error || 'Failed to start planning session')
        }
      } catch (err) {
        setError('Failed to connect to planning service')
      }
    }

    initSession()
  }, [projectPath])

  // Send message
  const handleSend = useCallback(async () => {
    if (!input.trim() || isProcessing || !session) return

    const userMessage: BvsPlanningMessageV2 = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: input.trim(),
      timestamp: Date.now(),
    }

    setMessages((prev) => [...prev, userMessage])
    setInput('')
    setIsProcessing(true)
    setError(null)
    setToolActivities([])

    try {
      await window.electron.bvsPlanning.sendMessage(session.id, input.trim())
      // Response will come through streaming listeners
    } catch (err) {
      setError('Failed to send message')
      setIsProcessing(false)
    }
  }, [input, isProcessing, session])

  // Answer questions (discovery phase)
  const handleAnswerQuestions = useCallback(async (answers: Record<string, string>) => {
    if (!session || isProcessing) return

    setIsProcessing(true)
    setError(null)
    setToolActivities([])

    try {
      await window.electron.bvsPlanning.answerQuestions(session.id, answers)
    } catch (err) {
      setError('Failed to submit answers')
      setIsProcessing(false)
    }
  }, [session, isProcessing])

  // Select option
  const handleSelectOption = useCallback(async (optionId: string) => {
    if (!session || isProcessing) return

    setIsProcessing(true)
    setError(null)
    setToolActivities([])

    try {
      await window.electron.bvsPlanning.selectOption(session.id, optionId)
    } catch (err) {
      setError('Failed to select option')
      setIsProcessing(false)
    }
  }, [session, isProcessing])

  // Approve plan
  const handleApprove = useCallback(async () => {
    if (!session || isProcessing) return

    setIsProcessing(true)
    setError(null)

    try {
      await window.electron.bvsPlanning.approvePlan(session.id)
    } catch (err) {
      setError('Failed to approve plan')
      setIsProcessing(false)
    }
  }, [session, isProcessing])

  // Request changes
  const handleRequestChanges = useCallback(() => {
    setShowChangesInput(true)
  }, [])

  // Submit changes
  const handleSubmitChanges = useCallback(async () => {
    if (!session || isProcessing || !changesInput.trim()) return

    const userMessage: BvsPlanningMessageV2 = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: changesInput.trim(),
      timestamp: Date.now(),
    }

    setMessages((prev) => [...prev, userMessage])
    setChangesInput('')
    setShowChangesInput(false)
    setIsProcessing(true)
    setError(null)

    try {
      await window.electron.bvsPlanning.requestChanges(session.id, changesInput.trim())
    } catch (err) {
      setError('Failed to submit changes')
      setIsProcessing(false)
    }
  }, [session, isProcessing, changesInput])

  // Handle key press
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (showChangesInput) {
        handleSubmitChanges()
      } else {
        handleSend()
      }
    }
  }

  // Start fresh session
  const handleStartFresh = useCallback(async () => {
    if (isProcessing) return

    try {
      // Clear the existing session from disk
      await window.electron.bvsPlanning.clearSession(projectPath)

      // Reset local state
      setMessages([])
      setSession(null)
      setStreamingContent('')
      setToolActivities([])
      setError(null)
      setShowChangesInput(false)
      setChangesInput('')

      // Start a new session
      const result = await window.electron.bvsPlanning.startSession(projectPath)
      if (result.success && result.session) {
        setSession(result.session)
        setMessages(result.session.messages)
      } else {
        setError(result.error || 'Failed to start planning session')
      }
    } catch (err) {
      setError('Failed to start fresh session')
    }
  }, [projectPath, isProcessing])

  return (
    <div className={cn('flex flex-col h-full bg-card border border-border rounded-lg', className)}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-purple-400" />
          <span className="font-medium">BVS Planning Agent</span>
          {session?.phase && (
            <span className="text-xs bg-muted px-2 py-0.5 rounded capitalize">
              {session.phase}
            </span>
          )}
        </div>
        {/* Start Fresh button - always visible */}
        <Button
          variant="ghost"
          size="sm"
          onClick={handleStartFresh}
          disabled={isProcessing}
          className="text-xs"
        >
          <RefreshCw className="h-3 w-3 mr-1" />
          Start Fresh
        </Button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Initial prompt if no messages */}
        {messages.length === 0 && !isProcessing && (
          <div className="text-center py-8 text-muted-foreground">
            <Bot className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p className="text-sm">
              Describe what you want to build or change.
            </p>
            <p className="text-xs mt-1">
              I'll analyze the codebase and propose implementation options.
            </p>
          </div>
        )}

        {/* Messages */}
        {messages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            onAnswerQuestions={handleAnswerQuestions}
            onSelectOption={handleSelectOption}
            onApprove={handleApprove}
            onRequestChanges={handleRequestChanges}
            isProcessing={isProcessing}
          />
        ))}

        {/* Tool activity */}
        {toolActivities.length > 0 && (
          <ToolActivityIndicator activities={toolActivities} />
        )}

        {/* Streaming content */}
        {streamingContent && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-purple-500/20 text-purple-400 flex items-center justify-center shrink-0">
              <Bot className="h-4 w-4" />
            </div>
            <div className="flex-1">
              <div className="inline-block p-3 rounded-lg bg-muted/30 max-w-[90%]">
                <div className="text-base whitespace-pre-wrap leading-relaxed">
                  {/* Clean JSON blocks and tool calls from streaming content */}
                  {streamingContent
                    .replace(/---QUESTIONS_START---[\s\S]*?---QUESTIONS_END---/g, '\n[Loading questions...]\n')
                    .replace(/---OPTIONS_START---[\s\S]*?---OPTIONS_END---/g, '\n[Loading options...]\n')
                    .replace(/---SECTIONS_START---[\s\S]*?---SECTIONS_END---/g, '\n[Loading sections...]\n')
                    .replace(/---QUESTIONS_START---[\s\S]*/g, '\n[Loading questions...]\n')
                    .replace(/---OPTIONS_START---[\s\S]*/g, '\n[Loading options...]\n')
                    .replace(/---SECTIONS_START---[\s\S]*/g, '\n[Loading sections...]\n')
                    // Remove tool_use blocks during streaming
                    .replace(/<tool_use>[\s\S]*?<\/tool_use>/g, '')
                    .replace(/<tool_result>[\s\S]*?<\/tool_result>/g, '')
                    .replace(/<tool_use>[\s\S]*/g, '') // Incomplete tool_use
                    .replace(/<tool_result>[\s\S]*/g, '') // Incomplete tool_result
                    // Remove specific tool blocks
                    .replace(/<read_file>[\s\S]*?<\/read_file>/g, '')
                    .replace(/<list_files>[\s\S]*?<\/list_files>/g, '')
                    .replace(/<search_code>[\s\S]*?<\/search_code>/g, '')
                    .replace(/<write_plan>[\s\S]*?<\/write_plan>/g, '')
                    .replace(/<read_file>[\s\S]*/g, '')
                    .replace(/<list_files>[\s\S]*/g, '')
                    .replace(/<search_code>[\s\S]*/g, '')
                    .replace(/<write_plan>[\s\S]*/g, '')
                    // Clean up multiple newlines
                    .replace(/\n{3,}/g, '\n\n')
                    .trim()}
                </div>
                <Loader2 className="h-3 w-3 animate-spin mt-2" />
              </div>
            </div>
          </div>
        )}

        {/* Processing indicator */}
        {isProcessing && !streamingContent && toolActivities.length === 0 && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground p-3">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Thinking...</span>
          </div>
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

      {/* Changes input (when requesting changes) */}
      {showChangesInput && (
        <div className="p-4 border-t border-border bg-muted/20">
          <div className="flex items-center gap-2 mb-2 text-base text-muted-foreground">
            <Edit3 className="h-4 w-4" />
            <span>What changes would you like?</span>
          </div>
          <div className="flex items-end gap-2">
            <textarea
              value={changesInput}
              onChange={(e) => setChangesInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Describe the changes you want..."
              className="flex-1 min-h-[60px] max-h-[120px] p-3 text-base bg-background border border-border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-primary/50"
              disabled={isProcessing}
            />
            <div className="flex flex-col gap-1">
              <Button size="sm" onClick={handleSubmitChanges} disabled={!changesInput.trim() || isProcessing}>
                Submit
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowChangesInput(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Input */}
      {!showChangesInput && session?.phase !== 'complete' && (
        <div className="p-4 border-t border-border">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Describe what you want to build..."
              className="flex-1 min-h-[80px] max-h-[200px] p-3 text-base bg-muted/30 border border-border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-purple-500/50"
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
      )}

      {/* Complete state */}
      {session?.phase === 'complete' && (
        <div className="p-4 border-t border-border bg-green-500/10">
          <div className="flex items-center gap-2 text-green-400">
            <CheckCircle className="h-5 w-5" />
            <span className="font-medium">Plan created successfully!</span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            The plan has been written to .bvs/plan.md
          </p>
        </div>
      )}
    </div>
  )
}

export default BvsPlanningChatV2

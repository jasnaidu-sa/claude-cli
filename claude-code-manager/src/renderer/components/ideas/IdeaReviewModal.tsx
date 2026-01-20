/**
 * IdeaReviewModal Component
 *
 * Full-screen modal for reviewing and discussing a project idea.
 * Features:
 * - View idea details from email
 * - Discussion thread with user/assistant messages
 * - Set project type (greenfield/brownfield)
 * - Approve or send back to pending
 * - Start project when approved
 */

import React, { useState, useRef, useEffect, useCallback } from 'react'
import {
  X,
  Mail,
  Clock,
  Calendar,
  Tag,
  MessageSquare,
  Send,
  CheckCircle2,
  ArrowLeft,
  PlayCircle,
  Building2,
  Sparkles,
  Lightbulb,
  FileText,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Loader2,
  ExternalLink,
  BookOpen,
  Newspaper,
  Bot,
  GripVertical,
  ClipboardList,
  MessageCircle
} from 'lucide-react'
import { cn } from '@renderer/lib/utils'

// Type for idea discussion streaming data
interface IdeaDiscussStreamData {
  type: 'chunk' | 'complete' | 'error'
  ideaId: string
  chunk?: string
  fullResponse?: string
  error?: string
}
import { Button } from '../ui/button'
import { useAutonomousStore } from '@renderer/stores/autonomous-store'
import { useUIStore } from '@renderer/stores/ui-store'
import { useIdeasStore } from '@renderer/stores/ideas-store'
import type { Idea, IdeaStage, ProjectType, IdeaDiscussionMessage } from '@shared/types'

interface IdeaReviewModalProps {
  idea: Idea
  onClose: () => void
  onMoveStage: (newStage: IdeaStage) => void
  onAddMessage: (role: 'user' | 'assistant', content: string) => void
  onSetProjectType: (projectType: ProjectType, projectPath?: string, projectName?: string, greenfieldProjectName?: string) => void
  onStartProject: () => void
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function DiscussionMessage({ message }: { message: IdeaDiscussionMessage }) {
  const isUser = message.role === 'user'

  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[80%] rounded-lg px-4 py-2',
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-foreground'
        )}
      >
        <div className="text-sm whitespace-pre-wrap">{message.content}</div>
        <div className={cn(
          'text-[10px] mt-1',
          isUser ? 'text-primary-foreground/70' : 'text-muted-foreground'
        )}>
          {formatDate(message.timestamp)}
        </div>
      </div>
    </div>
  )
}

export function IdeaReviewModal({
  idea,
  onClose,
  onMoveStage,
  onAddMessage,
  onSetProjectType,
  onStartProject
}: IdeaReviewModalProps) {
  const { setActivePanel } = useUIStore()
  const { createWorkflow, setPhase, setSelectedProject } = useAutonomousStore()
  const { getIdea: refreshIdea } = useIdeasStore()

  const [newMessage, setNewMessage] = useState('')
  const [showEmailDetails, setShowEmailDetails] = useState(false)
  const [selectedProjectType, setSelectedProjectType] = useState<ProjectType>(idea.projectType)
  const [projectPath, setProjectPath] = useState(idea.associatedProjectPath || '')
  const [projectName, setProjectName] = useState(idea.associatedProjectName || '')
  const [greenfieldProjectName, setGreenfieldProjectName] = useState(idea.projectName || '')
  const [isStarting, setIsStarting] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingResponse, setStreamingResponse] = useState('')
  const [discussMode, setDiscussMode] = useState<'chat' | 'plan' | 'execute'>('chat')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Resizable modal state
  const [modalSize, setModalSize] = useState({ width: 1024, height: window.innerHeight * 0.9 })
  const [isResizing, setIsResizing] = useState(false)
  const [resizeDirection, setResizeDirection] = useState<string | null>(null)
  const resizeStartPos = useRef({ x: 0, y: 0, width: 0, height: 0 })
  const modalRef = useRef<HTMLDivElement>(null)

  // Minimum and maximum modal dimensions
  const MIN_WIDTH = 600
  const MIN_HEIGHT = 400
  const MAX_WIDTH = window.innerWidth - 40
  const MAX_HEIGHT = window.innerHeight - 40

  // Handle resize mouse events
  const handleResizeStart = useCallback((e: React.MouseEvent, direction: string) => {
    e.preventDefault()
    e.stopPropagation()
    setIsResizing(true)
    setResizeDirection(direction)
    resizeStartPos.current = {
      x: e.clientX,
      y: e.clientY,
      width: modalSize.width,
      height: modalSize.height
    }
  }, [modalSize])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing || !resizeDirection) return

      const deltaX = e.clientX - resizeStartPos.current.x
      const deltaY = e.clientY - resizeStartPos.current.y

      let newWidth = resizeStartPos.current.width
      let newHeight = resizeStartPos.current.height

      // Handle horizontal resize
      if (resizeDirection.includes('e')) {
        newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, resizeStartPos.current.width + deltaX * 2))
      } else if (resizeDirection.includes('w')) {
        newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, resizeStartPos.current.width - deltaX * 2))
      }

      // Handle vertical resize
      if (resizeDirection.includes('s')) {
        newHeight = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, resizeStartPos.current.height + deltaY * 2))
      } else if (resizeDirection.includes('n')) {
        newHeight = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, resizeStartPos.current.height - deltaY * 2))
      }

      setModalSize({ width: newWidth, height: newHeight })
    }

    const handleMouseUp = () => {
      setIsResizing(false)
      setResizeDirection(null)
    }

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      // Prevent text selection while resizing
      document.body.style.userSelect = 'none'
      document.body.style.cursor = resizeDirection?.includes('e') || resizeDirection?.includes('w')
        ? 'ew-resize'
        : resizeDirection?.includes('n') || resizeDirection?.includes('s')
          ? 'ns-resize'
          : 'nwse-resize'
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
  }, [isResizing, resizeDirection, MIN_WIDTH, MIN_HEIGHT, MAX_WIDTH, MAX_HEIGHT])

  // Scroll to bottom when new messages are added or streaming
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [idea.discussionMessages, streamingResponse])

  // Set up streaming listener
  useEffect(() => {
    console.log('[IdeaReviewModal] Setting up stream listener for idea:', idea.id)
    const unsubscribe = window.electron.ideas.onDiscussStream((data: IdeaDiscussStreamData) => {
      console.log('[IdeaReviewModal] Received stream data:', data.type, data.ideaId)
      // Only process events for this idea
      if (data.ideaId !== idea.id) return

      if (data.type === 'chunk' && data.chunk) {
        console.log('[IdeaReviewModal] Got chunk:', data.chunk.substring(0, 50))
        setStreamingResponse(prev => prev + data.chunk)
      } else if (data.type === 'complete') {
        console.log('[IdeaReviewModal] Stream complete, refreshing idea')
        setIsStreaming(false)
        setStreamingResponse('')
        setPendingUserMessage(null) // Clear pending message - it's now saved on backend
        // Refresh the idea to get the updated discussion messages
        refreshIdea(idea.id)
      } else if (data.type === 'error') {
        console.log('[IdeaReviewModal] Stream error:', data.error)
        setIsStreaming(false)
        setStreamingResponse('')
        setPendingUserMessage(null)
        console.error('[IdeaReviewModal] Streaming error:', data.error)
      }
    })

    return () => unsubscribe()
  }, [idea.id, refreshIdea])

  // Optimistic user message - shown immediately while waiting for backend
  const [pendingUserMessage, setPendingUserMessage] = useState<string | null>(null)

  const handleSendMessage = async () => {
    if (newMessage.trim() && !isStreaming) {
      const message = newMessage.trim()
      setNewMessage('')
      setPendingUserMessage(message) // Show user message immediately (optimistic UI)
      setIsStreaming(true)
      setStreamingResponse('')

      // Call the discuss API which will stream the response
      // Pass the current discussion mode (chat or plan)
      const result = await window.electron.ideas.discuss(idea.id, message, discussMode)
      if (!result.success) {
        console.error('[IdeaReviewModal] Failed to start discussion:', result.error)
        setIsStreaming(false)
        setPendingUserMessage(null)
      }
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  const handleApprove = () => {
    // Always save project type and associated project info
    onSetProjectType(
      selectedProjectType,
      selectedProjectType === 'brownfield' ? projectPath : undefined,
      selectedProjectType === 'brownfield' ? projectName : undefined,
      selectedProjectType === 'greenfield' ? greenfieldProjectName : undefined
    )
    onMoveStage('approved')
  }

  const handleSendBack = () => {
    onMoveStage('inbox')
  }

  const handleSelectFolder = async () => {
    const result = await window.electron.dialog.selectFolder()
    if (result.success && result.path) {
      const path = result.path
      const name = path.split(/[/\\]/).pop() || 'Unknown Project'
      setProjectPath(path)
      setProjectName(name)
      // Save immediately to backend
      onSetProjectType('brownfield', path, name, undefined)
    }
  }

  // Save greenfield project name when it changes (debounced effect)
  const handleGreenfieldNameChange = (name: string) => {
    setGreenfieldProjectName(name)
  }

  // Save greenfield project name on blur
  const handleGreenfieldNameBlur = () => {
    if (selectedProjectType === 'greenfield' && greenfieldProjectName) {
      onSetProjectType('greenfield', undefined, undefined, greenfieldProjectName)
    }
  }

  // Save project type when changed
  const handleProjectTypeChange = (type: ProjectType) => {
    setSelectedProjectType(type)
    // Save immediately with current values
    if (type === 'brownfield' && projectPath) {
      onSetProjectType(type, projectPath, projectName, undefined)
    } else if (type === 'greenfield') {
      onSetProjectType(type, undefined, undefined, greenfieldProjectName || undefined)
    } else {
      onSetProjectType(type, undefined, undefined, undefined)
    }
  }

  const handleStartAutonomousWorkflow = async () => {
    if (!idea) return

    setIsStarting(true)

    try {
      // Determine project path based on type
      let workflowProjectPath: string
      let workflowProjectName: string

      if (selectedProjectType === 'brownfield') {
        // Use existing project
        if (!projectPath || !projectName) {
          console.error('[IdeaReviewModal] Brownfield project selected but no path/name')
          setIsStarting(false)
          return
        }
        workflowProjectPath = projectPath
        workflowProjectName = projectName
      } else {
        // Greenfield - user will be prompted to select/create folder in autonomous flow
        // For now, use a temp identifier - the autonomous flow will handle project creation
        workflowProjectPath = '' // Will be set in project_select phase
        workflowProjectName = idea.title || 'New Project from Idea'
      }

      // Build spec content from idea
      const specContent = buildSpecFromIdea(idea)

      // Create workflow with idea context
      const workflow = await createWorkflow({
        projectPath: workflowProjectPath || '/tmp/idea-project',
        name: `Idea: ${idea.title}`,
        description: `Autonomous workflow from idea: ${idea.title}`,
        specContent
      })

      if (!workflow) {
        console.error('[IdeaReviewModal] Failed to create workflow')
        setIsStarting(false)
        return
      }

      // Link workflow ID to idea (bidirectional linking)
      const linkResult = await window.electron.ideas.linkWorkflow(idea.id, workflow.id)
      if (!linkResult.success) {
        console.error('[IdeaReviewModal] Failed to link workflow to idea:', linkResult.error)
      }

      // Call the existing onStartProject to update idea stage to in_progress
      await onStartProject()

      // Switch to autonomous panel
      setActivePanel('autonomous')

      // Set autonomous store to spec_review phase with pre-filled spec
      setPhase('spec_review')
      setSelectedProject({
        path: workflowProjectPath || '',
        name: workflowProjectName,
        isNew: selectedProjectType === 'greenfield'
      })

      // Close modal
      onClose()
    } catch (error) {
      console.error('[IdeaReviewModal] Error starting autonomous workflow:', error)
      setIsStarting(false)
    }
  }

  /**
   * Build specification content from idea
   */
  function buildSpecFromIdea(idea: Idea): string {
    const sections: string[] = []

    // Header
    sections.push(`# ${idea.title}`)
    sections.push('')

    // Overview from email
    sections.push('## Overview')
    sections.push(idea.description || idea.emailSource.body)
    sections.push('')

    // Article summaries (AI-generated context)
    if (idea.extractedUrls && idea.extractedUrls.some(u => u.summary)) {
      sections.push('## Article Summaries')
      sections.push('*AI-generated summaries of referenced articles:*')
      sections.push('')
      idea.extractedUrls.filter(u => u.summary).forEach((urlInfo) => {
        sections.push(`### ${urlInfo.title || 'Article'}`)
        if (urlInfo.siteName) {
          sections.push(`*Source: ${urlInfo.siteName}*`)
        }
        sections.push(`[Link](${urlInfo.url})`)
        sections.push('')
        sections.push(urlInfo.summary || '')
        sections.push('')
      })
    }

    // Email source context
    sections.push('## Original Request')
    sections.push(`From: ${idea.emailSource.from}`)
    sections.push(`Subject: ${idea.emailSource.subject}`)
    sections.push(`Received: ${new Date(idea.emailSource.receivedAt).toLocaleDateString()}`)
    sections.push('')
    sections.push('```')
    sections.push(idea.emailSource.body)
    sections.push('```')
    sections.push('')

    // Discussion insights if any
    if (idea.discussionMessages && idea.discussionMessages.length > 0) {
      sections.push('## Discussion Notes')
      idea.discussionMessages.forEach((msg) => {
        const author = msg.role === 'user' ? 'You' : 'AI Assistant'
        sections.push(`**${author}**: ${msg.content}`)
        sections.push('')
      })
    }

    // Project type context
    sections.push('## Project Type')
    sections.push(`Type: ${selectedProjectType}`)
    if (selectedProjectType === 'brownfield' && projectPath) {
      sections.push(`Existing Project: ${projectPath}`)
      sections.push(`Project Name: ${projectName}`)
    }
    sections.push('')

    // Tags if any
    if (idea.tags && idea.tags.length > 0) {
      sections.push('## Tags')
      sections.push(idea.tags.map((t) => `- ${t}`).join('\n'))
      sections.push('')
    }

    // Placeholder sections for AI to fill in
    sections.push('## Features & Requirements')
    sections.push('[TODO: AI will analyze email and extract specific requirements]')
    sections.push('')

    sections.push('## Technical Architecture')
    sections.push('[TODO: AI will research codebase patterns and propose architecture]')
    sections.push('')

    sections.push('## Testing Strategy')
    sections.push('[TODO: AI will define test cases based on requirements]')
    sections.push('')

    return sections.join('\n')
  }

  const canApprove = idea.stage === 'review'
  const canStart = idea.stage === 'approved'
  const isInProgress = idea.stage === 'in_progress'

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div
        ref={modalRef}
        className="bg-card border border-border rounded-xl shadow-2xl flex flex-col overflow-hidden relative"
        style={{
          width: `${modalSize.width}px`,
          height: `${modalSize.height}px`,
          maxWidth: '100%',
          maxHeight: '100%'
        }}
      >
        {/* Resize handles */}
        {/* Top edge */}
        <div
          className="absolute top-0 left-4 right-4 h-1 cursor-ns-resize z-10 hover:bg-primary/30 transition-colors"
          onMouseDown={(e) => handleResizeStart(e, 'n')}
        />
        {/* Bottom edge */}
        <div
          className="absolute bottom-0 left-4 right-4 h-1 cursor-ns-resize z-10 hover:bg-primary/30 transition-colors"
          onMouseDown={(e) => handleResizeStart(e, 's')}
        />
        {/* Left edge */}
        <div
          className="absolute left-0 top-4 bottom-4 w-1 cursor-ew-resize z-10 hover:bg-primary/30 transition-colors"
          onMouseDown={(e) => handleResizeStart(e, 'w')}
        />
        {/* Right edge */}
        <div
          className="absolute right-0 top-4 bottom-4 w-1 cursor-ew-resize z-10 hover:bg-primary/30 transition-colors"
          onMouseDown={(e) => handleResizeStart(e, 'e')}
        />
        {/* Corner handles */}
        <div
          className="absolute top-0 left-0 w-4 h-4 cursor-nwse-resize z-20"
          onMouseDown={(e) => handleResizeStart(e, 'nw')}
        />
        <div
          className="absolute top-0 right-0 w-4 h-4 cursor-nesw-resize z-20"
          onMouseDown={(e) => handleResizeStart(e, 'ne')}
        />
        <div
          className="absolute bottom-0 left-0 w-4 h-4 cursor-nesw-resize z-20"
          onMouseDown={(e) => handleResizeStart(e, 'sw')}
        />
        <div
          className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize z-20 flex items-center justify-center text-muted-foreground/50 hover:text-muted-foreground transition-colors"
          onMouseDown={(e) => handleResizeStart(e, 'se')}
        >
          <GripVertical className="h-3 w-3 rotate-[-45deg]" />
        </div>

        {/* Header */}
        <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-muted/30">
          <div className="flex items-center gap-3">
            <div className={cn(
              'p-2 rounded-lg',
              idea.stage === 'review' && 'bg-blue-500/20 text-blue-400',
              idea.stage === 'approved' && 'bg-green-500/20 text-green-400',
              idea.stage === 'in_progress' && 'bg-purple-500/20 text-purple-400',
              !['review', 'approved', 'in_progress'].includes(idea.stage) && 'bg-gray-500/20 text-gray-400'
            )}>
              {idea.stage === 'review' && <MessageSquare className="h-5 w-5" />}
              {idea.stage === 'approved' && <CheckCircle2 className="h-5 w-5" />}
              {idea.stage === 'in_progress' && <PlayCircle className="h-5 w-5" />}
              {!['review', 'approved', 'in_progress'].includes(idea.stage) && <Lightbulb className="h-5 w-5" />}
            </div>
            <div>
              <h2 className="text-lg font-semibold">{idea.title}</h2>
              <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                <span className="capitalize">{idea.stage.replace('_', ' ')}</span>
                <span>•</span>
                <span className="flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  {formatDate(idea.createdAt)}
                </span>
              </div>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left panel - Details */}
          <div className="w-1/2 border-r border-border flex flex-col overflow-hidden">
            {/* Email source */}
            <div className="px-4 py-3 border-b border-border bg-muted/10">
              <button
                onClick={() => setShowEmailDetails(!showEmailDetails)}
                className="w-full flex items-center justify-between text-sm"
              >
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">Email Source</span>
                </div>
                {showEmailDetails ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
              </button>

              {showEmailDetails && (
                <div className="mt-3 space-y-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground w-16">From:</span>
                    <span className="font-mono">{idea.emailSource.from}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground w-16">Subject:</span>
                    <span>{idea.emailSource.subject}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground w-16">Received:</span>
                    <span>{formatDate(idea.emailSource.receivedAt)}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Description */}
            <div className="flex-1 overflow-auto p-4">
              {/* Article Summaries - Show first if available */}
              {idea.extractedUrls && idea.extractedUrls.some(u => u.summary) && (
                <div className="mb-6">
                  <div className="flex items-center gap-2 mb-3">
                    <Newspaper className="h-4 w-4 text-primary" />
                    <h3 className="font-medium text-sm">Article Summaries</h3>
                  </div>
                  <div className="space-y-4">
                    {idea.extractedUrls.filter(u => u.summary).map((urlInfo, idx) => (
                      <div key={idx} className="bg-muted/30 rounded-lg p-4 border border-border/50">
                        <div className="flex items-start justify-between mb-2">
                          <h4 className="font-medium text-sm text-primary flex items-center gap-2">
                            <BookOpen className="h-4 w-4" />
                            {urlInfo.title || 'Article'}
                          </h4>
                          <a
                            href={urlInfo.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-muted-foreground hover:text-primary transition-colors"
                            title="Open article"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        </div>
                        {urlInfo.siteName && (
                          <div className="text-xs text-muted-foreground mb-2">
                            {urlInfo.siteName}
                          </div>
                        )}
                        <div className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">
                          {urlInfo.summary}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Extracted Links without summaries */}
              {idea.extractedUrls && idea.extractedUrls.some(u => !u.summary && !u.error) && (
                <div className="mb-4">
                  <div className="flex items-center gap-2 mb-2">
                    <ExternalLink className="h-4 w-4 text-muted-foreground" />
                    <h3 className="font-medium text-sm">Links</h3>
                  </div>
                  <div className="space-y-2">
                    {idea.extractedUrls.filter(u => !u.summary && !u.error).map((urlInfo, idx) => (
                      <a
                        key={idx}
                        href={urlInfo.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 text-sm text-primary hover:underline"
                      >
                        <ExternalLink className="h-3 w-3" />
                        {urlInfo.title || urlInfo.url}
                      </a>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2 mb-3">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <h3 className="font-medium text-sm">Original Email</h3>
              </div>
              <div className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
                {idea.description || idea.emailSource.body}
              </div>

              {/* Tags */}
              {idea.tags && idea.tags.length > 0 && (
                <div className="mt-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Tag className="h-4 w-4 text-muted-foreground" />
                    <h3 className="font-medium text-sm">Tags</h3>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {idea.tags.map((tag, idx) => (
                      <span
                        key={idx}
                        className="px-2 py-0.5 bg-secondary rounded text-xs"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Project type selection */}
            <div className="px-4 py-4 border-t border-border bg-muted/10">
              <div className="flex items-center gap-2 mb-3">
                <Lightbulb className="h-4 w-4 text-muted-foreground" />
                <h3 className="font-medium text-sm">Project Type</h3>
              </div>

              <div className="grid grid-cols-2 gap-2 mb-3">
                <button
                  onClick={() => handleProjectTypeChange('greenfield')}
                  className={cn(
                    'p-3 rounded-lg border text-left transition-all',
                    selectedProjectType === 'greenfield'
                      ? 'border-green-500 bg-green-500/10 ring-1 ring-green-500/30'
                      : 'border-border hover:border-green-500/50'
                  )}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Sparkles className="h-4 w-4 text-green-400" />
                    <span className="font-medium text-sm">Greenfield</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    New project from scratch
                  </p>
                </button>

                <button
                  onClick={() => handleProjectTypeChange('brownfield')}
                  className={cn(
                    'p-3 rounded-lg border text-left transition-all',
                    selectedProjectType === 'brownfield'
                      ? 'border-amber-500 bg-amber-500/10 ring-1 ring-amber-500/30'
                      : 'border-border hover:border-amber-500/50'
                  )}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Building2 className="h-4 w-4 text-amber-400" />
                    <span className="font-medium text-sm">Brownfield</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Enhance existing project
                  </p>
                </button>
              </div>

              {/* Greenfield project name */}
              {selectedProjectType === 'greenfield' && (
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">Project Name</label>
                  <input
                    type="text"
                    value={greenfieldProjectName}
                    onChange={(e) => handleGreenfieldNameChange(e.target.value)}
                    onBlur={handleGreenfieldNameBlur}
                    placeholder="Enter project name..."
                    className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-green-500/30"
                  />
                </div>
              )}

              {/* Brownfield project selection */}
              {selectedProjectType === 'brownfield' && (
                <div className="space-y-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={handleSelectFolder}
                  >
                    {projectPath ? 'Change Project' : 'Select Project Folder'}
                  </Button>
                  {projectPath && (
                    <div className="text-xs text-muted-foreground bg-secondary/30 rounded p-2">
                      <div className="font-medium">{projectName}</div>
                      <div className="truncate opacity-70">{projectPath}</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Right panel - Discussion */}
          <div className="w-1/2 flex flex-col overflow-hidden">
            {/* Discussion header */}
            <div className="px-4 py-3 border-b border-border bg-muted/10">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-muted-foreground" />
                  <h3 className="font-medium text-sm">Discussion</h3>
                  <span className="text-xs text-muted-foreground">
                    ({idea.discussionMessages?.length || 0} messages)
                  </span>
                </div>

                {/* Mode toggle */}
                <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-0.5">
                  <button
                    onClick={() => setDiscussMode('chat')}
                    className={cn(
                      'flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-all',
                      discussMode === 'chat'
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                    title="Chat mode - general discussion"
                  >
                    <MessageCircle className="h-3 w-3" />
                    Chat
                  </button>
                  <button
                    onClick={() => setDiscussMode('plan')}
                    className={cn(
                      'flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-all',
                      discussMode === 'plan'
                        ? 'bg-purple-500/20 text-purple-400 shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                    title="Plan mode - structured project planning with file reading"
                  >
                    <ClipboardList className="h-3 w-3" />
                    Plan
                  </button>
                  {/* Execute mode - only show if project is associated */}
                  {idea.associatedProjectPath && (
                    <button
                      onClick={() => setDiscussMode('execute')}
                      className={cn(
                        'flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-all',
                        discussMode === 'execute'
                          ? 'bg-orange-500/20 text-orange-400 shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                      )}
                      title="Execute mode - Claude can read AND write files in the project"
                    >
                      <PlayCircle className="h-3 w-3" />
                      Execute
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-auto p-4 space-y-3">
              {(!idea.discussionMessages || idea.discussionMessages.length === 0) && !isStreaming && !pendingUserMessage ? (
                <div className="text-center text-sm text-muted-foreground py-8">
                  <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-40" />
                  <p>No discussion yet</p>
                  <p className="text-xs mt-1">Ask Claude about this idea</p>
                </div>
              ) : (
                <>
                  {idea.discussionMessages?.map((msg) => (
                    <DiscussionMessage key={msg.id} message={msg} />
                  ))}
                  {/* Pending user message (optimistic UI) */}
                  {pendingUserMessage && (
                    <div className="flex justify-end">
                      <div className="max-w-[80%] rounded-lg px-4 py-2 bg-primary text-primary-foreground">
                        <div className="text-sm whitespace-pre-wrap">{pendingUserMessage}</div>
                        <div className="text-[10px] mt-1 text-primary-foreground/70">
                          Just now
                        </div>
                      </div>
                    </div>
                  )}
                  {/* Streaming response */}
                  {isStreaming && (
                    <div className="flex justify-start">
                      <div className="max-w-[80%] rounded-lg px-4 py-2 bg-muted text-foreground">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                          <Bot className="h-3 w-3" />
                          <span>Claude</span>
                          <Loader2 className="h-3 w-3 animate-spin ml-auto" />
                        </div>
                        <div className="text-sm whitespace-pre-wrap">
                          {streamingResponse || 'Thinking...'}
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Message input */}
            <div className="p-4 border-t border-border bg-muted/10">
              <div className="flex gap-2">
                <textarea
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={
                    discussMode === 'execute'
                      ? "Tell Claude what to implement or change in the project..."
                      : discussMode === 'plan'
                        ? "Ask Claude to help plan this project..."
                        : "Ask Claude about this idea..."
                  }
                  className={cn(
                    "flex-1 resize-none rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2",
                    discussMode === 'execute'
                      ? "border-orange-500/30 focus:ring-orange-500/30"
                      : discussMode === 'plan'
                        ? "border-purple-500/30 focus:ring-purple-500/30"
                        : "border-border focus:ring-primary/30"
                  )}
                  rows={2}
                  disabled={isStreaming}
                />
                <Button
                  size="icon"
                  onClick={handleSendMessage}
                  disabled={!newMessage.trim() || isStreaming}
                >
                  {isStreaming ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* Footer - Actions */}
        <div className="px-6 py-4 border-t border-border bg-muted/30 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            {selectedProjectType === 'undetermined' && (
              <div className="flex items-center gap-1 text-amber-400">
                <AlertTriangle className="h-4 w-4" />
                Select project type before approving
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            {canApprove && (
              <>
                <Button variant="outline" onClick={handleSendBack}>
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Send Back
                </Button>
                <Button
                  onClick={handleApprove}
                  disabled={selectedProjectType === 'undetermined'}
                  className="bg-green-600 hover:bg-green-700"
                >
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Approve
                </Button>
              </>
            )}

            {canStart && (
              <Button
                onClick={handleStartAutonomousWorkflow}
                disabled={isStarting || selectedProjectType === 'undetermined'}
                className="bg-purple-600 hover:bg-purple-700"
              >
                {isStarting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Starting Workflow...
                  </>
                ) : (
                  <>
                    <PlayCircle className="h-4 w-4 mr-2" />
                    Start Autonomous Workflow
                  </>
                )}
              </Button>
            )}

            {isInProgress && (
              <div className="flex items-center gap-2 text-purple-400">
                <PlayCircle className="h-4 w-4 animate-pulse" />
                Autonomous workflow in progress
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

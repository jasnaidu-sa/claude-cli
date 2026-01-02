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

import React, { useState, useRef, useEffect } from 'react'
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
  Loader2
} from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { Button } from '../ui/button'
import { useAutonomousStore } from '@renderer/stores/autonomous-store'
import { useUIStore } from '@renderer/stores/ui-store'
import type { Idea, IdeaStage, ProjectType, IdeaDiscussionMessage } from '@shared/types'

interface IdeaReviewModalProps {
  idea: Idea
  onClose: () => void
  onMoveStage: (newStage: IdeaStage) => void
  onAddMessage: (role: 'user' | 'assistant', content: string) => void
  onSetProjectType: (projectType: ProjectType, projectPath?: string, projectName?: string) => void
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

  const [newMessage, setNewMessage] = useState('')
  const [showEmailDetails, setShowEmailDetails] = useState(false)
  const [selectedProjectType, setSelectedProjectType] = useState<ProjectType>(idea.projectType)
  const [projectPath, setProjectPath] = useState(idea.associatedProjectPath || '')
  const [projectName, setProjectName] = useState(idea.associatedProjectName || '')
  const [isStarting, setIsStarting] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Scroll to bottom when new messages are added
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [idea.discussionMessages])

  const handleSendMessage = () => {
    if (newMessage.trim()) {
      onAddMessage('user', newMessage.trim())
      setNewMessage('')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  const handleApprove = () => {
    // First set project type if changed
    if (selectedProjectType !== idea.projectType) {
      onSetProjectType(
        selectedProjectType,
        selectedProjectType === 'brownfield' ? projectPath : undefined,
        selectedProjectType === 'brownfield' ? projectName : undefined
      )
    }
    onMoveStage('approved')
  }

  const handleSendBack = () => {
    onMoveStage('pending')
  }

  const handleSelectFolder = async () => {
    const result = await window.electron.dialog.selectFolder()
    if (result.success && result.path) {
      setProjectPath(result.path)
      const name = result.path.split(/[/\\]/).pop() || 'Unknown Project'
      setProjectName(name)
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
        specContent,
        status: 'draft',
        ideaId: idea.id // Link to idea
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
      <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-4xl h-[90vh] flex flex-col overflow-hidden">
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
              <div className="flex items-center gap-2 mb-3">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <h3 className="font-medium text-sm">Description</h3>
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
                  onClick={() => setSelectedProjectType('greenfield')}
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
                  onClick={() => setSelectedProjectType('brownfield')}
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
              <div className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-muted-foreground" />
                <h3 className="font-medium text-sm">Discussion</h3>
                <span className="text-xs text-muted-foreground">
                  ({idea.discussionMessages?.length || 0} messages)
                </span>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-auto p-4 space-y-3">
              {(!idea.discussionMessages || idea.discussionMessages.length === 0) ? (
                <div className="text-center text-sm text-muted-foreground py-8">
                  <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-40" />
                  <p>No discussion yet</p>
                  <p className="text-xs mt-1">Start the conversation below</p>
                </div>
              ) : (
                idea.discussionMessages.map((msg) => (
                  <DiscussionMessage key={msg.id} message={msg} />
                ))
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
                  placeholder="Add a note or question..."
                  className="flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  rows={2}
                />
                <Button
                  size="icon"
                  onClick={handleSendMessage}
                  disabled={!newMessage.trim()}
                >
                  <Send className="h-4 w-4" />
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

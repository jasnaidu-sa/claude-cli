/**
 * IdeasView Component
 *
 * Main view for the Email Ideas Kanban system.
 * Features:
 * - Outlook configuration and sync
 * - Kanban board with 5 stages
 * - Review modal for discussing ideas
 * - Stats overview
 */

import React, { useEffect, useState } from 'react'
import {
  Mail,
  RefreshCw,
  Settings,
  Lightbulb,
  CheckCircle2,
  AlertCircle,
  X,
  ExternalLink,
  Trash2,
  RotateCcw,
  Download,
  Plus
} from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { Button } from '../ui/button'
import { IdeasKanbanBoard } from './IdeasKanbanBoard'
import { IdeaReviewModal } from './IdeaReviewModal'
import { useIdeasStore } from '@renderer/stores/ideas-store'
import type { Idea, IdeaStage, ProjectType, OutlookConfig } from '@shared/types'

interface OutlookSetupModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (config: Partial<OutlookConfig>) => void
  currentConfig: OutlookConfig | null
}

function OutlookSetupModal({ isOpen, onClose, onSave, currentConfig }: OutlookSetupModalProps) {
  const [clientId, setClientId] = useState(currentConfig?.clientId || '')
  const [clientSecret, setClientSecret] = useState(currentConfig?.clientSecret || '')
  const [tenantId, setTenantId] = useState(currentConfig?.tenantId || 'common')
  const [sourceEmail, setSourceEmail] = useState(currentConfig?.sourceEmailAddress || '')

  // Update state when modal opens with current config
  useEffect(() => {
    if (isOpen && currentConfig) {
      setClientId(currentConfig.clientId || '')
      setClientSecret(currentConfig.clientSecret || '')
      setTenantId(currentConfig.tenantId || 'common')
      setSourceEmail(currentConfig.sourceEmailAddress || '')
    }
  }, [isOpen, currentConfig])

  if (!isOpen) return null

  const handleSave = () => {
    onSave({
      clientId,
      clientSecret: clientSecret || undefined,
      tenantId,
      sourceEmailAddress: sourceEmail
    })
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <h2 className="text-lg font-semibold">Configure Outlook</h2>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Azure App Client ID</label>
            <input
              type="text"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="Enter your Azure AD App Client ID"
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Create an app at{' '}
              <a href="https://portal.azure.com" className="text-primary hover:underline">
                Azure Portal
              </a>
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Client Secret (Optional)</label>
            <input
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder="Enter client secret (recommended for work accounts)"
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Required to avoid admin consent for organizational accounts
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Tenant ID</label>
            <input
              type="text"
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
              placeholder="common (for personal accounts)"
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Source Email Address</label>
            <input
              type="email"
              value={sourceEmail}
              onChange={(e) => setSourceEmail(e.target.value)}
              placeholder="ideas@example.com"
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Only emails from this address will be imported as ideas
            </p>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-border flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={!clientId || !sourceEmail}>
            Save Configuration
          </Button>
        </div>
      </div>
    </div>
  )
}

interface NewIdeaModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (title: string, description: string) => void
}

function NewIdeaModal({ isOpen, onClose, onSave }: NewIdeaModalProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setTitle('')
      setDescription('')
    }
  }, [isOpen])

  if (!isOpen) return null

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (title.trim() || description.trim()) {
      onSave(title.trim(), description.trim())
    }
  }

  // Handle keyboard shortcuts
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSubmit(e as unknown as React.FormEvent)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Lightbulb className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">New Idea</h2>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </div>

        <form onSubmit={handleSubmit} onKeyDown={handleKeyDown}>
          <div className="p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="What's your idea?"
                autoFocus
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe your idea... (optional)"
                rows={4}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Tip: Press Ctrl+Enter (Cmd+Enter on Mac) to save quickly
              </p>
            </div>
          </div>

          <div className="px-6 py-4 border-t border-border flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={!title.trim() && !description.trim()}>
              <Plus className="h-4 w-4 mr-2" />
              Create Idea
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

export function IdeasView() {
  const {
    ideas,
    loading,
    error,
    outlookStatus,
    outlookConfig,
    syncing,
    syncProgress,
    loadIdeas,
    loadOutlookStatus,
    getIdea,
    createIdea,
    moveStage,
    addDiscussionMessage,
    configureOutlook,
    authenticateOutlook,
    syncEmailsStream,
    fetchEmails,
    setSelectedIdea,
    startProject,
    updateIdea,
    deleteIdea,
    clearAllIdeas,
    reprocessAllIdeas,
    reprocessIdea,
    setError,
    clearError
  } = useIdeasStore()

  const [selectedIdea, setSelectedIdeaLocal] = useState<Idea | null>(null)
  const [showOutlookSetup, setShowOutlookSetup] = useState(false)
  const [showNewIdeaModal, setShowNewIdeaModal] = useState(false)
  const [syncMessage, setSyncMessage] = useState<string | null>(null)

  // Load ideas and Outlook status on mount
  useEffect(() => {
    loadIdeas()
    loadOutlookStatus()
  }, [loadIdeas, loadOutlookStatus])

  // Keep selectedIdea in sync with store updates
  // This ensures the modal gets updated when refreshIdea is called
  useEffect(() => {
    if (selectedIdea) {
      const updatedIdea = ideas.find(i => i.id === selectedIdea.id)
      if (updatedIdea && updatedIdea !== selectedIdea) {
        // Check if discussion messages changed (most common case for this sync)
        const messagesChanged =
          (updatedIdea.discussionMessages?.length || 0) !== (selectedIdea.discussionMessages?.length || 0)
        if (messagesChanged) {
          console.log('[IdeasView] Syncing selectedIdea with store update')
          setSelectedIdeaLocal(updatedIdea)
        }
      }
    }
  }, [ideas, selectedIdea])

  // Handle idea click - fetch latest from backend to ensure we have summaries
  const handleIdeaClick = async (idea: Idea) => {
    console.log('[IdeasView] Clicked idea:', idea.title)

    // Fetch the latest version from backend to ensure we have all data including summaries
    const freshIdea = await getIdea(idea.id)
    if (freshIdea) {
      console.log('[IdeasView] Fresh idea extractedUrls:', freshIdea.extractedUrls)
      console.log('[IdeasView] Has summaries:', freshIdea.extractedUrls?.some(u => u.summary))
      setSelectedIdeaLocal(freshIdea)
    } else {
      console.log('[IdeasView] Could not fetch fresh idea, using cached version')
      setSelectedIdeaLocal(idea)
    }
    setSelectedIdea(idea.id)
  }

  // Handle stage move from Kanban
  const handleMoveStage = async (ideaId: string, newStage: IdeaStage) => {
    const idea = ideas.find((i) => i.id === ideaId)
    if (!idea) return

    // If moving to review, open the modal
    if (newStage === 'review') {
      const updated = await moveStage(ideaId, newStage)
      if (updated) {
        setSelectedIdeaLocal(updated)
        setSelectedIdea(updated.id)
      }
    } else {
      await moveStage(ideaId, newStage)
    }
  }

  // Handle stage move from modal
  const handleModalMoveStage = async (newStage: IdeaStage) => {
    if (!selectedIdea) return
    const updated = await moveStage(selectedIdea.id, newStage)
    if (updated) {
      setSelectedIdeaLocal(updated)
    }
  }

  // Handle add message
  const handleAddMessage = async (role: 'user' | 'assistant', content: string) => {
    if (!selectedIdea) return
    const updated = await addDiscussionMessage(selectedIdea.id, role, content)
    if (updated) {
      setSelectedIdeaLocal(updated)
    }
  }

  // Handle set project type
  const handleSetProjectType = async (projectType: ProjectType, projectPath?: string, projectName?: string, greenfieldProjectName?: string) => {
    if (!selectedIdea) return
    const updated = await updateIdea(selectedIdea.id, {
      projectType,
      associatedProjectPath: projectPath,
      associatedProjectName: greenfieldProjectName || projectName // Use greenfieldProjectName or fall back to brownfield projectName
    })
    if (updated) {
      setSelectedIdeaLocal(updated)
    }
  }

  // Handle start project
  const handleStartProject = async () => {
    if (!selectedIdea) return
    const updated = await startProject(
      selectedIdea.id,
      selectedIdea.projectType,
      selectedIdea.associatedProjectPath,
      selectedIdea.associatedProjectName
    )
    if (updated) {
      setSelectedIdeaLocal(updated)
    }
  }

  // Handle Outlook sync with streaming (progressive display)
  const handleSync = async () => {
    if (!outlookStatus?.authenticated) {
      // Need to authenticate first
      const success = await authenticateOutlook()
      if (!success) return
    }

    // Use streaming sync - ideas appear as they complete
    await syncEmailsStream()
    // Message will be shown via syncProgress state
  }

  // Handle full refresh (clear and re-import) with streaming
  const handleFullRefresh = async () => {
    if (!window.confirm('This will delete all ideas and re-import from email. Continue?')) {
      return
    }

    if (!outlookStatus?.authenticated) {
      const success = await authenticateOutlook()
      if (!success) return
    }

    setSyncMessage('Clearing all ideas...')
    await clearAllIdeas()

    // Use streaming sync with fullRefresh to fetch ALL emails (not just since last sync)
    setSyncMessage(null)
    await syncEmailsStream({ fullRefresh: true })
    // Progress will be shown via syncProgress state
  }

  // Handle reprocess all (update titles from URLs)
  const handleReprocessAll = async () => {
    if (!window.confirm('This will fetch article content from URLs and update titles. Continue?')) {
      return
    }

    setSyncMessage('Reprocessing ideas...')
    const result = await reprocessAllIdeas()
    setSyncMessage(`Reprocessed ${result.processed} ideas, updated ${result.updated}`)
    setTimeout(() => setSyncMessage(null), 5000)
  }

  // Handle reset sync timestamp
  const handleResetSync = async () => {
    try {
      const result = await window.electron.outlook.resetSync()
      if (result.success) {
        setSyncMessage('Sync timestamp reset. Click "Sync Emails" to fetch all matching emails.')
        setTimeout(() => setSyncMessage(null), 5000)
        // Refresh status to show updated lastSyncAt
        await loadOutlookStatus()
      } else {
        setError(result.error || 'Failed to reset sync')
      }
    } catch (err) {
      setError('Failed to reset sync: ' + String(err))
    }
  }

  // Handle Outlook config save
  const handleConfigSave = async (config: Partial<OutlookConfig>) => {
    await configureOutlook(config)
  }

  // Handle new idea creation
  const handleNewIdea = async (title: string, description: string) => {
    const idea = await createIdea({
      title: title || 'New Idea',
      description,
      emailSource: {
        messageId: `manual-${Date.now()}`,
        from: 'manual',
        subject: title || 'New Idea',
        body: description,
        receivedAt: Date.now()
      }
    })
    if (idea) {
      // Open the newly created idea in the review modal
      setSelectedIdeaLocal(idea)
      setSelectedIdea(idea.id)
    }
    setShowNewIdeaModal(false)
  }

  // Calculate stats - Filter out any ideas with invalid stages
  const validIdeas = ideas.filter((i) => {
    const validStages = ['inbox', 'review', 'approved', 'in_progress', 'completed', 'declined']
    return validStages.includes(i.stage)
  })

  const stats = {
    inbox: validIdeas.filter((i) => i.stage === 'inbox').length,
    review: validIdeas.filter((i) => i.stage === 'review').length,
    approved: validIdeas.filter((i) => i.stage === 'approved').length,
    inProgress: validIdeas.filter((i) => i.stage === 'in_progress').length,
    completed: validIdeas.filter((i) => i.stage === 'completed').length,
    declined: validIdeas.filter((i) => i.stage === 'declined').length
  }

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <Lightbulb className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Ideas</h1>
            <p className="text-sm text-muted-foreground">
              {ideas.length} total ideas
              {stats.inProgress > 0 && ` • ${stats.inProgress} in progress`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* New Idea button */}
          <Button
            onClick={() => setShowNewIdeaModal(true)}
            size="sm"
          >
            <Plus className="h-4 w-4 mr-2" />
            New Idea
          </Button>

          {/* Sync progress indicator */}
          {syncing && syncProgress.total > 0 && (
            <div className="flex items-center gap-2 text-sm text-blue-400 bg-blue-500/10 px-3 py-1.5 rounded-full">
              <RefreshCw className="h-4 w-4 animate-spin" />
              Syncing {syncProgress.current}/{syncProgress.total} emails...
            </div>
          )}

          {/* Sync complete message */}
          {!syncing && syncProgress.status === 'complete' && syncProgress.current > 0 && (
            <div className="flex items-center gap-2 text-sm text-green-400 bg-green-500/10 px-3 py-1.5 rounded-full">
              <CheckCircle2 className="h-4 w-4" />
              Synced {syncProgress.current} idea{syncProgress.current !== 1 ? 's' : ''}
            </div>
          )}

          {/* Sync status message (legacy) */}
          {syncMessage && (
            <div className="flex items-center gap-2 text-sm text-green-400 bg-green-500/10 px-3 py-1.5 rounded-full">
              <CheckCircle2 className="h-4 w-4" />
              {syncMessage}
            </div>
          )}

          {/* Outlook status indicator */}
          {outlookStatus && (
            <div className={cn(
              'flex items-center gap-2 text-sm px-3 py-1.5 rounded-full',
              outlookStatus.configured && outlookStatus.authenticated
                ? 'bg-green-500/10 text-green-400'
                : 'bg-amber-500/10 text-amber-400'
            )}>
              <Mail className="h-4 w-4" />
              {outlookStatus.configured && outlookStatus.authenticated ? (
                <span>{outlookStatus.sourceEmail}</span>
              ) : (
                <span>Not connected</span>
              )}
            </div>
          )}

          {/* Sync button */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleSync}
            disabled={syncing || !outlookStatus?.configured}
          >
            <RefreshCw className={cn('h-4 w-4 mr-2', syncing && 'animate-spin')} />
            {syncing ? 'Syncing...' : 'Sync Emails'}
          </Button>

          {/* Full Refresh button */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleFullRefresh}
            disabled={syncing || !outlookStatus?.configured}
            title="Clear all and re-import from email"
          >
            <Download className="h-4 w-4 mr-2" />
            Full Refresh
          </Button>

          {/* Reset Sync button - fixes timestamp issues */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleResetSync}
            disabled={syncing || !outlookStatus?.configured}
            title="Reset sync timestamp to fetch all emails again"
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            Reset Sync
          </Button>

          {/* Reprocess button (update titles from URLs) */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleReprocessAll}
            disabled={syncing || ideas.length === 0}
            title="Extract titles from URLs in existing ideas"
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            Update Titles
          </Button>

          {/* Settings button */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShowOutlookSetup(true)}
            title="Configure Outlook"
          >
            <Settings className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mx-6 mt-4 flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span className="flex-1">{error}</span>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={clearError}>
            <X className="h-3 w-3" />
          </Button>
        </div>
      )}

      {/* Kanban Board */}
      <div className="flex-1 p-6 overflow-hidden">
        {loading ? (
          <div className="h-full flex items-center justify-center text-muted-foreground">
            <RefreshCw className="h-6 w-6 animate-spin mr-2" />
            Loading ideas...
          </div>
        ) : ideas.length === 0 && !outlookStatus?.configured ? (
          <div className="h-full flex flex-col items-center justify-center text-center">
            <Mail className="h-16 w-16 text-muted-foreground/30 mb-4" />
            <h2 className="text-xl font-semibold mb-2">Connect Your Email</h2>
            <p className="text-muted-foreground mb-4 max-w-md">
              Configure Outlook integration to import project ideas from your email.
              Ideas will flow through your Kanban board from inbox to completion.
            </p>
            <Button onClick={() => setShowOutlookSetup(true)}>
              <Settings className="h-4 w-4 mr-2" />
              Configure Outlook
            </Button>
          </div>
        ) : (
          <IdeasKanbanBoard
            ideas={validIdeas.filter((i) => i.stage !== 'completed')}
            onIdeaClick={handleIdeaClick}
            onMoveStage={handleMoveStage}
            onDelete={deleteIdea}
            onRetry={reprocessIdea}
            onError={setError}
          />
        )}
      </div>

      {/* Review Modal */}
      {selectedIdea && (
        <IdeaReviewModal
          idea={selectedIdea}
          onClose={() => {
            setSelectedIdeaLocal(null)
            setSelectedIdea(null)
          }}
          onMoveStage={handleModalMoveStage}
          onAddMessage={handleAddMessage}
          onSetProjectType={handleSetProjectType}
          onStartProject={handleStartProject}
        />
      )}

      {/* Outlook Setup Modal */}
      <OutlookSetupModal
        isOpen={showOutlookSetup}
        onClose={() => setShowOutlookSetup(false)}
        onSave={handleConfigSave}
        currentConfig={outlookConfig}
      />

      {/* New Idea Modal */}
      <NewIdeaModal
        isOpen={showNewIdeaModal}
        onClose={() => setShowNewIdeaModal(false)}
        onSave={handleNewIdea}
      />
    </div>
  )
}

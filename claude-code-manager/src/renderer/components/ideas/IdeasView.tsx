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
  ExternalLink
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

export function IdeasView() {
  const {
    ideas,
    loading,
    error,
    outlookStatus,
    outlookConfig,
    syncing,
    loadIdeas,
    loadOutlookStatus,
    moveStage,
    addDiscussionMessage,
    configureOutlook,
    authenticateOutlook,
    syncEmails,
    setSelectedIdea,
    startProject,
    updateIdea,
    clearError
  } = useIdeasStore()

  const [selectedIdea, setSelectedIdeaLocal] = useState<Idea | null>(null)
  const [showOutlookSetup, setShowOutlookSetup] = useState(false)
  const [syncMessage, setSyncMessage] = useState<string | null>(null)

  // Load ideas and Outlook status on mount
  useEffect(() => {
    loadIdeas()
    loadOutlookStatus()
  }, [loadIdeas, loadOutlookStatus])

  // Handle idea click
  const handleIdeaClick = (idea: Idea) => {
    setSelectedIdeaLocal(idea)
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
  const handleSetProjectType = async (projectType: ProjectType, projectPath?: string, projectName?: string) => {
    if (!selectedIdea) return
    const updated = await updateIdea(selectedIdea.id, {
      projectType,
      associatedProjectPath: projectPath,
      associatedProjectName: projectName
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

  // Handle Outlook sync
  const handleSync = async () => {
    if (!outlookStatus?.authenticated) {
      // Need to authenticate first
      const success = await authenticateOutlook()
      if (!success) return
    }

    const count = await syncEmails()
    setSyncMessage(`Synced ${count} new idea${count !== 1 ? 's' : ''} from email`)
    setTimeout(() => setSyncMessage(null), 3000)
  }

  // Handle Outlook config save
  const handleConfigSave = async (config: Partial<OutlookConfig>) => {
    await configureOutlook(config)
  }

  // Calculate stats
  const stats = {
    inbox: ideas.filter((i) => i.stage === 'inbox').length,
    pending: ideas.filter((i) => i.stage === 'pending').length,
    review: ideas.filter((i) => i.stage === 'review').length,
    approved: ideas.filter((i) => i.stage === 'approved').length,
    inProgress: ideas.filter((i) => i.stage === 'in_progress').length,
    completed: ideas.filter((i) => i.stage === 'completed').length
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
          {/* Sync status message */}
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
            ideas={ideas.filter((i) => i.stage !== 'completed')}
            onIdeaClick={handleIdeaClick}
            onMoveStage={handleMoveStage}
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
    </div>
  )
}

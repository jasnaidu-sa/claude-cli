/**
 * SkillsSettings - Skills management panel.
 *
 * - Skills list with toggle switches
 * - Skill details (name, description, triggers, tier, last executed)
 * - Cron schedule overview
 * - Audit log (collapsible)
 */

import React, { useEffect, useState } from 'react'
import {
  Zap,
  Clock,
  ChevronDown,
  ChevronRight,
  Play,
  FileText,
  Shield,
  Terminal,
  Hash,
} from 'lucide-react'
import { Button } from '../ui/button'
import { useSettingsStore } from '@renderer/stores/settings-store'
import { cn } from '@renderer/lib/utils'
import type { SkillDefinition } from '@shared/skills-types'

const TIER_COLORS: Record<string, string> = {
  bundled: 'bg-blue-500/20 text-blue-500',
  managed: 'bg-purple-500/20 text-purple-500',
  workspace: 'bg-green-500/20 text-green-500',
}

const TIER_LABELS: Record<string, string> = {
  bundled: 'Built-in',
  managed: 'Managed',
  workspace: 'Workspace',
}

export function SkillsSettings() {
  const {
    skills,
    scheduledJobs,
    auditLog,
    loading,
    loadSkills,
    loadScheduledJobs,
    loadAuditLog,
    toggleSkill,
    executeSkill,
  } = useSettingsStore()

  const [expandedSkill, setExpandedSkill] = useState<string | null>(null)
  const [showAudit, setShowAudit] = useState(false)
  const [executing, setExecuting] = useState<string | null>(null)

  useEffect(() => {
    loadSkills()
    loadScheduledJobs()
    loadAuditLog()
  }, [loadSkills, loadScheduledJobs, loadAuditLog])

  const handleToggle = async (skill: SkillDefinition) => {
    await toggleSkill(skill.id, !skill.active)
  }

  const handleExecute = async (skillId: string) => {
    setExecuting(skillId)
    try {
      await executeSkill(skillId)
    } finally {
      setExecuting(null)
    }
  }

  const getTriggersDisplay = (skill: SkillDefinition): string[] => {
    const triggers: string[] = []
    for (const t of skill.frontmatter.triggers) {
      if (t.command) triggers.push(`/${t.command}`)
      if (t.cron) triggers.push(`cron: ${t.cron}`)
      if (t.keywords?.length) triggers.push(`keywords: ${t.keywords.join(', ')}`)
      if (t.event) triggers.push(`event: ${t.event}`)
    }
    return triggers
  }

  const getRiskBadge = (skill: SkillDefinition) => {
    const tier = skill.frontmatter.metadata?.permissions?.risk_tier ?? 0
    const colors = [
      'bg-green-500/20 text-green-500',
      'bg-yellow-500/20 text-yellow-500',
      'bg-orange-500/20 text-orange-500',
      'bg-red-500/20 text-red-500',
      'bg-red-700/20 text-red-700',
    ]
    return (
      <span className={cn('text-[10px] px-1.5 py-0.5 rounded', colors[tier])}>
        T{tier}
      </span>
    )
  }

  return (
    <div className="space-y-6">
      {/* Skills List */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium flex items-center gap-2">
            <Zap className="h-4 w-4" />
            Skills ({skills.length})
          </h3>
        </div>

        {loading.skills ? (
          <p className="text-xs text-muted-foreground">Loading skills...</p>
        ) : skills.length === 0 ? (
          <p className="text-xs text-muted-foreground">No skills found</p>
        ) : (
          <div className="space-y-2">
            {skills.map((skill) => {
              const isExpanded = expandedSkill === skill.id
              const triggers = getTriggersDisplay(skill)

              return (
                <div
                  key={skill.id}
                  className="rounded-lg border border-border overflow-hidden"
                >
                  {/* Skill Header */}
                  <div
                    className="flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/30"
                    onClick={() => setExpandedSkill(isExpanded ? null : skill.id)}
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                    )}

                    {/* Toggle */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleToggle(skill)
                      }}
                      className={cn(
                        'relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors',
                        skill.active ? 'bg-primary' : 'bg-muted',
                      )}
                    >
                      <span
                        className={cn(
                          'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-lg transition-transform',
                          skill.active ? 'translate-x-4' : 'translate-x-0',
                        )}
                      />
                    </button>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">
                          {skill.frontmatter.name}
                        </span>
                        <span className={cn('text-[10px] px-1.5 py-0.5 rounded', TIER_COLORS[skill.tier])}>
                          {TIER_LABELS[skill.tier]}
                        </span>
                        {getRiskBadge(skill)}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {skill.frontmatter.description}
                      </p>
                    </div>

                    {/* Execute button */}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleExecute(skill.id)
                      }}
                      disabled={!skill.active || executing === skill.id}
                    >
                      <Play className={cn('h-3 w-3', executing === skill.id && 'animate-pulse')} />
                    </Button>
                  </div>

                  {/* Expanded Details */}
                  {isExpanded && (
                    <div className="px-3 pb-3 pt-0 space-y-3 border-t border-border">
                      {/* Triggers */}
                      <div className="pt-3">
                        <p className="text-xs font-medium mb-1 flex items-center gap-1">
                          <Terminal className="h-3 w-3" />
                          Triggers
                        </p>
                        <div className="flex flex-wrap gap-1">
                          {triggers.length > 0 ? (
                            triggers.map((t, i) => (
                              <span key={i} className="text-[10px] bg-muted px-2 py-0.5 rounded font-mono">
                                {t}
                              </span>
                            ))
                          ) : (
                            <span className="text-[10px] text-muted-foreground">No triggers</span>
                          )}
                        </div>
                      </div>

                      {/* Permissions */}
                      {skill.frontmatter.metadata?.permissions && (
                        <div>
                          <p className="text-xs font-medium mb-1 flex items-center gap-1">
                            <Shield className="h-3 w-3" />
                            Permissions
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            {skill.frontmatter.metadata.permissions.declared_purpose}
                          </p>
                        </div>
                      )}

                      {/* Body Preview */}
                      <div>
                        <p className="text-xs font-medium mb-1 flex items-center gap-1">
                          <FileText className="h-3 w-3" />
                          Skill Body
                        </p>
                        <pre className="text-[10px] bg-muted p-2 rounded-md max-h-32 overflow-auto whitespace-pre-wrap font-mono">
                          {skill.body.substring(0, 500)}
                          {skill.body.length > 500 && '...'}
                        </pre>
                      </div>

                      {/* Meta */}
                      <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
                        <span>v{skill.frontmatter.version}</span>
                        <span>ID: {skill.id}</span>
                        <span>File: {skill.filePath.split(/[\\/]/).pop()}</span>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Scheduled Jobs */}
      <div>
        <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
          <Clock className="h-4 w-4" />
          Scheduled Jobs ({scheduledJobs.length})
        </h3>
        {scheduledJobs.length === 0 ? (
          <p className="text-xs text-muted-foreground">No cron jobs active</p>
        ) : (
          <div className="space-y-1">
            {scheduledJobs.map((job) => (
              <div
                key={job.skillId}
                className="flex items-center justify-between p-2 rounded-lg bg-muted/50 text-xs"
              >
                <div className="flex items-center gap-2">
                  <Hash className="h-3 w-3 text-muted-foreground" />
                  <span className="font-mono">{job.skillId}</span>
                </div>
                <div className="flex items-center gap-3 text-muted-foreground">
                  <span className="font-mono">{job.cronExpression}</span>
                  <span>Next: {new Date(job.nextRun).toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Audit Log */}
      <div>
        <button
          onClick={() => setShowAudit(!showAudit)}
          className="flex items-center gap-2 text-sm font-medium"
        >
          {showAudit ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          Execution History
        </button>
        {showAudit && (
          <div className="mt-2 space-y-1">
            {auditLog.length === 0 ? (
              <p className="text-xs text-muted-foreground">No execution history</p>
            ) : (
              auditLog.map((entry) => (
                <div
                  key={entry.skillId}
                  className="flex items-center justify-between p-2 rounded-lg bg-muted/50 text-xs"
                >
                  <span className="font-mono">{entry.skillId}</span>
                  <div className="flex items-center gap-3 text-muted-foreground">
                    <span>{entry.executionCount} runs</span>
                    <span>${entry.totalCostUsd.toFixed(4)}</span>
                    {entry.lastExecuted && (
                      <span>{new Date(entry.lastExecuted).toLocaleDateString()}</span>
                    )}
                    {entry.lastError && (
                      <span className="text-red-500 truncate max-w-32" title={entry.lastError}>
                        {entry.lastError}
                      </span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}

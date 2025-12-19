/**
 * JourneyAnalysis Component
 *
 * Phase 1: Automatic user journey analysis for brownfield (existing) projects.
 * Uses the user-journey research agent to analyze the codebase before discovery.
 */

import React, { useEffect, useState, useRef } from 'react'
import { Loader2, CheckCircle, ArrowRight, FileCode, Users, Database, Settings, GitBranch, AlertCircle, XCircle } from 'lucide-react'
import { Button } from '../ui/button'
import { useAutonomousStore, type JourneyAnalysis as JourneyAnalysisType } from '@renderer/stores/autonomous-store'
import type { JourneyAnalysisResult } from '../../../preload/index'

export function JourneyAnalysis() {
  const {
    selectedProject,
    journeyAnalysis,
    setJourneyAnalysis,
    goToNextPhase,
    updateAgentStatus
  } = useAutonomousStore()

  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [statusText, setStatusText] = useState('Starting analysis...')
  const cleanupRef = useRef<(() => void)[]>([])
  const hasStartedRef = useRef(false)

  // Subscribe to journey events
  useEffect(() => {
    if (!selectedProject) return

    // Listen for analysis completion
    const unsubComplete = window.electron.journey.onComplete((data) => {
      if (data.projectPath !== selectedProject.path) return

      if (data.success && data.analysis) {
        const analysis: JourneyAnalysisType = {
          completed: true,
          userFlows: data.analysis.userFlows || [],
          entryPoints: data.analysis.entryPoints || [],
          dataModels: data.analysis.dataModels || [],
          techStack: data.analysis.techStack || [],
          patterns: data.analysis.patterns || [],
          summary: data.analysis.summary || 'Analysis complete'
        }

        setJourneyAnalysis(analysis)
        updateAgentStatus('user-journey', 'complete', 'Analysis complete')
        setAnalyzing(false)

        // Auto-advance after showing results briefly
        setTimeout(() => goToNextPhase(), 2000)
      } else {
        setError(data.error || 'Analysis failed')
        updateAgentStatus('user-journey', 'error', undefined, data.error)
        setAnalyzing(false)
      }
    })
    cleanupRef.current.push(unsubComplete)

    // Listen for status updates
    const unsubStatus = window.electron.journey.onStatus((data) => {
      if (data.projectPath !== selectedProject.path) return
      setStatusText(data.status)
    })
    cleanupRef.current.push(unsubStatus)

    return () => {
      cleanupRef.current.forEach(unsub => unsub())
      cleanupRef.current = []
    }
  }, [selectedProject, setJourneyAnalysis, updateAgentStatus, goToNextPhase])

  // Start analysis when component mounts
  useEffect(() => {
    if (selectedProject && !journeyAnalysis && !analyzing && !hasStartedRef.current) {
      hasStartedRef.current = true
      runAnalysis()
    }
  }, [selectedProject, journeyAnalysis, analyzing])

  const runAnalysis = async () => {
    if (!selectedProject) return

    setAnalyzing(true)
    setError(null)
    setStatusText('Starting analysis...')
    updateAgentStatus('user-journey', 'running')

    try {
      const result = await window.electron.journey.startAnalysis(selectedProject.path)

      if (!result.success) {
        setError(result.error || 'Failed to start analysis')
        updateAgentStatus('user-journey', 'error', undefined, result.error)
        setAnalyzing(false)
      }
      // Analysis completion will come through the onComplete event
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      setError(message)
      updateAgentStatus('user-journey', 'error', undefined, message)
      setAnalyzing(false)
    }
  }

  const handleSkip = () => {
    // Allow skipping analysis
    if (selectedProject) {
      window.electron.journey.cancelAnalysis(selectedProject.path).catch(console.error)
    }
    setJourneyAnalysis({
      completed: true,
      userFlows: [],
      entryPoints: [],
      dataModels: [],
      techStack: [],
      patterns: [],
      summary: 'Analysis skipped'
    })
    goToNextPhase()
  }

  const handleRetry = () => {
    hasStartedRef.current = false
    setError(null)
    runAnalysis()
  }

  return (
    <div className="flex flex-col items-center justify-center h-full p-8">
      <div className="max-w-lg w-full space-y-6">
        <div className="text-center space-y-2">
          <h2 className="text-2xl font-bold">Analyzing Codebase</h2>
          <p className="text-muted-foreground">
            Understanding your project structure and patterns
          </p>
        </div>

        {error ? (
          <div className="space-y-4">
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-medium text-red-500">Analysis Failed</p>
                <p className="text-sm text-muted-foreground mt-1">{error}</p>
              </div>
            </div>

            <div className="flex gap-2">
              <Button onClick={handleRetry} variant="default" className="flex-1">
                Retry Analysis
              </Button>
              <Button onClick={handleSkip} variant="outline" className="flex-1">
                Skip & Continue
              </Button>
            </div>
          </div>
        ) : analyzing ? (
          <div className="space-y-4">
            <div className="flex items-center justify-center gap-2 py-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <span>{statusText}</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <AnalysisItem icon={Users} label="User Flows" />
              <AnalysisItem icon={FileCode} label="Entry Points" />
              <AnalysisItem icon={Database} label="Data Models" />
              <AnalysisItem icon={Settings} label="Patterns" />
            </div>

            <div className="flex justify-center pt-4">
              <Button onClick={handleSkip} variant="ghost" size="sm" className="text-muted-foreground">
                Skip analysis
              </Button>
            </div>
          </div>
        ) : journeyAnalysis ? (
          <div className="space-y-4">
            <div className="bg-secondary/50 rounded-lg p-4 space-y-3">
              <div className="flex items-center gap-2 text-emerald-500">
                <CheckCircle className="h-5 w-5" />
                <span className="font-medium">Analysis Complete</span>
              </div>

              <p className="text-sm text-muted-foreground">
                {journeyAnalysis.summary}
              </p>

              <div className="grid grid-cols-2 gap-2 text-sm">
                <StatBadge icon={Users} label="User Flows" count={journeyAnalysis.userFlows.length} />
                <StatBadge icon={FileCode} label="Entry Points" count={journeyAnalysis.entryPoints.length} />
                <StatBadge icon={Database} label="Data Models" count={journeyAnalysis.dataModels.length} />
                <StatBadge icon={GitBranch} label="Patterns" count={journeyAnalysis.patterns.length} />
              </div>

              {/* Show tech stack */}
              {journeyAnalysis.techStack.length > 0 && (
                <div className="pt-2 border-t border-border">
                  <p className="text-xs text-muted-foreground mb-1">Tech Stack:</p>
                  <div className="flex flex-wrap gap-1">
                    {journeyAnalysis.techStack.map((tech, i) => (
                      <span key={i} className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded">
                        {tech}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <Button onClick={goToNextPhase} className="w-full">
              Continue to Discovery
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function AnalysisItem({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <div className="flex items-center gap-2 p-2 bg-secondary/30 rounded">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <span className="text-sm flex-1">{label}</span>
      <Loader2 className="h-3 w-3 animate-spin text-primary" />
    </div>
  )
}

function StatBadge({ icon: Icon, label, count }: { icon: React.ElementType; label: string; count: number }) {
  return (
    <div className="flex items-center gap-2 p-2 bg-background rounded">
      <Icon className="h-3 w-3 text-muted-foreground" />
      <span className="text-xs">{label}</span>
      <span className="text-xs font-medium ml-auto">{count}</span>
    </div>
  )
}

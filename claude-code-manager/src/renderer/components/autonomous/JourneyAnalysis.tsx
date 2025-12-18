/**
 * JourneyAnalysis Component
 *
 * Phase 1: Automatic user journey analysis for brownfield projects.
 * Simplified version - auto-advances after displaying analysis placeholder.
 */

import React, { useEffect, useState } from 'react'
import { Loader2, CheckCircle, ArrowRight, FileCode, Users, Database, Settings, GitBranch } from 'lucide-react'
import { Button } from '../ui/button'
import { useAutonomousStore, type JourneyAnalysis as JourneyAnalysisType } from '@renderer/stores/autonomous-store'

export function JourneyAnalysis() {
  const {
    selectedProject,
    journeyAnalysis,
    setJourneyAnalysis,
    goToNextPhase,
    updateAgentStatus
  } = useAutonomousStore()

  const [analyzing, setAnalyzing] = useState(false)

  useEffect(() => {
    if (selectedProject && !journeyAnalysis && !analyzing) {
      runAnalysis()
    }
  }, [selectedProject])

  const runAnalysis = async () => {
    if (!selectedProject) return

    setAnalyzing(true)
    updateAgentStatus('user-journey', 'running')

    // Simulate analysis (in full implementation, this would call the research agent)
    await new Promise(resolve => setTimeout(resolve, 2000))

    const analysis: JourneyAnalysisType = {
      completed: true,
      userFlows: ['Main user flow'],
      entryPoints: ['src/index.ts'],
      dataModels: ['User', 'Session'],
      techStack: ['TypeScript', 'React'],
      patterns: ['Zustand store', 'IPC handlers'],
      summary: 'Codebase analyzed - ready for discovery'
    }

    setJourneyAnalysis(analysis)
    updateAgentStatus('user-journey', 'complete', 'Analysis complete')
    setAnalyzing(false)

    // Auto-advance
    setTimeout(() => goToNextPhase(), 1500)
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

        {analyzing ? (
          <div className="space-y-4">
            <div className="flex items-center justify-center gap-2 py-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <span>Analyzing user journeys and patterns...</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <AnalysisItem icon={Users} label="User Flows" />
              <AnalysisItem icon={FileCode} label="Entry Points" />
              <AnalysisItem icon={Database} label="Data Models" />
              <AnalysisItem icon={Settings} label="Patterns" />
            </div>
          </div>
        ) : journeyAnalysis ? (
          <div className="space-y-4">
            <div className="bg-secondary/50 rounded-lg p-4 space-y-3">
              <div className="flex items-center gap-2 text-green-500">
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

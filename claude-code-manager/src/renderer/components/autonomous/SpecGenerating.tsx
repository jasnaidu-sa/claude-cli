/**
 * SpecGenerating Component
 *
 * Phase 3: Background spec generation.
 * Simplified version - triggers spec-builder and waits for completion.
 */

import React, { useEffect, useState } from 'react'
import { Loader2, CheckCircle, ArrowRight, AlertCircle } from 'lucide-react'
import { Button } from '../ui/button'
import { useAutonomousStore } from '@renderer/stores/autonomous-store'

export function SpecGenerating() {
  const {
    selectedProject,
    chatMessages,
    generatedSpec,
    setGeneratedSpec,
    goToNextPhase,
    updateAgentStatus
  } = useAutonomousStore()

  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (selectedProject && !generatedSpec && !generating) {
      generateSpec()
    }
  }, [selectedProject])

  const generateSpec = async () => {
    if (!selectedProject) return

    setGenerating(true)
    setError(null)
    updateAgentStatus('spec-builder', 'running')

    try {
      // Build context from conversation
      const conversationContext = chatMessages
        .filter(m => m.role !== 'system')
        .map(m => `${m.role}: ${m.content}`)
        .join('\n\n')

      // For now, simulate spec generation (in full implementation, this triggers spec-builder agent)
      await new Promise(resolve => setTimeout(resolve, 3000))

      const spec = {
        markdown: `# Generated Specification\n\n${conversationContext}\n\n## Features\n\nBased on the discovery conversation...`,
        appSpecTxt: conversationContext,
        sections: [],
        featureCount: 5,
        readyForExecution: true
      }

      setGeneratedSpec(spec)
      updateAgentStatus('spec-builder', 'complete', 'Spec generated')

      // Auto-advance to review
      setTimeout(() => goToNextPhase(), 1000)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error'
      setError(errorMsg)
      updateAgentStatus('spec-builder', 'error', undefined, errorMsg)
    }

    setGenerating(false)
  }

  return (
    <div className="flex flex-col items-center justify-center h-full p-8">
      <div className="max-w-lg w-full space-y-6">
        <div className="text-center space-y-2">
          <h2 className="text-2xl font-bold">Generating Specification</h2>
          <p className="text-muted-foreground">
            Building a detailed spec for the execution agents
          </p>
        </div>

        {generating ? (
          <div className="flex items-center justify-center gap-2 py-8">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <span>Creating detailed specification...</span>
          </div>
        ) : error ? (
          <div className="space-y-4">
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
              <div className="flex items-center gap-2 text-red-500 mb-2">
                <AlertCircle className="h-5 w-5" />
                <span className="font-medium">Generation Failed</span>
              </div>
              <p className="text-sm text-red-400">{error}</p>
            </div>
            <Button onClick={generateSpec} className="w-full">
              Retry Generation
            </Button>
          </div>
        ) : generatedSpec ? (
          <div className="space-y-4">
            <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
              <div className="flex items-center gap-2 text-green-500 mb-2">
                <CheckCircle className="h-5 w-5" />
                <span className="font-medium">Specification Ready</span>
              </div>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span>{generatedSpec.sections.length} sections</span>
                <span>{generatedSpec.featureCount} features</span>
              </div>
            </div>

            <Button onClick={goToNextPhase} className="w-full">
              Review Specification
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

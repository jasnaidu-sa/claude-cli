/**
 * SpecGenerating Component
 *
 * Phase 3: Background spec generation using the spec-builder research agent.
 * Takes the conversation context from discovery chat and the journey analysis
 * to build a detailed specification for the execution phase.
 */

import React, { useEffect, useState, useRef } from 'react'
import { Loader2, CheckCircle, ArrowRight, AlertCircle, FileText, Code, ListChecks, Layers } from 'lucide-react'
import { Button } from '../ui/button'
import { useAutonomousStore, type GeneratedSpec, type SpecSection } from '@renderer/stores/autonomous-store'
import type { GeneratedSpecResult } from '../../../preload/index'

export function SpecGenerating() {
  const {
    selectedProject,
    chatMessages,
    journeyAnalysis,
    generatedSpec,
    setGeneratedSpec,
    goToNextPhase,
    updateAgentStatus
  } = useAutonomousStore()

  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [statusText, setStatusText] = useState('Preparing...')
  const cleanupRef = useRef<(() => void)[]>([])
  const hasStartedRef = useRef(false)

  // Subscribe to spec builder events
  useEffect(() => {
    if (!selectedProject) return

    // Listen for completion
    const unsubComplete = window.electron.specBuilder.onComplete((data) => {
      if (data.projectPath !== selectedProject.path) return

      if (data.success && data.spec) {
        const spec: GeneratedSpec = {
          markdown: data.spec.markdown,
          appSpecTxt: data.spec.appSpecTxt,
          sections: data.spec.sections.map(s => ({
            id: s.id,
            title: s.title,
            content: s.content,
            editable: s.editable
          })),
          featureCount: data.spec.featureCount,
          readyForExecution: data.spec.readyForExecution
        }

        setGeneratedSpec(spec)
        updateAgentStatus('spec-builder', 'complete', 'Specification generated')
        setGenerating(false)

        // Auto-advance to review
        setTimeout(() => goToNextPhase(), 1500)
      } else {
        setError(data.error || 'Spec generation failed')
        updateAgentStatus('spec-builder', 'error', undefined, data.error)
        setGenerating(false)
      }
    })
    cleanupRef.current.push(unsubComplete)

    // Listen for status updates
    const unsubStatus = window.electron.specBuilder.onStatus((data) => {
      if (data.projectPath !== selectedProject.path) return
      setStatusText(data.status)
    })
    cleanupRef.current.push(unsubStatus)

    return () => {
      cleanupRef.current.forEach(unsub => unsub())
      cleanupRef.current = []
    }
  }, [selectedProject, setGeneratedSpec, updateAgentStatus, goToNextPhase])

  // Start spec generation when component mounts
  useEffect(() => {
    if (selectedProject && !generatedSpec && !generating && !hasStartedRef.current) {
      hasStartedRef.current = true
      generateSpec()
    }
  }, [selectedProject, generatedSpec, generating])

  const generateSpec = async () => {
    if (!selectedProject) return

    setGenerating(true)
    setError(null)
    setStatusText('Building specification...')
    updateAgentStatus('spec-builder', 'running')

    try {
      // Build context from conversation
      const conversationContext = chatMessages
        .filter(m => m.role !== 'system')
        .map(m => `${m.role.toUpperCase()}: ${m.content}`)
        .join('\n\n')

      // Build journey context if available
      let journeyContext: string | undefined
      if (journeyAnalysis && journeyAnalysis.completed) {
        journeyContext = [
          `Tech Stack: ${journeyAnalysis.techStack.join(', ')}`,
          `Patterns: ${journeyAnalysis.patterns.join(', ')}`,
          `User Flows: ${journeyAnalysis.userFlows.join(', ')}`,
          `Entry Points: ${journeyAnalysis.entryPoints.join(', ')}`,
          `Data Models: ${journeyAnalysis.dataModels.join(', ')}`,
          `Summary: ${journeyAnalysis.summary}`
        ].join('\n')
      }

      const result = await window.electron.specBuilder.buildSpec(
        selectedProject.path,
        conversationContext,
        journeyContext
      )

      if (!result.success) {
        setError(result.error || 'Failed to start spec generation')
        updateAgentStatus('spec-builder', 'error', undefined, result.error)
        setGenerating(false)
      }
      // Completion will come through the onComplete event
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      setError(message)
      updateAgentStatus('spec-builder', 'error', undefined, message)
      setGenerating(false)
    }
  }

  const handleRetry = () => {
    hasStartedRef.current = false
    setError(null)
    generateSpec()
  }

  const handleSkip = () => {
    // Allow skipping - create minimal spec from conversation
    if (selectedProject) {
      window.electron.specBuilder.cancel(selectedProject.path).catch(console.error)
    }

    const conversationContext = chatMessages
      .filter(m => m.role !== 'system')
      .map(m => `${m.role}: ${m.content}`)
      .join('\n\n')

    setGeneratedSpec({
      markdown: `# Specification\n\n## Overview\n\nBased on discovery conversation.\n\n## Conversation\n\n${conversationContext}`,
      appSpecTxt: conversationContext,
      sections: [{
        id: 'main',
        title: 'Conversation',
        content: conversationContext,
        editable: true
      }],
      featureCount: 1,
      readyForExecution: true
    })
    goToNextPhase()
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

        {error ? (
          <div className="space-y-4">
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-medium text-red-500">Generation Failed</p>
                <p className="text-sm text-muted-foreground mt-1">{error}</p>
              </div>
            </div>

            <div className="flex gap-2">
              <Button onClick={handleRetry} variant="default" className="flex-1">
                Retry Generation
              </Button>
              <Button onClick={handleSkip} variant="outline" className="flex-1">
                Skip & Continue
              </Button>
            </div>
          </div>
        ) : generating ? (
          <div className="space-y-4">
            <div className="flex items-center justify-center gap-2 py-6">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <span>{statusText}</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <BuildingItem icon={FileText} label="Overview" />
              <BuildingItem icon={Code} label="Technical Details" />
              <BuildingItem icon={ListChecks} label="Test Cases" />
              <BuildingItem icon={Layers} label="Implementation Order" />
            </div>

            <div className="flex justify-center pt-4">
              <Button onClick={handleSkip} variant="ghost" size="sm" className="text-muted-foreground">
                Skip generation
              </Button>
            </div>
          </div>
        ) : generatedSpec ? (
          <div className="space-y-4">
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-4">
              <div className="flex items-center gap-2 text-emerald-500 mb-2">
                <CheckCircle className="h-5 w-5" />
                <span className="font-medium">Specification Ready</span>
              </div>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span>{generatedSpec.sections.length} sections</span>
                <span>{generatedSpec.featureCount} features</span>
                <span>{(generatedSpec.markdown.length / 1000).toFixed(1)}k chars</span>
              </div>
            </div>

            {/* Preview of sections */}
            {generatedSpec.sections.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Sections:</p>
                <div className="flex flex-wrap gap-1">
                  {generatedSpec.sections.slice(0, 6).map((section, i) => (
                    <span key={i} className="text-xs bg-secondary px-2 py-0.5 rounded">
                      {section.title}
                    </span>
                  ))}
                  {generatedSpec.sections.length > 6 && (
                    <span className="text-xs text-muted-foreground">
                      +{generatedSpec.sections.length - 6} more
                    </span>
                  )}
                </div>
              </div>
            )}

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

function BuildingItem({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <div className="flex items-center gap-2 p-2 bg-secondary/30 rounded">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <span className="text-sm flex-1">{label}</span>
      <Loader2 className="h-3 w-3 animate-spin text-primary" />
    </div>
  )
}

/**
 * SpecReview Component
 *
 * Phase 3: Spec review - user reviews and approves the generated specification
 * before execution begins. This is a placeholder for FEAT-023.
 */

import React, { useState } from 'react'
import { FileText, Check, Edit3, AlertTriangle, Play } from 'lucide-react'
import { Button } from '../ui/button'
import { useAutonomousStore } from '@renderer/stores/autonomous-store'
import { cn } from '@renderer/lib/utils'

export function SpecReview() {
  const {
    generatedSpec,
    setGeneratedSpec,
    goToNextPhase,
    selectedProject
  } = useAutonomousStore()

  const [isEditing, setIsEditing] = useState(false)
  const [editedMarkdown, setEditedMarkdown] = useState(generatedSpec?.markdown || '')

  // Placeholder spec for development
  const placeholderSpec = `# Feature Specification

## Project: ${selectedProject?.name || 'Unknown'}
## Type: ${selectedProject?.isNew ? 'Greenfield' : 'Enhancement'}

---

## Overview
[Spec Builder agent will generate this content based on discovery chat - FEAT-022]

## Features
1. Feature 1
   - Sub-feature 1.1
   - Sub-feature 1.2

2. Feature 2
   - Sub-feature 2.1

## Technical Requirements
- Database schema changes
- API endpoints
- UI components

## File Structure
\`\`\`
src/
├── components/
├── services/
└── utils/
\`\`\`

## Test Cases (200 minimum)
[Initializer Agent will expand these into feature_list.json]

---

*This is a placeholder spec. Full implementation in FEAT-023.*
`

  const displaySpec = generatedSpec?.markdown || placeholderSpec

  const handleSaveEdit = () => {
    if (generatedSpec) {
      setGeneratedSpec({
        ...generatedSpec,
        markdown: editedMarkdown
      })
    }
    setIsEditing(false)
  }

  const handleApproveAndStart = () => {
    // In full implementation, this would:
    // 1. Convert spec to app_spec.txt format
    // 2. Create workflow with spec
    // 3. Start Python orchestrator
    goToNextPhase()
  }

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="h-12 px-4 flex items-center justify-between border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium text-sm">Generated Specification</span>
          {!generatedSpec && (
            <span className="text-xs bg-yellow-500/20 text-yellow-500 px-2 py-0.5 rounded">
              Placeholder
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {isEditing ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsEditing(false)}
              >
                Cancel
              </Button>
              <Button size="sm" onClick={handleSaveEdit}>
                <Check className="h-4 w-4 mr-1" />
                Save Changes
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditedMarkdown(displaySpec)
                  setIsEditing(true)
                }}
              >
                <Edit3 className="h-4 w-4 mr-1" />
                Edit Spec
              </Button>
              <Button
                size="sm"
                onClick={handleApproveAndStart}
                className="bg-emerald-600 hover:bg-emerald-700"
              >
                <Play className="h-4 w-4 mr-1" />
                Approve & Start
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex min-h-0">
        {/* Spec Editor/Viewer */}
        <div className="flex-1 overflow-y-auto p-6">
          {isEditing ? (
            <textarea
              value={editedMarkdown}
              onChange={(e) => setEditedMarkdown(e.target.value)}
              className={cn(
                'w-full h-full p-4 rounded-lg',
                'bg-secondary border border-border resize-none',
                'font-mono text-sm',
                'focus:outline-none focus:ring-2 focus:ring-primary'
              )}
            />
          ) : (
            <div className="prose prose-invert max-w-none">
              <pre className="whitespace-pre-wrap font-mono text-sm bg-secondary/50 p-4 rounded-lg">
                {displaySpec}
              </pre>
            </div>
          )}
        </div>

        {/* Validation Sidebar */}
        <div className="w-72 border-l border-border p-4 shrink-0">
          <h3 className="font-medium text-sm mb-3">Validation Status</h3>

          <div className="space-y-3">
            {/* Placeholder validation items */}
            <div className="p-3 bg-secondary/50 rounded">
              <div className="flex items-center gap-2 mb-1">
                <AlertTriangle className="h-4 w-4 text-yellow-500" />
                <span className="font-medium text-sm">Spec Completeness</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Spec validation not yet implemented (FEAT-023)
              </p>
            </div>

            <div className="p-3 bg-secondary/50 rounded">
              <div className="flex items-center gap-2 mb-1">
                <AlertTriangle className="h-4 w-4 text-yellow-500" />
                <span className="font-medium text-sm">Test Coverage</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Minimum 200 test cases required
              </p>
            </div>

            <div className="p-3 bg-secondary/50 rounded">
              <div className="flex items-center gap-2 mb-1">
                <AlertTriangle className="h-4 w-4 text-yellow-500" />
                <span className="font-medium text-sm">Codebase Patterns</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Patterns extracted from codebase analysis
              </p>
            </div>
          </div>

          <div className="mt-6 p-3 bg-blue-500/10 border border-blue-500/20 rounded">
            <p className="text-xs text-blue-400">
              <strong>Note:</strong> Once approved, the spec will be converted to
              app_spec.txt format and the autonomous coding process will begin.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

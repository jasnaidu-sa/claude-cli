/**
 * SpecReview Component
 *
 * Phase 3: Spec review - user reviews and approves the generated specification
 * before execution begins.
 *
 * FEAT-023 Implementation:
 * - Markdown rendering (custom implementation without external libs)
 * - Section navigation sidebar with TOC
 * - Validation status with required sections check
 * - Enhanced edit mode with line numbers
 * - Confirmation dialog for approval
 * - Agent status integration
 */

import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import {
  FileText,
  Check,
  Edit3,
  AlertTriangle,
  Play,
  CheckCircle,
  XCircle,
  Hash,
  List,
  Cpu,
  X,
  AlertCircle,
  Loader2,
  ShieldCheck,
  ShieldAlert,
  RefreshCw
} from 'lucide-react'
import { Button } from '../ui/button'
import { useAutonomousStore } from '@renderer/stores/autonomous-store'
import { cn } from '@renderer/lib/utils'
import type { AgentStatus, GeneratedSpec } from '@renderer/stores/autonomous-store'
import type { ReadinessCheck } from '../../../shared/types'

// Required sections for a valid spec (flexible matching)
// We check for these OR their common alternatives
const SECTION_PATTERNS: Record<string, RegExp> = {
  'Overview': /overview|introduction|summary/i,
  'Features/Requirements': /features?|requirements?|functional/i,
  'Technical': /technical|architecture|implementation|design/i,
  'Testing': /test(s|ing)?|verification|quality/i
}

// ----------------------------------------------------------------------------
// Simple Markdown Renderer (no external dependencies)
// ----------------------------------------------------------------------------

interface MarkdownSection {
  id: string
  title: string
  level: number
}

function parseMarkdownSections(markdown: string): MarkdownSection[] {
  const sections: MarkdownSection[] = []
  const lines = markdown.split('\n')

  for (const line of lines) {
    const h2Match = line.match(/^##\s+(.+)$/)
    const h3Match = line.match(/^###\s+(.+)$/)

    if (h2Match) {
      const title = h2Match[1].trim()
      sections.push({
        id: title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        title,
        level: 2
      })
    } else if (h3Match) {
      const title = h3Match[1].trim()
      sections.push({
        id: title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        title,
        level: 3
      })
    }
  }

  return sections
}

function renderInlineMarkdown(text: string): React.ReactNode {
  // Process inline elements: bold, inline code
  const parts: React.ReactNode[] = []
  let remaining = text
  let key = 0

  while (remaining.length > 0) {
    // Check for bold (**text**)
    const boldMatch = remaining.match(/\*\*(.+?)\*\*/)
    // Check for inline code (`code`)
    const codeMatch = remaining.match(/`([^`]+)`/)

    if (boldMatch && (!codeMatch || boldMatch.index! <= codeMatch.index!)) {
      // Bold comes first
      if (boldMatch.index! > 0) {
        parts.push(remaining.slice(0, boldMatch.index))
      }
      parts.push(
        <strong key={key++} className="font-semibold">
          {boldMatch[1]}
        </strong>
      )
      remaining = remaining.slice(boldMatch.index! + boldMatch[0].length)
    } else if (codeMatch) {
      // Inline code comes first
      if (codeMatch.index! > 0) {
        parts.push(remaining.slice(0, codeMatch.index))
      }
      parts.push(
        <code
          key={key++}
          className="px-1.5 py-0.5 bg-secondary rounded text-sm font-mono"
        >
          {codeMatch[1]}
        </code>
      )
      remaining = remaining.slice(codeMatch.index! + codeMatch[0].length)
    } else {
      // No more matches
      parts.push(remaining)
      break
    }
  }

  return parts.length > 0 ? parts : text
}

interface MarkdownRendererProps {
  content: string
  onSectionVisible?: (sectionId: string) => void
}

function MarkdownRenderer({ content, onSectionVisible }: MarkdownRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const sectionRefs = useRef<Map<string, HTMLElement>>(new Map())

  // Track visible sections
  useEffect(() => {
    if (!onSectionVisible || !containerRef.current) return

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const sectionId = entry.target.getAttribute('data-section-id')
            if (sectionId) {
              onSectionVisible(sectionId)
            }
          }
        }
      },
      {
        root: containerRef.current.parentElement,
        rootMargin: '-20% 0px -70% 0px',
        threshold: 0
      }
    )

    sectionRefs.current.forEach((element) => {
      observer.observe(element)
    })

    return () => observer.disconnect()
  }, [content, onSectionVisible])

  const elements: React.ReactNode[] = []
  const lines = content.split('\n')
  let i = 0
  let key = 0

  while (i < lines.length) {
    const line = lines[i]

    // Code block (```)
    if (line.startsWith('```')) {
      const language = line.slice(3).trim()
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      elements.push(
        <pre
          key={key++}
          className="my-3 p-4 bg-secondary/70 rounded-lg overflow-x-auto"
        >
          <code className="text-sm font-mono">{codeLines.join('\n')}</code>
        </pre>
      )
      i++
      continue
    }

    // H1 (#)
    if (line.startsWith('# ')) {
      const title = line.slice(2).trim()
      elements.push(
        <h1 key={key++} className="text-2xl font-bold mb-4 mt-6 first:mt-0">
          {title}
        </h1>
      )
      i++
      continue
    }

    // H2 (##)
    if (line.startsWith('## ')) {
      const title = line.slice(3).trim()
      const sectionId = title.toLowerCase().replace(/[^a-z0-9]+/g, '-')
      elements.push(
        <h2
          key={key++}
          id={sectionId}
          data-section-id={sectionId}
          ref={(el) => {
            if (el) sectionRefs.current.set(sectionId, el)
          }}
          className="text-xl font-semibold mb-3 mt-6 first:mt-0 scroll-mt-4"
        >
          {title}
        </h2>
      )
      i++
      continue
    }

    // H3 (###)
    if (line.startsWith('### ')) {
      const title = line.slice(4).trim()
      const sectionId = title.toLowerCase().replace(/[^a-z0-9]+/g, '-')
      elements.push(
        <h3
          key={key++}
          id={sectionId}
          data-section-id={sectionId}
          ref={(el) => {
            if (el) sectionRefs.current.set(sectionId, el)
          }}
          className="text-lg font-medium mb-2 mt-4 scroll-mt-4"
        >
          {title}
        </h3>
      )
      i++
      continue
    }

    // Horizontal rule (---)
    if (line.match(/^---+$/)) {
      elements.push(<hr key={key++} className="my-4 border-border" />)
      i++
      continue
    }

    // Unordered list (- or *)
    if (line.match(/^[\s]*[-*]\s/)) {
      const listItems: { indent: number; content: string }[] = []
      while (i < lines.length && lines[i].match(/^[\s]*[-*]\s/)) {
        const match = lines[i].match(/^(\s*)([-*])\s(.+)$/)
        if (match) {
          listItems.push({
            indent: match[1].length,
            content: match[3]
          })
        }
        i++
      }
      elements.push(
        <ul key={key++} className="my-2 space-y-1">
          {listItems.map((item, idx) => (
            <li
              key={idx}
              className="flex items-start gap-2"
              style={{ paddingLeft: `${item.indent * 0.5}rem` }}
            >
              <span className="text-muted-foreground mt-1.5">-</span>
              <span>{renderInlineMarkdown(item.content)}</span>
            </li>
          ))}
        </ul>
      )
      continue
    }

    // Ordered list (1. 2. etc)
    if (line.match(/^\d+\.\s/)) {
      const listItems: string[] = []
      while (i < lines.length && lines[i].match(/^(\d+\.|\s{2,}[-*])\s/)) {
        const match = lines[i].match(/^(\d+\.|\s*[-*])\s(.+)$/)
        if (match) {
          listItems.push(match[2])
        }
        i++
      }
      elements.push(
        <ol key={key++} className="my-2 space-y-1 list-decimal list-inside">
          {listItems.map((item, idx) => (
            <li key={idx}>{renderInlineMarkdown(item)}</li>
          ))}
        </ol>
      )
      continue
    }

    // Paragraph (non-empty line)
    if (line.trim()) {
      // Collect paragraph lines
      const paragraphLines: string[] = [line]
      i++
      while (
        i < lines.length &&
        lines[i].trim() &&
        !lines[i].startsWith('#') &&
        !lines[i].startsWith('```') &&
        !lines[i].match(/^[-*]\s/) &&
        !lines[i].match(/^\d+\.\s/) &&
        !lines[i].match(/^---+$/)
      ) {
        paragraphLines.push(lines[i])
        i++
      }
      elements.push(
        <p key={key++} className="my-2 leading-relaxed">
          {renderInlineMarkdown(paragraphLines.join(' '))}
        </p>
      )
      continue
    }

    // Empty line - skip
    i++
  }

  return (
    <div ref={containerRef} className="prose prose-invert max-w-none">
      {elements}
    </div>
  )
}

// ----------------------------------------------------------------------------
// Line Numbers Editor
// ----------------------------------------------------------------------------

interface LineNumberEditorProps {
  value: string
  onChange: (value: string) => void
}

function LineNumberEditor({ value, onChange }: LineNumberEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const lineNumbersRef = useRef<HTMLDivElement>(null)
  const lines = value.split('\n')

  const handleScroll = useCallback(() => {
    if (textareaRef.current && lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = textareaRef.current.scrollTop
    }
  }, [])

  return (
    <div className="flex h-full border border-border rounded-lg overflow-hidden bg-secondary">
      {/* Line numbers */}
      <div
        ref={lineNumbersRef}
        className="w-12 bg-secondary/50 border-r border-border overflow-hidden select-none shrink-0"
        aria-hidden="true"
      >
        <div className="py-4 pr-2 text-right">
          {lines.map((_, idx) => (
            <div
              key={idx}
              className="text-xs font-mono text-muted-foreground leading-6 h-6"
            >
              {idx + 1}
            </div>
          ))}
        </div>
      </div>

      {/* Editor */}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={handleScroll}
        className={cn(
          'flex-1 p-4 bg-transparent resize-none',
          'font-mono text-sm leading-6',
          'focus:outline-none',
          'placeholder:text-muted-foreground'
        )}
        placeholder="Enter your specification markdown..."
        spellCheck={false}
        aria-label="Specification editor"
      />
    </div>
  )
}

// ----------------------------------------------------------------------------
// Confirmation Dialog
// ----------------------------------------------------------------------------

interface ConfirmDialogProps {
  open: boolean
  onConfirm: () => void
  onCancel: () => void
  title: string
  description: string
  confirmText?: string
  cancelText?: string
  isLoading?: boolean
}

function ConfirmDialog({
  open,
  onConfirm,
  onCancel,
  title,
  description,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  isLoading = false
}: ConfirmDialogProps) {
  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onCancel}
        aria-hidden="true"
      />

      {/* Dialog */}
      <div className="relative bg-background border border-border rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
        <button
          onClick={onCancel}
          className="absolute top-4 right-4 text-muted-foreground hover:text-foreground"
          aria-label="Close dialog"
        >
          <X className="h-4 w-4" />
        </button>

        <h2 id="confirm-dialog-title" className="text-lg font-semibold mb-2">
          {title}
        </h2>
        <p className="text-sm text-muted-foreground mb-6">{description}</p>

        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={onCancel} disabled={isLoading}>
            {cancelText}
          </Button>
          <Button
            onClick={onConfirm}
            disabled={isLoading}
            className="bg-emerald-600 hover:bg-emerald-700"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <Play className="h-4 w-4 mr-2" />
                {confirmText}
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ----------------------------------------------------------------------------
// Validation Logic
// ----------------------------------------------------------------------------

interface ValidationResult {
  isValid: boolean
  sections: {
    name: string
    present: boolean
  }[]
  featureCount: number
  warnings: string[]
}

function validateSpec(markdown: string): ValidationResult {
  // Extract all H2 section headers from the markdown
  const h2Headers: string[] = []
  const headerMatches = markdown.matchAll(/^##\s+(.+)$/gim)
  for (const match of headerMatches) {
    h2Headers.push(match[1].trim())
  }

  // Check each required section pattern against actual headers
  const sections = Object.entries(SECTION_PATTERNS).map(([name, pattern]) => {
    const present = h2Headers.some(header => pattern.test(header))
    return { name, present }
  })

  // Count features/requirements mentioned (look in any features/requirements section)
  let featureCount = 0
  const featureSection = markdown.match(
    /##\s+(Features?|Requirements?|Functional)[\s\S]*?(?=##|$)/i
  )
  if (featureSection) {
    // Count numbered items
    const numberedItems = featureSection[0].match(/^\d+\./gm)
    // Count bullet items
    const bulletItems = featureSection[0].match(/^[\s]*[-*]\s/gm)
    featureCount = (numberedItems?.length || 0) + (bulletItems?.length || 0)
  }

  // Also check Implementation Steps for feature-like content
  const implSection = markdown.match(
    /##\s+Implementation[\s\S]*?(?=##|$)/i
  )
  if (implSection && featureCount === 0) {
    const numberedItems = implSection[0].match(/^\d+\./gm)
    const bulletItems = implSection[0].match(/^[\s]*[-*]\s/gm)
    featureCount = (numberedItems?.length || 0) + (bulletItems?.length || 0)
  }

  const warnings: string[] = []

  // Check for missing sections
  const missingSections = sections.filter((s) => !s.present)
  if (missingSections.length > 0) {
    warnings.push(
      `Missing sections: ${missingSections.map((s) => s.name).join(', ')}`
    )
  }

  // Check feature count
  if (featureCount < 3) {
    warnings.push('Spec should list at least 3 features/steps')
  }

  // Check for test/testing section content
  const testSection = markdown.match(/##\s+(Test(s|ing)?|Verification)[\s\S]*?(?=##|$)/i)
  if (testSection && testSection[0].length < 100) {
    warnings.push('Testing section seems incomplete')
  }

  return {
    isValid: missingSections.length === 0 && featureCount >= 1,
    sections,
    featureCount,
    warnings
  }
}

// ----------------------------------------------------------------------------
// Convert Markdown to app_spec.txt format
// ----------------------------------------------------------------------------

function convertToAppSpec(markdown: string, projectName: string): string {
  // Simple conversion - strip markdown formatting for plain text
  let text = markdown

  // Remove code block markers but keep content
  text = text.replace(/```[\w]*\n?/g, '')

  // Convert headers to uppercase with underlines
  text = text.replace(/^#\s+(.+)$/gm, (_, title) => {
    return `${'='.repeat(title.length)}\n${title.toUpperCase()}\n${'='.repeat(title.length)}`
  })
  text = text.replace(/^##\s+(.+)$/gm, (_, title) => {
    return `\n${title.toUpperCase()}\n${'-'.repeat(title.length)}`
  })
  text = text.replace(/^###\s+(.+)$/gm, (_, title) => `\n${title}:`)

  // Remove bold markers
  text = text.replace(/\*\*(.+?)\*\*/g, '$1')

  // Remove inline code markers
  text = text.replace(/`([^`]+)`/g, '$1')

  // Clean up extra whitespace
  text = text.replace(/\n{3,}/g, '\n\n')

  // Add header
  const header = `APP SPECIFICATION
================
Project: ${projectName}
Generated: ${new Date().toISOString()}

`

  return header + text.trim()
}

// ----------------------------------------------------------------------------
// Agent Status Display
// ----------------------------------------------------------------------------

interface AgentStatusDisplayProps {
  agents: AgentStatus[]
}

function AgentStatusDisplay({ agents }: AgentStatusDisplayProps) {
  const getStatusColor = (status: AgentStatus['status']): string => {
    switch (status) {
      case 'running':
        return 'bg-primary/20 text-primary'
      case 'complete':
        return 'bg-emerald-500/20 text-emerald-500'
      case 'error':
        return 'bg-red-500/20 text-red-500'
      case 'idle':
      default:
        return 'bg-secondary text-muted-foreground'
    }
  }

  const getStatusIcon = (status: AgentStatus['status']) => {
    switch (status) {
      case 'running':
        return <Loader2 className="h-3 w-3 animate-spin" />
      case 'complete':
        return <CheckCircle className="h-3 w-3" />
      case 'error':
        return <XCircle className="h-3 w-3" />
      default:
        return null
    }
  }

  // Find the Spec Builder agent
  const specBuilderAgent = agents.find(
    (a) => a.name.toLowerCase().includes('spec') || a.name.toLowerCase().includes('builder')
  )

  return (
    <div className="p-3 bg-secondary/50 rounded-lg">
      <div className="flex items-center gap-2 mb-2">
        <Cpu className="h-4 w-4 text-muted-foreground" />
        <span className="font-medium text-sm">Spec Builder Agent</span>
      </div>

      {specBuilderAgent ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs',
                getStatusColor(specBuilderAgent.status)
              )}
            >
              {getStatusIcon(specBuilderAgent.status)}
              {specBuilderAgent.status}
            </span>
          </div>
          {specBuilderAgent.output && (
            <p className="text-xs text-muted-foreground">{specBuilderAgent.output}</p>
          )}
          {specBuilderAgent.error && (
            <p className="text-xs text-red-500">{specBuilderAgent.error}</p>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Agent status will appear here when available.
        </p>
      )}
    </div>
  )
}

// ----------------------------------------------------------------------------
// Main Component
// ----------------------------------------------------------------------------

export function SpecReview() {
  const {
    generatedSpec,
    setGeneratedSpec,
    goToNextPhase,
    selectedProject,
    agentStatuses
  } = useAutonomousStore()

  const [isEditing, setIsEditing] = useState(false)
  const [editedMarkdown, setEditedMarkdown] = useState(generatedSpec?.markdown || '')
  const [activeSection, setActiveSection] = useState<string | null>(null)
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)
  const [isApproving, setIsApproving] = useState(false)
  // BMAD-Inspired: Readiness Gate
  const [readinessCheck, setReadinessCheck] = useState<ReadinessCheck | null>(null)
  const [isCheckingReadiness, setIsCheckingReadiness] = useState(false)
  const [specFromDisk, setSpecFromDisk] = useState<string | null>(null)
  const [isLoadingSpec, setIsLoadingSpec] = useState(true)
  const contentRef = useRef<HTMLDivElement>(null)

  // Load spec from disk on mount (Quick Spec saves directly to disk)
  useEffect(() => {
    const loadSpecFromDisk = async () => {
      if (!selectedProject?.path) {
        setIsLoadingSpec(false)
        return
      }

      try {
        // Try to load spec.md from .autonomous directory
        const specPath = `${selectedProject.path}/.autonomous/spec.md`
        const result = await window.electron.files.readFile(specPath)

        if (result.success && result.content) {
          console.log('[SpecReview] Loaded spec from disk:', specPath)
          setSpecFromDisk(result.content)

          // Also update the store so other components can use it
          if (!generatedSpec || generatedSpec.markdown !== result.content) {
            const appSpecTxt = convertToAppSpec(result.content, selectedProject.name || 'Unknown')
            setGeneratedSpec({
              markdown: result.content,
              appSpecTxt,
              sections: parseMarkdownSections(result.content).map(s => ({
                id: s.id,
                title: s.title,
                content: '',
                editable: true
              })),
              featureCount: parseMarkdownSections(result.content).length,
              readyForExecution: true
            })
          }
        } else {
          console.log('[SpecReview] No spec.md found on disk, using store or placeholder')
        }
      } catch (err) {
        console.error('[SpecReview] Error loading spec from disk:', err)
      } finally {
        setIsLoadingSpec(false)
      }
    }

    loadSpecFromDisk()
  }, [selectedProject?.path])

  // Placeholder spec for development
  const placeholderSpec = `# Feature Specification

## Project: ${selectedProject?.name || 'Unknown'}
## Type: ${selectedProject?.isNew ? 'Greenfield' : 'Enhancement'}

---

## Overview

This specification outlines the requirements for building a comprehensive feature implementation. The system will provide robust functionality with proper error handling, testing, and documentation.

**Key Goals:**
- Deliver a maintainable, well-tested solution
- Follow established coding patterns and conventions
- Ensure accessibility and performance standards

## Features

1. **Core Feature Implementation**
   - Primary functionality as described in discovery
   - Integration with existing systems
   - Proper state management

2. **User Interface Components**
   - Responsive design with Tailwind CSS
   - Accessible components with ARIA attributes
   - Keyboard navigation support

3. **Data Layer**
   - API integration
   - Error handling and retry logic
   - Caching where appropriate

4. **Testing Suite**
   - Unit tests for all components
   - Integration tests for critical paths
   - End-to-end test coverage

## Technical Requirements

### Frontend
- React 18 with TypeScript
- Tailwind CSS for styling
- Zustand for state management

### API Integration
- RESTful endpoints
- Proper error handling
- Request/response typing

### Code Quality
- ESLint compliance
- TypeScript strict mode
- Comprehensive test coverage

## File Structure

\`\`\`
src/
├── components/
│   └── feature/
│       ├── FeatureComponent.tsx
│       ├── FeatureComponent.test.tsx
│       └── types.ts
├── hooks/
│   └── useFeature.ts
├── services/
│   └── featureService.ts
└── utils/
    └── featureHelpers.ts
\`\`\`

## Test Cases

### Unit Tests
- Component renders correctly with default props
- Component handles loading state
- Component handles error state
- User interactions trigger expected callbacks

### Integration Tests
- API integration works end-to-end
- State updates propagate correctly
- Navigation flows work as expected

### Accessibility Tests
- All interactive elements are keyboard accessible
- Screen reader announcements are correct
- Color contrast meets WCAG standards

---

*Review this specification carefully before approving. Once approved, the autonomous coding process will begin.*
`

  // Priority: disk spec > store spec > placeholder
  const displaySpec = specFromDisk || generatedSpec?.markdown || placeholderSpec

  // Parse sections for TOC
  const sections = useMemo(() => parseMarkdownSections(displaySpec), [displaySpec])

  // Validate spec
  const validation = useMemo(() => validateSpec(displaySpec), [displaySpec])

  // BMAD-Inspired: Check spec readiness for implementation
  const checkReadiness = useCallback(async () => {
    if (!selectedProject?.path) return

    setIsCheckingReadiness(true)
    try {
      const result = await window.electron.discovery.validateSpec(
        selectedProject.path,
        displaySpec
      )
      if (result.success && result.readinessCheck) {
        setReadinessCheck(result.readinessCheck)
      }
    } catch (err) {
      console.error('Failed to check readiness:', err)
    } finally {
      setIsCheckingReadiness(false)
    }
  }, [selectedProject?.path, displaySpec])

  // Run readiness check when spec loads or changes
  useEffect(() => {
    if (displaySpec && selectedProject?.path && !isEditing) {
      checkReadiness()
    }
  }, [displaySpec, selectedProject?.path, isEditing, checkReadiness])

  // Update edited markdown when generatedSpec changes
  useEffect(() => {
    if (generatedSpec?.markdown) {
      setEditedMarkdown(generatedSpec.markdown)
    }
  }, [generatedSpec?.markdown])

  const handleSaveEdit = () => {
    const appSpecTxt = convertToAppSpec(
      editedMarkdown,
      selectedProject?.name || 'Unknown'
    )

    const newSpec: GeneratedSpec = {
      markdown: editedMarkdown,
      appSpecTxt,
      sections: sections.map((s) => ({
        id: s.id,
        title: s.title,
        content: '',
        editable: true
      })),
      featureCount: sections.length,
      readyForExecution: true
    }

    setGeneratedSpec(newSpec)
    setIsEditing(false)
  }

  const handleScrollToSection = (sectionId: string) => {
    const element = document.getElementById(sectionId)
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  const handleApproveAndStart = () => {
    setShowConfirmDialog(true)
  }

  const handleConfirmApproval = async () => {
    setIsApproving(true)

    try {
      // Create the app_spec.txt format
      const appSpecTxt = convertToAppSpec(
        displaySpec,
        selectedProject?.name || 'Unknown'
      )

      // Update the store with final spec
      const finalSpec: GeneratedSpec = {
        markdown: displaySpec,
        appSpecTxt,
        sections: sections.map((s) => ({
          id: s.id,
          title: s.title,
          content: '',
          editable: false
        })),
        featureCount: sections.length,
        readyForExecution: true
      }

      setGeneratedSpec(finalSpec)

      // Save spec files to disk for Python orchestrator
      if (selectedProject?.path) {
        const autonomousDir = `${selectedProject.path}/.autonomous`

        // Save app_spec.md (markdown version)
        const specMdResult = await window.electron.files.writeFile(
          `${autonomousDir}/app_spec.md`,
          displaySpec
        )
        if (!specMdResult.success) {
          console.error('Failed to save app_spec.md:', specMdResult.error)
        }

        // Save app_spec.txt (plain text version for Python)
        const specTxtResult = await window.electron.files.writeFile(
          `${autonomousDir}/app_spec.txt`,
          appSpecTxt
        )
        if (!specTxtResult.success) {
          console.error('Failed to save app_spec.txt:', specTxtResult.error)
        }

        console.log('[SpecReview] Spec files saved to disk')
      }

      // Close dialog and proceed to execution phase
      // The ExecutionDashboard will auto-start the Python orchestrator
      setShowConfirmDialog(false)
      goToNextPhase()
    } catch (error) {
      console.error('Failed to approve spec:', error)
    } finally {
      setIsApproving(false)
    }
  }

  const handleCancelApproval = () => {
    setShowConfirmDialog(false)
  }

  // Show loading state while spec is being loaded from disk
  if (isLoadingSpec) {
    return (
      <div className="h-full flex flex-col items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
        <p className="text-muted-foreground">Loading specification...</p>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="h-12 px-4 flex items-center justify-between border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium text-sm">Generated Specification</span>
          {specFromDisk && (
            <span className="text-xs bg-emerald-500/20 text-emerald-500 px-2 py-0.5 rounded">
              Loaded from disk
            </span>
          )}
          {!specFromDisk && !generatedSpec && (
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
                onClick={() => {
                  setEditedMarkdown(displaySpec)
                  setIsEditing(false)
                }}
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
                className={cn(
                  'bg-emerald-600 hover:bg-emerald-700',
                  readinessCheck && !readinessCheck.passed && 'bg-yellow-600 hover:bg-yellow-700'
                )}
                disabled={
                  // Button is enabled if:
                  // 1. Local validation passes AND no blockers, OR
                  // 2. Readiness check passed (score >= 70 with no blockers)
                  !(
                    (validation.isValid && (readinessCheck?.blockers.length ?? 0) === 0) ||
                    (readinessCheck?.passed && (readinessCheck?.blockers.length ?? 0) === 0)
                  )
                }
                title={
                  readinessCheck?.blockers.length
                    ? `Blocked: ${readinessCheck.blockers[0]}`
                    : !validation.isValid && !readinessCheck?.passed
                      ? 'Validation incomplete - waiting for readiness check'
                      : 'Approve and start execution'
                }
              >
                {readinessCheck && !readinessCheck.passed ? (
                  <ShieldAlert className="h-4 w-4 mr-1" />
                ) : (
                  <Play className="h-4 w-4 mr-1" />
                )}
                {readinessCheck?.blockers.length ? 'Fix Blockers' : 'Approve & Start'}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex min-h-0">
        {/* TOC Sidebar */}
        {!isEditing && (
          <div className="w-56 border-r border-border p-4 shrink-0 overflow-y-auto">
            <h3 className="font-medium text-sm mb-3 flex items-center gap-2">
              <List className="h-4 w-4" />
              Contents
            </h3>
            <nav className="space-y-1" aria-label="Table of contents">
              {sections.map((section) => (
                <button
                  key={section.id}
                  onClick={() => handleScrollToSection(section.id)}
                  className={cn(
                    'w-full text-left px-2 py-1.5 rounded text-sm transition-colors',
                    'hover:bg-secondary',
                    section.level === 3 && 'pl-4 text-xs',
                    activeSection === section.id
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground'
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    <Hash className="h-3 w-3 shrink-0" />
                    <span className="truncate">{section.title}</span>
                  </span>
                </button>
              ))}
            </nav>
          </div>
        )}

        {/* Spec Editor/Viewer */}
        <div ref={contentRef} className="flex-1 overflow-y-auto p-6 min-w-0">
          {isEditing ? (
            <div className="h-full">
              <LineNumberEditor
                value={editedMarkdown}
                onChange={setEditedMarkdown}
              />
            </div>
          ) : (
            <MarkdownRenderer
              content={displaySpec}
              onSectionVisible={setActiveSection}
            />
          )}
        </div>

        {/* Validation Sidebar */}
        <div className="w-72 border-l border-border p-4 shrink-0 overflow-y-auto">
          <h3 className="font-medium text-sm mb-3">Validation Status</h3>

          <div className="space-y-3">
            {/* Required Sections */}
            <div className="p-3 bg-secondary/50 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                {validation.sections.every((s) => s.present) ? (
                  <CheckCircle className="h-4 w-4 text-emerald-500" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-yellow-500" />
                )}
                <span className="font-medium text-sm">Required Sections</span>
              </div>
              <div className="space-y-1.5">
                {validation.sections.map((section) => (
                  <div
                    key={section.name}
                    className="flex items-center gap-2 text-xs"
                  >
                    {section.present ? (
                      <CheckCircle className="h-3 w-3 text-emerald-500" />
                    ) : (
                      <XCircle className="h-3 w-3 text-red-500" />
                    )}
                    <span
                      className={
                        section.present ? 'text-foreground' : 'text-red-500'
                      }
                    >
                      {section.name}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Feature Count */}
            <div className="p-3 bg-secondary/50 rounded-lg">
              <div className="flex items-center gap-2 mb-1">
                {validation.featureCount >= 3 ? (
                  <CheckCircle className="h-4 w-4 text-emerald-500" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-yellow-500" />
                )}
                <span className="font-medium text-sm">Features</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {validation.featureCount} feature{validation.featureCount !== 1 ? 's' : ''} identified
              </p>
            </div>

            {/* Warnings */}
            {validation.warnings.length > 0 && (
              <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <AlertCircle className="h-4 w-4 text-yellow-500" />
                  <span className="font-medium text-sm text-yellow-500">Warnings</span>
                </div>
                <ul className="space-y-1">
                  {validation.warnings.map((warning, idx) => (
                    <li key={idx} className="text-xs text-yellow-600">
                      {warning}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* BMAD-Inspired: Implementation Readiness Gate */}
            <div className={cn(
              'p-3 rounded-lg border',
              isCheckingReadiness && 'bg-secondary/50 border-border',
              readinessCheck?.passed && 'bg-emerald-500/10 border-emerald-500/20',
              readinessCheck && !readinessCheck.passed && 'bg-red-500/10 border-red-500/20'
            )}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  {isCheckingReadiness ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : readinessCheck?.passed ? (
                    <ShieldCheck className="h-4 w-4 text-emerald-500" />
                  ) : (
                    <ShieldAlert className="h-4 w-4 text-red-500" />
                  )}
                  <span className="font-medium text-sm">Readiness Gate</span>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={checkReadiness}
                  disabled={isCheckingReadiness}
                  title="Re-check readiness"
                >
                  <RefreshCw className={cn(
                    'h-3 w-3',
                    isCheckingReadiness && 'animate-spin'
                  )} />
                </Button>
              </div>

              {isCheckingReadiness ? (
                <p className="text-xs text-muted-foreground">Checking implementation readiness...</p>
              ) : readinessCheck ? (
                <div className="space-y-2">
                  {/* Readiness Score */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Score</span>
                      <span className={cn(
                        'font-medium',
                        readinessCheck.score >= 70 && 'text-emerald-500',
                        readinessCheck.score >= 40 && readinessCheck.score < 70 && 'text-yellow-500',
                        readinessCheck.score < 40 && 'text-red-500'
                      )}>{readinessCheck.score}/100</span>
                    </div>
                    <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                      <div
                        className={cn(
                          'h-full rounded-full transition-all duration-300',
                          readinessCheck.score >= 70 && 'bg-emerald-500',
                          readinessCheck.score >= 40 && readinessCheck.score < 70 && 'bg-yellow-500',
                          readinessCheck.score < 40 && 'bg-red-500'
                        )}
                        style={{ width: `${readinessCheck.score}%` }}
                      />
                    </div>
                  </div>

                  {/* Blockers */}
                  {readinessCheck.blockers.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-red-500">Blockers:</p>
                      {readinessCheck.blockers.map((blocker, idx) => (
                        <p key={idx} className="text-xs text-red-400 flex items-start gap-1">
                          <XCircle className="h-3 w-3 mt-0.5 shrink-0" />
                          {blocker}
                        </p>
                      ))}
                    </div>
                  )}

                  {/* Warnings */}
                  {readinessCheck.warnings.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-yellow-500">Warnings:</p>
                      {readinessCheck.warnings.map((warning, idx) => (
                        <p key={idx} className="text-xs text-yellow-400 flex items-start gap-1">
                          <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                          {warning}
                        </p>
                      ))}
                    </div>
                  )}

                  {/* Passed Checks */}
                  {readinessCheck.passed && readinessCheck.checks.filter(c => c.status === 'passed').length > 0 && (
                    <div className="space-y-1 pt-1">
                      <p className="text-xs text-emerald-500 font-medium">✓ Ready for implementation</p>
                      <p className="text-xs text-muted-foreground">
                        {readinessCheck.checks.filter(c => c.status === 'passed').length} checks passed
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Click refresh to check readiness</p>
              )}
            </div>

            {/* Agent Status */}
            <div className="pt-3 border-t border-border">
              <h4 className="font-medium text-sm mb-2">Agent Status</h4>
              <AgentStatusDisplay agents={agentStatuses} />
            </div>

            {/* Info Box */}
            <div className="mt-4 p-3 bg-primary/10 border border-primary/20 rounded-lg">
              <p className="text-xs text-primary/80">
                <strong>Note:</strong> Once approved, the spec will be converted to
                app_spec.txt format and the autonomous coding process will begin.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Confirmation Dialog */}
      <ConfirmDialog
        open={showConfirmDialog}
        onConfirm={handleConfirmApproval}
        onCancel={handleCancelApproval}
        title="Approve Specification?"
        description="This will finalize the specification and start the autonomous coding process. The spec will be converted to app_spec.txt format and used to guide code generation."
        confirmText="Approve & Start"
        cancelText="Review Again"
        isLoading={isApproving}
      />
    </div>
  )
}

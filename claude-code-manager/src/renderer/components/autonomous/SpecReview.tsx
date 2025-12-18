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
  Loader2
} from 'lucide-react'
import { Button } from '../ui/button'
import { useAutonomousStore } from '@renderer/stores/autonomous-store'
import { cn } from '@renderer/lib/utils'
import type { AgentStatus, GeneratedSpec } from '@renderer/stores/autonomous-store'

// Required sections for a valid spec
const REQUIRED_SECTIONS = [
  'Overview',
  'Features',
  'Technical Requirements',
  'Test Cases'
]

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
  const sections = REQUIRED_SECTIONS.map((name) => {
    // Check if section header exists (case-insensitive)
    const regex = new RegExp(`^##\\s+${name}`, 'im')
    return {
      name,
      present: regex.test(markdown)
    }
  })

  // Count features mentioned (look for numbered lists or feature-related content)
  const featureSection = markdown.match(
    /##\s+Features[\s\S]*?(?=##|$)/i
  )
  let featureCount = 0
  if (featureSection) {
    // Count numbered items
    const numberedItems = featureSection[0].match(/^\d+\./gm)
    // Count bullet items
    const bulletItems = featureSection[0].match(/^[\s]*[-*]\s/gm)
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
    warnings.push('Spec should list at least 3 features')
  }

  // Check for test cases section content
  const testSection = markdown.match(/##\s+Test Cases[\s\S]*?(?=##|$)/i)
  if (testSection && testSection[0].length < 100) {
    warnings.push('Test Cases section seems incomplete')
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
        return 'bg-blue-500/20 text-blue-500'
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
  const contentRef = useRef<HTMLDivElement>(null)

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

  const displaySpec = generatedSpec?.markdown || placeholderSpec

  // Parse sections for TOC
  const sections = useMemo(() => parseMarkdownSections(displaySpec), [displaySpec])

  // Validate spec
  const validation = useMemo(() => validateSpec(displaySpec), [displaySpec])

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

      // Close dialog and proceed
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
                className="bg-emerald-600 hover:bg-emerald-700"
                disabled={!validation.isValid}
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

            {/* Agent Status */}
            <div className="pt-3 border-t border-border">
              <h4 className="font-medium text-sm mb-2">Agent Status</h4>
              <AgentStatusDisplay agents={agentStatuses} />
            </div>

            {/* Info Box */}
            <div className="mt-4 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
              <p className="text-xs text-blue-400">
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

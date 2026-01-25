/**
 * BVS Plan Review UI
 *
 * F0.6 - Plan Review UI
 * Allows users to:
 * - View the generated execution plan
 * - Edit sections (add/remove/reorder)
 * - Adjust file assignments
 * - Set dependencies
 * - Approve or reject the plan
 */

import React, { useState, useCallback } from 'react'
import {
  type BvsExecutionPlan,
  type BvsSection,
  type BvsFileInfo,
} from '@shared/bvs-types'

// ============================================================================
// Types
// ============================================================================

interface BvsPlanReviewProps {
  plan: BvsExecutionPlan
  onApprove: (plan: BvsExecutionPlan) => void
  onReject: () => void
  onEdit: (plan: BvsExecutionPlan) => void
  className?: string
}

interface SectionEditorProps {
  section: BvsSection
  allFiles: BvsFileInfo[]
  allSectionIds: string[]
  onUpdate: (section: BvsSection) => void
  onDelete: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  isFirst: boolean
  isLast: boolean
}

interface FileAssignmentProps {
  files: BvsFileInfo[]
  assignedFiles: BvsFileInfo[]
  onAssign: (files: BvsFileInfo[]) => void
}

// ============================================================================
// Plan Review Component
// ============================================================================

export function BvsPlanReview({
  plan,
  onApprove,
  onReject,
  onEdit,
  className = '',
}: BvsPlanReviewProps) {
  const [editedPlan, setEditedPlan] = useState<BvsExecutionPlan>({ ...plan })
  const [isEditing, setIsEditing] = useState(false)
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set())

  // Calculate all files across sections
  const allFiles = editedPlan.sections.flatMap(s => s.files)

  // Toggle section expansion
  const toggleSection = useCallback((sectionId: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev)
      if (next.has(sectionId)) {
        next.delete(sectionId)
      } else {
        next.add(sectionId)
      }
      return next
    })
  }, [])

  // Update a section
  const updateSection = useCallback((index: number, section: BvsSection) => {
    setEditedPlan(prev => {
      const sections = [...prev.sections]
      sections[index] = section
      return { ...prev, sections }
    })
  }, [])

  // Delete a section
  const deleteSection = useCallback((index: number) => {
    setEditedPlan(prev => ({
      ...prev,
      sections: prev.sections.filter((_, i) => i !== index),
    }))
  }, [])

  // Move section up/down
  const moveSection = useCallback((index: number, direction: 'up' | 'down') => {
    setEditedPlan(prev => {
      const sections = [...prev.sections]
      const newIndex = direction === 'up' ? index - 1 : index + 1
      if (newIndex < 0 || newIndex >= sections.length) return prev
      ;[sections[index], sections[newIndex]] = [sections[newIndex], sections[index]]
      return { ...prev, sections }
    })
  }, [])

  // Add new section
  const addSection = useCallback(() => {
    const newSection: BvsSection = {
      id: `S${Date.now()}`,
      name: 'New Section',
      description: 'Describe this section',
      files: [],
      dependencies: [],
      status: 'pending',
      estimatedComplexity: 'medium',
    }
    setEditedPlan(prev => ({
      ...prev,
      sections: [...prev.sections, newSection],
    }))
    setExpandedSections(prev => new Set([...prev, newSection.id]))
  }, [])

  // Handle approve
  const handleApprove = useCallback(() => {
    onApprove(editedPlan)
  }, [editedPlan, onApprove])

  // Handle edit mode toggle
  const handleEditToggle = useCallback(() => {
    if (isEditing) {
      onEdit(editedPlan)
    }
    setIsEditing(!isEditing)
  }, [isEditing, editedPlan, onEdit])

  // Calculate stats
  const totalFiles = editedPlan.sections.reduce((sum, s) => sum + s.files.length, 0)
  const parallelGroups = calculateParallelGroups(editedPlan.sections)

  return (
    <div className={`bg-white dark:bg-gray-800 rounded-lg shadow-lg ${className}`}>
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
              Execution Plan Review
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Review and approve the plan before execution
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleEditToggle}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                isEditing
                  ? 'bg-green-100 text-green-700 hover:bg-green-200'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {isEditing ? '✓ Done Editing' : '✎ Edit Plan'}
            </button>
          </div>
        </div>
      </div>

      {/* Stats Bar */}
      <div className="px-6 py-3 bg-gray-50 dark:bg-gray-750 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-6 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-gray-500">Sections:</span>
            <span className="font-medium text-gray-900 dark:text-white">
              {editedPlan.sections.length}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-gray-500">Files:</span>
            <span className="font-medium text-gray-900 dark:text-white">
              {totalFiles}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-gray-500">Parallel Groups:</span>
            <span className="font-medium text-gray-900 dark:text-white">
              {parallelGroups}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-gray-500">Est. Duration:</span>
            <span className="font-medium text-gray-900 dark:text-white">
              {formatDuration(editedPlan.estimatedDuration)}
            </span>
          </div>
        </div>
      </div>

      {/* Sections List */}
      <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
        {editedPlan.sections.map((section, index) => (
          <SectionCard
            key={section.id}
            section={section}
            isExpanded={expandedSections.has(section.id)}
            isEditing={isEditing}
            allFiles={allFiles}
            allSectionIds={editedPlan.sections.map(s => s.id)}
            onToggle={() => toggleSection(section.id)}
            onUpdate={(s) => updateSection(index, s)}
            onDelete={() => deleteSection(index)}
            onMoveUp={() => moveSection(index, 'up')}
            onMoveDown={() => moveSection(index, 'down')}
            isFirst={index === 0}
            isLast={index === editedPlan.sections.length - 1}
          />
        ))}

        {/* Add Section Button */}
        {isEditing && (
          <button
            onClick={addSection}
            className="w-full py-3 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg text-gray-500 hover:border-blue-400 hover:text-blue-500 transition-colors"
          >
            + Add Section
          </button>
        )}
      </div>

      {/* Action Buttons */}
      <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-750">
        <div className="flex items-center justify-between">
          <button
            onClick={onReject}
            className="px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg font-medium transition-colors"
          >
            ✕ Reject Plan
          </button>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500">
              {editedPlan.sections.length} sections ready for execution
            </span>
            <button
              onClick={handleApprove}
              className="px-6 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition-colors"
            >
              ✓ Approve & Start
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Section Card Component
// ============================================================================

interface SectionCardProps {
  section: BvsSection
  isExpanded: boolean
  isEditing: boolean
  allFiles: BvsFileInfo[]
  allSectionIds: string[]
  onToggle: () => void
  onUpdate: (section: BvsSection) => void
  onDelete: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  isFirst: boolean
  isLast: boolean
}

function SectionCard({
  section,
  isExpanded,
  isEditing,
  allFiles,
  allSectionIds,
  onToggle,
  onUpdate,
  onDelete,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
}: SectionCardProps) {
  const [editingField, setEditingField] = useState<string | null>(null)

  const complexityColors = {
    low: 'bg-green-100 text-green-700',
    medium: 'bg-yellow-100 text-yellow-700',
    high: 'bg-red-100 text-red-700',
  }

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
      {/* Section Header */}
      <div
        className="flex items-center gap-3 px-4 py-3 bg-gray-50 dark:bg-gray-750 cursor-pointer"
        onClick={onToggle}
      >
        <span className="text-gray-400">{isExpanded ? '▼' : '▶'}</span>

        <div className="flex-1 min-w-0">
          {isEditing && editingField === 'name' ? (
            <input
              type="text"
              value={section.name}
              onChange={(e) => onUpdate({ ...section, name: e.target.value })}
              onBlur={() => setEditingField(null)}
              onClick={(e) => e.stopPropagation()}
              className="w-full px-2 py-1 border rounded"
              autoFocus
            />
          ) : (
            <h3
              className="font-medium text-gray-900 dark:text-white truncate"
              onClick={(e) => {
                if (isEditing) {
                  e.stopPropagation()
                  setEditingField('name')
                }
              }}
            >
              {section.name}
            </h3>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className={`px-2 py-0.5 rounded text-xs font-medium ${complexityColors[section.estimatedComplexity || 'medium']}`}>
            {section.estimatedComplexity || 'medium'}
          </span>
          <span className="text-sm text-gray-500">
            {section.files.length} files
          </span>
          {section.dependencies.length > 0 && (
            <span className="text-xs text-gray-400">
              → {section.dependencies.join(', ')}
            </span>
          )}
        </div>

        {isEditing && (
          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={onMoveUp}
              disabled={isFirst}
              className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30"
            >
              ↑
            </button>
            <button
              onClick={onMoveDown}
              disabled={isLast}
              className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30"
            >
              ↓
            </button>
            <button
              onClick={onDelete}
              className="p-1 text-red-400 hover:text-red-600"
            >
              ✕
            </button>
          </div>
        )}
      </div>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="px-4 py-3 space-y-3">
          {/* Description */}
          <div>
            <label className="text-xs text-gray-500 uppercase tracking-wide">Description</label>
            {isEditing ? (
              <textarea
                value={section.description}
                onChange={(e) => onUpdate({ ...section, description: e.target.value })}
                className="w-full mt-1 px-3 py-2 border rounded-lg text-sm resize-none"
                rows={2}
              />
            ) : (
              <p className="text-sm text-gray-700 dark:text-gray-300 mt-1">
                {section.description}
              </p>
            )}
          </div>

          {/* Files */}
          <div>
            <label className="text-xs text-gray-500 uppercase tracking-wide">Files</label>
            <div className="mt-1 space-y-1">
              {section.files.map((file, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400"
                >
                  <span className="text-gray-400">📄</span>
                  <span className="font-mono text-xs">{file.path}</span>
                  {isEditing && (
                    <button
                      onClick={() => onUpdate({
                        ...section,
                        files: section.files.filter((_, j) => j !== i),
                      })}
                      className="text-red-400 hover:text-red-600"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
              {isEditing && section.files.length === 0 && (
                <p className="text-sm text-gray-400 italic">No files assigned</p>
              )}
            </div>
          </div>

          {/* Dependencies */}
          <div>
            <label className="text-xs text-gray-500 uppercase tracking-wide">Dependencies</label>
            <div className="mt-1 flex flex-wrap gap-2">
              {section.dependencies.map((dep, i) => (
                <span
                  key={i}
                  className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs"
                >
                  {dep}
                  {isEditing && (
                    <button
                      onClick={() => onUpdate({
                        ...section,
                        dependencies: section.dependencies.filter((_, j) => j !== i),
                      })}
                      className="ml-1 text-blue-500 hover:text-blue-700"
                    >
                      ✕
                    </button>
                  )}
                </span>
              ))}
              {isEditing && (
                <select
                  onChange={(e) => {
                    if (e.target.value && !section.dependencies.includes(e.target.value)) {
                      onUpdate({
                        ...section,
                        dependencies: [...section.dependencies, e.target.value],
                      })
                    }
                    e.target.value = ''
                  }}
                  className="px-2 py-1 border rounded text-xs"
                >
                  <option value="">+ Add dependency</option>
                  {allSectionIds
                    .filter(id => id !== section.id && !section.dependencies.includes(id))
                    .map(id => (
                      <option key={id} value={id}>{id}</option>
                    ))}
                </select>
              )}
            </div>
          </div>

          {/* Complexity (edit mode) */}
          {isEditing && (
            <div>
              <label className="text-xs text-gray-500 uppercase tracking-wide">Complexity</label>
              <div className="mt-1 flex gap-2">
                {(['low', 'medium', 'high'] as const).map(level => (
                  <button
                    key={level}
                    onClick={() => onUpdate({ ...section, estimatedComplexity: level })}
                    className={`px-3 py-1 rounded text-sm ${
                      section.estimatedComplexity === level
                        ? complexityColors[level]
                        : 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    {level}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Helpers
// ============================================================================

function calculateParallelGroups(sections: BvsSection[]): number {
  // Simple calculation - count sections with no dependencies as first group
  // then group the rest by dependency level
  const levels = new Map<string, number>()

  for (const section of sections) {
    if (section.dependencies.length === 0) {
      levels.set(section.id, 0)
    }
  }

  let changed = true
  while (changed) {
    changed = false
    for (const section of sections) {
      if (levels.has(section.id)) continue

      const depLevels = section.dependencies
        .map(d => levels.get(d))
        .filter((l): l is number => l !== undefined)

      if (depLevels.length === section.dependencies.length) {
        levels.set(section.id, Math.max(...depLevels) + 1)
        changed = true
      }
    }
  }

  return new Set(levels.values()).size || 1
}

function formatDuration(ms?: number): string {
  if (!ms) return 'Unknown'

  const minutes = Math.floor(ms / 60000)
  if (minutes < 60) return `~${minutes}m`

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return `~${hours}h ${remainingMinutes}m`
}

export default BvsPlanReview

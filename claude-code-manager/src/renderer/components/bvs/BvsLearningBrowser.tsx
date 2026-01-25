/**
 * BVS Learning Browser
 *
 * F6.12 - Learning Browser (view accumulated learnings)
 * Displays and manages captured learnings:
 * - Search and filter learnings
 * - View learning details
 * - Edit/delete learnings
 * - Export learnings
 */

import React, { useState, useMemo } from 'react'
import { type BvsLearning } from '@shared/bvs-types'

// ============================================================================
// Types
// ============================================================================

interface BvsLearningBrowserProps {
  learnings: BvsLearning[]
  onUpdateLearning: (id: string, updates: Partial<BvsLearning>) => void
  onDeleteLearning: (id: string) => void
  onExportLearnings: () => void
  className?: string
}

// ============================================================================
// Main Component
// ============================================================================

export function BvsLearningBrowser({
  learnings,
  onUpdateLearning,
  onDeleteLearning,
  onExportLearnings,
  className = '',
}: BvsLearningBrowserProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState<'recent' | 'applied' | 'alphabetical'>('recent')
  const [selectedLearning, setSelectedLearning] = useState<BvsLearning | null>(null)
  const [editingLearning, setEditingLearning] = useState<BvsLearning | null>(null)

  // Filter and sort learnings
  const filteredLearnings = useMemo(() => {
    let filtered = [...learnings]

    // Filter by search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter(
        (l) =>
          l.problem.toLowerCase().includes(query) ||
          l.solution.toLowerCase().includes(query) ||
          l.preventionRule?.toLowerCase().includes(query) ||
          l.files?.some(f => f.toLowerCase().includes(query))
      )
    }

    // Sort
    switch (sortBy) {
      case 'recent':
        filtered.sort((a, b) => b.createdAt - a.createdAt)
        break
      case 'applied':
        filtered.sort((a, b) => b.appliedCount - a.appliedCount)
        break
      case 'alphabetical':
        filtered.sort((a, b) => a.problem.localeCompare(b.problem))
        break
    }

    return filtered
  }, [learnings, searchQuery, sortBy])

  // Stats
  const stats = useMemo(() => ({
    total: learnings.length,
    totalApplied: learnings.reduce((sum, l) => sum + l.appliedCount, 0),
    recentlyUsed: learnings.filter(
      l => l.lastAppliedAt && l.lastAppliedAt > Date.now() - 7 * 24 * 60 * 60 * 1000
    ).length,
  }), [learnings])

  return (
    <div className={`bg-white dark:bg-gray-800 rounded-lg shadow-lg ${className}`}>
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              📚 Learning Browser
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {stats.total} learnings • {stats.totalApplied} total applications
            </p>
          </div>
          <button
            onClick={onExportLearnings}
            className="px-3 py-1.5 text-sm bg-blue-100 text-blue-700 hover:bg-blue-200 rounded-lg"
          >
            📤 Export
          </button>
        </div>

        {/* Search and Filter */}
        <div className="mt-4 flex items-center gap-4">
          <div className="flex-1 relative">
            <input
              type="text"
              placeholder="Search learnings..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-4 py-2 pl-10 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
            <span className="absolute left-3 top-2.5 text-gray-400">🔍</span>
          </div>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          >
            <option value="recent">Most Recent</option>
            <option value="applied">Most Applied</option>
            <option value="alphabetical">Alphabetical</option>
          </select>
        </div>
      </div>

      {/* Stats Bar */}
      <div className="px-6 py-3 bg-gray-50 dark:bg-gray-750 border-b border-gray-200 dark:border-gray-700 flex items-center gap-6">
        <div className="text-sm">
          <span className="text-gray-500">Total:</span>
          <span className="ml-1 font-medium text-gray-900 dark:text-white">{stats.total}</span>
        </div>
        <div className="text-sm">
          <span className="text-gray-500">Applications:</span>
          <span className="ml-1 font-medium text-gray-900 dark:text-white">{stats.totalApplied}</span>
        </div>
        <div className="text-sm">
          <span className="text-gray-500">Used this week:</span>
          <span className="ml-1 font-medium text-gray-900 dark:text-white">{stats.recentlyUsed}</span>
        </div>
      </div>

      {/* Learnings List */}
      <div className="p-4 max-h-[60vh] overflow-y-auto">
        {filteredLearnings.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <div className="text-4xl mb-2">📭</div>
            <div>No learnings found</div>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredLearnings.map((learning) => (
              <LearningCard
                key={learning.id}
                learning={learning}
                isSelected={selectedLearning?.id === learning.id}
                onSelect={() => setSelectedLearning(
                  selectedLearning?.id === learning.id ? null : learning
                )}
                onEdit={() => setEditingLearning(learning)}
                onDelete={() => onDeleteLearning(learning.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Edit Modal */}
      {editingLearning && (
        <LearningEditModal
          learning={editingLearning}
          onSave={(updates) => {
            onUpdateLearning(editingLearning.id, updates)
            setEditingLearning(null)
          }}
          onClose={() => setEditingLearning(null)}
        />
      )}
    </div>
  )
}

// ============================================================================
// Learning Card
// ============================================================================

function LearningCard({
  learning,
  isSelected,
  onSelect,
  onEdit,
  onDelete,
}: {
  learning: BvsLearning
  isSelected: boolean
  onSelect: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div
      className={`border rounded-lg overflow-hidden transition-all ${
        isSelected
          ? 'border-blue-500 shadow-md'
          : 'border-gray-200 dark:border-gray-700'
      }`}
    >
      {/* Header */}
      <div
        className="px-4 py-3 bg-gray-50 dark:bg-gray-750 cursor-pointer"
        onClick={onSelect}
      >
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-gray-400">{isSelected ? '▼' : '▶'}</span>
              <h4 className="font-medium text-gray-900 dark:text-white truncate">
                {learning.problem}
              </h4>
            </div>
            <div className="mt-1 flex items-center gap-3 text-xs text-gray-500">
              <span>📅 {new Date(learning.createdAt).toLocaleDateString()}</span>
              <span>🔄 {learning.appliedCount} uses</span>
              {learning.files && learning.files.length > 0 && (
                <span>📁 {learning.files.length} files</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Expanded Content */}
      {isSelected && (
        <div className="px-4 py-3 space-y-3 bg-white dark:bg-gray-800">
          {/* Solution */}
          <div>
            <label className="text-xs text-gray-500 uppercase tracking-wide">Solution</label>
            <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">
              {learning.solution}
            </p>
          </div>

          {/* Prevention Rule */}
          {learning.preventionRule && (
            <div>
              <label className="text-xs text-gray-500 uppercase tracking-wide">Prevention Rule</label>
              <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">
                {learning.preventionRule}
              </p>
            </div>
          )}

          {/* Files */}
          {learning.files && learning.files.length > 0 && (
            <div>
              <label className="text-xs text-gray-500 uppercase tracking-wide">Related Files</label>
              <div className="mt-1 flex flex-wrap gap-1">
                {learning.files.map((file, i) => (
                  <span
                    key={i}
                    className="px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 text-xs rounded font-mono"
                  >
                    {file}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Code Pattern */}
          {learning.codePattern && (
            <div>
              <label className="text-xs text-gray-500 uppercase tracking-wide">Code Pattern</label>
              <pre className="mt-1 p-2 bg-gray-100 dark:bg-gray-900 rounded text-xs font-mono overflow-x-auto">
                {learning.codePattern}
              </pre>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-200 dark:border-gray-700">
            <button
              onClick={(e) => {
                e.stopPropagation()
                onEdit()
              }}
              className="px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 rounded"
            >
              ✏️ Edit
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                if (confirm('Delete this learning?')) {
                  onDelete()
                }
              }}
              className="px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded"
            >
              🗑️ Delete
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Learning Edit Modal
// ============================================================================

function LearningEditModal({
  learning,
  onSave,
  onClose,
}: {
  learning: BvsLearning
  onSave: (updates: Partial<BvsLearning>) => void
  onClose: () => void
}) {
  const [problem, setProblem] = useState(learning.problem)
  const [solution, setSolution] = useState(learning.solution)
  const [preventionRule, setPreventionRule] = useState(learning.preventionRule || '')
  const [codePattern, setCodePattern] = useState(learning.codePattern || '')

  const handleSave = () => {
    onSave({
      problem,
      solution,
      preventionRule: preventionRule || undefined,
      codePattern: codePattern || undefined,
    })
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            Edit Learning
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">
            ×
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 overflow-y-auto max-h-[60vh]">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Problem
            </label>
            <input
              type="text"
              value={problem}
              onChange={(e) => setProblem(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Solution
            </label>
            <textarea
              value={solution}
              onChange={(e) => setSolution(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Prevention Rule
            </label>
            <input
              type="text"
              value={preventionRule}
              onChange={(e) => setPreventionRule(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Code Pattern
            </label>
            <textarea
              value={codePattern}
              onChange={(e) => setCodePattern(e.target.value)}
              rows={4}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 font-mono text-sm"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 bg-blue-600 text-white hover:bg-blue-700 rounded-lg"
          >
            Save Changes
          </button>
        </div>
      </div>
    </div>
  )
}

export default BvsLearningBrowser

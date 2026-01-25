/**
 * BVS Shared UI Components
 *
 * Common UI components used across multiple BVS viewers to reduce duplication:
 * - TabButton - Tab navigation with optional counts and status
 * - ErrorListViewer - Generic error list display
 * - EmptyState - Placeholder for empty content
 * - SuccessState - Success message display
 * - FileErrorGroup - Collapsible file-grouped errors
 */

import React, { useState } from 'react'

// ============================================================================
// TabButton - Shared tab navigation component
// ============================================================================

export interface TabButtonProps {
  active: boolean
  onClick: () => void
  label: string
  count?: number
  passed?: boolean
  hasErrors?: boolean
}

export function TabButton({
  active,
  onClick,
  label,
  count,
  passed,
  hasErrors,
}: TabButtonProps) {
  // Determine badge color based on props
  const getBadgeClass = () => {
    if (hasErrors) return 'bg-red-100 text-red-700'
    if (passed === false) return 'bg-red-100 text-red-700'
    if (passed === true) return 'bg-green-100 text-green-700'
    return 'bg-gray-100 text-gray-600'
  }

  return (
    <button
      onClick={onClick}
      className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
        active
          ? 'border-blue-500 text-blue-600'
          : 'border-transparent text-gray-500 hover:text-gray-700'
      }`}
    >
      {label}
      {count !== undefined && (
        <span className={`ml-2 px-2 py-0.5 rounded-full text-xs ${getBadgeClass()}`}>
          {count}
        </span>
      )}
    </button>
  )
}

// ============================================================================
// ErrorListViewer - Generic error list component (used by ConsoleTab, NetworkTab)
// ============================================================================

export interface ErrorListViewerProps {
  errors: string[]
  emptyIcon: string
  emptyMessage: string
  errorIcon: string
  colorScheme: 'red' | 'yellow' | 'orange'
}

const colorSchemes = {
  red: {
    bg: 'bg-red-50 dark:bg-red-900/20',
    border: 'border-red-200 dark:border-red-800',
    text: 'text-red-700 dark:text-red-400',
    icon: 'text-red-500',
  },
  yellow: {
    bg: 'bg-yellow-50 dark:bg-yellow-900/20',
    border: 'border-yellow-200 dark:border-yellow-800',
    text: 'text-yellow-700 dark:text-yellow-400',
    icon: 'text-yellow-500',
  },
  orange: {
    bg: 'bg-orange-50 dark:bg-orange-900/20',
    border: 'border-orange-200 dark:border-orange-800',
    text: 'text-orange-700 dark:text-orange-400',
    icon: 'text-orange-500',
  },
}

export function ErrorListViewer({
  errors,
  emptyIcon,
  emptyMessage,
  errorIcon,
  colorScheme,
}: ErrorListViewerProps) {
  const colors = colorSchemes[colorScheme]

  if (errors.length === 0) {
    return (
      <div className="text-center py-8 text-green-600">
        <div className="text-4xl mb-2">{emptyIcon}</div>
        <div className="font-medium">{emptyMessage}</div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {errors.map((error, index) => (
        <div
          key={index}
          className={`p-3 rounded-lg border ${colors.bg} ${colors.border}`}
        >
          <div className="flex items-start gap-2">
            <span className={colors.icon}>{errorIcon}</span>
            <pre className={`text-sm font-mono whitespace-pre-wrap flex-1 ${colors.text}`}>
              {error}
            </pre>
          </div>
        </div>
      ))}
    </div>
  )
}

// ============================================================================
// EmptyState - Placeholder for empty content
// ============================================================================

export interface EmptyStateProps {
  icon?: string
  message: string
}

export function EmptyState({ icon = '📋', message }: EmptyStateProps) {
  return (
    <div className="text-center py-8 text-gray-500">
      <div className="text-4xl mb-2">{icon}</div>
      <div>{message}</div>
    </div>
  )
}

// ============================================================================
// SuccessState - Success message display
// ============================================================================

export interface SuccessStateProps {
  icon?: string
  message: string
}

export function SuccessState({ icon = '✅', message }: SuccessStateProps) {
  return (
    <div className="text-center py-8 text-green-600">
      <div className="text-4xl mb-2">{icon}</div>
      <div className="font-medium">{message}</div>
    </div>
  )
}

// ============================================================================
// FileErrorGroup - Collapsible file-grouped errors
// ============================================================================

export interface FileErrorGroupProps<T> {
  file: string
  errors: T[]
  expanded: boolean
  onToggle: () => void
  renderError: (error: T, index: number) => React.ReactNode
  badgeColor?: 'red' | 'yellow' | 'orange'
}

export function FileErrorGroup<T>({
  file,
  errors,
  expanded,
  onToggle,
  renderError,
  badgeColor = 'red',
}: FileErrorGroupProps<T>) {
  const badgeClasses = {
    red: 'bg-red-100 text-red-700',
    yellow: 'bg-yellow-100 text-yellow-700',
    orange: 'bg-orange-100 text-orange-700',
  }

  const borderClasses = {
    red: 'border-red-300',
    yellow: 'border-yellow-300',
    orange: 'border-orange-300',
  }

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full px-4 py-2 flex items-center justify-between bg-gray-50 dark:bg-gray-750 hover:bg-gray-100 dark:hover:bg-gray-700"
      >
        <div className="flex items-center gap-2">
          <span className="text-gray-400">{expanded ? '▼' : '▶'}</span>
          <span className="font-mono text-sm text-gray-700 dark:text-gray-300">
            {file}
          </span>
        </div>
        <span className={`px-2 py-0.5 text-xs rounded-full ${badgeClasses[badgeColor]}`}>
          {errors.length}
        </span>
      </button>
      {expanded && (
        <div className="p-4 space-y-2 bg-white dark:bg-gray-800">
          {errors.map((error, index) => (
            <div key={index} className={`pl-4 border-l-2 ${borderClasses[badgeColor]}`}>
              {renderError(error, index)}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// CopyButton - Button with copy-to-clipboard functionality
// ============================================================================

export interface CopyButtonProps {
  text: string
  className?: string
}

export function CopyButton({ text, className = '' }: CopyButtonProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      onClick={handleCopy}
      className={`px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded ${className}`}
    >
      {copied ? '✓ Copied' : 'Copy'}
    </button>
  )
}

// ============================================================================
// RawOutputViewer - Display raw output with copy functionality
// ============================================================================

export interface RawOutputViewerProps {
  output: string
  emptyMessage?: string
}

export function RawOutputViewer({
  output,
  emptyMessage = 'No output available',
}: RawOutputViewerProps) {
  if (!output || output.trim() === '') {
    return <EmptyState message={emptyMessage} />
  }

  return (
    <div className="relative">
      <CopyButton text={output} className="absolute top-2 right-2" />
      <pre className="bg-gray-900 text-green-400 font-mono text-xs p-4 rounded-lg overflow-x-auto whitespace-pre-wrap">
        {output}
      </pre>
    </div>
  )
}

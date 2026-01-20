/**
 * RequirementsSummary Component
 *
 * Displays a structured summary of gathered requirements from the Initiator phase.
 * Allows users to review and edit requirements before generating the Ralph Loop prompt.
 */

import React, { useState } from 'react'
import {
  Target,
  CheckCircle,
  AlertTriangle,
  Ban,
  Gauge,
  Building2,
  Layers,
  Edit3,
  X,
  Save
} from 'lucide-react'
import { Button } from '../ui/button'
import { cn } from '@renderer/lib/utils'
import type { RequirementsDoc } from '../../../shared/types'

interface RequirementsSummaryProps {
  requirements: RequirementsDoc
  onEdit?: (field: keyof RequirementsDoc, value: string | string[]) => void
  editable?: boolean
}

export function RequirementsSummary({
  requirements,
  onEdit,
  editable = false
}: RequirementsSummaryProps) {
  const [editingField, setEditingField] = useState<keyof RequirementsDoc | null>(null)
  const [editValue, setEditValue] = useState<string>('')

  const startEdit = (field: keyof RequirementsDoc, value: string | string[]) => {
    setEditingField(field)
    setEditValue(Array.isArray(value) ? value.join('\n') : value)
  }

  const saveEdit = () => {
    if (!editingField || !onEdit) return

    const isArrayField = ['scope', 'successCriteria', 'constraints', 'outOfScope'].includes(editingField)
    const value = isArrayField
      ? editValue.split('\n').map(s => s.trim()).filter(Boolean)
      : editValue

    onEdit(editingField, value)
    setEditingField(null)
    setEditValue('')
  }

  const cancelEdit = () => {
    setEditingField(null)
    setEditValue('')
  }

  const getComplexityColor = (complexity: RequirementsDoc['complexity']) => {
    switch (complexity) {
      case 'quick':
        return 'bg-emerald-500/20 text-emerald-500 border-emerald-500/30'
      case 'standard':
        return 'bg-primary/20 text-primary border-primary/30'
      case 'enterprise':
        return 'bg-orange-500/20 text-orange-500 border-orange-500/30'
    }
  }

  const getProjectTypeIcon = (type: RequirementsDoc['projectType']) => {
    switch (type) {
      case 'greenfield':
        return <Building2 className="h-4 w-4" />
      case 'brownfield':
        return <Layers className="h-4 w-4" />
      case 'undetermined':
        return <AlertTriangle className="h-4 w-4" />
    }
  }

  const renderEditableField = (
    field: keyof RequirementsDoc,
    label: string,
    value: string | string[],
    icon: React.ReactNode,
    colorClass: string
  ) => {
    const isEditing = editingField === field
    const displayValue = Array.isArray(value) ? value : [value]
    const isArrayField = Array.isArray(value)

    return (
      <div className={cn('p-4 rounded-lg border', colorClass)}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            {icon}
            <h4 className="font-medium text-sm">{label}</h4>
          </div>
          {editable && !isEditing && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => startEdit(field, value)}
            >
              <Edit3 className="h-3 w-3" />
            </Button>
          )}
        </div>

        {isEditing ? (
          <div className="space-y-2">
            <textarea
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              className={cn(
                'w-full p-2 rounded border bg-background text-sm',
                'focus:outline-none focus:ring-2 focus:ring-primary',
                isArrayField ? 'min-h-[100px]' : 'min-h-[60px]'
              )}
              placeholder={isArrayField ? 'One item per line...' : 'Enter value...'}
            />
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" size="sm" onClick={cancelEdit}>
                <X className="h-3 w-3 mr-1" />
                Cancel
              </Button>
              <Button size="sm" onClick={saveEdit}>
                <Save className="h-3 w-3 mr-1" />
                Save
              </Button>
            </div>
          </div>
        ) : (
          <ul className="space-y-1">
            {displayValue.map((item, i) => (
              <li key={i} className="text-sm flex items-start gap-2">
                {isArrayField && <span className="text-muted-foreground">•</span>}
                {item}
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header with metadata */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Requirements Summary</h3>
        <div className="flex items-center gap-2">
          {/* Project Type Badge */}
          <span className={cn(
            'px-2 py-1 rounded text-xs border flex items-center gap-1',
            requirements.projectType === 'greenfield' ? 'bg-emerald-500/20 text-emerald-500 border-emerald-500/30' :
            requirements.projectType === 'brownfield' ? 'bg-blue-500/20 text-blue-500 border-blue-500/30' :
            'bg-secondary text-muted-foreground border-border'
          )}>
            {getProjectTypeIcon(requirements.projectType)}
            {requirements.projectType}
          </span>

          {/* Complexity Badge */}
          <span className={cn(
            'px-2 py-1 rounded text-xs border flex items-center gap-1',
            getComplexityColor(requirements.complexity)
          )}>
            <Gauge className="h-3 w-3" />
            {requirements.complexity}
          </span>

          {/* Estimated Features */}
          <span className="px-2 py-1 rounded text-xs bg-secondary border border-border">
            ~{requirements.estimatedFeatures} features
          </span>
        </div>
      </div>

      {/* Objective - primary highlight */}
      <div className="p-4 rounded-lg bg-primary/10 border border-primary/20">
        <div className="flex items-center gap-2 mb-2">
          <Target className="h-4 w-4 text-primary" />
          <h4 className="font-medium text-sm text-primary">Objective</h4>
          {editable && editingField !== 'objective' && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 ml-auto"
              onClick={() => startEdit('objective', requirements.objective)}
            >
              <Edit3 className="h-3 w-3" />
            </Button>
          )}
        </div>
        {editingField === 'objective' ? (
          <div className="space-y-2">
            <textarea
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              className={cn(
                'w-full p-2 rounded border bg-background text-sm',
                'focus:outline-none focus:ring-2 focus:ring-primary min-h-[60px]'
              )}
            />
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" size="sm" onClick={cancelEdit}>
                <X className="h-3 w-3 mr-1" />
                Cancel
              </Button>
              <Button size="sm" onClick={saveEdit}>
                <Save className="h-3 w-3 mr-1" />
                Save
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm">{requirements.objective}</p>
        )}
      </div>

      {/* Grid of requirements sections */}
      <div className="grid grid-cols-2 gap-4">
        {/* Scope */}
        {renderEditableField(
          'scope',
          'Scope',
          requirements.scope,
          <Layers className="h-4 w-4 text-blue-500" />,
          'bg-blue-500/5 border-blue-500/20'
        )}

        {/* Success Criteria */}
        {renderEditableField(
          'successCriteria',
          'Success Criteria',
          requirements.successCriteria,
          <CheckCircle className="h-4 w-4 text-emerald-500" />,
          'bg-emerald-500/5 border-emerald-500/20'
        )}

        {/* Constraints */}
        {renderEditableField(
          'constraints',
          'Constraints',
          requirements.constraints,
          <AlertTriangle className="h-4 w-4 text-orange-500" />,
          'bg-orange-500/5 border-orange-500/20'
        )}

        {/* Out of Scope */}
        {renderEditableField(
          'outOfScope',
          'Out of Scope',
          requirements.outOfScope,
          <Ban className="h-4 w-4 text-red-500" />,
          'bg-red-500/5 border-red-500/20'
        )}
      </div>

      {/* Timestamp */}
      <p className="text-xs text-muted-foreground text-right">
        Gathered at {new Date(requirements.gatheredAt).toLocaleString()}
      </p>
    </div>
  )
}

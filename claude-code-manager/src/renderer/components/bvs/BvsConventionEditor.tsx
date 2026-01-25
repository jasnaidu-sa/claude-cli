/**
 * BVS Convention Editor
 *
 * F6.13 - Convention Editor (edit project conventions)
 * Allows users to view and edit project conventions that guide BVS:
 * - Naming conventions
 * - Code style rules
 * - Architecture patterns
 * - Testing requirements
 * - Import/export conventions
 */

import React, { useState, useEffect } from 'react'

// ============================================================================
// Types
// ============================================================================

export interface ProjectConventions {
  naming: {
    components: string
    services: string
    types: string
    tests: string
    files: string
    variables: string
    constants: string
  }
  codeStyle: {
    maxLineLength: number
    indentation: 'tabs' | 'spaces'
    indentSize: number
    semicolons: boolean
    quotes: 'single' | 'double'
    trailingCommas: 'none' | 'es5' | 'all'
  }
  architecture: {
    patterns: string[]
    layering: string[]
    stateManagement: string
    dataFetching: string
  }
  testing: {
    framework: string
    coverage: number
    patterns: string[]
    naming: string
  }
  imports: {
    order: string[]
    aliasPatterns: string[]
    noDefaultExports: boolean
  }
  custom: Array<{
    name: string
    description: string
    rule: string
  }>
}

interface BvsConventionEditorProps {
  conventions: ProjectConventions
  onSave: (conventions: ProjectConventions) => void
  onReset: () => void
  className?: string
}

// ============================================================================
// Default Conventions
// ============================================================================

export const DEFAULT_CONVENTIONS: ProjectConventions = {
  naming: {
    components: 'PascalCase (e.g., UserProfile, ButtonGroup)',
    services: 'camelCase with Service suffix (e.g., userService, authService)',
    types: 'PascalCase with Type/Interface prefix (e.g., UserType, IUserProps)',
    tests: 'Same as source file with .test or .spec suffix',
    files: 'kebab-case for utilities, PascalCase for components',
    variables: 'camelCase (e.g., userName, isLoading)',
    constants: 'SCREAMING_SNAKE_CASE (e.g., MAX_RETRIES, API_URL)',
  },
  codeStyle: {
    maxLineLength: 100,
    indentation: 'spaces',
    indentSize: 2,
    semicolons: false,
    quotes: 'single',
    trailingCommas: 'es5',
  },
  architecture: {
    patterns: ['Repository Pattern', 'Service Layer', 'Component Composition'],
    layering: ['UI Components', 'Hooks', 'Services', 'Types'],
    stateManagement: 'Zustand with slices',
    dataFetching: 'TanStack Query with custom hooks',
  },
  testing: {
    framework: 'Vitest',
    coverage: 80,
    patterns: ['Unit tests for services', 'Integration tests for API', 'Component tests with Testing Library'],
    naming: 'describe(ComponentName) > it(should behavior)',
  },
  imports: {
    order: ['react', 'external libraries', 'internal modules', 'relative imports', 'styles'],
    aliasPatterns: ['@/', '@components/', '@services/', '@hooks/', '@types/'],
    noDefaultExports: true,
  },
  custom: [],
}

// ============================================================================
// Main Component
// ============================================================================

export function BvsConventionEditor({
  conventions,
  onSave,
  onReset,
  className = '',
}: BvsConventionEditorProps) {
  const [edited, setEdited] = useState<ProjectConventions>(conventions)
  const [activeSection, setActiveSection] = useState<string>('naming')
  const [hasChanges, setHasChanges] = useState(false)

  useEffect(() => {
    setEdited(conventions)
    setHasChanges(false)
  }, [conventions])

  const handleChange = <K extends keyof ProjectConventions>(
    section: K,
    field: keyof ProjectConventions[K],
    value: unknown
  ) => {
    setEdited((prev) => ({
      ...prev,
      [section]: {
        ...prev[section],
        [field]: value,
      },
    }))
    setHasChanges(true)
  }

  const handleSave = () => {
    onSave(edited)
    setHasChanges(false)
  }

  const handleReset = () => {
    if (confirm('Reset all conventions to defaults?')) {
      onReset()
    }
  }

  const sections = [
    { id: 'naming', label: '📝 Naming', icon: '📝' },
    { id: 'codeStyle', label: '🎨 Code Style', icon: '🎨' },
    { id: 'architecture', label: '🏗️ Architecture', icon: '🏗️' },
    { id: 'testing', label: '🧪 Testing', icon: '🧪' },
    { id: 'imports', label: '📦 Imports', icon: '📦' },
    { id: 'custom', label: '⚙️ Custom', icon: '⚙️' },
  ]

  return (
    <div className={`bg-white dark:bg-gray-800 rounded-lg shadow-lg ${className}`}>
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              📋 Project Conventions
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Define coding standards for consistent BVS output
            </p>
          </div>
          <div className="flex items-center gap-2">
            {hasChanges && (
              <span className="text-sm text-yellow-600">● Unsaved changes</span>
            )}
            <button
              onClick={handleReset}
              className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
            >
              Reset Defaults
            </button>
            <button
              onClick={handleSave}
              disabled={!hasChanges}
              className="px-4 py-1.5 text-sm bg-blue-600 text-white hover:bg-blue-700 rounded-lg disabled:opacity-50"
            >
              Save Changes
            </button>
          </div>
        </div>
      </div>

      <div className="flex">
        {/* Sidebar */}
        <div className="w-48 border-r border-gray-200 dark:border-gray-700 p-2">
          {sections.map((section) => (
            <button
              key={section.id}
              onClick={() => setActiveSection(section.id)}
              className={`w-full px-3 py-2 text-left text-sm rounded-lg transition-colors ${
                activeSection === section.id
                  ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
                  : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700'
              }`}
            >
              {section.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 p-6 max-h-[60vh] overflow-y-auto">
          {activeSection === 'naming' && (
            <NamingSection
              values={edited.naming}
              onChange={(field, value) => handleChange('naming', field, value)}
            />
          )}
          {activeSection === 'codeStyle' && (
            <CodeStyleSection
              values={edited.codeStyle}
              onChange={(field, value) => handleChange('codeStyle', field, value)}
            />
          )}
          {activeSection === 'architecture' && (
            <ArchitectureSection
              values={edited.architecture}
              onChange={(field, value) => handleChange('architecture', field, value)}
            />
          )}
          {activeSection === 'testing' && (
            <TestingSection
              values={edited.testing}
              onChange={(field, value) => handleChange('testing', field, value)}
            />
          )}
          {activeSection === 'imports' && (
            <ImportsSection
              values={edited.imports}
              onChange={(field, value) => handleChange('imports', field, value)}
            />
          )}
          {activeSection === 'custom' && (
            <CustomSection
              rules={edited.custom}
              onChange={(rules) => setEdited(prev => ({ ...prev, custom: rules }))}
            />
          )}
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Shared Form Components (DRY - reduces code duplication)
// ============================================================================

/** Input class for consistent styling */
const inputClassName = "w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-sm"

/** Generic text field component */
function FormTextField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
        {label}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={inputClassName}
      />
    </div>
  )
}

/** Generic number field component with NaN validation */
function FormNumberField({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (value: number) => void
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
        {label}
      </label>
      <input
        type="number"
        value={value}
        onChange={(e) => {
          const parsed = parseInt(e.target.value, 10)
          if (!isNaN(parsed)) {
            onChange(parsed)
          }
        }}
        className={inputClassName}
      />
    </div>
  )
}

/** Generic select field component */
function FormSelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={inputClassName}
      >
        {options.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  )
}

/** Generic checkbox field component */
function FormCheckboxField({
  id,
  label,
  checked,
  onChange,
}: {
  id: string
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="checkbox"
        id={id}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="rounded"
      />
      <label htmlFor={id} className="text-sm text-gray-700 dark:text-gray-300">
        {label}
      </label>
    </div>
  )
}

/** Generic comma-separated array field component */
function FormArrayField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string[]
  onChange: (value: string[]) => void
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
        {label}
      </label>
      <input
        type="text"
        value={value.join(', ')}
        onChange={(e) => onChange(e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
        className={inputClassName}
      />
    </div>
  )
}

/** Generic section wrapper */
function FormSection({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-4">
      <h3 className="font-medium text-gray-900 dark:text-white">{title}</h3>
      {children}
    </div>
  )
}

// ============================================================================
// Section Components (using shared form components)
// ============================================================================

function NamingSection({
  values,
  onChange,
}: {
  values: ProjectConventions['naming']
  onChange: (field: keyof ProjectConventions['naming'], value: string) => void
}) {
  const fields: { key: keyof typeof values; label: string }[] = [
    { key: 'components', label: 'Components' },
    { key: 'services', label: 'Services' },
    { key: 'types', label: 'Types/Interfaces' },
    { key: 'tests', label: 'Test Files' },
    { key: 'files', label: 'File Names' },
    { key: 'variables', label: 'Variables' },
    { key: 'constants', label: 'Constants' },
  ]

  return (
    <FormSection title="Naming Conventions">
      {fields.map(({ key, label }) => (
        <FormTextField
          key={key}
          label={label}
          value={values[key]}
          onChange={(value) => onChange(key, value)}
        />
      ))}
    </FormSection>
  )
}

function CodeStyleSection({
  values,
  onChange,
}: {
  values: ProjectConventions['codeStyle']
  onChange: (field: keyof ProjectConventions['codeStyle'], value: unknown) => void
}) {
  return (
    <FormSection title="Code Style">
      <div className="grid grid-cols-2 gap-4">
        <FormNumberField
          label="Max Line Length"
          value={values.maxLineLength}
          onChange={(value) => onChange('maxLineLength', value)}
        />
        <FormNumberField
          label="Indent Size"
          value={values.indentSize}
          onChange={(value) => onChange('indentSize', value)}
        />
        <FormSelectField
          label="Indentation"
          value={values.indentation}
          options={[
            { value: 'spaces', label: 'Spaces' },
            { value: 'tabs', label: 'Tabs' },
          ]}
          onChange={(value) => onChange('indentation', value)}
        />
        <FormSelectField
          label="Quotes"
          value={values.quotes}
          options={[
            { value: 'single', label: 'Single' },
            { value: 'double', label: 'Double' },
          ]}
          onChange={(value) => onChange('quotes', value)}
        />
        <FormSelectField
          label="Trailing Commas"
          value={values.trailingCommas}
          options={[
            { value: 'none', label: 'None' },
            { value: 'es5', label: 'ES5' },
            { value: 'all', label: 'All' },
          ]}
          onChange={(value) => onChange('trailingCommas', value)}
        />
        <FormCheckboxField
          id="semicolons"
          label="Use Semicolons"
          checked={values.semicolons}
          onChange={(checked) => onChange('semicolons', checked)}
        />
      </div>
    </FormSection>
  )
}

function ArchitectureSection({
  values,
  onChange,
}: {
  values: ProjectConventions['architecture']
  onChange: (field: keyof ProjectConventions['architecture'], value: unknown) => void
}) {
  return (
    <FormSection title="Architecture">
      <FormArrayField
        label="Design Patterns (comma-separated)"
        value={values.patterns}
        onChange={(value) => onChange('patterns', value)}
      />
      <FormArrayField
        label="Layering (comma-separated)"
        value={values.layering}
        onChange={(value) => onChange('layering', value)}
      />
      <FormTextField
        label="State Management"
        value={values.stateManagement}
        onChange={(value) => onChange('stateManagement', value)}
      />
      <FormTextField
        label="Data Fetching"
        value={values.dataFetching}
        onChange={(value) => onChange('dataFetching', value)}
      />
    </FormSection>
  )
}

function TestingSection({
  values,
  onChange,
}: {
  values: ProjectConventions['testing']
  onChange: (field: keyof ProjectConventions['testing'], value: unknown) => void
}) {
  return (
    <FormSection title="Testing">
      <div className="grid grid-cols-2 gap-4">
        <FormTextField
          label="Framework"
          value={values.framework}
          onChange={(value) => onChange('framework', value)}
        />
        <FormNumberField
          label="Coverage Threshold (%)"
          value={values.coverage}
          onChange={(value) => onChange('coverage', value)}
        />
      </div>
      <FormTextField
        label="Test Naming Convention"
        value={values.naming}
        onChange={(value) => onChange('naming', value)}
      />
      <FormArrayField
        label="Test Patterns (comma-separated)"
        value={values.patterns}
        onChange={(value) => onChange('patterns', value)}
      />
    </FormSection>
  )
}

function ImportsSection({
  values,
  onChange,
}: {
  values: ProjectConventions['imports']
  onChange: (field: keyof ProjectConventions['imports'], value: unknown) => void
}) {
  return (
    <FormSection title="Import Conventions">
      <FormArrayField
        label="Import Order (comma-separated)"
        value={values.order}
        onChange={(value) => onChange('order', value)}
      />
      <FormArrayField
        label="Path Aliases (comma-separated)"
        value={values.aliasPatterns}
        onChange={(value) => onChange('aliasPatterns', value)}
      />
      <FormCheckboxField
        id="noDefaultExports"
        label="Prefer named exports over default exports"
        checked={values.noDefaultExports}
        onChange={(checked) => onChange('noDefaultExports', checked)}
      />
    </FormSection>
  )
}

function CustomSection({
  rules,
  onChange,
}: {
  rules: ProjectConventions['custom']
  onChange: (rules: ProjectConventions['custom']) => void
}) {
  const addRule = () => {
    onChange([...rules, { name: '', description: '', rule: '' }])
  }

  const updateRule = (index: number, field: keyof typeof rules[0], value: string) => {
    const updated = [...rules]
    updated[index] = { ...updated[index], [field]: value }
    onChange(updated)
  }

  const deleteRule = (index: number) => {
    onChange(rules.filter((_, i) => i !== index))
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-gray-900 dark:text-white">Custom Rules</h3>
        <button
          onClick={addRule}
          className="px-3 py-1.5 text-sm bg-blue-100 text-blue-700 hover:bg-blue-200 rounded-lg"
        >
          + Add Rule
        </button>
      </div>

      {rules.length === 0 ? (
        <p className="text-sm text-gray-500 text-center py-4">
          No custom rules defined. Click "Add Rule" to create one.
        </p>
      ) : (
        <div className="space-y-4">
          {rules.map((rule, index) => (
            <div
              key={index}
              className="p-4 border border-gray-200 dark:border-gray-700 rounded-lg"
            >
              <div className="flex items-start justify-between mb-3">
                <input
                  type="text"
                  placeholder="Rule name"
                  value={rule.name}
                  onChange={(e) => updateRule(index, 'name', e.target.value)}
                  className="font-medium px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700"
                />
                <button
                  onClick={() => deleteRule(index)}
                  className="text-red-500 hover:text-red-700"
                >
                  🗑️
                </button>
              </div>
              <input
                type="text"
                placeholder="Description"
                value={rule.description}
                onChange={(e) => updateRule(index, 'description', e.target.value)}
                className="w-full mb-2 px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700"
              />
              <textarea
                placeholder="Rule definition"
                value={rule.rule}
                onChange={(e) => updateRule(index, 'rule', e.target.value)}
                rows={2}
                className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default BvsConventionEditor

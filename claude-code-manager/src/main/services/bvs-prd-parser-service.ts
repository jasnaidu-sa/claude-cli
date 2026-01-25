/**
 * BVS PRD Parser Service
 *
 * Parses PRD (Product Requirements Document) content to extract:
 * - Features and their descriptions
 * - Phases and milestones
 * - Dependencies between features
 * - Success criteria
 *
 * Based on PRD Phase 0 (F0.1, F0.2):
 * - F0.1 - PRD Upload Interface
 * - F0.2 - PRD Parser
 *
 * Supported formats:
 * - Markdown (.md)
 * - Plain text (.txt)
 * - PDF (.pdf) - basic extraction
 */

import { EventEmitter } from 'events'
import * as fs from 'fs/promises'
import * as path from 'path'
import {
  type BvsSection,
  type BvsFile,
  type BvsSuccessCriteria,
  type BvsPrdSource,
} from '@shared/bvs-types'

// ============================================================================
// Types
// ============================================================================

/**
 * Extracted feature from PRD
 */
export interface ExtractedFeature {
  id: string
  name: string
  description: string
  priority: 'P0' | 'P1' | 'P2'
  phase?: string
  dependencies?: string[]
  acceptanceCriteria?: string[]
  estimatedFiles?: number
}

/**
 * Parsed PRD result
 */
export interface ParsedPrd {
  title: string
  description: string
  features: ExtractedFeature[]
  phases: Array<{
    name: string
    features: string[]
  }>
  totalEstimatedFiles: number
  rawContent: string
}

/**
 * Section generation result
 */
export interface GeneratedSections {
  sections: BvsSection[]
  warnings: string[]
}

// ============================================================================
// Parser Implementation
// ============================================================================

export class BvsPrdParserService extends EventEmitter {
  constructor() {
    super()
  }

  /**
   * Parse PRD content from string
   */
  async parseContent(content: string, fileName?: string): Promise<ParsedPrd> {
    // Detect format based on content or filename
    const format = this.detectFormat(content, fileName)

    switch (format) {
      case 'markdown':
        return this.parseMarkdown(content)
      case 'plain':
        return this.parsePlainText(content)
      default:
        return this.parsePlainText(content)
    }
  }

  /**
   * Parse PRD from file
   */
  async parseFile(filePath: string): Promise<ParsedPrd> {
    const content = await fs.readFile(filePath, 'utf-8')
    return this.parseContent(content, path.basename(filePath))
  }

  /**
   * Detect content format
   */
  private detectFormat(content: string, fileName?: string): 'markdown' | 'plain' | 'pdf' {
    if (fileName) {
      const ext = path.extname(fileName).toLowerCase()
      if (ext === '.md') return 'markdown'
      if (ext === '.pdf') return 'pdf'
    }

    // Check for markdown indicators
    if (content.includes('# ') || content.includes('## ') || content.includes('```')) {
      return 'markdown'
    }

    return 'plain'
  }

  /**
   * Parse markdown format PRD
   */
  private parseMarkdown(content: string): ParsedPrd {
    const lines = content.split('\n')
    const features: ExtractedFeature[] = []
    const phases: Array<{ name: string; features: string[] }> = []

    let title = ''
    let description = ''
    let currentPhase: { name: string; features: string[] } | null = null
    let currentFeature: Partial<ExtractedFeature> | null = null
    let inFeatureTable = false
    let inDescription = false

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()

      // Extract title (first H1)
      if (!title && line.startsWith('# ')) {
        title = line.replace(/^#\s*/, '').trim()
        continue
      }

      // Extract description (content after title, before first H2)
      if (title && !description && !line.startsWith('#') && line.length > 0) {
        if (!line.startsWith('**') && !line.startsWith('|') && !line.startsWith('-')) {
          description += line + ' '
        }
      }

      // Detect phase headers
      if (line.startsWith('### Phase') || line.match(/^###\s+Phase\s+\d+/i)) {
        if (currentPhase) {
          phases.push(currentPhase)
        }
        currentPhase = { name: line.replace(/^###\s*/, ''), features: [] }
        continue
      }

      // Detect feature tables
      if (line.includes('| Feature') || line.includes('|------')) {
        inFeatureTable = true
        continue
      }

      // Parse feature table rows
      if (inFeatureTable && line.startsWith('|')) {
        const feature = this.parseFeatureTableRow(line)
        if (feature) {
          features.push(feature)
          if (currentPhase) {
            currentPhase.features.push(feature.id)
          }
        }
        continue
      }

      // End feature table
      if (inFeatureTable && !line.startsWith('|') && line.length > 0) {
        inFeatureTable = false
      }

      // Parse inline features (F1.1 - Description format)
      const inlineFeatureMatch = line.match(/^-?\s*\*?\*?([F\d.]+)\s*[-–]\s*(.+?)\*?\*?\s*$/i)
      if (inlineFeatureMatch) {
        const [, id, name] = inlineFeatureMatch
        features.push({
          id: id.toUpperCase(),
          name: name.replace(/\*\*/g, '').trim(),
          description: '',
          priority: this.inferPriority(line),
        })
        if (currentPhase) {
          currentPhase.features.push(id.toUpperCase())
        }
      }
    }

    // Add last phase
    if (currentPhase) {
      phases.push(currentPhase)
    }

    return {
      title: title || 'Untitled PRD',
      description: description.trim(),
      features,
      phases,
      totalEstimatedFiles: this.estimateTotalFiles(features),
      rawContent: content,
    }
  }

  /**
   * Parse a feature table row
   */
  private parseFeatureTableRow(line: string): ExtractedFeature | null {
    // Skip header row separators
    if (line.includes('---')) return null
    if (line.toLowerCase().includes('feature') && line.toLowerCase().includes('priority')) return null

    const cells = line.split('|').map((c) => c.trim()).filter(Boolean)
    if (cells.length < 2) return null

    // Try to extract feature ID and name
    const firstCell = cells[0]
    const idMatch = firstCell.match(/^([F\d.]+)\s*[-–]\s*(.+)$/i)

    if (idMatch) {
      const [, id, name] = idMatch
      return {
        id: id.toUpperCase(),
        name: name.trim(),
        description: cells[3] || '',
        priority: this.extractPriority(cells[1]) || 'P1',
      }
    }

    return null
  }

  /**
   * Extract priority from string
   */
  private extractPriority(str: string): 'P0' | 'P1' | 'P2' | null {
    if (str.includes('P0')) return 'P0'
    if (str.includes('P1')) return 'P1'
    if (str.includes('P2')) return 'P2'
    return null
  }

  /**
   * Infer priority from line content
   */
  private inferPriority(line: string): 'P0' | 'P1' | 'P2' {
    const lower = line.toLowerCase()
    if (lower.includes('critical') || lower.includes('p0')) return 'P0'
    if (lower.includes('major') || lower.includes('p1') || lower.includes('important')) return 'P1'
    return 'P2'
  }

  /**
   * Parse plain text format PRD
   */
  private parsePlainText(content: string): ParsedPrd {
    const lines = content.split('\n')
    const features: ExtractedFeature[] = []

    let title = ''
    let description = ''
    let featureCount = 0

    for (const line of lines) {
      const trimmed = line.trim()

      // First non-empty line is title
      if (!title && trimmed.length > 0) {
        title = trimmed
        continue
      }

      // Look for feature-like patterns
      // - Feature name
      // * Feature name
      // 1. Feature name
      const featureMatch = trimmed.match(/^[-*\d.)\]]\s*(.+)$/)
      if (featureMatch) {
        featureCount++
        features.push({
          id: `F${Math.floor(featureCount / 10)}.${featureCount % 10}`,
          name: featureMatch[1].trim(),
          description: '',
          priority: 'P1',
        })
      }
    }

    return {
      title: title || 'Untitled PRD',
      description: description.trim(),
      features,
      phases: [],
      totalEstimatedFiles: this.estimateTotalFiles(features),
      rawContent: content,
    }
  }

  /**
   * Estimate total files from features
   */
  private estimateTotalFiles(features: ExtractedFeature[]): number {
    // Rough estimate: 2-3 files per feature on average
    return Math.ceil(features.length * 2.5)
  }

  /**
   * Generate bounded sections from parsed PRD
   *
   * This creates BVS sections from extracted features,
   * grouping related features together (3-5 files per section)
   */
  generateSections(parsedPrd: ParsedPrd): GeneratedSections {
    const sections: BvsSection[] = []
    const warnings: string[] = []

    // Group features by phase
    const featuresByPhase = new Map<string, ExtractedFeature[]>()

    for (const phase of parsedPrd.phases) {
      const phaseFeatures = parsedPrd.features.filter((f) =>
        phase.features.includes(f.id)
      )
      featuresByPhase.set(phase.name, phaseFeatures)
    }

    // Features without a phase
    const orphanFeatures = parsedPrd.features.filter(
      (f) => !parsedPrd.phases.some((p) => p.features.includes(f.id))
    )
    if (orphanFeatures.length > 0) {
      featuresByPhase.set('General', orphanFeatures)
    }

    let sectionIndex = 1

    for (const [phaseName, features] of featuresByPhase) {
      // Group features into sections (max 3 features per section)
      const chunks = this.chunkArray(features, 3)

      for (const chunk of chunks) {
        const sectionName = chunk.length === 1
          ? chunk[0].name
          : `${phaseName} - Part ${sectionIndex}`

        const section: BvsSection = {
          id: `S${sectionIndex}`,
          name: sectionName,
          description: chunk.map((f) => f.description || f.name).join('; '),
          files: this.estimateFilesForFeatures(chunk),
          dependencies: this.extractDependencies(chunk, sections),
          dependents: [],
          status: 'pending',
          successCriteria: this.extractSuccessCriteria(chunk),
          progress: 0,
          retryCount: 0,
          maxRetries: 3,
          commits: [],
        }

        sections.push(section)
        sectionIndex++
      }
    }

    // Update dependents
    for (const section of sections) {
      for (const depId of section.dependencies) {
        const dep = sections.find((s) => s.id === depId)
        if (dep && !dep.dependents.includes(section.id)) {
          dep.dependents.push(section.id)
        }
      }
    }

    // Add warnings
    if (parsedPrd.features.length === 0) {
      warnings.push('No features could be extracted from the PRD')
    }
    if (orphanFeatures.length > 0) {
      warnings.push(`${orphanFeatures.length} features have no assigned phase`)
    }

    return { sections, warnings }
  }

  /**
   * Estimate files for a group of features
   */
  private estimateFilesForFeatures(features: ExtractedFeature[]): BvsFile[] {
    const files: BvsFile[] = []

    for (const feature of features) {
      // Generate placeholder file paths based on feature name
      const baseName = feature.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')

      // Typical files for a feature
      files.push({
        path: `src/services/${baseName}.ts`,
        action: 'create',
        status: 'pending',
      })

      // Add type file if P0/P1
      if (feature.priority === 'P0' || feature.priority === 'P1') {
        files.push({
          path: `src/types/${baseName}.ts`,
          action: 'create',
          status: 'pending',
        })
      }
    }

    return files
  }

  /**
   * Extract dependencies from features
   */
  private extractDependencies(
    features: ExtractedFeature[],
    existingSections: BvsSection[]
  ): string[] {
    const deps: string[] = []

    for (const feature of features) {
      if (feature.dependencies) {
        for (const depId of feature.dependencies) {
          // Find section containing this dependency
          const depSection = existingSections.find((s) =>
            s.name.toLowerCase().includes(depId.toLowerCase())
          )
          if (depSection && !deps.includes(depSection.id)) {
            deps.push(depSection.id)
          }
        }
      }
    }

    return deps
  }

  /**
   * Extract success criteria from features
   */
  private extractSuccessCriteria(features: ExtractedFeature[]): BvsSuccessCriteria[] {
    const criteria: BvsSuccessCriteria[] = []
    let criteriaIndex = 1

    for (const feature of features) {
      if (feature.acceptanceCriteria) {
        for (const ac of feature.acceptanceCriteria) {
          criteria.push({
            id: `SC${criteriaIndex++}`,
            description: ac,
            passed: false,
          })
        }
      } else {
        // Generate default criteria
        criteria.push({
          id: `SC${criteriaIndex++}`,
          description: `${feature.name} implemented and working`,
          passed: false,
        })
      }
    }

    return criteria
  }

  /**
   * Chunk array into groups of N
   */
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = []
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size))
    }
    return chunks
  }

  /**
   * Create PRD source from content
   */
  createPrdSource(content: string, fileName?: string): BvsPrdSource {
    return {
      type: fileName ? 'file' : 'paste',
      content,
      fileName,
      parsedAt: Date.now(),
    }
  }
}

// Singleton instance
let bvsPrdParserService: BvsPrdParserService | null = null

export function getBvsPrdParserService(): BvsPrdParserService {
  if (!bvsPrdParserService) {
    bvsPrdParserService = new BvsPrdParserService()
  }
  return bvsPrdParserService
}

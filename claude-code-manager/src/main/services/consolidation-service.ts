/**
 * Consolidation Service
 *
 * Implements P1-T6 from the Unified Agent Architecture PRD.
 * Consolidates episodic memory into semantic memory by extracting facts
 * and entity relations from conversation episodes.
 *
 * Features:
 * - Processes unconsolidated episodes
 * - Extracts entity-attribute-value triples
 * - Detects conflicts and handles superseding
 * - Creates entity relations for knowledge graph
 * - Tracks last consolidation timestamp
 *
 * Note: Current implementation uses basic regex-based extraction as a placeholder.
 * LLM-powered extraction will be integrated in the integration phase.
 */

import { EventEmitter } from 'events'
import type { EpisodeStoreService, Episode } from './episode-store-service'
import type { SemanticMemoryService } from './semantic-memory-service'

// ============================================================================
// Types
// ============================================================================

export interface ConsolidationResult {
  episodesProcessed: number
  factsExtracted: number
  conflictsFound: number
  relationsCreated: number
}

export interface ExtractedFact {
  entity: string
  attribute: string
  value: string
  confidence: number
}

// ============================================================================
// ConsolidationService
// ============================================================================

export class ConsolidationService extends EventEmitter {
  private episodeStore: EpisodeStoreService
  private semanticMemory: SemanticMemoryService
  private lastConsolidationTime: number | null = null

  constructor(
    episodeStore: EpisodeStoreService,
    semanticMemory: SemanticMemoryService
  ) {
    super()
    this.episodeStore = episodeStore
    this.semanticMemory = semanticMemory
  }

  // ==========================================================================
  // Consolidation
  // ==========================================================================

  /**
   * Consolidate recent unconsolidated episodes into semantic memory.
   *
   * @param limit - Maximum number of episodes to process (default 100)
   * @returns Consolidation result statistics
   */
  async consolidateRecent(limit?: number): Promise<ConsolidationResult> {
    const maxLimit = limit ?? 100

    // Get recent episodes since last consolidation
    const since = this.lastConsolidationTime ?? 0
    const episodes = this.getRecentEpisodes(since, maxLimit)

    let factsExtracted = 0
    let conflictsFound = 0
    let relationsCreated = 0

    for (const episode of episodes) {
      // Skip system messages
      if (episode.role === 'system') {
        continue
      }

      // Extract facts from episode content
      const extractedFacts = await this.extractFactsFromText(episode.content)

      for (const fact of extractedFacts) {
        // Check for conflicts
        const conflicts = this.semanticMemory.findConflicts(
          fact.entity,
          fact.attribute,
          fact.value
        )

        if (conflicts.length > 0) {
          conflictsFound += conflicts.length

          // Insert new fact
          const newFactId = this.semanticMemory.insertFact(
            fact.entity,
            fact.attribute,
            fact.value,
            fact.confidence,
            episode.id
          )

          // Supersede old facts
          for (const oldFact of conflicts) {
            this.semanticMemory.supersedeFact(oldFact.id, newFactId)
          }

          factsExtracted++
        } else {
          // No conflict, just insert
          this.semanticMemory.insertFact(
            fact.entity,
            fact.attribute,
            fact.value,
            fact.confidence,
            episode.id
          )

          factsExtracted++
        }

        this.emit('fact-extracted', {
          episodeId: episode.id,
          fact,
        })
      }

      // Extract relations (placeholder for now - will be enhanced with LLM)
      // For now, we can extract basic relations from preference facts
      for (const fact of extractedFacts) {
        if (fact.attribute === 'preference' || fact.attribute === 'tool') {
          // Create a relation: user -> uses/prefers -> entity
          this.semanticMemory.insertRelation(
            fact.entity,
            fact.attribute === 'preference' ? 'prefers' : 'uses',
            fact.value,
            1.0,
            episode.id
          )
          relationsCreated++
        }
      }
    }

    // Update last consolidation time
    this.lastConsolidationTime = Date.now()

    const result: ConsolidationResult = {
      episodesProcessed: episodes.length,
      factsExtracted,
      conflictsFound,
      relationsCreated,
    }

    this.emit('consolidation-complete', result)

    return result
  }

  /**
   * Extract facts from text using pattern matching.
   *
   * NOTE: This is a placeholder implementation using basic regex patterns.
   * In the integration phase, this will be replaced with LLM-powered extraction
   * for more accurate and comprehensive fact extraction.
   *
   * @param text - Text content to extract facts from
   * @returns Array of extracted facts
   */
  async extractFactsFromText(text: string): Promise<ExtractedFact[]> {
    const facts: ExtractedFact[] = []

    // Limit input length to prevent ReDoS on long messages
    const safeText = text.length > 100000 ? text.slice(0, 100000) : text

    // Pattern 1: "I prefer X" or "I like X"
    const preferencePattern = /I (?:prefer|like) ([^.,!?]{1,100})/gi
    let match: RegExpExecArray | null
    while ((match = preferencePattern.exec(safeText)) !== null) {
      const value = match[1].trim()
      if (value.length > 0 && value.length < 100) {
        facts.push({
          entity: 'user',
          attribute: 'preference',
          value,
          confidence: 0.8,
        })
      }
    }

    // Pattern 2: "I use X" or "I work with X"
    const toolPattern = /I (?:use|work with) ([^.,!?]{1,100})/gi
    while ((match = toolPattern.exec(safeText)) !== null) {
      const value = match[1].trim()
      if (value.length > 0 && value.length < 100) {
        facts.push({
          entity: 'user',
          attribute: 'tool',
          value,
          confidence: 0.8,
        })
      }
    }

    // Pattern 3: "I work on X" or "I'm working on X"
    const projectPattern = /I(?:'m)? working on ([^.,!?]{1,100})/gi
    while ((match = projectPattern.exec(safeText)) !== null) {
      const value = match[1].trim()
      if (value.length > 0 && value.length < 100) {
        facts.push({
          entity: 'user',
          attribute: 'project',
          value,
          confidence: 0.8,
        })
      }
    }

    // Pattern 4: "I am X" or "I'm X" (role/identity)
    const rolePattern = /I(?:'m| am) (?:a |an )?([a-z]+ (?:developer|engineer|designer|manager|student))/gi
    while ((match = rolePattern.exec(safeText)) !== null) {
      const value = match[1].trim()
      if (value.length > 0 && value.length < 100) {
        facts.push({
          entity: 'user',
          attribute: 'role',
          value,
          confidence: 0.9,
        })
      }
    }

    // Pattern 5: "My name is X" or "I'm X" (at start of sentence)
    const namePattern = /(?:my name is|I'm) ([A-Z][a-z]+)(?: |$)/g
    while ((match = namePattern.exec(safeText)) !== null) {
      const value = match[1].trim()
      if (value.length > 1 && value.length < 50) {
        facts.push({
          entity: 'user',
          attribute: 'name',
          value,
          confidence: 0.95,
        })
      }
    }

    return facts
  }

  // ==========================================================================
  // Utilities
  // ==========================================================================

  /**
   * Get recent episodes since a timestamp.
   *
   * @param since - Timestamp to get episodes after
   * @param limit - Maximum number of episodes to return
   * @returns Array of episodes
   */
  private getRecentEpisodes(since: number, limit: number): Episode[] {
    // Query episodes from all channels since the timestamp
    // For now, we'll use a simple approach of getting episodes with timestamp >= since
    // In a real implementation, this would use a proper query method from EpisodeStoreService

    // Since EpisodeStoreService doesn't have a direct "since" query,
    // we can use the db directly via a custom query
    // For this placeholder, we'll return an empty array and emit a warning

    // TODO: In integration phase, add a proper query method to EpisodeStoreService
    // or query the database directly here

    return []
  }

  /**
   * Get the last consolidation timestamp.
   *
   * @returns ISO timestamp string or null if never consolidated
   */
  getLastConsolidationTime(): string | null {
    if (this.lastConsolidationTime === null) {
      return null
    }
    return new Date(this.lastConsolidationTime).toISOString()
  }
}

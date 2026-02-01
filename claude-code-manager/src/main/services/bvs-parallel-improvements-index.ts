/**
 * BVS Parallel Execution Improvements - Service Index
 *
 * This module exports all services created as part of the BVS Parallel Execution
 * Improvements PRD (P0-P2). These services implement the Ultrapilot-inspired
 * architecture for proactive conflict prevention.
 *
 * Features:
 * - P0.1: File Ownership Data Model (BvsOwnershipService)
 * - P0.2: Shared File Classification (DEFAULT_SHARED_PATTERNS)
 * - P0.3: Ownership Enforcement (BvsWorkerEnforcement)
 * - P1.1: AI-Powered Decomposition (BvsDecompositionService)
 * - P1.2: Mandatory Validation Gate (BvsValidationGateService)
 * - P2.1: Mode Registry (BvsModeRegistry)
 * - P2.2: Worker Skill Injection (MANDATORY_SKILLS, buildWorkerPromptWithSkills)
 */

// P0.1 + P0.2: File Ownership Service
export {
  BvsOwnershipService,
  DEFAULT_SHARED_PATTERNS,
  type FileOwnership,
  type BvsSectionV2,
  type OwnershipMap,
  type ClassificationResult,
  type FileConflict,
  type OwnershipValidationResult,
} from './bvs-ownership-service'

// P0.3: Worker Enforcement
export {
  BvsWorkerEnforcement,
  type SharedFileChange,
  type EnforcementContext,
  type EnforcementResult,
} from './bvs-worker-enforcement'

// P1.1: AI-Powered Decomposition
export {
  BvsDecompositionService,
  DECOMPOSITION_PROMPT,
  type DecomposedPlan,
  type ParallelGroup,
  type CriticalPath,
  type DecompositionMetadata,
  type DependencyGraph,
  type CodebaseContext,
} from './bvs-decomposition-service'

// P1.2: Mandatory Validation Gate
export {
  BvsValidationGateService,
  getBvsValidationGateService,
  DEFAULT_VALIDATION_CONFIG,
  ValidationError,
  type ValidationGateConfig,
  type ValidationBypass,
  type ValidationFailure,
  type CompletionResult,
  type AuditEntry,
} from './bvs-validation-gate-service'

// P2.1: Mode Registry
export {
  BvsModeRegistry,
  MODE_CONFIGS,
  ModeConflictError,
  type BvsMode,
  type ModeConfig,
  type ModeState,
  type ModeContext,
  type ModeTransitionResult,
} from './bvs-mode-registry'

// P2.2: Worker Skill Injection
export {
  MANDATORY_SKILLS,
  buildWorkerPromptWithSkills,
  getApplicableSkills,
  type WorkerSkill,
  type WorkerContext,
  type WorkerConfig,
} from './bvs-worker-skills'

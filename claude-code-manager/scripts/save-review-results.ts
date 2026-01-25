/**
 * Save Review Results to Markdown
 *
 * This script processes review results from work-reviewer agents and saves them
 * as formatted markdown files in .bvs/reviews/
 *
 * Usage:
 *   ts-node scripts/save-review-results.ts
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import {
  formatReviewAsMarkdown,
  saveReviewReport,
  createReviewIndex,
  type ReviewResult
} from '../src/main/services/bvs-review-formatter'

// Review results from the Ralph Loop review session
const RALPH_LOOP_REVIEWS = {
  sessionId: 'ralph-loop-review-2025-01-25',
  projectPath: 'C:\\claude_projects\\claude-cli\\claude-code-manager',
  reviews: [
    {
      reviewer: 'work-reviewer-correctness',
      files: ['src/renderer/components/bvs/BvsSubtaskMetrics.tsx'],
      result: {
        "category": "correctness",
        "overall_assessment": "Issues Found",
        "summary": "Found 3 P1 issues: missing null checks on metrics properties that could cause runtime errors, potential division by zero in percentage calculation, and missing error handling for session cost polling failures. The component lacks defensive programming for edge cases where metrics data is incomplete or invalid.",
        "issues": [
          {
            "severity": "P1",
            "file": "claude-code-manager/src/renderer/components/bvs/BvsSubtaskMetrics.tsx",
            "line": 85,
            "type": "null_access",
            "description": "Accessing subtask.metrics properties without checking if individual properties exist. The type check 'if (!subtask.metrics)' only verifies the metrics object exists, not its properties.",
            "current_code": "if (!subtask.metrics) return acc\n\nreturn {\n  totalCost: acc.totalCost + subtask.metrics.costUsd,\n  totalTokensInput: acc.totalTokensInput + subtask.metrics.tokensInput,\n  totalTokensOutput: acc.totalTokensOutput + subtask.metrics.tokensOutput,\n  ...\n}",
            "issue_detail": "If subtask.metrics exists but costUsd, tokensInput, or tokensOutput are undefined or null, this will cause NaN propagation in calculations. When metrics are partially populated or corrupted, adding undefined to a number results in NaN, which then cascades through all aggregated calculations, displaying 'NaN' in the UI and breaking cost tracking.",
            "recommendation": "Add defensive checks for each metric property:\n\nif (!subtask.metrics) return acc\n\nconst costUsd = subtask.metrics.costUsd ?? 0\nconst tokensInput = subtask.metrics.tokensInput ?? 0\nconst tokensOutput = subtask.metrics.tokensOutput ?? 0\n\nreturn {\n  totalCost: acc.totalCost + costUsd,\n  totalTokensInput: acc.totalTokensInput + tokensInput,\n  totalTokensOutput: acc.totalTokensOutput + tokensOutput,\n  avgCostPerSubtask: 0,\n  haikuCount: acc.haikuCount + (subtask.metrics.model === 'haiku' ? 1 : 0),\n  sonnetCount: acc.sonnetCount + (subtask.metrics.model === 'sonnet' ? 1 : 0),\n  totalDuration: acc.totalDuration + (subtask.duration ?? 0)\n}",
            "confidence": 82,
            "security_impact": "n/a"
          },
          {
            "severity": "P1",
            "file": "claude-code-manager/src/renderer/components/bvs/BvsSubtaskMetrics.tsx",
            "line": 342,
            "type": "logic_error",
            "description": "Division by zero risk when sessionLimits.maxCostPerSubtask is 0, causing Math.round to receive Infinity and display as 'Infinity%'",
            "current_code": "{Math.round((subtask.metrics.costUsd / sessionLimits.maxCostPerSubtask) * 100)}% of limit",
            "issue_detail": "If sessionLimits.maxCostPerSubtask is 0 (either from initialization error, config corruption, or intentional setting), dividing by zero produces Infinity. Math.round(Infinity) returns Infinity, which displays as 'Infinity% of limit' in the UI. This creates a confusing user experience and indicates a broken state.",
            "recommendation": "Add zero-check before division:\n\n{sessionLimits.maxCostPerSubtask > 0\n  ? Math.round((subtask.metrics.costUsd / sessionLimits.maxCostPerSubtask) * 100)\n  : 100}% of limit\n\nOr alternatively, use a safe division helper:\n\nconst calculatePercentage = (value: number, max: number): number => {\n  if (max <= 0) return 100 // Treat zero limit as exceeded\n  return Math.round((value / max) * 100)\n}\n\n// Usage:\n{calculatePercentage(subtask.metrics.costUsd, sessionLimits.maxCostPerSubtask)}% of limit",
            "confidence": 78,
            "security_impact": "n/a"
          },
          {
            "severity": "P1",
            "file": "claude-code-manager/src/renderer/components/bvs/BvsSubtaskMetrics.tsx",
            "line": 63,
            "type": "missing_error_handling",
            "description": "Session cost polling continues even after persistent errors, potentially spamming console and creating performance issues with infinite failed requests",
            "current_code": "useEffect(() => {\n  const loadSessionCost = async () => {\n    try {\n      const result = await window.electron.bvsGetSessionCost(sessionId)\n      if (result.success && typeof result.cost === 'number') {\n        setSessionCost(result.cost)\n      }\n    } catch (error) {\n      console.error('[BvsSubtaskMetrics] Error loading session cost:', error)\n    }\n  }\n\n  loadSessionCost()\n  const interval = setInterval(loadSessionCost, 5000)\n  return () => clearInterval(interval)\n}, [sessionId])",
            "issue_detail": "When bvsGetSessionCost fails (e.g., session doesn't exist, IPC error, backend down), the error is logged but polling continues every 5 seconds indefinitely. This creates 12 error logs per minute, potential memory leaks if error objects are large, and unnecessary network/IPC overhead. Users see console spam and the component keeps trying to fetch data that will never succeed.",
            "recommendation": "Implement exponential backoff or stop polling after consecutive failures:\n\nuseEffect(() => {\n  let failureCount = 0\n  const MAX_FAILURES = 3\n  \n  const loadSessionCost = async () => {\n    try {\n      const result = await window.electron.bvsGetSessionCost(sessionId)\n      if (result.success && typeof result.cost === 'number') {\n        setSessionCost(result.cost)\n        failureCount = 0 // Reset on success\n      } else {\n        failureCount++\n      }\n    } catch (error) {\n      failureCount++\n      console.error('[BvsSubtaskMetrics] Error loading session cost:', error)\n    }\n  }\n\n  loadSessionCost()\n  const interval = setInterval(() => {\n    if (failureCount < MAX_FAILURES) {\n      loadSessionCost()\n    } else {\n      console.warn('[BvsSubtaskMetrics] Stopped polling after multiple failures')\n      clearInterval(interval)\n    }\n  }, 5000)\n  \n  return () => clearInterval(interval)\n}, [sessionId])",
            "confidence": 80,
            "security_impact": "n/a"
          }
        ],
        "positive_notes": [
          "Good defensive check for subtask.duration with fallback to 0 (line 91)",
          "Proper cleanup of interval in useEffect return (line 76)",
          "Comprehensive null check for sessionCost display with fallback '—' (line 218)",
          "Good edge case handling for empty completedSubtasks array in average calculation (lines 106-108)",
          "Proper status filtering for completed subtasks (line 105)",
          "Safe token formatting with proper threshold checks (lines 120-126)"
        ]
      }
    },
    {
      reviewer: 'work-reviewer-correctness',
      files: ['src/renderer/components/bvs/BvsSubtaskProgress.tsx'],
      result: {
        "category": "correctness",
        "overall_assessment": "Issues Found",
        "summary": "Found 3 high-confidence issues in BvsSubtaskProgress.tsx: division by zero potential in progress calculation, missing cleanup for polling interval, and infinite re-render risk from useEffect dependencies. These bugs could cause crashes or performance degradation.",
        "issues": [
          {
            "severity": "P0",
            "file": "claude-code-manager/src/renderer/components/bvs/BvsSubtaskProgress.tsx",
            "line": 208,
            "type": "logic_error",
            "description": "Division by zero when maxTurns is 0, causing NaN in progress percentage calculation",
            "current_code": "<span>{Math.round((subtask.turnsUsed / subtask.maxTurns) * 100)}%</span>\n...\nstyle={{ width: `${(subtask.turnsUsed / subtask.maxTurns) * 100}%` }}",
            "issue_detail": "If maxTurns is 0 (which can happen during initialization or configuration errors), dividing by zero produces NaN. This causes the UI to display 'NaN%' and sets the progress bar width to 'NaN%', breaking the visual display. Based on the type definition, maxTurns is a number but not explicitly validated to be > 0.",
            "recommendation": "Add a null/zero check before division:\n\nconst progressPercent = subtask.maxTurns > 0 \n  ? Math.round((subtask.turnsUsed / subtask.maxTurns) * 100)\n  : 0;\n\n// Then use progressPercent in both places:\n<span>Turn {subtask.turnsUsed} of {subtask.maxTurns}</span>\n<span>{progressPercent}%</span>\n...\nstyle={{ width: `${progressPercent}%` }}",
            "confidence": 92,
            "security_impact": "n/a"
          },
          {
            "severity": "P1",
            "file": "claude-code-manager/src/renderer/components/bvs/BvsSubtaskProgress.tsx",
            "line": 46,
            "type": "race_condition",
            "description": "useEffect dependency array includes onRefresh callback, causing potential infinite re-renders if parent doesn't memoize the callback",
            "current_code": "useEffect(() => {\n  const loadSubtasks = async () => {\n    try {\n      const result = await window.electron.bvsPlanning.getSubtaskProgress(sessionId, sectionId)\n      if (result.success && onRefresh) {\n        onRefresh()\n      }\n    } catch (error) {\n      console.error('[BvsSubtaskProgress] Error loading subtasks:', error)\n    }\n  }\n\n  const hasActive = subtasks.some(s => s.status === 'in_progress')\n  if (hasActive) {\n    const interval = setInterval(loadSubtasks, 2000)\n    return () => clearInterval(interval)\n  }\n}, [sessionId, sectionId, subtasks, onRefresh])",
            "issue_detail": "The useEffect includes onRefresh in the dependency array. If the parent component doesn't wrap onRefresh in useCallback, this callback will be recreated on every parent render, causing the useEffect to re-run. When onRefresh is called, it likely triggers a state update in the parent, which re-renders this component, creating a new onRefresh, triggering the useEffect again - infinite loop. Additionally, including 'subtasks' in dependencies means the effect re-runs whenever subtasks array changes, which happens on every poll result, potentially creating/destroying intervals rapidly.",
            "recommendation": "Remove onRefresh from dependencies and use useCallback pattern, or better yet, remove onRefresh callback entirely since the polling result isn't being used:\n\nuseEffect(() => {\n  const loadSubtasks = async () => {\n    try {\n      await window.electron.bvsPlanning.getSubtaskProgress(sessionId, sectionId)\n      // The IPC call should trigger state updates via events/stores\n      // No need to call onRefresh here\n    } catch (error) {\n      console.error('[BvsSubtaskProgress] Error loading subtasks:', error)\n    }\n  }\n\n  const hasActive = subtasks.some(s => s.status === 'in_progress')\n  if (hasActive) {\n    const interval = setInterval(loadSubtasks, 2000)\n    return () => clearInterval(interval)\n  }\n}, [sessionId, sectionId, subtasks])\n\n// Or if you must keep onRefresh, use ref pattern:\nconst onRefreshRef = useRef(onRefresh)\nuseEffect(() => { onRefreshRef.current = onRefresh })\n// Then remove onRefresh from deps",
            "confidence": 85,
            "security_impact": "n/a"
          },
          {
            "severity": "P1",
            "file": "claude-code-manager/src/renderer/components/bvs/BvsSubtaskProgress.tsx",
            "line": 61,
            "type": "missing_error_handling",
            "description": "Interval cleanup not guaranteed when hasActive changes from true to false",
            "current_code": "if (hasActive) {\n  const interval = setInterval(loadSubtasks, 2000)\n  return () => clearInterval(interval)\n}",
            "issue_detail": "When hasActive transitions from true to false (all subtasks complete), the useEffect re-runs but doesn't enter the if block, so no cleanup function is returned. However, the previous interval is still running from the last effect execution. The cleanup function from the previous render will run, but if the component unmounts or dependencies change when hasActive is false, there's no interval to clean up and we're safe. BUT: the real issue is that when dependencies change while hasActive is true, a new interval is created before the old one is cleaned up, potentially creating multiple polling intervals running simultaneously.",
            "recommendation": "Always return a cleanup function, even when not creating an interval:\n\nuseEffect(() => {\n  const loadSubtasks = async () => {\n    try {\n      const result = await window.electron.bvsPlanning.getSubtaskProgress(sessionId, sectionId)\n      if (result.success && onRefresh) {\n        onRefresh()\n      }\n    } catch (error) {\n      console.error('[BvsSubtaskProgress] Error loading subtasks:', error)\n    }\n  }\n\n  const hasActive = subtasks.some(s => s.status === 'in_progress')\n  \n  let interval: NodeJS.Timeout | undefined\n  if (hasActive) {\n    interval = setInterval(loadSubtasks, 2000)\n  }\n  \n  return () => {\n    if (interval) {\n      clearInterval(interval)\n    }\n  }\n}, [sessionId, sectionId, subtasks, onRefresh])",
            "confidence": 78,
            "security_impact": "n/a"
          }
        ],
        "positive_notes": [
          "Good null checks on optional fields (subtask.duration, subtask.metrics, subtask.error, subtask.commitSha)",
          "Proper default value for subtasks prop (empty array)",
          "Good error handling with try-catch in polling function",
          "Correct use of optional chaining for callbacks (onRefresh?.())",
          "Proper pluralization logic for file count display",
          "Safe string operations with replace and toString",
          "Good empty state handling with clear messaging"
        ]
      }
    },
    {
      reviewer: 'work-reviewer-correctness',
      files: ['src/main/services/bvs-learning-capture-service.ts'],
      result: {
        "category": "correctness",
        "overall_assessment": "Issues Found",
        "summary": "Found critical issues including file I/O race condition in singleton initialization, unsafe property access that could cause null reference errors, and incomplete implementation of pattern detection logic. The service also has edge case vulnerabilities around empty data structures and missing error handling in async operations.",
        "issues": [
          {
            "severity": "P0",
            "file": "claude-code-manager/src/main/services/bvs-learning-capture-service.ts",
            "line": 362,
            "type": "race_condition",
            "description": "Singleton initialization with async initialize() creates race condition - getBvsLearningCaptureService() returns service before initialize() completes",
            "current_code": "export function getBvsLearningCaptureService(): BvsLearningCaptureService {\n  if (!bvsLearningCaptureService) {\n    bvsLearningCaptureService = new BvsLearningCaptureService()\n    bvsLearningCaptureService.initialize() // No await!\n  }\n  return bvsLearningCaptureService\n}",
            "issue_detail": "The initialize() method is async and performs critical I/O operations (creating directories, loading learnings from disk), but it's called without await in the singleton getter. This means callers immediately get a service instance with this.learnings still empty (or partially loaded). If captureLimitViolation() or getReport() are called before initialize() completes, they operate on stale/empty data, causing lost learnings or incorrect reports.",
            "recommendation": "Change the singleton pattern to async initialization:\n\nexport async function getBvsLearningCaptureService(): Promise<BvsLearningCaptureService> {\n  if (!bvsLearningCaptureService) {\n    bvsLearningCaptureService = new BvsLearningCaptureService()\n    await bvsLearningCaptureService.initialize()\n  }\n  return bvsLearningCaptureService\n}\n\nAlternatively, make initialize() idempotent and call it at the start of each public method with proper locking.",
            "confidence": 95,
            "security_impact": "low"
          },
          {
            "severity": "P0",
            "file": "claude-code-manager/src/main/services/bvs-learning-capture-service.ts",
            "line": 260,
            "type": "null_access",
            "description": "Accessing subtask.files or section.files without null/undefined check - files property could be missing or undefined",
            "current_code": "const hasApiRoutes = (subtask?.files || section.files).some(f =>\n  f.path.includes('/api/') || f.path.includes('/routes/')\n)\nconst hasDatabase = (subtask?.files || section.files).some(f =>\n  f.path.includes('database') || f.path.includes('db.')\n)",
            "issue_detail": "Lines 259-264 assume section.files is always defined and is an array. According to BvsSection type, files is required, but runtime data could be malformed or corrupted. More critically, on line 260 the code accesses f.path, but subtask.files is string[] (not BvsFile[]), while section.files is BvsFile[]. When subtask?.files is used, f is a string, not an object with .path property. This will throw 'Cannot read property path of undefined' or similar error.",
            "recommendation": "Fix type mismatch and add safety checks:\n\nconst files = subtask ? subtask.files : (section.files || []).map(f => f.path)\nconst hasApiRoutes = files.some(filePath =>\n  typeof filePath === 'string' && (filePath.includes('/api/') || filePath.includes('/routes/'))\n)\nconst hasDatabase = files.some(filePath =>\n  typeof filePath === 'string' && (filePath.includes('database') || filePath.includes('db.'))\n)",
            "confidence": 98,
            "security_impact": "n/a"
          },
          {
            "severity": "P1",
            "file": "claude-code-manager/src/main/services/bvs-learning-capture-service.ts",
            "line": 278,
            "type": "logic_error",
            "description": "calculateComplexity() has type mismatch - subtask.files is string[] but section.files is BvsFile[], causing inconsistent complexity calculation",
            "current_code": "const files = subtask ? subtask.files : section.files.map(f => f.path)\nfiles.forEach(file => {\n  if (file.includes('schema') || file.includes('migration')) score += 2\n  if (file.includes('/api/')) score += 1\n  if (file.includes('service')) score += 1\n})",
            "issue_detail": "When subtask is provided, files is string[]. When section is provided, files is string[] (mapped from BvsFile[]). This works, but the fileCount calculation on line 274 uses subtask.files.length vs section.files.length directly - these should be consistent. More importantly, the complexity scoring doesn't account for file.action ('create' vs 'modify' vs 'delete') which could be valuable signal for complexity.",
            "confidence": 80,
            "security_impact": "n/a"
          },
          {
            "severity": "P1",
            "file": "claude-code-manager/src/main/services/bvs-learning-capture-service.ts",
            "line": 245,
            "type": "logic_error",
            "description": "identifyPatterns() treats subtask.files as array of objects with .includes() method, but subtask.files is string[]",
            "current_code": "if (subtask) {\n  const hasSchemaFiles = subtask.files.some(f =>\n    f.includes('schema') || f.includes('migration') || f.includes('prisma')\n  )\n  const hasTypeFiles = subtask.files.some(f => f.includes('.types.ts'))\n  const hasImplFiles = subtask.files.some(f =>\n    !f.includes('.types.ts') && !f.includes('.test.') && !f.includes('schema')\n  )",
            "issue_detail": "According to BvsSubtask type definition (line 34 in bvs-types.ts), subtask.files is string[]. This code actually works correctly because strings have .includes() method. However, there's a subtle bug: the file path strings might be absolute paths or relative paths, and the pattern matching doesn't normalize them. For example, 'C:\\\\project\\\\schema.ts' won't match 'schema' on Windows due to backslashes.",
            "confidence": 75,
            "security_impact": "n/a"
          },
          {
            "severity": "P1",
            "file": "claude-code-manager/src/main/services/bvs-learning-capture-service.ts",
            "line": 338,
            "type": "missing_error_handling",
            "description": "loadLearnings() catches all errors silently, even serious errors like permission denied or corrupted JSON",
            "current_code": "private async loadLearnings(): Promise<void> {\n  try {\n    const learningsFile = path.join(this.learningsDir, 'learnings.json')\n    const data = await fs.readFile(learningsFile, 'utf-8')\n    this.learnings = JSON.parse(data)\n  } catch (error) {\n    // File doesn't exist yet, start with empty array\n    this.learnings = []\n  }\n}",
            "issue_detail": "The catch block assumes any error means 'file not found' and silently initializes empty array. However, errors could be: (1) Permission denied - user lacks read access, (2) Corrupted JSON - JSON.parse() fails, (3) Disk I/O error - hardware failure. All these scenarios result in silent data loss without any logging or notification. Previous learnings are discarded and overwritten on next save.",
            "recommendation": "Differentiate between expected and unexpected errors:\n\nprivate async loadLearnings(): Promise<void> {\n  try {\n    const learningsFile = path.join(this.learningsDir, 'learnings.json')\n    const data = await fs.readFile(learningsFile, 'utf-8')\n    this.learnings = JSON.parse(data)\n  } catch (error: any) {\n    if (error.code === 'ENOENT') {\n      // File doesn't exist yet, start with empty array\n      this.learnings = []\n    } else {\n      console.error('[BvsLearningCapture] Failed to load learnings:', error)\n      console.error('[BvsLearningCapture] Starting with empty learnings array')\n      this.learnings = []\n    }\n  }\n}",
            "confidence": 85,
            "security_impact": "low"
          },
          {
            "severity": "P1",
            "file": "claude-code-manager/src/main/services/bvs-learning-capture-service.ts",
            "line": 111,
            "type": "missing_error_handling",
            "description": "captureLimitViolation() calls saveLearnings() without await, causing silent save failures and potential data loss",
            "issue_detail": "Wait, actually this code DOES have await on line 111. Let me re-check... Yes, there is await. However, saveLearnings() catches and logs errors silently (line 351), so if the save fails, the learning is added to memory but not persisted. The caller receives the learning object with no indication that persistence failed. On next restart, this learning is lost.",
            "recommendation": "Either propagate save errors or add retry logic:\n\nprivate async saveLearnings(): Promise<void> {\n  const learningsFile = path.join(this.learningsDir, 'learnings.json')\n  \n  try {\n    await fs.writeFile(learningsFile, JSON.stringify(this.learnings, null, 2))\n  } catch (error) {\n    console.error('[BvsLearningCapture] Failed to save learnings:', error)\n    throw new Error(`Failed to persist learnings: ${error}`)\n  }\n}\n\nOr add a flag to LearningEntry:\n\nlearning.persisted = false\nawait this.saveLearnings()\nlearning.persisted = true",
            "confidence": 78,
            "security_impact": "n/a"
          },
          {
            "severity": "P2",
            "file": "claude-code-manager/src/main/services/bvs-learning-capture-service.ts",
            "line": 87,
            "type": "logic_error",
            "description": "Learning ID generation using Math.random() has collision risk and non-unique IDs across restarts",
            "current_code": "id: `learning-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`",
            "issue_detail": "If multiple learnings are captured in the same millisecond (likely in parallel execution), Date.now() returns the same value. Math.random().toString(36).substr(2, 9) provides ~6-7 characters of randomness, giving ~36^7 = ~78 billion combinations. However, substr() is deprecated in favor of substring(). More importantly, this ID scheme is not cryptographically secure and could theoretically collide.",
            "recommendation": "Use crypto.randomUUID() for guaranteed unique IDs:\n\nimport { randomUUID } from 'crypto'\n\nid: `learning-${randomUUID()}`\n\nOr use timestamp with incrementing counter:\n\nprivate learningCounter = 0\n\nid: `learning-${Date.now()}-${this.learningCounter++}`",
            "confidence": 70,
            "security_impact": "n/a"
          }
        ],
        "positive_notes": [
          "Good categorization logic with multiple detection strategies",
          "Sensible severity calculation based on percentage over limit",
          "Well-structured report aggregation with pattern counting",
          "Proper cleanup mechanism to prevent unbounded growth of learnings",
          "Good use of optional chaining (subtask?.files) in several places"
        ]
      }
    }
  ]
}

async function main() {
  console.log('Saving Ralph Loop review results to markdown...\n')

  const savedFiles: Array<{ reviewer: string; filepath: string; issueCount: number }> = []

  for (const review of RALPH_LOOP_REVIEWS.reviews) {
    try {
      // Format as markdown
      const markdown = formatReviewAsMarkdown(
        review.reviewer,
        review.result,
        review.files,
        {
          sessionId: RALPH_LOOP_REVIEWS.sessionId,
          timestamp: Date.now()
        }
      )

      // Save to file
      const filepath = await saveReviewReport(
        RALPH_LOOP_REVIEWS.projectPath,
        review.reviewer,
        markdown,
        {
          sessionId: RALPH_LOOP_REVIEWS.sessionId,
          timestamp: Date.now()
        }
      )

      savedFiles.push({
        reviewer: review.reviewer,
        filepath,
        issueCount: review.result.issues.length
      })

      console.log(`✓ Saved ${review.reviewer} review`)
      console.log(`  File: ${filepath}`)
      console.log(`  Issues: ${review.result.issues.length}`)
      console.log()
    } catch (error) {
      console.error(`✗ Failed to save ${review.reviewer}:`, error)
    }
  }

  // Create index
  try {
    await createReviewIndex(
      RALPH_LOOP_REVIEWS.projectPath,
      RALPH_LOOP_REVIEWS.sessionId,
      savedFiles
    )
    console.log(`✓ Created review index\n`)
  } catch (error) {
    console.error(`✗ Failed to create index:`, error)
  }

  console.log(`\nSummary:`)
  console.log(`  Reviews saved: ${savedFiles.length}`)
  console.log(`  Total issues: ${savedFiles.reduce((sum, f) => sum + f.issueCount, 0)}`)
  console.log(`\nReview reports saved to:`)
  console.log(`  ${path.join(RALPH_LOOP_REVIEWS.projectPath, '.bvs', 'reviews', RALPH_LOOP_REVIEWS.sessionId)}`)
}

main().catch(console.error)

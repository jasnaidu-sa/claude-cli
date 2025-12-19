# Agent Harness Skill

## Purpose

Guide for building and integrating harness agents that augment the Python autonomous orchestrator. These agents solve reliability and context problems during autonomous execution.

## When to Use

Use this skill when:
- Building new harness agents (Context, Checkpoint, Impact Assessment)
- Integrating agents into the orchestrator
- Understanding the multi-agent coordination pattern
- Debugging harness agent behavior

## Architecture Overview

### The Problem

Autonomous coding faces two critical challenges:
1. **Reliability**: 95% success per step → 36% over 20 steps
2. **Bounded Attention**: 200K context windows suffer "lost in the middle"

### The Solution: 3-Agent Harness

Three specialized agents augment the orchestrator during execution:

```
┌─────────────────────────────────────────────────────────┐
│                Python Orchestrator Process               │
│                                                           │
│  ┌──────────────┐      ┌──────────────────────────┐    │
│  │ Orchestrator │◄─────┤  Blackboard State        │    │
│  │   (Main)     │      │  .autonomous/state/      │    │
│  └──────────────┘      │  - context.json          │    │
│         │              │  - checkpoints.json       │    │
│         │              │  - impact.json            │    │
│         ▼              └──────────────────────────┘    │
│  ┌──────────────┐             ▲  ▲  ▲                 │
│  │   Execute    │             │  │  │                  │
│  │   Feature    │             │  │  │                  │
│  └──────────────┘             │  │  │                  │
│         │                     │  │  │                  │
│         │              ┌──────┴──┴──┴──────┐          │
│         │              │                    │          │
│         └──────────────►  Harness Agents   │          │
│                        │                    │          │
│                        │ 1. Context Agent   │          │
│                        │ 2. Checkpoint Agent│          │
│                        │ 3. Impact Agent    │          │
│                        └────────────────────┘          │
└─────────────────────────────────────────────────────────┘
```

## Agent Responsibilities

### 1. Context Agent (Phase 1)

**Purpose**: Maintain compressed, relevant context under 2K tokens.

**When it runs**:
- After every 5 features completed
- After each category completes

**What it does**:
- Reads feature completion logs
- Compresses older context, keeps recent details
- Extracts key decisions from specs
- Records failures with root causes
- Updates active constraints

**Output**: `.autonomous/context/`
- `running-summary.json` - Compressed summary (max 2K tokens)
- `key-decisions.json` - Critical design decisions
- `failure-memory.json` - Failures with root causes
- `active-constraints.json` - Active constraints

**Integration point**:
```python
# In orchestrator after feature completion
if completed_count % 5 == 0:
    context_agent.summarize()

# Before feature execution
context = context_agent.get_injection(feature_id)
enriched_prompt = inject_context(prompt, context)
```

### 2. Checkpoint Agent (Phase 2)

**Purpose**: Determine when human review is needed based on risk.

**When it runs**: Before each feature starts execution.

**What it does**:
- Analyzes feature spec
- Calculates risk score (0-100)
- Returns: `auto-proceed` | `soft-checkpoint` | `hard-checkpoint`

**Risk factors**:
- File count (>10 files = higher risk)
- File types (auth, payments, data integrity = high risk)
- Recent failures (similar features failed = higher risk)
- Blast radius (affects many features = higher risk)

**Output**: `.autonomous/checkpoints/`
- `checkpoint-{id}.json` - Decision with rationale
- `decisions-log.json` - Audit trail

**Integration point**:
```python
# Before feature execution
decision = checkpoint_agent.assess_risk(feature)
if decision == 'hard-checkpoint':
    pause_and_wait_for_user()
elif decision == 'soft-checkpoint':
    show_preview_with_skip_option()
# else auto-proceed
```

### 3. Impact Assessment Agent (Phase 3)

**Purpose**: Forward-looking analysis of how current work affects future features.

**When it runs**: After each category completes.

**What it does**:
- Reviews remaining features in spec
- Analyzes dependencies
- Identifies potential conflicts
- Flags if earlier decisions need revisiting

**Output**: `.autonomous/impact/`
- `category-{id}-impact.json` - Impact analysis
- `revision-flags.json` - Features needing revision

**Integration point**:
```python
# After category completion
impact = impact_agent.analyze(completed_features, remaining_features)
if impact.has_conflicts:
    trigger_checkpoints_for_affected_features()
```

## Coordination Pattern: Event-Driven Blackboard

Agents **do NOT talk to each other directly**. Instead, they read/write to a shared state file.

### Blackboard: `.autonomous/state/execution-state.json`

```json
{
  "currentFeature": 8,
  "contextSummary": {
    "content": "...",
    "tokenCount": 1847,
    "lastUpdated": 1734604800000
  },
  "checkpointDecision": {
    "decision": "soft-checkpoint",
    "riskScore": 65,
    "reason": "Modifies authentication logic",
    "timestamp": 1734604800000
  },
  "impactFlags": [
    "Feature 12 may conflict with changes in Feature 8"
  ],
  "lastUpdated": "2025-12-19T10:30:00Z"
}
```

### Workflow

1. **Before Feature N**:
   - Checkpoint Agent writes `checkpointDecision`
   - Orchestrator reads decision, pauses if needed

2. **During Feature N**:
   - Context Agent monitors file changes
   - Updates `contextSummary` every 5 features

3. **After Category**:
   - Impact Agent analyzes remaining work
   - Writes `impactFlags`
   - May trigger additional checkpoints

## Implementation Pattern

### Agent Base Class

```python
from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Dict, Any
import json

@dataclass
class AgentState:
    """Base state for harness agents"""
    phase: str = "idle"
    progress: int = 0
    message: str = ""

class HarnessAgent:
    """Base class for harness agents"""

    def __init__(self, project_path: Path):
        self.project_path = project_path
        self.state_dir = project_path / ".autonomous" / "state"
        self.state_dir.mkdir(parents=True, exist_ok=True)
        self.state = AgentState()

    def read_blackboard(self) -> Dict[str, Any]:
        """Read current execution state"""
        state_file = self.state_dir / "execution-state.json"
        if state_file.exists():
            return json.loads(state_file.read_text())
        return {}

    def write_blackboard(self, updates: Dict[str, Any]) -> None:
        """Update execution state"""
        state_file = self.state_dir / "execution-state.json"
        current = self.read_blackboard()
        current.update(updates)
        current["lastUpdated"] = time.time()
        state_file.write_text(json.dumps(current, indent=2))

    def emit_progress(self, phase: str, progress: int, message: str):
        """Emit progress update"""
        self.state.phase = phase
        self.state.progress = progress
        self.state.message = message
        # Log to orchestrator output
        print(f"[{self.__class__.__name__}] {phase}: {message} ({progress}%)")
```

### Example: Context Agent

```python
from harness_agent import HarnessAgent, AgentState

class ContextAgent(HarnessAgent):
    """Maintains compressed context during execution"""

    def __init__(self, project_path: Path):
        super().__init__(project_path)
        self.context_dir = project_path / ".autonomous" / "context"
        self.context_dir.mkdir(parents=True, exist_ok=True)

    def summarize(self, completed_features: List[str]) -> None:
        """Summarize completed features and update context"""
        self.emit_progress("loading", 10, "Loading feature logs...")

        # Load logs
        logs = self._load_feature_logs(completed_features)

        self.emit_progress("summarizing", 50, "Compressing context...")

        # Create summary
        summary = self._create_summary(logs)

        # Save to disk
        self._save_summary(summary)

        # Update blackboard
        self.write_blackboard({
            "contextSummary": {
                "content": summary.content,
                "tokenCount": summary.token_count,
                "lastUpdated": time.time()
            }
        })

        self.emit_progress("complete", 100, "Context updated")

    def get_injection(self, feature_id: str) -> Dict[str, Any]:
        """Get relevant context for a feature"""
        state = self.read_blackboard()
        summary = state.get("contextSummary", {})

        # Load decisions/failures/constraints
        decisions = self._load_decisions()
        failures = self._load_failures()
        constraints = self._load_constraints()

        # Filter relevant ones for this feature
        relevant = self._filter_relevant(
            feature_id,
            decisions,
            failures,
            constraints
        )

        return {
            "summary": summary.get("content", ""),
            "decisions": relevant["decisions"],
            "failures": relevant["failures"],
            "constraints": relevant["constraints"],
            "tokenCount": summary.get("tokenCount", 0)
        }
```

## Orchestrator Integration

### 1. Initialize Agents

```python
from context_agent import ContextAgent
from checkpoint_agent import CheckpointAgent
from impact_agent import ImpactAgent

class AutonomousOrchestrator:
    def __init__(self, project_path: Path):
        self.project_path = project_path

        # Initialize harness agents
        self.context_agent = ContextAgent(project_path)
        self.checkpoint_agent = CheckpointAgent(project_path)
        self.impact_agent = ImpactAgent(project_path)
```

### 2. Execution Loop with Agents

```python
async def execute_workflow(self):
    """Main execution loop with harness agents"""

    for category in self.spec.categories:
        for feature in category.features:

            # CHECKPOINT: Assess risk before execution
            decision = self.checkpoint_agent.assess_risk(feature)

            if decision.decision == "hard-checkpoint":
                await self.pause_for_approval(feature, decision)
            elif decision.decision == "soft-checkpoint":
                if not await self.show_preview_with_skip(feature, decision):
                    continue  # User skipped

            # CONTEXT: Get relevant context
            context = self.context_agent.get_injection(feature.id)

            # Execute with enriched context
            await self.execute_feature(feature, context)

            # CONTEXT: Summarize every 5 features
            if self.completed_count % 5 == 0:
                self.context_agent.summarize(self.recent_features)

        # IMPACT: Analyze after category
        impact = self.impact_agent.analyze(
            category.completed_features,
            self.remaining_features
        )

        if impact.has_conflicts:
            await self.handle_conflicts(impact.conflicts)

        # CONTEXT: Summarize after category
        self.context_agent.summarize(category.features)
```

## Best Practices

### 1. Agents are Stateless

- Read state from blackboard each time
- Don't cache state in memory
- Allows orchestrator to restart without losing context

### 2. Emit Progress

- Always emit progress for visibility
- Progress shows in UI and logs
- Helps debug agent behavior

### 3. Error Handling

```python
def summarize(self, features: List[str]) -> None:
    try:
        self.emit_progress("loading", 10, "Loading logs...")
        # ... work ...
        self.emit_progress("complete", 100, "Done")
    except Exception as e:
        self.emit_progress("error", 0, f"Failed: {e}")
        # Don't crash orchestrator - log and continue
        logging.error(f"Context summarization failed: {e}")
```

### 4. Token Budgets

- Context Agent: Max 2K tokens output
- Checkpoint Agent: Max 500 tokens per decision
- Impact Agent: Max 1K tokens per analysis

### 5. Compression Strategy

When context grows too large:
1. Keep last N features in full detail (N=5)
2. Compress older features to 1-sentence summaries
3. Always keep key decisions and failures
4. Archive after 100 features

## Testing Agents

### Unit Test Pattern

```python
def test_context_agent_summarization():
    """Test context summarization"""
    project_path = Path("./test-project")
    agent = ContextAgent(project_path)

    # Create fake feature logs
    create_test_logs(project_path, ["feat-001", "feat-002"])

    # Run summarization
    agent.summarize(["feat-001", "feat-002"])

    # Verify output
    context = agent.get_injection("feat-003")
    assert context["tokenCount"] < 2000
    assert "feat-001" in context["summary"]
```

### Integration Test Pattern

```python
async def test_full_workflow_with_agents():
    """Test full workflow with all 3 agents"""
    orchestrator = AutonomousOrchestrator(test_project_path)

    # Execute workflow
    await orchestrator.execute_workflow()

    # Verify agents ran
    assert (test_project_path / ".autonomous/context/running-summary.json").exists()
    assert (test_project_path / ".autonomous/checkpoints/decisions-log.json").exists()
    assert (test_project_path / ".autonomous/impact/category-01-impact.json").exists()
```

## Common Patterns

### Pattern: Lazy Loading

Don't load all context upfront. Load on-demand:

```python
def get_injection(self, feature_id: str):
    # Only load what's needed for THIS feature
    relevant_decisions = self._find_relevant_decisions(feature_id)
    relevant_failures = self._find_relevant_failures(feature_id)
    # Not all decisions/failures
```

### Pattern: Batch Updates

Update blackboard in batches, not per-field:

```python
# Good
self.write_blackboard({
    "contextSummary": summary,
    "lastContextUpdate": time.time(),
    "featureCount": count
})

# Bad - multiple writes
self.write_blackboard({"contextSummary": summary})
self.write_blackboard({"lastContextUpdate": time.time()})
self.write_blackboard({"featureCount": count})
```

### Pattern: Relevance Scoring

Filter context by relevance:

```python
def _filter_relevant(self, feature_id, decisions, failures, constraints):
    """Score and filter by relevance"""
    scored = []
    for decision in decisions:
        score = self._calculate_relevance(feature_id, decision)
        if score > 0.5:  # Threshold
            scored.append((score, decision))

    # Return top N
    scored.sort(reverse=True)
    return [d for _, d in scored[:5]]
```

## Future Extensions

### Phase 4: Regression Agent

Detects if new changes broke earlier features.

### Phase 5: Optimization Agent

Suggests refactorings and performance improvements.

### Phase 6: Documentation Agent

Maintains up-to-date documentation based on code changes.

## Summary

The agent harness solves reliability and context problems by:
1. **Context Agent**: Compresses context to prevent "lost in the middle"
2. **Checkpoint Agent**: Strategic human intervention at high-risk points
3. **Impact Agent**: Forward-looking conflict detection

All agents:
- Live **inside** the Python orchestrator process
- Coordinate via **blackboard pattern**
- Are **stateless** (read state from disk)
- Emit **progress** for visibility
- Have **token budgets** to prevent bloat

This architecture achieves 98-99% per-step reliability and maintains sub-2K token context throughout execution.

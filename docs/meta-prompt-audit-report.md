# Meta-Prompt Audit Report

**Date:** 2026-01-28
**Issue:** LIN-126
**File audited:** `lib/prompts/meta-prompt-template.js` (181 lines)

## Design Context

The current meta-prompt follows a deliberately simplified decision tree:

```
Preparation needed? → Blockers/Bugs? → Implementation
```

This was intentional - keeping the AI focused on a narrow path prevents decision paralysis and over-analysis. The 10 universal prompts (`triage`, `look-into`, `context`, `breakdown`, `research`, `scoping`, `design`, `spike`, `implementation`, `review`) remain available for manual selection via the web UI.

This report examines each sub-5/5 criterion and explores options for adding flexibility without sacrificing focus.

---

## Scoring Summary

| Criterion | Score | Notes |
|-----------|-------|-------|
| Decision Tree Logic | 3/5 | Sound but gaps for universal prompts |
| Completion Signal Usage | 4/5 | Well integrated |
| Output Format | 4/5 | Clear structure |
| Template References (aiHints) | 5/5 | All 14 templates covered |
| Token Efficiency | 3/5 | Some redundancy |
| Edge Cases | 3/5 | Key gaps identified |

**Overall: 3.7/5**

---

## 1. Decision Tree Logic (3/5)

### Current Issues

**A. Binary preparation assessment**
The tree asks "needs preparation?" but only offers one response: add `preparing` label and do research/breakdown. There's no middle ground for tasks that need a quick orientation before deciding.

```
Current (lines 71-72):
If task needs preparation → Recommend adding `preparing` label and doing research/breakdown first
If ready for implementation → Skip to Step 2
```

**B. No lightweight entry point**
A task might be unfamiliar but not actually need the full "preparing" workflow. The AI can't recommend "just look into this first" without triggering the label machinery.

**C. Step 2 only checks existing labels**
```
Current (lines 76-78):
- `blocked` label: Work is stuck...
- `bug` label: Unexpected behavior...
```
If a task describes a blocker but hasn't been labeled yet, the decision tree misses it.

### Ideal Situation

- AI can recommend a quick orientation (`look-into`) without committing to full preparation
- AI can detect unlabeled blockers/bugs from task content
- Clear escalation path from lightweight → heavyweight prompts

### Potential Solutions

| Solution | Complexity | Impact | Trade-off |
|----------|------------|--------|-----------|
| **A1. Add "uncertain" branch** | Low | Medium | Add: "If uncertain about preparation status → Recommend look-into first" before current Step 1 outcome |
| **A2. Split Step 1 into assessment tiers** | Medium | High | Tier 1: Quick orientation (look-into). Tier 2: Full preparation (preparing label). Decision based on confidence level |
| **A3. Content-based blocker detection** | Medium | Medium | Add to Step 2: "Check description/comments for blocker language even without label" |

**Recommended**: A1 + A3 - minimal changes, meaningful flexibility gain.

---

## 2. Completion Signal Usage (4/5)

### Current Issues

**A. Signals are optional with no fallback**
```javascript
${completionSignals ? `
## Completion Signals
...
` : ''}
```
When signals aren't provided, the AI has no guidance on assessing prior work completion.

**B. Step 1 doesn't reference `preparing` signals**
The `preparing` label has defined completion signals in `completion-signals.js:31-41`:
```javascript
{
  coreOutcome: 'Task is ready for implementation',
  signals: ['Key questions answered or verified', ...],
  readinessCheck: 'Could an implementor start work based on what is known?'
}
```
But Step 1's "verification evidence" checklist (lines 56-60) doesn't explicitly connect to these signals.

### Ideal Situation

- Signals always available (even if minimal defaults)
- Step 1 readiness check aligns with `preparing` completion signals
- Clear connection between decision tree steps and signal definitions

### Potential Solutions

| Solution | Complexity | Impact | Trade-off |
|----------|------------|--------|-----------|
| **B1. Default signals when none provided** | Low | Low | Add fallback text: "No specific signals defined - use general readiness: can work proceed?" |
| **B2. Inline the readiness check** | Low | Medium | Add to Step 1: "Readiness check: Could an implementor start work based on what is known?" (mirrors `preparing` signal) |
| **B3. Reference signals in decision tree** | Medium | High | Add explicit callouts: "See Completion Signals section for `preparing` assessment criteria" |

**Recommended**: B2 - directly embeds the key signal without adding complexity.

---

## 3. Output Format (4/5)

### Current Issues

**A. Action-specific steps are abstract**
```
Current (line 102):
3. [Action-specific steps]
```
No examples show what this looks like for preparation vs. blocker analysis vs. implementation.

**B. No complete output example**
The format specification (lines 164-178) shows structure but not a filled-in example. AI models perform better with concrete examples.

### Ideal Situation

- At least one complete example showing the full output format
- Brief indication of what action-specific steps look like per recommendation type

### Potential Solutions

| Solution | Complexity | Impact | Trade-off |
|----------|------------|--------|-----------|
| **C1. Add step hints per action type** | Low | Medium | After line 103, add: "For preparation: Plan → Research → Document. For blockers: Identify → Analyze → Recommend." |
| **C2. Add one complete example** | Medium | High | Add ~20 lines showing a full "Reasoning + Prompt" output for one common case |
| **C3. Reference aiHints for workflow** | Low | Low | Add note: "See Action Types Reference for workflow patterns per action type" |

**Recommended**: C1 + C3 - lightweight hints without bloating the template.

---

## 4. Token Efficiency (3/5)

### Current Issues

**A. Label Management section is redundant**
Lines 146-157 repeat information already in the decision tree:
- Decision tree (line 71): "Recommend adding `preparing` label"
- Label Management (line 154): "If recommending preparation work and task lacks `preparing` label → include instruction to add it"

**B. Comments vs Description section is verbose**
17 lines (129-145) for guidance that could be a 5-line summary.

**C. Estimated waste**
~25-30 lines (~15% of template) could be consolidated without losing information.

### Ideal Situation

- Each piece of information appears once
- Guidance sections are dense and scannable
- Template stays under 150 lines

### Potential Solutions

| Solution | Complexity | Impact | Trade-off |
|----------|------------|--------|-----------|
| **D1. Remove Label Management section** | Low | Medium | Decision tree already covers this; remove lines 146-157. Risk: less explicit for AI |
| **D2. Consolidate into decision tree** | Medium | High | Move label instructions inline to each step outcome. Single source of truth |
| **D3. Condense Comments vs Description** | Low | Low | Reduce to: "COMMENTS: process notes, investigation, feedback. DESCRIPTION: finalized scope, plans, summaries." |

**Recommended**: D2 + D3 - single source of truth, tighter template.

---

## 5. Edge Cases (3/5)

### Current Issues

**A. Multiple conditions undefined**
What if a task has both `preparing` AND `blocked` labels? Current tree doesn't specify priority.

**B. Empty/minimal descriptions**
No guidance when task description is blank or just a title. Should AI recommend triage? Look-into?

**C. AI uncertainty has no escalation**
If AI genuinely can't determine preparation status, there's no "ask for clarification" or "recommend human review" path.

**D. Parent task completion**
Line 89 mentions "All subtasks complete - consider closing parent" but doesn't say how to recommend this action.

### Ideal Situation

- Explicit priority order when multiple conditions apply
- Fallback recommendation for minimal-information tasks
- Uncertainty escalation path
- Clear parent-closing workflow

### Potential Solutions

| Solution | Complexity | Impact | Trade-off |
|----------|------------|--------|-----------|
| **E1. Add condition priority** | Low | High | Add: "Priority order: blocked > bug > preparing > implementation. Address highest-priority condition first." |
| **E2. Minimal-info fallback** | Low | Medium | Add: "If description is empty or vague, recommend look-into or triage before other actions." |
| **E3. Uncertainty escalation** | Low | Medium | Add to output format: "If unable to assess: state uncertainty and recommend look-into for orientation" |
| **E4. Parent completion guidance** | Medium | Low | Add: "When all subtasks complete, recommend updating parent status and adding completion summary" |

**Recommended**: E1 + E2 + E3 - addresses the most impactful gaps.

---

## Summary: Recommended Changes

### High-value, low-complexity changes

1. **Add uncertainty branch** (A1): "If uncertain → look-into first"
2. **Content-based blocker detection** (A3): Check for blocker language without label
3. **Inline readiness check** (B2): Add the `preparing` signal's readiness question
4. **Add condition priority** (E1): blocked > bug > preparing > implementation
5. **Minimal-info fallback** (E2): Empty description → recommend look-into/triage
6. **Uncertainty escalation** (E3): Can't assess → state uncertainty, recommend orientation

### Medium-value consolidation

7. **Consolidate label rules into decision tree** (D2): Remove redundant section
8. **Condense Comments vs Description** (D3): 17 lines → 5 lines

### Optional enhancements

9. **Add step hints per action type** (C1): Brief workflow patterns
10. **Reference aiHints** (C3): Point to existing documentation

---

## Implementation Estimate

| Change Set | Lines Changed | Risk |
|------------|---------------|------|
| Items 1-3 (flexibility) | +10-15 lines | Low - additive |
| Items 4-6 (edge cases) | +8-12 lines | Low - additive |
| Items 7-8 (consolidation) | -20-25 lines | Medium - removes text |
| **Net change** | -5 to +5 lines | Template stays ~180 lines |

The template could gain meaningful flexibility while staying approximately the same size through consolidation.

---

## Files Referenced

- `lib/prompts/meta-prompt-template.js` - The audit target
- `lib/prompt-templates.js` - 14 non-AI templates with aiHints
- `lib/completion-signals.js` - Signal definitions for 3-label system
- `lib/workflow-config.js` - Label constants
- `docs/prompt-audit-report.md` - Prior audit methodology

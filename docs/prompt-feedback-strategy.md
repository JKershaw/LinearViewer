# Prompt Feedback Strategy

A data-driven approach to improving AI prompt orchestration using session analytics from Dash.

## Goal

Sessions that complete successfully with minimal struggle.

**Measurable proxies:**
- Low negative pattern count
- High productivity score
- Commits produced (actual progress)
- No late-session blockers or goal changes
- Short active duration relative to task complexity

---

## Data Sources

Once Dash integration is complete, we correlate:

| Source | Data |
|--------|------|
| **Linear** | Labels, title, description, parent/subtask relationships |
| **Git** | Commits, branches, timing |
| **Session** | Transcripts, tool operations, duration, 17 pattern detectors |
| **Flags** | Blockers, errors, goal changes, decision points |
| **Timing** | Event index, time to first intervention, relative position |

---

## Feedback Questions

### Validation (Does our approach work?)

| Question | Data Needed | Expected Finding |
|----------|-------------|------------------|
| Does `preparing` label reduce struggles? | Label at start + session patterns | Sessions with prior prep have fewer reading spirals, less shotgun debugging |
| Does breakdown help? | Parent/subtask + session outcomes | Subtask sessions are shorter, cleaner than monolithic task sessions |
| Do rich descriptions help? | Description length/quality + outcomes | Sparse descriptions correlate with early decision points, goal changes |

### Gap-Finding (Where do prompts fail?)

| Question | Data Needed | What It Reveals |
|----------|-------------|-----------------|
| What do early blockers indicate? | Blocker timing + task state | Prep prompts missing something |
| What do goal changes indicate? | Goal shift flag + original prompt | Scope check or requirements unclear |
| What do decision points indicate? | Decision flag + task labels | Insufficient research or design |
| What patterns precede struggles? | Tool sequences before negative patterns | Missing guidance in prompts |

### Improvement (What changes help?)

| Question | Data Needed | Method |
|----------|-------------|--------|
| Did prompt change X improve outcomes? | Before/after metrics | A/B comparison over time |
| Which prompt types have best outcomes? | Prompt type + session success | Rank and analyze top performers |
| What do successful sessions have in common? | Positive pattern sessions + characteristics | Find common factors |

---

## Feedback Cycle

### Phase 1: Baseline

Before changing anything, capture current state:

- % sessions with negative patterns by prompt type
- Average struggle count by task characteristic
- Completion rate (commits produced / sessions started)
- Distribution of blocker/goal-change timing

### Phase 2: Flagging (Continuous)

Auto-flag sessions for review when:

- Negative pattern count > threshold
- Goal change occurred
- Early blocker (first 20% of session)
- Decision point without prior `preparing` work
- Long session (>30 min) without commits

These become case studies for gap analysis.

### Phase 3: Aggregation (Batch)

When sufficient flagged sessions accumulate, aggregate and answer:

- What are the top 3 struggle types in this batch?
- Any new patterns emerging?
- Which flagged sessions reveal prompt gaps?

**Output:** Specific hypotheses like "Prompts for tasks touching auth should include security checklist"

### Phase 4: Refinement (Evidence-Triggered)

When evidence supports a change:

- Update meta-prompt decision tree
- Refine individual prompt templates
- Add new completion signals
- Document changes with rationale

**Trigger:** Clear pattern affecting multiple sessions, not one-off issues.

### Phase 5: Validation (Post-Change)

After changes, compare:

- Same task types, before vs after
- Struggle rates for affected prompt types
- Time to first intervention

---

## Gap Documentation Template

For each identified gap:

```markdown
## Gap: [Short description]

**Evidence:**
- Session(s): [IDs]
- Pattern observed: [what went wrong]
- Timing: [early/mid/late]

**Root cause:**
- [ ] Missing context in prompt
- [ ] Scope not checked
- [ ] Preparation insufficient
- [ ] Requirements unclear
- [ ] Other: ___

**Hypothesis:**
[What change would prevent this]

**Prompt affected:**
[Which template or meta-prompt section]

**Status:** Identified | Tested | Implemented | Validated
```

---

## Automation Levels

| Task | Automation |
|------|------------|
| Flag struggling sessions | Full - pattern matching |
| Batch aggregation | Full - query + summarize |
| Gap identification | Partial - LLM analysis of flagged sessions |
| Hypothesis generation | Partial - LLM suggests based on patterns |
| Prompt changes | Manual - requires judgment |
| Impact measurement | Full - before/after queries |

---

## Feedback Loop Diagram

```
┌─────────────────────────────────────────┐
│         CONTINUOUS COLLECTION           │
│  Sessions + Linear + Git + Flags        │
└─────────────┬───────────────────────────┘
              │
┌─────────────▼───────────────────────────┐
│          FLAGGING (Continuous)          │
│  Auto-flag struggling sessions          │
└─────────────┬───────────────────────────┘
              │
┌─────────────▼───────────────────────────┐
│          AGGREGATION (Batch)            │
│  Pattern review, hypothesis generation  │
└─────────────┬───────────────────────────┘
              │
┌─────────────▼───────────────────────────┐
│       REFINEMENT (Evidence-Triggered)   │
│  Update prompts based on evidence       │
└─────────────┬───────────────────────────┘
              │
┌─────────────▼───────────────────────────┐
│        VALIDATION (Post-Change)         │
│  Measure impact of changes              │
└─────────────┬───────────────────────────┘
              │
              └──────────► (back to top)
```

---

## Key Principle

**Don't theorize, measure.** Every prompt change should be:

1. Traceable to observed failures
2. Validated with outcome data
3. Documented with before/after metrics

Add new checks (risk assessment, smallest increment, etc.) only when evidence shows they're needed, not because they seem like good ideas.

---

## Related Files

| File | Purpose |
|------|---------|
| `lib/prompts/meta-prompt-template.js` | Decision tree for prompt selection |
| `lib/prompt-templates.js` | Individual prompt templates |
| `lib/completion-signals.js` | Completion signal definitions |
| `lib/workflow-config.js` | Label definitions |

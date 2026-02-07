# Prompt Template Audit Report

**Date:** 2026-01-21
**Issue:** LIN-94
**Templates Audited:** 14 (meta-prompt excluded)

## Executive Summary

Audit of all 14 prompt templates identified **8 universal issues** affecting most templates and **28 template-specific improvements**. The templates have strong foundations (good markdown structure, logical flow) but share common weaknesses in role definition, output specification, and workflow consistency.

**Overall Scores by Template:**

| Template | Avg Score | Category |
|----------|-----------|----------|
| triage | 4.3/5 | Universal |
| plan | 3.9/5 | Ready |
| context | 3.9/5 | Universal |
| code-review | 3.4/5 | Ready |
| blocked | 3.4/5 | Work Issues |
| look-into | 3.6/5 | Universal |
| bug | 3.3/5 | Work Issues |
| breakdown | 3.6/5 | Universal |
| research | 3.3/5 | Universal |
| scoping | 3.1/5 | Universal |
| design | 3.4/5 | Universal |
| review | 3.4/5 | Universal |
| implementation | 3.3/5 | Universal |
| spike | 3.0/5 | Universal |

---

## Phase 3: Universal Improvements

These patterns affect most or all templates and should be addressed systematically.

### U1: Add Explicit Role Definition (HIGH PRIORITY)

**Issue:** No templates define an explicit role/persona for the AI.

**Impact:** Without role framing, the AI lacks context for decision-making authority and expertise level.

**Recommendation:** Add role statement to each template's Goal section:
```markdown
## Goal
**Role**: Act as a [role] with [authority level].
```

**Examples:**
- `blocked`: "Act as a technical analyst diagnosing work impediments"
- `plan`: "Act as an implementation engineer planning and executing code changes"
- `triage`: "Act as a project coordinator with authority to update task metadata"
- `code-review`: "Act as a code reviewer ensuring quality before merge"

---

### U2: Fix Workflow Step 4 Contradiction (HIGH PRIORITY)

**Issue:** Many templates have Workflow Step 4 saying "Add findings as a comment" but the Goal/Output section requires updating the Description.

**Affected Templates:** research, scoping, design, implementation

**Impact:** Contradictory instructions cause confusion about where to put output.

**Recommendation:** Standardize Workflow Step 4 based on template purpose:
- **Comment-only templates** (look-into, context, blocked, bug, spike): Keep as "Add findings as a comment"
- **Description-update templates** (scoping, design, plan): Change to "Update issue description with [X]"
- **Dual-output templates** (research): "Add exploration notes as comment, update description with key findings"

---

### U3: Remove Inappropriate Status Changes (MEDIUM PRIORITY)

**Issue:** Several read-only or quick-review templates change issue status to "In Progress" which may be inappropriate.

**Affected Templates:** look-into, context, review

**Impact:** Side effect of status change doesn't match intent of quick overview or review.

**Recommendation:**
- `look-into`: Remove Step 1 entirely (quick overview shouldn't change status)
- `context`: Make conditional ("if doing substantial work")
- `review`: Remove entirely (review shouldn't change the status of work being reviewed)

---

### U4: Add Output Format Specification (MEDIUM PRIORITY)

**Issue:** Many templates ask for deliverables but don't specify format (bullets, prose, length, structure).

**Affected Templates:** look-into, triage, breakdown, research, scoping, design, review

**Impact:** Inconsistent output quality and structure.

**Recommendation:** Add explicit format guidance:
```markdown
### Output Format
Structure your [deliverable] as:
- **Section 1**: [what goes here]
- **Section 2**: [what goes here]
Length: [X paragraphs / bullet points]
```

---

### U5: Populate Completion Signals (MEDIUM PRIORITY)

**Issue:** Only `blocked` and `bug` templates have `completionSignals` defined. All others have `null`.

**Affected Templates:** All except blocked, bug

**Impact:** AI cannot assess when task is truly complete.

**Recommendation:** Define completion signals for each template:
```javascript
completionSignals: {
  coreOutcome: '[What must be achieved]',
  signals: ['Signal 1', 'Signal 2'],
  readinessCheck: '[Question to verify completion]'
}
```

---

### U6: Standardize Context Sections (LOW PRIORITY)

**Issue:** `spike` template is missing Parent Task, Sibling Tasks, and Subtasks that other templates include.

**Affected Templates:** spike

**Impact:** Inconsistent context availability.

**Recommendation:** Add full context section to spike template matching other templates.

---

### U7: Remove Vague "Analyze" Workflow Step (LOW PRIORITY)

**Issue:** "Analyze: Complete the goal below" adds no value and is redundant.

**Affected Templates:** Multiple (in various forms)

**Impact:** Wastes tokens and adds no clarity.

**Recommendation:** Remove or replace with specific action verbs like "Synthesize", "Evaluate", "Investigate".

---

### U8: Add Escalation/Failure Path (LOW PRIORITY)

**Issue:** No templates specify what to do when the AI cannot complete the task (blockers, insufficient information, needs human decision).

**Impact:** AI may get stuck or make assumptions when it should escalate.

**Recommendation:** Add to templates where applicable:
```markdown
### If Unable to Complete
- Document specific blockers or missing information
- Add comment flagging items requiring human input
- Do NOT make assumptions on critical decisions
```

---

## Phase 4: Template-Specific Improvements

### Work Issues Category

#### blocked (Score: 3.4/5)

| Issue | Severity | Improvement |
|-------|----------|-------------|
| Missing blocker description section | High | Add "## Current Blocker" section with Type, Description, Since, Impact fields |
| No severity/priority assessment | Medium | Add severity classification (P0-P3) guidance |
| No escalation path | Medium | Add guidance for when blocker cannot be resolved internally |
| Sample discussion doesn't show actual blocker | Low | Update mock data to demonstrate blocking scenario |

#### bug (Score: 3.3/5)

| Issue | Severity | Improvement |
|-------|----------|-------------|
| Missing environment/reproduction context | High | Add "## Bug Details" section with Observed/Expected/Environment/Reproduction Rate |
| No severity classification | High | Add P0-P3 severity assessment guidance |
| Missing root cause confirmation step | Medium | Add explicit step between hypothesis and fix proposal |
| Sample title is feature, not bug | Low | Change sample to actual bug description |

---

### Ready Category

#### plan (Score: 3.9/5)

| Issue | Severity | Improvement |
|-------|----------|-------------|
| Redundant title ("Implement" twice) | Medium | Change header to "# LIN-123: [title]" |
| Missing plan format specification | Medium | Add explicit template for what plan should look like |
| Orphaned subtask summary line | Low | Move to Context section |
| Scope Control redundancy | Low | Consolidate duplicate "minimal and focused" text |

#### code-review (Score: 3.4/5)

| Issue | Severity | Improvement |
|-------|----------|-------------|
| No code location (branch/PR/commit) | High | Add to Context: Branch, PR#, Files Changed |
| Generic checklist items | Medium | Add severity levels (Blocking/Non-blocking) to each item |
| No output format for findings | Medium | Add structured format: Summary, Blocking Issues, Suggestions, Verdict |
| Missing specific security checks | Low | Add input validation, auth, secrets, injection checks |

---

### Universal Category

#### look-into (Score: 3.6/5)

| Issue | Severity | Improvement |
|-------|----------|-------------|
| No output format specification | Medium | Add structured format with length guidance |
| Status change inappropriate | Medium | Remove "Set to In Progress" step |
| Missing depth guidance | Low | Specify this is quick overview, not deep dive |

#### triage (Score: 4.3/5)

| Issue | Severity | Improvement |
|-------|----------|-------------|
| Missing assignee handling | Medium | Add assignee review to Metadata Checklist |
| No "no changes needed" guidance | Low | Add confirmation path when triage finds nothing to change |

#### breakdown (Score: 3.6/5)

| Issue | Severity | Improvement |
|-------|----------|-------------|
| Workflow step 4 mismatch | High | Change from "Add findings as comment" to "Create subtasks and relations" |
| No granularity guidance | Medium | Add guidance: 3-7 subtasks, each ~1-4 hours of work |
| Missing subtask template | Medium | Add example format for good subtask title/description |

#### research (Score: 3.3/5)

| Issue | Severity | Improvement |
|-------|----------|-------------|
| Workflow/Output contradiction | High | Clarify dual output: comment for notes, description for findings |
| No research methodology | Medium | Add structured process: identify questions, consult sources, document |
| Missing completion criteria | Medium | Define when research is "done" |

#### scoping (Score: 3.1/5)

| Issue | Severity | Improvement |
|-------|----------|-------------|
| Critical workflow contradiction | High | Fix Step 4 to say "Update description" not "Add comment" |
| No conflict resolution guidance | Medium | Add handling for contradictory requirements |
| Success criteria format undefined | Low | Specify checkbox format for criteria |

#### design (Score: 3.4/5)

| Issue | Severity | Improvement |
|-------|----------|-------------|
| Workflow/Output contradiction | High | Clarify dual output like research template |
| No decision framework | Medium | Add tiebreaker criteria when approaches are equal |
| Missing constraints section | Medium | Add consideration of codebase patterns, performance, timeline |

#### spike (Score: 3.0/5)

| Issue | Severity | Improvement |
|-------|----------|-------------|
| Sparse context section | High | Add Parent Task, Sibling Tasks, Subtasks |
| No timebox guidance | High | Add explicit timebox section with enforcement guidance |
| Goal statement contradiction | Medium | Restructure into Frame/Explore/Conclude phases |

#### context (Score: 3.9/5)

| Issue | Severity | Improvement |
|-------|----------|-------------|
| Status change may be inappropriate | Medium | Make conditional or remove |
| Missing git command specifics | Low | Add specific git log commands |
| No conflict resolution guidance | Low | Add handling for contradictory discussion history |

#### implement (Score: 3.3/5)

| Issue | Severity | Improvement |
|-------|----------|-------------|
| Duplicate Scope Control text | Medium | Remove duplicate "minimal and focused" |
| Workflow step 4 misleading | Medium | Change to reflect commit + test + comment workflow |
| No commit guidance | Medium | Add commit message format with issue reference |
| Missing verification section | Medium | Add explicit test-run instructions |

#### review (Score: 3.4/5)

| Issue | Severity | Improvement |
|-------|----------|-------------|
| Status change inappropriate | High | Remove "Set to In Progress" for review |
| Generic checklist items | Medium | Expand with specific criteria and severity levels |
| Missing verdict format | Medium | Add Approved/Changes Requested/Needs Discussion options |
| Missing Subtasks in context | Low | Add for completeness verification |
| No failure path guidance | Low | Add what to do if review fails |

---

## Phase 5: Utility and Side Effects Review

### High-Utility Improvements (Implement First)

1. **U1 - Role Definition**: Minimal code change, high clarity impact
2. **U2 - Workflow Step 4 Fix**: Resolves confusion, prevents incorrect behavior
3. **U3 - Status Change Removal**: Prevents unintended side effects
4. **Spike timebox guidance**: Critical for spike template to function correctly
5. **Code-review code location**: Essential for template to be usable

### Potential Side Effects

| Improvement | Risk | Mitigation |
|-------------|------|------------|
| Removing status changes | Existing workflows may expect status update | Document behavior change |
| Adding role definitions | May conflict with system prompt | Keep roles generic, avoid authority conflicts |
| Changing output targets | Users may expect comments only | Update documentation alongside |
| Adding completion signals | AI may over-rely on signals | Keep signals as guidance, not hard requirements |

### Low-Priority / Consider Skipping

1. **Sample data improvements**: Nice-to-have but doesn't affect production prompts
2. **Consolidating minor redundancy**: Token savings minimal, change risk not worth it

---

## Implementation Recommendations

### Phase A: Quick Wins (Low Risk, High Impact)
1. Add role definitions to all templates
2. Fix workflow step 4 contradictions
3. Remove inappropriate status changes from look-into, context, review

### Phase B: Structural Improvements
1. Add output format specifications
2. Populate completion signals for remaining templates
3. Add missing context sections to spike

### Phase C: Template-Specific Enhancements
1. Work through template-specific improvements by severity
2. Focus on high-severity items first
3. Test each change with sample prompts

---

## Appendix: Scoring Criteria

| Criterion | Description | Weight |
|-----------|-------------|--------|
| Structure | Clear sections, logical flow, markdown formatting | 1x |
| Clarity | Unambiguous instructions, specific action verbs | 1x |
| Context Placement | Relevant context provided before instructions | 1x |
| Output Specification | Clear expected deliverables/format | 1x |
| Role Definition | Appropriate framing for task type | 1x |
| Token Efficiency | No redundant text, concise | 1x |
| Completeness | All necessary information present | 1x |

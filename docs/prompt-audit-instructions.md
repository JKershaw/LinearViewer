# Prompt Audit Instructions

A repeatable process for auditing AI prompt templates against best practices.

## When to Run an Audit

- After adding new prompt templates
- After significant changes to existing templates
- Periodically (quarterly recommended)
- When AI recommendation quality degrades

## Prerequisites

```bash
npm install  # Ensure dependencies are installed
```

## Step 1: Extract Prompts

Use the audit script to extract all templates:

```bash
# View summary of all templates
node scripts/audit-prompts.js --summary

# Export all templates as JSON (for programmatic analysis)
node scripts/audit-prompts.js --json > /tmp/all-prompts.json

# View a specific template
node scripts/audit-prompts.js <template-key>
# Example: node scripts/audit-prompts.js blocked
```

### Available Templates

| Key | Name | Category |
|-----|------|----------|
| blocked | blocked | Work Issues |
| bug | bug | Work Issues |
| plan | plan | Ready |
| code-review | code review | Ready |
| look-into | look into | Universal |
| triage | triage | Universal |
| breakdown | breakdown | Universal |
| research | research | Universal |
| scoping | scoping | Universal |
| design | design | Universal |
| spike | spike | Universal |
| context | context | Universal |
| implementation | implement | Universal |
| review | review | Universal |

## Step 2: Evaluate Each Template

For each template, score against these 7 criteria (1-5 scale):

### Evaluation Criteria

| Criterion | Score 1 | Score 3 | Score 5 |
|-----------|---------|---------|---------|
| **Structure** | No clear sections | Some sections, inconsistent | Clear hierarchy, logical flow, proper markdown |
| **Clarity** | Vague, ambiguous | Mostly clear, some ambiguity | Unambiguous, specific action verbs |
| **Context Placement** | Context after/mixed with instructions | Partial context before | All relevant context before instructions |
| **Output Specification** | No deliverables specified | Implicit deliverables | Explicit format, length, structure |
| **Role Definition** | No role framing | Implicit role | Explicit persona with authority level |
| **Token Efficiency** | Significant redundancy | Minor redundancy | Concise, no wasted tokens |
| **Completeness** | Missing critical info | Most info present | All necessary information included |

### Scoring Template

```markdown
## [template-key] - [Template Name]

### Scores

| Criterion | Score | Notes |
|-----------|-------|-------|
| Structure | X/5 | |
| Clarity | X/5 | |
| Context Placement | X/5 | |
| Output Specification | X/5 | |
| Role Definition | X/5 | |
| Token Efficiency | X/5 | |
| Completeness | X/5 | |
| **Average** | X.X/5 | |

### Issues Found
1. [Issue description]
2. [Issue description]

### Improvement Suggestions
1. [Specific, actionable improvement]
2. [Specific, actionable improvement]
```

## Step 3: Identify Patterns

After evaluating all templates, look for:

### Universal Issues
Issues affecting multiple templates that should be fixed systematically:
- Missing role definitions across all templates
- Inconsistent workflow step wording
- Missing completion signals

### Template-Specific Issues
Issues unique to individual templates:
- Wrong workflow for template purpose
- Missing template-specific context

## Step 4: Prioritize Improvements

Categorize each improvement:

| Priority | Criteria | Action |
|----------|----------|--------|
| **HIGH** | Causes incorrect behavior, affects many templates | Fix immediately |
| **MEDIUM** | Reduces quality, moderate impact | Fix in next sprint |
| **LOW** | Minor improvement, cosmetic | Fix when convenient |

### Utility vs Side Effects

For each improvement, assess:

1. **Utility**: Will this actually improve outcomes?
   - Does it fix a real problem?
   - Is the improvement measurable?

2. **Side Effects**: Could this break existing workflows?
   - Does it change expected behavior?
   - Are there dependent systems?

## Step 5: Document Findings

Update `docs/prompt-audit-report.md` with:

1. **Executive Summary**: Overall scores, key findings
2. **Universal Improvements**: Patterns across templates
3. **Template-Specific Improvements**: Per-template issues
4. **Prioritized Recommendations**: What to fix first

## Step 6: Create Subtasks

For each improvement, create a Linear subtask:

```bash
# Example: Create improvement subtask via the workspace API proxy
curl -s -X POST "$PROXY_BASE/api/proxy/issues" \
  -H "Authorization: Bearer $PROXY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "U1: Add role definitions",
    "description": "**Priority:** HIGH\n\n**Issue:** [description]\n\n**Unvalidated idea (optional):** [idea]\n\n**Acceptance Criteria:**\n- [ ] Criteria 1\n- [ ] Criteria 2",
    "parentId": "<parent-issue-id>",
    "projectId": "<project-id>"
  }'
```

## Step 7: Implement and Verify

After implementing changes:

```bash
# Re-run audit script to verify improvements
node scripts/audit-prompts.js <template-key>

# Compare before/after scores
```

## Auditing the Stage Router

The routing prompt (`buildRouterPrompt` in `lib/stage-router.js`, LIN-3300) chooses the stage; it writes no prompt. Code then assembles that stage's prompt from the handwritten template, so the template audit above covers the prompt the agent reads. The router needs its own check:

### Additional Criteria for the Router

| Criterion | What to Check |
|-----------|---------------|
| Rule Order | Do the numbered "How to choose" rules (`SELECTOR_RULES`) take the right case first? |
| Rules vs Stage Descriptions | Does each rule only relate stages? When a stage applies belongs to the stage's own description (`route`), said once |
| Facts | Does the ticket view and the trail facts (`lib/recommendation-facts.js`) carry what each rule reads? |
| Reply Contract | Does `routeStage` parse every reply form the prompt allows, and refuse out-of-list kinds? |

### Router Specific Checks

1. **Stage List**
   - Does every selectable stage appear with its own description (`formatStageOptions`)?
   - Do the stage descriptions match what the templates actually do?

2. **Rules**
   - Does each rule carry its reason, and does its ticket reference in the source comment still hold?
   - Do the rules contradict a stage description?

3. **Output Format**
   - Is the `## Reasoning` reply format clearly specified?
   - Is a stray `## Prompt` section dropped rather than used?

The rendered routing prompt for sample data is on the Prompts page (Stage Router section) and in `scripts/eval/meta-prompt.baseline.txt` (file name kept from before LIN-3300).

## Quick Reference

### Run Full Audit
```bash
# 1. Export all prompts
node scripts/audit-prompts.js --json > /tmp/all-prompts.json

# 2. Review each template (or use AI assistant)
# 3. Document in docs/prompt-audit-report.md
# 4. Create subtasks for improvements
# 5. Implement and verify
```

### Common Issues Checklist

- [ ] All templates have role definitions
- [ ] Workflow steps match template purpose
- [ ] Output format is specified
- [ ] Completion signals are defined
- [ ] No contradictions between sections
- [ ] Context appears before instructions
- [ ] No redundant text

## Version History

| Date | Auditor | Templates | Key Changes |
|------|---------|-----------|-------------|
| 2026-01-21 | Claude | 14 | Initial audit, identified 8 universal + 28 specific improvements |

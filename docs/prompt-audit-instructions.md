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
| blocked | Blocker Analysis | Work Issues |
| bug | Bug Investigation | Work Issues |
| plan | Implementation Plan | Ready |
| code-review | Code Review | Ready |
| look-into | Look Into | Universal |
| triage | Task Triage | Universal |
| breakdown | Task Breakdown | Universal |
| research | Research Task | Universal |
| scoping | Scope Definition | Universal |
| design | Technical Design | Universal |
| spike | Technical Spike | Universal |
| context | Context Summary | Universal |
| implementation | Implementation Guide | Universal |
| review | Review Checklist | Universal |

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
# Example: Create improvement subtask
node lib/linear-cli.js create-issue <team-id> "U1: Add role definitions" --stdin << 'EOF'
{
  "description": "**Priority:** HIGH\n\n**Issue:** [description]\n\n**Solution:** [solution]\n\n**Acceptance Criteria:**\n- [ ] Criteria 1\n- [ ] Criteria 2",
  "parentId": "<parent-issue-id>",
  "projectId": "<project-id>"
}
EOF
```

## Step 7: Implement and Verify

After implementing changes:

```bash
# Re-run audit script to verify improvements
node scripts/audit-prompts.js <template-key>

# Compare before/after scores
```

## Auditing the Meta-Prompt

The meta-prompt (`lib/prompts/meta-prompt-template.js`) requires special attention:

### Additional Criteria for Meta-Prompt

| Criterion | What to Check |
|-----------|---------------|
| Decision Tree Logic | Is the sequential workflow correct? |
| Completion Signal Usage | Are signals referenced appropriately? |
| Template References | Do aiHints match actual templates? |
| Edge Case Handling | Are ambiguous situations covered? |

### Meta-Prompt Specific Checks

1. **Decision Tree Correctness**
   - Does Step 1 (preparation) correctly identify unready tasks?
   - Does Step 2 (blockers/bugs) correctly identify work issues?
   - Does Step 3 (implementation) correctly gate on readiness?

2. **Consistency with Templates**
   - Does "Comments vs Description" guidance match template behavior?
   - Do label management rules match template expectations?

3. **Output Format**
   - Is the Reasoning/Prompt format clearly specified?
   - Are examples consistent with what templates generate?

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

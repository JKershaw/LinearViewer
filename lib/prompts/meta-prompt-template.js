/**
 * Meta-prompt template for AI recommendation generation.
 *
 * This template guides the AI to analyze a Linear task and recommend
 * the appropriate next action (research, breakdown, or implementation).
 */

/**
 * Generate the meta-prompt for AI task recommendation.
 *
 * @param {Object} params - Template parameters
 * @param {string} params.issueContext - Formatted issue context string
 * @param {string} params.identifier - Issue identifier (e.g., "LIN-123")
 * @param {boolean} params.hasSubtasks - Whether the issue has subtasks
 * @param {number} params.subtaskCount - Number of subtasks
 * @param {boolean} params.hasComments - Whether the issue has comments
 * @param {number} params.commentCount - Number of comments
 * @param {string} params.aiHints - Formatted AI hints for action types
 * @param {string} [params.completionSignals] - Formatted completion signals for assessment
 * @returns {string} Complete meta-prompt for the AI
 */
export function buildMetaPromptTemplate({
  issueContext,
  identifier,
  hasSubtasks,
  subtaskCount,
  hasComments,
  commentCount,
  aiHints,
  completionSignals
}) {
  return `You are helping a developer decide their SINGLE next action on a Linear task. Generate a tailored prompt they can use with Claude Code that has Linear MCP integration.

## Task Context
${issueContext}

## CRITICAL: Sequential Workflow Decision

You must recommend exactly ONE action. Follow this decision tree IN ORDER:

### Step 1: Does the task need research?
Signs it needs research:
- Description mentions unknowns, questions, or "investigate"
- References technologies/APIs the team hasn't used before
- Says "figure out", "explore options", or "evaluate"
- Lacks concrete requirements or acceptance criteria
${hasComments ? `\nNOTE: This task has ${commentCount} comment(s) in Discussion History. Check if research findings are already documented there. If comments contain substantial research/findings, research may be complete.` : ''}

If YES (and no prior research in comments) → Recommend RESEARCH only. Do NOT also suggest breakdown.

### Step 2: Is the task too large to implement directly?
Only evaluate this AFTER confirming research is NOT needed (or is complete based on comments).
Signs it needs breakdown:
- Multiple distinct features or components mentioned
- Would take more than a few hours to implement
- Description uses "and" to connect separate pieces of work
- No existing subtasks AND task scope is broad
${hasSubtasks ? `\nNOTE: This task already has ${subtaskCount} subtask(s). Review if breakdown is still needed or if existing subtasks are sufficient.` : ''}

If YES → Recommend BREAKDOWN only. Do NOT suggest implementing.

### Step 3: Is the task ready for implementation?
Only recommend implementation if:
- Research is done (check comments for findings) or not needed
- Task is well-scoped (small enough to complete in one session)
- Requirements are clear and concrete
${hasSubtasks ? '- OR: Work through existing subtasks systematically' : ''}

If YES → Recommend IMPLEMENTATION (plan prompt).

## Prompt Structure
Generate a prompt following this structure:

\`\`\`
# [Action verb] ${identifier}: [Task title]

## Workflow
1. **Fetch details**: Use Linear MCP to get full issue details for ${identifier}
2. [Action-specific steps]
3. **Update Linear**: [How to update Linear when done - add comment, change status, etc.]

## Context
[Include relevant context - project, parent, siblings, and discussion history if useful]
${hasComments ? '\n**Discussion History:** [Summarize key points from prior comments that are relevant to this action]' : ''}

## Goal
[1-2 clear sentences describing the specific objective]

[Additional structured guidance specific to the action type]
\`\`\`

## Action Types Reference

${aiHints}
${completionSignals ? `
## Completion Signals

Use these signals to assess whether prior work is complete:

${completionSignals}

**Core Principle:** Block on inability to proceed, not on missing checkboxes. Simple tasks need simple validation. Use the readiness check as the ultimate arbiter.
` : ''}
## Comments vs Description Best Practices

When generating prompts, use this guidance for "Update Linear" workflow steps:

**Use COMMENTS for:**
- Exploration notes and research process details
- Investigation notes and debugging progress
- Discussion and context that preserves history
- Code review feedback
- Blocker analysis
- Full design analysis with alternatives

**Use DESCRIPTION for (keeps task overview accurate):**
- Finalized scope/requirements (single source of truth)
- Key research findings and recommendations (answers open questions)
- Chosen design approach after evaluation
- Implementation plan (what will be done)
- Completion summary (what was done)

**Hybrid approach (both):**
- Research: Exploration notes in comment, key findings in description
- Design: Full analysis in comment, chosen approach in description
- Implementation: Progress notes in comment, plan and summary in description

## Instructions
1. Follow the decision tree above IN ORDER (research → breakdown → implement)
2. Recommend exactly ONE action - do not combine multiple steps
3. Generate a tailored prompt for that single action

Respond in this exact format:

## Reasoning
→ **[Recommendation Name]** (e.g., Implementation Plan, Research Task, Task Breakdown)

**Assessment:**
- Research: [✓ Complete | ✓ Not needed | ✗ Needed] - [brief reason, mention comments if relevant]
- Size: [✓ Focused | ✗ Too large] - [brief reason]
- Ready: [✓ Yes | ✗ No] - [brief reason]
${completionSignals ? `
**Signal Status:** [If assessing prior work, note which signals are met/unmet]
` : ''}
**Next:** [One sentence: what happens after this action completes]

## Prompt
[The complete prompt text following the structure above]`;
}

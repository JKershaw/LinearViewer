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
 * @param {number} params.completedCount - Number of completed subtasks
 * @param {number} params.inProgressCount - Number of in-progress subtasks
 * @param {number} params.remainingCount - Number of remaining (non-completed) subtasks
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
  completedCount,
  inProgressCount,
  remainingCount,
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

**Check if research is already COMPLETE:**

First, distinguish between description quality and verification evidence:
- **Description quality:** Detailed, specific, sounds thorough (NOT sufficient to skip research)
- **Verification evidence:** Proof that code was actually examined (REQUIRED to skip research)

Look for VERIFICATION EVIDENCE, not just plausible descriptions:
- Specific file paths or line numbers from the codebase (e.g., "found in src/auth.js:42")
- Code snippets or function names discovered through investigation
- Explicit statements like "searched for X, found Y" or "verified in [file]"
- References to actual code structure that could only come from examination
${hasComments ? `- Do comments (${commentCount} total) contain concrete findings from codebase exploration?` : ''}

**CRITICAL:** A detailed description WITHOUT verification evidence means research is NEEDED.
Plausible-sounding descriptions can be entirely based on assumptions that haven't been validated.

**Distinguish task TYPE from task CONTENT:**
- A task that NEEDS research: has open questions, unknowns, or "figure out X"
- A task that DESCRIBES a feature about questions: defines what "answered" looks like, specifies behavior for handling unknowns
- Pure feature specs (behavioral requirements, not code claims) may not need code verification
- Implementation specs that CLAIM specific code structure need verification evidence

**Signs research may be needed (evaluate in context):**
- Description makes claims about code structure without citing sources
- Approach assumes specific files/functions exist without verification
- Open questions without documented answers
- Uncertainty about approach with no recorded decision
- References to unfamiliar technologies without prior investigation
- Vague requirements that need clarification before implementation

Note: The principle is "if you claim to know what the code looks like, show your work."
Pure behavioral specs don't need code verification; claims about code structure do.

If research is COMPLETE → Skip to Step 2
If research is NEEDED → Recommend RESEARCH only

### Step 2: Is the task too large to implement directly?
Only evaluate this AFTER confirming research is NOT needed (or is complete based on comments).
Signs it needs breakdown:
- Multiple distinct features or components mentioned
- Would take more than a few hours to implement
- Description uses "and" to connect separate pieces of work
- No existing subtasks AND task scope is broad
${hasSubtasks ? `\nNOTE: This task has ${subtaskCount} subtask(s): ${completedCount} done, ${inProgressCount} in progress, ${remainingCount} remaining.${remainingCount === 0 ? ' All subtasks complete - consider closing parent.' : inProgressCount > 0 ? ' Continue in-progress subtasks before starting new work.' : ''}` : ''}

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
1. **Start**: Use Linear MCP to set ${identifier} status to "In Progress" (if not already)
2. **Fetch details**: Use Linear MCP to get full issue details for ${identifier}
3. [Action-specific steps]
4. **Update Linear**: [How to update Linear when done - add comment, change status/labels, etc.]

Note: Omit "Start" step for universal actions (look-into, triage) that don't change status.

## Context
[Include relevant context - project, parent, siblings, and discussion history if useful]
${hasComments ? '\n**Discussion History:** [Summarize key points from prior comments that are relevant to this action]' : ''}

## Goal
[1-2 clear sentences describing the specific objective]

## Label Lifecycle (include for phase-based actions)

**At start**: Ensure \`[label-name]\` label is on ${identifier}
**Readiness check**: [Use completion signal readiness check for this action type]
**When complete**: Remove \`[label-name]\` label from ${identifier} via Linear MCP

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

## Linear State Management

**Status changes:**
- Phase actions (research, breakdown, scoping, design, spike, context): Set "In Progress" at start
- Ready actions (plan/implementation): Set "In Progress" at start, may set "Done" at completion
- Work-issue actions (blocked, bug): No status change at start
- Universal actions (look-into, triage): No status changes

**Label lifecycle:**
Include a Label Lifecycle section when recommending phase-based actions (in-research, in-breakdown, in-scoping, in-design, in-spike, in-context, in-implementation, in-review) or work-issue actions (blocked, bug). This ensures the label is present at start and removed when work is complete.

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

/**
 * Prompt Formatting Helpers
 *
 * Reusable formatting functions used by prompt templates.
 * Handles formatting of issue context (siblings, children, parents,
 * comments, labels, projects) and workflow/structural sections.
 */

import { COMPLETION_SIGNALS } from './completion-signals.js';
import { WORK_ISSUE_LABELS, VIRTUAL_PROMPTS } from './workflow-config.js';
import { isTerminalState, selectFocusSubtask, computeFrontierFacts } from './recommendation-facts.js';
import { STARTED } from './providers/models.js';

// Re-export for convenience (templates need these)
export { COMPLETION_SIGNALS, WORK_ISSUE_LABELS, VIRTUAL_PROMPTS };

/**
 * Template categories for prompt availability rules
 */
export const PROMPT_CATEGORIES = {
  PRE_WORK: 'pre-work',    // Task not ready, needs preparation
  WORK_ISSUE: 'work-issue', // Issue during active work
  READY: 'ready',          // Task ready for implementation
  UNIVERSAL: 'universal'   // Available for all issues
};

/**
 * Format sibling issues for display in prompt
 * @param {Array} siblings - Array of sibling issues
 * @returns {string} Formatted sibling list or empty string if none
 */
export function formatSiblings(siblings) {
  if (!siblings || siblings.length === 0) {
    return ''
  }
  return siblings
    .map(s => {
      const status = s.state?.name || 'Unknown'
      return `- ${s.identifier}: "${s.title}" (${status})`
    })
    .join('\n')
}

/**
 * Format existing children for display in prompt
 * @param {Array} children - Array of child issues
 * @returns {string} Formatted children summary or empty string if none
 */
export function formatChildren(children) {
  if (!children || children.length === 0) {
    return ''
  }
  return children
    .map(c => {
      const status = c.state?.name || 'Unknown'
      return `- ${c.identifier}: "${c.title}" (${status})`
    })
    .join('\n')
}

/**
 * Format subtask summary with progress and recommended next action.
 * Provides a dense one-line summary instead of verbose guidance.
 *
 * The recommended next child comes from the shared `selectFocusSubtask` picker
 * (LIN-433), NOT from input order — so the advertised child is the same one the
 * recommendation descent enters (skip-blocked, frontier-ranked) and the prompt can
 * never advertise a different child than the descent picks. A second FRONTIER FACTS
 * line surfaces the deterministic child-derived facts (open count, blocked count)
 * so the model stops re-deriving them at the defer-vs-breakdown fork; this mirrors
 * the meta-prompt block per the both-paths rule (docs/prompt-change-validation.md).
 *
 * @param {Array} children - Array of child issues
 * @returns {string} Dense summary lines or empty string if no children
 */
export function formatSubtaskSummary(children) {
  if (!children || children.length === 0) {
    return ''
  }

  const total = children.length
  const completedCount = children.filter(c => isTerminalState(c.state?.type)).length
  const inProgressCount = children.filter(c => c.state?.type === STARTED).length

  let line = `**Subtasks:** ${completedCount}/${total} done`

  if (inProgressCount > 0) {
    line += `, ${inProgressCount} in progress`
  }

  // Recommended next child via the shared picker (aligns with the descent's pick).
  const nextChild = selectFocusSubtask(children)

  if (nextChild) {
    const action = nextChild.state?.type === STARTED ? 'Continue' : 'Next'
    line += ` → ${action}: ${nextChild.identifier}`
  }

  const facts = formatFrontierFacts(children)
  return line + '\n' + (facts ? facts + '\n' : '')
}

/**
 * Render the deterministic FRONTIER FACTS line from child-derived signals
 * (LIN-433). Shared by the handwritten path (formatSubtaskSummary) and the
 * meta-prompt path so both advertise the same open/blocked counts and the same
 * next child the descent picks. Omitted when there are no open children (the node
 * is complete — a different, terminal-state branch handles that).
 *
 * @param {Array} children - Array of child issues
 * @returns {string} A single FRONTIER FACTS line, or '' when there are no open children
 */
export function formatFrontierFacts(children) {
  const facts = computeFrontierFacts(children)
  if (!facts || facts.openCount === 0) return ''
  const blocked = facts.blockedCount > 0 ? `${facts.blockedCount} blocked` : 'none blocked'
  const next = facts.nextChild ? `, next frontier child ${facts.nextChild}` : ''
  return `**Frontier facts:** ${facts.openCount} open child(ren), ${blocked}${next}`
}

/**
 * Format comments for display in prompt
 * Shows comment body, author, and date
 * @param {Array} comments - Array of comment objects with body, user, createdAt
 * @returns {string} Formatted comments or empty string if none
 */
export function formatComments(comments) {
  if (!comments || comments.length === 0) {
    return ''
  }

  return comments
    .map(c => {
      const date = new Date(c.createdAt).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      })
      // Indent multi-line comment bodies for readability
      const body = c.body.split('\n').map((line, i) => i === 0 ? line : `  ${line}`).join('\n')
      return `**${c.user}** (${date}):\n${body}`
    })
    .join('\n\n')
}

/**
 * Reference the task's description and discussion instead of embedding them.
 *
 * Pass-by-reference: the generated prompt is an INSTRUCTION that points at the
 * task, not a copy of it. The executing agent reads the current description and
 * comment thread directly (from the task's brief, Linear, or its own access) —
 * keeping prompts short for long-lived tasks with large descriptions and many
 * comments, and ensuring the agent works from live content rather than a
 * possibly-stale snapshot baked into the prompt.
 *
 * Mechanism-agnostic by design: it never names HOW the agent reaches the task.
 * When Linear references are disabled (linearMcp=false) the " in Linear" suffix
 * is omitted (and any stray one is stripped downstream by generatePrompt),
 * leaving a bare "read the current description and comment thread".
 *
 * NOTE: Mirrored in the AI meta-prompt path (lib/prompts/meta-prompt-template.js
 * → Prompt Structure "## Context"). Per CLAUDE.md, prompt-behavior changes must
 * be applied to BOTH the handwritten and AI-generated paths.
 *
 * @param {Object} issue - Issue object with identifier
 * @param {Object} [options] - Options
 * @param {boolean} [options.useLinear=true] - Whether to include the "in Linear" reference
 * @returns {string} Reference directive line
 */
export function formatDiscussionReference(issue, { useMcp, useLinear } = {}) {
  const includeLinear = useLinear ?? useMcp ?? true
  const identifier = issue?.identifier || 'this task'
  const linear = includeLinear ? ' in Linear' : ''
  return `**Read before acting:** This prompt is an instruction, not a copy of the task. It does not restate ${identifier}'s description or discussion — read the current description and comment thread${linear} first, since they are the source of truth and may have moved on since this prompt was written.`
}


/**
 * Format project info consistently
 * @param {Object|null} project - Project object with name and description
 * @returns {string} Formatted project name
 */
export function formatProject(project) {
  if (!project) return 'Unknown'
  return project.name
}

/**
 * Parse repo name from a project description.
 * Looks for a line matching `repo=<value>` (case-sensitive key, any line position).
 * @param {string|null} description - Project description text
 * @returns {string|null} Repo name or null if not found
 */
export function parseRepoFromDescription(description) {
  if (!description) return null
  const match = description.match(/^repo=([^\r\n]+)$/m)
  return match ? match[1].trim() : null
}

/**
 * Slugify a value into a filesystem-safe token for download filenames.
 * Non-word characters collapse to single dashes; result is lower-cased.
 * @param {string} value - Raw value (identifier, prompt name, etc.)
 * @returns {string} Filesystem-safe slug (empty string if nothing usable)
 */
export function slugifyForFilename(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
}

/**
 * Build a `<identifier>-<promptName>.md` download filename for a prompt.
 * Both parts are slugified; the identifier is dropped when absent so the
 * name still produces a sensible file (e.g. `autopilot.md`).
 * @param {string} identifier - Issue identifier (e.g. LIN-316), may be empty
 * @param {string} promptName - Prompt name/label (e.g. "Retro")
 * @returns {string} A safe filename ending in `.md`
 */
export function buildPromptFilename(identifier, promptName) {
  const id = slugifyForFilename(identifier)
  const name = slugifyForFilename(promptName) || 'prompt'
  const base = id ? `${id}-${name}` : name
  return `${base}.md`
}

/**
 * Format labels excluding specified ones
 * @param {Array} labels - Array of label names
 * @param {Array} exclude - Labels to exclude
 * @returns {string} Formatted labels or empty string if none
 */
export function formatLabels(labels, exclude = []) {
  const filtered = (labels || []).filter(l => !exclude.includes(l))
  return filtered.length > 0 ? filtered.join(', ') : ''
}

/**
 * Format parent task info consistently
 * @param {Object|null} parent - Parent issue object
 * @returns {string} Formatted parent info or empty string if none
 */
export function formatParent(parent) {
  if (!parent) return ''
  return `${parent.identifier}: "${parent.title}" (${parent.state?.name || 'Unknown'})`
}

/**
 * Format a section with label and content, only if content exists
 * @param {string} label - Section label (e.g., "Parent Task")
 * @param {string} content - Section content
 * @returns {string} Formatted section or empty string if no content
 */
export function formatSection(label, content) {
  if (!content) return ''
  return `**${label}:** ${content}`
}

/**
 * Format a multi-line section with label and content, only if content exists
 * @param {string} label - Section label (e.g., "Sibling Tasks")
 * @param {string} content - Section content (multi-line)
 * @returns {string} Formatted section or empty string if no content
 */
export function formatMultiLineSection(label, content) {
  if (!content) return ''
  return `**${label}:**\n${content}`
}

/**
 * Format the prompt header with task identifier and title
 * @param {string} action - Action verb (e.g., "Implement", "Break down", "Research")
 * @param {Object} issue - Issue object with identifier and title
 * @returns {string} Formatted header
 */
export function formatHeader(action, issue) {
  return `# ${action} ${issue.identifier}: ${issue.title}`
}

/**
 * Generate workflow instructions based on prompt category
 * @param {string} category - The prompt category
 * @param {Object} issue - Issue object with identifier
 * @param {Object} [options] - Options
 * @param {boolean} [options.useLinear=true] - Whether to include Linear references in workflow steps
 * @returns {string} Workflow section or empty string
 */
export function formatWorkflow(category, issue, { useMcp, useLinear } = {}) {
  const identifier = issue.identifier
  // Support legacy useMcp parameter, prefer useLinear
  const includeLinear = useLinear ?? useMcp ?? true
  const linear = includeLinear ? ' in Linear' : ''

  // Universal prompts: start, fetch details, add findings as comment
  if (category === PROMPT_CATEGORIES.UNIVERSAL) {
    return `## Workflow

1. **Start**: Set ${identifier} status to "In Progress"${linear} (if not already)
2. **Fetch details**: Get full issue details for ${identifier}${linear}
3. **Analyze**: Complete the goal below
4. **Update Linear**: Add findings as a comment on ${identifier}`
  }

  // Work-issue prompts (bug): start, investigate and update
  if (category === PROMPT_CATEGORIES.WORK_ISSUE) {
    return `## Workflow

1. **Start**: Set ${identifier} status to "In Progress"${linear} (if not already)
2. **Fetch details**: Get full issue details for ${identifier}${linear}
3. **Investigate**: Complete the goal below
4. **Update Linear**: Add findings as a comment and update labels if needed`
  }

  // Ready prompts (plan): full implementation workflow
  // NOTE: this branch is currently unused — `plan` hand-rolls its own inline
  // workflow, and `code-review` was consolidated into `review` (LIN-523).
  // Slated for removal/repurpose under LIN-524.
  if (category === PROMPT_CATEGORIES.READY) {
    return `## Workflow

1. **Start**: Set ${identifier} status to "In Progress"${linear} (if not already)
2. **Fetch details**: Get full issue details${linear}
3. **Implement**: Complete the goal below
4. **Commit**: Push changes with descriptive commit message
5. **Complete**: Set ${identifier} status to "Done" and add summary comment`
  }

  return ''
}

/**
 * Generate workflow instructions for read-only templates (no status change)
 * Used by templates that gather information without modifying issue state
 * @param {Object} issue - Issue object with identifier
 * @param {Object} [options] - Options
 * @param {boolean} [options.useLinear=true] - Whether to include Linear references
 * @returns {string} Workflow section
 */
export function formatReadOnlyWorkflow(issue, { useMcp, useLinear } = {}) {
  const identifier = issue.identifier
  const includeLinear = useLinear ?? useMcp ?? true
  const linear = includeLinear ? ' in Linear' : ''
  return `## Workflow

1. **Fetch details**: Get full issue details for ${identifier}${linear}
2. **Analyze**: Complete the goal below
3. **Update Linear**: Add findings as a comment on ${identifier}`
}

/**
 * Generate workflow instructions for inform-only templates (no Linear updates)
 * Used by templates that summarize findings for the user without writing back to Linear
 * @param {Object} issue - Issue object with identifier
 * @param {Object} [options] - Options
 * @param {boolean} [options.useLinear=true] - Whether to include Linear references
 * @returns {string} Workflow section
 */
export function formatInformOnlyWorkflow(issue, { useMcp, useLinear } = {}) {
  const identifier = issue.identifier
  const includeLinear = useLinear ?? useMcp ?? true
  const linear = includeLinear ? ' in Linear' : ''
  return `## Workflow

1. **Fetch details**: Get full issue details for ${identifier}${linear}
2. **Analyze**: Complete the goal below
3. **Summarize**: Present your findings to the user`
}

/**
 * Generate git workflow instructions for feature branch prompts
 * @param {Object} issue - Issue object with identifier
 * @returns {string} Git workflow section
 */
export function formatGitWorkflow(issue) {
  const identifier = issue.identifier
  return `

## Git Workflow

1. Create a feature branch: \`git checkout -b feature/${identifier.toLowerCase()}\`
2. Make changes with descriptive commits referencing ${identifier}
3. Push the branch and create a pull request`
}

/**
 * Generate self-review instructions for code review toggle
 * @returns {string} Self-review section
 */
export function formatSelfReview() {
  return `

## Self-Review

Before committing, review your changes:
- Verify correctness against task requirements
- Check for security vulnerabilities
- Ensure test coverage for new/changed behavior
- Confirm code style matches the codebase`
}

/**
 * Generate CI/CD check instructions for code review toggle
 * @returns {string} CI/CD check section
 */
export function formatCicdCheck() {
  return `

## CI/CD Check

After pushing changes:
1. Check CI/CD pipeline status
2. Fix any failures before proceeding
3. Do not mark the task as Done until all checks pass`
}

/**
 * Generate PR review instructions for code review toggle
 * @returns {string} PR review section
 */
export function formatPrReview() {
  return `

## PR Review

After creating the pull request:
1. Check for review comments and requested changes
2. Address all feedback
3. Only mark the task as Done after approval and merge`
}

/**
 * Generate success criteria for implementation prompts
 * @param {Object} issue - Issue object
 * @param {Object} context - Context object
 * @returns {string} Success criteria section or empty string
 */
export function formatSuccessCriteria(issue, context) {
  const lines = [
    '',
    '## Success Criteria',
    '',
    '- [ ] Implementation matches task requirements',
    '- [ ] Tests cover new/changed behavior',
    '- [ ] No regressions in existing tests'
  ]

  // Add parent-aware criteria if has parent
  if (context.parent) {
    lines.push(`- [ ] Changes align with parent task ${context.parent.identifier}`)
  }

  return lines.join('\n')
}

/**
 * Generate a staleness / re-grounding directive for the executing agent.
 *
 * Tells the downstream coding agent to treat the ticket as a hypothesis about
 * the codebase rather than ground truth, and to re-verify it against current
 * source before relying on it. Guards against tickets whose description was
 * accurate when written but invalidated by later commits.
 *
 * NOTE: This directive is intentionally mirrored in the AI meta-prompt path
 * (lib/prompts/meta-prompt-template.js). Per CLAUDE.md, prompt-behavior
 * changes must be applied to BOTH the handwritten and AI-generated paths.
 *
 * @param {Object} issue - Issue object (uses createdAt for the since-date)
 * @returns {string} Staleness-check section
 */
export function formatStalenessCheck(issue) {
  const createdAt = issue?.createdAt
  const sinceArg = createdAt ? `"${createdAt}"` : '<ticket-createdAt>'
  const createdNote = createdAt
    ? `since this ticket was created (${createdAt})`
    : 'since this ticket was created'
  return `

## Re-ground the Ticket (staleness check)

Treat this ticket as a **hypothesis** about the codebase, not ground truth — its description may have been accurate when written but invalidated by later commits. Before relying on what it says about the code:

1. List the files and symbols the ticket references.
2. Check whether any of them have changed ${createdNote}: run \`git log --since=${sinceArg} -- <paths>\` for those paths.
3. If any have changed, re-read that source at HEAD (not your own notes or the ticket prose) and reconcile any discrepancies before trusting the ticket's description of the codebase.`
}

/**
 * Generate the plan-fidelity ("Re-ground the Plan") section for implementation
 * prompts (LIN-698).
 *
 * The symmetric counterpart to formatStalenessCheck(): where the staleness check
 * reconciles the ticket's claims about the code against HEAD, this reconciles the
 * description's PLAN against the research/exploration notes it was distilled from.
 * A plan can drop, weaken, or even contradict constraints the research established
 * (the research→plan handoff is lossy), so the implementer must check the plan
 * against the fuller upstream source rather than trusting it blindly.
 *
 * This is implementation-specific and is called INLINE from the implementation
 * template's generate(). It is deliberately NOT part of appendGroundingSections()
 * — that seam is the universal, byte-identical-pinned grounding shared by ALL
 * templates, and routing plan-fidelity through it would leak implementation-only
 * behavior into every template and break the grounding-parity test.
 *
 * NOTE: This directive is intentionally mirrored in the AI meta-prompt path
 * (lib/prompts/meta-prompt-template.js → the "Implementation prompts" rule). Per
 * CLAUDE.md, prompt-behavior changes must be applied to BOTH paths. The prose is
 * provider-agnostic — no tracker name is hardcoded.
 *
 * @returns {string} Plan-fidelity-check section
 */
export function formatPlanFidelityCheck() {
  return `
### Re-ground the Plan (fidelity check)

Treat the description's plan as a **distillation** of the research, not the whole of it — it may have dropped, weakened, or even contradicted constraints the research established. Before implementing:

1. Read the research/exploration notes and the discussion in the comment thread, not just the description.
2. List every caution, who-pays/bystander note, and "preserve this behavior" constraint the research raised.
3. Confirm each one is reflected in the plan.

For any the plan omits or contradicts, trust the research's intent and flag the discrepancy — do not silently implement a plan step the research explicitly warned against. Where the plan and the research disagree, the research's reasoning wins.
`;
}

/**
 * Generate a terminal-state note for a task that is already finished.
 *
 * When the issue's own state is terminal (Done / Canceled / Duplicate) AND it has
 * no open (non-terminal) children, the work is complete — the executing agent
 * should verify/close rather than redo it as if unstarted. State is a SIGNAL that
 * shapes the action, not a gate that strips prompts (LIN-353).
 *
 * NOTE: This directive is intentionally mirrored in the AI meta-prompt path
 * (lib/prompts/meta-prompt-template.js → Step 0). Per CLAUDE.md, prompt-behavior
 * changes must be applied to BOTH the handwritten and AI-generated paths. A
 * terminal task that still has open children is NOT short-circuited here.
 *
 * @param {Object} issue - Issue object (uses state)
 * @param {Object} [context] - Context with children (to detect open remaining work)
 * @returns {string} Terminal-state note, or empty string when not terminal / has open children
 */
export function formatTerminalStateNote(issue, context = {}) {
  if (!isTerminalState(issue?.state?.type)) return '';
  const children = context?.children || [];
  const hasOpenChildren = children.some(c => !isTerminalState(c.state?.type));
  if (hasOpenChildren) return '';
  const stateName = issue?.state?.name || 'a terminal state';
  return `

## Task Already Complete (state: ${stateName})

This task is in a terminal state (Done / Canceled / Duplicate) and has no open subtasks — the work is already finished. Do NOT redo or re-investigate it as if it were unstarted. Treat this as a review/verification pass: confirm the finished work holds up against the goal, capture anything genuinely missing as a follow-up, and close out. State shapes this into a review; it is not a license for busywork against completed work.`;
}

/**
 * Generate a close-out note for an OPEN parent whose every subtask is complete.
 *
 * When the issue's own state is NOT terminal but it has subtasks and all of them
 * are in a terminal state (Done / Canceled / Duplicate), there is no open child to
 * descend into — the remaining work is the parent's own close-out, framed as a
 * review (LIN-364). This is the non-terminal counterpart to formatTerminalStateNote:
 * that handles "the task itself is Done"; this handles "the task is open but every
 * child is Done", the case that otherwise dead-ends the recommend descent on a
 * rejected defer into a finished child.
 *
 * NOTE: Mirrored in the AI meta-prompt path (lib/prompts/meta-prompt-template.js →
 * Step 0, the `!isTerminal && hasSubtasks && !hasOpenChildren` branch) per CLAUDE.md's
 * both-paths rule. A parent with any open child is NOT short-circuited here.
 *
 * @param {Object} issue - Issue object (uses state)
 * @param {Object} [context] - Context with children (to detect open remaining work)
 * @returns {string} Close-out note, or empty string when terminal / leaf / has open children
 */
export function formatChildrenCompleteNote(issue, context = {}) {
  if (isTerminalState(issue?.state?.type)) return '';
  const children = context?.children || [];
  if (!children.length) return '';
  const hasOpenChildren = children.some(c => !isTerminalState(c.state?.type));
  if (hasOpenChildren) return '';
  return `

## All Subtasks Complete — Close Out the Parent

Every one of this task's ${children.length} subtask(s) is in a terminal state (Done / Canceled / Duplicate) and the parent itself is still open. There is no open child left to descend into — the remaining work is this task's OWN close-out. Treat this as a review/verification pass: confirm the completed subtasks add up to this task's goal, capture anything genuinely missing as a follow-up, and close it out. Do NOT re-open finished subtasks or invent new work against them.`;
}

/**
 * Generate a "prior investigation on record" note for a bug-labelled task.
 *
 * The recommend engine routes a `bug`-labelled issue to investigation purely on the
 * label's presence (meta-prompt Step 2 / the deterministic mock in routes/proxy.js).
 * An investigation-only pass records its findings as a comment but legitimately keeps
 * the `bug` label — the label is retained across the whole task life, even after the
 * fix (LIN-548: it is the lasting bug-vs-feature record for reports), so the label's
 * presence is never a "still owed" signal — so without a counter-signal the next
 * recommendation re-investigates the same bug. That is the
 * LIN-366 loop: same kind repeating, redundant deliverable, no convergence. When prior
 * investigation already exists in the comments, steer the agent to advance to the fix
 * rather than redo the research.
 *
 * NOTE: Mirrored in the AI meta-prompt path (lib/prompts/meta-prompt-template.js →
 * Step 2, the "First check whether the bug has already been investigated" branch) per
 * CLAUDE.md's both-paths rule. This is a SOFT signal by necessity: there is no
 * deterministic "investigated" marker today (findings live in free-form comments), so
 * the note delegates the "is the investigation complete?" judgement to the executing
 * agent, gated deterministically on (bug label present AND at least one prior comment).
 *
 * @param {Object} issue - Issue object (uses labels — a string[] of names, the
 *   handwritten path's convention, same shape formatLabels consumes)
 * @param {Object} [context] - Context with comments (prior-investigation evidence)
 * @returns {string} Investigation-done note, or empty string when not applicable
 */
export function formatBugInvestigatedNote(issue, context = {}) {
  const hasBug = (issue?.labels || []).some(l => String(l).toLowerCase() === WORK_ISSUE_LABELS.BUG);
  if (!hasBug) return '';
  const comments = context?.comments || [];
  if (!comments.length) return '';
  return `

## Prior Investigation On Record — Don't Loop

This task carries the \`bug\` label AND already has prior investigation in its comments. The label alone is NOT a reason to investigate again — it marks unexpected behavior, not outstanding research. Read the prior findings FIRST: if they already establish a root cause AND a fix approach (the bug is understood well enough to fix), the investigation is DONE — confirm the findings still hold against the current code, then move to implementing the fix. Leave the \`bug\` label in place once fixed — moving the task to Done marks it resolved, and the label is the lasting record that this was a bug. Re-investigate only if no prior findings exist, they are incomplete or contradicted by the current code, or the behavior has changed since they were written.`;
}

/**
 * Append the deterministic grounding sections to a rendered prompt body.
 *
 * This is the SINGLE SOURCE (LIN-435) of the deterministic re-grounding directives:
 * staleness check, terminal-state, all-children-complete, and bug-already-investigated.
 * BOTH prompt paths run it as a post-pass over their rendered body:
 *   - the handwritten path (generatePrompt, lib/prompt-templates.js) appends it to the
 *     template body before the capability post-pass;
 *   - the AI meta-prompt path appends it to the LLM's parsed `## Prompt` output
 *     (applyGroundingToRecommendation, lib/openrouter.js).
 *
 * Running these rules ONCE for both paths — rather than re-typing them as prose in the
 * meta-prompt — is the genuine kill of the two-paths maintenance tax (CLAUDE.md's
 * both-paths rule). It mirrors the capability-awareness post-pass (applyPromptCapabilities)
 * that LIN-177 already established as the model: a deterministic transform both paths share.
 * Because the meta-prompt no longer hand-substitutes the ticket's Created date, the
 * staleness `--since` argument can no longer drift to a placeholder — it is injected
 * deterministically from `issue.createdAt` here.
 *
 * Each section self-gates (returns '' when not applicable), so this append is safe to run
 * unconditionally on any leaf prompt. Section order matches the original generatePrompt
 * assembly. None of the sections emits the literal "Linear", so the result is invariant
 * under applyPromptCapabilities (the meta path still shapes it for robustness/symmetry).
 *
 * @param {string} prompt - The rendered prompt body to append to
 * @param {Object} issue - Issue object (uses state, labels, createdAt)
 * @param {Object} [context] - Context with children and comments
 * @returns {string} The prompt with grounding sections appended
 */
export function appendGroundingSections(prompt, issue, context = {}) {
  let out = prompt;
  out += formatStalenessCheck(issue);
  out += formatTerminalStateNote(issue, context);
  out += formatChildrenCompleteNote(issue, context);
  out += formatBugInvestigatedNote(issue, context);
  return out;
}

/**
 * Format a single attachment line for the shared Attachments section (LIN-772).
 *
 * Reads the canonical source-neutral collector shape (LIN-771,
 * collectIssueAttachments): `{ id, title, contentType, kind }`. `id` is an opaque
 * relay handle (`att:`/`md:`), NOT a URL. Renders an optional provenance suffix
 * from `owner`/`inherited` ONLY when one is set — the S4 (LIN-773) hook — so S3
 * output (no provenance) stays stable and ancestor-provenance work extends this
 * line rather than rewriting it.
 *
 * @param {Object} att - One collector attachment (`{ id, title, contentType, kind, owner?, inherited? }`)
 * @returns {string} A single `- **title** (kind, type) — \`id\`` markdown line
 */
function formatAttachmentItem(att) {
  const title = att.title || '(untitled)'
  const kind = att.kind || 'file'
  const typeSuffix = att.contentType ? `, ${att.contentType}` : ''
  let line = `- **${title}** (${kind}${typeSuffix}) — \`${att.id}\``
  // Provenance suffix — own-vs-inherited (LIN-773 hook). Rendered only when set so
  // S3 (which sets neither) is unchanged and S4 extends without a rewrite.
  if (att.inherited) {
    line += att.owner ? ` _(inherited from ${att.owner})_` : ' _(inherited)_'
  } else if (att.owner) {
    line += ` _(from ${att.owner})_`
  }
  return line
}

/**
 * Render the shared Attachments section for the worker-facing prompt (LIN-772).
 *
 * The SINGLE source for the Attachments block BOTH prompt paths emit, so the set a
 * worker sees is identical regardless of surface:
 *   - the AI meta-prompt path folds it into the context block (formatIssueContext,
 *     lib/openrouter.js);
 *   - the handwritten path appends it as a post-pass in generatePrompt
 *     (lib/prompt-templates.js), mirroring appendGroundingSections.
 *
 * Self-gates to '' when `context.attachments` is empty/absent, so an attachment-less
 * issue stays BYTE-IDENTICAL on both paths (existing snapshots unchanged). Issues
 * WITH attachments get a new block — those snapshots are expected to change.
 *
 * The `id` of each attachment is an OPAQUE relay handle (`att:`/`md:`), not a URL —
 * the worker fetches bytes through the workspace API relay
 * (`GET /api/proxy/attachments/<id>`), never by dereferencing it (no-deep-link
 * policy, LIN-310/LIN-750). Designed from the start to carry an optional
 * `owner`/`inherited` field per item so S4 ancestor provenance (LIN-773) extends it.
 *
 * Provider-agnostic: emits no literal "Linear", so the capability post-pass
 * (applyPromptCapabilities) leaves it invariant for Linear.
 *
 * @param {Object} [context] - Context carrying `attachments` (collector output array)
 * @returns {string} The Attachments section, or '' when there are no attachments
 */
export function formatAttachmentsSection(context = {}) {
  const raw = context && Array.isArray(context.attachments) ? context.attachments : []
  const items = raw.filter(a => a && typeof a === 'object' && a.id)
  if (!items.length) return ''

  const lines = [
    '',
    '',
    '## Attachments',
    '',
    `This task has ${items.length} attachment(s). Each \`id\` below is an opaque handle, not a URL — fetch the bytes through the workspace API relay (\`GET /api/proxy/attachments/<id>\`), which resolves the handle and streams them server-side. Read any that are relevant before relying on the task text alone.`,
    '',
    `The relay always returns a neutral, forced-download response (a generic content-type plus \`Content-Disposition: attachment\`) as a deliberate safety measure — do NOT use the response's own Content-Type to decide how to handle the bytes. Instead, save the fetched bytes to a local file using a file extension derived from that item's \`contentType\` metadata field below, then open/view the saved local file as an image or as text (matching its type) so the content is actually perceived, rather than treating the raw downloaded bytes as directly viewable.`,
    ''
  ]
  for (const att of items) lines.push(formatAttachmentItem(att))
  return lines.join('\n')
}

/**
 * Scale-to-task directive (lower bound).
 *
 * Tells the executing agent to size its output to the task's actual scale rather
 * than to the template — a genuinely small task gets a short result and may skip the
 * heavy framing/completeness/history machinery. Includes the over-trim guard: do NOT
 * infer "small" from a terse description (rename/refactor/migrate-everywhere and
 * shared-identifier changes fan out to many surfaces even when tersely worded).
 *
 * Proven on the meta-prompt path via scripts/eval-prompt-scaling.mjs (genuine smalls
 * shrink ~12-20% with the quality floor held; the deceptive-small over-trim guard
 * holds). Mirrored here per CLAUDE.md's both-paths rule. Woven into the heavy
 * generative templates (plan, research) rather than tail-appended, because scale-down
 * is subtractive and a trailing "keep it brief" loses to the scaffold's gravity.
 *
 * @returns {string} Scale-to-task directive block
 */
export function formatScaleToTask() {
  return `**Scale this to the task.** Match the depth of what follows to the task's ACTUAL scale, not to this template. If the task is genuinely small or single-surface (a typo, a constant/config change, a one-file edit, or work that obviously fits one focused session), a short result is correct and complete — name the file(s) and the change, state the scope in a line, and skip the heavier framing/completeness/history/obligations sub-steps below. Do NOT infer "small" from a terse description, though: renaming, moving, refactoring, or migrating a name "everywhere"/"across the codebase", or changing a shared identifier or widely-used symbol, fans out to many surfaces even when written in one sentence — keep the full structure for those. Size to the surfaces you can verify, not to the template.`
}

/**
 * Generate if-blocked guidance
 * @returns {string} If blocked section
 */
export function formatIfBlocked() {
  return `

## If Blocked

If you encounter blockers during this work:
1. Document the blocker clearly
2. Add a comment on the issue in Linear explaining the blocker
3. Capture the dependency as a \`blocks\`/\`blocked-by\` relationship between the tasks`
}

// =============================================================================
// Provider capability surface for prompts (LIN-177 S4)
// =============================================================================
//
// Both prompt paths (handwritten templates + AI meta-prompt) are authored against
// Linear: they hardcode the tracker name "Linear" and assume status-change writes
// and subtasks exist. A non-Linear provider may not. Rather than branch every one
// of the ~70 template strings, we resolve the provider's UI capability surface
// once and apply it as a post-process over the fully-rendered prompt. For Linear
// (every flag on, displayName 'Linear') every transform below is a NO-OP, so
// Linear output is byte-identical — see the parity test in
// tests/unit/prompt-templates.test.js.
//
// The capability source is provider.ui (lib/providers/interface.js, LIN-332),
// threaded in from the call sites: `issue.source.provider` is not populated on
// canonical issues, so provider identity cannot be read off the issue object and
// must come from the active workspace's provider. Mirrors render.js's DEFAULT_UI /
// uiOf (S3) so render and prompts resolve capability the same way.
//
// NOTE: Per CLAUDE.md's both-paths rule, the meta-prompt path applies the same
// capability surface — see lib/prompts/meta-prompt-template.js.

/** Linear-equivalent capability floor used when no provider is threaded in. */
export const DEFAULT_PROMPT_UI = { write: true, comments: true, estimates: true, subtasks: true, displayName: 'Linear' };

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Resolve effective prompt capabilities from provider.ui + user feature flags.
 *
 * Provider capability is the HARD FLOOR; the `linearMcp` user flag is a SOFT
 * preference *within* a writable provider — a read-only provider never emits
 * tracker-write text regardless of the flag. (`includeTracker` is the successor
 * to the old `linearMcp !== false` suffix gate, now also gated on `write`.)
 *
 * @param {Object} [featureFlags] - User feature flags (reads `linearMcp`)
 * @param {Object} [providerUi] - provider.ui {write, comments, estimates, subtasks, displayName}
 * @returns {{displayName: string, write: boolean, subtasks: boolean, comments: boolean, includeTracker: boolean}}
 */
export function resolvePromptUi(featureFlags = {}, providerUi = null) {
  const ui = { ...DEFAULT_PROMPT_UI, ...(providerUi || {}) };
  const write = ui.write !== false;
  const includeTracker = write && featureFlags.linearMcp !== false;
  return {
    displayName: ui.displayName || 'Linear',
    write,
    subtasks: ui.subtasks !== false,
    comments: ui.comments !== false,
    includeTracker,
  };
}

/**
 * Drop tracker-write steps from every "## Workflow" section and renumber the
 * remaining steps. A write step is a numbered step whose bold label is Start /
 * Commit / Complete / Update… or one that sets a status. Only "## Workflow"
 * sections are touched — "## Git Workflow" (about code, not the tracker) and prose
 * elsewhere are left intact.
 * @param {string} prompt
 * @returns {string}
 */
function gateWorkflowWrites(prompt) {
  const lines = prompt.split('\n');
  const out = [];
  let inWorkflow = false;
  let counter = 0;
  for (const line of lines) {
    if (/^##\s+/.test(line)) {
      inWorkflow = /^##\s+Workflow\b/.test(line);
      counter = 0;
      out.push(line);
      continue;
    }
    if (inWorkflow) {
      const m = line.match(/^\d+\.\s+(.*)$/);
      if (m) {
        const body = m[1];
        const isWrite = /\*\*(Start|Commit|Complete|Update[^*]*)\*\*/.test(body)
          || /\bSet\b[^\n]*status to/i.test(body);
        if (isWrite) continue;
        counter += 1;
        out.push(`${counter}. ${body}`);
        continue;
      }
    }
    out.push(line);
  }
  return out.join('\n');
}

/**
 * Remove subtask-derived sections (the multi-line "Subtasks"/"Existing Subtasks"
 * lists and the one-line "**Subtasks:**" summary) for providers that do not model
 * subtasks. No-op for providers that do.
 * @param {string} prompt
 * @returns {string}
 */
function stripSubtaskSections(prompt) {
  const lines = prompt.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // One-line summary from formatSubtaskSummary: "**Subtasks:** 1/2 done → …"
    if (/^\*\*Subtasks:\*\* /.test(line)) continue;
    // Its companion FRONTIER FACTS line (LIN-433) — also subtask-derived, so a
    // provider that doesn't model subtasks must not see it either.
    if (/^\*\*Frontier facts:\*\* /.test(line)) continue;
    // Multi-line section header from formatMultiLineSection: "**Subtasks:**" alone
    if (/^\*\*(Existing Subtasks|Subtasks):\*\*$/.test(line)) {
      while (i + 1 < lines.length && lines[i + 1].trim() !== '') i++;
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

/**
 * Apply provider capabilities to a fully-rendered prompt. NO-OP for Linear
 * (write on, subtasks on, displayName 'Linear', tracker included).
 *
 * Order matters: gate write-steps and subtask sections (which match the literal
 * Linear step phrasings) BEFORE renaming the tracker, then rename "Linear" to the
 * provider display name, then strip any remaining " in {tracker}" suffixes.
 *
 * @param {string} prompt - Rendered prompt text
 * @param {{displayName, write, subtasks, includeTracker}} caps - from resolvePromptUi
 * @returns {string}
 */
export function applyPromptCapabilities(prompt, caps) {
  let out = prompt;
  if (!caps.write) out = gateWorkflowWrites(out);
  if (!caps.subtasks) out = stripSubtaskSections(out);
  if (caps.displayName && caps.displayName !== 'Linear') {
    out = out.replace(/\bLinear\b/g, caps.displayName);
  }
  if (!caps.includeTracker) {
    out = out.replace(new RegExp(' in ' + escapeRegExp(caps.displayName), 'g'), '');
  }
  return out;
}


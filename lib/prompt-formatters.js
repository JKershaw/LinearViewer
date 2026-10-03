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
import { extractPrincipleZeroTest } from './prompts/autopilot-manual.js';

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
 * → Prompt Structure "## Context"). Per docs/architecture/prompt-system.md,
 * prompt-behavior changes must be applied to BOTH the handwritten and
 * AI-generated paths.
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
 * Resolve the repo a dispatch should run against, ordering a caller-supplied
 * repo against the server-derived one (LIN-537 / LIN-1210).
 *
 * - LIN-537 invariant: a genuinely **user-explicit** caller repo always wins
 *   over the derived repo, and an omitted caller repo falls back to the derived
 *   one. This is the default (`inherited` false/absent) and is byte-for-byte the
 *   old `callerRepo || derivedRepo || null`.
 * - LIN-1210: when the caller marks its repo as merely **inherited**
 *   (`inherited: true`) — e.g. an autopilot orchestrator forwarding a parent
 *   project's `repo=` onto a cross-project child fan-out — the server-derived
 *   repo (the descended child's / named node's own project `repo=`) wins over
 *   it, so the worker runs in the child project's repo, not the parent's. It
 *   still falls back to the inherited repo when the child has none (a repo-less
 *   child is unchanged).
 *
 * @param {string|null|undefined} callerRepo - Repo from the dispatch body.
 * @param {string|null|undefined} derivedRepo - Repo resolved server-side (descent rec.repo or the node's project repo=).
 * @param {{ inherited?: boolean }} [opts]
 * @returns {string|null}
 */
export function resolveDispatchRepo(callerRepo, derivedRepo, { inherited = false } = {}) {
  const caller = callerRepo || null
  const derived = derivedRepo || null
  return inherited ? (derived || caller) : (caller || derived)
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
1. Check CI/CD pipeline status. If the repo has no CI configured, say so explicitly and run the local-suite substitute (PR branch vs base, diffing failure names) instead of waiting on a check that will never appear.
2. Fix any failures before proceeding
3. Do not mark the task as Done until all checks pass (or, with no CI, until the substitute is clean)`
}

/**
 * Generate the capability-gated CI/checks directive (LIN-1455).
 *
 * The delivery stages (implementation/review/close-out) each name a CI-green
 * precondition. Asserted unconditionally, that precondition is unsatisfiable in a
 * repo with no CI configured — an agent taking it literally either waits forever on
 * a signal that can never arrive, or improvises an undocumented substitute (the
 * LIN-1358 wedge: a Monitor armed on a check set that did not exist, a 195-minute
 * stall). This directive makes the precondition conditional on CI actually
 * existing, and names the validated substitute otherwise, so no stage has to
 * reinvent it.
 *
 * Called INLINE from the implementation/review/close-out stage templates, mirrored
 * in the meta-prompt's three stage rules — NOT part of appendGroundingSections()
 * (this is stage-specific text, same reasoning as formatPlanFidelityCheck()).
 *
 * NOTE: This directive is intentionally mirrored in the AI meta-prompt path
 * (lib/prompts/meta-prompt-template.js — the implementation/review/close-out rules
 * and the close-out routing clause). Per docs/architecture/prompt-system.md,
 * prompt-behavior changes must be applied to BOTH paths.
 *
 * @param {Object} [opts]
 * @param {boolean} [opts.rerun=false] - true for a stage that must independently
 *   re-run the substitute rather than trust an earlier stage's numbers (review:
 *   the reviewer re-runs both branches rather than citing the implementer's).
 * @returns {string} CI-gate directive section
 */
export function formatCiGateCheck({ rerun = false } = {}) {
  const runner = rerun
    ? "as the party asserting it — independence matters here, so re-run both branches yourself rather than citing an earlier stage's numbers"
    : 'as the party asserting it'
  return `
### Establish CI (or Its Substitute)

Check once whether CI applies: look for CI configuration (e.g. \`.github/workflows\`) and read \`gh pr checks\` / \`gh pr view --json statusCheckRollup\`, allowing one settle if the rollup is empty, since checks register a moment after a push. Do this once — **never** arm a Monitor or other background watch on checks you have not seen exist; that turns a missing signal into an unbounded wait.

- **CI exists:** the ordinary CI-green gate applies, unchanged.
- **CI is genuinely absent:** say so explicitly, then run the substitute ${runner}: the test suite on the PR branch and on base, diffing failure **names**, not just counts (an equal count can hide a fix landing beside a regression). Record that in place of "CI green", with what it cannot prove (a clean environment, an author-independent run).`
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
 * (lib/prompts/meta-prompt-template.js). Per docs/architecture/prompt-system.md,
 * prompt-behavior changes must be applied to BOTH the handwritten and
 * AI-generated paths.
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
 * docs/architecture/prompt-system.md, prompt-behavior changes must be applied
 * to BOTH paths. The prose is provider-agnostic — no tracker name is hardcoded.
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
 * Generate the attachment-perception discipline section for research, plan, and
 * review (LIN-872).
 *
 * The shared formatAttachmentsSection() (below) enumerates every attachment but only
 * asks the agent to "read any that are relevant" — soft enough that a task can claim
 * grounding after perceiving a subset. That is the exact incident this closes: a
 * worker wrote "grounded against the three attachments" on a four-attachment task,
 * silently omitting an image and self-certifying on the text/code subset it could
 * trivially read. This adds a STRONGER, SCOPED requirement on top, for the three
 * templates whose deliverable IS a grounding claim: fetch and perceive EVERY
 * attachment before making that claim, enumerate them explicitly (never "the
 * attachments"), and hard-stop plus escalate — rather than proceed and self-certify —
 * if a required attachment is unreadable or otherwise unperceivable.
 *
 * Self-gates to '' using the same items-filter formatAttachmentsSection uses, so a
 * task with no real attachments renders byte-identical to today (a hard constraint
 * of this ticket).
 *
 * Deliberately NOT routed through appendGroundingSections(): same anti-pattern
 * rationale as formatPlanFidelityCheck() above — that seam is byte-identical-pinned
 * across every template, and this directive only applies to research/plan/review.
 * Called inline from those three templates' generate() functions in
 * lib/prompt-template-defs.js.
 *
 * The wording avoids positional references ("above"/"below") because the
 * Attachments section renders in a different position relative to this check on
 * each prompt path — a post-pass after the template body on the handwritten path,
 * but folded into the top of the context block on the meta path (see
 * formatAttachmentsSection's own doc) — so "above"/"below" would be true on one path
 * and false on the other.
 *
 * NOTE: This directive is intentionally mirrored in the AI meta-prompt path
 * (lib/prompts/meta-prompt-template.js → the Research-prompts/Plan-prompts/
 * Review-prompts quality rules). Per docs/architecture/prompt-system.md,
 * prompt-behavior changes must be applied to BOTH the handwritten and
 * AI-generated paths.
 *
 * @param {Object} [context] - Context carrying `attachments` (collector output array)
 * @returns {string} Attachment-perception-check section, or '' when there are no attachments
 */
export function formatAttachmentPerceptionCheck(context = {}) {
  const raw = context && Array.isArray(context.attachments) ? context.attachments : []
  const items = raw.filter(a => a && typeof a === 'object' && a.id)
  if (!items.length) return ''

  return `
### Perceive Every Attachment Before Grounding

This task carries ${items.length} attachment(s). Before any grounding claim, fetch AND perceive every one (view an image or screenshot; never skip it) and list each by title and id in your output — never summarize them collectively as "the attachments". If one cannot be perceived, **stop**: comment naming it (title and id) and why, and recommend \`blocked\` as the next action.`;
}

/**
 * What a finished task asks of the stage it reached (LIN-3292). Routing can send a Done
 * task, or an open parent whose subtasks are all Done, to any stage: review to check it,
 * close-out to land it, or a work stage (bug, plan, implementation…) to fix what is still
 * wrong, such as red CI. Each gets its own ask, so the note never contradicts the stage:
 * review authorizes the close and does not perform it, and in-scope findings are never
 * filed as follow-ups. An unknown kind gets review's ask.
 */
function finishedTaskAsk(kind, what) {
  if (kind === 'close-out') return `Land it: settle what review left, close it out, and send anything still missing from ${what} back to \`implementation\` rather than filing it.`;
  if (Object.hasOwn(GROUNDING_BY_KIND, kind) && kind !== 'review') return `You were sent here because something about it still needs this stage, such as red CI or a gap review found: build on what landed and fix that at its cause.`;
  return `Check that it holds up against ${what}, at its cause. Anything missing from it is still this task's work: put it in your verdict rather than filing it. Your verdict authorizes the close; it does not perform it.`;
}

/**
 * Note for a task already in a terminal state with no open subtasks (LIN-353): state
 * shapes the stage, it does not strip prompts. Mirrored in meta-prompt Step 0 (the
 * both-paths rule, docs/architecture/prompt-system.md). A terminal task with open
 * children is not short-circuited.
 *
 * @param {Object} issue - Issue object (uses state)
 * @param {Object} [context] - Context with children (to detect open remaining work)
 * @param {string|null} [kind] - Template kind the note is appended to
 * @returns {string} Terminal-state note, or empty string when not terminal / has open children
 */
export function formatTerminalStateNote(issue, context = {}, kind = null) {
  if (!isTerminalState(issue?.state?.type)) return '';
  const children = context?.children || [];
  if (children.some(c => !isTerminalState(c.state?.type))) return '';
  const stateName = issue?.state?.name || 'a terminal state';
  return `

## Task Already Complete (state: ${stateName})

This task is in a terminal state (Done / Canceled / Duplicate) and has no open subtasks: the work is already finished. Do NOT redo or re-investigate it as if it were unstarted. ${finishedTaskAsk(kind, 'the goal')}`;
}

/**
 * Note for an OPEN parent whose every subtask is terminal (LIN-364): no open child is
 * left to descend into, so the parent's own work remains. The non-terminal counterpart
 * of formatTerminalStateNote, mirrored in meta-prompt Step 0's
 * `!isTerminal && hasSubtasks && !hasOpenChildren` branch.
 *
 * @param {Object} issue - Issue object (uses state)
 * @param {Object} [context] - Context with children (to detect open remaining work)
 * @param {string|null} [kind] - Template kind the note is appended to
 * @returns {string} Note, or empty string when terminal / leaf / has open children
 */
export function formatChildrenCompleteNote(issue, context = {}, kind = null) {
  if (isTerminalState(issue?.state?.type)) return '';
  const children = context?.children || [];
  if (!children.length || children.some(c => !isTerminalState(c.state?.type))) return '';
  return `

## All Subtasks Complete

Every one of this task's ${children.length} subtask(s) is in a terminal state (Done / Canceled / Duplicate) and the parent itself is still open, so no open child is left to descend into. Do NOT re-open finished subtasks or invent new work against them. ${finishedTaskAsk(kind, "this task's goal")}`;
}

/**
 * Generate a "prior investigation on record" note for a bug-labelled task.
 *
 * The `bug` label is kept for the whole task life (LIN-548: the lasting bug-vs-feature
 * record), so its presence is never a "still owed" signal; without a counter-signal
 * the work re-investigates the same bug (the LIN-366 loop). When prior investigation
 * exists in the comments, steer the agent to advance to the fix. Only implementation
 * carries it (GROUNDING_BY_KIND, LIN-3296).
 *
 * NOTE: Mirrored in meta-prompt Step 2 ("First check whether the bug has already been
 * investigated") per the both-paths rule. A SOFT signal by necessity: no deterministic
 * "investigated" marker exists, so the agent judges completeness, gated on (bug label
 * AND at least one prior comment).
 *
 * @param {Object} issue - Issue object (uses labels, a string[] of names)
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

const GROUNDING_NOTES = [formatStalenessCheck, formatTerminalStateNote, formatChildrenCompleteNote, formatBugInvestigatedNote];
const [STALE, DONE, KIDS] = GROUNDING_NOTES;
const WORK = [STALE, DONE, KIDS];

/**
 * Which grounding notes fit each stage (LIN-3296), keyed by template kind. A kind not
 * listed (custom, or an unparsed meta action) gets every note.
 *   - implementation: all four; it is the one stage the bug note's "move to
 *     implementing the fix" describes.
 *   - other work stages: no bug note; each brief keeps its own scope (the bug stage
 *     stays an investigation that proposes the fix).
 *   - look-into, context, retrospective-audit, retro: staleness only; read-only or
 *     look-back briefs that "close out" and "implement the fix" would reverse.
 *   - triage: none; it files and reads no code, and may not file follow-ups.
 */
export const GROUNDING_BY_KIND = {
  implementation: GROUNDING_NOTES,
  blocked: WORK, bug: WORK, plan: WORK, breakdown: WORK, research: WORK, scoping: WORK,
  design: WORK, spike: WORK, 'plan-review': WORK, review: WORK, 'close-out': WORK,
  'look-into': [STALE], context: [STALE], 'retrospective-audit': [STALE], retro: [STALE],
  triage: []
};

/**
 * Append the deterministic grounding sections to a rendered prompt body.
 *
 * The SINGLE SOURCE (LIN-435) of the re-grounding directives, run as a post-pass by
 * BOTH prompt paths: the handwritten path (generatePrompt, lib/prompt-templates.js)
 * before its capability post-pass, and the meta path on the LLM's parsed `## Prompt`
 * (applyGroundingToRecommendation, lib/openrouter.js), which passes the kind of the
 * recommended action. Running the rules once for both paths kills the two-paths
 * maintenance tax (docs/architecture/prompt-system.md), and the staleness `--since`
 * date comes from `issue.createdAt` here, so it cannot drift to a placeholder.
 *
 * Notes are chosen per stage from GROUNDING_BY_KIND; each also self-gates to ''. None
 * emits the literal "Linear", so the result is invariant under applyPromptCapabilities.
 *
 * @param {string} prompt - The rendered prompt body to append to
 * @param {Object} issue - Issue object (uses state, labels, createdAt)
 * @param {Object} [context] - Context with children and comments
 * @param {string|null} [kind] - Template kind; unknown or absent keeps every note
 * @returns {string} The prompt with grounding sections appended
 */
export function appendGroundingSections(prompt, issue, context = {}, kind = null) {
  const notes = Object.hasOwn(GROUNDING_BY_KIND, kind) ? GROUNDING_BY_KIND[kind] : GROUNDING_NOTES;
  return prompt + notes.map(note => note(issue, context, kind)).join('');
}

/**
 * Format a single attachment line for the shared Attachments section (LIN-772).
 *
 * Reads the canonical source-neutral collector shape (LIN-771,
 * collectIssueAttachments): `{ id, title, contentType, kind, url? }`. `id` is an opaque
 * relay handle (`att:`/`md:`), NOT a URL. Formal (`att:`) attachments may carry
 * `url` — the attachment's target — so an agent can identify a link attachment
 * even when the relay blocks the host with `ATTACHMENT_HOST_NOT_ALLOWED`
 * (LIN-1673). Markdown (`md:`) attachments do NOT carry `url`.
 * Renders an optional provenance suffix
 * from `owner`/`inherited` ONLY when one is set — the S4 (LIN-773) hook — so S3
 * output (no provenance) stays stable and ancestor-provenance work extends this
 * line rather than rewriting it.
 *
 * @param {Object} att - One collector attachment (`{ id, title, contentType, kind, owner?, inherited?, url? }`)
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
 * (`GET /api/proxy/attachments/<id>`), never by dereferencing it.
 * Formal (`att:`) attachments carry a `url` field identifying the link target
 * (LIN-1673). When the relay returns `ATTACHMENT_HOST_NOT_ALLOWED`, `url` lets
 * the agent identify where the attachment points even though bytes aren't
 * fetchable — the handle `id` and the metadata `url` serve different purposes:
 * `id` routes the relay fetch; `url` names the target. Designed from the start
 * to carry an optional `owner`/`inherited` field per item so S4 ancestor
 * provenance (LIN-773) extends it.
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
    `This task has ${items.length} attachment(s). Each \`id\` below is an opaque relay handle (\`att:\` or \`md:\` prefix) — fetch the bytes through the workspace API relay (\`GET /api/proxy/attachments/<id>\`), which resolves the handle and streams them server-side. Read any that are relevant before relying on the task text alone.`,
    '',
    `Formal (\`att:\`) attachments carry a \`url\` field — the attachment's target link — so an agent can identify where a link attachment points even when the relay rejects a host-blocked fetch with \`ATTACHMENT_HOST_NOT_ALLOWED\`: the \`id\` routes the relay; the \`url\` names the target. Markdown (\`md:\`) attachments do not carry \`url\`.`,
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
 * holds). Mirrored here per docs/architecture/prompt-system.md's both-paths rule.
 * Woven into the heavy generative templates (plan, research) rather than
 * tail-appended, because scale-down
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
  const test = extractPrincipleZeroTest()
  const testBlock = test ? `\n\n${test}` : ''
  return `

## If Blocked

**Gate on Principle 0 before you park it as \`BLOCKED\`.** Attempt local resolution first. If what's actually missing is your parent/orchestrator's own next step rather than something only a person can supply, that's \`PENDING-EXTERNAL\`, not \`BLOCKED\` — reserve \`BLOCKED:\` for what genuinely will not clear without a person.${testBlock}

**When the park is genuine,** comment on the issue with the blocker. Capture the dependency as a \`blocks\`/\`blocked-by\` relationship between the tasks, and make the ruling self-sufficient with the manual's **"The human's edge, and how to hand back"** (\`docs/autopilot-operating-manual.md\`, also served at \`GET /api/proxy/autopilot/manual\`).`
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
// NOTE: Per docs/architecture/prompt-system.md's both-paths rule, the
// meta-prompt path applies the same capability surface — see
// lib/prompts/meta-prompt-template.js.

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
 * @param {Object} [providerUi] - provider.ui {write, comments, estimates, subtasks, displayName, fixedStates}
 * @returns {{displayName: string, write: boolean, subtasks: boolean, comments: boolean, includeTracker: boolean, fixedStates: Array|null}}
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
    // LIN-2361: a provider's SYNCHRONOUS-only workflow-state vocabulary (see interface.js's
    // `ui.fixedStates` doc comment) or `null` when only an async/per-team fetch exists (Linear
    // today). NOTE for lib/prompt-trace-store.js's `resolvePromptUi` whole-object comparison
    // (`providerContextVerdict`): this field is `null` on both sides for every provider that
    // doesn't declare it, so it does not change any existing divergent/benign verdict.
    fixedStates: ui.fixedStates || null,
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

// The two Linear-shaped status literals every template quotes (verified exhaustively — see
// LIN-2361's own grep of lib/prompt-template-defs.js / lib/prompt-formatters.js /
// lib/prompts/meta-prompt-template.js), each mapped to the canonical state.type it represents.
const WORKFLOW_STATE_WORDING_TO_CANONICAL_TYPE = { 'In Progress': 'started', 'Done': 'completed' };
// Provider-neutral fallback when a fixedStates vocabulary exists but has no state of that
// canonical type (e.g. GitHub has no "started" state at all) — names no specific state, so it
// can never name one the provider's own write path (githubStateIdToCanonicalType et al.) 422s on.
const WORKFLOW_STATE_NEUTRAL_WORDING = {
  'In Progress': 'reflect that work has started',
  'Done': 'reflect that work is done',
};

/**
 * Rewrite a surviving "Set X status to \"<Linear-shaped wording>\"" instruction's quoted state
 * name for a provider with a SYNCHRONOUS, fixed workflow-state vocabulary (LIN-2361, finding B):
 * GitHub's `states()` is exactly open/closed, so a dispatched prompt's opening instruction
 * literally said `Set #55 status to "In Progress"` — a state `githubStateIdToCanonicalType`
 * 422s on, since GitHub has no such state. No-op when `fixedStates` is null (the provider's real
 * vocabulary needs an async/per-team fetch, e.g. Linear) — that line is left exactly as today,
 * matching `resolvePromptUi`'s own `fixedStates: null` contract.
 * @param {string} prompt
 * @param {Array<{id, name, type}>|null} fixedStates - provider.ui.fixedStates
 * @returns {string}
 */
function shapeWorkflowStateWording(prompt, fixedStates) {
  if (!fixedStates) return prompt;
  return prompt.replace(/status to "([^"]+)"/g, (whole, wording) => {
    const canonicalType = WORKFLOW_STATE_WORDING_TO_CANONICAL_TYPE[wording];
    if (!canonicalType) return whole; // an unrecognised wording — leave untouched, never guess
    const matched = fixedStates.find(s => s.type === canonicalType);
    if (matched) return `status to "${matched.name}"`;
    const neutral = WORKFLOW_STATE_NEUTRAL_WORDING[wording] || 'reflect the appropriate status';
    return `status to ${neutral}`;
  });
}

/**
 * Remove subtask-derived lines (the "**Subtasks:**" summary + frontier facts, and the
 * "Subtasks"/"Existing Subtasks" header with its formatChildren list) for providers
 * without subtasks. No-op for providers that do. A list ends at its first non-item
 * line, not a blank one: templates filter(Boolean) their spacers away (LIN-3296).
 * @param {string} prompt
 * @returns {string}
 */
function stripSubtaskSections(prompt) {
  const lines = prompt.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // formatSubtaskSummary: "**Subtasks:** 1/2 done → …" and its FRONTIER FACTS (LIN-433)
    if (/^\*\*(Subtasks|Frontier facts):\*\* /.test(line)) continue;
    if (/^\*\*(Existing Subtasks|Subtasks):\*\*$/.test(line)) {
      // Items `- ID: "title" (state)`, or an indented continuation line
      while (i + 1 < lines.length && /^(- \S+: "|\s+\S)/.test(lines[i + 1])) i++;
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
 * provider display name, then strip any remaining " in {tracker}" suffixes. The
 * state-wording shaping step (LIN-2361) runs right after the write-gate — so it only ever
 * touches a "Set status" line that SURVIVED gating (one already dropped by `!write` needs no
 * wording fix) — and before the displayName rename; the two are token-disjoint so the exact
 * placement isn't correctness-sensitive, but this keeps it at one defined point in the
 * documented sequence rather than an arbitrary one.
 *
 * @param {string} prompt - Rendered prompt text
 * @param {{displayName, write, subtasks, includeTracker, fixedStates}} caps - from resolvePromptUi
 * @returns {string}
 */
export function applyPromptCapabilities(prompt, caps) {
  let out = prompt;
  if (!caps.write) out = gateWorkflowWrites(out);
  out = shapeWorkflowStateWording(out, caps.fixedStates);
  if (!caps.subtasks) out = stripSubtaskSections(out);
  if (caps.displayName && caps.displayName !== 'Linear') {
    out = out.replace(/\bLinear\b/g, caps.displayName);
  }
  if (!caps.includeTracker) {
    out = out.replace(new RegExp(' in ' + escapeRegExp(caps.displayName), 'g'), '');
  }
  return out;
}


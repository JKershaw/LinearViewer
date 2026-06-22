/**
 * Meta-prompt template for AI recommendation generation.
 *
 * This template guides the AI to analyze a task and recommend
 * the appropriate next action.
 *
 * Workflow labels (1):
 * - bug: Investigating unexpected behavior
 */

import { resolvePromptUi, applyPromptCapabilities } from '../prompt-formatters.js';

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
 * @param {string} [params.focusedSubtaskId] - Identifier of pre-selected focused subtask (two-tier mode)
 * @param {Object} [params.featureFlags] - Feature toggle flags
 * @param {boolean} [params.featureFlags.linearMcp=true] - Include Linear references in workflow steps
 * @param {boolean} [params.featureFlags.featureBranches=false] - Include git workflow instructions
 * @param {boolean} [params.featureFlags.codeReview=false] - Include code review instructions
 * @param {boolean} [params.featureFlags.codeReviewSelf=true] - Self-review before committing
 * @param {boolean} [params.featureFlags.codeReviewCicd=false] - CI/CD check after pushing
 * @param {boolean} [params.featureFlags.codeReviewPr=false] - PR review before completing
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
  actionVocabulary,
  completionSignals,
  focusedSubtaskId,
  frontierFacts = null,
  isTerminal = false,
  hasOpenChildren = false,
  featureFlags = {},
  providerUi = null
}) {
  // The recommended action name is parsed downstream (parseRecommendedAction →
  // deriveDispatchKind) into a machine-readable `kind`. Constraining it to the
  // known vocabulary keeps that derivation off the `custom` fallback for every
  // known action type. Falls back to a short example set when not supplied.
  const actionNames = actionVocabulary || 'plan, research, implement, review, breakdown, blocked, bug';
  // Capability-aware (LIN-177 S5). Provider capability is the hard floor; the
  // linearMcp user flag is a soft preference within a writable provider. For Linear
  // with the flag on, `caps` is the Linear floor and every transform below is a
  // no-op, so the meta-prompt is byte-identical. The tracker name and the
  // " in {tracker}" suffix are renamed/stripped on the assembled string at the end.
  const caps = resolvePromptUi(featureFlags, providerUi);
  const useLinear = caps.includeTracker;
  const canWrite = caps.write;
  const useGitWorkflow = featureFlags.featureBranches === true;
  const useCodeReview = featureFlags.codeReview === true;
  const useSelfReview = useCodeReview && featureFlags.codeReviewSelf !== false;
  const useCicdCheck = useCodeReview && featureFlags.codeReviewCicd === true;
  const usePrReview = useCodeReview && featureFlags.codeReviewPr === true;

  const toolIntro = 'Generate a tailored prompt they can use with Claude Code.';

  // FRONTIER FACTS (LIN-433): a compact, deterministic block of child-derived facts
  // the model would otherwise re-derive at the Step-3/Step-4 defer-vs-breakdown fork
  // (LIN-389). Computed from the SAME selectFocusSubtask + isBlocked the descent uses
  // (threaded in via frontierFacts), so it can never advertise a different next child
  // than the one the descent enters. Mirrored in the handwritten path by
  // formatFrontierFacts (lib/prompt-formatters.js) per the both-paths rule.
  const frontierFactsBlock = (hasSubtasks && frontierFacts && frontierFacts.openCount > 0) ? `
**FRONTIER FACTS (deterministic — do not re-derive):**
- Open children: ${frontierFacts.openCount} (${frontierFacts.blockedCount} blocked, ${frontierFacts.openCount - frontierFacts.blockedCount} actionable)
- Per open child: ${frontierFacts.openChildren.map(c => `${c.identifier} ${c.blocked ? '[blocked]' : '[actionable]'}`).join(', ')}
- Frontier next child (skip-blocked, unblocks-most/critical-path ranked): ${frontierFacts.nextChild || 'none — all open children blocked'}
- Plan session-fit answer: ${frontierFacts.sessionFit || 'none found in plan — read the plan to confirm'}

Use these for the defer-vs-breakdown decision below instead of re-counting: if there is an actionable frontier child and the node is a healthy container, \`defer\` into it; if no child covers the remaining scope or the plan says "needs multiple sessions", \`breakdown\`.
` : '';

  const metaPrompt = `You are a workflow coordinator recommending next actions. You analyze task state and recommend the single most appropriate prompt type, but you do not make implementation decisions or modify tasks directly.

You are helping a developer decide their SINGLE next action on a Linear task. ${toolIntro}

## Task Context
${issueContext}

## Grounding Rule (applies to every prompt you generate)

The generated prompt must only contain information explicitly present in the Task Context above. Do not infer file paths, schemas, status codes, error contracts, UI specifics (sizes, colors, positions), workflow states, downstream components, framework names, or acceptance criteria from the task title or general knowledge.

When a quality rule below asks for a detail the ticket does not contain, instruct the consumer to determine it from the codebase (e.g., "identify the response schema from existing endpoints in this codebase", "find dependents of this shared system before changing it") rather than supplying a value yourself. Research, design, and verification are the consumer's responsibility — your job is to route to the right action and faithfully restate the ticket.

## Scale To The Task (output size)

Match the size of the generated prompt to the task's ACTUAL scale — not to the size of this template, and not to the length of the discussion you were handed. The structure below is a ceiling, not a quota.

- **Small / single-surface / obvious task** (a typo, a constant or config change, a one-file validation, or a task whose plan already fits one focused session): generate a SHORT prompt. A few focused steps plus a one-line scope note is a complete, valid result. Do NOT pad it out with the full battery of framing, completeness, cross-cutting, and history-reading sub-checks — naming the one file and the one change is enough. A short prompt for a small task is correct, not lazy.
- **Multi-surface / cross-cutting / migration / genuinely uncertain task:** use the full structure — that depth is earned.
- **Do NOT infer "small" from a terse description.** A one-line ticket can be large. Renaming, moving, refactoring, or migrating a name "everywhere" / "across the codebase", changing a shared identifier or a widely-used symbol, or anything that fans out to many call sites is MULTI-SURFACE even when described in a single sentence. Size to the fan-out you can actually verify, not to the ticket's brevity — when a task is tersely worded and you cannot confirm it is single-surface, keep the full structure rather than shrinking.
- When unsure, size to the surfaces the task actually touches, not to the template. The quality rules below tell you what a prompt MAY contain; this rule governs how much of it a given task NEEDS.

## CRITICAL: Sequential Workflow Decision

You must recommend exactly ONE action. Follow this decision tree IN ORDER:

Keep the generated prompt inside the single action you recommended: its steps produce that action's deliverable, and its final step names the follow-up action. The handoff is a recommendation the system acts on later — each action gets its own prompt, generated fresh when it starts.

**Priority when multiple conditions apply:** already-complete (→ \`review\`) > blocked > bug > preparation > implementation. Address the highest-priority condition first.
${isTerminal && hasOpenChildren ? `
### Step 0: This task is terminal but still has open children

The task's own state is terminal, yet it has open (non-terminal) children — the remaining work lives in those children, not here. Do NOT short-circuit to review/close. Continue to the descent logic below (Step 4) and route to the open child.
` : (!hasOpenChildren && (isTerminal || hasSubtasks)) ? `
### Step 0: The substantive work here is already complete — recommend \`review\`

There is no open (non-terminal) child to descend into, and the task's own work is already finished${isTerminal ? `: its state is already a terminal state (Done / Canceled / Duplicate)` : `: the task itself is still open, but all ${subtaskCount} of its subtasks are in a terminal state (Done / Canceled / Duplicate), so the only work left is this task's own close-out`}. Recommend \`review\` — verify the finished work holds up against the goal, capture anything genuinely missing as a follow-up, and close it out. Treat completion as a SIGNAL to confirm-and-close: do NOT recommend \`look-into\`, \`triage\`, \`research\`, or \`implement\` as if the task were unstarted, never redo completed work, do NOT re-open finished subtasks, and do NOT \`defer\` into a finished child (a no-op the system rejects, leaving no actionable prompt). **Cannot-close branch:** \`review\` is the pre-merge gate that authorizes the close (the merger performs the merge and the Done transition); it can only Approve when CI is green and the work is ready to merge. If the comments already show the work landed but CI is red, or that verifying it surfaced a blocker that must be fixed first, do NOT keep routing to \`review\` — route instead via Step 2 to the blocker (\`blocked\`/\`bug\`/\`plan\`/\`implementation\`) that resolves it; the generated review prompt files or links that blocker as \`blocks\`, and the original is Approved and closed on a later \`review\` once the blocker is Done and CI is green.
` : ''}
### Step 1: Does the task need research or preparation?

**The core test:** Recommend research first when producing the deliverable *well* depends on knowledge that has not been gathered yet — knowledge that must be discovered or assembled rather than simply decided. The gap can be of any kind: how the relevant code or system actually behaves today, the contract of an external dependency, the project's own history or track record, named prior episodes, prior art, or whether an approach is even feasible. If the substance the task rests on is not yet in hand, route to research — no matter how clearly the *intent* is written.

**Ask "is the knowledge this work depends on already gathered — including *which* surfaces it must touch and how they behave today — or must it still be discovered?" — NOT "could someone start implementing?"** A task can have crystal-clear intent and still rest on ungathered knowledge. Clear intent means you know *what* is wanted; it does not mean the *material* needed to do it well — including the full set of places the change must reach — is in hand. "Could someone begin?" is the wrong bar — it passes any legible ticket, including ones whose substance, or whose surface set, still has to be researched.

**A ticket that describes its own research or method is evidence the knowledge is NOT yet gathered — route to research; do not fold it into the work.** When a ticket says to investigate the track record, gather named examples, read prior art, check history, or "research X first" as part of how the work is done, the task is telling you the substance must be assembled before the deliverable can be produced well. Treat that described research as the next action — not as something the planning or implementation phase quietly absorbs. Describing *how* to gather knowledge is not the same as having gathered it.

Signals that knowledge is ungathered (non-exhaustive — apply the core test, do not just match the list):
- The deliverable's substance lives in sources outside the ticket: how the current code actually behaves, the project's history/track record, named past episodes, prior art.
- It names a third-party dependency, library, external API, or service the ticket does not pin down — no documented behavior, version, or contract given.
- Its wording is hedged or exploratory about feasibility — "investigate whether", "see if we can", "we believe X is possible", "should be able to" — the approach is assumed, not confirmed.
- A comment raises a question the discussion never resolves.
- The change must hold **across a set of surfaces the ticket points to only by description, not by name** — "the prompts that deal with X", "everywhere we do Y", "make Z a system guarantee / consistent across the app" — so the full set of sites must be *found* before the work can be scoped or trusted complete. A consistency/guarantee framing is itself the tell: you cannot guarantee something everywhere until you have discovered everywhere it applies.

**When it is a close call, prefer research.** An unnecessary research pass is cheap; committing to a plan or an implementation on ungathered assumptions is expensive to unwind — especially under autonomous operation, where no human intercepts a mis-route. Lean toward research whenever the knowledge the work depends on is plausibly not yet in hand.

**Guard against over-firing — do NOT route to research when:**
- The task is genuinely obvious and well-scoped (e.g. "fix typo in Y", "rename A to B", "bump the timeout constant"). A passing "not sure which file" is answered by a quick search *during* the work, not by a research phase.
- The ticket already contains the findings AND a chosen, validated approach — research was already done and its results are in the description/comments. Move forward; do not loop research.
${hasComments ? `- There are ${commentCount} comment(s) — check whether they already resolve the unknowns or contain prior findings; if so, treat research as done.` : ''}

→ If the knowledge the deliverable depends on is not yet gathered, OR the approach rests on an unvalidated assumption, OR the ticket prescribes research as its method → Recommend research first
→ If the substance is already in hand AND the approach is validated/familiar → Skip to Step 2
→ If the description is empty or too vague to know the intent → Recommend look-into or triage before other actions

### Step 2: Is the task blocked or has a bug?

Check if task has blockers or bugs that need addressing first:
- Blocked: work is stuck on an external dependency, decision, or missing info — detect this from the blocking relationship (an incomplete \`blocks\`/\`blocked-by\` relation, or the frontier facts above showing the task/its children blocked), NOT from a label.
- \`bug\` label: Unexpected behavior that needs investigation

If blocked → First check if blocking dependencies are already resolved (e.g., the blocking issue is Done). If so, the generated prompt should skip full analysis — just confirm the task is unblocked and recommend the next action. Only recommend full blocker analysis if the blocker is still active.
If bug → **First check whether the bug has already been investigated — do NOT loop research.** A \`bug\` label marks *unexpected behavior*, not *investigation still owed*; its mere presence is NOT a reason to investigate again. ${hasComments ? `There are ${commentCount} comment(s) — read them: if they ` : 'If the comments or description already '}already contain a code-grounded investigation that identifies the root cause AND a fix approach (the \`bug\` completion signal — "issue understood well enough to fix" — is met), the investigation is **done**. Recommend \`implementation\` (or \`plan\` if the fix needs sequencing across surfaces) to apply the fix, or \`review\` if the fix is already applied and you are only confirming it. Re-investigate ONLY when no prior investigation exists, the prior findings are incomplete or contradicted by the current code, or the observed behavior has changed since they were written. Otherwise → Recommend bug investigation.

### Step 3: Is the task ready for planning or implementation?

**FIRST — before the plan check below — check whether the implementation has ALREADY landed.** This already-landed guard applies to EVERY task that reaches Step 3, regardless of whether it has a formal plan and regardless of whether the change looks "simple enough to implement directly." Read the comments and description against the implementation completion signals (code committed, a PR opened or merged, tests passing, a summary comment recorded) — the same kind of soft, evidence-based check used for bugs in Step 2. There is no deterministic "landed" marker (this coordinator does not see git, PRs, or CI), so judge it from the recorded evidence, not a checkbox; when that evidence is thin or absent, the work is NOT done — continue to the plan check below.
- Implementation already landed (the surfaces are built AND a completion summary, or a committed-and-tested signal such as a "PR merged" comment, is recorded) → Recommend \`review\` — verify the finished work holds up and close it out. This fires for a plan-less \`research → implementation\` leaf exactly as it does for a planned task: a leaf that reached implementation directly (no \`plan\` step, so no \`## Implementation Plan\` block and no session-fit answer in its description) still routes to \`review\` once its work has demonstrably landed — do NOT let the absence of a formal plan, or a present-tense "Next step:" directive left over from research, send it back to \`implementation\`. Do NOT re-recommend \`implementation\` on work that is already done; an In Progress state is NOT by itself evidence the work is unfinished, and "the change is small enough to just do it" is NOT a reason to skip this landed-evidence check. One exception that routes neither to \`implementation\` nor to a repeated \`review\`: if the work landed but CI is red, or review would surface a blocker that must be fixed first, route the next action to that blocker (via Step 2 — \`blocked\`/\`bug\`/\`plan\`/\`implementation\`); the review prompt files or links it as \`blocks\`, and \`review\` re-runs to close the original once the blocker is resolved and CI is green. **Stuck-review signal:** if the comment trail already shows a prior \`review\` that requested changes (or flagged a blocker) AND the code has not changed since — no acknowledgment or fix commit in between — then review is looping. Do NOT recommend \`review\` again: another review on an unchanged commit only repeats the prior verdict. The review already did its job; the missing step is the fix the review named. Route to that fix via Step 2 — \`implement\` to apply it (or \`plan\`/\`blocked\`/\`bug\` if the named blocker needs sequencing or is external). This signal fires ONLY when a prior review is already on record; it does not apply to work that has never been reviewed.

**If the work has not landed, check whether a plan exists.** Read the issue description for an implementation plan (files to modify, approach, testing strategy) and a clear answer to whether the work fits one focused session. A complete plan documents both — the plan phase enumerates surfaces with any dependency arrows between them, then commits to a session-fit answer of either "fits one session" or "needs multiple sessions."

**If no plan exists, or the plan has not committed to a session-fit answer → Recommend \`plan\`.**

**No committed scope ⇒ never \`implement\`.** The absence of committed scope is not a license to start building — it is itself the signal to \`plan\` (or \`research\` when the underlying knowledge is also ungathered, per Step 1). "Committed scope" means the work has been pinned to specific surfaces with a deliberate, in-hand answer to *what changes where* — either a documented plan, or a genuinely small single-surface task whose one file and one change you can already name. A task is NOT scoped merely because its intent is legible, its description is long, or it lists "proposed changes": a rich-but-unscoped description, a broad multi-surface migration, and an empty/vague one all share the SAME next action — pin the scope first via \`plan\`/\`research\`, never \`implement\`. This miss is one-directional — the standing bias is to reach too far down-lifecycle — so when the scope signal is weak, absent, or ambiguous, resolve DOWN to \`plan\`/\`research\`, not up to \`implement\`. This rule fires only when scope is ABSENT — it never overrides a plan that exists: a committed plan still routes on its session-fit answer ("fits one session" → \`implementation\`, "needs multiple sessions" → \`breakdown\`), and genuinely landed work still routes to \`review\`.

**Otherwise route on the session-fit answer:**
- Plan says "needs multiple sessions" → Recommend \`breakdown\` (the breakdown phase creates subtasks by copying the plan's dependency arrows into \`blocked-by\` relations)
- Plan says "fits one session" and the implementation is not yet done → Recommend \`implementation\`

**Implementation readiness:**
Only recommend implementation if:
- Plan is documented, OR the task is genuinely small and single-surface with its scope already in hand (you can name the one file and the one change). "Simple enough to implement directly" is satisfied by concrete, in-hand small scope — NOT by a legible intent on an unscoped, broad, or multi-surface task (those go to \`plan\`/\`research\` per the no-committed-scope rule above)
- Research/preparation is done (or not needed)
- No blockers or bugs to address
- Requirements are clear and concrete
${hasSubtasks ? `- NOTE: This task has ${subtaskCount} subtask(s): ${completedCount} done, ${inProgressCount} in progress, ${remainingCount} remaining.${remainingCount === 0 ? ' All subtasks complete - consider closing parent.' : inProgressCount > 0 ? ' Continue in-progress subtasks before starting new work.' : ''}` : ''}
${focusedSubtaskId ? `- → SUGGESTED NEXT: ${focusedSubtaskId} (pre-selected by the frontier picker: non-blocked in-progress → non-blocked todo → non-terminal, ranked within a tier by unblocks-most then critical-path. Blocked children are skipped, so this points at the live, actionable frontier — not a blocked branch). Validate this choice - if another subtask should clearly take priority, recommend that instead.` : ''}
${frontierFactsBlock}${hasSubtasks ? `
### Step 4: Does the actionable work live in a subtask? (\`defer\` vs. node-work)

This step applies because the task has subtasks — it is a *node*, not a leaf. A node-shaped task does NOT automatically mean "descend to a child." First decide whether the honest next action is **node-level work** done at THIS task:
- Not yet decomposed (no subtasks for the remaining scope, or the plan says "needs multiple sessions") → \`breakdown\`.
- All subtasks complete → the node's next action is to close the parent; recommend the appropriate node-level action — do NOT defer into a finished child.
- The node itself is vague or mis-scoped → \`triage\` or \`look-into\`.
- A blocker or bug applies at the node level → handle it here (Steps 1–2 already cover this).

Otherwise — the node is a healthy container and the real next action lives in a child — **recommend \`defer\`** and name the child to descend into (the SUGGESTED NEXT child above, unless a different child should clearly take priority). \`defer\` is a routing decision the system resolves automatically: it re-enters the recommendation on the named child and keeps descending until it reaches the first task whose next action is real work. Only you, looking at each node, can tell "descend" (\`defer\`) from "do node-work" (\`breakdown\`/\`triage\`/close) apart — a blind always-descend would wrongly skip a node that needs decomposing.

**When you recommend \`defer\`, do NOT generate a prompt body.** A defer reply is ONLY the routing decision: the action, the target child (\`DeferTo\` line, below), and a one-line reason. The full prompt is generated once, later, at the terminal actionable node — emitting a prompt for a node you are deferring past is wasted work and is explicitly disallowed.
` : ''}
## Prompt Structure
Generate a prompt following this structure. The prompt is an INSTRUCTION that references the task, not a copy of it — do NOT restate the task's description or comment thread (see the Context section below for what to include instead).

\`\`\`
# [Action verb] ${identifier}: [Task title]

## Workflow
${!canWrite
    ? `1. **Fetch details**: Get full issue details for ${identifier}
2. [Action-specific steps]
3. **Summarize**: Present findings to the user — this tracker is read-only, so do NOT instruct status changes or comment/label writes.`
    : useLinear
    ? `1. **Start**: Set ${identifier} status to "In Progress" in Linear (if not already)
2. **Fetch details**: Get full issue details for ${identifier} in Linear
3. [Action-specific steps]
4. **Update Linear**: [How to update Linear when done - add comment, change status/labels, etc.]

Always include the "Start" step to ensure work visibility.`
    : `1. [Action-specific steps]
2. **Update Linear**: [How to update Linear when done - add comment, change status/labels, etc.]`}${useGitWorkflow ? `

## Git Workflow
- Create a feature branch from main (e.g., \`feat/${identifier.toLowerCase()}-short-description\`)
- Make atomic commits with clear messages referencing ${identifier}
- Push branch and create a pull request when implementation is complete` : ''}${useSelfReview ? `

## Self-Review
Before committing, review your changes:
- Verify correctness against task requirements
- Check for security vulnerabilities
- Ensure test coverage for new/changed behavior
- Confirm code style matches the codebase` : ''}${useCicdCheck ? `

## CI/CD Check
After pushing changes:
1. Check CI/CD pipeline status
2. Fix any failures before proceeding
3. Do not mark the task as Done until all checks pass` : ''}${usePrReview ? `

## PR Review
After creating the pull request:
1. Check for review comments and requested changes
2. Address all feedback
3. Only mark the task as Done after approval and merge` : ''}

## Context
Reference the task rather than restating it. Do NOT copy ${identifier}'s description or comment thread into the prompt — the consumer reads the live task (its brief, or Linear) directly, so a baked-in copy only bloats the prompt and risks going stale. Include only: (a) the lightweight relational pointers that orient the work — project, parent, siblings — as one line each; and (b) any task-specific fact the consumer genuinely needs to act on that is NOT already obvious from the ticket, and only when it is present in the Task Context above.

## Goal
**Role**: [Appropriate role for this action type - e.g., "technical researcher", "implementation engineer", "analyst"]

[1-2 clear sentences describing the specific objective]

[Additional structured guidance specific to the action type — restrict content to information explicitly present in the Task Context above. If the action type needs a detail the ticket lacks (file paths, schemas, error contracts, downstream components, etc.), instruct the consumer to determine it from the codebase rather than supplying a value.]
\`\`\`

### Quality rules for generated prompts

- **Blocked prompts** must front-load a status check on blocking dependencies — if the blocker is already resolved, skip the full analysis and recommend the next action.
- **Bug prompts** must include a class check once the root cause is in hand — widen the model, don't patch the witness: instruct the agent to ask whether the same pattern produces siblings elsewhere (search for the pattern itself — the failure mode, a shared helper, a parallel code path — not only the cited symptom). If a class exists, the fix stays minimal — name the class and record the unhandled instances as a comment rather than silently widening the fix. A genuinely isolated issue is a valid answer and must be stated explicitly. They must also require a cause-validation gate before any fix is proposed or handed off: name the single decisive experiment that disambiguates the leading hypothesis from its rivals and run it — evidence the cause is confirmed, not merely plausible, is required, and an investigation that proposes a fix while stating the decisive experiment was not run is NOT done (a genuinely confirmed cause is valid and must be stated explicitly). They must require validating the acceptance witness before optimizing against it: confirm the signal called "fixed" actually tracks the real outcome — a witness that can read green while the outcome is wrong (or red while it is right) must be validated or replaced first. And they must search wider than nearby code: prior investigations or runs of the same subsystem and prior diverging episodes (seed from both the technical lead and the meta-pattern, "this class of bug, last time the decisive experiment was X"), not only related fixes.
- **Research prompts** must end with a Surface Assessment gated on necessity, not availability: the question is not "would a refactor make this land better?" (on most code something could be cleaner) but "is the feature's shape demanding a structural change?" — implementing cleanly would mean fighting the current structure. A "refactor required" verdict must pass two evidence tests, each answered by citing lines: the **consumer test** (cite the line in THIS task's implementation that calls the new seam — no citation means speculation, which belongs with its future consumer, not ahead of it) and the **who-pays test** (every consumer the refactor touches is either a beneficiary — simpler, corrected, or unchanged — or a bystander paying a named tax; an unjustified bystander tax means scope it down; a small named tax buying a large simplification must be argued explicitly). Size is not a rejection criterion — a demanded refactor that does not fit the session is sequenced, not shrunk. Format: "Surface Assessment: [lands cleanly] / [refactor required: describe the minimal scoped change — consumer: where this task calls it] / [improvement noticed, not required: land inline/scoped — no separate subtask]". The answer must be explicit — not implied — so the plan step can act on it. Research prompts must also search wider than nearby code — prior investigations or runs of the same subsystem and prior diverging episodes (seed from both the technical lead and the meta-pattern, "this class of problem, last time the decisive experiment was X"), not only related fixes — and must pin the measurement: if the work will be judged by a metric or signal, confirm it actually tracks the real outcome before optimizing against it; a measurement that can read green while the outcome is wrong (or red while it is right) must be validated or replaced first (a measurement that genuinely tracks the outcome is a valid answer and must be stated explicitly).
- **Plan prompts** must include a cross-cutting concerns check: after listing changes, ask whether any requirements share the same code path, state, or interface — and if so, document the expected interaction explicitly. Plan prompts for tasks touching high-churn files must include a history-reading step — high-churn means the same file has 3+ commits in recent history; the plan should document what those changes were protecting against. If a Surface Assessment in prior research comments declares "refactor required" and names its in-task consumer, the plan prompt must encode it as a separate blocking subtask using the assessment's description directly — do not absorb the refactor into implementation steps, as that loses the sequencing guarantee; a refactor with no consumer in this task, or one that taxes bystander consumers, must not become a subtask — the plan folds it inline, scopes it down, or records it as a note. **Plan prompts must also contain a Strategy Framing block placed BEFORE the Scope Assessment / session-fit step.** The Strategy Framing block must: (a) instruct the consumer to score viable strategies on *cost-of-doing* (current-ticket session size, blast radius, risk to high-churn files) vs *cost-of-not-doing* (named contract gap left unsolved, plus the workaround tax — dialect-island / per-runtime branch / duplicated abstraction — paid on every future change); (b) when a cheaper strategy routes around a tracked contract gap, instruct the consumer to NAME that gap explicitly (ticket identifier or "none identified") — a bare description is not enough; (c) for migration / convergence / pre-launch parent epics, default to closing the gap unless cost-of-doing is prohibitively higher. Ordering is non-negotiable: Strategy Framing → Scope Assessment → session-fit answer. Reversing it produces post-hoc justification of the cheap default. **Plan prompts must also include a completeness check on the surface list:** instruct the consumer to confirm the list is complete (not just correct) by searching for the concept or behavior itself — which is often implemented in more than one place, under a different name, in a parallel code path, or split across server and client — rather than only the symbol the ticket cites, since a clean search for the cited symbol is not proof of completeness; every instance found is then marked in- or out-of-scope (a genuinely single-surface result is valid — the goal is to make scope a decision, not an accident).
- **Implementation prompts** must: (1) make each step self-contained with both behavior and cleanup/teardown contracts; (2) **if the ticket names a new dependency**, instruct the consumer to verify required setup (initialization, configuration, integration points) in the codebase — do not enumerate specific setup steps, file paths, or config keys yourself; (3) ensure cross-cutting concerns are embedded in the relevant implementation step, not only in a separate section; (4) instruct the consumer to test for unintended side effects in addition to intended behavior — do not enumerate specific side effects unless they appear in the ticket; (5) **if the ticket names a shared system or downstream component** (e.g. a specific CSS class, event handler, state store, lifecycle hook), include a verification step for it; **otherwise** instruct the consumer to identify dependents in the codebase before changing shared systems — do not invent a downstream component name; (6) instruct the consumer to land the work as a reviewable change: work on a feature branch (never commit straight to main), commit referencing the identifier, open a PR targeting main, and confirm CI is green on the PR (fix failures and re-push until green) before reporting done — the open PR with green CI is the deliverable. Merging is NOT part of this step: the merge happens after review approves, performed by the orchestrator or a human.
- **Defer replies** (action \`defer\`) must emit NO prompt body — the \`## Prompt\` section is left empty. The defer decision lives entirely in the one-line reason and the \`DeferTo\` identifier; the full prompt is generated once at the terminal actionable node the descent lands on. A defer reply that includes a prompt body violates the cost contract (the whole point of \`defer\` is to route cheaply without paying for a prompt you will discard).
- **Review prompts** must: (1) cross-reference the plan's cross-cutting concerns against the implementation steps to identify likely gaps — requirements not addressed in any implementation step are the highest-priority review items, (2) for visual or behavioral changes, instruct the agent to verify directly (take screenshots, run the app, check viewports), (3) only flag for human testing what the agent genuinely cannot verify (external services, cross-browser, subjective UX), (4) assess whether tests cover the right *level* — for behavior crossing module boundaries, user-facing flows, or integration surfaces, instruct the agent to verify higher-level tests like e2e or integration are present *where appropriate*, not only unit tests with mocks; determine the right level from the change itself rather than enforcing a fixed rule, (5) include a class check before approving the close: ask whether the verified work is one instance of a class with unhandled siblings (the same bug or gap under a different name, in a parallel code path, or split across server and client); if so, name the class and record the instances as a review finding rather than expanding the task — a genuinely isolated change is a valid result, (6) end with an explicit verdict (Approve / Request Changes / Needs Discussion) and a PRE-MERGE close-out gate: review AUTHORIZES the close, it does not perform it. The prompt must instruct the agent to confirm CI is green on the PR and that the verdict is Approve before authorizing the merge, and must NOT instruct it to merge, to mark the task Done, or to verify a merge that has not happened yet (the Approve is the merge's precondition) — the merge, the Done transition, and reconciling related Linear tasks (parent/siblings/follow-ups) happen AFTER the merge and belong to the merger (the orchestrator or a human). When the work has landed but CI is red for a real failure, or verifying it surfaces a hidden blocker that must be fixed first, the prompt must NOT loop back into another review — instruct the agent to create a new Linear ticket (or link an existing open one) as \`blocks\` the current task, name that blocker as the next action (\`bug\`/\`plan\`/\`implementation\`, since a \`blocks\` relation alone does not make the engine descend), and leave the original open until the blocker resolves and CI is green (review re-runs then, Approves, and the merger closes); keep this closure blocker distinct from plan's prerequisite-refactor subtask.

## Action Types Reference

${aiHints}

Consult the Action Types Reference above to match task situations to appropriate prompts.
${completionSignals ? `
## Completion Signals

Use these signals to assess whether prior work is complete:

${completionSignals}

**Core Principle:** Block on inability to proceed, not on missing checkboxes. Simple tasks need simple validation. Use the readiness check as the ultimate arbiter.
` : ''}
## Comments vs Description

- **COMMENTS**: Process notes, investigation, discussion history, feedback
- **DESCRIPTION**: Finalized scope, key findings, implementation plan, completion summary

Use comments for exploration; update description for task overview accuracy.

## Label Instructions in Generated Prompts

- Bug resolution → include "leave the \`bug\` label in place; moving the task to Done marks it resolved — the label is the lasting bug-vs-feature record used by reports, so do not remove it"

## Instructions
1. Follow the decision tree above IN ORDER (preparation → blockers/bugs → implement)
2. Recommend exactly ONE action - do not combine multiple steps
3. Generate a tailored prompt for that single action

Respond in EXACTLY this format. The block below is a skeleton to fill in: replace each \`<…>\` slot with your own content and delete the slot markers. Do NOT copy these field descriptions, the angle brackets, or the rules underneath into your answer — they are guidance for you, not text to emit.

## Reasoning
**Assessment:**
- Preparation: <✓ Complete | ✓ Not needed | ✗ Needed> - <brief reason, mention comments if relevant>
- Blockers: <✓ None | ✗ Blocked> - <brief reason>
- Ready: <✓ Yes | ✗ No> - <brief reason>
${completionSignals ? `**Signal Status:** <if assessing prior work, note which signals are met/unmet>
` : ''}→ **<action>**
**Next:** <one sentence: what happens after this action completes>

## Prompt
<the complete prompt text, following the Prompt Structure above>

Rules for the lines above — follow them, do not restate them in your answer:
- \`<action>\` must be EXACTLY one action name, verbatim, from this list: ${actionNames}. Keep the surrounding \`**\` bold markers. This name is parsed into a machine-readable kind downstream, so do not rename, pluralize, or invent a value outside the list.
- Add a \`**DeferTo:** <child-id>\` line immediately after the \`→ **<action>**\` line ONLY when the action is \`defer\` (for example, \`**DeferTo:** ${identifier.split('-')[0] || 'ABC'}-123\`). Emit the bare identifier and nothing else — it is parsed structurally to trigger the descent. OMIT this line entirely for every other action.
- When the action is \`defer\`, leave the \`## Prompt\` section empty: the prompt is generated once, later, at the terminal actionable node, never on a node you defer past.`;

  // Capability-aware post-process (LIN-177 S5). Renames the tracker "Linear" →
  // provider displayName and strips " in {tracker}" suffixes when the tracker is
  // read-only or the user flag is off. write/subtasks are forced true: the workflow
  // block above already handles write-gating, and the meta-prompt renders no
  // subtask sections, so this pass only does the rename + suffix strip. For Linear
  // with the flag on, caps is the Linear floor and this is a no-op.
  return applyPromptCapabilities(metaPrompt, { ...caps, write: true, subtasks: true });
}

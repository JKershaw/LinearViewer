/**
 * The next-stage choice's own home (LIN-3304).
 *
 * Routing is a subtractive mask over the writing template no more: the routing
 * sections of the meta-prompt, the reply contract they elicit, and the parse that
 * reads the chosen stage back all live here. `routerFragments` owns the text;
 * `lib/prompts/meta-prompt-template.js` composes the SAME fragments into the full
 * template, so the full path is byte-identical while routing-only stops being a
 * mask. `buildRouterPrompt` is what a writer-on recommendation call sends;
 * `routeStage` is what reads its reply back into a stage decision.
 *
 * LIN-3309 fixed the two defects this seam used to carry: a `**Reasoning**` header
 * no longer blanks the streamed reasoning (openrouter.js emits the catch-up
 * delta), and an out-of-list kind such as `retro` is rejected here and in the
 * full-mode parse.
 */
import { deriveDispatchKind } from './prompt-templates.js';
import { rejectExcludedKind } from './action-kind.js';
import { resolvePromptUi, applyPromptCapabilities } from './prompt-formatters.js';
import { formatPlanReviewFactsBlock } from './recommendation-facts.js';

/**
 * Extract the recommended action from a recommendation's Reasoning section. The
 * action is emitted as `→ **<name>**` (see this module's replyRules fragment).
 * @param {string|null|undefined} reasoning
 * @returns {string|null}
 */
export function parseRecommendedAction(reasoning) {
  if (typeof reasoning !== 'string') return null;
  const match = reasoning.match(/→\s*\*\*(.+?)\*\*/);
  return match ? match[1].trim() : null;
}

/**
 * Extract the defer target from a recommendation's Reasoning section. A `defer`
 * recommendation emits `**DeferTo:** ABC-123`, read structurally so prose drift
 * can never break the descent. Accepts a Linear identifier or a UUID.
 * @param {string|null|undefined} reasoning
 * @returns {string|null}
 */
export function parseDeferTo(reasoning) {
  if (typeof reasoning !== 'string') return null;
  const match = reasoning.match(/DeferTo:\s*\*{0,2}\s*([A-Za-z][A-Za-z0-9]*-\d+|[0-9a-fA-F]{8}-[0-9a-fA-F-]{27,})/);
  return match ? match[1].trim() : null;
}

/**
 * The planned follow-up after the chosen stage, from the `**Next:**` contract line.
 * @param {string|null|undefined} reasoning
 * @returns {string|null}
 */
export function parseNext(reasoning) {
  if (typeof reasoning !== 'string') return null;
  const match = reasoning.match(/\*\*Next:?\*\*:?[ \t]*([^\n]+)/);
  return match ? match[1].trim() : null;
}

/**
 * The `**Assessment:**` block, up to the action line. Parsed for the seam's
 * decision object; the writer still reads only the action and Next lines
 * (routerFocus), so this is additive.
 * @param {string|null|undefined} reasoning
 * @returns {string|null}
 */
export function parseAssessment(reasoning) {
  if (typeof reasoning !== 'string') return null;
  const match = reasoning.match(/\*\*Assessment:\*\*([\s\S]*?)(?=\n?\s*(?:→|\*\*Next:))/);
  return match ? (match[1].trim() || null) : null;
}

/**
 * The routing half of the meta-prompt, as named fragments. The meta template
 * composes these (with its writing blocks) byte-identically; `buildRouterPrompt`
 * concatenates them alone for the writer-on live path.
 *
 * @param {Object} params - the same routing inputs the meta template receives
 * @returns {{role, context, decisionIntro, decisionRest, actionReference, instructions, replyHeader, replyRules, trailing}}
 */
export function routerFragments({
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
  planReviewFacts = null,
  isTerminal = false,
  hasOpenChildren = false
}) {
  const actionNames = actionVocabulary || 'plan, research, implement, review, breakdown, blocked, bug';
  const frontierFactsBlock = (hasSubtasks && frontierFacts && frontierFacts.openCount > 0) ? `
**FRONTIER FACTS (deterministic — do not re-derive):**
- Open children: ${frontierFacts.openCount} (${frontierFacts.blockedCount} blocked, ${frontierFacts.openCount - frontierFacts.blockedCount} actionable)
- Per open child: ${frontierFacts.openChildren.map(c => `${c.identifier} ${c.blocked ? '[blocked]' : '[actionable]'}`).join(', ')}
- Frontier next child (skip-blocked, unblocks-most/critical-path ranked): ${frontierFacts.nextChild || 'none — all open children blocked'}
- Plan session-fit answer: ${frontierFacts.sessionFit || 'none found in plan — read the plan to confirm'}

Use these for the defer-vs-breakdown decision below instead of re-counting: if there is an actionable frontier child and the node is a healthy container, \`defer\` into it; if no child covers the remaining scope or the plan says "needs multiple sessions", \`breakdown\`.
` : '';
  const planReviewFactsBlock = formatPlanReviewFactsBlock(planReviewFacts);
  return {
    role: `You are a workflow coordinator recommending next actions. You analyze task state and recommend the single most appropriate prompt type, but you do not make implementation decisions or modify tasks directly.

You are helping a developer decide their SINGLE next action on a Linear task.`,
    context: `

## Task Context
${issueContext}

`,
    decisionIntro: `## CRITICAL: Sequential Workflow Decision

You must recommend exactly ONE action. Follow this decision tree IN ORDER:

`,
    decisionRest: `**Priority when multiple conditions apply:** already-complete (→ \`review\`, then \`close-out\` once review has approved) > blocked > bug > preparation > implementation. Address the highest-priority condition first.
${isTerminal && hasOpenChildren ? `
### Step 0: This task is terminal but still has open children

The task's own state is terminal, yet it has open (non-terminal) children — the remaining work lives in those children, not here. Do NOT short-circuit to review/close. Continue to the descent logic below (Step 4) and route to the open child.
` : (!hasOpenChildren && (isTerminal || hasSubtasks)) ? `
### Step 0: The substantive work here is already complete — recommend \`review\`, \`close-out\`, or \`retrospective-audit\`

There is no open (non-terminal) child to descend into, and the task's own work is already finished${isTerminal ? `: its state is already a terminal state (Done / Canceled / Duplicate)` : `: the task itself is still open, but all ${subtaskCount} of its subtasks are in a terminal state (Done / Canceled / Duplicate), so the only work left is this task's own close-out`}. Closing out a finished task is a staged sequence — pick the branch that matches where it actually stands:
- **No review verdict on record yet → recommend \`review\`.** Verify the finished work holds up against the goal, count anything missing as this work, and write the \`### What CI Did Not Prove\` ledger with a verdict that is conditional when the ledger is non-empty. Treat completion as a SIGNAL to confirm-and-close: do NOT recommend \`look-into\`, \`triage\`, \`research\`, or \`implement\` as if the task were unstarted, never redo completed work, do NOT re-open finished subtasks, and do NOT \`defer\` into a finished child (a no-op the system rejects, leaving no actionable prompt).
- **Review has already recorded an Approve (or Approve — conditional) verdict and a ledger, but the work is still unmerged / not Done → recommend \`close-out\`, NOT another \`review\`.** This is the inverted stuck-review signal: an Approve on record with the code unchanged means the next action is the ledger-gated close — discharge or explicitly accept each ledger item, then merge, set Done, post the summary, archive & prune, file follow-ups. \`close-out\` owns the merge and the Done transition; \`review\` never performs them.
- **A review verdict is on record AND the work is already merged and Done (close-out has already run) → recommend \`retrospective-audit\`, NOT another \`review\` or \`close-out\`.** The work is genuinely finished — merged, reviewed, closed — so there is nothing left to authorize (\`review\`) or land (\`close-out\`); recommending either again is at best a no-op and at worst re-litigates a decision that is not this step's to reopen. \`retrospective-audit\` audits the landed change's claims and tests against the code (see its quality rule below).

\`close-out\` requires positive evidence that a review actually ran — a comment where a review recorded a verdict. A rich, detailed, or complete-looking description is not that evidence, and neither is the work merely looking done. **And a \`bug\`'s own investigation commentary is NOT a review verdict:** a \`bug\`-labelled task posts its own rich analysis — a \`Root cause CONFIRMED\` / findings write-up, a class-check, a stepper run-summary — which can read review-ish, but it is the author's own diagnosis of the problem, not a fresh-eyes review that recorded a verdict on the deliverable; do NOT count root-cause, findings, class-check, or run-summary comments as review evidence. **And a \`plan-review\` verdict is NOT a review verdict either:** \`plan-review\` deliberately reuses review's Approve / Request Changes / Needs Discussion vocabulary, but it verifies the PLAN before implementation — an Approve there says the plan's grounding claims hold up, never that the work was built and checked, so counting it here would authorize \`close-out\` on unimplemented work. Such a comment is typically headed \`### Plan Review Verdict\` and reads about surfaces, strategy framing, session-fit, or a relaxation guard rather than about a deliverable; treat a verdict on the plan as review evidence for NOTHING, whether or not that header is present — the header is a disambiguator between the two verdict kinds, not the thing the gate keys on. Only an actual \`review\` verdict on the trail — a comment recording an explicit Approve / Request Changes / Needs Discussion (typically with the \`### What CI Did Not Prove\` ledger) — authorizes \`close-out\`; if no such review comment is on the trail, the review has not happened — recommend \`review\`. When the evidence is ambiguous, default to \`review\`.

**Cannot-close branch:** \`review\` authorizes the close and \`close-out\` performs it; the close can only proceed when CI is green (or CI is genuinely absent and the two-branch substitute has been run and recorded) and the work is ready to merge. If the comments already show the work landed but CI is red, or that verifying it surfaced a blocker that must be fixed first, do NOT keep routing to \`review\` or \`close-out\` — it is still this task's work, so route instead to the stage that fixes it here (\`bug\`/\`plan\`/\`implementation\`, or \`blocked\` if only a person can settle it), never to a new ticket; the original is Approved on a later \`review\` and closed by \`close-out\` once it is fixed and CI is green.
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
- The ticket already contains the findings AND a chosen, validated approach — research was already done and its results are in the description/comments. Move forward; do not loop research. For a subtask created by breakdown, a copied slice of the parent's approved plan — naming its surfaces, approach, and tests, plus a citation of the parent's approving plan-review verdict — counts as findings-plus-validated-approach already in hand; do not route it to research merely because this specific ticket is freshly created — **unless the copied slice visibly diverges from what the cited approving verdict approved, in which case this guard does not apply and the child is treated as ungathered (see the gate paragraph below).**
${hasComments ? `- There are ${commentCount} comment(s) — check whether they already resolve the unknowns or contain prior findings; if so, treat research as done.` : ''}

→ If the knowledge the deliverable depends on is not yet gathered, OR the approach rests on an unvalidated assumption, OR the ticket prescribes research as its method → Recommend research first
→ If the substance is already in hand AND the approach is validated/familiar → Skip to Step 2
→ If the description is empty or too vague to know the intent → Recommend look-into or triage before other actions

### Step 2: Is the task blocked or has a bug?

Check if task has blockers or bugs that need addressing first:
- Blocked: work is stuck on an external dependency, decision, or missing info — detect this from the blocking relationship (an incomplete \`blocks\`/\`blocked-by\` relation, or the frontier facts above showing the task/its children blocked), NOT from a label.
- \`bug\` label: Unexpected behavior that needs investigation

If blocked → First check if blocking dependencies are already resolved (e.g., the blocking issue is Done). If so, the generated prompt should skip full analysis — just confirm the task is unblocked and recommend the next action. Only recommend full blocker analysis if the blocker is still active.
If bug → **First check whether the bug has already been investigated — do NOT loop research.** A \`bug\` label marks *unexpected behavior*, not *investigation still owed*; its mere presence is NOT a reason to investigate again. ${hasComments ? `There are ${commentCount} comment(s) — read them: if they ` : 'If the comments or description already '}already contain a code-grounded investigation that identifies the root cause AND a fix approach (the \`bug\` completion signal — "issue understood well enough to fix" — is met), the investigation is **done**. Recommend \`implementation\` (or \`plan\` if the fix needs sequencing across surfaces) to apply the fix, or \`review\` if the fix is already applied and you are only confirming it.

**Divergence veto — resolve this BEFORE you treat any investigation as \`done\`.** An investigation is \`done\` only if its conclusion still STANDS at the END of the trail. Read the comments in order to the most recent one and ask: *has a later comment overturned the earlier root cause?* If any later comment **refutes, contradicts, relocates, or reclassifies** the proposed cause (e.g. a live capture, test, or repro showing the cause "does not fire", is "upstream", was "reclassified", or otherwise does not hold), OR the cause is still **unvalidated** — the decisive confirming experiment the investigation itself named was never run, or has not yet produced a pass / the owed acceptance capture is still missing — then the investigation has **DIVERGED** and is **NOT** done. This holds *no matter how long, detailed, confident, or fix-oriented the earlier write-up reads, and no matter how much fix-planning prose surrounds it*: weigh the trail by what still STANDS at the end, never by the length or authority of the earliest analysis. A thorough, "ready to implement" investigation that a single shorter later comment refutes is **refuted, not ready** — the surrounding "the fix must …" / "ready to hand off" language is part of the now-overturned analysis, not evidence the cause holds. When the trail has diverged you MUST NOT recommend \`implementation\` (nor \`plan\`/\`review\` to advance the fix): the standing conclusion is "the cause is not yet confirmed", and any fix built now is built against a refuted or unproven cause. Route back to investigation — run the decisive experiment, or re-investigate from the relocated cause — via \`bug\` (or \`research\` if the next step is discovery/an experiment rather than a labeled-bug debug). (This veto is about a *diagnosed bug cause* a later comment overturns; a stuck *implementation* whose attempts merely keep hitting the same wall — no prior cause overturned — is the Step-3 implementation-stuck loop, re-grounded via \`plan\`/\`research\`/\`blocked\`.)

Re-investigate when no prior investigation exists, the prior findings are incomplete or contradicted (by the current code OR by a later comment in the trail), the named root cause was refuted/relocated and its replacement not yet validated, the decisive confirming experiment was never completed or its owed acceptance capture is still missing, or the observed behavior has changed since they were written. Advance to the fix ONLY when the latest standing conclusion is a confirmed root cause with a validated fix direction. Otherwise → Recommend bug investigation.

### Step 3: Is the task ready for planning or implementation?

**FIRST — before the plan check below — check whether the implementation has ALREADY landed.** This already-landed guard applies to EVERY task that reaches Step 3, regardless of whether it has a formal plan and regardless of whether the change looks "simple enough to implement directly." Read the comments and description against the implementation completion signals (code committed, a PR opened or merged, tests passing, a summary comment recorded) — the same kind of soft, evidence-based check used for bugs in Step 2. There is no deterministic "landed" marker (this coordinator does not see git, PRs, or CI), so judge it from the recorded evidence, not a checkbox; when that evidence is thin or absent, the work is NOT done — continue to the plan check below.
- Implementation already landed (the surfaces are built AND a completion summary, or a committed-and-tested signal such as a "PR merged" comment, is recorded) → Recommend \`review\` — verify the finished work holds up, for close-out to land. This fires for a plan-less \`research → implementation\` leaf exactly as it does for a planned task: a leaf that reached implementation directly (no \`plan\` step, so no \`## Implementation Plan\` block and no session-fit answer in its description) still routes to \`review\` once its work has demonstrably landed — do NOT let the absence of a formal plan, or a present-tense "Next step:" directive left over from research, send it back to \`implementation\`. Do NOT re-recommend \`implementation\` on work that is already done; an In Progress state is NOT by itself evidence the work is unfinished, and "the change is small enough to just do it" is NOT a reason to skip this landed-evidence check. One exception, never a repeated \`review\`: if the work landed but CI is red, or review found a bigger problem the fix exposed, it is still this task's work — route to the stage that fixes it here (via Step 2), not to a new ticket, and \`review\` re-runs once it is fixed and CI is green. **Stuck-review signal:** if the comment trail already shows a prior \`review\` that requested changes (or flagged a blocker) AND the code has not changed since — no acknowledgment or fix commit in between — then review is looping. Do NOT recommend \`review\` again: another review on an unchanged commit only repeats the prior verdict. The review already did its job; the missing step is the fix the review named. Route to that fix via Step 2 — \`implement\` to apply it (or \`plan\`/\`blocked\`/\`bug\` if the named blocker needs sequencing or is external). This signal fires ONLY when a prior review is already on record; it does not apply to work that has never been reviewed.
- Implementation landed AND \`review\` has already recorded an Approve (or Approve — conditional) verdict with its \`### What CI Did Not Prove\` ledger, but the work is still unmerged / not Done → Recommend \`close-out\` — the ledger-gated finish (discharge or explicitly accept each ledger item, then merge, set Done, post the summary, archive & prune, file follow-ups), NOT a repeated \`review\`. An Approve on record with the code unchanged is the signal that the next step is the close, not another review pass. (Counterpart to the Stuck-review signal above: requested-changes-and-unchanged → the fix; approved-and-unchanged → \`close-out\`.) \`close-out\` requires positive evidence that a review actually ran — a comment where a review recorded a verdict. A rich, detailed, or complete-looking description is not that evidence, and neither is the work merely looking done. **And a \`bug\`'s own investigation commentary is NOT a review verdict:** a \`bug\`-labelled task posts its own rich analysis — a \`Root cause CONFIRMED\` / findings write-up, a class-check, a stepper run-summary — which can read review-ish, but it is the author's own diagnosis of the problem, not a fresh-eyes review that recorded a verdict on the deliverable; do NOT count root-cause, findings, class-check, or run-summary comments as review evidence. **And a \`plan-review\` verdict is NOT a review verdict either:** \`plan-review\` deliberately reuses review's Approve / Request Changes / Needs Discussion vocabulary, but it verifies the PLAN before implementation — an Approve there says the plan's grounding claims hold up, never that the work was built and checked, so counting it here would authorize \`close-out\` on unimplemented work. Such a comment is typically headed \`### Plan Review Verdict\` and reads about surfaces, strategy framing, session-fit, or a relaxation guard rather than about a deliverable; treat a verdict on the plan as review evidence for NOTHING, whether or not that header is present — the header is a disambiguator between the two verdict kinds, not the thing the gate keys on. Only an actual \`review\` verdict on the trail — a comment recording an explicit Approve / Request Changes / Needs Discussion (typically with the \`### What CI Did Not Prove\` ledger) — authorizes \`close-out\`; if no such review comment is on the trail, the review has not happened — recommend \`review\`. When the evidence is ambiguous, default to \`review\`.

**If the work has not landed, check whether the solution *shape* is still contested BEFORE checking for a plan (the design hatch).** A plan enumerates surfaces for a shape that is *already chosen* — it is not where the shape itself should be decided. So once the work has not landed AND the knowledge it rests on is gathered (Step 1 passed), ask one question before the plan check: are there ≥2 genuinely viable, materially-different solution shapes here, and has the ticket/discussion NOT yet committed to one? If so → Recommend \`design\` — weigh the competing shapes and surface the fork explicitly, so the choice is made deliberately rather than settled silently inside planning (the failure mode where a plan quietly picks an architecture and the wrong shape is only caught at the human gate, forcing a re-work). This is an *upward hatch* on the same one-directional down-lifecycle bias the "No committed scope ⇒ never \`implement\`" rule below guards: when the shape is genuinely contested, resolve to \`design\`, not straight past it to \`plan\`. **Over-fire guards — do NOT fire \`design\` when:** (a) the knowledge the shapes would be weighed against is itself still ungathered — that is \`research\`, and Step 1 owns it first; (b) there is one obvious shape (a familiar refactor, a single-surface change, a task whose approach is simply not in question) — plan/implement it, do not manufacture a fork where none exists; (c) the ticket or a comment has already committed to an approach, or the work is already built/landed (the landed check above already routes that to \`review\`) — a decided shape is a \`plan\`, never a \`design\`; (d) the ambiguity lives in the *requirements* themselves (what to build, the boundaries) rather than the solution shape (how to build it) — that is \`scoping\`, not \`design\`. When no genuine shape-fork survives these guards, continue to the plan check.

**If the work has not landed, check whether a plan exists.** Read the issue description for an implementation plan (files to modify, approach, testing strategy) and a clear answer to whether the work fits one focused session. A complete plan documents both — the plan phase enumerates surfaces with any dependency arrows between them, then commits to a session-fit answer of either "fits one session" or "needs multiple sessions."

**If no plan exists, or the plan has not committed to a session-fit answer → Recommend \`plan\`.**

**No committed scope ⇒ never \`implement\`.** The absence of committed scope is not a license to start building — it is itself the signal to \`plan\` (or \`research\` when the underlying knowledge is also ungathered, per Step 1). "Committed scope" means the work has been pinned to specific surfaces with a deliberate, in-hand answer to *what changes where* — either a documented plan, or a genuinely small single-surface task whose one file and one change you can already name. A task is NOT scoped merely because its intent is legible, its description is long, or it lists "proposed changes": a rich-but-unscoped description, a broad multi-surface migration, and an empty/vague one all share the SAME next action — pin the scope first via \`plan\`/\`research\`, never \`implement\`. This miss is one-directional — the standing bias is to reach too far down-lifecycle — so when the scope signal is weak, absent, or ambiguous, resolve DOWN to \`plan\`/\`research\`, not up to \`implement\`. This rule fires only when scope is ABSENT — it never overrides a plan that exists: a committed plan still routes on its session-fit answer ("fits one session" → \`implementation\`, "needs multiple sessions" → \`breakdown\`), and genuinely landed work still routes to \`review\`.

**Completed prep ⇒ never re-emit the prep verb.** The mirror of the rule above: a prep verb (\`research\`/\`plan\`) is owed only when its deliverable does NOT already exist and settle in the artifacts — never re-recommend a preparation stage whose work is already complete. A ticket whose description already carries a complete plan (surfaces enumerated, an approach, and a committed session-fit answer of "fits one session" / "needs multiple sessions"), and/or a breakdown-shaped plan comment, AND has no child issues yet → the plan stage is DONE: route on its session-fit answer to \`breakdown\` (needs multiple sessions) or \`implementation\` (fits one session), NEVER another \`plan\`. Weigh what the artifacts already DELIVER — not the node still being In Progress, and NOT the plan's own self-referential prose: a settled plan that names its own "recommended next action" as "create the Phase A subtask" / "file the … subtask" / "a plan ticket that sequences …" is describing a \`breakdown\` (decompose the finished plan into subtasks), not asking for more planning — that prose is the plan's output, not evidence planning is still owed. (Same artifact-completeness read as the Step-2 divergence veto, opposite pole: settled-prep vs not-yet-started-prep.) This composes with the no-committed-scope rule as its mirror — scope ABSENT resolves DOWN to \`plan\`/\`research\`; a settled prep deliverable PRESENT resolves UP to \`breakdown\`/\`implementation\` — and it overrides neither opposite pole: a genuinely thin or absent plan still → \`plan\`; a fresh ticket whose underlying knowledge is ungathered still → \`research\`; scope-absent still never routes to \`implement\`. A subtask whose own description carries such a copied approved-parent-plan slice with a committed session-fit answer is itself a complete plan for the purposes of this rule — treat it as settled prep even though the \`plan\` step never literally ran on this specific ticket; do not recommend \`plan\` merely because this ticket has no \`plan\`-session history of its own. **This settled-prep read does NOT apply when the child's copied slice visibly diverges from what the cited approving verdict approved** — a diverged slice is not settled prep; fall through to the plan-review gate immediately below, which re-derives on that same divergence. ONE exception, and only one: a \`plan-review\` that recorded **Request Changes** or **Needs Discussion** makes the plan's deliverable un-settled again, so the revision pass it names IS a \`plan\` that is still owed — see the plan-review gate just below.

**Before routing on session-fit, check whether a \`plan-review\` is due (the plan-review gate).** A plan on record is not automatically ready to build against. Recommend \`plan-review\` when ALL of these hold: a plan exists; the gate is met; and NO plan-review verdict is on the trail yet. **The gate is met** when the plan says so itself ("plan-review due: yes", the answer the plan phase is instructed to record) or when, reading the plan, any of these is true: (a) the session-fit answer is "needs multiple sessions"; (b) it names a routed-around contract gap with a ticket identifier (as opposed to an explicit "none identified"); (c) any step relaxes a validation, a contract, or a guard — a widened input, a dropped check, a softened assertion, a gate turned advisory; (d) it touches credential, merge-rule, or dispatch-contract surfaces. **When none of (a)–(d) holds, do NOT emit \`plan-review\`** — fall straight through to the session-fit routing below, exactly as before this gate existed. The step is gated, not universal: it exists to protect the throughput of the work that needs it, so a clean small plan must reach \`implementation\` with no extra dispatch, and a plan's own "plan-review due: no" is taken at face value unless the plan visibly contradicts it (a named routed-around gap sitting beside a "no" is the contradiction to act on).

**A breakdown child's copied approved-plan slice clears the gate.** A subtask created by breakdown that copies an approved-parent-plan slice and states \`plan-review due: no — covered by <parent>'s approving plan-review (comment <id>, rev <N>)\` is honored exactly like any other plan's own recorded "no": criterion (d) does not re-fire solely because the underlying surface is the same dispatch-contract surface the cited parent verdict already cleared. Re-derive the gate independently only if the child's copied slice visibly diverges from what the cited parent verdict approved, or the child's own description adds scope the parent's plan-review never saw.

**Once a plan-review verdict IS on the trail, route on the PLAN-REVIEW FACTS below (computed in code — do not re-count or re-derive it). Follow its precedence, first match wins.** An Approve authorizes implementation only — it is never close-out evidence.
${planReviewFactsBlock}
**Otherwise route on the session-fit answer — and read multi-phase structure as itself a session-fit signal:**
- Plan says "needs multiple sessions" → Recommend \`breakdown\` (the breakdown phase creates subtasks by copying the plan's dependency arrows into \`blocked-by\` relations)
- **A clearly multi-phase task is a \`breakdown\` — not another \`plan\`, and not a single \`implementation\`.** A multi-phase structure is itself a "needs multiple sessions" answer even when the description never types the words and never states a formal session-fit verdict: this is the explicit exception to the "no committed session-fit answer → \`plan\`" rule above. When the work is organized into delineated phases that each reach their own landable/verifiable outcome (each phase has its own acceptance, ships or closes on its own, or Phase 1 can land before Phase 2 starts) AND the task has not yet been decomposed into subtasks, the honest next action is \`breakdown\` — decompose into one subtask per phase — EVEN IF each phase's micro-scope is not yet pinned, because pinning per-phase scope is exactly what the breakdown's subtasks do. Do NOT send such a task back to \`plan\` (the phases already ARE the plan's structure — it does not need another planning pass to answer a session-fit question its shape has already answered), and do NOT route it to \`implementation\` (building only Phase 1 inside one session, then blocking on whether to continue, is precisely the failure this avoids). Overfit guard: the signal is **phases that independently land or span sessions**, NOT "the description mentions two things" and NOT "the steps can be counted" — a single-session task whose plan merely lists two or more sequential steps that land together as one cohesive change (one PR, one close-out) is still \`implementation\`. Ask: would each phase close clean on its own audit trail? Yes → \`breakdown\`; only-makes-sense-landed-together → \`implementation\`.
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
`,
    actionReference: `## Action Types Reference

${aiHints}

Consult the Action Types Reference above to match task situations to appropriate prompts.
${completionSignals ? `
## Completion Signals

Use these signals to assess whether prior work is complete:

${completionSignals}

**Core Principle:** Block on inability to proceed, not on missing checkboxes. Simple tasks need simple validation. Use the readiness check as the ultimate arbiter.
` : ''}
`,
    instructions: `## Instructions
1. Follow the decision tree above IN ORDER (preparation → blockers/bugs → implement)
2. Recommend exactly ONE action - do not combine multiple steps
`,
    replyHeader: `
Respond in EXACTLY this format. The block below is a skeleton to fill in: replace each \`<…>\` slot with your own content and delete the slot markers. Do NOT copy these field descriptions, the angle brackets, or the rules underneath into your answer — they are guidance for you, not text to emit.

## Reasoning
**Assessment:**
- Preparation: <✓ Complete | ✓ Not needed | ✗ Needed> - <brief reason, mention comments if relevant>
- Blockers: <✓ None | ✗ Blocked> - <brief reason>
- Ready: <✓ Yes | ✗ No> - <brief reason>
${completionSignals ? `**Signal Status:** <if assessing prior work, note which signals are met/unmet>
` : ''}→ **<action>**
**Next:** <one sentence: what happens after this action completes>

`,
    replyRules: `Rules for the lines above — follow them, do not restate them in your answer:
- \`<action>\` must be EXACTLY one action name, verbatim, from this list: ${actionNames}. Keep the surrounding \`**\` bold markers. This name is parsed into a machine-readable kind downstream, so do not rename, pluralize, or invent a value outside the list.
- Add a \`**DeferTo:** <child-id>\` line immediately after the \`→ **<action>**\` line ONLY when the action is \`defer\` (for example, \`**DeferTo:** ${identifier.split('-')[0] || 'ABC'}-123\`). Emit the bare identifier and nothing else — it is parsed structurally to trigger the descent. OMIT this line entirely for every other action.`,
    trailing: ``
  };
}

/**
 * Apply the provider-capability post-process to an assembled meta/router prompt
 * (LIN-3304, review finding 1). `buildMetaPromptTemplate` ends with this pass;
 * `buildRouterPrompt` must run it too, or the writer-on routing-only prompt
 * diverges from the pre-seam output for non-Linear providers (GitHub Issues,
 * Local): the role line would still say "on a Linear task" and keep an
 * " in {tracker}" suffix. write/subtasks are forced true — the meta-prompt's
 * write gating lives in its inline workflow block and it renders no subtask
 * sections — so this pass only renames the tracker and strips the suffix. For
 * Linear with the tracker flag on it is a no-op, which is why the default-provider
 * tests could not see the divergence.
 * @param {string} prompt
 * @param {Object} [featureFlags]
 * @param {Object} [providerUi]
 * @returns {string}
 */
export function applyRouterCapabilities(prompt, featureFlags, providerUi) {
  const caps = resolvePromptUi(featureFlags, providerUi);
  return applyPromptCapabilities(prompt, { ...caps, write: true, subtasks: true });
}

/**
 * The routing-only prompt the writer-on recommendation call sends. Byte-identical
 * to `buildMetaPromptTemplate({ ...params, routingOnly: true })`.
 * @param {Object} params - see routerFragments
 * @returns {string}
 */
export function buildRouterPrompt(params) {
  const f = routerFragments(params);
  const metaPrompt = f.role + f.context + f.decisionIntro + f.decisionRest + f.actionReference + f.instructions + f.replyHeader + f.replyRules + f.trailing;
  return applyRouterCapabilities(metaPrompt, params.featureFlags, params.providerUi);
}

/**
 * Parse a routing-only reply into the stage decision — the choice's parse/contract,
 * with one owner. `**Reasoning**` and headerless replies both parse (LIN-3309), and
 * a deliberately excluded kind is refused here.
 *
 * @param {string} content - the raw routing reply
 * @param {string} [finishReason]
 * @param {number} [completionTokens]
 * @returns {{action: string, kind: string, deferTo: string|null, next: string|null, assessment: string|null, reasoning: string|null, truncated: boolean, completionTokens: number|null}}
 */
export function parseRouteDecision(content, finishReason, completionTokens) {
  const truncated = finishReason === 'length';
  const reasoningMatch = content.match(/## Reasoning\n([\s\S]*?)(?=\n## Prompt|$)/);
  const reasoning = reasoningMatch ? reasoningMatch[1].trim()
    : (content || '').replace(/^\s*(?:#+\s*|\*\*)?Reasoning(?:\*\*)?:?[ \t]*\n/i, '').trim() || null;
  const action = parseRecommendedAction(reasoning);
  // D2 (LIN-3309): reject a kind the AI recommendation path excludes (e.g. `retro`)
  // here, in the decision seam — not in the pure extractor, which must keep
  // returning it (`parseRecommendedAction` is used elsewhere as a plain reader).
  if (action) rejectExcludedKind(action);

  if (action === 'defer') {
    const deferTo = parseDeferTo(reasoning);
    if (!reasoning || !deferTo) {
      throw new Error('Invalid defer response: missing ## Reasoning or DeferTo target');
    }
    return { action, kind: deriveDispatchKind(action), deferTo, next: parseNext(reasoning), assessment: parseAssessment(reasoning), reasoning, truncated, completionTokens: completionTokens || null };
  }
  if (!reasoning || !action) {
    throw new Error('Invalid response: missing ## Reasoning or recommended action');
  }
  return { action, kind: deriveDispatchKind(action), deferTo: null, next: parseNext(reasoning), assessment: parseAssessment(reasoning), reasoning, truncated, completionTokens: completionTokens || null };
}

/**
 * The seam's one clear function: turn a routing reply into the next-stage choice.
 * @param {string} content
 * @param {string} [finishReason]
 * @param {number} [completionTokens]
 * @returns {ReturnType<typeof parseRouteDecision>}
 */
export function routeStage(content, finishReason, completionTokens) {
  return parseRouteDecision(content, finishReason, completionTokens);
}

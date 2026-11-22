/**
 * Byte budget guard for the prompt surfaces (LIN-3203).
 *
 * Prompt text is carried context: every session that reads a template, the
 * routing prompt or the served runner prompt pays for it in full, across the whole
 * leg. Additions to the process have outnumbered removals about six to one, and
 * rule text is a small slice of the cost — the ratchet is what makes the rules
 * expensive. This guard freezes each prompt surface at the byte size it had when
 * the freeze landed (menu M25, `docs/steady-base.md`).
 *
 * The unit is UTF-8 bytes (`Buffer.byteLength`), not `.length` — an em dash is
 * three bytes. Prompt text still lands as code or a test first where it can, and a
 * shrink needs no edit. A surface grows only with its reason recorded beside the
 * ceiling it raises: the ticket, the bytes, and why the lesson cannot be code or a
 * test (LIN-3633; it replaced the earlier rule that a ceiling could rise only by
 * removing as many bytes from another surface in the same change). No other approval
 * is needed; review reads the comment. `FROZEN_TOTAL_BYTES` sums every ceiling below:
 * raising one ceiling without raising that constant pushes the sum over it and fails,
 * so a raise is a visible edit of a second, clearly labelled constant. The reason is
 * held by `ceilingLinesWithoutTicket` below: every ceiling's line must carry a ticket
 * reference in its comment. That check proves a reference is present, not that a raise
 * changed it; review reads the comment, and `scripts/steady-base-growth.mjs` keeps
 * reporting growth so a trend stays visible.
 *
 * Surfaces and the files that compose them mirror the `GROUPS` table in
 * `scripts/steady-base-growth.mjs` (the four-week growth read), so a drift in
 * one instrument is visible in the other:
 *   - Templates source  : lib/prompt-template-defs.js, lib/prompt-templates.js,
 *                         lib/prompt-formatters.js, lib/prompt-contract.js,
 *                         lib/prompts/stage-kinds.js (the stage-kind records, LIN-4467)
 *   - Templates rendered: generatePrompt() for each PROMPT_TEMPLATES key under one
 *                         fixed fixture (composed output, catches leaks through a
 *                         source the frozen file does not itself contain)
 *   - Stage router      : lib/stage-router.js, source (LIN-3304) + the routing prompt
 *                         rendered with the leaf fixture the eval baseline uses — the
 *                         one prompt a recommendation call sends (LIN-3300)
 *   - Stage intent      : lib/prompts/stage-intent.js, source — the view of every
 *                         stage's Scope and Authority lines, whose text is on the
 *                         records since LIN-4467 (was lib/prompts/brief-writer.js)
 *   - Served runner     : docs/runner-prompt.md, source + buildRunnerKickoff() rendered
 *   - Leftover step     : leftoverPrompt() rendered (lib/dispatch-leftover.js, LIN-4373), the
 *                         one question a resumed builder is asked at its build's [done]
 *
 * The router's byte snapshots (stage-router-prompt-snapshots.test.js) and the
 * `meta-prompt.baseline.txt` guard in rulings-resolution-contract-drift.test.js pin
 * the rendered routing text; this pins its size.
 *
 * Each ceiling's comment says three things: its number, the latest ticket that set
 * it, and one short reason. How it got there is history, kept in
 * `scripts/prompt-template-change-log.md` under "Ceiling history" (LIN-4367). A
 * change that replaces a ceiling's comment moves the old reason there.
 *
 * Run with: node --test tests/unit/prompt-size-budget.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { PROMPT_TEMPLATES, generatePrompt } from '../../lib/prompt-templates.js';
import { buildRouterPrompt } from '../../lib/stage-router.js';
import { buildSelectorArgs } from '../../lib/openrouter.js';
import { buildRunnerKickoff } from '../../lib/prompts/runner-kickoff.js';
import { buildAgentOnboarding, renderLandingAgentPrompt, GUIDE_PATH } from '../../lib/prompts/agent-onboarding.js';
import { signInDoors } from '../../lib/components/landing-hero.js';
import { leftoverPrompt } from '../../lib/dispatch-leftover.js';

// ─── Ceilings, measured at the freeze (LIN-3203) ─────────────────────────────
// Each is the surface's UTF-8 byte count on the freeze branch. A ceiling is a
// cap, not an identity pin: shrinking a surface needs no edit here. Growing one
// needs its reason recorded in the comment beside the ceiling it raises; see
// OVER_CEILING_FIX, used by each assert.

/** Templates, source bytes. Same files `steady-base-growth.mjs` GROUPS as
 * "worker templates". */
export const TEMPLATES_SOURCE_CEILINGS = {
  'lib/prompt-template-defs.js': 94670, // LIN-4521 (close-out fixes, finding-d547d0ce): -25 (94695 -> 94670): Land It no longer calls a post-approval rebase "ordinary mechanics" before handing it back. LIN-4521 (P8): +354 (94341 -> 94695): close-out's Make the Fixes hands a commit pushed after the approval back to review (a finding to review, then review judges the new head), and its merge is pinned to the head review approved; a judge reads this rule, so it is text. LIN-4520 (finding-a610ceb9): -73 (94414 -> 94341): the revision section's call and its import go; the fix-round workflow's own lines are in lib/prompts/fix-round.js. LIN-4520 leftovers: +38 (94376 -> 94414): a Survey's report is one comment on the ticket again (no heading format), so scoping can read it; net -291 from 94705. LIN-4520 (P7): -329 (94705 -> 94376): the retired comment contracts (plan-review, review, close-out, blind read, audit, Surveys) come out of the templates.LIN-4518 step 3 (P5): +450 (94255 -> 94705): the blind read's PRs are its landing's change records (finding 75b33054), with a branch that says the landing could not be read; the comment-PR fallback goes. LIN-4518 finding-53f10ec3: +1 (94254 -> 94255): the space after the comma in blindReadVerdictRecord (a rendered clause the review named). LIN-4518 step 2 (P5): +1276 (92978 -> 94254): the blind read's verdict record, with the change records the landing names (blindReadVerdictRecord); a blind read reads no records, so the ids come in its prompt. LIN-4515 (P2): +101 (92877 -> 92978): the audit's notes PR is recorded as a change on the task (its URL as ref). Code cannot name the stage's own record, which carries the head in-session; the backstop (lib/change-records.js) covers a missing one. LIN-4504 (ruling): -229 (93106 -> 92877): John's ruling (LIN-4504 comment d1d5ab31): design writes no plan record, so the design-writes-plan branch and its switch go; design keeps its summary and gains one line sending the plan to the plan stage. LIN-4504: -775 (93881 -> 93106): the breakdown copy-down (the Approve precondition and the (a)-(e) slice bullets) goes; plan, design, breakdown and implementation point at the plan record and the brief instead of the description. LIN-4502: -2431 (96312 -> 93881): close-out's Archive & Prune section and its step-5 and Land It mentions go with the prune, the write-below route and task snapshots; scoping's size-record step loses 'below the `## As asked` block'
  'lib/prompt-templates.js': 19870, // LIN-4495 (restore, review round 2): -33 (19903 -> 19870): the measured bytes; see the change log's LIN-4495 budget section and FROZEN_TOTAL_BYTES. LIN-4437: +241, finishStagePrompt skips the attachments section for the blind read (code and its comment; the skip is witnessed in tests/unit/lin-4437-blind-read.test.js)
  'lib/prompt-formatters.js': 48631, // LIN-4495 (restore, review round 2): -121 (48752 -> 48631): the measured bytes; see the change log's LIN-4495 budget section and FROZEN_TOTAL_BYTES. LIN-4469 (piece 5): +24 (48728 -> 48752): the folded wording (see FROZEN_TOTAL_BYTES). LIN-4467: +219 (48509 -> 48728): GROUNDING_LISTS, the names each record's grounding points at (the note functions stay here)
  'lib/prompt-contract.js': 1739, // LIN-4520 (finding-9d0c053a): -10 (1749 -> 1739): the close-out row of the reader table goes. LIN-4520 (P7): -222 (1971 -> 1749): the reader table drops the retired comment formats and names the records.LIN-4504 (ruling): -7 (1978 -> 1971): the reader table's plan row names plan alone (ruling d1d5ab31). LIN-4504: +62 (1916 -> 1978): the reader table names the records readers: a plan record and its plan-review finding (lib/records/plan-facts.js), and the review finding Approve ends. LIN-4502: -141 (2057 -> 1916): the reader table's sealed-block row and the close-out prune note go with the seal and the prune
  'lib/prompts/stage-kinds.js': 43733, // LIN-4521 (close-out fixes): +401 (43332 -> 43733): the review contract's line telling review to end the hand-back finding to review on its verdict (finding-b86622c8, +341: nothing else ends it), and the close-out signal that names the hand-back instead of a merge of close-out's own head (finding-d547d0ce, +60); a judge reads both, so it is text. LIN-4521 (leftovers): +40 (43292 -> 43332): close-out's readiness check names the hand-back (a commit pushed after the approval goes back to review), beside the missing-verdict case it already named; a judge reads it, so it is text. LIN-4520 (finding-09a8a73e): -2 (43294 -> 43292): the blind-read catalogue line says the proxy checks its PRs, not a shape it no longer checks. LIN-4520 (finding-9d0c053a): -31 (43325 -> 43294): the close-out contract's title line goes. LIN-4520 leftovers: +108 (43217 -> 43325): the Survey descriptions, catalogue lines and core outcomes say again that a Survey posts one comment on the surveyed ticket; net -542 from 43867. LIN-4520 (P7): -650 (43867 -> 43217): the verdict, review, close-out, blind-read, audit and Survey contracts and signals name records, not comment formats.LIN-4518 finding-53f10ec3: +109 (43758 -> 43867): the conditional-approval line names `in` and `how` (the close-out gate reads findings by task, and a condition needs the check that settles it), and the verdict line says where a change's id is in the brief. A contract a judge reads, so text, not code. LIN-4518 step 2 (P5): +1298 (42460 -> 43758): the plan-review and review verdict-record lines, and the plan-review blocking-finding line; the verdict is a record the stage writes, and only the prompt can tell it so. LIN-4515 (P2): +116 (42344 -> 42460): the implementation contract's change-record sentence (POST records, kind change, its PR as ref and head); the backstop covers a missing one. LIN-4504 (ruling): -83 (42427 -> 42344): ruling d1d5ab31: design's contract is null again (the switch goes). LIN-4504: +266 (42161 -> 42427): plan's and breakdown's signals and plan-review's shape signal read the plan record; design's contract is null (ruling d1d5ab31); the route lines (S1) read the records' facts. LIN-4502: -1118 (43279 -> 42161): close-out's archive and prune text (description, outcome, signal, readiness, the contract's keep-verbatim line) and plan's and scoping's 'below the block' clauses
};

/** Templates, rendered bytes for each PROMPT_TEMPLATES key under FIXTURE_ISSUE +
 * FIXTURE_CONTEXT below. The key set is asserted to match the live registry.
 * Close-out's bug-label line renders only for a bug-labelled task, so not here. */
export const TEMPLATES_RENDERED_CEILINGS = {
  blocked: 3529, // LIN-4345: DECIDE's cut rule and its `DECISION:` route; whether a stage cut the ask is judgement no code sees
  bug: 5043, // LIN-4495 (restore, review round 2): -87 (5130 -> 5043): the measured bytes; see the change log's LIN-4495 budget section and FROZEN_TOTAL_BYTES. LIN-4469 (piece 5): -24 (5154 -> 5130): the folded rule's wording (see FROZEN_TOTAL_BYTES). LIN-4379: +102, the pointer asks the work to name a note entry it used (file and source) where it records its decisions, so the next look-first step citing a finding is checkable; which entry bears on the work is the agent's judgement no code sees
  plan: 10887, // LIN-4520 (P7): -25 (10912 -> 10887): the revision sentence names the plan-review verdict on record, not a comment heading.LIN-4504: +458 (10454 -> 10912): the contract writes a plan record and its plan-review finding and revises it (lib/prompts/plan-record-words.js); the revision reads the plan from the brief. The shapes are what the records route checks (PLAN_ADDRESSEES) and the 422 refuses a description plan, so the code holds the shape; the words tell the planner which call. LIN-4502: -31 (10485 -> 10454): the plan contract no longer says 'below any `## As asked` block' (the seal that wrote that block is retired)
  'look-into': 1762, // LIN-3299: at 1762 since Scope and Authority on every path
  triage: 2252, // LIN-4469 (piece 5, triage fold): -177 (2429 -> 2252): the description-rewrite and subtask clauses, which the write guard refuses (LIN-4468). LIN-3299: at 2429 since Scope and Authority on every path
  breakdown: 4410, // LIN-4504: -913 (5323 -> 4410): the copy-down bullets and their Approve precondition go; each piece is a plan record and each child task names its piece (the child reads it in its brief). LIN-4495 (piece 4): +13 (5310 -> 5323): 'send a finding to the parent task' replaces 'say so on the parent' (C1-37). LIN-4345: DECIDE's cut rule and its `DECISION:` route; whether a stage cut the ask is judgement no code sees
  research: 12017, // LIN-4495 (restore, review round 2): -87 (12104 -> 12017): the measured bytes; see the change log's LIN-4495 budget section and FROZEN_TOTAL_BYTES. LIN-4469 (piece 5): -24 (12128 -> 12104): the folded rule's wording (see FROZEN_TOTAL_BYTES). LIN-4379: +102, the pointer asks the work to name a note entry it used (file and source) where it records its decisions, so the next look-first step citing a finding is checkable; which entry bears on the work is the agent's judgement no code sees
  scoping: 4569, // LIN-4520 leftovers: +8 (4561 -> 4569): scoping reads the Surveys' report comments, so it names them as comments; net 0 from 4569. LIN-4520 (P7): -8 (4569 -> 4561): the two Surveys' reports are read by name, not by their comment headings.LIN-4502: -31 (4600 -> 4569): the size record is written 'into the description', not 'below the `## As asked` block'
  design: 3272, // LIN-4504 (ruling): -507 (3779 -> 3272): ruling d1d5ab31: design keeps its comment and description summary (its pre-LIN-4504 3146) plus one line, DESIGN_PLAN_LINE, saying the plan goes to the plan stage (+126); a line a model reads, held in code by design's null contract and the 422 guard. LIN-4504: +633 (3146 -> 3779): the session-2 switch (since removed by ruling d1d5ab31) had design write a plan record; the bytes it added are gone with the switch. LIN-4495 (restore, review round 2): -87 (3233 -> 3146): the measured bytes; see the change log's LIN-4495 budget section and FROZEN_TOTAL_BYTES. LIN-4469 (piece 5): -24 (3257 -> 3233): the folded rule's wording (see FROZEN_TOTAL_BYTES). LIN-4379: +102, the pointer asks the work to name a note entry it used (file and source) where it records its decisions, so the next look-first step citing a finding is checkable; which entry bears on the work is the agent's judgement no code sees
  spike: 3165, // LIN-4495 (restore, review round 2): -87 (3252 -> 3165): the measured bytes; see the change log's LIN-4495 budget section and FROZEN_TOTAL_BYTES. LIN-4469 (piece 5): -24 (3276 -> 3252): the folded rule's wording (see FROZEN_TOTAL_BYTES). LIN-4379: +102, the pointer asks the work to name a note entry it used (file and source) where it records its decisions, so the next look-first step citing a finding is checkable; which entry bears on the work is the agent's judgement no code sees
  context: 2021, // LIN-3300: at 2021 since the stage rules only the meta-prompt carried moved into their templates
  'plan-review': 8149, // LIN-4520 (P7): -307 (8456 -> 8149): the verdict is a record; the comment format and its Blocking findings count line are gone.LIN-4518 step 2 (P5): +564 (7892 -> 8456): the rendered contract lines above. LIN-4504: +297 (7595 -> 7892): the contract line: Approve ends the plan's review finding, other verdicts leave it open (lib/records/plan-facts.js reads it). LIN-4469 (piece 5): -6 (7601 -> 7595): the folded rule's wording (see FROZEN_TOTAL_BYTES). LIN-4353: the verdict quotes the ask and says how the plan meets it; only the person agrees to a narrowing (the reviewer's judgement)
  implementation: 9216, // LIN-4515 (P2): +111 (9105 -> 9216): the change-record sentence, rendered with the contract (the stage writes its change with the head it has; the backstop covers a missing one). LIN-4504: +182 (8923 -> 9105): the plan is read from the brief's plan part, not an old description (PLAN_FROM_BRIEF, plan-review note 7). LIN-4495 (piece 4): +57 (8866 -> 8923): the ask route (ASK_ROUTE), named after the plan-fidelity check. LIN-4469 (piece 5): -24 (8890 -> 8866): the folded rule's wording (see FROZEN_TOTAL_BYTES). LIN-4441: +397 (8493 -> 8890): the rule's own section (targeted local run, CI as the full proof, no-CI substitute deferred), rendered once beside Establish CI; it replaces the two competing full-suite instructions, which now point to it. A worker's choice of tests is judgement no code or test can enforce
  review: 16742, // LIN-4521 (close-out fixes, finding-b86622c8): +341 (16401 -> 16742): the same line, rendered: review ends the open findings to review on its verdict, mirroring plan-review's finding line. LIN-4520 (P7): -194 (16595 -> 16401): the verdict is a record, not a summary comment; the title, CI line and ### Verdict ending are gone.LIN-4518 finding-53f10ec3: +100 (16495 -> 16595): the same two stage-kinds.js lines, rendered (`in` and `how` on each condition finding). LIN-4518 step 2 (P5): +609 (15886 -> 16495): the rendered verdict-record and conditional-approval lines. LIN-4495 (restore, review round 2): -490 (16376 -> 15886): the measured bytes; see the change log's LIN-4495 budget section and FROZEN_TOTAL_BYTES. LIN-4469 (piece 5): -30 (16406 -> 16376): the folded rule's wording (see FROZEN_TOTAL_BYTES). LIN-4438: -619 (17025 -> 16406): the edges read retired to the blind read; review keeps one sentence, the builder's Retires: line names an entry this diff removes (tests/unit/lin-4374-review-leftover-read.test.js)
  'close-out': 9891, // LIN-4521 (close-out fixes, finding-d547d0ce): -25 (9916 -> 9891): the same Land It rewording, rendered. LIN-4521 (P8): +354 (9562 -> 9916): the same hand-back rule, rendered (see lib/prompt-template-defs.js's ceiling). LIN-4520 (finding-9d0c053a): -88 (9650 -> 9562): the contract's title line goes; the quote reads the run record. LIN-4520 (P7): -23 (9673 -> 9650): the review verdict and the blind read's verdict are read from records, not comments.LIN-4502: -2486 (12159 -> 9673): the archive and prune of superseded stage artifacts is retired, with the write-below route and task snapshots it used
  'retrospective-audit': 5052, // LIN-4520 (P7): -32 (5084 -> 5052): the report is free text, with no heading.LIN-4515 (P2): +90 (4994 -> 5084): the notes PR's record sentence (the audit's own change, its URL as ref); the backstop covers a missing one. LIN-4495 (restore, review round 2): -615 (5609 -> 4994): the measured bytes; see the change log's LIN-4495 budget section and FROZEN_TOTAL_BYTES. LIN-4401 (LIN-4432 review fix): +46 (5563 -> 5609): the findings comment's required heading `## Retrospective audit — <identifier>`. LIN-4401 (LIN-4432 beat 4): +944 (4619 -> 5563): the consequence test (579 bytes, LIN-4401 D1) renders once in Reporting; the notes-PR sentences and the audit's own workflow (the shared read-only one stays for its other users) add the rest; FOLLOW_UP_SHAPE stays. Shape held by tests/unit/lin-4401-outside-find-home.test.js and tests/unit/lin-4432-audit-notes-pr.test.js
  retro: 4265, // LIN-3299: at 4265 since Scope and Authority on every path
  'survey-task': 1180, // LIN-4520 leftovers: +9 (1171 -> 1180): the report is one comment on the ticket again (no heading), which scoping reads; net -1 from 1181. LIN-4520 (P7): -10 (1181 -> 1171): the report is the run's own account, with no headed comment.LIN-4469 (piece 5, follow-up): -23 (1204 -> 1181): the guarded tracker clause comes out of the read-only line. LIN-4248: new at 1204; the hand-tuned task-view Survey wording, verbatim but for the {BASE} sentence and the Goal/Process frame
  'survey-place': 2095, // LIN-4520 leftovers: +9 (2086 -> 2095): the report is one comment on the ticket again (no heading), which scoping reads; net -1 from 2096. LIN-4520 (P7): -10 (2096 -> 2086): the report is the run's own account, with no headed comment.LIN-4469 (piece 5, follow-up): -23 (2119 -> 2096): the guarded tracker clause comes out of the read-only line. LIN-4248: new at 2119; the hand-tuned place-view Survey wording, verbatim but for the {BASE} sentence and the Goal/Process frame
  'blind-read': 4617, // LIN-4518 step 2 (P5): +135 (4482 -> 4617): the verdict-record line, rendered without ids here (the fixture hands none). LIN-4495 (restore, review round 2): -439 (4921 -> 4482): the measured bytes; see the change log's LIN-4495 budget section and FROZEN_TOTAL_BYTES. LIN-4469 (piece 5, follow-up): -24 (4945 -> 4921): the guarded tracker clause comes out of the read-only line. LIN-4438: +154 (4791 -> 4945): the Where-to-stand base rule for a merged PR (its merge commit's first parent), the first live read's find 4: the old rule gave an empty diff once merged; a git rule the reader runs, not a shape code can hold
};

/**
 * The stage router's source bytes (lib/stage-router.js, LIN-3304): the stage selector's
 * rules, its prompt and the reply parse. The stage options it lists are each stage's
 * `route`, counted in the template defs.
 */
export const STAGE_ROUTER_SOURCE_CEILING = 8206; // LIN-4465: -63, the header points at CODE_ROUTES (lib/code-routes.js) instead of naming the four routes in order; lowered to match
/**
 * The routing prompt, rendered bytes for the eval baseline's leaf (a leaf with no
 * comments and no plan, its view a placeholder). It also catches growth in the stage
 * options and the facts code renders (lib/recommendation-facts.js), which no source
 * ceiling covers.
 */
export const ROUTER_PROMPT_RENDERED_CEILING = 10110; // LIN-4401 (LIN-4432 beat 4): +223 (9887 -> 10110): the audit's whenNot clause for a landing an audit already ran on (TRAIL FACTS), with the notes PR's route, and close-out's when for an approved notes PR on a Done ticket; LIN-4370 before it: +96, scoping's `when` covers a size ruling answered after the look-first route's one scoping run; whether a comment answers the ruling is the selector's reading, so code cannot settle it

/** The Scope and Authority view, source bytes (lib/prompts/stage-intent.js; the lines are on the records, LIN-4467). */
export const STAGE_INTENT_SOURCE_CEILING = 1386; // LIN-4467: -2333 (3719 -> 1386; 1424 before the CUT/DECIDE re-export went): the Scope and Authority texts moved to each kind's record (lib/prompts/stage-kinds.js, counted in TEMPLATES_SOURCE_CEILINGS); this file is the view. LIN-4437 before it: +296, the blind read's own reading-pass line, which names no ticket (READING and JUDGE both point at it); whether the reader stays blind is held by the preamble and the attachments skip, tested

/** Served runner prompt, source bytes (docs/runner-prompt.md). */
export const RUNNER_PROMPT_SOURCE_CEILING = 17451; // LIN-4495 (restore, review round 2): -187 (17638 -> 17451): the measured bytes; see the change log's LIN-4495 budget section and FROZEN_TOTAL_BYTES. LIN-3669: §5 names the watchdog's three outcomes; the parent's response to a finished-but-unposted subagent is prose (the parent is a model)
/** Served runner prompt, rendered bytes (buildRunnerKickoff at BASE_URL). */
export const RUNNER_PROMPT_RENDERED_CEILING = 15766; // LIN-4495 (restore, review round 2): -187 (15953 -> 15766): the measured bytes; see the change log's LIN-4495 budget section and FROZEN_TOTAL_BYTES. LIN-3669: the same §5 lines rendered

/** Agent onboarding guide, source bytes (docs/agent-onboarding.md, design notes included). LIN-4085: new file; the served guide is agent-facing prose that must stay wording, not code. Its links and sign-in doors are code-checked in tests/unit/agent-onboarding.test.js. */
export const AGENT_ONBOARDING_SOURCE_CEILING = 4669; // LIN-4085: new at 4207, raised to 4669 (+462) for the walk fixes: the no-door path, the token's handling, the OpenRouter connect route and the README link. The served guide is judgment; the links are code-checked.
/** Agent onboarding guide, rendered bytes: the largest rendering over the 16 sign-in door and free-tier combinations, at BASE_URL. LIN-4085: new. */
export const AGENT_ONBOARDING_RENDERED_CEILING = 3691; // LIN-4085: new at 3207, raised to 3691 (+484) for the same walk fixes; the all-doors, no-free-tier rendering is the largest
/** Landing agent prompt, rendered bytes at BASE_URL (renderLandingAgentPrompt). LIN-4085: new. Copied by a person into their own agent, so it is wording the agent reads, not code. */
export const LANDING_AGENT_PROMPT_CEILING = 584; // LIN-4085: new at 584 (the copied prompt under the sign-in buttons)
/** The leftover step's prompt, rendered bytes at the fixture ticket and PR below (leftoverPrompt, lib/dispatch-leftover.js). */
export const LEFTOVER_PROMPT_RENDERED_CEILING = 1694; // LIN-4495 (restore, review round 2): -804 (2498 -> 1694): the measured bytes; see the change log's LIN-4495 budget section and FROZEN_TOTAL_BYTES. LIN-4401 (LIN-4431 beat 3): +711 (1787 -> 2498): the consequence test (579 bytes) renders once here, as the builder's one outside-find rule; LEFTOVER_RULE's outside clause, the outside sentence and the answer line's three forms together add the rest; shape held by tests/unit/lin-4401-outside-find-home.test.js

/**
 * The total: the sum of every ceiling above. A PR that raises a ceiling raises
 * THIS number with it, in the same change, and says why in the comment beside the
 * ceiling it raises; the raise is a visible edit, reviewed rather than assumed.
 */
export const FROZEN_TOTAL_BYTES = 386334; // LIN-4521 (close-out fixes): +692 (385642 -> 386334), the four ceilings above (-25 + 401 source, +341 - 25 rendered). LIN-4521 (leftovers): +40 (385602 -> 385642), the stage-kinds.js ceiling above. LIN-4521 (P8): +708 (384894 -> 385602), the two ceilings above raised by +354 each. LIN-4520 (finding-09a8a73e): -2 (384896 -> 384894), the stage-kinds.js ceiling above. LIN-4520 (P7 review fixes, finding-9d0c053a and finding-a610ceb9): -202 (385098 -> 384896), the four ceilings lowered above (-114 source, -88 rendered). LIN-4520 leftovers: +172 (384926 -> 385098), the five ceilings raised above for the Survey report comment (+146 source, +26 rendered); still -1638 from 386736. LIN-4520 (P7): -1810 (386736 -> 384926), the sum of the eleven ceilings lowered above (-1201 source, -609 rendered). LIN-4518 step 3 (P5): +450, the blind read's records landing (see lib/prompt-template-defs.js's ceiling). LIN-4518 finding-53f10ec3: +210 (386076 -> 386286), the sum of the three raises above (+1, +109, +100). LIN-4518 step 2 (P5): +3882 (382194 -> 386076), the sum of the five raises above (+1276, +1298, +564, +609, +135). LIN-4515 (P2): +418 (381776 -> 382194), the sum of the four raises above (+101, +116, +111, +90). LIN-4504 (ruling d1d5ab31): -826 (382602 -> 381776): design writes no plan record, so four ceilings fall to measured (prompt-template-defs.js -229, prompt-contract.js -7, stage-kinds.js -83, design -507). LIN-4504: +210 (382392 -> 382602), the sum of the measured bytes: plans become records, so the plan, design, plan-review and implementation texts name the records calls (+458, +633, +297, +182, and stage-kinds.js +266, prompt-contract.js +62) while the breakdown copy-down goes (breakdown -913, prompt-template-defs.js -775); each ceiling above is at its measured bytes, its reason beside it. LIN-4502: -6238 (388630 -> 382392), the sum of the measured bytes: the six ceilings above that the retirement shrank (prompt-template-defs.js -2431, prompt-contract.js -141, stage-kinds.js -1118, plan -31, scoping -31, close-out -2486) are lowered to their measured bytes; every other ceiling is unchanged and already at measured. No ceiling rises.

const BASE_URL = 'https://harbour.example';

// ─── Fixtures (fixed, committed) ─────────────────────────────────────────────
// A representative non-terminal leaf: no parent/siblings/children/comments and
// default feature flags, so the grounding/attachments post-passes self-gate to
// nothing. The point is a stable, reproducible number, not a maximal one — the
// source ceilings catch every conditional branch; the rendered ceilings catch
// growth that leaks in through a composed source.
const FIXTURE_ISSUE = {
  id: 'LIN-0000',
  identifier: 'LIN-0000',
  title: 'Representative leaf task for the prompt byte-budget fixture',
  description: 'A short fixed description used only to freeze prompt byte budgets.',
  url: 'https://linear.app/example/issue/LIN-0000',
  state: { name: 'In Progress', type: 'started' },
  labels: ['plan'],
  assignee: { name: 'Fixture' },
  estimate: 3,
  createdAt: '2026-01-01T00:00:00.000Z'
};

const FIXTURE_CONTEXT = {
  parent: null,
  siblings: [],
  project: { name: 'Fixture Project', description: 'A fixed project used only for byte budgets.' },
  children: [],
  comments: []
};

// LIN-4437: the blind read renders its prompt only for a landing; with no comments it renders the short
// "nothing to read" branch, which would let its real text grow unseen. One landing PR, its kind alone.
const FIXTURE_CONTEXT_BY_KIND = {
  'blind-read': { ...FIXTURE_CONTEXT, comments: [{ body: 'Implementation: https://github.com/example/repo/pull/1', createdAt: '2026-01-02T00:00:00.000Z' }] }
};

// The leaf the baseline snapshot (scripts/eval/regen-baseline.mjs) uses: no comments,
// no plan, its view left as the {{ISSUE_CONTEXT}} placeholder. Rendered this is
// byte-identical to scripts/eval/meta-prompt.baseline.txt.
const ROUTER_PROMPT_ARGS = {
  ...buildSelectorArgs({ identifier: '{{IDENTIFIER}}', title: '', state: {}, labels: [] }, {}),
  view: '{{ISSUE_CONTEXT}}',
  featureFlags: {}
};

// What every over-ceiling failure tells the author to do (LIN-3633).
const OVER_CEILING_FIX =
  'Land the lesson as code or a test first. If the text must grow, raise the ceiling and FROZEN_TOTAL_BYTES ' +
  'with the reason in the comment beside the ceiling (the ticket, the bytes, why not code or a test).';

const sourceBytes = (path) => Buffer.byteLength(readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url))));
const renderBytes = (key) => Buffer.byteLength(generatePrompt(key, FIXTURE_ISSUE, FIXTURE_CONTEXT_BY_KIND[key] || FIXTURE_CONTEXT).prompt);

describe('prompt surfaces stay within their frozen byte budgets (LIN-3203)', () => {
  test('templates source bytes', () => {
    const over = [];
    for (const [file, ceiling] of Object.entries(TEMPLATES_SOURCE_CEILINGS)) {
      const actual = sourceBytes(file);
      if (actual > ceiling) over.push(`${file} is ${actual} bytes, ${actual - ceiling} over its ${ceiling}-byte ceiling`);
    }
    assert.deepStrictEqual(over, [],
      `Prompt template source file(s) grew: ${over.join('; ')}. ${OVER_CEILING_FIX}`);
  });

  test('templates rendered bytes', () => {
    const over = [];
    for (const [key, ceiling] of Object.entries(TEMPLATES_RENDERED_CEILINGS)) {
      const actual = renderBytes(key);
      if (actual > ceiling) over.push(`"${key}" renders to ${actual} bytes, ${actual - ceiling} over its ${ceiling}-byte ceiling`);
    }
    assert.deepStrictEqual(over, [],
      `Template(s) grew: ${over.join('; ')}. ${OVER_CEILING_FIX}`);
  });


  test('stage router source bytes', () => {
    const actual = sourceBytes('lib/stage-router.js');
    assert.ok(actual <= STAGE_ROUTER_SOURCE_CEILING,
      `lib/stage-router.js is ${actual} bytes, ${actual - STAGE_ROUTER_SOURCE_CEILING} over its ` +
      `${STAGE_ROUTER_SOURCE_CEILING}-byte ceiling. ${OVER_CEILING_FIX}`);
  });

  test('routing prompt rendered bytes', () => {
    const actual = Buffer.byteLength(buildRouterPrompt(ROUTER_PROMPT_ARGS));
    assert.ok(actual <= ROUTER_PROMPT_RENDERED_CEILING,
      `The routing prompt renders to ${actual} bytes, ${actual - ROUTER_PROMPT_RENDERED_CEILING} over its ` +
      `${ROUTER_PROMPT_RENDERED_CEILING}-byte ceiling. ${OVER_CEILING_FIX}`);
  });

  test('stage intent source bytes', () => {
    const actual = sourceBytes('lib/prompts/stage-intent.js');
    assert.ok(actual <= STAGE_INTENT_SOURCE_CEILING,
      `lib/prompts/stage-intent.js is ${actual} bytes, ${actual - STAGE_INTENT_SOURCE_CEILING} over its ` +
      `${STAGE_INTENT_SOURCE_CEILING}-byte ceiling. ${OVER_CEILING_FIX}`);
  });

  test('served runner prompt source bytes', () => {
    const actual = sourceBytes('docs/runner-prompt.md');
    assert.ok(actual <= RUNNER_PROMPT_SOURCE_CEILING,
      `docs/runner-prompt.md is ${actual} bytes, ${actual - RUNNER_PROMPT_SOURCE_CEILING} over its ` +
      `${RUNNER_PROMPT_SOURCE_CEILING}-byte ceiling. ${OVER_CEILING_FIX}`);
  });

  test('served runner prompt rendered bytes', () => {
    const actual = Buffer.byteLength(buildRunnerKickoff({ baseUrl: BASE_URL }));
    assert.ok(actual <= RUNNER_PROMPT_RENDERED_CEILING,
      `The served runner prompt renders to ${actual} bytes, ${actual - RUNNER_PROMPT_RENDERED_CEILING} over its ` +
      `${RUNNER_PROMPT_RENDERED_CEILING}-byte ceiling. ${OVER_CEILING_FIX}`);
  });

  test('agent onboarding guide source bytes', () => {
    const actual = Buffer.byteLength(readFileSync(GUIDE_PATH, 'utf8'));
    assert.ok(actual <= AGENT_ONBOARDING_SOURCE_CEILING,
      `docs/agent-onboarding.md is ${actual} bytes, ${actual - AGENT_ONBOARDING_SOURCE_CEILING} over its ` +
      `${AGENT_ONBOARDING_SOURCE_CEILING}-byte ceiling. ${OVER_CEILING_FIX}`);
  });

  test('agent onboarding guide rendered bytes, over every door and free-tier combination', () => {
    let actual = 0;
    for (const githubEnabled of [false, true]) for (const jiraEnabled of [false, true]) for (const emailEnabled of [false, true]) for (const freeTierEnabled of [false, true]) {
      const doors = signInDoors({ githubEnabled, jiraEnabled, emailEnabled }).map(({ label, href }) => ({ label, href }));
      actual = Math.max(actual, Buffer.byteLength(buildAgentOnboarding({ baseUrl: BASE_URL, doors, freeTierEnabled })));
    }
    assert.ok(actual <= AGENT_ONBOARDING_RENDERED_CEILING,
      `The agent onboarding guide renders to ${actual} bytes, ${actual - AGENT_ONBOARDING_RENDERED_CEILING} over its ` +
      `${AGENT_ONBOARDING_RENDERED_CEILING}-byte ceiling. ${OVER_CEILING_FIX}`);
  });

  test('landing agent prompt rendered bytes', () => {
    const actual = Buffer.byteLength(renderLandingAgentPrompt({ baseUrl: BASE_URL }));
    assert.ok(actual <= LANDING_AGENT_PROMPT_CEILING,
      `The landing agent prompt renders to ${actual} bytes, ${actual - LANDING_AGENT_PROMPT_CEILING} over its ` +
      `${LANDING_AGENT_PROMPT_CEILING}-byte ceiling. ${OVER_CEILING_FIX}`);
  });

  test('leftover step prompt rendered bytes', () => {
    const actual = Buffer.byteLength(leftoverPrompt({ issueIdentifier: 'LIN-0000', prUrl: 'https://github.com/example/repo/pull/1' }));
    assert.ok(actual <= LEFTOVER_PROMPT_RENDERED_CEILING,
      `The leftover prompt renders to ${actual} bytes, ${actual - LEFTOVER_PROMPT_RENDERED_CEILING} over its ` +
      `${LEFTOVER_PROMPT_RENDERED_CEILING}-byte ceiling. ${OVER_CEILING_FIX}`);
  });

  test('the rendered budget covers exactly the live PROMPT_TEMPLATES key set', () => {
    // A new template without a budget (or a stale budget for a removed one) is a
    // failure: adding a template means giving it a ceiling with its reason beside it.
    assert.deepStrictEqual(
      Object.keys(TEMPLATES_RENDERED_CEILINGS).sort(),
      Object.keys(PROMPT_TEMPLATES).sort(),
      'Every PROMPT_TEMPLATES key must carry a rendered ceiling and vice versa. A new template needs a ceiling ' +
      'with its reason recorded beside it, and FROZEN_TOTAL_BYTES raised to match. ' + OVER_CEILING_FIX
    );
  });

  test('the sum of every ceiling does not exceed FROZEN_TOTAL_BYTES', () => {
    const ceilingSum = [
      ...Object.values(TEMPLATES_SOURCE_CEILINGS),
      ...Object.values(TEMPLATES_RENDERED_CEILINGS),
      STAGE_ROUTER_SOURCE_CEILING,
      ROUTER_PROMPT_RENDERED_CEILING,
      STAGE_INTENT_SOURCE_CEILING,
      RUNNER_PROMPT_SOURCE_CEILING,
      RUNNER_PROMPT_RENDERED_CEILING,
      AGENT_ONBOARDING_SOURCE_CEILING,
      AGENT_ONBOARDING_RENDERED_CEILING,
      LANDING_AGENT_PROMPT_CEILING,
      LEFTOVER_PROMPT_RENDERED_CEILING,
    ].reduce((sum, n) => sum + n, 0);
    assert.ok(ceilingSum <= FROZEN_TOTAL_BYTES,
      `The ceilings sum to ${ceilingSum} bytes, ${ceilingSum - FROZEN_TOTAL_BYTES} over the frozen total ` +
      `${FROZEN_TOTAL_BYTES}. Raising FROZEN_TOTAL_BYTES by ${ceilingSum - FROZEN_TOTAL_BYTES} is a deliberate, ` +
      `reviewable edit, made together with the reason beside the ceiling that rose. ${OVER_CEILING_FIX}`);
  });
});

// ─── The reason beside every ceiling (LIN-3633) ──────────────────────────────

/**
 * The ceiling lines in the block between the "Ceilings, measured at the freeze" banner
 * and BASE_URL whose `//` comment carries no ticket reference. A ceiling line's code
 * part is `NAME = <digits>` or `key: <digits>`. Pure over a source string so the tests
 * below can run it on mutated copies of this file.
 */
const CEILING_LINE = /^\s*(?:export\s+const\s+\w+\s*=|['"]?[\w./-]+['"]?\s*:)\s*\d+/;
const ceilingLines = (source) =>
  source.slice(source.indexOf('Ceilings, measured at the freeze'), source.indexOf('const BASE_URL')).split('\n').filter(l => CEILING_LINE.test(l));

export function ceilingLinesWithoutTicket(source) {
  return ceilingLines(source).filter(l => !/\bLIN-\d+\b/.test(l.includes('//') ? l.slice(l.indexOf('//')) : ''));
}

describe('every ceiling carries its reason (LIN-3633)', () => {
  const real = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  const strip = (line) => line.replace(/\bLIN-\d+\b/g, '');

  test('the matcher sees every ceiling, so a pass is not vacuous', () => {
    // Source and rendered keys, router source and rendered, intent, runner source and rendered, the three
    // LIN-4085 onboarding ceilings (guide source, guide rendered, landing prompt), the LIN-4373 leftover
    // prompt, the total.
    const expected = Object.keys(TEMPLATES_SOURCE_CEILINGS).length + Object.keys(TEMPLATES_RENDERED_CEILINGS).length + 5 + 3 + 1 + 1;
    assert.equal(ceilingLines(real).length, expected,
      'A ceiling is in a shape the matcher misses (or the matcher over-matches). Keep ceilings as `NAME = <digits>` or `key: <digits>`.');
  });

  test('on the real file, every ceiling line names a ticket in its comment', () => {
    assert.deepStrictEqual(ceilingLinesWithoutTicket(real), [],
      'A ceiling line has no ticket reference in its comment. A raise says why beside the ceiling: ' + OVER_CEILING_FIX);
  });

  test('a ceiling whose comment lost its ticket reference is reported', () => {
    const line = real.split('\n').find(l => l.startsWith("  'plan-review':"));
    assert.ok(line, 'fixture line not found');
    assert.deepStrictEqual(ceilingLinesWithoutTicket(real.replace(line, strip(line))), [strip(line)]);
  });

  test('a ceiling raised with its comment deleted is reported', () => {
    const line = real.split('\n').find(l => l.startsWith('export const STAGE_INTENT_SOURCE_CEILING'));
    assert.ok(line, 'fixture line not found');
    const raised = line.replace(/= \d+;.*/, '= 99999;');
    assert.deepStrictEqual(ceilingLinesWithoutTicket(real.replace(line, raised)), [raised]);
  });
});

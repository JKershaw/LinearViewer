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
 *                         lib/prompt-formatters.js, lib/prompt-contract.js
 *   - Templates rendered: generatePrompt() for each PROMPT_TEMPLATES key under one
 *                         fixed fixture (composed output, catches leaks through a
 *                         source the frozen file does not itself contain)
 *   - Stage router      : lib/stage-router.js, source (LIN-3304) + the routing prompt
 *                         rendered with the leaf fixture the eval baseline uses — the
 *                         one prompt a recommendation call sends (LIN-3300)
 *   - Stage intent      : lib/prompts/stage-intent.js, source — every stage's Scope
 *                         and Authority lines (was lib/prompts/brief-writer.js)
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
  'lib/prompt-template-defs.js': 99235, // LIN-4467: -21447 (120682 -> 99235; the formatter import is multi-line again): the data half of each template (route, writes, lead, signals, description, catalogue) moved to lib/prompts/stage-kinds.js; generate() and the views stay here
  'lib/prompt-templates.js': 19903, // LIN-4437: +241, finishStagePrompt skips the attachments section for the blind read (code and its comment; the skip is witnessed in tests/unit/lin-4437-blind-read.test.js)
  'lib/prompt-formatters.js': 48728, // LIN-4467: +219 (48509 -> 48728): GROUNDING_LISTS, the names each record's grounding points at (the note functions stay here)
  'lib/prompt-contract.js': 2057, // LIN-4467: -1818 (3875 -> 2057): the contract lines moved to each kind's record (lib/prompts/stage-kinds.js); this file reads them
  'lib/prompts/stage-kinds.js': 43001, // LIN-4467: new at 42495, raised to 43001 (+506) for the LIN-4248 and LIN-4437 comments on the Survey and blind-read records, restored from the STAGE_LEADS block they came from: one record per stage kind (route, writes, lead, label, grounding, signals, intent, contract, catalogue). It holds text that sat outside the budget before (the completion signals in lib/completion-signals.js, the catalogue lines in public/llms.txt, the contract and intent lines), and the records' own structure
};

/** Templates, rendered bytes for each PROMPT_TEMPLATES key under FIXTURE_ISSUE +
 * FIXTURE_CONTEXT below. The key set is asserted to match the live registry.
 * Close-out's bug-label line renders only for a bug-labelled task, so not here. */
export const TEMPLATES_RENDERED_CEILINGS = {
  blocked: 3529, // LIN-4345: DECIDE's cut rule and its `DECISION:` route; whether a stage cut the ask is judgement no code sees
  bug: 5154, // LIN-4379: +102, the pointer asks the work to name a note entry it used (file and source) where it records its decisions, so the next look-first step citing a finding is checkable; which entry bears on the work is the agent's judgement no code sees
  plan: 10452, // LIN-4379: +102, the pointer asks the work to name a note entry it used (file and source) where it records its decisions, so the next look-first step citing a finding is checkable; which entry bears on the work is the agent's judgement no code sees
  'look-into': 1762, // LIN-3299: at 1762 since Scope and Authority on every path
  triage: 2429, // LIN-3299: at 2429 since Scope and Authority on every path
  breakdown: 5310, // LIN-4345: DECIDE's cut rule and its `DECISION:` route; whether a stage cut the ask is judgement no code sees
  research: 12128, // LIN-4379: +102, the pointer asks the work to name a note entry it used (file and source) where it records its decisions, so the next look-first step citing a finding is checkable; which entry bears on the work is the agent's judgement no code sees
  scoping: 4658, // LIN-4346: +435 (4223 -> 4658), the area notes pointer in scoping's words (where the notes are, Periodical readings reach it through them, cite in the final message, never the record); the read list's bare "area's notes" clause now points to it
  design: 3257, // LIN-4379: +102, the pointer asks the work to name a note entry it used (file and source) where it records its decisions, so the next look-first step citing a finding is checkable; which entry bears on the work is the agent's judgement no code sees
  spike: 3276, // LIN-4379: +102, the pointer asks the work to name a note entry it used (file and source) where it records its decisions, so the next look-first step citing a finding is checkable; which entry bears on the work is the agent's judgement no code sees
  context: 2021, // LIN-3300: at 2021 since the stage rules only the meta-prompt carried moved into their templates
  'plan-review': 7601, // LIN-4353: the verdict quotes the ask and says how the plan meets it; only the person agrees to a narrowing (the reviewer's judgement)
  implementation: 8890, // LIN-4441: +397 (8493 -> 8890): the rule's own section (targeted local run, CI as the full proof, no-CI substitute deferred), rendered once beside Establish CI; it replaces the two competing full-suite instructions, which now point to it. A worker's choice of tests is judgement no code or test can enforce
  review: 16406, // LIN-4438: -619 (17025 -> 16406): the edges read retired to the blind read; review keeps one sentence, the builder's Retires: line names an entry this diff removes (tests/unit/lin-4374-review-leftover-read.test.js)
  'close-out': 13800, // LIN-4438: +611 (13189 -> 13800), counted against review's -619 (net -8): the blind read in Workflow step 1 and Make the Fixes, the leftover lines marked for close-out in Follow-up Triage, and the not-ready sentence's PR-link and blind-read clauses for the lanes no guard sees (the gate is held in code: lib/close-out-readiness.js)
  'retrospective-audit': 5609, // LIN-4401 (LIN-4432 review fix): +46 (5563 -> 5609): the findings comment's required heading `## Retrospective audit — <identifier>`. LIN-4401 (LIN-4432 beat 4): +944 (4619 -> 5563): the consequence test (579 bytes, LIN-4401 D1) renders once in Reporting; the notes-PR sentences and the audit's own workflow (the shared read-only one stays for its other users) add the rest; FOLLOW_UP_SHAPE stays. Shape held by tests/unit/lin-4401-outside-find-home.test.js and tests/unit/lin-4432-audit-notes-pr.test.js
  retro: 4265, // LIN-3299: at 4265 since Scope and Authority on every path
  'survey-task': 1204, // LIN-4248: new at 1204; the hand-tuned task-view Survey wording, verbatim but for the {BASE} sentence and the Goal/Process frame
  'survey-place': 2119, // LIN-4248: new at 2119; the hand-tuned place-view Survey wording, verbatim but for the {BASE} sentence and the Goal/Process frame
  'blind-read': 4945, // LIN-4438: +154 (4791 -> 4945): the Where-to-stand base rule for a merged PR (its merge commit's first parent), the first live read's find 4: the old rule gave an empty diff once merged; a git rule the reader runs, not a shape code can hold
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

/** Every stage's Scope and Authority lines, source bytes (lib/prompts/stage-intent.js). */
export const STAGE_INTENT_SOURCE_CEILING = 1424; // LIN-4467: -2295 (3719 -> 1424): the Scope and Authority texts moved to each kind's record (lib/prompts/stage-kinds.js, counted in TEMPLATES_SOURCE_CEILINGS); this file is the view. LIN-4437 before it: +296, the blind read's own reading-pass line, which names no ticket (READING and JUDGE both point at it); whether the reader stays blind is held by the preamble and the attachments skip, tested

/** Served runner prompt, source bytes (docs/runner-prompt.md). */
export const RUNNER_PROMPT_SOURCE_CEILING = 17638; // LIN-3669: §5 names the watchdog's three outcomes; the parent's response to a finished-but-unposted subagent is prose (the parent is a model)
/** Served runner prompt, rendered bytes (buildRunnerKickoff at BASE_URL). */
export const RUNNER_PROMPT_RENDERED_CEILING = 15953; // LIN-3669: the same §5 lines rendered

/** Agent onboarding guide, source bytes (docs/agent-onboarding.md, design notes included). LIN-4085: new file; the served guide is agent-facing prose that must stay wording, not code. Its links and sign-in doors are code-checked in tests/unit/agent-onboarding.test.js. */
export const AGENT_ONBOARDING_SOURCE_CEILING = 4669; // LIN-4085: new at 4207, raised to 4669 (+462) for the walk fixes: the no-door path, the token's handling, the OpenRouter connect route and the README link. The served guide is judgment; the links are code-checked.
/** Agent onboarding guide, rendered bytes: the largest rendering over the 16 sign-in door and free-tier combinations, at BASE_URL. LIN-4085: new. */
export const AGENT_ONBOARDING_RENDERED_CEILING = 3691; // LIN-4085: new at 3207, raised to 3691 (+484) for the same walk fixes; the all-doors, no-free-tier rendering is the largest
/** Landing agent prompt, rendered bytes at BASE_URL (renderLandingAgentPrompt). LIN-4085: new. Copied by a person into their own agent, so it is wording the agent reads, not code. */
export const LANDING_AGENT_PROMPT_CEILING = 584; // LIN-4085: new at 584 (the copied prompt under the sign-in buttons)
/** The leftover step's prompt, rendered bytes at the fixture ticket and PR below (leftoverPrompt, lib/dispatch-leftover.js). */
export const LEFTOVER_PROMPT_RENDERED_CEILING = 2498; // LIN-4401 (LIN-4431 beat 3): +711 (1787 -> 2498): the consequence test (579 bytes) renders once here, as the builder's one outside-find rule; LEFTOVER_RULE's outside clause, the outside sentence and the answer line's three forms together add the rest; shape held by tests/unit/lin-4401-outside-find-home.test.js

/**
 * The total: the sum of every ceiling above. A PR that raises a ceiling raises
 * THIS number with it, in the same change, and says why in the comment beside the
 * ceiling it raises; the raise is a visible edit, reviewed rather than assumed.
 */
export const FROZEN_TOTAL_BYTES = 396575; // LIN-4467: +17660 (378915 -> 396575): the records' text moved in from unbudgeted files (completion signals, catalogue lines) and the record's own structure; see the ceilings above. LIN-4441 before it: +1002 (377913 -> 378915): prompt-template-defs.js source +64, prompt-formatters.js source +541, implementation rendered +397

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

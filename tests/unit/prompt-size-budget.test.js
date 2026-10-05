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
 * three bytes. A ceiling moves DOWN freely (a shrink needs no edit); it moves UP
 * only by removing at least as many bytes from another surface in the same
 * change. The net-zero total is enforced mechanically by `FROZEN_TOTAL_BYTES`,
 * which sums every ceiling below: raising one ceiling without lowering another
 * by the same amount pushes the sum over that constant and fails. Raising the
 * total itself means editing a second, clearly labelled constant — a visible,
 * reviewable act, not an incidental one.
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
 *
 * LIN-3300 deleted the meta-prompt template (its source and rendered ceilings went
 * with it) and the brief writer's prompt; the writer's ceiling moved with the scope
 * lines it kept to lib/prompts/stage-intent.js. Every ceiling was then lowered to its
 * actual size and the total to their sum. The router's byte snapshots
 * (stage-router-prompt-snapshots.test.js) and the `meta-prompt.baseline.txt` guard in
 * rulings-resolution-contract-drift.test.js pin the rendered routing text; this pins
 * its size.
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

// ─── Ceilings, measured at the freeze (LIN-3203) ─────────────────────────────
// Each is the surface's UTF-8 byte count on the freeze branch. A ceiling is a
// cap, not an identity pin: shrinking a surface needs no edit here. Growing one
// needs an equal-or-greater removal elsewhere; see the message on each assert.

/** Templates, source bytes. Same files `steady-base-growth.mjs` GROUPS as
 * "worker templates". LIN-3292: the stage contract joins them, its 3481 bytes paid by
 * lowering the other three to their size after its format asks left the templates. */
export const TEMPLATES_SOURCE_CEILINGS = {
  'lib/prompt-template-defs.js': 121320, // LIN-3299: one lead per stage (STAGE_LEADS); -825 for leads that no longer repeat Scope and Authority. LIN-3300: +601, six stage rules moved in from the deleted meta-prompt; then -4276, each stage's route (when / when not / requires) replaces its aiHint
  'lib/prompt-templates.js': 20118, // LIN-3299: +13, re-exports STAGE_LEADS; +199, finishStagePrompt adds Scope and Authority. LIN-3300: -272, formatStageOptions and defer's entry replace the aiHint formatter
  'lib/prompt-formatters.js': 50224, // LIN-3299: +34, the hypothesis sentence covers a proposed solution or limit
  'lib/prompt-contract.js': 3424,
};

/** Templates, rendered bytes for each PROMPT_TEMPLATES key under FIXTURE_ISSUE +
 * FIXTURE_CONTEXT below. The key set is asserted to match the live registry.
 * LIN-3299: every stage gains a `## Process` heading and the reworded hypothesis sentence,
 * and its role line became its lead; the rises (+468 over twelve stages) are paid by the
 * writer's ideals and unwritten stages' scope lines leaving lib/prompts/brief-writer.js.
 * Then every stage gains its Scope and Authority on every path (+4606 over seventeen
 * stages, net of leads that no longer repeat it), paid from the 4813 bytes left
 * unallocated under FROZEN_TOTAL_BYTES, 4485 of them freed by LIN-3299 itself.
 * LIN-3300: implementation, plan, review, scoping and context each gained a rule that
 * existed only in the deleted meta-prompt (+359 rendered), paid from its ceilings;
 * close-out's bug-label line renders only for a bug-labelled task, so not here. */
export const TEMPLATES_RENDERED_CEILINGS = {
  blocked: 3244,
  bug: 4744,
  plan: 15793, // LIN-3300: the planner's revision line no longer asks for an exact form or names the loop bound
  'look-into': 1762,
  triage: 2429,
  breakdown: 5096,
  research: 11514,
  scoping: 2427,
  design: 2562,
  spike: 2581,
  context: 2021,
  'plan-review': 7955,
  implementation: 7937,
  review: 18895,
  'close-out': 18752,
  'retrospective-audit': 4427,
  retro: 4265,
};

/**
 * The stage router's source bytes (lib/stage-router.js, LIN-3304): the stage selector's
 * rules, its prompt and the reply parse. LIN-3300 replaced the decision tree (44667) with
 * the selector; the stage options it lists are each stage's `route`, counted in the
 * template defs.
 */
export const STAGE_ROUTER_SOURCE_CEILING = 8980;
/**
 * The routing prompt, rendered bytes for the eval baseline's leaf (a leaf with no
 * comments and no plan, its view a placeholder). LIN-3300: the meta-prompt's rendered
 * ceiling (103308) became the routing half's (40687) when the full path went; the stage
 * selector sends 10594. It also catches growth in the stage options and the facts code
 * renders (lib/recommendation-facts.js), which no source ceiling covers.
 */
export const ROUTER_PROMPT_RENDERED_CEILING = 10594;

/**
 * Every stage's Scope and Authority lines, source bytes (lib/prompts/stage-intent.js).
 * LIN-3300: the file was lib/prompts/brief-writer.js (ceiling 4779); the writer's prompt
 * left with the writer, and the ceiling moved with the lines that stayed.
 */
export const STAGE_INTENT_SOURCE_CEILING = 2830;

/** Served runner prompt, source bytes (docs/runner-prompt.md). */
export const RUNNER_PROMPT_SOURCE_CEILING = 17500;
/** Served runner prompt, rendered bytes (buildRunnerKickoff at BASE_URL). */
export const RUNNER_PROMPT_RENDERED_CEILING = 15815;

/**
 * The net-zero total: the sum of every ceiling above at the freeze. A PR may
 * move a ceiling up only by moving another down by at least as much; raising
 * the total is a deliberate edit to THIS number, in the same change, so it is
 * reviewed rather than assumed.
 *
 * LIN-3304 raised it by 6990 (568534 -> 575524) when lib/stage-router.js joined the
 * frozen surfaces. LIN-3300 lowered it to the sum of the ceilings above, each at its
 * actual size, once the meta-prompt template and the brief writer's prompt were deleted
 * (575524 before), so there is no slack. That includes +960 for the six stage rules
 * the meta-prompt alone carried, moved into their templates in the same change.
 *
 * LIN-3300's stage selector lowered it again (437765 -> 367209): the selector's rules,
 * stage options and facts replace the decision tree and the aiHints, and the planner no
 * longer carries the loop bound. Every ceiling sits at its surface's size.
 */
export const FROZEN_TOTAL_BYTES = 367209;

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

// The leaf the baseline snapshot (scripts/eval/regen-baseline.mjs) uses: no comments,
// no plan, its view left as the {{ISSUE_CONTEXT}} placeholder. Rendered this is
// byte-identical to scripts/eval/meta-prompt.baseline.txt.
const ROUTER_PROMPT_ARGS = {
  ...buildSelectorArgs({ identifier: '{{IDENTIFIER}}', title: '', state: {}, labels: [] }, {}),
  view: '{{ISSUE_CONTEXT}}',
  featureFlags: {}
};

const sourceBytes = (path) => Buffer.byteLength(readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url))));
const renderBytes = (key) => Buffer.byteLength(generatePrompt(key, FIXTURE_ISSUE, FIXTURE_CONTEXT).prompt);

describe('prompt surfaces stay within their frozen byte budgets (LIN-3203)', () => {
  test('templates source bytes', () => {
    const over = [];
    for (const [file, ceiling] of Object.entries(TEMPLATES_SOURCE_CEILINGS)) {
      const actual = sourceBytes(file);
      if (actual > ceiling) over.push(`${file} is ${actual} bytes, ${actual - ceiling} over its ${ceiling}-byte ceiling`);
    }
    assert.deepStrictEqual(over, [],
      `Prompt template source file(s) grew: ${over.join('; ')}. Remove at least the overage bytes elsewhere in the ` +
      `same change, or land the lesson as code or a test; raising a number alone is not the fix.`);
  });

  test('templates rendered bytes', () => {
    const over = [];
    for (const [key, ceiling] of Object.entries(TEMPLATES_RENDERED_CEILINGS)) {
      const actual = renderBytes(key);
      if (actual > ceiling) over.push(`"${key}" renders to ${actual} bytes, ${actual - ceiling} over its ${ceiling}-byte ceiling`);
    }
    assert.deepStrictEqual(over, [],
      `Template(s) grew: ${over.join('; ')}. Remove at least the overage bytes elsewhere in the same change, or ` +
      `land the lesson as code or a test; raising a number alone is not the fix.`);
  });


  test('stage router source bytes', () => {
    const actual = sourceBytes('lib/stage-router.js');
    assert.ok(actual <= STAGE_ROUTER_SOURCE_CEILING,
      `lib/stage-router.js is ${actual} bytes, ${actual - STAGE_ROUTER_SOURCE_CEILING} over its ` +
      `${STAGE_ROUTER_SOURCE_CEILING}-byte ceiling. Remove at least ${actual - STAGE_ROUTER_SOURCE_CEILING} bytes ` +
      `elsewhere in the same change, or land the lesson as code or a test; raising a number alone is not the fix.`);
  });

  test('routing prompt rendered bytes', () => {
    const actual = Buffer.byteLength(buildRouterPrompt(ROUTER_PROMPT_ARGS));
    assert.ok(actual <= ROUTER_PROMPT_RENDERED_CEILING,
      `The routing prompt renders to ${actual} bytes, ${actual - ROUTER_PROMPT_RENDERED_CEILING} over its ` +
      `${ROUTER_PROMPT_RENDERED_CEILING}-byte ceiling. Remove at least ${actual - ROUTER_PROMPT_RENDERED_CEILING} ` +
      `bytes elsewhere in the same change, or land the lesson as code or a test; raising a number alone is not the fix.`);
  });

  test('stage intent source bytes', () => {
    const actual = sourceBytes('lib/prompts/stage-intent.js');
    assert.ok(actual <= STAGE_INTENT_SOURCE_CEILING,
      `lib/prompts/stage-intent.js is ${actual} bytes, ${actual - STAGE_INTENT_SOURCE_CEILING} over its ` +
      `${STAGE_INTENT_SOURCE_CEILING}-byte ceiling. Remove at least ${actual - STAGE_INTENT_SOURCE_CEILING} bytes ` +
      `elsewhere in the same change, or land the lesson as code or a test; raising a number alone is not the fix.`);
  });

  test('served runner prompt source bytes', () => {
    const actual = sourceBytes('docs/runner-prompt.md');
    assert.ok(actual <= RUNNER_PROMPT_SOURCE_CEILING,
      `docs/runner-prompt.md is ${actual} bytes, ${actual - RUNNER_PROMPT_SOURCE_CEILING} over its ` +
      `${RUNNER_PROMPT_SOURCE_CEILING}-byte ceiling. Remove at least ${actual - RUNNER_PROMPT_SOURCE_CEILING} bytes ` +
      `elsewhere in the same change, or land the lesson as code or a test; raising a number alone is not the fix.`);
  });

  test('served runner prompt rendered bytes', () => {
    const actual = Buffer.byteLength(buildRunnerKickoff({ baseUrl: BASE_URL }));
    assert.ok(actual <= RUNNER_PROMPT_RENDERED_CEILING,
      `The served runner prompt renders to ${actual} bytes, ${actual - RUNNER_PROMPT_RENDERED_CEILING} over its ` +
      `${RUNNER_PROMPT_RENDERED_CEILING}-byte ceiling. Remove at least ${actual - RUNNER_PROMPT_RENDERED_CEILING} ` +
      `bytes elsewhere in the same change, or land the lesson as code or a test; raising a number alone is not the fix.`);
  });

  test('the rendered budget covers exactly the live PROMPT_TEMPLATES key set', () => {
    // A new template without a budget (or a stale budget for a removed one) is a
    // failure: adding a template means taking its bytes from somewhere else.
    assert.deepStrictEqual(
      Object.keys(TEMPLATES_RENDERED_CEILINGS).sort(),
      Object.keys(PROMPT_TEMPLATES).sort(),
      'Every PROMPT_TEMPLATES key must carry a rendered ceiling and vice versa. A new template needs a budget ' +
      'taken from another surface in the same change; land the lesson as code or a test instead of growing prompts.'
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
    ].reduce((sum, n) => sum + n, 0);
    assert.ok(ceilingSum <= FROZEN_TOTAL_BYTES,
      `The ceilings sum to ${ceilingSum} bytes, ${ceilingSum - FROZEN_TOTAL_BYTES} over the frozen total ` +
      `${FROZEN_TOTAL_BYTES}. Lower another ceiling by at least ${ceilingSum - FROZEN_TOTAL_BYTES} bytes, or land ` +
      `the lesson as code or a test; editing FROZEN_TOTAL_BYTES upward is a deliberate, reviewable act, not a fix.`);
  });
});

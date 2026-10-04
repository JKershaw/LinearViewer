/**
 * Byte budget guard for the prompt surfaces (LIN-3203).
 *
 * Prompt text is carried context: every session that reads a template, the
 * meta-prompt or the served runner prompt pays for it in full, across the whole
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
 *   - Meta-prompt       : lib/prompts/meta-prompt-template.js, source + rendered
 *                         with the same leaf fixture the baseline snapshot uses
 *   - Stage router      : lib/stage-router.js, source (LIN-3304) — the routing
 *                         sections and parse the meta call's next-stage choice uses,
 *                         given their own ceiling when they got their own home
 *   - Brief writer      : lib/prompts/brief-writer.js, source (LIN-3293)
 *   - Served runner     : docs/runner-prompt.md, source + buildRunnerKickoff() rendered
 *
 * The existing `meta-prompt.baseline.txt` byte-identity guard in
 * rulings-resolution-contract-drift.test.js stays as is: that pins the rendered
 * text, this pins its size. A shrink must still regenerate that baseline.
 *
 * Run with: node --test tests/unit/prompt-size-budget.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { PROMPT_TEMPLATES, generatePrompt, formatAIHintsForMetaPrompt, getAIRecommendationActionNames } from '../../lib/prompt-templates.js';
import { buildMetaPromptTemplate } from '../../lib/prompts/meta-prompt-template.js';
import { formatAllSignalsForMetaPrompt } from '../../lib/completion-signals.js';
import { buildRunnerKickoff } from '../../lib/prompts/runner-kickoff.js';

// ─── Ceilings, measured at the freeze (LIN-3203) ─────────────────────────────
// Each is the surface's UTF-8 byte count on the freeze branch. A ceiling is a
// cap, not an identity pin: shrinking a surface needs no edit here. Growing one
// needs an equal-or-greater removal elsewhere; see the message on each assert.

/** Templates, source bytes. Same files `steady-base-growth.mjs` GROUPS as
 * "worker templates". LIN-3292: the stage contract joins them, its 3481 bytes paid by
 * lowering the other three to their size after its format asks left the templates. */
export const TEMPLATES_SOURCE_CEILINGS = {
  'lib/prompt-template-defs.js': 127237, // LIN-3299: one lead per stage (STAGE_LEADS); -825 for leads that no longer repeat Scope and Authority
  'lib/prompt-templates.js': 20707, // LIN-3299: +13, re-exports STAGE_LEADS; +199, finishStagePrompt adds Scope and Authority
  'lib/prompt-formatters.js': 52917, // LIN-3299: +34, the hypothesis sentence covers a proposed solution or limit
  'lib/prompt-contract.js': 3481,
};

/** Templates, rendered bytes for each PROMPT_TEMPLATES key under FIXTURE_ISSUE +
 * FIXTURE_CONTEXT below. The key set is asserted to match the live registry.
 * LIN-3299: every stage gains a `## Process` heading and the reworded hypothesis sentence,
 * and its role line became its lead; the rises (+468 over twelve stages) are paid by the
 * writer's ideals and unwritten stages' scope lines leaving lib/prompts/brief-writer.js.
 * Then every stage gains its Scope and Authority on every path (+4606 over seventeen
 * stages, net of leads that no longer repeat it), paid from the 4813 bytes left
 * unallocated under FROZEN_TOTAL_BYTES, 4485 of them freed by LIN-3299 itself. */
export const TEMPLATES_RENDERED_CEILINGS = {
  blocked: 3244,
  bug: 4744,
  plan: 15960,
  'look-into': 1762,
  triage: 2429,
  breakdown: 5096,
  research: 11514,
  scoping: 2362,
  design: 2562,
  spike: 2581,
  context: 1972,
  'plan-review': 7955,
  implementation: 7841,
  review: 18846,
  'close-out': 18752,
  'retrospective-audit': 4427,
  retro: 4265,
};

/** Meta-prompt, source bytes. */
export const META_PROMPT_SOURCE_CEILING = 67740; // LIN-3304: -38051, the routing fragments moved into lib/stage-router.js; every byte is now owned once, there is no stale slack
/** Meta-prompt, rendered bytes under META_PROMPT_ARGS (the baseline's leaf fixture). */
export const META_PROMPT_RENDERED_CEILING = 103308;

/**
 * The stage router's source bytes (lib/stage-router.js, LIN-3304). This surface
 * gets its own ceiling now that the routing fragments (moved out of the meta
 * template) and the reply parse (moved out of the unfrozen openrouter.js) live here.
 * The bytes are not new prompt text: they are the routing half the meta source already
 * carried, plus the parse that was never frozen. Its own ceiling is what keeps the
 * routing half from growing silently inside the meta-prompt's old slack.
 */
export const STAGE_ROUTER_SOURCE_CEILING = 45728;

/**
 * The brief writer's prompt, source bytes (lib/prompts/brief-writer.js, LIN-3293): its own
 * brief and every stage's ideal shape. New prompt text, paid by removing restated rules from
 * review and close-out (both paths), lowering every slack ceiling to its size, and the
 * unallocated remainder of the total. It renders only around a bundle the template
 * ceilings already measure, so it carries a source ceiling alone. +2018 for the review
 * fixes (the safety floors review and close-out rest on, owned by code; two cause lines;
 * a writer brief that names code's sections instead of showing their text), paid by the
 * template, meta and formatter cuts in the same change (2109 bytes moved, 2239 freed).
 * LIN-3299: -4276. The stage ideals merged into the templates' leads, and the stages the
 * writer no longer writes lost their scope lines (close-out's floors stay in its template).
 * Then +398: every stage's scope lines again, now added on every path (withStageIntent),
 * less review's floors, which its process already states.
 */
export const BRIEF_WRITER_SOURCE_CEILING = 4779;

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
 * frozen surfaces. The meta-prompt's ceiling fell by 38051 as its routing fragments
 * moved out; the net increase is the reply-parse code that moved in from
 * lib/openrouter.js, which was never a frozen surface, plus the seam's docs. The sum
 * still equals the total, so there is no new slack.
 */
export const FROZEN_TOTAL_BYTES = 575524;

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

// The leaf fixture the baseline snapshot (scripts/eval/regen-baseline.mjs) uses,
// with {{ISSUE_CONTEXT}}/{{IDENTIFIER}} left as placeholders. Rendered this is
// byte-identical to scripts/eval/meta-prompt.baseline.txt at the freeze.
const META_PROMPT_ARGS = {
  issueContext: '{{ISSUE_CONTEXT}}',
  identifier: '{{IDENTIFIER}}',
  hasSubtasks: false, subtaskCount: 0, completedCount: 0, inProgressCount: 0, remainingCount: 0,
  hasComments: false, commentCount: 0,
  aiHints: formatAIHintsForMetaPrompt(),
  actionVocabulary: getAIRecommendationActionNames().join(', '),
  completionSignals: formatAllSignalsForMetaPrompt(),
  focusedSubtaskId: null,
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

  test('meta-prompt source bytes', () => {
    const actual = sourceBytes('lib/prompts/meta-prompt-template.js');
    assert.ok(actual <= META_PROMPT_SOURCE_CEILING,
      `lib/prompts/meta-prompt-template.js is ${actual} bytes, ${actual - META_PROMPT_SOURCE_CEILING} over its ` +
      `${META_PROMPT_SOURCE_CEILING}-byte ceiling. Remove at least ${actual - META_PROMPT_SOURCE_CEILING} bytes ` +
      `elsewhere in the same change, or land the lesson as code or a test; raising a number alone is not the fix.`);
  });

  test('meta-prompt rendered bytes', () => {
    const actual = Buffer.byteLength(buildMetaPromptTemplate(META_PROMPT_ARGS));
    assert.ok(actual <= META_PROMPT_RENDERED_CEILING,
      `The meta-prompt renders to ${actual} bytes, ${actual - META_PROMPT_RENDERED_CEILING} over its ` +
      `${META_PROMPT_RENDERED_CEILING}-byte ceiling. Remove at least ${actual - META_PROMPT_RENDERED_CEILING} ` +
      `bytes elsewhere in the same change, or land the lesson as code or a test; raising a number alone is not the fix.`);
  });

  test('stage router source bytes', () => {
    const actual = sourceBytes('lib/stage-router.js');
    assert.ok(actual <= STAGE_ROUTER_SOURCE_CEILING,
      `lib/stage-router.js is ${actual} bytes, ${actual - STAGE_ROUTER_SOURCE_CEILING} over its ` +
      `${STAGE_ROUTER_SOURCE_CEILING}-byte ceiling. Remove at least ${actual - STAGE_ROUTER_SOURCE_CEILING} bytes ` +
      `elsewhere in the same change, or land the lesson as code or a test; raising a number alone is not the fix.`);
  });

  test('brief writer source bytes', () => {
    const actual = sourceBytes('lib/prompts/brief-writer.js');
    assert.ok(actual <= BRIEF_WRITER_SOURCE_CEILING,
      `lib/prompts/brief-writer.js is ${actual} bytes, ${actual - BRIEF_WRITER_SOURCE_CEILING} over its ` +
      `${BRIEF_WRITER_SOURCE_CEILING}-byte ceiling. Remove at least ${actual - BRIEF_WRITER_SOURCE_CEILING} bytes ` +
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
      META_PROMPT_SOURCE_CEILING,
      META_PROMPT_RENDERED_CEILING,
      STAGE_ROUTER_SOURCE_CEILING,
      BRIEF_WRITER_SOURCE_CEILING,
      RUNNER_PROMPT_SOURCE_CEILING,
      RUNNER_PROMPT_RENDERED_CEILING,
    ].reduce((sum, n) => sum + n, 0);
    assert.ok(ceilingSum <= FROZEN_TOTAL_BYTES,
      `The ceilings sum to ${ceilingSum} bytes, ${ceilingSum - FROZEN_TOTAL_BYTES} over the frozen total ` +
      `${FROZEN_TOTAL_BYTES}. Lower another ceiling by at least ${ceilingSum - FROZEN_TOTAL_BYTES} bytes, or land ` +
      `the lesson as code or a test; editing FROZEN_TOTAL_BYTES upward is a deliberate, reviewable act, not a fix.`);
  });
});

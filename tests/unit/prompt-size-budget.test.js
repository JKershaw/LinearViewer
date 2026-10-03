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
  'lib/prompt-template-defs.js': 131297,
  'lib/prompt-templates.js': 20404,
  'lib/prompt-formatters.js': 52999,
  'lib/prompt-contract.js': 3481,
};

/** Templates, rendered bytes for each PROMPT_TEMPLATES key under FIXTURE_ISSUE +
 * FIXTURE_CONTEXT below. The key set is asserted to match the live registry. */
export const TEMPLATES_RENDERED_CEILINGS = {
  blocked: 2990,
  bug: 4420,
  plan: 15433, // LIN-3292: plan, implementation and review carry the stage contract, paid by triage, plan-review and close-out
  'look-into': 1645,
  triage: 2499,
  breakdown: 4669,
  research: 11115,
  scoping: 2079,
  design: 2277, // LIN-3296: design and spike rewritten as briefs, paid by implementation and close-out's LIN-3291 trims
  spike: 2190,
  context: 1892,
  'plan-review': 7704,
  implementation: 7574,
  review: 20106,
  'close-out': 19598,
  'retrospective-audit': 4161,
  retro: 4114,
};

/** Meta-prompt, source bytes. */
export const META_PROMPT_SOURCE_CEILING = 106319;
/** Meta-prompt, rendered bytes under META_PROMPT_ARGS (the baseline's leaf fixture). */
export const META_PROMPT_RENDERED_CEILING = 104052;

/** Served runner prompt, source bytes (docs/runner-prompt.md). */
export const RUNNER_PROMPT_SOURCE_CEILING = 17500;
/** Served runner prompt, rendered bytes (buildRunnerKickoff at BASE_URL). */
export const RUNNER_PROMPT_RENDERED_CEILING = 15815;

/**
 * The net-zero total: the sum of every ceiling above at the freeze. A PR may
 * move a ceiling up only by moving another down by at least as much; raising
 * the total is a deliberate edit to THIS number, in the same change, so it is
 * reviewed rather than assumed.
 */
export const FROZEN_TOTAL_BYTES = 568534;

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
      RUNNER_PROMPT_SOURCE_CEILING,
      RUNNER_PROMPT_RENDERED_CEILING,
    ].reduce((sum, n) => sum + n, 0);
    assert.ok(ceilingSum <= FROZEN_TOTAL_BYTES,
      `The ceilings sum to ${ceilingSum} bytes, ${ceilingSum - FROZEN_TOTAL_BYTES} over the frozen total ` +
      `${FROZEN_TOTAL_BYTES}. Lower another ceiling by at least ${ceilingSum - FROZEN_TOTAL_BYTES} bytes, or land ` +
      `the lesson as code or a test; editing FROZEN_TOTAL_BYTES upward is a deliberate, reviewable act, not a fix.`);
  });
});

/**
 * Withdrawn-`resolution` contract + no-re-raise guidance drift guard
 * (LIN-2891/LIN-3038, plan Surface 13).
 *
 * Three sites publish the SAME `resolution` shape for a resolved loop ruling:
 *   - `lib/unanswered-decisions.js` — the canonical `@returns` typedef and
 *     module docblock for `collectUnansweredDecisions`.
 *   - `lib/proxy-instructions.js` — the agent-facing catalog for
 *     `GET /api/proxy/rulings`.
 *   - `routes/proxy-rulings.js` — the route docblock.
 *
 * Step 3 (LIN-2891) broadened that shape: `outcome` gained `'withdrawn'`, and
 * a withdrawn row carries `reason` (the withdrawing agent's stated reason).
 * Nothing fails loudly if one site drifts from the others — this file is that
 * alarm.
 *
 * It also pins the no-re-raise guidance's literal list broadening at the 3
 * live sites (across 2 files; the meta-prompt template's 2 went with it in
 * LIN-3300) and accounts for the derived snapshot
 * `scripts/eval/meta-prompt.baseline.txt`, which is regenerated from the live
 * router prompt by `scripts/eval/regen-baseline.mjs`.
 *
 * Follows tests/unit/decision-lifecycle-stamp-drift.test.js's convention:
 * every source read into its own variable and asserted per-source (never
 * concatenated), and slicing by marker text, not line numbers.
 *
 * Run with: node --test tests/unit/rulings-resolution-contract-drift.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildRouterPrompt } from '../../lib/stage-router.js';
import { buildSelectorArgs } from '../../lib/openrouter.js';
import { planReviewRunOf } from '../../lib/records/plan-review-run.js';
import { planFactsOf } from '../../lib/records/plan-facts.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (relPath) => readFileSync(join(__dirname, '../..', relPath), 'utf8');

const unansweredDecisionsSource = read('lib/unanswered-decisions.js');
const proxyInstructionsSource = read('lib/proxy-instructions.js');
const proxyRulingsSource = read('routes/proxy-rulings.js');
const promptTemplateDefsSource = read('lib/prompt-template-defs.js');
const autopilotManualSource = read('docs/autopilot-operating-manual.md');
const handoffWordsSource = read('lib/prompts/handoff-words.js');
const baselineSource = read('scripts/eval/meta-prompt.baseline.txt');

/** Count non-overlapping occurrences of `needle` in `haystack`. */
function countOccurrences(haystack, needle) {
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return count;
    count += 1;
    from = at + needle.length;
  }
}

// The exact string the deploy witness greps for on the live
// `/api/proxy/instructions` output (see LIN-3038's PR body / LIN-2891).
const DEPLOY_WITNESS_UNION = '"outcome": "answered" | "dismissed" | "withdrawn" | null';

describe('withdrawn resolution contract — doc-consistency drift guard (LIN-2891/LIN-3038)', () => {
  test('lib/proxy-instructions.js publishes the deploy-witness union string verbatim', () => {
    assert.ok(
      proxyInstructionsSource.includes(DEPLOY_WITNESS_UNION),
      `lib/proxy-instructions.js must carry the exact union ${DEPLOY_WITNESS_UNION} (the deploy witness)`
    );
  });

  test('lib/proxy-instructions.js documents a withdrawn resolution carrying reason', () => {
    const resolutionIdx = proxyInstructionsSource.indexOf('→ "resolution" appears ONLY');
    assert.notEqual(resolutionIdx, -1, 'the "resolution" catalog entry is present');
    const block = proxyInstructionsSource.slice(resolutionIdx, resolutionIdx + 1200);
    assert.match(block, /"outcome":\s*"answered"\s*\|\s*"dismissed"\s*\|\s*"withdrawn"\s*\|\s*null/,
      'the outcome union includes "withdrawn"');
    assert.match(block, /"reason":\s*"\.\.\."\s*\|\s*null/,
      'the resolution shape includes "reason": "..." | null');
    assert.match(block, /withdrawn[\s\S]*?reason[\s\S]*?stated reason/,
      'the block explains that a withdrawn row carries the withdrawing agent\'s stated reason');
  });

  test('lib/unanswered-decisions.js typedef declares the same withdrawn outcome and reason', () => {
    const returnsIdx = unansweredDecisionsSource.indexOf('@returns {Array<{decision: Object');
    assert.notEqual(returnsIdx, -1, 'the collectUnansweredDecisions @returns typedef is present');
    const typedef = unansweredDecisionsSource.slice(returnsIdx, unansweredDecisionsSource.indexOf('\n', returnsIdx));
    assert.match(typedef, /resolution\?:\s*\{decisionId: string, raisedAt: string\|null, resolvedAt: string\|null, outcome: 'answered'\|'dismissed'\|'withdrawn'\|null, reason\?: string\|null\}/,
      'the canonical typedef lists outcome answered|dismissed|withdrawn|null and reason');
  });

  test('routes/proxy-rulings.js docblock names the same withdrawn shape', () => {
    const includeResolvedIdx = proxyRulingsSource.indexOf('`includeResolved=true` — keeps');
    assert.notEqual(includeResolvedIdx, -1, 'the includeResolved route-docblock clause is present');
    const block = proxyRulingsSource.slice(includeResolvedIdx, includeResolvedIdx + 700);
    assert.match(block, /withdrawn/, 'the docblock mentions withdrawn loop groups');
    assert.match(block, /outcome: 'withdrawn'/, 'the docblock names outcome: \'withdrawn\'');
    assert.ok(block.includes('carrying `reason` from the withdrawal itself'),
      'the docblock says reason comes from the withdrawal itself');
  });

  test('all three contract sites agree: withdrawn appears with a reason field', () => {
    const sites = [
      { label: 'lib/proxy-instructions.js', source: proxyInstructionsSource },
      { label: 'lib/unanswered-decisions.js', source: unansweredDecisionsSource },
      { label: 'routes/proxy-rulings.js', source: proxyRulingsSource },
    ];
    for (const { label, source } of sites) {
      assert.ok(source.includes('withdrawn'), `${label} names the withdrawn outcome`);
      assert.ok(source.includes('reason'), `${label} names the reason field`);
    }
  });
});

describe('no-re-raise guidance (LIN-2891/LIN-3038, moved to the question record by LIN-4533)', () => {
  // The three sites now point at the question check in lib/prompts/handoff-words.js (QUESTION_CHECK), and the manual states it.
  const liveSites = [
    { label: 'lib/prompt-template-defs.js', source: promptTemplateDefsSource, expected: 2 },
    { label: 'docs/autopilot-operating-manual.md', source: autopilotManualSource, expected: 1 },
  ];

  test('the live prompt sources carry no "answered, or dismissed" list and no DECISION: re-raise guard (LIN-4533)', () => {
    for (const { label, source } of liveSites) {
      assert.strictEqual(countOccurrences(source, 'answered, or dismissed'), 0, `${label} must carry no stale list`);
      assert.strictEqual(countOccurrences(source, 'Before raising any `DECISION:`'), 0, `${label} must not teach a DECISION: re-raise check`);
    }
  });

  test('the prompt sites point at the question check, and the manual asks the same check (LIN-4533)', () => {
    assert.strictEqual(countOccurrences(promptTemplateDefsSource, '+ QUESTION_CHECK +'), 2, 'both no-re-raise sites use the question check');
    assert.strictEqual(countOccurrences(autopilotManualSource, 'Before asking a question, check it isn\'t already covered.'), 1);
    assert.strictEqual(countOccurrences(handoffWordsSource, 'kind=question&in=<this ticket>&state=open'), 1, 'the check queries the open questions');
  });

  // LIN-3903: the trigger widened from "on a finding" to any DECISION:, and each
  // site asks for every fact in the one ruling. Case-insensitive: close-out's
  // Follow-up Triage bullet is lowercase ("before raising"), review's is bold-initial.
  test('the 3 no-re-raise sites ask for every fact the question needs in the one question record (LIN-4533)', () => {
    assert.strictEqual(countOccurrences(promptTemplateDefsSource, 'every fact the question needs in the one question record'), 2);
    assert.strictEqual(countOccurrences(autopilotManualSource, 'every fact the question needs in the one question record'), 1);
    assert.strictEqual(countOccurrences(promptTemplateDefsSource, 'on a finding, check'), 0);
    assert.strictEqual(countOccurrences(autopilotManualSource, 'on a finding, check'), 0);
  });

  test('the rulings includeResolved scope note is gone from the prompt sites (LIN-4533: the question check queries records)', () => {
    assert.strictEqual(countOccurrences(promptTemplateDefsSource, 'includeResolved'), 0);
  });

  test('the derived snapshot scripts/eval/meta-prompt.baseline.txt is accounted for and in sync', () => {
    // It is NOT a live prompt source — it is regenerated from the live
    // router prompt by scripts/eval/regen-baseline.mjs. Assert it carries no
    // stale list AND that it is byte-identical to a fresh render, so a future
    // prompt edit cannot silently leave it stale.
    assert.strictEqual(countOccurrences(baselineSource, 'answered, or dismissed'), 0,
      'the baseline snapshot carries no stale list');

    // LIN-4504: the same explicit plan facts regen-baseline.mjs renders (a task whose records hold no plan).
    // LIN-4520: and the same records-read empty trail and plan-review run (no review, no verdict on record).
    const emptyTrail = { review: null, landing: [], workAfterReview: false, closeOutAfterReview: false, closeOutOnTrail: false, landingHasNotesPr: false, notesPrs: [], auditAfterCloseOut: false };
    const leaf = buildSelectorArgs({ identifier: '{{IDENTIFIER}}', title: '', state: {}, labels: [] }, {
      planFacts: planFactsOf({ task: { id: 'task-leaf', kind: 'task' } }),
      trail: emptyTrail,
      planReviewRun: planReviewRunOf({ verdicts: [], findings: [] }),
    });
    const fresh = buildRouterPrompt({ ...leaf, view: '{{ISSUE_CONTEXT}}', featureFlags: {} });
    assert.strictEqual(baselineSource, fresh,
      'scripts/eval/meta-prompt.baseline.txt is stale — run `node scripts/eval/regen-baseline.mjs`');
  });
});

describe('autopilot manual: the if_unanswered rule (LIN-3252 S2.3i)', () => {
  test('the manual names if-unanswered on the question record, and keeps the no-re-raise check (LIN-4533)', () => {
    // The manual is the single source for the question guidance — the rule lives here, not duplicated into a second surface.
    assert.ok(autopilotManualSource.includes('`if-unanswered`'), 'the manual names if-unanswered on the question');
    assert.ok(!autopilotManualSource.includes('if_unanswered'), 'the retired DECISION: field name is gone');
    assert.ok(
      autopilotManualSource.includes('Don\'t re-ask a question an open or answered record already covers'),
      'the no-re-raise check stays'
    );
  });
});

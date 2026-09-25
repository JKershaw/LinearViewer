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
 * It also pins the no-re-raise guidance's literal list broadening at the 5
 * live sites (across 3 files) and accounts for the derived snapshot
 * `scripts/eval/meta-prompt.baseline.txt`, which is regenerated from the live
 * meta-prompt template by `scripts/eval/regen-baseline.mjs`.
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
import { buildMetaPromptTemplate } from '../../lib/prompts/meta-prompt-template.js';
import { formatAIHintsForMetaPrompt, getAIRecommendationActionNames } from '../../lib/prompt-templates.js';
import { formatAllSignalsForMetaPrompt } from '../../lib/completion-signals.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (relPath) => readFileSync(join(__dirname, '../..', relPath), 'utf8');

const unansweredDecisionsSource = read('lib/unanswered-decisions.js');
const proxyInstructionsSource = read('lib/proxy-instructions.js');
const proxyRulingsSource = read('routes/proxy-rulings.js');
const promptTemplateDefsSource = read('lib/prompt-template-defs.js');
const metaPromptTemplateSource = read('lib/prompts/meta-prompt-template.js');
const autopilotManualSource = read('docs/autopilot-operating-manual.md');
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

describe('no-re-raise guidance literal list (LIN-2891/LIN-3038)', () => {
  const liveSites = [
    { label: 'lib/prompt-template-defs.js', source: promptTemplateDefsSource, expected: 2 },
    { label: 'lib/prompts/meta-prompt-template.js', source: metaPromptTemplateSource, expected: 2 },
    { label: 'docs/autopilot-operating-manual.md', source: autopilotManualSource, expected: 1 },
  ];

  test('the live prompt sources carry 0 "answered, or dismissed" and 5 "dismissed, or withdrawn"', () => {
    let oldTotal = 0;
    let newTotal = 0;
    for (const { label, source, expected } of liveSites) {
      const oldCount = countOccurrences(source, 'answered, or dismissed');
      const newCount = countOccurrences(source, 'dismissed, or withdrawn');
      assert.strictEqual(oldCount, 0, `${label} must carry no stale "answered, or dismissed" list`);
      assert.strictEqual(newCount, expected,
        `${label} must carry exactly ${expected} broadened "dismissed, or withdrawn" list(s)`);
      oldTotal += oldCount;
      newTotal += newCount;
    }
    assert.strictEqual(oldTotal, 0, 'no live prompt source still carries the old list');
    assert.strictEqual(newTotal, 5, 'the 5 live no-re-raise guidance sites are broadened');
  });

  test('the 4 lib/ sites keep their includeResolved scope note (never a task-bound one)', () => {
    // The two prompt-template-defs.js sites and the meta-prompt-template.js
    // sites each restate the scope note; broadening the literal list must not
    // have dropped it.
    assert.strictEqual(countOccurrences(promptTemplateDefsSource, 'never a task-bound one'), 2);
    assert.strictEqual(countOccurrences(metaPromptTemplateSource, 'never a task-bound one'), 2);
  });

  test('the derived snapshot scripts/eval/meta-prompt.baseline.txt is accounted for and in sync', () => {
    // It is NOT a live prompt source — it is regenerated from the live
    // meta-prompt template by scripts/eval/regen-baseline.mjs. Assert it was
    // regenerated in this change (0 old / 2 new) AND that it is byte-identical
    // to a fresh render, so a future template edit cannot silently leave it
    // stale.
    assert.strictEqual(countOccurrences(baselineSource, 'answered, or dismissed'), 0,
      'the baseline snapshot was regenerated after the guidance edit');
    assert.strictEqual(countOccurrences(baselineSource, 'dismissed, or withdrawn'), 2,
      'the baseline snapshot mirrors the live template\'s 2 broadened sites');

    const fresh = buildMetaPromptTemplate({
      issueContext: '{{ISSUE_CONTEXT}}',
      identifier: '{{IDENTIFIER}}',
      hasSubtasks: false, subtaskCount: 0, completedCount: 0, inProgressCount: 0, remainingCount: 0,
      hasComments: false, commentCount: 0,
      aiHints: formatAIHintsForMetaPrompt(),
      actionVocabulary: getAIRecommendationActionNames().join(', '),
      completionSignals: formatAllSignalsForMetaPrompt(),
      focusedSubtaskId: null,
      featureFlags: {}
    });
    assert.strictEqual(baselineSource, fresh,
      'scripts/eval/meta-prompt.baseline.txt is stale — run `node scripts/eval/regen-baseline.mjs`');
  });
});

/**
 * LIN-4518 (beat 3): the stage prompts that write verdicts say so as records. Witnesses (structural): the review, plan-review
 * and blind-read prompts each ask for a verdict record `on` the change or plan they judged, with its head; the review
 * contract still ends on its verdict line; the close-out and plan prompts point at the verdict record and keep the
 * comment wording the older readers and tests rely on.
 */
process.env.NODE_ENV = 'test';

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { STAGE_KINDS } from '../../lib/prompts/stage-kinds.js';
import { generatePrompt } from '../../lib/prompt-templates.js';

const ticket = { identifier: 'LIN-1', title: 'Writers', description: '', state: { name: 'In Progress', type: 'started' }, labels: [] };

describe('the verdict writers say so as records (LIN-4518, beat 3)', () => {
  test('review: its contract asks for a verdict record on the change it judged, with the head, and still ends on the verdict line', () => {
    const c = STAGE_KINDS.review.contract('LIN-1');
    const record = c.find((line) => line.includes('verdict record'));
    assert.ok(record, 'a verdict-record sentence is in the contract');
    assert.match(record, /judgement` `review`/);
    assert.match(record, /`heads`/);
    assert.match(record, /approve/);
    assert.match(c[c.length - 1], /^End with `### Verdict`/, 'the verdict line stays last (the contract reader reads the words after it)');
  });

  test('plan-review: its contract asks for a verdict record on the plan it judged', () => {
    const c = STAGE_KINDS['plan-review'].contract();
    assert.ok(c.some((line) => /judgement` `plan-review`/.test(line) && /on` the plan record/.test(line)));
  });

  test('blind-read: its prompt asks for a verdict record on each PR\'s change, at the head read', () => {
    const p = generatePrompt('blind-read', ticket, { comments: [{ id: 'c1', body: 'Implementation done: https://github.com/acme/widget/pull/41, CI green.', createdAt: '2026-11-21T10:00:00.000Z' }], allRuns: [] }).prompt;
    assert.match(p, /\*\*The verdict record\*\*/);
    assert.match(p, /judgement` `blind-read`/);
  });

  test('close-out: its prompt reads the verdict record, and keeps the summary-comment reading the older readers rely on', () => {
    const p = generatePrompt('close-out', ticket, { comments: [], allRuns: [], planFacts: { measured: true, hasPlan: false } }).prompt;
    assert.match(p, /verdict record \(judgement `review`/);
    assert.match(p, /most recent review summary comment/);
  });
});

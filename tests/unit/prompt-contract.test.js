/**
 * LIN-3292: every format the stage contract asks for is one a real reader
 * parses. Each test writes the format exactly as the contract words it and runs
 * the reader that keys on it. LIN-4520: the verdicts are records, so the review
 * and plan-review contracts are checked against the record shapes their readers key on.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { formatStageContract } from '../../lib/prompt-contract.js';
import { opensWithCloseOutTitle } from '../../lib/run-trail.js';
import { planFactsOf } from '../../lib/records/plan-facts.js';
import { PLAN_FINDING_TO, PLAN_REVIEW_JUDGEMENT } from '../../lib/records/plan-review-run.js';
import { PLAN_ADDRESSEES } from '../../lib/records/check.js';
import { extractPrUrls } from '../../lib/run-evidence.js';

const titleIn = (contract, word) => contract.match(new RegExp('`(## ' + word + '[^`]*)`'))[1];
const ticks = (contract) => [...contract.matchAll(/`([^`]+)`/g)].map(m => m[1]);
const at = '2026-10-03T00:00:00.000Z';

test('a stage with no parsed format gets no contract', () => {
  assert.strictEqual(formatStageContract('research', 'LIN-1'), '');
  assert.strictEqual(formatStageContract('nope', 'LIN-1'), '');
  assert.strictEqual(formatStageContract('toString', 'LIN-1'), '');
});

test('a read-only tracker gets no contract: it takes no writes', () => {
  assert.strictEqual(formatStageContract('review', 'LIN-1', { write: false }), '');
  assert.notStrictEqual(formatStageContract('review', 'LIN-1', { write: true }), '');
});

test('plan (LIN-4504): the contract writes a plan record and its review finding, the shapes the records readers key on', () => {
  const c = formatStageContract('plan', 'LIN-1');
  assert.ok(!/Implementation Plan|description, under/.test(c), 'no plan goes into the description');
  for (const shape of ['POST /api/proxy/records', '"kind": "plan"', '"in": "LIN-1"', '"to": "implementation"', '"to": "breakdown"', '"to": "plan-review"', '"about": "<the plan id>"', '/revise']) {
    assert.ok(c.includes(shape), shape);
  }
  for (const to of PLAN_ADDRESSEES) assert.ok(c.includes(`"to": "${to}"`), `the contract names the addressee ${to} the records route accepts`);
  // The records the contract asks for fold into the facts the selector reads.
  const facts = planFactsOf({ task: { id: 'task-1', kind: 'task' }, inside: [{ id: 'plan-1', v: 1, kind: 'plan', state: 'kept', in: 'task-1', to: 'breakdown' }], findings: [{ id: 'finding-1', kind: 'finding', state: 'open', to: 'plan-review', links: { about: ['plan-1'] } }] });
  assert.deepEqual([facts.sessionFit, facts.reviewOwed.owed, facts.reviewOwed.why], ['several', true, 'open-finding']);
});

test('design (LIN-4504, John\'s ruling d1d5ab31): writes no plan record, so it has no contract', () => {
  assert.strictEqual(formatStageContract('design', 'LIN-1'), '');
});

test('plan-review (LIN-4504): Approve ends the review finding; other verdicts leave it open', () => {
  const c = formatStageContract('plan-review', 'LIN-1');
  assert.ok(c.includes('On Approve, end the open finding to plan-review about the plan'));
  assert.ok(c.includes('On Request Changes or Needs Discussion, leave it open'));
});

test('plan-review (LIN-4520): the verdict is a record judged plan-review, and its blocking findings are to the plan', () => {
  const c = formatStageContract('plan-review', 'LIN-1');
  assert.ok(c.includes(`"kind": "verdict"`) && c.includes(`"judgement": "${PLAN_REVIEW_JUDGEMENT}"`), 'the verdict record the verdict reader keys on');
  assert.ok(c.includes(`"to": "${PLAN_FINDING_TO}"`), 'the blocking findings are to the addressee the run count reads');
  for (const word of ['approve', 'request-changes', 'needs-discussion']) assert.ok(c.includes(`\`${word}\``), word);
  assert.ok(!/Plan Review Verdict|Blocking findings/.test(c), 'no comment format names the verdict or counts blocking findings');
});

test('implementation: the PR URL shape is the one run-evidence extracts', () => {
  const c = formatStageContract('implementation', 'LIN-1');
  const shape = ticks(c)[0];
  const url = shape.replace('<owner>/<repo>', 'acme/app').replace('<n>', '12');
  const found = extractPrUrls([{ body: `Opened ${url}`, createdAt: at }], ['acme/app']);
  assert.deepStrictEqual(found.map(p => p.number), [12]);
});

test('review (LIN-4520): the verdict is a record with its heads and its outcome words, and the findings to close-out are records', () => {
  const c = formatStageContract('review', 'LIN-1');
  for (const shape of ['"kind": "verdict"', '"judgement": "review"', '"heads"', '"kind": "finding"', '"to": "close-out"']) {
    assert.ok(c.includes(shape), shape);
  }
  for (const word of ['approve', 'request-changes', 'needs-discussion']) assert.ok(c.includes(`\`${word}\``), word);
  assert.ok(!/## Review|### Verdict|CI:/.test(c), 'no comment title, verdict heading or CI line is parsed any more');
});

test('close-out: the contract title is the one the share page opens on, and it is not a verdict', () => {
  const c = formatStageContract('close-out', 'LIN-1');
  assert.ok(opensWithCloseOutTitle(`${titleIn(c, 'Close-out')}\n\nSummary.`));
  assert.ok(!opensWithCloseOutTitle('## Review — LIN-1\n\n**Verdict: Approve**'));
});

test('close-out: LIN-4502 retired the prune, so the contract carries only the title', () => {
  const c = formatStageContract('close-out', 'LIN-1');
  assert.deepStrictEqual(ticks(c), ['## Close-out — LIN-1']);
  assert.doesNotMatch(c, /prune/i);
});

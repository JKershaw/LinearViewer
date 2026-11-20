/**
 * LIN-3292: every format the stage contract asks for is one a real reader
 * parses. Each test writes the format exactly as the contract words it and runs
 * the reader that keys on it.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { formatStageContract } from '../../lib/prompt-contract.js';
import { latestReviewComment, readRunLedger } from '../../lib/run-trail.js';
import { extractVerdict } from '../../lib/run-trail.js';
import { planFactsOf } from '../../lib/records/plan-facts.js';
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

test('plan-review: the verdict comment shape resolves its verdict, even when a finding names another word', () => {
  const c = formatStageContract('plan-review', 'LIN-1');
  const [header, label] = ticks(c);
  assert.strictEqual(header, '### Plan Review Verdict');
  const comment = `${header}\n${label} Request Changes — check 2 names no gap.\n\n1. Completeness: I would approve the bound.`;
  assert.strictEqual(extractVerdict(comment), 'request changes');
});

test('plan-review: the contract asks for a Blocking findings count line on Request Changes (LIN-3651)', () => {
  const c = formatStageContract('plan-review', 'LIN-1');
  assert.ok(c.includes('On Request Changes, also write `Blocking findings: <n>` on its own line'));
});

test('implementation: the PR URL shape is the one run-evidence extracts', () => {
  const c = formatStageContract('implementation', 'LIN-1');
  const shape = ticks(c)[0];
  const url = shape.replace('<owner>/<repo>', 'acme/app').replace('<n>', '12');
  const found = extractPrUrls([{ body: `Opened ${url}`, createdAt: at }], ['acme/app']);
  assert.deepStrictEqual(found.map(p => p.number), [12]);
});

test('review: title, head, CI line, ledger and verdict all parse', () => {
  const c = formatStageContract('review', 'LIN-1');
  const body = [
    titleIn(c, 'Review'), '', 'Reviewed head `abc1234`.', '',
    'CI: green on the PR head.', '',
    '### What CI Did Not Prove', '',
    '- L1 (inside): the producer sends the new field. Settled by a manual repro.',
    '- L2 (outside): the export page. Discharged by LIN-9.', '',
    '### Verdict', '', 'Approve — conditional on close-out discharging the ledger'
  ].join('\n');
  const comments = [{ body, createdAt: at }];
  assert.ok(latestReviewComment(comments));
  const read = readRunLedger(comments);
  assert.strictEqual(read.sha, 'abc1234');
  assert.match(read.ciLine, /^CI: green/);
  assert.strictEqual(read.ledger.present, true, 'the section is present');
  assert.strictEqual(read.ledger.empty, false, 'and not stated empty: a pre-cutover ledger, held as not measured (LIN-4495)');
  assert.strictEqual(read.verdict, 'approve-conditional');
});

test('review: every verdict form parses; the review writes no ledger section any more (LIN-4495: its findings are records)', () => {
  const c = formatStageContract('review', 'LIN-1');
  const verdicts = ticks(c).slice(ticks(c).indexOf('### Verdict') + 1);
  const expected = ['approve', 'approve-conditional', 'request-changes', 'needs-discussion'];
  verdicts.forEach((v, i) => {
    const body = `## Review — LIN-1\n\n### Verdict\n${v}`;
    const read = readRunLedger([{ body, createdAt: at }]);
    assert.strictEqual(read.ledger.present, false, 'no ledger section on a review that records findings');
    assert.strictEqual(read.verdict, expected[i], v);
  });
});

test('close-out: the contract title is never mistaken for the latest review', () => {
  const c = formatStageContract('close-out', 'LIN-1');
  const review = { body: '## Review — LIN-1\n\n**Verdict: Approve**', createdAt: at };
  const closeOut = { body: `${titleIn(c, 'Close-out')}\n\nLedger review: discharged. Verdict: Approve.`, createdAt: '2026-10-03T01:00:00.000Z' };
  assert.strictEqual(latestReviewComment([review, closeOut]), review);
});

test('close-out: LIN-4502 retired the prune, so the contract carries only the title', () => {
  const c = formatStageContract('close-out', 'LIN-1');
  assert.deepStrictEqual(ticks(c), ['## Close-out — LIN-1']);
  assert.doesNotMatch(c, /prune/i);
});

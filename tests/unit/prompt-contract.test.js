/**
 * LIN-3292: every format the stage contract asks for is one a real reader
 * parses. Each test writes the format exactly as the contract words it and runs
 * the reader that keys on it.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { formatStageContract } from '../../lib/prompt-contract.js';
import { latestReviewComment, readRunLedger } from '../../lib/run-ledger.js';
import { extractPlanSection } from '../../lib/file-pointer.js';
import { extractSessionFit } from '../../lib/recommendation-facts.js';
import { extractVerdict, __internal as roundTrips } from '../../lib/plan-review-round-trips.js';
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

test('plan: the heading, session-fit phrase and gate line are the ones their readers key on', () => {
  const c = formatStageContract('plan', 'LIN-1');
  const [heading, fits, multi, dueYes, dueNo] = ticks(c);
  assert.strictEqual(heading, '## Implementation Plan');
  assert.strictEqual(extractPlanSection(`Intro\n\n${heading}\n\n- lib/a.js: change\n`).trim(), '- lib/a.js: change');
  assert.strictEqual(extractSessionFit(`${heading}\n\n${fits}`), 'fits one session');
  assert.strictEqual(extractSessionFit(`${heading}\n\n${multi}`), 'needs multiple sessions');
  assert.ok(roundTrips.GATE_DUE_MARKER.test(dueYes));
  assert.ok(!roundTrips.GATE_DUE_MARKER.test(dueNo));
});

test('plan-review: the verdict comment shape resolves its verdict, even when a finding names another word', () => {
  const c = formatStageContract('plan-review', 'LIN-1');
  const [header, label] = ticks(c);
  assert.strictEqual(header, '### Plan Review Verdict');
  const comment = `${header}\n${label} Request Changes — check 2 names no gap.\n\n1. Completeness: I would approve the bound.`;
  assert.strictEqual(extractVerdict(comment), 'request changes');
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
  assert.deepStrictEqual(read.ledger.items.map(i => [i.scope, i.discharged]), [['inside', false], ['outside', true]]);
  assert.strictEqual(read.verdict, 'approve-conditional');
});

test('review: the empty-ledger line and every verdict form parse', () => {
  const c = formatStageContract('review', 'LIN-1');
  const empty = ticks(c).find(t => t.includes('ledger empty'));
  const verdicts = ticks(c).slice(ticks(c).indexOf('### Verdict') + 1);
  const expected = ['approve', 'approve-conditional', 'request-changes', 'needs-discussion'];
  verdicts.forEach((v, i) => {
    const body = `## Review — LIN-1\n\n### What CI Did Not Prove\n\n${empty}\n\n### Verdict\n${v}`;
    const read = readRunLedger([{ body, createdAt: at }]);
    assert.strictEqual(read.ledger.empty, true);
    assert.strictEqual(read.verdict, expected[i], v);
  });
});

test('close-out: the contract title is never mistaken for the latest review', () => {
  const c = formatStageContract('close-out', 'LIN-1');
  const review = { body: '## Review — LIN-1\n\n**Verdict: Approve**', createdAt: at };
  const closeOut = { body: `${titleIn(c, 'Close-out')}\n\nLedger review: discharged. Verdict: Approve.`, createdAt: '2026-10-03T01:00:00.000Z' };
  assert.strictEqual(latestReviewComment([review, closeOut]), review);
});

test('close-out: the literals it keeps through the prune are the ones the readers read', () => {
  const c = formatStageContract('close-out', 'LIN-1');
  const stub = `Shipped in PR 12.\n\n## ${ticks(c)[1]}\n\n- lib/a.js\n\nfits one session\n\n${ticks(c)[4]} yes`;
  assert.strictEqual(extractPlanSection(stub).trim().split('\n')[0], '- lib/a.js');
  assert.strictEqual(extractSessionFit(stub), 'fits one session');
  assert.ok(roundTrips.GATE_DUE_MARKER.test(stub));
});

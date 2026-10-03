/**
 * LIN-3292/LIN-3296: every format the stage contract asks for is one a real
 * reader parses. Each test writes the format exactly as the contract words it
 * and runs the reader that keys on it.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { formatStageContract } from '../../lib/prompt-contract.js';
import { latestReviewComment, readRunLedger } from '../../lib/run-ledger.js';
import { extractPlanSection } from '../../lib/file-pointer.js';

const titleIn = (contract, word) => contract.match(new RegExp('`(## ' + word + '[^`]*)`'))[1];

test('a stage with no parsed format gets no contract', () => {
  assert.strictEqual(formatStageContract('research', 'LIN-1'), '');
  assert.strictEqual(formatStageContract('nope', 'LIN-1'), '');
});

test('plan: the Implementation Plan heading is the one file-pointer reads', () => {
  const c = formatStageContract('plan', 'LIN-1');
  const heading = c.match(/`(## Implementation Plan)`/)[1];
  assert.strictEqual(extractPlanSection(`Intro\n\n${heading}\n\n- lib/a.js: change\n`).trim(), '- lib/a.js: change');
});

test('review: the contract title and head line are read as the latest review and its sha', () => {
  const c = formatStageContract('review', 'LIN-1');
  const body = `${titleIn(c, 'Review')}\n\nReviewed head \`abc1234\`.\n\n**Verdict: Approve**`;
  const read = readRunLedger([{ body, createdAt: '2026-10-03T00:00:00.000Z' }]);
  assert.ok(latestReviewComment([{ body, createdAt: '2026-10-03T00:00:00.000Z' }]));
  assert.strictEqual(read.sha, 'abc1234');
});

test('close-out: the contract title is never mistaken for the latest review', () => {
  const c = formatStageContract('close-out', 'LIN-1');
  const review = { body: '## Review — LIN-1\n\n**Verdict: Approve**', createdAt: '2026-10-03T00:00:00.000Z' };
  const closeOut = { body: `${titleIn(c, 'Close-out')}\n\nLedger review: discharged. Verdict: Approve.`, createdAt: '2026-10-03T01:00:00.000Z' };
  assert.strictEqual(latestReviewComment([review, closeOut]), review);
});

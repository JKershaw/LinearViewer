/**
 * LIN-3497: the close-out read chain reads "a review is on record" the same way
 * buildRunEvidence does — only a real review summary comment is a review. A task
 * whose comments hold no review summary has `ledger === null` and
 * `state.review.verdict === null`, not a non-null 'unknown' model.
 *
 * Seam fakes only (the `closeOut` seam of close-out-not-ready-dispatch.test.js);
 * no live hosts, no model calls.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readCloseOutChain } from '../../lib/close-out-readiness.js';

const reviewBody = '## Review\n\nReviewed head `aaaaaaa1111111`.\n\n### What CI Did Not Prove\n| # | Claim | In/Out | Discharge |\n| --- | --- | --- | --- |\n| 1 | one claim | In | none |\n\n**Verdict: Approve**';
const comment = (body, createdAt) => ({ body, createdAt, user: 'someone' });

const chainFor = (comments) => readCloseOutChain({
  workspace: { urlKey: 'acme' },
  issueIdentifier: 'LIN-1',
  seam: {
    resolveProvider: () => ({ provider: { async fetchIssueComments() { return comments; } }, callScope: 'scope' }),
    readPrStatus: async () => { throw new Error('no PR expected'); },
    isStopAtRun: async () => null,
  },
  runnerReady: true,
  owner: true,
  byPersonCheck: true,
  stopAt: null,
});

describe('readCloseOutChain review on record (LIN-3497)', () => {
  test('no review summary comment: ledger and state.review.verdict are null', async () => {
    const { ledger, state } = await chainFor([comment('an ordinary comment', '2026-07-01T00:00:00.000Z')]);
    assert.equal(ledger, null);
    assert.equal(state.review.verdict, null);
    assert.equal(state.review.approved, false);
  });

  test('no comments at all: ledger is null', async () => {
    const { ledger, state } = await chainFor([]);
    assert.equal(ledger, null);
    assert.equal(state.review.verdict, null);
  });

  test('a review summary comment is still parsed into the ledger', async () => {
    const { ledger, state } = await chainFor([comment(reviewBody, '2026-07-02T00:00:00.000Z')]);
    assert.notEqual(ledger, null);
    assert.equal(ledger.verdict, 'approve');
    assert.equal(state.review.verdict, 'approve');
  });
});

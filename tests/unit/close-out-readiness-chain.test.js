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

import { FINDINGS_NONE } from '../../lib/close-out-findings.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readCloseOutChain } from '../../lib/close-out-readiness.js';
import { standingFromComments } from '../helpers/comment-path-frozen.js';

const reviewBody = '## Review\n\nReviewed head `aaaaaaa1111111`.\n\n### What CI Did Not Prove\n| # | Claim | In/Out | Discharge |\n| --- | --- | --- | --- |\n| 1 | one claim | In | none |\n\n**Verdict: Approve**';
const comment = (body, createdAt) => ({ body, createdAt, user: 'someone' });

const chainFor = (comments) => readCloseOutChain({
  openFindings: FINDINGS_NONE,
  workspace: { urlKey: 'acme' },
  issueIdentifier: 'LIN-1',
  seam: {
    resolveProvider: () => ({ provider: { async fetchIssueComments() { return comments; } }, callScope: 'scope' }),
    readPrStatus: async () => { throw new Error('no PR expected'); },
    isStopAtRun: async () => null,
  },
  runnerReady: true,
  owner: true,
  actor: 'person',
  stopAt: null,
  // LIN-4518 (beat 4): the gate reads the records standing; this trail's comments are written as the comment-trail standing.
  standing: standingFromComments(comments),
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

describe('readCloseOutChain carries the blind read (LIN-4437)', () => {
  const PR = 'https://github.com/acme/repo/pull/7';
  const readBody = `## Blind read\n\nVerdict: worse — lib/foo.js grew a second copy of the parser.\n\nRead: ${PR}`;

  test('an approving review then a valid read after it: ledger.blindRead names the read', async () => {
    const { ledger } = await chainFor([
      { ...comment(reviewBody, '2026-07-02T00:00:00.000Z'), id: 'review-1' },
      { ...comment(readBody, '2026-07-03T00:00:00.000Z'), id: 'read-1' },
    ]);
    assert.equal(ledger.verdict, 'approve');
    assert.notEqual(ledger.blindRead, null);
    assert.equal(ledger.blindRead.verdict, 'worse');
    assert.equal(ledger.blindRead.commentId, 'read-1');
    assert.deepEqual(ledger.blindRead.prs, [PR]);
  });

  test('a read before the review is not this review\'s read: ledger.blindRead is null', async () => {
    const { ledger } = await chainFor([
      { ...comment(readBody, '2026-07-01T00:00:00.000Z'), id: 'read-0' },
      { ...comment(reviewBody, '2026-07-02T00:00:00.000Z'), id: 'review-1' },
    ]);
    assert.equal(ledger.blindRead, null);
  });
});

// LIN-4322's cap describe block (a Linear comment read capped at CONNECTION_CAP, no merge judged on a prefix of the trail)
// retired with LIN-4518 beat 4: the close-out gate no longer reads the comment trail, so it has no comment read to cap. The
// records standing is whole by construction (tests/unit/lin-4518-*.test.js).

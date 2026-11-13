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

import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readCloseOutChain } from '../../lib/close-out-readiness.js';
import { GraphQLClient } from 'graphql-request';
import { CONNECTION_CAP, linearProvider } from '../../lib/providers/linear/index.js';

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
  actor: 'person',
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

describe('readCloseOutChain when the comment read hits the cap (LIN-4322)', () => {
  test('rejects over the real Linear read: no merge or Done is judged on a prefix of the trail', async () => {
    const all = Array.from({ length: CONNECTION_CAP + 1 }, (_, i) => ({
      id: `c${i}`, body: `c ${i}`, createdAt: new Date(Date.UTC(2026, 10, 1, 0, 0, i)).toISOString(), user: { name: 'Fake' },
    }));
    const m = mock.method(GraphQLClient.prototype, 'request', async (query, variables) => {
      const start = variables.after === undefined ? 0 : Number(Buffer.from(variables.after, 'base64').toString());
      const end = Math.min(start + 100, all.length);
      const page = {
        nodes: all.slice(start, end),
        pageInfo: { hasNextPage: end < all.length, endCursor: end < all.length ? Buffer.from(String(end)).toString('base64') : null },
      };
      return variables.after === undefined ? { issue: { id: 'issue-1', comments: page } } : { issue: { comments: page } };
    });
    try {
      await assert.rejects(
        readCloseOutChain({
          workspace: { urlKey: 'acme' },
          issueIdentifier: 'LIN-1',
          seam: {
            resolveProvider: () => ({ provider: linearProvider, callScope: 'lin_api_test' }),
            readPrStatus: async () => { throw new Error('no PR expected'); },
            isStopAtRun: async () => null,
          },
          runnerReady: true,
          owner: true,
          actor: 'person',
          stopAt: null,
        }),
        /cannot read the latest review/,
      );
    } finally {
      m.mock.restore();
    }
  });
});

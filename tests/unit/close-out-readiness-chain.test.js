/**
 * LIN-3497: the close-out read chain reads "a review is on record" the same way buildRunEvidence does — only a real review
 * record is a review. A task with no review record has `ledger === null` and `state.review.verdict === null`.
 *
 * LIN-4518 step 3: the chain reads its review, its blind read and its landing from the ticket's records, not from comments,
 * so the fixtures here are records (tests/helpers/records-scenario.js). No comment is read, so the comment cap (LIN-4322)
 * no longer applies; its invariant is that an unreadable ticket refuses rather than deciding on an empty trail.
 *
 * Seam fakes only (no live hosts, no model calls).
 */
process.env.NODE_ENV = 'test';

import { FINDINGS_NONE } from '../../lib/close-out-findings.js';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readCloseOutChain } from '../../lib/close-out-readiness.js';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { seededRecordsStore, ev } from '../helpers/records-scenario.js';

const harness = createMangoTmpdir('lin-3497-close-out-readiness-chain-');
before(() => harness.connect());
after(() => harness.close());

const PR = 'https://github.com/acme/repo/pull/7';
const REVIEWED = 'aaaaaaa1111111';

/** The chain over the ticket's records (`events`); `recordsStore` overrides the store (a fault, say). */
async function chainFor(events, { recordsStore = null } = {}) {
  return readCloseOutChain({
    openFindings: FINDINGS_NONE,
    workspace: { urlKey: 'acme' },
    issueIdentifier: 'LIN-1',
    recordsStore: recordsStore ?? await seededRecordsStore(harness, events, { urlKey: 'acme', tickets: ['LIN-1'] }),
    seam: {
      resolveProvider: () => ({ provider: { async fetchIssueComments() { throw new Error('the chain reads no comments'); } }, callScope: 'scope' }),
      readPrStatus: async () => { throw new Error('no PR expected'); },
      isStopAtRun: async () => null,
    },
    runnerReady: true,
    owner: true,
    actor: 'person',
    stopAt: null,
  });
}

const approve = (n) => ev.review(n, PR, { heads: { [PR]: REVIEWED } });

describe('readCloseOutChain review on record (LIN-3497)', () => {
  test('no review on record: ledger and state.review.verdict are null', async () => {
    const { ledger, state } = await chainFor([ev.pr(1, PR, REVIEWED)]);
    assert.equal(ledger, null);
    assert.equal(state.review.verdict, null);
    assert.equal(state.review.approved, false);
  });

  test('no task on record: ledger is null', async () => {
    const { ledger, state } = await chainFor([]);
    assert.equal(ledger, null);
    assert.equal(state.review.verdict, null);
  });

  test('a review record is still the ledger', async () => {
    const { ledger, state } = await chainFor([ev.pr(1, PR, REVIEWED), approve(2)]);
    assert.notEqual(ledger, null);
    assert.equal(ledger.verdict, 'approve');
    assert.equal(state.review.verdict, 'approve');
  });
});

describe('readCloseOutChain carries the blind read (LIN-4437)', () => {
  test('an approving review then a valid read after it: ledger.blindRead names the read', async () => {
    const { ledger } = await chainFor([ev.pr(1, PR, REVIEWED), approve(2), ev.read(3, PR, { outcome: 'worse' })]);
    assert.equal(ledger.verdict, 'approve');
    assert.notEqual(ledger.blindRead, null);
    assert.equal(ledger.blindRead.verdict, 'worse');
    assert.equal(typeof ledger.blindRead.commentId, 'string', 'the read is the verdict record on the change');
    assert.deepEqual(ledger.blindRead.prs, [PR]);
  });

  test('a read before the review that names the landing stands for it: one read per change (LIN-4544)', async () => {
    const { ledger } = await chainFor([ev.pr(0, PR, REVIEWED), ev.read(1, PR, { outcome: 'worse' }), approve(2)]);
    assert.equal(ledger.blindRead.verdict, 'worse');
    assert.deepEqual(ledger.blindRead.prs, [PR]);
  });
});

describe('readCloseOutChain when the ticket\'s records cannot be read (LIN-4322, on records)', () => {
  test('an unreadable ticket refuses: no merge or Done is judged on an unread trail', async () => {
    const unreadable = { async taskForTicket() { throw new Error('the store is down'); } };
    await assert.rejects(chainFor([], { recordsStore: unreadable }), /could not be read/);
  });
});

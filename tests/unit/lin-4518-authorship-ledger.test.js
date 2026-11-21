/**
 * LIN-4518 (P5, beat 4, the parent's ruling: ledger-all): authorship is read from the ledger of Harbour's own comment
 * writes. A comment whose id is in the ledger is Harbour's, whatever its words; a comment the ledger does not hold keeps
 * the body reading (the classifier) for history that predates the ledger, which is not rewritten and not guessed.
 *
 * Witnesses: a Harbour write that reads like a person's (its words say "keep the old flag") is recorded and is not a
 * person's comment, so it does not hold the look-first route; a person's comment the ledger does not hold is still a
 * person's; the store records a Harbour write and reads it back.
 *
 * Run with: node --test tests/unit/lin-4518-authorship-ledger.test.js
 */
import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { HarbourCommentsStore } from '../../lib/harbour-comments-store.js';
import { isPersonCommentOf } from '../../lib/run-trail.js';
import { lookFirstOff } from '../../lib/recommendation-look-first.js';
import { trackerPortOf } from '../../lib/records-tracker.js';

const WORDS = 'Make the export button download a CSV.';
const HARBOUR_WORDS = 'Please keep the old flag.';
const harbourWrite = { id: 'hb-1', body: HARBOUR_WORDS, createdAt: '2026-10-06T10:00:00.000Z' };
const personNote = { id: 'pn-1', body: 'Please keep the old flag.', createdAt: '2026-10-06T10:00:00.000Z' };

describe('LIN-4518: authorship is read from the ledger of Harbour writes', () => {
  test('a comment the ledger holds is Harbour\'s, whatever its words say', () => {
    assert.equal(isPersonCommentOf(harbourWrite, new Set(['hb-1'])), false);
  });

  test('a comment the ledger does not hold is a person\'s when its words read as one', () => {
    assert.equal(isPersonCommentOf(personNote, new Set(['hb-1'])), true);
  });

  test('history the ledger predates keeps the body reading (not rewritten, not guessed)', () => {
    const legacySummary = { id: 'old-1', body: '**Harbour summary** · plan v1\n\nThe plan.', createdAt: '2026-10-01T10:00:00.000Z' };
    assert.equal(isPersonCommentOf(legacySummary, new Set()), false, 'a summary reads as Harbour\'s with no ledger entry');
  });

  test('look-first: a Harbour write after the route started does not hold it; a person\'s note does', () => {
    const start = { id: 's', body: 'Work started.', createdAt: '2026-10-06T09:00:00.000Z' };
    const runs = [{ stage: 'survey-task', outcome: 'done', at: '2026-10-06T09:00:00.000Z', dispatchedAt: '2026-10-06T09:00:00.000Z' }];
    const issue = { description: '', state: { type: 'started' }, blockedBy: [] };
    const base = { asked: WORDS, children: [], allRuns: runs, planFacts: { measured: true, hasPlan: false } };
    assert.equal(lookFirstOff(issue, { ...base, comments: [start, { ...harbourWrite, createdAt: '2026-10-06T10:00:00.000Z' }], harbourIds: new Set(['hb-1']) }), null,
      'the Harbour write is not a person\'s comment, so nothing holds the route');
    assert.equal(lookFirstOff(issue, { ...base, comments: [start, { ...personNote, createdAt: '2026-10-06T10:00:00.000Z' }], harbourIds: new Set(['hb-1']) }), "a person's comment holds it");
  });
});

describe('LIN-4518: the ledger records a Harbour write and reads it back', () => {
  const harness = createMangoTmpdir('lin-4518-ledger-');
  let store;
  before(() => harness.connect());
  after(() => harness.close());
  beforeEach(() => {
    store = new HarbourCommentsStore({ collection: harness.freshDb().collection('harbour-comments') });
  });

  test('a recorded id reads back as Harbour\'s; an unrecorded one does not', async () => {
    await store.record({ urlKey: 'ws-a', commentId: 'hb-1' });
    const recorded = await store.wereRecordedByHarbour('ws-a', [harbourWrite, personNote]);
    assert.deepEqual([...recorded].sort(), ['hb-1']);
    const other = await store.wereRecordedByHarbour('ws-b', [harbourWrite]);
    assert.equal(other.size, 0, 'the ledger is per workspace');
  });
});

describe('LIN-4518: Harbour\'s own tracker comment is recorded in the ledger at the write', () => {
  const harness = createMangoTmpdir('lin-4518-ledger-write-');
  before(() => harness.connect());
  after(() => harness.close());

  test('the tracker port records the id the tracker returns for the comment it posted', async () => {
    const store = new HarbourCommentsStore({ collection: harness.freshDb().collection('harbour-comments') });
    const provider = {
      async issueDetail() { return { id: 'iss-1' }; },
      async createComment() { return { success: true, comment: { id: 'cm-9' } }; },
    };
    await trackerPortOf({ provider, scope: 'tok', harbourComments: { urlKey: 'ws-a', store } }).comment('LIN-1', 'Please keep the old flag.');
    const recorded = await store.wereRecordedByHarbour('ws-a', [{ id: 'cm-9', body: 'Please keep the old flag.' }]);
    assert.deepEqual([...recorded], ['cm-9'], 'the id Harbour posted is in the ledger');
  });
});


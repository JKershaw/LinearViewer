/**
 * LIN-4518 (P5, beat 4): the E2E fixture seam (lib/records/writes.js createTestRecordSeed, mounted by routes/test.js) writes
 * the records the gates read. This witness seeds a real store and reads the ticket's standing back through the gates' own
 * reader (lib/task-standing.js standingForTicket), so a fixture that does not reach the gates fails here, not in CI.
 *
 * Run with: node --test tests/unit/lin-4518-test-record-seed.test.js
 */
import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { RecordsStore, RECORDS_COLLECTION, REFS_COLLECTION, QUERY_LOG_COLLECTION } from '../../lib/records-store.js';
import { INDEX_SPECS } from '../../lib/db-indexes.js';
import { createTestRecordSeed } from '../../lib/records/writes.js';
import { standingForTicket } from '../../lib/task-standing.js';

const harness = createMangoTmpdir('lin-4518-seed-');
const URL_KEY = 'ws-seed';
const TICKET = 'LOCAL-EV1';
const PR = 'https://github.com/acme/widget/pull/12';
const HEAD = 'abc1234deadbeefdeadbeefdeadbeefdeadbeef0';
let store;
let seed;

before(() => harness.connect());
after(() => harness.close());
beforeEach(async () => {
  const db = harness.freshDb();
  for (const collection of [RECORDS_COLLECTION, REFS_COLLECTION]) {
    for (const spec of INDEX_SPECS.filter((x) => x.collection === collection && x.options?.unique)) {
      await db.collection(collection).createIndex(spec.keySpec, spec.options);
    }
  }
  store = new RecordsStore({
    records: db.collection(RECORDS_COLLECTION),
    refs: db.collection(REFS_COLLECTION),
    queryLog: db.collection(QUERY_LOG_COLLECTION),
    now: () => new Date('2026-11-21T10:00:00.000Z'),
  });
  seed = createTestRecordSeed({ recordsStore: store });
});

describe('LIN-4518: the E2E fixture seam writes the records the gates read', () => {
  test('an approving review and a same blind read on the PR are what the gates read for the ticket', async () => {
    const out = await seed({
      urlKey: URL_KEY, ticket: TICKET, asked: 'Seeded task',
      changes: [{ ref: PR, head: HEAD }],
      verdicts: [{ judgement: 'review', outcome: 'approve' }, { judgement: 'blind-read', outcome: 'same', by: 'blind-read' }],
    });
    assert.equal(out.problem, undefined);
    const standing = await standingForTicket({ recordsStore: store, urlKey: URL_KEY, ticket: TICKET });
    assert.equal(standing.review.outcome, 'approve');
    assert.equal(standing.review.sha, HEAD, 'the review judged the head the seed gave the change');
    assert.equal(standing.blindRead.outcome, 'same');
    assert.deepEqual(standing.landing, [PR]);
  });

  test('a reseed of the ticket replaces its records: an earlier verdict does not judge the new seed', async () => {
    await seed({ urlKey: URL_KEY, ticket: TICKET, changes: [{ ref: PR, head: HEAD }], verdicts: [{ judgement: 'review', outcome: 'request-changes' }] });
    await seed({ urlKey: URL_KEY, ticket: TICKET, changes: [{ ref: PR, head: HEAD }], verdicts: [{ judgement: 'review', outcome: 'approve' }] });
    const standing = await standingForTicket({ recordsStore: store, urlKey: URL_KEY, ticket: TICKET });
    assert.equal(standing.review.outcome, 'approve');
  });

  test('a ticket seeded with no verdict has no review on record (the selector routes it to review)', async () => {
    await seed({ urlKey: URL_KEY, ticket: TICKET, changes: [{ ref: PR, head: HEAD }], verdicts: [] });
    const standing = await standingForTicket({ recordsStore: store, urlKey: URL_KEY, ticket: TICKET });
    assert.equal(standing.review, null);
  });
});

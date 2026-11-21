/**
 * LIN-4518 review finding d99d9922: a gating read refreshes the task's change heads from their PRs before it reads the
 * standing. A push after an approval, with no verdict write and no close-out in between, must already show the approval
 * stale on the read every gate makes (standingForTicket), not only on close-out's own live comparison.
 *
 * Witnesses over the real records store and the real verdict route. The mutation that removes the refresh from
 * standingForTicket turns the first witness red (the standing still reads the approval current).
 */
process.env.NODE_ENV = 'test';

import { describe, test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { createRecordsRouteHarness } from '../helpers/records-route-harness.js';
import { createFakeTracker } from '../helpers/fake-records-tracker.js';
import { standingForTicket, setStandingPrReaderFor } from '../../lib/task-standing.js';

const URL_KEY = 'lin-4518-gate-refresh';
const TICKET = 'LIN-4518';
const REPO = 'acme/widget';
const T0 = '2026-11-21T10:00:00.000Z';
const prUrl = (n) => `https://github.com/${REPO}/pull/${n}`;

const harness = createMangoTmpdir('lin-4518-gate-refresh-');
before(() => harness.connect());
after(() => harness.close());

function status(number, { sha, merged = false }) {
  return {
    repo: REPO, number, readable: true, state: merged ? 'closed' : 'open', merged,
    head: { ref: `feat/pr-${number}`, sha }, ref: sha, created_at: T0, merged_at: merged ? T0 : null, checks: [],
  };
}

let rh;
let store;
let taskId;
let prs;
let tokens;
const clock = (iso) => { store.now = () => new Date(iso); };
const readPrStatus = async ({ number }) => {
  const p = prs.get(number);
  return p ? status(number, p) : { readable: false };
};
const post = (token, body) => rh.post('/api/proxy/records', token, body);

beforeEach(async () => {
  prs = new Map();
  const tracker = createFakeTracker({
    tickets: [{ identifier: TICKET, title: 'gate refresh', description: 'Asked.', state: { name: 'In Progress', type: 'started' }, parent: null }],
  });
  rh = await createRecordsRouteHarness({
    harness, urlKey: URL_KEY, tickets: new Map(), people: [], readTicket: tracker.readTicket, tracker: () => tracker.port,
    changePrReaderFor: () => readPrStatus,
  });
  store = rh.store;
  for (const [id, stage] of [['row-impl', 'implementation'], ['row-review', 'review']]) {
    await store.openRun(URL_KEY, { id, stage, lineage: 'row-root', at: '2026-11-19T10:00:00.000Z' });
  }
  tokens = { impl: await rh.mintRunToken('row-impl'), review: await rh.mintRunToken('row-review') };
  taskId = (await store.ensureTask(URL_KEY, { identifier: TICKET, asked: 'gate refresh.', closed: false, closedReason: null }, { by: 'Harbour', at: T0 })).id;
  setStandingPrReaderFor((urlKey) => { assert.equal(urlKey, URL_KEY); return readPrStatus; });
});

afterEach(async () => {
  setStandingPrReaderFor(null);
  if (rh) await rh.close();
  rh = null;
});

async function changeAndApprove(n, sha) {
  prs.set(n, { sha });
  clock('2026-11-21T11:00:00.000Z');
  const c = await post(tokens.impl, { kind: 'change', in: taskId, ref: prUrl(n), head: sha, run: 'row-impl' });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  const v = await post(tokens.review, {
    kind: 'verdict', judgement: 'review', outcome: 'approve', reasoning: 'read at the head named',
    on: [c.body.id], heads: { [c.body.id]: sha }, run: 'row-review',
  });
  assert.equal(v.status, 201, JSON.stringify(v.body));
  return c.body.id;
}

describe('witness: the gating read refreshes heads before it reads (finding d99d9922)', () => {
  test('a push after the approval, with no verdict write since, reads as stale on the gating read', async () => {
    await changeAndApprove(301, 'H1');
    prs.set(301, { sha: 'H2' });
    clock('2026-11-21T11:30:00.000Z');
    const s = await standingForTicket({ recordsStore: store, urlKey: URL_KEY, ticket: TICKET });
    assert.ok(s, 'the standing is read');
    assert.equal(s.review.outcome, 'approve');
    assert.equal(s.review.stale, true, 'the push the judge never saw must show the approval stale on the gate read itself');
    assert.equal(s.workAfterReview, true);
  });

  test('the refresh writes the new head as a version of the change, so the next read sees it without a refresh', async () => {
    const changeId = await changeAndApprove(302, 'H1');
    prs.set(302, { sha: 'H2' });
    clock('2026-11-21T11:30:00.000Z');
    await standingForTicket({ recordsStore: store, urlKey: URL_KEY, ticket: TICKET });
    assert.equal((await store.current(URL_KEY, changeId)).fields.head, 'H2');
  });

  test('a PR that cannot be read does not refuse the read: the approval stands as recorded', async () => {
    const changeId = await changeAndApprove(303, 'H1');
    prs.delete(303);
    clock('2026-11-21T11:30:00.000Z');
    const s = await standingForTicket({ recordsStore: store, urlKey: URL_KEY, ticket: TICKET });
    assert.ok(s, 'the read answers');
    assert.equal(s.review.stale, false, 'an unreadable PR leaves its change where it is (fail open)');
    assert.equal((await store.current(URL_KEY, changeId)).fields.head, 'H1');
  });

  test('a merged PR ends its change on the gating read, and the landing reads it as merged', async () => {
    const changeId = await changeAndApprove(304, 'H1');
    prs.set(304, { sha: 'H1', merged: true });
    clock('2026-11-21T11:30:00.000Z');
    const s = await standingForTicket({ recordsStore: store, urlKey: URL_KEY, ticket: TICKET });
    assert.equal((await store.current(URL_KEY, changeId)).state, 'merged');
    assert.equal(s.review.stale, false, 'a merge at the judged head does not stale the approval');
  });
});


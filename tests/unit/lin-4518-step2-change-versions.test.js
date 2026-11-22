/**
 * LIN-4518 step 2 (finding 798836ce): a stage's change write for a PR its task already holds open is a new version of
 * that one change record, not a second record. Witnesses over the real records store and the real POST route
 * (routes/proxy-records.js), with the fake PR reader the standing witnesses use.
 *
 * Mutation witness (run once, recorded in the PR): with versionChangeWrite's call removed from the route, witness 1
 * fails with two change records and a verdict that does not show stale.
 */
process.env.NODE_ENV = 'test';

import { describe, test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { createRecordsRouteHarness } from '../helpers/records-route-harness.js';
import { createFakeTracker } from '../helpers/fake-records-tracker.js';
import { createRecordWrites } from '../../lib/records/writes.js';
import { isTerminalState } from '../../lib/providers/state-map.js';
import { refreshTaskChanges } from '../../lib/change-records.js';
import { landingChangesFor } from '../../lib/records/landing.js';
import { readStandingRecords } from '../../lib/records/standing.js';
import { BLIND_READ_KIND } from '../../lib/prompts/blind-read-words.js';

const URL_KEY = 'lin-4518-step2-workspace';
const TICKET = 'LIN-4518';
const REPO = 'acme/widget';
const T0 = '2026-11-21T10:00:00.000Z';
const prUrl = (n) => `https://github.com/${REPO}/pull/${n}`;

const harness = createMangoTmpdir('lin-4518-step2-versions-');
before(() => harness.connect());
after(() => harness.close());

function status(number, { sha, merged = false }) {
  return {
    repo: REPO, number, readable: true,
    state: merged ? 'closed' : 'open', merged,
    head: { ref: `feat/pr-${number}`, sha }, ref: sha,
    created_at: T0, merged_at: merged ? T0 : null, checks: [],
  };
}

let rh;
let store;
let writes;
let taskId;
let tracker;
let prs;
let tokens;

const readPrStatus = async ({ number }) => {
  const p = prs.get(number);
  return p ? status(number, { sha: p.sha, merged: p.merged }) : { readable: false };
};

beforeEach(async () => {
  prs = new Map();
  tracker = createFakeTracker({
    tickets: [{ identifier: TICKET, title: 'Slice 3 P5: writers', description: 'Asked.', state: { name: 'In Progress', type: 'started' }, parent: null }],
  });
  rh = await createRecordsRouteHarness({
    harness,
    urlKey: URL_KEY,
    tickets: new Map(),
    people: [],
    readTicket: tracker.readTicket,
    tracker: () => tracker.port,
    changePrReaderFor: () => readPrStatus,
  });
  store = rh.store;
  for (const [id, stage] of [['row-impl', 'implementation'], ['row-review', 'review'], ['row-blind', 'blind-read']]) {
    await store.openRun(URL_KEY, { id, stage, lineage: 'row-root', at: '2026-11-19T10:00:00.000Z' });
  }
  tokens = {
    impl: await rh.mintRunToken('row-impl'),
    review: await rh.mintRunToken('row-review'),
    blind: await rh.mintRunToken('row-blind'),
  };
  taskId = (await store.ensureTask(URL_KEY, { identifier: TICKET, asked: 'Slice 3 P5.', closed: false, closedReason: null }, { by: 'Harbour', at: T0 })).id;
  writes = createRecordWrites({ recordsStore: store, isTerminalState });
});

afterEach(async () => {
  if (rh) await rh.close();
  rh = null;
});

const post = (token, body) => rh.post('/api/proxy/records', token, body);
const clock = (iso) => { store.now = () => new Date(iso); };
const changesOfTask = async () => store.find(URL_KEY, { kind: 'change', inRef: taskId });
const standing = () => readStandingRecords({ recordsStore: store, urlKey: URL_KEY, taskId, judgements: { review: 'review', blindRead: BLIND_READ_KIND } });

/** The stage's change write for PR `n` at `sha`, as the implementation stage makes it. */
async function stageChangeWrite(n, sha) {
  prs.set(n, { sha, merged: false });
  const r = await post(tokens.impl, { kind: 'change', in: TICKET, ref: prUrl(n), head: sha, run: 'row-impl' });
  assert.equal(r.status, 201, `the change write was refused: ${JSON.stringify(r.body)}`);
  return r.body;
}

describe('witness 1: two stage writes for one PR at two heads leave one change, at v2, with the second head', () => {
  test('the review pinned at the first head shows stale once the PR moves on and the stage writes its new head', async () => {
    clock('2026-11-21T11:00:00.000Z');
    const first = await stageChangeWrite(201, 'H1');
    const v = await post(tokens.review, {
      kind: 'verdict', judgement: 'review', outcome: 'approve', reasoning: 'read at H1',
      on: [first.id], heads: { [first.id]: 'H1' }, run: 'row-review',
    });
    assert.equal(v.status, 201, `the review verdict was refused: ${JSON.stringify(v.body)}`);

    clock('2026-11-21T11:30:00.000Z');
    const second = await stageChangeWrite(201, 'H2');

    const changes = await changesOfTask();
    assert.equal(changes.length, 1, 'a second write for the same PR must not mint a second change record');
    assert.equal(second.id, first.id, 'the write answers the one change record');
    assert.equal(second.v, 2, 'the new head is the next version of that record');
    assert.equal(changes[0].fields.head, 'H2');
    const s = await standing();
    assert.equal(s.review.stale, true, 'the approval was pinned at H1; the change now holds H2, so it is stale');
  });
});

describe('witness 2: a stage write at the head already held writes nothing', () => {
  test('the same PR at the same head answers the change as it stands, with no new version', async () => {
    clock('2026-11-21T11:00:00.000Z');
    const first = await stageChangeWrite(202, 'H1');
    clock('2026-11-21T11:10:00.000Z');
    const again = await stageChangeWrite(202, 'H1');
    assert.equal(again.id, first.id);
    assert.equal(again.v, 1, 'no head moved, so no version is written');
    assert.equal((await changesOfTask()).length, 1);
  });
});

describe('witness 3: the blind read is handed the change records the landing names', () => {
  test('landingChangesFor answers the open change per landing PR, and a verdict on those ids is accepted', async () => {
    clock('2026-11-21T11:00:00.000Z');
    const a = await stageChangeWrite(203, 'A1');
    const b = await stageChangeWrite(204, 'B1');
    const ids = await landingChangesFor({ urlKey: URL_KEY, ticket: TICKET, recordsStore: store });
    assert.deepEqual(ids.map((c) => c.id).sort(), [a.id, b.id].sort());
    assert.ok(ids.every((c) => c.head), 'each handed change names the head it holds');
    const judged = ids.map((c) => c.id);
    const heads = Object.fromEntries(ids.map((c) => [c.id, c.head]));
    const blind = await post(tokens.blind, {
      kind: 'verdict', judgement: BLIND_READ_KIND, outcome: 'same', reasoning: 'the change is neither better nor worse.',
      on: judged, heads, run: 'row-blind',
    });
    assert.equal(blind.status, 201, `a blind read on the handed ids was refused: ${JSON.stringify(blind.body)}`);
  });
});

/**
 * Unit tests for the Observation sessions read-model store (LIN-623).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockCollection } from '../fixtures/mock-collection.js';
import { ObservationSessionsStore, BUILDER_VERSION } from '../../lib/observation-sessions-store.js';
import { __internal as pipelineInternal } from '../../lib/pipeline-loops.js';

const URL_KEY = 'acme';

function makeSession(sessionId, overrides = {}) {
  return {
    sessionId,
    seedIssue: 'LIN-1',
    tasksTouched: ['LIN-1'],
    loops: [{ loopId: sessionId, issueIdentifier: 'LIN-1', dispatchedAt: '2026-06-20T00:00:00.000Z' }],
    dispatchedAt: '2026-06-20T00:00:00.000Z',
    completedAt: null,
    telemetry: {},
    ...overrides
  };
}

test('upsertSession stores the lean session under `${urlKey}:${sessionId}` and findByWorkspace reads it back', async () => {
  const store = new ObservationSessionsStore({ collection: createMockCollection() });
  const session = makeSession('S1');

  assert.equal(await store.upsertSession(URL_KEY, session), true);

  const { sessions, backfilledAt } = await store.findByWorkspace(URL_KEY);
  assert.equal(sessions.length, 1);
  assert.deepEqual(sessions[0], session); // round-trips byte-identical
  assert.equal(backfilledAt, null);
});

test('upsert is idempotent by _id — whole-doc replace, no duplicate docs', async () => {
  const collection = createMockCollection();
  const store = new ObservationSessionsStore({ collection });

  await store.upsertSession(URL_KEY, makeSession('S1', { completedAt: null }));
  await store.upsertSession(URL_KEY, makeSession('S1', { completedAt: '2026-06-21T00:00:00.000Z' }));

  const sessionDocs = collection._docs.filter(d => d.type === 'session');
  assert.equal(sessionDocs.length, 1, 'second upsert replaces, never duplicates');
  const { sessions } = await store.findByWorkspace(URL_KEY);
  assert.equal(sessions[0].completedAt, '2026-06-21T00:00:00.000Z', 'last writer wins');
});

test('findByWorkspace is workspace-isolated', async () => {
  const store = new ObservationSessionsStore({ collection: createMockCollection() });
  await store.upsertSession('ws-a', makeSession('S1'));
  await store.upsertSession('ws-b', makeSession('S2'));

  const a = await store.findByWorkspace('ws-a');
  assert.deepEqual(a.sessions.map(s => s.sessionId), ['S1']);
});

test('backfill marker is distinguishable from session docs and surfaces on read', async () => {
  const store = new ObservationSessionsStore({ collection: createMockCollection() });

  let { backfilledAt } = await store.findByWorkspace(URL_KEY);
  assert.equal(backfilledAt, null, 'no marker before backfill');

  assert.equal(await store.setBackfillMarker(URL_KEY), true);

  const read = await store.findByWorkspace(URL_KEY);
  assert.ok(read.backfilledAt instanceof Date, 'marker now present');
  assert.equal(read.sessions.length, 0, 'the meta doc is NOT returned as a session');
});

test('findByWorkspace drops docs written by a stale builderVersion (treated as a rebuild-able miss)', async () => {
  const collection = createMockCollection();
  const store = new ObservationSessionsStore({ collection });
  await store.upsertSession(URL_KEY, makeSession('S1'));

  // Simulate an older build's doc lingering after a shape change.
  const doc = collection._docs.find(d => d.type === 'session');
  doc.builderVersion = BUILDER_VERSION - 1;

  const { sessions } = await store.findByWorkspace(URL_KEY);
  assert.equal(sessions.length, 0, 'stale-version doc excluded so it gets rebuilt');
});

// LIN-1487 (L3, ledger G1): the v3→v4 bump exists because pre-LIN-1477 v3 docs
// carry no `lineageId` and would otherwise still match — so the render-time
// lineage fold would silently no-op on the write-quiet archive. A doc pinned at
// the specific pre-bump version (3) must miss on BOTH the list read and the
// point read, forcing a rebuild that materializes `lineageId`.
test('a v3 doc (pre-LIN-1487) read-misses on both list and point reads so it rebuilds with lineageId', async () => {
  const collection = createMockCollection();
  const store = new ObservationSessionsStore({ collection });
  await store.upsertSession(URL_KEY, makeSession('S1'));

  // The pin tracks the CURRENT version (LIN-1789 moved it 6 → 7); a lingering v3
  // archive doc from before LIN-1487 must still miss on both reads.
  assert.equal(BUILDER_VERSION, 10, 'this bump-specific pin tracks the current version');
  const doc = collection._docs.find(d => d.type === 'session');
  doc.builderVersion = 3;

  assert.equal((await store.findByWorkspace(URL_KEY)).sessions.length, 0, 'list read skips the v3 doc');
  assert.equal(await store.getSession(URL_KEY, 'S1'), null, 'point read misses the v3 doc → route reconstructs');
});

// LIN-1495: the v4 → v5 bump exists because `telemetry.usage.costUsd` is now
// derived at build time rather than stored as a permanent null. A v4 doc still
// matches the SHAPE (the change is a value inside an existing field, not a new
// key), so without the bump it would keep serving `costUsd: null` until 30-day
// churn — the exact "—" the derivation exists to replace. Pinning the v4 doc as
// the target set is what makes this bump load-bearing rather than cosmetic.
test('a v4 doc (pre-LIN-1495) read-misses on both list and point reads so it rebuilds with a priced costUsd', async () => {
  const collection = createMockCollection();
  const store = new ObservationSessionsStore({ collection });
  await store.upsertSession(URL_KEY, makeSession('S1'));

  const doc = collection._docs.find(d => d.type === 'session');
  doc.builderVersion = 4;

  assert.equal((await store.findByWorkspace(URL_KEY)).sessions.length, 0, 'list read skips the v4 doc');
  assert.equal(await store.getSession(URL_KEY, 'S1'), null, 'point read misses the v4 doc → route reconstructs');
});

// LIN-1766: the v5 → v6 bump exists because `telemetry.usage.lane` is now parsed
// onto usage. Unlike v4 → v5, this genuinely ADDS A KEY rather than changing a
// value inside an existing field, so a v5 doc no longer matches the shape — a
// real shape change, not another efficacy lever. Pinning the v5 doc as the
// target set is what makes this bump load-bearing rather than cosmetic.
test('a v5 doc (pre-LIN-1766) read-misses on both list and point reads so it rebuilds with lane', async () => {
  const collection = createMockCollection();
  const store = new ObservationSessionsStore({ collection });
  await store.upsertSession(URL_KEY, makeSession('S1'));

  const doc = collection._docs.find(d => d.type === 'session');
  doc.builderVersion = 5;

  assert.equal((await store.findByWorkspace(URL_KEY)).sessions.length, 0, 'list read skips the v5 doc');
  assert.equal(await store.getSession(URL_KEY, 'S1'), null, 'point read misses the v5 doc → route reconstructs');
});

test('removeSession deletes a single derived doc (idempotent)', async () => {
  const store = new ObservationSessionsStore({ collection: createMockCollection() });
  await store.upsertSession(URL_KEY, makeSession('S1'));
  await store.upsertSession(URL_KEY, makeSession('S2'));

  await store.removeSession(URL_KEY, 'S1');
  const { sessions } = await store.findByWorkspace(URL_KEY);
  assert.deepEqual(sessions.map(s => s.sessionId), ['S2']);

  // Removing again is a no-op, not an error.
  assert.equal(await store.removeSession(URL_KEY, 'S1'), true);
});

test('historyExpiresAt tracks the session\'s last activity, and cleanup evicts expired docs', async () => {
  const collection = createMockCollection();
  // Tiny TTL so we can assert eviction deterministically.
  const store = new ObservationSessionsStore({ collection, historyTtl: 1 });

  // A session whose latest activity is long in the past → already expired.
  const old = makeSession('OLD', {
    dispatchedAt: '2020-01-01T00:00:00.000Z',
    completedAt: '2020-01-01T01:00:00.000Z',
    loops: [{ loopId: 'OLD', issueIdentifier: 'LIN-1', dispatchedAt: '2020-01-01T00:00:00.000Z', resolvedAt: '2020-01-01T01:00:00.000Z' }]
  });
  await store.upsertSession(URL_KEY, old);

  const doc = collection._docs.find(d => d.sessionId === 'OLD');
  assert.ok(doc.historyExpiresAt.getTime() < Date.now(), 'expiry derived from 2020 activity + 1s is in the past');

  const removed = await store.cleanup();
  assert.equal(removed, 1);
  assert.equal((await store.findByWorkspace(URL_KEY)).sessions.length, 0);
});

test('getSession point-reads one session by id, byte-identical to what was stored (LIN-632)', async () => {
  const store = new ObservationSessionsStore({ collection: createMockCollection() });
  const session = makeSession('S1');
  await store.upsertSession(URL_KEY, session);
  await store.upsertSession(URL_KEY, makeSession('S2'));

  const got = await store.getSession(URL_KEY, 'S1');
  assert.deepEqual(got, session, 'returns the stored lean session unchanged');
});

test('getSession returns null on a genuine miss, workspace mismatch, or missing args (LIN-632)', async () => {
  const store = new ObservationSessionsStore({ collection: createMockCollection() });
  await store.upsertSession('ws-a', makeSession('S1'));

  assert.equal(await store.getSession('ws-a', 'nope'), null, 'unknown session id → null');
  assert.equal(await store.getSession('ws-b', 'S1'), null, 'right id, wrong workspace → null');
  assert.equal(await store.getSession('', 'S1'), null, 'missing urlKey → null');
  assert.equal(await store.getSession('ws-a', ''), null, 'missing sessionId → null');
});

test('getSession treats a stale-builderVersion doc as a miss (rebuild-able) (LIN-632)', async () => {
  const collection = createMockCollection();
  const store = new ObservationSessionsStore({ collection });
  await store.upsertSession(URL_KEY, makeSession('S1'));

  const doc = collection._docs.find(d => d.type === 'session');
  doc.builderVersion = BUILDER_VERSION - 1;

  assert.equal(await store.getSession(URL_KEY, 'S1'), null, 'stale-shape doc → null so the route falls back to reconstruction');
});

test('clear removes every doc for a workspace', async () => {
  const store = new ObservationSessionsStore({ collection: createMockCollection() });
  await store.upsertSession(URL_KEY, makeSession('S1'));
  await store.setBackfillMarker(URL_KEY);

  const removed = await store.clear(URL_KEY);
  assert.equal(removed, 2, 'session doc + meta doc');
  const { sessions, backfilledAt } = await store.findByWorkspace(URL_KEY);
  assert.equal(sessions.length, 0);
  assert.equal(backfilledAt, null);
});

// ── LIN-2182 (H3) · review ledger 3: persist → read round trip ────────────────
// The BUILDER_VERSION bump exists so in-flight lean docs read-miss and rebuild
// CARRYING `decision`/`decisionCase`. Two halves of that were already pinned
// separately — the derivation (tests/unit/pipeline-loops.test.js) and the
// invalidation mechanism (the BUILDER_VERSION - 1 tests above) — but nothing
// exercised the link BETWEEN them: that a session assembled from real built loops
// still carries the fields after `upsertSession` → `getSession`. That link was
// read-verified only (`_assembleSession` returns `loops: ordered` verbatim;
// `upsertSession` stores the session whole), and it is the one hop CI never
// touched, which is the whole point of the bump. This closes it by test.
const { _buildLoops, _assembleSession } = pipelineInternal;

const ROUNDTRIP_NOW = new Date('2026-04-11T12:00:00.000Z');
const ROUNDTRIP_DECISION = { decision_id: 'd-1', question: 'ship it, or hold for review?' };

function decisionBearingSession(sessionId) {
  const historyItem = {
    id: sessionId,
    promptName: 'implementation',
    prompt: 'implementation prompt text',
    issueId: 'uuid-100',
    issueIdentifier: 'LIN-100',
    issueTitle: 'Issue A',
    issueUrl: 'https://linear.app/x/issue/LIN-100',
    workspace: { urlKey: URL_KEY },
    dispatchedAt: '2026-04-10T10:00:00.000Z',
    dispatchedBy: 'user-1',
    target: 'cli',
    repo: null,
    status: 'taken',
    resolvedAt: '2026-04-10T11:00:00.000Z',
    takenByTokenLabel: 'consumer-1',
    feedback: [
      { kind: 'assistant-text', message: 'here is the case', timestamp: '2026-04-10T10:30:00.000Z' },
      { kind: 'decision', message: `[decision] ${JSON.stringify(ROUNDTRIP_DECISION)}`, timestamp: '2026-04-10T10:31:00.000Z' },
      { kind: 'status', message: '[blocked] awaiting a ruling', timestamp: '2026-04-10T10:31:01.000Z' }
    ]
  };
  // `lean: true` is the shape the materializer actually persists — the one whose
  // dropped `feedback[]` makes a lazily-derived field unrecoverable downstream.
  const loops = _buildLoops({ historyItems: [historyItem], now: ROUNDTRIP_NOW, lean: true });
  return { session: _assembleSession(sessionId, null, loops), builtLoop: loops[0] };
}

test('a lean session assembled from real loops carries decision/decisionCase through upsertSession → getSession (LIN-2182)', async () => {
  const collection = createMockCollection();
  const store = new ObservationSessionsStore({ collection });
  const { session, builtLoop } = decisionBearingSession('S-decision');

  // Precondition: the loop genuinely carries the fields before persistence, so a
  // pass below cannot come from asserting nothing.
  assert.deepEqual(builtLoop.decision, ROUNDTRIP_DECISION);
  assert.deepEqual(builtLoop.decisionCase, ['here is the case']);
  assert.deepEqual(builtLoop.feedback, [], 'and it is the lean shape — raw feedback[] is gone');

  assert.equal(await store.upsertSession(URL_KEY, session), true);

  // The stored doc, as it would survive BSON: the mock keeps object references, so
  // serialize before asserting or the read could pass on identity alone.
  const persisted = JSON.parse(JSON.stringify(collection._docs.find(d => d.type === 'session')));
  assert.deepEqual(persisted.session.loops[0].decision, ROUNDTRIP_DECISION, 'decision is in the written document');
  assert.deepEqual(persisted.session.loops[0].decisionCase, ['here is the case'], 'decisionCase is in the written document');

  const point = await store.getSession(URL_KEY, 'S-decision');
  assert.ok(point, 'point read hits at the current builderVersion');
  assert.deepEqual(point.loops[0].decision, ROUNDTRIP_DECISION);
  assert.deepEqual(point.loops[0].decisionCase, ['here is the case']);

  const { sessions } = await store.findByWorkspace(URL_KEY);
  assert.equal(sessions.length, 1);
  assert.deepEqual(sessions[0].loops[0].decision, ROUNDTRIP_DECISION, 'and on the list read too');
  assert.deepEqual(sessions[0].loops[0].decisionCase, ['here is the case']);

  // The `!== undefined` build-discriminators (routes/dashboard.js:158/:278/:352,
  // lib/pipeline-loops.js _loopCompletedAt) read presence, not truthiness — so the
  // keys must survive persistence even when the values are empty.
  assert.ok('decision' in point.loops[0] && 'decisionCase' in point.loops[0]);
});

// LIN-2182: the v8 → v9 bump exists because `decision`/`decisionCase` are NEW KEYS
// on every loop (the v6/v7 trigger class, not v5's changed-derived-value). A v8 doc
// predates them entirely, so without the bump the feed would serve caseless loops
// for up to DEFAULT_HISTORY_TTL (30 days). Pinning the v8 doc as the target set is
// what makes this bump load-bearing rather than cosmetic — and, unlike the generic
// `BUILDER_VERSION - 1` tests, it stays meaningful after the next bump.
test('a v8 doc (pre-LIN-2182) read-misses on both list and point reads so it rebuilds with decision/decisionCase', async () => {
  const collection = createMockCollection();
  const store = new ObservationSessionsStore({ collection });
  const { session } = decisionBearingSession('S-decision');
  await store.upsertSession(URL_KEY, session);

  const doc = collection._docs.find(d => d.type === 'session');
  doc.builderVersion = 8;

  assert.equal((await store.findByWorkspace(URL_KEY)).sessions.length, 0, 'list read skips the v8 doc');
  assert.equal(await store.getSession(URL_KEY, 'S-decision'), null, 'point read misses the v8 doc → route reconstructs');
});

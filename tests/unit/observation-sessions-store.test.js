/**
 * Unit tests for the Observation sessions read-model store (LIN-623).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockCollection } from '../fixtures/mock-collection.js';
import { ObservationSessionsStore, BUILDER_VERSION } from '../../lib/observation-sessions-store.js';

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

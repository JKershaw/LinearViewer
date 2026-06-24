/**
 * Unit tests for the Observation sessions materializer (LIN-623).
 *
 * The load-bearing test is the EQUIVALENCE SPIKE: a fixture where one issue spans
 * two sessions plus a manual dispatch, asserting the issue-set-scoped recompute
 * yields session docs BYTE-IDENTICAL to a full `getSessionsForWorkspace` build.
 * That pins the one behaviour that could silently diverge — agent-status window
 * attribution across sessions that share an issue.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockCollection } from '../fixtures/mock-collection.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { AgentStatusStore } from '../../lib/agent-status-store.js';
import { ObservationSessionsStore } from '../../lib/observation-sessions-store.js';
import { createObservationMaterializer } from '../../lib/observation-sessions-materializer.js';
import { getSessionsForWorkspace } from '../../lib/pipeline-loops.js';

const URL_KEY = 'acme';
const T0 = Date.now() - 60 * 60 * 1000; // 1h ago; everything stays inside the 30-day window
const min = (n) => T0 + n * 60 * 1000;

function setup() {
  const queueCollection = createMockCollection();
  const historyCollection = createMockCollection();
  const statusCollection = createMockCollection();
  const observationCollection = createMockCollection();

  const dispatchStore = new DispatchQueueStore({ collection: queueCollection, historyCollection });
  const agentStatusStore = new AgentStatusStore({ collection: statusCollection });
  const observationSessionsStore = new ObservationSessionsStore({ collection: observationCollection });
  const materializer = createObservationMaterializer({ dispatchStore, agentStatusStore, observationSessionsStore });

  return { dispatchStore, agentStatusStore, observationSessionsStore, materializer, historyCollection, statusCollection };
}

// Insert an archived dispatch row directly (bypassing the hooks) so we control the
// exact cross-session fixture the equivalence spike needs.
function archive(historyCollection, { id, issueIdentifier, sessionId = null, kind = 'implementation', dispatchedAtMs, resolvedAtMs, feedback = [] }) {
  historyCollection._docs.push({
    _id: id,
    urlKey: URL_KEY,
    prompt: `prompt-${id}`,
    promptName: kind,
    kind,
    issueId: `id-${issueIdentifier}`,
    issueIdentifier,
    issueTitle: `${issueIdentifier} title`,
    issueUrl: `https://linear.app/${issueIdentifier}`,
    dispatchedAt: new Date(dispatchedAtMs),
    dispatchedBy: null,
    target: 'cli',
    repo: null,
    followUpTo: null,
    sessionId,
    status: 'taken',
    resolvedAt: resolvedAtMs ? new Date(resolvedAtMs) : null,
    takenByTokenLabel: null,
    feedback: feedback.map(f => ({ message: f.message, url: null, urlLabel: null, timestamp: new Date(f.tsMs) })),
    historyExpiresAt: new Date(dispatchedAtMs + 30 * 24 * 60 * 60 * 1000)
  });
}

function status(statusCollection, { id, taskIdentifier, action = 'implementation', status = 'completed', summary = 'did work', tsMs, dispatchId = null }) {
  const doc = {
    _id: id,
    urlKey: URL_KEY,
    taskIdentifier,
    action,
    status,
    summary,
    timestamp: new Date(tsMs),
    expiresAt: new Date(tsMs + 30 * 24 * 60 * 60 * 1000)
  };
  if (dispatchId) doc.dispatchId = dispatchId;
  statusCollection._docs.push(doc);
}

// LIN-300 spans S1 (worker W2), S2 (worker W3) AND a sessionless manual dispatch.
function seedSpanningFixture({ historyCollection, statusCollection }) {
  // Session S1
  archive(historyCollection, { id: 'S1', issueIdentifier: 'LIN-100', kind: 'autopilot', dispatchedAtMs: min(0), resolvedAtMs: min(1) });
  archive(historyCollection, { id: 'W1', issueIdentifier: 'LIN-200', sessionId: 'S1', dispatchedAtMs: min(2), resolvedAtMs: min(5), feedback: [{ message: '[done] shipped W1', tsMs: min(5) }] });
  archive(historyCollection, { id: 'W2', issueIdentifier: 'LIN-300', sessionId: 'S1', dispatchedAtMs: min(6), resolvedAtMs: min(9), feedback: [{ message: 'progress', tsMs: min(8) }] });
  // Session S2
  archive(historyCollection, { id: 'S2', issueIdentifier: 'LIN-101', kind: 'autopilot', dispatchedAtMs: min(20), resolvedAtMs: min(21) });
  archive(historyCollection, { id: 'W3', issueIdentifier: 'LIN-300', sessionId: 'S2', dispatchedAtMs: min(22), resolvedAtMs: min(25), feedback: [{ message: '[done] shipped W3', tsMs: min(25) }] });
  // Manual, sessionless dispatch on the shared issue — not part of any session.
  archive(historyCollection, { id: 'M1', issueIdentifier: 'LIN-300', dispatchedAtMs: min(30), resolvedAtMs: min(31) });

  // agent-status across the shared issue + the seeds; windows must attribute each
  // to the right session's worker.
  status(statusCollection, { id: 'AS-anchor', taskIdentifier: 'LIN-100', tsMs: min(0) + 30 * 1000 });
  status(statusCollection, { id: 'AS-w2', taskIdentifier: 'LIN-300', tsMs: min(7) });
  status(statusCollection, { id: 'AS-w3', taskIdentifier: 'LIN-300', tsMs: min(23) });
}

test('EQUIVALENCE: issue-set recompute == full build for sessions sharing an issue (+ a manual dispatch)', async () => {
  const ctx = setup();
  seedSpanningFixture(ctx);
  const { dispatchStore, agentStatusStore, observationSessionsStore, materializer } = ctx;

  // The ground truth: the live whole-workspace reconstruction the feed runs today.
  const full = await getSessionsForWorkspace(URL_KEY, { dispatchStore, agentStatusStore, lean: true });
  const fullById = new Map(full.map(s => [s.sessionId, s]));
  assert.deepEqual([...fullById.keys()].sort(), ['S1', 'S2'], 'manual dispatch is not a session');

  // Simulate an agent-status write on the shared issue → recompute its sessions.
  await materializer.rebuildForWrite(URL_KEY, { issueIdentifier: 'LIN-300' });

  const { sessions } = await observationSessionsStore.findByWorkspace(URL_KEY);
  const matById = new Map(sessions.map(s => [s.sessionId, s]));

  assert.deepEqual([...matById.keys()].sort(), ['S1', 'S2'], 'both sessions touching the issue were materialized');
  assert.deepEqual(matById.get('S1'), fullById.get('S1'), 'S1 byte-identical to the full build');
  assert.deepEqual(matById.get('S2'), fullById.get('S2'), 'S2 byte-identical to the full build');
});

test('rebuildForWrite by sessionId reconstructs that session\'s full closure (byte-identical)', async () => {
  const ctx = setup();
  seedSpanningFixture(ctx);
  const { dispatchStore, agentStatusStore, observationSessionsStore, materializer } = ctx;

  const full = await getSessionsForWorkspace(URL_KEY, { dispatchStore, agentStatusStore, lean: true });
  const fullS1 = full.find(s => s.sessionId === 'S1');

  // A worker-dispatch write carries only its sessionId; the materializer must still
  // pull the seed (LIN-100) + sibling (LIN-200, LIN-300) issues to rebuild S1 right.
  await materializer.rebuildForWrite(URL_KEY, { sessionId: 'S1' });

  const { sessions } = await observationSessionsStore.findByWorkspace(URL_KEY);
  const s1 = sessions.find(s => s.sessionId === 'S1');
  assert.deepEqual(s1, fullS1);
  assert.deepEqual(s1.tasksTouched.sort(), ['LIN-100', 'LIN-200', 'LIN-300'], 'full issue closure recovered');
});

test('backfillWorkspace persists every full-build session and sets the marker', async () => {
  const ctx = setup();
  seedSpanningFixture(ctx);
  const { dispatchStore, agentStatusStore, observationSessionsStore, materializer } = ctx;

  await materializer.backfillWorkspace(URL_KEY);

  const full = await getSessionsForWorkspace(URL_KEY, { dispatchStore, agentStatusStore, lean: true });
  const { sessions, backfilledAt } = await observationSessionsStore.findByWorkspace(URL_KEY);

  assert.ok(backfilledAt, 'marker set so an empty workspace stops re-fanning');
  assert.equal(sessions.length, full.length);
  for (const f of full) {
    assert.deepEqual(sessions.find(s => s.sessionId === f.sessionId), f, `${f.sessionId} backfilled byte-identical`);
  }
});

test('backfillWorkspace coalesces concurrent calls into one in-flight run', async () => {
  const ctx = setup();
  seedSpanningFixture(ctx);
  const { materializer } = ctx;
  const a = materializer.backfillWorkspace(URL_KEY);
  const b = materializer.backfillWorkspace(URL_KEY);
  assert.equal(a, b, 'second concurrent backfill returns the same in-flight promise');
  await Promise.all([a, b]);
});

test('a target session that no longer reconstructs has its derived doc removed', async () => {
  const ctx = setup();
  const { observationSessionsStore, materializer } = ctx;
  // Pre-seed a stale derived doc for a session with NO underlying rows.
  await observationSessionsStore.upsertSession(URL_KEY, { sessionId: 'GHOST', seedIssue: 'LIN-9', tasksTouched: ['LIN-9'], loops: [], dispatchedAt: null, completedAt: null, telemetry: {} });

  await materializer.rebuildForWrite(URL_KEY, { sessionId: 'GHOST' });

  const { sessions } = await observationSessionsStore.findByWorkspace(URL_KEY);
  assert.equal(sessions.find(s => s.sessionId === 'GHOST'), undefined, 'vanished session evicted');
});

test('offers each upserted target session to the background precompute hook (LIN-632)', async () => {
  const ctx = setup();
  seedSpanningFixture(ctx);
  const { materializer, observationSessionsStore } = ctx;

  const offered = [];
  materializer.precomputeSessionSummary = (urlKey, session) => { offered.push([urlKey, session.sessionId]); };

  await materializer.rebuildForWrite(URL_KEY, { issueIdentifier: 'LIN-300' });

  // Both sessions touching the issue were upserted → both offered to the hook,
  // with the SAME lean session object the read-model stored.
  const offeredIds = offered.map(([, id]) => id).sort();
  assert.deepEqual(offeredIds, ['S1', 'S2']);
  assert.ok(offered.every(([k]) => k === URL_KEY), 'hook receives the workspace urlKey');
  const { sessions } = await observationSessionsStore.findByWorkspace(URL_KEY);
  assert.equal(sessions.length, 2, 'hook is offered alongside a real upsert, not instead of it');
});

test('a hook throwing or rejecting never breaks the read-model write (LIN-632)', async () => {
  const ctx = setup();
  seedSpanningFixture(ctx);
  const { materializer, observationSessionsStore } = ctx;

  materializer.precomputeSessionSummary = () => { throw new Error('boom'); };
  await materializer.rebuildForWrite(URL_KEY, { sessionId: 'S1' }); // must not reject

  const { sessions } = await observationSessionsStore.findByWorkspace(URL_KEY);
  assert.ok(sessions.find(s => s.sessionId === 'S1'), 'session still materialized despite hook throwing');
});

test('precompute hook is opt-in — disabled by default and clearable with a non-function (LIN-632)', async () => {
  const ctx = setup();
  seedSpanningFixture(ctx);
  const { materializer, observationSessionsStore } = ctx;

  assert.equal(materializer.precomputeSessionSummary, null, 'no hook wired by default');
  materializer.precomputeSessionSummary = () => { throw new Error('should not run'); };
  materializer.precomputeSessionSummary = null; // disable again
  assert.equal(materializer.precomputeSessionSummary, null);

  await materializer.rebuildForWrite(URL_KEY, { sessionId: 'S1' }); // disabled hook never runs
  const { sessions } = await observationSessionsStore.findByWorkspace(URL_KEY);
  assert.ok(sessions.find(s => s.sessionId === 'S1'));
});

test('rebuildForWrite for an issue in no session is a no-op (does not throw, writes nothing)', async () => {
  const ctx = setup();
  seedSpanningFixture(ctx);
  const { observationSessionsStore, materializer } = ctx;
  await materializer.rebuildForWrite(URL_KEY, { issueIdentifier: 'LIN-999' });
  const { sessions } = await observationSessionsStore.findByWorkspace(URL_KEY);
  assert.equal(sessions.length, 0);
});

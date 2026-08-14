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
function archive(historyCollection, { id, issueIdentifier, sessionId = null, sessionGroupId = null, kind = 'implementation', followUpTo = null, dispatchedAtMs, resolvedAtMs, feedback = [] }) {
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
    followUpTo,
    sessionId,
    sessionGroupId,
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
  // LIN-1194: the live full build now ALSO emits the manual sessionless cli
  // dispatch (M1) as a standalone single-loop session keyed by its own dispatch id.
  // The materializer's discovery stays autopilot/sessionId-centric, so it
  // deliberately does NOT materialize the standalone one — that divergence is
  // exactly why the Sessions view reads live instead of the durable store.
  assert.deepEqual([...fullById.keys()].sort(), ['M1', 'S1', 'S2'], 'the manual dispatch now reconstructs as its own standalone session (LIN-1194)');

  // Simulate an agent-status write on the shared issue → recompute its sessions.
  await materializer.rebuildForWrite(URL_KEY, { issueIdentifier: 'LIN-300' });

  const { sessions } = await observationSessionsStore.findByWorkspace(URL_KEY);
  const matById = new Map(sessions.map(s => [s.sessionId, s]));

  // The materializer covers only the autopilot/sessionId sessions touching the
  // issue; the standalone M1 stays live-only (see above).
  assert.deepEqual([...matById.keys()].sort(), ['S1', 'S2'], 'only the autopilot/sessionId sessions touching the issue were materialized');
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

// LIN-1307: autopilot session S, worker W (sessionId: S), and a reply-box
// follow-up F that resumes W (followUpTo: W, sessionId: null, kind: 'custom',
// target: 'cli') on its OWN distinct issue — the shape a human follow-up reply
// to a worker inside an autopilot session actually takes.
function seedFollowUpFixture({ historyCollection, statusCollection }) {
  archive(historyCollection, { id: 'S', issueIdentifier: 'LIN-500', kind: 'autopilot', dispatchedAtMs: min(40), resolvedAtMs: min(41) });
  archive(historyCollection, { id: 'W', issueIdentifier: 'LIN-501', sessionId: 'S', dispatchedAtMs: min(42), resolvedAtMs: min(45), feedback: [{ message: '[done] shipped W', tsMs: min(45) }] });
  archive(historyCollection, { id: 'F', issueIdentifier: 'LIN-502', followUpTo: 'W', kind: 'custom', dispatchedAtMs: min(46), resolvedAtMs: min(49), feedback: [{ message: 'reply to W', tsMs: min(48) }] });

  status(statusCollection, { id: 'AS-s-anchor', taskIdentifier: 'LIN-500', tsMs: min(40) + 30 * 1000 });
  status(statusCollection, { id: 'AS-w', taskIdentifier: 'LIN-501', tsMs: min(43) });
  status(statusCollection, { id: 'AS-f', taskIdentifier: 'LIN-502', tsMs: min(47) });
}

test('LIN-1307: rebuildForWrite by sessionId pulls in a followUpTo-linked reply (byte-identical)', async () => {
  const ctx = setup();
  seedFollowUpFixture(ctx);
  const { dispatchStore, agentStatusStore, observationSessionsStore, materializer } = ctx;

  const full = await getSessionsForWorkspace(URL_KEY, { dispatchStore, agentStatusStore, lean: true });
  const fullS = full.find(s => s.sessionId === 'S');
  assert.ok(fullS.loops.some(l => l.loopId === 'F'), 'the live build stitches F into S via the followUpTo chain (LIN-1292)');

  await materializer.rebuildForWrite(URL_KEY, { sessionId: 'S' });

  const { sessions } = await observationSessionsStore.findByWorkspace(URL_KEY);
  const s = sessions.find(x => x.sessionId === 'S');
  assert.ok(s, 'S was materialized');
  assert.deepEqual(s, fullS, 'materialized S is byte-identical to the live build, including the follow-up loop');
  assert.deepEqual(s.tasksTouched.sort(), ['LIN-500', 'LIN-501', 'LIN-502'], 'the follow-up\'s own issue joined the closure');
});

test('LIN-1307: rebuildForWrite by the follow-up\'s OWN issueIdentifier resolves up to the owning session (byte-identical)', async () => {
  const ctx = setup();
  seedFollowUpFixture(ctx);
  const { dispatchStore, agentStatusStore, observationSessionsStore, materializer } = ctx;

  const full = await getSessionsForWorkspace(URL_KEY, { dispatchStore, agentStatusStore, lean: true });
  const fullS = full.find(s => s.sessionId === 'S');

  // A write on F's own issue (e.g. the reply's own addFeedback) must still find
  // and rebuild S — this is the write-trigger gap (Gap 1) in materializer-test
  // form: without the upward resolution in `_sessionsTouchingIssue`, this issue
  // touches no known session and the rebuild would be a no-op.
  await materializer.rebuildForWrite(URL_KEY, { issueIdentifier: 'LIN-502' });

  const { sessions } = await observationSessionsStore.findByWorkspace(URL_KEY);
  assert.deepEqual(sessions.map(s => s.sessionId), ['S'], 'only S was materialized, resolved from the follow-up\'s own issue');
  assert.deepEqual(sessions[0], fullS, 'byte-identical to the live build');
});

test('LIN-1307: a followUpTo chain rooted at a standalone/manual dispatch is never materialized (live-only preserved)', async () => {
  const ctx = setup();
  const { historyCollection, statusCollection, dispatchStore, agentStatusStore, observationSessionsStore, materializer } = ctx;

  // M2 is a standalone manual dispatch (no sessionId, not autopilot) — same
  // shape as the M1 case in the EQUIVALENCE spike above. F2 replies to it.
  archive(historyCollection, { id: 'M2', issueIdentifier: 'LIN-503', dispatchedAtMs: min(50), resolvedAtMs: min(51) });
  archive(historyCollection, { id: 'F2', issueIdentifier: 'LIN-504', followUpTo: 'M2', kind: 'custom', dispatchedAtMs: min(52), resolvedAtMs: min(53) });
  status(statusCollection, { id: 'AS-m2', taskIdentifier: 'LIN-503', tsMs: min(50) + 15 * 1000 });

  const full = await getSessionsForWorkspace(URL_KEY, { dispatchStore, agentStatusStore, lean: true });
  assert.deepEqual(full.map(s => s.sessionId).sort(), ['M2'], 'the live build stitches F2 into M2\'s own standalone session (LIN-1292), never a separate one');

  await materializer.rebuildForWrite(URL_KEY, { issueIdentifier: 'LIN-504' });

  const { sessions } = await observationSessionsStore.findByWorkspace(URL_KEY);
  assert.deepEqual(sessions, [], 'a standalone chain root is skipped — stays live-only, matching the write-trigger gap-1 fix');
});

test('LIN-1341: a STAMPED followUpTo chain rooted at a standalone/manual dispatch IS materialized under the durable group id (closes the old skip)', async () => {
  const ctx = setup();
  const { historyCollection, statusCollection, dispatchStore, agentStatusStore, observationSessionsStore, materializer } = ctx;

  // Same shape as the M2/F2 case above, but F3 carries a stamped sessionGroupId
  // equal to M3's own dispatch id — exactly what createDispatchItem's follow-up
  // inheritance seam would stamp (LIN-1341).
  archive(historyCollection, { id: 'M3', issueIdentifier: 'LIN-505', dispatchedAtMs: min(54), resolvedAtMs: min(55) });
  archive(historyCollection, { id: 'F3', issueIdentifier: 'LIN-506', followUpTo: 'M3', sessionGroupId: 'M3', kind: 'custom', dispatchedAtMs: min(56), resolvedAtMs: min(57) });
  status(statusCollection, { id: 'AS-m3', taskIdentifier: 'LIN-505', tsMs: min(54) + 15 * 1000 });

  const full = await getSessionsForWorkspace(URL_KEY, { dispatchStore, agentStatusStore, lean: true });
  assert.deepEqual(full.map(s => s.sessionId).sort(), ['M3'], 'the live build still stitches F3 into M3\'s standalone session');

  await materializer.rebuildForWrite(URL_KEY, { issueIdentifier: 'LIN-506' });

  const { sessions } = await observationSessionsStore.findByWorkspace(URL_KEY);
  assert.deepEqual(sessions.map(s => s.sessionId), ['M3'], 'the durable group id resolves the target session directly — unlike the unstamped case above, this is no longer skipped');
  assert.deepEqual(sessions[0], full.find(s => s.sessionId === 'M3'), 'byte-identical to the live build');
});

test('LIN-1341: a STAMPED followUpTo reply closure is discovered via the direct sessionGroupId query (byte-identical to the live build)', async () => {
  const ctx = setup();
  seedFollowUpFixture(ctx);
  const { historyCollection, dispatchStore, agentStatusStore, observationSessionsStore, materializer } = ctx;

  // Re-seed F with a stamped sessionGroupId equal to W's own sessionId (the
  // group a reply to an autopilot worker inherits) — mirrors the fixture at
  // seedFollowUpFixture, but the row is now stamped so _collectSessionIssues's
  // new {sessionGroupId} query (not just the followUpTo BFS) must gather it.
  const f = historyCollection._docs.find(d => d._id === 'F');
  f.sessionGroupId = 'S';

  const full = await getSessionsForWorkspace(URL_KEY, { dispatchStore, agentStatusStore, lean: true });
  const fullS = full.find(s => s.sessionId === 'S');

  await materializer.rebuildForWrite(URL_KEY, { sessionId: 'S' });

  const { sessions } = await observationSessionsStore.findByWorkspace(URL_KEY);
  const s = sessions.find(x => x.sessionId === 'S');
  assert.ok(s, 'S was materialized');
  assert.deepEqual(s, fullS, 'materialized S is byte-identical to the live build, including the stamped follow-up loop');
  assert.deepEqual(s.tasksTouched.sort(), ['LIN-500', 'LIN-501', 'LIN-502'], 'the follow-up\'s own issue joined the closure via the group query');
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

// ── LIN-962: title enrichment at the read/serve seam ─────────────────────────
// A dispatch's `issueTitle` is optional (the autopilot anchor hardcodes it null),
// so a session's loops can be title-less. The materializer resolves a real title
// from an injected workspace title source before persisting, so the Observation
// Level-2 card shows a title instead of a bare identifier — and backfill of
// existing title-less sessions falls out of re-materialization for free.

// Seed a session whose loops carry NO issueTitle (the defect condition).
// `dispatchedBy` (LIN-1986) is the owner-derivation seam `_deriveOwnerCandidates`
// reads — set here so the enrichment tests below reach the (now owner-scoped)
// resolver at all.
function seedTitlelessFixture({ historyCollection, statusCollection }) {
  historyCollection._docs.push({
    _id: 'A1', urlKey: URL_KEY, prompt: 'p', promptName: 'autopilot', kind: 'autopilot',
    issueId: 'id-LIN-701', issueIdentifier: 'LIN-701', issueTitle: null, issueUrl: null,
    dispatchedAt: new Date(min(0)), dispatchedBy: 'account-A', sessionId: null, status: 'resolved',
    resolvedAt: new Date(min(1)), feedback: [{ message: '[done] shipped', url: null, urlLabel: null, timestamp: new Date(min(1)) }],
    historyExpiresAt: new Date(min(0) + 30 * 24 * 60 * 60 * 1000)
  });
  status(statusCollection, { id: 'AS-a1', taskIdentifier: 'LIN-701', tsMs: min(0) + 30 * 1000 });
}

// Two loops in the SAME session, dispatched by two distinct owners — drives the
// candidate-ordering behaviour in `_enrichTitles` (LIN-1986 plan-review Finding
// A): the anchor (account-A) is dispatched first, so it is tried first.
function seedMultiOwnerTitlelessFixture({ historyCollection, statusCollection }) {
  historyCollection._docs.push({
    _id: 'A1', urlKey: URL_KEY, prompt: 'p', promptName: 'autopilot', kind: 'autopilot',
    issueId: 'id-LIN-701', issueIdentifier: 'LIN-701', issueTitle: null, issueUrl: null,
    dispatchedAt: new Date(min(0)), dispatchedBy: 'account-A', sessionId: null, status: 'resolved',
    resolvedAt: new Date(min(1)), feedback: [{ message: '[done] shipped', url: null, urlLabel: null, timestamp: new Date(min(1)) }],
    historyExpiresAt: new Date(min(0) + 30 * 24 * 60 * 60 * 1000)
  });
  historyCollection._docs.push({
    _id: 'W1', urlKey: URL_KEY, prompt: 'p', promptName: 'implementation', kind: 'implementation',
    issueId: 'id-LIN-702', issueIdentifier: 'LIN-702', issueTitle: null, issueUrl: null,
    dispatchedAt: new Date(min(2)), dispatchedBy: 'account-B', sessionId: 'A1', status: 'resolved',
    resolvedAt: new Date(min(3)), feedback: [{ message: '[done] shipped', url: null, urlLabel: null, timestamp: new Date(min(3)) }],
    historyExpiresAt: new Date(min(2) + 30 * 24 * 60 * 60 * 1000)
  });
  status(statusCollection, { id: 'AS-a1', taskIdentifier: 'LIN-701', tsMs: min(0) + 30 * 1000 });
  status(statusCollection, { id: 'AS-w1', taskIdentifier: 'LIN-702', tsMs: min(2) + 30 * 1000 });
}

test('LIN-962: title-less loops resolve a real title from the injected title source', async () => {
  const queueCollection = createMockCollection();
  const historyCollection = createMockCollection();
  const statusCollection = createMockCollection();
  const observationCollection = createMockCollection();
  const dispatchStore = new DispatchQueueStore({ collection: queueCollection, historyCollection });
  const agentStatusStore = new AgentStatusStore({ collection: statusCollection });
  const observationSessionsStore = new ObservationSessionsStore({ collection: observationCollection });

  const calls = [];
  const materializer = createObservationMaterializer({
    dispatchStore, agentStatusStore, observationSessionsStore,
    resolveWorkspaceTitles: async (urlKey, ownerAccountId) => { calls.push([urlKey, ownerAccountId]); return { 'LIN-701': 'Fix the login bug' }; }
  });

  seedTitlelessFixture({ historyCollection, statusCollection });
  await materializer.rebuildForWrite(URL_KEY, { sessionId: 'A1' });

  const { sessions } = await observationSessionsStore.findByWorkspace(URL_KEY);
  const s = sessions.find(x => x.sessionId === 'A1');
  assert.ok(s, 'session materialized');
  assert.equal(s.loops[0].issueTitle, 'Fix the login bug', 'real title resolved onto the title-less loop');
  assert.deepEqual(calls, [[URL_KEY, 'account-A']], 'title source consulted with the workspace urlKey and the loop\'s dispatchedBy owner (LIN-1986)');
});

test('LIN-1986: no derivable owner (every candidate loop\'s dispatchedBy is null) ⇒ resolver never consulted, loops stay identifier-only', async () => {
  const queueCollection = createMockCollection();
  const historyCollection = createMockCollection();
  const statusCollection = createMockCollection();
  const observationCollection = createMockCollection();
  const dispatchStore = new DispatchQueueStore({ collection: queueCollection, historyCollection });
  const agentStatusStore = new AgentStatusStore({ collection: statusCollection });
  const observationSessionsStore = new ObservationSessionsStore({ collection: observationCollection });

  let consulted = 0;
  const materializer = createObservationMaterializer({
    dispatchStore, agentStatusStore, observationSessionsStore,
    resolveWorkspaceTitles: async () => { consulted++; return { 'LIN-701': 'Fix the login bug' }; }
  });

  // seedTitlelessFixture with dispatchedBy stripped back to null — the
  // pre-LIN-1948/agent-status-only-derived case, the bounded LIN-2099 residual.
  historyCollection._docs.push({
    _id: 'A1', urlKey: URL_KEY, prompt: 'p', promptName: 'autopilot', kind: 'autopilot',
    issueId: 'id-LIN-701', issueIdentifier: 'LIN-701', issueTitle: null, issueUrl: null,
    dispatchedAt: new Date(min(0)), dispatchedBy: null, sessionId: null, status: 'resolved',
    resolvedAt: new Date(min(1)), feedback: [{ message: '[done] shipped', url: null, urlLabel: null, timestamp: new Date(min(1)) }],
    historyExpiresAt: new Date(min(0) + 30 * 24 * 60 * 60 * 1000)
  });
  status(statusCollection, { id: 'AS-a1', taskIdentifier: 'LIN-701', tsMs: min(0) + 30 * 1000 });

  await materializer.rebuildForWrite(URL_KEY, { sessionId: 'A1' });

  const { sessions } = await observationSessionsStore.findByWorkspace(URL_KEY);
  assert.equal(consulted, 0, 'no owner derivable ⇒ resolver skipped, not called owner-blind');
  assert.equal(sessions.find(x => x.sessionId === 'A1').loops[0].issueTitle, null, 'degrades to identifier-only, never worse');
});

test('LIN-1986: multi-owner batch tries candidates in order, advancing past one that resolves empty (plan-review Finding A)', async () => {
  const queueCollection = createMockCollection();
  const historyCollection = createMockCollection();
  const statusCollection = createMockCollection();
  const observationCollection = createMockCollection();
  const dispatchStore = new DispatchQueueStore({ collection: queueCollection, historyCollection });
  const agentStatusStore = new AgentStatusStore({ collection: statusCollection });
  const observationSessionsStore = new ObservationSessionsStore({ collection: observationCollection });

  const attempted = [];
  const materializer = createObservationMaterializer({
    dispatchStore, agentStatusStore, observationSessionsStore,
    resolveWorkspaceTitles: async (urlKey, ownerAccountId) => {
      attempted.push(ownerAccountId);
      // account-A is a legitimate dispatcher on this urlKey but has no live
      // session/token right now (selectOwnerWorkspaceRow -> null -> {}); the
      // materializer must not stop there just because account-A is non-null.
      if (ownerAccountId === 'account-A') return {};
      return { 'LIN-701': 'Fix the login bug', 'LIN-702': 'Ship the dashboard' };
    }
  });

  seedMultiOwnerTitlelessFixture({ historyCollection, statusCollection });
  await materializer.rebuildForWrite(URL_KEY, { sessionId: 'A1' });

  const { sessions } = await observationSessionsStore.findByWorkspace(URL_KEY);
  const s = sessions.find(x => x.sessionId === 'A1');
  assert.deepEqual(attempted, ['account-A', 'account-B'], 'the anchor\'s owner (dispatched first) is tried first; the worker\'s owner is tried only because it resolved empty');
  const titleFor = id => s.loops.find(l => l.issueIdentifier === id).issueTitle;
  assert.equal(titleFor('LIN-701'), 'Fix the login bug');
  assert.equal(titleFor('LIN-702'), 'Ship the dashboard');
});

test('LIN-962: a Map title source is supported too', async () => {
  const ctx = setup();
  const { historyCollection, statusCollection, observationSessionsStore } = ctx;
  const materializer = createObservationMaterializer({
    dispatchStore: ctx.dispatchStore, agentStatusStore: ctx.agentStatusStore, observationSessionsStore,
    resolveWorkspaceTitles: async () => new Map([['LIN-701', 'Titled via Map']])
  });
  seedTitlelessFixture({ historyCollection, statusCollection });
  await materializer.rebuildForWrite(URL_KEY, { sessionId: 'A1' });
  const { sessions } = await observationSessionsStore.findByWorkspace(URL_KEY);
  assert.equal(sessions.find(x => x.sessionId === 'A1').loops[0].issueTitle, 'Titled via Map');
});

test('LIN-962: identifier-only guard preserved — a resolver returning the identifier is refused', async () => {
  const ctx = setup();
  const { historyCollection, statusCollection, observationSessionsStore } = ctx;
  const materializer = createObservationMaterializer({
    dispatchStore: ctx.dispatchStore, agentStatusStore: ctx.agentStatusStore, observationSessionsStore,
    // A degenerate source that echoes the identifier back must never be written as a
    // title, or the card would render `LIN-701 LIN-701`.
    resolveWorkspaceTitles: async () => ({ 'LIN-701': 'LIN-701' })
  });
  seedTitlelessFixture({ historyCollection, statusCollection });
  await materializer.rebuildForWrite(URL_KEY, { sessionId: 'A1' });
  const { sessions } = await observationSessionsStore.findByWorkspace(URL_KEY);
  assert.equal(sessions.find(x => x.sessionId === 'A1').loops[0].issueTitle, null, 'identifier never written back as a title');
});

test('LIN-962: degrades to identifier-only when title resolution fails (never worse)', async () => {
  const ctx = setup();
  const { historyCollection, statusCollection, observationSessionsStore } = ctx;
  const materializer = createObservationMaterializer({
    dispatchStore: ctx.dispatchStore, agentStatusStore: ctx.agentStatusStore, observationSessionsStore,
    resolveWorkspaceTitles: async () => { throw new Error('token expired'); }
  });
  seedTitlelessFixture({ historyCollection, statusCollection });
  await materializer.rebuildForWrite(URL_KEY, { sessionId: 'A1' }); // must not reject
  const { sessions } = await observationSessionsStore.findByWorkspace(URL_KEY);
  const s = sessions.find(x => x.sessionId === 'A1');
  assert.ok(s, 'session still materialized despite title resolution failing');
  assert.equal(s.loops[0].issueTitle, null, 'loop stays as-built — identifier-only, not corrupted');
});

test('LIN-962: no resolver wired ⇒ behaviour unchanged (loops left as built)', async () => {
  const ctx = setup(); // setup() wires NO resolveWorkspaceTitles
  const { historyCollection, statusCollection, observationSessionsStore, materializer } = ctx;
  seedTitlelessFixture({ historyCollection, statusCollection });
  await materializer.rebuildForWrite(URL_KEY, { sessionId: 'A1' });
  const { sessions } = await observationSessionsStore.findByWorkspace(URL_KEY);
  assert.equal(sessions.find(x => x.sessionId === 'A1').loops[0].issueTitle, null);
});

test('LIN-962: resolver is skipped entirely when every loop already has a title', async () => {
  const queueCollection = createMockCollection();
  const historyCollection = createMockCollection();
  const statusCollection = createMockCollection();
  const observationCollection = createMockCollection();
  const dispatchStore = new DispatchQueueStore({ collection: queueCollection, historyCollection });
  const agentStatusStore = new AgentStatusStore({ collection: statusCollection });
  const observationSessionsStore = new ObservationSessionsStore({ collection: observationCollection });

  let consulted = 0;
  const materializer = createObservationMaterializer({
    dispatchStore, agentStatusStore, observationSessionsStore,
    resolveWorkspaceTitles: async () => { consulted++; return {}; }
  });

  // seedSpanningFixture's archived rows all carry `${id} title`, so nothing is missing.
  seedSpanningFixture({ historyCollection, statusCollection });
  await materializer.rebuildForWrite(URL_KEY, { sessionId: 'S1' });
  assert.equal(consulted, 0, 'no title lookup paid for when nothing is missing');
});

test('LIN-962: backfillWorkspace enriches title-less loops (AC-3, backfill path)', async () => {
  const queueCollection = createMockCollection();
  const historyCollection = createMockCollection();
  const statusCollection = createMockCollection();
  const observationCollection = createMockCollection();
  const dispatchStore = new DispatchQueueStore({ collection: queueCollection, historyCollection });
  const agentStatusStore = new AgentStatusStore({ collection: statusCollection });
  const observationSessionsStore = new ObservationSessionsStore({ collection: observationCollection });

  const materializer = createObservationMaterializer({
    dispatchStore, agentStatusStore, observationSessionsStore,
    resolveWorkspaceTitles: async () => ({ 'LIN-701': 'Fix the login bug' })
  });

  seedTitlelessFixture({ historyCollection, statusCollection });
  await materializer.backfillWorkspace(URL_KEY);

  const { sessions, backfilledAt } = await observationSessionsStore.findByWorkspace(URL_KEY);
  const s = sessions.find(x => x.sessionId === 'A1');
  assert.ok(backfilledAt, 'backfill marker set');
  assert.ok(s, 'session backfilled');
  assert.equal(s.loops[0].issueTitle, 'Fix the login bug', 'title-less loop enriched on the backfill path too');
});

test('LIN-962: a PRE-EXISTING persisted title-less session rehydrates on next backfill (AC-3)', async () => {
  // Models the real historical case: a session was materialized BEFORE the fix
  // (no resolver, so its loop is title-less and persisted that way). A later
  // re-materialization — now wired with a resolver — must rehydrate it. This is
  // exactly the screenshot's `LIN-701` card, and is what "backfill for free" means.
  const queueCollection = createMockCollection();
  const historyCollection = createMockCollection();
  const statusCollection = createMockCollection();
  const observationCollection = createMockCollection();
  const dispatchStore = new DispatchQueueStore({ collection: queueCollection, historyCollection });
  const agentStatusStore = new AgentStatusStore({ collection: statusCollection });
  const observationSessionsStore = new ObservationSessionsStore({ collection: observationCollection });

  seedTitlelessFixture({ historyCollection, statusCollection });

  // Phase 1: materialize WITHOUT a resolver (the pre-fix world) → persisted title-less.
  const before = createObservationMaterializer({ dispatchStore, agentStatusStore, observationSessionsStore });
  await before.backfillWorkspace(URL_KEY);
  let { sessions } = await observationSessionsStore.findByWorkspace(URL_KEY);
  assert.equal(sessions.find(x => x.sessionId === 'A1').loops[0].issueTitle, null, 'persisted title-less pre-fix');

  // Phase 2: re-materialize WITH a resolver over the SAME stores → rehydrated.
  const after = createObservationMaterializer({
    dispatchStore, agentStatusStore, observationSessionsStore,
    resolveWorkspaceTitles: async () => ({ 'LIN-701': 'Fix the login bug' })
  });
  await after.backfillWorkspace(URL_KEY);

  ({ sessions } = await observationSessionsStore.findByWorkspace(URL_KEY));
  assert.equal(
    sessions.find(x => x.sessionId === 'A1').loops[0].issueTitle,
    'Fix the login bug',
    'historical title-less session rehydrated on next backfill — no separate migration'
  );
});

test('rebuildForWrite for an issue in no session is a no-op (does not throw, writes nothing)', async () => {
  const ctx = setup();
  seedSpanningFixture(ctx);
  const { observationSessionsStore, materializer } = ctx;
  await materializer.rebuildForWrite(URL_KEY, { issueIdentifier: 'LIN-999' });
  const { sessions } = await observationSessionsStore.findByWorkspace(URL_KEY);
  assert.equal(sessions.length, 0);
});

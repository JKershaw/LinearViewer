/**
 * Unit coverage for the Live Console data layer (LIN-1436).
 *
 * The Live Console is an ambient, generation-free view: a real-time feed of the
 * whole swarm's activity that you leave running and watch. Its spine is the
 * agent-status store — discrete, human-readable step events (research /
 * implementation / review / close-out, each with a one-line summary) already
 * flowing through the system. `lib/live-console.js` is the PURE transform from
 * those raw, workspace-tagged status entries into the shapes the client renders:
 *
 *   - events : normalized, newest-first, capped stream (the trickle)
 *   - lanes  : the currently-working agents (one per workspace+task, latest wins)
 *   - tempo  : event-arrival counts bucketed over the recent window (the sparkline)
 *   - summary: fleet totals (active / done / failed / blocked)
 *
 * Everything here is deterministic (a `now` is injected, never read from the
 * clock) and tolerant (never throws on malformed input) — the same discipline as
 * lib/session-telemetry.js.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeStatusEvent,
  buildConsoleFeed,
  normalizeEvidenceEvents,
  deriveLoopLanes,
  buildPulse,
  latestHeartbeat,
  SUMMARY_MAX,
} from '../../lib/live-console.js';

// A lean loop record, shaped like getLoopsForWorkspace(lean) output after the
// route folds in { workspaceUrlKey, workspaceName }.
function loop(over = {}) {
  return {
    loopId: 'loop-1',
    issueIdentifier: 'LIN-9',
    agentState: 'running',
    agentAction: 'implementation',
    agentSummary: 'editing lib/foo.js',
    dispatchedAt: '2026-07-19T11:50:00.000Z',
    agentTimestamp: '2026-07-19T11:59:00.000Z',
    terminalStatus: undefined,
    workspaceUrlKey: 'acme',
    workspaceName: 'Acme',
    telemetry: {
      runtime: { ms: null },
      metrics: [
        { toolCount: 3, elapsedSeconds: 40, breakdown: { Bash: 2, Read: 1 }, total: 3, timestamp: '2026-07-19T11:55:00.000Z' },
        { toolCount: 12, elapsedSeconds: 540, breakdown: { Bash: 7, Read: 5 }, total: 15, timestamp: '2026-07-19T11:59:00.000Z' },
      ],
      producedArtifacts: [],
    },
    ...over,
  };
}

// A workspace-tagged agent-status entry, shaped like the store's listStatus items
// after the route folds in { workspaceUrlKey, workspaceName }.
function statusItem(over = {}) {
  return {
    id: 'e1',
    taskIdentifier: 'LIN-42',
    action: 'implementation',
    status: 'completed',
    summary: 'Landed the fix in PR #123',
    timestamp: '2026-07-19T12:00:00.000Z',
    workspaceUrlKey: 'acme',
    workspaceName: 'Acme',
    ...over,
  };
}

// ─── normalizeStatusEvent ─────────────────────────────────────────────────────

test('normalizeStatusEvent maps a completed entry to a done event with epoch ms', () => {
  const ev = normalizeStatusEvent(statusItem());
  assert.equal(ev.kind, 'done');
  assert.equal(ev.task, 'LIN-42');
  assert.equal(ev.action, 'implementation');
  assert.equal(ev.workspaceUrlKey, 'acme');
  assert.equal(ev.workspaceName, 'Acme');
  assert.equal(ev.ts, new Date('2026-07-19T12:00:00.000Z').getTime());
  assert.equal(ev.summary, 'Landed the fix in PR #123');
});

test('normalizeStatusEvent maps status vocabulary to kinds (tolerant of casing/synonyms)', () => {
  assert.equal(normalizeStatusEvent(statusItem({ status: 'in_progress' })).kind, 'working');
  assert.equal(normalizeStatusEvent(statusItem({ status: 'IN-PROGRESS' })).kind, 'working');
  assert.equal(normalizeStatusEvent(statusItem({ status: 'blocked' })).kind, 'blocked');
  assert.equal(normalizeStatusEvent(statusItem({ status: 'failed' })).kind, 'failed');
  assert.equal(normalizeStatusEvent(statusItem({ status: 'error' })).kind, 'failed');
  assert.equal(normalizeStatusEvent(statusItem({ status: 'success' })).kind, 'done');
  // Unknown / absent status is a neutral info event, never a throw.
  assert.equal(normalizeStatusEvent(statusItem({ status: 'noodling' })).kind, 'info');
  assert.equal(normalizeStatusEvent(statusItem({ status: '' })).kind, 'info');
});

test('normalizeStatusEvent caps the summary and never throws on junk', () => {
  const long = 'x'.repeat(SUMMARY_MAX + 500);
  assert.equal(normalizeStatusEvent(statusItem({ summary: long })).summary.length, SUMMARY_MAX);
  // Malformed inputs return null rather than throwing.
  assert.equal(normalizeStatusEvent(null), null);
  assert.equal(normalizeStatusEvent({}), null); // no timestamp
  assert.equal(normalizeStatusEvent(statusItem({ timestamp: 'not-a-date' })), null);
});

// ─── buildConsoleFeed: events ─────────────────────────────────────────────────

test('buildConsoleFeed returns events newest-first and caps to maxEvents', () => {
  const items = [
    statusItem({ id: 'a', timestamp: '2026-07-19T12:00:00.000Z' }),
    statusItem({ id: 'b', timestamp: '2026-07-19T12:05:00.000Z' }),
    statusItem({ id: 'c', timestamp: '2026-07-19T12:02:00.000Z' }),
  ];
  const { events } = buildConsoleFeed(items, { now: Date.parse('2026-07-19T12:10:00Z') });
  assert.deepEqual(events.map(e => e.id), ['b', 'c', 'a']);

  const { events: capped } = buildConsoleFeed(items, { now: Date.parse('2026-07-19T12:10:00Z'), maxEvents: 2 });
  assert.deepEqual(capped.map(e => e.id), ['b', 'c']);
});

test('buildConsoleFeed is tolerant of a non-array / empty input', () => {
  for (const bad of [null, undefined, 'nope', 42, {}]) {
    const feed = buildConsoleFeed(bad, { now: 0 });
    assert.deepEqual(feed.events, []);
    assert.deepEqual(feed.lanes, []);
    assert.deepEqual(feed.summary, { active: 0, done: 0, failed: 0, blocked: 0, total: 0 });
  }
});

// ─── buildConsoleFeed: lanes (currently-working agents) ───────────────────────

test('lanes hold one entry per workspace+task whose LATEST event is working', () => {
  const items = [
    // acme/LIN-1: started then finished → NOT a lane.
    statusItem({ id: '1', workspaceUrlKey: 'acme', taskIdentifier: 'LIN-1', status: 'in_progress', timestamp: '2026-07-19T12:00:00Z' }),
    statusItem({ id: '2', workspaceUrlKey: 'acme', taskIdentifier: 'LIN-1', status: 'completed', timestamp: '2026-07-19T12:03:00Z' }),
    // acme/LIN-2: still working → a lane.
    statusItem({ id: '3', workspaceUrlKey: 'acme', taskIdentifier: 'LIN-2', status: 'in_progress', timestamp: '2026-07-19T12:04:00Z', summary: 'reading src' }),
    // beta/LIN-2: same task id, different workspace, still working → a distinct lane.
    statusItem({ id: '4', workspaceUrlKey: 'beta', workspaceName: 'Beta', taskIdentifier: 'LIN-2', status: 'in_progress', timestamp: '2026-07-19T12:01:00Z' }),
  ];
  const { lanes } = buildConsoleFeed(items, { now: Date.parse('2026-07-19T12:05:00Z') });

  // Two lanes: acme/LIN-2 and beta/LIN-2 — acme/LIN-1 excluded (latest is done).
  assert.equal(lanes.length, 2);
  const keys = lanes.map(l => `${l.workspaceUrlKey}/${l.task}`);
  assert.ok(keys.includes('acme/LIN-2'));
  assert.ok(keys.includes('beta/LIN-2'));
  assert.ok(!keys.includes('acme/LIN-1'));

  // Lanes carry the latest summary and are sorted most-recent first.
  assert.equal(lanes[0].task, 'LIN-2');
  assert.equal(lanes[0].workspaceUrlKey, 'acme');
  assert.equal(lanes[0].summary, 'reading src');
});

// ─── buildConsoleFeed: tempo (sparkline buckets) ──────────────────────────────

test('tempo buckets count events oldest→newest over the window', () => {
  const now = Date.parse('2026-07-19T12:00:00Z');
  const min = 60 * 1000;
  const items = [
    statusItem({ id: 'n0', timestamp: new Date(now - 0.5 * min).toISOString() }), // newest bucket
    statusItem({ id: 'n1', timestamp: new Date(now - 1.5 * min).toISOString() }),
    statusItem({ id: 'n2', timestamp: new Date(now - 1.7 * min).toISOString() }),
    statusItem({ id: 'old', timestamp: new Date(now - 10 * min).toISOString() }), // outside a 4-bucket window
  ];
  const { tempo } = buildConsoleFeed(items, { now, tempoBucketMs: min, tempoBuckets: 4 });
  // 4 buckets, oldest→newest: [t-4..t-3), [t-3..t-2), [t-2..t-1), [t-1..t-0)
  assert.equal(tempo.length, 4);
  assert.deepEqual(tempo, [0, 0, 2, 1]);
});

// ─── pulse (flowing-strip heartbeat hum) ──────────────────────────────────────

test('buildPulse buckets heartbeats-only into a fine window ending at now', () => {
  const now = Date.parse('2026-07-19T12:00:00Z');
  const s = 1000;
  const hbLoop = loop({
    telemetry: { producedArtifacts: [], metrics: [
      { toolCount: 1, timestamp: new Date(now - 3 * s).toISOString() },  // newest bucket
      { toolCount: 2, timestamp: new Date(now - 4 * s).toISOString() },  // newest bucket
      { toolCount: 3, timestamp: new Date(now - 12 * s).toISOString() }, // older bucket
    ] },
  });
  const pulse = buildPulse([hbLoop], { now, windowMs: 30 * s, bucketMs: 5 * s });
  assert.equal(pulse.endTs, now);
  assert.equal(pulse.bucketMs, 5 * s);
  assert.equal(pulse.buckets.length, 6);          // 30s / 5s
  assert.equal(pulse.buckets[5], 2);              // the two beats 3s & 4s ago
  assert.equal(pulse.buckets[3], 1);              // the beat 12s ago
  // Discrete events (non-heartbeat) never enter the pulse.
  assert.equal(pulse.buckets.reduce((a, b) => a + b, 0), 3);
});

// LIN-1929 (Phase C of LIN-1908): `load[]` is additive alongside `buckets[]` —
// same anchors/length, summing each beat's magnitude instead of counting it.
test('buildPulse load[] sums each bucket\'s total, falling back to toolCount, without disturbing buckets[]', () => {
  const now = Date.parse('2026-07-19T12:00:00Z');
  const s = 1000;
  const hbLoop = loop({
    telemetry: { producedArtifacts: [], metrics: [
      { toolCount: 1, total: 5, timestamp: new Date(now - 3 * s).toISOString() },  // newest bucket: has `total`
      { toolCount: 2, timestamp: new Date(now - 4 * s).toISOString() },            // newest bucket: falls back to toolCount
      { toolCount: 3, total: 0, timestamp: new Date(now - 12 * s).toISOString() }, // older bucket: total present but 0
    ] },
  });
  const pulse = buildPulse([hbLoop], { now, windowMs: 30 * s, bucketMs: 5 * s });
  assert.equal(pulse.load.length, pulse.buckets.length);
  assert.equal(pulse.load[5], 7);   // 5 (total) + 2 (toolCount fallback)
  assert.equal(pulse.load[3], 0);   // total:0 is honoured, not treated as missing
  // buckets[] keeps counting beats, unaffected by the magnitude they carry.
  assert.equal(pulse.buckets[5], 2);
  assert.equal(pulse.buckets[3], 1);
});

test('buildPulse tolerates loops with no telemetry at all — load[] stays zeroed', () => {
  const now = Date.parse('2026-07-19T12:00:00Z');
  const pulse = buildPulse([{ issueIdentifier: 'LIN-1' }, null, undefined], { now });
  assert.ok(pulse.load.every(v => v === 0));
  assert.equal(pulse.load.length, pulse.buckets.length);
});

test('buildConsoleFeed exposes pulse + serverNow for the flowing strip', () => {
  const now = Date.parse('2026-07-19T12:00:00Z');
  const feed = buildConsoleFeed({ statusItems: [], loops: [loop()] }, { now });
  assert.equal(feed.serverNow, now);
  assert.ok(Array.isArray(feed.pulse.buckets));
  assert.equal(feed.pulse.endTs, now);
});

// ─── buildConsoleFeed: summary (fleet totals) ─────────────────────────────────

// ─── heartbeats: loop-based lanes ─────────────────────────────────────────────

test('deriveLoopLanes surfaces running loops with their latest heartbeat', () => {
  const lanes = deriveLoopLanes([loop()]);
  assert.equal(lanes.length, 1);
  const l = lanes[0];
  assert.equal(l.task, 'LIN-9');
  assert.equal(l.workspaceUrlKey, 'acme');
  // Latest heartbeat (last metric) carried for the live tick.
  assert.equal(l.heartbeat.toolCount, 12);
  assert.equal(l.heartbeat.total, 15);
  assert.deepEqual(l.heartbeat.breakdown, { Bash: 7, Read: 5 });
});

// LIN-1929 (Phase C of LIN-1908): `latestHeartbeat` used to drop the parsed
// `state` field even though `parseHeartbeat` already produces it — plumbing
// only, no new parsing.
test('latestHeartbeat plumbs the parsed state through (running/idle/absent)', () => {
  const running = loop({ telemetry: { producedArtifacts: [], metrics: [
    { toolCount: 1, total: 1, state: 'running', timestamp: '2026-07-19T11:59:00.000Z' },
  ] } });
  assert.equal(latestHeartbeat(running).state, 'running');

  const idle = loop({ telemetry: { producedArtifacts: [], metrics: [
    { toolCount: 0, total: 0, state: 'idle', timestamp: '2026-07-19T11:59:00.000Z' },
  ] } });
  assert.equal(latestHeartbeat(idle).state, 'idle');

  // A metric with no parsed state (older data, or a non-heartbeat shape) reads
  // as null, never a fabricated default.
  const noState = loop({ telemetry: { producedArtifacts: [], metrics: [
    { toolCount: 3, total: 3, timestamp: '2026-07-19T11:59:00.000Z' },
  ] } });
  assert.equal(latestHeartbeat(noState).state, null);
});

test('deriveLoopLanes excludes terminal / non-running loops', () => {
  assert.equal(deriveLoopLanes([loop({ agentState: 'complete' })]).length, 0);
  assert.equal(deriveLoopLanes([loop({ agentState: 'error' })]).length, 0);
  assert.equal(deriveLoopLanes([loop({ agentState: 'queued' })]).length, 0);
  // A terminal marker overrides a stale 'running' agentState.
  assert.equal(deriveLoopLanes([loop({ agentState: 'running', terminalStatus: 'done' })]).length, 0);
});

test('buildConsoleFeed lanes come from running loops (with heartbeat), preferred over status lanes', () => {
  const items = [
    // status says LIN-9 working, but the loop carries the richer heartbeat.
    statusItem({ id: 's1', taskIdentifier: 'LIN-9', status: 'in_progress', timestamp: '2026-07-19T11:52:00Z' }),
    // a working task with NO loop → still a lane via the status fallback.
    statusItem({ id: 's2', taskIdentifier: 'LIN-5', status: 'in_progress', timestamp: '2026-07-19T11:58:00Z' }),
  ];
  const { lanes } = buildConsoleFeed({ statusItems: items, loops: [loop()] }, { now: Date.parse('2026-07-19T12:00:00Z') });
  const byTask = Object.fromEntries(lanes.map(l => [l.task, l]));
  assert.ok(byTask['LIN-9'].heartbeat, 'loop lane carries heartbeat');
  assert.ok(byTask['LIN-5'], 'status-only working task still becomes a lane');
  assert.equal(byTask['LIN-5'].heartbeat, undefined);
});

test('deriveLoopLanes stamps lastActivityMs from the most recent of dispatch/agent/heartbeat', () => {
  const lanes = deriveLoopLanes([loop()]);
  // Latest signal is the 11:59 heartbeat / agentTimestamp.
  assert.equal(lanes[0].lastActivityMs, new Date('2026-07-19T11:59:00.000Z').getTime());
});

test('buildConsoleFeed drops STALE running lanes (no activity within the window)', () => {
  const now = Date.parse('2026-07-19T12:00:00Z');
  const fresh = loop({ loopId: 'fresh', issueIdentifier: 'LIN-9' }); // activity 11:59 (1 min ago)
  const stale = loop({
    loopId: 'stale',
    issueIdentifier: 'LIN-8',
    dispatchedAt: '2026-07-19T10:00:00.000Z',
    agentTimestamp: '2026-07-19T10:15:00.000Z',
    telemetry: { metrics: [{ toolCount: 2, timestamp: '2026-07-19T10:20:00.000Z' }], producedArtifacts: [] },
  });
  const feed = buildConsoleFeed({ statusItems: [], loops: [fresh, stale] }, { now });
  const tasks = feed.lanes.map(l => l.task);
  assert.deepEqual(tasks, ['LIN-9']);          // stale LIN-8 (1h40m idle) dropped
  assert.equal(feed.summary.active, 1);        // active count reflects the drop
});

test('buildConsoleFeed drops a STALE status-only working lane too', () => {
  const now = Date.parse('2026-07-19T12:00:00Z');
  const items = [
    statusItem({ id: 'old', taskIdentifier: 'LIN-1', status: 'in_progress', timestamp: '2026-07-19T10:00:00Z' }), // 2h ago
    statusItem({ id: 'new', taskIdentifier: 'LIN-2', status: 'in_progress', timestamp: '2026-07-19T11:55:00Z' }), // 5 min ago
  ];
  const { lanes } = buildConsoleFeed({ statusItems: items, loops: [] }, { now });
  assert.deepEqual(lanes.map(l => l.task), ['LIN-2']);
});

test('laneStaleMs is configurable', () => {
  const now = Date.parse('2026-07-19T12:00:00Z');
  const stale = loop({ issueIdentifier: 'LIN-8', dispatchedAt: '2026-07-19T11:30:00Z', agentTimestamp: '2026-07-19T11:30:00Z',
    telemetry: { metrics: [{ toolCount: 1, timestamp: '2026-07-19T11:30:00Z' }], producedArtifacts: [] } }); // 30 min ago
  // Default 1h → kept.
  assert.equal(buildConsoleFeed({ statusItems: [], loops: [stale] }, { now }).lanes.length, 1);
  // Tighter 15-min cutoff → dropped.
  assert.equal(buildConsoleFeed({ statusItems: [], loops: [stale] }, { now, laneStaleMs: 15 * 60 * 1000 }).lanes.length, 0);
});

// ─── lineage-aware lane survival (LIN-1477) ────────────────────────────────────

test('deriveLoopLanes folds a lineage heartbeat into lastActivityMs when it is the most recent signal', () => {
  const lp = loop({
    dispatchedAt: '2026-07-19T10:00:00.000Z',
    agentTimestamp: '2026-07-19T10:05:00.000Z',
    telemetry: { metrics: [{ toolCount: 1, timestamp: '2026-07-19T10:10:00.000Z' }], producedArtifacts: [] },
    // A repoint on the same lineage beat far more recently than this loop's own
    // dispatch/agent/heartbeat signals.
    lineageLastActivityMs: Date.parse('2026-07-19T11:55:00.000Z'),
  });
  const [lane] = deriveLoopLanes([lp]);
  assert.equal(lane.lastActivityMs, Date.parse('2026-07-19T11:55:00.000Z'));
});

test('a lane survives the 1h staleness filter while its lineage is beating, even though the loop itself is idle', () => {
  const now = Date.parse('2026-07-19T12:00:00Z');
  const lp = loop({
    loopId: 'lineage-lane',
    issueIdentifier: 'LIN-8',
    dispatchedAt: '2026-07-19T10:00:00.000Z',
    agentTimestamp: '2026-07-19T10:15:00.000Z',
    telemetry: { metrics: [{ toolCount: 2, timestamp: '2026-07-19T10:20:00.000Z' }], producedArtifacts: [] },
    lineageLastActivityMs: Date.parse('2026-07-19T11:50:00.000Z'), // 10 min ago
  });
  const feed = buildConsoleFeed({ statusItems: [], loops: [lp] }, { now });
  assert.deepEqual(feed.lanes.map(l => l.task), ['LIN-8'], 'the lineage beat keeps the lane alive past its own 1h40m idle own-signals');
});

test('a stale lineage (no recent beat) does NOT rescue the lane — negative control', () => {
  const now = Date.parse('2026-07-19T12:00:00Z');
  const lp = loop({
    loopId: 'lineage-lane-2',
    issueIdentifier: 'LIN-8',
    dispatchedAt: '2026-07-19T10:00:00.000Z',
    agentTimestamp: '2026-07-19T10:15:00.000Z',
    telemetry: { metrics: [{ toolCount: 2, timestamp: '2026-07-19T10:20:00.000Z' }], producedArtifacts: [] },
    // The lineage aggregate exists but is itself old — must not be treated as a
    // free pass; this isolates the wiring from a hardcoded "always survives".
    lineageLastActivityMs: Date.parse('2026-07-19T10:20:00.000Z'),
  });
  const feed = buildConsoleFeed({ statusItems: [], loops: [lp] }, { now });
  assert.deepEqual(feed.lanes, [], 'no recent lineage beat, no rescue — the lane still drops as stale');
});

// ─── per-lane credential state (LIN-1588, Beat 2 of LIN-1577) ─────────────────
//
// The lane answers "which of my four trees is dead?" without the human having to
// open the BLOCKED park a stranded worker wrote. The verdict itself is Beat 1's
// (lib/proxy-events.js) and is INJECTED here as a tokenId → verdict index — this
// module performs no read, so its purity/`now`-injection is untouched.

test('a lane carries a credential state', () => {
  const [lane] = deriveLoopLanes([loop({ agentTokenId: 'tok-1', agentTokenLabel: 'dispatch-bootstrap' })],
    { credentialByToken: { 'tok-1': 'ok' } });
  assert.deepEqual(lane.credential, { state: 'ok', label: 'dispatch-bootstrap' });
});

test('agentTokenId: null → unknown (the ORDINARY case, ~99.86% of dispatches)', () => {
  const [lane] = deriveLoopLanes([loop({ agentTokenId: null, agentTokenLabel: null })], { credentialByToken: {} });
  assert.equal(lane.credential.state, 'unknown');
  assert.equal(lane.credential.label, null);
});

test('token present with verdict credential_dead → dead', () => {
  const [lane] = deriveLoopLanes([loop({ agentTokenId: 'tok-dead' })], { credentialByToken: { 'tok-dead': 'credential_dead' } });
  assert.equal(lane.credential.state, 'dead');
});

test('token present with verdict ok → ok', () => {
  const [lane] = deriveLoopLanes([loop({ agentTokenId: 'tok-ok' })], { credentialByToken: { 'tok-ok': 'ok' } });
  assert.equal(lane.credential.state, 'ok');
});

test('token ABSENT from the map → unknown, never a false ok/healthy', () => {
  // The ticket's stated invariant: no recent events ⇒ no evidence ⇒ no verdict.
  const [lane] = deriveLoopLanes([loop({ agentTokenId: 'tok-missing' })], { credentialByToken: { 'tok-other': 'ok' } });
  assert.equal(lane.credential.state, 'unknown');
});

test('agentTokenLabel is display text only — it never affects the lane key', () => {
  // Labels are shared across concurrent sessions (every dispatch mints
  // `dispatch-bootstrap`) and historical rows keep `'exchanged'`, so two lanes
  // sharing a label must remain two lanes.
  const lanes = deriveLoopLanes([
    loop({ loopId: 'a', issueIdentifier: 'LIN-1', agentTokenId: 'tok-a', agentTokenLabel: 'dispatch-bootstrap' }),
    loop({ loopId: 'b', issueIdentifier: 'LIN-2', agentTokenId: 'tok-b', agentTokenLabel: 'dispatch-bootstrap' }),
  ], { credentialByToken: { 'tok-a': 'credential_dead', 'tok-b': 'ok' } });
  assert.equal(lanes.length, 2, 'a shared label does not collapse two lanes');
  const byTask = Object.fromEntries(lanes.map(l => [l.task, l.credential.state]));
  assert.deepEqual(byTask, { 'LIN-1': 'dead', 'LIN-2': 'ok' });
});

test('deriveLoopLanes with no options at all still resolves a credential (back-compat call shape)', () => {
  const [lane] = deriveLoopLanes([loop({ agentTokenId: 'tok-1' })]);
  assert.equal(lane.credential.state, 'unknown');
});

test('buildConsoleFeed with no credentialByToken → every lane unknown, rest of the lane byte-unchanged', () => {
  const now = Date.parse('2026-07-19T12:00:00Z');
  const lp = loop({ agentTokenId: 'tok-1', agentTokenLabel: 'dispatch-bootstrap' });
  const { lanes } = buildConsoleFeed({ statusItems: [], loops: [lp] }, { now });
  assert.equal(lanes[0].credential.state, 'unknown');
  // Every pre-existing lane field is untouched by the addition.
  const { credential, ...rest } = lanes[0];
  assert.deepEqual(rest, {
    workspaceUrlKey: 'acme',
    workspaceName: 'Acme',
    task: 'LIN-9',
    action: 'implementation',
    summary: 'editing lib/foo.js',
    sinceMs: Date.parse('2026-07-19T11:50:00.000Z'),
    lastActivityMs: Date.parse('2026-07-19T11:59:00.000Z'),
    heartbeat: { toolCount: 12, elapsedSeconds: 540, breakdown: { Bash: 7, Read: 5 }, total: 15, state: null },
  });
});

test('buildConsoleFeed threads credentialByToken through to the lanes', () => {
  const now = Date.parse('2026-07-19T12:00:00Z');
  const lp = loop({ agentTokenId: 'tok-dead' });
  const { lanes } = buildConsoleFeed({ statusItems: [], loops: [lp] },
    { now, credentialByToken: { 'tok-dead': 'credential_dead' } });
  assert.equal(lanes[0].credential.state, 'dead');
});

// ─── evidence events from [evidence] artifacts ────────────────────────────────

test('normalizeEvidenceEvents turns produced artifacts into linked evidence events', () => {
  const evLoop = loop({
    telemetry: { metrics: [], producedArtifacts: [
      { url: 'https://github.com/x/y/pull/9', label: 'PR #9', mentions: 2, timestamp: '2026-07-19T11:57:00.000Z' },
    ] },
  });
  const evs = normalizeEvidenceEvents([evLoop]);
  assert.equal(evs.length, 1);
  assert.equal(evs[0].kind, 'evidence');
  assert.equal(evs[0].url, 'https://github.com/x/y/pull/9');
  assert.equal(evs[0].task, 'LIN-9');
  assert.equal(evs[0].workspaceUrlKey, 'acme');
  assert.equal(evs[0].ts, new Date('2026-07-19T11:57:00.000Z').getTime());
});

test('buildConsoleFeed merges evidence into the event stream, newest-first', () => {
  const evLoop = loop({
    telemetry: { metrics: [], producedArtifacts: [
      { url: 'https://x/pr/1', label: 'PR #1', timestamp: '2026-07-19T11:58:30.000Z' },
    ] },
  });
  const items = [statusItem({ id: 's1', timestamp: '2026-07-19T11:58:00Z' })];
  const { events } = buildConsoleFeed({ statusItems: items, loops: [evLoop] }, { now: Date.parse('2026-07-19T12:00:00Z') });
  assert.equal(events[0].kind, 'evidence'); // 11:58:30 newer than the 11:58:00 status
  assert.equal(events[1].id, 's1');
});

// ─── pagination (view more) ───────────────────────────────────────────────────

test('buildConsoleFeed paginates with pageSize + a before cursor', () => {
  const mk = (id, min) => statusItem({ id, timestamp: `2026-07-19T12:${String(min).padStart(2, '0')}:00Z` });
  const items = [mk('a', 5), mk('b', 4), mk('c', 3), mk('d', 2), mk('e', 1)];
  const now = Date.parse('2026-07-19T12:10:00Z');

  const first = buildConsoleFeed({ statusItems: items, loops: [] }, { now, pageSize: 2 });
  assert.deepEqual(first.events.map(e => e.id), ['a', 'b']); // newest 2
  assert.equal(first.hasMore, true);
  assert.equal(first.oldestTs, first.events[1].ts);

  // Next page: everything strictly older than the cursor.
  const second = buildConsoleFeed({ statusItems: items, loops: [] }, { now, pageSize: 2, before: first.oldestTs });
  assert.deepEqual(second.events.map(e => e.id), ['c', 'd']);
  assert.equal(second.hasMore, true);

  const third = buildConsoleFeed({ statusItems: items, loops: [] }, { now, pageSize: 2, before: second.oldestTs });
  assert.deepEqual(third.events.map(e => e.id), ['e']);
  assert.equal(third.hasMore, false);
});

// ─── buildConsoleFeed: source-level truncation signals (LIN-1494) ─────────────

test('sourceHasMore forces hasMore even when the in-memory pool fits one page', () => {
  // The store capped its read (per-workspace limit) — the pool the feed sees
  // is complete-LOOKING but the source has older rows. Deriving hasMore from
  // the truncated pool alone is what dead-ended "view earlier activity".
  const now = Date.parse('2026-07-19T12:10:00Z');
  const items = [statusItem({ id: '1', timestamp: '2026-07-19T12:00:00Z' })];
  const feed = buildConsoleFeed({ statusItems: items, loops: [] }, { now, sourceHasMore: true });
  assert.equal(feed.events.length, 1, 'pool fits one page');
  assert.equal(feed.hasMore, true, 'the store-level truncation signal must OR into hasMore');
});

test('sourceTotal overrides summary.total (plus evidence events)', () => {
  const now = Date.parse('2026-07-19T12:00:00Z');
  const items = [statusItem({ id: '1', timestamp: '2026-07-19T11:59:00Z' })];
  const evLoop = loop({
    telemetry: {
      runtime: { ms: null }, metrics: [],
      producedArtifacts: [{ label: 'PR #9', url: 'https://github.com/x/y/pull/9', timestamp: '2026-07-19T11:58:00Z' }],
    },
  });
  const feed = buildConsoleFeed({ statusItems: items, loops: [evLoop] }, { now, sourceTotal: 40 });
  // 40 status entries exist at the source (only 1 materialised) + 1 evidence event.
  assert.equal(feed.summary.total, 41, 'the store-level total + evidence events, not the truncated pool length');
});

test('omitting sourceHasMore/sourceTotal preserves today\'s outputs byte-identically (back-compat pin, incl. bare-array input)', () => {
  const now = Date.parse('2026-07-19T12:10:00Z');
  const items = [
    statusItem({ id: '1', timestamp: '2026-07-19T12:00:00Z' }),
    statusItem({ id: '2', timestamp: '2026-07-19T12:01:00Z', status: 'failed' }),
  ];
  const withOpts = buildConsoleFeed({ statusItems: items, loops: [] }, { now });
  assert.equal(withOpts.hasMore, false, 'no source signal, pool fits → hasMore false as before');
  assert.equal(withOpts.summary.total, 2, 'falls back to the pool length as before');
  // Bare-array input form (documented back-compat) unchanged too.
  const bare = buildConsoleFeed(items, { now });
  assert.deepEqual(bare.summary, withOpts.summary);
  assert.equal(bare.hasMore, false);
});

test('summary counts kinds; active = number of working lanes', () => {
  const items = [
    statusItem({ id: '1', taskIdentifier: 'LIN-1', status: 'in_progress', timestamp: '2026-07-19T12:04:00Z' }),
    statusItem({ id: '2', taskIdentifier: 'LIN-2', status: 'completed', timestamp: '2026-07-19T12:03:00Z' }),
    statusItem({ id: '3', taskIdentifier: 'LIN-3', status: 'failed', timestamp: '2026-07-19T12:02:00Z' }),
    statusItem({ id: '4', taskIdentifier: 'LIN-4', status: 'blocked', timestamp: '2026-07-19T12:01:00Z' }),
  ];
  const { summary } = buildConsoleFeed(items, { now: Date.parse('2026-07-19T12:05:00Z') });
  assert.equal(summary.total, 4);
  assert.equal(summary.done, 1);
  assert.equal(summary.failed, 1);
  assert.equal(summary.blocked, 1);
  assert.equal(summary.active, 1); // one working lane
});

/**
 * Tick-simulator tests for lib/liveness-alarm-sweep.js (LIN-3258).
 *
 * "Within one tick of onset" is not measurable from the existing fixtures, so
 * this harness steps the sweep on an injected clock over scripted dispatch
 * rows and records each tick's alarm state. It covers fixture 1 (silence),
 * fixture 2 (the verbatim LIN-3238 cycle capture), fixture 3 (combined), the
 * healthy-fleet zero-alarm shapes (4) and the hourly-resume no-flap case (8).
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { findWakeEvent } from '../../lib/dispatch-terminal.js';
import { LivenessAlarmStore } from '../../lib/liveness-alarm-store.js';
import { createLivenessAlarmSweepRun, sweepOneWorkspace } from '../../lib/liveness-alarm-sweep.js';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';

const TICK = 10 * 60 * 1000;
const URL_KEY = 'acme';

function loadFixture() {
  return JSON.parse(readFileSync(fileURLToPath(new URL('../fixtures/liveness/lin-3238-cycle.json', import.meta.url)), 'utf8'));
}

/** Lineage of a fixture row: follow the followUpTo chain to a known root. */
function lineageResolver(rows) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const memo = new Map();
  const lineageOf = (row) => {
    if (memo.has(row.id)) return memo.get(row.id);
    let result;
    if (!row.followUpTo || !byId.has(row.followUpTo)) result = row.rootItemId || row.id;
    else result = lineageOf(byId.get(row.followUpTo));
    memo.set(row.id, result);
    return result;
  };
  return lineageOf;
}

function lastVisibleWake(row, now) {
  const visible = (row.feedback || []).filter((e) => !Number.isFinite(Date.parse(e.timestamp)) || Date.parse(e.timestamp) <= now);
  return findWakeEvent(visible);
}

function terminalStatusFor(row, now) {
  const wake = lastVisibleWake(row, now);
  if (!wake) return null;
  if (wake.marker === 'done' || wake.marker === 'complete') return 'done';
  if (wake.marker === 'failed') return 'failed';
  if (wake.marker === 'aborted') return 'aborted';
  return null;
}

/**
 * A fake read-only dispatch store over the scripted rows. `listItems` returns
 * nothing (every scripted row is taken/archived); `listHistory` serves the
 * targeted by-lineage read the sweep performs.
 */
function makeDispatchStore(rows, nowRef) {
  const lineageOf = lineageResolver(rows);
  const withLineage = rows.map((r) => ({ ...r, lineageId: lineageOf(r) }));
  return {
    async listObservedWorkspaceKeys() { return [URL_KEY]; },
    async listItems(_urlKey, { rootItemId } = {}) {
      const now = nowRef.value;
      return withLineage.filter((r) => r.lineageId === rootItemId && Date.parse(r.dispatchedAt) <= now);
    },
    async listHistory(_urlKey, { rootItemId, since } = {}) {
      const now = nowRef.value;
      const items = withLineage.filter((r) => r.lineageId === rootItemId
        && Date.parse(r.dispatchedAt) <= now
        && (!since || Date.parse(r.dispatchedAt) >= Date.parse(since)));
      return { items, total: items.length };
    }
  };
}

/** Lean loops as `getLoopsForWorkspace` would return them for the tick. */
function makeGetLoops(rows, nowRef) {
  const lineageOf = lineageResolver(rows);
  return async () => {
    const now = nowRef.value;
    return rows
      .filter((r) => Date.parse(r.dispatchedAt) <= now)
      .map((r) => {
        const wake = lastVisibleWake(r, now);
        let lastActivityMs = null;
        for (const e of r.feedback || []) {
          const t = Date.parse(e.timestamp);
          if (!Number.isFinite(t) || t > now) continue;
          if (lastActivityMs == null || t > lastActivityMs) lastActivityMs = t;
        }
        return {
          loopId: r.id,
          lineageId: lineageOf(r),
          sessionId: r.sessionId || null,
          issueIdentifier: r.issueIdentifier || null,
          dispatchedAt: r.dispatchedAt,
          wakeMarker: wake ? wake.marker : null,
          terminalStatus: terminalStatusFor(r, now),
          historyStatus: 'taken',
          source: 'history',
          lineageLastActivityMs: lastActivityMs
        };
      });
  };
}

function makeHarness({ rows, lastSeen = () => null }) {
  const nowRef = { value: 0 };
  const dispatchStore = makeDispatchStore(rows, nowRef);
  const deps = {
    dispatchStore,
    dispatchTokenStore: {},
    agentStatusStore: {},
    alarmStore: null,
    getLoops: makeGetLoops(rows, nowRef),
    getLastSeen: async () => lastSeen(nowRef.value)
  };
  return { nowRef, deps };
}

describe('liveness-alarm-sweep: tick simulator', () => {
  const harness = createMangoTmpdir('liveness-sweep-');
  let db;
  let alarmStore;

  before(() => harness.connect());
  after(() => harness.close());
  beforeEach(() => {
    db = harness.freshDb();
    alarmStore = new LivenessAlarmStore({ collection: db.collection('liveness-alarms') });
  });

  test('fixture 2: the LIN-3238 cycle fires exactly one record within one tick of onset and clears on resolution', async () => {
    const rows = loadFixture().rows;
    const { nowRef, deps } = makeHarness({ rows, lastSeen: (t) => new Date(t - 60_000).toISOString() });
    deps.alarmStore = alarmStore;

    const ticks = [];
    for (let t = Date.parse('2026-10-02T15:00:00Z'); t <= Date.parse('2026-10-02T19:30:00Z'); t += TICK) {
      nowRef.value = t;
      await sweepOneWorkspace(URL_KEY, t, deps);
    }

    const all = await alarmStore.list(URL_KEY, { state: 'all' });
    assert.equal(all.length, 1, `exactly one D2 record across the run, got ${JSON.stringify(all.map((a) => a._id))}`);
    const [record] = all;
    assert.equal(record.rule, 'stopped-or-circular-wait');
    assert.equal(record.shape, 'cycle');
    assert.deepEqual(record.members, [
      '2550fd09-3567-4416-8eb5-b4d3750a285f',
      '8608873d-af0f-47fd-8dea-61c36f85d8e5'
    ].sort());

    // firedAt lands within one 10-minute tick of onset (15:12:57.700Z) — the
    // first tick at/after onset is 15:20.
    const firedAt = record.firedAt.toISOString();
    assert.ok(firedAt >= '2026-10-02T15:12:57.700Z' && firedAt <= '2026-10-02T15:22:57.700Z', `firedAt ${firedAt} outside one tick of onset`);
    assert.equal(record.startedAt.toISOString(), '2026-10-02T15:12:57.700Z');

    // Clear: after 18:53 the parent re-parks on a new target, so the cycle is
    // no longer detected from 19:00 and the record clears via the 2-tick
    // confirm at 19:10. (The immediate structural-clear on the FIRST evaluated
    // tick is pinned by the dedicated RC8 (M3/M6) silence-window test below.)
    assert.ok(record.clearedAt, 'the record cleared once the wait was answered');
    const clearedAt = record.clearedAt.toISOString();
    assert.ok(clearedAt >= '2026-10-02T18:53:23.877Z' && clearedAt <= '2026-10-02T19:10:00.000Z', `clearedAt ${clearedAt}`);
  });

  test('RC6: fixture 2 plus terminal and live lineages of the same ticket still fires exactly one cycle', async () => {
    const rows = loadFixture().rows.concat([
      {
        id: 'term-lin-3238',
        kind: 'implementation',
        status: 'done',
        sessionId: null,
        followUpTo: null,
        issueIdentifier: 'LIN-3238',
        dispatchedAt: '2026-10-02T11:00:00.000Z',
        feedback: [{ message: '[done] an earlier LIN-3238 session finished', timestamp: '2026-10-02T12:00:00.000Z' }]
      },
      {
        id: 'live-lin-3238',
        kind: 'implementation',
        status: 'taken',
        sessionId: null,
        followUpTo: null,
        issueIdentifier: 'LIN-3238',
        dispatchedAt: '2026-10-02T11:00:00.000Z',
        // A heartbeat every tick keeps this unrelated LIN-3238 lineage active
        // for the whole window: under the RC6 mutation it would cover the
        // cycle on every tick and no record would ever fire.
        feedback: [15, 25, 35, 45, 55].map((m) => ({ message: '[working] heartbeat', timestamp: `2026-10-02T15:${String(m).padStart(2, '0')}:00.000Z` }))
          .concat([5, 15, 25, 35, 45, 55].map((m) => ({ message: '[working] heartbeat', timestamp: `2026-10-02T16:${String(m).padStart(2, '0')}:00.000Z` })))
          .concat([5, 15, 25, 35, 45, 55].map((m) => ({ message: '[working] heartbeat', timestamp: `2026-10-02T17:${String(m).padStart(2, '0')}:00.000Z` })))
          .concat([5, 15, 25, 35, 45, 55].map((m) => ({ message: '[working] heartbeat', timestamp: `2026-10-02T18:${String(m).padStart(2, '0')}:00.000Z` })))
          .concat([5, 15, 25].map((m) => ({ message: '[working] heartbeat', timestamp: `2026-10-02T19:${String(m).padStart(2, '0')}:00.000Z` })))
      }
    ]);
    const { nowRef, deps } = makeHarness({ rows, lastSeen: (t) => new Date(t - 60_000).toISOString() });
    deps.alarmStore = alarmStore;

    for (let t = Date.parse('2026-10-02T15:00:00Z'); t <= Date.parse('2026-10-02T19:30:00Z'); t += TICK) {
      nowRef.value = t;
      await sweepOneWorkspace(URL_KEY, t, deps);
    }

    const all = await alarmStore.list(URL_KEY, { state: 'all' });
    const d2 = all.filter((a) => a.rule === 'stopped-or-circular-wait');
    assert.equal(d2.length, 1, `exactly one D2 record, got ${JSON.stringify(d2.map((a) => [a.shape, a.members]))}`);
    assert.equal(d2[0].shape, 'cycle');
    assert.deepEqual(d2[0].members, [
      '2550fd09-3567-4416-8eb5-b4d3750a285f',
      '8608873d-af0f-47fd-8dea-61c36f85d8e5'
    ].sort());
    assert.ok(!d2[0].members.includes('term-lin-3238'));
    assert.ok(!d2[0].members.includes('live-lin-3238'));
  });

  test('RC8 (M3/M6): a cycle resolving inside a silence window stays open until after the grace tick, then clears immediately', async () => {
    const parent = '11111111-1111-1111-1111-111111111111';
    const child = '22222222-2222-2222-2222-222222222222';
    const answer = '33333333-3333-3333-3333-333333333333';
    const rows = [
      {
        id: parent, kind: 'autopilot', status: 'taken', sessionId: null, followUpTo: null, issueIdentifier: 'LIN-1',
        dispatchedAt: '2026-10-02T10:00:00.000Z',
        feedback: [{ message: `[pending] waiting on worker dispatch ${child}`, timestamp: '2026-10-02T10:05:00.000Z' }]
      },
      {
        id: child, kind: 'close-out', status: 'taken', sessionId: parent, followUpTo: null, issueIdentifier: 'LIN-1',
        dispatchedAt: '2026-10-02T10:00:00.000Z',
        feedback: [{ message: '[pending] I am waiting on the orchestrator to dispatch a beat', timestamp: '2026-10-02T10:06:00.000Z' }]
      },
      {
        id: answer, kind: 'wake', status: 'done', sessionId: null, followUpTo: parent, issueIdentifier: 'LIN-1',
        dispatchedAt: '2026-10-02T10:45:00.000Z',
        // Rule (b): this must WAKE the parent's lineage (an answered wait is no
        // longer a wait). A `[done]` follow-up on the CHILD would instead read
        // as the child's terminal, which — because the parent's wait predates
        // it — is a genuine lost wake and would (correctly) open an orphan.
        feedback: []
      }
    ];
    const { nowRef, deps } = makeHarness({
      rows,
      lastSeen: (t) => new Date(t >= Date.parse('2026-10-02T11:00:00.000Z') ? '2026-10-02T11:00:00.000Z' : '2026-10-02T10:10:00.000Z').toISOString()
    });
    deps.alarmStore = alarmStore;

    const stateAtTick = async (iso) => {
      nowRef.value = Date.parse(iso);
      await sweepOneWorkspace(URL_KEY, nowRef.value, deps);
      const open = await alarmStore.list(URL_KEY, { state: 'open' });
      const d2 = open.filter((a) => a.rule === 'stopped-or-circular-wait');
      return d2[0] || null;
    };

    // Cycle opens at 10:10 (before silence).
    assert.ok(await stateAtTick('2026-10-02T10:10:00.000Z'), 'cycle open before silence');
    await stateAtTick('2026-10-02T10:30:00.000Z');
    // Silence fires from 10:40; the answer lands at 10:45 — D2 is suppressed,
    // so the open record must NOT be cleared inside the silence window.
    assert.ok(await stateAtTick('2026-10-02T10:50:00.000Z'), 'still open while silence fires');
    assert.ok(await stateAtTick('2026-10-02T11:00:00.000Z'), 'still open on the recovery-grace tick');
    // 11:10 is the first evaluated tick after the grace tick: clears immediately.
    const after = await stateAtTick('2026-10-02T11:10:00.000Z');
    assert.equal(after, null, 'cleared on the first evaluated tick after the grace tick');
  });

  test('RC8 (M4): a cycle forming during silence opens only after the grace tick', async () => {
    const parent = '44444444-4444-4444-4444-444444444444';
    const child = '55555555-5555-5555-5555-555555555555';
    const rows = [
      {
        id: parent, kind: 'autopilot', status: 'taken', sessionId: null, followUpTo: null, issueIdentifier: 'LIN-2',
        dispatchedAt: '2026-10-02T10:00:00.000Z',
        feedback: [{ message: `[pending] waiting on worker dispatch ${child}`, timestamp: '2026-10-02T10:35:00.000Z' }]
      },
      {
        id: child, kind: 'close-out', status: 'taken', sessionId: parent, followUpTo: null, issueIdentifier: 'LIN-2',
        dispatchedAt: '2026-10-02T10:00:00.000Z',
        feedback: [{ message: '[pending] I am waiting on the orchestrator to dispatch a beat', timestamp: '2026-10-02T10:36:00.000Z' }]
      }
    ];
    const { nowRef, deps } = makeHarness({
      rows,
      lastSeen: (t) => new Date(t >= Date.parse('2026-10-02T11:20:00.000Z') ? '2026-10-02T11:20:00.000Z' : '2026-10-02T10:00:00.000Z').toISOString()
    });
    deps.alarmStore = alarmStore;

    const tick = async (iso) => {
      nowRef.value = Date.parse(iso);
      await sweepOneWorkspace(URL_KEY, nowRef.value, deps);
      return (await alarmStore.list(URL_KEY, { state: 'open' })).filter((a) => a.rule === 'stopped-or-circular-wait').length;
    };

    for (let t = Date.parse('2026-10-02T10:00:00Z'); t <= Date.parse('2026-10-02T11:10:00Z'); t += TICK) {
      nowRef.value = t;
      await sweepOneWorkspace(URL_KEY, t, deps);
    }
    // 11:20 clears S and is the one-tick recovery grace: the cycle must not open.
    assert.equal(await tick('2026-10-02T11:20:00.000Z'), 0, 'no D2 on the grace tick');
    assert.equal(await tick('2026-10-02T11:30:00.000Z'), 1, 'D2 opens on the first evaluated tick after the grace');
  });

  test('fixture 1: silence fires one dispatcher-silent record in (onset, onset+tick] and clears when polling resumes', async () => {
    const rows = [{
      id: 'queued-1',
      kind: 'implementation',
      status: 'queued',
      sessionId: null,
      followUpTo: null,
      issueIdentifier: 'LIN-1',
      dispatchedAt: '2026-10-02T17:00:00.000Z',
      feedback: []
    }];
    const resumeAt = Date.parse('2026-10-02T18:51:15.000Z');
    const { nowRef, deps } = makeHarness({
      rows,
      lastSeen: (t) => new Date(t >= resumeAt ? resumeAt : Date.parse('2026-10-02T17:25:00.000Z')).toISOString()
    });
    deps.alarmStore = alarmStore;
    // No D2 waiter: the queued row's own feedback has no pending wake, so the
    // all-null loop is not a waiter. Override getLoops to return it as live.
    deps.getLoops = async () => rows.map((r) => ({
      loopId: r.id, lineageId: r.id, sessionId: null, issueIdentifier: r.issueIdentifier,
      dispatchedAt: r.dispatchedAt, wakeMarker: null, terminalStatus: null, historyStatus: null, source: 'live', lineageLastActivityMs: null
    }));

    for (let t = Date.parse('2026-10-02T17:20:00Z'); t <= Date.parse('2026-10-02T19:10:00Z'); t += TICK) {
      nowRef.value = t;
      await sweepOneWorkspace(URL_KEY, t, deps);
    }

    const all = await alarmStore.list(URL_KEY, { state: 'all' });
    assert.equal(all.length, 1, `exactly one S record, got ${JSON.stringify(all.map((a) => a._id))}`);
    const [record] = all;
    assert.equal(record.rule, 'dispatcher-silent');
    const firedAt = record.firedAt.toISOString();
    assert.ok(firedAt > '2026-10-02T17:45:00.000Z' && firedAt <= '2026-10-02T17:55:00.000Z', `firedAt ${firedAt}`);
    assert.equal(record.startedAt.toISOString(), '2026-10-02T17:25:00.000Z');
    assert.ok(record.clearedAt, 'cleared when polling resumed');
  });

  test('fixture 3: silence suppresses D2 (one S + one D2, no D2 duplicate, D2 not cleared by silence)', async () => {
    const rows = loadFixture().rows;
    // Silence 17:25–18:51 overlaid on the cycle rows.
    const resumeAt = Date.parse('2026-10-02T18:51:15.000Z');
    const { nowRef, deps } = makeHarness({
      rows,
      lastSeen: (t) => {
        if (t >= resumeAt) return new Date(resumeAt).toISOString();
        if (t >= Date.parse('2026-10-02T17:25:00.000Z')) return new Date('2026-10-02T17:25:00.000Z').toISOString();
        return new Date(t - 60_000).toISOString();
      }
    });
    deps.alarmStore = alarmStore;

    for (let t = Date.parse('2026-10-02T15:00:00Z'); t <= Date.parse('2026-10-02T19:30:00Z'); t += TICK) {
      nowRef.value = t;
      await sweepOneWorkspace(URL_KEY, t, deps);
    }

    const all = await alarmStore.list(URL_KEY, { state: 'all' });
    const s = all.filter((a) => a.rule === 'dispatcher-silent');
    const d2 = all.filter((a) => a.rule === 'stopped-or-circular-wait');
    assert.equal(s.length, 1, 'exactly one silence record');
    assert.equal(d2.length, 1, 'exactly one cycle record — silence opened no duplicate and cleared none');
  });

  test('fixture 4: a healthy busy fleet produces zero alarms', async () => {
    const parent = '11111111-0000-0000-0000-000000000001';
    const child = '22222222-0000-0000-0000-000000000002';
    const nowIso = '2026-10-02T10:10:00.000Z';
    const now = Date.parse(nowIso);
    const rows = [
      {
        id: parent, kind: 'autopilot', status: 'taken', sessionId: null, followUpTo: null, issueIdentifier: 'LIN-10',
        dispatchedAt: '2026-10-02T09:00:00.000Z',
        feedback: [
          { message: '[pending] waiting on the child', timestamp: '2026-10-02T09:50:00.000Z' },
          { message: '[working] heartbeat', timestamp: '2026-10-02T10:05:00.000Z' }
        ]
      },
      {
        id: child, kind: 'close-out', status: 'taken', sessionId: parent, followUpTo: null, issueIdentifier: 'LIN-10',
        dispatchedAt: '2026-10-02T09:00:00.000Z',
        feedback: [{ message: '[pending] waiting on the orchestrator to dispatch the next beat', timestamp: '2026-10-02T09:55:00.000Z' }]
      }
    ];
    const { nowRef, deps } = makeHarness({ rows, lastSeen: (t) => new Date(t - 60_000).toISOString() });
    deps.alarmStore = alarmStore;
    nowRef.value = now;
    await sweepOneWorkspace(URL_KEY, now, deps);
    assert.equal((await alarmStore.list(URL_KEY, { state: 'all' })).length, 0);
  });

  test('fixture 8: a tick landing inside the hourly resume misses once but does not clear the open record (2-tick clear)', async () => {
    const rows = loadFixture().rows;
    const { nowRef, deps } = makeHarness({ rows, lastSeen: (t) => new Date(t - 60_000).toISOString() });
    deps.alarmStore = alarmStore;

    nowRef.value = Date.parse('2026-10-02T15:20:00.000Z');
    await sweepOneWorkspace(URL_KEY, nowRef.value, deps);
    assert.equal((await alarmStore.list(URL_KEY, { state: 'open' })).length, 1, 'cycle is open at 15:20');

    // Inject a tick at 16:13:50, inside the close-out's ~16 s resume window:
    // the close-out shows a fresh [working] and reads active, covering the
    // chain for exactly this tick.
    nowRef.value = Date.parse('2026-10-02T16:13:50.000Z');
    await sweepOneWorkspace(URL_KEY, nowRef.value, deps);
    let open = await alarmStore.list(URL_KEY, { state: 'open' });
    assert.equal(open.length, 1, 'one missed tick must not clear the record');
    assert.equal(open[0].missCount, 1);
    assert.equal(open[0].clearedAt, null);

    // The next in-window tick confirms it again and resets the miss streak.
    nowRef.value = Date.parse('2026-10-02T16:20:00.000Z');
    await sweepOneWorkspace(URL_KEY, nowRef.value, deps);
    open = await alarmStore.list(URL_KEY, { state: 'open' });
    assert.equal(open.length, 1);
    assert.equal(open[0].missCount, 0);
  });

  test('the registered run closure walks the roster and advances the alarm store', async () => {
    const rows = [];
    const { nowRef, deps } = makeHarness({ rows, lastSeen: () => null });
    deps.alarmStore = alarmStore;
    deps.intervalMs = TICK;
    const run = createLivenessAlarmSweepRun({ ...deps, now: () => nowRef.value });
    nowRef.value = Date.parse('2026-10-02T15:20:00.000Z');
    await run();
    // No rows ⇒ no live items and no open alarms ⇒ roster still contains acme
    // (observed) but the workspace is skipped; the point is that the closure
    // runs without throwing and leaves the store empty.
    assert.equal((await alarmStore.list(URL_KEY, { state: 'all' })).length, 0);
  });

  test('RC9: a feeder lineage joining an open cycle does not re-key the incident (one record, unchanged startedAt)', async () => {
    const feeder = 'f0f0f0f0-0000-0000-0000-000000000001';
    const parent = '11111111-0000-0000-0000-000000000002';
    const child = '22222222-0000-0000-0000-000000000003';
    // Feeder FIRST in the row order, so an unfixed sweep walks it before the
    // cycle members once it becomes a waiter — the mutation witness.
    const rows = [
      {
        id: feeder, kind: 'implementation', status: 'taken', sessionId: null, followUpTo: null, issueIdentifier: 'LIN-9',
        dispatchedAt: '2026-10-02T10:00:00.000Z',
        // Not visible at 10:20 (future timestamp); a waiter only from 10:30.
        feedback: [{ message: `[pending] waiting on worker dispatch ${parent}`, timestamp: '2026-10-02T10:25:00.000Z' }]
      },
      {
        id: parent, kind: 'autopilot', status: 'taken', sessionId: null, followUpTo: null, issueIdentifier: 'LIN-9',
        dispatchedAt: '2026-10-02T10:00:00.000Z',
        feedback: [{ message: `[pending] waiting on worker dispatch ${child}`, timestamp: '2026-10-02T10:05:00.000Z' }]
      },
      {
        id: child, kind: 'close-out', status: 'taken', sessionId: parent, followUpTo: null, issueIdentifier: 'LIN-9',
        dispatchedAt: '2026-10-02T10:00:00.000Z',
        feedback: [{ message: '[pending] I am waiting on the orchestrator to dispatch a beat', timestamp: '2026-10-02T10:06:00.000Z' }]
      }
    ];
    const { nowRef, deps } = makeHarness({ rows, lastSeen: (t) => new Date(t - 60_000).toISOString() });
    deps.alarmStore = alarmStore;
    const d2All = () => alarmStore.list(URL_KEY, { state: 'all' }).then((a) => a.filter((x) => x.rule === 'stopped-or-circular-wait'));

    nowRef.value = Date.parse('2026-10-02T10:20:00.000Z');
    await sweepOneWorkspace(URL_KEY, nowRef.value, deps);
    let d2 = await d2All();
    assert.equal(d2.length, 1, `cycle opens before the feeder joins, got ${JSON.stringify(d2.map((x) => x._id))}`);
    const openedId = d2[0]._id;
    assert.deepEqual(d2[0].members, [parent, child].sort());
    assert.equal(d2[0].startedAt.toISOString(), '2026-10-02T10:06:00.000Z');

    // The feeder now joins the open cycle: the core is unchanged, so the ONE
    // existing record must be confirmed, not duplicated or reopened.
    nowRef.value = Date.parse('2026-10-02T10:30:00.000Z');
    await sweepOneWorkspace(URL_KEY, nowRef.value, deps);
    d2 = await d2All();
    assert.equal(d2.length, 1, `feeder join must not mint a second record, got ${JSON.stringify(d2.map((x) => x._id))}`);
    assert.equal(d2[0]._id, openedId, 'incident identity is the cycle core, not the feeder-inclusive walk');
    assert.equal(d2[0].startedAt.toISOString(), '2026-10-02T10:06:00.000Z', 'startedAt must not reopen on a feeder join');
    assert.equal(d2[0].clearedAt, null);
  });

  test('RC9: a feeder answered while the cycle persists keeps one record and the original startedAt', async () => {
    const feeder = 'f0f0f0f0-0000-0000-0000-000000000010';
    const feederWake = 'f0f0f0f0-0000-0000-0000-000000000011';
    const parent = '11111111-0000-0000-0000-000000000012';
    const child = '22222222-0000-0000-0000-000000000013';
    const rows = [
      {
        id: feeder, kind: 'implementation', status: 'taken', sessionId: null, followUpTo: null, issueIdentifier: 'LIN-9',
        dispatchedAt: '2026-10-02T10:00:00.000Z',
        feedback: [{ message: `[pending] waiting on worker dispatch ${parent}`, timestamp: '2026-10-02T10:04:00.000Z' }]
      },
      {
        id: feederWake, kind: 'wake', status: 'done', sessionId: null, followUpTo: feeder, issueIdentifier: 'LIN-9',
        dispatchedAt: '2026-10-02T10:25:00.000Z', feedback: []
      },
      {
        id: parent, kind: 'autopilot', status: 'taken', sessionId: null, followUpTo: null, issueIdentifier: 'LIN-9',
        dispatchedAt: '2026-10-02T10:00:00.000Z',
        feedback: [{ message: `[pending] waiting on worker dispatch ${child}`, timestamp: '2026-10-02T10:05:00.000Z' }]
      },
      {
        id: child, kind: 'close-out', status: 'taken', sessionId: parent, followUpTo: null, issueIdentifier: 'LIN-9',
        dispatchedAt: '2026-10-02T10:00:00.000Z',
        feedback: [{ message: '[pending] I am waiting on the orchestrator to dispatch a beat', timestamp: '2026-10-02T10:06:00.000Z' }]
      }
    ];
    const { nowRef, deps } = makeHarness({ rows, lastSeen: (t) => new Date(t - 60_000).toISOString() });
    deps.alarmStore = alarmStore;
    const d2All = () => alarmStore.list(URL_KEY, { state: 'all' }).then((a) => a.filter((x) => x.rule === 'stopped-or-circular-wait'));

    nowRef.value = Date.parse('2026-10-02T10:20:00.000Z');
    await sweepOneWorkspace(URL_KEY, nowRef.value, deps);
    let d2 = await d2All();
    assert.equal(d2.length, 1, `cycle opens with the feeder waiting, got ${JSON.stringify(d2.map((x) => x._id))}`);
    const openedId = d2[0]._id;
    assert.deepEqual(d2[0].members, [parent, child].sort());
    assert.equal(d2[0].startedAt.toISOString(), '2026-10-02T10:06:00.000Z');

    // The feeder is answered at 10:25 while the P↔C cycle persists. The record
    // must stay the same ONE record with its original `startedAt`.
    nowRef.value = Date.parse('2026-10-02T10:30:00.000Z');
    await sweepOneWorkspace(URL_KEY, nowRef.value, deps);
    d2 = await d2All();
    assert.equal(d2.length, 1, `feeder resolution must not mint a second record, got ${JSON.stringify(d2.map((x) => x._id))}`);
    assert.equal(d2[0]._id, openedId);
    assert.equal(d2[0].startedAt.toISOString(), '2026-10-02T10:06:00.000Z');
    assert.equal(d2[0].clearedAt, null);
  });

  test('RC11: a second waiter joining one stopped leaf confirms the same orphan record', async () => {
    const a = 'aaaaaaaa-0000-0000-0000-000000000101';
    const b = 'bbbbbbbb-0000-0000-0000-000000000102';
    const c = 'cccccccc-0000-0000-0000-000000000103';
    const rows = [
      {
        id: a, kind: 'implementation', status: 'taken', sessionId: null, followUpTo: null, issueIdentifier: 'LIN-11',
        dispatchedAt: '2026-10-02T09:00:00.000Z',
        feedback: [{ message: `[pending] waiting on the dead worker dispatch ${c}`, timestamp: '2026-10-02T10:05:00.000Z' }]
      },
      {
        id: b, kind: 'implementation', status: 'taken', sessionId: null, followUpTo: null, issueIdentifier: 'LIN-11',
        dispatchedAt: '2026-10-02T09:00:00.000Z',
        // Not visible at the first tick (10:30): B becomes a waiter at 10:40.
        feedback: [{ message: `[pending] waiting on the dead worker dispatch ${c}`, timestamp: '2026-10-02T10:32:00.000Z' }]
      },
      {
        id: c, kind: 'implementation', status: 'taken', sessionId: null, followUpTo: null, issueIdentifier: 'LIN-12',
        dispatchedAt: '2026-10-02T09:00:00.000Z',
        feedback: [{ message: '[working] last moved long ago', timestamp: '2026-10-02T09:10:00.000Z' }]
      }
    ];
    const { nowRef, deps } = makeHarness({ rows, lastSeen: (t) => new Date(t - 60_000).toISOString() });
    deps.alarmStore = alarmStore;
    const d2All = () => alarmStore.list(URL_KEY, { state: 'all' }).then((a) => a.filter((x) => x.rule === 'stopped-or-circular-wait'));

    nowRef.value = Date.parse('2026-10-02T10:30:00.000Z');
    await sweepOneWorkspace(URL_KEY, nowRef.value, deps);
    let d2 = await d2All();
    assert.equal(d2.length, 1, `one orphan opens on the leaf, got ${JSON.stringify(d2.map((x) => x._id))}`);
    const openedId = d2[0]._id;
    assert.equal(d2[0].startedAt.toISOString(), '2026-10-02T10:05:00.000Z');

    nowRef.value = Date.parse('2026-10-02T10:40:00.000Z');
    await sweepOneWorkspace(URL_KEY, nowRef.value, deps);
    d2 = await d2All();
    assert.equal(d2.length, 1, `a second waiter must not mint a second orphan, got ${JSON.stringify(d2.map((x) => x._id))}`);
    assert.equal(d2[0]._id, openedId, 'the orphan key is the stopped leaf, not the waiter walk');
    assert.equal(d2[0].startedAt.toISOString(), '2026-10-02T10:05:00.000Z', 'onset is the incident onset, not the new waiter');
    assert.ok(d2[0].waiters.includes(a) && d2[0].waiters.includes(b), 'both waiters are recorded on the one record');
  });

  test('RC11: a feeder joining an open orphan chain confirms the same record and grows feeders', async () => {
    const f = 'ffffffff-0000-0000-0000-000000000111';
    const a = 'aaaaaaaa-0000-0000-0000-000000000112';
    const b = 'bbbbbbbb-0000-0000-0000-000000000113';
    const c = 'cccccccc-0000-0000-0000-000000000114';
    const rows = [
      {
        id: f, kind: 'implementation', status: 'taken', sessionId: null, followUpTo: null, issueIdentifier: 'LIN-13',
        dispatchedAt: '2026-10-02T09:00:00.000Z',
        feedback: [{ message: `[pending] waiting on worker dispatch ${a}`, timestamp: '2026-10-02T10:38:00.000Z' }]
      },
      {
        id: a, kind: 'implementation', status: 'taken', sessionId: null, followUpTo: null, issueIdentifier: 'LIN-13',
        dispatchedAt: '2026-10-02T09:00:00.000Z',
        feedback: [{ message: `[pending] waiting on worker dispatch ${b}`, timestamp: '2026-10-02T10:05:00.000Z' }]
      },
      {
        id: b, kind: 'implementation', status: 'taken', sessionId: null, followUpTo: null, issueIdentifier: 'LIN-13',
        dispatchedAt: '2026-10-02T09:00:00.000Z',
        feedback: [{ message: `[pending] waiting on the dead worker dispatch ${c}`, timestamp: '2026-10-02T09:55:00.000Z' }]
      },
      {
        id: c, kind: 'implementation', status: 'taken', sessionId: null, followUpTo: null, issueIdentifier: 'LIN-14',
        dispatchedAt: '2026-10-02T09:00:00.000Z',
        feedback: [{ message: '[working] last moved long ago', timestamp: '2026-10-02T09:10:00.000Z' }]
      }
    ];
    const { nowRef, deps } = makeHarness({ rows, lastSeen: (t) => new Date(t - 60_000).toISOString() });
    deps.alarmStore = alarmStore;
    const d2All = () => alarmStore.list(URL_KEY, { state: 'all' }).then((a) => a.filter((x) => x.rule === 'stopped-or-circular-wait'));

    nowRef.value = Date.parse('2026-10-02T10:30:00.000Z');
    await sweepOneWorkspace(URL_KEY, nowRef.value, deps);
    let d2 = await d2All();
    assert.equal(d2.length, 1);
    const openedId = d2[0]._id;
    assert.deepEqual(d2[0].feeders, [a].sort());

    nowRef.value = Date.parse('2026-10-02T10:40:00.000Z');
    await sweepOneWorkspace(URL_KEY, nowRef.value, deps);
    d2 = await d2All();
    assert.equal(d2.length, 1, `feeder join must not mint a second record, got ${JSON.stringify(d2.map((x) => x._id))}`);
    assert.equal(d2[0]._id, openedId);
    assert.equal(d2[0].startedAt.toISOString(), '2026-10-02T09:55:00.000Z', 'onset is the direct waiter, not the feeder');
    assert.ok(d2[0].feeders.includes(f), 'the new feeder is merged in while the incident persists');
  });

  test('an orphan whose leaf goes terminal keeps its record (leaf terminal is not a clear)', async () => {
    const a = 'aaaaaaaa-0000-0000-0000-000000000121';
    const c = 'cccccccc-0000-0000-0000-000000000123';
    const rows = [
      {
        id: a, kind: 'implementation', status: 'taken', sessionId: null, followUpTo: null, issueIdentifier: 'LIN-15',
        dispatchedAt: '2026-10-02T09:00:00.000Z',
        feedback: [{ message: `[pending] waiting on the dead worker dispatch ${c}`, timestamp: '2026-10-02T09:55:00.000Z' }]
      },
      {
        id: c, kind: 'implementation', status: 'taken', sessionId: null, followUpTo: null, issueIdentifier: 'LIN-16',
        dispatchedAt: '2026-10-02T09:00:00.000Z',
        feedback: [
          { message: '[working] last moved long ago', timestamp: '2026-10-02T09:10:00.000Z' },
          // The leaf finishes at 10:35, after the wait began.
          { message: '[done] the leaf finished', timestamp: '2026-10-02T10:35:00.000Z' }
        ]
      }
    ];
    const { nowRef, deps } = makeHarness({ rows, lastSeen: (t) => new Date(t - 60_000).toISOString() });
    deps.alarmStore = alarmStore;
    const d2All = () => alarmStore.list(URL_KEY, { state: 'all' }).then((a) => a.filter((x) => x.rule === 'stopped-or-circular-wait'));

    nowRef.value = Date.parse('2026-10-02T10:30:00.000Z');
    await sweepOneWorkspace(URL_KEY, nowRef.value, deps);
    let d2 = await d2All();
    assert.equal(d2.length, 1);
    const openedId = d2[0]._id;

    nowRef.value = Date.parse('2026-10-02T10:40:00.000Z');
    await sweepOneWorkspace(URL_KEY, nowRef.value, deps);
    d2 = await d2All();
    assert.equal(d2.length, 1, `the leaf going terminal must not mint a second record, got ${JSON.stringify(d2.map((x) => x._id))}`);
    assert.equal(d2[0]._id, openedId);
    assert.equal(d2[0].clearedAt, null, 'a terminal leaf is the lost-wake case, not a clear');
    // Rule (b): the terminal leaf is still a dead leaf (the wait began before it
    // terminated), so the incident is RE-DETECTED every tick and confirmed —
    // never missed. Extend past CLEAR_CONFIRM_TICKS to prove it never clears.
    assert.equal(d2[0].missCount, 0, 'a re-detected terminal-leaf orphan is confirmed, not missed');

    for (const iso of ['2026-10-02T10:50:00.000Z', '2026-10-02T11:00:00.000Z']) {
      nowRef.value = Date.parse(iso);
      await sweepOneWorkspace(URL_KEY, nowRef.value, deps);
      d2 = await d2All();
      assert.equal(d2.length, 1, `still one record at ${iso}`);
      assert.equal(d2[0]._id, openedId, `same record at ${iso}`);
      assert.equal(d2[0].clearedAt, null, `still open past CLEAR_CONFIRM_TICKS at ${iso}`);
      assert.equal(d2[0].missCount, 0, `never missed at ${iso}`);
    }
  });

  test('N14 (M5): an orphan whose dead leaf is REVIVED clears immediately on that tick', async () => {
    const a = 'aaaaaaaa-0000-0000-0000-000000000151';
    const c = 'cccccccc-0000-0000-0000-000000000153';
    const revive = 'cccccccc-0000-0000-0000-000000000154';
    const rows = [
      {
        id: a, kind: 'implementation', status: 'taken', sessionId: null, followUpTo: null, issueIdentifier: 'LIN-21',
        dispatchedAt: '2026-10-02T09:00:00.000Z',
        feedback: [{ message: `[pending] waiting on the dead worker dispatch ${c}`, timestamp: '2026-10-02T09:55:00.000Z' }]
      },
      {
        id: c, kind: 'implementation', status: 'taken', sessionId: null, followUpTo: null, issueIdentifier: 'LIN-22',
        dispatchedAt: '2026-10-02T09:00:00.000Z',
        feedback: [{ message: '[working] last moved long ago', timestamp: '2026-10-02T09:10:00.000Z' }]
      },
      {
        // A new row on the leaf's lineage, dispatched after `startedAt` and with
        // a fresh heartbeat, so the leaf reads active: the incident is no longer
        // detected, and the revived leaf clears it immediately rather than
        // accruing a miss. Removing the leaf-revived clear leaves missCount 1.
        id: revive, kind: 'implementation', status: 'taken', sessionId: null, followUpTo: c, issueIdentifier: 'LIN-22',
        dispatchedAt: '2026-10-02T10:35:00.000Z',
        feedback: [{ message: '[working] revived heartbeat', timestamp: '2026-10-02T10:35:00.000Z' }]
      }
    ];
    const { nowRef, deps } = makeHarness({ rows, lastSeen: (t) => new Date(t - 60_000).toISOString() });
    deps.alarmStore = alarmStore;
    const d2All = () => alarmStore.list(URL_KEY, { state: 'all' }).then((a) => a.filter((x) => x.rule === 'stopped-or-circular-wait'));

    nowRef.value = Date.parse('2026-10-02T10:30:00.000Z');
    await sweepOneWorkspace(URL_KEY, nowRef.value, deps);
    let d2 = await d2All();
    assert.equal(d2.length, 1, `orphan opens on the stopped leaf, got ${JSON.stringify(d2.map((x) => x._id))}`);
    const openedId = d2[0]._id;
    assert.equal(d2[0].clearedAt, null);

    nowRef.value = Date.parse('2026-10-02T10:40:00.000Z');
    await sweepOneWorkspace(URL_KEY, nowRef.value, deps);
    d2 = await d2All();
    assert.equal(d2.length, 1);
    assert.equal(d2[0]._id, openedId);
    assert.ok(d2[0].clearedAt, 'a revived leaf clears the orphan immediately, not after 2 misses');
  });

  test('every recorded waiter answered clears the orphan on the tick (the answered waiter is not lean-selected)', async () => {
    const a = 'aaaaaaaa-0000-0000-0000-000000000131';
    const answer = 'aaaaaaaa-0000-0000-0000-000000000132';
    const c = 'cccccccc-0000-0000-0000-000000000133';
    const rows = [
      {
        id: a, kind: 'implementation', status: 'taken', sessionId: null, followUpTo: null, issueIdentifier: 'LIN-17',
        dispatchedAt: '2026-10-02T09:00:00.000Z',
        feedback: [{ message: `[pending] waiting on the dead worker dispatch ${c}`, timestamp: '2026-10-02T09:55:00.000Z' }]
      },
      {
        id: answer, kind: 'implementation', status: 'done', sessionId: null, followUpTo: a, issueIdentifier: 'LIN-17',
        dispatchedAt: '2026-10-02T10:20:00.000Z', feedback: []
      },
      {
        id: c, kind: 'implementation', status: 'taken', sessionId: null, followUpTo: null, issueIdentifier: 'LIN-18',
        dispatchedAt: '2026-10-02T09:00:00.000Z',
        feedback: [{ message: '[working] last moved long ago', timestamp: '2026-10-02T09:10:00.000Z' }]
      }
    ];
    const { nowRef, deps } = makeHarness({ rows, lastSeen: (t) => new Date(t - 60_000).toISOString() });
    deps.alarmStore = alarmStore;
    const d2All = () => alarmStore.list(URL_KEY, { state: 'all' }).then((a) => a.filter((x) => x.rule === 'stopped-or-circular-wait'));

    nowRef.value = Date.parse('2026-10-02T10:10:00.000Z');
    await sweepOneWorkspace(URL_KEY, nowRef.value, deps);
    assert.equal((await d2All()).length, 1, 'orphan opens while the waiter is still parked');

    // At 10:30 the answer row is the lineage's latest loop, so A is not in the
    // lean waiter set; it is reached only through the open record's stored
    // `waiters`. Its answered state must clear the record on this tick.
    nowRef.value = Date.parse('2026-10-02T10:30:00.000Z');
    await sweepOneWorkspace(URL_KEY, nowRef.value, deps);
    const d2 = await d2All();
    assert.equal(d2.length, 1);
    assert.ok(d2[0].clearedAt, 'the answered waiter clears the record immediately');
  });

  test('a cleared incident that recurs reopens the same record with its original onset', async () => {
    const a = 'aaaaaaaa-0000-0000-0000-000000000141';
    const c = 'cccccccc-0000-0000-0000-000000000143';
    const rows = [
      {
        id: a, kind: 'implementation', status: 'taken', sessionId: null, followUpTo: null, issueIdentifier: 'LIN-19',
        dispatchedAt: '2026-10-02T09:00:00.000Z',
        feedback: [{ message: `[pending] waiting on the dead worker dispatch ${c}`, timestamp: '2026-10-02T09:55:00.000Z' }]
      },
      {
        id: c, kind: 'implementation', status: 'taken', sessionId: null, followUpTo: null, issueIdentifier: 'LIN-20',
        dispatchedAt: '2026-10-02T09:00:00.000Z',
        feedback: [{ message: '[working] last moved long ago', timestamp: '2026-10-02T09:10:00.000Z' }]
      }
    ];
    const { nowRef, deps } = makeHarness({ rows, lastSeen: (t) => new Date(t - 60_000).toISOString() });
    deps.alarmStore = alarmStore;

    nowRef.value = Date.parse('2026-10-02T10:30:00.000Z');
    await sweepOneWorkspace(URL_KEY, nowRef.value, deps);
    let d2 = await alarmStore.list(URL_KEY, { state: 'all' }).then((a) => a.filter((x) => x.rule === 'stopped-or-circular-wait'));
    assert.equal(d2.length, 1);
    const openedId = d2[0]._id;
    const startedAt = d2[0].startedAt.toISOString();

    // A clear, then the same cause detected again: one durable row, reopened in
    // place, with its FIRST onset (N13's reopen half).
    await alarmStore.clear(openedId, { clearedAt: new Date('2026-10-02T10:35:00.000Z') });
    nowRef.value = Date.parse('2026-10-02T10:40:00.000Z');
    await sweepOneWorkspace(URL_KEY, nowRef.value, deps);
    d2 = await alarmStore.list(URL_KEY, { state: 'all' }).then((a) => a.filter((x) => x.rule === 'stopped-or-circular-wait'));
    assert.equal(d2.length, 1);
    assert.equal(d2[0]._id, openedId);
    assert.equal(d2[0].clearedAt, null);
    assert.equal(d2[0].startedAt.toISOString(), startedAt, 'reopen leaves the first onset unchanged');
    assert.equal(d2[0].reopenCount, 1);
  });
});

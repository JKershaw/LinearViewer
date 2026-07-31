/**
 * Unit coverage for the Live Console swimlane timeline data layer
 * (LIN-1742, Phase 1 of LIN-1720): `buildTimeline` derives a flat, last-24h
 * run list from the same loops the feed already loads, `packTimelineRows`
 * packs that list into non-overlapping display rows grouped by session
 * lineage. Both are pure and `now`-injected, same discipline as the rest of
 * lib/live-console.js.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildTimeline,
  packTimelineRows,
  loopLastActivityMs,
  isFreshlyActive,
  buildConsoleFeed,
  TIMELINE_RUN_CAP,
} from '../../lib/live-console.js';
import {
  computeTimelineZoom,
  computeTimelinePan,
  TIMELINE_MIN_SPAN_MS,
  TIMELINE_MAX_SPAN_MS,
} from '../../lib/timeline-zoom.js';

const NOW = Date.parse('2026-07-31T12:00:00.000Z');
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// A lean loop record, shaped like getLoopsForWorkspace(lean) output after the
// route folds in { workspaceUrlKey, workspaceName }.
function loop(over = {}) {
  return {
    loopId: 'l1',
    issueIdentifier: 'LIN-1',
    agentState: 'running',
    dispatchedAt: new Date(NOW - HOUR).toISOString(),
    ...over,
  };
}

// A buildTimeline output row, for packTimelineRows tests that don't need to
// go through buildTimeline itself.
function run(over = {}) {
  return {
    id: 'r1',
    issueIdentifier: 'LIN-1',
    kind: 'implementation',
    promptName: 'implementation',
    outcomeKind: 'done',
    start: NOW - HOUR,
    end: NOW - 30 * MIN,
    stillRunning: false,
    clippedStart: false,
    groupKey: 'r1',
    followUpTo: null,
    workspaceUrlKey: 'acme',
    ...over,
  };
}

// ─── loopLastActivityMs ───────────────────────────────────────────────────────

test('loopLastActivityMs takes the latest of dispatch/agent/heartbeat/lineage signals', () => {
  const l = loop({
    dispatchedAt: new Date(NOW - 3 * HOUR).toISOString(),
    agentTimestamp: new Date(NOW - 2 * HOUR).toISOString(),
    telemetry: { metrics: [{ timestamp: new Date(NOW - HOUR).toISOString() }] },
    lineageLastActivityMs: NOW - 30 * MIN,
  });
  assert.equal(loopLastActivityMs(l), NOW - 30 * MIN);
});

test('loopLastActivityMs is 0 for a loop with no timing signals at all', () => {
  assert.equal(loopLastActivityMs({}), 0);
});

// ─── isFreshlyActive ──────────────────────────────────────────────────────────

test('isFreshlyActive requires BOTH isLoopActive and recent activity', () => {
  const fresh = loop({ dispatchedAt: new Date(NOW - 5 * MIN).toISOString() });
  assert.equal(isFreshlyActive(fresh, NOW, HOUR), true);

  const stale = loop({ dispatchedAt: new Date(NOW - 2 * HOUR).toISOString() });
  assert.equal(isFreshlyActive(stale, NOW, HOUR), false);

  // isLoopActive alone has no time component — a TERMINAL loop is never fresh
  // regardless of how recent its activity was.
  const terminal = loop({ terminalStatus: 'completed', dispatchedAt: new Date(NOW - MIN).toISOString() });
  assert.equal(isFreshlyActive(terminal, NOW, HOUR), false);
});

// ─── buildTimeline: window-overlap filter + M5 clip ──────────────────────────

test('buildTimeline excludes a run whose activity predates the 24h window entirely', () => {
  // The F1 pair: a 30-day-old `taken`-only row (no agent-status match,
  // agentState:'running' by the untimed default) must never surface as a
  // live full-width bar.
  const stale = loop({ loopId: 'stale', dispatchedAt: new Date(NOW - 30 * DAY).toISOString() });
  const { runs, totalInWindow } = buildTimeline([stale], { now: NOW });
  assert.deepEqual(runs, []);
  assert.equal(totalInWindow, 0);
});

test('F1 pair: the SAME shape with last activity 5 minutes ago renders open-ended (end: null)', () => {
  const fresh = loop({ loopId: 'fresh', dispatchedAt: new Date(NOW - 5 * MIN).toISOString() });
  const { runs } = buildTimeline([fresh], { now: NOW });
  assert.equal(runs.length, 1);
  assert.equal(runs[0].end, null);
  assert.equal(runs[0].stillRunning, true);
});

test('M5: a run whose dispatch predates the window is clipped to the left edge, never dropped', () => {
  const longRunning = loop({
    loopId: 'long',
    dispatchedAt: new Date(NOW - 30 * HOUR).toISOString(),
    telemetry: { metrics: [{ timestamp: new Date(NOW - 2 * MIN).toISOString() }] }, // fresh heartbeat
  });
  const { runs } = buildTimeline([longRunning], { now: NOW });
  assert.equal(runs.length, 1);
  assert.equal(runs[0].clippedStart, true);
  assert.equal(runs[0].start, NOW - 24 * HOUR);
});

test('a run dispatched within the window is not clipped', () => {
  const r = loop({ dispatchedAt: new Date(NOW - HOUR).toISOString() });
  const { runs } = buildTimeline([r], { now: NOW });
  assert.equal(runs[0].clippedStart, false);
  assert.equal(runs[0].start, NOW - HOUR);
});

// ─── buildTimeline: bar end (terminal vs claim-time vs stale) ────────────────

test('a terminal run ends at terminalCompletedAt, never at resolvedAt/takenAt (the claim time)', () => {
  const r = loop({
    terminalStatus: 'completed',
    terminalCompletedAt: new Date(NOW - 10 * MIN).toISOString(),
    resolvedAt: new Date(NOW - 50 * MIN).toISOString(),
    takenAt: new Date(NOW - 50 * MIN).toISOString(),
    dispatchedAt: new Date(NOW - HOUR).toISOString(),
  });
  const { runs } = buildTimeline([r], { now: NOW });
  assert.equal(runs[0].end, NOW - 10 * MIN);
  assert.equal(runs[0].stillRunning, false);
});

test('a stale (not freshly active) running loop ends at its own last activity, stillRunning: "unknown"', () => {
  const r = loop({
    dispatchedAt: new Date(NOW - 3 * HOUR).toISOString(),
    telemetry: { metrics: [{ timestamp: new Date(NOW - 90 * MIN).toISOString() }] }, // beyond a 1h staleMs
  });
  const { runs } = buildTimeline([r], { now: NOW, staleMs: HOUR });
  assert.equal(runs[0].end, NOW - 90 * MIN);
  assert.equal(runs[0].stillRunning, 'unknown');
});

// ─── outcomeKind ──────────────────────────────────────────────────────────────

test('outcomeKind is derived from terminalStatus when present, else "working"', () => {
  const done = loop({ terminalStatus: 'completed', terminalCompletedAt: new Date(NOW - MIN).toISOString() });
  const failed = loop({ loopId: 'f', terminalStatus: 'failed', terminalCompletedAt: new Date(NOW - MIN).toISOString() });
  const running = loop({ loopId: 'r', dispatchedAt: new Date(NOW - MIN).toISOString() });
  const { runs } = buildTimeline([done, failed, running], { now: NOW });
  const byId = Object.fromEntries(runs.map(x => [x.id, x.outcomeKind]));
  assert.equal(byId.l1, 'done');
  assert.equal(byId.f, 'failed');
  assert.equal(byId.r, 'working');
});

// ─── no issueIdentifier / tolerant input ──────────────────────────────────────

test('buildTimeline drops rows with no issueIdentifier and is tolerant of junk input', () => {
  const noIssue = loop({ issueIdentifier: null });
  const { runs } = buildTimeline([noIssue, null, undefined], { now: NOW });
  assert.deepEqual(runs, []);
  assert.deepEqual(buildTimeline(null, { now: NOW }), { runs: [], truncated: false, totalInWindow: 0 });
  assert.deepEqual(buildTimeline([loop()], {}), { runs: [], truncated: false, totalInWindow: 0 }); // no `now`
});

// ─── truncation disclosure (LIN-1494 disclose-don't-drop) ────────────────────

test('buildTimeline caps at TIMELINE_RUN_CAP and discloses truncation', () => {
  const loops = Array.from({ length: TIMELINE_RUN_CAP + 10 }, (_, i) => loop({
    loopId: `l${i}`,
    dispatchedAt: new Date(NOW - (i + 1) * MIN).toISOString(),
  }));
  const { runs, truncated, totalInWindow } = buildTimeline(loops, { now: NOW });
  assert.equal(totalInWindow, TIMELINE_RUN_CAP + 10);
  assert.equal(truncated, true);
  assert.equal(runs.length, TIMELINE_RUN_CAP);
  // Kept the MOST RECENT (sorted newest-first) — l0 was dispatched 1 minute ago.
  assert.equal(runs[0].id, 'l0');
});

test('buildTimeline does not truncate when at or under the cap', () => {
  const { truncated } = buildTimeline([loop()], { now: NOW });
  assert.equal(truncated, false);
});

// ─── groupKey precedence ──────────────────────────────────────────────────────

test('groupKey precedence: sessionGroupId > sessionId > lineageId > loopId (singleton)', () => {
  const a = loop({ loopId: 'a', sessionGroupId: 'sg', sessionId: 'sess', lineageId: 'lin' });
  const b = loop({ loopId: 'b', sessionId: 'sess', lineageId: 'lin' });
  const c = loop({ loopId: 'c', lineageId: 'lin' });
  const d = loop({ loopId: 'd' });
  const { runs } = buildTimeline([a, b, c, d], { now: NOW });
  const byId = Object.fromEntries(runs.map(r => [r.id, r.groupKey]));
  assert.equal(byId.a, 'sg');
  assert.equal(byId.b, 'sess');
  assert.equal(byId.c, 'lin');
  assert.equal(byId.d, 'd');
});

// ─── packTimelineRows ─────────────────────────────────────────────────────────

test('packTimelineRows packs non-overlapping runs in the same group into ONE row', () => {
  const a = run({ id: 'a', groupKey: 'g', start: NOW - 3 * HOUR, end: NOW - 2 * HOUR });
  const b = run({ id: 'b', groupKey: 'g', start: NOW - HOUR, end: NOW - 30 * MIN });
  const { rows } = packTimelineRows([a, b]);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].map(r => r.id), ['a', 'b']);
});

test('packTimelineRows splits OVERLAPPING runs in the same group into separate rows', () => {
  const a = run({ id: 'a', groupKey: 'g', start: NOW - 3 * HOUR, end: NOW - HOUR });
  const b = run({ id: 'b', groupKey: 'g', start: NOW - 2 * HOUR, end: NOW - 30 * MIN }); // overlaps a
  const { rows } = packTimelineRows([a, b]);
  assert.equal(rows.length, 2);
});

test('an open-ended (still-running) run occupies its row through the window — nothing shares it after', () => {
  const a = run({ id: 'a', groupKey: 'g', start: NOW - 3 * HOUR, end: null, stillRunning: true });
  const b = run({ id: 'b', groupKey: 'g', start: NOW - HOUR, end: NOW - 30 * MIN });
  const { rows } = packTimelineRows([a, b]);
  assert.equal(rows.length, 2);
});

test('different groups always land in different rows, even with no time overlap', () => {
  const a = run({ id: 'a', groupKey: 'g1', start: NOW - 3 * HOUR, end: NOW - 2 * HOUR });
  const b = run({ id: 'b', groupKey: 'g2', start: NOW - HOUR, end: NOW - 30 * MIN });
  const { rows } = packTimelineRows([a, b]);
  assert.equal(rows.length, 2);
});

test('groups are emitted most-recently-active first', () => {
  const older = run({ id: 'old', groupKey: 'g1', start: NOW - 5 * HOUR, end: NOW - 4 * HOUR });
  const newer = run({ id: 'new', groupKey: 'g2', start: NOW - HOUR, end: NOW - 30 * MIN });
  const { rows } = packTimelineRows([older, newer]);
  assert.equal(rows[0][0].id, 'new');
  assert.equal(rows[1][0].id, 'old');
});

test('a followUpTo pointing at an in-window run gets a connector edge', () => {
  const a = run({ id: 'a', groupKey: 'g', start: NOW - 3 * HOUR, end: NOW - 2 * HOUR });
  const b = run({ id: 'b', groupKey: 'g', start: NOW - HOUR, end: NOW - 30 * MIN, followUpTo: 'a' });
  const { connectors, rows } = packTimelineRows([a, b]);
  assert.deepEqual(connectors, [{ fromId: 'a', toId: 'b' }]);
  assert.equal(rows.flat().find(r => r.id === 'b').connectorTruncated, false);
});

test('a followUpTo pointing OUTSIDE the run list sets connectorTruncated instead of a connector', () => {
  const b = run({ id: 'b', groupKey: 'g', followUpTo: 'ghost-not-in-list' });
  const { connectors, rows } = packTimelineRows([b]);
  assert.deepEqual(connectors, []);
  assert.equal(rows.flat().find(r => r.id === 'b').connectorTruncated, true);
});

test('a run with no followUpTo carries connectorTruncated: false', () => {
  const a = run({ id: 'a' });
  const { rows } = packTimelineRows([a]);
  assert.equal(rows.flat()[0].connectorTruncated, false);
});

test('packTimelineRows is tolerant of empty/non-array input', () => {
  assert.deepEqual(packTimelineRows([]), { rows: [], connectors: [] });
  assert.deepEqual(packTimelineRows(null), { rows: [], connectors: [] });
});

test('packTimelineRows accepts a custom groupKeyOf', () => {
  const a = run({ id: 'a', groupKey: 'ignored-a', workspaceUrlKey: 'ws1', start: NOW - 3 * HOUR, end: NOW - 2 * HOUR });
  const b = run({ id: 'b', groupKey: 'ignored-b', workspaceUrlKey: 'ws1', start: NOW - HOUR, end: NOW - 30 * MIN });
  const { rows } = packTimelineRows([a, b], { groupKeyOf: r => r.workspaceUrlKey });
  // Both share the custom group key and don't overlap → packed into one row.
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].map(r => r.id), ['a', 'b']);
});

// ─── buildConsoleFeed integration ─────────────────────────────────────────────

test('buildConsoleFeed folds a packed timeline into its return, sharing laneStaleMs with lane-dropping', () => {
  // Stale at the DEFAULT 1h laneStaleMs: dropped from `lanes`, but the
  // timeline answers a different question (is this within the last 24h) and
  // still surfaces it, stale-marked.
  const staleLoop = loop({ loopId: 'stale', dispatchedAt: new Date(NOW - 2 * HOUR).toISOString() });
  const { timeline, lanes } = buildConsoleFeed({ statusItems: [], loops: [staleLoop] }, { now: NOW });
  assert.equal(lanes.length, 0);
  assert.equal(timeline.rows.flat().length, 1);
  assert.equal(timeline.rows.flat()[0].stillRunning, 'unknown');
  assert.equal(timeline.totalInWindow, 1);
  assert.equal(timeline.truncated, false);
  assert.deepEqual(timeline.connectors, []);
});

test('buildConsoleFeed threads a configured laneStaleMs into buildTimeline (one shared knob)', () => {
  // Stale by the default 1h, but FRESH by a configured 3h — must survive as a
  // lane AND as an open-ended timeline bar, since both read the same knob.
  const l = loop({ dispatchedAt: new Date(NOW - 2 * HOUR).toISOString() });
  const { timeline, lanes } = buildConsoleFeed({ statusItems: [], loops: [l] }, { now: NOW, laneStaleMs: 3 * HOUR });
  assert.equal(lanes.length, 1);
  assert.equal(timeline.rows.flat()[0].stillRunning, true);
  assert.equal(timeline.rows.flat()[0].end, null);
});

test('the history-page branch (loops: []) yields an empty/absent timeline shape', () => {
  // Mirrors routes/live-console.js's history-page call: loops:[] (status-only read).
  const { timeline } = buildConsoleFeed({ statusItems: [], loops: [] }, { now: NOW, before: NOW });
  assert.deepEqual(timeline, { rows: [], connectors: [], truncated: false, totalInWindow: 0 });
});

// ─── computeTimelineZoom / computeTimelinePan (LIN-1743, Phase 2) ────────────
// Pure zoom/pan math shared by the wheel/pinch/preset call sites in
// public/live-console.js (mirrored on window in public/common.js).

const VIEWPORT_W = 900;

test('computeTimelineZoom clamps the span to [minSpanMs, maxSpanMs]', () => {
  // A large zoom-IN delta would shrink the span far below 1h — clamps to the floor.
  const zoomedIn = computeTimelineZoom({
    startMs: NOW - HOUR, endMs: NOW, focalX: VIEWPORT_W / 2,
    deltaZoom: -10, viewportWidthPx: VIEWPORT_W, nowMs: NOW,
  });
  assert.equal(zoomedIn.endMs - zoomedIn.startMs, TIMELINE_MIN_SPAN_MS);

  // A large zoom-OUT delta from a short span would grow it past 24h — clamps to the ceiling.
  const zoomedOut = computeTimelineZoom({
    startMs: NOW - HOUR, endMs: NOW, focalX: VIEWPORT_W / 2,
    deltaZoom: 10, viewportWidthPx: VIEWPORT_W, nowMs: NOW,
  });
  assert.equal(zoomedOut.endMs - zoomedOut.startMs, TIMELINE_MAX_SPAN_MS);
});

test('computeTimelineZoom keeps the instant under the focal point stationary', () => {
  // Window comfortably inside the axis bounds so clamping never engages —
  // isolates the focal-point invariant from the edge-clamp behaviour below.
  const startMs = NOW - 10 * HOUR;
  const endMs = NOW - 2 * HOUR;
  const focalX = 300; // arbitrary point inside the viewport, not dead centre
  const span = endMs - startMs;
  const focalMsBefore = startMs + (focalX / VIEWPORT_W) * span;

  const next = computeTimelineZoom({
    startMs, endMs, focalX, deltaZoom: -0.5, viewportWidthPx: VIEWPORT_W, nowMs: NOW,
  });
  const nextSpan = next.endMs - next.startMs;
  const focalMsAfter = next.startMs + (focalX / VIEWPORT_W) * nextSpan;
  assert.ok(Math.abs(focalMsAfter - focalMsBefore) < 1, 'focal instant drifted across the zoom');
  assert.ok(nextSpan < span, 'a negative deltaZoom should zoom in (shrink the span)');
});

test('computeTimelineZoom clamps the window to the fixed [now - maxSpanMs, now] axis', () => {
  // Zooming out from a window already at the live edge must never push endMs
  // past "now" or startMs past the 24h floor.
  const next = computeTimelineZoom({
    startMs: NOW - 2 * HOUR, endMs: NOW, focalX: VIEWPORT_W, // focal pinned to the right edge
    deltaZoom: 5, viewportWidthPx: VIEWPORT_W, nowMs: NOW,
  });
  assert.equal(next.endMs, NOW);
  assert.ok(next.startMs >= NOW - TIMELINE_MAX_SPAN_MS);
});

test('computeTimelineZoom is a no-op on degenerate input (zero viewport, inverted window)', () => {
  assert.deepEqual(
    computeTimelineZoom({ startMs: NOW - HOUR, endMs: NOW, focalX: 10, deltaZoom: -1, viewportWidthPx: 0, nowMs: NOW }),
    { startMs: NOW - HOUR, endMs: NOW }
  );
  assert.deepEqual(
    computeTimelineZoom({ startMs: NOW, endMs: NOW - HOUR, focalX: 10, deltaZoom: -1, viewportWidthPx: VIEWPORT_W, nowMs: NOW }),
    { startMs: NOW, endMs: NOW - HOUR }
  );
});

test('computeTimelinePan preserves the span and shifts the window by deltaPx', () => {
  const startMs = NOW - 10 * HOUR;
  const endMs = NOW - 8 * HOUR; // 2h span, well inside the axis bounds
  const span = endMs - startMs;
  // Dragging right (positive deltaPx) reveals earlier time — window moves back.
  const next = computeTimelinePan({ startMs, endMs, deltaPx: 90, viewportWidthPx: VIEWPORT_W, nowMs: NOW });
  assert.equal(next.endMs - next.startMs, span);
  assert.ok(next.startMs < startMs);
  assert.ok(next.endMs < endMs);
});

test('computeTimelinePan clamps at the live edge (cannot pan past "now")', () => {
  const next = computeTimelinePan({
    startMs: NOW - 2 * HOUR, endMs: NOW, deltaPx: -500, // drag left: reveal LATER time
    viewportWidthPx: VIEWPORT_W, nowMs: NOW,
  });
  assert.equal(next.endMs, NOW);
});

test('computeTimelinePan clamps at the history edge (cannot pan past now - 24h)', () => {
  const next = computeTimelinePan({
    startMs: NOW - TIMELINE_MAX_SPAN_MS, endMs: NOW - TIMELINE_MAX_SPAN_MS + 2 * HOUR,
    deltaPx: 500, // drag right: reveal EARLIER time, past the axis floor
    viewportWidthPx: VIEWPORT_W, nowMs: NOW,
  });
  assert.equal(next.startMs, NOW - TIMELINE_MAX_SPAN_MS);
});

test('computeTimelinePan is a no-op on degenerate input (zero viewport, inverted window)', () => {
  assert.deepEqual(
    computeTimelinePan({ startMs: NOW - HOUR, endMs: NOW, deltaPx: 50, viewportWidthPx: 0, nowMs: NOW }),
    { startMs: NOW - HOUR, endMs: NOW }
  );
});

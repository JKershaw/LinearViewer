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
  SUMMARY_MAX,
} from '../../lib/live-console.js';

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

// ─── buildConsoleFeed: summary (fleet totals) ─────────────────────────────────

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

/**
 * Unit coverage for the shared staleness definition (LIN-1445).
 *
 * One source of truth for "this run is stuck non-terminal but has gone quiet" —
 * consumed by both the Observation feed (routes/dashboard.js) and the Live
 * Console (lib/live-console.js) so the two surfaces agree instead of each
 * carrying its own threshold. Pure + read-only: activity is derived, never
 * mutated, so a later heartbeat un-stales a run.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { STALE_AFTER_MS, loopLastActivityMs, isStale } from '../../lib/staleness.js';

test('STALE_AFTER_MS is one hour', () => {
  assert.equal(STALE_AFTER_MS, 60 * 60 * 1000);
});

test('loopLastActivityMs takes the most recent of dispatch / agent / heartbeat', () => {
  const loop = {
    dispatchedAt: '2026-07-19T11:00:00.000Z',
    agentTimestamp: '2026-07-19T11:20:00.000Z',
    telemetry: { metrics: [
      { toolCount: 1, timestamp: '2026-07-19T11:10:00.000Z' },
      { toolCount: 9, timestamp: '2026-07-19T11:59:00.000Z' }, // newest signal
    ] },
  };
  assert.equal(loopLastActivityMs(loop), new Date('2026-07-19T11:59:00.000Z').getTime());
});

test('loopLastActivityMs is heartbeat-aware even when agent-status is old', () => {
  // A busy run that heartbeats but hasn't posted an agent-status update in a
  // while must NOT read as idle — the heartbeat is the freshest signal.
  const loop = {
    dispatchedAt: '2026-07-19T09:00:00.000Z',
    agentTimestamp: '2026-07-19T09:05:00.000Z',
    telemetry: { metrics: [{ toolCount: 3, timestamp: '2026-07-19T11:58:00.000Z' }] },
  };
  assert.equal(loopLastActivityMs(loop), new Date('2026-07-19T11:58:00.000Z').getTime());
});

test('loopLastActivityMs tolerates junk / missing fields', () => {
  assert.equal(loopLastActivityMs(null), 0);
  assert.equal(loopLastActivityMs({}), 0);
  assert.equal(loopLastActivityMs({ dispatchedAt: 'not-a-date', telemetry: { metrics: [] } }), 0);
});

test('isStale fires only past the threshold, tolerant of no activity', () => {
  const now = Date.parse('2026-07-19T12:00:00Z');
  const min = 60 * 1000;
  assert.equal(isStale(now - 30 * min, now), false);      // 30 min idle → fresh
  assert.equal(isStale(now - 90 * min, now), true);       // 90 min idle → stale
  assert.equal(isStale(0, now), false);                   // no activity → not "stale" (unknown)
  assert.equal(isStale(now - 90 * min, now, 2 * 60 * min), false); // configurable threshold
});

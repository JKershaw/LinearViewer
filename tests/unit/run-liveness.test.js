/**
 * Unit tests for lib/run-liveness.js: `resolveDisposition`, the total four-way press-time mapping the answer route reads
 * ("can a follow-up still find the session?"), and the reap window it mirrors from simple-dispatcher.
 *
 * Moved here from tests/unit/unanswered-decisions.test.js when the ruling predicate retired (LIN-4541, LIN-4529 P7b-2):
 * the liveness rule stayed (LIN-4529 plan D3), so its tests stay with it, unchanged in what they assert.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resolveDisposition, REAP_INACTIVITY_MS } from '../../lib/run-liveness.js';

const NOW = new Date('2026-08-22T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

function loop(overrides = {}) {
  return {
    loopId: 'loop-1',
    issueId: 'uuid-1',
    issueIdentifier: 'LIN-900',
    workspaceUrlKey: 'acme',
    target: 'cli',
    followUpTo: null,
    terminalStatus: null,
    terminalCompletedAt: null,
    wakeMarker: null,
    agentState: null,
    ...overrides
  };
}

describe('resolveDisposition (LIN-1728 Revision 3, F8: total mapping)', () => {
  test('permanently-parked [blocked], non-terminal → resumable', () => {
    const l = loop({ terminalStatus: null, wakeMarker: 'blocked' });
    assert.strictEqual(resolveDisposition(l, { now: NOW }), 'resumable');
  });

  test('stamped (closed) running loop ages from the stamp, not mid-turn (LIN-3364 F3)', () => {
    const fresh = loop({ terminalStatus: null, agentState: 'running', bookkeeping: { at: new Date(NOW.getTime() - 1000 * 60 * 5), by: 'a', reason: 'handed-on' } });
    assert.strictEqual(resolveDisposition(fresh, { now: NOW }), 'resumable');
    const old = loop({ terminalStatus: null, agentState: 'running', bookkeeping: { at: new Date(NOW.getTime() - REAP_INACTIVITY_MS - 1), by: 'a', reason: 'handed-on' } });
    assert.strictEqual(resolveDisposition(old, { now: NOW }), 'gone');
    assert.strictEqual(resolveDisposition(loop({ terminalStatus: null, agentState: 'running' }), { now: NOW }), 'mid-turn');
  });

  test('terminal, exactly at the reap-window boundary → resumable (inclusive)', () => {
    const completedAt = new Date(NOW.getTime() - REAP_INACTIVITY_MS);
    const l = loop({ terminalStatus: 'done', terminalCompletedAt: completedAt.toISOString() });
    assert.strictEqual(resolveDisposition(l, { now: NOW }), 'resumable');
  });

  test('terminal, one ms past the reap-window boundary → gone', () => {
    const completedAt = new Date(NOW.getTime() - REAP_INACTIVITY_MS - 1);
    const l = loop({ terminalStatus: 'done', terminalCompletedAt: completedAt.toISOString() });
    assert.strictEqual(resolveDisposition(l, { now: NOW }), 'gone');
  });

  test('terminal, well within the reap window → resumable', () => {
    const completedAt = new Date(NOW.getTime() - 1000 * 60 * 5); // 5 min ago
    const l = loop({ terminalStatus: 'done', terminalCompletedAt: completedAt.toISOString() });
    assert.strictEqual(resolveDisposition(l, { now: NOW }), 'resumable');
  });

  test('terminal, 3 days old (inside the 7-day record window) → resumable', () => {
    const completedAt = new Date(NOW.getTime() - 3 * DAY_MS);
    const l = loop({ terminalStatus: 'done', terminalCompletedAt: completedAt.toISOString() });
    assert.strictEqual(resolveDisposition(l, { now: NOW }), 'resumable');
  });

  test('terminal, 8 days old (past the 7-day record window) → gone', () => {
    const completedAt = new Date(NOW.getTime() - 8 * DAY_MS);
    const l = loop({ terminalStatus: 'done', terminalCompletedAt: completedAt.toISOString() });
    assert.strictEqual(resolveDisposition(l, { now: NOW }), 'gone');
  });

  test('terminal with no terminalCompletedAt (defensive: missing timestamp) → gone, never resumable by default', () => {
    const l = loop({ terminalStatus: 'done', terminalCompletedAt: null });
    assert.strictEqual(resolveDisposition(l, { now: NOW }), 'gone');
  });

  test('non-terminal, actively running → mid-turn', () => {
    const l = loop({ terminalStatus: null, wakeMarker: null, agentState: 'running' });
    assert.strictEqual(resolveDisposition(l, { now: NOW }), 'mid-turn');
  });

  test('the residual non-terminal/non-blocked/non-running case → indeterminate', () => {
    const l = loop({ terminalStatus: null, wakeMarker: null, agentState: 'idle' });
    assert.strictEqual(resolveDisposition(l, { now: NOW }), 'indeterminate');
  });

  test('every branch is reachable and none falls through undefined — exhaustive matrix', () => {
    const cases = [
      loop({ terminalStatus: null, wakeMarker: 'blocked' }),
      loop({ terminalStatus: 'done', terminalCompletedAt: NOW.toISOString() }),
      loop({ terminalStatus: 'failed', terminalCompletedAt: new Date(NOW.getTime() - 1000 * 60 * 60 * 24 * 2).toISOString() }),
      loop({ terminalStatus: null, wakeMarker: null, agentState: 'running' }),
      loop({ terminalStatus: null, wakeMarker: null, agentState: null }),
      loop({ terminalStatus: null, wakeMarker: 'pending', agentState: null })
    ];
    for (const l of cases) {
      const d = resolveDisposition(l, { now: NOW });
      assert.ok(['resumable', 'gone', 'mid-turn', 'indeterminate'].includes(d), `unmapped disposition: ${d}`);
    }
  });
});


/**
 * Unit tests for lib/dispatch-terminal.js (LIN-509 / LIN-400).
 *
 * Run with: node --test tests/unit/dispatch-terminal.test.js
 *
 * The terminal-marker seam shared by the proxy watch endpoints and the dashboard
 * Loop feed: a "[done]"/"[failed]"/"[aborted]" prefix on the LAST matching
 * feedback entry is the truthful completion signal while the queue status stays
 * 'taken'.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { findTerminalFeedback, deriveTerminalStatus, deriveCompletedAt } from '../../lib/dispatch-terminal.js';

describe('deriveTerminalStatus', () => {
  test('null when feedback is missing or not an array', () => {
    assert.equal(deriveTerminalStatus(undefined), null);
    assert.equal(deriveTerminalStatus(null), null);
    assert.equal(deriveTerminalStatus('nope'), null);
    assert.equal(deriveTerminalStatus([]), null);
  });

  test('null when no entry carries a terminal marker', () => {
    assert.equal(deriveTerminalStatus([{ message: 'started work' }, { message: 'pushed a branch' }]), null);
  });

  test('maps [done]/[complete] → done, [failed]/[aborted] → failed/aborted', () => {
    assert.equal(deriveTerminalStatus([{ message: '[done] finished in 40s' }]), 'done');
    assert.equal(deriveTerminalStatus([{ message: '[complete] all green' }]), 'done');
    assert.equal(deriveTerminalStatus([{ message: '[failed] tests red' }]), 'failed');
    assert.equal(deriveTerminalStatus([{ message: '[aborted] gave up' }]), 'aborted');
  });

  test('case-insensitive and tolerant of leading whitespace', () => {
    assert.equal(deriveTerminalStatus([{ message: '  [DONE] ok' }]), 'done');
  });

  test('returns the LAST terminal marker when several exist', () => {
    const status = deriveTerminalStatus([
      { message: '[failed] first attempt' },
      { message: '[done] retry succeeded' }
    ]);
    assert.equal(status, 'done');
  });

  test('a non-prefix mention of [done] does not count', () => {
    assert.equal(deriveTerminalStatus([{ message: 'note: the marker is [done] when finished' }]), null);
  });
});

describe('deriveCompletedAt', () => {
  test('returns the timestamp of the terminal entry', () => {
    const ts = '2026-06-15T12:00:00.000Z';
    assert.equal(deriveCompletedAt([{ message: 'working' }, { message: '[done] ok', timestamp: ts }]), ts);
  });
  test('null when there is no terminal marker', () => {
    assert.equal(deriveCompletedAt([{ message: 'working' }]), null);
  });
});

describe('findTerminalFeedback', () => {
  test('returns the matching entry and its status', () => {
    const entry = { message: '[failed] boom', timestamp: 't' };
    const res = findTerminalFeedback([{ message: 'x' }, entry]);
    assert.deepEqual(res, { entry, status: 'failed' });
  });
});

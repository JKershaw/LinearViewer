/**
 * LIN-3812 drift guard for `isStatusBearingMessage`: the write-time lineage persistence
 * recomputes a lineage ONLY for a status-bearing entry. If the derivation
 * (`deriveWireStatus` / `deriveCompletedAt`) ever learns a marker the predicate does not
 * cover, a row's persisted status would silently go stale: this test fails first.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { deriveCompletedAt, deriveWireStatus, isStatusBearingMessage, __internal } from '../../lib/dispatch-terminal.js';

const MARKERS = ['done', 'complete', 'failed', 'aborted', 'skipped', 'blocked', 'pending', 'working', 'review', 'note'];
const SUFFIXES = ['', ' finished', ' · running 3 tools in 10s', ' Session resumed.', ' Session resumed. continuing'];
const PREFIXES = ['', '  ', 'prefix ', '\n'];

const corpus = [];
for (const pre of PREFIXES) for (const m of MARKERS) for (const suf of SUFFIXES) corpus.push(`${pre}[${m}]${suf}`);
corpus.push('', 'plain heartbeat', '{"decision_id":"d1"}', '[DONE] upper case', '[Working] Session resumed.', 'mid [done] sentence');

const T = (i) => new Date(Date.UTC(2026, 7, 1, 0, i));
const baselines = [
  [],
  [{ message: '[blocked] parked', timestamp: T(1) }],
  [{ message: '[pending] paused', timestamp: T(1) }],
  [{ message: '[done] finished', timestamp: T(1) }],
  [{ message: '[blocked] parked', timestamp: T(1) }, { message: '[working] Session resumed. go', timestamp: T(2) }]
];

describe('isStatusBearingMessage (LIN-3812)', () => {
  test('is exactly the union of the derivation\'s own regexes', () => {
    const { TERMINAL_FEEDBACK_REGEX, WAKE_FEEDBACK_REGEX, RESUME_MARKER_REGEX } = __internal;
    for (const message of corpus) {
      assert.equal(
        isStatusBearingMessage(message),
        TERMINAL_FEEDBACK_REGEX.test(message) || WAKE_FEEDBACK_REGEX.test(message) || RESUME_MARKER_REGEX.test(message),
        JSON.stringify(message)
      );
    }
  });

  test('appending a NON-status-bearing message never changes the wire status or completedAt', () => {
    for (const base of baselines) {
      for (const bookkeeping of [null, { at: T(0), by: 'x', reason: 'handed-on' }]) {
        const before = { status: deriveWireStatus({ feedback: base, bookkeeping }), completedAt: deriveCompletedAt(base) };
        for (const message of corpus.filter(m => !isStatusBearingMessage(m))) {
          const next = [...base, { message, timestamp: T(30) }];
          assert.deepEqual(
            { status: deriveWireStatus({ feedback: next, bookkeeping }), completedAt: deriveCompletedAt(next) },
            before,
            `a non-status-bearing ${JSON.stringify(message)} changed the derivation over ${JSON.stringify(base.map(b => b.message))}`
          );
        }
      }
    }
  });

  test('each status-bearing family really can move the derivation (the predicate is not vacuously true)', () => {
    const move = (message, base = []) => deriveWireStatus({ feedback: [...base, { message, timestamp: T(9) }] });
    assert.equal(move('[done] x'), 'done');
    assert.equal(move('[skipped] x'), 'skipped');
    assert.equal(move('[blocked] x'), 'blocked');
    assert.equal(move('[working] Session resumed. x', [{ message: '[blocked] x', timestamp: T(1) }]), null);
  });
});

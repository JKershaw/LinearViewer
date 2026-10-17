/**
 * LIN-3602: the one authority for "which wake marker means waiting on a person".
 * Behaviour of the predicate and of the set it reads; every caller routes here.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { WAITING_WAKE_MARKERS, isWaitingWakeMarker, WAKE_FEEDBACK_REGEX } from '../../lib/dispatch-terminal.js';

describe('isWaitingWakeMarker (LIN-3602)', () => {
  test('only `blocked` waits on a person', () => {
    assert.equal(isWaitingWakeMarker('blocked'), true);
    for (const m of ['pending', 'done', 'complete', 'failed', 'aborted', 'skipped', 'working']) {
      assert.equal(isWaitingWakeMarker(m), false, m);
    }
  });

  test('every marker WAKE_FEEDBACK_REGEX can capture is classified, and only blocked waits', () => {
    const captured = WAKE_FEEDBACK_REGEX.source.match(/\(([a-z|]+)\)/)[1].split('|');
    assert.deepEqual(captured.filter((m) => isWaitingWakeMarker(m)), ['blocked']);
  });

  test('null-safe', () => {
    for (const m of [null, undefined, '']) assert.equal(isWaitingWakeMarker(m), false);
  });

  test('exact: no case folding or trimming inside the predicate', () => {
    for (const m of ['BLOCKED', 'Blocked', ' blocked', 'blocked ', '[blocked]']) {
      assert.equal(isWaitingWakeMarker(m), false, JSON.stringify(m));
    }
  });

  test('a message-derived capture is lower-cased by the caller, as the case-insensitive regex allows', () => {
    const match = WAKE_FEEDBACK_REGEX.exec('  [BLOCKED] need a human');
    assert.equal(isWaitingWakeMarker(match[1]), false);
    assert.equal(isWaitingWakeMarker(match[1].toLowerCase()), true);
  });

  test('the set is the exported authority', () => {
    assert.deepEqual([...WAITING_WAKE_MARKERS], ['blocked']);
  });
});

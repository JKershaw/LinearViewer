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
import { findTerminalFeedback, deriveTerminalStatus, deriveCompletedAt, isWakeEvent, findWakeEvent, harvestAbortedTargets, feedbackWithHarvestedAbort } from '../../lib/dispatch-terminal.js';

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

/**
 * Shared abort terminal-attribution rule (LIN-1257 A2 / LIN-1261 F1/F2) — the
 * harvest half (`harvestAbortedTargets`) and the guarded-append half
 * (`feedbackWithHarvestedAbort`) both pipeline reconstruction and the proxy read
 * boundary consume, so the rule has ONE definition.
 */
describe('harvestAbortedTargets', () => {
  test('maps each abort row to its own [aborted] entry keyed by abortTo', () => {
    const abortEntry = { message: '[aborted] cancelled', timestamp: 't1' };
    const map = harvestAbortedTargets([
      { id: 'a1', abort: true, abortTo: 'tgt-1', feedback: [abortEntry] },
      { id: 'tgt-1', feedback: [{ message: '[working] running' }] }
    ]);
    assert.strictEqual(map.size, 1);
    assert.deepStrictEqual(map.get('tgt-1'), abortEntry);
  });

  test('ignores non-abort rows, abort rows without abortTo, and [skipped] refusals', () => {
    const map = harvestAbortedTargets([
      { id: 'a1', abort: false, abortTo: 'x', feedback: [{ message: '[aborted] x', timestamp: 't' }] },
      { id: 'a2', abort: true, feedback: [{ message: '[aborted] no target', timestamp: 't' }] },
      { id: 'a3', abort: true, abortTo: 'y', feedback: [{ message: '[skipped] human-continued session', timestamp: 't' }] }
    ]);
    assert.strictEqual(map.size, 0);
  });

  test('tolerates non-array input', () => {
    assert.strictEqual(harvestAbortedTargets(undefined).size, 0);
    assert.strictEqual(harvestAbortedTargets(null).size, 0);
  });
});

describe('feedbackWithHarvestedAbort (F1 guard)', () => {
  const abort = (ts) => ({ message: '[aborted] cancelled', timestamp: ts });

  test('no abort entry → returns the same array reference unchanged', () => {
    const fb = [{ message: '[working] running', timestamp: 't' }];
    assert.strictEqual(feedbackWithHarvestedAbort(fb, undefined), fb);
    assert.strictEqual(feedbackWithHarvestedAbort(fb, null), fb);
  });

  test('no pre-existing terminal → appends the abort (original A2 attribution)', () => {
    const fb = [{ message: '[working] running', timestamp: '2026-06-22T11:00:00.000Z' }];
    const out = feedbackWithHarvestedAbort(fb, abort('2026-06-22T11:30:00.000Z'));
    assert.strictEqual(deriveTerminalStatus(out), 'aborted');
    assert.strictEqual(deriveCompletedAt(out), '2026-06-22T11:30:00.000Z');
    assert.notStrictEqual(out, fb, 'a new array is returned (non-mutating append)');
    assert.strictEqual(fb.length, 1, 'the input array is not mutated');
  });

  test('EARLIER abort does NOT override a later [done] or rewind completedAt', () => {
    const fb = [{ message: '[done] finished', timestamp: '2026-06-22T12:00:00.000Z' }];
    const out = feedbackWithHarvestedAbort(fb, abort('2026-06-22T11:30:00.000Z'));
    assert.strictEqual(out, fb, 'the same array is returned (no append)');
    assert.strictEqual(deriveTerminalStatus(out), 'done');
    assert.strictEqual(deriveCompletedAt(out), '2026-06-22T12:00:00.000Z');
  });

  test('EQUAL-time abort does not override the existing terminal (strictly-later only)', () => {
    const ts = '2026-06-22T12:00:00.000Z';
    const fb = [{ message: '[done] finished', timestamp: ts }];
    assert.strictEqual(feedbackWithHarvestedAbort(fb, abort(ts)), fb);
  });

  test('STRICTLY-later abort wins (forward move, not a rewind)', () => {
    const fb = [{ message: '[done] finished', timestamp: '2026-06-22T12:00:00.000Z' }];
    const out = feedbackWithHarvestedAbort(fb, abort('2026-06-22T12:30:00.000Z'));
    assert.strictEqual(deriveTerminalStatus(out), 'aborted');
    assert.strictEqual(deriveCompletedAt(out), '2026-06-22T12:30:00.000Z');
  });

  test('unparseable timestamps on either side → keep the pre-existing terminal (never rewind on unknown order)', () => {
    const fb = [{ message: '[done] finished', timestamp: '2026-06-22T12:00:00.000Z' }];
    assert.strictEqual(feedbackWithHarvestedAbort(fb, abort(undefined)), fb);
    const fbNoTs = [{ message: '[done] finished' }];
    assert.strictEqual(feedbackWithHarvestedAbort(fbNoTs, abort('2026-06-22T12:30:00.000Z')), fbNoTs);
  });
});

/**
 * Wake-event predicate (LIN-826) — a deliberate SUPERSET of the terminal
 * markers that additionally counts [blocked], consumed only by the up-chain
 * wake auto-enqueue. Kept separate from the terminal regex so [blocked] never
 * leaks into completion/telemetry/KPI semantics.
 */
describe('isWakeEvent', () => {
  test('[done]/[complete]/[failed]/[aborted]/[blocked]/[pending] are all wake events', () => {
    assert.equal(isWakeEvent('[done] finished in 40s'), true);
    assert.equal(isWakeEvent('[complete] all green'), true);
    assert.equal(isWakeEvent('[failed] tests red'), true);
    assert.equal(isWakeEvent('[aborted] gave up'), true);
    assert.equal(isWakeEvent('[blocked] waiting on a human'), true);
    assert.equal(isWakeEvent('[pending] beat 1 done, beats 2-4 remain'), true);
  });

  test('non-terminal markers and empty input are not wake events', () => {
    assert.equal(isWakeEvent('[working] still going'), false);
    assert.equal(isWakeEvent('[stalled?] no output for a while'), false);
    assert.equal(isWakeEvent(''), false);
    assert.equal(isWakeEvent(undefined), false);
    assert.equal(isWakeEvent(null), false);
  });

  test('case-insensitive and tolerant of leading whitespace', () => {
    assert.equal(isWakeEvent('  [BLOCKED] ok'), true);
  });

  test('a non-prefix mention does not count', () => {
    assert.equal(isWakeEvent('note: a worker reports [blocked] when stuck'), false);
  });

  // SPLIT-PROOF: [blocked] wakes a parent, but it is NOT terminal — the new
  // predicate must not leak into terminal/telemetry/KPI semantics.
  test('[blocked] is a wake event WHILE findTerminalFeedback stays blind to it', () => {
    const feedback = [{ message: '[blocked] cannot proceed without creds' }];
    assert.equal(isWakeEvent(feedback[0].message), true);
    assert.equal(findTerminalFeedback(feedback), null);
    assert.equal(deriveTerminalStatus(feedback), null);
  });

  // SPLIT-PROOF (LIN-843): [pending] is a PAUSE — it wakes a parent but must
  // never count as completion. The whole point of the split is that telemetry/
  // KPI/close-out never see a pause as a finish.
  test('[pending] is a wake event WHILE findTerminalFeedback / deriveCompletedAt stay blind to it', () => {
    const feedback = [{ message: '[pending] my part is done, the task is not', timestamp: 't' }];
    assert.equal(isWakeEvent(feedback[0].message), true);
    assert.equal(findTerminalFeedback(feedback), null);
    assert.equal(deriveTerminalStatus(feedback), null);
    assert.equal(deriveCompletedAt(feedback), null, 'a pause must not stamp a completion time');
  });
});

describe('findWakeEvent', () => {
  test('null when feedback is missing or not an array', () => {
    assert.equal(findWakeEvent(undefined), null);
    assert.equal(findWakeEvent(null), null);
    assert.equal(findWakeEvent('nope'), null);
    assert.equal(findWakeEvent([]), null);
  });

  test('null when no entry carries a wake marker', () => {
    assert.equal(findWakeEvent([{ message: 'started work' }, { message: '[working] still going' }]), null);
  });

  test('returns the matching entry and its lowercased marker', () => {
    const entry = { message: '[BLOCKED] stuck', timestamp: 't' };
    assert.deepEqual(findWakeEvent([{ message: 'x' }, entry]), { entry, marker: 'blocked' });
  });

  test('returns the LAST wake marker when several exist', () => {
    const last = { message: '[done] retry succeeded' };
    assert.deepEqual(
      findWakeEvent([{ message: '[failed] first attempt' }, last]),
      { entry: last, marker: 'done' }
    );
  });
});

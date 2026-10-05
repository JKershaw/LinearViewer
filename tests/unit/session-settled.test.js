/**
 * LIN-3311 (S2a of LIN-2950; plan-review R4) — `sessionSettleState` and
 * `sessionIsSettled` in routes/dashboard.js.
 *
 * `sessionIsTerminal` answers from the anchor loop alone when there is one, so
 * an anchored session stays "terminal" while a reply or proposal Apply runs a
 * follow-up loop. "Settled" adds: every loop is terminal. The per-loop verdict
 * must be the SAME predicate `sessionIsTerminal` uses (`isTerminalLoop(enrichLoop(l))`,
 * which counts a markerless `complete`/`error` loop as terminal), so a key built
 * from `loops` (LIN-2950's `settledKey`) can never disagree with the check.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  sessionSettleState,
  sessionIsSettled,
  sessionIsTerminal,
  isTerminalLoop,
  enrichLoop
} from '../../routes/dashboard.js';

const SID = 'sess-1';

function loop(loopId, fields = {}) {
  return { loopId, issueIdentifier: 'LIN-1', dispatchedAt: '2026-07-04T10:00:00.000Z', feedback: [], ...fields };
}
// The anchor: the autopilot orchestrator whose loopId is the session id.
const anchor = (fields = {}) => loop(SID, { kind: 'autopilot', ...fields });
const done = { agentState: 'complete', terminalStatus: 'done' };
const running = { agentState: 'running', terminalStatus: null };

describe('sessionIsSettled vs sessionIsTerminal', () => {
  test('an anchored session with a running follow-up loop is terminal but NOT settled', () => {
    const session = { sessionId: SID, loops: [anchor(done), loop('w1', done), loop('follow-up', running)] };
    assert.equal(sessionIsTerminal(session), true, 'the anchor alone decides terminal');
    assert.equal(sessionIsSettled(session), false, 'the running follow-up keeps it unsettled');
    assert.deepEqual(sessionSettleState(session), {
      settled: false,
      loops: [
        { loopId: SID, terminal: true },
        { loopId: 'w1', terminal: true },
        { loopId: 'follow-up', terminal: false }
      ]
    });
  });

  test('the same session settles once the follow-up ends', () => {
    const session = { sessionId: SID, loops: [anchor(done), loop('w1', done), loop('follow-up', done)] };
    assert.equal(sessionIsTerminal(session), true);
    assert.equal(sessionIsSettled(session), true);
  });

  test('a running anchor is neither terminal nor settled, even with every worker done', () => {
    const session = { sessionId: SID, loops: [anchor(running), loop('w1', done)] };
    assert.equal(sessionIsTerminal(session), false);
    assert.equal(sessionIsSettled(session), false);
  });

  test('anchorless: settled exactly when every loop is terminal (the all-loops fallback)', () => {
    const allDone = { sessionId: SID, loops: [loop('a', done), loop('b', done)] };
    const oneRunning = { sessionId: SID, loops: [loop('a', done), loop('b', running)] };
    assert.equal(sessionIsSettled(allDone), true);
    assert.equal(sessionIsTerminal(oneRunning), false);
    assert.equal(sessionIsSettled(oneRunning), false);
  });

  test('no loops (or no session) never settles', () => {
    assert.deepEqual(sessionSettleState({ sessionId: SID, loops: [] }), { settled: false, loops: [] });
    assert.deepEqual(sessionSettleState({ sessionId: SID }), { settled: false, loops: [] });
    assert.deepEqual(sessionSettleState(null), { settled: false, loops: [] });
    assert.equal(sessionIsSettled(undefined), false);
  });

  test('a loop with no loopId reports loopId null (it still counts)', () => {
    const s = sessionSettleState({ sessionId: SID, loops: [loop(undefined, done)] });
    assert.deepEqual(s, { settled: true, loops: [{ loopId: null, terminal: true }] });
  });

  test('loops are reported in session order, one entry per loop', () => {
    const ids = ['c', 'a', 'b'];
    const s = sessionSettleState({ sessionId: SID, loops: ids.map(id => loop(id, done)) });
    assert.deepEqual(s.loops.map(l => l.loopId), ids);
  });
});

describe('R4: the per-loop verdict is the enriched terminal predicate', () => {
  // `terminalStatus` null means "pre-derived, no marker"; undefined would fall
  // back to scanning feedback (covered by the last row).
  const ROWS = [
    { name: 'complete + marker', fields: { agentState: 'complete', terminalStatus: 'done' }, terminal: true },
    { name: 'complete + no marker', fields: { agentState: 'complete', terminalStatus: null }, terminal: true },
    { name: 'error + no marker', fields: { agentState: 'error', terminalStatus: null }, terminal: true },
    { name: 'running + marker', fields: { agentState: 'running', terminalStatus: 'done' }, terminal: true },
    { name: 'running + no marker', fields: { agentState: 'running', terminalStatus: null }, terminal: false },
    { name: 'no agentState + failed marker', fields: { terminalStatus: 'failed' }, terminal: true },
    { name: 'running + [done] in raw feedback only', fields: { agentState: 'running', feedback: [{ message: '[done] landed', timestamp: '2026-07-04T10:05:00.000Z' }] }, terminal: true }
  ];

  for (const row of ROWS) {
    test(`${row.name} → terminal ${row.terminal}, matching isTerminalLoop(enrichLoop(l))`, () => {
      const l = loop('x', row.fields);
      assert.equal(isTerminalLoop(enrichLoop(l)), row.terminal, 'the table row is what the shared predicate says');
      const state = sessionSettleState({ sessionId: SID, loops: [l] });
      assert.equal(state.loops[0].terminal, isTerminalLoop(enrichLoop(l)));
    });
  }

  test('every combination of rows: loops agree per loop, and settled is exactly the anchor rule plus every-terminal', () => {
    // All ordered pairs of rows, as an anchorless session and behind a done anchor.
    for (const a of ROWS) {
      for (const b of ROWS) {
        for (const withAnchor of [false, true]) {
          const loops = [loop('l1', a.fields), loop('l2', b.fields)];
          if (withAnchor) loops.unshift(anchor(done));
          const session = { sessionId: SID, loops };
          const state = sessionSettleState(session);
          const label = `${withAnchor ? 'anchored' : 'anchorless'}: ${a.name} / ${b.name}`;

          assert.deepEqual(state.loops, loops.map(l => ({ loopId: l.loopId, terminal: isTerminalLoop(enrichLoop(l)) })), label);
          const expected = sessionIsTerminal(session) && state.loops.length > 0 && state.loops.every(l => l.terminal);
          assert.equal(state.settled, expected, label);
          assert.equal(state.settled, state.loops.every(l => l.terminal), `${label}: with every loop counted, settled is every-terminal`);
          assert.equal(sessionIsSettled(session), state.settled, label);
        }
      }
    }
  });

  test('a markerless complete follow-up settles an anchored session (no second definition of terminal)', () => {
    const session = { sessionId: SID, loops: [anchor(done), loop('follow-up', { agentState: 'complete', terminalStatus: null })] };
    assert.equal(sessionIsSettled(session), true);
  });
});

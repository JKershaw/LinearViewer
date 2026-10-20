/**
 * Replay pin for the LIN-3717 move: the loop-terminal checks that lived in
 * routes/dashboard.js and the census seed that lived in routes/flight-companion.js
 * now live in lib/run-loop-state.js and lib/flight-companion-census-seed.js.
 *
 * Every expected value below is an inline literal captured from the OLD route
 * code before the move. The base-code replay (the same rows run through
 * `git archive` of the base commit, outside the suite) is a one-off recorded in
 * the LIN-3717 PR: CI checks out at depth 1, so it cannot run in this file.
 *
 * Odd behaviour is pinned on purpose (e.g. `enrichLoop(null)` throws, a bookkeeping
 * stamp without `at` completes at null): the move is byte for byte, so a change
 * here is a behaviour change and needs its own ticket.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as dashboard from '../../routes/dashboard.js';
import * as flightCompanion from '../../routes/flight-companion.js';
// [name, input loop, expected enrichLoop(loop), expected isTerminalLoop(loop)]
const LOOP_ROWS = [
  ['agentState complete', {
      loopId: 'a',
      agentState: 'complete',
      dispatchedAt: '2026-01-01T00:00:00Z',
      resolvedAt: '2026-01-01T01:00:00Z'
    },
    {
      loopId: 'a',
      agentState: 'complete',
      dispatchedAt: '2026-01-01T00:00:00Z',
      resolvedAt: '2026-01-01T01:00:00Z',
      completedAt: '2026-01-01T01:00:00Z'
    },
    true],
  ['agentState error', { loopId: 'a', agentState: 'error', resolvedAt: '2026-01-01T01:00:00Z' },
    {
      loopId: 'a',
      agentState: 'error',
      resolvedAt: '2026-01-01T01:00:00Z',
      completedAt: '2026-01-01T01:00:00Z'
    },
    true],
  ['agentState error no resolvedAt', { loopId: 'a', agentState: 'error' },
    { loopId: 'a', agentState: 'error', completedAt: null },
    true],
  ['agentState running', { loopId: 'a', agentState: 'running', resolvedAt: '2026-01-01T01:00:00Z' },
    {
      loopId: 'a',
      agentState: 'running',
      resolvedAt: '2026-01-01T01:00:00Z',
      completedAt: null
    },
    false],
  ['agentState waiting', { loopId: 'a', agentState: 'waiting' },
    { loopId: 'a', agentState: 'waiting', completedAt: null },
    false],
  ['agentState absent', { loopId: 'a' },
    { loopId: 'a', agentState: undefined, completedAt: null },
    false],
  ['terminalStatus undefined, feedback [done]', {
      loopId: 'a',
      agentState: 'running',
      feedback: [{ message: '[done] finished', timestamp: '2026-01-02T00:00:00Z', agent: 'x' }]
    },
    {
      loopId: 'a',
      agentState: 'complete',
      feedback: [{ message: '[done] finished', timestamp: '2026-01-02T00:00:00Z', agent: 'x' }],
      completedAt: '2026-01-02T00:00:00Z'
    },
    false],
  ['terminalStatus undefined, feedback [failed]', {
      loopId: 'a',
      agentState: 'running',
      feedback: [{ message: '[failed] boom', timestamp: '2026-01-02T00:00:01Z', agent: 'x' }]
    },
    {
      loopId: 'a',
      agentState: 'error',
      feedback: [{ message: '[failed] boom', timestamp: '2026-01-02T00:00:01Z', agent: 'x' }],
      completedAt: '2026-01-02T00:00:01Z'
    },
    false],
  ['terminalStatus undefined, feedback [aborted]', {
      loopId: 'a',
      agentState: 'running',
      feedback: [{ message: '[aborted] stop', timestamp: '2026-01-02T00:00:02Z', agent: 'x' }]
    },
    {
      loopId: 'a',
      agentState: 'error',
      feedback: [{ message: '[aborted] stop', timestamp: '2026-01-02T00:00:02Z', agent: 'x' }],
      completedAt: '2026-01-02T00:00:02Z'
    },
    false],
  ['terminalStatus undefined, feedback [skipped]', {
      loopId: 'a',
      agentState: 'running',
      feedback: [{ message: '[skipped] human continued', timestamp: '2026-01-02T00:00:03Z', agent: 'x' }]
    },
    {
      loopId: 'a',
      agentState: 'complete',
      feedback: [{ message: '[skipped] human continued', timestamp: '2026-01-02T00:00:03Z', agent: 'x' }],
      completedAt: '2026-01-02T00:00:03Z'
    },
    false],
  ['terminalStatus undefined, no feedback', { loopId: 'a', agentState: 'running' },
    { loopId: 'a', agentState: 'running', completedAt: null },
    false],
  ['terminalStatus undefined, non-terminal feedback', {
      loopId: 'a',
      agentState: 'waiting',
      feedback: [{ message: '[progress] working', timestamp: '2026-01-02T00:00:04Z', agent: 'x' }]
    },
    {
      loopId: 'a',
      agentState: 'waiting',
      feedback: [{ message: '[progress] working', timestamp: '2026-01-02T00:00:04Z', agent: 'x' }],
      completedAt: null
    },
    false],
  ['terminalStatus null', {
      loopId: 'a',
      agentState: 'running',
      terminalStatus: null,
      feedback: [{ message: '[done] ignored', timestamp: '2026-01-02T00:00:05Z', agent: 'x' }]
    },
    {
      loopId: 'a',
      agentState: 'running',
      terminalStatus: null,
      feedback: [{ message: '[done] ignored', timestamp: '2026-01-02T00:00:05Z', agent: 'x' }],
      completedAt: '2026-01-02T00:00:05Z'
    },
    false],
  ['terminalStatus done', { loopId: 'a', agentState: 'running', terminalStatus: 'done' },
    { loopId: 'a', agentState: 'complete', terminalStatus: 'done', completedAt: null },
    false],
  ['terminalStatus failed', { loopId: 'a', agentState: 'running', terminalStatus: 'failed' },
    { loopId: 'a', agentState: 'error', terminalStatus: 'failed', completedAt: null },
    false],
  ['terminalStatus aborted', { loopId: 'a', agentState: 'running', terminalStatus: 'aborted' },
    { loopId: 'a', agentState: 'error', terminalStatus: 'aborted', completedAt: null },
    false],
  ['terminalStatus skipped', { loopId: 'a', agentState: 'waiting', terminalStatus: 'skipped' },
    { loopId: 'a', agentState: 'complete', terminalStatus: 'skipped', completedAt: null },
    false],
  ['terminalCompletedAt undefined, feedback marker', {
      loopId: 'a',
      agentState: 'running',
      feedback: [{ message: '[done] x', timestamp: '2026-01-03T00:00:00Z', agent: 'x' }]
    },
    {
      loopId: 'a',
      agentState: 'complete',
      feedback: [{ message: '[done] x', timestamp: '2026-01-03T00:00:00Z', agent: 'x' }],
      completedAt: '2026-01-03T00:00:00Z'
    },
    false],
  ['terminalCompletedAt null', {
      loopId: 'a',
      agentState: 'complete',
      terminalCompletedAt: null,
      resolvedAt: '2026-01-03T01:00:00Z',
      feedback: [{ message: '[done] x', timestamp: '2026-01-03T00:00:00Z', agent: 'x' }]
    },
    {
      loopId: 'a',
      agentState: 'complete',
      terminalCompletedAt: null,
      resolvedAt: '2026-01-03T01:00:00Z',
      feedback: [{ message: '[done] x', timestamp: '2026-01-03T00:00:00Z', agent: 'x' }],
      completedAt: '2026-01-03T01:00:00Z'
    },
    true],
  ['terminalCompletedAt set', {
      loopId: 'a',
      agentState: 'complete',
      terminalCompletedAt: '2026-01-03T02:00:00Z',
      resolvedAt: '2026-01-03T01:00:00Z'
    },
    {
      loopId: 'a',
      agentState: 'complete',
      terminalCompletedAt: '2026-01-03T02:00:00Z',
      resolvedAt: '2026-01-03T01:00:00Z',
      completedAt: '2026-01-03T02:00:00Z'
    },
    true],
  ['bookkeeping closed with at', {
      loopId: 'a',
      agentState: 'running',
      bookkeeping: { at: '2026-01-04T00:00:00Z' },
      resolvedAt: '2026-01-04T01:00:00Z'
    },
    {
      loopId: 'a',
      agentState: 'complete',
      bookkeeping: { at: '2026-01-04T00:00:00Z' },
      resolvedAt: '2026-01-04T01:00:00Z',
      completedAt: '2026-01-04T00:00:00Z'
    },
    true],
  ['bookkeeping closed without at', {
      loopId: 'a',
      agentState: 'running',
      bookkeeping: {},
      resolvedAt: '2026-01-04T01:00:00Z'
    },
    {
      loopId: 'a',
      agentState: 'complete',
      bookkeeping: {},
      resolvedAt: '2026-01-04T01:00:00Z',
      completedAt: null
    },
    true],
  ['bookkeeping closed, marker wins state', {
      loopId: 'a',
      agentState: 'running',
      bookkeeping: { at: '2026-01-04T00:00:00Z' },
      terminalStatus: 'failed',
      terminalCompletedAt: null
    },
    {
      loopId: 'a',
      agentState: 'error',
      bookkeeping: { at: '2026-01-04T00:00:00Z' },
      terminalStatus: 'failed',
      terminalCompletedAt: null,
      completedAt: '2026-01-04T00:00:00Z'
    },
    true],
  ['complete with resolvedAt absent', { loopId: 'a', agentState: 'complete' },
    { loopId: 'a', agentState: 'complete', completedAt: null },
    true],
  ['error with extra fields kept', {
      loopId: 'a',
      agentState: 'error',
      resolvedAt: '2026-01-05T00:00:00Z',
      issueIdentifier: 'LIN-1',
      completedAt: 'stale'
    },
    {
      loopId: 'a',
      agentState: 'error',
      resolvedAt: '2026-01-05T00:00:00Z',
      issueIdentifier: 'LIN-1',
      completedAt: '2026-01-05T00:00:00Z'
    },
    true]
];

// [name, input session, expected sessionIsTerminal(session)]
const SESSION_ROWS = [
  ['anchor terminal', {
      sessionId: 's1',
      loops: [
        { loopId: 's1', agentState: 'complete', kind: 'autopilot' },
        { loopId: 'c1', agentState: 'running' }
      ]
    }, true],
  ['anchor not terminal, children terminal', {
      sessionId: 's1',
      loops: [
        { loopId: 's1', agentState: 'running', kind: 'autopilot' },
        { loopId: 'c1', agentState: 'complete' }
      ]
    }, false],
  ['anchor terminal by marker', {
      sessionId: 's1',
      loops: [{ loopId: 's1', agentState: 'running', kind: 'autopilot', terminalStatus: 'done' }]
    }, true],
  ['anchor closed by bookkeeping', {
      sessionId: 's1',
      loops: [{ loopId: 's1', agentState: 'running', kind: 'autopilot', bookkeeping: {} }]
    }, true],
  ['anchorless all terminal', {
      sessionId: 's2',
      loops: [{ loopId: 'c1', agentState: 'complete' }, { loopId: 'c2', agentState: 'error' }]
    }, true],
  ['anchorless mixed', {
      sessionId: 's2',
      loops: [{ loopId: 'c1', agentState: 'complete' }, { loopId: 'c2', agentState: 'running' }]
    }, false],
  ['anchorless all terminal by marker', {
      sessionId: 's2',
      loops: [
        { loopId: 'c1', agentState: 'running', terminalStatus: 'skipped' },
        { loopId: 'c2', agentState: 'waiting', terminalStatus: 'aborted' }
      ]
    }, true],
  ['autopilot loop id differs from sessionId', { sessionId: 's3', loops: [{ loopId: 'zz', agentState: 'complete', kind: 'autopilot' }] }, true],
  ['empty loops', { sessionId: 's4', loops: [] }, false],
  ['no loops key', { sessionId: 's4' }, false],
  ['null session', null, false],
  ['undefined session', undefined, false]
];

// [name, input census doc, expected buildCensusSeedText(doc)]
const CENSUS_ROWS = [
  ['null doc', null,
    'CURRENT CENSUS: not available yet for this workspace (no sweep has run).'],
  ['undefined doc', undefined,
    'CURRENT CENSUS: not available yet for this workspace (no sweep has run).'],
  ['empty doc', {},
    'CURRENT CENSUS (authoritative — these numbers are ground truth; narrate them, never recompute or restate them differently):\n  working: 0\n  silent: 0\n  blocked: 0\n  terminal: 0\n  queued: 0\n  resolved: 0\n  unknown: 0\n  attention items: 0\n  census revision: undefined\nVOCABULARY: these lanes count dispatch loops (runs) — not sessions (one session spans several loops) and not tasks. "silent" and "terminal" include historical bookkeeping. "blocked" means parked waiting on a human: alive, not dead.'],
  ['empty attention', {
      rev: 'r1',
      state: {
        lanes: { working: 1, silent: 2, blocked: 0, terminal: 30, queued: 4, resolved: 5, unknown: 6 },
        attention: []
      }
    },
    'CURRENT CENSUS (authoritative — these numbers are ground truth; narrate them, never recompute or restate them differently):\n  working: 1\n  silent: 2\n  blocked: 0\n  terminal: 30\n  queued: 4\n  resolved: 5\n  unknown: 6\n  attention items: 0\n  census revision: r1\nVOCABULARY: these lanes count dispatch loops (runs) — not sessions (one session spans several loops) and not tasks. "silent" and "terminal" include historical bookkeeping. "blocked" means parked waiting on a human: alive, not dead.'],
  ['attention rows full', {
      rev: 'r2',
      state: {
        lanes: { working: 1, silent: 2, blocked: 3, terminal: 4, queued: 5, resolved: 6, unknown: 7 },
        attention: [
          {
            loopId: 'L1',
            issue: 'LIN-1',
            lane: 'blocked',
            stage: 'review',
            since: '2026-02-01T00:00:00Z'
          },
          {
            loopId: 'L2',
            issue: 'LIN-2',
            lane: 'silent',
            stage: 'impl',
            since: '2026-02-02T00:00:00Z'
          }
        ]
      }
    },
    'CURRENT CENSUS (authoritative — these numbers are ground truth; narrate them, never recompute or restate them differently):\n  working: 1\n  silent: 2\n  blocked: 3\n  terminal: 4\n  queued: 5\n  resolved: 6\n  unknown: 7\n  attention items: 2\nATTENTION ROWS (each is a real run — name the task, never just the count):\n  - LIN-1 · blocked · stage review · since 2026-02-01T00:00:00Z · loop L1\n  - LIN-2 · silent · stage impl · since 2026-02-02T00:00:00Z · loop L2\n  census revision: r2\nVOCABULARY: these lanes count dispatch loops (runs) — not sessions (one session spans several loops) and not tasks. "silent" and "terminal" include historical bookkeeping. "blocked" means parked waiting on a human: alive, not dead.'],
  ['rows missing since, lane, stage, issue', {
      rev: 'r3',
      state: {
        lanes: { working: 0 },
        attention: [
          { loopId: 'L1', issue: 'LIN-1', lane: 'blocked', stage: 'review' },
          { loopId: 'L2', issue: 'LIN-2', stage: 'impl', since: '2026-02-02T00:00:00Z' },
          { loopId: 'L3', issue: 'LIN-3', lane: 'silent', since: '2026-02-03T00:00:00Z' },
          { loopId: 'L4', lane: 'silent', stage: 'x', since: '2026-02-04T00:00:00Z' }
        ]
      }
    },
    'CURRENT CENSUS (authoritative — these numbers are ground truth; narrate them, never recompute or restate them differently):\n  working: 0\n  silent: 0\n  blocked: 0\n  terminal: 0\n  queued: 0\n  resolved: 0\n  unknown: 0\n  attention items: 4\nATTENTION ROWS (each is a real run — name the task, never just the count):\n  - LIN-1 · blocked · stage review · since unknown · loop L1\n  - LIN-2 · unknown lane · stage impl · since 2026-02-02T00:00:00Z · loop L2\n  - LIN-3 · silent · stage unknown · since 2026-02-03T00:00:00Z · loop L3\n  - (no task) · silent · stage x · since 2026-02-04T00:00:00Z · loop L4\n  census revision: r3\nVOCABULARY: these lanes count dispatch loops (runs) — not sessions (one session spans several loops) and not tasks. "silent" and "terminal" include historical bookkeeping. "blocked" means parked waiting on a human: alive, not dead.'],
  ['rows without loopId, null rows dropped', {
      rev: 'r4',
      state: {
        lanes: {},
        attention: [
          null,
          'x',
          { issue: 'LIN-9' },
          { loopId: '', issue: 'LIN-8' },
          { loopId: 'L1', issue: 'LIN-1' }
        ]
      }
    },
    'CURRENT CENSUS (authoritative — these numbers are ground truth; narrate them, never recompute or restate them differently):\n  working: 0\n  silent: 0\n  blocked: 0\n  terminal: 0\n  queued: 0\n  resolved: 0\n  unknown: 0\n  attention items: 1\nATTENTION ROWS (each is a real run — name the task, never just the count):\n  - LIN-1 · unknown lane · stage unknown · since unknown · loop L1\n  census revision: r4\nVOCABULARY: these lanes count dispatch loops (runs) — not sessions (one session spans several loops) and not tasks. "silent" and "terminal" include historical bookkeeping. "blocked" means parked waiting on a human: alive, not dead.'],
  ['truncated', {
      rev: 'r5',
      state: {
        lanes: { working: 9 },
        truncated: true,
        attention: [{ loopId: 'L1', issue: 'LIN-1', lane: 'working', stage: 's', since: 't' }]
      }
    },
    'CURRENT CENSUS (authoritative — these numbers are ground truth; narrate them, never recompute or restate them differently):\n  working: 9\n  silent: 0\n  blocked: 0\n  terminal: 0\n  queued: 0\n  resolved: 0\n  unknown: 0\n  attention items: 1 (list truncated)\nATTENTION ROWS (each is a real run — name the task, never just the count):\n  - LIN-1 · working · stage s · since t · loop L1\n  census revision: r5\nVOCABULARY: these lanes count dispatch loops (runs) — not sessions (one session spans several loops) and not tasks. "silent" and "terminal" include historical bookkeeping. "blocked" means parked waiting on a human: alive, not dead.'],
  ['stale attention fields', {
      rev: 'r6',
      state: {
        lanes: { working: 1 },
        attention: [],
        staleAttentionCount: 313,
        staleAttentionThresholdMs: 604800000
      }
    },
    'CURRENT CENSUS (authoritative — these numbers are ground truth; narrate them, never recompute or restate them differently):\n  working: 1\n  silent: 0\n  blocked: 0\n  terminal: 0\n  queued: 0\n  resolved: 0\n  unknown: 0\n  attention items: 0\n  +313 silent / blocked rows older than 7d, not listed (folded by the census, NOT in the attention rows above — a short attention list can mean a calm fleet or a fossilised one, and this is which)\n  census revision: r6\nVOCABULARY: these lanes count dispatch loops (runs) — not sessions (one session spans several loops) and not tasks. "silent" and "terminal" include historical bookkeeping. "blocked" means parked waiting on a human: alive, not dead.'],
  ['stale attention count without threshold', { rev: 'r7', state: { lanes: { working: 1 }, attention: [], staleAttentionCount: 5 } },
    'CURRENT CENSUS (authoritative — these numbers are ground truth; narrate them, never recompute or restate them differently):\n  working: 1\n  silent: 0\n  blocked: 0\n  terminal: 0\n  queued: 0\n  resolved: 0\n  unknown: 0\n  attention items: 0\n  +5 silent / blocked rows older than the staleness threshold, not listed (folded by the census, NOT in the attention rows above — a short attention list can mean a calm fleet or a fossilised one, and this is which)\n  census revision: r7\nVOCABULARY: these lanes count dispatch loops (runs) — not sessions (one session spans several loops) and not tasks. "silent" and "terminal" include historical bookkeeping. "blocked" means parked waiting on a human: alive, not dead.'],
  ['stale attention zero', {
      rev: 'r8',
      state: {
        lanes: { working: 1 },
        attention: [],
        staleAttentionCount: 0,
        staleAttentionThresholdMs: 1000
      }
    },
    'CURRENT CENSUS (authoritative — these numbers are ground truth; narrate them, never recompute or restate them differently):\n  working: 1\n  silent: 0\n  blocked: 0\n  terminal: 0\n  queued: 0\n  resolved: 0\n  unknown: 0\n  attention items: 0\n  census revision: r8\nVOCABULARY: these lanes count dispatch loops (runs) — not sessions (one session spans several loops) and not tasks. "silent" and "terminal" include historical bookkeeping. "blocked" means parked waiting on a human: alive, not dead.'],
  ['attention not an array', { rev: 'r9', state: { lanes: {}, attention: 'nope' } },
    'CURRENT CENSUS (authoritative — these numbers are ground truth; narrate them, never recompute or restate them differently):\n  working: 0\n  silent: 0\n  blocked: 0\n  terminal: 0\n  queued: 0\n  resolved: 0\n  unknown: 0\n  attention items: 0\n  census revision: r9\nVOCABULARY: these lanes count dispatch loops (runs) — not sessions (one session spans several loops) and not tasks. "silent" and "terminal" include historical bookkeeping. "blocked" means parked waiting on a human: alive, not dead.']
];

test('enrichLoop / isTerminalLoop match the captured literals, row by row', async (t) => {
  for (const [name, loop, enriched, terminal] of LOOP_ROWS) {
    await t.test(name, () => {
      const before = structuredClone(loop);
      const out = dashboard.enrichLoop(loop);
      assert.deepStrictEqual(out, enriched);
      assert.notStrictEqual(out, loop, 'enrichLoop returns a copy');
      assert.deepStrictEqual(loop, before, 'the stored record is never mutated');
      assert.strictEqual(dashboard.isTerminalLoop(loop), terminal);
    });
  }
});

test('isTerminalLoop: a missing loop is not terminal', () => {
  assert.strictEqual(dashboard.isTerminalLoop(null), false);
  assert.strictEqual(dashboard.isTerminalLoop(undefined), false);
});

test('enrichLoop(null) throws TypeError today (the move must not soften it)', () => {
  assert.throws(() => dashboard.enrichLoop(null), TypeError);
  assert.throws(() => dashboard.enrichLoop(undefined), TypeError);
});

test('sessionIsTerminal matches the captured literals, row by row', async (t) => {
  for (const [name, session, expected] of SESSION_ROWS) {
    await t.test(name, () => {
      assert.strictEqual(dashboard.sessionIsTerminal(session), expected);
    });
  }
});

test('buildCensusSeedText matches the captured literals, row by row', async (t) => {
  for (const [name, doc, expected] of CENSUS_ROWS) {
    await t.test(name, () => {
      assert.strictEqual(flightCompanion.buildCensusSeedText(doc), expected);
    });
  }
});

/**
 * Unit tests for autopilot session reconstruction in lib/pipeline-loops.js (LIN-591).
 *
 * Run with: node --test tests/unit/pipeline-sessions.test.js
 *
 * Coverage (fixtures-only — drives _buildLoops with injected dispatch items,
 * then _buildSessions, exactly like the existing pipeline-loops.test.js pattern;
 * no proxy, no token, no network):
 *   - sessionId carried through _buildLoops onto the Loop record
 *   - explicit sessionId grouping of a multi-task breakdown / spin-off run
 *   - inference fallback over an injected issue graph (descendant attach,
 *     out-of-window exclude, non-hierarchical exclude)
 *   - a worker stamped for another session is never stolen by inference
 *   - orphan sessionId group (orchestrator aged out) → anchorless session
 *   - completedAt derives from terminal feedback, never take-time resolvedAt
 *   - follow-up thread stitching by followUpTo (LIN-1292): single follow-up,
 *     chained follow-ups, stitching into an existing autopilot session,
 *     aged-out anchor fallback, and no-double-claim
 *   - getSessionsForWorkspace public API with mock stores
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { getSessionsForWorkspace, __internal } from '../../lib/pipeline-loops.js';

const { _buildLoops, _buildSessions } = __internal;

// ─── Fixture helpers ─────────────────────────────────────────────────────────

const EPIC = 'LIN-590';     // autopilot seed (an epic)
const CHILD = 'LIN-591';    // a subtask of the epic
const SPAWNED = 'LIN-595';  // an issue spawned mid-run by a breakdown (grandchild)
const UNRELATED = 'LIN-700'; // not in the epic's subtree
const SESSION_ID = 'ap-1';  // == the autopilot orchestrator's dispatch id

const T0 = '2026-06-22T10:00:00.000Z';      // orchestrator dispatched
const AP_DONE = '2026-06-22T13:00:00.000Z'; // orchestrator terminal feedback (window end)
const NOW = new Date('2026-06-22T14:00:00.000Z');

// An injected, network-free issue graph: SPAWNED → CHILD → EPIC.
const ISSUE_GRAPH = { parentOf: { [CHILD]: EPIC, [SPAWNED]: CHILD, [UNRELATED]: null } };

function done(timestamp, message = '[done] complete') {
  return [{ message, url: null, urlLabel: null, timestamp }];
}

function orchestrator(overrides = {}) {
  return {
    id: SESSION_ID,
    promptName: 'autopilot',
    prompt: 'autopilot kickoff',
    issueIdentifier: EPIC,
    issueTitle: 'Epic',
    issueUrl: null,
    dispatchedAt: T0,
    target: 'cli',
    repo: null,
    status: 'taken',
    resolvedAt: '2026-06-22T10:01:00.000Z', // take-time — NOT completion
    kind: 'autopilot',
    sessionId: null,
    feedback: done(AP_DONE),
    ...overrides
  };
}

function worker(id, issueIdentifier, dispatchedAt, overrides = {}) {
  return {
    id,
    promptName: 'implementation',
    prompt: 'work',
    issueIdentifier,
    issueTitle: null,
    issueUrl: null,
    dispatchedAt,
    target: 'cli',
    repo: null,
    status: 'taken',
    resolvedAt: dispatchedAt, // take-time lands right after dispatch
    kind: 'implementation',
    sessionId: null,
    feedback: done(new Date(new Date(dispatchedAt).getTime() + 30 * 60000).toISOString()),
    ...overrides
  };
}

function loopsFrom(historyItems) {
  return _buildLoops({ historyItems, now: NOW });
}

// ─── sessionId pass-through ───────────────────────────────────────────────────

describe('sessionId on the Loop record', () => {
  test('_buildLoops carries sessionId through from the dispatch item', () => {
    const [loop] = loopsFrom([worker('w1', CHILD, '2026-06-22T10:30:00.000Z', { sessionId: SESSION_ID })]);
    assert.strictEqual(loop.sessionId, SESSION_ID);
  });

  test('sessionId defaults to null when absent', () => {
    const [loop] = loopsFrom([worker('w1', CHILD, '2026-06-22T10:30:00.000Z')]);
    assert.strictEqual(loop.sessionId, null);
  });
});

// ─── Explicit grouping: the breakdown / spin-off keystone case ────────────────

describe('explicit sessionId grouping (multi-task / spin-off)', () => {
  test('an epic descent that spawns a subtask reconstructs as ONE session', () => {
    const loops = loopsFrom([
      orchestrator(),
      worker('w1', CHILD, '2026-06-22T10:30:00.000Z', { sessionId: SESSION_ID }),
      worker('w2', CHILD, '2026-06-22T11:30:00.000Z', { sessionId: SESSION_ID, promptName: 'breakdown', kind: 'breakdown' }),
      // The breakdown spawned LIN-595; a later worker targets that brand-new issue.
      worker('w3', SPAWNED, '2026-06-22T12:00:00.000Z', { sessionId: SESSION_ID })
    ]);
    // No issue graph needed: explicit sessionId groups across identifiers.
    const sessions = _buildSessions(loops, { now: NOW });

    assert.strictEqual(sessions.length, 1);
    const s = sessions[0];
    assert.strictEqual(s.sessionId, SESSION_ID);
    assert.strictEqual(s.seedIssue, EPIC);
    assert.strictEqual(s.loops.length, 4); // orchestrator + 3 workers
    // All touched tasks attached, seed first.
    assert.deepStrictEqual(s.tasksTouched, [EPIC, CHILD, SPAWNED]);
    assert.strictEqual(s.dispatchedAt, T0);
  });

  test('completedAt is the latest terminal feedback time, not take-time resolvedAt', () => {
    const loops = loopsFrom([
      orchestrator(),
      worker('w1', CHILD, '2026-06-22T10:30:00.000Z', { sessionId: SESSION_ID })
    ]);
    const [s] = _buildSessions(loops, { now: NOW });
    // Orchestrator's [done] at 13:00 is the latest; resolvedAt values are far earlier.
    assert.strictEqual(s.completedAt, AP_DONE);
  });

  test('completedAt stays null while any subtask loop is still unfinished (LIN-637)', () => {
    const loops = loopsFrom([
      orchestrator(),
      // w1 finished, but w2 has NO terminal feedback marker — still running.
      worker('w1', CHILD, '2026-06-22T10:30:00.000Z', { sessionId: SESSION_ID }),
      worker('w2', SPAWNED, '2026-06-22T11:30:00.000Z', { sessionId: SESSION_ID, feedback: [] })
    ]);
    const [s] = _buildSessions(loops, { now: NOW });
    // One subtask terminal + others still in progress must NOT report done.
    assert.strictEqual(s.completedAt, null);
  });

  test('completedAt is the latest terminal time once every loop is terminal (LIN-637)', () => {
    const loops = loopsFrom([
      orchestrator(),
      worker('w1', CHILD, '2026-06-22T10:30:00.000Z', { sessionId: SESSION_ID }),
      worker('w2', SPAWNED, '2026-06-22T11:30:00.000Z', { sessionId: SESSION_ID })
    ]);
    const [s] = _buildSessions(loops, { now: NOW });
    // All loops terminal → latest marker is the orchestrator's [done] at 13:00.
    assert.strictEqual(s.completedAt, AP_DONE);
  });
});

// ─── Inference fallback (historical data, no sessionId) ───────────────────────

describe('inference fallback over an injected issue graph', () => {
  test('attaches descendant workers inside the run window; excludes others', () => {
    const loops = loopsFrom([
      orchestrator(), // historical: no sessionId stamped on workers
      worker('w1', CHILD, '2026-06-22T10:30:00.000Z'),        // descendant, in window → attach
      worker('w2', SPAWNED, '2026-06-22T12:00:00.000Z'),      // grandchild, in window → attach
      worker('w3', UNRELATED, '2026-06-22T11:00:00.000Z'),    // not in subtree → exclude
      worker('w4', CHILD, '2026-06-22T13:30:00.000Z')         // descendant but AFTER window end → exclude
    ]);
    const sessions = _buildSessions(loops, { issueGraph: ISSUE_GRAPH, now: NOW });

    // The ap-1 autopilot session's loop set is the regression pin — unchanged by
    // the LIN-1194 standalone pass (find it by id; it is no longer sessions[0]
    // now that the excluded workers form their own sessions).
    const s = sessions.find(x => x.sessionId === SESSION_ID);
    assert.strictEqual(s.sessionId, SESSION_ID); // stable id == orchestrator loopId
    assert.strictEqual(s.seedIssue, EPIC);
    const ids = s.loops.map(l => l.loopId).sort();
    assert.deepStrictEqual(ids, ['ap-1', 'w1', 'w2']);
    assert.deepStrictEqual(s.tasksTouched, [EPIC, CHILD, SPAWNED]);

    // LIN-1194: w3 (unrelated) and w4 (descendant but dispatched AFTER the window
    // end) are claimed by no autopilot session, so they now reconstruct as their
    // OWN standalone single-loop sessions keyed by their dispatch id — never
    // absorbed into ap-1, and no longer silently dropped.
    assert.ok(sessions.find(x => x.sessionId === 'w3' && x.loops.length === 1), 'unrelated worker → standalone session');
    assert.ok(sessions.find(x => x.sessionId === 'w4' && x.loops.length === 1), 'out-of-window worker → standalone session');
  });

  test('without an issue graph, inference attaches only the seed issue\'s own loops', () => {
    const loops = loopsFrom([
      orchestrator(),
      worker('w1', EPIC, '2026-06-22T10:30:00.000Z'),  // same issue as seed → attach
      worker('w2', CHILD, '2026-06-22T11:00:00.000Z')  // descendant, but no graph → cannot attach
    ]);
    const sessions = _buildSessions(loops, { now: NOW });
    const s = sessions.find(x => x.sessionId === SESSION_ID);
    assert.deepStrictEqual(s.loops.map(l => l.loopId).sort(), ['ap-1', 'w1']);
    // LIN-1194: w2 (a descendant, unreachable without an injected graph) is
    // unclaimed → its own standalone session, not silently dropped.
    assert.ok(sessions.find(x => x.sessionId === 'w2' && x.loops.length === 1), 'ungraphed descendant → standalone session');
  });

  test('a worker stamped for another session is never stolen by inference', () => {
    const loops = loopsFrom([
      orchestrator(),
      worker('w1', CHILD, '2026-06-22T10:30:00.000Z', { sessionId: 'other-session' })
    ]);
    const sessions = _buildSessions(loops, { issueGraph: ISSUE_GRAPH, now: NOW });
    // w1 is a descendant in window, but explicitly owned by 'other-session', so
    // the ap-1 session must not absorb it — w1 forms its own orphan session.
    const apSession = sessions.find(s => s.sessionId === SESSION_ID);
    assert.deepStrictEqual(apSession.loops.map(l => l.loopId), ['ap-1']);
    const other = sessions.find(s => s.sessionId === 'other-session');
    assert.deepStrictEqual(other.loops.map(l => l.loopId), ['w1']);
  });
});

// ─── Orphan sessionId groups ──────────────────────────────────────────────────

describe('orphan sessionId group (orchestrator absent)', () => {
  test('workers referencing an aged-out orchestrator form an anchorless session', () => {
    const loops = loopsFrom([
      worker('w1', CHILD, '2026-06-22T10:30:00.000Z', { sessionId: 'ghost' }),
      worker('w2', SPAWNED, '2026-06-22T11:00:00.000Z', { sessionId: 'ghost' })
    ]);
    const sessions = _buildSessions(loops, { now: NOW });

    assert.strictEqual(sessions.length, 1);
    assert.strictEqual(sessions[0].sessionId, 'ghost');
    assert.strictEqual(sessions[0].seedIssue, null);
    assert.strictEqual(sessions[0].loops.length, 2);
  });
});

// ─── Standalone single-loop sessions (LIN-1194) ───────────────────────────────

describe('standalone single-loop sessions (LIN-1194)', () => {
  test('an unclaimed non-autopilot cli prompt becomes its own single-loop session keyed by its dispatch id', () => {
    const loops = loopsFrom([
      worker('m1', UNRELATED, '2026-06-22T11:00:00.000Z') // no sessionId, kind implementation, cli
    ]);
    const sessions = _buildSessions(loops, { now: NOW });
    assert.strictEqual(sessions.length, 1);
    const s = sessions[0];
    assert.strictEqual(s.sessionId, 'm1');            // keyed by its own loopId
    assert.strictEqual(s.loops.length, 1);
    assert.strictEqual(s.loops[0].loopId, 'm1');
    assert.deepStrictEqual(s.tasksTouched, [UNRELATED]);
  });

  test('a web-target standalone prompt is included', () => {
    const loops = loopsFrom([
      worker('m1', UNRELATED, '2026-06-22T11:00:00.000Z', { target: 'web' })
    ]);
    const sessions = _buildSessions(loops, { now: NOW });
    assert.deepStrictEqual(sessions.map(s => s.sessionId), ['m1']);
  });

  test('dash/local standalone dispatches are NOT emitted (no live session identity, V1)', () => {
    const loops = loopsFrom([
      worker('d1', UNRELATED, '2026-06-22T11:00:00.000Z', { target: 'dash' }),
      worker('l1', CHILD, '2026-06-22T11:05:00.000Z', { target: 'local' })
    ]);
    const sessions = _buildSessions(loops, { now: NOW });
    assert.strictEqual(sessions.length, 0);
  });

  test('a loop already claimed by an autopilot session is never double-emitted as standalone', () => {
    const loops = loopsFrom([
      orchestrator(),
      worker('w1', CHILD, '2026-06-22T10:30:00.000Z', { sessionId: SESSION_ID })
    ]);
    const sessions = _buildSessions(loops, { now: NOW });
    // Exactly one session (the autopilot one); w1 is claimed, not standalone.
    assert.strictEqual(sessions.length, 1);
    assert.strictEqual(sessions[0].sessionId, SESSION_ID);
    assert.strictEqual(sessions[0].loops.length, 2);
  });

  test('an explicit-sessionId worker is grouped, not made standalone', () => {
    // Orchestrator absent → orphan group path (pass 2), still NOT a standalone.
    const loops = loopsFrom([
      worker('w1', CHILD, '2026-06-22T10:30:00.000Z', { sessionId: 'ghost' })
    ]);
    const sessions = _buildSessions(loops, { now: NOW });
    assert.strictEqual(sessions.length, 1);
    assert.strictEqual(sessions[0].sessionId, 'ghost'); // orphan group, keyed by sessionId
  });

  test('an autopilot orchestrator alone is its own session, never a standalone', () => {
    const loops = loopsFrom([orchestrator()]);
    const sessions = _buildSessions(loops, { now: NOW });
    assert.strictEqual(sessions.length, 1);
    assert.strictEqual(sessions[0].sessionId, SESSION_ID);
  });
});

// ─── Follow-up thread stitching (LIN-1292) ────────────────────────────────────

describe('followUpTo on the Loop record', () => {
  test('_buildLoops carries followUpTo through from the dispatch item', () => {
    const [loop] = loopsFrom([worker('w1', CHILD, '2026-06-22T10:30:00.000Z', { followUpTo: 'w0' })]);
    assert.strictEqual(loop.followUpTo, 'w0');
  });

  test('followUpTo defaults to null when absent', () => {
    const [loop] = loopsFrom([worker('w1', CHILD, '2026-06-22T10:30:00.000Z')]);
    assert.strictEqual(loop.followUpTo, null);
  });
});

describe('follow-up thread stitching by followUpTo (LIN-1292)', () => {
  test('a follow-up reply stitches into its anchor\'s standalone session', () => {
    const loops = loopsFrom([
      worker('orig', UNRELATED, '2026-06-22T11:00:00.000Z'),
      // The reply box posts with no sessionId — only followUpTo pointing at the original.
      worker('reply1', UNRELATED, '2026-06-22T11:30:00.000Z', { followUpTo: 'orig' })
    ]);
    const sessions = _buildSessions(loops, { now: NOW });

    assert.strictEqual(sessions.length, 1);
    const s = sessions[0];
    assert.strictEqual(s.sessionId, 'orig'); // keyed by the root anchor's loopId, not the reply's
    assert.deepStrictEqual(s.loops.map(l => l.loopId).sort(), ['orig', 'reply1']);
  });

  test('a chained follow-up thread (A <- B <- C) all stitches to the root', () => {
    const loops = loopsFrom([
      worker('a', UNRELATED, '2026-06-22T10:00:00.000Z'),
      worker('b', UNRELATED, '2026-06-22T10:30:00.000Z', { followUpTo: 'a' }),
      worker('c', UNRELATED, '2026-06-22T11:00:00.000Z', { followUpTo: 'b' })
    ]);
    const sessions = _buildSessions(loops, { now: NOW });

    assert.strictEqual(sessions.length, 1);
    const s = sessions[0];
    assert.strictEqual(s.sessionId, 'a');
    assert.deepStrictEqual(s.loops.map(l => l.loopId).sort(), ['a', 'b', 'c']);
  });

  test('a follow-up whose anchor has aged out of the window falls back to its own standalone session', () => {
    const loops = loopsFrom([
      // 'ghost-original' is not present in the loop set at all (outside the lookback window).
      worker('reply1', UNRELATED, '2026-06-22T11:30:00.000Z', { followUpTo: 'ghost-original' })
    ]);
    const sessions = _buildSessions(loops, { now: NOW });

    assert.strictEqual(sessions.length, 1);
    assert.strictEqual(sessions[0].sessionId, 'reply1'); // pass 3 standalone, not silently dropped
    assert.strictEqual(sessions[0].loops.length, 1);
  });

  test('a follow-up on an autopilot worker stitches into the existing autopilot session', () => {
    const loops = loopsFrom([
      orchestrator(),
      worker('w1', CHILD, '2026-06-22T10:30:00.000Z', { sessionId: SESSION_ID }),
      // A human follow-up reply to w1's dispatch: no sessionId of its own, so
      // without the stitch it would fall to pass 3 as a standalone session.
      worker('reply1', CHILD, '2026-06-22T11:00:00.000Z', { followUpTo: 'w1' })
    ]);
    const sessions = _buildSessions(loops, { now: NOW });

    const s = sessions.find(x => x.sessionId === SESSION_ID);
    assert.deepStrictEqual(s.loops.map(l => l.loopId).sort(), ['ap-1', 'reply1', 'w1']);
    assert.strictEqual(sessions.find(x => x.sessionId === 'reply1'), undefined, 'the follow-up must not also appear standalone');
  });

  test('a stitched loop is never double-emitted as its own standalone session', () => {
    const loops = loopsFrom([
      worker('orig', UNRELATED, '2026-06-22T11:00:00.000Z'),
      worker('reply1', UNRELATED, '2026-06-22T11:30:00.000Z', { followUpTo: 'orig' })
    ]);
    const sessions = _buildSessions(loops, { now: NOW });
    const allLoopIds = sessions.flatMap(s => s.loops.map(l => l.loopId));
    assert.deepStrictEqual(allLoopIds.sort(), ['orig', 'reply1']);
  });

  test('a dash/local-target follow-up is not stitched or emitted (no live session identity, V1)', () => {
    const loops = loopsFrom([
      worker('orig', UNRELATED, '2026-06-22T11:00:00.000Z', { target: 'dash' }),
      worker('reply1', UNRELATED, '2026-06-22T11:30:00.000Z', { target: 'dash', followUpTo: 'orig' })
    ]);
    const sessions = _buildSessions(loops, { now: NOW });
    assert.strictEqual(sessions.length, 0);
  });
});

// ─── Durable session-group stitch (LIN-1341) ───────────────────────────────────

describe('sessionGroupId on the Loop record', () => {
  test('_buildLoops carries sessionGroupId through from the dispatch item', () => {
    const [loop] = loopsFrom([worker('w1', CHILD, '2026-06-22T10:30:00.000Z', { sessionGroupId: 'grp-1' })]);
    assert.strictEqual(loop.sessionGroupId, 'grp-1');
  });

  test('sessionGroupId defaults to null when absent', () => {
    const [loop] = loopsFrom([worker('w1', CHILD, '2026-06-22T10:30:00.000Z')]);
    assert.strictEqual(loop.sessionGroupId, null);
  });
});

describe('durable-group follow-up stitch by sessionGroupId (LIN-1341)', () => {
  test('a stamped follow-up stitches into its anchor session by group id, O(1)', () => {
    const loops = loopsFrom([
      worker('orig', UNRELATED, '2026-06-22T11:00:00.000Z'),
      worker('reply1', UNRELATED, '2026-06-22T11:30:00.000Z', { followUpTo: 'orig', sessionGroupId: 'orig' })
    ]);
    const sessions = _buildSessions(loops, { now: NOW });

    assert.strictEqual(sessions.length, 1);
    const s = sessions[0];
    assert.strictEqual(s.sessionId, 'orig');
    assert.deepStrictEqual(s.loops.map(l => l.loopId).sort(), ['orig', 'reply1']);
  });

  test('a chained, stepper/drip-fed thread (A <- B <- C), all stamped with the root\'s group id, stitches to the root', () => {
    const loops = loopsFrom([
      worker('a', UNRELATED, '2026-06-22T10:00:00.000Z'),
      worker('b', UNRELATED, '2026-06-22T10:30:00.000Z', { followUpTo: 'a', sessionGroupId: 'a' }),
      worker('c', UNRELATED, '2026-06-22T11:00:00.000Z', { followUpTo: 'b', sessionGroupId: 'a' })
    ]);
    const sessions = _buildSessions(loops, { now: NOW });

    assert.strictEqual(sessions.length, 1);
    const s = sessions[0];
    assert.strictEqual(s.sessionId, 'a');
    assert.deepStrictEqual(s.loops.map(l => l.loopId).sort(), ['a', 'b', 'c']);
  });

  test('a chained thread\'s completedAt reflects the LATEST hop\'s terminal marker, not a stale root (LIN-1461)', () => {
    // LIN-1461: a consumer reading only the root dispatch's OWN record sees it
    // "done" at 10:05 and never learns the session kept going through two more
    // follow-ups. Observation grouping already resolves the full session via
    // sessionGroupId (no simple-dispatcher rootItemId needed) — this pins that
    // its derived completedAt tracks the true latest activity, so the session
    // never reads as frozen at the root's own stale completion.
    const loops = loopsFrom([
      worker('a', UNRELATED, '2026-06-22T10:00:00.000Z', { feedback: done('2026-06-22T10:05:00.000Z') }),
      worker('b', UNRELATED, '2026-06-22T10:30:00.000Z', { followUpTo: 'a', sessionGroupId: 'a', feedback: done('2026-06-22T10:45:00.000Z') }),
      worker('c', UNRELATED, '2026-06-22T11:00:00.000Z', { followUpTo: 'b', sessionGroupId: 'a', feedback: done('2026-06-22T11:20:00.000Z') })
    ]);
    const sessions = _buildSessions(loops, { now: NOW });

    assert.strictEqual(sessions.length, 1);
    const s = sessions[0];
    assert.strictEqual(s.sessionId, 'a');
    assert.deepStrictEqual(s.loops.map(l => l.loopId).sort(), ['a', 'b', 'c']);
    assert.strictEqual(s.completedAt, '2026-06-22T11:20:00.000Z');
  });

  test('a stamped follow-up on an autopilot worker composes with sessionId grouping (group id == the autopilot session id)', () => {
    const loops = loopsFrom([
      orchestrator(),
      worker('w1', CHILD, '2026-06-22T10:30:00.000Z', { sessionId: SESSION_ID }),
      // The worker's own group id is its sessionId (dispatch-store.js addItem
      // precedence); the reply inherits it, so it lands in the SAME autopilot
      // session without any special-casing in the stitch pass.
      worker('reply1', CHILD, '2026-06-22T11:00:00.000Z', { followUpTo: 'w1', sessionGroupId: SESSION_ID })
    ]);
    const sessions = _buildSessions(loops, { now: NOW });

    const s = sessions.find(x => x.sessionId === SESSION_ID);
    assert.deepStrictEqual(s.loops.map(l => l.loopId).sort(), ['ap-1', 'reply1', 'w1']);
    assert.strictEqual(sessions.find(x => x.sessionId === 'reply1'), undefined, 'the follow-up must not also appear standalone');
  });

  test('two stamped follow-ups whose root aged out of the window coalesce into ONE anchorless continuation (approved "root aged out" behavior)', () => {
    // 'ghost-original' is not present in the loop set (outside the lookback
    // window), but both replies still carry its id as their durable group —
    // the group outlives the window even though the root loop no longer does.
    const loops = loopsFrom([
      worker('reply1', UNRELATED, '2026-06-22T11:30:00.000Z', { followUpTo: 'ghost-original', sessionGroupId: 'ghost-original' }),
      worker('reply2', UNRELATED, '2026-06-22T12:00:00.000Z', { followUpTo: 'ghost-original', sessionGroupId: 'ghost-original' })
    ]);
    const sessions = _buildSessions(loops, { now: NOW });

    assert.strictEqual(sessions.length, 1, 'both followers coalesce into one session, not two standalone ones');
    assert.strictEqual(sessions[0].sessionId, 'ghost-original');
    assert.strictEqual(sessions[0].seedIssue, null, 'anchorless — the root loop itself is not present');
    assert.deepStrictEqual(sessions[0].loops.map(l => l.loopId).sort(), ['reply1', 'reply2']);
  });

  test('a lone follow-up whose UNSTAMPED anchor aged out still falls back to its own standalone session (fallback unchanged)', () => {
    // Same shape as the stamped test above, but with no sessionGroupId — pins
    // that the legacy fallback (today's behavior) is untouched for pre-field rows.
    const loops = loopsFrom([
      worker('reply1', UNRELATED, '2026-06-22T11:30:00.000Z', { followUpTo: 'ghost-original' })
    ]);
    const sessions = _buildSessions(loops, { now: NOW });

    assert.strictEqual(sessions.length, 1);
    assert.strictEqual(sessions[0].sessionId, 'reply1');
    assert.strictEqual(sessions[0].loops.length, 1);
  });

  test('stamped-vs-fallback parity: a stamped row and an equivalent un-stamped row group identically', () => {
    const stamped = _buildSessions(loopsFrom([
      worker('orig', UNRELATED, '2026-06-22T11:00:00.000Z'),
      worker('reply1', UNRELATED, '2026-06-22T11:30:00.000Z', { followUpTo: 'orig', sessionGroupId: 'orig' })
    ]), { now: NOW });
    const unstamped = _buildSessions(loopsFrom([
      worker('orig', UNRELATED, '2026-06-22T11:00:00.000Z'),
      worker('reply1', UNRELATED, '2026-06-22T11:30:00.000Z', { followUpTo: 'orig' })
    ]), { now: NOW });

    // Strip the field the fixtures deliberately differ on before comparing —
    // every other derived field (sessionId, loop set, tasksTouched, telemetry
    // shape) must be byte-identical.
    const strip = (sessions) => sessions.map(s => ({
      ...s,
      loops: s.loops.map(({ sessionGroupId, ...rest }) => rest)
    }));
    assert.deepStrictEqual(strip(stamped), strip(unstamped));
  });
});

describe('deploy-boundary straddle merge (LIN-1393)', () => {
  test('a chain unstamped at deploy time (A <- B) whose first post-deploy reply (C, grp=B) merges ALL THREE into one session, not {A} and {B,C}', () => {
    const loops = loopsFrom([
      worker('a', UNRELATED, '2026-06-22T10:00:00.000Z'),
      worker('b', UNRELATED, '2026-06-22T10:30:00.000Z', { followUpTo: 'a' }),
      worker('c', UNRELATED, '2026-06-22T11:00:00.000Z', { followUpTo: 'b', sessionGroupId: 'b' })
    ]);
    const sessions = _buildSessions(loops, { now: NOW });

    assert.strictEqual(sessions.length, 1, 'the whole chain must land in ONE session, not split into {a} and {b,c}');
    assert.strictEqual(sessions[0].sessionId, 'a');
    assert.deepStrictEqual(sessions[0].loops.map(l => l.loopId).sort(), ['a', 'b', 'c']);
  });

  test('a deeper straddle (A <- B <- B2, all unstamped at deploy) merges once B2\'s reply (D, grp=B2) is stamped', () => {
    const loops = loopsFrom([
      worker('a', UNRELATED, '2026-06-22T10:00:00.000Z'),
      worker('b', UNRELATED, '2026-06-22T10:20:00.000Z', { followUpTo: 'a' }),
      worker('b2', UNRELATED, '2026-06-22T10:40:00.000Z', { followUpTo: 'b' }),
      worker('d', UNRELATED, '2026-06-22T11:00:00.000Z', { followUpTo: 'b2', sessionGroupId: 'b2' })
    ]);
    const sessions = _buildSessions(loops, { now: NOW });

    assert.strictEqual(sessions.length, 1);
    assert.strictEqual(sessions[0].sessionId, 'a');
    assert.deepStrictEqual(sessions[0].loops.map(l => l.loopId).sort(), ['a', 'b', 'b2', 'd']);
  });

  test('a straddle whose true root is already owned by an existing pass-1 session (rootOwnerSessionId branch) merges into that session rather than seeding a new one', () => {
    // Unlike the two tests above (root unclaimed when 2.5a runs), here root 'a'
    // is claimed in pass 1 via its explicit sessionId, so sessionIdByLoopId.get(root.loopId)
    // is already truthy by the time 2.5a resolves group 'b' to its root.
    const loops = loopsFrom([
      orchestrator(),
      worker('a', CHILD, '2026-06-22T10:30:00.000Z', { sessionId: SESSION_ID }),
      worker('b', UNRELATED, '2026-06-22T11:00:00.000Z', { followUpTo: 'a' }),
      worker('c', UNRELATED, '2026-06-22T11:30:00.000Z', { followUpTo: 'b', sessionGroupId: 'b' })
    ]);
    const sessions = _buildSessions(loops, { now: NOW });

    assert.strictEqual(sessions.length, 1, 'no separate session should be seeded at root a');
    const s = sessions.find(x => x.sessionId === SESSION_ID);
    assert.ok(s, 'the straddle must merge into the existing autopilot session');
    assert.deepStrictEqual(s.loops.map(l => l.loopId).sort(), ['a', 'ap-1', 'b', 'c']);
  });
});

// ─── Public API ───────────────────────────────────────────────────────────────

describe('getSessionsForWorkspace', () => {
  test('reconstructs sessions end-to-end through mock stores', async () => {
    // Unlike every _buildLoops-driven test above (which injects the fixed NOW),
    // the public API has no injectable clock — it filters against the REAL
    // `now − LOOKBACK_MS` (30-day) window. The shared 2026-06-22 fixture
    // constants therefore age out of the window by calendar (they did on
    // 2026-07-22, silently breaking this one test while all the NOW-injected
    // ones stayed green), so this test builds its fixtures on fresh timestamps.
    const base = Date.now() - 4 * 60 * 60 * 1000; // four hours ago — always in window
    const iso = (offsetMin) => new Date(base + offsetMin * 60000).toISOString();
    const history = [
      orchestrator({ dispatchedAt: iso(0), resolvedAt: iso(1), feedback: done(iso(180)) }),
      worker('w1', CHILD, iso(30), { sessionId: SESSION_ID }),
      worker('w2', SPAWNED, iso(120), { sessionId: SESSION_ID })
    ];
    const deps = {
      dispatchStore: {
        listItems: async () => [],
        listHistory: async () => ({ items: history })
      },
      agentStatusStore: { listStatus: async () => ({ items: [] }) },
      // Pin "now" next to the fixed-date fixtures: without it the real clock
      // ages them out of the 30-day lookback and the test time-bombs.
      now: NOW
    };
    const sessions = await getSessionsForWorkspace('ws', deps);
    assert.strictEqual(sessions.length, 1);
    assert.strictEqual(sessions[0].sessionId, SESSION_ID);
    assert.deepStrictEqual(sessions[0].tasksTouched, [EPIC, CHILD, SPAWNED]);
  });

  test('returns [] for a missing urlKey and throws without injected stores', async () => {
    assert.deepStrictEqual(await getSessionsForWorkspace(''), []);
    await assert.rejects(() => getSessionsForWorkspace('ws', {}), /must be injected/);
  });
});

// ─── Lineage-aware instruments (LIN-1477) ──────────────────────────────────────

function heartbeat(timestamp, message = '[working] 3 tools/30s · alive') {
  return { message, url: null, urlLabel: null, timestamp };
}

describe('lineage-aware instruments (LIN-1477)', () => {
  test('lineageId derives from rootItemId when present', () => {
    const loops = loopsFrom([
      worker('root-1', CHILD, '2026-06-22T10:00:00.000Z'),
      worker('follow-1', CHILD, '2026-06-22T10:30:00.000Z', { rootItemId: 'root-1' })
    ]);
    const root = loops.find(l => l.loopId === 'root-1');
    const follow = loops.find(l => l.loopId === 'follow-1');
    assert.strictEqual(follow.lineageId, 'root-1');
    assert.strictEqual(root.lineageId, 'root-1');
  });

  test("lineageId falls back to the loop's own id when rootItemId is absent (I2)", () => {
    const [loop] = loopsFrom([worker('solo-1', CHILD, '2026-06-22T10:00:00.000Z')]);
    assert.strictEqual(loop.lineageId, loop.loopId);
    assert.strictEqual(loop.loopId, 'solo-1', 'loop identity itself must stay untouched');
  });

  test('lineageMetrics aggregate heartbeats across every loop sharing a lineage', () => {
    const loops = loopsFrom([
      worker('root-2', CHILD, '2026-06-22T10:00:00.000Z', {
        feedback: [heartbeat('2026-06-22T10:05:00.000Z', '[working] 3 tools/30s · alive')]
      }),
      worker('follow-2', CHILD, '2026-06-22T11:00:00.000Z', {
        rootItemId: 'root-2',
        feedback: [heartbeat('2026-06-22T11:10:00.000Z', '[working] 5 tools/45s · alive')]
      })
    ]);
    const root = loops.find(l => l.loopId === 'root-2');
    const follow = loops.find(l => l.loopId === 'follow-2');

    // Both loops in the lineage see the SAME aggregated lineage metrics — the
    // heartbeat "advances" across the repoint (LIN-1469 C2).
    assert.strictEqual(root.lineageMetrics.length, 2);
    assert.strictEqual(follow.lineageMetrics.length, 2);
    const expectedLastMs = new Date('2026-06-22T11:10:00.000Z').getTime();
    assert.strictEqual(root.lineageLastActivityMs, expectedLastMs);
    assert.strictEqual(follow.lineageLastActivityMs, expectedLastMs);

    // Per-run telemetry stays per-item and untouched alongside it (I4).
    assert.strictEqual(root.telemetry.metrics.length, 1);
    assert.strictEqual(follow.telemetry.metrics.length, 1);
  });

  test('lineageLastActivityMs is null when the lineage has no parsed heartbeat', () => {
    const [loop] = loopsFrom([worker('solo-2', CHILD, '2026-06-22T10:00:00.000Z', { feedback: [] })]);
    assert.deepStrictEqual(loop.lineageMetrics, []);
    assert.strictEqual(loop.lineageLastActivityMs, null);
  });

  test("a sibling's [done] must NOT mark another lineage member terminal (I1 regression pin)", () => {
    const loops = loopsFrom([
      worker('root-3', CHILD, '2026-06-22T10:00:00.000Z', {
        feedback: done('2026-06-22T10:30:00.000Z')
      }),
      worker('follow-3', CHILD, '2026-06-22T11:00:00.000Z', {
        rootItemId: 'root-3',
        feedback: [heartbeat('2026-06-22T11:05:00.000Z', '[working] 2 tools/10s · alive')]
      })
    ]);
    const follow = loops.find(l => l.loopId === 'follow-3');

    assert.strictEqual(
      follow.terminalStatus,
      null,
      "a sibling's terminal marker must not leak into this loop's OWN terminal status"
    );
    // The lineage aggregate is still built from BOTH loops' feedback (metrics
    // path only) — isolation applies to terminal/wake derivation, not to the
    // lineage metrics themselves.
    assert.strictEqual(follow.lineageId, 'root-3');
    assert.ok(follow.lineageMetrics.length >= 1);
  });
});

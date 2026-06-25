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
    const [s] = _buildSessions(loops, { issueGraph: ISSUE_GRAPH, now: NOW });

    assert.strictEqual(s.sessionId, SESSION_ID); // stable id == orchestrator loopId
    assert.strictEqual(s.seedIssue, EPIC);
    const ids = s.loops.map(l => l.loopId).sort();
    assert.deepStrictEqual(ids, ['ap-1', 'w1', 'w2']);
    assert.deepStrictEqual(s.tasksTouched, [EPIC, CHILD, SPAWNED]);
  });

  test('without an issue graph, inference attaches only the seed issue\'s own loops', () => {
    const loops = loopsFrom([
      orchestrator(),
      worker('w1', EPIC, '2026-06-22T10:30:00.000Z'),  // same issue as seed → attach
      worker('w2', CHILD, '2026-06-22T11:00:00.000Z')  // descendant, but no graph → cannot attach
    ]);
    const [s] = _buildSessions(loops, { now: NOW });
    assert.deepStrictEqual(s.loops.map(l => l.loopId).sort(), ['ap-1', 'w1']);
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

// ─── Public API ───────────────────────────────────────────────────────────────

describe('getSessionsForWorkspace', () => {
  test('reconstructs sessions end-to-end through mock stores', async () => {
    const history = [
      orchestrator(),
      worker('w1', CHILD, '2026-06-22T10:30:00.000Z', { sessionId: SESSION_ID }),
      worker('w2', SPAWNED, '2026-06-22T12:00:00.000Z', { sessionId: SESSION_ID })
    ];
    const deps = {
      dispatchStore: {
        listItems: async () => [],
        listHistory: async () => ({ items: history })
      },
      agentStatusStore: { listStatus: async () => ({ items: [] }) }
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

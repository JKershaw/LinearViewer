/**
 * Unit tests for lib/liveness-detectors.js (LIN-3258).
 *
 * Pure detectors: Rule S (dispatcher silent) and Rule D2 (stopped or circular
 * wait), plus the D2 edge-precedence branch table (fixtures 4 and 7) and the
 * parent-edge applicability rules (RC1/RC4/RC5).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectDispatcherSilent,
  detectStoppedOrCircularWait,
  isParentAddressed,
  extractDispatchIds,
  DISPATCHER_SILENT_MS,
  WAKE_DELIVERY_GRACE_MS
} from '../../lib/liveness-detectors.js';

const MIN = 60 * 1000;

function row({
  id,
  kind = 'custom',
  status = 'taken',
  sessionId = null,
  followUpTo = null,
  issueIdentifier = null,
  dispatchedAt,
  feedback = []
}) {
  return { id, kind, status, sessionId, followUpTo, issueIdentifier, dispatchedAt, rootItemId: id, feedback };
}

function feedback(message, iso) {
  return { message, timestamp: iso };
}

function mapOf(entries) {
  return new Map(entries);
}

function waitersFor(rowsByLineage) {
  return [...rowsByLineage.keys()].map((lineageId) => ({ lineageId }));
}

describe('Rule S: detectDispatcherSilent', () => {
  const dispatchedAt = '2026-10-02T17:25:00.000Z';

  test('fires past 20 minutes with a live item', () => {
    const now = Date.parse('2026-10-02T17:55:00.000Z');
    const result = detectDispatcherSilent({ now, lastSeenAt: dispatchedAt, liveItems: [{ status: 'queued', dispatchedAt }] });
    assert.equal(result.firing, true);
    assert.equal(result.startedAt, dispatchedAt);
  });

  test('does not fire at exactly 20 minutes or less', () => {
    const now = Date.parse(dispatchedAt) + DISPATCHER_SILENT_MS;
    assert.equal(detectDispatcherSilent({ now, lastSeenAt: dispatchedAt, liveItems: [{ status: 'queued' }] }).firing, false);
  });

  test('does not fire with no queued/taken item', () => {
    const now = Date.parse('2026-10-02T18:10:00.000Z');
    assert.equal(detectDispatcherSilent({ now, lastSeenAt: dispatchedAt, liveItems: [] }).firing, false);
    assert.equal(detectDispatcherSilent({ now, lastSeenAt: dispatchedAt, liveItems: [{ status: 'done' }] }).firing, false);
  });

  test('counts a taken item as live', () => {
    const now = Date.parse('2026-10-02T18:10:00.000Z');
    assert.equal(detectDispatcherSilent({ now, lastSeenAt: dispatchedAt, liveItems: [{ status: 'taken' }] }).firing, true);
  });

  test('never polled: fires only once a live item is itself older than the threshold', () => {
    const now = Date.parse('2026-10-02T17:50:00.000Z');
    const fired = detectDispatcherSilent({ now, lastSeenAt: null, liveItems: [{ status: 'queued', dispatchedAt: '2026-10-02T17:25:00.000Z' }] });
    assert.equal(fired.firing, true);
    assert.equal(fired.startedAt, '2026-10-02T17:25:00.000Z');

    const tooFresh = detectDispatcherSilent({ now, lastSeenAt: null, liveItems: [{ status: 'queued', dispatchedAt: '2026-10-02T17:40:00.000Z' }] });
    assert.equal(tooFresh.firing, false);
  });
});

describe('D2 edge building: isParentAddressed / extractDispatchIds', () => {
  test('parent-addressed only when a parent noun follows a wait word within the window', () => {
    assert.equal(isParentAddressed('I am waiting on the orchestrator to dispatch a beat'), true);
    assert.equal(isParentAddressed('waiting on the parent session'), true);
    assert.equal(isParentAddressed('waiting on CI run 5 to finish'), false);
    assert.equal(isParentAddressed('blocked by PR #12 approval'), false);
  });

  test('extracts full UUIDs and 8-hex tokens', () => {
    const ids = extractDispatchIds('waiting on 2550fd09-3567-4416-8eb5-b4d3750a285f (head 634545b9)');
    assert.ok(ids.includes('2550fd09-3567-4416-8eb5-b4d3750a285f'));
    assert.ok(ids.includes('634545b9'));
  });
});

describe('Rule D2: cycles, orphans, coverage and the RC1/RC4/RC5 precedence', () => {
  test('LIN-3238 shape: target-less parent-addressed wait + full-id text edge forms a cycle', () => {
    const parent = '8608873d-0000-0000-0000-000000000001';
    const child = '2550fd09-0000-0000-0000-000000000002';
    const rowsByLineage = mapOf([
      [parent, [row({
        id: parent,
        issueIdentifier: 'LIN-3238',
        dispatchedAt: '2026-10-02T14:14:00.000Z',
        feedback: [feedback(`[pending] waiting on the close-out session (dispatch ${child}) to merge`, '2026-10-02T15:04:38.966Z')]
      })]],
      [child, [row({
        id: child,
        kind: 'close-out',
        sessionId: parent,
        issueIdentifier: 'LIN-3238',
        dispatchedAt: '2026-10-02T15:04:00.000Z',
        feedback: [feedback('[pending] I am waiting on the orchestrator to dispatch an implementation beat', '2026-10-02T15:12:57.700Z')]
      })]]
    ]);
    const now = Date.parse('2026-10-02T15:20:00.000Z');
    const { chains } = detectStoppedOrCircularWait({ now, waiters: waitersFor(rowsByLineage), rowsByLineage });
    assert.equal(chains.length, 1);
    assert.equal(chains[0].shape, 'cycle');
    assert.deepEqual(chains[0].members, [child, parent].sort());
    assert.equal(chains[0].startedAt, '2026-10-02T15:12:57.700Z');
    const kinds = chains[0].detail.edges.map((e) => e.kind).sort();
    assert.deepEqual(kinds, ['parent', 'text-dispatch']);
  });

  test('4a: child on an ACTIVE parent is covered', () => {
    const parent = 'aaaaaaaa-0000-0000-0000-000000000001';
    const child = 'bbbbbbbb-0000-0000-0000-000000000002';
    const rowsByLineage = mapOf([
      [parent, [row({
        id: parent,
        dispatchedAt: '2026-10-02T09:00:00.000Z',
        feedback: [
          feedback('[pending] waiting on the child', '2026-10-02T09:50:00.000Z'),
          feedback('[working] heartbeat', '2026-10-02T10:05:00.000Z')
        ]
      })]],
      [child, [row({
        id: child,
        sessionId: parent,
        dispatchedAt: '2026-10-02T09:00:00.000Z',
        feedback: [feedback('[pending] waiting on the orchestrator to dispatch the next beat', '2026-10-02T09:55:00.000Z')]
      })]]
    ]);
    const now = Date.parse('2026-10-02T10:10:00.000Z');
    const { chains } = detectStoppedOrCircularWait({ now, waiters: waitersFor(rowsByLineage), rowsByLineage });
    assert.equal(chains.length, 0);
  });

  test('4b: child on a parent with a wake in flight is covered', () => {
    const parent = 'aaaaaaaa-0000-0000-0000-000000000003';
    const child = 'bbbbbbbb-0000-0000-0000-000000000004';
    const rowsByLineage = mapOf([
      [parent, [
        row({
          id: parent,
          dispatchedAt: '2026-10-02T09:00:00.000Z',
          feedback: [feedback('[pending] waiting on the child', '2026-10-02T09:50:00.000Z')]
        }),
        row({ id: 'cccccccc-0000-0000-0000-000000000005', kind: 'wake', status: 'queued', followUpTo: parent, dispatchedAt: '2026-10-02T09:55:00.000Z' })
      ]],
      [child, [row({
        id: child,
        sessionId: parent,
        dispatchedAt: '2026-10-02T09:00:00.000Z',
        feedback: [feedback('[pending] waiting on the orchestrator to dispatch the next beat', '2026-10-02T09:55:00.000Z')]
      })]]
    ]);
    const now = Date.parse('2026-10-02T10:10:00.000Z');
    const { chains } = detectStoppedOrCircularWait({ now, waiters: waitersFor(rowsByLineage), rowsByLineage });
    assert.equal(chains.length, 0);
  });

  test('4c: child on CI (no parent noun) under a parent on the child is covered', () => {
    const parent = 'aaaaaaaa-0000-0000-0000-000000000006';
    const child = 'bbbbbbbb-0000-0000-0000-000000000007';
    const rowsByLineage = mapOf([
      [parent, [row({
        id: parent,
        sessionId: child,
        dispatchedAt: '2026-10-02T09:00:00.000Z',
        feedback: [feedback(`[pending] waiting on the child dispatch ${child}`, '2026-10-02T09:50:00.000Z')]
      })]],
      [child, [row({
        id: child,
        sessionId: parent,
        dispatchedAt: '2026-10-02T09:00:00.000Z',
        feedback: [feedback('[pending] waiting on CI run 37022288987 to finish', '2026-10-02T09:55:00.000Z')]
      })]]
    ]);
    const now = Date.parse('2026-10-02T10:10:00.000Z');
    const { chains } = detectStoppedOrCircularWait({ now, waiters: waitersFor(rowsByLineage), rowsByLineage });
    assert.equal(chains.length, 0);
  });

  test('fixture 6: a wake 90 s after the wait does not alarm (no three-minute merge)', () => {
    const a = 'aaaaaaaa-0000-0000-0000-000000000008';
    const b = 'bbbbbbbb-0000-0000-0000-000000000009';
    const rowsByLineage = mapOf([
      [a, [row({
        id: a,
        dispatchedAt: '2026-10-02T09:00:00.000Z',
        feedback: [feedback(`[pending] waiting on ${b}`, '2026-10-02T09:50:00.000Z')]
      })]],
      [b, [row({
        id: b,
        sessionId: a,
        dispatchedAt: '2026-10-02T09:00:00.000Z',
        feedback: [feedback(`[pending] waiting on the orchestrator to wake ${a}`, '2026-10-02T09:51:30.000Z')]
      })]]
    ]);
    // A wake row for B's wait lands at 09:53:00, 90 s after the 09:51:30 wait.
    rowsByLineage.get(b).push(row({ id: 'cccccccc-0000-0000-0000-000000000010', kind: 'wake', status: 'queued', followUpTo: b, dispatchedAt: '2026-10-02T09:53:00.000Z' }));
    const now = Date.parse('2026-10-02T10:00:00.000Z');
    const { chains } = detectStoppedOrCircularWait({ now, waiters: waitersFor(rowsByLineage), rowsByLineage });
    assert.equal(chains.length, 0);
  });

  test('fixture 7 (RC4): parent-addressed + unresolvable 8-hex SHAs + resolvable sessionId still forms the parent edge', () => {
    const parent = 'dddddddd-0000-0000-0000-000000000011';
    const child = 'eeeeeeee-0000-0000-0000-000000000012';
    const rowsByLineage = mapOf([
      [parent, [row({
        id: parent,
        dispatchedAt: '2026-10-02T14:00:00.000Z',
        feedback: [feedback(`[pending] waiting on the close-out session (dispatch ${child})`, '2026-10-02T15:04:38.966Z')]
      })]],
      [child, [row({
        id: child,
        sessionId: parent,
        dispatchedAt: '2026-10-02T15:04:00.000Z',
        feedback: [feedback(
          '[pending] CI green on 634545b9 (run 37022288987), base 0f10ab0a, comment e53d0af0; I am waiting on the orchestrator to dispatch a beat',
          '2026-10-02T15:12:57.700Z'
        )]
      })]]
    ]);
    const now = Date.parse('2026-10-02T15:20:00.000Z');
    const { chains } = detectStoppedOrCircularWait({ now, waiters: waitersFor(rowsByLineage), rowsByLineage });
    assert.equal(chains.length, 1);
    assert.equal(chains[0].shape, 'cycle');
    assert.ok(chains[0].detail.edges.some((e) => e.kind === 'parent'));
  });

  test('parent-addressed with an unresolvable sessionId falls through to covered', () => {
    const child = 'eeeeeeee-0000-0000-0000-000000000013';
    const rowsByLineage = mapOf([
      [child, [row({
        id: child,
        sessionId: 'ffffffff-0000-0000-0000-000000000099',
        dispatchedAt: '2026-10-02T15:04:00.000Z',
        feedback: [feedback('[pending] I am waiting on the orchestrator to dispatch a beat', '2026-10-02T15:12:57.700Z')]
      })]]
    ]);
    const now = Date.parse('2026-10-02T15:20:00.000Z');
    const { chains } = detectStoppedOrCircularWait({ now, waiters: waitersFor(rowsByLineage), rowsByLineage });
    assert.equal(chains.length, 0);
  });

  test('person text is covered even with a parent noun present', () => {
    const child = 'eeeeeeee-0000-0000-0000-000000000014';
    const parent = 'dddddddd-0000-0000-0000-000000000015';
    const rowsByLineage = mapOf([
      [parent, [row({ id: parent, dispatchedAt: '2026-10-02T14:00:00.000Z', feedback: [feedback('[pending] waiting on ' + child, '2026-10-02T15:00:00.000Z')] })]],
      [child, [row({
        id: child,
        sessionId: parent,
        dispatchedAt: '2026-10-02T14:00:00.000Z',
        feedback: [feedback('[pending] waiting on the orchestrator for a ruling from John', '2026-10-02T15:10:00.000Z')]
      })]]
    ]);
    const now = Date.parse('2026-10-02T15:20:00.000Z');
    const { chains } = detectStoppedOrCircularWait({ now, waiters: waitersFor(rowsByLineage), rowsByLineage });
    assert.equal(chains.length, 0);
  });

  test('an orphan (stopped leaf) fires only after the delivery grace', () => {
    const a = 'aaaaaaaa-0000-0000-0000-000000000020';
    const b = 'bbbbbbbb-0000-0000-0000-000000000021';
    const rowsByLineage = mapOf([
      [a, [row({
        id: a,
        dispatchedAt: '2026-10-02T09:00:00.000Z',
        feedback: [feedback(`[pending] waiting on the worker dispatch ${b}`, '2026-10-02T09:50:00.000Z')]
      })]],
      [b, [row({
        id: b,
        sessionId: a,
        dispatchedAt: '2026-10-02T09:00:00.000Z',
        feedback: [feedback('[working] done, last heartbeat long ago', '2026-10-02T09:10:00.000Z')]
      })]]
    ]);
    const beforeGrace = Date.parse('2026-10-02T09:52:00.000Z');
    assert.equal(detectStoppedOrCircularWait({ now: beforeGrace, waiters: waitersFor(rowsByLineage), rowsByLineage }).chains.length, 0);
    const afterGrace = Date.parse('2026-10-02T09:55:00.000Z');
    const { chains } = detectStoppedOrCircularWait({ now: afterGrace, waiters: waitersFor(rowsByLineage), rowsByLineage });
    assert.equal(chains.length, 1);
    assert.equal(chains[0].shape, 'orphan');
    assert.equal(WAKE_DELIVERY_GRACE_MS, 3 * MIN);
  });
});

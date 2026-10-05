/**
 * LIN-3258 incident identity (ruling `lin3258-incident-identity` = A).
 *
 * The pure-detector witnesses the review's must-fix asked for: one record per
 * incident for every D2 shape (RC7/RC9/RC11), an order-independent key and
 * onset (N13), and the cause-keying that lets a dispatch-named waiter and a
 * ticket-named waiter share one incident.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { detectStoppedOrCircularWait } from '../../lib/liveness-detectors.js';

function row({ id, kind = 'custom', status = 'taken', sessionId = null, followUpTo = null, issueIdentifier = null, dispatchedAt, feedback = [] }) {
  return { id, kind, status, sessionId, followUpTo, issueIdentifier, dispatchedAt, rootItemId: id, feedback };
}
const fb = (message, timestamp) => ({ message, timestamp });
const mapOf = (entries) => new Map(entries);
const waiterList = (ids) => ids.map((lineageId) => ({ lineageId }));

/** A stopped leaf row: no pending, last activity stale relative to `now`. */
function stoppedLeaf(id, { issueIdentifier = null, lastActivity = '2026-10-02T09:10:00.000Z', dispatchedAt = '2026-10-02T09:00:00.000Z' } = {}) {
  return row({ id, issueIdentifier, dispatchedAt, feedback: [fb('[working] last moved long ago', lastActivity)] });
}

function parkedWaiter(id, targetText, timestamp, extra = {}) {
  return row({ id, dispatchedAt: extra.dispatchedAt || '2026-10-02T09:00:00.000Z', issueIdentifier: extra.issueIdentifier || null, sessionId: extra.sessionId || null, feedback: [fb(`[pending] waiting on ${targetText}`, timestamp)] });
}

function permutations(items) {
  if (items.length <= 1) return [items];
  const out = [];
  items.forEach((item, i) => {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const p of permutations(rest)) out.push([item, ...p]);
  });
  return out;
}

describe('D2 incident identity: one record per cause (RC11)', () => {
  test('two waiters onto ONE stopped leaf mint one orphan record (RC11)', () => {
    const a = 'aaaaaaaa-0000-0000-0000-000000000001';
    const b = 'bbbbbbbb-0000-0000-0000-000000000002';
    const c = 'cccccccc-0000-0000-0000-000000000003';
    const rowsByLineage = mapOf([
      [a, [parkedWaiter(a, `the worker dispatch ${c}`, '2026-10-02T10:05:00.000Z')]],
      [b, [parkedWaiter(b, `the worker dispatch ${c}`, '2026-10-02T09:55:00.000Z')]],
      [c, [stoppedLeaf(c)]]
    ]);
    const now = Date.parse('2026-10-02T10:30:00.000Z');
    const { chains } = detectStoppedOrCircularWait({ now, waiters: waiterList([a, b, c]), rowsByLineage });
    assert.equal(chains.length, 1, `one record for one leaf, got ${JSON.stringify(chains.map((x) => [x.shape, x.members]))}`);
    const [record] = chains;
    assert.equal(record.shape, 'orphan');
    assert.deepEqual(record.members, [c], 'the key is the dead leaf');
    assert.deepEqual(record.waiters, [a, b].sort(), 'both waiters are victims on the one record');
    assert.equal(record.startedAt, '2026-10-02T09:55:00.000Z', 'earliest direct-waiter onset');
  });

  test('a chain A→B→C(dead) mints one orphan, not one per walk (RC11 sibling of RC7)', () => {
    const a = 'aaaaaaaa-0000-0000-0000-000000000011';
    const b = 'bbbbbbbb-0000-0000-0000-000000000012';
    const c = 'cccccccc-0000-0000-0000-000000000013';
    const rowsByLineage = mapOf([
      [a, [parkedWaiter(a, `worker dispatch ${b}`, '2026-10-02T10:05:00.000Z')]],
      [b, [parkedWaiter(b, `worker dispatch ${c}`, '2026-10-02T09:55:00.000Z')]],
      [c, [stoppedLeaf(c)]]
    ]);
    const now = Date.parse('2026-10-02T10:30:00.000Z');
    const { chains } = detectStoppedOrCircularWait({ now, waiters: waiterList([a, b, c]), rowsByLineage });
    assert.equal(chains.length, 1, `got ${JSON.stringify(chains.map((x) => [x.shape, x.members]))}`);
    const [record] = chains;
    assert.deepEqual(record.members, [c]);
    assert.deepEqual(record.waiters, [b], 'B has the direct edge into C');
    assert.deepEqual(record.feeders, [a], 'A feeds B');
  });

  test('an orphan whose leaf carries a ticket is keyed on the ticket (dispatch- and ticket-named waiters share it)', () => {
    const a = 'aaaaaaaa-0000-0000-0000-000000000021';
    const c = 'cccccccc-0000-0000-0000-000000000023';
    const rowsByLineage = mapOf([
      [a, [parkedWaiter(a, `the landed session (dispatch ${c})`, '2026-10-02T09:55:00.000Z')]],
      [c, [stoppedLeaf(c, { issueIdentifier: 'LIN-5' })]]
    ]);
    const now = Date.parse('2026-10-02T10:30:00.000Z');
    const { chains } = detectStoppedOrCircularWait({ now, waiters: waiterList([a, c]), rowsByLineage });
    assert.equal(chains.length, 1);
    assert.equal(chains[0].members[0], 'ticket:LIN-5');
    assert.deepEqual(chains[0].tickets, ['LIN-5']);
    assert.deepEqual(chains[0].leafLineages, [c]);
  });

  test('a text-ticket edge to a ticket whose every lineage stopped is one ticket-keyed orphan', () => {
    const a = 'aaaaaaaa-0000-0000-0000-000000000031';
    const c1 = 'cccccccc-0000-0000-0000-000000000033';
    const c2 = 'cccccccc-0000-0000-0000-000000000034';
    const rowsByLineage = mapOf([
      [a, [parkedWaiter(a, 'the LIN-200 landed session', '2026-10-02T09:55:00.000Z')]],
      [c1, [stoppedLeaf(c1, { issueIdentifier: 'LIN-200' })]],
      [c2, [stoppedLeaf(c2, { issueIdentifier: 'LIN-200', lastActivity: '2026-10-02T09:20:00.000Z' })]]
    ]);
    const now = Date.parse('2026-10-02T10:30:00.000Z');
    const { chains } = detectStoppedOrCircularWait({ now, waiters: waiterList([a, c1, c2]), rowsByLineage });
    assert.equal(chains.length, 1, `got ${JSON.stringify(chains.map((x) => [x.shape, x.members]))}`);
    assert.equal(chains[0].members[0], 'ticket:LIN-200');
    assert.deepEqual(chains[0].leafLineages, [c1, c2].sort());
    // The later of the leaves' stops is the ticket's deadSince.
    assert.equal(chains[0].startedAt, '2026-10-02T09:55:00.000Z');
  });
});

describe('D2 incident identity: order independence (N13)', () => {
  test('cycle + feeder: every waiter permutation gives the same key, members, feeders and startedAt', () => {
    const f = 'ffffffff-0000-0000-0000-000000000001';
    const p = '11111111-0000-0000-0000-000000000002';
    const c = '22222222-0000-0000-0000-000000000003';
    const rowsByLineage = mapOf([
      [f, [parkedWaiter(f, `worker dispatch ${p}`, '2026-10-02T10:25:00.000Z')]],
      [p, [row({ id: p, dispatchedAt: '2026-10-02T10:00:00.000Z', feedback: [fb(`[pending] waiting on worker dispatch ${c}`, '2026-10-02T10:05:00.000Z')] })]],
      [c, [row({ id: c, sessionId: p, dispatchedAt: '2026-10-02T10:00:00.000Z', feedback: [fb('[pending] waiting on the orchestrator to dispatch a beat', '2026-10-02T10:06:00.000Z')] })]]
    ]);
    const now = Date.parse('2026-10-02T10:40:00.000Z');
    const baseline = detectStoppedOrCircularWait({ now, waiters: waiterList([p, c, f]), rowsByLineage }).chains;
    assert.equal(baseline.length, 1);
    assert.equal(baseline[0].shape, 'cycle');
    assert.deepEqual(baseline[0].members, [c, p].sort());
    assert.equal(baseline[0].startedAt, '2026-10-02T10:06:00.000Z', 'latest waitStart in the SCC, feeder excluded');
    assert.deepEqual(baseline[0].feeders, [f]);

    for (const perm of permutations([p, c, f])) {
      const { chains } = detectStoppedOrCircularWait({ now, waiters: waiterList(perm), rowsByLineage });
      assert.equal(chains.length, 1);
      assert.deepEqual(chains[0].members, baseline[0].members, `perm ${perm}`);
      assert.deepEqual(chains[0].waiters, baseline[0].waiters, `perm ${perm}`);
      assert.deepEqual(chains[0].feeders, baseline[0].feeders, `perm ${perm}`);
      assert.equal(chains[0].startedAt, baseline[0].startedAt, `perm ${perm}`);
      assert.deepEqual(chains[0].dispatchIds, baseline[0].dispatchIds, `perm ${perm}`);
    }
  });

  test('orphan chain: every waiter permutation gives the same key and onset', () => {
    const a = 'aaaaaaaa-0000-0000-0000-000000000041';
    const b = 'bbbbbbbb-0000-0000-0000-000000000042';
    const c = 'cccccccc-0000-0000-0000-000000000043';
    const rowsByLineage = mapOf([
      [a, [parkedWaiter(a, `worker dispatch ${b}`, '2026-10-02T10:05:00.000Z')]],
      [b, [parkedWaiter(b, `worker dispatch ${c}`, '2026-10-02T09:55:00.000Z')]],
      [c, [stoppedLeaf(c)]]
    ]);
    const now = Date.parse('2026-10-02T10:30:00.000Z');
    const baseline = detectStoppedOrCircularWait({ now, waiters: waiterList([c, a, b]), rowsByLineage }).chains;
    assert.equal(baseline.length, 1);
    // `firedAt` is the wall clock and edge order follows walk order; compare
    // only the identity-bearing fields (the point of the property).
    const normalize = (chains) => chains.map((ch) => ({
      shape: ch.shape,
      members: ch.members,
      waiters: ch.waiters,
      feeders: ch.feeders,
      leafLineages: ch.leafLineages,
      dispatchIds: ch.dispatchIds,
      tickets: ch.tickets,
      startedAt: ch.startedAt,
      edges: [...ch.detail.edges].sort((x, y) => `${x.from}|${x.to}|${x.kind}`.localeCompare(`${y.from}|${y.to}|${y.kind}`))
    }));
    const expected = normalize(baseline);
    for (const perm of permutations([a, b, c])) {
      const { chains } = detectStoppedOrCircularWait({ now, waiters: waiterList(perm), rowsByLineage });
      assert.deepEqual(normalize(chains), expected, `perm ${perm}`);
    }
  });
});

describe('D2 incident identity: cause shapes', () => {
  test('mixed: one waiter on a cycle AND a dead leaf mints TWO incidents', () => {
    const a = 'aaaaaaaa-0000-0000-0000-000000000051';
    const p = '11111111-0000-0000-0000-000000000052';
    const c = '22222222-0000-0000-0000-000000000053';
    const d = 'dddddddd-0000-0000-0000-000000000054';
    const rowsByLineage = mapOf([
      [a, [row({ id: a, dispatchedAt: '2026-10-02T10:00:00.000Z', feedback: [fb(`[pending] waiting on worker dispatch ${p} and the dead worker ${d}`, '2026-10-02T10:10:00.000Z')] })]],
      [p, [row({ id: p, dispatchedAt: '2026-10-02T10:00:00.000Z', feedback: [fb(`[pending] waiting on worker dispatch ${c}`, '2026-10-02T10:05:00.000Z')] })]],
      [c, [row({ id: c, sessionId: p, dispatchedAt: '2026-10-02T10:00:00.000Z', feedback: [fb('[pending] waiting on the orchestrator to dispatch a beat', '2026-10-02T10:06:00.000Z')] })]],
      [d, [stoppedLeaf(d)]]
    ]);
    const now = Date.parse('2026-10-02T10:40:00.000Z');
    const { chains } = detectStoppedOrCircularWait({ now, waiters: waiterList([a, p, c, d]), rowsByLineage });
    const byShape = Object.fromEntries(chains.map((x) => [x.shape, x]));
    assert.equal(chains.length, 2, `got ${JSON.stringify(chains.map((x) => [x.shape, x.members]))}`);
    assert.ok(byShape.cycle, 'the cycle cause is reported');
    assert.ok(byShape.orphan, 'the dead-leaf cause is reported alongside it');
    assert.deepEqual(byShape.cycle.members, [c, p].sort());
    assert.deepEqual(byShape.orphan.members, [d]);
    assert.ok(byShape.cycle.feeders.includes(a), 'A feeds the cycle');
    assert.deepEqual(byShape.orphan.waiters, [a], 'A waits directly on D');
  });

  test('a cycle with an exit to a dead leaf mints the cycle and the orphan', () => {
    const p = '11111111-0000-0000-0000-000000000062';
    const c = '22222222-0000-0000-0000-000000000063';
    const d = 'dddddddd-0000-0000-0000-000000000064';
    const rowsByLineage = mapOf([
      [p, [row({ id: p, dispatchedAt: '2026-10-02T10:00:00.000Z', feedback: [fb(`[pending] waiting on worker dispatch ${c}`, '2026-10-02T10:05:00.000Z')] })]],
      [c, [row({ id: c, dispatchedAt: '2026-10-02T10:00:00.000Z', feedback: [fb(`[pending] waiting on worker dispatch ${p} and dispatch ${d}`, '2026-10-02T10:06:00.000Z')] })]],
      [d, [stoppedLeaf(d)]]
    ]);
    const now = Date.parse('2026-10-02T10:40:00.000Z');
    const { chains } = detectStoppedOrCircularWait({ now, waiters: waiterList([p, c, d]), rowsByLineage });
    const byShape = Object.fromEntries(chains.map((x) => [x.shape, x]));
    assert.equal(chains.length, 2, `got ${JSON.stringify(chains.map((x) => [x.shape, x.members]))}`);
    assert.deepEqual(byShape.cycle.members, [c, p].sort());
    assert.deepEqual(byShape.orphan.members, [d]);
    assert.deepEqual(byShape.orphan.waiters, [c]);
    assert.deepEqual(byShape.orphan.feeders, [p]);
  });

  test('the feeder joining or leaving changes neither the cycle _id nor its startedAt (across ticks)', () => {
    const f = 'ffffffff-0000-0000-0000-000000000071';
    const p = '11111111-0000-0000-0000-000000000072';
    const c = '22222222-0000-0000-0000-000000000073';
    const rowsByLineage = mapOf([
      [f, [parkedWaiter(f, `worker dispatch ${p}`, '2026-10-02T10:25:00.000Z')]],
      [p, [row({ id: p, dispatchedAt: '2026-10-02T10:00:00.000Z', feedback: [fb(`[pending] waiting on worker dispatch ${c}`, '2026-10-02T10:05:00.000Z')] })]],
      [c, [row({ id: c, sessionId: p, dispatchedAt: '2026-10-02T10:00:00.000Z', feedback: [fb('[pending] waiting on the orchestrator to dispatch a beat', '2026-10-02T10:06:00.000Z')] })]]
    ]);
    const now = Date.parse('2026-10-02T10:40:00.000Z');
    // Feeder not yet a waiter (its wait is future): key/onset must match once it joins.
    const before = detectStoppedOrCircularWait({ now: Date.parse('2026-10-02T10:20:00.000Z'), waiters: waiterList([p, c]), rowsByLineage }).chains[0];
    const after = detectStoppedOrCircularWait({ now, waiters: waiterList([p, c, f]), rowsByLineage }).chains[0];
    assert.deepEqual(before.members, after.members);
    assert.equal(before.startedAt, after.startedAt);
  });

  test('N12: a wait naming a mid-lineage row id of a non-waiter lineage resolves to that lineage', () => {
    const a = 'aaaaaaaa-0000-0000-0000-000000000081';
    const root = '11111111-0000-0000-0000-000000000082';
    const mid = '11111111-0000-0000-0000-00000000008f';
    const rowsByLineage = mapOf([
      [a, [parkedWaiter(a, `the worker dispatch ${mid}`, '2026-10-02T09:55:00.000Z')]]
    ]);
    // The non-waiter lineage L is known only through its lean loops: the root
    // row and a mid-lineage row. Registering only the root (the old behavior)
    // would leave the wait unresolved and the chain covered.
    const lineageInfo = mapOf([
      [root, {
        latest: { loopId: root, terminalStatus: null, lineageLastActivityMs: Date.parse('2026-10-02T09:10:00.000Z'), issueIdentifier: null },
        loopIds: [root, mid]
      }]
    ]);
    const now = Date.parse('2026-10-02T10:30:00.000Z');
    const resolved = detectStoppedOrCircularWait({ now, waiters: waiterList([a]), rowsByLineage, lineageInfo });
    assert.equal(resolved.chains.length, 1, `the mid-row id must resolve to L, got ${JSON.stringify(resolved.chains)}`);
    assert.deepEqual(resolved.chains[0].members, [root]);

    // Mutation witness: with only the root registered, the same wait is covered.
    const stale = mapOf([
      [root, { latest: { loopId: root, terminalStatus: null, lineageLastActivityMs: Date.parse('2026-10-02T09:10:00.000Z'), issueIdentifier: null } }]
    ]);
    const unresolved = detectStoppedOrCircularWait({ now, waiters: waiterList([a]), rowsByLineage, lineageInfo: stale });
    assert.equal(unresolved.chains.length, 0, 'without the mid-row registration the wait resolves to nothing');
  });
});

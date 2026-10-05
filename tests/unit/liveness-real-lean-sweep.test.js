/**
 * LIN-3258 review ledger item 4: the end-to-end sweep witness over the REAL
 * data path.
 *
 * Every other liveness sweep test injects a hand-built `getLoops`, which proves
 * the detector's arithmetic but not that the REAL `getLoopsForWorkspace(...,
 * { lean: true })` projection actually carries the fields the sweep gates on.
 * This test seeds a REAL `DispatchQueueStore` (MangoDB tmpdir), builds lean
 * loops through the real `getLoopsForWorkspace`, and runs `sweepOneWorkspace`
 * with NO loop seam — so the whole read→detect→store path is exercised:
 *
 *   - a two-lineage cycle (parent P ↔ close-out C) must fire exactly one
 *     stopped-or-circular-wait record, and
 *   - an extra same-ticket TERMINAL lineage must neither cover the cycle nor
 *     mint a second record (the RC6 shape, now over real rows).
 *
 * It also asserts the lean-loop fields the sweep reads are populated on real
 * rows: `lineageId`, `wakeMarker`, `terminalStatus`, `lineageLastActivityMs`,
 * `issueIdentifier`, `historyStatus`, `source`.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { LivenessAlarmStore, LIVENESS_ALARM_RULES } from '../../lib/liveness-alarm-store.js';
import { getLoopsForWorkspace } from '../../lib/pipeline-loops.js';
import { sweepOneWorkspace } from '../../lib/liveness-alarm-sweep.js';

const URL_KEY = 'ws-real-lean-cycle';

describe('liveness-alarm-sweep: real getLoopsForWorkspace(lean) over a real DispatchQueueStore (ledger 4)', () => {
  const harness = createMangoTmpdir('liveness-real-lean-');
  let db;
  let dispatchStore;
  let alarmStore;
  const agentStatusStore = { listStatus: async () => ({ items: [] }) };

  before(() => harness.connect());
  after(() => harness.close());

  /**
   * Seed one workspace over the real store and return the ids + a fixed
   * "now" the sweep runs at. `addItem` always stamps `dispatchedAt = new
   * Date()` and cannot be overridden, so the archived rows are re-stamped
   * directly before feedback is written; the digest is then computed by the
   * real `addFeedback` path from the corrected `dispatchedAt`.
   */
  async function seedCycle() {
    db = harness.freshDb();
    dispatchStore = new DispatchQueueStore({
      collection: db.collection('dispatch-queue'),
      historyCollection: db.collection('dispatch-history'),
      ttl: 86400
    });
    alarmStore = new LivenessAlarmStore({ collection: db.collection('liveness-alarms') });

    const parent = await dispatchStore.addItem(URL_KEY, {
      prompt: 'p', promptName: 'implementation', kind: 'implementation', issueIdentifier: 'LIN-7777'
    });
    const child = await dispatchStore.addItem(URL_KEY, {
      prompt: 'c', promptName: 'implementation', kind: 'close-out',
      issueIdentifier: 'LIN-7777', sessionId: parent._id
    });
    const terminal = await dispatchStore.addItem(URL_KEY, {
      prompt: 't', promptName: 'implementation', kind: 'implementation', issueIdentifier: 'LIN-7777'
    });

    // addFeedback only appends to an archived `status:'taken'` history row.
    await dispatchStore.takeItem(parent._id, URL_KEY);
    await dispatchStore.takeItem(child._id, URL_KEY);
    await dispatchStore.takeItem(terminal._id, URL_KEY);

    const dispatchedAt = new Date(Date.now() - 20 * 60 * 1000);
    for (const id of [parent._id, child._id, terminal._id]) {
      await dispatchStore.historyCollection.updateOne(
        { _id: id, urlKey: URL_KEY },
        { $set: { dispatchedAt, resolvedAt: dispatchedAt } }
      );
    }

    // P waits on C by dispatch id (text edge P→C).
    await dispatchStore.addFeedback(parent._id, URL_KEY, {
      message: `[pending] waiting on the close-out session (dispatch ${child._id}) to land`
    }, null);
    // C is parent-addressed and carries sessionId=P (parent edge C→P): P↔C.
    await dispatchStore.addFeedback(child._id, URL_KEY, {
      message: '[pending] I am waiting on the parent orchestrator to dispatch the next beat'
    }, null);
    // Same-ticket extra lineage: a stale heartbeat then a terminal. It must not
    // cover the cycle and must not join the record.
    await dispatchStore.addFeedback(terminal._id, URL_KEY, {
      message: '[working] an unrelated same-ticket session heartbeat (3 tools in 12s)'
    }, null);
    await dispatchStore.addFeedback(terminal._id, URL_KEY, {
      message: '[done] an earlier same-ticket session finished'
    }, null);

    return { parent, child, terminal, at: Date.now() };
  }

  test('one cycle record fires and the same-ticket terminal lineage neither covers nor duplicates it', async () => {
    const { parent, child, terminal, at } = await seedCycle();

    // The REAL lean projection, reached through the same API the sweep's
    // default `getLoops` uses. Assert the fields the sweep gates on.
    const loops = await getLoopsForWorkspace(URL_KEY, { dispatchStore, agentStatusStore, lean: true });
    const byLoop = new Map(loops.map((l) => [l.loopId, l]));

    const pLoop = byLoop.get(parent._id);
    const cLoop = byLoop.get(child._id);
    const tLoop = byLoop.get(terminal._id);
    assert.ok(pLoop && cLoop && tLoop, `all three lineages appear in the lean feed, got ${JSON.stringify([...byLoop.keys()])}`);

    for (const [label, loop] of [['parent', pLoop], ['child', cLoop], ['terminal', tLoop]]) {
      assert.equal(loop.lineageId, loop.loopId, `${label}: lineageId is the root lineage`);
      assert.equal(loop.issueIdentifier, 'LIN-7777', `${label}: issueIdentifier carried`);
      assert.equal(loop.source, 'history', `${label}: source is history`);
      assert.equal(loop.historyStatus, 'taken', `${label}: historyStatus is taken`);
      assert.ok(loop.dispatchedAt, `${label}: dispatchedAt carried`);
    }
    assert.equal(pLoop.wakeMarker, 'pending', 'parent wait is a pending wake');
    assert.equal(pLoop.terminalStatus, null);
    assert.equal(cLoop.wakeMarker, 'pending', 'child wait is a pending wake');
    assert.equal(cLoop.sessionId, parent._id, 'child carries sessionId = parent');
    assert.equal(tLoop.terminalStatus, 'done', 'the extra same-ticket lineage is terminal');
    assert.ok(Number.isFinite(tLoop.lineageLastActivityMs), 'lineageLastActivityMs is a real epoch-ms value on a lineage with a heartbeat');

    // Drive the sweep against the REAL getLoops (no injection) over the REAL store.
    await sweepOneWorkspace(URL_KEY, at, {
      dispatchStore,
      dispatchTokenStore: {},
      proxyTokenStore: null,
      agentStatusStore,
      alarmStore,
      getLoops: getLoopsForWorkspace,
      getLastSeen: async () => new Date(at - 60_000).toISOString()
    });

    const all = await alarmStore.list(URL_KEY, { state: 'all' });
    const d2 = all.filter((a) => a.rule === LIVENESS_ALARM_RULES.STOPPED_OR_CIRCULAR_WAIT);
    assert.equal(d2.length, 1, `exactly one D2 record over the real path, got ${JSON.stringify(all.map((a) => a._id))}`);
    assert.equal(d2[0].shape, 'cycle');
    assert.deepEqual(d2[0].members, [parent._id, child._id].sort());
    assert.ok(!d2[0].members.includes(terminal._id), 'the terminal same-ticket lineage is not part of the cycle');
    assert.ok(d2[0].tickets.includes('LIN-7777'));
  });

  /**
   * Ledger 3: a wait names a SECOND TICKET whose only lineage is stopped and
   * is not itself a waiter. This is the `lineageInfo`-only route (the target
   * is reached from its lean loop, never as a candidate waiter), so it is the
   * path the previous review's L4a mutation left inert.
   */
  async function seedStoppedTicket() {
    db = harness.freshDb();
    dispatchStore = new DispatchQueueStore({
      collection: db.collection('dispatch-queue'),
      historyCollection: db.collection('dispatch-history'),
      ttl: 86400
    });
    alarmStore = new LivenessAlarmStore({ collection: db.collection('liveness-alarms') });

    const waiter = await dispatchStore.addItem(URL_KEY, {
      prompt: 'w', promptName: 'implementation', kind: 'implementation', issueIdentifier: 'LIN-7777'
    });
    const stopped = await dispatchStore.addItem(URL_KEY, {
      prompt: 's', promptName: 'implementation', kind: 'implementation', issueIdentifier: 'LIN-8888'
    });
    await dispatchStore.takeItem(waiter._id, URL_KEY);
    await dispatchStore.takeItem(stopped._id, URL_KEY);

    const dispatchedAt = new Date(Date.now() - 25 * 60 * 1000);
    for (const id of [waiter._id, stopped._id]) {
      await dispatchStore.historyCollection.updateOne(
        { _id: id, urlKey: URL_KEY },
        { $set: { dispatchedAt, resolvedAt: dispatchedAt } }
      );
    }
    await dispatchStore.addFeedback(waiter._id, URL_KEY, {
      message: '[pending] waiting on the LIN-8888 landed session to finish'
    }, null);
    await dispatchStore.addFeedback(stopped._id, URL_KEY, {
      message: '[working] the stopped lineage last moved long ago (1 tool in 5s)'
    }, null);
    // Sweep 20 min after the feedback so the second lineage reads stopped.
    return { waiter, stopped, at: Date.now() + 20 * 60 * 1000 };
  }

  test('ledger 3: a wait on a second ticket whose only lineage is stopped fires one ticket-keyed orphan', async () => {
    const { stopped, at } = await seedStoppedTicket();

    await sweepOneWorkspace(URL_KEY, at, {
      dispatchStore,
      dispatchTokenStore: {},
      proxyTokenStore: null,
      agentStatusStore,
      alarmStore,
      getLoops: getLoopsForWorkspace,
      getLastSeen: async () => new Date(at - 60_000).toISOString()
    });

    const all = await alarmStore.list(URL_KEY, { state: 'all' });
    const d2 = all.filter((a) => a.rule === LIVENESS_ALARM_RULES.STOPPED_OR_CIRCULAR_WAIT);
    assert.equal(d2.length, 1, `exactly one D2 record over the real path, got ${JSON.stringify(all.map((a) => a._id))}`);
    assert.equal(d2[0].shape, 'orphan');
    assert.deepEqual(d2[0].members, ['ticket:LIN-8888']);
    assert.deepEqual(d2[0].leafLineages, [stopped._id]);
    assert.ok(d2[0].tickets.includes('LIN-8888'), 'the dead leaf ticket is recorded');
  });

  /**
   * Design test 5(b): a terminal, non-waiter target that finished AFTER the
   * wait began. This is the `lineageInfo`-only route (the target is reached
   * from its lean loop, never as a candidate waiter) — the path that used to
   * cover and that dead-leaf rule (b) closes.
   */
  async function seedTerminalTarget() {
    db = harness.freshDb();
    dispatchStore = new DispatchQueueStore({
      collection: db.collection('dispatch-queue'),
      historyCollection: db.collection('dispatch-history'),
      ttl: 86400
    });
    alarmStore = new LivenessAlarmStore({ collection: db.collection('liveness-alarms') });

    const waiter = await dispatchStore.addItem(URL_KEY, {
      prompt: 'w', promptName: 'implementation', kind: 'implementation', issueIdentifier: 'LIN-7777'
    });
    const target = await dispatchStore.addItem(URL_KEY, {
      prompt: 't', promptName: 'implementation', kind: 'implementation', issueIdentifier: 'LIN-8888'
    });
    await dispatchStore.takeItem(waiter._id, URL_KEY);
    await dispatchStore.takeItem(target._id, URL_KEY);

    const dispatchedAt = new Date(Date.now() - 30 * 60 * 1000);
    for (const id of [waiter._id, target._id]) {
      await dispatchStore.historyCollection.updateOne(
        { _id: id, urlKey: URL_KEY },
        { $set: { dispatchedAt, resolvedAt: dispatchedAt } }
      );
    }
    // Wait first, then the target works and finishes: the wait predates the
    // terminal, so the terminal is a genuine lost wake (rule b).
    await dispatchStore.addFeedback(waiter._id, URL_KEY, {
      message: '[pending] waiting on the LIN-8888 landed session to finish'
    }, null);
    await dispatchStore.addFeedback(target._id, URL_KEY, {
      message: '[working] the target last moved (1 tool in 5s)'
    }, null);
    await dispatchStore.addFeedback(target._id, URL_KEY, {
      message: '[done] the target finished without waking the waiter'
    }, null);
    return { target, at: Date.now() + 10 * 60 * 1000 };
  }

  test('design 5(b): a terminal non-waiter target that finished after the wait fires one orphan over the real path', async () => {
    const { target, at } = await seedTerminalTarget();

    await sweepOneWorkspace(URL_KEY, at, {
      dispatchStore,
      dispatchTokenStore: {},
      proxyTokenStore: null,
      agentStatusStore,
      alarmStore,
      getLoops: getLoopsForWorkspace,
      getLastSeen: async () => new Date(at - 60_000).toISOString()
    });

    const all = await alarmStore.list(URL_KEY, { state: 'all' });
    const d2 = all.filter((a) => a.rule === LIVENESS_ALARM_RULES.STOPPED_OR_CIRCULAR_WAIT);
    assert.equal(d2.length, 1, `exactly one D2 record over the real path, got ${JSON.stringify(all.map((a) => a._id))}`);
    assert.equal(d2[0].shape, 'orphan');
    assert.deepEqual(d2[0].members, ['ticket:LIN-8888']);
    assert.deepEqual(d2[0].leafLineages, [target._id]);
    assert.ok(d2[0].tickets.includes('LIN-8888'), 'the terminal target ticket is recorded');
  });

  /**
   * Design test 5(c) / N14 M4: a wait names a MID-lineage row id of a
   * non-waiter lineage. Registering only the lineage root (the mutation) would
   * leave the wait unresolved and the chain covered.
   */
  async function seedMidLineageTarget() {
    db = harness.freshDb();
    dispatchStore = new DispatchQueueStore({
      collection: db.collection('dispatch-queue'),
      historyCollection: db.collection('dispatch-history'),
      ttl: 86400
    });
    alarmStore = new LivenessAlarmStore({ collection: db.collection('liveness-alarms') });

    const waiter = await dispatchStore.addItem(URL_KEY, {
      prompt: 'w', promptName: 'implementation', kind: 'implementation', issueIdentifier: 'LIN-7777'
    });
    const root = await dispatchStore.addItem(URL_KEY, {
      prompt: 'r', promptName: 'implementation', kind: 'implementation', issueIdentifier: 'LIN-8888'
    });
    const mid = await dispatchStore.addItem(URL_KEY, {
      prompt: 'm', promptName: 'implementation', kind: 'implementation', issueIdentifier: 'LIN-8888',
      followUpTo: root._id, rootItemId: root._id
    });
    await dispatchStore.takeItem(waiter._id, URL_KEY);
    await dispatchStore.takeItem(root._id, URL_KEY);
    await dispatchStore.takeItem(mid._id, URL_KEY);

    const dispatchedAt = new Date(Date.now() - 30 * 60 * 1000);
    for (const id of [waiter._id, root._id, mid._id]) {
      await dispatchStore.historyCollection.updateOne(
        { _id: id, urlKey: URL_KEY },
        { $set: { dispatchedAt, resolvedAt: dispatchedAt } }
      );
    }
    // The wait names the MID row id, not the root. The target lineage (root) is
    // stopped, so resolving the mid id to its lineage is what makes it fire.
    await dispatchStore.addFeedback(waiter._id, URL_KEY, {
      message: `[pending] waiting on the worker dispatch ${mid._id}`
    }, null);
    await dispatchStore.addFeedback(root._id, URL_KEY, {
      message: '[working] the stopped lineage last moved long ago (1 tool in 5s)'
    }, null);
    return { root, mid, at: Date.now() + 20 * 60 * 1000 };
  }

  test('design 5(c) / N14 M4: a mid-lineage row id of a non-waiter lineage resolves and fires one orphan', async () => {
    const { root, mid, at } = await seedMidLineageTarget();

    // Confirm the real lean projection carries the mid row in the root lineage.
    const loops = await getLoopsForWorkspace(URL_KEY, { dispatchStore, agentStatusStore, lean: true });
    const byLoop = new Map(loops.map((l) => [l.loopId, l]));
    assert.ok(byLoop.get(mid._id), `the mid row appears in the lean feed, got ${JSON.stringify([...byLoop.keys()])}`);
    assert.equal(byLoop.get(mid._id).lineageId, root._id, 'the mid row is in the root lineage');

    await sweepOneWorkspace(URL_KEY, at, {
      dispatchStore,
      dispatchTokenStore: {},
      proxyTokenStore: null,
      agentStatusStore,
      alarmStore,
      getLoops: getLoopsForWorkspace,
      getLastSeen: async () => new Date(at - 60_000).toISOString()
    });

    const all = await alarmStore.list(URL_KEY, { state: 'all' });
    const d2 = all.filter((a) => a.rule === LIVENESS_ALARM_RULES.STOPPED_OR_CIRCULAR_WAIT);
    assert.equal(d2.length, 1, `exactly one D2 record over the real path, got ${JSON.stringify(all.map((a) => a._id))}`);
    assert.equal(d2[0].shape, 'orphan');
    assert.deepEqual(d2[0].leafLineages, [root._id], 'the mid id resolved to the root lineage');
    assert.deepEqual(d2[0].members, ['ticket:LIN-8888'], 'keyed on the resolved lineage ticket');
  });
});

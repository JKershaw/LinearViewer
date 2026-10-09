/**
 * LIN-3365: the false-live-rows instrument. Real MangoDB tmpdir for the history
 * reads; ticket state, loops and decisions are injected.
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MangoClient } from '@jkershaw/mangodb';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { runFalseLiveRows, defaultReadTicketState } from '../../scripts/false-live-rows.js';
import { runLineageBackfill } from '../../scripts/lineage-close-backfill-lin3365.js';
import { TICKET_CLOSED_GRACE_MS } from '../../lib/lineage-closure.js';
import { AgentStatusStore } from '../../lib/agent-status-store.js';
import { getLoopsForWorkspace } from '../../lib/pipeline-loops.js';
import { closeTicketRows } from '../../lib/ticket-close-closer.js';

const NOW = Date.UTC(2026, 9, 1);
const ago = (days, min = 0) => new Date(NOW - days * 86400000 + min * 60000);

describe('false-live-rows (LIN-3365)', () => {
  let dbDir, client, store, history, counter = 0;
  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'false-live-'));
    client = new MangoClient(dbDir);
    await client.connect();
  });
  after(async () => {
    if (client?.close) await client.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });
  beforeEach(() => {
    const db = client.db(`fl_${counter++}`);
    history = db.collection('dispatch-history');
    store = new DispatchQueueStore({ collection: db.collection('dispatch-queue'), historyCollection: history });
    store._notifyWriteForDoc = () => {};
  });

  const seed = (id, o = {}) => history.insertOne({
    _id: id, urlKey: 'acme', issueIdentifier: 'LIN-1', rootItemId: 'P', kind: 'implementation', status: 'taken',
    dispatchedAt: ago(2, 1), resolvedAt: ago(2, 2), followUpTo: 'P', feedback: [], bookkeeping: null, ...o
  });
  const blockedLoop = (loopId, issueIdentifier) => ({ loopId, issueIdentifier, terminalStatus: null, wakeMarker: 'blocked', agentState: null, historyStatus: 'taken', source: 'history', bookkeeping: null });
  const decisionLoop = (loopId, issueIdentifier, extra = {}) => ({
    ...blockedLoop(loopId, issueIdentifier), dispatchedAt: new Date(NOW - 3 * TICKET_CLOSED_GRACE_MS).toISOString(),
    decision: { decision_id: `dec-${loopId}`, question: 'q', options: [] }, decisionCase: [], answeredDecisions: [],
    withdrawal: null, withdrawalReversed: false, workspaceUrlKey: 'acme', ...extra
  });
  const termTicket = { issueId: 'iid', stateType: 'completed' };
  const run = (o = {}) => runFalseLiveRows({
    dispatchStore: store, urlKeys: ['acme'], now: NOW,
    readLoops: async () => [], readTicketState: async () => null, ...o
  });
  const w = (r) => r.perWorkspace[0];

  async function lineageFixture() {
    await seed('P', { followUpTo: null, dispatchedAt: ago(2), resolvedAt: ago(2), feedback: [{ message: '[done] ok', timestamp: ago(2, 30), rootItemId: 'P' }] });
    await seed('beat');                                      // clause 2
    await seed('queued-busy', { resolvedAt: ago(2, 45) });   // taken after the terminal: NOT counted
    await seed('w-old', { kind: 'wake', rootItemId: 'R', followUpTo: 'X', dispatchedAt: ago(1, 1), resolvedAt: ago(1, 2), feedback: [{ message: 'hb', timestamp: ago(1, 3), rootItemId: 'R' }] });
    await seed('w-new', { kind: 'wake', rootItemId: 'R', followUpTo: 'X', dispatchedAt: ago(1, 10), resolvedAt: ago(1, 11), feedback: [{ message: 'hb', timestamp: ago(1, 12), rootItemId: 'R' }] }); // clause 1: w-old
    await seed('w-pre', { kind: 'wake', rootItemId: 'S', followUpTo: 'X', dispatchedAt: ago(1, 1), resolvedAt: ago(1, 2) });
    await seed('w-succ-unposted', { kind: 'wake', rootItemId: 'S', followUpTo: 'X', dispatchedAt: ago(1, 10), resolvedAt: ago(1, 11) }); // pre-first-heartbeat: not clause 1
    await seed('beat-inflight', { rootItemId: 'T', followUpTo: null, dispatchedAt: ago(1, 1), resolvedAt: ago(1, 2) });
    await seed('beat-later', { rootItemId: 'T', followUpTo: 'beat-inflight', dispatchedAt: ago(1, 10), resolvedAt: ago(1, 11) }); // informational
  }

  test('clauses 1 and 2 flag their rows; queued-busy, pre-heartbeat successor and in-flight non-wake rows are not counted; headline puts unknown first', async () => {
    await lineageFixture();
    const r = await run();
    assert.equal(w(r).clause1, 1);
    assert.equal(w(r).clause2, 1);
    assert.equal(w(r).informational, 1);
    assert.match(r.report.split('\n')[0], /^# False live rows — unknown: 0 \| false-live: 2 \(c1 1, c2 1, c3 0, c4 0\)/);
  });

  test('clause 3 flags blocked/silent rows on a terminal ticket (canceled and duplicate included); a row quiet less than the grace and an open ticket are not counted', async () => {
    const states = {
      'LIN-OLD': termTicket,
      'LIN-CXL': { issueId: 'i2', stateType: 'canceled' },
      'LIN-DUP': { issueId: 'i3', stateType: 'duplicate' },
      'LIN-FRESH': termTicket,
      'LIN-OPEN': { issueId: 'i4', stateType: 'started' }
    };
    const r = await run({
      readLoops: async () => [
        blockedLoop('l1', 'LIN-OLD'), blockedLoop('l1b', 'LIN-CXL'), blockedLoop('l1c', 'LIN-DUP'),
        { ...blockedLoop('l2', 'LIN-FRESH'), dispatchedAt: new Date(NOW - 1000).toISOString() },
        blockedLoop('l3', 'LIN-OPEN')
      ],
      readTicketState: async (_k, issue) => states[issue]
    });
    assert.equal(w(r).clause3, 3);
  });

  test('clause 4 flags an open decision on a terminal ticket; a decision on an open ticket is not counted', async () => {
    const r = await run({
      readLoops: async () => [decisionLoop('a', 'LIN-OLD'), decisionLoop('b', 'LIN-OPEN')],
      readTicketState: async (_k, issue) => (issue === 'LIN-OLD' ? termTicket : { issueId: 'x', stateType: 'started' })
    });
    // each blocked decision-bearing row is also a clause-3 row on the terminal ticket
    assert.equal(w(r).clause4, 1);
  });

  test('a reversed ruling on a terminal ticket is humanReopened, not clause 3/4 (LIN-3366 Finding 1)', async () => {
    const r = await run({
      readLoops: async () => [decisionLoop('a', 'LIN-OLD', { withdrawalReversed: true })],
      readTicketState: async () => termTicket
    });
    assert.equal(w(r).clause3, 0);
    assert.equal(w(r).clause4, 0);
    assert.equal(w(r).humanReopened, 2); // the carrier row and the decision
    assert.match(r.report, /Human-reopened .*: 2/);
  });

  test('a legacy digest (no withdrawalReversed key) is verified from raw feedback: a reversed ruling reads humanReopened, and measuring writes nothing (persist:false)', async () => {
    await seed('legacy', { feedback: [
      { kind: 'decision', message: JSON.stringify({ decision_id: 'dec-legacy', question: 'q', options: [] }), timestamp: ago(2, 3) },
      { kind: 'decision-withdrawn', message: JSON.stringify({ decision_id: 'dec-legacy', reason: 'ticket-closed: x' }), timestamp: ago(2, 4) },
      { kind: 'decision-withdrawal-reversed', message: JSON.stringify({ decision_id: 'dec-legacy' }), timestamp: ago(2, 5) }
    ] });
    const before = JSON.stringify(await history.find({}).toArray());
    const legacy = decisionLoop('legacy', 'LIN-1', { withdrawalReversed: undefined });
    const r = await run({ readLoops: async () => [legacy], readTicketState: async () => termTicket });
    assert.equal(JSON.stringify(await history.find({}).toArray()), before, 'no digest written back');
    assert.equal(w(r).clause3, 0);
    assert.equal(w(r).clause4, 0);
    assert.equal(w(r).humanReopened, 2);
  });

  test('writer/measurer tie: closeTicketRows takes clauses 3 and 4 from N to 0, with 0 false closes', async () => {
    const agentStatusStore = new AgentStatusStore({ collection: client.db('fl_status').collection('s') });
    const mins = (m) => new Date(Date.now() - m * 60000);
    await history.insertOne({ _id: 'b1', urlKey: 'acme', issueIdentifier: 'LIN-1', issueId: 'iid-1', rootItemId: 'b1', kind: 'implementation', status: 'taken', dispatchedAt: mins(300), resolvedAt: mins(299), bookkeeping: null, feedback: [
      { kind: 'decision', message: JSON.stringify({ decision_id: 'dec-b1', question: 'q', options: [] }), timestamp: mins(290) },
      { message: '[blocked] waiting', timestamp: mins(280) }] });
    const readLoops = () => getLoopsForWorkspace('acme', { lean: true, dispatchStore: store, agentStatusStore });
    const readTicketState = async () => ({ issueId: 'iid-1', stateType: 'completed' });
    const now = Date.now();
    const before = await runFalseLiveRows({ dispatchStore: store, urlKeys: ['acme'], now, readLoops, readTicketState });
    assert.equal(w(before).clause3, 1);
    assert.equal(w(before).clause4, 1);
    await closeTicketRows({ urlKey: 'acme', ticket: { issueId: 'iid-1', identifier: 'LIN-1', stateType: 'completed' }, dispatchStore: store, agentStatusStore, now, log: () => {} });
    const after = await runFalseLiveRows({ dispatchStore: store, urlKeys: ['acme'], now, readLoops, readTicketState });
    assert.equal(w(after).clause3, 0);
    assert.equal(w(after).clause4, 0);
    assert.equal(w(after).falseCloses.reopened.length, 0);
  });

  describe('legacy key-less digest on a [done] / bookkeeping-stamped content loop (LIN-3366 FC call item 2)', () => {
    const mins = (m) => new Date(Date.now() - m * 60000);
    const variants = [
      ['[done]', { feedbackExtra: [{ message: '[done] finished', timestamp: mins(100) }], bookkeeping: null }],
      ['bookkeeping-stamped', { feedbackExtra: [], bookkeeping: { reason: 'handed-on', by: 'lineage-closer', at: mins(90) } }]
    ];
    const seedLegacy = async ({ feedbackExtra, bookkeeping }, { reversed = false } = {}) => {
      await history.insertOne({ _id: 'a', urlKey: 'acme', issueIdentifier: 'LIN-1', issueId: 'iid-1', rootItemId: 'a', kind: 'implementation', status: 'taken', dispatchedAt: mins(300), resolvedAt: mins(299), bookkeeping, feedback: [
        { kind: 'decision', message: JSON.stringify({ decision_id: 'dec-a', question: 'q', options: [] }), timestamp: mins(290) },
        { message: '[blocked] waiting', timestamp: mins(280) },
        ...feedbackExtra] });
      const agentStatusStore = new AgentStatusStore({ collection: client.db('fl_status2').collection('s') });
      await getLoopsForWorkspace('acme', { lean: true, dispatchStore: store, agentStatusStore }); // writes the digest
      if (reversed) {
        await store.markDecisionWithdrawn('a', 'acme', 'dec-a', 'ticket-closed: x');
        await store.markDecisionWithdrawalReversed('a', 'acme', 'dec-a');
      }
      const doc = await history.findOne({ _id: 'a' });
      delete doc.feedbackDigest.withdrawalReversed;
      await history.replaceOne({ _id: 'a' }, doc);
      return agentStatusStore;
    };
    const ticket = { issueId: 'iid-1', identifier: 'LIN-1', stateType: 'completed' };
    const readTicketState = async () => ({ issueId: 'iid-1', stateType: 'completed' });

    for (const [name, v] of variants) {
      test(`${name}, no reversal: clause 4 counts the ruling before the run and 0 after`, async () => {
        const agentStatusStore = await seedLegacy(v);
        const readLoops = () => getLoopsForWorkspace('acme', { lean: true, dispatchStore: store, agentStatusStore });
        const now = Date.now();
        const before = await runFalseLiveRows({ dispatchStore: store, urlKeys: ['acme'], now, readLoops, readTicketState });
        assert.equal(w(before).clause4, 1);
        assert.equal(w(before).humanReopened, 0);
        const r = await closeTicketRows({ urlKey: 'acme', ticket, dispatchStore: store, agentStatusStore, now, log: () => {} });
        assert.equal(r.withdrawn, 1);
        const after = await runFalseLiveRows({ dispatchStore: store, urlKeys: ['acme'], now, readLoops, readTicketState });
        assert.equal(w(after).clause4, 0);
        assert.equal(w(after).falseCloses.reopened.length, 0);
      });
      test(`${name}, reversed: counted as humanReopened (not clause 4) and nothing is written`, async () => {
        const agentStatusStore = await seedLegacy(v, { reversed: true });
        const readLoops = () => getLoopsForWorkspace('acme', { lean: true, dispatchStore: store, agentStatusStore });
        const now = Date.now();
        const snapshot = JSON.stringify(await history.find({}).toArray());
        const r = await runFalseLiveRows({ dispatchStore: store, urlKeys: ['acme'], now, readLoops, readTicketState });
        assert.equal(w(r).clause4, 0);
        assert.ok(w(r).humanReopened >= 1);
        assert.equal(JSON.stringify(await history.find({}).toArray()), snapshot, 'instrument writes nothing');
      });
    }
  });

  test('an unreadable ticket is unknown, never false-live, and leads the headline', async () => {
    const r = await run({
      readLoops: async () => [blockedLoop('l1', 'LIN-X'), decisionLoop('l2', 'LIN-Y')],
      readTicketState: async () => null
    });
    assert.equal(w(r).unknown, 2);
    assert.equal(w(r).clause3, 0);
    assert.equal(w(r).clause4, 0);
    assert.match(r.report.split('\n')[0], /unknown: 2 \| false-live: 0/);
  });

  test('false closes: each case is flagged', async () => {
    await seed('P', { followUpTo: null, dispatchedAt: ago(2), resolvedAt: ago(2) });
    await seed('bad-handed', { bookkeeping: { at: ago(1), by: 'x', reason: 'handed-on' }, kind: 'wake' });
    await seed('bad-term', { bookkeeping: { at: ago(1), by: 'x', reason: 'lineage-terminal' }, rootItemId: 'Q' });
    await seed('reopened', { rootItemId: 'Z', bookkeeping: { at: ago(1), by: 'x', reason: 'ticket-closed' } });
    await seed('withdrawn', { rootItemId: 'W', feedback: [{ kind: 'decision-withdrawn', message: JSON.stringify({ decision_id: 'd', reason: 'ticket-closed' }), timestamp: ago(1) }] });
    const r = await run({ readTicketState: async () => ({ issueId: 'x', stateType: 'started' }) });
    const fc = w(r).falseCloses;
    assert.deepEqual(fc['handed-on'], ['bad-handed']);
    assert.deepEqual(fc['lineage-terminal'], ['bad-term']);
    assert.deepEqual(fc.reopened.sort(), ['reopened', 'withdrawn:decision-withdrawn']);
  });

  test('a correct handed-on / lineage-terminal stamp is not a false close', async () => {
    await seed('P', { followUpTo: null, dispatchedAt: ago(2), resolvedAt: ago(2), feedback: [{ message: '[done] ok', timestamp: ago(2, 30), rootItemId: 'P' }] });
    await seed('ok-term', { bookkeeping: { at: ago(2, 40), by: 'x', reason: 'lineage-terminal' } });
    const r = await run();
    assert.deepEqual(w(r).falseCloses['lineage-terminal'], []);
  });

  test('after running the backfill on the fixture, clauses 1 and 2 read 0', async () => {
    await lineageFixture();
    const before = await run();
    assert.equal(w(before).clause1 + w(before).clause2, 2);
    await runLineageBackfill({ dispatchStore: store, urlKeys: ['acme'], now: NOW, execute: true });
    const after = await run();
    assert.equal(w(after).clause1, 0);
    assert.equal(w(after).clause2, 0);
  });

  test('is read-only: it writes nothing', async () => {
    await lineageFixture();
    const snap = JSON.stringify(await history.find({}).sort({ _id: 1 }).toArray());
    await run();
    assert.equal(JSON.stringify(await history.find({}).sort({ _id: 1 }).toArray()), snap);
  });

  test('default ticket read: no base or a failing fetch yields null (unknown)', async () => {
    assert.equal(await defaultReadTicketState('acme', 'LIN-1', { base: '' }), null);
    assert.equal(await defaultReadTicketState('acme', 'LIN-1', { base: 'http://x', fetchImpl: async () => { throw new Error('down'); } }), null);
    const fetchImpl = async () => ({ ok: true, json: async () => ({ id: 'iid', state: { type: 'completed' } }) });
    const ok = await defaultReadTicketState('acme', 'LIN-1', { base: 'http://x', fetchImpl, ticketUrlKey: 'acme' });
    assert.equal(ok.stateType, 'completed');
  });

  test('default ticket read is scoped to the passed workspace: any other urlKey (or none) reads unknown, never fetches', async () => {
    let calls = 0;
    const fetchImpl = async () => { calls += 1; return { ok: true, json: async () => ({ state: { type: 'completed' }, completedAt: '2026-09-30T00:00:00Z' }) }; };
    assert.equal(await defaultReadTicketState('other', 'LIN-1', { base: 'http://x', fetchImpl, ticketUrlKey: 'acme' }), null);
    assert.equal(await defaultReadTicketState('acme', 'LIN-1', { base: 'http://x', fetchImpl, ticketUrlKey: undefined }), null);
    assert.equal(calls, 0);
    assert.equal((await defaultReadTicketState('acme', 'LIN-1', { base: 'http://x', fetchImpl, ticketUrlKey: 'acme' })).stateType, 'completed');
    assert.equal(calls, 1);
  });

  test('report says other-workspace tickets read unknown', async () => {
    const r = await run();
    assert.match(r.report, /includes: tickets of any workspace other than --ticket-workspace/);
  });
});

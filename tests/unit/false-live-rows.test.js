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
  const termTicket = { stateType: 'completed', terminalAtMs: NOW - 2 * TICKET_CLOSED_GRACE_MS };
  const run = (o = {}) => runFalseLiveRows({
    dispatchStore: store, urlKeys: ['acme'], now: NOW,
    readLoops: async () => [], collectDecisions: () => [], readTicketState: async () => null, ...o
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

  test('clause 3 flags blocked/silent rows on a terminal ticket past grace; a fresh close and an open ticket are not counted', async () => {
    const states = {
      'LIN-OLD': termTicket,
      'LIN-FRESH': { stateType: 'completed', terminalAtMs: NOW - 1000 },
      'LIN-OPEN': { stateType: 'started', terminalAtMs: null }
    };
    const r = await run({
      readLoops: async () => [blockedLoop('l1', 'LIN-OLD'), blockedLoop('l2', 'LIN-FRESH'), blockedLoop('l3', 'LIN-OPEN')],
      readTicketState: async (_k, issue) => states[issue]
    });
    assert.equal(w(r).clause3, 1);
  });

  test('clause 4 flags an open decision on a terminal ticket; no "newer decision supersedes" half (a decision on an open ticket is not counted)', async () => {
    const r = await run({
      collectDecisions: () => [{ anchor: { issueIdentifier: 'LIN-OLD' }, decision: { id: 'd1' } }, { anchor: { issueIdentifier: 'LIN-OPEN' }, decision: { id: 'd2' } }],
      readTicketState: async (_k, issue) => (issue === 'LIN-OLD' ? termTicket : { stateType: 'started', terminalAtMs: null })
    });
    assert.equal(w(r).clause4, 1);
  });

  test('an unreadable ticket is unknown, never false-live, and leads the headline', async () => {
    const r = await run({
      readLoops: async () => [blockedLoop('l1', 'LIN-X')],
      collectDecisions: () => [{ anchor: { issueIdentifier: 'LIN-Y' }, decision: { id: 'd' } }],
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
    const r = await run({ readTicketState: async () => ({ stateType: 'started', terminalAtMs: null }) });
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
    const ok = await defaultReadTicketState('acme', 'LIN-1', { base: 'http://x', fetchImpl: async () => ({ ok: true, json: async () => ({ state: { type: 'completed' }, completedAt: '2026-09-30T00:00:00Z' }) }) });
    assert.equal(ok.stateType, 'completed');
  });
});

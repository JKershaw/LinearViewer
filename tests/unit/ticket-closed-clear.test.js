/**
 * LIN-3399: the one-off ticket-closed clear. Real MangoDB tmpdir; loops and
 * ticket state injected (same fixture shape as false-live-rows.test.js).
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MangoClient } from '@jkershaw/mangodb';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { AgentStatusStore } from '../../lib/agent-status-store.js';
import { getLoopsForWorkspace } from '../../lib/pipeline-loops.js';
import { closeTicketRows } from '../../lib/ticket-close-closer.js';
import { runTicketClosedClear, LineageBackfillPendingError, CLEAR_BY_DEFAULT } from '../../scripts/ticket-closed-clear-lin3399.js';
import { runFalseLiveRows } from '../../scripts/false-live-rows.js';

const mins = (m) => new Date(Date.now() - m * 60000);
const ticket = { issueId: 'iid-1', stateType: 'completed' };

describe('ticket-closed-clear (LIN-3399)', () => {
  let dbDir, client, store, history, agentStatusStore, counter = 0;
  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'ticket-clear-'));
    client = new MangoClient(dbDir);
    await client.connect();
  });
  after(async () => {
    if (client?.close) await client.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });
  beforeEach(() => {
    const db = client.db(`tc_${counter++}`);
    history = db.collection('dispatch-history');
    store = new DispatchQueueStore({ collection: db.collection('dispatch-queue'), historyCollection: history });
    store._notifyWriteForDoc = () => {};
    agentStatusStore = new AgentStatusStore({ collection: db.collection('s') });
  });

  // A blocked, quiet row with an open ruling on LIN-1.
  const seedBlocked = (id = 'b1', o = {}) => history.insertOne({
    _id: id, urlKey: 'acme', issueIdentifier: 'LIN-1', issueId: 'iid-1', rootItemId: id, kind: 'implementation', status: 'taken',
    dispatchedAt: mins(300), resolvedAt: mins(299), bookkeeping: null, feedback: [
      { kind: 'decision', message: JSON.stringify({ decision_id: `dec-${id}`, question: 'q', options: [] }), timestamp: mins(290) },
      { message: '[blocked] waiting', timestamp: mins(280) }], ...o
  });
  const run = (o = {}) => runTicketClosedClear({
    dispatchStore: store, agentStatusStore, urlKeys: ['acme'],
    readTicketState: async () => ticket, log: () => {}, ...o
  });
  const readLoops = () => getLoopsForWorkspace('acme', { lean: true, dispatchStore: store, agentStatusStore });
  const live = () => runFalseLiveRows({ dispatchStore: store, urlKeys: ['acme'], readLoops, readTicketState: async () => ticket });

  // The loops read caches a digest on first sight (pre-existing); compare the fields a clear would write.
  const written = async () => JSON.stringify((await history.find({}).toArray()).map(r => [r._id, r.status, r.bookkeeping, r.feedback]));

  test('dry run reports what it would clear and writes nothing', async () => {
    await seedBlocked();
    const before = await written();
    const r = await run();
    assert.equal(await written(), before);
    assert.equal(r.execute, false);
    assert.equal(r.perWorkspace[0].rows, 1);
    assert.equal(r.perWorkspace[0].loopDecisions, 1);
    assert.match(r.report, /DRY RUN/);
    assert.match(r.report, /blocked\/silent rows \(clause 3\)\s+1/);
  });

  test('--execute takes clauses 3 and 4 from N to 0, stamps the clear\'s own actor, and is idempotent', async () => {
    await seedBlocked();
    const before = (await live()).perWorkspace[0];
    assert.equal(before.clause3, 1);
    assert.equal(before.clause4, 1);

    const r = await run({ execute: true });
    assert.equal(r.remaining, 0);
    assert.equal(r.perWorkspace[0].closed.closedRows, 1);
    assert.equal(r.perWorkspace[0].closed.withdrawn, 1);
    const row = await history.findOne({ _id: 'b1' });
    assert.equal(row.bookkeeping.reason, 'ticket-closed');
    assert.equal(row.bookkeeping.by, CLEAR_BY_DEFAULT);

    const after = (await live()).perWorkspace[0];
    assert.equal(after.clause3, 0);
    assert.equal(after.clause4, 0);
    assert.equal(after.falseCloses['ticket-closed'].length, 0);
    assert.equal(after.falseCloses.reopened.length, 0);

    const again = await run({ execute: true });
    assert.equal(again.perWorkspace[0].closed.closedRows, 0);
  });

  test('--by overrides the recorded actor', async () => {
    await seedBlocked();
    await run({ execute: true, by: 'operator-x' });
    assert.equal((await history.findOne({ _id: 'b1' })).bookkeeping.by, 'operator-x');
  });

  test('an unreadable or open ticket is never cleared', async () => {
    await seedBlocked('b1');
    await seedBlocked('b2', { issueIdentifier: 'LIN-2', issueId: 'iid-2' });
    await seedBlocked('b3', { issueIdentifier: 'LIN-3', issueId: 'iid-3' });
    const r = await run({
      execute: true,
      readTicketState: async (_k, issue) => ({ 'LIN-1': null, 'LIN-2': { issueId: 'iid-2', stateType: 'started' } }[issue] ?? null)
    });
    assert.equal(r.perWorkspace[0].closed.closedRows, 0);
    assert.equal(r.perWorkspace[0].unknown, 2);
    assert.equal(r.perWorkspace[0].notTerminal, 1);
    for (const id of ['b1', 'b2', 'b3']) assert.equal((await history.findOne({ _id: id })).bookkeeping, null);
  });

  test('--execute is refused while the lineage selector still has writable rows, and nothing is written', async () => {
    // A taken row dispatched before its lineage's terminal: LIN-3365's backfill would stamp it.
    await history.insertOne({ _id: 'P', urlKey: 'acme', issueIdentifier: 'LIN-1', rootItemId: 'P', kind: 'implementation', status: 'taken', dispatchedAt: mins(400), resolvedAt: mins(399), followUpTo: null, bookkeeping: null, feedback: [{ message: '[done] ok', timestamp: mins(390), rootItemId: 'P' }] });
    await history.insertOne({ _id: 'beat', urlKey: 'acme', issueIdentifier: 'LIN-1', rootItemId: 'P', kind: 'implementation', status: 'taken', dispatchedAt: mins(395), resolvedAt: mins(394), followUpTo: 'P', bookkeeping: null, feedback: [] });
    await seedBlocked();
    const before = await written();
    await assert.rejects(run({ execute: true }), (e) => e instanceof LineageBackfillPendingError && e.pending >= 1);
    assert.equal(await written(), before);
    // A dry run is still allowed.
    await run();
  });

  test('closeTicketRows stamps "ticket-closer" by default and the passed actor when given', async () => {
    await seedBlocked('b1');
    await seedBlocked('b2', { dispatchedAt: mins(301) });
    const t = { issueId: 'iid-1', identifier: 'LIN-1', stateType: 'completed' };
    await closeTicketRows({ urlKey: 'acme', ticket: t, dispatchStore: store, agentStatusStore, log: () => {} });
    assert.equal((await history.findOne({ _id: 'b1' })).bookkeeping.by, 'ticket-closer');
    await seedBlocked('b3', { dispatchedAt: mins(302) });
    await closeTicketRows({ urlKey: 'acme', ticket: t, dispatchStore: store, agentStatusStore, by: 'x', log: () => {} });
    assert.equal((await history.findOne({ _id: 'b3' })).bookkeeping.by, 'x');
  });
});

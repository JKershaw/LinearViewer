/**
 * LIN-3433 beat 1: characterization of what the paired measure must NOT change
 * in scripts/false-live-rows.js: clauses 1, 2 and 4 (membership, not just
 * counts), the clean-board headline, and false closes = 0. Written against the
 * pre-change script; they must stay green through the clause-3 rewrite.
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MangoClient } from '@jkershaw/mangodb';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { runFalseLiveRows } from '../../scripts/false-live-rows.js';
import { selectForWorkspace } from '../../scripts/lineage-close-backfill-lin3365.js';
import { TICKET_CLOSED_GRACE_MS } from '../../lib/lineage-closure.js';

const NOW = Date.UTC(2026, 9, 1);
const ago = (days, min = 0) => new Date(NOW - days * 86400000 + min * 60000);

describe('false-live-rows: c1, c2, c4 and false closes are pinned (LIN-3433)', () => {
  let dbDir, client, store, history, counter = 0;
  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'false-live-3433-'));
    client = new MangoClient(dbDir);
    await client.connect();
  });
  after(async () => {
    if (client?.close) await client.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });
  beforeEach(() => {
    const db = client.db(`c_${counter++}`);
    history = db.collection('dispatch-history');
    store = new DispatchQueueStore({ collection: db.collection('dispatch-queue'), historyCollection: history });
    store._notifyWriteForDoc = () => {};
  });

  const seed = (id, o = {}) => history.insertOne({
    _id: id, urlKey: 'acme', issueIdentifier: 'LIN-1', rootItemId: 'P', kind: 'implementation', status: 'taken',
    dispatchedAt: ago(2, 1), resolvedAt: ago(2, 2), followUpTo: 'P', feedback: [], bookkeeping: null, ...o
  });
  const decisionLoop = (loopId, issueIdentifier, extra = {}) => ({
    loopId, issueIdentifier, terminalStatus: null, wakeMarker: 'blocked', agentState: null, historyStatus: 'taken', source: 'history', bookkeeping: null,
    dispatchedAt: new Date(NOW - 3 * TICKET_CLOSED_GRACE_MS).toISOString(),
    decision: { decision_id: `dec-${loopId}`, question: 'q', options: [] }, decisionCase: [], answeredDecisions: [],
    withdrawal: null, withdrawalReversed: false, workspaceUrlKey: 'acme', ...extra
  });
  const states = { 'LIN-DONE': { issueId: 'i1', stateType: 'completed' }, 'LIN-CXL': { issueId: 'i2', stateType: 'canceled' }, 'LIN-OPEN': { issueId: 'i3', stateType: 'started' } };
  const run = (o = {}) => runFalseLiveRows({
    dispatchStore: store, urlKeys: ['acme'], now: NOW,
    readLoops: async () => [], readTicketState: async (_k, issue) => states[issue] ?? null, ...o
  });
  const w = (r) => r.perWorkspace[0];

  async function seedLineage() {
    await seed('P', { followUpTo: null, dispatchedAt: ago(2), resolvedAt: ago(2), feedback: [{ message: '[done] ok', timestamp: ago(2, 30), rootItemId: 'P' }] });
    await seed('beat');                                                                                                  // c2
    await seed('queued-busy', { resolvedAt: ago(2, 45) });                                                                // taken after terminal: not counted
    await seed('w-old', { kind: 'wake', rootItemId: 'R', followUpTo: 'X', dispatchedAt: ago(1, 1), resolvedAt: ago(1, 2), feedback: [{ message: 'hb', timestamp: ago(1, 3), rootItemId: 'R' }] });
    await seed('w-new', { kind: 'wake', rootItemId: 'R', followUpTo: 'X', dispatchedAt: ago(1, 10), resolvedAt: ago(1, 11), feedback: [{ message: 'hb', timestamp: ago(1, 12), rootItemId: 'R' }] }); // c1: w-old
  }

  test('c1 and c2 flag exactly the rows the closers write (w-old / beat), and a second wake successor is not c1', async () => {
    await seedLineage();
    const sel = await selectForWorkspace({ dispatchStore: store, urlKey: 'acme', now: NOW });
    assert.deepEqual(sel.writable.filter(c => c.reason === 'handed-on').map(c => c.id ?? c._id ?? c.itemId), ['w-old']);
    assert.deepEqual(sel.writable.filter(c => c.reason === 'lineage-terminal').map(c => c.id ?? c._id ?? c.itemId), ['beat']);
    const r = await run();
    assert.equal(w(r).clause1, 1);
    assert.equal(w(r).clause2, 1);
  });

  test('c4 counts an open loop decision on a done or canceled ticket, not on an open or unreadable one', async () => {
    const r = await run({
      readLoops: async () => [
        decisionLoop('a', 'LIN-DONE'), decisionLoop('b', 'LIN-CXL'), decisionLoop('c', 'LIN-OPEN'), decisionLoop('d', 'LIN-NOREAD')
      ]
    });
    assert.equal(w(r).clause4, 2);
    assert.equal(w(r).unknown, 1);
    assert.match(r.report.split('\n')[0], /^# False live rows — unknown: 1 \| false-live: \d+ \(c1 0, c2 0, c3 \d+, c4 2\) \| false closes: 0$/);
  });

  test('c4 ignores a ruling a human reversed, and a decision quiet for less than the grace', async () => {
    const r = await run({
      readLoops: async () => [
        decisionLoop('rev', 'LIN-DONE', { withdrawalReversed: true }),
        decisionLoop('fresh', 'LIN-DONE', { dispatchedAt: new Date(NOW - 1000).toISOString() })
      ]
    });
    assert.equal(w(r).clause4, 0);
  });

  test('clean board: every clause 0, no false closes, exact headline and clause lines', async () => {
    const r = await run();
    const p = w(r);
    assert.deepEqual([p.clause1, p.clause2, p.clause3, p.clause4, p.unknown], [0, 0, 0, 0, 0]);
    assert.deepEqual(p.falseCloses, { 'handed-on': [], 'lineage-terminal': [], 'ticket-closed': [], reopened: [], unknown: 0 });
    assert.equal(r.report.split('\n')[0], '# False live rows — unknown: 0 | false-live: 0 (c1 0, c2 0, c3 0, c4 0) | false closes: 0');
    assert.match(r.report, /^ {2}1 wake row, a later lineage row has posted \(B\(a\)\) +0$/m);
    assert.match(r.report, /^ {2}2 un-terminated row taken before a lineage terminal \(B\(b\)\) +0$/m);
    assert.match(r.report, /^ {2}4 open decision on a terminal ticket +0$/m);
  });

  test('false closes stay 0 when every stamp is correct (handed-on, lineage-terminal, ticket-closed on a still-terminal ticket)', async () => {
    await seed('P', { followUpTo: null, dispatchedAt: ago(2), resolvedAt: ago(2), feedback: [{ message: '[done] ok', timestamp: ago(2, 30), rootItemId: 'P' }] });
    await seed('ok-term', { bookkeeping: { at: ago(2, 40), by: 'x', reason: 'lineage-terminal' } });
    await seed('w1', { kind: 'wake', rootItemId: 'R', followUpTo: 'X', dispatchedAt: ago(1, 1), resolvedAt: ago(1, 2), bookkeeping: { at: ago(1), by: 'x', reason: 'handed-on' } });
    await seed('w2', { kind: 'wake', rootItemId: 'R', followUpTo: 'X', dispatchedAt: ago(1, 10), resolvedAt: ago(1, 11), feedback: [{ message: 'hb', timestamp: ago(1, 12), rootItemId: 'R' }] });
    await seed('tc', { rootItemId: 'Z', issueIdentifier: 'LIN-DONE', bookkeeping: { at: ago(1), by: 'ticket-closer', reason: 'ticket-closed' } });
    const r = await run();
    const fc = w(r).falseCloses;
    assert.deepEqual([fc['handed-on'], fc['lineage-terminal'], fc['ticket-closed'], fc.reopened], [[], [], [], []]);
    assert.match(r.report.split('\n')[0], /false closes: 0$/);
  });

  test('a ticket-closed stamp on a ticket that is open now is reported as a false close; c1/c2/c4 are unaffected by it', async () => {
    await seed('tc', { rootItemId: 'Z', issueIdentifier: 'LIN-OPEN', bookkeeping: { at: ago(1), by: 'ticket-closer', reason: 'ticket-closed' } });
    const r = await run();
    assert.deepEqual(w(r).falseCloses.reopened, ['tc']);
    assert.deepEqual([w(r).clause1, w(r).clause2, w(r).clause4], [0, 0, 0]);
  });

  test('a handed-on stamp with no later tagged lineage row, and a lineage-terminal stamp with no terminal, are false closes', async () => {
    await seed('P', { followUpTo: null, dispatchedAt: ago(2), resolvedAt: ago(2) });
    await seed('bad-handed', { kind: 'wake', bookkeeping: { at: ago(1), by: 'x', reason: 'handed-on' } });
    await seed('bad-term', { rootItemId: 'Q', bookkeeping: { at: ago(1), by: 'x', reason: 'lineage-terminal' } });
    const r = await run();
    assert.deepEqual(w(r).falseCloses['handed-on'], ['bad-handed']);
    assert.deepEqual(w(r).falseCloses['lineage-terminal'], ['bad-term']);
    assert.match(r.report.split('\n')[0], /false closes: 2$/);
  });
});

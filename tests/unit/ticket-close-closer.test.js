/**
 * LIN-3366: the ticket-closed closer. Real MangoDB tmpdir for history + task
 * decisions, so the digest, the quiet-bound write filter and the stores run for
 * real; the ticket state is injected (the closer does no provider IO).
 */
process.env.NODE_ENV = 'test';

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MangoClient } from '@jkershaw/mangodb';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { AgentStatusStore } from '../../lib/agent-status-store.js';
import { TaskDecisionsStore } from '../../lib/task-decisions-store.js';
import { getLoopsForWorkspace } from '../../lib/pipeline-loops.js';
import { TICKET_CLOSED_GRACE_MS } from '../../lib/lineage-closure.js';
import {
  reversalState, isSettledForCloser, closerCandidates, prepareCloserCandidates, selectTicketCloseWork,
  closeTicketRows, ticketFromWrite, createOnTicketWrite, ticketClosedBasisHash, LEGACY_VERIFY_CAP
} from '../../lib/ticket-close-closer.js';

const URL_KEY = 'acme';
const ISSUE_UUID = '11111111-2222-3333-4444-555555555555';
const OTHER_UUID = '99999999-2222-3333-4444-555555555555';
const mins = (m) => new Date(Date.now() - m * 60000);
const done = { issueId: 'iid-1', identifier: 'LIN-1', stateType: 'completed' };

describe('ticket-close-closer (LIN-3366)', () => {
  let dbDir, client, store, history, agentStatusStore, tdCollection, tdStore, counter = 0, logs, infos;
  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'ticket-closer-'));
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
    agentStatusStore = new AgentStatusStore({ collection: db.collection('status') });
    tdCollection = db.collection('task-decisions');
    tdStore = new TaskDecisionsStore({ collection: tdCollection });
    logs = []; infos = [];
  });

  const log = (m) => logs.push(m);
  const info = (m) => infos.push(m);

  // A blocked history row with a decision; quiet for `quietMin` minutes.
  const seedBlocked = (id, { identifier = 'LIN-1', issueId = 'iid-1', decisionId = `dec-${id}`, quietMin = 120, dispatchedAgoMin = quietMin + 20, extra = [], decision = true } = {}) => history.insertOne({
    _id: id, urlKey: URL_KEY, issueIdentifier: identifier, issueId, rootItemId: id, kind: 'implementation', status: 'taken',
    dispatchedAt: mins(dispatchedAgoMin), resolvedAt: mins(dispatchedAgoMin - 1), bookkeeping: null,
    feedback: [
      ...(decision ? [{ kind: 'decision', message: JSON.stringify({ decision_id: decisionId, question: 'q', options: [] }), timestamp: mins(quietMin + 10) }] : []),
      { message: '[blocked] waiting on a human', timestamp: mins(quietMin) },
      ...extra
    ]
  });
  const loopsOf = () => getLoopsForWorkspace(URL_KEY, { lean: true, dispatchStore: store, agentStatusStore });
  const prep = async (o = {}) => {
    const loops = o.loops || await loopsOf();
    return prepareCloserCandidates({ loops, taskDecisions: o.taskDecisions || [], newestScanByTask: o.newestScanByTask || {}, now: Date.now(), dispatchStore: store, log, ...o.extra });
  };
  const close = (o = {}) => closeTicketRows({
    urlKey: URL_KEY, ticket: done, dispatchStore: store, taskDecisionsStore: tdStore, agentStatusStore, log, info, ...o
  });
  const row = (id) => history.findOne({ _id: id });
  const reverse = (id, decisionId) => store.markDecisionWithdrawalReversed(id, URL_KEY, decisionId);

  describe('reversalState / isSettledForCloser (three states)', () => {
    const cells = [
      ['no digest => loop has no decision', { decision: null, withdrawalReversed: false }, 'clear'],
      ['key true', { decision: { decision_id: 'd' }, withdrawalReversed: true }, 'reversed'],
      ['key false', { decision: { decision_id: 'd' }, withdrawalReversed: false }, 'clear'],
      ['key absent + decision', { decision: { decision_id: 'd' }, withdrawalReversed: undefined }, 'unknown'],
      ['key absent + no decision', { decision: null, withdrawalReversed: undefined }, 'clear'],
      ['key true + no decision', { decision: null, withdrawalReversed: true }, 'clear']
    ];
    for (const [name, loop, want] of cells) test(name, () => assert.equal(reversalState(loop), want));
    test('a scan row carrying ticketClosedAt is settled; a reversed loop is settled; a clear one is not', () => {
      assert.equal(isSettledForCloser({ ticketClosedAt: '2026-10-01T00:00:00Z' }), true);
      assert.equal(isSettledForCloser({ decision: { decision_id: 'd' }, withdrawalReversed: true }), true);
      assert.equal(isSettledForCloser({ decision: { decision_id: 'd' }, withdrawalReversed: false }), false);
      assert.equal(isSettledForCloser({ ticketClosedAt: null }), false);
    });
  });

  describe('the digest fact feeds the loop (lean read)', () => {
    test('a freshly digested row reads false; a reversed current decision reads true', async () => {
      await seedBlocked('a');
      await seedBlocked('b');
      assert.equal((await loopsOf()).find(l => l.loopId === 'a').withdrawalReversed, false);
      await store.markDecisionWithdrawn('b', URL_KEY, 'dec-b', 'ticket-closed: LIN-1 reached completed');
      await reverse('b', 'dec-b');
      const loops = await loopsOf();
      assert.equal(loops.find(l => l.loopId === 'b').withdrawalReversed, true);
    });
    test('a legacy digest with the key deleted reads undefined, NOT false', async () => {
      await seedBlocked('a');
      await loopsOf(); // writes the digest
      const doc = await row('a');
      delete doc.feedbackDigest.withdrawalReversed;
      await history.updateOne({ _id: 'a' }, { $set: { feedbackDigest: doc.feedbackDigest } });
      const loop = (await loopsOf()).find(l => l.loopId === 'a');
      assert.equal(loop.withdrawalReversed, undefined);
      assert.equal('withdrawalReversed' in loop, true);
    });
  });

  describe('phase one / phase two selection', () => {
    test('blocked and silent rows quiet past the grace are selected; working and recent rows are not', async () => {
      await seedBlocked('old');
      await seedBlocked('recent', { quietMin: 2, dispatchedAgoMin: 3 });
      await history.insertOne({ _id: 'working', urlKey: URL_KEY, issueIdentifier: 'LIN-1', issueId: 'iid-1', rootItemId: 'working', kind: 'implementation', status: 'taken', dispatchedAt: mins(30), resolvedAt: mins(29), bookkeeping: null, feedback: [{ message: 'tool use heartbeat', timestamp: mins(1) }] });
      const c = await prep();
      assert.deepEqual(c.rows.map(r => r.loopId), ['old']);
    });
    test('a blocked row on an In Progress ticket stays open (phase two returns nothing for a non-terminal state)', async () => {
      await seedBlocked('old');
      const c = await prep();
      assert.deepEqual(selectTicketCloseWork(c, { ...done, stateType: 'started' }).rows, []);
      const r = await close({ ticket: { ...done, stateType: 'started' }, candidates: c });
      assert.equal(r.closedRows, 0);
      assert.equal((await row('old')).bookkeeping, null);
    });
    test('a sibling ticket is untouched by another ticket close', async () => {
      await seedBlocked('mine');
      await seedBlocked('theirs', { identifier: 'LIN-2', issueId: 'iid-2' });
      await close();
      assert.equal((await row('mine')).bookkeeping.reason, 'ticket-closed');
      assert.equal((await row('theirs')).bookkeeping, null);
    });
    test('a row with no decision still closes', async () => {
      await seedBlocked('nodec', { decision: false });
      const r = await close();
      assert.equal(r.closedRows, 1);
    });
  });

  describe('closeTicketRows', () => {
    test('a Done ticket: rows closed, decision withdrawn with the ticket-closed reason, digest fresh, cache cleared once', async () => {
      await seedBlocked('a');
      await seedBlocked('b', { identifier: 'LIN-1' });
      let cleared = 0;
      const r = await close({ sessionsFeedCache: { clear: (k) => { assert.equal(k, URL_KEY); cleared += 1; } } });
      assert.equal(r.closedRows, 2);
      assert.equal(r.withdrawn, 2);
      assert.equal(r.failures, 0);
      assert.equal(cleared, 1);
      const a = await row('a');
      assert.equal(a.bookkeeping.reason, 'ticket-closed');
      assert.equal(a.bookkeeping.by, 'ticket-closer');
      const w = a.feedback.find(f => f.kind === 'decision-withdrawn');
      assert.match(JSON.parse(w.message).reason, /^ticket-closed: LIN-1 reached completed$/);
      assert.equal(a.feedbackDigest.version, a.feedbackVersion, 'digest is fresh');
      assert.equal(a.feedbackDigest.withdrawal.decisionId, 'dec-a');
    });
    test('ORDER WITNESS: the row is closed even though the withdrawal appends fresh feedback (close first, then withdraw)', async () => {
      await seedBlocked('a');
      const order = [];
      const spy = Object.create(store);
      spy.closeIssueRows = async (...a) => { order.push('close'); return store.closeIssueRows(...a); };
      spy.markDecisionWithdrawn = async (...a) => { order.push('withdraw'); return store.markDecisionWithdrawn(...a); };
      const r = await close({ dispatchStore: spy });
      assert.deepEqual(order, ['close', 'withdraw']);
      assert.equal(r.closedRows, 1);
      assert.ok((await row('a')).bookkeeping);
    });
    test('ids and quietSince reach closeIssueRows', async () => {
      await seedBlocked('a');
      let seen;
      const spy = Object.create(store);
      spy.closeIssueRows = async (urlKey, identifier, opts) => { seen = { urlKey, identifier, opts }; return store.closeIssueRows(urlKey, identifier, opts); };
      const now = Date.now();
      await close({ dispatchStore: spy, now });
      assert.equal(seen.identifier, 'LIN-1');
      assert.deepEqual(seen.opts.ids, ['a']);
      assert.equal(seen.opts.quietSince.getTime(), now - TICKET_CLOSED_GRACE_MS);
      assert.equal(seen.opts.reason, 'ticket-closed');
    });
    test('a Duplicate and a Canceled ticket close their rows', async () => {
      await seedBlocked('a');
      await seedBlocked('b', { identifier: 'LIN-2', issueId: 'iid-2' });
      assert.equal((await close({ ticket: { ...done, stateType: 'duplicate' } })).closedRows, 1);
      assert.equal((await close({ ticket: { issueId: 'iid-2', identifier: 'LIN-2', stateType: 'canceled' } })).closedRows, 1);
    });
    test('a second run changes nothing; Done then reopened leaves stamped rows stamped', async () => {
      await seedBlocked('a');
      await close();
      const snap = JSON.stringify(await row('a'));
      const again = await close();
      assert.deepEqual([again.closedRows, again.withdrawn, again.failures], [0, 0, 0]);
      assert.equal(JSON.stringify(await row('a')), snap);
      const reopened = await close({ ticket: { ...done, stateType: 'started' } });
      assert.equal(reopened.closedRows, 0);
      assert.equal(JSON.stringify(await row('a')), snap);
    });
    test('a lineage that resumed between select and write is not closed (closeIssueRows re-asserts the quiet bound)', async () => {
      await seedBlocked('a');
      const c = await prep();
      await history.updateOne({ _id: 'a' }, { $push: { feedback: { message: 'resumed', timestamp: new Date() } } });
      const r = await close({ candidates: c });
      assert.equal(r.closedRows, 0);
      assert.equal((await row('a')).bookkeeping, null);
    });
    test('the running caller own lineage (recent activity) is never closed', async () => {
      await seedBlocked('mine', { quietMin: 1, dispatchedAgoMin: 2 });
      const c = await prep();
      assert.deepEqual(c.rows, [], 'not even selected');
      assert.deepEqual(c.loopDecisions, []);
      assert.equal((await close()).closedRows, 0);
    });
  });

  describe('reversal is terminal (Finding 1)', () => {
    test('a reversed withdrawal is not selected, its carrier row stays open, and two runs log zero failures', async () => {
      await seedBlocked('a', { decisionId: 'dec-a' });
      await seedBlocked('b');
      await close(); // closes both and withdraws both
      await reverse('a', 'dec-a');
      // Human re-opens the ruling: un-retire the carrier row too (as the dashboard does by deleting bookkeeping).
      await history.updateOne({ _id: 'a' }, { $set: { bookkeeping: null } });
      const first = await close();
      const second = await close();
      assert.equal(first.closedRows, 0);
      assert.equal(first.withdrawn, 0);
      assert.equal(second.failures, 0);
      assert.deepEqual(logs, []);
      assert.equal((await row('a')).bookkeeping, null);
      const c = await prep();
      assert.ok(c.settled.some(s => s.loopId === 'a'));
      assert.ok(!c.rows.some(r => r.loopId === 'a'));
      assert.ok(!c.loopDecisions.some(d => d.loopId === 'a'));
    });
    test('a newer decision (new id) on the row makes it eligible again', async () => {
      await seedBlocked('a', { decisionId: 'dec-a' });
      await store.markDecisionWithdrawn('a', URL_KEY, 'dec-a', 'ticket-closed: x');
      await reverse('a', 'dec-a');
      await history.updateOne({ _id: 'a' }, { $push: { feedback: { kind: 'decision', message: JSON.stringify({ decision_id: 'dec-a2', question: 'q2', options: [] }), timestamp: mins(100) } } });
      await history.updateOne({ _id: 'a' }, { $inc: { feedbackVersion: 1 } });
      const c = await prep();
      assert.ok(c.rows.some(r => r.loopId === 'a'));
    });
    test('collectUnansweredDecisions still lists a reversed ruling as open for the human (consumers unchanged)', async () => {
      await seedBlocked('a', { decisionId: 'dec-a' });
      await store.markDecisionWithdrawn('a', URL_KEY, 'dec-a', 'ticket-closed: x');
      await reverse('a', 'dec-a');
      const { collectUnansweredDecisions } = await import('../../lib/unanswered-decisions.js');
      const open = collectUnansweredDecisions({ loops: await loopsOf() }, { now: new Date() });
      assert.equal(open.length, 1);
    });
  });

  describe('legacy digests (Finding A): unknown is held out and verified from raw feedback', () => {
    const stripKey = async (id) => {
      const doc = await row(id);
      delete doc.feedbackDigest.withdrawalReversed;
      await history.replaceOne({ _id: id }, doc);
    };
    const reversedRow = async (id) => {
      await seedBlocked(id, { decisionId: `dec-${id}` });
      await store.markDecisionWithdrawn(id, URL_KEY, `dec-${id}`, 'ticket-closed: LIN-1 reached completed');
      await reverse(id, `dec-${id}`);
      await history.updateOne({ _id: id }, { $set: { bookkeeping: null } });
      await stripKey(id);
    };

    test('a key-less digest with a REVERSED current decision keeps its carrier row unstamped across the first run; the re-digest writes true; the second run changes nothing', async () => {
      await reversedRow('a');
      assert.equal((await loopsOf()).find(l => l.loopId === 'a').withdrawalReversed, undefined);
      const calls = [];
      const spy = Object.create(store);
      spy.closeIssueRows = async (...a) => { calls.push(['close', ...a]); return store.closeIssueRows(...a); };
      spy.markDecisionWithdrawn = async (...a) => { calls.push(['withdraw', ...a]); return store.markDecisionWithdrawn(...a); };
      const first = await close({ dispatchStore: spy });
      assert.deepEqual(calls, [], 'closeIssueRows and markDecisionWithdrawn are not called');
      assert.equal(first.closedRows, 0);
      assert.equal((await row('a')).bookkeeping, null);
      assert.equal((await row('a')).feedbackDigest.withdrawalReversed, true, 're-digest persisted the fact');
      const second = await close({ dispatchStore: spy });
      assert.equal(second.failures, 0);
      assert.deepEqual(calls, []);
      assert.deepEqual(logs, []);
    });
    test('the same fixture WITHOUT the reversal verifies false and closes in the SAME run', async () => {
      await seedBlocked('a');
      await loopsOf();
      await stripKey('a');
      const r = await close();
      assert.equal(r.closedRows, 1);
      assert.equal(r.withdrawn, 1);
      assert.equal((await row('a')).feedbackDigest.withdrawalReversed, false);
    });
    test('a raw re-read that throws closes nothing for the unknown loops and logs verify failure; other loops still close', async () => {
      await seedBlocked('legacy');
      await seedBlocked('modern', { identifier: 'LIN-1' });
      await loopsOf();
      await stripKey('legacy');
      const loops = await loopsOf();
      const r = await closeTicketRows({
        urlKey: URL_KEY, ticket: done, dispatchStore: store, taskDecisionsStore: tdStore, log, info,
        getLoops: async () => loops, redigest: async () => { throw new Error('mongo down'); }
      });
      assert.ok(logs.some(l => /\[ticket-closer\] verify failure/.test(l)));
      assert.equal(r.closedRows, 1);
      assert.equal((await row('legacy')).bookkeeping, null);
      assert.ok((await row('modern')).bookkeeping);
    });
    test('a row missing on the raw re-read stays held out and logs verify failure', async () => {
      await seedBlocked('legacy');
      await loopsOf();
      await stripKey('legacy');
      const c = await prep({ extra: { redigest: async () => new Map() } });
      assert.deepEqual(c.unverified, ['legacy']);
      assert.ok(logs.some(l => /verify failure/.test(l)));
    });
    test('a legacy loop with NO current decision is clear, not held', async () => {
      await seedBlocked('nodec', { decision: false });
      await loopsOf();
      await stripKey('nodec');
      const c = await prep();
      assert.deepEqual(c.unverified, []);
      assert.deepEqual(c.rows.map(r => r.loopId), ['nodec']);
    });
    test('persist:false verifies without writing the digest back', async () => {
      await reversedRow('a');
      const before = JSON.stringify(await row('a'));
      const c = await prep({ extra: { persist: false } });
      assert.equal(JSON.stringify(await row('a')), before);
      assert.ok(c.settled.some(s => s.loopId === 'a'));
    });
    test('unverified covers a decision/content-loop-eligible unknown that is NOT row-eligible ([done]-stamped content loop)', async () => {
      await seedBlocked('a', { extra: [{ message: '[done] finished', timestamp: mins(100) }] });
      await loopsOf();
      await stripKey('a');
      const loops = await loopsOf();
      const c = closerCandidates({ loops, now: Date.now() });
      assert.deepEqual(c.rows, [], 'terminal row is not row-eligible');
      // the decision is still open (nothing answered it) and its content loop is unknown => held out and listed
      assert.deepEqual(c.unverified, ['a']);
      // resolved from raw it becomes an eligible loop decision on a [done] content loop
      const p = await prep({ loops });
      assert.deepEqual(p.unverified, []);
      assert.deepEqual(p.loopDecisions.map(d => d.loopId), ['a']);
    });
    test('LEGACY_VERIFY_CAP bounds the batch', () => {
      assert.equal(LEGACY_VERIFY_CAP, 200);
    });
  });

  describe('write results: refusal vs failure', () => {
    test('a {refused} withdrawal is counted and logged at info level, never as a failure; null is a failure', async () => {
      await seedBlocked('a');
      await seedBlocked('b');
      const spy = Object.create(store);
      spy.markDecisionWithdrawn = async (id) => (id === 'a' ? { refused: 'reversed' } : null);
      const r = await close({ dispatchStore: spy });
      assert.equal(r.refused, 1);
      assert.equal(r.failures, 1);
      assert.equal(logs.filter(l => /failure/.test(l)).length, 1);
      assert.equal(infos.filter(l => /refused \(reversed\)/.test(l)).length, 1);
      assert.ok(!logs.some(l => /refused/.test(l)));
    });
    test('a throw is a failure and does not stop the other writes', async () => {
      await seedBlocked('a');
      await seedBlocked('b');
      const spy = Object.create(store);
      spy.markDecisionWithdrawn = async (id) => { if (id === 'a') throw new Error('boom'); return store.markDecisionWithdrawn(id, URL_KEY, 'dec-b', 'ticket-closed: x'); };
      const r = await close({ dispatchStore: spy });
      assert.equal(r.failures, 1);
      assert.equal(r.withdrawn, 1);
    });
    test('a closeIssueRows failure is logged and the withdrawals still run', async () => {
      await seedBlocked('a');
      const spy = Object.create(store);
      spy.closeIssueRows = async () => ({ ok: false, closedIds: [] });
      const r = await close({ dispatchStore: spy });
      assert.equal(r.failures, 1);
      assert.equal(r.withdrawn, 1);
    });
    test('a null feed cache is a no-op', async () => {
      await seedBlocked('a');
      const r = await close({ sessionsFeedCache: null });
      assert.equal(r.failures, 0);
    });
  });

  describe('scan decisions', () => {
    const scanDoc = (id, o = {}) => ({
      _id: id, urlKey: URL_KEY, issueId: ISSUE_UUID, issueIdentifier: 'LIN-1', inputHash: 'h', basisHash: null,
      decision: { decision_id: `d-${id}`, question: 'q', options: [] }, scannedAt: new Date(Date.now() - 3600000), outcome: null, ...o
    });
    const withScans = async () => ({ taskDecisions: await tdStore.listUnansweredForWorkspaces([URL_KEY]), newestScanByTask: await tdStore.listNewestScanPerTask([URL_KEY]) });
    const ticket = { issueId: ISSUE_UUID, identifier: 'LIN-1', stateType: 'completed' };

    test('stamped self-resolved with the exact basis hash and ticketClosedAt; a non-null record is asserted', async () => {
      await tdCollection.insertOne(scanDoc('s1'));
      const c = await prep(await withScans());
      const r = await close({ ticket, candidates: c });
      assert.equal(r.resolved, 1);
      const rec = await tdCollection.findOne({ _id: 's1' });
      assert.equal(rec.outcome, 'self-resolved');
      assert.equal(rec.outcomeBasisHash, ticketClosedBasisHash(ISSUE_UUID, 'completed'));
      assert.ok(rec.ticketClosedAt);
      assert.match(rec.outcomeReason, /^Ticket LIN-1 reached completed on \d{4}-\d{2}-\d{2}$/);
    });
    test('a scan row with a mismatched issueId is not selected, markOutcome is not called, and it is counted', async () => {
      await tdCollection.insertOne(scanDoc('s1', { issueId: OTHER_UUID }));
      let called = 0;
      const spy = Object.create(tdStore);
      spy.markOutcome = async () => { called += 1; return null; };
      const c = await prep(await withScans());
      const r = await close({ ticket, candidates: c, taskDecisionsStore: spy });
      assert.equal(called, 0);
      assert.equal(r.skipped.issueIdMismatch, 1);
      assert.equal(r.failures, 0);
    });
    test('a scan row un-retired by reverseOutcome keeps ticketClosedAt, is settled, and is not re-resolved', async () => {
      await tdCollection.insertOne(scanDoc('s1'));
      await close({ ticket, candidates: await prep(await withScans()) });
      await tdStore.reverseOutcome({ urlKey: URL_KEY, issueId: ISSUE_UUID, id: 's1' });
      const reopened = await tdCollection.findOne({ _id: 's1' });
      assert.equal(reopened.outcome, null);
      assert.ok(reopened.ticketClosedAt, 'ticketClosedAt survives reverseOutcome');
      const c = await prep(await withScans());
      assert.ok(c.settled.some(s => s.type === 'scanDecision' && s.id === 's1'));
      assert.deepEqual(c.scanDecisions, []);
      const r = await close({ ticket, candidates: c });
      assert.equal(r.resolved, 0);
      assert.equal(r.failures, 0);
    });
    test('a zero-finding scan row is left alone', async () => {
      await tdCollection.insertOne(scanDoc('s1', { decision: null }));
      const c = await prep(await withScans());
      assert.deepEqual(c.scanDecisions, []);
    });
    test('a null from markOutcome is a failure', async () => {
      await tdCollection.insertOne(scanDoc('s1'));
      const spy = Object.create(tdStore);
      spy.markOutcome = async () => null;
      const r = await close({ ticket, candidates: await prep(await withScans()), taskDecisionsStore: spy });
      assert.equal(r.failures, 1);
    });
  });

  describe('ticketFromWrite', () => {
    const issue = { id: 'iid', identifier: 'LIN-9', state: { type: 'completed' } };
    test('accepts the issue or the {success, issue} payload without a read-back', async () => {
      let reads = 0;
      const readBack = async () => { reads += 1; return issue; };
      assert.deepEqual(await ticketFromWrite(issue, { readBack }), { issueId: 'iid', identifier: 'LIN-9', stateType: 'completed' });
      assert.deepEqual(await ticketFromWrite({ success: true, issue }, { readBack }), { issueId: 'iid', identifier: 'LIN-9', stateType: 'completed' });
      assert.equal(reads, 0);
    });
    test('a non-terminal written type returns early with no read-back', async () => {
      let reads = 0;
      const t = await ticketFromWrite({ ...issue, state: { type: 'started' } }, { readBack: async () => { reads += 1; return issue; } });
      assert.equal(t.stateType, 'started');
      assert.equal(reads, 0);
    });
    test('a payload with no state falls back to exactly one read-back (plain issue or {issue})', async () => {
      let reads = 0;
      const readBack = async () => { reads += 1; return { issue }; };
      assert.equal((await ticketFromWrite(null, { readBack })).stateType, 'completed');
      assert.equal((await ticketFromWrite({ success: true }, { readBack })).stateType, 'completed');
      assert.equal(reads, 2);
    });
    test('never infers a type from the request; unresolved => null; a throwing read-back => null', async () => {
      assert.equal(await ticketFromWrite({ id: 'x', identifier: 'LIN-1', stateId: 'Done' }), null);
      assert.equal(await ticketFromWrite(null, { readBack: async () => { throw new Error('x'); } }), null);
    });
  });

  describe('createOnTicketWrite', () => {
    test('closes only for a terminal ticket; a rejecting closer is the caller`s to catch', async () => {
      const calls = [];
      const on = createOnTicketWrite({ dispatchStore: store, closeRows: async (a) => { calls.push(a.ticket); return {}; } });
      assert.equal(await on({ urlKey: URL_KEY, written: { id: 'i', identifier: 'LIN-1', state: { type: 'started' } } }), null);
      await on({ urlKey: URL_KEY, written: { success: true, issue: { id: 'i', identifier: 'LIN-1', state: { type: 'duplicate' } } } });
      assert.deepEqual(calls, [{ issueId: 'i', identifier: 'LIN-1', stateType: 'duplicate' }]);
      const bad = createOnTicketWrite({ dispatchStore: store, closeRows: async () => { throw new Error('boom'); } });
      await assert.rejects(bad({ urlKey: URL_KEY, written: { id: 'i', identifier: 'LIN-1', state: { type: 'completed' } } }), /boom/);
    });
  });
});

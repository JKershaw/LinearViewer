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
import { getLoopsForWorkspace } from '../../lib/pipeline-loops.js';
import { TICKET_CLOSED_GRACE_MS } from '../../lib/lineage-closure.js';
import { RecordsStore, RECORDS_COLLECTION, REFS_COLLECTION, QUERY_LOG_COLLECTION } from '../../lib/records-store.js';
import { createRecordWrites } from '../../lib/records/writes.js';
import { isTerminalState } from '../../lib/providers/state-map.js';
import { questionFacts } from '../../lib/records/question-facts.js';
import { questionStandingOf } from '../../lib/records/question-standing.js';
import {
  reversalState, closerCandidates, prepareCloserCandidates, selectTicketCloseWork,
  closeTicketRows, ticketFromWrite, createOnTicketWrite, LEGACY_VERIFY_CAP
} from '../../lib/ticket-close-closer.js';

const URL_KEY = 'acme';
const ISSUE_UUID = '11111111-2222-3333-4444-555555555555';
const OTHER_UUID = '99999999-2222-3333-4444-555555555555';
const mins = (m) => new Date(Date.now() - m * 60000);
const done = { issueId: 'iid-1', identifier: 'LIN-1', stateType: 'completed' };
const ACCOUNT = 'acct-owner';
const PEOPLE = [{ accountId: ACCOUNT, name: 'Owner' }];

describe('ticket-close-closer (LIN-3366)', () => {
  let dbDir, client, store, history, agentStatusStore, records, writes, counter = 0, logs;
  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'ticket-closer-'));
    client = new MangoClient(dbDir);
    await client.connect();
  });
  after(async () => {
    if (client?.close) await client.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });
  beforeEach(async () => {
    const db = client.db(`tc_${counter++}`);
    history = db.collection('dispatch-history');
    store = new DispatchQueueStore({ collection: db.collection('dispatch-queue'), historyCollection: history });
    store._notifyWriteForDoc = () => {};
    agentStatusStore = new AgentStatusStore({ collection: db.collection('status') });
    await db.collection(RECORDS_COLLECTION).createIndex({ urlKey: 1, id: 1, v: 1 }, { unique: true });
    records = new RecordsStore({ records: db.collection(RECORDS_COLLECTION), refs: db.collection(REFS_COLLECTION), queryLog: db.collection(QUERY_LOG_COLLECTION) });
    writes = createRecordWrites({ recordsStore: records, isTerminalState, readTicket: null, askedText: () => '', stageKinds: ['implementation'], listPeople: async () => PEOPLE });
    logs = [];
  });

  /** An open question on a ticket's task, asked by no run (as a stage's question is filed). */
  async function askOn(task, asks = 'Which way?', run = null) {
    const made = await records.ensureTask(URL_KEY, { identifier: task, title: task }, { by: 'implementation' });
    assert.ok(made.id, `task refused: ${JSON.stringify(made)}`);
    const snap = await writes.add({
      urlKey: URL_KEY, kind: 'question', by: 'implementation', run,
      input: { asks, options: ['left', 'right'], recommended: 'left', 'if-unanswered': 'pick left', to: `person:${ACCOUNT}`, in: task },
    });
    assert.ok(snap.record, `question refused: ${JSON.stringify(snap.problems)}`);
    return snap.record.id;
  }

  const log = (m) => logs.push(m);

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
    return prepareCloserCandidates({ loops, questionStanding: o.questionStanding || new Map(), now: Date.now(), dispatchStore: store, log, ...o.extra });
  };
  const close = (o = {}) => closeTicketRows({
    urlKey: URL_KEY, ticket: done, dispatchStore: store, recordsStore: records, agentStatusStore, log, ...o
  });
  const row = (id) => history.findOne({ _id: id });
  const reverse = (id, decisionId) => store.markDecisionWithdrawalReversed(id, URL_KEY, decisionId);

  describe('reversalState (three states)', () => {
    const cells = [
      ['no digest => loop has no decision', { decision: null, withdrawalReversed: false }, 'clear'],
      ['key true', { decision: { decision_id: 'd' }, withdrawalReversed: true }, 'reversed'],
      ['key false', { decision: { decision_id: 'd' }, withdrawalReversed: false }, 'clear'],
      ['key absent + decision', { decision: { decision_id: 'd' }, withdrawalReversed: undefined }, 'unknown'],
      ['key absent + no decision', { decision: null, withdrawalReversed: undefined }, 'clear'],
      ['key true + no decision', { decision: null, withdrawalReversed: true }, 'clear']
    ];
    for (const [name, loop, want] of cells) test(name, () => assert.equal(reversalState(loop), want));
  });

  describe('the digest fact feeds the loop (lean read)', () => {
    test('a freshly digested row reads false', async () => {
      await seedBlocked('a');
      assert.equal((await loopsOf()).find(l => l.loopId === 'a').withdrawalReversed, false);
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

  describe('questions decide a blocked row\'s lane (LIN-4538)', () => {
    test('a blocked row whose run asked a question that was answered is resolved: not a candidate, not closed', async () => {
      await seedBlocked('a');
      const q = await askOn('LIN-1', 'Which way?', 'a');
      await records.end(URL_KEY, q, { state: 'answered', reason: 'answered by dec-x' }, { by: `person:${ACCOUNT}` });
      const standing = await questionStandingOf(records, URL_KEY);
      const c = await prep({ questionStanding: standing });
      assert.deepEqual(c.rows, []);
      const r = await close({ candidates: c });
      assert.equal(r.closedRows, 0);
      assert.equal((await row('a')).bookkeeping, null);
    });
    test('a blocked row whose run has an OPEN question stays blocked: it is a candidate, and the question ends with its ticket', async () => {
      await seedBlocked('a');
      const q = await askOn('LIN-1', 'Which way?', 'a');
      const standing = await questionStandingOf(records, URL_KEY);
      const c = await prep({ questionStanding: standing });
      assert.deepEqual(c.rows.map(x => x.loopId), ['a']);
      const r = await close({ candidates: c });
      assert.equal(r.closedRows, 1);
      assert.equal(r.withdrawn, 1);
      const facts = (await questionFacts(records, URL_KEY)).find(f => f.questionId === q);
      assert.equal(facts.outcome, 'self-resolved');
    });
  });

  describe('closeTicketRows', () => {
    test('a Done ticket: rows closed, the open question on it ends "ticket closed" by Harbour, cache cleared once', async () => {
      await seedBlocked('a');
      await seedBlocked('b', { identifier: 'LIN-1' });
      const q = await askOn('LIN-1');
      let cleared = 0;
      const r = await close({ sessionsFeedCache: { clear: (k) => { assert.equal(k, URL_KEY); cleared += 1; } } });
      assert.equal(r.closedRows, 2);
      assert.equal(r.withdrawn, 1, 'one question ended');
      assert.equal(r.failures, 0);
      assert.equal(cleared, 1);
      const a = await row('a');
      assert.equal(a.bookkeeping.reason, 'ticket-closed');
      assert.equal(a.bookkeeping.by, 'ticket-closer');
      assert.ok(!a.feedback.some(f => f.kind === 'decision-withdrawn'), 'no decision is withdrawn on the old path');
      const facts = (await questionFacts(records, URL_KEY)).find(f => f.questionId === q);
      assert.equal(facts.state, 'withdrawn');
      assert.equal(facts.reason, 'ticket closed');
      assert.equal(facts.endedBy, 'harbour');
      assert.equal(facts.outcome, 'self-resolved');
    });
    test('ORDER WITNESS: the row is closed even though the question end follows (close first, then end)', async () => {
      await seedBlocked('a');
      await askOn('LIN-1');
      const order = [];
      const spy = Object.create(store);
      spy.closeIssueRows = async (...a) => { order.push('close'); return store.closeIssueRows(...a); };
      // A forwarding proxy, not Object.create: RecordsStore keeps private fields, which a prototype-derived spy cannot read.
      // Every method reaches the real store bound to it; only `end` (the store write the checked writes.end makes) is observed.
      const spyRecords = new Proxy(records, {
        get(target, prop) {
          if (prop === 'end') return async (...a) => { order.push('end'); return target.end(...a); };
          const v = target[prop];
          return typeof v === 'function' ? v.bind(target) : v;
        },
      });
      const candidates = await prep(); // read with the real store; the spy only observes the writes
      const r = await close({ dispatchStore: spy, recordsStore: spyRecords, candidates });
      assert.deepEqual(order, ['close', 'end']);
      assert.equal(r.closedRows, 1);
      assert.equal(r.withdrawn, 1);
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
      assert.equal((await close()).closedRows, 0);
    });
  });

  describe('reversal is terminal (Finding 1)', () => {
    test('a reversed withdrawal is not selected, its carrier row stays open, and two runs log zero failures', async () => {
      await seedBlocked('a', { decisionId: 'dec-a' });
      await seedBlocked('b');
      await store.markDecisionWithdrawn('a', URL_KEY, 'dec-a', 'ticket-closed: LIN-1 reached completed');
      await close(); // closes both rows
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
      assert.equal(r.withdrawn, 0, 'no question on it');
      assert.equal((await row('a')).feedbackDigest.withdrawalReversed, false);
    });
    test('a raw re-read that throws closes nothing for the unknown loops and logs verify failure; other loops still close', async () => {
      await seedBlocked('legacy');
      await seedBlocked('modern', { identifier: 'LIN-1' });
      await loopsOf();
      await stripKey('legacy');
      const loops = await loopsOf();
      const r = await closeTicketRows({
        urlKey: URL_KEY, ticket: done, dispatchStore: store, log,
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
    test('LEGACY_VERIFY_CAP bounds the batch', () => {
      assert.equal(LEGACY_VERIFY_CAP, 200);
    });
  });

  describe('write results', () => {
    test('a null feed cache is a no-op', async () => {
      await seedBlocked('a');
      const r = await close({ sessionsFeedCache: null });
      assert.equal(r.failures, 0);
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

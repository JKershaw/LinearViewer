/**
 * LIN-3365 (LIN-3358 B): the lineage closers inside `addFeedback`. Real MangoDB
 * tmpdir (the closer filters use engine `null` / `$not`-`$elemMatch` semantics
 * the mock collection cannot evaluate faithfully), like
 * dispatch-store-close-rows.test.js.
 *
 * Seeded rows use dates in the past; the event under test is a live
 * `addFeedback` (timestamp = now), so "dispatched/taken before the event" holds
 * for every seed unless a test sets a future date.
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MangoClient } from '@jkershaw/mangodb';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { isLineageClosingTerminal } from '../../lib/dispatch-terminal.js';

const URL_KEY = 'acme';
const TOKEN = 'tok';
const T = (m) => new Date(`2026-08-01T00:${String(m).padStart(2, '0')}:00.000Z`);
const FUTURE = new Date(Date.now() + 3600 * 1000);

describe('addFeedback lineage closers (real MangoDB tmpdir, LIN-3365)', () => {
  let dbDir, client, store, history, counter = 0;

  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'dispatch-store-closers-'));
    client = new MangoClient(dbDir);
    await client.connect();
  });
  after(async () => {
    if (client?.close) await client.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });
  beforeEach(() => {
    const db = client.db(`closers_${counter++}`);
    history = db.collection('dispatch-history');
    store = new DispatchQueueStore({ collection: db.collection('dispatch-queue'), historyCollection: history });
    store._notifyWriteForDoc = () => {};
  });

  async function seed(id, o = {}) {
    await history.insertOne({
      _id: id, urlKey: URL_KEY, issueIdentifier: 'LIN-1', rootItemId: 'root-1', kind: 'wake',
      dispatchedAt: T(1), resolvedAt: T(2), status: 'taken', feedback: [], bookkeeping: null,
      takenByTokenLabel: TOKEN, takenByTokenId: null, ...o
    });
  }
  const stamp = async (id) => (await history.findOne({ _id: id })).bookkeeping ?? null;
  const post = (id, message, rootItemId = 'root-1') => store.addFeedback(id, URL_KEY, { message, rootItemId }, TOKEN);

  describe('isLineageClosingTerminal', () => {
    test('done|complete|failed|aborted only', () => {
      for (const m of ['[done] x', '[complete] x', '[failed] x', '[aborted] x', '  [DONE] x']) assert.equal(isLineageClosingTerminal(m), true, m);
      for (const m of ['[skipped] human-continued', '[blocked] x', '[pending] x', 'done', '[working] x', '', null]) assert.equal(isLineageClosingTerminal(m), false, String(m));
    });
  });

  describe('(b) lineage-terminal', () => {
    test('closes earlier taken rows, leaves later-dispatched, later-taken and other-lineage rows open', async () => {
      await seed('poster', { kind: 'implementation', feedback: [{ message: 'hb', timestamp: T(3), rootItemId: 'root-1' }] });
      await seed('earlier-wake');
      await seed('earlier-beat', { kind: 'implementation' });
      await seed('after-dispatch', { dispatchedAt: FUTURE, resolvedAt: FUTURE });
      await seed('taken-after', { resolvedAt: FUTURE });
      await seed('sibling', { rootItemId: 'root-2' });

      await post('poster', '[done] shipped');

      assert.equal((await stamp('earlier-wake')).reason, 'lineage-terminal');
      assert.equal((await stamp('earlier-wake')).by, 'addFeedback');
      assert.equal((await stamp('earlier-beat')).reason, 'lineage-terminal', 'non-wake rows close via (b)');
      for (const id of ['poster', 'after-dispatch', 'taken-after', 'sibling']) assert.equal(await stamp(id), null, `${id} left open`);
    });

    test('[blocked], [pending] and [skipped] do not trigger (b)', async () => {
      await seed('poster', { kind: 'implementation', feedback: [{ message: 'hb', timestamp: T(3), rootItemId: 'root-1' }] });
      await seed('other');
      for (const m of ['[blocked] need input', '[pending] paused', '[skipped] human-continued session s (phase)']) await post('poster', m);
      assert.equal(await stamp('other'), null);
    });

    test('a terminal with no rootItemId on the doc closes nothing', async () => {
      await seed('poster', { kind: 'implementation', rootItemId: undefined });
      await seed('other');
      await store.addFeedback('poster', URL_KEY, { message: '[done] x' }, TOKEN);
      assert.equal(await stamp('other'), null);
    });
  });

  describe('(a) handed-on', () => {
    test('closes only earlier kind:wake rows of the same rootItemId, and fires on the first tagged post only', async () => {
      await seed('old-wake', { dispatchedAt: T(1) });
      await seed('newer-wake', { dispatchedAt: T(10), resolvedAt: T(11) });
      await seed('other-lineage-wake', { rootItemId: 'root-2' });
      await seed('same-session-sibling', { rootItemId: 'root-3', sessionId: 'S' });

      await post('newer-wake', 'first tagged heartbeat');
      assert.equal((await stamp('old-wake')).reason, 'handed-on');
      assert.equal(await stamp('newer-wake'), null, 'the poster itself stays open');
      assert.equal(await stamp('other-lineage-wake'), null);
      assert.equal(await stamp('same-session-sibling'), null, 'keyed on rootItemId, never sessionId');

      // Second tagged post: no closer call at all.
      let calls = 0;
      const real = store.closeLineageRows.bind(store);
      store.closeLineageRows = (...a) => { calls++; return real(...a); };
      await post('newer-wake', 'second tagged heartbeat');
      assert.equal(calls, 0);
    });

    test('a non-wake follow-up (beat, human reply) is never closed by (a)', async () => {
      await seed('old-beat', { kind: 'implementation', dispatchedAt: T(1) });
      await seed('old-reply', { kind: 'follow-up', followUpTo: 'x', dispatchedAt: T(1) });
      await seed('newer-wake', { dispatchedAt: T(10), resolvedAt: T(11) });
      await post('newer-wake', 'first tagged heartbeat');
      assert.equal(await stamp('old-beat'), null);
      assert.equal(await stamp('old-reply'), null);
    });

    test('a wake dispatched earlier but TAKEN after the post stays open (queued-busy resume)', async () => {
      await seed('queued-busy-wake', { dispatchedAt: T(1), resolvedAt: FUTURE });
      await seed('newer-wake', { dispatchedAt: T(10), resolvedAt: T(11) });
      await post('newer-wake', 'first tagged heartbeat');
      assert.equal(await stamp('queued-busy-wake'), null);
    });
  });

  describe('isolation and ordering', () => {
    test('stamps append no feedback and leave feedbackVersion untouched', async () => {
      await seed('victim');
      await seed('poster', { kind: 'implementation', feedbackVersion: 5 });
      await post('poster', '[done] x');
      const v = await history.findOne({ _id: 'victim' });
      assert.equal((v.bookkeeping || {}).reason, 'lineage-terminal');
      assert.deepEqual(v.feedback, []);
      assert.equal(v.feedbackVersion ?? null, null);
    });

    test('a closer that throws or returns {ok:false} does not fail the feedback write', async () => {
      await seed('poster', { kind: 'implementation' });
      store.closeLineageRows = async () => { throw new Error('boom'); };
      const origErr = console.error; console.error = () => {};
      try {
        const r = await post('poster', '[done] x');
        assert.equal(r.success, true);
        store.closeLineageRows = async () => ({ ok: false, closedIds: [] });
        const r2 = await post('poster', '[done] again');
        assert.equal(r2.success, true);
      } finally { console.error = origErr; }
      assert.equal((await history.findOne({ _id: 'poster' })).feedback.length, 2);
    });

    async function wakeScenario(closersOn) {
      const db = client.db(`closers_${counter++}`);
      const s = new DispatchQueueStore({ collection: db.collection('dispatch-queue'), historyCollection: db.collection('dispatch-history') });
      s._notifyWriteForDoc = () => {};
      const order = [];
      const realAdd = s.addItem.bind(s);
      s.addItem = async (...a) => { order.push('addItem'); return realAdd(...a); };
      const realClose = s.closeLineageRows.bind(s);
      s.closeLineageRows = async (...a) => { order.push('close'); return closersOn ? realClose(...a) : { ok: true, closedIds: [] }; };
      const child = await s.addItem(URL_KEY, { prompt: 'p', kind: 'implementation', issueIdentifier: 'LIN-42', sessionId: 'parent-S1', subscription: 'everything' });
      order.length = 0;
      await s.takeItem(child._id, URL_KEY, TOKEN);
      const result = await s.addFeedback(child._id, URL_KEY, { message: '[done] shipped', rootItemId: child._id }, TOKEN);
      const wakes = await s.collection.find({ urlKey: URL_KEY, kind: 'wake' }).toArray();
      // ids and timestamps differ per run; everything else must be identical
      const strip = (w) => JSON.parse(JSON.stringify(w, (k, v) => (/(^_id$|At$|^id$|Id$|^prompt$|Token)/.test(k) ? undefined : v)));
      return { order, result, wakes: wakes.map(strip), childDone: (await s.historyCollection.findOne({ _id: child._id })).completedAt != null };
    }

    test('wake delivery is identical with the closers on or off, and the closer runs after the wake enqueue', async () => {
      const on = await wakeScenario(true);
      const off = await wakeScenario(false);
      assert.equal(on.wakes.length, 1);
      assert.deepEqual(on.result, off.result);
      assert.deepEqual(on.wakes, off.wakes);
      assert.equal(on.childDone, off.childDone);
      assert.ok(on.order.indexOf('close') > on.order.lastIndexOf('addItem'), `closer after enqueue: ${on.order}`);
    });

    test('a terminal on a kind:wake row still wakes a distinct ancestor', async () => {
      const db = client.db(`closers_${counter++}`);
      const s = new DispatchQueueStore({ collection: db.collection('dispatch-queue'), historyCollection: db.collection('dispatch-history') });
      s._notifyWriteForDoc = () => {};
      const child = await s.addItem(URL_KEY, { prompt: 'p', kind: 'implementation', issueIdentifier: 'LIN-42', sessionId: 'parent-S1', subscription: 'everything' });
      await s.takeItem(child._id, URL_KEY, TOKEN);
      await s.addFeedback(child._id, URL_KEY, { message: '[done] x', rootItemId: child._id }, TOKEN);
      const wakes = await s.collection.find({ urlKey: URL_KEY, kind: 'wake' }).toArray();
      assert.equal(wakes.length, 1);
    });
  });
});

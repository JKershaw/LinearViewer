/**
 * LIN-3364: `closeLineageRows` / `closeIssueRows` — bulk, select-then-guarded-
 * write forms of `stampBookkeeping`. Real MangoDB tmpdir (not the mock): the
 * filters use engine `null` semantics and the first `$not`/`$elemMatch`-on-regex
 * over `feedback`, which the mock collection cannot evaluate faithfully.
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MangoClient } from '@jkershaw/mangodb';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';

const URL_KEY = 'acme';
const T = (m) => new Date(`2026-08-01T00:${String(m).padStart(2, '0')}:00.000Z`);

describe('bulk close (real MangoDB tmpdir, LIN-3364)', () => {
  let dbDir, client, store, history, notified;
  let counter = 0;

  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'dispatch-store-close-rows-'));
    client = new MangoClient(dbDir);
    await client.connect();
  });
  after(async () => {
    if (client?.close) await client.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });
  beforeEach(() => {
    const db = client.db(`close_${counter++}`);
    history = db.collection('dispatch-history');
    store = new DispatchQueueStore({ collection: db.collection('dispatch-queue'), historyCollection: history });
    notified = [];
    store._notifyWriteForDoc = (doc) => { notified.push(doc._id); };
  });

  async function seed(id, o = {}) {
    await history.insertOne({
      _id: id, urlKey: URL_KEY, issueIdentifier: 'LIN-1', rootItemId: 'root-1', kind: 'wake',
      dispatchedAt: T(1), status: 'taken', feedback: [], bookkeeping: null, ...o
    });
  }
  const stamped = async (id) => (await history.findOne({ _id: id })).bookkeeping;

  describe('closeLineageRows', () => {
    test('closes only taken, unstamped, non-terminal rows of the lineage dispatched before the bound', async () => {
      await seed('a');
      await seed('b', { feedback: [{ message: '[pending] waiting', timestamp: T(2) }] });
      await seed('terminal', { feedback: [{ message: '[done] ok', timestamp: T(2) }] });
      await seed('already', { bookkeeping: { at: T(9), by: 'x', reason: 'fossil-pass-lin2633' } });
      await seed('cancelled', { status: 'cancelled' });
      await seed('sibling', { rootItemId: 'root-2' });
      await seed('newer', { dispatchedAt: T(30) });
      await seed('norootid', { rootItemId: undefined });

      const r = await store.closeLineageRows(URL_KEY, 'root-1', { beforeDispatchedAt: T(20), reason: 'handed-on', by: 'acct' });
      assert.equal(r.ok, true);
      assert.deepEqual(r.closedIds.sort(), ['a', 'b']);
      assert.equal((await stamped('a')).reason, 'handed-on');
      assert.equal((await stamped('a')).by, 'acct');
      for (const id of ['terminal', 'cancelled', 'sibling', 'newer', 'norootid']) {
        assert.equal(await stamped(id) ?? null, null, `${id} untouched`);
      }
      assert.equal((await stamped('already')).by, 'x', 'existing stamp untouched');
      assert.deepEqual(notified.sort(), ['a', 'b'], 'each closed row notified once');
    });

    test('exceptId and kinds narrow the set; wrong urlKey never matches', async () => {
      await seed('keep');
      await seed('go');
      await seed('other-kind', { kind: 'implementation' });
      const r = await store.closeLineageRows(URL_KEY, 'root-1', { beforeDispatchedAt: T(20), exceptId: 'keep', kinds: ['wake'], reason: 'lineage-terminal' });
      assert.deepEqual(r.closedIds, ['go']);
      assert.equal(await stamped('keep') ?? null, null);
      assert.equal(await stamped('other-kind') ?? null, null);
      const wrong = await store.closeLineageRows('other', 'root-1', { beforeDispatchedAt: T(20), reason: 'x' });
      assert.deepEqual(wrong.closedIds, []);
    });

    test('idempotent: a second call closes nothing and keeps the first stamp', async () => {
      await seed('a');
      const first = await store.closeLineageRows(URL_KEY, 'root-1', { beforeDispatchedAt: T(20), reason: 'handed-on' });
      const at = (await stamped('a')).at.getTime();
      const second = await store.closeLineageRows(URL_KEY, 'root-1', { beforeDispatchedAt: T(20), reason: 'ticket-closed' });
      assert.deepEqual(first.closedIds, ['a']);
      assert.deepEqual(second.closedIds, []);
      assert.equal((await stamped('a')).at.getTime(), at);
      assert.equal((await stamped('a')).reason, 'handed-on');
    });

    test('missing arguments are refused without throwing', async () => {
      assert.deepEqual(await store.closeLineageRows(URL_KEY, null, { beforeDispatchedAt: T(1) }), { ok: false, closedIds: [] });
      assert.deepEqual(await store.closeLineageRows(URL_KEY, 'root-1', {}), { ok: false, closedIds: [] });
    });
  });

  describe('closeIssueRows', () => {
    test('closes only the given ids that are quiet', async () => {
      await seed('q1', { feedback: [{ message: '[pending] x', timestamp: T(2) }] });
      await seed('q2');
      await seed('not-given');
      const r = await store.closeIssueRows(URL_KEY, 'LIN-1', { ids: ['q1', 'q2'], quietSince: T(10), reason: 'ticket-closed' });
      assert.deepEqual(r.closedIds.sort(), ['q1', 'q2']);
      assert.equal(await stamped('not-given') ?? null, null);
      assert.deepEqual(notified.sort(), ['q1', 'q2']);
    });

    test('a row that gained feedback after quietSince (resumed) is NOT closed', async () => {
      await seed('resumed', { feedback: [{ message: '[working] Session resumed.', timestamp: T(15) }] });
      await seed('quiet');
      const r = await store.closeIssueRows(URL_KEY, 'LIN-1', { ids: ['resumed', 'quiet'], quietSince: T(10), reason: 'ticket-closed' });
      assert.deepEqual(r.closedIds, ['quiet']);
      assert.equal(await stamped('resumed') ?? null, null);
    });

    test('a row with its own terminal marker is skipped; wrong issue is not reached', async () => {
      await seed('done', { feedback: [{ message: '[done] ok', timestamp: T(2) }] });
      await seed('other-issue', { issueIdentifier: 'LIN-2' });
      const r = await store.closeIssueRows(URL_KEY, 'LIN-1', { ids: ['done', 'other-issue'], quietSince: T(10), reason: 'ticket-closed' });
      assert.deepEqual(r.closedIds, []);
    });

    test('empty ids / missing quietSince are refused', async () => {
      assert.equal((await store.closeIssueRows(URL_KEY, 'LIN-1', { ids: [], quietSince: T(1), reason: 'r' })).ok, false);
      assert.equal((await store.closeIssueRows(URL_KEY, 'LIN-1', { ids: ['a'], reason: 'r' })).ok, false);
    });
  });
});

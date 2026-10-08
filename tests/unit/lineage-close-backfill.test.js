/**
 * LIN-3365: the lineage-close backfill. Real MangoDB tmpdir. Dry run writes
 * nothing; execute equals the dry run's set; a second run is a no-op; the 30-day
 * horizon excludes (and counts) older rows; a workspace read failure stamps
 * nothing for it.
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MangoClient } from '@jkershaw/mangodb';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { runLineageBackfill } from '../../scripts/lineage-close-backfill-lin3365.js';

const NOW = Date.UTC(2026, 9, 1);
const ago = (days, min = 0) => new Date(NOW - days * 86400000 + min * 60000);

describe('lineage-close backfill (LIN-3365)', () => {
  let dbDir, client, store, history, counter = 0;
  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'lineage-backfill-'));
    client = new MangoClient(dbDir);
    await client.connect();
  });
  after(async () => {
    if (client?.close) await client.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });
  beforeEach(() => {
    const db = client.db(`bf_${counter++}`);
    history = db.collection('dispatch-history');
    store = new DispatchQueueStore({ collection: db.collection('dispatch-queue'), historyCollection: history });
    store._notifyWriteForDoc = () => {};
  });

  const seed = (id, o = {}) => history.insertOne({
    _id: id, urlKey: 'acme', issueIdentifier: 'LIN-1', rootItemId: 'P', kind: 'implementation', status: 'taken',
    dispatchedAt: ago(2, 1), resolvedAt: ago(2, 2), followUpTo: 'P', feedback: [], bookkeeping: null, ...o
  });
  const stampOf = async (id) => (await history.findOne({ _id: id })).bookkeeping ?? null;

  async function fixture() {
    await seed('P', { followUpTo: null, dispatchedAt: ago(2), resolvedAt: ago(2), feedback: [{ message: '[done] ok', timestamp: ago(2, 30), rootItemId: 'P' }] });
    await seed('beat'); // in-flight beat of the ended lineage
    await seed('queued-busy', { resolvedAt: ago(2, 45) }); // taken after the terminal
    await seed('old', { dispatchedAt: ago(40), resolvedAt: ago(40) }); // outside the horizon, same lineage
    await seed('noroot', { rootItemId: undefined });
    await seed('open-lineage', { rootItemId: 'Z', followUpTo: null });
  }
  const run = (o = {}) => runLineageBackfill({ dispatchStore: store, urlKeys: ['acme'], now: NOW, ...o });

  test('dry run writes nothing and reports the set, the holds and the horizon count', async () => {
    await fixture();
    const r = await run();
    assert.equal(r.execute, false);
    assert.equal(await stampOf('beat'), null);
    assert.match(r.report, /DRY RUN/);
    assert.match(r.report, /Would stamp: 1\b/);
    assert.match(r.report, /taken-after-event\s+1\b/);
    assert.match(r.report, /older rows in touched lineages\s+1\b/);
    assert.match(r.report, /no-rootItemId\s+1\b/);
    assert.match(r.report, /HEAD:/);
  });

  test('execute stamps exactly the dry run set, leaves the held/old rows open, and a second run is a no-op', async () => {
    await fixture();
    const dry = await run();
    const wouldStamp = dry.perWorkspace[0].writable.map(c => c.id).sort();
    const ex = await run({ execute: true, by: 'tester' });
    assert.deepEqual(ex.stamped.filter(s => s.ok).map(s => s.id).sort(), wouldStamp);
    assert.deepEqual(wouldStamp, ['beat']);
    assert.equal((await stampOf('beat')).reason, 'lineage-terminal');
    assert.equal((await stampOf('beat')).by, 'tester');
    for (const id of ['queued-busy', 'old', 'noroot', 'open-lineage', 'P']) assert.equal(await stampOf(id), null, `${id} open`);
    assert.equal(ex.remaining, 0);
    assert.match(ex.report, /Idempotence check: 0 remaining/);
    const again = await run({ execute: true });
    assert.equal(again.stamped.length, 0);
    assert.equal((await stampOf('beat')).by, 'tester', 'first stamp kept');
  });

  test('a per-workspace read failure stamps nothing for that workspace', async () => {
    await fixture();
    const real = store.historyCollection.find.bind(store.historyCollection);
    store.historyCollection.find = () => { throw new Error('read boom'); };
    try {
      const r = await run({ execute: true });
      assert.equal(r.perWorkspace[0].readFailed, true);
      assert.match(r.report, /1 FAILED: acme/);
    } finally { store.historyCollection.find = real; }
    assert.equal(await stampOf('beat'), null);
  });
});

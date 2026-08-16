/**
 * Unit tests for LIN-2079 (S7, Option A minimum): `listHistory`'s store-side
 * `{ status, silentSince }` age-of-ACTIVITY predicate.
 *
 * The ticket is about `taken` rows that strand with no consumer left to post a
 * terminal marker. They were unobservable: the unscoped listing is blind past
 * its newest-N window, `status` was only ever a JS filter applied by the route,
 * and `listHistory`'s existing `since` is a LOWER bound on `dispatchedAt`
 * ("recent"), the opposite direction. This adds the minimum read-side capability
 * to SELECT them — no stored field, no index, no migration, no eviction.
 *
 * Why the predicate keys on `feedback[].timestamp` and not `resolvedAt`: the
 * plan's earlier revision used `resolvedAt`, which is CLAIM time. A healthy
 * lineage claimed three days ago whose last `[working]` beat landed a minute ago
 * looks identical to a genuine tombstone under that key. Case (d) below is that
 * row, and it is the case the rekey exists for.
 *
 * Run against a REAL MangoDB tmpdir instance, not the shared mock: the predicate
 * is `$nor` + a dotted path into an array of subdocuments + `Date` ordering, all
 * of which are ENGINE semantics. A mock reimplementing them would be asserting
 * against itself — the false-witness failure mode tests/fixtures/mock-collection.js
 * documents in its own header. Precedent: LIN-1343's concurrency pins and
 * LIN-1338's account-store tests do the same for the same reason. The collection
 * is wrapped so the same tests also pin PUSHDOWN (the clauses ride into the query
 * sent to the engine rather than being filtered in JS afterwards).
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MangoClient } from '@jkershaw/mangodb';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';

const URL_KEY = 'acme';
const CUTOFF = new Date('2026-08-14T00:00:00.000Z');
const OLD = new Date('2026-08-01T00:00:00.000Z');
const NEW = new Date('2026-08-15T00:00:00.000Z');

// Wrap a real collection so a test can assert what query reached `find()` /
// `countDocuments()` while the engine still answers it for real. A Proxy, not a
// spread: a MangoDB collection carries its methods on the prototype, so
// `{ ...collection }` yields an object with none of them.
function capturing(collection) {
  const queries = [];
  const proxy = new Proxy(collection, {
    get(target, prop, receiver) {
      if (prop === 'find' || prop === 'countDocuments') {
        return (query, options) => {
          queries.push(query);
          return target[prop](query, options);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
  return { collection: proxy, queries };
}

describe('listHistory { status, silentSince } (real MangoDB tmpdir, LIN-2079 S7)', () => {
  let dbDir;
  let client;
  let counter = 0;

  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'dispatch-store-silence-'));
    client = new MangoClient(dbDir);
    await client.connect();
  });

  after(async () => {
    if (client?.close) await client.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });

  // Every row's `resolvedAt` is OLD on purpose: under the rejected `resolvedAt`
  // key they would all match, so any test that still discriminates is
  // discriminating on activity, which is what the ruling asked for.
  async function seed() {
    const db = client.db(`silence_${counter++}`);
    const history = capturing(db.collection('dispatch-history'));
    const store = new DispatchQueueStore({
      collection: db.collection('dispatch-queue'),
      historyCollection: history.collection
    });
    const row = (id, status, feedback) => ({
      _id: id,
      urlKey: URL_KEY,
      prompt: 'p',
      dispatchedAt: OLD,
      resolvedAt: OLD,
      status,
      ...(feedback === undefined ? {} : { feedback })
    });
    await history.collection.insertOne(row('a-silent', 'taken', [{ message: '[working]', timestamp: OLD }]));
    await history.collection.insertOne(row('b-empty', 'taken', []));
    await history.collection.insertOne(row('c-absent', 'taken', undefined));
    await history.collection.insertOne(row('d-alive', 'taken', [
      { message: '[working]', timestamp: OLD },
      { message: '[working]', timestamp: NEW }
    ]));
    await history.collection.insertOne(row('e-cancelled', 'cancelled', []));
    history.queries.length = 0;
    return { store, queries: history.queries };
  }

  test('selects silent, empty-feedback and absent-feedback taken rows; excludes a live lineage and a non-taken row', async () => {
    const { store } = await seed();

    const { items, total } = await store.listHistory(URL_KEY, { status: 'taken', silentSince: CUTOFF });
    const ids = items.map(i => i.id).sort();

    assert.deepEqual(ids, ['a-silent', 'b-empty', 'c-absent'],
      'a silent row, an empty feedback array and an absent feedback field are all the ticket\'s class');
    assert.equal(total, 3);
  });

  test('a taken row with a beat NEWER than the cutoff is excluded even though its resolvedAt is old', async () => {
    const { store } = await seed();

    const { items } = await store.listHistory(URL_KEY, { status: 'taken', silentSince: CUTOFF });

    assert.ok(!items.some(i => i.id === 'd-alive'),
      'the whole point of keying on activity rather than claim time — a healthy lineage must not be selected');
  });

  test('the status and silence clauses ride INTO the query (pushdown), not a JS filter afterwards', async () => {
    const { store, queries } = await seed();

    await store.listHistory(URL_KEY, { status: 'taken', silentSince: CUTOFF });

    assert.ok(queries.length >= 1);
    const query = queries[0];
    assert.equal(query.urlKey, URL_KEY);
    assert.equal(query.status, 'taken');
    assert.deepEqual(query.$nor, [{ 'feedback.timestamp': { $gte: CUTOFF } }],
      'no entry at or after the cutoff — the "silence" half of the predicate');
  });

  test('the predicate coexists with the limit path (sort + skip + limit + countDocuments)', async () => {
    const { store } = await seed();

    const { items, total } = await store.listHistory(URL_KEY, {
      status: 'taken', silentSince: CUTOFF, limit: 2
    });

    assert.equal(items.length, 2, 'the bounded read is still bounded');
    assert.equal(total, 3, 'total stays the full matching count, not the page size');
  });

  test('omitting both options leaves them out of the query and returns every row (existing callers unchanged)', async () => {
    const { store, queries } = await seed();

    const { items, total } = await store.listHistory(URL_KEY);

    assert.equal(total, 5);
    assert.equal(items.length, 5);
    assert.ok(!('status' in queries[0]), 'an unscoped read must not carry a status predicate');
    assert.ok(!('$nor' in queries[0]), 'an unscoped read must not carry a silence predicate');
  });

  test('status alone selects by stored status with no silence bound', async () => {
    const { store } = await seed();

    const { items } = await store.listHistory(URL_KEY, { status: 'taken' });

    assert.deepEqual(items.map(i => i.id).sort(), ['a-silent', 'b-empty', 'c-absent', 'd-alive']);
  });

  test('silentSince alone spans every status', async () => {
    const { store } = await seed();

    const { items } = await store.listHistory(URL_KEY, { silentSince: CUTOFF });

    assert.deepEqual(items.map(i => i.id).sort(), ['a-silent', 'b-empty', 'c-absent', 'e-cancelled']);
  });
});

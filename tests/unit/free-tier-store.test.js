/**
 * LIN-689 / LIN-3239 — the global hourly cap in FreeTierStore.
 *
 * `tryUse` originally built the hourly key as `global:<hour>` and then prefixed
 * it again on write (`global:global:<hour>`), so the row it incremented was
 * never the row the guard read: `hourCount` stayed 0 and the global hourly cap
 * could not fire on the actual-request path. LIN-689 fixed the key; LIN-3239
 * made the increment atomic (the only prompt refusal left) and turned the
 * per-workspace daily doc into a best-effort count that never refuses.
 *
 * Case 1 fails on the unfixed key and passes once the key is built once through
 * a shared helper. Case 2 is the concurrency proof: exactly `hourlyLimit`
 * allowed and the stored hourly count lands on `hourlyLimit`, which a
 * check-then-increment mutant cannot satisfy. Case 3 is the daily counter's
 * never-refuse contract (the KPI chart reads those docs). Case 4 is fail-closed.
 *
 * The store is exercised on a REAL MangoDB tmpdir (not the inline collection
 * doubles), so `findOne`/`findOneAndUpdate` with upsert + `returnDocument`
 * behave as they do in dev and production.
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FreeTierStore, DEFAULT_RUN_LIMIT } from '../../lib/free-tier-store.js';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

describe('LIN-689 / LIN-3239 — FreeTierStore hourly cap', () => {
  const harness = createMangoTmpdir('lin-689-free-tier-');
  before(() => harness.connect());
  after(() => harness.close());

  let collection;
  beforeEach(() => {
    collection = harness.freshDb().collection('free-tier-usage');
  });

  test('case 1: hourlyLimit+1 calls across distinct urlKeys — the last is refused "Service busy"', async () => {
    const hourlyLimit = 3;
    const store = new FreeTierStore({ collection, hourlyLimit });

    for (let i = 0; i < hourlyLimit; i++) {
      const res = await store.tryUse(`ws-${i}`);
      assert.equal(res.allowed, true, `call ${i + 1} of ${hourlyLimit} should be allowed`);
    }

    const denied = await store.tryUse(`ws-${hourlyLimit}`);
    assert.equal(denied.allowed, false);
    assert.equal(denied.reason, 'Service busy, try again later');
    assert.equal(denied.remaining, 0);
    assert.equal(denied.limit, hourlyLimit);
  });

  test('case 2: concurrent tryUse across distinct urlKeys — exactly hourlyLimit allowed, stored count === hourlyLimit', async () => {
    const hourlyLimit = 5;
    const extra = 5;
    const store = new FreeTierStore({ collection, hourlyLimit });

    const results = await Promise.all(
      Array.from({ length: hourlyLimit + extra }, (_, i) => store.tryUse(`ws-${i}`))
    );

    const allowed = results.filter(r => r.allowed).length;
    assert.equal(allowed, hourlyLimit, `exactly ${hourlyLimit} of ${hourlyLimit + extra} concurrent calls may be allowed`);

    const hourDoc = await collection.findOne({ _id: store._getGlobalHourKey() });
    assert.equal(hourDoc.count, hourlyLimit, 'the hourly bucket must land exactly on hourlyLimit after rollbacks');
  });

  test('case 3: the daily counter keeps incrementing and never refuses (KPI pin)', async () => {
    // A tiny hourly cap that is never reached here: only the daily doc is under
    // test. Every call must be allowed however many times it runs.
    const store = new FreeTierStore({ collection, hourlyLimit: 1000 });

    for (let i = 0; i < 5; i++) {
      assert.equal((await store.tryUse('acme')).allowed, true, `daily call ${i + 1} must be allowed`);
    }

    const doc = await collection.findOne({ _id: `acme:${todayKey()}` });
    assert.equal(doc.count, 5, 'the daily counter keeps incrementing');
    // The fields the KPI chart reads (lib/kpi-stats.js:1235-1242).
    assert.equal(doc.urlKey, 'acme');
    assert.equal(doc.date, todayKey());
    assert.ok(doc.expiresAt instanceof Date, 'the daily doc carries an expiresAt for TTL cleanup');
  });

  test('case 4: a failing hourly increment resolves refused, never rejects', async () => {
    const store = new FreeTierStore({
      collection: { findOneAndUpdate: async () => { throw new Error('db down'); } },
      hourlyLimit: 5
    });

    const res = await store.tryUse('acme');
    assert.equal(res.allowed, false);
    assert.equal(res.reason, 'Unable to verify usage limits, try again later');
  });

  test('case 5: a failing daily write never turns an allowed prompt into a denial', async () => {
    const hourlyLimit = 5;
    let calls = 0;
    const collection = {
      async findOneAndUpdate(filter, update, options) {
        calls++;
        if (calls > 1) throw new Error('daily write down');
        return { _id: filter._id, count: 1 };
      }
    };
    const store = new FreeTierStore({ collection, hourlyLimit });

    const res = await store.tryUse('acme');
    assert.equal(res.allowed, true, 'the hourly charge succeeded, so the prompt proceeds');
    assert.equal(res.limit, hourlyLimit);
  });
});

/**
 * LIN-3238 — the run count seam. `getRunUsage`/`checkRun` are a thin, shared
 * wrapper over the injected dispatch store's `countFreshRunsSince`, scoped to
 * the caller's merge group and the UTC day. There is exactly one predicate and
 * one store method: the factory gate and the quota read both go through here.
 * Deliberately no `task-mode-events` read and no `taskModeStore` dependency.
 */
function fakeDispatchStore(count) {
  const calls = [];
  return {
    calls,
    async countFreshRunsSince(accountIds, since) {
      calls.push({ accountIds, since });
      return count;
    }
  };
}

describe('LIN-3238 — FreeTierStore run usage', () => {
  test('DEFAULT_RUN_LIMIT is 10 (placeholder) and runLimit overrides it', () => {
    assert.equal(DEFAULT_RUN_LIMIT, 10);
    assert.equal(new FreeTierStore({ collection: {} }).runLimit, 10);
    assert.equal(new FreeTierStore({ collection: {}, runLimit: 3 }).runLimit, 3);
  });

  test('getRunUsage reports the merge-group count over today\'s UTC day', async () => {
    const dispatchStore = fakeDispatchStore(3);
    const store = new FreeTierStore({ collection: {}, dispatchStore, runLimit: 10 });

    const usage = await store.getRunUsage(['a', 'b']);
    assert.equal(usage.runsUsed, 3);
    assert.equal(usage.limit, 10);
    assert.equal(usage.remaining, 7);
    assert.equal(typeof usage.resetsAt, 'string');
    assert.deepEqual(dispatchStore.calls[0].accountIds, ['a', 'b']);
    assert.equal(
      dispatchStore.calls[0].since.toISOString(),
      `${todayKey()}T00:00:00.000Z`,
      'the count window starts at UTC midnight'
    );
  });

  test('checkRun allows under the limit, refuses at it, and is unverified on a failed read', async () => {
    const under = new FreeTierStore({ collection: {}, dispatchStore: fakeDispatchStore(9), runLimit: 10 });
    const ok = await under.checkRun(['a']);
    assert.equal(ok.allowed, true);
    assert.equal(ok.runsUsed, 9);
    assert.equal(ok.remaining, 1);

    const at = new FreeTierStore({ collection: {}, dispatchStore: fakeDispatchStore(10), runLimit: 10 });
    const denied = await at.checkRun(['a']);
    assert.equal(denied.allowed, false);
    assert.equal(denied.reason, 'limit');
    assert.equal(denied.runsUsed, 10);
    assert.equal(denied.remaining, 0);

    const unreadable = new FreeTierStore({ collection: {}, dispatchStore: fakeDispatchStore(null), runLimit: 10 });
    const unverified = await unreadable.checkRun(['a']);
    assert.equal(unverified.allowed, false);
    assert.equal(unverified.reason, 'unverified');
    assert.equal(unverified.runsUsed, null);

    const throwing = new FreeTierStore({
      collection: {},
      dispatchStore: { countFreshRunsSince: async () => { throw new Error('db down'); } },
      runLimit: 10
    });
    assert.equal((await throwing.checkRun(['a'])).reason, 'unverified');
  });

  test('getRunUsage reports runsUsed null (and remaining 0) when the count read fails', async () => {
    const store = new FreeTierStore({ collection: {}, dispatchStore: fakeDispatchStore(null), runLimit: 10 });
    const usage = await store.getRunUsage(['a']);
    assert.equal(usage.runsUsed, null);
    assert.equal(usage.remaining, 0);
  });

  test('the run limit reads dispatch rows only — no taskModeStore dependency (source pin)', async () => {
    const source = readFileSync(new URL('../../lib/free-tier-store.js', import.meta.url), 'utf8');
    // Strip comments so the pin tests the CODE, not this file's own prose about
    // what it deliberately does not read.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(code, /taskModeStore/);
    assert.doesNotMatch(code, /task-mode-events/);

    // With no dispatch store injected the count is unreadable, not a fabricated 0.
    const bare = new FreeTierStore({ collection: {} });
    assert.equal((await bare.getRunUsage(['a'])).runsUsed, null);
  });
});


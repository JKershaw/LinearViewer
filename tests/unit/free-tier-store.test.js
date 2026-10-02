/**
 * LIN-689 — the global hourly cap in FreeTierStore.
 *
 * `tryUse` built the hourly key as `global:<hour>` and then prefixed it again on
 * write (`global:global:<hour>`), so the row it incremented was never the row
 * the guard read: `hourCount` stayed 0 and the global hourly cap could not fire
 * on any lane that went through `tryUse` (the actual-request path). `canUse`
 * (read-only) and `recordUsage` built the correct key, which is why the bug was
 * invisible to the read-only status endpoint and to test-helper writes.
 *
 * Case 1 fails on the unfixed code and passes once the key is built once through
 * a shared helper. Cases 2 and 3 are the rest of LIN-689's adopted coverage.
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

describe('LIN-689 — FreeTierStore hourly cap', () => {
  const harness = createMangoTmpdir('lin-689-free-tier-');
  before(() => harness.connect());
  after(() => harness.close());

  let collection;
  beforeEach(() => {
    collection = harness.freshDb().collection('free-tier-usage');
  });

  test('case 1: hourlyLimit+1 calls across distinct urlKeys — the last is refused "Service busy"', async () => {
    const hourlyLimit = 3;
    const store = new FreeTierStore({ collection, dailyLimit: 100, hourlyLimit });

    // Each workspace is well under its (high) daily limit, so only the shared
    // global hourly bucket can refuse. The first `hourlyLimit` must be allowed.
    for (let i = 0; i < hourlyLimit; i++) {
      const res = await store.tryUse(`ws-${i}`);
      assert.equal(res.allowed, true, `call ${i + 1} of ${hourlyLimit} should be allowed`);
    }

    const denied = await store.tryUse(`ws-${hourlyLimit}`);
    assert.equal(denied.allowed, false);
    assert.equal(denied.reason, 'Service busy, try again later');
    assert.equal(denied.remaining, 0);
    assert.equal(denied.limit, 100);
  });

  test('case 2: dailyLimit+1 calls for one workspace — denied and the stored count stops at dailyLimit', async () => {
    const dailyLimit = 2;
    const store = new FreeTierStore({ collection, dailyLimit, hourlyLimit: 1000 });

    assert.equal((await store.tryUse('acme')).allowed, true);
    assert.equal((await store.tryUse('acme')).allowed, true);

    const denied = await store.tryUse('acme');
    assert.equal(denied.allowed, false);
    assert.equal(denied.reason, 'Daily limit reached, resets at midnight UTC');

    const doc = await collection.findOne({ _id: `acme:${todayKey()}` });
    assert.equal(doc.count, dailyLimit);
  });

  test('case 3: a failing count read resolves refused, never rejects', async () => {
    const store = new FreeTierStore({
      collection: { findOne: async () => { throw new Error('db down'); } },
      dailyLimit: 5,
      hourlyLimit: 5
    });

    const res = await store.tryUse('acme');
    assert.equal(res.allowed, false);
    assert.equal(res.reason, 'Unable to verify usage limits, try again later');
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


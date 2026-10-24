/**
 * LIN-3706 — characterization of the free-tier plan and allowance through the
 * PUBLIC fronts, written before the seam (lib/plan-allowance.js) and green on
 * both sides of it. Every expectation below is what the code answered before
 * LIN-3706 moved the arithmetic, the bodies and the predicates into the seam, so
 * a front that drifts from today's behaviour fails here, not only in the replay.
 *
 * Covered, none of it by reading source text:
 *   - the store's constructor options and defaults (`||`, not `??`);
 *   - remaining arithmetic for runs (getRunUsage / checkRun) and prompts (tryUse);
 *   - both resets and the run-count window start at the UTC clock edges;
 *   - the prompt denial records and the prompt refusal block, key order included;
 *   - the 429 / 503 run-limit bodies byte for byte, from createDispatchItem;
 *   - mapDispatchRefusal, including an UNKNOWN or MISSING code (stays 429);
 *   - the quota route, including the off-path answers: a null or throwing
 *     getRunUsage is a 500 plus a log, never a 200 (LIN-3598);
 *   - who is Free for each purpose (credential, source label, AI-mock flag,
 *     precompute), over every combination of the four facts.
 */
process.env.NODE_ENV = 'test';

import { test, describe, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { FreeTierStore, DEFAULT_RUN_LIMIT } from '../../lib/free-tier-store.js';
import { createDispatchItem } from '../../lib/dispatch-factory.js';
import { mapDispatchRefusal } from '../../lib/dispatch-refusal.js';
import { createDispatchRoutes } from '../../routes/dispatch.js';
import {
  resolveChatCredential,
  resolveOpenRouterSource,
  isFlagFreeTier,
  freeTierRefusalBlock
} from '../../lib/chat-request.js';
import { resolvePrecomputeCredential } from '../../lib/run-paragraph-hook.js';

const ENV_KEYS = ['OPENROUTER_API_KEY', 'OPENROUTER_FREE_TIER_KEY'];
let savedEnv;
beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
});
afterEach(() => {
  mock.timers.reset();
  mock.restoreAll();
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

/** Run `fn` with the global Date frozen at `iso`. */
async function at(iso, fn) {
  mock.timers.enable({ apis: ['Date'], now: Date.parse(iso) });
  try {
    return await fn();
  } finally {
    mock.timers.reset();
  }
}

/** A collection double: findOneAndUpdate counts per _id, like the real upsert. */
function countingCollection({ throws = false } = {}) {
  const counts = new Map();
  return {
    counts,
    findOneAndUpdate: async (filter, update) => {
      if (throws) throw new Error('db down');
      const next = (counts.get(filter._id) || 0) + (update.$inc?.count ?? 0);
      counts.set(filter._id, next);
      return { count: next };
    }
  };
}

function runStore(used, options = {}) {
  const seen = [];
  const store = new FreeTierStore({
    collection: countingCollection(),
    dispatchStore: { countFreshRunsSince: async (ids, since) => { seen.push({ ids, since }); return typeof used === 'function' ? used() : used; } },
    ...options
  });
  return { store, seen };
}

describe('LIN-3706 — store constructor options and defaults', () => {
  test('no options at all: 10 runs a day and 50 prompts an hour', () => {
    const store = new FreeTierStore({ collection: {} });
    assert.equal(store.runLimit, 10);
    assert.equal(store.hourlyLimit, 50);
    assert.equal(DEFAULT_RUN_LIMIT, 10);
  });

  test('0, null and undefined give the default; a string is kept as a string; a negative is kept', () => {
    for (const falsy of [0, null, undefined]) {
      const store = new FreeTierStore({ collection: {}, runLimit: falsy, hourlyLimit: falsy });
      assert.equal(store.runLimit, 10, `runLimit ${String(falsy)}`);
      assert.equal(store.hourlyLimit, 50, `hourlyLimit ${String(falsy)}`);
    }
    const kept = new FreeTierStore({ collection: {}, runLimit: '5', hourlyLimit: '7' });
    assert.strictEqual(kept.runLimit, '5');
    assert.strictEqual(kept.hourlyLimit, '7');
    const negative = new FreeTierStore({ collection: {}, runLimit: -3, hourlyLimit: -4 });
    assert.equal(negative.runLimit, -3);
    assert.equal(negative.hourlyLimit, -4);
  });

  test('the global hour key is still built by the store', async () => {
    await at('2026-10-20T07:45:00.000Z', () => {
      const store = new FreeTierStore({ collection: {} });
      assert.equal(store._getGlobalHourKey(), 'global:2026-10-20T07');
    });
  });
});

describe('LIN-3706 — remaining runs (getRunUsage and checkRun)', () => {
  const cases = [
    { used: 0, remaining: 10, run: 'allowed' },
    { used: 9, remaining: 1, run: 'allowed' },
    { used: 10, remaining: 0, run: 'limit' },
    { used: 11, remaining: 0, run: 'limit' },
    { used: -3, remaining: 13, run: 'allowed' }
  ];
  for (const { used, remaining, run } of cases) {
    test(`used ${used}: remaining ${remaining}, gate ${run}`, async () => {
      const usage = await runStore(used).store.getRunUsage(['a']);
      assert.deepEqual(usage, { runsUsed: used, limit: 10, remaining, resetsAt: usage.resetsAt });
      const gate = await runStore(used).store.checkRun(['a']);
      assert.equal(gate.remaining, remaining);
      assert.equal(gate.allowed, run === 'allowed');
      if (run === 'limit') assert.equal(gate.reason, 'limit');
    });
  }

  test('an unreadable count (null) is remaining 0, runsUsed null, and an unverified gate', async () => {
    const usage = await runStore(null).store.getRunUsage(['a']);
    assert.equal(usage.runsUsed, null);
    assert.equal(usage.remaining, 0);
    const gate = await runStore(null).store.checkRun(['a']);
    assert.deepEqual(
      { allowed: gate.allowed, reason: gate.reason, runsUsed: gate.runsUsed, remaining: gate.remaining, limit: gate.limit },
      { allowed: false, reason: 'unverified', runsUsed: null, remaining: 0, limit: 10 }
    );
  });

  test('NaN stays NaN: remaining is NaN and the gate admits (NaN >= limit is false)', async () => {
    const usage = await runStore(NaN).store.getRunUsage(['a']);
    assert.ok(Number.isNaN(usage.remaining));
    const gate = await runStore(NaN).store.checkRun(['a']);
    assert.equal(gate.allowed, true);
    assert.ok(Number.isNaN(gate.remaining));
  });

  test('a store with no dispatch store reads null, which is unverified', async () => {
    const store = new FreeTierStore({ collection: {} });
    assert.equal((await store.getRunUsage(['a'])).runsUsed, null);
    assert.equal((await store.checkRun(['a'])).reason, 'unverified');
  });

  test('a negative runLimit option is kept: remaining 0 and the gate refuses', async () => {
    const { store } = runStore(0, { runLimit: -2 });
    const usage = await store.getRunUsage(['a']);
    assert.equal(usage.limit, -2);
    assert.equal(usage.remaining, 0);
    assert.equal((await store.checkRun(['a'])).reason, 'limit');
  });

  test('runLimit 0 is the default (10), not "no runs"', async () => {
    const { store } = runStore(3, { runLimit: 0 });
    assert.equal((await store.getRunUsage(['a'])).remaining, 7);
  });
});

describe('LIN-3706 — remaining prompts and the hourly denial records (tryUse)', () => {
  test('under the cap: allowed, remaining is limit - count, in this key order', async () => {
    const store = new FreeTierStore({ collection: countingCollection(), hourlyLimit: 3 });
    const first = await at('2026-10-20T10:15:00.000Z', () => store.tryUse('acme'));
    assert.equal(JSON.stringify(first), '{"allowed":true,"remaining":2,"limit":3,"resetsAt":"2026-10-20T11:00:00.000Z"}');
  });

  test('over the cap: "Service busy", remaining 0, rolled back, in this key order', async () => {
    const collection = countingCollection();
    const store = new FreeTierStore({ collection, hourlyLimit: 1 });
    await at('2026-10-20T10:15:00.000Z', async () => {
      await store.tryUse('a');
      const denied = await store.tryUse('b');
      assert.equal(JSON.stringify(denied), '{"allowed":false,"reason":"Service busy, try again later","remaining":0,"limit":1,"resetsAt":"2026-10-20T11:00:00.000Z"}');
      assert.equal(collection.counts.get('global:2026-10-20T10'), 1, 'the denied increment is rolled back');
    });
  });

  test('no urlKey: "Missing workspace", no store call', async () => {
    const collection = countingCollection();
    const store = new FreeTierStore({ collection });
    const denied = await at('2026-10-20T10:15:00.000Z', () => store.tryUse(''));
    assert.equal(JSON.stringify(denied), '{"allowed":false,"reason":"Missing workspace","remaining":0,"limit":50,"resetsAt":"2026-10-20T11:00:00.000Z"}');
    assert.equal(collection.counts.size, 0);
  });

  test('a store that throws fails closed: "Unable to verify usage limits"', async () => {
    mock.method(console, 'error', () => {});
    const store = new FreeTierStore({ collection: countingCollection({ throws: true }) });
    const denied = await at('2026-10-20T10:15:00.000Z', () => store.tryUse('acme'));
    assert.equal(JSON.stringify(denied), '{"allowed":false,"reason":"Unable to verify usage limits, try again later","remaining":0,"limit":50,"resetsAt":"2026-10-20T11:00:00.000Z"}');
  });

  test('the prompt refusal block has four keys in order and never runsUsed; an undefined remaining drops from the JSON', () => {
    const denial = { allowed: false, reason: 'x', remaining: 0, limit: 50, resetsAt: '2026-10-20T11:00:00.000Z', runsUsed: 9 };
    assert.equal(JSON.stringify(freeTierRefusalBlock(denial)), '{"freeTier":{"used":true,"remaining":0,"limit":50,"resetsAt":"2026-10-20T11:00:00.000Z"}}');
    assert.equal(JSON.stringify(freeTierRefusalBlock({ ...denial, remaining: undefined })), '{"freeTier":{"used":true,"limit":50,"resetsAt":"2026-10-20T11:00:00.000Z"}}');
    assert.throws(() => freeTierRefusalBlock(null), TypeError);
  });
});

describe('LIN-3706 — the UTC windows at the clock edges', () => {
  // [now, daily reset, hourly reset]
  const edges = [
    ['2026-10-19T23:59:59.999Z', '2026-10-20T00:00:00.000Z', '2026-10-20T00:00:00.000Z'],
    ['2026-10-20T00:00:00.000Z', '2026-10-21T00:00:00.000Z', '2026-10-20T01:00:00.000Z'],
    ['2026-10-20T00:00:00.001Z', '2026-10-21T00:00:00.000Z', '2026-10-20T01:00:00.000Z'],
    ['2026-10-31T23:30:00.000Z', '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z'],
    ['2026-12-31T23:59:59.999Z', '2027-01-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z'],
    ['2028-02-29T10:30:00.000Z', '2028-03-01T00:00:00.000Z', '2028-02-29T11:00:00.000Z']
  ];
  for (const [now, daily, hourly] of edges) {
    test(`at ${now}: day resets ${daily}, hour resets ${hourly}`, async () => {
      await at(now, async () => {
        const { store, seen } = runStore(0);
        assert.equal((await store.getRunUsage(['a'])).resetsAt, daily);
        assert.equal((await store.checkRun(['a'])).resetsAt, daily);
        assert.equal(seen[0].since.toISOString(), `${now.slice(0, 10)}T00:00:00.000Z`, 'the run count window starts at 00:00 UTC');
        const allowed = await new FreeTierStore({ collection: countingCollection() }).tryUse('acme');
        assert.equal(allowed.resetsAt, hourly);
      });
    });
  }

  test('the day and hour keys are the UTC date and hour', async () => {
    await at('2028-02-29T23:59:59.999Z', () => {
      const store = new FreeTierStore({ collection: {} });
      assert.equal(store._getDateKey(), '2028-02-29');
      assert.equal(store._getHourKey(), '2028-02-29T23');
    });
  });

  test('tryUse reads the clock once per place it did: a tick during the await moves the day key, not the hour key or the TTLs', async () => {
    mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-20T23:59:59.999Z') });
    const written = [];
    const collection = {
      findOneAndUpdate: async (filter, update) => {
        written.push({ id: filter._id, lastUsedAt: update.$set?.lastUsedAt?.toISOString() });
        // The first await (the global hour counter) lets the clock cross midnight.
        if (written.length === 1) mock.timers.setTime(Date.parse('2026-10-21T00:00:00.001Z'));
        return { count: 1 };
      }
    };
    const allowed = await new FreeTierStore({ collection }).tryUse('acme');
    assert.deepEqual(written, [
      { id: 'global:2026-10-20T23', lastUsedAt: '2026-10-20T23:59:59.999Z' },
      { id: 'acme:2026-10-21', lastUsedAt: '2026-10-20T23:59:59.999Z' }
    ], 'hour key and lastUsedAt come from the first read; the day key from the read after the await');
    assert.equal(allowed.resetsAt, '2026-10-21T01:00:00.000Z', 'resetsAt is read last, from the ticked clock');
  });

  test('the day count is keyed on the UTC date, read after the first await', async () => {
    const collection = countingCollection();
    const store = new FreeTierStore({ collection });
    await at('2026-10-20T23:59:59.999Z', () => store.tryUse('acme'));
    assert.ok(collection.counts.has('acme:2026-10-20'));
    assert.ok(collection.counts.has('global:2026-10-20T23'));
  });
});

describe('LIN-3706 — the run-limit refusal bodies (createDispatchItem)', () => {
  const RESETS = '2026-10-03T00:00:00.000Z';
  const NOW = Date.parse('2026-10-02T12:00:00.000Z');

  async function refusalFor(runGate) {
    const store = { addItem: async () => { throw new Error('must not enqueue'); } };
    return createDispatchItem({
      store, urlKey: 'acme', now: NOW, prompt: 'x', runGate,
      fields: { promptName: 'implementation', issueIdentifier: 'LIN-1' }
    }).then(() => null, (e) => e);
  }

  test('429 body, key order and status', async () => {
    const err = await refusalFor(async () => ({ allowed: false, reason: 'limit', runsUsed: 10, limit: 10, remaining: 0, resetsAt: RESETS }));
    assert.equal(err.status, 429);
    assert.equal(err.message, 'Daily run limit reached (10 of 10 today). Resets at midnight UTC.');
    assert.equal(
      JSON.stringify(err.runLimit),
      '{"error":"Daily run limit reached (10 of 10 today). Resets at midnight UTC.","code":"RUN_LIMIT_REACHED","freeTier":{"used":true,"remaining":0,"limit":10,"resetsAt":"2026-10-03T00:00:00.000Z","runsUsed":10},"retryAfter":43200}'
    );
  });

  test('503 body for an unverified gate that carries a resetsAt', async () => {
    const err = await refusalFor(async () => ({ allowed: false, reason: 'unverified', runsUsed: null, limit: 10, remaining: 0, resetsAt: RESETS }));
    assert.equal(err.status, 503);
    assert.equal(err.message, 'Unable to verify the run limit for this account');
    assert.equal(
      JSON.stringify(err.runLimit),
      '{"error":"Unable to verify the run limit for this account","code":"RUN_LIMIT_UNVERIFIED","freeTier":{"used":true,"remaining":0,"limit":10,"resetsAt":"2026-10-03T00:00:00.000Z","runsUsed":null},"retryAfter":43200}'
    );
  });

  for (const [name, gate] of [['a null gate', async () => null], ['a throwing gate', async () => { throw new Error('boom'); }], ['an allowed:false gate with no reason', async () => ({ allowed: false })]]) {
    test(`${name} fails closed: 503, limit null, resetsAt null, retryAfter 1`, async () => {
      const err = await refusalFor(gate);
      assert.equal(err.status, 503);
      assert.equal(
        JSON.stringify(err.runLimit),
        '{"error":"Unable to verify the run limit for this account","code":"RUN_LIMIT_UNVERIFIED","freeTier":{"used":true,"remaining":0,"limit":null,"resetsAt":null,"runsUsed":null},"retryAfter":1}'
      );
    });
  }

  test('an unparseable resetsAt passes NaN through (retryAfter serialises as null)', async () => {
    const err = await refusalFor(async () => ({ allowed: false, reason: 'limit', runsUsed: 1, limit: 1, remaining: 0, resetsAt: 'not a date' }));
    assert.equal(err.status, 429);
    assert.ok(Number.isNaN(err.runLimit.retryAfter));
  });

  test('a past resetsAt is at least one second', async () => {
    const err = await refusalFor(async () => ({ allowed: false, reason: 'limit', runsUsed: 1, limit: 1, remaining: 0, resetsAt: '2020-01-01T00:00:00.000Z' }));
    assert.equal(err.runLimit.retryAfter, 1);
  });
});

describe('LIN-3706 — mapDispatchRefusal run-limit status and retryAfter', () => {
  const freeTier = { used: true };

  test('the reached code is 429 and keeps its retryAfter', () => {
    const out = mapDispatchRefusal({ runLimit: { code: 'RUN_LIMIT_REACHED', error: 'e', freeTier, retryAfter: 7 } });
    assert.equal(out.status, 429);
    assert.equal(out.retryAfter, 7);
    assert.equal(out.note, 'RUN_LIMIT_REACHED');
  });

  test('the unverified code is 503 and owes no Retry-After', () => {
    const out = mapDispatchRefusal({ runLimit: { code: 'RUN_LIMIT_UNVERIFIED', error: 'e', freeTier, retryAfter: 7 } });
    assert.equal(out.status, 503);
    assert.equal(out.retryAfter, null);
    assert.deepEqual(out.body, { code: 'RUN_LIMIT_UNVERIFIED', freeTier, retryAfter: 7 });
  });

  for (const code of ['X', undefined, 'run_limit_unverified', null]) {
    test(`an unknown or missing code (${String(code)}) stays 429 and keeps retryAfter`, () => {
      const out = mapDispatchRefusal({ runLimit: { code, error: 'e', freeTier, retryAfter: 7 } });
      assert.equal(out.status, 429);
      assert.equal(out.retryAfter, 7);
    });
  }
});

describe('LIN-3706 — the quota route, on and off the happy path', () => {
  const USAGE = { runsUsed: 4, limit: 10, remaining: 6, resetsAt: '2026-10-21T00:00:00.000Z' };

  async function getQuota({ freeTierStore, session = { accountId: 'acct-1', openRouterApiKey: null } }) {
    const app = express();
    app.use(createDispatchRoutes({
      workspaceOwnerCheck: async () => ({ status: 'owner' }),
      dispatchQueueStore: {},
      dispatchTokenStore: {},
      workspaceFromUrl: (req, res, next) => { req.workspace = { urlKey: req.params.urlKey }; req.session = session; next(); },
      userPreferencesStore: {},
      harbourFeedbackTokenStore: null,
      freeTierStore,
      accountStore: null
    }));
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    try {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/workspace/acme/api/dispatch/quota`);
      return { status: res.status, text: await res.text() };
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  test('a free-tier account: limited:true with the usage, in this key order', async () => {
    process.env.OPENROUTER_FREE_TIER_KEY = 'free-test-key';
    let asked = 0;
    const res = await getQuota({ freeTierStore: { getRunUsage: async () => { asked++; return USAGE; } } });
    assert.equal(res.status, 200);
    assert.equal(res.text, '{"limited":true,"runsUsed":4,"limit":10,"remaining":6,"resetsAt":"2026-10-21T00:00:00.000Z"}');
    assert.equal(asked, 1);
  });

  test('not free tier (a session key): the five-key limited:false body, and the store is not asked', async () => {
    process.env.OPENROUTER_FREE_TIER_KEY = 'free-test-key';
    const res = await getQuota({
      freeTierStore: { getRunUsage: async () => { throw new Error('must not be called'); } },
      session: { accountId: 'acct-1', openRouterApiKey: 'own-key' }
    });
    assert.equal(res.status, 200);
    assert.equal(res.text, '{"limited":false,"runsUsed":null,"limit":null,"remaining":null,"resetsAt":null}');
  });

  test('free tier but no attributable account: the same limited:false body, store not asked', async () => {
    process.env.OPENROUTER_FREE_TIER_KEY = 'free-test-key';
    const res = await getQuota({
      freeTierStore: { getRunUsage: async () => { throw new Error('must not be called'); } },
      session: { accountId: null, openRouterApiKey: null }
    });
    assert.equal(res.status, 200);
    assert.equal(res.text, '{"limited":false,"runsUsed":null,"limit":null,"remaining":null,"resetsAt":null}');
  });

  test('no free key configured: limited:false', async () => {
    const res = await getQuota({ freeTierStore: { getRunUsage: async () => USAGE } });
    assert.equal(res.text, '{"limited":false,"runsUsed":null,"limit":null,"remaining":null,"resetsAt":null}');
  });

  test('getRunUsage resolving null is a 500 and a logged TypeError, never a 200', async () => {
    process.env.OPENROUTER_FREE_TIER_KEY = 'free-test-key';
    const logged = mock.method(console, 'error', () => {});
    const res = await getQuota({ freeTierStore: { getRunUsage: async () => null } });
    assert.equal(res.status, 500);
    assert.equal(res.text, '{"error":"Failed to read dispatch quota"}');
    const call = logged.mock.calls.find((c) => c.arguments[0] === 'Read dispatch quota error:');
    assert.ok(call, 'the failure is logged under its own label');
    assert.match(call.arguments[1], /Cannot read properties of null/, 'the TypeError message is what is logged');
  });

  test('getRunUsage throwing is the same 500, logged with the thrown error', async () => {
    process.env.OPENROUTER_FREE_TIER_KEY = 'free-test-key';
    const logged = mock.method(console, 'error', () => {});
    const res = await getQuota({ freeTierStore: { getRunUsage: async () => { throw new Error('count unreadable'); } } });
    assert.equal(res.status, 500);
    assert.equal(res.text, '{"error":"Failed to read dispatch quota"}');
    const call = logged.mock.calls.find((c) => c.arguments[0] === 'Read dispatch quota error:');
    assert.ok(call);
    assert.equal(call.arguments[1], 'count unreadable', 'the route logs err.message');
  });
});

describe('LIN-3706 — who is Free, for each purpose, over every combination of the four facts', () => {
  const sessionKeys = [null, 'own-key'];
  const paidKeys = [undefined, '   ', 'paid-key'];
  const freeKeys = [undefined, '   ', 'free-key'];
  const flags = [false, true];

  for (const sessionApiKey of sessionKeys) {
    for (const paid of paidKeys) {
      for (const free of freeKeys) {
        for (const flag of flags) {
          const name = `session=${sessionApiKey ?? '-'} paid=${JSON.stringify(paid ?? null)} free=${JSON.stringify(free ?? null)} flag=${flag}`;
          test(name, () => {
            if (paid === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = paid;
            if (free === undefined) delete process.env.OPENROUTER_FREE_TIER_KEY; else process.env.OPENROUTER_FREE_TIER_KEY = free;

            const paidKey = (paid || '').trim();
            const freeKey = (free || '').trim();
            const noOwn = !sessionApiKey && !paidKey;

            assert.deepEqual(resolveChatCredential({ sessionApiKey }), {
              apiKey: sessionApiKey || paidKey || freeKey || null,
              isFreeTier: noOwn && !!freeKey,
              available: !!(sessionApiKey || paidKey || freeKey)
            });
            assert.equal(
              resolveOpenRouterSource({ sessionApiKey, sessionFreeTierFlag: flag }),
              sessionApiKey ? 'oauth' : paidKey ? 'env' : (freeKey || flag) ? 'free' : null
            );
            assert.equal(isFlagFreeTier({ sessionApiKey, sessionFreeTierFlag: flag }), flag && noOwn);
            const precompute = resolvePrecomputeCredential({ OPENROUTER_API_KEY: paid, OPENROUTER_FREE_TIER_KEY: free });
            assert.equal(precompute?.apiKey ?? null, paidKey || freeKey || null);
            // LIN-3856: the session-less free-tier bit (no own key ever reaches a precompute).
            if (precompute) assert.equal(precompute.isFreeTier, !paidKey && !!freeKey);
          });
        }
      }
    }
  }
});

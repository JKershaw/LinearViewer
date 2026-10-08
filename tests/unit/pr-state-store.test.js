/**
 * LIN-3311 — the lifted PR-state store, `lib/pr-state-store.js`.
 *
 * The LIN-3251 route behaviour itself stays pinned, unedited, by the
 * `GET /api/run/:runId/pr-state` block in dashboard-routes.test.js. This file
 * pins what the lift adds: one budget and one cache shared by every caller of
 * one instance (including the real dashboard router), `fetchedAt`/`via`,
 * the pure one-URL rule, and the server's single
 * instance. Injected clock, counting fetch stub: no sleeps, no network.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createPrStateStore,
  resolveRunPrRef,
  prStatePayload,
  prStateUnknown,
  primePrStateCache,
  clearPrStateCache,
  prStateUpstreamFetchCount,
  PR_STATE_VIA,
  PR_STATE_UPSTREAM_LIMIT,
  PR_STATE_OPEN_TTL_MS,
  PR_STATE_CLOSED_TTL_MS
} from '../../lib/pr-state-store.js';
import * as dashboard from '../../routes/dashboard.js';
import { InMemoryRunSummaryCacheStore } from '../../lib/run-summary-cache.js';
import { InMemorySessionSummaryCacheStore } from '../../lib/session-summary-cache.js';
import { InMemoryRunParagraphStore } from '../../lib/run-paragraph-store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const REF = { repo: 'acme/widget', number: 12, url: 'https://github.com/acme/widget/pull/12' };
const OTHER = { repo: 'acme/gadget', number: 7, url: 'https://github.com/acme/gadget/pull/7' };

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, async json() { return body; } };
}

// Counts every upstream GitHub GET `fetchPrStatus` makes (4 per read).
function githubStub(counts, { state = 'open', merged = false } = {}) {
  return async (url) => {
    counts.github += 1;
    if (/\/repos\/[^/]+\/[^/]+$/.test(url)) return jsonResponse(200, { private: false });
    if (/\/pulls\/\d+$/.test(url)) return jsonResponse(200, { state, merged, head: { ref: 'feature', sha: 'abc1234' }, base: { ref: 'main' }, mergeable: true });
    if (/\/check-runs$/.test(url)) return jsonResponse(200, { check_runs: [{ name: 'unit', conclusion: 'success' }] });
    if (/\/status$/.test(url)) return jsonResponse(200, { statuses: [] });
    return jsonResponse(404, {});
  };
}

function makeStore({ clock, counts, github = {}, ...rest } = {}) {
  return createPrStateStore({
    cache: new Map(),
    now: () => clock.t,
    githubFetch: githubStub(counts, github),
    ...rest
  });
}

describe('pr-state-store: one budget across callers', () => {
  test('a cap spent by one caller makes the other refuse with no fetch and no count change', async () => {
    const clock = { t: 1_000_000 };
    const counts = { github: 0 };
    const store = makeStore({ clock, counts });

    // Caller A spends the whole budget: 9 distinct PRs × 4 calls = 36.
    for (let i = 0; i < PR_STATE_UPSTREAM_LIMIT / 4; i++) {
      const r = await store.readResult({ repo: 'acme/a', number: i + 1 }, clock.t);
      assert.equal(r.via, PR_STATE_VIA.FRESH);
    }
    assert.equal(counts.github, 36);
    assert.equal(store.budgetUsed(clock.t), 36);

    // Caller B (a different PR, so no cache hit) is refused before any fetch.
    const before = prStateUpstreamFetchCount();
    const refused = await store.readResult(OTHER, clock.t);
    assert.deepEqual(refused, { result: null, fetchedAt: null, via: PR_STATE_VIA.UNAVAILABLE });
    assert.equal(counts.github, 36, 'no upstream call for the refused caller');
    assert.equal(prStateUpstreamFetchCount(), before, 'the shared counter is unchanged');
    assert.deepEqual(await store.readPayload(OTHER, clock.t), prStateUnknown(OTHER), 'the payload read is "state not reported"');
  });

  test('two stores do NOT share a budget (the sharing is per instance, which is why server.js builds one)', async () => {
    const clock = { t: 2_000_000 };
    const counts = { github: 0 };
    const a = makeStore({ clock, counts, bucket: Array(36).fill(clock.t) });
    const b = makeStore({ clock, counts });
    assert.equal((await a.readResult(REF, clock.t)).via, PR_STATE_VIA.UNAVAILABLE);
    assert.equal((await b.readResult(REF, clock.t)).via, PR_STATE_VIA.FRESH);
  });

  test('the sliding window ages calls out after 60 minutes (not a fixed window)', async () => {
    const base = 10_000_000;
    const clock = { t: base + 61 * 60 * 1000 };
    const counts = { github: 0 };
    const bucket = Array.from({ length: 36 }, (_, i) => base + i * 60 * 1000);
    const store = makeStore({ clock, counts, bucket });
    assert.equal((await store.readResult(REF, clock.t)).via, PR_STATE_VIA.UNAVAILABLE, 'recent calls still inside the trailing hour');
    clock.t = base + 120 * 60 * 1000;
    assert.equal((await store.readResult(REF, clock.t)).via, PR_STATE_VIA.FRESH, 'all 36 aged out');
    assert.equal(counts.github, 4);
    assert.equal(bucket.length, 4, 'the caller-held bucket is mutated in place');
  });
});

describe('pr-state-store: fetchedAt and via', () => {
  test('fresh read → cache hit → stale when expired with no budget', async () => {
    const clock = { t: 3_000_000 };
    const counts = { github: 0 };
    const bucket = [];
    const store = makeStore({ clock, counts, bucket });

    const fresh = await store.readResult(REF, clock.t);
    assert.equal(fresh.via, PR_STATE_VIA.FRESH);
    assert.equal(fresh.fetchedAt, 3_000_000);
    assert.equal(fresh.result.state, 'open');
    assert.deepEqual(store.cache.get('acme/widget#12').fetchedAt, 3_000_000, 'the entry carries fetchedAt');
    assert.equal(store.cache.get('acme/widget#12').expiresAt, 3_000_000 + PR_STATE_OPEN_TTL_MS);

    clock.t += 60_000;
    const hit = await store.readResult(REF, clock.t);
    assert.equal(hit.via, PR_STATE_VIA.CACHE);
    assert.equal(hit.fetchedAt, 3_000_000, 'a hit reports when the value was read, not now');
    assert.equal(counts.github, 4);

    clock.t += PR_STATE_OPEN_TTL_MS;
    bucket.splice(0, bucket.length, ...Array(36).fill(clock.t));
    const stale = await store.readResult(REF, clock.t);
    assert.equal(stale.via, PR_STATE_VIA.STALE);
    assert.equal(stale.fetchedAt, 3_000_000, 'stale keeps its true, older age');
    assert.equal(stale.result.state, 'open');
    assert.equal(counts.github, 4);
  });

  test('a failed upstream read is stale with a cached value, unavailable without', async () => {
    const clock = { t: 4_000_000 };
    const cache = new Map([['acme/widget#12', { value: { readable: true, state: 'open', merged: false, number: 12, checks: [] }, expiresAt: clock.t - 1, fetchedAt: 3_900_000 }]]);
    const throwing = async () => { throw new Error('network down'); };
    const store = createPrStateStore({ cache, now: () => clock.t, githubFetch: throwing });
    const origError = console.error;
    console.error = () => {};
    try {
      const stale = await store.readResult(REF, clock.t);
      assert.equal(stale.via, PR_STATE_VIA.STALE);
      assert.equal(stale.fetchedAt, 3_900_000);
      const none = await store.readResult(OTHER, clock.t);
      assert.deepEqual(none, { result: null, fetchedAt: null, via: PR_STATE_VIA.UNAVAILABLE });
    } finally {
      console.error = origError;
    }
  });

  test('a merged PR is cached for 24 h', async () => {
    const clock = { t: 5_000_000 };
    const counts = { github: 0 };
    const store = makeStore({ clock, counts, github: { state: 'closed', merged: true } });
    await store.readResult(REF, clock.t);
    assert.equal(store.cache.get('acme/widget#12').expiresAt, 5_000_000 + PR_STATE_CLOSED_TTL_MS);
    clock.t += 20 * 60 * 60 * 1000;
    assert.equal((await store.readResult(REF, clock.t)).via, PR_STATE_VIA.CACHE);
    assert.equal(counts.github, 4);
  });
});

describe('pr-state-store: pure helpers', () => {
  test('resolveRunPrRef applies the one-URL rule', () => {
    assert.deepEqual(resolveRunPrRef(null), { status: 'none', ref: null });
    assert.deepEqual(resolveRunPrRef({ state: { prUrls: [] } }), { status: 'none', ref: null });
    assert.deepEqual(resolveRunPrRef({ state: { prUrls: [REF, OTHER] } }), { status: 'multiple', ref: null });
    assert.deepEqual(resolveRunPrRef({ state: { prUrls: [{ ...REF, extra: 1 }] } }), { status: 'one', ref: REF });
  });

  test('prStatePayload shapes the reader result exactly as the route always did', () => {
    assert.deepEqual(prStatePayload(null, REF), { state: 'unknown', number: 12, checks: null, url: REF.url });
    assert.deepEqual(prStatePayload({ readable: false }, REF), { state: 'unknown', number: 12, checks: null, url: REF.url });
    assert.deepEqual(prStatePayload({ readable: true, merged: true, state: 'closed', number: 12, checks: [] }, REF).state, 'merged');
    assert.deepEqual(prStatePayload({ readable: true, state: 'open', number: 12, checks: [{ name: 'u', conclusion: 'success' }] }, REF), { state: 'open', number: 12, checks: 'passing', url: REF.url });
    assert.deepEqual(prStateUnknown(null), { state: 'unknown', number: null, checks: null, url: null });
  });
});

describe('pr-state-store: test seams and the shared default cache', () => {
  beforeEach(() => clearPrStateCache());

  test('primePrStateCache stamps fetchedAt = now(), and a default store reads the primed entry with no fetch', async () => {
    primePrStateCache({ repo: 'acme/widget', number: 12, value: { readable: true, state: 'open', merged: false, number: 12, checks: [] }, now: () => 11_000_000 });
    const counts = { github: 0 };
    const store = createPrStateStore({ now: () => 11_000_500, githubFetch: githubStub(counts) });
    const r = await store.readResult(REF, 11_000_500);
    assert.equal(r.via, PR_STATE_VIA.CACHE);
    assert.equal(r.fetchedAt, 11_000_000);
    assert.equal(counts.github, 0);
    assert.equal(prStateUpstreamFetchCount(), 0);
  });

  test('routes/dashboard.js still re-exports the three test seams (routes/test.js imports them from there)', () => {
    assert.equal(dashboard.primePrStateCache, primePrStateCache);
    assert.equal(dashboard.clearPrStateCache, clearPrStateCache);
    assert.equal(dashboard.prStateUpstreamFetchCount, prStateUpstreamFetchCount);
  });

  test('server.js builds exactly one store and hands that instance to the dashboard router', () => {
    const src = readFileSync(join(__dirname, '../../server.js'), 'utf8');
    assert.equal((src.match(/createPrStateStore\(/g) || []).length, 1, 'one construction');
    assert.match(src, /createDashboardRoutes\(\{[^}]*\bprStateStore\b[^}]*\}\)/, 'passed to the dashboard router');
  });
});

describe('pr-state-store: one instance serves the dashboard router and a second caller', () => {
  function router(prStateStore, provider) {
    return dashboard.createDashboardRoutes({
      workspaceFromUrl: (req, res, next) => next(),
      dispatchQueueStore: { async listItems() { return []; }, async listHistory() { return { items: [] }; } },
      agentStatusStore: { async listStatus() { return { items: [] }; } },
      runSummaryCacheStore: new InMemoryRunSummaryCacheStore(),
      sessionSummaryCacheStore: new InMemorySessionSummaryCacheStore(),
      runParagraphStore: new InMemoryRunParagraphStore(),
      freeTierStore: { async tryUse() { return { allowed: true }; } },
      getWorkspaceAccessToken: async () => 'token',
      fetchIssueContext: async () => null,
      fetchWorkspaceIssues: async () => [],
      getOpenRouterSource: () => 'env',
      getDeployInfo: () => ({}),
      prStateStore,
      // The bag's store fields lose to the injected store; its route seams apply.
      prState: {
        bucket: Array(36).fill(0),
        cache: new Map(),
        resolveProvider: () => ({ provider, callScope: 'scope' }),
        loadRun: async () => ({ issueIdentifier: 'LIN-1', evidenceUrls: [] })
      }
    });
  }

  async function callPrState(r) {
    const layer = r.stack.find(l => l.route?.path === '/workspace/:urlKey/api/run/:runId/pr-state');
    const handler = layer.route.stack[layer.route.stack.length - 1].handle;
    const res = { statusCode: 200, jsonBody: null, status(c) { this.statusCode = c; return this; }, json(b) { this.jsonBody = b; return this; } };
    await handler({ workspace: { urlKey: 'ws-a' }, params: { runId: 'run-1' }, session: {}, query: {} }, res);
    return res;
  }

  test('the route fills and spends the injected store; a second caller sees the same cache and budget', async () => {
    const clock = { t: 12_000_000 };
    const counts = { github: 0 };
    const provider = {
      async fetchIssueComments() { return [{ body: REF.url, createdAt: '2026-07-01T00:00:00.000Z', user: 'worker' }]; }
    };
    const store = createPrStateStore({ cache: new Map(), now: () => clock.t, githubFetch: githubStub(counts) });
    const r = router(store, provider);

    const first = await callPrState(r);
    assert.equal(first.jsonBody.state, 'open', 'the injected store won over the bag\'s spent bucket');
    assert.equal(counts.github, 4);
    assert.equal(store.budgetUsed(clock.t), 4, 'the route spent the shared budget');

    // Second caller: a cache hit on what the route read, at the route's fetchedAt.
    const second = await store.readResult(REF, clock.t + 1000);
    assert.equal(second.via, PR_STATE_VIA.CACHE);
    assert.equal(second.fetchedAt, 12_000_000);
    assert.equal(counts.github, 4);

    // The second caller spends the rest; the route is then refused upstream.
    for (let i = 0; i < 8; i++) await store.readResult({ repo: 'acme/b', number: i + 1 }, clock.t);
    assert.equal(store.budgetUsed(clock.t), 36);
    clock.t += PR_STATE_OPEN_TTL_MS + 1; // the route's entry is now expired
    const refused = await callPrState(r);
    assert.equal(refused.statusCode, 200);
    assert.equal(refused.jsonBody.state, 'open', 'serves the stale value, never a 403');
    assert.equal(counts.github, 36, 'no upstream call from the route once the shared cap is spent');
  });
});

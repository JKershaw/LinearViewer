/**
 * LIN-1829 — GET /api/proxy/periodicals
 *
 * Run with: node --test tests/unit/proxy-periodicals-route.test.js
 *
 * Harness modeled on tests/unit/proxy-issue-cost-route.test.js: an
 * OPTIONS-AWARE, CALL-RECORDING dispatch-store stub (`listItems`/`listHistory`
 * record their args) so the route's read shape — projection, absence of
 * `limit`, workspace scoping — can be asserted on directly, alongside the
 * real foldPeriodicalRuns() output via the actual periodicals registry
 * (the route calls getPeriodicals() itself; it takes no injectable
 * templates param, so fixtures below use real registry ids).
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { getPeriodicals } from '../../lib/periodicals.js';
import { PERIODICAL_PROJECTION } from '../../lib/dispatch-store.js';

const TEMPLATES = getPeriodicals();
const TEMPLATE = TEMPLATES[0]; // { id, title, mode, cadence: 'weekly', ... }
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const HISTORY_TTL_SECONDS = 30 * 24 * 60 * 60; // store default (lib/dispatch-store.js:142)

const NOW = Date.now();
const daysAgo = n => new Date(NOW - n * DAY_MS).toISOString();

function historyRow(overrides = {}) {
  return {
    kind: 'periodical',
    periodicalId: TEMPLATE.id,
    promptName: TEMPLATE.title,
    dispatchedAt: daysAgo(10),
    status: 'taken',
    followUpTo: null,
    abort: false,
    ...overrides
  };
}

function queueRow(overrides = {}) {
  return {
    kind: 'periodical',
    periodicalId: TEMPLATE.id,
    promptName: TEMPLATE.title,
    followUpTo: null,
    abort: false,
    ...overrides
  };
}

// Call-recording, workspace-partitioned fake store. `historyTtl` defaults to
// the store's real 30-day-in-SECONDS default so the seconds-vs-ms trap is
// exercised under realistic conditions, not a convenient round number.
function buildApp({
  queued = {},   // { [urlKey]: rows }
  history = {},  // { [urlKey]: rows }
  historyTtl = HISTORY_TTL_SECONDS,
  dispatchQueueStore: dispatchQueueStoreOverride,
  tokenScope = 'read',
  tokenUrlKey = 'acme',
  validateToken: validateTokenOverride
} = {}) {
  const itemsCalls = [];
  const historyCalls = [];

  const listItems = async (urlKey, opts = {}) => {
    itemsCalls.push({ urlKey, ...opts });
    return queued[urlKey] || [];
  };

  const listHistory = async (urlKey, opts = {}) => {
    historyCalls.push({ urlKey, ...opts });
    return { items: history[urlKey] || [], total: (history[urlKey] || []).length };
  };

  const dispatchQueueStore = dispatchQueueStoreOverride === null
    ? null
    : (dispatchQueueStoreOverride || { listItems, listHistory, historyTtl });

  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      validateToken: validateTokenOverride
        || (async () => ({ tokenId: 't1', urlKey: tokenUrlKey, label: 'test', scope: tokenScope, createdBy: 'u1' }))
    },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token: 'test-token', reason: 'ok' }),
    getWorkspaceAccessToken: async () => 'test-token',
    getWorkspaceOpenRouterKey: async () => null,
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, set: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {} },
    dispatchQueueStore,
    workspaceFromUrl: (req, res, next) => next(),
    freeTierStore: { tryUse: async () => ({ allowed: true }) }
  }));
  return { app, itemsCalls, historyCalls };
}

async function get(app, { token = 'anything', noAuth = false } = {}) {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const headers = noAuth ? {} : { Authorization: `Bearer ${token}` };
    const res = await fetch(`http://127.0.0.1:${port}/api/proxy/periodicals`, { method: 'GET', headers });
    const body = await res.json();
    return { status: res.status, body };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

function findTemplateResult(body) {
  return body.periodicals.find(p => p.id === TEMPLATE.id);
}

describe('GET /api/proxy/periodicals', () => {
  // -- availability / auth -----------------------------------------------

  test('503 when dispatchQueueStore is not configured', async () => {
    const { app } = buildApp({ dispatchQueueStore: null });
    const { status, body } = await get(app);
    assert.equal(status, 503);
    assert.ok(body.error);
  });

  test('read scope is sufficient — no write scope required', async () => {
    const { app } = buildApp({ tokenScope: 'read' });
    const { status } = await get(app);
    assert.equal(status, 200);
  });

  test('missing Authorization header is rejected (401)', async () => {
    const { app } = buildApp();
    const { status, body } = await get(app, { noAuth: true });
    assert.equal(status, 401);
    assert.ok(body.error);
  });

  test('invalid/unrecognized token is rejected (401)', async () => {
    const { app } = buildApp({ validateToken: async () => null });
    const { status, body } = await get(app);
    assert.equal(status, 401);
    assert.ok(body.error);
  });

  // -- response shape -------------------------------------------------------

  test('response carries EXACTLY the documented keys — no `runs`, `id` not `periodicalId`', async () => {
    const { app } = buildApp({ history: { acme: [historyRow()] } });
    const { body } = await get(app);
    const item = findTemplateResult(body);
    assert.ok(item, 'template result present');
    assert.deepEqual(
      Object.keys(item).sort(),
      ['cadence', 'daysSince', 'id', 'lastDispatchedAt', 'mode', 'state', 'title'].sort()
    );
    assert.equal(item.id, TEMPLATE.id);
    assert.equal('periodicalId' in item, false);
    assert.equal('runs' in item, false);
  });

  test('publishes exactly one entry per registry template, even with zero evidence', async () => {
    const { app } = buildApp();
    const { body } = await get(app);
    assert.equal(body.periodicals.length, TEMPLATES.length);
  });

  test('correctly destructures listHistory\'s {items,total} shape (does not iterate the wrapper object)', async () => {
    // If the route ever iterated `history` directly instead of `history.items`,
    // `.filter` on a plain {items,total} object throws — this would 500, not
    // silently misbehave. A 200 with the row's evidence present proves the
    // destructure is correct, not merely that it didn't throw.
    const { app } = buildApp({ history: { acme: [historyRow({ dispatchedAt: daysAgo(2) })] } });
    const { status, body } = await get(app);
    assert.equal(status, 200);
    const item = findTemplateResult(body);
    assert.equal(item.state, 'recent');
    assert.equal(item.daysSince, 2);
  });

  // -- read shape: projection / no-limit / workspace scoping ----------------

  test('both reads carry PERIODICAL_PROJECTION', async () => {
    const { app, itemsCalls, historyCalls } = buildApp();
    await get(app);
    assert.equal(itemsCalls.length, 1);
    assert.equal(historyCalls.length, 1);
    assert.strictEqual(itemsCalls[0].projection, PERIODICAL_PROJECTION);
    assert.strictEqual(historyCalls[0].projection, PERIODICAL_PROJECTION);
  });

  test('the history read carries no `limit` — listHistory\'s limit path sorts on resolvedAt, not dispatchedAt', async () => {
    const { app, historyCalls } = buildApp();
    await get(app);
    assert.equal('limit' in historyCalls[0], false);
    assert.equal(historyCalls[0].limit, undefined);
  });

  // Caught by the e2e suite (LIN-1829 beat 5), not this file originally: the
  // route once passed `since` as a raw epoch-ms NUMBER. `dispatchedAt` is
  // stored as a real Date, and the file-backed MangoDB store's cross-type
  // `$gte` comparator returns NaN (no match) for a Date-vs-Number comparison
  // — so on that backend the belt-and-suspenders `since` trim silently
  // excluded EVERY history row, making every template read `never`
  // regardless of real dispatch history. This fake store's `since` was never
  // type-checked, so this class of bug was invisible here until the e2e
  // mint-take-read-back test caught it against the real store.
  test('`since` is passed as a real Date instance, not a raw epoch-ms number', async () => {
    const { app, historyCalls } = buildApp();
    await get(app);
    assert.ok(historyCalls[0].since instanceof Date, `expected a Date, got ${typeof historyCalls[0].since}`);
  });

  test('both reads are scoped to req.proxyUrlKey', async () => {
    const { app, itemsCalls, historyCalls } = buildApp({ tokenUrlKey: 'acme' });
    await get(app);
    assert.equal(itemsCalls[0].urlKey, 'acme');
    assert.equal(historyCalls[0].urlKey, 'acme');
  });

  test('workspace isolation: workspace A never reflects workspace B\'s queue or history', async () => {
    const { app } = buildApp({
      tokenUrlKey: 'acme',
      queued: { other: [queueRow()] },
      history: { other: [historyRow()] }
    });
    const { body } = await get(app);
    const item = findTemplateResult(body);
    // acme's own rows are empty; 'other' workspace's evidence must not leak in.
    assert.equal(item.state, 'never');
    assert.equal(item.lastDispatchedAt, null);
  });

  // -- queue-vs-history precedence ------------------------------------------

  test('a live queue row reads `recent`, even when history alone would say `due`', async () => {
    const { app } = buildApp({
      queued: { acme: [queueRow()] },
      // A stale history run that WOULD be `due` on its own (weekly cadence, 30 days old).
      history: { acme: [historyRow({ dispatchedAt: daysAgo(30) })] }
    });
    const { body } = await get(app);
    const item = findTemplateResult(body);
    assert.equal(item.state, 'recent');
  });

  // -- state transitions ------------------------------------------------

  test('state transitions: no evidence -> never; recent history -> recent; elapsed cadence -> due', async () => {
    async function stateFor(historyRows) {
      const { app } = buildApp({ history: { acme: historyRows } });
      const { body } = await get(app);
      return findTemplateResult(body).state;
    }
    assert.equal(await stateFor([]), 'never');
    assert.equal(await stateFor([historyRow({ dispatchedAt: daysAgo(2) })]), 'recent');
    assert.equal(await stateFor([historyRow({ dispatchedAt: daysAgo(10) })]), 'due'); // weekly cadence, 10 days elapsed
  });

  test('a followUpTo or aborted row is excluded from evidence', async () => {
    const { app } = buildApp({
      history: {
        acme: [
          historyRow({ dispatchedAt: daysAgo(2), followUpTo: 'some-other-id' }),
          historyRow({ dispatchedAt: daysAgo(2), abort: true })
        ]
      }
    });
    const { body } = await get(app);
    const item = findTemplateResult(body);
    assert.equal(item.state, 'never');
    assert.equal(item.lastDispatchedAt, null);
  });

  test('unknown is reachable when the store\'s retention exceeds the route\'s 30-day horizon (documented, not produced by any real deployment)', async () => {
    // effectiveHorizonMs = min(DEFAULT_HORIZON_MS, historyTtlMs). Configuring a
    // longer-than-30-day retention makes historyTtlMs the LARGER value, so the
    // cap stops being conclusive and "unknown" (not "never") is correct.
    const { app } = buildApp({ historyTtl: 60 * 24 * 60 * 60 }); // 60 days, in seconds
    const { body } = await get(app);
    const item = findTemplateResult(body);
    assert.equal(item.state, 'unknown');
  });

  // -- the false-`never` direction: real evidence must never be hidden ------

  test('does not read a template as `never` when real, in-window evidence exists (the direction this endpoint must never fail toward)', async () => {
    const { app } = buildApp({ history: { acme: [historyRow({ dispatchedAt: daysAgo(1) })] } });
    const { body } = await get(app);
    const item = findTemplateResult(body);
    assert.notEqual(item.state, 'never');
    assert.equal(item.state, 'recent');
    assert.notEqual(item.lastDispatchedAt, null);
  });

  // -- the seconds-vs-ms retention trap --------------------------------------
  //
  // dispatchQueueStore.historyTtl is SECONDS; foldPeriodicalRuns wants ms. A
  // raw-seconds value is finite, so it passes the fold's Number.isFinite
  // guard and silently collapses the horizon to ~30 minutes — real evidence
  // 10 days old then reads as `never`, which is the exact fleet-wide
  // over-dispatch hazard this ticket exists to prevent. This test is written
  // to fail if the route's `* 1000` conversion is removed — see the beat's
  // sibling verification (`git diff` restore of routes/proxy.js) which
  // deletes and restores the conversion to prove this test is load-bearing,
  // not merely present.
  test('a real run 10 days old reads `due`, not `never` — proves historyTtl seconds->ms conversion is applied', async () => {
    const { app } = buildApp({
      historyTtl: HISTORY_TTL_SECONDS, // 2,592,000 (SECONDS) — finite, so an
      // unconverted value would silently pass the fold's guard and collapse
      // the horizon to ~30 minutes instead of 30 days.
      history: { acme: [historyRow({ dispatchedAt: daysAgo(10) })] }
    });
    const { body } = await get(app);
    const item = findTemplateResult(body);
    assert.equal(item.state, 'due'); // weekly cadence, 10 days elapsed
    assert.equal(item.daysSince, 10);
    assert.notEqual(item.state, 'never');
  });
});

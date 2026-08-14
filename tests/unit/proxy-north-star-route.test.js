/**
 * LIN-1810 — GET /api/proxy/north-star
 *
 * Run with: node --test tests/unit/proxy-north-star-route.test.js
 *
 * Harness modeled on tests/unit/proxy-issue-cost-route.test.js: a real
 * express app + fetch over a listening port, with a fake userPreferencesStore
 * and a fake reportHistoryStore so both stores' inputs and the composed
 * response shape can be asserted on directly.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { getWorkspaceNorthStar } from '../../lib/north-star-resolver.js';

const NOW = Date.now();
const daysAgo = n => new Date(NOW - n * 86400000).toISOString();

function report(overrides = {}) {
  return {
    id: 'report-1',
    generatedAt: daysAgo(2),
    model: 'openai/gpt-5.4-mini',
    northStar: 'Old snapshot text — must never be echoed back.',
    narrative: {
      digest: 'Velocity is steady; three tasks landed this week.',
      northStarReading: 'On course — WIP aligns with intent.',
      gap: 'Auth flow lags the intent.'
    },
    orientation: [],
    ...overrides
  };
}

function buildApp({
  northStarByWorkspace = { acme: 'Ship a self-serve onboarding flow by Q3.' },
  creatorId = 'creator-1',
  latestReport = report(),
  reportHistoryStore: reportHistoryStoreOverride,
  getWorkspaceNorthStar: getWorkspaceNorthStarOverride
} = {}) {
  const userPreferencesStore = {
    getUserPreferences: async (accountId) =>
      accountId === creatorId ? { northStarByWorkspace } : {}
  };

  const reportHistoryStore = reportHistoryStoreOverride === null
    ? null
    : (reportHistoryStoreOverride || { getLatest: async () => latestReport });

  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      validateToken: async () => ({ tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'read', createdBy: creatorId })
    },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token: 'test-token', reason: 'ok' }),
    getWorkspaceAccessToken: async () => 'test-token',
    getWorkspaceOpenRouterKey: async () => null,
    getWorkspaceNorthStar: getWorkspaceNorthStarOverride
      || ((urlKey, accountId) => getWorkspaceNorthStar(userPreferencesStore, urlKey, accountId)),
    reportHistoryStore,
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, set: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {} },
    workspaceFromUrl: (req, res, next) => next(),
    freeTierStore: { tryUse: async () => ({ allowed: true }) }
  }));
  return { app };
}

async function get(app, path, { token = 'anything' } = {}) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'GET', headers });
    const body = await res.json();
    return { status: res.status, body };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

describe('GET /api/proxy/north-star', () => {
  test('503 when reportHistoryStore is not configured', async () => {
    const { app } = buildApp({ reportHistoryStore: null });
    const { status, body } = await get(app, '/api/proxy/north-star');
    assert.equal(status, 503);
    assert.ok(body.error);
  });

  test('read scope is sufficient — no write scope required', async () => {
    const { app } = buildApp();
    const { status } = await get(app, '/api/proxy/north-star');
    assert.equal(status, 200);
  });

  test('returns the live north star + fresh reading + fresh roadmap digest', async () => {
    const { app } = buildApp();
    const { status, body } = await get(app, '/api/proxy/north-star');
    assert.equal(status, 200);
    assert.equal(body.northStar, 'Ship a self-serve onboarding flow by Q3.');
    assert.equal(body.reading.state, 'fresh');
    assert.equal(body.reading.text, 'On course — WIP aligns with intent.');
    assert.equal(body.reading.gap, 'Auth flow lags the intent.');
    assert.equal(body.reading.ageDays, 2);
    assert.equal(body.roadmap.state, 'fresh');
    assert.equal(body.roadmap.narrative, 'Velocity is steady; three tasks landed this week.');
    assert.equal(body.roadmap.ageDays, 2);
    assert.equal(body.reportGeneratedAt, report().generatedAt);
    assert.equal(body.maxAgeDays, 14);
  });

  test('never falls back to the report-time northStar snapshot', async () => {
    // report().northStar is a deliberately different string from the live
    // durable one — the response must reflect the live value, never the
    // snapshot (LIN-1810: lib/report-history-store.js is NOT the north-star
    // KV blob).
    const { app } = buildApp();
    const { body } = await get(app, '/api/proxy/north-star');
    assert.notEqual(body.northStar, 'Old snapshot text — must never be echoed back.');
  });

  test('northStar is null and reading is "absent" when the creator has no north star set', async () => {
    const { app } = buildApp({ northStarByWorkspace: {} });
    const { body } = await get(app, '/api/proxy/north-star');
    assert.equal(body.northStar, null);
    assert.equal(body.reading.state, 'absent');
    // The roadmap digest is independent of whether a live north star exists.
    assert.equal(body.roadmap.state, 'fresh');
  });

  test('reading is "absent" and roadmap is "absent" when there is no report at all', async () => {
    const { app } = buildApp({ latestReport: null });
    const { body } = await get(app, '/api/proxy/north-star');
    assert.equal(body.northStar, 'Ship a self-serve onboarding flow by Q3.');
    assert.equal(body.reading.state, 'absent');
    assert.equal(body.roadmap.state, 'absent');
    assert.equal(body.roadmap.narrative, null);
    assert.equal(body.reportGeneratedAt, null);
  });

  test('reading is "stale" and roadmap is "stale" when the latest report is older than maxAgeDays', async () => {
    const { app } = buildApp({ latestReport: report({ generatedAt: daysAgo(15) }) });
    const { body } = await get(app, '/api/proxy/north-star');
    assert.equal(body.reading.state, 'stale');
    assert.equal(body.reading.ageDays, null);
    assert.equal(body.roadmap.state, 'stale');
    assert.equal(body.roadmap.narrative, null);
    // Independent of the gate — present even when the reading itself is stale.
    assert.equal(body.reportGeneratedAt, daysAgo(15));
  });

  test('reading is "unscored" when the latest report is fresh but never scored alignment — distinct from "stale"', async () => {
    // This is the defect the LIN-1810 research flagged: a bare `ageDays: null`
    // cannot tell "stale" apart from "fresh but unpopulated". The route must.
    const { app } = buildApp({
      latestReport: report({ narrative: { digest: 'Digest only, no alignment scored.' } })
    });
    const { body } = await get(app, '/api/proxy/north-star');
    assert.equal(body.reading.state, 'unscored');
    assert.equal(body.reading.text, '');
    assert.equal(body.reading.gap, '');
    assert.equal(body.reading.ageDays, null);
    // The roadmap digest is unaffected — it has its own prose to show.
    assert.equal(body.roadmap.state, 'fresh');
    assert.equal(body.roadmap.narrative, 'Digest only, no alignment scored.');
  });

  test('roadmap is "unscored" when the latest report is fresh but carried no digest and no trajectory', async () => {
    // The symmetric half of the case above, and the branch the LIN-1810 review
    // found unreachable as originally shipped (roadmap.state was a bare
    // three-way report classification, so an empty narrative reported "fresh"
    // next to `narrative: null`). Both blocks now carry the same four states.
    const { app } = buildApp({
      latestReport: report({ narrative: { northStarReading: 'On course.', gap: 'Auth lags.' } })
    });
    const { body } = await get(app, '/api/proxy/north-star');
    assert.equal(body.roadmap.state, 'unscored');
    assert.equal(body.roadmap.narrative, null);
    assert.equal(body.roadmap.ageDays, null);
    // The alignment reading is unaffected — it has its own scored prose.
    assert.equal(body.reading.state, 'fresh');
    assert.equal(body.reading.text, 'On course.');
  });

  test('both blocks are "unscored" when a fresh report has a completely empty narrative', async () => {
    const { app } = buildApp({ latestReport: report({ narrative: {} }) });
    const { body } = await get(app, '/api/proxy/north-star');
    assert.equal(body.reading.state, 'unscored');
    assert.equal(body.roadmap.state, 'unscored');
    assert.equal(body.roadmap.narrative, null);
    // A fresh report still exists — "unscored" is precisely NOT "absent".
    assert.equal(body.reportGeneratedAt, report().generatedAt);
  });

  test('an unparseable generatedAt reads "absent" on both blocks while reportGeneratedAt echoes the stored value', async () => {
    // Pins the composed response for a corrupt timestamp (LIN-1810 close-out,
    // review finding 2 / ledger item 4). classifyReportFreshness is unit-tested
    // for this in next-run.test.js; this is the route-level contract, and it is
    // the one documented case where reportGeneratedAt is non-null next to
    // "absent" — there is no age the gate can trust, which is a different
    // signal from "stale" (a usable timestamp that fails the gate).
    const { app } = buildApp({ latestReport: report({ generatedAt: 'not-a-date' }) });
    const { status, body } = await get(app, '/api/proxy/north-star');
    assert.equal(status, 200);
    assert.equal(body.reading.state, 'absent');
    assert.equal(body.roadmap.state, 'absent');
    assert.equal(body.roadmap.narrative, null);
    assert.equal(body.reportGeneratedAt, 'not-a-date');
    // The live durable intent is unaffected by a corrupt report timestamp.
    assert.equal(body.northStar, 'Ship a self-serve onboarding flow by Q3.');
  });

  test('a creator-less token resolves no north star (fails closed)', async () => {
    const { app } = buildApp({ creatorId: null });
    const { body } = await get(app, '/api/proxy/north-star');
    assert.equal(body.northStar, null);
    assert.equal(body.reading.state, 'absent');
  });

  test("one token creator's north star is never returned for another creator's token", async () => {
    // getWorkspaceNorthStar resolves strictly off req.proxyCreatedBy — the
    // fake store only has data for 'creator-1', so a token minted for a
    // different creator must see no north star, even for the same workspace.
    const userPreferencesStore = {
      getUserPreferences: async (accountId) =>
        accountId === 'creator-1' ? { northStarByWorkspace: { acme: 'creator-1 only' } } : {}
    };
    const app = express();
    app.use(express.json());
    app.use(createProxyRoutes({
      proxyTokenStore: {
        validateToken: async () => ({ tokenId: 't2', urlKey: 'acme', label: 'test', scope: 'read', createdBy: 'creator-2' })
      },
      proxyEventStore: { recordEvent: async () => {} },
      resolveWorkspaceAccess: async () => ({ token: 'test-token', reason: 'ok' }),
      getWorkspaceAccessToken: async () => 'test-token',
      getWorkspaceOpenRouterKey: async () => null,
      getWorkspaceNorthStar: (urlKey, accountId) => getWorkspaceNorthStar(userPreferencesStore, urlKey, accountId),
      reportHistoryStore: { getLatest: async () => report() },
      agentStatusStore: {},
      recapCacheStore: { get: async () => null, set: async () => {} },
      briefCacheStore: { get: async () => null, set: async () => {} },
      workspaceFromUrl: (req, res, next) => next(),
      freeTierStore: { tryUse: async () => ({ allowed: true }) }
    }));
    const { body } = await get(app, '/api/proxy/north-star');
    assert.equal(body.northStar, null);
  });
});

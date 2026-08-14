/**
 * LIN-1775 — GET /api/proxy/issues/:identifier/cost (+ alias /api/proxy/cost/:identifier)
 *
 * Run with: node --test tests/unit/proxy-issue-cost-route.test.js
 *
 * Harness modeled on tests/unit/proxy-dispatch-lineage-join.test.js: an
 * OPTIONS-AWARE, CALL-RECORDING dispatch-store stub so both the issue-scoped
 * own-row reads and the unscoped lineage-sibling batch query can be asserted
 * on directly, alongside the actual response shape.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes, LINEAGE_QUERY_LIMIT } from '../../routes/proxy.js';

const T1 = '2026-08-01T10:00:00.000Z';

function usageEntry({ model = 'anthropic/claude-sonnet-5', costUsd, timestamp = T1, rootItemId } = {}) {
  const payload = { model };
  if (costUsd !== undefined) payload.costUsd = costUsd;
  const entry = { kind: 'usage', timestamp, message: `[usage] ${JSON.stringify(payload)}` };
  if (rootItemId) entry.rootItemId = rootItemId;
  return entry;
}

function row(overrides = {}) {
  return {
    id: 'row-1',
    status: 'taken',
    promptName: 'implementation',
    kind: 'implementation',
    issueIdentifier: 'LIN-42',
    issueUrl: null,
    target: 'cli',
    dispatchedAt: T1,
    resolvedAt: T1,
    rootItemId: 'root-1',
    feedback: [usageEntry({ costUsd: 4.9 })],
    ...overrides
  };
}

// Build an app whose dispatch store returns the given queued/history rows,
// distinguishing the lineage batch query (`rootItemId: {$in: [...]}`) from
// the ordinary issue-scoped page query so both can be asserted on.
function buildApp({ queued = [], history = [], dispatchQueueStore: dispatchQueueStoreOverride, llmCallLogStore } = {}) {
  const historyCalls = [];
  const itemsCalls = [];

  const listHistory = async (urlKey, opts = {}) => {
    historyCalls.push(opts);
    if (opts.rootItemId && opts.rootItemId.$in) {
      const anchors = opts.rootItemId.$in;
      let items = history.filter(r => anchors.includes(r.rootItemId));
      const total = items.length;
      if (opts.limit) items = items.slice(0, opts.limit);
      return { items, total };
    }
    let items = opts.issueIdentifier
      ? history.filter(r => r.issueIdentifier === opts.issueIdentifier)
      : history;
    const total = items.length;
    return { items, total };
  };

  const listItems = async (urlKey, opts = {}) => {
    itemsCalls.push(opts);
    return opts.issueIdentifier ? queued.filter(r => r.issueIdentifier === opts.issueIdentifier) : queued;
  };

  const dispatchQueueStore = dispatchQueueStoreOverride === null
    ? null
    : (dispatchQueueStoreOverride || { listItems, listHistory });

  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      validateToken: async () => ({ tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'read', createdBy: 'u1' })
    },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token: 'test-token', reason: 'ok' }),
    getWorkspaceAccessToken: async () => 'test-token',
    getWorkspaceOpenRouterKey: async () => null,
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, set: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {} },
    dispatchQueueStore,
    llmCallLogStore,
    workspaceFromUrl: (req, res, next) => next(),
    freeTierStore: { tryUse: async () => ({ allowed: true }) }
  }));
  return { app, historyCalls, itemsCalls };
}

async function get(app, path) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'GET',
      headers: { Authorization: 'Bearer anything' }
    });
    const body = await res.json();
    return { status: res.status, body };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

function lineageCallOf(historyCalls) {
  return historyCalls.find(c => c.rootItemId && c.rootItemId.$in);
}
function pageCallOf(historyCalls) {
  return historyCalls.find(c => !(c.rootItemId && c.rootItemId.$in));
}

describe('GET /api/proxy/issues/:identifier/cost — validation', () => {
  test('400 on an invalid identifier', async () => {
    const { app } = buildApp({ history: [row()] });
    const { status, body } = await get(app, '/api/proxy/issues/LIN%2042/cost');
    assert.equal(status, 400);
    assert.ok(body.error);
  });

  test('503 when dispatchQueueStore is not configured', async () => {
    const { app } = buildApp({ dispatchQueueStore: null });
    const { status, body } = await get(app, '/api/proxy/issues/LIN-42/cost');
    assert.equal(status, 503);
    assert.ok(body.error);
  });

  test('read scope is sufficient — no write scope required', async () => {
    // The harness's validateToken already returns scope: 'read'; a 200
    // (not 403) proves the route imposes no requireWriteScope gate.
    const { app } = buildApp({ history: [row()] });
    const { status } = await get(app, '/api/proxy/issues/LIN-42/cost');
    assert.equal(status, 200);
  });

  test('400 (not a silent zeroed result) on a UUID-shaped identifier — LIN-1775 R1', async () => {
    // A UUID passes isValidIssueId's shape check, but dispatch/call-log rows
    // are keyed by the human identifier, so it would otherwise silently
    // match zero rows and return an authoritative-looking $0.00.
    const ownRow = row({ id: 'row-uuid', issueIdentifier: '01882c20-bc5e-4307-8a33-4f9857e65f7e' });
    const { app, historyCalls } = buildApp({ history: [ownRow] });
    const { status, body } = await get(app, '/api/proxy/issues/01882c20-bc5e-4307-8a33-4f9857e65f7e/cost');
    assert.equal(status, 400);
    assert.ok(body.error);
    // No store read should be attempted once the identifier is rejected.
    assert.equal(historyCalls.length, 0);
  });

  test('the alias also rejects a UUID-shaped identifier with 400', async () => {
    const { app } = buildApp({ history: [] });
    const { status } = await get(app, '/api/proxy/cost/01882c20-bc5e-4307-8a33-4f9857e65f7e');
    assert.equal(status, 400);
  });

  test('a non-UUID identifier that merely contains hyphens/digits (e.g. LIN-1770) is unaffected', async () => {
    const { app } = buildApp({ history: [row()] });
    const { status } = await get(app, '/api/proxy/issues/LIN-42/cost');
    assert.equal(status, 200);
  });
});

describe('GET /api/proxy/issues/:identifier/cost — route aliases', () => {
  test('canonical and alias forms return identical bodies', async () => {
    const { app } = buildApp({ history: [row()] });
    const a = await get(app, '/api/proxy/issues/LIN-42/cost');
    const b = await get(app, '/api/proxy/cost/LIN-42');
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    // `window.appCallsSince` is computed from Date.now() per request, so it can
    // legitimately differ by a millisecond between the two calls; everything
    // else must be byte-identical.
    const strip = body => ({ ...body, window: { ...body.window, appCallsSince: undefined } });
    assert.deepEqual(strip(a.body), strip(b.body));
  });
});

describe('GET /api/proxy/issues/:identifier/cost — store wiring', () => {
  test('own-row reads are issue-scoped and exclude prompt', async () => {
    const { app, historyCalls, itemsCalls } = buildApp({ history: [row()] });
    await get(app, '/api/proxy/issues/LIN-42/cost');

    assert.equal(itemsCalls[0].issueIdentifier, 'LIN-42');
    assert.deepEqual(itemsCalls[0].projection, { prompt: 0 });

    const pageCall = pageCallOf(historyCalls);
    assert.equal(pageCall.issueIdentifier, 'LIN-42');
    assert.deepEqual(pageCall.projection, { prompt: 0 });
  });

  test('the lineage-sibling batch query is UNSCOPED by issueIdentifier and carries the defensive limit', async () => {
    const ownRow = row();
    // A cross-issue follow-up sharing the same rootItemId, filed under a
    // DIFFERENT issue — must still be fetched and merged for cost correctness.
    const crossIssueSibling = row({
      id: 'row-2', issueIdentifier: 'LIN-99', dispatchedAt: '2026-08-01T10:10:00.000Z',
      feedback: [usageEntry({ costUsd: 9, timestamp: '2026-08-01T10:20:00.000Z', rootItemId: 'root-1' })]
    });
    const { app, historyCalls, body: _unused } = buildApp({ history: [ownRow, crossIssueSibling] });
    const { status, body } = await get(app, '/api/proxy/issues/LIN-42/cost');

    assert.equal(status, 200);
    const lineageCall = lineageCallOf(historyCalls);
    assert.ok(lineageCall, 'expected a lineage batch query');
    assert.equal(lineageCall.issueIdentifier, undefined);
    assert.equal(lineageCall.limit, LINEAGE_QUERY_LIMIT);
    assert.deepEqual(lineageCall.projection, { prompt: 0 });

    // Last-wins over the merged lineage: the cross-issue follow-up's cost (9),
    // not the sum of both (4.9 + 9).
    assert.equal(body.pricedUsd, 9);
    assert.equal(body.workerSessions.length, 1);
  });

  test('no lineage batch query is issued when there are no taken rows', async () => {
    const queuedOnly = row({ status: 'queued' });
    const { app, historyCalls } = buildApp({ queued: [queuedOnly], history: [] });
    await get(app, '/api/proxy/issues/LIN-42/cost');
    assert.equal(lineageCallOf(historyCalls), undefined);
  });
});

describe('GET /api/proxy/issues/:identifier/cost — response shape', () => {
  test('end-to-end: worker + app costs joined, fully priced', async () => {
    const llmCallLogStore = {
      summarizeByIssue: async (urlKey, identifier) => {
        assert.equal(urlKey, 'acme');
        assert.equal(identifier, 'LIN-42');
        return { calls: 2, costUsd: 0.05, unpricedCalls: 0, byFeature: [{ feature: 'recommend', calls: 2, costUsd: 0.05 }] };
      },
      ttl: 30 * 24 * 60 * 60
    };
    const { app } = buildApp({ history: [row()], llmCallLogStore });
    const { status, body } = await get(app, '/api/proxy/issues/LIN-42/cost');

    assert.equal(status, 200);
    assert.equal(body.identifier, 'LIN-42');
    assert.equal(body.pricedUsd, 4.9);
    assert.equal(body.totalUsd, 4.95);
    assert.deepEqual(body.unpriced, []);
    assert.equal(body.noTelemetryCount, 0);
    assert.equal(body.workerSessions.length, 1);
    assert.equal(body.workerSessions[0].rootItemId, 'root-1');
    assert.equal(body.workerSessions[0].kind, 'implementation');
    assert.equal(body.appCalls.calls, 2);
    assert.equal(body.appCalls.costUsd, 0.05);
    assert.equal(body.window.days, 30);
    assert.ok(body.window.appCallsSince);
  });

  test('missing llmCallLogStore degrades to an empty app-call summary, never a 500', async () => {
    const { app } = buildApp({ history: [row()], llmCallLogStore: undefined });
    const { status, body } = await get(app, '/api/proxy/issues/LIN-42/cost');
    assert.equal(status, 200);
    assert.deepEqual(body.appCalls, { calls: 0, costUsd: 0, unpricedCalls: 0, byFeature: [] });
    assert.equal(body.totalUsd, 4.9);
  });

  test('an unknown issue with no dispatch rows returns a zeroed, fully-priced result — not 404', async () => {
    const { app } = buildApp({ history: [] });
    const { status, body } = await get(app, '/api/proxy/issues/LIN-999/cost');
    assert.equal(status, 200);
    assert.equal(body.pricedUsd, 0);
    assert.equal(body.totalUsd, 0);
    assert.deepEqual(body.workerSessions, []);
  });
});
